# PWA parity implementation — October 20, 2026

## Source identity

- Backend/iOS integration reference: six7 PR #736, `799025a63dfe9550792c3ad647faf7736aed0d18`, iOS 1.6039 (2). The PR is draft; final qualification is pending. This comparison does not declare it approved or alter release testing.
- Previous submitted iOS baseline: `origin/rel/1.6038`; exact identity recorded in the final evidence ledger.
- Current PWA candidate: `7232c8c04a3937d5f2a773e4db3556b091372acd`, `codex/pwa-parity-release` in validapp-landing-page. Shared uncommitted passkey work is excluded and preserved.
- PWA main: `ef4a7e5495a5abaf1b1fa95a456e4b2e9b4fbf85`. This implementation builds on the existing PWA candidate, including its already implemented chat/media/recovery work.
- Implementation: isolated `codex/pwa-ios-16039-parity` worktree; reference checkout is read only. No deployment, production flag changes, migrations, or phone installation.

## Implementation sequence

1. Complete Friends journeys using existing people/friends/block/privacy/add-link APIs. Reconcile relationships after writes, foregrounding, and relaunch; fence late results by account and request lifetime.
2. Close current Inbox/Ask Me Received/Sent/discovery/navigation and authentication/privacy gaps against the integration candidate. Preserve anonymous sender protections and server policy decisions.
3. Complete browser media transport and supported capture/share journeys using the established upload and ingest pipeline. Keep Memify and other runtime gates authoritative.
4. Add focused journey/contract regressions, then run affected browser suites at mobile and desktop sizes, static checks, lint/type validation and the production build. Capture before/after evidence and open a PR with precise remaining device/platform checks.

## Existing behavior retained

The candidate already supplies Feed/Play, TBH, named comments, chat text/media/outboxes/search/pagination, Mementos, Stories, Vault, Stripe billing and Web Push. Each journey is checked beyond screen presence; new work extends these components instead of replacing them.
