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

## Release evidence

- Private staging is active on `web-v77`, frontend source
  `2855783609bce07522c52511ab27507e570b6dc9`, deployment
  `0ade8f7c-1d44-4f79-8d2f-fd7eac43db90` (6/6 deployment steps).
- Frozen-source local suite: **907 passed, 13 explicit platform skips**, 5.7
  minutes, zero retries. The targeted appearance suite passed all 24 combinations
  across Android Chromium, desktop Chromium, Firefox and WebKit.
- Build, UI-runtime checks, seven staging-server tests and three static-origin
  tests passed. Shell budget: 42 entries, 679,029 estimated transfer bytes, below
  the 750 KB limit.
- Live checks passed for `web-v77` and exact deployed module/style hashes,
  private access, HTTPS/CSP, no-store, rollout gates, origin preservation,
  signed-out mobile/desktop layout, and synthetic related-origin WebAuthn.
  Existing synthetic Memento/chat camera, review, stopped-track, streak, history
  and sticker checks passed. API health/readiness and the existing additive
  secondary-upload contract were checked read-only. No real-account sends,
  uploads or authentication were performed.
- [Hosted CI run 34163392489](https://github.com/jasonwonton/validapp-landing-page/actions/runs/34163392489)
  passed all four browser jobs and static release checks on this exact source.
  The first desktop Chromium job crashed with SIGSEGV while creating a browser
  context, before the adapter test ran; this was not a failed product assertion.
  Rerunning that failed job without source changes passed. Optional private
  backend passkey integration remains explicitly skipped, not tested by CI.

Physical-phone acceptance is still pending. This is a private-staging UI release,
not completion of the broader parity goal or approval for a public rollout.
