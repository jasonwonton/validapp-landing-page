import { test, expect } from "@playwright/test";

// Parents page: "Set up parental controls" (assets/parent-controls.js).
// POST /api/v1/parent-links/enable answers {"ready": true} for any account,
// so the page shows the same steps whatever the parent typed.

const field = (page) => page.getByLabel("Your child's @username or phone number");
const submit = (page) => page.getByRole("button", { name: "Turn on Parent access" });

test("a username turns on Parent access, then the steps walk the parent through linking", async ({ page }) => {
    let submitted;
    await page.route("**/api/v1/**", (route) => {
        expect(route.request().url()).toContain("/api/v1/parent-links/enable");
        expect(route.request().method()).toBe("POST");
        submitted = route.request().postDataJSON();
        return route.fulfill({ json: { ready: true } });
    });
    await page.goto("/parents.html#setup-parent-access");
    await expect(page.locator("#parent-link-steps")).toBeHidden();
    await field(page).fill(" @Maya.Cruz ");
    await submit(page).click();
    const steps = page.locator("#parent-link-steps");
    await expect(page.getByRole("heading", { name: "Next, link your phone" })).toBeVisible();
    expect(submitted).toEqual({ username: "maya.cruz" });
    await expect(page.locator("#enabled-account")).toHaveText("@maya.cruz");
    await expect(steps).toBeFocused();
    await expect(steps.locator(".link-steps > li")).toHaveCount(5);
    for (const words of ["Privacy", "Parent access", "Send code", "Link parent", "Open parent view", "Settings"]) {
        await expect(steps).toContainText(words);
    }
    for (const image of await steps.locator("img").all()) {
        await expect(image).toHaveAttribute("alt", /.+/);
        await image.scrollIntoViewIfNeeded();
        await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
    }
    await page.getByRole("button", { name: "Set up another child" }).click();
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveValue("");
    await expect(steps).toBeHidden();
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a phone number is sent as a phone number", async ({ page }) => {
    let submitted;
    await page.route("**/api/v1/**", (route) => {
        submitted = route.request().postDataJSON();
        return route.fulfill({ json: { ready: true } });
    });
    await page.goto("/parents.html");
    await field(page).fill("+1 (555) 010-0136");
    await submit(page).click();
    await expect(page.locator("#parent-link-steps")).toBeVisible();
    expect(submitted).toEqual({ phone_number: "+1 (555) 010-0136" });
    await expect(page.locator("#enabled-account")).toHaveText("+1 (555) 010-0136");
});

test("bad entries stay on the page and server errors can be retried", async ({ page }) => {
    let requests = 0;
    await page.route("**/api/v1/**", (route) => {
        requests += 1;
        return route.fulfill({ status: 429, json: { detail: "Too many requests. Please try again in an hour." } });
    });
    await page.goto("/parents.html");
    await field(page).fill("<script>");
    await submit(page).click();
    await expect(page.locator("#parent-setup-error")).toContainText("3–30 letters");
    await field(page).fill("555-0136");
    await submit(page).click();
    await expect(page.locator("#parent-setup-error")).toContainText("area code");
    expect(requests).toBe(0);
    await field(page).fill("maya");
    await submit(page).click();
    await expect(page.locator("#parent-setup-error")).toContainText("Too many requests");
    await expect(submit(page)).toBeEnabled();
    await expect(page.locator("#parent-link-steps")).toBeHidden();
    await page.unroute("**/api/v1/**");
    await page.route("**/api/v1/**", (route) => route.abort("failed"));
    await submit(page).click();
    await expect(page.locator("#parent-setup-error")).toContainText("Check your connection");
});

test("the parental controls answer lists today's controls and loads its screenshots", async ({ page }) => {
    await page.goto("/parents.html");
    const answer = page.locator("#parental-controls");
    for (const words of ["who can message them", "find them by username", "comment on their posts", "appear in polls", "For You"]) {
        await expect(answer).toContainText(words);
    }
    await expect(answer).not.toContainText("email support@validapp.lol to request Parent access");
    const images = answer.locator(".parent-screenshots img");
    await expect(images).toHaveCount(6);
    for (const image of await images.all()) {
        await expect(image).toHaveAttribute("alt", /.+/);
        await image.scrollIntoViewIfNeeded();
        await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
