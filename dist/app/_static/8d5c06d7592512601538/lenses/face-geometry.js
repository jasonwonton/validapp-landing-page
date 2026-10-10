// Face anchors and tracking for camera lenses: a port of the iOS renderer's
// AuraCamFaceTrackingSmoother, landmark smoothing, AdditionalFaceTracks,
// CameraMotionRate/CameraFaceMotion and accessoryPlacement
// (ios/Six7/Six7/Utilities/AuraCamFilter.swift, CameraTrackingMotion.swift).
//
// Coordinates are normalized to the analysed video frame with a TOP-LEFT
// origin (iOS Vision uses bottom-left; every y here is already flipped).
// Pure functions and classes only: no DOM, so node tests can drive them.

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const hypot = Math.hypot;

// MediaPipe Face Mesh indices. Eye centres are the mean of both corners and
// both lids; the face box is calibrated against macOS Vision's boundingBox on
// the same photos (tests/fixtures/lenses/README.md): Vision's box is a
// square about 0.97 x the forehead-top (10) to chin (152) distance, centred
// between them. Nose sits a quarter of the way from 4 toward the tip (1),
// the mouth is the mean of the outer-lip extremes; both match Vision's
// region centroids to within ~3% of the eye distance.
export const MESH = Object.freeze({
    foreheadTop: 10, chin: 152,
    eyeA: [33, 133, 159, 145], eyeB: [362, 263, 386, 374],
    noseUpper: 4, noseTip: 1,
    mouth: [0, 17, 61, 291],
});
export const MESH_INDICES = Object.freeze([...new Set([
    MESH.foreheadTop, MESH.chin, ...MESH.eyeA, ...MESH.eyeB, MESH.noseUpper, MESH.noseTip, ...MESH.mouth,
])].sort((a, b) => a - b));

/** Jaw drop from the jawOpen blendshape. A toothy grin measures ~0.12, so,
 * like iOS's jawOpenStart, the ramp starts above grins: a smile never shows
 * the tongue or honey. */
export const JAW_OPEN_START = 0.18;
export function jawOpenAmount(jawOpenBlendshape) {
    return clamp(((Number(jawOpenBlendshape) || 0) - JAW_OPEN_START) / 0.37, 0, 1);
}

/** `points(i)` returns [x, y] normalized for mesh index i. `width`/`height`
 * are the analysed frame's pixel size, so distances respect its aspect. */
export function faceFromMesh(points, width, height, jawOpenBlendshape = 0) {
    const at = index => {
        const point = points(index);
        return point && Number.isFinite(point[0]) && Number.isFinite(point[1]) ? point : null;
    };
    const mean = indices => {
        let x = 0, y = 0;
        for (const index of indices) { const point = at(index); if (!point) return null; x += point[0]; y += point[1]; }
        return { x: x / indices.length, y: y / indices.length };
    };
    const top = at(MESH.foreheadTop), chin = at(MESH.chin);
    if (!top || !chin || !(width > 0) || !(height > 0)) return null;
    const side = 0.97 * hypot((chin[0] - top[0]) * width, (chin[1] - top[1]) * height);
    if (!(side > 0)) return null;
    const cx = (top[0] + chin[0]) / 2, cy = (top[1] + chin[1]) / 2;
    const bounds = { x: cx - side / width / 2, y: cy - side / height / 2, width: side / width, height: side / height };
    const eyes = [mean(MESH.eyeA), mean(MESH.eyeB)].filter(Boolean).sort((a, b) => a.x - b.x);
    const upper = at(MESH.noseUpper), tip = at(MESH.noseTip);
    return {
        bounds,
        leftEye: eyes.length === 2 ? eyes[0] : null,
        rightEye: eyes.length === 2 ? eyes[1] : null,
        nose: upper && tip ? { x: upper[0] + (tip[0] - upper[0]) * 0.25, y: upper[1] + (tip[1] - upper[1]) * 0.25 } : null,
        mouth: mean(MESH.mouth),
        jawOpen: jawOpenAmount(jawOpenBlendshape),
    };
}

