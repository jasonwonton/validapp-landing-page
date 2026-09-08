# Android web passkey reliability — September 7, 2026

Status: Partial; not Production-ready. Frontend-only web-v82 candidate for private staging.

## Diagnosis and confidence

- Confirmed: the old client translates any credential `SecurityError` into “not enabled for this domain.” That text does not establish a backend feature flag failure.
- Confirmed: web runs at `validapp.lol`; released credentials use RP ID `six7.lol`. Cross-domain ceremonies require Related Origin Requests (ROR). The live RP well-known endpoint currently returns validapp.lol and staging.validapp.lol with HTTP 200 JSON. The API still returns `rpId: six7.lol`.
- Likely compatibility contributor, not a proven count of affected users: older browsers and embedded Android WebViews may lack the necessary passkey / ROR integration. An exact affected URL/browser/device reproduction is still requested. Do not classify every Samsung browser as unsupported.
- Confirmed: “Could not reach Valid” is the client's generic fetch transport error. It cannot distinguish DNS, TLS, lost connectivity, browser restrictions, or proxy interruption. API/challenge requests and exact-origin preflights succeeded during this check; that does not disprove earlier incidents.
- Confirmed separate configuration gap: www.validapp.lol does not resolve in this environment (A/AAAA ENOTFOUND). This fails before app loading, so it is not an established explanation for an in-app error. DNS/TLS/canonical redirect repair is not included.
- Native iOS uses AuthenticationServices and associated domains for six7.lol, not a browser's cross-domain ROR integration. iPhone PWA still has web constraints.
- Public validapp.lol currently serves web-v39. Private staging was web-v81. The public domain is hosted by the shared backend DO app, not solely the old standalone frontend app; merging the entire parity branch would trigger a materially broader rollout.

Primary browser references: [ROR](https://passkeys.dev/docs/advanced/related-origins/), [Android embedded browsers](https://passkeys.dev/docs/reference/android/).

## Frontend changes

- Check secure context, credential APIs, known embedded Android browsers, and explicit ROR capability failure before signup/SMS. Missing capability introspection does not itself block a browser.
- An actionable Android Chrome intent link carries only a trusted origin and signup/signin intent. Never carries a phone, credential, arbitrary redirect, or invite token.
- Keep the RP ID, allowed server origins, required user verification, attestation serialization and backend APIs unchanged. Never redirect to six7.lol/app: that route is not deployed.
- Retry only a challenge transport timeout/failure, at most once while online. Never automatically retry SMS, credential verification or account creation.
- On ambiguous signup completion, read the HttpOnly session and accept only the newly requested user ID. If unconfirmed, disable repeat submission and offer explicit sign-in with the saved passkey. No attestation replay.
- Add capped (three distinct events per page), best-effort diagnostics through the existing client-log endpoint. Stage, coarse browser family, connectivity, build and normalized error code only; no personal information, raw errors, credentials, persistent queues or background retries.

## Validation and release gates

Automated coverage includes early browser rejection before challenge/SMS, same-RP behavior, safe Chrome handoff, bounded challenge retry, no retry on HTTP rejection/offline, matching-session recovery, unknown-result UI, required user verification and telemetry privacy/bounds. Production-adapter and service-worker update/rollback regression suites accompany the change.

Local results: production-adapter + auth + update suite 158 passed / 2 explicit non-Chromium worker-lifecycle skips. Final diagnostic fail-safe follow-up plus auth/update rerun: 38 passed / 2 skips. Build, UI runtime, performance budgets, all 7 private-gateway tests and all 3 static-origin tests passed. One preliminary worker test read the old unbuilt v81 package; the packaged reruns above passed. No physical-device result is implied.

Private staging intentionally rejects signup: it is for existing production accounts. Signup writes are tested with intercepted APIs only. Diagnostics use credentials:omit, so the private gateway also rejects them without its preview cookie; no private live diagnostic delivery is claimed. Chrome handoff does not transfer preview access between browsers. Public diagnostic delivery and real signup remain rollout gates.

Before public readiness: confirm real Pixel Chrome, Samsung Internet/Chrome, Android social-app handoff, iPhone PWA and native iOS credential reuse; test cellular/Wi-Fi switching with authorized test accounts. Automated emulation and a virtual authenticator are not physical-device signoff. Confirm diagnosis with affected-user browser/URL and monitor stage-coded failures after a scoped release; no historical incident rate is claimed.

Private rollback: web-v81, source 0659a5c95b3cfd9c70bf59b75741239fbe39ad76, deployment 3a4df02f-09d0-4654-b77c-0e8cfadaf45e. Redeploy that source; no database, APNS, SMS-worker, DNS or credential migration to reverse.

Unsupported ROR cannot be implemented reliably in ordinary client JavaScript. A future first-party six7.lol authentication host or carefully designed session handoff would require a separate scoped hosting/security change. Do not change the RP ID to validapp.lol or weaken origin checks as a workaround.
