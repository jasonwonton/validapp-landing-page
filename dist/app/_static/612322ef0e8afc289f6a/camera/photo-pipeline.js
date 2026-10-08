// One decode, one composition, one JPEG encode per photo: the same budget
// search as iOS ChatPhotoProcessor (Services/CameraFilters/ChatMediaProcessing.swift)
// and the same 640 px preview + ThumbHash as ChatPhotoPreview.swift.
import { thumbHashForImage } from "../thumbhash.js";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 1024 * 1024;
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const LOWEST_QUALITY = 0.7;
const QUALITY_STEP = 0.05;
const DIMENSION_STEP = 0.8;
const LOWEST_DIMENSION = 1600;
export const HEIC_MESSAGE = "This photo is HEIC; choose a JPEG/PNG or change the camera format.";

const bounded = (value, fallback, minimum, maximum) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.min(maximum, Math.max(minimum, numeric)) : fallback;
};

// The /config knobs, clamped the way iOS ChatPhotoEncodingProfile clamps them.
export function chatPhotoProfile(config = {}) {
    return {
        maxDimension: bounded(config?.chat_photo_max_dimension, 2560, 1600, 3840),
        quality: bounded(config?.chat_photo_jpeg_quality, 0.92, 0.7, 0.95),
        targetBytes: bounded(config?.chat_photo_target_bytes, 800_000, 153_600, MAX_UPLOAD_BYTES),
        previewMaxDimension: bounded(config?.chat_photo_preview_max_dimension, 640, 160, 1280),
        previewQuality: bounded(config?.chat_photo_preview_jpeg_quality, 0.7, 0.4, 0.95),
    };
}

export function isHEIC(file) {
    return /^image\/hei[cf](-sequence)?$/i.test(file?.type || "") || /\.hei[cf]$/i.test(file?.name || "");
}

function isDrawable(source) {
    return (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap)
        || (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement)
        || (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement);
}

export function imageSize(image) {
    return {
        width: Number(image?.naturalWidth || image?.videoWidth || image?.width || 0),
        height: Number(image?.naturalHeight || image?.videoHeight || image?.height || 0),
    };
}

async function decodeWithImageElement(blob) {
    const url = URL.createObjectURL(blob);
    try {
        const image = new Image();
        image.decoding = "async";
        image.src = url;
        await image.decode();
        return image;
    } finally {
        // The decoded pixels stay usable after the URL is released.
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }
}

// A drawable photo plus a release function. Camera captures arrive already
// decoded (ImageBitmap/canvas); library files are decoded once here.
export async function decodePhoto(source) {
    if (isDrawable(source)) return { image: source, release() {} };
    const heic = isHEIC(source);
    if (!(source instanceof Blob) || (!heic && !String(source.type || "").startsWith("image/"))) {
        throw new Error("Choose a photo to send.");
    }
    if (source.size > MAX_SOURCE_BYTES) throw new Error("That photo is too large. Choose one under 40 MB.");
    let image = null;
    try {
        image = await createImageBitmap(source, { imageOrientation: "from-image" });
    } catch (_) {
        // Safari decodes HEIC and some formats through <img> only.
        image = await decodeWithImageElement(source).catch(() => null);
    }
    const { width, height } = imageSize(image);
    if (!image || !width || !height) throw new Error(heic ? HEIC_MESSAGE : "That photo could not be read. Choose a JPEG or PNG.");
    return { image, release() { image.close?.(); } };
}

export function centerCrop(width, height, aspect) {
    if (!aspect || !width || !height) return { x: 0, y: 0, width, height };
    if (width / height > aspect) {
        const cropWidth = height * aspect;
        return { x: (width - cropWidth) / 2, y: 0, width: cropWidth, height };
    }
    const cropHeight = width / aspect;
    return { x: 0, y: (height - cropHeight) / 2, width, height: cropHeight };
}

function canvasOf(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
}

