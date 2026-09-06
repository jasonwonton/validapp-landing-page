import { reconcileKeyedElements } from "../keyed-list.js";
import { prepareChatMedia, prepareMementoImages } from "./media.js";
import {
    CHAT_REACTIONS, chatNeedsMemento, chatPreview, displayMember, escapeChatHTML,
    messageTime, normalizeMessage, relativeChatTime, safeMediaURL,
} from "./models.js";
import { MAX_MESSAGES_PER_CHAT, createChatStore } from "./store.js";
import {
    MAX_AUTOMATIC_ATTEMPTS,
    MAX_MEDIA_AUTOMATIC_ATTEMPTS,
    chatTextSendIsRetryable,
    listChatMediaOutbox,
    listChatTextOutbox,
    markChatMediaOutboxAttempt,
    markChatTextOutboxAttempt,
    putChatMediaOutbox,
    putChatTextOutbox,
    removeChatMediaOutbox,
    removeChatTextOutbox,
} from "./outbox.js";
import { createCallsController } from "../calls/index.js";
import { createCameraEffectPicker } from "../camera-effects.js";
import { createMediaOverlayPositioner } from "../media-overlay-positioner.js";
import { setRuntimeStyles } from "../runtime-style.js";

const REFRESH_MS = 30_000;
const MAX_VOICE_RECORDING_MS = 300_000;

export async function deliverMementoRecord(api, userId, record, { onProgress } = {}) {
    const session = await api.createDailyHighlightUpload(userId, record.file.size, record.request_id, record.secondary?.size ?? null);
    await api.putDirectUpload(record.file, session, { onProgress: (progress) => onProgress?.(record.secondary ? progress * 0.48 : progress * 0.96) });
    if (record.secondary && !session.already_finalized) {
        if (!session.secondary_upload_url) throw new Error("The second Memento upload session was invalid.");
        await api.putDirectUpload(record.secondary, {
            upload_url: session.secondary_upload_url,
            upload_method: session.upload_method,
            required_headers: session.required_headers,
        }, { onProgress: (progress) => onProgress?.(0.48 + progress * 0.48) });
    }
    await api.finalizeDailyHighlightUpload(userId, session.media_asset_id);
    onProgress?.(1);
    return api.publishDailyHighlight(userId, session.media_asset_id, record.chat_ids, record.caption, record.request_id);
}

function compatibleAudioRecordingType() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return "";
    return ["audio/mp4;codecs=mp4a.40.2", "audio/mp4"]
        .find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

