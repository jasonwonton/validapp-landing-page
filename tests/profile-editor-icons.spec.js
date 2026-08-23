import { expect, test } from "@playwright/test";


test("profile editor uses semantic icons for every Android action", async ({ page }) => {
    await page.goto("/app/?demo=1&signin=1");

    const rows = page.locator("#profileEditorHub .profile-editor-row");
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(0).locator("img")).toHaveAttribute("src", "../assets/app/profile-at.svg");
    await expect(rows.nth(1).locator("img")).toHaveAttribute("src", "../assets/app/profile-person-card.svg");
    await expect(rows.nth(2).locator("img")).toHaveAttribute("src", "../assets/app/profile-school.svg");
    await expect(rows.nth(3).locator("img")).toHaveAttribute("src", "../assets/app/profile-graduation-cap.svg");
    await expect(rows.nth(4).locator("img")).toHaveAttribute("src", "../assets/app/crown.png");
    expect(await rows.locator(".profile-editor-row-icon").allTextContents()).toEqual(["", "", "", "", ""]);
});
