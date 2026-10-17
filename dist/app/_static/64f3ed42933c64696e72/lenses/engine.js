// Face-tracked camera lenses for the web camera. The Face Landmarker runs in
// a worker on downscaled frames at ~20 Hz; the art is drawn at display rate
// from the smoothed, motion-carried tracks (face-geometry.js), so it neither
// jitters nor vanishes on a missed analysis.
import { FACE_TRACKER_URL } from './face-tracker-asset.js';
import { LENSES, ORIGINAL_LENS } from './catalog.js';
import { FaceTracker, coverMapping, faceFromMesh, screenFace } from './face-geometry.js';
import { drawLens } from './draw.js';

const INIT_TIMEOUT_MS = 45_000;
const FRAME_TIMEOUT_MS = 3_000;
/** Round trips slower than these (median, ms) halve the rate / turn lenses off. */
const SLOW_ROUND_TRIP_MS = 140;
const TOO_SLOW_ROUND_TRIP_MS = 450;
/** Median draw cost (ms), or preview frame interval (ms, under 20 fps), above
 * which drawn-every-frame lenses are dropped. */
const HEAVY_DRAW_MS = 6;
const SLOW_FRAME_MS = 50;

export function lensSupport() {
    if (typeof Worker !== 'function' || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function' || typeof WebAssembly !== 'object') {
        return { supported: false, reason: 'browser' };
    }
    // Low-end devices: under 2 GB, or a single core, cannot run the model
    // beside the camera without starving the preview.
    if ((navigator.deviceMemory && navigator.deviceMemory < 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 2)) {
        return { supported: false, reason: 'device' };
    }
    return { supported: true };
}

const median = values => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};
const percentile = (values, p) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};
const pushBounded = (list, value, limit = 90) => { list.push(value); if (list.length > limit) list.shift(); };

// A ready worker outlives its camera briefly, so Retake or reopening the
// camera does not download and compile the model again.
const PARK_MS = 30_000;
let parked = null;
function takeParked(url) {
    if (!parked || parked.url !== url) return null;
    const { worker, delegate } = parked;
    clearTimeout(parked.timer); parked = null;
    return { worker, delegate };
}
function park(worker, url, delegate) {
    if (parked) { clearTimeout(parked.timer); parked.worker.terminate(); }
    worker.onmessage = null; worker.onerror = null;
    parked = { worker, url, delegate, timer: setTimeout(() => { worker.terminate(); if (parked?.worker === worker) parked = null; }, PARK_MS) };
}
// A device measured too slow stays on the plain camera for this session.
let measuredTooSlow = false;
// Decoded lens art, shared by every camera in this session.
const imageCache = new Map();

