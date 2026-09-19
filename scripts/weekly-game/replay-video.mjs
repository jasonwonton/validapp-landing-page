// Offline diagnostic: private clips stay on loopback; no camera or API calls.
// Usage: node scripts/weekly-game/replay-video.mjs /private/clip.mov output.json [start-seconds] [duration-seconds] [expected-crossings]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const [clipArg, output, startArg = '0', durationArg = '10', expectedArg] = process.argv.slice(2);
assert(clipArg && output, 'Provide a private video path and output JSON path.');
const start = Number(startArg), duration = Number(durationArg);
assert(Number.isFinite(start) && start >= 0 && duration >= 1 && duration <= 55);
const expected = expectedArg === undefined ? null : Number(expectedArg);
assert(expected === null || (Number.isInteger(expected) && expected >= 0));
const root = fileURLToPath(new URL('../../', import.meta.url));
const clip = await readFile(resolve(clipArg));
const hash = data => createHash('sha256').update(data).digest('hex');
const workerSource = await readFile(resolve(root, 'app/weekly-game/tracker-asset.js'), 'utf8');
const workerPath = workerSource.match(/'([^']+\.js)'/)[1];
const sourcePaths = ['app/weekly-game/tracker.js', 'app/weekly-game/scoring.js', workerPath.slice(1), 'assets/weekly-game/mediapipe-0.10.32/pose_landmarker_lite.task'];
const sources = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await readFile(resolve(root, path)))])));
const server = createServer(async (req, res) => {
    try {
        const path = new URL(req.url, 'http://localhost').pathname;
        if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Private tracking replay</title>'); return; }
        let bytes, type;
        if (path === '/clip') { bytes = clip; type = extname(clipArg).toLowerCase() === '.webm' ? 'video/webm' : 'video/mp4'; }
        else {
            assert(path.startsWith('/app/weekly-game/') || path.startsWith('/assets/weekly-game/'));
            const file = resolve(root, '.' + path); assert(file.startsWith(root));
            bytes = await readFile(file);
            type = {'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm'}[extname(file)] || 'application/octet-stream';
        }
        res.setHeader('Content-Type', type); res.setHeader('Cache-Control', 'no-store');
        const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
        if (range) {
            const first = Number(range[1]), last = Math.min(Number(range[2] || bytes.length - 1), bytes.length - 1);
            assert(first <= last); res.statusCode = 206;
            res.setHeader('Content-Range', `bytes ${first}-${last}/${bytes.length}`); bytes = bytes.subarray(first, last + 1);
        }
        res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Content-Length', bytes.length); res.end(bytes);
    } catch (_) { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
    browser = await chromium.launch({channel:'chromium'});
    const context = await browser.newContext({serviceWorkers:'block'});
    const origin = `http://127.0.0.1:${server.address().port}`;
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage(); await page.goto(origin);
    const result = await page.evaluate(async ({start, duration}) => {
        const {WristTracker} = await import('/app/weekly-game/tracker.js');
        const {CameraEvidence, createCameraGame} = await import('/app/weekly-game/scoring.js');
        const video = document.createElement('video'); video.muted = true; video.preload = 'auto'; video.src = '/clip'; document.body.append(video);
        await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(Error('Browser could not decode the clip. Convert to H.264 MP4 first.')); });
        if (video.duration + .02 < start + duration) throw Error('Scoring window exceeds the video duration.');
        const evidence = new CameraEvidence(duration), game = createCameraGame();
        let score = game.start({protocol:1,rules:{game:{mechanic:'height_crossings',steps:[]}}}).score;
        const samples = [], events = [], failures = [];
        const tracker = new WristTracker(() => {}, error => failures.push(error.message));
        await tracker.start();
        const began = performance.now();
        try {
            // Await each inference: measures fixed-input counting, not device throughput.
            // Feed preroll through continuity/model, but score only the requested window.
            const firstFrame = Math.max(0, Math.floor((start - 1) * 30));
            const endFrame = Math.ceil((start + duration) * 30);
            for (let frame = firstFrame; frame < endFrame; frame++) {
                const time = frame / 30 + .00001;
                if (time >= start + duration) break;
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(Error('Video seek timed out')), 10000);
                    video.onseeked = () => {clearTimeout(timeout); resolve();}; video.currentTime = time;
                });
                const t = frame * (1000 / 30 + .00001), before = performance.now();
                const sample = await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(Error('Tracker did not return a frame')), 10000);
                    tracker.onSample = value => {clearTimeout(timeout); resolve(value);};
                    tracker.onError = error => {clearTimeout(timeout); reject(error);};
                    void tracker.capture(video, t, 30);
                });
                const relative = (time - start) * 1000;
                if (relative < 0) continue;
                const row = evidence.append(relative, sample.pair, sample.hardBreak);
                const previous = score;
                if (row) score = game.frame({samples:[row]}).score;
                if (score > previous) events.push({ms:Math.round(relative),score});
                samples.push({ms:Math.round(relative),pair:sample.pair,hardBreak:sample.hardBreak,inferenceMs:performance.now()-before,evidence:row});
            }
        } finally { tracker.close(); }
        return {score,events,samples,evidence:evidence.samples,failures,elapsedMs:performance.now()-began,video:{width:video.videoWidth,height:video.videoHeight,duration:video.duration},browser:navigator.userAgent};
    }, {start,duration});
    const valid = result.samples.filter(x => x.pair).length;
    const summary = {score:result.score,expectedCrossings:expected,countDifference:expected === null ? null : result.score-expected,analyzedFrames:result.samples.length,validPairs:valid,hardBreaks:result.samples.filter(x=>x.hardBreak).length,evidenceRows:result.evidence.length};
    await writeFile(output, JSON.stringify({mode:'sequential 30 Hz recorded-video replay',clipSha256:hash(clip),startSeconds:start,durationSeconds:duration,sources,summary,...result,limitations:['Replay waits for inference; elapsed time is not live phone performance.','Rendered/compressed recordings differ from original camera frames.','Matching totals can hide compensating misses and extra counts; inspect event timestamps against manual annotations.','Native fast-run scores are comparison data, not independent ground truth.']},null,2));
    console.log(JSON.stringify(summary));
    if (expected !== null && result.score !== expected) process.exitCode = 2;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
