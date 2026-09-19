# Poll viewport fitting correction — September 18, 2026

Release web-v102, `045e2964c238282cb0c9`.

The user's follow-up clarifies that text, artwork and options should fit together first. This supersedes the scroll-first layout in web-v101 while retaining its smaller 26px prompts and larger artwork where space permits.

Play allocates space for the prompt, four options and Shuffle/Nominate/Skip, then gives the square artwork the remaining height up to the available width. Native compact choice sizes reclaim space on shorter displays: 85px/19px text below 815px height, 65px/18px text below 670px. The poll area remains scrollable only when content exceeds the minimum image allowance.

Feed detail groups the prompt and attribution, reserves room for all options and any hint, then sizes artwork to the remaining viewport space. Short screens use compact options. A minimum content height prevents unusually long prompts from overlapping the engagement/share content below.

Validation: 12 voting/shuffle/nomination/moderation cases across four browsers; 48 light/dark feed geometry and contrast cases at 320/393/440px widths and short/tall heights; four existing Play-flow cases at 320×568 Chrome and 375×667 WebKit. Tests assert Play has no overflow for normal demo polls, all options remain within the feed viewport, and artwork stays square. Built compact Play and feed detail were inspected visually at 375×667. Runtime contracts, performance budget, 63 asset hashes, four-browser startup, offline shell and retained previous-release assets pass.
