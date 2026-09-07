import { test, expect } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('interface source has no decorative emoji; product reactions remain intact', async () => {
    const root = new URL('../app/', import.meta.url);
    const paths = await readdir(root, { recursive: true });
    for (const path of paths.filter(p => /\.(js|html)$/.test(p) && p !== 'demo-api.js')) {
        const source = await readFile(new URL(path, root), 'utf8');
        // Allow only the existing reaction enum definitions, never arbitrary UI text.
        const withoutReactions = source
            .replace(/\{ type: "(?:thumbs_down|surprised|fire|eyes|funny|love|legacy_agree)", emoji: "[^"]+", label: "[^"]+" \}/g, '')
            .replace(/\["(?:thumbs_down|surprised|fire|eyes|funny|love)", "[^"]+"\]/g, '');
        expect(withoutReactions, path).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(withoutReactions, path).not.toMatch(/[☺♥♡✎✦▶⧉↩＋]/u);
    }
    const { CHAT_REACTIONS } = await import('../app/chat/models.js');
    expect(CHAT_REACTIONS).toEqual([
        ['love', '❤️'], ['funny', '😂'], ['eyes', '👀'],
        ['fire', '🔥'], ['surprised', '😮'], ['thumbs_down', '👎'],
    ]);
});

test('imported iOS artwork has pinned provenance and stays outside the offline shell', async () => {
    const manifest = JSON.parse(await readFile(new URL('../assets/app/ios-interface-provenance.json', import.meta.url), 'utf8'));
    const worker = await readFile(new URL('../app/service-worker.js', import.meta.url), 'utf8');
    expect(manifest).toHaveLength(3);
    for (const entry of manifest) {
        const bytes = await readFile(new URL(`../${entry.web}`, import.meta.url));
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.webSHA256);
        expect(bytes.length).toBe(entry.bytes);
        expect(entry.sourceSHA256).toMatch(/^[a-f0-9]{64}$/);
        expect(worker).not.toContain(entry.web);
    }
});

for (const theme of ['light', 'dark']) {
    test(`${theme} interface uses accessible vectors without stripping user emoji`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await page.goto('/app/?demo=1&signin=1');
        await page.getByRole('button', { name: /^sign in$/i }).click();
        await page.getByRole('button', { name: 'Profile', exact: true }).click();
        await expect(page.locator('.profile-streak')).toHaveText('7');
        await expect(page.locator('.profile-streak')).toHaveAttribute('aria-label', '7 day streak');
        await expect(page.locator('.profile-streak [data-ui-icon="fire"]')).toBeVisible();
        await expect(page.locator('.photo-edit-badge [data-ui-icon="edit"]')).toBeVisible();
        await expect(page.locator('.profile-bio-button')).toContainText('✨');
        await expect(page.locator('.heart [data-ui-icon="heart"]')).toBeVisible();
        await page.getByRole('button', { name: 'Play', exact: true }).click();
        await expect(page.locator('.play-streak-chip [data-ui-icon="fire"]')).toBeVisible();
        await page.getByRole('button', { name: 'Chats', exact: true }).click();
        await page.getByRole('button', { name: /Noah Williams/ }).click();
        await page.getByRole('button', { name: 'Send media or a sticker' }).click();
        const sticker = page.locator('.native-sticker-icon');
        await expect(sticker).toBeVisible();
        expect(await sticker.evaluate(el => getComputedStyle(el).maskImage)).toContain('sticker-icon.webp');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
}
