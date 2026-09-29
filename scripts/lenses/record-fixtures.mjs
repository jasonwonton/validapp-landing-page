// Records tests/fixtures/lenses/landmarks.json: the real Face Landmarker's
// output for the fixture photos, downscaled to the engine's 320 px analysis
// size, keeping only the mesh points the lenses use.
//   python3 -m http.server 4611 --bind 127.0.0.1 &
//   BASE=http://127.0.0.1:4611 node scripts/lenses/record-fixtures.mjs
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { MESH_INDICES } from '../../app/lenses/face-geometry.js';

const base = process.env.BASE || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage();
await page.goto(`${base}/app/?signin=1`);
const fixtures = await page.evaluate(async ({ indices, names }) => {
    const { FACE_TRACKER_URL } = await import('/app/lenses/face-tracker-asset.js');
    const worker = new Worker(FACE_TRACKER_URL);
    const next = () => new Promise(resolve => { worker.onmessage = event => resolve(event.data); });
    worker.postMessage({ type: 'init' });
    await next();
    const out = {};
    for (const name of names) {
        const image = new Image(); image.src = `/tests/fixtures/lenses/${name}.jpg`; await image.decode();
        const scale = 320 / Math.max(image.naturalWidth, image.naturalHeight);
        let result;
        // VIDEO mode tracks across frames; a few frames settle the landmarks.
        for (let frame = 0; frame < 5; frame++) {
            const bitmap = await createImageBitmap(image, { resizeWidth: Math.round(image.naturalWidth * scale), resizeHeight: Math.round(image.naturalHeight * scale), resizeQuality: 'medium' });
            worker.postMessage({ type: 'frame', image: bitmap, timestamp: frame * 50 }, [bitmap]);
            result = await next();
        }
        out[name] = {
            source: `tests/fixtures/lenses/${name}.jpg`, width: result.width, height: result.height,
            faces: result.faces.map(face => ({
                jawOpen: Math.round(face.jawOpen * 1e4) / 1e4, smile: Math.round(face.smile * 1e4) / 1e4,
                points: Object.fromEntries(indices.map(index => [index, [face.points[index * 2], face.points[index * 2 + 1]].map(value => Math.round(value * 1e5) / 1e5)])),
            })).sort((a, b) => a.points[1][0] - b.points[1][0]),
        };
    }
    worker.terminate();
    return out;
}, { indices: MESH_INDICES, names: ['solo', 'group'] });
await browser.close();
await writeFile('tests/fixtures/lenses/landmarks.json', JSON.stringify(fixtures, null, 1).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, '[$1, $2]') + '\n');
console.log(Object.entries(fixtures).map(([name, value]) => `${name}: ${value.faces.length} face(s) at ${value.width}x${value.height}`).join('\n'));
