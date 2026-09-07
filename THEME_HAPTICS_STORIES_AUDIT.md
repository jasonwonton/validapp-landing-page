# Appearance, Android feedback and Stories — September 7, 2026

## Findings and changes

The previous Dark Mode pass was insufficient. The PWA followed the OS without
an override, and hard-coded translucent white backgrounds combined with white
dark-mode text. Profile identity/stats, Feed segments/search/filter chips and
Play counters were affected. Secondary text also retained dark fixed colors.

- Profile → Appearance & feedback now offers System, Light and Dark. The
  preference is device-local, applied before stylesheet paint and survives
  refresh. System changes and other-tab preference changes update the resolved
  palette. Browser theme color and Chats/Stories/comments use the same state.
- Shared surface/secondary/danger colors are theme-aware; peach actions use
  black text. Profile school symbols, focus outlines and placeholders have
  dark-mode treatments. This is not exhaustive screen-reader/contrast signoff.
- Android tap and existing success feedback share a bounded vibration helper:
  at most three entries, each ≤40 ms, throttled to one request per 80 ms, no
  hidden-page feedback, no background loop. Device-local opt-out stops current
  vibration and persists. A Test vibration control reports only whether the
  request was accepted, never that physical vibration was verified.
- Missing or denied vibration does not interrupt actions. Preference-storage
  failures fall back to the current session. Only two bounded, non-account
  preference keys are added. No API, account or private-media storage changes.

Browser support and hardware/phone settings still govern vibration:
https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate
Physical Android feedback remains Not yet tested; native haptic fidelity is
not promised. This does not add iOS vibration support.

## Stories: implemented does not mean released

The private gateway still forces `enable_web_stories=false`, independently of
the native Stories flag. No production-account Story rollout is made here.

| Journey | Current evidence / remaining gap |
| --- | --- |
| Rail, photo viewing, view state | Existing implementation uses signed media and records the authoritative view after reveal; browser fixtures exercise it. |
| Viewers, report, delete | Existing owner/moderation contracts; real two-account and membership/access acceptance remains. |
| Photo publishing, effects, caption, overlay | Implemented with the existing upload/finalize/publish path, but acquisition remains picker-first. |
| Retry after reopening | Bounded private outbox and stable request identity tested with fixtures; physical interrupted upload remains. |
| Replies, shares, exact links | Implemented subset; real-account destinations, notification entry and iOS registered-contact sharing gaps remain. |
| Video / native-quality capture | Codec/device acceptance, live capture and multi-clip editing are not ready. |

Next release gate: add a tested Story camera/composer, validate real photo/video
and interrupted-upload journeys on physical phones, then two-account safety,
replies/share/deep-link/notification acceptance before opening the private flag.
Do not silently enable Stories merely because theme or adapter tests pass.

## Validation

The new preference suite passes all 16 cases across Pixel emulation, desktop
Chromium, Firefox and WebKit. It checks OS/manual preference transitions,
reload, theme chrome, sampled contrast ≥4.5:1, bounded Android vibration calls,
opt-out persistence, unavailable APIs and denied preference writes. Vibration
calls are mocked; no physical vibration is claimed.

The broad four-project regression suite passes **473 tests, with 11 explicit
platform skips**, zero retries. It includes Stories, comments, Chats/Mementos,
core navigation, preferences, polish, camera and pending-send-preserving update/
rollback. All 36 Story test cases pass with fixtures; no real Story was posted.
Build, runtime, gateway and static-origin checks pass. The shell budget is
673,518 estimated transfer bytes across 42 static entries (limit 750 KB).
Light/dark main screens and the new preference section were rendered and
inspected. The private deployment outcome is recorded after completion. App shell
version is `web-v70`; rollback target for this slice is the v69 camera candidate
`18cd9a85`. Preserve outboxes and use the explicit update flow on reversal.

## Private deployment verification

Deployed source `5c2054e4404cbff51b3eb9b51caf6a9c5377e605` is ACTIVE in
staging deployment `281da1c5-11e5-4649-968d-5e9d8c38f268`. Live checks verified
web-v70, byte-identical preferences code, a manual dark override persisting
across reload under the actual CSP, and Stories still disabled. Private access,
signed-out mobile/desktop rendering, exact CORS and synthetic related-origin
passkey checks also passed. No production-account sign-in or data write was
performed. The final expanded preference suite passed all 16 cases again.

Hosted CI run 34150690205 was still running at this snapshot; local results do
not imply full hosted-CI completion. Physical Android vibration and the broader
parity goal remain unsigned-off. This evidence-only follow-up does not require
another deployment.
