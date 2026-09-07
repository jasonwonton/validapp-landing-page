# Native feed sender labels — private web-v81

The previous PWA said `from Sophomore girl (M)` and retained graduation-year
suffixes. iOS uses paired product emoji and a compact 12-point secondary line.

Reference: `FeedItemRow.swift` (grade formatter, genderEmoji, personalDetailLine,
schoolDetailLine, detailRow) and `TbhResponseViews.swift` (tbhAuthorLine).

Polls now use `from a 👧💗 Sophomore`, `from an 👦💙 8th grader`, and
`from a 🧑💛 Senior`. TBHs preserve the native ordering: `from a Senior 👦💙`.
Names/reveals/own-vote markers take precedence; only API-provided subscriber hints
appear. Two distinct classmates in the normalized grade are required for ordinary
grade hints, matching the native safety fallback. Missing demographics are never
inferred from classmates. Graduation-year suffixes are omitted from sender labels.

This restores intentional iOS product emoji; it does not reintroduce decorative
emoji controls. Native emoji glyph artwork varies by operating system.
Sender labels use 12px secondary text with natural wrapping in light/dark mode.

Tests cover formatting aliases, all three gender pairs, article grammar, hidden
and missing demographics, duplicate-classmate safety, subscriber/reveal precedence,
own votes, mobile layout, feed navigation and the PWA update lifecycle. Exact run
results and deployment evidence are recorded on release PR 1. Physical acceptance
remains open; the whole feed is still Partial in the parity matrix.

Frontend only. Backend, notifications, queues, and Stories/calls gates unchanged.
Private staging only; main unmerged. Rollback: source
`e0683886eecd0c4faa9b9e412a91e6877a769667` (web-v80), private deployment
`230462f0-d156-48fa-a2d2-b7f6354fbd23`. No data migration.
