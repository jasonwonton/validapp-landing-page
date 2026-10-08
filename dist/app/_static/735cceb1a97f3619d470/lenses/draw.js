// Canvas 2D drawing for the face lenses, ported from the iOS renderer's
// drawCuratedModule (AuraCamFilter.swift). Faces arrive in output pixels
// (screenFace); y points down, as in UIKit.
import { accessoryPlacement, petParts } from './face-geometry.js';

const naturalSize = image => image ? { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height } : null;

/** Draw one lens for every face. `images` maps part name → decoded image. */
export function drawLens(ctx, lens, faces, images, time) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (const face of faces) {
        if (lens.kind === 'puppy' || lens.kind === 'cat' || lens.kind === 'bear') drawPet(ctx, lens.kind, face, images);
        else if (lens.kind === 'crying') drawCrying(ctx, face, time);
        else drawAccessory(ctx, lens.kind, face, images.art, time);
    }
    ctx.restore();
}

function drawPet(ctx, kind, face, images) {
    const sizes = Object.fromEntries(Object.entries(images).map(([part, image]) => [part, naturalSize(image)]));
    for (const { part, rect, alpha } of petParts(kind, face, sizes)) {
        ctx.globalAlpha = alpha;
        ctx.drawImage(images[part], rect.x, rect.y, rect.width, rect.height);
    }
    ctx.globalAlpha = 1;
}

function drawAccessory(ctx, kind, face, image, time) {
    const placement = image && accessoryPlacement(kind, naturalSize(image), face.rect, face.leftEye, face.rightEye, time);
    if (!placement) return;
    ctx.save();
    ctx.translate(placement.center.x, placement.center.y);
    ctx.rotate(placement.roll);
    ctx.globalAlpha = 0.98;
    ctx.drawImage(image, placement.rect.x, placement.rect.y, placement.rect.width, placement.rect.height);
    ctx.restore();
}

const rgba = (r, g, b, a) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;

/** drawCrying: two rivers of tears from under the eyes to puddles at the
 * jaw, a crying-red flush, and anime catchlights. A dropped jaw (a wail, not
 * a smile) makes them gush wider. The iOS eye-enlargement warp is skipped. */
