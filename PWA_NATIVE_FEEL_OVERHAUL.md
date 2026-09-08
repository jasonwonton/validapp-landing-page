# Valid PWA native-feel performance audit and overhaul plan

Date: August 27, 2026

## Executive decision

Keep the PWA and overhaul its rendering architecture before considering an Android-native rewrite.

The current choppiness is primarily caused by how the application is built, not by an unavoidable PWA ceiling. The app eagerly mounts a large document, replaces whole UI regions during small interactions, loads noncritical artwork and a very large font during startup, and keeps several expensive blurred/fixed layers alive. Android native would hide none of these product-architecture problems; it would replace them with a second client to build and maintain.

The recommended target is a progressively migrated PWA using:

- Vite + TypeScript for bundling, route splitting, and enforceable module boundaries.
- Preact + Signals for small runtime cost, keyed DOM updates, and fine-grained state subscriptions.
- One mounted route at a time, with dialogs and detail screens created on demand.
- A virtualized/keyed feed and direct patches for reactions and counters.
- Semantic motion and haptic adapters rather than blanket effects on every click.
- Field performance telemetry and device-tier lab gates.

This is not a big-bang rewrite. Migrate one user journey at a time behind flags while the existing app remains shippable.

## Implementation status

Three production-safe tranches were implemented on August 27, 2026 and are awaiting deployment. They include the font/artwork pipeline, image hints, service-worker data isolation, sampled RUM, gesture write coalescing, semantic haptics, Profile request freshness, direct reaction-control patches, on-demand dialog mounting, keyed feed-row reconciliation, browser-level offscreen rendering containment for long feeds, and the first real route/realtime module boundaries.

The same controlled local Android profile used during the audit measured:

| Measurement | Audit baseline | Current implementation |
|---|---:|---:|
| DOMContentLoaded | 5.65 s | 1.93 s |
| Load event | 8.87 s | 1.93 s |
| Resource body/transfer work | 4.46 MB | 0.77 MB |
| App font | 2.10 MB TTF | 17.5 KB WOFF2 |
| Reaction layout passes | 16 | 3 |
| Reaction feed-card identity | Replaced | Preserved |
| Signed-out shell DOM | 891 elements | 405 elements |
| Signed-in feed DOM | 1,005 elements | 519 elements |
| Inactive dialogs with mounted content | 26 | 1 |

These are controlled local measurements, not field results. Dialogs retain their bound controls in detached fragments and mount immediately before first use, so form state and event handlers remain stable without paying the initial parse/style cost. Feed filtering and refreshes now move or retain keyed rows when their rendered content is unchanged.

The third tranche adds native ES-module chunks for Feed, Play, Profile, and Chats. The active chunk is evaluated on first activation while all route chunks remain in the offline shell, so installed navigation remains reliable without parsing every route at startup. The first extraction moved 14.5 KB of Feed row construction, sorting, filtering, inbox controls, and keyed rendering out of `app.js` into `routes/feed.js` (about 4.0 KB compressed). Play and Profile currently own activation lifecycle and are the next code-extraction targets. `realtime-list.js` supplies a DOM-free, reusable collection for Feed, while the chat store applies the same stable-key and batched-update rules to messages. `keyed-list.js` is the matching DOM reconciler.

The fourth tranche implements the existing iOS Chats and Memento contracts in the PWA: independently feature-gated chat navigation, direct and named group chats, invitations, replies, reactions, optimistic/idempotent sends, typing/read state, notification settings, owner member controls, account-wide block, exact message deep links, named-event SSE resync, daily Memento history, skip-for-today, browser photo preparation, upload progress, publishing, and the same reciprocity gate used by iOS. Locked message bodies are not inserted into the DOM. Browser Memento uploads use the existing private media lifecycle; native clients retain their direct presigned upload flow. Text sends persist in a bounded user-scoped outbox and recover after refresh/reopen with the original request ID.

