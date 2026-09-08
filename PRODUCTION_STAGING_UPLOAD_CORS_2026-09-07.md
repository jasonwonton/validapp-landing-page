# Production and staging signed-upload CORS

Applied September 7, 2026 through the authenticated Cloudflare dashboard to
`six7-private-media` in account `9472d27fa2e1a3762bd91728bb7d9437`.
Both the current production-account staging site and production use this bucket.
This does not redirect staging to the separate backend test environment.

Before: no CORS policy. After: the exact policy recorded in
[.do/r2-private-media-cors.json](.do/r2-private-media-cors.json).
Only `https://validapp.lol` and `https://staging.validapp.lol` may perform browser
PUTs with the server-signed content-type/cache-control headers. Max age is 300s.
No wildcard origins, GET, DELETE, public domain or public development URL was
enabled. Bucket authentication, lifecycle rules and object contents are unchanged.
The dashboard confirms the rule is saved and public access remains disabled.

Read-only verification:

| Origin | Requested method | Result |
| --- | --- | --- |
| https://validapp.lol | PUT | 204; exact allow-origin; PUT; content-type/cache-control |
| https://staging.validapp.lol | PUT | 204; exact allow-origin; PUT; content-type/cache-control |
| https://untrusted.invalid | PUT | 403; no allow-origin |
| https://validapp.lol | DELETE | 403; no allow-origin |

Repeat with `node scripts/check-private-upload-cors.mjs`. It sends only OPTIONS,
without credentials or object reads/writes. Browser CSP already permits this R2
origin in private web-v88. An actual signed upload/finalize/send still requires
an authenticated smoke test; a passing preflight is not proof of that full journey.

Rollback: inspect the current policy and remove only this exact two-origin rule.
The original policy was absent; do not delete rules added by someone else later.
Do not clear outboxes or delete media. No backend/iOS/APNS/SMS change was made.

## Separate production hosting blocker

Production DNS remains on DigitalOcean, not this Cloudflare account's DNS.
`validapp.lol` currently uses the static-site component in the Six7 backend app,
which does not apply `_headers`. Production preflight passes manifest/worker,
related-origin passkeys and API CORS, but fails HTTP framing/CSP headers.
Merging main auto-deploys this component; it does not add the missing headers.

The production API also currently omits the web-presentation flags that the
private staging gateway supplies. A production release must explicitly configure
the intended web cohort, preserve all backend master flags and auth/membership
checks, and keep the frontend independently reversible. Do not silently merge
and call production equivalent to staging while these differences remain.

A header-serving web-service component requires an additional hosting decision
(smallest plan is $5/month). User approval was requested before adding cost or
changing production routing. The existing app has sensitive global backend envs;
the frontend must not inherit those credentials. Preserve backend/worker source
revisions and all API, anonymous-link, poll/TBH and Apple association routes.
Main remains unmerged pending the production hosting change and release checks.

CI run `34178486479` on source `c2fa183` passed static checks, Android and Firefox.
Desktop Chromium failed during the unified-search adapter test with a browser
SIGSEGV; WebKit failed the simulated Android install-to-signup handoff assertion.
These are unresolved validation failures, not passing release gates. Passkey
integration was skipped by its environment gate. Do not bypass these checks or
claim physical-device acceptance from the emulated browser results.
