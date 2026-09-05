# Six7 iOS → PWA parity and release matrix

Last audited: September 5, 2026
Authorities: the current Swift client and the Six7 backend contracts. The backend remains authoritative for identity, membership history, moderation, reciprocity, idempotency, notification eligibility, and media lifecycle.

## Status contract

`Parity` uses exactly one of these values:

- **Equivalent** — the meaningful iOS journey and server safety rules are represented on web.
- **Partial** — a useful, safe web journey exists, but an iOS behavior or required reliability layer is absent.
- **Missing** — iOS has the capability and the PWA does not.
- **Native-only** — the browser cannot offer the same reliable primitive; the documented alternative is deliberate.
- **Not yet tested** — implementation may exist, but there is not enough evidence to classify it.

`Release` is **Production-ready** only after its automated, final-origin, observability, rollback, and physical-device gates pass. Otherwise it is **Not yet tested**. An `Equivalent` implementation is not automatically releasable.

## Chats and Mementos

| Journey / invariant | Parity | Release | Evidence and remaining gate |
| --- | --- | --- | --- |
| Chat list, unread counts, pagination | Equivalent | Not yet tested | Pixel 7 and desktop Chromium automation pass; final-origin load and large-account paging remain. |
| Direct-message creation | Equivalent | Not yet tested | Uses the released `/chats` contract; physical-device and production canary remain. |
| Named group creation | Equivalent | Not yet tested | Automated create/open/list journey passes. |
| Group invitations: list, accept, decline | Equivalent | Not yet tested | Invitation rendering plus accept/decline contracts and the destructive decline journey are automated; production membership-history audit remains. |
| Group rename and invite members | Equivalent | Not yet tested | Owner journey automated. |
| Remove members / leave group | Equivalent | Not yet tested | Owner removal and member leave reload the authoritative roster/list in browser automation; production membership-history assertions remain. |
| Text messages | Equivalent | Not yet tested | Optimistic send reconciles by stable `client_request_id`; physical offline/reopen gate remains. |
| Replies | Equivalent | Not yet tested | Reply context and contract exercised in Playwright. |
| Reactions | Equivalent | Not yet tested | Add/remove, summary, and authoritative named reactor detail use the iOS contracts. |
| Typing indicators | Equivalent | Not yet tested | Ephemeral backend contract is used; two-device timing and reconnect test remain. |
| Read state / unread badge | Equivalent | Not yet tested | Through-sequence writes, badge reconciliation, per-message read state, and named reader detail use authoritative membership sequences. |
| Hide for me / unsend | Equivalent | Not yet tested | Browser coverage proves per-user hiding and content-free authoritative tombstones, including the sender's post-unsend history; production membership-history smoke remains. |
| Chat report | Equivalent | Not yet tested | Existing moderation endpoint and its authenticated request contract are automated; production moderation-queue smoke test remains. |
| Block from chat context | Equivalent | Not yet tested | Chat member controls now call the existing authoritative account-wide block endpoint; cross-client membership-history smoke remains. |
| Per-chat notification level | Equivalent | Not yet tested | `all`, `daily_only`, and `muted` use the iOS contract; repeated UI changes and the shared APNS/Web Push eligibility matrix are automated. |
| SSE foreground realtime | Partial | Not yet tested | Named `chat` events, cursor continuation, bounded deltas, and authoritative reconnect repair are automated; two-device timing, proxy interruption, and capacity soak remain. |
| Exact chat deep link | Equivalent | Not yet tested | `?tab=chats&chat=<id>` restore is automated. |
| Exact message / Memento deep link | Equivalent | Not yet tested | Web Push carries `chat` plus `message`; cold-start restore highlights and scrolls to that authoritative chat message. Final-origin push proof remains. |
| Exact Story deep link | Equivalent | Not yet tested | `?story=<id>` resolves from the authoritative feature-gated feed after sign-in and is automated; final-origin Story notification routing remains. |
| Exact call deep link | Equivalent | Not yet tested | Expiring Web Push and foreground call events route to `?tab=chats&chat=<id>&call=<id>`; the cold-start contract is automated and final-origin tray proof remains. |
| Pending text after refresh/reopen | Equivalent | Not yet tested | User-scoped IndexedDB outbox is capped at 50/user and 200/global, expires at 7 days, retries at most 8 times with bounded backoff, and reuses the same request ID. Physical killed-tab recovery remains. |
| Pending text after logout/deletion request | Equivalent | Not yet tested | Both text and media outboxes are erased for that user; automated coverage passes and final-origin verification remains. |
| Daily Memento capture and JPEG preparation | Partial | Not yet tested | Browser camera/file input and bounded image preparation work, but the web flow captures one image rather than iOS's front/rear composite. Pixel, Samsung, and iPhone camera UX remain. |
| Memento upload/finalize/publish | Equivalent | Not yet tested | Uses the same private backend lifecycle and one stable request ID; bounded origin-scoped IndexedDB recovery resumes on the next Chats open. Physical interruption testing remains. |
| Memento reciprocity gate | Equivalent | Not yet tested | Locked message bodies stay out of the DOM; unlock journey passes in all four lab projects. |
| Skip Memento for today | Equivalent | Not yet tested | Uses the same authoritative daily-row skip endpoint and unlocks without fabricating a post. |
| Seven-day Memento history | Equivalent | Not yet tested | Date rail and historical rows are automated indirectly; timezone/DST physical tests remain. |
| Multi-chat Memento audience | Equivalent | Not yet tested | Accepted-chat picker publishes one authoritative daily entry to all selected chats; automated coverage passes. |
| Reshare an existing Memento | Partial | Not yet tested | Gallery Share sends the authoritative daily entry with a stable request ID; iOS additionally supports holding it as a composer draft with optional text. |
| Reply/react from Memento gallery | Equivalent | Not yet tested | Gallery resolves the authoritative chat message before creating a reply or reaction; automation passes. |

