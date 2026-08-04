# Valid web app testing

## Fast local check

```bash
npm ci
npx playwright install chromium
npm run test:e2e
```

The suite runs every core flow in a Pixel 7 viewport and desktop Chrome. The
localhost-only demo never calls production and cannot be enabled on a public
host.

For hands-on testing:

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/app/?demo=1`. Add `&locked=1` to exercise the
iOS-style vote-to-unlock Feed state, or `&godmode=1` to exercise an active God
Mode entitlement and sender reveals. Test Feed and School switching,
anonymous Inbox answer/report/block/delete, a complete Play set, shuffle and
nomination, the three-skip limit and live cooldown, profile editing, Ask me link
controls, aura-confirmed/idempotent question submission, optional onboarding
photo, selected-contact classmate discovery, install prompt, offline banner,
logout, and the reversible account-deletion flow.

## Real passkey staging check

Deploy the Six7 backend branch before the web branch. The environment must have:

- `PASSKEY_EXPECTED_ORIGINS=https://six7.lol,https://validapp.lol`
- `CORS_ALLOWED_ORIGINS=https://six7.lol,https://www.six7.lol,https://validapp.lol,https://www.validapp.lol`
- Redis available for one-time passkey challenges and shared rate limits
- the `WEB_*` limits from the backend `.env.example`
- `ENABLE_NGL_LINK_BACKEND=1` if the anonymous Inbox and Ask me link are enabled

The final passkey check is intentionally not performed on a random preview
hostname. Serve the candidate at `https://validapp.lol/app/` behind an edge
access policy or IP allowlist so the test team sees the exact production origin
while the public still sees the existing site. Do not broaden the WebAuthn or
CORS allowlists for a temporary hostname. Details and rollback order are in
`PRODUCTION_DEPLOYMENT.md`.

Begin with `WEB_RATE_LIMIT_MODE=observe`, validate an ordinary iOS peak-traffic
window, and only then switch to `enforce`. `off` is the compatibility rollback.

The complete production order, routing boundaries, edge-header requirements,
and rollback gate are in `PRODUCTION_DEPLOYMENT.md`.

Verify these public files and routes before creating a test account:

```bash
curl -i https://six7.lol/.well-known/webauthn
curl -i https://validapp.lol/app/
curl -i -H 'Origin: https://validapp.lol' https://api.six7.lol/api/v1/config
curl -i -X OPTIONS \
  -H 'Origin: https://validapp.lol' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type' \
  https://api.six7.lol/api/v1/auth/passkey/signup/challenge
npm run test:production
```

The related-origin file on `six7.lol` must contain
`https://validapp.lol`. The API response must return
`Access-Control-Allow-Origin: https://validapp.lol`; wildcard CORS is a failed
release gate. The passkey preflight must allow `POST` from that exact origin.

On an actual Android phone in current Chrome:

1. Create an account with name, birthday, school, grade, and a passkey. Confirm
   there is no phone-number or SMS step. Add an optional profile photo and
   confirm the selected-contact/invite prompt appears after signup.
2. Close the tab, return, and sign in with the same passkey.
   Add a backup passkey from Profile, confirm the count increases, sign out, and
   verify a fresh passkey sign-in still reaches the same account.
3. Install Valid from Profile, launch it from the home screen, and exercise Feed,
   Play, Profile, selected-contact discovery, invites, question submission, and
   the anonymous Inbox. Browse/search classmates and open one public classmate
   profile. If the account has God Mode, reveal a sender and confirm its weekly
   reveal balance decrements. Confirm Play enforces three skips and its cooldown
   unlocks without a refresh. Confirm question submission shows the server aura
   cost and safely checks an ambiguous submission without charging twice.
   Confirm contact selection sends no message or SMS.
4. Test on Wi-Fi and cellular, with a slow-network throttle, after backgrounding
   Chrome, and once with biometric cancellation.
5. Schedule account deletion, sign in again, and choose **Keep my account**.

Also sign into the iOS app account from the web once. That proves the existing
`six7.lol` passkey works through WebAuthn related-origin authorization rather
than only proving that newly created web credentials work.

## Abuse and load validation

Never aim a load test at production. Use a staging backend with production-like
Redis and at least two API replicas. Confirm global, authentication, write,
account, upload, and body-size limits return `429`/`413` with `Retry-After` where
applicable. Then run the anonymous-ask load test documented in the Six7
`docs/RUNBOOK_SCALE.md` at 25, 100, and 250 requests per second while watching
p95 latency, Redis errors, 429 rate, worker CPU, database connections, and origin
bandwidth.

Application limits are the last line of defense. Production still needs an edge
CDN/WAF rule set so connection floods and obviously abusive traffic are rejected
before they occupy an API worker.
