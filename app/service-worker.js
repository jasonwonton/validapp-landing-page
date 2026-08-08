const CACHE_NAME = "valid-web-v28";
const APP_SHELL = [
    "./",
    "./styles.css",
    "./app.js",
    "./api.js",
    "./demo-api.js",
    "./passkeys.js",
    "./manifest.webmanifest",
    "../assets/AppIconV2.png",
    "../assets/pwa/icon-192.png",
    "../assets/pwa/icon-512.png",
    "../assets/pwa/icon-maskable-512.png",
    "../assets/valid_logo.png",
    "../assets/Jua-Regular.ttf",
    "../assets/app/aura.png",
    "../assets/app/anonymous.png",
    "../assets/app/pencil-clipboard.png",
    "../assets/app/lock.png",
    "../assets/app/profile-at.svg",
    "../assets/app/profile-person-card.svg",
    "../assets/app/profile-school.svg",
    "../assets/app/profile-graduation-cap.svg",
];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                return response;
            })
            .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./")))
    );
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
    event.waitUntil(self.registration.showNotification(payload.title || "Valid", {
        body: payload.body || "You have a new update.",
        icon: "/assets/pwa/icon-192.png",
        tag,
        renotify: Boolean(tag),
        timestamp: Number(payload.timestamp) || Date.now(),
        data: { url: safeNotificationURL(payload.url) },
    }));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const url = safeNotificationURL(event.notification.data?.url);
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
