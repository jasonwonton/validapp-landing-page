// Read-only verification of a built release. No signup, authenticated mutations,
// messaging, or production credentials are involved.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chromium, firefox, webkit, devices } from '@playwright/test';

const origin = new URL(process.env.PWA_RELEASE_ORIGIN || 'https://validapp.lol').origin;
assert(origin === 'https://validapp.lol' || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin), 'Use production or a local built origin');
const local = JSON.parse(await readFile(new URL('../dist/app/build-manifest.json', import.meta.url)));
const expected = process.env.PWA_EXPECTED_RELEASE || local.release;
assert.match(expected, /^[a-f0-9]{20}$/);
const get = async path => {
    const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, path);
    return response;
};
const manifest = await (await get('/app/build-manifest.json')).json();
assert.equal(manifest.release, expected, 'Unexpected live release');
assert.deepEqual(manifest, local, 'Live manifest must match the reviewed build');
const app = await get('/app/');
const html = await app.text();
assert(html.includes(manifest.assets['/app/app.js']));
assert(html.includes(manifest.assets['/app/styles.css']));
assert.match(app.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
assert.match(app.headers.get('cache-control') || '', /no-cache/);
assert.equal(app.headers.get('x-content-type-options'), 'nosniff');
assert.match(app.headers.get('permissions-policy') || '', /camera=\(self\)/);
const worker = await get('/app/service-worker.js');
const workerText = await worker.text();
assert.equal(workerText, await readFile(new URL('../dist/app/service-worker.js', import.meta.url), 'utf8'));
assert.match(worker.headers.get('content-type') || '', /javascript/);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const entries = Object.values(manifest.assets);
let index = 0;
await Promise.all(Array.from({length: 4}, async () => {
    while (index < entries.length) {
        const path = entries[index++];
        assert(path.startsWith(`/app/_static/${expected}/`));
        const response = await get(path);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(sha(bytes), sha(await readFile(new URL(`../dist${path}`, import.meta.url))), path);
    }
}));
console.log(`PASS release ${expected}: manifest, entry points, worker, headers, ${entries.length} exact asset hashes`);

// A page opened before rollout must still be able to load its lazy chunks.
if (process.env.PWA_PREVIOUS_RELEASE) {
    assert.match(process.env.PWA_PREVIOUS_RELEASE, /^[a-f0-9]{20}$/);
    for (const file of ['app.js','routes/feed.js','chat/index.js','calls/index.js']) {
        const path = `/app/_static/${process.env.PWA_PREVIOUS_RELEASE}/${file}`;
        assert.equal(sha(Buffer.from(await (await get(path)).arrayBuffer())), sha(await readFile(new URL(`../dist${path}`, import.meta.url))));
    }
    console.log('PASS previous-release lazy modules remain available');
}
const targets = process.env.PWA_CHROMIUM_ONLY ? [['desktop',chromium,devices['Desktop Chrome']]] : [
    ['android',chromium,devices['Pixel 7']], ['desktop',chromium,devices['Desktop Chrome']],
    ['firefox',firefox,devices['Desktop Firefox']], ['webkit',webkit,devices['Desktop Safari']],
];
for (const [name,type,device] of targets) {
    const browser = await type.launch(type === chromium ? {channel:'chromium'} : {});
    try {
        const context = await browser.newContext({...device, serviceWorkers: type === chromium ? 'allow' : 'block'});
        const page = await context.newPage(); const errors = [];
        page.setDefaultTimeout(20000);
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${origin}/app/?signin=1`);
        await page.getByRole('heading', {name:'Welcome Back'}).waitFor();
        await page.getByRole('button', {name:/^sign in$/i}).waitFor();
        if (origin.startsWith('https:')) await page.getByRole('button', {name:'Create an account'}).waitFor();
        assert.deepEqual(errors, [], `${name} runtime errors`);
        if (type === chromium) {
            // Registration visibility alone does not mean installation and
            // activation have finished. Inspect Cache Storage only after the
            // worker is ready and has claimed this fresh page.
            await page.evaluate(() => Promise.race([
                navigator.serviceWorker.ready.then(() => true),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker did not become ready')), 30000)),
            ]));
            await page.waitForFunction(async () => {
                const registration = await navigator.serviceWorker.getRegistration();
                return registration?.active?.state === 'activated'
                    && navigator.serviceWorker.controller?.state === 'activated';
            });
            const cacheState = await page.evaluate(async () => {
                const names = (await caches.keys()).filter(name => name.startsWith('valid-web-'));
                const urls = (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(r=>r.url)))).flat();
                return {names,urls};
            });
            assert.equal(cacheState.names.length, 1);
            assert(cacheState.names[0].endsWith(`-${expected}`));
            for (const file of ['/app/app.js','/app/ui-icons.js','/app/tbh-share.js','/app/chat/presence.js']) assert(cacheState.urls.includes(origin+manifest.assets[file]),file);
            assert(cacheState.urls.every(url => new URL(url).origin === origin && !new URL(url).pathname.startsWith('/api/')));
            await context.setOffline(true);
            await page.reload();
            await page.getByRole('heading', {name:'Welcome Back'}).waitFor();
            assert.deepEqual(errors, [], `${name} offline runtime errors`);
        }
        console.log(`PASS ${name}: signed-out startup${type === chromium ? ', correct offline shell, no API responses cached' : ''}`);
        await context.close();
    } finally { await browser.close(); }
}
