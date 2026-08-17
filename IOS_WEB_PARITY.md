# iOS → web parity audit

Authority: the Swift client on Six7 branch
`validapp-webapp-backend-changes`, reviewed against this web branch. This audit
covers the user-facing core requested for Android users. It is not a substitute
for the final current-App-Store and physical-Android release gates.

## Core experience

| Area | iOS behavior carried to web | Automated evidence |
| --- | --- | --- |
| Authentication | Existing-passkey sign-in, related-origin `six7.lol` RP, phone-linked passkey signup, backup-passkey enrollment/count, logout/revocation, memory-only bearer | adapter journeys plus `test-passkey-backend.mjs` real registration/backup/signature/replay verification |
| Onboarding | Age, school, grade, phone identity, name, username, gender, optional photo, passkey, post-signup classmate prompt | compact Android + desktop onboarding journeys |
| Phone identity | Phone is checked before signup and stored as the same protected identity used by iOS so historical polls resolve; there is no OTP or outbound-message step | signup, phone-check, and adapter contract assertions |
| Feed | Inbox/School tabs, vote lock, paging, Recent/Hottest and All/TBHs/My Votes filters, instant + bounded server search, classmate results/filtering, typed reactions and named reactors, details/share, report/block, God Mode sender reveals | Feed, search, reaction, vote-lock, detail, reveal, and moderation journeys |
| TBH | Aura-funded requests with target eligibility and prompts, public-post consent, pending request actions, 10–300 character composer, received/sent history, public School posts, reactions, profile stats, and exact notification routes | focused TBH/reaction journeys plus adapter and web-push route contracts |
| Anonymous Inbox | Incoming questions, unread/open, answer/aura, report/block/delete, and received-reply detail with original message + response | anonymous Inbox journey |
| Play | Question artwork, four choices, immediate selection feedback, live aura/streak multiplier, shuffle, three-skip cap, paid nomination, submitted-question attribution and safety controls | Play answer, nomination, skip, moderation, and streak journeys |
| Play states | Loading/error, insufficient classmates, completion/aura celebration, cooldown countdown/automatic refresh, invite unlock | Play completion/cooldown and classmate journeys |
| Profile | Photo, bio, information cooldown, stats/streak, searchable classmates + public profile detail, God Mode entitlement/reveal balance, weekly/all-time top polls, Ask link controls, install, support/privacy, deletion/recovery | Profile, classmates, God Mode, and account-lifecycle journeys |
| Questions | Named/anonymous submission, required artwork/permission, server-configured length/cost, aura check, confirmation, moderation/refund copy, idempotent ambiguous retry | real-adapter multipart, overdraft, and idempotency journeys |
| Invites | Selected contacts, private Web Share link, daily unlock availability, qualifying-invite/aura reward progress | classmate/invite journey |
| PWA quality | Responsive Pixel/desktop shell, compact modal scrolling, offline/install state, reduced motion, haptics where supported, strict CSP | performance, compact-phone, PWA, CSP, and reduced-motion journeys |

## Deliberate platform differences

- **SMS verification is intentionally absent from signup.** The phone number is
  still collected and linked using the same protected identity as iOS.
- Native Contacts permission screens become Android Chrome's Contact Picker.
  Valid receives only the contacts explicitly selected in that gesture.
- Snapchat/iMessage/Instagram-specific sheets become the Web Share API or a
  clipboard fallback. No message is sent automatically.
- APNs prompts and iOS Settings handoffs become the browser's Web Push permission
  and subscription flow. TBH requests, TBH responses, and feed reactions route
  to their exact in-app item when the notification carries an ID.
- Existing StoreKit God Mode entitlements and sender reveals work on web, but
  StoreKit checkout is not copied to Stripe in this release candidate. Web
  recurring billing needs a separate pricing, entitlement, tax, refund, and App
  Review decision; it must not be improvised inside the core-flow launch.
- Aura-funded visibility boosts and Request a TBH use the same server-authoritative
  balance and idempotency protections as iOS.
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
