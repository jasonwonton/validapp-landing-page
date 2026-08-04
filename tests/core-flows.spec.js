import { expect, test } from "@playwright/test";

async function signInToDemo(page) {
    await page.goto("/app/?demo=1");
    await page.getByRole("button", { name: /sign in with a passkey/i }).click();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toBeVisible();
}

async function fillSignupThroughUsername(dialog, username = "taylor_j") {
    await dialog.getByLabel("School name").fill("Westview High School");
    await dialog.getByLabel("City").fill("San Diego");
    await dialog.getByLabel("State").fill("CA");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Grade").selectOption("Senior");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Birthday").fill("2008-05-12");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("First name").fill("Taylor");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Last name").fill("Jordan");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("Username").fill(username);
    await dialog.getByRole("button", { name: "Continue" }).click();
}

test("signed-out experience is clear and passkey-only", async ({ page }) => {
    await page.goto("/app/?demo=1");
    await expect(page.getByRole("heading", { name: "Your feed is ready." })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in with a passkey/i })).toBeVisible();
    await expect(page.getByText(/fingerprint or face stays on your device/i)).toBeVisible();
});

test("new users can complete passkey-only school onboarding", async ({ page }) => {
    await page.goto("/app/?demo=1");
    await page.getByRole("button", { name: "Create an account" }).click();
    const dialog = page.getByRole("dialog");
    await fillSignupThroughUsername(dialog);
    await dialog.getByLabel("Gender").selectOption("non-binary");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByText("No password. No phone number.")).toBeVisible();
    await dialog.getByLabel(/Profile photo/).setInputFiles({
        name: "avatar.png",
        mimeType: "image/png",
        buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    await dialog.getByLabel(/minimum age requirement/).check();
    await dialog.getByRole("button", { name: "Create with passkey" }).click();
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
    await expect(page.locator("#toast")).toContainText("Welcome to Valid");
    await expect(page.getByRole("dialog").getByText("No one will be texted.")).toBeVisible();
});

test("signup rejects unavailable profile language before creating a passkey", async ({ page }) => {
    await page.goto("/app/?demo=1");
    await page.getByRole("button", { name: "Create an account" }).click();
    const dialog = page.getByRole("dialog");
    await fillSignupThroughUsername(dialog, "f4gg0t_sn1gger");
    await expect(dialog.locator("#signupStatus")).toHaveText("That username is not available. Try another one.");
    await expect(dialog.getByText("Pick a username")).toBeVisible();
});

test("onboarding keeps each step heading visible on compact phones", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto("/app/?demo=1");
    await page.getByRole("button", { name: "Create an account" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("What school do you go to?")).toBeInViewport();
    await dialog.getByLabel("School name").fill("Westview High School");
    await dialog.getByLabel("City").fill("San Diego");
    await dialog.getByLabel("State").fill("CA");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByText("What grade are you in?")).toBeInViewport();
});

test("mobile shell stays within interaction performance budgets", async ({ page }) => {
    await page.addInitScript(() => {
        window.__validMetrics = { cls: 0, longTasks: 0 };
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                if (!entry.hadRecentInput) window.__validMetrics.cls += entry.value;
            }
        }).observe({ type: "layout-shift", buffered: true });
        if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
            new PerformanceObserver((list) => { window.__validMetrics.longTasks += list.getEntries().length; })
                .observe({ type: "longtask", buffered: true });
        }
    });
    await signInToDemo(page);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.waitForTimeout(300);
    const metrics = await page.evaluate(() => {
        const navigation = performance.getEntriesByType("navigation")[0];
        return {
            domContentLoaded: navigation.domContentLoadedEventEnd,
            load: navigation.loadEventEnd,
            ...window.__validMetrics,
        };
    });
    expect(metrics.domContentLoaded).toBeLessThan(1500);
    expect(metrics.load).toBeLessThan(2500);
    expect(metrics.cls).toBeLessThan(0.1);
    expect(metrics.longTasks).toBeLessThanOrEqual(1);
});

