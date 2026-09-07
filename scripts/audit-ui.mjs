import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createStaticOrigin } from './serve-production.mjs';
const server = await createStaticOrigin();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const output = new URL('../artifacts/ui-audit/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
    for (const colorScheme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme });
        const page = await context.newPage();
        await page.goto(`${origin}/app/?demo=1&signin=1`);
        await page.getByRole('button', { name: /^sign in$/i }).click();
        for (const panel of ['feed', 'play', 'profile', 'chats']) {
            await page.locator(`#bottomNav [data-panel="${panel}"]`).click();
            await page.locator(`#${panel}Panel`).waitFor({ state: 'visible' });
            if (panel === 'chats') await page.locator('.chat-list .chat-row').first().waitFor({ state: 'visible' });
            if (panel === 'profile') await page.locator('.profile-identity-line').waitFor({ state: 'visible' });
            await page.evaluate(() => document.fonts.ready);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await page.screenshot({ path: `${output}${colorScheme}-${panel}.png`, animations: 'disabled' });
            console.log(JSON.stringify({ colorScheme, panel, scrollY: await page.evaluate(() => scrollY), horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) }));
            if (panel === 'profile') {
                await page.locator('.device-preferences').scrollIntoViewIfNeeded();
                await page.screenshot({ path: `${output}${colorScheme}-preferences.png`, animations: 'disabled' });
                await page.evaluate(() => scrollTo(0, 0));
            }
        }
        await page.getByRole('button', { name: /Noah Williams/ }).click();
        await page.locator('[data-open-memento-gallery]').waitFor({ state: 'visible' });
        await page.screenshot({ path: `${output}${colorScheme}-posted-room.png`, animations: 'disabled' });
        await page.locator('[data-open-memento-gallery]').click();
        await page.getByRole('dialog', { name: 'Mementos', exact: true }).waitFor({ state: 'visible' });
        await page.screenshot({ path: `${output}${colorScheme}-mementos.png`, animations: 'disabled' });
        await page.locator('[data-close-memento-gallery]').click();
        await page.getByRole('button', { name: 'Send a sticker', exact: true }).click();
        await page.locator('[data-send-sticker]').first().waitFor({ state: 'visible' });
        await page.locator('[data-send-sticker] img').first().evaluate(img => img.decode());
        await page.screenshot({ path: `${output}${colorScheme}-stickers.png`, animations: 'disabled' });
        await page.getByRole('dialog', { name: 'Send a sticker', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
        await page.locator('[data-open-chat-media]').click();
        const camera = page.locator('[data-chat-camera]');
        await camera.locator('[data-camera-shutter]:enabled').waitFor();
        await page.screenshot({ path: `${output}${colorScheme}-chat-camera.png` });
        await camera.locator('[data-camera-shutter]').click();
        await page.locator('.chat-media-publish:enabled').waitFor();
        await page.screenshot({ path: `${output}${colorScheme}-chat-photo-review.png` });
        await page.locator('[data-close-chat-media]').click();
        await page.getByRole('button', { name: 'Back to chats' }).click();
        await page.getByRole('button', { name: /Weekend Crew/ }).click();
        await page.locator('.chat-daily-row > button').waitFor({ state: 'visible' });
        await page.screenshot({ path: `${output}${colorScheme}-room.png` });
        await page.locator('.chat-daily-row > button').click();
        await page.locator('[data-memento-camera] [data-camera-shutter]:enabled').waitFor();
        await page.screenshot({ path: `${output}${colorScheme}-camera.png` });
        await page.locator('[data-memento-camera] [data-camera-shutter]').click();
        await page.locator('.memento-publish:enabled').waitFor();
        await page.screenshot({ path: `${output}${colorScheme}-review.png` });
        await context.close();
    }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
console.log(`Screenshots: ${output}`);
