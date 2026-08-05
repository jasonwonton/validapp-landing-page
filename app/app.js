import { ValidAPI } from "./api.js";
import { DemoAPI, localDemoAllowed } from "./demo-api.js";
import { createAdditionalPasskey, createSignupPasskey, passkeysSupported, signInWithPasskey } from "./passkeys.js";

const demoMode = localDemoAllowed();
const api = demoMode ? new DemoAPI() : new ValidAPI();
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
    anonymousInbox: null,
    selectedAnonymousQuestionId: null,
    anonymousInboxGeneration: 0,
    topQuestionsWeekly: null,
    topQuestionsAllTime: null,
    classmateDirectory: null,
    selectedClassmateProfile: null,
    passkeyStatus: null,
    pendingAuraPurchase: null,
    targetedBoostClassmates: null,
    signupStep: 0,
    installPrompt: null,
    detailReturnFocus: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function syncVisualViewport() {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const bottomInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    document.documentElement.style.setProperty("--visual-viewport-bottom", `${bottomInset}px`);
    document.documentElement.style.setProperty("--visual-viewport-center", `${viewport.offsetLeft + viewport.width / 2}px`);
    document.documentElement.style.setProperty("--visual-viewport-middle", `${viewport.offsetTop + viewport.height / 2}px`);
    document.documentElement.style.setProperty("--visual-viewport-width", `${viewport.width}px`);
    document.documentElement.style.setProperty("--visual-viewport-height", `${viewport.height}px`);
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
    state.detailReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    screen.classList.remove("hidden");
    screen.scrollTop = 0;
    document.body.classList.add("detail-screen-open");
    screen.querySelector("[aria-label='Close']")?.focus({ preventScroll: true });
}

function closeDetailScreen(screen) {
    screen.classList.add("hidden");
    if (!$(".detail-screen:not(.hidden)")) document.body.classList.remove("detail-screen-open");
    state.detailReturnFocus?.focus?.({ preventScroll: true });
    state.detailReturnFocus = null;
}

function showSignedOut(message = "") {
    clearInterval(state.playLockTimer);
    state.playLockTimer = null;
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
        const [profile, currentUser, classmatesStatus, config] = await Promise.all([
            api.getProfile(api.user.id),
            api.getUser(api.user.id).catch(() => api.user),
            api.getClassmatesStatus(api.user.id).catch(() => null),
            api.getConfig().catch(() => ({
                nomination_aura_cost: 100,
                question_submission_aura_cost: 200,
                max_custom_question_length: 280,
                max_skips_per_set: 3,
                play_lock_time_seconds: 60,
                full_reveal_aura_cost: 200,
            })),
        ]);
        api.user = { ...api.user, ...currentUser };
        state.profile = profile;
        state.classmatesStatus = classmatesStatus;
        state.config = config;
        renderProfileHeader();
        renderFeedGate();
        if (!isFeedVoteLocked()) await loadFeed(true);
        if (api.user?.deletion_requested_at) showPendingDeletion();
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
    if (item.current_user_voted) return `from ${displayName(state.profile)} (you 🫵)`;
    if (item.voter_name) return `from ${item.voter_name}`;
    const gender = String(item.voter_gender || "").toLowerCase();
    const emoji = ["female", "girl"].includes(gender) ? "👧💗" : ["male", "boy"].includes(gender) ? "👦💙" : gender === "non-binary" ? "🧑💛" : "";
    const grade = formatGrade(item.voter_grade || "");
    if (grade) return `from ${emoji} ${grade}`.replace(/\s+/g, " ");
    return emoji ? `from ${emoji}` : "";
}

function formatVoterStatement(item) {
    if (item.current_user_voted) return `${displayName(state.profile)} (you 🫵) said`;
    if (item.voter_name) return `${item.voter_name} said`;
    const gender = String(item.voter_gender || "").toLowerCase();
    const emoji = ["female", "girl"].includes(gender) ? "👧💗" : ["male", "boy"].includes(gender) ? "👦💙" : gender === "non-binary" ? "🧑💛" : "";
    const genderWord = ["female", "girl"].includes(gender) ? "Girl" : ["male", "boy"].includes(gender) ? "Boy" : gender === "non-binary" ? "Person" : "";
    const grade = formatGrade(item.voter_grade || "").replace(/\s*\([^)]*\)\s*$/, "");
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

