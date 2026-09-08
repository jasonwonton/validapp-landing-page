import { expect, test } from '@playwright/test';

async function signIn(page) {
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
}

test('posted chats put progress and authoritative streaks in the header, not the timeline', async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1');
    await signIn(page);
    await expect(page.getByRole('button', { name: /Weekend Crew/ }).locator('.chat-moment-streak')).toHaveText('6');
    await expect(page.getByRole('button', { name: /Noah Williams/ }).locator('.chat-moment-streak')).toHaveText('2');
    await page.getByRole('button', { name: /Noah Williams/ }).click();
    const toolbar = page.locator('[data-open-memento-gallery]');
    await expect(toolbar).toHaveAccessibleName('Mementos, 2 of 2 captured. Everyone is done, 2 day streak');
    await expect(page.locator('.chat-daily-row')).toBeHidden();
    await expect(page.locator('.chat-memento-week')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send a sticker', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Send photo or video' }).click();
    await expect(page.getByRole('dialog', { name: 'Send media', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Create a Memento' })).toBeHidden();
});

test('historical responses cannot replace today’s access or outlive the selected day and chat', async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const original = DemoAPI.prototype.getChatDailyRow;
        window.historyRequests = {};
        DemoAPI.prototype.getChatDailyRow = async function (...args) {
            const row = await original.apply(this, args);
            if (!args[2]) return row;
            // A historical lock must never change today's composer or header.
            row.view_gate_locked = true;
            return new Promise(resolve => { window.historyRequests[args[2]] = () => resolve(row); });
        };
    });
    await signIn(page);
    await page.getByRole('button', { name: /Noah Williams/ }).click();
    const toolbar = page.locator('[data-open-memento-gallery]');
    await toolbar.click();
    const dates = await page.locator('[data-memento-date]').evaluateAll(nodes => nodes.map(n => n.dataset.mementoDate));
    const select = date => page.locator(`[data-memento-date="${date}"]`).click();
    const resolve = async date => {
        await expect.poll(() => page.evaluate(key => Boolean(window.historyRequests[key]), date)).toBe(true);
        await page.evaluate(key => window.historyRequests[key](), date);
    };
    await select(dates[0]);
    await select(dates[1]);
    await resolve(dates[1]);
    await expect(page.locator(`[data-memento-date="${dates[1]}"]`)).toHaveAttribute('aria-pressed', 'true');
    await resolve(dates[0]);
    await expect(page.locator(`[data-memento-date="${dates[1]}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.chat-composer')).not.toHaveClass(/hidden/);
    await expect(toolbar).toHaveText('2/22');
    await select(dates[2]);
    await page.locator('[data-close-memento-gallery]').click();
    await expect(page.locator('.chat-memento-gallery img')).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to chats' }).click();
    await page.getByRole('button', { name: /Weekend Crew/ }).click();
    await resolve(dates[2]);
    await expect(toolbar).toBeHidden();
    await expect(page.locator('.chat-composer')).toBeHidden();
    await expect(page.locator('.chat-memento-gallery img')).toHaveCount(0);
    await expect(page.locator('.chat-message')).toHaveCount(0);
});

test('posting in another chat never hides this chat’s capture or unlocks its history', async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const original = DemoAPI.prototype.getChatDailyRow;
        DemoAPI.prototype.getChatDailyRow = async function (...args) {
            const row = await original.apply(this, args);
            if (row) row.viewer_has_posted_today = true; // Global; not this chat's shared flag.
            return row;
        };
    });
    await signIn(page);
    await page.getByRole('button', { name: /Noah Williams/ }).click();
    await expect(page.locator('[data-open-memento-gallery]')).toBeVisible();
    await page.getByRole('button', { name: 'Back to chats' }).click();
    await page.getByRole('button', { name: /Weekend Crew/ }).click();
    await expect(page.locator('[data-open-memento-gallery]')).toBeHidden();
    await expect(page.locator('.chat-composer')).toBeHidden();
    await page.locator('.chat-daily-row > button').click();
    const capture = page.getByRole('dialog', { name: 'Create a Memento' });
    await expect(capture).toBeVisible();
    await capture.locator('.memento-file-input').setInputFiles('assets/AppIconV2.png');
    await capture.getByRole('button', { name: 'Send to Weekend Crew', exact: true }).click();
    await expect(page.locator('[data-open-memento-gallery]')).toBeVisible();
    await expect(page.locator('.chat-daily-row')).toBeHidden();
    await expect(page.locator('.chat-composer')).toBeVisible();
});

test('changing rooms fails closed while the new Memento access check is unresolved or fails', async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const original = DemoAPI.prototype.getChatDailyRow;
        DemoAPI.prototype.getChatDailyRow = function (...args) {
            if (window.failNextLedger) return new Promise((_, reject) => { window.rejectLedger = () => reject(new Error('Offline')); });
            return original.apply(this, args);
        };
    });
    await signIn(page);
    await page.getByRole('button', { name: /Noah Williams/ }).click();
    await expect(page.locator('.chat-message').first()).toBeVisible();
    await page.getByRole('button', { name: 'Back to chats' }).click();
    await page.evaluate(() => { window.failNextLedger = true; });
    await page.getByRole('button', { name: /Weekend Crew/ }).click();
    await expect(page.locator('.chat-message')).toHaveCount(0);
    await expect(page.locator('.chat-composer')).toBeHidden();
    await expect.poll(() => page.evaluate(() => Boolean(window.rejectLedger))).toBe(true);
    await page.evaluate(() => window.rejectLedger());
    await expect(page.locator('.chat-timeline')).toContainText('Could not check Memento access');
    await expect(page.locator('.chat-message')).toHaveCount(0);
    await expect(page.locator('.chat-composer')).toBeHidden();
});

test('realtime Memento refresh updates the server streak without leaking into a different room', async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        window.EventSource = class {
            static CLOSED = 2;
            constructor() { window.chatEventsFixture = this; }
            addEventListener(_name, handler) { this.consume = handler; }
            close() {}
        };
        DemoAPI.prototype.chatEventsURL = () => '/fixture-chat-events';
        const original = DemoAPI.prototype.getChatDailyRow;
        DemoAPI.prototype.getChatDailyRow = async function (...args) {
            window.chatDemo = this;
            const row = await original.apply(this, args);
            if (window.delayRealtimeLedger) {
                window.delayRealtimeLedger = false;
                return new Promise(resolve => { window.resolveRealtimeLedger = () => resolve(row); });
            }
            return row;
        };
    });
    await signIn(page);
    await page.getByRole('button', { name: /Noah Williams/ }).click();
    const toolbar = page.locator('[data-open-memento-gallery]');
    await expect(toolbar.locator('.chat-moment-streak')).toHaveText('2');
    await page.evaluate(() => {
        const chat = window.chatDemo.chats.find(chat => chat.display_name === 'Noah Williams');
        chat.moment_streak = 3;
        window.chatEventsFixture.consume({ data: JSON.stringify({ type: 'memento_created', chat_id: chat.id }) });
    });
    await expect(toolbar.locator('.chat-moment-streak')).toHaveText('3');
    await page.evaluate(() => {
        window.delayRealtimeLedger = true;
        const chat = window.chatDemo.chats.find(chat => chat.display_name === 'Noah Williams');
        window.chatEventsFixture.consume({ data: JSON.stringify({ type: 'memento_created', chat_id: chat.id }) });
    });
    await expect.poll(() => page.evaluate(() => Boolean(window.resolveRealtimeLedger))).toBe(true);
    await page.getByRole('button', { name: 'Back to chats' }).click();
    await page.getByRole('button', { name: /Weekend Crew/ }).click();
    await expect(page.locator('.chat-timeline')).toContainText('Chat locked');
    await page.evaluate(() => window.resolveRealtimeLedger());
    await expect(toolbar).toBeHidden();
    await expect(page.locator('.chat-message')).toHaveCount(0);
    await expect(page.locator('.chat-composer')).toBeHidden();
});

test('a rapid sticker tap sends once and an explicit retry reuses the request identity', async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const original = DemoAPI.prototype.sendChatMessage;
        window.stickerRequests = [];
        DemoAPI.prototype.sendChatMessage = function (...args) {
            if (!args[2].sticker_id) return original.apply(this, args);
            window.stickerRequests.push(structuredClone(args));
            if (window.stickerRequests.length === 1) return new Promise((_, reject) => { window.rejectSticker = () => reject(new Error('Temporarily offline')); });
            return original.apply(this, args);
        };
    });
    await signIn(page);
    await page.getByRole('button', { name: /Noah Williams/ }).click();
    await page.getByRole('button', { name: 'Send a sticker', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Send a sticker', exact: true });
    const sticker = picker.getByRole('button', { name: 'Send saved sticker' });
    await expect(sticker).toBeVisible();
    await expect(picker.getByRole('button', { name: 'Remove saved sticker' })).toHaveCount(0);
    await sticker.evaluate(button => { button.click(); button.click(); });
    await expect(sticker).toBeDisabled();
    expect(await page.evaluate(() => window.stickerRequests.length)).toBe(1);
    await page.evaluate(() => window.rejectSticker());
    await expect(picker.getByRole('status')).toContainText('Tap the same sticker to retry safely');
    await sticker.click();
    await expect(picker).toBeHidden();
    const requests = await page.evaluate(() => window.stickerRequests);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    await expect(page.locator('.chat-message.mine').filter({ has: page.getByRole('img', { name: 'Sticker', exact: true }) })).toHaveCount(1);
});

for (const theme of ['light', 'dark']) {
    test(`${theme} compact header and gallery fit a narrow screen with long names`, async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 740 });
        await page.emulateMedia({ colorScheme: theme });
        await page.goto('/app/?demo=1&signin=1');
        await signIn(page);
        await page.getByRole('button', { name: /Noah Williams/ }).click();
        await page.locator('.chat-room-title strong').evaluate(node => { node.textContent = 'A very long conversation name that should truncate'; });
        const toolbar = page.locator('[data-open-memento-gallery]');
        await expect(toolbar).toBeVisible();
        expect(await toolbar.evaluate(node => node.getBoundingClientRect().right <= innerWidth)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await toolbar.click();
        const gallery = page.getByRole('dialog', { name: 'Mementos', exact: true });
        await expect(gallery).toBeVisible();
        expect(await gallery.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        expect(await gallery.evaluate(node => getComputedStyle(node.querySelector('.chat-memento-week .selected')).backgroundColor !== getComputedStyle(node.querySelector('.chat-memento-week button:not(.selected)')).backgroundColor)).toBe(true);
        await expect(gallery.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    });
}
