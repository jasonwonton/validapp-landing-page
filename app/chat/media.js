import { drawImageWithCameraEffect } from "../camera-effects.js";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export async function prepareMementoImage(file, { photoEffect = null } = {}) {
    validateMementoSource(file);
    return prepareJPEG(file, "memento.jpg", photoEffect);
}

export async function prepareMementoImages(primaryFile, secondaryFile = null, { photoEffect = null } = {}) {
    validateMementoSource(primaryFile);
    if (!secondaryFile) {
        return { primary: await prepareJPEG(primaryFile, "memento.jpg", photoEffect), swapped: null };
    }
    validateMementoSource(secondaryFile);
    const [primaryBitmap, secondaryBitmap] = await Promise.all([
        createImageBitmap(primaryFile, { imageOrientation: "from-image" }),
        createImageBitmap(secondaryFile, { imageOrientation: "from-image" }),
    ]);
    try {
        const [primary, swapped] = await Promise.all([
            prepareMementoComposite(primaryBitmap, secondaryBitmap, "memento.jpg", photoEffect),
            prepareMementoComposite(secondaryBitmap, primaryBitmap, "memento-swapped.jpg", photoEffect),
        ]);
        return { primary, swapped };
    } finally {
        primaryBitmap.close();
        secondaryBitmap.close();
    }
}

function validateMementoSource(file) {
    if (!file || !file.type.startsWith("image/")) throw new Error("Choose a photo to make your Memento.");
    if (file.size > MAX_SOURCE_BYTES) throw new Error("That photo is too large. Choose one under 20 MB.");
}

export async function prepareChatMedia(file, { durationMsHint = null, photoEffect = null } = {}) {
    if (!file) throw new Error("Choose a photo, MP4 video, or M4A voice recording.");
    if (file.type.startsWith("image/")) {
        if (file.size > MAX_SOURCE_BYTES) throw new Error("That photo is too large. Choose one under 20 MB.");
        return { kind: "photo", file: await prepareJPEG(file, "chat-photo.jpg", photoEffect), thumbnail: null, durationMs: null };
    }
    if (file.type === "audio/mp4" || /\.m4a$/i.test(file.name || "")) {
        if (file.size > 4 * 1024 * 1024) throw new Error("Voice messages can be up to 4 MB.");
        const durationMs = Number.isFinite(Number(durationMsHint))
            ? Math.round(Number(durationMsHint))
            : await audioDuration(file);
        if (durationMs < 1 || durationMs > 300_000) throw new Error("Voice messages can be up to 5 minutes.");
        const normalized = file.type === "audio/mp4" ? file : new File([file], file.name || "voice.m4a", { type: "audio/mp4", lastModified: file.lastModified || Date.now() });
        return { kind: "audio", file: normalized, thumbnail: null, durationMs };
    }
    if (file.type !== "video/mp4") throw new Error("Choose a photo, MP4 video, or M4A voice recording.");
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("Videos can be up to 8 MB.");
    const metadata = await videoMetadata(file);
    if (metadata.durationMs < 1 || metadata.durationMs > 15_000) throw new Error("Videos can be up to 15 seconds.");
    return { kind: "video", file, thumbnail: metadata.thumbnail, durationMs: metadata.durationMs };
}

async function audioDuration(file) {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    try {
        audio.src = url;
        await once(audio, "loadedmetadata", "That voice recording could not be read.");
        return Math.round(Number(audio.duration) * 1000);
    } finally {
        audio.removeAttribute("src");
        audio.load();
        URL.revokeObjectURL(url);
    }
}

async function prepareJPEG(file, filename, photoEffect = null) {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: false });
        context.fillStyle = "#fff";
        context.fillRect(0, 0, width, height);
        drawImageWithCameraEffect(context, bitmap, width, height, photoEffect || undefined);
        return encodeJPEG(canvas, filename);
    } finally {
        bitmap.close();
    }
}

async function prepareMementoComposite(primary, inset, filename, photoEffect) {
    const width = 1080;
    const height = 1440;
    const composite = document.createElement("canvas");
    composite.width = width;
    composite.height = height;
    const context = composite.getContext("2d", { alpha: false });
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
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

    const treated = document.createElement("canvas");
    treated.width = width;
    treated.height = height;
    const treatedContext = treated.getContext("2d", { alpha: false });
    treatedContext.fillStyle = "#000";
    treatedContext.fillRect(0, 0, width, height);
    drawImageWithCameraEffect(treatedContext, composite, width, height, photoEffect || undefined);
    return encodeJPEG(treated, filename);
}

function drawAspectFill(context, image, rect) {
    const sourceWidth = Number(image.width || 0);
    const sourceHeight = Number(image.height || 0);
    if (!sourceWidth || !sourceHeight) throw new Error("That photo could not be read.");
    const scale = Math.max(rect.width / sourceWidth, rect.height / sourceHeight);
    const cropWidth = rect.width / scale;
    const cropHeight = rect.height / scale;
    const sourceX = (sourceWidth - cropWidth) / 2;
    const sourceY = (sourceHeight - cropHeight) / 2;
    context.drawImage(image, sourceX, sourceY, cropWidth, cropHeight, rect.x, rect.y, rect.width, rect.height);
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

async function encodeJPEG(canvas, filename) {
    let quality = 0.84;
    let blob = await canvasBlob(canvas, quality);
    while (blob.size > MAX_UPLOAD_BYTES && quality > 0.46) {
        quality -= 0.1;
        blob = await canvasBlob(canvas, quality);
    }
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error("That photo could not be made small enough to upload.");
    return new File([blob], filename, { type: "image/jpeg", lastModified: Date.now() });
}

async function videoMetadata(file) {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    try {
        video.src = url;
        await once(video, "loadedmetadata", "That video could not be read.");
        const durationMs = Math.round(Number(video.duration) * 1000);
        video.currentTime = Math.min(Math.max(0, Number(video.duration) / 2), 1);
        await once(video, "seeked", "That video preview could not be created.");
        const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas.getContext("2d", { alpha: false }).drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await canvasBlob(canvas, 0.76);
        if (blob.size > 1024 * 1024) throw new Error("That video preview is too large.");
        return { durationMs, thumbnail: new File([blob], "chat-video-thumbnail.jpg", { type: "image/jpeg", lastModified: Date.now() }) };
    } finally {
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
    }
}

function once(target, eventName, errorMessage) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(errorMessage)), 10_000);
        const cleanup = () => {
            clearTimeout(timeout);
            target.removeEventListener(eventName, loaded);
            target.removeEventListener("error", failed);
        };
        const loaded = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error(errorMessage)); };
        target.addEventListener(eventName, loaded, { once: true });
        target.addEventListener("error", failed, { once: true });
    });
}

function canvasBlob(canvas, quality) {
    return new Promise((resolve, reject) => canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("The photo could not be prepared.")),
        "image/jpeg",
        quality,
    ));
}
