// The notification soft prompt, ported from iOS NotificationSoftPromptView and
// NotificationSettingsPromptView (shown after a poll set in PlayCongratsView,
// and during onboarding). It asks in Valid's own words before the browser's
// one-shot permission prompt, so a "Not now" never burns that prompt.
//
//   import { askForNotifications } from "./notification-soft-prompt.js";
//   const result = await askForNotifications({ reason: "play_congrats" });
//   // "granted" | "denied" | "dismissed" | "unsupported"
//
// app.js connects the app's existing Web Push enable path once, with
// configureNotificationSoftPrompt(bridge):
//   permission() -> "default" | "denied" | "granted" | "unsupported"
//   enable() -> Promise<{ permission, prompted, subscribed }>; called
//     synchronously inside the Allow tap (it asks the browser first).
//   ensureSubscribed?(source) -> quiet re-subscribe when already granted.
//   record?(action, source) -> fire-and-forget analytics.
//
// The web has no Settings deep link, so a blocked browser gets the iOS
// "Open Settings" prompt's copy with the browser's own steps instead.

export const SOFT_PROMPT_COPY = Object.freeze({
    title: "Get notified when people vote on you?",
    message: "Find out when your classmates pick you in polls!",
    allow: "Allow",
    decline: "Not now",
    settingsTitle: "Get notified when someone votes on you?",
    settingsMessage: "You previously turned off notifications. Enable them in your browser settings to find out when classmates pick you!",
    settingsDone: "Got it",
    settingsSkip: "Maybe later",
});

// iOS shouldShowSettingsPrompt: after a decline or skip, the blocked
// variant waits a day before asking again.
export const SETTINGS_PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DECLINED_KEY = "valid:notification-soft-prompt:declined-at";

const BROWSER_STEPS = [
    ["Chrome on Android", "Tap the lock icon next to the address, then <strong>Permissions</strong> → <strong>Notifications</strong> → <strong>Allow</strong>."],
    ["Installed Valid app", "Long-press the Valid icon, tap <strong>App info</strong> → <strong>Notifications</strong>, and turn them on."],
    ["iPhone Home Screen app", "Open <strong>Settings</strong> → <strong>Notifications</strong> → <strong>Valid</strong>, and turn on <strong>Allow Notifications</strong>."],
    ["On a computer", "Click the icon left of the address bar, then set <strong>Notifications</strong> to <strong>Allow</strong>."],
];

let bridge = null;
let open = null;

export function configureNotificationSoftPrompt(next) {
    bridge = next || null;
}

function permission() {
    try {
        const value = bridge?.permission?.();
        return ["default", "denied", "granted"].includes(value) ? value : "unsupported";
    } catch (_) {
        return "unsupported";
    }
}

function record(action) {
    // iOS records the Play soft prompt with no surface; the API accepts only
    // its listed sources, so none is sent here.
    try { void bridge?.record?.(action, null)?.catch?.(() => null); } catch (_) { /* Analytics never block. */ }
}

function readDeclinedAt() {
    try { return Number(localStorage.getItem(DECLINED_KEY)) || 0; } catch (_) { return 0; }
}

function writeDeclinedAt(now = Date.now()) {
    try { localStorage.setItem(DECLINED_KEY, String(now)); } catch (_) { /* The prompt may come back sooner; nothing else depends on it. */ }
}

export function settingsPromptDue(now = Date.now()) {
    const elapsed = now - readDeclinedAt();
    // A clock set backwards must not hide the prompt for longer than the cooldown.
    return elapsed < 0 || elapsed >= SETTINGS_PROMPT_COOLDOWN_MS;
}

function bellMarkup() {
    return '<img class="notification-soft-prompt-bell" src="../assets/app/notification-bell.webp" alt="" width="120" height="120" decoding="async">';
}

