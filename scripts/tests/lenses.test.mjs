import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    AdditionalFaceTracks, FaceTrack, FaceTracker, FaceTrackingSmoother, MAXIMUM_SHIFT, MotionRate,
    accessoryPlacement, coverMapping, faceFromMesh, jawOpenAmount, petParts, primaryFace, screenFace, smoothedPoint,
} from '../../app/lenses/face-geometry.js';
import { FACE_LENSES, LENSES } from '../../app/lenses/catalog.js';

const landmarks = JSON.parse(readFileSync(new URL('../../tests/fixtures/lenses/landmarks.json', import.meta.url)));
const vision = JSON.parse(readFileSync(new URL('../../tests/fixtures/lenses/vision-reference.json', import.meta.url)));
const close = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected} (±${tolerance})`);
const meshFace = (fixture, index = 0) => {
    const face = fixture.faces[index];
    return faceFromMesh(i => face.points[i] ?? null, fixture.width, fixture.height, face.jawOpen);
};
const rect = (x, y, width, height = width) => ({ x, y, width, height });

test('mesh anchors land where macOS Vision puts the iOS anchors on the same photos', () => {
    for (const name of ['solo', 'group']) {
        const fixture = landmarks[name], reference = vision[name];
        assert.equal(fixture.faces.length, reference.faces.length, `${name}: every face is found at 320 px`);
        fixture.faces.forEach((_, index) => {
            const face = meshFace(fixture, index), truth = reference.faces[index];
            // Compare in pixels of the reference photo, in eye distances.
            const W = reference.width, H = reference.height;
            const eyeDistance = Math.hypot((truth.rightEye[0] - truth.leftEye[0]) * W, (truth.rightEye[1] - truth.leftEye[1]) * H);
            const off = (point, [x, y]) => Math.hypot((point.x - x) * W, (point.y - y) * H) / eyeDistance;
            for (const key of ['leftEye', 'rightEye', 'nose', 'mouth']) {
                assert.ok(off(face[key], truth[key]) < 0.08, `${name}[${index}] ${key} within 8% of the eye distance (${off(face[key], truth[key]).toFixed(3)})`);
            }
            const [x, y, width, height] = truth.box;
            close(face.bounds.y * H, y * H, 0.12 * eyeDistance, `${name}[${index}] box top`);
            close((face.bounds.y + face.bounds.height) * H, (y + height) * H, 0.15 * eyeDistance, `${name}[${index}] box bottom`);
            close((face.bounds.x + face.bounds.width / 2) * W, (x + width / 2) * W, 0.08 * eyeDistance, `${name}[${index}] box centre`);
            close(face.bounds.width * W, width * W, 0.2 * eyeDistance, `${name}[${index}] box width`);
            assert.equal(face.jawOpen, 0, `${name}[${index}] closed mouth shows no tongue`);
        });
    }
});

test('jaw drop ignores smiles: grins stay closed, a dropped jaw opens', () => {
    // Measured: closed mouths ~0, the fixture smiles ~0, a toothy grin 0.12.
    for (const closed of [0, 0.05, 0.12, 0.18]) assert.equal(jawOpenAmount(closed), 0);
    assert.ok(jawOpenAmount(0.45) > 0.4, 'an open mouth shows the tongue');
    assert.equal(jawOpenAmount(0.8), 1);
    assert.equal(jawOpenAmount(undefined), 0);
});

test('smoother dampens jitter and bridges short dropouts (iOS testFaceTrackingSmoother…)', () => {
    const tracker = new FaceTrackingSmoother();
    const first = rect(0.30, 0.38, 0.28, 0.25), jittered = rect(0.34, 0.40, 0.30, 0.26);
    tracker.update(first, 0);
    const smoothed = tracker.update(jittered, 1);
    assert.ok(smoothed.bounds.x > first.x && smoothed.bounds.x < jittered.x);
    close(smoothed.mouthOpenAmount, 0.82, 0.001, 'mouth opens quickly');
    for (let frame = 0; frame < 18; frame++) assert.ok(tracker.update(null, 0).bounds, `held on miss ${frame + 1}`);
    assert.equal(tracker.update(null, 0).bounds, null, 'dropped after ~0.6 s');
});

test('smoother ignores subpixel noise but follows real movement', () => {
    const tracker = new FaceTrackingSmoother();
    const first = rect(0.30, 0.38, 0.28, 0.25);
    tracker.update(first, 0);
    const held = tracker.update(rect(0.3005, 0.3796, 0.2804, 0.2497), 0).bounds;
    close(held.x + held.width / 2, first.x + first.width / 2, 1e-4, 'x held');
    close(held.width, first.width, 1e-4, 'width held');
    const moved = rect(0.34, 0.40, 0.29, 0.26);
    const followed = tracker.update(moved, 0).bounds;
    assert.ok(followed.x + followed.width / 2 > first.x + first.width / 2);
    assert.ok(followed.x + followed.width / 2 < moved.x + moved.width / 2);
});

test('motion: velocity is measured, held faces do not drift, carry is bounded', () => {
    const step = 1 / 30, at = x => rect(x, 0.3, 0.3);
    const tracker = new FaceTrackingSmoother();
    for (let frame = 0; frame < 45; frame++) tracker.update(at(0.05 + 0.25 * frame * step), 0, frame * step);
    close(tracker.centerRate.velocity.x, 0.25, 0.025, 'half-frame-per-second face measured');
    tracker.update(null, 0, 45 * step);
    assert.deepEqual(tracker.centerRate.velocity, { x: 0, y: 0 }, 'a held face reports no motion');

    const snapped = new FaceTrackingSmoother();
    snapped.update(at(0.1), 0, 0); snapped.update(at(0.1), 0, step); snapped.update(at(0.6), 0, 2 * step);
    assert.deepEqual(snapped.centerRate.velocity, { x: 0, y: 0 }, 'a jump to another face is not motion');

    const rate = new MotionRate();
    rate.note({ x: 0.1, y: 0.1 }, 1); rate.note({ x: 0.9, y: 0.1 }, 1);
    assert.deepEqual(rate.velocity, { x: 0, y: 0 }, 'samples that do not advance time are ignored');

    // Carry: the main track moves art to the drawing time, capped.
    const track = new FaceTrack({ motion: true });
    const face = x => ({ bounds: at(x), nose: { x: x + 0.15, y: 0.45 }, mouth: null, leftEye: null, rightEye: null, jawOpen: 0 });
    for (let frame = 0; frame < 30; frame++) track.apply(face(0.05 + 0.25 * frame * step), frame * step);
    const measured = track.face.bounds, time = 29 * step;
    const truth = 0.05 + 0.25 * (time + 2 * step) + 0.15;
    const carried = track.carried(time + 2 * step).bounds;
    assert.ok(Math.abs(truth - (carried.x + 0.15)) < Math.abs(truth - (measured.x + 0.15)) * 0.5, 'carrying closes most of the gap');
    const far = track.carried(time + 5);
    assert.ok(far.bounds.x - measured.x <= MAXIMUM_SHIFT + 1e-9, 'at most 0.08 and 100 ms');
});

test('landmark smoothing: dead zone, response and re-acquisition snap', () => {
    const origin = { x: 0.5, y: 0.5 };
    assert.equal(smoothedPoint(origin, { x: 0.501, y: 0.5 }, true), origin, 'noise inside the dead zone');
    const moved = smoothedPoint(origin, { x: 0.52, y: 0.5 }, true);
    assert.ok(moved.x > 0.5 && moved.x < 0.52);
    assert.deepEqual(smoothedPoint(origin, { x: 0.8, y: 0.5 }, true), { x: 0.8, y: 0.5 }, 'a far jump is a new sighting');
    assert.equal(smoothedPoint(origin, null, true), origin, 'held while the face is held');
    assert.equal(smoothedPoint(origin, null, false), null);
});

test('every person keeps their own track, at most three extra, largest first', () => {
    const face = (x, y, width) => ({ bounds: rect(x, y, width), nose: null, mouth: null, leftEye: null, rightEye: null, jawOpen: 0 });
    const tracks = new AdditionalFaceTracks();
    assert.equal(tracks.update([face(0.10, 0.40, 0.20), face(0.60, 0.40, 0.20)], 0).length, 2);
    const moved = tracks.update([face(0.62, 0.41, 0.20), face(0.12, 0.41, 0.20)], 1 / 30);
    const centres = moved.map(item => item.bounds.x + item.bounds.width / 2).sort((a, b) => a - b);
    close(centres[0], 0.21, 0.03, 'left person'); close(centres[1], 0.71, 0.03, 'right person');
    assert.equal(tracks.update([], 2 / 30).length, 2, 'a missed frame is bridged');
    let time = 3 / 30;
    for (let frame = 0; frame < 20; frame++, time += 1 / 30) tracks.update([], time);
    assert.equal(tracks.update([], time).length, 0, 'gone after the hold');

    const crowd = new AdditionalFaceTracks().update([face(0, 0.1, 0.10), face(0.2, 0.1, 0.18), face(0.4, 0.1, 0.16), face(0.6, 0.1, 0.14), face(0.8, 0.1, 0.12)], 0);
    assert.deepEqual(crowd.map(item => Math.round(item.bounds.width * 100)).sort((a, b) => a - b), [14, 16, 18]);
});

test('main face stays on the same person', () => {
    const face = (x, y, width) => ({ bounds: rect(x, y, width) });
    const you = face(0.1, 0.4, 0.20), friend = face(0.6, 0.4, 0.24), previous = rect(0.11, 0.4, 0.2);
    assert.equal(primaryFace([you, friend], null), friend, 'largest to start');
    assert.equal(primaryFace([you, friend], previous), you, 'a slightly bigger friend does not take the lens');
    assert.equal(primaryFace([face(0.1, 0.4, 0.12), friend], previous), friend, 'much smaller hands it over');
    assert.equal(primaryFace([], previous), null);
});

test('fixture group photo: both faces are tracked and drawn', () => {
    const fixture = landmarks.group;
    const tracker = new FaceTracker();
    const faces = fixture.faces.map((_, index) => meshFace(fixture, index));
    tracker.observe(faces, 0);
    assert.equal(tracker.faces(0.016).length, 2);
});

// Jason's selfie as macOS Vision saw it (iOS AccessoryLensTests), 921 x 2000.
const selfie = { face: rect(64, 698, 770), leftEye: { x: 299, y: 896.6 }, rightEye: { x: 596.7, y: 893 }, hairTop: 400 };
const eyeDistance = Math.hypot(selfie.rightEye.x - selfie.leftEye.x, selfie.rightEye.y - selfie.leftEye.y);
const place = (kind, size, time = 0, left = selfie.leftEye, right = selfie.rightEye) => accessoryPlacement(kind, size, selfie.face, left, right, time);

test('crown sits on the hair, the halo floats above it (iOS AccessoryLensTests)', () => {
    const crown = place('crown', { width: 1024, height: 760 });
    const band = crown.center.y + crown.rect.y + crown.rect.height * 0.92;
    assert.ok(band > selfie.hairTop, 'crown is worn, not floating');
    assert.ok(band < selfie.face.y - eyeDistance * 0.3, 'crown stays on the head');
    close(crown.center.x + crown.rect.x + crown.rect.width / 2, (selfie.leftEye.x + selfie.rightEye.x) / 2, 1, 'crown centred');
    for (let time = 0; time < 3; time += 0.25) {
        const halo = place('halo', { width: 1024, height: 360 }, time);
        assert.ok(halo.center.y + halo.rect.y + halo.rect.height * 0.78 < selfie.hairTop, `halo clear of the hair at ${time}`);
        assert.ok(halo.center.y + halo.rect.y + halo.rect.height / 2 > 0, `halo in frame at ${time}`);
    }
});

test('heart shades cover both eyes', () => {
    const shades = place('heartShades', { width: 1024, height: 440 });
    const half = shades.rect.width * 185 / 1024;
    for (const [eye, heartX] of [[selfie.leftEye, 276], [selfie.rightEye, 748]]) {
        const x = shades.center.x + shades.rect.x + shades.rect.width * heartX / 1024;
        const y = shades.center.y + shades.rect.y + shades.rect.height * 236 / 440;
        assert.ok(Math.abs(x - eye.x) < half * 0.5 && Math.abs(y - eye.y) < half * 0.5);
    }
});

test('accessories tilt with the head and fall back upright', () => {
    const tilt = Math.PI / 12;
    const middle = { x: (selfie.leftEye.x + selfie.rightEye.x) / 2, y: (selfie.leftEye.y + selfie.rightEye.y) / 2 };
    const half = eyeDistance / 2;
    const tiltedLeft = { x: middle.x - half * Math.cos(tilt), y: middle.y - half * Math.sin(tilt) };
    const tiltedRight = { x: middle.x + half * Math.cos(tilt), y: middle.y + half * Math.sin(tilt) };
    for (const [kind, size, width] of [['crown', { width: 1024, height: 760 }, 2.5], ['heartShades', { width: 1024, height: 440 }, 2.6], ['halo', { width: 1024, height: 360 }, 2.3]]) {
        // Mirrored camera order must not flip the art upside down.
        const tilted = place(kind, size, 0, tiltedRight, tiltedLeft);
        close(tilted.roll, tilt, 0.001, `${kind} follows roll`);
        close(tilted.rect.width, eyeDistance * width, 0.5, `${kind} width`);
        const upright = place(kind, size, 0, null, null);
        assert.equal(upright.roll, 0);
        const inside = upright.center.x >= selfie.face.x && upright.center.x <= selfie.face.x + selfie.face.width && upright.center.y >= selfie.face.y && upright.center.y <= selfie.face.y + selfie.face.height;
        assert.ok(inside, `${kind} without eyes hangs from inside the face`);
        assert.equal(place(kind, size, 0, middle, { x: middle.x + 20, y: middle.y + 30 }).roll, 0, 'implausible eyes ignored');
    }
    assert.equal(accessoryPlacement('puppy', { width: 10, height: 10 }, selfie.face, selfie.leftEye, selfie.rightEye, 0), null);
});

test('pet parts: ears above the face, nose on the nose, tongue only on a dropped jaw', () => {
    const mapping = coverMapping(landmarks.solo.width, landmarks.solo.height, 375, 500, true);
    const face = screenFace(meshFace(landmarks.solo), mapping);
    const sizes = { ears: { width: 640, height: 249 }, nose: { width: 503, height: 354 }, tongue: { width: 347, height: 512 } };
    const closed = petParts('puppy', face, sizes);
    assert.deepEqual(closed.map(part => part.part), ['ears', 'nose']);
    const ears = closed[0].rect, nose = closed[1].rect;
    assert.ok(ears.y + ears.height * 0.82 <= face.rect.y + 1, 'ears hang from the top of the face box');
    close(nose.x + nose.width / 2, face.nose.x, 0.5, 'dog nose centred on the nose');
    const open = petParts('puppy', { ...face, jawOpen: 0.8 }, sizes);
    const tongue = open.find(part => part.part === 'tongue');
    assert.ok(tongue && tongue.rect.y < face.mouth.y && tongue.rect.y + tongue.rect.height > face.mouth.y, 'tongue hangs from the mouth');
    const bear = petParts('bear', { ...face, jawOpen: 0.5 }, { ears: { width: 640, height: 263 }, snout: { width: 600, height: 420 }, honey: { width: 360, height: 520 } });
    assert.deepEqual(bear.map(part => part.part), ['ears', 'snout', 'honey']);
});

test('cover mapping matches object-fit: cover and mirrors the preview', () => {
    // 4:3 landscape video into a 3:4 portrait stage crops the sides.
    const plain = coverMapping(640, 480, 300, 400, false), mirrored = coverMapping(640, 480, 300, 400, true);
    const centre = plain.point({ x: 0.5, y: 0.5 });
    assert.deepEqual(centre, { x: 150, y: 200 });
    close(plain.point({ x: 0.25, y: 0 }).x + mirrored.point({ x: 0.25, y: 0 }).x, 300, 1e-9, 'mirror about the centre');
    const box = mirrored.rect(rect(0.1, 0.2, 0.2, 0.3));
    assert.ok(box.width > 0 && box.height > 0);
    close(box.x + box.width / 2, 300 - plain.point({ x: 0.2, y: 0 }).x, 1e-9, 'mirrored box centre');
});

test('catalog follows the iOS carousel order and names', () => {
    assert.deepEqual(LENSES.map(lens => lens.name), ['Original', 'Dog', 'Cat', 'Bear', 'Crown', 'Heart Shades', 'Halo', 'Crying']);
    for (const lens of FACE_LENSES) {
        assert.ok(lens.icon, `${lens.name} icon`);
        for (const url of [lens.icon, ...Object.values(lens.art)]) {
            assert.ok(readFileSync(new URL(`../..${url}`, import.meta.url)).length > 1000, `${url} is bundled`);
        }
    }
});
