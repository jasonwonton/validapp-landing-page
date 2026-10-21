import { userMessage } from "./user-message.js";

export async function openAskComposer({ api, getUser, publicToken, escapeHTML: esc, onSent, onCheckSent }) {
    const owner = getUser()?.id;
    if (!owner || !publicToken) return;
    const dialog = document.createElement("dialog"); dialog.className = "modal friends-dialog parity-page ask-compose-page"; dialog.setAttribute("aria-label", "Ask anonymously");
    dialog.innerHTML = '<header class="parity-page-header"><button class="parity-close" type="button" data-ask-close aria-label="Close question">Close</button><h2>Valid</h2><span></span></header><div class="parity-page-content" data-ask-compose-content></div><p class="parity-status" role="status">Loading…</p>';
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
            const maxLength = Math.min(500, Math.max(1, Number(context.max_length) || 500));
            content.innerHTML = canSend ? `<form class="ask-compose-form" data-ask-compose><div class="ask-composer-identity"><span class="ask-anonymous-badge"><b>?</b>You're anonymous</span><h3>Message ${esc(context.recipient_display_name)}</h3>${context.recipient_username ? `<p>@${esc(context.recipient_username)}</p>` : ""}</div><label class="visually-hidden" for="outgoingAskBody">Your question</label><textarea id="outgoingAskBody" placeholder="Write something…" rows="5" maxlength="${maxLength}" required enterkeyhint="send"></textarea><small class="ask-compose-count" data-ask-count>0/${maxLength}</small><p class="ask-compose-disclosure">Your name stays hidden from the recipient.</p><p class="ask-compose-safety">${esc(context.privacy_notice || "Be kind. Threats, harassment, sexual content, and contact information are filtered.")}</p><div class="ask-compose-send-bar"><button class="primary-button" type="submit" aria-label="Send question">Send</button></div></form>` : '<div class="friends-empty"><h3>Ask link unavailable</h3><p>This link may have been reset or paused.</p></div>';
            status.textContent = "";
        } catch (error) { if (current()) { status.textContent = userMessage(error, "Couldn't open this Ask Me link."); content.innerHTML = '<button class="secondary-button" type="button" data-ask-compose-retry>Try again</button>'; } }
    }
    dialog.addEventListener("close", () => { closed = true; content.replaceChildren(); dialog.remove(); }, { once: true });
    dialog.addEventListener("click", (event) => {
        if (event.target.closest("[data-ask-close]")) dialog.close();
        if (event.target.closest("[data-ask-compose-retry]")) void load();
        if (event.target.closest("[data-check-sent]")) { dialog.close(); onCheckSent?.(); }
    });
    dialog.addEventListener("input", (event) => {
        if (event.target.id === "outgoingAskBody") dialog.querySelector("[data-ask-count]").textContent = `${event.target.value.length}/${event.target.maxLength}`;
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
            content.innerHTML = '<div class="ask-sent-card"><span aria-hidden="true">✓</span><h3>Message sent</h3><p>Your name stays hidden. You can find your outgoing questions and replies in Ask Me → Sent.</p><button class="primary-button" type="button" data-check-sent>Open Sent</button></div>';
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
