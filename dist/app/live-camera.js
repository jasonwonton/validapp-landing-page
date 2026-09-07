import { uiIcon } from './ui-icons.js';

// One live video stream, at most two memory-only photos, no uploads or retries.
export function createLiveCamera({ container, onCapture, onFallback, singlePhoto = false }) {
    container.innerHTML = `<div class="live-camera-stage"><video autoplay muted playsinline aria-label="Live camera preview"></video><img class="live-camera-inset" alt="First captured view" hidden><div class="live-camera-heading"><strong>Memento</strong><span data-camera-step>First view</span></div><div class="live-camera-message" role="status"></div></div><div class="live-camera-controls"><button type="button" data-camera-library aria-label="Choose a photo instead">${uiIcon('photo')}</button><button type="button" class="camera-shutter" data-camera-shutter aria-label="Take photo" disabled><span></span></button><button type="button" data-camera-flip aria-label="Switch front and rear camera" disabled>${uiIcon('flip')}</button></div><p class="live-camera-hint">One tap. Front and back captured in sequence.</p><div class="live-camera-alternatives"><button type="button" data-camera-retry hidden>Try camera again</button><button type="button" data-camera-single hidden>Use one photo</button></div>`;
    const $ = selector => container.querySelector(selector);
    const video = $('video'), message = $('.live-camera-message');
    if (singlePhoto) {
        $('.live-camera-heading strong').textContent = 'Photo';
        $('.live-camera-hint').textContent = 'Tap to take a photo';
        $('[data-camera-library]').setAttribute('aria-label', 'Photo library');
    }
    let stream = null, generation = 0, pending = false, busy = false, opened = false;
    let facing = 'environment', photos = [], insetURL = null, permissionTimer = null;
    function release() {
        stream?.getTracks().forEach(track => track.stop());
        stream = null; video.srcObject = null;
        clearTimeout(permissionTimer);
        $('[data-camera-shutter]').disabled = true;
        $('[data-camera-flip]').disabled = true;
    }
    function stop() { generation++; busy = false; release(); }
    function clearPhotos() {
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
    async function start() {
        if (!opened) return;
        if (document.hidden) return failure('Camera paused. Tap Try camera again when you return.');
        if (pending) return failure('Respond to the camera permission prompt first, then try again.');
        stop();
        const requestGeneration = generation;
        message.textContent = 'Starting camera…';
        $('[data-camera-retry]').hidden = true;
        $('[data-camera-library]').hidden = !singlePhoto;
        if (!navigator.mediaDevices?.getUserMedia) return failure('Live capture is unavailable here. Open in a supported browser or choose a photo.');
        pending = true;
        permissionTimer = setTimeout(() => {
            if (generation === requestGeneration && opened) failure('Allow camera access in your browser to take a photo.');
        }, 10_000);
        try {
            const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1440, max: 1920 }, height: { ideal: 1920, max: 1920 } } });
            if (requestGeneration !== generation || !opened || document.hidden) { acquired.getTracks().forEach(track => track.stop()); return; }
            stream = acquired;
            const actualFacing = stream.getVideoTracks()[0]?.getSettings?.().facingMode;
            if (photos.length && actualFacing && actualFacing !== facing) {
                throw new DOMException('The other camera is unavailable.', 'NotReadableError');
            }
            video.classList.toggle('mirrored', actualFacing === 'user');
            video.srcObject = stream;
            await video.play();
            if (requestGeneration !== generation || !opened) return;
            message.textContent = '';
            $('[data-camera-step]').textContent = singlePhoto ? (actualFacing === 'user' ? 'Front camera' : 'Rear camera') : `${photos.length ? 'Second' : 'First'} view${actualFacing ? ` · ${actualFacing === 'user' ? 'Front' : 'Rear'} camera` : ''}`;
            $('[data-camera-shutter]').disabled = false;
            $('[data-camera-flip]').disabled = false;
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
    async function capture() {
        if (busy || !stream || !video.videoWidth || !video.videoHeight) return;
        busy = true;
        $('[data-camera-shutter]').disabled = true;
        const captureGeneration = generation;
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 1080; canvas.height = 1440;
            const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
            canvas.getContext('2d').drawImage(video, (canvas.width - video.videoWidth * scale) / 2, (canvas.height - video.videoHeight * scale) / 2, video.videoWidth * scale, video.videoHeight * scale);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
            canvas.width = canvas.height = 0;
            if (captureGeneration !== generation || !opened) return;
            if (!blob) throw new Error('No image');
            photos.push(new File([blob], singlePhoto ? 'chat-photo.jpg' : `memento-view-${photos.length + 1}.jpg`, { type: 'image/jpeg' }));
            if (singlePhoto || photos.length === 2) return finish();
            insetURL = URL.createObjectURL(photos[0]); $('img').src = insetURL; $('img').hidden = false;
            $('[data-camera-single]').hidden = false;
            facing = facing === 'environment' ? 'user' : 'environment';
            // iOS uses one shutter for both views. Web captures them sequentially,
            // retaining the explicit one-photo fallback if the second camera fails.
            await start();
            if (stream && opened && photos.length === 1) await capture();
        } catch {
            if (captureGeneration === generation && opened) failure('That photo could not be captured. Please try again.');
        } finally { busy = false; if (stream && opened) $('[data-camera-shutter]').disabled = false; }
    }
    function close() { opened = false; stop(); clearPhotos(); container.hidden = true; }
    function finish() { if (!photos.length) return; const result = photos.slice(0, 2); close(); onCapture(result); }
    function fallback() {
        if ($('[data-camera-library]').hidden) return;
        close(); onFallback();
    }
    $('[data-camera-shutter]').addEventListener('click', capture);
    $('[data-camera-flip]').addEventListener('click', () => { if (busy || pending) return; facing = facing === 'environment' ? 'user' : 'environment'; void start(); });
    $('[data-camera-retry]').addEventListener('click', () => void start());
    $('[data-camera-single]').addEventListener('click', finish);
    $('[data-camera-library]').addEventListener('click', fallback);
    document.addEventListener('visibilitychange', () => {
        if (!opened || !document.hidden) return;
        stop(); failure('Camera paused while you were away. Tap Try camera again to resume.');
    });
    window.addEventListener('pagehide', () => { if (opened) { stop(); failure('Camera paused. Tap Try camera again to resume.'); } });
    return { open() { close(); facing = 'environment'; opened = true; container.hidden = false; void start(); }, close };
}
