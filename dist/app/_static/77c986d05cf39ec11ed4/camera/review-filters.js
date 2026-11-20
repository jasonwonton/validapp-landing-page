// Colour looks you swipe through after a capture, ported from iOS
// Services/CameraFilters/ReviewColorFilter.swift. Core Image runs those
// filters in linear light, so the per-pixel steps here do too (sRGB is decoded
// and re-encoded through lookup tables); the bloom and vignette are canvas
// passes sized from the frame the same way the Swift sizes them.
import { normalizeFeaturedEffect, paintCameraEffectOverlays } from "../camera-effects.js";

export const REVIEW_FILTERS = Object.freeze([
    { id: "none", name: "Original" },
    { id: "golden", name: "Golden Hour" },
    { id: "frost", name: "Frost" },
    { id: "pop", name: "Pop" },
    { id: "dreamy", name: "Dreamy" },
    { id: "retro", name: "Retro" },
    { id: "mono", name: "Mono" },
].map((filter) => Object.freeze({ ...filter, source: "review" })));

const MAX_FEATURED = 16;

// Review looks first, in the iOS swipe order, then any server Featured effect
// the browser can reproduce. A failed catalog keeps the local looks.
export async function loadReviewFilters(api) {
    try {
        const response = typeof api?.getFeaturedCameraFilters === "function" ? await api.getFeaturedCameraFilters() : null;
        const rows = (Array.isArray(response) ? response : response?.filters || []).slice(0, MAX_FEATURED);
        const seen = new Set();
        const featured = rows.map(normalizeFeaturedEffect).filter((effect) => effect && !seen.has(effect.id) && seen.add(effect.id));
        return [...REVIEW_FILTERS, ...featured];
    } catch (_) {
        return [...REVIEW_FILTERS];
    }
}

let toLinear = null;
let toSRGB = null;
const SRGB_STEPS = 4096;

function tables() {
    if (toLinear) return;
    toLinear = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
        const c = i / 255;
        toLinear[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }
    toSRGB = new Uint8ClampedArray(SRGB_STEPS + 1);
    for (let i = 0; i <= SRGB_STEPS; i++) {
        const c = i / SRGB_STEPS;
        toSRGB[i] = Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
    }
}

const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value;
const encode = (value) => toSRGB[Math.round(clamp01(value) * SRGB_STEPS)];

// CIColorMatrix with only the diagonal and bias set, as every look uses it.
const matrix = (r, g, b, bias = [0, 0, 0]) => ({ type: "matrix", r, g, b, bias });
const vibrance = (amount) => ({ type: "vibrance", amount });
const controls = (saturation, brightness, contrast) => ({ type: "controls", saturation, brightness, contrast });
const exposure = (ev) => ({ type: "exposure", gain: 2 ** ev });

const RECIPES = {
    golden: { steps: [matrix(1.07, 1.01, 0.86, [0.02, 0.01, 0]), vibrance(0.25)] },
    frost: { steps: [matrix(0.93, 0.99, 1.08, [0, 0.01, 0.03]), controls(0.9, 0.02, 1.02)] },
    pop: { steps: [vibrance(0.4), controls(1.04, 0.01, 1.05)] },
    dreamy: { steps: [matrix(1.04, 0.97, 1.01, [0.04, 0.02, 0.04]), exposure(0.18)], bloom: { intensity: 0.3 } },
    retro: { steps: [matrix(0.92, 0.88, 0.78, [0.08, 0.07, 0.08]), controls(0.82, 0, 0.96)], vignette: { radius: 0.42, intensity: 0.45, falloff: 0.7 } },
    mono: { steps: [controls(0, 0, 1.14)] },
};

