import { ValidAPI } from "./api.js";
import { DemoAPI, localDemoAllowed } from "./demo-api.js";
import { createAdditionalPasskey, createSignupPasskey, passkeysSupported, signInWithPasskey } from "./passkeys.js";

const demoMode = localDemoAllowed();
const api = demoMode ? new DemoAPI() : new ValidAPI();
const DEFAULT_FULL_REVEAL_AURA_COST = 1000;
const TURNSTILE_ACTION = "phone_otp_request";
const state = {
    profile: null,
    activePanel: "feed",
    feedType: "personal",
    myVotesOnly: false,
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
    questionArtworkPreviewURL: null,
    questionArtworkProcessing: false,
    optimisticEarnedProfile: null,
    pendingProfileInformation: null,
    profileDraft: null,
    profileEditor: "hub",
    profileNearbySchools: [],
    profileSchoolLookupGeneration: 0,
    profileCheckedUsername: null,
    viewportBaselineWidth: window.innerWidth,
    viewportBaselineHeight: window.innerHeight,
    installPrompt: null,
    webPushSubscription: null,
    webPushBusy: false,
    webPushRegistrationState: "off",
    webPushRegistrationError: "",
    detailReturnFocus: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

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
    document.documentElement.style.setProperty("--visual-viewport-bottom", `${bottomInset}px`);
    document.documentElement.style.setProperty("--visual-viewport-top", `${viewport.offsetTop}px`);
    document.documentElement.style.setProperty("--visual-viewport-left", `${viewport.offsetLeft}px`);
    document.documentElement.style.setProperty("--visual-viewport-center", `${viewport.offsetLeft + viewport.width / 2}px`);
    document.documentElement.style.setProperty("--visual-viewport-middle", `${viewport.offsetTop + viewport.height / 2}px`);
    document.documentElement.style.setProperty("--visual-viewport-width", `${viewport.width}px`);
    document.documentElement.style.setProperty("--visual-viewport-height", `${viewport.height}px`);
    document.documentElement.style.setProperty("--signup-visual-offset", `${viewport.offsetTop}px`);
    document.documentElement.classList.toggle("keyboard-open", keyboardOpen);
    if (keyboardOpen) requestAnimationFrame(keepFocusedControlVisible);
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
    const rawURL = profile?.profile_picture_url_thumb || profile?.profile_picture_url || fallbackURL;
    const imageURL = api.assetURL(rawURL);
    const name = displayName(profile);
    return `<span class="${className}">${imageURL
        ? `<img src="${escapeHTML(imageURL)}" alt="${escapeHTML(name)}">`
        : `<span>${escapeHTML(initials(profile))}</span>`}</span>`;
}

function shareIconMarkup(platform) {
    if (platform === "instagram") {
        return `<svg viewBox="0 0 64 64" role="img" aria-label="Instagram"><rect x="15" y="15" width="34" height="34" rx="10" fill="none" stroke="white" stroke-width="4"/><circle cx="32" cy="32" r="8" fill="none" stroke="white" stroke-width="4"/><circle cx="44" cy="20" r="2.5" fill="white"/></svg>`;
    }
    if (platform === "tiktok") {
        return `<svg viewBox="0 0 64 64" role="img" aria-label="TikTok"><rect width="64" height="64" rx="15" fill="#000"/><path d="M37 14c1 7 5 11 12 12v8c-5 0-9-2-12-4v13c0 9-7 14-15 12-7-2-11-9-9-16 2-6 7-10 14-10v8c-4 0-6 2-6 5 0 4 3 6 6 5 2-1 3-3 3-6V14h7Z" fill="#25f4ee" transform="translate(-2 1)"/><path d="M39 13c1 7 5 11 12 12v7c-5 0-9-2-12-4v14c0 8-7 14-15 12-6-2-10-8-9-14 1-7 7-11 14-11v7c-4 0-6 2-6 5 0 4 3 6 6 5 2-1 3-3 3-6V13h7Z" fill="#fe2c55" transform="translate(2 -1)"/><path d="M38 14c1 6 5 10 11 11v6c-4 0-8-1-11-4v14c0 7-6 12-13 11-6-1-10-7-8-13 1-5 5-8 11-8v6c-3 0-5 2-5 5 0 3 3 5 6 4 2-1 3-3 3-6V14h6Z" fill="#fff"/></svg>`;
    }
    return `<img src="../assets/app/snapchat-logo.png" alt="Snapchat">`;
}

function openDetailScreen(screen) {
    closeDetailActionMenus();
    state.detailReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    screen.classList.remove("hidden");
    screen.scrollTop = 0;
    document.body.classList.add("detail-screen-open");
    screen.querySelector("[aria-label='Close']")?.focus({ preventScroll: true });
}

function closeDetailScreen(screen) {
    closeDetailActionMenus();
    screen.classList.add("hidden");
    if (!$(".detail-screen:not(.hidden)")) document.body.classList.remove("detail-screen-open");
    state.detailReturnFocus?.focus?.({ preventScroll: true });
    state.detailReturnFocus = null;
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
    $("#authStatus").textContent = message;
}

async function showSignedIn() {
    $("#authView").classList.add("hidden");
    $("#appView").classList.remove("hidden");
    $("#bottomNav").classList.remove("hidden");
    $("#logoutButton").classList.remove("hidden");
    syncVisualViewport();
    requestAnimationFrame(() => requestAnimationFrame(syncVisualViewport));
    setTimeout(syncVisualViewport, 120);
    try {
        const [profile, currentUser, classmatesStatus, config, askAccess, askSafetyNotices, askSafetyNoticeHistory] = await Promise.all([
            api.getProfile(api.user.id),
            api.getUser(api.user.id).catch(() => api.user),
            api.getClassmatesStatus(api.user.id).catch(() => null),
            api.getConfig().catch(() => ({
                nomination_aura_cost: 100,
                question_submission_aura_cost: 200,
                max_custom_question_length: 280,
                max_skips_per_set: 3,
                play_lock_time_seconds: 60,
                full_reveal_aura_cost: DEFAULT_FULL_REVEAL_AURA_COST,
            })),
            api.getAnonymousAskAccess(api.user.id).catch(() => null),
            api.getAnonymousAskSafetyNotices(api.user.id).catch(() => []),
            api.getAnonymousAskSafetyNotices(api.user.id, true).catch(() => []),
        ]);
        api.user = { ...api.user, ...currentUser };
        state.profile = profile;
        state.classmatesStatus = classmatesStatus;
        state.config = config;
        state.askAccess = askAccess;
        state.askSafetyNotices = askSafetyNotices;
        state.askSafetyNoticeHistory = askSafetyNoticeHistory;
        renderProfileHeader();
        renderFeedGate();
        refreshWebPushStatus({ sync: true });
        if (!isFeedVoteLocked()) await loadFeed(true);
        if (api.user?.deletion_requested_at) showPendingDeletion();
        else showNextAskSafetyNotice();
    } catch (error) {
        if (error.status !== 401) $("#feedStatus").textContent = error.message || "Could not load your profile.";
    }
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
        ? `<img src="${escapeHTML(imageURL)}" alt="">`
        : escapeHTML(initials(profile));
}

function formatGrade(value = "") {
    return String(value).replace("S/O", "C/O").replace("Grade ", "");
}

