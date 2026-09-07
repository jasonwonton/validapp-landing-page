# Private staging UI release — September 7, 2026

- Deployed source: `18cd9a85c2ff5fc3e2a04febefd0fb16a8920a27`.
- Staging deployment: `1348fe63-fe09-493e-a61c-3fe2587571c9`, ACTIVE.
- Origin: `https://staging.validapp.lol`, private invitation required.
- App shell: `web-v69`; previous reversible frontend source: `c8fbb404`.
- Scope: live Memento camera, interface symbols, Chats geometry, review layout,
  Dark Mode contrast and the corrected experience audit. No backend deployment,
  API contract, APNS/SMS worker, database or production flag change in this pass.

## Evidence

- Baseline Chats/Mementos: 28 passed before changes.
- Core flows, production adapters, chat contracts and camera tests: 323 passed,
  9 explicit platform skips, no retries.
- Final camera, Chats/Mementos, recovery, effects, CSP, call contracts, polish
  and v67/v69 update/rollback suite: 294 passed, 6 platform skips, no retries.
  The two runs overlap; counts are not a count of unique journeys.
- Build, UI runtime, performance budget, 7 gateway tests, 3 static-origin tests,
  syntax checks and diff whitespace checks passed.
- Four main tabs, room, camera and review rendered in light/dark demo views.
  Reproducible screenshots: `node scripts/audit-ui.mjs` (ignored artifacts).
- Live origin checks passed: private gate, no-store, HTTPS/CSP/camera policy,
  production passkey challenge, exact related origins/CORS, cross-origin denial,
  disabled private-cohort Stories/calls, and signed-out desktop/mobile layout.
- Live-origin Chromium synthetic camera: verified `web-v69`, imported the
  deployed module, captured one JPEG and released its stream under real CSP.
  No production sign-in, upload or Memento share was performed.
- Hosted CI run `34149821444` was still running at this evidence snapshot;
  static checks had passed. Do not infer complete hosted-CI success from local
  results: https://github.com/jasonwonton/validapp-landing-page/actions/runs/34149821444

## Acceptance status

Private owner testing is available. Public release remains NO-GO; the overall
parity goal is not fulfilled. Physical Pixel, Samsung, iPhone PWA, passkey,
camera orientation/lens behavior, keyboard/accessibility, multi-account realtime
and push acceptance remain open. See `UI_EXPERIENCE_AUDIT.md` for the surface
matrix and owner test recipe. Production-account sharing affects real chats.

This evidence-only document follows the deployed source and does not require
another deployment. Revert only the independent staging frontend if necessary;
preserve pending outboxes and use the app's explicit update acceptance.
