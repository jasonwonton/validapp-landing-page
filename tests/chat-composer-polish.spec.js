import { test, expect } from '@playwright/test';

async function room(page) {
    await page.goto('/app/?demo=1&signin=1');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await page.getByRole('button', { name: /Noah Williams/ }).click();
}

test('retention icons remain centered with their label in both themes and states', async ({ page }) => {
    await room(page);
    await page.getByRole('button', { name: 'Send photo or video' }).click();
    const dialog = page.locator('[data-chat-media-dialog]');
    await dialog.locator('.chat-media-file-input').setInputFiles('assets/AppIconV2.png');
    await expect(dialog.locator('.chat-media-publish')).toBeEnabled();
    for (const theme of ['light', 'dark']) {
        await page.locator('html').evaluate((el, theme) => { el.dataset.theme = theme; }, theme);
        for (const checked of [false, true]) {
            await dialog.getByLabel('View once', { exact: true }).setChecked(checked);
            const option = dialog.locator('.chat-media-option');
            await expect(option.locator('span')).toHaveText(checked ? 'View once' : 'Keep in chat');
            const icon = await option.locator(`[data-ui-icon="${checked ? 'view-once' : 'infinity'}"]`).boundingBox();
            const label = await option.locator('span').boundingBox();
            expect(Math.abs(icon.y + icon.height / 2 - label.y - label.height / 2)).toBeLessThan(1);
            expect(icon.width).toBe(24); expect(icon.height).toBe(24);
            await page.screenshot({ path: test.info().outputPath(`retention-${theme}-${checked}.png`) });
        }
    }
    await expect(dialog.getByRole('group', { name: 'Photo effect' })).toHaveCount(0);
    await expect(dialog.locator('[data-photo-cutout] [data-ui-icon="scissors"]')).toBeVisible();
});

