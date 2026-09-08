# Calls, voice and stickers — private web-v85

## Scope

User explicitly requested implementation and the ability to initiate PWA calls. This is a private staging preview, not approval for public rollout. No iOS, backend/API, schema, APNS or SMS code changes. Ordinary user-initiated calls still use the existing server authorization, membership/blocking, call notification and camera-slot rules.

Native references: `ChatRoomView.swift:874–891` (one audio-call button), `ActiveCallView.swift:818–856` (circular mute/route/camera/end dock), `ChatRoomView.swift:3940–4075` (voice hold/cancel/lock/preview) and `StickerFeature.swift:436–617` (picker grid/New tile).

## Implementation

- Private gateway exposes `enable_web_calls` only when backend `enable_calls` is true. `STAGING_ENABLE_CALLS=false` is an independent rollback switch. No public config changes; Stories/comments remain gated.
- One phone button initiates voice from an accepted chat. Video can be enabled inside the call through the unchanged server camera reservation protocol. Circular native-style controls replace generic text buttons. Audio-output selection appears only when the browser exposes both selection and media output APIs; otherwise use device audio controls.
- Generation guards prevent late permission, start, join, connection, camera, lifecycle or realtime results from reviving an ended call. Permission-stage cancellation stops acquired tracks without creating a call. Late-created calls are ended. Ambiguous user-requested retries preserve call-start identity; the map is capped at 32 and expired-deadline refreshes have a five-second floor.
- Voice: hold for recording, release for an **unsent preview**, left to cancel, up to lock. Tap/keyboard activation remains available. A 48-sample bounded waveform reflects local microphone amplitude; a custom player provides playback/seek. Recording is requested at 64 kbps and capped at five minutes, 4 MB and 600 chunks. Meter/AudioContext/stream resources are cleaned up. Voice recording is blocked during an active call, and starting a call discards an active local recording.
- Stickers: remove extra glyph thickening, use the native-style three-column picker/New tile and context-correct photo title. Pointer rotation and keyboard brackets rotate the same geometry baked into the JPEG. Existing library create/delete/message contracts and eight-placement limits stay unchanged.

## Validation

- Existing call/composer baseline: eight Android-emulation checks passed before expansion.
- Broad regression: 332 passed, four capability skips across Chromium mobile/desktop, Firefox and WebKit. Includes calls, chat contracts, Mementos, scrolling, retry/outbox, update/rollback, camera and stickers.
- Focused final interactions: 84 passed across the four projects, including actual chat-header call initiation through a mocked provider, compatible audio-output selection, hold/release/cancel/lock, sticker baking/rotation pixels and library creation/deletion.
- Exact final call/voice lifecycle rerun: 48 passed across all four projects.
- Private gateway: ten passed, including both call kill switches, signed access, origin restrictions and no write retry. Static origin: three passed. UI runtime and performance budgets pass; one small voice interaction module added to the public app-shell cache, no private media caching.
- Mobile call, voice preview, locked recording and call-enabled header renders inspected. These are automated browser images, not physical-device validation.

## Required smoke test / remaining parity

Parity remains **Partial**, release **Not yet tested**, not Production-ready. Open an existing chat on staging, tap the phone, grant microphone access and call a cooperating iOS user. Verify two-way audio, answer/decline, mute, camera escalation, hangup, reconnect and Bluetooth routing. Then try voice hold/left/up and sticker pinch/rotation on physical Pixel, Samsung and installed iPhone PWA. Do not assume closed-tab/lock-screen ringing or background call survival. Native automatic audio routing, participant pinning/layout controls, waveform scrubbing fidelity and interruption behavior are not claimed equivalent.

No automated real-account call, message, sticker creation or media upload is used for release checks. Provider media connectivity between two physical accounts remains a user smoke-test gate.

## Rollback

Disable private calls with `STAGING_ENABLE_CALLS=false`, or redeploy private web-v84 source `41be924be99af09cb731d489ee1855d91e2829d8`, deployment `2c27f6fa-9e4c-43b8-9a91-c99910e029cb`. This affects only private staging. Existing queued media and backend call records require no migration or deletion. Public/main remain unchanged.
