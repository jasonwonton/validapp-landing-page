import { expect, test } from '@playwright/test';

async function openLockedChat(page) {
    await page.goto('/app/?demo=1&signin=1');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await page.getByRole('button', { name: /Weekend Crew/ }).click();
}

for (const theme of ['light', 'dark']) for (const width of [320, 393]) {
    test(`${theme} Memento gate at ${width}px matches the native action hierarchy`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 740 });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await openLockedChat(page);
        const gate = page.locator('.chat-daily-row.is-gate');
        await expect(gate.getByRole('heading', { name: "Today's Memento" })).toBeVisible();
        await expect(gate.locator('.chat-daily-icon')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(gate.locator('[data-open-memento]')).toHaveCSS('background-color', 'rgb(255, 177, 94)');
        const skip = gate.getByRole('button', { name: 'Skip for today' });
        await expect(skip).toBeVisible();
        const rect = await skip.boundingBox();
        expect(rect.y + rect.height).toBeLessThanOrEqual(740);
        expect(rect.height + .0001).toBeGreaterThanOrEqual(44);
        await expect(page.locator('.chat-message')).toHaveCount(0);
        await expect(page.locator('.chat-composer')).toBeHidden();
        await page.screenshot({ path: `artifacts/memento-gate/${theme}-${width}-${testInfo.project.name}.png`, animations: 'disabled' });
        await skip.click();
        await expect(page.locator('.chat-composer')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Skip for today' })).toHaveCount(0);
        await expect(page.locator('[data-memento-dialog]')).not.toBeVisible();
    });
}

test('skip stays locked on failure, prevents repeat submissions and can retry explicitly', async ({ page }) => {
    await openLockedChat(page);
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const original = DemoAPI.prototype.skipChatMemento;
        window.skipRequests = 0;
        DemoAPI.prototype.skipChatMemento = function(...args) {
            window.skipRequests++;
            if (window.skipRequests === 1) return new Promise((_, reject) => window.rejectSkip = () => reject(new Error('Could not skip. Try again.')));
            return original.apply(this, args);
        };
    });
    await page.getByRole('button', { name: 'Skip for today' }).click();
    await expect(page.getByRole('button', { name: 'Skipping…' })).toBeDisabled();
    await expect(page.locator('[data-open-memento]')).toBeDisabled();
    await page.evaluate(() => document.querySelector('.memento-gate-skip').click());
    expect(await page.evaluate(() => skipRequests)).toBe(1);
    await page.evaluate(() => rejectSkip());
    await expect(page.locator('.chat-room-status')).toHaveText('Could not skip. Try again.');
    await expect(page.locator('.chat-message')).toHaveCount(0);
    await expect(page.locator('.chat-composer')).toBeHidden();
    await page.getByRole('button', { name: 'Skip for today' }).click();
    await expect(page.locator('.chat-composer')).toBeVisible();
    expect(await page.evaluate(() => skipRequests)).toBe(2);
});

test('finishing a skip after leaving a room cannot navigate back to it', async ({ page }) => {
    await openLockedChat(page);
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const original = DemoAPI.prototype.skipChatMemento;
        DemoAPI.prototype.skipChatMemento = function(...args) {
            return new Promise(resolve => window.finishSkip = async () => resolve(await original.apply(this, args)));
        };
        const getRow = DemoAPI.prototype.getChatDailyRow;
        DemoAPI.prototype.getChatDailyRow = async function(...args) {
            const row = await getRow.apply(this, args);
            return args[1] === 'chat-noah' ? { ...row, viewer_has_shared: false, view_gate_locked: true } : row;
        };
    });
    await page.getByRole('button', { name: 'Skip for today' }).click();
    await page.getByRole('button', { name: 'Back to chats' }).click();
    await page.getByRole('button', { name: /Noah Williams/ }).click();
    await page.evaluate(() => finishSkip());
    await expect(page.locator('.chat-room-title strong')).toHaveText('Noah Williams');
    await expect(page.getByRole('button', { name: 'Skip for today' })).toBeEnabled();
    await expect(page.locator('[data-open-memento]')).toBeEnabled();
    await expect(page.locator('.chat-composer')).toBeHidden();
    await expect(page.locator('.chat-message')).toHaveCount(0);
});
