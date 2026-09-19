import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const loveFlap = JSON.parse(readFileSync('tests/fixtures/love-flap/release.json'));

async function signIn(page) {
    await page.goto('/app/?demo=1&signin=1&tab=chats&chat=chat-noah');
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const send = DemoAPI.prototype.sendChatMessage;
        window.sentChatBodies = [];
        DemoAPI.prototype.sendChatMessage = async function(...args) {
            sentChatBodies.push(args[2].body); return send.apply(this, args);
        };
    });
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.locator('[data-message-id="msg-n3"]')).toBeVisible();
}

test('/play opens the weekly game locally, preserves the reply and never queues a message', async ({ page }) => {
    await signIn(page);
    const message = page.locator('[data-message-id="msg-n3"]');
    await message.getByRole('button', { name: 'Message actions' }).click();
    await message.getByRole('button', { name: 'Reply', exact: true }).click();
    for (const command of ['/play', '  /PlAy  ']) {
        await page.getByRole('textbox', { name: 'Message', exact: true }).fill(command);
        await page.getByRole('button', { name: 'Send message', exact: true }).click();
        const game = page.getByRole('dialog', { name: 'Weekly game', exact: true });
        await expect(game.getByRole('heading', { name: '67 Challenge' })).toBeVisible();
        await expect(game.locator('[data-instruction]')).toBeVisible();
        await game.getByRole('button', { name: 'Close weekly game' }).click();
        await expect(page.locator('.chat-reply-draft')).toContainText('That was hilarious');
        await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
        expect(await page.evaluate(() => sentChatBodies)).toEqual([]);
        const queued = await page.evaluate(async () => (await import('/app/chat/outbox.js')).listChatTextOutbox('demo-user'));
        expect(queued).toEqual([]);
    }
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('/play later');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(() => page.evaluate(() => sentChatBodies)).toEqual(['/play later']);
});

test('chat command uses the selected Love Flap release and returns to the same room', async ({ page }) => {
    await signIn(page);
    await page.evaluate(async release => {
        const { DemoAPI } = await import('/app/demo-api.js');
        DemoAPI.prototype.getWeeklyGame = async () => ({ release });
        DemoAPI.prototype.startWeeklyGameRun = async () => ({ run_id: '12345678-1234-4234-8234-123456789abc', release_id: release.id, version: 1, seed: 67 });
    }, loveFlap);
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('/play');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('[data-status]')).toHaveText('Tap or press space to flap through the pipes.', { timeout: 20000 });
    await expect(page.frameLocator('iframe[title^="Love Flap"]').locator('canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Close weekly game' }).click();
    await expect(page.locator('.chat-room-title')).toContainText('Noah Williams');
    expect(await page.evaluate(() => sentChatBodies)).toEqual([]);
});

test('game loading errors do not send the command as chat text', async ({ page }) => {
    await signIn(page);
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        DemoAPI.prototype.getWeeklyGame = async () => { throw Error('Game temporarily unavailable'); };
    });
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('/play');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('Game temporarily unavailable');
    expect(await page.evaluate(() => sentChatBodies)).toEqual([]);
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
});

test('local demo shows the weekly game card without test-only API overrides', async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.locator('#weeklyGameButton')).toBeVisible();
    await expect(page.locator('#weeklyGameTitle')).toHaveText('67 Challenge');
    await page.locator('#weeklyGameButton').click();
    await expect(page.getByRole('dialog', { name: 'Weekly game' })).toBeVisible();
});
