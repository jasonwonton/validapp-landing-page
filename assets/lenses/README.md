# Camera lens assets

Face lenses for the web camera (chat photo and Memento), loaded only when a
camera opens. Nothing here is in the service-worker app shell.

- `face-tracker-<hash>.js`: the Face Landmarker worker, built by
  `node scripts/lenses/build-face-tracker.mjs` (run by `npm run build`). It
  bundles MediaPipe Tasks Vision 0.10.32 and loads the shared wasm and
  `face_landmarker.task` from `assets/weekly-game/mediapipe-0.10.32/` (hashes,
  source and Apache-2.0 licence in `assets/weekly-game/README.md` and
  `LICENSE.mediapipe.txt`). The filename carries a content hash; keep old
  bundles for already-open clients. `app/lenses/face-tracker-asset.js` pins it.
  Frames are analysed in the browser; no camera frame leaves the device.
- `art/`: Valid's own lens artwork from the iOS asset catalog
  (`dog_filter_*`, `cat_filter_*`, `bear_filter_*`, `crown_filter_crown`,
  `heart_shades_filter_glasses`, `halo_filter_ring`), re-encoded as WebP at
  most 640 px wide (`cwebp -q 86 -alpha_q 90 -m 6`). Aspect ratios are
  unchanged, so the iOS placement anchors apply as-is.
- `icons/`: the iOS `*_filter_lens_icon` carousel icons, 168 px WebP.

Crying is drawn in code (`app/lenses/draw.js`), as on iOS.
