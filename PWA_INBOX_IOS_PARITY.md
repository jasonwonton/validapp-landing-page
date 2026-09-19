# Inbox and opened-content parity

Compared on September 18, 2026 against the local iOS source in `ios/Six7/Six7/Views`. Implemented in the isolated `codex/pwa-ios-design` frontend checkout. No production deployment or live-user mutation.

## Changes

- Polls, TBHs, and Ask Me use flat inbox rows, 60px avatars, capsule content badges, and native text sizes. Timestamp and comment controls occupy separate positions.
- Poll details use 28px questions and 22px option names with 100px minimum option height. Explicit server selection wins over duplicate names. Nominations have a separate celebratory card. Submitted polls show named or anonymous author attribution; eligible anonymous author rows support the native God Mode reveal endpoint with explicit reveal/aura confirmation.
- Opened Polls and TBHs include reactions, comments, and Send. Reactions and comment counts stay synchronized with the inbox. Send requests the native backend share link, then opens browser sharing or copies the link.
- TBH details use the author's/subject's avatar, full heading, timestamp, prompt, bordered response, context, and Snapchat/Instagram/TikTok buttons. Story artwork is generated lazily. Anonymous author names are excluded from public story content.
- Ask Me messages use native provenance icons and centered question typography. Received replies open as a full page, with Done, recipient heading, and two response cards. Browser Back returns to the inbox.
- School Questions aligns the title, segmented tabs, identity choices, prompt and image panels, permission/cost flow, scrollable submit action, and history-card geometry. The anonymous choice correctly states that God Mode can reveal the submitter.

## Native references

- `Feed/FeedItemRow.swift`, `Feed/FeedView.swift`
- `Feed/QuestionDetailView.swift`, `Feed/QuestionDetail/Components/PollSnapshot.swift`, `Feed/QuestionDetail/Components/PollOptionViews.swift`
- `Feed/TbhResponseViews.swift`, `Play/TbhRequestViews.swift`
- `Ask/AnonymousQuestionInboxSection.swift`
- `Shared/QuestionSubmissionSheet.swift`
- `Services/Networking/APIClient/APIClient+PollComments.swift` and `APIClient+Users.swift` for sharing/reveal contracts

## Verification and limits

`tests/inbox-ios-parity.spec.js` covers badges, reaction synchronization, Ask Me navigation, school-question scrolling/privacy text, nomination and explicit-selection behavior, confirmed author reveals, share URLs, public-artwork privacy/size, and native endpoint contracts. Existing poll appearance, comments, TBH, Ask Me, question submission/history, and share-recovery suites cover the surrounding flows.

The review at `output/inbox-parity/preview.html` compares pre-change PWA screenshots with the built PWA using identical demo data, in both themes. Responsive captures cover 320px, 390px, and 440px widths. This is source-based alignment, not a claim of physical-device pixel equality. iOS uses SF Symbols, native photo/share sheets, and native transitions; the PWA uses SVG equivalents and browser capabilities. Browser share-sheet destination ordering and handoff to Snapchat/Instagram/TikTok cannot be made identical to iOS native SDK integration. Production endpoint contracts were checked against source and mocked adapters, not exercised against live accounts.

## Completed validation

- 240 browser checks passed across Android Chromium, desktop Chromium, Firefox, and WebKit for inbox/detail parity and related UI regressions.
- 80 additional browser checks passed for Poll/Ask Me flows and production-adapter contracts, including school-question submission, history, deactivation, and idempotent retry. Total: 320.
- 60 built-app captures (10 screens × 2 themes × 3 widths) had no root/detail horizontal overflow and no page runtime errors.
- Static-origin suite: 5 passed. UI runtime and transfer/DOM performance budgets passed.
- Final immutable release: `24d7985dcc3fc0e34be2`. Previously tracked immutable releases are preserved.