The fifth tranche adds bounded server search, multi-chat Memento publishing, gallery reply/reaction, group photos, persistent photos, codec-validated MP4, M4A attachment capture, saved stickers, text overlays, authoritative view-once sessions/replays/receipts, and private upload recovery. Media recovery stores at most three payloads per user and ten globally for 24 hours, retries at most four times with bounded backoff, and reuses the original upload and message request IDs. Mementos additionally expire at their local day boundary. Recovery resumes only while Chats is open because browsers cannot guarantee closed-tab execution. Cache Storage is now an explicit static-shell allowlist with no runtime writes; private blobs live only in origin-scoped IndexedDB and are erased with text recovery state on logout or an account-deletion request.

The sixth tranche adds safe Memento reshare, progressively enhanced voice recording, and a feature-gated Story surface. Browsers that emit backend-compatible MP4 audio can record locally for up to five minutes; other browsers keep the M4A file/capture path instead of uploading an incompatible WebM payload. The Story rail/viewer uses the released feed, view, viewers, delete, and report contracts, waits for signed media to reveal before recording a view, caps its client view ledger, and never prefetches or writes private Story media to Cache Storage. Photo and compatible-MP4 creation use the same private upload/finalize/publish lifecycle with stable request IDs and bounded IndexedDB recovery. Story replies and up-to-10 classmate shares create authoritative chats and render as live Story cards while preserving the Memento reciprocity gate. Native Story-capture alerts additionally route through the independent durable Web Push outbox to the exact Story without changing APNS delivery.

The room-polish pass adds the iOS seven-day Memento rail, capture progress and waiting states, grouped message sequences, a dedicated message scroller that does not collide with bottom navigation, and a compact tap/long-press action palette. Double-tap love, copy, reply, hide-for-me, reactions, and unsend now share one discoverable interaction model instead of permanently exposing controls under every bubble.

Remaining iOS parity is deliberately split into larger follow-up slices:

1. Story finish work: gesture-based overlay positioning, multi-clip capture, registered-contact sharing for the owner, codec/device validation, and retry UX without claiming screenshot or screen-recording detection.
2. Conversation finish work: richer overlays and appearance controls, sticker creation alternative, waveforms, codec coverage, and a reliable WebRTC call experience where the browser can support it.
3. Release evidence: final-origin headers and push, physical Pixel/Samsung/iPhone PWA checks, non-Chromium desktop coverage, two-device realtime interruption, large-account soak, and canary observability.

## What was audited

- Static source and application architecture in `app/index.html`, `app/app.js`, `app/styles.css`, `app/api.js`, and `app/service-worker.js`.
- Existing Playwright performance coverage.
- The local demo in a 412 by 915 Android viewport.
- Controlled Chromium traces for feed reactions and tab navigation.
- Production response headers and a production signed-out load under 4x CPU slowdown, 100 ms latency, and roughly 4 Mbps download throughput.

The controlled results are diagnostic measurements, not real-user percentiles. Production field instrumentation is the first implementation phase.

## Findings

### 1. Small state changes rebuild large UI regions

This is the largest interaction problem.

- `renderFeed()` rebuilds the entire feed with `list.innerHTML` after sorting and mapping every visible row.
- `applyReactionState()` always calls `renderFeed()`.
- One reaction calls `applyReactionState()` optimistically and again after the server response. A normal successful reaction therefore rebuilds the feed twice.
- `renderPlay()` replaces the entire play card whenever the question, choice set, or local state changes.
- The profile panel renders before its requests and again after up to seven requests settle.

In a controlled local reaction trace, selecting one reaction removed and re-added 26 direct feed children and caused 16 layout passes and 22 style recalculations. The exact cost will vary by device and feed size, but the structural problem is deterministic.

The application currently contains 69 `innerHTML =` sites and 44 render functions in one 6,383-line module. The issue is not merely that functions are called often; most render functions do not preserve element identity.

### 2. The initial DOM contains most of the product

After local demo sign-in at a Pixel-sized viewport, the document contained:

| Measurement | Observed |
|---|---:|
| DOM elements | 1,005 |
| Dialogs mounted | 26 |
| Fixed-position elements visible or retained | 20 |
| Sticky elements visible or retained | 9 |
| Elements using live backdrop blur | 9 |
| Images | 32 |
| Images using `loading="lazy"` | 0 |
| Images using `decoding="async"` | 0 |
| Images with explicit intrinsic dimensions | 0 |