export function createLensEngine({ video, lenses = LENSES, sampleRate = 20, analysisSize = 320, trackerUrl = FACE_TRACKER_URL, delegate = 'CPU' } = {}) {
    const listeners = new Set();
    const tracker = new FaceTracker();
    const timings = { inference: [], roundTrip: [], draw: [], frame: [] };
    let lastFrameAt = null;
    let available = [...lenses];
    let selected = ORIGINAL_LENS, pending = null, images = null;
    let worker = null, state = 'loading', destroyed = false;
    let busy = false, sentAt = 0, lastCapture = -Infinity, lastVideoTime = -1, frameTimer = null;
    let rate = sampleRate, samples = 0, readyDelegate = null;
    let selectGeneration = 0, unavailableReason = null, imagesFor = null;

    const status = () => ({ state, lenses: available, selected: selected.id, pending: pending?.id ?? null });
    const notify = () => { for (const listener of listeners) listener(status()); };

    function disable(reason) {
        if (destroyed) return;
        state = 'unavailable';
        unavailableReason = reason;
        worker?.terminate(); worker = null; busy = false; clearTimeout(frameTimer);
        available = [ORIGINAL_LENS];
        selected = ORIGINAL_LENS; pending = null; images = null; imagesFor = null; tracker.reset();
        notify();
    }

    const support = measuredTooSlow ? { supported: false, reason: 'slow' } : lensSupport();
    const ready = !support.supported ? Promise.resolve(false).then(() => { disable(support.reason); return false; }) : new Promise(resolve => {
        let settled = false;
        const settle = value => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
        const timer = setTimeout(() => { disable('timeout'); settle(false); }, INIT_TIMEOUT_MS);
        const becomeReady = workerDelegate => {
            state = 'ready'; readyDelegate = workerDelegate;
            if (pending && imagesFor === pending.id) { selected = pending; pending = null; }
            notify(); settle(true);
        };
        const warm = takeParked(trackerUrl);
        try { worker = warm?.worker ?? new Worker(trackerUrl); } catch (_) { disable('worker'); settle(false); return; }
        worker.onerror = () => { disable('worker'); settle(false); };
        worker.onmessage = ({ data }) => {
            if (destroyed) return;
            if (data.type === 'ready') {
                becomeReady(data.delegate);
            } else if (data.type === 'faces') {
                received(data);
            } else if (data.type === 'error') {
                if (data.stage === 'init' || state !== 'ready') { disable('model'); settle(false); }
                else { busy = false; clearTimeout(frameTimer); }
            }
        };
        if (warm) queueMicrotask(() => { if (!destroyed) becomeReady(warm.delegate); });
        else worker.postMessage({ type: 'init', delegate });
    });

    function received(data) {
        clearTimeout(frameTimer);
        busy = false;
        const roundTrip = performance.now() - sentAt;
        pushBounded(timings.inference, data.inferenceMs);
        pushBounded(timings.roundTrip, roundTrip);
        samples += 1;
        observe(data, data.timestamp);
        // Adapt to the device: after a warm-up, a slow median halves the
        // analysis rate; a hopeless one turns lenses off.
        if (samples >= 12 && samples % 6 === 0) {
            const typical = median(timings.roundTrip.slice(-12));
            if (typical > TOO_SLOW_ROUND_TRIP_MS) { measuredTooSlow = true; disable('slow'); }
            else if (typical > SLOW_ROUND_TRIP_MS && rate > 10) rate = 10;
        }
    }

    /** Feed one analysis (the worker's `faces` message shape). Also the hook
     * tests use to replay recorded landmark fixtures. */
    function observe({ width, height, faces }, timestamp) {
        if (selected === ORIGINAL_LENS && !pending) return;
        const measured = [];
        for (const face of faces || []) {
            const points = face.points;
            const lookup = Array.isArray(points) || ArrayBuffer.isView(points)
                ? index => index * 2 + 1 < points.length ? [points[index * 2], points[index * 2 + 1]] : null
                : index => points[index] ?? null;
            const anchors = faceFromMesh(lookup, width, height, face.jawOpen);
            if (anchors) measured.push(anchors);
        }
        tracker.observe(measured, timestamp / 1000);
    }

    function pump(now) {
        if (!worker || state !== 'ready' || busy || destroyed) return;
        if (video.readyState < 2 || !video.videoWidth || !video.videoHeight || video.paused) return;
        if (now - lastCapture < 1000 / rate || video.currentTime === lastVideoTime) return;
        busy = true; lastCapture = now; lastVideoTime = video.currentTime;
        const scale = Math.min(1, analysisSize / Math.max(video.videoWidth, video.videoHeight));
        const resizeWidth = Math.max(1, Math.round(video.videoWidth * scale));
        const resizeHeight = Math.max(1, Math.round(video.videoHeight * scale));
        createImageBitmap(video, { resizeWidth, resizeHeight, resizeQuality: 'medium' }).then(image => {
            if (destroyed || !worker) { image.close(); busy = false; return; }
            sentAt = performance.now();
            frameTimer = setTimeout(() => { busy = false; }, FRAME_TIMEOUT_MS);
            worker.postMessage({ type: 'frame', image, timestamp: now }, [image]);
        }, () => { busy = false; });
    }

    async function loadImages(lens) {
        const entries = await Promise.all(Object.entries(lens.art).map(async ([part, url]) => {
            if (!imageCache.has(url)) {
                const image = new Image();
                image.decoding = 'async';
                image.src = url;
                imageCache.set(url, image.decode().then(() => image, error => { imageCache.delete(url); throw error; }));
            }
            return [part, await imageCache.get(url)];
        }));
        return Object.fromEntries(entries);
    }

    async function setLens(id) {
        const lens = available.find(item => item.id === id) || ORIGINAL_LENS;
        const generation = ++selectGeneration;
        lastFrameAt = null;
        if (lens === ORIGINAL_LENS) {
            selected = ORIGINAL_LENS; pending = null; images = null; imagesFor = null; tracker.reset(); notify();
            return true;
        }
        pending = lens; notify();
        try {
            const loaded = await loadImages(lens);
            if (generation !== selectGeneration || destroyed) return false;
            images = loaded; imagesFor = lens.id;
            if (state === 'ready') { if (selected.id !== lens.id) tracker.reset(); selected = lens; pending = null; }
            notify();
            return state === 'ready' || state === 'loading';
        } catch (_) {
            if (generation !== selectGeneration) return false;
            pending = null; notify();
            return false;
        }
    }

    function render(ctx, width, height, { mirrored = false, timestamp = performance.now(), analyze = true } = {}) {
        if (destroyed || selected === ORIGINAL_LENS || imagesFor !== selected.id) return false;
        if (analyze) {
            if (lastFrameAt != null && timestamp > lastFrameAt) pushBounded(timings.frame, timestamp - lastFrameAt);
            lastFrameAt = timestamp;
            pump(timestamp);
        }
        if (!video.videoWidth || !video.videoHeight) return false;
        const faces = tracker.faces(timestamp / 1000);
        if (!faces.length) return false;
        const started = performance.now();
        const mapping = coverMapping(video.videoWidth, video.videoHeight, width, height, mirrored);
        drawLens(ctx, selected, faces.map(face => screenFace(face, mapping)), images, timestamp / 1000);
        const cost = performance.now() - started;
        pushBounded(timings.draw, cost);
        const tooSlow = timings.draw.length >= 30 && (median(timings.draw.slice(-30)) > HEAVY_DRAW_MS
            || (timings.frame.length >= 30 && median(timings.frame.slice(-30)) > SLOW_FRAME_MS));
        if (selected.heavy && tooSlow) {
            available = available.filter(lens => !lens.heavy);
            timings.draw.length = 0; timings.frame.length = 0;
            void setLens(ORIGINAL_LENS.id);
        }
        return true;
    }

    function destroy() {
        destroyed = true; listeners.clear();
        clearTimeout(frameTimer);
        // A frame still in flight would answer the next engine; only an idle,
        // ready worker is kept.
        if (worker && state === 'ready' && !busy) park(worker, trackerUrl, readyDelegate); else worker?.terminate();
        worker = null;
        tracker.reset(); images = null;
    }

    const engine = {
        ready,
        get lenses() { return available; },
        get state() { return state; },
        get unavailableReason() { return unavailableReason; },
        get selectedLens() { return selected.id; },
        get tracking() { return tracker.tracking; },
        setLens, render, destroy, observe,
        subscribe(listener) { listeners.add(listener); listener(status()); return () => listeners.delete(listener); },
        stats() {
            const round = value => value == null ? null : Math.round(value * 10) / 10;
            return {
                delegate: readyDelegate, samples, sampleRate: rate, analysisSize,
                inferenceMsP50: round(median(timings.inference)), inferenceMsP95: round(percentile(timings.inference, 0.95)),
                roundTripMsP50: round(median(timings.roundTrip)), roundTripMsP95: round(percentile(timings.roundTrip, 0.95)),
                drawMsP50: round(median(timings.draw)), drawMsP95: round(percentile(timings.draw, 0.95)),
                frameMsP50: round(median(timings.frame)),
            };
        },
    };
    return engine;
}
