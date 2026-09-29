import { expect, test } from '@playwright/test';

async function signIn(page, suffix = '') {
    await page.goto(`/app/?demo=1&signin=1${suffix}`);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByRole('button', { name: 'Feed', exact: true })).toHaveAttribute('aria-current', 'page');
}

test('poll detail title carries the iOS gender emoji and heart', async ({ page }) => {
    await signIn(page);
    const statements = await page.evaluate(async () => {
        const { senderStatement } = await import('/app/feed-sender.js');
        return {
            girl: senderStatement({ voter_gender: 'female', voter_grade: 'Sophomore (C/O 2029)' }, { safeGrade: true }),
            boy: senderStatement({ voter_gender: 'male', voter_grade: '8th Grade' }, { safeGrade: true }),
            person: senderStatement({ voter_gender: 'non-binary', voter_grade: 'Grade 11' }, { safeGrade: true }),
            hidden: senderStatement({ voter_gender: 'female', voter_grade: 'Senior' }, { safeGrade: false }),
            unknown: senderStatement({ voter_grade: 'Senior' }, { safeGrade: true }),
        };
    });
    expect(statements).toEqual({
        girl: 'A Sophomore 👧💗 Girl said',
        boy: 'An 8th grader 👦💙 Boy said',
        person: 'A Junior 🧑💛 Person said',
        hidden: 'A 👧💗 Girl said',
        unknown: '',
    });
    await page.locator('[data-feed-detail="9001"]').click();
    await expect(page.locator('#feedDetailDialog .detail-screen-header > strong')).toHaveText(/^An? .*👧💗 Girl said$/);
});

for (const [width, height] of [[375, 812], [390, 844], [430, 932]]) {
    test(`poll detail fits the poll and engagement row in a ${width}x${height} screen`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await signIn(page);
        await page.locator('[data-feed-detail="9001"]').click();
        const detail = page.locator('#feedDetailDialog');
        await expect(detail).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const engagement = await detail.locator('.detail-engagement-row').boundingBox();
        expect(engagement.y + engagement.height).toBeLessThanOrEqual(height);
        const options = await detail.locator('.feed-detail-option').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
        expect(options).toHaveLength(4);
        // PollSnapshot.swift: 10pt between options and 10pt side margins, 100pt minimum height.
        expect(Math.round(options[1].x - (options[0].x + options[0].width))).toBe(10);
        expect(Math.round(options[2].y - (options[0].y + options[0].height))).toBe(10);
        expect(Math.round(options[0].x)).toBe(10);
        for (const option of options) expect(option.height).toBeGreaterThanOrEqual(100);
        const art = await detail.locator('.feed-detail-art').boundingBox();
        expect(art.width).toBeCloseTo(art.height, 0);
        expect(art.width).toBeLessThanOrEqual(width - 48 + 0.5);
        expect(await detail.locator('.feed-detail-prompt > h3').evaluate(node => getComputedStyle(node).fontSize)).toBe('28px');
        // The brand share row uses the iOS asset-catalog artwork, not redrawn marks.
        for (const [platform, file] of [['Snapchat', 'snapchat-logo.webp'], ['Instagram', 'instagram.webp'], ['TikTok', 'tiktok-icon-black-square.webp']]) {
            const button = detail.getByRole('button', { name: `Share poll to ${platform}` });
            await expect(button.locator('img')).toHaveAttribute('src', new RegExp(`${file.replace('.', '\\.')}$`));
            const box = await button.boundingBox();
            expect(box.height).toBeGreaterThanOrEqual(56);
        }
        expect(await detail.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    });
}

async function patchDemo(page, patch) {
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(patch);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByRole('button', { name: 'Feed', exact: true })).toHaveAttribute('aria-current', 'page');
}

test('play vote selects instantly, holds 1.2 s even with a fast API, and never double-answers', async ({ page }) => {
    await patchDemo(page, async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const original = DemoAPI.prototype.answerQuestion;
        window.__answers = [];
        DemoAPI.prototype.answerQuestion = function (...args) { window.__answers.push(args[1]); return original.apply(this, args); };
    });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByText('Who would survive longest on a deserted island?')).toBeVisible();
    const first = page.locator('#playCard .play-card:not(.play-card-leaving) [data-choice]').first();
    const started = await page.evaluate(() => performance.now());
    await first.click();
    await expect(first).toHaveClass(/selected/);
    await expect(page.locator('#playCard .play-card:not(.play-card-leaving) [data-choice]').nth(1)).toBeDisabled();
    await expect(page.getByRole('button', { name: /Skip \(3\)/ })).toBeDisabled();
    // The API resolves at once; a second tap during the hold is ignored.
    await page.locator('#playCard [data-choice]').nth(1).dispatchEvent('click');
    await expect(page.getByText('Who should plan the senior trip?')).toBeVisible();
    const elapsed = await page.evaluate((start) => performance.now() - start, started);
    expect(elapsed).toBeGreaterThanOrEqual(1100);
    expect(await page.evaluate(() => window.__answers.length)).toBe(1);
    await expect(page.locator('#auraCount')).toHaveText('1,285');
});

test('play keeps moving when a vote fails and takes back only its aura', async ({ page }) => {
    await patchDemo(page, async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        DemoAPI.prototype.answerQuestion = async function () {
            await new Promise((resolve) => setTimeout(resolve, 100));
            throw Object.assign(new Error('Network down'), { status: 503 });
        };
    });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.locator('#auraCount')).toHaveText('1,280');
    await page.locator('#playCard [data-choice]').first().click();
    await expect(page.locator('#toast')).toContainText("Your vote didn't go through");
    await expect(page.getByText('Who should plan the senior trip?')).toBeVisible();
    await expect(page.locator('#auraCount')).toHaveText('1,280');
    await expect(page.locator('#playCard .play-card:not(.play-card-leaving) [data-choice]').first()).toBeEnabled();
});

test('play skip waits 0.5 s, shakes the aura counter, and retries failed skips', async ({ page }) => {
    await patchDemo(page, async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        window.__skipAttempts = 0;
        DemoAPI.prototype.skipQuestion = async function () {
            window.__skipAttempts += 1;
            if (window.__skipAttempts === 1) throw Object.assign(new Error('offline'), { status: 0 });
            return { ok: true };
        };
    });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const started = await page.evaluate(() => performance.now());
    await page.getByRole('button', { name: 'Skip (3)' }).click();
    await expect(page.locator('.play-aura-chip')).toHaveClass(/aura-shake/);
    await expect(page.getByRole('button', { name: 'Skip (2)' })).toBeVisible();
    expect(await page.evaluate((start) => performance.now() - start, started)).toBeGreaterThanOrEqual(450);
    await expect(page.locator('#toast')).toContainText("Skipped. We'll save it when your connection is back.");
    await expect.poll(() => page.evaluate(() => window.__skipAttempts), { timeout: 5000 }).toBe(2);
});

test('play lock countdown uses hours and minutes like PlayLockedView', async ({ page }) => {
    await patchDemo(page, async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const original = DemoAPI.prototype.getConfig;
        DemoAPI.prototype.getConfig = async function (...args) { return { ...(await original.apply(this, args)), play_lock_time_seconds: 3930 }; };
    });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    for (let answered = 0; answered < 4; answered += 1) {
        await page.locator('#playCard .play-card:not(.play-card-leaving) [data-choice]').first().click();
    }
    await page.getByRole('button', { name: 'W aura' }).click();
    await expect(page.locator('#playLockMessage')).toHaveText(/^Unlocks in 1h 5m$/);
});
