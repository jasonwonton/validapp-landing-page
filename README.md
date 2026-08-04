# Valid web app

This branch contains the installable, passkey-only web client at `/app/`. It
uses the Six7 backend branch `validapp-webapp-backend-changes`. There is no
password, phone-number, or SMS authentication path in the web client.

## Before testing

Use these branches:

```bash
cd /path/to/validapp-landing-page
git switch validapp-webapp
git pull --ff-only

cd /path/to/six7
git switch validapp-webapp-backend-changes
git pull --ff-only
```

Never put a production `DATABASE_URL`, Redis URL, or messaging credential in a
local `.env`. `make dev` disables outbound push, vote SMS, and delayed
notifications, but a separate dev database is still required.

## 1. Automated check (about two minutes)

```bash
cd /path/to/validapp-landing-page
npm ci
npx playwright install chromium
npm run test:e2e
```

The suite exercises the core flows in Pixel 7 and desktop Chrome profiles. It
uses browser-level API contracts and demo data; it never calls production.

For the cryptographic passkey integration check, keep the Six7 repository in a
sibling directory with its virtual environment installed, then run:

```bash
cd /path/to/validapp-landing-page
npm run test:passkey-integration
```

This launches an isolated in-memory backend and a temporary HTTPS server. A
Chromium virtual authenticator performs a real WebAuthn registration and
discoverable sign-in with RP `six7.lol` and related origin `validapp.lol`. The
test covers signup, authenticated profile loading, logout/revocation, fresh
sign-in, and another authenticated profile load. It uses the production route,
frontend, and cryptographic verification code, but no database, Redis service,
SMS provider, production endpoint, `/etc/hosts` change, or persistent passkey.
Set `SIX7_REPO` and optionally `SIX7_PYTHON` if the repositories are not
siblings.

The same ceremony has an opt-in GitHub Actions job. To enable it without
granting write access, an administrator of `christophertran/six7` must add a
dedicated read-only deploy key, store its private half as the landing-page
repository secret `SIX7_DEPLOY_KEY`, and set the landing-page repository
variable `SIX7_INTEGRATION_ENABLED=true`. The ordinary browser CI remains
independent and green until that least-privilege key is configured.

## 2. Quick hands-on UI check

```bash
cd /path/to/validapp-landing-page
python3 -m http.server 4173
```

Open <http://127.0.0.1:4173/app/?demo=1>. This is the fastest way to inspect
layout, motion, Feed, Play, Profile, onboarding, selected-contact discovery,
question submission, anonymous Inbox, install UI, and account-deletion UI.
Demo mode cannot send an API request or an SMS.

Useful variants:

- `http://127.0.0.1:4173/app/?demo=1&locked=1` starts with Feed vote-locked.
- Chrome DevTools → Network → Slow 3G checks loading and retry states.
- Chrome DevTools → Application → Service Workers lets you test offline/PWA
  behavior. Service workers are intentionally disabled in demo mode.

Ordinary localhost is not a valid end-to-end passkey test. The real credential
is scoped to the `six7.lol` relying-party ID, so use one of the HTTPS lanes
below for a real ceremony.

## 3. Real passkey against a local dev backend

This lane creates test users and credentials only in the dev database.

### Start the backend

PostgreSQL and Redis must be running. Redis is mandatory for one-time passkey
challenges. In `/path/to/six7/.env`, configure at least:

```dotenv
DATABASE_URL=postgresql://...a_dev_database_only...
REDIS_URL=redis://127.0.0.1:6379/0
PASSKEY_EXPECTED_ORIGINS=https://six7.lol,https://validapp.lol
CORS_ALLOWED_ORIGINS=https://six7.lol,https://www.six7.lol,https://validapp.lol,https://www.validapp.lol
WEB_RATE_LIMIT_MODE=observe
ENABLE_NGL_LINK_BACKEND=1
```

Then run:

```bash
cd /path/to/six7
make dev
```

