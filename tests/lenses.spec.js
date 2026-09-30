import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const landmarks = JSON.parse(readFileSync('tests/fixtures/lenses/landmarks.json'));
const fakeCamera = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

test.use({ serviceWorkers: 'block', launchOptions: async ({ browserName }, use) => use(browserName === 'chromium' ? { args: fakeCamera } : {}) });

async function openChatCamera(page) {
    await page.goto('/app/?demo=1&signin=1');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await page.getByRole('button', { name: /Noah Williams/ }).click();
    await page.getByRole('button', { name: 'Send photo or video' }).click();
    return page.locator('[data-chat-camera]');
}
const controller = 'document.querySelector("[data-chat-camera] .live-camera-stage")?.cameraLenses';

// Stands in for the face worker where the real model is not under test.
async function syntheticFaceWorker(page, { fail = false } = {}) {
    await page.addInitScript(fail => {
        const NativeWorker = window.Worker;
        window.Worker = class {
            constructor(url, options) { if (!String(url).includes('/assets/lenses/face-tracker-')) return new NativeWorker(url, options); }
            postMessage(data) {
                if (data.type === 'init') setTimeout(() => this.onmessage?.({ data: fail ? { type: 'error', stage: 'init' } : { type: 'ready', delegate: 'CPU' } }), 0);
                else if (data.type === 'frame') { data.image.close?.(); setTimeout(() => this.onmessage?.({ data: { type: 'faces', timestamp: data.timestamp, width: 1, height: 1, inferenceMs: 1, faces: [] } }), 4); }
            }
            terminate() {}
        };
    }, fail);
}

test('carousel follows iOS: Original first, ring on the selection, tap and swipe with wraparound', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Synthetic camera device is Chromium-only.');
    await syntheticFaceWorker(page);
    const camera = await openChatCamera(page);
    const carousel = camera.getByRole('group', { name: 'Lenses' });
    await expect(carousel).toBeVisible();
    await expect(carousel.getByRole('button')).toHaveText(['Original', 'Dog', 'Cat', 'Bear', 'Crown', 'Heart Shades', 'Halo', 'Crying']);
    await expect(carousel.getByRole('button', { name: 'Original' })).toHaveAttribute('aria-pressed', 'true');
    const circle = await carousel.locator('.lens-gradient').first().boundingBox();
    expect(Math.round(circle.width)).toBe(56);
    await carousel.getByRole('button', { name: 'Crown' }).click();
    await expect(carousel.getByRole('button', { name: 'Crown' })).toHaveAttribute('aria-pressed', 'true');
    // Selected circles grow from 0.94 to full size (the 66 px ring's frame is 68).
    await expect.poll(async () => Math.round((await carousel.locator('.is-selected .lens-circle').boundingBox()).width)).toBe(68);
    // The selection is centred in the carousel.
    await expect.poll(async () => {
        const [button, track] = await Promise.all([carousel.getByRole('button', { name: 'Crown' }).boundingBox(), carousel.locator('.lens-carousel-track').boundingBox()]);
        return Math.abs(button.x + button.width / 2 - (track.x + track.width / 2));
    }).toBeLessThan(2);
    const stage = await camera.locator('.live-camera-stage').boundingBox();
    const swipe = async (from, to) => {
        await page.mouse.move(stage.x + stage.width * from, stage.y + stage.height * 0.35);
        await page.mouse.down();
        await page.mouse.move(stage.x + stage.width * to, stage.y + stage.height * 0.37, { steps: 5 });
        await page.mouse.up();
    };
    await swipe(0.8, 0.2);
    await expect(carousel.getByRole('button', { name: 'Heart Shades' })).toHaveAttribute('aria-pressed', 'true');
    // Back past Original wraps round to the last lens.
    for (let step = 0; step < 5; step++) await swipe(0.2, 0.8);
    await expect(carousel.getByRole('button', { name: 'Original' })).toHaveAttribute('aria-pressed', 'true');
    await swipe(0.2, 0.8);
    await expect(carousel.getByRole('button', { name: 'Crying' })).toHaveAttribute('aria-pressed', 'true');
    // A mostly vertical drag is not a lens swipe.
    await page.mouse.move(stage.x + stage.width * 0.5, stage.y + stage.height * 0.2);
    await page.mouse.down(); await page.mouse.move(stage.x + stage.width * 0.3, stage.y + stage.height * 0.7, { steps: 5 }); await page.mouse.up();
    await expect(carousel.getByRole('button', { name: 'Crying' })).toHaveAttribute('aria-pressed', 'true');
    // Closing the camera removes the overlay, carousel and worker.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.lens-overlay, .lens-carousel')).toHaveCount(0);
    expect(await page.evaluate(controller)).toBeUndefined();
});

