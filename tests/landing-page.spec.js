import { expect, test } from "@playwright/test";

test("non-iOS visitors get one direct signup CTA", async ({ page }) => {
    await page.goto("/");
    const ctas = page.locator(".cta-row .button");
    await expect(ctas).toHaveCount(1);
    await expect(ctas.first()).toHaveText("Sign up for Valid");
    await expect(ctas.first()).toHaveAttribute("href", "app/?signup=1");
    await expect(page.getByRole("link", { name: "Download on the App Store" })).toHaveCount(0);
});

test("landing page uses the app palette and prominent wordmark", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(204, 247, 244)");
    const wordmarkWidth = await page.locator(".brand img").evaluate((image) => image.getBoundingClientRect().width);
    expect(wordmarkWidth).toBeGreaterThanOrEqual(124);
    await expect(page.locator("#primaryCta")).toHaveCSS("background-color", "rgb(255, 177, 94)");
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
    await expect(page.locator("#androidInstallCard")).toBeHidden();
});

test("Android visitors see a dismissible home-screen install message", async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "userAgent", {
            configurable: true,
            get: () => "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/138.0 Mobile Safari/537.36",
        });
    });
    await page.goto("/");
    const installCard = page.locator("#androidInstallCard");
    await expect(installCard).toBeVisible();
    await expect(installCard.getByText("Put Valid on your home screen")).toBeVisible();
    await expect(installCard.getByRole("link", { name: "Open Valid to install" })).toHaveAttribute("href", "app/?signin=1&install=1");
    await installCard.getByRole("button", { name: "Dismiss Android install message" }).click();
    await expect(installCard).toBeHidden();
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
    await expect(page.locator("#androidInstallCard")).toBeHidden();
});

test("the non-iOS CTA opens the signup flow", async ({ page }) => {
    await page.goto("/app/?demo=1&signup=1");
    await expect(page.getByRole("dialog", { name: "Create your Valid account" })).toBeVisible();
    await expect(page.getByRole("listbox", { name: "Age" })).toBeVisible();
    await expect(page.getByText("GET STARTED", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("dialog").getByRole("button", { name: "Continue" })).toBeVisible();
});
