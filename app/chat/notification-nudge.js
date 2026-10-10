// The "Don't miss their reply" card, ported from iOS
// (ChatNotificationNudgePolicy and ChatNotificationNudgeCard in
// NotificationsPermissionView.swift, ChatRoomView+Notifications.swift and
// ChatsTabView.swift). It shows whenever notifications are not allowed:
//   - in a room on every open and after a confirmed send; "Not now" hides it
//     in every room for a day, per account, with no cap on returns;
//   - at the top of the chats list with no "Not now" (no snooze).
// The web has no Settings deep link, so a blocked browser gets "How to turn
// on" steps instead of iOS's "Open Settings", and its "Not now" lasts a week.
import { uiIcon } from "../ui-icons.js";

export const NUDGE_SNOOZE_MS = 24 * 60 * 60 * 1000;
export const BLOCKED_NUDGE_SNOOZE_MS = 7 * NUDGE_SNOOZE_MS;
export const NUDGE_SOURCES = Object.freeze({
    conversation: "web_chat_conversation",
    inbox: "web_chat_inbox",
});
const BODY = "Get notified about new messages and view-once photos. You can mute any chat.";
const BLOCKED_BODY = "Allow notifications for Valid in your browser settings to get new messages and view-once photos.";

const declinedKey = (userId) => `valid:chat-notification-nudge:declined:${userId}`;

/**
 * Which card a placement shows, or null.
 * permission: "default" | "denied" | "granted" | "unsupported".
 * declined: { at, blocked } from the last room "Not now", or null.
 */
export function nudgeKind({ permission, placement, declined = null, now = Date.now() }) {
    if (permission !== "default" && permission !== "denied") return null;
    const kind = permission === "denied" ? "blocked" : "ask";
    if (placement !== "conversation" || !declined) return kind;
    const elapsed = now - Number(declined.at || 0);
    const snooze = declined.blocked ? BLOCKED_NUDGE_SNOOZE_MS : NUDGE_SNOOZE_MS;
    // A clock set backwards must not hide the card for longer than the snooze.
    return elapsed < 0 || elapsed >= snooze ? kind : null;
}

export function readNudgeDecline(userId, storage = null) {
    if (!userId) return null;
    try {
        // Reading localStorage itself can throw (blocked site data).
        const store = storage || globalThis.localStorage;
        const value = JSON.parse(store?.getItem(declinedKey(userId)) || "null");
        return Number.isFinite(value?.at) ? { at: value.at, blocked: value.blocked === true } : null;
    } catch (_) {
        return null;
    }
}

export function recordNudgeDecline(userId, { blocked = false, now = Date.now(), storage = null } = {}) {
    if (!userId) return;
    try {
        (storage || globalThis.localStorage)?.setItem(declinedKey(userId), JSON.stringify({ at: now, blocked }));
    } catch (_) { /* The card comes back on the next open; nothing else depends on it. */ }
}

export function nudgeCardMarkup({ placement, kind }) {
    const blocked = kind === "blocked";
    const title = blocked
        ? "Notifications are blocked"
        : placement === "inbox" ? "Don’t miss new messages" : "Don’t miss their reply";
    const primary = blocked ? "How to turn on" : "Notify me";
    // iOS: the inbox card can't be dismissed.
    const dismiss = placement === "conversation"
        ? '<button class="chat-notification-nudge-dismiss" type="button" data-nudge-not-now data-testid="chat.notificationNudge.notNow">Not now</button>'
        : "";
    return `<section class="chat-notification-nudge" data-testid="chat.notificationNudge" data-placement="${placement}" data-kind="${kind}" aria-labelledby="chatNotificationNudgeTitle-${placement}">
        <div class="chat-notification-nudge-row">
            <span class="chat-notification-nudge-icon" aria-hidden="true">${uiIcon("bell-badge")}</span>
            <span class="chat-notification-nudge-copy"><strong id="chatNotificationNudgeTitle-${placement}">${title}</strong><small>${blocked ? BLOCKED_BODY : BODY}</small></span>
        </div>
        <div class="chat-notification-nudge-actions">
            <button class="chat-notification-nudge-primary" type="button" data-nudge-primary data-testid="chat.notificationNudge.primary">${primary}</button>${dismiss}
        </div>
    </section>`;
}

const HELP_STEPS = [
    ["Chrome on Android", "Tap the lock icon next to the address, then <strong>Permissions</strong> → <strong>Notifications</strong> → <strong>Allow</strong>."],
    ["Installed Valid app", "Long-press the Valid icon, tap <strong>App info</strong> → <strong>Notifications</strong>, and turn them on."],
    ["On a computer", "Click the icon left of the address bar, then set <strong>Notifications</strong> to <strong>Allow</strong>."],
];

