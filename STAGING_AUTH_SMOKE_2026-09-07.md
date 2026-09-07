# Staging auth smoke test — web-v83

This release is private staging only. Main, public validapp.lol and the production backend deployment are unchanged. Staging still calls the authoritative production API; no backend or RP-ID change is included.

## What is available

- Existing web-v82 passkey compatibility checks, Android Chrome handoff, bounded challenge retry and interrupted-signup recovery.
- Signup test opt-in: Create an account asks you to confirm real production SMS/account creation. Confirmation enables only the exact signup challenge/complete routes for one hour using a signed, HttpOnly, Secure, SameSite=Strict cookie. Preview access and exact-origin checks are still required. Cancel sends no enable request. Unconfirmed, expired or tampered opt-in is denied.
- Browser HTTP auth failures now have normalized reason categories, auth stage and a safe backend request ID. Only known error messages are mapped; unknown response text is never sent as telemetry.
- Private diagnostics now include the same-origin preview cookie to pass the gateway. The gateway strips both the account cookie and bearer Authorization before diagnostic forwarding. Production browser diagnostics remain credentials:omit.
- Gateway `auth.preview_response` events record status, fixed reason category, browser family, validated web build, staging origin and request ID. No request body, raw response text, phone, passkey credential, full UA or account identifier is logged. Response inspection is bounded to 8 KiB and never changes the response. No queue or retry is added.

These categories distinguish phone-not-verified/expired, passkey challenge invalid, passkey registration invalid, origin rejection, validation, rate limiting and identity conflicts. Several internal passkey reasons share one backend message, so this does not provide a finer reason than the authoritative API exposes. It does not claim the historical 797 HTTP 400 responses are fixed.

## Smoke checklist

1. Open your existing private staging invitation in the browser you want to test. Confirm web-v83 after the update. Opening plain staging.validapp.lol without its private cookie returns 403; browser handoff does not copy that cookie, so reopen the invitation in Chrome if needed.
2. Sign in with your existing production account and passkey. Check Feed, Chats, Memento camera/history/streaks, profile and light/dark mode. Actions use real data; do not post content to uninvolved users for testing.
3. For signup, use a separate phone number you control that is not already registered. Select Create an account. First cancel the production-data confirmation and verify signup does not open. Select it again and confirm only when ready for a real SMS/account.
4. Complete the real SMS, profile and passkey steps. Do not use an existing account's phone to try creating another account. Do not delete an existing account just to make it eligible for signup.
5. In an Android social-app browser, check that the app explains the limitation and offers Open in Chrome before SMS. Reopen the private invitation in Chrome if its preview access is missing.
6. Test lost connectivity before starting a challenge. Restore connectivity and retry. If signup completion becomes uncertain, use the explicit saved-passkey sign-in recovery; do not repeatedly submit signup.
7. Record browser/device, build, local time and visible error text for a failure. Never share SMS codes, passkey payloads or private invitation tokens in logs/issues. Staging gateway logs and `web_pwa` diagnostics can then be matched by stage/build/time/request ID.

Stories, calls and comments retain their existing staging gates; this auth release does not enable them or claim full iOS parity.

## Rollback

Validation before deploy: 170 browser regression tests passed; 2 non-Chromium worker-lifecycle skips. All 9 gateway tests, 3 static-origin tests, build, runtime and performance checks passed. The final fixed-vocabulary guard was checked separately and the gateway suite rerun after packaging. Physical-device and real-account signup acceptance are intentionally left to the tester.

Redeploy web-v82 source f5b2954bbc552b25a008399cc91bc951e9323203 (deployment b26f9a3c-3ece-4cbc-a11d-27348ea8527e). It ignores the new opt-in cookie and blocks signup again. No database migration or credential change to reverse. Accounts the tester intentionally created are real and are not erased by a frontend rollback.
