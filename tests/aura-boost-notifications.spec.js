import { expect, test } from "@playwright/test";

async function openNotification(page, query) {
    await page.goto(`/app/?demo=1&signin=1&${query}`);
    await page.getByRole("button", { name: /^sign in$/i }).click();
}

test("aura and owned-boost notifications reveal refreshed authoritative profile state", async ({ page }) => {
    await openNotification(page, "tab=profile&notification=aura_gifted");
    await expect(page.getByRole("button", { name: "Profile", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("#profileStatus")).toHaveText("Your aura balance is up to date: 1,280 aura.");
    await expect(page.locator("[data-profile-stat='aura']")).toBeFocused();
    await expect(page).not.toHaveURL(/notification=|boost_type=|target_user_id=/);

    await openNotification(page, "tab=profile&notification=boost_expired&boost_type=targeted");
    await expect(page.locator("#profileStatus")).toHaveText("Your targeted boost ended. Current boost status is shown below.");
    await expect(page.locator("#purchasesSection")).toBeFocused();
    await expect(page).not.toHaveURL(/notification=|boost_type=/);

    await openNotification(page, "tab=profile&notification=target_voted&target_user_id=classmate-1");
    const profile = page.getByRole("dialog", { name: "Profile" });
    await expect(profile).toBeVisible();
    await expect(profile.getByRole("heading", { name: "Maya Chen" })).toBeVisible();
    await expect(page.locator("#toast")).toContainText("Your boost worked");
    await expect(page).not.toHaveURL(/notification=|target_user_id=/);
});

test("secret-admirer boost notification opens Play without exposing identity", async ({ page }) => {
    await openNotification(page, "tab=play&notification=targeted_by_boost");
    await expect(page.getByRole("button", { name: "Play", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("#playStatus")).toHaveText("A secret admirer is now appearing more often in your polls.");
    await expect(page.locator("#toast")).toContainText("A secret admirer is in your polls");
    await expect(page).not.toHaveURL(/notification=|booster/);
});