export function openNotificationHelpSheet({ onClose } = {}) {
    document.querySelector(".chat-notification-help-sheet")?.remove();
    const dialog = document.createElement("dialog");
    dialog.className = "ui-sheet chat-notification-help-sheet";
    dialog.setAttribute("aria-labelledby", "chatNotificationHelpTitle");
    dialog.dataset.testid = "chat.notificationNudge.help";
    dialog.innerHTML = `<form method="dialog" class="ui-sheet-content">
        <span class="ui-sheet-grabber" aria-hidden="true"></span>
        <h2 id="chatNotificationHelpTitle">Turn on notifications</h2>
        <p class="ui-sheet-message">Your browser is blocking notifications from Valid. Allow them to hear about new messages.</p>
        <ol class="chat-notification-help-steps">
            ${HELP_STEPS.map(([label, text]) => `<li><strong>${label}</strong><span>${text}</span></li>`).join("")}
        </ol>
        <p class="ui-sheet-fineprint">Then come back to Valid. Notifications turn on by themselves.</p>
        <div class="ui-sheet-actions"><button class="primary-button" type="submit">Got it</button></div>
    </form>`;
    dialog.addEventListener("click", (event) => {
        if (event.target !== dialog) return;
        const box = dialog.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    });
    dialog.addEventListener("close", () => {
        dialog.remove();
        onClose?.();
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector("button[type=submit]").focus({ preventScroll: true });
    return dialog;
}

/**
 * Owns the two card slots. `notifications` comes from app.js:
 *   permission() -> "default" | "denied" | "granted" | "unsupported"
 *   enable() -> Promise<{ permission, prompted, subscribed, error }>; must be
 *     called synchronously from the tap (it asks the browser first).
 *   ensureSubscribed(source) -> quiet re-subscribe when already granted.
 *   record(action, source) -> fire-and-forget analytics.
 */
export function createNotificationNudge({ notifications, getUserId, slots, showToast }) {
    const shownThisLoad = new Set();
    const visible = { conversation: null, inbox: null };
    const active = { conversation: false, inbox: false };
    let enabling = false;

    const permission = () => {
        try { return notifications?.permission?.() || "unsupported"; } catch (_) { return "unsupported"; }
    };
    const record = (action, placement) => {
        try { void notifications?.record?.(action, NUDGE_SOURCES[placement])?.catch?.(() => null); } catch (_) { /* Analytics never block. */ }
    };

    // `force` redraws an unchanged card (a room open shows it afresh).
    function render(placement, { force = false } = {}) {
        const slot = slots[placement]?.();
        if (!slot) return;
        const kind = active[placement]
            ? nudgeKind({ permission: permission(), placement, declined: readNudgeDecline(getUserId()) })
            : null;
        if (kind === visible[placement] && !force) return;
        visible[placement] = kind;
        if (!kind) {
            slot.replaceChildren();
            slot.hidden = true;
            return;
        }
        slot.innerHTML = nudgeCardMarkup({ placement, kind });
        slot.hidden = false;
        // Once per page load per placement: the card shows on every room
        // open, which is not one request each.
        if (!shownThisLoad.has(placement)) {
            shownThisLoad.add(placement);
            record("soft_shown", placement);
        }
    }

    function accept(placement) {
        record("soft_accepted", placement);
        if (visible[placement] === "blocked") {
            openNotificationHelpSheet();
            return;
        }
        if (enabling) return;
        let pending;
        try {
            // Asks the browser inside this tap, before anything awaits.
            pending = notifications.enable();
        } catch (_) {
            return;
        }
        enabling = true;
        // The card stays while the browser asks; a dismissed prompt leaves it.
        for (const slotPlacement of Object.keys(visible)) {
            slots[slotPlacement]?.()?.querySelectorAll("button").forEach((button) => { button.disabled = true; });
        }
        Promise.resolve(pending).then((result) => {
            if (result?.prompted && result.permission === "granted") record("official_accepted", placement);
            if (result?.prompted && result.permission === "denied") record("official_declined", placement);
            if (result?.subscribed) showToast?.("Notifications on");
            else if (result?.permission === "granted" && result.error) showToast?.("Could not finish notification setup.");
        }).catch(() => null).finally(() => {
            enabling = false;
            renderAll({ force: true });
        });
    }

    function decline(placement) {
        if (placement !== "conversation") return;
        recordNudgeDecline(getUserId(), { blocked: visible[placement] === "blocked" });
        record("soft_declined", placement);
        renderAll();
    }

    function bind(placement) {
        const slot = slots[placement]?.();
        if (!slot || slot.dataset.nudgeBound) return;
        slot.dataset.nudgeBound = "1";
        slot.hidden = true;
        // Not delegated through a listener that awaits: enable() must run in the tap.
        slot.addEventListener("click", (event) => {
            if (event.target.closest("[data-nudge-primary]")) accept(placement);
            else if (event.target.closest("[data-nudge-not-now]")) decline(placement);
        });
    }

    function renderAll(options) {
        render("conversation", options);
        render("inbox", options);
    }

    return {
        bind() { bind("conversation"); bind("inbox"); },
        /** A room opened (or a send was confirmed in it). */
        roomShown() {
            active.conversation = true;
            render("conversation", { force: true });
            void notifications?.ensureSubscribed?.(NUDGE_SOURCES.conversation);
        },
        roomHidden() {
            active.conversation = false;
            render("conversation");
        },
        sendConfirmed() {
            if (active.conversation) render("conversation");
        },
        setInboxVisible(isVisible) {
            active.inbox = isVisible;
            render("inbox");
        },
        /** Permission or subscription changed (focus, settings, another tab). */
        refresh: () => renderAll(),
    };
}