test("reduced-motion users do not receive panel animations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signInToDemo(page);
    const durationSeconds = await page.locator("#feedPanel").evaluate((element) => {
        const value = getComputedStyle(element).animationDuration;
        return value.endsWith("ms") ? Number.parseFloat(value) / 1000 : Number.parseFloat(value);
    });
    expect(durationSeconds).toBeLessThanOrEqual(0.001);
});

test("strict production CSP permits dynamic progress UI", async ({ page }) => {
    const violations = [];
    page.on("console", (message) => {
        if (message.text().includes("Content Security Policy")) violations.push(message.text());
    });
    await page.goto("/app/?demo=1&locked=1");
    await page.getByRole("button", { name: /sign in with a passkey/i }).click();
    await expect(page.locator(".feed-gate-progress")).toBeVisible();
    expect(violations).toEqual([]);
});

test("android shell surfaces connectivity and install affordances", async ({ page, context }) => {
    await signInToDemo(page);
    await context.setOffline(true);
    await expect(page.locator("#networkBanner")).toBeVisible();
    await expect(page.locator("#networkBanner")).toContainText("offline");
    await context.setOffline(false);
    await expect(page.locator("#networkBanner")).toBeHidden();

    await page.evaluate(() => {
        const event = new Event("beforeinstallprompt", { cancelable: true });
        event.prompt = () => Promise.resolve();
        event.userChoice = Promise.resolve({ outcome: "dismissed" });
        dispatchEvent(event);
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("button", { name: "Install Valid" })).toBeVisible();
    await page.getByRole("button", { name: "Install Valid" }).click();
    await expect(page.getByRole("button", { name: "Install Valid" })).toBeHidden();
});

test("feed navigation, filtering, and upvotes work", async ({ page }) => {
    await signInToDemo(page);
    await expect(page.getByText("Who always knows how to make people laugh?")).toBeVisible();
    await expect(page.locator("#feedList .feed-section-heading")).toHaveCount(0);
    await page.getByRole("button", { name: "School", exact: true }).click();
    await expect(page.getByText("Who has the best music taste?")).toBeVisible();
    await expect(page.locator("#feedList .feed-section-heading")).toHaveCount(0);
    await page.getByPlaceholder("Search names, questions...").fill("company");
    await expect(page.getByText("Who is most likely to start a company?")).toBeVisible();
    await expect(page.getByText("Who has the best music taste?")).toBeHidden();
    await page.getByPlaceholder("Search names, questions...").fill("");
    const upvote = page.locator("[data-upvote='9003']");
    await upvote.click();
    await expect(upvote).toHaveClass(/active/);
    await page.locator("[data-feed-detail='9003']").click();
    const detail = page.locator("#feedDetailDialog");
    await expect(detail.getByRole("heading", { name: "Who has the best music taste?" })).toBeVisible();
});

test("feed search includes classmates and filters their school activity", async ({ page }) => {
    await signInToDemo(page);
    await page.getByPlaceholder("Search names, questions...").fill("Maya");
    await expect(page.locator("#feedList [data-anonymous-question]")).toHaveCount(0);
    const classmateResult = page.locator("[data-feed-classmate='classmate-1']");
    await expect(classmateResult).toContainText("Maya Chen");
    await classmateResult.click();
    await expect(page.getByRole("button", { name: "School", exact: true })).toHaveClass(/active/);
    await expect(page.getByText("Who has the best music taste?")).toBeVisible();
    await expect(page.getByText("Who is most likely to start a company?")).toBeHidden();
});

test("feed polls open the iOS-style detail and moderation flow", async ({ page }) => {
    await signInToDemo(page);
    await page.locator("[data-feed-detail='9001']").click();
    const dialog = page.locator("#feedDetailDialog");
    await expect(dialog).toHaveCSS("position", "fixed");
    await expect(dialog.getByText("Poll", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Jules Rivera").first()).toBeVisible();
    await expect(dialog.locator(".feed-detail-option.selected")).toContainText("Jules Rivera");
    await expect(dialog.getByRole("button", { name: "Share poll to Snapchat" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Share poll to Instagram" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Share poll to TikTok" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Get God Mode to Reveal who sent this" })).toBeVisible();
    page.once("dialog", (confirmation) => confirmation.accept());
    await dialog.getByRole("button", { name: "Report question" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#toast")).toContainText("Question reported");
    await expect(page.locator("[data-feed-detail='9001']")).toHaveCount(0);
});

test("non-subscribers can reach God Mode from a received vote", async ({ page }) => {
    await signInToDemo(page);
    await page.locator("[data-feed-detail='9001']").click();
    await page.getByRole("button", { name: "Get God Mode to Reveal who sent this" }).click();
    await expect(page.getByText("God Mode", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Start God Mode in iPhone app" })).toHaveAttribute("href", /apps\.apple\.com/);
    await expect(page.locator("#godModeCard")).toHaveClass(/attention/);
    await expect(page.locator("#feedDetailDialog")).toBeHidden();
});

test("new users vote to unlock Feed just like iOS", async ({ page }) => {
    await page.goto("/app/?demo=1&locked=1");
    await page.getByRole("button", { name: /sign in with a passkey/i }).click();
    await expect(page.getByRole("heading", { name: "Feed is locked" })).toBeVisible();
    await expect(page.getByText("1 / 3 votes cast")).toBeVisible();
    await page.getByRole("button", { name: "Vote now to unlock Feed" }).click();
    await expect(page.getByText("Who would survive longest on a deserted island?")).toBeVisible();
    await page.locator("[data-choice]").first().click();
    await page.locator("[data-choice]").first().click();
    await page.getByRole("button", { name: "Feed", exact: true }).click();
    await expect(page.getByRole("button", { name: /What is something you are genuinely proud/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Feed is locked" })).toHaveCount(0);
});

test("anonymous inbox supports private answers and safety controls", async ({ page }) => {
    await signInToDemo(page);
    await expect(page.locator("#feedList [data-anonymous-answer]")).toHaveCount(1);
    await expect(page.locator("#feedList [data-anonymous-question]")).toHaveCount(2);
    await expect(page.locator("#feedList [data-feed-detail]")).toHaveCount(2);
    await expect(page.locator("#feedList > *").first()).toHaveAttribute("data-anonymous-answer", "answer-demo-1");
    await expect(page.getByRole("heading", { name: "Anonymous questions" })).toHaveCount(0);
    await page.getByRole("button", { name: /What is something you are genuinely proud/ }).click();
    const answerDialog = page.locator("#anonymousQuestionDialog");
    await expect(answerDialog).toHaveCSS("position", "fixed");
    await expect(answerDialog.getByText("Fully anonymous guest")).toBeVisible();
    await answerDialog.getByLabel("Your reply").fill("Helping my friends through a hard semester.");
    await answerDialog.getByRole("button", { name: "Send reply" }).click();
    await expect(answerDialog.getByText(/Answered.*10 aura/)).toBeVisible();
    await expect(answerDialog.getByRole("button", { name: "Share answer to Snapchat" })).toBeVisible();
    await expect(answerDialog.getByRole("button", { name: "Share answer to Instagram" })).toBeVisible();
    await expect(answerDialog.getByRole("button", { name: "Share answer to TikTok" })).toBeVisible();
    await expect(page.locator("#auraCount")).toHaveText("1,290");
    await answerDialog.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: /Maya Chen replied to you/ }).click();
    const replyDialog = page.getByRole("dialog");
    await expect(replyDialog.getByText("What always makes you laugh in class?")).toBeVisible();
    await expect(replyDialog.getByText("Your impressions of our history teacher 😂")).toBeVisible();
    await replyDialog.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: /Who has been making school better lately/ }).click();
    page.once("dialog", (confirmation) => confirmation.accept());
    await page.locator("#anonymousQuestionDialog").getByRole("button", { name: "Report" }).click();
    await expect(page.locator("#toast")).toContainText("Reported to Valid");
    await expect(page.getByRole("button", { name: /Who has been making school better lately/ })).toHaveCount(0);
});

test("play answers a poll and advances", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.locator(".play-streak-chip")).toContainText("7");
    await expect(page.locator(".play-streak-chip")).toContainText("1.5x");
    await expect(page.locator("#auraCount")).toHaveText("1,280");
    for (const name of [/Shuffle/, /Nominate/, /Skip \(3\)/]) {
        const button = page.getByRole("button", { name });
        await expect(button).toBeVisible();
        const withinVisualViewport = await button.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const viewport = window.visualViewport;
            return !viewport || (bounds.top >= viewport.offsetTop && bounds.bottom <= viewport.offsetTop + viewport.height);
        });
        expect(withinVisualViewport).toBe(true);
    }
    await expect(page.getByText("Who would survive longest on a deserted island?")).toBeVisible();
    await page.locator("[data-choice]").first().click();
    await expect(page.getByText("Who should plan the senior trip?")).toBeVisible();
    await expect(page.locator("#auraCount")).toHaveText("1,285");
    await expect(page.locator("#toast")).toContainText("+5 aura · You picked");
});

test("play supports shuffle and paid classmate nominations", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByRole("button", { name: /Shuffle/ })).toBeVisible();
    await page.getByRole("button", { name: /Shuffle/ }).click();
    await page.getByRole("button", { name: /Nominate/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Nominate someone" })).toBeVisible();
    await expect(dialog.getByText("100").first()).toBeVisible();
    const candidate = dialog.locator("[data-nomination]").first();
    const name = await candidate.locator("strong").textContent();
    page.once("dialog", (confirmation) => confirmation.accept());
    await candidate.click();
    await expect(page.locator("#toast")).toContainText(`You nominated ${name}`);
});

test("play matches the iOS per-set skip limit", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByRole("button", { name: "Skip (3)" })).toBeVisible();
    await page.getByRole("button", { name: "Skip (3)" }).click();
    await page.getByRole("button", { name: "Skip (2)" }).click();
    await page.getByRole("button", { name: "Skip (1)" }).click();
    await expect(page.getByRole("button", { name: "Skip (0)" })).toBeDisabled();
});

test("play exposes safety controls for classmate-submitted polls", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.locator("[data-choice]").first().click();
    await expect(page.getByText("Who should plan the senior trip?")).toBeVisible();
    page.once("dialog", (confirmation) => confirmation.accept());
    await page.getByRole("button", { name: "Report question" }).click();
    await expect(page.locator("#toast")).toContainText("Reported to Valid");
    await expect(page.getByText("Who gives the best advice?")).toBeVisible();
});

test("completing a poll set celebrates earned aura before cooldown", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    for (let answered = 0; answered < 4; answered += 1) {
        await page.locator("[data-choice]").first().click();
    }
    await expect(page.getByRole("heading", { name: "Congrats!" })).toBeVisible();
    await expect(page.getByText("You just earned 20 aura")).toBeVisible();
    await expect(page.locator("#auraCount")).toHaveText("1,300");
    await page.getByRole("button", { name: "W aura" }).click();
    await expect(page.getByRole("heading", { name: "Next Poll Set Locked" })).toBeVisible();
    await expect(page.locator("#playLockMessage")).toContainText(/Unlocks in (0:5\d|1:00)/);
});

test("settings exposes iOS-style editing, polls, ask link, and aura purchases", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Jules Rivera" })).toBeVisible();
    await expect(page.getByText("Get messages", { exact: true })).toBeVisible();
    await expect(page.getByText("God Mode", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Start God Mode in iPhone app" })).toBeVisible();
    await expect(page.locator("#purchasesSection .settings-aura-balance")).toHaveCount(0);
    const schoolRanks = page.locator("#schoolCard .school-rank-card");
    await expect(schoolRanks.nth(0)).toContainText("Maya Chen");
    await expect(schoolRanks.nth(0)).toContainText("22 this week");
    await expect(schoolRanks.nth(1)).toContainText("Noah Williams");
    await expect(schoolRanks.nth(2)).toContainText("Jules Rivera (You)");
    await expect(page.getByRole("button", { name: "Change profile picture" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Open poll: Who always knows/ })).toBeVisible();
    await page.getByRole("button", { name: /Open poll: Who always knows/ }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Who always knows how to make people laugh?" })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await expect(page.getByText("1 passkey registered · no SMS recovery")).toBeVisible();
    await page.getByRole("button", { name: "Add a backup passkey" }).click();
    await expect(page.getByText("2 passkeys registered · no SMS recovery")).toBeVisible();
    await expect(page.locator("#toast")).toContainText("Backup passkey added");
    await page.getByRole("button", { name: "Profile information" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Profile information" })).toBeVisible();
    await expect(page.getByRole("dialog").getByLabel("Bio")).toHaveCount(0);
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await page.locator("[data-edit-bio]").click();
    const bioDialog = page.getByRole("dialog").filter({ hasText: "EDIT BIO" });
    await bioDialog.getByLabel("Bio").fill("Senior year, good music, better people.");
    await bioDialog.getByRole("button", { name: "Save bio" }).click();
    await expect(page.locator("[data-edit-bio]")).toHaveText("Senior year, good music, better people.");
    await page.getByRole("button", { name: /Submit a school question for/i }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Submit a school question" })).toBeVisible();
});

test("settings shows aura balance and confirms boost spending", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const profileAura = page.locator("#profileCard .profile-stat-card").filter({ hasText: "Aura" });
    await expect(profileAura).toContainText("1,280");
    await page.getByRole("button", { name: "Get boosted for 400 aura" }).click();
    const confirmation = page.getByRole("dialog").filter({ hasText: "Get Boosted" });
    await expect(confirmation.getByText("880 aura")).toBeVisible();
    await confirmation.getByRole("button", { name: "Spend 400 aura" }).click();
    await expect(profileAura).toContainText("880");
    await expect(page.getByRole("button", { name: "Global boost active" })).toBeDisabled();
});

test("settings browses and searches classmates with public profile details", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "View classmates" }).click();
    const directory = page.getByRole("dialog").filter({ hasText: "YOUR SCHOOL" });
    await expect(directory.getByText("6 classmates")).toBeVisible();
    await directory.getByPlaceholder("Search classmates...").fill("Maya");
    await expect(directory.getByRole("button", { name: /Maya Chen/ })).toBeVisible();
    await expect(directory.getByRole("button", { name: /Noah Williams/ })).toBeHidden();
    await directory.getByRole("button", { name: /Maya Chen/ }).click();
    const profile = page.getByRole("dialog").filter({ hasText: "CLASSMATE PROFILE" });
    await expect(profile.getByRole("heading", { name: "Maya Chen" })).toBeVisible();
    await expect(profile.getByText("Student council and bad puns.")).toBeVisible();
    await expect(profile.getByText("61")).toBeVisible();
    await profile.getByRole("button", { name: "Back to classmates" }).click();
    await expect(directory).toBeVisible();
});

test("God Mode subscribers can reveal a vote sender and consume one weekly reveal", async ({ page }) => {
    await page.goto("/app/?demo=1&godmode=1");
    await page.getByRole("button", { name: /sign in with a passkey/i }).click();
    await page.locator("[data-feed-detail='9001']").click();
    const detail = page.locator("#feedDetailDialog");
    await expect(detail.getByRole("button", { name: "Reveal who sent this (3 remaining)" })).toBeVisible();
    await detail.getByRole("button", { name: "Reveal who sent this (3 remaining)" }).click();
    await expect(detail.getByText("Sent by")).toBeVisible();
    await expect(detail.locator(".revealed-sender-card").getByText("Maya Chen", { exact: true })).toBeVisible();
    await expect(page.locator("#toast")).toContainText("Revealed: Maya Chen");
    await detail.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByText("God Mode Active")).toBeVisible();
    await expect(page.getByText(/2 weekly reveals left/)).toBeVisible();
});

test("settings removes the Find classmates shortcut", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("button", { name: "Find classmates" })).toHaveCount(0);
});

test("settings hides account deletion and policy shortcuts", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("button", { name: "Delete account" })).toHaveCount(0);
    await expect(page.getByText("Privacy policy", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Safety & support", { exact: true })).toHaveCount(0);
});
