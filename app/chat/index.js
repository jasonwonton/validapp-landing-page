import { bindMessageActions, messageActionsMarkup } from './actions.js';
import { HISTORY_MODES, canSaveMessage, historyVisible, createHistoryReceipts } from './history.js';
import { viewOncePresentation } from './view-once.js';
import { presenceLabel } from "./presence.js";
import { reconcileKeyedElements } from "../keyed-list.js";
import { ingestEnabled, ingestSegmentCount, photoPipeline, prepareChatMedia, prepareMementoImages } from "./media.js";
import { createPhotoStickers } from './photo-stickers.js';
import { bindVoiceGesture, createVoiceWaveform } from './voice-interaction.js';
import {
    CHAT_REACTIONS, chatAttentionPriority, chatNeedsMemento, chatPreview, chatSeparatorBefore, displayMember, escapeChatHTML,
    KNOWN_MESSAGE_KINDS, linkifyChatText, messageTime, normalizeMessage, recentConversations, relativeChatTime, safeMediaURL,
    VIDEO_PROCESSING_MESSAGE, VIDEO_UNAVAILABLE_MESSAGE, videoPlaybackState, videoRefreshDelay,
} from "./models.js";
import { thumbHashDataURL } from "./thumbhash.js";
import { confirmSheet } from "../ui-dialogs.js";
import { userMessage } from "../user-message.js";
import { createChatStore } from "./store.js";
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
import { callService } from "../calls/service.js";
import { uiIcon } from "../ui-icons.js";
import { mediaImageMarkup } from "../media-url.js";
import { setRuntimeStyles } from "../runtime-style.js";
import {
    CHAT_COLOR_STYLES,
    CHAT_FONT_STYLES,
    loadChatAppearance,
    saveChatAppearance,
} from "./appearance.js";
import { createStickerMaker } from "./sticker-maker.js";
import { createMessageWindow } from "./message-window.js";
import { createTimelineScroll } from "./timeline-scroll.js";
import { callHistoryPresentation } from './call-history.js';

const REFRESH_MS = 30_000;
const MAX_VOICE_RECORDING_MS = 300_000;
const TIME_REVEAL_WIDTH = 86;

export async function deliverMementoRecord(api, userId, record, { onProgress } = {}) {
    const { deliverMemento } = await import("../media-delivery.js");
    return deliverMemento(api, userId, record, { onProgress });
}

// Camera, review editing and uploads load on first use (outside the app shell).
const loadLiveCamera = () => import("../live-camera.js");
// Ask for the camera inside the tap itself. iOS (notably an installed web app)
// can refuse a getUserMedia made after awaiting the camera module; the camera
// then adopts this stream. Constraints match live-camera.js cameraConstraints.
function cameraStreamRequest(facing) {
    if (!navigator.mediaDevices?.getUserMedia) return null;
    const request = navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
    request.catch(() => null);
    return request;
}
function releaseStreamRequest(request) {
    request?.then((stream) => stream?.getTracks().forEach((track) => track.stop())).catch(() => null);
}
const cameraHaptic = (kind) => window.ValidPreferences?.haptic?.(kind);

// Voice notes are only ever recorded in the app, never picked from files.
// M4A goes straight to chat-media-uploads (unchanged). Browsers that can only
// record Opus send it through the server ingest when /config enables it.
// With neither, the mic button is hidden (syncVoiceComposer).
function voiceRecordingFormat(ingestEnabled = false) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return null;
    const supported = (type) => { try { return MediaRecorder.isTypeSupported?.(type) === true; } catch (_) { return false; } };
    const direct = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4"].find(supported);
    if (direct) return { mimeType: direct, ingest: false };
    if (!ingestEnabled) return null;
    const opus = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"].find(supported);
    return opus ? { mimeType: opus, ingest: true } : null;
}

