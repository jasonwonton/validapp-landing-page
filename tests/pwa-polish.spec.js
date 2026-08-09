import { expect, test } from "@playwright/test";

async function signInToDemo(page, query = "") {
    await page.goto(`/app/?demo=1&signin=1${query}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toBeVisible();
}

test("bottom navigation clearly marks Feed, Play, and Settings as current", async ({ page }) => {
    await signInToDemo(page);
    const feed = page.getByRole("button", { name: "Feed", exact: true });
    const play = page.getByRole("button", { name: "Play", exact: true });
    const settings = page.getByRole("button", { name: "Settings", exact: true });

    await expect(feed).toHaveAttribute("aria-current", "page");
    await expect(feed).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await play.click();
    await expect(play).toHaveAttribute("aria-current", "page");
    await expect(feed).not.toHaveAttribute("aria-current", "page");
    await settings.click();
    await expect(settings).toHaveAttribute("aria-current", "page");
    await expect(play).not.toHaveAttribute("aria-current", "page");
});

test("God Mode actions avoid duplicate icons and overflow dots are centered", async ({ page }) => {
    await signInToDemo(page);
    await page.locator("[data-feed-detail='9001']").click();
    const overflow = page.getByRole("button", { name: "More poll actions" });
    await expect(overflow).toHaveCSS("padding-top", "0px");
    await expect(overflow).toHaveCSS("padding-bottom", "0px");
    expect(await overflow.evaluate((element) => getComputedStyle(element, "::before").content)).toBe('"•••"');
    const revealButton = page.getByRole("button", { name: "Get God Mode to Reveal who sent this" });
    await expect(revealButton.locator("img")).toHaveCount(0);
    expect(await revealButton.evaluate((element) => getComputedStyle(element, "::before").backgroundImage)).toContain("crown.png");
    await page.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const startCard = page.locator(".god-mode-start-button");
    await expect(startCard.locator("img")).toHaveCount(0);
    await startCard.click();
    const pitch = page.getByRole("dialog", { name: "God Mode" });
    await expect(pitch.locator(".god-mode-earn-button img, .god-mode-checkout-button img")).toHaveCount(0);
});

test("insufficient-aura purchase buttons are black and disabled", async ({ page }) => {
    await signInToDemo(page, "&aura=50");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const buttons = page.locator("#auraPurchases .aura-price-button.insufficient");
    await expect(buttons).toHaveCount(3);
    for (const button of await buttons.all()) {
        await expect(button).toBeDisabled();
        await expect(button).toHaveCSS("background-color", "rgb(0, 0, 0)");
        await expect(button).toHaveCSS("color", "rgb(255, 255, 255)");
    }
});

test("Ask Me link can be paused, resumed, and reset from Settings", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const askCard = page.locator("#askLinkCard");
    await askCard.getByRole("button", { name: "Pause link" }).click();
    await expect(askCard.getByText("Ask Me is off.", { exact: false })).toBeVisible();
    await askCard.getByRole("button", { name: "Turn on Ask Me" }).click();
    await expect(askCard.getByRole("button", { name: "Pause link" })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await askCard.getByRole("button", { name: "Reset link" }).click();
    await expect(page.locator("#toast")).toContainText("New ask me link created");
});

test("Ask Me restriction copy does not invite a timed-out user to turn it on", async ({ page }) => {
    await signInToDemo(page, "&askrestriction=timeout");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const askCard = page.locator("#askLinkCard");

    await expect(askCard.getByText("Ask Me access restricted")).toBeVisible();
    await expect(askCard.getByText("paused for 14 days", { exact: false })).toBeVisible();
    await expect(askCard.getByRole("button", { name: "Access restricted" })).toBeDisabled();
    await expect(askCard.getByText("Turn it on whenever", { exact: false })).toHaveCount(0);
    await expect(askCard.getByRole("button", { name: "Ask Me safety notices" })).toHaveCount(0);
});

test("Ask Me safety notices require acknowledgement and remain available in history", async ({ page }) => {
    await signInToDemo(page, "&safetynotice=1");
    const notice = page.getByRole("dialog", { name: "Ask Me safety warning" });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("violate our safety rules");
    await notice.getByRole("button", { name: "I understand" }).click();
    await expect(notice).toBeHidden();

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Ask Me safety notices" }).click();
    const history = page.getByRole("dialog", { name: "Safety notices" });
    await expect(history).toContainText("Ask Me safety warning");
});

test("Ask Me reports distinguish guests from signed-in member senders", async ({ page }) => {
    await signInToDemo(page);

    await page.locator(".anonymous-question-row").filter({ hasText: "genuinely proud" }).click();
    await page.getByRole("button", { name: "More message actions" }).click();
    await page.getByRole("menuitem", { name: "Report and remove" }).click();
    let reportDialog = page.getByRole("dialog", { name: "Report and remove" });
    await expect(reportDialog).toContainText("no person, browser, or device will be blocked");
    await reportDialog.getByLabel("Harassment or bullying").check();
    await reportDialog.getByRole("button", { name: "Report and remove" }).click();
    await expect(page.locator("#toast")).toContainText("Reported and removed");

    await page.locator(".anonymous-question-row").filter({ hasText: "making school better" }).click();
    await page.getByRole("button", { name: "More message actions" }).click();
    await page.getByRole("menuitem", { name: "Report and block sender" }).click();
    reportDialog = page.getByRole("dialog", { name: "Report and block sender" });
    await expect(reportDialog).toContainText("block this account");
});

test("Settings feedback form accepts a message and optional screenshot", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Leave feedback" }).click();
    const dialog = page.getByRole("dialog", { name: "Leave feedback" });
    await dialog.getByLabel("What should we improve?").fill("Make the active tab easier to spot.");
    await dialog.getByLabel("Add a screenshot (optional)").setInputFiles({
        name: "screen.png",
        mimeType: "image/png",
        buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });
    await dialog.getByRole("button", { name: "Send feedback" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#toast")).toContainText("Thanks — feedback sent");
});

test("push worker preserves separate notifications unless the server supplies a tag", async ({ page }) => {
    const worker = await page.request.get("/app/service-worker.js").then((response) => response.text());
    expect(worker).toContain("tag,");
    expect(worker).toContain("renotify: Boolean(tag)");
    expect(worker).not.toContain('tag: payload.tag || "valid-notification"');
});
