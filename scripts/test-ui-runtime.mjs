import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRealtimeList } from "../app/realtime-list.js";
import { MAX_MESSAGES_PER_CHAT, createChatStore } from "../app/chat/store.js";
import { chatAttentionPriority, chatNeedsMemento } from '../app/chat/models.js';

const inbox = createChatStore({ attentionPriority: chat => chatAttentionPriority(chat, { dailyLedgerEnabled: true, callsEnabled: true }) });
const summary = (id, extra = {}) => ({ id, membership_status: 'accepted', accepted_count: 2, has_posted_today_memento: true, last_room_sequence: 1, updated_at: '2026-09-07T00:00:00Z', ...extra });
const initial = [summary('normal'), summary('memento', { has_posted_today_memento: false }), summary('unread', { unread_count: 1 }), summary('invite', { membership_status: 'invited' }), summary('media', { unopened_view_once_count: 1, next_view_once_room_sequence: 4 }), summary('call', { unacknowledged_missed_call_id: 'call-1' })];
const ids = () => inbox.state.chats.map(chat => chat.id);
inbox.replaceChats(initial);
assert.deepEqual(ids(), ['call', 'unread', 'invite', 'media', 'memento', 'normal']);
inbox.replaceChats([...initial].reverse());
assert.deepEqual(ids(), ['call', 'unread', 'invite', 'media', 'memento', 'normal'], 'A refresh cannot reshuffle a stable inbox');
inbox.upsertChat(summary('media', { unopened_view_once_count: 1, next_view_once_room_sequence: 4, last_room_sequence: 2, last_message_at: '2026-09-07T01:00:00Z' }));
assert.deepEqual(ids(), ['call', 'media', 'unread', 'invite', 'memento', 'normal'], 'New activity moves within the native priority tier');
inbox.upsertChat(summary('unread'));
assert.deepEqual(ids(), ['call', 'media', 'invite', 'memento', 'normal', 'unread'], 'Reading a chat resolves conversation attention');
inbox.replaceChats([summary('gone', { membership_status: 'left' })]);
assert.deepEqual(ids(), [], 'Removed membership and its activity history must not remain visible');
const skipped = summary('skip', { has_posted_today_memento: false, has_skipped_today_memento: true });
assert.equal(chatNeedsMemento(skipped, true), false, 'Skip grants access, not a posted Memento');
assert.equal(chatAttentionPriority(skipped, { dailyLedgerEnabled: true }), 1);
assert.equal(chatAttentionPriority(initial.at(-1), { callsEnabled: false }), 0, 'Disabled web calls do not claim attention');
assert.equal(chatAttentionPriority(summary('read', { unread_count: 3, regular_unread_count: 0 })), 0, 'Memento unread counts are not regular conversation unread');

const scheduled = [];
const list = createRealtimeList({
    keyOf: (item) => item.id,
    compare: (left, right) => right.createdAt - left.createdAt,
    schedule: (callback) => scheduled.push(callback) - 1,
    cancel: (handle) => { scheduled[handle] = null; },
});

const commits = [];
list.subscribe((items, changes) => commits.push({ items, changes }));
list.upsert({ id: "message-1", body: "first", createdAt: 1 });
list.upsert({ id: "message-2", body: "second", createdAt: 2 });
assert.equal(commits.length, 0, "Realtime events should batch before the scheduled flush");
scheduled.shift()();
assert.deepEqual(list.snapshot().map((item) => item.id), ["message-2", "message-1"]);
assert.equal(commits.length, 1);

list.upsert({ id: "message-1", body: "edited" }, { flush: "sync" });
assert.equal(list.snapshot().find((item) => item.id === "message-1").body, "edited");
list.remove("message-2", { flush: "sync" });
assert.deepEqual(list.snapshot().map((item) => item.id), ["message-1"]);
list.replace([{ id: "memento-1", createdAt: 5 }], { flush: "sync" });
assert.deepEqual(list.snapshot().map((item) => item.id), ["memento-1"]);

const states = [];
list.subscribeConnection((state) => states.push(state));
list.setConnectionState("connecting", { attempt: 2 });
list.setConnectionState("live");
assert.deepEqual(states.map((state) => state.state), ["idle", "connecting", "live"]);

list.pause();
list.upsert({ id: "memento-2", createdAt: 6 });
assert.equal(list.snapshot().length, 1);
list.resume();
assert.deepEqual(list.snapshot().map((item) => item.id), ["memento-2", "memento-1"]);

list.destroy();

const chatStore = createChatStore();
chatStore.mergeMessages("bounded-chat", Array.from({ length: MAX_MESSAGES_PER_CHAT + 25 }, (_, index) => ({
    id: `bounded-message-${index}`,
    chat_id: "bounded-chat",
    room_sequence: index + 1,
    status: "active",
})));
assert.equal(chatStore.messages("bounded-chat").length, MAX_MESSAGES_PER_CHAT, "Chat history retained in memory and the DOM must be bounded");
assert.equal(chatStore.messages("bounded-chat")[0].room_sequence, 26, "The bounded chat window must retain the newest authoritative messages");

chatStore.replaceMessages("idempotent-chat", [{
    id: "pending:request-one", client_request_id: "request-one", chat_id: "idempotent-chat",
    room_sequence: .5, status: "active", delivery_state: "sending",
}]);
chatStore.mergeMessages("idempotent-chat", [{
    id: "server-one", client_request_id: "request-one", chat_id: "idempotent-chat",
    room_sequence: 1, status: "active", delivery_state: "sent",
}]);
assert.deepEqual(chatStore.messages("idempotent-chat").map((message) => message.id), ["server-one"], "An SSE/API race must reconcile one client request to one server message");

const chatRuntime = await readFile(new URL("../app/chat/index.js", import.meta.url), "utf8");
const appRuntime = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
const callRuntime = await readFile(new URL("../app/calls/index.js", import.meta.url), "utf8");
const serviceWorker = await readFile(new URL("../app/service-worker.js", import.meta.url), "utf8");
assert.match(chatRuntime, /addEventListener\("chat", consumeEvent\)/, "Chat SSE must consume the backend's named event stream");
assert.match(chatRuntime, /\["resync", "ready"\]\.includes\(event\.type\)/, "A reconnected chat stream must repair missed mutations with an authoritative resync");
assert.match(appRuntime, /config\.enable_chats === true && config\.enable_web_chats === true/, "PWA Chats must require its independent web rollout flag");
assert.match(chatRuntime, /enable_web_mementos === true/, "PWA Mementos must require its independent web rollout flag");
assert.match(callRuntime, /enable_calls === true && getConfig\(\)\?\.enable_web_calls === true/, "PWA calls must require native availability and their independent web rollout flag");
assert.doesNotMatch(serviceWorker, /livekit\.bundle\.js/, "Private call media code must stay lazy and outside the offline app shell");
console.log("UI runtime tests passed");
