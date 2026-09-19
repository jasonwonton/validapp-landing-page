# Weekly camera game on the PWA

The PWA's feed now opens the selected 67 Challenge directly, without a feature
flag. It uses the native package's cat instructions, soundtrack, branding and
hand-motion counting rules. Camera frames stay on-device. Completed rounds
produce a 720×1280 video with score, countdown/reaction presentation, native
sharing where supported, download fallback, replay, and the school leaderboard.

Web rounds are **practice** in this initial release, as discussed. They never
create a backend run or write a leaderboard score. Opening the leaderboard
creates the existing one-time discovery record if required by the native API. Physical Android motion
accuracy and thermal/recording performance have not yet been measured; native
and browser leaderboard scores are not mixed on the basis of synthetic tests.

## Runtime and compatibility

- Self-hosted MediaPipe Tasks Vision 0.10.32, Pose Landmarker Lite float16 v1.
  Only opening the camera loads the model/WASM worker. No new third-party
  runtime origin, global CSP relaxation, or service-worker model precache.
- Inference runs in a single-in-flight worker. Fresh image-derived wrists are
  screen-ordered, mirrored consistently with the video, normalized to the native
  bottom-left coordinate convention, and retain their capture timestamp.
- Native-style separation, time-aware association and loss/continuity rules
  prevent stale/predicted coordinates from creating crossings. Evidence retains
  30 ms minimum spacing and the scoring deadline; the reaction interval drains
  pending inference before finalization.
- Chrome/Chromium supports this player. Firefox detected a static image but its
  continuous recorded-round start was unreliable. WebKit worker initialization
  stalled in integration testing, including with an explicit OffscreenCanvas.
  Firefox and Safari therefore receive a supported-browser message before any camera
  request; iPhone/iPad browsers link to the existing Valid iOS app. This browser
  compatibility check is not a rollout feature flag.
- Closing, backgrounding, incoming calls, permission failure, late permissions,
  detector failures, and replay release camera/audio/worker/object-URL resources.
  Package download and model/inference/finalization waits are bounded.
- Optional microphone denial falls back to video and the bundled soundtrack.
  File sharing depends on the browser/OS. Physical third-party social app imports
  have not been verified; download remains available.

## Package delivery

The production Admin catalog was read through its authenticated API. The active
public release is `2c57f8ca3408c460e31a16d6dc59c576916910a2f7b91f6b59184c159e7c1747`.
Its exact 412,705-byte package has SHA-256
`75eeb783b361dfbf063465a6b87aac862db76831d31aeab601488d2b2e8cfa46`.

Both public CDN hostnames currently omit browser CORS headers. The PWA includes
an identical immutable package copy at its own origin, verified for size/hash
before use. No bucket policy, CDN setting, native release selection or backend
configuration was changed. The existing storage credential cannot read bucket
CORS administration; the same-origin copy avoids requiring expanded access.

Downloaded JavaScript is never evaluated in the authenticated app. The known
native script fingerprint selects its reviewed bundled equivalent; shared
fixtures verify both implementations. Unknown script fingerprints/runtimes show
an update message before camera access. For another package with the same
supported mechanics, copy its verified immutable bytes and register its hash as
documented in `assets/weekly-game/README.md`. New mechanics need an explicit web
implementation and fixture parity. This release is not an arbitrary-code game
sandbox and does not implement the older Love Flap web runtime.

## Validation

- 73 Node tests pass, including shared native/server/package scoring vectors,
  exactly ten smooth swaps → ten points, still wrists → zero, overlap/loss/jump
  controls, evidence spacing/cutoffs and malformed/package-hash rejection.
- Focused Chromium tests exercise actual model loading and landmark detection,
  blank images, a full real-detector still-person round at zero, actual encoded
  video dimensions/playback, sharing fallback, replay and camera cleanup.
  Synthetic moving observations separately exercise the full recorded-round UI.
- The production-built player passes exact hashes for all game/model/WASM/worker
  assets, package/artwork loading and actual wrist inference under production CSP.
- Existing app-shell offline/startup/hash checks and performance budgets pass.
  Shell transfer estimate: 720,844 bytes across 55 precache entries, within the
  existing 750,000-byte budget. All 57 versioned app assets match their hashes;
  the previous deployed release's lazy modules remain available.
- Broad browser run: **1,314 passed, 27 skipped, 3 initial failures**. Two failures
  were existing test-fixture races (idle HTTP teardown and observing the shell
  before the profile request). Both were fixed and all eight cross-browser
  rechecks passed. The third was Playwright retaining a compatibility-test title
  after that test was renamed during the run; the final weekly-game suite
  independently passes the renamed compatibility test on Firefox and WebKit.
- Final weekly-game suite: **30 passed, 14 intentionally skipped** across Android
  emulation, desktop Chromium, Firefox and WebKit. The skipped camera scenarios
  concern unsupported engines; their pre-permission compatibility UI is tested.
- Follow-up leaderboard/API tests after the discovery fix: **12 passed** across
  all four projects. The two existing regression fixture fixes also pass all
  **8** focused rechecks. No production assertions were weakened.

A static public test image is not a real Android camera/motion test. No production
account was created, no game score was submitted, and no social post was sent.

## Deployment

Production is active at https://validapp.lol/app/.

- DigitalOcean deployment: `b9df9fb8-665d-43b1-a204-c75260e734ef` (**ACTIVE**, 43/43 steps).
- Frontend source: `8e857b93621a8716a50919de0e4d999bbf4c0648`, branch
  `codex/pwa-weekly-game-release-20260918`.
- App release: `a24627fdbddd38022fe1` (`web-v95`).
- Exactly the frontend branch changed. All 12 other component source revisions
  and the rest of the complete app configuration match the captured baseline.
- Live manifest, service worker, security headers and all 57 versioned app assets
  match the reviewed build. Android emulation and desktop Chromium startup/offline
  checks pass; no API responses enter offline caches. Firefox and WebKit
  signed-out startup checks also pass.
- Every live model/WASM/worker/game-package byte matches its local hash. The
  production player loads the native instructions and runs actual wrist
  inference in its worker under production CSP, without camera permissions or
  production score writes.
- Production preflight passes app shell, PWA manifest/worker, related-origin
  passkeys, API health and CORS. Previous-release lazy modules remain available.
- The selected Admin release/package still matched the verified fixture before
  activation. No native game package, schedule, or rollout setting was changed.

Rollback is the
previous frontend branch `codex/pwa-ios-parity-release-20260918`, source
`ea90b2ab05cc650ea8eb03806e30dfc17ac3c19a`, app release
`24d7985dcc3fc0e34be2`. Use the latest full DigitalOcean spec and change only the
static frontend branch, without `--update-sources`. Preserve unrelated backend,
worker, environment, routing and feature settings and all old immutable assets.