## Rich communication

| Journey | Parity | Release | Web behavior / gap |
| --- | --- | --- | --- |
| Persistent chat photos | Equivalent | Not yet tested | Bounded JPEG preparation, private upload/finalize, stable message request, viewer, and reopen recovery are automated. Physical camera/share testing remains. |
| Persistent chat videos | Partial | Not yet tested | MP4 upload, thumbnail, duration, viewer, and recovery paths exist, but browser codec support varies and web has no safe universal transcode; undecodable input is rejected before upload. |
| View-once photos/videos | Partial | Not yet tested | Photos use authoritative sessions and are automated through both allowed opens; video remains codec/device-dependent. |
| View-once replay rules and receipts | Equivalent | Not yet tested | Session start occurs only after successful reveal, the server owns the two-open allowance, and sender receipts use the authoritative endpoint. Final-origin two-device proof remains. |
| Screenshot detection | Native-only | Not yet tested | Web cannot reliably detect screenshots. It truthfully exposes capture receipts recorded by native clients and can receive their exact Story-capture push. |
| Screen-recording detection | Native-only | Not yet tested | Same deliberate alternative for native-recorded capture receipts; no false browser security claim. |
| Text/media overlays | Partial | Not yet tested | Centered accessible text overlays round-trip through the server; iOS-style positioning/editor gestures are absent. |
| Voice messages | Partial | Not yet tested | Compatible browsers record MP4 audio locally with a five-minute ceiling; every browser retains M4A selection/capture, duration validation, private upload, playback, and recovery. Waveform editing and physical permission UX remain. |
| Stickers | Partial | Not yet tested | Saved-sticker picker and idempotent send are automated; sticker creation remains in the iOS camera editor. |
| Live camera filters / saved-filter gallery | Missing | Not yet tested | iOS can create, save, share, and apply server-compiled live filters. The PWA has no reliable camera-filter editor or renderer yet; its filter-ready Web Push deliberately opens Chats instead of claiming an exact web editor. |
| Story rail, photo viewing, and view state | Equivalent | Not yet tested | Independently web-gated rail uses signed authoritative media and records a view only after reveal; four-project browser automation passes, while final-origin and physical-device proof remain. |
| Story video viewing | Partial | Not yet tested | The same signed viewer supports controlled playback, but browser/device codec support must be proven and there is no safe universal web transcode. |
| Story viewers, delete, and report | Equivalent | Not yet tested | Owner viewer/delete and non-owner moderation routes use the released contracts; production moderation and two-account smoke remain. |
| Story creation/editor/publishing | Partial | Not yet tested | Photo/codec-compatible MP4 preparation, private upload/finalize, caption, centered overlay, stable publish IDs, and bounded reopen recovery are implemented. Multi-clip capture and gesture positioning remain iOS-only today. |
| Story reply/share | Partial | Not yet tested | Text replies and up-to-10 classmate shares create or reuse authoritative chats with stable request IDs; iOS additionally offers registered-contact sharing for the Story owner, and physical two-account smoke remains. |
| Conversation/inbox search | Equivalent | Not yet tested | Explicit bounded server search opens exact chats/messages; automation passes. |
| Media recovery after refresh/network loss | Equivalent | Not yet tested | User-scoped IndexedDB retains at most 3 uploads/user and 10 globally for 24 hours, attempts at most 4 times, and reuses upload/send IDs. Mementos expire at the local day boundary rather than posting on the wrong day. Reopen delivery is automated; physical loss/recovery remains. |
| Voice/video calls | Partial | Not yet tested | A separately gated, lazy LiveKit client supports open-app start, incoming accept/decline, microphone/video publication, authoritative camera slots, mute/camera controls, participant media, reconnect status, and end/leave. Mocked four-project browser flows and released HTTP contracts pass; two-account LiveKit, device permissions, Bluetooth/audio route, participant moderation, rotation, backgrounding, and network handoff remain. Reliable closed-app/lock-screen ringing is native-only. |
| Group photo / appearance controls | Partial | Not yet tested | Owners can prepare and replace the authoritative group photo; richer iOS appearance controls remain absent. |

