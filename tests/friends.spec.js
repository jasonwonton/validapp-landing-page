import { expect, test } from "@playwright/test";

async function signIn(page) {
    await page.goto("/app/?demo=1&signin=1&friends=1");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page.locator(".chat-page-header").getByRole("button", { name: "Add Friends", exact: true }).click();
    return page.getByRole("dialog", { name: "Add Friends", exact: true });
}
const row = (dialog, id) => dialog.locator(`[data-friend-row="classmate-${id}"]`);

test("Add Friends sends, cancels, accepts and removes with refresh reconciliation", async ({ page }) => {
    const dialog = await signIn(page);
    await expect(row(dialog, 4)).toBeVisible();
    await row(dialog, 4).getByRole("button", { name: "Add friend", exact: true }).click();
    await dialog.getByRole("button", { name: /^Requests/ }).click();
    await expect(row(dialog, 4)).toContainText("Pending");
    await row(dialog, 4).getByRole("button", { name: "Cancel request" }).click();
    await expect(row(dialog, 4)).toHaveCount(0);
    await row(dialog, 2).getByRole("button", { name: "Accept", exact: true }).click();
    await dialog.getByRole("button", { name: "Friends", exact: true }).click();
    await expect(row(dialog, 2).getByRole("button", { name: "Message", exact: true })).toBeVisible();
    page.once("dialog", (prompt) => prompt.accept());
    await row(dialog, 2).getByRole("button", { name: "Remove friend", exact: true }).click();
    await expect(row(dialog, 2)).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.locator('#profilePanel [data-open-friends]').click();
    await dialog.getByRole("button", { name: "Friends", exact: true }).click();
    await expect(row(dialog, 2)).toHaveCount(0);
    await expect(row(dialog, 1)).toBeVisible();
});

test("decline is silent, exact search opens a profile and QR links stay off until shared", async ({ page }) => {
    const dialog = await signIn(page);
    await dialog.getByRole("button", { name: /^Requests/ }).click();
    await row(dialog, 2).getByRole("button", { name: "Decline", exact: true }).click();
    await expect(row(dialog, 2)).toHaveCount(0);
    await dialog.getByLabel("Find people").fill("maya_c");
    await expect(row(dialog, 1).getByRole("button", { name: "Message", exact: true })).toBeVisible();
    await row(dialog, 1).getByRole("button", { name: /Maya Chen/ }).click();
    await expect(page.getByRole("dialog", { name: "Profile", exact: true })).toBeVisible();
    await page.locator('#backToClassmatesButton').click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "My link & QR code" }).click();
    await expect(dialog.getByRole("img", { name: "QR code for your Add me link" })).toBeVisible();
    await expect(dialog.getByLabel("Link enabled")).not.toBeChecked();
});

test("parent privacy locks and held previews remain enforced", async ({ page }) => {
    await signIn(page);
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        DemoAPI.prototype.getFriendReach = async () => ({ available: true, school_contacts_only: true, locked_by_parent: true });
        DemoAPI.prototype.getMessageRequests = async () => ({ available: true, from_anyone: false, locked_by_parent: true });
        const original = DemoAPI.prototype.getPeopleRequests;
        DemoAPI.prototype.getPeopleRequests = async function (...args) {
            const result = await original.apply(this, args);
            result.incoming[0] = { ...result.incoming[0], held: true, messages_held: true, first_message_body: "SECRET HELD TEXT", requester_is_adult: true };
            return result;
        };
    });
    const dialog = page.getByRole("dialog", { name: "Add Friends", exact: true });
    await dialog.getByRole("button", { name: "Privacy", exact: true }).click();
    await expect(dialog.getByRole("checkbox", { name: /School and contacts only/ })).toBeDisabled();
    await expect(dialog.getByRole("checkbox", { name: /Message requests from anyone/ })).toBeDisabled();
    await dialog.getByRole("button", { name: /^Requests/ }).click();
    await expect(dialog).toContainText("This account is an adult");
    await expect(dialog).not.toContainText("SECRET HELD TEXT");
});

test("failed loads expose retry and stale search never replaces a newer query", async ({ page }) => {
    const dialog = await signIn(page);
    await page.evaluate(async () => {
        const { DemoAPI } = await import("/app/demo-api.js");
        const original = DemoAPI.prototype.getFriendSuggestions;
        window.failFriendSuggestions = true;
        DemoAPI.prototype.getFriendSuggestions = async function (...args) {
            if (window.failFriendSuggestions) throw new Error("Fixture connection lost");
            return original.apply(this, args);
        };
        const lookup = DemoAPI.prototype.lookupPerson;
        DemoAPI.prototype.lookupPerson = async function (user, username) {
            if (username === "maya_c") await new Promise((resolve) => setTimeout(resolve, 600));
            return lookup.call(this, user, username);
        };
    });
    await dialog.getByRole("button", { name: "Suggested", exact: true }).click();
    await expect(dialog).toContainText("Fixture connection lost");
    await page.evaluate(() => { window.failFriendSuggestions = false; });
    await dialog.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(row(dialog, 4)).toBeVisible();
    await dialog.getByLabel("Find people").fill("maya_c");
    await dialog.getByRole("button", { name: "Search", exact: true }).click();
    await dialog.getByLabel("Find people").fill("noahw");
    await dialog.getByRole("button", { name: "Search", exact: true }).click();
    await expect(row(dialog, 2)).toBeVisible();
    await expect(row(dialog, 1)).toHaveCount(0);
    await expect(dialog.getByLabel("Find people")).toHaveValue("noahw");
});
