// One user event stream per signed-in account, shared by Chats and the call
// listener. It runs only while the page is visible (or a call is active), and
// reconnects with exponential backoff and jitter capped at 120 s like iOS.
// The server has no replay: every (re)connection starts with a `ready` event,
// which listeners treat as the signal to repair anything missed while closed.

const streams = new WeakMap();
const MAX_BACKOFF_MS = 120_000;
const CLOSED = 2;

export function chatRealtime({ api, getUser }) {
    let stream = streams.get(api);
    if (!stream) {
        stream = createChatRealtime({ api, getUserId: () => getUser?.()?.id });
        streams.set(api, stream);
    }
    return stream;
}

export function createChatRealtime({ api, getUserId, doc = document, win = window, random = Math.random,
    schedule = setTimeout, cancel = clearTimeout } = {}) {
    const listeners = new Set();
    const keepAlive = new Set();
    let source = null, user = null, timer = null, wanted = false, failures = 0, errorsSinceMessage = 0;
    let lastEventId = null;

    const pinned = () => [...keepAlive].some((check) => { try { return check(); } catch (_) { return false; } });
    const allowed = () => wanted && (!doc.hidden || pinned()) && win.navigator?.onLine !== false;

    function emit(event) {
        for (const listener of [...listeners]) {
            try { listener(event); } catch (_) { /* One listener cannot starve the others. */ }
        }
    }

    function close() {
        cancel(timer);
        timer = null;
        const closing = source;
        source = null;
        try { closing?.close?.(); } catch (_) { /* Already closed. */ }
    }

    function reconnectLater() {
        close();
        const ceiling = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(failures++, 7));
        timer = schedule(open, ceiling / 2 + random() * ceiling / 2);
    }

    function open() {
        cancel(timer);
        timer = null;
        const id = getUserId?.();
        if (source && String(id || "") !== user) close();
        if (source || !id || !allowed() || typeof EventSource === "undefined" || typeof api.chatEventsURL !== "function") return;
        user = String(id);
        const connection = new EventSource(api.chatEventsURL(id), { withCredentials: true });
        source = connection;
        const consume = (event) => {
            if (source !== connection) return;
            failures = 0;
            errorsSinceMessage = 0;
            try {
                const payload = JSON.parse(event.data);
                if (!payload || typeof payload !== "object") return;
                if (!payload.id && event.lastEventId) payload.id = event.lastEventId;
                if (payload.id) lastEventId = payload.id;
                emit(payload);
            } catch (_) { /* A later authoritative refresh repairs malformed hints. */ }
        };
        connection.onmessage = consume;
        connection.addEventListener("chat", consume);
        connection.onerror = () => {
            if (source !== connection) return;
            // The browser retries a dropped stream by itself; take over with
            // backoff when it gives up or keeps failing without a message.
            errorsSinceMessage += 1;
            if (connection.readyState === CLOSED || errorsSinceMessage >= 3) reconnectLater();
        };
    }

    function sync() {
        if (!allowed()) { close(); return; }
        if (!source && !timer) { failures = 0; open(); }
        else if (source && String(getUserId?.() || "") !== user) { close(); open(); }
    }

    doc.addEventListener("visibilitychange", sync);
    win.addEventListener("online", sync);
    win.addEventListener("offline", sync);
    win.addEventListener("pageshow", sync);
    win.addEventListener("pagehide", close);
    win.addEventListener("valid:session-expired", () => { wanted = false; close(); });

    return {
        start() { wanted = true; sync(); },
        stop() { wanted = false; close(); lastEventId = null; },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        // A check that keeps the stream open while hidden (an active call).
        keepAliveWhile(check) { keepAlive.add(check); return () => keepAlive.delete(check); },
        refresh: sync,
        get connected() { return Boolean(source); },
        get lastEventId() { return lastEventId; },
    };
}
