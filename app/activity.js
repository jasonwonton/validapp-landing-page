import { uiIcon } from "./ui-icons.js";
import { userMessage } from "./user-message.js";
export function createActivityView({ api, getUser, getConfig, escapeHTML: esc, getInboxEntries, inboxLocked, navigate, onSummary }) {
    const dialog = document.createElement("dialog");
    dialog.className = "modal friends-dialog parity-page notifications-page";
    dialog.setAttribute("aria-label", "Notifications");
    document.body.append(dialog);
    let owner = null, epoch = 0, items = [], cursor = null, busy = false, error = "", visit = null, returnScreen = null, returnScroll = 0;
    const current = (id, generation) => owner === id && String(getUser()?.id) === id && epoch === generation;
    function render() {
        if (!dialog.open) return;
        const entries = getInboxEntries();
        const rows = [...entries.map((item, index) => ({ ...item, attr: `data-bell-entry="${index}"` })), ...items.map(item => ({ ...item, timestamp: item.latest_at || item.created_at, attr: `data-activity-id="${esc(item.id)}"` }))].sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
        dialog.innerHTML = `<header class="parity-page-header"><button class="parity-back" type="button" data-bell-close aria-label="Close notifications">‹</button><h2>Notifications</h2><div class="parity-header-actions"><button class="parity-icon-button" type="button" data-bell-inbox aria-label="Open Inbox">${uiIcon("newspaper")}</button></div></header><div class="notification-list parity-page-content" aria-busy="${busy}"><p class="parity-status" role="status">${esc(error || (busy ? "Loading notifications…" : ""))}</p>${error ? '<button class="secondary-button" type="button" data-bell-retry>Try again</button>' : ""}
            ${rows.map(item => `<button class="notification-card" type="button" ${item.attr}><span class="notification-avatar" aria-hidden="true">${uiIcon(item.destination?.route?.startsWith("ask") ? "chat-pair-filled" : item.destination?.route === "poll" ? "heart" : item.destination?.route === "friends" ? "person-add" : "bell-badge")}</span><span class="notification-copy"><strong>${esc(item.text)}</strong>${item.detail ? `<span>${esc(item.detail)}</span>` : ""}${item.timestamp ? `<small>${esc(relativeTime(item.timestamp))}</small>` : ""}</span>${item.unread ? '<i class="notification-dot" aria-label="Unread"></i>' : ""}</button>`).join("")}
            ${!busy && !rows.length ? '<div class="friends-empty"><h3>No notifications yet</h3><p>Votes, TBHs, Ask Me and reactions show up here.</p></div>' : ""}${cursor ? '<button class="secondary-button" type="button" data-bell-more>Load older notifications</button>' : ""}</div>`;
    }
    function relativeTime(value) {
        const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
        if (!Number.isFinite(seconds)) return "";
        return seconds < 60 ? "Just now" : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`;
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
    function clear() { ++epoch; owner = null; items = []; cursor = null; visit = null; returnScreen = null; if (dialog.open) dialog.close(); dialog.replaceChildren(); }
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
        if (destination) { const id = owner; returnScroll = dialog.querySelector(".notification-list")?.scrollTop || 0; dialog.close(); const screen = await navigate(destination); if (owner === id && String(getUser()?.id) === id) returnScreen = screen || null; }
    });
    window.addEventListener("focus", () => { if (dialog.open) void load(); else void summary(); });
    window.addEventListener("online", () => { if (dialog.open) void load(); else void summary(); });
    return { open, clear, summary, returnFromDetail(screen) {
        if (returnScreen !== screen) return;
        returnScreen = null;
        if (owner && String(getUser()?.id) === owner && !document.querySelector(".detail-screen:not(.hidden)")) { dialog.showModal(); dialog.querySelector(".notification-list").scrollTop = returnScroll; }
    } };
}