All three main panels and all 26 dialogs are present from the first HTML parse. Hiding them avoids some painting, but it does not eliminate parse cost, selector matching, DOM memory, event setup, or resource discovery. Moving between tabs also retains the old route tree and mounts more profile content, growing the document to about 1,231 elements in the controlled run.

### 3. Startup ships noncritical work too early

The critical source files are currently:

| File | Uncompressed size |
|---|---:|
| `app/app.js` | 320,903 bytes |
| `app/styles.css` | 133,550 bytes |
| `app/index.html` | 67,171 bytes |
| `assets/Jua-Regular.ttf` | 2,101,500 bytes decoded |

Production compresses HTML, CSS, JavaScript, and the font. That reduces transfer cost, but the browser still has to decode the font and parse, compile, and execute the complete application module.

On a production signed-out load under the controlled midrange-Android profile:

- First contentful paint: about 0.84 seconds.
- DOM interactive: about 0.84 seconds.
- DOMContentLoaded: about 2.79 seconds.
- Load event: about 5.0 seconds.
- Resource transfer: about 2.28 MB.
- Decoded resource body size: about 4.23 MB.
- Initial DOM: 890 elements and 26 dialogs before authentication.
- The Jua font transferred about 551 KB with Chrome's negotiated encoding and decoded to 2.1 MB.
- Decorative PNGs such as the pencil, crown, rocket, and aura artwork accounted for another roughly 1.1 MB.

The signed-in startup path also waits for eight requests as one barrier before it initializes navigation and starts the feed request. Cached profile/feed data is restored earlier, which is good, but the fresh path is still coupled to the slowest noncritical request, including Ask safety, config, and passkey status.

### 4. The paint and compositing workload is heavier than the visual design requires

The stylesheet includes:

- 14 declarations using `position: fixed` and four using `position: sticky`.
- Six `backdrop-filter` declarations, several of which affect full headers or modal backdrops.
- Fifteen keyframe animations.
- Animated detail screens, modal backdrops, pull-to-refresh, and draggable Android sheets.

Blurred translucent layers are expensive on midrange GPUs, especially while content scrolls underneath. Fixed and sticky layers also increase compositing and damage regions. The top bar, detail headers, modal backdrops, and submission dock do not all need live blur on Android.

The visual viewport handler writes nine document-level CSS properties on viewport resize/scroll and focus changes. Sheet dragging and pull-to-refresh write style properties on every pointer or touch move. These paths need one animation-frame scheduler, coalesced reads and writes, and compositor-only properties.

### 5. Image behavior is not controlled

The current markup does not consistently provide intrinsic dimensions, lazy loading, async decoding, fetch priority, or responsive variants. This leads to unnecessary decoding, potential layout movement, and full-size image downloads for small UI placements.

The first production page discovers artwork for hidden product areas. PNGs that appear at icon or card-art sizes are hundreds of kilobytes each. They should be resized to their maximum rendered dimensions, converted to WebP/AVIF where appropriate, and imported only by the route or dialog that uses them.

### 6. The service worker is working against warm responsiveness

The service worker currently:

- Pre-caches the full app shell plus the 2.1 MB font and several large PNGs during installation.
- Uses network-first for every same-origin GET and only falls back to cache after the network fails.
- Uses one cache for navigation, static assets, and same-origin API GET requests.

Consequences:

- A warm launch still waits for the network before using a cached shell.
- Installation and updates download noncritical assets.
- Authenticated API JSON can be written to the shared Cache Storage cache. That is a correctness and privacy risk across logout/account changes and should be removed even though cached responses are only used after a network failure.
- Static assets have only a 10-second browser `max-age` in production, and their filenames are not content-hashed.

The existing user-scoped application cache is a better place for deliberately selected offline data. Private API responses should not be cached indiscriminately by the service worker.

### 7. Haptics exist, but the interaction model dilutes them