const midX = rect => rect.x + rect.width / 2;
const midY = rect => rect.y + rect.height / 2;
function intersectUnit(rect) {
    const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y);
    const x1 = Math.min(1, rect.x + rect.width), y1 = Math.min(1, rect.y + rect.height);
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** CameraMotionRate: per-second velocity of a smoothed value, low-passed. */
export class MotionRate {
    static cutoffHz = 3;
    constructor() { this.reset(); }
    reset() { this.velocity = { x: 0, y: 0 }; this.last = null; }
    note(point, time, measured = true) {
        if (!point) { this.reset(); return; }
        const previous = this.last;
        this.last = { point, time };
        if (!measured) { this.velocity = { x: 0, y: 0 }; return; }
        if (!previous || !(time > previous.time)) return;
        const elapsed = time - previous.time;
        const timeConstant = 1 / (2 * Math.PI * MotionRate.cutoffHz);
        const amount = 1 / (1 + timeConstant / elapsed);
        this.velocity = {
            x: this.velocity.x + ((point.x - previous.point.x) / elapsed - this.velocity.x) * amount,
            y: this.velocity.y + ((point.y - previous.point.y) / elapsed - this.velocity.y) * amount,
        };
    }
    snap(point, time) { this.velocity = { x: 0, y: 0 }; this.last = { point, time }; }
}

/** AuraCamFaceTrackingSmoother. Times are seconds. iOS holds a missed face
 * for 18 analysed frames at 30 fps; the web analyses at a variable rate, so
 * the hold is the same 0.6 s after the last sighting, in time. */
export class FaceTrackingSmoother {
    static holdSeconds = 0.6;
    constructor() { this.reset(); }
    reset() {
        this.bounds = null; this.mouthOpenAmount = 0; this.missedFrames = 0; this.lastSeen = null;
        this.centerRate = new MotionRate(); this.sizeRate = new MotionRate(); this.lastTime = null;
    }
    get isHoldingMissedFace() { return this.missedFrames > 0; }
    update(rawBounds, rawMouthOpenAmount, time) {
        const now = time ?? (this.lastTime == null ? 0 : this.lastTime + 1 / 30);
        this.lastTime = now;
        const result = this.#smooth(rawBounds, rawMouthOpenAmount, now);
        if (this.bounds) {
            const center = { x: midX(this.bounds), y: midY(this.bounds) };
            const size = { x: this.bounds.width, y: this.bounds.height };
            if (rawBounds && result.snapped) { this.centerRate.snap(center, now); this.sizeRate.snap(size, now); }
            else { this.centerRate.note(center, now, Boolean(rawBounds)); this.sizeRate.note(size, now, Boolean(rawBounds)); }
        } else { this.centerRate.reset(); this.sizeRate.reset(); }
        return { bounds: this.bounds, mouthOpenAmount: this.mouthOpenAmount };
    }
    #smooth(rawBounds, rawMouth, now) {
        if (!rawBounds) {
            this.missedFrames += 1;
            this.mouthOpenAmount *= 0.72;
            // Hold the last trustworthy anchors for about half a second
            // instead of visibly dropping the selected lens.
            if (this.lastSeen == null || now - this.lastSeen > FaceTrackingSmoother.holdSeconds + 1e-6) { this.bounds = null; this.mouthOpenAmount = 0; }
            return { snapped: false };
        }
        this.missedFrames = 0; this.lastSeen = now;
        const clipped = intersectUnit(rawBounds);
        if (!clipped) { this.bounds = null; return { snapped: false }; }
        let snapped;
        const previous = this.bounds;
        if (previous && shouldSmooth(previous, clipped)) {
            snapped = false;
            const centerTravel = hypot(midX(previous) - midX(clipped), midY(previous) - midY(clipped));
            const sizeTravel = Math.max(Math.abs(previous.width - clipped.width), Math.abs(previous.height - clipped.height));
            const positionResponse = centerTravel < 0.006 ? 0.18 : centerTravel < 0.025 ? 0.46 : Math.min(0.86, 0.62 + centerTravel * 3.2);
            const sizeResponse = sizeTravel < 0.006 ? 0.14 : sizeTravel < 0.025 ? 0.38 : Math.min(0.72, 0.52 + sizeTravel * 2.4);
            const cx = stabilized(midX(previous), midX(clipped), 0.0014, positionResponse);
            const cy = stabilized(midY(previous), midY(clipped), 0.0014, positionResponse);
            const width = stabilized(previous.width, clipped.width, 0.0012, sizeResponse);
            const height = stabilized(previous.height, clipped.height, 0.0012, sizeResponse);
            this.bounds = intersectUnit({ x: cx - width / 2, y: cy - height / 2, width, height });
        } else { this.bounds = clipped; snapped = true; }
        const bounded = clamp(rawMouth, 0, 1);
        this.mouthOpenAmount += (bounded - this.mouthOpenAmount) * (bounded > this.mouthOpenAmount ? 0.82 : 0.58);
        return { snapped };
    }
}
function shouldSmooth(previous, current) {
    return hypot(midX(previous) - midX(current), midY(previous) - midY(current)) < 0.20
        && Math.abs(previous.width - current.width) < 0.16;
}
function stabilized(start, end, deadZone, response) {
    const delta = end - start;
    if (Math.abs(delta) <= deadZone) return start;
    return start + (delta - (delta > 0 ? deadZone : -deadZone)) * response;
}

