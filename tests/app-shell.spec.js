import { expect, test } from "@playwright/test";

async function signInToDemo(page, query = "") {
    await page.goto(`/app/?demo=1&signin=1${query}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toBeVisible();
}

async function emulateInstalledApp(page) {
    await page.addInitScript(() => {
        const original = window.matchMedia.bind(window);
        window.matchMedia = (query) => /display-mode:\s*standalone/.test(query)
            ? { matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }
            : original(query);
        Object.defineProperty(navigator, "standalone", { configurable: true, get: () => true });
    });
}

const navBottom = (page) => page.locator("#bottomNav").evaluate((nav) => Math.round(nav.getBoundingClientRect().bottom));
// Chromium's mobile emulation zooms the signed-in page out by a few pixels
// (innerHeight 842 vs 839 on Pixel 7), so allow that much rounding.
const nearBottom = (height) => (value) => Math.abs(value - height) <= 4;

test.describe("installed-app viewport", () => {
    test.beforeEach(({}, testInfo) => {
        test.skip(testInfo.project.name !== "android", "Needs a phone-sized touch viewport and Chromium CDP");
    });

    test("the tab bar returns to the screen bottom when WebKit leaves the layout viewport short after the keyboard closes", async ({ page, context }) => {
        await emulateInstalledApp(page);
        await signInToDemo(page);
        const cdp = await context.newCDPSession(page);
        const { width, height } = page.viewportSize();
        expect(await navBottom(page)).toBe(height);

        // The keyboard opens: the layout viewport shrinks and the tab bar hides.
        await page.locator("#feedSearch").focus();
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: height - 330, deviceScaleFactor: await page.evaluate(() => devicePixelRatio), mobile: true });
        await expect(page.locator("html")).toHaveClass(/keyboard-open/);
        await expect(page.locator("#bottomNav")).toHaveCSS("visibility", "hidden");
        await expect(page.locator("html")).not.toHaveClass(/layout-viewport-stale/);

        // The keyboard is dismissed but the layout viewport stays short (iOS 26 standalone):
        // a fixed bottom:0 element sits 330px above the real bottom edge.
        await page.locator("#feedSearch").blur();
        await expect(page.locator("html")).not.toHaveClass(/keyboard-open/);
        await expect(page.locator("html")).toHaveClass(/layout-viewport-stale/);
        await expect.poll(async () => nearBottom(height)(await navBottom(page))).toBe(true);
        await expect(page.locator("#bottomNav")).toHaveCSS("visibility", "visible");
        // Full-screen layouts (chat room, Play) are sized to the real screen, and
        // toasts move down with the tab bar.
        const fullHeight = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--visual-viewport-height")));
        expect(nearBottom(height)(fullHeight)).toBe(true);
        await page.evaluate(async () => (await import("/app/toast.js")).showToast("Saved"));
        const toastBottom = await page.locator(".toast").evaluate((toast) => toast.getBoundingClientRect().bottom);
        expect(toastBottom).toBeGreaterThan(height - 140);

        // WebKit recovers: the compensation is removed and nothing moves.
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: await page.evaluate(() => devicePixelRatio), mobile: true });
        await expect(page.locator("html")).not.toHaveClass(/layout-viewport-stale/);
        await expect.poll(async () => nearBottom(height)(await navBottom(page))).toBe(true);
    });

    test("returning to the app re-checks a stale layout viewport", async ({ page, context }) => {
        await emulateInstalledApp(page);
        await signInToDemo(page);
        const cdp = await context.newCDPSession(page);
        const { width, height } = page.viewportSize();
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: height - 300, deviceScaleFactor: await page.evaluate(() => devicePixelRatio), mobile: true });
        await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        await expect.poll(async () => nearBottom(height)(await navBottom(page))).toBe(true);
    });

    test("a browser tab never shifts the tab bar", async ({ page, context }) => {
        await signInToDemo(page);
        const cdp = await context.newCDPSession(page);
        const { width, height } = page.viewportSize();
        await page.locator("#feedSearch").focus();
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: height - 330, deviceScaleFactor: await page.evaluate(() => devicePixelRatio), mobile: true });
        await page.locator("#feedSearch").blur();
        await page.waitForTimeout(1200);
        await expect(page.locator("html")).not.toHaveClass(/layout-viewport-stale/);
        expect(await navBottom(page)).toBe(height - 330);
    });
});
