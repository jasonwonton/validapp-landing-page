import { userMessage } from "./user-message.js";
export function createActivityView({ api, getUser, getConfig, escapeHTML: esc, getInboxEntries, inboxLocked, navigate, onSummary }) {
    const dialog = document.createElement("dialog");
    dialog.className = "modal friends-dialog";
    dialog.setAttribute("aria-label", "Notifications");
    document.body.append(dialog);
    let owner = null, epoch = 0, items = [], cursor = null, busy = false, error = "", visit = null;
    const current = (id, generation) => owner === id && String(getUser()?.id) === id && epoch === generation;
    function render() {
        if (!dialog.open) return;
        const entries = getInboxEntries();
        dialog.innerHTML = `<div class="modal-heading"><h2>Notifications</h2><button class="icon-button" type="button" data-bell-close aria-label="Close notifications">×</button></div>
            <div class="friends-tabs"><button type="button" data-bell-inbox>Open Inbox</button><button type="button" data-bell-asks>Ask Me</button>${getConfig()?.friends_enabled === true ? '<button type="button" data-bell-friends>Friend requests</button>' : ""}</div>
            <p role="status">${esc(error || (busy ? "Loading notifications…" : ""))}</p>${error ? '<button class="secondary-button" type="button" data-bell-retry>Try again</button>' : ""}
            <div class="notification-list" aria-busy="${busy}">${entries.map((item, index) => `<button class="notification-row" type="button" data-bell-entry="${index}"><strong>${esc(item.text)}</strong><small>${esc(item.detail || "")}</small></button>`).join("")}
            ${items.map((item) => `<button class="notification-row" type="button" data-activity-id="${item.id}"><strong>${item.unread ? "● " : ""}${esc(item.text)}</strong>${item.detail ? `<small>${esc(item.detail)}</small>` : ""}</button>`).join("")}
            ${!busy && !items.length && !entries.length ? '<div class="empty-card">No notifications yet.</div>' : ""}</div>
            ${cursor ? '<button class="secondary-button" type="button" data-bell-more>Load older notifications</button>' : ""}`;
    }
    async function summary() {
        if (!getUser()?.id || getConfig()?.activity_log_enabled !== true) return;
        const id = String(getUser().id), generation = epoch;
        try { const result = await api.getActivitySummary(id); if (String(getUser()?.id) === id && epoch === generation) onSummary(result); } catch { /* The next visit or foreground repairs badges. */ }
    }
    async function load(more = false) {
        const id = owner, generation = ++epoch;
        busy = true; error = ""; render();
        try {
            const page = getConfig()?.activity_log_enabled === true ? await api.getActivity(id, more ? cursor : "") : { items: [], next_cursor: null };
            if (!current(id, generation)) return;
            const dedup = new Map([...(more ? items : []), ...page.items].map((item) => [String(item.id), item]));
            items = [...dedup.values()].slice(-200); cursor = page.next_cursor;
            // Only mark rows actually fetched for this visit. Keep their dots
            // during the visit; a later open gets the authoritative read state.
            if (getConfig()?.activity_log_enabled === true) {
                const result = await api.markActivityRead(id, { ids: page.items.filter((item) => item.unread).map((item) => item.id), ...(!inboxLocked() && visit ? { inbox_read_through: visit } : {}) });
                if (!current(id, generation)) return;
                onSummary(result);
            }
        } catch (failure) { if (current(id, generation)) error = userMessage(failure, "Couldn't load notifications."); }
        finally { if (current(id, generation)) { busy = false; render(); } }
    }
    async function open() {
        const id = getUser()?.id;
        if (!id) return;
        if (owner !== String(id)) clear();
        owner = String(id); visit = new Date().toISOString();
        if (!dialog.open) dialog.showModal();
        render(); await load();
    }
    function clear() { ++epoch; owner = null; items = []; cursor = null; visit = null; if (dialog.open) dialog.close(); dialog.replaceChildren(); }
    dialog.addEventListener("click", async (event) => {
        const button = event.target.closest("button");
        if (!button || button.disabled) return;
        if (button.matches("[data-bell-close]")) return dialog.close();
        if (button.matches("[data-bell-retry]")) return void load();
        if (button.matches("[data-bell-more]")) return void load(true);
        let destination;
        if (button.matches("[data-bell-inbox]")) destination = { route: "inbox" };
        if (button.matches("[data-bell-asks]")) destination = { route: "inbox", filter: "ask_me" };
        if (button.matches("[data-bell-friends]")) destination = { route: "friends" };
        if (button.dataset.bellEntry != null) destination = getInboxEntries()[Number(button.dataset.bellEntry)]?.destination;
        if (button.dataset.activityId) destination = items.find((item) => String(item.id) === button.dataset.activityId)?.destination;
        if (destination) { dialog.close(); await navigate(destination); }
    });
    window.addEventListener("focus", () => { if (dialog.open) void load(); else void summary(); });
    window.addEventListener("online", () => { if (dialog.open) void load(); else void summary(); });
    return { open, clear, summary };
}
