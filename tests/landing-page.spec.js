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

test("non-iOS visitors get one direct signup CTA", async ({ page }) => {
    await emulateDesktopVisitor(page);
    await page.goto("/");
    const ctas = page.locator(".cta-row .button");
    await expect(ctas).toHaveCount(1);
    await expect(ctas.first()).toHaveText("Sign up for Valid");
    await expect(ctas.first()).toHaveAttribute("href", "app/?signup=1");
    await expect(page.getByRole("link", { name: "Download on the App Store" })).toHaveCount(0);
});

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
    await expect(page.getByText("Our team reviews user reports within 15 minutes.")).toBeVisible();
    await expect(page.getByRole("link", { name: "support@validapp.lol" })).toHaveAttribute("href", "mailto:support@validapp.lol");
});

test("iOS visitors get one App Store CTA", async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "userAgent", {
            configurable: true,
            get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
        });
    });
    await page.goto("/");
    const ctas = page.locator(".cta-row .button");
    await expect(ctas).toHaveCount(1);
    await expect(ctas.first()).toHaveText("Download on the App Store");
    await expect(ctas.first()).toHaveAttribute("href", "https://apps.apple.com/us/app/valid-compliment-classmates/id6755367062");
    await expect(page.getByRole("link", { name: "Sign up for Valid" })).toHaveCount(0);
    await expect(page.locator("#androidInstallGate")).toBeHidden();
});

test("Android visitors start in a required install flow", async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "userAgent", {
            configurable: true,
            get: () => "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/138.0 Mobile Safari/537.36",
        });
    });
    await page.goto("/");
    const installGate = page.locator("#androidInstallGate");
    await expect(installGate).toBeVisible();
    await expect(installGate.getByRole("heading", { name: "Install Valid to continue" })).toBeVisible();
    await expect(installGate.getByRole("link", { name: "Install Valid" })).toHaveAttribute("href", "app/?install=1&signup=1");
    await expect(page.locator("main")).toBeHidden();
    await expect(installGate.getByRole("button")).toHaveCount(0);
});

test("Android install message stays hidden after the PWA is installed", async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "userAgent", {
            configurable: true,
            get: () => "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/138.0 Mobile Safari/537.36",
        });
        localStorage.setItem("valid:pwa-installed", "1");
    });
    await page.goto("/");
    await expect(page.locator("#androidInstallGate")).toBeHidden();
});

test("the non-iOS CTA opens the signup flow", async ({ page }) => {
    await emulateDesktopVisitor(page);
    await page.goto("/app/?demo=1&signup=1");
    await expect(page.getByRole("dialog", { name: "Create your Valid account" })).toBeVisible();
    await expect(page.getByRole("listbox", { name: "Age" })).toBeVisible();
    await expect(page.getByText("GET STARTED", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("dialog").getByRole("button", { name: "Continue" })).toBeVisible();
});
