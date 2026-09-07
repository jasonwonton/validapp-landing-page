# Chat and Memento hierarchy audit — September 7, 2026

## Scope and decision

Frontend-only follow-up for private staging, web-v74 (superseding web-v73). No backend, API contract,
APNS, SMS, membership, moderation, or production feature-flag changes.
The overall PWA remains **Partial / Not yet tested**, not Production-ready.

The user was right: the old PWA kept the week rail, capture banner and member
thumbnails above the conversation even after posting. API-compatible behavior
had not established iOS interaction parity.

## Source comparison and implementation

| Journey | Swift authority | Before | This pass | Remaining acceptance |
| --- | --- | --- | --- | --- |
| After posting a Memento | `ChatRoomView.swift:849`, `:1425`, `:1484` | Permanent calendar/banner/thumbnail strip | Conversation contains messages and composer; top-right Mementos button opens history only after the authoritative posted flag | Physical side-by-side iOS/PWA review |
| Capture progress / streak | `ChatRoomView.swift:1425`, `:3041`; `ChatListView.swift:1090`, `:1295` | Streak data ignored | Server `moment_streak` in inbox and header, positive counts only and at least two accepted members; posted/eligible progress clamped; named accessibility label | Multi-account streak changes, midnight/DST and push timing |
| Memento history | `DailyHighlightViews.swift:498` | In-line thumbnail strip | Dedicated Close / Mementos sheet, seven dates and two-column cards; viewing does not change today's composer access | Physical gestures, screen-reader reading order, large groups |
| Stickers | `ChatRoomView.swift:2010`; `StickerFeature.swift:433` | Buried in photo/video form, removal always visible | Separate composer button using the imported iOS sticker glyph, three-column library, tap to send; removal behind Edit with confirmation | Physical creation/cutout ergonomics; native automatic subject extraction is not claimed |
| Composer camera | `ChatRoomView.swift:2010` | Camera reopens today's Memento | Camera opens ordinary photo/video flow; Memento capture appears only when not posted and eligible | Regular media remains picker-based; live capture/recording and voice entry still need a separate native-flow pass |
| Capture / review | `DailyMomentCameraView.swift`; released web-v72 | Already simplified one-shutter sequential two-view capture, swap, Retake / Send | Preserved, not redesigned again | Real Pixel, Samsung, iPhone PWA camera acceptance; no claim of simultaneous dual-camera support |

Swift paths above are under `ios/Six7/Six7/Views/Chats/` in the Six7 repository.
This is source comparison and rendered browser review, not a running iOS
simulator or physical-device certification. Colors, typography and existing
artwork retain the Six7 identity; no decorative emoji were added.

## Safety checks in this change

- **Contract correction:** the backend's `viewer_has_posted_today` is global,
  while `viewer_has_shared` is scoped to this chat. The PWA now uses the latter
  for capture/history placement, exactly like Swift `viewerHasShared`. Posting
  in one chat must not hide capture in another. Added an explicit two-chat test.
  No backend change was needed; the existing service and repository already
  make this distinction.

- A missing or failed current-day gate check hides the composer and cached
  message content; it also suppresses read receipts and pending text retries
  until authoritative access is known.
- Historical rows never determine today's gate, capture availability or header.
  Late date responses are ignored after another selection, closing history or
  changing chats. Realtime updates are likewise scoped to the room generation.
- History cache is reset between rooms and pruned to the current seven dates.
  Closing the history sheet removes its image DOM. No new persistent media cache.
- Saved-sticker sends allow one in-flight request, preserve identity on explicit
  same-sticker retry, scope retry identities to the chat, and cap them at 50.
  Ambiguous sticker creation still never auto-retries. These send identities
  remain in-memory; recovery after closing a tab is not newly guaranteed.
- Existing Memento and media outboxes, upload/finalize/publish, reaction values,
  private URLs, server membership rules and service-worker allowlist are retained.

## Validation and release record

- Pre-change Android-emulation baseline: reciprocity, gallery actions and saved
  sticker send **3 passed**.
- New hierarchy suite covers header/inbox streaks, posted-screen cleanup,
  correct camera destination, stale history responses, failed access checks,
  rapid sticker taps, stable retry identity and 320px light/dark layouts.
- Existing reciprocity/gallery, rich-media, sticker cutout/deletion and icon
  tests were updated to use the new entry points without weakening contracts.
- `scripts/audit-ui.mjs` adds posted-room, history and standalone sticker views
  to the existing light/dark screenshots. These contain synthetic/demo data.
- Build, UI runtime, gateway (7), static-origin (3) and performance budgets pass.
  Shell: 42 entries, 676,759 estimated transferred bytes (<750 KB budget).
- Broad Chromium/Pixel-emulation, desktop Chromium, Firefox and WebKit run:
  **425 passed, 11 explicitly skipped**, zero retries. Includes contracts,
  core journeys, Mementos, sticker creation, recovery and update/rollback.
  Skips are platform-limited camera, service-worker and mobile-only tests,
  not passed device acceptance.
- Final hierarchy/realtime/outbox/call/update suite on all four lab projects:
  **66 passed, 2 service-worker platform skips**, zero retries. This includes
  the final selected-date contrast and realtime streak/chat-switch checks.
- Light/dark posted-room, inbox, history and sticker renders were inspected.
  The review caught and fixed the indistinct dark selected-date background.
  Private-origin results are recorded after deployment below.
- Additional production-adapter and bounded message-window checks:
  **132 passed** across all four lab projects, zero retries.
- The initial web-v73 deployment became active during the last contract audit.
  It retained a pre-existing global/per-chat posted-flag mismatch; web-v74
  corrects that frontend mapping and includes a new worker version so clients
  do not retain the superseded module. The two-chat regression is mandatory.
- Final per-chat correction, hierarchy, Mementos, capture and HTTP-contract
  rerun: **200 passed, 4 synthetic-camera platform skips**, zero retries, across
  all four projects. Final web-v74 update/rollback: **2 passed, 2 platform skips**.

## Rollback and next work

Deploy only the existing private staging frontend after final validation.
Prior private frontend: web-v72, source
`46e2fa140700908764cc77fadf42b43ee4e7056e`, deployment
`ac4df1ca-24b4-4b22-8224-3eaad1a581d5`.
Rollback that frontend only. No backend rollback or migration is needed for
this UI pass. Keep Stories and calls gated off; do not broaden the cohort.

Still open: ordinary photo/video/voice composer simplification, real-device
keyboard and scrolling, Stories, push tray behavior and background recovery,
screen readers, and intended-account staging acceptance. Screenshot/screen
recording detection remains native-only with the documented web alternative.