// Draws `rect` of `image` into a new canvas of the given size. Large
// reductions halve in steps so fine detail is averaged rather than skipped.
export function drawScaled(image, rect, width, height, { mirrored = false } = {}) {
    let source = image;
    let area = { ...rect };
    const scratch = [];
    while (area.width / 2 >= width && area.height / 2 >= height && area.width > 2) {
        const half = canvasOf(area.width / 2, area.height / 2);
        const context = half.getContext("2d");
        context.imageSmoothingQuality = "high";
        context.drawImage(source, area.x, area.y, area.width, area.height, 0, 0, half.width, half.height);
        scratch.push(half);
        source = half;
        area = { x: 0, y: 0, width: half.width, height: half.height };
    }
    const output = canvasOf(width, height);
    const context = output.getContext("2d", { alpha: false });
    context.imageSmoothingQuality = "high";
    context.save();
    if (mirrored) {
        context.translate(output.width, 0);
        context.scale(-1, 1);
    }
    context.drawImage(source, area.x, area.y, area.width, area.height, 0, 0, output.width, output.height);
    context.restore();
    for (const canvas of scratch) canvas.width = canvas.height = 0;
    return output;
}

// The photo as it will be sent, before edits: cropped (camera captures are
// 3:4 like the preview), mirrored when asked, and never upscaled.
export function renderPhoto(image, { maxDimension = 2560, aspect = null, mirrored = false } = {}) {
    const { width, height } = imageSize(image);
    if (!width || !height) throw new Error("That photo could not be read.");
    const crop = centerCrop(width, height, aspect);
    const scale = Math.min(1, maxDimension / Math.max(crop.width, crop.height));
    return drawScaled(image, crop, crop.width * scale, crop.height * scale, { mirrored });
}

export function canvasBlob(canvas, quality, type = "image/jpeg") {
    return new Promise((resolve, reject) => canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("The photo could not be prepared.")),
        type,
        quality,
    ));
}

export function qualityLadder(preferred) {
    const rungs = [];
    for (let quality = preferred; quality > LOWEST_QUALITY + 1e-6; quality -= QUALITY_STEP) rungs.push(Math.round(quality * 100) / 100);
    rungs.push(LOWEST_QUALITY);
    return rungs;
}

// Step the quality down first (invisible to the floor), then shrink the
// image, exactly like the iOS budget search. Only the chosen encode is kept.
export async function encodeWithBudget(canvas, profile) {
    let candidate = canvas;
    let smallest = null;
    let encodes = 0;
    try {
        while (true) {
            const nextEdge = Math.max(candidate.width, candidate.height) * DIMENSION_STEP;
            const canShrink = nextEdge >= LOWEST_DIMENSION;
            const ladder = qualityLadder(profile.quality);
            for (let rung = 0; rung < ladder.length; rung++) {
                const blob = await canvasBlob(candidate, ladder[rung]);
                encodes += 1;
                if (blob.size <= profile.targetBytes) return { blob, width: candidate.width, height: candidate.height, quality: ladder[rung], encodes };
                smallest = { blob, width: candidate.width, height: candidate.height, quality: ladder[rung], encodes };
                if (rung === 0 && canShrink && blob.size > profile.targetBytes * 2) break;
            }
            if (!canShrink) break;
            const scale = nextEdge / Math.max(candidate.width, candidate.height);
            const next = drawScaled(candidate, { x: 0, y: 0, width: candidate.width, height: candidate.height }, candidate.width * scale, candidate.height * scale);
            if (candidate !== canvas) candidate.width = candidate.height = 0;
            candidate = next;
        }
    } finally {
        if (candidate !== canvas) setTimeout(() => { candidate.width = candidate.height = 0; }, 0);
    }
    if (!smallest || smallest.blob.size > MAX_UPLOAD_BYTES) throw new Error("Choose a photo smaller than 8 MB.");
    return smallest;
}

// 640 px preview JPEG + ThumbHash, like iOS ChatPhotoPreview. Best effort:
// a photo still sends without one.
export async function makePhotoPreview(canvas, profile) {
    try {
        const scale = Math.min(1, profile.previewMaxDimension / Math.max(canvas.width, canvas.height));
        const preview = drawScaled(canvas, { x: 0, y: 0, width: canvas.width, height: canvas.height }, canvas.width * scale, canvas.height * scale);
        const hash = thumbHashForImage(preview);
        const blob = await canvasBlob(preview, profile.previewQuality);
        preview.width = preview.height = 0;
        if (blob.size < 1 || blob.size > MAX_PREVIEW_BYTES || !/^[A-Za-z0-9+/]{4,64}={0,2}$/.test(hash) || hash.length > 64) return null;
        return { file: new File([blob], "chat-photo-preview.jpg", { type: "image/jpeg", lastModified: Date.now() }), hash };
    } catch (_) {
        return null;
    }
}

