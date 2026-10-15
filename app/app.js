import { ValidAPI } from "./api.js";
import { uiIcon } from "./ui-icons.js";
import { feedVoterLine, senderGradeIsSafe, senderStatement, tbhSenderLine } from "./feed-sender.js";
import { createAdditionalPasskey, createSignupPasskey, passkeysSupported, signInWithPasskey } from "./passkeys.js";
import { authBrowserURL, checkPasskeyEnvironment, completeSignupSafely, enablePreviewSignup, reportAuthFailure, needsPhoneReverification } from './auth-reliability.js';
import { startPerformanceMonitoring } from "./performance.js";
import { createRealtimeList } from "./realtime-list.js";
import { activateRoute, preloadRoute } from "./routes/route-loader.js";
import { clearRuntimeStyles, setRuntimeStyles } from "./runtime-style.js";
import { configureMediaFallback, imageCandidates, installMediaImageFallback, mediaImageMarkup, setMediaImageSource } from "./media-url.js";
import { choiceSheet, confirmReasonSheet, confirmSheet } from "./ui-dialogs.js";
import { showToast } from "./toast.js";
import { userMessage } from "./user-message.js";
import { answerPayload, buildChoicePool, canStartPlay, contactUploadPayload, selectPlayChoices, summarizeContactSync } from "./play-choices.js";
import { ANONYMOUS_SUBMITTER_NAME, AUTHOR_ANONYMITY_HINT, feedQuestionAttribution, playQuestionAttribution } from "./question-attribution.js";
import { askForNotifications, configureNotificationSoftPrompt } from "./notification-soft-prompt.js";

// The localhost-only demo fixtures load on demand so they never join the
// production module graph or the service-worker shell.
const demoMode = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
    && new URLSearchParams(location.search).get("demo") === "1";
// No top-level await: production evaluates this module synchronously.
let api = demoMode ? null : new ValidAPI();
configureMediaFallback({ apiBase: api?.baseURL });
installMediaImageFallback();
let chatPresence = null;
let presenceLifecycle = null;
let callListenerStarted = false;
let weeklyGame = null;
let weeklyGameOpening = false;
let weeklyGameGeneration = 0;

// The Game of the Week in the Inbox (FeedView+PersonalInbox): the first row
// of the "All" list for a student with a school. One game is a row with its
// rank and a small × to hide it; two or three live games are a row of tiles
// (EasterEggGamesCard). Hidden, it leaves a "Show game" row to bring it back.
// The server already drops games a browser can't host from `games`.
const weeklyGameState = { featured: null, slots: [], loadedAt: 0, ranks: new Map(), entry: null, artMarkup: null };
const WEEKLY_GAME_RANK_MAX_AGE_MS = 2 * 60_000;
const weeklyGameHiddenKey = (userId) => `valid:weekly-game-hidden:${userId}`;

function weeklyGameHidden() {
    const key = weeklyGameHiddenKey(api.user?.id);
    try { return sessionStorage.getItem(key) === "1" || localStorage.getItem(key) === "1"; } catch (_) { return false; }
}

// EasterEggGameStore.hideRow: hidden for this session, and for good while
// the game still needs discovering.
function setWeeklyGameHidden(hidden) {
    const key = weeklyGameHiddenKey(api.user?.id);
    try {
        if (hidden) {
            sessionStorage.setItem(key, "1");
            if (weeklyGameState.featured?.discovery_required) localStorage.setItem(key, "1");
        } else {
            sessionStorage.removeItem(key);
            localStorage.removeItem(key);
        }
    } catch (_) { /* Without storage the row comes back on the next visit. */ }
}

function resetWeeklyGameEntry() {
    Object.assign(weeklyGameState, { featured: null, slots: [], loadedAt: 0, entry: null });
    weeklyGameState.ranks.clear();
    const root = document.querySelector("#weeklyGameRoot");
    if (root) { root.replaceChildren(); root.hidden = true; }
}

function weeklyGameArtMarkup(release, size) {
    return weeklyGameState.artMarkup?.(release, size) || "";
}

// PlayCongratsView: "Play ‹title›" below "w aura" when the game is open to
// this student (a school, and a game the server offers).
function postPlayWeeklyGame() {
    if (!state.profile?.school_id || !weeklyGameState.entry || !weeklyGameState.featured?.release) return null;
    return { release: weeklyGameState.featured.release };
}

const weeklyGameHome = (release) => (release?.home && typeof release.home === "object" ? release.home : {});
const weeklyGameShowsScore = (release) => weeklyGameHome(release).score !== false && release?.score_validator !== "unranked-v1";

// EasterEggGameSlot.daysLeft: `ends_on` is a US Pacific date.
function weeklyGameDaysLeft(endsOn, now = new Date()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn || "")) return null;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    return Math.round((Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

function weeklyGameSlotTag(slot) {
    if (slot.label) return slot.label;
    const days = weeklyGameDaysLeft(slot.ends_on);
    if (days !== null) {
        if (days === 0) return "Ends today";
        if (days === 1) return "Ends tomorrow";
        const [year, month, day] = slot.ends_on.split("-").map(Number);
        return `Ends ${new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    }
    const rank = weeklyGameShowsScore(slot.release) ? weeklyGameState.ranks.get(slot.release.id)?.rank : null;
    if (slot.kind === "weekly") return rank ? `This week · #${rank}` : "This week";
    return rank ? `#${rank}` : "Play";
}

// The small line under a tile: Admin's caption, or the end date in its last week.
function weeklyGameSlotCaption(slot) {
    if (slot.label) return slot.label;
    const days = weeklyGameDaysLeft(slot.ends_on);
    return days !== null && days <= 7 ? weeklyGameSlotTag(slot) : "";
}

function weeklyGamePledge(release) {
    const home = weeklyGameHome(release);
    return home.mode === "campaign" && home.title && home.cta && Array.isArray(home.chips) ? home.chips[0] || "" : "";
}

function renderWeeklyGameEntry() {
    const root = document.querySelector("#weeklyGameRoot");
    if (!root) return;
    const release = weeklyGameState.featured?.release;
    if (!state.profile?.school_id || !weeklyGameState.entry || !release) {
        root.replaceChildren();
        root.hidden = true;
        return;
    }
    root.hidden = false;
    const hideButton = (label) => `<button class="inbox-row-hide" type="button" data-weekly-game-hide aria-label="${escapeHTML(label)}">${uiIcon("close")}</button>`;
    if (weeklyGameHidden()) {
        root.innerHTML = `<button class="weekly-game-recovery" type="button" data-weekly-game-restore aria-label="Show Game of the Week">${uiIcon("gamecontroller")}<span>Game of the Week</span><strong>Show game</strong></button>`;
        return;
    }
    const slots = weeklyGameState.slots;
    if (slots.length >= 2) {
        root.innerHTML = `<div class="weekly-game-row weekly-game-tiles">
            <div class="weekly-game-tile-row">${slots.slice(0, 3).map((slot, index) => {
                const caption = weeklyGameSlotCaption(slot);
                const pledge = weeklyGamePledge(slot.release);
                const tag = weeklyGameSlotTag(slot);
                const label = [slot.release.title, pledge, tag === "Play" ? "" : tag].filter(Boolean).join(", ");
                return `<button class="weekly-game-tile" type="button" data-weekly-game-tile="${index}" aria-label="${escapeHTML(label)}"><span class="weekly-game-tile-icon">${weeklyGameArtMarkup(slot.release, 44)}${pledge ? `<span class="weekly-game-pledge">${escapeHTML(pledge)}</span>` : ""}</span><span class="weekly-game-tile-name">${escapeHTML(slot.release.title || "Game")}</span>${caption ? `<small>${escapeHTML(caption)}</small>` : ""}</button>`;
            }).join("")}</div>
            ${hideButton("Hide games")}
        </div>`;
        return;
    }
    const home = weeklyGameHome(release);
    const rank = weeklyGameShowsScore(release) ? weeklyGameState.ranks.get(release.id)?.rank : null;
    const subtitle = home.feed_subtitle || `${release.title || "Play"}${rank ? ` · #${rank}` : ""}`;
    root.innerHTML = `<div class="weekly-game-row">
        <button class="weekly-game-row-main" type="button" data-weekly-game-open><span class="weekly-game-row-art">${weeklyGameArtMarkup(release, 48)}</span><span class="weekly-game-row-copy"><strong>${escapeHTML(home.feed_title || "Game of the Week")}</strong><small>${escapeHTML(subtitle)}</small></span>${uiIcon("next")}</button>
        ${hideButton("Hide Game of the Week")}
    </div>`;
}

// The school rank under each game (GamesModel.board.me). Reading a board
// never records discovery or starts a run.
async function refreshWeeklyGameRanks(generation, { force = false } = {}) {
    const releases = (weeklyGameState.slots.length >= 2 ? weeklyGameState.slots.map((slot) => slot.release) : [weeklyGameState.featured?.release])
        .filter((release) => release?.id && weeklyGameShowsScore(release))
        .filter((release) => force || Date.now() - (weeklyGameState.ranks.get(release.id)?.at || 0) > WEEKLY_GAME_RANK_MAX_AGE_MS);
    if (!releases.length || !api.getWeeklyGameLeaderboard) return;
    await Promise.all(releases.map(async (release) => {
        const board = await api.getWeeklyGameLeaderboard(release.id).catch(() => null);
        if (generation !== weeklyGameGeneration || !board) return;
        weeklyGameState.ranks.set(release.id, { rank: board.unlocked === false ? null : board.me?.rank || null, at: Date.now() });
    }));
    if (generation === weeklyGameGeneration) renderWeeklyGameEntry();
}

async function refreshWeeklyGame({ forceRanks = false } = {}) {
    if (!api.user?.id || !api.getWeeklyGame) { resetWeeklyGameEntry(); return; }
    const generation = ++weeklyGameGeneration;
    try {
        const result = await api.getWeeklyGame();
        if (generation !== weeklyGameGeneration || !api.user?.id) return;
        const [{ weeklyGameEntry }, { gameArtMarkup }] = await Promise.all([import('./weekly-game/compat.js'), import('./weekly-game/home.js')]);
        if (generation !== weeklyGameGeneration) return;
        weeklyGameState.artMarkup = gameArtMarkup;
        weeklyGameState.featured = result || null;
        // Follow the selected weekly release. A game this web player can't run
        // yet still appears and its home says where to play it; only the
        // server's generic update notice (no game to name) stays hidden.
        weeklyGameState.entry = weeklyGameEntry(result?.release);
        weeklyGameState.slots = (Array.isArray(result?.games) ? result.games : [])
            .filter((slot) => slot?.release && weeklyGameEntry(slot.release))
            .slice(0, 3);
        weeklyGameState.loadedAt = Date.now();
        renderWeeklyGameEntry();
        void refreshWeeklyGameRanks(generation, { force: forceRanks });
    } catch (_) { /* Feed remains usable if the optional game request fails. */ }
}

async function openWeeklyGame({ release = null, launch = false } = {}) {
    if (weeklyGameOpening || !api.user?.id) return;
    const userId = api.user.id;
    weeklyGameOpening = true;
    try {
        const { createWeeklyGame } = await import('./weekly-game/index.js');
        if (api.user?.id !== userId) return;
        // Closing a game refreshes its rank on the Inbox row.
        weeklyGame ||= createWeeklyGame({ api, getProfilePhoto: () => state.profile?.profile_picture_url, onClose: () => { void refreshWeeklyGame({ forceRanks: true }); } });
        await weeklyGame.open({ release, launch });
    } catch (error) { showToast(userMessage(error, 'Could not open the weekly game.')); }
    finally { weeklyGameOpening = false; }
}
const DEFAULT_FULL_REVEAL_AURA_COST = 1000;
const TURNSTILE_ACTION = "phone_otp_request";
const FEED_REACTIONS = [
    { type: "thumbs_down", emoji: "👎", label: "Thumbs Down" },
    { type: "surprised", emoji: "😮", label: "Surprised" },
    { type: "fire", emoji: "🔥", label: "Fire" },
    { type: "eyes", emoji: "👀", label: "Interesting" },
    { type: "funny", emoji: "😂", label: "Funny" },
    { type: "love", emoji: "❤️", label: "Love" },
];
const REACTION_BY_TYPE = new Map([
    ...FEED_REACTIONS,
    { type: "legacy_agree", emoji: "👍", label: "Agree" },
].map((reaction) => [reaction.type, reaction]));
const TBH_PROMPTS = [
    { key: "anything", title: "Anything — just be honest", starters: ["TBH, you’re…", "Something I appreciate about you is…", "You might not know this, but…"] },
    { key: "first_impression", title: "Your first impression of me", starters: ["My first impression was…", "At first I thought you were…", "You came across as…"] },
    { key: "best_quality", title: "My best quality", starters: ["Your best quality is…", "People can count on you to…", "You make people feel…"] },
    { key: "your_vibe", title: "What vibe do I give off?", starters: ["Your vibe is…", "You remind me of…", "The energy you bring is…"] },
    { key: "good_memory", title: "A good memory you have of me", starters: ["A memory I still think about is…", "I’ll always remember when…", "One good moment was…"] },
    { key: "something_to_hear", title: "Something I need to hear", starters: ["Something you should know is…", "Don’t forget that…", "I hope you realize…"] },
];
const PERSONAL_INBOX_FILTERS = {
    all: {
        title: "All",
        description: "Everything sent to you, newest first.",
        empty: "Polls, TBHs, and Ask Me messages will show up here.",
    },
    polls: {
        title: "Polls",
        description: "Votes and nominations you received.",
        empty: "Votes and nominations you receive will show up here.",
    },
    tbhs: {
        title: "TBHs",
        description: "Honest notes, requests, and TBHs you sent.",
        empty: "TBH requests and honest notes will show up here.",
    },
    ask_me: {
        title: "Ask Me",
        description: "Private questions and replies from your Ask Me link.",
        empty: "Questions and replies from your Ask Me link will show up here.",
    },
};
const state = {
    profile: null,
    activePanel: "feed",
    chatUnreadCount: 0,
    feedType: "personal",
    personalInboxFilter: "all",
    myVotesOnly: false,
    schoolFeedSort: "recent",
    schoolFeedContent: "all",
    feedSearch: "",
    feedClassmateResults: [],
    feedSearchTimer: null,
    feedSearchGeneration: 0,
    feedAppliedSearch: "",
    feedItems: [],
    feedOffset: 0,
    feedCursor: null,
    feedGeneration: 0,
    selectedFeedItemId: null,
    tbhPendingRequests: [],
    tbhInboxItems: [],
    tbhSentItems: [],
    schoolTbhItems: [],
    tbhGeneration: 0,
    selectedTbhRequestId: null,
    selectedTbhItem: null,
    tbhTargets: [],
    selectedTbhTargetId: null,
    selectedTbhPrompt: "anything",
    tbhRequestIdempotencyKey: null,
    tbhResponseIdempotencyKey: null,
    selectedTbhStarter: null,
    reactorTarget: null,
    reactionMutationGeneration: new Map(),
    selectedTopPoll: null,
    questions: [],
    classmates: [],
    activeClassmatesThisWeek: null,
    classmatesStatus: null,
    questionIndex: 0,
    choicesByQuestion: new Map(),
    // PlayViewModel's combined pool: uploaded contacts plus classmates.
    playContacts: [],
    playPool: [],
    playChoiceHistory: [],
    playBlockedUserIds: [],
    playNeedsFriends: false,
    playLocked: null,
    playComplete: false,
    playAuraEarned: 0,
    skipsUsedInSet: 0,
    playTransition: null,
    playLockTimer: null,
    inviteStatus: null,
    config: null,
    pendingQuestionSubmissionKey: null,
    pendingQuestionDraft: null,
    questionSubmissions: [],
    questionSubmissionsGeneration: 0,
    questionSubmissionToRemove: null,
    highlightedQuestionSubmissionId: null,
    askLink: null,
    askAccess: null,
    askSafetyNotices: [],
    askSafetyNoticeHistory: [],
    pendingAnonymousReportQuestionId: null,
    pendingAskStoryPlatform: null,
    askStoryFile: null,
    askStoryShareURL: null,
    anonymousInbox: null,
    selectedAnonymousQuestionId: null,
    anonymousInboxGeneration: 0,
    topQuestionsWeekly: null,
    topQuestionsAllTime: null,
    classmateDirectory: null,
    selectedClassmateProfile: null,
    selectedClassmateAskTarget: null,
    selectedClassmateTopQuestionsWeekly: null,
    selectedClassmateTopQuestionsAllTime: null,
    classmateProfileReturnToDirectory: false,
    classmateProfileGeneration: 0,
    passkeyStatus: null,
    pendingAuraPurchase: null,
    targetedBoostClassmates: null,
    stripeCheckoutSessionId: null,
    stripeCheckoutPollTimer: null,
    stripeCheckoutPollInFlight: false,
    godModeCancellation: null,
    godModeBilling: null,
    signupStep: 0,
    signupNearbySchools: [],
    signupSelectedSchool: null,
    signupSchoolFallback: false,
    signupSchoolLookupGeneration: 0,
    signupPhoneVerified: false,
    signupVerifiedPhone: null,
    signupCompletionUncertain: false,
    turnstileWidgetId: null,
    turnstileToken: null,
    turnstileResolve: null,
    turnstileReject: null,
    contactOnboarding: false,
    questionArtworkFile: null,
    questionArtworkSourceFile: null,
    questionArtworkPreviewURL: null,
    questionArtworkProcessing: false,
    questionCrop: null,
    contactClassmateIds: new Set(),
    optimisticEarnedProfile: null,
    pendingProfileInformation: null,
    profileDraft: null,
    profileEditor: "hub",
    profileNearbySchools: [],
    profileSchoolLookupGeneration: 0,
    profileCheckedUsername: null,
    profilePanelLoadedAt: 0,
    profilePanelLoading: null,
    viewportBaselineWidth: window.innerWidth,
    viewportBaselineHeight: window.innerHeight,
    layoutBaselineWidth: window.innerWidth,
    layoutBaselineHeight: window.innerHeight,
    layoutViewportGap: 0,
    layoutViewportExpected: 0,
    installPrompt: null,
    webPushSubscription: null,
    webPushBusy: false,
    webPushRegistrationState: "off",
    webPushRegistrationError: "",
    webPushSigningOut: false,
    feedbackHistory: [],
    feedbackHistoryGeneration: 0,
    highlightedFeedbackId: null,
    detailReturnFocus: null,
    detailUnderlyingScroll: null,
    feedLoadedAt: 0,
    pendingProfilePhoto: null,
    signupPhotoFile: null,
    signupPhotoURL: null,
    personalFeedItems: [],
    personalFeedHasMore: false,
    personalFeedLoaded: false,
    personalInboxVisible: false,
    personalInboxCutoff: null,
    tabScrollPositions: { feed: 0, play: 0, chats: 0, profile: 0 },
    navigationInitialized: false,
    handlingPopState: false,
    pullRefreshStartY: null,
    pullRefreshDistance: 0,
    waitingServiceWorker: null,
    appUpdateRequested: false,
};

const feedItemsStore = createRealtimeList({
    keyOf: (item) => item.question_answer_id,
});

function commitFeedItems(items, { reset = false } = {}) {
    state.feedItems = reset
        ? feedItemsStore.replace(items, { flush: "sync" })
        : feedItemsStore.upsert(items, { flush: "sync", merge: false });
    return state.feedItems;
}

// FeedViewModel.swift: a foreground refreshes a Feed older than 60 s; a tab
// return reuses anything loaded within tabReturnFreshness (120 s).
const FEED_FOREGROUND_REFRESH_MS = 60_000;
const FEED_TAB_RETURN_FRESHNESS_MS = 120_000;

function feedIsStale(maxAgeMs) {
    const loadedAt = state.feedLoadedAt;
    if (!loadedAt) return true;
    const age = Date.now() - loadedAt;
    return age < 0 || age >= maxAgeMs;
}

// /config is read at sign-in; features switched on later (or a config request
// that failed at sign-in) are picked up when the app returns to the foreground.
let configRefreshedAt = 0;
let configRefresh = null;
async function refreshConfig({ force = false } = {}) {
    if (!api.user?.id) return state.config;
    if (configRefresh) return configRefresh;
    if (!force && Date.now() - configRefreshedAt < 60_000) return state.config;
    configRefresh = (async () => {
        try {
            const fresh = await api.getConfig();
            configRefreshedAt = Date.now();
            const before = state.config || {};
            state.config = { ...before, ...fresh };
            const changed = ["enable_web_comments", "enable_stories", "enable_web_stories", "enable_tbh_requests", "enable_web_media_ingest"]
                .some((key) => before[key] !== state.config[key]);
            if (changed && document.body.classList.contains("authenticated")) {
                if (state.activePanel === "feed") renderFeed();
                void feedView?.refreshStories?.();
            }
        } catch (_) {
            // Keep the current config; the next foreground retries.
        } finally {
            configRefresh = null;
        }
        return state.config;
    })();
    return configRefresh;
}

function refreshFeedIfStale(maxAgeMs) {
    if (state.activePanel !== "feed" || !document.body.classList.contains("authenticated")) return;
    if (isFeedVoteLocked() || !state.feedItems.length || !feedIsStale(maxAgeMs)) return;
    void loadFeed(true);
}

startPerformanceMonitoring({ disabled: demoMode, getRoute: () => state.activePanel });

const parkedUIRoots = new Map();

function queryParkedUI(selector, all = false) {
    const matches = [];
    for (const fragment of parkedUIRoots.values()) {
        if (all) matches.push(...fragment.querySelectorAll(selector));
        else {
            const match = fragment.querySelector(selector);
            if (match) return match;
        }
    }
    return all ? matches : null;
}

const $ = (selector) => document.querySelector(selector) || queryParkedUI(selector);
const $$ = (selector) => [...document.querySelectorAll(selector), ...queryParkedUI(selector, true)];

function parkUIRoot(root) {
    if (!root?.childNodes.length || parkedUIRoots.has(root)) return;
    const fragment = document.createDocumentFragment();
    fragment.append(...root.childNodes);
    parkedUIRoots.set(root, fragment);
    root.dataset.uiParked = "true";
}

function mountUIRoot(root) {
    const fragment = parkedUIRoots.get(root);
    if (!fragment) return root;
    root.append(fragment);
    parkedUIRoots.delete(root);
    delete root.dataset.uiParked;
    return root;
}

function initializeParkedUI() {
    document.querySelectorAll("#anonymousAnswerDetailDialog").forEach(parkUIRoot);
    document.querySelectorAll("dialog:not(#deleteAccountDialog)").forEach((dialog) => {
        dialog.addEventListener("close", () => requestAnimationFrame(() => {
            if (!dialog.open) parkUIRoot(dialog);
        }));
        parkUIRoot(dialog);
    });
}

const nativeShow = HTMLDialogElement.prototype.show;
const nativeShowModal = HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.show = function showMountedDialog() {
    mountUIRoot(this);
    return nativeShow.call(this);
};
HTMLDialogElement.prototype.showModal = function showMountedModal() {
    mountUIRoot(this);
    const result = nativeShowModal.call(this);
    trackSheetHistory(this);
    return result;
};

// Android Back (and browser Back) closes the top sheet instead of leaving the
// screen: each app sheet gets a history entry while it is open.
const BACK_CLOSES_SHEET = "dialog.modal, dialog.ui-sheet";
const SHEET_REQUIRES_ACTION = "#askSafetyNoticeDialog, #pendingDeletionDialog";
let sheetSerial = 0;

function historyBack(steps = 1) {
    state.historyTraversalPending = true;
    if (steps > 1) history.go(-steps);
    else history.back();
}

function trackSheetHistory(dialog) {
    if (!document.body.classList.contains("authenticated") || !dialog.matches(BACK_CLOSES_SHEET)
        || dialog.matches(SHEET_REQUIRES_ACTION)) return;
    if (!dialog.id) dialog.id = `valid-sheet-${++sheetSerial}`;
    // A pending Back (e.g. a detail screen returning to this sheet) must land
    // first, or the new entry would be the one it pops.
    if (state.historyTraversalPending) {
        (state.deferredSheets ||= new Set()).add(dialog);
        return;
    }
    if (history.state?.sheet !== dialog.id) history.pushState({ ...history.state, validApp: true, sheet: dialog.id }, "", location.href);
    dialog.addEventListener("close", () => {
        // A detail screen that closed together with this sheet already unwound
        // both history entries (closeDetailScreen).
        if (state.unwoundSheets?.delete(dialog.id)) return;
        if (history.state?.sheet !== dialog.id) return;
        state.ignoreSheetPopState = true;
        historyBack();
    }, { once: true });
}

function closeTopSheetFromHistory(entry) {
    const sheet = [...$$(BACK_CLOSES_SHEET)].reverse().find((dialog) => dialog.open && !dialog.matches(SHEET_REQUIRES_ACTION));
    // Returning to the sheet's own entry keeps it; going below it closes it.
    if (!sheet || entry?.sheet === sheet.id) return false;
    // Run the sheet's own cancel handling (drafts, confirmations) like Escape does.
    if (sheet.dispatchEvent(new Event("cancel", { cancelable: true }))) sheet.close();
    if (sheet.open) history.pushState({ ...history.state, validApp: true, sheet: sheet.id }, "", location.href);
    return true;
}

// Kept for existing call sites; see user-message.js.
function friendlyErrorMessage(error, fallback = "Something went wrong. Please try again.") {
    return userMessage(error, fallback);
}

function appCacheKey(name) {
    return api.user?.id ? `valid:pwa:v1:${api.user.id}:${name}` : null;
}

function readAppCache(name) {
    const key = appCacheKey(name);
    if (!key) return null;
    try {
        const value = JSON.parse(localStorage.getItem(key) || "null");
        return value?.savedAt && Date.now() - value.savedAt < 7 * 86_400_000 ? value.data : null;
    } catch (_) {
        return null;
    }
}

function writeAppCache(name, data) {
    const key = appCacheKey(name);
    if (!key) return;
    try {
        localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
    } catch (_) { /* The live app remains authoritative when storage is unavailable. */ }
}

function clearCachedAppState(userId = api.user?.id) {
    if (!userId) return;
    for (const name of ["profile", "feed-personal", "classmates", "contact-classmates"]) {
        try { localStorage.removeItem(`valid:pwa:v1:${userId}:${name}`); }
        catch (_) { /* Session logout still continues. */ }
    }
}

function restoreCachedAppState() {
    const cachedProfile = readAppCache("profile");
    const cachedFeed = readAppCache("feed-personal");
    const cachedClassmates = readAppCache("classmates");
    const cachedContactClassmateIds = readAppCache("contact-classmates");
    if (cachedProfile) state.profile = cachedProfile;
    if (Array.isArray(cachedFeed)) {
        commitFeedItems(cachedFeed, { reset: true });
        state.personalFeedItems = state.feedItems.slice();
    }
    if (Array.isArray(cachedClassmates)) {
        state.classmates = cachedClassmates;
        state.classmateDirectory = cachedClassmates;
    }
    if (Array.isArray(cachedContactClassmateIds)) state.contactClassmateIds = new Set(cachedContactClassmateIds.map(String));
    if (state.profile) renderProfileHeader();
    if (state.feedItems.length) renderFeed();
}

function navigationURL(panel = state.activePanel, detail = null) {
    const url = new URL(location.href);
    if (panel === "feed") url.searchParams.delete("tab");
    else url.searchParams.set("tab", panel);
    if (panel !== "chats") url.searchParams.delete("chat");
    url.hash = detail ? `screen=${encodeURIComponent(detail)}` : "";
    return `${url.pathname}${url.search}${url.hash}`;
}

function writeNavigationState(mode, detail = null) {
    if (state.handlingPopState) return;
    // Tabs behave like the native app: Feed is the root, another tab sits one
    // entry above it (Back returns to Feed, then leaves), and re-taps or
    // tab-to-tab switches replace that entry instead of growing history.
    const tabOverFeed = detail ? false
        : mode === "replace" ? history.state?.tabOverFeed === true && state.activePanel !== "feed"
        : state.activePanel !== "feed";
    const payload = { validApp: true, panel: state.activePanel, detail, tabOverFeed };
    history[mode === "replace" ? "replaceState" : "pushState"](payload, "", navigationURL(state.activePanel, detail));
}

function initializeAppNavigation() {
    if (state.navigationInitialized) return;
    state.navigationInitialized = true;
    const requested = new URLSearchParams(location.search).get("tab");
    const panel = ["feed", "play", "chats", "profile"].includes(requested) ? requested : "feed";
    switchPanel(panel, { historyMode: "replace", restoreScroll: false });
}

function closeVisibleDetailScreens({ fromHistory = false } = {}) {
    for (const screen of $$(".detail-screen:not(.hidden)")) closeDetailScreen(screen, { fromHistory });
}

function handleAppPopState(event) {
    state.historyTraversalPending = false;
    const deferredSheets = [...(state.deferredSheets || [])];
    state.deferredSheets = null;
    if (!document.body.classList.contains("authenticated")) return;
    if (state.ignoreSheetPopState) {
        state.ignoreSheetPopState = false;
    } else if (!closeTopSheetFromHistory(event.state)) {
        state.handlingPopState = true;
        const keepDetail = event.state?.detail ? document.getElementById(event.state.detail) : null;
        for (const screen of $$(".detail-screen:not(.hidden)")) if (screen !== keepDetail) closeDetailScreen(screen, { fromHistory: true });
        const requestedPanel = event.state?.panel || new URLSearchParams(location.search).get("tab");
        const panel = ["feed", "play", "chats", "profile"].includes(requestedPanel) ? requestedPanel : "feed";
        // Closing a detail screen or sheet returns to the same tab: keep its live
        // scroll position instead of restoring one saved at the last tab switch.
        if (panel !== state.activePanel) switchPanel(panel, { historyMode: "none", restoreScroll: true });
        // Same tab (a detail screen or chat room closed): let the route sync
        // with the URL, e.g. Chats returns to its list, without touching scroll.
        else if (!event.state?.sheet) void activatePanelRoute(panel);
        const detail = event.state?.detail ? document.getElementById(event.state.detail) : null;
        if (detail?.classList.contains("detail-screen") && detail.classList.contains("hidden")) openDetailScreen(detail, { historyMode: "none" });
        state.handlingPopState = false;
    }
    deferredSheets.filter((dialog) => dialog.open).forEach(trackSheetHistory);
}

function syncVisualViewport() {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const focusedControl = document.activeElement?.matches?.("input:not([type=hidden]):not([type=file]), textarea, select") === true;
    if (!focusedControl && Math.abs(viewport.width - state.viewportBaselineWidth) > 80) {
        state.viewportBaselineWidth = viewport.width;
        state.viewportBaselineHeight = viewport.height;
    } else if (!focusedControl) {
        state.viewportBaselineWidth = Math.max(state.viewportBaselineWidth, viewport.width);
        state.viewportBaselineHeight = Math.max(state.viewportBaselineHeight, viewport.height);
    }
    const bottomInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    const keyboardOpen = focusedControl && state.viewportBaselineHeight - viewport.height > 140;
    // While WebKit leaves the layout viewport short (see checkStaleLayoutViewport),
    // the visible screen is still full height: size full-screen layouts to it.
    const height = !keyboardOpen && state.layoutViewportGap > 0
        ? Math.max(viewport.height, state.layoutViewportExpected - viewport.offsetTop)
        : viewport.height;
    setRuntimeStyles(document.documentElement, {
        "--visual-viewport-bottom": `${bottomInset}px`,
        "--visual-viewport-top": `${viewport.offsetTop}px`,
        "--visual-viewport-left": `${viewport.offsetLeft}px`,
        "--visual-viewport-center": `${viewport.offsetLeft + viewport.width / 2}px`,
        "--visual-viewport-middle": `${viewport.offsetTop + height / 2}px`,
        "--visual-viewport-width": `${viewport.width}px`,
        "--visual-viewport-height": `${height}px`,
        "--signup-visual-offset": `${viewport.offsetTop}px`,
    });
    document.documentElement.classList.toggle("keyboard-open", keyboardOpen);
    if (keyboardOpen) requestAnimationFrame(keepFocusedControlVisible);
    else if (!focusedControl) trackLayoutViewportBaseline();
}

// iOS 26 standalone WebKit sometimes leaves the layout viewport shrunk by the
// keyboard height after the keyboard closes (or after returning from another
// app): position:fixed; bottom:0 then anchors to the stale layout bottom and the
// tab bar floats mid-screen with content visible below it. WebKit bugs 297779
// and 301857; Apple Developer Forums thread 800125. Detect it by comparing a
// fixed bottom probe with the true screen bottom, nudge WebKit to re-measure,
// and otherwise translate fixed-bottom chrome onto the real bottom edge.
const TEXT_ENTRY = "input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]), textarea, select, [contenteditable=''], [contenteditable='true']";
let layoutViewportProbes = null;
let staleViewportTimers = [];

function staleViewportCheckApplies() {
    // Installed phone apps only: a desktop or tablet window can legitimately
    // change height without a keyboard.
    return isStandaloneApp() && Math.min(screen.width, screen.height) < 600;
}

function viewportIsMeasurable() {
    // Backgrounded or snapshotting pages can briefly report tiny sizes.
    return window.innerWidth >= 200 && window.innerHeight >= 200;
}

function trackLayoutViewportBaseline() {
    if (!viewportIsMeasurable()) return;
    const width = window.innerWidth;
    if (Math.abs(width - state.layoutBaselineWidth) > 80) {
        state.layoutBaselineWidth = width;
        state.layoutBaselineHeight = window.innerHeight;
    } else if (state.layoutViewportGap === 0) {
        // Follow small drift both ways, but never adopt a keyboard-sized drop:
        // that is exactly the stale state this baseline exists to detect.
        const height = window.innerHeight;
        if (height > state.layoutBaselineHeight || state.layoutBaselineHeight - height < 40) state.layoutBaselineHeight = height;
    }
}

function measureLayoutViewportGap() {
    if (!layoutViewportProbes) {
        layoutViewportProbes = ["bottom"].map((kind) => {
            const probe = document.createElement("div");
            probe.className = `viewport-probe viewport-probe-${kind}`;
            probe.setAttribute("aria-hidden", "true");
            document.body.append(probe);
            return probe;
        });
    }
    const [bottomProbe] = layoutViewportProbes;
    const viewport = window.visualViewport;
    const fixedBottom = Math.min(bottomProbe.getBoundingClientRect().bottom, window.innerHeight);
    // Only direct evidence counts: the visible area reaching clearly past the
    // fixed bottom (WebKit left the layout viewport short). 100lvh and a
    // remembered healthy height disagree with the page on a healthy installed
    // iPhone app (the status bar sits outside the page) and pushed the tab bar
    // off the screen, so they are not used.
    const visibleBottom = viewport ? viewport.offsetTop + viewport.height : fixedBottom;
    const expected = visibleBottom - fixedBottom >= 40 ? visibleBottom : fixedBottom;
    return { gap: Math.max(0, Math.round(expected - fixedBottom)), expected };
}

function applyLayoutViewportGap(gap, expected = 0) {
    if (gap === state.layoutViewportGap) return;
    state.layoutViewportGap = gap;
    state.layoutViewportExpected = expected;
    document.documentElement.classList.toggle("layout-viewport-stale", gap > 0);
    setRuntimeStyles(document.documentElement, { "--layout-viewport-gap": gap > 0 ? `${gap}px` : null });
    syncVisualViewport();
}

function checkStaleLayoutViewport({ nudge = true } = {}) {
    if (!viewportIsMeasurable()) return;
    if (!staleViewportCheckApplies() || document.activeElement?.matches?.(TEXT_ENTRY)
        || document.documentElement.classList.contains("keyboard-open")) {
        applyLayoutViewportGap(0);
        return;
    }
    const { gap, expected } = measureLayoutViewportGap();
    if (gap < 40) {
        applyLayoutViewportGap(0);
        return;
    }
    if (nudge) {
        // A same-position scroll plus a resize pass is often enough for WebKit to
        // restore the layout viewport; measure again once it has had a frame.
        const { scrollX, scrollY } = window;
        window.scrollTo(scrollX, scrollY + 1);
        window.scrollTo(scrollX, scrollY);
        syncVisualViewport();
        requestAnimationFrame(() => requestAnimationFrame(() => checkStaleLayoutViewport({ nudge: false })));
        return;
    }
    applyLayoutViewportGap(gap, expected);
}

function scheduleStaleViewportCheck() {
    staleViewportTimers.forEach(clearTimeout);
    // The keyboard and app-switch animations settle over ~½ s; check through them.
    staleViewportTimers = [60, 350, 900].map((delay) => setTimeout(checkStaleLayoutViewport, delay));
}

let visualViewportFrame = null;

function scheduleVisualViewportSync() {
    if (visualViewportFrame !== null) return;
    visualViewportFrame = requestAnimationFrame(() => {
        visualViewportFrame = null;
        syncVisualViewport();
    });
}

function keepFocusedControlVisible() {
    const control = document.activeElement;
    if (!control?.matches?.("input:not([type=hidden]):not([type=file]), textarea, select")) return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const rect = control.getBoundingClientRect();
    const safeTop = viewport.offsetTop + 14;
    const safeBottom = viewport.offsetTop + viewport.height - 18;
    const delta = rect.bottom > safeBottom
        ? rect.bottom - safeBottom
        : rect.top < safeTop
            ? rect.top - safeTop
            : 0;
    if (!delta) return;
    const scroller = control.closest(".signup-step, dialog.modal, .detail-screen");
    if (scroller) scroller.scrollBy({ top: delta, behavior: "smooth" });
}

function escapeHTML(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function relativeTime(value) {
    const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
    if (!Number.isFinite(seconds)) return "recently";
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    const ranges = [[60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.345, "week"], [12, "month"], [Infinity, "year"]];
    let duration = seconds;
    for (const [amount, unit] of ranges) {
        if (Math.abs(duration) < amount) return formatter.format(Math.round(duration), unit);
        duration /= amount;
    }
    return "recently";
}

// PollCommentsView.swift / ReactionViews.swift timestamp: "now", "5m", "3h", "2d", then "Sep 3".
function shortRelativeTime(value) {
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return "";
    const elapsed = Math.max(0, (Date.now() - time) / 1000);
    if (elapsed < 60) return "now";
    if (elapsed < 3_600) return `${Math.floor(elapsed / 60)}m`;
    if (elapsed < 86_400) return `${Math.floor(elapsed / 3_600)}h`;
    if (elapsed < 604_800) return `${Math.floor(elapsed / 86_400)}d`;
    return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function setButtonLoading(button, loading, loadingLabel = "Working...") {
    if (!button.dataset.label) button.dataset.label = button.textContent.trim();
    button.disabled = loading;
    button.textContent = loading ? loadingLabel : button.dataset.label;
}

function displayName(profile) {
    return [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || profile?.username || "Valid user";
}

function initials(profile) {
    const letters = [profile?.first_name, profile?.last_name].filter(Boolean).map((part) => part[0]).join("");
    return (letters || profile?.username?.[0] || "V").toUpperCase();
}

function avatarMarkup(profile, className = "row-avatar", fallbackURL = null) {
    const originalURL = api.assetURL(profile?.profile_picture_url || fallbackURL);
    const imageURL = api.assetURL(profile?.profile_picture_url_thumb) || originalURL;
    const fallbackInitials = initials(profile);
    const image = mediaImageMarkup([imageURL, originalURL], { alt: displayName(profile), initials: fallbackInitials });
    return `<span class="${className}">${image || `<span>${escapeHTML(fallbackInitials)}</span>`}</span>`;
}

/** An avatar image (or the initials) for a profile, largest-first sources. */
function profileImageMarkup(profile, sources, { alt = displayName(profile) } = {}) {
    const urls = sources.map((source) => api.assetURL(source)).filter(Boolean);
    return mediaImageMarkup(urls, { alt, initials: initials(profile) }) || `<span>${escapeHTML(initials(profile))}</span>`;
}

/** A public artwork image; falls back across media hosts, then a neutral placeholder. */
function publicImageMarkup(url, options = {}) {
    return mediaImageMarkup(api.assetURL(url), options);
}

function hasCustomProfilePicture(profile) {
    const profilePictureURL = String(profile?.profile_picture_url || "").trim().toLowerCase();
    return Boolean(profilePictureURL) && !profilePictureURL.includes("default.png");
}

function sortClassmatesLikeIOS(classmates) {
    return (classmates || [])
        .map((classmate, index) => ({ classmate, index }))
        .sort((first, second) => {
            const firstIsContact = state.contactClassmateIds.has(String(first.classmate.user_id));
            const secondIsContact = state.contactClassmateIds.has(String(second.classmate.user_id));
            if (firstIsContact !== secondIsContact) return firstIsContact ? -1 : 1;

            const firstHasPhoto = hasCustomProfilePicture(first.classmate);
            const secondHasPhoto = hasCustomProfilePicture(second.classmate);
            if (firstHasPhoto !== secondHasPhoto) return firstHasPhoto ? -1 : 1;

            const weeklyVoteDifference = Number(second.classmate.weekly_vote_count || 0) - Number(first.classmate.weekly_vote_count || 0);
            return weeklyVoteDifference || first.index - second.index;
        })
        .map(({ classmate }) => classmate);
}

// Brand artwork from the iOS asset catalog (SocialSharingButtons.swift: SnapchatGlyph,
// InstagramIconButton, TikTokIconButton) instead of redrawn marks.
const SHARE_PLATFORM_ARTWORK = {
    snapchat: "snapchat-logo.webp",
    instagram: "instagram.webp",
    tiktok: "tiktok-icon-black-square.webp",
};

function shareIconMarkup(platform) {
    const file = SHARE_PLATFORM_ARTWORK[platform] || SHARE_PLATFORM_ARTWORK.snapchat;
    return `<img class="share-platform-art" loading="lazy" decoding="async" src="../assets/app/${file}" alt="" width="58" height="58">`;
}

function appSymbolMarkup(symbol, className = "app-symbol") {
    const icons = {
        ask: `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5.2 3h13.6A3.2 3.2 0 0 1 22 6.2v8.1a3.2 3.2 0 0 1-3.2 3.2h-7.2L6 21.3v-3.8h-.8A3.2 3.2 0 0 1 2 14.3V6.2A3.2 3.2 0 0 1 5.2 3Z"/><g transform="translate(0 -1.5)"><path d="M9.3 8.6A2.9 2.9 0 0 1 12 7.1c1.7 0 3 1 3 2.5 0 1.3-.7 2-1.8 2.6-.9.5-1.2.9-1.2 1.8" fill="none" stroke="white" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="15.8" r="1" fill="white"/></g></svg>`,
        tbh: `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5.2 3h13.6A3.2 3.2 0 0 1 22 6.2v8.1a3.2 3.2 0 0 1-3.2 3.2h-7.2L6 21.3v-3.8h-.8A3.2 3.2 0 0 1 2 14.3V6.2A3.2 3.2 0 0 1 5.2 3Z"/><g transform="translate(0 -1.5)"><path fill="white" d="M6.8 8h4.4v3.4c0 2.4-1.2 4-3.6 4.8l-.9-1.7c1.2-.4 1.8-1.1 1.9-2H6.8V8Zm6 0h4.4v3.4c0 2.4-1.2 4-3.6 4.8l-.9-1.7c1.2-.4 1.8-1.1 1.9-2h-1.8V8Z"/></g></svg>`,
        link: `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 14.5 14.5 9M8 17H6.5a4.5 4.5 0 0 1 0-9H10M16 7h1.5a4.5 4.5 0 0 1 0 9H14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        message: `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4.8 3h14.4A3.8 3.8 0 0 1 23 6.8v8.4a3.8 3.8 0 0 1-3.8 3.8h-8.1L5 22v-3.2A3.8 3.8 0 0 1 1 15V6.8A3.8 3.8 0 0 1 4.8 3Z"/><path d="M6.5 9h11M6.5 13h7" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>`,
        reset: `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 8.2A8 8 0 1 1 12 4M16 4h4v4" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        shield: `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8 20 6v5.4c0 4.8-3.1 8.1-8 9.8-4.9-1.7-8-5-8-9.8V6l8-3.2Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8.3 8.2h7.4v7.2H8.3zM8.3 11.8h7.4M12 8.2v7.2" fill="none" stroke="currentColor" stroke-width="1.25"/></svg>`,
    };
    return icons[symbol] || "";
}

function openDetailScreen(screen, { historyMode = "push" } = {}) {
    mountUIRoot(screen);
    closeDetailActionMenus();
    state.detailReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!$(".detail-screen:not(.hidden)")) state.detailUnderlyingScroll = { panel: state.activePanel, y: window.scrollY };
    screen.classList.remove("hidden");
    screen.classList.remove("detail-screen-closing");
    screen.classList.add("detail-screen-opening");
    screen.scrollTop = 0;
    document.body.classList.add("detail-screen-open");
    if (historyMode !== "none" && history.state?.detail !== screen.id) writeNavigationState(historyMode, screen.id);
    requestAnimationFrame(() => screen.classList.remove("detail-screen-opening"));
    screen.querySelector("[aria-label='Close'], [data-focus-on-open]")?.focus({ preventScroll: true, focusVisible: false });
}

function closeDetailScreen(screen, { fromHistory = false } = {}) {
    closeDetailActionMenus();
    screen.classList.add("hidden");
    if (!$(".detail-screen:not(.hidden)")) {
        document.body.classList.remove("detail-screen-open");
        // Some engines reset the page while it is scroll-locked; put it back exactly.
        const underlying = state.detailUnderlyingScroll;
        state.detailUnderlyingScroll = null;
        if (underlying?.panel === state.activePanel && Math.abs(window.scrollY - underlying.y) > 1) window.scrollTo(0, underlying.y);
    }
    state.detailReturnFocus?.focus?.({ preventScroll: true });
    state.detailReturnFocus = null;
    if (!fromHistory && history.state?.detail === screen.id) {
        // A sheet opened over this screen (e.g. a report) may still own the top
        // entry if it closed in the same task: pop both, or the landing entry
        // would be this screen's and Back handling would reopen it.
        const sheetId = history.state.sheet;
        if (sheetId && !state.ignoreSheetPopState) {
            (state.unwoundSheets ||= new Set()).add(sheetId);
            historyBack(2);
        } else {
            historyBack();
        }
    }
}

function closeDetailActionMenus() {
    $$(".detail-overflow-menu").forEach((menu) => menu.classList.add("hidden"));
    $$(".detail-overflow-button").forEach((button) => button.setAttribute("aria-expanded", "false"));
}

function toggleDetailActionMenu(button) {
    const menu = button.closest(".detail-overflow")?.querySelector(".detail-overflow-menu");
    if (!menu) return;
    const willOpen = menu.classList.contains("hidden");
    closeDetailActionMenus();
    menu.classList.toggle("hidden", !willOpen);
    button.setAttribute("aria-expanded", String(willOpen));
}

function showSignedOut(message = "") {
    weeklyGameGeneration++;
    weeklyGame?.close();
    resetWeeklyGameEntry();
    stopPlayInviteRefresh();
    document.querySelector("#playInviteDialog")?.close();
    void presenceLifecycle?.stop();
    document.querySelectorAll(".activity-settings-dialog").forEach(dialog => dialog.close());
    clearInterval(state.playLockTimer);
    state.playLockTimer = state.playLockTick = null;
    stopStripeCheckoutPolling();
    document.querySelector(".app-banner")?.remove();
    showAuthView();
    $("#appView").classList.add("hidden");
    $("#bottomNav").classList.add("hidden");
    $("#logoutButton").classList.add("hidden");
    document.body.classList.remove("authenticated", "play-active");
    state.navigationInitialized = false;
    state.tabScrollPositions = { feed: 0, play: 0, chats: 0, profile: 0 };
    state.feedLoadedAt = 0;
    state.playTransition = null;
    state.personalFeedItems = [];
    state.personalFeedHasMore = false;
    state.personalFeedLoaded = false;
    state.personalInboxVisible = false;
    state.personalInboxCutoff = null;
    void commentsViewPromise?.then((view) => view.clear()).catch(() => null);
    $("#authStatus").textContent = friendlyErrorMessage(message, "");
}

const PRIOR_SESSION_KEY = "valid:signed-in-before";

function hideLaunchSplash() {
    clearTimeout(state.launchSplashTimer);
    $("#launchSplash").classList.add("hidden");
}

function showAuthView() {
    hideLaunchSplash();
    $("#authView").classList.remove("hidden");
}

function isFirstVisit() {
    try {
        return localStorage.getItem(PRIOR_SESSION_KEY) !== "1" && !localStorage.getItem("valid.web.installation-id");
    } catch (_) {
        return true;
    }
}

async function showSignedIn() {
    sessionRestorePending = false;
    $("#retrySessionButton").classList.add("hidden");
    $("#createAccountButton").classList.remove("hidden");
    $("#authView").classList.add("hidden");
    hideLaunchSplash();
    try { localStorage.setItem(PRIOR_SESSION_KEY, "1"); } catch (_) { /* First-visit detection falls back to the installation id. */ }
    // Notification links carry ?signin=1 for signed-out devices; drop it once in.
    const launchURL = new URL(location.href);
    if (launchURL.searchParams.has("signin")) {
        launchURL.searchParams.delete("signin");
        history.replaceState(history.state, "", `${launchURL.pathname}${launchURL.search}${launchURL.hash}`);
    }
    $("#appView").classList.remove("hidden");
    $("#bottomNav").classList.remove("hidden");
    $("#logoutButton").classList.remove("hidden");
    document.body.classList.add("authenticated");
    document.body.classList.toggle("android-device", isAndroidDevice());
    syncVisualViewport();
    requestAnimationFrame(() => requestAnimationFrame(syncVisualViewport));
    setTimeout(syncVisualViewport, 120);
    restoreCachedAppState();
    if (!state.feedItems.length && !isFeedVoteLocked()) renderFeedSkeleton();
    const deferredAccountState = Promise.all([
        api.getAnonymousAskAccess(api.user.id).catch(() => null),
        api.getAnonymousAskSafetyNotices(api.user.id).catch(() => []),
        api.getAnonymousAskSafetyNotices(api.user.id, true).catch(() => []),
        api.getPasskeyStatus().catch(() => null),
    ]);
    try {
        const [profile, currentUser, classmatesStatus, config] = await Promise.all([
            api.getProfile(api.user.id),
            api.getUser(api.user.id).catch(() => api.user),
            api.getClassmatesStatus(api.user.id).catch(() => null),
            api.getConfig().catch(() => ({
                nomination_aura_cost: 100,
                tbh_request_aura_cost: 100,
                question_submission_aura_cost: 200,
                max_custom_question_length: 280,
                max_skips_per_set: 3,
                play_lock_time_seconds: 60,
                full_reveal_aura_cost: DEFAULT_FULL_REVEAL_AURA_COST,
                enable_tbh_requests: false,
                enable_web_comments: false,
            })),
        ]);
        api.user = { ...api.user, ...currentUser };
        state.profile = profile;
        state.classmatesStatus = classmatesStatus;
        state.config = config;
        // The Feed may have activated before config arrived: build Stories now.
        void feedView?.refreshStories?.();
        const chatsEnabled = config.enable_chats === true && config.enable_web_chats === true;
        if (chatsEnabled && !chatPresence) {
            const { createChatPresence, bindPresenceLifecycle } = await import('./chat/presence.js');
            chatPresence = createChatPresence({ api });
            presenceLifecycle = bindPresenceLifecycle(chatPresence);
            const button = document.createElement('button');
            button.id = 'activityStatusButton';
            button.setAttribute('aria-label', 'Activity Status');
            button.type = 'button';
            button.className = 'settings-row';
            button.innerHTML = `<span class="settings-icon" aria-hidden="true">${uiIcon('activity')}</span><span><strong>Activity Status</strong><small>Choose whether people see when you’re active</small></span><span aria-hidden="true">›</span>`;
            button.addEventListener('click', async () => {
                try {
                    const { openActivitySettings } = await import('./chat/activity-settings.js');
                    if (api.user?.id) await openActivitySettings({ api, userId: api.user.id, presence: chatPresence });
                } catch (_) { showToast("Activity status couldn’t be loaded. Please try again."); }
            });
            $('#blockedUsersButton').before(button);
        }
        presenceLifecycle?.setUser(chatsEnabled ? api.user.id : null);
        // Incoming calls ring from any tab, not only after Chats has been opened.
        if (chatsEnabled && config.enable_calls === true && config.enable_web_calls === true) {
            callListenerStarted = true;
            void import("./calls/service.js")
                .then(({ startCallListener }) => startCallListener({ api, getUser: () => api.user, getConfig: () => state.config, showToast }))
                .catch(() => null);
        }
        $("#activityStatusButton")?.classList.toggle("hidden", !chatsEnabled);
        $('.nav-item[data-panel="chats"]').classList.toggle("hidden", !chatsEnabled);
        $("#bottomNav").classList.toggle("chats-enabled", chatsEnabled);
        writeAppCache("profile", profile);
        renderProfileHeader();
        renderFeedGate();
        initializeAppNavigation();
        void refreshBanner({ force: true });
        refreshWebPushStatus({ sync: true });
        if (!isFeedVoteLocked()) await loadFeed(true);
        await handleNotificationRoute();
        await handleGodModeManagementRoute();
        if (api.user?.deletion_requested_at) showPendingDeletion();
        void deferredAccountState.then(([askAccess, askSafetyNotices, askSafetyNoticeHistory, passkeyStatus]) => {
            state.askAccess = askAccess;
            state.askSafetyNotices = askSafetyNotices;
            state.askSafetyNoticeHistory = askSafetyNoticeHistory;
            state.askSafetyRefreshedAt = Date.now();
            state.passkeyStatus = passkeyStatus;
            renderPasskeyStatus();
            if (!api.user?.deletion_requested_at) showNextAskSafetyNotice();
            maybePromptForPasskeyEnrollment();
        });
    } catch (error) {
        if (!error.confirmedSessionInvalid) $("#feedStatus").textContent = userMessage(error, "Could not load your profile.");
    }
}

// Keep the management intent in the URL through sign-in, then open the same
// account settings used by the normal unsubscribe button. A link never cancels.
async function handleGodModeManagementRoute() {
    const url = new URL(location.href);
    if (url.searchParams.get("manage") !== "god-mode") return;
    if (!api.user?.id || !document.body.classList.contains("authenticated")) return;
    url.searchParams.delete("manage");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
    switchPanel("profile");
    openProfileDialog();
}

async function handleNotificationRoute() {
    const params = new URLSearchParams(location.search);
    const notification = params.get("notification");
    const commentId = params.get("comment_id");
    if (!notification) return;
    if (notification === "streak_warning") {
        switchPanel("play");
        const warningId = params.get("streak_warning_id");
        if (warningId) await api.recordStreakWarningOpen(warningId).catch(() => null);
    } else if (notification === "feedback_response") {
        switchPanel("profile");
        await openFeedbackDialog(params.get("feedback_id"));
    } else if (notification === "targeted_by_boost") {
        await preloadRoute("play");
        switchPanel("play");
        await loadPlay();
        const message = "A secret admirer is now appearing more often in your polls.";
        $("#playStatus").textContent = message;
        showToast("A secret admirer is in your polls");
    } else if (["aura_gifted", "boost_expired", "target_voted"].includes(notification)) {
        await preloadRoute("profile");
        switchPanel("profile");
        await loadProfilePanel({ force: true });
        const targetUserId = params.get("target_user_id");
        const openedTarget = notification === "target_voted" && targetUserId
            && [...(state.classmateDirectory || []), ...(state.classmates || [])]
                .some((classmate) => String(classmate.user_id) === String(targetUserId));
        if (openedTarget) {
            await openClassmateProfile(targetUserId);
            showToast("Your boost worked — they voted for you");
        } else {
            const boostType = params.get("boost_type") === "targeted" ? "targeted" : "global";
            const message = notification === "aura_gifted"
                ? `Your aura balance is up to date: ${Number(state.profile?.aura_points || 0).toLocaleString()} aura.`
                : notification === "target_voted"
                    ? "Your targeted boost worked. Current boost status is shown below."
                    : `Your ${boostType} boost ended. Current boost status is shown below.`;
            $("#profileStatus").textContent = message;
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const target = notification === "aura_gifted"
                ? $("[data-profile-stat='aura']")
                : $("#purchasesSection");
            if (target) {
                target.tabIndex = -1;
                target.classList.add("profile-notification-target");
                target.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
                target.focus({ preventScroll: true });
            }
        }
    } else if (isFeedVoteLocked() && notification !== "question_submission") {
        return;
    } else if (notification === "question_submission") {
        switchPanel("feed");
        openQuestionDialog({ section: "history", submissionId: params.get("submission_id") });
    } else if (notification === "tbh_request") {
        switchPanel("feed");
        await loadTbhContent();
        const requestId = params.get("tbh_request_id");
        if (state.tbhPendingRequests.some((item) => String(item.id) === String(requestId))) openTbhComposer(requestId);
    } else if (notification === "tbh_response") {
        switchPanel("feed");
        await loadTbhContent();
        const responseId = params.get("tbh_response_id");
        let kind = state.tbhInboxItems.some((item) => String(item.id) === String(responseId))
            ? "received"
            : state.tbhSentItems.some((item) => String(item.id) === String(responseId))
            ? "sent"
            : state.schoolTbhItems.some((item) => String(item.id) === String(responseId)) ? "school" : null;
        if (!kind && responseId) {
            const response = await api.getTbhResponse(api.user.id, responseId).catch(() => null);
            if (response) {
                state.tbhInboxItems.unshift(response);
                kind = "received";
                renderFeed();
            }
        }
        if (kind) await openTbhDetail(`${kind}:${responseId}`);
        const activityId = params.get("activity_id") || [state.tbhInboxItems, state.tbhSentItems, state.schoolTbhItems]
            .flat()
            .find((item) => String(item.id) === String(responseId))?.activity_id;
        if (commentId && activityId && commentsEnabled()) {
            await openCommentsForTarget("activity", activityId, { commentId });
        }
    } else if (notification === "feed_item") {
        switchPanel("feed");
        const answerId = params.get("question_answer_id");
        if (!state.feedItems.some((item) => String(item.question_answer_id) === String(answerId))) {
            const item = await api.getFeedItem(api.user.id, answerId).catch(() => null);
            if (item) state.feedItems.unshift(item);
        }
        if (state.feedItems.some((item) => String(item.question_answer_id) === String(answerId))) {
            openFeedDetail(answerId);
            if (commentId && commentsEnabled()) await openCommentsForTarget("poll", answerId, { commentId });
        }
    }
    params.delete("notification");
    params.delete("tbh_request_id");
    params.delete("tbh_response_id");
    params.delete("question_answer_id");
    params.delete("submission_id");
    params.delete("streak_warning_id");
    params.delete("feedback_id");
    params.delete("activity_id");
    params.delete("comment_id");
    params.delete("boost_type");
    params.delete("target_user_id");
    history.replaceState(history.state, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
}

// Notification taps route inside the running app (no reload). The URL contract
// is the backend's web push `url`: ?tab=, &chat=&message=, &call=, &story=
// (&viewers=1 from the worker), or ?notification=<type>&... for detail routes.
async function routeToAppURL(href) {
    let target;
    try { target = new URL(href, location.origin); } catch (_) { return; }
    if (target.origin !== location.origin || !target.pathname.startsWith("/app/")) return;
    target.searchParams.delete("signin");
    const requested = target.searchParams.get("tab");
    const panel = ["feed", "play", "chats", "profile"].includes(requested) ? requested : "feed";
    const url = `${target.pathname}${target.search}`;
    if (!api?.hasSession() || !document.body.classList.contains("authenticated")) {
        // Signed-out or still starting: sign-in picks the route up from the URL.
        history.replaceState(history.state, "", url);
        return;
    }
    closeVisibleDetailScreens({ fromHistory: true });
    for (const dialog of $$("dialog.modal[open]")) {
        if (!dialog.matches("#pendingDeletionDialog, #askSafetyNoticeDialog")) dialog.close();
    }
    history.pushState({ validApp: true, panel }, "", url);
    if (target.searchParams.get("manage") === "god-mode") {
        await handleGodModeManagementRoute();
        return;
    }
    if (target.searchParams.has("notification")) {
        await handleNotificationRoute();
        return;
    }
    // Switching (even to the current tab) re-activates the route, which reads
    // ?chat=/&message=/&call= itself.
    switchPanel(panel, { historyMode: "none", restoreScroll: false });
    if (panel === "feed" && target.searchParams.has("story")) await (await prepareFeedView()).refreshStories?.();
}

function handleServiceWorkerMessage(event) {
    const message = event.data || {};
    if (message.type === "VALID_NOTIFICATION_CLICK") void routeToAppURL(message.url || "./");
    else if (message.type === "VALID_CALL_DECLINE" && api?.user?.id && message.callId) {
        api.declineCall(api.user.id, message.callId).catch(() => showToast("Could not decline the call."));
    } else if (message.type === "VALID_INCOMING_CALL" && message.callId && callListenerStarted) {
        // The worker skipped the system ringer because this page is visible;
        // ring here even if the realtime stream has not delivered it yet.
        void import("./calls/service.js").then(({ callService }) => callService({ api, getUser: () => api.user, getConfig: () => state.config, showToast }).calls.open(String(message.callId))).catch(() => null);
    } else if (message.type === "VALID_CALL_ENDED" && message.callId && callListenerStarted) {
        void import("./calls/service.js").then(({ callService }) => callService({ api, getUser: () => api.user, getConfig: () => state.config, showToast }).calls.handleRealtimeEvent({ type: "call_ended", call_id: String(message.callId) })).catch(() => null);
    } else if (message.type === "VALID_PUSH_IN_ACTIVE_CHAT") {
        // The open room already shows the message through realtime.
        dispatchEvent(new CustomEvent("valid:push-in-active-chat", { detail: message }));
    }
}

// Lets the worker skip the system notification for the chat on screen.
function reportActiveChat() {
    navigator.serviceWorker?.controller?.postMessage({
        type: "VALID_ACTIVE_CHAT",
        chatId: document.documentElement.dataset.activeChatId || null,
        visible: document.visibilityState === "visible",
    });
}

// Server announcement banners (iOS BannerNotificationView parity): at launch
// and when the app returns to the foreground, at most every 10 minutes.
let bannerCheckedAt = 0;

async function refreshBanner({ force = false } = {}) {
    if (!api?.user?.id || !api.getActiveBanner || (!force && Date.now() - bannerCheckedAt < 600_000)) return;
    bannerCheckedAt = Date.now();
    try {
        const banner = await api.getActiveBanner();
        if (!document.body.classList.contains("authenticated")) return;
        if (!banner) document.querySelector(".app-banner")?.remove();
        else (await import("./banner.js")).showBanner(banner);
    } catch (_) { /* Banners are optional; keep whatever is showing. */ }
}

function renderProfileHeader() {
    const profile = state.profile;
    if (!profile) return;
    $("#auraCount").textContent = Number(profile.aura_points || 0).toLocaleString();
    $("#playStreakCount").textContent = Math.max(0, Number(profile.current_streak || 0)).toLocaleString();
    const multiplier = Math.max(1, Number(profile.streak_multiplier || 1));
    const multiplierElement = $("#playStreakMultiplier");
    multiplierElement.textContent = `(${multiplier.toFixed(1)}x)`;
    multiplierElement.classList.toggle("hidden", multiplier <= 1);
    $("#questionIdentityName").textContent = displayName(profile);
    $("#questionIdentityAvatar").innerHTML = profileImageMarkup(profile, [profile.profile_picture_url_thumb, profile.profile_picture_url], { alt: "" });
}

function formatGrade(value = "") {
    return String(value).replace("S/O", "C/O").replace("Grade ", "");
}

function voterFirstLetterHint(item) {
    const hint = String(item?.voter_first_letter_hint || "").trim();
    return Array.from(hint)[0]?.toLocaleUpperCase() || "";
}

function formatVoterHint(item) {
    return feedVoterLine(item, { personal: state.feedType === 'personal', currentName: state.profile ? displayName(state.profile) : '',
        subscriber: api.user?.subscribed_user === true, safeGrade: senderGradeIsSafe(item.voter_grade, state.classmates) });
}

function formatVoterDemographicsStatement(item) {
    return senderStatement(item, { safeGrade: senderGradeIsSafe(item.voter_grade, state.classmates) }) || "Poll";
}

// iOS QuestionDetailView.voterInfoText: the title is always the anonymous
// descriptor ("A Junior Boy said", with its emoji), never a name, even for your own vote
// or a revealed voter (reveals show in their own "Sent by" row).
function formatVoterStatement(item) {
    return formatVoterDemographicsStatement(item);
}

function renderProfilePolls(container, questions, emptyMessage) {
    if (!questions?.length) {
        container.innerHTML = `<div class="profile-poll-empty">${escapeHTML(emptyMessage)}</div>`;
        return;
    }
    container.innerHTML = questions.map((question, index) => {
        const pollKey = `${question.question_id || question.id || index}`;
        return `<button class="profile-poll-row" type="button" data-top-poll="${escapeHTML(pollKey)}" aria-label="Open poll: ${escapeHTML(question.question_text)}">
            <div class="profile-poll-art">${publicImageMarkup(question.image_url) || `<span>${index + 1}</span>`}</div>
            <div class="profile-poll-copy"><strong>${escapeHTML(question.question_text)}</strong><span>${uiIcon("heart")} ${Number(question.vote_count || 0).toLocaleString()} votes</span></div>
            <span class="profile-poll-chevron" aria-hidden="true">›</span>
        </button>`;
    }).join("");
}

function currentProfileSchoolName() {
    const profileSchoolName = String(state.profile?.school_name || "").trim();
    const classmates = state.classmateDirectory?.length
        ? state.classmateDirectory
        : (state.classmates || []);
    const matchingClassmateSchoolName = classmates.find((classmate) => (
        String(classmate.school_id || "") === String(state.profile?.school_id || "")
        && String(classmate.school_name || "").trim()
    ))?.school_name;
    return profileSchoolName || String(matchingClassmateSchoolName || "").trim();
}

function profileInformationIcon(isAvailable) {
    return isAvailable
        ? `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4" width="19" height="16" rx="2.5"></rect><circle cx="8" cy="10" r="2"></circle><path d="M5 16c.6-1.8 1.6-2.7 3-2.7s2.4.9 3 2.7M14 9h4M14 13h4"></path></svg>`
        : `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2.5"></rect><path d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10"></path></svg>`;
}

function renderProfilePanel() {
    const profile = state.profile;
    if (!profile) return;
    const imageURL = api.assetURL(profile.profile_picture_url_medium || profile.profile_picture_url);
    const schoolName = currentProfileSchoolName();
    const grade = formatGrade(profile.grade || "").replace(/^Grade\s+/i, "");
    const canChangeInformation = profile.can_change_information !== false;
    const streak = Math.max(0, Number(profile.current_streak || 0));
    const pendingPhoto = state.pendingProfilePhoto;
    const hasProfilePhoto = Boolean(pendingPhoto || (imageURL && !String(profile.profile_picture_url || "").includes("default.png")));
    $("#profileCard").innerHTML = `<article class="full-profile-card">
        <button class="profile-photo-button ${pendingPhoto ? `photo-${pendingPhoto.status}` : ""}" type="button" data-edit-photo aria-label="${pendingPhoto?.status === "failed" ? "Photo upload failed. Try again" : pendingPhoto ? "Uploading profile picture" : "Change profile picture"}" ${pendingPhoto?.status === "uploading" ? 'aria-busy="true"' : ""}>
            <span class="full-profile-avatar">${pendingPhoto ? `<img decoding="async" src="${escapeHTML(pendingPhoto.url)}" alt="">` : imageURL ? profileImageMarkup(profile, [profile.profile_picture_url_medium, profile.profile_picture_url]) : `<span>${escapeHTML(initials(profile))}</span>`}</span>
            ${pendingPhoto?.status === "uploading" ? '<span class="photo-upload-spinner" aria-hidden="true"></span>' : ""}
            <span class="photo-edit-badge" aria-hidden="true">${pendingPhoto?.status === "failed" ? "!" : uiIcon("edit")}</span>
        </button>
        ${pendingPhoto?.status === "failed" ? '<p class="profile-photo-warning" role="status">Upload failed. Tap your photo to try again.</p>' : ""}
        ${hasProfilePhoto ? "" : '<p class="profile-photo-warning">\u26a0\ufe0f Users without profile pictures receive less votes.</p>'}
        <h3>${escapeHTML(displayName(profile))}</h3>
        <div class="profile-identity-line"><span class="profile-handle">@${escapeHTML(profile.username || "valid")}</span>${streak ? `<span class="profile-streak ${profile.streak_needs_activity ? "needs-activity" : ""}" aria-label="${streak} day streak">${uiIcon("fire")} ${streak}</span>` : ""}</div>
        <button class="profile-bio-button ${profile.bio ? "" : "empty"}" type="button" data-edit-bio>${profile.bio ? escapeHTML(profile.bio) : '<span>Add bio</span><span class="profile-add-bio-icon" aria-hidden="true">+</span>'}</button>
        ${(schoolName || grade) ? `<div class="profile-school-meta">${schoolName ? `<span class="profile-school-meta-item"><img loading="lazy" decoding="async" src="../assets/app/profile-school.svg" alt=""><span>${escapeHTML(schoolName)}</span></span>` : ""}${grade ? `<span class="profile-school-meta-item"><img loading="lazy" decoding="async" src="../assets/app/profile-graduation-cap.svg" alt=""><span>${escapeHTML(grade)}</span></span>` : ""}</div>` : ""}
        <button class="profile-information-inline" type="button" data-edit-profile>
            <span class="profile-information-icon">${profileInformationIcon(canChangeInformation)}</span>
            <span class="profile-information-copy"><strong>Profile information</strong></span>
            <span class="profile-information-chevron" aria-hidden="true">›</span>
        </button>
        <div class="profile-stats-grid">
            <div class="profile-stat-card" data-profile-stat="aura"><strong><img loading="lazy" decoding="async" class="profile-aura-icon" src="../assets/app/aura.webp" alt="">${Number(profile.aura_points || 0).toLocaleString()}</strong><span>Aura</span></div>
            <div class="profile-stat-card"><strong><span class="heart">${uiIcon("heart")}</span>${Number(profile.vote_count || 0).toLocaleString()}</strong><span>Votes Received</span></div>
        </div>
    </article>`;
    renderSchoolCard();
    renderGodModeCard();
    renderAuraPurchases();
    renderProfileInviteCard();
    renderPasskeyStatus();
    renderTabBadges();
    renderMemoriesEntry();
    void loadNotificationCategories();
}

// Memories + Vault live in a lazily loaded module (app/vault/).
let vaultPromise = null;
function renderMemoriesEntry() {
    let entry = $("#memoriesEntry");
    if (state.config?.enable_vault !== true || !api.user?.id) return entry?.classList.add("hidden");
    if (!entry) {
        entry = Object.assign(document.createElement("div"), { id: "memoriesEntry", className: "hidden" });
        $("#schoolCard").after(entry);
    }
    vaultPromise ||= import("./vault/index.js").then(({ createVault }) => createVault({
        api, getUser: () => api.user, openDetailScreen, closeDetailScreen, haptic, mount: $("#commentsRoot").parentElement,
    }));
    vaultPromise.then((vault) => vault.renderEntry(entry)).catch(() => { vaultPromise = null; });
}

function renderSchoolCard() {
    const container = $("#schoolCard");
    const classmates = [...(state.classmateDirectory?.length ? state.classmateDirectory : (state.classmates || []))];
    const activeClassmates = Number(state.activeClassmatesThisWeek);
    // SettingsView+Sections.communityHeader: shown from 5 active classmates.
    const activeClassmatesLabel = Number.isFinite(activeClassmates) && activeClassmates >= 5
        ? `<small>• ${activeClassmates.toLocaleString()} classmate${activeClassmates === 1 ? "" : "s"} active this week</small>`
        : "";
    // Locked until the account votes (then until enough classmates join): the
    // strip blurs under "Vote to unlock" / "More classmates needed".
    const unlock = state.classmatesStatus;
    const locked = unlock?.is_unlocked === false;
    const voteLocked = Boolean(unlock?.lock_reasons?.includes("votes") && Number(unlock.votes_cast || 0) < Number(unlock.required_votes || 0));
    const joinLocked = Boolean(unlock?.lock_reasons?.includes("joined_users") && Number(unlock.joined_users || 0) < Number(unlock.required_joined_users || 0));
    const inviteStep = !voteLocked && joinLocked;
    const lockOverlay = locked
        ? `<button class="school-lock-button ${inviteStep ? "invite" : ""}" type="button" data-school-unlock="${inviteStep ? "invite" : "vote"}"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10h.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Zm2.2 0h4.6V7.5a2.3 2.3 0 0 0-4.6 0Z"/></svg><span>${inviteStep ? "More classmates needed" : "Vote to unlock"}</span></button>`
        : "";
    if (state.profile && !classmates.some((classmate) => String(classmate.user_id) === String(state.profile.user_id))) {
        classmates.push(state.profile);
    }
    const ranked = classmates
        .map((classmate, index) => ({ classmate, index }))
        .sort((first, second) => {
            const weeklyDifference = Number(second.classmate.weekly_vote_count || 0) - Number(first.classmate.weekly_vote_count || 0);
            if (weeklyDifference) return weeklyDifference;
            const totalDifference = Number(second.classmate.vote_count || 0) - Number(first.classmate.vote_count || 0);
            return totalDifference || first.index - second.index;
        })
        .map(({ classmate }) => classmate)
        .slice(0, 20);
    container.innerHTML = `<article class="school-card">
        <div class="school-card-heading"><strong>School</strong>${activeClassmatesLabel}</div>
        ${currentProfileSchoolName() ? `<div class="school-card-name">${escapeHTML(currentProfileSchoolName())}</div>` : ""}
        <p>Spotlight on classmates with the most votes this week.</p>
        ${ranked.length ? `<div class="school-leaderboard-wrap ${locked ? "locked" : ""}"><div class="school-leaderboard" role="list" aria-label="Classmates ranked by weekly votes" ${locked ? 'inert aria-hidden="true"' : ""}>${ranked.map((classmate, index) => {
            const isCurrentUser = String(classmate.user_id) === String(state.profile?.user_id);
            return `<button class="school-rank-card" type="button" role="listitem" ${isCurrentUser ? `disabled aria-current="true"` : `data-school-classmate="${escapeHTML(classmate.user_id)}"`} aria-label="#${index + 1} ${escapeHTML(displayName(classmate))}, ${Number(classmate.weekly_vote_count || 0).toLocaleString()} votes this week">
                <span class="school-rank-number">#${index + 1}</span>
                ${avatarMarkup(classmate, "school-rank-avatar")}
                <strong>${escapeHTML(isCurrentUser ? `${displayName(classmate)} (You)` : displayName(classmate))}</strong>
                <small><span aria-hidden="true">${uiIcon("heart")}</span> ${Number(classmate.weekly_vote_count || 0).toLocaleString()} this week</small>
            </button>`;
        }).join("")}</div>${lockOverlay}</div>` : locked
            ? `<div class="school-leaderboard-wrap locked"><div class="school-placeholder-strip" aria-hidden="true">${"<span><i></i><b></b><em></em></span>".repeat(3)}</div>${lockOverlay}</div>`
            : `<p>No classmates on Valid yet. Invite a friend to unlock this feed!</p>`}
        <div class="school-card-actions"><button id="findContactsButton" class="secondary-button" type="button">Contacts</button><button id="viewClassmatesButton" class="secondary-button" type="button">Classmates</button></div>
    </article>`;
}

// SettingsView+InviteAndPurchases.inviteFriendsSection.
function renderProfileInviteCard() {
    const container = $("#profileInviteCard");
    const invites = godModeInviteProgress();
    const creator = state.config?.enable_god_mode_ugc_program === true;
    const reward = invites
        ? `<p class="profile-invite-reward">${invites.reached ? "God Mode invite goal reached " : `Get ${invites.goal} verified friends to join for `}<strong>\u{1F451} GOD MODE</strong></p>
        <div class="profile-invite-progress"><progress max="${invites.goal}" value="${invites.progress}" aria-label="${invites.progress} of ${invites.goal} qualifying invites"></progress><small>Qualifying invites: ${invites.progress} / ${invites.goal}</small></div>`
        : `<p class="profile-invite-reward">Bring your friends in to unlock more polls and see more classmates</p>`;
    container.innerHTML = `<article class="profile-invite-card">
        ${reward}
        <div class="profile-invite-actions"><button class="profile-share-button snapchat" type="button" data-profile-invite="snapchat"><img loading="lazy" decoding="async" src="../assets/app/snapchat-logo.webp" alt=""><span>Invite via Snapchat</span></button><button class="profile-share-button messages" type="button" data-profile-invite="imessage"><svg class="profile-imessage-icon" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22" fill="#fff"/><path d="M13.25 23.1c0-6.15 4.72-10.35 10.75-10.35s10.75 4.2 10.75 10.35S30.03 33.45 24 33.45c-1.45 0-2.82-.24-4.06-.7-1.95 1.18-4.32 1.8-7.1 1.84 1.23-1.25 2.14-2.68 2.73-4.27-1.47-1.82-2.32-4.3-2.32-7.22Z" fill="#00e02d"/></svg><span>Invite via iMessage</span></button></div>
        ${creator ? `<button class="profile-creator-link" type="button" data-open-creator-program><span>Or earn God Mode through our Creator program</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg></button>` : ""}
        <p id="profileInviteStatus" class="status-message" role="status"></p>
    </article>`;
}

async function shareProfileInvite(button, channel) {
    setButtonLoading(button, true, "Opening…");
    const status = $("#profileInviteStatus");
    status.textContent = "";
    try {
        const invite = await api.createInvite(api.user.id, channel);
        const copy = `Join me on Valid — it’s more fun with classmates. ${invite.share_url}`;
        if (channel === "imessage" && /iPhone|iPad|iPod/i.test(navigator.userAgent)) location.href = `sms:&body=${encodeURIComponent(copy)}`;
        else if (navigator.share) await navigator.share({ title: "Join me on Valid", text: "Join me on Valid — it’s more fun with classmates.", url: invite.share_url });
        else {
            await navigator.clipboard.writeText(invite.share_url);
            status.textContent = "Invite link copied.";
        }
    } catch (error) {
        if (error.name !== "AbortError") status.textContent = friendlyErrorMessage(error, "Could not create an invite.");
    } finally {
        setButtonLoading(button, false);
        state.inviteStatus = await api.getInviteStatus(api.user.id).catch(() => state.inviteStatus);
        renderProfileInviteCard();
    }
}

// FeedViewModel+InboxVisit.swift: "seen" is a screen-level event. Opening the
// Inbox marks everything loaded as read (a per-user last-opened time) and
// clears the badge; during the visit, polls newer than the moment it began keep
// counting on the Polls chip, and that cutoff stays put until the user leaves.
// The /feed API has no per-item unread flag, so this mirrors iOS exactly.
const PERSONAL_FEED_PAGE_SIZE = 20;

function feedItemTime(item) {
    return Date.parse(item?.timestamp) || 0;
}

function personalInboxLastOpenedKey() {
    return api.user?.id ? `valid:pwa:v1:${api.user.id}:inbox-last-opened` : null;
}

function readPersonalInboxLastOpened() {
    const key = personalInboxLastOpenedKey();
    if (!key) return null;
    try {
        const value = Number(localStorage.getItem(key));
        return value > 0 ? value : null;
    } catch (_) { return null; }
}

function personalInboxReadReference() {
    const stored = readPersonalInboxLastOpened();
    if (stored) return stored;
    // First visit on this device: the first page is new, older pages are not.
    const items = state.personalFeedItems;
    if (items.length > PERSONAL_FEED_PAGE_SIZE) return feedItemTime(items[PERSONAL_FEED_PAGE_SIZE]);
    if (state.personalFeedHasMore && items.length) return feedItemTime(items.at(-1)) - 1;
    return 0;
}

function markLoadedPersonalItemsRead() {
    const key = personalInboxLastOpenedKey();
    if (!key) return;
    const readThrough = Math.max(Date.now(), feedItemTime(state.personalFeedItems[0]));
    const previous = readPersonalInboxLastOpened();
    if (previous && readThrough - previous < 1000) return;
    try { localStorage.setItem(key, String(readThrough)); } catch (_) { /* The badge simply stays until the next visit. */ }
}

function syncPersonalInboxVisit() {
    const showing = document.body.classList.contains("authenticated")
        && state.activePanel === "feed" && state.feedType === "personal"
        && document.visibilityState !== "hidden" && !isFeedVoteLocked();
    if (!showing) {
        state.personalInboxVisible = false;
        return;
    }
    if (!state.personalInboxVisible) {
        state.personalInboxVisible = true;
        state.personalInboxCutoff = null;
    }
    if (state.personalInboxCutoff === null && (state.personalFeedLoaded || state.personalFeedItems.length)) {
        state.personalInboxCutoff = personalInboxReadReference();
    }
    if (state.personalInboxCutoff !== null) markLoadedPersonalItemsRead();
}

function personalInboxUnreadCounts() {
    syncPersonalInboxVisit();
    const cutoff = state.personalInboxVisible ? state.personalInboxCutoff : personalInboxReadReference();
    const polls = cutoff === null ? 0 : state.personalFeedItems.filter((item) => feedItemTime(item) > cutoff).length;
    const tbhRequests = state.tbhPendingRequests.filter((item) => !item.opened_at).length;
    const tbhs = tbhRequests + state.tbhInboxItems.filter((item) => !item.opened_at).length;
    const askMe = (state.anonymousInbox?.questions || []).filter((item) => !item.opened_at).length;
    return { all: polls + tbhs + askMe, polls, tbhs, ask_me: askMe, tbhRequests };
}

const TAB_BADGE_CAP = 99;

function renderTabBadges() {
    const counts = personalInboxUnreadCounts();
    // While the Inbox is on screen its loaded polls count as read for the tab badge.
    const unread = counts.all - (state.personalInboxVisible ? counts.polls : 0);
    // FeedTabBadge: unread polls plus waiting TBH requests, at most 99 (TabBadgeCount).
    const feedBadge = $("#feedTabBadge");
    const feedBadgeCount = Math.min(TAB_BADGE_CAP, (state.personalInboxVisible ? 0 : counts.polls) + counts.tbhRequests);
    feedBadge.textContent = String(feedBadgeCount || "");
    feedBadge.classList.toggle("hidden", feedBadgeCount < 1);
    if ("setAppBadge" in navigator) {
        const totalUnread = unread + Number(state.chatUnreadCount || 0);
        const badgePromise = totalUnread > 0 ? navigator.setAppBadge(totalUnread) : navigator.clearAppBadge?.();
        Promise.resolve(badgePromise).catch(() => null);
        // The worker counts pushes on top of what the page last showed.
        if (state.syncedBadgeCount !== totalUnread) {
            state.syncedBadgeCount = totalUnread;
            navigator.serviceWorker?.controller?.postMessage({ type: "VALID_BADGE_SYNC", count: totalUnread });
        }
    }
    // ProfileTabBadge.needsProfilePicture: "!" only while there is no photo (or the default one).
    const picture = state.profile?.profile_picture_url;
    const needsPicture = Boolean(state.profile) && (!picture || String(picture).includes("default.png"));
    $("#profileTabBadge").classList.toggle("hidden", !needsPicture);
}

function renderChatUnreadBadge(count) {
    state.chatUnreadCount = Math.max(0, Number(count || 0));
    const badge = $("#chatsTabBadge");
    badge.textContent = String(Math.min(TAB_BADGE_CAP, state.chatUnreadCount) || "");
    badge.classList.toggle("hidden", state.chatUnreadCount < 1);
    renderTabBadges();
}

// SettingsView+Presentations.swift: "Don't lose your account! Set up a
// passkey" shows only while the account has no passkey, just above Sign out.
function accountHasPasskey() {
    const count = Math.max(0, Number(state.passkeyStatus?.credentialCount || 0));
    return state.passkeyStatus?.registered === true || count > 0;
}

function accountNeedsPasskey() {
    return Boolean(state.passkeyStatus) && !accountHasPasskey();
}

function renderPasskeyStatus() {
    $("#addPasskeyButton").classList.toggle("hidden", !accountNeedsPasskey());
    $("#passkeyStatusText").textContent = "";
    renderProfileActionsVisibility();
}

// The Settings card always has Blocked Users; nothing to hide here now.
function renderProfileActionsVisibility() {}

// Settings → Notifications (NotificationSettingsSheet.swift and
// NotificationCategoriesStore.swift): four server-side switches. A flip shows
// at once and saves in the background; saves of one switch run in order and
// only the last flip is sent; a failed save puts back only its own switch and
// says so at the bottom of the sheet. Browser permission is separate: while
// push isn't on here, a banner offers to turn it on and the switches dim.
const NOTIFICATION_CATEGORIES = [
    { key: "votes", title: "Votes", subtitle: "When someone picks you or reveals you", icon: '<path fill="currentColor" d="M9.6 2.5a2 2 0 0 1 2 2v5.6l.6-.1c.4-.6 1-.9 1.7-.9.6 0 1.1.3 1.5.7.4-.4 1-.6 1.5-.6.7 0 1.3.3 1.7.9l.3-.1c1.2 0 2.1 1 2.1 2.2v3.1c0 3.6-2.4 6.3-6.2 6.3h-1.2c-2 0-3.4-.7-4.6-2.3l-3.3-4.5a1.8 1.8 0 0 1 2.7-2.3l1.2 1.2V4.5a2 2 0 0 1 2-2Z"/>' },
    { key: "chats", title: "Chats", subtitle: "Messages, Mementos and chat invites", icon: '<path fill="currentColor" d="M3.5 3.5h9.5A3.5 3.5 0 0 1 16.5 7v4.2a3.5 3.5 0 0 1-3.5 3.5H8.2L4.6 17.4v-2.8A3.4 3.4 0 0 1 0 11.2V7a3.5 3.5 0 0 1 3.5-3.5Z" transform="translate(1.5 .5)"/><path fill="currentColor" d="M19.2 9.2h.3a3 3 0 0 1 3 3v3.6a3 3 0 0 1-2.4 3v2.6l-3.3-2.6h-4.2a3 3 0 0 1-2.6-1.5h3.8a5.4 5.4 0 0 0 5.4-5.4Z"/>' },
    { key: "activity", title: "Activity", subtitle: "Reactions, comments, Story tags, TBHs and news from Valid", icon: '<path fill="currentColor" d="M10 3.5c.5 3.7 2.3 5.6 6 6-3.7.5-5.5 2.3-6 6-.5-3.7-2.3-5.5-6-6 3.7-.4 5.5-2.3 6-6ZM18 13c.3 2 1.2 3 3.2 3.3-2 .3-2.9 1.2-3.2 3.2-.3-2-1.2-2.9-3.2-3.2 2-.3 2.9-1.3 3.2-3.3ZM18.5 2c.2 1.2.8 1.8 2 2-1.2.2-1.8.8-2 2-.2-1.2-.8-1.8-2-2 1.2-.2 1.8-.8 2-2Z"/>' },
    { key: "reminders", title: "Reminders", subtitle: "Vote again, streaks and daily nudges", icon: '<path fill="currentColor" fill-rule="evenodd" d="M12 4.5a8.3 8.3 0 1 1 0 16.6 8.3 8.3 0 0 1 0-16.6Zm-.9 3.6v5.6l4 2.4.9-1.5-3.1-1.9V8.1ZM2.6 6.6 6.4 3.4l1.3 1.5-3.8 3.2ZM21.4 6.6l-3.8-3.2-1.3 1.5 3.8 3.2Z"/>' },
];
const NOTIFICATION_CATEGORY_REFRESH_MS = 5 * 60_000;
const ALL_NOTIFICATION_CATEGORIES_ON = Object.freeze({ votes: true, chats: true, activity: true, reminders: true });
const notificationCategoryStore = {
    userId: null,
    values: { ...ALL_NOTIFICATION_CATEGORIES_ON },
    confirmed: { ...ALL_NOTIFICATION_CATEGORIES_ON },
    generation: {},
    pending: new Set(),
    chains: {},
    flips: 0,
    fetchedAt: 0,
    loading: null,
    failureTimer: null,
};

function notificationCategoriesFrom(response) {
    const categories = response?.categories || {};
    return Object.fromEntries(NOTIFICATION_CATEGORIES.map(({ key }) => [key, categories[key] !== false]));
}

function notificationCategoryCacheKey(userId) {
    return `valid:notification-categories:${userId}`;
}

function notificationCategoryStoreFor(userId) {
    const store = notificationCategoryStore;
    if (store.userId === userId) return store;
    Object.assign(store, { userId, generation: {}, pending: new Set(), chains: {}, fetchedAt: 0, loading: null });
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(notificationCategoryCacheKey(userId)) || "null"); } catch { saved = null; }
    store.values = notificationCategoriesFrom({ categories: saved });
    store.confirmed = { ...store.values };
    return store;
}

function applyNotificationCategories(next) {
    const store = notificationCategoryStore;
    store.values = { ...next };
    try { localStorage.setItem(notificationCategoryCacheKey(store.userId), JSON.stringify(store.values)); } catch { /* Shown from the server next time. */ }
    renderNotificationSettings();
}

// The server's values for every switch with no save of its own waiting.
function adoptNotificationCategories(server, except = null) {
    const store = notificationCategoryStore;
    const next = { ...store.values };
    for (const { key } of NOTIFICATION_CATEGORIES) {
        if (key !== except && !store.pending.has(key)) next[key] = server[key];
    }
    applyNotificationCategories(next);
}

function notificationCategorySummary(values = notificationCategoryStore.values) {
    const on = NOTIFICATION_CATEGORIES.filter(({ key }) => values[key]);
    if (on.length === NOTIFICATION_CATEGORIES.length) return "All on";
    if (!on.length) return "All off";
    return on.map(({ title }) => title).join(", ");
}

async function loadNotificationCategories({ force = false } = {}) {
    const userId = api.user?.id;
    if (!userId || typeof api.getNotificationPreferences !== "function") return;
    const store = notificationCategoryStoreFor(userId);
    renderNotificationSettings();
    if (!force && (store.loading || Date.now() - store.fetchedAt < NOTIFICATION_CATEGORY_REFRESH_MS)) return store.loading;
    // A flip made while this read runs may reach the server after it read.
    const flipsAtStart = store.pending.size ? null : store.flips;
    const load = api.getNotificationPreferences().then((response) => {
        if (store.userId !== userId || flipsAtStart === null || store.flips !== flipsAtStart) return;
        store.fetchedAt = Date.now();
        store.confirmed = notificationCategoriesFrom(response);
        adoptNotificationCategories(store.confirmed);
    }).catch(() => null).finally(() => {
        if (store.loading === load) store.loading = null;
    });
    store.loading = load;
    return load;
}

function setNotificationCategory(key, enabled) {
    const store = notificationCategoryStore;
    const userId = api.user?.id;
    const category = NOTIFICATION_CATEGORIES.find((item) => item.key === key);
    if (!category || !userId || store.userId !== userId || store.values[key] === enabled) return null;
    if ($("#notificationSaveFailure").dataset.category === key) hideNotificationSaveFailure();
    store.flips += 1;
    applyNotificationCategories({ ...store.values, [key]: enabled });
    const generation = (store.generation[key] || 0) + 1;
    store.generation[key] = generation;
    store.pending.add(key);
    const task = (store.chains[key] || Promise.resolve()).then(async () => {
        // A newer flip of this switch sends the final value.
        if (store.userId !== userId || store.generation[key] !== generation) return;
        try {
            const saved = notificationCategoriesFrom(await api.updateNotificationCategories({ [key]: enabled }));
            if (store.userId !== userId) return;
            store.confirmed = saved;
            if (store.generation[key] === generation) {
                store.pending.delete(key);
                adoptNotificationCategories(saved);
            } else {
                adoptNotificationCategories(saved, key);
            }
        } catch {
            if (store.userId !== userId || store.generation[key] !== generation) return;
            store.pending.delete(key);
            applyNotificationCategories({ ...store.values, [key]: store.confirmed[key] });
            showNotificationSaveFailure(key, `Couldn't save ${category.title}. Check your connection and try again.`);
        }
    });
    store.chains[key] = task;
    return task;
}

function showNotificationSaveFailure(key, message) {
    const line = $("#notificationSaveFailure");
    clearTimeout(notificationCategoryStore.failureTimer);
    line.dataset.category = key;
    line.textContent = message;
    line.classList.remove("hidden");
    haptic("error");
    notificationCategoryStore.failureTimer = setTimeout(hideNotificationSaveFailure, 3000);
}

function hideNotificationSaveFailure() {
    const line = $("#notificationSaveFailure");
    clearTimeout(notificationCategoryStore.failureTimer);
    delete line.dataset.category;
    line.textContent = "";
    line.classList.add("hidden");
}

// "allowed", "denied" (blocked in the browser) or "notAsked" (not on here yet).
function notificationPermissionState() {
    if (!webPushSupported()) return "notAsked";
    if (Notification.permission === "denied") return "denied";
    return state.webPushSubscription && state.webPushRegistrationState === "on" ? "allowed" : "notAsked";
}

function renderNotificationSettings() {
    const summary = $("#notificationStatusText");
    if (summary) summary.textContent = notificationCategoryStore.userId && notificationCategoryStore.userId === api.user?.id
        ? notificationCategorySummary()
        : notificationCategorySummary(ALL_NOTIFICATION_CATEGORIES_ON);
    const dialog = $("#notificationSettingsDialog");
    if (!dialog?.open) return;
    const permission = notificationPermissionState();
    const off = permission !== "allowed";
    $("#notificationPermissionBanner").classList.toggle("hidden", !off);
    $("#notificationPermissionTitle").textContent = permission === "denied" ? "Notifications are off for Valid" : "Notifications aren't on yet";
    const bannerButton = $("#notificationPermissionButton");
    bannerButton.disabled = Boolean(state.webPushBusy);
    bannerButton.setAttribute("aria-busy", String(Boolean(state.webPushBusy)));
    bannerButton.textContent = state.webPushBusy ? "Turning on…" : "Turn on notifications";
    const card = $("#notificationCategoryCard");
    card.classList.toggle("dimmed", off);
    if (!card.childElementCount) {
        card.innerHTML = NOTIFICATION_CATEGORIES.map(({ key, title, subtitle, icon }) => `<button class="notification-category-row" type="button" role="switch" aria-checked="true" data-notification-category="${key}" aria-label="${title}" aria-describedby="notificationCategory-${key}">
            <span class="notification-category-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${icon}</svg></span>
            <span><strong>${title}</strong><small id="notificationCategory-${key}">${subtitle}</small></span>
            <span class="settings-switch" aria-hidden="true"><span></span></span>
        </button>`).join("");
    }
    for (const row of card.querySelectorAll("[data-notification-category]")) {
        const on = notificationCategoryStore.values[row.dataset.notificationCategory] !== false;
        row.setAttribute("aria-checked", String(on));
        row.classList.toggle("on", on);
    }
}

function openNotificationSettings() {
    const dialog = $("#notificationSettingsDialog");
    hideNotificationSaveFailure();
    if (!dialog.open) dialog.showModal();
    renderNotificationSettings();
    // Opening the sheet always reads the server, and the browser permission.
    void loadNotificationCategories({ force: true });
    void refreshWebPushStatus();
}

// GodModeCard.swift: a yellow crown, "$6.99/week", the four value props and
// "Start God Mode"; subscribers see "God Mode Active" and "\u2728 Active".
const GOD_MODE_CROWN_ICON = '<svg class="god-mode-crown-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3.2 7.6a1.3 1.3 0 0 1 2-1.3l3.7 3 2.1-4.6a1.1 1.1 0 0 1 2 0l2.1 4.6 3.7-3a1.3 1.3 0 0 1 2 1.3l-1.7 9.2H4.9ZM5.2 18.3h13.6v1.2a1.2 1.2 0 0 1-1.2 1.2H6.4a1.2 1.2 0 0 1-1.2-1.2Z"/></svg>';

function godModeConfigPrice() {
    return Math.max(0, Number(state.config?.god_mode_price || 6.99));
}

function renderGodModeCard() {
    const active = api.user?.subscribed_user === true;
    const multiplier = Math.max(1, Number(state.profile?.god_mode_aura_multiplier || 2));
    const weeklyReveals = Math.max(1, Number(state.config?.max_full_reveals_per_week || 2));
    const valueProps = [
        `${weeklyReveals} weekly reveals for voters or anonymous question authors.`,
        "First-letter hints on every poll.",
        `${multiplier}\u00d7 aura on every answer you give.`,
        "Get boosted to the top of classmates' polls.",
    ];
    $("#godModeCard").innerHTML = `<article class="god-mode-card ${active ? "active" : ""}">
        <div class="god-mode-title"><span>${GOD_MODE_CROWN_ICON}</span><div><strong>${active ? "God Mode Active" : "God Mode"}</strong><small>${active ? "Everything unlocked" : `$${godModeConfigPrice().toFixed(2)}/week`}</small></div>${active ? `<span class="god-mode-active">\u2728 Active</span>` : ""}</div>
        <p class="god-mode-benefits-heading">${active ? "You\u2019re enjoying:" : "Go legendary with:"}</p>
        <ul>${valueProps.map((prop) => `<li>${escapeHTML(prop)}</li>`).join("")}</ul>
        ${active ? "" : `<button class="god-mode-start-button" type="button" data-open-god-mode><span><strong>Start God Mode</strong></span></button>`}
    </article>`;
}

function hasActiveGodMode() {
    return api.user?.subscribed_user === true;
}

// Only Stripe subscriptions can be cancelled here; App Store and granted God
// Mode get a 409 from the unsubscribe route, so the button stays hidden.
function hasStripeGodMode() {
    const billing = state.godModeBilling;
    return hasActiveGodMode() && billing?.userId === api.user?.id && billing.provider === "stripe";
}

async function refreshGodModeBilling() {
    const userId = api.user?.id;
    if (!userId || typeof api.getGodModeBilling !== "function") return;
    try {
        const billing = await api.getGodModeBilling(userId);
        if (api.user?.id !== userId) return;
        state.godModeBilling = {
            userId,
            provider: billing?.provider || null,
            subscribed: billing?.subscribed === true,
            stripeStatus: billing?.stripe_status || null,
            cancelAtPeriodEnd: billing?.cancel_at_period_end === true,
            expiresAt: billing?.expires_at || null,
            manage: billing?.manage || null,
            webPriceLabel: billing?.web_checkout?.price_label || null,
        };
        if (billing?.cancel_at_period_end === true) state.godModeCancellation = billing;
    } catch {
        return;
    }
    if (state.profileEditor === "hub" && $("#profileDialog").open) renderProfileEditorHub();
}

// GodModeBillingStatus.needsPaymentUpdate: the web payment failed and Stripe
// still holds the subscription; the fix is the card.
function godModeNeedsPaymentUpdate() {
    const billing = state.godModeBilling;
    if (!billing || billing.userId !== api.user?.id) return false;
    return ["past_due", "unpaid", "incomplete"].includes(billing.stripeStatus || "");
}

// The Earn button's line (GodModePitchView.earnGodModeSubtitle), from the
// God Mode invite goal; older servers only send the aura reward fields.
function godModeInviteProgress() {
    const status = state.inviteStatus;
    if (!status) return null;
    const progress = Number(status.god_mode_invite_progress ?? status.aura_reward_progress);
    const goal = Number(status.god_mode_invite_goal ?? status.aura_reward_goal);
    if (!Number.isFinite(progress) || !Number.isFinite(goal)) return null;
    const safeGoal = Math.max(1, goal);
    const reached = (status.god_mode_invite_goal_reached ?? status.aura_reward_max_reached) === true || progress >= safeGoal;
    return { progress: Math.max(0, Math.min(progress, safeGoal)), goal: safeGoal, reached };
}

function godModeInviteProgressLabel() {
    if (state.config?.enable_god_mode_ugc_program === true) return "Invite friends or join our Creator program";
    const invites = godModeInviteProgress();
    if (!invites) return "Invite friends to unlock God Mode";
    if (invites.reached) return "God Mode invite goal reached";
    return `${invites.progress} / ${invites.goal} qualifying invites`;
}

function syncGodModeCarouselDots() {
    const carousel = $(".god-mode-benefit-carousel");
    if (!carousel) return;
    const cards = $$(".god-mode-benefit-card");
    if (!cards.length) return;
    const activeIndex = Math.max(0, Math.min(cards.length - 1, Math.round(carousel.scrollLeft / Math.max(1, carousel.clientWidth))));
    $$(".god-mode-page-dots span").forEach((dot, index) => dot.classList.toggle("active", index === activeIndex));
}

// The web price: Stripe's own label from the billing status when the server
// sends it ("$6.99/week"), else the configured display price.
function godModeWebPriceLine() {
    const label = state.godModeBilling?.userId === api.user?.id ? state.godModeBilling?.webPriceLabel : null;
    if (label) return label.replace(/\/(\w+)$/, " per $1");
    return `$${godModeConfigPrice().toFixed(2)} per week`;
}

function renderGodModePitch() {
    const weeklyReveals = Math.max(1, Number(state.config?.max_full_reveals_per_week || 2));
    if (!state.godModeBilling?.webPriceLabel) {
        void refreshGodModeBilling().then(() => {
            const price = $("#godModeCheckoutPrice");
            if (price) price.textContent = godModeWebPriceLine();
        });
    }
    const multiplier = Math.max(1, Number(state.profile?.god_mode_aura_multiplier || 2));
    const revealNames = ["Sydney Sweeney", "LaMelo Ball", "Jordan Lee", "Taylor Swift"];
    // GodModePitchView: a sheet with a grabber and no close button; drag down or "Maybe later".
    const earnSubtitle = state.config?.enable_god_mode_ugc_program === true
        ? "Invite friends or join our Creator program"
        : godModeInviteProgressLabel();
    $("#godModePitchBody").innerHTML = `<span class="god-mode-pitch-grabber" aria-hidden="true"></span>
        <section class="god-mode-pitch-hero">
            <h2>See who likes you with</h2>
            <div class="god-mode-pitch-brand"><img loading="lazy" decoding="async" src="../assets/app/crown.webp" alt=""><strong>God Mode</strong></div>
        </section>
        <div class="god-mode-benefit-carousel" aria-label="God Mode benefits">
            <article class="god-mode-benefit-card">
                <div class="god-mode-reveal-preview" aria-hidden="true">
                    <img loading="lazy" decoding="async" class="god-mode-letter" src="../assets/app/letter_aligned.webp" alt="">
                    <span class="god-mode-lens"><img loading="lazy" decoding="async" src="../assets/app/magnifying_glass.webp" alt=""><span class="god-mode-reveal-names">${revealNames.map((name) => `<strong>${escapeHTML(name).replace(" ", "<br>")}</strong>`).join("")}</span></span>
                </div>
                <h3>${weeklyReveals} Reveals / Week</h3><p>Reveal voters or anonymous school-question authors up to ${weeklyReveals} times every week.</p>
            </article>
            <article class="god-mode-benefit-card"><img loading="lazy" decoding="async" class="god-mode-benefit-image scroll" src="../assets/app/scroll.webp" alt=""><h3>First-Letter Hints</h3><p>Get the first letter on every personal poll automatically.</p></article>
            <article class="god-mode-benefit-card"><img loading="lazy" decoding="async" class="god-mode-benefit-image aura" src="../assets/app/aura.webp" alt=""><h3>${multiplier}× Aura Boost</h3><p>Earn ${multiplier === 2 ? "double" : `${multiplier}×`} aura for every answer you give in Play.</p></article>
            <article class="god-mode-benefit-card"><img loading="lazy" decoding="async" class="god-mode-benefit-image rocket" src="../assets/app/rocket.webp" alt=""><h3>Get boosted</h3><p>Get boosted to the top of your classmates polls to see what they think of you</p></article>
        </div>
        <div class="god-mode-page-dots" aria-hidden="true"><span class="active"></span><span></span><span></span><span></span></div>
        <div class="god-mode-pitch-actions">
            <button class="god-mode-earn-button" type="button" data-earn-god-mode><strong>Earn God Mode</strong><small id="godModeInviteProgress">${escapeHTML(earnSubtitle)}</small></button>
            <button class="god-mode-checkout-button" type="button" data-start-god-mode><span><strong>Start God Mode</strong><small id="godModeCheckoutPrice">${escapeHTML(godModeWebPriceLine())}</small></span></button>
            <button class="god-mode-maybe-button" type="button" data-close-dialog>Maybe later</button>
            <p id="godModeCheckoutStatus" class="status-message" role="status"></p>
            <p class="god-mode-legal"><a href="/terms.html">Terms</a><span>·</span><a href="/privacy-policy.html">Privacy Policy</a></p>
        </div>
        <p class="god-mode-terms">Payment is charged by Stripe at checkout and renews every week until you cancel. Cancel anytime from Edit information; God Mode stays on until the end of the paid week.</p>`;
    $(".god-mode-benefit-carousel")?.addEventListener("scroll", syncGodModeCarouselDots, { passive: true });
}

function openGodModePitch() {
    if (hasActiveGodMode()) {
        renderGodModeCard();
        showToast("God Mode is already active");
        return;
    }
    renderGodModePitch();
    const dialog = $("#godModePitchDialog");
    if (!dialog.open) dialog.showModal();
    api.getInviteStatus(api.user.id).then((inviteStatus) => {
        state.inviteStatus = inviteStatus;
        const progress = $("#godModeInviteProgress");
        if (progress && state.config?.enable_god_mode_ugc_program !== true) progress.textContent = godModeInviteProgressLabel();
    }).catch(() => {
        const progress = $("#godModeInviteProgress");
        if (progress && !state.inviteStatus) progress.textContent = "Invite friends for God Mode rewards";
    });
}

function stopStripeCheckoutPolling() {
    clearInterval(state.stripeCheckoutPollTimer);
    state.stripeCheckoutPollTimer = null;
}

async function checkStripeCheckout() {
    if (!state.stripeCheckoutSessionId || state.stripeCheckoutPollInFlight || !api.user?.id) return;
    state.stripeCheckoutPollInFlight = true;
    try {
        const result = await api.confirmGodModeCheckout(api.user.id, state.stripeCheckoutSessionId);
        if (!result.completed || !result.subscribed) return;
        stopStripeCheckoutPolling();
        state.stripeCheckoutSessionId = null;
        api.user.subscribed_user = true;
        await refreshProfile();
        if ($("#godModePitchDialog").open) $("#godModePitchDialog").close();
        showToast("God Mode is active");
    } catch (error) {
        if (error.status >= 400 && error.status < 500) stopStripeCheckoutPolling();
    } finally {
        state.stripeCheckoutPollInFlight = false;
    }
}

async function startGodModeCheckout(button) {
    if (hasActiveGodMode()) {
        if ($("#godModePitchDialog").open) $("#godModePitchDialog").close();
        renderGodModeCard();
        showToast("God Mode is already active");
        return;
    }
    const checkoutWindow = window.open("about:blank", "_blank");
    const originalHTML = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span><strong>Opening payment…</strong><small>Apple Pay, Google Pay, or card</small></span>`;
    const status = $("#godModeCheckoutStatus");
    status.textContent = "";
    try {
        const currentUser = await api.getUser(api.user.id).catch(() => api.user);
        api.user = { ...api.user, ...currentUser };
        if (hasActiveGodMode()) {
            checkoutWindow?.close();
            $("#godModePitchDialog").close();
            renderGodModeCard();
            showToast("God Mode is already active");
            return;
        }
        const checkout = await api.createGodModeCheckout(api.user.id);
        state.stripeCheckoutSessionId = checkout.id;
        if (checkoutWindow) checkoutWindow.location.href = checkout.url;
        else window.location.href = checkout.url;
        stopStripeCheckoutPolling();
        // Poll while this tab is visible, for at most 15 minutes; returning to
        // the tab (focus) still checks once after that.
        const pollingUntil = Date.now() + 15 * 60_000;
        state.stripeCheckoutPollTimer = setInterval(() => {
            if (Date.now() > pollingUntil) return stopStripeCheckoutPolling();
            if (document.visibilityState === "visible") void checkStripeCheckout();
        }, 4000);
        status.textContent = "Finish checkout, then return here. God Mode will unlock automatically.";
    } catch (error) {
        checkoutWindow?.close();
        status.textContent = userMessage(error, "Could not start Stripe checkout.");
    } finally {
        button.disabled = false;
        button.innerHTML = originalHTML;
    }
}

function renderEarnGodModeProgress() {
    const container = $("#earnGodModeProgress");
    const invites = godModeInviteProgress();
    if (!invites) {
        container.innerHTML = state.inviteStatus ? "" : `<div class="earn-invite-progress"><span><strong>Qualifying invites</strong><small>Loading…</small></span><progress max="1" value="0" aria-label="Loading invite progress"></progress></div>`;
        return;
    }
    const remaining = Math.max(0, invites.goal - invites.progress);
    container.innerHTML = `<div class="earn-invite-progress">
        <span><strong>Qualifying invites: ${invites.progress} / ${invites.goal}</strong><small>${invites.reached ? "Reward earned" : `${remaining} to go`}</small></span>
        <progress max="${invites.goal}" value="${invites.progress}" aria-label="${invites.progress} of ${invites.goal} qualifying invites"></progress>
    </div>`;
}

// GodModeEarnView.swift: "Invite N friends" or, with the Creator program on,
// "Join our Creator program".
function renderGodModeEarnChooser() {
    const creator = state.config?.enable_god_mode_ugc_program === true;
    const invites = godModeInviteProgress();
    const goal = invites?.goal || Math.max(1, Number(state.config?.god_mode_invite_friend_goal || 5));
    $("#godModeEarnChooserSubtitle").textContent = creator ? "Choose how you want to unlock reveals." : "Invite friends to unlock reveals.";
    $("#godModeEarnInviteTitle").textContent = `Invite ${goal} friends`;
    $("#godModeEarnInviteSubtitle").textContent = invites
        ? `${invites.progress} / ${invites.goal} qualifying invites`
        : `Earn God Mode when ${goal} qualifying friends join.`;
    $("#godModeEarnCreator").classList.toggle("hidden", !creator);
}

async function openEarnGodModeDialog() {
    const dialog = $("#godModeEarnChooserDialog");
    renderGodModeEarnChooser();
    if (!dialog.open) dialog.showModal();
    try {
        state.inviteStatus = await api.getInviteStatus(api.user.id);
        renderGodModeEarnChooser();
    } catch (_) { /* The chooser still works without fresh progress. */ }
}

async function openInviteFriendsDialog() {
    const dialog = $("#earnGodModeDialog");
    $("#earnGodModeStatus").textContent = "";
    renderEarnGodModeProgress();
    if (!dialog.open) dialog.showModal();
    try {
        state.inviteStatus = await api.getInviteStatus(api.user.id);
        renderEarnGodModeProgress();
    } catch (_) { /* Sharing still works when progress is temporarily unavailable. */ }
}

// The Creator program lives on the website (CreatorProgramView.swift on iOS).
function openCreatorProgram() {
    window.open("/creatorprogram.html", "_blank", "noopener");
}

async function shareGodModeInvite(button, channel) {
    const status = $("#earnGodModeStatus");
    const label = button.querySelector(".earn-share-label");
    const originalLabel = label?.textContent;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    if (channel === "snapchat" && label) label.textContent = "Opening…";
    status.textContent = "";
    try {
        const invite = await api.createInvite(api.user.id, channel);
        const shareText = "Join me on Valid — it’s more fun with classmates.";
        if (channel === "imessage" && /iPhone|iPad|iPod/i.test(navigator.userAgent)) {
            location.href = `sms:&body=${encodeURIComponent(`${shareText} ${invite.share_url}`)}`;
        } else if (navigator.share) {
            await navigator.share({ title: "Join me on Valid", text: shareText, url: invite.share_url });
        } else {
            await navigator.clipboard.writeText(invite.share_url);
            status.textContent = channel === "snapchat" ? "Invite copied — paste it into Snapchat." : "Invite link copied.";
        }
    } catch (error) {
        if (error.name !== "AbortError") status.textContent = userMessage(error, "Could not create an invite.");
    } finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        if (label && originalLabel) label.textContent = originalLabel;
        state.inviteStatus = await api.getInviteStatus(api.user.id).catch(() => state.inviteStatus);
        renderEarnGodModeProgress();
    }
}

function auraCost(kind) {
    if (kind === "global") return Math.max(0, Number(state.config?.global_visibility_boost_cost ?? 400));
    if (kind === "targeted") return Math.max(0, Number(state.config?.targeted_visibility_boost_cost ?? 200));
    if (kind === "nominate") return Math.max(0, Number(state.config?.nomination_aura_cost ?? 100));
    return questionSubmissionCost();
}

function tbhRequestsEnabled() {
    return state.config?.enable_tbh_requests === true;
}

function tbhAuraCost() {
    return Math.max(0, Number(state.config?.tbh_request_aura_cost ?? 100));
}

function activeBoost(kind, targetId = null) {
    if (kind === "global") return state.profile?.active_global_boost || null;
    return (state.profile?.active_targeted_boosts || []).find((boost) => !targetId || String(boost.target_user_id) === String(targetId)) || null;
}

function renderAuraPurchases() {
    const container = $("#auraPurchases");
    if (!container || !state.profile) return;
    const globalCost = auraCost("global");
    const targetedCost = auraCost("targeted");
    const questionCost = auraCost("question");
    const tbhCost = tbhAuraCost();
    const globalBoost = activeBoost("global");
    const aura = Math.max(0, Number(state.profile.aura_points || 0));
    const purchaseButton = (kind, cost, label, active = false) => {
        const insufficient = !active && aura < cost;
        const ariaLabel = active
            ? label
            : insufficient
            ? `${label}. Need ${(cost - aura).toLocaleString()} more aura`
            : label;
        return `<button class="aura-price-button ${insufficient ? "insufficient" : ""}" type="button" data-buy-aura="${kind}" aria-label="${escapeHTML(ariaLabel)}" ${active || insufficient ? "disabled" : ""}>${active ? "Active" : `<span>${cost.toLocaleString()}</span><img loading="lazy" decoding="async" src="../assets/app/aura.webp" alt="aura">`}</button>`;
    };
    // SettingsView+InviteAndPurchases.perksSection's titles and subtitles.
    container.innerHTML = `<article class="purchase-row"><span><strong>Get boosted</strong><small>Guaranteed to find out what your classmates think of you \u{1F4AC}</small></span>${purchaseButton("global", globalCost, globalBoost ? "Global boost active" : `Get boosted for ${globalCost.toLocaleString()} aura`, Boolean(globalBoost))}</article>
        <article class="purchase-row"><span><strong>Target a classmate</strong><small>They won't know who targeted them \u{1F92B}</small></span>${purchaseButton("targeted", targetedCost, `Target a classmate for ${targetedCost.toLocaleString()} aura`)}</article>
        ${tbhRequestsEnabled() ? `<article class="purchase-row"><span><strong>Request a TBH</strong><small>Ask a classmate for their honest take on you.</small></span>${purchaseButton("tbh", tbhCost, `Request a TBH for ${tbhCost.toLocaleString()} aura`)}</article>` : ""}
        <article class="purchase-row"><span><strong>Submit a school question</strong><small>Anonymously create a poll that your school will answer.</small></span>${purchaseButton("question", questionCost, `Submit a school question for ${questionCost.toLocaleString()} aura`)}</article>`;
}

function newIdempotencyKey() {
    return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function tbhTargetStatus(target) {
    if (target.state === "active") return "Requested";
    if (target.state !== "cooldown" || !target.next_allowed_at) return "Unavailable";
    const remaining = Date.parse(target.next_allowed_at) - Date.now();
    if (remaining <= 0) return "Available";
    if (remaining < 3_600_000) return "Again soon";
    if (remaining < 86_400_000) return `Again in ${Math.max(1, Math.ceil(remaining / 3_600_000))}h`;
    return "Again tomorrow";
}

function classmatePickerRowMarkup(classmate, { dataAttribute, trailingMarkup = "", disabled = false, extraClass = "" } = {}) {
    const grade = formatGrade(classmate.grade || "");
    return `<button class="classmate-picker-row ${extraClass}" type="button" ${dataAttribute} ${disabled ? "disabled" : ""} aria-label="${escapeHTML([displayName(classmate), grade].filter(Boolean).join(", "))}">
        ${avatarMarkup(classmate, "row-avatar classmate-picker-avatar")}
        <span class="classmate-picker-copy"><strong>${escapeHTML(displayName(classmate))}</strong>${grade ? `<small>${escapeHTML(grade)}</small>` : ""}</span>
        <span class="classmate-picker-trailing">${trailingMarkup}</span>
    </button>`;
}

function classmateSearchMarkup(inputId) {
    return `<label class="feed-search classmate-picker-search"><span class="search-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4 4"/></svg></span><input id="${inputId}" type="search" placeholder="Search classmates" autocomplete="off"></label>`;
}

function classmatePickerMatches(classmate, query) {
    if (!query) return true;
    return `${displayName(classmate)} ${classmate.username || ""} ${classmate.grade || ""}`.toLowerCase().includes(query);
}

function renderClassmatePickerList(list, items, { query = "", rowOptions, emptyMessage = "No classmates match your search." } = {}) {
    const visibleItems = items.filter((classmate) => classmatePickerMatches(classmate, query));
    list.innerHTML = visibleItems.length
        ? visibleItems.map((classmate) => classmatePickerRowMarkup(classmate, rowOptions(classmate))).join("")
        : `<div class="classmate-picker-empty">${escapeHTML(emptyMessage)}</div>`;
}

function renderTbhTargetList() {
    const query = $("#tbhTargetSearch")?.value.trim().toLowerCase() || "";
    const targets = [...state.tbhTargets]
        .sort((left, right) => Number(right.state === "eligible") - Number(left.state === "eligible") || left.first_name.localeCompare(right.first_name));
    const list = $("#tbhTargetList");
    if (!list) return;
    renderClassmatePickerList(list, targets, {
        query,
        rowOptions: (target) => ({
            dataAttribute: `data-tbh-target="${escapeHTML(target.user_id)}"`,
            disabled: target.state !== "eligible",
            trailingMarkup: target.state === "eligible" ? '<span class="classmate-picker-chevron" aria-hidden="true">›</span>' : `<small>${escapeHTML(tbhTargetStatus(target))}</small>`,
        }),
    });
}

function mergeTbhTargetsWithClassmates(targets, classmates) {
    const classmatesById = new Map((classmates || []).map((classmate) => [String(classmate.user_id), classmate]));
    return (targets || []).map((target) => {
        const classmate = classmatesById.get(String(target.user_id));
        if (!classmate) return target;
        return {
            ...classmate,
            ...target,
            profile_picture_url: classmate.profile_picture_url || target.profile_picture_url || null,
            profile_picture_url_thumb: classmate.profile_picture_url_thumb || target.profile_picture_url || null,
            profile_picture_url_medium: classmate.profile_picture_url_medium || classmate.profile_picture_url || target.profile_picture_url || null,
        };
    });
}

function renderTbhRequestFlow() {
    const body = $("#tbhRequestBody");
    const target = state.tbhTargets.find((item) => String(item.user_id) === String(state.selectedTbhTargetId));
    if (!target) {
        body.classList.add("classmate-picker-page");
        $("#tbhRequestTitle").textContent = "Request a TBH";
        $("#tbhRequestDialog [data-close-tbh-request] span").textContent = "Close";
        body.innerHTML = `<p class="classmate-picker-note">Who do you want an honest take from?</p>${classmateSearchMarkup("tbhTargetSearch")}<div id="tbhTargetList" class="classmate-picker-list"></div>`;
        renderTbhTargetList();
        return;
    }
    body.classList.remove("classmate-picker-page");
    $("#tbhRequestTitle").textContent = "Choose an angle";
    $("#tbhRequestDialog [data-close-tbh-request] span").textContent = "Back";
    body.innerHTML = `<div class="tbh-selected-target">${avatarMarkup(target, "row-avatar")}<span><strong>Asking ${escapeHTML(target.first_name)}</strong><small>What do you want their honest take on?</small></span></div>
        <div class="tbh-prompt-list">${TBH_PROMPTS.map((prompt) => `<button class="tbh-prompt-row ${state.selectedTbhPrompt === prompt.key ? "selected" : ""}" type="button" data-tbh-prompt="${prompt.key}" aria-pressed="${state.selectedTbhPrompt === prompt.key}"><span class="tbh-prompt-check" aria-hidden="true">${state.selectedTbhPrompt === prompt.key ? "✓" : ""}</span><strong>${escapeHTML(prompt.title)}</strong></button>`).join("")}</div>
        <div class="tbh-consent-card"><span class="tbh-consent-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M16 11a4 4 0 1 0-3.6-5.7M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-6 2-6 5v1h12v-1c0-3-2-5-6-5Zm8-1c3.5 0 6 1.8 6 5v2h-6"/></svg></span><span><strong>Public to your school</strong><p>If they answer, your name and their TBH will appear in School for classmates to see and react to. Their name stays private.</p></span></div>
        <button class="primary-button" type="button" data-send-tbh-request>Continue · ${tbhAuraCost().toLocaleString()} aura</button><p id="tbhRequestStatus" class="status-message" role="status"></p>`;
}

async function openTbhRequestPurchase() {
    if (!tbhRequestsEnabled()) return;
    state.selectedTbhTargetId = null;
    state.selectedTbhPrompt = "anything";
    state.tbhRequestIdempotencyKey = newIdempotencyKey();
    $("#tbhRequestTitle").textContent = "Request a TBH";
    $("#tbhRequestBody").classList.add("classmate-picker-page");
    $("#tbhRequestBody").innerHTML = '<div class="empty-card">Loading classmates…</div>';
    openDetailScreen($("#tbhRequestDialog"));
    try {
        const [targetResponse, classmateResponse] = await Promise.all([
            api.getTbhRequestTargets(api.user.id),
            api.getClassmatesWithMetadata(api.user.id, "", 500),
        ]);
        state.classmateDirectory = classmateResponse.classmates;
        state.classmates = classmateResponse.classmates;
        if (classmateResponse.activeThisWeekCount !== null) state.activeClassmatesThisWeek = classmateResponse.activeThisWeekCount;
        state.tbhTargets = mergeTbhTargetsWithClassmates(targetResponse.items, classmateResponse.classmates);
        renderTbhRequestFlow();
    } catch (error) {
        $("#tbhRequestBody").innerHTML = `<div class="empty-card"><strong>Couldn't load classmates</strong><p>${escapeHTML(userMessage(error, "Please try again."))}</p></div>`;
    }
}

async function submitTbhRequest(button) {
    const target = state.tbhTargets.find((item) => String(item.user_id) === String(state.selectedTbhTargetId));
    if (!target) return;
    openAuraSpend("tbh", target);
}

function selectedTbhRequest() {
    return state.tbhPendingRequests.find((item) => String(item.id) === String(state.selectedTbhRequestId));
}

function updateTbhComposer() {
    const request = selectedTbhRequest();
    if (!request) return;
    const value = $("#tbhResponseText").value.trim();
    const starterOnly = value === state.selectedTbhStarter;
    const valid = value.length >= 10 && value.length <= 300 && !starterOnly;
    $("#tbhCharacterCount").textContent = `${value.length}/300`;
    $("#tbhComposerHelper").textContent = starterOnly ? "Add your own words before sending" : value.length < 10 ? "At least 10 characters" : `${request.requester_first_name} sees your name; School sees the TBH anonymously`;
    $("#sendTbhResponse").disabled = !valid;
}

function openTbhComposer(requestId) {
    const request = state.tbhPendingRequests.find((item) => String(item.id) === String(requestId));
    if (!request) return;
    state.selectedTbhRequestId = request.id;
    state.tbhResponseIdempotencyKey = newIdempotencyKey();
    state.selectedTbhStarter = null;
    $("#tbhComposerHeading").innerHTML = `<h2>TBH for ${escapeHTML(request.requester_first_name)}</h2><p>${escapeHTML(promptForKey(request.prompt_key).title)}</p>`;
    $("#tbhStarterOptions").innerHTML = promptForKey(request.prompt_key).starters.map((starter) => `<button type="button" data-tbh-starter="${escapeHTML(starter)}">${escapeHTML(starter)}</button>`).join("");
    $("#tbhResponseText").value = "";
    $("#tbhComposerStatus").textContent = "";
    updateTbhComposer();
    openDetailScreen($("#tbhComposerDialog"));
    if (!request.opened_at) {
        request.opened_at = new Date().toISOString();
        renderFeed();
        api.openTbhRequest(api.user.id, request.id).catch(() => { request.opened_at = null; renderFeed(); });
    }
}

async function submitTbhResponse(event) {
    event.preventDefault();
    const request = selectedTbhRequest();
    const body = $("#tbhResponseText").value.trim();
    if (!request || body.length < 10 || body.length > 300 || body === state.selectedTbhStarter) return;
    const button = $("#sendTbhResponse");
    setButtonLoading(button, true, "Sending…");
    try {
        const response = await api.respondToTbhRequest(api.user.id, request.id, body, state.tbhResponseIdempotencyKey);
        state.tbhPendingRequests = state.tbhPendingRequests.filter((item) => String(item.id) !== String(request.id));
        state.tbhSentItems.unshift({ ...response,
            subject_user_id: request.requester_user_id,
            subject_first_name: request.requester_first_name,
            subject_last_name: request.requester_last_name,
            subject_profile_picture_url: request.requester_profile_picture_url,
        });
        closeDetailScreen($("#tbhComposerDialog"));
        renderFeed();
        successHaptic();
        showToast("TBH sent ✓");
        loadTbhContent();
    } catch (error) {
        $("#tbhComposerStatus").textContent = userMessage(error, "Couldn't send TBH.");
        setButtonLoading(button, false);
    }
}

async function dismissTbhRequest(requestId) {
    const previous = [...state.tbhPendingRequests];
    state.tbhPendingRequests = state.tbhPendingRequests.filter((item) => String(item.id) !== String(requestId));
    renderFeed();
    try { await api.dismissTbhRequest(api.user.id, requestId); }
    catch (error) { state.tbhPendingRequests = previous; renderFeed(); showToast(userMessage(error, "Couldn't dismiss request.")); }
}

async function suppressTbhRequester(requesterId) {
    const previous = [...state.tbhPendingRequests];
    state.tbhPendingRequests = state.tbhPendingRequests.filter((item) => String(item.requester_user_id) !== String(requesterId));
    renderFeed();
    try { await api.suppressTbhRequester(api.user.id, requesterId); }
    catch (error) { state.tbhPendingRequests = previous; renderFeed(); showToast(userMessage(error, "Couldn't update requests.")); }
}

async function openTbhDetail(value) {
    const [kind, id] = String(value).split(":");
    let item = (kind === "received" ? state.tbhInboxItems : kind === "sent" ? state.tbhSentItems : state.schoolTbhItems).find((candidate) => String(candidate.id) === String(id));
    if (!item) return;
    await prepareFeedView();
    state.selectedTbhItem = { kind, id };
    const received = kind === 'received';
    const profile = { first_name: received ? item.author_first_name : item.subject_first_name, last_name: received ? item.author_last_name : item.subject_last_name, profile_picture_url: received ? item.author_profile_picture_url : item.subject_profile_picture_url };
    const name = displayName(profile);
    const title = received ? `${name} sent you a TBH` : kind === 'sent' ? `You sent ${name} a TBH` : `${name} got a TBH`;
    const footer = kind === 'school' ? tbhAuthorLine(item) : kind === 'sent' ? `${profile.first_name} sees your name. School sees your TBH without your name.` : '';
    $("#tbhDetailBody").innerHTML = `<article class="tbh-detail-card"><div class="tbh-detail-hero">${avatarMarkup(profile, "row-avatar tbh-detail-avatar")}<div><div class="tbh-detail-title-row"><h2 id="tbhDetailTitle">${escapeHTML(title)}</h2><time>${escapeHTML(shortRelativeTime(item.created_at))}</time></div><p>${escapeHTML(promptForKey(item.prompt_key).title)}</p></div></div><blockquote>${escapeHTML(item.body)}</blockquote>${footer ? `<small>${escapeHTML(footer)}</small>` : ''}</article><div class="detail-engagement-row">${feedView.reactionControlMarkup(item, "activity", item.activity_id)}${commentDetailButtonMarkup(item, "activity", item.activity_id, "tbh-detail-comment-button")}${detailSendButton("activity", item.activity_id)}</div><div class="share-platform-row detail-share-row tbh-share-row">${['snapchat','instagram','tiktok'].map(platform => `<button class="share-platform-button ${platform} ${platform === 'snapchat' ? 'expanded' : ''}" type="button" data-share-tbh="${platform}" aria-label="Share TBH to ${platform === 'tiktok' ? 'TikTok' : platform[0].toUpperCase()+platform.slice(1)}">${shareIconMarkup(platform)}${platform === 'snapchat' ? '<span>Share on Snapchat</span>' : ''}</button>`).join('')}</div><p id="tbhShareStatus" class="status-message" role="status"></p>`;
    openDetailScreen($("#tbhDetailDialog"));
    if (kind === "received" && !item.opened_at) {
        try {
            const opened = await api.getTbhResponse(api.user.id, item.id);
            const index = state.tbhInboxItems.findIndex((candidate) => String(candidate.id) === String(item.id));
            if (index >= 0) state.tbhInboxItems[index] = { ...state.tbhInboxItems[index], ...opened };
            renderFeed();
        } catch (_) { /* Detail remains readable from the inbox payload. */ }
    }
}

let tbhShareBusy = false;
async function shareTbhDetail(platform) {
    if (tbhShareBusy) return;
    const selected = state.selectedTbhItem;
    if (!selected) return;
    const { kind, id } = selected;
    const item = (kind === 'received' ? state.tbhInboxItems : kind === 'sent' ? state.tbhSentItems : state.schoolTbhItems).find(item => String(item.id) === String(id));
    if (!item) return;
    tbhShareBusy = true;
    const status = $('#tbhShareStatus');
    const buttons = $$('[data-share-tbh]');
    buttons.forEach(button => { button.disabled = true; });
    status.textContent = 'Preparing TBH image…';
    try {
        const { tbhShareContent, createTbhShareFile } = await import('./tbh-share.js');
        const content = tbhShareContent(kind, item, promptForKey(item.prompt_key).title, tbhAuthorLine(item));
        const { loadShareArtwork } = await shareCards();
        const file = await createTbhShareFile(content, { loadArtwork: loadShareArtwork, assetURL: url => api.assetURL(url) });
        if (navigator.share && navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], title: 'A TBH on Valid' });
            status.textContent = '';
        } else {
            downloadShareFile(file);
            status.textContent = `TBH image saved. Add it to your ${platform === 'tiktok' ? 'TikTok' : platform[0].toUpperCase()+platform.slice(1)} story.`;
        }
    } catch (error) {
        status.textContent = error.name === 'AbortError' ? '' : 'Couldn’t share this TBH. Please try again.';
    } finally { tbhShareBusy = false; buttons.forEach(button => { button.disabled = false; }); }
}

function openTopPoll(pollKey) {
    const polls = [
        ...(state.topQuestionsWeekly || []),
        ...(state.topQuestionsAllTime || []),
        ...(state.selectedClassmateTopQuestionsWeekly || []),
        ...(state.selectedClassmateTopQuestionsAllTime || []),
    ];
    const question = polls.find((item) => String(item.question_id || item.id) === String(pollKey));
    if (!question) return;
    state.selectedTopPoll = question;
    const artwork = publicImageMarkup(question.image_url);
    $("#pollSummaryBody").innerHTML = `<article class="poll-summary-card">
        ${artwork ? `<div class="profile-poll-art">${artwork}</div>` : ""}
        <h3>${escapeHTML(question.question_text)}</h3>
        <span class="poll-summary-votes"><span aria-hidden="true">${uiIcon("heart")}</span><strong>${Number(question.vote_count || 0).toLocaleString()} votes</strong></span>
        <button class="primary-button" type="button" data-share-top-poll>Share poll</button>
    </article>`;
    $("#pollSummaryDialog").showModal();
}

function closeTopPoll() {
    state.selectedTopPoll = null;
    const dialog = $("#pollSummaryDialog");
    if (dialog.open) dialog.close();
}

async function shareTopPoll() {
    const question = state.selectedTopPoll;
    if (!question) return;
    const text = `${question.question_text}\n${Number(question.vote_count || 0).toLocaleString()} votes on Valid`;
    try {
        if (navigator.share) await navigator.share({ title: "A poll on Valid", text, url: "https://validapp.lol/app/" });
        else {
            await navigator.clipboard.writeText(`${text}\nhttps://validapp.lol/app/`);
            showToast("Poll copied to share");
        }
    } catch (error) {
        if (error.name !== "AbortError") showToast("Could not share this poll.");
    }
}

function openAuraSpend(kind, target = null) {
    const cost = kind === "tbh"
        ? tbhAuraCost()
        : kind === "reveal"
        ? Math.max(0, Number(state.config?.full_reveal_aura_cost ?? DEFAULT_FULL_REVEAL_AURA_COST))
        : auraCost(kind);
    const aura = Math.max(0, Number(state.profile?.aura_points || 0));
    if (aura < cost) return showToast(`You need ${cost.toLocaleString()} aura.`);
    const details = kind === "tbh"
        ? [`Request a TBH from ${target.first_name}?`, "If they answer, your name and their TBH will be public in School. Their name stays private."]
        : kind === "global"
        ? ["Get Boosted", "Jump to the top of your classmates' polls for 5 days or until you get voted 10 times."]
        : kind === "reveal"
            ? ["Reveal who sent this?", `Spend ${cost.toLocaleString()} aura to see who voted for you.`]
            : kind === "nominate"
            ? [`Nominate ${displayName(target.candidate)}?`, "They'll see they got nominated for this poll. Your name stays private."]
            : ["Boost toward your crush", `Show up more often in ${displayName(target)}'s polls. They will not be told.`];
    state.pendingAuraPurchase = { kind, target };
    const spendIcon = $("#auraSpendIcon");
    const person = kind === "nominate" ? target.candidate : target;
    const targetImage = ["targeted", "tbh", "nominate"].includes(kind) ? api.assetURL(person?.profile_picture_url_medium || person?.profile_picture_url) : null;
    setMediaImageSource(spendIcon, targetImage || (kind === "reveal" ? "../assets/app/magnifying_glass.webp" : kind === "nominate" ? "../assets/app/crown.webp" : "../assets/app/rocket.webp"));
    spendIcon.alt = kind === "global" ? "Get Boosted" : kind === "reveal" ? "Reveal sender" : displayName(person);
    spendIcon.closest(".aura-spend-icon").classList.toggle("profile", Boolean(targetImage));
    $("#auraSpendTitle").textContent = details[0];
    $("#auraSpendMessage").textContent = details[1];
    $("#auraSpendCost").textContent = `${cost.toLocaleString()} aura`;
    $("#auraSpendRemaining").textContent = `${Math.max(0, aura - cost).toLocaleString()} aura`;
    const confirmButton = $("#confirmAuraSpend");
    confirmButton.dataset.label = `Spend ${cost.toLocaleString()} aura`;
    confirmButton.innerHTML = `<span>Spend ${cost.toLocaleString()} aura</span><img loading="lazy" decoding="async" src="../assets/app/aura.webp" alt="">`;
    $("#auraSpendStatus").textContent = "";
    $("#auraSpendDialog").showModal();
}

async function confirmAuraSpend() {
    const purchase = state.pendingAuraPurchase;
    if (!purchase) return;
    const button = $("#confirmAuraSpend");
    setButtonLoading(button, true, purchase.kind === "reveal" ? "Revealing..." : purchase.kind === "tbh" ? "Sending…" : purchase.kind === "nominate" ? "Nominating..." : "Purchasing...");
    $("#auraSpendStatus").textContent = "";
    try {
        let tbhResponse = null;
        if (purchase.kind === "tbh") {
            tbhResponse = await api.createTbhRequest(api.user.id, purchase.target.user_id, state.selectedTbhPrompt, state.tbhRequestIdempotencyKey);
            if (state.profile) state.profile.aura_points = tbhResponse.total_aura_points;
            renderProfileHeader();
            renderProfilePanel();
        } else if (purchase.kind === "reveal") {
            const result = await api.revealSender(api.user.id, purchase.target.question_answer_id);
            applyFeedSenderReveal(purchase.target, result);
        } else if (purchase.kind === "nominate") await submitNomination(purchase.target);
        else if (purchase.kind === "global") await api.purchaseGlobalBoost(api.user.id);
        else await api.purchaseTargetedBoost(api.user.id, purchase.target.user_id);
        clearOptimisticEarnedProfile();
        $("#auraSpendDialog").close();
        successHaptic();
        state.pendingAuraPurchase = null;
        if (!["reveal", "tbh", "nominate"].includes(purchase.kind)) await refreshProfile();
        if (purchase.kind === "tbh") {
            $("#tbhRequestTitle").textContent = "Request sent";
            $("#tbhRequestBody").innerHTML = `<div class="tbh-success"><span class="tbh-detail-quote" aria-hidden="true">❞</span><h2>Request sent to ${escapeHTML(purchase.target.first_name)}</h2><p>If they answer, your name and their TBH will be posted in School for classmates to see and react to. Their name stays private.</p><button class="primary-button" type="button" data-close-tbh-request>Done</button></div>`;
        } else if (purchase.kind !== "nominate") showToast(purchase.kind === "reveal"
            ? `Revealed: ${purchase.target.voter_name}`
            : purchase.kind === "global"
                ? "You're boosted"
                : `Boosted toward ${displayName(purchase.target)}`);
    } catch (error) {
        $("#auraSpendStatus").textContent = userMessage(error, purchase.kind === "reveal"
            ? "Could not reveal this sender."
            : purchase.kind === "nominate" ? "Could not save your nomination." : "Could not purchase this boost.");
    } finally {
        setButtonLoading(button, false);
        if (state.pendingAuraPurchase) {
            const cost = state.pendingAuraPurchase.kind === "tbh"
                ? tbhAuraCost()
                : state.pendingAuraPurchase.kind === "reveal"
                ? Math.max(0, Number(state.config?.full_reveal_aura_cost ?? DEFAULT_FULL_REVEAL_AURA_COST))
                : auraCost(state.pendingAuraPurchase.kind);
            button.innerHTML = `<span>Spend ${cost.toLocaleString()} aura</span><img loading="lazy" decoding="async" src="../assets/app/aura.webp" alt="">`;
        }
    }
}

function renderTargetedBoostList() {
    const query = $("#targetedBoostSearch").value.trim().toLowerCase();
    const cost = auraCost("targeted");
    renderClassmatePickerList($("#targetedBoostList"), state.targetedBoostClassmates || [], {
        query,
        rowOptions: (classmate) => {
            const active = activeBoost("targeted", classmate.user_id);
            return {
                dataAttribute: `data-targeted-boost="${escapeHTML(classmate.user_id)}"`,
                disabled: active,
                trailingMarkup: `<span class="nomination-cost ${active ? "active" : ""}">${active ? "Active" : `<span>${cost.toLocaleString()}</span><img loading="lazy" decoding="async" src="../assets/app/aura.webp" alt="aura">`}</span>`,
            };
        },
    });
}

async function openTargetedBoostPicker() {
    $("#targetedBoostSearch").value = "";
    $("#targetedBoostStatus").textContent = "Loading classmates...";
    $("#targetedBoostDialog").showModal();
    requestAnimationFrame(() => {
        if (document.activeElement?.closest?.("#targetedBoostDialog")) document.activeElement.blur();
    });
    try {
        state.targetedBoostClassmates ||= await api.getClassmates(api.user.id, "", 500);
        $("#targetedBoostStatus").textContent = "";
        renderTargetedBoostList();
    } catch (error) {
        $("#targetedBoostStatus").textContent = userMessage(error, "Could not load classmates.");
    }
}

function renderClassmateDirectory() {
    const query = $("#classmateDirectorySearch").value.trim().toLowerCase();
    renderClassmatePickerList($("#classmateDirectoryList"), sortClassmatesLikeIOS(state.classmateDirectory), {
        query,
        emptyMessage: query ? "No matching classmates." : "No classmates are visible yet.",
        rowOptions: (classmate) => ({
            dataAttribute: `data-directory-classmate="${escapeHTML(classmate.user_id)}"`,
            extraClass: "classmate-directory-row",
            trailingMarkup: `${classmate.ask_link_active ? `<span class="classmate-ask-indicator" aria-label="Ask Me is on">${appSymbolMarkup("ask", "ask-me-symbol")}</span>` : ""}<span class="classmate-row-meta"><strong><span aria-hidden="true">${uiIcon("heart")}</span> ${Number(classmate.weekly_vote_count || 0).toLocaleString()}</strong><small>this week</small></span>`,
        }),
    });
}

function updateClassmateDirectoryHeading(count = null) {
    $("#classmateDirectoryTitle").textContent = Number.isFinite(count) ? `Classmates (${count})` : "Classmates";
}

async function openClassmateDirectory() {
    const dialog = $("#classmateDirectoryDialog");
    $("#classmateDirectorySearch").value = "";
    updateClassmateDirectoryHeading(state.classmateDirectory?.length ?? null);
    $("#classmateDirectoryStatus").textContent = state.classmateDirectory ? "" : "Loading classmates...";
    renderClassmateDirectory();
    dialog.showModal();
    requestAnimationFrame(() => {
        if (document.activeElement?.closest?.("#classmateDirectoryDialog")) document.activeElement.blur();
    });
    if (state.classmateDirectory) return;
    try {
        state.classmateDirectory = await api.getClassmates(api.user.id, "", 500);
        writeAppCache("classmates", state.classmateDirectory);
        updateClassmateDirectoryHeading(state.classmateDirectory.length);
        $("#classmateDirectoryStatus").textContent = "";
        renderClassmateDirectory();
    } catch (error) {
        $("#classmateDirectoryStatus").textContent = userMessage(error, "Could not load classmates.");
    }
}

function renderClassmateProfile() {
    const profile = state.selectedClassmateProfile;
    if (!profile) return;
    $("#classmateProfileCard").innerHTML = `<article class="full-profile-card classmate-profile-card">
        <span class="full-profile-avatar">${profileImageMarkup(profile, [profile.profile_picture_url_medium, profile.profile_picture_url])}</span>
        <h3>${escapeHTML(displayName(profile))}</h3>
        <div class="profile-handle">${profile.username ? `@${escapeHTML(profile.username)}` : "Valid classmate"}</div>
        ${profile.bio ? `<p class="profile-bio">${escapeHTML(profile.bio)}</p>` : ""}
        <div class="profile-school-meta"><span class="profile-school-meta-item"><img loading="lazy" decoding="async" src="../assets/app/profile-school.svg" alt=""><span>${escapeHTML(profile.school_name || state.profile?.school_name || "Your school")}</span></span>${profile.grade ? `<span class="profile-school-meta-item"><img loading="lazy" decoding="async" src="../assets/app/profile-graduation-cap.svg" alt=""><span>${escapeHTML(formatGrade(profile.grade))}</span></span>` : ""}</div>
        ${state.selectedClassmateAskTarget?.public_token ? `<a class="primary-button classmate-ask-button" href="../a/${encodeURIComponent(state.selectedClassmateAskTarget.public_token)}">${appSymbolMarkup("ask", "ask-me-symbol")}<span>Ask anonymously</span></a>` : ""}
        <div class="profile-stats-grid ${tbhRequestsEnabled() ? "" : "single"}">
            <div class="profile-stat-card"><strong><span class="heart">${uiIcon("heart")}</span>${Number(profile.vote_count || 0).toLocaleString()}</strong><span>Votes Received</span></div>
            ${tbhRequestsEnabled() ? `<div class="profile-stat-card"><strong>${appSymbolMarkup("tbh", "profile-stat-symbol tbh-stat-symbol")}${Number(profile.tbh_unique_requester_count || 0).toLocaleString()}</strong><span>TBH Requests</span></div>` : ""}
        </div>
    </article>`;
    if (state.selectedClassmateTopQuestionsWeekly === null) {
        $("#classmateWeeklyPolls").innerHTML = '<div class="profile-poll-empty">Loading...</div>';
    } else {
        renderProfilePolls($("#classmateWeeklyPolls"), state.selectedClassmateTopQuestionsWeekly, "No polls this week yet");
    }
    if (state.selectedClassmateTopQuestionsAllTime === null) {
        $("#classmateAllTimePolls").innerHTML = '<div class="profile-poll-empty">Loading...</div>';
    } else {
        renderProfilePolls($("#classmateAllTimePolls"), state.selectedClassmateTopQuestionsAllTime, "No polls yet");
    }
}

async function openClassmateProfile(userId) {
    const preview = [...(state.classmateDirectory || []), ...(state.classmates || [])]
        .find((classmate) => String(classmate.user_id) === String(userId));
    if (!preview) return;
    const generation = ++state.classmateProfileGeneration;
    state.classmateProfileReturnToDirectory = $("#classmateDirectoryDialog").open;
    if (state.classmateProfileReturnToDirectory) $("#classmateDirectoryDialog").close();
    state.selectedClassmateProfile = preview;
    state.selectedClassmateAskTarget = null;
    state.selectedClassmateTopQuestionsWeekly = null;
    state.selectedClassmateTopQuestionsAllTime = null;
    renderClassmateProfile();
    $("#classmateProfileStatus").textContent = "Loading profile...";
    openDetailScreen($("#classmateProfileDialog"));
    const requests = await Promise.allSettled([
        api.getProfile(userId),
        api.getTopQuestions(userId, "weekly", 10),
        api.getTopQuestions(userId, "all_time", 3),
        api.getProfileAskTarget(userId),
    ]);
    if (generation !== state.classmateProfileGeneration) return;
    if (requests[0].status === "fulfilled") state.selectedClassmateProfile = requests[0].value;
    if (requests[1].status === "fulfilled") state.selectedClassmateTopQuestionsWeekly = requests[1].value;
    else state.selectedClassmateTopQuestionsWeekly = [];
    if (requests[2].status === "fulfilled") state.selectedClassmateTopQuestionsAllTime = requests[2].value;
    else state.selectedClassmateTopQuestionsAllTime = [];
    if (requests[3].status === "fulfilled") {
        const askTargetResponse = requests[3].value;
        const askTarget = askTargetResponse?.target || askTargetResponse;
        state.selectedClassmateAskTarget = typeof askTarget?.public_token === "string" && askTarget.public_token.trim()
            ? askTarget
            : null;
    }
    $("#classmateProfileStatus").textContent = requests[0].status === "rejected"
        ? userMessage(requests[0].reason, "Could not load this profile.")
        : "";
    renderClassmateProfile();
}

function backToClassmates() {
    closeDetailScreen($("#classmateProfileDialog"));
    if (state.classmateProfileReturnToDirectory) {
        renderClassmateDirectory();
        $("#classmateDirectoryDialog").showModal();
        requestAnimationFrame(() => document.activeElement?.closest?.("#classmateDirectoryDialog") && document.activeElement.blur());
    }
    state.classmateProfileReturnToDirectory = false;
}

async function moderateSelectedClassmate(action) {
    const profile = state.selectedClassmateProfile;
    if (!profile?.user_id) return;
    const verb = action === "block" ? "block" : "report";
    if (!await confirmSheet({
        title: `${verb === "block" ? "Block" : "Report"} ${displayName(profile)}?`,
        message: verb === "block" ? "They will be removed from your Valid experience." : "Valid will review this profile.",
        confirmLabel: verb === "block" ? "Block" : "Report",
        destructive: true,
    })) return;
    $("#classmateProfileStatus").textContent = verb === "block" ? "Blocking profile…" : "Sending report…";
    try {
        if (verb === "block") {
            await api.blockUser(api.user.id, profile.user_id);
            state.classmateDirectory = (state.classmateDirectory || []).filter((item) => String(item.user_id) !== String(profile.user_id));
            closeDetailScreen($("#classmateProfileDialog"));
            showToast("Profile blocked");
        } else {
            await api.reportUser(api.user.id, profile.user_id);
            $("#classmateProfileStatus").textContent = "Report sent. Thank you for helping keep Valid safe.";
        }
    } catch (error) {
        $("#classmateProfileStatus").textContent = friendlyErrorMessage(error, `Could not ${verb} this profile.`);
    }
}

async function loadProfilePanel({ force = false } = {}) {
    renderProfilePanel();
    if (!force && Date.now() - state.profilePanelLoadedAt < 60_000) return;
    if (state.profilePanelLoading) return state.profilePanelLoading;
    state.profilePanelLoading = refreshProfilePanelData();
    try {
        await state.profilePanelLoading;
        state.profilePanelLoadedAt = Date.now();
    } finally {
        state.profilePanelLoading = null;
    }
}

async function refreshProfilePanelData() {
    $("#profileStatus").textContent = "Loading your profile...";
    const requests = [
        { key: "profile", promise: api.getProfile(api.user.id) },
        { key: "currentUser", promise: api.getUser(api.user.id) },
    ];
    if (!state.askLink) requests.push({ key: "askLink", promise: api.getAskLink(api.user.id) });
    if (!state.askAccess) requests.push({ key: "askAccess", promise: api.getAnonymousAskAccess(api.user.id) });
    if (!state.passkeyStatus) requests.push({ key: "passkeyStatus", promise: api.getPasskeyStatus() });
    if (!state.inviteStatus) requests.push({ key: "inviteStatus", promise: api.getInviteStatus(api.user.id) });
    if (!state.classmateDirectory || state.activeClassmatesThisWeek === null) requests.push({ key: "classmates", promise: api.getClassmatesWithMetadata(api.user.id, "", 500) });
    const results = await Promise.allSettled(requests.map((request) => request.promise));
    let profileError = "";
    requests.forEach((request, index) => {
        const result = results[index];
        if (result.status === "fulfilled") {
            if (request.key === "profile") {
                state.profile = result.value;
                writeAppCache("profile", result.value);
            }
            if (request.key === "currentUser") api.user = { ...api.user, ...result.value };
            if (request.key === "askLink") state.askLink = result.value;
            if (request.key === "askAccess") state.askAccess = result.value;
            if (request.key === "passkeyStatus") state.passkeyStatus = result.value;
            if (request.key === "inviteStatus") state.inviteStatus = result.value;
            if (request.key === "classmates") {
                state.classmateDirectory = result.value.classmates;
                state.classmates = result.value.classmates;
                state.activeClassmatesThisWeek = result.value.activeThisWeekCount;
                writeAppCache("classmates", result.value.classmates);
            }
        } else if (request.key === "askLink" && result.reason?.status === 404) {
            $("#askLinkSection").classList.add("hidden");
        } else {
            profileError ||= userMessage(result.reason, "Could not load all profile details.");
        }
    });
    $("#profileStatus").textContent = profileError;
    $("#askStatus").textContent = "";
    renderProfilePanel();
    if (state.askLink) {
        $("#askLinkSection").classList.remove("hidden");
        renderAskLink();
    }
}

function maybePromptForPasskeyEnrollment() {
    const count = Math.max(0, Number(state.passkeyStatus?.credentialCount || 0));
    if (!state.passkeyStatus || state.passkeyStatus.registered === true || count > 0) return;
    const key = `valid:passkey-prompted:${api.user?.id || "user"}`;
    try {
        if (sessionStorage.getItem(key) === "1") return;
        sessionStorage.setItem(key, "1");
    } catch (_) { /* Prompt once in memory when session storage is unavailable. */ }
    const openWhenReady = (attempt = 0) => {
        const dialog = $("#passkeyEnrollmentDialog");
        if (!dialog.open && !$("dialog[open]")) dialog.showModal();
        else if (attempt < 10) setTimeout(() => openWhenReady(attempt + 1), 500);
    };
    setTimeout(openWhenReady, 350);
}

async function addBackupPasskey(trigger = null) {
    const button = trigger instanceof HTMLElement ? trigger : $("#addPasskeyButton");
    const profileButton = $("#addPasskeyButton");
    const promptButton = $("#enrollPasskeyButton");
    button.disabled = true;
    profileButton.disabled = true;
    promptButton.disabled = true;
    $("#passkeyStatusText").textContent = "Confirm passkey setup on your device...";
    $("#passkeyEnrollmentStatus").textContent = "Confirm with your phone's screen lock.";
    try {
        if (demoMode) await api.addDemoPasskey();
        else await createAdditionalPasskey(api, api.user.id);
        state.passkeyStatus = await api.getPasskeyStatus();
        renderPasskeyStatus();
        if ($("#passkeyEnrollmentDialog").open) $("#passkeyEnrollmentDialog").close();
        successHaptic();
        showToast("Backup passkey added");
    } catch (error) {
        const message = userMessage(error, "Could not add that passkey.");
        $("#passkeyEnrollmentStatus").textContent = message;
        showToast(message);
    } finally {
        button.disabled = false;
        profileButton.disabled = false;
        promptButton.disabled = false;
        renderPasskeyStatus();
    }
}

async function handlePasskeySignIn() {
    const button = $("#passkeyButton");
    $("#authStatus").textContent = "";
    setButtonLoading(button, true, "Checking your passkey...");
    try {
        const login = demoMode ? await api.demoLogin() : await signInWithPasskey(api);
        api.saveSession(login);
        await showSignedIn();
    } catch (error) {
        reportAuthFailure(error);
        showAuthBrowserHelp(error, false);
        $("#authStatus").textContent = friendlyErrorMessage(error, "Passkey sign-in failed. Please try again.");
    } finally {
        setButtonLoading(button, false);
    }
}

function deviceInstallationId() {
    const key = "valid.web.installation-id";
    let value = localStorage.getItem(key);
    if (!value) {
        value = crypto.randomUUID();
        localStorage.setItem(key, value);
    }
    return value;
}

function dateOfBirthFromAge(value) {
    const age = Number(value);
    if (!Number.isInteger(age) || age < 13 || age > 27) return null;
    return `${new Date().getFullYear() - age}-01-01T00:00:00Z`;
}

function signupPhoneDigits(value) {
    let digits = String(value || "").replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
    return digits.slice(0, 10);
}

function formatSignupPhone(value) {
    const digits = signupPhoneDigits(value);
    if (digits.length < 4) return digits;
    if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const signupGradeCatalog = [
    { name: "6th Grade", gradeNumber: 6 },
    { name: "7th Grade", gradeNumber: 7 },
    { name: "8th Grade", gradeNumber: 8 },
    { name: "Freshman", gradeNumber: 9 },
    { name: "Sophomore", gradeNumber: 10 },
    { name: "Junior", gradeNumber: 11 },
    { name: "Senior", gradeNumber: 12 },
];

function selectSignupAge(value, { scroll = true, smooth = false } = {}) {
    const age = Math.max(13, Math.min(27, Number(value) || 13));
    $("#signupAge").value = String(age);
    $("#signupAgeValue").textContent = String(age);
    $$('[data-signup-age]').forEach((option) => {
        const selected = Number(option.dataset.signupAge) === age;
        option.setAttribute("aria-selected", String(selected));
    });
    if (scroll) {
        $("#signupAgeWheel").scrollTo({ top: (age - 13) * 40, behavior: smooth ? "smooth" : "auto" });
    }
}

function signupGraduationYear(gradeNumber, date = new Date()) {
    const academicYearEnd = date.getFullYear() + (date.getMonth() >= 6 ? 1 : 0);
    return academicYearEnd + (12 - gradeNumber);
}

function availableSignupGrades() {
    const school = state.signupSelectedSchool;
    const minGrade = Number.isFinite(Number(school?.min_grade)) ? Number(school.min_grade) : 6;
    const maxGrade = Number.isFinite(Number(school?.max_grade)) ? Number(school.max_grade) : 12;
    const available = signupGradeCatalog.filter(({ gradeNumber }) => gradeNumber >= minGrade && gradeNumber <= maxGrade);
    return available.length ? available : signupGradeCatalog;
}

function selectSignupGrade(value) {
    $("#signupGrade").value = value || "";
    $$('[data-signup-grade]').forEach((option) => {
        const selected = option.dataset.signupGrade === value;
        option.classList.toggle("selected", selected);
        option.setAttribute("aria-checked", String(selected));
    });
    $("#signupGradeContinue").disabled = !value;
    $("#signupStatus").textContent = "";
}

function renderSignupGradeOptions() {
    const grades = availableSignupGrades();
    const currentGrade = $("#signupGrade").value;
    const currentGradeAvailable = grades.some(({ name }) => name === currentGrade);
    $("#signupGradeOptions").innerHTML = grades.map(({ name, gradeNumber }) => {
        const selected = currentGradeAvailable && name === currentGrade;
        return `<button class="signup-grade-option ${selected ? "selected" : ""}" type="button" role="radio" aria-checked="${selected}" data-signup-grade="${escapeHTML(name)}"><span><strong>${escapeHTML(name)}</strong><small>C/O ${signupGraduationYear(gradeNumber)}</small></span></button>`;
    }).join("");
    if (!currentGradeAvailable) $("#signupGrade").value = "";
    $("#signupGradeContinue").disabled = !currentGradeAvailable;
}

function selectSignupGender(value) {
    $("#signupGender").value = value || "";
    $$('[data-signup-gender]').forEach((option) => {
        const selected = option.dataset.signupGender === value;
        option.classList.toggle("selected", selected);
        option.setAttribute("aria-checked", String(selected));
    });
    $("#signupGenderContinue").disabled = !value;
    $("#signupStatus").textContent = "";
}

function showAuthBrowserHelp(error, signup) {
    const link = $(signup ? '#signupBrowserHelp' : '#authBrowserHelp');
    // Another browser on the same blocked network would fail the same way.
    const recoverable = ['embedded_browser', 'passkeys_unavailable', 'related_origins_unavailable', 'unsupported_origin', 'secure_context', 'passkey_security'].includes(error?.code)
        && error?.passkeyContext !== 'webauthn.related_origin_unreachable';
    link.classList.toggle('hidden', !recoverable);
    if (recoverable) {
        link.href = authBrowserURL({ signup });
        link.textContent = /Android/i.test(navigator.userAgent) ? 'Open in Chrome' : 'Open Valid in your browser';
    }
}

async function openSignupDialog() {
    if (!demoMode) {
        try {
            await checkPasskeyEnvironment();
            if (!await enablePreviewSignup()) return;
        }
        catch (error) {
            $('#authStatus').textContent = userMessage(error, "Passkeys aren’t available in this browser right now.");
            showAuthBrowserHelp(error, false);
            const help = $('#authBrowserHelp');
            if (!help.classList.contains('hidden')) help.href = authBrowserURL({ signup: true });
            reportAuthFailure(error);
            return;
        }
    }
    state.signupCompletionUncertain = false;
    $('#signupForm').querySelectorAll('button[type="submit"]').forEach(button => { button.disabled = false; });
    $('#signupRecoverAccount').classList.add('hidden');
    $('#signupBrowserHelp').classList.add('hidden');
    setRuntimeStyles($("#signupDialog"), { "--signup-layout-height": `${window.innerHeight}px` });
    $("#signupStatus").textContent = "";
    resetSignupPhotoPreview();
    resetSignupSchoolPicker();
    state.signupPhoneVerified = false;
    state.signupVerifiedPhone = null;
    resetSignupTurnstile({ remove: true });
    $("#signupPhoneCode").value = "";
    selectSignupAge($("#signupAge").value || 13, { scroll: false });
    renderSignupGradeOptions();
    setSignupStep(0);
    $("#signupDialog").showModal();
    requestAnimationFrame(() => selectSignupAge($("#signupAge").value));
}

async function turnstileSiteKey() {
    if (!state.config) state.config = await api.getConfig();
    return window.VALID_TURNSTILE_SITE_KEY || state.config?.turnstile_site_key || "";
}

async function waitForTurnstileAPI() {
    const startedAt = Date.now();
    while (!window.turnstile) {
        if (Date.now() - startedAt > 10_000) throw new Error("Security check could not load. Please try again.");
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return window.turnstile;
}

function settleTurnstileWaiter(kind, value) {
    const callback = kind === "resolve" ? state.turnstileResolve : state.turnstileReject;
    state.turnstileResolve = null;
    state.turnstileReject = null;
    callback?.(value);
}

function resetSignupTurnstile({ remove = false } = {}) {
    state.turnstileToken = null;
    settleTurnstileWaiter("reject", new Error("Security check was reset."));
    if (state.turnstileWidgetId === null || !window.turnstile) return;
    if (remove) {
        window.turnstile.remove(state.turnstileWidgetId);
        state.turnstileWidgetId = null;
        return;
    }
    window.turnstile.reset(state.turnstileWidgetId);
}

async function getSignupTurnstileToken() {
    if (demoMode) return "demo";
    const [sitekey, turnstile] = await Promise.all([turnstileSiteKey(), waitForTurnstileAPI()]);
    if (!sitekey) throw new Error("Security verification is not configured yet.");

    state.turnstileToken = null;
    const tokenPromise = new Promise((resolve, reject) => {
        let rejectWaiter;
        const timer = setTimeout(() => {
            if (state.turnstileReject !== rejectWaiter) return;
            state.turnstileResolve = null;
            state.turnstileReject = null;
            reject(new Error("Security check took too long. Please try again."));
        }, 30_000);
        state.turnstileResolve = (token) => {
            clearTimeout(timer);
            resolve(token);
        };
        rejectWaiter = (error) => {
            clearTimeout(timer);
            reject(error);
        };
        state.turnstileReject = rejectWaiter;
    });

    if (state.turnstileWidgetId === null) {
        state.turnstileWidgetId = turnstile.render("#signupTurnstile", {
            sitekey,
            action: TURNSTILE_ACTION,
            appearance: "interaction-only",
            size: "flexible",
            callback: (token) => {
                state.turnstileToken = token;
                settleTurnstileWaiter("resolve", token);
            },
            "expired-callback": () => {
                state.turnstileToken = null;
            },
            "error-callback": () => {
                state.turnstileToken = null;
                settleTurnstileWaiter("reject", new Error("Security check failed to load. Please try again."));
            },
        });
    } else {
        turnstile.reset(state.turnstileWidgetId);
    }

    const immediateToken = turnstile.getResponse(state.turnstileWidgetId);
    if (immediateToken) settleTurnstileWaiter("resolve", immediateToken);
    return tokenPromise;
}

function resetSignupSchoolPicker() {
    state.signupNearbySchools = [];
    state.signupSelectedSchool = null;
    state.signupSchoolFallback = false;
    state.signupSchoolLookupGeneration += 1;
    $("#signupSchoolPicker").classList.add("hidden");
    $("#signupSchoolFallback").classList.add("hidden");
    $("#signupSchoolResults").replaceChildren();
    $("#signupSchoolSearch").value = "";
    $("#signupSchoolContinue").disabled = true;
    for (const input of [$("#signupSchool"), $("#signupCity"), $("#signupState")]) {
        input.disabled = true;
        input.required = false;
    }
}

function schoolLocationLabel(school) {
    return [school.city, school.state].filter(Boolean).join(", ");
}

function renderSignupSchoolResults() {
    const query = $("#signupSchoolSearch").value.trim().toLowerCase();
    const schools = state.signupNearbySchools.filter((school) => {
        if (!query) return true;
        return `${school.name} ${school.city || ""} ${school.state || ""}`.toLowerCase().includes(query);
    });
    const container = $("#signupSchoolResults");
    if (!schools.length) {
        container.innerHTML = `<p class="signup-school-empty">No nearby schools match that search.</p>`;
        return;
    }
    container.innerHTML = schools.map((school) => {
        const selected = String(state.signupSelectedSchool?.id) === String(school.id);
        const logoURL = school.logo_url ? api.assetURL(school.logo_url) : "";
        const initials = String(school.name || "S").split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
        return `<button class="signup-school-result ${selected ? "selected" : ""}" type="button" role="option" aria-selected="${selected}" data-signup-school="${escapeHTML(school.id)}">
            <span class="signup-school-logo">${logoURL ? mediaImageMarkup(logoURL, { initials }) : escapeHTML(initials)}</span>
            <span><strong>${escapeHTML(school.name)}</strong><small>${escapeHTML(schoolLocationLabel(school))}${Number.isFinite(Number(school.distance_miles)) ? ` · ${Number(school.distance_miles).toFixed(1)} mi` : ""}</small></span>
            <span class="signup-school-check" aria-hidden="true">${selected ? "✓" : "›"}</span>
        </button>`;
    }).join("");
}

async function lookupSignupSchools() {
    const zipCode = $("#signupZip").value.replace(/\D/g, "").slice(0, 5);
    $("#signupZip").value = zipCode;
    if (!/^\d{5}$/.test(zipCode)) {
        $("#signupStatus").textContent = "Enter a 5-digit ZIP code.";
        return;
    }
    const generation = ++state.signupSchoolLookupGeneration;
    $("#signupStatus").textContent = "Finding the 50 closest schools...";
    try {
        const response = await api.getNearbySchools(zipCode, 50);
        if (generation !== state.signupSchoolLookupGeneration) return;
        state.signupNearbySchools = response.schools || [];
        state.signupSelectedSchool = null;
        state.signupSchoolFallback = false;
        $("#signupSchoolSearch").value = "";
        $("#signupSchoolPicker").classList.remove("hidden");
        $("#signupSchoolFallback").classList.add("hidden");
        $("#signupSchoolContinue").disabled = true;
        renderSignupSchoolResults();
        $("#signupStatus").textContent = state.signupNearbySchools.length
            ? `Showing ${state.signupNearbySchools.length} schools near ${zipCode}.`
            : "No schools were found near that ZIP code.";
    } catch (error) {
        if (generation !== state.signupSchoolLookupGeneration) return;
        state.signupNearbySchools = [];
        state.signupSelectedSchool = null;
        $("#signupSchoolPicker").classList.add("hidden");
        showSignupSchoolFallback(true);
        $("#signupStatus").textContent = userMessage(error, "Couldn't load nearby schools. Enter your school manually.");
    }
}

function selectSignupSchool(schoolId) {
    const school = state.signupNearbySchools.find((candidate) => String(candidate.id) === String(schoolId));
    if (!school) return;
    state.signupSelectedSchool = school;
    state.signupSchoolFallback = false;
    $("#signupSchoolContinue").disabled = false;
    $("#signupStatus").textContent = "";
    renderSignupGradeOptions();
    renderSignupSchoolResults();
}

function showSignupSchoolFallback(show) {
    state.signupSchoolFallback = show;
    state.signupSelectedSchool = show ? null : state.signupSelectedSchool;
    $("#signupSchoolFallback").classList.toggle("hidden", !show);
    $("#signupSchoolPicker").classList.toggle("hidden", show || !state.signupNearbySchools.length);
    for (const input of [$("#signupSchool"), $("#signupCity"), $("#signupState")]) {
        input.disabled = !show;
        input.required = show;
    }
    $("#signupSchoolContinue").disabled = show ? false : !state.signupSelectedSchool;
    $("#signupStatus").textContent = show ? "Enter the school exactly as it should appear." : "Choose a nearby school.";
    if (show) $("#signupSchool").focus();
}

function setSignupStep(index) {
    const focused = document.activeElement;
    if (focused && $("#signupDialog").contains(focused) && focused.matches("input, select, textarea")) focused.blur();
    state.signupStep = Math.max(0, Math.min(9, index));
    $$('[data-signup-step]').forEach((step) => step.classList.toggle("hidden", Number(step.dataset.signupStep) !== state.signupStep));
    $("#signupStatus").textContent = "";
    const autofocusByStep = {
        3: "#signupPhone",
        4: "#signupPhoneCode",
        5: "#signupFirstName",
        6: "#signupLastName",
        7: "#signupUsername",
    };
    const autofocusInput = $(autofocusByStep[state.signupStep]);
    if (autofocusInput) {
        autofocusInput.focus({ preventScroll: true });
        const end = autofocusInput.value.length;
        autofocusInput.setSelectionRange?.(end, end);
    }
    requestAnimationFrame(() => {
        $("#signupDialog").scrollTop = 0;
        $(`[data-signup-step="${state.signupStep}"]`).scrollTop = 0;
        if (autofocusInput) keepFocusedControlVisible();
    });
    $(".signup-back-button").classList.toggle("hidden", state.signupStep === 0);
    if (state.signupStep === 2) renderSignupGradeOptions();
    if (state.signupStep === 9) {
        resetSignupPhotoPreview();
        $("#signupPicture").value = "";
    }
}

async function advanceSignup(button) {
    const step = $(`[data-signup-step="${state.signupStep}"]`);
    const fields = [...step.querySelectorAll("input, select")];
    const invalid = fields.find((field) => !field.checkValidity());
    if (invalid) return invalid.reportValidity();
    if (state.signupStep === 1 && !state.signupSelectedSchool && !state.signupSchoolFallback) {
        $("#signupStatus").textContent = "Choose your school before continuing.";
        return;
    }
    if (state.signupStep === 2 && !$("#signupGrade").value) {
        $("#signupStatus").textContent = "Choose your grade before continuing.";
        return;
    }
    if (state.signupStep === 3) {
        const phoneNumber = signupPhoneDigits($("#signupPhone").value);
        if (phoneNumber.length !== 10) {
            $("#signupStatus").textContent = "Enter a valid 10-digit phone number.";
            return;
        }
        $("#signupPhone").value = formatSignupPhone(phoneNumber);
        state.signupPhoneVerified = false;
        state.signupVerifiedPhone = null;
        $("#signupPhoneCode").value = "";
        // Keep this transition inside the tap gesture so mobile Safari and
        // Chrome can open the numeric code keyboard without requiring a second tap.
        setSignupStep(demoMode ? 5 : 4);
        setButtonLoading(button, true, "Checking...");
        try {
            const result = await api.checkPhoneRegistration(phoneNumber, deviceInstallationId());
            if (result.exists) {
                $("#signupDialog").close();
                $("#authStatus").textContent = "An account already exists for this phone number. Sign in.";
                requestAnimationFrame(() => $("#passkeyButton").focus());
                return;
            }
            if (!demoMode) {
                $("#signupStatus").textContent = "Completing a quick security check…";
                const turnstileToken = await getSignupTurnstileToken();
                const verification = await api.requestPhoneVerification(phoneNumber, turnstileToken);
                resetSignupTurnstile();
                $("#signupCodeHint").textContent = `We sent a verification code to ${formatSignupPhone(phoneNumber)}.`;
                $("#signupStatus").textContent = verification.can_resend
                    ? "Enter the code from your text message."
                    : "Enter the code from your text message.";
            }
        } catch (error) {
            if (error.status === 409) {
                $("#signupDialog").close();
                $("#authStatus").textContent = "An account already exists for this phone number. Sign in.";
                requestAnimationFrame(() => $("#passkeyButton").focus());
                return;
            }
            setSignupStep(3);
            $("#signupStatus").textContent = userMessage(error, "Could not check that phone number.");
            return;
        } finally { setButtonLoading(button, false); }
        return;
    }
    if (state.signupStep === 4) {
        const phoneNumber = signupPhoneDigits($("#signupPhone").value);
        const code = $("#signupPhoneCode").value.replace(/\D/g, "");
        if (!/^\d{4,10}$/.test(code)) {
            $("#signupStatus").textContent = "Enter the verification code from your text message.";
            return;
        }
        setButtonLoading(button, true, "Verifying...");
        try {
            const verification = await api.confirmPhoneVerification(phoneNumber, code);
            if (!verification.is_approved) {
                $("#signupStatus").textContent = "That code was not approved. Try again.";
                return;
            }
            state.signupPhoneVerified = true;
            state.signupVerifiedPhone = phoneNumber;
            setSignupStep(5);
        } catch (error) {
            $("#signupStatus").textContent = userMessage(error, "Could not verify that code.");
        } finally { setButtonLoading(button, false); }
        return;
    }
    if (state.signupStep === 8 && !$("#signupGender").value) {
        $("#signupStatus").textContent = "Choose a gender before continuing.";
        return;
    }
    if (state.signupStep === 7) {
        setButtonLoading(button, true, "Checking username...");
        try {
            const result = await api.checkUsernameAvailability($("#signupUsername").value.trim().toLowerCase());
            if (!result.available) {
                $("#signupStatus").textContent = "That username is not available. Try another one.";
                return;
            }
        } catch (error) {
            $("#signupStatus").textContent = userMessage(error, "Could not check that username.");
            return;
        } finally { setButtonLoading(button, false); }
    }
    setSignupStep(state.signupStep + 1);
}

async function resendSignupPhoneCode(button) {
    const phoneNumber = signupPhoneDigits($("#signupPhone").value);
    if (phoneNumber.length !== 10) {
        setSignupStep(3);
        $("#signupStatus").textContent = "Enter a valid 10-digit phone number.";
        return;
    }
    setButtonLoading(button, true, "Sending...");
    $("#signupStatus").textContent = "";
    try {
        $("#signupStatus").textContent = "Completing a quick security check…";
        const turnstileToken = await getSignupTurnstileToken();
        await api.requestPhoneVerification(phoneNumber, turnstileToken);
        resetSignupTurnstile();
        $("#signupCodeHint").textContent = `We sent a new verification code to ${formatSignupPhone(phoneNumber)}.`;
        $("#signupPhoneCode").value = "";
        $("#signupPhoneCode").focus({ preventScroll: true });
    } catch (error) {
        if (error.status === 409) {
            $("#signupDialog").close();
            $("#authStatus").textContent = "An account already exists for this phone number. Sign in.";
            requestAnimationFrame(() => $("#passkeyButton").focus());
            return;
        }
        $("#signupStatus").textContent = userMessage(error, "Could not send another code.");
    } finally {
        setButtonLoading(button, false);
    }
}

async function createAccount(event) {
    event.preventDefault();
    if (state.signupCompletionUncertain) return;
    const form = event.currentTarget;
    const button = event.submitter || form.querySelector("button[type=submit]");
    const dateOfBirth = dateOfBirthFromAge($("#signupAge").value);
    if (!dateOfBirth) {
        $("#signupStatus").textContent = "Choose an age between 13 and 27.";
        return;
    }
    const username = $("#signupUsername").value.trim().toLowerCase();
    const signupPhone = signupPhoneDigits($("#signupPhone").value);
    if (!demoMode && (!state.signupPhoneVerified || state.signupVerifiedPhone !== signupPhone)) {
        setSignupStep(3);
        $("#signupStatus").textContent = "Verify your phone number before creating your account.";
        return;
    }
    const profilePicture = state.signupPhotoFile;
    const submitButtons = [...form.querySelectorAll("button[type=submit]")];
    submitButtons.forEach((candidate) => { candidate.disabled = true; });
    setButtonLoading(button, true, "Creating your account...");
    $("#signupStatus").textContent = "Creating your account...";
    try {
        let school = state.signupSelectedSchool;
        if (!school) {
            $("#signupStatus").textContent = "Checking your school...";
            const schoolResult = await api.resolveSchool({
                school_name: $("#signupSchool").value.trim(),
                city: $("#signupCity").value.trim(),
                state: $("#signupState").value.trim().toUpperCase(),
                grades: "6-12",
                min_grade: 6,
                max_grade: 12,
            });
            school = schoolResult.school;
        }
        if (!school?.id) throw new Error("We couldn't set up that school. Check its name and location.");
        const profile = {
            first_name: $("#signupFirstName").value.trim(),
            last_name: $("#signupLastName").value.trim(),
            date_of_birth: dateOfBirth,
            gender: $("#signupGender").value,
            school_id: school.id,
            grade: $("#signupGrade").value,
            username,
            profile_picture_filename: null,
        };
        $("#signupStatus").textContent = "Finish the setup prompt on your device.";
        let login;
        if (demoMode) {
            login = await api.demoSignup({ profile, school_name: school.name });
        } else {
            const credential = await createSignupPasskey(api, username);
            login = await completeSignupSafely(api, {
                ...credential,
                phoneNumber: signupPhone,
                deviceInstallationId: deviceInstallationId(),
                idempotencyKey: crypto.randomUUID(),
                profile,
            });
        }
        api.saveSession(login);
        let photoUploadFailed = false;
        if (profilePicture) {
            try { await api.uploadProfilePicture(api.user.id, profilePicture); }
            catch (_) { photoUploadFailed = true; }
        }
        form.reset();
        selectSignupAge(13, { scroll: false });
        selectSignupGrade("");
        selectSignupGender("");
        state.signupPhoneVerified = false;
        state.signupVerifiedPhone = null;
        resetSignupSchoolPicker();
        resetSignupPhotoPreview();
        $("#signupDialog").close();
        await showSignedIn();
        showToast(photoUploadFailed ? "Welcome! Add your photo from Profile when you're ready." : "Welcome to Valid");
        setTimeout(() => { if (api.hasSession()) openClassmatesDialog({ onboarding: true }); }, 700);
    } catch (error) {
        reportAuthFailure(error);
        if (needsPhoneReverification(error)) {
            state.signupPhoneVerified = false;
            state.signupVerifiedPhone = null;
            $("#signupPhoneCode").value = "";
            setSignupStep(3);
            $("#signupStatus").textContent = "Your phone verification expired. Request a new code to finish signup. Your other details are still here.";
            return;
        }
        showAuthBrowserHelp(error, true);
        state.signupCompletionUncertain = error.code === 'signup_result_unknown';
        $('#signupRecoverAccount').classList.toggle('hidden', !state.signupCompletionUncertain);
        $("#signupStatus").textContent = userMessage(error, "Could not create your account.");
    } finally {
        setButtonLoading(button, false);
        submitButtons.forEach((candidate) => { candidate.disabled = state.signupCompletionUncertain; });
    }
}

function promptForKey(key) {
    return TBH_PROMPTS.find((prompt) => prompt.key === key) || TBH_PROMPTS[0];
}

function normalizeReactionState(item) {
    if (!item) return;
    if (!Number.isFinite(Number(item.reaction_count))) item.reaction_count = Number(item.upvote_count || 0);
    if (!item.reaction_summary || typeof item.reaction_summary !== "object") item.reaction_summary = {};
    if (!("current_user_reaction" in item)) item.current_user_reaction = item.user_has_upvoted ? "legacy_agree" : null;
    if (!("can_react" in item)) item.can_react = true;
}

function dominantReaction(item) {
    normalizeReactionState(item);
    if (item.current_user_reaction) return REACTION_BY_TYPE.get(item.current_user_reaction);
    return Object.entries(item.reaction_summary)
        .filter(([type, count]) => REACTION_BY_TYPE.has(type) && Number(count) > 0)
        .sort(([leftType, leftCount], [rightType, rightCount]) => Number(rightCount) - Number(leftCount) || leftType.localeCompare(rightType))
        .map(([type]) => REACTION_BY_TYPE.get(type))[0] || null;
}

function tbhAuthorLine(item) {
    return tbhSenderLine(item, { safeGrade: senderGradeIsSafe(item.author_grade, state.classmates) });
}

function commentsEnabled() {
    return state.config?.enable_web_comments === true;
}

function commentBubbleMarkup() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h12a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H9l-4.5 3 .8-3.7A3 3 0 0 1 4 13.5v-8Z"/></svg>`;
}

function commentControlMarkup(item, targetType, targetId) {
    if (!commentsEnabled() || !targetId) return "";
    const count = Math.max(0, Number(item.comment_count || 0));
    return `<button class="comment-count-button" type="button" data-comments-target="${escapeHTML(`${targetType}:${targetId}`)}" aria-label="Open ${count} comment${count === 1 ? "" : "s"}">${commentBubbleMarkup()}<span data-comment-count>${count}</span></button>`;
}

function commentDetailButtonMarkup(item, targetType, targetId, className) {
    if (!commentsEnabled() || !targetId) return "";
    const count = Math.max(0, Number(item.comment_count || 0));
    // FeedEngagementCountControl: 44pt icon, hairline divider, 40pt count in one capsule.
    return `<button class="engagement-count-button ${className}" type="button" data-comments-target="${escapeHTML(`${targetType}:${targetId}`)}" aria-label="Open ${count} comments">${commentBubbleMarkup()}<span class="reaction-divider" aria-hidden="true"></span><strong data-comment-count>${count}</strong></button>`;
}

let feedView = null;
let feedViewPromise = null;
let pendingFeedRender = false;

function prepareFeedView() {
    if (!feedViewPromise) {
        feedViewPromise = preloadRoute("feed").then((route) => {
            feedView = route.createFeedView({
                $, $$, state, api,
                personalInboxFilters: PERSONAL_INBOX_FILTERS,
                reactionByType: REACTION_BY_TYPE,
                avatarMarkup, displayName, escapeHTML, formatGrade, relativeTime: shortRelativeTime,
                normalizeReactionState, dominantReaction, promptForKey, tbhAuthorLine,
                tbhRequestsEnabled, renderTabBadges, formatVoterHint, showToast,
                commentControlMarkup, personalInboxUnreadCounts,
            });
            return feedView;
        });
    }
    return feedViewPromise;
}

let commentsViewPromise = null;

function allCommentTargetItems(type, targetId) {
    const id = String(targetId);
    if (type === "poll") {
        return state.feedItems.filter((item) => String(item.question_answer_id) === id);
    }
    return [state.tbhInboxItems, state.tbhSentItems, state.schoolTbhItems]
        .flat()
        .filter((item) => String(item.activity_id) === id);
}

function updateCommentCount(type, targetId, delta) {
    const items = allCommentTargetItems(type, targetId);
    const current = Number(items[0]?.comment_count || 0);
    const next = Math.max(0, current + Number(delta || 0));
    items.forEach((item) => { item.comment_count = next; });
    const selector = `[data-comments-target="${CSS.escape(`${type}:${targetId}`)}"]`;
    $$(selector).forEach((button) => {
        const count = button.querySelector("[data-comment-count]");
        if (count) count.textContent = String(next);
        button.setAttribute("aria-label", `Open ${next} comment${next === 1 ? "" : "s"}`);
    });
    renderFeed();
}

function prepareCommentsView() {
    if (!commentsViewPromise) {
        commentsViewPromise = import("./comments/index.js").then(({ createCommentsView }) => createCommentsView({
            root: $("#commentsRoot"), api, getUser: () => api.user, getProfile: () => state.profile || api.user,
            escapeHTML, avatarMarkup, relativeTime: shortRelativeTime, openDetailScreen, closeDetailScreen, showToast,
        }));
    }
    return commentsViewPromise;
}

async function openCommentsForTarget(type, targetId, { commentId = null } = {}) {
    if (!targetId) return;
    if (!commentsEnabled()) await refreshConfig({ force: true });
    if (!commentsEnabled()) return void showToast("Comments aren't available right now. Try again soon.");
    const item = allCommentTargetItems(type, targetId)[0];
    const subject = type === "poll"
        ? item?.question_text || "Poll discussion"
        : item?.body || "TBH discussion";
    const view = await prepareCommentsView();
    await view.open({
        type,
        id: targetId,
        subject,
        onCountChange: (delta) => updateCommentCount(type, targetId, delta),
    }, { commentId });
}

function openCommentsFromValue(value, options = {}) {
    const separator = String(value).indexOf(":");
    if (separator < 1) return;
    return openCommentsForTarget(String(value).slice(0, separator), String(value).slice(separator + 1), options);
}

function renderFeed() {
    if (feedView) return feedView.renderFeed();
    if (pendingFeedRender) return;
    pendingFeedRender = true;
    void prepareFeedView().then((view) => {
        pendingFeedRender = false;
        view.renderFeed();
    });
}

function renderFeedClassmateResults() {
    if (feedView) return feedView.renderFeedClassmateResults();
    void prepareFeedView().then((view) => view.renderFeedClassmateResults());
}

function renderFeedSkeleton() {
    $("#feedList").innerHTML = Array.from({ length: 4 }, (_, index) => `<article class="feed-card feed-skeleton" aria-hidden="true">
        <span class="skeleton-block skeleton-avatar"></span>
        <span class="skeleton-copy"><i></i><i></i><i></i></span>
        <span class="skeleton-block skeleton-reaction"></span>
    </article>`).join("");
}

function selectFeedClassmate(classmateId) {
    const classmate = state.feedClassmateResults.find((item) => String(item.user_id) === String(classmateId));
    if (!classmate) return;
    const name = displayName(classmate);
    state.feedSearch = name;
    $("#feedSearch").value = name;
    state.feedType = "school";
    state.myVotesOnly = false;
    state.schoolFeedContent = "all";
    $$("[data-feed]").forEach((button) => button.classList.toggle("active", button.dataset.feed === "school"));
    $("#schoolFeedControls").classList.remove("hidden");
    loadFeed(true);
}

function scheduleFeedSearch() {
    clearTimeout(state.feedSearchTimer);
    const query = state.feedSearch.trim();
    const generation = ++state.feedSearchGeneration;
    if (query.length < 2) {
        state.feedClassmateResults = [];
        renderFeed();
        if (state.feedAppliedSearch) loadFeed(true);
        return;
    }
    state.feedSearchTimer = setTimeout(async () => {
        const classmates = (await api.getClassmates(api.user.id, query, 10).catch(() => []))
            .filter((classmate) => displayName(classmate).toLowerCase().includes(query.toLowerCase()))
            .sort((first, second) => {
                const firstName = displayName(first).toLowerCase();
                const secondName = displayName(second).toLowerCase();
                return Number(secondName.startsWith(query.toLowerCase())) - Number(firstName.startsWith(query.toLowerCase())) || firstName.localeCompare(secondName);
            })
            .slice(0, 10);
        if (generation !== state.feedSearchGeneration || query !== state.feedSearch.trim()) return;
        state.feedClassmateResults = classmates;
        renderFeedClassmateResults();
        loadFeed(true);
    }, 280);
}

function selectedFeedItem() {
    return state.feedItems.find((item) => String(item.question_answer_id) === String(state.selectedFeedItemId));
}

function reactionItems(targetType, targetId) {
    if (targetType === "poll") {
        return state.feedItems.filter((item) => String(item.question_answer_id) === String(targetId));
    }
    return [state.tbhInboxItems, state.tbhSentItems, state.schoolTbhItems]
        .flat()
        .filter((item) => String(item.activity_id) === String(targetId));
}

function reactionSnapshot(item) {
    normalizeReactionState(item);
    return {
        reaction_count: Number(item.reaction_count || 0),
        reaction_summary: { ...item.reaction_summary },
        current_user_reaction: item.current_user_reaction || null,
    };
}

function patchReactionControls(targetType, targetId, item) {
    const target = `${targetType}:${targetId}`;
    const displayed = dominantReaction(item);
    const selected = REACTION_BY_TYPE.get(item.current_user_reaction);
    const count = Math.max(0, Number(item.reaction_count || 0));
    $$(`[data-reaction-control="${CSS.escape(target)}"]`).forEach((control) => {
        control.classList.toggle("selected", Boolean(selected));
        const picker = control.querySelector("[data-reaction-picker]");
        const emoji = picker?.querySelector("[aria-hidden='true']");
        if (emoji) {
            if (displayed) emoji.textContent = displayed.emoji;
            else emoji.innerHTML = uiIcon("smile");
        }
        if (picker) picker.setAttribute("aria-label", selected ? `Your reaction is ${selected.label}. Change reaction` : "React");
        const countButton = control.querySelector("[data-reactors]");
        if (countButton) {
            countButton.textContent = String(count);
            countButton.setAttribute("aria-label", `View ${count} reactions`);
        }
    });
}

function applyReactionState(targetType, targetId, next) {
    const items = reactionItems(targetType, targetId);
    items.forEach((item) => {
        item.reaction_count = Math.max(0, Number(next.reaction_count || 0));
        item.reaction_summary = { ...(next.reaction_summary || {}) };
        item.current_user_reaction = next.current_user_reaction ?? next.reaction_type ?? null;
        item.upvote_count = item.reaction_count;
        item.user_has_upvoted = Boolean(item.current_user_reaction);
    });
    if (items[0]) patchReactionControls(targetType, targetId, items[0]);
}

function optimisticReactionState(original, reactionType) {
    const summary = { ...original.reaction_summary };
    if (original.current_user_reaction) {
        const remaining = Math.max(0, Number(summary[original.current_user_reaction] || 0) - 1);
        if (remaining) summary[original.current_user_reaction] = remaining;
        else delete summary[original.current_user_reaction];
    }
    let count = Number(original.reaction_count || 0);
    if (reactionType) {
        summary[reactionType] = Number(summary[reactionType] || 0) + 1;
        if (!original.current_user_reaction) count += 1;
    } else if (original.current_user_reaction) count -= 1;
    return { reaction_count: Math.max(0, count), reaction_summary: summary, current_user_reaction: reactionType };
}

async function setReactionForTarget(target, reactionType) {
    const [targetType, targetId] = String(target).split(":");
    const item = reactionItems(targetType, targetId)[0];
    if (!item || item.can_react === false) return;
    const original = reactionSnapshot(item);
    const generation = Number(state.reactionMutationGeneration.get(target) || 0) + 1;
    state.reactionMutationGeneration.set(target, generation);
    applyReactionState(targetType, targetId, optimisticReactionState(original, reactionType));
    softHaptic();
    try {
        const response = targetType === "poll"
            ? reactionType
                ? await api.setFeedReaction(api.user.id, targetId, reactionType)
                : await api.removeFeedReaction(api.user.id, targetId)
            : reactionType
                ? await api.setFeedActivityReaction(api.user.id, targetId, reactionType)
                : await api.removeFeedActivityReaction(api.user.id, targetId);
        if (state.reactionMutationGeneration.get(target) !== generation) return;
        applyReactionState(targetType, targetId, {
            reaction_count: response.reaction_count,
            reaction_summary: response.reaction_summary,
            current_user_reaction: response.reaction_type,
        });
    } catch (_) {
        if (state.reactionMutationGeneration.get(target) !== generation) return;
        applyReactionState(targetType, targetId, original);
        showToast("Couldn't save reaction. Try again.");
    }
}

function openReactionPicker(target, anchor) {
    const [targetType, targetId] = String(target).split(":");
    const item = reactionItems(targetType, targetId)[0];
    if (!item || item.can_react === false) return;
    normalizeReactionState(item);
    state.reactorTarget = target;
    $("#reactionPickerOptions").innerHTML = FEED_REACTIONS.map((reaction) => `<button class="${item.current_user_reaction === reaction.type ? "selected" : ""}" type="button" data-select-reaction="${reaction.type}" aria-label="${reaction.label}" aria-pressed="${item.current_user_reaction === reaction.type}"><span aria-hidden="true">${reaction.emoji}</span><small class="visually-hidden">${reaction.label}</small></button>`).join("");
    const dialog = $("#reactionPickerDialog");
    if (dialog.open) dialog.close();
    dialog.show();
    const anchorRect = anchor?.getBoundingClientRect();
    if (anchorRect) {
        const pickerRect = dialog.getBoundingClientRect();
        const left = Math.max(8, Math.min(window.innerWidth - pickerRect.width - 8, anchorRect.right - pickerRect.width));
        const preferredTop = anchorRect.top - pickerRect.height - 8;
        const top = preferredTop >= 8 ? preferredTop : Math.min(window.innerHeight - pickerRect.height - 8, anchorRect.bottom + 8);
        setRuntimeStyles(dialog, { left: `${left}px`, top: `${Math.max(8, top)}px` });
    }
    softHaptic();
}

async function openReactorList(target) {
    const [targetType, targetId] = String(target).split(":");
    state.reactorTarget = target;
    const dialog = $("#reactorListDialog");
    $("#reactorList").innerHTML = '<div class="empty-card">Loading reactions…</div>';
    dialog.showModal();
    try {
        const reactors = targetType === "poll"
            ? await api.getFeedReactors(api.user.id, targetId)
            : await api.getFeedActivityReactors(api.user.id, targetId);
        $("#reactorList").innerHTML = reactors.length ? reactors.map((reactor) => `<div class="reactor-row">${avatarMarkup({ first_name: reactor.first_name, last_name: reactor.last_name, profile_picture_url: reactor.profile_picture_url }, "row-avatar")}<strong>${escapeHTML(`${reactor.first_name} ${reactor.last_name}`)}</strong><span aria-label="${escapeHTML(REACTION_BY_TYPE.get(reactor.reaction_type)?.label || "Reaction")}">${REACTION_BY_TYPE.get(reactor.reaction_type)?.emoji || uiIcon("smile")}</span></div>`).join("") : '<div class="empty-card"><strong>No reactions yet</strong><p>Be the first to react.</p></div>';
    } catch (error) {
        $("#reactorList").innerHTML = `<div class="empty-card"><strong>Couldn't load reactions</strong><p>${escapeHTML(userMessage(error, "Please try again."))}</p></div>`;
    }
}

function detailSendButton(type, id) {
    return `<button class="detail-send-button" type="button" data-send-content="${escapeHTML(`${type}:${id}`)}" aria-label="Send ${type === 'poll' ? 'poll' : 'TBH'}" ${id == null ? 'disabled' : ''}>${uiIcon('paperplane')}<span>Send</span></button>`;
}

async function sendContentLink(button) {
    const [type, id] = button.dataset.sendContent.split(':');
    button.disabled = true;
    try {
        const result = await api.createFeedShareLink(api.user.id, type, id);
        if (navigator.share) await navigator.share({ url: result.share_url });
        else { await navigator.clipboard.writeText(result.share_url); showToast('Link copied'); }
    } catch (error) {
        if (error.name !== 'AbortError') showToast(userMessage(error, 'Could not share. Please try again.'));
    } finally { button.disabled = false; }
}

// "Question submitted by" avatar and lines. An anonymous question reads the
// same to its author, who also sees a private hint (question-attribution.js).
function submitterAttributionContent(attribution, avatarURL) {
    const anonymous = attribution.kind === "anonymous";
    const name = anonymous ? ANONYMOUS_SUBMITTER_NAME : attribution.name;
    const hint = anonymous && attribution.viewerIsAuthor ? `<small class="submitter-author-hint" data-submitter-author-hint>${uiIcon("lock")}${AUTHOR_ANONYMITY_HINT}</small>` : "";
    return `${avatarMarkup({ first_name: anonymous ? "Anonymous" : name, profile_picture_url: anonymous ? "../assets/app/anonymous.webp" : avatarURL }, "attribution-avatar")}<span><small>Question submitted by</small><strong>${escapeHTML(name)}</strong>${hint}</span>`;
}

function questionSubmitterMarkup(item) {
    const attribution = feedQuestionAttribution(item, api.user?.id);
    if (attribution.kind === "none") return '';
    const content = submitterAttributionContent(attribution, item.question_submitted_by_profile_picture_url);
    return attribution.kind === "anonymous" && item.can_reveal_question_submitter ? `<button class="poll-submitter-row" data-reveal-question-submitter type="button">${content}<span class="submitter-reveal-label">Reveal</span></button>` : `<div class="poll-submitter-row">${content}</div>`;
}

async function revealQuestionSubmitter(button) {
    const item = selectedFeedItem();
    if (!item?.can_reveal_question_submitter || item.question_submitter_revealed) return;
    if (api.user?.subscribed_user !== true) return openGodModePitch();
    const remaining = Number(state.profile?.remaining_reveals || 0);
    const cost = Number(state.config?.full_reveal_aura_cost ?? DEFAULT_FULL_REVEAL_AURA_COST);
    if (remaining <= 0 && Number(state.profile?.aura_points || 0) < cost) return showToast('You need another reveal or more aura to do that.');
    if (!await confirmSheet({
        title: "Reveal who made this question?",
        message: remaining > 0 ? freeRevealConfirmationMessage(remaining) : `Spend ${cost.toLocaleString()} aura to reveal the classmate who submitted it.`,
        confirmLabel: remaining > 0 ? "Use 1 Reveal" : `Spend ${cost.toLocaleString()} aura`,
    })) return;
    button.disabled = true;
    try {
        const result = await api.revealQuestionSubmitter(api.user.id, item.question_id);
        for (const match of state.feedItems.filter(candidate => String(candidate.question_id) === String(item.question_id))) Object.assign(match, {
            question_submitter_revealed: true, question_submitted_by_user_id: result.submitted_by_user_id,
            question_submitted_by_display_name: result.full_name, question_submitted_by_profile_picture_url: result.profile_picture_url,
        });
        state.profile.remaining_reveals = Number(result.remaining_reveals || 0);
        state.profile.aura_points = Number(result.total_aura_points ?? state.profile.aura_points);
        renderProfileHeader(); renderProfilePanel(); renderFeed(); renderFeedDetail();
    } catch (error) { showToast(userMessage(error, 'Could not reveal question author.')); button.disabled = false; }
}

function renderFeedDetail() {
    const item = selectedFeedItem();
    if (!item) return;
    const selectedName = item.selected_contact_name
        || item.voted_for_name
        || item.contact_name
        || (item.item_type === "received_vote" ? displayName(state.profile) : "Someone");
    const options = Array.isArray(item.presented_options) ? item.presented_options : [];
    const artworkURL = api.assetURL(item.image_url);
    // QuestionDetailToolbar: the voter line is the title, and there is none without a gender.
    $("#feedDetailDialog .detail-screen-header > strong").textContent = item.voter_gender ? formatVoterStatement(item) : "";
    $("#feedDetailBody").innerHTML = `<article class="feed-detail-card">
        <div class="feed-detail-prompt"><h3>${escapeHTML(item.question_text)}</h3>
        ${item.is_nomination ? "" : questionSubmitterMarkup(item)}</div>
        <div class="feed-detail-art-frame"><div class="feed-detail-art">${artworkURL ? mediaImageMarkup(artworkURL) : `<div class="artwork-placeholder"><img loading="lazy" decoding="async" src="../assets/app/pencil-clipboard.webp" alt=""><span>Image unavailable</span></div>`}</div></div>
        ${item.is_nomination ? `<div class="feed-nomination-card"><strong>${escapeHTML(selectedName)}</strong><p>got nominated${item.voter_gender ? ` by ${escapeHTML(formatVoterHint(item).replace(/^(from|by) /, ""))}` : item.voter_name ? ` by ${escapeHTML(item.voter_name)}` : ""}</p><span aria-hidden="true">🎉</span></div>` : options.length ? `<div class="feed-detail-options">${options.map((option, index) => {
            const name = option.name || option.contact_name || "Someone";
            const explicit = options.findIndex(candidate => candidate.is_selected === true);
            const selected = index === (explicit >= 0 ? explicit : options.findIndex(candidate => (candidate.name || candidate.contact_name) === selectedName));
            return `<div class="feed-detail-option ${selected ? "selected" : ""}"><strong>${escapeHTML(name)}</strong>${selected ? `<span class="feed-detail-selection-indicator" aria-label="Picked">👆</span>` : ""}</div>`;
        }).join("")}</div>` : `<div class="feed-detail-legacy-selection"><strong>Selected: ${escapeHTML(selectedName)}</strong><small>Options not available for this older vote</small></div>`}
    </article>`;
    $("#feedDetailEngagement").innerHTML = `<div class="detail-engagement-row">${feedView?.reactionControlMarkup(item, "poll", item.question_answer_id) || ""}${commentDetailButtonMarkup(item, "poll", item.question_answer_id, "feed-detail-comment-button")}${detailSendButton("poll", item.question_answer_id)}</div>`;
    renderFeedDetailShareRow();
    $("#blockFeedSubmitterButton").classList.toggle("hidden", !item.question_submitted_by_user_id || item.question_is_anonymous === true);
    // QuestionDetailRevealSenderButton: "Sent by …" takes the button's place once revealed.
    const revealButton = $("#revealFeedSenderButton");
    const personalVote = item.item_type === "received_vote";
    const canRevealThisVote = personalVote && !item.voter_name;
    revealButton.classList.toggle("hidden", !canRevealThisVote);
    const revealedSender = $("#feedDetailRevealedSender");
    revealedSender.classList.toggle("hidden", !(personalVote && item.voter_name));
    revealedSender.innerHTML = personalVote && item.voter_name ? `${avatarMarkup({ first_name: item.voter_name, profile_picture_url: item.voter_profile_picture_url }, "row-avatar")}<strong>Sent by ${escapeHTML(item.voter_name)}</strong>` : "";
    if (canRevealThisVote) {
        const remaining = Math.max(0, Number(state.profile?.remaining_reveals || 0));
        const auraCost = Math.max(0, Number(state.config?.full_reveal_aura_cost ?? DEFAULT_FULL_REVEAL_AURA_COST));
        const subscribed = api.user?.subscribed_user === true;
        const action = item.is_nomination ? "who nominated you" : "who sent this";
        const label = subscribed
            ? (remaining > 0 ? `Reveal ${action} (${remaining} remaining)` : `Reveal ${action} (${auraCost} aura)`)
            : `Get God Mode to Reveal ${action}`;
        revealButton.innerHTML = `<span>${escapeHTML(label)}</span>`;
        revealButton.disabled = subscribed && remaining === 0 && Number(state.profile?.aura_points || 0) < auraCost;
    }
    $("#feedDetailStatus").textContent = "";
}

// QuestionDetailShareRow: a wide "Share on Snapchat" with Instagram (and
// TikTok when enabled) beside it; without Snapchat both expand with labels.
function renderFeedDetailShareRow() {
    const showsSnapchat = state.config?.enable_share_on_snapchat !== false;
    const showsTikTok = state.config?.enable_share_on_tiktok === true;
    const labels = { snapchat: "Snapchat", instagram: "Instagram", tiktok: "TikTok" };
    $$("#feedDetailDialog [data-share-feed-platform]").forEach((button) => {
        const platform = button.dataset.shareFeedPlatform;
        const visible = platform === "snapchat" ? showsSnapchat : platform === "tiktok" ? showsTikTok : true;
        const expanded = platform === "snapchat" || !showsSnapchat;
        button.classList.toggle("hidden", !visible);
        if (button.classList.contains("expanded") === expanded && button.childElementCount) return;
        button.classList.toggle("expanded", expanded);
        button.innerHTML = `${shareIconMarkup(platform)}${expanded ? `<span>Share on ${labels[platform]}</span>` : ""}`;
    });
}

async function openFeedDetail(answerId) {
    await prepareFeedView();
    state.selectedFeedItemId = answerId;
    renderFeedDetail();
    openDetailScreen($("#feedDetailDialog"));
}

function canvasBlob(canvas, type = "image/png", quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not render image.")), type, quality);
    });
}

let shareCardsPromise = null;

function shareCards() {
    shareCardsPromise ||= import("./share-cards.js").then((module) => {
        module.configureShareCards({ api, state, displayName, formatVoterDemographicsStatement });
        return module;
    });
    return shareCardsPromise;
}

// PollShareBranding.contentURL on iOS.
const POLL_SHARE_URL = "https://validapp.lol";
const POLL_SHARE_COPIES_LINK = new Set(["instagram", "tiktok"]);

async function copyShareLink(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (_) {
        const field = document.createElement("textarea");
        field.value = text;
        field.setAttribute("readonly", "");
        setRuntimeStyles(field, { position: "fixed", opacity: "0" });
        document.body.append(field);
        try {
            field.select();
            field.setSelectionRange(0, field.value.length);
            return document.execCommand("copy");
        } catch (_) {
            return false;
        } finally {
            field.remove();
        }
    }
}

function downloadShareFile(file) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function shareFeedItem(platform = "other") {
    const item = selectedFeedItem();
    if (!item) return;
    const button = $(`[data-share-feed-platform="${platform}"]`);
    const platformLabel = platform === "other" ? "your app" : `${platform[0].toUpperCase()}${platform.slice(1)}`;
    if (button) {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
    }
    // iOS copies the validapp.lol link before handing the photo to Instagram
    // (link sticker) or TikTok (caption), since the share can't carry it.
    // Copy inside the tap, before any await can spend the user activation.
    const linkCopy = POLL_SHARE_COPIES_LINK.has(platform) ? copyShareLink(POLL_SHARE_URL) : null;
    $("#feedDetailStatus").textContent = `Creating poll photo for ${platformLabel}…`;
    try {
        const file = await (await shareCards()).createPollShareFile(item);
        if (navigator.share && navigator.canShare?.({ files: [file] })) {
            const copied = await linkCopy;
            if (copied) showToast("Link copied");
            $("#feedDetailStatus").textContent = copied
                ? `Link copied. Choose ${platformLabel} in the share sheet, then paste it.`
                : `Choose ${platformLabel} in the share sheet.`;
            await navigator.share({
                files: [file],
                title: `Share to ${platformLabel}`,
                text: `A poll on Valid · ${POLL_SHARE_URL}`,
            });
            $("#feedDetailStatus").textContent = "";
            showToast(copied ? "Poll photo shared • Link copied" : "Poll photo shared");
        } else {
            // No Web Share (most desktops): save the photo and keep the link on the clipboard.
            const copied = await (linkCopy || copyShareLink(POLL_SHARE_URL));
            downloadShareFile(file);
            showToast(copied ? "Image saved • Link copied" : "Image saved");
            $("#feedDetailStatus").textContent = copied
                ? `Poll photo saved and link copied. Open ${platformLabel} to post it.`
                : `Poll photo saved. Open ${platformLabel} to post it.`;
        }
    } catch (error) {
        if (error.name === "AbortError") $("#feedDetailStatus").textContent = "";
        else $("#feedDetailStatus").textContent = "Could not create the poll photo. Please try again.";
    } finally {
        if (button) {
            button.disabled = false;
            button.removeAttribute("aria-busy");
        }
    }
}

function freeRevealConfirmationMessage(remaining) {
    const left = Math.max(0, Number(remaining || 0) - 1);
    return `This uses 1 of your weekly reveals. You will have ${left} ${left === 1 ? "reveal" : "reveals"} left.`;
}

async function revealFeedSender() {
    const item = selectedFeedItem();
    if (!item || item.voter_name) return;
    if (api.user?.subscribed_user !== true) {
        openGodModePitch();
        return;
    }
    const button = $("#revealFeedSenderButton");
    const remaining = Math.max(0, Number(state.profile?.remaining_reveals || 0));
    const auraCost = Math.max(0, Number(state.config?.full_reveal_aura_cost ?? DEFAULT_FULL_REVEAL_AURA_COST));
    if (remaining === 0) {
        if (Number(state.profile?.aura_points || 0) < auraCost) {
            $("#feedDetailStatus").textContent = `You need ${auraCost.toLocaleString()} aura for another reveal.`;
            return;
        }
        openAuraSpend("reveal", item);
        return;
    }
    // QuestionDetailRevealConfirmations: a free reveal is spent only after "Use 1 Reveal".
    if (!await confirmSheet({
        title: "Reveal who sent this?",
        message: freeRevealConfirmationMessage(remaining),
        confirmLabel: "Use 1 Reveal",
    })) return;
    if (selectedFeedItem() !== item || item.voter_name) return;
    setButtonLoading(button, true, "Revealing...");
    $("#feedDetailStatus").textContent = "";
    try {
        const result = await api.revealSender(api.user.id, item.question_answer_id);
        applyFeedSenderReveal(item, result);
        showToast(`Revealed: ${result.full_name}`);
    } catch (error) {
        $("#feedDetailStatus").textContent = userMessage(error, "Could not reveal this sender.");
        setButtonLoading(button, false);
    }
}

function applyFeedSenderReveal(item, result) {
    item.voter_name = result.full_name;
    item.voter_profile_picture_url = result.profile_picture_url;
    if (state.profile) {
        state.profile.remaining_reveals = Number(result.remaining_reveals || 0);
        state.profile.aura_points = Number(result.total_aura_points ?? state.profile.aura_points ?? 0);
    }
    renderProfileHeader();
    renderProfilePanel();
    renderFeed();
    renderFeedDetail();
}

async function moderateFeedItem(action) {
    const item = selectedFeedItem();
    if (!item) return;
    // QuestionDetailModerationConfirmations.
    const sheets = {
        block: { title: "Block User", message: "You will no longer see questions submitted by this user.", confirmLabel: "Block", destructive: true },
        dismiss: { title: "Delete This Question?", message: "This question and its votes will be deleted from your Inbox and School Feed. It won't be reported or affect anyone else.", confirmLabel: "Delete" },
        report: { title: "Report a Safety Issue", message: "Report only if this shared question is unsafe or breaks the rules. Reporting hides the question across your feeds and sends it for review.", confirmLabel: "Report for Review", destructive: true, reasonPlaceholder: "Explain why you're reporting this question..." },
    };
    const sheet = sheets[action];
    if (!sheet) return;
    let reason = null;
    if (action === "report") {
        const answer = await confirmReasonSheet(sheet);
        if (!answer) return;
        reason = answer.reason;
    } else if (!await confirmSheet(sheet)) return;
    try {
        if (action === "block") await api.blockQuestionSubmitter(api.user.id, item.question_id);
        else if (action === "dismiss") await api.dismissFeedQuestion(api.user.id, item.question_id);
        else if (reason) await api.reportQuestion(api.user.id, item.question_id, reason);
        else await api.reportQuestion(api.user.id, item.question_id);
        state.feedItems = state.feedItems.filter((candidate) => candidate.question_id !== item.question_id);
        state.selectedFeedItemId = null;
        closeDetailScreen($("#feedDetailDialog"));
        renderFeed();
        const successMessages = {
            block: "Submitter blocked",
            dismiss: "Question deleted",
            report: "Question reported",
        };
        showToast(successMessages[action]);
    } catch (error) {
        const fallbackMessages = {
            block: "Could not block this submitter.",
            dismiss: "Could not delete this question.",
            report: "Could not report this question.",
        };
        $("#feedDetailStatus").textContent = userMessage(error, fallbackMessages[action]);
    }
}

function isFeedVoteLocked() {
    const progress = state.classmatesStatus;
    return Boolean(progress?.lock_reasons?.includes("votes") && Number(progress.votes_cast || 0) < Number(progress.required_votes || 0));
}

// FeedVoteLockedView.swift: the unread count (not lifetime votes) picks the
// title, and the vote-alerts card offers notifications only here.
function renderFeedGate() {
    const locked = isFeedVoteLocked();
    $("#feedGateLock").classList.toggle("hidden", !locked);
    $("#feedUnlockedContent").classList.toggle("hidden", locked);
    if (!locked) {
        renderFeedNotificationPrompt();
        return;
    }
    const cast = Math.max(0, Number(state.classmatesStatus?.votes_cast || 0));
    const required = Math.max(0, Number(state.classmatesStatus?.required_votes || 0));
    const unread = personalInboxUnreadCounts().polls;
    const hasUnread = unread > 0;
    const votesText = required > 0 ? `${Math.min(cast, required)} / ${required} votes cast` : "";
    $("#feedGateLock").innerHTML = `<div class="feed-gate-screen">
        <article class="feed-gate-card">
            <span class="feed-gate-lock-symbol" aria-hidden="true">${uiIcon("lock-filled")}</span>
            ${hasUnread ? `<strong class="feed-gate-new-votes">${unread === 1 ? "1 NEW VOTE" : `${unread} NEW VOTES`}</strong>` : ""}
            <div class="feed-gate-copy">
                <h3>${hasUnread ? "You got voted for" : "Feed is locked"}</h3>
                <p>${hasUnread ? "See what people are saying." : "Answer a few polls to see what everyone is saying."}</p>
            </div>
            ${votesText ? `<span class="feed-gate-votes-cast"><i aria-hidden="true"></i>${votesText}</span>` : ""}
            <button class="primary-button feed-gate-vote-button" type="button" data-vote-to-unlock>Vote now to unlock Feed</button>
        </article>
        <button class="feed-gate-notification feed-lock-alerts" type="button" data-enable-feed-notifications aria-label="Turn on alerts for votes">
            <span class="feed-lock-alerts-icon" aria-hidden="true">${uiIcon("bell-badge")}</span>
            <span class="feed-lock-alerts-copy"><strong>Turn on vote alerts</strong><span>Know right away when someone picks you.</span></span>
            <span class="feed-lock-alerts-chevron" aria-hidden="true">${uiIcon("next")}</span>
        </button>
    </div>`;
    renderFeedNotificationPrompt();
    void refreshLockedUnreadVoteCount();
}

// FeedViewModel.refreshLockedUnreadVoteCount: the lock and the tab badge read
// the unread count, so load the first Inbox page without showing its rows.
let lockedUnreadRefresh = null;
let lockedUnreadRefreshedAt = 0;
async function refreshLockedUnreadVoteCount() {
    if (lockedUnreadRefresh || !api.user?.id || Date.now() - lockedUnreadRefreshedAt < 60_000) return;
    lockedUnreadRefreshedAt = Date.now();
    const userId = api.user.id;
    lockedUnreadRefresh = (async () => {
        try {
            const items = await api.getPersonalFeed(userId, 0, "");
            if (api.user?.id !== userId) return;
            state.personalFeedItems = Array.isArray(items) ? items.slice() : [];
            state.personalFeedHasMore = state.personalFeedItems.length >= PERSONAL_FEED_PAGE_SIZE;
            state.personalFeedLoaded = true;
            renderTabBadges();
            if (isFeedVoteLocked()) renderFeedGate();
        } catch (_) { /* The lock keeps its last count. */ }
    })();
    try { await lockedUnreadRefresh; } finally { lockedUnreadRefresh = null; }
}

function renderFeedNotificationPrompt() {
    const supported = webPushSupported();
    const enabled = supported && state.webPushSubscription && state.webPushRegistrationState === "on";
    const syncing = supported && state.webPushRegistrationState === "syncing";
    const failed = supported && state.webPushRegistrationState === "error";
    const blocked = supported && Notification.permission === "denied";
    const label = blocked
        ? "Fix notification settings"
        : failed
        ? "Retry notifications"
        : syncing
        ? "Finishing setup…"
        : "Enable notifications";
    // iPhone Safari has no Web Push outside the installed app: offer the
    // Home Screen steps instead (hidden for a week after they were shown).
    const iosInstall = !supported && iosInstallAvailable() && !iosInstallRecentlyShown();
    const prompts = [$("#feedNotificationPrompt"), ...$$(".feed-gate-notification")].filter(Boolean);
    prompts.forEach((prompt) => {
        prompt.classList.toggle("hidden", !iosInstall && (!supported || Boolean(enabled) || blocked));
        const detail = prompt.querySelector("small");
        if (detail) detail.textContent = iosInstall ? "Add Valid to your Home Screen to know when someone picks you." : "Enable notifications to know when someone picks you.";
        const button = prompt.querySelector("button");
        if (!button) return;
        button.textContent = iosInstall ? "Add to Home Screen" : label;
        button.disabled = !iosInstall && (state.webPushBusy || syncing);
    });
}

const IOS_INSTALL_SHOWN_KEY = "valid:ios-install-shown-at";

function iosInstallAvailable() {
    return isAppleTouchDevice() && !isStandaloneApp();
}

function iosInstallRecentlyShown() {
    try { return Date.now() - Number(localStorage.getItem(IOS_INSTALL_SHOWN_KEY) || 0) < 7 * 86_400_000; }
    catch (_) { return false; }
}

async function openIOSInstall() {
    try {
        const { openIOSInstallSheet } = await import("./ios-install.js");
        openIOSInstallSheet({ onClose: () => {
            try { localStorage.setItem(IOS_INSTALL_SHOWN_KEY, String(Date.now())); } catch (_) { /* Shown again next time. */ }
            renderFeedNotificationPrompt();
        } });
    } catch (error) {
        showToast(userMessage(error, "In Safari, tap Share, then Add to Home Screen."));
    }
}

function renderIOSInstallRow() {
    if (!iosInstallAvailable()) return;
    const row = $("#installAppButton");
    row.querySelector("strong").textContent = "Add to Home Screen";
    row.querySelector("small").textContent = "Get notifications and open Valid like an app";
    row.classList.remove("hidden");
    renderProfileActionsVisibility();
}

async function refreshFeedGateStatus() {
    try {
        state.classmatesStatus = await api.getClassmatesStatus(api.user.id);
        renderFeedGate();
    } catch (_) { /* Keep the last authoritative gate state. */ }
}

function renderAnonymousInbox() {
    renderFeed();
}

function openAnonymousAnswerDialog(answerId) {
    const answer = state.anonymousInbox?.answers?.find((item) => String(item.id) === String(answerId));
    if (!answer) return;
    const avatarURL = api.assetURL(answer.recipient_profile_picture_url);
    $("#anonymousAnswerRecipient").innerHTML = `${avatarMarkup({
        first_name: answer.recipient_display_name,
        username: answer.recipient_username,
        profile_picture_url: avatarURL,
    }, "anonymous-answer-avatar")}<span><strong>${escapeHTML(answer.recipient_display_name)} replied to you</strong><small>@${escapeHTML(answer.recipient_username)}</small></span>`;
    $("#anonymousOriginalMessage").textContent = answer.question_body;
    $("#anonymousReceivedReply").textContent = answer.answer_text;
    $("#anonymousAnswerReceivedAt").textContent = relativeTime(answer.answered_at);
    openDetailScreen($("#anonymousAnswerDetailDialog"));
}

async function loadAnonymousInbox() {
    const generation = ++state.anonymousInboxGeneration;
    try {
        state.anonymousInbox = await api.getAnonymousInbox(api.user.id, 30, 0);
        if (generation !== state.anonymousInboxGeneration || state.feedType !== "personal") return;
        renderAnonymousInbox();
    } catch (error) {
        if (generation !== state.anonymousInboxGeneration || state.feedType !== "personal") return;
        if (error.status === 404) {
            state.anonymousInbox = null;
            renderFeed();
        } else {
            $("#feedStatus").textContent = userMessage(error, "Could not load anonymous messages.");
        }
    }
}

async function loadTbhContent() {
    if (!tbhRequestsEnabled() || !api.user?.id) {
        state.tbhPendingRequests = [];
        state.tbhInboxItems = [];
        state.tbhSentItems = [];
        state.schoolTbhItems = [];
        renderFeed();
        return;
    }
    const generation = ++state.tbhGeneration;
    const results = await Promise.allSettled([
        api.getPendingTbhRequests(api.user.id),
        api.getTbhInbox(api.user.id),
        api.getSentTbhs(api.user.id),
        api.getTbhSchoolFeed(api.user.id, state.schoolFeedSort),
    ]);
    if (generation !== state.tbhGeneration) return;
    const [pending, inbox, sent, school] = results;
    if (school.status === "fulfilled") state.schoolTbhItems = school.value.items || [];
    const publicById = new Map(state.schoolTbhItems.map((item) => [String(item.id), item]));
    const mergePublicReaction = (item) => {
        const publicItem = publicById.get(String(item.id));
        if (!publicItem || item.activity_id) return item;
        return { ...item,
            activity_id: publicItem.activity_id,
            reaction_count: publicItem.reaction_count,
            reaction_summary: publicItem.reaction_summary,
            current_user_reaction: publicItem.current_user_reaction,
            can_react: publicItem.can_react,
        };
    };
    if (pending.status === "fulfilled") {
        const now = Date.now();
        state.tbhPendingRequests = (pending.value.items || []).filter((item) => !item.snoozed_until || Date.parse(item.snoozed_until) <= now);
    }
    if (inbox.status === "fulfilled") state.tbhInboxItems = (inbox.value.items || []).map(mergePublicReaction);
    if (sent.status === "fulfilled") state.tbhSentItems = (sent.value.items || []).map(mergePublicReaction);
    renderFeed();
}

function selectedAnonymousQuestion() {
    return state.anonymousInbox?.questions?.find((question) => String(question.id) === String(state.selectedAnonymousQuestionId));
}

function renderAnonymousQuestionDialog() {
    const question = selectedAnonymousQuestion();
    if (!question) return;
    $("#anonymousQuestionBody").innerHTML = `<blockquote>${escapeHTML(question.body)}</blockquote><div>${uiIcon(question.sender_type === "valid_member" ? "shield-check" : question.sender_type === "snap_viewer" ? "camera-filled" : "person-question")}<strong>${escapeHTML(question.provenance_label)}</strong></div>`;
    const answered = question.status === "answered";
    const restricted = Boolean(state.askAccess && state.askAccess.status !== "allowed");
    $("#anonymousReportButton").textContent = question.sender_type === "valid_member"
        ? "Report and block sender"
        : "Report and remove";
    $("#anonymousAnswerRestriction").classList.toggle("hidden", !restricted);
    $("#anonymousAnswerRestriction").textContent = restricted
        ? (state.askAccess.message || "Your Ask Me access is currently unavailable.")
        : "";
    $("#anonymousAnswerText").value = question.answer_text || "";
    $("#anonymousAnswerText").readOnly = false;
    $("#anonymousAnswerText").classList.toggle("hidden", restricted);
    $("#anonymousAnswerLabel").textContent = "Your reply";
    $("#anonymousAnswerLabel").classList.toggle("hidden", restricted);
    $("#anonymousAnswerButton").classList.toggle("hidden", restricted);
    $("#anonymousAnswerButton").dataset.label = answered ? "Update reply" : "Send reply";
    $("#anonymousAnswerButton").textContent = $("#anonymousAnswerButton").dataset.label;
    updateAnonymousAnswerButton();
    $("#anonymousAnswerShare").classList.toggle("hidden", !answered);
    $("#anonymousAnswerStatus").textContent = "";
    $("#anonymousAnswerStatus").classList.remove("share-progress");
}

function updateAnonymousAnswerButton() {
    const button = $("#anonymousAnswerButton");
    if (!button || button.getAttribute("aria-busy") === "true") return;
    button.disabled = !$("#anonymousAnswerText").value.trim();
}

async function shareAnonymousAnswer(platform) {
    const question = selectedAnonymousQuestion();
    if (!question?.answer_text) return;
    const button = $(`[data-share-anonymous="${platform}"]`);
    const platformLabels = { snapchat: "Snapchat", instagram: "Instagram", tiktok: "TikTok" };
    const platformLabel = platformLabels[platform] || "your app";
    if (button) {
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
    }
    const status = $("#anonymousAnswerStatus");
    status.classList.add("share-progress");
    status.textContent = `Creating your reply image for ${platformLabel}…`;
    try {
        const file = await (await shareCards()).createAnonymousAnswerShareFile(question);
        if (navigator.share && navigator.canShare?.({ files: [file] })) {
            status.textContent = `Choose ${platformLabel} in the share sheet.`;
            await navigator.share({
                files: [file],
                title: `Share your Valid reply to ${platformLabel}`,
            });
            status.textContent = "";
            status.classList.remove("share-progress");
        } else {
            downloadShareFile(file);
            status.textContent = `Reply image saved. Opening ${platformLabel}…`;
            const platformURLs = {
                snapchat: "snapchat://",
                instagram: "instagram://story-camera",
                tiktok: "snssdk1233://",
            };
            if (platformURLs[platform]) setTimeout(() => { window.location.href = platformURLs[platform]; }, 220);
        }
        api.trackAskShare(api.user.id, platform).catch(() => null);
    } catch (error) {
        status.classList.remove("share-progress");
        status.textContent = error.name === "AbortError"
            ? ""
            : "Could not create the reply image. Please try again.";
    } finally {
        if (button) {
            button.disabled = false;
            button.removeAttribute("aria-busy");
        }
    }
}

async function openAnonymousQuestionDialog(questionId) {
    state.selectedAnonymousQuestionId = questionId;
    renderAnonymousQuestionDialog();
    openDetailScreen($("#anonymousQuestionDialog"));
    const question = selectedAnonymousQuestion();
    if (!question || question.opened_at) return;
    try {
        const updated = await api.openAnonymousQuestion(api.user.id, question.id);
        Object.assign(question, updated);
        renderAnonymousInbox();
        renderAnonymousQuestionDialog();
    } catch (error) {
        $("#anonymousAnswerStatus").textContent = userMessage(error, "Could not open this question.");
    }
}

async function answerAnonymousQuestion(event) {
    event.preventDefault();
    const question = selectedAnonymousQuestion();
    if (!question) return;
    const answerText = $("#anonymousAnswerText").value.trim().split(/\s+/).join(" ");
    if (!answerText) return;
    const button = $("#anonymousAnswerButton");
    setButtonLoading(button, true, "Sending reply…");
    $("#anonymousAnswerStatus").textContent = "";
    try {
        const updated = await api.answerAnonymousQuestion(api.user.id, question.id, answerText);
        Object.assign(question, updated);
        if (state.profile && updated.aura_points_earned) {
            state.profile.aura_points = Number(state.profile.aura_points || 0) + Number(updated.aura_points_earned);
            protectOptimisticEarnedProfile(
                state.profile.aura_points,
                state.profile.current_streak,
                state.profile.streak_multiplier
            );
            renderProfileHeader();
            animateAuraChange(Number(updated.aura_points_earned), button);
        }
        renderAnonymousInbox();
        renderAnonymousQuestionDialog();
        const confirmationButton = $("#anonymousAnswerButton");
        confirmationButton.textContent = "✓ Reply sent";
        clearTimeout(answerAnonymousQuestion.confirmationTimer);
        answerAnonymousQuestion.confirmationTimer = setTimeout(() => {
            if (String(state.selectedAnonymousQuestionId) !== String(question.id)) return;
            confirmationButton.textContent = "Update reply";
        }, 1200);
        refreshProfile();
    } catch (error) {
        $("#anonymousAnswerStatus").textContent = userMessage(error, "Could not answer this question.");
    } finally {
        updateAnonymousAnswerButton();
    }
}

async function handleAnonymousSafetyAction(action) {
    const question = selectedAnonymousQuestion();
    if (!question || !["report", "delete"].includes(action)) return;
    if (action === "report") {
        openAnonymousReportDialog(question);
        return;
    }
    if (!await confirmSheet({ title: "Delete this question?", message: "This cannot be undone.", confirmLabel: "Delete", destructive: true })) return;
    try {
        await api.deleteAnonymousQuestion(api.user.id, question.id);
        state.anonymousInbox.questions = state.anonymousInbox.questions.filter((item) => String(item.id) !== String(question.id));
        state.selectedAnonymousQuestionId = null;
        closeDetailScreen($("#anonymousQuestionDialog"));
        renderAnonymousInbox();
        showToast("Question deleted");
    } catch (error) {
        $("#anonymousAnswerStatus").textContent = userMessage(error, `Could not ${action} this question.`);
    }
}

function openAnonymousReportDialog(question) {
    state.pendingAnonymousReportQuestionId = question.id;
    $("#anonymousReportForm").reset();
    $("#anonymousReportStatus").textContent = "";
    const memberSender = question.sender_type === "valid_member";
    $("#anonymousReportTitle").textContent = memberSender
        ? "Report and block sender"
        : "Report and remove";
    $("#anonymousReportExplanation").textContent = memberSender
        ? "Valid will record and remove this question and block this account from sending you future Ask Me questions."
        : "Valid will record and remove this question. Because it came from an anonymous guest link, no person, browser, or device will be blocked.";
    $("#confirmAnonymousReport").textContent = memberSender
        ? "Report and block sender"
        : "Report and remove";
    $("#confirmAnonymousReport").dataset.label = $("#confirmAnonymousReport").textContent;
    $("#anonymousReportDialog").showModal();
}

async function submitAnonymousReport(event) {
    event.preventDefault();
    const question = state.anonymousInbox?.questions?.find(
        (item) => String(item.id) === String(state.pendingAnonymousReportQuestionId)
    );
    const reason = new FormData(event.currentTarget).get("anonymousReportReason");
    if (!question || !reason) return;
    const button = $("#confirmAnonymousReport");
    setButtonLoading(button, true, "Reporting…");
    $("#anonymousReportStatus").textContent = "";
    try {
        await api.reportAnonymousQuestion(api.user.id, question.id, String(reason));
        state.anonymousInbox.questions = state.anonymousInbox.questions.filter(
            (item) => String(item.id) !== String(question.id)
        );
        state.pendingAnonymousReportQuestionId = null;
        state.selectedAnonymousQuestionId = null;
        $("#anonymousReportDialog").close();
        closeDetailScreen($("#anonymousQuestionDialog"));
        renderAnonymousInbox();
        showToast(question.sender_type === "valid_member"
            ? "Reported and sender blocked"
            : "Reported and removed");
    } catch (error) {
        $("#anonymousReportStatus").textContent = userMessage(error, "Could not report this question.");
    } finally {
        setButtonLoading(button, false);
    }
}

async function loadFeed(reset = false) {
    if (isFeedVoteLocked()) {
        renderFeedGate();
        return;
    }
    const generation = reset ? ++state.feedGeneration : state.feedGeneration;
    const feedType = state.feedType;
    const myVotesOnly = state.myVotesOnly;
    const schoolSort = state.schoolFeedSort;
    const schoolContent = state.schoolFeedContent;
    const rawSearch = state.feedSearch.trim();
    const search = rawSearch.length >= 2 ? rawSearch : "";
    const hadVisibleFeed = state.feedItems.length > 0;
    if (reset) {
        state.feedOffset = 0;
        void refreshWeeklyGame();
        state.feedCursor = null;
        if (!hadVisibleFeed) renderFeedSkeleton();
        loadTbhContent();
        if (feedType === "personal") loadAnonymousInbox();
        else {
            state.anonymousInboxGeneration += 1;
            renderAnonymousInbox();
        }
    }
    const status = $("#feedStatus");
    const loadMore = $("#loadMoreFeed");
    if (reset) {
        status.textContent = hadVisibleFeed ? "Refreshing…" : "Loading votes...";
        loadMore.classList.add("hidden");
    }
    loadMore.classList.toggle("loading", !reset);
    try {
        let items;
        if (feedType === "personal") items = await api.getPersonalFeed(api.user.id, state.feedOffset, search);
        else if (myVotesOnly) items = await api.getUserVotes(api.user.id, state.feedCursor);
        else items = await api.getSchoolFeed(api.user.id, schoolSort === "hottest" ? null : state.feedCursor, search, schoolSort, schoolSort === "hottest" ? 100 : 20);
        const currentRawSearch = state.feedSearch.trim();
        const currentSearch = currentRawSearch.length >= 2 ? currentRawSearch : "";
        if (generation !== state.feedGeneration || feedType !== state.feedType || myVotesOnly !== state.myVotesOnly || schoolSort !== state.schoolFeedSort || schoolContent !== state.schoolFeedContent || search !== currentSearch) return;
        commitFeedItems(items, { reset });
        if (reset) state.feedLoadedAt = Date.now();
        if (feedType === "personal") state.feedOffset += items.length;
        else if (items.length) {
            const last = items.at(-1);
            state.feedCursor = { timestamp: last.timestamp, id: last.question_answer_id };
        }
        status.textContent = "";
        state.feedAppliedSearch = search;
        if (feedType === "personal" && !search) {
            state.personalFeedItems = state.feedItems.slice();
            state.personalFeedHasMore = items.length >= PERSONAL_FEED_PAGE_SIZE;
            state.personalFeedLoaded = true;
            writeAppCache("feed-personal", state.feedItems.slice(0, 60));
        }
        renderFeed();
        loadMore.classList.remove("loading");
        loadMore.classList.toggle("hidden", schoolSort === "hottest" || schoolContent === "tbhs" || items.length < 20);
        // Still in reach after this page (a short list or a tall screen): ask for the next one.
        requestAnimationFrame(maybeLoadMoreFeed);
    } catch (error) {
        if (generation !== state.feedGeneration) return;
        loadMore.classList.remove("loading");
        status.textContent = userMessage(error, "Could not load the feed.");
    }
}

function maybeLoadMoreFeed() {
    const sentinel = $("#loadMoreFeed");
    if (!sentinel || sentinel.classList.contains("hidden") || sentinel.classList.contains("loading")) return;
    if (state.activePanel !== "feed" || isFeedVoteLocked() || $("#feedStatus").textContent) return;
    if (sentinel.getBoundingClientRect().top > window.innerHeight + 600) return;
    void loadFeed(false);
}

// TbhGiveInboxCard → TbhGiveInboxSheet.
function openGiveTbhSheet() {
    $("#giveTbhList").innerHTML = state.tbhPendingRequests.map((request) => `<button class="give-tbh-row" type="button" data-give-tbh-request="${escapeHTML(request.id)}">${avatarMarkup({ first_name: request.requester_first_name, last_name: request.requester_last_name, profile_picture_url: request.requester_profile_picture_url }, "row-avatar")}<span><strong>TBH for ${escapeHTML(request.requester_first_name)}</strong><small>${escapeHTML(promptForKey(request.prompt_key).title)}</small></span><span class="give-tbh-write">Write</span></button>`).join("");
    $("#giveTbhDialog").showModal();
}

// FeedItemRow.openSchoolProfile: a classmate's avatar or name opens their profile.
async function openFeedRowProfile(userId) {
    const known = () => [...(state.classmateDirectory || []), ...(state.classmates || [])].some((classmate) => String(classmate.user_id) === String(userId));
    if (!known() && !state.classmateDirectory) {
        try { state.classmateDirectory = await api.getClassmates(api.user.id, "", 500); } catch (_) { /* Answered below. */ }
    }
    if (!known()) return showToast("This person doesn’t have an available profile yet.");
    await openClassmateProfile(userId);
}

// Kinds: selection | light | medium | heavy | success | warning | error (preferences.js).
function haptic(kind = "light") {
    return window.ValidPreferences?.haptic(kind) ?? false;
}

function softHaptic(kind = "light") {
    return haptic(typeof kind === "string" ? kind : "light");
}

function successHaptic() {
    return haptic("success");
}

function expectedAuraPerAnswer() {
    const baseAura = Math.max(0, Number(state.profile?.aura_points_per_answer ?? state.config?.aura_points_per_answer ?? 5));
    const godModeMultiplier = api.user?.subscribed_user === true
        ? Math.max(1, Number(state.profile?.god_mode_aura_multiplier || 2))
        : 1;
    const streakMultiplier = Number(state.profile?.current_streak || 0) > 0
        ? Math.max(1, Number(state.profile?.streak_multiplier || 1))
        : 1;
    return Math.floor(baseAura * godModeMultiplier * streakMultiplier);
}

function protectOptimisticEarnedProfile(auraPoints, currentStreak, streakMultiplier) {
    state.optimisticEarnedProfile = {
        auraPoints: Math.max(0, Number(auraPoints || 0)),
        currentStreak: Math.max(0, Number(currentStreak || 0)),
        streakMultiplier: Math.max(1, Number(streakMultiplier || 1)),
        expiresAt: Date.now() + 120_000,
    };
}

function clearOptimisticEarnedProfile() {
    state.optimisticEarnedProfile = null;
}

function mergeOptimisticEarnedProfile(profile) {
    const optimistic = state.optimisticEarnedProfile;
    if (!optimistic || Date.now() >= optimistic.expiresAt) {
        clearOptimisticEarnedProfile();
        return profile;
    }
    const serverAura = Math.max(0, Number(profile?.aura_points || 0));
    const serverStreak = Math.max(0, Number(profile?.current_streak || 0));
    const auraCaughtUp = serverAura >= optimistic.auraPoints;
    const streakCaughtUp = serverStreak >= optimistic.currentStreak;
    if (!auraCaughtUp) profile.aura_points = optimistic.auraPoints;
    if (!streakCaughtUp) {
        profile.current_streak = optimistic.currentStreak;
        profile.streak_multiplier = optimistic.streakMultiplier;
    }
    if (auraCaughtUp && streakCaughtUp) clearOptimisticEarnedProfile();
    return profile;
}

function animateAuraChange(amount, sourceElement = null) {
    const chip = $("#auraCount")?.closest(".play-aura-chip");
    if (!chip || !Number.isFinite(Number(amount)) || Number(amount) === 0) return;
    if (Number(amount) > 0 && sourceElement) {
        const source = sourceElement.getBoundingClientRect();
        const target = chip.getBoundingClientRect();
        const flight = document.createElement("span");
        flight.className = "aura-flight";
        flight.innerHTML = `<img loading="lazy" decoding="async" src="../assets/app/aura.webp" alt=""><strong>+${Number(amount).toLocaleString()}</strong>`;
        setRuntimeStyles(flight, {
            left: `${source.left + source.width / 2}px`,
            top: `${source.top + source.height / 2}px`,
            "--aura-flight-x": `${target.left + target.width / 2 - source.left - source.width / 2}px`,
            "--aura-flight-y": `${target.top + target.height / 2 - source.top - source.height / 2}px`,
        });
        document.body.append(flight);
        requestAnimationFrame(() => flight.classList.add("flying"));
        flight.addEventListener("animationend", () => flight.remove(), { once: true });
        setTimeout(() => chip.classList.add("aura-arrived"), 900);
        setTimeout(() => chip.classList.remove("aura-arrived"), 1400);
        return;
    }
    restartChipAnimation(chip, Number(amount) > 0 ? "aura-gain" : "aura-spend");
}

function prefersReducedMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

// Class-driven so the keyframes follow the theme and the reduced-motion rule.
function restartChipAnimation(chip, className) {
    if (!chip || prefersReducedMotion()) return;
    chip.classList.remove(className);
    void chip.offsetWidth;
    chip.classList.add(className);
    chip.addEventListener("animationend", () => chip.classList.remove(className), { once: true });
}

function showStreakCelebration(streak, multiplier) {
    const overlay = $("#streakCelebration");
    if (!overlay || Number(streak) < 1) return;
    const milestone = [7, 14, 30, 50, 100].includes(Number(streak));
    $("#streakCelebrationFire").innerHTML = uiIcon("fire").repeat(milestone ? 3 : 1);
    $("#streakCelebrationFire").classList.toggle("milestone", milestone);
    $("#streakCelebrationTitle").textContent = `${Number(streak).toLocaleString()} Day Streak!`;
    const multiplierLabel = $("#streakCelebrationMultiplier");
    multiplierLabel.textContent = Number(multiplier) > 1 ? `${Number(multiplier).toFixed(1)}x Aura Bonus!` : "";
    multiplierLabel.classList.toggle("hidden", Number(multiplier) <= 1);
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    clearTimeout(showStreakCelebration.timeout);
    showStreakCelebration.timeout = setTimeout(hideStreakCelebration, 2000);
}

function hideStreakCelebration() {
    const overlay = $("#streakCelebration");
    if (!overlay) return;
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
}

async function toggleUpvote(button) {
    const item = state.feedItems.find((candidate) => String(candidate.question_answer_id) === button.dataset.upvote);
    if (!item) return;
    button.disabled = true;
    try {
        const result = await api.toggleUpvote(api.user.id, item.question_answer_id);
        item.user_has_upvoted = Boolean(result.was_added);
        item.upvote_count = Math.max(0, Number(item.upvote_count || 0) + (result.was_added ? 1 : -1));
        renderFeed();
    } catch (error) {
        showToast(userMessage(error, "Could not update that vote."));
    }
}

// PlayViewModel.selectWeightedRandomChoices over the contacts + classmates pool.
function choicesForQuestion(question) {
    if (!state.choicesByQuestion.has(question.id)) {
        state.choicesByQuestion.set(question.id, selectPlayChoices(state.playPool, {
            viewer: state.profile,
            viewerUserId: api.user?.id,
            tuning: state.config,
            history: state.playChoiceHistory,
        }));
    }
    return state.choicesByQuestion.get(question.id);
}

function choiceMarkup(choice) {
    return `<button class="choice-button" type="button" data-choice="${escapeHTML(choice.id)}"><span>${escapeHTML(cleanDisplayName(choice.name) || choice.name)}</span></button>`;
}

// Contacts the server matched to accounts sort first in the classmate directory.
function rememberContactAccounts(contacts) {
    const ids = (contacts || []).filter((contact) => contact?.is_six7_user && contact.user_id).map((contact) => String(contact.user_id));
    if (!ids.length) return;
    for (const id of ids) state.contactClassmateIds.add(id);
    writeAppCache("contact-classmates", [...state.contactClassmateIds]);
}

function rebuildPlayPool() {
    state.playPool = buildChoicePool({
        contacts: state.playContacts,
        classmates: state.classmates,
        selfUserId: api.user?.id,
        blockedUserIds: state.playBlockedUserIds || [],
        filterRules: state.config?.contact_filter_rules,
    });
    return state.playPool;
}

// Uploaded contacts (GET /contacts, as iOS loads them), classmates and blocks.
// A user without a school still plays with contacts, like iOS.
async function loadPlayRoster() {
    const userId = api.user.id;
    const [contacts, classmates, blocked] = await Promise.all([
        api.getAllContacts(userId).catch(() => state.playContacts || []),
        api.getClassmates(userId).catch((error) => {
            if (error?.status === 400) return [];
            throw error;
        }),
        api.getBlockedUsers(userId).catch(() => null),
    ]);
    if (api.user?.id !== userId) return state.playPool;
    state.playContacts = Array.isArray(contacts) ? contacts : [];
    state.classmates = Array.isArray(classmates) ? classmates : [];
    if (Array.isArray(blocked)) state.playBlockedUserIds = blocked.map((profile) => String(profile.user_id));
    rememberContactAccounts(state.playContacts);
    return rebuildPlayPool();
}

// Play shows its streak / "Question X of Y" / aura row only while answering
// (PlayGameView.counterHeader); loading, congrats and lock screens have none.
function setPlayHeaderVisible(visible) {
    $("#playPanel").classList.toggle("play-header-hidden", !visible);
    if (!visible) $("#playProgress").textContent = "";
}

// PlayView.LoadingView: a 96 pt spinning gear, title and subtitle, centred.
function renderPlayLoading() {
    setPlayHeaderVisible(false);
    const card = $("#playCard");
    card.replaceChildren();
    delete card.dataset.questionId;
    $("#playStatus").innerHTML = `<span class="play-loading-state"><img class="play-loading-gear" src="../assets/app/setting-gear.webp" width="96" height="96" decoding="async" alt=""><strong>Loading polls...</strong><span>Spinning up your classmates’ questions.</span></span>`;
}

function renderNotEnoughFriends() {
    setPlayHeaderVisible(false);
    $("#playCard").innerHTML = `<div class="empty-card locked-card"><img loading="lazy" decoding="async" class="empty-state-art" src="../assets/app/lock.webp" alt=""><strong>Add more classmates to play Valid.</strong><span>You need at least four classmates or contacts.</span><button class="primary-button" type="button" data-find-classmates>Find classmates</button><button class="secondary-button" type="button" data-invite-unlock>Share an invite</button></div>`;
}

// String.cleanedForDisplay: names without emoji or doubled spaces.
function cleanDisplayName(value) {
    return String(value || "")
        .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}]/gu, "")
        .replace(/\s+/g, " ")
        .trim();
}

// PlayLockedView.firstName: "Maya" from "Maya Lopez", the whole name when it has no space.
function playContactFirstName(contact) {
    const cleaned = cleanDisplayName(contact?.name);
    return cleaned.split(" ")[0] || "your friend";
}

const playContactKey = (contact) => String(contact?.hashed_phone_number || contact?.phone_number || contact?.name || "");

// SuggestedInviteHistory: friends this account already invited, so the next
// lock names someone new. Per account, the most recent 50.
const playInvitedKey = (userId) => `valid:play:suggested-invites:${userId}`;

function readPlayInvited() {
    try { return new Set(JSON.parse(localStorage.getItem(playInvitedKey(api.user?.id)) || "[]")); }
    catch (_) { return new Set(); }
}

function recordPlayInvited(contact) {
    const key = playContactKey(contact);
    if (!api.user?.id || !key) return;
    try {
        const keys = [...readPlayInvited()].filter((item) => item !== key);
        keys.push(key);
        localStorage.setItem(playInvitedKey(api.user.id), JSON.stringify(keys.slice(-50)));
    } catch (_) { /* Without storage the same friend may be suggested again. */ }
}

// InviteFriendsViewModel.prepareContacts: uploaded contacts not on Valid,
// suggested friends first (most votes first), then mutuals, votes and name.
function invitablePlayContacts() {
    const suggestionsFirst = state.config?.enable_invite_suggestions !== false;
    const seen = new Set();
    return (state.playContacts || [])
        .filter((contact) => {
            const key = playContactKey(contact);
            if (contact?.is_six7_user || contact?.user_id || !cleanDisplayName(contact?.name) || !key || seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((first, second) => {
            const firstSuggested = first.invite_suggested === true;
            const secondSuggested = second.invite_suggested === true;
            const votes = (contact) => Math.max(0, Number(contact.vote_count || 0));
            if (suggestionsFirst && firstSuggested !== secondSuggested) return firstSuggested ? -1 : 1;
            if (suggestionsFirst && firstSuggested && votes(first) !== votes(second)) return votes(second) - votes(first);
            const mutuals = (contact) => Math.max(0, Number(contact.recommendation_strength || 0));
            if (mutuals(first) !== mutuals(second)) return mutuals(second) - mutuals(first);
            if (votes(first) !== votes(second)) return votes(second) - votes(first);
            return cleanDisplayName(first.name).localeCompare(cleanDisplayName(second.name), undefined, { sensitivity: "base" });
        });
}

// PlayLockedView.loadSuggestedFriend: the invite sheet's first suggested
// friend who hasn't been invited from here yet.
function suggestedPlayFriend() {
    if (state.config?.enable_invite_suggestions === false) return null;
    const invited = readPlayInvited();
    return invitablePlayContacts().find((contact) => contact.invite_suggested === true && !invited.has(playContactKey(contact))) || null;
}

function inviteResetDescription(status) {
    const reset = Date.parse(status?.next_reset_at || "");
    if (!Number.isFinite(reset)) return "";
    const time = new Date(reset).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const seconds = Math.round((reset - Date.now()) / 1000);
    const [value, unit] = Math.abs(seconds) >= 86_400 ? [Math.round(seconds / 86_400), "day"]
        : Math.abs(seconds) >= 3_600 ? [Math.round(seconds / 3_600), "hour"]
            : Math.abs(seconds) >= 60 ? [Math.round(seconds / 60), "minute"] : [seconds, "second"];
    let relative = "";
    try { relative = new Intl.RelativeTimeFormat(undefined, { style: "short", numeric: "always" }).format(value, unit); } catch (_) { relative = ""; }
    return relative ? `${time} (${relative})` : time;
}

function inviteLimitMessage(status) {
    if (!status) return "Daily invite unlocks are unavailable right now.";
    const reset = inviteResetDescription(status);
    return reset
        ? `You've used today's invite unlocks. More are available at ${reset}.`
        : "You've used today's invite unlocks. More are available soon.";
}

// PlayLockedActionButton: a full-width 52 pt peach card with a 32 pt icon.
function playLockedButton({ label, icon, attributes = "", disabled = false }) {
    return `<button class="play-locked-action" type="button" ${attributes} ${disabled ? "disabled" : ""}><span class="play-locked-action-icon" aria-hidden="true">${icon}</span><span class="play-locked-action-label">${escapeHTML(label)}</span></button>`;
}

const playInviteIcon = () => `<span class="play-invite-glyph">${uiIcon("message-fill")}</span>`;

// PlayLockedView.inviteUnlockSection: loading, the named suggestion, the
// generic ask, or the used-up message.
function renderInviteUnlock() {
    const status = state.inviteStatus;
    const divider = '<span class="play-locked-divider" aria-hidden="true"></span>';
    if (!status && !state.playInviteStatusLoaded) {
        return `${divider}<p class="play-invite-checking"><span class="play-spinner" aria-hidden="true"></span>Checking invite unlocks…</p>`;
    }
    const remaining = Math.max(0, Number(status?.remaining || 0));
    if (!status || remaining < 1) return `${divider}<p class="play-invite-limit">${escapeHTML(inviteLimitMessage(status))}</p>`;
    const friend = suggestedPlayFriend();
    if (friend) {
        const name = playContactFirstName(friend);
        return `${divider}<p class="play-invite-headline">${escapeHTML(name)} has ${Math.max(0, Number(friend.vote_count || 0)).toLocaleString()} votes waiting</p>
            ${playLockedButton({ label: `Invite ${name} to unlock`, icon: playInviteIcon(), attributes: `data-invite-suggested="${escapeHTML(playContactKey(friend))}"` })}
            <p class="play-invite-meta"><button class="play-invite-other" type="button" data-invite-unlock>Choose someone else</button><span>· ${remaining} left today</span></p>`;
    }
    return `${divider}<p class="play-invite-headline">Invite 1 friend to unlock now</p>
        ${playLockedButton({ label: "Invite & unlock polls", icon: playInviteIcon(), attributes: "data-invite-unlock" })}
        <p class="play-invite-meta">${remaining} invite ${remaining === 1 ? "unlock" : "unlocks"} left today</p>`;
}

function renderPlayInviteBlock() {
    const block = $("#playInviteBlock");
    if (block) block.innerHTML = renderInviteUnlock();
}

// PlayLockedView refreshes the invite status when it appears and every 60 s.
const PLAY_INVITE_REFRESH_MS = 60_000;

async function refreshPlayInviteStatus({ maxAgeMs = 0 } = {}) {
    const userId = api.user?.id;
    if (!userId) return;
    if (maxAgeMs && state.inviteStatus && Date.now() - (state.playInviteStatusAt || 0) < maxAgeMs) {
        state.playInviteStatusLoaded = true;
        renderPlayInviteBlock();
        return;
    }
    const status = await api.getInviteStatus(userId).catch(() => undefined);
    if (api.user?.id !== userId) return;
    if (status !== undefined) {
        state.inviteStatus = status;
        state.playInviteStatusAt = Date.now();
    }
    state.playInviteStatusLoaded = true;
    renderPlayInviteBlock();
}

function stopPlayInviteRefresh() {
    clearInterval(state.playInviteTimer);
    state.playInviteTimer = null;
}

function startPlayInviteRefresh() {
    stopPlayInviteRefresh();
    void refreshPlayInviteStatus({ maxAgeMs: 10_000 });
    state.playInviteTimer = setInterval(() => {
        if (!$("#playInviteBlock")) return stopPlayInviteRefresh();
        if (!document.hidden) void refreshPlayInviteStatus();
    }, PLAY_INVITE_REFRESH_MS);
}

// PlayLockedView.swift formatTime: "1h 5m", "1h", "4m 30s", "4m", "12s".
function formatLockRemaining(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    if (minutes > 0) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
    return `${rest}s`;
}

function playChatsEnabled() {
    return state.config?.enable_chats === true && state.config?.enable_web_chats === true;
}

// PlayLockedView (1.6034), top to bottom: headline, lock art, countdown, the
// invite block, "Send a memento", then "Submit a school question" with its cost.
function renderLockedPlay() {
    setPlayHeaderVisible(false);
    const until = state.playLocked?.locked_until;
    clearInterval(state.playLockTimer);
    state.playLockTimer = state.playLockTick = null;
    const cost = Math.max(0, Number(state.config?.question_submission_aura_cost ?? 200));
    const aura = Math.max(0, Number(state.profile?.aura_points || 0));
    const canSubmit = aura >= cost;
    $("#playCard").innerHTML = `<article class="locked-play-card">
        <h3>Next Poll Set Locked</h3>
        <img decoding="async" class="lock-art" src="../assets/app/lock.webp" width="200" height="200" alt="">
        <p id="playLockMessage" class="play-lock-message">${until ? "Checking unlock time..." : "New polls drop soon."}</p>
        <div id="playInviteBlock" class="play-invite-block">${renderInviteUnlock()}</div>
        ${playChatsEnabled() ? playLockedButton({ label: "Send a memento", icon: '<img src="../assets/app/memento-camera.webp" width="32" height="32" decoding="async" alt="">', attributes: "data-play-memento" }) : ""}
        <div class="play-submit-question">
            ${playLockedButton({ label: "Submit a school question", icon: '<img src="../assets/app/pencil-clipboard.webp" width="32" height="32" decoding="async" alt="">', attributes: "data-open-question", disabled: !canSubmit })}
            <p class="play-invite-meta">${canSubmit ? `Create a poll for your school for ${cost.toLocaleString()} aura.` : `Costs ${cost.toLocaleString()} aura · you need ${(cost - aura).toLocaleString()} more`}</p>
        </div>
    </article>`;
    startPlayInviteRefresh();
    if (until) {
        const tick = () => {
            const remaining = Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 1000));
            const message = $("#playLockMessage");
            if (message) message.textContent = remaining
                ? `Unlocks in ${formatLockRemaining(remaining)}`
                : "Unlocking your next polls...";
            if (remaining > 0) return;
            unlockPlay();
        };
        tick();
        // Ticks only while the page is visible (see the visibilitychange listener).
        if (state.playLocked?.locked_until === until) {
            state.playLockTick = tick;
            if (!document.hidden) state.playLockTimer = setInterval(tick, 1000);
        }
    }
}

// PlayViewModel.unlockGame: stop the timer, show "Loading polls..." and ask
// for the next set. A server that is still locked answers 423, which redraws
// the lock with its own unlock time.
function unlockPlay() {
    clearInterval(state.playLockTimer);
    state.playLockTimer = state.playLockTick = null;
    stopPlayInviteRefresh();
    state.playLocked = null;
    state.questions = [];
    state.questionIndex = 0;
    state.choicesByQuestion.clear();
    state.skipsUsedInSet = 0;
    return loadPlay();
}

// PlayViewModel.handleInviteSuccess: a sent invite re-checks the invite
// status and tries the next set at once.
async function handlePlayInviteSuccess() {
    state.playInviteCheckPending = Date.now();
    state.inviteStatus = await api.getInviteStatus(api.user.id).catch(() => state.inviteStatus);
    state.playInviteStatusAt = Date.now();
    await unlockPlay();
}

// An invite opened later (after the person came back to the app) can unlock
// too: re-check whenever the lock screen becomes visible again, for 30 minutes
// after a share.
function recheckPlayInviteOnReturn() {
    if (document.visibilityState !== "visible" || state.activePanel !== "play" || !$("#playInviteBlock")) return;
    void refreshPlayInviteStatus();
    if (state.playInviteCheckPending && Date.now() - state.playInviteCheckPending < 30 * 60_000) void unlockPlay();
    else state.playInviteCheckPending = 0;
}

// One invite, shared the web way: the system share sheet, or a copied link
// (iOS SnapchatInviteModal's fallback copies the link, then opens Snapchat).
async function sharePlayInvite({ channel = "web", surface = "play_lock", button = null } = {}) {
    if (button) setButtonLoading(button, true, "Opening…");
    try {
        const invite = await api.createInvite(api.user.id, channel, { surface });
        if (navigator.share) {
            await navigator.share({ title: "Join me on Valid", text: "Join Valid and unlock my next polls", url: invite.share_url });
            return true;
        }
        await navigator.clipboard.writeText(invite.share_url);
        if (channel === "snapchat" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
            showToast("Invite link copied. Paste it in Snapchat.");
            setTimeout(() => { location.href = "snapchat://"; }, 220);
        } else showToast("Invite link copied");
        return true;
    } catch (error) {
        if (error?.name !== "AbortError") showToast(userMessage(error, "Couldn't create your invite link. Please try again."));
        return false;
    } finally {
        if (button?.isConnected) setButtonLoading(button, false);
    }
}

function playInviteRowMarkup(contact) {
    const name = cleanDisplayName(contact.name) || "Unknown";
    const letters = name.split(" ").map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "S";
    const mutuals = Math.max(0, Number(contact.recommendation_strength || 0));
    const votes = Math.max(0, Number(contact.vote_count || 0));
    return `<li class="play-invite-row" data-play-invite-row="${escapeHTML(playContactKey(contact))}">
        <span class="play-invite-avatar" aria-hidden="true">${escapeHTML(letters)}</span>
        <span class="play-invite-copy"><strong>${escapeHTML(name)}</strong><small>${mutuals ? `<span class="play-invite-mutuals">${uiIcon("person-2-fill")}${mutuals} mutual${mutuals === 1 ? "" : "s"}</span>` : ""}<span class="play-invite-votes ${votes ? "has-votes" : ""}">${uiIcon("heart")}${votes} vote${votes === 1 ? "" : "s"}</span></small></span>
        <button class="play-invite-row-button" type="button" data-play-invite-contact="${escapeHTML(playContactKey(contact))}" aria-label="Invite ${escapeHTML(name)}">Invite</button>
    </li>`;
}

// InviteFriendsView: "Unlock More Polls" from the lock screen, "Invite
// Friends" after a set. Resolves when the sheet closes.
function openPlayInviteDialog({ mode = "unlock" } = {}) {
    document.querySelector("#playInviteDialog")?.close();
    const unlock = mode === "unlock";
    const surface = unlock ? "play_lock" : "play_congrats";
    const contacts = invitablePlayContacts();
    const dialog = document.createElement("dialog");
    dialog.id = "playInviteDialog";
    dialog.className = "ui-sheet play-invite-dialog";
    dialog.setAttribute("aria-labelledby", "playInviteTitle");
    const snapchat = `<div class="play-invite-snapchat"><img src="../assets/app/snapchat-logo.webp" width="40" height="40" decoding="async" alt=""><span><strong>Share on Snapchat</strong><small>Invite your friends to join</small></span><button type="button" data-play-invite-snapchat>Share</button></div>`;
    dialog.innerHTML = `<div class="play-invite-sheet">
        <div class="play-invite-toolbar"><span class="ui-sheet-grabber" aria-hidden="true"></span><button class="play-invite-done" type="button" data-play-invite-done>Done</button></div>
        <header class="play-invite-header"><div><img src="../assets/app/letter_aligned.webp" width="96" height="96" decoding="async" alt=""><h2 id="playInviteTitle">${unlock ? "Unlock More Polls" : "Invite Friends"}</h2></div><p>${unlock ? "Invite one friend to earn an unlock for your next poll set." : "Valid is more fun when there are more classmates"}</p></header>
        ${contacts.length
            ? `<div class="play-invite-scroll">${snapchat}<ul class="play-invite-list" aria-label="Contacts to invite">${contacts.map(playInviteRowMarkup).join("")}</ul></div>`
            : `<div class="play-invite-empty"><span class="play-invite-empty-icon" aria-hidden="true">${uiIcon("person-2-fill")}</span><strong>No contacts to invite</strong><p>Invite your friends to join Valid!</p><button class="play-invite-snapchat-button" type="button" data-play-invite-snapchat><img src="../assets/app/snapchat-logo.webp" width="28" height="28" decoding="async" alt="">Share on Snapchat</button><button class="play-invite-messages-button" type="button" data-play-invite-messages>${uiIcon("message-fill")}Invite via Messages</button></div>`}
    </div>`;
    return new Promise((resolve) => {
        let succeeded = false;
        const success = (contact = null) => {
            if (contact?.invite_suggested) recordPlayInvited(contact);
            if (!unlock) return;
            succeeded = true;
            dialog.close();
        };
        dialog.addEventListener("click", async (event) => {
            if (event.target === dialog) {
                const box = dialog.getBoundingClientRect();
                if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
                return;
            }
            if (event.target.closest("[data-play-invite-done]")) return dialog.close();
            const snap = event.target.closest("[data-play-invite-snapchat]");
            if (snap && await sharePlayInvite({ channel: "snapchat", surface, button: snap })) return success();
            const messages = event.target.closest("[data-play-invite-messages]");
            if (messages && await sharePlayInvite({ channel: "imessage", surface, button: messages })) return success();
            const invite = event.target.closest("[data-play-invite-contact]");
            if (!invite) return;
            const contact = contacts.find((item) => playContactKey(item) === invite.dataset.playInviteContact);
            if (!await sharePlayInvite({ channel: "web", surface, button: invite })) return;
            invite.replaceWith(Object.assign(document.createElement("span"), { className: "play-invite-row-done", textContent: "Invited" }));
            success(contact);
        });
        dialog.addEventListener("close", () => {
            dialog.remove();
            resolve(succeeded);
            if (succeeded) void handlePlayInviteSuccess();
        }, { once: true });
        document.body.append(dialog);
        dialog.showModal();
        dialog.querySelector("[data-play-invite-done]").focus({ preventScroll: true });
    });
}

// The lock screen's invite: the sheet with contacts and Snapchat when there
// are contacts to invite, else straight to the share sheet (iOS: Messages).
async function inviteAndUnlock(button) {
    const locked = Boolean($("#playInviteBlock"));
    if (locked && invitablePlayContacts().length) {
        await openPlayInviteDialog({ mode: "unlock" });
        return;
    }
    const shared = await sharePlayInvite({ channel: "web", surface: locked ? "play_lock" : "play_not_enough_friends", button });
    if (shared && locked) await handlePlayInviteSuccess();
}

// PlayLockedView.inviteSuggestedFriend: one tap invites the named friend.
async function inviteSuggestedPlayFriend(button) {
    const friend = invitablePlayContacts().find((contact) => playContactKey(contact) === button.dataset.inviteSuggested);
    if (!friend) return;
    if (!await sharePlayInvite({ channel: "web", surface: "play_lock_suggestion", button })) return;
    recordPlayInvited(friend);
    await handlePlayInviteSuccess();
}

// MainTabView: "Send a memento" opens the Chats tab's new-chat flow.
async function openMementoFromPlay() {
    switchPanel("chats");
    for (let attempt = 0; attempt < 40 && state.activePanel === "chats"; attempt += 1) {
        const compose = document.querySelector("#chatsPanel [data-new-chat]");
        if (compose && compose.offsetParent) {
            compose.click();
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 75));
    }
}

// PlayCongratsView: "Congrats", the aura (with the crown and 2× for God
// Mode), "you just earned N aura", "w aura", then "Play ‹game›".
function renderPlayCongrats() {
    setPlayHeaderVisible(false);
    const godMode = api.user?.subscribed_user === true;
    const game = postPlayWeeklyGame();
    $("#playCard").innerHTML = `<article class="play-congrats">
        <h3>Congrats</h3>
        <div class="play-congrats-art">
            <img class="play-congrats-aura" decoding="async" src="../assets/app/aura.webp" width="150" height="150" alt="">
            ${godMode ? '<img class="play-congrats-crown" decoding="async" src="../assets/app/crown.webp" width="60" height="60" alt=""><img class="play-congrats-two-x" decoding="async" src="../assets/app/two-x.webp" width="80" height="80" alt="2x">' : ""}
        </div>
        <p>you just earned ${Number(state.playAuraEarned).toLocaleString()} aura</p>
        <div class="play-congrats-actions">
            <button class="primary-button" type="button" data-finish-play>w aura</button>
            ${game ? `<button class="play-congrats-game" type="button" data-play-congrats-game>${weeklyGameArtMarkup(game.release, 32)}<span>Play ${escapeHTML(game.release.title || "Game of the Week")}</span>${uiIcon("arrow-right")}</button>` : ""}
        </div>
    </article>`;
    if (!game && !weeklyGameState.loadedAt) void refreshWeeklyGame().then(() => {
        if (state.playComplete && postPlayWeeklyGame() && $("#playCard .play-congrats")) renderPlayCongrats();
    });
}

function renderPlay() {
    const card = $("#playCard");
    if (state.playNeedsFriends) return renderNotEnoughFriends();
    if (state.playLocked) return renderLockedPlay();
    if (state.playComplete) return renderPlayCongrats();
    const question = state.questions[state.questionIndex];
    $("#playProgress").textContent = state.questions.length ? `Question ${Math.min(state.questionIndex + 1, state.questions.length)} of ${state.questions.length}` : "";
    if (!question) {
        if (state.questions.length && state.questionIndex >= state.questions.length) {
            state.playComplete = true;
            renderPlayCongrats();
        } else {
            state.playLocked = {};
            renderLockedPlay();
        }
        return;
    }
    const choices = choicesForQuestion(question);
    if (choices.length < 4) return renderNotEnoughFriends();
    setPlayHeaderVisible(true);
    $("#playProgress").textContent = `Question ${Math.min(state.questionIndex + 1, state.questions.length)} of ${state.questions.length}`;
    const artworkURL = api.assetURL(question.image_url);
    const submitter = playQuestionAttribution(question, api.user?.id);
    const reveal = submitter.kind === "anonymous" && !submitter.viewerIsAuthor && question.can_reveal_submitter
        ? `<button class="play-reveal-submitter" type="button" data-play-reveal-submitter aria-label="Reveal who submitted this question"><img src="../assets/app/crown.webp" width="22" height="22" alt="" decoding="async"><span>Reveal</span></button>` : "";
    const attribution = submitter.kind !== "none" ? `<div class="question-attribution">${submitterAttributionContent(submitter, question.submitted_by_avatar_url)}${reveal}<div class="detail-overflow play-overflow"><button class="detail-overflow-button play-overflow-button" type="button" data-toggle-play-menu aria-label="More question actions" aria-expanded="false">•••</button><div class="detail-overflow-menu hidden" role="menu" aria-label="Question actions"><button type="button" role="menuitem" data-play-question-action="report">Report a Safety Issue</button>${question.is_anonymous ? "" : `<button type="button" role="menuitem" data-play-question-action="block">Block User</button>`}</div></div></div>` : "";
    const remainingSkips = Math.max(0, Number(state.config?.max_skips_per_set ?? 3) - state.skipsUsedInSet);
    const previousCard = card.dataset.questionId && card.dataset.questionId !== String(question.id) ? card.querySelector(":scope > .play-card") : null;
    card.innerHTML = `<article class="play-card">
        <div class="play-question-copy"><h3>${escapeHTML(question.question_text)}</h3>${attribution}</div>
        <div class="question-artwork">${artworkURL ? mediaImageMarkup(artworkURL, { loading: "eager", attributes: 'fetchpriority="high"' }) : `<div class="artwork-placeholder"><img decoding="async" src="../assets/app/pencil-clipboard.webp" alt=""><span>Question artwork</span></div>`}</div>
        <div class="choice-grid">${choices.map(choiceMarkup).join("")}</div>
        <div class="play-actions">
            <button class="play-action-button" data-shuffle type="button">${uiIcon("shuffle-circle")} Shuffle</button>
            <button class="play-action-button nominate" data-nominate type="button"><img loading="lazy" decoding="async" src="../assets/app/crown.webp" alt="">Nominate</button>
            <button class="play-action-button" data-skip="${question.id}" type="button" ${remainingSkips < 1 ? "disabled" : ""}>${uiIcon("forward")} Skip (${remainingSkips})</button>
        </div>
    </article>`;
    // Short screens scroll the full poll; each new question starts at its prompt.
    if (card.dataset.questionId !== String(question.id)) {
        card.scrollTop = 0;
        card.dataset.questionId = String(question.id);
        crossFadePlayCard(card, previousCard);
        preloadPlayArtwork(state.questions[state.questionIndex + 1]);
    }
}

// PlayGameView.swift cross-fades the artwork and answer grid over 0.35 s when
// the question changes. The outgoing card stays inert underneath while it fades.
function crossFadePlayCard(card, previousCard) {
    card.querySelectorAll(":scope > .play-card-leaving").forEach((node) => node.remove());
    if (!previousCard || prefersReducedMotion()) return;
    previousCard.classList.add("play-card-leaving");
    previousCard.setAttribute("aria-hidden", "true");
    previousCard.inert = true;
    card.querySelector(":scope > .play-card")?.classList.add("play-card-entering");
    card.append(previousCard);
    setTimeout(() => previousCard.remove(), 400);
}

// PlayViewModel prefetches upcoming artwork so the next question never opens on an empty tile.
function preloadPlayArtwork(question) {
    const url = question?.image_url ? api.assetURL(question.image_url) : "";
    const source = url ? imageCandidates(url)[0] : "";
    if (!source || preloadPlayArtwork.loaded.has(source)) return;
    preloadPlayArtwork.loaded.add(source);
    const image = new Image();
    image.decoding = "async";
    image.src = source;
}
preloadPlayArtwork.loaded = new Set();

const PLAY_CONFIG_FALLBACK = {
    nomination_aura_cost: 100,
    question_submission_aura_cost: 200,
    max_custom_question_length: 280,
    max_skips_per_set: 3,
    play_lock_time_seconds: 60,
};

// PlayViewModel+QuestionLoading: count the pool first. GET /questions/unanswered
// starts the server's play lock, so it is only requested once four people exist.
async function loadPlay() {
    if (state.questions.length || state.playLocked) return renderPlay();
    // One request chain at a time: a timer, an invite and a return to the
    // page can all ask for the next set at once.
    state.playLoading ||= loadPlaySet().finally(() => { state.playLoading = null; });
    return state.playLoading;
}

async function loadPlaySet() {
    renderPlayLoading();
    try {
        const [config, inviteStatus] = await Promise.all([
            state.config ? Promise.resolve(state.config) : api.getConfig().catch(() => ({ ...PLAY_CONFIG_FALLBACK })),
            api.getInviteStatus(api.user.id).catch(() => null),
        ]);
        state.config = config;
        state.inviteStatus = inviteStatus;
        state.playInviteStatusAt = Date.now();
        state.playInviteStatusLoaded = true;
        await loadPlayRoster();
        state.choicesByQuestion.clear();
        if (!canStartPlay(state.playPool)) {
            state.playNeedsFriends = true;
            $("#playStatus").textContent = "";
            renderPlay();
            return;
        }
        state.playNeedsFriends = false;
        const questionBatch = await api.getPlayQuestions(api.user.id);
        state.questions = questionBatch.questions || [];
        state.playChoiceHistory = [];
        $("#playStatus").textContent = "";
        renderPlay();
    } catch (error) {
        if (error.status === 423) {
            state.playLocked = error.detail || {};
            state.inviteStatus = await api.getInviteStatus(api.user.id).catch(() => null);
            state.playInviteStatusAt = Date.now();
            state.playInviteStatusLoaded = true;
            $("#playStatus").textContent = "";
            renderLockedPlay();
        } else {
            setPlayHeaderVisible(false);
            $("#playStatus").textContent = userMessage(error, "Could not load Play.");
        }
    }
}

function shufflePlayChoices() {
    const question = state.questions[state.questionIndex];
    if (!question) return;
    state.choicesByQuestion.delete(question.id);
    renderPlay();
}

function nominationCandidates() {
    const question = state.questions[state.questionIndex];
    if (!question) return [];
    const shown = new Set(choicesForQuestion(question).map((choice) => choice.id));
    return state.playPool.filter((choice) => choice.user_id !== String(api.user.id) && !shown.has(choice.id));
}

// NominationSearchView: "Classmates (N)" / "Not on Valid (N)" tabs. Classmates
// rank by votes, contacts by mutual connections, then by name; without a
// search each tab shows its first 50.
function nominationTabLists() {
    const byName = (first, second) => cleanDisplayName(first.name).toLowerCase().localeCompare(cleanDisplayName(second.name).toLowerCase());
    const candidates = nominationCandidates();
    const classmates = candidates.filter((candidate) => candidate.is_classmate)
        .sort((first, second) => Number(second.vote_count || 0) - Number(first.vote_count || 0) || byName(first, second));
    const contacts = candidates.filter((candidate) => !candidate.is_six7_user && cleanDisplayName(candidate.name))
        .sort((first, second) => Number(second.mutual_strength || 0) - Number(first.mutual_strength || 0) || byName(first, second));
    return { classmates, contacts };
}

function nominationRowMarkup(candidate, cost) {
    const name = cleanDisplayName(candidate.name) || candidate.name;
    const mutuals = Math.max(0, Number(candidate.mutual_strength || 0));
    const detail = candidate.is_classmate
        ? (candidate.grade ? formatGrade(candidate.grade) : "")
        : mutuals ? `${mutuals} mutual connection${mutuals === 1 ? "" : "s"}` : "";
    return `<button class="nomination-row" type="button" data-nomination="${escapeHTML(candidate.id)}">
        ${avatarMarkup({ ...candidate, first_name: name, last_name: "" }, "choice-avatar")}<span class="nomination-row-copy"><strong>${escapeHTML(name)}</strong>${detail ? `<small>${escapeHTML(detail)}</small>` : ""}</span>
        <span class="nomination-cost"><img loading="lazy" decoding="async" src="../assets/app/aura.webp" alt="">${cost}</span>
    </button>`;
}

function renderNominationList() {
    const query = $("#nominationSearch").value.trim().toLowerCase();
    const lists = nominationTabLists();
    const tab = state.nominationTab === "contacts" ? "contacts" : "classmates";
    const tabs = $("#nominationTabs");
    tabs.hidden = !lists.classmates.length && !lists.contacts.length;
    tabs.querySelector('[data-nomination-tab="classmates"]').textContent = `Classmates (${lists.classmates.length})`;
    tabs.querySelector('[data-nomination-tab="contacts"]').textContent = `Not on Valid (${lists.contacts.length})`;
    tabs.querySelectorAll("[data-nomination-tab]").forEach((button) => {
        const selected = button.dataset.nominationTab === tab;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-selected", String(selected));
    });
    $("#nominationSearch").placeholder = tab === "classmates" ? "Search classmates" : "Search contacts";
    const base = lists[tab];
    const results = query ? base.filter((candidate) => cleanDisplayName(candidate.name).toLowerCase().includes(query)) : base.slice(0, 50);
    const cost = Number(state.config?.nomination_aura_cost ?? 100);
    $("#nominationList").innerHTML = results.length
        ? results.map((candidate) => nominationRowMarkup(candidate, cost)).join("")
        : query
            ? `<div class="nomination-empty">${uiIcon("person-slash")}<strong>No results found</strong><span>Try a different search term</span></div>`
            : `<div class="nomination-empty">${uiIcon("person-badge-plus")}<strong>No one available to nominate</strong></div>`;
}

function openNominationDialog() {
    $("#nominationSearch").value = "";
    $("#nominationStatus").textContent = "";
    state.nominationTab = "classmates";
    renderNominationList();
    $("#nominationDialog").showModal();
    $("#nominationSearch").focus();
}

function nominateClassmate(candidateId) {
    const question = state.questions[state.questionIndex];
    const candidate = nominationCandidates().find((item) => item.id === candidateId);
    if (!question || !candidate) return;
    const cost = auraCost("nominate");
    if (Number(state.profile?.aura_points || 0) < cost) {
        $("#nominationStatus").textContent = `You need ${cost} aura to nominate someone.`;
        return;
    }
    $("#nominationStatus").textContent = "";
    // Same confirm-and-spend sheet as boosts and reveals; it calls submitNomination.
    openAuraSpend("nominate", { candidate, question });
    // PlayGameView+Overlays: "This will cost N aura points." and a "Nominate" button.
    if ($("#auraSpendDialog").open && state.pendingAuraPurchase?.kind === "nominate") {
        $("#auraSpendMessage").textContent = `This will cost ${cost.toLocaleString()} aura points.`;
        const confirm = $("#confirmAuraSpend");
        confirm.dataset.label = "Nominate";
        confirm.innerHTML = "<span>Nominate</span>";
    }
}

async function submitNomination({ candidate, question }) {
    const result = await api.answerQuestion(api.user.id, answerPayload({
        questionId: question.id,
        selected: candidate,
        choices: choicesForQuestion(question),
        isNomination: true,
        clientRequestId: crypto.randomUUID?.(),
    }));
    clearOptimisticEarnedProfile();
    if (state.profile && Number.isFinite(Number(result.total_aura_points))) {
        state.profile.aura_points = Number(result.total_aura_points);
        state.profile.current_streak = Math.max(0, Number(result.current_streak ?? state.profile.current_streak ?? 0));
        state.profile.streak_multiplier = Math.max(1, Number(result.streak_multiplier ?? state.profile.streak_multiplier ?? 1));
        renderProfileHeader();
    }
    $("#nominationDialog").close();
    showToast(`You nominated ${candidate.name}`);
    animateAuraChange(-auraCost("nominate"));
    if (state.questions[state.questionIndex] === question) {
        state.questionIndex += 1;
        renderPlay();
    }
    refreshProfile();
    refreshFeedGateStatus();
}

// iOS PlayViewModel.selectAnswer: medium haptic, instant selection, every choice
// locked, and a fixed 1.2 s hold before advancing whatever the network does
// (scheduleAdvance ~1180). The server response only reconciles aura and streak.
const PLAY_ANSWER_HOLD_MS = 1200;
const PLAY_SKIP_HOLD_MS = 500;

function beginPlayTransition(question) {
    if (state.playTransition || !question) return false;
    state.playTransition = { questionId: question.id };
    $$("#playCard .choice-button, #playCard .play-action-button, #playCard .play-overflow-button").forEach((button) => { button.disabled = true; });
    return true;
}

function schedulePlayAdvance(question, delay) {
    setTimeout(() => {
        if (state.playTransition?.questionId !== question.id) return;
        state.playTransition = null;
        if (state.questions[state.questionIndex] !== question) return;
        state.questionIndex += 1;
        renderPlay();
    }, delay);
}

async function answerPlayQuestion(choiceId) {
    const question = state.questions[state.questionIndex];
    if (!question || state.playTransition) return;
    const choices = choicesForQuestion(question);
    const selected = choices.find((choice) => choice.id === choiceId);
    if (!selected || !beginPlayTransition(question)) return;
    const selectedButton = $(`[data-choice="${CSS.escape(choiceId)}"]`);
    const previousAura = Math.max(0, Number(state.profile?.aura_points || 0));
    const previousStreak = Math.max(0, Number(state.profile?.current_streak || 0));
    const previousMultiplier = Math.max(1, Number(state.profile?.streak_multiplier || 1));
    const expectedAura = expectedAuraPerAnswer();
    $$(".choice-button").forEach((button) => button.classList.toggle("selected", button.dataset.choice === choiceId));
    haptic("medium");
    if (state.profile && expectedAura > 0) {
        state.profile.aura_points = previousAura + expectedAura;
        state.playAuraEarned += expectedAura;
        protectOptimisticEarnedProfile(state.profile.aura_points, previousStreak, previousMultiplier);
        renderProfileHeader();
        animateAuraChange(expectedAura, selectedButton);
    }
    // PlayViewModel+Answering: a vote for a contact who isn't on Valid asks to
    // invite them, and the next question waits for that answer.
    const invitePrompt = votePromptInvite(selected);
    if (invitePrompt) void promptVoteInvite(question, invitePrompt);
    else schedulePlayAdvance(question, PLAY_ANSWER_HOLD_MS);
    try {
        const result = await api.answerQuestion(api.user.id, answerPayload({
            questionId: question.id,
            selected,
            choices,
            clientRequestId: crypto.randomUUID?.(),
        }));
        const auraEarned = Math.max(0, Number(result.aura_points_earned ?? expectedAura));
        const earnedDifference = auraEarned - expectedAura;
        state.playAuraEarned = Math.max(0, state.playAuraEarned + earnedDifference);
        if (state.profile) {
            const serverTotal = Number(result.total_aura_points);
            const reconciledAura = Math.max(0, Number(state.profile.aura_points || 0) + earnedDifference);
            state.profile.aura_points = Number.isFinite(serverTotal) ? Math.max(reconciledAura, serverTotal) : reconciledAura;
            state.profile.current_streak = Math.max(0, Number(result.current_streak ?? state.profile.current_streak ?? previousStreak));
            state.profile.streak_multiplier = Math.max(1, Number(result.streak_multiplier ?? state.profile.streak_multiplier ?? previousMultiplier));
            protectOptimisticEarnedProfile(state.profile.aura_points, state.profile.current_streak, state.profile.streak_multiplier);
            renderProfileHeader();
        }
        if (earnedDifference !== 0) animateAuraChange(earnedDifference);
        if (state.playComplete && !state.playTransition) renderPlayCongrats();
        if (Number(state.profile?.current_streak || 0) > previousStreak) {
            showStreakCelebration(state.profile.current_streak, state.profile.streak_multiplier);
        }
        refreshProfile();
        refreshFeedGateStatus();
    } catch (error) {
        // Keep moving like iOS; only take back the aura this vote promised.
        state.playAuraEarned = Math.max(0, state.playAuraEarned - expectedAura);
        if (state.profile && expectedAura > 0) {
            state.profile.aura_points = Math.max(previousAura, Number(state.profile.aura_points || 0) - expectedAura);
            clearOptimisticEarnedProfile();
            renderProfileHeader();
            animateAuraChange(-expectedAura);
        }
        if (state.playComplete && !state.playTransition) renderPlayCongrats();
        const fallback = "Your vote didn't go through. That poll will come back in a later set.";
        showToast(error?.status >= 400 && error.status < 500 ? userMessage(error, fallback) : fallback);
    }
}

// enable_invite_after_vote; with enable_invite_suggestions on, only once the
// friend has 3 votes (InvitePromptInfo.suggestionMinVotes), counting this one.
function votePromptInvite(choice) {
    if (state.config?.enable_invite_after_vote !== true || !choice || choice.user_id || choice.is_six7_user) return null;
    const suggestionsOn = state.config?.enable_invite_suggestions !== false;
    const votes = Math.max(0, Number(choice.vote_count || 0)) + 1;
    if (suggestionsOn && votes < 3) return null;
    return { name: cleanDisplayName(choice.name) || "your friend", votes: suggestionsOn ? votes : null };
}

// PlayGameView+Overlays' ConfirmationModal, then the invite, then the toast.
async function promptVoteInvite(question, { name, votes }) {
    const accepted = await confirmSheet({
        title: `Invite ${name}?`,
        message: votes ? `They have ${votes.toLocaleString()} votes waiting on Valid.` : "Valid is more fun with more people! :)",
        confirmLabel: "Invite",
        cancelLabel: "Cancel",
    });
    if (accepted && await sharePlayInvite({ channel: "web", surface: "vote_prompt" })) {
        showToast(`\u{1F525} nice - ${name} can vote on you when they join`);
    }
    schedulePlayAdvance(question, 0);
}

// PlayCongratsView.handleContinue: "w aura" asks for notifications first,
// then shows the invite sheet (when there are contacts to invite), and the
// lock starts once that closes.
async function finishPlaySet(button = null) {
    if (state.playFinishing) return;
    state.playFinishing = true;
    if (button) button.disabled = true;
    try {
        await askForNotifications({ reason: "play_congrats" });
        if (api.user?.id && state.playComplete && invitablePlayContacts().length) await openPlayInviteDialog({ mode: "congrats" });
    } catch (_) { /* The lock still starts. */ }
    finally { state.playFinishing = false; }
    if (!state.playComplete) return;
    beginPlayCooldown();
}

function beginPlayCooldown() {
    state.playComplete = false;
    state.playAuraEarned = 0;
    state.skipsUsedInSet = 0;
    state.questions = [];
    state.questionIndex = 0;
    state.choicesByQuestion.clear();
    const lockSeconds = Math.max(1, Number(state.config?.play_lock_time_seconds ?? 60));
    state.playLocked = { locked_until: new Date(Date.now() + lockSeconds * 1000).toISOString() };
    renderLockedPlay();
}

// PlayViewModel.skipQuestion: shake the aura counter, record the skip in the
// background, and advance after 0.5 s. Failed skips retry until they land.
function skipPlayQuestion(questionId) {
    const question = state.questions[state.questionIndex];
    if (!question || String(question.id) !== String(questionId) || state.playTransition) return;
    const remaining = Math.max(0, Number(state.config?.max_skips_per_set ?? 3) - state.skipsUsedInSet);
    if (remaining < 1) return showToast("You've used all skips for this poll set.");
    if (!beginPlayTransition(question)) return;
    state.skipsUsedInSet += 1;
    restartChipAnimation($("#auraCount")?.closest(".play-aura-chip"), "aura-shake");
    schedulePlayAdvance(question, PLAY_SKIP_HOLD_MS);
    void recordPlaySkip(question.id);
}

const pendingPlaySkips = new Map();

async function recordPlaySkip(questionId, attempt = 0) {
    const userId = api.user?.id;
    if (!userId) return;
    try {
        await api.skipQuestion(userId, questionId);
        pendingPlaySkips.delete(questionId);
    } catch (error) {
        if (error?.status && error.status < 500 && error.status !== 408 && error.status !== 429) {
            pendingPlaySkips.delete(questionId);
            return;
        }
        if (!pendingPlaySkips.has(questionId) && attempt === 0) showToast("Skipped. We'll save it when your connection is back.");
        pendingPlaySkips.set(questionId, { userId, attempt: attempt + 1 });
        if (attempt < 4 && navigator.onLine !== false) {
            setTimeout(() => {
                const pending = pendingPlaySkips.get(questionId);
                if (pending && api.user?.id === pending.userId) void recordPlaySkip(questionId, pending.attempt);
            }, 2000 * 2 ** attempt);
        }
    }
}

function retryPendingPlaySkips() {
    for (const [questionId, pending] of pendingPlaySkips) {
        if (api.user?.id === pending.userId) void recordPlaySkip(questionId, pending.attempt);
    }
}

// PlayGameView+Overlays: "Report a Safety Issue" with a reason field, and
// "Block User".
function playReportSheet() {
    return new Promise((resolve) => {
        const dialog = document.createElement("dialog");
        dialog.className = "ui-sheet play-report-sheet";
        dialog.setAttribute("aria-labelledby", "playReportTitle");
        dialog.dataset.destructive = "true";
        dialog.innerHTML = `<form method="dialog" class="ui-sheet-content">
            <span class="ui-sheet-grabber" aria-hidden="true"></span>
            <h2 id="playReportTitle">Report a Safety Issue</h2>
            <p class="ui-sheet-message">Report only if this question is unsafe or breaks the rules. If you just don't want to answer it, use Skip instead.</p>
            <label class="ui-sheet-details"><span class="visually-hidden">Reason</span><textarea rows="3" maxlength="500" placeholder="Explain why you're reporting this question..."></textarea></label>
            <div class="ui-sheet-actions"><button class="danger-button ui-sheet-confirm" type="submit" value="confirm">Report for Review</button><button class="secondary-button ui-sheet-cancel" type="button" data-cancel>Cancel</button></div>
        </form>`;
        let result = null;
        dialog.querySelector("form").addEventListener("submit", (event) => {
            event.preventDefault();
            result = { reason: dialog.querySelector("textarea").value.trim() };
            dialog.close();
        });
        dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
        dialog.addEventListener("close", () => { dialog.remove(); resolve(result); }, { once: true });
        document.body.append(dialog);
        dialog.showModal();
        dialog.querySelector("textarea").focus({ preventScroll: true });
    });
}

async function moderatePlayQuestion(action) {
    const question = state.questions[state.questionIndex];
    if (!question?.is_user_submitted) return;
    const report = action === "block"
        ? (await confirmSheet({ title: "Block User", message: "You will no longer see this user's questions.", confirmLabel: "Block", destructive: true }) ? {} : null)
        : await playReportSheet();
    if (!report) return;
    try {
        if (action === "block") await api.blockQuestionSubmitter(api.user.id, question.id);
        else await api.reportQuestion(api.user.id, question.id, report.reason || undefined);
        state.questionIndex += 1;
        renderPlay();
        showToast(action === "block" ? "Submitter blocked" : "Reported to Valid");
    } catch (error) {
        showToast(userMessage(error, `Could not ${action} this question.`));
    }
}

// PlayGameView.anonymousSubmitterRow: God Mode's crown "Reveal" on an
// anonymous question, with the reveal or aura confirm first.
async function revealPlayQuestionSubmitter(button) {
    const question = state.questions[state.questionIndex];
    if (!question?.can_reveal_submitter || question.submitter_revealed) return;
    if (api.user?.subscribed_user !== true) return openGodModePitch();
    const remaining = Math.max(0, Number(state.profile?.remaining_reveals || 0));
    const cost = Math.max(0, Number(state.config?.full_reveal_aura_cost ?? DEFAULT_FULL_REVEAL_AURA_COST));
    if (remaining <= 0 && Number(state.profile?.aura_points || 0) < cost) return showToast(`You need ${cost.toLocaleString()} aura.`);
    const left = Math.max(0, remaining - 1);
    if (!await confirmSheet(remaining > 0
        ? { title: "Reveal who made this question?", message: `This uses 1 of your weekly reveals. You will have ${left} ${left === 1 ? "reveal" : "reveals"} left.`, confirmLabel: "Use 1 Reveal" }
        : { title: "Reveal who made this question?", message: `Spend ${cost.toLocaleString()} aura to reveal the classmate who submitted it.`, confirmLabel: `Spend ${cost.toLocaleString()} aura` })) return;
    button.disabled = true;
    try {
        const result = await api.revealQuestionSubmitter(api.user.id, question.id);
        Object.assign(question, { submitter_revealed: true, submitted_by_name: result.full_name, submitted_by_user_id: result.submitted_by_user_id, submitted_by_avatar_url: result.profile_picture_url });
        if (state.profile) {
            state.profile.remaining_reveals = Math.max(0, Number(result.remaining_reveals || 0));
            if (Number.isFinite(Number(result.total_aura_points))) state.profile.aura_points = Number(result.total_aura_points);
            renderProfileHeader();
        }
        if (state.questions[state.questionIndex] === question && !state.playTransition) renderPlay();
    } catch (error) {
        showToast(userMessage(error, "Could not reveal question author."));
        if (button.isConnected) button.disabled = false;
    }
}

async function refreshProfile() {
    try {
        const [profile, currentUser] = await Promise.all([
            api.getProfile(api.user.id),
            api.getUser(api.user.id).catch(() => api.user),
        ]);
        state.profile = mergeOptimisticEarnedProfile(profile);
        api.user = { ...api.user, ...currentUser };
        renderProfileHeader();
        renderProfilePanel();
    } catch (_) { /* The action succeeded; totals can catch up later. */ }
}

function askAccessRestricted() {
    return Boolean(state.askAccess && state.askAccess.status !== "allowed");
}

function formatSafetyNoticeDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
    });
}

function showNextAskSafetyNotice() {
    const dialog = $("#askSafetyNoticeDialog");
    const notice = state.askSafetyNotices[0];
    if (!notice) {
        if (dialog.open) dialog.close();
        return;
    }
    $("#askSafetyNoticeTitle").textContent = notice.title;
    $("#askSafetyNoticeMessage").textContent = notice.message;
    $("#askSafetyNoticeDate").textContent = formatSafetyNoticeDate(notice.created_at);
    $("#askSafetyNoticeStatus").textContent = "";
    const button = $("#acknowledgeAskSafetyNotice");
    button.dataset.label = "I understand";
    button.textContent = "I understand";
    button.disabled = false;
    if (!dialog.open) dialog.showModal();
}

async function refreshAskSafetyState({ force = false } = {}) {
    // Three requests: refresh on foreground at most every 5 minutes.
    if (!api.user?.id || state.askSafetyRefresh || (!force && Date.now() - (state.askSafetyRefreshedAt || 0) < 300_000)) return;
    state.askSafetyRefresh = true;
    state.askSafetyRefreshedAt = Date.now();
    try {
        const [access, notices, history] = await Promise.all([
            api.getAnonymousAskAccess(api.user.id),
            api.getAnonymousAskSafetyNotices(api.user.id),
            api.getAnonymousAskSafetyNotices(api.user.id, true),
        ]);
        state.askAccess = access;
        state.askSafetyNotices = notices;
        state.askSafetyNoticeHistory = history;
        if (state.askLink) renderAskLink();
        showNextAskSafetyNotice();
    } catch (_) {
        // Keep the last authoritative safety state until the next refresh.
        state.askSafetyRefreshedAt = 0;
    } finally {
        state.askSafetyRefresh = false;
    }
}

async function acknowledgeAskSafetyNotice() {
    const notice = state.askSafetyNotices[0];
    if (!notice) return;
    const button = $("#acknowledgeAskSafetyNotice");
    setButtonLoading(button, true, "Saving…");
    try {
        await api.acknowledgeAnonymousAskSafetyNotice(api.user.id, notice.id);
        state.askSafetyNotices.shift();
        showNextAskSafetyNotice();
    } catch (error) {
        $("#askSafetyNoticeStatus").textContent = userMessage(error, "Could not save your acknowledgement.");
        setButtonLoading(button, false);
    }
}

function renderAskSafetyHistory() {
    const list = $("#askSafetyHistoryList");
    if (!state.askSafetyNoticeHistory.length) {
        list.innerHTML = `<div class="empty-card"><strong>No safety notices</strong><p>You do not have any Ask Me warnings or restrictions.</p></div>`;
        return;
    }
    list.innerHTML = state.askSafetyNoticeHistory.map((notice) => `<article class="ask-safety-history-card">
        <div><strong>${escapeHTML(notice.title)}</strong><time>${escapeHTML(formatSafetyNoticeDate(notice.created_at))}</time></div>
        <p>${escapeHTML(notice.message)}</p>
    </article>`).join("");
}

async function openAskSafetyHistory() {
    const dialog = $("#askSafetyHistoryDialog");
    $("#askSafetyHistoryStatus").textContent = "Loading notices…";
    renderAskSafetyHistory();
    dialog.showModal();
    try {
        state.askSafetyNoticeHistory = await api.getAnonymousAskSafetyNotices(api.user.id, true);
        $("#askSafetyHistoryStatus").textContent = "";
        renderAskSafetyHistory();
    } catch (error) {
        $("#askSafetyHistoryStatus").textContent = userMessage(error, "Could not load safety notices.");
    }
}

function renderAskLink() {
    const link = state.askLink;
    if (!link) return;
    const restricted = askAccessRestricted();
    const inactiveCopy = restricted
        ? "Your link is off while your Ask Me access is restricted."
        : "Ask Me is off. Turn it on whenever you're ready; you can switch it off again anytime.";
    const activeDescription = link.is_active && !restricted
        ? "People can ask from your profile or shared link."
        : "Your profile and shared links will not accept messages.";
    $("#askLinkCard").innerHTML = `<article class="ask-link-card">
        <div class="ask-link-heading"><div><strong>Ask Me</strong><span>Allow people with your Ask Me link to send you private questions. You'll see their grade and gender, but not their name. Nothing is posted to your school.</span></div></div>
        ${restricted ? `<div class="ask-safety-restriction"><strong>Ask Me access restricted</strong><span>${escapeHTML(state.askAccess.message || "Your Ask Me access is currently unavailable.")}</span></div>` : ""}
        <button class="ask-link-toggle-row" type="button" role="switch" aria-label="Allow private questions" aria-checked="${link.is_active && !restricted}" data-toggle-link ${restricted ? "disabled" : ""}>
            <span><strong>${link.is_active && !restricted ? "Ask Me is on" : "Ask Me is off"}</strong><small>${escapeHTML(activeDescription)}</small></span>
            <span class="settings-switch" aria-hidden="true"><span></span></span>
        </button>
        ${link.is_active && !restricted ? `<button class="ask-url" type="button" data-copy-link aria-label="Copy ask link"><span class="ask-url-icon">${appSymbolMarkup("link")}</span><span>${escapeHTML(link.share_url.replace(/^https:\/\//, ""))}</span><strong>Copy</strong></button>` : ""}
        ${link.is_active && !restricted ? `<div class="share-platform-row"><span class="share-platform-label">Open on:</span><button class="share-platform-button snapchat" type="button" data-share-link="snapchat" aria-label="Share ask link to Snapchat">${shareIconMarkup("snapchat")}</button><button class="share-platform-button instagram" type="button" data-share-link="instagram" aria-label="Share ask link to Instagram">${shareIconMarkup("instagram")}</button></div>` : ""}
        ${!link.is_active || restricted ? `<p class="ask-link-paused">${escapeHTML(inactiveCopy)}</p>` : ""}
        <div class="ask-link-controls"><button class="text-button icon-text-button" type="button" data-rotate-link>${appSymbolMarkup("reset")}<span>Reset ask link</span></button></div>
        ${state.askSafetyNoticeHistory.length ? `<button class="text-button ask-safety-history-button icon-text-button" type="button" data-ask-safety-history>${appSymbolMarkup("shield")}<span>Ask Me safety notices</span></button>` : ""}
    </article>`;
}

function askStoryPlatformLabel(platform) {
    return platform === "instagram" ? "Instagram" : "Snapchat";
}

function requestAskStoryShare(platform) {
    state.pendingAskStoryPlatform = platform;
    state.askStoryFile = null;
    state.askStoryShareURL = null;
    const label = askStoryPlatformLabel(platform);
    $("#askStoryConfirmPlatformIcon").innerHTML = shareIconMarkup(platform);
    $("#askStoryConfirmTitle").textContent = `Share on ${label}?`;
    $("#askStoryConfirmMessage").textContent = "Valid will create a story image and copy your ask link. On iPhone, choose Save Image in the next share sheet.";
    $("#askStoryConfirmStatus").textContent = "";
    const button = $("#confirmAskStoryShare");
    button.dataset.label = "Continue";
    button.textContent = "Continue";
    button.disabled = false;
    $("#askStoryConfirmDialog").showModal();
}

function renderAskStoryInstructions(platform, copied, imageHandled) {
    const label = askStoryPlatformLabel(platform);
    const steps = platform === "instagram"
        ? ["Open Instagram", "Choose the saved photo", "Add a Link sticker and paste your Valid link"]
        : ["Open Snapchat", "Go to Camera Roll", "Edit Photo + Add Link", "Tap the blue “Attach to Snap” button"];
    $("#askStoryInstructionsPlatformIcon").innerHTML = shareIconMarkup(platform);
    $("#askStoryInstructionsStatus").textContent = `${imageHandled ? "Image ready" : "Save the image below"} • ${copied ? "Link copied" : "Tap Copy link below"}`;
    $("#askStoryInstructionsSteps").innerHTML = steps.map((step, index) => `<li><span>${index + 1}</span><strong>${escapeHTML(step)}</strong></li>`).join("");
    $("#openAskStoryApp").textContent = `Open ${label}`;
    $("#openAskStoryApp").dataset.platform = platform;
    $("#saveAskStoryImage").textContent = imageHandled ? "Save image again" : "Save image";
    $("#copyAskStoryLink").classList.toggle("hidden", copied);
}

function openAskStoryInstructions(platform, copied, imageHandled) {
    renderAskStoryInstructions(platform, copied, imageHandled);
    const dialog = $("#askStoryInstructionsDialog");
    if (!dialog.open) dialog.showModal();
}

async function presentAskStoryFile(file, platform) {
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
            files: [file],
            title: `Valid story for ${askStoryPlatformLabel(platform)}`,
        });
        return true;
    }
    downloadShareFile(file);
    return true;
}

async function prepareAskStoryShare() {
    const platform = state.pendingAskStoryPlatform;
    if (!state.askLink || !platform) return;
    const button = $("#confirmAskStoryShare");
    setButtonLoading(button, true, "Creating story…");
    $("#askStoryConfirmStatus").textContent = "";
    try {
        const share = await api.trackAskShare(api.user.id, platform);
        const shareURL = share?.share_url || state.askLink.share_url;
        const file = await (await shareCards()).createAskStoryFile(platform);
        const copied = await copyShareLink(shareURL);
        state.askStoryFile = file;
        state.askStoryShareURL = shareURL;
        $("#askStoryConfirmDialog").close();
        let imageHandled = false;
        try {
            imageHandled = await presentAskStoryFile(file, platform);
        } catch (_) { /* A direct Save image tap preserves Safari's user gesture. */ }
        openAskStoryInstructions(platform, copied, imageHandled);
    } catch (error) {
        $("#askStoryConfirmStatus").textContent = userMessage(error, "Could not create the story image.");
    } finally {
        setButtonLoading(button, false);
    }
}

async function saveAskStoryImageAgain() {
    const platform = state.pendingAskStoryPlatform;
    const file = state.askStoryFile;
    if (!platform || !file) return;
    const button = $("#saveAskStoryImage");
    setButtonLoading(button, true, "Opening…");
    try {
        const copied = $("#copyAskStoryLink").classList.contains("hidden");
        await presentAskStoryFile(file, platform);
        renderAskStoryInstructions(platform, copied, true);
    } catch (error) {
        if (error.name !== "AbortError") $("#askStoryInstructionsStatus").textContent = "Could not save the image. Please try again.";
    } finally {
        setButtonLoading(button, false);
    }
}

function openAskStoryApp() {
    const platform = state.pendingAskStoryPlatform;
    if (!platform) return;
    if (state.askStoryShareURL) copyShareLink(state.askStoryShareURL);
    window.location.href = platform === "instagram" ? "instagram://" : "snapchat://";
}

async function shareAskLink(forceCopy, platform = "other") {
    if (!state.askLink) return;
    if (askAccessRestricted()) {
        showToast(state.askAccess.message || "Your Ask Me access is restricted.");
        return;
    }
    if (!forceCopy && ["snapchat", "instagram"].includes(platform)) {
        requestAskStoryShare(platform);
        return;
    }
    try {
        const copied = await copyShareLink(state.askLink.share_url);
        if (!copied) throw new Error("Copy failed");
        showToast("Ask me link copied");
        api.trackAskShare(api.user.id, "copy").catch(() => null);
    } catch (_) {
        showToast("Could not copy that link.");
    }
}

async function toggleAskLink() {
    if (askAccessRestricted()) {
        showToast(state.askAccess.message || "Your Ask Me access is restricted.");
        return;
    }
    try {
        state.askLink = await api.setAskLinkActive(api.user.id, !state.askLink.is_active);
        renderAskLink();
    } catch (error) { showToast(userMessage(error, "Could not update your link.")); }
}

async function rotateAskLink() {
    if (!await confirmSheet({ title: "Replace your ask link?", message: "The old link will stop working.", confirmLabel: "Replace link", destructive: true })) return;
    try {
        state.askLink = await api.rotateAskLink(api.user.id);
        renderAskLink();
        showToast("New ask me link created");
    } catch (error) { showToast(userMessage(error, "Could not replace your link.")); }
}

function profileOriginalInformation() {
    return {
        first_name: String(state.profile?.first_name || "").trim(),
        last_name: String(state.profile?.last_name || "").trim(),
        username: String(state.profile?.username || "").trim().toLowerCase(),
        school_id: state.profile?.school_id ?? null,
        school_name: currentProfileSchoolName(),
        grade: String(state.profile?.grade || "").trim(),
        gender: normalizedProfileGender(state.profile?.gender),
    };
}

// InformationEditSheet.swift: Boy / Girl / Non-binary, sent as male / female / non-binary.
const PROFILE_GENDER_OPTIONS = [
    { value: "male", label: "Boy" },
    { value: "female", label: "Girl" },
    { value: "non-binary", label: "Non-binary" },
];

function normalizedProfileGender(value) {
    const gender = String(value || "").trim().toLowerCase();
    if (gender === "boy" || gender === "male") return "male";
    if (gender === "girl" || gender === "female") return "female";
    if (["non-binary", "nonbinary", "nb"].includes(gender)) return "non-binary";
    return "";
}

function profileGenderLabel(value) {
    return PROFILE_GENDER_OPTIONS.find((option) => option.value === normalizedProfileGender(value))?.label || "Choose your gender";
}

function profileGenderIsValid(draft = state.profileDraft) {
    return PROFILE_GENDER_OPTIONS.some((option) => option.value === draft?.gender);
}

function renderProfileGenderOptions() {
    const selected = state.profileDraft?.gender || "";
    $$("[data-profile-gender]").forEach((option) => {
        const isSelected = option.dataset.profileGender === selected;
        option.classList.toggle("selected", isSelected);
        option.setAttribute("aria-checked", String(isSelected));
    });
    $('[data-profile-done="gender"]').disabled = !profileGenderIsValid();
}

function profileNameIsValid(draft = state.profileDraft) {
    const validPart = (value) => value.length >= 2 && /^[\p{L}' -]+$/u.test(value);
    return Boolean(draft && validPart(draft.first_name) && validPart(draft.last_name));
}

function profileUsernameIsValid(draft = state.profileDraft) {
    return /^[a-z0-9_]{3,30}$/.test(draft?.username || "");
}

function availableProfileGrades() {
    const school = state.profileDraft || {};
    const minGrade = Number.isFinite(Number(school.min_grade)) ? Number(school.min_grade) : 6;
    const maxGrade = Number.isFinite(Number(school.max_grade)) ? Number(school.max_grade) : 12;
    const available = signupGradeCatalog.filter(({ gradeNumber }) => gradeNumber >= minGrade && gradeNumber <= maxGrade);
    return available.length ? available : signupGradeCatalog;
}

function profileGradeIsValid() {
    return availableProfileGrades().some(({ name }) => name === state.profileDraft?.grade);
}

function profileChangeFlags() {
    const original = profileOriginalInformation();
    const draft = state.profileDraft || original;
    return {
        username: draft.username !== original.username,
        name: draft.first_name !== original.first_name || draft.last_name !== original.last_name,
        school: String(draft.school_id ?? "") !== String(original.school_id ?? ""),
        grade: draft.grade !== original.grade,
        gender: draft.gender !== original.gender,
    };
}

function profileChangedFieldCount() {
    return Object.values(profileChangeFlags()).filter(Boolean).length;
}

function profileDraftIsValid() {
    const draft = state.profileDraft;
    const usernameChecked = !profileChangeFlags().username || state.profileCheckedUsername === draft?.username;
    return Boolean(
        state.profile?.can_change_information !== false
        && profileChangedFieldCount()
        && profileNameIsValid(draft)
        && profileUsernameIsValid(draft)
        && usernameChecked
        && draft?.school_id != null
        && profileGradeIsValid()
        && profileGenderIsValid(draft)
    );
}

function setProfileBadge(element, changed, needsAttention) {
    element.textContent = changed ? "Changed" : (needsAttention ? "Needs attention" : "");
    element.className = changed ? "changed" : (needsAttention ? "attention" : "");
}

function syncProfileDraftFromInputs() {
    if (!state.profileDraft) return;
    state.profileDraft.first_name = $("#profileFirstName").value.trim();
    state.profileDraft.last_name = $("#profileLastName").value.trim();
    state.profileDraft.username = $("#profileUsername").value.trim().toLowerCase();
}

function renderProfileEditorHub() {
    syncProfileDraftFromInputs();
    const draft = state.profileDraft;
    const flags = profileChangeFlags();
    const informationLocked = state.profile?.can_change_information === false;
    $("#profileUsernameValue").textContent = `@${draft.username}`;
    $("#profileNameValue").textContent = `${draft.first_name} ${draft.last_name}`.trim() || "Add your name";
    $("#profileSchoolValue").textContent = draft.school_name || "Choose your school";
    $("#profileGradeValue").textContent = draft.grade || "Choose your grade";
    $("#profileGenderValue").textContent = profileGenderLabel(draft.gender);
    setProfileBadge($("#profileUsernameBadge"), flags.username, !profileUsernameIsValid(draft) || (flags.username && state.profileCheckedUsername !== draft.username));
    setProfileBadge($("#profileNameBadge"), flags.name, !profileNameIsValid(draft));
    setProfileBadge($("#profileSchoolBadge"), flags.school, draft.school_id == null);
    setProfileBadge($("#profileGradeBadge"), flags.grade, !profileGradeIsValid());
    setProfileBadge($("#profileGenderBadge"), flags.gender, !profileGenderIsValid(draft));
    $$('[data-profile-editor]').forEach((button) => { button.disabled = informationLocked; });
    const changeCount = profileChangedFieldCount();
    $("#profileReviewButton").textContent = changeCount === 1 ? "Review 1 change" : `Review ${changeCount} changes`;
    $("#profileReviewButton").disabled = !profileDraftIsValid();
    $("#deleteAccountButton").classList.toggle("hidden", state.config?.enable_delete_account === false);
    renderGodModeManageEntry();
    // "Oct 20, 2026", as InformationEditSheet's .abbreviated date.
    const nextChange = new Date(state.profile?.next_information_change_at || "");
    const lockedMessage = Number.isNaN(nextChange.getTime())
        ? "Username, name, school, grade, and gender are currently unavailable."
        : `Username, name, school, grade, and gender will be available again ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(nextChange)}.`;
    $("#profileEditHint").innerHTML = informationLocked
        ? `<strong>Profile changes are temporarily locked</strong><span>${escapeHTML(lockedMessage)}</span>`
        : "<strong>Profile changes are available every 14 days</strong><span>Change any combination below. Nothing is saved until you review and confirm everything.</span>";
}

// GodModeSubscriptionRow.swift, for web (Stripe) billing: a failed payment
// shows the full "Payment failed — update your card" row; a healthy
// subscription a quiet "Manage God Mode" (the plan sheet); one set to cancel
// "God Mode ends Oct 8".
function godModeEndsAt() {
    if (state.godModeCancellation?.cancel_at_period_end !== true) return null;
    return state.godModeCancellation.subscription_expires_at || state.godModeCancellation.expires_at || null;
}

function renderGodModeManageEntry() {
    const needsPayment = godModeNeedsPaymentUpdate();
    $("#godModeBillingRow").classList.toggle("hidden", !needsPayment);
    const button = $("#godModeUnsubscribeButton");
    const cancelling = state.godModeCancellation?.cancel_at_period_end === true;
    button.classList.toggle("hidden", needsPayment || !hasStripeGodMode());
    button.disabled = cancelling;
    const endsAt = formatBillingShortDate(godModeEndsAt());
    $("#godModeUnsubscribeLabel").textContent = cancelling
        ? (endsAt ? `God Mode ends ${endsAt}` : "Won\u2019t renew")
        : "Manage God Mode";
}

// GodModePlan.statusLine: "Renews Oct 15 · on the web" while Stripe says it
// renews, "Active through Oct 15 · on the web" otherwise.
function godModePlanStatusLine() {
    const billing = state.godModeBilling;
    const date = formatBillingShortDate(billing?.expiresAt || api.user?.subscription_expires_at);
    const renews = ["active", "trialing"].includes(billing?.stripeStatus || "") && billing?.cancelAtPeriodEnd !== true;
    const stateLine = date ? (renews ? `Renews ${date}` : `Active through ${date}`) : "Active";
    return `${stateLine} \u00b7 on the web`;
}

function openGodModePlan() {
    if (!hasStripeGodMode() || state.godModeCancellation?.cancel_at_period_end === true) return;
    $("#godModePlanStatus").textContent = godModePlanStatusLine();
    const unsubscribe = $("#godModePlanUnsubscribe");
    unsubscribe.disabled = false;
    unsubscribe.removeAttribute("aria-busy");
    $("#godModePlanDialog").showModal();
}

async function openGodModeBillingPortal() {
    const row = $("#godModeBillingRow");
    const status = $("#profileGodModeStatus");
    if (row.disabled) return;
    row.disabled = true;
    row.setAttribute("aria-busy", "true");
    status.classList.remove("is-neutral");
    status.textContent = "";
    const portalWindow = window.open("about:blank", "_blank");
    try {
        const { url } = await api.createGodModeBillingPortal(api.user.id);
        if (portalWindow) portalWindow.location.href = url;
        else window.location.href = url;
    } catch (error) {
        portalWindow?.close();
        status.textContent = friendlyErrorMessage(error, "Could not open billing. Try again.");
    } finally {
        row.disabled = false;
        row.removeAttribute("aria-busy");
    }
}

async function godModeRetentionOffer() {
    if (typeof api.getGodModeRetentionOffer !== "function") return null;
    const button = $("#godModeUnsubscribeButton");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
        return await api.getGodModeRetentionOffer(api.user.id);
    } catch {
        return null;
    } finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
    }
}

// "Oct 12", like the iOS billing copy.
function formatBillingShortDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// One free week, offered once, before the cancel goes through.
// Returns true when the subscriber kept God Mode or backed out.
async function offerGodModeFreeWeek(offer) {
    const from = formatBillingShortDate(offer.next_charge_at);
    const to = formatBillingShortDate(offer.offer_next_charge_at);
    const first = formatBillingShortDate(offer.first_reveal_at);
    const second = formatBillingShortDate(offer.second_reveal_at);
    // The free week gets no weekly refill: two reveals (day 2, day 5), each
    // only while still subscribed (granted by the server).
    // GodModeRetentionOffer.offerTerms: "Then $9.99/week. Cancel before Oct 15
    // and you'll lose your free week (God Mode ends Oct 8)."
    const terms = from && to
        ? `${offer.price_label ? `Then ${offer.price_label}. ` : ""}Cancel before ${to} and you'll lose your free week (God Mode ends ${from}).`
        : "";
    const choice = await choiceSheet({
        title: "Stay for a free week?",
        message: first && second ? "Your next week is on us, with 2 reveals." : "Your next week is on us.",
        finePrint: terms,
        confirmLabel: "Get my free week",
        secondaryLabel: "Unsubscribe anyway",
    });
    if (choice === null) return true;
    if (choice === "secondary") {
        // The offer is shown once: turning it down uses it up. Never block
        // the cancel on this.
        try { await api.declineGodModeRetentionOffer(api.user.id); } catch { /* best effort */ }
        return false;
    }
    const button = $("#godModeUnsubscribeButton");
    const status = $("#profileGodModeStatus");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    status.classList.add("is-neutral");
    status.textContent = "Adding your free week...";
    try {
        const result = await api.acceptGodModeRetentionOffer(api.user.id);
        const next = formatBillingShortDate(result.next_charge_at);
        const weekStarts = formatBillingShortDate(result.free_week_starts_at);
        const firstReveal = formatBillingShortDate(result.first_reveal_at);
        const secondReveal = formatBillingShortDate(result.second_reveal_at);
        status.textContent = weekStarts && firstReveal && secondReveal
            ? `Free week starts ${weekStarts}. Your reveals unlock ${firstReveal} and ${secondReveal}.`
            : next ? `Free week added. Your next charge is ${next}.` : "Free week added.";
        showToast("Free week of God Mode added");
    } catch (error) {
        status.classList.remove("is-neutral");
        status.textContent = friendlyErrorMessage(error, "Could not add your free week.");
    } finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
    }
    return true;
}

async function unsubscribeFromGodMode() {
    if (!hasStripeGodMode()) return;
    const offer = await godModeRetentionOffer();
    if (offer?.available === true) {
        if (await offerGodModeFreeWeek(offer)) return;
    } else {
        // Cancelling during the free week takes it back (server-enforced).
        const inFreeWeek = offer?.reason === "in_free_week";
        // Keeping is the primary action; unsubscribing stays a full,
        // clearly labeled button right below it.
        const choice = await choiceSheet({
            title: "Unsubscribe from God Mode?",
            message: inFreeWeek
                ? "You'll lose your free week."
                : "You’ll keep God Mode through the end of your current billing period, and then it won’t renew.",
            confirmLabel: "Keep God Mode",
            secondaryLabel: "Unsubscribe",
        });
        if (choice !== "secondary") return;
    }
    const button = $("#godModeUnsubscribeButton");
    const status = $("#profileGodModeStatus");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    status.classList.add("is-neutral");
    status.textContent = "Updating your God Mode subscription...";
    try {
        const result = await api.unsubscribeFromGodMode(api.user.id);
        state.godModeCancellation = result;
        const ending = formatBillingShortDate(result.subscription_expires_at);
        status.textContent = ending
            ? `Unsubscribed. God Mode ends ${ending}.`
            : "Unsubscribed. God Mode stays active through the current billing period.";
        showToast("God Mode renewal canceled");
        renderProfileEditorHub();
    } catch (error) {
        status.classList.remove("is-neutral");
        status.textContent = friendlyErrorMessage(error, "Could not unsubscribe from God Mode.");
        button.disabled = false;
    } finally {
        button.removeAttribute("aria-busy");
    }
}

function renderProfileGradeOptions() {
    const grades = availableProfileGrades();
    const selected = state.profileDraft?.grade || "";
    $("#profileGradeHint").textContent = state.profileDraft?.school_name
        ? `Grades available at ${state.profileDraft.school_name}`
        : "Choose a school first.";
    $("#profileGradeOptions").innerHTML = grades.map(({ name, gradeNumber }) => `<button class="signup-grade-option ${selected === name ? "selected" : ""}" type="button" role="radio" aria-checked="${selected === name}" data-profile-grade="${escapeHTML(name)}"><span><strong>${escapeHTML(name)}</strong><small>C/O ${signupGraduationYear(gradeNumber)}</small></span></button>`).join("");
    $("#profileGrade").value = selected;
    $("#profileGradeStatus").textContent = profileGradeIsValid() ? "" : "Choose a grade available at this school.";
    $('[data-profile-done="grade"]').disabled = !profileGradeIsValid();
}

function renderProfileSchoolResults() {
    const query = $("#profileSchoolSearch").value.trim().toLowerCase();
    const schools = state.profileNearbySchools.filter((school) => `${school.name} ${school.city || ""} ${school.state || ""}`.toLowerCase().includes(query));
    const container = $("#profileSchoolResults");
    if (!schools.length) {
        container.innerHTML = `<p class="signup-school-empty">No nearby schools match that search.</p>`;
        return;
    }
    container.innerHTML = schools.map((school) => {
        const selected = String(state.profileDraft?.school_id) === String(school.id);
        const logoURL = school.logo_url ? api.assetURL(school.logo_url) : "";
        const initials = String(school.name || "S").split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
        return `<button class="signup-school-result ${selected ? "selected" : ""}" type="button" role="option" aria-selected="${selected}" data-profile-school="${escapeHTML(school.id)}">
            <span class="signup-school-logo">${logoURL ? mediaImageMarkup(logoURL, { initials }) : escapeHTML(initials)}</span>
            <span><strong>${escapeHTML(school.name)}</strong><small>${escapeHTML(schoolLocationLabel(school))}${Number.isFinite(Number(school.distance_miles)) ? ` · ${Number(school.distance_miles).toFixed(1)} mi` : ""}</small></span>
            <span class="signup-school-check" aria-hidden="true">${selected ? "✓" : "›"}</span>
        </button>`;
    }).join("");
}

async function lookupProfileSchools() {
    const zipCode = $("#profileSchoolZip").value.replace(/\D/g, "").slice(0, 5);
    $("#profileSchoolZip").value = zipCode;
    if (!/^\d{5}$/.test(zipCode)) {
        $("#profileSchoolStatus").textContent = "Enter a 5-digit ZIP code.";
        return;
    }
    const generation = ++state.profileSchoolLookupGeneration;
    const button = $("#profileSchoolLookup");
    setButtonLoading(button, true, "Finding schools...");
    $("#profileSchoolStatus").textContent = "";
    try {
        const response = await api.getNearbySchools(zipCode, 50);
        if (generation !== state.profileSchoolLookupGeneration) return;
        state.profileNearbySchools = response.schools || [];
        $("#profileSchoolSearch").value = "";
        $("#profileSchoolPicker").classList.remove("hidden");
        $("#profileSchoolFallback").classList.add("hidden");
        renderProfileSchoolResults();
        $("#profileSchoolStatus").textContent = state.profileNearbySchools.length
            ? `Showing ${state.profileNearbySchools.length} schools near ${zipCode}.`
            : "No schools were found near that ZIP code.";
    } catch (error) {
        if (generation !== state.profileSchoolLookupGeneration) return;
        $("#profileSchoolStatus").textContent = userMessage(error, "Couldn't load nearby schools.");
    } finally { setButtonLoading(button, false); }
}

function selectProfileSchool(school) {
    if (!school || !state.profileDraft) return;
    state.profileDraft.school_id = school.id;
    state.profileDraft.school_name = school.name || "";
    state.profileDraft.min_grade = school.min_grade;
    state.profileDraft.max_grade = school.max_grade;
    if (!profileGradeIsValid()) state.profileDraft.grade = "";
    setProfileEditor("hub");
}

async function requestProfileSchool() {
    const schoolName = $("#profileSchoolName").value.trim();
    const city = $("#profileSchoolCity").value.trim();
    const schoolState = $("#profileSchoolState").value.trim().toUpperCase();
    if (!schoolName || !city || !/^[A-Z]{2}$/.test(schoolState)) {
        $("#profileSchoolStatus").textContent = "Enter the school name, city, and 2-letter state.";
        return;
    }
    const button = $("#profileRequestSchool");
    setButtonLoading(button, true, "Checking school...");
    try {
        const response = await api.resolveSchool({ school_name: schoolName, city, state: schoolState });
        selectProfileSchool(response.school);
    } catch (error) {
        $("#profileSchoolStatus").textContent = userMessage(error, "Could not use that school.");
    } finally { setButtonLoading(button, false); }
}

function renderProfileReview() {
    syncProfileDraftFromInputs();
    const original = profileOriginalInformation();
    const draft = state.profileDraft;
    const flags = profileChangeFlags();
    const rows = [];
    const addRow = (title, oldValue, newValue) => rows.push(`<article class="profile-review-row"><small>${escapeHTML(title)}</small><span>${escapeHTML(oldValue || "Not set")}</span><i aria-hidden="true">↓</i><strong>${escapeHTML(newValue)}</strong></article>`);
    if (flags.name) addRow("Name", `${original.first_name} ${original.last_name}`.trim(), `${draft.first_name} ${draft.last_name}`.trim());
    if (flags.username) addRow("Username", `@${original.username}`, `@${draft.username}`);
    if (flags.school) addRow("School", original.school_name, draft.school_name);
    if (flags.grade) addRow("Grade", original.grade, draft.grade);
    if (flags.gender) addRow("Gender", profileGenderLabel(original.gender), profileGenderLabel(draft.gender));
    $("#profileReviewRows").innerHTML = rows.join("");
    $("#profileSchoolChangeNote").classList.toggle("hidden", !flags.school);
    $("#profileInformationConfirmStatus").textContent = "";
}

function setProfileEditor(editor) {
    if (!state.profileDraft) return;
    syncProfileDraftFromInputs();
    state.profileEditor = editor;
    $$('[data-profile-panel]').forEach((panel) => panel.classList.toggle("hidden", panel.dataset.profilePanel !== editor));
    const titles = { hub: "Correct profile information", username: "Username", name: "Name", school: "School", grade: "Grade", gender: "Gender", review: "Review changes" };
    $("#profileEditorTitle").textContent = titles[editor] || titles.hub;
    $("#profileEditorBack").classList.toggle("hidden", editor === "hub");
    $("#profileEditorCancel").classList.toggle("hidden", editor !== "hub");
    if (editor === "hub") renderProfileEditorHub();
    if (editor === "grade") renderProfileGradeOptions();
    if (editor === "gender") renderProfileGenderOptions();
    if (editor === "review") renderProfileReview();
    const focusByEditor = { username: "#profileUsername", name: "#profileFirstName", school: "#profileSchoolZip" };
    requestAnimationFrame(() => $(focusByEditor[editor])?.focus({ preventScroll: true }));
}

function openProfileDialog() {
    const original = profileOriginalInformation();
    state.profileDraft = { ...original, min_grade: null, max_grade: null };
    state.profileNearbySchools = [];
    state.profileCheckedUsername = original.username;
    state.pendingProfileInformation = null;
    $("#profileFirstName").value = original.first_name;
    $("#profileLastName").value = original.last_name;
    $("#profileUsername").value = original.username;
    $("#profileGrade").value = original.grade;
    $("#profileSchoolZip").value = "";
    $("#profileSchoolSearch").value = "";
    $("#profileSchoolPicker").classList.add("hidden");
    $("#profileSchoolFallback").classList.add("hidden");
    $("#profileEditStatus").textContent = "";
    $(".profile-name-hint").classList.remove("invalid");
    $("#profileGodModeStatus").textContent = "";
    $("#profileGodModeStatus").classList.remove("is-neutral");
    setProfileEditor("hub");
    $("#profileDialog").showModal();
    void refreshGodModeBilling();
}

async function cancelProfileEditor() {
    if (profileChangedFieldCount() && !await confirmSheet({
        title: "Discard your changes?",
        message: "Your profile has not been changed yet.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        destructive: true,
    })) return;
    state.profileDraft = null;
    state.pendingProfileInformation = null;
    $("#profileDialog").close();
}

async function finishProfileUsername() {
    syncProfileDraftFromInputs();
    const username = state.profileDraft.username;
    if (!profileUsernameIsValid()) {
        $("#profileUsernameStatus").textContent = "Use 3–30 lowercase letters, numbers, or underscores.";
        return;
    }
    if (!profileChangeFlags().username) {
        state.profileCheckedUsername = username;
        setProfileEditor("hub");
        return;
    }
    const button = $("#profileUsernameDone");
    setButtonLoading(button, true, "Checking...");
    $("#profileUsernameStatus").textContent = "";
    try {
        const result = await api.checkUsernameAvailability(username);
        if (!result.available) {
            $("#profileUsernameStatus").textContent = `@${username} is already taken.`;
            return;
        }
        state.profileCheckedUsername = username;
        setProfileEditor("hub");
    } catch (error) {
        $("#profileUsernameStatus").textContent = userMessage(error, "Couldn't check availability. Please try again.");
    } finally { setButtonLoading(button, false); }
}

async function saveProfile(event) {
    event.preventDefault();
    syncProfileDraftFromInputs();
    if (!profileDraftIsValid()) {
        setProfileEditor("hub");
        $("#profileEditStatus").textContent = "Finish each highlighted field before reviewing.";
        return;
    }
    const flags = profileChangeFlags();
    const draft = state.profileDraft;
    const nextInfo = {
        first_name: draft.first_name,
        last_name: draft.last_name,
        username: draft.username,
        grade: draft.grade,
        school_id: draft.school_id,
        gender: draft.gender,
    };
    state.pendingProfileInformation = { payload: nextInfo, schoolName: draft.school_name, schoolChanged: flags.school };
    const button = $("#confirmProfileInformationSave");
    setButtonLoading(button, true, "Saving...");
    $("#profileInformationConfirmStatus").textContent = "";
    try {
        const updated = await api.updateInformation(api.user.id, nextInfo);
        state.profile = { ...updated, school_name: updated.school_name || draft.school_name };
        if (flags.school) {
            state.classmateDirectory = null;
            state.classmates = [];
            state.activeClassmatesThisWeek = null;
            state.targetedBoostClassmates = null;
        }
        state.pendingProfileInformation = null;
        state.profileDraft = null;
        renderProfileHeader();
        renderProfilePanel();
        $("#profileForm").reset();
        $("#profileDialog").close();
        showToast("Profile updated");
        if (flags.school) await loadProfilePanel({ force: true });
    } catch (error) {
        $("#profileInformationConfirmStatus").textContent = userMessage(error, "Could not save all profile changes.");
    } finally { setButtonLoading(button, false); }
}

function renderBioCount() {
    const bio = $("#profileBio");
    if (bio.value.length > 160) bio.value = bio.value.slice(0, 160);
    $("#profileBioCount").textContent = `${bio.value.length}/160`;
}

function openBioDialog() {
    $("#profileBio").value = state.profile?.bio || "";
    renderBioCount();
    $("#bioEditStatus").textContent = "";
    $("#bioDialog").showModal();
}

async function saveBio(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    setButtonLoading(button, true, "Saving...");
    $("#bioEditStatus").textContent = "";
    try {
        state.profile = await api.updateBio(api.user.id, $("#profileBio").value.trim() || null);
        renderProfileHeader();
        renderProfilePanel();
        $("#bioDialog").close();
        showToast("Bio updated");
    } catch (error) {
        $("#bioEditStatus").textContent = userMessage(error, "Could not update your bio.");
    } finally { setButtonLoading(button, false); }
}

function feedbackHistoryDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    });
}

function renderFeedbackHistory() {
    const list = $("#feedbackHistoryList");
    const status = $("#feedbackHistoryStatus");
    const history = Array.isArray(state.feedbackHistory) ? state.feedbackHistory : [];
    const highlighted = history.find((item) => String(item.id) === String(state.highlightedFeedbackId));
    const visible = history.slice(0, 20);
    if (highlighted && !visible.includes(highlighted)) visible[visible.length ? visible.length - 1 : 0] = highlighted;
    if (!visible.length) {
        list.replaceChildren();
        status.textContent = "No feedback or team replies yet.";
        return;
    }
    status.textContent = "";
    list.innerHTML = visible.map((item) => {
        const responses = Array.isArray(item.responses) ? item.responses.slice(-5) : [];
        const isTarget = String(item.id) === String(state.highlightedFeedbackId);
        const label = item.notice_type === "question_report_moderation"
            ? `${item.report_subject_type === "profile" ? "Profile" : "Question"} report update`
            : "Your feedback";
        const responseMarkup = responses.length
            ? responses.map((response) => `<div class="feedback-team-response"><strong class="valid-team-label">${uiIcon("seal-check")}Valid team</strong><p>${escapeHTML(response.response_text || "")}</p><time datetime="${escapeHTML(response.created_at || "")}">${escapeHTML(feedbackHistoryDate(response.created_at))}</time></div>`).join("")
            : `<p class="form-hint">No team reply yet.</p>`;
        return `<article class="feedback-history-card ${isTarget ? "notification-target" : ""}" data-feedback-history="${escapeHTML(item.id)}" tabindex="-1"><header><strong>${escapeHTML(label)}</strong><time datetime="${escapeHTML(item.created_at || "")}">${escapeHTML(feedbackHistoryDate(item.created_at))}</time></header><p>${escapeHTML(item.feedback_text || "")}</p>${responseMarkup}</article>`;
    }).join("");
    if (highlighted) requestAnimationFrame(() => {
        const target = list.querySelector(`[data-feedback-history="${CSS.escape(String(highlighted.id))}"]`);
        target?.scrollIntoView({ block: "nearest" });
        target?.focus({ preventScroll: true });
    });
}

async function openFeedbackDialog(feedbackId = null) {
    const form = $("#feedbackForm");
    form.reset();
    $("#feedbackStatus").textContent = "";
    state.highlightedFeedbackId = feedbackId;
    const generation = ++state.feedbackHistoryGeneration;
    $("#feedbackHistoryStatus").textContent = "Loading your feedback…";
    $("#feedbackHistoryList").replaceChildren();
    $("#feedbackDialog").showModal();
    try {
        const payload = await api.getFeedbackHistory(feedbackId);
        if (generation !== state.feedbackHistoryGeneration) return;
        state.feedbackHistory = Array.isArray(payload?.feedback) ? payload.feedback : [];
        renderFeedbackHistory();
    } catch (error) {
        if (generation !== state.feedbackHistoryGeneration) return;
        $("#feedbackHistoryStatus").textContent = friendlyErrorMessage(error, "Could not load your feedback history.");
    }
    if (!feedbackId) requestAnimationFrame(() => $("#feedbackText").focus());
}

async function submitFeedback(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const text = $("#feedbackText").value.trim();
    const photo = $("#feedbackPhoto").files[0] || null;
    const status = $("#feedbackStatus");
    if (text.length < 3) {
        status.textContent = "Please add a little more detail.";
        return;
    }
    if (photo && photo.size > 5 * 1024 * 1024) {
        status.textContent = "Screenshots must be 5 MB or smaller.";
        return;
    }
    const button = $("#feedbackSubmitButton");
    setButtonLoading(button, true, "Sending...");
    status.textContent = "";
    try {
        await api.submitFeedback(text, photo);
        $("#feedbackDialog").close();
        form.reset();
        $("#feedbackPhotoName").textContent = "No screenshot selected";
        showToast("Thanks — feedback sent");
    } catch (error) {
        status.textContent = userMessage(error, "Could not send your feedback.");
    } finally {
        setButtonLoading(button, false);
    }
}

// Profile photos go through the iOS circle crop and upload format (≤1024 px JPEG
// 0.82), so large camera photos no longer hit a 5 MB wall. The new photo shows
// at once with an uploading state, and a failed upload stays retryable.
async function cropProfilePhoto(file, options = {}) {
    try {
        const { cropAvatar } = await import("./avatar-crop.js");
        return await cropAvatar(file, options);
    } catch (error) {
        showToast(userMessage(error, "That photo could not be opened. Choose a JPEG or PNG."));
        return null;
    }
}

function setPendingProfilePhoto(next) {
    if (state.pendingProfilePhoto?.url && state.pendingProfilePhoto.url !== next?.url) URL.revokeObjectURL(state.pendingProfilePhoto.url);
    state.pendingProfilePhoto = next;
    renderProfilePanel();
}

async function uploadProfilePhoto(file) {
    const pending = { file, url: state.pendingProfilePhoto?.file === file ? state.pendingProfilePhoto.url : URL.createObjectURL(file), status: "uploading" };
    setPendingProfilePhoto(pending);
    try {
        await api.uploadProfilePicture(api.user.id, file);
        await refreshProfile();
        if (state.pendingProfilePhoto === pending) setPendingProfilePhoto(null);
        successHaptic();
        showToast("Profile photo updated");
    } catch (error) {
        if (state.pendingProfilePhoto !== pending) return;
        setPendingProfilePhoto({ ...pending, status: "failed" });
        showToast(userMessage(error, "Couldn't upload your photo. Tap it to try again."));
    }
}

async function changeProfilePicture(event) {
    const input = event.currentTarget;
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    // SettingsView's circle cropper strings.
    const cropped = await cropProfilePhoto(file, { title: "Choose your profile photo", instructions: "Pinch to zoom and drag to frame your photo." });
    if (cropped) await uploadProfilePhoto(cropped);
}

function questionSubmissionCost() {
    return Math.max(0, Number(state.config?.question_submission_aura_cost ?? 200));
}

function questionDraftFingerprint() {
    const image = state.questionArtworkFile || $("#questionImage").files[0];
    return JSON.stringify({
        text: $("#questionText").value.trim(),
        identity: $("input[name=questionIdentity]:checked")?.value,
        image: image ? [image.name, image.size, image.lastModified] : null,
    });
}

function updateQuestionSubmissionUI() {
    const cost = questionSubmissionCost();
    const aura = Math.max(0, Number(state.profile?.aura_points || 0));
    $("#questionAuraCost").textContent = cost.toLocaleString();
    $("#questionCurrentAura").textContent = aura.toLocaleString();
    $("#questionConfirmCost").textContent = cost.toLocaleString();
    $("#questionConfirmRemaining").textContent = Math.max(0, aura - cost).toLocaleString();
    $("#confirmQuestionSubmit").textContent = `Spend ${cost.toLocaleString()} aura`;
    const submitButton = $("#questionSubmitButton");
    submitButton.textContent = state.pendingQuestionSubmissionKey ? "Check submission" : "Submit for review";
    submitButton.disabled = !state.pendingQuestionSubmissionKey && (
        $("#questionText").value.trim().length < 3
        || !state.questionArtworkFile
        || state.questionArtworkProcessing
        || !$("#questionPermission").checked
        || aura < cost
    );
}

function resetQuestionSubmissionIfDraftChanged() {
    if (state.pendingQuestionSubmissionKey && questionDraftFingerprint() !== state.pendingQuestionDraft) {
        state.pendingQuestionSubmissionKey = null;
        state.pendingQuestionDraft = null;
        $("#questionStatus").textContent = "";
    }
    updateQuestionSubmissionUI();
}

function resetQuestionArtworkPreview() {
    if (state.questionArtworkPreviewURL?.startsWith("blob:")) URL.revokeObjectURL(state.questionArtworkPreviewURL);
    state.questionArtworkPreviewURL = null;
    state.questionArtworkFile = null;
    state.questionArtworkSourceFile = null;
    state.questionArtworkProcessing = false;
    $("#questionImagePreview").innerHTML = `<span class="question-image-placeholder"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"></rect><circle cx="9" cy="10" r="2"></circle><path d="m5.5 17 4.5-4 3 2.5 2.5-2 3 3.5"></path></svg><strong>Tap to add an image</strong><small>Square artwork works best.</small></span>`;
    $("#adjustQuestionCrop").classList.add("hidden");
    $(".question-image-change").textContent = "Choose image";
}

function readFileDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(reader.result), { once: true });
        reader.addEventListener("error", () => reject(reader.error || new Error("Could not preview image.")), { once: true });
        reader.readAsDataURL(file);
    });
}

async function loadLocalImage(file) {
    const sourceURL = await readFileDataURL(file);
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.addEventListener("load", () => resolve({ image, sourceURL }), { once: true });
        image.addEventListener("error", () => reject(new Error("decode-failed")), { once: true });
        image.src = sourceURL;
    });
}

function clearQuestionCrop() {
    state.questionCrop = null;
    $("#questionCropImage").removeAttribute("src");
    const dialog = $("#questionCropDialog");
    if (dialog.open) dialog.close();
}

function questionCropLayout() {
    const crop = state.questionCrop;
    const viewportSize = $("#questionCropViewport").clientWidth;
    if (!crop || !viewportSize) return null;
    const aspect = crop.sourceWidth / crop.sourceHeight;
    const baseWidth = aspect >= 1 ? viewportSize * aspect : viewportSize;
    const baseHeight = aspect >= 1 ? viewportSize : viewportSize / aspect;
    const zoom = Math.max(1, Math.min(4, crop.zoom));
    const maxOffsetX = Math.max(0, (baseWidth * zoom - viewportSize) / 2);
    const maxOffsetY = Math.max(0, (baseHeight * zoom - viewportSize) / 2);
    crop.offsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, crop.offsetX));
    crop.offsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, crop.offsetY));
    return { viewportSize, baseWidth, baseHeight, zoom };
}

function renderQuestionCrop() {
    const crop = state.questionCrop;
    const layout = questionCropLayout();
    if (!crop || !layout) return;
    const image = $("#questionCropImage");
    setRuntimeStyles(image, {
        width: `${layout.baseWidth}px`,
        height: `${layout.baseHeight}px`,
        transform: `translate(-50%, -50%) translate(${crop.offsetX}px, ${crop.offsetY}px) scale(${layout.zoom})`,
    });
}

async function openQuestionArtworkCrop(file) {
    if (!file) return;
    clearQuestionCrop();
    state.questionArtworkProcessing = true;
    $("#questionStatus").textContent = "";
    updateQuestionSubmissionUI();
    let loaded = null;
    try {
        loaded = await loadLocalImage(file);
        if (!loaded.image.naturalWidth || !loaded.image.naturalHeight) throw new Error("decode-failed");
        state.questionCrop = {
            file,
            image: loaded.image,
            sourceWidth: loaded.image.naturalWidth,
            sourceHeight: loaded.image.naturalHeight,
            zoom: 1,
            offsetX: 0,
            offsetY: 0,
            pointerId: null,
            lastPointerX: 0,
            lastPointerY: 0,
            hadArtwork: Boolean(state.questionArtworkFile),
        };
        $("#questionCropImage").src = loaded.sourceURL;
        $("#questionCropZoom").value = "1";
        $("#questionCropDialog").showModal();
        requestAnimationFrame(renderQuestionCrop);
    } catch (_) {
        state.questionArtworkProcessing = false;
        if (!state.questionArtworkFile) {
            $("#questionImage").value = "";
            resetQuestionArtworkPreview();
        }
        $("#questionStatus").textContent = /hei[cf]/i.test(`${file.type} ${file.name}`)
            ? "This photo is HEIC; choose a JPEG/PNG or change the camera format."
            : "That photo format could not be decoded by this browser. Choose a JPEG or PNG, or export the photo as Most Compatible.";
        updateQuestionSubmissionUI();
    }
}

function cancelQuestionArtworkCrop() {
    const hadArtwork = state.questionCrop?.hadArtwork;
    clearQuestionCrop();
    state.questionArtworkProcessing = false;
    if (!hadArtwork) {
        $("#questionImage").value = "";
        resetQuestionArtworkPreview();
    }
    updateQuestionSubmissionUI();
}

async function applyQuestionArtworkCrop() {
    const crop = state.questionCrop;
    const layout = questionCropLayout();
    if (!crop || !layout) return;
    const button = $("#applyQuestionCrop");
    setButtonLoading(button, true, "Working...");
    try {
        const sourceCropSize = Math.min(crop.sourceWidth, crop.sourceHeight) / layout.zoom;
        const sourcePixelsPerViewportPixel = sourceCropSize / layout.viewportSize;
        const sourceX = Math.max(0, Math.min(
            crop.sourceWidth - sourceCropSize,
            (crop.sourceWidth - sourceCropSize) / 2 - crop.offsetX * sourcePixelsPerViewportPixel,
        ));
        const sourceY = Math.max(0, Math.min(
            crop.sourceHeight - sourceCropSize,
            (crop.sourceHeight - sourceCropSize) / 2 - crop.offsetY * sourcePixelsPerViewportPixel,
        ));
        const outputSize = Math.min(1024, Math.max(1, Math.round(sourceCropSize)));
        const canvas = document.createElement("canvas");
        canvas.width = outputSize;
        canvas.height = outputSize;
        canvas.getContext("2d").drawImage(
            crop.image,
            sourceX,
            sourceY,
            sourceCropSize,
            sourceCropSize,
            0,
            0,
            outputSize,
            outputSize,
        );
        const blob = await canvasBlob(canvas, "image/jpeg", 0.9);
        const baseName = String(crop.file.name || "question-artwork").replace(/\.[^.]+$/, "");
        const croppedFile = new File([blob], `${baseName}-square.jpg`, { type: "image/jpeg", lastModified: Date.now() });
        if (state.questionArtworkPreviewURL?.startsWith("blob:")) URL.revokeObjectURL(state.questionArtworkPreviewURL);
        state.questionArtworkFile = croppedFile;
        state.questionArtworkSourceFile = crop.file;
        state.questionArtworkPreviewURL = await readFileDataURL(croppedFile);
        $("#questionImagePreview").innerHTML = `<img loading="lazy" decoding="async" src="${escapeHTML(state.questionArtworkPreviewURL)}" alt="Square crop preview">`;
        $("#adjustQuestionCrop").classList.remove("hidden");
        $(".question-image-change").textContent = "Choose another";
        clearQuestionCrop();
        resetQuestionSubmissionIfDraftChanged();
    } catch (_) {
        $("#questionStatus").textContent = "Could not crop that photo. Try another image.";
    } finally {
        state.questionArtworkProcessing = false;
        setButtonLoading(button, false);
        updateQuestionSubmissionUI();
    }
}

async function previewQuestionArtwork() {
    const input = $("#questionImage");
    const file = input.files[0];
    if (!file) {
        resetQuestionArtworkPreview();
        updateQuestionSubmissionUI();
        return;
    }
    if (file.size > 20 * 1024 * 1024) {
        input.value = "";
        resetQuestionArtworkPreview();
        $("#questionStatus").textContent = "Question artwork must be 20 MB or smaller before cropping.";
        updateQuestionSubmissionUI();
        return;
    }
    await openQuestionArtworkCrop(file);
}

function beginQuestionCropDrag(event) {
    const crop = state.questionCrop;
    if (!crop || event.button > 0) return;
    crop.pointerId = event.pointerId;
    crop.lastPointerX = event.clientX;
    crop.lastPointerY = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
}

function moveQuestionCrop(event) {
    const crop = state.questionCrop;
    if (!crop || crop.pointerId !== event.pointerId) return;
    crop.offsetX += event.clientX - crop.lastPointerX;
    crop.offsetY += event.clientY - crop.lastPointerY;
    crop.lastPointerX = event.clientX;
    crop.lastPointerY = event.clientY;
    renderQuestionCrop();
}

function endQuestionCropDrag(event) {
    const crop = state.questionCrop;
    if (!crop || crop.pointerId !== event.pointerId) return;
    crop.pointerId = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
}

function reviewQuestionSubmission(event) {
    event.preventDefault();
    const image = state.questionArtworkFile;
    if (!image) {
        $("#questionStatus").textContent = "Please attach artwork before submitting.";
        return;
    }
    if (image.size > 5 * 1024 * 1024) {
        $("#questionStatus").textContent = "Question artwork must be 5 MB or smaller.";
        return;
    }
    const cost = questionSubmissionCost();
    const aura = Math.max(0, Number(state.profile?.aura_points || 0));
    if (!state.pendingQuestionSubmissionKey && aura < cost) {
        $("#questionStatus").textContent = `You need ${cost.toLocaleString()} aura to submit this question.`;
        return;
    }
    if (state.pendingQuestionSubmissionKey) return confirmQuestionSubmission();
    updateQuestionSubmissionUI();
    $("#questionConfirmDialog").showModal();
}

async function confirmQuestionSubmission() {
    const form = $("#questionForm");
    const image = state.questionArtworkFile;
    if (!image) return;
    const fingerprint = questionDraftFingerprint();
    if (!state.pendingQuestionSubmissionKey || state.pendingQuestionDraft !== fingerprint) {
        state.pendingQuestionSubmissionKey = crypto.randomUUID();
        state.pendingQuestionDraft = fingerprint;
    }
    const formData = new FormData();
    formData.set("question_text", $("#questionText").value.trim());
    formData.set("include_name", String($("input[name=questionIdentity]:checked").value === "named"));
    formData.set("idempotency_key", state.pendingQuestionSubmissionKey);
    formData.set("image", image);
    $("#questionConfirmDialog").close();
    const button = $("#questionSubmitButton");
    setButtonLoading(button, true, "Submitting...");
    $("#questionStatus").textContent = "";
    try {
        const result = await api.submitQuestion(api.user.id, formData);
        clearOptimisticEarnedProfile();
        state.pendingQuestionSubmissionKey = null;
        state.pendingQuestionDraft = null;
        form.reset();
        resetQuestionArtworkPreview();
        closeDetailScreen($("#questionDialog"));
        await refreshProfile();
        showToast(result.is_duplicate ? "Already submitted · waiting for review" : "Question sent for review");
    } catch (error) {
        const definitive = error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
        if (definitive) {
            state.pendingQuestionSubmissionKey = null;
            state.pendingQuestionDraft = null;
            $("#questionStatus").textContent = userMessage(error, "Could not submit your question.");
        } else {
            $("#questionStatus").textContent = error.status === 429
                ? userMessage(error)
                : "We couldn't confirm the result. Tap “Check submission” — you won't be charged twice.";
        }
    } finally {
        setButtonLoading(button, false);
        updateQuestionSubmissionUI();
    }
}

function questionSubmissionDisplayStatus(question) {
    if (question.status === "pending") return { label: "Awaiting review", kind: "pending" };
    if (question.status === "approved" && question.question_is_active === false) return { label: "Deactivated", kind: "inactive" };
    if (question.status === "approved") return { label: "Published", kind: "approved" };
    if (question.status === "rejected") return { label: "Not approved", kind: "rejected" };
    return { label: String(question.status || "Unknown"), kind: "inactive" };
}

function clearQuestionSubmissionState() {
    state.questionSubmissionsGeneration += 1;
    state.questionSubmissions = [];
    state.questionSubmissionToRemove = null;
    state.highlightedQuestionSubmissionId = null;
    state.pendingQuestionSubmissionKey = null;
    state.pendingQuestionDraft = null;
    $("#questionHistoryList").replaceChildren();
    $("#questionHistoryStatus").textContent = "";
    $("#questionForm").reset();
    resetQuestionArtworkPreview();
    if ($("#questionRemovalDialog").open) $("#questionRemovalDialog").close();
}

function questionSubmissionDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

function questionResultsProgress(voteCount, minimumVotes) {
    const needed = Math.max(0, minimumVotes - voteCount);
    if (!voteCount) return `Results become visible after this question receives ${minimumVotes} votes.`;
    if (needed === 1) return `${voteCount} of ${minimumVotes} votes received. One more vote will reveal the results.`;
    return `${voteCount} of ${minimumVotes} votes received. ${needed} more votes will reveal the results.`;
}

function questionSubmissionStateMarkup(question) {
    if (question.status === "pending") {
        return `<div class="question-history-state pending"><strong>Waiting for review</strong><span>Your school’s moderators are reviewing it. We’ll notify you when they decide.</span></div>`;
    }
    if (question.status === "rejected") {
        const reason = String(question.rejection_reason || "").trim();
        return `<div class="question-history-state rejected"><strong>Not approved</strong><span>${escapeHTML(reason || "This question wasn’t approved for your school. It stays here so you can review the decision.")}</span></div>`;
    }
    if (question.status === "approved" && question.question_is_active === false) {
        return `<div class="question-history-state inactive"><strong>Question deactivated</strong><span>It won’t appear in future school polls. Existing votes and results are kept.</span></div>`;
    }
    return "";
}

function questionPollActivityMarkup(question) {
    if (question.status !== "approved") return "";
    const voteCount = Math.max(0, Number(question.vote_count) || 0);
    const minimumVotes = Math.max(1, Number(question.results_minimum_votes) || 5);
    const visibleResults = Array.isArray(question.vote_results) ? question.vote_results.slice(0, 5) : [];
    let content = "";
    if (question.results_visible === true) {
        content = visibleResults.length
            ? `<div class="question-result-list">${visibleResults.map((result) => `<div><span>${escapeHTML(result.name || "Classmate")}</span><strong>${Math.max(0, Number(result.vote_count) || 0).toLocaleString()} ${Number(result.vote_count) === 1 ? "vote" : "votes"}</strong></div>`).join("")}</div>`
            : `<p>Results are being prepared. Refresh to check again.</p>`;
    } else {
        content = `<progress value="${Math.min(voteCount, minimumVotes)}" max="${minimumVotes}"></progress><p>${escapeHTML(questionResultsProgress(voteCount, minimumVotes))}</p>`;
    }
    return `<section class="question-poll-activity"><div><strong>Poll activity</strong><span>${voteCount.toLocaleString()} ${voteCount === 1 ? "vote" : "votes"}</span></div>${content}</section>`;
}

function renderQuestionSubmissions({ loading = false } = {}) {
    const list = $("#questionHistoryList");
    if (loading && !state.questionSubmissions.length) {
        list.innerHTML = `<div class="question-history-empty" role="status">Loading your questions…</div>`;
        return;
    }
    if (!state.questionSubmissions.length) {
        list.innerHTML = `<div class="question-history-empty"><strong>No questions yet</strong><p>Questions you submit will appear here with their review status and results.</p><button class="mini-button" type="button" data-question-submit-empty>Submit a question</button></div>`;
        return;
    }
    list.innerHTML = state.questionSubmissions.map((question) => {
        const status = questionSubmissionDisplayStatus(question);
        const imageURL = question.image_url ? api.assetURL(question.image_url) : null;
        const canRemove = question.status === "pending" || (question.status === "approved" && question.question_is_active !== false);
        const removalLabel = question.status === "approved" ? "Deactivate question" : "Delete submission";
        return `<article class="question-history-card" data-question-submission="${escapeHTML(question.id)}" tabindex="-1">
            <header><span class="question-history-badge ${status.kind}">${escapeHTML(status.label)}</span><time datetime="${escapeHTML(question.submitted_at || "")}">Submitted ${escapeHTML(questionSubmissionDate(question.submitted_at))}</time></header>
            <div class="question-history-summary">${imageURL ? mediaImageMarkup(imageURL) : `<span class="question-history-image-placeholder" aria-hidden="true">▧</span>`}<div><strong>${escapeHTML(question.question_text || "Question")}</strong><small>${question.is_anonymous ? "Posted anonymously" : "Posted with your name"}</small></div></div>
            ${questionSubmissionStateMarkup(question)}
            ${questionPollActivityMarkup(question)}
            ${canRemove ? `<button class="question-history-remove" type="button" data-remove-question-submission="${escapeHTML(question.id)}">${escapeHTML(removalLabel)}</button>` : ""}
        </article>`;
    }).join("");
}

function focusQuestionSubmission(submissionId) {
    if (!submissionId) return;
    const card = [...$$("[data-question-submission]")].find((item) => item.dataset.questionSubmission === String(submissionId));
    if (!card) return;
    card.classList.add("notification-target");
    card.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    card.focus({ preventScroll: true });
}

async function loadQuestionSubmissions({ submissionId = state.highlightedQuestionSubmissionId } = {}) {
    const generation = ++state.questionSubmissionsGeneration;
    state.highlightedQuestionSubmissionId = submissionId || null;
    $("#questionHistoryStatus").textContent = "";
    renderQuestionSubmissions({ loading: true });
    try {
        const result = await api.getQuestionSubmissions(api.user.id, 100);
        if (generation !== state.questionSubmissionsGeneration) return;
        state.questionSubmissions = Array.isArray(result) ? result.slice(0, 100) : [];
        renderQuestionSubmissions();
        requestAnimationFrame(() => focusQuestionSubmission(state.highlightedQuestionSubmissionId));
    } catch (error) {
        if (generation !== state.questionSubmissionsGeneration) return;
        if (!state.questionSubmissions.length) renderQuestionSubmissions();
        $("#questionHistoryStatus").textContent = userMessage(error, "Could not load your questions. Try again.");
    }
}

function setQuestionSection(section, { submissionId = null, refresh = false } = {}) {
    const historySelected = section === "history";
    $("#questionSubmitTab").classList.toggle("active", !historySelected);
    $("#questionSubmitTab").setAttribute("aria-selected", String(!historySelected));
    $("#questionHistoryTab").classList.toggle("active", historySelected);
    $("#questionHistoryTab").setAttribute("aria-selected", String(historySelected));
    $("#questionForm").classList.toggle("hidden", historySelected);
    $("#questionHistoryPanel").classList.toggle("hidden", !historySelected);
    if (historySelected) {
        state.highlightedQuestionSubmissionId = submissionId || null;
        if (refresh || !state.questionSubmissions.length || submissionId) void loadQuestionSubmissions({ submissionId });
        else requestAnimationFrame(() => focusQuestionSubmission(submissionId));
    }
}

function openQuestionRemoval(submissionId) {
    const question = state.questionSubmissions.find((item) => String(item.id) === String(submissionId));
    if (!question) return;
    const approved = question.status === "approved";
    state.questionSubmissionToRemove = question;
    $("#questionRemovalTitle").textContent = approved ? "Deactivate question?" : "Delete submission?";
    $("#questionRemovalMessage").textContent = approved
        ? "This stops the question from appearing in future school polls. Existing polls, votes, and results will stay."
        : "This removes the submission from review and refunds the aura you spent.";
    $("#confirmQuestionRemoval").textContent = approved ? "Deactivate question" : "Delete submission";
    $("#questionRemovalStatus").textContent = "";
    $("#questionRemovalDialog").showModal();
}

async function confirmQuestionRemoval() {
    const question = state.questionSubmissionToRemove;
    if (!question) return;
    const button = $("#confirmQuestionRemoval");
    const approved = question.status === "approved";
    setButtonLoading(button, true, approved ? "Deactivating…" : "Deleting…");
    $("#questionRemovalStatus").textContent = "";
    try {
        const result = await api.deleteQuestionSubmission(api.user.id, question.id);
        if (result.question_removed_from_school) await loadQuestionSubmissions({ submissionId: question.id });
        else {
            state.questionSubmissions = state.questionSubmissions.filter((item) => String(item.id) !== String(question.id));
            renderQuestionSubmissions();
        }
        if (Number(result.aura_refunded) > 0) await refreshProfile();
        $("#questionRemovalDialog").close();
        $("#questionHistoryStatus").textContent = `${result.message || (approved ? "Question deactivated." : "Submission deleted.")}${Number(result.aura_refunded) > 0 ? ` ${Number(result.aura_refunded).toLocaleString()} aura refunded.` : ""}`;
        state.questionSubmissionToRemove = null;
    } catch (error) {
        $("#questionRemovalStatus").textContent = userMessage(error, approved ? "Could not deactivate that question." : "Could not delete that submission.");
    } finally {
        setButtonLoading(button, false);
        button.textContent = approved ? "Deactivate question" : "Delete submission";
    }
}

function openQuestionDialog({ section = "submit", submissionId = null } = {}) {
    $("#questionStatus").textContent = "";
    const maxLength = Math.max(3, Number(state.config?.max_custom_question_length ?? 280));
    $("#questionText").maxLength = maxLength;
    if (!state.questionArtworkFile) resetQuestionArtworkPreview();
    updateQuestionSubmissionUI();
    setQuestionSection(section, { submissionId, refresh: section === "history" });
    $("#questionDialog .question-submission-scroll").scrollTop = 0;
    openDetailScreen($("#questionDialog"));
}

function resetSignupPhotoPreview() {
    if (state.signupPhotoURL) URL.revokeObjectURL(state.signupPhotoURL);
    state.signupPhotoURL = null;
    state.signupPhotoFile = null;
    $("#signupPhotoPreview").innerHTML = `<span class="signup-photo-placeholder"><span class="signup-photo-person-icon"></span><small>Tap to add photo</small></span>`;
}

async function previewSignupPhoto() {
    const input = $("#signupPicture");
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    const cropped = await cropProfilePhoto(file);
    if (!cropped) return;
    if (state.signupPhotoURL) URL.revokeObjectURL(state.signupPhotoURL);
    state.signupPhotoFile = cropped;
    state.signupPhotoURL = URL.createObjectURL(cropped);
    $("#signupPhotoPreview").innerHTML = `<img decoding="async" src="${escapeHTML(state.signupPhotoURL)}" alt="">`;
}

function contactsPickerSupported() {
    if (demoMode && window.__demoNoContactPicker) return false;
    return demoMode || Boolean(navigator.contacts?.select);
}

function isAndroidDevice() {
    return navigator.userAgentData?.platform === "Android" || /Android/i.test(navigator.userAgent);
}

function renderInviteRewardCard() {
    const card = $("#inviteRewardCard");
    const status = state.inviteStatus;
    if (!status) {
        card.classList.add("hidden");
        return;
    }
    const goal = Math.max(1, Number(status.aura_reward_goal || 1));
    const progress = Math.max(0, Math.min(goal, Number(status.aura_reward_progress || 0)));
    const remaining = Math.max(0, Number(status.remaining || 0));
    card.innerHTML = `<div><span class="eyebrow">INVITE REWARDS</span><strong>${status.aura_reward_max_reached ? "Reward complete" : `Get ${goal} friends to join · +${Number(status.aura_reward_amount || 0).toLocaleString()} aura`}</strong></div>
        <progress class="invite-reward-progress" max="${goal}" value="${progress}" aria-label="Qualifying invites"></progress>
        <small>${progress} / ${goal} qualifying · ${remaining} invite ${remaining === 1 ? "unlock" : "unlocks"} left today</small>`;
    card.classList.remove("hidden");
}

async function openClassmatesDialog({ onboarding = false } = {}) {
    if (onboarding && !isAndroidDevice()) return;
    state.contactOnboarding = onboarding;
    $("#classmatesStatus").textContent = contactsPickerSupported() ? "" : contactsPickerUnavailableMessage(onboarding);
    $("#chooseContactsButton").classList.toggle("hidden", !contactsPickerSupported());
    $("#skipContactsButton").textContent = onboarding ? "Skip for now" : "Not now";
    $("#contactInviteExtras").classList.toggle("hidden", onboarding);
    renderInviteRewardCard();
    $("#classmatesDialog").showModal();
    if (onboarding) return;
    try {
        state.inviteStatus = await api.getInviteStatus(api.user.id);
        renderInviteRewardCard();
    } catch (_) { /* Contact discovery remains usable when rewards are unavailable. */ }
}

// The Contact Picker API exists only in Chrome on Android. Other browsers get
// a reason and the invite share, never a file picker.
function contactsPickerUnavailableMessage(onboarding) {
    if (isAndroidDevice()) {
        return onboarding
            ? "Open Valid in Chrome to add friends from your contacts. You can skip this step."
            : "Open Valid in Chrome to add friends from your contacts, or share your invite.";
    }
    return onboarding
        ? "This browser can't open your contacts. You can skip this step."
        : "This browser can't open your contacts. Share your invite so friends can join you.";
}

const CONTACT_UPLOAD_CHUNK = 250;

// POST /users/{id}/contacts in chunks. A failed chunk is retried once; the
// rest still upload. Returns the rows the server accepted and the numbers that failed.
async function uploadContactChunks(userId, contacts) {
    const accepted = [];
    const failedPhones = [];
    for (let offset = 0; offset < contacts.length; offset += CONTACT_UPLOAD_CHUNK) {
        const chunk = contacts.slice(offset, offset + CONTACT_UPLOAD_CHUNK);
        let rows = null;
        for (let attempt = 0; attempt < 2 && !rows; attempt += 1) {
            try {
                rows = await api.addContacts(userId, chunk);
            } catch (error) {
                if (attempt === 1 || (error?.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429)) break;
                await new Promise((resolve) => setTimeout(resolve, demoMode ? 0 : 1000));
            }
        }
        if (Array.isArray(rows)) accepted.push(...rows);
        else failedPhones.push(...chunk.map((row) => row.phone_number));
    }
    return { accepted, failedPhones };
}

function contactSyncMessage({ synced, onValid, failed, skipped }) {
    if (!synced) {
        return failed
            ? "Your contacts didn't sync. Check your connection and try again."
            : "None of those contacts can be added. Choose friends with a US phone number.";
    }
    const parts = [`${synced} ${synced === 1 ? "contact" : "contacts"} synced.`];
    if (onValid !== null) parts.push(onValid ? `${onValid} ${onValid === 1 ? "is" : "are"} on Valid.` : "None are on Valid yet.");
    if (skipped) parts.push(`${skipped} skipped.`);
    if (failed) parts.push(`${failed} didn't sync; try again.`);
    parts.push("No messages were sent.");
    return parts.join(" ");
}

async function chooseContacts() {
    const button = $("#chooseContactsButton");
    const userId = api.user.id;
    setButtonLoading(button, true, "Opening contacts...");
    $("#classmatesStatus").textContent = "";
    try {
        const selected = demoMode
            ? (window.__demoPickedContacts || [{ name: ["Riley Demo"], tel: ["4155550111"] }, { name: ["Casey Demo"], tel: ["4155550112"] }])
            : await navigator.contacts.select(["name", "tel"], { multiple: true });
        const payload = contactUploadPayload(selected, state.config?.contact_filter_rules);
        if (!payload.contacts.length) {
            $("#classmatesStatus").textContent = selected.length ? "Choose friends with a name and a US phone number." : "No contacts selected.";
            return;
        }
        setButtonLoading(button, true, "Syncing contacts...");
        const { accepted, failedPhones } = await uploadContactChunks(userId, payload.contacts);
        let serverContacts = null;
        if (accepted.some((row) => row?.hashed_phone_number)) {
            // The upload is processed in the background; matches show up on GET.
            await new Promise((resolve) => setTimeout(resolve, demoMode ? 0 : 1200));
            serverContacts = await api.getAllContacts(userId).catch(() => null);
        }
        if (api.user?.id !== userId) return;
        const summary = summarizeContactSync({ ...payload, accepted, failedPhones, serverContacts });
        $("#classmatesStatus").textContent = contactSyncMessage(summary);
        if (Array.isArray(serverContacts)) {
            state.playContacts = serverContacts;
            rememberContactAccounts(serverContacts);
        }
        rebuildPlayPool();
        state.choicesByQuestion.clear();
        const ready = canStartPlay(state.playPool);
        if (state.contactOnboarding || (ready && summary.synced)) {
            await new Promise((resolve) => setTimeout(resolve, demoMode ? 0 : 1500));
            $("#classmatesDialog").close();
            showToast(state.contactOnboarding ? "Friends added" : "Friends are ready for Play");
            if (state.activePanel === "play" && state.playNeedsFriends && ready) {
                state.playNeedsFriends = false;
                loadPlay();
            } else if (state.activePanel === "play") renderPlay();
        }
    } catch (error) {
        if (error.name !== "AbortError") $("#classmatesStatus").textContent = userMessage(error, "Could not sync those contacts.");
    } finally {
        setButtonLoading(button, false);
    }
}

async function shareClassmateInvite() {
    const button = $("#shareClassmateInviteButton");
    setButtonLoading(button, true, "Making your invite...");
    try {
        const invite = await api.createInvite(api.user.id, "web");
        if (navigator.share) await navigator.share({ title: "Join me on Valid", text: "Join my school on Valid so we can play", url: invite.share_url });
        else {
            await navigator.clipboard.writeText(invite.share_url);
            showToast("Invite link copied");
        }
    } catch (error) {
        if (error.name !== "AbortError") $("#classmatesStatus").textContent = userMessage(error, "Could not create an invite.");
    } finally {
        setButtonLoading(button, false);
        state.inviteStatus = await api.getInviteStatus(api.user.id).catch(() => state.inviteStatus);
        renderInviteRewardCard();
    }
}

// InformationEditSheet.swift "Delete account" → SettingsView: discard pending
// edits first, warn accounts without a passkey, then confirm the 5-day deletion.
async function beginAccountDeletion() {
    if (profileChangedFieldCount() && !await confirmSheet({
        title: "Discard edits and continue?",
        message: "Your username, name, school, grade, and gender edits will not be saved.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        destructive: true,
    })) return;
    state.profileDraft = null;
    state.pendingProfileInformation = null;
    if ($("#profileDialog").open) $("#profileDialog").close();
    // SettingsView.passkeyWarningMessage(.deleteAccount): "Set Up Passkey" is the main button.
    if (accountNeedsPasskey()) {
        const choice = await choiceSheet({
            title: "Don't Lose Your Account",
            message: "You don't have a passkey. If you delete the app and lose access to this phone number during the 5-day countdown, you won't be able to recover your account. Set up a passkey first.",
            confirmLabel: "Set Up Passkey",
            secondaryLabel: "Delete Anyway",
        });
        if (choice === "confirm") return void addBackupPasskey();
        if (choice !== "secondary") return;
    }
    openDeleteAccountDialog();
}

const ACCOUNT_DELETION_GRACE_DAYS = 5;
const accountDeletionHidesKey = (userId) => `valid:account-deletion-hides-from-polls:${userId}`;

// GodModeDeletionNotice.lines: deleting never cancels a subscription.
function accountDeletionBillingNotices() {
    const billing = state.godModeBilling?.userId === api.user?.id ? state.godModeBilling : null;
    const lines = [];
    if (billing?.provider === "apple" || billing?.manage === "app_store") {
        lines.push("Deleting your account doesn't cancel your App Store subscription. Manage it in Settings > Apple Account > Subscriptions.");
    }
    const webBilling = billing?.provider === "stripe" || billing?.manage === "stripe_portal"
        || ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"].includes(billing?.stripeStatus || "");
    if (webBilling) lines.push("Deleting your account doesn't cancel your web subscription.");
    return lines;
}

function renderDeleteAccountDialog() {
    const hide = $("#deleteAccountHideFromPolls").getAttribute("aria-checked") === "true";
    const voting = $("#deleteAccountVotingLine");
    voting.textContent = hide
        ? "No one will be able to vote for you in polls, even friends who have your number saved."
        : "Once it's gone, friends who have your number saved can still vote for you in polls.";
    voting.classList.toggle("emphasis", hide);
    $("#deleteAccountHideFromPolls").classList.toggle("on", hide);
    $("#deleteAccountBillingNotices").innerHTML = accountDeletionBillingNotices().map((line) => `<p>${escapeHTML(line)}</p>`).join("");
}

function openDeleteAccountDialog() {
    $("#deleteAccountForm").reset();
    // Off by default: hiding is opt-in (DeleteAccountModal.hideFromPollsByDefault).
    $("#deleteAccountHideFromPolls").setAttribute("aria-checked", "false");
    $("#deleteAccountStatus").textContent = "";
    renderDeleteAccountDialog();
    $("#deleteAccountDialog").showModal();
    // The billing lines arrive with the billing status.
    void refreshGodModeBilling().then(() => {
        if ($("#deleteAccountDialog").open) renderDeleteAccountDialog();
    });
}

// SettingsViewModel.requestAccountDeletion: the account stays signed in and
// the countdown screen takes over.
async function requestAccountDeletion(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    const hideFromPolls = $("#deleteAccountHideFromPolls").getAttribute("aria-checked") === "true";
    setButtonLoading(button, true, "Scheduling...");
    $("#deleteAccountStatus").textContent = "";
    let result;
    try {
        result = await api.requestAccountDeletion(api.user.id, { hideFromPolls });
    } catch (error) {
        setButtonLoading(button, false);
        $("#deleteAccountStatus").textContent = hideFromPolls
            ? "We couldn't delete your account or hide your number. Nothing changed. Please try again."
            : "We couldn't schedule deletion. Please try again.";
        return;
    }
    setButtonLoading(button, false);
    const hidden = result?.hidden_from_polls === true;
    try { localStorage.setItem(accountDeletionHidesKey(api.user.id), hidden ? "1" : "0"); } catch { /* The note falls back to the default wording. */ }
    api.user.deletion_requested_at = result?.requested_at || new Date().toISOString();
    state.accountDeletionScheduledFor = result?.scheduled_for || null;
    $("#deleteAccountDialog").close();
    if (hideFromPolls && !hidden) {
        // An older server, or one that skipped the hide: the account is still deleted.
        await confirmSheet({ title: "Couldn't hide your number", message: `Your account will still be deleted in ${ACCOUNT_DELETION_GRACE_DAYS} days.`, confirmLabel: "OK", cancelLabel: "Close" });
    }
    showPendingDeletion();
}

function accountDeletionScheduledFor() {
    const scheduled = new Date(state.accountDeletionScheduledFor || "");
    if (!Number.isNaN(scheduled.getTime())) return scheduled;
    const requestedAt = new Date(api.user?.deletion_requested_at || "");
    return new Date(requestedAt.getTime() + ACCOUNT_DELETION_GRACE_DAYS * 86_400_000);
}

function renderPendingDeletionCountdown() {
    const scheduled = accountDeletionScheduledFor();
    if (Number.isNaN(scheduled.getTime())) return;
    const total = Math.max(0, Math.ceil((scheduled.getTime() - Date.now()) / 1000));
    const parts = { days: Math.floor(total / 86_400), hours: Math.floor((total % 86_400) / 3_600), minutes: Math.floor((total % 3_600) / 60), seconds: total % 60 };
    const units = { days: "d", hours: "h", minutes: "m", seconds: "s" };
    for (const [key, value] of Object.entries(parts)) {
        $(`[data-countdown-unit="${key}"]`).textContent = `${String(value).padStart(2, "0")} ${units[key]}`;
    }
    $("#pendingDeletionCountdown").setAttribute("aria-label", `${parts.days} days, ${parts.hours} hours, ${parts.minutes} minutes, ${parts.seconds} seconds remaining`);
    if (total <= 0) {
        // AuthService.finishExpiredAccountDeletion: time's up, sign out here.
        clearInterval(state.pendingDeletionTimer);
        state.pendingDeletionTimer = null;
        $("#pendingDeletionDialog").close();
        api.clearSession();
        showSignedOut("Your account has been deleted.");
    }
}

function showPendingDeletion() {
    let hides = false;
    try { hides = localStorage.getItem(accountDeletionHidesKey(api.user?.id)) === "1"; } catch { hides = false; }
    $("#pendingDeletionCopy").textContent = hides
        ? "After deletion, you won't receive any more compliments in Valid. No one can vote for you in polls, even friends who have your number saved, until you come back."
        : "After deletion, you won't receive any more compliments in Valid, but friends who have your number saved can still vote for you in polls.";
    $("#pendingDeletionStatus").textContent = "";
    clearInterval(state.pendingDeletionTimer);
    renderPendingDeletionCountdown();
    state.pendingDeletionTimer = setInterval(renderPendingDeletionCountdown, 1000);
    const dialog = $("#pendingDeletionDialog");
    if (!dialog.open) dialog.showModal();
}

async function cancelAccountDeletion() {
    const button = $("#cancelDeletionButton");
    setButtonLoading(button, true, "Keeping account…");
    $("#pendingDeletionStatus").textContent = "";
    try {
        await api.cancelAccountDeletion(api.user.id);
        api.user.deletion_requested_at = null;
        state.accountDeletionScheduledFor = null;
        clearInterval(state.pendingDeletionTimer);
        state.pendingDeletionTimer = null;
        try { localStorage.removeItem(accountDeletionHidesKey(api.user.id)); } catch { /* Nothing saved. */ }
        $("#pendingDeletionDialog").close();
        showToast("Your account is staying on Valid");
    } catch (error) {
        $("#pendingDeletionStatus").textContent = "We couldn't keep your account. Check your connection and try again.";
    } finally {
        setButtonLoading(button, false);
    }
}

const PASSKEY_SIGN_OUT_WARNING = "You don't have a passkey. If you lose access to this phone number after signing out, you won't be able to recover your account. Set up a passkey first.";

// SettingsView.beginPasskeyProtectedAction(.signOut): an account without a
// passkey is warned first ("Set Up Passkey" is the main button); then unsent
// chat items are counted (SignOutUnsentItemsAlert.swift) before signing out.
async function confirmSignOut() {
    const button = $("#profileSignOutButton");
    if (button.disabled) return;
    if (accountNeedsPasskey()) {
        const choice = await choiceSheet({
            title: "Don't Lose Your Account",
            message: PASSKEY_SIGN_OUT_WARNING,
            confirmLabel: "Set Up Passkey",
            secondaryLabel: "Sign Out Anyway",
        });
        if (choice === "confirm") return void addBackupPasskey();
        if (choice !== "secondary") return;
    }
    button.disabled = true;
    try {
        const userId = api.user?.id;
        const unsent = userId ? await import("./chat/outbox.js")
            .then(async ({ listChatTextOutbox, listChatMediaOutbox }) => (await listChatTextOutbox(userId)).length + (await listChatMediaOutbox(userId)).length)
            .catch(() => 0) : 0;
        if (unsent > 0 && !await confirmSheet({
            title: "Sign out?",
            message: unsent === 1 ? "You have 1 unsent item that will be discarded." : `You have ${unsent} unsent items that will be discarded.`,
            confirmLabel: "Sign Out",
            destructive: true,
        })) return;
        if (userId) {
            try { localStorage.removeItem(notificationCategoryCacheKey(userId)); } catch { /* Nothing saved. */ }
        }
        await logoutAndReset();
    } finally {
        button.disabled = false;
    }
}

async function logoutAndReset() {
    const userId = api.user?.id;
    state.webPushSigningOut = true;
    clearCachedAppState();
    await presenceLifecycle?.stop();
    await preloadRoute("chats").then((route) => route?.beforeSessionEnd?.()).catch(() => null);
    await stopCallListener();
    await detachWebPushSubscription().catch(() => null);
    await api.logout().catch(() => null);
    await import("./chat/outbox.js")
        .then(({ clearChatOutboxes }) => clearChatOutboxes(userId))
        .catch(() => null);
    clearQuestionSubmissionState();
    api.clearSession();
    location.href = "./?signin=1";
}

async function stopCallListener() {
    if (!callListenerStarted) return;
    callListenerStarted = false;
    await import("./calls/service.js").then(({ stopCallListener: stop }) => stop(api)).catch(() => null);
}

function switchPanel(panel, { historyMode = "push", restoreScroll = true } = {}) {
    if (!["feed", "play", "chats", "profile"].includes(panel)) return;
    if (panel === "chats" && !(state.config?.enable_chats === true && state.config?.enable_web_chats === true)) return;
    const previousPanel = state.activePanel;
    if (previousPanel !== panel) state.tabScrollPositions[previousPanel] = window.scrollY;
    else if (historyMode !== "none") state.tabScrollPositions[panel] = 0;
    state.activePanel = panel;
    if (panel !== "chats") chatPresence?.setWatched([]);
    document.body.classList.toggle("play-active", panel === "play");
    const direction = ["feed", "play", "chats", "profile"].indexOf(panel) >= ["feed", "play", "chats", "profile"].indexOf(previousPanel) ? "forward" : "back";
    $("#appView").dataset.navigationDirection = direction;
    $$(".panel").forEach((element) => element.classList.add("hidden"));
    mountUIRoot($(`#${panel}Panel`)).classList.remove("hidden");
    $$(".nav-item").forEach((button) => {
        const active = button.dataset.panel === panel;
        button.classList.toggle("active", active);
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
    });
    if (historyMode !== "none") writeNavigationState(historyMode);
    const targetScroll = restoreScroll ? state.tabScrollPositions[panel] || 0 : 0;
    restorePanelScroll(panel, targetScroll);
    renderTabBadges();
    // A return to the Inbox starts a new visit; redraw its chip counts.
    if (panel === "feed" && previousPanel !== panel && state.feedItems.length) renderFeed();
    void activatePanelRoute(panel);
}

let panelScrollRestoreGeneration = 0;

function restorePanelScroll(panel, targetScroll) {
    const generation = ++panelScrollRestoreGeneration;
    const apply = () => {
        if (generation === panelScrollRestoreGeneration && state.activePanel === panel) {
            window.scrollTo(0, targetScroll);
        }
    };
    apply();
    requestAnimationFrame(() => {
        apply();
        requestAnimationFrame(apply);
    });
}

function activatePanelRoute(panel) {
    const context = { isCurrent: () => state.activePanel === panel };
    if (panel === "feed") Object.assign(context, {
        refreshGate: refreshFeedGateStatus,
        isLocked: isFeedVoteLocked,
        hasItems: () => state.feedItems.length > 0,
        isStale: () => feedIsStale(FEED_TAB_RETURN_FRESHNESS_MS),
        load: loadFeed,
    });
    if (panel === "play") context.load = loadPlay;
    if (panel === "chats") Object.assign(context, {
        root: $("#chatsRoot"), api, presence: chatPresence,
        getUser: () => api.user,
        getConfig: () => state.config,
        softHaptic, successHaptic, haptic, showToast,
        installSwipeBack: edgeSwipeBackSupported() ? installEdgeSwipeBack : null,
        onUnreadChange: renderChatUnreadBadge,
        notifications: chatNotificationBridge,
        onPlay: async () => {
            if (!state.profile?.school_id) return showToast('Join a school to play the Game of the Week.');
            await openWeeklyGame({ launch: true });
            void refreshWeeklyGame();
        },
    });
    if (panel === "profile") context.load = loadProfilePanel;
    return activateRoute(panel, context).catch(() => {
        if (!context.isCurrent()) return;
        if (panel === "feed") return context.refreshGate().then(() => {
            if (!context.isLocked() && !context.hasItems()) return context.load(true);
        });
        return context.load();
    });
}

async function refreshActivePanel() {
    softHaptic("medium");
    if (state.activePanel === "feed") {
        await loadFeed(true);
        await (await prepareFeedView()).refreshStories?.();
    }
    else if (state.activePanel === "chats") {
        const route = await preloadRoute("chats");
        await route.refresh?.();
    }
    else if (state.activePanel === "profile") await loadProfilePanel({ force: true });
    else await loadPlay();
    successHaptic();
}

// A pull only refreshes when the drag starts on the page itself at the top:
// not inside a scrolled container, and never inside a fixed-position layer
// (the chat room is fixed, so window.scrollY stays 0 while its history scrolls).
function pullRefreshAllowedFrom(target) {
    for (let element = target instanceof Element ? target : null; element && element !== document.body; element = element.parentElement) {
        if (element.scrollTop > 0) return false;
        const style = getComputedStyle(element);
        if (style.position === "fixed" || style.position === "sticky" && element.scrollHeight > element.clientHeight) return false;
    }
    return true;
}

function beginPullRefresh(event) {
    state.pullRefreshStartY = null;
    // iOS refreshes only the Feed and Chats lists by pulling.
    if (!document.body.classList.contains("authenticated") || !["feed", "chats"].includes(state.activePanel) || state.pullRefreshing || window.scrollY > 0
        || $("dialog[open], .detail-screen:not(.hidden)") || event.touches?.length > 1 || !pullRefreshAllowedFrom(event.target)) return;
    state.pullRefreshStartY = event.touches?.[0]?.clientY ?? null;
    state.pullRefreshDistance = 0;
}

let pullRefreshFrame = null;

function renderPullRefreshDistance() {
    pullRefreshFrame = null;
    const indicator = $("#pullRefreshIndicator");
    setRuntimeStyles(indicator, {
        "--pull-distance": `${state.pullRefreshDistance}px`,
        "--pull-opacity": String(Math.min(1, state.pullRefreshDistance / 50)),
    });
    // Follow the finger exactly; the transition only animates the release.
    indicator.classList.add("dragging");
    indicator.classList.toggle("ready", state.pullRefreshDistance >= 64);
}

function movePullRefresh(event) {
    if (state.pullRefreshStartY === null) return;
    const currentY = event.touches?.[0]?.clientY;
    if (!Number.isFinite(currentY)) return;
    state.pullRefreshDistance = Math.max(0, Math.min(110, (currentY - state.pullRefreshStartY) * .55));
    if (pullRefreshFrame === null) pullRefreshFrame = requestAnimationFrame(renderPullRefreshDistance);
}

async function endPullRefresh() {
    if (state.pullRefreshStartY === null) return;
    const shouldRefresh = state.pullRefreshDistance >= 64;
    state.pullRefreshStartY = null;
    state.pullRefreshDistance = 0;
    if (pullRefreshFrame !== null) cancelAnimationFrame(pullRefreshFrame);
    pullRefreshFrame = null;
    const indicator = $("#pullRefreshIndicator");
    indicator.classList.remove("ready", "dragging");
    if (!shouldRefresh) {
        clearRuntimeStyles(indicator, "--pull-distance", "--pull-opacity");
        return;
    }
    // Hold a spinner at the threshold until the refresh finishes.
    state.pullRefreshing = true;
    indicator.classList.add("refreshing");
    $("#pullRefreshStatus").textContent = "Refreshing…";
    setRuntimeStyles(indicator, { "--pull-distance": "64px", "--pull-opacity": "1" });
    try {
        await refreshActivePanel();
    } catch (_) {
        // Each panel reports its own load errors inline.
    } finally {
        state.pullRefreshing = false;
        indicator.classList.remove("refreshing");
        $("#pullRefreshStatus").textContent = "Updated";
        clearRuntimeStyles(indicator, "--pull-distance", "--pull-opacity");
    }
}

// Screens that pop like a UINavigationController (detail screens, the chat room).
function edgeSwipeBackSupported() {
    return isAndroidDevice() || (isStandaloneApp() && isAppleTouchDevice());
}

function installNativeSheetGestures() {
    if (edgeSwipeBackSupported()) {
        for (const screen of $$(".detail-screen")) installEdgeSwipeBack(screen, () => closeDetailScreen(screen));
    }
    // Sheets drag down on every phone, iPhone included (styles.css: dialog.modal at <=470px).
    for (const dialog of $$("dialog.modal, #godModePitchDialog")) {
        if (dialog.dataset.sheetGesture === "1" || dialog.classList.contains("reaction-picker-dialog")) continue;
        dialog.dataset.sheetGesture = "1";
        let startY = null;
        let dragDistance = 0;
        let dragFrame = null;
        dialog.addEventListener("pointerdown", (event) => {
            // The God Mode paywall is a sheet at every width (GodModePitchView).
            if (dialog.id !== "godModePitchDialog" && !matchMedia("(max-width: 470px)").matches) return;
            const rect = dialog.getBoundingClientRect();
            if (event.clientY - rect.top > 72 || event.target.closest("button, input, textarea, select, a")) return;
            startY = event.clientY;
            dialog.setPointerCapture?.(event.pointerId);
        });
        dialog.addEventListener("pointermove", (event) => {
            if (startY === null) return;
            dragDistance = Math.max(0, event.clientY - startY);
            if (dragFrame !== null) return;
            dragFrame = requestAnimationFrame(() => {
                dragFrame = null;
                setRuntimeStyles(dialog, { "--sheet-drag": `${dragDistance}px` });
            });
        });
        const finish = (event) => {
            if (startY === null) return;
            const distance = Math.max(0, event.clientY - startY);
            startY = null;
            dragDistance = 0;
            if (dragFrame !== null) cancelAnimationFrame(dragFrame);
            dragFrame = null;
            clearRuntimeStyles(dialog, "--sheet-drag");
            if (distance > 90 && dialog.open) dialog.close();
        };
        dialog.addEventListener("pointerup", finish);
        dialog.addEventListener("pointercancel", () => {
            startY = null;
            dragDistance = 0;
            if (dragFrame !== null) cancelAnimationFrame(dragFrame);
            dragFrame = null;
            clearRuntimeStyles(dialog, "--sheet-drag");
        });
    }

}

function isAppleTouchDevice() {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

// UIKit-style interactive pop: a drag from the left edge moves the screen with
// the finger (rubber-banding past the edge) and completes past a third of the
// width or on a fast flick. Installed iPhone apps have no browser back gesture.
// `onTrack` runs when a drag is recognised (e.g. to reveal the screen below);
// `onSettle(complete)` runs once it has finished, before `onBack`.
function installEdgeSwipeBack(screen, onBack, { onTrack, onSettle } = {}) {
    const EDGE = 24;
    let gesture = null;
    const setOffset = (x) => setRuntimeStyles(screen, { "--swipe-x": `${x}px` });
    const finish = (complete) => {
        const width = screen.getBoundingClientRect().width;
        const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
        screen.classList.remove("swipe-tracking");
        const settle = () => {
            screen.classList.remove("swipe-settling");
            clearRuntimeStyles(screen, "--swipe-x");
            onSettle?.(complete);
            if (complete) onBack();
        };
        if (reduceMotion) return settle();
        screen.classList.add("swipe-settling");
        setOffset(complete ? width : 0);
        setTimeout(settle, 240);
    };
    screen.addEventListener("touchstart", (event) => {
        const touch = event.touches[0];
        if (event.touches.length !== 1 || touch.clientX > EDGE || screen.classList.contains("swipe-settling")
            || event.target.closest("input, textarea, select, [contenteditable='true']")) return;
        gesture = { x: touch.clientX, y: touch.clientY, dx: 0, tracking: false, samples: [[touch.clientX, event.timeStamp]] };
    }, { passive: true });
    screen.addEventListener("touchmove", (event) => {
        if (!gesture) return;
        const touch = event.touches[0];
        const dx = touch.clientX - gesture.x;
        const dy = touch.clientY - gesture.y;
        if (!gesture.tracking) {
            // Decide once: a mostly vertical drag is a scroll, not a back swipe.
            if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { gesture = null; return; }
            if (dx < 8) return;
            gesture.tracking = true;
            screen.classList.add("swipe-tracking");
            onTrack?.();
        }
        event.preventDefault();
        // Past the left edge the screen resists like a rubber band.
        gesture.dx = dx >= 0 ? dx : -Math.sqrt(-dx) * 2;
        gesture.samples = [...gesture.samples.slice(-4), [touch.clientX, event.timeStamp]];
        setOffset(gesture.dx);
    }, { passive: false });
    const end = (event) => {
        if (!gesture) return;
        const { tracking, dx, samples } = gesture;
        gesture = null;
        if (!tracking) return;
        const [[firstX, firstTime], [lastX, lastTime]] = [samples[0], samples.at(-1)];
        const velocity = (lastX - firstX) / Math.max(1, lastTime - firstTime);
        const width = screen.getBoundingClientRect().width;
        finish(event.type === "touchend" && dx > 0 && (dx > width / 3 || velocity > 0.5));
    };
    screen.addEventListener("touchend", end, { passive: true });
    screen.addEventListener("touchcancel", end, { passive: true });
}

function updateNetworkStatus() {
    const offline = !navigator.onLine;
    $("#networkBanner").classList.toggle("hidden", !offline);
    if (!offline) showToast("Back online");
}

function isStandaloneApp() {
    return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

function androidInstallRequested() {
    if (demoMode || !isAndroidDevice() || isStandaloneApp()) return false;
    if (new URLSearchParams(location.search).get("install") !== "1") return false;
    try {
        return localStorage.getItem("valid:pwa-installed") !== "1";
    } catch (_) {
        return true;
    }
}

function showAndroidInstallGate() {
    const dialog = $("#androidInstallDialog");
    if (!dialog.open) dialog.showModal();
    const button = $("#androidInstallButton");
    button.disabled = false;
    $("#androidInstallStatus").textContent = state.installPrompt
        ? "Chrome is ready to install Valid."
        : "Waiting for Chrome’s installer…";
}

function markWebAppInstalled() {
    try {
        localStorage.setItem("valid:pwa-installed", "1");
    } catch (_) {
        // Installation still completed when storage is unavailable.
    }
}

function finishAndroidInstall() {
    markWebAppInstalled();
    const dialog = $("#androidInstallDialog");
    if (dialog.open) dialog.close();
    const params = new URLSearchParams(location.search);
    params.delete("install");
    history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
    $("#installAppButton").classList.add("hidden");
    restoreOrStartAuthFlow();
}

async function installWebApp() {
    if (iosInstallAvailable()) return openIOSInstall();
    if (!state.installPrompt) {
        if ($("#androidInstallDialog").open) {
            $("#androidInstallStatus").textContent = "Open Chrome’s ⋮ menu and choose Install app or Add to Home screen.";
        }
        return;
    }
    const prompt = state.installPrompt;
    state.installPrompt = null;
    await prompt.prompt();
    const choice = await prompt.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") {
        finishAndroidInstall();
        showToast("Valid is installed");
        return;
    }
    if ($("#androidInstallDialog").open) {
        $("#androidInstallStatus").textContent = "Installation was canceled. Tap Install Valid when you’re ready.";
    }
}

// The "Valid is ready to update" card. It must stay tappable over anything the
// app shows: an open modal <dialog> (every Android bottom sheet, the passkey
// prompt) makes the rest of the document inert, so a card outside it can be
// seen through the backdrop but not tapped (web-v114 support case). The card
// is a manual popover that lives inside the topmost open modal dialog, where it
// is not inert, and is re-shown there so it paints above the dialog itself.
const APP_UPDATE_RETRY_MS = 2000;
const APP_UPDATE_AUTO_KEY = "valid:auto-update-attempt";
const APP_UPDATE_AUTO_COOLDOWN_MS = 10 * 60_000;
// Set before every update reload: the browser may still be activating the new
// worker (it waits for the old one's in-flight requests), so the next page
// keeps asking for it and reloads once it takes over.
const APP_UPDATE_PENDING_KEY = "valid:app-update-pending";
const APP_UPDATE_PENDING_MS = 60_000;
const APP_UPDATE_GIVE_UP_MS = 15_000;
const modalDialogOpenOrder = new Map();
let modalDialogOpenCounter = 0;
let appUpdatePlacementQueued = false;
let appUpdateRetryTimers = [];
let appUserInteracted = false;
const watchedAppUpdateWorkers = new WeakSet();

function appUpdatePromptVisible() {
    return !$("#appUpdatePrompt").classList.contains("hidden");
}

function topmostModalDialog() {
    let topmost = null;
    let topmostOrder = -1;
    for (const dialog of document.querySelectorAll("dialog[open]")) {
        let modal = false;
        try { modal = dialog.matches(":modal"); } catch (_) { modal = false; }
        if (!modal) continue;
        if (!modalDialogOpenOrder.has(dialog)) modalDialogOpenOrder.set(dialog, ++modalDialogOpenCounter);
        const order = modalDialogOpenOrder.get(dialog);
        if (order > topmostOrder) {
            topmost = dialog;
            topmostOrder = order;
        }
    }
    return topmost;
}

function placeAppUpdatePrompt() {
    appUpdatePlacementQueued = false;
    const prompt = $("#appUpdatePrompt");
    if (!prompt || !appUpdatePromptVisible()) return;
    const host = topmostModalDialog() || document.body;
    if (prompt.parentElement !== host) host.append(prompt);
    prompt.classList.toggle("in-dialog", host !== document.body);
    if (typeof prompt.showPopover !== "function" || !prompt.hasAttribute("popover")) return;
    try {
        if (prompt.matches(":popover-open")) prompt.hidePopover();
        prompt.showPopover();
    } catch (_) { /* The fixed-position card still shows inside the host. */ }
}

function scheduleAppUpdatePromptPlacement() {
    if (appUpdatePlacementQueued) return;
    appUpdatePlacementQueued = true;
    queueMicrotask(placeAppUpdatePrompt);
}

function watchModalDialogsForAppUpdate() {
    new MutationObserver((records) => {
        for (const record of records) {
            const dialog = record.target;
            if (!(dialog instanceof HTMLDialogElement)) continue;
            if (dialog.open) modalDialogOpenOrder.set(dialog, ++modalDialogOpenCounter);
            else modalDialogOpenOrder.delete(dialog);
        }
        if (appUpdatePromptVisible()) scheduleAppUpdatePromptPlacement();
    }).observe(document.body, { attributes: true, attributeFilter: ["open"], subtree: true });
    // A closing dialog may be removed from the DOM right after (ui-dialogs.js);
    // move the card back out before it goes with it.
    document.addEventListener("close", () => {
        if (appUpdatePromptVisible()) placeAppUpdatePrompt();
    }, true);
    const prompt = $("#appUpdatePrompt");
    // Keep sheet drag and backdrop-dismiss handlers on the host dialog from
    // treating a tap on the card as a tap on the sheet or its backdrop.
    for (const type of ["pointerdown", "click"]) {
        prompt.addEventListener(type, (event) => event.stopPropagation());
    }
}

function setAppUpdateButton(mode) {
    const button = $("#applyAppUpdate");
    const busy = mode === "busy";
    button.disabled = busy;
    button.setAttribute("aria-busy", busy ? "true" : "false");
    button.textContent = busy ? "Updating…" : mode === "retry" ? "Try again" : "Update";
}

function hideAppUpdatePrompt() {
    const prompt = $("#appUpdatePrompt");
    try { if (prompt.matches(":popover-open")) prompt.hidePopover(); } catch (_) { /* Not a popover. */ }
    prompt.classList.add("hidden");
    prompt.classList.remove("in-dialog");
    if (prompt.parentElement !== document.body) document.body.append(prompt);
}

function showAppUpdatePrompt(worker) {
    if (!worker) return;
    watchAppUpdateWorker(worker);
    state.waitingServiceWorker = worker;
    // A newer worker arrived while an update was already under way: send it on.
    if (state.appUpdateRequested) {
        worker.postMessage({ type: "SKIP_WAITING" });
        return;
    }
    setAppUpdateButton("idle");
    $("#appUpdatePrompt").classList.remove("hidden");
    placeAppUpdatePrompt();
}

function watchAppUpdateWorker(worker) {
    if (watchedAppUpdateWorkers.has(worker)) return;
    watchedAppUpdateWorkers.add(worker);
    worker.addEventListener("statechange", () => {
        if (worker.state === "activated" && state.appUpdateRequested) reloadForAppUpdate();
        if (worker.state !== "redundant" || state.waitingServiceWorker !== worker) return;
        // The worker the card points at was replaced; follow the newest one.
        navigator.serviceWorker.getRegistration().then((registration) => {
            if (registration?.waiting && registration.waiting !== worker) showAppUpdatePrompt(registration.waiting);
            else if (!registration?.waiting && !registration?.installing && !state.appUpdateRequested) hideAppUpdatePrompt();
        }).catch(() => null);
    });
}

let appUpdateReloading = false;
function reloadForAppUpdate() {
    if (appUpdateReloading) return;
    appUpdateReloading = true;
    for (const timer of appUpdateRetryTimers) clearTimeout(timer);
    appUpdateRetryTimers = [];
    // A reload can race the activation and come back from the old worker;
    // the next page checks and finishes the job (see resumePendingAppUpdate).
    try { sessionStorage.setItem(APP_UPDATE_PENDING_KEY, `${Date.now()}:${appUpdateReloadCount + 1}`); } catch (_) { /* Reload anyway. */ }
    location.reload();
}

async function currentWaitingWorker() {
    try {
        const registration = await navigator.serviceWorker.getRegistration();
        return registration?.waiting || null;
    } catch (_) {
        return null;
    }
}

async function applyAppUpdate({ automatic = false } = {}) {
    if (state.appUpdateRequested) return;
    state.appUpdateRequested = true;
    if (!automatic) setAppUpdateButton("busy");
    const worker = await currentWaitingWorker() || state.waitingServiceWorker;
    if (!worker || worker.state === "redundant" || worker.state === "activated") {
        // Nothing left to activate: the new worker already controls this page
        // (or the update vanished). A reload loads whatever is current.
        reloadForAppUpdate();
        return;
    }
    watchAppUpdateWorker(worker);
    state.waitingServiceWorker = worker;
    worker.postMessage({ type: "SKIP_WAITING" });
    // controllerchange normally reloads within a few hundred ms. If it never
    // comes, ask whichever worker is waiting now, then reload regardless: a
    // fresh launch shows the card again if the worker is still waiting.
    appUpdateRetryTimers.push(setTimeout(async () => {
        const retryWorker = await currentWaitingWorker();
        if (retryWorker) {
            watchAppUpdateWorker(retryWorker);
            state.waitingServiceWorker = retryWorker;
            retryWorker.postMessage({ type: "SKIP_WAITING" });
        }
    }, APP_UPDATE_RETRY_MS));
    appUpdateRetryTimers.push(setTimeout(reloadForAppUpdate, APP_UPDATE_RETRY_MS * 2));
}

// After a fallback reload: keep the update request alive for a few seconds so
// a late activation still reloads onto the new version, then hand control back
// to the card (enabled) if nothing happened.
// How many update reloads led to this page (0 = none pending). Capped so a
// page that keeps coming back stale can never reload in a loop.
const APP_UPDATE_MAX_RELOADS = 3;
let appUpdateReloadCount = 0;

function takePendingAppUpdate() {
    try {
        const [since, count] = String(sessionStorage.getItem(APP_UPDATE_PENDING_KEY) || "").split(":").map(Number);
        sessionStorage.removeItem(APP_UPDATE_PENDING_KEY);
        if (!(since > 0) || Date.now() - since > APP_UPDATE_PENDING_MS) return 0;
        return Math.max(1, Number.isFinite(count) ? count : 1);
    } catch (_) {
        return 0;
    }
}

// The hashed release this document was built from (dist only), e.g. the
// "<release>" in /app/_static/<release>/app.js.
function pageRelease() {
    const entry = document.querySelector('script[type="module"][src]')?.src || "";
    return entry.match(/\/_static\/([0-9a-f]{8,})\//)?.[1] || null;
}

// True when the active worker's app-shell cache is a different release than
// this document: the reload raced the activation and the old worker served it.
async function pageIsBehindActiveWorker() {
    const release = pageRelease();
    if (!release || typeof caches === "undefined") return false;
    const registration = await navigator.serviceWorker.getRegistration();
    const active = registration?.active;
    if (!active) return false;
    if (active.state !== "activated") {
        await new Promise((resolve) => {
            const timer = setTimeout(resolve, 5000);
            active.addEventListener("statechange", () => {
                if (active.state === "activated" || active.state === "redundant") {
                    clearTimeout(timer);
                    resolve();
                }
            });
        });
    }
    const shells = (await caches.keys()).filter((name) => name.startsWith("valid-web-"));
    return shells.length > 0 && !shells.some((name) => name.includes(release));
}

// After a fallback reload: keep the update request alive for a while so a late
// activation still reloads onto the new version, then hand control back to the
// card (enabled) if nothing happened. The flag is consumed, so this reloads at
// most once more.
function resumePendingAppUpdate(registration) {
    const worker = registration.waiting || registration.installing;
    if (worker) {
        watchAppUpdateWorker(worker);
        state.waitingServiceWorker = worker;
        if (worker === registration.waiting) worker.postMessage({ type: "SKIP_WAITING" });
    } else {
        // Nothing waiting: either this page is current (done) or it came back
        // from the old worker while the new one activated (reload once more).
        pageIsBehindActiveWorker().catch(() => false).then((behind) => {
            if (behind && appUpdateReloadCount < APP_UPDATE_MAX_RELOADS) {
                reloadForAppUpdate();
                return;
            }
            for (const timer of appUpdateRetryTimers) clearTimeout(timer);
            appUpdateRetryTimers = [];
            state.appUpdateRequested = false;
        });
    }
    appUpdateRetryTimers.push(setTimeout(() => {
        if (appUpdateReloading) return;
        state.appUpdateRequested = false;
        if (registration.waiting) showAppUpdatePrompt(registration.waiting);
    }, APP_UPDATE_GIVE_UP_MS));
}

function noteAppUserInteraction() {
    appUserInteracted = true;
}

// At a cold start nothing is on screen yet, so a worker that is already waiting
// is applied straight away instead of asking. Guarded against reload loops.
function maybeApplyAppUpdateAtLaunch(registration) {
    if (!registration.waiting || !navigator.serviceWorker.controller || appUserInteracted) return false;
    if (document.visibilityState !== "visible" || performance.now() > 15_000) return false;
    try {
        const last = Number(localStorage.getItem(APP_UPDATE_AUTO_KEY) || 0);
        if (Date.now() - last < APP_UPDATE_AUTO_COOLDOWN_MS) return false;
        localStorage.setItem(APP_UPDATE_AUTO_KEY, String(Date.now()));
    } catch (_) {
        return false;
    }
    state.waitingServiceWorker = registration.waiting;
    void applyAppUpdate({ automatic: true });
    return true;
}

function registerAppServiceWorker() {
    // Set before register() resolves: the new worker can take control (and
    // fire controllerchange) while this page is still starting.
    appUpdateReloadCount = takePendingAppUpdate();
    const resumingUpdate = appUpdateReloadCount > 0;
    if (resumingUpdate) state.appUpdateRequested = true;
    for (const type of ["pointerdown", "keydown"]) addEventListener(type, noteAppUserInteraction, { capture: true, once: true });
    watchModalDialogsForAppUpdate();
    navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" }).then((registration) => {
        refreshWebPushStatus();
        if (resumingUpdate) {
            resumePendingAppUpdate(registration);
        } else if (registration.waiting && !maybeApplyAppUpdateAtLaunch(registration)) {
            showAppUpdatePrompt(registration.waiting);
        }
        registration.addEventListener("updatefound", () => {
            const worker = registration.installing;
            worker?.addEventListener("statechange", () => {
                if (worker.state === "installed" && navigator.serviceWorker.controller) showAppUpdatePrompt(worker);
            });
        });
    }).catch(() => null);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!state.appUpdateRequested) return;
        reloadForAppUpdate();
    });
}

function webPushSupported() {
    return !demoMode
        && window.isSecureContext
        && "serviceWorker" in navigator
        && "PushManager" in window
        && "Notification" in window;
}

function urlBase64ToUint8Array(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function renderWebPushStatus() {
    // Settings → Notifications: the row's summary and the sheet's banner
    // follow permission and subscription changes.
    renderNotificationSettings();
    renderFeedNotificationPrompt();
    // The chat notification cards follow permission and subscription changes.
    dispatchEvent(new CustomEvent("valid:web-push-status"));
}

function subscriptionUsesVapidKey(subscription, publicKey) {
    const currentKey = subscription?.options?.applicationServerKey;
    if (!currentKey) return true;
    const expected = urlBase64ToUint8Array(publicKey);
    const current = new Uint8Array(currentKey);
    return current.length === expected.length && current.every((value, index) => value === expected[index]);
}

async function readyServiceWorker(timeoutMs = 5_000) {
    let timeout;
    try {
        return await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((resolve) => { timeout = setTimeout(() => resolve(null), timeoutMs); }),
        ]);
    } finally {
        clearTimeout(timeout);
    }
}

async function syncWebPushSubscription(subscription) {
    const config = await api.getWebPushConfig();
    if (!config?.enabled || !config.vapid_public_key) {
        throw new Error("Notifications are not configured yet.");
    }
    let current = subscription;
    if (!subscriptionUsesVapidKey(current, config.vapid_public_key)) {
        await current.unsubscribe();
        const registration = await readyServiceWorker();
        if (!registration) throw new Error("Notification setup is not ready. Try again in a moment.");
        current = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(config.vapid_public_key),
        });
    }
    const result = await api.registerWebPushSubscription(api.user.id, current.toJSON());
    if (result?.registered !== true) {
        throw new Error("Valid could not confirm notification setup. Tap to retry.");
    }
    state.webPushSubscription = current;
    state.webPushRegistrationState = "on";
    state.webPushRegistrationError = "";
    return current;
}

// focus and visibilitychange both fire on return; share one status read.
function refreshWebPushStatus(options = {}) {
    if (!options.sync && state.webPushStatusRefresh) return state.webPushStatusRefresh;
    const refresh = readWebPushStatus(options).finally(() => {
        if (state.webPushStatusRefresh === refresh) state.webPushStatusRefresh = null;
    });
    if (!options.sync) state.webPushStatusRefresh = refresh;
    return refresh;
}

async function readWebPushStatus({ sync = false } = {}) {
    if (!webPushSupported()) {
        renderWebPushStatus();
        return;
    }
    try {
        const registration = await readyServiceWorker();
        if (!registration) throw new Error("Notification setup is not ready. Try again in a moment.");
        state.webPushSubscription = await registration.pushManager.getSubscription();
    } catch (_) {
        state.webPushSubscription = null;
    }
    if (!state.webPushSubscription) {
        state.webPushRegistrationState = "off";
        state.webPushRegistrationError = "";
        // Allowed but not subscribed (cleared site data, an expired or revoked
        // subscription, another account signed out here): subscribe again.
        void resubscribeWebPushQuietly();
    }
    if (sync && state.webPushSubscription && api.user?.id) {
        state.webPushRegistrationState = "syncing";
        renderWebPushStatus();
        try {
            await syncWebPushSubscription(state.webPushSubscription);
        } catch (error) {
            state.webPushRegistrationState = "error";
            state.webPushRegistrationError = userMessage(error, "Could not finish notification setup.");
        }
    } else if (state.webPushSubscription && state.webPushRegistrationState === "off") {
        state.webPushRegistrationState = "syncing";
    }
    renderWebPushStatus();
}

async function detachWebPushSubscription() {
    if (!webPushSupported() || !api.user?.id) return;
    const registration = state.webPushSubscription ? null : await readyServiceWorker(1_500);
    const subscription = state.webPushSubscription || await registration?.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    state.webPushSubscription = null;
    state.webPushRegistrationState = "off";
    state.webPushRegistrationError = "";
    await api.deleteWebPushSubscription(api.user.id, endpoint).catch(() => null);
    renderWebPushStatus();
}

async function toggleWebPush() {
    if (!webPushSupported() && iosInstallAvailable()) return openIOSInstall();
    const button = $("#notificationButton");
    if (state.webPushBusy || !webPushSupported()) return;
    if (Notification.permission === "denied") {
        showToast("Allow notifications for Valid in your browser settings.");
        return;
    }

    state.webPushBusy = true;
    button.disabled = true;
    renderFeedNotificationPrompt();
    try {
        // Permission requests must begin in the original tap task. Awaiting the
        // service worker first can consume transient user activation on mobile.
        const permissionPromise = Notification.permission === "default"
            ? Notification.requestPermission()
            : Promise.resolve(Notification.permission);
        const registration = await readyServiceWorker();
        if (!registration) throw new Error("Notification setup is not ready. Try again in a moment.");
        const existing = state.webPushSubscription || await registration.pushManager.getSubscription();
        if (existing) {
            if (state.webPushRegistrationState === "on") {
                // Turned off here on purpose: the quiet re-subscribe must not undo it.
                setWebPushTurnedOff(api.user?.id, true);
                await detachWebPushSubscription();
                showToast("Notifications turned off");
            } else {
                setWebPushTurnedOff(api.user?.id, false);
                state.webPushSubscription = existing;
                state.webPushRegistrationState = "syncing";
                renderWebPushStatus();
                await syncWebPushSubscription(existing);
                renderWebPushStatus();
                showToast("Notifications are on");
            }
            return;
        }

        const configPromise = api.getWebPushConfig();
        const [permission, config] = await Promise.all([permissionPromise, configPromise]);
        if (permission !== "granted") {
            renderWebPushStatus();
            showToast("Notifications were not enabled.");
            return;
        }
        setWebPushTurnedOff(api.user?.id, false);
        await subscribeWebPush(registration, config);
        showToast("Notifications are on");
    } catch (error) {
        if (state.webPushSubscription) {
            state.webPushRegistrationState = "error";
            state.webPushRegistrationError = userMessage(error, "Could not finish notification setup.");
        } else {
            state.webPushRegistrationState = "off";
        }
        renderWebPushStatus();
        showToast(userMessage(error, "Could not enable notifications."));
    } finally {
        state.webPushBusy = false;
        button.disabled = false;
        renderWebPushStatus();
    }
}

async function subscribeWebPush(registration, config) {
    if (!config?.enabled || !config.vapid_public_key) {
        throw new Error("Notifications are not configured yet.");
    }
    state.webPushRegistrationState = "syncing";
    renderWebPushStatus();
    const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.vapid_public_key),
    });
    state.webPushSubscription = subscription;
    await syncWebPushSubscription(subscription);
    renderWebPushStatus();
    return subscription;
}

const webPushTurnedOffKey = (userId) => `valid:web-push-turned-off:${userId}`;

// Also kept in memory: with storage blocked, the next focus would otherwise
// quietly undo an "off" chosen a moment ago in this page.
const webPushTurnedOffThisPage = new Set();

function webPushTurnedOff(userId) {
    if (!userId) return false;
    if (webPushTurnedOffThisPage.has(userId)) return true;
    try { return localStorage.getItem(webPushTurnedOffKey(userId)) === "1"; }
    catch (_) { return false; }
}

function setWebPushTurnedOff(userId, off) {
    if (!userId) return;
    if (off) webPushTurnedOffThisPage.add(userId);
    else webPushTurnedOffThisPage.delete(userId);
    try {
        if (off) localStorage.setItem(webPushTurnedOffKey(userId), "1");
        else localStorage.removeItem(webPushTurnedOffKey(userId));
    } catch (_) { /* Without storage, a turned-off switch can come back on a later visit. */ }
}

const QUIET_RESUBSCRIBE_RETRY_MS = 10 * 60_000;
let quietResubscribe = null;

// Permission is already "granted" but this browser has no subscription, so
// pushes for this account go nowhere. Subscribe again without asking (no
// prompt is shown for a granted permission). One attempt at a time; after a
// failure, wait before trying again so focus/visibility events cannot loop.
function resubscribeWebPushQuietly(source = null) {
    const userId = api.user?.id;
    if (!userId || state.webPushSigningOut || state.webPushBusy || !webPushSupported()
        || Notification.permission !== "granted" || state.webPushSubscription || webPushTurnedOff(userId)) {
        return Promise.resolve(false);
    }
    if (quietResubscribe?.running) return quietResubscribe.running;
    if (quietResubscribe?.userId === userId && Date.now() - quietResubscribe.failedAt < QUIET_RESUBSCRIBE_RETRY_MS) {
        return Promise.resolve(false);
    }
    const attempt = { userId, failedAt: 0, running: null };
    quietResubscribe = attempt;
    attempt.running = (async () => {
        try {
            const registration = await readyServiceWorker();
            if (!registration) throw new Error("Notification setup is not ready.");
            const [existing, config] = await Promise.all([registration.pushManager.getSubscription(), api.getWebPushConfig()]);
            // The account, permission or another path may have changed meanwhile.
            if (api.user?.id !== userId || state.webPushSigningOut || state.webPushBusy
                || Notification.permission !== "granted" || state.webPushSubscription
                || webPushTurnedOff(userId)) return false;
            if (existing) {
                state.webPushSubscription = existing;
                state.webPushRegistrationState = "syncing";
                await syncWebPushSubscription(existing);
                renderWebPushStatus();
                return false;
            }
            await subscribeWebPush(registration, config);
            void api.recordNotificationPreferencesAction("web_resubscribed", source).catch(() => null);
            return true;
        } catch (_) {
            attempt.failedAt = Date.now();
            state.webPushRegistrationState = state.webPushSubscription ? "error" : "off";
            renderWebPushStatus();
            return false;
        } finally {
            attempt.running = null;
        }
    })();
    return attempt.running;
}

// The chat card's "Notify me". The browser is asked first, synchronously
// inside the tap: mobile Chrome needs the user gesture, and awaiting the
// service worker first can consume it.
function enableWebPushFromPrompt() {
    if (!webPushSupported()) return Promise.resolve({ permission: "unsupported", prompted: false, subscribed: false });
    const prompted = Notification.permission === "default";
    const permissionPromise = prompted ? Notification.requestPermission() : Promise.resolve(Notification.permission);
    return finishWebPushFromPrompt(prompted, permissionPromise);
}

async function finishWebPushFromPrompt(prompted, permissionPromise) {
    if (state.webPushBusy) {
        return { permission: await permissionPromise.catch(() => Notification.permission), prompted, subscribed: false };
    }
    const button = $("#notificationButton");
    state.webPushBusy = true;
    button.disabled = true;
    let permission = Notification.permission;
    try {
        permission = await permissionPromise;
        if (permission !== "granted") return { permission, prompted, subscribed: false };
        setWebPushTurnedOff(api.user?.id, false);
        const registration = await readyServiceWorker();
        if (!registration) throw new Error("Notification setup is not ready. Try again in a moment.");
        const existing = state.webPushSubscription || await registration.pushManager.getSubscription();
        if (existing) {
            state.webPushSubscription = existing;
            state.webPushRegistrationState = "syncing";
            renderWebPushStatus();
            await syncWebPushSubscription(existing);
        } else {
            await subscribeWebPush(registration, await api.getWebPushConfig());
        }
        return { permission, prompted, subscribed: true };
    } catch (error) {
        if (state.webPushSubscription) {
            state.webPushRegistrationState = "error";
            state.webPushRegistrationError = userMessage(error, "Could not finish notification setup.");
        } else {
            state.webPushRegistrationState = "off";
        }
        return { permission: Notification.permission, prompted, subscribed: false, error };
    } finally {
        state.webPushBusy = false;
        button.disabled = false;
        renderWebPushStatus();
    }
}

// What the chat notification cards need. iPhone Safari outside the Home
// Screen app has no Web Push; it keeps the Add to Home Screen sheet instead.
const chatNotificationBridge = {
    permission() {
        if (!webPushSupported() || iosInstallAvailable()) return "unsupported";
        return Notification.permission;
    },
    enable: enableWebPushFromPrompt,
    ensureSubscribed: (source) => resubscribeWebPushQuietly(source),
    record: (action, source) => api.recordNotificationPreferencesAction(action, source),
};

// The notification soft prompt (Play congrats, onboarding) uses the same
// Web Push path as the chat cards. The localhost demo has no push service:
// ?push=default|denied fakes a browser there (?pushanswer= what it answers).
function demoNotificationBridge() {
    const params = new URLSearchParams(location.search);
    let permission = params.get("push");
    if (!["default", "denied", "granted"].includes(permission)) return null;
    return {
        permission: () => permission,
        enable() {
            const prompted = permission === "default";
            if (prompted) permission = ["granted", "denied", "default"].includes(params.get("pushanswer")) ? params.get("pushanswer") : "granted";
            return new Promise((resolve) => setTimeout(() => resolve({ permission, prompted, subscribed: permission === "granted" }), 150));
        },
        ensureSubscribed: () => Promise.resolve(false),
        record: () => Promise.resolve(null),
    };
}
configureNotificationSoftPrompt((demoMode && demoNotificationBridge()) || chatNotificationBridge);

function bindEvents() {
    $("#passkeyButton").addEventListener("click", handlePasskeySignIn);
    $("#createAccountButton").addEventListener("click", openSignupDialog);
    $('#signupRecoverAccount').addEventListener('click', async () => {
        $('#signupDialog').close();
        await handlePasskeySignIn();
    });
    $("[data-signup-login]").addEventListener("click", () => {
        $("#signupDialog").close();
        handlePasskeySignIn();
    });
    $("#signupForm").addEventListener("submit", createAccount);
    $("#signupPicture").addEventListener("change", previewSignupPhoto);
    $("#signupPhone").addEventListener("input", (event) => {
        event.currentTarget.value = formatSignupPhone(event.currentTarget.value);
        const digits = signupPhoneDigits(event.currentTarget.value);
        if (state.signupVerifiedPhone !== digits) {
            state.signupPhoneVerified = false;
            state.signupVerifiedPhone = null;
            $("#signupPhoneCode").value = "";
        }
        $("#signupStatus").textContent = "";
    });
    $("#signupPhoneCode").addEventListener("input", (event) => {
        event.currentTarget.value = event.currentTarget.value.replace(/\D/g, "").slice(0, 10);
        $("#signupStatus").textContent = "";
    });
    $("#signupUsername").addEventListener("input", (event) => {
        const input = event.currentTarget;
        const cursor = input.selectionStart;
        input.value = input.value.toLowerCase();
        if (cursor !== null) input.setSelectionRange(cursor, cursor);
        $("#signupStatus").textContent = "";
    });
    $("#signupZip").addEventListener("input", (event) => {
        event.currentTarget.value = event.currentTarget.value.replace(/\D/g, "").slice(0, 5);
        state.signupSchoolLookupGeneration += 1;
        state.signupNearbySchools = [];
        state.signupSelectedSchool = null;
        state.signupSchoolFallback = false;
        $("#signupSchoolPicker").classList.add("hidden");
        $("#signupSchoolFallback").classList.add("hidden");
        $("#signupSchoolContinue").disabled = true;
        $("#signupStatus").textContent = "";
        if (event.currentTarget.value.length === 5) lookupSignupSchools();
    });
    $("#signupZip").addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            lookupSignupSchools();
        }
    });
    $("#signupSchoolSearch").addEventListener("input", renderSignupSchoolResults);
    $("#signupSchoolResults").addEventListener("click", (event) => {
        const school = event.target.closest("[data-signup-school]");
        if (school) selectSignupSchool(school.dataset.signupSchool);
    });
    $("#signupShowSchoolFallback").addEventListener("click", () => showSignupSchoolFallback(true));
    $("#signupBackToNearby").addEventListener("click", () => showSignupSchoolFallback(false));
    let signupAgeScrollFrame = null;
    $("#signupAgeWheel").addEventListener("scroll", (event) => {
        const wheel = event.currentTarget;
        if (signupAgeScrollFrame) cancelAnimationFrame(signupAgeScrollFrame);
        signupAgeScrollFrame = requestAnimationFrame(() => {
            // Hiding the age step can reset the scroller and emit a late event.
            // Never let that overwrite the age the user already committed.
            if (state.signupStep !== 0) {
                signupAgeScrollFrame = null;
                return;
            }
            const age = 13 + Math.round(wheel.scrollTop / 40);
            selectSignupAge(age, { scroll: false });
            signupAgeScrollFrame = null;
        });
    }, { passive: true });
    $("#signupAgeWheel").addEventListener("keydown", (event) => {
        if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        selectSignupAge(Number($("#signupAge").value) + direction);
    });
    $("#signupDialog").addEventListener("click", (event) => {
        const age = event.target.closest("[data-signup-age]");
        // Commit the exact tapped age immediately. A smooth scroll can continue
        // after the user advances and overwrite the hidden value mid-signup.
        if (age) selectSignupAge(age.dataset.signupAge);
        const grade = event.target.closest("[data-signup-grade]");
        if (grade) selectSignupGrade(grade.dataset.signupGrade);
        const gender = event.target.closest("[data-signup-gender]");
        if (gender) selectSignupGender(gender.dataset.signupGender);
        const next = event.target.closest("[data-signup-next]");
        if (next) advanceSignup(next);
        const resendCode = event.target.closest("[data-signup-resend-code]");
        if (resendCode) resendSignupPhoneCode(resendCode);
        if (event.target.closest("[data-signup-back]")) setSignupStep(state.signupStep - 1);
    });
    $("#logoutButton").addEventListener("click", logoutAndReset);
    $$(".segment").forEach((button) => button.addEventListener("click", () => {
        state.feedType = button.dataset.feed;
        state.myVotesOnly = false;
        state.schoolFeedContent = "all";
        $$(".segment").forEach((segment) => segment.classList.toggle("active", segment === button));
        $("#schoolFeedControls").classList.toggle("hidden", state.feedType !== "school");
        $("#personalInboxControls").classList.toggle("hidden", state.feedType !== "personal");
        loadFeed(true);
    }));
    $("#personalInboxControls").addEventListener("click", (event) => {
        const button = event.target.closest("[data-inbox-filter]");
        if (!button || !PERSONAL_INBOX_FILTERS[button.dataset.inboxFilter]) return;
        state.personalInboxFilter = button.dataset.inboxFilter;
        softHaptic();
        renderFeed();
        button.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest", inline: "center" });
    });
    $("#schoolFeedControls").addEventListener("click", (event) => {
        const sort = event.target.closest("[data-school-sort]");
        const content = event.target.closest("[data-school-content]");
        if (sort) {
            state.schoolFeedSort = sort.dataset.schoolSort;
            $$("[data-school-sort]").forEach((button) => button.classList.toggle("active", button === sort));
            sort.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest", inline: "center" });
        }
        if (content) {
            state.schoolFeedContent = content.dataset.schoolContent;
            state.myVotesOnly = state.schoolFeedContent === "my_votes";
            $$("[data-school-content]").forEach((button) => button.classList.toggle("active", button === content));
            content.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest", inline: "center" });
        }
        if (sort || content) loadFeed(true);
    });
    $("#feedSearch").addEventListener("input", (event) => {
        state.feedSearch = event.currentTarget.value;
        state.feedClassmateResults = [];
        renderFeed();
        scheduleFeedSearch();
    });
    $("#feedClassmateResults").addEventListener("click", (event) => {
        const classmate = event.target.closest("[data-feed-classmate]");
        if (classmate) selectFeedClassmate(classmate.dataset.feedClassmate);
    });
    $("#giveTbhList").addEventListener("click", (event) => {
        const request = event.target.closest("[data-give-tbh-request]");
        if (!request) return;
        $("#giveTbhDialog").close();
        openTbhComposer(request.dataset.giveTbhRequest);
    });
    // FeedView+PersonalInbox pages ahead on its own: a sentinel below the list.
    if ("IntersectionObserver" in window) {
        new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) maybeLoadMoreFeed();
        }, { rootMargin: "0px 0px 600px 0px" }).observe($("#loadMoreFeed"));
    }
    for (const root of [$('#feedDetailDialog'), $('#tbhDetailDialog')]) root.addEventListener('click', event => {
        const send = event.target.closest('[data-send-content]');
        if (send) void sendContentLink(send);
        const reveal = event.target.closest('[data-reveal-question-submitter]');
        if (reveal) void revealQuestionSubmitter(reveal);
        const picker = event.target.closest('[data-reaction-picker]');
        const reactors = event.target.closest('[data-reactors]');
        if (picker) openReactionPicker(picker.dataset.reactionPicker, picker);
        if (reactors) openReactorList(reactors.dataset.reactors);
        const share = event.target.closest('[data-share-tbh]');
        if (share) void shareTbhDetail(share.dataset.shareTbh);
    });
    $('[data-close-ask-reply]').addEventListener('click', () => closeDetailScreen($('#anonymousAnswerDetailDialog')));
    $("#feedList").addEventListener("click", (event) => {
        const commentsTarget = event.target.closest("[data-comments-target]");
        if (commentsTarget) return void openCommentsFromValue(commentsTarget.dataset.commentsTarget);
        const reactionPicker = event.target.closest("[data-reaction-picker]");
        const reactors = event.target.closest("[data-reactors]");
        if (reactionPicker) return openReactionPicker(reactionPicker.dataset.reactionPicker, reactionPicker);
        if (reactors) return openReactorList(reactors.dataset.reactors);
        if (event.target.closest("[data-give-tbh]")) return openGiveTbhSheet();
        const feedProfile = event.target.closest("[data-feed-profile]");
        if (feedProfile) return void openFeedRowProfile(feedProfile.dataset.feedProfile);
        const tbhRequest = event.target.closest("[data-tbh-request]");
        const tbhDismiss = event.target.closest("[data-tbh-dismiss]");
        const tbhSuppress = event.target.closest("[data-tbh-suppress]");
        const tbhDetail = event.target.closest("[data-tbh-detail]");
        if (tbhDismiss) return dismissTbhRequest(tbhDismiss.dataset.tbhDismiss);
        if (tbhSuppress) return suppressTbhRequester(tbhSuppress.dataset.tbhSuppress);
        if (tbhRequest) return openTbhComposer(tbhRequest.dataset.tbhRequest);
        if (tbhDetail) return openTbhDetail(tbhDetail.dataset.tbhDetail);
        const anonymousQuestion = event.target.closest("[data-anonymous-question]");
        const anonymousAnswer = event.target.closest("[data-anonymous-answer]");
        if (anonymousQuestion) return openAnonymousQuestionDialog(anonymousQuestion.dataset.anonymousQuestion);
        if (anonymousAnswer) return openAnonymousAnswerDialog(anonymousAnswer.dataset.anonymousAnswer);
        const detail = event.target.closest("[data-feed-detail]");
        if (detail) openFeedDetail(detail.dataset.feedDetail);
    });
    $("#feedDetailDialog").addEventListener("click", (event) => {
        const commentsTarget = event.target.closest("[data-comments-target]");
        if (commentsTarget) return void openCommentsFromValue(commentsTarget.dataset.commentsTarget);
        const menuButton = event.target.closest("[data-toggle-feed-menu]");
        if (menuButton) toggleDetailActionMenu(menuButton);
        if (event.target.closest("[data-close-feed-detail]")) {
            state.selectedFeedItemId = null;
            closeDetailScreen($("#feedDetailDialog"));
        }
        if (event.target.closest("#revealFeedSenderButton")) revealFeedSender();
        const share = event.target.closest("[data-share-feed-platform]");
        if (share) shareFeedItem(share.dataset.shareFeedPlatform);
        if (event.target.closest("[data-report-feed-item]")) {
            closeDetailActionMenus();
            moderateFeedItem("report");
        }
        if (event.target.closest("[data-dismiss-feed-item]")) {
            closeDetailActionMenus();
            moderateFeedItem("dismiss");
        }
        if (event.target.closest("[data-block-feed-submitter]")) {
            closeDetailActionMenus();
            moderateFeedItem("block");
        }
    });
    $("#feedGateLock").addEventListener("click", (event) => {
        if (event.target.closest("[data-vote-to-unlock]")) switchPanel("play");
        if (event.target.closest("[data-enable-feed-notifications]")) toggleWebPush();
    });
    $("#anonymousAnswerForm").addEventListener("submit", answerAnonymousQuestion);
    $("#anonymousAnswerText").addEventListener("input", updateAnonymousAnswerButton);
    $("#anonymousReportForm").addEventListener("submit", submitAnonymousReport);
    $("#acknowledgeAskSafetyNotice").addEventListener("click", acknowledgeAskSafetyNotice);
    $("#askSafetyNoticeDialog").addEventListener("cancel", (event) => event.preventDefault());
    $("#anonymousQuestionDialog").addEventListener("click", (event) => {
        const menuButton = event.target.closest("[data-toggle-anonymous-menu]");
        if (menuButton) toggleDetailActionMenu(menuButton);
        if (event.target.closest("[data-close-anonymous]")) {
            state.selectedAnonymousQuestionId = null;
            closeDetailScreen($("#anonymousQuestionDialog"));
        }
        const action = event.target.closest("[data-anonymous-action]");
        const share = event.target.closest("[data-share-anonymous]");
        if (action) {
            closeDetailActionMenus();
            handleAnonymousSafetyAction(action.dataset.anonymousAction);
        }
        if (share) shareAnonymousAnswer(share.dataset.shareAnonymous);
    });
    document.addEventListener("click", (event) => {
        if (!event.target.closest(".detail-overflow")) closeDetailActionMenus();
    });
    $$(".nav-item").forEach((button) => {
        // The outlined icon, and the filled one shown while the tab is selected (TabIcon).
        const wrap = button.querySelector("[data-tab-icon]");
        if (wrap && !wrap.querySelector("svg")) wrap.insertAdjacentHTML("afterbegin", uiIcon(wrap.dataset.tabIcon) + uiIcon(`${wrap.dataset.tabIcon}-filled`));
        const preload = () => { void preloadRoute(button.dataset.panel); };
        button.addEventListener("pointerenter", preload, { passive: true });
        button.addEventListener("focus", preload);
        button.addEventListener("click", (event) => {
            const panel = button.dataset.panel;
            if (event.detail > 0) button.blur();
            if (panel === state.activePanel) {
                // Re-tap: back to the tab's root and top, without a new history entry.
                if (panel === "chats" && new URLSearchParams(location.search).has("chat")) {
                    const url = new URL(location.href);
                    url.searchParams.delete("chat");
                    url.searchParams.delete("message");
                    url.searchParams.delete("call");
                    history.replaceState({ ...history.state, validApp: true, panel: "chats" }, "", `${url.pathname}${url.search}`);
                }
                switchPanel(panel, { historyMode: "replace", restoreScroll: false });
                return;
            }
            if (panel === "feed" && history.state?.tabOverFeed === true) {
                history.back();
                return;
            }
            switchPanel(panel, { historyMode: state.activePanel === "feed" ? "push" : "replace" });
        });
    });
    $("#playCard").addEventListener("click", (event) => {
        const menuButton = event.target.closest("[data-toggle-play-menu]");
        if (menuButton) toggleDetailActionMenu(menuButton);
        const choice = event.target.closest("[data-choice]");
        const skip = event.target.closest("[data-skip]");
        const invite = event.target.closest("[data-invite-unlock]");
        if (choice) answerPlayQuestion(choice.dataset.choice);
        if (skip) skipPlayQuestion(Number(skip.dataset.skip));
        if (invite) inviteAndUnlock(invite);
        if (event.target.closest("[data-find-classmates]")) openClassmatesDialog();
        if (event.target.closest("[data-shuffle]")) shufflePlayChoices();
        if (event.target.closest("[data-nominate]")) openNominationDialog();
        const safetyAction = event.target.closest("[data-play-question-action]");
        if (safetyAction) {
            closeDetailActionMenus();
            moderatePlayQuestion(safetyAction.dataset.playQuestionAction);
        }
        const finish = event.target.closest("[data-finish-play]");
        if (finish) finishPlaySet(finish);
        if (event.target.closest("[data-open-question]")) openQuestionDialog();
        const revealSubmitter = event.target.closest("[data-play-reveal-submitter]");
        if (revealSubmitter) revealPlayQuestionSubmitter(revealSubmitter);
        const suggested = event.target.closest("[data-invite-suggested]");
        if (suggested) inviteSuggestedPlayFriend(suggested);
        if (event.target.closest("[data-play-memento]")) openMementoFromPlay();
        if (event.target.closest("[data-play-congrats-game]")) openWeeklyGame();
    });
    document.addEventListener("visibilitychange", recheckPlayInviteOnReturn);
    $("#weeklyGameRoot").addEventListener("click", (event) => {
        if (event.target.closest("[data-weekly-game-hide]")) {
            setWeeklyGameHidden(true);
            softHaptic();
            return renderWeeklyGameEntry();
        }
        if (event.target.closest("[data-weekly-game-restore]")) {
            setWeeklyGameHidden(false);
            softHaptic();
            return renderWeeklyGameEntry();
        }
        const tile = event.target.closest("[data-weekly-game-tile]");
        if (tile) return void openWeeklyGame({ release: weeklyGameState.slots[Number(tile.dataset.weeklyGameTile)]?.release || null });
        if (event.target.closest("[data-weekly-game-open]")) void openWeeklyGame();
    });
    $("#nominationSearch").addEventListener("input", renderNominationList);
    $("#nominationTabs").addEventListener("click", (event) => {
        const tab = event.target.closest("[data-nomination-tab]");
        if (!tab || state.nominationTab === tab.dataset.nominationTab) return;
        state.nominationTab = tab.dataset.nominationTab;
        softHaptic();
        renderNominationList();
    });
    $("#nominationList").addEventListener("click", (event) => {
        const candidate = event.target.closest("[data-nomination]");
        if (candidate) nominateClassmate(candidate.dataset.nomination);
    });
    $("#askLinkCard").addEventListener("click", (event) => {
        const share = event.target.closest("[data-share-link]");
        if (share) shareAskLink(false, share.dataset.shareLink || "other");
        if (event.target.closest("[data-copy-link]")) shareAskLink(true);
        if (event.target.closest("[data-toggle-link]")) toggleAskLink();
        if (event.target.closest("[data-rotate-link]")) rotateAskLink();
        if (event.target.closest("[data-ask-safety-history]")) openAskSafetyHistory();
    });
    $("#confirmAskStoryShare").addEventListener("click", prepareAskStoryShare);
    $("#saveAskStoryImage").addEventListener("click", saveAskStoryImageAgain);
    $("#openAskStoryApp").addEventListener("click", openAskStoryApp);
    $("#copyAskStoryLink").addEventListener("click", async () => {
        if (!state.askStoryShareURL) return;
        const copied = await copyShareLink(state.askStoryShareURL);
        if (copied) {
            $("#copyAskStoryLink").classList.add("hidden");
            $("#askStoryInstructionsStatus").textContent = "Story image ready • Link copied";
        } else {
            $("#askStoryInstructionsStatus").textContent = "Could not copy automatically. Tap your ask link in Settings to copy it.";
        }
    });
    $("#profilePanel").addEventListener("click", (event) => {
        if (event.target.closest("[data-open-god-mode]")) openGodModePitch();
        if (event.target.closest("[data-edit-photo]")) {
            if (state.pendingProfilePhoto?.status === "uploading") return;
            if (state.pendingProfilePhoto?.status === "failed") return void uploadProfilePhoto(state.pendingProfilePhoto.file);
            $("#profilePictureInput").click();
        }
        if (event.target.closest("[data-edit-bio]")) openBioDialog();
        if (event.target.closest("[data-edit-profile]")) openProfileDialog();
        if (event.target.closest("#viewClassmatesButton")) openClassmateDirectory();
        if (event.target.closest("#findContactsButton")) openClassmatesDialog();
        if (event.target.closest("#profileSignOutButton")) void confirmSignOut();
        const invite = event.target.closest("[data-profile-invite]");
        if (invite) shareProfileInvite(invite, invite.dataset.profileInvite);
        if (event.target.closest("[data-open-creator-program]")) openCreatorProgram();
        const schoolUnlock = event.target.closest("[data-school-unlock]");
        if (schoolUnlock?.dataset.schoolUnlock === "vote") switchPanel("play");
        if (schoolUnlock?.dataset.schoolUnlock === "invite") shareProfileInvite(schoolUnlock, "imessage");
        const rankedClassmate = event.target.closest("[data-school-classmate]");
        if (rankedClassmate) openClassmateProfile(rankedClassmate.dataset.schoolClassmate);
        const poll = event.target.closest("[data-top-poll]");
        if (poll) openTopPoll(poll.dataset.topPoll);
        const purchase = event.target.closest("[data-buy-aura]");
        if (purchase?.dataset.buyAura === "global") openAuraSpend("global");
        if (purchase?.dataset.buyAura === "targeted") openTargetedBoostPicker();
        if (purchase?.dataset.buyAura === "tbh") openTbhRequestPurchase();
        if (purchase?.dataset.buyAura === "question") openQuestionDialog();
    });
    $("#tbhRequestDialog").addEventListener("click", (event) => {
        if (event.target.closest("[data-close-tbh-request]")) {
            if (state.selectedTbhTargetId && !event.target.closest(".tbh-success")) {
                state.selectedTbhTargetId = null;
                renderTbhRequestFlow();
            } else closeDetailScreen($("#tbhRequestDialog"));
            return;
        }
        const target = event.target.closest("[data-tbh-target]");
        if (target) {
            state.selectedTbhTargetId = target.dataset.tbhTarget;
            state.selectedTbhPrompt = "anything";
            state.tbhRequestIdempotencyKey = newIdempotencyKey();
            renderTbhRequestFlow();
        }
        const prompt = event.target.closest("[data-tbh-prompt]");
        if (prompt) { state.selectedTbhPrompt = prompt.dataset.tbhPrompt; renderTbhRequestFlow(); }
        const submit = event.target.closest("[data-send-tbh-request]");
        if (submit) submitTbhRequest(submit);
    });
    $("#tbhRequestDialog").addEventListener("input", (event) => {
        if (event.target.id === "tbhTargetSearch") renderTbhTargetList();
    });
    $("#tbhComposerDialog").addEventListener("click", (event) => {
        if (event.target.closest("[data-close-tbh-composer]")) closeDetailScreen($("#tbhComposerDialog"));
        const starter = event.target.closest("[data-tbh-starter]");
        if (starter) {
            state.selectedTbhStarter = starter.dataset.tbhStarter;
            $("#tbhResponseText").value = state.selectedTbhStarter;
            $("#tbhResponseText").focus();
            updateTbhComposer();
        }
    });
    $("#tbhResponseText").addEventListener("input", updateTbhComposer);
    $("#tbhComposerForm").addEventListener("submit", submitTbhResponse);
    $("#tbhDetailDialog").addEventListener("click", (event) => {
        const commentsTarget = event.target.closest("[data-comments-target]");
        if (commentsTarget) return void openCommentsFromValue(commentsTarget.dataset.commentsTarget);
        if (event.target.closest("[data-close-tbh-detail]")) closeDetailScreen($("#tbhDetailDialog"));
    });
    $("#reactionPickerOptions").addEventListener("click", (event) => {
        const button = event.target.closest("[data-select-reaction]");
        if (!button || !state.reactorTarget) return;
        const [type, id] = state.reactorTarget.split(":");
        const item = reactionItems(type, id)[0];
        const next = item?.current_user_reaction === button.dataset.selectReaction ? null : button.dataset.selectReaction;
        $("#reactionPickerDialog").close();
        setReactionForTarget(state.reactorTarget, next);
    });
    document.addEventListener("pointerdown", (event) => {
        const dialog = $("#reactionPickerDialog");
        if (dialog.open && !event.target.closest("#reactionPickerDialog") && !event.target.closest("[data-reaction-picker]")) dialog.close();
    });
    $("#godModePitchDialog").addEventListener("click", (event) => {
        if (event.target.closest("[data-close-dialog]")) {
            $("#godModePitchDialog").close();
            return;
        }
        const checkoutButton = event.target.closest("[data-start-god-mode]");
        if (checkoutButton) {
            startGodModeCheckout(checkoutButton);
            return;
        }
        if (!event.target.closest("[data-earn-god-mode]")) return;
        $("#godModePitchDialog").close();
        openEarnGodModeDialog();
    });
    $("#godModeEarnChooserDialog").addEventListener("click", (event) => {
        const option = event.target.closest("[data-earn-option]")?.dataset.earnOption;
        if (!option) return;
        $("#godModeEarnChooserDialog").close();
        if (option === "invite") void openInviteFriendsDialog();
        if (option === "creator") openCreatorProgram();
    });
    $("#earnGodModeDialog").addEventListener("click", (event) => {
        const button = event.target.closest("[data-share-god-mode-invite]");
        if (button) shareGodModeInvite(button, button.dataset.shareGodModeInvite);
    });
    $("#pollSummaryDialog").addEventListener("click", (event) => {
        if (event.target.closest("[data-close-top-poll]")) {
            event.preventDefault();
            closeTopPoll();
            return;
        }
        if (event.target.closest("[data-share-top-poll]")) shareTopPoll();
    });
    $("#pollSummaryDialog").addEventListener("cancel", () => { state.selectedTopPoll = null; });
    $("#profilePictureInput").addEventListener("change", changeProfilePicture);
    $("#addPasskeyButton").addEventListener("click", () => addBackupPasskey($("#addPasskeyButton")));
    $("#enrollPasskeyButton").addEventListener("click", () => addBackupPasskey($("#enrollPasskeyButton")));
    $('#blockedUsersButton').addEventListener('click', async () => {
        try {
            const { openBlockedUsers } = await import('./blocked-users.js');
            if (api.user?.id) openBlockedUsers({ api, userId: api.user.id });
        } catch (_) { showToast('Blocked users could not be loaded. Please try again.'); }
    });
    $("#feedbackButton").addEventListener("click", () => openFeedbackDialog());
    $("#feedbackForm").addEventListener("submit", submitFeedback);
    $("#feedbackPhoto").addEventListener("change", (event) => {
        $("#feedbackPhotoName").textContent = event.currentTarget.files[0]?.name || "No screenshot selected";
    });
    $("#classmateDirectorySearch").addEventListener("input", renderClassmateDirectory);
    $("#classmateDirectoryList").addEventListener("click", (event) => {
        const classmate = event.target.closest("[data-directory-classmate]");
        if (classmate) openClassmateProfile(classmate.dataset.directoryClassmate);
    });
    $("#classmateProfileDialog").addEventListener("click", (event) => {
        const menuButton = event.target.closest("[data-toggle-classmate-menu]");
        if (menuButton) toggleDetailActionMenu(menuButton);
        if (event.target.closest("[data-report-classmate]")) { closeDetailActionMenus(); moderateSelectedClassmate("report"); }
        if (event.target.closest("[data-block-classmate]")) { closeDetailActionMenus(); moderateSelectedClassmate("block"); }
        const poll = event.target.closest("[data-top-poll]");
        if (poll) openTopPoll(poll.dataset.topPoll);
    });
    $("#backToClassmatesButton").addEventListener("click", backToClassmates);
    $("#chooseContactsButton").addEventListener("click", chooseContacts);
    $("#shareClassmateInviteButton").addEventListener("click", shareClassmateInvite);
    $("#targetedBoostSearch").addEventListener("input", renderTargetedBoostList);
    $("#targetedBoostList").addEventListener("click", (event) => {
        const row = event.target.closest("[data-targeted-boost]");
        const target = state.targetedBoostClassmates?.find((classmate) => String(classmate.user_id) === String(row?.dataset.targetedBoost));
        if (target) {
            $("#targetedBoostDialog").close();
            openAuraSpend("targeted", target);
        }
    });
    $("#confirmAuraSpend").addEventListener("click", confirmAuraSpend);
    $("#auraSpendDialog").addEventListener("close", () => {
        state.pendingAuraPurchase = null;
    });
    $("#deleteAccountForm").addEventListener("submit", requestAccountDeletion);
    $("#deleteAccountButton").addEventListener("click", () => void beginAccountDeletion());
    $("#cancelDeletionButton").addEventListener("click", cancelAccountDeletion);
    $("#deleteAccountHideFromPolls").addEventListener("click", (event) => {
        const button = event.currentTarget;
        button.setAttribute("aria-checked", String(button.getAttribute("aria-checked") !== "true"));
        haptic("selection");
        renderDeleteAccountDialog();
    });
    $("#installAppButton").addEventListener("click", installWebApp);
    $("#androidInstallButton").addEventListener("click", installWebApp);
    $("#androidInstallDialog").addEventListener("cancel", (event) => event.preventDefault());
    $("#applyAppUpdate").addEventListener("click", () => {
        applyAppUpdate().catch(() => {
            state.appUpdateRequested = false;
            setAppUpdateButton("retry");
        });
    });
    $("#notificationButton").addEventListener("click", openNotificationSettings);
    $("#notificationPermissionButton").addEventListener("click", () => {
        // Asked inside the tap: mobile browsers need the user gesture.
        void toggleWebPush().finally(renderNotificationSettings);
        renderNotificationSettings();
    });
    $("#notificationCategoryCard").addEventListener("click", (event) => {
        const row = event.target.closest("[data-notification-category]");
        if (!row) return;
        haptic("selection");
        void setNotificationCategory(row.dataset.notificationCategory, row.getAttribute("aria-checked") !== "true");
    });
    $("#questionForm").addEventListener("submit", reviewQuestionSubmission);
    $("#questionForm").addEventListener("input", resetQuestionSubmissionIfDraftChanged);
    $("#questionForm").addEventListener("change", resetQuestionSubmissionIfDraftChanged);
    $("#questionSubmitTab").addEventListener("click", () => setQuestionSection("submit"));
    $("#questionHistoryTab").addEventListener("click", () => setQuestionSection("history", { refresh: true }));
    $("#refreshQuestionHistory").addEventListener("click", () => loadQuestionSubmissions());
    $("#questionHistoryList").addEventListener("click", (event) => {
        if (event.target.closest("[data-question-submit-empty]")) setQuestionSection("submit");
        const removal = event.target.closest("[data-remove-question-submission]");
        if (removal) openQuestionRemoval(removal.dataset.removeQuestionSubmission);
    });
    $("#confirmQuestionRemoval").addEventListener("click", confirmQuestionRemoval);
    $("#questionRemovalDialog").addEventListener("close", () => {
        state.questionSubmissionToRemove = null;
        $("#questionRemovalStatus").textContent = "";
    });
    $("#questionImage").addEventListener("change", previewQuestionArtwork);
    $("#adjustQuestionCrop").addEventListener("click", () => openQuestionArtworkCrop(state.questionArtworkSourceFile));
    $("#cancelQuestionCrop").addEventListener("click", cancelQuestionArtworkCrop);
    $("#applyQuestionCrop").addEventListener("click", applyQuestionArtworkCrop);
    $("#questionCropDialog").addEventListener("cancel", (event) => {
        event.preventDefault();
        cancelQuestionArtworkCrop();
    });
    $("#questionCropZoom").addEventListener("input", (event) => {
        if (!state.questionCrop) return;
        state.questionCrop.zoom = Number(event.currentTarget.value);
        renderQuestionCrop();
    });
    $("#questionCropViewport").addEventListener("pointerdown", beginQuestionCropDrag);
    $("#questionCropViewport").addEventListener("pointermove", moveQuestionCrop);
    $("#questionCropViewport").addEventListener("pointerup", endQuestionCropDrag);
    $("#questionCropViewport").addEventListener("pointercancel", endQuestionCropDrag);
    window.addEventListener("resize", renderQuestionCrop);
    $("#confirmQuestionSubmit").addEventListener("click", confirmQuestionSubmission);
    $("#closeQuestionPage").addEventListener("click", () => closeDetailScreen($("#questionDialog")));
    $("#profileForm").addEventListener("submit", saveProfile);
    $("#profileEditorBack").addEventListener("click", () => setProfileEditor("hub"));
    $("#profileEditorCancel").addEventListener("click", cancelProfileEditor);
    $("#profileReviewButton").addEventListener("click", () => setProfileEditor("review"));
    $("#godModeUnsubscribeButton").addEventListener("click", openGodModePlan);
    $("#godModeBillingRow").addEventListener("click", () => void openGodModeBillingPortal());
    $("#godModePlanUnsubscribe").addEventListener("click", () => {
        // "Unsubscribe" is the final intent: only now is the free-week offer checked.
        $("#godModePlanDialog").close();
        void unsubscribeFromGodMode();
    });
    $("#profileSchoolLookup").addEventListener("click", lookupProfileSchools);
    $("#profileSchoolSearch").addEventListener("input", renderProfileSchoolResults);
    $("#profileShowSchoolFallback").addEventListener("click", () => {
        $("#profileSchoolPicker").classList.add("hidden");
        $("#profileSchoolFallback").classList.remove("hidden");
        $("#profileSchoolStatus").textContent = "Enter the school exactly as it should appear.";
        $("#profileSchoolName").focus();
    });
    $("#profileBackToNearby").addEventListener("click", () => {
        $("#profileSchoolFallback").classList.add("hidden");
        $("#profileSchoolPicker").classList.toggle("hidden", !state.profileNearbySchools.length);
        $("#profileSchoolStatus").textContent = state.profileNearbySchools.length ? "Choose a nearby school." : "Enter a ZIP code to find nearby schools.";
    });
    $("#profileRequestSchool").addEventListener("click", requestProfileSchool);
    $("#profileForm").addEventListener("click", (event) => {
        const editor = event.target.closest("[data-profile-editor]");
        if (editor) setProfileEditor(editor.dataset.profileEditor);
        const school = event.target.closest("[data-profile-school]");
        if (school) selectProfileSchool(state.profileNearbySchools.find((candidate) => String(candidate.id) === String(school.dataset.profileSchool)));
        const grade = event.target.closest("[data-profile-grade]");
        if (grade && state.profileDraft) {
            state.profileDraft.grade = grade.dataset.profileGrade;
            renderProfileGradeOptions();
        }
        const done = event.target.closest("[data-profile-done]");
        if (done?.dataset.profileDone === "username") finishProfileUsername();
        if (done?.dataset.profileDone === "name") {
            syncProfileDraftFromInputs();
            $(".profile-name-hint").classList.toggle("invalid", !profileNameIsValid());
            if (profileNameIsValid()) setProfileEditor("hub");
        }
        if (done?.dataset.profileDone === "grade" && profileGradeIsValid()) setProfileEditor("hub");
        const gender = event.target.closest("[data-profile-gender]");
        if (gender && state.profileDraft) {
            state.profileDraft.gender = gender.dataset.profileGender;
            renderProfileGenderOptions();
        }
        if (done?.dataset.profileDone === "gender" && profileGenderIsValid()) setProfileEditor("hub");
    });
    $("#profileFirstName").addEventListener("input", (event) => {
        event.target.value = event.target.value.replace(/[^\p{L}' -]/gu, "");
        syncProfileDraftFromInputs();
        $(".profile-name-hint").classList.toggle("invalid", !profileNameIsValid());
    });
    $("#profileLastName").addEventListener("input", (event) => {
        event.target.value = event.target.value.replace(/[^\p{L}' -]/gu, "");
        syncProfileDraftFromInputs();
        $(".profile-name-hint").classList.toggle("invalid", !profileNameIsValid());
    });
    $("#profileUsername").addEventListener("input", (event) => {
        event.target.value = event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
        syncProfileDraftFromInputs();
        state.profileCheckedUsername = state.profileDraft.username === profileOriginalInformation().username ? state.profileDraft.username : null;
        $("#profileUsernameStatus").textContent = profileUsernameIsValid() ? "" : "Use 3–30 lowercase letters, numbers, or underscores.";
    });
    $("#profileDialog").addEventListener("cancel", (event) => {
        event.preventDefault();
        cancelProfileEditor();
    });
    $("#streakCelebration").addEventListener("click", hideStreakCelebration);
    $("#bioForm").addEventListener("submit", saveBio);
    $("#profileBio").addEventListener("input", renderBioCount);
    $$("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
    addEventListener("valid:session-expired", () => showSignedOut("Your session expired. Sign in with your passkey again."));
    addEventListener("popstate", handleAppPopState);
    addEventListener("offline", updateNetworkStatus);
    addEventListener("online", updateNetworkStatus);
    addEventListener("online", retryPendingPlaySkips);
    addEventListener("online", () => { if (sessionRestorePending) void restoreOrStartAuthFlow(); });
    $("#retrySessionButton").addEventListener("click", restoreOrStartAuthFlow);
    addEventListener("focus", checkStripeCheckout);
    addEventListener("focus", () => refreshWebPushStatus());
    document.addEventListener("visibilitychange", () => {
        clearInterval(state.playLockTimer);
        state.playLockTimer = null;
        const tick = state.playLockTick;
        if (!document.hidden && tick) {
            tick();
            if (state.playLockTick === tick) state.playLockTimer = setInterval(tick, 1000);
        }
        if (document.visibilityState === "visible") {
            refreshWebPushStatus();
            refreshAskSafetyState();
            refreshFeedIfStale(FEED_FOREGROUND_REFRESH_MS);
            void refreshConfig();
            void refreshBanner();
            // Reset the worker's push counter to what the app shows now.
            state.syncedBadgeCount = null;
        }
        if (document.body.classList.contains("authenticated")) {
            renderTabBadges();
            if (state.activePanel === "feed") renderFeed();
        }
    });
    $("#appView").addEventListener("touchstart", beginPullRefresh, { passive: true });
    $("#appView").addEventListener("touchmove", movePullRefresh, { passive: true });
    $("#appView").addEventListener("touchend", endPullRefresh, { passive: true });
    $("#appView").addEventListener("touchcancel", () => {
        state.pullRefreshDistance = 0;
        void endPullRefresh();
    }, { passive: true });
    addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        state.installPrompt = event;
        $("#installAppButton").classList.remove("hidden");
        if ($("#androidInstallDialog").open) {
            $("#androidInstallStatus").textContent = "Chrome is ready to install Valid.";
        }
    });
    addEventListener("appinstalled", () => {
        state.installPrompt = null;
        finishAndroidInstall();
        showToast("Valid is on your home screen");
    });
}

let authFlowStarted = false;
let sessionRestorePending = false;
let sessionRestoreInFlight = false;

function startApp() {
    // Start the session check before wiring the UI so a returning user's
    // request is on the network as early as possible; its result lands after
    // this synchronous setup.
    if (!passkeysSupported() && !demoMode) {
        $("#passkeyButton").disabled = true;
        $("#authStatus").textContent = "This browser does not support passkeys. Try current Chrome, Safari, or Edge.";
        showAuthBrowserHelp({ code: 'passkeys_unavailable' }, false);
    }
    const androidInstallGate = androidInstallRequested();
    if (!androidInstallGate) restoreOrStartAuthFlow();
    $$('[data-share-anonymous], [data-share-feed-platform]').forEach((button) => {
        const platform = button.dataset.shareAnonymous || button.dataset.shareFeedPlatform;
        const label = platform ? `${platform[0].toUpperCase()}${platform.slice(1)}` : "Share";
        button.innerHTML = `${shareIconMarkup(platform)}${button.classList.contains("expanded") ? `<span>Share on ${escapeHTML(label)}</span>` : ""}`;
    });
    syncVisualViewport();
    window.visualViewport?.addEventListener("resize", scheduleVisualViewportSync);
    window.visualViewport?.addEventListener("scroll", scheduleVisualViewportSync);
    addEventListener("resize", scheduleVisualViewportSync);
    document.addEventListener("focusin", () => {
        scheduleVisualViewportSync();
        setTimeout(keepFocusedControlVisible, 250);
    });
    document.addEventListener("focusout", () => {
        scheduleVisualViewportSync();
        scheduleStaleViewportCheck();
    });
    window.visualViewport?.addEventListener("resize", scheduleStaleViewportCheck);
    window.visualViewport?.addEventListener("scroll", scheduleStaleViewportCheck);
    addEventListener("pageshow", scheduleStaleViewportCheck);
    addEventListener("orientationchange", scheduleStaleViewportCheck);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") scheduleStaleViewportCheck();
    });
    bindEvents();
    installNativeSheetGestures();
    initializeParkedUI();
    if (!navigator.onLine) updateNetworkStatus();
    if ("serviceWorker" in navigator) {
        if (!demoMode) registerAppServiceWorker();
        navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);
        addEventListener("valid:active-chat", reportActiveChat);
        document.addEventListener("visibilitychange", reportActiveChat);
        navigator.serviceWorker.addEventListener("controllerchange", reportActiveChat);
    }
    renderIOSInstallRow();
    if (androidInstallGate) {
        showAuthView();
        showAndroidInstallGate();
    } else if (iosInstallAvailable() && new URLSearchParams(location.search).get("install") === "1") void openIOSInstall();
}

async function restoreOrStartAuthFlow() {
    if (sessionRestoreInFlight || (authFlowStarted && !sessionRestorePending)) return;
    authFlowStarted = true;
    if (!demoMode) {
        sessionRestoreInFlight = true;
        // Keep the launch splash while the session is unknown; a very slow check
        // falls back to the sign-in card with its "Checking your session" status.
        clearTimeout(state.launchSplashTimer);
        state.launchSplashTimer = setTimeout(showAuthView, 6_000);
        const revision = api.sessionRevision;
        $("#retrySessionButton").disabled = true;
        $("#createAccountButton").classList.add("hidden");
        $("#authStatus").textContent = "Checking your session…";
        try {
            const session = await api.restoreSession();
            // An explicit sign-in completed while this older read was in flight.
            if (api.sessionRevision !== revision) return;
            if (!session?.user?.id) throw new Error("Incomplete session response");
            api.saveSession(session);
            $("#authStatus").textContent = "";
            await showSignedIn();
            return;
        } catch (error) {
            if (api.hasSession()) return;
            showAuthView();
            if (!error.confirmedSessionInvalid) {
                sessionRestorePending = true;
                $("#retrySessionButton").classList.remove("hidden");
                $("#authStatus").textContent = navigator.onLine === false
                    ? "You’re offline. Reconnect to restore your session."
                    : "We couldn’t check your session. Reconnect and try again; you don’t need to create another account.";
                return;
            }
            sessionRestorePending = false;
            $("#retrySessionButton").classList.add("hidden");
            $("#createAccountButton").classList.remove("hidden");
            $("#authStatus").textContent = "";
        } finally {
            sessionRestoreInFlight = false;
            $("#retrySessionButton").disabled = false;
        }
    }
    showAuthView();
    // Returning users whose cookie expired land on "Welcome Back"; only an
    // explicit ?signup=1 or a first-ever visit opens account creation.
    const authParams = new URLSearchParams(window.location.search);
    if (authParams.get("signup") === "1" || (!demoMode && authParams.get("signin") !== "1" && isFirstVisit())) {
        requestAnimationFrame(openSignupDialog);
    }
}

if (demoMode) {
    import("./demo-api.js").then(({ DemoAPI }) => {
        api = new DemoAPI();
        startApp();
    });
} else startApp();
