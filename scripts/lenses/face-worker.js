import { FaceLandmarker, FilesetResolver } from '../../assets/weekly-game/mediapipe-0.10.32/vision_bundle.mjs';

// Face Landmarker for camera lenses. Frames arrive downscaled from the main
// thread, one in flight at a time; only landmark coordinates and two
// blendshapes leave the worker, never pixels.
let detector;
let lastTimestamp = -1;
self.onmessage = async ({ data }) => {
    if (data.type === 'init') {
        try {
            const root = new URL('/assets/weekly-game/mediapipe-0.10.32/', self.location.origin).href;
            const fileset = await FilesetResolver.forVisionTasks(root + 'wasm');
            const options = delegate => ({
                canvas: new OffscreenCanvas(1, 1),
                baseOptions: { modelAssetPath: root + 'face_landmarker.task', delegate },
                runningMode: 'VIDEO', numFaces: 4, outputFaceBlendshapes: true,
                outputFacialTransformationMatrixes: false,
                minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
            });
            let delegate = data.delegate === 'GPU' ? 'GPU' : 'CPU';
            try { detector = await FaceLandmarker.createFromOptions(fileset, options(delegate)); }
            catch (error) {
                if (delegate !== 'GPU') throw error;
                delegate = 'CPU';
                detector = await FaceLandmarker.createFromOptions(fileset, options(delegate));
            }
            self.postMessage({ type: 'ready', delegate });
        } catch (_) { self.postMessage({ type: 'error', stage: 'init' }); }
        return;
    }
    if (data.type !== 'frame') return;
    const { image, timestamp } = data;
    try {
        // VIDEO mode needs strictly increasing timestamps.
        const time = Math.max(lastTimestamp + 1, Math.round(timestamp));
        lastTimestamp = time;
        const started = performance.now();
        const result = detector.detectForVideo(image, time);
        const inferenceMs = performance.now() - started;
        const faces = [], transfer = [];
        for (let index = 0; index < result.faceLandmarks.length; index++) {
            const landmarks = result.faceLandmarks[index];
            const points = new Float32Array(landmarks.length * 2);
            for (let i = 0; i < landmarks.length; i++) { points[i * 2] = landmarks[i].x; points[i * 2 + 1] = landmarks[i].y; }
            const shapes = result.faceBlendshapes?.[index]?.categories || [];
            const score = name => shapes.find(shape => shape.categoryName === name)?.score ?? 0;
            faces.push({ points, jawOpen: score('jawOpen'), smile: (score('mouthSmileLeft') + score('mouthSmileRight')) / 2 });
            transfer.push(points.buffer);
        }
        self.postMessage({ type: 'faces', timestamp, width: image.width, height: image.height, inferenceMs, faces }, transfer);
    } catch (_) {
        self.postMessage({ type: 'error', stage: 'frame' });
    } finally { image.close?.(); }
};
