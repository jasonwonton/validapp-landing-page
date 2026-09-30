import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../../app/service-worker.js", import.meta.url), "utf8");
const ORIGIN = "https://validapp.lol";
// Values created inside the worker's vm realm have foreign prototypes.
const plain = (value) => JSON.parse(JSON.stringify(value));

function harness({ clients = [], userAgent = "Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile", fetch = async () => ({ ok: false }) } = {}) {
    const listeners = {};
    const shown = [];
    const badges = [];
    const opened = [];
    const kv = new Map();
    // A tiny in-memory IndexedDB stand-in: one object store, get/put only.
    const indexedDB = {
        open() {
            const request = {};
            queueMicrotask(() => {
                request.result = {
                    close() {},
                    transaction() {
                        const transaction = {};
                        transaction.objectStore = () => ({
                            get(key) { const r = { result: kv.get(key) }; queueMicrotask(() => transaction.oncomplete?.()); return r; },
                            put(value, key) { kv.set(key, value); const r = {}; queueMicrotask(() => transaction.oncomplete?.()); return r; },
                        });
                        return transaction;
                    },
                };
                request.onsuccess?.();
            });
            return request;
        },
    };
    const self = {
        location: { origin: ORIGIN },
        navigator: { userAgent, setAppBadge: async (count) => badges.push(count), clearAppBadge: async () => badges.push(0) },
        addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); },
        skipWaiting() {},
        registration: {
            showNotification: async (title, options) => { shown.push({ title, ...options }); },
            getNotifications: async ({ tag }) => shown.filter((n) => n.tag === tag).map((n) => ({ close() { n.closed = true; } })),
        },
        clients: {
            matchAll: async () => clients,
            openWindow: async (url) => opened.push(url),
        },
    };
    vm.runInNewContext(source, { self, URL, URLSearchParams, indexedDB, fetch, queueMicrotask, caches: { open: async () => ({}) } });
    const fire = async (name, event) => {
        const waits = [];
        for (const listener of listeners[name] || []) listener({ ...event, waitUntil: (promise) => waits.push(promise) });
        await Promise.all(waits);
    };
    return {
        shown, badges, opened,
        push: (payload) => fire("push", { data: { json: () => payload, text: () => JSON.stringify(payload) } }),
        click: (notification, action = "") => fire("notificationclick", { action, notification: { ...notification, close() {} } }),
        message: (data, sourceId) => fire("message", { data, source: { id: sourceId } }),
    };
}

function client(id, url, { focused = true, visible = true } = {}) {
    const messages = [];
    return { id, url: `${ORIGIN}${url}`, focused, visibilityState: visible ? "visible" : "hidden", messages,
        postMessage: (message) => messages.push(message), focus: async () => true };
}

test("notifications use the monochrome badge, the payload tag, and no generic actions", async () => {
    const worker = harness();
    await worker.push({ title: "Maya commented on a poll", body: "lol", type: "poll_commented", url: "/app/?signin=1&notification=feed_item&question_answer_id=9", tag: "valid-poll_commented-9" });
    const [notification] = worker.shown;
    assert.equal(notification.badge, "/assets/pwa/badge-96.png");
    assert.equal(notification.icon, "/assets/pwa/icon-192.png");
    assert.equal(notification.tag, "valid-poll_commented-9");
    assert.equal(notification.renotify, true);
    assert.equal(notification.actions, undefined);
    assert.equal(notification.data.url, `${ORIGIN}/app/?signin=1&notification=feed_item&question_answer_id=9`);
    assert.doesNotMatch(source, /Open Valid|title: "Play"/);
});

test("a push increments the home-screen badge from the page's last count, or uses the server count", async () => {
    const worker = harness();
    await worker.message({ type: "VALID_BADGE_SYNC", count: 4 }, "page");
    await worker.push({ title: "t", type: "vote_reacted", url: "/app/" });
    await worker.push({ title: "t", type: "vote_reacted", url: "/app/" });
    assert.deepEqual(worker.badges, [5, 6]);
    await worker.push({ title: "t", type: "vote_reacted", url: "/app/", data: { badge: 2 } });
    assert.equal(worker.badges.at(-1), 2);
});

test("incoming calls ring until answered or declined", async () => {
    const worker = harness();
    await worker.push({ title: "Maya", body: "Incoming voice call", type: "incoming_call", url: "/app/?signin=1&tab=chats&chat=c1", data: { type: "incoming_call", call_id: "call-7", chat_id: "c1" } });
    const [notification] = worker.shown;
    assert.equal(notification.requireInteraction, true);
    assert.ok(notification.vibrate.length >= 3);
    assert.deepEqual(plain(notification.actions.map((action) => action.action)), ["answer", "decline"]);
    assert.equal(notification.tag, "valid-call-call-7");
    const url = new URL(notification.data.url);
    assert.equal(url.searchParams.get("call"), "call-7");
    assert.equal(url.searchParams.get("chat"), "c1");
});

