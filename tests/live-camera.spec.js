import { test, expect } from '@playwright/test';
test.use({ launchOptions: async ({ browserName }, use) => use(browserName === 'chromium' ? { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } : {}) });

async function openMemento(page, { cameraUnavailable = false } = {}) {
    if (cameraUnavailable) await page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
    });
    await page.bringToFront();
    await page.goto('/app/?demo=1&signin=1');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await page.getByRole('button', { name: /Weekend Crew/ }).click();
    await page.locator('.chat-daily-row > button').click();
}

test.describe('live Memento capture', () => {
    test.beforeEach(async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'Real synthetic camera device is Chromium-only; denial/lifecycle tests run across engines.');
        await page.addInitScript(() => {
            window.cameraStreams = [];
            const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
            navigator.mediaDevices.getUserMedia = async constraints => {
                const stream = await original(constraints); window.cameraStreams.push(stream); return stream;
            };
        });
    });
    test('one shutter captures both views, reviews, retakes and actually sends once', async ({ page }) => {
        let fileChoosers = 0; page.on('filechooser', () => fileChoosers++);
        await openMemento(page);
        const shutter = page.getByRole('button', { name: 'Take photo', exact: true });
        await expect(shutter).toBeEnabled();
        const preview = await page.locator('.live-camera-stage').boundingBox();
        expect(preview.width / preview.height).toBeCloseTo(3 / 4, 2);
        await expect(page.locator('.memento-file-input')).toBeHidden();
        await expect(page.getByRole('button', { name: 'Choose a photo instead' })).toBeHidden();
        await shutter.click();
        await expect(page.locator('.memento-publish')).toBeEnabled();
        await expect(page.locator('.memento-preview img')).toBeVisible();
        await expect(page.locator('[data-swap-memento-capture]')).toBeVisible();
        await expect(page.locator('.memento-options, .memento-caption, [data-memento-effects]')).toHaveCount(0);
        await expect(page.locator('.memento-photo-fallback')).toBeHidden();
        await page.locator('[data-swap-memento-capture]').click();
        await expect(page.locator('.memento-status')).toContainText('Front view is primary');
        await expect.poll(() => page.evaluate(() => cameraStreams.flatMap(s => s.getTracks()).every(t => t.readyState === 'ended'))).toBe(true);
        expect(fileChoosers).toBe(0);
        await page.locator('[data-retake-memento]').click();
        await expect(page.locator('.memento-publish')).toBeDisabled();
        await expect(shutter).toBeEnabled();
        await shutter.click();
        await expect(page.locator('.memento-publish')).toBeEnabled();
        await page.locator('.memento-publish').click();
        await expect(page.locator('[data-memento-dialog]')).not.toBeVisible();
        await expect(page.locator('.chat-message.mine .memento-label')).toHaveCount(1);
        await expect(page.locator('.chat-composer')).toBeVisible();
        await expect.poll(() => page.evaluate(() => cameraStreams.flatMap(s => s.getTracks()).every(t => t.readyState === 'ended'))).toBe(true);
    });
    test('one-photo fallback and background pause do not retain camera tracks', async ({ page }) => {
        await openMemento(page);
        await expect(page.locator('[data-camera-shutter]')).toBeEnabled();
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await expect(page.locator('.live-camera-message')).toContainText('paused');
        expect(await page.evaluate(() => cameraStreams[0].getTracks()[0].readyState)).toBe('ended');
        await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }));
        await page.getByRole('button', { name: 'Try camera again' }).click();
        await expect(page.locator('[data-camera-shutter]')).toBeEnabled();
        await page.evaluate(() => navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Second camera unavailable', 'NotReadableError'); });
        await page.locator('[data-camera-shutter]').click();
        await page.getByRole('button', { name: 'Use one photo' }).click();
        await expect(page.locator('.memento-publish')).toBeEnabled();
        await expect(page.locator('[data-swap-memento-capture]')).toHaveCount(0);
        expect(await page.evaluate(() => cameraStreams.flatMap(s => s.getTracks()).every(t => t.readyState === 'ended'))).toBe(true);
    });
});

