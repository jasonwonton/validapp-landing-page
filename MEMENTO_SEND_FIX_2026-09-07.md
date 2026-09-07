# Memento send repair — candidate, not deployed

## Confirmed defect

The production `delivery=proxy` response rewrites only the primary image URL.
The secondary image still points to a presigned R2 origin outside the PWA's
`connect-src` policy. The two-view send cannot complete through that path.
Errors were placed inside the long scrolling review, so the send button could
appear to do nothing. The production OpenAPI inspected on September 7 has no
`variant` query parameter on the Memento content endpoint.

Earlier demo responses returned `already_finalized`; adapter tests replaced
the upload method. Those checks did not establish real browser upload parity.

## Prepared repair

- PWA `web-v72`: one shutter captures the two views sequentially. The default
  review is photo, Retake, and Send to the named chat, following the active
  Swift `DailyMomentCameraView` / `DailyHighlightViews` flow. Library, effects
  and caption remain under collapsed More options. A failed second camera has
  an explicit one-photo alternative; simultaneous native capture is not claimed.
- Immediate send progress and failure text stay beside the actions. Repeated
  form submissions are guarded; mutation/cancel controls are disabled during
  delivery. Stalled XHR uploads time out after 60 seconds into existing bounded
  recovery with the stable request identity.
- Backend commit `6984a8999` on `codex/memento-secondary-upload-fix` adds optional
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
- Final cross-browser regression: 206 passed, 6 explicit platform skips,
  zero retries across Android-emulated Chromium, desktop Chromium, Firefox
  and WebKit. The skips are synthetic camera and service-worker harness
  limitations, not physical-device acceptance. The first run had one WebKit
  test-inspection failure (File bodies absent from routing metadata); the test
  now observes Blob sizes at native XHR send and retains real CSP/routing checks.
- UI runtime, syntax, diff checks and backend pre-commit schema validation passed.
- Production-CSP browser test performs real XHR for both routed uploads, then
  exactly one finalize and publish. Separate coverage checks visible errors,
  repeated submits, upload timeout, outbox recovery and update/rollback.
- Build and performance budget passed: 674,922-byte shell transfer estimate,
  below 750,000. Synthetic light/dark reviews were visually inspected at
  393 × 852; actions and feedback remain visible. Physical devices remain open.

## Release gate and reversal

Private staging remains `web-v71` (source `8970744`). These candidates are not
live. Deploy the additive API patch through the backend's normal isolated
release process first; do not deploy unrelated notification/SMS working-tree
changes or blindly deploy the branch base. Then release the independent private
PWA candidate and verify final-origin, intended-account sharing on physical
Pixel, Samsung and iPhone PWA. Production-account sends affect real chats.

The API patch is backward-compatible with the current frontend and iOS.
Frontend rollback is the existing v71 source; preserve pending outboxes and use
the explicit service-worker update flow. Reverting the API patch restores the
known two-view defect, so disable the private Memento entry point if it must be
reverted. Public launch and the overall parity goal remain NO-GO.
