# Active now in the PWA

Implemented on `codex/pwa-ios-design`, extending the local iOS design candidate. No production deployment, feature flags, database schema or backend code changed.

## User experience

- Green activity dots appear on accepted conversations in the inbox and Recent rail.
- Recent direct chats show Active now, Active recently, or the native minute/hour/day label; groups show their active peer count.
- Direct-chat headers show activity; group headers include the count. Typing temporarily takes priority. Eligible member labels in Chat settings show activity without replacing the settings form on every refresh.
- Profile → Activity status controls the existing account-wide sharing preference. Save failures reconcile with the server rather than presenting an unconfirmed setting as saved.
- Presence means foreground activity anywhere in the app, not evidence of reading a particular conversation. Recent ordering remains based on conversation activity.

## Contract and lifecycle

`app/chat/presence.js` uses the existing iOS backend: POST `/users/{id}/chat-presence`, GET/PUT `/users/{id}/activity-status`. The production adapter retains the existing authenticated cookie/bearer behavior and sends each pulse once with a 10-second request deadline. Server authorization determines eligible peers; no last-message or analytics timestamps are substituted.

The controller loads only after authenticated configuration enables Chats. There is one loop per foreground browser page. Visible chats are observed with IntersectionObserver; the open room takes priority and the audience is capped at 20 unique chats. Visible snapshots refresh every 23–27 seconds, with a coalesced earlier request when the audience changes; app-only heartbeats use 33–37 seconds. This matches native cadence, not instantaneous push presence. Messages retain their separate event stream.

Each foreground session has a random UUID and increasing sequence. Visibility loss, pagehide, offline transitions, logout and account deletion clear the local snapshot and attempt a higher-sequence inactive keepalive request. Returning starts a new session. Late responses cannot restore a stopped session or cross account boundaries. The existing server lease expires after 60 seconds if the final inactive request cannot arrive.

Snapshot age uses monotonic elapsed time anchored to server time; after 35 seconds it is unknown and hidden. Failures immediately clear activity without claiming a peer is offline. Requests back off after errors and honor rate-limit Retry-After. Privacy and membership mutations invalidate pending samples. Presence remains memory-only, and the service worker does not cache authenticated API responses.

## Verification

- 264 browser regression checks passed across Android Chromium, desktop Chromium, Firefox and WebKit. After the final accessibility and membership-invalidation adjustments, all 32 targeted checks passed again.
- Production build, UI runtime checks, all five static-origin/versioned-asset checks and performance budgets pass. Offline shell: 54 entries, estimated transfer 714,433 bytes. The existing signed-out DOM budget and lazy chat loading are preserved.

- Eight deterministic controller/lifecycle tests cover label boundaries, bounded audiences, cadence, stale responses, hanging requests, session/account changes, privacy invalidation, rate limits, foreground/offline lifecycle and malformed/unsolicited data.
- Browser tests use the real ValidAPI adapter against controlled HTTP fixtures. They cover inbox/Recent/header/member rendering, historical labels, unavailable service, privacy save reconciliation and fenced background/resume requests.
- A two-client browser test publishes independent heartbeats and verifies that one client changes from Active now to Active recently after the other leaves and the next heartbeat runs. This verifies client integration against a controlled lease contract, not production server latency.
- Built-output captures cover inbox, direct room and privacy settings in light/dark at 320/390/430px. See `output/active-now/preview.html` and `output/active-now/layout.json`.

Automated evidence is local. Real-account cross-device latency and the production feature flag are not validated by fixtures, and no claim of production rollout or physical-device acceptance is made.
