import { expect, test } from "@playwright/test";

// Play and the weekly game, step for step with iOS 1.6034 (PlayView,
// PlayCongratsView, PlayLockedView, InviteFriendsView, NominationSearchView,
// NotificationSoftPromptView, FeedView+PersonalInbox, EasterEggGameView).

async function signIn(page, query = "") {
    await page.addInitScript(() => {
        // Record shares instead of opening the system sheet.
        window.__shares = [];
        Object.defineProperty(navigator, "share", { configurable: true, value: async (data) => { window.__shares.push(data); } });
    });
    await page.goto(`/app/?demo=1&signin=1${query}`);
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        window.__calls = { invites: [], status: 0, questions: 0 };
        const create = DemoAPI.prototype.createInvite;
        DemoAPI.prototype.createInvite = async function (...args) { window.__calls.invites.push({ channel: args[1], surface: args[2]?.surface || null }); return create.apply(this, args); };
        const status = DemoAPI.prototype.getInviteStatus;
        DemoAPI.prototype.getInviteStatus = async function (...args) { window.__calls.status += 1; return status.apply(this, args); };
        const questions = DemoAPI.prototype.getPlayQuestions;
        DemoAPI.prototype.getPlayQuestions = async function (...args) { window.__calls.questions += 1; return questions.apply(this, args); };
    });
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toBeVisible();
}

const currentCard = (page) => page.locator("#playCard .play-card:not(.play-card-leaving)");

async function answerSet(page) {
    for (let answered = 0; answered < 4; answered += 1) {
        await currentCard(page).locator("[data-choice]").first().click();
        const cancel = page.locator(".ui-sheet .ui-sheet-cancel");
        if (await cancel.isVisible().catch(() => false)) await cancel.click();
    }
    await expect(page.getByRole("heading", { name: "Congrats", exact: true })).toBeVisible();
}

test("loading uses the iOS copy and the status row shows only while answering", async ({ page }) => {
    await signIn(page);
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        const questions = DemoAPI.prototype.getPlayQuestions;
        DemoAPI.prototype.getPlayQuestions = async function (...args) { await new Promise((resolve) => { window.__releaseQuestions = resolve; }); return questions.apply(this, args); };
    });
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.locator(".play-loading-state")).toContainText("Loading polls...");
    await expect(page.locator(".play-loading-state")).toContainText("Spinning up your classmates’ questions.");
    await expect(page.locator(".play-status-bar")).toBeHidden();
    await page.evaluate(() => window.__releaseQuestions());
    await expect(page.locator(".play-status-bar")).toBeVisible();
    await expect(page.locator("#playProgress")).toHaveText("Question 1 of 4");
    await answerSet(page);
    await expect(page.locator(".play-status-bar")).toBeHidden();
    await expect(page.getByText("you just earned 20 aura")).toBeVisible();
    await expect(page.locator(".play-congrats-crown")).toHaveCount(0);
    await page.getByRole("button", { name: "w aura" }).click();
    await expect(page.getByRole("heading", { name: "Next Poll Set Locked" })).toBeVisible();
    await expect(page.locator(".play-status-bar")).toBeHidden();
});

test("nominate uses the iOS sheet copy with Classmates and Not on Valid tabs", async ({ page }) => {
    await signIn(page, "&contacts=1");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.getByRole("button", { name: /Nominate/ }).click();
    const sheet = page.getByRole("dialog", { name: "Nominate Someone" });
    await expect(sheet).toContainText("Don't think any of the options fit? Nominate someone for the poll!");
    await expect(sheet.getByRole("button", { name: "Close" })).toBeVisible();
    const classmates = sheet.getByRole("tab", { name: /^Classmates \(\d+\)$/ });
    const contacts = sheet.getByRole("tab", { name: /^Not on Valid \(\d+\)$/ });
    await expect(classmates).toHaveAttribute("aria-selected", "true");
    await expect(sheet.getByPlaceholder("Search classmates")).toBeVisible();
    await contacts.click();
    await expect(contacts).toHaveAttribute("aria-selected", "true");
    await expect(sheet.getByPlaceholder("Search contacts")).toBeVisible();
    await sheet.getByPlaceholder("Search contacts").fill("zzzz");
    await expect(sheet).toContainText("No results found");
    await expect(sheet).toContainText("Try a different search term");
    await sheet.getByPlaceholder("Search contacts").fill("");
    const row = sheet.locator("[data-nomination]").first();
    const name = await row.locator("strong").textContent();
    await row.click();
    await expect(page.locator("#auraSpendTitle")).toHaveText(`Nominate ${name}?`);
    await expect(page.locator("#auraSpendMessage")).toHaveText("This will cost 100 aura points.");
    await expect(page.locator("#confirmAuraSpend")).toHaveText("Nominate");
});

