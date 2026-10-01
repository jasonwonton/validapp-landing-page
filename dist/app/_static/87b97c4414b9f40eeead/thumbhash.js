// ThumbHash encoder, ported from the reference implementation at
// https://github.com/evanw/thumbhash (MIT License, Copyright (c) 2023 Evan Wallace).
// iOS sends the same hash (Services/Cache/ChatPhotoPreview.swift), so a chat
// photo from either client gets the same placeholder while its preview loads.

export function rgbaToThumbHash(w, h, rgba) {
    // Encoding an image larger than 100x100 is slow with no benefit.
    if (w > 100 || h > 100) throw new Error(`${w}x${h} doesn't fit in 100x100`);
    const { PI, round, max, cos, abs } = Math;

    // Determine the average color.
    let avgR = 0, avgG = 0, avgB = 0, avgA = 0;
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
        const alpha = rgba[j + 3] / 255;
        avgR += alpha / 255 * rgba[j];
        avgG += alpha / 255 * rgba[j + 1];
        avgB += alpha / 255 * rgba[j + 2];
        avgA += alpha;
    }
    if (avgA) {
        avgR /= avgA;
        avgG /= avgA;
        avgB /= avgA;
    }

    const hasAlpha = avgA < w * h;
    const lLimit = hasAlpha ? 5 : 7; // Use fewer luminance bits if there's alpha.
    const lx = max(1, round(lLimit * w / max(w, h)));
    const ly = max(1, round(lLimit * h / max(w, h)));
    const l = []; // luminance
    const p = []; // yellow - blue
    const q = []; // red - green
    const a = []; // alpha

    // Convert the image from RGBA to LPQA (composite atop the average color).
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
        const alpha = rgba[j + 3] / 255;
        const r = avgR * (1 - alpha) + alpha / 255 * rgba[j];
        const g = avgG * (1 - alpha) + alpha / 255 * rgba[j + 1];
        const b = avgB * (1 - alpha) + alpha / 255 * rgba[j + 2];
        l[i] = (r + g + b) / 3;
        p[i] = (r + g) / 2 - b;
        q[i] = r - g;
        a[i] = alpha;
    }

    // Encode using the DCT into DC (constant) and normalized AC (varying) terms.
    const encodeChannel = (channel, nx, ny) => {
        let dc = 0, scale = 0;
        const ac = [], fx = [];
        for (let cy = 0; cy < ny; cy++) {
            for (let cx = 0; cx * ny < nx * (ny - cy); cx++) {
                let f = 0;
                for (let x = 0; x < w; x++) fx[x] = cos(PI / w * cx * (x + 0.5));
                for (let y = 0; y < h; y++) {
                    const fy = cos(PI / h * cy * (y + 0.5));
                    for (let x = 0; x < w; x++) f += channel[x + y * w] * fx[x] * fy;
                }
                f /= w * h;
                if (cx || cy) {
                    ac.push(f);
                    scale = max(scale, abs(f));
                } else {
                    dc = f;
                }
            }
        }
        if (scale) for (let i = 0; i < ac.length; i++) ac[i] = 0.5 + 0.5 / scale * ac[i];
        return [dc, ac, scale];
    };
    const [lDC, lAC, lScale] = encodeChannel(l, max(3, lx), max(3, ly));
    const [pDC, pAC, pScale] = encodeChannel(p, 3, 3);
    const [qDC, qAC, qScale] = encodeChannel(q, 3, 3);
    const [aDC, aAC, aScale] = hasAlpha ? encodeChannel(a, 5, 5) : [];

    // Write the constants.
    const isLandscape = w > h;
    const header24 = round(63 * lDC) | (round(31.5 + 31.5 * pDC) << 6) | (round(31.5 + 31.5 * qDC) << 12)
        | (round(31 * lScale) << 18) | (hasAlpha << 23);
    const header16 = (isLandscape ? ly : lx) | (round(63 * pScale) << 3) | (round(63 * qScale) << 9) | (isLandscape << 15);
    const hash = [header24 & 255, (header24 >> 8) & 255, header24 >> 16, header16 & 255, header16 >> 8];
    const acStart = hasAlpha ? 6 : 5;
    let acIndex = 0;
    if (hasAlpha) hash.push(round(15 * aDC) | (round(15 * aScale) << 4));

    // Write the varying factors.
    for (const ac of hasAlpha ? [lAC, pAC, qAC, aAC] : [lAC, pAC, qAC]) {
        for (const f of ac) {
            hash[acStart + (acIndex >> 1)] |= round(15 * f) << ((acIndex++ & 1) << 2);
        }
    }
    return new Uint8Array(hash);
}

// The average colour a hash describes, as 0-1 channels (reference `thumbHashToAverageRGBA`).
export function thumbHashToAverageRGBA(hash) {
    const { min, max } = Math;
    const header = hash[0] | (hash[1] << 8) | (hash[2] << 16);
    const l = (header & 63) / 63;
    const p = ((header >> 6) & 63) / 31.5 - 1;
    const q = ((header >> 12) & 63) / 31.5 - 1;
    const hasAlpha = header >> 23;
    const a = hasAlpha ? (hash[5] & 15) / 15 : 1;
    const b = l - 2 / 3 * p;
    const r = (3 * l - b + q) / 2;
    const g = r - q;
    return { r: max(0, min(1, r)), g: max(0, min(1, g)), b: max(0, min(1, b)), a };
}

export function thumbHashToBase64(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

export function base64ToThumbHash(text) {
    return Uint8Array.from(atob(String(text || "")), (character) => character.charCodeAt(0));
}

// Hash any drawable (canvas, ImageBitmap, image) the way iOS does: at most
// 100x100 RGBA, standard base64 with padding.
export function thumbHashForImage(image) {
    const width = Number(image.naturalWidth || image.videoWidth || image.width || 0);
    const height = Number(image.naturalHeight || image.videoHeight || image.height || 0);
    if (!width || !height) throw new Error("That photo could not be read.");
    const scale = Math.min(1, 100 / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, w, h);
    const hash = thumbHashToBase64(rgbaToThumbHash(w, h, context.getImageData(0, 0, w, h).data));
    canvas.width = canvas.height = 0;
    return hash;
}
