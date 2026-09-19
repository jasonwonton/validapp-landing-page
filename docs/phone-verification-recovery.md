# Web signup verification recovery

The phone-verification approval has a short server-controlled lifetime. Signup asks for names, username, gender and a photo after verification. Previously the client ignored `expires_at`, so it could create a passkey after the approval expired. A rejected completion returned to phone verification, then unnecessarily repeated all profile steps and cleared the selected photo on the final step.

## Change

- Use the confirmation response's HTTP `Date` and `expires_at` to derive a local deadline, accounting conservatively for response latency and Date's one-second precision. An initially incorrect device clock does not change the remaining lifetime. Reused approvals retain only their remaining time, not a new TTL.
- Check before account setup and again after asynchronous school resolution, before starting the passkey ceremony. Missing or invalid server timing leaves the existing server rejection path in charge.
- After expiry, retain the profile and photo. An explicit SMS request and successful code confirmation return directly to the final step. Creating the account requires another explicit tap and a fresh passkey challenge/idempotency key.
- Preserve the photo when navigating among signup steps; clear it when opening a new signup flow or completing signup.
- Candidate web-v94 and its service-worker shell include the new helper; generated immutable release assets retain the previous release.

The server still enforces phone approval/expiry, passkey verification and account ownership. No TTL increase, authentication bypass, automatic SMS resend or account-write replay is introduced. Approval may still expire during an OS passkey prompt; the server rejection follows the same recovery flow. A device-clock change during the flow or a missing Date header may make the preflight hint less precise, but cannot bypass the server check.

## Verification

Two browser journeys failed against base commit `11306743a818790365ea36dae966eee29b3cc168`: expiry before passkey creation was ignored, and server-rejected expiry did not resume at the final step. The new recovery matrix covers pre-ceremony expiry, expiry during school resolution, server rejection after the ceremony, and absent server timing with a changed phone number. It checks retained profile/photo, explicit SMS, no automatic completion, fresh challenges and idempotency keys, and successful photo upload.

Additional unit coverage checks device clock skew, reused approvals, slow responses, missing/invalid timestamps and unapproved responses. Existing browser coverage checks unchanged passkey-origin requirements, bounded SecurityError recovery, safe recovery after a lost completion response, cancellation and diagnostic privacy. Validation: 92 selected source browser tests and 16 packaged recovery tests pass across Android Chromium, desktop Chromium, Firefox and WebKit; 27 auth/deadline unit tests and five static-origin tests pass, with the production build and performance budgets passing. Credentials and SMS are mocked; these do not replace real-device/provider validation.

## Release and remaining evidence

This change targets the actual serving frontend branch, `codex/pwa-session-recovery-20260916`, rather than the older main branch. The live release fingerprint was still `5b1cbf7a502f29649a0e` at the September 18 checkpoint. The candidate must be reviewed, deployed and checked through a fresh browser/service-worker session before claiming production coverage.

This change addresses verification-expiry recovery. It does not establish the cause of separate browser passkey SecurityErrors or a measured improvement in signup conversion. Real device/provider ceremonies, release adoption and production outcomes remain to be validated. Browser tests use synthetic accounts, mocked SMS and stubbed credentials.
