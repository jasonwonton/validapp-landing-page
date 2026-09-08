# Private production-account preview

This is a **private staging candidate, not a completed parity release**.
The separate `staging.validapp.lol` service proxies only `/api/v1/` to the
existing production API. Signing in uses the existing Six7 passkey and a
host-bound HttpOnly web session. Messages, moderation actions, preferences and
Mementos affect real production data. Do not test destructive journeys with
an important account; use disposable consenting test accounts.

## Access and scope

Open the privately supplied `/preview/<access-key>` link on each device, then
sign in. This gives the browser a signed, HttpOnly, Secure, 24-hour preview
cookie. The access key is a staging runtime secret, not an account credential.
Never commit the access key or include it in public issues or screenshots.
Reopen the link if the preview expires. The default DigitalOcean hostname
intentionally does not serve the preview.

Only this private gateway enables the web Chats and Mementos presentation
gates, and only when their native capabilities are enabled by production.
Stories, calls and comments remain disabled in this cohort. Backend permissions,
membership history, blocking, moderation and idempotency remain authoritative.
Existing-account sign-in is supported; preview sign-up is intentionally denied.
No production API code, iOS flags, APNS workers or SMS workers are changed.

The gateway forwards only the app session cookie, never the preview cookie or
unrelated cookies. It rejects cross-origin writes, encoded/ambiguous API paths
and arbitrary upstreams. API responses are no-store; private media are not
added to service-worker caches. It has 64 active upstream slots, a 12 MiB
request cap, a 64 KiB config response cap, a 60-second idle upstream timeout,
and a five-minute maximum stream lifetime. Client disconnects abort upstream
work. It never retries writes; the existing client/server recovery contract
owns reconciliation. Only static shell assets use the existing bounded cache.

## Authentication configuration

The exact staging origin is appended to the API service's
`PASSKEY_EXPECTED_ORIGINS`, `WEB_AUTH_SESSION_ORIGINS` and
`CORS_ALLOWED_ORIGINS`. Existing values must be preserved. The existing
`six7.lol/.well-known/webauthn` related-origin list retains `validapp.lol`
and adds `staging.validapp.lol`. There are no wildcards, exported login tokens,
new database credentials, or bypasses of passkey verification.

Deploy the API configuration without updating source revisions. Verify all
backend and worker source revisions match the pre-change deployment. Keep
the fresh spec backup outside the repository with owner-only permissions.

## Acceptance checklist

- Automated gateway and static-origin tests pass locally and in CI.
- Uninvited requests fail closed; the authorized shell has its CSP and headers.
- Production passkey challenge is reachable at the staging same-origin URL.
- Related-origin document and exact origin permissions are live.
- User signs in with their own passkey; no agent handles their credential.
- On physical Pixel, Samsung, iPhone PWA and desktop: DM/group text, reply,
  reaction, typing/read state, invitation, Memento capture/history/deep link,
  refresh/reconnect and offline recovery with no duplicate writes.
- Validate production Web Push support separately before claiming it works;
  staging exposure alone is not a durable-push or background-send sign-off.

## Reversal

Rotate `PREVIEW_ACCESS_KEY` to invalidate every preview cookie/link immediately,
or roll the independent staging app back to its previous deployment. Remove
only the staging entry from the three API allowlists (preserving concurrent
configuration edits), and from the related-origin document. Do not replace a
current production spec blindly with an older backup. Do not update backend
source revisions during this reversal. Production data created while testing
remain normal production data and are not automatically rolled back.