/** A landmark that moves this far between analyses is a new sighting. */
export const LANDMARK_SNAP_DISTANCE = 0.20;
export function smoothedPoint(previous, current, shouldRetain) {
    if (!current) return shouldRetain ? previous : null;
    if (!previous) return current;
    const travel = hypot(previous.x - current.x, previous.y - current.y);
    if (travel >= LANDMARK_SNAP_DISTANCE) return current;
    const deadZone = 0.0015;
    if (travel <= deadZone) return previous;
    const response = travel < 0.008 ? 0.16 : travel < 0.035 ? 0.44 : 0.76;
    const scale = (travel - deadZone) / travel * response;
    return { x: previous.x + (current.x - previous.x) * scale, y: previous.y + (current.y - previous.y) * scale };
}
/** Quick to open, slower to close, fading while a face is briefly missed. */
export function eased(current, raw, tracked) {
    if (!tracked) return 0;
    if (raw == null) return current * 0.72;
    return current + (raw - current) * (raw > current ? 0.82 : 0.58);
}

/** One smoothed face: box via the smoother, landmarks via smoothedPoint. */
export class FaceTrack {
    constructor({ motion = false } = {}) {
        this.smoother = new FaceTrackingSmoother();
        this.nose = this.mouth = this.leftEye = this.rightEye = null;
        this.jawOpen = 0; this.sourceTime = 0;
        this.rates = motion ? { nose: new MotionRate(), mouth: new MotionRate(), leftEye: new MotionRate(), rightEye: new MotionRate() } : null;
    }
    reset() {
        this.smoother.reset(); this.nose = this.mouth = this.leftEye = this.rightEye = null; this.jawOpen = 0;
        if (this.rates) for (const rate of Object.values(this.rates)) rate.reset();
    }
    apply(face, time) {
        const tracked = this.smoother.update(face?.bounds ?? null, face?.jawOpen ?? 0, time);
        const retain = tracked.bounds != null;
        this.jawOpen = eased(this.jawOpen, face ? face.jawOpen : null, retain);
        for (const key of ['nose', 'mouth', 'leftEye', 'rightEye']) {
            const old = this[key];
            this[key] = smoothedPoint(old, face?.[key] ?? null, retain);
            const rate = this.rates?.[key];
            if (!rate) continue;
            const measured = Boolean(face?.[key]);
            if (old && this[key] && measured && hypot(old.x - this[key].x, old.y - this[key].y) >= LANDMARK_SNAP_DISTANCE) rate.snap(this[key], time);
            else rate.note(this[key], time, measured);
        }
        this.sourceTime = time;
    }
    get face() {
        const bounds = this.smoother.bounds;
        return bounds ? { bounds, nose: this.nose, mouth: this.mouth, leftEye: this.leftEye, rightEye: this.rightEye, jawOpen: this.jawOpen } : null;
    }
    /** CameraFaceMotion: the face carried forward to `time` by its measured
     * velocity, at most 100 ms and 0.08 per axis. Held faces stay put. */
    carried(time) {
        const face = this.face;
        if (!face || !this.rates || this.smoother.isHoldingMissedFace) return face;
        const lead = Math.min(MAXIMUM_LEAD, Math.max(0, time - this.sourceTime));
        if (!(lead > 0)) return face;
        const shift = value => clamp(value * lead, -MAXIMUM_SHIFT, MAXIMUM_SHIFT);
        const move = (point, rate) => point && { x: point.x + shift(rate.velocity.x), y: point.y + shift(rate.velocity.y) };
        const center = this.smoother.centerRate.velocity, size = this.smoother.sizeRate.velocity;
        const width = Math.max(0.01, face.bounds.width + shift(size.x));
        const height = Math.max(0.01, face.bounds.height + shift(size.y));
        const cx = midX(face.bounds) + shift(center.x), cy = midY(face.bounds) + shift(center.y);
        return {
            ...face,
            bounds: { x: cx - width / 2, y: cy - height / 2, width, height },
            nose: move(face.nose, this.rates.nose), mouth: move(face.mouth, this.rates.mouth),
            leftEye: move(face.leftEye, this.rates.leftEye), rightEye: move(face.rightEye, this.rates.rightEye),
        };
    }
}
export const MAXIMUM_LEAD = 0.10;
export const MAXIMUM_SHIFT = 0.08;