export function drawCrying(ctx, face, time) {
    const rect = face.rect;
    const fallback = [
        { x: rect.x + rect.width * 0.32, y: rect.y + rect.height * 0.28 },
        { x: rect.x + rect.width - rect.width * 0.32, y: rect.y + rect.height * 0.28 },
    ];
    let eyes = fallback, eyesTrusted = false;
    if (face.leftEye && face.rightEye) {
        const pair = [face.leftEye, face.rightEye].sort((a, b) => a.x - b.x);
        const spread = Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y);
        const inset = { x: rect.x - rect.width * 0.1, y: rect.y - rect.height * 0.1, width: rect.width * 1.2, height: rect.height * 1.2 };
        const inside = p => p.x >= inset.x && p.x <= inset.x + inset.width && p.y >= inset.y && p.y <= inset.y + inset.height;
        if (spread >= rect.width * 0.25 && spread <= rect.width * 0.75 && pair.every(inside)) { eyes = pair; eyesTrusted = true; }
    }
    const d = Math.max(rect.width * 0.2, Math.hypot(eyes[1].x - eyes[0].x, eyes[1].y - eyes[0].y));
    const t = time;
    const gush = 1 + 0.35 * (face.jawOpen || 0);
    ctx.save();

    // Crying-red flush under the eyes and on the nose.
    const spots = eyes.map(eye => [{ x: eye.x, y: eye.y + d * 0.20 }, d * 0.30]);
    if (face.nose) spots.push([face.nose, d * 0.16]);
    for (const [center, radius] of spots) {
        ctx.save();
        ctx.translate(center.x, center.y);
        ctx.scale(1, 0.55);
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
        gradient.addColorStop(0, rgba(1, 0.33, 0.40, 0.20));
        gradient.addColorStop(1, rgba(1, 0.33, 0.40, 0));
        ctx.fillStyle = gradient;
        ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    const bottom = rect.y + rect.height + rect.height * 0.02;
    eyes.forEach((eye, index) => {
        const side = index === 0 ? -1 : 1;
        const top = eye.y + d * 0.20;
        const steps = 18, leftEdge = [], rightEdge = [];
        for (let step = 0; step <= steps; step++) {
            const f = step / steps;
            const y = top + (bottom - top) * f;
            const wobble = Math.sin(f * 7 + t * 3 + index) * d * 0.025 * f;
            const center = eye.x + side * d * 0.05 * f + wobble;
            const half = d * (0.10 + 0.07 * f) * gush;
            leftEdge.push({ x: center - half, y }); rightEdge.push({ x: center + half, y });
        }
        const firstLeft = leftEdge[0], lastLeft = leftEdge.at(-1), lastRight = rightEdge.at(-1);
        const stream = new Path2D();
        stream.moveTo(firstLeft.x, firstLeft.y);
        for (const point of leftEdge.slice(1)) stream.lineTo(point.x, point.y);
        stream.quadraticCurveTo((lastLeft.x + lastRight.x) / 2, bottom + d * 0.06, lastRight.x, lastRight.y);
        for (const point of rightEdge.slice(0, -1).reverse()) stream.lineTo(point.x, point.y);
        stream.quadraticCurveTo(eye.x, top - d * 0.06, firstLeft.x, firstLeft.y);
        stream.closePath();

        ctx.save();
        ctx.shadowOffsetY = d * 0.02; ctx.shadowBlur = d * 0.05; ctx.shadowColor = rgba(0, 0.2, 0.4, 0.25);
        ctx.fillStyle = rgba(0.31, 0.71, 0.95, 0.85);
        ctx.fill(stream);
        ctx.restore();

        ctx.save();
        ctx.clip(stream);
        const water = ctx.createLinearGradient(eye.x, top, eye.x, bottom);
        water.addColorStop(0, rgba(0.66, 0.90, 1, 0.88));
        water.addColorStop(0.5, rgba(0.31, 0.71, 0.95, 0.90));
        water.addColorStop(1, rgba(0.16, 0.56, 0.88, 0.92));
        ctx.fillStyle = water;
        ctx.fillRect(Math.min(lastLeft.x, firstLeft.x) - d, top - d * 0.1, d * 3, bottom - top + d * 0.2);
        // Highlights flowing down the stream.
        const spacing = d * 0.34;
        const phase = (t * d * 0.9) % spacing;
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = d * 0.028; ctx.lineCap = 'round';
        ctx.beginPath();
        for (let y = top - spacing + phase; y < bottom; y += spacing) {
            const f = Math.max(0, Math.min(1, (y - top) / Math.max(1, bottom - top)));
            const x = eye.x + side * d * 0.05 * f - d * (0.10 + 0.07 * f) * gush * 0.45;
            ctx.moveTo(x, y); ctx.lineTo(x, y + spacing * 0.42);
        }
        ctx.stroke();
        ctx.restore();

        // Puddle at the jaw and drops falling from it.
        const pool = { x: (lastLeft.x + lastRight.x) / 2, y: bottom + d * 0.04 };
        ellipse(ctx, rgba(0.27, 0.66, 0.93, 0.85), pool.x, pool.y + d * 0.01, d * 0.30 * gush, d * 0.07);
        ellipse(ctx, 'rgba(255,255,255,0.40)', pool.x - d * 0.06, pool.y - d * 0.0275, d * 0.10, d * 0.0175);
        for (let drop = 0; drop < 2; drop++) {
            const period = 0.9;
            const fall = ((t + drop * 0.45 + index * 0.2) % period) / period;
            const radius = d * 0.045;
            const x = pool.x + (drop === 0 ? -1 : 1) * d * 0.13, y = pool.y + d * 0.08 + fall * d * 0.9;
            ellipse(ctx, rgba(0.31, 0.71, 0.95, 0.9 * (1 - fall)), x, y, radius, radius * 1.3);
        }
    });

    // Anime sparkle: a big and a small catchlight per eye, trusted eyes only.
    if (eyesTrusted) {
        for (const eye of eyes) {
            ellipse(ctx, 'rgba(255,255,255,0.92)', eye.x - d * 0.09, eye.y - d * 0.07, d * 0.075, d * 0.075);
            ellipse(ctx, 'rgba(255,255,255,0.80)', eye.x + d * 0.06, eye.y + d * 0.05, d * 0.035, d * 0.035);
        }
    }
    ctx.restore();
}

function ellipse(ctx, fill, x, y, rx, ry) {
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2); ctx.fill();
}
