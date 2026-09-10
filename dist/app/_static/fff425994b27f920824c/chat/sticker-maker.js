const DISPLAY_SIZE = 720;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_STICKER_BYTES = 2 * 1024 * 1024;
const MAX_LASSO_POINTS = 512;
const MIN_LASSO_POINTS = 12;
const MIN_LASSO_AREA = 0.0025;
const OUTPUT_SIZES = Object.freeze([960, 768, 614, 491, 393, 314]);

function bounded(value, minimum = 0, maximum = 1) {
    return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function imageRect(image, size = DISPLAY_SIZE) {
    const width = Number(image?.width || 0);
    const height = Number(image?.height || 0);
    if (width < 1 || height < 1) throw new Error("That photo could not be read.");
    const scale = Math.min(size / width, size / height);
    const drawnWidth = width * scale;
    const drawnHeight = height * scale;
    return {
        x: (size - drawnWidth) / 2,
        y: (size - drawnHeight) / 2,
        width: drawnWidth,
        height: drawnHeight,
    };
}

export function centerStickerCut(pointCount = 64) {
    const count = Math.min(MAX_LASSO_POINTS, Math.max(MIN_LASSO_POINTS, Math.round(pointCount)));
    return Array.from({ length: count }, (_, index) => {
        const angle = (index / count) * Math.PI * 2;
        return {
            x: 0.5 + Math.cos(angle) * 0.36,
            y: 0.5 + Math.sin(angle) * 0.42,
        };
    });
}

function polygonArea(points) {
    return Math.abs(points.reduce((total, point, index) => {
        const next = points[(index + 1) % points.length];
        return total + point.x * next.y - next.x * point.y;
    }, 0) / 2);
}

function validPoints(points) {
    if (!Array.isArray(points) || points.length < MIN_LASSO_POINTS) return null;
    const normalized = points.slice(0, MAX_LASSO_POINTS).map((point) => ({
        x: bounded(point?.x),
        y: bounded(point?.y),
    }));
    return polygonArea(normalized) >= MIN_LASSO_AREA ? normalized : null;
}

function polygonBounds(points) {
    const xs = points.map(({ x }) => x);
    const ys = points.map(({ y }) => y);
    const margin = 0.035;
    const left = bounded(Math.min(...xs) - margin);
    const top = bounded(Math.min(...ys) - margin);
    const right = bounded(Math.max(...xs) + margin);
    const bottom = bounded(Math.max(...ys) + margin);
    if (right - left < 0.02 || bottom - top < 0.02) {
        throw new Error("Draw a larger loop around the sticker.");
    }
    return { left, top, right, bottom };
}

function pathPolygon(context, points, mapPoint) {
    context.beginPath();
    points.forEach((point, index) => {
        const mapped = mapPoint(point);
        if (index === 0) context.moveTo(mapped.x, mapped.y);
        else context.lineTo(mapped.x, mapped.y);
    });
    context.closePath();
}

function canvasPNG(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("That sticker could not be prepared.")),
        "image/png",
    ));
}