The PWA already calls `navigator.vibrate()` on Android. It has a short `softHaptic()` and a success pattern, but a document-level capture listener vibrates for almost every enabled button, link, or button role. A reaction also triggers its own haptic, so some paths can double-fire.

The Vibration API can provide useful Android PWA feedback, but support is not universal and the browser/OS controls the actual motor behavior. It cannot match Android's precise `HapticFeedbackConstants` or iOS's native feedback generators.

Use vibration as progressive enhancement:

- `selection`: 5-7 ms for changing a picker selection.
- `impact`: 8-12 ms for committing a vote/reaction.
- `success`: a short two-pulse pattern for completed refresh/send.
- `warning`: a distinct but restrained pattern for destructive confirmation.
- `none`: navigation, links, close buttons, scrolling, and disabled controls.

Honor an in-app haptics preference, reduced motion, battery/device settings, and feature detection. Never delay visual feedback while waiting for vibration.

### 8. Existing performance tests provide false confidence

The current Playwright performance test checks load timings, CLS, and the count of long tasks after switching to Play and Profile. It does not:

- Apply CPU or network throttling.
- Measure INP or event duration.
- Exercise reactions, feed growth, sheet dragging, keyboard opening, image decode, or pull-to-refresh.
- Assert DOM churn, layout count, style recalculation, or route-specific bundle size.
- Test installed display mode, warm service-worker launch, offline data isolation, or update behavior.

It is a useful smoke test but not an interaction performance budget.

## Target architecture

### Application shell

Keep the auth/session API, passkeys, push registration, API client, demo adapter, and backend contracts. Replace the monolithic document with a small shell containing only:

- Top bar and network/update surfaces.
- Active route outlet.
- Bottom navigation.
- Toast/live-region host.
- Modal and detail-screen portals.

Feed, Play, Profile, onboarding, and secondary product areas become dynamic imports. Only the active route is mounted. A bounded route cache may retain lightweight state and scroll position, not whole hidden trees.

### Rendering and state

Use Preact + Signals for the migrated surfaces, with these rules:

- Server entities live in normalized keyed stores.
- UI-local state stays inside the owning component.
- Components subscribe to the smallest signal they need.
- Lists always use stable server IDs as keys.
- A reaction updates only its reaction button, count, and picker state.
- Network reconciliation patches the same entity; it does not rebuild the list.
- Derived sorting/filtering is memoized and recomputed only when its inputs change.
- Long feeds render a moving window with a small overscan and preserve scroll anchors.
- Abort stale route/search requests on navigation or query changes.

Preact is not the performance fix by itself. The component and subscription boundaries are the fix; Preact + Signals make those boundaries maintainable as chat, mementos, and richer activity are added.

### Data lifecycle

- Mount immediately from user-scoped cached snapshots.
- Split startup requests into `critical`, `visible-soon`, and `idle` groups.
- Critical: session, minimal profile identity, feed gate, first feed page.
- Visible-soon: notification state and active route metadata.
- Idle/on-demand: Ask safety history, passkey management state, classmates directory, billing details, and dialog-specific data.
- Apply stale-while-revalidate at the application data layer with timestamps and explicit user ownership.
- Keep optimistic mutations per entity with an operation ID, rollback snapshot, and conflict reconciliation.

### Assets and CSS

- Subset Jua to used glyphs and ship WOFF2. Target less than 150 KB transferred; use a metric-compatible fallback and `font-display: swap` or `optional` after visual review.
- Produce appropriately sized WebP/AVIF variants. Keep PNG only where transparency or artwork quality requires it.
- Add explicit width/height or `aspect-ratio`, async decoding, and lazy loading for noncritical images.
- Import route artwork from route modules rather than initial HTML.
- Remove live backdrop blur from scrolling Android surfaces; replace it with an opaque or precomposed color.
- Animate only `transform` and `opacity` in gesture paths.
- Use `content-visibility: auto` as a supplementary defense for long nonvirtualized regions, not as a substitute for route/list lifecycle.
- Centralize durations, easing, elevation, touch targets, safe-area behavior, and reduced-motion behavior as design tokens.

### Service worker and delivery

