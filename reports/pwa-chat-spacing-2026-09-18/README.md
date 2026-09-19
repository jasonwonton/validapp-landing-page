# PWA spacing follow-up — September 18, 2026

Release web-v98, `36b9a13606a19f38c2a5`.

Compared the native `ChatMessageRows`, `ChatMessageReactionControl`, `ReactionSummaryCluster`, `ChatInboxCardModifier`, and `FeedItemRow` wrapper with the actual browser layout.

- Reaction pills: 25px minimum height, 13px emoji, 11px count, 3px cluster/count gap, and 4px below the bubble. Removed the negative margin that made the laughing reaction overlap the bubble. Cluster up to three types, sorted by count with native tie-breaking; show one aggregate count. Preserve selected-reaction tint.
- Message rows: 2px within a sender sequence, 10px between sequences, 4px between name/bubble/footer. Empty sender labels no longer add an empty grid track.
- Only the latest outgoing message shows the regular read indicator. Older receipts stay available in Message actions.
- Sent timestamps are in Message actions rather than taking a line in every message. This matches native row height without reproducing iOS's swipe-to-reveal gesture. Sending/failure status stays visible.
- Chat list: 12px gaps, 60px avatars, 6px title/preview separation, and native 16×12 content insets accounting for the CSS border.
- Feed: 8px between outlined rows rather than touching borders.

The new dark-mode preview was inspected visually, and DOM measurements confirmed the reaction's 25px height and 4px bubble separation.

Safari correction: WebKit could move a content-visibility:auto feed row between pointerdown and pointerup. A reproduced diagnostic showed those events landing on different cards. Apple browsers now lay out feed cards normally; other browsers retain offscreen rendering optimization. The same diagnostic then passed with a stable tap target.

Validation: 88 chat spacing/scrolling/windowing/media/history browser cases passed across all four configurations. The broader 176-case run passed 175 and exposed the Safari feed tap issue; the final complete eight-case Safari inbox suite passes after the correction. Other browser inbox cases passed. Runtime contracts, performance budget, built release hashes, offline startup and retained previous-release assets pass.

Production: deployment `12f5755e-113e-4d51-aade-307dfad32c70` ACTIVE, 43/43. Frontend source `b6c07c304db2a7f718841c57fff969ae1491e29b`; branch `codex/pwa-chat-spacing-release-20260918`. All 12 other component revisions and the remaining full app specification were preserved. Public release checks passed 62 exact asset hashes, all-browser startup, Chromium offline/API-cache isolation, and previous-release lazy asset retention.
