import { expect, test } from "@playwright/test";

async function signIn(page, query = "") {
    await page.goto(`/app/?demo=1&signin=1${query}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByRole("button", { name: "Feed", exact: true })).toBeVisible();
}

async function enableLater(page, patch) {
    await page.evaluate(async (flags) => {
        const { DemoAPI } = await import("/app/demo-api.js");
        const original = DemoAPI.prototype.getConfig;
        DemoAPI.prototype.getConfig = async function () { return { ...(await original.call(this)), ...flags }; };
    }, patch);
    await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
        document.dispatchEvent(new Event("visibilitychange"));
    });
}

const commentsOnTop = (page) => page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest(".detail-screen")?.id);

test("comments open on top of the poll they belong to", async ({ page }) => {
    await signIn(page);
    await page.locator('[data-feed-detail="9001"]').click();
    await page.locator("#feedDetailDialog [data-comments-target]").first().click();
    await expect(page.locator("#commentsDialog")).toBeVisible();
    await expect.poll(() => commentsOnTop(page)).toBe("commentsDialog");
});

test("comments switched on after sign-in appear once the app returns", async ({ page }) => {
    await signIn(page, "&comments=0");
    await enableLater(page, { enable_web_comments: true });
    await expect.poll(() => page.evaluate(() => document.querySelector('[data-feed-detail="9001"]') !== null)).toBe(true);
    await page.waitForTimeout(300);
    await page.locator('[data-feed-detail="9001"]').click();
    await page.locator("#feedDetailDialog [data-comments-target]").first().click();
    await expect.poll(() => commentsOnTop(page)).toBe("commentsDialog");
});

test("the Stories rail appears when Stories are enabled after sign-in", async ({ page }) => {
    await signIn(page, "&stories=0");
    await expect(page.locator("#storiesRoot .own-story")).toHaveCount(0);
    await enableLater(page, { enable_stories: true, enable_web_stories: true });
    await expect(page.locator("#storiesRoot .own-story")).toBeVisible();
});

test("the chat camera is requested inside the tap, before the camera module loads", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "fake media stream");
    await page.addInitScript(() => {
        window.__cameraRequests = [];
        document.addEventListener("click", () => { window.__inTapTask = true; setTimeout(() => { window.__inTapTask = false; }, 0); }, true);
        const original = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
        if (!original) return;
        navigator.mediaDevices.getUserMedia = (constraints) => { window.__cameraRequests.push({ video: Boolean(constraints?.video), inTap: window.__inTapTask === true }); return original(constraints); };
    });
    await signIn(page);
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.getByRole("button", { name: /Noah Williams/ }).click();
    await page.getByRole("button", { name: "Send photo or video" }).click();
    await expect.poll(() => page.evaluate(() => window.__cameraRequests.filter((request) => request.video).length)).toBeGreaterThan(0);
    const first = await page.evaluate(() => window.__cameraRequests.find((request) => request.video));
    expect(first.inTap).toBe(true);
    await expect(page.locator("[data-chat-camera] video")).toBeVisible();
});