test('keyboard resize and Safari viewport pan keep composer against the keyboard and header visible', async ({ page }) => {
    await page.addInitScript(() => {
        const realViewport = window.visualViewport;
        window.testViewport = Object.assign(new EventTarget(), { offsetTop: 0, offsetLeft: 0, scale: 1 });
        let testHeight;
        Object.defineProperties(testViewport, { width: { get: () => realViewport.width }, height: { get: () => testHeight ?? realViewport.height, set: value => { testHeight = value; } } });
        Object.defineProperty(window, 'visualViewport', { get: () => testViewport });
    });
    await room(page);
    await expect(page.getByRole('button', { name: 'Record voice message', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeHidden();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keyboard test');
    for (const offset of [0, 85]) {
        await page.evaluate(offset => { testViewport.height = 400; testViewport.offsetTop = offset; testViewport.dispatchEvent(new Event('resize')); }, offset);
        await expect(page.locator('html')).toHaveClass(/keyboard-open/);
        await expect.poll(async () => {
            const rect = await page.locator('.chat-composer').boundingBox();
            return Math.abs(offset + 400 - rect.y - rect.height - 6);
        }).toBeLessThan(2);
        const header = await page.locator('.chat-room-screen > header').boundingBox();
        expect(header.y).toBeGreaterThanOrEqual(offset);
        await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
    }
    await page.screenshot({ path: test.info().outputPath('keyboard-composer.png') });
});

test('photo review has native control hierarchy and saved stickers are sent in one photo, not a separate sticker message', async ({ page }) => {
    await room(page);
    const initialViews = await page.locator('.chat-message.mine .chat-view-once-card').count();
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        DemoAPI.prototype.getStickers = async () => ({ stickers: [{ id: 'fixture-sticker', image_url: '/assets/AppIconV2.png' }] });
        window.photoSends = [];
        const original = DemoAPI.prototype.sendChatMessage;
        DemoAPI.prototype.sendChatMessage = function(userId, chatId, payload) { photoSends.push(payload); return original.call(this, userId, chatId, payload); };
    });
    await page.getByRole('button', { name: 'Send photo or video' }).click();
    const dialog = page.locator('[data-chat-media-dialog]');
    await dialog.locator('.chat-media-file-input').setInputFiles('assets/AppIconV2.png');
    await expect(dialog.locator('.chat-media-publish')).toBeEnabled();
    await expect(dialog).not.toContainText('Record voice message');
    await expect(dialog.locator('.chat-media-status')).toBeEmpty();
    await expect(dialog.getByRole('button', { name: 'Make a sticker from this photo' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Open My Stickers' }).click();
    await page.locator('[data-send-sticker="fixture-sticker"]').click();
    const sticker = dialog.locator('.chat-photo-sticker');
    await expect(sticker).toBeVisible();
    const before = await sticker.boundingBox();
    await sticker.press('ArrowRight'); await sticker.press('+');
    const after = await sticker.boundingBox(); expect(after.width).toBeGreaterThan(before.width);
    await dialog.getByRole('button', { name: 'Remove selected sticker' }).click();
    await expect(sticker).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Open My Stickers' }).click();
    await page.locator('[data-send-sticker="fixture-sticker"]').click();
    await expect(sticker).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('photo-review.png') });
    await dialog.getByLabel('View once', { exact: true }).check();
    await expect(dialog.locator('.chat-media-option span')).toHaveText('View once');
    await dialog.locator('.chat-media-publish').click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.chat-photo-sticker')).toHaveCount(0);
    await expect(page.locator('.chat-message.mine .chat-view-once-card')).toHaveCount(initialViews + 1);
    const sends = await page.evaluate(() => photoSends);
    expect(sends).toHaveLength(1);
    expect(sends[0].sticker_id).toBeUndefined();
});

test('photo stickers bake into JPEG pixels, enforce a bounded count and release previews on reset', async ({ page }) => {
    await page.goto('/app/?demo=1');
    const redPNG = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 100; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, 100, 100); return canvas.toDataURL().split(',')[1]; });
    await page.route('**/photo-sticker-fixture.png', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(redPNG, 'base64') }));
    const result = await page.evaluate(async () => {
        const { createPhotoStickers } = await import('/app/chat/photo-stickers.js');
        const { setRuntimeStyles } = await import('/app/runtime-style.js');
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 100;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 100, 100);
        const source = new File([await new Promise(r => canvas.toBlob(r))], 'source.png', { type: 'image/png' });
        const preview = document.createElement('div'), img = document.createElement('img');
        setRuntimeStyles(preview, { position: 'relative', width: '300px', height: '300px' }); document.body.append(preview);
        img.src = URL.createObjectURL(source); preview.append(img); await img.decode();
        const red = '/photo-sticker-fixture.png';
        const stickers = createPhotoStickers(preview, { onChange() {}, disabled: () => false });
        await stickers.add(red);
        const node = preview.querySelector('.chat-photo-sticker'); node.setPointerCapture = () => {};
        const before = node.getBoundingClientRect().width;
        for (const [type, pointerId, clientX] of [['pointerdown', 1, 80], ['pointerdown', 2, 120], ['pointermove', 2, 160]]) {
            node.dispatchEvent(new PointerEvent(type, { pointerId, clientX, clientY: 100, pointerType: 'touch', bubbles: true }));
        }
        const pinched = node.getBoundingClientRect().width > before;
        const baked = await stickers.bake(source); const bitmap = await createImageBitmap(baked);
        ctx.drawImage(bitmap, 0, 0); bitmap.close(); const center = [...ctx.getImageData(50, 50, 1, 1).data];
        const beforeRotation = [...ctx.getImageData(25, 25, 1, 1).data];
        for (let i = 0; i < 5; i++) node.dispatchEvent(new KeyboardEvent('keydown', {key:']'}));
        const rotated = await createImageBitmap(await stickers.bake(source)); ctx.drawImage(rotated, 0, 0); rotated.close();
        const afterRotation = [...ctx.getImageData(25, 25, 1, 1).data];
        for (let i = 1; i < 8; i++) await stickers.add(red);
        let rejected = false; try { await stickers.add(red); } catch { rejected = true; }
        const count = preview.querySelectorAll('.chat-photo-sticker').length;
        stickers.reset(); const remaining = preview.querySelectorAll('button').length;
        URL.revokeObjectURL(img.src); preview.remove();
        return { center, beforeRotation, afterRotation, pinched, rejected, count, remaining, type: baked.type };
    });
    expect(result).toMatchObject({ pinched: true, rejected: true, count: 8, remaining: 0, type: 'image/jpeg' });
    expect(result.center[0]).toBeGreaterThan(240); expect(result.center[1]).toBeLessThan(15);
    expect(result.beforeRotation[1]).toBeLessThan(15); expect(result.afterRotation[1]).toBeGreaterThan(240);
});

test('discarding an inline voice request before microphone permission arrives releases the late stream', async ({ page }) => {
    await page.addInitScript(() => {
        window.voiceStops = 0;
        Object.defineProperty(window, 'MediaRecorder', { value: class { static isTypeSupported() { return true; } } });
        Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: () => new Promise(resolve => { window.resolveVoice = () => resolve({ getTracks: () => [{ stop() { voiceStops++; } }] }); }) } });
    });
    await room(page);
    await page.getByRole('button', { name: 'Record voice message', exact: true }).click();
    await expect(page.locator('[data-chat-media-dialog]')).toBeHidden();
    await page.getByRole('button', { name: 'Discard voice message' }).click();
    await page.evaluate(() => resolveVoice());
    await expect.poll(() => page.evaluate(() => voiceStops)).toBe(1);
    await expect(page.locator('.chat-voice-inline')).toBeHidden();
});
