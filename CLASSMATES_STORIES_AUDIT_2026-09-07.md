# Classmates appearance and Add Story diagnosis

User report: `IMG_5872.PNG`, September 7, 2026. The attached image is a visual
reference only and is not bundled into the app.

## Classmates correction

Compared with the Swift `ClassmateRow` and `ClassmatesListView`: retain the
46px avatar, 17px name, 14px grade, compact vote count and smaller weekly label.
Use theme-paired secondary text instead of black with alpha on a dark surface.
The shared Classmates, crush and TBH pickers now use 1px low-contrast decorative
borders, 14px card corners and a 44px-high search field. Long names/grades wrap;
search focus and the Close target remain accessible. The lighter border is a
deliberate web visual adaptation rather than a pixel-identical native claim.

Authoritative classmate data, ordering, profile links and all account/moderation
behavior are unchanged. Existing vector Ask Me/heart symbols and profile images
are retained; no emoji or substitute artwork is introduced.

## Why Add Story was unavailable

1. The private staging gateway explicitly forces `enable_web_stories=false`.
   The native flag alone does not activate the web UI. This is the current live
   cause, not a backend upload defect.
2. Independently, the Story rail hid itself whenever no authors had Stories,
   also hiding Add Story. A failed initial feed load had the same effect. The
   feature-gated component now retains its header/action for both cases.

This patch does **not** enable Stories, alter the gateway, change backend flags,
or post a real Story. Camera-first acquisition, physical photo/video upload and
interruption tests, and two-account safety acceptance remain release gates;
see `THEME_HAPTICS_STORIES_AUDIT.md`. The existing picker-first composer is not
being represented as a finished iOS-equivalent Story experience.

## Validation and rollout

- Baseline before edits: 32 existing Android polish/Story tests passed.
- New appearance checks cover both themes at 320, 393 and 440px in all four
  browser projects, ≥4.5:1 text contrast, bounded layout, long grades, search and
  profile return navigation. Ignored renderings: `artifacts/classmates/`.
- New Story checks exercise empty and failed feeds, opening/cancelling the
  composer, disabled posting without media, and the unchanged independent gate.
- Build, UI-runtime, seven staging-server tests and three static-origin tests
  passed. Shell budget: 42 entries, 679,196 estimated transfer bytes (<750 KB).
- Full local regression on the final runtime: **939 passed, 13 explicit platform
  skips**, 6.0 minutes, zero retries. A subsequent test-fixture improvement made
  long graduation labels explicit through both classmate-loading paths; all 24
  appearance cases then passed again across the four browsers. Runtime code did
  not change between these runs.
- Exact private deployment and live verification evidence is recorded in the
  [release PR](https://github.com/jasonwonton/validapp-landing-page/pull/1).
  Hosted CI is separate from the local results above; do not infer its outcome.

Validation corrections: the first appearance run exposed a Firefox fractional
bounding-box difference (43.999992px for a 44px minimum), not a contrast failure.
The assertion now verifies the CSS minimum and allows 0.0001px numeric tolerance.
An overlapping local run was aborted after another runner stopped their shared
server; final runs use a separately owned server and are not counted from that
interrupted attempt.

Candidate version: `web-v78`. Rollback baseline: `web-v77`, frontend deployment
`0ade8f7c-1d44-4f79-8d2f-fd7eac43db90`, source
`2855783609bce07522c52511ab27507e570b6dc9`. No migration or backend rollback is
needed; preserve outboxes and update-version progression. Overall parity remains
Partial and physical-device acceptance remains open. The requested main merge
is still paused because it triggers public/shared-app production deployments.