## Notifications and background behavior

| Journey / invariant | Parity | Release | Evidence and remaining gate |
| --- | --- | --- | --- |
| Durable Web Push outbox | Equivalent | Not yet tested | Backend migration/worker tests pass; stored collapse identities now survive direct, shadow, and durable provider delivery. Production worker lag, dead-letter, and throughput observation remain. |
| Chat message push | Equivalent | Not yet tested | Backend fan-out is durable and carries the exact authoritative message target; two-device final-origin proof remains. |
| Reply/reaction push | Equivalent | Not yet tested | Replies follow the chat-message path, reactions target the author, and both carry exact chat/message routes; APNS/Web Push preference and grouping matrices are automated. Final-origin tray proof remains. |
| Memento push | Equivalent | Not yet tested | Durable delivery carries the exact authoritative Memento message target; final-origin notification-tray proof remains. |
| Story capture push | Equivalent | Not yet tested | Native capture receipts now also enter the independent durable Web Push path with per-Story/viewer grouping and an exact `?tab=feed&story=<id>` destination; final-origin proof remains. |
| Incoming-call Web Push | Partial | Not yet tested | With `ENABLE_WEB_CALLS=1`, the call-start transaction writes one durable browser intent per subscription with the authoritative ringing expiry, stable call collapse ID, and exact call route. It does not replace PushKit; final-origin notification/device proof remains. |
| Closed-app incoming call | Native-only | Not yet tested | iOS uses PushKit and CallKit. The deliberate PWA alternative is an expiring visible Web Push that opens the exact call; browsers cannot guarantee immediate execution, full-screen ringing, or background media while the PWA is closed. |
| Vote / TBH / reaction / reveal push | Equivalent | Not yet tested | Transactional producers now add failure-isolated durable browser intents alongside APNS; vote, upvote, reaction, TBH, and reveal IDs route to the authoritative PWA item. Final-origin regression smoke remains. |
| Poll / TBH comment push | Partial | Not yet tested | Durable notification intent and exact parent-item routing exist, but the PWA does not yet render the native comment threads, so the comment itself is not actionable on web. |
| Question-approval push | Equivalent | Not yet tested | Approval enters the independently failure-isolated durable Web Push path without changing APNS and opens the exact authoritative submission in My Questions, even while Feed voting is locked. Four-project browser contract tests cover routing; final-origin tray proof remains. |
| Play unlock / streak-warning push | Equivalent | Not yet tested | Both use the existing durable browser outbox when enabled and open Play. Scheduled selection now includes users with either eligible iOS tokens or active browser subscriptions, and streak-warning taps record the same authenticated authoritative open receipt as iOS. Backend and four-project adapter coverage pass; final-origin tray proof remains. |
| Memento streak-warning push | Equivalent | Not yet tested | Scheduled selection includes web-only subscribers, and the producer adds a separately failure-isolated durable Web Push intent with the same daily fence, collapse identity, midnight expiry, and Chats destination. Final-origin delivery remains. |
| Camera-filter-ready push | Partial | Not yet tested | Durable Web Push opens Chats, matching iOS's top-level destination, but the PWA cannot open the exact saved filter because the live-filter feature is currently missing on web. |
| Feedback-response push | Equivalent | Not yet tested | Admin-created responses enter the independently failure-isolated Web Push path and open the exact bounded feedback thread after cold sign-in. Four-project adapter and final-origin tray proof remain. |
| Comment-moderation push | Partial | Not yet tested | Browser delivery uses the shared durable path and safely opens the app, but the PWA lacks the native comment-access notice UI and acknowledgement journey. |
| Aura / targeted-boost lifecycle push | Partial | Not yet tested | Ordinary and admin-created targeted boosts now enqueue browser delivery even for a web-only target, but notification clicks still use the safe generic Feed destination rather than an exact boost/aura surface. |
| Admin / broad engagement push | Partial | Not yet tested | Streak Guardian engagement blasts and other broad campaigns are still selected from iOS token ownership. Web-only subscribers are not yet included in those campaigns, so they must not be claimed as PWA parity. |
| Silent inbox invalidation | Native-only | Not yet tested | iOS can receive a content-available background invalidation. The PWA deliberately avoids a misleading visible notification and repairs from the authoritative inbox when foregrounded. |
| Notification grouping | Equivalent | Not yet tested | The service worker honors server tags, and durable collapse identities now become stable browser tags instead of being discarded; Android notification-tray validation remains. |
| Notification preferences | Equivalent | Not yet tested | Global browser subscription plus `all`, `daily_only`, and `muted` chat levels cover the meaningful iOS controls. Event-type routing is audited separately above; physical browser-permission and tray checks remain. |
| Badge behavior | Partial | Not yet tested | In-app chat badges and progressive `setAppBadge`/`clearAppBadge` updates are automated; installed-app support varies and notification-tray/device validation remains. |
| Safe notification URLs | Equivalent | Not yet tested | Service worker accepts only same-origin `/app/` destinations. |
| Private media in service-worker cache | Equivalent | Not yet tested | Cache Storage is an explicit app-shell allowlist with no runtime writes; `/api/` and the 552 KB lazy LiveKit bundle are excluded. Build and browser inspection pass; final-origin verification remains. |
| Background text send while tab is closed | Partial | Not yet tested | Send resumes on the next foreground Chats open; the PWA does not claim guaranteed closed-tab execution. |
| Background binary upload while tab is closed | Native-only | Not yet tested | Browsers do not guarantee long-running closed-tab upload. Deliberate alternative: persist a bounded local payload and resume idempotently on the next Chats open; automated reopen delivery passes. |
| Retry/storage growth bounds | Equivalent | Not yet tested | Text/media outbox caps, expiry, batch sizes, attempt ceilings, and max five-minute backoff are automated. |
| APNS isolation | Equivalent | Not yet tested | Web Push has a separate durable outbox/worker; production throughput comparison remains. |
| SMS queue isolation | Equivalent | Not yet tested | PWA code does not write SMS jobs; production queue-depth comparison remains. |

