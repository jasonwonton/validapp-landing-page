import { uiIcon } from "./ui-icons.js";
import { userMessage } from "./user-message.js";
import { confirmSheet, startCodeResendCountdown } from "./ui-dialogs.js";
export async function openParentLink({ api, getUser, escapeHTML: esc }) {
    const userId = getUser()?.id;
    if (!userId) return;
    const dialog = document.createElement("dialog"); dialog.className = "modal friends-dialog parity-page parent-link-page"; dialog.setAttribute("aria-label", "Parent access");
    dialog.innerHTML = '<header class="parity-page-header"><button class="parity-back" type="button" data-parent-link-close aria-label="Close parent access">‹</button><h2>Parent access</h2><span></span></header><div class="parity-page-content" data-parent-link-content></div><p class="parity-status" role="status">Loading…</p>';
    document.body.append(dialog); dialog.showModal();
    let busy = false, generation = 0, codeTimer = null, savedStatus = null;
    const current = () => dialog.isConnected && dialog.open && getUser()?.id === userId;
    const request = (path, payload = null, method = "POST") => api.request(path, payload ? { method, body: JSON.stringify(payload) } : { method });
    const content = () => dialog.querySelector("[data-parent-link-content]");
    const status = (text) => { if (current()) dialog.querySelector("[role=status]").textContent = text; };
    function render(value) {
        if (!current()) return;
        savedStatus = value; clearInterval(codeTimer);
        if (value.monitoring) content().innerHTML = `<p>A parent is linked${value.phone_last4 ? ` (ending ${esc(value.phone_last4)})` : ""}. They can read the account's feed and permitted chats, and manage privacy protections.</p>${value.unlink_requested ? '<p>Waiting for your parent to approve unlinking.</p><button class="secondary-button" type="button" data-parent-unlink-cancel>Cancel unlink request</button>' : '<button class="secondary-button" type="button" data-parent-unlink>Ask parent to unlink</button>'}`;
        else if (value.can_link) content().innerHTML = '<p>Link your parent’s own number so they can read your chats and feed and manage privacy. They cannot vote, post or message as you. This is optional monitoring.</p><form data-link-parent><label>Parent phone number<input name="phone" type="tel" minlength="10" maxlength="20" autocomplete="tel" required></label><label class="friend-setting"><span>I understand that my parent can view my account and manage privacy.</span><input name="acknowledged" type="checkbox" required></label><button class="primary-button" type="submit">Send parent code</button></form>';
        else content().innerHTML = '<p>Parent linking is unavailable for this account right now.</p>';
    }
    async function load() {
        const epoch = ++generation;
        try { const value = await api.request("/parent-approvals/my-status"); if (current() && epoch === generation) { render(value); status(""); } }
        catch (error) { if (current() && epoch === generation) { status(userMessage(error, "Couldn't complete this step. Try again.")); content().innerHTML = '<button class="secondary-button" type="button" data-parent-link-retry>Try again</button>'; } }
    }
    dialog.addEventListener("close", () => { ++generation; clearInterval(codeTimer); dialog.remove(); }, { once: true });
    dialog.addEventListener("click", async (event) => {
        if (event.target.closest("[data-parent-link-close]")) return dialog.close();
        if (event.target.closest("[data-parent-link-retry]")) return void load();
        if (event.target.closest("[data-parent-link-change]") && !busy) { render(savedStatus); status(""); return; }
        const resend = event.target.closest("[data-parent-link-resend]");
        if (resend && !resend.disabled && !busy && current()) {
            busy = true; resend.disabled = true;
            try {
                const phone = dialog.querySelector('[name="phone"]').value;
                const result = await request("/parent-links/phone/request", { phone_number: phone });
                if (current()) { clearInterval(codeTimer); codeTimer = startCodeResendCountdown(resend, result.resend_available_at); status(""); }
            } catch (error) { if (current()) { status(userMessage(error, "Couldn't resend. Try again.")); resend.disabled = false; } }
            finally { busy = false; }
            return;
        }
        const unlink = event.target.closest("[data-parent-unlink], [data-parent-unlink-cancel]");
        if (!unlink || busy || !current()) return;
        busy = true; unlink.disabled = true;
        try {
            const value = await request("/parent-links/unlink-request", null, unlink.matches("[data-parent-unlink-cancel]") ? "DELETE" : "POST");
            if (current()) { render(value); status(""); }
        } catch (error) { status(userMessage(error, "Couldn't complete this step. Try again.")); }
        finally { busy = false; if (unlink.isConnected) unlink.disabled = false; }
    });
    dialog.addEventListener("submit", async (event) => {
        event.preventDefault(); if (busy || !current()) return;
        const form = event.target, fields = new FormData(form), phone = fields.get("phone"), code = fields.get("code");
        busy = true; form.querySelector("button").disabled = true; status("Checking…");
        try {
            if (!code) {
                const result = await request("/parent-links/phone/request", { phone_number: phone });
                if (!current()) return;
                content().innerHTML = `<form data-link-parent><input type="hidden" name="phone" value="${esc(phone)}"><label>Parent code<input name="code" inputmode="numeric" autocomplete="one-time-code" minlength="4" maxlength="10" required></label><button class="primary-button" type="submit">Verify and link parent</button><button class="secondary-button" type="button" data-parent-link-resend>Resend Code</button><button class="text-button" type="button" data-parent-link-change>Use another number</button></form>`;
                codeTimer = startCodeResendCountdown(dialog.querySelector("[data-parent-link-resend]"), result.resend_available_at);
            } else render(await request("/parent-links/phone/confirm", { phone_number: phone, code, monitoring_acknowledged: true }));
            status("");
        } catch (error) { status(userMessage(error, "Couldn't complete this step. Try again.")); }
        finally { busy = false; if (form.isConnected) form.querySelector("button").disabled = false; }
    });
    await load();
}

