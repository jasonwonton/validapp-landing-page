# Chat /play parity — September 18, 2026

Release web-v103, `973ed0a8789c203b69bf`.

The PWA previously exposed the selected weekly game only through the Feed card. Chat now recognizes an exact `/play` command, ignoring surrounding whitespace and case, as iOS does. It clears the command, dismisses the keyboard and opens the existing weekly-game player. The command never enters the chat outbox or message API, even if game loading fails. Pending reply and media state are preserved; queued message retries are not reinterpreted as commands. A school is required, matching iOS.

The launcher follows the authenticated selected release for both 67 Challenge and Love Flap. The local demo now supplies 67 release metadata so the Weekly Game card and command are visible in previews. Production still uses the authenticated API. No game packages, backend code or game score rules changed; 67 remains web practice with ranked scores on iOS.

Validation: 16 command/demo cases across Android Chrome, desktop Chrome, Firefox and WebKit, including both game players, failure handling, reply preservation, empty outbox and ordinary `/play later` messages. Another 24 chat/outbox/Memento regression cases passed. Build, runtime contracts, performance budgets, all 64 asset hashes, retained previous-release lazy modules, four-browser startup and offline shell/API cache isolation passed. The built 67 preview was inspected visually.
