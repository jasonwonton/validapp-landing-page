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
