# Chat camera, inbox and profile native-flow correction

September 7, 2026 — frontend-only follow-up, intended for private staging `web-v76`.
No Six7 backend, APNS, SMS, schema, iOS code or API contract changes in this release.

## Source comparison and deliberate alternatives

Swift references are relative to `six7/ios/Six7/Six7/`.

| Surface | iOS authority | Web correction | Parity / acceptance |
| --- | --- | --- | --- |
| Message camera | `Views/Chats/ChatRoomView.swift:2130`, `ChatMediaCaptureView.swift:139` | Composer camera immediately requests live capture; one shutter produces one photo, then a full-screen review with Retake / Send. Library selection is explicit, editing controls collapsed. Existing upload/finalize/message/outbox flow retained. | Partial: physical camera acceptance pending; live video recording, focus/zoom and tracked effects not claimed. MP4 library selection remains available. |
| Memento capture | `ChatRoomView.swift:1490`, `Utilities/Six7Theme.swift:515` | 210 × 46 peach capsule, 3px black outline, 4 × 5px push shadow, filled camera alternative and “Take Memento” label. Accessible name remains “Take today's Memento.” | Partial: sequential dual-view Memento and server gate preserved; physical acceptance pending. |
| Sticker entry | `ChatRoomView.swift:2146`, `StickerFeature.swift:23` | Existing imported `sticker_icon` artwork at 21px, peach tint, slight thickening and white/surface circular button with 2px outline; 44px web target. | Partial: native artwork used, portable rendering rather than SF Symbols. |
| Inbox tint | `ChatListView.swift:36` | Flat 22% brand peach over the theme's white/surface card, including invitations. No directional gradient. | Equivalent at CSS/source level; physical visual review pending. |
| Inbox order | `Models/ChatModels.swift:148`, `ChatListView.swift:206,312` | Same priority tiers: enabled missed calls → invitations/regular unread/unopened view-once media → unposted Mementos → normal. Initial server order within tiers; only new activity or priority changes reposition rows. Monotonic activity watermark; removed memberships prune history. | Equivalent policy under unit tests. Calls remain disabled in staging. Skipping permits reading but still leaves unposted Memento attention, as in Swift. |
| Profile feedback | `app/preferences.js` device availability | Entire vibration group hidden when Android Vibration API support is absent; Appearance remains available. Supported devices retain test and opt-out. | Partial: API presence cannot prove the phone physically vibrated or override OS suppression. |
| Profile bio/streak | Native `ProfileHeaderSection` | Orange filled vector flame, secondary count; plain Add bio with contrasting circular plus instead of white-on-white. | Equivalent affordance under light/dark browser assertions; no decorative emoji introduced. |

## Safety and validation

- Camera initialized only on entry, not chat load; one live stream, one memory-only
  regular photo. Existing Memento default still captures two sequential views.
- Dismissal, backgrounding, page hide, retake and late permission paths stop tracks.
  Closing invalidates pending preparation and releases object URLs. Session end
  closes the regular camera as well as Memento camera.
- Single active media publish guard; capture/source controls disabled during
  upload. Existing stable request IDs, durable outbox and backend access checks
  remain authoritative. No new persistent media cache or background retry loop.
- Unit policy coverage added to `scripts/test-ui-runtime.mjs`; camera, fallback,
  late permission, profile themes and controls covered by
  `tests/chat-camera-native.spec.js`. Existing media/effects/offline tests now
  expand the explicit Edit photo control. WebKit pointer assertions allow CSS
  pixel rounding while still verifying the sent overlay location.
- Real-CSP rendered screenshots in ignored `artifacts/ui-audit/`, including
  `light-chat-camera.png`, `dark-chat-photo-review.png`, inbox and Memento button.
- Live check extended to hash every changed runtime module and exercise deployed
  single-photo camera/review with a synthetic adapter and stopped tracks. No real
  account messages, read receipts, uploads or posts are used by validation.

## Rollout and rollback

Private staging only: `https://staging.validapp.lol/app/`, existing invitation and
account access. Public readiness remains **NO-GO** pending physical Pixel,
Samsung, iPhone PWA and complete journey acceptance. Stories and calls remain off.

Prior known-good deployment: `5f720110-98b8-4d9d-afb0-80f6d536108c`, runtime
`016b505d2203cf0cf3f99c5e053c1791273447db` (`web-v75`). Frontend rollback only;
no migration or server rollback needed. If rolling back the served shell, keep
the app update protocol's version progression in mind and verify the installed
PWA actually receives the intended assets.

The following evidence verifies the released source and live deployment;
this document is not physical-device certification.

## Released evidence

- **Live:** `web-v76`, source `ac1840906971c59d29043f9c831c3add0777119d`;
  frontend deployment `15bfbfb1-2f3d-4950-832e-530f4a8c0c2d` is ACTIVE, 6/6 steps.
- **Final frozen-source browser run:** 883 passed, 13 explicit platform skips,
  zero retries, 5.8 minutes across Android/desktop Chromium, Firefox and WebKit.
  Targeted WebKit late-permission coverage also passed after using a stable
  media-device fixture. The first full attempt caught a one-node startup budget
  overrun; the haptics wrapper was removed rather than relaxing the budget.
- **Local non-browser checks:** UI runtime/inbox policy tests, 7 staging gateway
  tests, 3 static origin tests, build and performance budgets pass. 42 offline
  shell entries; estimated transfer 678,831 bytes, below the 750 KB cap.
- **Real deployed checks:** private admission, no-store, cohort gates, CSP,
  exact runtime/artwork hashes, related-origin synthetic credential ceremony,
  Memento dual-view capture, ordinary single-photo capture/review, gallery,
  stickers and stopped camera tracks all pass. Synthetic adapters only; no
  production-account authentication, sends, reads or uploads.
- **Unchanged systems:** no changes to `app/api.js`, `app/chat/outbox.js`, either
  serving/proxy implementation, iOS or the Six7 backend in this release.
- **Hosted verification:** [workflow 34161854022](https://github.com/jasonwonton/validapp-landing-page/actions/runs/34161854022)
  passes static checks and all four browser jobs on the exact released source.
  Optional private-backend passkey integration is intentionally skipped, not
  counted as a passing integration.

Remaining native-composer differences are deliberate open parity work, not
closed by this patch: native focus/zoom gestures, held video recording and
tracked camera effects; web library MP4/M4A alternatives remain. The existing
web Keep-in-chat default is unchanged (iOS initially selects View once), and
the web checkbox has not been converted to the native delivery-mode pill.
