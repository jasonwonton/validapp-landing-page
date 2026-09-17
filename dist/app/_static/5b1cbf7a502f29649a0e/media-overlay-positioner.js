import { setRuntimeStyles } from "./runtime-style.js";

const MIN_POSITION = 0.08;
const MAX_POSITION = 0.92;
const KEYBOARD_STEP = 0.02;
const LARGE_KEYBOARD_STEP = 0.1;

function clampPosition(value) {
    return Math.max(MIN_POSITION, Math.min(MAX_POSITION, Number(value) || 0.5));
}

function roundedPosition(value) {
    return Math.round(clampPosition(value) * 1_000) / 1_000;
}

export function createMediaOverlayPositioner({ preview, input }) {
    let position = { x: 0.5, y: 0.5 };
    let activePointerId = null;
    let disabled = false;

    const handle = () => preview.querySelector("[data-media-overlay-position]");
    const hasPreviewMedia = () => Boolean(preview.querySelector("img, video"));

    function updateAccessibleLabel(node) {
        node.setAttribute(
            "aria-label",
            `Position text overlay. ${Math.round(position.x * 100)}% from left, ${Math.round(position.y * 100)}% from top. Drag or use arrow keys; press Home to center.`,
        );
    }

    function paint() {
        const text = input.value.trim();
        let node = handle();
        if (!text || !hasPreviewMedia()) {
            node?.remove();
            return;
        }
        if (!node) {
            node = document.createElement("button");
            node.type = "button";
            node.className = "media-overlay-positioner";
            node.dataset.mediaOverlayPosition = "";
            preview.append(node);
        }
        node.textContent = text;
        node.disabled = disabled;
        updateAccessibleLabel(node);
        setRuntimeStyles(node, {
            left: `${position.x * 100}%`,
            top: `${position.y * 100}%`,
        });
    }

    function setPosition(x, y) {
        position = { x: roundedPosition(x), y: roundedPosition(y) };
        paint();
    }

    function updateFromPointer(event) {
        const bounds = preview.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        setPosition(
            (event.clientX - bounds.left) / bounds.width,
            (event.clientY - bounds.top) / bounds.height,
        );
    }

    input.addEventListener("input", paint);
    preview.addEventListener("pointerdown", (event) => {
        const node = event.target.closest("[data-media-overlay-position]");
        if (!node || node.disabled || event.button !== 0) return;
        event.preventDefault();
        activePointerId = event.pointerId;
        try {
            node.setPointerCapture?.(event.pointerId);
        } catch (_) {
            // Synthetic accessibility tests and older engines may not expose an
            // active native pointer; preview-level move events still work.
        }
        updateFromPointer(event);
    });
    preview.addEventListener("pointermove", (event) => {
        if (event.pointerId !== activePointerId) return;
        event.preventDefault();
        updateFromPointer(event);
    });
    const finishPointer = (event) => {
        if (event.pointerId !== activePointerId) return;
        activePointerId = null;
    };
    preview.addEventListener("pointerup", finishPointer);
    preview.addEventListener("pointercancel", finishPointer);
    preview.addEventListener("keydown", (event) => {
        const node = event.target.closest("[data-media-overlay-position]");
        if (!node || node.disabled) return;
        if (event.key === "Home") {
            event.preventDefault();
            setPosition(0.5, 0.5);
            return;
        }
        const step = event.shiftKey ? LARGE_KEYBOARD_STEP : KEYBOARD_STEP;
        const movement = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
        }[event.key];
        if (!movement) return;
        event.preventDefault();
        setPosition(position.x + movement[0], position.y + movement[1]);
    });

    return {
        mount: paint,
        reset() {
            activePointerId = null;
            disabled = false;
            position = { x: 0.5, y: 0.5 };
            handle()?.remove();
        },
        setDisabled(value) {
            disabled = Boolean(value);
            paint();
        },
        value() {
            return { ...position };
        },
    };
}
