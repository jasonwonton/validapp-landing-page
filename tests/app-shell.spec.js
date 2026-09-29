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

test.describe("history and Back", () => {
    test("tabs keep Feed as the root: tab switches and re-taps never grow history", async ({ page }) => {
        await signInToDemo(page);
        const start = await page.evaluate(() => history.length);
        const nav = (name) => page.locator("#bottomNav").getByRole("button", { name, exact: true }).click();
        await nav("Play");
        await nav("Chats");
        await nav("Profile");
        await nav("Profile");
        expect(await page.evaluate(() => history.length)).toBe(start + 1);
        await page.goBack();
        await expect(page.locator("#feedPanel")).toBeVisible();
        await expect(page).not.toHaveURL(/tab=/);
        // Tapping Feed from another tab also returns to the root entry.
        await nav("Play");
        await nav("Feed");
        await expect(page.locator("#feedPanel")).toBeVisible();
        await expect.poll(() => page.evaluate(() => history.state?.tabOverFeed)).toBe(false);
    });

    test("Back closes an open sheet before leaving the screen", async ({ page }) => {
        await signInToDemo(page);
        await page.locator("#bottomNav").getByRole("button", { name: "Profile", exact: true }).click();
        await page.getByRole("button", { name: /Choose a crush/ }).click();
        const sheet = page.locator("#targetedBoostDialog");
        await expect(sheet).toBeVisible();
        await page.goBack();
        await expect(sheet).toBeHidden();
        await expect(page.locator("#profilePanel")).toBeVisible();
        // Closing the sheet from its own button leaves no stale history entry.
        await page.getByRole("button", { name: /Choose a crush/ }).click();
        await expect(sheet).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(sheet).toBeHidden();
        await expect.poll(() => page.evaluate(() => history.state?.sheet ?? null)).toBe(null);
        await expect(page.locator("#profilePanel")).toBeVisible();
    });

    test("an edge swipe follows the finger and pops the detail screen", async ({ page, context }, testInfo) => {
        test.skip(testInfo.project.name !== "android", "Touch gesture");
        await signInToDemo(page);
        const detail = page.locator("#feedDetailDialog");
        await page.locator("[data-feed-detail='9001']").click();
        await expect(detail).toBeVisible();
        const cdp = await context.newCDPSession(page);
        const touch = (type, x) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y: 400 }] });

        // A short, slow drag springs back.
        await touch("touchStart", 6);
        for (let x = 16; x <= 90; x += 10) { await touch("touchMove", x); await page.waitForTimeout(30); }
        const midDrag = await detail.evaluate((screen) => new DOMMatrix(getComputedStyle(screen).transform).m41);
        expect(midDrag).toBeGreaterThan(60);
        await touch("touchEnd", 90);
        await page.waitForTimeout(400);
        await expect(detail).toBeVisible();

        // Past a third of the width it completes and pops history.
        await touch("touchStart", 6);
        for (let x = 30; x <= 300; x += 30) { await touch("touchMove", x); await page.waitForTimeout(16); }
        await touch("touchEnd", 300);
        await expect(detail).toBeHidden();
        await expect(page).not.toHaveURL(/#screen=/);
    });
});

