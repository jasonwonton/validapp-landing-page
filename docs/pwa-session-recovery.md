# Browser passkey and session recovery — web-v93

Based on the exact production frontend 861c7f58fc95d6c332ccad2ce4415ae86b1d0e2b.
The PWA remains passkey-only; no SMS sign-in or backend change is included.

## Recovery boundaries

- Existing anonymous challenge fallback remains validapp.lol → api.validappcdn.com → api.six7.lol, bounded to three attempts / ten seconds. It never sends session credentials to an alternate domain.
- A browser SecurityError on a supported related-origin browser gets one setup retry after 500 ms, obtaining a fresh challenge. Cancellation, missing credential, offline and unsupported-browser errors do not loop. Completed assertions and attestations are never automatically replayed.
- A lost passkey verification response checks the first-party cookie only when the returned credential user handle identifies the same account. A different/unknown account cannot be accepted as recovered sign-in.
- First-party safe reads get at most two attempts, within the caller's total timeout (normally 15 seconds). The deadline includes response-body reads. Existing longer upload/finalization timeouts remain intact. Writes are sent once.
- A generic 401/403/404, gateway response, or connection failure cannot clear the session. Invalidation requires the server's exact JSON + Bearer 401 contract. Protected-request rejections are checked against the current cookie; a session revision guard prevents late rejections from clearing a newer sign-in.
- Failed startup checks show a reconnect action and retry when connectivity returns. They do not automatically open signup or discard the session. Expected missing-cookie responses retain normal signup behavior.
- Diagnostics now distinguish session-restore failures and passkey ceremonies that did not complete, without storing credential data.

## Limits

Browser WebAuthn still checks https://six7.lol/.well-known/webauthn for the existing six7.lol RP ID. JavaScript API fallback cannot replace this browser-controlled URL. The retry helps transient failures but cannot bypass a consistent DNS/TLS/content-filter block. RP ID, origin validation, required user verification, cookie security and signup SMS protection remain unchanged.

Automated browser tests use synthetic credentials and network failures; they are not evidence of successful login on an affected physical school Wi-Fi network.

## Release and rollback

The release changes only the DigitalOcean frontend component's Git branch, preserving the current live spec and every backend/admin/job/worker revision. Before deploying, verify the current frontend still matches the base above and no deployment is in progress. Rebuild versioned assets and run auth, browser, static-origin, service-worker upgrade/rollback and performance checks.

Rollback only the frontend component to `codex/valid-owner-homepage-wording-20260916` at the base commit above, after confirming its branch has not advanced. Do not restore a stale whole-app spec over concurrent backend changes. Existing installed apps use the update lifecycle; verify downloaded assets and worker version after rollout.

## Validation for this candidate

- 44 Node checks cover routing, session invalidation, body deadlines, cancellation, replay limits, cookie-owner matching, CSP, static origin and asset versioning.
- The complete Android suite exercised 309 cases. Its three fixture failures were corrected (new module availability, the real Bearer 401 header, and the one additional reconnect-button DOM node); all 76 checks in the affected files passed afterward.
- Chromium, Firefox and WebKit auth/session/production-adapter/Turnstile checks passed except an existing startup-versus-search timing assumption. The search test now waits for completed sign-in before measuring typing requests; its one-request assertions are retained. All 12 repeated checks across four browser projects passed after this correction.
- Performance budgets and current-production security, WebAuthn relationship and API/CORS preflight passed. The service-worker upgrade/rollback case passed in the Android run.
