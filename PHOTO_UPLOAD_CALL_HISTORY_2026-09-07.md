# Photo controls, upload diagnosis, and call history

September 7, 2026 · web-v88 live on private staging. Public main remains unmerged.

Verified deployment: `9b3f618c-ef7b-4c63-adce-c9d16ceeda7a`, ACTIVE 6/6,
source `1148f35d99c902f6d99b6f2ae019c303da13ec85`.
Live changed-module hashes, private entry, no-store, API/CSP gates, signed-out
393px/1280px browsers, related-origin synthetic passkey ceremony, and synthetic
camera/review checks pass without real-account writes. API CORS passes; **R2
upload CORS is a separate gate and still fails**. Hosted static CI passes; hosted
browser jobs were still running at this handoff.

## Scope and parity

| Capability | Parity | Release gate |
| --- | --- | --- |
| Photo effects | Native-only / deliberately omitted on web at user request | Removed from chat and Story UI; plain photos, text and stickers remain |
| Scissors | Partial | Upright portable vector matches native control orientation/proportions; not a copied SF Symbol binary; physical-device visual acceptance remains |
| Keep in chat / View once | Equivalent control layout | Fixed 24px SVGs, shared center line, accessible checkbox; physical-device acceptance remains |
| Cancelled/missed/ended call history | Partial | Authoritative existing system message, native viewer-specific labels and duration; real-account cross-client smoke remains |
| Signed chat photo/video/voice upload | Partial | Browser CSP fixed; live R2 preflight rejected; **not production-ready** |

## Upload failure

The chat upload endpoint returns a presigned R2 PUT URL. Unlike the already-released
Memento upload route, it has no proxy-content route. Both the HTTP CSP and HTML
meta CSP excluded the configured R2 account origin, preventing the browser from
reaching storage and producing the reported XHR status-0 connection error.

Only that exact storage origin is added to `connect-src`. Cross-origin uploads
still omit cookies/authorization and retain the server-required Content-Type and
Cache-Control headers. No URL signatures, tokens or private media are logged.
Saved media and stable upload/message request IDs are unchanged. Recovery copy
now says **Valid**, including Mementos and Stories.

There is a second unresolved gate: an OPTIONS preflight for staging, PUT,
content-type and cache-control returns HTTP 403 without allow-origin headers.
Available storage credentials return AccessDenied when reading bucket CORS.
No bucket configuration, backend, iOS, APNS or SMS service was changed.

An authorized storage administrator must inspect the existing `six7-private-media`
bucket CORS rules, preserve them, and add or amend a rule scoped to:

```json
{
  "AllowedOrigins": ["https://staging.validapp.lol"],
  "AllowedMethods": ["PUT"],
  "AllowedHeaders": ["content-type", "cache-control"],
  "MaxAgeSeconds": 300
}
```

This is an additive rule proposal, **not** a replacement for the existing policy.
It does not grant anonymous object access: PUT still requires the backend's valid
signed URL. Do not add public origins or wildcard origins for this private release.
Run `node scripts/check-private-upload-cors.mjs` afterwards, then smoke-test one
real signed upload through finalize/send, thumbnail upload for video, and retry
with the original request IDs. The preflight probe never writes or reads an object.

## Call history

iOS reference: `ChatCallHistoryCard` in `ChatMessageRows.swift`. The backend already
creates and updates a system message with call fields. PWA previously rendered
only generic system text, and call events did not refresh messages. Call events
now trigger the existing bounded authoritative resync, including updates to an
existing room sequence. Acknowledged local start/end/accept/decline also refresh
history if SSE is absent. No fabricated history rows or extra message sends.
Tombstones take precedence over call presentation; membership/403 repairs remain.

## Validation and rollback

Baseline before edits: 29 Android-browser chat/composer/call/contract checks pass.
After changes: focused tests cover no-filter photo/Story flows, alignment in light
and dark modes, authoritative cancelled-call replacement and duplicate SSE events,
hangup with no SSE, removal rules, and native viewer-specific outcomes/duration.
Upload tests separate real XHR under both CSPs with fixture storage from actual
unintercepted local HTTP bytes/headers. Neither claims to validate live R2 CORS.

Focused validation: 114 Chromium/WebKit flow tests pass; all 8 four-browser upload
CSP/transport tests pass; final call and corrected release checks: 94 pass, 2
explicit non-Chromium worker-lifecycle skips. UI runtime, 10 staging gateway tests,
3 static-origin tests and the build pass. Shell: 50 entries, 700,940-byte estimated
compressed transfer, below the unchanged 750KB ceiling.

The broad suite also exposed four pre-existing Android failures, reproduced
against unchanged v87: exact native feed emoji exceptions, ambiguous sticker
selectors, and an exclusive 450-node bound on the already-450-node startup shell.
Tests now preserve those exact product emoji, scope the composer sticker control,
and enforce the existing 450-node ceiling inclusively. Worker version is derived
from the source; CSP assertions enumerate every permitted connection origin.
No runtime limits were relaxed. Physical devices remain unverified.

Broad local sweep: 1,150 passed, 13 explicit platform skips, 17 failures limited
to the pre-existing assertions above plus old version/CSP expectations. Every
failing check was corrected and passed in the final 94-pass/2-skip targeted rerun,
which also covers every call test and the new in-flight-start cancellation race.
This is a broad run plus a targeted rerun, not a claim of a fresh all-green full
suite on one source snapshot. Public release remains gated on CI, real devices,
the storage policy fix and an actual signed upload/finalize/send smoke test.

Storage reference: [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)
and [presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

Revert this frontend commit and deploy a new monotonically increasing worker/app
version to roll back. Previous private staging: web-v87, source
`7e0f298abd42df038c49f124cd6be44568f5dd71`, deployment
`719ac3ff-864b-49ac-bdaf-35d9d8debe84`. No data rollback or outbox clearing needed.
If an administrator later adds CORS, preserve the original policy and remove only
the newly added staging rule to reverse that separate configuration change.