test("a vote for a friend who isn't on Valid asks to invite them", async ({ page }) => {
    await signIn(page, "&contacts=1");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    for (let attempt = 0; attempt < 12; attempt += 1) {
        if (await currentCard(page).locator("[data-choice]", { hasText: "Maya Lopez" }).count()) break;
        await page.getByRole("button", { name: /Shuffle/ }).click();
    }
    const question = await currentCard(page).locator("h3").textContent();
    await currentCard(page).locator("[data-choice]", { hasText: "Maya Lopez" }).click();
    const sheet = page.locator(".ui-sheet", { hasText: "Invite Maya Lopez?" });
    await expect(sheet).toContainText("They have 6 votes waiting on Valid.");
    // The next question waits for the answer.
    await page.waitForTimeout(1_400);
    await expect(currentCard(page).locator("h3")).toHaveText(question);
    await sheet.getByRole("button", { name: "Invite" }).click();
    await expect(page.locator("#toast")).toContainText("nice - Maya Lopez can vote on you when they join");
    expect(await page.evaluate(() => window.__calls.invites)).toEqual([{ channel: "web", surface: "vote_prompt" }]);
    await expect(currentCard(page).locator("h3")).not.toHaveText(question);
});

test("after w aura: notification soft prompt, then the invite sheet, then the lock", async ({ page }) => {
    await signIn(page, "&contacts=1&push=default&pushanswer=granted");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await answerSet(page);
    await page.getByRole("button", { name: "w aura" }).click();
    const prompt = page.getByRole("dialog", { name: "Get notified when people vote on you?" });
    await expect(prompt).toContainText("Find out when your classmates pick you in polls!");
    await expect(prompt.getByRole("button")).toHaveText(["Not now", "Allow"]);
    await prompt.getByRole("button", { name: "Allow" }).click();
    const invite = page.getByRole("dialog", { name: "Invite Friends" });
    await expect(invite).toContainText("Valid is more fun when there are more classmates");
    await expect(invite).toContainText("Share on Snapchat");
    await expect(invite.locator(".play-invite-row").first()).toContainText("Maya Lopez");
    await expect(page.getByRole("heading", { name: "Next Poll Set Locked" })).toHaveCount(0);
    await invite.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("heading", { name: "Next Poll Set Locked" })).toBeVisible();
});

test("the soft prompt module resolves granted, dismissed, denied and unsupported", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1");
    const results = await page.evaluate(async () => {
        const { askForNotifications, configureNotificationSoftPrompt } = await import("/app/notification-soft-prompt.js");
        const bridge = (permission, answer) => ({
            permission: () => permission,
            enable: () => Promise.resolve({ permission: answer, prompted: true, subscribed: answer === "granted" }),
            ensureSubscribed: () => Promise.resolve(false),
            record: () => Promise.resolve(null),
        });
        const tap = (selector) => new Promise((resolve) => setTimeout(() => { document.querySelector(selector).click(); resolve(); }, 30));
        localStorage.removeItem("valid:notification-soft-prompt:declined-at");
        const out = {};
        configureNotificationSoftPrompt(bridge("unsupported"));
        out.unsupported = await askForNotifications({ reason: "test" });
        configureNotificationSoftPrompt(bridge("granted"));
        out.alreadyOn = await askForNotifications({ reason: "test" });
        configureNotificationSoftPrompt(bridge("default", "granted"));
        let pending = askForNotifications({ reason: "test" });
        await tap("[data-soft-prompt-allow]");
        out.allowed = await pending;
        configureNotificationSoftPrompt(bridge("default", "denied"));
        pending = askForNotifications({ reason: "test" });
        await tap("[data-soft-prompt-allow]");
        out.browserDenied = await pending;
        pending = askForNotifications({ reason: "test" });
        await tap("[data-soft-prompt-decline]");
        out.notNow = await pending;
        localStorage.removeItem("valid:notification-soft-prompt:declined-at");
        configureNotificationSoftPrompt(bridge("denied"));
        pending = askForNotifications({ reason: "test" });
        await new Promise((resolve) => setTimeout(resolve, 30));
        out.blockedTitle = document.querySelector(".notification-soft-prompt h2")?.textContent;
        out.blockedSteps = document.querySelectorAll(".notification-soft-prompt-steps li").length;
        await tap("[data-soft-prompt-decline]");
        out.blocked = await pending;
        // A day passes before the blocked prompt asks again.
        out.blockedAgain = await askForNotifications({ reason: "test" });
        out.openSheets = document.querySelectorAll(".notification-soft-prompt").length;
        return out;
    });
    expect(results).toEqual({
        unsupported: "unsupported", alreadyOn: "granted", allowed: "granted", browserDenied: "denied", notNow: "dismissed",
        blockedTitle: "Get notified when someone votes on you?", blockedSteps: 4, blocked: "denied", blockedAgain: "denied", openSheets: 0,
    });
});

