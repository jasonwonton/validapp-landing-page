import { ValidAPI } from "./api.js";
import { DemoAPI, localDemoAllowed } from "./demo-api.js";
import { createAdditionalPasskey, createSignupPasskey, passkeysSupported, signInWithPasskey } from "./passkeys.js";
import { startPerformanceMonitoring } from "./performance.js";
import { createRealtimeList } from "./realtime-list.js";
import { activateRoute, preloadRoute } from "./routes/route-loader.js";
import { clearRuntimeStyles, setRuntimeStyles } from "./runtime-style.js";

const demoMode = localDemoAllowed();
const api = demoMode ? new DemoAPI() : new ValidAPI();
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
    playLocked: null,
    playComplete: false,
    playAuraEarned: 0,
    skipsUsedInSet: 0,
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
    signupStep: 0,
    signupNearbySchools: [],
    signupSelectedSchool: null,
    signupSchoolFallback: false,
    signupSchoolLookupGeneration: 0,
    signupPhoneVerified: false,
    signupVerifiedPhone: null,
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
    installPrompt: null,
    webPushSubscription: null,
    webPushBusy: false,
    webPushRegistrationState: "off",
    webPushRegistrationError: "",
    detailReturnFocus: null,
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

let feedRealtimeRenderFrame = null;

function applyFeedRealtimeEvent(event) {
    feedItemsStore.apply(event);
    if (feedRealtimeRenderFrame !== null) return;
    feedRealtimeRenderFrame = requestAnimationFrame(() => {
        feedRealtimeRenderFrame = null;
        state.feedItems = feedItemsStore.snapshot();
        if (state.activePanel === "feed" && document.body.classList.contains("authenticated")) renderFeed();
    });
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
    return nativeShowModal.call(this);
};

function friendlyErrorMessage(error, fallback = "Something went wrong. Please try again.") {
    const raw = typeof error === "string" ? error : error?.message;
    const message = String(raw || "").trim();
    if (!message || /<!doctype|<html|<body|<head/i.test(message) || message.length > 240) return fallback;
    return message;
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
    if (Array.isArray(cachedFeed)) commitFeedItems(cachedFeed, { reset: true });
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
    const payload = { validApp: true, panel: state.activePanel, detail };
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
    if (!document.body.classList.contains("authenticated")) return;
    state.handlingPopState = true;
    closeVisibleDetailScreens({ fromHistory: true });
    const requestedPanel = event.state?.panel || new URLSearchParams(location.search).get("tab");
    const panel = ["feed", "play", "chats", "profile"].includes(requestedPanel) ? requestedPanel : "feed";
    switchPanel(panel, { historyMode: "none", restoreScroll: true });
    const detail = event.state?.detail ? document.getElementById(event.state.detail) : null;
    if (detail?.classList.contains("detail-screen")) openDetailScreen(detail, { historyMode: "none" });
    state.handlingPopState = false;
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
    setRuntimeStyles(document.documentElement, {
        "--visual-viewport-bottom": `${bottomInset}px`,
        "--visual-viewport-top": `${viewport.offsetTop}px`,
        "--visual-viewport-left": `${viewport.offsetLeft}px`,
        "--visual-viewport-center": `${viewport.offsetLeft + viewport.width / 2}px`,
        "--visual-viewport-middle": `${viewport.offsetTop + viewport.height / 2}px`,
        "--visual-viewport-width": `${viewport.width}px`,
        "--visual-viewport-height": `${viewport.height}px`,
        "--signup-visual-offset": `${viewport.offsetTop}px`,
    });
    document.documentElement.classList.toggle("keyboard-open", keyboardOpen);
    if (keyboardOpen) requestAnimationFrame(keepFocusedControlVisible);
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

function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(showToast.timeout);
    showToast.timeout = setTimeout(() => toast.classList.remove("visible"), 2800);
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
    const fallbackImageURL = originalURL && originalURL !== imageURL ? originalURL : null;
    const name = displayName(profile);
    const fallbackInitials = initials(profile);
    return `<span class="${className}">${imageURL
        ? `<img loading="lazy" decoding="async" src="${escapeHTML(imageURL)}" alt="${escapeHTML(name)}" data-avatar-image data-avatar-initials="${escapeHTML(fallbackInitials)}"${fallbackImageURL ? ` data-avatar-fallback="${escapeHTML(fallbackImageURL)}"` : ""}>`
        : `<span>${escapeHTML(fallbackInitials)}</span>`}</span>`;
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

function handleAvatarImageError(event) {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.matches("[data-avatar-image]")) return;
    const fallbackURL = image.dataset.avatarFallback;
    if (fallbackURL && image.src !== fallbackURL) {
        delete image.dataset.avatarFallback;
        image.src = fallbackURL;
        return;
    }
    const fallback = document.createElement("span");
    fallback.textContent = image.dataset.avatarInitials || "V";
    image.replaceWith(fallback);
}

function shareIconMarkup(platform) {
    if (platform === "instagram") {
        return `<svg viewBox="0 0 64 64" role="img" aria-label="Instagram"><rect x="15" y="15" width="34" height="34" rx="10" fill="none" stroke="white" stroke-width="4"/><circle cx="32" cy="32" r="8" fill="none" stroke="white" stroke-width="4"/><circle cx="44" cy="20" r="2.5" fill="white"/></svg>`;
    }
    if (platform === "tiktok") {
        return `<svg viewBox="0 0 64 64" role="img" aria-label="TikTok"><rect width="64" height="64" rx="15" fill="#000"/><path d="M37 14c1 7 5 11 12 12v8c-5 0-9-2-12-4v13c0 9-7 14-15 12-7-2-11-9-9-16 2-6 7-10 14-10v8c-4 0-6 2-6 5 0 4 3 6 6 5 2-1 3-3 3-6V14h7Z" fill="#25f4ee" transform="translate(-2 1)"/><path d="M39 13c1 7 5 11 12 12v7c-5 0-9-2-12-4v14c0 8-7 14-15 12-6-2-10-8-9-14 1-7 7-11 14-11v7c-4 0-6 2-6 5 0 4 3 6 6 5 2-1 3-3 3-6V13h7Z" fill="#fe2c55" transform="translate(2 -1)"/><path d="M38 14c1 6 5 10 11 11v6c-4 0-8-1-11-4v14c0 7-6 12-13 11-6-1-10-7-8-13 1-5 5-8 11-8v6c-3 0-5 2-5 5 0 3 3 5 6 4 2-1 3-3 3-6V14h6Z" fill="#fff"/></svg>`;
    }
    return `<img loading="lazy" decoding="async" src="../assets/app/snapchat-logo.webp" alt="Snapchat">`;
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
    screen.classList.remove("hidden");
    screen.classList.remove("detail-screen-closing");
    screen.classList.add("detail-screen-opening");
    screen.scrollTop = 0;
    document.body.classList.add("detail-screen-open");
    if (historyMode !== "none" && history.state?.detail !== screen.id) writeNavigationState(historyMode, screen.id);
    requestAnimationFrame(() => screen.classList.remove("detail-screen-opening"));
    screen.querySelector("[aria-label='Close']")?.focus({ preventScroll: true, focusVisible: false });
}

function closeDetailScreen(screen, { fromHistory = false } = {}) {
    closeDetailActionMenus();
    screen.classList.add("hidden");
    if (!$(".detail-screen:not(.hidden)")) document.body.classList.remove("detail-screen-open");
    state.detailReturnFocus?.focus?.({ preventScroll: true });
    state.detailReturnFocus = null;
    if (!fromHistory && history.state?.detail === screen.id) history.back();
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
    clearInterval(state.playLockTimer);
    state.playLockTimer = null;
    stopStripeCheckoutPolling();
    $("#authView").classList.remove("hidden");
    $("#appView").classList.add("hidden");
    $("#bottomNav").classList.add("hidden");
    $("#logoutButton").classList.add("hidden");
    document.body.classList.remove("authenticated", "play-active");
    state.navigationInitialized = false;
    state.tabScrollPositions = { feed: 0, play: 0, chats: 0, profile: 0 };
    $("#authStatus").textContent = friendlyErrorMessage(message, "");
}

async function showSignedIn() {
    $("#authView").classList.add("hidden");
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
            })),
        ]);
        api.user = { ...api.user, ...currentUser };
        state.profile = profile;
        state.classmatesStatus = classmatesStatus;
        state.config = config;
        const chatsEnabled = config.enable_chats === true && config.enable_web_chats === true;
        $('.nav-item[data-panel="chats"]').classList.toggle("hidden", !chatsEnabled);
        $("#bottomNav").classList.toggle("chats-enabled", chatsEnabled);
        writeAppCache("profile", profile);
        renderProfileHeader();
        renderFeedGate();
        initializeAppNavigation();
        refreshWebPushStatus({ sync: true });
        if (!isFeedVoteLocked()) await loadFeed(true);
        await handleNotificationRoute();
        if (api.user?.deletion_requested_at) showPendingDeletion();
        void deferredAccountState.then(([askAccess, askSafetyNotices, askSafetyNoticeHistory, passkeyStatus]) => {
            state.askAccess = askAccess;
            state.askSafetyNotices = askSafetyNotices;
            state.askSafetyNoticeHistory = askSafetyNoticeHistory;
            state.passkeyStatus = passkeyStatus;
            renderPasskeyStatus();
            if (!api.user?.deletion_requested_at) showNextAskSafetyNotice();
            maybePromptForPasskeyEnrollment();
        });
    } catch (error) {
        if (error.status !== 401) $("#feedStatus").textContent = error.message || "Could not load your profile.";
    }
}

