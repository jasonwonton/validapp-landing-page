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

## Follow-up: streaks, Stories and Recent chats

Additional references: `Views/Play/StreakCounterView.swift`, `Views/Feed/StoryViews.swift`, `Views/Chats/ChatListView.swift` (Recent and conversation avatars), and `Services/Networking/ChatPresenceStore.swift`.

- Replaced the leaf-like streak path with a filled flame with an inner cutout. Play uses the native 18px size, 18px count and 16px corner radius; Profile uses 14px; Chats uses a small orange flame and secondary-colored count. Story navigation and classmate search now use the shared vector controls.
- Story avatars now follow the native 68px ring / 60px photo, 14px spacing, 12px names, peach unread rings and gray viewed rings. Your Story is always first, with a plus badge and a separate add action when a Story already exists. The old separate Stories heading/add toolbar is removed. The overlapping add target is circular so it does not intercept the main Story button's center.
- Added the native-style Recent conversation rail: accepted active conversations with message history, newest activity first, capped at twelve; first names for direct chats and full group names, Memento camera or unread badges, and attention rings. These shortcuts preserve the full inbox and support keyboard activation and normal link navigation.
- Groups without a custom photo use a collage of up to four members instead of borrowing one member's photo; groups without previews use a group symbol.

### Confirmed remaining differences

- iOS Play and Profile use the system flame emoji; the PWA retains a portable filled vector under its existing artwork policy. Shared vector controls are visual equivalents of SF Symbols, not identical Apple glyphs.
- Follow-up resolved: green dots, Active now / Active recently labels, group counts and the account activity privacy setting are now implemented using the native presence API. See `PWA_ACTIVE_NOW.md` for lifecycle and validation. Recent timestamps remain separate from presence.
- Story playback still uses explicit previous/next controls and browser media controls instead of native timed progress, tap zones, pause and dismissal gestures. Story creation uses the browser file/capture flow rather than the native camera/editor.
- Chats still presents its search field persistently; native reveals search from the toolbar. Inbox rows also remain bordered cards with smaller preview text; native uses flatter rows, 14px preview text and a lighter attention highlight.

All 180 follow-up Playwright checks passed across Android Chromium, desktop Chromium, Firefox and WebKit, covering Stories, Chats/Mementos, interface assets and Recent selection/navigation. Follow-up responsive verification covers Stories, Chats and Play in both themes at 320/390/430px: all 18 combinations fit without horizontal overflow or displaced navigation. Production build, runtime checks, performance budgets and five static-origin/versioned-asset checks pass; shell transfer estimate is 708,910 bytes. Before/after captures use the same fixtures and are available at `output/ios-design/followup-preview.html`.
