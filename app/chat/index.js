import { bindMessageActions, messageActionsMarkup } from './actions.js';
import { HISTORY_MODES, canSaveMessage, historyVisible, createHistoryReceipts } from './history.js';
import { viewOncePresentation } from './view-once.js';
import { presenceLabel } from "./presence.js";
import { reconcileKeyedElements } from "../keyed-list.js";
import { ingestEnabled, ingestSegmentCount, photoPipeline, prepareChatMedia, prepareMementoImages } from "./media.js";
import { createPhotoStickers } from './photo-stickers.js';
import { bindVoiceGesture, createVoiceWaveform, VOICE_LOCKED_HINT } from './voice-interaction.js';
import {
    CHAT_REACTIONS, chatAttentionPriority, chatInboxStatus, chatSeparatorBefore, displayMember, escapeChatHTML,
    friendInvitationOpener, invitedByDisplayName, isGroupChatSummary, KNOWN_MESSAGE_KINDS, linkifyChatText, mementoIsHidden,
    messageTime, normalizeMessage, recentConversations, safeMediaURL, SAY_HI_WAVE, streakAtRisk, streakBroken,
    streakCountdown, streakAccessibilityLabel, streakIsFinalHour, streakTimeLeft,
    VIDEO_PROCESSING_MESSAGE, VIDEO_UNAVAILABLE_MESSAGE, videoPlaybackState, videoRefreshDelay,
} from "./models.js";
import { hourglassMarkup, inboxStatusLineMarkup, streakLabelMarkup } from "./inbox-status.js";
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
import { createNotificationNudge } from "./notification-nudge.js";
import { createMessageWindow } from "./message-window.js";
import { createTimelineScroll } from "./timeline-scroll.js";
import { callHistoryPresentation } from './call-history.js';

const REFRESH_MS = 30_000;
const MEMENTO_CAMERA_ART = "../assets/app/memento-camera.webp";
const SAY_HI_DISMISS_MS = 7 * 24 * 60 * 60_000;
const SAY_HI_RELOAD_MS = 5 * 60_000;
// "Add a message, or we’ll send 👋" (ChatSeparateMessageField).
const SEPARATE_MESSAGE_PLACEHOLDER = `Add a message, or we\u2019ll send ${SAY_HI_WAVE}`;
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

