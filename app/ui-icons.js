// Interface symbols, not replacements for user content or product reactions.
const paths = {
    camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/>',
    flip: '<path d="M4 9a8 8 0 0 1 13-4l3 3M20 3v5h-5M20 15a8 8 0 0 1-13 4l-3-3M4 21v-5h5"/>',
    chat: '<path d="M4 4h16v12H9l-5 4z"/><path d="M8 8h8M8 12h5"/>',
    compose: '<path d="M12 4H4v16h16v-8M10 14l1-5L19 1l4 4-8 8z"/>',
    search: '<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/>',
    back: '<path d="m15 4-8 8 8 8"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    send: '<path d="M12 20V4m-7 7 7-7 7 7"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
    phone: '<path d="m7 3 3 5-3 3c2 3 3 4 6 6l3-3 5 3-1 4C10 22 2 14 3 4z"/>',
    video: '<rect x="2" y="5" width="13" height="14" rx="3"/><path d="m15 9 7-4v14l-7-4"/>',
    heart: '<path d="M12 21 3 12C-3 3 7-2 12 6 17-2 27 3 21 12z"/>',
    more: '<circle cx="4" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="20" cy="12" r="1"/>',
    photo: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="2"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
};
export function uiIcon(name) {
    if (!paths[name]) throw new Error(`Unknown interface icon: ${name}`);
    return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
