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

Deployment target: static component `validapp-landing-page` in DigitalOcean app `b960038f-bcfb-4bde-ba3e-191cde0ccbd5`. Change only its Git branch from `codex/parent-faq-invite-example` to `codex/homepage-seo`; do not use `--update-sources`. Baseline deployment is `18f6bbc4-582a-42ba-a2b8-5fefba702f6d`, frontend source `2d974c84768e0690ad504b54b531197f0ada5904`. Compare all backend/worker/job source revisions after deployment. Rollback uses the former static branch with the latest otherwise unchanged app spec.
