import { expect, test } from '@playwright/test';
async function signIn(page) {
    await page.goto('/app/?demo=1&signin=1&friends=1&activity=1');
    await page.getByRole('button', { name: /^sign in$/i }).click();
}
test('Friends follows the native page, capsule tabs and inline action layout', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await page.locator('.chat-page-header [data-open-friends]').click();
    const friends = page.getByRole('dialog', { name: 'Add Friends', exact: true });
    await expect(friends.locator('.friends-tabs > button')).toHaveText(['Friends1', 'Suggested']);
    await expect(friends.locator('.friends-section-title')).toHaveText(['Requests1', '1 friend', 'Sent requests1']);
    for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        if (width < 640) {
            await expect.poll(async () => {
                const rect = await friends.boundingBox();
                return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
            }).toEqual({ x: 0, y: 0, width, height: 844 });
        }
        const row = friends.locator('[data-friend-row="classmate-1"]');
        await expect(row).toBeVisible();
        const geometry = await row.evaluate(element => {
            const person = element.querySelector('.friend-person').getBoundingClientRect();
            const action = element.querySelector('.friend-pill').getBoundingClientRect();
            const card = element.getBoundingClientRect();
            const style = getComputedStyle(element.querySelector('.friend-pill'));
            return { height: card.height, aligned: Math.abs(person.y + person.height / 2 - action.y - action.height / 2), actionHeight: action.height, color: style.color, background: style.backgroundColor, overflow: element.scrollWidth > element.clientWidth };
        });
        expect(geometry.height).toBeLessThan(110);
        expect(geometry.aligned).toBeLessThan(1);
        expect(geometry.actionHeight).toBeGreaterThanOrEqual(44);
        expect(geometry.overflow).toBe(false);
        expect(geometry.color).toBe('rgb(0, 0, 0)');
        expect(geometry.background).toBe('rgb(255, 177, 94)');
    }
});
test('Settings uses Privacy navigation and preserves parent locked choices', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(page.locator('#privacySettings .settings-row strong')).toHaveText(['Notifications', 'Privacy']);
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        DemoAPI.prototype.getFriendReach = async () => ({ available: true, school_contacts_only: true, locked_by_parent: true });
    });
    await page.locator('#privacyPageButton').click();
    const privacy = page.getByRole('dialog', { name: 'Privacy', exact: true });
    await privacy.getByRole('button', { name: /Who can add you/ }).click();
    const choices = page.getByRole('dialog', { name: 'Add Friends', exact: true });
    await expect(choices.getByRole('heading', { name: 'Who can add you', exact: true })).toBeVisible();
    await expect(choices.getByRole('radio', { name: /^School & contacts/ })).toBeChecked();
    await expect(choices.getByRole('radio', { name: /^Everyone/ })).toBeDisabled();
    await choices.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(privacy).toBeVisible();
    await privacy.getByRole('button', { name: 'Back to settings', exact: true }).click();
    await expect(page.locator('#profileCard h3')).toBeVisible();
});
test('opening a bell question and returning restores the notification list', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    const bell = page.getByRole('dialog', { name: 'Notifications', exact: true });
    const row = bell.getByRole('button', { name: /Anonymous question/ }).last();
    await row.scrollIntoViewIfNeeded();
    const scroll = await bell.locator('.notification-list').evaluate(element => element.scrollTop);
    await row.click();
    const question = page.getByRole('dialog', { name: 'Anonymous question', exact: true });
    await expect(question).toBeVisible();
    await question.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(bell).toBeVisible();
    await expect(bell.getByRole('button', { name: /Anonymous question/ }).last()).toBeVisible();
    await expect.poll(() => bell.locator('.notification-list').evaluate(element => element.scrollTop)).toBe(scroll);
});
test('browser Back steps through Friends subpages and reconnect keeps the QR journey', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await page.locator('.chat-page-header [data-open-friends]').click();
    const friends = page.getByRole('dialog', { name: 'Add Friends', exact: true });
    await friends.getByRole('button', { name: 'Friends options', exact: true }).click();
    await friends.getByRole('button', { name: 'Privacy', exact: true }).click();
    await friends.getByRole('button', { name: /Who can add you/ }).click();
    await expect(friends.getByRole('radio', { name: /^School & contacts/ })).toBeVisible();
    await page.goBack();
    await expect(friends.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible();
    await page.goBack();
    await expect(friends.getByRole('heading', { name: 'Friends', exact: true })).toBeVisible();
    await friends.getByRole('button', { name: 'My link & QR code', exact: true }).click();
    const qr = friends.getByRole('img', { name: 'QR code for your Add me link' });
    await expect(qr).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(qr).toBeVisible();
    await expect(friends.getByLabel('Link enabled')).not.toBeChecked();
    await page.goBack();
    await expect(friends.getByRole('heading', { name: 'Friends', exact: true })).toBeVisible();
});
