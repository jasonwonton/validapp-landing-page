# Valid public website SEO release — September 13, 2026

The homepage retains the approved light background, Jua typography, Apple/Chrome buttons, peach parent FAQ button, and original phone imagery. It now provides crawlable app and safety answers, descriptive metadata, canonical URLs, and platform-specific app structured data. There is no rating markup or guarantee of Google rich results/AI Overview citations.

Seven public canonical URLs appear in `/sitemap.xml`, linked from `/robots.txt`. The text-message explainer is linked from the homepage, parent FAQ, and privacy policy. Its copy distinguishes member-shared invitations from Valid activity notifications; it replaces the inaccurate claim that every text is user initiated.

The local Jua WOFF2 is 17,516 bytes instead of the former 2,101,500-byte TTF. Lossless homepage logo and phone images are 22,170 and 55,054 bytes, respectively, with intrinsic dimensions to reserve layout space.

## Measurement

Google Analytics account 290657285, property **Valid website (553937118)**, web stream **Valid public website (15770422014)**, measurement ID **G-49LKQ62956**. Enhanced measurement is disabled. Explicit events are `page_view`, `download_ios`, `download_android`, and `parent_faq_click`. The Android event counts the web-app entry button, not an installed Android app. iOS clicks are not verified installs.

The public-only loader excludes `/app/`, localhost, unknown routes, Global Privacy Control, and Do Not Track. It removes query strings/fragments and referrer paths, disables advertising signals/personalization, and sets one-day non-renewing analytics cookie expiry. No account IDs or profile content are passed by this implementation. Blockers and opt-outs make counts incomplete. Historical FAQ visits cannot be reconstructed from this new property.

Search Console URL-prefix property: `https://validapp.lol/`, HTML-tag ownership verification. Use Performance to monitor branded queries (Valid, Valid app, Valid compliment classmates), impressions, clicks, and landing pages. Use GA Reports → Engagement → Pages and screens, filter `/parents.html`, for FAQ views after collection starts.

## Validation and release scope

`npm run build`, `npm run test:seo` (5), `npm run test:static-origin` (5), and `npm run test:staging` (10) pass. Homepage visually checked on desktop and a 360px mobile viewport. CI includes the SEO checks. No application module or generated `dist/app` changes.

Deployment target: static component `validapp-landing-page` in DigitalOcean app `b960038f-bcfb-4bde-ba3e-191cde0ccbd5`. Change only its Git branch from `codex/parent-faq-invite-example` to a fresh release branch (`codex/homepage-seo-final` for this release); do not use `--update-sources`. Baseline deployment is `18f6bbc4-582a-42ba-a2b8-5fefba702f6d`, frontend source `2d974c84768e0690ad504b54b531197f0ada5904`. Compare all backend/worker/job source revisions after deployment. Rollback uses the former static branch with the latest otherwise unchanged app spec.

## Verified production outcome

Final application/static code commit: `3071bfab3cec09fefe62a35cef48ba24826cbda9`, deployed from `codex/homepage-seo-final` in deployment `4c549cc6-fe95-4e43-95c4-139e69f49bc3` (ACTIVE). Backend, admin, worker, and migration revisions match the original baseline. All seven public canonical URLs return 200, contain the public analytics loader, and permit indexing. Homepage and parent FAQ views plus `parent_faq_click` appeared in GA4 Realtime; the first entries include QA traffic. iOS and Android click events are registered as key events without monetary values.

Google Search Console verified ownership via HTML tag. Root and parent FAQ were already indexed. Indexing requests for root, parents, and the new text-message page succeeded and entered Google's priority crawl queue. Search Console's live tests can fetch the root and full sitemap XML. The submitted sitemap report still says “Couldn't fetch”; it was resubmitted after successful live validation and needs Google's report to refresh. No indexing/AI citation guarantee is implied. New Performance reports are processing.

Cloudflare's sampled last-24-hour report showed 230 verified search-crawler requests served (71 at the edge, 159 by origin), including Google fetching the new parent FAQ, explainer, and assets. No security settings were changed. This sampled report is supporting evidence, not a complete request log.

CI static-release-checks pass. All four broader browser jobs stop at the existing `tests/chat-api-contract.spec.js:52` upload fixture missing `/app/auth-route-recovery.js`; the same failure is present on main in run 34615525515. Release run 34775948269 confirms it. The PR remains open for review rather than changing unrelated app tests.

DigitalOcean can reuse a previously selected branch's cached source revision when `--update-sources` is omitted. A retry to a rewritten branch failed before publishing because its cached revision was unavailable. The final deployment uses a new branch and verifies its exact commit. Do not rewrite deployment branches; do not enable global source updates to work around this.

## Parent safety wording follow-up

The homepage now uses the parent FAQ's fuller bullying answer: a kind, welcoming space; human review of every poll before publication; an under-15-minute moderation SLA; reporting and blocking; and an honest acknowledgment that no social app can prevent every harmful interaction. It links back to the parent FAQ for safety and support.

Copy commit `943874924715073a7342af373ddc7a46479bdbb1` is live from `codex/homepage-parent-safety-20260913`, deployment `7b901dfc-1cfe-4c6e-a091-02f692f11e16` (ACTIVE). All backend, admin, worker, and job source revisions match the preceding deployment. Build and all five SEO checks pass; local layout and the published bare root were verified in the browser.

## Affiliation and data commitment follow-up

The homepage has visible answers stating that Valid is not affiliated with Peek: Secret Compliment and that Valid does not buy or sell data, nor will it ever. The data wording matches the existing parent FAQ and privacy policy. The homepage, parent FAQ, and text-message explainer attribute contact-list messaging concerns to the school superintendent quoted by KNWA/FOX24, link the article, and explain that the article identifies Peek. They direct readers to Valid's own messaging and opt-out practices without claiming Valid never sends notifications to nonmembers. The article was verified in the existing Chrome tab.

Code commit `2e5416e03236e217c7f9e34042f5a6203ef12e1a` is live from `codex/homepage-peek-context-20260913`, deployment `d450bed1-56bd-43be-bdab-5ef147013d9b` (ACTIVE). All backend, admin, worker, and job source revisions match the preceding deployment. Build and five SEO checks pass. The local layout and live copy on all three changed pages were verified, including the bare homepage URL. Google confirmed the homepage indexing request was added to its priority crawl queue; this does not confirm refreshed indexed content or AI citations.
