// Memories and the Vault (iOS Views/Vault/VaultView.swift, VaultPinViews.swift,
// Services/Vault/VaultStore.swift, VaultLock.swift). Loaded on demand from the
// Profile tab, never part of the startup shell.
//
// Memories holds everything saved and every posted Story, with no lock. The
// Vault holds what was moved out of Memories, behind a 4-digit PIN stored on
// the server. A correct PIN buys a 15-minute unlock token that lives only in
// this module's memory and is dropped when the Vault tab or the screen is
// left or the page is hidden. The web has no Face ID: the PIN is the only key.
import { uiIcon } from "../ui-icons.js";
import { mediaImageMarkup } from "../media-url.js";
import { showToast } from "../toast.js";
import { userMessage } from "../user-message.js";
import { setRuntimeStyles } from "../runtime-style.js";
import { reconcileKeyedElements } from "../keyed-list.js";
import { confirmSheet } from "../ui-dialogs.js";
import { vaultClient } from "./api.js";

const cssURL = new URL("./styles.css", import.meta.url).href;
const PAGE_SIZE = 36;
const MAX_PAGE_SIZE = 100;
const PIN_LENGTH = 4;
const MAX_ATTEMPTS = 5;
const UNLOCK_MS = 15 * 60_000;
const ENTRY_REFRESH_MS = 60_000;
const URL_RENEW_COOLDOWN_MS = 15_000;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "delete"];

const svg = (body, extra = "") => `<svg class="vault-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;
const ICONS = {
    lock: svg('<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" fill="currentColor" stroke="none"/><path d="M7.5 10.5V7.5a4.5 4.5 0 0 1 9 0v3"/>'),
    lockOpen: svg('<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" fill="currentColor" stroke="none"/><path d="M7.5 10.5V7.5a4.5 4.5 0 0 1 8.7-1.6"/>'),
    lockOutline: svg('<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M7.5 10.5V7.5a4.5 4.5 0 0 1 8.7-1.6"/>'),
    stack: svg('<rect x="3" y="7" width="14" height="14" rx="2.5"/><path d="M7 3.5h11.5A2.5 2.5 0 0 1 21 6v11.5"/><path d="m3 17 4-4 3 3 2-2 5 5"/>'),
    refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
    download: svg('<path d="M12 3v12m-5-5 5 5 5-5M5 21h14"/>'),
    backspace: svg('<path d="M21 5H9l-6 7 6 7h12Z"/><path d="m12 9 6 6m0-6-6 6"/>'),
    story: svg('<circle cx="12" cy="12" r="9" stroke-dasharray="3.2 2.4"/><circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>'),
    playFill: svg('<path d="M7 4.5v15l12-7.5Z" fill="currentColor" stroke="none"/>'),
    chevronLeft: svg('<path d="m15 5-7 7 7 7"/>'),
    chevronRight: svg('<path d="m9 5 7 7-7 7"/>'),
    muted: svg('<path d="M4 9h4l5-4v14l-5-4H4Z"/><path d="m17 9 5 6m0-6-5 6"/>'),
};

let stylesPromise = null;
function ensureStyles() {
    if (!stylesPromise) {
        stylesPromise = new Promise((resolve) => {
            const existing = document.querySelector("link[data-vault-css]");
            if (existing) return resolve();
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = cssURL;
            link.dataset.vaultCss = "";
            link.addEventListener("load", () => resolve(), { once: true });
            link.addEventListener("error", () => resolve(), { once: true });
            document.head.append(link);
        });
    }
    return stylesPromise;
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
}

function errorCode(error) {
    const detail = error?.detail;
    return detail && typeof detail === "object" && !Array.isArray(detail) ? detail.code || null : null;
}

const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const dayFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function capturedDate(item) {
    const date = new Date(item?.captured_at);
    return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function durationLabel(ms) {
    const seconds = Math.max(1, Math.round(Number(ms) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function relativeTime(date) {
    const seconds = Math.max(1, Math.round((date.getTime() - Date.now()) / 1000));
    const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    if (seconds < 60) return format.format(seconds, "second");
    const minutes = Math.round(seconds / 60);
    if (minutes < 90) return format.format(minutes, "minute");
    return format.format(Math.round(minutes / 60), "hour");
}

function lockoutMessage(until) {
    const date = until ? new Date(until) : null;
    if (!date || Number.isNaN(date.getTime())) return "Too many tries. Try again later.";
    return `Too many tries. Try again ${relativeTime(date)}.`;
}

function wrongPinMessage(remaining) {
    return remaining === 1 ? "Wrong PIN. 1 try left." : `Wrong PIN. ${remaining} tries left.`;
}

function reducedMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function fileStamp(item) {
    const date = capturedDate(item);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function extensionFor(type) {
    if (/png/.test(type)) return "png";
    if (/webp/.test(type)) return "webp";
    if (/svg/.test(type)) return "svg";
    if (/quicktime/.test(type)) return "mov";
    if (/video/.test(type)) return "mp4";
    return "jpg";
}

async function mediaBlob(url) {
    if (String(url).startsWith("data:")) {
        const [header, body = ""] = String(url).split(",", 2);
        const type = header.slice(5).split(";")[0] || "application/octet-stream";
        if (/;base64/i.test(header)) {
            const binary = atob(body);
            return new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))], { type });
        }
        return new Blob([decodeURIComponent(body)], { type });
    }
    const response = await fetch(url, { credentials: "omit", cache: "no-store" });
    if (!response.ok) {
        const error = new Error("Couldn’t download this. Please try again.");
        error.status = response.status;
        throw error;
    }
    return response.blob();
}

// Captions were placed on a full-screen preview; draw them the same way
// (white on a dark pill) so the saved photo matches what the viewer shows.
async function withCaptions(file, overlays) {
    if (!overlays?.length || typeof createImageBitmap !== "function" || /svg/.test(file.type)) return file;
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const size = Math.max(14, Math.round(canvas.width * 0.045));
    context.font = `800 ${size}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (const overlay of overlays) {
        const text = String(overlay.text || "").trim();
        if (!text) continue;
        const x = Number(overlay.x ?? 0.5) * canvas.width;
        const y = Number(overlay.y ?? 0.5) * canvas.height;
        const width = Math.min(canvas.width * 0.84, context.measureText(text).width + size);
        const height = size * 1.6;
        context.fillStyle = "rgba(5,9,20,.64)";
        context.beginPath();
        context.roundRect?.(x - width / 2, y - height / 2, width, height, size * 0.45);
        if (!context.roundRect) context.rect(x - width / 2, y - height / 2, width, height);
        context.fill();
        context.fillStyle = "#fff";
        context.fillText(text, x, y, canvas.width * 0.84 - size);
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : file;
}

function downloadFile(file) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function createStore(scope) {
    return { scope, items: [], total: null, cursor: null, loading: null, loaded: false, error: "", fetchedAt: 0, generation: 0, renewedAt: 0 };
}

