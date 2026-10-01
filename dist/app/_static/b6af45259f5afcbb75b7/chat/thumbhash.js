// ThumbHash decoding (Evan Wallace's ThumbHash, MIT licence; same decoder as iOS
// Services/Cache/ThumbHash.swift). A message's `preview_hash` becomes a
// blurred placeholder while its preview image loads, so bubbles have colour
// before any request is sent.

const cache = new Map();
const MAX_CACHED = 200;

export function base64Bytes(value) {
    const text = String(value || "");
    if (!/^[A-Za-z0-9+/]{4,64}={0,2}$/.test(text)) return null;
    try {
        const binary = atob(text);
        return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } catch (_) {
        return null;
    }
}

export function thumbHashAspectRatio(hash) {
    if (!hash || hash.length < 5) return null;
    const header = hash[3];
    const hasAlpha = hash[2] & 0x80;
    const isLandscape = hash[4] & 0x80;
    const lx = isLandscape ? (hasAlpha ? 5 : 7) : header & 7;
    const ly = isLandscape ? header & 7 : (hasAlpha ? 5 : 7);
    return lx > 0 && ly > 0 ? lx / ly : null;
}

/** Straight RGBA at most 32 px on the long edge, or null for malformed input. */
export function thumbHashToRGBA(hash) {
    const ratio = thumbHashAspectRatio(hash);
    if (!ratio) return null;
    const { PI, cos, max, min, round } = Math;
    const header24 = hash[0] | (hash[1] << 8) | (hash[2] << 16);
    const header16 = hash[3] | (hash[4] << 8);
    const lDC = (header24 & 63) / 63;
    const pDC = ((header24 >> 6) & 63) / 31.5 - 1;
    const qDC = ((header24 >> 12) & 63) / 31.5 - 1;
    const lScale = ((header24 >> 18) & 31) / 31;
    const hasAlpha = (header24 >> 23) !== 0;
    const pScale = ((header16 >> 3) & 63) / 63;
    const qScale = ((header16 >> 9) & 63) / 63;
    const isLandscape = (header16 >> 15) !== 0;
    const lx = max(3, isLandscape ? (hasAlpha ? 5 : 7) : header16 & 7);
    const ly = max(3, isLandscape ? header16 & 7 : (hasAlpha ? 5 : 7));
    if (hasAlpha && hash.length < 6) return null;
    const aDC = hasAlpha ? (hash[5] & 15) / 15 : 1;
    const aScale = hasAlpha ? (hash[5] >> 4) / 15 : 0;
    const acStart = hasAlpha ? 6 : 5;
    let acIndex = 0;
    const decodeChannel = (nx, ny, scale) => {
        const ac = [];
        for (let cy = 0; cy < ny; cy++) {
            for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx++) {
                const byte = acStart + (acIndex >> 1);
                if (byte >= hash.length) return null;
                ac.push((((hash[byte] >> ((acIndex++ & 1) << 2)) & 15) / 7.5 - 1) * scale);
            }
        }
        return ac;
    };
    const lAC = decodeChannel(lx, ly, lScale);
    const pAC = decodeChannel(3, 3, pScale * 1.25);
    const qAC = decodeChannel(3, 3, qScale * 1.25);
    const aAC = hasAlpha ? decodeChannel(5, 5, aScale) : [];
    if (!lAC || !pAC || !qAC || !aAC) return null;
    const w = round(ratio > 1 ? 32 : 32 * ratio);
    const h = round(ratio > 1 ? 32 / ratio : 32);
    const rgba = new Uint8ClampedArray(w * h * 4);
    const fx = [], fy = [];
    for (let y = 0, i = 0; y < h; y++) {
        for (let x = 0; x < w; x++, i += 4) {
            let l = lDC, p = pDC, q = qDC, a = aDC;
            for (let cx = 0, n = max(lx, hasAlpha ? 5 : 3); cx < n; cx++) fx[cx] = cos(PI / w * (x + 0.5) * cx);
            for (let cy = 0, n = max(ly, hasAlpha ? 5 : 3); cy < n; cy++) fy[cy] = cos(PI / h * (y + 0.5) * cy);
            for (let cy = 0, j = 0; cy < ly; cy++) {
                for (let cx = cy ? 0 : 1, fy2 = fy[cy] * 2; cx * ly < lx * (ly - cy); cx++, j++) l += lAC[j] * fx[cx] * fy2;
            }
            for (let cy = 0, j = 0; cy < 3; cy++) {
                for (let cx = cy ? 0 : 1, fy2 = fy[cy] * 2; cx < 3 - cy; cx++, j++) {
                    const f = fx[cx] * fy2;
                    p += pAC[j] * f;
                    q += qAC[j] * f;
                }
            }
            if (hasAlpha) {
                for (let cy = 0, j = 0; cy < 5; cy++) {
                    for (let cx = cy ? 0 : 1, fy2 = fy[cy] * 2; cx < 5 - cy; cx++, j++) a += aAC[j] * fx[cx] * fy2;
                }
            }
            const b = l - 2 / 3 * p;
            const r = (3 * l - b + q) / 2;
            const g = r - q;
            rgba[i] = max(0, 255 * min(1, r));
            rgba[i + 1] = max(0, 255 * min(1, g));
            rgba[i + 2] = max(0, 255 * min(1, b));
            rgba[i + 3] = max(0, 255 * min(1, a));
        }
    }
    return { width: w, height: h, rgba };
}

/** A PNG data URL for a base64 `preview_hash`, or "" when it cannot be drawn. */
export function thumbHashDataURL(previewHash) {
    const key = String(previewHash || "");
    if (!key) return "";
    if (cache.has(key)) return cache.get(key);
    let url = "";
    try {
        const bytes = base64Bytes(key);
        const decoded = bytes && thumbHashToRGBA(bytes);
        if (decoded && typeof document !== "undefined") {
            const canvas = document.createElement("canvas");
            canvas.width = decoded.width;
            canvas.height = decoded.height;
            canvas.getContext("2d").putImageData(new ImageData(decoded.rgba, decoded.width, decoded.height), 0, 0);
            url = canvas.toDataURL("image/png");
        }
    } catch (_) {
        url = "";
    }
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value);
    cache.set(key, url);
    return url;
}
