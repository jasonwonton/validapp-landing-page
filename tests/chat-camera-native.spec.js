import { test, expect } from '@playwright/test';

test.use({ launchOptions: async ({ browserName }, use) => use(browserName === 'chromium' ? { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } : {}) });

async function room(page) {
    await page.bringToFront();
    await page.goto('/app/?demo=1&signin=1');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await page.getByRole('button', { name: /Noah Williams/ }).click();
    await page.getByRole('button', { name: 'Send photo or video' }).click();
    return page.locator('[data-chat-media-dialog]');
}

test('chat camera opens immediately, single shutter reviews, retakes and sends only once', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Synthetic hardware capture is Chromium-only; fallback and late permission are tested on every engine.');
    await page.addInitScript(() => {
        window.chatCameraStreams = [];
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async constraints => {
            const stream = await original(constraints); chatCameraStreams.push(stream); return stream;
        };
    });
    let fileChoosers = 0; page.on('filechooser', () => fileChoosers++);
    const dialog = await room(page);
    const shutter = dialog.getByRole('button', { name: 'Take photo', exact: true });
    await expect(shutter).toBeEnabled();
    await expect(dialog.locator('.chat-media-editor')).toBeHidden();
    await shutter.click();
    await expect(dialog.getByRole('img', { name: 'Photo preview' })).toBeVisible();
    await expect(dialog.locator('.chat-media-publish')).toBeEnabled();
    expect(await page.evaluate(() => chatCameraStreams.length)).toBe(1);
    expect(await page.evaluate(() => chatCameraStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')))).toBe(true);
    await expect(dialog.getByLabel('Text overlay')).toBeHidden();
    expect(fileChoosers).toBe(0);
    await dialog.locator('[data-retake-chat-photo]').click();
    await expect(shutter).toBeEnabled();
    await shutter.click();
    await expect(dialog.locator('.chat-media-publish')).toBeEnabled();
    await dialog.locator('.chat-media-publish').click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.chat-message.mine img[alt="Photo"]')).toHaveCount(1);
    expect(await page.evaluate(() => chatCameraStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')))).toBe(true);
});

test('camera denial keeps an explicit library fallback and clean review', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
        getUserMedia: async () => { throw new DOMException('Denied', 'NotAllowedError'); },
    } }));
    const dialog = await room(page);
    await expect(dialog.locator('.live-camera-message')).toContainText('Camera access is off');
    const chooserPromise = page.waitForEvent('filechooser');
    await dialog.locator('[data-camera-library]').click();
    await (await chooserPromise).setFiles('assets/AppIconV2.png');
    await expect(dialog.locator('.chat-media-publish')).toBeEnabled();
    await expect(dialog.locator('.live-camera')).toBeHidden();
    await expect(dialog.locator('.chat-media-file-input')).toBeHidden();
    await expect(dialog.locator('.chat-media-edit-options')).not.toHaveAttribute('open', '');
    await dialog.locator('[data-close-chat-media]').click();
    await expect(dialog).toBeHidden();
});

test('camera permission arriving after dismissal stops every acquired track', async ({ page }) => {
    await page.addInitScript(() => {
        window.cameraStopped = 0;
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => new Promise(resolve => {
            window.resolveChatCamera = () => resolve({ getTracks: () => [{ stop: () => cameraStopped++ }] });
        }) } });
    });
    const dialog = await room(page);
    await expect.poll(() => page.evaluate(() => typeof window.resolveChatCamera)).toBe('function');
    await dialog.locator('[data-close-chat-media]').click();
    await expect(dialog).toBeHidden();
    await page.evaluate(() => resolveChatCamera());
    await expect.poll(() => page.evaluate(() => cameraStopped)).toBe(1);
    await expect(dialog.locator('.chat-media-publish')).toBeDisabled();
});

for (const theme of ['light', 'dark']) test(`${theme}: profile and native chat controls have the correct affordances`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(() => Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined }));
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(async () => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const original = DemoAPI.prototype.getProfile;
        DemoAPI.prototype.getProfile = async function(...args) { return { ...await original.apply(this, args), bio: '' }; };
    });
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Add bio' })).toBeVisible();
    await expect(page.locator('.profile-bio-button')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(page.locator('.profile-streak .ui-icon')).toHaveCSS('color', 'rgb(255, 149, 0)');
    const plus = await page.locator('.profile-add-bio-icon').evaluate(el => ({ ink: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
    expect(plus.ink).not.toBe(plus.background);
    await expect(page.locator('#hapticsPreferences')).toBeHidden();
    await expect(page.locator('#appearanceSelect')).toBeVisible();
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await expect(page.locator('.chat-row.attention').first()).toHaveCSS('background-image', 'none');
    await page.getByRole('button', { name: /Weekend Crew/ }).click();
    await expect(page.locator('[data-open-memento]')).toHaveText('Take Memento');
    await expect(page.locator('[data-open-memento]')).toHaveCSS('background-color', 'rgb(255, 177, 94)');
    await page.getByRole('button', { name: 'Back to chats' }).click();
    await page.getByRole('button', { name: /Noah Williams/ }).click();
    await expect(page.locator('.native-sticker-icon')).toHaveCSS('color', 'rgb(255, 177, 94)');
    await expect(page.locator('.chat-camera-button')).toHaveCSS('border-top-width', '2px');
});