function formatClock(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function localLedgerDate(date = new Date()) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function createChatsView({ root, api, getUser, getConfig, presence, softHaptic, successHaptic, haptic, showToast, installSwipeBack, onUnreadChange, onPlay }) {
    const feedback = (kind) => (haptic || globalThis.ValidPreferences?.haptic)?.(kind);
    const attentionPriority = chat => chatAttentionPriority(chat, {
        dailyLedgerEnabled: dailyLedgerEnabled(),
        callsEnabled: getConfig()?.enable_calls === true && getConfig()?.enable_web_calls === true,
    });
    const store = createChatStore({ attentionPriority });
    const messageWindow = createMessageWindow();
    const callsService = callService({ api, getUser, getConfig, showToast });
    const calls = callsService.calls;
    const realtime = callsService.realtime;
    callsService.onCallChanged((call) => handleRealtimeEvent({ type: 'call_history_changed', chat_id: call.chat_id }));
    realtime.subscribe((event) => { if (activation) void handleRealtimeEvent(event); });
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
    let mementoSkipping = false;
    let selectedChatMedia = null;
    let selectedChatMediaSourceFile = null;
    let selectedChatMediaPreview = null;
    let chatMediaPreparationGeneration = 0;
    let chatMediaPublishing = false;
    let chatMediaUploadRequestId = null;
    let chatMediaSendRequestId = null;
    let voiceRecorder = null;
    let voiceMode = false;
    let photoStickerMode = false;
    let voiceRecordingStartedAt = 0;
    let voiceRecordingTimer = null;
    let discardVoiceRecording = false;
    const viewOnceSessionByMessage = new Map();
    const viewOnceStates = new Map();
    let replayHoldTimer = null;
    let replayHoldTarget = null;
    let replaySuppressClick = false;
    let mediaOpenGeneration = 0;
    let ephemeralTimer = null;
    let ephemeralPaused = false;
    let ephemeralPointer = null;
    let historyReceipts = null;
    let receiptUser = null;
    let sharedHistoryLoading = false;
    let sharedHistoryError = '';
    let sharedHistorySaving = false;
    let sharedHistoryRevision = 0;
    const viewOnceRequestByMessage = new Map();
    const stickerRequestById = new Map();
    let stickerLibraryGeneration = 0;
    let stickerSending = false;
    let mementoDateGeneration = 0;
    let sharedMementoDraft = null;
    let viewedMessageId = null;
    let viewedMementoEntryId = null;
    let viewedMementoOwner = null;
    let viewedMementoPrimaryURL = null;
    let viewedMementoSwappedURL = null;
    let viewedMementoShowsSwapped = false;
    let typingTimer = null;
    let typingSent = false;
    let roomGeneration = 0;
    let historyLoading = null;
    let historyError = null;
    let historyHasNewer = false;
    let messagesRevision = 0;
    let realtimeRefreshing = false;
    let pendingRealtimeEvent = null;
    let readWatermark = { chatId: null, sequence: 0 };
    let inviteMode = false;
    let outboxRetrying = false;
    let outboxRetryTimer = null;
    let mediaOutboxRetrying = false;
    let mediaOutboxRetryTimer = null;
    let viewUserId = null;
    let historySweepTimer = null;
    let listRefreshTimer = null;
    const chatRefreshTimers = new Map();
    const refreshedMediaMessages = new Set();
    let viewerGestures = null;
    let reportingChat = false;

    root.innerHTML = `
        <div class="chat-shell">
            <section class="chat-list-screen" data-chat-screen="list">
                <header class="chat-page-header"><button class="chat-icon-button" type="button" data-focus-chat-search aria-label="Search chats" aria-expanded="false">${uiIcon('search')}</button><h1>Chats</h1><button class="chat-icon-button" type="button" data-new-chat aria-label="Start a chat">${uiIcon('compose')}</button></header>
                <form class="chat-search-form hidden" role="search"><label><span aria-hidden="true">${uiIcon('search')}</span><input type="search" minlength="2" maxlength="100" placeholder="Search chats and messages" aria-label="Search chats and messages" autocomplete="off"></label><button type="submit">Search</button><button type="button" data-cancel-chat-search>Cancel</button></form>
                <div class="chat-list-status" role="status"></div>
                <div class="chat-search-results hidden" aria-label="Chat search results"></div>
                <section class="chat-recent hidden" aria-label="Recent conversations"><h2>Recent</h2><div class="chat-recent-rail"></div></section>
                <div class="chat-list" aria-label="Conversations"></div>
            </section>
            <section class="chat-create-screen hidden" data-chat-screen="create">
                <header class="chat-room-header"><button class="chat-back" type="button" data-chat-list aria-label="Back to chats">${uiIcon("back")}</button><strong>New chat</strong><button class="chat-create-submit" type="button" data-create-submit disabled>Create</button></header>
                <div class="chat-create-body">
                    <label class="chat-group-name hidden">Group name<input type="text" maxlength="40" placeholder="Name your group"></label>
                    <label class="chat-person-search"><span aria-hidden="true">${uiIcon("search")}</span><input type="search" placeholder="Search classmates" autocomplete="off"></label>
                    <p class="chat-create-hint">Choose one person for a private chat or several for a group.</p>
                    <div class="chat-people-list"></div><p class="chat-create-status" role="status"></p>
                </div>
            </section>
            <section class="chat-room-screen hidden" data-chat-screen="room">
                <header class="chat-room-header"><button class="chat-back" type="button" data-chat-list aria-label="Back to chats">${uiIcon("back")}</button><button class="chat-room-title" type="button" data-chat-settings><strong>Chat</strong><small>Loading…</small></button><div class="chat-room-tools"><span class="chat-call-actions hidden"><button class="chat-icon-button" type="button" data-start-call="audio" aria-label="Start voice call">${uiIcon("phone")}</button></span><button class="chat-memento-toolbar hidden" type="button" data-open-memento-gallery aria-label="Mementos"></button><button class="chat-icon-button" type="button" data-chat-settings aria-label="Chat settings">${uiIcon("more")}</button></div></header>
                <div class="chat-daily-row"></div>
                <div class="chat-room-status" role="status"></div>
                <div class="chat-timeline" role="list" aria-live="polite" aria-label="Messages"></div>
                <button class="chat-jump-latest hidden" type="button" data-jump-latest aria-label="Jump to latest messages">${uiIcon('down')}<span>Latest</span></button>
                <div class="chat-typing hidden" aria-live="polite">Someone is typing…</div>
                <div class="chat-reply-draft hidden"><span></span><button type="button" data-cancel-reply aria-label="Cancel reply">${uiIcon('close')}</button></div>
                <form class="chat-composer">
                    <div class="chat-memento-draft hidden">
                        <img alt="" decoding="async">
                        <span><strong></strong><small>Add an optional message</small></span>
                        <button type="button" data-remove-memento-draft aria-label="Remove Memento">×</button>
                    </div>
                    <button class="chat-camera-button" type="button" data-open-chat-media aria-label="Send photo or video">${uiIcon('camera-filled')}</button>
                    <button class="chat-attachment-button" type="button" data-open-stickers aria-label="Send a sticker"><span class="native-sticker-icon" aria-hidden="true"></span></button>
                    <div class="chat-input-wrap"><textarea rows="1" maxlength="2000" placeholder="Message" aria-label="Message" enterkeyhint="send"></textarea><button type="button" class="chat-mic-button" data-record-voice aria-label="Record voice message">${uiIcon('mic')}</button></div>
                    <button class="chat-send-button" type="submit" aria-label="Send message">${uiIcon('send')}</button>
                    <section class="chat-voice-inline hidden" aria-label="Voice message"><button type="button" data-cancel-voice aria-label="Discard voice message">${uiIcon('close')}</button><div class="chat-voice-body"><p class="chat-voice-status" role="status"></p><canvas class="chat-voice-waveform" width="192" height="28" aria-hidden="true"></canvas><p class="chat-voice-hint"></p><audio class="chat-inline-audio" aria-label="Voice message preview" hidden></audio><div class="chat-voice-player" hidden><button type="button" data-voice-play aria-label="Play voice preview">${uiIcon('play')}</button><input type="range" min="0" max="100" value="0" step="0.1" aria-label="Voice preview position"><small class="chat-voice-clock" aria-hidden="true">0:00</small><button type="button" class="chat-voice-speed" data-voice-speed aria-label="Playback speed 1×">1×</button></div></div><button type="button" data-stop-voice aria-label="Stop recording and preview">${uiIcon('stop')}</button><button type="button" data-record-again aria-label="Record voice message">${uiIcon('mic')}</button><button type="button" data-send-voice aria-label="Send voice message">${uiIcon('send')}</button></section>
                </form>
            </section>
        </div>
        <dialog class="chat-sheet" data-memento-dialog aria-label="Create a Memento">
            <form class="memento-form">
                <header><button type="button" data-close-memento>Cancel</button><strong>Memento</strong><span></span></header>
                <section class="live-camera" data-memento-camera hidden aria-label="Memento camera"></section>
                <div class="memento-review-content">
                <h2 class="memento-review-title">How does it look?</h2>
                <div class="memento-preview">${uiIcon('camera')}<p>Capture one real moment from today.</p></div>
                <div class="memento-photo-fallback" hidden>
                    <label>Choose a photo <input class="memento-file-input" type="file" accept="image/*"></label>
                </div>
                </div>
                <div class="memento-send-feedback" aria-live="polite" aria-atomic="true">
                <div class="memento-progress hidden"><span></span></div>
                <p class="memento-status" role="status"></p>
                </div>
                <div class="memento-review-actions">
                    <button class="memento-retake" type="button" data-retake-memento>${uiIcon('flip')} Retake</button>
                    <button class="primary-button memento-publish" type="submit" disabled>Send to this chat</button>
                </div>
                <button class="memento-skip hidden" type="button" data-skip-memento>Skip for today</button>
            </form>
        </dialog>
        <dialog class="chat-sheet chat-camera-sheet" data-chat-media-dialog aria-label="Send media">
            <form class="chat-media-form">
                <header><button type="button" data-close-chat-media>Cancel</button><strong>Photo or video</strong><button type="button" data-chat-photo-library aria-label="Photo library">${uiIcon('photo')}</button></header>
                <section class="live-camera" data-chat-camera tabindex="-1" hidden aria-label="Message camera"></section>
                <section class="chat-media-editor">
                <div class="chat-photo-tools"><button type="button" data-retake-chat-photo>${uiIcon('flip')} Retake</button><span></span><button type="button" data-close-chat-media aria-label="Close photo">${uiIcon('close')}</button></div>
                <div class="chat-media-preview"><span aria-hidden="true">${uiIcon("plus")}</span><p>Choose a photo or video.</p></div>
                <div class="chat-review-tools" data-review-tools hidden><button type="button" data-photo-cutout aria-label="Make a sticker from this photo">${uiIcon('scissors')}</button><button type="button" data-photo-stickers aria-label="Open My Stickers"><span class="native-sticker-icon" aria-hidden="true"></span></button><button type="button" data-photo-text aria-label="Add caption">Aa</button><button type="button" data-photo-draw aria-label="Draw on this" aria-pressed="false"></button><div class="review-draw-tools" hidden></div><button type="button" data-undo-zoom aria-label="Undo zoom" hidden>${uiIcon('back')}</button></div>
                <p class="chat-media-send-count" hidden></p>
                <button type="button" data-cancel-chat-upload hidden>Cancel upload</button>
                <label class="chat-media-option"><input type="checkbox" data-chat-view-once aria-label="View once">${uiIcon('infinity')}${uiIcon('view-once')}<span>Keep in chat</span></label>
                <div class="chat-media-progress hidden"><span></span></div>
                <p class="chat-media-status" role="status"></p>
                <div class="chat-media-review-actions"><button class="primary-button chat-media-publish" type="submit" aria-label="Send" disabled>${uiIcon('send')}</button></div>
                </section>
                <input class="chat-media-file-input" type="file" accept="image/*,video/mp4" hidden aria-label="Photo or video file">
            </form>
        </dialog>
        <dialog class="chat-sheet chat-stickers-sheet" data-sticker-library-dialog aria-label="Send a sticker"><section class="chat-stickers-content"><header><button type="button" data-close-stickers>Close</button><strong>Send a Sticker</strong><button type="button" data-edit-stickers aria-pressed="false">Edit</button></header><p>Tap a sticker to send it.</p><p class="chat-sticker-status" role="status"></p><section class="chat-sticker-library"><input class="chat-sticker-file-input visually-hidden" type="file" accept="image/*" capture="environment"><div><small>Loading…</small></div></section></section></dialog>
        <dialog class="chat-sheet chat-mementos-sheet" data-memento-gallery-dialog aria-label="Mementos"><section class="chat-mementos-content"><header><button type="button" data-close-memento-gallery>Close</button><strong>Mementos</strong><span></span></header><p class="chat-memento-gallery-status" role="status"></p><div class="chat-memento-gallery"></div></section></dialog>
        <dialog class="chat-sticker-maker" data-sticker-maker-dialog aria-label="Make a sticker">
            <form class="chat-sticker-maker-form">
                <header><button type="button" data-close-sticker-maker>Cancel</button><strong>Make a sticker</strong><span></span></header>
                <div class="chat-sticker-canvas">
                    <canvas tabindex="0" role="img" aria-label="Photo with selected sticker cutout" aria-describedby="chatStickerInstructions"></canvas>
                </div>
                <p id="chatStickerInstructions">A center cut works with a keyboard or screen reader. On a touch screen or mouse, draw one complete loop around the person or object to refine it.</p>
                <p data-sticker-maker-status role="status"></p>
                <div class="chat-sticker-maker-actions">
                    <button type="button" data-reset-sticker-cut disabled>Reset to center cut</button>
                    <button class="primary-button" type="submit" data-save-sticker disabled>Save and send</button>
                </div>
            </form>
        </dialog>
        <dialog class="chat-sheet" data-chat-settings-dialog aria-label="Chat settings"><div class="chat-settings-content"></div></dialog>
        <dialog class="chat-sheet" data-chat-reactors-dialog aria-label="Message reactions"><div class="chat-reactors-content"></div></dialog>
        <dialog class="chat-sheet" data-chat-readers-dialog aria-label="Read receipts"><div class="chat-readers-content"></div></dialog>
        <dialog class="chat-media-viewer" data-chat-media-viewer aria-label="Chat media" aria-describedby="chatViewerHint"><span class="visually-hidden" id="chatViewerHint">Drag down to close. Pinch or double-tap to zoom.</span><button type="button" data-close-media aria-label="Close">${uiIcon('close')}</button><div class="chat-viewer-stage"><div class="chat-viewer-media"><img class="chat-viewer-placeholder" alt="" aria-hidden="true" hidden><img alt="" hidden><video playsinline controls hidden></video><div class="chat-viewer-overlay" hidden></div></div></div><progress class="chat-ephemeral-progress" max="1" value="0" aria-label="Media time remaining" hidden></progress><small class="chat-capture-note" hidden>Screenshots aren’t detected on the web</small><button type="button" data-pause-ephemeral aria-label="Pause media" hidden>${uiIcon("pause")}</button><p></p><div class="chat-viewer-actions"><button type="button" data-swap-viewed-memento aria-label="Swap front and back photos" hidden>⇄ Swap views</button><button type="button" data-share-viewed-memento hidden>Share</button><button type="button" data-reply-viewed-media hidden>Reply</button><button type="button" data-react-viewed-media hidden>${uiIcon("heart")} React</button></div></dialog>`;

    const $ = (selector) => root.querySelector(selector);
    const $$ = (selector) => [...root.querySelectorAll(selector)];
    let mementoCamera = null;
    let mementoCameraToken = 0;
    async function ensureMementoCamera() {
        if (mementoCamera) return mementoCamera;
        const { createLiveCamera, ensureCameraStyles } = await loadLiveCamera();
        await ensureCameraStyles();
        mementoCamera ||= createLiveCamera({
            container: $('[data-memento-camera]'),
            maxDimension: 1600,
            haptic: cameraHaptic,
            onCapture: async ([first, second]) => {
                $('[data-memento-dialog]').classList.remove('is-capturing');
                selectedMementoSourceFile = first;
                selectedMementoSecondarySourceFile = second || null;
                mementoFrontIsPrimary = false;
                await prepareSelectedMemento(first);
            },
            onFallback: () => {
                $('[data-memento-dialog]').classList.remove('is-capturing');
                $('.memento-photo-fallback').hidden = false;
                $('.memento-file-input').focus();
            },
        });
        return mementoCamera;
    }
    // Initialize on first use so opening a chat never requests camera permission.
    let chatCamera = null;
    let cameraWarmed = false;
    let chatCameraToken = 0;
    let reviewEditor = null;
    let reviewEditorLoading = null;
    let chatMediaEncoded = null;
    let chatMediaAbort = null;
    function ensureReviewEditor() {
        reviewEditorLoading ||= Promise.all([import("../camera/review-editor.js"), loadLiveCamera().then((module) => module.ensureCameraStyles())])
            .then(([{ createReviewEditor }]) => (reviewEditor = createReviewEditor({
                preview: $('.chat-media-preview'),
                toolColumn: $('[data-review-tools]'),
                drawTools: $('[data-review-tools] .review-draw-tools'),
                api, showToast, haptic: cameraHaptic,
                isBusy: () => chatMediaPublishing,
                onChange: chatMediaEdited,
            })))
            .catch((error) => { reviewEditorLoading = null; throw error; });
        return reviewEditorLoading;
    }
    const photoStickers = createPhotoStickers($('.chat-media-preview'), { onChange: () => chatMediaEdited(), disabled: () => chatMediaPublishing });
    const voiceWaveform = createVoiceWaveform($('.chat-voice-waveform'));
    const voiceGesture = bindVoiceGesture($('[data-record-voice]'), {
        canStart: () => !voiceMode && !chatMediaPublishing && !chatAccessUnavailable() && !calls.isActive() && Boolean(voiceRecordingFormat(ingestEnabled(getConfig()))),
        begin: () => toggleVoiceRecording(), recording: () => Boolean(voiceRecorder),
        stop: () => stopVoiceRecorder(), discard: () => resetChatMediaComposer(),
        hint: (value, danger = false) => { $('.chat-voice-hint').textContent = value; $('.chat-voice-hint').classList.toggle('is-danger', danger); },
        haptic: feedback,
    });
    const voiceAudio = $('.chat-inline-audio');
    // Interaction-only code loads with the first room, outside the app shell.
    let roomTools = null;
    function loadRoomTools() {
        roomTools ||= import('./room-tools.js').then((tools) => {
            tools.bindTimeReveal($('.chat-timeline'), { width: TIME_REVEAL_WIDTH });
            return { ...tools, voice: tools.bindVoicePlayers(root, { composerAudio: voiceAudio, showToast, onChange: () => softHaptic?.() }) };
        }).catch(() => { roomTools = null; return null; });
        return roomTools;
    }
    function syncVoiceComposer() {
        $('[data-record-voice]').classList.toggle('hidden', !voiceMode && !voiceRecordingFormat(ingestEnabled(getConfig())));
        $('.chat-composer').classList.toggle('voice-mode', voiceMode);
        $('.chat-voice-inline').classList.toggle('hidden', !voiceMode);
        const audio = $('.chat-inline-audio');
        const ready = voiceMode && selectedChatMedia?.kind === 'audio';
        audio.hidden = true;
        $('.chat-voice-player').hidden = !ready;
        $('[data-stop-voice]').hidden = !voiceRecorder;
        $('[data-record-again]').hidden = !ready;
        $('[data-send-voice]').hidden = !ready;
        if (ready && audio.getAttribute('src') !== selectedChatMediaPreview) audio.src = selectedChatMediaPreview;
        if (!voiceMode) { audio.pause(); audio.removeAttribute('src'); }
        $('[data-send-voice]').disabled = !ready || chatMediaPublishing;
        $('[data-cancel-voice]').disabled = chatMediaPublishing;
        if (voiceMode && !voiceRecorder) $('.chat-voice-status').textContent = $('.chat-media-status').textContent || (ready ? `${Math.max(1, Math.round(selectedChatMedia.durationMs / 1000))}s` : 'Voice message');
    }
    new MutationObserver(syncVoiceComposer).observe($('.chat-media-status'), { childList: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden && voiceMode) resetChatMediaComposer(); });
    const panel = root.closest('.panel');
    if (panel) new MutationObserver(() => { if (panel.classList.contains('hidden') && voiceMode) resetChatMediaComposer(); }).observe(panel, { attributes: true, attributeFilter: ['class'] });
    function showChatMediaReview() {
        chatCameraToken++;
        chatCamera?.close();
        $('[data-chat-media-dialog]').classList.remove('is-capturing');
    }
    async function startChatCamera() {
        if (chatMediaPublishing) return;
        resetChatMediaComposer();
        const token = ++chatCameraToken;
        const streamRequest = chatCamera ? null : cameraStreamRequest('user');
        $('[data-chat-media-dialog]').classList.add('is-capturing');
        try {
            if (!chatCamera) {
                const { createLiveCamera, ensureCameraStyles } = await loadLiveCamera();
                await ensureCameraStyles();
                chatCamera ||= createLiveCamera({
                    container: $('[data-chat-camera]'), singlePhoto: true,
                    // iOS opens the message camera on the front camera.
                    initialFacing: 'user',
                    maxDimension: 3840,
                    haptic: cameraHaptic,
                    onCapture: async ([bitmap]) => { showChatMediaReview(); await prepareSelectedChatMedia(bitmap); },
                    onFallback: () => { showChatMediaReview(); $('.chat-media-file-input').click(); },
                    recording: {
                        // Without the ingest only a small MP4 (Safari) can go straight up.
                        limitFor: (mimeType) => ingestEnabled(getConfig())
                            ? Number(getConfig()?.web_media_ingest_video_max_duration_ms) || 60_000
                            : mimeType.startsWith('video/mp4') ? 15_000 : 0,
                        onRecorded: ({ file, durationMs, poster }) => { showChatMediaReview(); void prepareSelectedChatMedia(file, { durationMsHint: durationMs, poster }); },
                    },
                });
            }
        } catch (_) {
            releaseStreamRequest(streamRequest);
            if (token !== chatCameraToken) return;
            showChatMediaReview();
            $(".chat-media-status").textContent = "The camera needs a connection to load. Choose a photo from your library instead.";
            return;
        }
        if (token !== chatCameraToken || !$('[data-chat-media-dialog]').open) return releaseStreamRequest(streamRequest);
        chatCamera.open({ stream: streamRequest });
    }
    $('[data-retake-chat-photo]').addEventListener('click', startChatCamera);
    $('[data-chat-photo-library]').addEventListener('click', () => { showChatMediaReview(); $('.chat-media-file-input').click(); });
    async function startMementoCamera() {
        if (mementoPublishing) return;
        resetMementoComposer();
        const token = ++mementoCameraToken;
        const streamRequest = mementoCamera ? null : cameraStreamRequest('environment');
        $('[data-memento-dialog]').classList.add('is-capturing');
        $('.memento-photo-fallback').hidden = true;
        try {
            await ensureMementoCamera();
        } catch (_) {
            releaseStreamRequest(streamRequest);
            if (token !== mementoCameraToken) return;
            $('[data-memento-dialog]').classList.remove('is-capturing');
            $('.memento-photo-fallback').hidden = false;
            $(".memento-status").textContent = "The camera needs a connection to load. Choose a photo instead.";
            return;
        }
        if (token !== mementoCameraToken || !$('[data-memento-dialog]').open) return releaseStreamRequest(streamRequest);
        mementoCamera.open({ stream: streamRequest });
    }
    $('[data-retake-memento]').addEventListener('click', startMementoCamera);
    let searchGeneration = 0;
    function closeSearch() {
        searchGeneration++;
        $('.chat-search-form').classList.add('hidden');
        $('.chat-search-form input').value = '';
        $('.chat-search-results').classList.add('hidden');
        $('.chat-list').classList.remove('hidden');
        $('.chat-list-status').textContent = '';
        $('[data-focus-chat-search]').setAttribute('aria-expanded', 'false');
        renderRecentConversations();
        $('[data-focus-chat-search]').focus({ preventScroll: true });
    }
    $('[data-focus-chat-search]').addEventListener('click', () => {
        $('.chat-search-form').classList.remove('hidden');
        $('[data-focus-chat-search]').setAttribute('aria-expanded', 'true');
        $('.chat-search-form input').focus();
    });
    $('[data-cancel-chat-search]').addEventListener('click', closeSearch);
    $('.chat-search-form').addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); closeSearch(); }
    });
    const stickerMaker = createStickerMaker({
        dialog: $("[data-sticker-maker-dialog]"),
        saveSticker: (file) => api.createSticker(file),
        onCreated: async (sticker) => {
            if (photoStickerMode) {
                const url = safeMediaURL(sticker.image_url, api);
                if (url) await photoStickers.add(url);
                return;
            }
            await loadStickerLibrary();
            await sendSticker(sticker.id);
        },
        onUnconfirmed: async () => {
            $("[data-sticker-library-dialog]").showModal();
            await loadStickerLibrary();
            $(".chat-sticker-status").textContent = "We couldn't confirm that save. Check your stickers before trying again so you don't create a duplicate.";
        },
        softHaptic,
        successHaptic,
    });
    const userId = () => getUser()?.id;
    const dailyLedgerEnabled = () => getConfig()?.enable_chat_daily_ledger === true
        && getConfig()?.enable_web_mementos === true;
    const chatAccessUnavailable = () => dailyLedgerEnabled()
        && (!store.state.dailyRow || store.state.dailyRow.view_gate_locked === true);

    function currentChatAppearance() {
        return loadChatAppearance(userId(), store.state.activeChatId);
    }

    function applyChatAppearance(appearance = currentChatAppearance()) {
        const room = $(".chat-room-screen");
        const settings = $("[data-chat-settings-dialog]");
        room.dataset.chatFont = appearance.font;
        room.dataset.chatColor = appearance.color;
        settings.dataset.chatFont = appearance.font;
        settings.dataset.chatColor = appearance.color;
    }

    function updateChatAppearance(change) {
        if (!userId() || !store.state.activeChatId) return;
        const appearance = saveChatAppearance(userId(), store.state.activeChatId, {
            ...currentChatAppearance(),
            ...change,
        });
        applyChatAppearance(appearance);
        renderSettings();
        softHaptic?.();
    }

    const mediaViewer = $('[data-chat-media-viewer]');
    mediaViewer.addEventListener('pointerdown', event => {
        if (!ephemeralTimer || event.target.closest('button')) return;
        ephemeralPointer = { x: event.clientX, y: event.clientY, at: performance.now() };
        setEphemeralPaused(true);
    });
    mediaViewer.addEventListener('pointerup', event => {
        if (!ephemeralPointer) return;
        const point = ephemeralPointer; ephemeralPointer = null;
        // Drag-to-dismiss belongs to the gesture module once it has loaded.
        const dragged = event.clientY - point.y > 90;
        if (dragged && viewerGestures) return;
        if (dragged || (performance.now() - point.at < 220 && Math.abs(event.clientY - point.y) < 12 && event.clientX > innerWidth / 2)) closeMediaViewer();
        else setEphemeralPaused(false);
    });
    mediaViewer.addEventListener('pointercancel', () => { ephemeralPointer = null; setEphemeralPaused(false); });
    $('.chat-timeline').addEventListener('scroll', () => requestAnimationFrame(recordVisibleHistory), { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { void historyReceipts?.leave(store.state.activeChatId); closeMediaViewer(); closeMessageActions(); stopTyping(); }
        else if (activation) {
            void refreshSharedHistory(); requestAnimationFrame(recordVisibleHistory);
            void retryPendingMessages(null);
        }
        scheduleHistorySweep();
        reportActiveChat();
    });
    addEventListener('pagehide', () => { void historyReceipts?.leave(); closeMediaViewer(); closeMessageActions(); stopTyping(); reportActiveChat(); });
    addEventListener('online', () => { void historyReceipts?.flush(); void refreshSharedHistory(); });
    if (panel) new MutationObserver(() => {
        if (panel.classList.contains('hidden')) {
            void historyReceipts?.leave(); closeMediaViewer(); closeMessageActions();
            // Another tab replaced this room; typing and presence must not linger.
            if (store.state.activeChatId) leaveRoom();
        }
        else { void refreshSharedHistory(); requestAnimationFrame(recordVisibleHistory); }
        scheduleHistorySweep();
        reportActiveChat();
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });

    // Expired history disappears at its deadline. One timer for the nearest
    // deadline in the open room, never a standing interval, and none while hidden.
    function scheduleHistorySweep() {
        clearTimeout(historySweepTimer);
        historySweepTimer = null;
        if (!store.state.activeChatId || document.hidden || root.closest('.hidden')) return;
        const now = Date.now();
        const next = store.messages().reduce((soonest, message) => {
            const at = Date.parse(message.history_expires_at);
            return message.kind !== 'memento' && Number.isFinite(at) && at < soonest ? at : soonest;
        }, Infinity);
        if (!Number.isFinite(next)) return;
        historySweepTimer = setTimeout(() => {
            historySweepTimer = null;
            if (store.state.activeChatId && store.messages().some(message => !historyVisible(message))) renderMessages(false, { preservePosition: true });
            else scheduleHistorySweep();
        }, Math.min(2_147_000_000, Math.max(250, next - now + 50)));
    }

    // The shell forwards this to the service worker so an open, visible room
    // does not also raise a notification for its own messages.
    let reportedChatId;
    function reportActiveChat() {
        const roomVisible = !document.hidden && !root.closest('.hidden') && !$('[data-chat-screen=room]').classList.contains('hidden');
        const chatId = roomVisible && store.state.activeChatId ? String(store.state.activeChatId) : null;
        if (chatId === reportedChatId) return;
        reportedChatId = chatId;
        if (chatId) document.documentElement.dataset.activeChatId = chatId;
        else delete document.documentElement.dataset.activeChatId;
        window.dispatchEvent(new CustomEvent('valid:active-chat', { detail: { chatId } }));
    }
    root.addEventListener('pointerdown', event => {
        const target = event.target.closest('[data-replay]');
        if (!target || target.disabled || viewOnceStates.get(target.dataset.openViewOnce)?.armed) return;
        replaySuppressClick = false; replayHoldTarget = target;
        replayHoldTimer = setTimeout(() => {
            if (!target.isConnected) return;
            viewOnceStates.set(target.dataset.openViewOnce, { armed: true });
            target.classList.add('armed'); target.querySelector('strong').textContent = 'Tap to replay';
            target.setAttribute('aria-label', `${target.classList.contains('video') ? 'Video' : 'Photo'} · Tap to replay`);
            replaySuppressClick = true; softHaptic?.();
        }, 450);
    });
    for (const event of ['pointerup', 'pointercancel', 'pointerleave']) root.addEventListener(event, () => {
        clearTimeout(replayHoldTimer); replayHoldTimer = null; replayHoldTarget = null;
    });
    root.addEventListener("click", handleClick);
    root.addEventListener("dblclick", handleMessageDoubleClick);
    // The room pops like a detail screen: it follows the finger over the chat
    // list and, when released past the threshold, leaves exactly like Back.
    installSwipeBack?.($(".chat-room-screen"), backFromRoom, {
        onTrack: () => $(".chat-shell").classList.add("chat-swipe-reveal"),
        onSettle: () => $(".chat-shell").classList.remove("chat-swipe-reveal"),
    });
    const messageActions = bindMessageActions(root, { onOpen: () => softHaptic?.() });
    const timelineScroll = createTimelineScroll($('.chat-timeline'), {
        onEdge: direction => void advanceHistory(direction),
        onPosition: updateLatestButton,
    });
    $(".chat-composer").addEventListener("submit", sendMessage);
    $(".chat-search-form").addEventListener("submit", searchChats);
    $(".chat-composer textarea").addEventListener("input", () => { handleTypingInput(); resizeComposer(); });
    $(".chat-composer textarea").addEventListener("keydown", (event) => {
        // Hardware keyboards send with Enter (Shift+Enter adds a line); touch keyboards keep Return as a newline.
        if (event.key !== "Enter" || event.shiftKey || event.isComposing || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
        event.preventDefault();
        $(".chat-composer").requestSubmit();
    });
    // Tapping Send must not move focus off the composer (the keyboard stays up).
    $(".chat-send-button").addEventListener("mousedown", (event) => {
        if (document.activeElement === $(".chat-composer textarea")) event.preventDefault();
    });
    // Expired signed URLs (~15 minutes) fail every route; fetch fresh ones once per message.
    $(".chat-timeline").addEventListener("error", (event) => {
        const image = event.target;
        if (!(image instanceof HTMLImageElement) || !image.dataset.messageMedia || !image.classList.contains("media-placeholder")) return;
        const message = store.messages().find((item) => item.id === image.dataset.messageMedia);
        if (message) void refreshMessageMedia(message);
    }, true);
    $(".chat-person-search input").addEventListener("input", renderPeople);
    $(".chat-people-list").addEventListener("change", updateCreateState);
    $(".memento-file-input").addEventListener("change", selectMemento);
    $(".memento-form").addEventListener("submit", publishMemento);
    $("[data-memento-dialog]").addEventListener("close", resetMementoComposer);
    $('[data-memento-gallery-dialog]').addEventListener('close', () => {
        mementoDateGeneration++;
        store.state.displayedDailyRow = store.state.dailyRow;
        $('.chat-memento-gallery').innerHTML = '';
    });
    $("[data-memento-dialog]").addEventListener("cancel", (event) => {
        if (mementoPublishing) event.preventDefault();
    });
    $(".chat-media-file-input").addEventListener("change", selectChatMedia);
    $(".chat-sticker-file-input").addEventListener("change", selectStickerSource);
    $(".chat-media-form").addEventListener("submit", publishChatMedia);
    $("[data-chat-media-dialog]").addEventListener("close", resetChatMediaComposer);
    $('[data-chat-media-dialog]').addEventListener('cancel', event => { if (chatMediaPublishing) event.preventDefault(); });
    $("[data-chat-view-once]").addEventListener("change", () => {
        $('.chat-media-option span').textContent = $('[data-chat-view-once]').checked ? 'View once' : 'Keep in chat';
        resetChatMediaRequestIds();
    });
    $("[data-chat-media-viewer]").addEventListener("close", () => { if (!$("[data-chat-media-viewer]").open) { mediaOpenGeneration++; resetMediaViewerContents(); } });
    window.addEventListener("online", () => {
        if (!activation) return;
        void retryPendingMessages(null);
        void retryPendingMediaUploads();
    });
    navigator.serviceWorker?.addEventListener?.("message", (event) => {
        if (event.data?.type === "valid-media-outbox-sync") void retryPendingMediaUploads();
    });

    const visiblePresenceNodes = new Set();
    const presenceObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (entry.isIntersecting) visiblePresenceNodes.add(entry.target);
            else visiblePresenceNodes.delete(entry.target);
        }
        updatePresenceAudience();
    }, { threshold: 0.1 });
    const isGroupChat = chat => chat?.name != null || Number(chat?.accepted_count) + Number(chat?.pending_count) >= 3;
    function eligibleForPresence(chat) {
        return chat?.membership_status === 'accepted' && chat.status === 'active' && chat.has_viewer_blocked_member !== true;
    }
    function updatePresenceAudience() {
        if (!activation?.isCurrent?.()) return;
        const ids = [];
        const chat = store.state.detail?.chat;
        if (!$("[data-chat-screen=room]").classList.contains('hidden') && eligibleForPresence(chat)) ids.push(chat.id);
        for (const node of visiblePresenceNodes) {
            if (node.isConnected && node.getClientRects().length) ids.push(node.dataset.presenceWatch);
        }
        presence?.setWatched(ids);
    }
    function observePresence() {
        presenceObserver.disconnect();
        visiblePresenceNodes.clear();
        $$('[data-presence-watch]').forEach(node => presenceObserver.observe(node));
        updatePresenceAudience();
        renderPresence();
    }
    function renderPresence() {
        if (!presence) return;
        $$('[data-presence-dot]').forEach(node => {
            const active = presence.status(node.dataset.presenceDot).active;
            if (node.hidden === active) node.hidden = !active;
        });
        $$('[data-presence-label]').forEach(node => {
            const chat = store.state.chats.find(chat => chat.id === node.dataset.presenceLabel);
            const value = eligibleForPresence(chat) ? presence.status(chat.id, isGroupChat(chat)) : { label: '', active: false };
            if (node.textContent !== value.label) node.textContent = value.label;
            if (node.hidden === !!value.label) node.hidden = !value.label;
            if (node.classList.contains('is-active') !== value.active) node.classList.toggle('is-active', value.active);
        });
        if (store.state.detail?.chat) renderRoomPresence(store.state.detail.chat);
        $$('[data-presence-member]').forEach(node => {
            const member = presence.members(store.state.activeChatId).find(member => String(member.user_id) === node.dataset.presenceMember);
            const label = presenceLabel(member, presence.serverNow());
            const text = label || node.dataset.presenceFallback;
            if (node.textContent !== text) node.textContent = text;
            if (node.classList.contains('is-active') !== (label === 'Active now')) node.classList.toggle('is-active', label === 'Active now');
        });
    }
    presence?.subscribe(renderPresence);

    // The route keeps one view for the page's lifetime; a different account
    // must never see the previous account's inbox, rooms or timers.
    function resetForUser() {
        if (store.state.activeChatId) leaveRoom();
        viewUserId = userId() ? String(userId()) : null;
        lastListLoad = 0;
        store.replaceChats([]);
        store.state.messagesByChat.clear();
        store.state.messagePageByChat.clear();
        store.state.lastEventId = null;
        clearTimeout(outboxRetryTimer); outboxRetryTimer = null;
        clearTimeout(mediaOutboxRetryTimer); mediaOutboxRetryTimer = null;
        clearTimeout(listRefreshTimer); listRefreshTimer = null;
        for (const timer of chatRefreshTimers.values()) clearTimeout(timer);
        chatRefreshTimers.clear();
        refreshedMediaMessages.clear();
        readWatermark = { chatId: null, sequence: 0 };
        $(".chat-list").innerHTML = "";
        $(".chat-recent-rail").innerHTML = "";
        $(".chat-recent").classList.add("hidden");
        onUnreadChange?.(0);
    }

    async function activate(context) {
        if ((userId() ? String(userId()) : null) !== viewUserId) resetForUser();
        ensureHistoryReceipts();
        activation = context;
        if (!(getConfig()?.enable_chats === true && getConfig()?.enable_web_chats === true)) {
            $(".chat-list-status").textContent = "Chats are not available yet.";
            return;
        }
        realtime.start();
        if (!store.state.chats.length || Date.now() - lastListLoad > REFRESH_MS) await loadChats();
        void retryPendingMediaUploads();
        void retryPendingMessages(null);
        const requestedChatId = new URLSearchParams(location.search).get("chat");
        if (requestedChatId) await openChat(requestedChatId, { updateHistory: false });
        else {
            // Browser Back from a room lands here: run the same cleanup as the in-app back button.
            if (store.state.activeChatId) leaveRoom();
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
        if (name !== 'room' && voiceMode) resetChatMediaComposer();
        $$('[data-chat-screen]').forEach((screen) => screen.classList.toggle("hidden", screen.dataset.chatScreen !== name));
        root.closest(".panel")?.classList.toggle("chat-room-open", name === "room");
        if (name === "room") syncVoiceComposer();
        observePresence();
        reportActiveChat();
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
            if (store.state.activeChatId) renderMementoToolbar();
        } catch (error) {
            $(".chat-list-status").textContent = userMessage(error, "Could not load chats.");
        } finally {
            store.state.loadingList = false;
        }
    }

    function renderChatList() {
        renderRecentConversations();
        const list = $(".chat-list");
        $(".chat-list-status").textContent = "";
        const entries = store.state.chats.map((chat) => ({ key: chat.id, html: chatRowMarkup(chat) }));
        if (!entries.length) {
            list.innerHTML = `<article class="chat-empty"><span>${uiIcon("chat")}</span><h2>No chats yet</h2><p>Start a group and capture today's Memento together.</p><button class="primary-button" type="button" data-new-chat>Start a chat</button></article>`;
        } else {
            reconcileKeyedElements(list, entries);
        }
        const unread = store.state.chats.reduce((total, chat) => total + Number(chat.unread_count || 0), 0);
        onUnreadChange?.(unread);
        observePresence();
    }

    function conversationAvatarMarkup(chat) {
        const isGroup = chat.name != null || chat.accepted_count + chat.pending_count >= 3;
        const photo = safeMediaURL(isGroup ? chat.chat_photo_url : chat.pair_profile_picture_url || chat.member_previews?.[0]?.profile_picture_url, api);
        const initial = String(chat.display_name || "").slice(0, 1).toUpperCase();
        if (photo) return mediaImageMarkup(photo, { initials: initial || "V" });
        if (!isGroup) return `<span>${escapeChatHTML(chat.display_name.slice(0, 1).toUpperCase())}</span>`;
        const members = (chat.member_previews || []).slice(0, 4);
        return `<span class="chat-avatar-mosaic" data-member-count="${members.length}" aria-hidden="true">${members.length ? members.map(member => {
            const image = safeMediaURL(member.profile_picture_url, api);
            const initial = displayMember(member).slice(0, 1).toUpperCase();
            return `<i class="chat-avatar-member">${image ? mediaImageMarkup(image, { initials: initial }) : escapeChatHTML(initial)}</i>`;
        }).join('') : uiIcon('group')}</span>`;
    }

    function renderRecentConversations() {
        const chats = recentConversations(store.state.chats);
        $(".chat-recent").classList.toggle("hidden", !chats.length || !$(".chat-search-results").classList.contains("hidden"));
        reconcileKeyedElements($(".chat-recent-rail"), chats.map(chat => {
            const isGroup = chat.name != null || chat.accepted_count + chat.pending_count >= 3;
            const name = isGroup ? chat.display_name : (chat.pair_display_name || chat.display_name).split(/\s+/)[0];
            const needsMemento = chatNeedsMemento(chat, dailyLedgerEnabled());
            const unread = Math.max(0, Number(chat.unread_count) || 0);
            const hint = [needsMemento ? "Today's Memento needed" : "", unread ? `${unread} unread` : ""].filter(Boolean).join(", ");
            const url = new URL(location.href);
            url.search = "";
            // Preserve the local demo context; deployed URLs only contain the route.
            const current = new URLSearchParams(location.search);
            if (current.get('demo') === '1') url.searchParams.set('demo', '1');
            url.searchParams.set('tab', 'chats');
            url.searchParams.set('chat', chat.id);
            const html = `<a class="chat-recent-link ${attentionPriority(chat) > 0 ? "attention" : ""}" aria-describedby="chat-presence-${escapeChatHTML(chat.id)}" data-presence-watch="${escapeChatHTML(chat.id)}" data-list-key="${escapeChatHTML(chat.id)}" data-open-chat="${escapeChatHTML(chat.id)}" href="${escapeChatHTML(url.pathname + url.search)}" aria-label="${escapeChatHTML(chat.display_name)}${hint ? `, ${escapeChatHTML(hint)}` : ""}"><span class="chat-recent-avatar">${conversationAvatarMarkup(chat)}<i class="chat-presence-dot" role="img" data-presence-dot="${escapeChatHTML(chat.id)}" aria-label="Active now" hidden></i>${needsMemento ? `<i class="chat-recent-camera" aria-hidden="true">${uiIcon('camera-filled')}</i>` : unread ? '<i class="chat-recent-unread" aria-hidden="true"></i>' : ''}</span><span class="chat-recent-name">${escapeChatHTML(name)}</span><small id="chat-presence-${escapeChatHTML(chat.id)}" class="chat-presence-label" data-presence-label="${escapeChatHTML(chat.id)}" hidden></small></a>`;
            return { key: chat.id, html };
        }));
    }

    async function searchChats(event) {
        event.preventDefault();
        const query = $(".chat-search-form input").value.trim();
        if (query.length < 2) {
            $(".chat-list-status").textContent = "Enter at least two characters.";
            return;
        }
        const generation = ++searchGeneration;
        const results = $(".chat-search-results");
        $(".chat-list-status").textContent = "Searching…";
        try {
            const response = await api.searchChats(userId(), query, 8);
            if (generation !== searchGeneration) return;
            const chats = response.chats?.items || [];
            const messages = response.messages?.items || [];
            const chatRows = chats.map((item) => `<button type="button" data-search-chat="${escapeChatHTML(item.chat_id)}"><strong>${escapeChatHTML(item.title)}</strong><small>${escapeChatHTML(item.subtitle || "Conversation")}</small></button>`).join("");
            const messageRows = messages.map((item) => `<button type="button" data-search-chat="${escapeChatHTML(item.chat_id)}" data-search-message="${escapeChatHTML(item.id)}"><strong>${escapeChatHTML(item.title)}</strong><small>${escapeChatHTML(item.snippet || item.subtitle || "Message")}</small></button>`).join("");
            results.innerHTML = `${chatRows ? `<section><h2>Chats</h2>${chatRows}</section>` : ""}${messageRows ? `<section><h2>Messages</h2>${messageRows}</section>` : ""}${!chatRows && !messageRows ? `<p>No chat results for “${escapeChatHTML(response.query || query)}”.</p>` : ""}`;
            results.classList.remove("hidden");
            $(".chat-list").classList.add("hidden");
            $(".chat-recent").classList.add("hidden");
            $(".chat-list-status").textContent = `${chats.length + messages.length} result${chats.length + messages.length === 1 ? "" : "s"}`;
        } catch (error) {
            if (generation !== searchGeneration) return;
            results.classList.add("hidden");
            $(".chat-list").classList.remove("hidden");
            renderRecentConversations();
            $(".chat-list-status").textContent = userMessage(error, "Could not search chats.");
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
        const avatar = conversationAvatarMarkup(chat);
        if (chat.membership_status === "invited") {
            return `<article class="chat-row invitation attention" data-list-key="${escapeChatHTML(chat.id)}"><button class="chat-row-main" type="button" data-open-chat="${escapeChatHTML(chat.id)}"><span class="chat-avatar">${avatar}</span><span class="chat-row-copy"><strong>${escapeChatHTML(chat.display_name)}</strong><small>${escapeChatHTML(chatPreview(chat))}</small></span></button><div class="chat-invite-actions"><button type="button" data-decline-chat="${escapeChatHTML(chat.membership_id)}">Decline</button><button type="button" data-accept-chat="${escapeChatHTML(chat.membership_id)}">Accept</button></div></article>`;
        }

        const needsMemento = chatNeedsMemento(chat, dailyLedgerEnabled());
        const pending = Number(chat.unopened_view_once_count) > 0 && chat.next_view_once_room_sequence != null;
        const missed = getConfig()?.enable_calls === true && getConfig()?.enable_web_calls === true && chat.unacknowledged_missed_call_id;
        const trailing = missed ? `<button type="button" class="chat-inbox-action missed" data-return-missed-call="${escapeChatHTML(chat.id)}">${uiIcon('phone')} Call back</button>`
            : pending ? `<button type="button" class="chat-inbox-action" data-pending-media="${escapeChatHTML(chat.id)}" aria-label="View ${Number(chat.unopened_view_once_count)} unopened media ${Number(chat.unopened_view_once_count) === 1 ? 'item' : 'items'}"><i class="${chat.next_view_once_kind === 'video' ? 'video' : 'photo'}"></i>View ${Number(chat.unopened_view_once_count)}</button>` : '';
        return `<article class="chat-row ${attentionPriority(chat) > 0 ? "attention" : ""} ${trailing ? 'has-inbox-action' : ''}" data-list-key="${escapeChatHTML(chat.id)}"><button class="chat-row-main" type="button" data-open-chat="${escapeChatHTML(chat.id)}"><span class="chat-avatar-wrap" ${eligibleForPresence(chat) ? `data-presence-watch="${escapeChatHTML(chat.id)}"` : ""}><span class="chat-avatar">${avatar}</span>${eligibleForPresence(chat) ? `<i class="chat-presence-dot" role="img" data-presence-dot="${escapeChatHTML(chat.id)}" aria-label="Active now" hidden></i>` : ""}</span><span class="chat-row-copy"><span><strong>${escapeChatHTML(chat.display_name)}</strong>${streakMarkup(chat)}</span><small>${escapeChatHTML(needsMemento ? "Take today's Memento" : chatPreview(chat))}</small></span><span class="chat-row-trailing">${!trailing && needsMemento ? `<span class="chat-needs-memento" aria-label="Take today's Memento">${uiIcon('camera-filled')}</span>` : !trailing ? `${chat.regular_unread_count ? `<b class="chat-unread">${Math.min(chat.regular_unread_count, 99)}</b>` : ''}<time>${escapeChatHTML(relativeChatTime(chat.last_message_at || chat.updated_at))}</time>` : ''}</span></button>${trailing}</article>`;
    }

    async function openChat(chatId, { updateHistory = true, force = false, latest = false } = {}) {
        // Warm the camera module (precached) so the camera button opens at once.
        if (!cameraWarmed) {
            cameraWarmed = true;
            setTimeout(() => { void loadLiveCamera().then((module) => module.ensureCameraStyles()).catch(() => { cameraWarmed = false; }); }, 600);
        }
        const chat = store.state.chats.find((item) => item.id === String(chatId));
        if (chat?.membership_status === "invited") return;
        const savedPosition = store.state.activeChatId === String(chatId) && !latest ? timelineScroll.capture() : null;
        const savedAnchor = savedPosition && !savedPosition.bottom
            ? savedPosition.anchors.map(anchor => store.messages().find(item => item.id === anchor.key)).find(Boolean) : null;
        if (store.state.activeChatId !== String(chatId)) {
            store.state.typingUserIds.clear();
            $(".chat-typing").classList.add("hidden");
            void historyReceipts?.leave(store.state.activeChatId);
            viewOnceSessionByMessage.clear(); viewOnceStates.clear();
            closeMediaViewer();
            resetChatMediaComposer();
            $('[data-chat-media-dialog]').close();
            stopTyping();
            clearSharedMementoDraft();
            store.state.replyToMessageId = null;
            renderReplyDraft();
            store.state.detail = null;
            store.state.dailyRow = null;
            store.state.displayedDailyRow = null;
            store.state.dailyRowsByDate.clear();
            $('[data-memento-gallery-dialog]').close();
            $('.chat-memento-gallery').innerHTML = '';
        }
        const generation = ++roomGeneration;
        void loadRoomTools();
        historyLoading = null;
        historyError = null;
        historyHasNewer = false;
        messagesRevision++;
        timelineScroll.reset();
        store.state.activeChatId = String(chatId);
        store.state.loadingRoom = true;
        renderDailyRow();
        applyChatAppearance();
        store.state.typingUserIds.clear();
        showScreen("room");
        $(".chat-room-status").textContent = "Loading conversation…";
        renderRoomHeader(chat || { display_name: "Chat", accepted_count: 0 });
        if (updateHistory) pushRoomHistory(chatId);
        // Establish the initial viewport synchronously before the first paint.
        // Only an already-open room being refreshed retains a reading anchor.
        renderMessages(!savedAnchor);
        if (savedAnchor) timelineScroll.restore(savedPosition);
        const [detailResult, messagesResult, dailyResult] = await Promise.allSettled([
            api.getChat(userId(), chatId),
            api.getChatMessages(userId(), chatId, savedAnchor ? { limit: 100, afterSequence: Math.max(0, Math.floor(savedAnchor.room_sequence) - 1) } : { limit: 50 }),
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
            rememberDailyRow(dailyResult.value);
        } else {
            store.state.dailyRow = null;
            store.state.displayedDailyRow = null;
        }
        if (messagesResult.status === "fulfilled") {
            store.replaceMessages(chatId, messagesResult.value.items || [], messagesResult.value);
            if (savedAnchor) {
                historyHasNewer = (messagesResult.value.items || []).length === 100;
                store.state.messagePageByChat.set(String(chatId), { next_before_sequence: store.messages()[0]?.room_sequence > 1 ? store.messages()[0].room_sequence : null });
            }
            $(".chat-room-status").textContent = "";
        } else {
            if ([401, 403, 404].includes(messagesResult.reason?.status)) store.replaceMessages(chatId, []);
            const locked = messagesResult.reason?.status === 403 && /memento/i.test(messagesResult.reason?.message || "");
            $(".chat-room-status").textContent = locked ? "Take today's Memento to open this chat." : (userMessage(messagesResult.reason, "Could not load messages."));
        }
        await restorePendingMessages(chatId);
        if (generation !== roomGeneration || store.state.activeChatId !== String(chatId)) return;
        store.state.loadingRoom = false;
        void refreshSharedHistory();
        renderDailyRow();
        renderMessages(!savedAnchor);
        if (savedAnchor) timelineScroll.restore(savedPosition);
        focusDeepLinkedMessage(chatId);
        renderSettings();
        updatePresenceAudience();
        if (!savedAnchor) await markRoomRead();
        scheduleChatRowRefresh(String(chatId), 0);
        if (!chatAccessUnavailable()) void retryPendingMessages(chatId);
        const requestedCallId = new URLSearchParams(location.search).get("call");
        if (requestedCallId) void calls.open(requestedCallId);
    }

    function renderRoomHeader(chat) {
        $(".chat-room-title strong").textContent = chat?.display_name || "Chat";
        const acceptedCount = Number(chat?.accepted_count || 0);
        renderRoomPresence(chat);
        const callsAvailable = calls.enabled()
            && acceptedCount >= 2
            && chat?.membership_status !== "invited"
            && chat?.has_viewer_blocked_member !== true;
        $(".chat-call-actions").classList.toggle("hidden", !callsAvailable);
        if (callsAvailable) calls.preload();
    }

    function renderRoomPresence(chat) {
        const pendingCount = Number(chat?.pending_count || 0);
        const totalCount = Number(chat?.accepted_count || 0) + pendingCount;
        const activity = eligibleForPresence(chat) ? presence?.status(chat.id, isGroupChat(chat)) : null;
        const subtitle = $(".chat-room-title small");
        const label = store.state.typingUserIds.size ? 'typing…' : isGroupChat(chat)
            ? `${totalCount} people${pendingCount ? ` · ${pendingCount} invited` : ''}${activity?.label ? ` · ${activity.label}` : ''}`
            : activity?.label || '';
        if (subtitle.textContent !== label) subtitle.textContent = label;
        const active = !!activity?.active && !store.state.typingUserIds.size;
        if (subtitle.classList.contains('is-active') !== active) subtitle.classList.toggle('is-active', active);
    }

    function renderDailyRow() {
        const row = store.state.dailyRow;
        const enabled = dailyLedgerEnabled() && row;
        const offerCapture = enabled && !row.viewer_has_shared && row.viewer_is_eligible !== false;
        const locked = offerCapture && row.view_gate_locked === true;
        const gate = locked ? `<div class="memento-gate-heading"><span class="memento-gate-icon" aria-hidden="true">${uiIcon('camera-filled')}</span><h2>Today's Memento</h2><p>Capture a real moment to remember today and unlock chat.</p></div>` : '';
        const skip = locked ? `<div><button class="memento-gate-skip" type="button" data-skip-memento aria-describedby="mementoSkipHint" ${mementoSkipping ? 'disabled' : ''}>${mementoSkipping ? 'Skipping…' : 'Skip for today'}</button><span class="visually-hidden" id="mementoSkipHint">Unlocks this chat without posting a Memento</span></div>` : '';
        $('.chat-daily-row').innerHTML = offerCapture ? `${gate}<button type="button" data-open-memento aria-label="Take today's Memento" ${mementoSkipping ? 'disabled' : ''}><span class="chat-daily-icon">${uiIcon('camera-filled')}</span><span><strong>Take Memento</strong></span></button>${skip}` : '';
        $('.chat-daily-row').classList.toggle('is-gate', Boolean(locked));
        $('.chat-daily-row').classList.toggle('hidden', !offerCapture);
        $('.chat-composer').classList.toggle('hidden', chatAccessUnavailable());
        renderMementoToolbar();
        if ($('[data-memento-gallery-dialog]').open) renderMementoGallery();
    }

    function streakMarkup(chat) {
        const streak = Number(chat?.moment_streak);
        if (!Number.isSafeInteger(streak) || streak <= 0 || Number(chat?.accepted_count) < 2) return '';
        return `<span class="chat-moment-streak" aria-label="${streak} day moment streak">${uiIcon('fire')}<span>${streak}</span></span>`;
    }

    function renderMementoToolbar() {
        const row = store.state.dailyRow;
        const button = $('[data-open-memento-gallery]');
        const visible = dailyLedgerEnabled() && row?.viewer_has_shared === true;
        button.classList.toggle('hidden', !visible);
        if (!visible) { button.innerHTML = ''; return; }
        const eligible = Math.max(0, Math.floor(Number(row.eligible_count) || 0));
        const posted = Math.min(eligible, Math.max(0, Math.floor(Number(row.posted_count) || 0)));
        const chat = store.state.chats.find(c => c.id === store.state.activeChatId) || store.state.detail?.chat;
        const waiting = (row.entries || []).filter(entry => !entry.has_posted).map(entry => entry.first_name || 'a member').join(', ');
        button.innerHTML = `<span class="chat-memento-toolbar-pill">${uiIcon('memento')}<span>${posted}/${eligible}</span><span class="chat-moment-streak" aria-label="${Math.max(0, Number(chat.moment_streak) || 0)} day moment streak">${uiIcon('fire')}<span>${Math.max(0, Number(chat.moment_streak) || 0)}</span></span></span>`;
        button.classList.toggle('complete', eligible > 0 && posted === eligible);
        button.setAttribute('aria-label', `Mementos, ${posted} of ${eligible} captured. ${waiting ? `Waiting for ${waiting}` : 'Everyone is done'}${Number(chat?.moment_streak) > 0 ? `, ${chat.moment_streak} day streak` : ''}`);
    }

    function openMementoGallery() {
        if (!dailyLedgerEnabled() || !store.state.dailyRow?.viewer_has_shared) return;
        store.state.displayedDailyRow = store.state.dailyRow;
        $('.chat-memento-gallery-status').textContent = '';
        renderMementoGallery();
        $('[data-memento-gallery-dialog]').showModal();
        softHaptic?.();
    }

    function renderMementoGallery() {
        const container = $(".chat-memento-gallery");
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
        container.innerHTML = `<div class="chat-memento-week" aria-label="Memento dates">${dateButtons}</div><h2>${dateLabel}</h2><p>${posted} of ${eligible} captured</p><div class="chat-memento-strip">${entries.map((entry) => {
            const src = safeMediaURL(entry.image_url, api);
            const swapped = safeMediaURL(entry.swapped_image_url, api);
            const name = escapeChatHTML(entry.first_name || "Student");
            return src ? `<button type="button" data-view-memento="${escapeChatHTML(src)}" ${swapped ? `data-memento-swapped="${escapeChatHTML(swapped)}"` : ""} data-memento-owner="${escapeChatHTML(displayMember(entry))}" data-memento-entry="${escapeChatHTML(entry.entry_id || "")}"><img src="${escapeChatHTML(src)}" alt="${escapeChatHTML(displayMember(entry))}'s Memento" loading="lazy" decoding="async"><span>${name}</span></button>` : `<span class="chat-memento-missing"><i aria-hidden="true">${uiIcon(entry.has_posted ? "lock" : "clock")}</i><span>${name}</span><small>${entry.has_posted ? "Locked" : "Waiting"}</small></span>`;
        }).join("")}</div>`;
    }

    function rememberDailyRow(row) {
        const earliest = new Date();
        earliest.setDate(earliest.getDate() - 6);
        const first = localLedgerDate(earliest);
        const last = localLedgerDate();
        for (const date of store.state.dailyRowsByDate.keys()) {
            if (date < first || date > last) store.state.dailyRowsByDate.delete(date);
        }
        if (row?.ledger_date >= first && row.ledger_date <= last) store.state.dailyRowsByDate.set(row.ledger_date, row);
    }

    function renderMessages(scrollToBottom = false, { focusMessageId = null, focusAlignment = "center", preservePosition = false } = {}) {
        const timeline = $(".chat-timeline");
        const position = timelineScroll.capture();
        if (dailyLedgerEnabled() && !store.state.dailyRow) {
            timeline.classList.remove('chat-content-locked');
            timeline.innerHTML = `<div class="chat-room-empty"><p>${store.state.loadingRoom ? 'Loading conversation…' : 'Could not check Memento access. Reopen this chat to retry.'}</p></div>`;
            $('[data-jump-latest]').classList.add('hidden');
            return;
        }
        if (store.state.dailyRow?.view_gate_locked === true) {
            timeline.classList.add("chat-content-locked");
            timeline.innerHTML = `<div class="chat-room-empty"><strong>Chat locked</strong><p>Take today's Memento to see new messages.</p></div>`;
            $('[data-jump-latest]').classList.add('hidden');
            return;
        }
        timeline.classList.remove("chat-content-locked");
        if (viewedMessageId) {
            const viewed = store.messages().find(message => message.id === viewedMessageId);
            if (!viewed || viewed.status !== 'active' || !historyVisible(viewed)) closeMediaViewer();
        }
        // Expired content cannot survive in a mounted room while offline.
        const visibleHistory = store.messages().filter(message => historyVisible(message));
        if (visibleHistory.length !== store.messages().length) store.replaceMessages(store.state.activeChatId, visibleHistory, store.state.messagePageByChat.get(store.state.activeChatId));
        const items = store.messages();
        const byId = new Map(items.map((message) => [message.id, message]));
        const visible = messageWindow.range(store.state.activeChatId, items, {
            toEnd: scrollToBottom,
            focusId: focusMessageId || (!scrollToBottom && (preservePosition || !position.bottom) ? position.anchors[0]?.key : null),
            focusAlignment,
        });
        const entries = [];
        const page = store.state.messagePageByChat.get(String(store.state.activeChatId));
        if (visible.hiddenBefore || page?.next_before_sequence) entries.push({
            key: "window:earlier",
            html: historyEdgeMarkup('older'),
        });
        // Computed once per render: the receipt row belongs to the latest sent message.
        const mineMessage = item => item.viewer_is_sender || String(item.sender_user_id) === String(userId());
        const latestOutgoing = items.findLast(item => mineMessage(item) && item.kind !== 'system' && item.delivery_state === 'sent');
        const acceptedOthers = (store.state.detail?.members || []).filter((member) => member.status === "accepted" && String(member.user_id) !== String(userId()));
        const context = { latestOutgoingId: latestOutgoing?.id || null, groupReceipts: acceptedOthers.length > 1 };
        visible.items.forEach((message, visibleIndex) => {
            const index = visible.start + visibleIndex;
            const separator = chatSeparatorBefore(message, items[index - 1]);
            if (separator) entries.push({
                key: `sep:${message.id}`,
                html: `<div class="chat-day-separator" role="presentation" data-list-key="sep:${escapeChatHTML(message.id)}"><time datetime="${escapeChatHTML(separator.at)}"><strong>${escapeChatHTML(separator.day)}</strong> ${escapeChatHTML(separator.time)}</time></div>`,
            });
            entries.push({
                key: message.id,
                html: messageMarkup(message, byId.get(String(message.reply_to_message_id)), items[index - 1], items[index + 1], index, visible.total, context),
            });
        });
        if (visible.hiddenAfter || historyHasNewer) entries.push({
            key: "window:newer",
            html: historyEdgeMarkup('newer'),
        });
        reconcileKeyedElements(timeline, entries, { preserveMedia: "img[data-media-key]" });
        const positions = new Map(visible.items.map((message, offset) => [String(message.id), visible.start + offset + 1]));
        for (const row of timeline.children) {
            const position = positions.get(row.dataset.listKey);
            if (!position) continue;
            if (row.getAttribute("aria-posinset") !== String(position)) row.setAttribute("aria-posinset", String(position));
            if (row.getAttribute("aria-setsize") !== String(visible.total)) row.setAttribute("aria-setsize", String(visible.total));
        }
        $$(".chat-media-text[data-overlay-x]").forEach((overlay) => setRuntimeStyles(overlay, {
            left: `${Number(overlay.dataset.overlayX) * 100}%`,
            top: `${Number(overlay.dataset.overlayY) * 100}%`,
        }));
        if (!items.length && !store.state.loadingRoom && !store.state.dailyRow?.view_gate_locked) timeline.innerHTML = `<div class="chat-room-empty"><strong>Start the conversation</strong><p>Send a message or capture today's Memento.</p></div>`;
        renderReplyDraft();
        timelineScroll.restore(position, { bottom: scrollToBottom || (!preservePosition && !focusMessageId && position.bottom && !visible.hiddenAfter && !historyHasNewer) });
        timelineScroll.observe();
        requestAnimationFrame(recordVisibleHistory);
        scheduleVideoRefreshes();
        scheduleHistorySweep();
    }

    function videoBadgeMarkup(message) {
        const state = videoPlaybackState(message);
        if (state === "processing") return `<span class="chat-video-status" role="status"><span class="chat-video-spinner" aria-hidden="true"></span>Processing…</span>`;
        if (state === "unavailable") return `<span class="chat-video-status unavailable">Open in the app to watch</span>`;
        return `<span class="chat-video-play" aria-hidden="true">${uiIcon("play")}</span>`;
    }

    // A processing video is re-read with backoff until its rendition is ready,
    // then plays like any other. After a few minutes it stops; opening the
    // video asks once more.
    const videoRefreshes = new Map();

    function scheduleVideoRefreshes() {
        const chatId = store.state.activeChatId;
        for (const [key, refresh] of videoRefreshes) {
            if (refresh.chatId !== chatId) {
                clearTimeout(refresh.timer);
                videoRefreshes.delete(key);
            }
        }
        if (!chatId) return;
        for (const message of store.messages(chatId)) {
            if (videoPlaybackState(message) !== "processing" || String(message.id).startsWith("pending:")) continue;
            const key = `${chatId}:${message.id}`;
            if (videoRefreshes.has(key)) continue;
            const refresh = { chatId, messageId: message.id, attempt: 0, startedAt: Date.now(), timer: null };
            videoRefreshes.set(key, refresh);
            queueVideoRefresh(key, refresh);
        }
    }

    function queueVideoRefresh(key, refresh) {
        const delay = videoRefreshDelay(refresh.attempt, Date.now() - refresh.startedAt);
        refresh.timer = delay === null ? null : setTimeout(() => void refreshVideoMessage(key, refresh), delay);
    }

    async function refreshMessageMedia(message) {
        const chatId = store.state.activeChatId;
        const key = `${chatId}:${message.id}`;
        if (!chatId || refreshedMediaMessages.has(key) || String(message.id).startsWith("pending:") || message.view_once) return false;
        refreshedMediaMessages.add(key);
        if (refreshedMediaMessages.size > 200) refreshedMediaMessages.delete(refreshedMediaMessages.values().next().value);
        const latest = await fetchVideoMessage(chatId, message);
        if (!latest || chatId !== store.state.activeChatId) return false;
        store.updateMessage(chatId, { ...message, ...latest });
        renderMessages(false, { preservePosition: true });
        return true;
    }

    async function fetchVideoMessage(chatId, message) {
        try {
            const response = await api.getChatMessages(userId(), chatId, {
                limit: 1,
                afterSequence: Math.max(0, Number(message.room_sequence) - 1),
            });
            return (response.items || []).find((item) => String(item.id) === String(message.id)) || null;
        } catch (_) {
            return null;
        }
    }

    // Returns the updated message once it is no longer processing.
    function applyVideoMessage(chatId, current, latest) {
        if (!latest || videoPlaybackState(latest) === "processing") return null;
        const key = `${chatId}:${current.id}`;
        clearTimeout(videoRefreshes.get(key)?.timer);
        videoRefreshes.delete(key);
        store.updateMessage(chatId, { ...current, ...latest });
        if (store.state.activeChatId === chatId) renderMessages(false, { preservePosition: true });
        return store.messages(chatId).find((item) => item.id === current.id) || null;
    }

    async function refreshVideoMessage(key, refresh) {
        if (videoRefreshes.get(key) !== refresh) return;
        if (store.state.activeChatId !== refresh.chatId) {
            videoRefreshes.delete(key);
            return;
        }
        const current = store.messages(refresh.chatId).find((item) => item.id === refresh.messageId);
        if (!current || videoPlaybackState(current) !== "processing") {
            videoRefreshes.delete(key);
            return;
        }
        const latest = await fetchVideoMessage(refresh.chatId, current);
        if (videoRefreshes.get(key) !== refresh) return;
        if (store.state.activeChatId !== refresh.chatId) {
            videoRefreshes.delete(key);
            return;
        }
        if (applyVideoMessage(refresh.chatId, current, latest)) return;
        refresh.attempt += 1;
        queueVideoRefresh(key, refresh);
    }

    async function openProcessingVideo(message) {
        const chatId = store.state.activeChatId;
        const updated = applyVideoMessage(chatId, message, await fetchVideoMessage(chatId, message));
        if (updated && videoPlaybackState(updated) === "ready") return openPersistentChatMedia(updated.id);
        if (updated) return void showToast?.(VIDEO_UNAVAILABLE_MESSAGE);
        showToast?.(VIDEO_PROCESSING_MESSAGE);
        // A refresh that already gave up starts over now someone is waiting.
        const key = `${chatId}:${message.id}`;
        if (videoRefreshes.has(key) && !videoRefreshes.get(key).timer) videoRefreshes.delete(key);
        scheduleVideoRefreshes();
    }

    function historyEdgeMarkup(direction) {
        const failed = historyError === direction;
        return `<div class="chat-history-edge ${failed ? 'failed' : ''}" role="presentation" data-list-key="window:${direction === 'older' ? 'earlier' : 'newer'}"><span role="status">${historyLoading?.direction === direction ? 'Loading…' : failed ? 'Couldn’t load messages.' : ''}</span><button type="button" data-history-direction="${direction}" ${historyLoading ? 'disabled' : ''}>${failed ? 'Retry' : direction === 'older' ? 'Earlier messages' : 'Newer messages'}</button></div>`;
    }

    function updateLatestButton() {
        requestAnimationFrame(recordVisibleHistory);
        const visible = messageWindow.range(store.state.activeChatId, store.messages());
        $('[data-jump-latest]').classList.toggle('hidden', !store.state.activeChatId || chatAccessUnavailable()
            || (!historyHasNewer && !visible.hiddenAfter && timelineScroll.atBottom()));
        if (!store.state.loadingRoom && !historyHasNewer && !visible.hiddenAfter && timelineScroll.atBottom()) void markRoomRead();
    }

    async function advanceHistory(direction, { retry = false } = {}) {
        if (!store.state.activeChatId || store.state.loadingRoom || chatAccessUnavailable() || historyLoading || (historyError && !retry)) return;
        if (retry) historyError = null;
        const visible = messageWindow.range(store.state.activeChatId, store.messages());
        if (direction === 'older' ? visible.hiddenBefore : visible.hiddenAfter) {
            shiftMessageWindow(direction);
            return;
        }
        await loadHistory(direction);
    }

    function mediaBoxMarkup(message, mediaURL, mementoSwappedURL, mediaOverlay) {
        const kind = ['memento', 'story', 'sticker', 'video'].includes(message.kind) ? message.kind : 'photo';
        const alt = kind === "memento" ? "Memento" : kind === "video" ? "Video thumbnail" : kind === "sticker" ? "Sticker" : "Photo";
        // The preview loads first; the full photo is its fallback when the preview never landed.
        const preview = kind === 'photo' ? safeMediaURL(message.photo_thumbnail_url, api) : '';
        const hash = kind === 'sticker' ? '' : thumbHashDataURL(message.preview_hash);
        const image = mediaImageMarkup(preview && preview !== mediaURL ? [preview, mediaURL] : [mediaURL], {
            alt, className: 'chat-media-image', attributes: `data-message-media="${escapeChatHTML(message.id)}" data-media-key="${escapeChatHTML(message.id)}:${escapeChatHTML(kind)}"`,
        });
        const open = kind === "memento"
            ? `data-view-memento="${escapeChatHTML(mediaURL)}" ${mementoSwappedURL ? `data-memento-swapped="${escapeChatHTML(mementoSwappedURL)}"` : ""} data-memento-owner="${escapeChatHTML(message.sender_first_name || "Memento")}" data-memento-entry="${escapeChatHTML(message.daily_entry_id || "")}"`
            : `data-open-chat-media-message="${escapeChatHTML(message.id)}"`;
        return `<button class="chat-message-media ${kind}" type="button" ${open}>${hash ? `<img class="chat-media-hash" src="${escapeChatHTML(hash)}" alt="" aria-hidden="true" decoding="async">` : ''}${image}${mediaOverlay}${kind === "video" ? videoBadgeMarkup(message) : ""}</button>`;
    }

    function voiceMessageMarkup(message) {
        const audioURL = safeMediaURL(message.audio_url, api);
        if (!audioURL) return `<div class="chat-audio-message unavailable">Voice message unavailable</div>`;
        const seconds = Math.max(1, Math.round(Number(message.audio_duration_ms || 0) / 1000));
        return `<div class="chat-audio-message" data-voice-message="${escapeChatHTML(message.id)}"><button type="button" class="chat-voice-toggle" data-voice-toggle aria-label="Play voice message">${uiIcon('play')}</button><input type="range" min="0" max="100" value="0" step="0.1" data-voice-seek aria-label="Voice message position"><small class="chat-voice-clock" data-voice-clock data-duration="${seconds}">0:00 · −${formatClock(seconds)}</small><button type="button" class="chat-voice-speed" data-voice-speed aria-label="Playback speed 1×">1×</button><audio src="${escapeChatHTML(audioURL)}" preload="metadata" aria-label="Voice message" hidden></audio></div>`;
    }

    function messageMarkup(message, reply, previous, next, index = 0, total = 1, context = {}) {
        // aria-posinset/setsize are set after reconciling (renderMessages): they
        // change for every row on each send and would force every bubble, and
        // its images, to be rebuilt.
        const position = `role="listitem"`;
        if (message.kind === "tombstone" || message.status !== "active") return `<article class="chat-system-message" ${position} data-list-key="${escapeChatHTML(message.id)}"><span>Message removed</span></article>`;
        if (!message.call_id && !KNOWN_MESSAGE_KINDS.has(message.kind)) return `<article class="chat-system-message unsupported" ${position} data-list-key="${escapeChatHTML(message.id)}"><span>Update Valid to see this message</span></article>`;
        if (message.call_id) {
            const call = callHistoryPresentation(message, userId());
            return `<article class="chat-call-history ${call.mine ? 'mine' : ''} ${call.attention ? 'attention' : ''}" ${position} data-list-key="${escapeChatHTML(message.id)}"><div class="chat-call-history-icon">${uiIcon(call.icon)}</div><div><strong>${escapeChatHTML(call.title)}</strong><small>${escapeChatHTML(call.detail)}</small></div><time>${escapeChatHTML(messageTime(message.created_at))}</time></article>`;
        }
        if (message.kind === "system") return `<article class="chat-system-message" ${position} data-list-key="${escapeChatHTML(message.id)}"><span>${escapeChatHTML(message.body || "Chat updated")}</span></article>`;
        const mine = message.viewer_is_sender || String(message.sender_user_id) === String(userId());
        const sharesSequence = (other) => other && other.kind !== "system" && other.status === "active" && String(other.sender_user_id) === String(message.sender_user_id) && Math.abs(new Date(other.created_at) - new Date(message.created_at)) <= 5 * 60 * 1000;
        const startsSequence = !sharesSequence(previous);
        const endsSequence = !sharesSequence(next);
        const replyMarkup = reply ? `<button type="button" class="chat-reply-preview" data-scroll-message="${escapeChatHTML(reply.id)}"><strong>${escapeChatHTML(reply.sender_first_name || "Message")}</strong><span>${escapeChatHTML(reply.kind === "memento" ? "Memento" : reply.kind === "story" ? "Story" : reply.body || "Media")}</span></button>` : "";
        const mediaURL = safeMediaURL(message.kind === "memento" ? message.memento_image_url : message.kind === "story" ? message.story_thumbnail_url || message.story_media_url : message.sticker_image_url || message.photo_image_url || message.video_thumbnail_url, api);
        const mementoSwappedURL = message.kind === "memento" ? safeMediaURL(message.memento_swapped_image_url, api) : null;
        const overlay = message.kind === "story" ? { text: message.story_text_overlay, x: message.story_text_overlay_x, y: message.story_text_overlay_y } : message.media_text_overlay;
        const mediaOverlay = overlay?.text ? `<span class="chat-media-text" data-overlay-x="${Number(overlay.x || 0.5)}" data-overlay-y="${Number(overlay.y || 0.5)}">${escapeChatHTML(overlay.text)}</span>` : "";
        const persistentMedia = mediaURL ? mediaBoxMarkup(message, mediaURL, mementoSwappedURL, mediaOverlay) : "";
        const audioMedia = message.kind === "audio" ? voiceMessageMarkup(message) : "";
        const once = viewOncePresentation(message, { canReplay: viewOnceSessionByMessage.has(message.id), ...viewOnceStates.get(message.id) });
        const marker = once.mine ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 19 9-19 9 4-9Z"/></svg>`
            : once.expired ? uiIcon('clock') : `<span>${once.kind === 'video' ? uiIcon('play') : ''}</span>`;
        const viewOnceMedia = message.view_once ? `<button class="chat-view-once-card ${once.kind} ${once.hollow ? 'opened' : ''} ${once.mine ? 'outgoing' : ''} ${once.label.length > 16 ? 'compact-label' : ''} ${viewOnceStates.get(message.id)?.armed ? 'armed' : ''}" type="button" data-open-view-once="${escapeChatHTML(message.id)}" ${once.replay ? 'data-replay="true"' : ''} ${once.disabled ? 'disabled' : ''} aria-label="${escapeChatHTML(`${once.kind === 'video' ? 'Video' : 'Photo'} · ${once.label}`)}"><i class="chat-media-marker" aria-hidden="true">${marker}</i><strong>${escapeChatHTML(once.label)}</strong></button>` : '';
        const media = audioMedia || (message.view_once ? viewOnceMedia : persistentMedia);
        const body = message.body && message.body !== "Sent a Memento" ? `<p>${linkifyChatText(message.body)}</p>` : "";
        const reactionTypes = Object.entries(message.reaction_summary || {}).filter(([type, count]) => Number(count) > 0 && CHAT_REACTIONS.some(([key]) => key === type))
            .sort(([a, x], [b, y]) => Number(y) - Number(x) || a.localeCompare(b)).slice(0, 3);
        const reactionCount = Number(message.reaction_count || Object.values(message.reaction_summary || {}).reduce((total, count) => total + Number(count || 0), 0));
        const reactions = reactionCount > 0 ? `<span class="chat-reaction-cluster" aria-hidden="true">${reactionTypes.map(([type]) => `<span>${CHAT_REACTIONS.find(([key]) => key === type)[1]}</span>`).join('')}</span> <span class="chat-reaction-count">${reactionCount}</span>` : '';
        const latestOutgoingId = context.latestOutgoingId ?? null;
        const readers = mine && message.delivery_state === "sent" ? readReceiptMembers(message) : [];
        const receipt = readers.length && message.id === latestOutgoingId ? `<button type="button" class="chat-read-receipt" data-view-readers="${escapeChatHTML(message.id)}">${context.groupReceipts ? `Read by ${readers.length}` : "Read"}</button>` : "";
        const viewReceipt = mine && message.view_once ? `<button type="button" class="chat-read-receipt" data-view-once-receipts="${escapeChatHTML(message.id)}">View receipts</button>` : "";
        const mediaOnly = persistentMedia && !body && !replyMarkup && !message.saved_in_chat && ["photo", "video", "sticker"].includes(message.kind) && message.delivery_state === "sent";
        return `<article class="chat-message ${mine ? "mine" : "theirs"} ${mediaOnly ? "media-only" : ""} ${startsSequence ? "starts-sequence" : ""} ${endsSequence ? "ends-sequence" : ""} ${message.delivery_state || ""} ${message.view_once ? "ephemeral" : ""}" ${position} data-list-key="${escapeChatHTML(message.id)}" data-message-id="${escapeChatHTML(message.id)}"><div class="chat-message-meta">${!mine && startsSequence ? `<strong>${escapeChatHTML(message.sender_first_name || "Student")}</strong>` : ""}</div><div class="chat-bubble" data-message-bubble="${escapeChatHTML(message.id)}">${replyMarkup}${media}${message.saved_in_chat ? `<small class="chat-saved-label">Saved by ${escapeChatHTML(message.saved_by?.first_name || "a member")}</small>` : ""}${message.kind === "memento" ? `<small class="memento-label">Memento</small>` : message.kind === "story" ? `<small class="memento-label">${message.story_share_context === "reply" ? "Story reply" : "Shared Story"}</small>` : ""}${body}<time>${escapeChatHTML(message.delivery_state === "sending" ? "Sending…" : message.delivery_state === "failed" ? "Not sent" : messageTime(message.created_at))}</time><button class="chat-message-menu-button" type="button" data-message-menu="${escapeChatHTML(message.id)}" aria-label="Message actions" aria-expanded="false">${uiIcon("more")}</button></div>${message.delivery_state === 'sent' ? `<time class="chat-reveal-time" datetime="${escapeChatHTML(message.created_at || '')}">${escapeChatHTML(messageTime(message.created_at))}</time>` : ''}${message.delivery_state === "failed" ? `<div class="chat-send-failure"><button class="chat-retry" type="button" data-retry-message="${escapeChatHTML(message.client_request_id)}" aria-label="Not sent. Tap to retry">Not sent · Tap to retry</button><button class="chat-discard" type="button" data-discard-message="${escapeChatHTML(message.client_request_id)}" aria-label="Delete unsent message">Delete</button></div>` : ""}${messageActionsMarkup(message, { mine, olderReaders: readers.length && message.id !== latestOutgoingId && !message.view_once })}${reactions ? `<button type="button" class="chat-reaction-summary ${message.current_user_reaction ? 'has-own-reaction' : ''}" data-view-reactions="${escapeChatHTML(message.id)}" aria-label="View reactions">${reactions}</button>` : ""}${viewReceipt || receipt}</article>`;
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
                kind: record.daily_entry_id ? "memento" : "text",
                body: record.body,
                daily_entry_id: record.daily_entry_id || null,
                reply_to_message_id: record.reply_to_message_id,
                status: "active",
                viewer_is_sender: true,
                created_at: new Date(record.created_at).toISOString(),
                delivery_state: "failed",
            })]);
        }
    }

    function scheduleOutboxRetry(records) {
        clearTimeout(outboxRetryTimer);
        outboxRetryTimer = null;
        const next = records
            .filter((record) => Number(record.attempts || 0) < MAX_AUTOMATIC_ATTEMPTS)
            .reduce((earliest, record) => Math.min(earliest, Number(record.next_attempt_at || 0)), Infinity);
        if (!Number.isFinite(next)) return;
        outboxRetryTimer = setTimeout(
            () => void retryPendingMessages(null),
            Math.max(1_000, Math.min(5 * 60_000, next - Date.now())),
        );
    }

    // `chatId` null retries every chat's pending texts (reconnect, back online, visible again).
    async function retryPendingMessages(chatId) {
        if (!userId() || outboxRetrying || navigator.onLine === false || document.hidden) return;
        outboxRetrying = true;
        try {
            const records = await listChatTextOutbox(userId()).catch(() => []);
            const due = records.filter((record) => (!chatId || record.chat_id === String(chatId))
                && !(record.chat_id === store.state.activeChatId && chatAccessUnavailable())
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

    async function deliverMediaRecord(record, { onProgress, onStatus, signal } = {}) {
        if (record.kind === "memento") {
            return deliverMementoRecord(api, userId(), record, { onProgress });
        }
        if (record.kind !== "chat_media") throw new Error("This saved upload is not supported.");
        const { deliverChatMedia } = await import("../media-delivery.js");
        return deliverChatMedia(api, userId(), record, { onProgress, onStatus, signal });
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
                        showToast?.(userMessage(error, "A saved media upload could not be sent."));
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

    function resizeComposer() {
        const textarea = $(".chat-composer textarea");
        if (!textarea.value) { setRuntimeStyles(textarea, { height: null, "overflow-y": null }); return; }
        // Grow with the text up to five lines, then scroll (iOS ChatComposerTextView).
        setRuntimeStyles(textarea, { height: "auto" });
        const style = getComputedStyle(textarea);
        const line = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.25 || 20;
        const chrome = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
        const limit = Math.ceil(line * 5 + chrome);
        setRuntimeStyles(textarea, { height: `${Math.min(textarea.scrollHeight, limit)}px`, "overflow-y": textarea.scrollHeight > limit ? "auto" : "hidden" });
    }

    async function sendMessage(event, retryRequestId = null, { automatic = false } = {}) {
        event?.preventDefault?.();
        if (!retryRequestId && !automatic && chatAccessUnavailable()) return;
        const textarea = $(".chat-composer textarea");
        if (!retryRequestId && !automatic && textarea.value.trim().toLowerCase() === '/play') {
            // Match iOS: a local command never enters the outbox or clears replies/media.
            textarea.value = '';
            textarea.blur();
            stopTyping();
            closeMessageActions();
            if (onPlay) await onPlay();
            else showToast?.('The weekly game is unavailable. Please reopen Valid.');
            return;
        }
        let body, dailyEntryId, replyToMessageId, draftImageURL = null, chatId;
        if (!retryRequestId) {
            // Capture and clear the composer before the first await, so a second
            // tap (or Enter) while the outbox write runs finds nothing to send.
            chatId = store.state.activeChatId;
            body = textarea.value.trim();
            dailyEntryId = sharedMementoDraft?.entryId || null;
            if ((!body && !dailyEntryId) || !chatId) return;
            replyToMessageId = store.state.replyToMessageId;
            draftImageURL = sharedMementoDraft?.imageURL || null;
            textarea.value = "";
            resizeComposer();
            store.state.replyToMessageId = null;
            clearSharedMementoDraft();
            renderReplyDraft();
            stopTyping();
            // iOS keeps the keyboard up after sending.
            textarea.focus({ preventScroll: true });
        } else {
            const pendingRecords = await listChatTextOutbox(userId()).catch(() => []);
            const persisted = pendingRecords.find((record) => record.client_request_id === retryRequestId);
            chatId = persisted?.chat_id || store.state.activeChatId;
            const existing = store.messages(chatId).find((message) => message.client_request_id === retryRequestId);
            body = String(persisted?.body ?? existing?.body ?? "").trim();
            dailyEntryId = persisted?.daily_entry_id || existing?.daily_entry_id || null;
            replyToMessageId = persisted?.reply_to_message_id || existing?.reply_to_message_id || null;
            if ((!body && !dailyEntryId) || !chatId) return;
            if (chatId === store.state.activeChatId && chatAccessUnavailable()) return;
        }
        const clientRequestId = retryRequestId || crypto.randomUUID();
        await putChatTextOutbox({
            userId: userId(), chatId, clientRequestId,
            body, replyToMessageId, dailyEntryId,
        }).catch(() => null);
        const latest = Math.max(0, ...store.messages(chatId).map((message) => message.room_sequence));
        const optimistic = normalizeMessage({
            id: `pending:${clientRequestId}`, client_request_id: clientRequestId,
            chat_id: chatId, room_sequence: latest + 0.5,
            sender_user_id: userId(), sender_first_name: getUser()?.first_name,
            kind: dailyEntryId ? "memento" : "text", body,
            daily_entry_id: dailyEntryId,
            memento_image_url: draftImageURL,
            reply_to_message_id: replyToMessageId,
            status: "active", viewer_is_sender: true, created_at: new Date().toISOString(),
            delivery_state: "sending",
        });
        store.updateMessage(chatId, optimistic);
        if (!automatic) softHaptic?.();
        if (store.state.activeChatId === chatId) renderMessages(!automatic);
        try {
            const message = await api.sendChatMessage(userId(), chatId, {
                ...(body ? { body } : {}),
                ...(dailyEntryId ? { daily_entry_id: dailyEntryId } : {}),
                reply_to_message_id: replyToMessageId,
                client_request_id: clientRequestId,
            });
            await removeChatTextOutbox(userId(), clientRequestId).catch(() => null);
            if (!automatic && historyHasNewer && store.state.activeChatId === chatId) await openChat(chatId, { updateHistory: false, force: true, latest: true });
            store.updateMessage(chatId, { ...message, delivery_state: "sent" });
            if (store.state.activeChatId === chatId) renderMessages(!automatic);
            if (!automatic) successHaptic?.();
            scheduleChatRowRefresh(chatId);
        } catch (error) {
            // A background retry for a room that is Memento-locked right now keeps
            // its text for the person to retry or delete, rather than dropping it.
            const keep = chatTextSendIsRetryable(error) || (automatic && error?.status === 403 && chatId !== store.state.activeChatId);
            if (keep) {
                await markChatTextOutboxAttempt(userId(), clientRequestId).catch(() => null);
            } else {
                await removeChatTextOutbox(userId(), clientRequestId).catch(() => null);
            }
            store.updateMessage(chatId, { ...optimistic, delivery_state: "failed", error_message: userMessage(error, "Not delivered.") });
            if (store.state.activeChatId === chatId) renderMessages(false);
            if (chatTextSendIsRetryable(error)) scheduleOutboxRetry(await listChatTextOutbox(userId()).catch(() => []));
        }
    }

    async function discardFailedMessage(clientRequestId) {
        if (!clientRequestId) return;
        const chatId = store.state.activeChatId;
        await removeChatTextOutbox(userId(), clientRequestId).catch(() => null);
        if (!chatId) return;
        store.replaceMessages(chatId, store.messages(chatId).filter((message) => message.client_request_id !== clientRequestId || !String(message.id).startsWith('pending:')), store.state.messagePageByChat.get(String(chatId)) || {});
        renderMessages(false, { preservePosition: true });
        feedback('medium');
    }

    async function markRoomRead() {
        if (chatAccessUnavailable()) return;
        const latest = Math.max(0, ...store.messages().map((message) => message.room_sequence));
        if (!latest || !store.state.activeChatId || document.visibilityState === "hidden") return;
        const chatId = store.state.activeChatId;
        const sequence = Math.floor(latest);
        if (readWatermark.chatId === chatId && readWatermark.sequence >= sequence) return;
        const token = { chatId, sequence };
        readWatermark = token;
        await api.markChatRead(userId(), chatId, sequence).catch(() => {
            if (readWatermark === token) readWatermark = { chatId: null, sequence: 0 };
        });
    }

    async function loadHistory(direction) {
        const chatId = store.state.activeChatId;
        const page = store.state.messagePageByChat.get(String(chatId)) || {};
        const older = direction === 'older';
        const cursor = older ? page.next_before_sequence : Math.floor(Math.max(0, ...store.messages().map(item => item.room_sequence)));
        if (older ? !cursor : !historyHasNewer) return;
        const token = { direction, generation: roomGeneration, revision: messagesRevision };
        historyLoading = token;
        renderMessages(false, { preservePosition: true });
        try {
            const response = await api.getChatMessages(userId(), chatId, { limit: 50, ...(older ? { beforeSequence: cursor } : { afterSequence: cursor }) });
            if (token.generation !== roomGeneration || chatId !== store.state.activeChatId || token.revision !== messagesRevision) return;
            const items = response.items || [];
            // Never loop on a repeated cursor or a response that makes no progress.
            const progress = items.filter(item => older ? item.room_sequence < cursor : item.room_sequence > cursor);
            if (!progress.length && items.length) throw new Error('History did not advance');
            const before = store.messages();
            const merged = store.mergeMessages(chatId, progress, { prepend: older });
            const evicted = before.some(item => !merged.some(next => next.id === item.id));
            historyHasNewer = older ? historyHasNewer || evicted : progress.length === 50;
            const nextBefore = older ? response.next_before_sequence : evicted ? merged[0]?.room_sequence : page.next_before_sequence;
            if (older && nextBefore && nextBefore >= cursor) {
                historyError = direction;
            }
            store.state.messagePageByChat.set(String(chatId), { ...page, next_before_sequence: older && !progress.length ? null : nextBefore });
            messagesRevision++;
        } catch (error) {
            if (token.generation === roomGeneration && chatId === store.state.activeChatId) {
                historyError = direction;
                if ([401, 403, 404].includes(error.status)) {
                    messagesRevision++;
                    store.replaceMessages(chatId, []);
                    if (dailyLedgerEnabled()) store.state.dailyRow = null;
                }
            }
        } finally {
            if (historyLoading === token) {
                historyLoading = null;
                renderMessages(false, { preservePosition: true });
            }
        }
    }

    async function jumpToLatest() {
        if (historyHasNewer) await openChat(store.state.activeChatId, { updateHistory: false, force: true, latest: true });
        else {
            renderMessages(true);
            await markRoomRead();
        }
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
            $(".chat-create-status").textContent = userMessage(error, "Could not load classmates.");
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
            return `<label class="chat-person-row">${image ? mediaImageMarkup(image, { initials: displayMember(person).slice(0, 1) }) : `<span>${escapeChatHTML(displayMember(person).slice(0, 1))}</span>`}<span><strong>${escapeChatHTML(displayMember(person))}</strong><small>${escapeChatHTML(person.grade || "Classmate")}</small></span><input type="checkbox" value="${escapeChatHTML(id)}" ${selected.has(id) ? "checked" : ""}></label>`;
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
            $(".chat-create-status").textContent = userMessage(error, "Could not create the chat.");
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
        } catch (error) { showToast?.(userMessage(error, "Could not accept the invitation.")); }
    }

    async function declineInvitation(membershipId) {
        const chat = store.state.chats.find((item) => item.membership_id === membershipId);
        if (!await confirmSheet({
            title: "Decline this invitation?",
            message: `You won't join ${chat?.display_name || "this chat"} unless someone invites you again.`,
            confirmLabel: "Decline", destructive: true,
        })) return;
        try {
            await api.declineChatInvitation(userId(), membershipId);
            await loadChats();
        } catch (error) { showToast?.(userMessage(error, "Could not decline the invitation.")); }
    }

    function openMementoComposer({ showExisting = false } = {}) {
        if (mementoSkipping) return;
        const row = store.state.dailyRow;
        if (showExisting || row?.viewer_has_shared || row?.viewer_is_eligible === false) {
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
        $("[data-memento-dialog]").showModal();
        startMementoCamera();
    }

    function renderMementoAudience() {
        const activeChat = store.state.chats.find((chat) => String(chat.id) === String(store.state.activeChatId));
        const destination = activeChat?.display_name || store.state.detail?.display_name || "this chat";
        if (!mementoPublishing) $(".memento-publish").textContent = `Send to ${destination}`;
    }

    async function skipMementoForToday() {
        const chatId = store.state.activeChatId;
        if (mementoSkipping || !chatId || !dailyLedgerEnabled() || store.state.dailyRow?.view_gate_locked !== true) return;
        const generation = roomGeneration;
        mementoSkipping = true;
        $('.chat-room-status').textContent = '';
        renderDailyRow();
        try {
            await api.skipChatMemento(userId(), chatId);
            if (generation !== roomGeneration || chatId !== store.state.activeChatId) return;
            showToast?.("Chat unlocked for today");
            await openChat(chatId, { updateHistory: false, force: true });
        } catch (error) {
            if (generation === roomGeneration && chatId === store.state.activeChatId) $('.chat-room-status').textContent = userMessage(error, "Could not skip today's Memento.");
        } finally {
            mementoSkipping = false;
            if (store.state.activeChatId) renderDailyRow();
        }
    }

    async function selectMemento(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        mementoCamera?.close();
        $('[data-memento-dialog]').classList.remove('is-capturing');
        selectedMementoSourceFile = file;
        selectedMementoSecondarySourceFile = null;
        mementoFrontIsPrimary = false;
        await prepareSelectedMemento(file);
    }

    async function prepareSelectedMemento(file) {
        const generation = ++mementoPreparationGeneration;
        $(".memento-status").textContent = "Preparing photo…";
        $(".memento-publish").disabled = true;
        mementoRequestId = null;
        try {
            const prepared = await prepareMementoImages(file, selectedMementoSecondarySourceFile);
            if (generation !== mementoPreparationGeneration) return;
            selectedMementoFile = mementoFrontIsPrimary && prepared.swapped ? prepared.swapped : prepared.primary;
            selectedMementoSecondaryFile = mementoFrontIsPrimary && prepared.swapped ? prepared.primary : prepared.swapped;
            renderSelectedMementoPreview();
            $(".memento-status").textContent = "";
            $('.memento-photo-fallback').hidden = true;
            $(".memento-publish").disabled = false;
        } catch (error) {
            if (generation !== mementoPreparationGeneration) return;
            selectedMementoFile = null;
            selectedMementoSecondaryFile = null;
            $(".memento-status").textContent = userMessage(error, "Could not prepare that photo.");
        }
    }

    function renderSelectedMementoPreview() {
        if (selectedMementoPreview) URL.revokeObjectURL(selectedMementoPreview);
        selectedMementoPreview = selectedMementoFile ? URL.createObjectURL(selectedMementoFile) : null;
        $(".memento-preview").innerHTML = selectedMementoPreview
            ? `<img src="${escapeChatHTML(selectedMementoPreview)}" alt="Memento preview">${selectedMementoSecondaryFile ? '<button class="memento-preview-swap" type="button" data-swap-memento-capture aria-label="Swap front and back photos"></button>' : ""}`
            : `<span aria-hidden="true">${uiIcon("camera")}</span><p>Capture one real moment from today.</p>`;
    }

    function swapSelectedMementoViews() {
        if (mementoPublishing) return;
        if (!selectedMementoFile || !selectedMementoSecondaryFile) return;
        [selectedMementoFile, selectedMementoSecondaryFile] = [selectedMementoSecondaryFile, selectedMementoFile];
        mementoFrontIsPrimary = !mementoFrontIsPrimary;
        mementoRequestId = null;
        renderSelectedMementoPreview();
        $(".memento-status").textContent = "";
    }

    let mementoPublishing = false;
    async function publishMemento(event) {
        event.preventDefault();
        if (mementoPublishing) return;
        if (!selectedMementoFile || !store.state.activeChatId) {
            $(".memento-status").textContent = "Take a photo before sending your Memento.";
            return;
        }
        mementoPublishing = true;
        const chatIds = [String(store.state.activeChatId)];
        const button = $(".memento-publish");
        button.disabled = true;
        button.textContent = "Sharing…";
        $(".memento-status").textContent = "Saving your Memento…";
        $("[data-memento-dialog]").setAttribute("aria-busy", "true");
        $("[data-retake-memento]").disabled = true;
        $("[data-close-memento]").disabled = true;
        $(".memento-file-input").disabled = true;
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
                caption: null,
                ledger_date: localLedgerDate(),
                request_id: mementoRequestId,
            };
            await putChatMediaOutbox(record);
            recoverySaved = true;
            $(".memento-status").textContent = "Sending your Memento…";
            const result = await deliverMediaRecord(record, { onProgress: (progress) => setRuntimeStyles($(".memento-progress span"), { width: `${Math.round(progress * 100)}%` }) });
            await removeChatMediaOutbox(record.id);
            $("[data-memento-dialog]").close();
            successHaptic?.();
            showToast?.(`Memento shared${result.aura_points_earned ? ` · +${result.aura_points_earned} Aura` : ""}`);
            await openChat(chatIds[0], { updateHistory: false, force: true });
        } catch (error) {
            if (recoverySaved && chatTextSendIsRetryable(error)) {
                await markChatMediaOutboxAttempt(`${userId()}:memento:${mementoRequestId}`).catch(() => null);
                $(".memento-status").textContent = `${userMessage(error, "Could not share your Memento.")} It is saved on this device and will retry while Valid is open.`;
            } else {
                await removeChatMediaOutbox(`${userId()}:memento:${mementoRequestId}`).catch(() => null);
                $(".memento-status").textContent = recoverySaved
                    ? (userMessage(error, "Could not share your Memento."))
                    : "This Memento could not be saved for a safe retry. Free some device storage and try again.";
            }
        } finally {
            mementoPublishing = false;
            $("[data-memento-dialog]").removeAttribute("aria-busy");
            $("[data-retake-memento]").disabled = false;
            $("[data-close-memento]").disabled = false;
            $(".memento-file-input").disabled = false;
            $(".memento-skip").disabled = false;
            $(".memento-progress").classList.add("hidden");
            renderMementoAudience();
            button.disabled = !selectedMementoFile;
        }
    }

    function resetMementoComposer() {
        mementoCameraToken++;
        mementoCamera?.close();
        for (const source of [selectedMementoSourceFile, selectedMementoSecondarySourceFile]) if (source instanceof Blob === false) source?.close?.();
        $(".memento-publish").disabled = true;
        $('[data-memento-dialog]').classList.remove('is-capturing');
        mementoPreparationGeneration += 1;
        selectedMementoFile = null;
        selectedMementoSecondaryFile = null;
        selectedMementoSourceFile = null;
        selectedMementoSecondarySourceFile = null;
        mementoFrontIsPrimary = false;
        mementoRequestId = null;
        if (selectedMementoPreview) URL.revokeObjectURL(selectedMementoPreview);
        selectedMementoPreview = null;
        $(".memento-file-input").value = "";
        $(".memento-file-input").disabled = false;
        $(".memento-photo-fallback").hidden = true;
        $(".memento-skip").disabled = false;
        $(".memento-preview").innerHTML = `${uiIcon('camera')}<p>Capture one real moment from today.</p>`;
        $(".memento-status").textContent = "";
        $(".memento-progress").classList.add("hidden");
        setRuntimeStyles($(".memento-progress span"), { width: "0" });
    }

    function openChatMediaComposer() {
        if (!store.state.activeChatId || chatAccessUnavailable() || chatMediaPublishing) return;
        if (voiceMode) resetChatMediaComposer();
        document.activeElement?.blur();
        $(".chat-media-file-input").accept = ingestEnabled(getConfig()) ? "image/*,video/*" : "image/*,video/mp4";
        $("[data-chat-media-dialog]").showModal();
        void startChatCamera();
        $('[data-chat-camera]').focus({ preventScroll: true });
    }

    function openStickerLibrary({ photo = false } = {}) {
        if (!store.state.activeChatId || chatAccessUnavailable()) return;
        photoStickerMode = photo;
        $('[data-sticker-library-dialog] > section > header strong').textContent = photo ? 'My Stickers' : 'Send a Sticker';
        $('[data-sticker-library-dialog] > section > p').textContent = photo ? 'Choose a sticker to add to this photo.' : 'Tap a sticker to send it.';
        $('.chat-sticker-status').textContent = '';
        $('[data-sticker-library-dialog]').classList.remove('is-editing');
        $('[data-edit-stickers]').textContent = 'Edit';
        $('[data-edit-stickers]').setAttribute('aria-pressed', 'false');
        $('[data-sticker-library-dialog]').showModal();
        void loadStickerLibrary();
        softHaptic?.();
    }

    async function loadStickerLibrary() {
        const generation = ++stickerLibraryGeneration;
        const container = $(".chat-sticker-library div");
        container.innerHTML = `<small>Loading…</small>`;
        try {
            const response = await api.getStickers();
            if (generation !== stickerLibraryGeneration) return;
            const stickers = (response.stickers || []).slice(0, 50);
            container.innerHTML = stickers.map((sticker) => {
                const url = safeMediaURL(sticker.image_url, api);
                return url ? `<span class="chat-sticker-item"><button type="button" data-send-sticker="${escapeChatHTML(sticker.id)}" aria-label="Send saved sticker"><img src="${escapeChatHTML(url)}" alt="" loading="lazy"></button><button type="button" data-delete-sticker="${escapeChatHTML(sticker.id)}" aria-label="Remove saved sticker">Remove</button></span>` : "";
            }).join("") || `<small>No saved stickers yet. Make one from a photo.</small>`;
            container.insertAdjacentHTML('beforeend', `<button class="chat-sticker-new" type="button" data-make-sticker aria-label="Make a sticker"><span>${uiIcon('plus')}</span><small>New</small></button>`);
        } catch (error) {
            if (generation !== stickerLibraryGeneration) return;
            container.innerHTML = `<small>${escapeChatHTML(userMessage(error, "Could not load stickers."))}</small><button type="button" data-retry-stickers>Try again</button>`;
        }
    }

    async function selectStickerSource(event) {
        const input = event.currentTarget;
        const [file] = input.files || [];
        input.value = "";
        if (!file) return;
        $("[data-sticker-library-dialog]").close();
        try {
            await stickerMaker.open(file);
        } catch (error) {
            $("[data-sticker-library-dialog]").showModal();
            $(".chat-sticker-status").textContent = userMessage(error, "That photo could not be opened.");
        }
    }

    async function deleteSticker(stickerId) {
        if (!stickerId || !await confirmSheet({
            title: "Remove from My Stickers?",
            message: "Messages you already sent keep this sticker.",
            confirmLabel: "Remove", destructive: true,
        })) return;
        const item = $("[data-delete-sticker=\"" + CSS.escape(stickerId) + "\"]")?.closest(".chat-sticker-item");
        item?.querySelectorAll("button").forEach((button) => { button.disabled = true; });
        try {
            await api.deleteSticker(stickerId);
            await loadStickerLibrary();
            showToast?.("Sticker removed");
        } catch (error) {
            item?.querySelectorAll("button").forEach((button) => { button.disabled = false; });
            $(".chat-sticker-status").textContent = userMessage(error, "Could not remove that sticker.");
        }
    }

    async function sendSticker(stickerId) {
        if (!stickerId || !store.state.activeChatId || stickerSending || chatAccessUnavailable()) return;
        stickerSending = true;
        const chatId = store.state.activeChatId;
        const requestKey = `${chatId}:${stickerId}`;
        const clientRequestId = stickerRequestById.get(requestKey) || crypto.randomUUID();
        if (stickerRequestById.size >= 50 && !stickerRequestById.has(requestKey)) {
            stickerSending = false;
            $('.chat-sticker-status').textContent = 'Too many pending sticker sends. Retry an existing one first.';
            return;
        }
        stickerRequestById.set(requestKey, clientRequestId);
        $$("[data-send-sticker]").forEach((button) => { button.disabled = true; });
        try {
            const message = await api.sendChatMessage(userId(), chatId, {
                sticker_id: stickerId,
                reply_to_message_id: store.state.replyToMessageId || null,
                client_request_id: clientRequestId,
            });
            stickerRequestById.delete(requestKey);
            store.updateMessage(chatId, message);
            if (chatId === store.state.activeChatId) {
                store.state.replyToMessageId = null;
                $("[data-sticker-library-dialog]").close();
                renderMessages(true);
            }
            successHaptic?.();
            scheduleChatRowRefresh(chatId);
        } catch (error) {
            if (chatId !== store.state.activeChatId) {
                showToast?.('Sticker not confirmed. Reopen that chat and tap the same sticker to retry.');
                return;
            }
            if (!$("[data-sticker-library-dialog]").open) $("[data-sticker-library-dialog]").showModal();
            await loadStickerLibrary();
            $$("[data-send-sticker]").forEach((button) => { button.disabled = false; });
            $(".chat-sticker-status").textContent = `${userMessage(error, "Could not send that sticker.")} Tap the same sticker to retry safely.`;
        } finally {
            stickerSending = false;
        }
    }

    function resetChatMediaRequestIds() {
        chatMediaUploadRequestId = null;
        chatMediaSendRequestId = null;
    }

    // An edit changes the pixels: encode again (with new request ids) on send.
    function chatMediaEdited() {
        resetChatMediaRequestIds();
        chatMediaEncoded = null;
    }

    async function prepareSelectedChatMedia(file, { durationMsHint = null, poster = null, prepared: preparedMedia = null } = {}) {
        if (!file || chatMediaPublishing) return;
        showChatMediaReview();
        const isPhotoSource = !(file instanceof Blob) || file.type.startsWith("image/") || /\.hei[cf]$/i.test(file.name || "");
        photoStickers.reset();
        releaseSelectedChatMedia();
        selectedChatMediaSourceFile = null;
        const generation = ++chatMediaPreparationGeneration;
        $(".chat-media-status").textContent = "Preparing media…";
        $(".chat-media-publish").disabled = true;
        $(".chat-media-send-count").hidden = true;
        resetChatMediaRequestIds();
        try {
            let prepared;
            if (isPhotoSource) {
                const [pipeline, editor] = await Promise.all([photoPipeline(), ensureReviewEditor()]);
                const decoded = await pipeline.decodePhoto(file);
                const profile = pipeline.chatPhotoProfile(getConfig());
                try {
                    prepared = { kind: "photo", canvas: pipeline.renderPhoto(decoded.image, { maxDimension: profile.maxDimension }), profile, file: null, thumbnail: null, durationMs: null };
                } finally {
                    decoded.release();
                    if (!(file instanceof Blob)) file.close?.();
                }
                if (generation !== chatMediaPreparationGeneration) { prepared.canvas.width = prepared.canvas.height = 0; return; }
                selectedChatMedia = prepared;
                selectedChatMediaSourceFile = file instanceof Blob ? file : null;
                await editor.loadPhoto(prepared.canvas);
            } else {
                prepared = preparedMedia || await prepareChatMedia(file, { durationMsHint, poster, config: getConfig() });
                const editor = prepared.kind === "video" ? await ensureReviewEditor() : null;
                if (generation !== chatMediaPreparationGeneration) return;
                selectedChatMedia = prepared;
                selectedChatMediaPreview = URL.createObjectURL(selectedChatMedia.file);
                if (editor) editor.loadVideo(selectedChatMediaPreview, { durationMs: prepared.durationMs });
                else $(".chat-media-preview").innerHTML = `<audio src="${escapeChatHTML(selectedChatMediaPreview)}" controls aria-label="Voice message preview"></audio>`;
            }
            if (generation !== chatMediaPreparationGeneration) return;
            const isAudio = selectedChatMedia.kind === "audio";
            $("[data-chat-view-once]").checked = false;
            $("[data-chat-view-once]").disabled = isAudio;
            $("[data-review-tools]").hidden = isAudio;
            photoStickers.mount();
            $(".chat-media-status").textContent = '';
            $('.chat-media-option span').textContent = 'Keep in chat';
            $$('[data-photo-cutout], [data-photo-stickers]').forEach(button => { button.hidden = selectedChatMedia.kind !== 'photo'; });
            const clips = selectedChatMedia.ingest && selectedChatMedia.kind === "video" ? ingestSegmentCount(selectedChatMedia.durationMs) : 1;
            $(".chat-media-send-count").textContent = `Sends as ${clips} videos`;
            $(".chat-media-send-count").hidden = clips < 2;
            $(".chat-media-publish").disabled = false;
            syncVoiceComposer();
        } catch (error) {
            if (generation !== chatMediaPreparationGeneration) return;
            selectedChatMedia = null;
            // Photo editing is loaded on first use; offline, that load can fail.
            $(".chat-media-status").textContent = /dynamically imported module|module script failed/i.test(error?.message || "")
                ? "Photo editing needs a connection to load. Reconnect and try again."
                : userMessage(error, "Could not prepare that media.");
        }
    }

    // Frees the decoded photo and any preview URL of the current selection.
    function releaseSelectedChatMedia() {
        reviewEditor?.reset();
        if (selectedChatMedia?.canvas) selectedChatMedia.canvas.width = selectedChatMedia.canvas.height = 0;
        selectedChatMedia = null;
        chatMediaEncoded = null;
        if (selectedChatMediaPreview) URL.revokeObjectURL(selectedChatMediaPreview);
        selectedChatMediaPreview = null;
    }

    // Sticker cut-outs need a file; camera captures only exist as pixels.
    async function selectedPhotoSourceFile() {
        if (selectedChatMediaSourceFile) return selectedChatMediaSourceFile;
        if (!selectedChatMedia?.canvas) return null;
        const pipeline = await photoPipeline();
        const blob = await pipeline.canvasBlob(selectedChatMedia.canvas, 0.92);
        selectedChatMediaSourceFile = new File([blob], "chat-photo.jpg", { type: "image/jpeg", lastModified: Date.now() });
        return selectedChatMediaSourceFile;
    }

    async function selectChatMedia(event) {
        const file = event.target.files?.[0];
        // The library is for photos and videos; voice notes are recorded here.
        if (file && (/^audio\//.test(file.type) || /\.(m4a|mp3|wav|aac|ogg|opus)$/i.test(file.name || ""))) {
            event.target.value = "";
            showChatMediaReview();
            $(".chat-media-status").textContent = "Choose a photo or video.";
            return;
        }
        await prepareSelectedChatMedia(file);
    }

    function voiceRecordingElapsed() {
        return Math.max(1, Math.min(MAX_VOICE_RECORDING_MS, Date.now() - voiceRecordingStartedAt));
    }

    function updateVoiceRecordingButton() {
        const elapsedSeconds = Math.floor(voiceRecordingElapsed() / 1000);
        $("[data-record-voice]").textContent = '■';
        $("[data-record-voice]").setAttribute('aria-label', 'Stop recording and preview');
        $('.chat-voice-status').textContent = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
        syncVoiceComposer();
    }

    function clearVoiceRecordingState() {
        voiceWaveform.stop();
        $('.chat-voice-hint').textContent = '';
        clearInterval(voiceRecordingTimer);
        voiceRecordingTimer = null;
        voiceRecordingStartedAt = 0;
        voiceRecorder = null;
        const button = $("[data-record-voice]");
        button.innerHTML = uiIcon('mic');
        button.setAttribute('aria-label', 'Record voice message');
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
        if (chatMediaPublishing || chatAccessUnavailable()) return;
        if (calls.isActive()) return showToast?.('End your call before recording a voice message.');
        if (voiceRecorder) {
            stopVoiceRecorder();
            return;
        }
        const format = voiceRecordingFormat(ingestEnabled(getConfig()));
        if (!format) return syncVoiceComposer(); // no recording path: the mic hides
        resetChatMediaComposer({ keepGesture: true }); voiceMode = true; syncVoiceComposer();
        const { mimeType } = format;
        // M4A uses the direct 4 MB path; Opus goes through the ingest (10 MB).
        const maxBytes = format.ingest ? 10 * 1024 * 1024 : 4 * 1024 * 1024;
        const button = $("[data-record-voice]");
        button.disabled = true;
        const recordingGeneration = chatMediaPreparationGeneration;
        const recordingChat = store.state.activeChatId;
        $(".chat-media-status").textContent = "Requesting microphone access…";
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (!voiceMode || document.hidden || recordingGeneration !== chatMediaPreparationGeneration || recordingChat !== store.state.activeChatId) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }
            const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 });
            const chunks = []; let recordedBytes = 0;
            voiceRecorder = recorder;
            voiceWaveform.start(stream);
            discardVoiceRecording = false;
            recorder.addEventListener("dataavailable", (event) => {
                if (!event.data?.size) return;
                recordedBytes += event.data.size;
                if (recordedBytes > maxBytes || chunks.length >= 600) {
                    $('.chat-media-status').textContent = 'Recording limit reached. Record a shorter message.';
                    stopVoiceRecorder({ discard: true }); return;
                }
                chunks.push(event.data);
            });
            recorder.addEventListener("error", () => {
                $(".chat-media-status").textContent = "Voice recording stopped unexpectedly. Try again.";
                recorder.stream.getTracks().forEach((track) => track.stop());
                clearVoiceRecordingState();
            }, { once: true });
            recorder.addEventListener("stop", async () => {
                if (recordingGeneration !== chatMediaPreparationGeneration || recordingChat !== store.state.activeChatId || voiceRecorder !== recorder) {
                    recorder.stream.getTracks().forEach((track) => track.stop());
                    if (voiceRecorder === recorder) clearVoiceRecordingState();
                    return;
                }
                const durationMs = voiceRecordingElapsed();
                const discarded = discardVoiceRecording;
                recorder.stream.getTracks().forEach((track) => track.stop());
                clearVoiceRecordingState();
                if (discarded || !chunks.length) return;
                if (format.ingest) {
                    const type = (recorder.mimeType || mimeType).split(";")[0] || "audio/webm";
                    const extension = type === "audio/ogg" ? "ogg" : type === "audio/mp4" ? "m4a" : "webm";
                    const file = new File(chunks, `voice.${extension}`, { type: recorder.mimeType || mimeType, lastModified: Date.now() });
                    await prepareSelectedChatMedia(file, { prepared: { kind: "audio", file, thumbnail: null, durationMs, ingest: true } });
                    return;
                }
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
            $(".chat-media-status").textContent = '';
        } catch (error) {
            clearVoiceRecordingState();
            $(".chat-media-status").textContent = error?.name === "NotAllowedError"
                ? "Microphone access was not allowed. Allow it in your browser settings, then try again."
                : userMessage(error, "Could not start voice recording. Try again.");
        }
    }

    async function publishChatMedia(event) {
        event.preventDefault();
        if (!selectedChatMedia || !store.state.activeChatId || chatMediaPublishing || chatAccessUnavailable()) return;
        chatMediaPublishing = true;
        const chatId = store.state.activeChatId;
        const mediaKind = selectedChatMedia.kind;
        const button = $(".chat-media-publish");
        const viewOnce = selectedChatMedia.kind !== "audio" && $("[data-chat-view-once]").checked;
        const textOverlay = selectedChatMedia.kind === "audio" ? null : reviewEditor?.textOverlay() || null;
        chatMediaUploadRequestId ||= crypto.randomUUID();
        chatMediaSendRequestId ||= crypto.randomUUID();
        const uploadRequestId = chatMediaUploadRequestId, sendRequestId = chatMediaSendRequestId;
        const media = selectedChatMedia, preparationGeneration = chatMediaPreparationGeneration;
        const senderId = userId(), replyId = store.state.replyToMessageId || null;
        const recordId = `${senderId}:chat-media:${uploadRequestId}`;
        button.disabled = true;
        button.textContent = "Sending…";
        root.querySelectorAll('[data-retake-chat-photo], [data-chat-photo-library], [data-record-voice]').forEach(control => { control.disabled = true; });
        $(".chat-media-file-input").disabled = true;
        $("[data-chat-view-once]").disabled = true;
        $(".chat-media-progress").classList.remove("hidden");
        $(".chat-media-status").textContent = media.kind === "photo" ? "Preparing photo…" : "Starting secure upload…";
        const abort = chatMediaAbort = new AbortController();
        $("[data-cancel-chat-upload]").hidden = false;
        let recoverySaved = false;
        try {
            let uploadFile = media.file;
            let thumbnail = media.thumbnail || null;
            let previewHash = null;
            if (media.kind === "photo") {
                // Edits, stickers and the filter are burned in and the JPEG is
                // encoded exactly once; a retry reuses the same bytes.
                if (!chatMediaEncoded) {
                    const pipeline = await photoPipeline();
                    const composed = reviewEditor.compose({ drawExtras: (context, width, height) => photoStickers.draw(context, width, height) });
                    try { chatMediaEncoded = await pipeline.encodeChatPhoto(composed, media.profile); }
                    finally { composed.width = composed.height = 0; }
                }
                ({ file: uploadFile, preview: thumbnail, previewHash } = chatMediaEncoded);
                $(".chat-media-status").textContent = "Starting secure upload…";
            }
            if (preparationGeneration !== chatMediaPreparationGeneration || senderId !== userId()) throw new Error('Media selection changed. Try again.');
            if (abort.signal.aborted) throw Object.assign(new Error("The media upload was cancelled."), { cancelled: true });
            const record = {
                id: recordId,
                user_id: senderId,
                kind: "chat_media",
                file: uploadFile,
                thumbnail,
                preview_hash: previewHash,
                chat_id: chatId,
                content_type: media.ingest ? (media.contentType || uploadFile.type) : uploadFile.type,
                ingest: Boolean(media.ingest),
                duration_ms: media.durationMs,
                view_once: viewOnce,
                overlay: textOverlay,
                reply_to_message_id: replyId,
                upload_request_id: uploadRequestId,
                send_request_id: sendRequestId,
            };
            await putChatMediaOutbox(record);
            recoverySaved = true;
            const result = await deliverMediaRecord(record, {
                signal: abort.signal,
                onStatus: (text) => { $(".chat-media-status").textContent = text; },
                onProgress: (progress) => { setRuntimeStyles($(".chat-media-progress span"), { width: `${Math.round(progress * 100)}%` }); },
            });
            await removeChatMediaOutbox(record.id);
            setRuntimeStyles($(".chat-media-progress span"), { width: "100%" });
            const sent = [].concat(result || []);
            for (const message of sent) store.updateMessage(chatId, message);
            store.state.replyToMessageId = null;
            $("[data-chat-media-dialog]").close();
            if (voiceMode) resetChatMediaComposer();
            renderMessages(true);
            successHaptic?.();
            showToast?.(`${sent.length > 1 ? `${sent.length} videos` : mediaKind === "audio" ? "Voice message" : mediaKind === "video" ? "Video" : "Photo"} sent${viewOnce ? " · view once" : ""}`);
            scheduleChatRowRefresh(chatId);
        } catch (error) {
            if (error?.cancelled || abort.signal.aborted) {
                await removeChatMediaOutbox(recordId).catch(() => null);
                $(".chat-media-status").textContent = "Upload cancelled. Your selection is still here.";
            } else if (recoverySaved && chatTextSendIsRetryable(error)) {
                await markChatMediaOutboxAttempt(recordId).catch(() => null);
                $(".chat-media-status").textContent = `${userMessage(error, "Could not send that media.")} It is saved on this device and will retry while Valid is open.`;
            } else {
                await removeChatMediaOutbox(recordId).catch(() => null);
                $(".chat-media-status").textContent = recoverySaved
                    ? `${userMessage(error, "Could not send that media.")} Your selection is still here to retry.`
                    : "This media could not be saved for a safe retry. Free some device storage and try again.";
            }
        } finally {
            chatMediaPublishing = false;
            if (chatMediaAbort === abort) chatMediaAbort = null;
            $("[data-cancel-chat-upload]").hidden = true;
            root.querySelectorAll('[data-retake-chat-photo], [data-chat-photo-library], [data-record-voice]').forEach(control => { control.disabled = false; });
            button.innerHTML = uiIcon('send');
            button.disabled = !selectedChatMedia;
        }
    }

    function resetChatMediaComposer({ keepGesture = false } = {}) {
        if (!keepGesture) voiceGesture.reset();
        voiceWaveform.reset();
        voiceMode = false;
        photoStickerMode = false;
        photoStickers.reset();
        chatCameraToken++;
        chatCamera?.close();
        chatMediaAbort?.abort();
        $('[data-chat-media-dialog]').classList.remove('is-capturing');
        chatMediaPreparationGeneration += 1;
        stopVoiceRecorder({ discard: true });
        if (!voiceRecorder) clearVoiceRecordingState();
        releaseSelectedChatMedia();
        selectedChatMediaSourceFile = null;
        resetChatMediaRequestIds();
        $(".chat-media-file-input").value = "";
        $(".chat-media-file-input").disabled = false;
        $("[data-chat-view-once]").checked = false;
        $("[data-chat-view-once]").disabled = false;
        $("[data-review-tools]").hidden = true;
        $(".chat-media-send-count").hidden = true;
        $(".chat-media-preview").innerHTML = `<span aria-hidden="true">${uiIcon("plus")}</span><p>Choose a photo or video.</p>`;
        $(".chat-media-status").textContent = "";
        $(".chat-media-progress").classList.add("hidden");
        setRuntimeStyles($(".chat-media-progress span"), { width: "0" });
        $(".chat-media-publish").disabled = true;
        syncVoiceComposer();
    }

    async function loadMementoDay(offset) {
        const row = store.state.displayedDailyRow || store.state.dailyRow;
        if (!row || !store.state.activeChatId) return;
        const date = new Date(`${row.ledger_date}T12:00:00`);
        date.setDate(date.getDate() + Number(offset));
        const target = localLedgerDate(date);
        return loadMementoDate(target);
    }

    async function loadMementoDate(target) {
        const earliest = new Date();
        earliest.setDate(earliest.getDate() - 6);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(target || '') || target > localLedgerDate() || target < localLedgerDate(earliest) || !store.state.activeChatId || !$('[data-memento-gallery-dialog]').open) return;
        const generation = ++mementoDateGeneration;
        const chatId = store.state.activeChatId;
        $('.chat-memento-gallery-status').textContent = '';
        const cached = store.state.dailyRowsByDate.get(target);
        if (cached) {
            store.state.displayedDailyRow = cached;
            renderDailyRow();
            return;
        }
        try {
            $('.chat-memento-gallery-status').textContent = 'Loading Mementos…';
            const row = await api.getChatDailyRow(userId(), chatId, target);
            if (generation !== mementoDateGeneration || chatId !== store.state.activeChatId) return;
            store.state.displayedDailyRow = row;
            rememberDailyRow(row);
            $('.chat-memento-gallery-status').textContent = '';
            renderDailyRow();
        } catch (error) {
            if (generation === mementoDateGeneration) $('.chat-memento-gallery-status').textContent = userMessage(error, 'Could not load that Memento day.');
        }
    }

    const viewerImage = () => $("[data-chat-media-viewer] img:not(.chat-viewer-placeholder)");

    function ensureViewerGestures() {
        if (viewerGestures) return viewerGestures;
        viewerGestures = import("./viewer-gestures.js").then(({ bindViewerGestures }) => bindViewerGestures({
            dialog: mediaViewer,
            stage: $(".chat-viewer-stage"),
            target: () => $(".chat-viewer-media"),
            onDismiss: () => { softHaptic?.(); closeMediaViewer(); },
            // View-once media keeps hold-to-pause and tap-to-advance; it does not zoom.
            canZoom: () => !ephemeralTimer && $("[data-chat-media-viewer] video").hidden,
            canDismiss: () => true,
            onDismissStart: () => setEphemeralPaused(true),
        })).catch(() => null);
        return viewerGestures;
    }

    // Never show a black frame: the thumbnail/ThumbHash (or video poster) stays
    // under the media until it has decoded something to draw.
    async function showMediaViewer(url, { kind = "photo", label = "Media", overlay = null, poster = null, placeholder = null } = {}) {
        if (!url) throw new Error("That media is no longer available.");
        const dialog = $("[data-chat-media-viewer]");
        const image = viewerImage();
        const video = dialog.querySelector("video");
        const still = dialog.querySelector(".chat-viewer-placeholder");
        const target = kind === "video" ? video : image;
        image.hidden = kind === "video";
        video.hidden = kind !== "video";
        image.removeAttribute("src");
        video.removeAttribute("src");
        video.removeAttribute("poster");
        const preview = kind === "video" ? poster : placeholder;
        still.hidden = !preview;
        if (preview) still.src = preview;
        else still.removeAttribute("src");
        if (kind === "video" && poster) video.poster = poster;
        // Kept videos loop like iOS (ChatMediaPlayback AVPlayerLooper); view once plays once.
        video.loop = kind === "video";
        dialog.classList.add("is-loading");
        const settle = () => { if (target.getAttribute("src") === url) { dialog.classList.remove("is-loading"); still.hidden = true; } };
        if (kind === "video") video.addEventListener("loadeddata", settle, { once: true });
        else image.addEventListener("load", settle, { once: true });
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
        if (!dialog.open) dialog.showModal();
        void ensureViewerGestures().then((gestures) => gestures?.reset());
        await Promise.race([
            kind === "video" ? new Promise((resolve, reject) => {
                video.addEventListener("loadedmetadata", resolve, { once: true });
                video.addEventListener("error", () => reject(Object.assign(new Error("That video could not be opened."), { mediaFailed: true })), { once: true });
            }) : image.decode().catch(() => { throw Object.assign(new Error("That photo could not be opened."), { mediaFailed: true }); }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("That media took too long to open.")), 10_000)),
        ]);
        if (kind === "photo") settle();
    }

    function viewMemento(url, owner, entryId = null, swappedURL = null) {
        viewedMementoEntryId = entryId ? String(entryId) : null;
        viewedMementoOwner = owner || "Student";
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
        void showMediaViewer(url, { label: `${owner || "Memento"} · preserved in this chat` }).catch((error) => showToast?.(userMessage(error, "That Memento could not be opened.")));
    }

    async function swapViewedMemento() {
        if (!viewedMementoPrimaryURL || !viewedMementoSwappedURL) return;
        const image = viewerImage();
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
            showToast?.(userMessage(error, "That Memento view could not be opened."));
        } finally {
            button.disabled = false;
        }
    }

    function closeMediaViewer() {
        mediaOpenGeneration++;
        for (const [id, state] of viewOnceStates) if (state.loading) viewOnceStates.delete(id);
        const dialog = $("[data-chat-media-viewer]");
        dialog.close();
        resetMediaViewerContents();
    }

    function resetMediaViewerContents() {
        clearInterval(ephemeralTimer); ephemeralTimer = null; ephemeralPaused = false;
        $('[data-pause-ephemeral]').hidden = true;
        $('.chat-ephemeral-progress').hidden = true;
        $('.chat-capture-note').hidden = true;
        const dialog = $("[data-chat-media-viewer]");
        const video = dialog.querySelector("video");
        video.pause();
        video.controls = true;
        video.loop = false;
        video.onended = null;
        video.removeAttribute("src");
        video.removeAttribute("poster");
        video.load();
        const image = viewerImage();
        image.removeAttribute("src");
        image.alt = "";
        const still = dialog.querySelector(".chat-viewer-placeholder");
        still.hidden = true;
        still.removeAttribute("src");
        dialog.classList.remove("is-loading");
        void viewerGestures?.then((gestures) => gestures?.reset());
        video.removeAttribute("aria-label");
        dialog.querySelector(".chat-viewer-overlay").textContent = "";
        viewedMessageId = null;
        viewedMementoEntryId = null;
        viewedMementoOwner = null;
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
        $('[data-memento-gallery-dialog]').close();
        renderReplyDraft();
        $(".chat-composer textarea").focus({ preventScroll: true });
    }

    async function reactToViewedMedia() {
        if (!viewedMessageId) return;
        const messageId = viewedMessageId;
        closeMediaViewer();
        $('[data-memento-gallery-dialog]').close();
        await reactToMessage(messageId, "love");
    }

    function shareViewedMemento() {
        if (!viewedMementoEntryId || !store.state.activeChatId) return;
        sharedMementoDraft = {
            entryId: viewedMementoEntryId,
            imageURL: viewedMementoPrimaryURL,
            owner: viewedMementoOwner || "Student",
        };
        closeMediaViewer();
        renderSharedMementoDraft();
        $('[data-memento-gallery-dialog]').close();
        $(".chat-composer textarea").focus({ preventScroll: true });
        showToast?.("Memento added to message");
    }

    function openPersistentChatMedia(messageId, { retried = false } = {}) {
        const message = store.messages().find((item) => item.id === messageId);
        if (!message || message.view_once) return;
        const videoState = videoPlaybackState(message);
        if (videoState === "processing") return void openProcessingVideo(message);
        if (videoState === "unavailable") return void showToast?.(VIDEO_UNAVAILABLE_MESSAGE);
        const isStory = message.kind === "story";
        const kind = isStory ? message.story_media_type : message.kind === "video" ? "video" : "photo";
        const url = safeMediaURL(isStory ? (message.story_is_available === false ? null : message.story_media_url) : kind === "video" ? message.video_url : message.sticker_image_url || message.photo_image_url, api);
        const overlay = isStory ? { text: message.story_text_overlay, x: message.story_text_overlay_x, y: message.story_text_overlay_y } : message.media_text_overlay;
        const poster = safeMediaURL(isStory ? message.story_thumbnail_url : message.video_thumbnail_url, api) || null;
        const placeholder = safeMediaURL(message.photo_thumbnail_url, api) || thumbHashDataURL(message.preview_hash) || null;
        void showMediaViewer(url, { kind, label: isStory ? `${message.story_owner_first_name || "Student"} · Story` : `${message.sender_first_name || "Student"} · ${kind}`, overlay, poster, placeholder })
            .catch(async (error) => {
                // Signed media URLs expire after ~15 minutes: fetch fresh ones and retry once.
                if (error.mediaFailed && !retried && await refreshMessageMedia(message)) return openPersistentChatMedia(messageId, { retried: true });
                showToast?.(userMessage(error, "That media could not be opened."));
            });
    }

    async function openViewOnceMessage(messageId, { accessible = false } = {}) {
        const message = store.messages().find(item => item.id === messageId);
        if (!message) return;
        const state = viewOnceStates.get(messageId) || {};
        const once = viewOncePresentation(message, { canReplay: viewOnceSessionByMessage.has(messageId), ...state });
        if (once.disabled || (once.replay && !state.armed && !accessible)) return;
        if (replaySuppressClick && !accessible) { replaySuppressClick = false; return; }
        const chatId = store.state.activeChatId, uid = userId(), generation = ++mediaOpenGeneration;
        const current = () => generation === mediaOpenGeneration && chatId === store.state.activeChatId && uid === userId();
        viewOnceStates.set(messageId, { loading: true }); renderMessages(false);
        try {
            const replayOfSessionId = viewOnceSessionByMessage.get(messageId);
            const clientRequestId = viewOnceRequestByMessage.get(messageId) || crypto.randomUUID();
            viewOnceRequestByMessage.set(messageId, clientRequestId);
            const session = await api.beginChatMediaViewSession(uid, chatId, {
                messageId: replayOfSessionId ? null : messageId, replayOfSessionId, clientRequestId,
            });
            if (!current()) return;
            const revealed = session.message;
            const kind = revealed.kind === 'video' ? 'video' : 'photo';
            // A video with no playable file yet: leave the session unstarted,
            // so no view is used up, and let the viewer try again.
            const videoState = videoPlaybackState(revealed);
            if (videoState === 'processing' || videoState === 'unavailable') {
                viewOnceStates.delete(messageId); renderMessages(false);
                showToast?.(videoState === 'processing' ? VIDEO_PROCESSING_MESSAGE : VIDEO_UNAVAILABLE_MESSAGE);
                return;
            }
            viewedMessageId = messageId;
            const url = safeMediaURL(kind === 'video' ? revealed.video_url : revealed.photo_image_url, api);
            await showMediaViewer(url, {
                kind, label: kind === 'video' ? 'Video · View once' : 'Photo · View once', overlay: revealed.media_text_overlay,
                poster: safeMediaURL(revealed.video_thumbnail_url, api) || null,
                placeholder: safeMediaURL(revealed.photo_thumbnail_url, api) || thumbHashDataURL(revealed.preview_hash) || null,
            });
            if (!current() || !$('[data-chat-media-viewer]').open) return;
            if (kind === 'video') {
                const video = $('[data-chat-media-viewer] video');
                video.controls = false;
                await video.play();
                if (!current()) return;
            }
            await api.startChatMediaViewSession(uid, chatId, session.session_id);
            if (!current()) return;
            viewOnceRequestByMessage.delete(messageId);
            viewOnceSessionByMessage.set(messageId, session.session_id);
            const remaining = Math.max(0, Number(revealed.view_once_remaining_views ?? message.view_once_remaining_views ?? 2) - 1);
            // Keep no revealed media URLs in the message store.
            store.updateMessage(chatId, { ...message, view_once_remaining_views: remaining, view_once_available: true, view_once_consumed: remaining === 0 });
            viewOnceStates.delete(messageId);
            beginEphemeralPlayback(kind);
            renderMessages(false);
            scheduleChatRowRefresh(chatId);
        } catch (error) {
            if (!current()) return;
            closeMediaViewer();
            viewOnceStates.set(messageId, { failed: true }); renderMessages(false);
            showToast?.(userMessage(error, 'That view-once media is no longer available.'));
        }
    }

    function setEphemeralPaused(paused) {
        if (!ephemeralTimer) return;
        ephemeralPaused = paused;
        const button = $('[data-pause-ephemeral]');
        button.setAttribute('aria-label', paused ? 'Resume media' : 'Pause media');
        button.innerHTML = uiIcon(paused ? 'play' : 'pause');
        const video = $('[data-chat-media-viewer] video');
        if (!video.hidden) { if (paused) video.pause(); else void video.play().catch(() => setEphemeralPaused(true)); }
    }

    function beginEphemeralPlayback(kind) {
        clearInterval(ephemeralTimer); ephemeralPaused = false;
        const progress = $('.chat-ephemeral-progress'), video = $('[data-chat-media-viewer] video');
        progress.hidden = false; progress.value = 0;
        // iOS logs view-once screenshots in the chat; a browser can't see them.
        $('.chat-capture-note').hidden = false;
        $('[data-pause-ephemeral]').hidden = false;
        $('[data-pause-ephemeral]').setAttribute('aria-label', 'Pause media');
        $('[data-pause-ephemeral]').innerHTML = uiIcon('pause');
        video.loop = false;
        video.onended = kind === 'video' ? closeMediaViewer : null;
        if (kind === 'video' && video.ended) { closeMediaViewer(); return; }
        let elapsed = 0, previous = performance.now();
        ephemeralTimer = setInterval(() => {
            const now = performance.now();
            if (!ephemeralPaused) elapsed += now - previous;
            previous = now;
            progress.value = kind === 'video' ? (video.duration > 0 ? video.currentTime / video.duration : 0) : elapsed / 5000;
            if (kind === 'photo' && elapsed >= 5000) closeMediaViewer();
        }, 50);
    }

    async function showViewOnceReceipts(messageId) {
        const dialog = $("[data-chat-readers-dialog]");
        $(".chat-readers-content").innerHTML = `<header><button type="button" data-close-readers>Done</button><strong>Opened by</strong><span></span></header><p>Loading…</p>`;
        dialog.showModal();
        try {
            const response = await api.getChatViewOnceReceipts(userId(), store.state.activeChatId, messageId);
            $(".chat-readers-content").innerHTML = `<header><button type="button" data-close-readers>Done</button><strong>Opened by</strong><span></span></header><div class="chat-reactors-list">${(response.members || []).map((member) => `<div><span>${escapeChatHTML(displayMember(member))}</span><b>${member.opened ? `${Number(member.view_count || 1)}×` : "Not opened"}</b></div>`).join("") || `<p>No recipients yet.</p>`}</div>`;
        } catch (error) {
            $(".chat-readers-content p").textContent = userMessage(error, "Could not load view receipts.");
        }
    }

    function ensureHistoryReceipts() {
        if (receiptUser === userId() && historyReceipts) return;
        void historyReceipts?.close();
        receiptUser = userId();
        historyReceipts = receiptUser ? createHistoryReceipts({ api, userId: receiptUser,
            onChange: chatId => { if (chatId === store.state.activeChatId) void handleRealtimeEvent({ type: 'chat_history_changed', chat_id: chatId }); },
        }) : null;
    }

    function recordVisibleHistory() {
        if (!store.state.activeChatId || store.state.loadingRoom || document.hidden || root.closest('.hidden') || chatAccessUnavailable()) return;
        ensureHistoryReceipts();
        const bounds = $('.chat-timeline').getBoundingClientRect();
        if (bounds.height <= 0) return;
        const messages = new Map(store.messages().map(m => [m.id, m]));
        const sequences = $$('.chat-timeline [data-message-id]').filter(node => {
            const box = node.getBoundingClientRect();
            return box.bottom > bounds.top && box.top < bounds.bottom && box.bottom > 0 && box.top < innerHeight;
        }).map(node => messages.get(node.dataset.messageId)).filter(m => m && m.kind !== 'memento'
            && m.status === 'active' && m.delivery_state === 'sent' && historyVisible(m)).map(m => m.room_sequence);
        if (sequences.length) historyReceipts?.viewed(store.state.activeChatId, sequences);
    }

    async function refreshSharedHistory() {
        const chatId = store.state.activeChatId, uid = userId(), generation = roomGeneration;
        if (!chatId || !uid || store.state.detail?.chat.membership_status !== 'accepted') return;
        const revision = ++sharedHistoryRevision;
        const current = () => revision === sharedHistoryRevision && generation === roomGeneration && chatId === store.state.activeChatId && uid === userId();
        sharedHistoryLoading = true; sharedHistoryError = ''; renderHistorySettings();
        try {
            const messages = store.messages(chatId).filter(m => Number.isSafeInteger(m.room_sequence));
            const capturedIds = new Set(messages.map(m => m.id));
            const max = Math.max(0, ...messages.map(m => m.room_sequence));
            let after = Math.max(0, Math.min(...messages.map(m => m.room_sequence), 1 + max) - 1);
            const metadata = new Map();
            let mode;
            do {
                const page = await api.getChatHistory(uid, chatId, after);
                if (!current()) return;
                if (!HISTORY_MODES.some(item => item.value === page.mode) || !Array.isArray(page.items)) throw new Error('Invalid chat history response');
                mode = page.mode;
                for (const item of page.items) if (item.room_sequence <= max) metadata.set(item.room_sequence, item);
                const next = page.next_after_sequence;
                if (next == null || next >= max) break;
                if (!Number.isSafeInteger(next) || next <= after) throw new Error('Chat history did not advance');
                after = next;
            } while (true);
            store.state.detail.chat.history_mode = mode;
            store.state.detail.chat.history_loaded = true;
            store.replaceMessages(chatId, store.messages(chatId).map(message => {
                if (message.kind === 'memento' || !capturedIds.has(message.id)) return message;
                const meta = metadata.get(message.room_sequence);
                if (!meta) return { ...message, history_expires_at: null, saved_in_chat: false, saved_by: null };
                if (meta.cleared) return { id: message.id, chat_id: chatId, room_sequence: message.room_sequence,
                    kind: message.kind, status: 'history_cleared', history_cleared_at: new Date().toISOString(), created_at: message.created_at };
                return { ...message, history_expires_at: meta.history_expires_at, saved_in_chat: meta.saved_in_chat, saved_by: meta.saved_by };
            }), store.state.messagePageByChat.get(chatId));
            renderMessages(false, { preservePosition: true });
        } catch (_) {
            if (current()) sharedHistoryError = 'Chat history settings couldn’t be loaded. Try again.';
        } finally {
            if (current()) { sharedHistoryLoading = false; renderHistorySettings(); }
        }
    }

    function renderHistorySettings() {
        const options = $('[data-history-options]');
        if (!options) return;
        const chat = store.state.detail?.chat;
        const disabled = !chat?.history_loaded || !!sharedHistoryError || sharedHistoryLoading || sharedHistorySaving || chat.membership_status !== 'accepted';
        options.innerHTML = HISTORY_MODES.map(mode => `<button type="button" class="chat-history-choice ${chat?.history_mode === mode.value ? 'selected' : ''}" data-history-mode="${mode.value}" aria-pressed="${chat?.history_mode === mode.value}" ${disabled ? 'disabled' : ''}><i>${uiIcon(mode.icon)}</i><span><strong>${mode.title}</strong><small>${mode.subtitle}</small></span><span class="chat-choice-check" aria-hidden="true">${chat?.history_mode === mode.value ? uiIcon('check') : ''}</span></button>`).join('');
        $('[data-history-status]').textContent = sharedHistorySaving ? 'Saving…' : sharedHistoryLoading ? 'Loading…' : sharedHistoryError;
        $('[data-retry-history]').hidden = !sharedHistoryError;
    }

    async function changeHistoryMode(mode) {
        const chatId = store.state.activeChatId, uid = userId(), chat = store.state.detail?.chat;
        if (sharedHistorySaving || !chat?.history_loaded || !HISTORY_MODES.some(item => item.value === mode) || chat.history_mode === mode) return;
        // iOS ChatHistoryConfirmation copy.
        const message = {
            after24Hours: 'Unsaved messages clear 24 hours after everyone opens the chat, or after 30 days if someone never does. Saved messages and Mementos stay.',
            afterLeaving: 'Unsaved messages clear once everyone has opened the chat and left, or after 30 days if someone never does. Saved messages and Mementos stay.',
            save: 'Messages stay in this chat.',
        }[mode];
        if (!await confirmSheet({ title: 'Change history for everyone?', message, confirmLabel: 'Change history', destructive: mode !== 'save' })) return;
        if (sharedHistorySaving || chatId !== store.state.activeChatId || store.state.detail?.chat?.history_mode === mode) return;
        sharedHistorySaving = true; sharedHistoryError = ''; renderHistorySettings();
        try {
            await api.setChatHistory(uid, chatId, mode);
            if (chatId !== store.state.activeChatId || uid !== userId()) return;
            await refreshSharedHistory();
            void handleRealtimeEvent({ type: 'chat_history_changed', chat_id: chatId });
        } catch (_) {
            if (chatId === store.state.activeChatId && uid === userId()) {
                await refreshSharedHistory();
                sharedHistoryError = 'The change couldn’t be confirmed. Check the current setting and try again.';
            }
        } finally { sharedHistorySaving = false; renderHistorySettings(); }
    }

    async function toggleSavedMessage(messageId) {
        const chatId = store.state.activeChatId, uid = userId();
        const message = store.messages().find(m => m.id === messageId);
        if (!message || !canSaveMessage(message)) return;
        const button = $(`[data-save-message="${CSS.escape(messageId)}"]`);
        if (button?.disabled) return;
        if (button) button.disabled = true;
        try {
            const updated = await api.saveChatMessage(uid, chatId, messageId, !message.saved_in_chat);
            if (uid !== userId() || chatId !== store.state.activeChatId) return;
            store.updateMessage(chatId, updated); renderMessages(false);
            void refreshSharedHistory();
        } catch (_) { showToast?.('Could not change the saved message. Try again.'); }
        finally { if (button?.isConnected) button.disabled = false; }
    }

    function renderSettings() {
        const detail = store.state.detail;
        if (!detail) return;
        const chat = detail.chat;
        const canManage = ["owner", "admin"].includes(chat.role);
        const appearance = currentChatAppearance();
        applyChatAppearance(appearance);
        $(".chat-settings-content").innerHTML = `<header><button type="button" data-close-settings>Done</button><strong>${escapeChatHTML(chat.display_name)}</strong><span></span></header>${canManage && (chat.name || chat.accepted_count > 2) ? `<label class="chat-name-setting">Group name<span><input maxlength="40" value="${escapeChatHTML(chat.name || chat.display_name)}"><button type="button" data-save-chat-name>Save</button></span></label><label class="chat-photo-setting">Group photo<input type="file" accept="image/*" aria-label="Choose group photo"></label>` : ""}<section><h3>People</h3>${(detail.members || []).map((member) => {
            const isSelf = String(member.user_id) === String(userId());
            const remove = canManage && !isSelf && member.role !== "owner" ? `<button type="button" data-remove-chat-member="${escapeChatHTML(member.user_id)}" aria-label="Remove ${escapeChatHTML(displayMember(member))}">Remove</button>` : "";
            const block = !isSelf ? `<button type="button" data-block-chat-member="${escapeChatHTML(member.user_id)}" aria-label="Block ${escapeChatHTML(displayMember(member))}">Block</button>` : "";
            return `<div class="chat-settings-member"><span>${escapeChatHTML(displayMember(member))}</span><small ${!isSelf && member.status === "accepted" && member.is_blocked_by_viewer !== true ? `data-presence-member="${escapeChatHTML(member.user_id)}" data-presence-fallback="${member.role === "owner" ? "Owner" : "Member"}"` : ""}>${escapeChatHTML(member.role === "owner" ? "Owner" : member.status === "invited" ? "Invited" : "Member")}</small>${remove || block ? `<span class="chat-member-actions">${remove}${block}</span>` : ""}</div>`;
        }).join("")}${canManage ? `<button class="chat-add-people" type="button" data-add-current-chat>${uiIcon("plus")} Add people</button>` : ""}</section><section class="chat-history-setting"><h3>Chat history</h3><div data-history-options></div><p data-history-status role="status"></p><button type="button" data-retry-history hidden>Try again</button><small>Hold a message, then tap Save in chat. Saved messages and Mementos stay.</small></section><section class="chat-appearance-setting"><h3>Appearance</h3><label>Chat font<select aria-label="Chat font">${CHAT_FONT_STYLES.map(({ value, label }) => `<option value="${value}" ${appearance.font === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><div class="chat-color-options" role="group" aria-label="Chat color">${CHAT_COLOR_STYLES.map(({ value, label }) => `<button type="button" data-chat-appearance-color="${value}" aria-label="${label} chat color" aria-pressed="${appearance.color === value}" class="${appearance.color === value ? "selected" : ""}"><span></span></button>`).join("")}</div><p class="chat-appearance-preview">This is how your chat will look.</p><small>Only you see these choices. They stay on this device and are never sent to the chat.</small></section><label class="chat-notification-setting">Notifications<select>${[["all", "All messages"], ["daily_only", "Mementos only"], ["muted", "Muted"]].map(([value, label]) => `<option value="${value}" ${chat.notification_level === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><button class="chat-danger-action" type="button" data-report-current-chat>Report chat</button><button class="chat-danger-action" type="button" data-leave-current-chat>Leave chat</button>`;
        $(".chat-notification-setting select").addEventListener("change", updateNotificationLevel, { once: true });
        $(".chat-appearance-setting select").addEventListener("change", (event) => updateChatAppearance({ font: event.target.value }));
        $(".chat-photo-setting input")?.addEventListener("change", updateChatPhoto);
        renderPresence();
        renderHistorySettings();
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
            showToast?.(userMessage(error, "Could not update the group photo."));
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
        } catch (error) { showToast?.(userMessage(error, "Could not update notifications.")); }
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
        } catch (error) { showToast?.(userMessage(error, "Could not add that reaction.")); }
    }

    async function showMessageReactors(messageId) {
        const dialog = $("[data-chat-reactors-dialog]");
        const content = $(".chat-reactors-content");
        content.innerHTML = `<header><button type="button" data-close-reactors>Done</button><strong>Reactions</strong><span></span></header><p class="chat-reactors-status">Loading…</p>`;
        dialog.showModal();
        try {
            const reactors = await api.getChatMessageReactors(userId(), store.state.activeChatId, messageId);
            content.innerHTML = `<header><button type="button" data-close-reactors>Done</button><strong>Reactions</strong><span></span></header><div class="chat-reactors-list">${(reactors || []).map((reactor) => `<div><span>${escapeChatHTML(displayMember(reactor))}</span><b aria-label="${escapeChatHTML(reactor.reaction_type)}">${CHAT_REACTIONS.find(([type]) => type === reactor.reaction_type)?.[1] || uiIcon("smile")}</b></div>`).join("") || `<p>No reactions yet.</p>`}</div>`;
        } catch (error) {
            content.querySelector(".chat-reactors-status").textContent = userMessage(error, "Could not load reactions.");
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
        closeMessageActions();
        if (!await confirmSheet({ title: "Unsend this message?", message: "It will be removed for everyone in this chat.", confirmLabel: "Unsend", destructive: true })) return;
        try {
            const updated = await api.unsendChatMessage(userId(), store.state.activeChatId, messageId);
            store.updateMessage(store.state.activeChatId, updated);
            renderMessages(false);
        } catch (error) { showToast?.(userMessage(error, "Could not unsend that message.")); }
    }

    async function deleteMessageForMe(messageId) {
        closeMessageActions();
        if (!await confirmSheet({ title: "Delete for you?", message: "This hides the message from your chat. Other people still see it.", confirmLabel: "Delete", destructive: true })) return;
        try {
            await api.deleteChatMessageForMe(userId(), store.state.activeChatId, messageId);
            const remaining = store.messages().filter((message) => message.id !== messageId);
            store.replaceMessages(store.state.activeChatId, remaining, store.state.messagePageByChat.get(String(store.state.activeChatId)) || {});
            renderMessages(false);
        } catch (error) { showToast?.(userMessage(error, "Could not hide that message.")); }
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

    function closeMessageActions() { messageActions.close(); }

    function scrollMessageWithinTimeline(message, behavior = "auto") {
        const timeline = $(".chat-timeline");
        if (!message || !timeline) return;
        const timelineRect = timeline.getBoundingClientRect();
        const messageRect = message.getBoundingClientRect();
        const delta = messageRect.top + messageRect.height / 2 - (timelineRect.top + timelineRect.height / 2);
        timeline.scrollTo({ top: timeline.scrollTop + delta, behavior });
    }

    function revealMessageWithinTimeline(messageId, behavior = "auto") {
        if (!messageId || !store.messages().some((message) => String(message.id) === String(messageId))) return;
        let message = $(`[data-message-id="${CSS.escape(String(messageId))}"]`);
        if (!message) {
            renderMessages(false, { focusMessageId: String(messageId) });
            message = $(`[data-message-id="${CSS.escape(String(messageId))}"]`);
        }
        requestAnimationFrame(() => scrollMessageWithinTimeline(message, behavior));
    }

    function shiftMessageWindow(direction) {
        const items = store.messages();
        if (direction === "older") messageWindow.previous(store.state.activeChatId, items);
        else messageWindow.next(store.state.activeChatId, items);
        renderMessages(false, { preservePosition: true });
    }

    function toggleMessageActions(messageId, forceOpen = null) { messageActions.toggle(messageId, forceOpen); }

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

    function renderSharedMementoDraft() {
        const draft = $(".chat-memento-draft");
        draft.classList.toggle("hidden", !sharedMementoDraft);
        if (!sharedMementoDraft) {
            draft.querySelector("img").removeAttribute("src");
            draft.querySelector("strong").textContent = "";
            return;
        }
        draft.querySelector("img").src = sharedMementoDraft.imageURL;
        draft.querySelector("img").alt = `${sharedMementoDraft.owner}'s Memento`;
        draft.querySelector("strong").textContent = `Sharing ${sharedMementoDraft.owner}'s Memento`;
    }

    function clearSharedMementoDraft() {
        sharedMementoDraft = null;
        renderSharedMementoDraft();
    }

    function handleTypingInput() {
        if (!$(".chat-composer textarea").value.trim()) return stopTyping();
        if (!typingSent && store.state.activeChatId) {
            typingSent = String(store.state.activeChatId);
            void api.setChatTyping(userId(), typingSent, true).catch(() => null);
        }
        clearTimeout(typingTimer);
        typingTimer = setTimeout(stopTyping, 1800);
    }

    function stopTyping() {
        clearTimeout(typingTimer);
        typingTimer = null;
        if (typingSent && userId()) void api.setChatTyping(userId(), typingSent, false).catch(() => null);
        typingSent = false;
    }

    // Hints about other chats update only that row (one GET), coalesced per
    // chat. Unknown chats, reconnects and bursts fall back to one list reload.
    function scheduleListRefresh(delay = 400) {
        clearTimeout(listRefreshTimer);
        listRefreshTimer = setTimeout(() => { listRefreshTimer = null; void loadChats({ quiet: true }); }, delay);
    }

    function scheduleChatRowRefresh(chatId, delay = 300) {
        if (!chatId) return;
        if (!store.state.chats.some(chat => chat.id === chatId) || chatRefreshTimers.size >= 8) return scheduleListRefresh();
        clearTimeout(chatRefreshTimers.get(chatId));
        chatRefreshTimers.set(chatId, setTimeout(() => {
            chatRefreshTimers.delete(chatId);
            void refreshChatRow(chatId);
        }, delay));
    }

    async function refreshChatRow(chatId) {
        const uid = userId();
        if (!uid) return;
        try {
            const detail = await api.getChat(uid, chatId);
            if (uid !== userId() || !detail?.chat) return;
            if (!['accepted', 'invited'].includes(detail.chat.membership_status || 'accepted')) return scheduleListRefresh(0);
            store.upsertChat(detail.chat);
            if (chatId === store.state.activeChatId && store.state.detail) store.state.detail = { ...store.state.detail, ...detail };
            renderChatList();
            if (store.state.activeChatId) renderMementoToolbar();
        } catch (_) {
            scheduleListRefresh();
        }
    }

    async function handleRealtimeEvent(event) {
        if (event.type === 'presence_snapshot') return;
        store.state.lastEventId = event.id || store.state.lastEventId;
        // A (re)connection or server resync without a room means events may have
        // been missed while the stream was closed: repair the open room and the list.
        if (!event.chat_id && ['ready', 'resync'].includes(event.type)) {
            if (Date.now() - lastListLoad > 5_000) scheduleListRefresh(0);
            if (store.state.activeChatId) void handleRealtimeEvent({ ...event, type: 'resync', chat_id: store.state.activeChatId });
            void retryPendingMessages(null);
            return;
        }
        const chatId = String(event.chat_id || "");
        if (event.type === 'chat_history_changed' && chatId === store.state.activeChatId) void refreshSharedHistory();
        const callHistoryChanged = ['call_started', 'call_updated', 'call_answered', 'call_declined', 'call_ended', 'call_history_changed'].includes(event.type);
        if (["typing_started", "typing_stopped"].includes(event.type)) {
            if (chatId !== store.state.activeChatId || String(event.actor_user_id) === String(userId())) return;
            if (event.type === "typing_started") store.state.typingUserIds.add(String(event.actor_user_id));
            else store.state.typingUserIds.delete(String(event.actor_user_id));
            $(".chat-typing").classList.toggle("hidden", store.state.typingUserIds.size < 1);
            renderRoomHeader(store.state.detail?.chat);
            return;
        }
        if (chatId && chatId === store.state.activeChatId && (callHistoryChanged || ["message_created", "message_updated", "message_deleted", "memento_created", "chat_history_changed", "resync", "ready"].includes(event.type))) {
            // One active repair and one coalesced hint, never a growing SSE queue.
            if (realtimeRefreshing) {
                pendingRealtimeEvent = { ...event, type: 'resync' };
                return;
            }
            realtimeRefreshing = true;
            const generation = roomGeneration;
            const revision = messagesRevision;
            const latest = Math.max(0, ...store.messages(chatId).map((message) => message.room_sequence));
            const position = timelineScroll.capture();
            const away = historyHasNewer || messageWindow.range(chatId, store.messages()).hiddenAfter > 0 || !position.bottom;
            const anchor = away ? position.anchors.map(item => store.messages().find(message => message.id === item.key)).find(Boolean) : null;
            const needsFullResync = !!anchor || callHistoryChanged || ["resync", "ready", "message_updated", "message_deleted", "chat_history_changed"].includes(event.type);
            try {
                const response = await api.getChatMessages(userId(), chatId, { limit: 100, afterSequence: anchor ? Math.max(0, Math.floor(anchor.room_sequence) - 1) : needsFullResync ? null : Math.floor(latest) });
                if (generation !== roomGeneration || chatId !== store.state.activeChatId) return;
                const current = timelineScroll.capture();
                if (revision !== messagesRevision || (anchor && current.anchors[0]?.key !== position.anchors[0]?.key) || (!away && !current.bottom)) {
                    pendingRealtimeEvent = { ...event, type: 'resync' };
                    return;
                }
                if (needsFullResync) {
                    // Replace, never merge a safety repair: hidden/deleted content
                    // outside the authoritative response must not survive reconnect.
                    store.replaceMessages(chatId, response.items || [], response);
                    historyHasNewer = !!anchor && ((response.items || []).length === 100 || latest > Math.max(0, ...store.messages().map(item => item.room_sequence)));
                    if (anchor) store.state.messagePageByChat.set(chatId, { next_before_sequence: store.messages()[0]?.room_sequence > 1 ? store.messages()[0].room_sequence : null });
                } else {
                    const oldest = store.messages()[0]?.id;
                    store.mergeMessages(chatId, response.items || []);
                    if (oldest && !store.messages().some(item => item.id === oldest)) store.state.messagePageByChat.set(chatId, { next_before_sequence: store.messages()[0]?.room_sequence });
                    historyHasNewer = (response.items || []).length === 100;
                }
                messagesRevision++;
                renderMessages(!away && !historyHasNewer);
                if (!away) await markRoomRead();
                if (event.type === 'memento_created' || event.type === 'resync') {
                    const row = dailyLedgerEnabled() ? await api.getChatDailyRow(userId(), chatId) : null;
                    if (generation !== roomGeneration || chatId !== store.state.activeChatId) return;
                    store.state.dailyRow = row;
                    rememberDailyRow(row);
                    if (!store.state.displayedDailyRow || store.state.displayedDailyRow.ledger_date === localLedgerDate()) store.state.displayedDailyRow = row;
                    renderDailyRow();
                    renderMessages(false);
                }
            } catch (error) {
                if (generation === roomGeneration && chatId === store.state.activeChatId && [401, 403, 404].includes(error.status)) {
                    messagesRevision++;
                    store.replaceMessages(chatId, []);
                    if (dailyLedgerEnabled()) store.state.dailyRow = null;
                    renderMessages(false);
                }
            } finally {
                realtimeRefreshing = false;
                const pending = pendingRealtimeEvent;
                pendingRealtimeEvent = null;
                if (pending?.chat_id === store.state.activeChatId) void handleRealtimeEvent(pending);
            }
        }
        if (chatId) scheduleChatRowRefresh(chatId);
        else if (!event.type?.startsWith('call_')) scheduleListRefresh();
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
        if (!store.messages().some((message) => String(message.id) === String(messageId))) return;
        renderMessages(false, { focusMessageId: messageId });
        const message = $(`[data-message-id="${CSS.escape(messageId)}"]`);
        if (!message) return;
        message.classList.add("deep-linked");
        requestAnimationFrame(() => scrollMessageWithinTimeline(message));
    }

    // Every way out of a room (back button, browser Back, tab switch, account
    // change) runs this, so typing, receipts and timers always stop.
    function leaveRoom() {
        const chatId = store.state.activeChatId;
        closeMessageActions();
        void historyReceipts?.leave(chatId);
        viewOnceSessionByMessage.clear(); viewOnceStates.clear();
        closeMediaViewer();
        stopTyping();
        clearSharedMementoDraft();
        if (voiceMode) resetChatMediaComposer();
        roomGeneration += 1;
        historyLoading = null;
        pendingRealtimeEvent = null;
        timelineScroll.reset();
        store.state.activeChatId = null;
        store.state.detail = null;
        store.state.dailyRow = null;
        store.state.displayedDailyRow = null;
        store.state.dailyRowsByDate.clear();
        store.state.typingUserIds.clear();
        store.state.replyToMessageId = null;
        $(".chat-typing").classList.add("hidden");
        clearTimeout(historySweepTimer); historySweepTimer = null;
        $('[data-memento-gallery-dialog]').close();
        $('[data-sticker-library-dialog]').close();
        reportActiveChat();
        return chatId;
    }

    // The Back button and the interactive edge swipe share this path.
    function backFromRoom() {
        if (inviteMode && store.state.activeChatId) {
            inviteMode = false;
            return showScreen("room");
        }
        return showChatList();
    }

    function showChatList() {
        // Only this view pushes entries with a chatId: pop that entry instead of
        // stacking a second list entry on top of it.
        const popRoomEntry = history.state?.validApp === true && history.state.chatId != null && String(history.state.chatId) === String(store.state.activeChatId);
        const chatId = leaveRoom();
        showScreen("list");
        if (popRoomEntry) history.back();
        else {
            const url = new URL(location.href);
            url.searchParams.set("tab", "chats");
            url.searchParams.delete("chat");
            url.searchParams.delete("message");
            url.searchParams.delete("call");
            history.replaceState({ validApp: true, panel: "chats" }, "", `${url.pathname}${url.search}`);
        }
        if (chatId) scheduleChatRowRefresh(chatId, 0);
        else void loadChats({ quiet: true });
    }

    async function handleClick(event) {
        const target = event.target.closest("button, a[data-open-chat], [data-view-memento]");
        if (!target) { if (!event.target.closest(".chat-message-actions")) closeMessageActions(); return; }
        if (!target.matches("[data-message-menu]")) closeMessageActions();
        if (target.matches("[data-new-chat]")) return openCreateChat();
        if (target.matches("[data-chat-list]")) return backFromRoom();
        if (target.matches("[data-create-submit]")) return createChat();
        if (target.dataset.searchChat) return openSearchResult(target.dataset.searchChat, target.dataset.searchMessage || null);
        if (target.dataset.returnMissedCall) {
            const chat = store.state.chats.find(item => item.id === target.dataset.returnMissedCall);
            await openChat(target.dataset.returnMissedCall);
            if (chat && !chatAccessUnavailable()) return calls.start('audio', chat);
            return;
        }
        if (target.dataset.pendingMedia) {
            const chat = store.state.chats.find(item => item.id === target.dataset.pendingMedia);
            await openChat(target.dataset.pendingMedia);
            if (chatAccessUnavailable() || store.state.activeChatId !== target.dataset.pendingMedia) return;
            let message = store.messages().find(item => item.room_sequence === Number(chat?.next_view_once_room_sequence));
            if (!message && chat?.next_view_once_room_sequence) {
                const response = await api.getChatMessages(userId(), chat.id, { afterSequence: Math.max(0, Number(chat.next_view_once_room_sequence) - 1), limit: 1 }).catch(() => null);
                if (store.state.activeChatId !== chat.id) return;
                message = response?.items?.find(item => item.room_sequence === Number(chat.next_view_once_room_sequence));
                if (message) store.mergeMessages(chat.id, [message]);
            }
            if (message) return openViewOnceMessage(message.id);
            return;
        }
        if (target.dataset.openChat) {
            if (target.tagName === 'A') {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
            }
            return openChat(target.dataset.openChat);
        }
        if (target.dataset.acceptChat) return acceptInvitation(target.dataset.acceptChat);
        if (target.dataset.declineChat) return declineInvitation(target.dataset.declineChat);
        if (target.matches("[data-history-direction]")) return advanceHistory(target.dataset.historyDirection, { retry: true });
        if (target.matches("[data-jump-latest]")) return jumpToLatest();
        if (target.dataset.startCall) { if (voiceMode) resetChatMediaComposer(); document.activeElement?.blur(); return calls.start(target.dataset.startCall, store.state.detail?.chat); }
        if (target.dataset.mementoDay) return loadMementoDay(target.dataset.mementoDay);
        if (target.dataset.mementoDate) return loadMementoDate(target.dataset.mementoDate);
        if (target.matches('[data-open-memento-gallery]')) return openMementoGallery();
        if (target.matches('[data-close-memento-gallery]')) return $('[data-memento-gallery-dialog]').close();
        if (target.matches('[data-open-stickers]')) return openStickerLibrary();
        if (target.matches('[data-close-stickers]')) return $('[data-sticker-library-dialog]').close();
        if (target.matches('[data-edit-stickers]')) {
            const editing = $('[data-sticker-library-dialog]').classList.toggle('is-editing');
            target.textContent = editing ? 'Done' : 'Edit';
            target.setAttribute('aria-pressed', String(editing));
            return;
        }
        if (target.matches("[data-open-memento]")) return openMementoComposer({ showExisting: target.hasAttribute("data-show-mementos") });
        if (target.matches("[data-open-chat-media]")) return openChatMediaComposer();
        if (target.matches("[data-close-chat-media]")) { if (!chatMediaPublishing) $('[data-chat-media-dialog]').close(); return; }
        if (target.matches("[data-make-sticker]")) { $('[data-save-sticker]').textContent = photoStickerMode ? 'Save and add' : 'Save and send'; return $(".chat-sticker-file-input").click(); }
        if (target.matches('[data-retry-stickers]')) return loadStickerLibrary();
        if (target.matches("[data-voice-play], [data-voice-toggle]")) return loadRoomTools().then((tools) => tools?.voice.toggle(target));
        if (target.matches("[data-voice-speed]")) return loadRoomTools().then((tools) => tools?.voice.cycleSpeed(target));
        if (target.matches("[data-record-voice]")) return void toggleVoiceRecording();
        if (target.matches('[data-record-again]')) return void toggleVoiceRecording();
        if (target.matches('[data-stop-voice]')) return stopVoiceRecorder();
        if (target.matches('[data-cancel-voice]')) return resetChatMediaComposer();
        if (target.matches('[data-send-voice]')) return publishChatMedia(event);
        if (target.matches('[data-photo-text]')) {
            if (!chatMediaPublishing) reviewEditor?.beginCaption(undefined, { viaKeyboard: event.detail === 0 });
            return;
        }
        if (target.matches('[data-cancel-chat-upload]')) { chatMediaAbort?.abort(); return; }
        if (target.matches('[data-photo-stickers]')) { if (!chatMediaPublishing) return openStickerLibrary({ photo: true }); return; }
        if (target.matches('[data-photo-cutout]')) {
            if (chatMediaPublishing || selectedChatMedia?.kind !== 'photo') return;
            photoStickerMode = true;
            $('[data-save-sticker]').textContent = 'Save and add';
            return selectedPhotoSourceFile().then(file => stickerMaker.open(file)).catch(error => { $('.chat-media-status').textContent = userMessage(error, "That photo could not be cut out."); });
        }
        if (target.matches("[data-close-memento]")) return $("[data-memento-dialog]").close();
        if (target.matches("[data-skip-memento]")) return skipMementoForToday();
        if (target.matches("[data-swap-memento-capture]")) return swapSelectedMementoViews();
        if (target.dataset.viewMemento) return viewMemento(target.dataset.viewMemento, target.dataset.mementoOwner, target.dataset.mementoEntry || null, target.dataset.mementoSwapped || null);
        if (target.dataset.openChatMediaMessage) return openPersistentChatMedia(target.dataset.openChatMediaMessage);
        if (target.dataset.sendSticker) {
            if (!photoStickerMode) return sendSticker(target.dataset.sendSticker);
            const url = target.querySelector('img')?.src;
            if (url) {
                target.disabled = true;
                return photoStickers.add(url).then(() => $('[data-sticker-library-dialog]').close())
                    .catch(error => { $('.chat-sticker-status').textContent = userMessage(error, "Could not add that sticker."); }).finally(() => { target.disabled = false; });
            }
            return;
        }
        if (target.dataset.deleteSticker) return deleteSticker(target.dataset.deleteSticker);
        if (target.dataset.openViewOnce) return openViewOnceMessage(target.dataset.openViewOnce, { accessible: event.detail === 0 });
        if (target.dataset.historyMode) return changeHistoryMode(target.dataset.historyMode);
        if (target.matches('[data-retry-history]')) return refreshSharedHistory();
        if (target.dataset.saveMessage) return toggleSavedMessage(target.dataset.saveMessage);
        if (target.matches('[data-pause-ephemeral]')) return setEphemeralPaused(!ephemeralPaused);
        if (target.dataset.viewOnceReceipts) return showViewOnceReceipts(target.dataset.viewOnceReceipts);
        if (target.matches("[data-share-viewed-memento]")) return shareViewedMemento();
        if (target.matches("[data-swap-viewed-memento]")) return void swapViewedMemento();
        if (target.matches("[data-reply-viewed-media]")) return replyToViewedMedia();
        if (target.matches("[data-react-viewed-media]")) return reactToViewedMedia();
        if (target.matches("[data-close-media]")) return closeMediaViewer();
        if (target.matches("[data-chat-settings]")) { void refreshSharedHistory(); renderSettings(); return $("[data-chat-settings-dialog]").showModal(); }
        if (target.dataset.chatAppearanceColor) return updateChatAppearance({ color: target.dataset.chatAppearanceColor });
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
            } catch (error) { showToast?.(userMessage(error, "Could not rename this group.")); }
            return;
        }
        const memberFor = (id) => (store.state.detail?.members || []).find((member) => String(member.user_id) === String(id));
        if (target.dataset.removeChatMember) {
            const member = memberFor(target.dataset.removeChatMember);
            const invited = member?.status === "invited";
            if (!await confirmSheet(invited ? {
                title: "Cancel invite?",
                message: "They won't be able to join this group unless an admin invites them again.",
                confirmLabel: "Cancel Invite", cancelLabel: "Keep", destructive: true,
            } : {
                title: `Remove ${member ? displayMember(member) : "this person"}?`,
                message: "They'll immediately lose access and stop receiving new messages. Mementos they already shared stay in the group.",
                confirmLabel: "Remove", destructive: true,
            })) return;
            try {
                presence?.invalidate();
                await api.removeChatMember(userId(), store.state.activeChatId, target.dataset.removeChatMember);
                presence?.invalidate();
                await openChat(store.state.activeChatId, { updateHistory: false, force: true });
                renderSettings();
            } catch (error) { showToast?.(userMessage(error, "Could not remove that person.")); }
            return;
        }
        if (target.dataset.blockChatMember) {
            const member = memberFor(target.dataset.blockChatMember);
            if (!await confirmSheet({
                title: `Block ${member ? displayMember(member) : "this person"}?`,
                message: "They won't be able to contact you, and their content will be hidden across Valid.",
                confirmLabel: "Block", destructive: true,
            })) return;
            try {
                presence?.invalidate();
                await api.blockUser(userId(), target.dataset.blockChatMember);
                presence?.invalidate();
                showToast?.("Person blocked");
                await loadChats({ quiet: true });
                renderSettings();
            } catch (error) { showToast?.(userMessage(error, "Could not block this person.")); }
            return;
        }
        if (target.matches("[data-cancel-reply]")) { store.state.replyToMessageId = null; return renderReplyDraft(); }
        if (target.matches("[data-remove-memento-draft]")) return clearSharedMementoDraft();
        if (target.dataset.messageMenu) return toggleMessageActions(target.dataset.messageMenu);
        if (target.dataset.replyMessage) { closeMessageActions(); store.state.replyToMessageId = target.dataset.replyMessage; renderReplyDraft(); return $(".chat-composer textarea").focus(); }
        if (target.dataset.reactMessage) return reactToMessage(target.dataset.reactMessage, target.dataset.reaction);
        if (target.dataset.viewReactions) return showMessageReactors(target.dataset.viewReactions);
        if (target.dataset.viewReaders) return showMessageReaders(target.dataset.viewReaders);
        if (target.dataset.copyMessage) return copyMessage(target.dataset.copyMessage);
        if (target.dataset.deleteMessage) return deleteMessageForMe(target.dataset.deleteMessage);
        if (target.dataset.unsendMessage) return unsendMessage(target.dataset.unsendMessage);
        if (target.dataset.retryMessage) return sendMessage(null, target.dataset.retryMessage);
        if (target.dataset.discardMessage) return discardFailedMessage(target.dataset.discardMessage);
        if (target.dataset.scrollMessage) return revealMessageWithinTimeline(target.dataset.scrollMessage, "smooth");
        if (target.matches("[data-report-current-chat]")) return reportCurrentChat();
        if (target.matches("[data-leave-current-chat]")) {
            if (!await confirmSheet({
                title: "Leave & delete this chat?",
                message: "This removes the chat from your Chats. Other people keep their copy.",
                confirmLabel: "Leave & Delete", destructive: true,
            })) return;
            return leaveCurrentChat();
        }
    }

    async function leaveCurrentChat() {
        const chatId = store.state.activeChatId;
        if (!chatId) return;
        presence?.invalidate();
        await api.leaveChat(userId(), chatId).then(async () => {
            presence?.invalidate();
            $("[data-chat-settings-dialog]").close();
            await loadChats({ quiet: true });
            if (store.state.activeChatId === chatId) showChatList();
        }).catch((error) => showToast?.(userMessage(error, "Could not leave this chat.")));
    }

    async function reportCurrentChat() {
        const chatId = store.state.activeChatId;
        const chat = store.state.detail?.chat;
        if (!chatId || reportingChat) return;
        reportingChat = true;
        try {
            const tools = await loadRoomTools();
            if (!tools) return void showToast?.("Reporting is unavailable offline. Try again.");
            await tools.reportChatFlow({
                chatName: chat?.display_name || "this chat",
                isGroup: isGroupChat(chat),
                submit: async (reason) => chatId === store.state.activeChatId && api.reportChat(userId(), chatId, reason),
                leave: () => chatId === store.state.activeChatId && leaveCurrentChat(),
                showToast, haptic: feedback,
            });
        } finally {
            reportingChat = false;
        }
    }

    return { activate, refresh, openChat, store, beforeSessionEnd: async () => {
        stopTyping();
        if (store.state.activeChatId) leaveRoom();
        realtime.stop();
        activation = null;
        closeMessageActions(); await historyReceipts?.close(); historyReceipts = null; receiptUser = null; closeMediaViewer(); roomGeneration++; historyLoading = null; pendingRealtimeEvent = null; timelineScroll.reset(); mementoCamera?.close(); resetChatMediaComposer(); $('[data-chat-media-dialog]').close();
        reportActiveChat();
        return calls.beforeSessionEnd();
    } };
}
