import { expect, test } from "@playwright/test";

async function emulateDesktopVisitor(page) {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "userAgent", {
            configurable: true,
            get: () => "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138.0 Safari/537.36",
        });
        Object.defineProperty(navigator, "userAgentData", {
            configurable: true,
            get: () => ({ platform: "macOS", mobile: false, brands: [] }),
        });
    });
}

for (const [device, userAgent] of [
    ["desktop", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138.0 Safari/537.36"],
    ["iOS", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"],
    ["Android", "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/138.0 Mobile Safari/537.36"],
]) {
    test(`${device} visitors see the classmate message and both download options`, async ({ page }) => {
        await page.addInitScript((ua) => {
            Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => ua });
        }, userAgent);
        await page.goto("/");
        await expect(page.getByRole("heading", { name: "Connect with classmates", level: 1 })).toBeVisible();
        await expect(page.getByText("Answer positive polls & connect with your classmates", { exact: true })).toBeVisible();
        await expect(page.getByText("Be kind. Don't bully. Everything is moderated", { exact: true })).toBeVisible();
        await expect(page.locator(".cta-row .button")).toHaveCount(2);
        const apple = page.getByRole("link", { name: "Download on the App Store" });
        const android = page.getByRole("link", { name: "Download on Android" });
        await expect(apple).toBeVisible();
        await expect(apple).toHaveAttribute("href", "https://apps.apple.com/us/app/valid-compliment-classmates/id6755367062");
        await expect(android).toBeVisible();
        await expect(android).toHaveAttribute("href", "app/?install=1&signup=1");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
}

test("landing page uses the app palette and prominent wordmark", async ({ page }) => {
    await emulateDesktopVisitor(page);
    await page.goto("/");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(204, 247, 244)");
    const wordmarkWidth = await page.locator(".hero-logo").evaluate((image) => image.getBoundingClientRect().width);
    expect(wordmarkWidth).toBeGreaterThanOrEqual(124);
    await expect(page.locator(".site-header")).toHaveCount(0);
    await expect(page.locator("#primaryCta")).toHaveCSS("background-color", "rgb(255, 177, 94)");
});

test("community guidelines publish the safety and moderation standards", async ({ page }) => {
    await emulateDesktopVisitor(page);
    await page.goto("/community-guidelines.html");
    await expect(page.getByRole("heading", { name: "Community Guidelines", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bullying And Harassment" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ask Permission Before Posting" })).toBeVisible();
    await expect(page.getByText("You must have permission from everyone featured in the content.", { exact: false })).toBeVisible();
    await expect(page.getByText("Our team reviews user reports within 15 minutes.")).toBeVisible();
    await expect(page.getByRole("link", { name: "support@validapp.lol" })).toHaveAttribute("href", "mailto:support@validapp.lol");
});

test("the PWA supports the signup flow", async ({ page }) => {
    await emulateDesktopVisitor(page);
    await page.goto("/app/?demo=1&signup=1");
    await expect(page.getByRole("dialog", { name: "Create your Valid account" })).toBeVisible();
    await expect(page.getByRole("listbox", { name: "Age" })).toBeVisible();
    await expect(page.getByText("GET STARTED", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("dialog").getByRole("button", { name: "Continue" })).toBeVisible();
});