async function handleNotificationRoute() {
    const params = new URLSearchParams(location.search);
    const notification = params.get("notification");
    if (!notification) return;
    if (isFeedVoteLocked() && notification !== "question_submission") return;
    switchPanel("feed");
    if (notification === "question_submission") {
        openQuestionDialog({ section: "history", submissionId: params.get("submission_id") });
    } else if (notification === "tbh_request") {
        await loadTbhContent();
        const requestId = params.get("tbh_request_id");
        if (state.tbhPendingRequests.some((item) => String(item.id) === String(requestId))) openTbhComposer(requestId);
    } else if (notification === "tbh_response") {
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
        if (kind) openTbhDetail(`${kind}:${responseId}`);
    } else if (notification === "feed_item") {
        const answerId = params.get("question_answer_id");
        if (!state.feedItems.some((item) => String(item.question_answer_id) === String(answerId))) {
            const item = await api.getFeedItem(api.user.id, answerId).catch(() => null);
            if (item) state.feedItems.unshift(item);
        }
        if (state.feedItems.some((item) => String(item.question_answer_id) === String(answerId))) openFeedDetail(answerId);
    }
    params.delete("notification");
    params.delete("tbh_request_id");
    params.delete("tbh_response_id");
    params.delete("question_answer_id");
    params.delete("submission_id");
    history.replaceState(history.state, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
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
    const imageURL = api.assetURL(profile.profile_picture_url_thumb || profile.profile_picture_url);
    $("#questionIdentityName").textContent = displayName(profile);
    $("#questionIdentityAvatar").innerHTML = imageURL
        ? `<img loading="lazy" decoding="async" src="${escapeHTML(imageURL)}" alt="">`
        : escapeHTML(initials(profile));
}

function formatGrade(value = "") {
    return String(value).replace("S/O", "C/O").replace("Grade ", "");
}

function voterFirstLetterHint(item) {
    const hint = String(item?.voter_first_letter_hint || "").trim();
    return Array.from(hint)[0]?.toLocaleUpperCase() || "";
}

function formatVoterHint(item) {
    if (item.current_user_voted) return `from ${displayName(state.profile)} (you 🫵)`;
    if (item.voter_name) return `from ${item.voter_name}`;
    const firstLetter = voterFirstLetterHint(item);
    const firstLetterSuffix = firstLetter ? ` (${firstLetter})` : "";
    const gender = String(item.voter_gender || "").toLowerCase();
    const emoji = ["female", "girl"].includes(gender) ? "👧💗" : ["male", "boy"].includes(gender) ? "👦💙" : gender === "non-binary" ? "🧑💛" : "";
    const grade = formatGrade(item.voter_grade || "");
    if (grade) return `from ${emoji} ${grade}${firstLetterSuffix}`.replace(/\s+/g, " ");
    if (emoji) return `from ${emoji}${firstLetterSuffix}`;
    return firstLetter ? `from someone (${firstLetter})` : "";
}

function formatVoterDemographicsStatement(item) {
    const gender = String(item.voter_gender || "").toLowerCase();
    const emoji = ["female", "girl"].includes(gender) ? "👧💗" : ["male", "boy"].includes(gender) ? "👦💙" : gender === "non-binary" ? "🧑💛" : "";
    const genderWord = ["female", "girl"].includes(gender) ? "Girl" : ["male", "boy"].includes(gender) ? "Boy" : gender === "non-binary" ? "Person" : "";
    const rawGrade = formatGrade(item.voter_grade || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
    const normalizedGrade = rawGrade.toLowerCase();
    const grade = normalizedGrade.includes("6th") || normalizedGrade === "6" || normalizedGrade.startsWith("grade 6")
        ? "6th grader"
        : normalizedGrade.includes("7th") || normalizedGrade === "7" || normalizedGrade.startsWith("grade 7")
            ? "7th grader"
            : normalizedGrade.includes("8th") || normalizedGrade === "8" || normalizedGrade.startsWith("grade 8")
                ? "8th grader"
                : normalizedGrade.includes("9th") || normalizedGrade.includes("freshman") || normalizedGrade === "9" || normalizedGrade.startsWith("grade 9")
                    ? "Freshman"
                    : normalizedGrade.includes("10th") || normalizedGrade.includes("sophomore") || normalizedGrade === "10" || normalizedGrade.startsWith("grade 10")
                        ? "Sophomore"
                        : normalizedGrade.includes("11th") || normalizedGrade.includes("junior") || normalizedGrade === "11" || normalizedGrade.startsWith("grade 11")
                            ? "Junior"
                            : normalizedGrade.includes("12th") || normalizedGrade.includes("senior") || normalizedGrade === "12" || normalizedGrade.startsWith("grade 12")
                                ? "Senior"
                                : rawGrade;
    const article = /^[aeiou8]/i.test(grade) || /^(11|18)/.test(grade) ? "An" : "A";
    if (grade && genderWord) return `${article} ${grade} ${emoji} ${genderWord} said`;
    if (genderWord) return `A ${emoji} ${genderWord} said`;
    return "Poll";
}

function formatVoterStatement(item) {
    if (item.current_user_voted) return `${displayName(state.profile)} said`;
    if (item.voter_name) return `${item.voter_name} said`;
    return formatVoterDemographicsStatement(item);
}

function renderProfilePolls(container, questions, emptyMessage) {
    if (!questions?.length) {
        container.innerHTML = `<div class="profile-poll-empty">${escapeHTML(emptyMessage)}</div>`;
        return;
    }
    container.innerHTML = questions.map((question, index) => {
        const imageURL = api.assetURL(question.image_url);
        const pollKey = `${question.question_id || question.id || index}`;
        return `<button class="profile-poll-row" type="button" data-top-poll="${escapeHTML(pollKey)}" aria-label="Open poll: ${escapeHTML(question.question_text)}">
            <div class="profile-poll-art">${imageURL ? `<img loading="lazy" decoding="async" src="${escapeHTML(imageURL)}" alt="">` : `<span>${index + 1}</span>`}</div>
            <div class="profile-poll-copy"><strong>${escapeHTML(question.question_text)}</strong><span>♥ ${Number(question.vote_count || 0).toLocaleString()} votes</span></div>
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
    const nextChangeDate = profile.next_information_change_at ? new Date(profile.next_information_change_at) : null;
    const informationStatus = !canChangeInformation
        ? (nextChangeDate && !Number.isNaN(nextChangeDate.getTime())
            ? `Available again ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(nextChangeDate)}`
            : "Profile change currently unavailable")
        : "";
    const streak = Math.max(0, Number(profile.current_streak || 0));
    const hasProfilePhoto = Boolean(imageURL && !String(profile.profile_picture_url || "").includes("default.png"));
    $("#profileCard").innerHTML = `<article class="full-profile-card">
        <button class="profile-photo-button" type="button" data-edit-photo aria-label="Change profile picture">
            <span class="full-profile-avatar">${imageURL ? `<img loading="lazy" decoding="async" src="${escapeHTML(imageURL)}" alt="${escapeHTML(displayName(profile))}">` : `<span>${escapeHTML(initials(profile))}</span>`}</span>
            <span class="photo-edit-badge" aria-hidden="true">✎</span>
        </button>
        ${hasProfilePhoto ? "" : '<p class="profile-photo-warning">⚠️ Users without profile pictures receive less votes.</p>'}
        <h3>${escapeHTML(displayName(profile))}</h3>
        <div class="profile-identity-line"><span class="profile-handle">@${escapeHTML(profile.username || "valid")}</span>${streak ? `<span class="profile-streak ${profile.streak_needs_activity ? "needs-activity" : ""}" aria-label="${streak} day streak">🔥 ${streak}</span>` : ""}</div>
        <button class="profile-bio-button ${profile.bio ? "" : "empty"}" type="button" data-edit-bio>${profile.bio ? escapeHTML(profile.bio) : '<span>Add bio</span><span class="profile-add-bio-icon" aria-hidden="true">+</span>'}</button>
        ${(schoolName || grade) ? `<div class="profile-school-meta">${schoolName ? `<span class="profile-school-meta-item"><img loading="lazy" decoding="async" src="../assets/app/profile-school.svg" alt=""><span>${escapeHTML(schoolName)}</span></span>` : ""}${grade ? `<span class="profile-school-meta-item"><img loading="lazy" decoding="async" src="../assets/app/profile-graduation-cap.svg" alt=""><span>${escapeHTML(grade)}</span></span>` : ""}</div>` : ""}
        <button class="profile-information-inline" type="button" data-edit-profile>
            <span class="profile-information-icon">${profileInformationIcon(canChangeInformation)}</span>
            <span class="profile-information-copy"><strong>Profile information</strong>${informationStatus ? `<small>${escapeHTML(informationStatus)}</small>` : ""}</span>
            <span class="profile-information-chevron" aria-hidden="true">›</span>
        </button>
        <div class="profile-stats-grid">
            <div class="profile-stat-card"><strong><img loading="lazy" decoding="async" class="profile-aura-icon" src="../assets/app/aura.webp" alt="">${Number(profile.aura_points || 0).toLocaleString()}</strong><span>Aura</span></div>
            <div class="profile-stat-card"><strong><span class="heart">♥</span>${Number(profile.vote_count || 0).toLocaleString()}</strong><span>Votes Received</span></div>
        </div>
    </article>`;
    renderSchoolCard();
    renderGodModeCard();
    renderAuraPurchases();
    renderProfileInviteCard();
    renderPasskeyStatus();
    renderTabBadges();
}

function renderSchoolCard() {
    const container = $("#schoolCard");
    const classmates = [...(state.classmateDirectory?.length ? state.classmateDirectory : (state.classmates || []))];
    const activeClassmates = Number(state.activeClassmatesThisWeek);
    const activeClassmatesLabel = Number.isFinite(activeClassmates) && activeClassmates > 5
        ? `<small>• ${activeClassmates.toLocaleString()} classmates active this week</small>`
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
        ${ranked.length ? `<div class="school-leaderboard" role="list" aria-label="Classmates ranked by weekly votes">${ranked.map((classmate, index) => {
            const isCurrentUser = String(classmate.user_id) === String(state.profile?.user_id);
            return `<button class="school-rank-card" type="button" role="listitem" ${isCurrentUser ? `disabled aria-current="true"` : `data-school-classmate="${escapeHTML(classmate.user_id)}"`} aria-label="#${index + 1} ${escapeHTML(displayName(classmate))}, ${Number(classmate.weekly_vote_count || 0).toLocaleString()} votes this week">
                <span class="school-rank-number">#${index + 1}</span>
                ${avatarMarkup(classmate, "school-rank-avatar")}
                <strong>${escapeHTML(isCurrentUser ? `${displayName(classmate)} (You)` : displayName(classmate))}</strong>
                <small><span aria-hidden="true">♥</span> ${Number(classmate.weekly_vote_count || 0).toLocaleString()} this week</small>
            </button>`;
        }).join("")}</div>` : `<p>No classmates on Valid yet.</p>`}
        <div class="school-card-actions"><button id="findContactsButton" class="secondary-button" type="button">Contacts</button><button id="viewClassmatesButton" class="secondary-button" type="button">Classmates</button></div>
    </article>`;
}

function renderProfileInviteCard() {
    const container = $("#profileInviteCard");
    const status = state.inviteStatus;
    const goal = Math.max(1, Number(status?.aura_reward_goal || 3));
    const progress = Math.max(0, Math.min(goal, Number(status?.aura_reward_progress || 0)));
    const remaining = Math.max(0, goal - progress);
    container.innerHTML = `<article class="profile-invite-card">
        <div><strong>${remaining ? `Invite ${remaining} more ${remaining === 1 ? "friend" : "friends"}` : "Invite reward complete"}</strong><p>Bring friends to Valid and earn bonus aura when they join.</p></div>
        <div class="profile-invite-progress"><span><strong>${progress} / ${goal}</strong><small>qualifying invites</small></span><progress max="${goal}" value="${progress}" aria-label="${progress} of ${goal} qualifying invites"></progress></div>
        <div class="profile-invite-actions"><button class="profile-share-button snapchat" type="button" data-profile-invite="snapchat"><img loading="lazy" decoding="async" src="../assets/app/snapchat-logo.webp" alt=""><span>Snapchat</span></button><button class="profile-share-button messages" type="button" data-profile-invite="imessage">${appSymbolMarkup("message", "messages-symbol")}<span>Messages</span></button></div>
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

function personalInboxUnreadCounts() {
    const polls = state.feedItems.filter((item) => item.is_new === true || item.unread === true).length;
    const tbhs = state.tbhPendingRequests.filter((item) => !item.opened_at).length
        + state.tbhInboxItems.filter((item) => !item.opened_at).length;
    const askMe = (state.anonymousInbox?.questions || []).filter((item) => !item.opened_at).length;
    return { all: polls + tbhs + askMe, polls, tbhs, ask_me: askMe };
}

function renderTabBadges() {
    const unread = personalInboxUnreadCounts().all;
    const feedBadge = $("#feedTabBadge");
    feedBadge.textContent = unread > 9 ? "9+" : String(unread || "");
    feedBadge.classList.toggle("hidden", unread < 1);
    if ("setAppBadge" in navigator) {
        const totalUnread = unread + Number(state.chatUnreadCount || 0);
        const badgePromise = totalUnread > 0 ? navigator.setAppBadge(totalUnread) : navigator.clearAppBadge?.();
        Promise.resolve(badgePromise).catch(() => null);
    }
    const profileIncomplete = !state.profile?.profile_picture_url || !String(state.profile?.bio || "").trim();
    $("#profileTabBadge").classList.toggle("hidden", !profileIncomplete);
}

function renderChatUnreadBadge(count) {
    state.chatUnreadCount = Math.max(0, Number(count || 0));
    const badge = $("#chatsTabBadge");
    badge.textContent = state.chatUnreadCount > 9 ? "9+" : String(state.chatUnreadCount || "");
    badge.classList.toggle("hidden", state.chatUnreadCount < 1);
    renderTabBadges();
}

function renderPasskeyStatus() {
    const count = Math.max(0, Number(state.passkeyStatus?.credentialCount || 0));
    const registered = state.passkeyStatus?.registered === true || count > 0;
    const button = $("#addPasskeyButton");
    button.classList.toggle("hidden", !state.passkeyStatus);
    renderProfileActionsVisibility();
    if (!state.passkeyStatus) return;
    button.querySelector("strong").textContent = registered ? "Add another passkey" : "Register a passkey";
    $("#passkeyStatusText").textContent = registered
        ? `${count} ${count === 1 ? "passkey" : "passkeys"} registered`
        : "Add a secure way to sign in";
}

function renderProfileActionsVisibility() {
    const section = $("#addPasskeyButton").closest(".profile-actions");
    section.classList.toggle("hidden", [...section.querySelectorAll(".settings-row")].every((row) => row.classList.contains("hidden")));
}

function renderGodModeCard() {
    const active = api.user?.subscribed_user === true;
    const multiplier = Math.max(1, Number(state.profile?.god_mode_aura_multiplier || 2));
    const remainingReveals = Math.max(0, Number(state.profile?.remaining_reveals || 0));
    const weeklyReveals = Math.max(1, Number(state.config?.max_full_reveals_per_week || 2));
    const weeklyPrice = Math.max(0, Number(state.config?.god_mode_price || 6.99));
    $("#godModeCard").innerHTML = `<article class="god-mode-card ${active ? "active" : ""}">
        <div class="god-mode-title"><span><img loading="lazy" decoding="async" src="../assets/app/crown.webp" alt=""></span><div><strong>${active ? "God Mode Active" : "God Mode"}</strong><small>${active ? "Everything unlocked" : `$${weeklyPrice.toFixed(2)} / week`}</small></div>${active ? `<span class="god-mode-active">✨ Active</span>` : ""}</div>
        <p class="god-mode-benefits-heading">${active ? "You're enjoying:" : "Go legendary with:"}</p>
        <ul><li>${weeklyReveals} weekly reveals to see exactly who voted.</li><li>First-letter hints on every poll.</li><li>${multiplier}× aura on every answer you give.</li><li>Get boosted to the top of classmates' polls.</li></ul>
        ${active
        ? `<p>Your subscription is recognized on web · ${remainingReveals} weekly ${remainingReveals === 1 ? "reveal" : "reveals"} left. Billing stays with the store where you subscribed.</p>`
        : `<button class="god-mode-start-button" type="button" data-open-god-mode><span><strong>Start God Mode</strong><small>$${weeklyPrice.toFixed(2)} per week</small></span></button>`}
    </article>`;
}

function hasActiveGodMode() {
    return api.user?.subscribed_user === true;
}

function godModeInviteProgressLabel() {
    const status = state.inviteStatus;
    if (!status) return "Loading invite progress...";
    const goal = Math.max(1, Number(status.aura_reward_goal || 1));
    const maxReached = status.aura_reward_max_reached === true;
    const progress = maxReached
        ? goal
        : Math.max(0, Math.min(goal, Number(status.aura_reward_progress || 0)));
    return `${progress} / ${goal} qualifying invites`;
}

function syncGodModeCarouselDots() {
    const carousel = $(".god-mode-benefit-carousel");
    if (!carousel) return;
    const cards = $$(".god-mode-benefit-card");
    if (!cards.length) return;
    const activeIndex = Math.max(0, Math.min(cards.length - 1, Math.round(carousel.scrollLeft / Math.max(1, carousel.clientWidth))));
    $$(".god-mode-page-dots span").forEach((dot, index) => dot.classList.toggle("active", index === activeIndex));
}

function renderGodModePitch() {
    const weeklyReveals = Math.max(1, Number(state.config?.max_full_reveals_per_week || 2));
    const weeklyPrice = Math.max(0, Number(state.config?.god_mode_price || 6.99));
    const multiplier = Math.max(1, Number(state.profile?.god_mode_aura_multiplier || 2));
    const revealNames = ["Sydney Sweeney", "LaMelo Ball", "Jordan Lee", "Taylor Swift"];
    $("#godModePitchBody").innerHTML = `<div class="god-mode-pitch-topbar"><button class="god-mode-close-button" type="button" data-close-dialog aria-label="Close God Mode">×</button></div>
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
                <h3>${weeklyReveals} Reveals / Week</h3><p>See the full names on ${weeklyReveals} polls every week.</p>
            </article>
            <article class="god-mode-benefit-card"><img loading="lazy" decoding="async" class="god-mode-benefit-image scroll" src="../assets/app/scroll.webp" alt=""><h3>First-Letter Hints</h3><p>Get the first letter on every personal poll automatically.</p></article>
            <article class="god-mode-benefit-card"><img loading="lazy" decoding="async" class="god-mode-benefit-image aura" src="../assets/app/aura.webp" alt=""><h3>${multiplier}× Aura Boost</h3><p>Earn ${multiplier === 2 ? "double" : `${multiplier}×`} aura for every answer you give in Play.</p></article>
            <article class="god-mode-benefit-card"><img loading="lazy" decoding="async" class="god-mode-benefit-image rocket" src="../assets/app/rocket.webp" alt=""><h3>Get boosted</h3><p>Get boosted to the top of your classmates' polls to see what they think of you.</p></article>
        </div>
        <div class="god-mode-page-dots" aria-hidden="true"><span class="active"></span><span></span><span></span><span></span></div>
        <div class="god-mode-pitch-actions">
            <button class="god-mode-earn-button" type="button" data-earn-god-mode><strong>Earn God Mode</strong><small id="godModeInviteProgress">${escapeHTML(godModeInviteProgressLabel())}</small></button>
            <button class="god-mode-checkout-button" type="button" data-start-god-mode><span><strong>Start God Mode</strong><small>$${weeklyPrice.toFixed(2)} per week</small></span></button>
            <button class="god-mode-maybe-button" type="button" data-close-dialog>Maybe later</button>
            <p id="godModeCheckoutStatus" class="status-message" role="status"></p>
            <p class="god-mode-legal"><a href="/terms.html">Terms</a><span>·</span><a href="/privacy-policy.html">Privacy Policy</a></p>
        </div>`;
    $(".god-mode-benefit-carousel")?.addEventListener("scroll", syncGodModeCarouselDots, { passive: true });
}

function openGodModePitch() {
    if (hasActiveGodMode()) {
        renderGodModeCard();
        showToast("God Mode is already active 👑");
        return;
    }
    renderGodModePitch();
    const dialog = $("#godModePitchDialog");
    if (!dialog.open) dialog.showModal();
    api.getInviteStatus(api.user.id).then((inviteStatus) => {
        state.inviteStatus = inviteStatus;
        const progress = $("#godModeInviteProgress");
        if (progress) progress.textContent = godModeInviteProgressLabel();
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
        showToast("God Mode is active 👑");
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
        showToast("God Mode is already active 👑");
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
            showToast("God Mode is already active 👑");
            return;
        }
        const checkout = await api.createGodModeCheckout(api.user.id);
        state.stripeCheckoutSessionId = checkout.id;
        if (checkoutWindow) checkoutWindow.location.href = checkout.url;
        else window.location.href = checkout.url;
        stopStripeCheckoutPolling();
        state.stripeCheckoutPollTimer = setInterval(checkStripeCheckout, 4000);
        status.textContent = "Finish checkout, then return here. God Mode will unlock automatically.";
    } catch (error) {
        checkoutWindow?.close();
        status.textContent = error.message || "Could not start Stripe checkout.";
    } finally {
        button.disabled = false;
        button.innerHTML = originalHTML;
    }
}

function renderEarnGodModeProgress() {
    const container = $("#earnGodModeProgress");
    const status = state.inviteStatus;
    if (!status) {
        container.innerHTML = `<div class="earn-invite-progress"><span><strong>Qualifying invites</strong><small>Loading…</small></span><progress max="1" value="0" aria-label="Loading invite progress"></progress></div>`;
        return;
    }
    const goal = Math.max(1, Number(status.aura_reward_goal || 1));
    const maxReached = status.aura_reward_max_reached === true;
    const progress = maxReached ? goal : Math.max(0, Math.min(goal, Number(status.aura_reward_progress || 0)));
    const remaining = Math.max(0, goal - progress);
    container.innerHTML = `<div class="earn-invite-progress">
        <span><strong>Qualifying invites: ${progress} / ${goal}</strong><small>${maxReached ? "Reward earned" : `${remaining} to go`}</small></span>
        <progress max="${goal}" value="${progress}" aria-label="${progress} of ${goal} qualifying invites"></progress>
    </div>`;
}

async function openEarnGodModeDialog() {
    const dialog = $("#earnGodModeDialog");
    $("#earnGodModeStatus").textContent = "";
    renderEarnGodModeProgress();
    if (!dialog.open) dialog.showModal();
    try {
        state.inviteStatus = await api.getInviteStatus(api.user.id);
        renderEarnGodModeProgress();
    } catch (_) { /* Sharing still works when progress is temporarily unavailable. */ }
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
        if (error.name !== "AbortError") status.textContent = error.message || "Could not create an invite.";
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
    container.innerHTML = `<article class="purchase-row"><span><strong>Get boosted</strong><small>Jump to the top of classmates' polls for 5 days or until you get voted 10 times.</small></span>${purchaseButton("global", globalCost, globalBoost ? "Global boost active" : `Get boosted for ${globalCost.toLocaleString()} aura`, Boolean(globalBoost))}</article>
        <article class="purchase-row"><span><strong>See what your crush thinks about you</strong><small>Your crush stays top secret. You appear more often in their polls.</small></span>${purchaseButton("targeted", targetedCost, `Choose a crush for ${targetedCost.toLocaleString()} aura`)}</article>
        ${tbhRequestsEnabled() ? `<article class="purchase-row"><span><strong>Request a TBH</strong><small>Ask a classmate for their honest take on you.</small></span>${purchaseButton("tbh", tbhCost, `Request a TBH for ${tbhCost.toLocaleString()} aura`)}</article>` : ""}
        <article class="purchase-row"><span><strong>Submit a school question</strong><small>Create a poll for your school and choose whether to show your name.</small></span>${purchaseButton("question", questionCost, `Submit a school question for ${questionCost.toLocaleString()} aura`)}</article>`;
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
        $("#tbhRequestBody").innerHTML = `<div class="empty-card"><strong>Couldn't load classmates</strong><p>${escapeHTML(error.message || "Please try again.")}</p></div>`;
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
        $("#tbhComposerStatus").textContent = error.message || "Couldn't send TBH.";
        setButtonLoading(button, false);
    }
}

async function dismissTbhRequest(requestId) {
    const previous = [...state.tbhPendingRequests];
    state.tbhPendingRequests = state.tbhPendingRequests.filter((item) => String(item.id) !== String(requestId));
    renderFeed();
    try { await api.dismissTbhRequest(api.user.id, requestId); }
    catch (error) { state.tbhPendingRequests = previous; renderFeed(); showToast(error.message || "Couldn't dismiss request."); }
}

async function suppressTbhRequester(requesterId) {
    const previous = [...state.tbhPendingRequests];
    state.tbhPendingRequests = state.tbhPendingRequests.filter((item) => String(item.requester_user_id) !== String(requesterId));
    renderFeed();
    try { await api.suppressTbhRequester(api.user.id, requesterId); }
    catch (error) { state.tbhPendingRequests = previous; renderFeed(); showToast(error.message || "Couldn't update requests."); }
}

async function openTbhDetail(value) {
    const [kind, id] = String(value).split(":");
    let item = (kind === "received" ? state.tbhInboxItems : kind === "sent" ? state.tbhSentItems : state.schoolTbhItems).find((candidate) => String(candidate.id) === String(id));
    if (!item) return;
    const name = kind === "received" ? item.author_first_name : item.subject_first_name;
    const title = kind === "received" ? `TBH from ${name}` : kind === "sent" ? `TBH sent to ${name}` : `${name} got a TBH`;
    const subject = { first_name: item.subject_first_name, last_name: item.subject_last_name, profile_picture_url: item.subject_profile_picture_url };
    const hero = kind === "school"
        ? avatarMarkup(subject, "row-avatar tbh-detail-avatar")
        : `<span class="tbh-detail-quote" aria-hidden="true">❞</span>`;
    const footer = kind === "school"
        ? tbhAuthorLine(item)
        : kind === "sent"
            ? `${name} sees your name. School sees your TBH without your name.`
            : "";
    $("#tbhDetailBody").innerHTML = `<article class="tbh-detail-card"><div class="tbh-detail-hero">${hero}<h2 id="tbhDetailTitle">${escapeHTML(title)}</h2><p>${escapeHTML(promptForKey(item.prompt_key).title)}</p></div><blockquote>${escapeHTML(item.body)}</blockquote>${footer ? `<small>${escapeHTML(footer)}</small>` : ""}</article>`;
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
    const imageURL = api.assetURL(question.image_url);
    $("#pollSummaryBody").innerHTML = `<article class="poll-summary-card">
        ${imageURL ? `<div class="profile-poll-art"><img loading="lazy" decoding="async" src="${escapeHTML(imageURL)}" alt=""></div>` : ""}
        <h3>${escapeHTML(question.question_text)}</h3>
        <span class="poll-summary-votes"><span aria-hidden="true">♥</span><strong>${Number(question.vote_count || 0).toLocaleString()} votes</strong></span>
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
            : ["Boost toward your crush", `Show up more often in ${displayName(target)}'s polls. They will not be told.`];
    state.pendingAuraPurchase = { kind, target };
    const spendIcon = $("#auraSpendIcon");
    const targetImage = ["targeted", "tbh"].includes(kind) ? api.assetURL(target?.profile_picture_url_medium || target?.profile_picture_url) : null;
    spendIcon.src = targetImage || (kind === "reveal" ? "../assets/app/magnifying_glass.webp" : "../assets/app/rocket.webp");
    spendIcon.alt = kind === "global" ? "Get Boosted" : kind === "reveal" ? "Reveal sender" : displayName(target);
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
    setButtonLoading(button, true, purchase.kind === "reveal" ? "Revealing..." : purchase.kind === "tbh" ? "Sending…" : "Purchasing...");
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
        } else if (purchase.kind === "global") await api.purchaseGlobalBoost(api.user.id);
        else await api.purchaseTargetedBoost(api.user.id, purchase.target.user_id);
        clearOptimisticEarnedProfile();
        $("#auraSpendDialog").close();
        successHaptic();
        state.pendingAuraPurchase = null;
        if (!["reveal", "tbh"].includes(purchase.kind)) await refreshProfile();
        if (purchase.kind === "tbh") {
            $("#tbhRequestTitle").textContent = "Request sent";
            $("#tbhRequestBody").innerHTML = `<div class="tbh-success"><span class="tbh-detail-quote" aria-hidden="true">❞</span><h2>Request sent to ${escapeHTML(purchase.target.first_name)}</h2><p>If they answer, your name and their TBH will be posted in School for classmates to see and react to. Their name stays private.</p><button class="primary-button" type="button" data-close-tbh-request>Done</button></div>`;
        } else showToast(purchase.kind === "reveal"
            ? `Revealed: ${purchase.target.voter_name}`
            : purchase.kind === "global"
                ? "You're boosted 🚀"
                : `Boosted toward ${displayName(purchase.target)} ✨`);
    } catch (error) {
        $("#auraSpendStatus").textContent = error.message || (purchase.kind === "reveal"
            ? "Could not reveal this sender."
            : "Could not purchase this boost.");
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
        $("#targetedBoostStatus").textContent = error.message || "Could not load classmates.";
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
            trailingMarkup: `${classmate.ask_link_active ? `<span class="classmate-ask-indicator" aria-label="Ask Me is on">${appSymbolMarkup("ask", "ask-me-symbol")}</span>` : ""}<span class="classmate-row-meta"><strong><span aria-hidden="true">♥</span> ${Number(classmate.weekly_vote_count || 0).toLocaleString()}</strong><small>this week</small></span>`,
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
        $("#classmateDirectoryStatus").textContent = error.message || "Could not load classmates.";
    }
}

