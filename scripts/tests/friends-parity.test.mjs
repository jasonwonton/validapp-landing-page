import assert from "node:assert/strict";
import test from "node:test";
import { relationshipFor, parseAddLink, suggestionDescription } from "../../app/friends/model.js";
import { loadChatDraft, saveChatDraft, clearChatDrafts } from "../../app/chat/drafts.js";

test("relationship state prioritizes viewer blocks and server availability over stale lists", () => {
    const person = { user_id: "peer", relation: "none" };
    const lists = { friends: [person], incoming: [], outgoing: [] };
    assert.equal(relationshipFor(person, lists), "added");
    assert.equal(relationshipFor({ ...person, can_add: false }, lists), "unavailable");
    assert.equal(relationshipFor({ ...person, can_add: false, blocked_by_viewer: true }, lists), "blocked");
    assert.equal(relationshipFor(person, { incoming: [person] }), "added_you");
    assert.equal(relationshipFor(person, { outgoing: [person] }), "requested");
});

test("QR and deep links accept only canonical Valid HTTPS account links", () => {
    assert.equal(parseAddLink("https://validapp.lol/add/maya_c"), "maya_c");
    for (const value of ["https://evil.test/add/maya_c", "https://validapp.lol.evil.test/add/maya_c", "https://user@validapp.lol/add/maya_c", "http://validapp.lol/add/maya_c", "javascript:alert(1)", "https://validapp.lol:8443/add/maya_c", "https://validapp.lol/add/x/extra", "https://validapp.lol/add/%2e%2e"]) assert.equal(parseAddLink(value), null, value);
});

test("suggestion copy avoids doubled counts and supports unknown reasons", () => {
    assert.equal(suggestionDescription({ reason: "grade", label: "Your year · 2 mutual", mutual_count: 2 }), "Your year · 2 mutual friends");
    assert.equal(suggestionDescription({ reason: "mutual", label: "3 mutual friends", mutual_count: 3 }), "3 mutual friends");
    assert.equal(suggestionDescription({ reason: "future", reason_label: "New reason", mutual_count: 0 }), "New reason");
});

test("drafts are scoped to user and room, bounded, recoverable and cleared at account exit", () => {
    const store = new Map();
    globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
    saveChatDraft("A", "room", "A private draft");
    assert.equal(loadChatDraft("A", "room"), "A private draft");
    assert.equal(loadChatDraft("B", "room"), "");
    assert.equal(loadChatDraft("A", "another-room"), "");
    saveChatDraft("B", "room", "B draft"); clearChatDrafts("A");
    assert.equal(loadChatDraft("A", "room"), ""); assert.equal(loadChatDraft("B", "room"), "B draft");
    for (let index = 0; index < 130; index++) saveChatDraft("A", `room-${index}`, "x".repeat(2100));
    const rows = JSON.parse([...store.values()][0]);
    assert.equal(rows.filter((row) => row.userId === "A").length, 100);
    assert.ok(rows.every((row) => row.text.length <= 2000));
    saveChatDraft("B", "room", ""); assert.equal(loadChatDraft("B", "room"), "");
    store.set("valid:chat-drafts:v1", "corrupt"); assert.equal(loadChatDraft("A", "room"), "");
    globalThis.localStorage = { getItem() { throw new Error("Blocked"); }, setItem() { throw new Error("Blocked"); }, removeItem() { throw new Error("Blocked"); } };
    assert.doesNotThrow(() => saveChatDraft("A", "room", "Still type"));
    assert.equal(loadChatDraft("A", "room"), "");
    delete globalThis.localStorage;
});
