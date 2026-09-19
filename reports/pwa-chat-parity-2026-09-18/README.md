# PWA chat and feed parity — September 18, 2026

Release: web-v97, `609e7e4f4d1bb89ded80`.

The PWA now exposes the existing shared chat-history setting: Keep history, Clear after 24 hours, and Clear after leaving. These use the deployed history API, including exact visible-message view/exit receipts, durable retry after interrupted sessions, saved-message controls, expiry while offline, and authoritative reconciliation on history events. Automatic modes require confirmation and apply to all members. Saved messages and Mementos are protected. No database migration or backend change is included.

View-once cards follow native 174×56 sizing, photo/video markers, delivery/open/replay labels, hold-then-tap replay, and replay eligibility scoped to the current chat visit. Photos close after five seconds with pause support; videos play and close at their end. Reveal is decoded before acknowledging the server session. Inbox media actions honor Memento access gates. The Memento toolbar uses an angled photo-stack vector and native count/streak hierarchy; inbox streak and missing-Memento attention follow native eligibility, including skipped Mementos. Activity status is grouped into System settings. Feed rows regain native-style 3px outlines.

Native references: `ChatMessageBubble.swift`, `ChatMediaViewer.swift`, `ChatRoomView.swift`, `ChatRoomDetailsViews.swift`, `ChatListView.swift`, `Models/ChatModels.swift`, `Services/Chats/ChatHistoryRetention.swift`, `FeedView.swift`, and `Utilities/Six7Theme.swift` in the Six7 iOS checkout.

## Verification

- 83 Node unit tests passed; the four new parity/receipt tests passed again on final source.
- 71 Android Chromium chat/inbox/history/presence/windowing regression tests passed.
- 114 desktop Chrome/Firefox/WebKit regression tests passed; three initial new-flow failures targeted an older message outside the current history window. The test now saves a message in the visible window.
- All 28 final new-flow tests passed across Android Chromium, desktop Chromium, Firefox, and WebKit. This includes a real decoded H.264 video fixture and rejected history writes.
- Runtime contract, production preflight, and performance budget checks passed (estimated shell transfer 726,775 bytes).
- Built release: all 62 asset hashes, previous release lazy modules, all-browser startup, Chromium offline shell and API-cache isolation passed.
- Built 67 package/model/worker verification and real model inference passed. Love Flap full-round and share-image checks passed in Chromium, Firefox, and WebKit with score APIs locally stubbed; WebKit's test runner disables service-worker registration for that game test.
- Visual review of feed outlines, chat media cards, Memento header, shared-history choices, and System settings in the built preview. Fixed an extra outgoing bubble background discovered in dark mode.

## Bounds

This is targeted parity for the requested surfaces, not certification that every iOS screen is identical. Browser rendering and platform glyphs differ; the Memento glyph is a portable vector matching the native angled-photo motif. Multi-item automatic view-once advancement remains separate work. No real user's chat history was changed or deleted during verification, and no live two-account expiry test was performed. The retention integration uses the existing production backend contract and mocked browser cases rather than destructive production test messages.

Production deployment and verification details are recorded after rollout below.
