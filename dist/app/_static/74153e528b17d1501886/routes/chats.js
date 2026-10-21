import { createChatsView } from "../chat/index.js";

let view = null;

// The view without opening the tab: the Camera tab and the Story rail's +
// use its camera over whatever tab is showing.
export function ensureView(context) {
    if (!view) view = createChatsView(context);
    return view;
}

export function activate(context) {
    return ensureView(context).activate(context);
}

export function refresh() {
    return view?.refresh();
}

export function beforeSessionEnd() {
    return view?.beforeSessionEnd();
}

export function openChat(chatId) { return view?.openChat(chatId); }
