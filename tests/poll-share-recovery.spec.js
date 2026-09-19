import { expect, test } from '@playwright/test';

const artwork = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="red" d="M0 0h256v256H0z"/></svg>';
const cdnURL = 'https://validappcdn.com/questions/images/poll_share_feed.jpeg';

async function openPoll(page, { missing = false, imageURL = cdnURL } = {}) {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
        Object.defineProperty(navigator, 'share', { configurable: true, value: async ({ files }) => {
            const bitmap = await createImageBitmap(files[0]);
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width; canvas.height = bitmap.height;
            const context = canvas.getContext('2d');
            context.drawImage(bitmap, 0, 0);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let red = 0;
            for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i] > 240 && pixels[i + 1] < 20 && pixels[i + 2] < 20) red++;
            }
            window.sharedPoll = { width: bitmap.width, height: bitmap.height, red };
            bitmap.close();
        } });
    });
    // Model the browser's blocked CORS reads while allowing normal image display.
    await page.route(imageURL, route => {
        if (route.request().resourceType() === 'fetch' || route.request().headers().origin) return route.abort('blockedbyresponse');
        return route.fulfill({ contentType: 'image/svg+xml', body: artwork });
    });
    await page.route('**/api/v1/media/questions/images/poll_share_feed.jpeg', route => route.fulfill(
        missing ? { status: 404, body: 'Not found' } : { contentType: 'image/svg+xml', body: artwork },
    ));
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(async url => {
        const { DemoAPI } = await import('/app/demo-api.js');
        const original = DemoAPI.prototype.getPersonalFeed;
        DemoAPI.prototype.getPersonalFeed = function(...args) {
            this.personalFeed.find(item => item.question_answer_id === 9001).image_url = url;
            return original.apply(this, args);
        };
    }, imageURL);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.locator('[data-feed-detail="9001"]').click();
    // Opening detail can replace the image during rendering. Observe the live
    // element's decoded dimensions instead of holding a stale decode() promise.
    await expect(page.locator('#feedDetailBody .feed-detail-art img')).toHaveJSProperty('naturalWidth', 256);
}

for (const platform of ['Snapchat', 'Instagram', 'TikTok']) {
    test(`${platform} share retains artwork when the CDN has no CORS headers`, async ({ page }) => {
        await openPoll(page);
        await expect(page.locator('.feed-detail-selection-indicator')).toHaveText('👆');
        const recovery = page.waitForResponse('**/api/v1/media/questions/images/poll_share_feed.jpeg');
        await page.getByRole('button', { name: `Share poll to ${platform}` }).click();
        expect((await recovery).status()).toBe(200);
        await expect.poll(() => page.evaluate(() => window.sharedPoll?.red || 0)).toBeGreaterThan(100_000);
        expect(await page.evaluate(() => window.sharedPoll)).toMatchObject({ width: 900, height: 1600 });
    });
}

test('unrecoverable artwork shows a retry error instead of sharing an incomplete photo', async ({ page }) => {
    await openPoll(page, { missing: true });
    const button = page.getByRole('button', { name: 'Share poll to Snapchat' });
    await button.click();
    await expect(page.locator('#feedDetailStatus')).toContainText('Could not create the poll photo');
    expect(await page.evaluate(() => window.sharedPoll)).toBeUndefined();
    await expect(button).toBeEnabled();
});

test('untrusted artwork hosts never use the public media fallback', async ({ page }) => {
    const requests = [];
    page.on('request', request => { if (request.url().includes('/api/v1/media/')) requests.push(request.url()); });
    await openPoll(page, { imageURL: 'https://untrusted.example/questions/images/poll_share_feed.jpeg' });
    await page.getByRole('button', { name: 'Share poll to TikTok' }).click();
    await expect(page.locator('#feedDetailStatus')).toContainText('Could not create the poll photo');
    expect(requests).toEqual([]);
});
