import { test } from "node:test";
import assert from "node:assert/strict";
import { chatDayLabel, chatSeparatorBefore, linkifyChatText, messageDateTime } from "../../app/chat/models.js";
import { base64Bytes, thumbHashAspectRatio, thumbHashToRGBA } from "../../app/chat/thumbhash.js";
import { createIngest, uploadIngest, waitForIngest } from "../../app/media-ingest.js";
import { createChatRealtime } from "../../app/chat/realtime.js";

test("links: only http(s) and www become anchors, text stays escaped", () => {
    assert.equal(linkifyChatText("see https://example.com/a?b=1."),
        'see <a href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer">https://example.com/a?b=1</a>.');
    assert.equal(linkifyChatText("(www.valid.lol)"),
        '(<a href="https://www.valid.lol/" target="_blank" rel="noopener noreferrer">www.valid.lol</a>)');
    assert.equal(linkifyChatText("javascript:alert(1) <img src=x>"), "javascript:alert(1) &lt;img src=x&gt;");
    assert.equal(linkifyChatText('https://a.example/"onmouseover=1'), '<a href="https://a.example/" target="_blank" rel="noopener noreferrer">https://a.example/</a>&quot;onmouseover=1');
    assert.equal(linkifyChatText("https://user:pass@evil.example"), "https://user:pass@evil.example");
    assert.match(linkifyChatText("https://en.wikipedia.org/wiki/Foo_(bar)"), />https:\/\/en\.wikipedia\.org\/wiki\/Foo_\(bar\)</);
});

test("separators: first message, new local day, and gaps of an hour or more", () => {
    const now = new Date();
    const at = (hoursAgo) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
    assert.equal(chatDayLabel(now, now), "Today");
    assert.equal(chatDayLabel(new Date(now.getTime() - 86_400_000), now), "Yesterday");
    assert.ok(chatSeparatorBefore({ created_at: at(0) }, null));
    const noon = new Date(now); noon.setHours(12, 0, 0, 0);
    const later = (minutes) => ({ created_at: new Date(noon.getTime() + minutes * 60_000).toISOString() });
    assert.equal(chatSeparatorBefore(later(59), later(0)), null);
    assert.ok(chatSeparatorBefore(later(60), later(0)));
    assert.equal(chatSeparatorBefore({ ...later(120), delivery_state: "sending" }, later(0)), null);
    assert.match(messageDateTime(now.toISOString(), now), /^Today at /);
});

test("thumbhash: decodes the reference hash, rejects malformed input", () => {
    const bytes = base64Bytes("1QcSHQRnh493V4dIh4eXh1h4kJUI");
    assert.ok(bytes);
    const image = thumbHashToRGBA(bytes);
    assert.equal(image.width, 23);
    assert.equal(image.height, 32);
    assert.equal(image.rgba.length, 23 * 32 * 4);
    assert.ok(Math.abs(thumbHashAspectRatio(bytes) - 5 / 7) < 1e-9);
    assert.equal(base64Bytes("not base64!"), null);
    assert.equal(thumbHashToRGBA(new Uint8Array([1, 2, 3])), null);
    assert.equal(thumbHashToRGBA(bytes.slice(0, 6)), null, "Truncated AC data is refused, never read out of bounds");
});

test("ingest: create, PUT with the base content type, finalize, poll until ready", async () => {
    const calls = [];
    const api = {
        request: async (path, options = {}) => {
            calls.push([options.method || "GET", path, options.body ? JSON.parse(options.body) : null]);
            if (path.endsWith("/media-ingests")) return { ingest_id: "i1", state: "upload_pending", upload_url: "https://r2.example/put", upload_method: "PUT", required_headers: { "Content-Type": "audio/webm", "Cache-Control": "private, max-age=300" } };
            if (path.endsWith("/finalize")) return { ingest_id: "i1", state: "processing", poll_after_ms: 2000 };
            const polls = calls.filter(([method, url]) => method === "GET" && url.endsWith("/i1")).length;
            return polls < 2 ? { ingest_id: "i1", state: "processing", poll_after_ms: 2000 } : { ingest_id: "i1", state: "ready", segments: [{ media_asset_id: "asset-1", content_type: "audio/mp4" }] };
        },
        putDirectUpload: async (file, session) => calls.push(["PUT", session.upload_url, session.required_headers]),
    };
    const file = new Blob(["x"], { type: "audio/webm;codecs=opus" });
    const ingest = await createIngest(api, "u1", { contentType: file.type, sizeBytes: 1, durationMs: 1200, clientRequestId: "req-1" });
    const finalized = await uploadIngest(api, "u1", ingest, file);
    const waits = [];
    const ready = await waitForIngest(api, "u1", ingest.ingest_id, { initial: finalized, sleep: async (ms) => { waits.push(ms); } });
    assert.deepEqual(calls[0], ["POST", "/users/u1/media-ingests", { purpose: "chat", content_type: "audio/webm;codecs=opus", size_bytes: 1, view_once: false, client_request_id: "req-1", duration_ms: 1200 }]);
    assert.deepEqual(calls[1], ["PUT", "https://r2.example/put", { "Content-Type": "audio/webm", "Cache-Control": "private, max-age=300" }]);
    assert.equal(calls[2][1], "/users/u1/media-ingests/i1/finalize");
    assert.equal(ready.segments[0].media_asset_id, "asset-1");
    assert.deepEqual(waits, [2000, 2000]);
    await assert.rejects(waitForIngest(api, "u1", "i1", { initial: { state: "failed", failure_code: "media_too_long", failure_message: "Too long" } }), { message: "Too long", code: "media_too_long" });
});

test("realtime: one stream while visible, closed while hidden, capped jittered backoff", () => {
    const sources = [];
    globalThis.EventSource = class {
        constructor(url) { this.url = url; this.readyState = 1; this.listeners = {}; sources.push(this); }
        addEventListener(type, callback) { this.listeners[type] = callback; }
        close() { this.closed = true; }
    };
    const doc = new EventTarget(); doc.hidden = false;
    const win = new EventTarget(); win.navigator = { onLine: true };
    const timers = [];
    const realtime = createChatRealtime({
        api: { chatEventsURL: (id) => `/events/${id}` }, getUserId: () => "u1", doc, win, random: () => 1,
        schedule: (callback, ms) => { timers.push({ callback, ms }); return timers.length; }, cancel: () => {},
    });
    const events = [];
    realtime.subscribe((event) => events.push(event.type));
    realtime.start();
    realtime.start();
    assert.equal(sources.length, 1);
    sources[0].listeners.chat({ data: JSON.stringify({ type: "ready" }), lastEventId: "" });
    assert.deepEqual(events, ["ready"]);
    doc.hidden = true; doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(sources[0].closed, true);
    doc.hidden = false; doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(sources.length, 2);
    // Fatal errors back off exponentially (full jitter up to the ceiling), capped at 120 s.
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const current = sources.at(-1);
        current.readyState = 2;
        current.onerror();
        timers.at(-1).callback();
    }
    assert.deepEqual(timers.map(({ ms }) => ms), [1000, 2000, 4000, 8000, 16000, 32000, 64000, 120000, 120000, 120000]);
    realtime.stop();
    delete globalThis.EventSource;
});
