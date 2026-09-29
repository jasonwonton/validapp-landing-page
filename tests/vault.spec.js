import { expect, test } from "@playwright/test";

// Memories + Vault (iOS Views/Vault). Demo fixtures: app/vault/demo.js.

async function signIn(page, suffix = "") {
    await page.route("**/assets/demo.mp4", (route) => route.fulfill({ path: "tests/fixtures/view-once.mp4", contentType: "video/mp4" }));
    await page.goto(`/app/?demo=1&signin=1${suffix}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Profile", exact: true }).click();
}

async function openMemories(page, suffix = "") {
    await signIn(page, suffix);
    const entry = page.locator("#memoriesEntry").getByRole("button", { name: /^Memories/ });
    await expect(entry).toBeVisible();
    await entry.click();
    const screen = page.getByRole("dialog", { name: /^(Memories|Vault)$/ });
    await expect(screen).toBeVisible();
    return screen;
}

async function enterPin(pad, pin) {
    for (const digit of pin) await pad.getByRole("button", { name: digit, exact: true }).click();
    await expect(pad.locator(".vault-pin-dots i.filled")).toHaveCount(0);
}

const gate = (page) => page.locator("[data-vault-pad='gate']");
const flow = (page) => page.locator("[data-vault-layer]");

async function setPageHidden(page, hidden) {
    await page.evaluate((isHidden) => {
        if (isHidden) Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        else delete document.visibilityState;
        document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
}

test("the Memories row follows enable_vault and shows the saved count", async ({ page }) => {
    await signIn(page, "&vault=0");
    await expect(page.locator("#profileCard")).toBeVisible();
    await expect(page.locator("#memoriesEntry")).toBeHidden();
    await expect(page.locator("link[data-vault-css]")).toHaveCount(0);

    await signIn(page);
    const entry = page.locator("#memoriesEntry").getByRole("button", { name: /^Memories/ });
    await expect(entry).toContainText("44 saved");
    await expect(entry.locator(".vault-entry-thumb")).toHaveCount(3);
});

test("the grid groups by month, marks videos and Stories, loads more, and renews expired links", async ({ page }) => {
    const styleViolations = [];
    page.on("console", (message) => {
        if (message.text().includes("Content Security Policy") && message.text().includes("style-src")) styleViolations.push(message.text());
    });
    const screen = await openMemories(page, "&vaultexpired=1");
    const cells = screen.locator("[data-vault-open]");
    await expect(cells).toHaveCount(36);
    const headers = screen.locator(".vault-month");
    expect(await headers.count()).toBeGreaterThan(1);
    const expected = await page.evaluate(() => new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date()));
    await expect(headers.first()).toHaveText(expected);
    await expect(headers.first()).toHaveText(/^[A-Z]\p{L}+ \d{4}$/u);
    // Items and months arrive newest first.
    const monthKeys = await headers.evaluateAll((nodes) => nodes.map((node) => node.dataset.vaultMonth));
    expect(new Set(monthKeys).size).toBe(monthKeys.length);
    await expect(screen.locator(".vault-cell-duration").first()).toContainText(/\d:\d\d/);
    await expect(screen.locator(".vault-cell-story").first()).toBeAttached();
    const box = await cells.first().boundingBox();
    expect(Math.abs(box.height / box.width - 4 / 3)).toBeLessThan(0.02);

    // The first page came back with expired signed URLs; a failed load refetches it.
    await expect.poll(() => cells.first().locator("img").getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    await expect(screen.locator("img.media-placeholder")).toHaveCount(0);

    await cells.last().scrollIntoViewIfNeeded();
    await expect(cells).toHaveCount(44);
    expect(styleViolations).toEqual([]);
});

test("the viewer swipes between items and deletes only after confirmation", async ({ page }) => {
    const screen = await openMemories(page);
    await expect(screen.locator("[data-vault-open]")).toHaveCount(36);
    await screen.locator("[data-vault-open]").first().click();
    const viewer = page.getByRole("dialog", { name: "Memory viewer" });
    await expect(viewer).toBeVisible();
    const ids = await screen.locator("[data-vault-open]").evaluateAll((nodes) => nodes.slice(0, 4).map((node) => node.dataset.vaultOpen));
    const currentId = () => page.evaluate(() => {
        const pager = document.querySelector("[data-vault-pager]");
        return pager.children[Math.round(pager.scrollLeft / pager.clientWidth)]?.dataset.vaultPage;
    });

    await page.keyboard.press("ArrowRight");
    await expect.poll(currentId).toBe(ids[1]);
    // A touch swipe is a horizontal scroll of the snapping pager.
    await page.evaluate(() => {
        const pager = document.querySelector("[data-vault-pager]");
        pager.scrollTo({ left: pager.clientWidth * 2 });
    });
    await expect.poll(currentId).toBe(ids[2]);

    await viewer.getByRole("button", { name: "Delete from Memories" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete from Memories?" });
    await expect(confirm).toContainText("It’s removed for good. Stories you posted aren’t affected.");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect.poll(currentId).toBe(ids[2]);

    await viewer.getByRole("button", { name: "Delete from Memories" }).click();
    await page.getByRole("dialog", { name: "Delete from Memories?" }).getByRole("button", { name: "Delete" }).click();
    await expect.poll(currentId).toBe(ids[3]);
    await expect(page.locator(`[data-vault-page="${ids[2]}"]`)).toHaveCount(0);

    await viewer.getByRole("button", { name: "Close" }).click();
    await expect(viewer).toBeHidden();
    await expect(screen.locator(`[data-vault-open="${ids[2]}"]`)).toHaveCount(0);
    await screen.getByRole("button", { name: "Close" }).click();
    await expect(page.locator("#memoriesEntry")).toContainText("43 saved");
});

test("Save downloads the original when Web Share cannot take files", async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "share", { configurable: true, value: undefined });
        Object.defineProperty(Navigator.prototype, "canShare", { configurable: true, value: undefined });
    });
    const screen = await openMemories(page);
    await screen.locator("[data-vault-open]").first().click();
    const viewer = page.getByRole("dialog", { name: "Memory viewer" });
    const download = page.waitForEvent("download");
    await viewer.getByRole("button", { name: "Save" }).click();
    expect((await download).suggestedFilename()).toMatch(/^valid-\d{8}-\d{4}\.svg$/);
    await expect(viewer.getByRole("button", { name: "Saved" })).toBeDisabled();
});

test("PIN setup asks again after a mismatched confirmation", async ({ page }) => {
    const screen = await openMemories(page);
    await screen.getByRole("tab", { name: "Vault" }).click();
    await expect(screen.getByRole("heading", { name: "Keep things private" })).toBeVisible();
    await screen.getByRole("button", { name: "Set up a PIN" }).click();

    const pad = flow(page);
    await expect(pad.getByRole("heading", { name: "Choose a 4-digit PIN" })).toBeVisible();
    await enterPin(pad, "1234");
    await expect(pad.getByRole("heading", { name: "Enter it again" })).toBeVisible();
    await enterPin(pad, "5678");
    await expect(pad.getByRole("heading", { name: "Choose a 4-digit PIN" })).toBeVisible();
    await expect(pad.getByRole("alert")).toHaveText("Those didn’t match. Choose a PIN again.");
    await enterPin(pad, "1234");
    await enterPin(pad, "1234");
    await expect(pad).toBeHidden();
    await expect(screen.getByRole("heading", { name: "Your Vault is empty" })).toBeVisible();
    await expect(screen.getByRole("button", { name: "Vault PIN settings" })).toBeVisible();
});

test("wrong PINs count down and then lock out per the server", async ({ page }) => {
    const screen = await openMemories(page, "&vaultpin=1");
    await screen.getByRole("tab", { name: "Vault" }).click();
    await expect(gate(page).getByRole("heading", { name: "Enter your Vault PIN" })).toBeVisible();
    for (const remaining of [4, 3, 2]) {
        await enterPin(gate(page), "0000");
        await expect(gate(page).getByRole("alert")).toHaveText(`Wrong PIN. ${remaining} tries left.`);
    }
    await enterPin(gate(page), "0000");
    await expect(gate(page).getByRole("alert")).toHaveText("Wrong PIN. 1 try left.");
    for (const digit of "0000") await gate(page).getByRole("button", { name: digit, exact: true }).click();
    await expect(gate(page).getByRole("alert")).toHaveText(/^Too many tries\. Try again in 15 minutes\.$/);
    await expect(gate(page).getByRole("button", { name: "1", exact: true })).toBeDisabled();
    await expect(screen.locator("[data-vault-open]")).toHaveCount(0);
});

test("the Vault locks again when the tab is left, the page is hidden, or the screen closes", async ({ page }) => {
    const screen = await openMemories(page, "&vaultpin=1");
    const vaultTab = screen.getByRole("tab", { name: "Vault" });
    const unlock = async () => {
        await enterPin(gate(page), "1234");
        await expect(screen.locator("[data-vault-open]")).toHaveCount(3);
        await expect(gate(page)).toHaveCount(0);
    };
    await vaultTab.click();
    await unlock();

    await screen.getByRole("tab", { name: "Memories" }).click();
    await vaultTab.click();
    await expect(gate(page)).toBeVisible();
    await unlock();

    await screen.locator("[data-vault-open]").first().click();
    const viewer = page.getByRole("dialog", { name: "Memory viewer" });
    await expect(viewer).toContainText("In your Vault");
    await setPageHidden(page, true);
    await setPageHidden(page, false);
    await expect(viewer).toBeHidden();
    await expect(gate(page)).toBeVisible();
    await expect(screen.locator("[data-vault-open]")).toHaveCount(0);
    await unlock();

    await screen.getByRole("button", { name: "Vault PIN settings" }).click();
    await page.getByRole("menuitem", { name: "Lock Vault now" }).click();
    await expect(gate(page)).toBeVisible();
    await unlock();

    await screen.getByRole("button", { name: "Close" }).click();
    await expect(screen).toBeHidden();
    await page.locator("#memoriesEntry").getByRole("button", { name: /^Memories/ }).click();
    await screen.getByRole("tab", { name: "Vault" }).click();
    await expect(gate(page)).toBeVisible();
});

test("moving to the Vault without a PIN sets one up first and then finishes the move", async ({ page }) => {
    const screen = await openMemories(page);
    await expect(screen.locator("[data-vault-open]")).toHaveCount(36);
    const firstIds = await screen.locator("[data-vault-open]").evaluateAll((nodes) => nodes.slice(0, 2).map((node) => node.dataset.vaultOpen));
    await screen.locator("[data-vault-open]").first().click();
    const viewer = page.getByRole("dialog", { name: "Memory viewer" });
    await viewer.getByRole("button", { name: "Move to Vault" }).click();

    const pad = flow(page);
    await expect(pad.getByRole("heading", { name: "Choose a 4-digit PIN" })).toBeVisible();
    await enterPin(pad, "2468");
    await enterPin(pad, "2468");
    await expect(pad).toBeHidden();
    await expect(page.locator(`[data-vault-page="${firstIds[0]}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-vault-page="${firstIds[1]}"] img, [data-vault-page="${firstIds[1]}"] video`)).toBeVisible();

    await viewer.getByRole("button", { name: "Close" }).click();
    await expect(screen.locator(`[data-vault-open="${firstIds[0]}"]`)).toHaveCount(0);
    await screen.getByRole("tab", { name: "Vault" }).click();
    // Setting the PIN unlocked the Vault for this visit.
    await expect(screen.locator(`[data-vault-open="${firstIds[0]}"]`)).toBeVisible();
    await screen.locator(`[data-vault-open="${firstIds[0]}"]`).click();
    await expect(viewer).toContainText("In your Vault");
    await viewer.getByRole("button", { name: "Move to Memories" }).click();
    await expect(viewer).toBeHidden();
    await expect(screen.getByRole("heading", { name: "Your Vault is empty" })).toBeVisible();
});

test("Forgot PIN resets only after a recent sign-in", async ({ page }) => {
    const screen = await openMemories(page, "&vaultpin=1&vaultreset=old");
    await screen.getByRole("tab", { name: "Vault" }).click();
    await screen.getByRole("button", { name: "Forgot PIN?" }).click();
    const sheet = flow(page);
    await expect(sheet.getByRole("heading", { name: "Forgot your PIN?" })).toBeVisible();
    await sheet.getByRole("button", { name: "Reset PIN" }).click();
    await expect(sheet).toContainText("You need to have signed in within the last 15 minutes.");
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(gate(page)).toBeVisible();
});
