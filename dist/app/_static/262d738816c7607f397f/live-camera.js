import { uiIcon } from './ui-icons.js';
import { setRuntimeStyles } from './runtime-style.js';
import { centerCrop, drawScaled } from './camera/photo-pipeline.js';

// Live camera for chat photos/videos and Mementos (iOS ChatMediaCaptureView +
// ChatCameraController). Loaded on demand; its styles live in camera/camera.css.
//
// Captures are handed over as ImageBitmaps that already look like the preview:
// cropped to the 3:4 stage and mirrored for the front camera (iOS mirrors the
// preview, photos and videos alike). Nothing is JPEG-encoded here; the photo
// pipeline encodes exactly once when the photo is sent.
//
// Lens hook (for face-tracked lenses): `camera.setFrameHook(hook)` registers
//   hook(ctx, width, height, info)
// which is called
//   * for every preview frame, on a transparent canvas laid over the video
//     (info.target === "preview"),
//   * once on each captured photo, before it is handed over ("photo"),
//   * for every recorded video frame ("recording").
// `ctx` is already in output space: it shows the frame exactly as the user
// sees it (3:4 crop, mirrored when info.mirrored). info = { target, mirrored,
// video, crop, toOutput(x, y) } where `video` is the raw <video> to track
// faces on, `crop` is the visible region in raw video pixels and
// `toOutput(x, y)` maps a raw video pixel to (x, y) in ctx, handling crop,
// scale and mirroring. Return nothing; draw synchronously. Pass null to remove.

const HOLD_TO_RECORD_MS = 260;
const RECORD_LOCK_TRAVEL = 76;
const SHUTTER_ZOOM_TRAVEL = 520;
const DOUBLE_TAP_MS = 300;
const TAP_TOLERANCE = 12;
const PINCH_DEAD_ZONE = 0.12;
const MAX_ZOOM_RATIO = 5;
const SCREEN_FLASH_MS = 1000;
// The contract's order; plain MP4 last for Safari builds that reject the codec string.
const VIDEO_TYPES = ['video/mp4;codecs=avc1,mp4a', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

const icons = {
    flash: '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12Z" fill="currentColor" stroke="none"/></svg>',
    flashOff: '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m4 3 16 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

let stylesPromise = null;
export function ensureCameraStyles() {
    if (stylesPromise) return stylesPromise;
    const href = new URL('./camera/camera.css', import.meta.url).href;
    if ([...document.styleSheets].some((sheet) => sheet.href === href)) return (stylesPromise = Promise.resolve());
    stylesPromise = new Promise((resolve) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        const done = () => resolve();
        link.addEventListener('load', done, { once: true });
        link.addEventListener('error', done, { once: true });
        setTimeout(done, 3000);
        document.head.append(link);
    });
    return stylesPromise;
}

export function supportedVideoRecordingType() {
    if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return '';
    return VIDEO_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type)) || '';
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

// The still from ImageCapture covers more of the sensor than the video
// stream; keep only what the preview showed (the stream is a centred crop).
function stillRegion(width, height, videoWidth, videoHeight, aspect) {
    const videoAspect = videoWidth / videoHeight;
    let regionWidth = width, regionHeight = height;
    if (width / height > videoAspect) regionWidth = height * videoAspect;
    else regionHeight = width / videoAspect;
    const inner = centerCrop(regionWidth, regionHeight, aspect);
    return { x: (width - regionWidth) / 2 + inner.x, y: (height - regionHeight) / 2 + inner.y, width: inner.width, height: inner.height };
}

