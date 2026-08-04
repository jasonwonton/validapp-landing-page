import { expect, test } from "@playwright/test";

async function signInToDemo(page) {
    await page.goto("/app/?demo=1");
    await page.getByRole("button", { name: /sign in with a passkey/i }).click();
    await expect(page.getByText("Hey, Jules")).toBeVisible();
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
    await dialog.getByLabel("First name").fill("Taylor");
    await dialog.getByLabel("Last name").fill("Jordan");
    await dialog.getByLabel("Username").fill("taylor_j");
    await dialog.getByLabel("Birthday").fill("2008-05-12");
    await dialog.getByLabel("Gender").selectOption("non-binary");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByLabel("School name").fill("Westview High School");
    await dialog.getByLabel("City").fill("San Diego");
    await dialog.getByLabel("State").fill("CA");
    await dialog.getByLabel("Grade").selectOption("Senior");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByText("No password. No phone number.")).toBeVisible();
    await dialog.getByLabel(/minimum age requirement/).check();
    await dialog.getByRole("button", { name: "Create with passkey" }).click();
    await expect(page.getByText("Hey, Taylor")).toBeVisible();
    await expect(page.locator("#profileSchool")).toHaveText("Westview High School");
    await expect(page.locator("#toast")).toContainText("Welcome to Valid");
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
    await page.getByRole("button", { name: "Profile", exact: true }).click();
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
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await expect(page.getByRole("button", { name: "Install Valid" })).toBeVisible();
    await page.getByRole("button", { name: "Install Valid" }).click();
    await expect(page.getByRole("button", { name: "Install Valid" })).toBeHidden();
});

test("feed navigation, filtering, and upvotes work", async ({ page }) => {
    await signInToDemo(page);
    await expect(page.getByText("Who always knows how to make people laugh?")).toBeVisible();
    await page.getByRole("button", { name: "School", exact: true }).click();
    await expect(page.getByText("Who has the best music taste?")).toBeVisible();
    await page.getByPlaceholder("Search names, questions...").fill("company");
    await expect(page.getByText("Who is most likely to start a company?")).toBeVisible();
    await expect(page.getByText("Who has the best music taste?")).toBeHidden();
    await page.getByPlaceholder("Search names, questions...").fill("");
    const upvote = page.locator("[data-upvote='9003']");
    await upvote.click();
    await expect(upvote).toHaveClass(/active/);
});

test("feed polls open the iOS-style detail and moderation flow", async ({ page }) => {
    await signInToDemo(page);
    await page.locator("[data-feed-detail='9001']").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "What happened" })).toBeVisible();
    await expect(dialog.getByText("Jules Rivera").first()).toBeVisible();
    await expect(dialog.locator(".feed-detail-option.selected")).toContainText("Jules Rivera");
    page.once("dialog", (confirmation) => confirmation.accept());
    await dialog.getByRole("button", { name: "Report question" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#toast")).toContainText("Question reported");
    await expect(page.locator("[data-feed-detail='9001']")).toHaveCount(0);
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
    await expect(page.getByRole("heading", { name: "Anonymous inbox" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Feed is locked" })).toHaveCount(0);
});

test("anonymous inbox supports private answers and safety controls", async ({ page }) => {
    await signInToDemo(page);
    await expect(page.getByRole("heading", { name: "Anonymous inbox" })).toBeVisible();
    await expect(page.locator("#anonymousUnreadCount")).toHaveText("1 new");
    await page.getByRole("button", { name: /What is something you are genuinely proud/ }).click();
    const answerDialog = page.getByRole("dialog");
    await expect(answerDialog.getByText("Fully anonymous guest")).toBeVisible();
    await answerDialog.getByLabel("Your answer").fill("Helping my friends through a hard semester.");
    await answerDialog.getByRole("button", { name: "Answer privately" }).click();
    await expect(answerDialog.getByText(/Answered.*10 aura/)).toBeVisible();
    await expect(page.locator("#auraCount")).toHaveText("1,290");
    await answerDialog.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: /Who has been making school better lately/ }).click();
    page.once("dialog", (confirmation) => confirmation.accept());
    await page.getByRole("dialog").getByRole("button", { name: "Report" }).click();
    await expect(page.locator("#toast")).toContainText("Reported to Valid");
    await expect(page.getByRole("button", { name: /Who has been making school better lately/ })).toHaveCount(0);
});

test("play answers a poll and advances", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByText("Who would survive longest on a deserted island?")).toBeVisible();
    await page.locator("[data-choice]").first().click();
    await expect(page.getByText("Who should plan the senior trip?")).toBeVisible();
    await expect(page.locator("#toast")).toContainText("You picked");
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
});

test("profile exposes editing, ask link, and school question flows", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Jules Rivera" })).toBeVisible();
    await expect(page.getByText("Your link is live")).toBeVisible();
    await page.getByRole("button", { name: "Edit profile" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Edit profile" })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: /Submit a school question/i }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Submit a school question" })).toBeVisible();
});

test("classmate discovery is selected-contact only and never sends SMS", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.locator("#findClassmatesButton").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("No one will be texted.")).toBeVisible();
    await dialog.getByRole("button", { name: "Choose from contacts" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#toast")).toContainText("Classmates are ready for Play");
});

test("account deletion is deliberate and keeps the five-day recovery path", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.getByRole("button", { name: "Delete account" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("You have 5 days to change your mind.")).toBeVisible();
    await dialog.getByLabel(/Type DELETE/).fill("DELETE");
    await dialog.getByRole("button", { name: "Schedule account deletion" }).click();
    await expect(page.getByText(/Account deletion is scheduled for/)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in with a passkey/i })).toBeVisible();
    await page.getByRole("button", { name: /sign in with a passkey/i }).click();
    const recoveryDialog = page.getByRole("dialog");
    await expect(recoveryDialog.getByRole("heading", { name: "Your account is scheduled for deletion" })).toBeVisible();
    await recoveryDialog.getByRole("button", { name: "Keep my account" }).click();
    await expect(recoveryDialog).toBeHidden();
    await expect(page.locator("#toast")).toContainText("staying on Valid");
});
