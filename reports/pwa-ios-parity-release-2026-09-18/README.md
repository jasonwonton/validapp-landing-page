# PWA iOS parity release

Candidate app release: `24d7985dcc3fc0e34be2` (web-v94). This includes the reviewed iOS visual alignment, stories/recent-chat layout, foreground activity/privacy controls, and inbox/detail flows. The application code is unchanged from the reviewed `26022db` build.

The live baseline was verified against DigitalOcean: static component `validapp-landing-page` in app `b960038f-bcfb-4bde-ba3e-191cde0ccbd5`, source `11306743a818790365ea36dae966eee29b3cc168`, branch `codex/pwa-session-recovery-20260916`, immutable app release `5b1cbf7a502f29649a0e`. Baseline deployment was `f9a401cf-baa2-4d8f-b505-33f58f82850a`. Refresh these immediately before changing the component. The separate, unreleased phone-verification branch is outside this deployment.

## Release checks

- Full four-browser suite is run for this release; final totals recorded after completion.
- All 52 Node tests pass (auth/session recovery, presence, staging isolation, static origin/versioning, and public SEO).
- Real cryptographic WebAuthn registration, backup credential, logout/revocation, and fresh sign-in pass with the isolated in-memory backend. `SIX7_REPO` points to the matching web backend checkout; it does not touch production accounts, Redis, databases, or SMS.
- The integration harness now serves the auth dependency graph and explicitly imports Python code from the selected checkout. This avoids silently importing a different editable installation.
- Built-origin verification matches all 49 immutable asset hashes, verifies the exact worker, boots the signed-out screen, installs the correct offline shell, and confirms authenticated API responses are not cached. Previous-release lazy modules remain available.
- Performance and UI-runtime budgets pass. Estimated offline-shell transfer: 719,949 bytes.
- Live preflight passes CSP/device policies, PWA files, related-origin passkeys, API health, exact-origin CORS, and untrusted-origin rejection. Fresh production signed-out startup exposes sign-in and account creation without runtime errors.
- The existing 60 layout captures cover 10 requested screens, two themes, and 320/390/440px widths without horizontal overflow or page errors.

Test-only follow-ups preserve native nomination artwork in the icon guard, use full Chromium for Linux CI, and make supported-authenticator/gesture readiness explicit. Existing tests continue to verify the unsupported-authenticator state.

## Deployment and rollback

Change only the static component's Git branch to a new immutable release branch, using the latest app spec. Do not pass `--update-sources`; preserve all backend/admin/worker/job revisions, ingress, environment settings, and feature flags. After activation, verify the exact frontend commit, all other component source hashes, the manifest and every immutable asset hash, service-worker installation/offline startup, and public API/passkey preflight.

Rollback changes that same static component back to `codex/pwa-session-recovery-20260916` on the latest otherwise unchanged app spec. Preserve old immutable directories so already-open tabs can fetch their original lazy modules. A rollback is only complete after checking the public manifest and component source revisions.

No physical-device biometric ceremony, two-account production chat/call session, or third-party story publication is claimed by these automated checks.
