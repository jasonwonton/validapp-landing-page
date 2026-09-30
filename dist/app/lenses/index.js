// Face lenses for the live camera, loaded on demand when a camera opens.
// attachCameraLenses() is the whole integration: an overlay canvas redrawn
// every animation frame, the carousel, preview swipes, and composite() for
// the captured photo. Nothing here touches the camera stream itself.
import { createLensEngine, lensSupport } from './engine.js';
import { createLensCarousel } from './carousel.js';
import { LENSES, ORIGINAL_LENS } from './catalog.js';

export { createLensEngine, createLensCarousel, lensSupport, LENSES };

const cssURL = new URL('./styles.css', import.meta.url).href;
function ensureStyles() {
    if (document.querySelector('link[data-lens-css]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = cssURL; link.dataset.lensCss = '';
    document.head.append(link);
}

// The last lens stays selected when the camera reopens in this session.
let lastLensId = ORIGINAL_LENS.id;

export function attachCameraLenses({ stage, video, isMirrored = () => video.classList.contains('mirrored'), framing = () => 1, engineOptions = {} }) {
    ensureStyles();
    const canvas = document.createElement('canvas');
    canvas.className = 'lens-overlay';
    canvas.setAttribute('aria-hidden', 'true');
    video.after(canvas);
    const slot = document.createElement('div');
    slot.className = 'lens-carousel-slot';
    stage.append(slot);
    const ctx = canvas.getContext('2d');
    const engine = createLensEngine({ video, ...engineOptions });
    let frame = null, drawn = false, destroyed = false, shownLenses = null;

    const carousel = createLensCarousel({
        container: slot, lenses: engine.lenses, selected: lastLensId, swipeTarget: stage,
        onSelect: id => { lastLensId = id; void engine.setLens(id); },
    });

    function size() {
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        const width = Math.round(stage.clientWidth * ratio), height = Math.round(stage.clientHeight * ratio);
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; drawn = false; }
    }
    function tick(timestamp) {
        frame = requestAnimationFrame(tick);
        size();
        if (drawn) ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawn = engine.render(ctx, canvas.width, canvas.height, { mirrored: isMirrored(), framing: framing(), timestamp });
    }
    function loop(run) {
        if (run && frame === null && !destroyed) frame = requestAnimationFrame(tick);
        if (!run && frame !== null) {
            cancelAnimationFrame(frame); frame = null;
            if (drawn) ctx.clearRect(0, 0, canvas.width, canvas.height);
            drawn = false;
        }
    }

    engine.subscribe(({ state, lenses, selected, pending }) => {
        if (destroyed) return;
        if (lenses !== shownLenses) { shownLenses = lenses; carousel.setLenses(lenses); }
        // No lenses at all (unsupported, too slow, or the model failed):
        // the camera is simply the plain camera again.
        slot.hidden = state === 'unavailable';
        if (state === 'unavailable') lastLensId = ORIGINAL_LENS.id;
        carousel.setSelected(pending ?? selected);
        carousel.setLoading(state === 'loading', state === 'loading' || pending ? (pending ?? null) : null);
        loop(selected !== ORIGINAL_LENS.id);
    });
    if (lastLensId !== ORIGINAL_LENS.id) void engine.setLens(lastLensId);

    const controller = {
        engine, carousel,
        /** Draw the lens onto a captured frame. `ctx` must hold the video
         * drawn with object-fit: cover into width x height; pass `mirrored`
         * and `framing` exactly as that frame was drawn. */
        composite(context, width, height, { mirrored = false, framing = 1 } = {}) {
            return engine.render(context, width, height, { mirrored, framing, timestamp: performance.now(), analyze: false });
        },
        destroy() {
            destroyed = true; loop(false);
            engine.destroy(); carousel.destroy();
            canvas.remove(); slot.remove();
            if (stage.cameraLenses === controller) delete stage.cameraLenses;
        },
    };
    // Diagnostics and tests reach the live controller from the stage.
    stage.cameraLenses = controller;
    return controller;
}
