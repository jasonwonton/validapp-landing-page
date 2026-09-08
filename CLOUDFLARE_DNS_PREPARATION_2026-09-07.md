# Cloudflare DNS migration — proxy release still gated

## Cutover update — 2026-09-07

- Cloudflare is now Active. Its universal edge certificate is Active for the
  apex and first-level subdomains. Only the existing staging CNAME is proxied;
  production A/AAAA records remain DNS-only. Staging's private-access, exact
  asset hashes, synthetic passkey ceremony, narrow/wide browser, CORS and
  uncached API tests passed through the proxy. Shell/service worker revalidate;
  API responses have no PWA-only COOP/Permissions-Policy headers. Real signed
  uploads, call audio, authenticated realtime and installed updates remain gates.
- DigitalOcean `validapp.lol` domain metadata now uses externally managed DNS
  (only its `zone` field removed). Metadata deployment
  `27afb062-5bd8-4b08-92b1-48089a1cfd14` is ACTIVE and reuses all prior source
  revisions, including the migration job; migration preflight passed. All other
  configuration is identical after ignoring autoscaler-managed replica counts.
  Production PWA/config/API health remain HTTP 200. No new frontend release.
- Full CI run 34180927146 passed static, Android, Chromium and Firefox and
  progressed through WebKit's earlier layout failures. Its last failure was
  the SMS signup fixture lacking WebAuthn on Linux WebKit, confirmed by the
  unsupported-browser UI in the trace. The fixture now explicitly models
  capability; a separate negative test preserves the unsupported-browser guard.

Earlier cutover chronology:

- Correct Porkbun owner account `jasonwonton123` saved the assigned Cloudflare
  nameservers. Reopening the registrar editor confirmed both exact names.
- Before saving, direct queries to both Cloudflare nameservers matched all seven
  application records from DigitalOcean. DNSSEC remained unsigned.
- Public resolvers 1.1.1.1 and 8.8.8.8 now return the Cloudflare nameserver pair.
  All web records remain DNS-only; production returned HTTP 200 and private
  staging returned the expected unauthenticated HTTP 403 after the save.
- Cloudflare TLS mode is saved and read back as **Full (strict)**.
- Original DigitalOcean DNS zone, hosting, backend and workers are unchanged.
  Registrar rollback is the original three DigitalOcean nameservers below;
  delegation rollback has propagation delay and is not an immediate traffic switch.
- CI on a7d2f42 passed static, Android, Chromium and Firefox. Linux WebKit caught
  a feed geometry assertion during the 220 ms panel entrance animation. Test-only
  commit fb022ba waits for finite panel animations and fonts before asserting
  exact viewport geometry; all 12 feed tests across four projects passed locally.
  Full CI must pass before merging. No runtime layout or backend behavior changed.

The preparation snapshot below records the earlier state; its registrar-access
blocker is now resolved. Proxy compatibility and release validation remain open.

User authorized retaining DigitalOcean hosting/backend, migrating validapp.lol
DNS to Cloudflare, testing staging proxying before production, and validating
authentication/media/calls/realtime/updates before release.

## Saved remotely

- Added `validapp.lol` to existing Cloudflare account
  `9472d27fa2e1a3762bd91728bb7d9437`, Free plan. Zone remains **pending**.
- Copied all seven non-SOA/non-authority records from DigitalOcean. All are
  **DNS only**, including staging. No registrar or live routing change occurred.
- Assigned nameservers: `frank.ns.cloudflare.com`, `melany.ns.cloudflare.com`.
- Cache rule `5f920123c09b440d83996fc910e38a69`,
  `Valid PWA rollout: no shared edge cache`: bypass edge cache for exact hosts
  `validapp.lol` and `staging.validapp.lol`. Does not override browser TTL.
- Response-header rule `9fbb992c74c7445dbe04f04a00dc9f4c`,
  `Valid PWA security headers`: same exact hosts AND path starts with `/app/`.
  Sets all seven headers from `_headers` at web-v88. Saved values verified in
  the dashboard. No API response rewriting or feature-gate changes.