test("lock screen names a friend, opens Unlock More Polls, and reloads after an invite", async ({ page }) => {
    await signIn(page, "&contacts=1");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await answerSet(page);
    await page.getByRole("button", { name: "w aura" }).click();
    await page.getByRole("dialog", { name: "Invite Friends" }).getByRole("button", { name: "Done" }).click();
    const lock = page.locator(".locked-play-card");
    await expect(lock.locator(".play-invite-headline")).toHaveText("Maya has 5 votes waiting");
    await expect(lock.getByRole("button", { name: "Invite Maya to unlock" })).toBeVisible();
    await expect(lock.locator(".play-invite-meta").first()).toHaveText(/Choose someone else\s*· 2 left today/);
    // Top to bottom like PlayLockedView: invite, Send a memento, Submit a school question + cost.
    await expect(lock.locator(".play-locked-action")).toHaveText(["Invite Maya to unlock", "Send a memento", "Submit a school question"]);
    await expect(lock.locator(".play-locked-action").nth(1).locator("img")).toHaveAttribute("src", /memento-camera\.webp$/);
    await expect(lock).toContainText("Create a poll for your school for 200 aura.");
    await expect(lock).not.toContainText("OR UNLOCK NOW");

    await lock.getByRole("button", { name: "Choose someone else" }).click();
    const sheet = page.getByRole("dialog", { name: "Unlock More Polls" });
    await expect(sheet).toContainText("Invite one friend to earn an unlock for your next poll set.");
    await expect(sheet.locator(".play-invite-snapchat")).toContainText("Share on Snapchat");
    await expect(sheet.locator(".play-invite-row")).toHaveCount(3);
    await expect(sheet.locator(".play-invite-row").first()).toContainText("3 mutuals");
    const questionsBefore = await page.evaluate(() => window.__calls.questions);
    await sheet.getByRole("button", { name: "Invite Diego Ramos" }).click();
    // A sent invite closes the sheet, re-checks the status and asks for the next set.
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__calls.questions)).toBeGreaterThan(questionsBefore);
    expect(await page.evaluate(() => window.__calls.invites.at(-1))).toEqual({ channel: "web", surface: "play_lock" });
    expect(await page.evaluate(() => window.__shares.length)).toBe(1);
});

test("the named invite shares at once and the lock reloads", async ({ page }) => {
    await signIn(page, "&contacts=1");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await answerSet(page);
    await page.getByRole("button", { name: "w aura" }).click();
    await page.getByRole("dialog", { name: "Invite Friends" }).getByRole("button", { name: "Done" }).click();
    const before = await page.evaluate(() => window.__calls.questions);
    await page.getByRole("button", { name: "Invite Maya to unlock" }).click();
    await expect.poll(() => page.evaluate(() => window.__calls.questions)).toBeGreaterThan(before);
    expect(await page.evaluate(() => window.__calls.invites.at(-1))).toEqual({ channel: "web", surface: "play_lock_suggestion" });
});

test("used-up invites, a short aura balance and a returning page", async ({ page }) => {
    await signIn(page, "&invites=0&aura=50");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await answerSet(page);
    await page.getByRole("button", { name: "w aura" }).click();
    const lock = page.locator(".locked-play-card");
    await expect(lock.locator(".play-invite-limit")).toHaveText(/^You've used today's invite unlocks\. More are available at \d{1,2}:\d{2}\s?[AP]M \(in 3 hr\.\)\.$/);
    const submit = lock.getByRole("button", { name: "Submit a school question" });
    await expect(submit).toBeDisabled();
    await expect(lock).toContainText("Costs 200 aura · you need 130 more");
    await expect(lock.getByRole("button", { name: "Send a memento" })).toBeEnabled();
    // Coming back to the page re-checks the invite status.
    const checks = await page.evaluate(() => window.__calls.status);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(() => page.evaluate(() => window.__calls.status)).toBeGreaterThan(checks);
});

test("God Mode congrats shows the crown and 2x, and links to the weekly game", async ({ page }) => {
    await signIn(page, "&godmode=1");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await answerSet(page);
    await expect(page.locator(".play-congrats-crown")).toBeVisible();
    await expect(page.locator(".play-congrats-two-x")).toHaveAttribute("src", /two-x\.webp$/);
    const link = page.getByRole("button", { name: "Play 67 Challenge" });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.getByRole("dialog", { name: "Game of the Week" }).getByRole("heading", { name: "67 Challenge" })).toBeVisible();
});

