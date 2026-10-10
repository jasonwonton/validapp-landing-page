import { expect, test } from "@playwright/test";

// The chat notification card (iOS ChatNotificationNudgePolicy /
// ChatNotificationNudgeTests). The app's Web Push plumbing is replaced by a
// fake `notifications` bridge, so these run without a push service.

async function mountNudge(page, { permission = "default", storage = true } = {}) {
    await page.goto("/app/?demo=1&signin=1");
    await page.evaluate(async ({ permission, storage }) => {
        if (!storage) {
            Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
        }
        const { createNotificationNudge } = await import("/app/chat/notification-nudge.js");
        document.body.insertAdjacentHTML("beforeend", '<div id="nudgeTest"><div data-slot="inbox"></div><div data-slot="conversation"></div></div>');
        const calls = window.__nudge = { recorded: [], toasts: [], enables: 0, permission, answer: "granted" };
        const notifications = {
            permission: () => calls.permission,
            enable() {
                calls.enables++;
                const asked = calls.permission === "default";
                return new Promise((resolve) => setTimeout(() => {
                    if (asked && calls.answer !== "default") calls.permission = calls.answer;
                    resolve({ permission: calls.permission, prompted: asked, subscribed: calls.permission === "granted" });
                }, 50));
            },
            ensureSubscribed: () => Promise.resolve(false),
            record: (action, source) => { calls.recorded.push(`${action}:${source}`); return Promise.reject(new Error("422 from an older API")); },
        };
        window.__makeNudge = () => createNotificationNudge({
            notifications,
            getUserId: () => "user-1",
            slots: {
                inbox: () => document.querySelector('#nudgeTest [data-slot="inbox"]'),
                conversation: () => document.querySelector('#nudgeTest [data-slot="conversation"]'),
            },
            showToast: (text) => calls.toasts.push(text),
        });
        window.__view = window.__makeNudge();
        window.__view.bind();
    }, { permission, storage });
}

const room = (page) => page.locator('#nudgeTest [data-placement="conversation"]');
const inbox = (page) => page.locator('#nudgeTest [data-placement="inbox"]');
const recorded = (page) => page.evaluate(() => window.__nudge.recorded);

test("the policy matches iOS: off shows, a room Not now lasts a day, the inbox never snoozes", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1");
    const result = await page.evaluate(async () => {
        const { nudgeKind, NUDGE_SNOOZE_MS, BLOCKED_NUDGE_SNOOZE_MS } = await import("/app/chat/notification-nudge.js");
        const now = 10 * BLOCKED_NUDGE_SNOOZE_MS;
        const declined = (ago, blocked = false) => ({ at: now - ago, blocked });
        return {
            granted: nudgeKind({ permission: "granted", placement: "conversation", now }),
            unsupported: nudgeKind({ permission: "unsupported", placement: "inbox", now }),
            ask: nudgeKind({ permission: "default", placement: "conversation", now }),
            blocked: nudgeKind({ permission: "denied", placement: "conversation", now }),
            snoozed: nudgeKind({ permission: "default", placement: "conversation", declined: declined(NUDGE_SNOOZE_MS - 1), now }),
            dayLater: nudgeKind({ permission: "default", placement: "conversation", declined: declined(NUDGE_SNOOZE_MS), now }),
            inboxIgnoresSnooze: nudgeKind({ permission: "default", placement: "inbox", declined: declined(1), now }),
            clockBackwards: nudgeKind({ permission: "default", placement: "conversation", declined: declined(-60_000), now }),
            blockedWeek: nudgeKind({ permission: "denied", placement: "conversation", declined: declined(BLOCKED_NUDGE_SNOOZE_MS - 1, true), now }),
            blockedAfterWeek: nudgeKind({ permission: "denied", placement: "conversation", declined: declined(BLOCKED_NUDGE_SNOOZE_MS, true), now }),
        };
    });
    expect(result).toEqual({
        granted: null, unsupported: null, ask: "ask", blocked: "blocked", snoozed: null, dayLater: "ask",
        inboxIgnoresSnooze: "ask", clockBackwards: "ask", blockedWeek: null, blockedAfterWeek: "blocked",
    });
});

