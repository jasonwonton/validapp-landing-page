const CACHE_PREFIX = "valid-web-";
const CACHE_NAME = `${CACHE_PREFIX}v106-d7acfab8902e78d5f9e5`;
// Every module the startup graph imports statically must be listed here, or the
// installed app cannot start offline; scripts/tests/service-worker-shell.test.mjs
// walks the import graph and enforces it. Dynamic imports that need the network
// anyway (the weekly game, LiveKit, the localhost-only demo) stay network-only.
const APP_SHELL = [
    "./",
    "/app/_static/d7acfab8902e78d5f9e5/styles.css",
    "/app/_static/d7acfab8902e78d5f9e5/preferences.js",
    "/app/_static/d7acfab8902e78d5f9e5/app.js",
    "/app/_static/d7acfab8902e78d5f9e5/api.js",
    "/app/_static/d7acfab8902e78d5f9e5/session-recovery.js",
    "/app/_static/d7acfab8902e78d5f9e5/passkeys.js",
    "/app/_static/d7acfab8902e78d5f9e5/auth-reliability.js",
    "/app/_static/d7acfab8902e78d5f9e5/auth-route-recovery.js",
    "/app/_static/d7acfab8902e78d5f9e5/auth-diagnostics.js",
    "/app/_static/d7acfab8902e78d5f9e5/performance.js",
    "/app/_static/d7acfab8902e78d5f9e5/keyed-list.js",
    "/app/_static/d7acfab8902e78d5f9e5/realtime-list.js",
    "/app/_static/d7acfab8902e78d5f9e5/runtime-style.js",
    "/app/_static/d7acfab8902e78d5f9e5/ui-icons.js",
    "/app/_static/d7acfab8902e78d5f9e5/media-url.js",
    "/app/_static/d7acfab8902e78d5f9e5/ui-dialogs.js",
    "/app/_static/d7acfab8902e78d5f9e5/toast.js",
    "/app/_static/d7acfab8902e78d5f9e5/user-message.js",
    "/app/_static/d7acfab8902e78d5f9e5/tbh-share.js",
    "/app/_static/d7acfab8902e78d5f9e5/blocked-users.js",
    "/app/_static/d7acfab8902e78d5f9e5/ios-install.js",
    "/app/_static/d7acfab8902e78d5f9e5/banner.js",
    "/app/_static/d7acfab8902e78d5f9e5/feed-sender.js",
    "/app/_static/d7acfab8902e78d5f9e5/media-overlay-positioner.js",
    "/app/_static/d7acfab8902e78d5f9e5/routes/route-loader.js",
    "/app/_static/d7acfab8902e78d5f9e5/routes/feed.js",
    "/app/_static/d7acfab8902e78d5f9e5/routes/play.js",
    "/app/_static/d7acfab8902e78d5f9e5/routes/chats.js",
    "/app/_static/d7acfab8902e78d5f9e5/routes/profile.js",
    "/app/_static/d7acfab8902e78d5f9e5/chat/styles.css",
    "/app/_static/d7acfab8902e78d5f9e5/chat/presence.js",
    "/app/_static/d7acfab8902e78d5f9e5/chat/activity-settings.js",
    "/app/_static/d7acfab8902e78d5f9e5/chat/index.js",
    "/app/_static/d7acfab8902e78d5f9e5/chat/actions.js",
    "/app/_static/d7acfab8902e78d5f9e5/chat/history.js",
    "/app/_static/d7acfab8902e78d5f9e5/chat/view-once.js",
    "/app/_static/d7acfab8902e78d5f9e5/chat/appearance.js",
    "/app/_static/d7acfab8902e78d5f9e5/chat/sticker-maker.js",
    "/app/_static/d7acfab8902e78d5f9e5/chat/photo-stickers.js",
    "/app/_static/d7acfab8902e78d5f9e5/chat/voice-interaction.js",
    "/app/_static/d7acfab8902e78d5f9e5/chat/message-window.js",
    "/app/_static/d7acfab8902e78d5f9e5/chat/timeline-scroll.js",
    "/app/_static/d7acfab8902e78d5f9e5/chat/models.js",
    "/app/_static/d7acfab8902e78d5f9e5/chat/call-history.js",
    "/app/_static/d7acfab8902e78d5f9e5/chat/store.js",
    "/app/_static/d7acfab8902e78d5f9e5/chat/media.js",
    "/app/_static/d7acfab8902e78d5f9e5/chat/outbox.js",
    "/app/_static/d7acfab8902e78d5f9e5/chat/thumbhash.js",
    "/app/_static/d7acfab8902e78d5f9e5/chat/realtime.js",
    "/app/_static/d7acfab8902e78d5f9e5/calls/service.js",
    "/app/_static/d7acfab8902e78d5f9e5/stories/index.js",
    "/app/_static/d7acfab8902e78d5f9e5/stories/styles.css",
    "/app/_static/d7acfab8902e78d5f9e5/calls/styles.css",
    "/app/_static/d7acfab8902e78d5f9e5/comments/index.js",
    "/app/_static/d7acfab8902e78d5f9e5/comments/styles.css",
    "./manifest.webmanifest",
    "../assets/AppIconV2.png",
    "../assets/pwa/icon-192.png",
    "../assets/pwa/icon-512.png",
    "../assets/pwa/icon-maskable-512.png",
    "../assets/valid_logo.png",
    "../assets/Jua-Latin.woff2",
    "/app/_static/d7acfab8902e78d5f9e5/local-config.js",
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

// Background Sync (Android Chrome): when connectivity returns, ask open pages
// to drain the chat/Story/Memento media outbox. The upload itself stays in the
// page, which holds the session and the IndexedDB records.
self.addEventListener("sync", (event) => {
    if (event.tag !== "valid-media-outbox") return;
    event.waitUntil(self.clients.matchAll({ type: "window" }).then((clients) => {
        for (const client of clients) client.postMessage({ type: "valid-media-outbox-sync" });
    }));
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
