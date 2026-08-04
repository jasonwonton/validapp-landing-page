# Web recurring billing decision

Status: architecture and policy decision only. Stripe checkout is deliberately
not part of the core Android web launch until provider credentials, pricing,
tax handling, support ownership, and the entitlement migration are approved.

## Recommendation

Launch the passkey web core first without a purchase button. For the first web
God Mode experiment, use **$5.99 per week on web** while iOS remains $6.99 per
week. That is about 14% lower: enough to reward direct billing without turning
the website into a deep-discount channel. Keep the benefits identical across
providers and disclose the weekly renewal and cancellation terms plainly.

Do not automatically discount by Apple's full commission. Stripe processing,
failed-payment recovery, refunds, chargebacks, support, and digital-service tax
still have real cost. Revisit monthly or annual plans only after retention and
refund data exists; adding a second billing interval also changes the weekly
reveal/boost allocation model.

## Apple policy boundary (checked 2026-08-04)

A lower price on the independently operated website is not itself prohibited.
Apple's current [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
say that United States storefront apps may include external purchase calls to
action without the external-link entitlement. Outside the US, in-app links and
purchase calls to action remain storefront- and entitlement-dependent. Valid is
a social app, not a reader app; Apple's [reader-app eligibility page](https://developer.apple.com/support/reader-apps/)
specifically says a social network with incidental media is not eligible.

Guideline 3.1.3(b) permits a multiplatform service to honor features bought on
its website when those features are also available as iOS in-app purchases.
Therefore the conservative rollout is:

1. Keep the same God Mode entitlement available through StoreKit on iOS.
2. Let a web-bought entitlement work after the user signs into iOS.
3. Do not add a global iOS "buy cheaper on the web" link. If product later wants
   an iOS link, gate it to storefronts where it is allowed and explain it in App
   Review notes.
4. Do not apply for the reader-app entitlement; Valid does not qualify.

Apple rules vary by storefront and can change. Re-check the guidelines before
shipping an iOS purchase link; this document is an engineering recommendation,
not legal advice.

## Safe Stripe architecture

Use Stripe-hosted Checkout and the customer portal. Stripe's official
[subscription lifecycle](https://docs.stripe.com/billing/subscriptions/overview)
and [webhook guidance](https://docs.stripe.com/billing/subscriptions/webhooks)
make the webhook—not the browser success redirect—the authority for access.

The backend change should:

- Add provider-neutral subscription and processed-webhook tables. Do not put a
  Stripe ID into `apple_original_transaction_id` or overload Apple rows.
- Project any currently active Apple or Stripe God Mode subscription into the
  existing `subscribed_user` response so released iOS builds keep working.
- Create Checkout sessions only for the authenticated user, with server-owned
  user metadata and one active God Mode subscription per provider/account.
- Verify Stripe signatures against the raw request body, store each event ID
  uniquely, tolerate duplicate and out-of-order delivery, and compare event
  timestamps before mutating entitlement state.
- Grant access only for the chosen paid/trial statuses; handle `past_due`,
  `unpaid`, canceled, refunded, disputed, and period-end cancellation explicitly.
- Store provider customer/subscription/product IDs and current-period bounds;
  never trust a client-supplied price, user ID, status, or expiry.
- Reuse the existing cache invalidation and period-allocation rules so a webhook
  retry cannot mint extra reveals or boosts.
- Provide a short-lived authenticated customer-portal session rather than
  building card-management UI.
- Configure an appropriate Stripe Tax product code and confirm registration
  obligations before live sales; Stripe documents tax classification in its
  [product tax code guide](https://docs.stripe.com/tax/tax-codes?type=services).

## Required test gate

Use Stripe test mode and the Stripe CLI before any live key exists in the app:

- successful Checkout, 3DS, cancellation, renewal, payment failure/recovery;
- duplicate, delayed, replayed, and out-of-order webhook delivery;
- Apple-only, Stripe-only, overlapping, expired, refunded, and provider-switch
  accounts;
- iOS reads a web entitlement without changing its current response schema;
- no browser bundle, log, error response, or repository contains a secret key;
- checkout/session/webhook endpoints have targeted rate/body limits, while the
  webhook remains available to valid signed Stripe deliveries.

Only after these pass should the profile show Subscribe/Manage Billing. Keep
Stripe test and live products, prices, keys, webhook secrets, and endpoints
strictly separate.
