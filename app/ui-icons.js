// Interface symbols, not replacements for user content or product reactions.
// Portable drawings for the same semantic symbols used by MainTabView.
// Keep every silhouette inside the 24-point grid (including its stroke).
const paths = {
    bookmark: '<path d="M6 3h12v19l-6-4-6 4Z"/>',
    'bookmark-slash': '<path d="m3 3 18 18M8 3h10v12M6 8v14l6-4 6 4"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    'trash-filled': '<path d="M3 6h18M9 6V3h6v3"/><path d="m5 8 1 13h12l1-13Z" fill="currentColor" stroke="none"/>',

    newspaper: '<path d="M19 19.5H5a2.5 2.5 0 0 1-2.5-2.5V4.5h16V17a2.5 2.5 0 0 0 2.5 2.5 2 2 0 0 0 .5-2V8h-3M6 8h9M11 11.5h4M11 15h4M6 11.5h2v4H6Z"/>',
    'shuffle-circle': '<circle cx="12" cy="12" r="9.5"/><path d="M7 8.5h1.5c3 0 4 7 7 7H17m-2-2 2 2-2 2M7 15.5h1.5c1 0 1.7-.8 2.5-2M13 10.5c.8-1.2 1.5-2 2.5-2H17m-2-2 2 2-2 2" stroke-width="1.5"/>',
    forward: '<path d="m3 5 9 7-9 7Zm9 0 9 7-9 7Z" fill="currentColor" stroke="none"/>',
    'play-circle': '<circle cx="12" cy="12" r="9.5"/><path d="m10 7.7 6.5 4.3-6.5 4.3Z" fill="currentColor" stroke="none"/>',
    'chat-pair': '<path d="M13 15.5H8l-4.5 3v-4A3.5 3.5 0 0 1 1.5 11V7A3.5 3.5 0 0 1 5 3.5h8A3.5 3.5 0 0 1 16.5 7v5a3.5 3.5 0 0 1-3.5 3.5Z"/><path d="M19.5 8.5a3 3 0 0 1 3 3v4a3 3 0 0 1-2 2.8v3.2L16 18.5h-4a3 3 0 0 1-2.4-1"/>',
    'person-circle': '<circle cx="12" cy="12" r="9.5"/><path d="M15.2 9a3.2 3.2 0 1 1-6.4 0 3.2 3.2 0 0 1 6.4 0ZM5.5 19c.8-3.1 3-4.7 6.5-4.7s5.7 1.6 6.5 4.7"/>',
    'mic-off': '<path d="m3 3 18 18M8 8v5a4 4 0 0 0 6.8 2.8M16 10V6a4 4 0 0 0-7-2.6M5 11v2a7 7 0 0 0 12 5M19 11v2M12 20v2M8 22h8"/>',
    'video-off': '<path d="m3 3 18 18M15 9l7-4v14l-7-4M6 5h6a3 3 0 0 1 3 3v3M15 16v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7"/>',
    hangup: '<path d="M3 15v-4c5-5 13-5 18 0v4l-5-1v-3a12 12 0 0 0-8 0v3z"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor" stroke="none"/>',
    speaker: '<path d="M3 9h4l5-5v16l-5-5H3zM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/>',
    play: '<path d="m8 4 12 8-12 8z" fill="currentColor"/>',
    pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
    mic: '<rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 11v2a7 7 0 0 0 14 0v-2M12 20v2M8 22h8"/>',
    // Upright, open blades and round handles, matching the native scissors control.
    scissors: '<g transform="translate(1.92 1.92) scale(.84)"><circle cx="6" cy="18" r="3.5"/><circle cx="18" cy="18" r="3.5"/><path d="M8.5 15.5 19 2M15.5 15.5 5 2"/></g>',
    infinity: '<path d="M12 12C9 8 7.5 7 5.5 7a5 5 0 0 0 0 10c2 0 3.5-1 6.5-5s4.5-5 6.5-5a5 5 0 0 1 0 10c-2 0-3.5-1-6.5-5Z"/>',
    'view-once': '<circle cx="12" cy="12" r="9" fill="currentColor" stroke="none"/><path d="m10 9 2-2v10" stroke="#ffb15e"/>',
    'camera-filled': '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M8 4h8l2 3h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l2-3Zm4 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"/>',
    camera: '<path d="M8 5h8l2 3h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2Z"/><circle cx="12" cy="14" r="4"/>',
    flip: '<path d="M4 9a8 8 0 0 1 13-4l3 3M20 3v5h-5M20 15a8 8 0 0 1-13 4l-3-3M4 21v-5h5"/>',
    chat: '<path d="M4 4h16v12H9l-5 4z"/><path d="M8 8h8M8 12h5"/>',
    compose: '<path d="M10 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6M10 14l1-4L19 2l3 3-8 8Z"/>',
    search: '<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/>',
    next: '<path d="m9 4 8 8-8 8"/>',
    back: '<path d="m15 4-8 8 8 8"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    paperplane: '<path d="m3 10 18-7-7 18-3-8-8-3Z" fill="currentColor"/><path d="m11 13 6-6" stroke="var(--peach)"/>',
    send: '<path d="M12 20V4m-7 7 7-7 7 7"/>',
    down: '<path d="M12 4v16m-7-7 7 7 7-7"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
    phone: '<path d="m7 3 3 5-3 3c2 3 3 4 6 6l3-3 5 3-1 4C10 22 2 14 3 4z"/>',
    video: '<rect x="2" y="5" width="13" height="14" rx="3"/><path d="m15 9 7-4v14l-7-4"/>',
    heart: '<path d="M12 21 3.6 12.6C-1.3 7.6 5.4 1 10.3 5.9L12 7.6l1.7-1.7c4.9-4.9 11.6 1.7 6.7 6.7Z"/>',
    'shield-check': '<path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z"/><path d="m8 12 3 3 5-6"/>',
    'person-question': '<path d="M17 20a9 9 0 1 1 4-8M5 19c0-6 10-6 10-1"/><circle cx="11" cy="9" r="3"/><path d="M18 15a2 2 0 1 1 3 1.7c-1 .5-1 1-1 1.3m0 3v.1"/>',
    // Play and the weekly game (PlayLockedView, InviteFriendsView, NominationSearchView, EasterEggGameView).
    // SF message.fill: a filled round speech bubble with its tail at the lower left.
    'message-fill': '<path fill="currentColor" stroke="none" d="M12 3.2c5.4 0 9.8 3.6 9.8 8.1s-4.4 8.1-9.8 8.1c-1 0-2-.1-2.9-.4-1.4 1.1-3.3 1.8-5.5 1.8.9-.9 1.6-2 1.8-3.4C3.3 16 2.2 13.8 2.2 11.3c0-4.5 4.4-8.1 9.8-8.1Z"/>',
    // SF person.2.fill: two filled people, the back one smaller.
    'person-2-fill': '<g fill="currentColor" stroke="none"><circle cx="9" cy="7.5" r="3.6"/><path d="M2 19.5c0-3.6 3.1-6.2 7-6.2s7 2.6 7 6.2c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1Z"/><circle cx="17" cy="8.5" r="2.8"/><path d="M17.6 12.9c2.6.3 4.4 2.3 4.4 4.9 0 .5-.4.9-.9.9h-3.3c-.1-2.3-1.1-4.3-2.8-5.6.8-.2 1.7-.3 2.6-.2Z"/></g>',
    'person-slash': '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 13-6.2M3 3l18 18"/>',
    'person-badge-plus': '<circle cx="10" cy="8" r="4"/><path d="M3 21v-1a7 7 0 0 1 11-5.7M19 14v6M16 17h6"/>',
    gamecontroller: '<path d="M7.5 7h9a5 5 0 0 1 4.8 6.4l-1 3.4a2.6 2.6 0 0 1-4.4 1L14.4 16H9.6l-1.5 1.8a2.6 2.6 0 0 1-4.4-1l-1-3.4A5 5 0 0 1 7.5 7Z"/><path d="M8 10v3M6.5 11.5h3"/><circle cx="15.5" cy="10.5" r=".6" fill="currentColor"/><circle cx="17.2" cy="12.5" r=".6" fill="currentColor"/>',
    sparkles: '<path fill="currentColor" stroke="none" d="M10 2.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5ZM18 13c.3 2 1.3 3 3.3 3.3-2 .3-3 1.3-3.3 3.3-.3-2-1.3-3-3.3-3.3 2-.3 3-1.3 3.3-3.3ZM5.5 15.5c.2 1.4.9 2.1 2.3 2.3-1.4.2-2.1.9-2.3 2.3-.2-1.4-.9-2.1-2.3-2.3 1.4-.2 2.1-.9 2.3-2.3Z"/>',
    'arrow-right': '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    // SF pause.fill: two rounded filled bars.
    'pause-fill': '<rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/>',
    // Original drawing in the spirit of SF Symbols flame.fill (StreakCounterView.swift):
    // the tip leans left over a round body, a lick on the left, a small flame cut out.
    fire: '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M6.6 1.9C9.5 1.2 13.6 2.2 16.2 4.4C18.9 6.7 20 10.3 20 13.6C20 18.7 16.6 22.5 12 22.5C7.5 22.5 4 19.2 4 14.7C4 12.2 4.9 10.2 5.6 8.3C5.8 7.6 6.1 7.1 6.6 7.1C7.6 7.1 8.3 8.1 8.7 9.1C8.9 6.8 7.8 4.5 6.2 2.9C5.8 2.5 6 1.9 6.6 1.9ZM11.9 11.3C13.2 12.6 14 14.4 14 16.2C14 18.3 12.9 19.8 11.4 19.8C9.9 19.8 8.9 18.5 8.9 17C8.9 15.6 9.4 14.4 10.3 13.6C10.5 14.2 10.8 14.7 11.2 15C11.1 13.6 11.3 12.3 11.9 11.3Z"/>',
    group: '<circle cx="12" cy="7" r="3" fill="currentColor" stroke="none"/><circle cx="4.5" cy="9" r="2.5" fill="currentColor" stroke="none"/><circle cx="19.5" cy="9" r="2.5" fill="currentColor" stroke="none"/><path d="M6 21v-3a6 6 0 0 1 12 0v3ZM1 20v-3a4 4 0 0 1 4-4M23 20v-3a4 4 0 0 0-4-4"/>',
    person: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    edit: '<path d="m4 16-1 5 5-1L21 7l-4-4Z M14 6l4 4"/>',
    reply: '<path d="m9 4-7 7 7 7M2 11h11a8 8 0 0 1 8 8"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8 15c2 3 6 3 8 0M8 8h.01M16 8h.01"/>',
    more: '<circle cx="4" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="20" cy="12" r="1"/>',
    'activity': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
    leave: '<path d="M13 4H4v16h9M10 12h12m-4-4 4 4-4 4"/>',
    'memento': '<path d="m5 15-3-1L5 2l13 3-1 3"/><rect x="7" y="8" width="15" height="13" rx="2"/><circle cx="12" cy="12" r="1" fill="currentColor"/><path d="m8 19 4-4 3 3 3-4 3 5"/>',
    photo: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="2"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
    // MementoStreakHourglass.swift: caps, tinted glass, full top bulb (the chat
    // view draws the sand level from the time left).
    hourglass: '<path fill="currentColor" fill-opacity=".28" stroke="none" d="M6.5 4.5h11c0 4-4.3 6-4.3 7.5s4.3 3.5 4.3 7.5h-11c0-4 4.3-6 4.3-7.5S6.5 8.5 6.5 4.5Z"/><path fill="currentColor" stroke="none" d="M7.3 5.6h9.4c-.6 2.6-3.5 4.3-3.5 6.4h-2.4c0-2.1-2.9-3.8-3.5-6.4Z"/><rect x="4.5" y="2" width="15" height="2.6" rx="1.3" fill="currentColor" stroke="none"/><rect x="4.5" y="19.4" width="15" height="2.6" rx="1.3" fill="currentColor" stroke="none"/>',
    // bubble.left.and.bubble.right.fill look-alike (Chats empty state).
    'chat-pair-filled': '<path fill="currentColor" stroke="none" d="M5 3h8a3.5 3.5 0 0 1 3.5 3.5v5A3.5 3.5 0 0 1 13 15H8l-4.3 3.2c-.5.4-1.2 0-1.2-.6V14.4A3.5 3.5 0 0 1 1.5 11.5v-5A3.5 3.5 0 0 1 5 3Z"/><path fill="currentColor" stroke="none" d="M18 8h1.5a3 3 0 0 1 3 3v4a3 3 0 0 1-1.5 2.6v2.8c0 .5-.6.8-1 .5L16.4 18H12a3 3 0 0 1-2.4-1.2H13a5 5 0 0 0 5-5Z"/>',
    'eye-slash': '<path d="M2 12s3.6-6.5 10-6.5c2 0 3.7.6 5.1 1.5M22 12s-3.6 6.5-10 6.5c-2 0-3.7-.6-5.1-1.5"/><path d="M9.5 14.5a3.5 3.5 0 0 1 5-5"/><path d="m3 3 18 18"/>',
    'save-down': '<path d="M12 3v12m-5-5 5 5 5-5M5 20h14"/>',
    retake: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6"/><path d="M4 3.5v5.1h5.1"/>',
    'text-search': '<circle cx="11" cy="11" r="7.5"/><path d="m16.5 16.5 5 5M8 9h6M8 12h4.5M8 15h3"/>',
    'arrow-right': '<path d="M4 12h16m-7-7 7 7-7 7"/>',
    // SF Symbols bell.badge.fill: a filled bell with the badge dot top right.
    'bell-badge': '<path fill="currentColor" stroke="none" d="M10.5 3.2a1.5 1.5 0 0 1 3 .1 6 6 0 0 1 1.3.5 4.5 4.5 0 0 0 4.2 6.2V14l1.6 2.4A1 1 0 0 1 19.8 18H4.2a1 1 0 0 1-.8-1.6L5 14v-3.5a6 6 0 0 1 5.5-6Zm-1 15.8h5a2.5 2.5 0 0 1-5 0Z"/><circle cx="19" cy="5" r="3" fill="currentColor" stroke="none"/>',
    // Tab bar (MainTabItems.swift TabIcon): outlined, and filled while selected.
    // Look-alikes of house, hand.tap, bubble.left.and.bubble.right and person.crop.circle.
    'tab-feed': '<path d="M3 10.8 12 3.2l9 7.6"/><path d="M5.5 8.9V19.5a1.5 1.5 0 0 0 1.5 1.5h3v-5.2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V21h3a1.5 1.5 0 0 0 1.5-1.5V8.9"/>',
    'tab-feed-filled': '<path fill="currentColor" stroke="none" d="M12 2.4a1 1 0 0 1 .65.24l9 7.6a1 1 0 0 1-1.3 1.53L19.2 10.8v8.7a2.3 2.3 0 0 1-2.3 2.3H14.4v-6a1.2 1.2 0 0 0-1.2-1.2h-2.4a1.2 1.2 0 0 0-1.2 1.2v6H7.1a2.3 2.3 0 0 1-2.3-2.3v-8.7l-1.15.97a1 1 0 0 1-1.3-1.53l9-7.6A1 1 0 0 1 12 2.4Z"/>',
    'tab-play': '<path d="M7.6 6.2a4.4 4.4 0 0 1 7.8 0"/><path d="M10 15.6V8a1.5 1.5 0 0 1 3 0v4.4a1.25 1.25 0 0 1 2.5 0v.5a1.25 1.25 0 0 1 2.5 0v4.2c0 2.9-2 4.8-5 4.8h-1.2c-1.9 0-3-.8-4.1-2.3l-2.4-3.4a1.3 1.3 0 0 1 2-1.6Z"/>',
    'tab-play-filled': '<path d="M7.6 6.2a4.4 4.4 0 0 1 7.8 0"/><path fill="currentColor" d="M10 15.6V8a1.5 1.5 0 0 1 3 0v4.4a1.25 1.25 0 0 1 2.5 0v.5a1.25 1.25 0 0 1 2.5 0v4.2c0 2.9-2 4.8-5 4.8h-1.2c-1.9 0-3-.8-4.1-2.3l-2.4-3.4a1.3 1.3 0 0 1 2-1.6Z"/>',
    'tab-chats': '<path d="M5 3h7a3.5 3.5 0 0 1 3.5 3.5V10a3.5 3.5 0 0 1-3.5 3.5H8l-4.5 3.2v-3.4A3.5 3.5 0 0 1 1.5 10V6.5A3.5 3.5 0 0 1 5 3Z"/><path d="M17.6 8.5h1.9a3 3 0 0 1 3 3V15a3 3 0 0 1-2 2.83v3.37L16.8 18H12a3 3 0 0 1-2.75-1.8"/>',
    'tab-chats-filled': '<path fill="currentColor" stroke="none" d="M12 8.5h7.5a3 3 0 0 1 3 3V15a3 3 0 0 1-2 2.83v3.37L16.8 18H12a3 3 0 0 1-3-3v-3.5a3 3 0 0 1 3-3Z"/><path fill="currentColor" stroke="var(--tab-icon-cutout, var(--aqua))" stroke-width="2" d="M5 3h7a3.5 3.5 0 0 1 3.5 3.5V10a3.5 3.5 0 0 1-3.5 3.5H8l-4.5 3.2v-3.4A3.5 3.5 0 0 1 1.5 10V6.5A3.5 3.5 0 0 1 5 3Z"/>',
    'tab-profile': '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="9.4" r="3.2"/><path d="M5.7 18.4c1.4-2.3 3.6-3.5 6.3-3.5s4.9 1.2 6.3 3.5"/>',
    'tab-profile-filled': '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M4.15 18.2A10 10 0 1 1 19.85 18.2C18.4 15.9 15.5 14.6 12 14.6S5.6 15.9 4.15 18.2ZM15.4 9.4a3.4 3.4 0 1 0-6.8 0 3.4 3.4 0 0 0 6.8 0Z"/>',
    // SF Symbols lock.fill (FeedVoteLockedView).
    'lock-filled': '<path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke-width="2.4"/><rect x="4.5" y="10" width="15" height="12" rx="2.6" fill="currentColor" stroke="none"/>',
    // SF Symbols ellipsis.circle (QuestionDetailToolbar).
    'ellipsis-circle': '<circle cx="12" cy="12" r="9.5"/><circle cx="7.6" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="16.4" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
    // SF Symbols checkmark.seal.fill ("Valid team", BoostFeedbackSheet.swift).
    'seal-check': '<path fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" d="M12.00 1.60 14.23 3.69 17.20 2.99 18.08 5.92 21.01 6.80 20.31 9.77 22.40 12.00 20.31 14.23 21.01 17.20 18.08 18.08 17.20 21.01 14.23 20.31 12.00 22.40 9.77 20.31 6.80 21.01 5.92 18.08 2.99 17.20 3.69 14.23 1.60 12.00 3.69 9.77 2.99 6.80 5.92 5.92 6.80 2.99 9.77 3.69Z"/><path d="m8 12.2 2.8 2.8 5.2-5.6" stroke="var(--seal-check-mark, #fff)" stroke-width="2.2"/>',
    // SF Symbols crown.fill (GodModeCard.swift).
    'crown-filled': '<path fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" d="M3.6 8.6 7.6 14 12 7.2l4.4 6.8 4-5.4-1.5 8.6H5.1Z"/><circle cx="3.4" cy="7.6" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="5.4" r="1.6" fill="currentColor" stroke="none"/><circle cx="20.6" cy="7.6" r="1.6" fill="currentColor" stroke="none"/><rect x="5.1" y="18.4" width="13.8" height="2.6" rx="1.1" fill="currentColor" stroke="none"/>',
};
export function uiIcon(name) {
    if (!paths[name]) throw new Error(`Unknown interface icon: ${name}`);
    return `<svg class="ui-icon" data-ui-icon="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
