// Circle crop for profile photos, loaded on demand. Mirrors ImageCropperView.swift
// (.circle): the photo fills the crop circle, pinch or wheel zooms 1-4x, drag
// pans, both are clamped so the circle is always covered. The result follows
// APIClient+Users.swift prepareProfilePictureUploadData: at most 1024 px,
// white-backed JPEG at quality 0.82.
import { setRuntimeStyles } from "./runtime-style.js";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const OUTPUT_MAX = 1024;
const JPEG_QUALITY = 0.82;

function ensureStylesheet() {
    if (document.querySelector("link[data-avatar-crop-styles]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("./avatar-crop.css", import.meta.url).href;
    link.dataset.avatarCropStyles = "";
    document.head.append(link);
}

async function decodeImage(file) {
    const url = URL.createObjectURL(file);
    try {
        const image = new Image();
        image.decoding = "async";
        image.src = url;
        await image.decode();
        if (!image.naturalWidth || !image.naturalHeight) throw new Error("decode-failed");
        return { image, url };
    } catch (error) {
        URL.revokeObjectURL(url);
        throw Object.assign(new Error("That photo format could not be opened. Choose a JPEG or PNG."), { cause: error, code: "decode-failed" });
    }
}

function element(tag, className, attributes = {}) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
}

/** Resize an already square-cropped or arbitrary image to the iOS upload format. */
export function renderAvatarJPEG(source, sx, sy, size) {
    const output = Math.max(1, Math.min(OUTPUT_MAX, Math.round(size)));
    const canvas = document.createElement("canvas");
    canvas.width = output;
    canvas.height = output;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, output, output);
    context.imageSmoothingQuality = "high";
    context.drawImage(source, sx, sy, size, size, 0, 0, output, output);
    return new Promise((resolve, reject) => canvas.toBlob(
        (blob) => blob ? resolve(new File([blob], "profile-photo.jpg", { type: "image/jpeg" })) : reject(new Error("Could not prepare that photo.")),
        "image/jpeg",
        JPEG_QUALITY,
    ));
}

/**
 * Show the crop sheet for `file`. Resolves with a JPEG File, or null when the
 * person cancels. Rejects with a readable message when the file cannot be decoded.
 */