test('send gives immediate feedback, prevents repeat submits and shows errors beside the button', async ({ page }) => {
    await openMemento(page, { cameraUnavailable: true });
    await page.getByRole('button', { name: 'Choose a photo instead' }).click();
    await page.locator('.memento-file-input').setInputFiles('assets/AppIconV2.png');
    await expect(page.locator('.memento-publish')).toBeEnabled();
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        window.uploadAttempts = 0;
        DemoAPI.prototype.createDailyHighlightUpload = async () => {
            uploadAttempts++;
            return new Promise((_, reject) => window.rejectMemento = () => reject(Object.assign(new Error('Upload not allowed. Please try again.'), { status: 403 })));
        };
    });
    await page.locator('.memento-publish').click();
    await expect(page.locator('.memento-publish')).toHaveText('Sharing…');
    await expect(page.locator('.memento-status')).toHaveText('Sending your Memento…');
    await expect(page.locator('[data-retake-memento]')).toBeDisabled();
    await page.evaluate(() => document.querySelector('.memento-form').requestSubmit());
    expect(await page.evaluate(() => uploadAttempts)).toBe(1);
    await page.evaluate(() => rejectMemento());
    await expect(page.locator('.memento-status')).toHaveText('Upload not allowed. Please try again.');
    await expect(page.locator('.memento-publish')).toBeEnabled();
    const bounds = await page.locator('.memento-status').boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
    await expect(page.locator('.memento-photo-fallback')).toBeHidden();
    await expect(page.locator('.memento-options, .memento-caption, [data-memento-effects]')).toHaveCount(0);
});

test('permission denial offers a deliberate photo fallback, not a silent picker', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
            getUserMedia: async () => { throw new DOMException('Denied', 'NotAllowedError'); },
        } });
    });
    await openMemento(page);
    await expect(page.locator('.live-camera-message')).toContainText('Camera access is off');
    await expect(page.locator('.memento-file-input')).toBeHidden();
    await page.getByRole('button', { name: 'Choose a photo instead' }).click();
    await expect(page.locator('.memento-file-input')).toBeVisible();
    await expect(page.locator('[data-memento-camera]')).toBeHidden();
});

test('late permission resolution after closing stops the stream and cannot reopen capture', async ({ page }) => {
    await page.addInitScript(() => {
        window.cameraRequests = 0; window.stoppedLateTracks = 0;
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => {
            cameraRequests++;
            return new Promise(resolve => window.resolveCamera = () => resolve({ getTracks: () => [{ stop: () => stoppedLateTracks++ }] }));
        } } });
    });
    await openMemento(page);
    await expect.poll(() => page.evaluate(() => cameraRequests)).toBe(1);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => resolveCamera());
    await expect.poll(() => page.evaluate(() => stoppedLateTracks)).toBe(1);
    expect(await page.evaluate(() => cameraRequests)).toBe(1);
    await expect(page.locator('[data-memento-dialog]')).not.toBeVisible();
});

test('chat chrome uses vector symbols and native-sized heading, not emoji controls', async ({ page }) => {
    await openMemento(page);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Back to chats' }).click();
    await expect(page.locator('.chat-page-header h1')).toHaveCSS('font-size', '28px');
    await expect(page.locator('[data-new-chat] .ui-icon').first()).toBeVisible();
    expect(await page.locator('.chat-shell').innerText()).not.toMatch(/[📸📷💬🔒⌛☎]/u);
});

test('dark navigation stays legible and review keeps Share reachable without overlapping the photo', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openMemento(page, { cameraUnavailable: true });
    await page.getByRole('button', { name: 'Choose a photo instead' }).click();
    await page.locator('.memento-file-input').setInputFiles('assets/AppIconV2.png');
    const share = page.locator('.memento-publish');
    await expect(share).toBeEnabled();
    await expect(share).toHaveCSS('color', 'rgb(0, 0, 0)');
    const boxes = await page.evaluate(() => {
        const photo = document.querySelector('.memento-preview').getBoundingClientRect();
        const retake = document.querySelector('.memento-retake').getBoundingClientRect();
        const share = document.querySelector('.memento-publish').getBoundingClientRect();
        return { photoBottom: photo.bottom, retakeTop: retake.top, shareTop: share.top, shareBottom: share.bottom, height: innerHeight,
            nav: getComputedStyle(document.querySelector('#bottomNav [data-panel="feed"]')).color };
    });
    expect(boxes.retakeTop).toBeGreaterThanOrEqual(boxes.photoBottom);
    expect(boxes.shareTop).toBeGreaterThan(0);
    expect(boxes.shareBottom).toBeLessThanOrEqual(boxes.height);
    expect(boxes.nav).not.toMatch(/^rgba?\(0, 0, 0/);
});