## Native-quality experience

| Capability | Parity | Release | Evidence and remaining gate |
| --- | --- | --- | --- |
| Cold startup / route splitting | Equivalent | Not yet tested | Lab DCL improved from 5.65 s to 1.93 s; final-origin RUM p75 is required. |
| Stable keyed feed/chat rows | Equivalent | Not yet tested | Runtime/performance checks enforce identity-preserving reconciliation; overflow-safe bottom alignment prevents long chats from rendering behind the Memento rail. |
| Long-list DOM bounds | Partial | Not yet tested | `content-visibility`, page limits, and a hard 500-message in-memory/DOM window exist; full virtualization and large-account soak remain. |
| Responsive touch interactions | Equivalent | Not yet tested | Pixel emulation passes; physical low/midrange Android gate remains. |
| Keyboard-safe layouts | Partial | Not yet tested | Visual Viewport handling exists; Samsung Keyboard, Gboard, and iPhone PWA checks remain. |
| Camera/composer polish | Partial | Not yet tested | Capture, preview, compression, progress, compatible live MP4 voice recording with M4A fallback, photo/video selection, view-once, overlay, reply, and reactions work; physical camera/microphone/keyboard and richer editing remain. |
| Accessibility semantics/focus | Partial | Not yet tested | Labels, live regions, reduced motion, and touch targets exist; screen-reader and contrast audit remain. |
| Offline shell/installability | Equivalent | Not yet tested | Manifest/service-worker shell tests pass; installed physical-device update/reopen remains. |
| Offline private-data isolation | Equivalent | Not yet tested | No authenticated API/media response enters Cache Storage; scoped snapshots/outbox are cleared at account exit. |
| Predictable app updates | Partial | Not yet tested | v57 carries the audited notification destinations and streak-open receipt while keeping telemetry/cache versions synchronized; waiting-worker rollback/update soak remains. |
| Strict CSP runtime behavior | Equivalent | Not yet tested | Response and meta policies keep `style-src 'self'` without `unsafe-inline`; bounded same-origin CSSOM rules cover dynamic progress, overlays, viewport, crop, and drag state in all four lab projects. Final-origin header verification remains. |
| Dark Mode | Equivalent | Not yet tested | System color scheme now drives the core shell, Chats, Mementos, forms, and dialogs; automated computed-style check plus visual/accessibility review remain. |
| Haptics | Partial | Not yet tested | Android vibration is progressive enhancement; precise native haptic parity is unavailable. |
| Contact picking | Native-only | Not yet tested | Web alternative is the user-gesture Contact Picker with explicit selection only. |
| Native share sheets | Native-only | Not yet tested | Web Share API with clipboard fallback. |
| StoreKit purchase | Native-only | Not yet tested | Existing entitlements are readable; no unreviewed web billing substitute. |
| Debug/admin screens | Native-only | Production-ready | Deliberately excluded from the consumer PWA. |

