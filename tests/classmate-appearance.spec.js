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
    test(`${theme} classmates at ${width}px keep readable labels and compact shared rows`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 852 });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await page.goto('/app/?demo=1&signin=1');
        await page.evaluate(async () => {
            const { DemoAPI } = await import('/app/demo-api.js');
            const original = DemoAPI.prototype.getClassmates;
            DemoAPI.prototype.getClassmates = async function(...args) {
                return (await original.apply(this, args)).map(person => ({ ...person, grade: 'Senior (C/O 2027)' }));
            };
            const originalMetadata = DemoAPI.prototype.getClassmatesWithMetadata;
            DemoAPI.prototype.getClassmatesWithMetadata = async function(...args) {
                const result = await originalMetadata.apply(this, args);
                return { ...result, classmates: result.classmates.map(person => ({ ...person, grade: 'Senior (C/O 2027)' })) };
            };
        });
        await page.getByRole('button', { name: /^sign in$/i }).click();
        await page.getByRole('button', { name: 'Profile', exact: true }).click();
        await page.getByRole('button', { name: 'Classmates', exact: true }).click();
        const directory = page.getByRole('dialog', { name: 'Classmates', exact: true });
        await expect(directory.locator('.classmate-picker-row')).toHaveCount(6);
        await expect(directory.locator('.classmate-picker-copy small').first()).toHaveText('Senior (C/O 2027)');
        await page.evaluate(() => document.fonts.ready);
        for (const selector of ['h2', '.sheet-heading-control', '.classmate-picker-copy strong', '.classmate-picker-copy small', '.classmate-row-meta strong', '.classmate-row-meta small']) {
            expect(await contrast(directory.locator(selector).first()), selector).toBeGreaterThanOrEqual(4.5);
        }
        const first = directory.locator('.classmate-picker-row').first();
        await expect(first).toHaveCSS('border-top-width', '1px');
        await expect(first).toHaveCSS('border-radius', '14px');
        for (const row of await directory.locator('.classmate-picker-row').all()) {
            expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        }
        expect(await directory.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        const close = directory.getByRole('button', { name: 'Close', exact: true });
        await expect(close).toHaveCSS('min-height', '44px');
        // Firefox reports this 44px box as 43.999992px after sheet positioning.
        expect((await close.boundingBox()).height + 0.0001).toBeGreaterThanOrEqual(44);
        await page.screenshot({ path: `artifacts/classmates/${theme}-${width}-${testInfo.project.name}.png`, animations: 'disabled' });
        await directory.getByPlaceholder('Search classmates...').fill('Maya');
        await expect(directory.locator('.classmate-picker-row')).toHaveCount(1);
        await directory.locator('.classmate-picker-row').click();
        const profile = page.getByRole('dialog', { name: 'Profile', exact: true });
        await expect(profile).toBeVisible();
        await profile.getByRole('button', { name: 'Back to classmates' }).click();
        await expect(directory).toBeVisible();
    });
}
