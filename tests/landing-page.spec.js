import { expect, test } from "@playwright/test";

test("non-iOS visitors get one direct signup CTA", async ({ page }) => {
    await page.goto("/");
    const ctas = page.locator(".cta-row .button");
    await expect(ctas).toHaveCount(1);
    await expect(ctas.first()).toHaveText("Sign up for Valid");
    await expect(ctas.first()).toHaveAttribute("href", "app/?signup=1");
    await expect(page.getByRole("link", { name: "Download on the App Store" })).toHaveCount(0);
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
});

test("the non-iOS CTA opens the signup flow", async ({ page }) => {
    await page.goto("/app/?demo=1&signup=1");
    await expect(page.getByRole("dialog", { name: "Create your Valid account" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How old are you?" })).toBeVisible();
});
