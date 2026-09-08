# Memento gate and capture polish

## Native reference

Compared with Swift `DailyMomentChatGateView` in `ChatRoomDetailsViews.swift`,
`Six7PeachPushButtonStyle`, and `DailyMomentCameraView`.

- Remove the stale dark-mode background on the inline camera glyph. Keep the
  native peach capsule, fixed black text/border and pressed shadow; the glyph
  itself is transparent rather than looking selected.
- A locked, eligible chat presents the native hierarchy: camera illustration,
  “Today's Memento,” one sentence, Take Memento and plain Skip for today.
  Unlocked chats do not show the lock card or Skip. Posted chats retain their
  compact header history/streak control.
- Skip is accessible directly on the gate, without camera permissions or an
  extra confirmation dialog. It uses the same authoritative skip endpoint.
  Duplicate submissions are guarded, failed skips stay locked, and an old-room
  response cannot navigate the viewer back into that room.
- Camera copy is simply “Tap to capture.” Remove the duplicate camera title,
  first/second-view labels, sequencing explanation and primary-view narration.
  Inset swapping stays accessible; permission errors and necessary recovery
  choices remain. One shutter still captures both images internally.

## Invariants and deliberate platform differences

No backend, iOS, API contract, flag, APNS or SMS changes. No upload/publish
algorithm change. The server still owns membership, access and skip state;
locked message bodies remain out of the DOM. Web waits for server confirmation
before unlocking, rather than displaying optimistic protected content. Web
sequential camera capture and optional single-photo recovery remain documented
platform alternatives, not extra instructions users must read in the camera.

## Validation / rollout

Baseline: 35 existing Android Chats/Memento/camera checks passed before changes.
New regression checks cover both themes at 320/393px, an unhighlighted camera
glyph, reachable 44px Skip, no camera required for Skip, failure/retry/double-tap
safety, room switching, and concise capture/review copy. Screenshot fixtures are
ignored under `artifacts/memento-gate/`.

Final runtime validation: **364 passed, 8 explicit platform skips**, zero
retries, 2.3 minutes across Android Chromium, desktop Chromium, Firefox and
WebKit. The scope includes Chats/Mementos, native chat camera, new gate behavior,
Stories interactions, API contracts, outboxes/recovery, realtime, windowing,
Effects, strict CSP and service-worker update preservation. An earlier focused
pass completed 236 cases with four skips before strengthening the cross-room
pending-skip check. These overlapping counts are not additive.

Build, UI-runtime, seven private-gateway and three static-origin tests passed.
Shell budget is 42 entries / 679,411 estimated transfer bytes (<750 KB).
No physical-device or real-account posting validation is claimed.

Final validation and exact deployment evidence are recorded in the
[release PR](https://github.com/jasonwonton/validapp-landing-page/pull/1).
Candidate `web-v79` remains private staging only. Rollback baseline is `web-v78`,
source `41ceab3dc0b209c6cd0fa2c33f639fd42277ebd6`, deployment
`546476b7-d576-4cbc-9ec1-ab91806d5cc3`. Preserve outboxes and update-version
progression when reversing. Main remains unmerged; physical-device acceptance,
Stories enablement and whole-product parity are not completed by this patch.
