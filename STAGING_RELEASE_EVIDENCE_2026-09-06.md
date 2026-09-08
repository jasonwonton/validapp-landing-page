# Private staging release evidence — September 6, 2026 (Pacific)

## Deployed boundary

- Private origin: `https://staging.validapp.lol` (HTTPS/domain ACTIVE).
- PWA source: `c8fbb404c40f7b3ac5a6a581e1b9590f9a16e12b`.
- Staging deployment: `4242e3b3-1448-49e9-91f2-b9bbe507932d` (ACTIVE).
- API configuration deployment: `fbf782d9-96e4-4bfd-8e55-d5d9461f33ee` (ACTIVE).
- Backend source remains `e9725209e3afc54df27c5aa7a23e8a5a22c6eccb`.
- Related-origin document commit: `59ebc9c761bb5596c2d4394eb3e09d2020426639`.
- Previous staging deployment before private-origin changes:
  `e4836d5d-a61e-4fc8-afc8-dad9772c1ff5`.

Read-back comparison confirmed every production service, worker, migration-job,
and static-site source hash stayed unchanged. Spec comparison confirmed only
the API service's three origin allowlists changed; all worker configurations
and the autoscaling policy were preserved. DigitalOcean reported previous
build reuse for admin, all workers, migration and production static site.
This is configuration/source-integrity evidence, not an APNS/SMS throughput
benchmark or proof of zero transient operational impact.

## Validation

- Seven gateway tests passed, including chunked-body cap and connection-slot
  recovery after 64 simultaneous streaming connections.
- Three static-origin tests passed; UI-runtime tests passed.
- Startup/cache budgets passed: 39 shell entries, 666,940-byte transfer estimate,
  17,516 bytes of fonts and 358,622 bytes of artwork.
- Live private entry, signed cookie, rejection without invitation, HTTPS/CSP,
  no-store API, production passkey challenge, config cohort gates and rejected
  cross-origin write checks passed.
- Live desktop 1280px and mobile 393px signed-out Chromium layouts had no
  JavaScript runtime errors or horizontal overflow.
- A synthetic local WebAuthn credential completed a Chromium related-origin
  ceremony for RP `six7.lol` from `staging.validapp.lol`. The assertion was
  **not sent to production**. No real account was authenticated by the agent.
- Production CORS preflights passed for staging and retained `validapp.lol`
  and `six7.lol` origins.
- Five bounded, read-only production config samples after rollout returned 200
  in 158, 38, 38, 40 and 46 ms from this host. This is only a small smoke sample,
  not a production capacity measurement.

The new full browser CI run is
[34087268470](https://github.com/jasonwonton/validapp-landing-page/actions/runs/34087268470).
At handoff its static-release job passed; four browser jobs were still running.
The optional backend-integration job was skipped because its CI gate is not
enabled. Do not label the full rerun green until its final result is inspected.

## Open acceptance gates

The account owner must sign in using their own passkey and validate real
Chats/Mementos data, sends, media, invitations, moderation, exact links,
reconnect and offline recovery. Physical Pixel, Samsung, iPhone installed PWA,
and desktop acceptance remain open. Durable push and notification destinations
are not certified by this preview. Stories, calls and comments remain disabled
in this private cohort. Public release remains NO-GO under the parity matrix.

Access secrets and pre-change configuration backups are outside git with
owner-only permissions. See `STAGING_PROD_ACCOUNT.md` for reversal, real-data
warnings and the bounded gateway design. No preview access key belongs in this
document or in a public issue.
