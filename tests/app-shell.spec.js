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

test.describe("cold start", () => {
    test.use({ serviceWorkers: "block" });

    test("a returning user sees the launch splash, never the sign-in card, while the session is checked", async ({ page }) => {
        let release;
        const sessionGate = new Promise((resolve) => { release = resolve; });
        await page.route("**/api/v1/**", async (route) => {
            if (new URL(route.request().url()).pathname.endsWith("/auth/session")) {
                await sessionGate;
                return route.fulfill({ json: { user: { id: "test-user", first_name: "Test", username: "test" } } });
            }
            return route.fulfill({ json: {} });
        });
        await page.goto("/app/");
        await expect(page.locator("#launchSplash")).toBeVisible();
        await page.waitForTimeout(400);
        await expect(page.locator("#authView")).toBeHidden();
        await expect(page.getByText("Welcome Back")).toBeHidden();
        release();
        await expect(page.locator("#appView")).toBeVisible();
        await expect(page.locator("#launchSplash")).toBeHidden();
        await expect(page.locator("#authView")).toBeHidden();
    });

    test("an expired cookie shows Welcome Back without opening signup for a returning user", async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem("valid:signed-in-before", "1"));
        await page.addInitScript(() => {
            Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: class {} });
        });
        await page.route("**/api/v1/**", (route) => route.fulfill({ status: 401,
            headers: { "WWW-Authenticate": "Bearer" }, json: { detail: "Authentication required" } }));
        await page.goto("/app/");
        await expect(page.getByText("Welcome Back")).toBeVisible();
        await expect(page.locator("#launchSplash")).toBeHidden();
        await page.waitForTimeout(300);
        await expect(page.locator("#signupDialog")).not.toBeVisible();
    });
});

test.describe("notification taps", () => {
    const tap = (page, url) => page.evaluate((href) => navigator.serviceWorker.dispatchEvent(
        new MessageEvent("message", { data: { type: "VALID_NOTIFICATION_CLICK", url: new URL(href, location.origin).href } })), url);

    test("route inside the running app without reloading it", async ({ page }) => {
        await signInToDemo(page);
        await page.evaluate(() => { window.__sameDocument = true; });

        await tap(page, "/app/?demo=1&signin=1&tab=chats&chat=chat-friends&message=msg-2");
        await expect(page.locator("#chatsPanel")).toBeVisible();
        await expect(page.locator(".chat-room-screen")).toBeVisible();
        await expect(page).toHaveURL(/tab=chats&chat=chat-friends&message=msg-2/);
        await expect(page).not.toHaveURL(/signin=1/);

        await tap(page, "/app/?demo=1&signin=1&notification=feed_item&question_answer_id=9001");
        await expect(page.locator("#feedDetailDialog")).toBeVisible();

        await tap(page, "/app/?demo=1&signin=1&tab=profile");
        await expect(page.locator("#profilePanel")).toBeVisible();
        await expect(page.locator("#feedDetailDialog")).toBeHidden();

        expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
        // Back returns to where the user was before the tap.
        await page.goBack();
        await expect(page.locator("#profilePanel")).toBeHidden();
    });

    test("a notification link opened cold lands on the same place", async ({ page }) => {
        await page.goto("/app/?demo=1&signin=1&tab=chats&chat=chat-noah&message=msg-n3");
        await page.getByRole("button", { name: /^sign in$/i }).click();
        await expect(page.locator(".chat-room-screen")).toBeVisible();
        await expect(page.locator(".chat-room-title strong")).toHaveText("Noah Williams");
        await expect(page).not.toHaveURL(/signin=1/);
    });
});
