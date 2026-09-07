# Poll-detail screenshot correction

User report: `IMG_5871.PNG`, September 7, 2026. The screenshot exposed real
contrast and layout failures, not backend defects. This follow-up changes CSS
and the normal PWA version marker only; no application data/interaction logic.

## Corrections

- Detail navigation now pairs the theme background with its foreground instead
  of hard-coded light aqua under white dark-mode labels. Poll toolbar buttons
  have 44px targets; the sender heading wraps on compact phones.
- Peach options and yellow Snapchat sharing use fixed black text. The reveal
  action uses a matching light/dark surface and foreground.
- Question type tops out at 28px; artwork stays square and contained, capped at
  280px or 32% of the small viewport height. Existing artwork URLs are unchanged;
  no cropping, media replacement or new generic stock artwork is introduced.
- Options use 20px text, 88px minimum height, bounded columns and wrapping names.
  Selection keeps the emoji-free check, removes the glow and reserves enough
  space between rows and before the hint to prevent overlap.
- The share row is less dominant, with 48 × 52px secondary platform targets.

## Native reference and deliberate web adaptations

Compared with `ios/Six7/Six7/Views/Feed/QuestionDetailView.swift`, shared
`QuestionArtworkView.swift` and `QuestionDetail/Components/PollOptionViews.swift`.
Native uses `primaryButtonText` on peach and Snapchat yellow, a 28px question,
rounded artwork, a two-column option grid and a selection marker. Web retains
the existing vector check instead of the native pointing emoji, and caps artwork
by viewport height to leave more room for results/actions. These are deliberate
web layout alternatives, not a claim of pixel-identical iOS rendering.

## Validation and release gate

New `tests/poll-detail-appearance.spec.js` reproduces the reported question and
four-name layout with synthetic data in both themes at 320, 393 and 440px. Checks
cover 4.5:1 text contrast, no selection/next-row overlap, bounded square artwork,
44px controls, no horizontal overflow, and an accessible moderation menu.
Screenshots are in ignored `artifacts/poll-detail/`; no user screenshot is bundled.

Existing sharing, hints, reveal gating, moderation, backend APIs, account state,
private caching policy, notifications and Chats/Mementos are unchanged. Staging
remains private; Stories/calls/comments rollout flags stay off. Overall parity
remains Partial pending physical-device acceptance.

Rollback baseline: frontend deployment `15bfbfb1-2f3d-4950-832e-530f4a8c0c2d`,
source `ac1840906971c59d29043f9c831c3add0777119d`, `web-v76`. No migration or backend
rollback is needed. Preserve the installed app's update/version progression.

Release evidence will be appended after validation and live checks.