function renderClassmateProfile() {
    const profile = state.selectedClassmateProfile;
    if (!profile) return;
    const imageURL = api.assetURL(profile.profile_picture_url_medium || profile.profile_picture_url);
    $("#classmateProfileCard").innerHTML = `<article class="full-profile-card classmate-profile-card">
        <span class="full-profile-avatar">${imageURL ? `<img loading="lazy" decoding="async" src="${escapeHTML(imageURL)}" alt="${escapeHTML(displayName(profile))}">` : `<span>${escapeHTML(initials(profile))}</span>`}</span>
        <h3>${escapeHTML(displayName(profile))}</h3>
        <div class="profile-handle">${profile.username ? `@${escapeHTML(profile.username)}` : "Valid classmate"}</div>
        ${profile.bio ? `<p class="profile-bio">${escapeHTML(profile.bio)}</p>` : ""}
        <div class="profile-school-meta"><span class="profile-school-meta-item"><img loading="lazy" decoding="async" src="../assets/app/profile-school.svg" alt=""><span>${escapeHTML(profile.school_name || state.profile?.school_name || "Your school")}</span></span>${profile.grade ? `<span class="profile-school-meta-item"><img loading="lazy" decoding="async" src="../assets/app/profile-graduation-cap.svg" alt=""><span>${escapeHTML(formatGrade(profile.grade))}</span></span>` : ""}</div>
        ${state.selectedClassmateAskTarget?.public_token ? `<a class="primary-button classmate-ask-button" href="../a/${encodeURIComponent(state.selectedClassmateAskTarget.public_token)}">${appSymbolMarkup("ask", "ask-me-symbol")}<span>Ask anonymously</span></a>` : ""}
        <div class="profile-stats-grid ${tbhRequestsEnabled() ? "" : "single"}">
            <div class="profile-stat-card"><strong><span class="heart">♥</span>${Number(profile.vote_count || 0).toLocaleString()}</strong><span>Votes Received</span></div>
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
        ? (requests[0].reason?.message || "Could not load this profile.")
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
    if (!confirm(`${verb === "block" ? "Block" : "Report"} ${displayName(profile)}?${verb === "block" ? " They will be removed from your Valid experience." : " Valid will review this profile."}`)) return;
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
            profileError ||= result.reason?.message || "Could not load all profile details.";
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
        const message = error.message || "Could not add that passkey.";
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

function openSignupDialog() {
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
            <span class="signup-school-logo">${logoURL ? `<img loading="lazy" decoding="async" src="${escapeHTML(logoURL)}" alt="">` : escapeHTML(initials)}</span>
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
        $("#signupStatus").textContent = error.message || "Couldn't load nearby schools. Enter your school manually.";
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
            $("#signupStatus").textContent = error.message || "Could not check that phone number.";
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
            $("#signupStatus").textContent = error.message || "Could not verify that code.";
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
            $("#signupStatus").textContent = error.message || "Could not check that username.";
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
        $("#signupStatus").textContent = error.message || "Could not send another code.";
    } finally {
        setButtonLoading(button, false);
    }
}

async function createAccount(event) {
    event.preventDefault();
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
    const profilePicture = $("#signupPicture").files[0];
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
            login = await api.completeWebSignup({
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
        showToast(photoUploadFailed ? "Welcome! Add your photo from Profile when you're ready." : "Welcome to Valid ✨");
        setTimeout(() => { if (api.hasSession()) openClassmatesDialog({ onboarding: true }); }, 700);
    } catch (error) {
        $("#signupStatus").textContent = error.message || "Could not create your account.";
    } finally {
        setButtonLoading(button, false);
        submitButtons.forEach((candidate) => { candidate.disabled = false; });
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
    const gender = String(item.author_gender || "").toLowerCase();
    const emoji = gender === "male" || gender === "boy" ? "👦💙" : gender === "female" || gender === "girl" ? "👧💗" : gender === "non-binary" || gender === "nonbinary" ? "🧑💛" : "";
    if (!emoji) return "from a classmate";
    const grade = String(item.author_grade || "").trim();
    if (!grade) return `from a ${emoji} classmate`;
    const normalized = formatGrade(grade);
    const classmatesInGrade = (state.classmates || []).filter((classmate) => formatGrade(classmate.grade || "") === normalized).length;
    return classmatesInGrade >= 2 ? `from a ${emoji} ${normalized}` : `from a ${emoji} (grade hidden until more classmates join)`;
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
                avatarMarkup, displayName, escapeHTML, formatGrade, relativeTime,
                normalizeReactionState, dominantReaction, promptForKey, tbhAuthorLine,
                tbhRequestsEnabled, renderTabBadges, formatVoterHint, showToast,
            });
            return feedView;
        });
    }
    return feedViewPromise;
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
    $("#myVotesFilter").classList.add("hidden");
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
        if (emoji) emoji.textContent = displayed?.emoji || "☺";
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
        $("#reactorList").innerHTML = reactors.length ? reactors.map((reactor) => `<div class="reactor-row">${avatarMarkup({ first_name: reactor.first_name, last_name: reactor.last_name, profile_picture_url: reactor.profile_picture_url }, "row-avatar")}<strong>${escapeHTML(`${reactor.first_name} ${reactor.last_name}`)}</strong><span aria-label="${escapeHTML(REACTION_BY_TYPE.get(reactor.reaction_type)?.label || "Reaction")}">${REACTION_BY_TYPE.get(reactor.reaction_type)?.emoji || "✨"}</span></div>`).join("") : '<div class="empty-card"><strong>No reactions yet</strong><p>Be the first to react.</p></div>';
    } catch (error) {
        $("#reactorList").innerHTML = `<div class="empty-card"><strong>Couldn't load reactions</strong><p>${escapeHTML(error.message || "Please try again.")}</p></div>`;
    }
}

