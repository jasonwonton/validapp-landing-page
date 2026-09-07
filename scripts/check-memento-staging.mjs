// Read-only live checks: synthetic camera only, no account login/upload/post.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
const invitation = process.env.STAGING_PREVIEW_URL;
assert(invitation, 'Set STAGING_PREVIEW_URL');
assert.equal(new URL(invitation).origin, 'https://staging.validapp.lol');
const api = 'https://api.six7.lol';
for (const path of ['/health', '/ready']) {
    const response = await fetch(`${api}${path}`);
    assert.equal(response.status, 200, path);
}
const schema = await fetch(`${api}/openapi.json`).then(r => r.json());
const path = '/api/v1/users/{user_id}/daily-highlight-uploads/{media_asset_id}/content';
const variant = schema.paths[path].put.parameters.find(p => p.name === 'variant');
assert.equal(variant?.schema.default, 'primary');
assert.equal(variant?.schema.pattern, '^(primary|secondary)$');
console.log('PASS: live API health/readiness and additive secondary upload contract');
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
    await page.goto(invitation);
    const version = await page.locator('meta[name="valid-app-version"]').getAttribute('content');
    assert.equal(version, 'web-v72');
    for (const file of ['app/chat/index.js', 'app/live-camera.js', 'app/chat/styles.css', 'app/api.js']) {
        const response = await page.request.get(new URL(`/${file}`, invitation).href);
        assert.equal(response.status(), 200);
        const hash = data => createHash('sha256').update(data).digest('hex');
        assert.equal(hash(await response.body()), hash(await readFile(new URL(`../dist/${file}`, import.meta.url))), file);
    }
    const result = await page.evaluate(async () => {
        const { createLiveCamera } = await import('/app/live-camera.js');
        const streams = [];
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async constraints => {
            const stream = await original(constraints);
            streams.push(stream);
            return stream;
        };
        const container = document.createElement('section');
        document.body.append(container);
        let resolve;
        const captured = new Promise(done => resolve = done);
        const camera = createLiveCamera({ container, onCapture: resolve, onFallback() { throw new Error('Unexpected fallback'); } });
        camera.open();
        const deadline = Date.now() + 15000;
        while (container.querySelector('[data-camera-shutter]').disabled) {
            if (Date.now() > deadline) throw new Error('Synthetic camera did not start');
            await new Promise(done => setTimeout(done, 50));
        }
        const fallbackHidden = container.querySelector('[data-camera-library]').hidden;
        container.querySelector('[data-camera-shutter]').click();
        let timeout;
        try {
            const files = await Promise.race([captured, new Promise((_, reject) => timeout = setTimeout(() => reject(new Error('Capture timeout')), 15000))]);
            return { fallbackHidden, files: files.map(file => ({ type: file.type, bytes: file.size })), tracksStopped: streams.flatMap(s => s.getTracks()).every(t => t.readyState === 'ended') };
        } finally { clearTimeout(timeout); camera.close(); container.remove(); }
    });
    assert.equal(result.fallbackHidden, true);
    assert.equal(result.files.length, 2);
    assert(result.files.every(file => file.type === 'image/jpeg' && file.bytes > 0 && file.bytes <= 8 * 1024 * 1024));
    assert.equal(result.tracksStopped, true);
    console.log('PASS: exact deployed module hashes, one-shutter two-view synthetic camera, no default picker, released tracks');
} finally { await browser.close(); }
