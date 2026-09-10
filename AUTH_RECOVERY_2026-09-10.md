# Authentication recovery — September 10, 2026

On the production first-party web app, anonymous passkey challenges, phone
lookup and username availability can retry network failures through
api.validappcdn.com, then api.six7.lol. All attempts share a ten-second deadline;
responses are consumed inside it. HTTP rejections, explicit cancellation and
offline state stop recovery. The challenge wrapper does not multiply exhausted
route attempts. The alternate requests omit cookies and Authorization. Browser
session restore, credential verification, signup completion and SMS sends remain
first-party and are not replayed by this policy. CSP admits the additional API.

Expired/unverified phone completion returns to the phone step and keeps the
profile fields. Sending a new code remains an explicit action with the existing
Turnstile, cooldown and backend checks. The test exercises the rendered flow.

Browser security failures now retain a coarse same-RP/related-origin capability
classification, without raw exception text. Installation identifiers persist in
origin-local storage, falling back to a page identifier if storage is unavailable.
The prior implementation generated an identifier per report; historical web
identifier counts cannot be described as distinct affected browsers. Diagnostic
uploads use bounded alternate routes with the same event UUID for deduplication;
they remain best effort and do not recursively report delivery errors.

This does not bypass WebAuthn validation or migrate the existing six7.lol RP.
The live related-origin JSON contains validapp.lol and staging.validapp.lol and
returns 200 from the operator network. Unsupported browsers and failure to reach
the RP's well-known document can still cause SecurityError; affected-device
reproduction is still required. See the [WebAuthn related-origin validation
specification](https://www.w3.org/TR/webauthn-3/) for why API hostname changes alone
cannot resolve those failures.

The source is based on the live static-site commit 7a8a49d66076e14ceb126799bc151d17d12cd4d0.
The package uses web-v89 and retains the previous immutable asset graph for
already-open tabs. Automated tests use mocks and do not send SMS or create accounts.
