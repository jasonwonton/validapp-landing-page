import { expect, test } from "@playwright/test";

async function signInToDemo(page, query = "") {
    await page.goto(`/app/?demo=1&signin=1${query}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toBeVisible();
}

test("shared action buttons use the iOS button tokens", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1");
    const styleSnapshot = (locator) => locator.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            minHeight: style.minHeight,
            borderRadius: style.borderRadius,
            borderWidth: style.borderTopWidth,
            background: style.backgroundColor,
            color: style.color,
            boxShadow: style.boxShadow,
            fontSize: style.fontSize,
        };
    });

    expect(await styleSnapshot(page.locator("#passkeyButton"))).toEqual({
        minHeight: "60px",
        borderRadius: "30px",
        borderWidth: "0px",
        background: "rgb(255, 177, 94)",
        color: "rgb(0, 0, 0)",
        boxShadow: "none",
        fontSize: "22px",
    });
    expect(await styleSnapshot(page.locator("#createAccountButton"))).toMatchObject({
        minHeight: "50px",
        borderRadius: "25px",
        borderWidth: "2px",
        background: "rgb(255, 255, 255)",
        color: "rgb(0, 0, 0)",
        boxShadow: "none",
        fontSize: "16px",
    });
    await expect(page.locator("#deleteAccountDialog .danger-button")).toHaveCSS("background-color", "rgb(255, 0, 0)");
    await expect(page.locator("#deleteAccountDialog .danger-button")).toHaveCSS("color", "rgb(255, 255, 255)");

    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    const godMode = page.locator(".god-mode-start-button");
    await expect(godMode).toHaveCSS("min-height", "50px");
    await expect(godMode).toHaveCSS("border-radius", "16px");
    await expect(godMode).toHaveCSS("background-color", "rgb(255, 177, 94)");

    await page.getByRole("button", { name: "Play", exact: true }).click();
    const playActions = page.locator(".play-action-button");
    await expect(playActions).toHaveCount(3);
    await expect(playActions.first()).toHaveCSS("min-height", "50px");
    await expect(playActions.first()).toHaveCSS("border-radius", "20px");
    await expect(playActions.nth(1)).toHaveCSS("background-color", "rgb(255, 184, 214)");
});

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
    expect(directoryStyles).toEqual(["grid", "46px", "12px", "12px 14px", "74px", "2px", "20px", "rgb(255, 255, 255)"]);
    expect(directorySearchStyles).toEqual(["50px", "2px", "20px", "rgb(255, 255, 255)"]);
    await expect(directoryRow.getByText("this week", { exact: true })).toBeVisible();
    await expect(directoryRow).not.toContainText("@maya_c");
    const askIndicator = directoryRow.locator(".classmate-ask-indicator");
    await expect(askIndicator.locator(".ask-me-symbol")).toBeVisible();
    await expect(askIndicator).toHaveCSS("line-height", "0px");
    await expect(askIndicator.locator(".ask-me-symbol")).toHaveCSS("display", "block");
    const trailingAlignment = await directoryRow.evaluate((element) => {
        const indicator = element.querySelector(".classmate-ask-indicator").getBoundingClientRect();
        const meta = element.querySelector(".classmate-row-meta").getBoundingClientRect();
        return Math.abs((indicator.top + indicator.height / 2) - (meta.top + meta.height / 2));
    });
    expect(trailingAlignment).toBeLessThan(1);

    await directoryRow.click();
    const classmateProfile = page.getByRole("dialog", { name: "Profile", exact: true });
    const askButton = classmateProfile.getByRole("link", { name: "Ask anonymously", exact: true });
    await expect(askButton).toHaveAttribute("href", "../a/demo-maya_c");
    await expect(askButton).toHaveCSS("border-top-width", "3px");
    await expect(askButton).toHaveCSS("box-shadow", "rgb(0, 0, 0) 4px 5px 0px 0px");
    expect(await askButton.evaluate((button) => button.nextElementSibling?.matches(".profile-stats-grid"))).toBe(true);
    await expect(askButton.locator(".ask-me-symbol > g")).toHaveAttribute("transform", "translate(0 -1.5)");
    await expect(classmateProfile.locator(".tbh-stat-symbol")).toBeVisible();
    await expect(classmateProfile.locator(".tbh-stat-symbol > g")).toHaveAttribute("transform", "translate(0 -1.5)");
    await expect(classmateProfile.locator("#classmateProfileCard")).not.toContainText("❝");

    await classmateProfile.getByRole("button", { name: /Open poll:/ }).first().click();
    const pollSummary = page.locator("#pollSummaryDialog");
    await expect(pollSummary).toBeVisible();
    await pollSummary.getByRole("button", { name: "Close poll" }).click();
    await expect(pollSummary).toBeHidden();

    await classmateProfile.getByRole("button", { name: "Back to classmates" }).click();
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
    const tbhMaya = page.getByRole("dialog", { name: "Request a TBH" }).getByRole("button", { name: "Maya Chen, Senior" });
    await expect(tbhMaya.locator("img")).toBeVisible();
    await expect(tbhMaya.getByText("Senior", { exact: true })).toBeVisible();
});

test("an unavailable Ask Me target does not make a classmate profile look broken", async ({ page }) => {
    await signInToDemo(page, "&asktarget=unavailable");
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.getByRole("button", { name: "Classmates", exact: true }).click();
    const directory = page.getByRole("dialog", { name: "Classmates", exact: true });
    await directory.getByRole("button", { name: /Maya Chen/ }).click();
    const profile = page.getByRole("dialog", { name: "Profile", exact: true });
    await expect(profile.getByRole("heading", { name: "Maya Chen" })).toBeVisible();
    await expect(profile.locator("#classmateProfileStatus")).toBeEmpty();
    await expect(profile.getByText("Some profile details could not be loaded.")).toHaveCount(0);
    await expect(profile.getByRole("link", { name: "Ask anonymously", exact: true })).toHaveCount(0);
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
    await askCard.getByRole("button", { name: "Reset ask link" }).click();
    await expect(page.locator("#toast")).toContainText("New ask me link created");
});

test("Ask Me uses the same action symbols and inbox question mark as iOS", async ({ page }) => {
    await signInToDemo(page, "&safetynotice=1");
    await page.getByRole("dialog", { name: "Ask Me safety warning" }).getByRole("button", { name: "I understand" }).click();
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    const askCard = page.locator("#askLinkCard");
    await expect(askCard.locator(".ask-url .app-symbol")).toBeVisible();
    await expect(askCard.locator("[data-rotate-link] .app-symbol")).toBeVisible();
    await expect(askCard.locator("[data-ask-safety-history] .app-symbol")).toBeVisible();
    await expect(askCard).not.toContainText("🔗");

    await page.getByRole("button", { name: "Feed", exact: true }).click();
    const inboxIcon = page.locator(".anonymous-question-row .anonymous-row-icon").first();
    await expect(inboxIcon).toHaveText("?");
    await expect(inboxIcon.locator("svg")).toHaveCount(0);
});

test("profile and account actions use consistent app icons instead of platform emoji", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Profile", exact: true }).click();

    const profileMeta = page.locator("#profileCard .profile-school-meta");
    await expect(profileMeta.locator("img")).toHaveCount(2);
    await expect(profileMeta).not.toContainText("🏫");
    await expect(profileMeta).not.toContainText("🎓");
    await expect(page.locator("#addPasskeyButton .passkey-settings-icon svg")).toBeVisible();
    await expect(page.locator("#feedbackButton .feedback-settings-icon svg")).toBeVisible();
    await expect(page.locator("#profileInviteCard .messages-symbol")).toBeVisible();
    await expect(page.locator("#addPasskeyButton")).not.toContainText("🔑");
});

test("empty Ask Me replies stay disabled until there is something to send", async ({ page }) => {
    await signInToDemo(page);
    await page.locator(".anonymous-question-row").filter({ hasText: "genuinely proud" }).click();
    const reply = page.getByRole("textbox", { name: "Your reply" });
    const send = page.getByRole("button", { name: "Send reply" });
    await expect(send).toBeDisabled();
    await reply.fill("I kept showing up.");
    await expect(send).toBeEnabled();
    await reply.fill("   ");
    await expect(send).toBeDisabled();
});

test("school filter chips scroll selected content into view and sheets animate in", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "School", exact: true }).click();
    const controls = page.locator("#schoolFeedControls");
    await controls.getByRole("button", { name: "My Votes" }).click();
    const overflows = await controls.evaluate((element) => element.scrollWidth > element.clientWidth);
    if (overflows) {
        await expect.poll(() => controls.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    }

    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.getByRole("button", { name: /Choose a crush/ }).click();
    await expect(page.locator("#targetedBoostDialog")).toHaveCSS("animation-name", "modal-enter");
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

test("profile header mirrors the iOS identity card", async ({ page }) => {
    await signInToDemo(page);
    await page.getByRole("button", { name: "Profile", exact: true }).click();

    const card = page.locator("#profileCard .full-profile-card");
    await expect(card.getByRole("heading", { name: "Jules Rivera" })).toBeVisible();
    await expect(card.locator(".profile-identity-line")).toContainText("@jules");
    await expect(card.locator(".profile-streak")).toHaveText("🔥 7");
    await expect(card.locator(".profile-school-meta")).toContainText("Westview High School");
    await expect(card.locator(".profile-school-meta")).toContainText("Junior");
    await expect(card.locator(".profile-school-meta img")).toHaveCount(2);
    await expect(card.locator(".profile-stat-card")).toHaveCount(2);
    await expect(card.locator(".profile-stat-card").filter({ hasText: "Aura" })).toContainText("1,280");
    await expect(card.locator(".profile-stat-card").filter({ hasText: "Votes Received" })).toContainText("84");
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
    await expect(notice.locator(".ask-safety-shield svg")).toBeVisible();
    await expect(notice).not.toContainText("🛡️");
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