export function createVault(context) {
    const { getUser, openDetailScreen, closeDetailScreen, mount } = context;
    const api = vaultClient(context.api);
    const haptic = (kind) => context.haptic?.(kind);
    const stores = { memories: createStore("memories"), private: createStore("private") };
    const lock = { status: null, statusError: "", statusLoading: null, token: null, expiresAt: 0, timer: 0, busy: false, lockoutTimer: 0 };
    const ui = {
        userId: null, screen: null, open: false, tab: "memories", entry: null, gatePad: null,
        viewer: null, pinFlow: null, gateMessage: "", gateError: false, saving: false, savedId: null,
        moving: false, muted: false, observer: null, returnFocus: null,
    };

    // MARK: Identity

    function userId() {
        const id = getUser()?.id || null;
        if (id !== ui.userId) {
            ui.userId = id;
            stores.memories = createStore("memories");
            stores.private = createStore("private");
            Object.assign(lock, { status: null, statusError: "", statusLoading: null, token: null, expiresAt: 0 });
            clearTimeout(lock.timer);
        }
        return id;
    }

    // MARK: Lock

    const unlockToken = () => (lock.token && lock.expiresAt > Date.now() ? lock.token : null);
    const hasPin = () => lock.status?.has_pin === true;
    // Unknown status counts as locked so nothing flashes before the server answers.
    const allowsAccess = () => Boolean(lock.status) && (!hasPin() || Boolean(unlockToken()));
    const lockedOutUntil = () => {
        const until = lock.status?.locked_until ? new Date(lock.status.locked_until) : null;
        return until && until.getTime() > Date.now() ? until : null;
    };

    function clearStore(store) {
        Object.assign(store, createStore(store.scope), { generation: store.generation + 1 });
    }

    function lockNow() {
        const wasUnlocked = Boolean(lock.token);
        lock.token = null;
        lock.expiresAt = 0;
        clearTimeout(lock.timer);
        clearStore(stores.private);
        ui.gateMessage = "";
        ui.gateError = false;
        if (ui.viewer?.scope === "private") closeViewer({ restoreFocus: false });
        if (ui.open && (wasUnlocked || ui.tab === "vault")) render();
    }

    function acceptUnlock(result) {
        lock.token = result?.unlock_token || null;
        const serverExpiry = Date.parse(result?.expires_at || "");
        // Trust the shorter of the server's expiry and 15 minutes from now, so a
        // skewed clock can only lock early, never keep a stale token.
        const localExpiry = Date.now() + UNLOCK_MS - 5_000;
        lock.expiresAt = Number.isFinite(serverExpiry) && serverExpiry > Date.now() ? Math.min(serverExpiry, localExpiry) : localExpiry;
        lock.status = { has_pin: true, locked_until: null, remaining_attempts: MAX_ATTEMPTS };
        clearTimeout(lock.timer);
        lock.timer = setTimeout(lockNow, Math.max(1_000, lock.expiresAt - Date.now()));
    }

    function recordPinError(error) {
        const code = errorCode(error);
        const detail = error?.detail || {};
        if (code === "vault_pin_incorrect") {
            lock.status = { has_pin: true, locked_until: null, remaining_attempts: Number(detail.remaining_attempts ?? lock.status?.remaining_attempts ?? MAX_ATTEMPTS) };
        } else if (code === "vault_pin_locked") {
            lock.status = { has_pin: true, locked_until: detail.locked_until || null, remaining_attempts: 0 };
            scheduleLockoutEnd();
        } else if (code === "vault_pin_not_set") {
            lock.status = { has_pin: false, locked_until: null, remaining_attempts: MAX_ATTEMPTS };
        }
    }

    function pinErrorMessage(error) {
        const code = errorCode(error);
        if (code === "vault_pin_incorrect" && Number.isFinite(Number(error.detail?.remaining_attempts))
            && !/current PIN/i.test(error.detail?.message || "")) {
            return wrongPinMessage(Number(error.detail.remaining_attempts));
        }
        if (code === "vault_pin_locked") return lockoutMessage(error.detail?.locked_until);
        return userMessage(error, "Something went wrong. Please try again.");
    }

    function scheduleLockoutEnd() {
        clearTimeout(lock.lockoutTimer);
        const until = lockedOutUntil();
        if (!until) return;
        lock.lockoutTimer = setTimeout(() => {
            void refreshStatus().then(render);
        }, Math.min(2 ** 31 - 1, until.getTime() - Date.now() + 500));
    }

    /** The server said a request needed an unlock it didn't have. */
    function handleServerLocked() {
        if (!hasPin()) lock.status = { has_pin: true, locked_until: null, remaining_attempts: MAX_ATTEMPTS };
        lockNow();
    }

    function refreshStatus() {
        const id = userId();
        if (!id) return Promise.resolve();
        if (lock.statusLoading) return lock.statusLoading;
        lock.statusLoading = api.getVaultPinStatus(id).then((status) => {
            if (id !== ui.userId) return;
            lock.status = {
                has_pin: status?.has_pin === true,
                locked_until: status?.locked_until || null,
                remaining_attempts: Number(status?.remaining_attempts ?? MAX_ATTEMPTS),
            };
            lock.statusError = "";
            scheduleLockoutEnd();
        }, (error) => {
            if (!lock.status) lock.statusError = userMessage(error, "Couldn’t check your Vault. Please try again.");
        }).finally(() => { lock.statusLoading = null; });
        return lock.statusLoading;
    }

    // MARK: Loading

    function loadPage(store, { reset = false, limit = PAGE_SIZE } = {}) {
        const id = userId();
        if (!id) return Promise.resolve();
        if (store.loading && !reset) return store.loading;
        if (!reset && store.loaded && !store.cursor) return Promise.resolve();
        if (store.scope === "private" && (!hasPin() || !unlockToken())) return Promise.resolve();
        if (reset) store.generation += 1;
        const generation = store.generation;
        const request = api.getVault(id, {
            scope: store.scope,
            cursor: reset ? null : store.cursor,
            limit: Math.min(MAX_PAGE_SIZE, Math.max(1, limit)),
            unlockToken: store.scope === "private" ? unlockToken() : null,
        });
        const loading = request.then((page) => {
            if (generation !== store.generation || id !== ui.userId) return;
            const items = Array.isArray(page?.items) ? page.items.filter((item) => item?.id) : [];
            if (reset) {
                store.items = items;
            } else {
                const known = new Set(store.items.map((item) => item.id));
                store.items.push(...items.filter((item) => !known.has(item.id)));
            }
            store.cursor = page?.next_cursor || null;
            if (Number.isFinite(Number(page?.total_count))) store.total = Number(page.total_count);
            store.loaded = true;
            store.error = "";
            store.fetchedAt = Date.now();
        }, (error) => {
            if (generation !== store.generation) return;
            if (errorCode(error) === "vault_locked") {
                handleServerLocked();
                return;
            }
            store.error = userMessage(error, store.scope === "private" ? "Couldn’t load your Vault." : "Couldn’t load your Memories.");
        }).finally(() => {
            if (store.loading === loading) store.loading = null;
            if (store.scope === "memories") paintEntry();
            if (ui.open) render();
        });
        store.loading = loading;
        if (ui.open) render();
        return loading;
    }

    /** Signed URLs last an hour; a fresh copy of the loaded pages renews them. */
    function renewURLs(store) {
        if (!store.loaded || store.loading || Date.now() - store.renewedAt < URL_RENEW_COOLDOWN_MS) return;
        store.renewedAt = Date.now();
        void loadPage(store, { reset: true, limit: Math.max(PAGE_SIZE, Math.min(MAX_PAGE_SIZE, store.items.length)) });
    }

    function handleImageError(event) {
        const image = event.target;
        if (!(image instanceof HTMLImageElement) || !image.closest("[data-vault-scope]")) return;
        const scope = image.closest("[data-vault-scope]").dataset.vaultScope;
        if (stores[scope]) renewURLs(stores[scope]);
    }

    // MARK: Entry row on Profile

    function paintEntry() {
        const container = ui.entry;
        if (!container) return;
        const store = stores.memories;
        const subtitle = store.total == null ? "Your saved photos and videos" : store.total === 1 ? "1 saved" : `${store.total.toLocaleString()} saved`;
        const thumbs = store.items.slice(0, 3).map((item) => mediaImageMarkup(item.thumbnail_url || (item.media_type === "photo" ? item.media_url : null), {
            className: "vault-entry-thumb",
        }) || '<span class="vault-entry-thumb"></span>').join("");
        container.innerHTML = `<button class="vault-entry" type="button" data-vault-scope="memories" data-open-memories>
            <span class="vault-entry-icon" aria-hidden="true">${ICONS.stack}</span>
            <span class="vault-entry-copy"><strong>Memories</strong><small>${escapeHTML(subtitle)}</small></span>
            <span class="vault-entry-thumbs" aria-hidden="true">${thumbs}</span>
            <span class="vault-entry-chevron" aria-hidden="true">›</span>
        </button>`;
        container.querySelector("[data-open-memories]").addEventListener("click", () => {
            haptic("light");
            void open();
        });
        container.classList.remove("hidden");
    }

    async function renderEntry(container) {
        if (!userId()) return;
        await ensureStyles();
        if (ui.entry !== container) {
            ui.entry = container;
            container.addEventListener("error", handleImageError, true);
        }
        paintEntry();
        const store = stores.memories;
        if (!ui.open && Date.now() - store.fetchedAt > ENTRY_REFRESH_MS) await loadPage(store, { reset: true });
    }

    // MARK: Screen

    function buildScreen() {
        const screen = document.createElement("section");
        screen.id = "vaultScreen";
        screen.className = "detail-screen vault-screen hidden";
        screen.setAttribute("role", "dialog");
        screen.setAttribute("aria-modal", "true");
        screen.setAttribute("aria-labelledby", "vaultTitle");
        screen.innerHTML = `
            <div class="detail-screen-header vault-header">
                <div class="vault-header-side">
                    <button class="vault-icon-button hidden" type="button" data-vault-lock-button aria-haspopup="menu" aria-expanded="false"></button>
                    <div class="vault-menu hidden" role="menu" data-vault-menu></div>
                </div>
                <strong id="vaultTitle">Memories</strong>
                <div class="vault-header-side vault-header-trailing">
                    <button class="vault-icon-button" type="button" data-vault-refresh aria-label="Refresh">${ICONS.refresh}</button>
                    <button class="vault-icon-button" type="button" data-vault-close aria-label="Close">${uiIcon("close")}</button>
                </div>
            </div>
            <div class="segmented-control vault-tabs" role="tablist" aria-label="Memories and Vault">
                <button class="segment active" type="button" role="tab" aria-selected="true" data-vault-tab="memories">Memories</button>
                <button class="segment" type="button" role="tab" aria-selected="false" data-vault-tab="vault">Vault</button>
            </div>
            <div class="vault-body" data-vault-body role="tabpanel" aria-labelledby="vaultTitle"></div>
            <div class="vault-viewer hidden" role="dialog" aria-modal="true" aria-label="Memory viewer" data-vault-viewer></div>
            <div class="vault-layer hidden" role="dialog" aria-modal="true" data-vault-layer></div>`;
        (mount || document.body).append(screen);
        screen.addEventListener("click", handleClick);
        screen.addEventListener("keydown", handleKeydown);
        screen.addEventListener("error", handleImageError, true);
        ui.observer = new MutationObserver(() => {
            if (screen.classList.contains("hidden") && ui.open) handleScreenClosed();
        });
        ui.observer.observe(screen, { attributes: true, attributeFilter: ["class"] });
        ui.screen = screen;
        return screen;
    }

    const $ = (selector) => ui.screen?.querySelector(selector);

    async function open({ tab = "memories" } = {}) {
        if (!userId()) return;
        await ensureStyles();
        const screen = ui.screen || buildScreen();
        lockNow();
        ui.tab = tab === "vault" ? "vault" : "memories";
        ui.open = true;
        ui.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        render();
        openDetailScreen(screen);
        void refreshStatus().then(() => {
            if (!ui.open) return;
            render();
            if (ui.tab === "vault") void loadPage(stores.private, { reset: true });
        });
        void loadPage(stores.memories, { reset: true });
    }

    function close() {
        if (!ui.screen || ui.screen.classList.contains("hidden")) return;
        closeDetailScreen(ui.screen);
    }

    // Closing the screen, by the × or by Back, locks the Vault again.
    function handleScreenClosed() {
        ui.open = false;
        closeViewer({ restoreFocus: false });
        closeLayer();
        toggleMenu(false);
        lockNow();
        ui.tab = "memories";
        paintEntry();
    }

    function selectTab(tab) {
        if (tab === ui.tab) return;
        const leaving = ui.tab;
        ui.tab = tab;
        toggleMenu(false);
        // Leaving the Vault tab locks it again.
        if (leaving === "vault") lockNow();
        render();
        ui.screen.querySelector("[data-vault-body]").scrollTop = 0;
        if (tab === "vault") {
            void refreshStatus().then(() => {
                render();
                if (ui.tab === "vault") void loadPage(stores.private, { reset: true });
            });
        }
    }

    function refreshCurrent() {
        const button = $("[data-vault-refresh]");
        button?.classList.add("is-spinning");
        const work = ui.tab === "vault"
            ? refreshStatus().then(() => loadPage(stores.private, { reset: true }))
            : loadPage(stores.memories, { reset: true });
        void Promise.resolve(work).finally(() => {
            button?.classList.remove("is-spinning");
            render();
        });
    }

    // MARK: Rendering

    function render() {
        if (!ui.screen || !ui.open) return;
        const vaultTab = ui.tab === "vault";
        $("#vaultTitle").textContent = vaultTab ? "Vault" : "Memories";
        ui.screen.querySelectorAll("[data-vault-tab]").forEach((button) => {
            const selected = button.dataset.vaultTab === ui.tab;
            button.classList.toggle("active", selected);
            button.setAttribute("aria-selected", String(selected));
        });
        const lockButton = $("[data-vault-lock-button]");
        lockButton.classList.toggle("hidden", !vaultTab || !lock.status);
        lockButton.innerHTML = hasPin() ? ICONS.lock : ICONS.lockOutline;
        lockButton.setAttribute("aria-label", hasPin() ? "Vault PIN settings" : "Set a Vault PIN");
        if (hasPin()) lockButton.setAttribute("aria-haspopup", "menu");
        else lockButton.removeAttribute("aria-haspopup");
        renderBody();
        if (ui.viewer) renderViewer();
    }

    function renderBody() {
        const body = $("[data-vault-body]");
        if (ui.tab === "memories") return renderGrid(body, stores.memories);
        if (!lock.status) {
            return setBody(body, "status", lock.statusError
                ? `<div class="vault-message"><p>${escapeHTML(lock.statusError)}</p><button class="secondary-button vault-inline-button" type="button" data-vault-retry-status>Try again</button></div>`
                : '<div class="vault-message"><span class="vault-spinner" role="progressbar" aria-label="Loading"></span></div>');
        }
        if (!hasPin()) {
            return setBody(body, "intro", `<div class="vault-message vault-intro">
                <span class="vault-hero-icon" aria-hidden="true">${ICONS.lock}</span>
                <h2>Keep things private</h2>
                <p>Move photos and videos from Memories into your Vault. Only someone with your PIN can open it.</p>
                <button class="primary-button vault-cta" type="button" data-vault-setup-pin>Set up a PIN</button>
            </div>`);
        }
        if (!allowsAccess()) return renderGate(body);
        return renderGrid(body, stores.private);
    }

    /** Replaces the body only when its kind changes, so live grids keep their nodes. */
    function setBody(body, kind, markup) {
        body.dataset.vaultScope = ui.tab === "vault" ? "private" : "memories";
        if (body.dataset.kind === kind && body.__vaultMarkup === markup) return;
        body.dataset.kind = kind;
        body.__vaultMarkup = markup;
        body.innerHTML = markup;
    }

    function monthKey(date) {
        return `${date.getFullYear()}-${date.getMonth() + 1}`;
    }

    function cellMarkup(item) {
        const video = item.media_type === "video";
        const date = capturedDate(item);
        const poster = item.thumbnail_url || (video ? null : item.media_url);
        const media = poster
            ? mediaImageMarkup(poster, { className: "vault-cell-media" })
            : video ? `<video class="vault-cell-media" src="${escapeHTML(item.media_url)}#t=0.1" muted playsinline preload="metadata" aria-hidden="true"></video>` : "";
        const label = `${video ? "Video" : "Photo"}, ${dayFormatter.format(date)}${item.source === "story" ? ", posted to your Story" : ""}`;
        return `<button class="vault-cell" type="button" data-vault-open="${escapeHTML(item.id)}" aria-label="${escapeHTML(label)}">
            ${media}
            ${video ? `<span class="vault-cell-duration" aria-hidden="true">${ICONS.playFill}${item.video_duration_ms ? `<span>${durationLabel(item.video_duration_ms)}</span>` : ""}</span>` : ""}
            ${item.source === "story" ? `<span class="vault-cell-story" aria-hidden="true">${ICONS.story}</span>` : ""}
        </button>`;
    }

    function renderGrid(body, store) {
        const scope = store.scope;
        if (!store.loaded && !store.items.length) {
            return setBody(body, `${scope}-state`, store.error
                ? `<div class="vault-message"><p>${escapeHTML(store.error)}</p><button class="secondary-button vault-inline-button" type="button" data-vault-retry>Try again</button></div>`
                : '<div class="vault-message"><span class="vault-spinner" role="progressbar" aria-label="Loading"></span></div>');
        }
        if (!store.items.length) {
            const vault = scope === "private";
            return setBody(body, `${scope}-empty`, `<div class="vault-message vault-empty">
                <span class="vault-hero-icon" aria-hidden="true">${vault ? ICONS.lock : ICONS.stack}</span>
                <h2>${vault ? "Your Vault is empty" : "No Memories yet"}</h2>
                <p>${vault
                    ? "Open something in Memories and tap Move to Vault to keep it here."
                    : "Tap Save after you take a photo or video to keep it here. Stories you post are saved here too. Only you can see your Memories."}</p>
            </div>`);
        }
        setBody(body, `${scope}-grid`, `<div class="vault-grid" data-vault-grid></div><div class="vault-sentinel" data-vault-sentinel aria-hidden="true"></div><div class="vault-more hidden" data-vault-more><span class="vault-spinner" role="progressbar" aria-label="Loading more"></span></div>`);
        const entries = [];
        let lastMonth = null;
        for (const item of store.items) {
            const date = capturedDate(item);
            const key = monthKey(date);
            if (key !== lastMonth) {
                lastMonth = key;
                entries.push({ key: `month-${key}`, html: `<h3 class="vault-month" data-vault-month="${key}">${escapeHTML(monthFormatter.format(date))}</h3>` });
            }
            entries.push({ key: `item-${item.id}`, html: cellMarkup(item) });
        }
        reconcileKeyedElements(body.querySelector("[data-vault-grid]"), entries);
        body.querySelector("[data-vault-more]").classList.toggle("hidden", !(store.loading && store.loaded));
        observeSentinel(body, store);
    }

    let sentinelObserver = null;
    function observeSentinel(body, store) {
        sentinelObserver?.disconnect();
        const sentinel = body.querySelector("[data-vault-sentinel]");
        if (!sentinel || !store.cursor || typeof IntersectionObserver !== "function") return;
        sentinelObserver = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting) && store.cursor && !store.loading) void loadPage(store);
        }, { root: body, rootMargin: "0px 0px 600px 0px" });
        sentinelObserver.observe(sentinel);
    }

    // MARK: PIN pad

    function padMarkup({ id, title, message = "", isError = false, disabled = false }) {
        return `<div class="vault-pin" data-vault-pad="${id}">
            <h2 class="vault-pin-title" id="vaultPinTitle-${id}">${escapeHTML(title)}</h2>
            <div class="vault-pin-dots" role="img" aria-label="0 of ${PIN_LENGTH} digits entered">${"<i></i>".repeat(PIN_LENGTH)}</div>
            <p class="vault-pin-message ${isError ? "is-error" : ""}" role="${isError ? "alert" : "status"}">${escapeHTML(message)}</p>
            <div class="vault-pin-keys${disabled ? " is-disabled" : ""}" role="group" aria-label="Number pad">
                ${KEYS.map((key) => key === ""
                    ? '<span class="vault-pin-key-spacer" aria-hidden="true"></span>'
                    : key === "delete"
                    ? `<button class="vault-pin-key vault-pin-delete" type="button" data-pin-key="delete" aria-label="Delete"${disabled ? " disabled" : ""}>${ICONS.backspace}</button>`
                    : `<button class="vault-pin-key" type="button" data-pin-key="${key}" aria-label="${key}"${disabled ? " disabled" : ""}>${key}</button>`).join("")}
            </div>
        </div>`;
    }

    function createPad(element, onComplete) {
        return { element, digits: "", onComplete, completing: false };
    }

    /** The pad a key belongs to: the PIN flow on top, else the lock screen. */
    function padFor(element) {
        const host = element?.closest?.("[data-vault-pad]");
        if (host?.dataset.vaultPad === "flow") return ui.pinFlow?.pad || null;
        if (host?.dataset.vaultPad === "gate") return ui.gatePad?.element === host ? ui.gatePad : null;
        return null;
    }

    function paintDots(pad) {
        const dots = pad.element.querySelectorAll(".vault-pin-dots i");
        dots.forEach((dot, index) => dot.classList.toggle("filled", index < pad.digits.length));
        pad.element.querySelector(".vault-pin-dots").setAttribute("aria-label", `${pad.digits.length} of ${PIN_LENGTH} digits entered`);
    }

    function pressKey(pad, key) {
        if (!pad || pad.completing || pad.element.querySelector(".vault-pin-keys.is-disabled")) return;
        if (key === "delete") {
            pad.digits = pad.digits.slice(0, -1);
            paintDots(pad);
            return;
        }
        if (!/^[0-9]$/.test(key) || pad.digits.length >= PIN_LENGTH) return;
        pad.digits += key;
        haptic("light");
        paintDots(pad);
        if (pad.digits.length === PIN_LENGTH) {
            const pin = pad.digits;
            pad.completing = true;
            // Let the last dot fill before the pad resets.
            setTimeout(() => {
                pad.digits = "";
                pad.completing = false;
                if (pad.element.isConnected) paintDots(pad);
                pad.onComplete(pin);
            }, 150);
        }
    }

    function setPadState(pad, { title, message, isError, disabled } = {}) {
        if (!pad?.element.isConnected) return;
        if (title !== undefined) pad.element.querySelector(".vault-pin-title").textContent = title;
        if (message !== undefined) {
            const line = pad.element.querySelector(".vault-pin-message");
            line.textContent = message || "";
            line.classList.toggle("is-error", Boolean(isError));
            line.setAttribute("role", isError ? "alert" : "status");
        }
        if (disabled !== undefined) {
            pad.element.querySelector(".vault-pin-keys").classList.toggle("is-disabled", disabled);
            pad.element.querySelectorAll("[data-pin-key]").forEach((button) => { button.disabled = disabled; });
        }
    }

    // MARK: Lock screen

    function renderGate(body) {
        const until = lockedOutUntil();
        const message = until ? lockoutMessage(until) : ui.gateMessage;
        setBody(body, "gate", `<div class="vault-gate">
            <span class="vault-gate-icon" aria-hidden="true">${ICONS.lock}</span>
            ${padMarkup({ id: "gate", title: "Enter your Vault PIN" })}
            <button class="vault-link-button" type="button" data-vault-forgot>Forgot PIN?</button>
        </div>`);
        const pad = body.querySelector("[data-vault-pad='gate']");
        if (ui.gatePad?.element !== pad) ui.gatePad = createPad(pad, submitGatePin);
        setPadState(ui.gatePad, { message, isError: Boolean(until) || ui.gateError, disabled: Boolean(until) || lock.busy });
    }

    async function submitGatePin(pin) {
        const id = userId();
        if (!id || lock.busy) return;
        lock.busy = true;
        setPadState(ui.gatePad, { disabled: true });
        try {
            acceptUnlock(await api.unlockVault(id, pin));
            ui.gateMessage = "";
            ui.gateError = false;
            lock.busy = false;
            render();
            void loadPage(stores.private, { reset: true });
        } catch (error) {
            lock.busy = false;
            recordPinError(error);
            ui.gateError = true;
            ui.gateMessage = errorCode(error) === "vault_pin_locked" ? "" : pinErrorMessage(error);
            if (["vault_pin_incorrect", "vault_pin_locked"].includes(errorCode(error))) haptic("error");
            render();
        }
    }

    // MARK: Layers (PIN flows and Forgot PIN)

    function showLayer(markup, labelId) {
        const layer = $("[data-vault-layer]");
        layer.innerHTML = markup;
        layer.setAttribute("aria-labelledby", labelId);
        layer.classList.remove("hidden");
        requestAnimationFrame(() => layer.querySelector("[data-vault-layer-close]")?.focus({ preventScroll: true }));
        return layer;
    }

    function closeLayer() {
        const layer = $("[data-vault-layer]");
        if (!layer || layer.classList.contains("hidden")) return;
        const flow = ui.pinFlow;
        ui.pinFlow = null;
        layer.classList.add("hidden");
        layer.innerHTML = "";
        if (flow?.done) {
            const done = flow.onDone;
            flow.onDone = null;
            done?.();
        }
        if (ui.open) render();
    }

    const FLOW_TITLES = {
        current: (mode) => (mode === "change" ? "Enter your current PIN" : "Enter your Vault PIN"),
        new: (mode) => (mode === "change" ? "Choose a new PIN" : "Choose a 4-digit PIN"),
        confirm: () => "Enter it again",
    };

    /** Set, change, or remove the PIN, one pad at a time. */
    function openPinFlow(mode, { onDone = null } = {}) {
        ui.pinFlow = { mode, step: mode === "set" ? "new" : "current", first: null, currentPin: null, onDone, done: false };
        toggleMenu(false);
        const layer = showLayer(`<div class="vault-layer-content">
            <button class="vault-icon-button vault-layer-close" type="button" data-vault-layer-close aria-label="Cancel">${uiIcon("close")}</button>
            ${padMarkup({ id: "flow", title: FLOW_TITLES[ui.pinFlow.step](mode) })}
        </div>`, "vaultPinTitle-flow");
        ui.pinFlow.pad = createPad(layer.querySelector("[data-vault-pad='flow']"), handleFlowPin);
    }

    function flowMessage(message, isError) {
        const flow = ui.pinFlow;
        setPadState(flow.pad, { title: FLOW_TITLES[flow.step](flow.mode), message, isError });
    }

    function handleFlowPin(pin) {
        const flow = ui.pinFlow;
        if (!flow) return;
        if (flow.step === "current") {
            if (flow.mode === "remove") return runFlow(async (id) => {
                await api.removeVaultPin(id, pin);
                lock.status = { has_pin: false, locked_until: null, remaining_attempts: MAX_ATTEMPTS };
                lockNow();
                // Every private item moved back to Memories on the server.
                void loadPage(stores.memories, { reset: true });
                showToast("Vault PIN turned off. Everything is back in Memories.");
                finishFlow();
            });
            flow.currentPin = pin;
            flow.step = "new";
            return flowMessage("", false);
        }
        if (flow.step === "new") {
            flow.first = pin;
            flow.step = "confirm";
            return flowMessage("", false);
        }
        if (pin !== flow.first) {
            flow.first = null;
            flow.step = "new";
            return flowMessage("Those didn’t match. Choose a PIN again.", true);
        }
        return runFlow(async (id) => {
            acceptUnlock(await api.setVaultPin(id, pin, flow.currentPin));
            haptic("success");
            if (flow.mode === "change") showToast("Vault PIN changed");
            finishFlow();
            if (ui.tab === "vault") void loadPage(stores.private, { reset: true });
        });
    }

    function finishFlow() {
        if (ui.pinFlow) ui.pinFlow.done = true;
        closeLayer();
    }

    async function runFlow(action) {
        const flow = ui.pinFlow;
        const id = userId();
        if (!flow || !id || lock.busy) return;
        lock.busy = true;
        setPadState(flow.pad, { disabled: true });
        try {
            await action(id);
        } catch (error) {
            recordPinError(error);
            const code = errorCode(error);
            if (code === "vault_pin_incorrect" && flow.mode === "change") flow.step = "current";
            if (code === "vault_pin_incorrect" || code === "vault_pin_locked") haptic("error");
            if (ui.pinFlow === flow) flowMessage(pinErrorMessage(error), true);
        } finally {
            lock.busy = false;
            if (ui.pinFlow === flow) setPadState(flow.pad, { disabled: Boolean(lockedOutUntil()) });
        }
    }

    function openForgot() {
        const layer = showLayer(`<div class="vault-layer-content vault-forgot">
            <button class="vault-icon-button vault-layer-close" type="button" data-vault-layer-close aria-label="Close">${uiIcon("close")}</button>
            <h2 id="vaultForgotTitle">Forgot your PIN?</h2>
            <p data-vault-forgot-message>To reset it, sign out and sign back in, then come back here within 15 minutes. Your saved photos and videos stay in your Vault.</p>
            <button class="primary-button vault-cta" type="button" data-vault-reset-pin>Reset PIN</button>
        </div>`, "vaultForgotTitle");
        return layer;
    }

    async function resetPin(button) {
        const id = userId();
        if (!id || lock.busy) return;
        lock.busy = true;
        button.disabled = true;
        try {
            await api.resetVaultPin(id);
            lock.status = { has_pin: false, locked_until: null, remaining_attempts: MAX_ATTEMPTS };
            lockNow();
            closeLayer();
            showToast("Your Vault PIN was reset");
        } catch (error) {
            const message = $("[data-vault-forgot-message]");
            if (message) {
                message.textContent = errorCode(error) === "vault_pin_reset_requires_recent_sign_in"
                    ? "You need to have signed in within the last 15 minutes. Sign out, sign back in, then try again. Your Vault stays as it is."
                    : userMessage(error, "Couldn’t reset your PIN. Please try again.");
                message.classList.add("is-error");
            }
        } finally {
            lock.busy = false;
            button.disabled = false;
        }
    }

    // MARK: Lock menu

    function toggleMenu(force) {
        const menu = $("[data-vault-menu]");
        const button = $("[data-vault-lock-button]");
        if (!menu || !button) return;
        const show = force ?? menu.classList.contains("hidden");
        if (show) {
            menu.innerHTML = [
                allowsAccess() ? '<button type="button" role="menuitem" data-vault-lock-now>Lock Vault now</button>' : "",
                '<button type="button" role="menuitem" data-vault-change-pin>Change PIN</button>',
                '<button type="button" role="menuitem" class="danger" data-vault-remove-pin>Turn off PIN</button>',
            ].join("");
        }
        menu.classList.toggle("hidden", !show);
        button.setAttribute("aria-expanded", String(show));
        if (show) menu.querySelector("button")?.focus({ preventScroll: true });
    }

    // MARK: Viewer

    function currentStore() {
        return ui.viewer ? stores[ui.viewer.scope] : null;
    }

    function currentItem() {
        const store = currentStore();
        return store?.items.find((item) => item.id === ui.viewer.id) || null;
    }

    function openViewer(itemId) {
        const scope = ui.tab === "vault" ? "private" : "memories";
        if (!stores[scope].items.some((item) => item.id === itemId)) return;
        ui.viewer = { scope, id: itemId, returnId: itemId };
        ui.saving = false;
        const viewer = $("[data-vault-viewer]");
        viewer.dataset.vaultScope = scope;
        viewer.innerHTML = `
            <div class="vault-pager" data-vault-pager tabindex="-1"></div>
            <div class="vault-viewer-top">
                <div class="vault-viewer-meta" aria-live="polite"><strong data-vault-date></strong><span data-vault-label></span></div>
                <button class="vault-round-button" type="button" data-vault-viewer-close aria-label="Close">${uiIcon("close")}</button>
            </div>
            <button class="vault-step vault-step-previous" type="button" data-vault-step="-1" aria-label="Previous">${ICONS.chevronLeft}</button>
            <button class="vault-step vault-step-next" type="button" data-vault-step="1" aria-label="Next">${ICONS.chevronRight}</button>
            <div class="vault-viewer-bottom">
                <button class="vault-save-button" type="button" data-vault-save></button>
                <span class="vault-viewer-spacer"></span>
                <button class="vault-round-button hidden" type="button" data-vault-mute></button>
                <button class="vault-round-button" type="button" data-vault-move></button>
                <button class="vault-round-button" type="button" data-vault-delete>${uiIcon("trash")}</button>
            </div>`;
        viewer.querySelector("[data-vault-pager]").addEventListener("scroll", handlePagerScroll, { passive: true });
        viewer.classList.remove("hidden");
        renderViewer({ jump: true });
        requestAnimationFrame(() => viewer.querySelector("[data-vault-viewer-close]")?.focus({ preventScroll: true }));
    }

    function closeViewer({ restoreFocus = true } = {}) {
        const viewer = $("[data-vault-viewer]");
        if (!ui.viewer || !viewer) return;
        const returnId = ui.viewer.id || ui.viewer.returnId;
        viewer.querySelectorAll("video").forEach((video) => video.pause());
        viewer.classList.add("hidden");
        viewer.innerHTML = "";
        ui.viewer = null;
        if (restoreFocus && ui.open) {
            render();
            const cell = [...ui.screen.querySelectorAll("[data-vault-open]")].find((button) => button.dataset.vaultOpen === returnId);
            (cell || $("[data-vault-close]"))?.focus({ preventScroll: true });
            cell?.scrollIntoView({ block: "nearest" });
        }
    }

    function viewerIndex() {
        const store = currentStore();
        return store ? store.items.findIndex((item) => item.id === ui.viewer.id) : -1;
    }

    function pageMarkup(item) {
        return `<div class="vault-page" data-vault-page="${escapeHTML(item.id)}" role="group" aria-roledescription="slide" aria-label="${item.media_type === "video" ? "Video" : "Photo"}, ${escapeHTML(dayFormatter.format(capturedDate(item)))}"></div>`;
    }

    function fillPage(page, item, active) {
        const source = `${item.media_url}|${item.thumbnail_url || ""}`;
        if (page.dataset.source !== source) {
            page.dataset.source = source;
            const overlays = (item.text_overlays || []).filter((overlay) => overlay?.text);
            page.innerHTML = `${item.media_type === "video"
                ? `<video class="vault-page-media" src="${escapeHTML(item.media_url)}"${item.thumbnail_url ? ` poster="${escapeHTML(item.thumbnail_url)}"` : ""} playsinline loop preload="metadata"></video>`
                : mediaImageMarkup(item.media_url, { className: "vault-page-media", loading: "eager", alt: "" })}
                ${overlays.map((overlay) => `<span class="vault-text-overlay">${escapeHTML(overlay.text)}</span>`).join("")}`;
            page.querySelectorAll(".vault-text-overlay").forEach((node, index) => setRuntimeStyles(node, {
                left: `${Math.min(1, Math.max(0, Number(overlays[index].x ?? 0.5))) * 100}%`,
                top: `${Math.min(1, Math.max(0, Number(overlays[index].y ?? 0.5))) * 100}%`,
            }));
        }
        const video = page.querySelector("video");
        if (!video) return;
        video.muted = ui.muted;
        if (active) playVideo(video);
        else video.pause();
    }

    function playVideo(video) {
        const attempt = video.play();
        attempt?.catch?.((error) => {
            // Without a fresh tap the browser may refuse sound: loop silently and
            // let the speaker button turn it on.
            if (error?.name !== "NotAllowedError" || video.muted) return;
            ui.muted = true;
            video.muted = true;
            paintViewerChrome();
            video.play().catch(() => {});
        });
    }

    function activeVideo() {
        return ui.viewer ? $(`[data-vault-page="${CSS.escape(ui.viewer.id)}"] video`) : null;
    }

    function renderViewer({ jump = false } = {}) {
        const viewer = $("[data-vault-viewer]");
        const store = currentStore();
        if (!viewer || !store) return;
        if (!store.items.length) return closeViewer();
        if (viewerIndex() < 0) ui.viewer.id = store.items[0].id;
        const pager = viewer.querySelector("[data-vault-pager]");
        reconcileKeyedElements(pager, store.items.map((item) => ({ key: item.id, html: pageMarkup(item) })));
        const index = viewerIndex();
        if (jump) pager.scrollLeft = index * pager.clientWidth;
        [...pager.children].forEach((page, pageIndex) => {
            const item = store.items[pageIndex];
            if (Math.abs(pageIndex - index) <= 1) fillPage(page, item, pageIndex === index);
            else if (page.dataset.source) {
                page.querySelectorAll("video").forEach((video) => video.pause());
                page.innerHTML = "";
                delete page.dataset.source;
            }
        });
        paintViewerChrome();
        if (index >= store.items.length - 3 && store.cursor && !store.loading) void loadPage(store);
    }

    function paintViewerChrome() {
        const viewer = $("[data-vault-viewer]");
        const item = currentItem();
        if (!viewer || !item) return;
        const privateScope = ui.viewer.scope === "private";
        viewer.querySelector("[data-vault-date]").textContent = dayFormatter.format(capturedDate(item));
        viewer.querySelector("[data-vault-label]").innerHTML = privateScope
            ? `${ICONS.lock}<span>In your Vault</span>`
            : item.source === "story" ? "<span>Posted to your Story</span>" : "";
        const saved = ui.savedId === item.id;
        const save = viewer.querySelector("[data-vault-save]");
        save.innerHTML = ui.saving
            ? '<span class="vault-spinner vault-spinner-light" aria-hidden="true"></span><span>Saving…</span>'
            : saved ? `${uiIcon("check")}<span>Saved</span>` : `${ICONS.download}<span>Save</span>`;
        save.disabled = ui.saving || saved;
        const mute = viewer.querySelector("[data-vault-mute]");
        mute.classList.toggle("hidden", item.media_type !== "video");
        mute.innerHTML = ui.muted ? ICONS.muted : uiIcon("speaker");
        mute.setAttribute("aria-label", ui.muted ? "Unmute" : "Mute");
        const move = viewer.querySelector("[data-vault-move]");
        move.innerHTML = privateScope ? ICONS.lockOpen : ICONS.lock;
        move.setAttribute("aria-label", privateScope ? "Move to Memories" : "Move to Vault");
        move.disabled = ui.moving;
        viewer.querySelector("[data-vault-delete]").setAttribute("aria-label", privateScope ? "Delete from Vault" : "Delete from Memories");
        const index = viewerIndex();
        const store = currentStore();
        viewer.querySelector("[data-vault-step='-1']").disabled = index <= 0;
        viewer.querySelector("[data-vault-step='1']").disabled = index >= store.items.length - 1;
    }

    let pagerFrame = 0;
    function handlePagerScroll(event) {
        const pager = event.currentTarget;
        cancelAnimationFrame(pagerFrame);
        pagerFrame = requestAnimationFrame(() => {
            const store = currentStore();
            if (!store || !pager.clientWidth) return;
            const index = Math.max(0, Math.min(store.items.length - 1, Math.round(pager.scrollLeft / pager.clientWidth)));
            const item = store.items[index];
            if (!item || item.id === ui.viewer.id) return;
            ui.viewer.id = item.id;
            haptic("selection");
            renderViewer();
        });
    }

    function step(delta) {
        const pager = $("[data-vault-pager]");
        const store = currentStore();
        if (!pager || !store) return;
        const index = Math.max(0, Math.min(store.items.length - 1, viewerIndex() + delta));
        pager.scrollTo({ left: index * pager.clientWidth, behavior: reducedMotion() ? "auto" : "smooth" });
    }

    /** The item to show after `item` leaves this list: the next, else the previous. */
    function neighborId(store, item) {
        const index = store.items.findIndex((entry) => entry.id === item.id);
        if (index < 0) return null;
        return store.items[index + 1]?.id || store.items[index - 1]?.id || null;
    }

    function removeLocally(store, itemId) {
        const before = store.items.length;
        store.items = store.items.filter((item) => item.id !== itemId);
        if (store.items.length !== before && store.total != null) store.total = Math.max(0, store.total - 1);
    }

    function insertLocally(store, item) {
        if (!store.loaded || store.items.some((entry) => entry.id === item.id)) return;
        const time = capturedDate(item).getTime();
        const index = store.items.findIndex((entry) => capturedDate(entry).getTime() < time);
        store.items.splice(index < 0 ? store.items.length : index, 0, item);
        if (store.total != null) store.total += 1;
    }

    function afterRemoval(store, next) {
        if (!ui.viewer) return;
        if (!next || !store.items.length) {
            closeViewer();
            return;
        }
        ui.viewer.id = next;
        renderViewer({ jump: true });
        render();
    }

    /** Memories → Vault, or Vault → Memories. A first move into the Vault sets up the PIN. */
    async function moveCurrent() {
        const item = currentItem();
        const id = userId();
        if (!item || !id || ui.moving) return;
        const intoVault = ui.viewer.scope === "memories";
        if (intoVault && !lock.status) await refreshStatus();
        if (intoVault && !hasPin()) {
            const itemId = item.id;
            openPinFlow("set", { onDone: () => { if (ui.viewer?.id === itemId && hasPin()) void moveCurrent(); } });
            return;
        }
        const from = stores[intoVault ? "memories" : "private"];
        const to = stores[intoVault ? "private" : "memories"];
        const next = neighborId(from, item);
        ui.moving = true;
        paintViewerChrome();
        try {
            const updated = await api.setVaultItemPrivacy(id, item.id, intoVault, unlockToken());
            removeLocally(from, item.id);
            insertLocally(to, { ...item, ...(updated || {}), is_private: intoVault });
            haptic("success");
            showToast(intoVault ? "Moved to your Vault" : "Moved to Memories");
            paintEntry();
            ui.moving = false;
            afterRemoval(from, next);
        } catch (error) {
            ui.moving = false;
            const code = errorCode(error);
            if (code === "vault_locked") return handleServerLocked();
            if (code === "vault_pin_not_set") {
                recordPinError(error);
                openPinFlow("set", { onDone: () => { if (hasPin()) void moveCurrent(); } });
                return;
            }
            paintViewerChrome();
            showToast(userMessage(error, "Couldn’t move this. Please try again."));
        }
    }

    async function deleteCurrent() {
        const item = currentItem();
        const id = userId();
        if (!item || !id) return;
        const privateScope = ui.viewer.scope === "private";
        const confirmed = await confirmSheet({
            title: privateScope ? "Delete from your Vault?" : "Delete from Memories?",
            message: "It’s removed for good. Stories you posted aren’t affected.",
            confirmLabel: "Delete",
            cancelLabel: "Cancel",
            destructive: true,
        });
        if (!confirmed || !ui.viewer || currentItem()?.id !== item.id) return;
        const store = currentStore();
        const next = neighborId(store, item);
        try {
            await api.deleteVaultItem(id, item.id, privateScope ? unlockToken() : null);
            removeLocally(store, item.id);
            haptic("light");
            paintEntry();
            afterRemoval(store, next);
        } catch (error) {
            if (errorCode(error) === "vault_locked") return handleServerLocked();
            showToast(userMessage(error, "Couldn’t delete this. Please try again."));
        }
    }

    async function saveCurrent() {
        const item = currentItem();
        if (!item || ui.saving) return;
        ui.saving = true;
        paintViewerChrome();
        try {
            const blob = await mediaBlob(item.media_url);
            const type = blob.type || (item.media_type === "video" ? "video/mp4" : "image/jpeg");
            let file = new File([blob], `valid-${fileStamp(item)}.${extensionFor(type)}`, { type });
            if (item.media_type === "photo") file = await withCaptions(file, item.text_overlays).catch(() => file);
            if (navigator.share && navigator.canShare?.({ files: [file] })) {
                try {
                    await navigator.share({ files: [file] });
                } catch (error) {
                    // The download took long enough that the tap no longer counts;
                    // ask for one more tap to open the share sheet.
                    if (error?.name !== "NotAllowedError") throw error;
                    const ready = await confirmSheet({
                        title: item.media_type === "video" ? "Your video is ready" : "Your photo is ready",
                        confirmLabel: "Save", cancelLabel: "Not now",
                    });
                    if (!ready) return;
                    await navigator.share({ files: [file] });
                }
            } else {
                downloadFile(file);
            }
            ui.savedId = item.id;
            haptic("success");
        } catch (error) {
            if (error?.name === "AbortError") return;
            if (error?.name === "TypeError" && !String(item.media_url).startsWith("data:")) {
                // The media host refused a direct download: open it so it can be saved from there.
                window.open(item.media_url, "_blank", "noopener");
                showToast("Opened in a new tab. Save it from there.");
                return;
            }
            showToast(userMessage(error, "Couldn’t save this. Please try again."));
        } finally {
            ui.saving = false;
            paintViewerChrome();
        }
    }

    // MARK: Events

    function handleClick(event) {
        const target = event.target.closest("button");
        const menu = $("[data-vault-menu]");
        if (menu && !menu.classList.contains("hidden") && !event.target.closest("[data-vault-menu], [data-vault-lock-button]")) toggleMenu(false);
        if (!target || target.disabled) return;
        if (target.matches("[data-pin-key]")) return pressKey(padFor(target), target.dataset.pinKey);
        if (target.matches("[data-vault-close]")) return close();
        if (target.matches("[data-vault-refresh]")) return refreshCurrent();
        if (target.matches("[data-vault-tab]")) return selectTab(target.dataset.vaultTab);
        if (target.matches("[data-vault-retry]")) return void loadPage(ui.tab === "vault" ? stores.private : stores.memories, { reset: true });
        if (target.matches("[data-vault-retry-status]")) { lock.statusError = ""; render(); return void refreshStatus().then(render); }
        if (target.matches("[data-vault-open]")) return openViewer(target.dataset.vaultOpen);
        if (target.matches("[data-vault-setup-pin]")) return openPinFlow("set");
        if (target.matches("[data-vault-forgot]")) return void openForgot();
        if (target.matches("[data-vault-reset-pin]")) return void resetPin(target);
        if (target.matches("[data-vault-layer-close]")) return closeLayer();
        if (target.matches("[data-vault-lock-button]")) return hasPin() ? toggleMenu() : openPinFlow("set");
        if (target.matches("[data-vault-lock-now]")) {
            toggleMenu(false);
            haptic("light");
            return lockNow();
        }
        if (target.matches("[data-vault-change-pin]")) return openPinFlow("change");
        if (target.matches("[data-vault-remove-pin]")) return openPinFlow("remove");
        if (target.matches("[data-vault-viewer-close]")) return closeViewer();
        if (target.matches("[data-vault-step]")) return step(Number(target.dataset.vaultStep));
        if (target.matches("[data-vault-save]")) return void saveCurrent();
        if (target.matches("[data-vault-move]")) return void moveCurrent();
        if (target.matches("[data-vault-delete]")) return void deleteCurrent();
        if (target.matches("[data-vault-mute]")) {
            ui.muted = !ui.muted;
            const video = activeVideo();
            if (video) {
                video.muted = ui.muted;
                if (video.paused) void video.play().catch(() => {});
            }
            paintViewerChrome();
        }
    }

    function handleKeydown(event) {
        const layerOpen = !$("[data-vault-layer]").classList.contains("hidden");
        const viewerOpen = Boolean(ui.viewer);
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!$("[data-vault-menu]").classList.contains("hidden")) return toggleMenu(false);
            if (layerOpen) return closeLayer();
            if (viewerOpen) return closeViewer();
            return close();
        }
        if (event.target.matches?.("input, textarea")) return;
        const gateVisible = ui.tab === "vault" && ui.gatePad?.element.isConnected;
        const pad = layerOpen ? ui.pinFlow?.pad : viewerOpen || !gateVisible ? null : ui.gatePad;
        if (pad?.element.isConnected && (/^[0-9]$/.test(event.key) || event.key === "Backspace")) {
            event.preventDefault();
            pressKey(pad, event.key === "Backspace" ? "delete" : event.key);
            return;
        }
        if (viewerOpen && !layerOpen && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
            event.preventDefault();
            step(event.key === "ArrowRight" ? 1 : -1);
        }
    }

    // The unlock is memory-only and never survives the page going to the background.
    const lockWhenHidden = () => {
        if (document.visibilityState !== "hidden") return;
        $("[data-vault-viewer]")?.querySelectorAll("video").forEach((video) => video.pause());
        if (lock.token || ui.viewer?.scope === "private") lockNow();
    };
    document.addEventListener("visibilitychange", lockWhenHidden);
    window.addEventListener("pagehide", () => { if (lock.token) lockNow(); });

    return {
        renderEntry,
        open,
        close,
        lock: lockNow,
        hideEntry() {
            ui.entry?.classList.add("hidden");
        },
    };
}