function formatVoterHint(item) {
    if (item.current_user_voted) return `from ${displayName(state.profile)}`;
    if (item.voter_name) return `from ${item.voter_name}`;
    const gender = String(item.voter_gender || "").toLowerCase();
    const emoji = ["female", "girl"].includes(gender) ? "👧💗" : ["male", "boy"].includes(gender) ? "👦💙" : gender === "non-binary" ? "🧑💛" : "";
    const grade = formatGrade(item.voter_grade || "");
    if (grade) return `from ${emoji} ${grade}`.replace(/\s+/g, " ");
    return emoji ? `from ${emoji}` : "";
}

function formatVoterStatement(item) {
    if (item.current_user_voted) return `${displayName(state.profile)} said`;
    if (item.voter_name) return `${item.voter_name} said`;
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

function renderProfilePolls(container, questions, emptyMessage) {
    if (!questions?.length) {
        container.innerHTML = `<div class="profile-poll-empty">${escapeHTML(emptyMessage)}</div>`;
        return;
    }
    container.innerHTML = questions.map((question, index) => {
        const imageURL = api.assetURL(question.image_url);
        const pollKey = `${question.question_id || question.id || index}`;
        return `<button class="profile-poll-row" type="button" data-top-poll="${escapeHTML(pollKey)}" aria-label="Open poll: ${escapeHTML(question.question_text)}">
            <div class="profile-poll-art">${imageURL ? `<img src="${escapeHTML(imageURL)}" alt="">` : `<span>${index + 1}</span>`}</div>
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
    $("#profileCard").innerHTML = `<article class="full-profile-card">
        <button class="profile-photo-button" type="button" data-edit-photo aria-label="Change profile picture">
            <span class="full-profile-avatar">${imageURL ? `<img src="${escapeHTML(imageURL)}" alt="${escapeHTML(displayName(profile))}">` : `<span>${escapeHTML(initials(profile))}</span>`}</span>
            <span class="photo-edit-badge" aria-hidden="true">✎</span>
        </button>
        <h3>${escapeHTML(displayName(profile))}</h3>
        <div class="profile-handle">@${escapeHTML(profile.username || "valid")}</div>
        <button class="profile-bio-button ${profile.bio ? "" : "empty"}" type="button" data-edit-bio>${profile.bio ? escapeHTML(profile.bio) : "+ Add bio"}</button>
        ${(schoolName || grade) ? `<div class="profile-school-meta">${schoolName ? `<span>🏫 ${escapeHTML(schoolName)}</span>` : ""}${grade ? `<span>🎓 ${escapeHTML(grade)}</span>` : ""}</div>` : ""}
        <button class="profile-information-inline" type="button" data-edit-profile>
            <span class="profile-information-icon">${profileInformationIcon(canChangeInformation)}</span>
            <span class="profile-information-copy"><strong>Profile information</strong>${informationStatus ? `<small>${escapeHTML(informationStatus)}</small>` : ""}</span>
            <span class="profile-information-chevron" aria-hidden="true">›</span>
        </button>
        <div class="profile-stats-grid">
            <div class="profile-stat-card"><strong><img class="profile-aura-icon" src="../assets/app/aura.png" alt="">${Number(profile.aura_points || 0).toLocaleString()}</strong><span>Aura</span></div>
            <div class="profile-stat-card"><strong><span class="heart">♥</span>${Number(profile.vote_count || 0).toLocaleString()}</strong><span>Votes Received</span></div>
        </div>
    </article>`;
    renderSchoolCard();
    renderProfilePolls($("#weeklyPolls"), state.topQuestionsWeekly, "No polls this week yet");
    renderProfilePolls($("#allTimePolls"), state.topQuestionsAllTime, "No polls yet");
    renderGodModeCard();
    renderAuraPurchases();
    renderPasskeyStatus();
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
        <button id="viewClassmatesButton" class="secondary-button" type="button">View classmates</button>
    </article>`;
}

function renderPasskeyStatus() {
    const count = Math.max(0, Number(state.passkeyStatus?.credentialCount || 0));
    const registered = state.passkeyStatus?.registered === true || count > 0;
    const button = $("#addPasskeyButton");
    button.classList.toggle("hidden", !state.passkeyStatus || registered);
    renderProfileActionsVisibility();
    if (!state.passkeyStatus || registered) return;
    button.querySelector("strong").textContent = "Register a passkey";
    $("#passkeyStatusText").textContent = "Add a secure way to sign in";
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
        <div class="god-mode-title"><span><img src="../assets/app/crown.png" alt=""></span><div><strong>${active ? "God Mode Active" : "God Mode"}</strong><small>${active ? "Everything unlocked" : `$${weeklyPrice.toFixed(2)} / week`}</small></div>${active ? `<span class="god-mode-active">✨ Active</span>` : ""}</div>
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
    $("#godModePitchBody").innerHTML = `<button class="god-mode-sheet-handle" type="button" data-close-dialog aria-label="Close God Mode"></button>
        <section class="god-mode-pitch-hero">
            <h2>See who likes you with</h2>
            <div class="god-mode-pitch-brand"><img src="../assets/app/crown.png" alt=""><strong>God Mode</strong></div>
        </section>
        <div class="god-mode-benefit-carousel" aria-label="God Mode benefits">
            <article class="god-mode-benefit-card">
                <div class="god-mode-reveal-preview" aria-hidden="true">
                    <img class="god-mode-letter" src="../assets/app/letter_aligned.png" alt="">
                    <span class="god-mode-lens"><img src="../assets/app/magnifying_glass.png" alt=""><span class="god-mode-reveal-names">${revealNames.map((name) => `<strong>${escapeHTML(name).replace(" ", "<br>")}</strong>`).join("")}</span></span>
                </div>
                <h3>${weeklyReveals} Reveals / Week</h3><p>See the full names on ${weeklyReveals} polls every week.</p>
            </article>
            <article class="god-mode-benefit-card"><img class="god-mode-benefit-image scroll" src="../assets/app/scroll.png" alt=""><h3>First-Letter Hints</h3><p>Get the first letter on every personal poll automatically.</p></article>
            <article class="god-mode-benefit-card"><img class="god-mode-benefit-image aura" src="../assets/app/aura.png" alt=""><h3>${multiplier}× Aura Boost</h3><p>Earn ${multiplier === 2 ? "double" : `${multiplier}×`} aura for every answer you give in Play.</p></article>
            <article class="god-mode-benefit-card"><img class="god-mode-benefit-image rocket" src="../assets/app/rocket.png" alt=""><h3>Get boosted</h3><p>Get boosted to the top of your classmates' polls to see what they think of you.</p></article>
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
    const globalBoost = activeBoost("global");
    const aura = Math.max(0, Number(state.profile.aura_points || 0));
    const purchaseButton = (kind, cost, label, active = false) => {
        const insufficient = !active && aura < cost;
        const ariaLabel = active
            ? label
            : insufficient
            ? `${label}. Need ${(cost - aura).toLocaleString()} more aura`
            : label;
        return `<button class="aura-price-button ${insufficient ? "insufficient" : ""}" type="button" data-buy-aura="${kind}" aria-label="${escapeHTML(ariaLabel)}" ${active || insufficient ? "disabled" : ""}>${active ? "Active" : `<span>${cost.toLocaleString()}</span><img src="../assets/app/aura.png" alt="aura">`}</button>`;
    };
    container.innerHTML = `<article class="purchase-row"><span><strong>Get boosted</strong><small>Jump to the top of classmates' polls for 5 days or until you get voted 10 times.</small></span>${purchaseButton("global", globalCost, globalBoost ? "Global boost active" : `Get boosted for ${globalCost.toLocaleString()} aura`, Boolean(globalBoost))}</article>
        <article class="purchase-row"><span><strong>See what your crush thinks about you</strong><small>Your crush stays top secret. You appear more often in their polls.</small></span>${purchaseButton("targeted", targetedCost, `Choose a crush for ${targetedCost.toLocaleString()} aura`)}</article>
        <article class="purchase-row"><span><strong>Submit a school question</strong><small>Anonymously create a poll that your school will answer.</small></span>${purchaseButton("question", questionCost, `Submit a school question for ${questionCost.toLocaleString()} aura`)}</article>`;
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
        ${imageURL ? `<div class="profile-poll-art"><img src="${escapeHTML(imageURL)}" alt=""></div>` : ""}
        <h3>${escapeHTML(question.question_text)}</h3>
        <span class="poll-summary-votes"><span aria-hidden="true">♥</span><strong>${Number(question.vote_count || 0).toLocaleString()} votes</strong></span>
        <button class="primary-button" type="button" data-share-top-poll>Share poll</button>
    </article>`;
    $("#pollSummaryDialog").showModal();
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
    const cost = kind === "reveal"
        ? Math.max(0, Number(state.config?.full_reveal_aura_cost ?? DEFAULT_FULL_REVEAL_AURA_COST))
        : auraCost(kind);
    const aura = Math.max(0, Number(state.profile?.aura_points || 0));
    if (aura < cost) return showToast(`You need ${cost.toLocaleString()} aura.`);
    const details = kind === "global"
        ? ["Get Boosted", "Jump to the top of your classmates' polls for 5 days or until you get voted 10 times."]
        : kind === "reveal"
            ? ["Reveal who sent this?", `Spend ${cost.toLocaleString()} aura to see who voted for you.`]
            : ["Boost toward your crush", `Show up more often in ${displayName(target)}'s polls. They will not be told.`];
    state.pendingAuraPurchase = { kind, target };
    const spendIcon = $("#auraSpendIcon");
    const targetImage = kind === "targeted" ? api.assetURL(target?.profile_picture_url_medium || target?.profile_picture_url) : null;
    spendIcon.src = targetImage || (kind === "reveal" ? "../assets/app/magnifying_glass.png" : "../assets/app/rocket.png");
    spendIcon.alt = kind === "global" ? "Get Boosted" : kind === "reveal" ? "Reveal sender" : displayName(target);
    spendIcon.closest(".aura-spend-icon").classList.toggle("profile", Boolean(targetImage));
    $("#auraSpendTitle").textContent = details[0];
    $("#auraSpendMessage").textContent = details[1];
    $("#auraSpendCost").textContent = `${cost.toLocaleString()} aura`;
    $("#auraSpendRemaining").textContent = `${Math.max(0, aura - cost).toLocaleString()} aura`;
    const confirmButton = $("#confirmAuraSpend");
    confirmButton.dataset.label = `Spend ${cost.toLocaleString()} aura`;
    confirmButton.innerHTML = `<span>Spend ${cost.toLocaleString()} aura</span><img src="../assets/app/aura.png" alt="">`;
    $("#auraSpendStatus").textContent = "";
    $("#auraSpendDialog").showModal();
}

async function confirmAuraSpend() {
    const purchase = state.pendingAuraPurchase;
    if (!purchase) return;
    const button = $("#confirmAuraSpend");
    setButtonLoading(button, true, purchase.kind === "reveal" ? "Revealing..." : "Purchasing...");
    $("#auraSpendStatus").textContent = "";
    try {
        if (purchase.kind === "reveal") {
            const result = await api.revealSender(api.user.id, purchase.target.question_answer_id);
            applyFeedSenderReveal(purchase.target, result);
        } else if (purchase.kind === "global") await api.purchaseGlobalBoost(api.user.id);
        else await api.purchaseTargetedBoost(api.user.id, purchase.target.user_id);
        clearOptimisticEarnedProfile();
        $("#auraSpendDialog").close();
        state.pendingAuraPurchase = null;
        if (purchase.kind !== "reveal") await refreshProfile();
        showToast(purchase.kind === "reveal"
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
            const cost = state.pendingAuraPurchase.kind === "reveal"
                ? Math.max(0, Number(state.config?.full_reveal_aura_cost ?? DEFAULT_FULL_REVEAL_AURA_COST))
                : auraCost(state.pendingAuraPurchase.kind);
            button.innerHTML = `<span>Spend ${cost.toLocaleString()} aura</span><img src="../assets/app/aura.png" alt="">`;
        }
    }
}

function renderTargetedBoostList() {
    const query = $("#targetedBoostSearch").value.trim().toLowerCase();
    const classmates = (state.targetedBoostClassmates || []).filter((classmate) => !query || `${displayName(classmate)} ${classmate.username || ""}`.toLowerCase().includes(query));
    const cost = auraCost("targeted");
    $("#targetedBoostList").innerHTML = classmates.length ? classmates.map((classmate) => {
        const active = activeBoost("targeted", classmate.user_id);
        const grade = formatGrade(classmate.grade || "");
        return `<button class="nomination-row" type="button" data-targeted-boost="${escapeHTML(classmate.user_id)}" ${active ? "disabled" : ""}>${avatarMarkup(classmate, "choice-avatar")}<span class="nomination-row-copy"><strong>${escapeHTML(displayName(classmate))}</strong>${grade ? `<small>${escapeHTML(grade)}</small>` : ""}</span><span class="nomination-cost ${active ? "active" : ""}">${active ? "Active" : `<span>${cost.toLocaleString()}</span><img src="../assets/app/aura.png" alt="aura">`}</span></button>`;
    }).join("") : `<div class="profile-poll-empty">No matching classmates.</div>`;
}

async function openTargetedBoostPicker() {
    $("#targetedBoostSearch").value = "";
    $("#targetedBoostStatus").textContent = "Loading classmates...";
    $("#targetedBoostDialog").showModal();
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
    const classmates = (state.classmateDirectory || []).filter((classmate) => {
        const searchable = `${displayName(classmate)} ${classmate.username || ""} ${classmate.grade || ""}`.toLowerCase();
        return !query || searchable.includes(query);
    });
    $("#classmateDirectoryList").innerHTML = classmates.length
        ? classmates.map((classmate) => `<button type="button" data-directory-classmate="${escapeHTML(classmate.user_id)}">${avatarMarkup(classmate, "row-avatar")}<span><strong>${escapeHTML(displayName(classmate))}</strong><small>${escapeHTML([classmate.username ? `@${classmate.username}` : "", formatGrade(classmate.grade || "")].filter(Boolean).join(" · ") || "Classmate")}</small></span><span aria-hidden="true">›</span></button>`).join("")
        : `<div class="profile-poll-empty">${query ? "No matching classmates." : "No classmates are visible yet."}</div>`;
}

async function openClassmateDirectory() {
    const dialog = $("#classmateDirectoryDialog");
    $("#classmateDirectorySearch").value = "";
    $("#classmateDirectoryStatus").textContent = state.classmateDirectory
        ? `${state.classmateDirectory.length} ${state.classmateDirectory.length === 1 ? "classmate" : "classmates"}`
        : "Loading classmates...";
    renderClassmateDirectory();
    dialog.showModal();
    if (state.classmateDirectory) return;
    try {
        state.classmateDirectory = await api.getClassmates(api.user.id, "", 500);
        $("#classmateDirectoryStatus").textContent = `${state.classmateDirectory.length} ${state.classmateDirectory.length === 1 ? "classmate" : "classmates"}`;
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
        <span class="full-profile-avatar">${imageURL ? `<img src="${escapeHTML(imageURL)}" alt="${escapeHTML(displayName(profile))}">` : `<span>${escapeHTML(initials(profile))}</span>`}</span>
        <h3>${escapeHTML(displayName(profile))}</h3>
        <div class="profile-handle">${profile.username ? `@${escapeHTML(profile.username)}` : "Valid classmate"}</div>
        ${profile.bio ? `<p class="profile-bio">${escapeHTML(profile.bio)}</p>` : ""}
        <div class="profile-school-meta"><span>🏫 ${escapeHTML(profile.school_name || state.profile?.school_name || "Your school")}</span>${profile.grade ? `<span>🎓 ${escapeHTML(formatGrade(profile.grade))}</span>` : ""}</div>
        <div class="profile-stats-grid single"><div class="profile-stat-card"><strong><span class="heart">♥</span>${Number(profile.vote_count || 0).toLocaleString()}</strong><span>Votes Received</span></div></div>
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
    state.selectedClassmateTopQuestionsWeekly = null;
    state.selectedClassmateTopQuestionsAllTime = null;
    renderClassmateProfile();
    $("#classmateProfileStatus").textContent = "Loading profile...";
    openDetailScreen($("#classmateProfileDialog"));
    const requests = await Promise.allSettled([
        api.getProfile(userId),
        api.getTopQuestions(userId, "weekly", 10),
        api.getTopQuestions(userId, "all_time", 3),
    ]);
    if (generation !== state.classmateProfileGeneration) return;
    if (requests[0].status === "fulfilled") state.selectedClassmateProfile = requests[0].value;
    if (requests[1].status === "fulfilled") state.selectedClassmateTopQuestionsWeekly = requests[1].value;
    else state.selectedClassmateTopQuestionsWeekly = [];
    if (requests[2].status === "fulfilled") state.selectedClassmateTopQuestionsAllTime = requests[2].value;
    else state.selectedClassmateTopQuestionsAllTime = [];
    const firstError = requests.find((result) => result.status === "rejected");
    $("#classmateProfileStatus").textContent = requests[0].status === "rejected"
        ? (requests[0].reason?.message || "Could not load this profile.")
        : (firstError ? "Some profile details could not be loaded." : "");
    renderClassmateProfile();
}

function backToClassmates() {
    closeDetailScreen($("#classmateProfileDialog"));
    if (state.classmateProfileReturnToDirectory) {
        renderClassmateDirectory();
        $("#classmateDirectoryDialog").showModal();
    }
    state.classmateProfileReturnToDirectory = false;
}

async function loadProfilePanel() {
    renderProfilePanel();
    $("#profileStatus").textContent = "Loading your profile...";
    const requests = [
        { key: "profile", promise: api.getProfile(api.user.id) },
        { key: "currentUser", promise: api.getUser(api.user.id) },
    ];
    if (!state.topQuestionsWeekly) requests.push({ key: "weekly", promise: api.getTopQuestions(api.user.id, "weekly", 10) });
    if (!state.topQuestionsAllTime) requests.push({ key: "allTime", promise: api.getTopQuestions(api.user.id, "all_time", 3) });
    if (!state.askLink) requests.push({ key: "askLink", promise: api.getAskLink(api.user.id) });
    if (!state.askAccess) requests.push({ key: "askAccess", promise: api.getAnonymousAskAccess(api.user.id) });
    if (!state.passkeyStatus) requests.push({ key: "passkeyStatus", promise: api.getPasskeyStatus() });
    if (!state.classmateDirectory || state.activeClassmatesThisWeek === null) requests.push({ key: "classmates", promise: api.getClassmatesWithMetadata(api.user.id, "", 500) });
    const results = await Promise.allSettled(requests.map((request) => request.promise));
    let profileError = "";
    requests.forEach((request, index) => {
        const result = results[index];
        if (result.status === "fulfilled") {
            if (request.key === "profile") state.profile = result.value;
            if (request.key === "currentUser") api.user = { ...api.user, ...result.value };
            if (request.key === "weekly") state.topQuestionsWeekly = result.value;
            if (request.key === "allTime") state.topQuestionsAllTime = result.value;
            if (request.key === "askLink") state.askLink = result.value;
            if (request.key === "askAccess") state.askAccess = result.value;
            if (request.key === "passkeyStatus") state.passkeyStatus = result.value;
            if (request.key === "classmates") {
                state.classmateDirectory = result.value.classmates;
                state.classmates = result.value.classmates;
                state.activeClassmatesThisWeek = result.value.activeThisWeekCount;
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

async function addBackupPasskey() {
    const button = $("#addPasskeyButton");
    button.disabled = true;
    $("#passkeyStatusText").textContent = "Confirm passkey setup on your device...";
    try {
        if (demoMode) await api.addDemoPasskey();
        else await createAdditionalPasskey(api, api.user.id);
        state.passkeyStatus = await api.getPasskeyStatus();
        renderPasskeyStatus();
        showToast("Backup passkey added 🔑");
    } catch (error) {
        showToast(error.message || "Could not add that passkey.");
    } finally {
        button.disabled = false;
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
        $("#authStatus").textContent = error.message || "Passkey sign-in failed.";
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
    $("#signupDialog").style.setProperty("--signup-layout-height", `${window.innerHeight}px`);
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
            <span class="signup-school-logo">${logoURL ? `<img src="${escapeHTML(logoURL)}" alt="">` : escapeHTML(initials)}</span>
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

function feedAvatar(item) {
    if (state.feedType === "personal") return avatarMarkup(state.profile);
    const votedFor = { first_name: item.voted_for_name || item.contact_name || "Student", profile_picture_url: item.voted_for_profile_picture_url };
    return avatarMarkup(votedFor);
}

function anonymousInboxRows() {
    if (state.feedType !== "personal" || !state.anonymousInbox || state.feedSearch.trim()) return [];
    const questions = state.anonymousInbox.questions || [];
    const answers = state.anonymousInbox.answers || [];
    const answerRows = answers.map((answer) => ({ timestamp: answer.answered_at, html: `<button class="anonymous-reply-row" type="button" data-anonymous-answer="${escapeHTML(answer.id)}">
        ${avatarMarkup({ first_name: answer.recipient_display_name, profile_picture_url: answer.recipient_profile_picture_url }, "anonymous-row-icon reply")}
        <span class="anonymous-row-copy"><strong>${escapeHTML(answer.recipient_display_name)} replied to you</strong><span class="anonymous-row-message">${escapeHTML(answer.answer_text)}</span><span class="anonymous-row-meta"><span>Your message: ${escapeHTML(answer.question_body)}</span><time>${escapeHTML(relativeTime(answer.answered_at))}</time></span></span>
        <span class="anonymous-row-state" aria-hidden="true">›</span>
    </button>` }));
    const questionRows = questions.map((question) => ({ timestamp: question.created_at, html: `<button class="anonymous-question-row ${question.opened_at ? "" : "unread"} ${question.status === "answered" ? "answered" : ""}" type="button" data-anonymous-question="${escapeHTML(question.id)}">
        <span class="anonymous-row-icon" aria-hidden="true">?</span>
        <span class="anonymous-row-copy"><span class="anonymous-row-title"><strong>${escapeHTML(question.provenance_label)}</strong>${question.opened_at ? "" : `<span class="anonymous-new-pill">New</span>`}</span><span class="anonymous-row-message">${escapeHTML(question.body)}</span><span class="anonymous-row-meta"><span>${escapeHTML(question.source_platform ? `From ${question.source_platform[0].toUpperCase()}${question.source_platform.slice(1)}` : "Anonymous")}</span><time>${escapeHTML(relativeTime(question.created_at))}</time></span></span>
        <span class="anonymous-row-state" aria-hidden="true">›</span>
    </button>` }));
    return [...answerRows, ...questionRows];
}

function renderFeed() {
    const list = $("#feedList");
    const query = state.feedSearch.trim().toLowerCase();
    renderFeedClassmateResults();
    const visible = query ? state.feedItems.filter((item) => [item.question_text, item.voted_for_name, item.contact_name, item.voter_name].some((value) => String(value || "").toLowerCase().includes(query))) : state.feedItems;
    const anonymousRows = anonymousInboxRows();
    if (!visible.length && !anonymousRows.length) {
        const text = state.feedSearch ? "No matching votes." : state.myVotesOnly ? "You haven't voted yet. Answer questions in Play to see your votes here." : "No votes here yet. Play a few rounds and check back soon.";
        list.innerHTML = `<div class="empty-card">${escapeHTML(text)}</div>`;
        return;
    }
    const voteRows = visible.map((item) => {
        const isPersonal = state.feedType === "personal";
        const title = isPersonal ? `${item.is_nomination ? "👑 " : ""}<strong>You</strong> got ${item.is_nomination ? "nominated" : "voted"}` : `<strong>${escapeHTML(item.voted_for_name || item.contact_name || "A classmate")}</strong> got voted`;
        const detail = formatVoterHint(item);
        return { timestamp: item.timestamp, html: `<article class="feed-card" data-answer-id="${item.question_answer_id}" data-feed-detail="${item.question_answer_id}" role="button" tabindex="0" aria-label="Open poll details: ${escapeHTML(item.question_text)}">
            ${feedAvatar(item)}
            <div class="feed-body">
                <div class="feed-meta"><span>${title}</span><time>${escapeHTML(relativeTime(item.timestamp))}</time></div>
                <div class="feed-question">${escapeHTML(item.question_text)}</div>
                ${detail ? `<div class="feed-answer">${escapeHTML(detail)}</div>` : ""}
            </div>
            <button class="upvote-button ${item.user_has_upvoted ? "active" : ""}" type="button" data-upvote="${item.question_answer_id}" aria-label="Upvote">${item.user_has_upvoted ? "♥" : "♡"}<span>${item.upvote_count || 0}</span></button>
        </article>` };
    });
    list.innerHTML = [...anonymousRows, ...voteRows]
        .sort((left, right) => (Date.parse(right.timestamp) || 0) - (Date.parse(left.timestamp) || 0))
        .map((row) => row.html)
        .join("");
}

function renderFeedClassmateResults() {
    const container = $("#feedClassmateResults");
    const query = state.feedSearch.trim();
    if (query.length < 2 || !state.feedClassmateResults.length) {
        container.classList.add("hidden");
        container.innerHTML = "";
        return;
    }
    container.innerHTML = `<div class="feed-search-section-heading"><span>CLASSMATES</span><small>${state.feedClassmateResults.length}</small></div><div class="feed-classmate-list">${state.feedClassmateResults.slice(0, 10).map((classmate) => `<button type="button" data-feed-classmate="${escapeHTML(classmate.user_id)}">${avatarMarkup(classmate, "row-avatar")}<span><strong>${escapeHTML(displayName(classmate))}</strong><small>${escapeHTML(formatGrade(classmate.grade || "Classmate"))}</small></span><span aria-hidden="true">›</span></button>`).join("")}</div>`;
    container.classList.remove("hidden");
}

function selectFeedClassmate(classmateId) {
    const classmate = state.feedClassmateResults.find((item) => String(item.user_id) === String(classmateId));
    if (!classmate) return;
    const name = displayName(classmate);
    state.feedSearch = name;
    $("#feedSearch").value = name;
    state.feedType = "school";
    state.myVotesOnly = false;
    $$("[data-feed]").forEach((button) => button.classList.toggle("active", button.dataset.feed === "school"));
    $("#myVotesFilter").classList.remove("hidden");
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

function renderFeedDetail() {
    const item = selectedFeedItem();
    if (!item) return;
    const selectedName = item.selected_contact_name
        || item.voted_for_name
        || item.contact_name
        || (item.item_type === "received_vote" ? displayName(state.profile) : "A classmate");
    const options = Array.isArray(item.presented_options) ? item.presented_options : [];
    const artworkURL = api.assetURL(item.image_url);
    const revealed = item.voter_name ? `<div class="revealed-sender-card">${avatarMarkup({ first_name: item.voter_name, profile_picture_url: item.voter_profile_picture_url }, "row-avatar")}<span><small>Sent by</small><strong>${escapeHTML(item.voter_name)}</strong></span></div>` : "";
    $("#feedDetailDialog .detail-screen-header > strong").textContent = formatVoterStatement(item);
    $("#feedDetailBody").innerHTML = `<article class="feed-detail-card">
        <h3>${escapeHTML(item.question_text)}</h3>
        <div class="feed-detail-art">${artworkURL ? `<img src="${escapeHTML(artworkURL)}" alt="">` : `<div class="artwork-placeholder"><img src="../assets/app/pencil-clipboard.png" alt=""><span>Image unavailable</span></div>`}</div>
        ${options.length ? `<div class="feed-detail-options">${options.map((option) => {
            const name = option.name || option.contact_name || "A classmate";
            const selected = name === selectedName;
            return `<div class="feed-detail-option ${selected ? "selected" : ""}"><strong>${escapeHTML(name)}</strong>${selected ? `<span class="feed-detail-selection-indicator" aria-label="Picked">👆</span>` : ""}</div>`;
        }).join("")}</div>` : `<div class="feed-detail-legacy-selection"><strong>Selected: ${escapeHTML(selectedName)}</strong><small>Options not available for this older vote</small></div>`}
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

function loadShareArtwork(url) {
    if (!url) return Promise.resolve(null);
    return new Promise((resolve) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = url;
    });
}

async function loadPollShareArtwork(item) {
    const displayedArtwork = $("#feedDetailBody .feed-detail-art img")?.currentSrc;
    const fallbackArtwork = new URL("../assets/app/pencil-clipboard.png", import.meta.url).href;
    const candidates = [api.assetURL(item.image_url), displayedArtwork, fallbackArtwork]
        .filter((url, index, urls) => url && urls.indexOf(url) === index);
    for (const url of candidates) {
        const artwork = await loadShareArtwork(url);
        if (artwork) return artwork;
    }
    return null;
}

function canvasBlob(canvas, type = "image/png", quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not render image.")), type, quality);
    });
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
    const options = Array.isArray(item.presented_options) ? item.presented_options.slice(0, 4) : [];
    const artwork = await loadPollShareArtwork(item);

    context.fillStyle = "#ccf7f4";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#000000";
    const voterStatement = formatVoterStatement(item);
    const showsVoterStatement = voterStatement && voterStatement !== "Poll";
    const gridRows = options.length ? Math.ceil(options.length / 2) : 2;
    const gridHeight = options.length ? gridRows * 200 + Math.max(0, gridRows - 1) * 20 : 400;
    const brandingHeight = 62;
    const brandingGap = 63;

    context.font = '44px "Jua", "Apple Color Emoji", sans-serif';
    let contentBottom = showsVoterStatement
        ? drawCenteredCanvasText(context, voterStatement, centerX, 60, 820, 52, 2)
        : 0;
    context.font = '56px "Jua", "Apple Color Emoji", sans-serif';
    const questionTop = showsVoterStatement ? contentBottom + 40 : 60;
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
    if (options.length) {
        const gap = 20;
        const cardWidth = 400;
        const cardHeight = 200;
        options.forEach((option, index) => {
            const name = option.name || option.contact_name || "A classmate";
            const selected = name === selectedName;
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
    } else {
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
        drawCenteredCanvasText(context, selectedName, centerX, y + 112, width - 70, 72, 2);
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
        field.style.position = "fixed";
        field.style.opacity = "0";
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
    const message = action === "block"
        ? "Block this question submitter? Their submitted questions will be hidden from you."
        : "Report this question to Valid's moderation team?";
    if (!confirm(message)) return;
    try {
        if (action === "block") await api.blockQuestionSubmitter(api.user.id, item.question_id);
        else await api.reportQuestion(api.user.id, item.question_id);
        state.feedItems = state.feedItems.filter((candidate) => candidate.question_id !== item.question_id);
        state.selectedFeedItemId = null;
        closeDetailScreen($("#feedDetailDialog"));
        renderFeed();
        showToast(action === "block" ? "Submitter blocked" : "Question reported");
    } catch (error) {
        $("#feedDetailStatus").textContent = error.message || `Could not ${action} this question.`;
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
        <img class="feed-gate-lock" src="../assets/app/lock.png" alt="" aria-hidden="true">
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

function selectedAnonymousQuestion() {
    return state.anonymousInbox?.questions?.find((question) => String(question.id) === String(state.selectedAnonymousQuestionId));
}

function renderAnonymousQuestionDialog() {
    const question = selectedAnonymousQuestion();
    if (!question) return;
    $("#anonymousQuestionBody").innerHTML = `<blockquote>${escapeHTML(question.body)}</blockquote><div><strong>${escapeHTML(question.provenance_label)}</strong><span>${escapeHTML(question.provenance_detail)}</span></div>`;
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
    $("#anonymousAnswerShare").classList.toggle("hidden", !answered);
    $("#anonymousAnswerStatus").textContent = "";
    $("#anonymousAnswerStatus").classList.remove("share-progress");
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
        button.disabled = false;
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
        ? "Valid will record and remove this question and block this account from sending you future Ask Me questions. Their identity stays hidden."
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
    const rawSearch = state.feedSearch.trim();
    const search = rawSearch.length >= 2 ? rawSearch : "";
    if (reset) {
        state.feedItems = [];
        state.feedOffset = 0;
        state.feedCursor = null;
        renderFeed();
        if (feedType === "personal") loadAnonymousInbox();
        else {
            state.anonymousInboxGeneration += 1;
            renderAnonymousInbox();
        }
    }
    const status = $("#feedStatus");
    const loadMore = $("#loadMoreFeed");
    status.textContent = "Loading votes...";
    loadMore.classList.add("hidden");
    try {
        let items;
        if (feedType === "personal") items = await api.getPersonalFeed(api.user.id, state.feedOffset, search);
        else if (myVotesOnly) items = await api.getUserVotes(api.user.id, state.feedCursor);
        else items = await api.getSchoolFeed(api.user.id, state.feedCursor, search);
        const currentRawSearch = state.feedSearch.trim();
        const currentSearch = currentRawSearch.length >= 2 ? currentRawSearch : "";
        if (generation !== state.feedGeneration || feedType !== state.feedType || myVotesOnly !== state.myVotesOnly || search !== currentSearch) return;
        state.feedItems.push(...items);
        if (feedType === "personal") state.feedOffset += items.length;
        else if (items.length) {
            const last = items.at(-1);
            state.feedCursor = { timestamp: last.timestamp, id: last.question_answer_id };
        }
        status.textContent = "";
        state.feedAppliedSearch = search;
        renderFeed();
        loadMore.classList.toggle("hidden", items.length < 20);
    } catch (error) {
        if (generation !== state.feedGeneration) return;
        status.textContent = error.message || "Could not load the feed.";
    }
}

function softHaptic() {
    if (navigator.vibrate) navigator.vibrate(8);
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
        flight.innerHTML = `<img src="../assets/app/aura.png" alt=""><strong>+${Number(amount).toLocaleString()}</strong>`;
        flight.style.left = `${source.left + source.width / 2}px`;
        flight.style.top = `${source.top + source.height / 2}px`;
        flight.style.setProperty("--aura-flight-x", `${target.left + target.width / 2 - source.left - source.width / 2}px`);
        flight.style.setProperty("--aura-flight-y", `${target.top + target.height / 2 - source.top - source.height / 2}px`);
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
        <img class="lock-art" src="../assets/app/lock.png" alt="">
        <p id="playLockMessage">${until ? "Checking unlock time..." : "New polls drop soon."}</p>
        ${renderInviteUnlock()}
        <button class="question-secondary-action" type="button" data-open-question><img src="../assets/app/pencil-clipboard.png" alt="">Submit a school question</button>
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
        <span class="eyebrow">POLL SET COMPLETE</span>
        <h3>Congrats!</h3>
        <img src="../assets/app/aura.png" alt="">
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
        card.innerHTML = `<div class="empty-card locked-card"><img class="empty-state-art" src="../assets/app/lock.png" alt=""><strong>Add more classmates to play Valid.</strong><span>You need at least four classmates before a poll can start.</span><button class="primary-button" type="button" data-find-classmates>Find classmates</button><button class="secondary-button" type="button" data-invite-unlock>Share an invite</button></div>`;
        return;
    }
    const artworkURL = api.assetURL(question.image_url);
    const attribution = question.is_user_submitted ? `<div class="question-attribution">${question.is_anonymous ? avatarMarkup({ first_name: "Anonymous", profile_picture_url: "../assets/app/anonymous.png" }, "attribution-avatar") : avatarMarkup({ first_name: question.submitted_by_name || "A classmate", profile_picture_url: question.submitted_by_avatar_url }, "attribution-avatar")}<span><small>Question submitted by</small><strong>${escapeHTML(question.is_anonymous ? "Someone at your school" : question.submitted_by_name || "A classmate")}</strong></span><div class="detail-overflow play-overflow"><button class="detail-overflow-button play-overflow-button" type="button" data-toggle-play-menu aria-label="More question actions" aria-expanded="false">•••</button><div class="detail-overflow-menu hidden" role="menu" aria-label="Question actions"><button type="button" role="menuitem" data-play-question-action="report">Report question</button>${question.is_anonymous ? "" : `<button type="button" role="menuitem" data-play-question-action="block">Block submitter</button>`}</div></div></div>` : "";
    const remainingSkips = Math.max(0, Number(state.config?.max_skips_per_set ?? 3) - state.skipsUsedInSet);
    card.innerHTML = `<article class="play-card">
        <div class="play-question-copy"><h3>${escapeHTML(question.question_text)}</h3>${attribution}</div>
        <div class="question-artwork">${artworkURL ? `<img src="${escapeHTML(artworkURL)}" alt="">` : `<div class="artwork-placeholder"><img src="../assets/app/pencil-clipboard.png" alt=""><span>Question artwork</span></div>`}</div>
        <div class="choice-grid">${choices.map(choiceMarkup).join("")}</div>
        <div class="play-actions">
            <button class="play-action-button" data-shuffle type="button"><span aria-hidden="true">↻</span> Shuffle</button>
            <button class="play-action-button nominate" data-nominate type="button"><img src="../assets/app/crown.png" alt="">Nominate</button>
            <button class="play-action-button" data-skip="${question.id}" type="button" ${remainingSkips < 1 ? "disabled" : ""}>Skip (${remainingSkips})</button>
        </div>
    </article>`;
}

async function loadPlay() {
    if (state.questions.length || state.playLocked) return renderPlay();
    $("#playStatus").textContent = "Finding questions and classmates...";
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
        <span class="nomination-cost"><img src="../assets/app/aura.png" alt="">${cost}</span>
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
        ${link.is_active && !restricted ? `<button class="ask-url" type="button" data-copy-link aria-label="Copy ask link"><span>🔗</span><span>${escapeHTML(link.share_url.replace(/^https:\/\//, ""))}</span><strong>Copy</strong></button>` : ""}
        ${link.is_active && !restricted ? `<div class="share-platform-row"><span class="share-platform-label">Open on:</span><button class="share-platform-button snapchat" type="button" data-share-link="snapchat" aria-label="Share ask link to Snapchat">${shareIconMarkup("snapchat")}</button><button class="share-platform-button instagram" type="button" data-share-link="instagram" aria-label="Share ask link to Instagram">${shareIconMarkup("instagram")}</button></div>` : ""}
        ${!link.is_active || restricted ? `<p class="ask-link-paused">${escapeHTML(inactiveCopy)}</p>` : ""}
        <div class="ask-link-controls"><button class="text-button" type="button" data-rotate-link>Reset link</button></div>
        ${state.askSafetyNoticeHistory.length ? `<button class="text-button ask-safety-history-button" type="button" data-ask-safety-history>🛡️ Ask Me safety notices</button>` : ""}
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
    $("#profileEditHint").innerHTML = informationLocked
        ? `<strong>Profile changes are temporarily locked</strong><span>Username, name, school, and grade will be available again ${escapeHTML(relativeTime(state.profile.next_information_change_at))}.</span>`
        : "<strong>Profile changes are available every 14 days</strong><span>Change any combination below. Nothing is saved until you review and confirm everything.</span>";
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
            <span class="signup-school-logo">${logoURL ? `<img src="${escapeHTML(logoURL)}" alt="">` : escapeHTML(initials)}</span>
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
        if (flags.school) await loadProfilePanel();
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
    state.questionArtworkProcessing = false;
    $("#questionImagePreview").innerHTML = `<span class="question-image-placeholder"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"></rect><circle cx="9" cy="10" r="2"></circle><path d="m5.5 17 4.5-4 3 2.5 2.5-2 3 3.5"></path></svg><strong>Tap to add an image</strong></span>`;
}

function readFileDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(reader.result), { once: true });
        reader.addEventListener("error", () => reject(reader.error || new Error("Could not preview image.")), { once: true });
        reader.readAsDataURL(file);
    });
}

function loadLocalImage(file) {
    return new Promise((resolve, reject) => {
        const objectURL = URL.createObjectURL(file);
        const image = new Image();
        image.addEventListener("load", () => resolve({ image, objectURL }), { once: true });
        image.addEventListener("error", () => {
            URL.revokeObjectURL(objectURL);
            reject(new Error("decode-failed"));
        }, { once: true });
        image.src = objectURL;
    });
}

async function centerCropQuestionArtwork(file) {
    let image;
    let sourceWidth;
    let sourceHeight;
    let releaseImage = () => {};
    try {
        const loaded = await loadLocalImage(file);
        image = loaded.image;
        sourceWidth = image.naturalWidth;
        sourceHeight = image.naturalHeight;
        releaseImage = () => URL.revokeObjectURL(loaded.objectURL);
    } catch (imageError) {
        if (typeof createImageBitmap !== "function") throw imageError;
        image = await createImageBitmap(file, { imageOrientation: "from-image" });
        sourceWidth = image.width;
        sourceHeight = image.height;
        releaseImage = () => image.close?.();
    }
    try {
        const cropSize = Math.min(sourceWidth, sourceHeight);
        if (!cropSize) throw new Error("decode-failed");
        const outputSize = Math.min(1024, cropSize);
        const canvas = document.createElement("canvas");
        canvas.width = outputSize;
        canvas.height = outputSize;
        const context = canvas.getContext("2d");
        context.drawImage(
            image,
            Math.floor((sourceWidth - cropSize) / 2),
            Math.floor((sourceHeight - cropSize) / 2),
            cropSize,
            cropSize,
            0,
            0,
            outputSize,
            outputSize,
        );
        const blob = await canvasBlob(canvas, "image/jpeg", 0.9);
        const baseName = String(file.name || "question-artwork").replace(/\.[^.]+$/, "");
        return {
            file: new File([blob], `${baseName}-square.jpg`, { type: "image/jpeg", lastModified: Date.now() }),
            sourceWidth,
            sourceHeight,
            outputSize,
        };
    } finally {
        releaseImage();
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
    state.questionArtworkProcessing = true;
    state.questionArtworkFile = null;
    $("#questionStatus").textContent = "";
    updateQuestionSubmissionUI();
    try {
        const cropped = await centerCropQuestionArtwork(file);
        if (state.questionArtworkPreviewURL?.startsWith("blob:")) URL.revokeObjectURL(state.questionArtworkPreviewURL);
        state.questionArtworkFile = cropped.file;
        state.questionArtworkPreviewURL = await readFileDataURL(cropped.file);
        $("#questionImagePreview").innerHTML = `<img src="${escapeHTML(state.questionArtworkPreviewURL)}" alt="Square crop preview">`;
    } catch (_) {
        input.value = "";
        resetQuestionArtworkPreview();
        $("#questionStatus").textContent = "That photo format could not be decoded by this browser. Choose a JPEG or PNG, or export the photo as Most Compatible.";
    } finally {
        state.questionArtworkProcessing = false;
        updateQuestionSubmissionUI();
    }
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

function openQuestionDialog() {
    $("#questionStatus").textContent = "";
    const maxLength = Math.max(3, Number(state.config?.max_custom_question_length ?? 280));
    $("#questionText").maxLength = maxLength;
    if (!state.questionArtworkFile) resetQuestionArtworkPreview();
    updateQuestionSubmissionUI();
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
    reader.addEventListener("load", () => { preview.innerHTML = `<img src="${escapeHTML(reader.result)}" alt="">`; }, { once: true });
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
        }
        $("#classmatesStatus").textContent = `${acceptedCount} selected ${acceptedCount === 1 ? "contact" : "contacts"} synced. No messages were sent.`;
        await new Promise((resolve) => setTimeout(resolve, demoMode ? 0 : 900));
        state.classmates = await api.getClassmates(api.user.id).catch(() => state.classmates);
        state.choicesByQuestion.clear();
        if (state.contactOnboarding || state.classmates.length >= 4) {
            $("#classmatesDialog").close();
            showToast(state.contactOnboarding ? "Friends added ✨" : "Classmates are ready for Play ✨");
            if (state.activePanel === "play") renderPlay();
        }
    } catch (error) {
        if (error.name !== "AbortError") $("#classmatesStatus").textContent = error.message || "Could not sync those contacts.";
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
        const result = await api.requestAccountDeletion(api.user.id);
        const scheduled = new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" }).format(new Date(result.scheduled_for));
        $("#deleteAccountDialog").close();
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
    await detachWebPushSubscription().catch(() => null);
    await api.logout().catch(() => null);
    api.clearSession();
    location.href = "./?signin=1";
}

function switchPanel(panel) {
    state.activePanel = panel;
    document.body.classList.toggle("play-active", panel === "play");
    $$(".panel").forEach((element) => element.classList.add("hidden"));
    $(`#${panel}Panel`).classList.remove("hidden");
    $$(".nav-item").forEach((button) => {
        const active = button.dataset.panel === panel;
        button.classList.toggle("active", active);
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
    });
    scrollTo({ top: 0, behavior: "smooth" });
    if (panel === "play") loadPlay();
    if (panel === "profile") loadProfilePanel();
    if (panel === "feed") refreshFeedGateStatus().then(() => { if (!isFeedVoteLocked() && !state.feedItems.length) loadFeed(true); });
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

async function syncWebPushSubscription(subscription) {
    const config = await api.getWebPushConfig();
    if (!config?.enabled || !config.vapid_public_key) {
        throw new Error("Notifications are not configured yet.");
    }
    let current = subscription;
    if (!subscriptionUsesVapidKey(current, config.vapid_public_key)) {
        await current.unsubscribe();
        const registration = await navigator.serviceWorker.ready;
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
        const registration = await navigator.serviceWorker.ready;
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
    const registration = await navigator.serviceWorker.ready;
    const subscription = state.webPushSubscription || await registration.pushManager.getSubscription();
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
        const registration = await navigator.serviceWorker.ready;
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
        if (signupAgeScrollFrame) cancelAnimationFrame(signupAgeScrollFrame);
        signupAgeScrollFrame = requestAnimationFrame(() => {
            const age = 13 + Math.round(event.currentTarget.scrollTop / 40);
            selectSignupAge(age, { scroll: false });
            signupAgeScrollFrame = null;
        });
    }, { passive: true });
    $("#signupAgeWheel").addEventListener("keydown", (event) => {
        if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        selectSignupAge(Number($("#signupAge").value) + direction, { smooth: true });
    });
    $("#signupDialog").addEventListener("click", (event) => {
        const age = event.target.closest("[data-signup-age]");
        if (age) selectSignupAge(age.dataset.signupAge, { smooth: true });
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
        $$(".segment").forEach((segment) => segment.classList.toggle("active", segment === button));
        $("#myVotesFilter").classList.toggle("hidden", state.feedType !== "school");
        $("#myVotesFilter").classList.remove("active");
        $("#myVotesFilter").setAttribute("aria-pressed", "false");
        $("#myVotesFilter").textContent = "○ My Votes";
        loadFeed(true);
    }));
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
        const anonymousQuestion = event.target.closest("[data-anonymous-question]");
        const anonymousAnswer = event.target.closest("[data-anonymous-answer]");
        if (anonymousQuestion) return openAnonymousQuestionDialog(anonymousQuestion.dataset.anonymousQuestion);
        if (anonymousAnswer) return openAnonymousAnswerDialog(anonymousAnswer.dataset.anonymousAnswer);
        const upvote = event.target.closest("[data-upvote]");
        if (upvote) return toggleUpvote(upvote);
        const detail = event.target.closest("[data-feed-detail]");
        if (detail) openFeedDetail(detail.dataset.feedDetail);
    });
    $("#feedList").addEventListener("keydown", (event) => {
        if (!["Enter", " "].includes(event.key)) return;
        const detail = event.target.closest("[data-feed-detail]");
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
    $$(".nav-item").forEach((button) => button.addEventListener("click", () => switchPanel(button.dataset.panel)));
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
        const rankedClassmate = event.target.closest("[data-school-classmate]");
        if (rankedClassmate) openClassmateProfile(rankedClassmate.dataset.schoolClassmate);
        const poll = event.target.closest("[data-top-poll]");
        if (poll) openTopPoll(poll.dataset.topPoll);
        const purchase = event.target.closest("[data-buy-aura]");
        if (purchase?.dataset.buyAura === "global") openAuraSpend("global");
        if (purchase?.dataset.buyAura === "targeted") openTargetedBoostPicker();
        if (purchase?.dataset.buyAura === "question") openQuestionDialog();
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
    $("#pollSummaryDialog").addEventListener("click", (event) => { if (event.target.closest("[data-share-top-poll]")) shareTopPoll(); });
    $("#profilePictureInput").addEventListener("change", changeProfilePicture);
    $("#addPasskeyButton").addEventListener("click", addBackupPasskey);
    $("#feedbackButton").addEventListener("click", openFeedbackDialog);
    $("#feedbackForm").addEventListener("submit", submitFeedback);
    $("#classmateDirectorySearch").addEventListener("input", renderClassmateDirectory);
    $("#classmateDirectoryList").addEventListener("click", (event) => {
        const classmate = event.target.closest("[data-directory-classmate]");
        if (classmate) openClassmateProfile(classmate.dataset.directoryClassmate);
    });
    $("#classmateProfileDialog").addEventListener("click", (event) => {
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
    $("#notificationButton").addEventListener("click", toggleWebPush);
    $("#questionForm").addEventListener("submit", reviewQuestionSubmission);
    $("#questionForm").addEventListener("input", resetQuestionSubmissionIfDraftChanged);
    $("#questionForm").addEventListener("change", resetQuestionSubmissionIfDraftChanged);
    $("#questionImage").addEventListener("change", previewQuestionArtwork);
    $("#confirmQuestionSubmit").addEventListener("click", confirmQuestionSubmission);
    $("#closeQuestionPage").addEventListener("click", () => closeDetailScreen($("#questionDialog")));
    $("#profileForm").addEventListener("submit", saveProfile);
    $("#profileEditorBack").addEventListener("click", () => setProfileEditor("hub"));
    $("#profileEditorCancel").addEventListener("click", cancelProfileEditor);
    $("#profileReviewButton").addEventListener("click", () => setProfileEditor("review"));
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
    $$("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
    addEventListener("valid:session-expired", () => showSignedOut("Your session expired. Sign in with your passkey again."));
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
window.visualViewport?.addEventListener("resize", syncVisualViewport);
window.visualViewport?.addEventListener("scroll", syncVisualViewport);
addEventListener("resize", syncVisualViewport);
document.addEventListener("focusin", () => {
    syncVisualViewport();
    setTimeout(keepFocusedControlVisible, 250);
});
document.addEventListener("focusout", () => requestAnimationFrame(syncVisualViewport));
bindEvents();
if (!navigator.onLine) updateNetworkStatus();
if ("serviceWorker" in navigator && !demoMode) {
    navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" }).then(() => refreshWebPushStatus()).catch(() => null);
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