export async function cropAvatar(file, { title = "Adjust photo", instructions = "Pinch to zoom and drag to reposition." } = {}) {
    ensureStylesheet();
    const { image, url } = await decodeImage(file);
    const dialog = element("dialog", "avatar-crop-dialog", { "aria-labelledby": "avatarCropTitle" });
    const stage = element("div", "avatar-crop-stage");
    const photo = element("img", "avatar-crop-image", { alt: "Photo being cropped", draggable: "false" });
    photo.src = url;
    const ring = element("span", "avatar-crop-ring", { "aria-hidden": "true" });
    stage.append(photo, ring);
    const header = element("header", "avatar-crop-header");
    const cancel = element("button", "avatar-crop-cancel", { type: "button", "aria-label": "Cancel" });
    cancel.textContent = "×";
    const heading = element("h2", "", { id: "avatarCropTitle" });
    heading.textContent = title;
    header.append(cancel, heading, element("span", "", { "aria-hidden": "true" }));
    const footer = element("footer", "avatar-crop-footer");
    const hint = element("p");
    hint.textContent = instructions;
    const zoomLabel = element("label", "avatar-crop-zoom");
    const zoomText = element("span", "visually-hidden");
    zoomText.textContent = "Zoom";
    const zoom = element("input", "", { type: "range", min: String(MIN_ZOOM), max: String(MAX_ZOOM), step: "0.01", value: "1" });
    zoomLabel.append(zoomText, zoom);
    const use = element("button", "avatar-crop-use", { type: "button" });
    use.textContent = "Use photo";
    footer.append(hint, zoomLabel, use);
    dialog.append(stage, header, footer);
    document.body.append(dialog);

    const view = { scale: 1, x: 0, y: 0 };
    const pointers = new Map();
    let gesture = null;

    const geometry = () => {
        const box = Math.max(120, Math.min(stage.clientWidth, stage.clientHeight) - 48);
        const aspect = image.naturalWidth / image.naturalHeight;
        const baseWidth = aspect >= 1 ? box * aspect : box;
        const baseHeight = aspect >= 1 ? box : box / aspect;
        return { box, baseWidth, baseHeight };
    };
    const clamp = () => {
        const { box, baseWidth, baseHeight } = geometry();
        view.scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.scale));
        const maxX = Math.max(0, (baseWidth * view.scale - box) / 2);
        const maxY = Math.max(0, (baseHeight * view.scale - box) / 2);
        view.x = Math.min(maxX, Math.max(-maxX, view.x));
        view.y = Math.min(maxY, Math.max(-maxY, view.y));
    };
    const render = () => {
        clamp();
        const { box, baseWidth, baseHeight } = geometry();
        setRuntimeStyles(photo, {
            width: `${baseWidth}px`,
            height: `${baseHeight}px`,
            transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        });
        setRuntimeStyles(ring, { width: `${box}px`, height: `${box}px` });
        zoom.value = String(view.scale);
    };

    const distance = () => {
        const [a, b] = [...pointers.values()];
        return Math.hypot(a.x - b.x, a.y - b.y) || 1;
    };
    stage.addEventListener("pointerdown", (event) => {
        stage.setPointerCapture?.(event.pointerId);
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        gesture = pointers.size >= 2
            ? { pinch: distance(), scale: view.scale, x: view.x, y: view.y }
            : { startX: event.clientX, startY: event.clientY, x: view.x, y: view.y };
    });
    stage.addEventListener("pointermove", (event) => {
        if (!pointers.has(event.pointerId) || !gesture) return;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (gesture.pinch && pointers.size >= 2) view.scale = gesture.scale * (distance() / gesture.pinch);
        else if (!gesture.pinch) {
            view.x = gesture.x + event.clientX - gesture.startX;
            view.y = gesture.y + event.clientY - gesture.startY;
        }
        render();
    });
    const release = (event) => {
        pointers.delete(event.pointerId);
        const remaining = [...pointers.values()][0];
        gesture = remaining ? { startX: remaining.x, startY: remaining.y, x: view.x, y: view.y } : null;
    };
    stage.addEventListener("pointerup", release);
    stage.addEventListener("pointercancel", release);
    // A release outside the stage (or the window) must not leave a drag, and its
    // pointer capture, behind: that would swallow the next tap on Use photo.
    stage.addEventListener("lostpointercapture", release);
    const releaseAnywhere = (event) => { if (pointers.has(event.pointerId)) { stage.releasePointerCapture?.(event.pointerId); release(event); } };
    addEventListener("pointerup", releaseAnywhere, true);
    stage.addEventListener("wheel", (event) => {
        event.preventDefault();
        view.scale *= Math.exp(-event.deltaY / 300);
        render();
    }, { passive: false });
    zoom.addEventListener("input", () => { view.scale = Number(zoom.value); render(); });
    dialog.addEventListener("keydown", (event) => {
        const step = event.shiftKey ? 24 : 8;
        const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
        if (!moves[event.key] || event.target === zoom) return;
        event.preventDefault();
        view.x += moves[event.key][0];
        view.y += moves[event.key][1];
        render();
    });
    const resize = () => render();
    addEventListener("resize", resize);

    const crop = () => {
        clamp();
        const { box, baseWidth } = geometry();
        const pixelsPerPoint = image.naturalWidth / (baseWidth * view.scale);
        const size = box * pixelsPerPoint;
        const sx = Math.min(image.naturalWidth - size, Math.max(0, (image.naturalWidth - size) / 2 - view.x * pixelsPerPoint));
        const sy = Math.min(image.naturalHeight - size, Math.max(0, (image.naturalHeight - size) / 2 - view.y * pixelsPerPoint));
        return renderAvatarJPEG(image, sx, sy, size);
    };

    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (value, error) => {
            if (settled) return;
            settled = true;
            removeEventListener("resize", resize);
            removeEventListener("pointerup", releaseAnywhere, true);
            if (dialog.open) dialog.close();
            dialog.remove();
            URL.revokeObjectURL(url);
            if (error) reject(error);
            else resolve(value);
        };
        cancel.addEventListener("click", () => finish(null));
        dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(null); });
        use.addEventListener("click", async () => {
            use.disabled = true;
            try { finish(await crop()); }
            catch (error) { finish(null, error); }
        });
        dialog.showModal();
        requestAnimationFrame(render);
        use.focus({ preventScroll: true });
    });
}
