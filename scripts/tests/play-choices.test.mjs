import assert from "node:assert/strict";
import test from "node:test";
import {
    answerPayload,
    buildChoicePool,
    canStartPlay,
    cardNameKey,
    contactUploadPayload,
    formatContactPhone,
    selectPlayChoices,
    shouldExcludeContactName,
    summarizeContactSync,
} from "../../app/play-choices.js";

const SELF = "00000000-0000-0000-0000-00000000000a";
const hash = (seed) => String(seed).repeat(64).slice(0, 64);
const classmate = (id, first, last = "Student", extra = {}) => ({ user_id: id, first_name: first, last_name: last, grade: "Junior", gender: "female", weekly_vote_count: 1, ...extra });
const contact = (seed, name, extra = {}) => ({ phone_number: hash(seed), name, is_six7_user: false, user_id: null, recommendation_strength: 0, vote_count: 0, visibility_boosts: [], ...extra });

// Deterministic Math.random stand-in.
function seeded(seed = 7) {
    let value = seed;
    return () => {
        value = (value * 1103515245 + 12345) % 2147483648;
        return value / 2147483648;
    };
}

test("classmates only: three lock Play, four unlock it", () => {
    const three = buildChoicePool({ classmates: [classmate("u1", "Ana"), classmate("u2", "Ben"), classmate("u3", "Cy")], selfUserId: SELF });
    assert.equal(three.length, 3);
    assert.equal(canStartPlay(three), false);
    const four = buildChoicePool({ classmates: [classmate("u1", "Ana"), classmate("u2", "Ben"), classmate("u3", "Cy"), classmate("u4", "Dee")], selfUserId: SELF });
    assert.equal(canStartPlay(four), true);
    assert.deepEqual(four.map((choice) => choice.name), ["Ana Student", "Ben Student", "Cy Student", "Dee Student"]);
    assert.ok(four.every((choice) => choice.is_classmate && choice.phone === ""));
});

test("contacts only: four people not on Valid unlock Play", () => {
    const pool = buildChoicePool({ contacts: [contact(1, "Riley Stone"), contact(2, "Casey Moore"), contact(3, "Jordan Fox"), contact(4, "Taylor Reed")], selfUserId: SELF });
    assert.equal(canStartPlay(pool), true);
    for (const choice of pool) {
        assert.equal(choice.user_id, null);
        assert.equal(choice.is_classmate, false);
        assert.match(choice.phone, /^[0-9a-f]{64}$/);
    }
});

test("mixed: a contact who is also a classmate is one person, named from the profile, keeping the contact's phone", () => {
    const pool = buildChoicePool({
        contacts: [contact(1, "Ana B", { user_id: "u1", is_six7_user: true, recommendation_strength: 3 }), contact(2, "Riley Stone")],
        classmates: [classmate("u1", "Ana", "Brown"), classmate("u2", "Ben")],
        selfUserId: SELF,
    });
    assert.equal(pool.length, 3);
    assert.equal(canStartPlay(pool), false);
    const ana = pool.find((choice) => choice.user_id === "u1");
    assert.equal(ana.name, "Ana Brown");
    assert.equal(ana.phone, hash(1));
    assert.equal(ana.is_contact_matched_classmate, true);
    assert.equal(ana.mutual_strength, 3);
    const withOneMore = buildChoicePool({
        contacts: [contact(1, "Ana B", { user_id: "u1", is_six7_user: true }), contact(2, "Riley Stone"), contact(3, "Casey Moore")],
        classmates: [classmate("u1", "Ana", "Brown"), classmate("u2", "Ben")],
        selfUserId: SELF,
    });
    assert.equal(canStartPlay(withOneMore), true);
});

test("pool drops self, blocked users, filtered names, repeated numbers and a non-user's second number", () => {
    const pool = buildChoicePool({
        contacts: [
            contact(1, "Me Myself", { user_id: SELF, is_six7_user: true }),
            contact(2, "Mom"),
            contact(3, "\u{1F410}"),
            contact(4, "Riley Stone"),
            contact(4, "Riley S"),
            contact(5, "Riley Stone"),
            contact(6, "Blocked Person", { user_id: "u9", is_six7_user: true }),
            contact(7, ""),
            contact(8, "Pizza Hut"),
        ],
        classmates: [classmate(SELF, "Self"), classmate("u8", "Blocked", "Classmate"), classmate("u2", "Ben")],
        selfUserId: SELF,
        blockedUserIds: ["u8", "u9"],
    });
    assert.deepEqual(pool.map((choice) => choice.name), ["Riley Stone", "Ben Student"]);
});

test("contact names follow iOS ContactFiltering, including /config rules", () => {
    for (const name of ["Mom", "Dad Smith", "Aunt Jane", "Voicemail", "Dr Lee", "\u{1F410}❤️", "", "  ", "Jo 2", "Mary Jane Watson", "张伟", "Grandma", "My Sister"]) {
        assert.equal(shouldExcludeContactName(name), true, name);
    }
    for (const name of ["Riley Stone", "José Cruz", "Ana", "Jake \u{1F410}"]) {
        assert.equal(shouldExcludeContactName(name), false, name);
    }
    const rules = { excluded_terms: ["tomo"], excluded_phrases: ["old phone"], excluded_regexes: ["[0-9]", "("] };
    assert.equal(shouldExcludeContactName("Tomo Ito", rules), true);
    assert.equal(shouldExcludeContactName("Riley Stone", rules), false);
});

