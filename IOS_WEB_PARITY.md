# iOS → web parity audit

Authority: the Swift client on Six7 branch
`validapp-webapp-backend-changes`, reviewed against this web branch. This audit
covers the user-facing core requested for Android users. It is not a substitute
for the final current-App-Store and physical-Android release gates.

## Core experience

| Area | iOS behavior carried to web | Automated evidence |
| --- | --- | --- |
| Authentication | Existing-passkey sign-in, related-origin `six7.lol` RP, passkey-only signup, backup-passkey enrollment/count, logout/revocation, memory-only bearer | adapter journeys plus `test-passkey-backend.mjs` real registration/backup/signature/replay verification |
| Onboarding | Name, username, birthday/age, gender, school, grade, optional photo, review, passkey, post-signup classmate prompt | compact Android + desktop onboarding journeys |
| No SMS | No phone field, OTP, password, or outbound-message step; contacts are user-selected and upload-only | signup and Contact Picker assertions |
| Feed | Inbox/School tabs, vote lock, paging, My Votes, instant + bounded server search, classmate results/filtering, upvote, details/share, report/block, God Mode sender reveals | Feed, search, vote-lock, detail, reveal, and moderation journeys |
| Anonymous Inbox | Incoming questions, unread/open, answer/aura, report/block/delete, and received-reply detail with original message + response | anonymous Inbox journey |
| Play | Question artwork, four choices, immediate selection feedback, live aura/streak multiplier, shuffle, three-skip cap, paid nomination, submitted-question attribution and safety controls | Play answer, nomination, skip, moderation, and streak journeys |
| Play states | Loading/error, insufficient classmates, completion/aura celebration, cooldown countdown/automatic refresh, invite unlock | Play completion/cooldown and classmate journeys |
| Profile | Photo, bio, information cooldown, stats/streak, searchable classmates + public profile detail, God Mode entitlement/reveal balance, weekly/all-time top polls, Ask link controls, install, support/privacy, deletion/recovery | Profile, classmates, God Mode, and account-lifecycle journeys |
| Questions | Named/anonymous submission, required artwork/permission, server-configured length/cost, aura check, confirmation, moderation/refund copy, idempotent ambiguous retry | real-adapter multipart, overdraft, and idempotency journeys |
| Invites | Selected contacts, private Web Share link, daily unlock availability, qualifying-invite/aura reward progress | classmate/invite journey |
| PWA quality | Responsive Pixel/desktop shell, compact modal scrolling, offline/install state, reduced motion, haptics where supported, strict CSP | performance, compact-phone, PWA, CSP, and reduced-motion journeys |

## Deliberate platform differences

- **Phone/SMS authentication is intentionally absent.** This is a product
  requirement, not a parity defect.
- Native Contacts permission screens become Android Chrome's Contact Picker.
  Valid receives only the contacts explicitly selected in that gesture.
- Snapchat/iMessage/Instagram-specific sheets become the Web Share API or a
  clipboard fallback. No message is sent automatically.
- APNs prompts and iOS Settings handoffs are not shown. The PWA currently has
  install/offline behavior but no web-push subscription flow.
- Existing StoreKit God Mode entitlements and sender reveals work on web, but
  StoreKit checkout is not copied to Stripe in this release candidate. Web
  recurring billing needs a separate pricing, entitlement, tax, refund, and App
  Review decision; it must not be improvised inside the core-flow launch.
- Aura-funded visibility-boost purchases remain iOS-only until their backend
  purchase sequence is transactional/idempotent. Exposing a non-atomic aura
  debit to easier web concurrency would be an avoidable double-charge risk.
- Debug/admin screens are intentionally excluded from the consumer web app.

## Evidence still required before release

1. Deploy the backend candidate with `WEB_RATE_LIMIT_MODE=off` and smoke-test
   the current App Store binary against it.
2. Observe ordinary iOS traffic, then move only to `observe`; explain projected
   rejections before considering `enforce`.
3. Privately serve the web candidate at the exact
   `https://validapp.lol/app/` origin and pass `npm run test:production`.
4. On a physical Android phone, test both an iOS-created passkey/account and a
   new web-created passkey/account across Wi-Fi, cellular, background/reopen,
   biometric cancellation, Contact Picker, and installed-PWA launch.
5. Keep backend and static-site rollback independent until the public release
   is approved.

See [README.md](README.md) for local/exact-origin testing and
[PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md) for the canary and rollback
order.
