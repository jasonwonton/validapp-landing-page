import assert from "node:assert/strict";
import test from "node:test";
import { GENERIC_ERROR_MESSAGE, apiErrorMessage, isHumanSentence, userMessage, validationMessage } from "../../app/user-message.js";

class APIError extends Error {
    constructor(message, status, detail) { super(message); this.name = "APIError"; this.status = status; this.detail = detail; }
}

test("server-authored sentences are kept", () => {
    assert.equal(userMessage(new APIError("That username is taken.", 409), "x"), "That username is taken.");
    assert.equal(userMessage(new APIError("Too many requests. Try again in 5 seconds.", 429)), "Too many requests. Try again in 5 seconds.");
    assert.equal(userMessage("Your link was reset."), "Your link was reset.");
});

test("status codes without a readable detail map to plain English", () => {
    assert.equal(userMessage(new APIError("Request failed (404)", 404), "fallback"), "That’s no longer available.");
    assert.equal(userMessage(new APIError("user_not_found", 404)), "That’s no longer available.");
    assert.equal(userMessage(new APIError("Request failed (403)", 403)), "You don’t have permission to do that.");
    assert.equal(userMessage(new APIError("Request failed (401)", 401)), "Your session expired. Sign in again to continue.");
    assert.equal(userMessage(new APIError("Request failed (409)", 409)), "That changed somewhere else. Refresh and try again.");
    assert.equal(userMessage(new APIError("Request failed (413)", 413)), "That file is too large. Choose a smaller one.");
    assert.equal(userMessage(new APIError("Request failed (429)", 429)), "Too many requests. Please try again shortly.");
    assert.equal(userMessage(new APIError("Internal Server Error happened", 500)), "Valid is having trouble right now. Please try again in a moment.");
    assert.equal(userMessage(new APIError("x", 408)), "That took too long. Check your connection and try again.");
    assert.equal(userMessage(new APIError("Request failed (418)", 418), "Could not save."), "Could not save.");
});

test("network failures and browser exceptions are named, not echoed", () => {
    assert.equal(userMessage(new TypeError("Failed to fetch")), "Could not reach Valid. Check your connection and try again.");
    assert.equal(userMessage(new TypeError("Load failed")), "Could not reach Valid. Check your connection and try again.");
    assert.match(userMessage(new DOMException("Permission denied", "NotAllowedError")), /^Permission was denied/);
    assert.match(userMessage(new DOMException("Could not start video source", "NotReadableError")), /another app/);
    assert.equal(userMessage(new DOMException("The user aborted a request.", "AbortError")), "That was cancelled.");
    assert.match(userMessage(new DOMException("quota", "QuotaExceededError")), /out of storage/);
    assert.equal(userMessage(new TypeError("Cannot read properties of undefined (reading 'id')"), "Could not load."), "Could not load.");
    assert.equal(userMessage(new Error("<html><body>502</body></html>"), "Could not load."), "Could not load.");
    assert.equal(userMessage(null, "fallback"), "fallback");
    assert.equal(userMessage({}, "fallback"), "fallback");
});

test("FastAPI validation arrays become one field sentence", () => {
    assert.equal(validationMessage([{ loc: ["body", "username"], msg: "String should have at least 3 characters", type: "string_too_short" }]), "Username must be at least 3 characters.");
    assert.equal(validationMessage([{ loc: ["body", "first_name"], msg: "Field required", type: "missing" }]), "First name is required.");
    assert.equal(validationMessage([{ loc: ["body", "bio"], msg: "String should have at most 150 characters", type: "string_too_long" }]), "Bio must be 150 characters or fewer.");
    assert.equal(validationMessage([{ loc: ["body", "grade"], msg: "Value error, Choose a grade from the list", type: "value_error" }]), "Choose a grade from the list.");
    assert.equal(validationMessage([{ loc: ["body", "count"], msg: "Input should be a valid integer", type: "int_parsing" }]), "Count must be a number.");
    assert.equal(validationMessage([{ loc: ["body"], msg: "weird", type: "x" }]), "Some details aren’t valid. Check them and try again.");
    assert.equal(validationMessage("nope"), "");
});

test("sentence detection rejects codes and developer text", () => {
    for (const text of ["", "NOT_FOUND", "user_not_found", "Request failed (500)", "{\"detail\":1}", "Failed to fetch", "x".repeat(300)]) assert.equal(isHumanSentence(text), false, text);
    for (const text of ["Vote not found", "You need 100 aura.", "3 skips left today"]) assert.equal(isHumanSentence(text), true, text);
});

test("api.js maps detail-less responses through the same status mapper", () => {
    assert.equal(apiErrorMessage(404), "That’s no longer available.");
    assert.equal(apiErrorMessage(403, "forbidden"), "You don’t have permission to do that.");
    assert.equal(apiErrorMessage(502), "Valid is having trouble right now. Please try again in a moment.");
    assert.equal(apiErrorMessage(409, "That username is taken."), "That username is taken.");
    assert.equal(apiErrorMessage(418), GENERIC_ERROR_MESSAGE);
    for (const status of [400, 404, 418, 500]) assert.doesNotMatch(apiErrorMessage(status), /Request failed|\d{3}/);
});

test("the generic api sentence yields to the caller's more specific fallback", () => {
    assert.equal(userMessage(new APIError(apiErrorMessage(418), 418), "Could not save."), "Could not save.");
    assert.equal(userMessage(new Error(GENERIC_ERROR_MESSAGE), "Could not load chats."), "Could not load chats.");
    assert.equal(userMessage(new APIError(apiErrorMessage(404), 404), "Could not load."), "That’s no longer available.");
});

test("app surfaces never show a raw error.message", async () => {
    const { readFile } = await import("node:fs/promises");
    const files = ["app/app.js", "app/chat/index.js", "app/chat/room-tools.js", "app/chat/sticker-maker.js", "app/calls/index.js", "app/stories/index.js", "app/api.js"];
    for (const file of files) {
        const source = await readFile(new URL(`../../${file}`, import.meta.url), "utf8");
        const raw = source.split("\n").map((line, index) => [index + 1, line])
            .filter(([, line]) => /(error|reason)\??\.message\s*(\|\||\)|;|\})/.test(line) && !/\.test\(|=\s*(navigator|['"])/.test(line));
        assert.deepEqual(raw, [], `${file} shows raw error text`);
        assert.doesNotMatch(source, /Request failed \(/, file);
    }
});
