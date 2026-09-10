import { createChatsView } from "../chat/index.js";

let view = null;

export function activate(context) {
    if (!view) view = createChatsView(context);
    return view.activate(context);
}

export function refresh() {
    return view?.refresh();
}

export function beforeSessionEnd() {
    return view?.beforeSessionEnd();
}
