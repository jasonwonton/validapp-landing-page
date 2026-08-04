# Valid web app production deployment

Deploy the backend before the static web app. Keep signups private until the
automated preflight and the real-device checklist both pass.

## 1. Backend

Deploy the Six7 branch `validapp-webapp-backend-changes` with Redis enabled and
these exact web settings:

```text
PASSKEY_EXPECTED_ORIGINS=https://six7.lol,https://validapp.lol
CORS_ALLOWED_ORIGINS=https://six7.lol,https://www.six7.lol,https://validapp.lol,https://www.validapp.lol
WEB_RATE_LIMIT_MODE=observe
WEB_RATE_LIMIT_PER_MINUTE=300
WEB_PASSKEY_RATE_LIMIT_PER_MINUTE=20
WEB_AUTH_RATE_LIMIT_PER_MINUTE=30
WEB_WRITE_RATE_LIMIT_PER_MINUTE=90
WEB_ACCOUNT_WRITE_RATE_LIMIT_PER_MINUTE=60
WEB_UPLOAD_RATE_LIMIT_PER_HOUR=30
WEB_SCHOOL_REQUEST_RATE_LIMIT_PER_HOUR=60
WEB_MAX_REQUEST_BODY_BYTES=12582912
```

Leave `TRUST_PROXY_HEADERS=false` unless every production request passes through
a trusted proxy that overwrites (rather than appends to) `X-Forwarded-For`.
Application limits are a backstop. Put the API behind an edge CDN/WAF with broad
per-IP limits, stricter auth rules, body and connection caps, and alerts for
origin bandwidth, 429s, and concurrent connections. The backend scaling runbook
contains the operational details.

Start with `WEB_RATE_LIMIT_MODE=observe`. It uses the real counters but cannot
return a new 429 or 413 to iOS or web clients. Review at least one normal peak
traffic window, then change it to `enforce`. If existing-client behavior changes,
set it to `off` and redeploy; off bypasses both Redis counters and the new body
cap. Keep edge protection active throughout because it does not require this
application switch. Use the admin-authenticated `/metrics` response's
identity-free `request_rate_limits.would_reject_by_policy` deltas to decide
whether enforcement is safe.

The `six7.lol` site must publish the backend branch's
`six7-landing-page/.well-known/webauthn` as JSON. It authorizes the
`validapp.lol` related origin so existing iOS passkeys can sign in on the web.

### Test on the real WebAuthn origin

Do not add a temporary preview hostname to `PASSKEY_EXPECTED_ORIGINS` or the
related-origin file just to make staging convenient. A passkey ceremony on a
preview hostname has a different browser origin and does not validate the
production relationship between the `six7.lol` relying-party ID and
`https://validapp.lol`.

After the backend canary and current-iOS smoke test pass, publish `/app/` at
`https://validapp.lol` behind an edge access rule limited to the test team (for
example, an identity-aware access policy or a small IP allowlist). Keep the
browser-visible origin as exactly `https://validapp.lol`; do not redirect the
testers to a preview domain. Run the production preflight and real-device
checklist there, then remove only the access rule when the release is approved.
The static deployment and backend revision must remain independently
rollbackable throughout this check.

### Existing iOS release gate

Before changing any public web routing, deploy the backend with
`WEB_RATE_LIMIT_MODE=off` and smoke-test the current App Store build—not a local
future build. With an existing account, verify passkey and phone login, Inbox and
School feeds, a full Play set, profile editing/photo upload, contact sync, invite
creation, anonymous Inbox, subscription status, logout, and a relaunch. Watch
API 5xx/401 latency and crash reporting during the canary.

Only after that smoke test is clean should the limiter move to `observe`. A
non-zero would-reject count is not automatically bad, but it must be explained
by abusive traffic rather than ordinary iOS bursts or a shared school network.
Keep the previous backend revision available. Roll it back for schema/auth
regressions; use `WEB_RATE_LIMIT_MODE=off` for limiter-only regressions.

## 2. Static site and routing

Deploy this repository's `validapp-webapp` branch as the static site, initially
with the private final-origin access rule described above. Preserve these
routing boundaries and evaluate the specific FastAPI routes before the static
catch-all:

```text
validapp.lol/api/v1/a/*                         -> Six7 FastAPI
validapp.lol/a/*                                -> Six7 FastAPI
validapp.lol/.well-known/apple-app-site-association -> Six7 FastAPI
validapp.lol/apple-app-site-association         -> Six7 FastAPI
validapp.lol/*                                  -> this static site
api.six7.lol/*                                  -> Six7 FastAPI
```

The static platform or edge must apply the rules in `_headers` to `/app/*`.
Do not rely only on the CSP meta tag: framing protection requires the actual
`Content-Security-Policy` response header. Also preserve the manifest and
service-worker content types and do not rewrite `/app/service-worker.js` to
HTML.

## 3. Go/no-go checks

From this repository, run:

```bash
npm ci
npm run test:e2e
npm run test:production
```

`test:production` must pass all four checks: app shell/security headers, PWA
assets, related-origin passkeys, and exact-origin API CORS (including passkey
preflight and untrusted-origin rejection). Then complete the real Android
and cross-device passkey checklist in `WEBAPP_TESTING.md`. In particular, sign
in once using an account/passkey originally created by the iOS app; a newly
created web passkey alone does not prove related-origin behavior.

If any check fails, keep the old landing deployment available for rollback and
do not advertise Android signups yet.
