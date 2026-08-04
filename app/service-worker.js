const CACHE_NAME = "valid-web-v11";
const APP_SHELL = [
    "./",
    "./styles.css",
    "./app.js",
    "./api.js",
    "./demo-api.js",
    "./passkeys.js",
    "./manifest.webmanifest",
    "../assets/AppIconV2.png",
    "../assets/valid_logo.png",
    "../assets/Jua-Regular.ttf",
    "../assets/app/aura.png",
    "../assets/app/anonymous.png",
    "../assets/app/pencil-clipboard.png",
    "../assets/app/lock.png",
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