function renderFeedDetail() {
    const item = selectedFeedItem();
    if (!item) return;
    const selectedName = item.selected_contact_name
        || item.voted_for_name
        || item.contact_name
        || (item.item_type === "received_vote" ? displayName(state.profile) : "A classmate");
    const options = Array.isArray(item.presented_options) ? item.presented_options : [];
    const artworkURL = api.assetURL(item.image_url);
    const revealed = item.voter_name ? `<div class="revealed-sender-row">${avatarMarkup({ first_name: item.voter_name, profile_picture_url: item.voter_profile_picture_url }, "row-avatar")}<strong>Sent by ${escapeHTML(item.voter_name)}</strong></div>` : "";
    const firstLetter = item.voter_name ? "" : voterFirstLetterHint(item);
    const firstLetterHint = firstLetter ? `<p class="feed-detail-first-letter-hint">Hint: starts with ${escapeHTML(firstLetter)}</p>` : "";
    $("#feedDetailDialog .detail-screen-header > strong").textContent = formatVoterStatement(item);
    $("#feedDetailBody").innerHTML = `<article class="feed-detail-card">
        <h3>${escapeHTML(item.question_text)}</h3>
        <div class="feed-detail-art">${artworkURL ? `<img loading="lazy" decoding="async" src="${escapeHTML(artworkURL)}" alt="">` : `<div class="artwork-placeholder"><img loading="lazy" decoding="async" src="../assets/app/pencil-clipboard.webp" alt=""><span>Image unavailable</span></div>`}</div>
        ${options.length ? `<div class="feed-detail-options">${options.map((option) => {
            const name = option.name || option.contact_name || "A classmate";
            const selected = name === selectedName;
            return `<div class="feed-detail-option ${selected ? "selected" : ""}"><strong>${escapeHTML(name)}</strong>${selected ? `<span class="feed-detail-selection-indicator" aria-label="Picked">👆</span>` : ""}</div>`;
        }).join("")}</div>` : `<div class="feed-detail-legacy-selection"><strong>Selected: ${escapeHTML(selectedName)}</strong><small>Options not available for this older vote</small></div>`}
        ${firstLetterHint}
        ${revealed}
    </article>`;
    $("#blockFeedSubmitterButton").classList.toggle("hidden", !item.question_submitted_by_user_id || item.question_is_anonymous === true);
    const revealButton = $("#revealFeedSenderButton");
    const canRevealThisVote = item.item_type === "received_vote" && !item.voter_name;
    revealButton.classList.toggle("hidden", !canRevealThisVote);
    if (canRevealThisVote) {
        const remaining = Math.max(0, Number(state.profile?.remaining_reveals || 0));
        const auraCost = Math.max(0, Number(state.config?.full_reveal_aura_cost ?? DEFAULT_FULL_REVEAL_AURA_COST));
        const subscribed = api.user?.subscribed_user === true;
        const label = subscribed
            ? (remaining > 0 ? `Reveal who sent this (${remaining} remaining)` : `Reveal who sent this (${auraCost.toLocaleString()} aura)`)
            : "Get God Mode to Reveal who sent this";
        revealButton.innerHTML = `<span>${escapeHTML(label)}</span>`;
        revealButton.disabled = subscribed && remaining === 0 && Number(state.profile?.aura_points || 0) < auraCost;
    }
    $("#feedDetailStatus").textContent = "";
}

function openFeedDetail(answerId) {
    state.selectedFeedItemId = answerId;
    renderFeedDetail();
    openDetailScreen($("#feedDetailDialog"));
}

function canvasRoundedRect(context, x, y, width, height, radius) {
    const corner = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + corner, y);
    context.arcTo(x + width, y, x + width, y + height, corner);
    context.arcTo(x + width, y + height, x, y + height, corner);
    context.arcTo(x, y + height, x, y, corner);
    context.arcTo(x, y, x + width, y, corner);
    context.closePath();
}

function canvasTextLines(context, text, maxWidth, maxLines = Infinity) {
    const words = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const lines = [];
    let current = words.shift();
    for (const word of words) {
        const candidate = `${current} ${word}`;
        if (context.measureText(candidate).width <= maxWidth || !current) current = candidate;
        else {
            lines.push(current);
            current = word;
        }
    }
    lines.push(current);
    if (lines.length <= maxLines) return lines;
    const visible = lines.slice(0, maxLines);
    let last = visible[maxLines - 1];
    while (last && context.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    visible[maxLines - 1] = `${last}…`;
    return visible;
}

function drawCenteredCanvasText(context, text, centerX, top, maxWidth, lineHeight, maxLines = Infinity) {
    const lines = canvasTextLines(context, text, maxWidth, maxLines);
    context.textAlign = "center";
    context.textBaseline = "top";
    lines.forEach((line, index) => context.fillText(line, centerX, top + index * lineHeight));
    return top + lines.length * lineHeight;
}

async function loadShareArtwork(url) {
    if (!url) return Promise.resolve(null);
    try {
        const response = await fetch(url, { credentials: "omit", mode: "cors" });
        if (response.ok) {
            const objectURL = URL.createObjectURL(await response.blob());
            const image = await new Promise((resolve) => {
                const candidate = new Image();
                candidate.onload = () => resolve(candidate);
                candidate.onerror = () => resolve(null);
                candidate.src = objectURL;
            });
            URL.revokeObjectURL(objectURL);
            if (image) return image;
        }
    } catch (_) {
        // The direct image path below still works for same-origin and CORS-enabled assets.
    }
    return new Promise((resolve) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = url;
    });
}

async function loadPollShareArtwork(item) {
    const displayedArtwork = $("#feedDetailBody .feed-detail-art > img")?.currentSrc;
    const candidates = [api.assetURL(item.image_url), displayedArtwork]
        .filter((url, index, urls) => url && urls.indexOf(url) === index);
    for (const url of candidates) {
        const artwork = await loadShareArtwork(url);
        if (artwork) return artwork;
    }
    // Older CDN objects may not expose CORS headers. The poll itself should
    // still be shareable instead of failing the entire canvas render.
    return null;
}

function canvasBlob(canvas, type = "image/png", quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not render image.")), type, quality);
    });
}

function pollShareNominationSubtitle(item) {
    const voter = formatVoterDemographicsStatement(item);
    if (voter === "Poll") return "got nominated";
    const demographic = voter.replace(/ said$/, "").replace(/^(A|An)\s/, (article) => article.toLowerCase());
    return `got nominated by ${demographic}`;
}

async function createPollShareFile(item) {
    await document.fonts?.ready;
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 1600;
    const context = canvas.getContext("2d");
    const centerX = canvas.width / 2;
    const selectedName = item.selected_contact_name
        || item.voted_for_name
        || item.contact_name
        || (item.item_type === "received_vote" ? displayName(state.profile) : "A classmate");
    const isNomination = item.is_nomination === true;
    const options = !isNomination && Array.isArray(item.presented_options) ? item.presented_options.slice(0, 4) : [];
    const artwork = await loadPollShareArtwork(item);

    context.fillStyle = "#ccf7f4";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#000000";
    // iOS keeps the shared image anonymous even after a sender is revealed.
    const voterStatement = formatVoterDemographicsStatement(item);
    const showsVoterStatement = voterStatement && voterStatement !== "Poll";
    const gridRows = options.length ? Math.ceil(options.length / 2) : 0;
    const gridHeight = isNomination ? 400 : options.length ? gridRows * 200 + Math.max(0, gridRows - 1) * 20 : 0;
    const brandingHeight = 62;
    const brandingGap = 63;
    const contentTop = artwork ? 60 : 260;

    context.font = '44px "Jua", "Apple Color Emoji", sans-serif';
    let contentBottom = showsVoterStatement
        ? drawCenteredCanvasText(context, voterStatement, centerX, contentTop, 820, 52, 2)
        : 0;
    context.font = '56px "Jua", "Apple Color Emoji", sans-serif';
    const questionTop = showsVoterStatement ? contentBottom + 40 : contentTop;
    contentBottom = drawCenteredCanvasText(context, item.question_text, centerX, questionTop, 820, 63, 3);

    if (artwork) {
        const y = contentBottom + 40;
        const availableHeight = Math.max(260, canvas.height - y - 24 - gridHeight - brandingGap - brandingHeight);
        const scale = Math.min(780 / artwork.naturalWidth, Math.min(780, availableHeight) / artwork.naturalHeight);
        const width = artwork.naturalWidth * scale;
        const height = artwork.naturalHeight * scale;
        const x = centerX - width / 2;
        canvasRoundedRect(context, x, y, width, height, 24);
        context.save();
        context.clip();
        context.drawImage(artwork, x, y, width, height);
        context.restore();
        context.strokeStyle = "#000000";
        context.lineWidth = 6;
        canvasRoundedRect(context, x, y, width, height, 24);
        context.stroke();
        contentBottom = y + height;
    }

    const gridTop = contentBottom + 24;
    let selectedPointer = null;
    if (isNomination) {
        const x = 40;
        const y = gridTop;
        const width = 820;
        const height = 400;
        context.fillStyle = "#ffb15e";
        canvasRoundedRect(context, x, y, width, height, 32);
        context.fill();
        context.strokeStyle = "#000000";
        context.lineWidth = 8;
        context.stroke();
        context.fillStyle = "#000000";
        context.font = '64px "Jua", "Apple Color Emoji", sans-serif';
        const nameLines = canvasTextLines(context, selectedName, width - 70, 2);
        const nameTop = y + 105 - (nameLines.length - 1) * 32;
        context.textAlign = "center";
        context.textBaseline = "top";
        nameLines.forEach((line, index) => context.fillText(line, centerX, nameTop + index * 72));
        context.font = '36px "Jua", "Apple Color Emoji", sans-serif';
        drawCenteredCanvasText(context, pollShareNominationSubtitle(item), centerX, y + 280, width - 70, 44, 2);
    } else if (options.length) {
        const gap = 20;
        const cardWidth = 400;
        const cardHeight = 200;
        options.forEach((option, index) => {
            const name = option.name || option.contact_name || "A classmate";
            const selected = option.is_selected === true || name === selectedName;
            const column = index % 2;
            const row = Math.floor(index / 2);
            const x = 40 + column * (cardWidth + gap);
            const y = gridTop + row * (cardHeight + gap);
            context.fillStyle = "#ffb15e";
            canvasRoundedRect(context, x, y, cardWidth, cardHeight, 24);
            context.fill();
            context.strokeStyle = selected ? "#ffff00" : "#000000";
            context.lineWidth = 6;
            context.stroke();
            context.fillStyle = "#000000";
            context.font = '44px "Jua", "Apple Color Emoji", sans-serif';
            const lines = canvasTextLines(context, name, cardWidth - 40, 2);
            const nameTop = y + (cardHeight - lines.length * 52) / 2;
            context.textAlign = "center";
            context.textBaseline = "top";
            lines.forEach((line, lineIndex) => context.fillText(line, x + cardWidth / 2, nameTop + lineIndex * 52));
            if (selected) {
                selectedPointer = { x: x + cardWidth / 2, y: y + cardHeight + 29 };
            }
        });
        if (selectedPointer) {
            context.font = '60px "Apple Color Emoji", sans-serif';
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.lineJoin = "round";
            context.lineWidth = 8;
            context.strokeStyle = "#000000";
            context.strokeText("👆", selectedPointer.x, selectedPointer.y);
            context.fillText("👆", selectedPointer.x, selectedPointer.y);
        }
    }

    context.fillStyle = "#000000";
    context.font = '52px "Jua", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText("validapp.lol", centerX, gridTop + gridHeight + brandingGap);
    const blob = await canvasBlob(canvas);
    const identifier = String(item.question_answer_id || item.question_id || "poll").replace(/[^a-z0-9_-]/gi, "");
    return new File([blob], `valid-poll-${identifier}.png`, { type: "image/png" });
}

function fitCanvasStoryText(context, text, maxWidth, maxHeight, preferredSize, minimumSize = 30, maxLines = 10) {
    const value = String(text || "").trim();
    for (let size = preferredSize; size >= minimumSize; size -= 2) {
        context.font = `${size}px "Jua", "Apple Color Emoji", sans-serif`;
        const lineHeight = Math.round(size * 1.16);
        const lines = canvasTextLines(context, value, maxWidth, maxLines + 1);
        if (lines.length <= maxLines && lines.length * lineHeight <= maxHeight) return { lines, lineHeight };
    }
    context.font = `${minimumSize}px "Jua", "Apple Color Emoji", sans-serif`;
    return {
        lines: canvasTextLines(context, value, maxWidth, maxLines),
        lineHeight: Math.round(minimumSize * 1.16),
    };
}

function drawAnonymousAnswerStoryCard(context, { badge, text, fill, y, height, preferredSize }) {
    const x = 64;
    const width = 772;
    context.fillStyle = "#000000";
    canvasRoundedRect(context, x + 14, y + 16, width, height, 48);
    context.fill();
    context.fillStyle = fill;
    canvasRoundedRect(context, x, y, width, height, 48);
    context.fill();
    context.strokeStyle = "#000000";
    context.lineWidth = 7;
    context.stroke();

    const fitted = fitCanvasStoryText(context, text, width - 108, height - 96, preferredSize);
    const textTop = y + (height - fitted.lines.length * fitted.lineHeight) / 2;
    context.fillStyle = "#000000";
    context.textAlign = "center";
    context.textBaseline = "top";
    fitted.lines.forEach((line, index) => {
        context.fillText(line, x + width / 2, textTop + index * fitted.lineHeight);
    });

    context.beginPath();
    context.arc(x + 12, y + 10, 32, 0, Math.PI * 2);
    context.fillStyle = "#000000";
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = '34px "Jua", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(badge, x + 12, y + 12);
}

