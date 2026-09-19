import { expect, test } from '@playwright/test';

async function signIn(page, extra = '') {
    await page.goto(`/app/?demo=1&signin=1${extra}`);
    await page.getByRole('button', { name: /^sign in$/i }).click();
}

test('inbox badges and TBH detail reactions stay consistent when returning', async ({ page }) => {
    await signIn(page);
    await expect(page.locator('[data-feed-detail="9001"] .inbox-content-badge')).toHaveText('POLL');
    const row = page.locator('[data-tbh-detail^="received:"]').first();
    await expect(row.locator('.tbh-avatar-badge')).toHaveText('TBH');
    await expect(row).toHaveCSS('border-top-width', '3px');
    await row.click();
    const detail = page.locator('#tbhDetailDialog');
    await expect(detail.locator('h2')).toContainText('Noah Williams sent you a TBH');
    await expect(detail.locator('.tbh-detail-avatar')).toBeVisible();
    await detail.locator('[data-reaction-picker]').click();
    await page.getByRole('dialog', { name: 'Choose a reaction' }).getByRole('button', { name: 'Fire', exact: true }).click();
    await expect(detail.locator('[data-reaction-picker]')).toContainText('🔥');
    const count = await detail.locator('[data-reactors]').textContent();
    await detail.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(row.locator('[data-reaction-picker]')).toContainText('🔥');
    await expect(row.locator('[data-reactors]')).toHaveText(count);
});

test('Ask Me reply opens as a full page and browser back returns to inbox', async ({ page }) => {
    await signIn(page);
    await page.locator('[data-inbox-filter="ask_me"]').click();
    await expect(page.locator('[data-anonymous-answer] .inbox-content-badge').first()).toHaveText('ASK ME');
    await page.locator('[data-anonymous-answer]').first().click();
    const reply = page.getByRole('dialog', { name: 'Reply', exact: true });
    await expect(reply).toBeVisible();
    await expect(reply).toHaveJSProperty('tagName', 'SECTION');
    await expect(reply.getByText('Maya Chen replied to you')).toBeVisible();
    await expect(reply.locator('.anonymous-response-card')).toHaveCount(2);
    await expect(reply.getByRole('button', { name: 'Close' })).toHaveCSS('font-size', '16px');
    await page.goBack();
    await expect(reply).toBeHidden();
    await expect(page.locator('[data-anonymous-answer]').first()).toBeVisible();
});

test('question submission preserves native privacy copy and scrolls through to submit', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await signIn(page);
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.locator('[data-buy-aura="question"]').click();
    const form = page.locator('#questionForm');
    await expect(form.getByText('Your name starts hidden. Classmates with God Mode can reveal it.')).toBeVisible();
    await expect(form.getByText('Square artwork works best.')).toBeAttached();
    await expect(form.locator('.question-submission-scroll #questionSubmitButton')).toBeAttached();
    await form.locator('#questionSubmitButton').scrollIntoViewIfNeeded();
    await expect(form.locator('#questionSubmitButton')).toBeInViewport();
    expect(await page.locator('#questionDialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test('polls honor explicit selection, show author attribution, and distinguish nominations', async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const original = DemoAPI.prototype.getPersonalFeed;
        DemoAPI.prototype.getPersonalFeed = function(...args) {
            Object.assign(this.personalFeed[0], { question_school_id: 1, question_is_user_submitted: true, question_is_anonymous: false, question_submitted_by_display_name: 'Maya Chen', presented_options: [{ name: 'Jules Rivera' }, { name: 'Jules Rivera', is_selected: true }] });
            this.personalFeed[1].is_nomination = true;
            return original.apply(this, args);
        };
    });
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.locator('[data-feed-detail="9001"]').click();
    await expect(page.locator('.poll-submitter-row')).toContainText('Maya Chen');
    await expect(page.locator('.feed-detail-option.selected')).toHaveCount(1);
    await expect(page.locator('.feed-detail-option').nth(1)).toHaveClass(/selected/);
    await page.locator('[data-close-feed-detail]').click();
    await page.locator('[data-feed-detail="9002"]').click();
    await expect(page.locator('.feed-nomination-card')).toContainText('got nominated');
    await expect(page.locator('.feed-detail-options')).toHaveCount(0);
});

test('anonymous author identity remains hidden until a confirmed reveal succeeds', async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1&godmode=1');
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const original = DemoAPI.prototype.getPersonalFeed;
        DemoAPI.prototype.getPersonalFeed = function(...args) {
            Object.assign(this.personalFeed[0], { question_school_id: 1, question_is_anonymous: true, question_submitted_by_display_name: 'Maya Chen', can_reveal_question_submitter: true });
            return original.apply(this, args);
        };
    });
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.locator('[data-feed-detail="9001"]').click();
    const author = page.locator('.poll-submitter-row');
    await expect(author).toContainText('Someone at your school');
    await expect(author).not.toContainText('Maya Chen');
    page.once('dialog', dialog => dialog.dismiss());
    await author.click();
    await expect(author).toContainText('Someone at your school');
    page.once('dialog', dialog => dialog.accept());
    await author.click();
    await expect(author).toContainText('Maya Chen');
});

test('Send actions pass server-generated poll and TBH URLs to the share sheet', async ({ page }) => {
    await signIn(page);
    await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: async payload => { window.sharedPayload = payload; } }));
    await page.locator('[data-feed-detail="9001"]').click();
    await page.getByRole('button', { name: 'Send poll', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.sharedPayload?.url)).toContain('/poll/demo-9001');
    await page.locator('[data-close-feed-detail]').click();
    await page.locator('[data-tbh-detail^="received:"]').first().click();
    await page.getByRole('button', { name: 'Send TBH', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.sharedPayload?.url)).toContain('/tbh/demo-');
});

test('TBH story sharing creates portrait artwork without leaking the anonymous author name', async ({ page }) => {
    await signIn(page);
    const content = await page.evaluate(async () => {
        const { tbhShareContent } = await import('/app/tbh-share.js');
        const item = { body: 'A kind message', subject_first_name: 'Jules', author_first_name: 'Secret', author_last_name: 'Name' };
        return ['received','sent','school'].map(kind => tbhShareContent(kind,item,'My best quality','from a classmate'));
    });
    expect(JSON.stringify(content)).not.toContain('Secret');
    expect(content[0].name).toBe('');
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
        Object.defineProperty(navigator, 'share', { configurable: true, value: async ({files}) => {
            const bytes = new DataView(await files[0].arrayBuffer());
            window.sharedImage = { type: files[0].type, width: bytes.getUint32(16), height: bytes.getUint32(20) };
        }});
    });
    await page.locator('[data-tbh-detail^="received:"]').first().click();
    await page.getByRole('button', { name: 'Share TBH to Snapchat', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.sharedImage)).toEqual({ type: 'image/png', width: 900, height: 1600 });
});

test('share and author reveal adapters use the native backend contracts', async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1');
    const calls = await page.evaluate(async () => {
        const { ValidAPI } = await import('/app/api.js');
        const calls = [], api = new ValidAPI();
        api.request = async (path, options) => { calls.push({path,...options}); return {}; };
        await api.createFeedShareLink('user', 'poll', 9);
        await api.createFeedShareLink('user', 'activity', 'activity');
        await api.revealQuestionSubmitter('user', 12);
        return calls;
    });
    expect(calls).toEqual([
        { path: '/users/user/feed/polls/9/share-link', method: 'POST' },
        { path: '/users/user/feed/activities/activity/share-link', method: 'POST', body: '{"channel":"native_share"}' },
        { path: '/users/user/question-submitter-reveals/12', method: 'POST' },
    ]);
});
