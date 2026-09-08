# Memento send repair — live private staging

Released September 7, 2026. Private owner testing is available; this is not
physical-device acceptance or public release approval.

- API source `e80b940e3f8d33519bddc7dfa2ca17e8ee8fa3f9`, deployment
  `1572613c-2a81-4180-9a0b-3c89645ec446`: ACTIVE, 43/43 steps passed.
- PWA source `46e2fa140700908764cc77fadf42b43ee4e7056e`, `web-v72`, deployment
  `ac4df1ca-24b4-4b22-8224-3eaad1a581d5`: ACTIVE, 6/6 steps passed.
- Only the API component's source branch changed. All admin, APNS, SMS and
  other worker/migration source revisions remain at `e9725209e`; environment
  values and component settings were preserved. No new migration files shipped.
- Follow-up integration PR: https://github.com/christophertran/six7/pull/61.
  The API tracks the isolated `codex/memento-api-release` branch; integrate the
  fix before returning it to the normal main-branch release path.

## Confirmed defect

Before this release, `delivery=proxy` rewrote only the primary image URL.
The secondary image pointed to a presigned R2 origin outside the PWA's
`connect-src` policy. The two-view send cannot complete through that path.
Errors were placed inside the long scrolling review, so the send button could
appear to do nothing. The pre-release OpenAPI inspected on September 7 had no
`variant` query parameter on the Memento content endpoint.

Earlier demo responses returned `already_finalized`; adapter tests replaced
the upload method. Those checks did not establish real browser upload parity.

## Released repair

- PWA `web-v72`: one shutter captures the two views sequentially. The default
  review is photo, Retake, and Send to the named chat, following the active
  Swift `DailyMomentCameraView` / `DailyHighlightViews` flow. Caption, effects
  and More options are removed from Mementos. Photo selection is exposed only
  after camera failure or unavailable access. A failed second camera has
  an explicit one-photo alternative; simultaneous native capture is not claimed.
- Immediate send progress and failure text stay beside the actions. Repeated
  form submissions are guarded; mutation/cancel controls are disabled during
  delivery. Stalled XHR uploads time out after 60 seconds into existing bounded
  recovery with the stable request identity.
- Backend release commit `e80b940e3` on `codex/memento-api-release` adds optional
  `variant=secondary` to the existing authenticated upload proxy and returns
  that URL only for proxy delivery. Native direct uploads and primary defaults
  are unchanged. The service validates ownership, registered secondary size,
  pending state, expiry and JPEG bytes before writing the existing swapped key.
- No schema, APNS/SMS, production flags, storage access, or CSP changes.
  Cloudflare's [R2 CORS guidance](https://developers.cloudflare.com/r2/buckets/cors/)
  informed reuse of the private authenticated proxy instead of broadening
  storage/browser access. No real-account upload or post was made in testing.

## Validation

- Existing Android capture/reciprocity baseline: 2 passed before changes.
- First updated Android camera, effects and Chats/Mementos run: 40 passed.
- Backend Memento tests: 23 passed, including native defaults, both proxy URLs,
  ownership, size, expiry and invalid-variant cases; repository/storage mocked.
- Release-base validation: 132 backend Memento/chat/API/grouping/worker-safety/
  deployment tests passed with a test APNS bundle identifier configured. The
  initial broader run lacked that identifier; no production secrets or delivery
  credentials were supplied. Only the three patch files differ from the exact
  active production source `e9725209e`.
- Final cross-browser regression: 206 passed, 6 explicit platform skips,
  zero retries across Android-emulated Chromium, desktop Chromium, Firefox
  and WebKit. The skips are synthetic camera and service-worker harness
  limitations, not physical-device acceptance. The first run had one WebKit
  test-inspection failure (File bodies absent from routing metadata); the test
  now observes Blob sizes at native XHR send and retains real CSP/routing checks.
- UI runtime, syntax, diff checks and backend pre-commit schema validation passed.
- Final Retake reset regression: 24 passed, 4 synthetic-camera platform skips.
  The full UI run initially had a test-only square-image dimension mismatch;
  corrected to the unchanged 1024×1024 fallback fixture before the passing run.
- Hosted frontend CI `34153522001` passed all four browser projects and static
  checks; optional passkey integration was explicitly skipped. Backend CI
  `34153313468` and PR CI `34153429897` passed PostgreSQL regressions.
- Production-CSP browser test performs real XHR for both routed uploads, then
  exactly one finalize and publish. Separate coverage checks visible errors,
  repeated submits, upload timeout, outbox recovery and update/rollback.
- Build and performance budget passed: 674,505-byte shell transfer estimate,
  below 750,000. Synthetic light/dark reviews were visually inspected at
  393 × 852; actions and feedback remain visible. Physical devices remain open.
- Live `check-staging.mjs` passed private access, shell version, native asset
  hashes, no-store/CSP, exact CORS, production passkey challenge, related-origin
  WebAuthn with a synthetic credential, and signed-out desktop/mobile layout.
- Live `check-memento-staging.mjs` passed API health/readiness, additive upload
  variant schema, exact deployed module hashes, and one-shutter two-view
  synthetic capture under the real origin's CSP with no default picker and
  all camera tracks released. No real account was signed in or posted from.
- Bounded rollout log samples: 1,209 API lines, 50 APNS-chat lines and 50 SMS
  audience-worker lines contained no ERROR/Traceback/read-only errors; the API
  sample contained no response 5xx. Readiness reported writable/schema/identity
  checks passing. These samples are not a throughput or exhaustive error audit.

## Release gate and reversal

Private staging is `web-v72`. Reopen the existing private invitation, accept
Update if offered, and use the production passkey. Verify camera → one shutter
→ review → Retake or Send to the named chat. Check exactly one Memento on iOS
and web after sending. Repeat on physical Pixel, Samsung and iPhone PWA;
production-account sends affect real chats. Do not clear browser storage to
force an update, because it may contain pending sends.

The API patch is backward-compatible with the current frontend and iOS.
Frontend rollback is the existing v71 source; preserve pending outboxes and use
the explicit service-worker update flow. Prior frontend deployment:
`fa9aeee6-6f0c-45f4-bd63-f2ef1311f830`; prior API deployment:
`fbf782d9-96e4-4bfd-8e55-d5d9461f33ee`. Fresh spec snapshots are stored outside
the repository with owner-only permissions. Recheck current configuration
before any rollback so concurrent edits are not overwritten.
Reverting the API patch restores the
known two-view defect, so disable the private Memento entry point if it must be
reverted. Public launch and the overall parity goal remain NO-GO.