test('every lens draws on recorded fixture landmarks, one to four faces, tongue only on a dropped jaw', async ({ page }) => {
    await syntheticFaceWorker(page);
    await page.goto('/app/?signin=1');
    const result = await page.evaluate(async fixtures => {
        const { createLensEngine, LENSES } = await import('/app/lenses/index.js');
        const out = {};
        for (const [name, fixture] of Object.entries(fixtures)) {
            const engine = createLensEngine({ video: { videoWidth: 720, videoHeight: 960, readyState: 0, paused: true } });
            await engine.ready;
            for (const lens of LENSES.slice(1)) {
                for (const jaw of [0, 0.7]) {
                    await engine.setLens(lens.id);
                    const faces = fixture.faces.map(face => ({ ...face, jawOpen: jaw }));
                    for (let frame = 0; frame < 4; frame++) engine.observe({ width: fixture.width, height: fixture.height, faces }, 1000 + frame * 50);
                    const canvas = new OffscreenCanvas(375, 500);
                    const ctx = canvas.getContext('2d');
                    const drew = engine.render(ctx, 375, 500, { timestamp: 1200, analyze: false });
                    const pixels = ctx.getImageData(0, 0, 375, 500).data;
                    let painted = 0, belowMouth = 0;
                    for (let index = 3; index < pixels.length; index += 4) {
                        if (!pixels[index]) continue;
                        painted++;
                        if (Math.floor(index / 4 / 375) > 500 * 0.64) belowMouth++;
                    }
                    out[`${name}:${lens.id}:${jaw}`] = { drew, painted, belowMouth };
                }
            }
            engine.destroy();
        }
        return out;
    }, landmarks);
    for (const [key, value] of Object.entries(result)) {
        expect(value.drew, key).toBe(true);
        expect(value.painted, key).toBeGreaterThan(400);
    }
    // Dog/Bear: the dropped jaw adds the tongue / honey below the mouth.
    for (const lens of ['dog', 'bear']) expect(result[`solo:${lens}:0.7`].belowMouth).toBeGreaterThan(result[`solo:${lens}:0`].belowMouth + 50);
    // Two people get two sets of art.
    expect(result['group:crown:0'].painted).toBeGreaterThan(result['solo:crown:0'].painted * 0.3);
});

test('unsupported browsers and a failed model fall back to the plain camera', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Synthetic camera device is Chromium-only.');
    await syntheticFaceWorker(page, { fail: true });
    const camera = await openChatCamera(page);
    await expect(camera.getByRole('button', { name: 'Take photo', exact: true })).toBeEnabled();
    await expect.poll(() => page.evaluate(`${controller}?.engine.state`)).toBe('unavailable');
    await expect(camera.locator('.lens-carousel-slot')).toBeHidden();
    await camera.getByRole('button', { name: 'Take photo', exact: true }).click();
    await expect(page.locator('[data-chat-media-dialog]').getByRole('img', { name: 'Photo preview' })).toBeVisible();
});

test('real face model: finds one and two faces in fixture photos, none in a blank frame', async ({ page, browserName }) => {
    test.setTimeout(60000);
    test.skip(browserName !== 'chromium', 'Inference is timed on Chromium; Playwright WebKit and Firefox also pass it, but real Safari needs a device check.');
    await page.goto('/app/?signin=1');
    const result = await page.evaluate(async () => {
        const { FACE_TRACKER_URL } = await import('/app/lenses/face-tracker-asset.js');
        const worker = new Worker(FACE_TRACKER_URL);
        const next = () => new Promise(resolve => { worker.onmessage = event => resolve(event.data); });
        worker.postMessage({ type: 'init' });
        const ready = await next();
        const run = async (source, timestamp) => {
            const bitmap = await createImageBitmap(source, { resizeWidth: 240, resizeHeight: 320 });
            worker.postMessage({ type: 'frame', image: bitmap, timestamp }, [bitmap]);
            return next();
        };
        const load = async name => { const image = new Image(); image.src = `/tests/fixtures/lenses/${name}.jpg`; await image.decode(); return image; };
        const blank = new OffscreenCanvas(240, 320); blank.getContext('2d').fillRect(0, 0, 240, 320);
        const solo = await load('solo'), group = await load('group');
        const counts = { solo: [], group: [] }, inference = [];
        for (let frame = 0; frame < 10; frame++) {
            const a = await run(solo, 100 + frame * 100), b = await run(group, 150 + frame * 100);
            counts.solo.push(a.faces.length); counts.group.push(b.faces.length); inference.push(a.inferenceMs, b.inferenceMs);
        }
        const empty = await run(blank, 5000);
        worker.terminate();
        return { ready, counts, empty: empty.faces.length, inference: inference.sort((x, y) => x - y) };
    });
    expect(result.ready).toEqual({ type: 'ready', delegate: 'CPU' });
    expect(result.counts.solo.every(count => count === 1)).toBe(true);
    expect(result.counts.group.every(count => count === 2)).toBe(true);
    expect(result.empty).toBe(0);
    test.info().annotations.push({ type: 'face-inference-ms', description: `p50 ${result.inference[result.inference.length >> 1].toFixed(1)} / max ${result.inference.at(-1).toFixed(1)}` });
});