/** The face the main track follows: stays on the same person while they are
 * within reach and at least 60% the width of the largest face. */
export const MATCH_DISTANCE = 0.2;
export function primaryFace(faces, previous) {
    if (!faces.length) return null;
    const largest = faces.reduce((best, face) => face.bounds.width > best.bounds.width ? face : best);
    if (!previous || faces.length < 2) return largest;
    const distance = face => hypot(midX(face.bounds) - midX(previous), midY(face.bounds) - midY(previous));
    const nearest = faces.reduce((best, face) => distance(face) < distance(best) ? face : best);
    return distance(nearest) < MATCH_DISTANCE && nearest.bounds.width >= largest.bounds.width * 0.6 ? nearest : largest;
}

/** Everyone but the main face (three more, four in all), each smoothed and
 * matched nearest-first so art stays on the right person. */
export class AdditionalFaceTracks {
    static maximumCount = 3;
    constructor() { this.tracks = []; }
    reset() { this.tracks = []; }
    update(faces, time) {
        const sorted = [...faces].sort((a, b) => b.bounds.width - a.bounds.width).slice(0, AdditionalFaceTracks.maximumCount);
        const pairs = [];
        this.tracks.forEach((track, trackIndex) => {
            const bounds = track.smoother.bounds;
            if (!bounds) return;
            sorted.forEach((face, faceIndex) => {
                const distance = hypot(midX(bounds) - midX(face.bounds), midY(bounds) - midY(face.bounds));
                if (distance < MATCH_DISTANCE) pairs.push({ trackIndex, faceIndex, distance });
            });
        });
        pairs.sort((a, b) => a.distance - b.distance);
        const matched = new Map(), used = new Set();
        for (const pair of pairs) {
            if (matched.has(pair.trackIndex) || used.has(pair.faceIndex)) continue;
            matched.set(pair.trackIndex, sorted[pair.faceIndex]); used.add(pair.faceIndex);
        }
        this.tracks.forEach((track, index) => track.apply(matched.get(index) ?? null, time));
        sorted.forEach((face, index) => {
            if (used.has(index)) return;
            const track = new FaceTrack(); track.apply(face, time); this.tracks.push(track);
        });
        this.tracks = this.tracks.filter(track => track.smoother.bounds);
        if (this.tracks.length > AdditionalFaceTracks.maximumCount) {
            this.tracks.sort((a, b) => Number(a.smoother.isHoldingMissedFace) - Number(b.smoother.isHoldingMissedFace));
            this.tracks.length = AdditionalFaceTracks.maximumCount;
        }
        return this.tracks.map(track => track.face).filter(Boolean);
    }
}

/** The whole analysis state: one main face (with motion carry) plus up to
 * three more. `observe` takes one analysis; `faces(time)` gives what to draw. */
export class FaceTracker {
    constructor() { this.main = new FaceTrack({ motion: true }); this.others = new AdditionalFaceTracks(); this.additional = []; }
    reset() { this.main.reset(); this.others.reset(); this.additional = []; }
    observe(faces, time, { everyFace = true } = {}) {
        const face = primaryFace(faces, this.main.smoother.bounds);
        this.main.apply(face, time);
        this.additional = everyFace ? this.others.update(faces.filter(other => other !== face), time) : (this.others.reset(), []);
    }
    faces(time) {
        const main = this.main.carried(time);
        return main ? [main, ...this.additional] : [...this.additional];
    }
    get tracking() { return Boolean(this.main.smoother.bounds) || this.additional.length > 0; }
}

// ---- Output mapping -------------------------------------------------------

/** How the video frame lands on a `width` x `height` output with
 * object-fit: cover (the live preview and the captured photo both crop this
 * way). Returns a mapper from normalized frame coords to output pixels. */
export function coverMapping(videoWidth, videoHeight, width, height, mirrored = false) {
    const scale = Math.max(width / videoWidth, height / videoHeight);
    const drawnWidth = videoWidth * scale, drawnHeight = videoHeight * scale;
    const offsetX = (width - drawnWidth) / 2, offsetY = (height - drawnHeight) / 2;
    const x = value => {
        const px = offsetX + value * drawnWidth;
        return mirrored ? width - px : px;
    };
    const y = value => offsetY + value * drawnHeight;
    return {
        scale, point: point => point && { x: x(point.x), y: y(point.y) },
        rect: rect => {
            const left = x(rect.x), right = x(rect.x + rect.width);
            return { x: Math.min(left, right), y: y(rect.y), width: Math.abs(right - left), height: rect.height * drawnHeight };
        },
    };
}

