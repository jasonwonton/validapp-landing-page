# 67 challenge on the PWA

Recommendation: explore a separate, unranked Android Chrome prototype. It is feasible; the major work is replacing the native host, not recreating the score mechanic.

The existing `games/src/hand-camera.mjs` already scores normalized wrist observations in JavaScript. iOS currently supplies those observations through Apple Vision, continuity checks, a bounded analysis queue, native round lifecycle, and a recorded video compositor. The PWA has camera/recording infrastructure but no weekly camera-game host or wrist detector.

A browser version needs:

1. Lazy-load a self-hosted detector/model only when opening the game. Test MediaPipe Hand Landmarker and Pose Landmarker against the relevant motion; iOS testing often preferred anatomical wrists from its body model, so choosing hand-only detection by name would be premature.
2. Run inference off the UI thread with bounded, latest-frame processing. Feed measured timestamped wrists into the existing scoring module; preserve continuity breaks, sample spacing, scoring deadlines, and missing-data rules.
3. Add foreground/background lifecycle, permission failure handling, orientation/mirroring, warm-up, countdown, score UI, replay, and safe camera cleanup.
4. Add camera-plus-overlay video export through canvas capture and MediaRecorder, checking actual supported MIME types and destination imports on phones.
5. Integrate release discovery/session APIs and server replay validation behind a separate web flag. Keep scores unranked initially; do not mix different detector behavior into the shared leaderboard before accuracy testing.

Acceptance: still hands score zero; exactly ten deliberate swaps score ten; manually annotate fast-motion runs for missed and extra crossings; test hands leaving/reentering frame, overlap, palms up/down, dim lighting, older/midrange Android devices, and a warmed-up phone. Measure usable pairs, continuity breaks, latency and score error—not FPS alone. Recording must not materially worsen those results.

References:
- Local `docs/camera-tracking-learnings.md` and `games/SHARING_README.md` distinguish native tracking, downloadable mechanics, and camera-video sharing.
- Google browser Hand Landmarker: https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js (synchronous inference blocks the UI; use workers).
- Canvas recording: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream
- MediaRecorder: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder

This is a source/architecture assessment, not a prototype or a claim of measured browser accuracy.
