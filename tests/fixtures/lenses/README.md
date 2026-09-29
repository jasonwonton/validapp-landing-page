`solo.jpg` and `group.jpg` are cut from Six7's synthetic validation portraits
(`config/camera_filters/make_me_bald/validation/portraits/dark-curls.png` and
`fair-fringe.png`), generated as fictional test subjects, not real people.

`landmarks.json` is the real Face Landmarker's output for them at the lens
engine's 320 px analysis size, reduced to the mesh points the lenses use
(`scripts/lenses/record-fixtures.mjs`). `vision-reference.json` is macOS
Vision on the same photos (`scripts/lenses/vision-reference.swift`): the iOS
lenses' anchors, which the web face box and points are calibrated to.