test("a room shows the card on every open, Not now hides it in every room, the inbox keeps it", async ({ page }) => {
    await mountNudge(page);
    await page.evaluate(() => { window.__view.setInboxVisible(true); window.__view.roomShown(); });
    await expect(inbox(page)).toContainText("Don’t miss new messages");
    await expect(inbox(page).getByTestId("chat.notificationNudge.notNow")).toHaveCount(0);
    await expect(room(page)).toContainText("Don’t miss their reply");
    await expect(room(page).getByTestId("chat.notificationNudge.primary")).toHaveText("Notify me");

    // Leaving and reopening shows it again; soft_shown is sent once per load.
    await page.evaluate(() => { window.__view.roomHidden(); window.__view.roomShown(); window.__view.sendConfirmed(); });
    await expect(room(page)).toBeVisible();
    expect(await recorded(page)).toEqual(["soft_shown:web_chat_inbox", "soft_shown:web_chat_conversation"]);

    await room(page).getByTestId("chat.notificationNudge.notNow").click();
    await expect(room(page)).toHaveCount(0);
    expect(await recorded(page)).toContain("soft_declined:web_chat_conversation");

    // Another room (a fresh view, as after a reload) stays quiet; the inbox does not.
    await page.evaluate(() => { document.querySelector("#nudgeTest").innerHTML = '<div data-slot="inbox"></div><div data-slot="conversation"></div>'; window.__view = window.__makeNudge(); window.__view.bind(); window.__view.setInboxVisible(true); window.__view.roomShown(); });
    await expect(room(page)).toHaveCount(0);
    await expect(inbox(page)).toBeVisible();
});

test("Notify me: allowed hides the card with a toast, a dismissed prompt keeps it, denied turns it into the blocked card", async ({ page }) => {
    await mountNudge(page);
    await page.evaluate(() => { window.__nudge.answer = "default"; window.__view.roomShown(); });
    await room(page).getByTestId("chat.notificationNudge.primary").click();
    await expect(room(page).getByTestId("chat.notificationNudge.primary")).toBeEnabled();
    await expect(room(page)).toContainText("Don’t miss their reply");

    await page.evaluate(() => { window.__nudge.answer = "denied"; });
    await room(page).getByTestId("chat.notificationNudge.primary").click();
    await expect(room(page)).toContainText("Notifications are blocked");
    await expect(room(page).getByTestId("chat.notificationNudge.primary")).toHaveText("How to turn on");
    await room(page).getByTestId("chat.notificationNudge.primary").click();
    const sheet = page.getByTestId("chat.notificationNudge.help");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Permissions → Notifications → Allow");
    await expect(sheet).toContainText("App info → Notifications");
    await sheet.getByRole("button", { name: "Got it" }).click();
    await expect(sheet).toHaveCount(0);
    expect(await recorded(page)).toEqual([
        "soft_shown:web_chat_conversation",
        "soft_accepted:web_chat_conversation",
        "soft_accepted:web_chat_conversation",
        "official_declined:web_chat_conversation",
        "soft_accepted:web_chat_conversation",
    ]);

    await page.evaluate(() => { window.__nudge.permission = "default"; window.__nudge.answer = "granted"; window.__view.refresh(); window.__view.setInboxVisible(true); });
    await inbox(page).getByTestId("chat.notificationNudge.primary").click();
    await expect(inbox(page)).toHaveCount(0);
    await expect(room(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__nudge.toasts)).toEqual(["Notifications on"]);
    expect(await recorded(page)).toContain("official_accepted:web_chat_inbox");
});

test("storage failures never break the card (the decline just isn't remembered)", async ({ page }) => {
    await mountNudge(page, { permission: "denied", storage: false });
    await page.evaluate(() => window.__view.roomShown());
    await expect(room(page)).toContainText("Notifications are blocked");
    await room(page).getByTestId("chat.notificationNudge.notNow").click();
    // Without storage the decline can't be remembered, so the card returns.
    await page.evaluate(() => window.__view.roomShown());
    await expect(room(page)).toBeVisible();
});

test("unsupported browsers (iPhone Safari outside the Home Screen app) show no card", async ({ page }) => {
    await mountNudge(page, { permission: "unsupported" });
    await page.evaluate(() => { window.__view.setInboxVisible(true); window.__view.roomShown(); });
    await expect(page.getByTestId("chat.notificationNudge")).toHaveCount(0);
    expect(await recorded(page)).toEqual([]);
});
