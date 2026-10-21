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
    await row(dialog, 2).getByRole("button", { name: "Remove friend", exact: true }).click();
    await page.locator(".ui-sheet").getByRole("button", { name: "Remove friend", exact: true }).click();
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

test("blocking removes a friendship and opaque blocked rows never reveal a sender", async ({ page }) => {
    const dialog = await signIn(page);
    await dialog.getByRole("button", { name: "Friends", exact: true }).click();
    await row(dialog, 1).getByRole("button", { name: /Maya Chen/ }).click();
    const profile = page.getByRole("dialog", { name: "Profile", exact: true });
    await expect(profile.getByRole("button", { name: "Chat", exact: true })).toBeVisible();
    await profile.getByRole("button", { name: "More profile actions" }).click();
    await profile.locator('[data-block-classmate]').click();
    await page.locator('.ui-sheet').getByRole("button", { name: "Block", exact: true }).click();
    await expect(profile).toBeHidden();
    await page.locator('.chat-page-header [data-open-friends]').click();
    await dialog.getByRole("button", { name: "Friends", exact: true }).click();
    await expect(row(dialog, 1)).toHaveCount(0);
    await dialog.getByRole("button", { name: "Blocked", exact: true }).click();
    await expect(row(dialog, 1)).toContainText("Maya");
    await row(dialog, 1).getByRole("button", { name: "Unblock", exact: true }).click();
    await expect(row(dialog, 1)).toHaveCount(0);
    await dialog.getByRole("button", { name: "Friends", exact: true }).click();
    await expect(row(dialog, 1)).toHaveCount(0);
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        DemoAPI.prototype.getBlockedProfiles = async () => [{ user_id: 'opaque-block', first_name: 'SECRET NAME', username: 'private-name', profile_picture_url: 'https://private.invalid/secret', anonymous_sender: true }];
    });
    await dialog.getByRole("button", { name: "Blocked", exact: true }).click();
    const anonymous = dialog.locator('[data-friend-row="opaque-block"]');
    await expect(anonymous.locator("[data-friend-profile]")).toBeDisabled();
    await expect(anonymous).toContainText("Anonymous sender");
    await expect(anonymous).not.toContainText("SECRET NAME");
    await expect(anonymous.locator('[src*="private.invalid"]')).toHaveCount(0);
});

test("signed-out Add me deep link resumes after login and rejected links do not create requests", async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1&friends=1&add=maya_c');
    await page.getByRole("button", { name: /^sign in$/i }).click();
    const dialog = page.getByRole("dialog", { name: "Add Friends", exact: true });
    await expect(dialog).toBeVisible();
    await expect(row(dialog, 1)).toBeVisible();
    await dialog.getByRole("button", { name: "Open a link or QR code" }).click();
    await dialog.getByLabel("Valid Add me link").fill('https://untrusted.invalid/add/maya_c');
    await dialog.getByRole("button", { name: "Open link", exact: true }).click();
    await expect(dialog).toContainText('Use a https://validapp.lol/add/username link');
    await dialog.getByRole("button", { name: /^Requests/ }).click();
    await expect(row(dialog, 1)).toHaveCount(0);
});

test('a cancelled browser share leaves Add me off; a completed share enables it', async ({ page }) => {
    const dialog = await signIn(page);
    await page.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('Cancelled', 'AbortError'); } }); });
    await dialog.getByRole('button', { name: 'My link & QR code', exact: true }).click();
    await expect(dialog.getByLabel('Link enabled')).not.toBeChecked();
    await dialog.getByRole('button', { name: 'Share link', exact: true }).click();
    await expect(dialog.getByLabel('Link enabled')).not.toBeChecked();
    await page.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: async () => {} }); });
    await dialog.getByRole('button', { name: 'Share link', exact: true }).click();
    await expect(dialog.getByLabel('Link enabled')).toBeChecked();
});

test('a failed lazy Friends load can be retried after reconnecting', async ({ page }) => {
    await page.route('**/app/friends/index.js', route => route.abort('internetdisconnected'));
    await page.goto('/app/?demo=1&signin=1&friends=1');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await page.locator('.chat-page-header [data-open-friends]').click();
    await expect(page.locator('#toast')).toContainText("Add Friends couldn't open");
    await page.unroute('**/app/friends/index.js');
    await page.locator('.chat-page-header [data-open-friends]').click();
    await expect(page.getByRole('dialog', { name: 'Add Friends', exact: true })).toBeVisible();
});

test('Friends stays readable and reachable at compact and desktop widths', async ({ page }) => {
    const dialog = await signIn(page);
    for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await expect(dialog.getByRole('button', { name: 'Close Add Friends', exact: true })).toBeInViewport();
        await expect(dialog.getByLabel('Find people')).toBeInViewport();
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        expect((await dialog.getByLabel('Find people').boundingBox()).width).toBeGreaterThan(140);
        for (const tab of ['Classmates', 'Friends', 'Privacy']) await dialog.getByRole('button', { name: tab, exact: true }).click();
        await expect(dialog.getByRole('checkbox', { name: /School and contacts only/ })).toBeVisible();
    }
});