Verify <http://127.0.0.1:8000/health> before continuing.

### Serve the exact HTTPS origins

Install Caddy, then add these temporary entries to `/etc/hosts`:

```text
127.0.0.1 validapp.lol
127.0.0.1 six7.lol
```

The second entry serves the related-origin authorization locally. Do **not**
map `api.six7.lol`; that name must keep its normal DNS behavior.

Start the included local HTTPS proxy. Substitute the actual absolute paths:

```bash
cd /path/to/validapp-landing-page
sudo env \
  VALID_WEB_ROOT=/absolute/path/to/validapp-landing-page \
  SIX7_ROOT=/absolute/path/to/six7 \
  caddy run --config Caddyfile.local.example
```

Caddy uses its local CA. Trust that CA when prompted (`caddy trust` may be
needed on some systems), then use a fresh Chrome profile and open:

```text
https://validapp.lol/app/?local-api=1
```

`local-api=1` is a constrained, same-origin switch. Caddy proxies only
`/api/v1/*` to `127.0.0.1:8000`; the app does not accept an arbitrary API URL.

## 4. Real iOS passkey against the production RP and API

This is the highest-fidelity compatibility check. It performs real production
reads and writes, so use a dedicated test account and test school. Do not
schedule deletion for an account you care about.

Prerequisites:

- The backend web branch has passed its current-App-Store iOS canary and is
  deployed with `WEB_RATE_LIMIT_MODE=off` or reviewed `observe` mode.
- `https://api.six7.lol/api/v1/config` is healthy and allows the exact origin
  `https://validapp.lol`.
- The related-origin document authorizes `https://validapp.lol`.

Use the same Caddy and `/etc/hosts` setup from section 3, but **omit** the query
switch:

```text
https://validapp.lol/app/
```

Without `local-api=1`, the client uses
`https://api.six7.lol/api/v1`. The browser-visible origin is still exactly
`https://validapp.lol`, and the WebAuthn ceremony still verifies the real
`six7.lol` RP ID. Nothing redirects iOS traffic and no RP ID is changed.

First sign in with an account/passkey created by the current iOS app. Then test
a newly created web account. Passing both directions is important: a web-only
credential does not prove that existing iOS credentials work through related
origins.

## Core-flow checklist

On current Android Chrome (and once in desktop Chrome), verify:

1. Create an account with birthday, school, grade, optional photo, and passkey.
   Confirm there is no phone or SMS step.
2. Close the tab, reopen it, and sign in with the passkey.
3. Switch Inbox/School feeds, search, open a poll, upvote, report, and block.
4. Complete a Play set, shuffle, nominate, use all three skips, and watch the
   cooldown unlock without a page refresh.
5. Edit Profile, share/rotate the Ask link, submit an aura-confirmed question,
   and verify an ambiguous retry cannot double-charge.
6. Use the browser Contact Picker. Confirm only selected contacts are uploaded
   and no message or SMS is sent.
7. Answer/report/block/delete an anonymous Inbox item.
8. Install the PWA, launch it from the home screen, background/reopen it, test
   Wi-Fi and cellular, cancel one biometric prompt, and exercise offline mode.
9. Schedule deletion only on the disposable account, sign back in, and choose
   **Keep my account**.

Run the full device and release checklist in [WEBAPP_TESTING.md](WEBAPP_TESTING.md)
before any public launch.

## Cleanup

Stop Caddy, remove only the two lines you added to `/etc/hosts`, and close the
temporary Chrome profile. Confirm normal DNS is restored:

```bash
getent hosts validapp.lol six7.lol
```

If a cached local shell remains, clear site data for `validapp.lol` in the test
profile. Never leave the host overrides active during ordinary production
debugging.

Production order, iOS rollback gates, routing, and DDoS controls are documented
in [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md). The current Swift-to-web
coverage and deliberate platform differences are recorded in
[IOS_WEB_PARITY.md](IOS_WEB_PARITY.md).
