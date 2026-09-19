# Chat /play parity — September 18, 2026

Release web-v103, `973ed0a8789c203b69bf`.

The PWA previously exposed the selected weekly game only through the Feed card. Chat now recognizes an exact `/play` command, ignoring surrounding whitespace and case, as iOS does. It clears the command, dismisses the keyboard and opens the existing weekly-game player. The command never enters the chat outbox or message API, even if game loading fails. Pending reply and media state are preserved; queued message retries are not reinterpreted as commands. A school is required, matching iOS.

The launcher follows the authenticated selected release for both 67 Challenge and Love Flap. The local demo now supplies 67 release metadata so the Weekly Game card and command are visible in previews. Production still uses the authenticated API. No game packages, backend code or game score rules changed; 67 remains web practice with ranked scores on iOS.

Validation: 16 command/demo cases across Android Chrome, desktop Chrome, Firefox and WebKit, including both game players, failure handling, reply preservation, empty outbox and ordinary `/play later` messages. Another 24 chat/outbox/Memento regression cases passed. Build, runtime contracts, performance budgets, all 64 asset hashes, retained previous-release lazy modules, four-browser startup and offline shell/API cache isolation passed. The built 67 preview was inspected visually.

Production: deployment `57c05aa7-ccb1-4e45-b2df-abfae8e3b72a` ACTIVE 43/43; frontend source `89ee3eaf1e9bef0a0568284ebddd8003d2ca0896`, branch `codex/pwa-chat-play-release-20260918`. All 12 other component revisions and the remaining app configuration were preserved. Live verification passed all 64 asset hashes, retained web-v102 modules, four-browser startup, offline shell/API cache isolation, security headers, manifest/service worker, related-origin passkeys, API health and CORS.
