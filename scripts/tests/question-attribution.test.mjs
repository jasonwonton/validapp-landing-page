import assert from "node:assert/strict";
import test from "node:test";
import {
    AUTHOR_ANONYMITY_HINT,
    feedQuestionAttribution,
    playQuestionAttribution,
    resolveQuestionAttribution,
} from "../../app/question-attribution.js";

// An anonymous question reads "Someone at your school" to everyone, its author
// included. These payloads are what the API sends each viewer.
const AUTHOR = "00000000-0000-0000-0000-00000000000a";
const CLASSMATE = "00000000-0000-0000-0000-00000000000b";

// GET /questions/unanswered, as the server shapes it for the author of an
// anonymous question: their own name, avatar and ID, marked revealed.
const playForAuthor = { id: 42, question_text: "Who makes you laugh?", is_school_question: true, is_user_submitted: true, is_anonymous: true, submitted_by_user_id: AUTHOR, submitted_by_name: "Jamie Rivera", submitted_by_avatar_url: "https://example.invalid/me.jpg", can_reveal_submitter: false, question_submitter_revealed: true };
// ...and for anyone else: no name, no ID.
const playForClassmate = { ...playForAuthor, submitted_by_user_id: null, submitted_by_name: null, submitted_by_avatar_url: null, can_reveal_submitter: true, question_submitter_revealed: false };

const feedForAuthor = { question_id: 42, question_school_id: 7, question_is_user_submitted: true, question_is_anonymous: true, question_submitted_by_user_id: AUTHOR, question_submitted_by_display_name: "Jamie Rivera", question_submitted_by_profile_picture_url: "https://example.invalid/me.jpg", can_reveal_question_submitter: false, question_submitter_revealed: true };
const feedForClassmate = { ...feedForAuthor, question_submitted_by_user_id: null, question_submitted_by_display_name: null, question_submitted_by_profile_picture_url: null, can_reveal_question_submitter: true, question_submitter_revealed: false };

test("the author of an anonymous question sees it anonymously, with the private hint", () => {
    assert.deepEqual(playQuestionAttribution(playForAuthor, AUTHOR), { kind: "anonymous", viewerIsAuthor: true });
    assert.deepEqual(feedQuestionAttribution(feedForAuthor, AUTHOR), { kind: "anonymous", viewerIsAuthor: true });
});

test("classmates see an anonymous question anonymously, without the hint", () => {
    assert.deepEqual(playQuestionAttribution(playForClassmate, CLASSMATE), { kind: "anonymous", viewerIsAuthor: false });
    assert.deepEqual(feedQuestionAttribution(feedForClassmate, CLASSMATE), { kind: "anonymous", viewerIsAuthor: false });
});

test("a God Mode reveal still shows the revealer the name in the poll detail", () => {
    const revealed = { ...feedForAuthor, question_submitter_revealed: true };
    assert.deepEqual(feedQuestionAttribution(revealed, CLASSMATE), { kind: "named", name: "Jamie Rivera" });
});

test("named questions show the name to everyone, the author included", () => {
    const play = { ...playForAuthor, is_anonymous: false, question_submitter_revealed: false };
    const feed = { ...feedForAuthor, question_is_anonymous: false, question_submitter_revealed: false };
    for (const viewer of [AUTHOR, CLASSMATE]) {
        assert.deepEqual(playQuestionAttribution(play, viewer), { kind: "named", name: "Jamie Rivera" });
        assert.deepEqual(feedQuestionAttribution(feed, viewer), { kind: "named", name: "Jamie Rivera" });
    }
});

test("signed out, or without IDs, nobody is the author", () => {
    assert.deepEqual(resolveQuestionAttribution({ showsAttribution: true, isAnonymous: true, viewerUserId: null, submitterUserId: null }), { kind: "anonymous", viewerIsAuthor: false });
    assert.deepEqual(playQuestionAttribution(playForClassmate, undefined), { kind: "anonymous", viewerIsAuthor: false });
});

test("editorial questions have no attribution; legacy rows without a flag follow the name", () => {
    assert.deepEqual(playQuestionAttribution({ ...playForAuthor, is_user_submitted: false }, AUTHOR), { kind: "none" });
    assert.deepEqual(feedQuestionAttribution({ ...feedForAuthor, question_school_id: null }, AUTHOR), { kind: "none" });
    const legacyNamed = { question_school_id: 7, question_submitted_by_display_name: "Maya Chen" };
    assert.deepEqual(feedQuestionAttribution(legacyNamed, CLASSMATE), { kind: "named", name: "Maya Chen" });
    assert.deepEqual(feedQuestionAttribution({ question_school_id: 7 }, CLASSMATE), { kind: "anonymous", viewerIsAuthor: false });
});

test("the hint is the agreed copy", () => {
    assert.equal(AUTHOR_ANONYMITY_HINT, "Your name is hidden from classmates");
});