export async function encodeChatPhoto(canvas, profile, { filename = "chat-photo.jpg", preview = true } = {}) {
    const [encoded, previewResult] = await Promise.all([
        encodeWithBudget(canvas, profile),
        preview ? makePhotoPreview(canvas, profile) : null,
    ]);
    return {
        file: new File([encoded.blob], filename, { type: "image/jpeg", lastModified: Date.now() }),
        width: encoded.width,
        height: encoded.height,
        quality: encoded.quality,
        encodes: encoded.encodes,
        preview: previewResult?.file || null,
        previewHash: previewResult?.hash || null,
    };
}

// A photo that is sent without the review editor (Stories).
export async function preparePhotoFile(source, profile, options = {}) {
    const decoded = await decodePhoto(source);
    try {
        const canvas = renderPhoto(decoded.image, { maxDimension: profile.maxDimension });
        try {
            return await encodeChatPhoto(canvas, profile, options);
        } finally {
            canvas.width = canvas.height = 0;
        }
    } finally {
        decoded.release();
    }
}

// Mementos: the existing 1600 px single view and 1080x1440 composites, each
// encoded once.
const MEMENTO_PROFILE = { maxDimension: 1600, quality: 0.84, targetBytes: MAX_UPLOAD_BYTES };

export async function prepareMementoImage(source) {
    const decoded = await decodePhoto(source);
    try {
        const canvas = renderPhoto(decoded.image, { maxDimension: MEMENTO_PROFILE.maxDimension });
        const encoded = await encodeWithBudget(canvas, MEMENTO_PROFILE);
        return new File([encoded.blob], "memento.jpg", { type: "image/jpeg", lastModified: Date.now() });
    } finally {
        decoded.release();
    }
}

export async function prepareMementoImages(primarySource, secondarySource = null) {
    if (!secondarySource) return { primary: await prepareMementoImage(primarySource), swapped: null };
    const [primary, secondary] = await Promise.all([decodePhoto(primarySource), decodePhoto(secondarySource)]);
    try {
        const [first, swapped] = await Promise.all([
            mementoComposite(primary.image, secondary.image, "memento.jpg"),
            mementoComposite(secondary.image, primary.image, "memento-swapped.jpg"),
        ]);
        return { primary: first, swapped };
    } finally {
        primary.release();
        secondary.release();
    }
}

async function mementoComposite(primary, inset, filename) {
    const width = 1080;
    const height = 1440;
    const composite = canvasOf(width, height);
    const context = composite.getContext("2d", { alpha: false });
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingQuality = "high";
    drawAspectFill(context, primary, { x: 0, y: 0, width, height });
    const insetRect = { x: 684, y: 40, width: 356, height: 475 };
    context.save();
    roundedRectangle(context, insetRect, 34);
    context.clip();
    drawAspectFill(context, inset, insetRect);
    context.restore();
    context.save();
    roundedRectangle(context, insetRect, 34);
    context.strokeStyle = "#fff";
    context.lineWidth = 11;
    context.stroke();
    context.restore();
    const encoded = await encodeWithBudget(composite, { ...MEMENTO_PROFILE, maxDimension: 1440 });
    composite.width = composite.height = 0;
    return new File([encoded.blob], filename, { type: "image/jpeg", lastModified: Date.now() });
}

function drawAspectFill(context, image, rect) {
    const { width, height } = imageSize(image);
    if (!width || !height) throw new Error("That photo could not be read.");
    const crop = centerCrop(width, height, rect.width / rect.height);
    context.drawImage(image, crop.x, crop.y, crop.width, crop.height, rect.x, rect.y, rect.width, rect.height);
}

function roundedRectangle(context, rect, radius) {
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    context.beginPath();
    context.moveTo(rect.x + radius, rect.y);
    context.lineTo(right - radius, rect.y);
    context.quadraticCurveTo(right, rect.y, right, rect.y + radius);
    context.lineTo(right, bottom - radius);
    context.quadraticCurveTo(right, bottom, right - radius, bottom);
    context.lineTo(rect.x + radius, bottom);
    context.quadraticCurveTo(rect.x, bottom, rect.x, bottom - radius);
    context.lineTo(rect.x, rect.y + radius);
    context.quadraticCurveTo(rect.x, rect.y, rect.x + radius, rect.y);
    context.closePath();
}
