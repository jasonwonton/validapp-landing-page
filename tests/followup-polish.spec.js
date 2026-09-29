import { test, expect } from "@playwright/test";

async function signIn(page) {
    await page.goto("/app/?demo=1&signin=1");
    await page.getByRole("button", { name: /^sign in$/i }).click();
}

async function openChats(page) {
    await signIn(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
}

async function openNoahRoom(page) {
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await expect(page.locator('[data-message-id="msg-n4"]')).toBeVisible();
}

// Drive a real touch drag (Chromium only) from the left edge.
async function edgeDrag(page, { toX, y = 400, steps = 12, stepMs = 16 }) {
    const cdp = await page.context().newCDPSession(page);
    const point = (x) => [{ x, y, id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(6) });
    for (let step = 1; step <= steps; step++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(6 + ((toX - 6) * step) / steps) });
        await page.waitForTimeout(stepMs);
    }
    return { cdp, release: () => cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }) };
}

test.describe("chat room edge swipe-back", () => {
    test.skip(({ browserName, isMobile }) => browserName !== "chromium" || !isMobile, "touch + Android edge gesture");

    test("follows the finger over the list, cancels below the threshold, and pops like Back past it", async ({ page }) => {
        await openChats(page);
        await openNoahRoom(page);
        const room = page.locator(".chat-room-screen");

        // A short, slow drag follows the finger and reveals the list, then springs back.
        const short = await edgeDrag(page, { toX: 90, stepMs: 40 });
        await expect(room).toHaveClass(/swipe-tracking/);
        expect(await room.evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).m41)).toBeGreaterThan(60);
        await expect(page.locator(".chat-list-screen")).toBeVisible();
        await short.release();
        await expect(room).not.toHaveClass(/swipe-/);
        await expect(room).toBeVisible();
        await expect(page.locator(".chat-list-screen")).toBeHidden();

        // Past a third of the width it leaves exactly like the Back button.
        const long = await edgeDrag(page, { toX: 260 });
        await long.release();
        await expect(room).toBeHidden();
        await expect(page.locator(".chat-list-screen")).toBeVisible();
        await expect(page).not.toHaveURL(/chat=/);
        await expect(page.locator(".chat-shell")).not.toHaveClass(/chat-swipe-reveal/);
    });

    test("a fast flick completes even when short", async ({ page }) => {
        await openChats(page);
        await openNoahRoom(page);
        const flick = await edgeDrag(page, { toX: 80, steps: 4, stepMs: 8 });
        await flick.release();
        await expect(page.locator(".chat-room-screen")).toBeHidden();
        await expect(page.locator(".chat-list-screen")).toBeVisible();
    });
});

async function openSharablePoll(page) {
    await signIn(page);
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "School", exact: true }).click();
    await page.locator("[data-feed-detail='9003']").click();
    return page.locator("#feedDetailDialog");
}

test.describe("poll share copies the validapp.lol link like iOS", () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            window.__shareLog = [];
            Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.__shareLog.push(["copy", text]); } } });
        });
    });

    test("Instagram copies the link before the share sheet and says so", async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
            Object.defineProperty(navigator, "share", { configurable: true, value: async ({ title }) => { window.__shareLog.push(["share", title]); } });
        });
        const dialog = await openSharablePoll(page);
        await dialog.getByRole("button", { name: "Share poll to Instagram" }).click();
        await expect(page.locator("#toast")).toContainText("Poll photo shared • Link copied");
        expect(await page.evaluate(() => window.__shareLog)).toEqual([["copy", "https://validapp.lol"], ["share", "Share to Instagram"]]);
    });

    test("Snapchat hands off the photo without touching the clipboard, as on iOS", async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
            Object.defineProperty(navigator, "share", { configurable: true, value: async ({ title }) => { window.__shareLog.push(["share", title]); } });
        });
        const dialog = await openSharablePoll(page);
        await dialog.getByRole("button", { name: "Share poll to Snapchat" }).click();
        await expect(page.locator("#toast")).toHaveText("Poll photo shared");
        expect(await page.evaluate(() => window.__shareLog)).toEqual([["share", "Share to Snapchat"]]);
    });

    test("without Web Share the photo downloads and the link is copied", async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
            Object.defineProperty(navigator, "canShare", { configurable: true, value: undefined });
        });
        const dialog = await openSharablePoll(page);
        const download = page.waitForEvent("download");
        await dialog.getByRole("button", { name: "Share poll to Snapchat" }).click();
        expect((await download).suggestedFilename()).toMatch(/\.png$/);
        await expect(page.locator("#toast")).toContainText("Image saved • Link copied");
        await expect(page.locator("#feedDetailStatus")).toContainText("link copied");
        expect(await page.evaluate(() => window.__shareLog)).toEqual([["copy", "https://validapp.lol"]]);
    });
});