function renderProfilePanel() {
    const profile = state.profile;
    if (!profile) return;
    const imageURL = api.assetURL(profile.profile_picture_url_medium || profile.profile_picture_url);
    $("#profileCard").innerHTML = `<article class="full-profile-card">
        <button class="profile-photo-button" type="button" data-edit-photo aria-label="Change profile picture">
            <span class="full-profile-avatar">${imageURL ? `<img src="${escapeHTML(imageURL)}" alt="${escapeHTML(displayName(profile))}">` : `<span>${escapeHTML(initials(profile))}</span>`}</span>
            <span class="photo-edit-badge" aria-hidden="true">✎</span>
        </button>
        <h3>${escapeHTML(displayName(profile))}</h3>
        <div class="profile-handle">@${escapeHTML(profile.username || "valid")}</div>
        <button class="profile-bio-button ${profile.bio ? "" : "empty"}" type="button" data-edit-bio>${profile.bio ? escapeHTML(profile.bio) : "+ Add bio"}</button>
        <button class="profile-information-inline" type="button" data-edit-profile><span><strong>Profile information</strong><small>Name, username, school and grade</small></span><span aria-hidden="true">›</span></button>
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
    const classmates = [...(state.classmateDirectory || state.classmates || [])];
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
        <div class="school-card-heading"><span><strong>School</strong><small>${escapeHTML(state.profile?.school_name || "Your school")}</small></span></div>
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
    const button = $("#addPasskeyButton");
    button.querySelector("strong").textContent = count > 1 ? "Add another passkey" : "Add a backup passkey";
    $("#passkeyStatusText").textContent = count
        ? `${count} ${count === 1 ? "passkey" : "passkeys"} registered · no SMS recovery`
        : "Add another secure way to sign in";
}

function renderGodModeCard() {
    const active = api.user?.subscribed_user === true;
    const multiplier = Math.max(1, Number(state.profile?.god_mode_aura_multiplier || 2));
    const remainingReveals = Math.max(0, Number(state.profile?.remaining_reveals || 0));
    $("#godModeCard").innerHTML = `<article class="god-mode-card ${active ? "active" : ""}">
        <div class="god-mode-title"><span><img src="../assets/app/crown.png" alt=""></span><div><strong>${active ? "God Mode Active" : "God Mode"}</strong><small>${active ? "Everything unlocked" : "Optional power-ups for your account"}</small></div>${active ? `<span class="god-mode-active">✨ Active</span>` : ""}</div>
        <ul><li>Weekly reveals and first-letter hints</li><li>${multiplier}× aura on every answer</li><li>Priority placement in classmates' polls</li></ul>
        ${active
        ? `<p>Your subscription is recognized on web · ${remainingReveals} weekly ${remainingReveals === 1 ? "reveal" : "reveals"} left. Billing stays with the store where you subscribed.</p>`
        : `<p>Start God Mode in the iPhone app. Your subscription and weekly reveals sync here automatically.</p><a class="god-mode-start-button" href="https://apps.apple.com/us/app/valid-compliment-classmates/id6755367062">Start God Mode in iPhone app</a>`}
    </article>`;
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
    container.innerHTML = `<article class="purchase-row"><span><strong>Get boosted</strong><small>Jump to the top of classmates' polls for 5 days or until you get voted 10 times.</small></span><button class="aura-price-button" type="button" data-buy-aura="global" aria-label="${globalBoost ? "Global boost active" : `Get boosted for ${globalCost.toLocaleString()} aura`}" ${globalBoost ? "disabled" : ""}>${globalBoost ? "Active" : `<span>${globalCost.toLocaleString()}</span><img src="../assets/app/aura.png" alt="aura">`}</button></article>
        <article class="purchase-row"><span><strong>See what your crush thinks about you</strong><small>Your crush stays top secret. You appear more often in their polls.</small></span><button class="aura-price-button" type="button" data-buy-aura="targeted" aria-label="Choose a crush for ${targetedCost.toLocaleString()} aura"><span>${targetedCost.toLocaleString()}</span><img src="../assets/app/aura.png" alt="aura"></button></article>
        <article class="purchase-row"><span><strong>Submit a school question</strong><small>Anonymously create a poll that your school will answer.</small></span><button class="aura-price-button" type="button" data-buy-aura="question" aria-label="Submit a school question for ${questionCost.toLocaleString()} aura"><span>${questionCost.toLocaleString()}</span><img src="../assets/app/aura.png" alt="aura"></button></article>`;
}

function openTopPoll(pollKey) {
    const polls = [...(state.topQuestionsWeekly || []), ...(state.topQuestionsAllTime || [])];
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
    const cost = auraCost(kind);
    const aura = Math.max(0, Number(state.profile?.aura_points || 0));
    if (aura < cost) return showToast(`You need ${cost.toLocaleString()} aura.`);
    const details = kind === "global"
        ? ["Get Boosted", "Jump to the top of your classmates' polls for 5 days or until you get voted 10 times."]
        : ["Boost toward your crush", `Show up more often in ${displayName(target)}'s polls. They will not be told.`];
    state.pendingAuraPurchase = { kind, target };
    $("#auraSpendTitle").textContent = details[0];
    $("#auraSpendMessage").textContent = details[1];
    $("#auraSpendCost").textContent = `${cost.toLocaleString()} aura`;
    $("#auraSpendRemaining").textContent = `${Math.max(0, aura - cost).toLocaleString()} aura`;
    $("#confirmAuraSpend").textContent = `Spend ${cost.toLocaleString()} aura`;
    $("#auraSpendStatus").textContent = "";
    $("#auraSpendDialog").showModal();
}

async function confirmAuraSpend() {
    const purchase = state.pendingAuraPurchase;
    if (!purchase) return;
    const button = $("#confirmAuraSpend");
    setButtonLoading(button, true, "Purchasing...");
    $("#auraSpendStatus").textContent = "";
    try {
        if (purchase.kind === "global") await api.purchaseGlobalBoost(api.user.id);
        else await api.purchaseTargetedBoost(api.user.id, purchase.target.user_id);
        $("#auraSpendDialog").close();
        state.pendingAuraPurchase = null;
        await refreshProfile();
        showToast(purchase.kind === "global" ? "You're boosted 🚀" : `Boosted toward ${displayName(purchase.target)} ✨`);
    } catch (error) {
        $("#auraSpendStatus").textContent = error.message || "Could not purchase this boost.";
    } finally { setButtonLoading(button, false); }
}

