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
- Face Landmarker float16 model, version **1** (camera lenses, `assets/lenses/`):
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
  SHA-256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` (3,758,596 bytes).
  Model documentation: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker
  The lens worker shares this directory's 0.10.32 runtime and wasm.
- The tracker bundle is built by `node scripts/weekly-game/build-tracker.mjs`.
  Its filename contains a content hash. Retain previous tracker bundles for open
  clients. The generated `app/weekly-game/tracker-asset.js` pins that exact file.
- `packages/` mirrors the exact public selected immutable game package. The CDN
  currently omits browser CORS headers; no application/backend/storage policy
  is loosened to work around that. SHA-256 and byte count are verified at runtime.
  hand-package-v1 script is never evaluated. Only the reviewed script fingerprint
  is accepted, with its equivalent bundled hand-motion implementation tested
  against the shared native/server fixture vectors (v2: see below).

When publishing another camera package, mirror its hash-verified bytes here and
add its hash to `MIRRORED_PACKAGES`. Existing artwork/rules can change with the
same reviewed script. A new script requires an explicit implementation review
and fixture parity before its fingerprint is accepted. Unsupported runtimes
show an update message and never request camera access.

## hand-package-v2 camera games (Scuba Challenge)

hand-package-v2 packages carry their own mechanics and sprite art, which the
iOS host runs in a separate WKWebView. The web does the same with the exact
reviewed script: `scripts/weekly-game/build-camera-host.mjs` verifies the
mirrored package bytes and the script's SHA-256, then writes an immutable host
in `camera/<hash>/index.html` whose CSP admits only that script and a small
JSON bridge (no network, media, workers or frames). The player loads it in an
opaque-origin `sandbox="allow-scripts"` frame and exchanges JSON only: the
package receives normalized wrist rows and detections, never camera frames,
audio or credentials, and every response is bounded as on iOS (score never
decreases, at most +10 per response, ≤96 valid sprites, ≤64 sprite images).
`app/weekly-game/camera-hosts.js` maps package SHA-256 → reviewed script hash
and host, and the Feed shows a v2 game as playable only when it has a host.

To add a v2 game: mirror its public package here, review the script, add
package/script hashes to `REVIEWED` in the build script and rebuild. Keep old
host directories for open clients. A selected camera game without a web host
still appears in the Feed, opening a friendly "play it in the Valid app" state
with the school leaderboard. Web rounds remain practice: the release's
self-reported-v1 validator would accept a web score, but ranked web play is a
product decision that has not been made.

## Love Flap / Rose Flight

The regular web game uses the exact published package
`529da2385e5c772909c9b808b1f3c4038ce56a08668f343b88abdb88733ee6f8`.
`build-web-host.mjs` verifies its bytes and generates an immutable HTML host in
`web/`, with hashed scripts and an opaque-origin iframe sandbox. The native
package's Phaser engine, physics, rose, Jua font and score poster are unchanged.
No game script executes in the authenticated parent. Only the selected release's
seed/rules and optional small profile image enter the sandbox; the parent owns
API calls and native sharing. Keep old host directories for already-open clients.

For future regular packages, explicitly verify/register the new package and
its host mapping. The initial mapping supports the latest endless-flight release
with the Love Flap poster, not historical 20-pipe builds. No upload or Admin
selection is performed by the frontend build.