function gradePixels(data, steps) {
    tables();
    for (let i = 0; i < data.length; i += 4) {
        let r = toLinear[data[i]], g = toLinear[data[i + 1]], b = toLinear[data[i + 2]];
        for (const step of steps) {
            if (step.type === "matrix") {
                r = r * step.r + step.bias[0];
                g = g * step.g + step.bias[1];
                b = b * step.b + step.bias[2];
            } else if (step.type === "exposure") {
                r *= step.gain; g *= step.gain; b *= step.gain;
            } else {
                const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                let saturation = step.saturation ?? 1;
                if (step.type === "vibrance") {
                    // Boost muted colour more than saturated colour, and hold
                    // back on skin-like orange so faces do not go orange.
                    const max = Math.max(r, g, b), min = Math.min(r, g, b);
                    const chroma = max > 0 ? (max - min) / max : 0;
                    saturation = 1 + step.amount * (1 - chroma) * (r > g && g > b ? 0.5 : 1);
                }
                r = luma + (r - luma) * saturation;
                g = luma + (g - luma) * saturation;
                b = luma + (b - luma) * saturation;
                if (step.type === "controls") {
                    r = (r + step.brightness - 0.5) * step.contrast + 0.5;
                    g = (g + step.brightness - 0.5) * step.contrast + 0.5;
                    b = (b + step.brightness - 0.5) * step.contrast + 0.5;
                }
            }
        }
        data[i] = encode(r);
        data[i + 1] = encode(g);
        data[i + 2] = encode(b);
    }
}

// Browser Featured recipes use CSS filter semantics (sRGB, like the live preview).
function gradeFeaturedPixels(data, effect) {
    const saturation = Number(effect.saturation ?? 1);
    const contrast = Number(effect.contrast ?? 1);
    const brightness = 1 + Number(effect.brightness || 0);
    for (let i = 0; i < data.length; i += 4) {
        let r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = luma + (r - luma) * saturation;
        g = luma + (g - luma) * saturation;
        b = luma + (b - luma) * saturation;
        r = ((r - 0.5) * contrast + 0.5) * brightness;
        g = ((g - 0.5) * contrast + 0.5) * brightness;
        b = ((b - 0.5) * contrast + 0.5) * brightness;
        data[i] = r * 255;
        data[i + 1] = g * 255;
        data[i + 2] = b * 255;
    }
}

function paintBloom(context, width, height, intensity) {
    const radius = Math.max(4, Math.min(width, height) * 0.012);
    const blurred = document.createElement("canvas");
    // A pixel of the small copy spans about one blur radius; drawing it back
    // up with smoothing is a cheap, engine-independent Gaussian stand-in.
    const factor = Math.max(1, radius / 1.5);
    blurred.width = Math.max(1, Math.round(width / factor));
    blurred.height = Math.max(1, Math.round(height / factor));
    const small = blurred.getContext("2d");
    small.imageSmoothingQuality = "high";
    small.drawImage(context.canvas, 0, 0, blurred.width, blurred.height);
    context.save();
    context.globalCompositeOperation = "screen";
    context.globalAlpha = intensity;
    context.imageSmoothingQuality = "high";
    context.drawImage(blurred, 0, 0, width, height);
    context.restore();
    blurred.width = blurred.height = 0;
}

function paintVignette(context, width, height, { radius, intensity, falloff }) {
    const outer = Math.hypot(width, height) * radius;
    const inner = outer * (1 - falloff);
    const gradient = context.createRadialGradient(width / 2, height / 2, inner, width / 2, height / 2, outer * 1.25);
    for (let step = 0; step <= 8; step++) {
        const t = step / 8;
        const eased = t * t * (3 - 2 * t);
        const shade = Math.round(255 * (1 - intensity * eased));
        gradient.addColorStop(t, `rgb(${shade},${shade},${shade})`);
    }
    context.save();
    context.globalCompositeOperation = "multiply";
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.restore();
}

// Grades a canvas in place. Original and unknown looks leave it untouched.
export function applyReviewFilter(canvas, filter) {
    if (!filter || filter.id === "none") return canvas;
    const width = canvas.width, height = canvas.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const recipe = RECIPES[filter.id];
    if (!recipe && filter.source !== "featured") return canvas;
    const pixels = context.getImageData(0, 0, width, height);
    if (recipe) gradePixels(pixels.data, recipe.steps);
    else gradeFeaturedPixels(pixels.data, filter);
    context.putImageData(pixels, 0, 0);
    if (recipe?.bloom) paintBloom(context, width, height, recipe.bloom.intensity);
    if (recipe?.vignette) paintVignette(context, width, height, recipe.vignette);
    if (!recipe) paintCameraEffectOverlays(context, width, height, filter);
    return canvas;
}

export function cycleFilterIndex(index, step, count) {
    return ((index + step) % count + count) % count;
}
