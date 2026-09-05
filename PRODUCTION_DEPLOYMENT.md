# Valid web app production deployment

Deploy the backend before the static web app. Keep signups private until the
automated preflight and the real-device checklist both pass.

## 1. Backend

Deploy the Six7 branch `validapp-webapp-backend-changes` with Redis enabled and
these exact web settings:

```text
PASSKEY_EXPECTED_ORIGINS=https://six7.lol,https://validapp.lol
CORS_ALLOWED_ORIGINS=https://six7.lol,https://www.six7.lol,https://validapp.lol,https://www.validapp.lol
WEB_RATE_LIMIT_MODE=off
WEB_RATE_LIMIT_PER_MINUTE=300
WEB_AUTHENTICATED_RATE_LIMIT_PER_MINUTE=300
WEB_AUTHENTICATED_IP_RATE_LIMIT_PER_MINUTE=3000
WEB_PASSKEY_RATE_LIMIT_PER_MINUTE=20
WEB_AUTH_RATE_LIMIT_PER_MINUTE=30
WEB_WRITE_RATE_LIMIT_PER_MINUTE=90
WEB_ACCOUNT_WRITE_RATE_LIMIT_PER_MINUTE=60
WEB_UPLOAD_RATE_LIMIT_PER_HOUR=30
WEB_SCHOOL_REQUEST_RATE_LIMIT_PER_HOUR=60
WEB_MAX_REQUEST_BODY_BYTES=12582912
LEGACY_SUBSCRIPTION_TOGGLE_MODE=observe
WEB_PUSH_DELIVERY_MODE=shadow
WEB_PUSH_OUTBOX_WORKER_ENABLED=0
ENABLE_WEB_CHATS=0
ENABLE_WEB_MEMENTOS=0
ENABLE_WEB_STORIES=0
ENABLE_WEB_CALLS=0
```

Leave `TRUST_PROXY_HEADERS=false` unless every production request passes through
a trusted proxy that overwrites (rather than appends to) `X-Forwarded-For`.
Application limits are a backstop. Put the API behind an edge CDN/WAF with broad
per-IP limits, stricter auth rules, body and connection caps, and alerts for
origin bandwidth, 429s, and concurrent connections. The backend scaling runbook
contains the operational details.

Start with `WEB_RATE_LIMIT_MODE=off` for the current-App-Store smoke test. Then
move to `observe`; it uses the real counters but cannot return a new 429 or 413
to iOS or web clients. Authenticated sessions get independent ordinary budgets,
with a higher per-IP ceiling so students behind one school NAT do not consume a
single pooled allowance. Review at least one normal peak traffic window, then
change it to `enforce`. If existing-client behavior changes,
set it to `off` and redeploy; off bypasses both Redis counters and the new body
cap. Keep edge protection active throughout because it does not require this
application switch. Use the admin-authenticated `/metrics` response's
identity-free `request_rate_limits.would_reject_by_policy` deltas to decide
whether enforcement is safe.

`LEGACY_SUBSCRIPTION_TOGGLE_MODE=observe` preserves an old subscription-toggle
contract for native iOS accounts while logging every call. Passkey-only
web accounts are rejected even in observe mode, so they cannot self-grant God
Mode. The current iOS purchase implementation uses the receipt-validated Apple
renewal endpoint; after the App Store canary shows no legacy toggle calls, set
this mode to `enforce` before opening the web app publicly. Re-test purchase and
restore on iOS after enforcing. `allow` exists only as an emergency
compatibility rollback and should not be the steady state.

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
Keep `ENABLE_WEB_CHATS`, `ENABLE_WEB_MEMENTOS`, `ENABLE_WEB_STORIES`, and
`ENABLE_WEB_CALLS` set to
`0` in production until their separate release gates pass.

Keep Web Push in `shadow` for the backend/current-iOS canary. Shadow mode keeps
the established direct browser sends intact where they already exist, records
content-free non-sendable rows, and lets transactional producers prove their
fan-out without contacting a provider under a database transaction. After the
outbox schema, row volume, collapse identities, and retention metrics are clean,
start the Web Push worker while still in `shadow`, then change
`WEB_PUSH_DELIVERY_MODE=durable` for the private final-origin cohort. Durable
mode is required before testing web-only streak recipients or claiming the new
transactional notification paths. If its age, dead-letter, duplicate, or APNS
comparison gates fail, return the mode to `shadow`, stop the worker after its
current lease window, and retain the rows for diagnosis; never truncate the
outbox as a rollback step.

### Existing iOS release gate

Before changing any public web routing, deploy the backend with
`WEB_RATE_LIMIT_MODE=off` and `LEGACY_SUBSCRIPTION_TOGGLE_MODE=observe`, then
smoke-test the current App Store build—not a local future build. With an
existing account, verify passkey and phone login, Inbox and School feeds, a full
Play set, profile editing/photo upload, contact sync, invite creation, anonymous
Inbox, a real sandbox subscription purchase/restore, subscription status,
logout, and a relaunch. Watch API 5xx/401 latency, legacy subscription-toggle
warnings, and crash reporting during the canary.

