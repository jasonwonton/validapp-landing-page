# iPhone message actions parity — September 18, 2026

Release web-v100, `53b1efbc53307b5a5e3e`.

Compared native ChatMessageActionOverlay, ChatMessageActionMenu, ChatMessageMenuButtonStyle, ChatMessageActionMenuLayout, and ChatMessageGesturePolicy against PWA behavior.

- Hold for 360ms with 10px movement tolerance. Text and media both support actions; scrolling and pointer cancellation abandon the hold. The release click cannot accidentally open or consume media, including when the finger remains held for several seconds; suppression lasts through release plus the native 200ms delay. View-once replay retains its independent hold-then-tap gesture.
- The browser top-layer modal matches the native 320px maximum width, 12px screen margins, 18px corners, 8px row spacing, and subtle backdrop. Position near the press without scrolling the timeline. Constrain height and allow menu scrolling on short screens.
- Six 25px reaction emoji in equal 44px-high rounded tiles. Copy/Reply share a row; Delete for me, Save/Unsave, and Unsend for everyone use full-width rows. Save has the native bookmark icon and explanatory subtitle.
- Match eligibility: no Unsend for Mementos, no Save for view-once, Copy only for text, and no reaction/reply/delete/unsend for pending messages. Retain timestamps and older read receipts as secondary menu details.
- Support right click, keyboard focus containment, Escape/outside dismissal, screen resizing and session exit. Realtime removal of the selected message closes the stale menu.

Validation: 20 new gesture/placement/media cases pass across Android Chrome, desktop Chrome, Firefox and WebKit. Existing chat/media/history suite passed 137/140 on the initial implementation; placement failures led to a CSS cascade correction, then all eight cases covering the two affected flows pass across the four browsers. Another 64 scrolling/realtime/composer cases pass. Runtime contracts and performance budget pass (estimated shell transfer 730,091 bytes). Built-release verification passes all 63 exact asset hashes, four-browser startup, Chromium offline startup/API cache isolation and retained v98 lazy assets. Visually inspected the actual built menu in light and dark mode, including a 390×844 phone viewport.

These are browser automation and visual checks, not physical-device touch measurements. No production messages or accounts were changed during testing.

Production: deployment `6faf5055-e9af-4831-a71d-430b36d6e136` ACTIVE, 43/43. Exact frontend source `3cfe9f51a1ba4b8caf22e40a21a6ab27e769f09c`, branch `codex/pwa-chat-actions-held-release-20260918`. All 12 other component revisions and the remaining full app specification were preserved. Live verification passed 63 exact asset hashes, four-browser startup, Chromium offline startup, previous-release asset retention, security headers, PWA manifest, related-origin passkey configuration, API health and CORS. The extended hold/release regression passed all four browser configurations.
