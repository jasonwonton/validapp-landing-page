# Interface artwork and symbol policy

September 7, 2026 · private staging candidate `web-v71`

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
