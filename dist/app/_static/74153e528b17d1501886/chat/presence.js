// Foreground-only presence. Never infer activity from messages or local clocks.
export function presenceLabel(member, now) {
    if (!member || !Number.isFinite(now) || !Number.isFinite(member.last_active_at)) return '';
    if (Number.isFinite(member.active_until) && member.active_until > now) return 'Active now';
    const age = Math.max(0, now - member.last_active_at);
    if (age < 300) return 'Active recently';
    if (age < 3600) return `Active ${Math.floor(age / 60)}m ago`;
    if (age < 86400) return `Active ${Math.floor(age / 3600)}h ago`;
    if (age < 172800) return 'Active yesterday';
    if (age < 259200) return 'Active 2 days ago';
    return '';
}

export function createChatPresence({ api, now = () => performance.now(), uuid = () => crypto.randomUUID(),
    schedule = setTimeout, cancel = clearTimeout, random = Math.random }) {
    let user = null, session = null, sequence = 0, generation = 0, revision = 0;
    let sample = null, watched = [], sentKey = '', timer = null, request = null;
    let lastRequest = -Infinity, nextRequest = 0, changedAt = 0, retrying = false, failures = 0;
    const listeners = new Set();
    const emit = () => listeners.forEach(listener => listener());
    function serverNow() {
        const age = sample ? now() - sample.received : Infinity;
        return sample?.response.enabled === true && age >= 0 && age < 35_000
            ? sample.response.server_now + age / 1000 : null;
    }
    function members(chatId) {
        if (serverNow() == null || !watched.includes(String(chatId))) return [];
        return sample.response.chats.find(chat => String(chat.chat_id) === String(chatId))?.members || [];
    }
    function status(chatId, isGroup = false) {
        const time = serverNow();
        const peers = members(chatId).filter(member => String(member.user_id) !== String(user));
        const count = peers.filter(member => Number.isFinite(member.active_until) && member.active_until > time).length;
        return { active: count > 0, count, label: isGroup ? (count ? `${count} active now` : '') : presenceLabel(peers[0], time) };
    }
    function invalidate() {
        revision++;
        sample = null;
        sentKey = '';
        emit();
    }
    function setWatched(ids) {
        const next = [...new Set(ids.map(String))].slice(0, 20);
        if (JSON.stringify(next) === JSON.stringify(watched)) return;
        watched = next;
        changedAt = now();
        emit();
    }
    async function pulse() {
        const token = generation, version = revision, ids = [...watched], start = now();
        const controller = new AbortController();
        request = controller;
        lastRequest = start;
        try {
            const response = await api.updateChatPresence(user, {
                session_id: session, sequence: ++sequence, active: true, chat_ids: ids,
            }, { signal: controller.signal });
            if (generation !== token) return;
            if (!Number.isFinite(response?.server_now) || typeof response.enabled !== 'boolean' || !Array.isArray(response.chats)) throw new Error('Invalid presence response');
            if (revision === version) {
                // Only keep requested audiences; server authorization remains authoritative.
                sample = { received: start, response: { ...response, chats: response.chats.filter(chat => ids.includes(String(chat.chat_id))).map(chat => ({
                    ...chat, members: Array.isArray(chat.members) ? chat.members.filter(member => member && Number.isFinite(member.last_active_at)) : [],
                })) } };
                sentKey = JSON.stringify(ids);
            }
            failures = 0;
            retrying = false;
            nextRequest = now() + (ids.length ? 25_000 : 35_000) + (random() * 4000 - 2000);
        } catch (error) {
            if (generation !== token) return;
            sample = null;
            retrying = true;
            const delay = Math.min(120_000, 25_000 * 2 ** Math.min(failures++, 3));
            nextRequest = now() + Math.max(delay, error.status === 429 ? 60_000 : 0,
                Math.min(86_400_000, (error.retryAfterSeconds || 0) * 1000)) + random() * 3000;
        } finally {
            if (generation === token) { request = null; emit(); }
        }
    }
    function tick() {
        if (!user) return;
        const time = now();
        if (!request && (time >= nextRequest || (!retrying && sentKey !== JSON.stringify(watched)
            && time - lastRequest >= 3000 && time - changedAt >= 500))) void pulse();
        emit(); // Expiry must update even when a request hangs or the network fails.
        timer = schedule(tick, 1000);
    }
    function stop() {
        const oldUser = user, oldSession = session, finalSequence = ++sequence;
        user = null;
        generation++;
        cancel(timer);
        timer = null;
        request?.abort();
        request = null;
        sample = null;
        emit();
        // Keepalive plus a higher sequence fences late foreground requests.
        // The server's 60s lease still expires if the browser cannot deliver this.
        if (oldUser) return api.updateChatPresence(oldUser, {
            session_id: oldSession, sequence: finalSequence, active: false, chat_ids: [],
        }, { keepalive: true }).catch(() => null);
        return Promise.resolve();
    }
    function start(id) {
        if (!id || user === String(id)) return;
        void stop();
        user = String(id);
        session = uuid();
        sequence = 0;
        sentKey = '';
        nextRequest = 0;
        lastRequest = -Infinity;
        retrying = false;
        failures = 0;
        tick();
    }
    return { start, stop, setWatched, invalidate, serverNow, members, status,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    };
}

export function bindPresenceLifecycle(presence, { document: doc = document, window: win = window, online = () => navigator.onLine !== false } = {}) {
    let user = null, pageHidden = false;
    const sync = () => {
        if (user && !doc.hidden && !pageHidden && online()) presence.start(user);
        else void presence.stop();
    };
    doc.addEventListener('visibilitychange', sync);
    win.addEventListener('pagehide', () => { pageHidden = true; void presence.stop(); });
    win.addEventListener('pageshow', () => { pageHidden = false; sync(); });
    win.addEventListener('offline', sync);
    win.addEventListener('online', sync);
    return { setUser(id) { if (user !== id) presence.setWatched([]); user = id; sync(); },
        stop() { user = null; presence.setWatched([]); return presence.stop(); } };
}