export function createLiveCamera({ container, onCapture, onFallback, singlePhoto = false, initialFacing = 'environment', maxDimension = 2560, aspect = 3 / 4, haptic = null, recording = null }) {
    container.innerHTML = `<div class="live-camera-stage"><video autoplay muted playsinline aria-label="Live camera preview"></video><canvas class="live-camera-overlay" aria-hidden="true" hidden></canvas><img class="live-camera-inset" alt="Memento preview" hidden><span class="live-camera-focus" aria-hidden="true" hidden></span><button type="button" class="live-camera-flash" data-camera-flash hidden></button><button type="button" class="live-camera-zoom" data-camera-zoom hidden>1×</button><span class="live-camera-timer" role="timer" aria-live="off" hidden></span><div class="live-camera-message" role="status"></div></div><div class="live-camera-controls"><button type="button" data-camera-library aria-label="Choose a photo instead">${uiIcon('photo')}</button><div class="live-camera-shutter-wrap"><span class="live-camera-lock" aria-hidden="true" hidden>${uiIcon('lock')}</span><button type="button" class="camera-shutter" data-camera-shutter aria-label="Take photo" disabled><span></span></button></div><button type="button" data-camera-flip aria-label="Switch front and rear camera" disabled>${uiIcon('flip')}</button></div><p class="live-camera-hint">Tap to capture</p><div class="live-camera-alternatives"><button type="button" data-camera-retry hidden>Try camera again</button><button type="button" data-camera-single hidden>Use one photo</button></div><div class="live-camera-screen-flash" hidden></div>`;
    const $ = selector => container.querySelector(selector);
    const video = $('video'), message = $('.live-camera-message'), stage = $('.live-camera-stage');
    const shutter = $('[data-camera-shutter]'), flashButton = $('[data-camera-flash]'), zoomButton = $('[data-camera-zoom]');
    if (singlePhoto) $('[data-camera-library]').setAttribute('aria-label', 'Photo library');
    let stream = null, generation = 0, pending = false, busy = false, opened = false;
    let facing = initialFacing, photos = [], insetURL = null, permissionTimer = null;
    let mirrored = false, capabilities = {}, zoom = 1, frameHook = null, overlayFrame = 0;
    let flashMode = 'auto', lowLight = false, lightTimer = null, screenFlashTimer = null;
    let lastTap = null, pinch = null;
    let press = null, rec = null;
    const pointers = new Map();
    const feedback = (kind) => { try { haptic?.(kind); } catch (_) { /* optional */ } };

    function track() { return stream?.getVideoTracks()[0] || null; }
    function videoCrop() { return centerCrop(video.videoWidth, video.videoHeight, aspect); }
    function mapper(crop, width, height) {
        return (x, y) => {
            const outX = (x - crop.x) / crop.width * width;
            return [mirrored ? width - outX : outX, (y - crop.y) / crop.height * height];
        };
    }
    function runHook(context, width, height, target) {
        if (!frameHook || !video.videoWidth) return;
        const crop = videoCrop();
        try {
            context.save();
            frameHook(context, width, height, { target, mirrored, video, crop, toOutput: mapper(crop, width, height) });
        } catch (error) {
            console.warn('Camera frame hook failed', error);
        } finally {
            context.restore();
        }
    }
    function paintOverlay() {
        overlayFrame = 0;
        const canvas = $('.live-camera-overlay');
        if (!frameHook || !stream) { canvas.hidden = true; return; }
        canvas.hidden = false;
        const ratio = Math.min(2, devicePixelRatio || 1);
        const width = Math.round(stage.clientWidth * ratio), height = Math.round(stage.clientHeight * ratio);
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        const context = canvas.getContext('2d');
        context.clearRect(0, 0, width, height);
        runHook(context, width, height, 'preview');
        overlayFrame = requestAnimationFrame(paintOverlay);
    }
    function startOverlay() { if (frameHook && stream && !overlayFrame) overlayFrame = requestAnimationFrame(paintOverlay); }
    function stopOverlay() { cancelAnimationFrame(overlayFrame); overlayFrame = 0; $('.live-camera-overlay').hidden = true; }

    function release() {
        stopOverlay();
        clearInterval(lightTimer); lightTimer = null;
        stream?.getTracks().forEach(item => item.stop());
        stream = null; video.srcObject = null;
        clearTimeout(permissionTimer);
        shutter.disabled = true;
        $('[data-camera-flip]').disabled = true;
        flashButton.hidden = true;
        zoomButton.hidden = true;
    }
    function stop() { generation++; busy = false; cancelPress(); void stopRecording({ discard: true }); hideScreenFlash(); release(); }
    // ---- Face lenses (app/lenses, loaded on demand) -------------------------
    // Hooks: open() attaches, close() detaches, grabPhoto() and the recorder
    // composite onto the output. The overlay canvas and carousel live inside .live-camera-stage.
    let lenses = null, lensesLoad = null;
    function attachLenses() {
        if (lensesLoad) return;
        const load = lensesLoad = import('./lenses/index.js').then(({ attachCameraLenses }) => {
            if (lensesLoad === load && opened) lenses = attachCameraLenses({ stage: $('.live-camera-stage'), video });
        }).catch(() => {});
    }
    function detachLenses() { lensesLoad = null; lenses?.destroy(); lenses = null; }
    // Photos and recordings are drawn mirrored like the preview for the front
    // camera (see grabPhoto/startRecording), so the lens follows the same flag.
    const compositeLenses = (context, width, height) => lenses?.composite(context, width, height, { mirrored });
    // ---- end face lenses ----------------------------------------------------
    function clearPhotos() {
        photos.forEach(photo => photo.close?.());
        photos = [];
        if (insetURL) URL.revokeObjectURL(insetURL);
        insetURL = null; $('img').removeAttribute('src'); $('img').hidden = true;
        $('[data-camera-single]').hidden = true;
    }
    function failure(text) {
        message.textContent = text;
        $('[data-camera-retry]').hidden = false;
        $('[data-camera-library]').hidden = false;
    }
    function recordingAllowed() { return Boolean(recording && supportedVideoRecordingType() && recording.limitFor?.(supportedVideoRecordingType()) > 0); }
    function refreshHint() {
        $('.live-camera-hint').textContent = recordingAllowed() ? 'Tap for a photo, hold for video' : 'Tap to capture';
        shutter.setAttribute('aria-description', recordingAllowed() ? 'Tap for a photo or hold to record a video. Slide left while holding to lock recording.' : '');
        if (!recordingAllowed()) shutter.removeAttribute('aria-description');
    }

    function readCapabilities() {
        capabilities = {};
        try { capabilities = track()?.getCapabilities?.() || {}; } catch (_) { capabilities = {}; }
        const settings = track()?.getSettings?.() || {};
        zoom = Number(settings.zoom || capabilities.zoom?.min || 1);
        renderZoom();
        renderFlash();
    }
    function zoomRange() {
        const range = capabilities.zoom;
        if (!range || !(Number(range.max) > Number(range.min))) return null;
        const min = Number(range.min) || 1;
        return { min, max: Math.min(Number(range.max), min * MAX_ZOOM_RATIO) };
    }
    function renderZoom() {
        const range = zoomRange();
        zoomButton.hidden = !range || range.max < range.min * 2 || Boolean(rec);
        const relative = range ? zoom / range.min : 1;
        const label = Math.abs(relative - 1) < 0.05 ? '1' : Math.abs(relative - 2) < 0.05 ? '2' : relative.toFixed(1);
        zoomButton.textContent = `${label}×`;
        zoomButton.setAttribute('aria-label', `Zoom ${label}×. Switch between 1× and 2×`);
    }
    let zoomFrame = 0, zoomTarget = null;
    function setZoom(value) {
        const range = zoomRange();
        if (!range) return;
        zoomTarget = Math.min(range.max, Math.max(range.min, value));
        zoom = zoomTarget;
        renderZoom();
        if (zoomFrame) return;
        zoomFrame = requestAnimationFrame(() => {
            zoomFrame = 0;
            track()?.applyConstraints({ advanced: [{ zoom: zoomTarget }] }).catch(() => {});
        });
    }

    function torchSupported() { return capabilities.torch === true; }
    function flashAvailable() { return mirrored || torchSupported(); }
    function flashWanted() { return flashMode === 'on' || (flashMode === 'auto' && lowLight); }
    function renderFlash() {
        flashButton.hidden = !stream || !flashAvailable() || Boolean(rec);
        const lit = flashWanted();
        flashButton.innerHTML = `${lit || flashMode !== 'off' ? icons.flash : icons.flashOff}${flashMode === 'auto' ? '<small>A</small>' : ''}`;
        flashButton.classList.toggle('lit', flashMode === 'on' || (flashMode === 'auto' && lowLight));
        flashButton.setAttribute('aria-label', `Flash: ${flashMode === 'auto' ? 'Auto' : flashMode === 'on' ? 'On' : 'Off'}`);
    }
    // Low light is judged from the preview itself, like ChatLowLightClassifier.
    function sampleLight() {
        if (!video.videoWidth || document.hidden) return;
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 24; canvas.height = 32;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            context.drawImage(video, 0, 0, 24, 32);
            const data = context.getImageData(0, 0, 24, 32).data;
            let total = 0;
            for (let i = 0; i < data.length; i += 4) total += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
            const luma = total / (data.length / 4) / 255;
            const next = lowLight ? luma < 0.24 : luma < 0.18;
            if (next !== lowLight) { lowLight = next; renderFlash(); }
        } catch (_) { /* a tainted or stopped frame keeps the last reading */ }
    }
    function hideScreenFlash() {
        clearTimeout(screenFlashTimer);
        $('.live-camera-screen-flash').hidden = true;
    }
    async function showScreenFlash() {
        $('.live-camera-screen-flash').hidden = false;
        // Always restore, even if a capture hangs.
        clearTimeout(screenFlashTimer);
        screenFlashTimer = setTimeout(hideScreenFlash, 6000);
        await wait(SCREEN_FLASH_MS);
    }
    async function setTorch(on) {
        if (!torchSupported()) return;
        await track()?.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {});
    }

    async function start() {
        if (!opened) return;
        if (document.hidden) return failure('Camera paused. Tap Try camera again when you return.');
        if (pending) return failure('Respond to the camera permission prompt first, then try again.');
        stop();
        const requestGeneration = generation;
        message.textContent = photos.length ? 'Capturing…' : 'Starting camera…';
        $('[data-camera-retry]').hidden = true;
        $('[data-camera-library]').hidden = !singlePhoto;
        refreshHint();
        if (!navigator.mediaDevices?.getUserMedia) return failure('Live capture is unavailable here. Open in a supported browser or choose a photo.');
        pending = true;
        permissionTimer = setTimeout(() => {
            if (generation === requestGeneration && opened) failure('Allow camera access in your browser to take a photo.');
        }, 10_000);
        try {
            // 4:3 at the highest common resolution: phones return their full
            // sensor field of view, and a 3:4 crop of it loses nothing.
            const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
            if (requestGeneration !== generation || !opened || document.hidden) { acquired.getTracks().forEach(item => item.stop()); return; }
            stream = acquired;
            const actualFacing = stream.getVideoTracks()[0]?.getSettings?.().facingMode;
            if (photos.length && actualFacing && actualFacing !== facing) {
                throw new DOMException('The other camera is unavailable.', 'NotReadableError');
            }
            // A webcam that does not report its facing is treated as the one asked for.
            mirrored = actualFacing ? actualFacing === 'user' : facing === 'user';
            video.classList.toggle('mirrored', mirrored);
            video.srcObject = stream;
            await video.play();
            if (requestGeneration !== generation || !opened) return;
            message.textContent = '';
            shutter.disabled = false;
            $('[data-camera-flip]').disabled = false;
            readCapabilities();
            lowLight = false;
            sampleLight();
            lightTimer = setInterval(sampleLight, 1200);
            startOverlay();
            stream.getVideoTracks()[0]?.addEventListener('ended', () => {
                if (requestGeneration !== generation) return;
                stop(); failure('Camera disconnected. Try again or choose a photo.');
            }, { once: true });
        } catch (error) {
            if (requestGeneration !== generation || !opened) return;
            release();
            failure(error.name === 'NotAllowedError' ? 'Camera access is off. Allow it in your browser settings, then try again.' : 'The camera could not start. Close other camera apps and try again.');
        } finally {
            pending = false;
            if (requestGeneration === generation) clearTimeout(permissionTimer);
        }
    }

    // A higher-resolution still where the browser offers one (Android
    // Chrome's ImageCapture), otherwise the current video frame.
    async function stillSource() {
        const current = track();
        if (typeof ImageCapture !== 'function' || !current) return null;
        try {
            const imageCapture = new ImageCapture(current);
            const photoCapabilities = await withTimeout(imageCapture.getPhotoCapabilities(), 1500);
            const maxPixels = Number(photoCapabilities?.imageWidth?.max || 0) * Number(photoCapabilities?.imageHeight?.max || 0);
            if (maxPixels < video.videoWidth * video.videoHeight * 1.5) return null;
            const blob = await withTimeout(imageCapture.takePhoto(), 5000);
            const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
            if ((bitmap.width > bitmap.height) !== (video.videoWidth > video.videoHeight)) { bitmap.close(); return null; }
            return bitmap;
        } catch (_) {
            return null;
        }
    }

    async function grabPhoto() {
        const still = await stillSource();
        try {
            const source = still || video;
            const region = still ? stillRegion(still.width, still.height, video.videoWidth, video.videoHeight, aspect) : videoCrop();
            const scale = Math.min(1, maxDimension / Math.max(region.width, region.height));
            const canvas = drawScaled(source, region, region.width * scale, region.height * scale, { mirrored });
            runHook(canvas.getContext('2d'), canvas.width, canvas.height, 'photo');
            compositeLenses(canvas.getContext('2d'), canvas.width, canvas.height);
            const bitmap = await createImageBitmap(canvas);
            canvas.width = canvas.height = 0;
            return bitmap;
        } finally {
            still?.close();
        }
    }

    async function insetPreview(bitmap) {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 360 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
        return blob ? URL.createObjectURL(blob) : null;
    }

    async function capture() {
        if (busy || rec || !stream || !video.videoWidth || !video.videoHeight) return;
        busy = true;
        shutter.disabled = true;
        const captureGeneration = generation;
        let bitmap = null;
        const flash = flashWanted() && flashAvailable();
        try {
            if (flash && mirrored) await showScreenFlash();
            else if (flash) { await setTorch(true); await wait(350); }
            if (captureGeneration !== generation || !opened) return;
            bitmap = await grabPhoto();
        } catch {
            if (captureGeneration === generation && opened) failure('That photo could not be captured. Please try again.');
        } finally {
            hideScreenFlash();
            if (flash && !mirrored) void setTorch(false);
        }
        try {
            if (!bitmap) return;
            if (captureGeneration !== generation || !opened) { bitmap.close(); return; }
            photos.push(bitmap);
            if (singlePhoto || photos.length === 2) return finish();
            insetURL = await insetPreview(photos[0]);
            if (insetURL) { $('img').src = insetURL; $('img').hidden = false; }
            $('[data-camera-single]').hidden = false;
            facing = facing === 'environment' ? 'user' : 'environment';
            // iOS uses one shutter for both views. Web captures them sequentially,
            // retaining the explicit one-photo fallback if the second camera fails.
            busy = false;
            await start();
            if (stream && opened && photos.length === 1) await capture();
        } catch {
            if (captureGeneration === generation && opened) failure('That photo could not be captured. Please try again.');
        } finally { busy = false; if (stream && opened && !rec) shutter.disabled = false; }
    }

    // Hold-to-record (iOS: 260 ms hold, slide left 76 pt onto the lock).
    function cancelPress() {
        if (!press) return;
        clearTimeout(press.timer);
        press = null;
    }
    function renderRecording() {
        container.classList.toggle('is-recording', Boolean(rec));
        container.classList.toggle('is-record-locked', Boolean(rec?.locked));
        shutter.setAttribute('aria-label', rec ? 'Stop recording' : 'Take photo');
        $('.live-camera-lock').hidden = !rec || rec.locked;
        $('.live-camera-timer').hidden = !rec;
        $('[data-camera-library]').classList.toggle('recording-hidden', Boolean(rec));
        $('[data-camera-flip]').classList.toggle('recording-hidden', Boolean(rec));
        renderZoom();
        renderFlash();
    }
    function updateLock(progress) {
        setRuntimeStyles($('.live-camera-lock'), { opacity: String(0.55 + progress * 0.45), transform: `translateX(${-progress * 8}px) scale(${1 + progress * 0.18})` });
    }
    async function startRecording() {
        const mimeType = supportedVideoRecordingType();
        const limit = recording?.limitFor?.(mimeType) || 0;
        if (!mimeType || !limit || rec || busy || !stream || !video.videoWidth) return;
        busy = true;
        const recordingGeneration = generation;
        let audio = null;
        try {
            audio = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
            if (recordingGeneration !== generation || !opened || !press) { audio?.getTracks().forEach(item => item.stop()); return; }
            const crop = videoCrop();
            const scale = Math.min(1, 1280 / Math.max(crop.width, crop.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(crop.width * scale / 2) * 2; canvas.height = Math.round(crop.height * scale / 2) * 2;
            const context = canvas.getContext('2d', { alpha: false });
            const draw = () => {
                if (!rec || rec.canvas !== canvas) return;
                context.save();
                if (mirrored) { context.translate(canvas.width, 0); context.scale(-1, 1); }
                const current = videoCrop();
                context.drawImage(video, current.x, current.y, current.width, current.height, 0, 0, canvas.width, canvas.height);
                context.restore();
                runHook(context, canvas.width, canvas.height, 'recording');
                compositeLenses(context, canvas.width, canvas.height);
                if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(draw);
                else requestAnimationFrame(draw);
            };
            const output = canvas.captureStream(30);
            audio?.getAudioTracks().forEach(item => output.addTrack(item));
            const recorder = new MediaRecorder(output, { mimeType, videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 });
            // The last chunk arrives after stop(), when `rec` is already cleared.
            const chunks = [];
            rec = { recorder, canvas, output, audio, mimeType, limit, chunks, startedAt: performance.now(), locked: false, poster: null, timer: null, stopped: null, hasAudio: Boolean(audio) };
            recorder.addEventListener('dataavailable', event => { if (event.data?.size) chunks.push(event.data); });
            rec.stopped = new Promise(resolve => recorder.addEventListener('stop', resolve, { once: true }));
            draw();
            recorder.start(1000);
            if (flashWanted() && !mirrored) void setTorch(true);
            rec.timer = setInterval(tickRecording, 100);
            setTimeout(() => {
                if (!rec || rec.canvas !== canvas) return;
                const poster = drawScaled(canvas, { x: 0, y: 0, width: canvas.width, height: canvas.height }, canvas.width * Math.min(1, 960 / Math.max(canvas.width, canvas.height)), canvas.height * Math.min(1, 960 / Math.max(canvas.width, canvas.height)));
                poster.toBlob(blob => { if (rec?.canvas === canvas && blob) rec.poster = blob; poster.width = poster.height = 0; }, 'image/jpeg', 0.8);
            }, 250);
            tickRecording();
            renderRecording();
            updateLock(0);
            if (!audio) message.textContent = 'Microphone unavailable. Recording without sound.';
        } catch (error) {
            audio?.getTracks().forEach(item => item.stop());
            rec = null;
            renderRecording();
            message.textContent = 'Video recording could not start. Take a photo instead.';
        } finally {
            busy = false;
        }
    }
    function tickRecording() {
        if (!rec) return;
        const elapsed = performance.now() - rec.startedAt;
        $('.live-camera-timer').textContent = `${(Math.min(elapsed, rec.limit) / 1000).toFixed(1)} / ${Math.round(rec.limit / 1000)}`;
        if (elapsed >= rec.limit) void stopRecording();
    }
    async function stopRecording({ discard = false } = {}) {
        const current = rec;
        if (!current) return;
        rec = null;
        clearInterval(current.timer);
        const durationMs = Math.round(Math.min(current.limit, performance.now() - current.startedAt));
        if (current.recorder.state !== 'inactive') current.recorder.stop();
        await current.stopped;
        current.output.getTracks().forEach(item => item.stop());
        current.audio?.getTracks().forEach(item => item.stop());
        if (!mirrored) void setTorch(false);
        current.canvas.width = current.canvas.height = 0;
        renderRecording();
        if (message.textContent.startsWith('Microphone')) message.textContent = '';
        if (discard || !opened) return;
        if (durationMs < 500 || !current.chunks.length) { message.textContent = 'Hold longer to record a video.'; setTimeout(() => { if (message.textContent.startsWith('Hold')) message.textContent = ''; }, 2000); return; }
        const type = current.mimeType.split(';')[0];
        const file = new File(current.chunks, type === 'video/mp4' ? 'recording.mp4' : 'recording.webm', { type, lastModified: Date.now() });
        const poster = current.poster ? new File([current.poster], 'chat-video-thumbnail.jpg', { type: 'image/jpeg', lastModified: Date.now() }) : null;
        close();
        recording?.onRecorded?.({ file, durationMs, poster, mimeType: current.mimeType, mirrored, hasAudio: current.hasAudio });
    }

    shutter.addEventListener('pointerdown', event => {
        if (event.button !== 0 || shutter.disabled) return;
        event.preventDefault();
        try { shutter.setPointerCapture(event.pointerId); } catch (_) { /* synthetic pointers */ }
        if (rec) { press = { id: event.pointerId, stopOnRelease: true, x: event.clientX, y: event.clientY }; return; }
        if (busy || !stream) return;
        press = { id: event.pointerId, x: event.clientX, y: event.clientY, recording: false, zoomStart: zoom };
        container.classList.add('is-pressing');
        if (recordingAllowed()) {
            press.timer = setTimeout(() => {
                if (!press || press.id !== event.pointerId) return;
                press.recording = true;
                feedback('light');
                void startRecording();
            }, HOLD_TO_RECORD_MS);
        }
    });
    shutter.addEventListener('pointermove', event => {
        if (!press || press.id !== event.pointerId || !rec || rec.locked || press.stopOnRelease) return;
        const progress = Math.min(1, Math.max(0, -(event.clientX - press.x) / RECORD_LOCK_TRAVEL));
        if (progress >= 1) {
            rec.locked = true;
            feedback('medium');
            renderRecording();
        } else updateLock(progress);
        // Slide up to zoom in, down to zoom out, on a geometric curve.
        const range = zoomRange();
        if (range) setZoom(press.zoomStart * (range.max / range.min) ** (-(event.clientY - press.y) / SHUTTER_ZOOM_TRAVEL));
    });
    function releaseShutter(event, cancelled) {
        if (!press || press.id !== event.pointerId) return;
        const current = press;
        cancelPress();
        container.classList.remove('is-pressing');
        if (current.stopOnRelease) { void stopRecording(); return; }
        if (current.recording) {
            if (rec?.locked) return;
            void stopRecording({ discard: false });
            return;
        }
        if (!cancelled) void capture();
    }
    shutter.addEventListener('pointerup', event => releaseShutter(event, false));
    shutter.addEventListener('pointercancel', event => releaseShutter(event, !rec?.locked));
    // Keyboard and assistive activation: a click with no pointer sequence.
    shutter.addEventListener('click', event => {
        if (event.detail !== 0) return;
        if (rec) void stopRecording(); else void capture();
    });
    shutter.addEventListener('contextmenu', event => event.preventDefault());

    // Preview gestures: tap to focus, double-tap to flip, pinch to zoom.
    function showFocus(x, y) {
        const indicator = $('.live-camera-focus');
        const bounds = stage.getBoundingClientRect();
        setRuntimeStyles(indicator, { left: `${x - bounds.left}px`, top: `${y - bounds.top}px` });
        indicator.hidden = false;
        indicator.classList.remove('active');
        void indicator.offsetWidth;
        indicator.classList.add('active');
        clearTimeout(indicator.timer);
        indicator.timer = setTimeout(() => { indicator.hidden = true; indicator.classList.remove('active'); }, 900);
        feedback('light');
        const current = track();
        if (!current || !video.videoWidth) return;
        const crop = videoCrop();
        let nx = (x - bounds.left) / bounds.width;
        const ny = (y - bounds.top) / bounds.height;
        if (mirrored) nx = 1 - nx;
        const point = { x: (crop.x + nx * crop.width) / video.videoWidth, y: (crop.y + ny * crop.height) / video.videoHeight };
        const constraint = {};
        if ('pointsOfInterest' in (current.getSettings?.() || {}) || capabilities.pointsOfInterest) constraint.pointsOfInterest = [point];
        const modes = capabilities.focusMode || [];
        if (modes.includes('single-shot')) constraint.focusMode = 'single-shot';
        else if (modes.includes('continuous')) constraint.focusMode = 'continuous';
        const exposure = capabilities.exposureMode || [];
        if (exposure.includes('continuous')) constraint.exposureMode = 'continuous';
        if (Object.keys(constraint).length) current.applyConstraints({ advanced: [constraint] }).catch(() => {});
    }
    function flip() {
        if (busy || pending || rec) return;
        feedback('light');
        facing = facing === 'environment' ? 'user' : 'environment';
        void start();
    }
    stage.addEventListener('pointerdown', event => {
        if (event.target.closest('button') || !stream) return;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, at: performance.now() });
        try { stage.setPointerCapture(event.pointerId); } catch (_) { /* synthetic pointers */ }
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom, active: false };
        }
    });
    stage.addEventListener('pointermove', event => {
        const point = pointers.get(event.pointerId);
        if (!point) return;
        point.x = event.clientX; point.y = event.clientY;
        if (!pinch || pointers.size < 2 || !zoomRange()) return;
        const [a, b] = [...pointers.values()];
        const ratio = Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.distance);
        if (!pinch.active) {
            // A 12% dead zone so an incidental second finger does not zoom.
            if (Math.abs(ratio - 1) < PINCH_DEAD_ZONE) return;
            pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom, active: true };
            return;
        }
        setZoom(pinch.zoom * ratio);
    });
    function endStagePointer(event) {
        const point = pointers.get(event.pointerId);
        if (!point) return;
        pointers.delete(event.pointerId);
        const wasPinch = Boolean(pinch);
        if (pointers.size < 2) pinch = null;
        if (wasPinch || event.type === 'pointercancel' || pointers.size) return;
        if (Math.hypot(event.clientX - point.startX, event.clientY - point.startY) > TAP_TOLERANCE || performance.now() - point.at > 500) return;
        const now = performance.now();
        if (lastTap && now - lastTap.at < DOUBLE_TAP_MS && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 40) {
            lastTap = null;
            flip();
            return;
        }
        lastTap = { at: now, x: event.clientX, y: event.clientY };
        showFocus(event.clientX, event.clientY);
    }
    stage.addEventListener('pointerup', endStagePointer);
    stage.addEventListener('pointercancel', endStagePointer);

    zoomButton.addEventListener('click', () => {
        const range = zoomRange();
        if (!range) return;
        feedback('light');
        setZoom(zoom / range.min < 1.5 ? range.min * 2 : range.min);
    });
    flashButton.addEventListener('click', () => {
        flashMode = flashMode === 'auto' ? 'on' : flashMode === 'on' ? 'off' : 'auto';
        feedback('light');
        renderFlash();
    });

    function close() { opened = false; stop(); clearPhotos(); detachLenses(); container.hidden = true; container.classList.remove('is-pressing'); }
    function finish() {
        if (!photos.length) return;
        const result = photos.slice(0, 2);
        photos = [];
        close();
        onCapture(result);
    }
    function fallback() {
        if ($('[data-camera-library]').hidden) return;
        close(); onFallback();
    }
    $('[data-camera-flip]').addEventListener('click', flip);
    $('[data-camera-retry]').addEventListener('click', () => void start());
    $('[data-camera-single]').addEventListener('click', finish);
    $('[data-camera-library]').addEventListener('click', fallback);
    document.addEventListener('visibilitychange', () => {
        if (!opened || !document.hidden) return;
        stop(); failure('Camera paused while you were away. Tap Try camera again to resume.');
    });
    window.addEventListener('pagehide', () => { if (opened) { stop(); failure('Camera paused. Tap Try camera again to resume.'); } });
    return {
        open() { close(); facing = initialFacing; opened = true; container.hidden = false; refreshHint(); void start(); attachLenses(); },
        close,
        setFrameHook(hook) { frameHook = typeof hook === 'function' ? hook : null; if (frameHook) startOverlay(); else stopOverlay(); },
        get mirrored() { return mirrored; },
        get video() { return video; },
        get recording() { return Boolean(rec); },
    };
}
