// Local preview fixture; production always asks the authenticated featured API.
export const DEMO_RELEASE = {
  "age_rating": 4,
  "bundle": {
    "byte_size": 412705,
    "sha256": "75eeb783b361dfbf063465a6b87aac862db76831d31aeab601488d2b2e8cfa46",
    "url": "https://validappcdn.com/games/67-challenge-75eeb783b361dfbf063465a6b87aac862db76831d31aeab601488d2b2e8cfa46.six7game.json"
  },
  "camera_mode": "hand-package-v1",
  "description": "How many in 10 seconds?",
  "game_id": "67-challenge",
  "id": "2c57f8ca3408c460e31a16d6dc59c576916910a2f7b91f6b59184c159e7c1747",
  "renderer_version": 1,
  "rules": {
    "accent": "#00E5C4",
    "countdown_seconds": 5,
    "duration_seconds": 10,
    "game": {
      "mechanic": "height_crossings",
      "steps": []
    },
    "instruction_asset": null,
    "instruction_preset": "none",
    "instructions": "Just do this on video.",
    "music_asset": null,
    "music_preset": "none",
    "reaction_seconds": 3,
    "score_unit": "points"
  },
  "runtime": "camera-v1",
  "score_validator": "hand-motion-v1",
  "title": "67 Challenge",
  "update_notice_release_id": "49811b4377a5e99570b6ea58d7d62b2d9055ee5da44b24d41262136f3cfbc99f"
};

// The live hand-package-v2 selection (Scuba Challenge, week of 2026-09-28).
// Demo: /app/?demo=1&weeklygame=scuba
export const DEMO_SCUBA_RELEASE = {
  "age_rating": 4,
  "artwork_url": "https://validappcdn.com/games/art/scuba-challenge-fb1f71264dc6b208.png",
  "bundle": {
    "byte_size": 1908760,
    "sha256": "07f697bf8d256739aea52c94aacc0aa6ed25bf1356321952194bfc82bd822ca2",
    "url": "https://validappcdn.com/games/scuba-07f697bf8d256739aea52c94aacc0aa6ed25bf1356321952194bfc82bd822ca2.six7game.json"
  },
  "camera_mode": "hand-package-v2",
  "description": "Pinch your nose and flap your other hand side to side. Every flip is a point. Song: SCUBA JUKE (IT STANKK) by h5wk.",
  "game_id": "scuba",
  "id": "2e0f74ae08171f189fcdcf32bc954a0ae45ce7fe768f3255eca9f8681f3f57a4",
  "max_score": 200,
  "renderer_version": 1,
  "rules": {
    "accent": "#49C7FF",
    "camera_tracking": {
      "profile": "responsive",
      "sample_rate_hz": 30,
      "version": 1
    },
    "countdown_seconds": 5,
    "duration_seconds": 10,
    "game": {
      "version": 1
    },
    "instruction_asset": null,
    "instruction_preset": "none",
    "instructions": "Just do this on camera.",
    "music_asset": null,
    "music_preset": "none",
    "reaction_seconds": 3,
    "score_unit": "flips"
  },
  "runtime": "camera-v1",
  "score_validator": "self-reported-v1",
  "title": "Scuba Challenge",
  "update_notice_release_id": "49811b4377a5e99570b6ea58d7d62b2d9055ee5da44b24d41262136f3cfbc99f"
};