test.describe("pull to refresh", () => {
    const touch = (page, selector, type, y) => page.evaluate(({ selector, type, y }) => {
        const target = document.querySelector(selector);
        const event = new Event(type, { bubbles: true });
        Object.defineProperty(event, "touches", { value: y === null ? [] : [{ clientY: y }] });
        target.dispatchEvent(event);
    }, { selector, type, y });

    test("holds a spinner until the refresh finishes and never starts inside the fixed chat room", async ({ page }) => {
        await signInToDemo(page);
        let release;
        await page.evaluate(async () => {
            const { DemoAPI } = await import("/app/demo-api.js");
            const original = DemoAPI.prototype.getPersonalFeed;
            DemoAPI.prototype.getPersonalFeed = async function slowFeed(...args) {
                await new Promise((resolve) => { window.__finishRefresh = resolve; });
                return original.apply(this, args);
            };
        });
        const indicator = page.locator("#pullRefreshIndicator");
        await touch(page, "#feedList", "touchstart", 10);
        await touch(page, "#feedList", "touchmove", 160);
        await expect(indicator).toHaveClass(/ready/);
        await expect(indicator).toHaveClass(/dragging/);
        expect(await indicator.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
        await touch(page, "#feedList", "touchend", null);
        await expect(indicator).toHaveClass(/refreshing/);
        await page.waitForTimeout(300);
        await expect(indicator).toHaveClass(/refreshing/);
        await page.evaluate(() => window.__finishRefresh());
        await expect(indicator).not.toHaveClass(/refreshing/);

        // Dragging down through the chat room's history must not refresh the room.
        await page.locator("#bottomNav").getByRole("button", { name: "Chats", exact: true }).click();
        await page.locator("[data-open-chat='chat-friends']").first().click();
        await expect(page.locator(".chat-room-screen")).toBeVisible();
        await touch(page, ".chat-timeline", "touchstart", 200);
        await touch(page, ".chat-timeline", "touchmove", 400);
        await expect(indicator).not.toHaveClass(/ready/);
        await touch(page, ".chat-timeline", "touchend", null);
        await expect(indicator).not.toHaveClass(/refreshing/);
    });
});

test.describe("install and update", () => {
    const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";

    test.describe("on iPhone Safari", () => {
        test.use({ userAgent: IPHONE_SAFARI });

        test("offers Add to Home Screen where Android offers install and notifications", async ({ page }) => {
            await signInToDemo(page);
            const prompt = page.locator("#feedNotificationPrompt");
            await expect(prompt).toBeVisible();
            await expect(prompt.getByRole("button", { name: "Add to Home Screen" })).toBeVisible();
            await prompt.getByRole("button", { name: "Add to Home Screen" }).click();
            const sheet = page.getByRole("dialog", { name: "Add Valid to your Home Screen" });
            await expect(sheet).toBeVisible();
            await expect(sheet).toContainText("Share");
            await expect(sheet).toContainText("notifications work only in the Home Screen app");
            await sheet.getByRole("button", { name: "Got it" }).click();
            await expect(sheet).toBeHidden();
            await expect(prompt).toBeHidden();

            await page.locator("#bottomNav").getByRole("button", { name: "Profile", exact: true }).click();
            const row = page.locator("#installAppButton");
            await expect(row).toBeVisible();
            await expect(row).toContainText("Add to Home Screen");
            await row.click();
            await expect(page.getByRole("dialog", { name: "Add Valid to your Home Screen" })).toBeVisible();
        });
    });

    test("the update prompt is reachable while signed out", async ({ page }) => {
        await page.goto("/app/?demo=1&signin=1");
        await expect(page.getByText("Welcome Back")).toBeVisible();
        await page.evaluate(() => document.querySelector("#appUpdatePrompt").classList.remove("hidden"));
        await expect(page.getByRole("button", { name: "Update" })).toBeVisible();
    });

    test("the manifest offers narrow screenshots for the richer Android install sheet", async ({ request }) => {
        const manifest = await (await request.get("/app/manifest.webmanifest")).json();
        expect(manifest.screenshots.length).toBeGreaterThanOrEqual(3);
        for (const screenshot of manifest.screenshots) {
            expect(screenshot.form_factor).toBe("narrow");
            const response = await request.get(new URL(screenshot.src, "http://host/app/").pathname);
            expect(response.ok()).toBeTruthy();
            expect(screenshot.label).toBeTruthy();
        }
    });
});

test.describe("announcement banners", () => {
    test("show like iOS, open links in a new tab, and stay dismissed", async ({ page, context }) => {
        await signInToDemo(page, "&banner=1");
        const banner = page.getByRole("status", { name: "Announcement" });
        await expect(banner).toBeVisible();
        await expect(banner).toContainText("Spirit Week is here");
        await expect(banner.locator(".app-banner-chevron")).toBeVisible();
        const box = await banner.boundingBox();
        expect(box.y).toBeLessThan(80);

        const popup = context.waitForEvent("page");
        await banner.locator(".app-banner-body").click();
        expect((await popup).url()).toContain("community-guidelines");
        await expect(banner).toBeHidden();
        expect(await page.evaluate(() => localStorage.getItem("valid:dismissed-banners"))).toContain("7");

        await page.reload();
        await page.getByRole("button", { name: /^sign in$/i }).click();
        await expect(page.getByRole("button", { name: "Feed", exact: true })).toBeVisible();
        await page.waitForTimeout(500);
        await expect(page.locator(".app-banner")).toHaveCount(0);
    });

    test("a non-dismissible banner has no close button", async ({ page }) => {
        await signInToDemo(page, "&banner=locked");
        const banner = page.getByRole("status", { name: "Announcement" });
        await expect(banner).toContainText("Scheduled maintenance");
        await expect(banner.getByRole("button", { name: "Dismiss" })).toHaveCount(0);
        await expect(banner.locator(".app-banner-chevron")).toHaveCount(0);
    });

    test("the web client identifies itself to the banner endpoint and treats 404 as none", async ({ page }) => {
        const headers = [];
        await page.route("**/api/v1/banner-notifications/active", (route) => {
            headers.push(route.request().headers()["x-client-version"]);
            return route.fulfill({ status: 404, json: { detail: "No active banner notification" } });
        });
        await page.route("**/api/v1/auth/session", (route) => route.fulfill({ status: 401, headers: { "WWW-Authenticate": "Bearer" }, json: { detail: "Authentication required" } }));
        await page.goto("/app/?signin=1");
        const result = await page.evaluate(async () => {
            const { ValidAPI } = await import("/app/api.js");
            return new ValidAPI().getActiveBanner();
        });
        expect(result).toBeNull();
        expect(headers[0]).toMatch(/^web-v\d+$/);
    });
});

test.describe("background work", () => {
    test("returning to the app does not repeat Ask safety reads or double the push status check", async ({ page }) => {
        await signInToDemo(page);
        const counts = await page.evaluate(async () => {
            const { DemoAPI } = await import("/app/demo-api.js");
            const counts = { safety: 0 };
            const original = DemoAPI.prototype.getAnonymousAskSafetyNotices;
            DemoAPI.prototype.getAnonymousAskSafetyNotices = function counted(...args) { counts.safety++; return original.apply(this, args); };
            window.__counts = counts;
            for (let i = 0; i < 3; i++) {
                document.dispatchEvent(new Event("visibilitychange"));
                window.dispatchEvent(new Event("focus"));
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            return counts;
        });
        expect(counts.safety).toBe(0);
    });
});
