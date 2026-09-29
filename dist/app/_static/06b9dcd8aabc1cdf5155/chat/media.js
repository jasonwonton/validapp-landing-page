const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const SMALL_VIDEO_MS = 15_000;
const INGEST_VIDEO_TYPES = ["video/webm", "video/mp4", "video/quicktime"];

// Photo work (decode, compose, encode, preview) is loaded on first use so it
// stays out of the startup shell.
export const photoPipeline = () => import("../camera/photo-pipeline.js");

export async function prepareMementoImage(file) {
    return (await photoPipeline()).prepareMementoImage(file);
}

export async function prepareMementoImages(primaryFile, secondaryFile = null) {
    return (await photoPipeline()).prepareMementoImages(primaryFile, secondaryFile);
}

export function baseMediaType(type) {
    return String(type || "").split(";")[0].trim().toLowerCase();
}

export function ingestEnabled(config) {
    return config?.enable_web_media_ingest === true;
}

function ingestLimits(config) {
    return {
        maxBytes: Number(config?.web_media_ingest_video_max_bytes) || 50 * 1024 * 1024,
        maxDurationMs: Number(config?.web_media_ingest_video_max_duration_ms) || 60_000,
    };
}

// The server cuts an ingest into equal clips of at most 15 s.
export function ingestSegmentCount(durationMs) {
    const duration = Number(durationMs);
    return Number.isFinite(duration) && duration > 15_250 ? Math.ceil(duration / SMALL_VIDEO_MS) : 1;
}

function isVideoFile(file) {
    return String(file?.type || "").startsWith("video/") || /\.(mp4|m4v|mov|webm)$/i.test(file?.name || "");
}

export async function prepareChatMedia(file, { durationMsHint = null, poster = null, config = null } = {}) {
    if (!file) throw new Error("Choose a photo, MP4 video, or M4A voice recording.");
    const pipeline = String(file.type || "").startsWith("image/") || /\.(heic|heif)$/i.test(file.name || "") ? await photoPipeline() : null;
    if (pipeline) {
        const prepared = await pipeline.preparePhotoFile(file, pipeline.chatPhotoProfile(config), { preview: false });
        return { kind: "photo", file: prepared.file, thumbnail: null, durationMs: null };
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
    if (!isVideoFile(file)) throw new Error("Choose a photo, MP4 video, or M4A voice recording.");
    const type = baseMediaType(file.type) || (/\.webm$/i.test(file.name || "") ? "video/webm" : /\.mov$/i.test(file.name || "") ? "video/quicktime" : "video/mp4");
    const ingest = ingestEnabled(config);
    const hint = Number.isFinite(Number(durationMsHint)) && Number(durationMsHint) > 0 ? Math.round(Number(durationMsHint)) : null;
    if (!ingest && type !== "video/mp4") throw new Error("Choose a photo, MP4 video, or M4A voice recording.");
    if (!ingest && file.size > MAX_UPLOAD_BYTES) throw new Error("Videos can be up to 8 MB.");
    let metadata = null;
    let metadataError = null;
    try {
        metadata = await videoMetadata(file);
    } catch (error) {
        metadataError = error;
    }
    // MediaRecorder files often report no duration; the recorder's clock does.
    const durationMs = Number.isFinite(metadata?.durationMs) && metadata.durationMs > 0 ? metadata.durationMs : hint;
    const thumbnail = metadata?.thumbnail || poster || null;
    const smallPath = type === "video/mp4" && file.size <= MAX_UPLOAD_BYTES && durationMs && durationMs <= SMALL_VIDEO_MS
        && thumbnail && (!ingest || await isFastStartMP4(file));
    if (smallPath) return { kind: "video", file: type === file.type ? file : new File([file], file.name || "video.mp4", { type }), thumbnail, durationMs, ingest: false };
    if (!ingest) {
        if (metadataError && !hint) throw metadataError;
        if (!thumbnail) throw new Error("That video preview could not be created.");
        throw new Error("Videos can be up to 15 seconds.");
    }
    const limits = ingestLimits(config);
    if (!INGEST_VIDEO_TYPES.includes(type)) throw new Error("Choose an MP4, MOV, or WebM video.");
    if (file.size > limits.maxBytes) throw new Error(`Videos can be up to ${Math.round(limits.maxBytes / 1024 / 1024)} MB.`);
    if (durationMs && durationMs > limits.maxDurationMs) throw new Error(`Videos can be up to ${Math.round(limits.maxDurationMs / 1000)} seconds.`);
    if (!durationMs && metadataError && !String(file.type).includes("webm")) throw metadataError;
    return {
        kind: "video",
        file: new File([file], file.name || "video", { type, lastModified: file.lastModified || Date.now() }),
        thumbnail,
        durationMs,
        ingest: true,
        contentType: type,
        segments: ingestSegmentCount(durationMs),
    };
}

// The small path needs a regular MP4 whose moov box is in the first MiB.
async function isFastStartMP4(file) {
    try {
        const view = new DataView(await file.slice(0, 1024 * 1024).arrayBuffer());
        for (let offset = 0; offset + 8 <= view.byteLength;) {
            let size = view.getUint32(offset);
            const type = String.fromCharCode(view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7));
            if (type === "moov") {
                // A fragmented recording (mvex) has no sample tables to remux.
                const end = Math.min(view.byteLength, offset + size);
                for (let inner = offset + 8; inner + 8 <= end;) {
                    const innerSize = view.getUint32(inner);
                    const innerType = String.fromCharCode(view.getUint8(inner + 4), view.getUint8(inner + 5), view.getUint8(inner + 6), view.getUint8(inner + 7));
                    if (innerType === "mvex") return false;
                    if (innerSize < 8) break;
                    inner += innerSize;
                }
                return true;
            }
            if (type === "mdat" || type === "moof") return false;
            if (size === 1 && offset + 16 <= view.byteLength) size = Number(view.getBigUint64(offset + 8));
            if (size < 8) return false;
            offset += size;
        }
    } catch (_) {
        return false;
    }
    return false;
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

async function videoMetadata(file) {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    try {
        video.src = url;
        await once(video, "loadedmetadata", "That video could not be read.");
        const duration = Number(video.duration);
        const durationMs = Number.isFinite(duration) ? Math.round(duration * 1000) : null;
        video.currentTime = Number.isFinite(duration) ? Math.min(Math.max(0, duration / 2), 1) : 0;
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
