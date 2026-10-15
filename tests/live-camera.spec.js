import { test, expect } from '@playwright/test';

// A canvas camera that reports the facing it was asked for, in every engine.
async function syntheticCamera(page, { frontFails = false } = {}) {
    await page.addInitScript(({ frontFails }) => {
        window.cameraStreams = [];
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
            async getUserMedia(constraints) {
                const facing = constraints?.video?.facingMode?.ideal || 'environment';
                if (facing === 'user' && (frontFails || window.frontFails)) throw new DOMException('Second camera unavailable', 'NotReadableError');
                const canvas = document.createElement('canvas');
                canvas.width = 640; canvas.height = 480;
                const context = canvas.getContext('2d');
                const paint = () => { context.fillStyle = facing === 'user' ? '#ff6666' : '#6666ff'; context.fillRect(0, 0, 640, 480); };
                paint();
                const timer = setInterval(paint, 40);
                const stream = canvas.captureStream(25);
                const track = stream.getVideoTracks()[0];
                track.getSettings = () => ({ facingMode: facing, width: 640, height: 480 });
                track.getCapabilities = () => ({});
                const stop = track.stop.bind(track);
                track.stop = () => { clearInterval(timer); stop(); };
                window.cameraStreams.push(stream);
                return stream;
            },
            async enumerateDevices() { return []; },
            addEventListener() {}, removeEventListener() {},
        } });
    }, { frontFails });
}

async function openMemento(page, { cameraUnavailable = false } = {}) {
    if (cameraUnavailable) await page.addInitScript(() => {
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
            getUserMedia: async () => { throw new DOMException('Denied', 'NotAllowedError'); },
        } });
    });
    await page.bringToFront();
    await page.goto('/app/?demo=1&signin=1');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await page.getByRole('button', { name: /Weekend Crew/ }).click();
    await page.getByRole('button', { name: 'Take a Memento' }).click();
}

async function captureBothViews(page) {
    const dialog = page.locator('[data-memento-dialog]');
    await dialog.getByRole('button', { name: 'Take the back photo', exact: true }).click();
    await dialog.getByRole('button', { name: 'Take the front photo', exact: true }).click();
    await expect(page.locator('.memento-publish')).toBeEnabled();
}

const tracksEnded = page => page.evaluate(() => cameraStreams.flatMap(s => s.getTracks()).every(t => t.readyState === 'ended'));

test.describe('live Memento capture', () => {
    test('back camera first, then you: two taps, review, retake and one send', async ({ page }) => {
        let fileChoosers = 0; page.on('filechooser', () => fileChoosers++);
        await syntheticCamera(page);
        await openMemento(page);
        const dialog = page.locator('[data-memento-dialog]');
        const back = dialog.getByRole('button', { name: 'Take the back photo', exact: true });
        await expect(back).toBeEnabled();
        // MementoSequentialCameraView: step chip, copy and an empty "You're next" slot.
        await expect(dialog.locator('.live-camera-step')).toHaveText('1 of 2 · Back camera');
        await expect(dialog.locator('.live-camera-hint')).toHaveText('Back camera first, then you');
        await expect(dialog.getByLabel('Your photo goes here next')).toBeVisible();
        // No lenses, no flip, no library on the Memento camera.
        await expect(dialog.getByRole('button', { name: 'Switch front and rear camera' })).toBeHidden();
        await expect(dialog.getByRole('button', { name: 'Choose a photo instead' })).toBeHidden();
        await expect(dialog.locator('.lens-carousel')).toHaveCount(0);
        const preview = await dialog.locator('.live-camera-stage').boundingBox();
        expect(preview).toEqual(await dialog.boundingBox());
        await back.click();
        // The second photo is its own tap.
        await expect(dialog.locator('.live-camera-step')).toHaveText('2 of 2 · Now you');
        await expect(dialog.locator('.live-camera-hint')).toHaveText('Now you, in the top corner');
        await expect(dialog.getByRole('button', { name: 'Retake the back photo' })).toBeVisible();
        await expect(page.locator('.memento-publish')).toBeDisabled();
        await dialog.getByRole('button', { name: 'Take the front photo', exact: true }).click();
        // The full-screen "Today's Memento" review: Retake, Save, Send.
        await expect(dialog.getByRole('heading', { name: "Today's Memento" }).or(dialog.getByText("Today's Memento", { exact: true }))).toBeVisible();
        await expect(dialog.getByText('Tap the small photo to swap')).toBeVisible();
        await expect(page.locator('.memento-publish')).toHaveText(/Send to Weekend Crew/);
        await expect(dialog.getByRole('button', { name: 'Retake' })).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Save' })).toBeVisible();
        expect(await page.locator('.memento-preview img').evaluate(img => img.naturalWidth / img.naturalHeight)).toBeCloseTo(3 / 4, 2);
        await page.locator('[data-swap-memento-capture]').click();
        await expect(page.locator('.memento-status')).toBeEmpty();
        await expect.poll(() => tracksEnded(page)).toBe(true);
        expect(fileChoosers).toBe(0);
        await page.locator('[data-retake-memento]').click();
        await expect(page.locator('.memento-publish')).toBeDisabled();
        await captureBothViews(page);
        await page.locator('.memento-publish').click();
        // Queued: the review closes at once and the chat shows the Memento.
        await expect(dialog).not.toBeVisible();
        await expect(page.locator('.chat-message.mine .memento-label')).toHaveCount(1);
        await expect(page.getByRole('button', { name: 'Take a Memento' })).toBeHidden();
        await expect(page.locator('.chat-composer')).toBeVisible();
        await expect.poll(() => tracksEnded(page)).toBe(true);
    });

    test('one-photo fallback and background pause do not retain camera tracks', async ({ page }) => {
        await syntheticCamera(page);
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
        await page.evaluate(() => { window.frontFails = true; });
        await page.locator('[data-camera-shutter]').click();
        await page.getByRole('button', { name: 'Use one photo' }).click();
        await expect(page.locator('.memento-publish')).toBeEnabled();
        await expect(page.locator('[data-swap-memento-capture]')).toHaveCount(0);
        await expect(page.getByText('Tap the small photo to swap')).toBeHidden();
        expect(await tracksEnded(page)).toBe(true);
    });
});

