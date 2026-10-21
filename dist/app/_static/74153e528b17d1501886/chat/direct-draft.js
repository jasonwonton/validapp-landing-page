import { loadChatDraftRecord, saveChatDraft, saveDraftAttempt } from "./drafts.js";
import { userMessage } from "../user-message.js";

// Browsing a non-friend uses GET /direct-chats. A room/request is created only
// on Send or an explicit friend request, following the Friends v2 contract.
export async function openDirectDraft({ api, getUser, targetId, name = "this person", escapeHTML: esc, onOpen }) {
    const owner = getUser()?.id;
    if (!owner) return;
    const key = `direct:${targetId}`;
    const saved = loadChatDraftRecord(owner, key);
    const dialog = document.createElement("dialog"); dialog.className = "modal friends-dialog"; dialog.setAttribute("aria-label", `Chat with ${name}`);
    dialog.innerHTML = `<div class="modal-heading"><h2>Chat with ${esc(name)}</h2><button class="icon-button" type="button" data-direct-close aria-label="Close chat draft">×</button></div><div data-direct-content></div><p role="status">Checking who can message…</p>`;
    document.body.append(dialog); dialog.showModal();
    let closed = false, working = false, preview = null;
    let roomRequestId = saved?.roomRequestId || crypto.randomUUID(), messageRequestId = saved?.messageRequestId || crypto.randomUUID();
    const current = () => !closed && getUser()?.id === owner;
    const content = dialog.querySelector("[data-direct-content]"), status = dialog.querySelector("[role=status]");
    async function open(chatId) { if (!current()) return; dialog.close(); await onOpen(chatId); }
    async function load() {
        try {
            preview = await api.getDirectChat(owner, targetId);
            if (!current()) return;
            if (["open", "incoming"].includes(preview.state) && preview.chat_id) return open(preview.chat_id);
            if (preview.state === "friends") { const chat = await api.createChat(owner, [targetId]); if (current()) return open(chat.id); return; }
            if (preview.state === "unavailable") { content.textContent = preview.message || "This chat is unavailable."; status.textContent = ""; return; }
            if (!["message", "request_only"].includes(preview.state)) throw new Error("This chat is unavailable.");
            content.innerHTML = preview.state === "request_only" ? '<p>You can message them after they accept your friend request.</p><button class="primary-button" type="button" data-direct-request>Send friend request</button>' : `<p>Your first message is sent with a friend request.</p><form data-direct-send><label for="directDraftBody">First message</label><textarea id="directDraftBody" rows="3" maxlength="2000" required enterkeyhint="send">${esc(saved?.text || "")}</textarea><button class="primary-button" type="submit">Send message</button></form>`;
            status.textContent = "";
        } catch (error) { if (current()) { status.textContent = userMessage(error, "Couldn't check this chat."); content.innerHTML = '<button class="secondary-button" type="button" data-direct-retry>Try again</button>'; } }
    }
    async function send(requestOnly = false) {
        if (!current() || working || !preview) return;
        const body = dialog.querySelector("textarea")?.value.trim() || "";
        if (!requestOnly && !body) return;
        working = true; dialog.querySelectorAll("button").forEach((button) => { button.disabled = true; }); status.textContent = requestOnly ? "Requesting…" : "Sending…";
        if (!requestOnly) saveDraftAttempt(owner, key, body, { roomRequestId, messageRequestId });
        try {
            if (requestOnly) {
                await api.sendFriendRequest(owner, targetId);
                if (current()) { content.innerHTML = '<p>Friend request sent. You can check it in Add Friends → Requests.</p>'; status.textContent = ""; }
            } else {
                const chat = await api.createChat(owner, [targetId], null, roomRequestId, "new_chat", { body, client_request_id: messageRequestId });
                if (!current()) return;
                saveChatDraft(owner, key, ""); await open(chat.id);
            }
        } catch (error) {
            if (current()) {
                status.textContent = userMessage(error, "Couldn't send. Your draft is saved; retry uses the same request.");
                if (["chat_awaiting_acceptance", "chat_add_first", "friendship_ended"].includes(error.detail?.code)) {
                    content.innerHTML = '<p>Messaging is waiting for acceptance.</p><button class="primary-button" type="button" data-direct-request>Send friend request</button>';
                }
            }
        } finally { working = false; if (current()) dialog.querySelectorAll("button").forEach((button) => { button.disabled = false; }); }
    }
    dialog.addEventListener("input", (event) => { if (event.target.id === "directDraftBody") { saveChatDraft(owner, key, event.target.value); roomRequestId = crypto.randomUUID(); messageRequestId = crypto.randomUUID(); } });
    dialog.addEventListener("keydown", (event) => { if (event.target.id === "directDraftBody" && event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); event.target.form.requestSubmit(); } });
    dialog.addEventListener("click", (event) => { if (event.target.closest("[data-direct-close]") && !working) dialog.close(); if (event.target.closest("[data-direct-retry]")) void load(); if (event.target.closest("[data-direct-request]")) void send(true); });
    dialog.addEventListener("submit", (event) => { event.preventDefault(); void send(); });
    dialog.addEventListener("close", () => { closed = true; content.replaceChildren(); dialog.remove(); }, { once: true });
    await load();
}
