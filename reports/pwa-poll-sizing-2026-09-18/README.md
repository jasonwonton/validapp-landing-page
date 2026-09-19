# Poll text and artwork sizing — September 18, 2026

Release web-v101, `46fd8e7c0695423c6083`.

Compared native PlayGameView, QuestionArtworkView, and QuestionCardCoreView. Play uses 26pt prompts on standard modern iPhones; native artwork is square, fills its frame, and leaves 24pt horizontal margins. Native poll content can scroll instead of shrinking the image to fit a fixed screen.

- Use 26px prompts in Play and feed detail, including the smaller feed text requested by the user (native feed currently specifies 28pt).
- Remove Play's viewport-dependent title growth and remaining-height image constraint. Preserve artwork width and let short or long-content polls scroll above the bottom navigation. Reset the scroll position when advancing to a new question.
- Remove feed detail's 280px/32svh image cap. Both phone views now show 342px square images at 390px width, matching native horizontal artwork insets.
- Fill the square with the image, matching native scaledToFill. Keep selection controls and existing voting behavior.

Validation: 36 existing browser cases pass across Android Chrome, desktop Chrome, Firefox and WebKit, covering light/dark feed details at 320/393/440px, voting and advancement, shuffle, nominations and moderation. Four additional runs of existing Play flows pass on 320×568 Chrome and 375×667 WebKit. Built preview visually inspected in Play and feed detail at 390×844. Runtime contracts, performance budget, all 63 built asset hashes, four-browser startup, offline startup and retained previous-release assets pass. Estimated shell transfer: 730,143 bytes.
