# Browser weekly-game assets

All detector assets are self-hosted and fetched only after Enable camera. They
are not service-worker precache entries and never receive camera frames over
the network. Inference runs in a bounded, single-in-flight browser worker.

- MediaPipe Tasks Vision **0.10.32**, official npm package `@mediapipe/tasks-vision`.
  npm integrity: `sha512-3tiAZnmKloYnRXYoO3dKltTUGnqeCwzC4lV03uY0vCsE+aveJTyEVQyZHOlQGQNsjK+gRHzkf9q08C99Qm2K0Q==`.
  Source: https://github.com/google-ai-edge/mediapipe (Apache-2.0).
- Pose Landmarker Lite float16 model, version **1**:
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
  SHA-256 `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`.
  Model documentation: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker
- The tracker bundle is built by `node scripts/weekly-game/build-tracker.mjs`.
  Its filename contains a content hash. Retain previous tracker bundles for open
  clients. The generated `app/weekly-game/tracker-asset.js` pins that exact file.
- `packages/` mirrors the exact public selected immutable game package. The CDN
  currently omits browser CORS headers; no application/backend/storage policy
  is loosened to work around that. SHA-256 and byte count are verified at runtime.
  Downloaded script is never evaluated. Only the reviewed script fingerprint
  is accepted, with its equivalent bundled hand-motion implementation tested
  against the shared native/server fixture vectors.

When publishing another camera package, mirror its hash-verified bytes here and
add its hash to `MIRRORED_PACKAGES`. Existing artwork/rules can change with the
same reviewed script. A new script requires an explicit implementation review
and fixture parity before its fingerprint is accepted. Unsupported runtimes
show an update message and never request camera access.
