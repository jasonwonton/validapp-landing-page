import { userMessage } from "./user-message.js";

export async function openAskComposer({ api, getUser, publicToken, escapeHTML: esc, onSent, onCheckSent }) {
    const owner = getUser()?.id;
    if (!owner || !publicToken) return;
    const dialog = document.createElement("dialog"); dialog.className = "modal friends-dialog"; dialog.setAttribute("aria-label", "Ask anonymously");
    dialog.innerHTML = '<div class="modal-heading"><h2>Ask anonymously</h2><button class="icon-button" type="button" data-ask-close aria-label="Close question">×</button></div><div data-ask-compose-content></div><p role="status">Loading…</p>';
    document.body.append(dialog); dialog.showModal();
    let closed = false, sending = false, canSend = false;
    const nonce = crypto.randomUUID();
    const current = () => !closed && getUser()?.id === owner;
    const content = dialog.querySelector("[data-ask-compose-content]"), status = dialog.querySelector("[role=status]");
    async function load() {
        status.textContent = "Loading…";
        try {
            const context = await api.getPublicAskContext(publicToken);
            if (!current()) return;
            canSend = context.is_active === true;
            content.innerHTML = canSend ? `<p>To ${esc(context.recipient_display_name)}. Your name stays hidden from the recipient.</p><p>${esc(context.privacy_notice || "Keep it kind. Valid can review reported messages.")}</p><form data-ask-compose><label for="outgoingAskBody">Your question</label><textarea id="outgoingAskBody" rows="4" maxlength="${Math.min(500, Math.max(1, Number(context.max_length) || 500))}" required enterkeyhint="send"></textarea><button class="primary-button" type="submit">Send question</button></form>` : '<p>This Ask Me link is unavailable.</p>';
            status.textContent = "";
        } catch (error) { if (current()) { status.textContent = userMessage(error, "Couldn't open this Ask Me link."); content.innerHTML = '<button class="secondary-button" type="button" data-ask-compose-retry>Try again</button>'; } }
    }
    dialog.addEventListener("close", () => { closed = true; content.replaceChildren(); dialog.remove(); }, { once: true });
    dialog.addEventListener("click", (event) => {
        if (event.target.closest("[data-ask-close]")) dialog.close();
        if (event.target.closest("[data-ask-compose-retry]")) void load();
        if (event.target.closest("[data-check-sent]")) { dialog.close(); onCheckSent?.(); }
    });
    dialog.addEventListener("keydown", (event) => {
        if (event.target.id === "outgoingAskBody" && event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); event.target.form.requestSubmit(); }
    });
    dialog.addEventListener("submit", async (event) => {
        event.preventDefault(); if (!current() || sending || !canSend) return;
        const textarea = dialog.querySelector("textarea"), body = textarea.value.trim();
        if (!body) return;
        const button = event.target.querySelector("button[type=submit]");
        sending = true; button.disabled = true; status.textContent = "Sending…";
        try {
            await api.submitPublicAsk(publicToken, body, nonce);
            if (!current()) return;
            content.innerHTML = '<h3>Question sent</h3><p>You can find your outgoing questions and replies in Ask Me → Sent.</p><button class="primary-button" type="button" data-check-sent>Open Sent</button>';
            status.textContent = ""; onSent?.();
        } catch (error) {
            if (!current()) return;
            status.textContent = [0, 408, 500, 502, 503, 504].includes(error.status)
                ? "Couldn't confirm this send. Check Sent before sending again."
                : userMessage(error, "Couldn't send this question. Try again.");
            if ([0, 408, 500, 502, 503, 504].includes(error.status)) {
                const check = document.createElement("button"); check.type = "button"; check.className = "secondary-button"; check.dataset.checkSent = ""; check.textContent = "Check Sent"; content.append(check);
            }
        } finally { sending = false; if (current() && button.isConnected) button.disabled = false; }
    });
    await load();
}
