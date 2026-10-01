// Full-screen media gestures, after iOS ChatMediaViewer: drag down to dismiss
// (the media shrinks, rounds, tilts and the backdrop fades; past 110 px, or a
// fast flick, it flies off), pinch 1–5×, double-tap to zoom, pan while zoomed.
// Loaded on demand the first time the viewer opens.
import { setRuntimeStyles } from "../runtime-style.js";

const DISMISS_DISTANCE = 110;
const DISMISS_PREDICTED = 220;
const MAX_ZOOM = 5;
const DOUBLE_TAP_ZOOM = 2.5;

export function bindViewerGestures({ dialog, stage, target, onDismiss, canZoom = () => true, canDismiss = () => true, onDismissStart }) {
    const pointers = new Map();
    let zoom = 1, panX = 0, panY = 0;
    let drag = null, pinch = null, lastTap = null, dismissing = false;
    const reduceMotion = () => matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    function media() { return target(); }
    function apply({ dismissX = 0, dismissY = 0, transition = false } = {}) {
        const element = media();
        if (!element) return;
        const progress = Math.min(Math.max(dismissY / 220, 0), 1);
        const scale = zoom * (1 - progress * 0.28);
        const radius = progress > 0 ? 44 * progress ** 0.45 : 0;
        const rotate = dismissX / 90;
        setRuntimeStyles(element, {
            transition: transition && !reduceMotion() ? "transform .34s cubic-bezier(.2,.9,.3,1.12)" : "none",
            transform: `translate(${panX + dismissX}px, ${panY + dismissY}px) rotate(${rotate}deg) scale(${scale})`,
            "--chat-viewer-radius": `${radius}px`,
        });
        setRuntimeStyles(dialog, { "--chat-viewer-backdrop": String(1 - progress) });
        dialog.classList.toggle("is-zoomed", zoom > 1.01);
        dialog.classList.toggle("is-dragging", progress > 0);
    }

    function clampPan() {
        const box = stage.getBoundingClientRect();
        const limitX = Math.max(0, (box.width / (zoom || 1)) * (zoom - 1) / 2);
        const limitY = Math.max(0, (box.height / (zoom || 1)) * (zoom - 1) / 2);
        panX = Math.max(-limitX, Math.min(limitX, panX));
        panY = Math.max(-limitY, Math.min(limitY, panY));
    }

    function zoomAround(nextZoom, clientX, clientY) {
        const box = stage.getBoundingClientRect();
        const next = Math.max(1, Math.min(MAX_ZOOM, nextZoom));
        const centerX = box.left + box.width / 2, centerY = box.top + box.height / 2;
        const ratio = next / zoom;
        panX = (panX - (clientX - centerX)) * ratio + (clientX - centerX);
        panY = (panY - (clientY - centerY)) * ratio + (clientY - centerY);
        zoom = next;
        if (zoom <= 1.01) { zoom = 1; panX = 0; panY = 0; }
        clampPan();
    }

    function reset() {
        pointers.clear();
        zoom = 1; panX = 0; panY = 0; drag = null; pinch = null; lastTap = null; dismissing = false;
        apply();
    }

    function finishDismiss(dx) {
        dismissing = true;
        onDismissStart?.();
        const height = Math.max(innerHeight, 900) + 120;
        apply({ dismissX: dx * 0.35, dismissY: height, transition: true });
        setTimeout(() => { onDismiss(); reset(); }, reduceMotion() ? 0 : 200);
    }

    stage.addEventListener("pointerdown", (event) => {
        if (dismissing || event.button > 0 || event.target.closest("button")) return;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        try { stage.setPointerCapture(event.pointerId); } catch (_) { /* Pointer may already be gone. */ }
        if (pointers.size === 2 && canZoom()) {
            const [a, b] = [...pointers.values()];
            pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            drag = null;
        } else if (pointers.size === 1) {
            drag = { x: event.clientX, y: event.clientY, panX, panY, at: performance.now(), lastY: event.clientY, lastAt: performance.now(), velocity: 0, active: false };
        }
    });

    stage.addEventListener("pointermove", (event) => {
        if (!pointers.has(event.pointerId) || dismissing) return;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pinch && pointers.size >= 2) {
            const [a, b] = [...pointers.values()];
            const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
            zoomAround(pinch.zoom * distance / pinch.distance, midX, midY);
            panX += midX - pinch.x; panY += midY - pinch.y;
            pinch.x = midX; pinch.y = midY;
            clampPan();
            apply();
            return;
        }
        if (!drag) return;
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        const now = performance.now();
        drag.velocity = (event.clientY - drag.lastY) / Math.max(1, now - drag.lastAt);
        drag.lastY = event.clientY; drag.lastAt = now;
        if (zoom > 1) {
            panX = drag.panX + dx; panY = drag.panY + dy;
            clampPan();
            apply();
            return;
        }
        if (!drag.active && Math.hypot(dx, dy) < 12) return;
        if (!drag.active && (dy <= 0 || !canDismiss())) { drag = null; return; }
        drag.active = true;
        apply({ dismissX: dx, dismissY: Math.max(0, dy) });
    });

    function release(event) {
        if (!pointers.has(event.pointerId)) return;
        pointers.delete(event.pointerId);
        if (pinch) {
            if (pointers.size < 2) pinch = null;
            if (!pointers.size) apply({ transition: true });
            return;
        }
        const current = drag;
        drag = null;
        if (!current || dismissing) return;
        const dx = event.clientX - current.x, dy = event.clientY - current.y;
        if (current.active) {
            // A flick counts only if the finger was still moving when it lifted.
            const velocity = performance.now() - current.lastAt < 100 ? current.velocity : 0;
            const predicted = dy + velocity * 250;
            if (event.type !== "pointercancel" && (dy > DISMISS_DISTANCE || predicted > DISMISS_PREDICTED)) finishDismiss(dx);
            else apply({ transition: true });
            return;
        }
        if (event.type === "pointercancel" || Math.hypot(dx, dy) > 12 || performance.now() - current.at > 300) return;
        // Mouse double-clicks arrive as `dblclick`; touch and pen taps are paired here.
        if (event.pointerType === "mouse") return;
        const now = performance.now();
        if (lastTap && now - lastTap.at < 300 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 30) {
            lastTap = null;
            toggleZoom(event.clientX, event.clientY);
        } else lastTap = { at: now, x: event.clientX, y: event.clientY };
    }
    function toggleZoom(x, y) {
        if (!canZoom() || dismissing) return;
        if (zoom > 1) { zoom = 1; panX = 0; panY = 0; }
        else zoomAround(DOUBLE_TAP_ZOOM, x, y);
        apply({ transition: true });
    }
    // A mouse drag on an <img> would otherwise start a native drag and cancel the pointer.
    stage.addEventListener("dragstart", (event) => event.preventDefault());
    stage.addEventListener("dblclick", (event) => { event.preventDefault(); toggleZoom(event.clientX, event.clientY); });
    stage.addEventListener("pointerup", release);
    stage.addEventListener("pointercancel", release);

    // Trackpad pinch arrives as ctrl+wheel on desktop browsers.
    stage.addEventListener("wheel", (event) => {
        if (!event.ctrlKey || !canZoom()) return;
        event.preventDefault();
        zoomAround(zoom * Math.exp(-event.deltaY / 100), event.clientX, event.clientY);
        apply();
    }, { passive: false });

    return { reset, get zoomed() { return zoom > 1.01; }, get busy() { return dismissing || pointers.size > 0; } };
}