async function createAnonymousAnswerShareFile(question) {
    await document.fonts?.ready;
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 1600;
    const context = canvas.getContext("2d");
    const centerX = canvas.width / 2;

    context.fillStyle = "#ccf7f4";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(255,184,214,.62)";
    context.beginPath();
    context.arc(830, -440, 260, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "rgba(255,177,94,.46)";
    context.beginPath();
    context.arc(-180, 1500, 240, 0, Math.PI * 2);
    context.fill();

    const askerLabel = question.provenance_label || "Anonymous";
    context.font = '30px "Jua", "Apple Color Emoji", sans-serif';
    const labelWidth = Math.min(760, Math.max(210, context.measureText(askerLabel).width + 56));
    context.fillStyle = "#ffb8d6";
    canvasRoundedRect(context, centerX - labelWidth / 2, 118, labelWidth, 60, 30);
    context.fill();
    context.strokeStyle = "#000000";
    context.lineWidth = 5;
    context.stroke();
    context.fillStyle = "#000000";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(askerLabel, centerX, 149);

    drawAnonymousAnswerStoryCard(context, {
        badge: "M",
        text: question.body,
        fill: "#ffffff",
        y: 220,
        height: 390,
        preferredSize: String(question.body || "").length > 130 ? 45 : 54,
    });

    context.strokeStyle = "#ffb15e";
    context.fillStyle = "#ffb15e";
    context.lineWidth = 18;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(centerX, 642);
    context.lineTo(centerX, 692);
    context.stroke();
    context.beginPath();
    context.moveTo(centerX - 22, 676);
    context.lineTo(centerX, 702);
    context.lineTo(centerX + 22, 676);
    context.closePath();
    context.fill();

    drawAnonymousAnswerStoryCard(context, {
        badge: "R",
        text: question.answer_text,
        fill: "#ffb15e",
        y: 730,
        height: 500,
        preferredSize: String(question.answer_text || "").length > 260 ? 42 : 55,
    });

    const username = state.profile?.username || api.user?.username;
    if (username) {
        context.fillStyle = "#3d7777";
        context.font = '34px "Jua", sans-serif';
        context.textAlign = "center";
        context.textBaseline = "top";
        context.fillText(`@${username}`, centerX, 1262);
    }

    const logo = await loadShareArtwork(new URL("../assets/valid_logo.png", import.meta.url).href);
    if (logo) {
        const logoWidth = 250;
        const logoHeight = Math.min(96, logoWidth * (logo.naturalHeight / logo.naturalWidth));
        context.drawImage(logo, centerX - logoWidth / 2, 1390, logoWidth, logoHeight);
    } else {
        context.fillStyle = "#000000";
        context.font = '58px "Jua", sans-serif';
        context.textAlign = "center";
        context.textBaseline = "top";
        context.fillText("Valid", centerX, 1390);
    }

    const blob = await canvasBlob(canvas);
    const identifier = String(question.id || "reply").replace(/[^a-z0-9_-]/gi, "");
    return new File([blob], `valid-reply-${identifier}.png`, { type: "image/png" });
}

function drawAskStoryBubble(context, x, y, width, height, color, rotation = 0) {
    context.save();
    context.translate(x + width / 2, y + height / 2);
    context.rotate(rotation * Math.PI / 180);
    context.translate(-width / 2, -height / 2);
    context.fillStyle = "#000000";
    canvasRoundedRect(context, 14, 16, width, height, 54);
    context.fill();
    context.fillStyle = color;
    canvasRoundedRect(context, 0, 0, width, height, 54);
    context.fill();
    context.strokeStyle = "#000000";
    context.lineWidth = 8;
    context.stroke();
    context.fillStyle = "rgba(0,0,0,.72)";
    [width / 2 - 52, width / 2, width / 2 + 52].forEach((dotX) => {
        context.beginPath();
        context.arc(dotX, height / 2, 17, 0, Math.PI * 2);
        context.fill();
    });
    context.restore();
}

function drawAskStoryArrow(context, x, y, direction, color, rotation = 0) {
    context.save();
    context.translate(x, y);
    context.rotate(rotation * Math.PI / 180);
    context.strokeStyle = "rgba(0,0,0,.2)";
    context.fillStyle = "rgba(0,0,0,.2)";
    context.lineWidth = 17;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(5, direction === "down" ? 5 : 73);
    context.lineTo(5, direction === "down" ? 73 : 5);
    context.stroke();
    context.beginPath();
    if (direction === "down") {
        context.moveTo(-25, 51);
        context.lineTo(5, 86);
        context.lineTo(35, 51);
    } else {
        context.moveTo(-25, 27);
        context.lineTo(5, -8);
        context.lineTo(35, 27);
    }
    context.closePath();
    context.fill();
    context.translate(-4, -5);
    context.strokeStyle = color;
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(5, direction === "down" ? 5 : 73);
    context.lineTo(5, direction === "down" ? 73 : 5);
    context.stroke();
    context.beginPath();
    if (direction === "down") {
        context.moveTo(-25, 51);
        context.lineTo(5, 86);
        context.lineTo(35, 51);
    } else {
        context.moveTo(-25, 27);
        context.lineTo(5, -8);
        context.lineTo(35, 27);
    }
    context.closePath();
    context.fill();
    context.restore();
}

async function createAskStoryFile(platform) {
    await document.fonts?.ready;
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1920;
    const context = canvas.getContext("2d");
    const centerX = canvas.width / 2;
    const username = state.profile?.username || api.user?.username || "valid";

    context.fillStyle = "#ccf7f4";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(255,184,214,.5)";
    context.beginPath();
    context.arc(970, -40, 310, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "rgba(255,177,94,.45)";
    context.beginPath();
    context.arc(-70, 1680, 260, 0, Math.PI * 2);
    context.fill();

    drawAskStoryBubble(context, 20, 255, 410, 175, "#ffb8d6", -10);
    drawAskStoryBubble(context, 700, 850, 360, 155, "#ffb15e", 9);

    context.fillStyle = "#000000";
    canvasRoundedRect(context, 137, 374, 850, 610, 76);
    context.fill();
    context.fillStyle = "#ffffff";
    canvasRoundedRect(context, 115, 350, 850, 610, 76);
    context.fill();
    context.strokeStyle = "#000000";
    context.lineWidth = 10;
    context.stroke();

    context.fillStyle = "#000000";
    context.font = '94px "Jua", "Apple Color Emoji", sans-serif';
    const titleBottom = drawCenteredCanvasText(context, "send me anonymous messages", centerX, 490, 735, 106, 3);
    context.fillStyle = "#3d7777";
    context.font = '46px "Jua", sans-serif';
    drawCenteredCanvasText(context, `@${username}`, centerX, titleBottom + 42, 710, 54, 1);

    const targetWidth = platform === "snapchat" ? 600 : 650;
    const targetHeight = platform === "snapchat" ? 132 : 126;
    const targetX = centerX - targetWidth / 2;
    const targetY = platform === "snapchat" ? 1280 : 1245;
    [centerX - 230, centerX, centerX + 230].forEach((x, index) => {
        drawAskStoryArrow(context, x, targetY - 120, "down", index === 1 ? "#ffb15e" : "#ffb8d6", (index - 1) * 12);
        drawAskStoryArrow(context, x, targetY + targetHeight + 46, "up", index === 1 ? "#ffb8d6" : "#ffb15e", (1 - index) * 12);
    });
    context.fillStyle = "#000000";
    canvasRoundedRect(context, targetX + 13, targetY + 15, targetWidth, targetHeight, targetHeight / 2);
    context.fill();
    canvasRoundedRect(context, targetX, targetY, targetWidth, targetHeight, targetHeight / 2);
    context.fill();
    context.strokeStyle = platform === "snapchat" ? "#ffb15e" : "#000000";
    context.lineWidth = 8;
    context.stroke();
    if (platform === "instagram") {
        context.fillStyle = "#ffffff";
        context.font = '35px "Jua", sans-serif';
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText("🔗  ADD LINK STICKER HERE", centerX, targetY + targetHeight / 2 + 2);
    } else {
        context.fillStyle = "#ffb8d6";
        context.font = '46px "Apple Color Emoji", sans-serif';
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText("🔗                                      🔗", centerX, targetY + targetHeight / 2 + 2);
    }

    const logo = await loadShareArtwork(new URL("../assets/valid_logo.png", import.meta.url).href);
    if (logo) {
        const logoWidth = 324;
        const logoHeight = logoWidth * (logo.naturalHeight / logo.naturalWidth);
        context.drawImage(logo, centerX - logoWidth / 2, 1550, logoWidth, logoHeight);
    } else {
        context.fillStyle = "#000000";
        context.font = '72px "Jua", sans-serif';
        context.textAlign = "center";
        context.textBaseline = "top";
        context.fillText("Valid", centerX, 1550);
    }

    const blob = await canvasBlob(canvas);
    return new File([blob], `valid-ask-${platform}.png`, { type: "image/png" });
}

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
    $("#feedDetailStatus").textContent = `Creating poll photo for ${platformLabel}…`;
    try {
        const file = await createPollShareFile(item);
        if (navigator.share && navigator.canShare?.({ files: [file] })) {
            $("#feedDetailStatus").textContent = `Choose ${platformLabel} in the share sheet.`;
            await navigator.share({
                files: [file],
                title: `Share to ${platformLabel}`,
                text: "A poll on Valid · https://validapp.lol",
            });
            $("#feedDetailStatus").textContent = "";
            showToast("Poll photo shared");
        } else {
            downloadShareFile(file);
            $("#feedDetailStatus").textContent = `Poll photo saved. Open ${platformLabel} to post it.`;
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
    setButtonLoading(button, true, "Revealing...");
    $("#feedDetailStatus").textContent = "";
    try {
        const result = await api.revealSender(api.user.id, item.question_answer_id);
        applyFeedSenderReveal(item, result);
        showToast(`Revealed: ${result.full_name}`);
    } catch (error) {
        $("#feedDetailStatus").textContent = error.message || "Could not reveal this sender.";
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
    const messages = {
        block: "Block this question submitter? Their submitted questions will be hidden from you.",
        dismiss: "Delete this question? This question and its votes will be deleted from your Inbox and School Feed. It won't be reported or affect anyone else.",
        report: "Report this question to Valid's moderation team?",
    };
    const message = messages[action];
    if (!message) return;
    if (!confirm(message)) return;
    try {
        if (action === "block") await api.blockQuestionSubmitter(api.user.id, item.question_id);
        else if (action === "dismiss") await api.dismissFeedQuestion(api.user.id, item.question_id);
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
        $("#feedDetailStatus").textContent = error.message || fallbackMessages[action];
    }
}

function isFeedVoteLocked() {
    const progress = state.classmatesStatus;
    return Boolean(progress?.lock_reasons?.includes("votes") && Number(progress.votes_cast || 0) < Number(progress.required_votes || 0));
}

function renderFeedGate() {
    const locked = isFeedVoteLocked();
    $("#feedGateLock").classList.toggle("hidden", !locked);
    $("#feedUnlockedContent").classList.toggle("hidden", locked);
    if (!locked) {
        renderFeedNotificationPrompt();
        return;
    }
    const cast = Number(state.classmatesStatus?.votes_cast || 0);
    const required = Number(state.classmatesStatus?.required_votes || 0);
    const remaining = Math.max(0, required - cast);
    const received = Math.max(0, Number(state.profile?.vote_count || 0));
    const receivedLabel = received === 1 ? "vote" : "votes";
    $("#feedGateLock").innerHTML = `<article class="feed-gate-card">
        <img loading="lazy" decoding="async" class="feed-gate-lock" src="../assets/app/lock.webp" alt="" aria-hidden="true">
        <p class="feed-gate-eyebrow">You got</p>
        <h3 class="feed-gate-vote-count">${received.toLocaleString()} ${receivedLabel}</h3>
        <p>Cast ${remaining} more ${remaining === 1 ? "vote" : "votes"} to unlock your Feed and see what classmates said.</p>
        <progress class="feed-gate-progress" max="${Math.max(1, required)}" value="${Math.min(cast, Math.max(1, required))}" aria-label="Votes required to unlock Feed"></progress>
        <strong>${cast} / ${required} votes cast</strong>
        <button class="primary-button" type="button" data-vote-to-unlock>Vote now to unlock Feed</button>
        <section class="feed-gate-notification" aria-label="Enable vote notifications">
            <strong>Don’t miss your next vote</strong>
            <small>Enable notifications to know when someone picks you.</small>
            <button class="secondary-button" type="button" data-enable-feed-notifications>Enable notifications</button>
        </section>
    </article>`;
    renderFeedNotificationPrompt();
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
    const prompts = [$("#feedNotificationPrompt"), ...$$(".feed-gate-notification")].filter(Boolean);
    prompts.forEach((prompt) => {
        prompt.classList.toggle("hidden", !supported || Boolean(enabled) || blocked);
        const button = prompt.querySelector("button");
        if (!button) return;
        button.textContent = label;
        button.disabled = state.webPushBusy || syncing;
    });
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
    $("#anonymousAnswerDetailDialog").showModal();
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
            $("#feedStatus").textContent = error.message || "Could not load anonymous messages.";
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
    $("#anonymousQuestionBody").innerHTML = `<blockquote>${escapeHTML(question.body)}</blockquote><div><strong>${escapeHTML(question.provenance_label)}</strong></div>`;
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
        const file = await createAnonymousAnswerShareFile(question);
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
        $("#anonymousAnswerStatus").textContent = error.message || "Could not open this question.";
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
        $("#anonymousAnswerStatus").textContent = error.message || "Could not answer this question.";
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
    if (!confirm("Delete this question? This cannot be undone.")) return;
    try {
        await api.deleteAnonymousQuestion(api.user.id, question.id);
        state.anonymousInbox.questions = state.anonymousInbox.questions.filter((item) => String(item.id) !== String(question.id));
        state.selectedAnonymousQuestionId = null;
        closeDetailScreen($("#anonymousQuestionDialog"));
        renderAnonymousInbox();
        showToast("Question deleted");
    } catch (error) {
        $("#anonymousAnswerStatus").textContent = error.message || `Could not ${action} this question.`;
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
        $("#anonymousReportStatus").textContent = error.message || "Could not report this question.";
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
    status.textContent = hadVisibleFeed && reset ? "Refreshing…" : "Loading votes...";
    loadMore.classList.add("hidden");
    try {
        let items;
        if (feedType === "personal") items = await api.getPersonalFeed(api.user.id, state.feedOffset, search);
        else if (myVotesOnly) items = await api.getUserVotes(api.user.id, state.feedCursor);
        else items = await api.getSchoolFeed(api.user.id, schoolSort === "hottest" ? null : state.feedCursor, search, schoolSort, schoolSort === "hottest" ? 100 : 20);
        const currentRawSearch = state.feedSearch.trim();
        const currentSearch = currentRawSearch.length >= 2 ? currentRawSearch : "";
        if (generation !== state.feedGeneration || feedType !== state.feedType || myVotesOnly !== state.myVotesOnly || schoolSort !== state.schoolFeedSort || schoolContent !== state.schoolFeedContent || search !== currentSearch) return;
        commitFeedItems(items, { reset });
        if (feedType === "personal") state.feedOffset += items.length;
        else if (items.length) {
            const last = items.at(-1);
            state.feedCursor = { timestamp: last.timestamp, id: last.question_answer_id };
        }
        status.textContent = "";
        state.feedAppliedSearch = search;
        renderFeed();
        if (feedType === "personal" && !search) writeAppCache("feed-personal", state.feedItems.slice(0, 60));
        loadMore.classList.toggle("hidden", schoolSort === "hottest" || schoolContent === "tbhs" || items.length < 20);
    } catch (error) {
        if (generation !== state.feedGeneration) return;
        status.textContent = error.message || "Could not load the feed.";
    }
}

function softHaptic(duration = 8) {
    if (isAndroidDevice() && navigator.vibrate) navigator.vibrate(duration);
}

function successHaptic() {
    if (isAndroidDevice() && navigator.vibrate) navigator.vibrate([10, 35, 18]);
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
    chip.animate([
        { transform: "scale(1)", background: "rgba(255,255,255,.92)" },
        { transform: "scale(1.16)", background: Number(amount) > 0 ? "#ccf7f4" : "#ffb8d6", offset: .45 },
        { transform: "scale(1)", background: "rgba(255,255,255,.92)" },
    ], { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" });
}

function showStreakCelebration(streak, multiplier) {
    const overlay = $("#streakCelebration");
    if (!overlay || Number(streak) < 1) return;
    const milestone = [7, 14, 30, 50, 100].includes(Number(streak));
    $("#streakCelebrationFire").textContent = milestone ? "🔥🔥🔥" : "🔥";
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
        showToast(error.message || "Could not update that vote.");
    }
}

function shuffle(items) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
}

function choicesForQuestion(question) {
    if (!state.choicesByQuestion.has(question.id)) state.choicesByQuestion.set(question.id, shuffle(state.classmates).slice(0, 4));
    return state.choicesByQuestion.get(question.id);
}

function choiceMarkup(choice) {
    return `<button class="choice-button" type="button" data-choice="${escapeHTML(choice.user_id)}"><span>${escapeHTML(displayName(choice))}</span></button>`;
}

function renderInviteUnlock() {
    const remaining = Number(state.inviteStatus?.remaining || 0);
    return `<div class="invite-unlock">
        <span class="or-label">OR UNLOCK NOW</span>
        <strong>Invite 1 friend to get your next poll set</strong>
        <span>Invite a friend and you'll earn an extra poll unlock.</span>
        ${state.inviteStatus ? `<small>${remaining} invite ${remaining === 1 ? "unlock" : "unlocks"} left today</small>` : ""}
        <button class="primary-button" type="button" data-invite-unlock ${remaining < 1 && state.inviteStatus ? "disabled" : ""}>Invite & unlock polls</button>
    </div>`;
}

function renderLockedPlay() {
    const until = state.playLocked?.locked_until;
    clearInterval(state.playLockTimer);
    state.playLockTimer = null;
    $("#playCard").innerHTML = `<article class="locked-play-card">
        <h3>Next Poll Set Locked</h3>
        <img loading="lazy" decoding="async" class="lock-art" src="../assets/app/lock.webp" alt="">
        <p id="playLockMessage">${until ? "Checking unlock time..." : "New polls drop soon."}</p>
        ${renderInviteUnlock()}
        <button class="question-secondary-action" type="button" data-open-question><img loading="lazy" decoding="async" src="../assets/app/pencil-clipboard.webp" alt="">Submit a school question</button>
    </article>`;
    if (until) {
        const tick = () => {
            const remaining = Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 1000));
            const message = $("#playLockMessage");
            if (message) message.textContent = remaining
                ? `Unlocks in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
                : "Unlocking your next polls...";
            if (remaining > 0) return;
            clearInterval(state.playLockTimer);
            state.playLockTimer = null;
            state.playLocked = null;
            state.questions = [];
            state.questionIndex = 0;
            state.choicesByQuestion.clear();
            state.skipsUsedInSet = 0;
            loadPlay();
        };
        tick();
        if (state.playLocked?.locked_until === until) state.playLockTimer = setInterval(tick, 1000);
    }
}

function renderPlayCongrats() {
    $("#playProgress").textContent = "Complete";
    $("#playCard").innerHTML = `<article class="play-congrats-card">
        <h3>Congrats!</h3>
        <img loading="lazy" decoding="async" src="../assets/app/aura.webp" alt="">
        <p>You just earned <strong>${Number(state.playAuraEarned).toLocaleString()} aura</strong></p>
        <button class="primary-button" type="button" data-finish-play>W aura</button>
    </article>`;
}

function renderPlay() {
    const card = $("#playCard");
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
    if (choices.length < 4) {
        card.innerHTML = `<div class="empty-card locked-card"><img loading="lazy" decoding="async" class="empty-state-art" src="../assets/app/lock.webp" alt=""><strong>Add more classmates to play Valid.</strong><span>You need at least four classmates before a poll can start.</span><button class="primary-button" type="button" data-find-classmates>Find classmates</button><button class="secondary-button" type="button" data-invite-unlock>Share an invite</button></div>`;
        return;
    }
    const artworkURL = api.assetURL(question.image_url);
    const attribution = question.is_user_submitted ? `<div class="question-attribution">${question.is_anonymous ? avatarMarkup({ first_name: "Anonymous", profile_picture_url: "../assets/app/anonymous.webp" }, "attribution-avatar") : avatarMarkup({ first_name: question.submitted_by_name || "A classmate", profile_picture_url: question.submitted_by_avatar_url }, "attribution-avatar")}<span><small>Question submitted by</small><strong>${escapeHTML(question.is_anonymous ? "Someone at your school" : question.submitted_by_name || "A classmate")}</strong></span><div class="detail-overflow play-overflow"><button class="detail-overflow-button play-overflow-button" type="button" data-toggle-play-menu aria-label="More question actions" aria-expanded="false">•••</button><div class="detail-overflow-menu hidden" role="menu" aria-label="Question actions"><button type="button" role="menuitem" data-play-question-action="report">Report question</button>${question.is_anonymous ? "" : `<button type="button" role="menuitem" data-play-question-action="block">Block submitter</button>`}</div></div></div>` : "";
    const remainingSkips = Math.max(0, Number(state.config?.max_skips_per_set ?? 3) - state.skipsUsedInSet);
    card.innerHTML = `<article class="play-card">
        <div class="play-question-copy"><h3>${escapeHTML(question.question_text)}</h3>${attribution}</div>
        <div class="question-artwork">${artworkURL ? `<img loading="lazy" decoding="async" src="${escapeHTML(artworkURL)}" alt="">` : `<div class="artwork-placeholder"><img loading="lazy" decoding="async" src="../assets/app/pencil-clipboard.webp" alt=""><span>Question artwork</span></div>`}</div>
        <div class="choice-grid">${choices.map(choiceMarkup).join("")}</div>
        <div class="play-actions">
            <button class="play-action-button" data-shuffle type="button"><span aria-hidden="true">↻</span> Shuffle</button>
            <button class="play-action-button nominate" data-nominate type="button"><img loading="lazy" decoding="async" src="../assets/app/crown.webp" alt="">Nominate</button>
            <button class="play-action-button" data-skip="${question.id}" type="button" ${remainingSkips < 1 ? "disabled" : ""}>Skip (${remainingSkips})</button>
        </div>
    </article>`;
}

async function loadPlay() {
    if (state.questions.length || state.playLocked) return renderPlay();
    $("#playStatus").innerHTML = `<span class="play-loading-state"><span class="play-loading-gear" aria-hidden="true">⚙</span><span>Finding questions and classmates…</span></span>`;
    try {
        const [questionBatch, classmates, inviteStatus, config] = await Promise.all([
            api.getPlayQuestions(api.user.id),
            api.getClassmates(api.user.id),
            api.getInviteStatus(api.user.id).catch(() => null),
            state.config ? Promise.resolve(state.config) : api.getConfig().catch(() => ({
                nomination_aura_cost: 100,
                question_submission_aura_cost: 200,
                max_custom_question_length: 280,
                max_skips_per_set: 3,
                play_lock_time_seconds: 60,
            })),
        ]);
        state.questions = questionBatch.questions || [];
        state.classmates = classmates || [];
        state.inviteStatus = inviteStatus;
        state.config = config;
        $("#playStatus").textContent = "";
        renderPlay();
    } catch (error) {
        if (error.status === 423) {
            state.playLocked = error.detail || {};
            state.inviteStatus = await api.getInviteStatus(api.user.id).catch(() => null);
            $("#playStatus").textContent = "";
            renderLockedPlay();
        } else $("#playStatus").textContent = error.message || "Could not load Play.";
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
    const shown = new Set(choicesForQuestion(question).map((choice) => String(choice.user_id)));
    return state.classmates.filter((classmate) => String(classmate.user_id) !== String(api.user.id) && !shown.has(String(classmate.user_id)));
}

function renderNominationList() {
    const query = $("#nominationSearch").value.trim().toLowerCase();
    const candidates = nominationCandidates().filter((candidate) => displayName(candidate).toLowerCase().includes(query));
    const cost = Number(state.config?.nomination_aura_cost ?? 100);
    $("#nominationList").innerHTML = candidates.length ? candidates.map((candidate) => `<button class="nomination-row" type="button" data-nomination="${escapeHTML(candidate.user_id)}">
        ${avatarMarkup(candidate, "choice-avatar")}<strong>${escapeHTML(displayName(candidate))}</strong>
        <span class="nomination-cost"><img loading="lazy" decoding="async" src="../assets/app/aura.webp" alt="">${cost}</span>
    </button>`).join("") : `<div class="empty-card">${query ? "No matching classmates." : "Everyone else is already in this round. Shuffle for new choices."}</div>`;
}

function openNominationDialog() {
    $("#nominationSearch").value = "";
    $("#nominationStatus").textContent = "";
    renderNominationList();
    $("#nominationDialog").showModal();
    $("#nominationSearch").focus();
}

async function nominateClassmate(candidateId) {
    const question = state.questions[state.questionIndex];
    const candidate = state.classmates.find((item) => String(item.user_id) === candidateId);
    if (!question || !candidate) return;
    const cost = Number(state.config?.nomination_aura_cost ?? 100);
    if (Number(state.profile?.aura_points || 0) < cost) {
        $("#nominationStatus").textContent = `You need ${cost} aura to nominate someone.`;
        return;
    }
    if (!confirm(`Nominate ${displayName(candidate)} for ${cost} aura?`)) return;
    const button = $(`[data-nomination="${CSS.escape(candidateId)}"]`);
    if (button) setButtonLoading(button, true, "Nominating...");
    try {
        const result = await api.answerQuestion(api.user.id, {
            question_id: question.id,
            selected_contact_user_id: candidate.user_id,
            selected_contact_name: displayName(candidate),
            presented_options: choicesForQuestion(question).map((choice) => ({ phone: "", name: displayName(choice) })),
            is_nomination: true,
        });
        clearOptimisticEarnedProfile();
        if (state.profile && Number.isFinite(Number(result.total_aura_points))) {
            state.profile.aura_points = Number(result.total_aura_points);
            state.profile.current_streak = Math.max(0, Number(result.current_streak ?? state.profile.current_streak ?? 0));
            state.profile.streak_multiplier = Math.max(1, Number(result.streak_multiplier ?? state.profile.streak_multiplier ?? 1));
            renderProfileHeader();
        }
        $("#nominationDialog").close();
        showToast(`You nominated ${displayName(candidate)} 👑`);
        animateAuraChange(-Math.max(0, Number(state.config?.nomination_aura_cost ?? 100)));
        softHaptic();
        state.questionIndex += 1;
        renderPlay();
        refreshProfile();
        refreshFeedGateStatus();
    } catch (error) {
        $("#nominationStatus").textContent = error.message || "Could not save your nomination.";
        if (button) setButtonLoading(button, false);
    }
}

async function answerPlayQuestion(choiceId) {
    const question = state.questions[state.questionIndex];
    const choices = choicesForQuestion(question);
    const selected = choices.find((choice) => String(choice.user_id) === choiceId);
    if (!selected) return;
    const selectedButton = $(`[data-choice="${CSS.escape(choiceId)}"]`);
    const previousAura = Math.max(0, Number(state.profile?.aura_points || 0));
    const previousStreak = Math.max(0, Number(state.profile?.current_streak || 0));
    const previousMultiplier = Math.max(1, Number(state.profile?.streak_multiplier || 1));
    const expectedAura = expectedAuraPerAnswer();
    $$(".choice-button").forEach((button) => {
        button.disabled = true;
        button.classList.toggle("selected", button.dataset.choice === choiceId);
    });
    softHaptic();
    if (state.profile && expectedAura > 0) {
        state.profile.aura_points = previousAura + expectedAura;
        state.playAuraEarned += expectedAura;
        protectOptimisticEarnedProfile(state.profile.aura_points, previousStreak, previousMultiplier);
        renderProfileHeader();
        animateAuraChange(expectedAura, selectedButton);
    }
    try {
        const result = await api.answerQuestion(api.user.id, {
            question_id: question.id,
            selected_contact_user_id: selected.user_id,
            selected_contact_name: displayName(selected),
            presented_options: choices.map((choice) => ({ phone: "", name: displayName(choice) })),
            is_nomination: false,
        });
        const auraEarned = Math.max(0, Number(result.aura_points_earned || 0));
        const earnedDifference = auraEarned - expectedAura;
        state.playAuraEarned += earnedDifference;
        if (state.profile) {
            const reconciledAura = previousAura + auraEarned;
            const serverTotal = Number(result.total_aura_points);
            state.profile.aura_points = Number.isFinite(serverTotal) ? Math.max(reconciledAura, serverTotal) : reconciledAura;
            state.profile.current_streak = Math.max(0, Number(result.current_streak ?? previousStreak));
            state.profile.streak_multiplier = Math.max(1, Number(result.streak_multiplier ?? previousMultiplier));
            protectOptimisticEarnedProfile(state.profile.aura_points, state.profile.current_streak, state.profile.streak_multiplier);
            renderProfileHeader();
        }
        if (earnedDifference !== 0) animateAuraChange(earnedDifference);
        if (Number(state.profile?.current_streak || 0) > previousStreak) {
            showStreakCelebration(state.profile.current_streak, state.profile.streak_multiplier);
        }
        state.questionIndex += 1;
        renderPlay();
        refreshProfile();
        refreshFeedGateStatus();
    } catch (error) {
        if (state.profile) {
            state.profile.aura_points = previousAura;
            state.profile.current_streak = previousStreak;
            state.profile.streak_multiplier = previousMultiplier;
            state.playAuraEarned = Math.max(0, state.playAuraEarned - expectedAura);
            clearOptimisticEarnedProfile();
            renderProfileHeader();
        }
        showToast(error.message || "Could not save your answer.");
        renderPlay();
    }
}

function finishPlaySet() {
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

async function skipPlayQuestion(questionId) {
    const remaining = Math.max(0, Number(state.config?.max_skips_per_set ?? 3) - state.skipsUsedInSet);
    if (remaining < 1) return showToast("You've used all skips for this poll set.");
    state.skipsUsedInSet += 1;
    state.questionIndex += 1;
    renderPlay();
    try { await api.skipQuestion(api.user.id, questionId); }
    catch (_) { showToast("Skipped here. We'll sync it when the connection recovers."); }
}

async function moderatePlayQuestion(action) {
    const question = state.questions[state.questionIndex];
    if (!question?.is_user_submitted) return;
    const prompt = action === "block"
        ? "Block this question's submitter and skip the poll?"
        : "Report this question to Valid and skip the poll?";
    if (!confirm(prompt)) return;
    try {
        if (action === "block") await api.blockQuestionSubmitter(api.user.id, question.id);
        else await api.reportQuestion(api.user.id, question.id);
        state.questionIndex += 1;
        renderPlay();
        showToast(action === "block" ? "Submitter blocked" : "Reported to Valid");
    } catch (error) {
        showToast(error.message || `Could not ${action} this question.`);
    }
}

async function inviteAndUnlock(button) {
    setButtonLoading(button, true, "Making your invite...");
    try {
        const invite = await api.createInvite(api.user.id, "web");
        if (navigator.share) await navigator.share({ title: "Join me on Valid", text: "Join Valid and unlock my next polls", url: invite.share_url });
        else {
            await navigator.clipboard.writeText(invite.share_url);
            showToast("Invite link copied");
        }
    } catch (error) {
        if (error.name !== "AbortError") showToast(error.message || "Could not create an invite.");
    } finally {
        setButtonLoading(button, false);
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

async function refreshAskSafetyState() {
    if (!api.user?.id) return;
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
    } catch (_) { /* Keep the last authoritative safety state until the next refresh. */ }
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
        $("#askSafetyNoticeStatus").textContent = error.message || "Could not save your acknowledgement.";
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
        $("#askSafetyHistoryStatus").textContent = error.message || "Could not load safety notices.";
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
        const file = await createAskStoryFile(platform);
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
        $("#askStoryConfirmStatus").textContent = error.message || "Could not create the story image.";
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
    } catch (error) { showToast(error.message || "Could not update your link."); }
}

async function rotateAskLink() {
    if (!confirm("Replace your current ask link? The old link will stop working.")) return;
    try {
        state.askLink = await api.rotateAskLink(api.user.id);
        renderAskLink();
        showToast("New ask me link created");
    } catch (error) { showToast(error.message || "Could not replace your link."); }
}

function profileOriginalInformation() {
    return {
        first_name: String(state.profile?.first_name || "").trim(),
        last_name: String(state.profile?.last_name || "").trim(),
        username: String(state.profile?.username || "").trim().toLowerCase(),
        school_id: state.profile?.school_id ?? null,
        school_name: currentProfileSchoolName(),
        grade: String(state.profile?.grade || "").trim(),
    };
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
    setProfileBadge($("#profileUsernameBadge"), flags.username, !profileUsernameIsValid(draft) || (flags.username && state.profileCheckedUsername !== draft.username));
    setProfileBadge($("#profileNameBadge"), flags.name, !profileNameIsValid(draft));
    setProfileBadge($("#profileSchoolBadge"), flags.school, draft.school_id == null);
    setProfileBadge($("#profileGradeBadge"), flags.grade, !profileGradeIsValid());
    $$('[data-profile-editor]').forEach((button) => { button.disabled = informationLocked; });
    const changeCount = profileChangedFieldCount();
    $("#profileReviewButton").textContent = changeCount === 1 ? "Review 1 change" : `Review ${changeCount} changes`;
    $("#profileReviewButton").disabled = !profileDraftIsValid();
    const unsubscribeButton = $("#godModeUnsubscribeButton");
    const cancellationScheduled = state.godModeCancellation?.cancel_at_period_end === true;
    unsubscribeButton.classList.toggle("hidden", !hasActiveGodMode());
    unsubscribeButton.disabled = cancellationScheduled;
    $("#godModeUnsubscribeLabel").textContent = cancellationScheduled
        ? "God Mode cancellation scheduled"
        : "Unsubscribe from God Mode";
    $("#godModeUnsubscribeBadge").textContent = cancellationScheduled ? "Scheduled" : "";
    $("#godModeUnsubscribeBadge").className = cancellationScheduled ? "scheduled" : "";
    $("#profileEditHint").innerHTML = informationLocked
        ? `<strong>Profile changes are temporarily locked</strong><span>Username, name, school, and grade will be available again ${escapeHTML(relativeTime(state.profile.next_information_change_at))}.</span>`
        : "<strong>Profile changes are available every 14 days</strong><span>Change any combination below. Nothing is saved until you review and confirm everything.</span>";
}

async function unsubscribeFromGodMode() {
    if (!hasActiveGodMode()) return;
    const confirmed = confirm("Unsubscribe from God Mode? You’ll keep God Mode through the end of your current billing period, and then it won’t renew.");
    if (!confirmed) return;
    const button = $("#godModeUnsubscribeButton");
    const status = $("#profileGodModeStatus");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    status.textContent = "Updating your God Mode subscription...";
    try {
        const result = await api.unsubscribeFromGodMode(api.user.id);
        state.godModeCancellation = result;
        const ending = formatSafetyNoticeDate(result.subscription_expires_at);
        status.textContent = ending
            ? `Unsubscribed. God Mode stays active through ${ending}.`
            : "Unsubscribed. God Mode stays active through the current billing period.";
        showToast("God Mode renewal canceled");
        renderProfileEditorHub();
    } catch (error) {
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
            <span class="signup-school-logo">${logoURL ? `<img loading="lazy" decoding="async" src="${escapeHTML(logoURL)}" alt="">` : escapeHTML(initials)}</span>
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
        $("#profileSchoolStatus").textContent = error.message || "Couldn't load nearby schools.";
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
        $("#profileSchoolStatus").textContent = error.message || "Could not use that school.";
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
    $("#profileReviewRows").innerHTML = rows.join("");
    $("#profileSchoolChangeNote").classList.toggle("hidden", !flags.school);
    $("#profileInformationConfirmStatus").textContent = "";
}

function setProfileEditor(editor) {
    if (!state.profileDraft) return;
    syncProfileDraftFromInputs();
    state.profileEditor = editor;
    $$('[data-profile-panel]').forEach((panel) => panel.classList.toggle("hidden", panel.dataset.profilePanel !== editor));
    const titles = { hub: "Correct profile information", username: "Username", name: "Name", school: "School", grade: "Grade", review: "Review changes" };
    $("#profileEditorTitle").textContent = titles[editor] || titles.hub;
    $("#profileEditorBack").classList.toggle("hidden", editor === "hub");
    $("#profileEditorCancel").classList.toggle("hidden", editor !== "hub");
    if (editor === "hub") renderProfileEditorHub();
    if (editor === "grade") renderProfileGradeOptions();
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
    $("#profileGodModeStatus").textContent = "";
    setProfileEditor("hub");
    $("#profileDialog").showModal();
}

function cancelProfileEditor() {
    if (profileChangedFieldCount() && !confirm("Discard your profile information changes?")) return;
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
        $("#profileUsernameStatus").textContent = error.message || "Couldn't check availability. Please try again.";
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
        $("#profileInformationConfirmStatus").textContent = error.message || "Could not save all profile changes.";
    } finally { setButtonLoading(button, false); }
}

function openBioDialog() {
    $("#profileBio").value = state.profile?.bio || "";
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
        $("#bioEditStatus").textContent = error.message || "Could not update your bio.";
    } finally { setButtonLoading(button, false); }
}

function openFeedbackDialog() {
    const form = $("#feedbackForm");
    form.reset();
    $("#feedbackStatus").textContent = "";
    $("#feedbackDialog").showModal();
    requestAnimationFrame(() => $("#feedbackText").focus());
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
        status.textContent = error.message || "Could not send your feedback.";
    } finally {
        setButtonLoading(button, false);
    }
}

async function changeProfilePicture(event) {
    const input = event.currentTarget;
    const file = input.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
        input.value = "";
        return showToast("Profile photos must be 5 MB or smaller.");
    }
    showToast("Uploading photo...");
    try {
        await api.uploadProfilePicture(api.user.id, file);
        await refreshProfile();
        showToast("Profile photo updated");
    } catch (error) {
        showToast(error.message || "Could not update your photo.");
    } finally { input.value = ""; }
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
    $("#questionImagePreview").innerHTML = `<span class="question-image-placeholder"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"></rect><circle cx="9" cy="10" r="2"></circle><path d="m5.5 17 4.5-4 3 2.5 2.5-2 3 3.5"></path></svg><strong>Tap to add an image</strong></span>`;
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
        $("#questionStatus").textContent = "That photo format could not be decoded by this browser. Choose a JPEG or PNG, or export the photo as Most Compatible.";
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
        showToast(result.is_duplicate ? "Already submitted · waiting for review" : "Question sent for review ✨");
    } catch (error) {
        const definitive = error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
        if (definitive) {
            state.pendingQuestionSubmissionKey = null;
            state.pendingQuestionDraft = null;
            $("#questionStatus").textContent = error.message || "Could not submit your question.";
        } else {
            $("#questionStatus").textContent = error.status === 429
                ? error.message
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
            <div class="question-history-summary">${imageURL ? `<img src="${escapeHTML(imageURL)}" alt="" loading="lazy" decoding="async">` : `<span class="question-history-image-placeholder" aria-hidden="true">▧</span>`}<div><strong>${escapeHTML(question.question_text || "Question")}</strong><small>${question.is_anonymous ? "Posted anonymously" : "Posted with your name"}</small></div></div>
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
        $("#questionHistoryStatus").textContent = error.message || "Could not load your questions. Try again.";
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
        $("#questionRemovalStatus").textContent = error.message || (approved ? "Could not deactivate that question." : "Could not delete that submission.");
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
    $("#signupPhotoPreview").innerHTML = `<span class="signup-photo-placeholder"><span class="signup-photo-person-icon"></span><small>Tap to add photo</small></span>`;
}

function previewSignupPhoto() {
    const input = $("#signupPicture");
    const file = input.files[0];
    const preview = $("#signupPhotoPreview");
    if (!file) {
        resetSignupPhotoPreview();
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        input.value = "";
        resetSignupPhotoPreview();
        $("#signupStatus").textContent = "Profile photos must be 5 MB or smaller.";
        return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => { preview.innerHTML = `<img loading="lazy" decoding="async" src="${escapeHTML(reader.result)}" alt="">`; }, { once: true });
    reader.addEventListener("error", resetSignupPhotoPreview, { once: true });
    reader.readAsDataURL(file);
}

function contactsPickerSupported() {
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
    $("#classmatesStatus").textContent = contactsPickerSupported()
        ? ""
        : "The Google contact picker is available in Chrome on Android. You can skip this step.";
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

function contactPayload(selectedContacts) {
    const unique = new Map();
    for (const contact of selectedContacts) {
        const name = Array.isArray(contact.name) ? contact.name[0] : contact.name;
        const phones = Array.isArray(contact.tel) ? contact.tel : [contact.tel];
        for (const phone of phones) {
            let digits = String(phone || "").replace(/\D/g, "");
            if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
            if (!name?.trim() || digits.length !== 10) continue;
            unique.set(digits, { phone_number: digits, name: String(name).trim() });
        }
    }
    return [...unique.values()];
}

async function chooseContacts() {
    const button = $("#chooseContactsButton");
    setButtonLoading(button, true, "Opening contacts...");
    $("#classmatesStatus").textContent = "";
    try {
        const selected = demoMode
            ? [{ name: ["Riley Demo"], tel: ["4155550111"] }, { name: ["Casey Demo"], tel: ["4155550112"] }]
            : await navigator.contacts.select(["name", "tel"], { multiple: true });
        const contacts = contactPayload(selected);
        if (!contacts.length) {
            $("#classmatesStatus").textContent = selected.length ? "Choose contacts with a name and a US phone number." : "No contacts selected.";
            return;
        }
        setButtonLoading(button, true, "Finding classmates...");
        let acceptedCount = 0;
        for (let offset = 0; offset < contacts.length; offset += 250) {
            const accepted = await api.addContacts(api.user.id, contacts.slice(offset, offset + 250));
            acceptedCount += accepted.length;
            for (const contact of accepted) {
                if (contact.is_six7_user === false) continue;
                const classmateId = contact.user_id || contact.matched_user_id || contact.contact_user_id;
                if (classmateId) state.contactClassmateIds.add(String(classmateId));
            }
        }
        writeAppCache("contact-classmates", [...state.contactClassmateIds]);
        $("#classmatesStatus").textContent = `${acceptedCount} ${acceptedCount === 1 ? "classmate" : "classmates"} added. No messages were sent.`;
        await new Promise((resolve) => setTimeout(resolve, demoMode ? 0 : 900));
        state.classmates = await api.getClassmates(api.user.id).catch(() => state.classmates);
        state.choicesByQuestion.clear();
        if (state.contactOnboarding || state.classmates.length >= 4) {
            $("#classmatesDialog").close();
            showToast(state.contactOnboarding ? "Friends added ✨" : "Classmates are ready for Play ✨");
            if (state.activePanel === "play") renderPlay();
        }
    } catch (error) {
        if (error.name !== "AbortError") $("#classmatesStatus").textContent = error.message || "Could not add those classmates.";
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
        if (error.name !== "AbortError") $("#classmatesStatus").textContent = error.message || "Could not create an invite.";
    } finally {
        setButtonLoading(button, false);
        state.inviteStatus = await api.getInviteStatus(api.user.id).catch(() => state.inviteStatus);
        renderInviteRewardCard();
    }
}

function openDeleteAccountDialog() {
    $("#deleteAccountForm").reset();
    $("#deleteAccountStatus").textContent = "";
    $("#deleteAccountDialog").showModal();
}

async function requestAccountDeletion(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    setButtonLoading(button, true, "Scheduling...");
    $("#deleteAccountStatus").textContent = "";
    try {
        await preloadRoute("chats").then((route) => route?.beforeSessionEnd?.()).catch(() => null);
        const result = await api.requestAccountDeletion(api.user.id);
        const scheduled = new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" }).format(new Date(result.scheduled_for));
        $("#deleteAccountDialog").close();
        await import("./chat/outbox.js")
            .then(({ clearChatOutboxes }) => clearChatOutboxes(api.user.id))
            .catch(() => null);
        clearQuestionSubmissionState();
        api.clearSession();
        showSignedOut(`Account deletion is scheduled for ${scheduled}. Sign in with your passkey before then if you want to keep it.`);
    } catch (error) {
        $("#deleteAccountStatus").textContent = error.message || "Could not schedule account deletion.";
    } finally {
        setButtonLoading(button, false);
    }
}

function showPendingDeletion() {
    const requestedAt = new Date(api.user.deletion_requested_at);
    const scheduledAt = new Date(requestedAt.getTime() + 5 * 86_400_000);
    const when = Number.isFinite(scheduledAt.getTime())
        ? new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" }).format(scheduledAt)
        : "after the five-day grace period";
    $("#pendingDeletionCopy").textContent = `It will be permanently deleted ${when}. Keep it now to restore normal use.`;
    $("#pendingDeletionStatus").textContent = "";
    $("#pendingDeletionDialog").showModal();
}

async function cancelAccountDeletion() {
    const button = $("#cancelDeletionButton");
    setButtonLoading(button, true, "Restoring...");
    try {
        await api.cancelAccountDeletion(api.user.id);
        api.user.deletion_requested_at = null;
        $("#pendingDeletionDialog").close();
        showToast("Your account is staying on Valid ✨");
    } catch (error) {
        $("#pendingDeletionStatus").textContent = error.message || "Could not keep your account.";
    } finally {
        setButtonLoading(button, false);
    }
}

async function logoutAndReset() {
    const userId = api.user?.id;
    clearCachedAppState();
    await preloadRoute("chats").then((route) => route?.beforeSessionEnd?.()).catch(() => null);
    await detachWebPushSubscription().catch(() => null);
    await api.logout().catch(() => null);
    await import("./chat/outbox.js")
        .then(({ clearChatOutboxes }) => clearChatOutboxes(userId))
        .catch(() => null);
    clearQuestionSubmissionState();
    api.clearSession();
    location.href = "./?signin=1";
}

function switchPanel(panel, { historyMode = "push", restoreScroll = true } = {}) {
    if (!["feed", "play", "chats", "profile"].includes(panel)) return;
    if (panel === "chats" && !(state.config?.enable_chats === true && state.config?.enable_web_chats === true)) return;
    const previousPanel = state.activePanel;
    if (previousPanel !== panel) state.tabScrollPositions[previousPanel] = window.scrollY;
    else if (historyMode === "push") state.tabScrollPositions[panel] = 0;
    state.activePanel = panel;
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
        load: loadFeed,
    });
    if (panel === "play") context.load = loadPlay;
    if (panel === "chats") Object.assign(context, {
        root: $("#chatsRoot"), api,
        getUser: () => api.user,
        getConfig: () => state.config,
        softHaptic, successHaptic, showToast,
        onUnreadChange: renderChatUnreadBadge,
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
    softHaptic(12);
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

function beginPullRefresh(event) {
    if (!document.body.classList.contains("authenticated") || window.scrollY > 0 || $("dialog[open], .detail-screen:not(.hidden)")) return;
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
    indicator.classList.toggle("ready", state.pullRefreshDistance >= 64);
}

function movePullRefresh(event) {
    if (state.pullRefreshStartY === null) return;
    const currentY = event.touches?.[0]?.clientY;
    if (!Number.isFinite(currentY)) return;
    state.pullRefreshDistance = Math.max(0, Math.min(110, (currentY - state.pullRefreshStartY) * .55));
    if (pullRefreshFrame === null) pullRefreshFrame = requestAnimationFrame(renderPullRefreshDistance);
}

function endPullRefresh() {
    if (state.pullRefreshStartY === null) return;
    const shouldRefresh = state.pullRefreshDistance >= 64;
    state.pullRefreshStartY = null;
    state.pullRefreshDistance = 0;
    if (pullRefreshFrame !== null) cancelAnimationFrame(pullRefreshFrame);
    pullRefreshFrame = null;
    const indicator = $("#pullRefreshIndicator");
    clearRuntimeStyles(indicator, "--pull-distance", "--pull-opacity");
    indicator.classList.remove("ready");
    if (shouldRefresh) refreshActivePanel();
}

function installNativeSheetGestures() {
    if (!isAndroidDevice()) return;
    for (const dialog of $$("dialog.modal")) {
        if (dialog.dataset.sheetGesture === "1" || dialog.classList.contains("reaction-picker-dialog")) continue;
        dialog.dataset.sheetGesture = "1";
        let startY = null;
        let dragDistance = 0;
        let dragFrame = null;
        dialog.addEventListener("pointerdown", (event) => {
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

    for (const screen of $$(".detail-screen")) {
        let startX = null;
        screen.addEventListener("pointerdown", (event) => {
            if (event.clientX <= 24 && !event.target.closest("input, textarea, select")) startX = event.clientX;
        });
        screen.addEventListener("pointerup", (event) => {
            if (startX !== null && event.clientX - startX > 88) closeDetailScreen(screen);
            startX = null;
        });
        screen.addEventListener("pointercancel", () => { startX = null; });
    }
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
        showToast("Valid is installed ✨");
        return;
    }
    if ($("#androidInstallDialog").open) {
        $("#androidInstallStatus").textContent = "Installation was canceled. Tap Install Valid when you’re ready.";
    }
}

function showAppUpdatePrompt(worker) {
    if (!worker) return;
    state.waitingServiceWorker = worker;
    $("#appUpdatePrompt").classList.remove("hidden");
}

function registerAppServiceWorker() {
    navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" }).then((registration) => {
        refreshWebPushStatus();
        if (registration.waiting) showAppUpdatePrompt(registration.waiting);
        registration.addEventListener("updatefound", () => {
            const worker = registration.installing;
            worker?.addEventListener("statechange", () => {
                if (worker.state === "installed" && navigator.serviceWorker.controller) showAppUpdatePrompt(worker);
            });
        });
    }).catch(() => null);
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing || !state.appUpdateRequested) return;
        refreshing = true;
        location.reload();
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
    const button = $("#notificationButton");
    if (!webPushSupported()) {
        button.classList.add("hidden");
        renderProfileActionsVisibility();
        renderFeedNotificationPrompt();
        return;
    }
    button.classList.remove("hidden");
    renderProfileActionsVisibility();
    const status = $("#notificationStatusText");
    const enabled = Boolean(state.webPushSubscription && state.webPushRegistrationState === "on");
    button.setAttribute("aria-checked", String(enabled));
    button.classList.toggle("on", enabled);
    if (Notification.permission === "denied") {
        status.textContent = "Blocked in browser settings";
    } else if (state.webPushSubscription && state.webPushRegistrationState === "on") {
        status.textContent = "On · tap to turn off";
    } else if (state.webPushSubscription && state.webPushRegistrationState === "syncing") {
        status.textContent = "Finishing setup…";
    } else if (state.webPushSubscription && state.webPushRegistrationState === "error") {
        status.textContent = "Setup incomplete · tap to retry";
    } else {
        status.textContent = "Off · tap to turn on";
    }
    renderFeedNotificationPrompt();
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

async function refreshWebPushStatus({ sync = false } = {}) {
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
    }
    if (sync && state.webPushSubscription && api.user?.id) {
        state.webPushRegistrationState = "syncing";
        renderWebPushStatus();
        try {
            await syncWebPushSubscription(state.webPushSubscription);
        } catch (error) {
            state.webPushRegistrationState = "error";
            state.webPushRegistrationError = error.message || "Could not finish notification setup.";
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
                await detachWebPushSubscription();
                showToast("Notifications turned off");
            } else {
                state.webPushSubscription = existing;
                state.webPushRegistrationState = "syncing";
                renderWebPushStatus();
                await syncWebPushSubscription(existing);
                renderWebPushStatus();
                showToast("Notifications are on ✨");
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
        showToast("Notifications are on ✨");
    } catch (error) {
        if (state.webPushSubscription) {
            state.webPushRegistrationState = "error";
            state.webPushRegistrationError = error.message || "Could not finish notification setup.";
        } else {
            state.webPushRegistrationState = "off";
        }
        renderWebPushStatus();
        showToast(error.message || "Could not enable notifications.");
    } finally {
        state.webPushBusy = false;
        button.disabled = false;
        renderWebPushStatus();
    }
}

function bindEvents() {
    $("#passkeyButton").addEventListener("click", handlePasskeySignIn);
    $("#createAccountButton").addEventListener("click", openSignupDialog);
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
        $("#myVotesFilter").classList.add("hidden");
        $("#schoolFeedControls").classList.toggle("hidden", state.feedType !== "school");
        $("#personalInboxControls").classList.toggle("hidden", state.feedType !== "personal");
        $("#myVotesFilter").classList.remove("active");
        $("#myVotesFilter").setAttribute("aria-pressed", "false");
        $("#myVotesFilter").textContent = "○ My Votes";
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
    $("#myVotesFilter").addEventListener("click", (event) => {
        state.myVotesOnly = !state.myVotesOnly;
        event.currentTarget.classList.toggle("active", state.myVotesOnly);
        event.currentTarget.setAttribute("aria-pressed", String(state.myVotesOnly));
        event.currentTarget.textContent = `${state.myVotesOnly ? "✓" : "○"} My Votes`;
        loadFeed(true);
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
    $("#loadMoreFeed").addEventListener("click", () => loadFeed(false));
    $("#feedList").addEventListener("click", (event) => {
        const reactionPicker = event.target.closest("[data-reaction-picker]");
        const reactors = event.target.closest("[data-reactors]");
        if (reactionPicker) return openReactionPicker(reactionPicker.dataset.reactionPicker, reactionPicker);
        if (reactors) return openReactorList(reactors.dataset.reactors);
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
    $("#feedList").addEventListener("keydown", (event) => {
        if (!["Enter", " "].includes(event.key)) return;
        const detail = event.target.closest("[data-feed-detail]");
        const tbhDetail = event.target.closest("[data-tbh-detail]");
        if (tbhDetail) {
            event.preventDefault();
            openTbhDetail(tbhDetail.dataset.tbhDetail);
            return;
        }
        if (detail) {
            event.preventDefault();
            openFeedDetail(detail.dataset.feedDetail);
        }
    });
    $("#feedDetailDialog").addEventListener("click", (event) => {
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
    $("#feedNotificationButton").addEventListener("click", toggleWebPush);
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
        const preload = () => { void preloadRoute(button.dataset.panel); };
        button.addEventListener("pointerenter", preload, { passive: true });
        button.addEventListener("focus", preload);
        button.addEventListener("click", (event) => {
            let historyMode = "push";
            if (button.dataset.panel === "chats" && state.activePanel === "chats" && new URLSearchParams(location.search).has("chat")) {
                const url = new URL(location.href);
                url.searchParams.delete("chat");
                history.pushState({ validApp: true, panel: "chats" }, "", `${url.pathname}${url.search}`);
                historyMode = "none";
            }
            switchPanel(button.dataset.panel, { historyMode });
            if (event.detail > 0) button.blur();
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
        if (event.target.closest("[data-finish-play]")) finishPlaySet();
        if (event.target.closest("[data-open-question]")) openQuestionDialog();
    });
    $("#nominationSearch").addEventListener("input", renderNominationList);
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
        if (event.target.closest("[data-edit-photo]")) $("#profilePictureInput").click();
        if (event.target.closest("[data-edit-bio]")) openBioDialog();
        if (event.target.closest("[data-edit-profile]")) openProfileDialog();
        if (event.target.closest("#viewClassmatesButton")) openClassmateDirectory();
        if (event.target.closest("#findContactsButton")) openClassmatesDialog();
        if (event.target.closest("#profileSignOutButton")) logoutAndReset();
        const invite = event.target.closest("[data-profile-invite]");
        if (invite) shareProfileInvite(invite, invite.dataset.profileInvite);
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
    $("#feedbackButton").addEventListener("click", openFeedbackDialog);
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
    $("#cancelDeletionButton").addEventListener("click", cancelAccountDeletion);
    $("#pendingDeletionLogout").addEventListener("click", logoutAndReset);
    $("#installAppButton").addEventListener("click", installWebApp);
    $("#androidInstallButton").addEventListener("click", installWebApp);
    $("#androidInstallDialog").addEventListener("cancel", (event) => event.preventDefault());
    $("#applyAppUpdate").addEventListener("click", () => {
        $("#applyAppUpdate").disabled = true;
        state.appUpdateRequested = true;
        state.waitingServiceWorker?.postMessage({ type: "SKIP_WAITING" });
    });
    $("#notificationButton").addEventListener("click", toggleWebPush);
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
    $("#godModeUnsubscribeButton").addEventListener("click", unsubscribeFromGodMode);
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
            $("#profileNameStatus").textContent = profileNameIsValid() ? "" : "Use at least two letters for each name. Hyphens and apostrophes are okay.";
            if (profileNameIsValid()) setProfileEditor("hub");
        }
        if (done?.dataset.profileDone === "grade" && profileGradeIsValid()) setProfileEditor("hub");
    });
    $("#profileFirstName").addEventListener("input", (event) => {
        event.target.value = event.target.value.replace(/[^\p{L}' -]/gu, "");
        syncProfileDraftFromInputs();
        $("#profileNameStatus").textContent = profileNameIsValid() ? "" : "Use at least two letters for each name. Hyphens and apostrophes are okay.";
    });
    $("#profileLastName").addEventListener("input", (event) => {
        event.target.value = event.target.value.replace(/[^\p{L}' -]/gu, "");
        syncProfileDraftFromInputs();
        $("#profileNameStatus").textContent = profileNameIsValid() ? "" : "Use at least two letters for each name. Hyphens and apostrophes are okay.";
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
    document.addEventListener("error", handleAvatarImageError, true);
    $$("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
    addEventListener("valid:session-expired", () => showSignedOut("Your session expired. Sign in with your passkey again."));
    addEventListener("valid:feed-update", (event) => applyFeedRealtimeEvent(event.detail));
    addEventListener("popstate", handleAppPopState);
    addEventListener("offline", updateNetworkStatus);
    addEventListener("online", updateNetworkStatus);
    addEventListener("focus", checkStripeCheckout);
    addEventListener("focus", () => refreshWebPushStatus());
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            refreshWebPushStatus();
            refreshAskSafetyState();
        }
    });
    $("#appView").addEventListener("touchstart", beginPullRefresh, { passive: true });
    $("#appView").addEventListener("touchmove", movePullRefresh, { passive: true });
    $("#appView").addEventListener("touchend", endPullRefresh, { passive: true });
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
        showToast("Valid is on your home screen ✨");
    });
}

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
document.addEventListener("focusout", scheduleVisualViewportSync);
bindEvents();
installNativeSheetGestures();
initializeParkedUI();
if (!navigator.onLine) updateNetworkStatus();
if ("serviceWorker" in navigator && !demoMode) {
    registerAppServiceWorker();
    navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type !== "VALID_NOTIFICATION_CLICK") return;
        const target = new URL(event.data.url || "./", location.origin);
        if (target.origin === location.origin && target.pathname.startsWith("/app/")) location.href = target.href;
    });
}
if (!passkeysSupported() && !demoMode) {
    $("#passkeyButton").disabled = true;
    $("#authStatus").textContent = "This browser does not support passkeys. Try current Chrome, Safari, or Edge.";
}

let authFlowStarted = false;

async function restoreOrStartAuthFlow() {
    if (authFlowStarted) return;
    authFlowStarted = true;
    if (!demoMode) {
        $("#authStatus").textContent = "Checking your session…";
        try {
            const session = await api.restoreSession();
            api.saveSession(session);
            $("#authStatus").textContent = "";
            await showSignedIn();
            return;
        } catch (error) {
            api.clearSession();
            $("#authStatus").textContent = error.status && error.status !== 401
                ? error.message || "Could not restore your session."
                : "";
        }
    }
    const authParams = new URLSearchParams(window.location.search);
    if (authParams.get("signup") === "1" || (!demoMode && authParams.get("signin") !== "1")) {
        requestAnimationFrame(openSignupDialog);
    }
}

if (androidInstallRequested()) showAndroidInstallGate();
else restoreOrStartAuthFlow();