function renderTargetedBoostList() {
    const query = $("#targetedBoostSearch").value.trim().toLowerCase();
    const classmates = (state.targetedBoostClassmates || []).filter((classmate) => !query || `${displayName(classmate)} ${classmate.username || ""}`.toLowerCase().includes(query));
    const cost = auraCost("targeted");
    $("#targetedBoostList").innerHTML = classmates.length ? classmates.map((classmate) => {
        const active = activeBoost("targeted", classmate.user_id);
        return `<button class="nomination-row" type="button" data-targeted-boost="${escapeHTML(classmate.user_id)}" ${active ? "disabled" : ""}>${avatarMarkup(classmate, "choice-avatar")}<span><strong>${escapeHTML(displayName(classmate))}</strong><small>${active ? "Boost active" : `@${escapeHTML(classmate.username || "classmate")}`}</small></span><span class="nomination-cost">${active ? "Active" : `${cost.toLocaleString()} <img src="../assets/app/aura.png" alt="aura">`}</span></button>`;
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
}

async function openClassmateProfile(userId) {
    const preview = (state.classmateDirectory || []).find((classmate) => String(classmate.user_id) === String(userId));
    if (!preview) return;
    $("#classmateDirectoryDialog").close();
    state.selectedClassmateProfile = preview;
    renderClassmateProfile();
    $("#classmateProfileStatus").textContent = "Loading profile...";
    $("#classmateProfileDialog").showModal();
    try {
        state.selectedClassmateProfile = await api.getProfile(userId);
        $("#classmateProfileStatus").textContent = "";
        renderClassmateProfile();
    } catch (error) {
        $("#classmateProfileStatus").textContent = error.message || "Could not load this profile.";
    }
}

function backToClassmates() {
    $("#classmateProfileDialog").close();
    renderClassmateDirectory();
    $("#classmateDirectoryDialog").showModal();
}

async function loadProfilePanel() {
    renderProfilePanel();
    $("#profileStatus").textContent = "Loading your profile...";
    const requests = [];
    if (!state.topQuestionsWeekly) requests.push({ key: "weekly", promise: api.getTopQuestions(api.user.id, "weekly", 10) });
    if (!state.topQuestionsAllTime) requests.push({ key: "allTime", promise: api.getTopQuestions(api.user.id, "all_time", 3) });
    if (!state.askLink) requests.push({ key: "askLink", promise: api.getAskLink(api.user.id) });
    if (!state.passkeyStatus) requests.push({ key: "passkeyStatus", promise: api.getPasskeyStatus() });
    if (!state.classmateDirectory) requests.push({ key: "classmates", promise: api.getClassmates(api.user.id, "", 500) });
    const results = await Promise.allSettled(requests.map((request) => request.promise));
    let profileError = "";
    requests.forEach((request, index) => {
        const result = results[index];
        if (result.status === "fulfilled") {
            if (request.key === "weekly") state.topQuestionsWeekly = result.value;
            if (request.key === "allTime") state.topQuestionsAllTime = result.value;
            if (request.key === "askLink") state.askLink = result.value;
            if (request.key === "passkeyStatus") state.passkeyStatus = result.value;
            if (request.key === "classmates") {
                state.classmateDirectory = result.value;
                state.classmates = result.value;
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

function isAtLeastThirteen(dateValue) {
    const birthday = new Date(`${dateValue}T00:00:00Z`);
    if (!Number.isFinite(birthday.getTime())) return false;
    const cutoff = new Date();
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 13);
    return birthday <= cutoff;
}

function openSignupDialog() {
    $("#signupStatus").textContent = "";
    const cutoff = new Date();
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 13);
    $("#signupBirthday").max = cutoff.toISOString().slice(0, 10);
    $("#signupPhotoPreview").textContent = "+";
    setSignupStep(0);
    $("#signupDialog").showModal();
}

function setSignupStep(index) {
    state.signupStep = Math.max(0, Math.min(7, index));
    $$('[data-signup-step]').forEach((step) => step.classList.toggle("hidden", Number(step.dataset.signupStep) !== state.signupStep));
    $$(".signup-progress span").forEach((segment, segmentIndex) => segment.classList.toggle("active", segmentIndex <= state.signupStep));
    $("#signupStatus").textContent = "";
    requestAnimationFrame(() => { $("#signupDialog").scrollTop = 0; });
    $(".signup-back-button").classList.toggle("hidden", state.signupStep === 0);
    if (state.signupStep === 7) {
        $("#signupReview").innerHTML = `<strong>${escapeHTML($("#signupFirstName").value.trim())} ${escapeHTML($("#signupLastName").value.trim())}</strong><span>@${escapeHTML($("#signupUsername").value.trim().toLowerCase())} · ${escapeHTML($("#signupGrade").value)}</span><span>${escapeHTML($("#signupSchool").value.trim())} · ${escapeHTML($("#signupCity").value.trim())}, ${escapeHTML($("#signupState").value.trim().toUpperCase())}</span>`;
    }
}

async function advanceSignup(button) {
    const step = $(`[data-signup-step="${state.signupStep}"]`);
    const fields = [...step.querySelectorAll("input, select")];
    const invalid = fields.find((field) => !field.checkValidity());
    if (invalid) return invalid.reportValidity();
    if (state.signupStep === 2 && !isAtLeastThirteen($("#signupBirthday").value)) {
        $("#signupStatus").textContent = "You must be at least 13 to use Valid.";
        return;
    }
    if (state.signupStep === 5) {
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

async function createAccount(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    const birthday = $("#signupBirthday").value;
    if (!isAtLeastThirteen(birthday)) {
        $("#signupStatus").textContent = "You must be at least 13 to use Valid.";
        return;
    }
    const username = $("#signupUsername").value.trim().toLowerCase();
    const profilePicture = $("#signupPicture").files[0];
    const schoolPayload = {
        school_name: $("#signupSchool").value.trim(),
        city: $("#signupCity").value.trim(),
        state: $("#signupState").value.trim().toUpperCase(),
        grades: "6-12",
        min_grade: 6,
        max_grade: 12,
    };
    setButtonLoading(button, true, "Creating your passkey...");
    $("#signupStatus").textContent = "Finding your school...";
    try {
        const schoolResult = await api.resolveSchool(schoolPayload);
        if (!schoolResult.school?.id) throw new Error("We couldn't set up that school. Check its name and location.");
        const profile = {
            first_name: $("#signupFirstName").value.trim(),
            last_name: $("#signupLastName").value.trim(),
            date_of_birth: `${birthday}T00:00:00Z`,
            gender: $("#signupGender").value,
            school_id: schoolResult.school.id,
            grade: $("#signupGrade").value,
            username,
            profile_picture_filename: null,
        };
        $("#signupStatus").textContent = "Confirm the passkey prompt on your device.";
        let login;
        if (demoMode) {
            login = await api.demoSignup({ profile, school_name: schoolResult.school.name });
        } else {
            const credential = await createSignupPasskey(api, username);
            login = await api.completeWebSignup({
                ...credential,
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
        $("#signupPhotoPreview").textContent = "+";
        $("#signupDialog").close();
        await showSignedIn();
        showToast(photoUploadFailed ? "Welcome! Add your photo from Profile when you're ready." : "Welcome to Valid ✨");
        setTimeout(() => { if (api.hasSession()) openClassmatesDialog(); }, 700);
    } catch (error) {
        $("#signupStatus").textContent = error.message || "Could not create your account.";
    } finally {
        setButtonLoading(button, false);
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
    $("#blockFeedSubmitterButton").classList.toggle("hidden", !item.question_submitted_by_user_id);
    const revealButton = $("#revealFeedSenderButton");
    const canRevealThisVote = item.item_type === "received_vote" && !item.voter_name;
    revealButton.classList.toggle("hidden", !canRevealThisVote);
    if (canRevealThisVote) {
        const remaining = Math.max(0, Number(state.profile?.remaining_reveals || 0));
        const auraCost = Math.max(0, Number(state.config?.full_reveal_aura_cost ?? 200));
        const subscribed = api.user?.subscribed_user === true;
        const label = subscribed
            ? (remaining > 0 ? `Reveal who sent this (${remaining} remaining)` : `Reveal who sent this (${auraCost.toLocaleString()} aura)`)
            : "Get God Mode to Reveal who sent this";
        revealButton.innerHTML = `<img src="../assets/app/crown.png" alt=""><span>${escapeHTML(label)}</span>`;
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

function canvasBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not render poll image.")), "image/png");
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
    const artwork = await loadShareArtwork(api.assetURL(item.image_url));

    context.fillStyle = "#ccf7f4";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#000000";
    context.font = '44px "Jua", "Apple Color Emoji", sans-serif';
    let contentBottom = drawCenteredCanvasText(context, formatVoterStatement(item), centerX, 60, 820, 52, 2);
    context.font = '56px "Jua", "Apple Color Emoji", sans-serif';
    contentBottom = drawCenteredCanvasText(context, item.question_text, centerX, contentBottom + 16, 820, 63, 3);

    if (artwork) {
        const availableSize = Math.max(360, Math.min(620, 1010 - contentBottom));
        const scale = Math.min(availableSize / artwork.naturalWidth, availableSize / artwork.naturalHeight);
        const width = artwork.naturalWidth * scale;
        const height = artwork.naturalHeight * scale;
        const x = centerX - width / 2;
        const y = contentBottom + 24;
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

    const gridTop = Math.max(contentBottom + 28, artwork ? 0 : 530);
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
                context.font = '60px "Apple Color Emoji", sans-serif';
                context.textAlign = "center";
                context.textBaseline = "middle";
                context.lineJoin = "round";
                context.lineWidth = 8;
                context.strokeStyle = "#000000";
                context.strokeText("👆", x + cardWidth / 2, y + cardHeight + 29);
                context.fillText("👆", x + cardWidth / 2, y + cardHeight + 29);
            }
        });
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
    context.textBaseline = "alphabetic";
    context.fillText("validapp.lol", centerX, 1550);
    const blob = await canvasBlob(canvas);
    const identifier = String(item.question_answer_id || item.question_id || "poll").replace(/[^a-z0-9_-]/gi, "");
    return new File([blob], `valid-poll-${identifier}.png`, { type: "image/png" });
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
        closeDetailScreen($("#feedDetailDialog"));
        state.selectedFeedItemId = null;
        switchPanel("profile");
        const focusGodModeCard = () => {
            $("#godModeCard")?.scrollIntoView({ behavior: "smooth", block: "center" });
            $("#godModeCard")?.classList.add("attention");
            setTimeout(() => $("#godModeCard")?.classList.remove("attention"), 1200);
        };
        requestAnimationFrame(focusGodModeCard);
        setTimeout(focusGodModeCard, 450);
        showToast("Start God Mode in the Valid iPhone app; it syncs here automatically.");
        return;
    }
    const button = $("#revealFeedSenderButton");
    const remaining = Math.max(0, Number(state.profile?.remaining_reveals || 0));
    const auraCost = Math.max(0, Number(state.config?.full_reveal_aura_cost ?? 200));
    if (remaining === 0) {
        if (Number(state.profile?.aura_points || 0) < auraCost) {
            $("#feedDetailStatus").textContent = `You need ${auraCost.toLocaleString()} aura for another reveal.`;
            return;
        }
        if (!confirm(`Use ${auraCost.toLocaleString()} aura to reveal who sent this vote?`)) return;
    }
    setButtonLoading(button, true, "Revealing...");
    $("#feedDetailStatus").textContent = "";
    try {
        const result = await api.revealSender(api.user.id, item.question_answer_id);
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
        showToast(`Revealed: ${result.full_name}`);
    } catch (error) {
        $("#feedDetailStatus").textContent = error.message || "Could not reveal this sender.";
        setButtonLoading(button, false);
    }
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
    if (!locked) return;
    const cast = Number(state.classmatesStatus?.votes_cast || 0);
    const required = Number(state.classmatesStatus?.required_votes || 0);
    $("#feedGateLock").innerHTML = `<article class="feed-gate-card">
        <span class="feed-gate-lock" aria-hidden="true">🔒</span>
        <h3>Feed is locked</h3>
        <p>Answer a few polls to see what everyone is saying.</p>
        <progress class="feed-gate-progress" max="${Math.max(1, required)}" value="${Math.min(cast, Math.max(1, required))}" aria-label="Votes required to unlock Feed"></progress>
        <strong>${cast} / ${required} votes cast</strong>
        <button class="primary-button" type="button" data-vote-to-unlock>Vote now to unlock Feed</button>
    </article>`;
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
    $("#anonymousAnswerText").value = question.answer_text || "";
    $("#anonymousAnswerText").readOnly = answered;
    $("#anonymousAnswerLabel").textContent = "Your reply";
    $("#anonymousAnswerButton").classList.toggle("hidden", answered);
    $("#anonymousAnswerShare").classList.toggle("hidden", !answered);
    $("#anonymousAnswerStatus").textContent = answered
        ? `Answered ${relativeTime(question.answered_at)}${question.aura_points_earned ? ` · +${question.aura_points_earned} aura` : ""}`
        : "";
}

async function shareAnonymousAnswer(platform) {
    const question = selectedAnonymousQuestion();
    if (!question?.answer_text) return;
    const text = `${question.body}\n\n${question.answer_text}`;
    try {
        if (navigator.share) await navigator.share({ title: "My anonymous answer on Valid", text, url: state.askLink?.share_url || "https://validapp.lol/app/" });
        else {
            await navigator.clipboard.writeText(text);
            showToast("Answer copied to share");
        }
        api.trackAskShare(api.user.id, platform).catch(() => null);
    } catch (error) {
        if (error.name !== "AbortError") showToast("Could not share your answer.");
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
    if (!question || question.status === "answered") return;
    const answerText = $("#anonymousAnswerText").value.trim();
    if (!answerText) return;
    const button = $("#anonymousAnswerButton");
    setButtonLoading(button, true, "Answering...");
    $("#anonymousAnswerStatus").textContent = "";
    try {
        const updated = await api.answerAnonymousQuestion(api.user.id, question.id, answerText);
        Object.assign(question, updated);
        if (state.profile && updated.aura_points_earned) {
            state.profile.aura_points = Number(state.profile.aura_points || 0) + Number(updated.aura_points_earned);
            renderProfileHeader();
        }
        renderAnonymousInbox();
        renderAnonymousQuestionDialog();
        showToast(updated.aura_points_earned ? `Answered · +${updated.aura_points_earned} aura ✨` : "Answered privately");
        refreshProfile();
    } catch (error) {
        $("#anonymousAnswerStatus").textContent = error.message || "Could not answer this question.";
    } finally {
        setButtonLoading(button, false);
    }
}

async function handleAnonymousSafetyAction(action) {
    const question = selectedAnonymousQuestion();
    if (!question) return;
    const prompts = {
        report: "Report and remove this question? Valid's moderation team will review it.",
        block: "Block this anonymous sender and remove the question? Future questions from this sender will be hidden.",
        delete: "Delete this question? This cannot be undone.",
    };
    if (!confirm(prompts[action])) return;
    try {
        if (action === "report") await api.reportAnonymousQuestion(api.user.id, question.id);
        if (action === "block") await api.blockAnonymousQuestion(api.user.id, question.id);
        if (action === "delete") await api.deleteAnonymousQuestion(api.user.id, question.id);
        state.anonymousInbox.questions = state.anonymousInbox.questions.filter((item) => String(item.id) !== String(question.id));
        state.selectedAnonymousQuestionId = null;
        closeDetailScreen($("#anonymousQuestionDialog"));
        renderAnonymousInbox();
        showToast(action === "block" ? "Sender blocked" : action === "report" ? "Reported to Valid" : "Question deleted");
    } catch (error) {
        $("#anonymousAnswerStatus").textContent = error.message || `Could not ${action} this question.`;
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

function animateAuraChange(amount) {
    const chip = $("#auraCount")?.closest(".play-aura-chip");
    if (!chip || !Number.isFinite(Number(amount)) || Number(amount) === 0) return;
    chip.animate([
        { transform: "scale(1)", background: "rgba(255,255,255,.92)" },
        { transform: "scale(1.16)", background: Number(amount) > 0 ? "#ccf7f4" : "#ffb8d6", offset: .45 },
        { transform: "scale(1)", background: "rgba(255,255,255,.92)" },
    ], { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" });
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
    const attribution = question.is_user_submitted ? `<div class="question-attribution">${question.is_anonymous ? avatarMarkup({ first_name: "Anonymous", profile_picture_url: "../assets/app/anonymous.png" }, "attribution-avatar") : avatarMarkup({ first_name: question.submitted_by_name || "A classmate", profile_picture_url: question.submitted_by_avatar_url }, "attribution-avatar")}<span><small>Question submitted by</small><strong>${escapeHTML(question.is_anonymous ? "Someone at your school" : question.submitted_by_name || "A classmate")}</strong></span></div>` : "";
    const remainingSkips = Math.max(0, Number(state.config?.max_skips_per_set ?? 3) - state.skipsUsedInSet);
    const safetyActions = question.is_user_submitted ? `<div class="play-safety-actions"><button type="button" data-play-question-action="report">Report question</button><button type="button" data-play-question-action="block">Block submitter</button></div>` : "";
    card.innerHTML = `<article class="play-card">
        <h3>${escapeHTML(question.question_text)}</h3>
        ${attribution}
        <div class="question-artwork">${artworkURL ? `<img src="${escapeHTML(artworkURL)}" alt="">` : `<div class="artwork-placeholder"><img src="../assets/app/pencil-clipboard.png" alt=""><span>Question artwork</span></div>`}</div>
        <div class="choice-grid">${choices.map(choiceMarkup).join("")}</div>
        <div class="play-actions">
            <button class="play-action-button" data-shuffle type="button"><span aria-hidden="true">↻</span> Shuffle</button>
            <button class="play-action-button nominate" data-nominate type="button"><img src="../assets/app/crown.png" alt="">Nominate</button>
            <button class="play-action-button" data-skip="${question.id}" type="button" ${remainingSkips < 1 ? "disabled" : ""}>Skip (${remainingSkips})</button>
        </div>
        ${safetyActions}
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
    $$(".choice-button").forEach((button) => {
        button.disabled = true;
        button.classList.toggle("selected", button.dataset.choice === choiceId);
    });
    softHaptic();
    try {
        const result = await api.answerQuestion(api.user.id, {
            question_id: question.id,
            selected_contact_user_id: selected.user_id,
            selected_contact_name: displayName(selected),
            presented_options: choices.map((choice) => ({ phone: "", name: displayName(choice) })),
            is_nomination: false,
        });
        const auraEarned = Math.max(0, Number(result.aura_points_earned || 0));
        state.playAuraEarned += auraEarned;
        if (state.profile && Number.isFinite(Number(result.total_aura_points))) {
            state.profile.aura_points = Number(result.total_aura_points);
            state.profile.current_streak = Math.max(0, Number(result.current_streak ?? state.profile.current_streak ?? 0));
            state.profile.streak_multiplier = Math.max(1, Number(result.streak_multiplier ?? state.profile.streak_multiplier ?? 1));
            renderProfileHeader();
        }
        animateAuraChange(auraEarned);
        showToast(`${auraEarned ? `+${auraEarned} aura · ` : ""}You picked ${displayName(selected)} ✨`);
        state.questionIndex += 1;
        renderPlay();
        refreshProfile();
        refreshFeedGateStatus();
    } catch (error) {
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
        state.profile = await api.getProfile(api.user.id);
        renderProfileHeader();
        renderProfilePanel();
    } catch (_) { /* The action succeeded; totals can catch up later. */ }
}

function renderAskLink() {
    const link = state.askLink;
    if (!link) return;
    $("#askLinkCard").innerHTML = `<article class="ask-link-card">
        <div class="ask-link-heading"><img class="ask-message-icon" src="../assets/app/message.png" alt=""><div><strong>Get messages</strong><span>Share your link in a story. New messages show up in Inbox.</span></div></div>
        <button class="ask-url" type="button" data-copy-link aria-label="Copy ask link"><span>🔗</span><span>${escapeHTML(link.share_url.replace(/^https:\/\//, ""))}</span><strong>Copy</strong></button>
        ${link.is_active ? `<div class="share-platform-row"><span class="share-platform-label">Open on:</span><button class="share-platform-button snapchat" type="button" data-share-link="snapchat" aria-label="Share ask link to Snapchat">${shareIconMarkup("snapchat")}</button><button class="share-platform-button instagram" type="button" data-share-link="instagram" aria-label="Share ask link to Instagram">${shareIconMarkup("instagram")}</button></div>` : `<button class="primary-button" type="button" data-toggle-link>Resume ask link</button>`}
    </article>`;
}

async function shareAskLink(forceCopy, platform = "other") {
    if (!state.askLink) return;
    try {
        if (!forceCopy && navigator.share) await navigator.share({ title: "Ask me on Valid", text: "Ask me anything anonymously", url: state.askLink.share_url });
        else {
            await navigator.clipboard.writeText(state.askLink.share_url);
            showToast("Ask me link copied");
        }
        api.trackAskShare(api.user.id, forceCopy ? "copy" : platform).catch(() => null);
    } catch (error) {
        if (error.name !== "AbortError") showToast("Could not share that link.");
    }
}

async function toggleAskLink() {
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

function openProfileDialog() {
    const profile = state.profile;
    $("#profileFirstName").value = profile.first_name || "";
    $("#profileLastName").value = profile.last_name || "";
    $("#profileUsername").value = profile.username || "";
    $("#profileSchoolName").value = profile.school_name || "";
    $("#profileSchoolCity").value = "";
    $("#profileSchoolState").value = "";
    const grade = profile.grade || "Junior";
    const select = $("#profileGrade");
    if (![...select.options].some((option) => option.value === grade)) select.add(new Option(grade, grade));
    select.value = grade;
    const informationLocked = profile.can_change_information === false;
    [$("#profileFirstName"), $("#profileLastName"), $("#profileUsername"), $("#profileSchoolName"), $("#profileSchoolCity"), $("#profileSchoolState"), $("#profileGrade")].forEach((field) => { field.disabled = informationLocked; });
    $("#profileEditHint").textContent = profile.can_change_information === false
        ? `Profile information can be changed again ${relativeTime(profile.next_information_change_at)}. Tap your photo or bio to change either one now.`
        : "Name, username, school and grade share the same cooldown as iOS.";
    $("#profileEditStatus").textContent = "";
    $("#profileDialog").showModal();
}

async function saveProfile(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    let schoolId = state.profile.school_id || null;
    const schoolName = $("#profileSchoolName").value.trim();
    const schoolChanged = schoolName !== (state.profile.school_name || "");
    const nextInfo = {
        first_name: $("#profileFirstName").value.trim(),
        last_name: $("#profileLastName").value.trim(),
        username: $("#profileUsername").value.trim().toLowerCase(),
        grade: $("#profileGrade").value,
        school_id: schoolId,
    };
    const infoChanged = schoolChanged || ["first_name", "last_name", "username", "grade"].some((key) => nextInfo[key] !== (state.profile[key] || ""));
    setButtonLoading(button, true, "Saving...");
    $("#profileEditStatus").textContent = "";
    try {
        if (schoolChanged) {
            const city = $("#profileSchoolCity").value.trim();
            const region = $("#profileSchoolState").value.trim().toUpperCase();
            if (!city || !region) throw new Error("Add the city and two-letter state when changing schools.");
            const resolved = await api.resolveSchool({ school_name: schoolName, city, state: region });
            nextInfo.school_id = resolved.school.id;
        }
        if (infoChanged) state.profile = await api.updateInformation(api.user.id, nextInfo);
        renderProfileHeader();
        renderProfilePanel();
        $("#profileForm").reset();
        $("#profileDialog").close();
        showToast("Profile updated");
    } catch (error) {
        await refreshProfile();
        $("#profileEditStatus").textContent = error.message || "Could not save all profile changes.";
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
    const image = $("#questionImage").files[0];
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
    $("#questionConfirmCurrent").textContent = aura.toLocaleString();
    $("#questionConfirmRemaining").textContent = Math.max(0, aura - cost).toLocaleString();
    $("#confirmQuestionSubmit").textContent = `Spend ${cost.toLocaleString()} aura`;
    $("#questionSubmitButton").textContent = state.pendingQuestionSubmissionKey ? "Check submission" : "Submit for review";
}

function resetQuestionSubmissionIfDraftChanged() {
    if (!state.pendingQuestionSubmissionKey || questionDraftFingerprint() === state.pendingQuestionDraft) return;
    state.pendingQuestionSubmissionKey = null;
    state.pendingQuestionDraft = null;
    $("#questionStatus").textContent = "";
    updateQuestionSubmissionUI();
}

function reviewQuestionSubmission(event) {
    event.preventDefault();
    const image = $("#questionImage").files[0];
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
    const image = $("#questionImage").files[0];
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
        state.pendingQuestionSubmissionKey = null;
        state.pendingQuestionDraft = null;
        form.reset();
        $("#questionDialog").close();
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
    updateQuestionSubmissionUI();
    $("#questionDialog").showModal();
}

function previewSignupPhoto() {
    const input = $("#signupPicture");
    const file = input.files[0];
    const preview = $("#signupPhotoPreview");
    if (!file) {
        preview.textContent = "+";
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        input.value = "";
        preview.textContent = "+";
        $("#signupStatus").textContent = "Profile photos must be 5 MB or smaller.";
        return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => { preview.innerHTML = `<img src="${escapeHTML(reader.result)}" alt="">`; }, { once: true });
    reader.addEventListener("error", () => { preview.textContent = "+"; }, { once: true });
    reader.readAsDataURL(file);
}

function contactsPickerSupported() {
    return demoMode || Boolean(navigator.contacts?.select);
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

async function openClassmatesDialog() {
    $("#classmatesStatus").textContent = contactsPickerSupported()
        ? ""
        : "This browser cannot open selected contacts. You can still share a private invite.";
    $("#chooseContactsButton").classList.toggle("hidden", !contactsPickerSupported());
    renderInviteRewardCard();
    $("#classmatesDialog").showModal();
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
        if (state.classmates.length >= 4) {
            $("#classmatesDialog").close();
            showToast("Classmates are ready for Play ✨");
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
    await api.logout().catch(() => null);
    api.clearSession();
    location.reload();
}

function switchPanel(panel) {
    state.activePanel = panel;
    document.body.classList.toggle("play-active", panel === "play");
    $$(".panel").forEach((element) => element.classList.add("hidden"));
    $(`#${panel}Panel`).classList.remove("hidden");
    $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.panel === panel));
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

async function installWebApp() {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice.catch(() => null);
    state.installPrompt = null;
    $("#installAppButton").classList.add("hidden");
}

function bindEvents() {
    $("#passkeyButton").addEventListener("click", handlePasskeySignIn);
    $("#createAccountButton").addEventListener("click", openSignupDialog);
    $("#signupForm").addEventListener("submit", createAccount);
    $("#signupPicture").addEventListener("change", previewSignupPhoto);
    $("#signupDialog").addEventListener("click", (event) => {
        const next = event.target.closest("[data-signup-next]");
        if (next) advanceSignup(next);
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
        if (event.target.closest("[data-close-feed-detail]")) {
            state.selectedFeedItemId = null;
            closeDetailScreen($("#feedDetailDialog"));
        }
        if (event.target.closest("#revealFeedSenderButton")) revealFeedSender();
        const share = event.target.closest("[data-share-feed-platform]");
        if (share) shareFeedItem(share.dataset.shareFeedPlatform);
        if (event.target.closest("[data-report-feed-item]")) moderateFeedItem("report");
        if (event.target.closest("[data-block-feed-submitter]")) moderateFeedItem("block");
    });
    $("#feedGateLock").addEventListener("click", (event) => { if (event.target.closest("[data-vote-to-unlock]")) switchPanel("play"); });
    $("#anonymousAnswerForm").addEventListener("submit", answerAnonymousQuestion);
    $("#anonymousQuestionDialog").addEventListener("click", (event) => {
        if (event.target.closest("[data-close-anonymous]")) {
            state.selectedAnonymousQuestionId = null;
            closeDetailScreen($("#anonymousQuestionDialog"));
        }
        const action = event.target.closest("[data-anonymous-action]");
        const share = event.target.closest("[data-share-anonymous]");
        if (action) handleAnonymousSafetyAction(action.dataset.anonymousAction);
        if (share) shareAnonymousAnswer(share.dataset.shareAnonymous);
    });
    $$(".nav-item").forEach((button) => button.addEventListener("click", () => switchPanel(button.dataset.panel)));
    $("#playCard").addEventListener("click", (event) => {
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
        if (safetyAction) moderatePlayQuestion(safetyAction.dataset.playQuestionAction);
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
    });
    $("#profilePanel").addEventListener("click", (event) => {
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
    $("#pollSummaryDialog").addEventListener("click", (event) => { if (event.target.closest("[data-share-top-poll]")) shareTopPoll(); });
    $("#profilePictureInput").addEventListener("change", changeProfilePicture);
    $("#addPasskeyButton").addEventListener("click", addBackupPasskey);
    $("#classmateDirectorySearch").addEventListener("input", renderClassmateDirectory);
    $("#classmateDirectoryList").addEventListener("click", (event) => {
        const classmate = event.target.closest("[data-directory-classmate]");
        if (classmate) openClassmateProfile(classmate.dataset.directoryClassmate);
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
    $("#deleteAccountForm").addEventListener("submit", requestAccountDeletion);
    $("#cancelDeletionButton").addEventListener("click", cancelAccountDeletion);
    $("#pendingDeletionLogout").addEventListener("click", logoutAndReset);
    $("#installAppButton").addEventListener("click", installWebApp);
    $("#questionForm").addEventListener("submit", reviewQuestionSubmission);
    $("#questionForm").addEventListener("input", resetQuestionSubmissionIfDraftChanged);
    $("#questionForm").addEventListener("change", resetQuestionSubmissionIfDraftChanged);
    $("#confirmQuestionSubmit").addEventListener("click", confirmQuestionSubmission);
    $("#profileForm").addEventListener("submit", saveProfile);
    $("#bioForm").addEventListener("submit", saveBio);
    $$("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
    addEventListener("valid:session-expired", () => showSignedOut("Your session expired. Sign in with your passkey again."));
    addEventListener("offline", updateNetworkStatus);
    addEventListener("online", updateNetworkStatus);
    addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        state.installPrompt = event;
        $("#installAppButton").classList.remove("hidden");
    });
    addEventListener("appinstalled", () => {
        state.installPrompt = null;
        $("#installAppButton").classList.add("hidden");
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
bindEvents();
if (!navigator.onLine) updateNetworkStatus();
if ("serviceWorker" in navigator && !demoMode) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => null);
}
if (!passkeysSupported() && !demoMode) {
    $("#passkeyButton").disabled = true;
    $("#authStatus").textContent = "This browser does not support passkeys. Try current Chrome, Safari, or Edge.";
}