- Rules are saved active but cannot affect traffic until proxy activation.
- Existing R2 exact-origin PUT policy remains verified for both origins.

## DNS inventory at preparation

| Name | Type | Content | Priority | Original TTL |
| --- | --- | --- | --- | --- |
| @ | A | 162.159.140.98 | — | 30 |
| @ | A | 172.66.0.96 | — | 30 |
| @ | AAAA | 2a06:98c1:58::60 | — | 30 |
| @ | AAAA | 2606:4700:7::60 | — | 30 |
| @ | MX | smtp.google.com | 1 | 14400 |
| @ | TXT | google-site-verification=iVKgvhlhuZu2u0a15jlOc6gum4gjlkD0AJhvZLSNRjI | — | 3600 |
| staging | CNAME | validapp-web-staging-luibq.ondigitalocean.app | — | 300 |

Cloudflare imported TTLs as Auto. Provider authority/SOA records are generated
by Cloudflare, not copied. Existing authority remains ns1/ns2/ns3.digitalocean.com.
Registrar is Porkbun; DNSSEC is unsigned (no DS observed). Direct queries to
frank.ns.cloudflare.com verified both A answers, MX priority/target, and staging
CNAME. The dashboard verified all seven content values.

## Remaining gates — do not blindly orange-cloud the copied A records

1. Registrar access: signed-in Porkbun account `jasonwonton` currently lists
   only an unrelated domain, not validapp.lol. Requested correct owner login.
2. Validate DigitalOcean external-CDN compatibility and origin routing on staging
   before production. Apex A/AAAA values above are Cloudflare CDN addresses;
   proxying those directly can produce Error 1000. Do not enable proxy on them.
   DigitalOcean's external-CDN guidance uses its default ingress hostname and
   warns about custom Host headers/domain certificate renewal. Current production
   ingress selects the frontend by `validapp.lol` authority, and the private
   staging gateway checks its exact Host. Preserve those boundaries with a
   tested supported configuration; a DNS-only copy is not proof of proxy safety.
3. Verify TLS certificate coverage/renewal, strict origin TLS, correct frontend
   routing, untouched API/anonymous/poll/TBH/Apple association routes, and cache
   bypass. Never weaken certificate validation to make a probe pass.
4. Exercise real-account login, signed upload/finalize, two-party calls/audio,
   SSE reconnect and safe updates; synthetic tests are not physical acceptance.
5. Production still lacks explicit web presentation flags; preserve native
   master gates and server authorization. Stories/comments remain unreleased.
6. Merge only after release validation. Last full CI on 65f1c94 passed Android,
   desktop Chromium, Firefox and static checks; Linux WebKit lacked WebAuthn in
   the simulated Android-install fixture. Test-only correction a7d2f42 models
   passkey APIs without executing a credential ceremony. Four cross-browser
   handoff tests plus eleven WebKit auth-reliability tests passed locally;
   full CI run 34179836550 is pending. No application behavior was changed.

## Rollback / unchanged systems

No main merge or production/staging redeployment in this preparation step.
DigitalOcean production active deployment remains
`69b1f071-771e-4aa4-a641-3065e60d3aa2`; main remains `7e674c6`.
Backend/admin source `4446d4c1797ea9075039a784265679af83e462e4` and nine worker
sources `ce1b6a852b3bb38c91e5e9231561096182e651de` were recorded read-only.
No iOS, backend, APNS/SMS, object data, registrar, account credentials, or billing
changes. Do not delete the original DigitalOcean DNS zone during migration.
Disable only the two named new edge rules for rule rollback; any future DNS
cutover needs its own measured rollback plan accounting for propagation delay.

References:
- https://docs.digitalocean.com/products/app-platform/how-to/configure-external-cdn/
- https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1000/
- https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/
