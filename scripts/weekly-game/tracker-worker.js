import { FilesetResolver, PoseLandmarker } from '../../assets/weekly-game/mediapipe-0.10.32/vision_bundle.mjs';
let detector;
self.onmessage = async ({data}) => {
    try {
        if (data.type === 'init') {
            const root = new URL('/assets/weekly-game/mediapipe-0.10.32/', self.location.origin).href;
            detector = await PoseLandmarker.createFromOptions(await FilesetResolver.forVisionTasks(root + 'wasm'), {
                canvas: new OffscreenCanvas(1,1),
                baseOptions: {modelAssetPath: root + 'pose_landmarker_lite.task', delegate:'CPU'},
                runningMode:'VIDEO', numPoses:1, minPoseDetectionConfidence:0.5,
                minPosePresenceConfidence:0.5, minTrackingConfidence:0.5, outputSegmentationMasks:false,
            });
            self.postMessage({type:'ready'});
        } else if (data.type === 'frame') {
            try {
                const result = detector.detectForVideo(data.image, data.timestamp);
                const landmarks = result.landmarks[0];
                const wrists = landmarks ? [landmarks[15],landmarks[16]] : [];
                const visible = wrists.length === 2 && wrists.every(p => p && p.visibility >= 0.5 && (p.presence ?? 1) >= 0.5 && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
                // Preview/recording are mirrored. Contract coordinates originate
                // at bottom left and are ordered by screen position.
                const pair = visible ? wrists.map(p => ({x:1-p.x,y:1-p.y})).sort((a,b) => a.x-b.x).flatMap(p=>[p.x,p.y]) : null;
                self.postMessage({type:'sample',timestamp:data.timestamp,pair});
            } finally { data.image.close(); }
        }
    } catch (_) { self.postMessage({type:'error',message:detector ? 'Hand tracking stopped. Please retry.' : 'Hand tracking could not load. Check your connection and try again.'}); }
};
