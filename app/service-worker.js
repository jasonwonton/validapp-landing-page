const CACHE_PREFIX = "valid-web-";
const CACHE_NAME = `${CACHE_PREFIX}v105`;
// Every module the startup graph imports statically must be listed here, or the
// installed app cannot start offline; scripts/tests/service-worker-shell.test.mjs
// walks the import graph and enforces it. Dynamic imports that need the network
// anyway (the weekly game, LiveKit, the localhost-only demo) stay network-only.
const APP_SHELL = [
    "./",
    "./styles.css",
    "./preferences.js",
    "./app.js",
    "./api.js",
    "./session-recovery.js",
    "./passkeys.js",
    "./auth-reliability.js",
    "./auth-route-recovery.js",
    "./auth-diagnostics.js",
    "./performance.js",
    "./keyed-list.js",
    "./realtime-list.js",
    "./runtime-style.js",
    "./camera-effects.js",
    "./ui-icons.js",
    "./media-url.js",
    "./ui-dialogs.js",
    "./toast.js",
    "./user-message.js",
    "./tbh-share.js",
    "./blocked-users.js",
    "./ios-install.js",
    "./feed-sender.js",
    "./live-camera.js",
    "./media-overlay-positioner.js",
    "./routes/route-loader.js",
    "./routes/feed.js",
    "./routes/play.js",
    "./routes/chats.js",
    "./routes/profile.js",
    "./chat/styles.css",
    "./chat/presence.js",
    "./chat/activity-settings.js",
    "./chat/index.js",
    "./chat/actions.js",
    "./chat/history.js",
    "./chat/view-once.js",
    "./chat/appearance.js",
    "./chat/sticker-maker.js",
    "./chat/photo-stickers.js",
    "./chat/voice-interaction.js",
    "./chat/message-window.js",
    "./chat/timeline-scroll.js",
    "./chat/models.js",
    "./chat/call-history.js",
    "./chat/store.js",
    "./chat/media.js",
    "./chat/outbox.js",
    "./calls/index.js",
    "./calls/ringback.js",
    "./stories/index.js",
    "./stories/styles.css",
    "./calls/styles.css",
    "./comments/index.js",
    "./comments/styles.css",
    "./manifest.webmanifest",
    "../assets/AppIconV2.png",
    "../assets/pwa/icon-192.png",
    "../assets/pwa/icon-512.png",
    "../assets/pwa/icon-maskable-512.png",
    "../assets/valid_logo.png",
    "../assets/Jua-Latin.woff2",
];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("message", (event) => {
    if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys
                .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
                .map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

    // Authenticated JSON is deliberately network-only. The app owns the small,
    // user-scoped snapshots that are safe to restore offline.
    if (url.pathname.startsWith("/api/")) return;

    if (event.request.mode === "navigate") {
        // Embedded game documents must receive their own HTML, never the PWA
        // shell. This also keeps non-app navigations out of offline routing.
        if (event.request.destination !== "document" || !url.pathname.startsWith("/app/")) return;
        event.respondWith(caches.open(CACHE_NAME).then((cache) => cache.match("./")).then((cached) => cached || fetch(event.request)));
        return;
    }

    // Only files explicitly listed in APP_SHELL can ever be read from Cache
    // Storage. Unlisted same-origin media and other runtime responses stay on
    // the network even when an origin accidentally omits a private directive.
    event.respondWith(caches.open(CACHE_NAME).then((cache) => cache.match(event.request)).then((cached) => cached || fetch(event.request)));
});

function safeNotificationURL(value) {
    try {
        const url = new URL(value || "/app/", self.location.origin);
        if (url.origin === self.location.origin && url.pathname.startsWith("/app/")) return url.href;
    } catch (_) {
        // Use the app home when a provider payload is malformed.
    }
    return new URL("/app/", self.location.origin).href;
}

// The page reports which chat it shows (VALID_ACTIVE_CHAT). Worker memory can be
// dropped between pushes, so a focused client's URL (?chat=) is the fallback.
const activeChats = new Map();

self.addEventListener("message", (event) => {
    const clientId = event.source?.id;
    if (event.data?.type === "VALID_ACTIVE_CHAT" && clientId) {
        activeChats.set(clientId, event.data.visible && event.data.chatId ? String(event.data.chatId) : null);
    } else if (event.data?.type === "VALID_BADGE_SYNC") {
        event.waitUntil(writeBadgeCount(Math.max(0, Number(event.data.count) || 0)));
    }
});

function badgeStore(mode, operation) {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open("valid-worker", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("state");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const transaction = open.result.transaction("state", mode);
            const request = operation(transaction.objectStore("state"));
            transaction.oncomplete = () => { open.result.close(); resolve(request.result); };
            transaction.onerror = () => { open.result.close(); reject(transaction.error); };
        };
    });
}

const readBadgeCount = () => badgeStore("readonly", (store) => store.get("badge")).then((value) => Number(value) || 0).catch(() => 0);
const writeBadgeCount = (count) => badgeStore("readwrite", (store) => store.put(count, "badge")).catch(() => null);