// A real camera stream showing the fixture face: Chromium's fake capture
// device plays a Y4M file, generated here from the fixture photo.
test('live camera: real tracking draws Dog on the preview and into the captured photo', async ({ page, browserName, playwright }, testInfo) => {
    test.setTimeout(90000);
    test.skip(browserName !== 'chromium', 'Fake capture from a file is Chromium-only.');
    await page.goto('/app/?signin=1');
    const i420 = await page.evaluate(async () => {
        const image = new Image(); image.src = '/tests/fixtures/lenses/solo.jpg'; await image.decode();
        const width = 360, height = 480, canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, width, height);
        const rgba = ctx.getImageData(0, 0, width, height).data;
        const y = new Uint8Array(width * height), u = new Uint8Array(width * height / 4), v = new Uint8Array(width * height / 4);
        for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
            const i = (row * width + col) * 4, r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
            y[row * width + col] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            if (row % 2 === 0 && col % 2 === 0) {
                const c = (row / 2) * (width / 2) + col / 2;
                u[c] = Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
                v[c] = Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
            }
        }
        const frame = new Uint8Array(y.length + u.length + v.length); frame.set(y); frame.set(u, y.length); frame.set(v, y.length + u.length);
        let binary = ''; for (let i = 0; i < frame.length; i += 0x8000) binary += String.fromCharCode(...frame.subarray(i, i + 0x8000));
        return btoa(binary);
    });
    const frame = Buffer.from(i420, 'base64');
    const file = testInfo.outputPath('solo.y4m');
    writeFileSync(file, Buffer.concat([Buffer.from('YUV4MPEG2 W360 H480 F15:1 Ip A1:1 C420jpeg\n'), Buffer.from('FRAME\n'), frame, Buffer.from('FRAME\n'), frame]));
    const browser = await playwright.chromium.launch({ channel: 'chromium', args: [...fakeCamera, `--use-file-for-fake-video-capture=${file}`] });
    try {
        const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, serviceWorkers: 'block', viewport: { width: 375, height: 812 } });
        const live = await context.newPage();
        const camera = await openChatCamera(live);
        await expect.poll(() => live.evaluate(`${controller}?.engine.state`), { timeout: 60000 }).toBe('ready');
        await camera.getByRole('button', { name: 'Dog', exact: true }).click();
        await expect.poll(() => live.evaluate(`${controller}.engine.tracking`), { timeout: 20000 }).toBe(true);
        // The overlay has art over the top half of the face (the ears).
        await expect.poll(() => live.evaluate(() => {
            const canvas = document.querySelector('[data-chat-camera] .lens-overlay');
            const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, Math.round(canvas.height * 0.5)).data;
            let painted = 0; for (let index = 3; index < data.length; index += 4) if (data[index]) painted++;
            return painted;
        })).toBeGreaterThan(1000);
        await live.evaluate(`(() => { const c = ${controller}; const original = c.composite; window.lensComposites = []; c.composite = (...args) => { const drew = original(...args); window.lensComposites.push({ drew, width: args[1], height: args[2], mirrored: args[3]?.mirrored }); return drew; }; })()`);
        await expect.poll(() => live.evaluate(`${controller}.engine.stats().samples`)).toBeGreaterThan(3);
        const stats = await live.evaluate(`${controller}.engine.stats()`);
        const stage = await live.locator('[data-chat-camera] .live-camera-stage').boundingBox();
        await camera.getByRole('button', { name: 'Take photo', exact: true }).click();
        await expect(live.locator('[data-chat-media-dialog]').getByRole('img', { name: 'Photo preview' })).toBeVisible();
        // The photo is exactly the full-screen preview's crop (never upscaled) and, for the
        // front camera, mirrored like the preview (iOS behaviour); the lens follows.
        const composites = await live.evaluate(() => window.lensComposites);
        expect(composites).toHaveLength(1);
        expect(composites[0]).toMatchObject({ drew: true, mirrored: await live.evaluate(() => document.querySelector('[data-chat-camera] video').classList.contains('mirrored')) });
        expect(composites[0].width / composites[0].height).toBeCloseTo(stage.width / stage.height, 2);
        testInfo.annotations.push({ type: 'live-lens-stats', description: JSON.stringify(stats) });
    } finally { await browser.close(); }
});
