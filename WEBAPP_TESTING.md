# Valid web app testing

## Fast local check

```bash
npm ci
npx playwright install chromium firefox webkit
npm run test:e2e
```

The suite runs every core flow in a Pixel 7 Chromium viewport plus Desktop
Chrome, Firefox, and WebKit. Firefox and WebKit run with service workers blocked
because Playwright supports service-worker automation only in Chromium; the two
Chromium projects retain the install, offline-shell, cache-isolation, update,
and push-worker coverage. WebKit is not branded Safari and does not replace the
installed-iPhone gate below. The localhost-only demo never calls production and
cannot be enabled on a public host.

Branded macOS browser smoke currently covers Chrome and Safari against the
header-emitting production-style local origin. Chrome covers the install
affordance in addition to Chats/Mementos navigation, text send, exact-chat URL,
and cold reload/sign-in restoration. Safari covers demo sign-in, Chats list and
DM navigation, text send, exact-chat cold reload/sign-in restoration, Memento
viewing, and prior-day history. These local checks do not approve final-origin
push, passkeys, media permissions, install behavior, or the physical iPhone PWA.

For hands-on testing:

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/app/?demo=1`. Add `&locked=1` to exercise the
iOS-style vote-to-unlock Feed state, or `&godmode=1` to exercise an active God
Mode entitlement and sender reveals. Test Feed and School switching,
anonymous Inbox answer/report/block/delete, a complete Play set, shuffle and
nomination, the three-skip limit and live cooldown, direct photo/bio editing,
tappable Top Polls, Ask me link controls, boost spending,
aura-confirmed/idempotent question submission, My Questions review/results,
pending withdrawal/refund, published-question deactivation, optional onboarding
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

1. Create an account with age, school, grade, phone number, name, username,
   gender, and a passkey. Confirm the phone is formatted, the Turnstile-backed
   SMS code is requested and confirmed once, and existing polls for that number load after signup. Add
   an optional profile photo and confirm the selected-contact/invite prompt
   appears after signup.
2. Close the tab, return, and sign in with the same passkey.
   Add a backup passkey from Settings, confirm the count increases, sign out, and
   verify a fresh passkey sign-in still reaches the same account.
3. Install Valid from Settings, launch it from the home screen, and exercise Feed,
   Play, Settings, selected-contact discovery, invites, question submission, and
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

## Chats, Mementos, push, and recovery matrix

Run this at the private final origin with two real accounts and
`ENABLE_WEB_CHATS=1`. Enable `ENABLE_WEB_MEMENTOS=1` only for the Memento rows.
Enable `ENABLE_WEB_STORIES=1` only for the Story rows. Enable
`ENABLE_WEB_CALLS=1` only for open-app call rows; it must remain independent
from iOS `ENABLE_CALLS` and `CALLS_BACKEND_ENABLED`.
Record browser/OS versions, start/end timestamps, account IDs, and the result of
each row in `IOS_WEB_PARITY.md`; do not mark a row production-ready from emulator
results.

Repeat the matrix on a physical Pixel in Chrome, a physical Samsung in Chrome
and Samsung Internet, an installed iPhone PWA, and desktop Chrome, Edge,
Firefox, and Safari where the capability is supported:

1. Create a DM and named group; accept and decline invitations; rename, invite,
   remove, leave, report, and change each notification level. Confirm membership
   history and blocked-user behavior from iOS and web.
2. Send text and replies concurrently from iOS and web. React, hide for me,
   unsend, type, background/foreground, and verify read/unread state. Force an
   SSE disconnect and API-replica switch; confirm one copy in increasing room
   sequence with no reconnect loop.
3. Open `?tab=chats&chat=<id>` from a cold start and from a notification. Verify
   the exact chat opens after authentication and a malformed/cross-origin URL is
   rejected to `/app/`.
4. Send while offline, refresh, close the tab, restore connectivity, and reopen.
   Confirm the pending bubble returns and the server stores one message with the
   original `client_request_id`. Repeat through `503`, `429`, and a permanent
   `400`; verify bounded backoff and no automatic permanent-error retry.
5. Capture a Memento with the front and rear camera, choose an existing photo,
   cancel permissions, lose connectivity during upload, refresh, close the tab,
   and reopen. Verify one publish with the original request ID, local date/DST
   history, reciprocity, cross-device unlock, and that locked message bodies
   never enter the DOM. Record the deliberate single-image web alternative to
   iOS's front/rear composite.
6. Send persistent and view-once photos twice, a device-decodable MP4, a live
   voice recording where the browser advertises MP4 audio, an imported M4A
   fallback, a saved sticker, and a centered overlay. Deny microphone permission
   once and verify the M4A alternative remains usable. Verify authoritative
   view sessions and sender receipts, safe rejection of undecodable/oversize
   media before upload, exact replies/reactions, and one resumed send after
   refresh. Search for a message and open its exact result; change a group photo.
7. With Stories enabled, open photo and video Stories and confirm a view is sent
   only after media reveals. As an owner inspect viewers and delete; as another
   account report. Publish a photo and device-compatible MP4, interrupt and
   resume one upload with the original request IDs, reply, share to 10
   classmates, and open the exact Story link after cold sign-in. Confirm shared
   Story cards still obey chat reciprocity. Verify signed Story URLs are never
   prefetched or present in Cache Storage; record registered-contact sharing and
   richer overlay editing as current web gaps.
8. With calls enabled, place and receive one voice and one video call between
   web and the current iOS build. Deny each permission before a start/accept;
   verify no stranded ringing call. Exercise accept, decline, mute, camera slot
   grant/release, camera-capacity fallback, group join/leave, SSE end, Wi-Fi to
   cellular loss/reconnect, tab close, rotation, wired/Bluetooth audio, and the
   exact expiring `?tab=chats&chat=<id>&call=<id>` Web Push route. Confirm the
   PWA never claims lock-screen/closed-app parity with PushKit/CallKit.
9. Subscribe to Web Push and send chat, reply, reaction, Memento, native
   Story-capture, vote/upvote/reveal, and school-question-approval events under
   `all`, `daily_only`, `muted`, blocked, removed, and left states. Verify one
   correctly grouped notification, no private preview when policy forbids it,
   and the intended destination. Story capture must open the exact Story and
   group only matching Story/viewer events. Question approval must open the
   exact `?notification=question_submission&submission_id=<id>` history card,
   including when Feed voting is locked.
10. Inspect Cache Storage and IndexedDB before and after logout and an account
   deletion request. Cache Storage must contain no API response or private
   media. Both user-scoped outboxes must be removed. Text must never exceed 50
   rows/user, 200 globally, or seven days; media must never exceed 3/user, 10
   globally, 24 hours, or four automatic attempts.
11. Install, cold launch, warm launch, scroll a long conversation, rotate, switch
   light/dark mode, use Gboard/Samsung Keyboard/iOS keyboard, increase text size,
   enable a screen reader, background aggressively, and accept a waiting service
   worker update. Focus, scroll position, composer visibility, and draft safety
   must remain predictable.

During the canary, compare APNS throughput/latency, SMS queue depth/age,
PostgreSQL connections and query latency, Redis connections, SSE active/capacity
errors, Web Push outbox age/dead letters, duplicate-key conflicts, client error
rate, and RUM p75 startup/interaction metrics to the pre-canary baseline. Any
unexplained regression is a stop/rollback condition.

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
