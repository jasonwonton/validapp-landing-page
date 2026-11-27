import { expect, test } from "@playwright/test";

const API_ORIGIN = "https://api.six7.lol";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const INVITE_ID = "22222222-2222-2222-2222-222222222222";
const SEND_EVENT_ID = "33333333-3333-4333-8333-333333333333";

test("real adapter reports a completed invite share to the sent endpoint", async ({ page }) => {
    await page.addInitScript((apiOrigin) => {
        window.VALID_API_BASE_URL = `${apiOrigin}/api/v1`;
    }, API_ORIGIN);
    let request = null;
    await page.route(`${API_ORIGIN}/api/v1/users/${USER_ID}/invites/${INVITE_ID}/sent`, async (route) => {
        request = { method: route.request().method(), body: route.request().postDataJSON() };
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ invite_id: INVITE_ID, sent_at: new Date().toISOString(), recipient_count: 1, recorded: true }),
        });
    });
    await page.goto("/");
    const result = await page.evaluate(async ({ userId, inviteId, sendEventId }) => {
        const { ValidAPI } = await import("/app/api.js");
        return new ValidAPI().recordInviteSent(userId, inviteId, { sendEventId });
    }, { userId: USER_ID, inviteId: INVITE_ID, sendEventId: SEND_EVENT_ID });
    expect(result.recorded).toBe(true);
    expect(request).toEqual({
        method: "POST",
        body: { send_event_id: SEND_EVENT_ID, recipient_count: 1, recipient_phone_numbers: [] },
    });
});

async function openProfile(page) {
    await page.goto("/app/?demo=1&signin=1");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.getByRole("button", { name: "Profile", exact: true }).click();
}

test("a resolved share sheet reports the invite as sent", async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "share", { configurable: true, value: async () => {} });
    });
    await openProfile(page);
    await page.locator('[data-profile-invite="snapchat"]').click();
    await expect.poll(() => page.evaluate(() => (window.__validDemoInviteSends || []).length)).toBe(1);
});

test("a cancelled share sheet reports nothing", async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "share", {
            configurable: true,
            value: async () => { throw new DOMException("Share canceled", "AbortError"); },
        });
    });
    await openProfile(page);
    await page.locator('[data-profile-invite="snapchat"]').click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window.__validDemoInviteSends || []).length)).toBe(0);
});

test("copying the link reports the invite as sent", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "clipboard permission is Chromium-only in Playwright");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    });
    await openProfile(page);
    await page.locator('[data-profile-invite="snapchat"]').click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("/invite/demo-");
    await expect.poll(() => page.evaluate(() => (window.__validDemoInviteSends || []).length)).toBe(1);
});