export function createChatsView({ root, api, getUser, getConfig, presence, softHaptic, successHaptic, haptic, showToast, installSwipeBack, onUnreadChange, onPlay, notifications }) {
    const feedback = (kind) => (haptic || globalThis.ValidPreferences?.haptic)?.(kind);
    const attentionPriority = chat => chatAttentionPriority(chat, {
        dailyLedgerEnabled: dailyLedgerEnabled(),
        callsEnabled: getConfig()?.enable_calls === true && getConfig()?.enable_web_calls === true,
    });
    const store = createChatStore();
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
    // Chat camera sends start as View once (ChatMediaCaptureView.isViewOnce).
    let chatViewOnce = true;
    let viewOnceHintTimer = null;
    let chatMediaSaved = false;
    let mementoSaved = false;
    // Chats with a text the viewer's sends could not deliver, and in-flight sends.
    const failedChatIds = new Set();
    const sendingChatCounts = new Map();
    // Say hi card (SayHiModel): suggestions, per-friend status, the chats waves started.
    let sayHi = { userId: null, items: [], loadedAt: 0, statuses: new Map(), chats: new Map(), loading: false };
    // The room's "New messages" boundary for this visit (ChatUnreadAnchorState).
    let unreadAnchor = { chatId: null, boundary: 0, dividerId: null, anchored: false };
    // The local Memento sends of today, by chat (the viewer's own post counts from Send).
    const mementoSentToday = new Map();
    let streakTicker = null;
    // New Chat (ChatCreationModel): mode, step, people, choices.
    let creation = null;

    root.innerHTML = `
        <div class="chat-shell">
            <section class="chat-list-screen" data-chat-screen="list">
                <header class="chat-page-header"><button class="chat-icon-button" type="button" data-focus-chat-search aria-label="Search chats" aria-expanded="false">${uiIcon('search')}</button><h1>Chats</h1><button class="chat-icon-button" type="button" data-new-chat aria-label="New chat">${uiIcon('compose')}</button></header>
                <form class="chat-search-form hidden" role="search"><label><span aria-hidden="true">${uiIcon('search')}</span><input type="search" maxlength="100" placeholder="Search chats &amp; messages" aria-label="Search chats &amp; messages" autocomplete="off" enterkeyhint="search"><button type="button" class="chat-search-clear" data-clear-chat-search aria-label="Clear search" hidden>${uiIcon('close')}</button></label><button type="button" data-cancel-chat-search>Cancel</button></form>
                <div class="chat-notification-nudge-slot" data-nudge-slot="inbox" hidden></div>
                <div class="chat-list-status" role="status"></div>
                <div class="chat-search-results hidden" aria-label="Chat search results"></div>
                <section class="chat-say-hi hidden" aria-labelledby="chatSayHiTitle"></section>
                <section class="chat-recent hidden" aria-label="Recent conversations"><h2>Recent</h2><div class="chat-recent-rail"></div></section>
                <div class="chat-list" aria-label="Conversations"></div>
            </section>
            <section class="chat-create-screen hidden" data-chat-screen="create">
                <header class="chat-room-header chat-create-header"><button class="chat-create-back" type="button" data-create-back>Close</button><strong>New Chat</strong><span></span></header>
                <div class="chat-create-body">
                    <label class="chat-person-search"><span aria-hidden="true">${uiIcon("search")}</span><input type="search" placeholder="Search friends and groups" aria-label="Search friends and groups" autocomplete="off"></label>
                    <div class="chat-people-list"></div>
                    <div class="chat-group-details hidden"></div>
                    <p class="chat-create-status" role="status"></p>
                </div>
                <div class="chat-create-bar hidden"></div>
            </section>
            <section class="chat-invite-screen hidden" data-chat-screen="invite">
                <header class="chat-room-header"><button class="chat-back" type="button" data-chat-list aria-label="Back to chats">${uiIcon("back")}</button><strong>Chat invite</strong><span></span></header>
                <div class="chat-invite-body"></div>
            </section>
            <section class="chat-room-screen hidden" data-chat-screen="room">
                <header class="chat-room-header"><button class="chat-back" type="button" data-chat-list aria-label="Back to chats">${uiIcon("back")}</button><button class="chat-room-title" type="button" data-chat-settings><strong>Chat</strong><small>Loading…</small></button><div class="chat-room-tools"><span class="chat-call-actions hidden"><button class="chat-icon-button" type="button" data-start-call="audio" aria-label="Start voice call">${uiIcon("phone")}</button></span><button class="chat-memento-toolbar hidden" type="button" data-open-memento-gallery aria-label="Mementos"></button><button class="chat-icon-button" type="button" data-chat-settings aria-label="Chat details">${uiIcon("more")}</button></div></header>
                <div class="chat-invite-reminder hidden"></div>
                <div class="chat-room-status" role="status"></div>
                <div class="chat-timeline" role="list" aria-live="polite" aria-label="Messages"></div>
                <button class="chat-jump-latest hidden" type="button" data-jump-latest aria-label="Jump to latest messages"><span>Latest</span>${uiIcon('down')}</button>
                <div class="chat-typing hidden" aria-live="polite">Someone is typing…</div>
                <div class="chat-notification-nudge-slot" data-nudge-slot="conversation" hidden></div>
                <div class="chat-memento-capture hidden"><button type="button" class="chat-memento-capture-button" data-open-memento aria-describedby="chatMementoCaptureHint"><img src="${MEMENTO_CAMERA_ART}" alt="" width="28" height="28" decoding="async"><span>Take a Memento</span></button><span class="visually-hidden" id="chatMementoCaptureHint">Opens the camera to share a photo with this chat</span></div>
                <div class="chat-reply-draft hidden"><span></span><button type="button" data-cancel-reply aria-label="Cancel reply">${uiIcon('close')}</button></div>
                <form class="chat-composer">
                    <div class="chat-memento-draft hidden">
                        <img alt="" decoding="async">
                        <span><strong></strong><small>Add an optional message</small></span>
                        <button type="button" data-remove-memento-draft aria-label="Remove Memento">×</button>
                    </div>
                    <button class="chat-camera-button" type="button" data-open-chat-media aria-label="Open camera"><img src="${MEMENTO_CAMERA_ART}" alt="" width="26" height="26" decoding="async"></button>
                    <button class="chat-attachment-button" type="button" data-open-stickers aria-label="Send a sticker"><span class="native-sticker-icon" aria-hidden="true"></span></button>
                    <div class="chat-input-wrap"><textarea rows="1" maxlength="2000" placeholder="Message" aria-label="Message" enterkeyhint="send"></textarea><button type="button" class="chat-mic-button" data-record-voice aria-label="Record voice message" aria-description="Hold to record, slide left to cancel, or slide up to lock">${uiIcon('mic')}</button></div>
                    <button class="chat-send-button" type="submit" aria-label="Send message">${uiIcon('send')}</button>
                    <section class="chat-voice-inline hidden" aria-label="Voice message"><button type="button" data-cancel-voice aria-label="Discard voice message">${uiIcon('trash')}</button><div class="chat-voice-body"><p class="chat-voice-status" role="status"></p><canvas class="chat-voice-waveform" width="192" height="28" aria-hidden="true"></canvas><p class="chat-voice-hint"></p><audio class="chat-inline-audio" aria-label="Voice message preview" hidden></audio><div class="chat-voice-player" hidden><button type="button" data-voice-play aria-label="Play voice preview">${uiIcon('play')}</button><input type="range" min="0" max="100" value="0" step="0.1" aria-label="Voice preview position"><small class="chat-voice-clock" aria-hidden="true">0:00</small><button type="button" class="chat-voice-speed" data-voice-speed aria-label="Playback speed 1×">1×</button></div><div class="chat-voice-preview-actions" hidden><button type="button" class="chat-voice-delete" data-delete-voice>${uiIcon('trash')}<span>Delete</span></button><button type="button" data-record-again>${uiIcon('retake')}<span>Record again</span></button><button type="button" class="chat-voice-send" data-send-voice>${uiIcon('send')}<span>Send</span></button></div></div><button type="button" data-stop-voice aria-label="Stop recording and preview">${uiIcon('stop')}</button></section>
                </form>
            </section>
        </div>
        <dialog class="chat-sheet memento-sheet" data-memento-dialog aria-label="Today's Memento">
            <form class="memento-form">
                <header><button type="button" class="memento-close" data-close-memento aria-label="Close">${uiIcon('close')}</button><strong>Today's Memento</strong><span></span></header>
                <section class="live-camera" data-memento-camera hidden aria-label="Memento camera"></section>
                <div class="memento-review-content">
                <div class="memento-preview">${uiIcon('camera')}<p>Capture one real moment from today.</p></div>
                <p class="memento-swap-hint" hidden>Tap the small photo to swap</p>
                </div>
                <div class="memento-send-feedback" aria-live="polite" aria-atomic="true">
                <div class="memento-progress hidden"><span></span></div>
                <p class="memento-status" role="status"></p>
                </div>
                <div class="memento-review-actions">
                    <button class="memento-retake" type="button" data-retake-memento aria-label="Retake">${uiIcon('retake')}</button>
                    <button class="review-save" type="button" data-save-memento aria-label="Save"><span class="review-save-circle">${uiIcon('save-down')}</span><small>Save</small></button>
                    <button class="primary-button memento-publish send-pill" type="submit" disabled><span class="send-pill-title">Send</span>${uiIcon('send')}</button>
                </div>
            </form>
        </dialog>
        <dialog class="chat-sheet chat-camera-sheet" data-chat-media-dialog aria-label="Send media">
            <form class="chat-media-form">
                <header><button type="button" data-close-chat-media aria-label="Close camera">${uiIcon('close')}</button><strong>Camera</strong><span></span></header>
                <section class="live-camera" data-chat-camera tabindex="-1" hidden aria-label="Message camera"></section>
                <section class="chat-media-editor">
                <div class="chat-photo-tools"><button type="button" data-retake-chat-photo>${uiIcon('retake')} Retake</button><span></span><button type="button" data-close-chat-media aria-label="Close camera">${uiIcon('close')}</button></div>
                <div class="chat-media-preview"><span aria-hidden="true">${uiIcon("plus")}</span><p>Choose a photo or video.</p></div>
                <div class="chat-review-tools" data-review-tools hidden><button type="button" data-photo-cutout aria-label="Make a sticker from this photo">${uiIcon('scissors')}</button><button type="button" data-photo-stickers aria-label="Open My Stickers"><span class="native-sticker-icon" aria-hidden="true"></span></button><button type="button" data-photo-text aria-label="Add or edit caption">Aa</button><button type="button" data-photo-draw aria-label="Draw on this" aria-pressed="false"></button><button type="button" class="review-view-once" data-chat-view-once role="switch" aria-checked="true" aria-label="View once"><span class="view-once-glyph" aria-hidden="true"></span></button><div class="review-draw-tools" hidden></div><button type="button" data-undo-zoom aria-label="Undo zoom" hidden>${uiIcon('back')}</button></div>
                <div class="view-once-hint" role="status" hidden></div>
                <p class="chat-media-send-count" hidden></p>
                <div class="chat-media-progress hidden"><span></span></div>
                <p class="chat-media-status" role="status"></p>
                <div class="chat-media-review-actions"><button type="button" class="review-save" data-save-chat-media aria-label="Save"><span class="review-save-circle">${uiIcon('save-down')}</span><small>Save</small></button><span class="review-send-chip" data-send-to-chip role="note"><span class="review-chip-avatar" aria-hidden="true"></span><strong></strong></span><button class="primary-button chat-media-publish send-pill" type="submit" disabled><span class="send-pill-copy"><span class="send-pill-title">Send</span><small class="send-pill-subtitle">View once</small></span>${uiIcon('send')}</button></div>
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
    const notificationNudge = createNotificationNudge({
        notifications,
        getUserId: () => getUser()?.id,
        slots: {
            conversation: () => $('[data-nudge-slot="conversation"]'),
            inbox: () => $('[data-nudge-slot="inbox"]'),
        },
        showToast,
    });
    notificationNudge.bind();
    addEventListener("valid:web-push-status", () => notificationNudge.refresh());
    let mementoCamera = null;
    let mementoCameraToken = 0;
    async function ensureMementoCamera() {
        if (mementoCamera) return mementoCamera;
        const { createLiveCamera, ensureCameraStyles } = await loadLiveCamera();
        await ensureCameraStyles();
        // The Memento camera: back camera first, then the front one, with no
        // lenses, flip or library (MementoSequentialCameraView).
        mementoCamera ||= createLiveCamera({
            container: $('[data-memento-camera]'),
            maxDimension: 1600,
            haptic: cameraHaptic,
            memento: true,
            onCapture: async ([first, second]) => {
                $('[data-memento-dialog]').classList.remove('is-capturing');
                selectedMementoSourceFile = first;
                selectedMementoSecondarySourceFile = second || null;
                mementoFrontIsPrimary = false;
                await prepareSelectedMemento(first);
            },
            onFallback: () => {},
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
        // The preview card's labeled row: Delete · Record again · Send.
        $('.chat-voice-preview-actions').hidden = !ready;
        $('[data-cancel-voice]').hidden = ready;
        $('.chat-voice-inline').classList.toggle('is-preview', ready);
        if (ready && audio.getAttribute('src') !== selectedChatMediaPreview) audio.src = selectedChatMediaPreview;
        if (!voiceMode) { audio.pause(); audio.removeAttribute('src'); }
        $('[data-send-voice]').disabled = !ready || chatMediaPublishing;
        $('[data-cancel-voice]').disabled = chatMediaPublishing;
        $('[data-delete-voice]').disabled = chatMediaPublishing;
        $('[data-record-again]').disabled = chatMediaPublishing;
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
                    container: $('[data-chat-camera]'), singlePhoto: true, aspect: 'fill',
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
    async function startMementoCamera() {
        if (mementoPublishing) return;
        resetMementoComposer();
        const token = ++mementoCameraToken;
        const streamRequest = mementoCamera ? null : cameraStreamRequest('environment');
        $('[data-memento-dialog]').classList.add('is-capturing');
        try {
            await ensureMementoCamera();
        } catch (_) {
            releaseStreamRequest(streamRequest);
            if (token !== mementoCameraToken) return;
            $('[data-memento-dialog]').classList.remove('is-capturing');
            $(".memento-status").textContent = "The camera needs a connection to load. Reconnect and try again.";
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
        $('[data-clear-chat-search]').hidden = true;
        searchSubmitted = false; searchResponse = null; searchError = ''; searchLoading = false;
        renderRecentConversations();
        renderSayHi();
        $('[data-focus-chat-search]').focus({ preventScroll: true });
    }
    // Results follow the typing (ChatSearchResultsView); Return searches everything.
    $('.chat-search-form input').addEventListener('input', () => searchInput());
    $('[data-clear-chat-search]').addEventListener('click', () => {
        $('.chat-search-form input').value = '';
        searchInput();
        $('.chat-search-form input').focus();
    });
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
    // A chat never locks (ChatMementoRevealPolicy): only friends' Mementos from
    // today wait for the viewer's own. The server's view_gate_locked is ignored
    // in rooms, as iOS ignores it.
    const chatAccessUnavailable = () => false;

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
    $(".chat-person-search input").addEventListener("input", () => { if (creation && !creation.loading) renderCreationPeople(); });
    $(".chat-create-screen").addEventListener("input", event => {
        if (!creation) return;
        if (event.target.matches('[data-group-name]')) { creation.groupName = event.target.value; renderCreationBar(); }
        if (event.target.matches('[data-separate-message]')) creation.message = event.target.value;
    });
    $(".chat-create-screen").addEventListener("change", event => {
        if (!creation || !event.target.matches('[data-group-photo]')) return;
        const [file] = event.target.files || [];
        if (!file) return;
        if (creation.groupPhotoURL) URL.revokeObjectURL(creation.groupPhotoURL);
        creation.groupPhoto = file;
        creation.groupPhotoURL = URL.createObjectURL(file);
        renderGroupDetails();
    });
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
    $("[data-chat-view-once]").addEventListener("click", () => {
        if (chatMediaPublishing) return;
        setChatViewOnce(!chatViewOnce, { hint: true });
        resetChatMediaRequestIds();
        feedback('light');
    });
    $('.chat-composer textarea').addEventListener('focus', () => $('.chat-room-screen').classList.add('composer-focused'));
    $('.chat-composer textarea').addEventListener('blur', () => $('.chat-room-screen').classList.remove('composer-focused'));
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
        // A room's card is shown again on every open (openChat); leaving hides it.
        if (name !== "room") notificationNudge.roomHidden();
        notificationNudge.setInboxVisible(name === "list");
        if (name === "room") syncVoiceComposer();
        observePresence();
        reportActiveChat();
    }

    // Rows whose text the outbox could not deliver read "Didn't send · Tap to retry".
    async function refreshFailedChats() {
        const records = await listChatTextOutbox(userId()).catch(() => []);
        failedChatIds.clear();
        for (const record of records) if (Number(record.attempts || 0) > 0) failedChatIds.add(String(record.chat_id));
    }

    async function loadChats({ quiet = false } = {}) {
        if (!userId() || store.state.loadingList) return;
        store.state.loadingList = true;
        if (!quiet) $(".chat-list-status").textContent = store.state.chats.length ? "Refreshing…" : "Loading chats…";
        try {
            const response = await api.getChats(userId(), 100, 0);
            store.replaceChats(response.items || response || []);
            lastListLoad = Date.now();
            await refreshFailedChats();
            renderChatList();
            void loadSayHi();
            if (store.state.activeChatId) renderMementoToolbar();
        } catch (error) {
            $(".chat-list-status").textContent = userMessage(error, "Could not load chats.");
        } finally {
            store.state.loadingList = false;
        }
    }

    const callsEnabledForRows = () => getConfig()?.enable_calls === true && getConfig()?.enable_web_calls === true;

    function renderChatList() {
        renderRecentConversations();
        renderSayHi();
        const list = $(".chat-list");
        $(".chat-list-status").textContent = "";
        const entries = store.state.chats.map((chat) => ({ key: chat.id, html: chatRowMarkup(chat) }));
        if (!entries.length) {
            // Hidden while the Say hi card has someone to wave at (ChatListView).
            list.innerHTML = sayHiVisible().length ? "" : `<article class="chat-empty"><span class="chat-empty-icon" aria-hidden="true">${uiIcon("chat-pair-filled")}</span><h2>No chats yet</h2><button class="primary-button" type="button" data-new-chat>${uiIcon("compose")}<span>Start a chat</span></button></article>`;
        } else {
            reconcileKeyedElements(list, entries);
        }
        const unread = store.state.chats.reduce((total, chat) => total + Number(chat.unread_count || 0), 0);
        onUnreadChange?.(unread);
        observePresence();
        scheduleStreakTicker();
    }

    // The hourglass and countdowns move with the clock: redraw once a minute
    // while some chat's streak is at risk, never on a standing interval.
    function scheduleStreakTicker() {
        clearTimeout(streakTicker);
        streakTicker = null;
        const now = new Date();
        const room = store.state.detail?.chat;
        const atRisk = store.state.chats.some(chat => streakAtRisk(chat)) || streakAtRisk(room);
        if (!atRisk || !activation || document.hidden) return;
        const left = streakTimeLeft(true, now);
        const delay = left == null ? Math.max(1_000, nextMidnightWindowStart(now) - now) : 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50;
        streakTicker = setTimeout(() => {
            streakTicker = null;
            if (!$('[data-chat-screen=list]').classList.contains('hidden')) reconcileKeyedElements($(".chat-list"), store.state.chats.map((chat) => ({ key: chat.id, html: chatRowMarkup(chat) })));
            if (store.state.activeChatId) renderMementoToolbar();
            scheduleStreakTicker();
        }, Math.min(delay, 2_147_000_000));
    }

    function nextMidnightWindowStart(now) {
        const end = new Date(now);
        end.setHours(24, 0, 0, 0);
        return end.getTime() - 4 * 60 * 60_000;
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

    // ChatRecentStripOrder: active now first, then most recently active, then
    // inbox order. Decided when the list renders, never on a presence tick.
    function recentStripOrder(chats) {
        if (!presence) return chats;
        const now = presence.serverNow?.();
        const rank = chat => {
            if (!eligibleForPresence(chat) || now == null) return { tier: 2, at: 0 };
            const peers = presence.members(chat.id).filter(member => String(member.user_id) !== String(userId()));
            if (peers.some(member => Number.isFinite(member.active_until) && member.active_until > now)) return { tier: 0, at: 0 };
            const at = Math.max(0, ...peers.map(member => Number(member.last_active_at) || 0));
            return at > 0 ? { tier: 1, at } : { tier: 2, at: 0 };
        };
        const ranked = chats.map((chat, index) => ({ chat, index, ...rank(chat) }));
        return ranked.sort((a, b) => a.tier - b.tier || b.at - a.at || a.index - b.index).map(item => item.chat);
    }

    function renderRecentConversations() {
        const chats = recentStripOrder(recentConversations(store.state.chats));
        $(".chat-recent").classList.toggle("hidden", !chats.length || !$(".chat-search-results").classList.contains("hidden"));
        reconcileKeyedElements($(".chat-recent-rail"), chats.map(chat => {
            const isGroup = isGroupChatSummary(chat);
            const name = isGroup ? chat.display_name : (chat.pair_display_name || chat.display_name).split(/\s+/)[0];
            const unread = Math.max(0, Number(chat.unread_count) || 0);
            const hint = unread ? `${unread} unread` : "";
            const url = new URL(location.href);
            url.search = "";
            // Preserve the local demo context; deployed URLs only contain the route.
            const current = new URLSearchParams(location.search);
            if (current.get('demo') === '1') url.searchParams.set('demo', '1');
            url.searchParams.set('tab', 'chats');
            url.searchParams.set('chat', chat.id);
            const html = `<a class="chat-recent-link ${attentionPriority(chat) > 1 ? "attention" : ""}" aria-describedby="chat-presence-${escapeChatHTML(chat.id)}" data-presence-watch="${escapeChatHTML(chat.id)}" data-list-key="${escapeChatHTML(chat.id)}" data-open-chat="${escapeChatHTML(chat.id)}" href="${escapeChatHTML(url.pathname + url.search)}" aria-label="${escapeChatHTML(chat.display_name)}${hint ? `, ${escapeChatHTML(hint)}` : ""}"><span class="chat-recent-avatar">${conversationAvatarMarkup(chat)}<i class="chat-presence-dot" role="img" data-presence-dot="${escapeChatHTML(chat.id)}" aria-label="Active now" hidden></i>${unread ? '<i class="chat-recent-unread" aria-hidden="true"></i>' : ''}</span><span class="chat-recent-name">${escapeChatHTML(name)}</span><small id="chat-presence-${escapeChatHTML(chat.id)}" class="chat-presence-label" data-presence-label="${escapeChatHTML(chat.id)}" hidden></small></a>`;
            return { key: chat.id, html };
        }));
    }

    // ---- Say hi (SayHiInboxCard / SayHiModel) -----------------------------
    function sayHiKey(kind) { return `valid.sayHi.${kind}.${userId()}`; }
    function readSayHiStore(kind, fallback) {
        try { return JSON.parse(localStorage.getItem(sayHiKey(kind)) || 'null') ?? fallback; } catch (_) { return fallback; }
    }
    function writeSayHiStore(kind, value) {
        try { localStorage.setItem(sayHiKey(kind), JSON.stringify(value)); } catch (_) { /* per-device convenience */ }
    }
    function sayHiDismissed() {
        const at = Number(readSayHiStore('dismissedAt', 0));
        return at > 0 && Date.now() - at < SAY_HI_DISMISS_MS;
    }
    function sayHiVisible() {
        if (sayHi.userId !== userId() || sayHiDismissed()) return [];
        const waved = new Set(readSayHiStore('waved', []));
        return sayHi.items.filter(friend => !waved.has(String(friend.user_id)) || sayHi.statuses.has(String(friend.user_id))).slice(0, 3);
    }

    async function loadSayHi() {
        const uid = userId();
        if (!uid || sayHiDismissed() || typeof api.getSayHiSuggestions !== 'function') return;
        if (sayHi.userId !== uid) sayHi = { userId: uid, items: [], loadedAt: 0, statuses: new Map(), chats: new Map(), loading: false };
        if (sayHi.loading || Date.now() - sayHi.loadedAt < SAY_HI_RELOAD_MS) return;
        sayHi.loading = true;
        try {
            const response = await api.getSayHiSuggestions(uid, 5);
            if (uid !== userId()) return;
            sayHi.items = Array.isArray(response?.items) ? response.items : [];
            sayHi.loadedAt = Date.now();
            renderChatList();
        } catch (_) {
            // The card is optional: no friends to wave at means no card.
        } finally {
            sayHi.loading = false;
        }
    }

    function renderSayHi() {
        const section = $(".chat-say-hi");
        const friends = sayHiVisible();
        const searching = !$(".chat-search-results").classList.contains("hidden");
        section.classList.toggle("hidden", !friends.length || searching);
        if (!friends.length) { section.innerHTML = ""; return; }
        section.innerHTML = `<header><h2 id="chatSayHiTitle">Say hi to friends on Valid</h2><button type="button" class="chat-say-hi-dismiss" data-dismiss-say-hi aria-label="Hide for a week">${uiIcon('close')}</button></header>${friends.map(friend => {
            const id = String(friend.user_id);
            const status = sayHi.statuses.get(id);
            const image = safeMediaURL(friend.avatar_url, api);
            const initial = String(friend.first_name || friend.display_name || "F").slice(0, 1).toUpperCase();
            const subtitle = status === 'sent' ? `You said hi ${SAY_HI_WAVE}` : status === 'failed' ? "Didn't send. Try again" : friend.voted_today ? "On Valid today" : "On Valid this week";
            const button = status === 'sending' ? `<span class="chat-say-hi-progress" role="status" aria-label="Sending"></span>`
                : status === 'sent' ? (sayHi.chats.has(id) ? `<button type="button" class="chat-say-hi-button open" data-open-say-hi="${escapeChatHTML(id)}">Open</button>` : `<span class="chat-say-hi-sent">Sent</span>`)
                : `<button type="button" class="chat-say-hi-button" data-say-hi="${escapeChatHTML(id)}">${SAY_HI_WAVE} Say hi</button>`;
            return `<div class="chat-say-hi-row"><span class="chat-avatar chat-say-hi-avatar">${image ? mediaImageMarkup(image, { initials: initial }) : `<span>${escapeChatHTML(initial)}</span>`}</span><span class="chat-say-hi-copy"><strong>${escapeChatHTML(friend.display_name || friend.first_name)}</strong><small>${escapeChatHTML(subtitle)}</small></span>${button}</div>`;
        }).join("")}`;
    }

    // Starts the 1:1 (or reuses it) and sends a wave through the text path.
    async function sendSayHi(friendId) {
        const friend = sayHi.items.find(item => String(item.user_id) === friendId);
        if (!friend || ['sending', 'sent'].includes(sayHi.statuses.get(friendId))) return;
        sayHi.statuses.set(friendId, 'sending');
        renderSayHi();
        feedback('light');
        const ids = sayHi.requestIds?.get(friendId) || { chat: crypto.randomUUID(), text: crypto.randomUUID() };
        (sayHi.requestIds ||= new Map()).set(friendId, ids);
        try {
            const chat = await api.createChat(userId(), [friendId], null, ids.chat, 'say_hi_inbox');
            if (chat?.membership_status === 'accepted') {
                await api.sendChatMessage(userId(), chat.id, { body: SAY_HI_WAVE, client_request_id: ids.text, reply_to_message_id: null });
            }
            store.upsertChat(chat);
            sayHi.chats.set(friendId, chat);
            sayHi.statuses.set(friendId, 'sent');
            const waved = readSayHiStore('waved', []).filter(id => id !== friendId);
            writeSayHiStore('waved', [...waved, friendId].slice(-100));
            successHaptic?.();
            scheduleChatRowRefresh(String(chat.id));
        } catch (_) {
            sayHi.statuses.set(friendId, 'failed');
        }
        renderChatList();
    }

    function dismissSayHi() {
        writeSayHiStore('dismissedAt', Date.now());
        renderChatList();
    }

    // ---- Search (ChatSearchResultsView) ------------------------------------
    let searchSubmitted = false;
    let searchResponse = null;
    let searchError = '';
    let searchLoading = false;

    function localSearchChats(query) {
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        if (!terms.length) return [];
        return store.state.chats.filter(chat => {
            const members = (chat.member_previews || []).flatMap(member => [displayMember(member), member.username || ""]);
            const corpus = [chat.display_name, chat.pair_display_name || "", chat.last_message_body || "", ...members].join(" ").toLowerCase();
            return terms.every(term => corpus.includes(term));
        });
    }

    function renderSearchResults() {
        const query = $(".chat-search-form input").value.trim();
        const results = $(".chat-search-results");
        $('[data-clear-chat-search]').hidden = !query;
        if (!query) {
            results.classList.add("hidden");
            $(".chat-list").classList.remove("hidden");
            renderRecentConversations();
            renderSayHi();
            $(".chat-list-status").textContent = '';
            return;
        }
        const local = localSearchChats(query);
        const localIds = new Set(local.map(chat => chat.id));
        const remoteChats = (searchResponse?.chats?.items || []).filter(item => !localIds.has(String(item.chat_id || item.id)));
        const remoteMessages = searchResponse?.messages?.items || [];
        const hasResults = local.length || remoteChats.length || remoteMessages.length;
        const resultRow = (item, messageId = null) => `<article class="chat-row chat-search-row"><button class="chat-row-main" type="button" data-search-chat="${escapeChatHTML(item.chat_id)}" ${messageId ? `data-search-message="${escapeChatHTML(messageId)}"` : ''}><span class="chat-avatar-wrap"><span class="chat-avatar"><span>${escapeChatHTML(String(item.title || "C").slice(0, 1).toUpperCase())}</span></span></span><span class="chat-row-copy"><span class="chat-row-title"><strong>${escapeChatHTML(item.title || "Chat")}</strong></span><span class="chat-status-line plain"><span class="chat-status-text">${escapeChatHTML(item.snippet || item.subtitle || "")}</span></span></span></button></article>`;
        let html = '';
        if (local.length || remoteChats.length) html += `<h2>Chats</h2>${local.map(chatRowMarkup).join('')}${remoteChats.map(item => resultRow(item)).join('')}`;
        if (remoteMessages.length) html += `<h2>Messages</h2>${remoteMessages.map(item => resultRow(item, item.id)).join('')}`;
        if (!searchSubmitted && query.length >= 2) html += `<button type="button" class="chat-search-all" data-search-all><span class="chat-search-all-icon" aria-hidden="true">${uiIcon('text-search')}</span><span><strong>Search all chats &amp; messages</strong><small>Look through older message history for “${escapeChatHTML(query)}”</small></span>${uiIcon('arrow-right')}</button>`;
        if (!hasResults && (searchSubmitted || query.length < 2)) {
            html += searchLoading
                ? `<div class="chat-search-state" role="status"><p>Searching all chats and messages…</p></div>`
                : `<div class="chat-search-state" role="status"><span aria-hidden="true">${uiIcon('search')}</span><h3>${query.length < 2 ? "Keep typing" : "No results found"}</h3><p>${escapeChatHTML(searchError || (query.length < 2 ? "Type at least two characters to search message history." : `No chats or messages matched “${query}”.`))}</p></div>`;
        } else if (searchLoading) html += `<p class="chat-search-loading" role="status">Searching all chats and messages…</p>`;
        else if (searchError) html += `<p class="chat-search-loading" role="status">${escapeChatHTML(searchError)}</p>`;
        results.innerHTML = html;
        results.classList.remove("hidden");
        $(".chat-list").classList.add("hidden");
        $(".chat-recent").classList.add("hidden");
        $(".chat-say-hi").classList.add("hidden");
        $(".chat-list-status").textContent = '';
    }

    function searchInput() {
        searchGeneration++;
        searchSubmitted = false;
        searchResponse = null;
        searchError = '';
        searchLoading = false;
        renderSearchResults();
    }

    async function searchChats(event) {
        event?.preventDefault?.();
        const query = $(".chat-search-form input").value.trim();
        if (query.length < 2) { searchSubmitted = true; renderSearchResults(); return; }
        const generation = ++searchGeneration;
        searchSubmitted = true;
        searchLoading = true;
        searchError = '';
        renderSearchResults();
        try {
            const response = await api.searchChats(userId(), query, 8);
            if (generation !== searchGeneration) return;
            searchResponse = response;
        } catch (error) {
            if (generation !== searchGeneration) return;
            searchError = userMessage(error, "Could not search chats.");
        } finally {
            if (generation === searchGeneration) { searchLoading = false; renderSearchResults(); }
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

    // ChatInboxListRow: avatar with the CHAT badge, name and streak, then the
    // status line; the right column keeps the unread capsule or a row button.
    function chatRowMarkup(chat) {
        const avatar = conversationAvatarMarkup(chat);
        const invited = chat.membership_status === "invited";
        const callsEnabled = callsEnabledForRows();
        const status = chatInboxStatus(chat, { callsEnabled, hasSendFailure: failedChatIds.has(chat.id), isSending: (sendingChatCounts.get(chat.id) || 0) > 0 });
        const pending = !invited && Number(chat.unopened_view_once_count) > 0 && chat.next_view_once_room_sequence != null;
        const missed = !invited && callsEnabled && chat.unacknowledged_missed_call_id;
        const count = Number(chat.unopened_view_once_count);
        const trailing = missed ? `<button type="button" class="chat-inbox-action missed" data-return-missed-call="${escapeChatHTML(chat.id)}">${uiIcon(chat.unacknowledged_missed_call_media_type === 'video' ? 'video' : 'phone')} Call back</button>`
            : pending ? `<button type="button" class="chat-inbox-action" data-pending-media="${escapeChatHTML(chat.id)}" aria-label="View ${count} unopened ${count === 1 ? 'snap' : 'snaps'}"><i class="${chat.next_view_once_kind === 'video' ? 'video' : 'photo'}"></i>View ${count}</button>` : '';
        const unread = Math.max(0, Number(chat.regular_unread_count) || 0);
        const badge = trailing ? '' : unread ? `<b class="chat-unread" aria-label="${unread} unread messages">${unread > 99 ? '99+' : unread}</b>`
            : invited && chat.has_viewer_blocked_member === true ? `<span class="chat-row-warning" role="img" aria-label="Invitation includes a blocked person">!</span>` : '';
        const attention = attentionPriority(chat) > 1;
        const presenceAttributes = eligibleForPresence(chat) ? `data-presence-watch="${escapeChatHTML(chat.id)}"` : "";
        return `<article class="chat-row ${attention ? "attention" : ""} ${invited ? "invitation" : ""} ${trailing ? 'has-inbox-action' : ''}" data-list-key="${escapeChatHTML(chat.id)}"><button class="chat-row-main" type="button" data-open-chat="${escapeChatHTML(chat.id)}"><span class="chat-avatar-wrap" ${presenceAttributes}><span class="chat-avatar">${avatar}</span><i class="inbox-content-badge chat" aria-hidden="true">CHAT</i>${eligibleForPresence(chat) ? `<i class="chat-presence-dot" role="img" data-presence-dot="${escapeChatHTML(chat.id)}" aria-label="Active now" hidden></i>` : ""}</span><span class="chat-row-copy"><span class="chat-row-title"><strong>${escapeChatHTML(chat.display_name)}</strong>${streakLabelMarkup(chat)}</span>${inboxStatusLineMarkup(status, chat)}</span><span class="chat-row-trailing">${badge}</span></button>${trailing}</article>`;
    }

    async function openChat(chatId, { updateHistory = true, force = false, latest = false } = {}) {
        // Warm the camera module (precached) so the camera button opens at once.
        if (!cameraWarmed) {
            cameraWarmed = true;
            setTimeout(() => { void loadLiveCamera().then((module) => module.ensureCameraStyles()).catch(() => { cameraWarmed = false; }); }, 600);
        }
        const chat = store.state.chats.find((item) => item.id === String(chatId));
        // An invitation opens its review screen (ChatInvitationReviewView).
        if (chat?.membership_status === "invited") return openInvitation(chat, { updateHistory });
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
        notificationNudge.roomShown();
        $(".chat-room-status").textContent = "";
        renderRoomHeader(chat || { display_name: "Chat", accepted_count: 0 });
        if (updateHistory) pushRoomHistory(chatId);
        // Fixed for the visit: the viewer's read position when the room opened.
        if (!savedAnchor && unreadAnchor.chatId !== String(chatId)) {
            const boundary = Number(chat?.last_read_sequence || 0);
            const unseen = chat && Number(chat.last_room_sequence || 0) > boundary && !latest && !new URLSearchParams(location.search).get('message');
            unreadAnchor = { chatId: String(chatId), boundary, dividerId: null, anchored: false, active: Boolean(unseen), farBack: unseen && Number(chat.last_room_sequence) - boundary > 45 };
        }
        const unreadPage = !savedAnchor && unreadAnchor.chatId === String(chatId) && unreadAnchor.active && unreadAnchor.farBack && !unreadAnchor.decided;
        // Establish the initial viewport synchronously before the first paint.
        // Only an already-open room being refreshed retains a reading anchor.
        renderMessages(!savedAnchor);
        if (savedAnchor) timelineScroll.restore(savedPosition);
        const [detailResult, messagesResult, dailyResult] = await Promise.allSettled([
            api.getChat(userId(), chatId),
            api.getChatMessages(userId(), chatId, savedAnchor ? { limit: 100, afterSequence: Math.max(0, Math.floor(savedAnchor.room_sequence) - 1) }
                : unreadPage ? { limit: 100, afterSequence: Math.max(0, unreadAnchor.boundary - 3) } : { limit: 50 }),
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
            if (savedAnchor || unreadPage) {
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
        const anchoredAtUnread = !savedAnchor && anchorAtFirstUnread(String(chatId));
        focusDeepLinkedMessage(chatId);
        renderSettings();
        updatePresenceAudience();
        if (!savedAnchor && !anchoredAtUnread) await markRoomRead();
        scheduleChatRowRefresh(String(chatId), 0);
        if (!chatAccessUnavailable()) void retryPendingMessages(chatId);
        const deepLink = new URLSearchParams(location.search);
        const requestedCallId = deepLink.get("call");
        if (requestedCallId) {
            const answer = deepLink.get("answer") === "1";
            if (answer) {
                // Answer once: a reload or Back must not join again.
                const url = new URL(location.href);
                url.searchParams.delete("answer");
                history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
            }
            void calls.open(requestedCallId, { answer });
        }
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

    // ChatRoomView+Chrome.pendingHeaderText: "Waiting on Maya" / "N invited".
    function pendingHeaderText(chat) {
        const pending = Number(chat?.pending_count || 0);
        if (pending <= 0) return null;
        if (pending === 1) {
            const member = (store.state.detail?.members || []).find(item => item.status === 'invited' && String(item.user_id) !== String(userId()));
            const first = member ? (member.first_name || displayMember(member).split(/\s+/)[0]) : '';
            return first ? `Waiting on ${first}` : "1 person invited";
        }
        return `${pending} invited`;
    }

    function renderRoomPresence(chat) {
        const subtitle = $(".chat-room-title small");
        const pending = pendingHeaderText(chat);
        const activity = !pending && eligibleForPresence(chat) ? presence?.status(chat.id, isGroupChat(chat)) : null;
        const members = Number(chat?.accepted_count || 0);
        // ChatHeaderPresence: "5 members · 2 active now" for a group.
        const label = store.state.typingUserIds.size ? 'typing…' : pending
            || (isGroupChat(chat) ? `${members} members${activity?.label ? ` · ${activity.label}` : ''}` : activity?.label || '');
        if (subtitle.textContent !== label) subtitle.textContent = label;
        subtitle.classList.toggle('is-pending', Boolean(pending) && !store.state.typingUserIds.size);
        const active = !!activity?.active && !store.state.typingUserIds.size;
        if (subtitle.classList.contains('is-active') !== active) subtitle.classList.toggle('is-active', active);
    }

    // The room's Memento chrome: the compact "Take a Memento" card above the
    // composer (ChatMementoCaptureCard), the invite reminder under the header
    // and the toolbar pill. Nothing here ever locks the room.
    function offersMementoCapture() {
        const chat = store.state.chats.find(item => item.id === store.state.activeChatId) || store.state.detail?.chat;
        if (!dailyLedgerEnabled() || !chat || chat.membership_status !== 'accepted') return false;
        const row = store.state.dailyRow;
        const eligible = row ? row.viewer_is_eligible !== false : chat.is_memento_eligible_today !== false;
        if (!eligible) return false;
        if (mementoSentToday.get(String(chat.id)) === localLedgerDate()) return false;
        return !(row ? row.viewer_has_shared === true : chat.has_posted_today_memento === true);
    }

    function renderDailyRow() {
        const card = $('.chat-memento-capture');
        card.classList.toggle('hidden', !offersMementoCapture() || mementoPublishing);
        renderInviteReminder();
        renderMementoToolbar();
        if ($('[data-memento-gallery-dialog]').open) renderMementoGallery();
    }

    // "Waiting for Maya to accept" with a way to nudge them. The web has no
    // contact numbers, so the share sheet (or a copied invite) stands in for Text.
    function renderInviteReminder() {
        const node = $('.chat-invite-reminder');
        const chat = store.state.detail?.chat;
        const member = (store.state.detail?.members || []).find(item => item.status === 'invited' && String(item.user_id) !== String(userId()) && item.is_blocked_by_viewer !== true);
        const show = Boolean(chat && member && Number(chat.pending_count) > 0);
        node.classList.toggle('hidden', !show);
        if (!show) { node.innerHTML = ''; return; }
        const first = member.first_name || displayMember(member).split(/\s+/)[0];
        node.innerHTML = `<span>Waiting for ${escapeChatHTML(first)} to accept</span><button type="button" data-remind-invite>${uiIcon('chat')}<span>Text ${escapeChatHTML(first)}</span></button>`;
    }

    async function remindInvite() {
        const chat = store.state.detail?.chat;
        if (!chat) return;
        const text = `I invited you to ${chat.display_name} on Valid — open Chats and accept my invite so we can chat!`;
        const url = new URL('/app/?tab=chats', location.origin).href;
        try {
            if (navigator.share) await navigator.share({ text, url });
            else { await navigator.clipboard.writeText(`${text} ${url}`); showToast?.('Invite copied'); }
        } catch (_) { /* The person closed the share sheet. */ }
    }

    // ChatRoomMementoToolbarLabel: always there while Mementos are on. The left
    // slot is the countdown while the streak is at risk, "Save streak" while it
    // is broken, otherwise today's posted / eligible.
    function renderMementoToolbar() {
        const row = store.state.dailyRow;
        const button = $('[data-open-memento-gallery]');
        const chat = store.state.chats.find(c => c.id === store.state.activeChatId) || store.state.detail?.chat;
        const visible = dailyLedgerEnabled() && Boolean(chat) && chat.membership_status === 'accepted';
        button.classList.toggle('hidden', !visible);
        if (!visible) { button.innerHTML = ''; return; }
        const sentHere = mementoSentToday.get(String(chat.id)) === localLedgerDate();
        const eligible = Math.max(0, Math.floor(Number(row ? row.eligible_count : chat.today_memento_eligible_count) || 0));
        const postedRaw = Math.max(0, Math.floor(Number(row ? row.posted_count : chat.today_memento_count) || 0)) + (sentHere && !(row?.viewer_has_shared) ? 1 : 0);
        const posted = Math.min(eligible, postedRaw);
        const streak = Math.max(0, Number(chat.moment_streak) || 0);
        const viewerPosted = sentHere || row?.viewer_has_shared === true || chat.has_posted_today_memento === true;
        const atRisk = streakAtRisk(chat) && !viewerPosted;
        const broken = streakBroken(chat) && !viewerPosted;
        const left = streakTimeLeft(atRisk);
        const leading = left != null
            ? `<span class="streak-risk${streakIsFinalHour(left) ? ' final-hour' : ''}">${hourglassMarkup(left, 13)}<b>${escapeChatHTML(streakCountdown(left))}</b></span>`
            : broken ? `<b class="chat-save-streak">Save streak</b>`
            : `${uiIcon('memento')}<b>${posted}/${eligible}</b>`;
        button.innerHTML = `<span class="chat-memento-toolbar-pill">${leading}<i class="chat-memento-toolbar-rule" aria-hidden="true"></i><span class="chat-moment-streak${broken ? ' broken' : ''}">${uiIcon('fire')}<b>${streak}</b></span></span>`;
        button.classList.toggle('complete', eligible > 0 && posted === eligible);
        const waiting = (row?.entries || []).filter(entry => !entry.has_posted).map(entry => entry.first_name || 'a member').join(', ');
        const streakText = streak > 0 ? `, ${streakAccessibilityLabel(streak, { broken, atRisk })}` : '';
        button.setAttribute('aria-label', `Mementos, ${posted} of ${eligible} captured.${waiting ? ` Waiting for ${waiting}.` : ''}${left != null ? ` ${streakCountdown(left)} left.` : ''}${streakText}`);
    }

    function openMementoGallery() {
        if (!dailyLedgerEnabled() || !store.state.dailyRow) return;
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
        const context = { latestOutgoingId: latestOutgoing?.id || null, groupReceipts: acceptedOthers.length > 1, revealsToday: mementosRevealedToday(), today: localLedgerDate() };
        const dividerId = unreadDividerId(items, mineMessage);
        visible.items.forEach((message, visibleIndex) => {
            const index = visible.start + visibleIndex;
            const separator = chatSeparatorBefore(message, items[index - 1]);
            if (separator) entries.push({
                key: `sep:${message.id}`,
                html: `<div class="chat-day-separator" role="presentation" data-list-key="sep:${escapeChatHTML(message.id)}"><time datetime="${escapeChatHTML(separator.at)}"><strong>${escapeChatHTML(separator.day)}</strong> ${escapeChatHTML(separator.time)}</time></div>`,
            });
            if (message.id === dividerId) entries.push({
                key: "unread:divider",
                html: `<div class="chat-unread-divider" role="separator" aria-label="New messages" data-list-key="unread:divider"><span>New messages</span></div>`,
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
        // ChatRoomEmptyConversation: a new chat opens on words, not a camera.
        if (!items.length && store.state.loadingRoom) timeline.innerHTML = `<div class="chat-room-empty"><p>Loading messages…</p></div>`;
        else if (!items.length) {
            const cleared = Boolean(store.state.detail?.chat?.history_cleared_at);
            timeline.innerHTML = `<div class="chat-room-empty"><span class="chat-room-empty-icon" aria-hidden="true">${uiIcon('chat')}</span><strong>${cleared ? "History cleared" : `Say hi ${SAY_HI_WAVE}`}</strong><p>${cleared ? "You\u2019re still in the chat. Send a message to keep talking." : "Your conversation starts here."}</p></div>`;
        }
        renderReplyDraft();
        timelineScroll.restore(position, { bottom: scrollToBottom || (!preservePosition && !focusMessageId && position.bottom && !visible.hiddenAfter && !historyHasNewer) });
        timelineScroll.observe();
        requestAnimationFrame(recordVisibleHistory);
        scheduleVideoRefreshes();
        scheduleHistorySweep();
    }

    // ChatMementoRevealPolicy.revealsToday: the viewer's own post today
    // (counted from Send) reveals friends' Mementos; a cached row can reveal
    // but the chat summary decides until today's row arrives.
    function mementosRevealedToday(chatId = store.state.activeChatId) {
        if (!dailyLedgerEnabled()) return true;
        if (mementoSentToday.get(String(chatId)) === localLedgerDate()) return true;
        const row = store.state.dailyRow;
        if (row && row.ledger_date === localLedgerDate()) return row.viewer_has_shared === true || row.viewer_is_eligible === false;
        const chat = store.state.chats.find(item => item.id === String(chatId)) || store.state.detail?.chat;
        return chat?.has_posted_today_memento === true || chat?.is_memento_eligible_today === false;
    }

    // The row the "New messages" divider sits above: the first message after
    // the read position when the room opened, never the viewer's own.
    function unreadDividerId(items, mine) {
        if (unreadAnchor.chatId !== store.state.activeChatId || !unreadAnchor.active) return null;
        if (unreadAnchor.dividerId && items.some(item => item.id === unreadAnchor.dividerId)) return unreadAnchor.dividerId;
        const first = items.find(item => Number(item.room_sequence) > unreadAnchor.boundary && !mine(item) && item.kind !== 'system' && item.status === 'active' && !String(item.id).startsWith('pending:'));
        unreadAnchor.dividerId = first?.id || null;
        return unreadAnchor.dividerId;
    }

    // ChatRoomUnreadAnchorPolicy: when the unread rows fill more than a screen,
    // open at the first of them instead of the latest message.
    function anchorAtFirstUnread(chatId) {
        if (unreadAnchor.chatId !== chatId || !unreadAnchor.active || unreadAnchor.decided) return false;
        unreadAnchor.decided = true;
        const divider = $('.chat-unread-divider');
        const timeline = $('.chat-timeline');
        if (!divider || !timeline.clientHeight) return false;
        const top = divider.getBoundingClientRect().top - timeline.getBoundingClientRect().top + timeline.scrollTop;
        if (timeline.scrollHeight - top <= timeline.clientHeight) return false;
        timeline.scrollTop = Math.max(0, top - 8);
        timelineScroll.restore(timelineScroll.capture());
        unreadAnchor.anchored = true;
        updateLatestButton();
        return true;
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

    // A friend's Memento from today, blurred until the viewer posts theirs
    // (ChatMessageBubble+Content hiddenMementoImage). Drawn from the ThumbHash
    // or the small rendition, never the photo itself.
    function hiddenMementoMarkup(message) {
        const backdrop = thumbHashDataURL(message.preview_hash) || safeMediaURL(message.memento_thumbnail_url, api);
        const whose = message.sender_first_name ? `${message.sender_first_name}\u2019s` : "their";
        return `<button class="chat-message-media memento hidden-memento" type="button" data-open-memento aria-label="${escapeChatHTML(`Post yours to see ${whose} Memento`)}">${backdrop ? `<img class="hidden-memento-backdrop" src="${escapeChatHTML(backdrop)}" alt="" aria-hidden="true" decoding="async">` : ""}<span class="hidden-memento-copy" aria-hidden="true">${uiIcon('eye-slash')}<span>Post yours to see ${escapeChatHTML(whose)} Memento</span><b>${uiIcon('camera-filled')}Take Memento</b></span></button>`;
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
        const hiddenMemento = message.kind === "memento" && mementoIsHidden(message, { today: context.today || localLedgerDate(), revealsToday: context.revealsToday ?? mementosRevealedToday() });
        const persistentMedia = hiddenMemento ? hiddenMementoMarkup(message) : mediaURL ? mediaBoxMarkup(message, mediaURL, mementoSwappedURL, mediaOverlay) : "";
        const audioMedia = message.kind === "audio" ? voiceMessageMarkup(message) : "";
        const once = viewOncePresentation(message, { canReplay: viewOnceSessionByMessage.has(message.id), ...viewOnceStates.get(message.id) });
        const marker = once.mine ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 19 9-19 9 4-9Z"/></svg>`
            : once.expired ? uiIcon('clock') : `<span>${once.kind === 'video' ? uiIcon('play') : ''}</span>`;
        const viewOnceMedia = message.view_once ? `<button class="chat-view-once-card ${once.kind} ${once.hollow ? 'opened' : ''} ${once.mine ? 'outgoing' : ''} ${once.label.length > 16 ? 'compact-label' : ''} ${viewOnceStates.get(message.id)?.armed ? 'armed' : ''}" type="button" data-open-view-once="${escapeChatHTML(message.id)}" ${once.replay ? 'data-replay="true"' : ''} ${once.disabled ? 'disabled' : ''} aria-label="${escapeChatHTML(`${once.kind === 'video' ? 'Video' : 'Photo'} · ${once.label}`)}"><i class="chat-media-marker" aria-hidden="true">${marker}</i><strong>${escapeChatHTML(once.label)}</strong></button>` : '';
        const media = audioMedia || (message.view_once ? viewOnceMedia : persistentMedia);
        const body = !hiddenMemento && message.body && message.body !== "Sent a Memento" ? `<p>${linkifyChatText(message.body)}</p>` : "";
        const reactionTypes = Object.entries(message.reaction_summary || {}).filter(([type, count]) => Number(count) > 0 && CHAT_REACTIONS.some(([key]) => key === type))
            .sort(([a, x], [b, y]) => Number(y) - Number(x) || a.localeCompare(b)).slice(0, 3);
        const reactionCount = Number(message.reaction_count || Object.values(message.reaction_summary || {}).reduce((total, count) => total + Number(count || 0), 0));
        const reactions = reactionCount > 0 ? `<span class="chat-reaction-cluster" aria-hidden="true">${reactionTypes.map(([type]) => `<span>${CHAT_REACTIONS.find(([key]) => key === type)[1]}</span>`).join('')}</span> <span class="chat-reaction-count">${reactionCount}</span>` : '';
        const latestOutgoingId = context.latestOutgoingId ?? null;
        const readers = mine && message.delivery_state === "sent" ? readReceiptMembers(message) : [];
        const receipt = readers.length && message.id === latestOutgoingId ? `<button type="button" class="chat-read-receipt" data-view-readers="${escapeChatHTML(message.id)}">${context.groupReceipts ? `Read by ${readers.length}` : "Read"}</button>` : "";
        const viewReceipt = mine && message.view_once ? `<button type="button" class="chat-read-receipt" data-view-once-receipts="${escapeChatHTML(message.id)}">View receipts</button>` : "";
        const mediaOnly = persistentMedia && !body && !replyMarkup && !message.saved_in_chat && ["photo", "video", "sticker"].includes(message.kind) && message.delivery_state === "sent";
        return `<article class="chat-message ${mine ? "mine" : "theirs"} ${mediaOnly ? "media-only" : ""} ${startsSequence ? "starts-sequence" : ""} ${endsSequence ? "ends-sequence" : ""} ${message.delivery_state || ""} ${message.view_once ? "ephemeral" : ""}" ${position} data-list-key="${escapeChatHTML(message.id)}" data-message-id="${escapeChatHTML(message.id)}"><div class="chat-message-meta">${!mine && startsSequence ? `<strong>${escapeChatHTML(message.sender_first_name || "Student")}</strong>` : ""}</div><div class="chat-bubble" data-message-bubble="${escapeChatHTML(message.id)}">${replyMarkup}${media}${message.saved_in_chat ? `<small class="chat-saved-label">Saved by ${escapeChatHTML(message.saved_by?.first_name || "a member")}</small>` : ""}${message.kind === "memento" ? `<small class="memento-label">Memento</small>` : message.kind === "story" ? `<small class="memento-label">${message.story_share_context === "reply" ? "Story reply" : "Shared Story"}</small>` : ""}${body}<time>${escapeChatHTML(message.delivery_state === "sending" ? "Sending…" : message.delivery_state === "failed" ? "Not sent" : messageTime(message.created_at))}</time><button class="chat-message-menu-button" type="button" data-message-menu="${escapeChatHTML(message.id)}" aria-label="Message actions" aria-expanded="false">${uiIcon("more")}</button></div>${message.delivery_state === 'sent' ? `<time class="chat-reveal-time" datetime="${escapeChatHTML(message.created_at || '')}">${escapeChatHTML(messageTime(message.created_at))}</time>` : ''}${message.delivery_state === "failed" ? (["text", "memento"].includes(message.kind) && message.client_request_id ? `<div class="chat-send-failure"><button class="chat-retry" type="button" data-retry-message="${escapeChatHTML(message.client_request_id)}" aria-label="Not sent. Tap to retry">Not sent · Tap to retry</button><button class="chat-discard" type="button" data-discard-message="${escapeChatHTML(message.client_request_id)}" aria-label="Delete unsent message">Delete</button></div>` : `<div class="chat-send-failure"><span class="chat-retry" role="status">${escapeChatHTML(message.error_message || "Not sent")}</span><button class="chat-discard" type="button" data-discard-pending="${escapeChatHTML(message.id)}" aria-label="Remove unsent media">Delete</button></div>`) : ""}${messageActionsMarkup(message, { mine, olderReaders: readers.length && message.id !== latestOutgoingId && !message.view_once })}${reactions ? `<button type="button" class="chat-reaction-summary ${message.current_user_reaction ? 'has-own-reaction' : ''}" data-view-reactions="${escapeChatHTML(message.id)}" aria-label="View reactions">${reactions}</button>` : ""}${viewReceipt || receipt}</article>`;
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
            if (!automatic && store.state.activeChatId === chatId) notificationNudge.sendConfirmed();
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

    // ---- New Chat (ChatCreationView / ChatCreationModel) --------------------
    // New Chat makes one-to-one chats: several people get one message each,
    // in their own chats. Groups come only from the New Group row. "Add
    // people" (from chat details) keeps its own simple picker.
    const inviteLimit = () => Math.max(1, Math.min(49, Number(getConfig()?.chat_max_members || 50) - 1));

    async function openCreateChat({ addToCurrent = false } = {}) {
        inviteMode = addToCurrent;
        creation = { mode: addToCurrent ? 'add' : 'direct', step: 'people', people: [], loading: true, selected: [], groups: [], message: '', working: false,
            groupName: '', groupPhoto: null, groupPhotoURL: null, blocked: new Set(), contactsKnown: false, requestIds: new Map(), textIds: new Map(), clientRequestId: crypto.randomUUID() };
        showScreen("create");
        $(".chat-person-search input").value = "";
        renderCreation();
        const current = creation;
        const [classmates, contacts, blocked] = await Promise.allSettled([
            api.getClassmates(userId(), "", 500),
            addToCurrent ? Promise.resolve([]) : api.getAllContacts(userId()),
            api.getBlockedUsers ? api.getBlockedUsers(userId()) : Promise.resolve([]),
        ]);
        if (creation !== current) return;
        current.loading = false;
        if (classmates.status === 'rejected' && contacts.status === 'rejected') {
            $(".chat-create-status").textContent = userMessage(classmates.reason, "Couldn't load people.");
        }
        const classmateRows = classmates.status === 'fulfilled' ? (Array.isArray(classmates.value) ? classmates.value : classmates.value?.items || []) : [];
        const contactRows = contacts.status === 'fulfilled' && Array.isArray(contacts.value) ? contacts.value : [];
        current.people = mergeCreationPeople(classmateRows, contactRows);
        current.contactsKnown = contacts.status === 'fulfilled' && contactRows.some(contact => contact.user_id);
        current.blocked = new Set((blocked.status === 'fulfilled' && Array.isArray(blocked.value) ? blocked.value : []).map(user => String(user.user_id || user.id || user.blocked_user_id)));
        renderCreation();
    }

    // ChatCreationModel.merge: classmates, plus registered contacts beyond school.
    function mergeCreationPeople(classmates, contacts) {
        const viewer = String(userId());
        const contactById = new Map();
        for (const contact of contacts) {
            if (!contact?.user_id || contact.is_six7_user === false || String(contact.user_id) === viewer) continue;
            const prior = contactById.get(String(contact.user_id));
            if (!prior || Number(contact.recommendation_strength || 0) > Number(prior.recommendation_strength || 0)) contactById.set(String(contact.user_id), contact);
        }
        const seen = new Set([viewer]);
        const people = [];
        for (const classmate of classmates) {
            const id = String(classmate.user_id || classmate.id);
            if (seen.has(id)) continue;
            seen.add(id);
            const contact = contactById.get(id);
            contactById.delete(id);
            people.push({ id, name: displayMember(classmate), first: classmate.first_name || displayMember(classmate).split(/\s+/)[0], username: classmate.username || null, grade: classmate.grade || null, school: classmate.school_name || null, avatar: classmate.profile_picture_url, school_mate: true, contact: Boolean(contact), mutual: contact ? Math.max(0, Number(contact.recommendation_strength || 0) - 1) : 0 });
        }
        for (const [id, contact] of contactById) {
            if (seen.has(id)) continue;
            seen.add(id);
            const name = String(contact.name || '').trim() || 'Valid User';
            people.push({ id, name, first: name.split(/\s+/)[0], username: null, grade: null, school: contact.school_name || null, avatar: contact.profile_picture_url, school_mate: false, contact: true, mutual: Math.max(0, Number(contact.recommendation_strength || 0) - 1) });
        }
        return people;
    }

    // ChatPersonCandidate.subtitle.
    function creationSubtitle(person, hasChat) {
        const known = person.contact ? "In your contacts" : person.username ? `@${person.username}` : person.grade || "On Valid";
        if (!hasChat && person.contact) return `${known} · Say hi ${SAY_HI_WAVE}`;
        if (person.school_mate) return `${known} · Your school`;
        if (person.mutual > 0) return `${known} · ${person.mutual} mutual`;
        if (person.school) return `${known} · ${person.school}`;
        return known;
    }

    function creationMatches(text, query) {
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        return terms.every(term => text.toLowerCase().includes(term));
    }

    function creationGroups() {
        return store.state.chats.filter(chat => isGroupChatSummary(chat) && chat.membership_status === 'accepted' && chat.has_viewer_blocked_member !== true);
    }

    function directPartnerIds() {
        return new Set(store.state.chats.filter(chat => !isGroupChatSummary(chat) && chat.membership_status === 'accepted')
            .map(chat => String((chat.member_previews || []).find(member => String(member.user_id) !== String(userId()))?.user_id || '')).filter(Boolean));
    }

    function selectedCreationPeople() {
        const byId = new Map(creation.people.map(person => [person.id, person]));
        return creation.selected.map(id => byId.get(id)).filter(Boolean);
    }

    function selectedCreationGroups() {
        const byId = new Map(store.state.chats.map(chat => [chat.id, chat]));
        return creation.groups.map(id => byId.get(id)).filter(Boolean);
    }

    function creationRecipientCount() { return creation.selected.length + creation.groups.length; }
    function creationSendsSeparately() { return creation.mode === 'direct' && creationRecipientCount() > 1; }

    // ChatCreationModel.localExistingChat: the chat with exactly these people.
    function existingCreationChat() {
        const ids = new Set(creation.selected);
        const looks = creation.mode === 'direct' ? creation.selected.length === 1 && !creation.groups.length : creation.mode === 'group' && creation.selected.length >= 2;
        if (!looks) return null;
        return store.state.chats.find(chat => {
            const previews = (chat.member_previews || []).map(member => String(member.user_id)).filter(id => id !== String(userId()));
            return chat.membership_status === 'accepted' && Number(chat.accepted_count || 0) + Number(chat.pending_count || 0) === ids.size + 1
                && previews.length === ids.size && previews.every(id => ids.has(id));
        }) || null;
    }

    function personRowMarkup(person, hasChat) {
        const selected = creation.selected.includes(person.id);
        const image = safeMediaURL(person.avatar, api);
        const blocked = creation.blocked.has(person.id);
        return `<button type="button" class="chat-person-row ${selected ? 'selected' : ''}" data-pick-person="${escapeChatHTML(person.id)}" aria-pressed="${selected}"><span class="chat-avatar">${image ? mediaImageMarkup(image, { initials: person.name.slice(0, 1) }) : `<span>${escapeChatHTML(person.name.slice(0, 1))}</span>`}</span><span class="chat-person-copy"><strong>${escapeChatHTML(person.name)}</strong>${blocked ? `<small class="blocked">You blocked them</small>` : `<small>${escapeChatHTML(creationSubtitle(person, hasChat))}</small>`}</span><span class="chat-person-check" aria-hidden="true">${selected ? uiIcon('check') : ''}</span></button>`;
    }

    function groupRowMarkup(chat) {
        const selected = creation.groups.includes(chat.id);
        return `<button type="button" class="chat-person-row ${selected ? 'selected' : ''}" data-pick-group="${escapeChatHTML(chat.id)}" aria-pressed="${selected}"><span class="chat-avatar">${conversationAvatarMarkup(chat)}</span><span class="chat-person-copy"><span class="chat-row-title"><strong>${escapeChatHTML(chat.display_name)}</strong>${streakLabelMarkup(chat)}</span><small>${Number(chat.accepted_count || 0) + Number(chat.pending_count || 0)} people</small></span><span class="chat-person-check" aria-hidden="true">${selected ? uiIcon('check') : ''}</span></button>`;
    }

    function renderCreation() {
        if (!creation) return;
        const { mode, step } = creation;
        const header = $('[data-chat-screen="create"] .chat-create-header');
        header.querySelector('strong').textContent = mode === 'add' ? 'Add people' : step === 'details' ? 'Group Details' : mode === 'group' ? 'New Group' : 'New Chat';
        header.querySelector('[data-create-back]').textContent = step === 'people' && mode !== 'group' ? (mode === 'add' ? 'Cancel' : 'Close') : 'Back';
        $('.chat-person-search').classList.toggle('hidden', step !== 'people' || creation.loading || !creation.people.length);
        $('.chat-people-list').classList.toggle('hidden', step !== 'people');
        $('.chat-group-details').classList.toggle('hidden', step !== 'details');
        if (creation.loading) {
            $('.chat-people-list').innerHTML = `<div class="chat-create-loading" role="status"><span class="chat-say-hi-progress" aria-hidden="true"></span><p>Loading people…</p></div>`;
            $('.chat-create-bar').classList.add('hidden');
            return;
        }
        if (step === 'people') renderCreationPeople();
        else renderGroupDetails();
        renderCreationBar();
    }

    function renderCreationPeople() {
        const query = $(".chat-person-search input").value.trim();
        const existingMembers = new Set(creation.mode === 'add' ? (store.state.detail?.members || []).map(member => String(member.user_id)) : []);
        const people = creation.people.filter(person => !existingMembers.has(person.id) && creationMatches([person.name, person.username || '', person.school || ''].join(' '), query));
        const byCloseness = (a, b) => b.mutual - a.mutual || a.name.localeCompare(b.name);
        const friends = people.filter(person => person.contact).sort(byCloseness);
        const school = people.filter(person => person.school_mate && !person.contact).sort(byCloseness);
        const groups = creation.mode === 'direct' ? creationGroups().filter(chat => creationMatches(chat.display_name, query)) : [];
        const partners = directPartnerIds();
        let html = '';
        if (creation.mode === 'direct' && !query) html += `<button type="button" class="chat-new-group-row" data-new-group><span class="chat-new-group-icon" aria-hidden="true">${uiIcon('group')}</span><span><strong>New Group</strong><small>Name it and add 2 or more people</small></span>${uiIcon('next')}</button>`;
        if (!creation.people.length && creation.mode !== 'add') {
            html = `<div class="chat-create-empty"><span aria-hidden="true">${uiIcon('group')}</span><h2>No one else is here yet</h2><p>People from your school and contacts who use Valid will appear here.</p><button type="button" class="secondary-button" data-create-reload>${uiIcon('flip')}<span>Check again</span></button></div>`;
        } else if (!friends.length && !school.length && !groups.length) {
            html += `<div class="chat-no-people"><span aria-hidden="true">${uiIcon('person-question')}</span><strong>${query ? `No one matches "${escapeChatHTML(query)}"` : "No one here yet"}</strong>${query ? `<small>Try a first name or @username.</small>` : ''}</div>`;
        } else {
            if (friends.length) html += `<h3 class="chat-create-section">Friends on Valid</h3>${friends.map(person => personRowMarkup(person, partners.has(person.id))).join('')}`;
            if (school.length) html += `<h3 class="chat-create-section">At your school</h3>${school.map(person => personRowMarkup(person, partners.has(person.id))).join('')}`;
            if (groups.length) html += `<h3 class="chat-create-section">Your groups</h3>${groups.map(groupRowMarkup).join('')}`;
        }
        $('.chat-people-list').innerHTML = html;
    }

    function renderGroupDetails() {
        const people = selectedCreationPeople();
        const existing = existingCreationChat();
        const photo = creation.groupPhotoURL ? `<img src="${escapeChatHTML(creation.groupPhotoURL)}" alt="">` : uiIcon('camera-filled');
        $('.chat-group-details').innerHTML = `<div class="chat-group-details-head"><h2>Finish your group</h2><p>You and ${people.length} friends</p></div>${existing ? `<div class="chat-existing-group">${uiIcon('chat-pair-filled')}<span><strong>This group already exists</strong><small>Open ${escapeChatHTML(existing.display_name)} instead of making a duplicate.</small></span></div>` : `<div class="chat-group-setup"><label class="chat-group-photo"><span class="chat-group-photo-circle">${photo}</span><span><strong>Group photo</strong><small>Tap to add or change</small></span><input type="file" accept="image/*" class="visually-hidden" data-group-photo></label><label class="chat-group-name"><span class="visually-hidden">Group name</span><input type="text" maxlength="40" placeholder="Group name (optional)" value="${escapeChatHTML(creation.groupName)}" data-group-name></label><small>Leave it blank and we'll use everyone's first names.</small></div>`}<section class="chat-group-people"><h3>People</h3><div>${people.map(person => {
            const image = safeMediaURL(person.avatar, api);
            return `<span class="chat-group-person"><span class="chat-avatar">${image ? mediaImageMarkup(image, { initials: person.first.slice(0, 1) }) : `<span>${escapeChatHTML(person.first.slice(0, 1))}</span>`}</span><small>${escapeChatHTML(person.first)}</small></span>`;
        }).join('')}</div></section>`;
    }

    function renderCreationBar() {
        const bar = $('.chat-create-bar');
        const count = creationRecipientCount();
        const { mode, step, working } = creation;
        if (step === 'people' && !count) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
        bar.classList.remove('hidden');
        const names = [...selectedCreationGroups().map(chat => chat.display_name), ...selectedCreationPeople().map(person => person.first)];
        const summary = step === 'people' && (creationSendsSeparately() || mode === 'group')
            ? `<div class="chat-send-summary"><strong>${escapeChatHTML(names.join(', '))}</strong><small>${mode === 'group' ? 'Pick at least 2 people for a group' : 'Each gets it in their own chat'}</small></div>` : '';
        if (mode === 'add') {
            bar.innerHTML = `<button type="button" class="send-pill chat-create-start" data-create-start ${working ? 'disabled' : ''}><span class="send-pill-title">${working ? 'Adding…' : `Add ${count}`}</span>${uiIcon('arrow-right')}</button>`;
            return;
        }
        if (step === 'people' && creationSendsSeparately()) {
            const draft = bar.querySelector('[data-separate-message]')?.value ?? creation.message;
            bar.innerHTML = `${summary}<label class="chat-separate-message"><span class="visually-hidden">Message each of them</span><textarea rows="1" maxlength="2000" placeholder="${escapeChatHTML(SEPARATE_MESSAGE_PLACEHOLDER)}" data-separate-message>${escapeChatHTML(draft)}</textarea></label><button type="button" class="send-pill chat-create-start" data-create-send ${working ? 'disabled' : ''}><span class="send-pill-title">${working ? 'Sending…' : names.length === 1 ? `Send to ${escapeChatHTML(names[0])}` : `Send to ${names.length}`}</span>${uiIcon('send')}</button>`;
            return;
        }
        const soleGroup = mode === 'direct' && !creation.selected.length && creation.groups.length === 1 ? selectedCreationGroups()[0] : null;
        const existing = existingCreationChat();
        let title, icon = 'arrow-right', enabled = true;
        if (soleGroup) { title = `Open ${soleGroup.display_name}`; icon = 'next'; }
        else if (step === 'details') title = existing ? 'Open Group' : 'Create Group';
        else if (mode === 'group') { const missing = 2 - creation.selected.length; title = missing > 0 ? `Add ${missing} more` : 'Next'; enabled = missing <= 0; }
        else title = `Chat with ${selectedCreationPeople()[0]?.first || 'them'}`;
        if (existing && !soleGroup) icon = 'next';
        const workingTitle = step === 'details' ? 'Creating group…' : 'Starting chat…';
        bar.innerHTML = `${summary}<button type="button" class="send-pill chat-create-start" data-create-start ${working || !enabled ? 'disabled' : ''}><span class="send-pill-title">${escapeChatHTML(working ? workingTitle : title)}</span>${uiIcon(icon)}</button>`;
    }

    function togglePerson(id) {
        if (!creation || creation.working) return;
        const index = creation.selected.indexOf(id);
        if (index >= 0) creation.selected.splice(index, 1);
        else if (creation.selected.length < inviteLimit()) creation.selected.push(id);
        feedback('selection');
        renderCreationPeople();
        renderCreationBar();
    }

    function toggleGroup(id) {
        if (!creation || creation.working || creation.mode !== 'direct') return;
        const index = creation.groups.indexOf(id);
        if (index >= 0) creation.groups.splice(index, 1); else creation.groups.push(id);
        feedback('selection');
        renderCreationPeople();
        renderCreationBar();
    }

    function creationBack() {
        if (!creation) return backFromRoom();
        if (creation.step === 'details') { creation.step = 'people'; return renderCreation(); }
        if (creation.mode === 'group') { creation.mode = 'direct'; return renderCreation(); }
        return backFromRoom();
    }

    // The safety checks before starting anything (ChatInviteReview.decide):
    // blocked people first, then anyone not in the viewer's contacts.
    async function reviewCreationPeople() {
        const people = selectedCreationPeople();
        const blocked = people.filter(person => creation.blocked.has(person.id));
        if (blocked.length) {
            feedback('warning');
            const names = new Intl.ListFormat(undefined, { type: 'conjunction' }).format(blocked.map(person => person.name));
            const ok = await confirmSheet({
                title: blocked.length === 1 ? "You blocked this person" : "You blocked some people",
                message: creation.mode === 'direct' && creationSendsSeparately() ? `You blocked ${names}. Unblock them before sending these invites?` : `You blocked ${names}. Unblock them before inviting them to chat?`,
                confirmLabel: "Unblock & Start",
            });
            if (!ok) return false;
            try {
                for (const person of blocked) { await api.unblockUser(userId(), person.id); creation.blocked.delete(person.id); }
            } catch (error) {
                showToast?.(`Couldn't unblock everyone. ${userMessage(error, 'Try again.')}`);
                return false;
            }
        }
        const unknown = people.filter(person => !person.contact).map(person => person.name);
        if (!people.length || (creation.contactsKnown && !unknown.length)) return true;
        feedback('warning');
        const unavailable = !creation.contactsKnown;
        return confirmSheet({
            title: unavailable || unknown.length !== 1 ? "Do you know everyone here?" : `Do you know ${unknown[0]}?`,
            message: unavailable ? "Valid couldn't verify these people against your contacts. Only continue if you know everyone."
                : unknown.length === 1 ? `${unknown[0]} isn't in your contacts. Only continue if you know them.`
                : `${new Intl.ListFormat(undefined, { type: 'conjunction' }).format(unknown)} aren't in your contacts. Only continue if you know them.`,
            confirmLabel: creation.mode === 'group' ? "Create anyway" : creationSendsSeparately() ? "Send anyway" : "Start anyway",
            cancelLabel: "Go back",
        });
    }

    async function startCreation() {
        if (!creation || creation.working) return;
        if (creation.mode === 'add') return addPeopleToCurrent();
        const soleGroup = creation.mode === 'direct' && !creation.selected.length && creation.groups.length === 1 ? selectedCreationGroups()[0] : null;
        const existing = existingCreationChat();
        if (soleGroup || existing) return finishCreation(soleGroup || existing);
        if (creation.mode === 'group' && creation.step === 'people') {
            if (creation.selected.length < 2) return;
            creation.step = 'details';
            return renderCreation();
        }
        if (!await reviewCreationPeople()) return;
        const current = creation;
        current.working = true;
        renderCreationBar();
        try {
            const people = selectedCreationPeople();
            const typed = current.groupName.trim();
            const name = current.mode === 'group' ? (typed || `${people.slice(0, 3).map(person => person.first).join(', ')}${people.length > 3 ? ` +${people.length - 3}` : ''}`.slice(0, 40)) : null;
            let chat = await api.createChat(userId(), [...current.selected], name, current.clientRequestId, current.mode === 'group' ? 'new_group' : 'new_chat');
            if (current.mode === 'group' && current.groupPhoto) chat = await api.uploadChatPhoto(userId(), chat.id, current.groupPhoto).catch(() => chat);
            if (creation !== current) return;
            successHaptic?.();
            await finishCreation(chat);
        } catch (error) {
            current.working = false;
            if (creation === current) renderCreationBar();
            showToast?.(userMessage(error, "Couldn't create chat. Try again."));
        }
    }

    async function finishCreation(chat) {
        store.upsertChat(chat);
        creation = null;
        renderChatList();
        await openChat(chat.id, { updateHistory: true, force: true });
    }

    // One message to each, in their own chats (ChatCreationModel.sendSeparately).
    async function sendCreationSeparately() {
        if (!creation || creation.working || !creationSendsSeparately()) return;
        creation.message = $('[data-separate-message]')?.value || '';
        const body = creation.message.trim() || SAY_HI_WAVE;
        if (!await reviewCreationPeople()) return;
        const current = creation;
        current.working = true;
        renderCreationBar();
        const started = new Map();
        await Promise.all(current.selected.map(async personId => {
            const requestId = current.requestIds.get(personId) || crypto.randomUUID();
            current.requestIds.set(personId, requestId);
            try { started.set(personId, (await api.createChat(userId(), [personId], null, requestId, 'new_chat')).id); } catch (_) { /* reported below */ }
        }));
        const groupIds = new Set(creationGroups().map(chat => chat.id));
        const deliveries = [...[...started].map(([personId, chatId]) => ({ chatId, personId })), ...current.groups.filter(id => groupIds.has(id)).map(groupId => ({ chatId: groupId, groupId }))];
        const reached = new Set();
        for (const delivery of deliveries) {
            const textId = current.textIds.get(delivery.chatId) || crypto.randomUUID();
            current.textIds.set(delivery.chatId, textId);
            try {
                await api.sendChatMessage(userId(), delivery.chatId, { body, client_request_id: textId, reply_to_message_id: null });
                reached.add(delivery.personId || delivery.groupId);
            } catch (_) { /* reported below */ }
        }
        if (creation !== current) return;
        current.selected = current.selected.filter(id => !reached.has(id));
        current.groups = current.groups.filter(id => !reached.has(id));
        current.working = false;
        void loadChats({ quiet: true });
        if (creationRecipientCount()) {
            const missed = [...selectedCreationPeople().map(person => person.first), ...selectedCreationGroups().map(chat => chat.display_name)];
            renderCreation();
            return showToast?.(`Couldn't send to ${missed.length ? new Intl.ListFormat(undefined, { type: 'conjunction' }).format(missed) : 'everyone'}. Try again.`);
        }
        successHaptic?.();
        creation = null;
        showChatList();
    }

    async function addPeopleToCurrent() {
        const current = creation;
        if (!current.selected.length) return;
        current.working = true;
        renderCreationBar();
        try {
            const chat = await api.inviteChatMembers(userId(), store.state.activeChatId, [...current.selected]);
            store.upsertChat(chat);
            successHaptic?.();
            creation = null;
            inviteMode = false;
            await openChat(store.state.activeChatId, { updateHistory: false, force: true });
        } catch (error) {
            current.working = false;
            if (creation === current) renderCreationBar();
            showToast?.(userMessage(error, "Could not add people."));
        }
    }

    // ---- Chat invite (ChatInvitationReviewView) ----------------------------
    let invitation = null;

    function openInvitation(chat, { updateHistory = true } = {}) {
        if (store.state.activeChatId) leaveRoom();
        invitation = { chat, detail: null, loadingPeople: false, peopleError: '', working: false };
        if (updateHistory) pushRoomHistory(chat.id);
        showScreen('invite');
        renderInvitation();
        if (isGroupChatSummary(chat)) void loadInvitationPeople();
    }

    async function loadInvitationPeople() {
        const current = invitation;
        if (!current || current.loadingPeople) return;
        current.loadingPeople = true; current.peopleError = '';
        renderInvitation();
        try {
            current.detail = await api.getChat(userId(), current.chat.id);
        } catch (_) {
            current.peopleError = "Couldn't load the people in this group.";
        } finally {
            current.loadingPeople = false;
            if (invitation === current) renderInvitation();
        }
    }

    function invitationAvatar(chat) {
        return `<span class="chat-avatar chat-invite-avatar">${conversationAvatarMarkup(chat)}</span>`;
    }

    function renderInvitation() {
        const body = $('.chat-invite-body');
        if (!invitation) { body.innerHTML = ''; return; }
        const { chat, working } = invitation;
        const inviter = invitedByDisplayName(chat);
        const opener = friendInvitationOpener(chat);
        if (opener) {
            body.innerHTML = `<div class="chat-invite-card friend">${invitationAvatar(chat)}<h2>${escapeChatHTML(opener === SAY_HI_WAVE ? `${inviter} said hi` : inviter)}</h2><p class="chat-invite-opener ${opener === SAY_HI_WAVE ? 'wave' : ''}">${escapeChatHTML(opener)}</p><div class="chat-invite-actions-stack"><button type="button" class="chat-invite-primary" data-wave-back ${working ? 'disabled' : ''}>${working ? 'Waving…' : `${SAY_HI_WAVE} Wave back`}</button><button type="button" class="chat-invite-secondary" data-invite-open ${working ? 'disabled' : ''}>Open chat</button><button type="button" class="chat-invite-decline-link" data-invite-decline ${working ? 'disabled' : ''}>Decline</button></div></div>`;
            return;
        }
        const summary = chat.invitation_story_context === 'reply' ? `${inviter} replied to your Story`
            : chat.invitation_story_context === 'share' ? `${inviter} sent you a Story`
            : isGroupChatSummary(chat) ? `${inviter} invited you · ${Number(chat.accepted_count || 0) + Number(chat.pending_count || 0)} people`
            : `${inviter} invited you to chat`;
        const detail = chat.invitation_story_context ? "Accept to see the Story and message. The usual chat safety rules still apply." : "Accept to start chatting.";
        const members = (invitation.detail?.members || []).filter(member => String(member.user_id) !== String(userId()));
        const people = !isGroupChatSummary(chat) ? '' : `<section class="chat-invite-people"><h3>Who's in this group</h3>${invitation.loadingPeople && !invitation.detail ? `<p role="status">Loading people…</p>`
            : invitation.peopleError ? `<p role="status">${escapeChatHTML(invitation.peopleError)}</p><button type="button" data-invite-retry-people>Try again</button>`
            : members.map(member => {
                const image = safeMediaURL(member.profile_picture_url, api);
                const initial = displayMember(member).slice(0, 1).toUpperCase();
                const tag = member.is_blocked_by_viewer === true ? `<em class="blocked">Blocked</em>` : member.role === 'owner' ? `<em>Owner</em>` : '';
                return `<div class="chat-invite-person"><span class="chat-avatar">${image ? mediaImageMarkup(image, { initials: initial }) : `<span>${escapeChatHTML(initial)}</span>`}</span><span><strong>${escapeChatHTML(displayMember(member))}</strong><small>${member.status === 'accepted' ? 'In the group' : 'Invited'}</small></span>${tag}</div>`;
            }).join('')}</section>`;
        const blocked = invitationHasBlockedMembers() ? `<p class="chat-invite-blocked" role="note"><span aria-hidden="true">!</span>Someone you blocked is in this group.</p>` : '';
        body.innerHTML = `<div class="chat-invite-card">${invitationAvatar(chat)}<h2>${escapeChatHTML(chat.display_name)}</h2><p class="chat-invite-summary">${escapeChatHTML(summary)}</p><p class="chat-invite-detail">${escapeChatHTML(detail)}</p>${people}${blocked}<div class="chat-invite-actions"><button type="button" class="chat-invite-decline" data-invite-decline ${working ? 'disabled' : ''}>${uiIcon('close')}<span>Decline</span></button><button type="button" class="chat-invite-accept" data-invite-accept ${working || (isGroupChatSummary(chat) && invitation.loadingPeople) ? 'disabled' : ''}>${working ? '<span>Accepting…</span>' : `${uiIcon('check')}<span>Accept</span>`}</button></div></div>`;
    }

    function invitationHasBlockedMembers() {
        return invitation?.chat?.has_viewer_blocked_member === true
            || (invitation?.detail?.members || []).some(member => String(member.user_id) !== String(userId()) && member.is_blocked_by_viewer === true);
    }

    // Whether the viewer knows everyone they would join, from the contacts
    // they uploaded (ChatInvitationReviewModel.reviewBeforeAccepting).
    async function reviewInvitationContacts() {
        const chat = invitation.chat;
        let contacts = [];
        try { contacts = await api.getAllContacts(userId()); } catch (_) { return { unavailable: true, names: [] }; }
        const known = new Set((contacts || []).filter(contact => contact.user_id).map(contact => String(contact.user_id)));
        if (!known.size) return { unavailable: true, names: [] };
        if (isGroupChatSummary(chat)) {
            const names = (invitation.detail?.members || []).filter(member => String(member.user_id) !== String(userId()) && !known.has(String(member.user_id))).map(displayMember);
            return { unavailable: false, names };
        }
        return { unavailable: false, names: known.has(String(chat.owner_user_id)) ? [] : [invitedByDisplayName(chat)] };
    }

    async function reviewAndAcceptInvitation() {
        if (!invitation || invitation.working) return;
        const current = invitation;
        if (invitationHasBlockedMembers()) {
            feedback('warning');
            if (!await confirmSheet({ title: "Someone you blocked is here", message: `Do you still want to join ${current.chat.display_name}?`, confirmLabel: "Join anyway", cancelLabel: "Not now" })) return;
        }
        if (isGroupChatSummary(current.chat) && !current.detail) await loadInvitationPeople();
        if (invitation !== current) return;
        if (isGroupChatSummary(current.chat) && !current.detail) return showToast?.("Couldn't verify everyone in this group. Try loading the people again before accepting.");
        const review = await reviewInvitationContacts();
        if (invitation !== current) return;
        if (review.unavailable || review.names.length) {
            feedback('warning');
            const title = review.unavailable || review.names.length !== 1 ? "Do you know everyone here?" : `Do you know ${review.names[0]}?`;
            const message = review.unavailable ? "Valid couldn't verify these people against your contacts. Only accept invitations from people you know."
                : review.names.length === 1 ? `${review.names[0]} isn't in your contacts. Only accept invitations from people you know.`
                : `${new Intl.ListFormat(undefined, { type: 'conjunction' }).format(review.names)} aren't in your contacts. Only accept invitations from people you know.`;
            if (!await confirmSheet({ title, message, confirmLabel: "Yes, accept", cancelLabel: "No" })) return;
        }
        await acceptInvitation();
    }

    // Accept → the room appears in place. With a wave, 👋 goes first.
    async function acceptInvitation({ wave = false } = {}) {
        const current = invitation;
        if (!current || current.working) return;
        current.working = true;
        renderInvitation();
        try {
            const chat = await api.acceptChatInvitation(userId(), current.chat.membership_id);
            if (wave) await api.sendChatMessage(userId(), chat.id, { body: SAY_HI_WAVE, client_request_id: current.waveRequestId ||= crypto.randomUUID(), reply_to_message_id: null }).catch(() => null);
            store.upsertChat(chat);
            successHaptic?.();
            if (invitation !== current) return;
            invitation = null;
            renderChatList();
            await openChat(chat.id, { updateHistory: false, force: true });
        } catch (error) {
            current.working = false;
            if (invitation === current) renderInvitation();
            showToast?.(userMessage(error, "Couldn't update invitation. Try again."));
        }
    }

    // Decline is immediate and goes back, as on iOS.
    async function declineInvitation() {
        const current = invitation;
        if (!current || current.working) return;
        current.working = true;
        renderInvitation();
        try {
            await api.declineChatInvitation(userId(), current.chat.membership_id);
            invitation = null;
            showChatList();
            await loadChats({ quiet: true });
        } catch (error) {
            current.working = false;
            if (invitation === current) renderInvitation();
            showToast?.(userMessage(error, "Couldn't update invitation. Try again."));
        }
    }

    function openMementoComposer({ showExisting = false } = {}) {
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
        if (!store.state.activeChatId || mementoPublishing) return;
        renderMementoAudience();
        $("[data-memento-dialog]").showModal();
        startMementoCamera();
    }

    // ReviewSendTitle.toChat: "Send to Crew" from a chat, "Send" without a name.
    function renderMementoAudience() {
        const activeChat = store.state.chats.find((chat) => String(chat.id) === String(store.state.activeChatId));
        const destination = String(activeChat?.display_name || store.state.detail?.chat?.display_name || "").trim();
        $(".memento-publish .send-pill-title").textContent = mementoPublishing ? "Sending…" : destination ? `Send to ${destination}` : "Send";
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
            $(".memento-swap-hint").hidden = !selectedMementoSecondaryFile;
            mementoSaved = false;
            renderMementoSave();
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
    // The capture is queued and the review closes at once; the chat shows the
    // Memento sending in its bubble (MainTabPresentations). A failure says so there.
    async function publishMemento(event) {
        event.preventDefault();
        if (mementoPublishing) return;
        if (!selectedMementoFile || !store.state.activeChatId) {
            $(".memento-status").textContent = "Take a photo before sending your Memento.";
            return;
        }
        mementoPublishing = true;
        const chatId = String(store.state.activeChatId);
        const chatIds = [chatId];
        $(".memento-publish").disabled = true;
        renderMementoAudience();
        mementoRequestId ||= crypto.randomUUID();
        const requestId = mementoRequestId;
        const record = {
            id: `${userId()}:memento:${requestId}`,
            user_id: userId(),
            kind: "memento",
            file: selectedMementoFile,
            secondary: selectedMementoSecondaryFile,
            chat_id: chatId,
            chat_ids: chatIds,
            caption: null,
            ledger_date: localLedgerDate(),
            request_id: requestId,
        };
        try {
            await putChatMediaOutbox(record);
        } catch (_) {
            mementoPublishing = false;
            renderMementoAudience();
            $(".memento-publish").disabled = false;
            $(".memento-status").textContent = "This Memento could not be saved for a safe retry. Free some device storage and try again.";
            return;
        }
        const previewURL = URL.createObjectURL(selectedMementoFile);
        const pendingId = `pending:memento:${requestId}`;
        const latest = Math.max(0, ...store.messages(chatId).map((message) => message.room_sequence));
        store.updateMessage(chatId, normalizeMessage({
            id: pendingId, chat_id: chatId, room_sequence: latest + 0.5, sender_user_id: userId(), sender_first_name: getUser()?.first_name,
            kind: "memento", body: null, memento_image_url: previewURL, memento_ledger_date: localLedgerDate(),
            status: "active", viewer_is_sender: true, created_at: new Date().toISOString(), delivery_state: "sending",
        }));
        mementoSentToday.set(chatId, localLedgerDate());
        mementoRequestId = null;
        mementoPublishing = false;
        $("[data-memento-dialog]").close();
        successHaptic?.();
        bumpSending(chatId, 1);
        if (store.state.activeChatId === chatId) { renderDailyRow(); renderMessages(true); }
        try {
            await deliverMediaRecord(record);
            await removeChatMediaOutbox(record.id);
            dropPendingMessage(chatId, pendingId);
            if (store.state.activeChatId === chatId) await openChat(chatId, { updateHistory: false, force: true });
        } catch (error) {
            if (chatTextSendIsRetryable(error)) await markChatMediaOutboxAttempt(record.id).catch(() => null);
            else {
                await removeChatMediaOutbox(record.id).catch(() => null);
                mementoSentToday.delete(chatId);
            }
            markPendingFailed(chatId, pendingId, chatTextSendIsRetryable(error) ? "Memento didn't send. It will retry while Valid is open." : userMessage(error, "Memento didn't send"));
        } finally {
            bumpSending(chatId, -1);
            setTimeout(() => URL.revokeObjectURL(previewURL), 60_000);
        }
    }

    // A pending bubble the server's own message replaces.
    function dropPendingMessage(chatId, pendingId) {
        const kept = store.messages(chatId).filter(message => message.id !== pendingId);
        store.replaceMessages(chatId, kept, store.state.messagePageByChat.get(String(chatId)) || {});
        if (store.state.activeChatId === chatId) renderMessages(false, { preservePosition: true });
    }

    function markPendingFailed(chatId, pendingId, text) {
        const message = store.messages(chatId).find(item => item.id === pendingId);
        if (message) store.updateMessage(chatId, { ...message, delivery_state: "failed", error_message: text });
        if (store.state.activeChatId === chatId) renderMessages(false, { preservePosition: true });
        showToast?.(text);
    }

    function bumpSending(chatId, delta) {
        const next = Math.max(0, (sendingChatCounts.get(chatId) || 0) + delta);
        if (next) sendingChatCounts.set(chatId, next); else sendingChatCounts.delete(chatId);
        if (store.state.chats.some(chat => chat.id === chatId)) reconcileKeyedElements($(".chat-list"), store.state.chats.map((chat) => ({ key: chat.id, html: chatRowMarkup(chat) })));
    }

    // Save keeps a copy on this device (CameraReviewSaveButton): the share
    // sheet where the browser has one (Save Image on iPhone), else a download.
    async function saveFile(file, name) {
        const named = new File([file], name, { type: file.type || "image/jpeg" });
        if (navigator.canShare?.({ files: [named] })) {
            try { await navigator.share({ files: [named] }); return true; } catch (error) { if (error?.name === 'AbortError') return false; }
        }
        const url = URL.createObjectURL(named);
        const link = Object.assign(document.createElement('a'), { href: url, download: name });
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        return true;
    }

    function renderMementoSave() {
        const button = $('[data-save-memento]');
        button.classList.toggle('saved', mementoSaved);
        button.querySelector('.review-save-circle').innerHTML = uiIcon(mementoSaved ? 'check' : 'save-down');
        button.querySelector('small').textContent = mementoSaved ? 'Saved' : 'Save';
        button.setAttribute('aria-label', mementoSaved ? 'Saved' : 'Save');
        button.disabled = mementoSaved || !selectedMementoFile || mementoPublishing;
    }

    async function saveMemento() {
        if (!selectedMementoFile || mementoSaved) return;
        if (await saveFile(selectedMementoFile, `memento-${localLedgerDate()}.jpg`)) { mementoSaved = true; renderMementoSave(); feedback('success'); }
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
        $(".memento-swap-hint").hidden = true;
        mementoSaved = false;
        renderMementoSave();
        $(".memento-preview").innerHTML = `${uiIcon('camera')}<p>Capture one real moment from today.</p>`;
        $(".memento-status").textContent = "";
        $(".memento-progress").classList.add("hidden");
        setRuntimeStyles($(".memento-progress span"), { width: "0" });
    }

    // ①/∞ on the tool column, with its hint card for a moment (ViewOnceHintCard).
    function setChatViewOnce(value, { hint = false } = {}) {
        chatViewOnce = Boolean(value);
        const toggle = $('[data-chat-view-once]');
        toggle.setAttribute('aria-checked', String(chatViewOnce));
        toggle.querySelector('.view-once-glyph').innerHTML = chatViewOnce ? '<b>1</b>' : uiIcon('infinity');
        toggle.classList.toggle('keep', !chatViewOnce);
        $('.chat-media-publish .send-pill-subtitle').textContent = chatViewOnce ? 'View once' : 'Keep in chat';
        const card = $('.view-once-hint');
        clearTimeout(viewOnceHintTimer);
        if (!hint) { card.hidden = true; return; }
        card.innerHTML = `<span class="view-once-glyph large" aria-hidden="true">${chatViewOnce ? '<b>1</b>' : uiIcon('infinity')}</span><strong>${chatViewOnce ? 'View once' : 'Keep in chat'}</strong><small>${chatViewOnce ? 'Opens one time, then it\u2019s gone' : 'Stays in the chat after it\u2019s opened'}</small>`;
        card.hidden = false;
        viewOnceHintTimer = setTimeout(() => { card.hidden = true; }, 1600);
    }

    // The review's chip says who it goes to (CameraReviewControls.sendToChip).
    function renderSendToChip() {
        const chat = store.state.chats.find(item => item.id === store.state.activeChatId) || store.state.detail?.chat;
        const chip = $('[data-send-to-chip]');
        chip.hidden = !chat;
        if (!chat) return;
        chip.querySelector('strong').textContent = chat.display_name;
        chip.querySelector('.review-chip-avatar').innerHTML = conversationAvatarMarkup(chat);
        chip.setAttribute('aria-label', `Sending to ${chat.display_name}`);
    }

    function renderChatMediaSave() {
        const button = $('[data-save-chat-media]');
        button.classList.toggle('saved', chatMediaSaved);
        button.querySelector('.review-save-circle').innerHTML = uiIcon(chatMediaSaved ? 'check' : 'save-down');
        button.querySelector('small').textContent = chatMediaSaved ? 'Saved' : 'Save';
        button.setAttribute('aria-label', chatMediaSaved ? 'Saved' : 'Save');
        button.disabled = chatMediaSaved || !selectedChatMedia || selectedChatMedia.kind === 'audio' || chatMediaPublishing;
    }

    // A copy with the edits on screen, as it would be sent.
    async function saveChatMedia() {
        const media = selectedChatMedia;
        if (!media || chatMediaSaved || chatMediaPublishing) return;
        try {
            let file = media.file;
            if (media.kind === 'photo') {
                const pipeline = await photoPipeline();
                const composed = reviewEditor.compose({ drawExtras: (context, width, height) => photoStickers.draw(context, width, height) });
                try { file = await pipeline.canvasBlob(composed, 0.92); } finally { composed.width = composed.height = 0; }
            }
            if (!file || media !== selectedChatMedia) return;
            const extension = media.kind === 'video' ? (String(file.type).includes('mp4') ? 'mp4' : 'webm') : 'jpg';
            if (await saveFile(file, `valid-${Date.now()}.${extension}`)) { chatMediaSaved = true; renderChatMediaSave(); feedback('success'); }
        } catch (error) {
            $(".chat-media-status").textContent = userMessage(error, "Couldn't save that.");
        }
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
                notificationNudge.sendConfirmed();
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
            setChatViewOnce(true);
            $("[data-chat-view-once]").disabled = isAudio;
            chatMediaSaved = false;
            renderChatMediaSave();
            renderSendToChip();
            $("[data-review-tools]").hidden = isAudio;
            photoStickers.mount();
            $(".chat-media-status").textContent = '';
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
            // A tap records hands-free, already locked (ChatVoiceComposerButton).
            if (!$('.chat-voice-hint').textContent) $('.chat-voice-hint').textContent = VOICE_LOCKED_HINT;
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

    // The capture is queued (the outbox) and the camera closes at once, with
    // the pending bubble in the chat (CameraFirstFlowView.queue). No toast.
    async function publishChatMedia(event) {
        event.preventDefault();
        if (!selectedChatMedia || !store.state.activeChatId || chatMediaPublishing) return;
        chatMediaPublishing = true;
        const chatId = store.state.activeChatId;
        const media = selectedChatMedia;
        const button = $(".chat-media-publish");
        const viewOnce = media.kind !== "audio" && chatViewOnce;
        const textOverlay = media.kind === "audio" ? null : reviewEditor?.textOverlay() || null;
        chatMediaUploadRequestId ||= crypto.randomUUID();
        chatMediaSendRequestId ||= crypto.randomUUID();
        const uploadRequestId = chatMediaUploadRequestId, sendRequestId = chatMediaSendRequestId;
        const preparationGeneration = chatMediaPreparationGeneration;
        const senderId = userId(), replyId = store.state.replyToMessageId || null;
        const recordId = `${senderId}:chat-media:${uploadRequestId}`;
        button.disabled = true;
        button.querySelector('.send-pill-title').textContent = "Sending…";
        root.querySelectorAll('[data-retake-chat-photo], [data-record-voice], [data-chat-view-once]').forEach(control => { control.disabled = true; });
        let record;
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
            }
            if (preparationGeneration !== chatMediaPreparationGeneration || senderId !== userId()) throw new Error('Media selection changed. Try again.');
            record = {
                id: recordId, user_id: senderId, kind: "chat_media", file: uploadFile, thumbnail, preview_hash: previewHash, chat_id: chatId,
                content_type: media.ingest ? (media.contentType || uploadFile.type) : uploadFile.type,
                ingest: Boolean(media.ingest), duration_ms: media.durationMs, view_once: viewOnce, overlay: textOverlay,
                reply_to_message_id: replyId, upload_request_id: uploadRequestId, send_request_id: sendRequestId,
            };
            await putChatMediaOutbox(record);
        } catch (error) {
            chatMediaPublishing = false;
            button.querySelector('.send-pill-title').textContent = "Send";
            button.disabled = !selectedChatMedia;
            root.querySelectorAll('[data-retake-chat-photo], [data-record-voice], [data-chat-view-once]').forEach(control => { control.disabled = false; });
            $(".chat-media-status").textContent = /Media selection changed/.test(error?.message || '') ? error.message
                : "This media could not be saved for a safe retry. Free some device storage and try again.";
            return;
        }
        // Queued: show it in the chat and close the camera.
        const previewURL = URL.createObjectURL(record.thumbnail || record.file);
        const pendingId = `pending:${sendRequestId}`;
        const latest = Math.max(0, ...store.messages(chatId).map((message) => message.room_sequence));
        store.updateMessage(chatId, normalizeMessage({
            id: pendingId, client_request_id: sendRequestId, chat_id: chatId, room_sequence: latest + 0.5,
            sender_user_id: senderId, sender_first_name: getUser()?.first_name, kind: media.kind, body: null,
            photo_image_url: media.kind === 'photo' && !viewOnce ? previewURL : null,
            video_thumbnail_url: media.kind === 'video' && !viewOnce && record.thumbnail ? previewURL : null,
            audio_url: media.kind === 'audio' ? previewURL : null, audio_duration_ms: media.durationMs,
            view_once: viewOnce, view_once_opened_count: 0, view_once_recipient_count: 0, media_text_overlay: textOverlay,
            reply_to_message_id: replyId, status: "active", viewer_is_sender: true, created_at: new Date().toISOString(), delivery_state: "sending",
        }));
        store.state.replyToMessageId = null;
        chatMediaUploadRequestId = chatMediaSendRequestId = null;
        chatMediaPublishing = false;
        chatMediaEncoded = null;
        $("[data-chat-media-dialog]").close();
        resetChatMediaComposer();
        renderReplyDraft();
        renderMessages(true);
        successHaptic?.();
        bumpSending(chatId, 1);
        try {
            const result = await deliverMediaRecord(record);
            await removeChatMediaOutbox(record.id);
            const sent = [].concat(result || []);
            dropPendingMessage(chatId, pendingId);
            for (const message of sent) store.updateMessage(chatId, { ...message, delivery_state: "sent" });
            if (store.state.activeChatId === chatId) { renderMessages(true); notificationNudge.sendConfirmed(); }
            scheduleChatRowRefresh(chatId);
        } catch (error) {
            if (chatTextSendIsRetryable(error)) {
                await markChatMediaOutboxAttempt(record.id).catch(() => null);
                scheduleMediaOutboxRetry(await listChatMediaOutbox(userId()).catch(() => []));
                markPendingFailed(chatId, pendingId, "Couldn't send. It will retry while Valid is open.");
            } else {
                await removeChatMediaOutbox(record.id).catch(() => null);
                markPendingFailed(chatId, pendingId, userMessage(error, "Couldn't send"));
            }
        } finally {
            bumpSending(chatId, -1);
            setTimeout(() => URL.revokeObjectURL(previewURL), 60_000);
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
        $('[data-chat-media-dialog]').classList.remove('is-capturing');
        chatMediaPreparationGeneration += 1;
        stopVoiceRecorder({ discard: true });
        if (!voiceRecorder) clearVoiceRecordingState();
        releaseSelectedChatMedia();
        selectedChatMediaSourceFile = null;
        resetChatMediaRequestIds();
        $(".chat-media-file-input").value = "";
        $(".chat-media-file-input").disabled = false;
        setChatViewOnce(true);
        $("[data-chat-view-once]").disabled = false;
        chatMediaSaved = false;
        renderChatMediaSave();
        $("[data-review-tools]").hidden = true;
        $(".chat-media-send-count").hidden = true;
        $(".chat-media-preview").innerHTML = `<span aria-hidden="true">${uiIcon("plus")}</span><p>Choose a photo or video.</p>`;
        $(".chat-media-status").textContent = "";
        $(".chat-media-progress").classList.add("hidden");
        setRuntimeStyles($(".chat-media-progress span"), { width: "0" });
        $(".chat-media-publish").disabled = true;
        $(".chat-media-publish .send-pill-title").textContent = "Send";
        root.querySelectorAll('[data-retake-chat-photo], [data-record-voice], [data-chat-view-once]').forEach(control => { control.disabled = false; });
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

    // InboxPendingMediaViewer: the next unopened snap, full screen over the
    // inbox. Closing it lands back on the list with the row refreshed.
    async function viewPendingFromInbox(chatId) {
        const chat = store.state.chats.find(item => item.id === chatId);
        const sequence = Number(chat?.next_view_once_room_sequence);
        if (!chat || !Number.isFinite(sequence) || sequence <= 0) return;
        const uid = userId(), generation = ++mediaOpenGeneration;
        const current = () => generation === mediaOpenGeneration && uid === userId() && !store.state.activeChatId;
        try {
            const response = await api.getChatMessages(uid, chatId, { afterSequence: Math.max(0, sequence - 1), limit: 1 });
            const message = (response?.items || []).find(item => Number(item.room_sequence) === sequence);
            if (!current()) return;
            if (!message) return openChat(chatId);
            const session = await api.beginChatMediaViewSession(uid, chatId, { messageId: message.id, replayOfSessionId: null, clientRequestId: crypto.randomUUID() });
            if (!current()) return;
            const revealed = session.message;
            const kind = revealed.kind === 'video' ? 'video' : 'photo';
            const videoState = videoPlaybackState(revealed);
            if (videoState === 'processing' || videoState === 'unavailable') return void showToast?.(videoState === 'processing' ? VIDEO_PROCESSING_MESSAGE : VIDEO_UNAVAILABLE_MESSAGE);
            await showMediaViewer(safeMediaURL(kind === 'video' ? revealed.video_url : revealed.photo_image_url, api), {
                kind, label: `${chat.display_name} · ${kind === 'video' ? 'Video' : 'Photo'} · View once`, overlay: revealed.media_text_overlay,
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
            beginEphemeralPlayback(kind);
            $('[data-chat-media-viewer]').addEventListener('close', () => scheduleChatRowRefresh(chatId, 0), { once: true });
        } catch (error) {
            if (!current()) return;
            closeMediaViewer();
            showToast?.(userMessage(error, 'That view-once media is no longer available.'));
        }
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
        url.searchParams.delete("answer");
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
        if (target.matches("[data-create-back]")) return creationBack();
        if (target.matches("[data-chat-list]")) return backFromRoom();
        if (target.matches("[data-new-group]")) { feedback('selection'); creation.mode = 'group'; creation.groups = []; $(".chat-person-search input").value = ''; return renderCreation(); }
        if (target.dataset.pickPerson) return togglePerson(target.dataset.pickPerson);
        if (target.dataset.pickGroup) return toggleGroup(target.dataset.pickGroup);
        if (target.matches("[data-create-start]")) return startCreation();
        if (target.matches("[data-create-send]")) return sendCreationSeparately();
        if (target.matches("[data-create-reload]")) return openCreateChat();
        if (target.dataset.sayHi) return sendSayHi(target.dataset.sayHi);
        if (target.dataset.openSayHi) {
            const chat = sayHi.chats.get(target.dataset.openSayHi);
            const current = chat && (store.state.chats.find(item => item.id === String(chat.id)) || chat);
            return current ? openChat(String(current.id)) : undefined;
        }
        if (target.matches("[data-dismiss-say-hi]")) return dismissSayHi();
        if (target.matches("[data-search-all]")) return searchChats();
        if (target.matches("[data-wave-back]")) return acceptInvitation({ wave: true });
        if (target.matches("[data-invite-open]")) return acceptInvitation();
        if (target.matches("[data-invite-accept]")) return reviewAndAcceptInvitation();
        if (target.matches("[data-invite-decline]")) return declineInvitation();
        if (target.matches("[data-invite-retry-people]")) return loadInvitationPeople();
        if (target.matches("[data-remind-invite]")) return remindInvite();
        if (target.dataset.searchChat) return openSearchResult(target.dataset.searchChat, target.dataset.searchMessage || null);
        // Call back starts the call from the inbox, without opening the room.
        if (target.dataset.returnMissedCall) {
            const chat = store.state.chats.find(item => item.id === target.dataset.returnMissedCall);
            if (!chat) return;
            const callId = chat.unacknowledged_missed_call_id;
            // Web calls are voice calls.
            const mediaType = 'audio';
            store.upsertChat({ ...chat, unacknowledged_missed_call_id: null });
            renderChatList();
            if (callId && api.acknowledgeMissedCall) void api.acknowledgeMissedCall(userId(), callId).catch(() => null);
            return calls.start(mediaType, chat);
        }
        // View N opens the snap full screen over the inbox.
        if (target.dataset.pendingMedia) return viewPendingFromInbox(target.dataset.pendingMedia);
        if (target.dataset.openChat) {
            if (target.tagName === 'A') {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
            }
            return openChat(target.dataset.openChat);
        }
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
        if (target.matches('[data-photo-stickers]')) { if (!chatMediaPublishing) return openStickerLibrary({ photo: true }); return; }
        if (target.matches('[data-photo-cutout]')) {
            if (chatMediaPublishing || selectedChatMedia?.kind !== 'photo') return;
            photoStickerMode = true;
            $('[data-save-sticker]').textContent = 'Save and add';
            return selectedPhotoSourceFile().then(file => stickerMaker.open(file)).catch(error => { $('.chat-media-status').textContent = userMessage(error, "That photo could not be cut out."); });
        }
        if (target.matches("[data-close-memento]")) return $("[data-memento-dialog]").close();
        if (target.matches("[data-save-chat-media]")) return saveChatMedia();
        if (target.matches("[data-save-memento]")) return saveMemento();
        if (target.matches("[data-delete-voice]")) return resetChatMediaComposer();
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
        if (target.dataset.discardPending) return dropPendingMessage(store.state.activeChatId, target.dataset.discardPending);
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
