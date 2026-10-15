import { expect, test } from "@playwright/test";

// The Chats flows as iOS 1.6034 draws them: the inbox status line, the
// Memento streak label, Say hi, the invite screens, New Chat, search, the
// unread anchor and the inbox's own row buttons.
const WAVE = "\u{1F44B}";

async function openChats(page, query = "") {
    await page.goto(`/app/?demo=1&signin=1${query}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await expect(page.locator(".chat-list .chat-row").first()).toBeVisible();
}

async function recordDemoCalls(page, names) {
    await page.evaluate(async (names) => {
        const { DemoAPI } = await import("/app/demo-api.js");
        window.demoCalls = [];
        for (const name of names) {
            const original = DemoAPI.prototype[name];
            DemoAPI.prototype[name] = async function (...args) { window.demoCalls.push([name, structuredClone(args.slice(1))]); return original?.apply(this, args); };
        }
    }, names);
}

test("inbox rows read like iOS: status line, CHAT badge, peach unread capsule, newest activity first", async ({ page }) => {
    await openChats(page);
    const rows = page.locator(".chat-list .chat-row");
    // ChatInboxOrder: activity only; the invite and unread rows never jump.
    await expect(rows.locator("strong").first()).toHaveText("Ava Patel");
    expect(await rows.locator(".chat-row-title strong").allTextContents()).toEqual(["Ava Patel", "Weekend Crew", "Noah Williams", "Mateo Lee", "Art Club"]);
    const row = name => page.locator(".chat-list .chat-row").filter({ hasText: name });
    await expect(row("Ava Patel")).toContainText(`Said hi ${WAVE} · Tap to wave back`);
    await expect(row("Weekend Crew").locator(".chat-status-visual")).toContainText("2 new");
    await expect(row("Weekend Crew").locator(".chat-status-visual")).toContainText("· 4m");
    await expect(row("Noah Williams").locator(".chat-status-visual")).toContainText("Opened");
    await expect(row("Mateo Lee").locator(".chat-status-visual")).toContainText("Delivered");
    await expect(row("Art Club")).toContainText("Maya Chen invited you · 6 people");
    // Glyph fills: filled for new and delivered, hollow once opened.
    await expect(row("Weekend Crew").locator(".inbox-glyph.text.filled")).toHaveCount(1);
    await expect(row("Noah Williams").locator(".inbox-glyph.text.hollow")).toHaveCount(1);
    await expect(row("Mateo Lee").locator(".inbox-glyph.photo.filled")).toHaveCount(1);
    // Spoken as a sentence, not glyphs.
    await expect(row("Noah Williams").getByRole("button").first()).toHaveAccessibleName(/Your message, opened/);
    await expect(row("Weekend Crew").locator(".inbox-content-badge.chat")).toHaveText("CHAT");
    const unread = row("Weekend Crew").locator(".chat-unread");
    await expect(unread).toHaveText("2");
    await expect(unread).toHaveCSS("background-color", "rgb(255, 177, 94)");
    await expect(unread).toHaveCSS("border-top-width", "2px");
    // No Memento subtitle or camera on rows.
    await expect(page.locator(".chat-list")).not.toContainText("Take today's Memento");
    await expect(page.locator(".chat-needs-memento")).toHaveCount(0);
});

test("the streak label: bold number, grey flame while broken, hourglass and countdown in the last hours", async ({ page }) => {
    await page.clock.install({ time: new Date("2030-03-05T23:20:00") });
    await openChats(page);
    const crew = page.locator(".chat-list .chat-row").filter({ hasText: "Weekend Crew" });
    const streak = crew.locator(".chat-moment-streak");
    await expect(streak.locator("b")).toHaveText("6");
    await expect(streak.locator("b")).toHaveCSS("font-weight", "700");
    // 40 minutes left: the final hour is red.
    await expect(streak.locator(".streak-risk.final-hour [data-ui-icon='hourglass']")).toBeVisible();
    await expect(streak).toHaveAccessibleName("6 day Memento streak, breaks tonight unless someone posts a Memento");
    const mateo = page.locator(".chat-list .chat-row").filter({ hasText: "Mateo Lee" }).locator(".chat-moment-streak");
    await expect(mateo).toHaveClass(/broken/);
    await expect(mateo.locator("[data-ui-icon='fire']")).toHaveCSS("color", "rgb(142, 142, 147)");
    // The room pill: the countdown while at risk, "Save streak" while broken.
    await crew.locator(".chat-row-main").click();
    const pill = page.locator("[data-open-memento-gallery]");
    await expect(pill).toContainText("40m");
    await expect(pill.locator(".streak-hourglass")).toBeVisible();
    await page.getByRole("button", { name: "Back to chats" }).click();
    await page.getByRole("button", { name: /Mateo Lee/ }).click();
    await expect(pill).toContainText("Save streak");
});

test("hours before the window the hourglass stays away", async ({ page }) => {
    await page.clock.install({ time: new Date("2030-03-05T12:00:00") });
    await openChats(page);
    const crew = page.locator(".chat-list .chat-row").filter({ hasText: "Weekend Crew" });
    await expect(crew.locator(".streak-hourglass")).toHaveCount(0);
    await crew.locator(".chat-row-main").click();
    await expect(page.locator("[data-open-memento-gallery]")).toContainText("2/4");
});

test("Say hi waves at a friend through a new 1:1, then offers Open; the x hides it for a week", async ({ page }) => {
    await openChats(page);
    await recordDemoCalls(page, ["createChat", "sendChatMessage"]);
    const card = page.getByRole("region", { name: "Say hi to friends on Valid" });
    await expect(card).toContainText("Eli Brooks");
    await expect(card).toContainText("On Valid today");
    await expect(card).toContainText("On Valid this week");
    await card.getByRole("button", { name: `${WAVE} Say hi` }).first().click();
    await expect(card).toContainText(`You said hi ${WAVE}`);
    const calls = await page.evaluate(() => window.demoCalls);
    expect(calls[0]).toEqual(["createChat", [["classmate-4"], null, expect.any(String), "say_hi_inbox"]]);
    expect(calls[1][0]).toBe("sendChatMessage");
    expect(calls[1][1][1]).toMatchObject({ body: WAVE });
    await card.getByRole("button", { name: "Open" }).click();
    await expect(page.locator(".chat-room-title strong")).toHaveText("Eli Brooks");
    await page.getByRole("button", { name: "Back to chats" }).click();
    await card.getByRole("button", { name: "Hide for a week" }).click();
    await expect(card).toBeHidden();
    await page.reload();
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await expect(page.locator(".chat-list .chat-row").first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Say hi to friends on Valid" })).toBeHidden();
});

test("a friend's wave opens Chat invite: Wave back accepts and waves", async ({ page }) => {
    await openChats(page);
    await recordDemoCalls(page, ["acceptChatInvitation", "sendChatMessage"]);
    await page.locator('[data-list-key="chat-wave"] .chat-row-main').click();
    const screen = page.locator('[data-chat-screen="invite"]');
    await expect(screen.getByText("Chat invite")).toBeVisible();
    await expect(screen.getByRole("heading", { name: "Ava Patel said hi" })).toBeVisible();
    await expect(screen.getByRole("button", { name: "Open chat" })).toBeVisible();
    await expect(screen.getByRole("button", { name: "Decline" })).toBeVisible();
    await screen.getByRole("button", { name: `${WAVE} Wave back` }).click();
    await expect(page.locator(".chat-room-title strong")).toHaveText("Ava Patel");
    const calls = await page.evaluate(() => window.demoCalls);
    expect(calls.map(([name]) => name)).toEqual(["acceptChatInvitation", "sendChatMessage"]);
    expect(calls[1][1][1]).toMatchObject({ body: WAVE });
});

test("a group invite shows who is in it and asks before joining strangers", async ({ page }) => {
    await openChats(page);
    await page.getByRole("button", { name: /Art Club/ }).click();
    const screen = page.locator('[data-chat-screen="invite"]');
    await expect(screen.getByRole("heading", { name: "Art Club" })).toBeVisible();
    await expect(screen).toContainText("Maya Chen invited you · 6 people");
    await expect(screen).toContainText("Accept to start chatting.");
    await expect(screen.getByRole("heading", { name: "Who's in this group" })).toBeVisible();
    await expect(screen).toContainText("Eli Brooks");
    const decline = screen.getByRole("button", { name: "Decline" });
    const accept = screen.getByRole("button", { name: "Accept" });
    expect((await decline.boundingBox()).x).toBeLessThan((await accept.boundingBox()).x);
    await accept.click();
    const safety = page.getByRole("dialog", { name: "Do you know everyone here?" });
    await expect(safety).toContainText("Valid couldn't verify these people against your contacts.");
    await safety.getByRole("button", { name: "Yes, accept" }).click();
    await expect(page.locator(".chat-room-title strong")).toHaveText("Art Club");
});

test("New Chat: several people get the message each in their own chat", async ({ page }) => {
    await openChats(page);
    await recordDemoCalls(page, ["createChat", "sendChatMessage"]);
    await page.getByRole("button", { name: "New chat" }).click();
    await expect(page.locator(".chat-create-header strong")).toHaveText("New Chat");
    await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
    await expect(page.getByPlaceholder("Search friends and groups")).toBeVisible();
    await expect(page.getByRole("button", { name: /New Group/ })).toContainText("Name it and add 2 or more people");
    await expect(page.getByRole("heading", { name: "At your school" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your groups" })).toBeVisible();
    await page.getByRole("button", { name: /Maya Chen/ }).click();
    await expect(page.getByRole("button", { name: "Chat with Maya" })).toBeVisible();
    await page.getByRole("button", { name: /Sofia Kim/ }).click();
    const bar = page.locator(".chat-create-bar");
    await expect(bar).toContainText("Maya, Sofia");
    await expect(bar).toContainText("Each gets it in their own chat");
    await expect(bar.getByPlaceholder(`Add a message, or we’ll send ${WAVE}`)).toBeVisible();
    await bar.getByRole("button", { name: "Send to 2" }).click();
    await page.getByRole("dialog", { name: "Do you know everyone here?" }).getByRole("button", { name: "Send anyway" }).click();
    await expect(page.locator('[data-chat-screen="list"]')).toBeVisible();
    const calls = await page.evaluate(() => window.demoCalls);
    expect(calls.filter(([name]) => name === "createChat").map(([, args]) => args[0])).toEqual([["classmate-1"], ["classmate-5"]]);
    const sends = calls.filter(([name]) => name === "sendChatMessage").map(([, args]) => args[1].body);
    expect(sends).toEqual([WAVE, WAVE]);
});

test("a new 1:1 opens on words: Say hi, Your conversation starts here", async ({ page }) => {
    await openChats(page);
    await page.getByRole("button", { name: "New chat" }).click();
    await page.getByRole("button", { name: /Sofia Kim/ }).click();
    await page.getByRole("button", { name: "Chat with Sofia" }).click();
    // Without uploaded contacts iOS can't verify anyone, so it asks.
    await page.getByRole("dialog", { name: "Do you know everyone here?" }).getByRole("button", { name: "Start anyway" }).click();
    await expect(page.locator(".chat-room-title strong")).toHaveText("Sofia Kim");
    await expect(page.locator(".chat-room-empty")).toContainText(`Say hi ${WAVE}`);
    await expect(page.locator(".chat-room-empty")).toContainText("Your conversation starts here.");
});

test("search filters loaded chats as you type and searches history on request", async ({ page }) => {
    await openChats(page);
    await page.getByRole("button", { name: "Search chats", exact: true }).click();
    const search = page.getByRole("searchbox", { name: "Search chats & messages" });
    await search.fill("q");
    await expect(page.locator(".chat-search-results")).toContainText("Keep typing");
    // Names, members and the last message all match (ChatSearchResultsView.localChats).
    await search.fill("noah");
    await expect(page.locator(".chat-search-results .chat-row")).toHaveCount(3);
    await search.fill("hilarious");
    await expect(page.locator(".chat-search-results .chat-row")).toHaveCount(1);
    await expect(page.locator(".chat-search-results")).toContainText("Noah Williams");
    await expect(page.getByRole("button", { name: /Search all chats & messages/ })).toContainText("Look through older message history for \u201chilarious\u201d");
    await search.fill("zzzz");
    await search.press("Enter");
    await expect(page.locator(".chat-search-results")).toContainText("No results found");
    await expect(page.locator(".chat-search-results")).toContainText("No chats or messages matched “zzzz”.");
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page.locator(".chat-list")).toBeVisible();
});

test("a long unread run opens at the first unread under New messages", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1");
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        const getChats = DemoAPI.prototype.getChats;
        const getMessages = DemoAPI.prototype.getChatMessages;
        const ago = minutes => new Date(Date.now() - minutes * 60_000).toISOString();
        const backlog = Array.from({ length: 40 }, (_, index) => ({
            id: `long-${index + 1}`, chat_id: "chat-noah", room_sequence: index + 1, sender_user_id: "classmate-2", sender_first_name: "Noah",
            kind: "text", body: `Message ${index + 1} with enough words to take a line or two in the room`, status: "active", viewer_is_sender: false,
            reaction_count: 0, reaction_summary: {}, created_at: ago(60 - index), updated_at: ago(60 - index),
        }));
        DemoAPI.prototype.getChats = async function (...args) {
            const response = await getChats.apply(this, args);
            Object.assign(response.items.find(chat => chat.id === "chat-noah"), { last_room_sequence: 40, last_read_sequence: 10, unread_count: 30, regular_unread_count: 30, last_message_at: ago(21), last_message_is_mine: false, last_message_kind: "text" });
            return response;
        };
        DemoAPI.prototype.getChatMessages = async function (userId, chatId, options = {}) {
            if (chatId !== "chat-noah") return getMessages.call(this, userId, chatId, options);
            const after = options.afterSequence ?? 0;
            return { items: backlog.filter(item => item.room_sequence > after).slice(-(options.limit || 50)), next_before_sequence: null };
        };
    });
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    const divider = page.getByRole("separator", { name: "New messages" });
    await expect(divider).toBeInViewport();
    await expect(page.locator('[data-message-id="long-11"]')).toBeInViewport();
    await expect(page.locator('[data-message-id="long-40"]')).not.toBeInViewport();
    await expect(page.locator("[data-jump-latest]")).toBeVisible();
});

test("Call back and View N work from the inbox without opening the room", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1&calls=1");
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        const getChats = DemoAPI.prototype.getChats;
        DemoAPI.prototype.getChats = async function (...args) {
            const response = await getChats.apply(this, args);
            if (!window.missedServed) {
                window.missedServed = true;
                Object.assign(response.items.find(chat => chat.id === "chat-mateo"), { unacknowledged_missed_call_id: "missed-1", unacknowledged_missed_call_media_type: "audio", unacknowledged_missed_call_at: new Date().toISOString() });
                Object.assign(response.items.find(chat => chat.id === "chat-noah"), { unopened_view_once_count: 1, next_view_once_room_sequence: 4, next_view_once_kind: "photo" });
            }
            return response;
        };
        window.callLog = [];
        DemoAPI.prototype.startCall = async (_user, chatId) => { window.callLog.push(["start", chatId]); throw Object.assign(new Error("No calls in this test"), { status: 409 }); };
        const acknowledge = DemoAPI.prototype.acknowledgeMissedCall;
        DemoAPI.prototype.acknowledgeMissedCall = async function (...args) { window.callLog.push(["ack", args[1]]); return acknowledge.apply(this, args); };
    });
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    const mateo = page.locator(".chat-list .chat-row").filter({ hasText: "Mateo Lee" });
    await expect(mateo.locator(".chat-status-visual")).toContainText("Missed call");
    await mateo.getByRole("button", { name: /Call back/ }).click();
    // The call starts over the inbox (iOS returnMissedCall) and the miss is acknowledged.
    await expect(page.getByRole("dialog", { name: "Valid call" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.callLog)).toEqual(expect.arrayContaining([["ack", "missed-1"]]));
    await expect(page).not.toHaveURL(/chat=chat-mateo/);
    await expect(page.locator('[data-chat-screen="room"]')).toBeHidden();
    const call = page.getByRole("dialog", { name: "Valid call" });
    await call.getByRole("button", { name: "Close" }).click();
    await expect(call).toBeHidden();
    const noah = page.locator(".chat-list .chat-row").filter({ hasText: "Noah Williams" });
    await noah.getByRole("button", { name: "View 1 unopened snap" }).click();
    const viewer = page.getByRole("dialog", { name: "Chat media" });
    await expect(viewer).toBeVisible();
    await expect(viewer).toContainText("View once");
    await expect(page.locator('[data-chat-screen="room"]')).toBeHidden();
    await viewer.getByRole("button", { name: "Close" }).click();
    await expect(page.locator('[data-chat-screen="list"]')).toBeVisible();
});

test("room header names who is still invited", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1");
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        const getChat = DemoAPI.prototype.getChat;
        DemoAPI.prototype.getChat = async function (...args) {
            const detail = await getChat.apply(this, args);
            if (args[1] === "chat-mateo") {
                detail.chat.pending_count = 1;
                detail.members[1] = { ...detail.members[1], status: "invited" };
            }
            return detail;
        };
    });
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Mateo Lee/ }).click();
    await expect(page.locator(".chat-room-title small")).toHaveText("Waiting on Mateo");
    await expect(page.locator(".chat-invite-reminder")).toContainText("Waiting for Mateo to accept");
});
