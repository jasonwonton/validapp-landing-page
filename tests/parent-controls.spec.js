import { test, expect } from "@playwright/test";

test("parent submits a username, then gets phone-linking instructions", async ({ page }) => {
    let submitted;
    await page.route("**/api/v1/**", route => {
        expect(route.request().url()).toContain("/parent-links/enable");
        expect(route.request().method()).toBe("POST");
        submitted = route.request().postDataJSON();
        return route.fulfill({ json: { ready: true } });
    });
    await page.goto("/parents.html#setup-parent-access");
    await page.getByLabel("Your child's username").fill(" @Teenie ");
    await page.getByRole("button", { name: "Enable Parent access" }).click();
    await expect(page.getByRole("heading", { name: "Parent access is ready to link" })).toBeVisible();
    expect(submitted).toEqual({ username: "teenie" });
    await expect(page.locator("#enabled-username")).toHaveText("@teenie");
    await expect(page.locator("#parent-link-steps")).toContainText("Settings → Privacy → Parent access");
    await expect(page.locator("#parent-link-steps")).toContainText("Parental controls start after linking is complete");
    await expect(page.locator("#parent-link-steps")).toBeFocused();
    await page.getByRole("button", { name: "Set up another child" }).click();
    await expect(page.getByLabel("Your child's username")).toBeFocused();
    await expect(page.getByLabel("Your child's username")).toHaveValue("");
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("invalid usernames stay local and server errors remain retryable", async ({ page }) => {
    let requests = 0;
    await page.route("**/api/v1/**", route => {
        requests += 1;
        return route.fulfill({ status: 429, json: { detail: "Too many requests. Please try again in an hour." } });
    });
    await page.goto("/parents.html");
    await page.getByLabel("Your child's username").fill("<script>");
    await page.getByRole("button", { name: "Enable Parent access" }).click();
    await expect(page.getByRole("alert")).toContainText("3–30 letters");
    expect(requests).toBe(0);
    await page.getByLabel("Your child's username").fill("teenie");
    await page.getByRole("button", { name: "Enable Parent access" }).click();
    await expect(page.getByRole("alert")).toContainText("Too many requests");
    await expect(page.getByRole("button", { name: "Enable Parent access" })).toBeEnabled();
    await expect(page.locator("#parent-link-steps")).toBeHidden();
    await page.route("**/api/v1/**", route => route.abort("failed"));
    await page.getByRole("button", { name: "Enable Parent access" }).click();
    await expect(page.getByRole("alert")).toContainText("Check your connection");
});

test("privacy and friendship examples identify the preview and load their screenshots", async ({ page }) => {
    await page.goto("/parents.html");
    const section = page.locator("details").filter({ has: page.getByText("How do friends, followers, and privacy settings work?") });
    await expect(section).toContainText("a preview of an upcoming app update");
    await expect(section).toContainText("someone who saved your child's number");
    const images = section.locator("img");
    await expect(images).toHaveCount(4);
    for (const image of await images.all()) {
        await expect(image).toHaveAttribute("alt", /.+/);
        await image.scrollIntoViewIfNeeded();
        await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
