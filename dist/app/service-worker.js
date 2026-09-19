const CACHE_PREFIX = "valid-web-";
const CACHE_NAME = `${CACHE_PREFIX}v103-973ed0a8789c203b69bf`;
const APP_SHELL = [
    "./",
    "/app/_static/973ed0a8789c203b69bf/styles.css",
    "/app/_static/973ed0a8789c203b69bf/preferences.js",
    "/app/_static/973ed0a8789c203b69bf/app.js",
    "/app/_static/973ed0a8789c203b69bf/api.js",
    "/app/_static/973ed0a8789c203b69bf/session-recovery.js",
    "/app/_static/973ed0a8789c203b69bf/demo-api.js",
    "/app/_static/973ed0a8789c203b69bf/passkeys.js",
    "/app/_static/973ed0a8789c203b69bf/auth-reliability.js",
    "/app/_static/973ed0a8789c203b69bf/auth-route-recovery.js",
    "/app/_static/973ed0a8789c203b69bf/auth-diagnostics.js",
    "/app/_static/973ed0a8789c203b69bf/performance.js",
    "/app/_static/973ed0a8789c203b69bf/keyed-list.js",
    "/app/_static/973ed0a8789c203b69bf/realtime-list.js",
    "/app/_static/973ed0a8789c203b69bf/runtime-style.js",
    "/app/_static/973ed0a8789c203b69bf/camera-effects.js",
    "/app/_static/973ed0a8789c203b69bf/ui-icons.js",
    "/app/_static/973ed0a8789c203b69bf/tbh-share.js",
    "/app/_static/973ed0a8789c203b69bf/feed-sender.js",
    "/app/_static/973ed0a8789c203b69bf/live-camera.js",
    "/app/_static/973ed0a8789c203b69bf/media-overlay-positioner.js",
    "/app/_static/973ed0a8789c203b69bf/routes/route-loader.js",
    "/app/_static/973ed0a8789c203b69bf/routes/feed.js",
    "/app/_static/973ed0a8789c203b69bf/routes/play.js",
    "/app/_static/973ed0a8789c203b69bf/routes/chats.js",
    "/app/_static/973ed0a8789c203b69bf/routes/profile.js",
    "/app/_static/973ed0a8789c203b69bf/chat/styles.css",
    "/app/_static/973ed0a8789c203b69bf/chat/presence.js",
    "/app/_static/973ed0a8789c203b69bf/chat/activity-settings.js",
    "/app/_static/973ed0a8789c203b69bf/chat/index.js",
    "/app/_static/973ed0a8789c203b69bf/chat/actions.js",
    "/app/_static/973ed0a8789c203b69bf/chat/appearance.js",
    "/app/_static/973ed0a8789c203b69bf/chat/sticker-maker.js",
    "/app/_static/973ed0a8789c203b69bf/chat/photo-stickers.js",
    "/app/_static/973ed0a8789c203b69bf/chat/voice-interaction.js",
    "/app/_static/973ed0a8789c203b69bf/chat/message-window.js",
    "/app/_static/973ed0a8789c203b69bf/chat/timeline-scroll.js",
    "/app/_static/973ed0a8789c203b69bf/chat/models.js",
    "/app/_static/973ed0a8789c203b69bf/chat/call-history.js",
    "/app/_static/973ed0a8789c203b69bf/chat/store.js",
    "/app/_static/973ed0a8789c203b69bf/chat/media.js",
    "/app/_static/973ed0a8789c203b69bf/chat/outbox.js",
    "/app/_static/973ed0a8789c203b69bf/calls/index.js",
    "/app/_static/973ed0a8789c203b69bf/calls/ringback.js",
    "/app/_static/973ed0a8789c203b69bf/stories/index.js",
    "/app/_static/973ed0a8789c203b69bf/stories/styles.css",
    "/app/_static/973ed0a8789c203b69bf/calls/styles.css",
    "/app/_static/973ed0a8789c203b69bf/comments/index.js",
    "/app/_static/973ed0a8789c203b69bf/comments/styles.css",
    "./manifest.webmanifest",
    "../assets/AppIconV2.png",
    "../assets/pwa/icon-192.png",
    "../assets/pwa/icon-512.png",
    "../assets/pwa/icon-maskable-512.png",
    "../assets/valid_logo.png",
    "../assets/Jua-Latin.woff2",
    "/app/_static/973ed0a8789c203b69bf/local-config.js",
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

self.addEventListener("push", (event) => {
    let payload = {};
    try {
        payload = event.data?.json() || {};
    } catch (_) {
        payload = { body: event.data?.text() || "You have a new update." };
    }
    const tag = typeof payload.tag === "string" && payload.tag.trim() ? payload.tag.trim() : undefined;
    const incomingCall = payload.data?.type === "incoming_call";
    event.waitUntil(self.registration.showNotification(payload.title || "Valid", {
        body: payload.body || "You have a new update.",
        icon: "/assets/pwa/icon-192.png",
        badge: "/assets/pwa/icon-192.png",
        tag,
        renotify: Boolean(tag),
        timestamp: Number(payload.timestamp) || Date.now(),
        actions: incomingCall
            ? [{ action: "open", title: "Open call" }]
            : [{ action: "open", title: "Open Valid" }, { action: "play", title: "Play" }],
        data: { url: safeNotificationURL(payload.url) },
    }));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const url = event.action === "play"
        ? safeNotificationURL("/app/?tab=play")
        : safeNotificationURL(event.notification.data?.url);
    event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
        for (const client of clients) {
            const clientURL = new URL(client.url);
            if (clientURL.origin !== self.location.origin || !clientURL.pathname.startsWith("/app/")) continue;
            client.postMessage({ type: "VALID_NOTIFICATION_CLICK", url });
            return client.focus();
        }
        return self.clients.openWindow(url);
    }));
});
