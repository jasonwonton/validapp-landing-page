const CACHE_PREFIX = "valid-web-";
const CACHE_NAME = `${CACHE_PREFIX}v112`;
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
    "./ui-icons.js",
    "./media-url.js",
    "./ui-dialogs.js",
    "./toast.js",
    "./user-message.js",
    "./tbh-share.js",
    "./blocked-users.js",
    "./ios-install.js",
    "./banner.js",
    "./feed-sender.js",
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
    "./live-camera.js",
    "./camera/review-editor.js",
    "./camera/photo-pipeline.js",
    "./camera/review-filters.js",
    "./camera-effects.js",
    "./thumbhash.js",
    "./chat/outbox.js",
    "./chat/thumbhash.js",
    "./chat/realtime.js",
    "./calls/service.js",
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
    const mediaKey = mediaCacheKey(event.request);
    if (mediaKey) {
        event.respondWith(cachedMedia(event, mediaKey));
        return;
    }
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

// Runtime media cache: chat photos, Mementos, Story photos, thumbnails, video
// posters and avatars, so reopening a chat or Story doesn't download them again
// and they still show offline. Entries are keyed by host + path only, because
// the signed query (X-Amz-Signature, expiry) changes on every API response
// while the object doesn't. Never cached: API JSON (/api/ is not a media host),
// view-once media (chat-ephemeral/), videos and voice (destination isn't
// "image"), range requests, and anything requested or served as no-store.
// Bounded to MEDIA_CACHE_MAX_ENTRIES (≈100 MB at a typical ≈600 KB chat
// photo) and trimmed least-recently-used first. Its name has no CACHE_PREFIX,
// so an app update keeps it; signing out deletes it (VALID_CLEAR_MEDIA_CACHE).
const MEDIA_CACHE = "valid-media-v1";
const MEDIA_CACHE_MAX_ENTRIES = 160;
// Only hosts this worker's CSP connect-src allows it to fetch.
const MEDIA_HOSTS = new Set(["9472d27fa2e1a3762bd91728bb7d9437.r2.cloudflarestorage.com", "validappcdn.com"]);
const MEDIA_OBJECT = /\/(chat-attachments|chat-daily|stories|profile-pictures)\/[^?#]+\.(jpe?g|png|webp)$/i;
// Cross-origin <img> responses are opaque: their status can't be read, so an
// expired-signature error would look like a photo. A response waits here until
// the page reports that the image decoded (VALID_MEDIA_LOADED), then is stored.
const pendingMedia = new Map();
const MAX_PENDING_MEDIA = 24;
const touchedMedia = new Set();

function mediaURLKey(value) {
    let url;
    try { url = new URL(value); } catch (_) { return null; }
    if (url.protocol !== "https:" || !MEDIA_HOSTS.has(url.hostname) || url.pathname.includes("/chat-ephemeral/")) return null;
    return MEDIA_OBJECT.test(url.pathname) ? `${url.origin}${url.pathname}` : null;
}

function mediaCacheKey(request) {
    // A cached opaque response can only answer a no-cors request (an <img>);
    // canvas and share-card loads (cors) always go to the network.
    if (request.method !== "GET" || request.destination !== "image" || request.mode !== "no-cors"
        || request.cache === "no-store" || request.headers.has("range")) return null;
    return mediaURLKey(request.url);
}

function storable(response) {
    if (response.type === "opaque") return true;
    return response.ok && !/no-store/i.test(response.headers.get("cache-control") || "");
}

async function cachedMedia(event, key) {
    const cache = await caches.open(MEDIA_CACHE).catch(() => null);
    const cached = await cache?.match(key).catch(() => null);
    if (cached) {
        // Approximate LRU: move a hit to the young end once per worker lifetime.
        if (!touchedMedia.has(key)) {
            touchedMedia.add(key);
            const copy = cached.clone();
            event.waitUntil(cache.delete(key).then(() => cache.put(key, copy)).catch(() => null));
        }
        return cached;
    }
    const response = await fetch(event.request);
    if (cache && storable(response)) {
        pendingMedia.delete(key);
        pendingMedia.set(key, response.clone());
        while (pendingMedia.size > MAX_PENDING_MEDIA) pendingMedia.delete(pendingMedia.keys().next().value);
    }
    return response;
}

async function storeLoadedMedia(value) {
    const key = mediaURLKey(value);
    const response = key && pendingMedia.get(key);
    if (!response) return;
    pendingMedia.delete(key);
    try {
        const cache = await caches.open(MEDIA_CACHE);
        await cache.put(key, response);
        const keys = await cache.keys();
        for (const stale of keys.slice(0, Math.max(0, keys.length - MEDIA_CACHE_MAX_ENTRIES))) await cache.delete(stale);
    } catch (_) {
        // Out of quota: showing media never depends on caching it.
    }
}

self.addEventListener("message", (event) => {
    if (event.data?.type === "VALID_MEDIA_LOADED") event.waitUntil(storeLoadedMedia(event.data.url));
    else if (event.data?.type === "VALID_CLEAR_MEDIA_CACHE") {
        pendingMedia.clear();
        touchedMedia.clear();
        event.waitUntil(caches.delete(MEDIA_CACHE).catch(() => null));
    }
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

async function showSuppressedOnWebKit(title, data) {
    if (!appleWebKit()) return;
    const shown = `valid-suppressed-${Date.now()}`;
    await self.registration.showNotification(title, { body: "", tag: shown, silent: true, data });
    (await self.registration.getNotifications({ tag: shown })).forEach((notification) => notification.close());
}

// A visible Valid window rings in the page itself (calls/index.js), so the
// worker hands the call to it instead of showing a second, system ringer.
async function visibleAppWindow() {
    return (await appWindows()).find((client) => client.visibilityState === "visible") || null;
}

const callTag = (callId) => `valid-call-${callId}`;

async function closeCallNotifications(callId) {
    if (!callId) return;
    (await self.registration.getNotifications({ tag: callTag(callId) })).forEach((notification) => notification.close());
}

// call_ended: the ring stopped for this person (answered or declined on any
// device, or missed). With Valid on screen the ringing notification is just
// closed; otherwise the server's quiet notice replaces it under the same tag
// (every push must show something, or Safari/Firefox withdraw the
// subscription and Chrome shows a generic one). Replacing by tag instead of
// closing first matters: Chrome keys persistent notifications by tag, so a
// close() still in flight could dismiss the replacement.
async function presentCallEnded(payload, url) {
    const callId = String(payload.data?.call_id || "");
    const chatId = String(payload.data?.chat_id || url.searchParams.get("chat") || "");
    for (const client of await appWindows()) client.postMessage({ type: "VALID_CALL_ENDED", callId, chatId, reason: payload.data?.reason || "" });
    const title = payload.title || "Valid";
    const data = { url: url.href, type: "call_ended", callId, chatId };
    if (await visibleAppWindow()) {
        await closeCallNotifications(callId);
        return showSuppressedOnWebKit(title, data);
    }
    await self.registration.showNotification(title, {
        body: payload.body || "",
        icon: "/assets/pwa/icon-192.png",
        badge: "/assets/pwa/badge-96.png",
        tag: callId ? callTag(callId) : undefined,
        renotify: false,
        silent: true,
        timestamp: Number(payload.timestamp) || Date.now(),
        data,
    });
}

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
            return showSuppressedOnWebKit(title, data);
        }
    }
    if (type === "call_ended") return presentCallEnded(payload, url);

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
        const callId = String(payload.data?.call_id || url.searchParams.get("call") || "");
        const chatId = String(payload.data?.chat_id || url.searchParams.get("chat") || "");
        const callURL = new URL("/app/", self.location.origin);
        callURL.search = new URLSearchParams({ signin: "1", tab: "chats", chat: chatId, call: callId }).toString();
        const page = await visibleAppWindow();
        if (page) {
            // The page's own ringer (with sound) takes it from here.
            page.postMessage({ type: "VALID_INCOMING_CALL", callId, chatId });
            return showSuppressedOnWebKit(title, data);
        }
        Object.assign(options, {
            tag: tag || callTag(callId),
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
    await closeCallNotifications(data.callId);
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
    const target = new URL(safeNotificationURL(data.url));
    // Answer joins straight away; a tap on the ringing notification itself
    // opens the in-app ringer so the person can still choose.
    if (event.action === "answer" && data.callId) target.searchParams.set("answer", "1");
    event.waitUntil(openNotificationTarget(target.href));
});