function localLedgerDate(date = new Date()) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function createChatsView({ root, api, getUser, getConfig, softHaptic, successHaptic, showToast, onUnreadChange }) {
    const store = createChatStore();
    const calls = createCallsController({ api, getUser, getConfig, showToast });
    let lastListLoad = 0;
    let activation = null;
    let selectedMementoFile = null;
    let selectedMementoSecondaryFile = null;
    let selectedMementoSourceFile = null;
    let selectedMementoSecondarySourceFile = null;
    let selectedMementoPreview = null;
    let mementoFrontIsPrimary = false;
    let mementoPreparationGeneration = 0;
    let mementoRequestId = null;
    let selectedChatMedia = null;
    let selectedChatMediaSourceFile = null;
    let selectedChatMediaPreview = null;
    let chatMediaPreparationGeneration = 0;
    let chatMediaUploadRequestId = null;
    let chatMediaSendRequestId = null;
    let voiceRecorder = null;
    let voiceRecordingStartedAt = 0;
    let voiceRecordingTimer = null;
    let discardVoiceRecording = false;
    const viewOnceSessionByMessage = new Map();
    const viewOnceRequestByMessage = new Map();
    const stickerRequestById = new Map();
    const mementoShareRequestByEntry = new Map();
    let viewedMessageId = null;
    let viewedMementoEntryId = null;
    let viewedMementoPrimaryURL = null;
    let viewedMementoSwappedURL = null;
    let viewedMementoShowsSwapped = false;
    let typingTimer = null;
    let typingSent = false;
    let roomGeneration = 0;
    let inviteMode = false;
    let messageActionHoldTimer = null;
    let outboxRetrying = false;
    let outboxRetryTimer = null;
    let mediaOutboxRetrying = false;
    let mediaOutboxRetryTimer = null;

    root.innerHTML = `
        <div class="chat-shell">
            <section class="chat-list-screen" data-chat-screen="list">
                <header class="chat-page-header"><div><p>Memento</p><h1>Chats</h1></div><button class="chat-icon-button" type="button" data-new-chat aria-label="Start a chat">＋</button></header>
                <form class="chat-search-form" role="search"><label><span aria-hidden="true">⌕</span><input type="search" minlength="2" maxlength="100" placeholder="Search chats and messages" aria-label="Search chats and messages" autocomplete="off"></label><button type="submit">Search</button></form>
                <div class="chat-list-status" role="status"></div>
                <div class="chat-search-results hidden" aria-label="Chat search results"></div>
                <div class="chat-list" aria-label="Conversations"></div>
            </section>
            <section class="chat-create-screen hidden" data-chat-screen="create">
                <header class="chat-room-header"><button class="chat-back" type="button" data-chat-list aria-label="Back to chats">‹</button><strong>New chat</strong><button class="chat-create-submit" type="button" data-create-submit disabled>Create</button></header>
                <div class="chat-create-body">
                    <label class="chat-group-name hidden">Group name<input type="text" maxlength="40" placeholder="Name your group"></label>
                    <label class="chat-person-search"><span>⌕</span><input type="search" placeholder="Search classmates" autocomplete="off"></label>
                    <p class="chat-create-hint">Choose one person for a private chat or several for a group.</p>
                    <div class="chat-people-list"></div><p class="chat-create-status" role="status"></p>
                </div>
            </section>
            <section class="chat-room-screen hidden" data-chat-screen="room">
                <header class="chat-room-header"><button class="chat-back" type="button" data-chat-list aria-label="Back to chats">‹</button><button class="chat-room-title" type="button" data-chat-settings><strong>Chat</strong><small>Loading…</small></button><span class="chat-call-actions hidden"><button class="chat-icon-button" type="button" data-start-call="audio" aria-label="Start voice call">☎</button><button class="chat-icon-button" type="button" data-start-call="video" aria-label="Start video call">▣</button></span><button class="chat-icon-button" type="button" data-chat-settings aria-label="Chat settings">•••</button></header>
                <div class="chat-daily-row"></div>
                <div class="chat-room-status" role="status"></div>
                <button class="chat-load-earlier hidden" type="button" data-load-earlier>Load earlier messages</button>
                <div class="chat-timeline" aria-live="polite" aria-label="Messages"></div>
                <div class="chat-typing hidden" aria-live="polite">Someone is typing…</div>
                <div class="chat-reply-draft hidden"><span></span><button type="button" data-cancel-reply aria-label="Cancel reply">×</button></div>
                <form class="chat-composer">
                    <button class="chat-camera-button" type="button" data-open-memento aria-label="Take today's Memento">📷</button>
                    <button class="chat-attachment-button" type="button" data-open-chat-media aria-label="Send media or a sticker">＋</button>
                    <textarea rows="1" maxlength="2000" placeholder="Message" aria-label="Message"></textarea>
                    <button class="chat-send-button" type="submit" aria-label="Send message">↑</button>
                </form>
            </section>
        </div>
        <dialog class="chat-sheet" data-memento-dialog aria-label="Create a Memento">
            <form class="memento-form">
                <header><button type="button" data-close-memento>Cancel</button><strong>Today's Memento</strong><span></span></header>
                <div class="memento-preview"><span aria-hidden="true">📸</span><p>Capture one real moment from today.</p></div>
                <div class="memento-capture-inputs">
                    <label><span>First view · rear camera</span><input class="memento-file-input" type="file" accept="image/*" capture="environment"></label>
                    <label><span>Second view · front camera</span><input class="memento-secondary-file-input" type="file" accept="image/*" capture="user"></label>
                </div>
                <small class="memento-capture-hint">Add both views for the iOS-style swappable Memento. Browsers capture them one after the other; one view remains a safe fallback.</small>
                <fieldset class="camera-effect-picker hidden" data-memento-effects><legend>Photo effect</legend><div data-camera-effect-options></div><small>Browser Effects bake supported color and lighting into the photo. Face/body-tracked lenses and filtered video remain available in iOS.</small></fieldset>
                <label>Caption <input class="memento-caption" maxlength="120" placeholder="What are you up to?"></label>
                <p class="memento-audience"><strong>Sharing with</strong> <span></span></p>
                <div class="memento-progress hidden"><span></span></div>
                <p class="memento-status" role="status"></p>
                <button class="primary-button memento-publish" type="submit" disabled>Share to this chat</button>
                <button class="memento-skip" type="button" data-skip-memento>Skip for today</button>
            </form>
        </dialog>
        <dialog class="chat-sheet" data-chat-media-dialog aria-label="Send media">
            <form class="chat-media-form">
                <header><button type="button" data-close-chat-media>Cancel</button><strong>Photo or video</strong><span></span></header>
                <div class="chat-media-preview"><span aria-hidden="true">＋</span><p>Choose a photo, an MP4 video, or an M4A voice recording.</p></div>
                <input class="chat-media-file-input" type="file" accept="image/*,video/mp4">
                <fieldset class="camera-effect-picker hidden" data-chat-media-effects><legend>Photo effect</legend><div data-camera-effect-options></div><small>Browser Effects bake supported color and lighting into the photo. Face/body-tracked lenses and filtered video remain available in iOS.</small></fieldset>
                <label class="chat-audio-input-label">Voice message <input class="chat-audio-file-input" type="file" accept="audio/mp4,.m4a" capture></label>
                <button class="chat-voice-record hidden" type="button" data-record-voice>Record voice message</button>
                <section class="chat-sticker-library"><h2>Saved stickers</h2><div><small>Loading…</small></div></section>
                <label class="chat-media-option"><input type="checkbox" data-chat-view-once> View once <small>Recipients can open it twice.</small></label>
                <label>Text overlay <input class="chat-media-overlay" type="text" maxlength="160" placeholder="Optional text — drag it in the preview"></label>
                <div class="chat-media-progress hidden"><span></span></div>
                <p class="chat-media-status" role="status"></p>
                <button class="primary-button chat-media-publish" type="submit" disabled>Send</button>
            </form>
        </dialog>
        <dialog class="chat-sheet" data-chat-settings-dialog aria-label="Chat settings"><div class="chat-settings-content"></div></dialog>
        <dialog class="chat-sheet" data-chat-reactors-dialog aria-label="Message reactions"><div class="chat-reactors-content"></div></dialog>
        <dialog class="chat-sheet" data-chat-readers-dialog aria-label="Read receipts"><div class="chat-readers-content"></div></dialog>
        <dialog class="chat-media-viewer" data-chat-media-viewer aria-label="Chat media"><button type="button" data-close-media aria-label="Close">×</button><img alt="" hidden><video playsinline controls hidden></video><div class="chat-viewer-overlay" hidden></div><p></p><div class="chat-viewer-actions"><button type="button" data-swap-viewed-memento aria-label="Swap front and back photos" hidden>⇄ Swap views</button><button type="button" data-share-viewed-memento hidden>Share</button><button type="button" data-reply-viewed-media hidden>Reply</button><button type="button" data-react-viewed-media hidden>❤️ React</button></div></dialog>`;

    const $ = (selector) => root.querySelector(selector);
    const $$ = (selector) => [...root.querySelectorAll(selector)];
    const chatMediaOverlay = createMediaOverlayPositioner({
        preview: $(".chat-media-preview"),
        input: $(".chat-media-overlay"),
    });
    const mementoEffectPicker = createCameraEffectPicker({
        fieldset: $("[data-memento-effects]"),
        api,
        onChange: (effect) => reprepareMemento(effect),
    });
    const chatMediaEffectPicker = createCameraEffectPicker({
        fieldset: $("[data-chat-media-effects]"),
        api,
        onChange: (effect) => reprepareSelectedChatPhoto(effect),
    });
    const userId = () => getUser()?.id;
    const dailyLedgerEnabled = () => getConfig()?.enable_chat_daily_ledger === true
        && getConfig()?.enable_web_mementos === true;

    root.addEventListener("click", handleClick);
    root.addEventListener("dblclick", handleMessageDoubleClick);
    root.addEventListener("pointerdown", beginMessageActionHold);
    root.addEventListener("pointerup", cancelMessageActionHold);
    root.addEventListener("pointercancel", cancelMessageActionHold);
    root.addEventListener("pointermove", cancelMessageActionHold);
    $(".chat-composer").addEventListener("submit", sendMessage);
    $(".chat-search-form").addEventListener("submit", searchChats);
    $(".chat-composer textarea").addEventListener("input", handleTypingInput);
    $(".chat-person-search input").addEventListener("input", renderPeople);
    $(".chat-people-list").addEventListener("change", updateCreateState);
    $(".memento-file-input").addEventListener("change", selectMemento);
    $(".memento-secondary-file-input").addEventListener("change", selectMementoSecondary);
    $(".memento-form").addEventListener("submit", publishMemento);
    $("[data-memento-dialog]").addEventListener("close", resetMementoComposer);
    $(".chat-media-file-input").addEventListener("change", selectChatMedia);
    $(".chat-audio-file-input").addEventListener("change", selectChatMedia);
    $(".chat-media-form").addEventListener("submit", publishChatMedia);
    $("[data-chat-media-dialog]").addEventListener("close", resetChatMediaComposer);
    $("[data-chat-view-once]").addEventListener("change", resetChatMediaRequestIds);
    $("[data-chat-media-viewer]").addEventListener("close", resetMediaViewerContents);
    window.addEventListener("online", () => {
        void retryPendingMessages(store.state.activeChatId);
        void retryPendingMediaUploads();
    });

    async function activate(context) {
        activation = context;
        if (!(getConfig()?.enable_chats === true && getConfig()?.enable_web_chats === true)) {
            $(".chat-list-status").textContent = "Chats are not available yet.";
            return;
        }
        if (!store.state.chats.length || Date.now() - lastListLoad > REFRESH_MS) await loadChats();
        startRealtime();
        void retryPendingMediaUploads();
        const requestedChatId = new URLSearchParams(location.search).get("chat");
        if (requestedChatId) await openChat(requestedChatId, { updateHistory: false });
        else {
            store.state.activeChatId = null;
            store.state.detail = null;
            store.state.dailyRow = null;
            store.state.displayedDailyRow = null;
            store.state.dailyRowsByDate.clear();
            showScreen("list");
        }
    }

    async function refresh() {
        if (store.state.activeChatId) await openChat(store.state.activeChatId, { updateHistory: false, force: true });
        else await loadChats();
    }

    function showScreen(name) {
        $$('[data-chat-screen]').forEach((screen) => screen.classList.toggle("hidden", screen.dataset.chatScreen !== name));
        root.closest(".panel")?.classList.toggle("chat-room-open", name === "room");
    }

    async function loadChats({ quiet = false } = {}) {
        if (!userId() || store.state.loadingList) return;
        store.state.loadingList = true;
        if (!quiet) $(".chat-list-status").textContent = store.state.chats.length ? "Refreshing…" : "Loading chats…";
        try {
            const response = await api.getChats(userId(), 100, 0);
            store.replaceChats(response.items || response || []);
            lastListLoad = Date.now();
            renderChatList();
        } catch (error) {
            $(".chat-list-status").textContent = error.message || "Could not load chats.";
        } finally {
            store.state.loadingList = false;
        }
    }

    function renderChatList() {
        const list = $(".chat-list");
        $(".chat-list-status").textContent = "";
        const entries = store.state.chats.map((chat) => ({ key: chat.id, html: chatRowMarkup(chat) }));
        if (!entries.length) {
            list.innerHTML = `<article class="chat-empty"><span>💬</span><h2>No chats yet</h2><p>Start a group and capture today's Memento together.</p><button class="primary-button" type="button" data-new-chat>Start a chat</button></article>`;
        } else {
            reconcileKeyedElements(list, entries);
        }
        const unread = store.state.chats.reduce((total, chat) => total + Number(chat.unread_count || 0), 0);
        onUnreadChange?.(unread);
    }

    async function searchChats(event) {
        event.preventDefault();
        const query = $(".chat-search-form input").value.trim();
        if (query.length < 2) {
            $(".chat-list-status").textContent = "Enter at least two characters.";
            return;
        }
        const results = $(".chat-search-results");
        $(".chat-list-status").textContent = "Searching…";
        try {
            const response = await api.searchChats(userId(), query, 8);
            const chats = response.chats?.items || [];
            const messages = response.messages?.items || [];
            const chatRows = chats.map((item) => `<button type="button" data-search-chat="${escapeChatHTML(item.chat_id)}"><strong>${escapeChatHTML(item.title)}</strong><small>${escapeChatHTML(item.subtitle || "Conversation")}</small></button>`).join("");
            const messageRows = messages.map((item) => `<button type="button" data-search-chat="${escapeChatHTML(item.chat_id)}" data-search-message="${escapeChatHTML(item.id)}"><strong>${escapeChatHTML(item.title)}</strong><small>${escapeChatHTML(item.snippet || item.subtitle || "Message")}</small></button>`).join("");
            results.innerHTML = `${chatRows ? `<section><h2>Chats</h2>${chatRows}</section>` : ""}${messageRows ? `<section><h2>Messages</h2>${messageRows}</section>` : ""}${!chatRows && !messageRows ? `<p>No chat results for “${escapeChatHTML(response.query || query)}”.</p>` : ""}`;
            results.classList.remove("hidden");
            $(".chat-list").classList.add("hidden");
            $(".chat-list-status").textContent = `${chats.length + messages.length} result${chats.length + messages.length === 1 ? "" : "s"}`;
        } catch (error) {
            results.classList.add("hidden");
            $(".chat-list").classList.remove("hidden");
            $(".chat-list-status").textContent = error.message || "Could not search chats.";
        }
    }

    async function openSearchResult(chatId, messageId = null) {
        const url = new URL(location.href);
        url.searchParams.set("tab", "chats");
        url.searchParams.set("chat", chatId);
        if (messageId) url.searchParams.set("message", messageId);
        else url.searchParams.delete("message");
        history.pushState({ validApp: true, panel: "chats", chatId }, "", `${url.pathname}${url.search}`);
        await openChat(chatId, { updateHistory: false, force: Boolean(messageId) });
    }

    function chatRowMarkup(chat) {
        const photo = safeMediaURL(chat.chat_photo_url || chat.pair_profile_picture_url || chat.member_previews?.[0]?.profile_picture_url, api);
        const avatar = photo ? `<img src="${escapeChatHTML(photo)}" alt="" loading="lazy" decoding="async">` : `<span>${escapeChatHTML(chat.display_name.slice(0, 1).toUpperCase())}</span>`;
        if (chat.membership_status === "invited") {
            return `<article class="chat-row invitation" data-list-key="${escapeChatHTML(chat.id)}"><button class="chat-row-main" type="button" data-open-chat="${escapeChatHTML(chat.id)}"><span class="chat-avatar">${avatar}</span><span class="chat-row-copy"><strong>${escapeChatHTML(chat.display_name)}</strong><small>${escapeChatHTML(chatPreview(chat))}</small></span></button><div class="chat-invite-actions"><button type="button" data-decline-chat="${escapeChatHTML(chat.membership_id)}">Decline</button><button type="button" data-accept-chat="${escapeChatHTML(chat.membership_id)}">Accept</button></div></article>`;
        }
        const needsMemento = chatNeedsMemento(chat, dailyLedgerEnabled());
        return `<article class="chat-row ${chat.unread_count || needsMemento ? "attention" : ""}" data-list-key="${escapeChatHTML(chat.id)}"><button class="chat-row-main" type="button" data-open-chat="${escapeChatHTML(chat.id)}"><span class="chat-avatar">${avatar}</span><span class="chat-row-copy"><span><strong>${escapeChatHTML(chat.display_name)}</strong><time>${escapeChatHTML(relativeChatTime(chat.last_message_at || chat.updated_at))}</time></span><small>${escapeChatHTML(needsMemento ? "Take today's Memento" : chatPreview(chat))}</small></span>${chat.unread_count ? `<b class="chat-unread">${Math.min(chat.unread_count, 99)}</b>` : ""}</button></article>`;
    }

    async function openChat(chatId, { updateHistory = true, force = false } = {}) {
        const chat = store.state.chats.find((item) => item.id === String(chatId));
        if (chat?.membership_status === "invited") return;
        const generation = ++roomGeneration;
        store.state.activeChatId = String(chatId);
        store.state.loadingRoom = true;
        store.state.typingUserIds.clear();
        showScreen("room");
        $(".chat-room-status").textContent = "Loading conversation…";
        renderRoomHeader(chat || { display_name: "Chat", accepted_count: 0 });
        if (updateHistory) pushRoomHistory(chatId);
        const cached = store.messages(chatId);
        if (cached.length && !force) renderMessages(false);
        const [detailResult, messagesResult, dailyResult] = await Promise.allSettled([
            api.getChat(userId(), chatId),
            api.getChatMessages(userId(), chatId, { limit: 50 }),
            dailyLedgerEnabled() ? api.getChatDailyRow(userId(), chatId) : Promise.resolve(null),
        ]);
        if (generation !== roomGeneration || store.state.activeChatId !== String(chatId)) return;
        if (detailResult.status === "fulfilled") {
            store.state.detail = detailResult.value;
            store.upsertChat(detailResult.value.chat);
            renderRoomHeader(detailResult.value.chat);
        }
        if (dailyResult.status === "fulfilled") {
            store.state.dailyRow = dailyResult.value;
            store.state.displayedDailyRow = dailyResult.value;
            if (dailyResult.value?.ledger_date) store.state.dailyRowsByDate.set(dailyResult.value.ledger_date, dailyResult.value);
        } else {
            store.state.dailyRow = null;
            store.state.displayedDailyRow = null;
        }
        if (messagesResult.status === "fulfilled") {
            store.replaceMessages(chatId, messagesResult.value.items || [], messagesResult.value);
            $(".chat-room-status").textContent = "";
        } else {
            const locked = messagesResult.reason?.status === 403 && /memento/i.test(messagesResult.reason?.message || "");
            $(".chat-room-status").textContent = locked ? "Take today's Memento to open this chat." : (messagesResult.reason?.message || "Could not load messages.");
        }
        await restorePendingMessages(chatId);
        store.state.loadingRoom = false;
        renderDailyRow();
        renderMessages(true);
        focusDeepLinkedMessage(chatId);
        renderSettings();
        await markRoomRead();
        await loadChats({ quiet: true });
        if (store.state.dailyRow?.view_gate_locked !== true) void retryPendingMessages(chatId);
        const requestedCallId = new URLSearchParams(location.search).get("call");
        if (requestedCallId) void calls.open(requestedCallId);
    }

    function renderRoomHeader(chat) {
        $(".chat-room-title strong").textContent = chat?.display_name || "Chat";
        const acceptedCount = Number(chat?.accepted_count || 0);
        const pendingCount = Number(chat?.pending_count || 0);
        const totalCount = acceptedCount + pendingCount;
        $(".chat-room-title small").textContent = totalCount > 2
            ? `${totalCount} people${pendingCount ? ` · ${pendingCount} invited` : ""}`
            : (store.state.typingUserIds.size ? "typing…" : "Mementos together");
        const callsAvailable = calls.enabled()
            && acceptedCount >= 2
            && chat?.membership_status !== "invited"
            && chat?.has_viewer_blocked_member !== true;
        $(".chat-call-actions").classList.toggle("hidden", !callsAvailable);
    }

    function renderDailyRow() {
        const container = $(".chat-daily-row");
        const row = store.state.displayedDailyRow || store.state.dailyRow;
        if (!dailyLedgerEnabled() || !row) {
            container.innerHTML = "";
            return;
        }
        const today = localLedgerDate();
        const isToday = row.ledger_date === today;
        const posted = Number(row.posted_count || 0);
        const eligible = Number(row.eligible_count || 0);
        const entries = row.entries || [];
        const dateLabel = isToday ? "Today" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${row.ledger_date}T12:00:00`));
        const dateButtons = Array.from({ length: 7 }, (_, index) => {
            const date = new Date();
            date.setHours(12, 0, 0, 0);
            date.setDate(date.getDate() - (6 - index));
            const key = localLedgerDate(date);
            const cached = store.state.dailyRowsByDate.get(key);
            const selected = key === row.ledger_date;
            return `<button type="button" data-memento-date="${key}" class="${selected ? "selected" : ""}" aria-label="${escapeChatHTML(new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(date))}" aria-pressed="${selected}"><small>${escapeChatHTML(new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(date))}</small><strong>${date.getDate()}</strong>${cached ? `<span>${Number(cached.posted_count || 0)}/${Number(cached.eligible_count || 0)}</span>` : `<i></i>`}</button>`;
        }).join("");
        const completion = eligible ? Math.min(100, Math.round((posted / eligible) * 100)) : 0;
        container.innerHTML = `<div class="chat-memento-week" aria-label="Memento dates">${dateButtons}</div><button type="button" data-open-memento ${!isToday || row.viewer_is_eligible === false || row.viewer_has_posted_today ? "data-show-mementos" : ""}><span class="chat-daily-icon">📸</span><span><strong>${isToday ? (row.viewer_has_posted_today ? "Today's Mementos" : "Take today's Memento") : `${dateLabel}'s Mementos`}</strong><small>${posted} of ${eligible} captured${row.view_gate_locked ? " · add yours to reveal" : ""}</small><span class="chat-daily-progress" aria-hidden="true"><i></i></span></span><b>›</b></button><div class="chat-memento-strip">${entries.map((entry) => {
            const src = safeMediaURL(entry.image_url, api);
            const swapped = safeMediaURL(entry.swapped_image_url, api);
            const name = escapeChatHTML(entry.first_name || "Student");
            return src ? `<button type="button" data-view-memento="${escapeChatHTML(src)}" ${swapped ? `data-memento-swapped="${escapeChatHTML(swapped)}"` : ""} data-memento-owner="${escapeChatHTML(displayMember(entry))}" data-memento-entry="${escapeChatHTML(entry.entry_id || "")}"><img src="${escapeChatHTML(src)}" alt="${escapeChatHTML(displayMember(entry))}'s Memento" loading="lazy" decoding="async"><span>${name}</span></button>` : `<span class="chat-memento-missing"><i aria-hidden="true">${entry.has_posted ? "🔒" : "⌛"}</i><span>${name}</span><small>${entry.has_posted ? "Locked" : "Waiting"}</small></span>`;
        }).join("")}</div>`;
        setRuntimeStyles($(".chat-daily-progress i"), { width: `${completion}%` });
        const locked = row.view_gate_locked === true;
        $(".chat-timeline").classList.toggle("chat-content-locked", locked);
        $(".chat-composer").classList.toggle("hidden", locked);
    }

    function renderMessages(scrollToBottom = false) {
        const timeline = $(".chat-timeline");
        if (store.state.dailyRow?.view_gate_locked === true) {
            timeline.classList.add("chat-content-locked");
            timeline.innerHTML = `<div class="chat-room-empty"><strong>Chat locked</strong><p>Take today's Memento to see new messages.</p></div>`;
            $(".chat-load-earlier").classList.add("hidden");
            return;
        }
        timeline.classList.remove("chat-content-locked");
        const items = store.messages();
        const byId = new Map(items.map((message) => [message.id, message]));
        reconcileKeyedElements(timeline, items.map((message, index) => ({
            key: message.id,
            html: messageMarkup(message, byId.get(String(message.reply_to_message_id)), items[index - 1], items[index + 1]),
        })));
        $$(".chat-media-text[data-overlay-x]").forEach((overlay) => setRuntimeStyles(overlay, {
            left: `${Number(overlay.dataset.overlayX) * 100}%`,
            top: `${Number(overlay.dataset.overlayY) * 100}%`,
        }));
        const page = store.state.messagePageByChat.get(String(store.state.activeChatId));
        $(".chat-load-earlier").classList.toggle("hidden", !page?.next_before_sequence || items.length >= MAX_MESSAGES_PER_CHAT);
        if (!items.length && !store.state.loadingRoom && !store.state.dailyRow?.view_gate_locked) timeline.innerHTML = `<div class="chat-room-empty"><strong>Start the conversation</strong><p>Send a message or capture today's Memento.</p></div>`;
        renderReplyDraft();
        if (scrollToBottom) requestAnimationFrame(() => timeline.scrollTo({ top: timeline.scrollHeight, behavior: "auto" }));
    }

    function messageMarkup(message, reply, previous, next) {
        if (message.kind === "system") return `<article class="chat-system-message" data-list-key="${escapeChatHTML(message.id)}"><span>${escapeChatHTML(message.body || "Chat updated")}</span></article>`;
        if (message.kind === "tombstone" || message.status !== "active") return `<article class="chat-system-message" data-list-key="${escapeChatHTML(message.id)}"><span>Message removed</span></article>`;
        const mine = message.viewer_is_sender || String(message.sender_user_id) === String(userId());
        const sharesSequence = (other) => other && other.kind !== "system" && other.status === "active" && String(other.sender_user_id) === String(message.sender_user_id) && Math.abs(new Date(other.created_at) - new Date(message.created_at)) <= 5 * 60 * 1000;
        const startsSequence = !sharesSequence(previous);
        const endsSequence = !sharesSequence(next);
        const replyMarkup = reply ? `<button type="button" class="chat-reply-preview" data-scroll-message="${escapeChatHTML(reply.id)}"><strong>${escapeChatHTML(reply.sender_first_name || "Message")}</strong><span>${escapeChatHTML(reply.kind === "memento" ? "Memento" : reply.kind === "story" ? "Story" : reply.body || "Media")}</span></button>` : "";
        const mediaURL = safeMediaURL(message.kind === "memento" ? message.memento_image_url : message.kind === "story" ? message.story_thumbnail_url || message.story_media_url : message.sticker_image_url || message.photo_image_url || message.video_thumbnail_url, api);
        const mementoSwappedURL = message.kind === "memento" ? safeMediaURL(message.memento_swapped_image_url, api) : null;
        const overlay = message.kind === "story" ? { text: message.story_text_overlay, x: message.story_text_overlay_x, y: message.story_text_overlay_y } : message.media_text_overlay;
        const mediaOverlay = overlay?.text ? `<span class="chat-media-text" data-overlay-x="${Number(overlay.x || 0.5)}" data-overlay-y="${Number(overlay.y || 0.5)}">${escapeChatHTML(overlay.text)}</span>` : "";
        const persistentMedia = mediaURL ? `<button class="chat-message-media ${message.kind === "sticker" ? "sticker" : ""}" type="button" ${message.kind === "memento" ? `data-view-memento="${escapeChatHTML(mediaURL)}" ${mementoSwappedURL ? `data-memento-swapped="${escapeChatHTML(mementoSwappedURL)}"` : ""} data-memento-owner="${escapeChatHTML(message.sender_first_name || "Memento")}" data-memento-entry="${escapeChatHTML(message.daily_entry_id || "")}"` : `data-open-chat-media-message="${escapeChatHTML(message.id)}"`}><img src="${escapeChatHTML(mediaURL)}" alt="${message.kind === "memento" ? "Memento" : message.kind === "video" ? "Video thumbnail" : message.kind === "sticker" ? "Sticker" : "Photo"}" loading="lazy" decoding="async">${mediaOverlay}${message.kind === "video" ? `<span class="chat-video-play" aria-hidden="true">▶</span>` : ""}</button>` : "";
        const audioURL = safeMediaURL(message.audio_url, api);
        const audioMedia = message.kind === "audio" ? (audioURL ? `<div class="chat-audio-message"><strong>Voice message</strong><audio src="${escapeChatHTML(audioURL)}" controls preload="metadata" aria-label="Voice message"></audio><small>${Math.max(1, Math.round(Number(message.audio_duration_ms || 0) / 1000))}s</small></div>` : `<div class="chat-audio-message unavailable">Voice message unavailable</div>`) : "";
        const viewOnceMedia = message.view_once ? (mine
            ? `<div class="chat-view-once-card"><strong>View once ${message.kind}</strong><small>${Number(message.view_once_opened_count || 0)} of ${Number(message.view_once_recipient_count || 0)} opened</small></div>`
            : `<button class="chat-view-once-card" type="button" data-open-view-once="${escapeChatHTML(message.id)}" ${message.view_once_available === false ? "disabled" : ""}><strong>${message.view_once_available === false ? "Opened" : `View once ${message.kind}`}</strong><small>${message.view_once_available === false ? "No views left" : `${Number(message.view_once_remaining_views || 1)} view${Number(message.view_once_remaining_views || 1) === 1 ? "" : "s"} left`}</small></button>`)
            : "";
        const media = audioMedia || (message.view_once ? viewOnceMedia : persistentMedia);
        const body = message.body && message.body !== "Sent a Memento" ? `<p>${escapeChatHTML(message.body)}</p>` : "";
        const reactions = Object.entries(message.reaction_summary || {}).filter(([, count]) => Number(count) > 0).map(([type, count]) => `<span>${CHAT_REACTIONS.find(([key]) => key === type)?.[1] || "♡"} ${count}</span>`).join("");
        const readers = mine && message.delivery_state === "sent" ? readReceiptMembers(message) : [];
        const acceptedOthers = (store.state.detail?.members || []).filter((member) => member.status === "accepted" && String(member.user_id) !== String(userId()));
        const receipt = readers.length ? `<button type="button" class="chat-read-receipt" data-view-readers="${escapeChatHTML(message.id)}">${acceptedOthers.length > 1 ? `Read by ${readers.length}` : "Read"}</button>` : "";
        const viewReceipt = mine && message.view_once ? `<button type="button" class="chat-read-receipt" data-view-once-receipts="${escapeChatHTML(message.id)}">View receipts</button>` : "";
        return `<article class="chat-message ${mine ? "mine" : "theirs"} ${startsSequence ? "starts-sequence" : ""} ${endsSequence ? "ends-sequence" : ""} ${message.delivery_state || ""}" data-list-key="${escapeChatHTML(message.id)}" data-message-id="${escapeChatHTML(message.id)}"><div class="chat-message-meta">${!mine && startsSequence ? `<strong>${escapeChatHTML(message.sender_first_name || "Student")}</strong>` : ""}</div><div class="chat-bubble" data-message-bubble="${escapeChatHTML(message.id)}">${replyMarkup}${media}${message.kind === "memento" ? `<small class="memento-label">✦ Memento</small>` : message.kind === "story" ? `<small class="memento-label">✦ ${message.story_share_context === "reply" ? "Story reply" : "Shared Story"}</small>` : ""}${body}<time>${escapeChatHTML(message.delivery_state === "sending" ? "Sending…" : message.delivery_state === "failed" ? "Not sent" : messageTime(message.created_at))}</time><button class="chat-message-menu-button" type="button" data-message-menu="${escapeChatHTML(message.id)}" aria-label="Message actions" aria-expanded="false">•••</button></div>${message.delivery_state === "failed" ? `<button class="chat-retry" type="button" data-retry-message="${escapeChatHTML(message.client_request_id)}">Retry</button>` : ""}<div class="chat-message-actions"><div class="chat-reaction-picker">${CHAT_REACTIONS.map(([type, emoji]) => `<button type="button" aria-label="React ${type}" data-react-message="${escapeChatHTML(message.id)}" data-reaction="${type}" class="${message.current_user_reaction === type ? "active" : ""}">${emoji}</button>`).join("")}</div><div class="chat-action-list"><button type="button" data-reply-message="${escapeChatHTML(message.id)}">↩ Reply</button>${message.body ? `<button type="button" data-copy-message="${escapeChatHTML(message.id)}">⧉ Copy</button>` : ""}<button type="button" data-delete-message="${escapeChatHTML(message.id)}">Hide for me</button>${mine && message.delivery_state === "sent" ? `<button class="danger" type="button" data-unsend-message="${escapeChatHTML(message.id)}">Unsend</button>` : ""}</div></div>${reactions ? `<button type="button" class="chat-reaction-summary" data-view-reactions="${escapeChatHTML(message.id)}" aria-label="View reactions">${reactions}</button>` : ""}${viewReceipt || receipt}</article>`;
    }

    function readReceiptMembers(message) {
        return (store.state.detail?.members || []).filter((member) => member.status === "accepted"
            && String(member.user_id) !== String(userId())
            && Number(member.last_read_sequence || 0) >= Number(message.room_sequence || 0));
    }

    async function restorePendingMessages(chatId) {
        const records = await listChatTextOutbox(userId()).catch(() => []);
        let sequence = Math.max(0, ...store.messages(chatId).map((message) => message.room_sequence));
        for (const record of records.filter((item) => item.chat_id === String(chatId))) {
            if (store.messages(chatId).some((message) => message.client_request_id === record.client_request_id)) continue;
            sequence += 0.001;
            store.mergeMessages(chatId, [normalizeMessage({
                id: `pending:${record.client_request_id}`,
                client_request_id: record.client_request_id,
                chat_id: record.chat_id,
                room_sequence: sequence,
                sender_user_id: userId(),
                sender_first_name: getUser()?.first_name,
                kind: "text",
                body: record.body,
                reply_to_message_id: record.reply_to_message_id,
                status: "active",
                viewer_is_sender: true,
                created_at: new Date(record.created_at).toISOString(),
                delivery_state: "failed",
            })]);
        }
    }

    function scheduleOutboxRetry(records, chatId = store.state.activeChatId) {
        clearTimeout(outboxRetryTimer);
        outboxRetryTimer = null;
        const next = records
            .filter((record) => record.chat_id === String(chatId)
                && Number(record.attempts || 0) < MAX_AUTOMATIC_ATTEMPTS)
            .reduce((earliest, record) => Math.min(earliest, Number(record.next_attempt_at || 0)), Infinity);
        if (!Number.isFinite(next)) return;
        outboxRetryTimer = setTimeout(
            () => void retryPendingMessages(store.state.activeChatId),
            Math.max(1_000, Math.min(5 * 60_000, next - Date.now())),
        );
    }

    async function retryPendingMessages(chatId) {
        if (!chatId || outboxRetrying || navigator.onLine === false || store.state.dailyRow?.view_gate_locked === true) return;
        outboxRetrying = true;
        try {
            const records = await listChatTextOutbox(userId()).catch(() => []);
            const due = records.filter((record) => record.chat_id === String(chatId)
                && Number(record.attempts || 0) < MAX_AUTOMATIC_ATTEMPTS
                && Number(record.next_attempt_at || 0) <= Date.now()).slice(0, 10);
            for (const record of due) await sendMessage(null, record.client_request_id, { automatic: true });
            scheduleOutboxRetry(await listChatTextOutbox(userId()).catch(() => []));
        } finally {
            outboxRetrying = false;
        }
    }

    function scheduleMediaOutboxRetry(records) {
        clearTimeout(mediaOutboxRetryTimer);
        mediaOutboxRetryTimer = null;
        const next = records
            .filter((record) => ["memento", "chat_media"].includes(record.kind)
                && Number(record.attempts || 0) < MAX_MEDIA_AUTOMATIC_ATTEMPTS)
            .reduce((earliest, record) => Math.min(earliest, Number(record.next_attempt_at || 0)), Infinity);
        if (!Number.isFinite(next)) return;
        mediaOutboxRetryTimer = setTimeout(
            () => void retryPendingMediaUploads(),
            Math.max(2_000, Math.min(5 * 60_000, next - Date.now())),
        );
    }

    async function deliverMediaRecord(record, { onProgress } = {}) {
        if (record.kind === "memento") {
            return deliverMementoRecord(api, userId(), record, { onProgress });
        }
        if (record.kind !== "chat_media") throw new Error("This saved upload is not supported.");
        const session = await api.createChatMediaUpload(userId(), {
            contentType: record.content_type,
            sizeBytes: record.file.size,
            thumbnailSizeBytes: record.thumbnail?.size ?? null,
            durationMs: record.duration_ms,
            viewOnce: record.view_once,
            clientRequestId: record.upload_request_id,
        });
        await api.putDirectUpload(record.file, session, { onProgress: (progress) => onProgress?.(progress * 0.88) });
        if (record.thumbnail && !session.already_finalized) {
            await api.putDirectUpload(record.thumbnail, {
                upload_url: session.thumbnail_upload_url,
                upload_method: session.upload_method,
                required_headers: session.thumbnail_required_headers,
            }, { onProgress: (progress) => onProgress?.(0.88 + progress * 0.1) });
        }
        await api.finalizeChatMediaUpload(userId(), session.media_asset_id);
        return api.sendChatMessage(userId(), record.chat_id, {
            media_asset_id: session.media_asset_id,
            view_once: record.view_once,
            media_text_overlay: record.overlay,
            reply_to_message_id: record.reply_to_message_id,
            client_request_id: record.send_request_id,
        });
    }

    async function retryPendingMediaUploads() {
        if (!userId() || mediaOutboxRetrying || navigator.onLine === false) return;
        mediaOutboxRetrying = true;
        let completed = 0;
        let refreshActiveChat = false;
        try {
            const records = await listChatMediaOutbox(userId()).catch(() => []);
            const due = records.filter((record) => ["memento", "chat_media"].includes(record.kind)
                && Number(record.attempts || 0) < MAX_MEDIA_AUTOMATIC_ATTEMPTS
                && Number(record.next_attempt_at || 0) <= Date.now()).slice(0, 2);
            for (const record of due) {
                if (record.kind === "memento" && record.ledger_date !== localLedgerDate()) {
                    await removeChatMediaOutbox(record.id);
                    showToast?.("An unsent Memento expired at the end of its day.");
                    continue;
                }
                try {
                    await deliverMediaRecord(record);
                    await removeChatMediaOutbox(record.id);
                    completed += 1;
                    refreshActiveChat ||= record.chat_id === store.state.activeChatId
                        || record.chat_ids?.includes(store.state.activeChatId);
                } catch (error) {
                    if (chatTextSendIsRetryable(error)) await markChatMediaOutboxAttempt(record.id);
                    else {
                        await removeChatMediaOutbox(record.id);
                        showToast?.(error.message || "A saved media upload could not be sent.");
                    }
                }
            }
            const remaining = await listChatMediaOutbox(userId()).catch(() => []);
            scheduleMediaOutboxRetry(remaining);
            if (completed) {
                showToast?.(`${completed} saved upload${completed === 1 ? "" : "s"} sent`);
                await loadChats({ quiet: true });
                if (refreshActiveChat) await openChat(store.state.activeChatId, { updateHistory: false, force: true });
            }
        } finally {
            mediaOutboxRetrying = false;
        }
    }

    async function sendMessage(event, retryRequestId = null, { automatic = false } = {}) {
        event?.preventDefault?.();
        const textarea = $(".chat-composer textarea");
        const pendingRecords = retryRequestId ? await listChatTextOutbox(userId()).catch(() => []) : [];
        const persisted = pendingRecords.find((record) => record.client_request_id === retryRequestId);
        const pendingChatId = persisted?.chat_id || store.state.activeChatId;
        const existing = retryRequestId
            ? store.messages(pendingChatId).find((message) => message.client_request_id === retryRequestId)
            : null;
        const body = retryRequestId ? (persisted?.body || existing?.body) : textarea.value.trim();
        if (!body || !pendingChatId) return;
        const chatId = pendingChatId;
        const clientRequestId = retryRequestId || crypto.randomUUID();
        const replyToMessageId = retryRequestId
            ? (persisted?.reply_to_message_id || existing?.reply_to_message_id || null)
            : store.state.replyToMessageId;
        await putChatTextOutbox({
            userId: userId(), chatId, clientRequestId,
            body, replyToMessageId,
        }).catch(() => null);
        const latest = Math.max(0, ...store.messages(chatId).map((message) => message.room_sequence));
        const optimistic = normalizeMessage({
            id: `pending:${clientRequestId}`, client_request_id: clientRequestId,
            chat_id: chatId, room_sequence: latest + 0.5,
            sender_user_id: userId(), sender_first_name: getUser()?.first_name,
            kind: "text", body, reply_to_message_id: replyToMessageId,
            status: "active", viewer_is_sender: true, created_at: new Date().toISOString(),
            delivery_state: "sending",
        });
        store.updateMessage(chatId, optimistic);
        if (!automatic && !retryRequestId && store.state.activeChatId === chatId) {
            textarea.value = "";
            store.state.replyToMessageId = null;
            stopTyping();
        }
        if (!automatic) softHaptic?.();
        if (store.state.activeChatId === chatId) renderMessages(!automatic);
        try {
            const message = await api.sendChatMessage(userId(), chatId, {
                body, reply_to_message_id: replyToMessageId, client_request_id: clientRequestId,
            });
            await removeChatTextOutbox(userId(), clientRequestId).catch(() => null);
            store.updateMessage(chatId, { ...message, delivery_state: "sent" });
            if (store.state.activeChatId === chatId) renderMessages(!automatic);
            if (!automatic) successHaptic?.();
            void loadChats({ quiet: true });
        } catch (error) {
            if (chatTextSendIsRetryable(error)) {
                await markChatTextOutboxAttempt(userId(), clientRequestId).catch(() => null);
            } else {
                await removeChatTextOutbox(userId(), clientRequestId).catch(() => null);
            }
            store.updateMessage(chatId, { ...optimistic, delivery_state: "failed", error_message: error.message });
            if (store.state.activeChatId === chatId) renderMessages(false);
            if (chatTextSendIsRetryable(error)) scheduleOutboxRetry(await listChatTextOutbox(userId()).catch(() => []), chatId);
        }
    }

    async function markRoomRead() {
        const latest = Math.max(0, ...store.messages().map((message) => message.room_sequence));
        if (!latest || !store.state.activeChatId || document.visibilityState === "hidden") return;
        await api.markChatRead(userId(), store.state.activeChatId, Math.floor(latest)).catch(() => null);
    }

    async function loadEarlier() {
        const page = store.state.messagePageByChat.get(String(store.state.activeChatId));
        if (!page?.next_before_sequence) return;
        const response = await api.getChatMessages(userId(), store.state.activeChatId, { limit: 50, beforeSequence: page.next_before_sequence });
        store.mergeMessages(store.state.activeChatId, response.items || [], { prepend: true });
        store.state.messagePageByChat.set(String(store.state.activeChatId), response);
        renderMessages(false);
    }

    async function openCreateChat({ addToCurrent = false } = {}) {
        inviteMode = addToCurrent;
        showScreen("create");
        $("[data-chat-screen='create'] .chat-room-header strong").textContent = addToCurrent ? "Add people" : "New chat";
        $(".chat-create-submit").textContent = addToCurrent ? "Add" : "Create";
        $(".chat-group-name").classList.add("hidden");
        $(".chat-group-name input").value = "";
        $(".chat-person-search input").value = "";
        $(".chat-create-status").textContent = "Loading classmates…";
        try {
            const classmates = await api.getClassmates(userId(), "", 500);
            store.state.createPeople = Array.isArray(classmates) ? classmates : classmates.items || [];
            $(".chat-create-status").textContent = "";
            renderPeople();
        } catch (error) {
            $(".chat-create-status").textContent = error.message || "Could not load classmates.";
        }
    }

    function renderPeople() {
        const query = $(".chat-person-search input").value.trim().toLowerCase();
        const selected = new Set($$(".chat-people-list input:checked").map((input) => input.value));
        const existingMemberIds = new Set(inviteMode ? (store.state.detail?.members || []).map((member) => String(member.user_id)) : []);
        $(".chat-people-list").innerHTML = (store.state.createPeople || []).filter((person) => {
            const id = String(person.user_id || person.id);
            return !existingMemberIds.has(id) && (!query || displayMember(person).toLowerCase().includes(query));
        }).map((person) => {
            const id = String(person.user_id || person.id);
            const image = safeMediaURL(person.profile_picture_url, api);
            return `<label class="chat-person-row">${image ? `<img src="${escapeChatHTML(image)}" alt="" loading="lazy">` : `<span>${escapeChatHTML(displayMember(person).slice(0, 1))}</span>`}<span><strong>${escapeChatHTML(displayMember(person))}</strong><small>${escapeChatHTML(person.grade || "Classmate")}</small></span><input type="checkbox" value="${escapeChatHTML(id)}" ${selected.has(id) ? "checked" : ""}></label>`;
        }).join("") || `<p class="chat-no-people">No classmates found.</p>`;
        updateCreateState();
    }

    function updateCreateState() {
        const count = $$(".chat-people-list input:checked").length;
        $(".chat-create-submit").disabled = count < 1;
        $(".chat-group-name").classList.toggle("hidden", inviteMode || count < 2);
    }

    async function createChat() {
        const button = $(".chat-create-submit");
        const members = $$(".chat-people-list input:checked").map((input) => input.value);
        if (!members.length) return;
        button.disabled = true;
        button.textContent = "Creating…";
        try {
            const chat = inviteMode
                ? await api.inviteChatMembers(userId(), store.state.activeChatId, members)
                : await api.createChat(userId(), members, $(".chat-group-name input").value);
            store.upsertChat(chat);
            renderChatList();
            successHaptic?.();
            const targetChatId = inviteMode ? store.state.activeChatId : chat.id;
            inviteMode = false;
            await openChat(targetChatId, { updateHistory: !store.state.activeChatId, force: true });
        } catch (error) {
            $(".chat-create-status").textContent = error.message || "Could not create the chat.";
        } finally {
            button.textContent = "Create";
            button.disabled = false;
        }
    }

    async function acceptInvitation(membershipId) {
        try {
            const chat = await api.acceptChatInvitation(userId(), membershipId);
            store.upsertChat(chat);
            renderChatList();
            successHaptic?.();
            await openChat(chat.id);
        } catch (error) { showToast?.(error.message || "Could not accept the invitation."); }
    }

    async function declineInvitation(membershipId) {
        if (!confirm("Decline this chat invitation?")) return;
        try {
            await api.declineChatInvitation(userId(), membershipId);
            await loadChats();
        } catch (error) { showToast?.(error.message || "Could not decline the invitation."); }
    }

    function openMementoComposer({ showExisting = false } = {}) {
        const row = store.state.displayedDailyRow || store.state.dailyRow;
        if (showExisting || row?.viewer_has_posted_today || row?.viewer_is_eligible === false) {
            const first = (row?.entries || []).find((entry) => entry.image_url);
            if (first) return viewMemento(
                safeMediaURL(first.image_url, api),
                displayMember(first),
                first.entry_id || null,
                safeMediaURL(first.swapped_image_url, api),
            );
            return showToast?.(row?.viewer_is_eligible === false ? "You can start posting Mementos tomorrow." : "No Mementos are available yet.");
        }
        if (!store.state.activeChatId) return;
        renderMementoAudience();
        $(".memento-skip").classList.toggle("hidden", row?.view_gate_locked !== true);
        $("[data-memento-dialog]").showModal();
        void mementoEffectPicker.load();
    }

    function renderMementoAudience() {
        const activeChat = store.state.chats.find((chat) => String(chat.id) === String(store.state.activeChatId));
        $(".memento-audience span").textContent = activeChat?.display_name || store.state.detail?.display_name || "this chat";
    }

    async function skipMementoForToday() {
        if (!store.state.activeChatId || !confirm("Skip today's Memento and unlock this chat?")) return;
        const button = $(".memento-skip");
        button.disabled = true;
        button.textContent = "Skipping…";
        try {
            await api.skipChatMemento(userId(), store.state.activeChatId);
            $("[data-memento-dialog]").close();
            showToast?.("Chat unlocked for today");
            await openChat(store.state.activeChatId, { updateHistory: false, force: true });
        } catch (error) {
            $(".memento-status").textContent = error.message || "Could not skip today's Memento.";
        } finally {
            button.disabled = false;
            button.textContent = "Skip for today";
        }
    }

    async function selectMemento(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        selectedMementoSourceFile = file;
        mementoFrontIsPrimary = false;
        mementoEffectPicker.setMediaKind("photo");
        await prepareSelectedMemento(file, mementoEffectPicker.value());
    }

    async function selectMementoSecondary(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        selectedMementoSecondarySourceFile = file;
        mementoFrontIsPrimary = false;
        if (!selectedMementoSourceFile) {
            $(".memento-status").textContent = "Add the first view, then Six7 will prepare both together.";
            return;
        }
        mementoEffectPicker.setMediaKind("photo");
        await prepareSelectedMemento(selectedMementoSourceFile, mementoEffectPicker.value());
    }

    async function reprepareMemento(effect) {
        if (!selectedMementoSourceFile) return;
        await prepareSelectedMemento(selectedMementoSourceFile, effect);
    }

    async function prepareSelectedMemento(file, photoEffect) {
        const generation = ++mementoPreparationGeneration;
        $(".memento-status").textContent = "Preparing photo…";
        $(".memento-publish").disabled = true;
        mementoEffectPicker.setDisabled(true);
        mementoRequestId = null;
        try {
            const prepared = await prepareMementoImages(file, selectedMementoSecondarySourceFile, { photoEffect });
            if (generation !== mementoPreparationGeneration) return;
            selectedMementoFile = mementoFrontIsPrimary && prepared.swapped ? prepared.swapped : prepared.primary;
            selectedMementoSecondaryFile = mementoFrontIsPrimary && prepared.swapped ? prepared.primary : prepared.swapped;
            renderSelectedMementoPreview();
            $(".memento-status").textContent = prepared.swapped
                ? `${mementoFrontIsPrimary ? "Front" : "Rear"} view is primary · tap the inset to swap`
                : "Ready to share · add the second view for a swappable Memento";
            $(".memento-publish").disabled = false;
        } catch (error) {
            if (generation !== mementoPreparationGeneration) return;
            selectedMementoFile = null;
            selectedMementoSecondaryFile = null;
            $(".memento-status").textContent = error.message || "Could not prepare that photo.";
        } finally {
            if (generation === mementoPreparationGeneration) mementoEffectPicker.setDisabled(false);
        }
    }

    function renderSelectedMementoPreview() {
        if (selectedMementoPreview) URL.revokeObjectURL(selectedMementoPreview);
        selectedMementoPreview = selectedMementoFile ? URL.createObjectURL(selectedMementoFile) : null;
        $(".memento-preview").innerHTML = selectedMementoPreview
            ? `<img src="${escapeChatHTML(selectedMementoPreview)}" alt="Memento preview">${selectedMementoSecondaryFile ? '<button class="memento-preview-swap" type="button" data-swap-memento-capture aria-label="Swap front and back photos"></button>' : ""}`
            : `<span aria-hidden="true">📸</span><p>Capture one real moment from today.</p>`;
    }

    function swapSelectedMementoViews() {
        if (!selectedMementoFile || !selectedMementoSecondaryFile) return;
        [selectedMementoFile, selectedMementoSecondaryFile] = [selectedMementoSecondaryFile, selectedMementoFile];
        mementoFrontIsPrimary = !mementoFrontIsPrimary;
        mementoRequestId = null;
        renderSelectedMementoPreview();
        $(".memento-status").textContent = `${mementoFrontIsPrimary ? "Front" : "Rear"} view is primary · tap the inset to swap`;
    }

    async function publishMemento(event) {
        event.preventDefault();
        if (!selectedMementoFile || !store.state.activeChatId) return;
        const chatIds = [String(store.state.activeChatId)];
        const button = $(".memento-publish");
        button.disabled = true;
        button.textContent = "Sharing…";
        $(".memento-file-input").disabled = true;
        $(".memento-secondary-file-input").disabled = true;
        $(".memento-caption").disabled = true;
        mementoEffectPicker.setDisabled(true);
        $(".memento-skip").disabled = true;
        $(".memento-progress").classList.remove("hidden");
        let recoverySaved = false;
        try {
            mementoRequestId ||= crypto.randomUUID();
            const record = {
                id: `${userId()}:memento:${mementoRequestId}`,
                user_id: userId(),
                kind: "memento",
                file: selectedMementoFile,
                secondary: selectedMementoSecondaryFile,
                chat_id: chatIds[0],
                chat_ids: chatIds,
                caption: $(".memento-caption").value.trim() || null,
                ledger_date: localLedgerDate(),
                request_id: mementoRequestId,
            };
            await putChatMediaOutbox(record);
            recoverySaved = true;
            const result = await deliverMediaRecord(record, { onProgress: (progress) => setRuntimeStyles($(".memento-progress span"), { width: `${Math.round(progress * 100)}%` }) });
            await removeChatMediaOutbox(record.id);
            $("[data-memento-dialog]").close();
            successHaptic?.();
            showToast?.(`Memento shared${result.aura_points_earned ? ` · +${result.aura_points_earned} Aura` : ""}`);
            await openChat(store.state.activeChatId, { updateHistory: false, force: true });
        } catch (error) {
            if (recoverySaved && chatTextSendIsRetryable(error)) {
                await markChatMediaOutboxAttempt(`${userId()}:memento:${mementoRequestId}`).catch(() => null);
                $(".memento-status").textContent = `${error.message || "Could not share your Memento."} It is saved on this device and will retry while Six7 is open.`;
            } else {
                await removeChatMediaOutbox(`${userId()}:memento:${mementoRequestId}`).catch(() => null);
                $(".memento-status").textContent = recoverySaved
                    ? (error.message || "Could not share your Memento.")
                    : "This Memento could not be saved for a safe retry. Free some device storage and try again.";
            }
        } finally {
            button.textContent = "Share to this chat";
            button.disabled = !selectedMementoFile;
            mementoEffectPicker.setDisabled(false);
        }
    }

    function resetMementoComposer() {
        mementoPreparationGeneration += 1;
        selectedMementoFile = null;
        selectedMementoSecondaryFile = null;
        selectedMementoSourceFile = null;
        selectedMementoSecondarySourceFile = null;
        mementoFrontIsPrimary = false;
        mementoRequestId = null;
        if (selectedMementoPreview) URL.revokeObjectURL(selectedMementoPreview);
        selectedMementoPreview = null;
        mementoEffectPicker.reset();
        $(".memento-file-input").value = "";
        $(".memento-file-input").disabled = false;
        $(".memento-secondary-file-input").value = "";
        $(".memento-secondary-file-input").disabled = false;
        $(".memento-caption").value = "";
        $(".memento-caption").disabled = false;
        $(".memento-audience span").textContent = "";
        $(".memento-skip").disabled = false;
        $(".memento-preview").innerHTML = `<span aria-hidden="true">📸</span><p>Capture one real moment from today.</p>`;
        $(".memento-status").textContent = "";
        $(".memento-progress").classList.add("hidden");
        setRuntimeStyles($(".memento-progress span"), { width: "0" });
    }

    function openChatMediaComposer() {
        if (!store.state.activeChatId) return;
        const recordButton = $("[data-record-voice]");
        recordButton.classList.toggle("hidden", !compatibleAudioRecordingType());
        $("[data-chat-media-dialog]").showModal();
        void loadStickerLibrary();
        void chatMediaEffectPicker.load();
    }

    async function loadStickerLibrary() {
        const container = $(".chat-sticker-library div");
        container.innerHTML = `<small>Loading…</small>`;
        try {
            const response = await api.getStickers();
            const stickers = (response.stickers || []).slice(0, 50);
            container.innerHTML = stickers.map((sticker) => {
                const url = safeMediaURL(sticker.image_url, api);
                return url ? `<button type="button" data-send-sticker="${escapeChatHTML(sticker.id)}" aria-label="Send saved sticker"><img src="${escapeChatHTML(url)}" alt="" loading="lazy"></button>` : "";
            }).join("") || `<small>No saved stickers yet. Create stickers in the iOS camera editor.</small>`;
        } catch (error) {
            container.innerHTML = `<small>${escapeChatHTML(error.message || "Could not load stickers.")}</small>`;
        }
    }

    async function sendSticker(stickerId) {
        if (!stickerId || !store.state.activeChatId) return;
        const chatId = store.state.activeChatId;
        const clientRequestId = stickerRequestById.get(stickerId) || crypto.randomUUID();
        stickerRequestById.set(stickerId, clientRequestId);
        $$("[data-send-sticker]").forEach((button) => { button.disabled = true; });
        try {
            const message = await api.sendChatMessage(userId(), chatId, {
                sticker_id: stickerId,
                reply_to_message_id: store.state.replyToMessageId || null,
                client_request_id: clientRequestId,
            });
            stickerRequestById.delete(stickerId);
            store.updateMessage(chatId, message);
            store.state.replyToMessageId = null;
            $("[data-chat-media-dialog]").close();
            renderMessages(true);
            successHaptic?.();
            void loadChats({ quiet: true });
        } catch (error) {
            $$("[data-send-sticker]").forEach((button) => { button.disabled = false; });
            $(".chat-media-status").textContent = `${error.message || "Could not send that sticker."} Tap the same sticker to retry safely.`;
        }
    }

    function resetChatMediaRequestIds() {
        chatMediaUploadRequestId = null;
        chatMediaSendRequestId = null;
    }

    async function prepareSelectedChatMedia(file, { durationMsHint = null, photoEffect = null, retainSource = false } = {}) {
        if (!file) return;
        const isPhotoSource = file.type.startsWith("image/");
        if (!retainSource) {
            selectedChatMediaSourceFile = isPhotoSource ? file : null;
            if (!isPhotoSource) chatMediaEffectPicker.reset();
            $(".chat-media-overlay").value = "";
            chatMediaOverlay.reset();
        }
        const generation = ++chatMediaPreparationGeneration;
        $(".chat-media-status").textContent = "Preparing media…";
        $(".chat-media-publish").disabled = true;
        $(".chat-media-overlay").disabled = true;
        chatMediaOverlay.setDisabled(true);
        chatMediaEffectPicker.setDisabled(true);
        resetChatMediaRequestIds();
        try {
            const prepared = await prepareChatMedia(file, {
                durationMsHint,
                photoEffect: isPhotoSource ? (photoEffect || chatMediaEffectPicker.value()) : null,
            });
            if (generation !== chatMediaPreparationGeneration) return;
            selectedChatMedia = prepared;
            if (selectedChatMediaPreview) URL.revokeObjectURL(selectedChatMediaPreview);
            selectedChatMediaPreview = URL.createObjectURL(selectedChatMedia.file);
            $(".chat-media-preview").innerHTML = selectedChatMedia.kind === "audio"
                ? `<audio src="${escapeChatHTML(selectedChatMediaPreview)}" controls aria-label="Voice message preview"></audio>`
                : selectedChatMedia.kind === "video"
                ? `<video src="${escapeChatHTML(selectedChatMediaPreview)}" muted playsinline controls aria-label="Video preview"></video>`
                : `<img src="${escapeChatHTML(selectedChatMediaPreview)}" alt="Photo preview">`;
            const isAudio = selectedChatMedia.kind === "audio";
            chatMediaEffectPicker.setMediaKind(selectedChatMedia.kind);
            $("[data-chat-view-once]").checked = false;
            $("[data-chat-view-once]").disabled = isAudio;
            chatMediaOverlay.mount();
            $(".chat-media-status").textContent = isAudio ? "Voice message ready to send" : selectedChatMedia.kind === "video" ? "Video ready to send" : "Photo ready to send";
            $(".chat-media-publish").disabled = false;
        } catch (error) {
            if (generation !== chatMediaPreparationGeneration) return;
            selectedChatMedia = null;
            $(".chat-media-status").textContent = error.message || "Could not prepare that media.";
        } finally {
            if (generation === chatMediaPreparationGeneration) {
                const disableOverlay = selectedChatMedia?.kind === "audio";
                $(".chat-media-overlay").disabled = disableOverlay;
                chatMediaOverlay.setDisabled(disableOverlay);
                chatMediaEffectPicker.setDisabled(false);
            }
        }
    }

    async function reprepareSelectedChatPhoto(effect) {
        if (!selectedChatMediaSourceFile) return;
        await prepareSelectedChatMedia(selectedChatMediaSourceFile, { photoEffect: effect, retainSource: true });
    }

    async function selectChatMedia(event) {
        await prepareSelectedChatMedia(event.target.files?.[0]);
    }

    function voiceRecordingElapsed() {
        return Math.max(1, Math.min(MAX_VOICE_RECORDING_MS, Date.now() - voiceRecordingStartedAt));
    }

    function updateVoiceRecordingButton() {
        const elapsedSeconds = Math.floor(voiceRecordingElapsed() / 1000);
        $("[data-record-voice]").textContent = `Stop · ${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
    }

    function clearVoiceRecordingState() {
        clearInterval(voiceRecordingTimer);
        voiceRecordingTimer = null;
        voiceRecordingStartedAt = 0;
        voiceRecorder = null;
        const button = $("[data-record-voice]");
        button.textContent = "Record voice message";
        button.classList.remove("recording");
        button.disabled = false;
    }

    function stopVoiceRecorder({ discard = false } = {}) {
        if (!voiceRecorder) return;
        discardVoiceRecording = discard;
        const recorder = voiceRecorder;
        if (recorder.state !== "inactive") recorder.stop();
        recorder.stream?.getTracks().forEach((track) => track.stop());
    }

    async function toggleVoiceRecording() {
        if (voiceRecorder) {
            stopVoiceRecorder();
            return;
        }
        const mimeType = compatibleAudioRecordingType();
        if (!mimeType) {
            $(".chat-media-status").textContent = "Live recording is unavailable here. Choose an M4A voice recording instead.";
            return;
        }
        const button = $("[data-record-voice]");
        button.disabled = true;
        $(".chat-media-status").textContent = "Requesting microphone access…";
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (!$('[data-chat-media-dialog]').open) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }
            const recorder = new MediaRecorder(stream, { mimeType });
            const chunks = [];
            voiceRecorder = recorder;
            discardVoiceRecording = false;
            recorder.addEventListener("dataavailable", (event) => {
                if (event.data?.size) chunks.push(event.data);
            });
            recorder.addEventListener("error", () => {
                $(".chat-media-status").textContent = "Voice recording stopped unexpectedly. Try again or choose an M4A file.";
                recorder.stream.getTracks().forEach((track) => track.stop());
                clearVoiceRecordingState();
            }, { once: true });
            recorder.addEventListener("stop", async () => {
                const durationMs = voiceRecordingElapsed();
                const discarded = discardVoiceRecording;
                recorder.stream.getTracks().forEach((track) => track.stop());
                clearVoiceRecordingState();
                if (discarded || !chunks.length) return;
                const file = new File(chunks, "voice.m4a", { type: "audio/mp4", lastModified: Date.now() });
                await prepareSelectedChatMedia(file, { durationMsHint: durationMs });
            }, { once: true });
            recorder.start(1000);
            voiceRecordingStartedAt = Date.now();
            button.disabled = false;
            button.classList.add("recording");
            updateVoiceRecordingButton();
            voiceRecordingTimer = setInterval(() => {
                updateVoiceRecordingButton();
                if (voiceRecordingElapsed() >= MAX_VOICE_RECORDING_MS) stopVoiceRecorder();
            }, 250);
            $(".chat-media-status").textContent = "Recording locally. Tap Stop when you're done.";
        } catch (error) {
            clearVoiceRecordingState();
            $(".chat-media-status").textContent = error?.name === "NotAllowedError"
                ? "Microphone access was not allowed. Choose an M4A voice recording instead."
                : "Could not start voice recording. Choose an M4A voice recording instead.";
        }
    }

    async function publishChatMedia(event) {
        event.preventDefault();
        if (!selectedChatMedia || !store.state.activeChatId) return;
        const chatId = store.state.activeChatId;
        const mediaKind = selectedChatMedia.kind;
        const button = $(".chat-media-publish");
        const viewOnce = selectedChatMedia.kind !== "audio" && $("[data-chat-view-once]").checked;
        const overlayText = selectedChatMedia.kind === "audio" ? "" : $(".chat-media-overlay").value.trim();
        const overlayPosition = chatMediaOverlay.value();
        chatMediaUploadRequestId ||= crypto.randomUUID();
        chatMediaSendRequestId ||= crypto.randomUUID();
        button.disabled = true;
        button.textContent = "Sending…";
        $(".chat-media-file-input").disabled = true;
        $(".chat-audio-file-input").disabled = true;
        $("[data-chat-view-once]").disabled = true;
        $(".chat-media-overlay").disabled = true;
        chatMediaOverlay.setDisabled(true);
        chatMediaEffectPicker.setDisabled(true);
        $(".chat-media-progress").classList.remove("hidden");
        $(".chat-media-status").textContent = "Starting secure upload…";
        let recoverySaved = false;
        try {
            const record = {
                id: `${userId()}:chat-media:${chatMediaUploadRequestId}`,
                user_id: userId(),
                kind: "chat_media",
                file: selectedChatMedia.file,
                thumbnail: selectedChatMedia.thumbnail || null,
                chat_id: chatId,
                content_type: selectedChatMedia.file.type,
                duration_ms: selectedChatMedia.durationMs,
                view_once: viewOnce,
                overlay: overlayText ? { text: overlayText, ...overlayPosition } : null,
                reply_to_message_id: store.state.replyToMessageId || null,
                upload_request_id: chatMediaUploadRequestId,
                send_request_id: chatMediaSendRequestId,
            };
            await putChatMediaOutbox(record);
            recoverySaved = true;
            const message = await deliverMediaRecord(record, { onProgress: (progress) => {
                setRuntimeStyles($(".chat-media-progress span"), { width: `${Math.round(progress * 100)}%` });
            } });
            await removeChatMediaOutbox(record.id);
            setRuntimeStyles($(".chat-media-progress span"), { width: "100%" });
            store.updateMessage(chatId, message);
            store.state.replyToMessageId = null;
            $("[data-chat-media-dialog]").close();
            renderMessages(true);
            successHaptic?.();
            showToast?.(`${mediaKind === "audio" ? "Voice message" : mediaKind === "video" ? "Video" : "Photo"} sent${viewOnce ? " · view once" : ""}`);
            void loadChats({ quiet: true });
        } catch (error) {
            const recordId = `${userId()}:chat-media:${chatMediaUploadRequestId}`;
            if (recoverySaved && chatTextSendIsRetryable(error)) {
                await markChatMediaOutboxAttempt(recordId).catch(() => null);
                $(".chat-media-status").textContent = `${error.message || "Could not send that media."} It is saved on this device and will retry while Six7 is open.`;
            } else {
                await removeChatMediaOutbox(recordId).catch(() => null);
                $(".chat-media-status").textContent = recoverySaved
                    ? `${error.message || "Could not send that media."} Your selection is still here to retry.`
                    : "This media could not be saved for a safe retry. Free some device storage and try again.";
            }
        } finally {
            button.textContent = "Send";
            button.disabled = !selectedChatMedia;
            chatMediaEffectPicker.setDisabled(false);
        }
    }

    function resetChatMediaComposer() {
        chatMediaPreparationGeneration += 1;
        stopVoiceRecorder({ discard: true });
        if (!voiceRecorder) clearVoiceRecordingState();
        selectedChatMedia = null;
        selectedChatMediaSourceFile = null;
        if (selectedChatMediaPreview) URL.revokeObjectURL(selectedChatMediaPreview);
        selectedChatMediaPreview = null;
        chatMediaOverlay.reset();
        chatMediaEffectPicker.reset();
        resetChatMediaRequestIds();
        $(".chat-media-file-input").value = "";
        $(".chat-media-file-input").disabled = false;
        $(".chat-audio-file-input").value = "";
        $(".chat-audio-file-input").disabled = false;
        $("[data-chat-view-once]").checked = false;
        $("[data-chat-view-once]").disabled = false;
        $(".chat-media-overlay").value = "";
        $(".chat-media-overlay").disabled = false;
        $(".chat-media-preview").innerHTML = `<span aria-hidden="true">＋</span><p>Choose a photo, an MP4 video, or an M4A voice recording.</p>`;
        $(".chat-media-status").textContent = "";
        $(".chat-media-progress").classList.add("hidden");
        setRuntimeStyles($(".chat-media-progress span"), { width: "0" });
        $(".chat-media-publish").disabled = true;
    }

    async function loadMementoDay(offset) {
        const row = store.state.displayedDailyRow || store.state.dailyRow;
        if (!row || !store.state.activeChatId) return;
        const date = new Date(`${row.ledger_date}T12:00:00`);
        date.setDate(date.getDate() + Number(offset));
        const target = localLedgerDate(date);
        const today = localLedgerDate();
        if (target > today) return;
        try {
            store.state.displayedDailyRow = await api.getChatDailyRow(userId(), store.state.activeChatId, target);
            store.state.dailyRowsByDate.set(target, store.state.displayedDailyRow);
            renderDailyRow();
        } catch (error) { showToast?.(error.message || "Could not load that Memento day."); }
    }

    async function loadMementoDate(target) {
        if (!target || target > localLedgerDate() || !store.state.activeChatId) return;
        const cached = store.state.dailyRowsByDate.get(target);
        if (cached) {
            store.state.displayedDailyRow = cached;
            renderDailyRow();
            return;
        }
        try {
            store.state.displayedDailyRow = await api.getChatDailyRow(userId(), store.state.activeChatId, target);
            store.state.dailyRowsByDate.set(target, store.state.displayedDailyRow);
            renderDailyRow();
        } catch (error) { showToast?.(error.message || "Could not load that Memento day."); }
    }

    async function showMediaViewer(url, { kind = "photo", label = "Media", overlay = null } = {}) {
        if (!url) throw new Error("That media is no longer available.");
        const dialog = $("[data-chat-media-viewer]");
        const image = dialog.querySelector("img");
        const video = dialog.querySelector("video");
        const target = kind === "video" ? video : image;
        image.hidden = kind === "video";
        video.hidden = kind !== "video";
        image.removeAttribute("src");
        video.removeAttribute("src");
        target.src = url;
        image.alt = kind === "video" ? "" : label;
        if (kind === "video") video.setAttribute("aria-label", label);
        else video.removeAttribute("aria-label");
        dialog.querySelector("p").textContent = label;
        const overlayNode = dialog.querySelector(".chat-viewer-overlay");
        overlayNode.hidden = !overlay?.text;
        overlayNode.textContent = overlay?.text || "";
        if (overlay?.text) {
            setRuntimeStyles(overlayNode, {
                left: `${Number(overlay.x || 0.5) * 100}%`,
                top: `${Number(overlay.y || 0.5) * 100}%`,
            });
        }
        dialog.showModal();
        await Promise.race([
            kind === "video" ? new Promise((resolve, reject) => {
                video.addEventListener("loadedmetadata", resolve, { once: true });
                video.addEventListener("error", () => reject(new Error("That video could not be opened.")), { once: true });
            }) : image.decode(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("That media took too long to open.")), 10_000)),
        ]);
    }

    function viewMemento(url, owner, entryId = null, swappedURL = null) {
        viewedMementoEntryId = entryId ? String(entryId) : null;
        viewedMessageId = entryId ? store.messages().find((message) => String(message.daily_entry_id || "") === String(entryId))?.id || null : null;
        viewedMementoPrimaryURL = url;
        viewedMementoSwappedURL = swappedURL && swappedURL !== url ? swappedURL : null;
        viewedMementoShowsSwapped = false;
        const swapButton = $("[data-swap-viewed-memento]");
        swapButton.hidden = !viewedMementoSwappedURL;
        swapButton.disabled = false;
        swapButton.textContent = "⇄ Alternate view";
        swapButton.setAttribute("aria-label", "Show alternate Memento view");
        $("[data-share-viewed-memento]").hidden = !viewedMementoEntryId;
        $("[data-reply-viewed-media]").hidden = !viewedMessageId;
        $("[data-react-viewed-media]").hidden = !viewedMessageId;
        void showMediaViewer(url, { label: `${owner || "Memento"} · preserved in this chat` }).catch((error) => showToast?.(error.message));
    }

    async function swapViewedMemento() {
        if (!viewedMementoPrimaryURL || !viewedMementoSwappedURL) return;
        const image = $("[data-chat-media-viewer] img");
        const button = $("[data-swap-viewed-memento]");
        const previousURL = image.getAttribute("src");
        const nextShowsSwapped = !viewedMementoShowsSwapped;
        const nextURL = nextShowsSwapped ? viewedMementoSwappedURL : viewedMementoPrimaryURL;
        button.disabled = true;
        image.src = nextURL;
        try {
            await Promise.race([
                image.decode(),
                new Promise((_, reject) => setTimeout(() => reject(new Error("That Memento view took too long to open.")), 10_000)),
            ]);
            viewedMementoShowsSwapped = nextShowsSwapped;
            button.textContent = viewedMementoShowsSwapped ? "⇄ Primary view" : "⇄ Alternate view";
            button.setAttribute("aria-label", viewedMementoShowsSwapped ? "Show primary Memento view" : "Show alternate Memento view");
        } catch (error) {
            if (previousURL) image.src = previousURL;
            showToast?.(error.message || "That Memento view could not be opened.");
        } finally {
            button.disabled = false;
        }
    }

    function closeMediaViewer() {
        const dialog = $("[data-chat-media-viewer]");
        dialog.close();
    }

    function resetMediaViewerContents() {
        const dialog = $("[data-chat-media-viewer]");
        const video = dialog.querySelector("video");
        video.pause();
        video.removeAttribute("src");
        video.load();
        const image = dialog.querySelector("img");
        image.removeAttribute("src");
        image.alt = "";
        video.removeAttribute("aria-label");
        dialog.querySelector(".chat-viewer-overlay").textContent = "";
        viewedMessageId = null;
        viewedMementoEntryId = null;
        viewedMementoPrimaryURL = null;
        viewedMementoSwappedURL = null;
        viewedMementoShowsSwapped = false;
        $("[data-swap-viewed-memento]").hidden = true;
        $("[data-share-viewed-memento]").hidden = true;
        $("[data-reply-viewed-media]").hidden = true;
        $("[data-react-viewed-media]").hidden = true;
    }

    function replyToViewedMedia() {
        if (!viewedMessageId) return;
        const message = store.messages().find((item) => item.id === viewedMessageId);
        if (!message) return;
        store.state.replyToMessageId = viewedMessageId;
        closeMediaViewer();
        renderReplyDraft();
        $(".chat-composer textarea").focus({ preventScroll: true });
    }

    async function reactToViewedMedia() {
        if (!viewedMessageId) return;
        const messageId = viewedMessageId;
        closeMediaViewer();
        await reactToMessage(messageId, "love");
    }

    async function shareViewedMemento() {
        if (!viewedMementoEntryId || !store.state.activeChatId) return;
        const entryId = viewedMementoEntryId;
        const key = `${store.state.activeChatId}:${entryId}`;
        const clientRequestId = mementoShareRequestByEntry.get(key) || crypto.randomUUID();
        mementoShareRequestByEntry.set(key, clientRequestId);
        if (mementoShareRequestByEntry.size > 20) mementoShareRequestByEntry.delete(mementoShareRequestByEntry.keys().next().value);
        const button = $("[data-share-viewed-memento]");
        button.disabled = true;
        try {
            const message = await api.sendChatMessage(userId(), store.state.activeChatId, {
                daily_entry_id: entryId,
                reply_to_message_id: store.state.replyToMessageId || null,
                client_request_id: clientRequestId,
            });
            mementoShareRequestByEntry.delete(key);
            store.updateMessage(store.state.activeChatId, message);
            store.state.replyToMessageId = null;
            closeMediaViewer();
            renderMessages(true);
            successHaptic?.();
            showToast?.("Memento shared");
            void loadChats({ quiet: true });
        } catch (error) {
            button.disabled = false;
            showToast?.(`${error.message || "Could not share that Memento."} Tap Share to retry safely.`);
        }
    }

    function openPersistentChatMedia(messageId) {
        const message = store.messages().find((item) => item.id === messageId);
        if (!message || message.view_once) return;
        const isStory = message.kind === "story";
        const kind = isStory ? message.story_media_type : message.kind === "video" ? "video" : "photo";
        const url = safeMediaURL(isStory ? (message.story_is_available === false ? null : message.story_media_url) : kind === "video" ? message.video_url : message.sticker_image_url || message.photo_image_url, api);
        const overlay = isStory ? { text: message.story_text_overlay, x: message.story_text_overlay_x, y: message.story_text_overlay_y } : message.media_text_overlay;
        void showMediaViewer(url, { kind, label: isStory ? `${message.story_owner_first_name || "Student"} · Story` : `${message.sender_first_name || "Student"} · ${kind}`, overlay }).catch((error) => showToast?.(error.message));
    }

    function rememberedViewOnceSession(messageId) {
        if (viewOnceSessionByMessage.has(messageId)) return viewOnceSessionByMessage.get(messageId);
        try {
            const entries = JSON.parse(sessionStorage.getItem("valid:view-once-sessions") || "[]");
            const entry = entries.find((item) => item.user_id === String(userId()) && item.chat_id === String(store.state.activeChatId) && item.message_id === String(messageId));
            if (entry?.session_id) viewOnceSessionByMessage.set(messageId, entry.session_id);
            return entry?.session_id || null;
        } catch (_) { return null; }
    }

    function rememberViewOnceSession(messageId, sessionId) {
        viewOnceSessionByMessage.set(messageId, sessionId);
        try {
            const entries = JSON.parse(sessionStorage.getItem("valid:view-once-sessions") || "[]").filter((item) => !(item.user_id === String(userId()) && item.chat_id === String(store.state.activeChatId) && item.message_id === String(messageId)));
            entries.push({ user_id: String(userId()), chat_id: String(store.state.activeChatId), message_id: String(messageId), session_id: String(sessionId) });
            sessionStorage.setItem("valid:view-once-sessions", JSON.stringify(entries.slice(-20)));
        } catch (_) { /* Session-only replay hints are optional. */ }
    }

    async function openViewOnceMessage(messageId) {
        const message = store.messages().find((item) => item.id === messageId);
        if (!message || message.viewer_is_sender || message.view_once_available === false) return;
        try {
            const replayOfSessionId = rememberedViewOnceSession(messageId);
            const clientRequestId = viewOnceRequestByMessage.get(messageId) || crypto.randomUUID();
            viewOnceRequestByMessage.set(messageId, clientRequestId);
            const session = await api.beginChatMediaViewSession(userId(), store.state.activeChatId, {
                messageId: replayOfSessionId ? null : messageId,
                replayOfSessionId,
                clientRequestId,
            });
            const revealed = session.message;
            const kind = revealed.kind === "video" ? "video" : "photo";
            const url = safeMediaURL(kind === "video" ? revealed.video_url : revealed.photo_image_url, api);
            await showMediaViewer(url, {
                kind,
                label: `View once · ${Number(revealed.view_once_remaining_views || message.view_once_remaining_views || 1)} view${Number(revealed.view_once_remaining_views || message.view_once_remaining_views || 1) === 1 ? "" : "s"} available`,
                overlay: revealed.media_text_overlay,
            });
            await api.startChatMediaViewSession(userId(), store.state.activeChatId, session.session_id);
            viewOnceRequestByMessage.delete(messageId);
            rememberViewOnceSession(messageId, session.session_id);
            const remaining = Math.max(0, Number(revealed.view_once_remaining_views ?? message.view_once_remaining_views ?? 1) - 1);
            store.updateMessage(store.state.activeChatId, { ...message, view_once_remaining_views: remaining, view_once_available: remaining > 0, view_once_consumed: remaining === 0 });
            renderMessages(false);
        } catch (error) {
            closeMediaViewer();
            showToast?.(error.message || "That view-once media is no longer available.");
        }
    }

    async function showViewOnceReceipts(messageId) {
        const dialog = $("[data-chat-readers-dialog]");
        $(".chat-readers-content").innerHTML = `<header><button type="button" data-close-readers>Done</button><strong>Opened by</strong><span></span></header><p>Loading…</p>`;
        dialog.showModal();
        try {
            const response = await api.getChatViewOnceReceipts(userId(), store.state.activeChatId, messageId);
            $(".chat-readers-content").innerHTML = `<header><button type="button" data-close-readers>Done</button><strong>Opened by</strong><span></span></header><div class="chat-reactors-list">${(response.members || []).map((member) => `<div><span>${escapeChatHTML(displayMember(member))}</span><b>${member.opened ? `${Number(member.view_count || 1)}×` : "Not opened"}</b></div>`).join("") || `<p>No recipients yet.</p>`}</div>`;
        } catch (error) {
            $(".chat-readers-content p").textContent = error.message || "Could not load view receipts.";
        }
    }

    function renderSettings() {
        const detail = store.state.detail;
        if (!detail) return;
        const chat = detail.chat;
        const canManage = ["owner", "admin"].includes(chat.role);
        $(".chat-settings-content").innerHTML = `<header><button type="button" data-close-settings>Done</button><strong>${escapeChatHTML(chat.display_name)}</strong><span></span></header>${canManage && (chat.name || chat.accepted_count > 2) ? `<label class="chat-name-setting">Group name<span><input maxlength="40" value="${escapeChatHTML(chat.name || chat.display_name)}"><button type="button" data-save-chat-name>Save</button></span></label><label class="chat-photo-setting">Group photo<input type="file" accept="image/*" aria-label="Choose group photo"></label>` : ""}<section><h3>People</h3>${(detail.members || []).map((member) => {
            const isSelf = String(member.user_id) === String(userId());
            const remove = canManage && !isSelf && member.role !== "owner" ? `<button type="button" data-remove-chat-member="${escapeChatHTML(member.user_id)}" aria-label="Remove ${escapeChatHTML(displayMember(member))}">Remove</button>` : "";
            const block = !isSelf ? `<button type="button" data-block-chat-member="${escapeChatHTML(member.user_id)}" aria-label="Block ${escapeChatHTML(displayMember(member))}">Block</button>` : "";
            return `<div class="chat-settings-member"><span>${escapeChatHTML(displayMember(member))}</span><small>${escapeChatHTML(member.role === "owner" ? "Owner" : member.status === "invited" ? "Invited" : "Member")}</small>${remove || block ? `<span class="chat-member-actions">${remove}${block}</span>` : ""}</div>`;
        }).join("")}${canManage ? `<button class="chat-add-people" type="button" data-add-current-chat>＋ Add people</button>` : ""}</section><label class="chat-notification-setting">Notifications<select>${[["all", "All messages"], ["daily_only", "Mementos only"], ["muted", "Muted"]].map(([value, label]) => `<option value="${value}" ${chat.notification_level === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><button class="chat-danger-action" type="button" data-report-current-chat>Report chat</button><button class="chat-danger-action" type="button" data-leave-current-chat>Leave chat</button>`;
        $(".chat-notification-setting select").addEventListener("change", updateNotificationLevel, { once: true });
        $(".chat-photo-setting input")?.addEventListener("change", updateChatPhoto);
    }

    async function updateChatPhoto(event) {
        const input = event.target;
        const file = input.files?.[0];
        if (!file || !store.state.activeChatId) return;
        input.disabled = true;
        try {
            const prepared = await prepareChatMedia(file);
            if (prepared.kind !== "photo") throw new Error("Choose a photo for this group.");
            const chat = await api.uploadChatPhoto(userId(), store.state.activeChatId, prepared.file);
            store.upsertChat(chat);
            if (store.state.detail) store.state.detail.chat = chat;
            renderRoomHeader(chat);
            showToast?.("Group photo updated");
        } catch (error) {
            showToast?.(error.message || "Could not update the group photo.");
        } finally {
            input.disabled = false;
            input.value = "";
        }
    }

    async function updateNotificationLevel(event) {
        try {
            const chat = await api.updateChatNotificationLevel(userId(), store.state.activeChatId, event.target.value);
            store.upsertChat(chat);
            if (store.state.detail) store.state.detail.chat = chat;
            renderSettings();
            showToast?.("Notification setting updated");
        } catch (error) { showToast?.(error.message || "Could not update notifications."); }
    }

    async function reactToMessage(messageId, type) {
        const message = store.messages().find((item) => item.id === messageId);
        if (!message) return;
        const reaction = message.current_user_reaction === type ? null : type;
        try {
            const updated = await api.setChatMessageReaction(userId(), store.state.activeChatId, messageId, reaction);
            store.updateMessage(store.state.activeChatId, updated);
            renderMessages(false);
            softHaptic?.();
        } catch (error) { showToast?.(error.message || "Could not add that reaction."); }
    }

    async function showMessageReactors(messageId) {
        const dialog = $("[data-chat-reactors-dialog]");
        const content = $(".chat-reactors-content");
        content.innerHTML = `<header><button type="button" data-close-reactors>Done</button><strong>Reactions</strong><span></span></header><p class="chat-reactors-status">Loading…</p>`;
        dialog.showModal();
        try {
            const reactors = await api.getChatMessageReactors(userId(), store.state.activeChatId, messageId);
            content.innerHTML = `<header><button type="button" data-close-reactors>Done</button><strong>Reactions</strong><span></span></header><div class="chat-reactors-list">${(reactors || []).map((reactor) => `<div><span>${escapeChatHTML(displayMember(reactor))}</span><b aria-label="${escapeChatHTML(reactor.reaction_type)}">${CHAT_REACTIONS.find(([type]) => type === reactor.reaction_type)?.[1] || "♡"}</b></div>`).join("") || `<p>No reactions yet.</p>`}</div>`;
        } catch (error) {
            content.querySelector(".chat-reactors-status").textContent = error.message || "Could not load reactions.";
        }
    }

    function showMessageReaders(messageId) {
        const message = store.messages().find((item) => item.id === messageId);
        if (!message) return;
        const readers = readReceiptMembers(message);
        $(".chat-readers-content").innerHTML = `<header><button type="button" data-close-readers>Done</button><strong>Read by</strong><span></span></header><div class="chat-reactors-list">${readers.map((reader) => `<div><span>${escapeChatHTML(displayMember(reader))}</span><b aria-hidden="true">✓</b></div>`).join("") || `<p>No one has read this yet.</p>`}</div>`;
        $("[data-chat-readers-dialog]").showModal();
    }

    async function unsendMessage(messageId) {
        if (!confirm("Unsend this message for everyone?")) return;
        try {
            const updated = await api.unsendChatMessage(userId(), store.state.activeChatId, messageId);
            store.updateMessage(store.state.activeChatId, updated);
            renderMessages(false);
        } catch (error) { showToast?.(error.message || "Could not unsend that message."); }
    }

    async function deleteMessageForMe(messageId) {
        if (!confirm("Hide this message from your chat?")) return;
        try {
            await api.deleteChatMessageForMe(userId(), store.state.activeChatId, messageId);
            const remaining = store.messages().filter((message) => message.id !== messageId);
            store.replaceMessages(store.state.activeChatId, remaining, store.state.messagePageByChat.get(String(store.state.activeChatId)) || {});
            renderMessages(false);
        } catch (error) { showToast?.(error.message || "Could not hide that message."); }
    }

    async function copyMessage(messageId) {
        const body = store.messages().find((message) => message.id === messageId)?.body;
        if (!body) return;
        try {
            await navigator.clipboard.writeText(body);
            closeMessageActions();
            showToast?.("Message copied");
        } catch {
            showToast?.("Could not copy that message.");
        }
    }

    function closeMessageActions(except = null) {
        $$(".chat-message.actions-open").forEach((message) => {
            if (message === except) return;
            message.classList.remove("actions-open");
            message.querySelector("[data-message-menu]")?.setAttribute("aria-expanded", "false");
        });
    }

    function scrollMessageWithinTimeline(message, behavior = "auto") {
        const timeline = $(".chat-timeline");
        if (!message || !timeline) return;
        const timelineRect = timeline.getBoundingClientRect();
        const messageRect = message.getBoundingClientRect();
        const delta = messageRect.top + messageRect.height / 2 - (timelineRect.top + timelineRect.height / 2);
        timeline.scrollTo({ top: timeline.scrollTop + delta, behavior });
    }

    function toggleMessageActions(messageId, forceOpen = null) {
        const message = $(`[data-message-id="${CSS.escape(messageId)}"]`);
        if (!message) return;
        const shouldOpen = forceOpen ?? !message.classList.contains("actions-open");
        closeMessageActions(shouldOpen ? message : null);
        message.classList.toggle("actions-open", shouldOpen);
        message.querySelector("[data-message-menu]")?.setAttribute("aria-expanded", String(shouldOpen));
        if (shouldOpen) {
            softHaptic?.();
            requestAnimationFrame(() => scrollMessageWithinTimeline(message, "smooth"));
        }
    }

    function beginMessageActionHold(event) {
        if (event.pointerType === "mouse" || event.target.closest("button, textarea, input")) return;
        const message = event.target.closest(".chat-message");
        if (!message) return;
        cancelMessageActionHold();
        messageActionHoldTimer = setTimeout(() => toggleMessageActions(message.dataset.messageId, true), 420);
    }

    function cancelMessageActionHold() {
        clearTimeout(messageActionHoldTimer);
        messageActionHoldTimer = null;
    }

    function handleMessageDoubleClick(event) {
        if (event.target.closest("button")) return;
        const bubble = event.target.closest("[data-message-bubble]");
        if (bubble) void reactToMessage(bubble.dataset.messageBubble, "love");
    }

    function renderReplyDraft() {
        const draft = $(".chat-reply-draft");
        const message = store.messages().find((item) => item.id === store.state.replyToMessageId);
        draft.classList.toggle("hidden", !message);
        if (message) draft.querySelector("span").textContent = `Replying to ${message.sender_first_name || "message"}: ${message.kind === "memento" ? "Memento" : message.body || "Media"}`;
    }

    function handleTypingInput() {
        if (!typingSent && store.state.activeChatId) {
            typingSent = true;
            void api.setChatTyping(userId(), store.state.activeChatId, true).catch(() => null);
        }
        clearTimeout(typingTimer);
        typingTimer = setTimeout(stopTyping, 1800);
    }

    function stopTyping() {
        clearTimeout(typingTimer);
        typingTimer = null;
        if (typingSent && store.state.activeChatId) void api.setChatTyping(userId(), store.state.activeChatId, false).catch(() => null);
        typingSent = false;
    }

    function startRealtime() {
        if (store.state.eventSource || typeof EventSource === "undefined" || typeof api.chatEventsURL !== "function" || !userId()) return;
        const source = new EventSource(api.chatEventsURL(userId()), { withCredentials: true });
        store.state.eventSource = source;
        const consumeEvent = (event) => {
            try {
                const payload = JSON.parse(event.data);
                if (!payload.id && event.lastEventId) payload.id = event.lastEventId;
                void handleRealtimeEvent(payload);
            } catch (_) { /* A later authoritative refresh repairs malformed hints. */ }
        };
        source.onmessage = consumeEvent;
        source.addEventListener("chat", consumeEvent);
        source.onerror = () => {
            if (source.readyState === EventSource.CLOSED) {
                store.state.eventSource = null;
                clearTimeout(store.state.reconnectTimer);
                store.state.reconnectTimer = setTimeout(startRealtime, 5_000);
            }
        };
    }

    async function handleRealtimeEvent(event) {
        store.state.lastEventId = event.id || store.state.lastEventId;
        void calls.handleRealtimeEvent(event);
        const chatId = String(event.chat_id || "");
        if (["typing_started", "typing_stopped"].includes(event.type) && chatId === store.state.activeChatId && String(event.actor_user_id) !== String(userId())) {
            if (event.type === "typing_started") store.state.typingUserIds.add(String(event.actor_user_id));
            else store.state.typingUserIds.delete(String(event.actor_user_id));
            $(".chat-typing").classList.toggle("hidden", store.state.typingUserIds.size < 1);
            renderRoomHeader(store.state.detail?.chat);
            return;
        }
        if (chatId && chatId === store.state.activeChatId && ["message_created", "message_updated", "message_deleted", "memento_created", "resync", "ready"].includes(event.type)) {
            const latest = Math.max(0, ...store.messages(chatId).map((message) => message.room_sequence));
            const needsFullResync = ["resync", "ready"].includes(event.type);
            const response = await api.getChatMessages(userId(), chatId, { limit: 100, afterSequence: needsFullResync ? null : Math.floor(latest) }).catch(() => null);
            if (response) {
                if (needsFullResync) store.replaceMessages(chatId, response.items || [], response);
                else store.mergeMessages(chatId, response.items || []);
                renderMessages(true);
                await markRoomRead();
            }
            if (event.type === "memento_created") {
                store.state.dailyRow = await api.getChatDailyRow(userId(), chatId).catch(() => store.state.dailyRow);
                const today = localLedgerDate();
                if (store.state.dailyRow?.ledger_date) store.state.dailyRowsByDate.set(store.state.dailyRow.ledger_date, store.state.dailyRow);
                if (!store.state.displayedDailyRow || store.state.displayedDailyRow.ledger_date === today) store.state.displayedDailyRow = store.state.dailyRow;
                renderDailyRow();
            }
        }
        void loadChats({ quiet: true });
    }

    function pushRoomHistory(chatId) {
        const url = new URL(location.href);
        url.searchParams.set("tab", "chats");
        url.searchParams.set("chat", chatId);
        url.searchParams.delete("message");
        url.searchParams.delete("call");
        history.pushState({ validApp: true, panel: "chats", chatId }, "", `${url.pathname}${url.search}`);
    }

    function focusDeepLinkedMessage(chatId) {
        const params = new URLSearchParams(location.search);
        if (String(params.get("chat") || "") !== String(chatId)) return;
        const messageId = params.get("message");
        if (!messageId) return;
        const message = $(`[data-message-id="${CSS.escape(messageId)}"]`);
        if (!message) return;
        message.classList.add("deep-linked");
        requestAnimationFrame(() => scrollMessageWithinTimeline(message));
    }

    function showChatList() {
        stopTyping();
        roomGeneration += 1;
        store.state.activeChatId = null;
        store.state.detail = null;
        store.state.dailyRow = null;
        store.state.displayedDailyRow = null;
        store.state.dailyRowsByDate.clear();
        showScreen("list");
        const url = new URL(location.href);
        url.searchParams.set("tab", "chats");
        url.searchParams.delete("chat");
        url.searchParams.delete("message");
        url.searchParams.delete("call");
        history.replaceState({ validApp: true, panel: "chats" }, "", `${url.pathname}${url.search}`);
        void loadChats({ quiet: true });
    }

    async function handleClick(event) {
        const target = event.target.closest("button, [data-view-memento]");
        if (!target) { closeMessageActions(); return; }
        if (!target.closest(".chat-message-actions") && !target.matches("[data-message-menu]")) closeMessageActions();
        if (target.matches("[data-new-chat]")) return openCreateChat();
        if (target.matches("[data-chat-list]")) {
            if (inviteMode && store.state.activeChatId) {
                inviteMode = false;
                return showScreen("room");
            }
            return showChatList();
        }
        if (target.matches("[data-create-submit]")) return createChat();
        if (target.dataset.searchChat) return openSearchResult(target.dataset.searchChat, target.dataset.searchMessage || null);
        if (target.dataset.openChat) return openChat(target.dataset.openChat);
        if (target.dataset.acceptChat) return acceptInvitation(target.dataset.acceptChat);
        if (target.dataset.declineChat) return declineInvitation(target.dataset.declineChat);
        if (target.matches("[data-load-earlier]")) return loadEarlier();
        if (target.dataset.startCall) return calls.start(target.dataset.startCall, store.state.detail?.chat);
        if (target.dataset.mementoDay) return loadMementoDay(target.dataset.mementoDay);
        if (target.dataset.mementoDate) return loadMementoDate(target.dataset.mementoDate);
        if (target.matches("[data-open-memento]")) return openMementoComposer({ showExisting: target.hasAttribute("data-show-mementos") });
        if (target.matches("[data-open-chat-media]")) return openChatMediaComposer();
        if (target.matches("[data-close-chat-media]")) return $("[data-chat-media-dialog]").close();
        if (target.matches("[data-record-voice]")) return void toggleVoiceRecording();
        if (target.matches("[data-close-memento]")) return $("[data-memento-dialog]").close();
        if (target.matches("[data-skip-memento]")) return skipMementoForToday();
        if (target.matches("[data-swap-memento-capture]")) return swapSelectedMementoViews();
        if (target.dataset.viewMemento) return viewMemento(target.dataset.viewMemento, target.dataset.mementoOwner, target.dataset.mementoEntry || null, target.dataset.mementoSwapped || null);
        if (target.dataset.openChatMediaMessage) return openPersistentChatMedia(target.dataset.openChatMediaMessage);
        if (target.dataset.sendSticker) return sendSticker(target.dataset.sendSticker);
        if (target.dataset.openViewOnce) return openViewOnceMessage(target.dataset.openViewOnce);
        if (target.dataset.viewOnceReceipts) return showViewOnceReceipts(target.dataset.viewOnceReceipts);
        if (target.matches("[data-share-viewed-memento]")) return shareViewedMemento();
        if (target.matches("[data-swap-viewed-memento]")) return void swapViewedMemento();
        if (target.matches("[data-reply-viewed-media]")) return replyToViewedMedia();
        if (target.matches("[data-react-viewed-media]")) return reactToViewedMedia();
        if (target.matches("[data-close-media]")) return closeMediaViewer();
        if (target.matches("[data-chat-settings]")) { renderSettings(); return $("[data-chat-settings-dialog]").showModal(); }
        if (target.matches("[data-close-settings]")) return $("[data-chat-settings-dialog]").close();
        if (target.matches("[data-close-reactors]")) return $("[data-chat-reactors-dialog]").close();
        if (target.matches("[data-close-readers]")) return $("[data-chat-readers-dialog]").close();
        if (target.matches("[data-add-current-chat]")) {
            $("[data-chat-settings-dialog]").close();
            return openCreateChat({ addToCurrent: true });
        }
        if (target.matches("[data-save-chat-name]")) {
            const input = $(".chat-name-setting input");
            if (!input.value.trim()) return;
            try {
                const chat = await api.updateChatName(userId(), store.state.activeChatId, input.value);
                store.upsertChat(chat);
                store.state.detail.chat = chat;
                renderRoomHeader(chat);
                renderSettings();
                showToast?.("Group name updated");
            } catch (error) { showToast?.(error.message || "Could not rename this group."); }
            return;
        }
        if (target.dataset.removeChatMember && confirm("Remove this person from the group?")) {
            try {
                await api.removeChatMember(userId(), store.state.activeChatId, target.dataset.removeChatMember);
                await openChat(store.state.activeChatId, { updateHistory: false, force: true });
                renderSettings();
            } catch (error) { showToast?.(error.message || "Could not remove that person."); }
            return;
        }
        if (target.dataset.blockChatMember && confirm("Block this person? Their content and contact will be restricted across Valid.")) {
            try {
                await api.blockUser(userId(), target.dataset.blockChatMember);
                showToast?.("Person blocked");
                await loadChats({ quiet: true });
                renderSettings();
            } catch (error) { showToast?.(error.message || "Could not block this person."); }
            return;
        }
        if (target.matches("[data-cancel-reply]")) { store.state.replyToMessageId = null; return renderReplyDraft(); }
        if (target.dataset.messageMenu) return toggleMessageActions(target.dataset.messageMenu);
        if (target.dataset.replyMessage) { closeMessageActions(); store.state.replyToMessageId = target.dataset.replyMessage; renderReplyDraft(); return $(".chat-composer textarea").focus(); }
        if (target.dataset.reactMessage) return reactToMessage(target.dataset.reactMessage, target.dataset.reaction);
        if (target.dataset.viewReactions) return showMessageReactors(target.dataset.viewReactions);
        if (target.dataset.viewReaders) return showMessageReaders(target.dataset.viewReaders);
        if (target.dataset.copyMessage) return copyMessage(target.dataset.copyMessage);
        if (target.dataset.deleteMessage) return deleteMessageForMe(target.dataset.deleteMessage);
        if (target.dataset.unsendMessage) return unsendMessage(target.dataset.unsendMessage);
        if (target.dataset.retryMessage) return sendMessage(null, target.dataset.retryMessage);
        if (target.dataset.scrollMessage) return scrollMessageWithinTimeline($(`[data-message-id="${CSS.escape(target.dataset.scrollMessage)}"]`), "smooth");
        if (target.matches("[data-report-current-chat]")) {
            const reason = prompt("Tell us why you're reporting this chat:");
            if (reason?.trim().length >= 3) await api.reportChat(userId(), store.state.activeChatId, reason.trim()).then(() => showToast?.("Report submitted")).catch((error) => showToast?.(error.message));
        }
        if (target.matches("[data-leave-current-chat]") && confirm("Leave this chat? You will stop receiving new messages.")) {
            await api.leaveChat(userId(), store.state.activeChatId).then(async () => {
                $("[data-chat-settings-dialog]").close();
                await loadChats({ quiet: true });
                showChatList();
            }).catch((error) => showToast?.(error.message));
        }
    }

    return { activate, refresh, openChat, store, beforeSessionEnd: calls.beforeSessionEnd };
}
