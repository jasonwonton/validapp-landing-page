# PWA recorded-video tracking replay — September 18, 2026

Status: replay runner verified; historical movement clips unavailable. No tracking algorithm change or production deployment.

The PWA fetches authenticated weekly release metadata, downloads the hash-verified package, and uses its own browser wrist tracker. The current 67 package is served through an exact same-origin mirror because its CDN response lacks browser CORS headers. Camera rules/assets are downloaded; reviewed scoring and the MediaPipe wrist tracker run in the PWA. The iOS tracker uses native Vision, so package parity does not imply detector parity.

The earlier native reports reference `/tmp/six7-tracking-round1.mov` through `round3.mov`, `/tmp/six7-pose-first-phone-fast.mov`, `/tmp/six7-pose-first-phone-third.mov`, `/tmp/six7-diagnostic-ten.mov`, and `/tmp/six7-diagnostic-fast.mov`. These files were absent. No matching named clips were found in Desktop, Downloads or Codex worktrees. The connected phone's development app container was unavailable; the staging temporary directory contained a soundtrack but no tracking recordings. The old reports remain available in the Six7 repository. The ten-swap control has a known total of ten; native fast-run scores are not independent ground truth.

The new `scripts/weekly-game/replay-video.mjs` serves one private clip on a loopback-only server, blocks external browser requests, and runs the actual PWA worker/model, WristTracker capture and continuity, CameraEvidence and camera-game scorer. It performs sequential inference at 30 Hz video timestamps, retains up to one second of preroll, and records source/model/video hashes, per-frame measured pairs, continuity breaks, evidence rows and scoring timestamps. Private videos and per-frame outputs should stay outside Git.

Usage from the PWA repository:

```sh
node scripts/weekly-game/replay-video.mjs /private/ten-swaps.mov /private/ten-swaps-result.json 0 10 10
```

Arguments after the output path are scoring start seconds, scoring duration seconds and optional independently established crossing total. Identify the actual scoring window before testing: countdown/reaction movements do not count. A total mismatch exits with code 2 while preserving the report. Compressed recordings may differ from raw camera frames, and matching totals can conceal compensating misses and extras. Review event times against manually annotated movements. Sequential replay waits for every inference and does not measure live phone throughput or camera exposure/thermal behavior.

Validation: converted the existing static pose image into a two-second 30 fps H.264 control; actual model/capture/continuity/evidence/scorer produced 0 points, 60 analyzed frames, 60 valid pairs and 0 breaks. This is a harness smoke test, not moving-hand accuracy evidence. The known ten-swap and fast clips still need to be supplied or recovered before reporting PWA counting accuracy.