- Navigation/app shell: cache-first or stale-while-revalidate with an explicit offline fallback and update signal.
- Hashed static assets: cache-first, immutable, one-year CDN/browser caching.
- Profile avatars and public media: bounded stale-while-revalidate cache with size/age eviction.
- `/api/` and authenticated JSON: network only in the service worker. Persist only explicitly selected, user-scoped snapshots in the app data layer.
- Pre-cache only the minimal shell. Warm likely next-route chunks after the first useful render and only on capable connections.
- Version caches by build and delete only caches owned by this app.

### Native-feel interaction contract

Every core interaction should follow the same order:

1. On pointer down, show pressed state immediately with CSS.
2. On activation, update the smallest possible local UI region optimistically.
3. Paint that feedback before starting optional work.
4. Run network work without replacing existing content with a spinner.
5. Reconcile the specific entity when the response arrives.
6. Use semantic haptic feedback only when it communicates a meaningful state change.
7. Preserve focus, scroll position, and element identity throughout.

## Delivery plan

Estimates assume one engineer focused on the PWA. Two engineers can overlap asset/platform work and route migration, but should not edit the same route simultaneously.

### Phase 0 — Establish field truth and guardrails (2-3 days)

- Add sampled, privacy-safe RUM for INP, LCP, CLS, long animation frames, long tasks, route, display mode, app version, device-memory bucket, and effective connection type.
- Record interaction names for nav, reaction, feed filter, Play answer, modal open, send, and pull-to-refresh without recording message/content text or user IDs.
- Add a repeatable Pixel 7 and midrange Samsung lab profile with 4x CPU and Fast 4G.
- Add bundle, initial DOM, route DOM, and image-byte budgets to CI.
- Capture a baseline from at least several days of production traffic before declaring the overhaul successful.

Exit gate: dashboards show p50/p75/p95 responsiveness by route and interaction, and CI can reproduce the known reaction churn.

### Phase 1 — Immediate weight and paint wins (4-6 days)

- Subset/convert the font and add a tuned fallback.
- Convert and resize large artwork; remove hidden-route images from initial HTML.
- Add intrinsic image dimensions, lazy loading, async decoding, and responsive sources.
- Remove Android live blur from scrolling headers/backdrops.
- Coalesce viewport, pull-to-refresh, and sheet gesture writes into one `requestAnimationFrame` per frame.
- Separate service-worker strategies and stop caching API JSON.
- Add content hashes and immutable asset caching in the build/deploy pipeline.

Exit gate: production signed-out critical transfer is under 500 KB on Chrome, the minimal install pre-cache is under 750 KB, no private API response enters Cache Storage, and animations remain within the 10 ms main-thread frame budget in the lab profile.

### Phase 2 — Introduce the new shell without changing behavior (5-8 days)

- Add Vite, TypeScript, Preact, and Signals.
- Create platform adapters for API, persistence, navigation, sharing, notifications, install, haptics, and viewport behavior.
- Mount a new shell around the current routes and establish dynamic route imports.
- Add modal/detail portals and create dialogs only when opened.
- Preserve existing URL/history behavior, accessibility labels, demo flows, and API contracts.
- Add a route flag so the old shell remains an instant rollback.

Exit gate: only the active route exists in the main DOM, unopened dialogs have no DOM or network cost, back navigation and scroll restoration are stable, and existing end-to-end flows pass against both shells.

### Phase 3 — Migrate Feed first (5-8 days)

- Normalize feed entities and create keyed row components.
- Move filtering/sorting into memoized selectors.
- Patch reactions and read/unread state per row.
- Virtualize after a small first page and preserve scroll anchors while prepending/refreshing.
- Replace full skeleton swaps with cached content plus subtle refresh state.
- Add route abort controllers and generation-safe reconciliation.

Exit gate: reacting changes no feed-card identity, mutates fewer than 10 DOM nodes, causes no full-list layout, and shows visual feedback within 100 ms on the midrange profile. A 500-item fixture keeps active DOM under 900 elements.

### Phase 4 — Migrate Play, Profile, onboarding, and dialogs (8-12 days)

