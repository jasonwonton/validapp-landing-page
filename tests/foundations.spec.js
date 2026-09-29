import { test, expect } from "@playwright/test";

// Shared PWA foundations: public-media fallback, in-app sheets, toasts above
// dialogs, and paired peach foreground colours.

async function signIn(page) {
    await page.goto("/app/?demo=1&signin=1");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("button", { name: "Profile", exact: true })).toBeVisible();
}

async function openSheet(page, kind, options) {
    await page.evaluate(async ({ kind, options }) => {
        const dialogs = await import("/app/ui-dialogs.js");
        window.sheetResult = "pending";
        dialogs[kind](options).then((value) => { window.sheetResult = value; });
    }, { kind, options });
    await expect(page.locator(".ui-sheet")).toBeVisible();
}

test("confirm sheet resolves true only from its confirm button and restores focus", async ({ page }) => {
    await signIn(page);
    const trigger = page.getByRole("button", { name: "Profile", exact: true });
    await trigger.focus();
    await openSheet(page, "confirmSheet", { title: "Delete this?", message: "This cannot be undone.", confirmLabel: "Delete", destructive: true });
    const sheet = page.getByRole("dialog", { name: "Delete this?" });
    await expect(sheet).toContainText("This cannot be undone.");
    await expect(sheet.getByRole("button", { name: "Delete" })).toBeFocused();
    await expect(sheet.getByRole("button", { name: "Delete" })).toHaveClass(/danger-button/);
    await sheet.getByRole("button", { name: "Delete" }).click();
    await expect.poll(() => page.evaluate(() => window.sheetResult)).toBe(true);
    await expect(page.locator(".ui-sheet")).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await openSheet(page, "confirmSheet", { title: "Leave?" });
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => window.sheetResult)).toBe(false);

    await openSheet(page, "confirmSheet", { title: "Leave?" });
    await page.mouse.click(10, 10);
    await expect.poll(() => page.evaluate(() => window.sheetResult)).toBe(false);

    await openSheet(page, "confirmSheet", { title: "Leave?", cancelLabel: "Stay" });
    await page.getByRole("button", { name: "Stay" }).click();
    await expect.poll(() => page.evaluate(() => window.sheetResult)).toBe(false);
});

test("reason sheet requires a reason and returns optional details for Something else", async ({ page }) => {
    await signIn(page);
    await openSheet(page, "reasonSheet", {
        title: "Report this Story",
        reasons: [{ value: "spam", label: "Spam" }, { value: "harassment", label: "Harassment or bullying" }],
        allowOther: true, confirmLabel: "Report", destructive: true,
    });
    const sheet = page.getByRole("dialog", { name: "Report this Story" });
    const submit = sheet.getByRole("button", { name: "Report" });
    await expect(submit).toBeDisabled();
    await expect(sheet.getByRole("radio", { name: "Spam" })).toBeFocused();
    await expect(sheet.getByRole("textbox")).toBeHidden();
    await sheet.getByText("Something else").click();
    await expect(sheet.getByRole("textbox")).toBeVisible();
    await sheet.getByRole("textbox").fill("  Unsafe content  ");
    await submit.click();
    await expect.poll(() => page.evaluate(() => window.sheetResult)).toEqual({ reason: "other", details: "Unsafe content" });

    await openSheet(page, "reasonSheet", { title: "Report", reasons: [{ value: "spam", label: "Spam" }] });
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => window.sheetResult)).toBe(null);
});

test("sheets open above an already open modal", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.evaluate(() => document.querySelector("#feedbackDialog").showModal());
    await openSheet(page, "confirmSheet", { title: "On top?", confirmLabel: "Yes" });
    await page.getByRole("button", { name: "Yes" }).click();
    await expect.poll(() => page.evaluate(() => window.sheetResult)).toBe(true);
    await expect(page.locator("#feedbackDialog")).toBeVisible();
});

test("public images fall back across media routes, then to initials", async ({ page }) => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const requested = [];
    await page.route(/media\.six7\.lol|validappcdn\.com|workers\.dev/, (route) => { requested.push(new URL(route.request().url()).host); return route.abort("connectionrefused"); });
    await page.route("**/api/v1/media/**", (route) => {
        requested.push("api");
        return route.request().url().includes("/profile-pictures/works")
            ? route.fulfill({ status: 200, contentType: "image/png", body: png })
            : route.fulfill({ status: 404, body: "" });
    });
    await signIn(page);
    await page.evaluate(async () => {
        const { mediaImageMarkup } = await import("/app/media-url.js");
        const host = document.createElement("div");
        host.id = "mediaFallbackProbe";
        host.innerHTML = `<span class="row-avatar" id="works">${mediaImageMarkup("https://media.six7.lol/profile-pictures/works.png", { initials: "AB", loading: "eager" })}</span>`
            + `<span class="row-avatar" id="missing">${mediaImageMarkup("https://media.six7.lol/profile-pictures/missing.png", { initials: "CD", loading: "eager" })}</span>`
            + `<span id="art">${mediaImageMarkup("https://validappcdn.com/questions/images/missing.webp", { loading: "eager" })}</span>`;
        document.body.append(host);
    });
    await expect.poll(() => page.locator("#works img").evaluate((image) => image.complete && image.naturalWidth)).toBe(1);
    await expect(page.locator("#works img")).toHaveAttribute("src", /\/api\/v1\/media\/profile-pictures\/works\.png$/);
    await expect(page.locator("#missing")).toHaveText("CD");
    await expect(page.locator("#art img")).toHaveClass(/media-placeholder/);
    expect(requested).toEqual(expect.arrayContaining(["media.six7.lol", "validappcdn.com", "six7-public-media-fallback.empty-snow-d731.workers.dev", "api"]));
});

// Hit-testing skips inert content (everything outside a modal, including the
// top-layer toast), so read the painted pixel at the toast's dark pill instead.
async function toastIsPaintedOnTop(page) {
    const box = await page.locator("#toast").boundingBox();
    const shot = await page.screenshot({ clip: { x: box.x + 8, y: box.y + box.height / 2 - 1, width: 2, height: 2 } });
    const [r, g, b] = await page.evaluate(async (data) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return [...context.getImageData(0, 0, 1, 1).data];
    }, shot.toString("base64"));
    // The light-mode pill is pure black on top; under a modal backdrop (rgba(5,9,20,.55)) it would tint blue.
    return r + g + b < 8;
}

test("toasts paint above an open modal dialog", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await signIn(page);
    await openSheet(page, "confirmSheet", { title: "Covering the page" });
    await page.evaluate(async () => (await import("/app/toast.js")).showToast("Saved above the sheet"));
    const toast = page.locator("#toast");
    await expect(toast).toHaveText("Saved above the sheet");
    await expect(toast).toBeVisible();
    await expect.poll(() => toastIsPaintedOnTop(page)).toBe(true);
    await page.getByRole("button", { name: "Cancel" }).click();
    // A modal opened after the first toast is still covered by the next one.
    await page.evaluate(() => document.querySelector("#feedbackDialog").showModal());
    await page.evaluate(async () => (await import("/app/toast.js")).showToast("Second toast"));
    await expect(toast).toHaveText("Second toast");
    await expect.poll(() => toastIsPaintedOnTop(page)).toBe(true);
});