Only after that smoke test is clean should the limiter move to `observe`. A
non-zero would-reject count is not automatically bad, but it must be explained
by abusive traffic rather than ordinary iOS bursts or a shared school network.
Keep the previous backend revision available. Roll it back for schema/auth
regressions; use `WEB_RATE_LIMIT_MODE=off` for limiter-only regressions.

## 2. Static site and routing

The current live topology (audited September 5, 2026) serves `validapp.lol`
from the `validapp-landing-page` **static-site component inside the production
Six7 backend DigitalOcean app**, sourced from this repository's `main` branch.
DigitalOcean serves `_headers` as a plain file and does not apply it to static
responses; that is why the live framing check currently fails.

The candidate deploy target is the header-emitting `npm start` web service.
It serves only files from `dist/`, accepts only GET/HEAD, returns 404 for API
paths, applies `no-cache` to `/app/*`, and uses `dist/_headers` as the single
security-policy source. Its contract is checked with:

```bash
npm run build
npm run test:static-origin
```

Use `npm ci --include=dev && npm run build` as the DigitalOcean build command;
`esbuild` is needed only while producing the lazy, self-hosted LiveKit bundle
and is not a runtime dependency.

First deploy `.do/app.staging.yaml` as an unbound staging app from the reviewed
`codex/pwa-parity-release` branch. Do not point `validapp.lol` at it yet. After its
origin, update, load, and rollback checks pass, add the same web-service
component to the production Six7 app and atomically change only the
`validapp.lol` static catch-all to that service. Preserve these routing
boundaries and evaluate every specific FastAPI route before the web catch-all:

```text
validapp.lol/api/v1/a/*                         -> Six7 FastAPI
validapp.lol/a/*                                -> Six7 FastAPI
validapp.lol/.well-known/apple-app-site-association -> Six7 FastAPI
validapp.lol/apple-app-site-association         -> Six7 FastAPI
validapp.lol/*                                  -> this static site
api.six7.lol/*                                  -> Six7 FastAPI
```

The current unbound smoke target is
`https://validapp-web-staging-luibq.ondigitalocean.app` (DigitalOcean app
`7c62d12a-bfe2-4fa7-8107-430f53c06b5d`). Confirm its active deployment commit
matches the reviewed branch, then run:

```bash
PLAYWRIGHT_BASE_URL=https://validapp-web-staging-luibq.ondigitalocean.app npm run test:e2e:deployed
```

This staging suite deliberately stays signed out: demo fixtures are restricted
to localhost, and passkeys/session cookies must be tested on the private final
origin. A passing staging run does not authorize public routing.

The web origin must apply the rules in `_headers` to `/app/*`; `npm start`
does this directly. Do not rely only on the CSP meta tag: framing protection
requires the actual `Content-Security-Policy` response header. Also preserve the manifest and
service-worker content types and do not rewrite `/app/service-worker.js` to
HTML. Keep the candidate `Permissions-Policy` scoped to `microphone=(self)` and
`camera=(self)` so compatible browsers can record voice messages and join
feature-gated calls; geolocation, payment, and USB remain disabled. Preserve
the exact LiveKit WebSocket hosts and `media-src` directive in the candidate CSP.
The effective response policy must also allow
`https://challenges.cloudflare.com` in both `script-src` and `frame-src` or
Turnstile-backed signup will be blocked. Keep `style-src 'self'` without
`'unsafe-inline'`; dynamic layout values are applied through the bounded,
same-origin `runtime-style.js` stylesheet rules.

## 3. Go/no-go checks

From this repository, run:

```bash
npm ci
npm run build
npm run test:static-origin
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

## 4. Chats and Mementos staged exposure

The native and web presentation switches are independent. Deploy backend support
and the static candidate with `ENABLE_WEB_CHATS=0`, `ENABLE_WEB_MEMENTOS=0`,
`ENABLE_WEB_STORIES=0`, and `ENABLE_WEB_CALLS=0`. After the current App Store binary, final-origin, and
physical-device gates in `WEBAPP_TESTING.md` pass, enable web Chats for the
private cohort first. Observe at least one representative peak window before
enabling web Mementos or Stories through their separate switches.

Enable web calls only after a two-account staging LiveKit run on every supported
device, including permission denial, camera-capacity, reconnect, close-tab,
Bluetooth/audio route, and expiring incoming-notification checks.

For a school-question approval notification, verify the browser route contains
`notification=question_submission&submission_id=<id>`, opens My Questions, and
focuses the matching server-owned submission. Exercise pending withdrawal/refund
and published deactivation; the latter must retain existing polls and results.

Do not expose a capability while its `Release` entry in `IOS_WEB_PARITY.md` is
`Not yet tested`. For presentation or PWA-only regressions, set the corresponding
web flag to `0`; this does not change iOS exposure. Keep additive database
migrations applied and allow durable notification work to drain. Roll the API or
worker image back only for a backend contract or processing regression, and do
not change APNS or SMS worker settings as part of a PWA rollback.