async function renderSticker(image, points, bounds, maximumDimension) {
    const sourceWidth = Number(image.width);
    const sourceHeight = Number(image.height);
    const cropWidth = (bounds.right - bounds.left) * sourceWidth;
    const cropHeight = (bounds.bottom - bounds.top) * sourceHeight;
    const scale = Math.min(1, maximumDimension / Math.max(cropWidth, cropHeight));
    const width = Math.max(16, Math.round(cropWidth * scale));
    const height = Math.max(16, Math.round(cropHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    const mapPoint = (point) => ({
        x: ((point.x - bounds.left) / (bounds.right - bounds.left)) * width,
        y: ((point.y - bounds.top) / (bounds.bottom - bounds.top)) * height,
    });

    context.save();
    pathPolygon(context, points, mapPoint);
    context.clip();
    context.drawImage(
        image,
        bounds.left * sourceWidth,
        bounds.top * sourceHeight,
        cropWidth,
        cropHeight,
        0,
        0,
        width,
        height,
    );
    context.restore();

    context.save();
    context.globalCompositeOperation = "destination-over";
    context.strokeStyle = "#ffffff";
    context.lineWidth = Math.max(4, Math.round(Math.max(width, height) * 0.018));
    context.lineJoin = "round";
    context.lineCap = "round";
    pathPolygon(context, points, mapPoint);
    context.stroke();
    context.restore();
    return { blob: await canvasPNG(canvas), width, height };
}

export async function prepareStickerPNG(image, points) {
    const normalized = validPoints(points);
    if (!normalized) throw new Error("Draw a complete loop around the sticker.");
    const bounds = polygonBounds(normalized);
    for (const size of OUTPUT_SIZES) {
        const rendered = await renderSticker(image, normalized, bounds, size);
        if (rendered.blob.size <= MAX_STICKER_BYTES) {
            return new File([rendered.blob], "sticker.png", {
                type: "image/png",
                lastModified: Date.now(),
            });
        }
    }
    throw new Error("That sticker is too detailed. Try a smaller loop.");
}

export function createStickerMaker({
    dialog,
    saveSticker,
    onCreated,
    onUnconfirmed,
    softHaptic,
    successHaptic,
}) {
    if (!dialog) throw new Error("Sticker maker needs a dialog.");
    const canvas = dialog.querySelector("canvas");
    const form = dialog.querySelector("form");
    const status = dialog.querySelector("[data-sticker-maker-status]");
    const saveButton = dialog.querySelector("[data-save-sticker]");
    const resetButton = dialog.querySelector("[data-reset-sticker-cut]");
    const cancelButton = dialog.querySelector("[data-close-sticker-maker]");
    let image = null;
    let points = [];
    let drawing = false;
    let saving = false;
    let generation = 0;

    canvas.width = DISPLAY_SIZE;
    canvas.height = DISPLAY_SIZE;

    function setStatus(message) {
        status.textContent = message;
    }

    function setReady(ready) {
        saveButton.disabled = !ready || saving;
        resetButton.disabled = !image || saving;
        cancelButton.disabled = saving;
    }

    function draw() {
        const context = canvas.getContext("2d", { alpha: false });
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#050914";
        context.fillRect(0, 0, canvas.width, canvas.height);
        if (!image) return;
        const rect = imageRect(image);
        context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
        if (!points.length) return;
        const mapPoint = (point) => ({
            x: rect.x + point.x * rect.width,
            y: rect.y + point.y * rect.height,
        });
        context.save();
        context.fillStyle = "rgba(0,0,0,.38)";
        context.fillRect(rect.x, rect.y, rect.width, rect.height);
        pathPolygon(context, points, mapPoint);
        context.clip();
        context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
        context.restore();
        context.save();
        context.strokeStyle = "#ffffff";
        context.lineWidth = 6;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.setLineDash([12, 8]);
        pathPolygon(context, points, mapPoint);
        context.stroke();
        context.restore();
    }

    function useCenterCut() {
        if (!image || saving) return;
        points = centerStickerCut();
        draw();
        setReady(true);
        setStatus("A center cut is ready. Draw around your subject to refine it.");
        softHaptic?.();
    }

    function eventPoint(event) {
        const bounds = canvas.getBoundingClientRect();
        const displayX = ((event.clientX - bounds.left) / bounds.width) * canvas.width;
        const displayY = ((event.clientY - bounds.top) / bounds.height) * canvas.height;
        const rect = imageRect(image);
        return {
            x: bounded((displayX - rect.x) / rect.width),
            y: bounded((displayY - rect.y) / rect.height),
        };
    }

    function appendPointerPoint(event) {
        const point = eventPoint(event);
        const previous = points.at(-1);
        if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.006) return;
        if (points.length < MAX_LASSO_POINTS) points.push(point);
    }

    function finishDrawing() {
        if (!drawing) return;
        drawing = false;
        const normalized = validPoints(points);
        if (!normalized) {
            setReady(false);
            setStatus("Draw a larger, complete loop around the person or object.");
        } else {
            points = normalized;
            setReady(true);
            setStatus("Loop ready. Save it, or draw again to refine the cut.");
            softHaptic?.();
        }
        draw();
    }

    canvas.addEventListener("pointerdown", (event) => {
        if (!image || saving) return;
        drawing = true;
        points = [];
        appendPointerPoint(event);
        canvas.setPointerCapture?.(event.pointerId);
        setReady(false);
        setStatus("Keep drawing until the loop surrounds your subject.");
        draw();
    });
    canvas.addEventListener("pointermove", (event) => {
        if (!drawing) return;
        const samples = event.getCoalescedEvents?.() || [event];
        samples.forEach(appendPointerPoint);
        draw();
    });
    canvas.addEventListener("pointerup", finishDrawing);
    canvas.addEventListener("pointercancel", finishDrawing);
    canvas.addEventListener("lostpointercapture", finishDrawing);

    async function close({ force = false } = {}) {
        if (saving && !force) return;
        generation += 1;
        drawing = false;
        saving = false;
        points = [];
        image?.close?.();
        image = null;
        draw();
        setReady(false);
        setStatus("");
        if (dialog.open) dialog.close();
    }

    async function open(file) {
        await close();
        const currentGeneration = ++generation;
        if (!file || !file.type.startsWith("image/")) throw new Error("Choose a photo to make a sticker.");
        if (file.size > MAX_SOURCE_BYTES) throw new Error("That photo is too large. Choose one under 20 MB.");
        dialog.showModal();
        setStatus("Preparing your photo…");
        try {
            const decoded = await createImageBitmap(file, { imageOrientation: "from-image" });
            if (generation !== currentGeneration) {
                decoded.close?.();
                return;
            }
            image = decoded;
            points = centerStickerCut();
            draw();
            setReady(true);
            setStatus("A center cut is ready. Draw around your subject to refine it.");
            canvas.focus();
        } catch (error) {
            setStatus(error.message || "That photo could not be read.");
            setReady(false);
        }
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!image || saving || !validPoints(points)) return;
        saving = true;
        setReady(false);
        setStatus("Saving your sticker…");
        try {
            const file = await prepareStickerPNG(image, points);
            const sticker = await saveSticker(file);
            await close({ force: true });
            successHaptic?.();
            await onCreated?.(sticker);
        } catch (error) {
            const unconfirmed = !error?.status || error.status === 408 || error.status >= 500;
            if (unconfirmed) {
                await close({ force: true });
                await onUnconfirmed?.(error);
                return;
            }
            saving = false;
            setReady(true);
            setStatus(error.message || "That sticker could not be saved.");
        }
    });

    resetButton.addEventListener("click", useCenterCut);
    cancelButton.addEventListener("click", close);
    dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        void close();
    });

    return { close, open };
}

export { MAX_LASSO_POINTS, MAX_STICKER_BYTES };