function presentSheet({ blocked, onAllow, onDecline }) {
    const dialog = document.createElement("dialog");
    dialog.className = `ui-sheet notification-soft-prompt${blocked ? " blocked" : ""}`;
    dialog.setAttribute("aria-labelledby", "notificationSoftPromptTitle");
    dialog.dataset.testid = blocked ? "notificationSoftPrompt.settings" : "notificationSoftPrompt";
    const copy = SOFT_PROMPT_COPY;
    dialog.innerHTML = blocked
        ? `<div class="ui-sheet-content notification-soft-prompt-content">
            <span class="ui-sheet-grabber" aria-hidden="true"></span>
            <h2 id="notificationSoftPromptTitle">${copy.settingsTitle}</h2>
            ${bellMarkup()}
            <p class="notification-soft-prompt-message">${copy.settingsMessage}</p>
            <ol class="notification-soft-prompt-steps">${BROWSER_STEPS.map(([label, text]) => `<li><strong>${label}</strong><span>${text}</span></li>`).join("")}</ol>
            <div class="notification-soft-prompt-stack">
                <button class="primary-button" type="button" data-soft-prompt-allow>${copy.settingsDone}</button>
                <button class="notification-soft-prompt-later" type="button" data-soft-prompt-decline>${copy.settingsSkip}</button>
            </div>
        </div>`
        : `<div class="ui-sheet-content notification-soft-prompt-content">
            <span class="ui-sheet-grabber" aria-hidden="true"></span>
            <h2 id="notificationSoftPromptTitle">${copy.title}</h2>
            ${bellMarkup()}
            <p class="notification-soft-prompt-message">${copy.message}</p>
            <div class="notification-soft-prompt-actions">
                <button class="notification-soft-prompt-decline" type="button" data-soft-prompt-decline>${copy.decline}</button>
                <button class="notification-soft-prompt-allow" type="button" data-soft-prompt-allow>${copy.allow}</button>
            </div>
        </div>`;
    const allow = dialog.querySelector("[data-soft-prompt-allow]");
    const decline = dialog.querySelector("[data-soft-prompt-decline]");
    allow.addEventListener("click", () => onAllow(dialog));
    decline.addEventListener("click", () => onDecline(dialog));
    // Escape and a backdrop tap count as "Not now", like dragging the iOS sheet away.
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); onDecline(dialog); });
    dialog.addEventListener("click", (event) => {
        if (event.target !== dialog) return;
        const box = dialog.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onDecline(dialog);
    });
    document.body.append(dialog);
    dialog.showModal();
    allow.focus({ preventScroll: true });
    return dialog;
}

/**
 * Ask for notifications the iOS way. Resolves once the person has answered:
 *   "granted"     notifications are on (or already were);
 *   "denied"      the browser blocks them (asked now, or blocked before);
 *   "dismissed"   "Not now", or the browser prompt was closed unanswered;
 *   "unsupported" this browser has no Web Push here (nothing is shown).
 * Only one prompt shows at a time; a second call shares the first answer.
 */
export function askForNotifications({ reason = "play" } = {}) {
    if (open) return open;
    const current = permission();
    if (current === "unsupported") return Promise.resolve("unsupported");
    if (current === "granted") {
        // iOS .alreadyEnabled: make sure this browser is still subscribed.
        try { void bridge?.ensureSubscribed?.(reason)?.catch?.(() => null); } catch (_) { /* Quiet by design. */ }
        return Promise.resolve("granted");
    }
    if (current === "denied" && !settingsPromptDue()) return Promise.resolve("denied");
    const blocked = current === "denied";
    open = new Promise((resolve) => {
        let settled = false;
        const finish = (dialog, result) => {
            if (settled) return;
            settled = true;
            dialog.close();
            dialog.remove();
            resolve(result);
        };
        presentSheet({
            blocked,
            onAllow(dialog) {
                if (blocked) {
                    writeDeclinedAt();
                    finish(dialog, "denied");
                    return;
                }
                record("soft_accepted");
                let pending;
                try {
                    // The browser is asked inside this tap, before anything awaits.
                    pending = bridge.enable();
                } catch (_) {
                    finish(dialog, "dismissed");
                    return;
                }
                dialog.querySelectorAll("button").forEach((button) => { button.disabled = true; });
                Promise.resolve(pending).then((result) => {
                    const answer = result?.permission;
                    if (result?.prompted && answer === "granted") record("official_accepted");
                    if (result?.prompted && answer === "denied") record("official_declined");
                    finish(dialog, answer === "granted" ? "granted" : answer === "denied" ? "denied" : "dismissed");
                }, () => finish(dialog, "dismissed"));
            },
            onDecline(dialog) {
                if (dialog.querySelector("button:disabled")) return;
                writeDeclinedAt();
                if (!blocked) record("soft_declined");
                finish(dialog, blocked ? "denied" : "dismissed");
            },
        });
        if (!blocked) record("soft_shown");
    }).finally(() => { open = null; });
    return open;
}