// Separate parent capability: kept in memory, never handed to ValidAPI's
// child session, localStorage, the chat outbox, or the service worker.
export function openParentView({ api, token, escapeHTML: esc, onClose }) {
    if (!/^parentv1_/.test(token || "")) throw new Error("Invalid parent access response.");
    const dialog = document.createElement("dialog"); dialog.className = "modal friends-dialog parity-page parent-view"; dialog.setAttribute("aria-label", "Parent view");
    dialog.innerHTML = `<header class="parent-view-header"><span class="parent-child-avatar" aria-hidden="true"></span><div><small>Parent view</small><strong data-parent-name>Your child's Valid</strong><select data-parent-child aria-label="Child"></select></div><button class="parity-icon-button" type="button" data-parent-options aria-label="Parent view options" aria-expanded="false">${uiIcon("more")}</button></header><nav class="friend-menu parent-options hidden" aria-label="Parent view options"><button type="button" data-parent-refresh>Refresh</button><button type="button" data-parent-permission>Parent permission</button><button type="button" data-parent-notice>What Valid collects</button><button type="button" data-parent-logout>Log out</button></nav><div data-parent-view-content class="parity-page-content"></div><p class="parity-status" role="status">Loading…</p><nav class="parent-tab-bar" aria-label="Parent view sections">${[["chats", "Chats", "tab-chats"], ["feed", "Feed", "tab-feed"], ["settings", "Settings", "settings"]].map(([key, name, icon]) => `<button type="button" data-parent-tab="${key}" aria-label="${name}" aria-pressed="${key === "chats"}">${uiIcon(icon)}<span>${name}</span></button>`).join("")}</nav>`;
    let activeToken = token, childId = null, childRows = [], tab = "chats", scope = "school", epoch = 0, closed = false, working = false, messageCursor = null, feedCursor = null, activeChat = null, privacyPage = null;
    const content = dialog.querySelector("[data-parent-view-content]"), status = dialog.querySelector("[role=status]");
    const call = (path, options = {}) => api.request(path, { ...options, auth: false, headers: { "X-Parent-Access-Token": activeToken }, credentials: "omit" });
    const current = (generation) => !closed && epoch === generation;
    const endpoint = () => `/parent-access/children/${encodeURIComponent(childId)}`;
    const child = () => childRows.find(row => row.user_id === childId);
    const write = (path, body, method = "POST") => call(path, { method, body: JSON.stringify(body) });
    const reportButton = (kind, id) => id ? `<button class="text-button" type="button" data-parent-report="${kind}" data-parent-item="${esc(id)}">Report safety issue</button>` : "";
    function settings() {
        const row = child();
        if (!row) return;
        const name = esc(row.first_name || "Your child");
        if (privacyPage) {
            const isReach = privacyPage === "school_contacts_only", value = row[privacyPage];
            const choices = isReach ? [[false, "Everyone", `Anyone with ${name}'s username can add them, even from other schools`], [true, "School & contacts", "Only people from their school or their contacts can find and add them"]] : [[false, `People ${name} knows`, `Anyone else has to wait until ${name} accepts their friend request`], [true, `Anyone who adds ${name}`, `People ${name} doesn't know can send a message with their friend request`]];
            const notes = isReach ? [`Contacts are people whose number ${name} saved, or who saved theirs.`, `With School & contacts, ${name} can only add people from their school and contacts, too.`, `Changing this doesn't remove anyone. ${name}'s friends stay friends.`, `If you pick School & contacts, ${name} can't change it while you're linked.`] : [`People ${name} knows go to their school, are saved in their contacts, share a friend with them, or have chatted with them.`, `Adults ${name} doesn't know can never message them first.`, "Blocked people can never message them.", `If you pick People ${name} knows, ${name} can't change it while you're linked.`];
            content.innerHTML = `<div class="parent-section-heading"><button class="parity-back" type="button" data-parent-settings-back aria-label="Back to settings">‹</button><h3>${isReach ? "Who can add them" : "Who can message them"}</h3><span></span></div><div class="parity-settings-card" role="radiogroup" aria-label="${isReach ? "Who can add them" : "Who can message them"}">${choices.map(([checked, label, detail]) => `<label class="parity-choice"><span><strong>${label}</strong><small>${detail}</small></span><input type="radio" name="parent-privacy" data-parent-setting="${privacyPage}" value="${checked}" ${value === checked ? "checked" : ""}></label>`).join("")}</div><div class="parity-choice-notes">${notes.map(note => `<p>${note}</p>`).join("")}</div>`;
            status.textContent = ""; return;
        }
        content.innerHTML = `<h3 class="parent-page-title">Settings</h3>${row.unlink_requested ? `<section class="parent-setting-section"><h4>Unlink request</h4><div class="parity-settings-card"><p>${name} asked to stop sharing. Sharing continues until you approve.</p><button class="secondary-button" type="button" data-parent-unlink-answer="approve">Approve unlinking</button><button class="secondary-button" type="button" data-parent-unlink-answer="keep">Keep sharing</button></div></section>` : ""}
            ${row.scope === "contacts" ? `<section class="parent-setting-section"><h4>${name}'s privacy</h4><div class="parity-settings-card">${typeof row.school_contacts_only === "boolean" ? `<button class="parity-setting-row" type="button" data-parent-privacy="school_contacts_only">${uiIcon("person-add")}<span><strong>Who can add them</strong><small>${row.school_contacts_only ? "School & contacts" : "Anyone"}</small></span><span aria-hidden="true">›</span></button>` : ""}${typeof row.message_requests_from_anyone === "boolean" ? `<button class="parity-setting-row" type="button" data-parent-privacy="message_requests_from_anyone">${uiIcon("chat-pair")}<span><strong>Who can message them</strong><small>${row.message_requests_from_anyone ? `Anyone who adds ${name}` : `People ${name} knows`}</small></span><span aria-hidden="true">›</span></button>` : ""}${typeof row.activity_status_enabled === "boolean" ? `<label class="parity-setting-row">${uiIcon("activity")}<span><strong>Show activity status</strong><small>People in their chats see when they're active</small></span><input class="parity-switch" type="checkbox" data-parent-setting="activity_status_enabled" ${row.activity_status_enabled ? "checked" : ""}></label>` : ""}</div><p class="parent-setting-note">When you pick the safer option, ${name} can't change it while you're linked.</p></section>` : ""}
            <section class="parent-setting-section"><h4>Sharing</h4><div class="parity-settings-card"><div class="parity-setting-row">${uiIcon("group")}<span><strong>${name} shares their account with you</strong></span></div></div></section><button class="parent-sign-out" type="button" data-parent-logout>Sign out of parent view</button>`;
        status.textContent = "";
    }
    function permission() {
        const row = child();
        content.innerHTML = `<div class="parent-section-heading"><button class="parity-back" type="button" data-parent-settings-back aria-label="Back to settings">‹</button><h3>Parent permission</h3><span></span></div><div class="parity-settings-card"><p>Parent permission: ${esc(row?.permission_status || "linked")}.</p>${row?.permission_status && row.permission_status !== "linked" ? '<p>Withdrawing permission pauses the account.</p><label class="parity-choice"><span>Also request deletion of the account and personal information</span><input type="checkbox" data-parent-delete></label><button class="secondary-button" type="button" data-parent-withdraw>Withdraw permission</button>' : '<p>You can manage sharing and privacy in Settings.</p>'}<a href="mailto:support@validapp.lol">Review information or get help</a></div>`;
        const withdraw = content.querySelector("[data-parent-withdraw]"); if (withdraw) withdraw.disabled = row?.permission_status === "withdrawn";
    }
    async function load() {
        if (!childId) return;
        dialog.querySelector("[data-parent-name]").textContent = `${child()?.first_name || "Your child"}'s Valid`;
        dialog.querySelector(".parent-child-avatar").textContent = (child()?.first_name || "?").slice(0, 1);
        const generation = ++epoch; status.textContent = "Loading…"; content.replaceChildren();
        dialog.querySelectorAll("[data-parent-tab]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.parentTab === tab)));
        if (tab === "settings") { settings(); return; }
        try {
            const response = tab === "chats" ? await call(`${endpoint()}/chats`) : await call(`${endpoint()}/feed?${new URLSearchParams({ scope, ...(feedCursor || {}) })}`);
            if (!current(generation)) return;
            if (tab === "chats") content.innerHTML = `<h3 class="parent-page-title">Chats</h3><p class="parent-setting-note">Read only · Photos and videos stay private</p>` + (response.chats.map((chat) => `<button class="notification-row" type="button" data-parent-chat="${esc(chat.id)}"><strong>${esc(chat.name)}</strong><small>${esc(chat.preview || "Open text messages")}</small></button>`).join("") || '<div class="friends-empty"><p>No chats yet</p><small>Chats shared with you will appear here.</small></div>');
            else {
                content.innerHTML = `<div class="friends-tabs"><button type="button" data-parent-scope="school" aria-pressed="${scope === "school"}">School</button><button type="button" data-parent-scope="personal" aria-pressed="${scope === "personal"}">Personal</button></div>${response.items.map((item) => `<article class="empty-card"><strong>${esc(item.question_text || "Poll")}</strong><p>${esc(item.voted_for_name || item.contact_name || "")}</p>${reportButton("feed_item", item.question_answer_id)}</article>`).join("") || "<p>No feed items.</p>"}${response.next_timestamp && response.next_id ? '<button class="secondary-button" type="button" data-parent-feed-more>Older polls</button>' : ""}`;
                feedCursor = response.next_timestamp && response.next_id ? { before_ts: response.next_timestamp, before_id: String(response.next_id) } : null;
            }
            status.textContent = "";
        } catch (error) { if (current(generation)) { status.textContent = userMessage(error, "Couldn't load parent access. Try again."); content.innerHTML = '<button class="secondary-button" type="button" data-parent-retry>Try again</button>'; } }
    }
    async function messages(chatId, more = false) {
        const generation = ++epoch; activeChat = chatId; status.textContent = "Loading text messages…";
        try {
            const response = await call(`${endpoint()}/chats/${encodeURIComponent(chatId)}/messages${more && messageCursor ? `?before=${messageCursor}` : ""}`);
            if (!current(generation)) return;
            messageCursor = response.next_before;
            content.innerHTML = `<button class="secondary-button" type="button" data-parent-back>Back to chats</button>${response.messages.map((item) => `<article class="empty-card"><strong>${esc(item.sender)}</strong><p>${esc(item.body)}</p>${reportButton("chat_message", item.id)}</article>`).join("") || '<p>No visible text messages.</p>'}${messageCursor ? '<button class="secondary-button" type="button" data-parent-messages-more>Older text messages</button>' : ""}`;
            status.textContent = "Photos, videos and view-once media stay private in this view.";
        } catch (error) { if (current(generation)) { status.textContent = userMessage(error, "Couldn't load parent access. Try again."); content.innerHTML = '<button class="secondary-button" type="button" data-parent-back>Back to chats</button>'; } }
    }
    dialog.addEventListener("click", async (event) => {
        const button = event.target.closest("button"); if (!button || button.disabled) return;
        if (button.matches("[data-parent-options]")) { const options = dialog.querySelector(".parent-options"); options.classList.toggle("hidden"); button.setAttribute("aria-expanded", String(!options.classList.contains("hidden"))); return; }
        dialog.querySelector(".parent-options").classList.add("hidden");
        dialog.querySelector("[data-parent-options]").setAttribute("aria-expanded", "false");
        if (button.matches("[data-parent-refresh]")) return void children();
        if (button.matches("[data-parent-permission]")) { permission(); return; }
        if (button.dataset.parentPrivacy) { privacyPage = button.dataset.parentPrivacy; settings(); return; }
        if (button.matches("[data-parent-settings-back]")) { privacyPage = null; tab = "settings"; settings(); return; }
        if (button.matches("[data-parent-logout]")) {
            await call("/parent-access/logout", { method: "POST" }).catch(() => null); dialog.close(); return;
        }
        if (button.matches("[data-parent-children-retry]")) return void children();
        if (button.dataset.parentReport) {
            content.innerHTML = `<form data-parent-report-form><input type="hidden" name="kind" value="${esc(button.dataset.parentReport)}"><input type="hidden" name="item" value="${esc(button.dataset.parentItem)}"><label>Reason<select name="reason"><option value="bullying">Bullying or harassment</option><option value="sexual_content">Sexual content</option><option value="self_harm">Self-harm or safety</option><option value="hate">Hate</option><option value="spam">Spam</option><option value="other">Something else</option></select></label><label>Additional information<textarea name="note" maxlength="500"></textarea></label><button class="primary-button" type="submit">Submit safety report</button><button class="secondary-button" type="button" data-parent-back>Cancel</button></form>`;
            status.textContent = ""; return;
        }
        if (button.matches("[data-parent-notice]")) {
            const generation = ++epoch;
            try {
                const notice = await call(`/parent-links/notice?${new URLSearchParams({ name: child()?.first_name || "Your child" })}`);
                if (current(generation)) content.innerHTML = `<h3>${esc(notice.title || "What Valid collects")}</h3>${(notice.sections || []).map(section => `<section><h4>${esc(section.title)}</h4><p>${esc(section.body)}</p></section>`).join("")}<a href="https://validapp.lol/privacy-policy.html" target="_blank" rel="noopener">Privacy Policy</a><button class="secondary-button" type="button" data-parent-retry>Back to settings</button>`;
            } catch (error) { if (current(generation)) status.textContent = userMessage(error, "Couldn't load this notice. Try again."); }
            return;
        }
        if (button.matches("[data-parent-withdraw], [data-parent-unlink-answer]")) {
            if (working) return;
            const generation = epoch, selected = childId, base = endpoint(), withdraw = button.matches("[data-parent-withdraw]"), approve = button.dataset.parentUnlinkAnswer === "approve", deletion = !!dialog.querySelector("[data-parent-delete]")?.checked;
            const confirmed = await confirmSheet({ title: withdraw ? "Withdraw parent permission?" : approve ? "Approve unlinking?" : "Keep sharing?", message: withdraw ? `This pauses the account.${deletion ? " You also request deletion of the account and personal information, which cannot be undone." : ""}` : approve ? "Your access and privacy locks for this child will end." : "The unlink request clears and parent access continues.", confirmLabel: withdraw ? "Withdraw permission" : approve ? "Approve unlinking" : "Keep sharing", destructive: withdraw || approve });
            if (!confirmed || !current(generation) || selected !== childId) return;
            working = true; button.disabled = true;
            try {
                await write(`${base}/${withdraw ? "withdraw" : "unlink"}`, withdraw ? { request_deletion: deletion } : { approve });
                if (current(generation)) { tab = "settings"; await children(selected); if (withdraw && childId === selected) permission(); }
            } catch (error) { if (current(generation)) status.textContent = userMessage(error, "Couldn't update parent access. Refresh before trying again."); }
            finally { working = false; if (button.isConnected) button.disabled = false; }
            return;
        }
        if (button.dataset.parentTab) { privacyPage = null; tab = button.dataset.parentTab; activeChat = null; feedCursor = null; void load(); }
        if (button.dataset.parentScope) { scope = button.dataset.parentScope; feedCursor = null; void load(); }
        if (button.dataset.parentChat) void messages(button.dataset.parentChat);
        if (button.matches("[data-parent-messages-more]")) void messages(activeChat, true);
        if (button.matches("[data-parent-feed-more]")) void load();
        if (button.matches("[data-parent-back], [data-parent-retry]")) void load();
    });
    dialog.addEventListener("change", async (event) => {
        const input = event.target;
        if (!input.matches("[data-parent-setting]")) return;
        const key = input.dataset.parentSetting, selected = childId, row = child(), generation = epoch;
        if (working || row?.scope !== "contacts") return;
        const options = { school_contacts_only: ["friend-reach", "school_contacts_only"], message_requests_from_anyone: ["message-requests", "from_anyone"], activity_status_enabled: ["activity-status", "enabled"] };
        const [path, field] = options[key];
        working = true; dialog.querySelectorAll("[data-parent-setting]").forEach(control => { control.disabled = true; }); status.textContent = "Saving…";
        try {
            const result = await write(`${endpoint()}/${path}`, { [field]: input.type === "radio" ? input.value === "true" : input.checked }, "PUT");
            if (current(generation) && selected === childId) { row[key] = result[field]; settings(); }
        } catch (error) { if (current(generation)) { settings(); status.textContent = userMessage(error, "Couldn't save this setting. Try again."); } }
        finally { working = false; if (current(generation)) dialog.querySelectorAll("[data-parent-setting]").forEach(control => { control.disabled = false; }); }
    });
    dialog.addEventListener("submit", async (event) => {
        if (!event.target.matches("[data-parent-report-form]")) return;
        event.preventDefault(); if (working) return;
        const generation = epoch, fields = new FormData(event.target), button = event.target.querySelector("[type=submit]");
        working = true; button.disabled = true; status.textContent = "Sending report…";
        try {
            await write(`${endpoint()}/reports`, { kind: fields.get("kind"), item_id: fields.get("item"), reason: fields.get("reason"), note: fields.get("note") || null });
            if (current(generation)) { content.innerHTML = '<p>Report sent. Thank you for helping keep Valid safe.</p><button class="secondary-button" type="button" data-parent-back>Back</button>'; status.textContent = ""; }
        } catch (error) { if (current(generation)) status.textContent = userMessage(error, "Couldn't send this report. Try again."); }
        finally { working = false; if (button.isConnected) button.disabled = false; }
    });
    dialog.querySelector("select").addEventListener("change", (event) => { childId = event.target.value; privacyPage = null; feedCursor = null; messageCursor = null; void load(); });
    dialog.addEventListener("cancel", (event) => event.preventDefault());
    dialog.addEventListener("close", () => { closed = true; ++epoch; activeToken = null; content.replaceChildren(); dialog.remove(); onClose?.(); }, { once: true });
    document.body.append(dialog); dialog.showModal();
    function children(preferred = childId) {
      const generation = ++epoch;
      status.textContent = "Loading…"; content.replaceChildren();
      return call("/parent-access/children").then((result) => {
        if (!current(generation)) return;
        childRows = result.children;
        dialog.querySelector("select").innerHTML = result.children.map((child) => `<option value="${esc(child.user_id)}">${esc([child.first_name, child.last_name].filter(Boolean).join(" "))}</option>`).join("");
        childId = result.children.find(row => row.user_id === preferred)?.user_id || result.children[0]?.user_id;
        if (childId) {
            dialog.querySelector("select").value = childId;
            dialog.querySelector("select").hidden = childRows.length <= 1;
            dialog.querySelector("[data-parent-name]").textContent = `${child()?.first_name || "Your child"}'s Valid`;
            dialog.querySelector(".parent-child-avatar").textContent = (child()?.first_name || "?").slice(0, 1);
        }
        if (childId) void load(); else status.textContent = "No linked accounts are available.";
      }).catch((error) => { if (current(generation)) { status.textContent = userMessage(error, "Couldn't load parent access. Try again."); content.innerHTML = '<button class="secondary-button" type="button" data-parent-children-retry>Try again</button>'; } });
    }
    void children();
}
