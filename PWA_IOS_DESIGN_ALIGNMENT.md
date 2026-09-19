# PWA iOS design alignment — September 18, 2026

Candidate `web-v94`, based on the deployed recovery release `1130674`, in branch `codex/pwa-ios-design`. This candidate is local; no deployment or backend configuration was changed.

## Native references

Compared with the current Six7 iOS source: `Utilities/Six7Theme.swift`, `Views/MainTabView.swift`, `Views/Settings/ProfileHeaderSection.swift`, `Views/Chats/ChatListView.swift`, and `Views/Play/PlayComponents.swift` / `PlayGameView.swift`.

- The PWA app icon already exactly matches `AppIcon.appiconset/app_icon_1024.png`: SHA-256 `8772ce01222a90d7fa08b651bb70e9272b15f4e5a69ee064dfaf39dec3fb8fa3`.
- Tab icons now use the same concepts as iOS: newspaper, circled play, overlapping chat bubbles, and a circular profile. Labels are 14px; icons are 26px with a native-colored selected surface. Browser-portable SVGs remain equivalents, not exported Apple symbol binaries.
- Shared symbols include the circled shuffle and filled forward actions used by native Play; camera, compose, heart, and media play shapes have consistent bounded silhouettes.
- Dark canvas, text, primary/secondary surfaces, teal accents, pink surfaces and heart accents now follow Six7Theme. Illustrated outlines have their own role, preventing near-white text colors from turning every card border white. Strong controls and increased-contrast mode retain separate border values.
- Peach actions retain the native peach in both themes; the darker Nominate surface has readable light text and its native pressed color. Installed browser chrome follows the new dark canvas.
- Profile keeps the native 120px photo, 28px name, 16px spacing, 24px padding and 40px statistic artwork on mobile instead of shrinking them. Jua remains the existing font; synthetic font faces are disabled.
- Theme changes carry through Feed, Play, Profile, Chats and Story sheets. User content, reactions, media and account behavior are preserved.

## Verification

- 156 existing Playwright checks passed across Android Chromium, desktop Chromium, Firefox, and WebKit: PWA polish, interface artwork, appearance/contrast preferences, and chat hierarchy.
- All 24 combinations of four tabs × light/dark × 320/390/430px fit without horizontal overflow, clipped Play actions, or a displaced bottom navigation bar.
- Production static build, UI runtime checks, performance budgets and all five static-origin/versioned-asset checks passed. Font 17,516 bytes; artwork 373,242 bytes; offline shell 52 entries, estimated transfer 706,894 bytes.
- Built-output visual capture completed for both themes across tabs, preferences, chat rooms, Mementos, stickers, camera capture and photo review. The audit script's ambiguous close selector was narrowed to the visible Close photo action.
- Existing signed-out DOM budget is preserved. Initial checks caught excess SVG nodes; combining vector subpaths fixed that without raising the limit.

Local before/after review: `output/ios-design/preview.html`. Test logs and responsive measurements: `output/ios-design/`. Extended built-output captures: `artifacts/ui-audit/`.

This is a source-based design comparison and browser verification, not a pixel-perfect native screenshot comparison or physical-device acceptance. Nothing has been published.
