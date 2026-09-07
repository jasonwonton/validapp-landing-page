# Six7 iOS / PWA experience audit — September 7, 2026

## Decision

**The PWA is not at native-experience parity. Public release remains NO-GO.**
The earlier matrix put too much weight on API-compatible operations and demo
tests. Those are necessary, but they did not catch a picker-first Memento
camera or sufficiently establish real-device visual and interaction quality.

This pass reviews the consumer surface inventory, Swift design/camera sources,
web implementations, and rendered demo Feed, Play, Profile, Chats, room,
camera and review screens in light/dark modes at 393 × 852. It is **not** a
side-by-side rendered iOS screenshot certification, physical-device audit,
production-account write test, or complete screen-reader audit. The iOS
simulator was not running. Call, Story and onboarding comparisons here are
source-based, not live-device acceptance.

## Cross-product findings

| Surface / journey | Experience parity | Finding and next acceptance gate |
| --- | --- | --- |
| App shell / tabs | Partial | Existing vector tabs and aqua background align with iOS. Fixed near-black inactive tabs in dark mode. Installed safe areas, keyboard transitions, back gestures and tab restoration still need physical comparison. |
| Feed / School / filters | Partial | Cards, reactions and data controls exist. Screenshot review finds dense layout; contrast and full empty/loading/error states need a systematic final pass. Do not replace actual reaction/user-content emojis with UI icons. |
| Play / polls / nominations | Partial | Brand typography, artwork and action layout are present. Physical small-screen, keyboard, animation and motion/accessibility checks remain. iOS explicitly uses the fire emoji for streaks. |
| Profile / Settings | Partial | Header, stats, account actions and icon treatments are broadly aligned. Fixed shared primary-button contrast in dark mode. Photo acquisition and crop gestures remain less native; destructive account flows require disposable accounts. |
| Sign-in / signup / onboarding | Partial | Related-origin passkeys have staging infrastructure and synthetic-browser proof. User-owned passkey, permissions, keyboard and complete signup on devices remain separate gates. Private staging is existing-account focused. |
| Chats list / navigation | Partial | Replaced ad-hoc emoji/glyph controls with 24px vector symbols. Centered the 28px Chats heading and aligned 12px/3px card treatment to Swift. Long lists, VoiceOver/TalkBack, and physical scrolling remain. |
| Chat room / text / replies / reactions | Partial | Backend authority and recovery retained. Vector camera, send, attachment, back and action controls now use a common system. Keyboard, media interruption and multi-account realtime acceptance remain. |
| Memento acquisition | Partial | **Fixed picker-first default:** live video preview, shutter, sequential second view, camera switch, single-view choice, retake and explicit library fallback. Unlike iOS this does not promise simultaneous front/back capture. Physical lens selection, orientation, selfie mirroring and camera interruptions remain. |
| Memento review / sharing / history | Partial | Fixed layout overlap and separated scrolling review content from always-reachable Share/Skip controls. Existing compression, swappable composites, audience, idempotency and history contracts retained. Date boundaries and real-account/device confirmation remain. |
| Chat photo/video composer | Partial | Existing preparation/upload/recovery and view-once rules remain; photo/video acquisition still uses a picker. Next priority is sharing a tested camera experience here, then video recording/codec/device handling. |
| Voice messages / stickers | Partial | Voice capture and fallback exist; sticker creation is supported. Audio route, permission interruptions and real-device cutout ergonomics remain. |
| Stories / overlays | Partial | Existing Story acquisition is still picker-based. Fixed invalid border declarations, but multi-clip capture, editing and device gestures remain. Disabled in the private cohort. |
| Calls | Partial | Replaced phone/video fallback glyphs with shared vectors. Open-app API flow exists; real two-account devices, route changes and interruptions remain. Disabled in private cohort; reliable closed-app ringing is native-only. |
| Notifications | Partial | Functional coverage does not certify tray grouping, exact destination, preferences, badges or background delivery. Physical push acceptance and broad-campaign coverage remain open. |
| Offline / retries / updates | Partial | Bounded outboxes and shell caches remain; new camera frames are memory-only until explicit sharing enters the existing outbox. Upgrade/rollback tests must preserve pending sends. Closed-tab upload completion is not guaranteed. |
| Accessibility / Dark Mode | Partial | Fixed inactive-tab and primary-button colors plus invalid border rules. Labels and keyboard controls exist. Full contrast, text scaling, screen readers and 44px targets across all screens are not signed off. |
| Screenshot / recording detection | Native-only | No reliable web detection claim. Existing safety explanation and server-enforced access rules must remain explicit. |

## Changes in this candidate

