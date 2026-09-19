# Love Flap on the PWA

The weekly feed entry dispatches to either the existing 67 camera player or an
isolated Love Flap player. No feature flag is added. The public selection remains
67; the latest published Rose Flight / Love Flap works when selected in Admin.

## Package and host

Read the current production Admin catalog before implementation. Latest Rose
Flight release: `afc30d8ab1ad945fccff7c6fb106bd2d879074e56df174c69ee0098f01568399`.
Its exact CDN package has 3,019,456 bytes and SHA-256
`529da2385e5c772909c9b808b1f3c4038ce56a08668f343b88abdb88733ee6f8`.
The package's script hash is
`42c75bbe70bb5026b42ca67b49fa7c06c1e560b36f2827dc408ef1919e778271`.

The original Phaser game, rose artwork, Jua font, integer physics and PNG export
run unchanged in a generated, immutable sandbox document. Its sandbox permits
scripts but not same-origin access, navigation, forms, popups or native device
permissions. Its own CSP pins both scripts by hash and forbids network requests,
frames and workers. The parent accepts messages only from the current iframe,
with its random bridge token and round session. No credentials, account identity,
or API capability are supplied to the game. The optional destination photo is
reduced to 128×128 image data, with the native heart fallback if unavailable.

The parent PWA CSP adds self-hosted frames; its script/style/connect policies are
unchanged. All authenticated app documents still prohibit framing. Camera code
and the regular game host load separately and remain outside the offline shell.

The public CDN package has no browser CORS headers, so its verified bytes are
mirrored with the other immutable weekly-game packages. Run
`node scripts/weekly-game/build-web-host.mjs` to regenerate the hash-bound host.
Unknown package hashes and old Rose Flight validators are rejected before any
ranked run starts. The original historical 20-pipe release is not this player’s
supported release; select the current endless-flight package above.

## Play, scoring and sharing

- Touch/pointer and Space controls, pause/resume, background pause and replay.
- Existing unlock → release run → evidence result API contract, with the server's
  seed and server-confirmed score. Duplicate completion messages cannot submit
  twice; retries retain the original run ID and evidence.
- Failed results persist in bounded, account-scoped storage for reopening and
  retrying within the native one-hour run window. A failed round can also be
  explicitly discarded to start another. No camera-game practice score behavior
  is changed: only this deterministic tap game submits ranked evidence.
- The exact package exports its 1080×1920 rose-and-pipes PNG after score save.
  The host validates the image and uses native file sharing where supported,
  with image download otherwise. No generic fallback poster replaces the meme.
- Leaderboard reads use the selected release; no score migrations or schedule
  changes are performed. Old immutable app and tracker assets remain available.

## Verification

- 79 Node tests pass, including malformed release/evidence rejection, pinned
  native package bytes and script hashes, plus the existing camera scoring suite.
- Combined game browser suite: 58 passed, 14 skips for intentionally unsupported
  camera engines. Love Flap itself plays on Chromium, Firefox and WebKit.
- Final Love Flap suite: 36 passed across Android emulation, desktop Chromium,
  Firefox and WebKit. Includes real package gameplay, keyboard input, poster
  output, server-score authority, replay, persisted save recovery, profile image,
  API request bodies, no camera downloads and sandbox storage/network isolation.
- Broader UI/CSP regression run: 152 passed and four fixture-selector failures.
  Those four were the new keyboard case selecting an unrelated parked dialog;
  the corrected selector is covered by the fully passing final Love Flap suite.
- Four additional browser checks pass for explicitly discarding an unsavable
  round. The service worker now limits its offline HTML fallback to top-level
  `/app/` document navigation, so embedded game pages receive their own HTML.
  Three dedicated routing tests cover this boundary and network-only API reads.
- App-shell performance budget passes: 55 entries, estimated transfer 720,990
  bytes under the existing 750,000-byte ceiling. UI runtime checks pass.

Production-build game checks run with an active controlling service worker in
Chromium and Firefox. The WebKit runner reloads/stalls during service-worker
activation, so its separate game check disables registration in the parent only;
no claim of installed Safari PWA lifecycle verification is made.

Tests use mocked authenticated API boundaries and synthetic accounts, not real
production runs. No production score or social post is created. Physical social
app imports and physical-device Safari/Android behavior are not claimed.

## Deployment

Production deployment `b0ccbc59-621d-463b-82b0-8fbb8818634c` is ACTIVE, with
43/43 steps complete. Frontend branch `codex/pwa-love-flap-release-20260918`,
source `e9351d98954e595ec4e5f4975b38d85428e93d87`, app release
`18bdda6bc2b7de7754e5` (web-v96). The complete app spec differs only in the
frontend branch; all 12 backend/admin/worker/job source revisions are unchanged.

The first live game check caught a stale Cloudflare response CSP: DigitalOcean
static hosting ignores `_headers`, so updating the file and HTML meta policy
alone did not permit the sandboxed game frame. Updated only `frame-src` in the
existing **Valid PWA security headers** rule
`9fbb992c74c7445dbe04f04a00dc9f4c` to include `'self'`. Verified the deployed
response against its captured baseline: all other CSP directives and all seven
other response headers are identical. Rule filter and order are unchanged.
The release checker now fails immediately if the actual response omits this
frame permission, and the deployment runbook documents the edge dependency.

Final live checks pass:

- All 60 app asset hashes, manifest, worker, retained prior lazy modules, startup
  and offline shell checks.
- Current 67 package, model/worker hashes, instructions and real wrist inference.
- Full Love Flap round and one evidence submission to a local API stub, native
  1080×1920 PNG, and clean close on Chromium, Firefox and WebKit using the exact
  production assets and real edge CSP. Chromium/Firefox have active controlling
  service workers; the WebKit registration limitation above still applies.
- Production shell/security, manifest/service worker, related-origin passkeys,
  API health and CORS checks after the edge change.

The public selection remains 67 Challenge; Admin schedule and discovery are
unchanged. These checks did not create real production runs, scores or posts.

Previous deployment: `b9df9fb8-665d-43b1-a204-c75260e734ef`, frontend branch
`codex/pwa-weekly-game-release-20260918`, source
`8e857b93621a8716a50919de0e4d999bbf4c0648`, app release
`a24627fdbddd38022fe1`. Preserve all other components and app settings; rollback
changes only the static frontend branch in the latest full spec.