test("a visible Valid window rings in the page instead of a second system ringer", async () => {
    const page = client("a", "/app/?tab=feed", { focused: false, visible: true });
    const worker = harness({ clients: [page] });
    await worker.push({ title: "Maya is calling", body: "Incoming voice call", type: "incoming_call", url: "/app/?signin=1&tab=chats&chat=c1&call=call-7", tag: "valid-call-call-7", data: { type: "incoming_call", call_id: "call-7", chat_id: "c1" } });
    assert.equal(worker.shown.length, 0);
    assert.deepEqual(plain(page.messages), [{ type: "VALID_INCOMING_CALL", callId: "call-7", chatId: "c1" }]);

    // A hidden window (locked phone, background tab) still gets the system ringer.
    const hidden = harness({ clients: [client("b", "/app/?tab=feed", { focused: false, visible: false })] });
    await hidden.push({ title: "Maya is calling", type: "incoming_call", url: "/app/?signin=1&tab=chats&chat=c1&call=call-7", data: { call_id: "call-7", chat_id: "c1" } });
    assert.equal(hidden.shown.length, 1);
    assert.equal(hidden.shown[0].requireInteraction, true);

    // Safari must still show something for every push.
    const safari = harness({ clients: [client("c", "/app/")], userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" });
    await safari.push({ title: "Maya is calling", type: "incoming_call", data: { call_id: "call-7", chat_id: "c1" } });
    assert.equal(safari.shown.length, 1);
    assert.equal(safari.shown[0].silent, true);
    assert.equal(safari.shown[0].closed, true);
});

test("call_ended swaps the ringing notification for a quiet notice under the same tag", async () => {
    const worker = harness();
    await worker.push({ title: "Maya is calling", body: "Incoming voice call", type: "incoming_call", url: "/app/?signin=1&tab=chats&chat=c1&call=call-7", tag: "valid-call-call-7", data: { type: "incoming_call", call_id: "call-7", chat_id: "c1" } });
    await worker.push({ title: "Maya", body: "Missed voice call", type: "call_ended", url: "/app/?signin=1&tab=chats&chat=c1", tag: "valid-call-call-7", data: { type: "call_ended", call_id: "call-7", chat_id: "c1", reason: "missed" } });
    const [ringing, ended] = worker.shown;
    // Replaced through the shared tag, never closed first (see presentCallEnded).
    assert.equal(ringing.closed, undefined);
    assert.equal(ended.title, "Maya");
    assert.equal(ended.body, "Missed voice call");
    assert.equal(ended.tag, "valid-call-call-7");
    assert.equal(ended.silent, true);
    assert.equal(ended.renotify, false);
    assert.equal(ended.requireInteraction, undefined);
    assert.equal(ended.actions, undefined);
    assert.equal(ended.vibrate, undefined);
    assert.equal(new URL(ended.data.url).searchParams.get("chat"), "c1");
    assert.equal(new URL(ended.data.url).searchParams.has("call"), false);
    // A missed or retired call never bumps the home-screen badge.
    assert.equal(worker.badges.length, 1);
});

test("call_ended with the app on screen just stops the ringing and tells the page", async () => {
    const page = client("a", "/app/?tab=chats&chat=c1");
    const worker = harness({ clients: [page] });
    worker.shown.push({ title: "Maya is calling", tag: "valid-call-call-7" });
    await worker.push({ title: "Maya", body: "Voice call answered on another device", type: "call_ended", tag: "valid-call-call-7", data: { call_id: "call-7", chat_id: "c1", reason: "answered" } });
    assert.equal(worker.shown.length, 1);
    assert.equal(worker.shown[0].closed, true);
    assert.deepEqual(plain(page.messages), [{ type: "VALID_CALL_ENDED", callId: "call-7", chatId: "c1", reason: "answered" }]);
});

test("Answer opens the call with answer=1; tapping the notification only opens the ringer", async () => {
    const data = { url: `${ORIGIN}/app/?signin=1&tab=chats&chat=c1&call=call-7`, callId: "call-7", chatId: "c1" };
    const cold = harness();
    await cold.click({ data }, "answer");
    await cold.click({ data });
    const [answered, tapped] = cold.opened.map((href) => new URL(href));
    assert.equal(answered.searchParams.get("call"), "call-7");
    assert.equal(answered.searchParams.get("answer"), "1");
    assert.equal(tapped.searchParams.get("call"), "call-7");
    assert.equal(tapped.searchParams.has("answer"), false);

    const page = client("a", "/app/?tab=feed", { visible: false, focused: false });
    const warm = harness({ clients: [page] });
    await warm.click({ data }, "answer");
    assert.equal(page.messages[0].type, "VALID_NOTIFICATION_CLICK");
    assert.equal(new URL(page.messages[0].url).searchParams.get("answer"), "1");
});

test("Decline asks an open page to decline; with no page it uses the session cookie", async () => {
    const page = client("a", "/app/?tab=feed", { focused: false, visible: false });
    const worker = harness({ clients: [page] });
    await worker.click({ data: { url: `${ORIGIN}/app/?tab=chats&chat=c1&call=call-7`, callId: "call-7", chatId: "c1" } }, "decline");
    assert.deepEqual(plain(page.messages), [{ type: "VALID_CALL_DECLINE", callId: "call-7", chatId: "c1" }]);
    assert.deepEqual(plain(worker.opened), []);

    const requests = [];
    const closed = harness({ fetch: async (url, init = {}) => {
        requests.push([url, init.method || "GET", init.credentials]);
        return { ok: true, json: async () => ({ user: { id: "u-1" } }) };
    } });
    await closed.click({ data: { callId: "call-7", chatId: "c1" } }, "decline");
    assert.deepEqual(requests, [
        ["/api/v1/auth/session", "GET", "include"],
        ["/api/v1/users/u-1/calls/call-7/decline", "POST", "include"],
    ]);
});

test("a tap routes the open app in place, or opens it at the same URL", async () => {
    const page = client("a", "/app/?tab=feed");
    const worker = harness({ clients: [page] });
    await worker.click({ data: { url: `${ORIGIN}/app/?signin=1&tab=chats&chat=c1&message=m1` } });
    assert.deepEqual(plain(page.messages), [{ type: "VALID_NOTIFICATION_CLICK", url: `${ORIGIN}/app/?signin=1&tab=chats&chat=c1&message=m1` }]);

    const cold = harness();
    await cold.click({ data: { url: "https://evil.example/app/" } });
    assert.deepEqual(plain(cold.opened), [`${ORIGIN}/app/`]);
});

test("Story screenshot notices open that Story's viewers list", async () => {
    const worker = harness();
    await worker.push({ title: "Maya screenshotted your Story", type: "story_capture", url: "/app/?signin=1&tab=feed&story=s-1", tag: "valid-story_capture" });
    const url = new URL(worker.shown[0].data.url);
    assert.equal(url.searchParams.get("story"), "s-1");
    assert.equal(url.searchParams.get("viewers"), "1");
});

test("no system notification for the chat the user is looking at", async () => {
    const page = client("a", "/app/?tab=chats&chat=c1");
    const worker = harness({ clients: [page] });
    await worker.message({ type: "VALID_ACTIVE_CHAT", chatId: "c1", visible: true }, "a");
    await worker.push({ title: "Weekend Crew", body: "Maya: hi", type: "chat_message", url: "/app/?signin=1&tab=chats&chat=c1&message=m1", tag: "valid-chat-c1", data: { chat_id: "c1" } });
    assert.equal(worker.shown.length, 0);
    assert.equal(page.messages[0].type, "VALID_PUSH_IN_ACTIVE_CHAT");

    // Another chat, or the same chat in a background tab, still notifies.
    await worker.push({ title: "Noah", body: "yo", type: "chat_message", url: "/app/?tab=chats&chat=c2", tag: "valid-chat-c2", data: { chat_id: "c2" } });
    assert.equal(worker.shown.length, 1);
    await worker.message({ type: "VALID_ACTIVE_CHAT", chatId: "c1", visible: false }, "a");
    await worker.push({ title: "Weekend Crew", body: "again", type: "chat_message", url: "/app/?tab=chats&chat=c1", data: { chat_id: "c1" } });
    assert.equal(worker.shown.length, 2);
});

test("after the worker restarts, a focused client's URL still suppresses its chat", async () => {
    const worker = harness({ clients: [client("a", "/app/?tab=chats&chat=c1")] });
    await worker.push({ title: "Weekend Crew", type: "chat_message", url: "/app/?tab=chats&chat=c1", data: { chat_id: "c1" } });
    assert.equal(worker.shown.length, 0);
});

test("Safari still shows (and closes) a suppressed push so it keeps its subscription", async () => {
    const worker = harness({
        clients: [client("a", "/app/?tab=chats&chat=c1")],
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    });
    await worker.push({ title: "Weekend Crew", type: "chat_message", url: "/app/?tab=chats&chat=c1", data: { chat_id: "c1" } });
    assert.equal(worker.shown.length, 1);
    assert.equal(worker.shown[0].silent, true);
    assert.equal(worker.shown[0].closed, true);
});