- Play: preserve the card shell; patch question text, artwork, and keyed choices. Predecode only the next question's artwork.
- Profile: split the hub from editors and directories; fetch sections on demand with freshness windows.
- Onboarding: mount only the current step, keep input state in a durable draft, and simplify visual-viewport handling.
- Sheets/dialogs: use one gesture controller, consistent snap/dismiss rules, focus trapping, and on-demand content.
- Keep expensive directories and safety histories out of the DOM until requested.

Exit gate: route changes acknowledge within 100 ms, keyboard open/close has no visible jump, sheet dragging drops fewer than 5% of 60 Hz frames in the lab profile, and no route switch triggers avoidable network calls while data is fresh.

### Phase 5 — Polish the tactile system and release (4-6 days)

- Implement semantic haptics and remove the global every-click vibration handler.
- Tune pressed states, gesture thresholds, easing, transitions, overscroll, scroll locking, and touch targets as one system.
- Test browser mode and installed mode on current Pixel and Samsung hardware.
- Test reduced motion, battery saver, offline launch, update recovery, account switching, and low storage.
- Roll out route by route: team/internal, 5%, 25%, 50%, 100%, with old-route kill switches.

Exit gate: field p75 targets hold for seven days with no regression in auth, push, sharing, accessibility, error rate, or conversion.

## Performance acceptance targets

These are product targets, intentionally tighter than the broad Core Web Vitals “good” boundary where practical.

| Metric | Target |
|---|---:|
| Mobile field INP, p75 | <= 150 ms; never regress above 200 ms |
| Mobile field LCP, p75 | <= 2.0 s |
| Mobile field CLS, p75 | <= 0.05 |
| Visual response to tap in lab | <= 100 ms |
| Main-thread work per animation frame | <= 10 ms typical |
| Long tasks during core interactions | 0 over 50 ms |
| Initial active DOM after sign-in | <= 600 elements |
| Feed DOM with 500-item fixture | <= 900 elements via windowing |
| Successful reaction DOM mutation | < 10 nodes; no card replacement |
| Critical signed-out transfer on Chrome | < 500 KB |
| Minimal service-worker pre-cache | < 750 KB |
| Route chunks after compression | < 75 KB JS each unless justified |
| Dropped frames during sheet/pull gestures | < 5% at 60 Hz |

Measure field targets at p75 segmented by mobile/desktop and, for Android, browser versus installed display mode. Google defines 200 ms or less as “good” INP; the 150 ms product target leaves headroom for lower-tier devices and future features.

## Recommended build order relative to chat and mementos

Do not add group chat to the current rendering model. Chat magnifies every existing weakness: live lists, optimistic sends, typing state, unread counters, media decoding, keyboard/viewport movement, and background updates.

Recommended order:

1. Complete phases 0-3.
2. Build the conversation list and one-to-one/group thread UI on the new shell and entity store.
3. Add media/mementos using the new image pipeline and bounded local persistence.
4. Migrate the remaining legacy profile/onboarding surfaces in parallel only after the shell and feed patterns are stable.

The new feed row, virtual list, optimistic mutation, viewport, media, haptics, and notification primitives become the foundation for chat rather than chat creating a second set of UI infrastructure.

## When Android native becomes the right call

Revisit a native Android client only if Valid needs capabilities the PWA cannot reliably provide, such as:

- Precise platform haptic constants and hardware-specific feedback.
- Always-on or highly reliable background execution beyond web push/service-worker limits.
- Deep OS integrations that are unavailable or inconsistent on the web.
- Proven field evidence that Chromium rendering remains the dominant bottleneck after this plan is complete.

If that point arrives, keep the PWA overhaul: the normalized API/state boundaries, performance telemetry, image pipeline, and interaction contracts transfer directly to a native client. Today, an Android rewrite would delay the features and duplicate client work before testing whether the actual bottlenecks were removed.

## Source references

- Google: [Optimize Interaction to Next Paint](https://web.dev/articles/optimize-inp)
- Google: [Avoid large, complex layouts and layout thrashing](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing)
- Google: [Rendering performance](https://web.dev/articles/rendering-performance)
- MDN: [Vibration API](https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API)
