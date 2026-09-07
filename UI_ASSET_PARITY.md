# Interface artwork and symbol policy

September 7, 2026 · private staging `web-v71`

User-directed policy: use the real iOS custom artwork where applicable and consistent
portable vector symbols for controls. Do not use emoji as interface decoration.
Never strip emoji from user messages, bios, captions, questions, overlays, or actual
reaction values. This is an intentional web design choice even where iOS currently
uses emoji for streaks, demographic hints, or celebrations.

## Mapping

| Surface | PWA treatment | Parity / release |
| --- | --- | --- |
| Existing brand artwork | The 11 existing source PNGs match iOS: anonymous, aura, crown, letter_aligned, lock, magnifying_glass, message, pencil_clipboard, rocket, scroll, snapchat_logo. UI serves optimized WebP derivatives. | Equivalent asset source / Not yet tested on physical devices |
| Play loading | Real iOS `setting_gear` artwork, optimized to 256px WebP; loading text still works if artwork is unavailable. | Equivalent asset source / Not yet tested on physical devices |
| Notification prompt | Real iOS `notification_bell` artwork, optimized to 256px WebP. | Equivalent asset source / Not yet tested on physical devices |
| Sticker maker control | Real iOS `sticker_icon` template alpha, optimized to 128px lossless WebP; CSS mask follows light/dark foreground color. | Equivalent asset source / Not yet tested on physical devices |
| Streak, edit, photo, person, reply, copy, selection, play, empty reaction controls | Shared 24px current-color SVG family; static onboarding symbols use the same paths. Selected polls also use a vector check in share images. | Partial: portable equivalents, not exported SF Symbols |
| Nomination indicator | Existing iOS crown artwork instead of a crown emoji. | Equivalent asset source / Not yet tested on physical devices |
| System toasts and demographic hints | Plain text; first-letter hints, released gender fields, and the existing minimum-classmate grade privacy threshold are unchanged. | Equivalent information / Not yet tested on physical devices |
| User content and reactions | Unchanged, including the six reaction types and legacy Agree. | Equivalent contract / automated regression coverage |

This is not a claim that every iOS asset or screen is now reproduced, or that the
whole PWA is production-ready. Full screen geometry, physical-device quality,
Stories and other release gates remain in [IOS_WEB_PARITY.md](IOS_WEB_PARITY.md).
Stories, calls and comments remain disabled in private production-account staging.

## Safety and provenance

`assets/app/ios-interface-provenance.json` pins the three newly imported native
source hashes, optimized output hashes, sizes, and conversion settings. No source
artwork was redrawn. Apple-native system symbol binaries were not copied.

No API, iOS, backend, notification delivery, account, or storage contract changes.
No artwork is added to the service-worker shell or a runtime cache. No private
media caching is introduced. New artwork totals 14,620 bytes; all 14 optimized
app artwork files total 373,242 bytes against the unchanged 400,000-byte budget.

## Validation and rollout

- Before edits: four Android profile/header, own-vote, and poll-detail checks passed;
  the existing first-letter hint check also passed.
- `tests/interface-assets.spec.js` enforces the no-decorative-emoji policy across
  app source, pinned asset integrity, unchanged reaction enums, themed vectors,
  preserved user bio emoji, and the native sticker template.
- Existing core, Chats/Mementos, Stories, comments, camera, appearance, service-worker
  upgrade/rollback and visual polish regression suites are required before deployment.
- `scripts/audit-ui.mjs` renders local demo light/dark Feed, Play, Profile, Chats,
  room, camera, review, and preferences. No production account writes are used.
- Private staging only; public deployment and all feature flags remain unchanged.
- Roll back by redeploying the last validated private-staging source
  `5c2054e4404cbff51b3eb9b51caf6a9c5377e605` (`web-v70`). No migrations or data
  rollback are required; pending-send preservation is covered by the existing
  worker upgrade/rollback test. Users may need to accept the app update or reopen.

Physical Pixel, Samsung, iPhone PWA, and real-account cross-client validation are
still outstanding. They must not be relabeled Production-ready based on emulation.

## Recorded local evidence for source `8970744`

- Final consolidated core, visual polish, theme/haptics and interface-asset run:
  **291 passed, 5 platform-specific skips**, four browser projects, no retries.
- Focused verification of artwork, user emoji, first-letter hint, profile, selected
  poll and initial DOM bounds: **40 passed**, four projects, no retries.
- The broader communication/camera/Stories/comments/update run completed with
  469 passes and 11 skips. Four UI failures during iteration (one extra initial
  DOM element and three old demographic-copy expectations) were corrected and
  covered by both clean runs above. No communication or update failure remained.
- A concurrent follow-up run was discarded when its shared local test server
  exited with the original run; the final consolidated run above used its own
  server lifecycle. New visual tests were corrected to use an unlocked demo chat
  instead of bypassing the Memento gate.
- Build, UI runtime, all 7 staging-origin tests, all 3 static-origin tests, and
  unchanged performance budgets passed. Shell estimate: **674,365 bytes**, 42
  entries; route artwork remains outside the offline shell.
- Light/dark screenshots reviewed for Feed, Profile, Play, sticker picker and
  Memento review; camera/room/preferences captures are also saved by the audit
  script. No horizontal overflow in the captured main panels.

## Live private-staging evidence

Deployment `fa9aeee6-6f0c-45f4-bd63-f2ef1311f830` is ACTIVE on the exact tested
source `8970744ac5427e72fb64bfa80c4e628aa314f0ec`. The existing staging specification
was reused without changing environment values or feature flags.

`scripts/check-staging.mjs` passed on the live site with expected version `web-v71`:
all three native asset bytes match the pinned hashes; private access, HTTPS/CSP,
no-store, cohort gates, exact CORS origins, and cross-origin rejection passed.
Signed-out 393px and 1280px Chromium layouts had no runtime errors or horizontal
overflow. Related-origin WebAuthn used only a synthetic credential and never
submitted an assertion to production. No real-account content was mutated.

Remote full-suite CI run `34151710075` is tracked separately from these completed
local and live checks; it was still running at the time of the staging smoke test.
Public production deployment and full physical-device parity are not approved by
this evidence.