## Remaining established Six7 journeys

| Product area | Parity | Release | Candidate scope |
| --- | --- | --- | --- |
| Existing-passkey sign-in / related origin | Equivalent | Not yet tested | Automated adapter coverage; real iOS-created passkey at `validapp.lol` required. |
| SMS-verified web signup | Equivalent | Not yet tested | Current adapter requires Turnstile-backed request and confirmation; tests were corrected to the released contract. |
| Onboarding/profile/classmates | Equivalent | Not yet tested | Candidate regression suite and physical responsive pass remain. |
| Personal/School feed and reactions | Equivalent | Not yet tested | Existing automated journeys; production canary remains. |
| Play, skips, nomination, question submission | Equivalent | Not yet tested | Server-configured costs/limits and idempotency covered; production canary remains. |
| School-question history, results, withdrawal, and deactivation | Equivalent | Not yet tested | The bounded 100-row My Questions view uses the released GET/DELETE contracts, server-owned result thresholds, and exact approval target. Four-project browser automation covers published results, deactivation with poll preservation, and pending withdrawal/refund; final-origin and moderation smoke remain. |
| TBH and Anonymous Inbox | Equivalent | Not yet tested | Existing automation; exact Web Push routes remain in notification gate. |
| Feedback submission, history, and team responses | Equivalent | Not yet tested | The PWA uses the existing authenticated history contract, renders at most 20 feedback threads and five responses each, and opens an exact response target without persistent private caching. Final-origin notification proof remains. |
| Poll and TBH comment threads | Missing | Not yet tested | iOS can create, reply to, react to, report, and receive moderation notices for comments. The PWA currently has no comment-thread UI; notification clicks can only open the authoritative parent item. |
| Moderation/blocking | Partial | Not yet tested | Chat/report/block and Ask Me safety rules use authoritative endpoints, but the missing comment-thread and comment-access-notice UI keeps broad moderation parity incomplete. |
| Account deletion and cancellation | Equivalent | Not yet tested | Backend remains authoritative; PWA erases pending chat text and private media for that user on deletion request or logout. |