1. A first-class, full-screen Memento camera replaces file-picker-first capture.
2. At most one live video stream and two captured views; no microphone request.
   Old streams stop before switching, on cancel, background/page hide, account
   exit, and after capture. Late permission resolutions stop their tracks.
   Repeated permission requests cannot accumulate while one remains pending.
3. Permission denial and camera failures explain recovery and offer an explicit
   file fallback. A single-view capture is deliberate, not a fabricated second
   camera. Photos are not uploaded merely by taking them.
4. Shared vector interface icons replace camera, chat-empty, lock/wait,
   phone/video, back, send, attachment and overflow placeholders. Product
   reactions, streaks and user text are preserved.
5. Chats heading/card geometry and the Memento card's white surface/peach
   camera tile now follow the Swift sources more closely.
6. Review scrolls independently while Share stays reachable; the visual review
   caught and corrected a grid-overlap defect before deployment.
7. Dark inactive navigation and primary-button text colors corrected; eight
   invalid `solid var(--line)` border declarations use a color token instead.
8. Versioned shell update includes the two new static modules. No camera frame,
   API response or private media is added to service-worker caches.

Swift anchors: `Views/Chats/DailyMomentCameraView.swift`,
`Views/Chats/DailyHighlightViews.swift`, `Views/Chats/ChatsTabView.swift`,
`Views/Chats/ChatListView.swift`, `Views/MainTabView.swift`,
`Views/Settings/ProfileHeaderSection.swift`, `Views/Play/StreakCounterView.swift`,
`Views/Feed/CustomSegmentedControl.swift`,
`Views/Onboarding/ProfilePhotoSelectionView.swift`, and `Utilities/Six7Theme.swift`.
Six7's Jua typography and illustrated aqua/peach design are intentional iOS
choices, not replaced with a generic system-app theme.

## Evidence and remaining work

- Baseline Chats/Mementos: 28 Android-emulation tests passed before this pass.
- Core navigation, production adapters, chat contracts and live-camera suite:
  **323 passed, 9 explicitly skipped**, zero retries, across Pixel emulation,
  desktop Chromium, Firefox and WebKit. Skips cover platform-specific service
  workers/mobile sheets and synthetic camera devices, not passed acceptance.
- New tests cover live two-view capture without a file chooser, single-view
  capture, retake, background release, permission denial, late permission
  completion, and vector controls. Real synthetic video uses Chromium only;
  cross-engine error/lifecycle tests do not establish physical camera support.
- `node scripts/audit-ui.mjs` creates light/dark captures in `artifacts/ui-audit`.
  Camera images show the synthetic green test feed, not a person's camera.
  Main surface captures were inspected; all eight main-tab captures had no
  horizontal overflow and restored scrollY=0 in this demo sequence.
- Final camera, Chats/Mementos, outbox recovery, effects, CSP, call contracts,
  UI polish and service-worker suite: **294 passed, 6 explicitly skipped**,
  zero retries. The update test exercises v67 → v69 → v67 → v69 with a
  pending send and offline reload. The WebKit late-permission mock was fixed
  after an earlier failing run; both final suites pass its lifecycle check.
- Backend, production flags, APNS and SMS systems are unchanged by this pass.
- Build, UI runtime, seven private-gateway tests and three static-origin tests
  pass. The shell remains within its 750 KB transfer budget: 671,298 estimated
  bytes across 41 cache entries. This is a build budget, not measured device
  startup latency.

Next: validate the new capture on the owner's actual device, then extend the
camera/composer treatment to chat photos and Stories; perform rendered iOS/PWA
comparison at matched viewports and text sizes; finish physical accessibility,
keyboard, push and multi-account realtime acceptance. Do not promote a surface
to Production-ready until these gates have evidence.

## Staging and reversal

This is a private staging update, not public launch. Use the existing private
invitation and production passkey; actions still affect real production data.
Reload and accept the app's Update prompt to activate the new shell. Reversing
the independent staging deployment to the prior `c8fbb404` source restores the
old frontend. The old worker can install as a waiting update; preserve pending
sends and request user acceptance rather than deleting browser storage.
No backend rollback or database change is required for this frontend slice.

Owner acceptance on each physical device:

1. Reopen the private invitation, accept Update if shown, and sign in with the
   production account. Opening the camera alone must not create a Memento.
2. In a chat, tap today's Memento: expect a live preview and camera permission,
   not a file chooser. Check portrait/landscape framing, front/rear switching,
   one/two-view capture, retake, and the final composite's orientation.
3. Deny permission, use the explicit photo fallback, then restore permission.
   Background, return, cancel and reopen; camera use must stop while hidden or
   closed. Verify controls and Share remain reachable with the keyboard open.
4. Share only to an intended real chat. Confirm exactly one Memento on iOS and
   web, correct audience/history and no duplicate after refresh/retry. Sharing
   is a real production action; use disposable accounts for destructive tests.
