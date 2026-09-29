import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../../app/service-worker.js", import.meta.url), "utf8");
const ORIGIN = "https://validapp.lol";
const R2 = "https://9472d27fa2e1a3762bd91728bb7d9437.r2.cloudflarestorage.com/six7-private-media";
const signed = (key, signature = "abc") => `${R2}/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=900&X-Amz-Signature=${signature}`;

function response({ type = "opaque", ok = false, cacheControl = null, body = "bytes" } = {}) {
    return { type, ok, body, headers: { get: (name) => (name === "cache-control" ? cacheControl : null) }, clone() { return response({ type, ok, cacheControl, body }); } };
}

function harness({ network = () => response() } = {}) {
    const listeners = {};
    const stores = new Map();
    const fetched = [];
    const caches = {
        async open(name) {
            if (!stores.has(name)) stores.set(name, new Map());
            const entries = stores.get(name);
            return {
                async match(key) { return entries.get(String(key)) || undefined; },
                async put(key, value) { entries.delete(String(key)); entries.set(String(key), value); },
                async delete(key) { return entries.delete(String(key)); },
                async keys() { return [...entries.keys()]; },
                async addAll() {},
            };
        },
        async delete(name) { return stores.delete(name); },
        async keys() { return [...stores.keys()]; },
    };
    const self = { location: { origin: ORIGIN }, addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); }, clients: { claim() {}, matchAll: async () => [] }, registration: {} };
    const fetch = async (request) => { fetched.push(request.url); return network(request); };
    vm.runInNewContext(source, { self, URL, URLSearchParams, fetch, caches, queueMicrotask, indexedDB: {} });

    async function get(url, { destination = "image", mode = "no-cors", cache = "default", range = false } = {}) {
        const request = { url, method: "GET", destination, mode, cache, headers: { has: (name) => range && name === "range" } };
        let responded = null;
        const waits = [];
        for (const listener of listeners.fetch) listener({ request, respondWith: (promise) => { responded = promise; }, waitUntil: (promise) => waits.push(promise) });
        const result = responded ? await responded : null;
        await Promise.all(waits);
        return result;
    }
    async function message(data) {
        const waits = [];
        for (const listener of listeners.message) listener({ data, source: { id: "client" }, waitUntil: (promise) => waits.push(promise) });
        await Promise.all(waits);
    }
    const mediaKeys = () => [...(stores.get("valid-media-v1")?.keys() || [])];
    return { get, message, fetched, mediaKeys, stores };
}

test("a decoded chat photo is cached without its signature and served for a fresh signed URL", async () => {
    const worker = harness();
    const first = signed("chat-attachments/u1/a1/photo.jpeg", "first");
    await worker.get(first);
    assert.deepEqual(worker.mediaKeys(), [], "nothing is stored before the page confirms the image decoded");
    await worker.message({ type: "VALID_MEDIA_LOADED", url: first });
    assert.deepEqual(worker.mediaKeys(), [`${R2}/chat-attachments/u1/a1/photo.jpeg`]);
    const again = await worker.get(signed("chat-attachments/u1/a1/photo.jpeg", "second"));
    assert.equal(again.body, "bytes");
    assert.equal(worker.fetched.length, 1, "the re-signed URL is answered from the cache");
});

test("an image the page never confirms (expired signature, error page) is never stored", async () => {
    const worker = harness();
    await worker.get(signed("stories/o1/a1/media.jpeg"));
    await worker.message({ type: "VALID_MEDIA_LOADED", url: signed("stories/o1/other/media.jpeg") });
    assert.deepEqual(worker.mediaKeys(), []);
});

test("thumbnails, posters, Mementos and avatars are cached; view-once, video, voice and API JSON are not", async () => {
    const worker = harness();
    const cacheable = [
        signed("chat-attachments/u1/a2/thumbnail.jpeg"),
        signed("chat-daily/u1/m1/memento.jpeg"),
        signed("stories/o1/a2/thumbnail.jpeg"),
        "https://validappcdn.com/profile-pictures/u1.jpg",
    ];
    for (const url of cacheable) {
        assert.ok(await worker.get(url), url);
        await worker.message({ type: "VALID_MEDIA_LOADED", url });
    }
    assert.equal(worker.mediaKeys().length, cacheable.length);

    const before = worker.fetched.length;
    const skipped = [
        [signed("chat-ephemeral/u1/a3/photo.jpeg"), {}],
        [signed("chat-attachments/u1/a4/video.mp4"), { destination: "video" }],
        [signed("chat-attachments/u1/a4/thumbnail.jpeg"), { range: true }],
        [signed("chat-attachments/u1/a5/voice.m4a"), { destination: "audio" }],
        [signed("chat-attachments/u1/a6/photo.jpeg"), { mode: "cors" }],
        [signed("chat-attachments/u1/a7/photo.jpeg"), { cache: "no-store" }],
        [`${ORIGIN}/api/v1/users/u1/chats`, { destination: "" }],
        [`${ORIGIN}/api/v1/media/profile-pictures/u1.jpg`, {}],
        ["https://media.six7.lol/profile-pictures/u1.jpg", {}],
        ["https://example.com/stories/o1/a1/media.jpeg", {}],
    ];
    for (const [url, options] of skipped) {
        assert.equal(await worker.get(url, options), null, `${url} must stay on the network`);
        await worker.message({ type: "VALID_MEDIA_LOADED", url });
    }
    assert.equal(worker.fetched.length, before, "skipped requests are not even intercepted");
    assert.equal(worker.mediaKeys().length, cacheable.length);
});

test("a readable no-store or failed response is not cached", async () => {
    const worker = harness({ network: (request) => request.url.includes("nostore") ? response({ type: "cors", ok: true, cacheControl: "no-store" }) : response({ type: "cors", ok: false }) });
    for (const key of ["stories/o1/nostore/media.jpeg", "stories/o1/failed/media.jpeg"]) {
        await worker.get(signed(key));
        await worker.message({ type: "VALID_MEDIA_LOADED", url: signed(key) });
    }
    assert.deepEqual(worker.mediaKeys(), []);
});

test("the cache is bounded and evicts the least recently used photo", async () => {
    const worker = harness();
    const url = (index) => signed(`chat-attachments/u1/a${index}/photo.jpeg`);
    for (let index = 0; index < 160; index++) {
        await worker.get(url(index));
        await worker.message({ type: "VALID_MEDIA_LOADED", url: url(index) });
    }
    await worker.get(url(0)); // a hit makes photo 0 recent again
    await worker.get(url(160));
    await worker.message({ type: "VALID_MEDIA_LOADED", url: url(160) });
    const keys = worker.mediaKeys();
    assert.equal(keys.length, 160);
    assert.ok(keys.includes(`${R2}/chat-attachments/u1/a0/photo.jpeg`), "recently used photo survives");
    assert.ok(!keys.includes(`${R2}/chat-attachments/u1/a1/photo.jpeg`), "least recently used photo is evicted");
});

test("signing out deletes the media cache but keeps the app shell", async () => {
    const worker = harness();
    await worker.get(signed("stories/o1/a1/media.jpeg"));
    await worker.message({ type: "VALID_MEDIA_LOADED", url: signed("stories/o1/a1/media.jpeg") });
    assert.equal(worker.mediaKeys().length, 1);
    worker.stores.set("valid-web-v106", new Map([["./", response()]]));
    await worker.message({ type: "VALID_CLEAR_MEDIA_CACHE" });
    assert.equal(worker.stores.has("valid-media-v1"), false);
    assert.equal(worker.stores.has("valid-web-v106"), true);
});