async function updateAppBadge(payload) {
    if (!self.navigator || !("setAppBadge" in self.navigator)) return;
    // Prefer the server's unread count; otherwise count pushes since the page
    // last reported its own badge (VALID_BADGE_SYNC).
    const explicit = Number(payload.badge ?? payload.data?.badge ?? payload.data?.badge_count);
    const count = Number.isFinite(explicit) && explicit >= 0 ? explicit : await readBadgeCount() + 1;
    await writeBadgeCount(count);
    await Promise.resolve(count > 0 ? self.navigator.setAppBadge(count) : self.navigator.clearAppBadge?.()).catch(() => null);
}

function notificationType(payload) {
    return String(payload.type || payload.data?.type || "");
}

async function clientViewingChat(chatId) {
    if (!chatId) return null;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    return windows.find((client) => {
        if (!client.focused || client.visibilityState !== "visible") return false;
        if (activeChats.has(client.id)) return activeChats.get(client.id) === chatId;
        try { return new URL(client.url).searchParams.get("chat") === chatId; } catch (_) { return false; }
    }) || null;
}

// Safari revokes a subscription whose pushes show nothing, so on WebKit a
// suppressed chat push is still shown silently and closed at once.
const appleWebKit = () => /AppleWebKit/.test(self.navigator?.userAgent || "") && !/Chrome|Chromium|Edg\//.test(self.navigator.userAgent);

async function presentPush(payload) {
    const type = notificationType(payload);
    const url = new URL(safeNotificationURL(payload.url));
    // Story screenshot notices open that Story's viewers list.
    if (type === "story_capture" && url.searchParams.has("story")) url.searchParams.set("viewers", "1");
    const data = { url: url.href, type };
    const title = payload.title || "Valid";
    const tag = typeof payload.tag === "string" && payload.tag.trim() ? payload.tag.trim() : undefined;

    if (type.startsWith("chat_")) {
        const chatId = String(payload.data?.chat_id || url.searchParams.get("chat") || "");
        const viewer = await clientViewingChat(chatId);
        if (viewer) {
            viewer.postMessage({ type: "VALID_PUSH_IN_ACTIVE_CHAT", chatId, payload: { title, body: payload.body, type, url: data.url } });
            if (!appleWebKit()) return;
            const shown = `valid-suppressed-${Date.now()}`;
            await self.registration.showNotification(title, { body: payload.body || "", tag: shown, silent: true, data });
            (await self.registration.getNotifications({ tag: shown })).forEach((notification) => notification.close());
            return;
        }
    }

    const options = {
        body: payload.body || "You have a new update.",
        icon: "/assets/pwa/icon-192.png",
        // Android draws the badge from its alpha channel: a white glyph on transparency.
        badge: "/assets/pwa/badge-96.png",
        tag,
        renotify: Boolean(tag),
        timestamp: Number(payload.timestamp) || Date.now(),
        data,
    };
    if (type === "incoming_call") {
        const callId = String(payload.data?.call_id || "");
        const chatId = String(payload.data?.chat_id || url.searchParams.get("chat") || "");
        const callURL = new URL("/app/", self.location.origin);
        callURL.search = new URLSearchParams({ signin: "1", tab: "chats", chat: chatId, call: callId }).toString();
        Object.assign(options, {
            tag: tag || `valid-call-${callId}`,
            renotify: true,
            requireInteraction: true,
            vibrate: [400, 200, 400, 200, 400, 200, 400],
            actions: [{ action: "answer", title: "Answer" }, { action: "decline", title: "Decline" }],
            data: { ...data, url: callURL.href, callId, chatId },
        });
    }
    await Promise.all([self.registration.showNotification(title, options), updateAppBadge(payload)]);
}

self.addEventListener("push", (event) => {
    let payload = {};
    try {
        payload = event.data?.json() || {};
    } catch (_) {
        payload = { body: event.data?.text() || "You have a new update." };
    }
    event.waitUntil(presentPush(payload));
});

async function appWindows() {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    return windows.filter((client) => {
        const url = new URL(client.url);
        return url.origin === self.location.origin && url.pathname.startsWith("/app/");
    }).sort((left, right) => Number(right.focused) - Number(left.focused)
        || Number(right.visibilityState === "visible") - Number(left.visibilityState === "visible"));
}

async function declineCall(data) {
    const [client] = await appWindows();
    // An open page declines with its signed-in API client.
    if (client) return client.postMessage({ type: "VALID_CALL_DECLINE", callId: data.callId, chatId: data.chatId });
    // Otherwise use the first-party session cookie: same-origin, never a stored token.
    if (!/^[\w-]{1,64}$/.test(data.callId || "")) return;
    const session = await fetch("/api/v1/auth/session", { credentials: "include", cache: "no-store" })
        .then((response) => response.ok ? response.json() : null).catch(() => null);
    const userId = session?.user?.id;
    if (!/^[\w-]{1,64}$/.test(String(userId || ""))) return;
    await fetch(`/api/v1/users/${encodeURIComponent(userId)}/calls/${encodeURIComponent(data.callId)}/decline`, {
        method: "POST", credentials: "include", headers: { Accept: "application/json" },
    }).catch(() => null);
}

async function openNotificationTarget(url) {
    const [client] = await appWindows();
    if (client) {
        // Route inside the running app instead of reloading it.
        client.postMessage({ type: "VALID_NOTIFICATION_CLICK", url });
        return client.focus();
    }
    return self.clients.openWindow(url);
}

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const data = event.notification.data || {};
    if (event.action === "decline") {
        event.waitUntil(declineCall(data));
        return;
    }
    event.waitUntil(openNotificationTarget(safeNotificationURL(data.url)));
});
