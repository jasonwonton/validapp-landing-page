import { expect, test } from "@playwright/test";

async function signInToDemo(page, query = "") {
    await page.goto(`/app/?demo=1&signin=1${query}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toBeVisible();
}

test("bottom navigation clearly marks Feed, Play, and Profile as current", async ({ page }) => {
    await signInToDemo(page);
    const feed = page.getByRole("button", { name: "Feed", exact: true });
    const play = page.getByRole("button", { name: "Play", exact: true });
    const settings = page.getByRole("button", { name: "Profile", exact: true });

    await expect(feed).toHaveAttribute("aria-current", "page");
    await expect(feed).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
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

    await page.getByRole("button", { name: "Profile", exact: true }).click();
    const startCard = page.locator(".god-mode-start-button");
    await expect(startCard.locator("img")).toHaveCount(0);
    await startCard.click();
    const pitch = page.getByRole("dialog", { name: "God Mode" });
    await expect(pitch.locator(".god-mode-earn-button img, .god-mode-checkout-button img")).toHaveCount(0);
});

test("insufficient-aura purchase buttons are black and disabled", async ({ page }) => {
    await signInToDemo(page, "&aura=50");
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    const buttons = page.locator("#auraPurchases .aura-price-button.insufficient");
    await expect(buttons).toHaveCount(4);
    for (const button of await buttons.all()) {
        await expect(button).toBeDisabled();
        await expect(button).toHaveCSS("background-color", "rgb(0, 0, 0)");
        await expect(button).toHaveCSS("color", "rgb(255, 255, 255)");
    }
});

test("feed timestamps sit directly below the reaction control", async ({ page }) => {
    await signInToDemo(page);
    const card = page.locator("[data-feed-detail='9001']");
    const geometry = await card.evaluate((element) => {
        const reaction = element.querySelector(".reaction-control").getBoundingClientRect();
        const time = element.querySelector("time").getBoundingClientRect();
        return {
            reactionCenter: reaction.left + reaction.width / 2,
            reactionBottom: reaction.bottom,
            timeCenter: time.left + time.width / 2,
            timeTop: time.top,
        };
    });
    expect(Math.abs(geometry.reactionCenter - geometry.timeCenter)).toBeLessThan(2);
    expect(geometry.timeTop).toBeGreaterThanOrEqual(geometry.reactionBottom);
});

test("classmate browsing, targeted boost, and TBH use the same iOS-style rows", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Profile", exact: true }).click();

    await page.getByRole("button", { name: "Classmates", exact: true }).click();
    const directory = page.locator("#classmateDirectoryDialog");
    const directoryRow = directory.locator(".classmate-picker-row").first();
    const pickerStyles = (locator) => locator.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.display, style.gridTemplateColumns.split(" ")[0], style.columnGap, style.padding, style.minHeight, style.borderBottomWidth, style.borderRadius, style.backgroundColor];
    });
    const searchStyles = (locator) => locator.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.minHeight, style.borderTopWidth, style.borderRadius, style.backgroundColor];
    });
    const directoryStyles = await pickerStyles(directoryRow);
    const directorySearchStyles = await searchStyles(directory.locator(".classmate-picker-search"));
    expect(directoryStyles.slice(-3)).toEqual(["1px", "0px", "rgba(0, 0, 0, 0)"]);
    await expect(directoryRow.getByText("this week", { exact: true })).toBeVisible();
    await directory.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: /Choose a crush/ }).click();
    const targeted = page.locator("#targetedBoostDialog .classmate-picker-row").first();
    const targetedStyles = await pickerStyles(targeted);
    const targetedSearchStyles = await searchStyles(page.locator("#targetedBoostDialog .classmate-picker-search"));
    expect(targetedStyles).toEqual(directoryStyles);
    expect(targetedSearchStyles).toEqual(directorySearchStyles);
    await page.locator("#targetedBoostDialog [data-close-dialog]").click();

    await page.getByRole("button", { name: /Request a TBH for/ }).click();
    const tbh = page.locator("#tbhRequestDialog .classmate-picker-row").first();
    expect(await pickerStyles(tbh)).toEqual(directoryStyles);
    expect(await searchStyles(page.locator("#tbhRequestDialog .classmate-picker-search"))).toEqual(directorySearchStyles);
});

test("pick a couple friends stays compact and keeps every action reachable", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.getByRole("button", { name: "Contacts", exact: true }).click();
    const dialog = page.locator("#classmatesDialog");
    await expect(dialog.getByRole("heading", { name: "Pick a Couple Friends" })).toBeVisible();
    await expect(dialog.locator(".contact-onboarding-main img")).toHaveCSS("max-width", "none");
    await expect(dialog.locator("#skipContactsButton")).toBeInViewport();
    const layout = await dialog.evaluate((element) => {
        const main = element.querySelector(".contact-onboarding-main").getBoundingClientRect();
        const actions = element.querySelector(".contact-onboarding-actions").getBoundingClientRect();
        const logo = element.querySelector(".contact-onboarding-main img").getBoundingClientRect();
        return { gap: actions.top - main.bottom, logoWidth: logo.width };
    });
    expect(layout.gap).toBeLessThanOrEqual(50);
    expect(layout.logoWidth).toBeLessThanOrEqual(176);
});

test("Ask Me link can be paused, resumed, and reset from Settings", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    const askCard = page.locator("#askLinkCard");
    const toggle = askCard.getByRole("switch", { name: "Allow private questions" });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(askCard.getByText("Ask Me is off.", { exact: false })).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    page.once("dialog", (dialog) => dialog.accept());
    await askCard.getByRole("button", { name: "Reset link" }).click();
    await expect(page.locator("#toast")).toContainText("New ask me link created");
});

test("Ask Me appears directly below the profile header like iOS", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Profile", exact: true }).click();

    const order = await page.locator("#profilePanel").evaluate((panel) => {
        const children = Array.from(panel.children);
        return {
            profile: children.findIndex((child) => child.id === "profileCard"),
            askMe: children.findIndex((child) => child.id === "askLinkSection"),
            school: children.findIndex((child) => child.id === "schoolCard"),
        };
    });

    expect(order.profile).toBeLessThan(order.askMe);
    expect(order.askMe).toBeLessThan(order.school);
});

test("Ask Me restriction copy does not invite a timed-out user to turn it on", async ({ page }) => {
    await signInToDemo(page, "&askrestriction=timeout");
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    const askCard = page.locator("#askLinkCard");

    await expect(askCard.getByText("Ask Me access restricted")).toBeVisible();
    await expect(askCard.getByText("paused for 14 days", { exact: false })).toBeVisible();
    await expect(askCard.getByRole("switch", { name: "Allow private questions" })).toBeDisabled();
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

    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.getByRole("button", { name: "Ask Me safety notices" }).click();
    const history = page.getByRole("dialog", { name: "Ask Me safety" });
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
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.getByRole("button", { name: "Leave feedback" }).click();
    const dialog = page.getByRole("dialog", { name: "Feedback" });
    const formBox = await dialog.locator("form").boundingBox();
    const textareaBox = await dialog.getByLabel("What should we improve?").boundingBox();
    expect(textareaBox.width).toBeGreaterThan(formBox.width - 50);
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

test("school question artwork can be positioned and adjusted again", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.getByRole("button", { name: /Submit a school question for/i }).click();
    const question = page.getByRole("dialog", { name: "Submit a school question" });
    await question.getByLabel("Artwork").setInputFiles("assets/valid_logo.png");

    const crop = page.getByRole("dialog", { name: "Adjust crop" });
    await expect(crop).toBeVisible();
    const cropImage = crop.getByAltText("Photo being cropped");
    const initialTransform = await cropImage.evaluate((image) => image.style.transform);
    await crop.getByLabel("Zoom").fill("2");
    await expect.poll(() => cropImage.evaluate((image) => image.style.transform)).not.toBe(initialTransform);
    const zoomedTransform = await cropImage.evaluate((image) => image.style.transform);
    const viewport = crop.locator("#questionCropViewport");
    const viewportBox = await viewport.boundingBox();
    await page.mouse.move(viewportBox.x + viewportBox.width / 2, viewportBox.y + viewportBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(viewportBox.x + viewportBox.width / 2 + 40, viewportBox.y + viewportBox.height / 2, { steps: 3 });
    await page.mouse.up();
    await expect.poll(() => cropImage.evaluate((image) => image.style.transform)).not.toBe(zoomedTransform);
    await crop.getByRole("button", { name: "Use photo" }).click();

    const adjust = question.getByRole("button", { name: "Adjust crop" });
    await expect(adjust).toBeVisible();
    await adjust.click();
    await expect(crop).toBeVisible();
    await crop.getByRole("button", { name: "Cancel crop" }).click();
    await expect(adjust).toBeVisible();
});

test("push worker preserves separate notifications unless the server supplies a tag", async ({ page }) => {
    const worker = await page.request.get("/app/service-worker.js").then((response) => response.text());
    expect(worker).toContain("tag,");
    expect(worker).toContain("renotify: Boolean(tag)");
    expect(worker).not.toContain('tag: payload.tag || "valid-notification"');
});
