import { test, expect } from '@playwright/test';

async function profile(page) {
    await page.goto('/app/?demo=1&signin=1');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
}

async function contrast(page, selector) {
    return page.locator(selector).first().evaluate(node => {
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

test('manual appearance overrides the system, survives reload and returns to System', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await profile(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('combobox', { name: /^Appearance/ }).selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', '#ccf7f4');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.locator('#appearanceSelect').selectOption('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('#appearanceSelect').selectOption('system');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('dark text and surface pairs remain readable across Profile, Feed and Play', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await profile(page);
    await page.locator('#appearanceSelect').selectOption('dark');
    for (const selector of ['.full-profile-card h3', '.profile-identity-line', '.profile-bio-button', '.profile-school-meta', '.profile-stat-card strong', '.profile-stat-card > span', '.ask-link-heading > div > span', '.appearance-control small', '.profile-share-button.snapchat', '.profile-share-button.messages']) {
        expect(await contrast(page, selector), selector).toBeGreaterThanOrEqual(4.5);
    }
    await page.getByRole('button', { name: 'Feed', exact: true }).click();
    for (const selector of ['.segment:not(.active)', '.segment.active', '.personal-inbox-filter-rail button:not(.active)']) expect(await contrast(page, selector), selector).toBeGreaterThanOrEqual(4.5);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    for (const selector of ['.play-streak-chip', '.play-aura-chip', '.choice-button']) expect(await contrast(page, selector), selector).toBeGreaterThanOrEqual(4.5);
});

test('Android haptics have bounded tap feedback, a test control and a persistent opt-out', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Android test browser' });
        window.pulses = [];
        Object.defineProperty(navigator, 'vibrate', { configurable: true, value: pattern => { pulses.push(pattern); return true; } });
    });
    await profile(page);
    const toggle = page.getByRole('switch', { name: /Haptic feedback/ });
    await expect(toggle).toBeChecked();
    await expect.poll(() => page.evaluate(() => pulses.length)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Test vibration' }).click();
    await expect(page.locator('#hapticsStatus')).toContainText('Vibration requested');
    expect(await page.evaluate(() => pulses.filter(Array.isArray).every(p => p.length <= 3 && p.every(n => n <= 40)))).toBe(true);
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await page.evaluate(() => pulses.length = 0);
    await page.getByRole('button', { name: 'Feed', exact: true }).click();
    expect(await page.evaluate(() => pulses)).toEqual([]);
    await page.reload();
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(toggle).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Test vibration' })).toBeDisabled();
});

test('missing vibration and denied preference storage never block the app', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined });
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
            if (key === 'valid:appearance' || key === 'valid:haptics') throw new DOMException('Denied', 'SecurityError');
            return original.call(this, key, value);
        };
    });
    await profile(page);
    await expect(page.locator('#hapticsPreferences')).toBeHidden();
    await expect(page.getByRole('switch', { name: /Haptic feedback/ })).toHaveCount(0);
    await expect(page.locator('#hapticsHint')).toContainText('unavailable');
    await page.locator('#appearanceSelect').selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await expect(page.locator('.chat-page-header')).toBeVisible();
});
