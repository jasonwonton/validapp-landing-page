import { expect, test } from '@playwright/test';

async function mount(page, total = 750) {
    await page.goto('/app/?signin=1');
    await page.evaluate(async total => {
        const { createChatsView } = await import('/app/chat/index.js');
        const chat = { id: 'scroll-chat', display_name: 'Maya', membership_status: 'accepted', accepted_count: 2 };
        const messages = Array.from({ length: total }, (_, i) => ({ id: `m-${i + 1}`, chat_id: chat.id,
            room_sequence: i + 1, sender_user_id: 'peer', sender_first_name: 'Maya', kind: 'text', status: 'active',
            body: `Message ${i + 1}. ` + 'A longer message that wraps naturally. '.repeat(i % 4), created_at: new Date(2e12 + i * 600000).toISOString() }));
        const requests = [];
        let active = 0;
        window.scrollFixture = { messages, requests, reads: [], maxActive: 0, fail: false, stalled: false, hold: null };
        class Source {
            static CLOSED = 2;
            addEventListener(_, handler) { window.scrollFixture.emit = event => handler({ data: JSON.stringify({ chat_id: chat.id, ...event }) }); }
        }
        window.EventSource = Source;
        const api = {
            assetURL: value => value, chatEventsURL: () => '/unused',
            getChats: async () => ({ items: [chat] }), getChat: async () => ({ chat, members: [] }), markChatRead: async (_, id, sequence) => { window.scrollFixture.reads.push({ id, sequence }); return {}; },
            getChatMessages: async (_, id, options) => {
                requests.push({ id, ...options });
                active++; window.scrollFixture.maxActive = Math.max(active, window.scrollFixture.maxActive);
                try {
                    if (window.scrollFixture.hold && (!window.scrollFixture.holdHistoryOnly || options.beforeSequence)) await window.scrollFixture.hold;
                    if (window.scrollFixture.denyRealtime && !options.beforeSequence) throw Object.assign(new Error('Access denied'), { status: 403 });
                    if (window.scrollFixture.fail) throw new Error('Offline');
                    const items = options.beforeSequence ? messages.filter(m => m.room_sequence < options.beforeSequence).slice(-options.limit)
                        : options.afterSequence != null ? messages.filter(m => m.room_sequence > options.afterSequence).slice(0, options.limit) : messages.slice(-options.limit);
                    if (window.scrollFixture.stalled) return { items: messages.slice(-50), next_before_sequence: options.beforeSequence };
                    return { items, next_before_sequence: items.length === options.limit ? items[0].room_sequence : null };
                } finally { active--; }
            },
        };
        const root = document.createElement('div'); root.id = 'scroll-fixture'; document.body.replaceChildren(root);
        const view = createChatsView({ root, api, getUser: () => ({ id: 'scroll-user' }), getConfig: () => ({ enable_chats: true, enable_web_chats: true, enable_chat_daily_ledger: false }) });
        Object.assign(window.scrollFixture, { view, root });
        await view.activate({}); await view.openChat(chat.id, { updateHistory: false });
    }, total);
    await expect.poll(() => page.locator('.chat-timeline').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
}

test('call events refresh the same authoritative history row and preserve removal rules', async ({ page }) => {
    await mount(page, 10);
    await page.evaluate(() => {
        scrollFixture.messages.push({ id: 'call-message', chat_id: 'scroll-chat', room_sequence: 11,
            kind: 'system', status: 'active', sender_user_id: 'scroll-user', viewer_is_sender: true,
            call_id: 'call-1', call_state: 'ringing', call_media_type: 'audio', created_at: new Date().toISOString() });
        scrollFixture.emit({ type: 'call_started', call_id: 'call-1' });
    });
    await expect(page.locator('.chat-call-history')).toHaveText(/Outgoing voice call.*Outgoing/);
    await page.evaluate(() => {
        scrollFixture.messages.at(-1).call_state = 'cancelled';
        scrollFixture.emit({ type: 'call_ended', call_id: 'call-1' });
    });
    await expect(page.locator('.chat-call-history')).toHaveCount(1);
    await expect(page.locator('.chat-call-history')).toContainText('Cancelled voice call');
    await page.evaluate(() => { for (let i = 0; i < 20; i++) scrollFixture.emit({ type: 'call_ended', call_id: 'call-1' }); });
    await expect(page.locator('.chat-call-history')).toHaveCount(1);
    expect(await page.evaluate(() => scrollFixture.maxActive)).toBe(1);
    await page.screenshot({ path: test.info().outputPath('cancelled-call-history.png') });
    await page.evaluate(() => {
        scrollFixture.messages.at(-1).status = 'deleted';
        scrollFixture.emit({ type: 'message_deleted' });
    });
    await expect(page.locator('.chat-call-history')).toHaveCount(0);
    await expect(page.getByText('Message removed', { exact: true })).toBeVisible();
});

async function top(page) { await page.locator('.chat-timeline').evaluate(el => { el.scrollTop = 0; }); }

test('automatic history preserves the exact visible pixel and deduplicates in-flight loads', async ({ page }) => {
    await mount(page);
    await page.evaluate(() => { scrollFixture.hold = new Promise(resolve => { scrollFixture.release = resolve; }); });
    await top(page);
    await expect.poll(() => page.evaluate(() => scrollFixture.requests.filter(r => r.beforeSequence).length)).toBe(1);
    const anchor = await page.locator('.chat-timeline').evaluate(el => {
        const row = el.querySelector('[data-message-id]');
        return { id: row.dataset.messageId, offset: row.getBoundingClientRect().top - el.getBoundingClientRect().top };
    });
    await page.locator('.chat-timeline').evaluate(el => { for (let i = 0; i < 20; i++) el.dispatchEvent(new Event('scroll')); });
    await page.evaluate(() => { scrollFixture.hold = null; scrollFixture.release(); });
    await expect(page.locator('[data-message-id]')).toHaveCount(100);
    await expect.poll(() => page.locator('.chat-timeline').evaluate((el, anchor) => Math.abs(el.querySelector(`[data-message-id="${anchor.id}"]`).getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.offset), anchor)).toBeLessThan(2);
    expect(await page.evaluate(() => scrollFixture.maxActive)).toBe(1);
    expect(await page.evaluate(() => scrollFixture.requests.filter(r => r.beforeSequence).length)).toBe(1);
});

test('scrolls beyond 500 messages and back with bounded memory and DOM', async ({ page }) => {
    await mount(page);
    for (let i = 0; i < 40 && !await page.locator('[data-message-id="m-1"]').count(); i++) {
        const first = await page.locator('[data-message-id]').first().getAttribute('data-message-id');
        await top(page);
        await expect(page.locator('[data-message-id]').first()).not.toHaveAttribute('data-message-id', first);
        expect(await page.locator('[data-message-id]').count()).toBeLessThanOrEqual(120);
        expect(await page.evaluate(() => scrollFixture.view.store.messages().length)).toBeLessThanOrEqual(500);
    }
    await expect(page.locator('[data-message-id="m-1"]')).toHaveCount(1);
    for (let i = 0; i < 40 && !await page.locator('[data-message-id="m-750"]').count(); i++) {
        const last = await page.locator('[data-message-id]').last().getAttribute('data-message-id');
        await page.locator('.chat-timeline').evaluate(el => { el.scrollTop = el.scrollHeight; });
        await expect(page.locator('[data-message-id]').last()).not.toHaveAttribute('data-message-id', last);
        expect(await page.locator('[data-message-id]').count()).toBeLessThanOrEqual(120);
        expect(await page.evaluate(() => scrollFixture.view.store.messages().length)).toBeLessThanOrEqual(500);
    }
    await expect(page.locator('[data-message-id="m-750"]')).toHaveCount(1);
});

test('history failure pauses automatic retry and stale pages cannot enter another room', async ({ page }) => {
    await mount(page);
    await page.evaluate(() => { scrollFixture.fail = true; });
    await top(page);
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    const count = await page.evaluate(() => scrollFixture.requests.length);
    await page.locator('.chat-timeline').evaluate(el => { for (let i = 0; i < 10; i++) el.dispatchEvent(new Event('scroll')); });
    expect(await page.evaluate(() => scrollFixture.requests.length)).toBe(count);
    await page.evaluate(() => { scrollFixture.fail = false; scrollFixture.hold = new Promise(resolve => { scrollFixture.release = resolve; }); });
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.evaluate(async () => {
        const pending = scrollFixture.view.openChat('other-room', { updateHistory: false });
        scrollFixture.hold = null; scrollFixture.release(); await pending;
    });
    expect(await page.evaluate(() => scrollFixture.view.store.messages('scroll-chat').length)).toBe(50);
});

test('realtime and refresh preserve reading position; Latest returns to the newest messages', async ({ page }) => {
    await mount(page, 90);
    await page.locator('.chat-timeline').evaluate(el => { el.scrollTop = 600; });
    await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toBeVisible();
    const anchor = await page.locator('.chat-timeline').evaluate(el => {
        const row = [...el.querySelectorAll('[data-message-id]')].find(row => row.getBoundingClientRect().bottom > el.getBoundingClientRect().top);
        return { id: row.dataset.messageId, offset: row.getBoundingClientRect().top - el.getBoundingClientRect().top };
    });
    await page.evaluate(() => { scrollFixture.messages.push({ ...scrollFixture.messages.at(-1), id: 'm-91', room_sequence: 91, body: 'A new message' }); scrollFixture.emit({ type: 'message_created' }); });
    await expect(page.locator('[data-message-id="m-91"]')).toHaveCount(1);
    const offset = () => page.locator('.chat-timeline').evaluate((el, anchor) => Math.abs(el.querySelector(`[data-message-id="${anchor.id}"]`).getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.offset), anchor);
    await expect.poll(offset).toBeLessThan(2);
    expect(await page.evaluate(() => scrollFixture.reads.at(-1).sequence)).toBe(90);
    await page.evaluate(() => scrollFixture.view.refresh());
    await expect.poll(offset).toBeLessThan(2);
    await page.getByRole('button', { name: 'Jump to latest messages' }).click();
    await expect.poll(() => page.locator('.chat-timeline').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
    expect(await page.evaluate(() => scrollFixture.reads.at(-1).sequence)).toBe(91);
});

test('the final forward window preserves its overlap instead of skipping to the bottom', async ({ page }) => {
    await mount(page, 130);
    await top(page);
    await expect(page.locator('[data-message-id="m-31"]')).toHaveCount(1);
    await top(page);
    await expect(page.locator('[data-message-id="m-1"]')).toHaveCount(1);
    await expect(page.locator('[data-message-id="m-130"]')).toHaveCount(0);
    const anchor = await page.locator('.chat-timeline').evaluate(el => {
        el.scrollTop = el.scrollHeight;
        const row = [...el.querySelectorAll('[data-message-id]')].find(row => row.getBoundingClientRect().bottom > el.getBoundingClientRect().top);
        return { id: row.dataset.messageId, offset: row.getBoundingClientRect().top - el.getBoundingClientRect().top };
    });
    await expect(page.locator('[data-message-id="m-130"]')).toHaveCount(1);
    await expect.poll(() => page.locator('.chat-timeline').evaluate((el, anchor) => Math.abs(el.querySelector(`[data-message-id="${anchor.id}"]`).getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.offset), anchor)).toBeLessThan(2);
});

test('delayed row growth preserves a reader and follows the bottom only when already there', async ({ page }) => {
    await mount(page, 60);
    await page.locator('.chat-timeline').evaluate(el => { el.scrollTop = 1100; });
    await expect(page.getByRole('button', { name: 'Jump to latest messages' })).toBeVisible();
    const anchor = await page.locator('.chat-timeline').evaluate(el => {
        const row = [...el.querySelectorAll('[data-message-id]')].find(row => row.getBoundingClientRect().bottom > el.getBoundingClientRect().top);
        return { id: row.dataset.messageId, offset: row.getBoundingClientRect().top - el.getBoundingClientRect().top };
    });
    await page.locator('[data-message-id]').first().locator('p').evaluate(el => { el.textContent += ' A media caption expanding after loading.'.repeat(30); });
    await expect.poll(() => page.locator('.chat-timeline').evaluate((el, anchor) => Math.abs(el.querySelector(`[data-message-id="${anchor.id}"]`).getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.offset), anchor)).toBeLessThan(2);
    await page.getByRole('button', { name: 'Jump to latest messages' }).click();
    await page.evaluate(() => { scrollFixture.messages.push({ ...scrollFixture.messages.at(-1), id: 'm-61', room_sequence: 61 }); scrollFixture.emit({ type: 'message_created' }); });
    await expect(page.locator('[data-message-id="m-61"]')).toHaveCount(1);
    await expect.poll(() => page.locator('.chat-timeline').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
});

test('a non-advancing history response stops instead of looping', async ({ page }) => {
    await mount(page);
    await page.evaluate(() => { scrollFixture.stalled = true; });
    await top(page);
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    expect(await page.evaluate(() => scrollFixture.view.store.messages().length)).toBe(50);
    expect(await page.evaluate(() => scrollFixture.requests.filter(r => r.beforeSequence).length)).toBe(1);
});

test('an old history response cannot restore messages after an access-denied repair', async ({ page }) => {
    await mount(page);
    await page.evaluate(() => {
        scrollFixture.holdHistoryOnly = true;
        scrollFixture.hold = new Promise(resolve => { scrollFixture.release = resolve; });
    });
    await top(page);
    await expect.poll(() => page.evaluate(() => scrollFixture.requests.filter(r => r.beforeSequence).length)).toBe(1);
    await page.evaluate(() => { scrollFixture.denyRealtime = true; scrollFixture.emit({ type: 'resync' }); });
    await expect(page.locator('[data-message-id]')).toHaveCount(0);
    await page.evaluate(() => { scrollFixture.hold = null; scrollFixture.release(); });
    await expect.poll(() => page.evaluate(() => scrollFixture.view.store.messages().length)).toBe(0);
    await expect(page.locator('[data-message-id]')).toHaveCount(0);
});

test('keyed updates keep unchanged focused controls connected', async ({ page }) => {
    await page.goto('/app/?signin=1');
    const result = await page.evaluate(async () => {
        const { reconcileKeyedElements } = await import('/app/keyed-list.js');
        const root = document.createElement('div'); document.body.append(root);
        const entries = ['a', 'b'].map(key => ({ key, html: `<button data-list-key="${key}">${key}</button>` }));
        reconcileKeyedElements(root, entries);
        const button = root.lastElementChild; button.focus();
        let blurCount = 0; button.addEventListener('blur', () => blurCount++);
        reconcileKeyedElements(root, [{ key: 'c', html: '<button>c</button>' }, ...entries]);
        return { same: root.lastElementChild === button, focused: document.activeElement === button, blurCount };
    });
    expect(result).toEqual({ same: true, focused: true, blurCount: 0 });
});
