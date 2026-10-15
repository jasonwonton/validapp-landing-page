import { test, expect } from "@playwright/test";

// Feed and navigation flows matched to iOS 1.6034 (docs/pwa-ios-flow-audit-2026-10-15.md §4, §7).

async function signIn(page, query = "") {
    await page.goto(`/app/?demo=1&signin=1${query}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toBeVisible();
}

async function openFirstInboxPoll(page) {
    await page.locator("[data-feed-detail]").first().locator(".feed-question").click();
    const detail = page.getByRole("dialog", { name: "Poll details" });
    await expect(detail).toBeVisible();
    return detail;
}

test.describe("tab bar", () => {
    test("is icons only, one ink, with the selected tab filled and iOS badges", async ({ page }) => {
        await signIn(page);
        const nav = page.locator("#bottomNav");
        for (const name of ["Feed", "Play", "Chats", "Profile"]) {
            const tab = nav.getByRole("button", { name, exact: true });
            await expect(tab).toBeVisible();
            // No visible label: only the icon and, at most, a badge.
            await expect(tab.locator("span:not(.nav-icon-wrap):not(.tab-badge)")).toHaveCount(0);
        }
        const feed = nav.getByRole("button", { name: "Feed", exact: true });
        const play = nav.getByRole("button", { name: "Play", exact: true });
        await expect(feed.locator('[data-ui-icon="tab-feed-filled"]')).toBeVisible();
        await expect(feed.locator('[data-ui-icon="tab-feed"]')).toBeHidden();
        await expect(play.locator('[data-ui-icon="tab-play"]')).toBeVisible();
        expect(await feed.evaluate((el) => getComputedStyle(el).color)).toBe(await play.evaluate((el) => getComputedStyle(el).color));

        await play.click();
        await expect(play.locator('[data-ui-icon="tab-play-filled"]')).toBeVisible();
        await expect(feed.locator('[data-ui-icon="tab-feed"]')).toBeVisible();

        const badge = page.locator("#feedTabBadge");
        await expect(badge).toBeVisible();
        await expect(badge).toHaveCSS("background-color", "rgb(255, 59, 48)");
        await expect(badge).toHaveCSS("border-top-width", "0px");
        expect(await badge.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Jua");
        // The demo profile has a photo, so Profile shows no "!".
        await expect(page.locator("#profileTabBadge")).toBeHidden();
    });
});

test.describe("Feed", () => {
    test("the unlocked Feed has no notification card", async ({ page }) => {
        await signIn(page);
        await expect(page.locator("#feedList [data-feed-detail]").first()).toBeVisible();
        await expect(page.getByText("Don’t miss your next vote")).toHaveCount(0);
        await expect(page.locator("#feedSearch")).toHaveAttribute("placeholder", "Search your inbox...");
        await page.getByRole("button", { name: "School", exact: true }).click();
        await expect(page.locator("#feedSearch")).toHaveAttribute("placeholder", "Search your school...");
    });

    test("the vote lock counts unread votes like iOS", async ({ page }) => {
        await signIn(page, "&locked=1");
        const lock = page.locator("#feedGateLock");
        await expect(lock.getByText("2 NEW VOTES")).toBeVisible();
        await expect(lock.getByRole("heading", { name: "You got voted for" })).toBeVisible();
        await expect(lock).toContainText("See what people are saying.");
        await expect(lock).toContainText("1 / 3 votes cast");
        // Shown until vote alerts are on (the demo browser may already have them).
        await expect(lock.locator(".feed-lock-alerts")).toContainText("Turn on vote alertsKnow right away when someone picks you.");
        await lock.getByRole("button", { name: "Vote now to unlock Feed" }).click();
        await expect(page.locator("#playPanel")).toBeVisible();
    });

    test("the Inbox has a Give a TBH card, New/Earlier sections and pages by itself", async ({ page }) => {
        await signIn(page, "&feedpages=1");
        const list = page.locator("#feedList");
        await expect(list.locator(".inbox-section-header").first()).toHaveText("New");
        await expect(list.getByRole("heading", { name: "Earlier" })).toBeVisible();
        await expect(page.locator("#loadMoreFeed")).not.toHaveText("Load more");

        const card = list.getByRole("button", { name: "Give a TBH. 1 requests waiting." });
        await expect(card).toContainText("1 classmate is waiting for your honest take");
        await card.click();
        const sheet = page.getByRole("dialog", { name: "Give a TBH" });
        await expect(sheet).toBeVisible();
        await expect(sheet).toContainText("TBH for Maya");
        await sheet.getByRole("button", { name: "Close" }).click();
        await expect(sheet).toBeHidden();

        // 45 polls, 20 per page: scrolling to the end loads the rest without a button.
        await expect.poll(async () => {
            await page.mouse.wheel(0, 4000);
            return list.locator("[data-feed-detail]").count();
        }, { timeout: 15_000 }).toBe(45);
    });

    test("School nominations say got nominated and names open profiles", async ({ page }) => {
        await signIn(page, "&nominations=1");
        await page.getByRole("button", { name: "School", exact: true }).click();
        const row = page.locator("[data-feed-detail='9010']");
        await expect(row).toContainText("Ava Patel got nominated");
        await expect(row.locator(".inbox-content-badge")).toHaveCount(0);
        await page.getByRole("button", { name: "Open Maya Chen’s profile." }).click();
        await expect(page.locator("#classmateProfileDialog")).toBeVisible();
    });
});

test.describe("poll detail", () => {
    test("shows share row, then Reveal, then reactions, comments and Send", async ({ page }) => {
        await signIn(page);
        const detail = await openFirstInboxPoll(page);
        const top = async (locator) => (await locator.boundingBox()).y;
        const share = await top(detail.getByRole("button", { name: "Share poll to Snapchat" }));
        const reveal = await top(detail.getByRole("button", { name: "Get God Mode to Reveal who sent this" }));
        const send = await top(detail.getByRole("button", { name: "Send poll" }));
        expect(share).toBeLessThan(reveal);
        expect(reveal).toBeLessThan(send);
        await expect(detail.getByRole("button", { name: "Back" })).toBeVisible();
        await expect(detail.locator(".feed-detail-first-letter-hint")).toHaveCount(0);
    });

    test("asks before spending a free reveal", async ({ page }) => {
        await signIn(page, "&godmode=1");
        const detail = await openFirstInboxPoll(page);
        await detail.getByRole("button", { name: "Reveal who sent this (2 remaining)" }).click();
        const confirm = page.getByRole("dialog", { name: "Reveal who sent this?" });
        await expect(confirm).toContainText("This uses 1 of your weekly reveals. You will have 1 reveal left.");
        const cancel = confirm.getByRole("button", { name: "Cancel" });
        const use = confirm.getByRole("button", { name: "Use 1 Reveal" });
        expect((await cancel.boundingBox()).x).toBeLessThan((await use.boundingBox()).x);
        await cancel.click();
        await expect(detail.getByRole("button", { name: "Reveal who sent this (2 remaining)" })).toBeVisible();

        await detail.getByRole("button", { name: "Reveal who sent this (2 remaining)" }).click();
        await page.getByRole("dialog", { name: "Reveal who sent this?" }).getByRole("button", { name: "Use 1 Reveal" }).click();
        await expect(detail.locator("#feedDetailRevealedSender")).toContainText("Sent by");
        await expect(detail.locator("#revealFeedSenderButton")).toBeHidden();
    });

    test("uses the iOS moderation menu and report confirm with a reason", async ({ page }) => {
        await signIn(page);
        const detail = await openFirstInboxPoll(page);
        await detail.getByRole("button", { name: "More poll actions" }).click();
        await expect(detail.getByRole("menuitem", { name: "Delete This Question" })).toBeVisible();
        await detail.getByRole("menuitem", { name: "Report a Safety Issue" }).click();
        const confirm = page.getByRole("dialog", { name: "Report a Safety Issue" });
        await expect(confirm).toContainText("Reporting hides the question across your feeds and sends it for review.");
        await confirm.getByPlaceholder("Explain why you're reporting this question...").fill("Mean to a classmate");
        await confirm.getByRole("button", { name: "Report for Review" }).click();
        await expect(detail).toBeHidden();
    });

    test("comments open as a sheet with Done on the right", async ({ page }) => {
        await signIn(page);
        await page.getByRole("button", { name: "School", exact: true }).click();
        await page.locator("[data-feed-detail='9003'] .feed-question").click();
        await page.getByRole("dialog", { name: "Poll details" }).getByRole("button", { name: "Open 4 comments" }).click();
        const comments = page.getByRole("dialog", { name: "Comments" });
        await expect(comments).toBeVisible();
        const sheet = comments.locator(".comments-sheet");
        const viewport = page.viewportSize();
        const box = await sheet.boundingBox();
        expect(box.y).toBeGreaterThan(viewport.height * 0.2);
        const done = comments.getByRole("button", { name: "Done" });
        const title = comments.getByText("Comments", { exact: true });
        expect((await done.boundingBox()).x).toBeGreaterThan((await title.boundingBox()).x);
        await expect(comments.locator("#commentCharacterCount")).toHaveCount(0);
        await done.click();
        await expect(comments).toBeHidden();
    });

    test("the God Mode paywall is a sheet with the iOS benefits and renewal terms", async ({ page }) => {
        await signIn(page);
        const detail = await openFirstInboxPoll(page);
        await detail.getByRole("button", { name: "Get God Mode to Reveal who sent this" }).click();
        const pitch = page.locator("#godModePitchDialog");
        await expect(pitch).toBeVisible();
        await expect(pitch.locator(".god-mode-pitch-grabber")).toBeVisible();
        await expect(pitch.getByRole("button", { name: "Close God Mode" })).toHaveCount(0);
        await expect(pitch).toContainText("Reveal voters or anonymous school-question authors up to 2 times every week.");
        await expect(pitch).toContainText("renews every week until you cancel");
        await pitch.getByRole("button", { name: "Maybe later" }).click();
        await expect(pitch).toBeHidden();
    });
});

test.describe("on iPhone", () => {
    test.use({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1", hasTouch: true });

    test("modals are bottom sheets, not centred cards", async ({ page }) => {
        await signIn(page);
        await page.locator("#feedList [data-reactors]").first().click();
        const sheet = page.locator("#reactorListDialog");
        await expect(sheet).toBeVisible();
        // Measured once the sheet has finished rising.
        await expect.poll(async () => {
            const box = await sheet.boundingBox();
            return Math.round(box.y + box.height) >= 843 && box.width >= 389;
        }).toBe(true);
    });
});