/** A face in output pixels: box plus anchor points (null when unknown). */
export function screenFace(face, mapping) {
    return {
        rect: mapping.rect(face.bounds),
        nose: mapping.point(face.nose), mouth: mapping.point(face.mouth),
        leftEye: mapping.point(face.leftEye), rightEye: mapping.point(face.rightEye),
        jawOpen: face.jawOpen,
    };
}

/** accessoryPlacement: hang the art from the eye line. The eye distance is
 * the unit for size and lift, the line's angle is the head's roll. Without a
 * believable pair of eyes it sits upright in the face box. Screen pixels,
 * y down; draw `rect` after translating to `center` and rotating by `roll`. */
export const ACCESSORY = Object.freeze({
    crown: { width: 2.5, anchor: { x: 0.5, y: 0.92 }, lift: () => 1.28 },
    heartShades: { width: 2.6, anchor: { x: 0.5, y: 236 / 440 }, lift: () => -0.04 },
    halo: { width: 2.3, anchor: { x: 0.5, y: 0.5 }, lift: time => 2.0 + Math.sin(time * 2.4) * 0.05 },
});
export function accessoryPlacement(kind, imageSize, face, leftEye, rightEye, time = 0) {
    const spec = ACCESSORY[kind];
    if (!spec || !(imageSize?.width > 0) || !(face?.width > 0)) return null;
    let center = { x: face.x + face.width / 2, y: face.y + face.height * 0.26 };
    let eyeDistance = face.width * 0.39;
    let roll = 0;
    if (leftEye && rightEye) {
        const [a, b] = [leftEye, rightEye].sort((p, q) => p.x - q.x);
        const distance = hypot(b.x - a.x, b.y - a.y);
        if (distance >= face.width * 0.16 && distance <= face.width * 0.72) {
            center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            eyeDistance = distance;
            roll = Math.atan2(b.y - a.y, b.x - a.x);
        }
    }
    const drawWidth = eyeDistance * spec.width;
    const drawHeight = drawWidth * imageSize.height / imageSize.width;
    return {
        center, roll,
        rect: { x: -spec.anchor.x * drawWidth, y: -spec.lift(time) * eyeDistance - spec.anchor.y * drawHeight, width: drawWidth, height: drawHeight },
    };
}

/** Rectangles for the pet lenses' parts (drawPuppy / drawCat / drawBear),
 * in screen pixels. `sizes` maps part name to the image's natural size.
 * Returns [{ part, rect, alpha }] in draw order. */
export function petParts(kind, face, sizes) {
    const rect = face.rect;
    const nose = face.nose ?? { x: rect.x + rect.width / 2, y: rect.y + rect.height * 0.56 };
    const mouth = face.mouth ?? { x: rect.x + rect.width / 2, y: rect.y + rect.height * 0.76 };
    const jaw = face.jawOpen || 0;
    const parts = [];
    const place = (part, width, x, yFor, alpha, heightScale = 1) => {
        const size = sizes[part];
        if (!size?.width) return;
        const height = width * size.height / size.width * heightScale;
        parts.push({ part, alpha, rect: { x: x - width / 2, y: yFor(height), width, height } });
    };
    const midX = rect.x + rect.width / 2;
    if (kind === 'puppy') {
        place('ears', rect.width * 1.12, midX, h => rect.y - h * 0.82, 0.97);
        place('nose', rect.width * 0.22, nose.x, h => nose.y - h * 0.48, 0.96);
        // Only a dropped jaw shows the tongue; a smile does not.
        if (jaw > 0.02) place('tongue', rect.width * (0.15 + 0.05 * jaw), mouth.x, h => mouth.y - h * 0.08, Math.min(1, 0.5 + jaw), 0.72 + 0.28 * jaw);
    } else if (kind === 'cat') {
        place('ears', rect.width * 1.12, midX, h => rect.y - h * 0.78, 0.97);
        place('face', rect.width * 0.88, nose.x, h => nose.y - h * 0.5, 0.94);
    } else if (kind === 'bear') {
        place('ears', rect.width * 1.30, midX, h => rect.y - h * 0.92, 0.98);
        // The art's nose sits 42% down the image; put it on the real nose.
        place('snout', rect.width * 0.50, nose.x, h => nose.y - h * 0.42, 0.97);
        if (jaw > 0.02) place('honey', rect.width * (0.16 + 0.05 * jaw), mouth.x, h => mouth.y - h * 0.06, Math.min(1, 0.5 + jaw), 0.55 + 0.45 * jaw);
    }
    return parts;
}
