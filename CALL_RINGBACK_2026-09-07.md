# Private web-v87: outgoing call feedback

The caller previously had no audible waiting feedback. This release ports iOS `CallRingbackSoundPlayer` from `CallCoordinator.swift`: 48 kHz mono, the same 16-bit-quantized E–G–B waveform (659.25 / 783.99 / 987.77 Hz), note offsets/durations/envelopes, 0.48 playback gain and 3.6-second loop including silence. No downloaded audio dependency or backend changes.

The tone is local-only, never connected to the published microphone stream. Its AudioContext is prepared from the initiating gesture. It starts once the outgoing call and local media are ready, stops at server acceptance or remote presence, and cannot restart after an answer. Reconnecting pauses waiting feedback; hangup, terminal server state, pagehide, session expiry and cancellation dispose the source/context. One bounded buffer and loop, no cadence timers. Browser autoplay rejection exposes the existing tap-to-enable-sound action.

Status text distinguishes Connecting, Waiting for an answer, Connecting audio, Connected and Reconnecting. Server outcomes (declined, missed, failed, ended) stay visible with a Close button instead of disappearing. A successful start request alone is not presented as a connected conversation. Native APIs, call permissions, notification delivery, server deadlines and idempotent retries are unchanged.

Incoming ringtone and closed-app ringing are not implemented in this change. Physical iPhone/Android speakers, Bluetooth, silent mode and live production account calls still require smoke testing. This does not certify full calling parity or production readiness.

Validation: exact waveform/PCM and resource-bound unit tests; browser policy tests for outgoing-only playback, autoplay recovery, no restart after answer, terminal cleanup, persistent outcomes and duplicate-safe retry. Call/voice/update regression plus real Chromium↔WebKit transport checks run before release. The latter use a local LiveKit server, real bundled SDK and generated microphones with fixture call-control responses—not production accounts.

Results: 78 browser checks passed with two service-worker capability skips across Chromium mobile/desktop, Firefox and WebKit; both PCM/resource unit tests passed. The mixed-browser real-media run passed ringback start/stop assertions and bidirectional non-silent audio, mute/unmute, refresh and hangup cleanup. Build, UI runtime and performance checks passed (49 shell entries, approximately 700 KB compressed-transfer estimate). Mobile waiting and outcome screens were visually inspected. Physical acceptance is still outstanding.

Rollback: redeploy private web-v85 source `8178da14bf47611427598fd4400acabdfa369e3c`, deployment `26a49429-236a-4a82-b7c5-029ae33a999c`, or disable private calls with `STAGING_ENABLE_CALLS=false`. No schema, media or queued-send migration is needed. Main/public and shared backend remain untouched.

The initial web-v86 build (`00383127d31510eeb365b04b107ba55300724fc8`, deployment `9c9b4228-db3c-423a-93f8-6392f60567bb`) became active before the final network-outage safeguard was included. web-v87 additionally stops the tone when the server-provided ringing deadline is reached even if the status request hangs; it does not invent a terminal backend state. A virtual-clock regression covers that boundary.

Final web-v87 call/update rerun: 70 passed, two capability skips, zero failures across all four browser targets. Both waveform/resource unit tests and performance budgets also passed on the final source.

Final private deployment: `719ac3ff-864b-49ac-bdaf-35d9d8debe84`, ACTIVE 6/6, source `7e0f298abd42df038c49f124cd6be44568f5dd71`. Live checks passed for web-v87, exact ringback/call module hashes, private signed access, related-origin passkeys, desktop/mobile startup, call SDK import/header, and synthetic chat/camera hierarchy. No real-account calls or uploads were made by these checks. Main and shared backend were not deployed.