test("Game of the Week is the first Inbox row on All only, with hide and Show game", async ({ page }) => {
    await signIn(page);
    const row = page.locator("#weeklyGameRoot [data-weekly-game-open]");
    await expect(row).toContainText("Game of the Week");
    await expect(row).toContainText("67 Challenge · #4");
    // It sits directly above the Inbox list.
    expect(await page.evaluate(() => document.querySelector("#weeklyGameRoot").nextElementSibling.id)).toBe("feedList");
    await page.locator('[data-inbox-filter="polls"]').click();
    await expect(row).toBeHidden();
    await page.locator('[data-inbox-filter="all"]').click();
    await expect(row).toBeVisible();
    await page.getByRole("button", { name: "School", exact: true }).click();
    await expect(row).toBeHidden();
    await page.getByRole("button", { name: "Inbox", exact: true }).click();
    await page.getByRole("button", { name: "Hide Game of the Week" }).click();
    await expect(row).toHaveCount(0);
    const restore = page.getByRole("button", { name: "Show Game of the Week" });
    await expect(restore).toContainText("Show game");
    await restore.click();
    await expect(row).toBeVisible();
});

test("two or three live games show as tiles that open their own game", async ({ page }) => {
    await signIn(page, "&games=3");
    const tiles = page.locator("#weeklyGameRoot .weekly-game-tile");
    await expect(tiles).toHaveCount(3);
    await expect(tiles.nth(1)).toContainText("Ends tomorrow");
    await expect(tiles.nth(2)).toContainText("Spirit Week");
    await expect(page.getByRole("button", { name: "Hide games" })).toBeVisible();
    await tiles.nth(2).click();
    await expect(page.getByRole("dialog", { name: "Game of the Week" }).getByRole("heading", { name: "Air High Five" })).toBeVisible();
});

test("the game home shows Best, Rank and the Friend Leaderboard before a round", async ({ page }) => {
    await signIn(page);
    await page.locator("#weeklyGameRoot [data-weekly-game-open]").click();
    const home = page.getByRole("dialog", { name: "Game of the Week" });
    await expect(home.locator(".weekly-game-home-stats")).toContainText("31Best");
    await expect(home.locator(".weekly-game-home-stats")).toContainText("#4Rank");
    const rows = home.locator(".weekly-game-rank-row");
    await expect(rows).toHaveCount(4);
    await expect(rows.first().locator(".weekly-game-rank")).toHaveText("\u{1F947}");
    await expect(rows.last()).toContainText("Jules Rivera (you)");
    await expect(rows.last()).toHaveClass(/pinned/);
    await expect(page.getByRole("dialog", { name: "Weekly game" })).toHaveCount(0);
    await home.getByRole("button", { name: "Play", exact: true }).click();
    const round = page.getByRole("dialog", { name: "Weekly game" });
    await expect(round.getByRole("button", { name: "Close game" })).toBeVisible();
    await round.getByRole("button", { name: "Close game" }).click();
    await expect(round).toHaveCount(0);
    await expect(home).toBeVisible();
    await home.getByRole("button", { name: "Done" }).click();
    await expect(home).toHaveCount(0);
});

test("God Mode reveals an anonymous Play question, and reports take a reason", async ({ page }) => {
    await signIn(page, "&godmode=1&anonq=1");
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        DemoAPI.prototype.reportQuestion = async function (_userId, questionId, reason) { window.__report = { questionId, reason }; return { ok: true }; };
    });
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await currentCard(page).locator("[data-choice]").first().click();
    await currentCard(page).locator("[data-choice]").first().click();
    await expect(currentCard(page).locator("h3")).toHaveText("Who gives the best advice?");
    const attribution = currentCard(page).locator(".question-attribution");
    await expect(attribution).toContainText("Someone at your school");
    await attribution.getByRole("button", { name: "Reveal who submitted this question" }).click();
    const confirm = page.locator(".ui-sheet", { hasText: "Reveal who made this question?" });
    await expect(confirm).toContainText("This uses 1 of your weekly reveals. You will have 1 reveal left.");
    await confirm.getByRole("button", { name: "Use 1 Reveal" }).click();
    await expect(attribution).toContainText("Maya Chen");
    await page.getByRole("button", { name: "More question actions" }).click();
    await page.getByRole("menuitem", { name: "Report a Safety Issue" }).click();
    const report = page.getByRole("dialog", { name: "Report a Safety Issue" });
    await expect(report).toContainText("If you just don't want to answer it, use Skip instead.");
    await report.getByPlaceholder("Explain why you're reporting this question...").fill("Mean to a classmate");
    await report.getByRole("button", { name: "Report for Review" }).click();
    await expect(page.locator("#toast")).toContainText("Reported to Valid");
    expect(await page.evaluate(() => window.__report)).toEqual({ questionId: 203, reason: "Mean to a classmate" });
});
