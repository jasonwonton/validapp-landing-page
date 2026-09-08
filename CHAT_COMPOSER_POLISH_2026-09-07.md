# Chat composer and photo review — private web-v84

## Audit

User evidence: IMG_5876–5878. The screenshot gaps are real, not iOS parity:

- The fixed composer kept the bottom-tab reservation while the keyboard reduced/panned Safari's visual viewport; the page/header could also scroll independently.
- Photo review still used a generic form with big buttons, a verbose delivery checkbox, and unrelated voice controls.
- The native photo toolbar's cutout and saved-sticker actions were missing.

Native reference: `ios/Six7/Six7/Views/Chats/ChatRoomView.swift:2110–2265` places camera/sticker controls beside the field and microphone inside it. `ChatMediaCaptureView.swift:915–1080` places Retake, cutout, My Stickers and close above the photo, and delivery mode plus a circular send below it.

## Changes

- One visual-viewport-sized chat room; header, timeline and composer share its layout. Keyboard mode removes the tab reservation, follows viewport offset, and leaves only a small keyboard gap. Existing bounded history and anchor-preserving scrolling remain.
- Inline microphone with local recording, elapsed time, stop/preview, discard/re-record and send. Unsupported codecs retain explicit M4A selection. Camera no longer offers voice controls.
- Photo-first review with compact Retake, scissors, native sticker glyph, text edit, close, Keep in chat/View once pill and circular send. Ready/sequencing narration removed. Camera initially focuses its container, not Cancel; keyboard focus indication remains available.
- Saved/cutout stickers add to the photo rather than sending another chat message. Placements use normalized contained-image coordinates; touch drag/pinch and keyboard move/resize are bounded. A selected sticker has a touch-accessible remove control.
- Eight placements maximum, each fetched with a 15-second deadline and 2 MB/2048²-pixel limits. JPEG output remains under 8 MB. Decoded bitmaps and object URLs are released on reset; no private images are added to service-worker caches.
- Pending microphone permission is rejected after discard/chat changes. Active recording stops on leaving the room, hiding the panel/document or ending the session. A new recording cannot send the previous preview. Media retry identities remain stable and are captured before asynchronous work.

## Scope and remaining gates

Frontend only. No Swift, API endpoints/contracts, backend, database, APNS or SMS changes. Staging's existing cohort/auth gates stay in place. Main/public deployment is not part of this release.

Parity is **Partial**, release **Not yet tested**, not Production-ready. Remaining native differences include voice hold/slide/lock and waveform UI, sticker rotation, native photo-library UI and platform codec restrictions. Physical Pixel, Samsung and installed iPhone PWA tests must verify keyboard open/close/rotation, microphone interruptions, camera transitions, dark-mode readability, sticker pinch placement and actual two-account sends.

## Validation and rollback

Automated checks cover camera permission cleanup, both themes, chat hierarchy, simulated visual viewport keyboard/pan, photo sticker pixels/count bounds, one-message send, compatible voice preview/re-record/send, M4A fallback, scrolling, existing media contracts, durable outbox/retry and service-worker upgrade/rollback. Automated viewport simulation is not a physical keyboard test. Final results and deployment evidence are recorded below before handoff.

- Broad four-project run: 499 passed, 13 capability skips, four failures in one new test's data-URL fixture (blocked by the unchanged production CSP).
- Corrected same-origin fixture and final implementation rerun: 188 passed, four capability skips, zero failures across composer, Chats/Mementos, camera, contracts, recovery and update/rollback suites. This includes actual baked sticker pixel assertions and voice re-record/send.
- UI runtime, performance budget, nine private gateway tests and three static-origin tests pass. Shell transfer estimate ~694 KB, 47 shell entries. No runtime dependency added.
- Visually inspected mobile light keyboard/pan layout, dark chat, dark photo review and sticker placement. These are automated-browser renders, not physical-device acceptance.
- Exact committed-source camera/composer rerun: 34 passed, two platform skips, zero failures.

Private staging is live at `https://staging.validapp.lol/app/`, web-v84, source `41be924be99af09cb731d489ee1855d91e2829d8`, deployment `2c27f6fa-9e4c-43b8-9a91-c99910e029cb` (ACTIVE, 6/6). Both live scripts pass: private access/CSP/origin gates, mobile/desktop signed-out runtime, synthetic related-origin passkey ceremony, exact deployed module hashes, synthetic camera capture/review/track cleanup, inline mic and photo-toolbar checks. No real-account message, media upload or signup was used for automated live validation. Main and the public/shared-backend deployment are unchanged.

Rollback target: private staging deployment `4e168a39-be2f-4c4d-a4b3-b6c0da540ae8`, source `7fdb8b54e6f9d0b0b286d48409defc0d75656ff3` (web-v83). Redeploy that source to the same private staging app; no schema rollback or changes to public/backend infrastructure are needed. Preserve existing queued sends and use the normal app-update flow.