## Device and evidence ledger

Current candidate evidence: `npm run build`, UI runtime checks, and performance
budgets pass. The candidate code completed locally with **641 passed, 3
expected non-Android skips, 0 failed, and no retries** across Pixel 7 Chromium,
Desktop Chrome, Desktop Firefox, and Desktop WebKit. The matching
[hosted run 33997421524](https://github.com/jasonwonton/validapp-landing-page/actions/runs/33997421524)
also passed static release checks and all four isolated browser jobs. The
non-Chromium projects block service workers because
[Playwright supports service workers only in Chromium-based browsers](https://playwright.dev/docs/service-workers);
Chromium continues to cover install, offline-shell, cache-isolation, update, and
push-worker behavior. A branded Google Chrome smoke against the production-style
local origin also passed install affordance, demo sign-in, Chats/Memento
navigation and history, unlocked text send, exact chat URL, and cold
reload/sign-in restoration. Branded Safari on macOS passed the same
production-style local origin for demo sign-in, Chats list and DM navigation,
an unlocked text send, exact-chat cold reload/sign-in restoration, Memento
viewing, and prior-day Memento history. The
header-emitting production-origin adapter passes **3 static-origin contract
tests**. The unbound DigitalOcean staging service is active at
`https://validapp-web-staging-luibq.ondigitalocean.app`; its real edge/browser
suite passes **14 tests with 2 intentional non-Chromium service-worker skips**.
That run verifies the emitted CSP and device policies, MIME and cache behavior,
write/API/traversal rejection, signed-out boot, install metadata, service-worker
registration, and the absence of API/CDN responses from Cache Storage. The
same staging service completed a bounded 200-request, concurrency-10 load smoke
with 0 failures (13.62 requests/second, 687 ms median and 1.151 s p95 response
time from the available East Coast test host). Five cold Chromium contexts
measured median 154 ms TTFB, 400 ms first-contentful paint, and 729 ms load.
A real App Platform rollback to the preceding successful deployment preserved
the hardened edge response, and the subsequent revert restored the exact
reviewed head to `ACTIVE` with no pinned deployment; the full 14-check staging
suite passed again after restoration. These are dated baselines, not capacity
limits. The
scoped backend chat/Memento/Story/Web Push/config safety run is **273 passed, 0
failed**; the latest current-tree lifecycle/notification/call/config rerun is **280
passed, 0 failed**. These are lab results, not production or physical-device
approval.

| Target | State | Required before release |
| --- | --- | --- |
| Pixel 7 Chromium emulation | Automated | Passing Chats/Mementos, Stories, voice-recording fallback, contract, outbox, dark-mode, adapter, runtime, and performance suites. Emulation is not a physical-device substitute. |
| Desktop Chrome | Automated + branded smoke | Full hosted suite passes with Chromium service-worker coverage. Branded Chrome on macOS passes the production-style local-origin smoke; final-origin notification and passkey behavior remain open. |
| Desktop Firefox | Automated | Full application suite passing with service workers blocked at the Playwright boundary; real Firefox notification/install behavior remains a hands-on gate. |
| Desktop WebKit engine | Automated | Full application suite passing with service workers blocked. This is neither branded Safari nor an installed iPhone PWA, so Safari service-worker, push, media, and install behavior remain open. |
| Desktop Safari | Branded local smoke | Production-style local-origin demo sign-in, Chats list, direct conversation, text send, exact-chat reload/sign-in restore, Memento viewer, and prior-day history pass in branded Safari on macOS. Final-origin service worker, push, passkey, media permissions, and install behavior remain open. |
| Unbound DigitalOcean staging origin | Automated edge + rollback smoke | The deployed header-emitting service passes 14/14 applicable checks across Pixel-class Chromium, desktop Chromium, Firefox, and WebKit; Firefox/WebKit service-worker checks are intentionally skipped. A bounded load smoke had 0 failures, cold-browser startup medians are recorded above, and rollback/revert restored the reviewed head cleanly. Authenticated and passkey journeys require the private final origin. |
| Desktop Edge | Not yet tested | Edge is not installed on the available macOS test host; final-origin smoke, notifications, keyboard/accessibility, and degraded alternatives remain. |
| Physical Pixel | Not yet tested | Install, camera, push, offline/reopen, keyboard, long scroll, update, two-account realtime. |
| Physical Samsung | Not yet tested | Repeat with Samsung Internet and Chrome plus Samsung Keyboard and aggressive backgrounding. |
| iPhone installed PWA | Not yet tested | Safari install, camera, keyboard/safe areas, push, exact links, passkey, update. |
| Final `https://validapp.lol/app/` origin | Blocked | Current deployment fails the response-CSP framing gate; candidate headers, push subscription, and exact links still require private final-origin testing. |
| Current App Store iOS binary | Not yet tested | Full smoke against the candidate backend before any production web flag changes. |

## Release decision

**Current decision: NO-GO for public exposure.** The core Chats/Mementos, photo communication, compatible voice recording, Story, and open-app call implementation is a credible staging candidate, but physical-device, final-origin, SSE failure, notification destination, codec-dependent video, live camera filters, richer Story editing/contact sharing, and real two-account LiveKit gates are still open.

The read-only production preflight currently passes the manifest/service worker,
related-origin passkey, and API/CORS checks, but fails the app-shell security
header gate because the public `/app/` response does not include a CSP with
`frame-ancestors 'none'`. The live DigitalOcean static component exposes
`_headers` as a file instead of applying it. The candidate `npm start` origin
now emits those policies in the real DigitalOcean edge and passes both the
three local static-origin contracts and the 14-check deployed-origin suite, but
the production component has not been switched; keep the public gate closed.

Safe rollout order:

1. Deploy the additive backend/config changes with `ENABLE_WEB_CHATS=0`, `ENABLE_WEB_MEMENTOS=0`, `ENABLE_WEB_STORIES=0`, and `ENABLE_WEB_CALLS=0`; leave APNS and SMS workers unchanged.
2. Smoke-test the current App Store binary and observe API, APNS, SMS, PostgreSQL, Redis, and Web Push outbox baselines.
3. Deploy the static PWA privately at the final origin and run the automated, physical-device, two-account, offline, push, and update matrices.
4. Enable `ENABLE_WEB_CHATS=1` for the private cohort. Keep Mementos dark until capture/upload/reciprocity checks pass.
5. Enable `ENABLE_WEB_MEMENTOS=1`, `ENABLE_WEB_STORIES=1`, and `ENABLE_WEB_CALLS=1` independently after their capture/media/LiveKit gates pass, then expand cohort only while error, duplicate, reconnect, queue, storage, and latency thresholds remain healthy.
6. Roll back presentation immediately by setting the relevant web flag to `0`. Leave additive migrations applied and let durable outboxes drain; do not disable APNS or SMS processing.

See [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md) for commands and rollback order and [WEBAPP_TESTING.md](WEBAPP_TESTING.md) for the physical-device script.
