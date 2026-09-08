import { expect, test } from '@playwright/test';

async function contrast(locator) {
    return locator.evaluate(node => {
        const rgba = value => value.match(/[\d.]+/g).map(Number);
        const over = (front, back) => front.slice(0, 3).map((v, i) => v * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
        const ancestors = []; for (let el = node; el; el = el.parentElement) ancestors.unshift(el);
        let bg = [255, 255, 255];
        for (const el of ancestors) bg = over(rgba(getComputedStyle(el).backgroundColor), bg);
        const fg = over(rgba(getComputedStyle(node).color), bg);
        const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        const a = luminance(fg), b = luminance(bg);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
}

for (const theme of ['light', 'dark']) for (const width of [320, 393, 440]) {
    test(`${theme} poll detail at ${width}px has paired colors and non-overlapping content`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: width === 440 ? 956 : 852 });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await page.goto('/app/?demo=1&signin=1');
        await page.evaluate(async () => {
            const { DemoAPI } = await import('/app/demo-api.js');
            const original = DemoAPI.prototype.getPersonalFeed;
            DemoAPI.prototype.getPersonalFeed = function(...args) {
                Object.assign(this.personalFeed.find(item => item.question_answer_id === 9001), {
                    question_text: 'Who do you wanna get to know more?',
                    presented_options: ['Gary Wang', 'Jason Wong', 'Evan Thompson', 'Lauren Go'].map(name => ({ name })),
                    selected_contact_name: 'Jason Wong', voter_first_letter_hint: 'D', voter_gender: 'non-binary',
                });
                return original.apply(this, args);
            };
        });
        await page.getByRole('button', { name: /^sign in$/i }).click();
        await page.locator('[data-feed-detail="9001"]').click();
        const detail = page.locator('#feedDetailDialog');
        await expect(detail).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await detail.locator('.feed-detail-art img').evaluate(img => img.decode());
        for (const selector of ['.detail-screen-header > strong', '.detail-back-button', '.feed-detail-card > h3', '.feed-detail-option strong', '.share-platform-button.snapchat span', '#revealFeedSenderButton', '.feed-detail-first-letter-hint']) {
            expect(await contrast(detail.locator(selector).first()), selector).toBeGreaterThanOrEqual(4.5);
        }
        await expect(detail.locator('.feed-detail-option.selected')).toContainText('Jason Wong');
        await expect(detail.locator('.feed-detail-option.selected')).toHaveCSS('box-shadow', 'none');
        const badge = await detail.locator('.feed-detail-selection-indicator').boundingBox();
        const secondRow = await detail.locator('.feed-detail-option').nth(2).boundingBox();
        expect(badge.y + badge.height + 4).toBeLessThanOrEqual(secondRow.y);
        const art = await detail.locator('.feed-detail-art').boundingBox();
        expect(art.height).toBeLessThanOrEqual(281);
        expect(art.width).toBeCloseTo(art.height, 0);
        expect(await detail.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        for (const name of ['Close', 'More poll actions', 'Share poll to Snapchat', 'Share poll to Instagram', 'Share poll to TikTok']) {
            const button = detail.getByRole('button', { name, exact: true });
            const bounds = await button.boundingBox();
            expect(bounds.height, name).toBeGreaterThanOrEqual(44);
        }
        await page.screenshot({ path: `artifacts/poll-detail/${theme}-${width}-${testInfo.project.name}.png`, animations: 'disabled' });
        await detail.getByRole('button', { name: 'More poll actions' }).click();
        await expect(detail.getByRole('menuitem', { name: 'Report question' })).toBeVisible();
    });
}
