# Valid web app: local setup

This repository is the browser/PWA half of Valid. For the matching API, keep a
checkout of `six7` beside this repository and use the web backend branch.

```text
your-workspace/
├── validapp-landing-page/  # branch: validapp-webapp
└── six7/                   # branch: validapp-webapp-backend-changes
```

The web app is passkey-only. It has no phone-number, OTP, or SMS signup flow.
Nothing in this guide requires production credentials.

## Get the matching branches

```bash
cd /path/to/validapp-landing-page
git switch validapp-webapp
git pull --ff-only

cd ../six7
git switch validapp-webapp-backend-changes
git pull --ff-only
```

## Fastest option: safe UI demo

The frontend is static, so there is no build step:

```bash
cd /path/to/validapp-landing-page
python3 -m http.server 4173 --bind 127.0.0.1
```

Open <http://127.0.0.1:4173/app/?demo=1>. Demo mode uses local fixture data,
never calls the API, cannot send an SMS, and is safe to use without a backend.

Useful variants:

- <http://127.0.0.1:4173/app/?demo=1&locked=1> starts with Feed locked.
- <http://127.0.0.1:4173/app/?demo=1&godmode=1> enables the God Mode UI.

Stop the server with `Ctrl+C`.

## Automated browser checks

```bash
cd /path/to/validapp-landing-page
npm ci
npx playwright install chromium
npm run test:e2e
```

To exercise real WebAuthn cryptography against an isolated in-memory instance
of the backend code (no PostgreSQL, Redis, or production traffic), keep the two
repositories as siblings and run:

```bash
npm run test:passkey-integration
```

## Full local app with a dev database

1. Follow `LOCAL_WEBAPP_SETUP.md` in the sibling `six7` checkout to configure
   PostgreSQL, Redis, and the API safely.
2. Start that backend with `make dev` and verify
   <http://127.0.0.1:8000/health>.
3. Install Caddy and temporarily add only these entries to `/etc/hosts`:

   ```text
   127.0.0.1 validapp.lol
   127.0.0.1 six7.lol
   ```

   Do not map `api.six7.lol`.
4. Start the included HTTPS proxy, substituting your absolute paths:

   ```bash
   cd /path/to/validapp-landing-page
   sudo env \
     VALID_WEB_ROOT=/absolute/path/to/validapp-landing-page \
     SIX7_ROOT=/absolute/path/to/six7 \
     caddy run --config Caddyfile.local.example
   ```

5. Trust Caddy's local CA if prompted, use a fresh Chrome profile, and open
   <https://validapp.lol/app/?local-api=1>.

The real Valid credential uses relying-party ID `six7.lol`; that is why a plain
`localhost` page cannot test the complete passkey ceremony. The `local-api=1`
switch is deliberately constrained to the same-origin `/api/v1` proxy and
cannot redirect the app to an arbitrary server.

When finished, stop Caddy and remove only the two host entries you added.

## What talks to what

```text
Chrome at https://validapp.lol/app/?local-api=1
  -> static files from this checkout
  -> /api/v1/* through Caddy
  -> http://127.0.0.1:8000 in the six7 checkout
  -> your development PostgreSQL and Redis only
```

Do not use a production `DATABASE_URL`, Redis URL, APNs key, or messaging
credential locally. `make dev` provides notification safety defaults, but the
database boundary is still your responsibility.

For the full device checklist, see [WEBAPP_TESTING.md](WEBAPP_TESTING.md). For
release order and iOS compatibility gates, see
[PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md).