test("four picks: distinct people and names, recorded for the cooldown", () => {
    const pool = buildChoicePool({
        contacts: [contact(1, "Riley Stone"), contact(2, "Casey Moore")],
        classmates: ["Ana", "Ben", "Cy", "Dee", "Eve", "Fin"].map((name, index) => classmate(`u${index}`, name)),
        selfUserId: SELF,
    });
    const history = [];
    const random = seeded(3);
    for (let round = 0; round < 50; round += 1) {
        const picks = selectPlayChoices(pool, { viewerUserId: SELF, viewer: { grade: "Junior", gender: "male" }, history, random });
        assert.equal(picks.length, 4);
        assert.equal(new Set(picks.map((choice) => choice.id)).size, 4);
        assert.equal(new Set(picks.map((choice) => cardNameKey(choice.name))).size, 4);
        assert.ok(history.length <= 8);
    }
});

test("contacts appear on cards next to classmates", () => {
    const pool = buildChoicePool({
        contacts: [contact(1, "Riley Stone", { recommendation_strength: 4 }), contact(2, "Casey Moore", { recommendation_strength: 4 })],
        classmates: ["Ana", "Ben"].map((name, index) => classmate(`u${index}`, name)),
        selfUserId: SELF,
    });
    const picks = selectPlayChoices(pool, { viewerUserId: SELF, history: [], random: seeded(11) });
    assert.deepEqual(new Set(picks.map((choice) => choice.name)), new Set(["Riley Stone", "Casey Moore", "Ana Student", "Ben Student"]));
});

test("vote for a contact not on Valid sends the server's phone hash and no user id", () => {
    const pool = buildChoicePool({
        contacts: [contact(1, "Riley Stone"), contact(2, "Ana B", { user_id: "u1", is_six7_user: true })],
        classmates: [classmate("u1", "Ana", "Brown"), classmate("u2", "Ben")],
        selfUserId: SELF,
    });
    const riley = pool.find((choice) => choice.name === "Riley Stone");
    const payload = answerPayload({ questionId: 9, selected: riley, choices: pool, clientRequestId: "11111111-1111-4111-8111-111111111111" });
    assert.deepEqual(payload, {
        question_id: 9,
        selected_contact_name: "Riley Stone",
        selected_contact_phone: hash(1),
        presented_options: [
            { phone: hash(1), name: "Riley Stone" },
            { phone: hash(2), name: "Ana Brown" },
            { phone: "", name: "Ben Student" },
        ],
        is_nomination: false,
        client_request_id: "11111111-1111-4111-8111-111111111111",
    });
    assert.ok(!("selected_contact_user_id" in payload));
    const ben = answerPayload({ questionId: 9, selected: pool[2], choices: pool });
    assert.equal(ben.selected_contact_user_id, "u2");
    assert.ok(!("selected_contact_phone" in ben));
    const ana = answerPayload({ questionId: 9, selected: pool[1], choices: pool, isNomination: true });
    assert.equal(ana.selected_contact_user_id, "u1");
    assert.equal(ana.selected_contact_phone, hash(2));
    assert.equal(ana.is_nomination, true);
});

test("phones are formatted like PhoneNumberFormatter.formatToE164", () => {
    assert.equal(formatContactPhone("(415) 555-0111"), "+14155550111");
    assert.equal(formatContactPhone("+1 415-555-0111"), "+14155550111");
    assert.equal(formatContactPhone("1.415.555.0111"), "+14155550111");
    assert.equal(formatContactPhone("４１５５５５０１１１"), "+14155550111");
    for (const value of ["555-0111", "415-555-0111 x23", "+44 20 7946 0958", "12345", "", null, "0014155550111"]) {
        assert.equal(formatContactPhone(value), null, String(value));
    }
});

test("upload rows: every number on a card, de-duplicated, filtered names left out", () => {
    const result = contactUploadPayload([
        { name: ["Riley Stone"], tel: ["(415) 555-0111", "415.555.0112", "911"] },
        { name: ["Riley Again"], tel: ["+1 415 555 0111"] },
        { name: ["Mom"], tel: ["4155550113"] },
        { name: [""], tel: ["4155550114"] },
        { name: ["Casey Moore"], tel: ["555-0111"] },
    ]);
    assert.deepEqual(result.contacts, [
        { phone_number: "+14155550111", name: "Riley Again" },
        { phone_number: "+14155550112", name: "Riley Stone" },
    ]);
    assert.equal(result.filteredNames, 2);
    assert.equal(result.unusableNumbers, 1);
});

test("sync summary counts people, accounts and failures", () => {
    const payload = contactUploadPayload([
        { name: ["Riley Stone"], tel: ["4155550111", "4155550112"] },
        { name: ["Casey Moore"], tel: ["4155550113"] },
        { name: ["Jordan Fox"], tel: ["4155550114"] },
        { name: ["Mom"], tel: ["4155550115"] },
    ]);
    const accepted = [
        { phone_number: "4155550111", hashed_phone_number: hash("a") },
        { phone_number: "4155550112", hashed_phone_number: hash("b") },
        { phone_number: "4155550113", hashed_phone_number: hash("c") },
    ];
    const summary = summarizeContactSync({
        ...payload,
        accepted,
        failedPhones: ["+14155550114"],
        serverContacts: [{ phone_number: hash("b"), is_six7_user: true, user_id: "u1" }, { phone_number: hash("c"), is_six7_user: false }],
    });
    assert.equal(summary.synced, 2);
    assert.equal(summary.onValid, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.skipped, 1);
});