test('send queues at once, guards repeat submits and shows a failure in the chat', async ({ page }) => {
    await syntheticCamera(page);
    await openMemento(page);
    await captureBothViews(page);
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        window.uploadAttempts = 0;
        DemoAPI.prototype.createDailyHighlightUpload = async () => {
            uploadAttempts++;
            return new Promise((_, reject) => window.rejectMemento = () => reject(Object.assign(new Error('Upload not allowed. Please try again.'), { status: 403 })));
        };
    });
    await page.locator('.memento-publish').click();
    await page.evaluate(() => document.querySelector('.memento-form').requestSubmit());
    await expect(page.locator('[data-memento-dialog]')).not.toBeVisible();
    await expect(page.locator('.chat-message.mine.sending .memento-label')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => uploadAttempts)).toBe(1);
    await page.evaluate(() => rejectMemento());
    await expect(page.locator('.chat-send-failure')).toContainText('Upload not allowed. Please try again.');
    // Nothing was posted, so the card offers the Memento again.
    await expect(page.getByRole('button', { name: 'Take a Memento' })).toBeVisible();
    expect(await page.evaluate(() => uploadAttempts)).toBe(1);
});

test('permission denial explains itself and never swaps in a photo picker', async ({ page }) => {
    let fileChoosers = 0; page.on('filechooser', () => fileChoosers++);
    await openMemento(page, { cameraUnavailable: true });
    await expect(page.locator('.live-camera-message')).toContainText('Camera access is off');
    await expect(page.getByRole('button', { name: 'Try camera again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose a photo instead' })).toBeHidden();
    expect(fileChoosers).toBe(0);
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
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.evaluate(() => resolveCamera());
    await expect.poll(() => page.evaluate(() => stoppedLateTracks)).toBe(1);
    expect(await page.evaluate(() => cameraRequests)).toBe(1);
    await expect(page.locator('[data-memento-dialog]')).not.toBeVisible();
});

test('chat chrome uses vector symbols and native-sized heading, not emoji controls', async ({ page }) => {
    await openMemento(page);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Back to chats' }).click();
    await expect(page.locator('.chat-page-header h1')).toHaveCSS('font-size', '28px');
    await expect(page.locator('[data-new-chat] .ui-icon').first()).toBeVisible();
    expect(await page.locator('.chat-shell').innerText()).not.toMatch(/[📸📷💬🔒⌛☎]/u);
});

test('dark navigation stays legible and review keeps Share reachable without overlapping the photo', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await syntheticCamera(page);
    await openMemento(page);
    await captureBothViews(page);
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
