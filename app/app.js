import { ValidAPI } from "./api.js";
import { DemoAPI, localDemoAllowed } from "./demo-api.js";
import { createSignupPasskey, passkeysSupported, signInWithPasskey } from "./passkeys.js";

const demoMode = localDemoAllowed();
const api = demoMode ? new DemoAPI() : new ValidAPI();
const state = {
    profile: null,
    activePanel: "feed",
    feedType: "personal",
    myVotesOnly: false,
    feedSearch: "",
    feedItems: [],
    feedOffset: 0,
    feedCursor: null,
    feedGeneration: 0,
    selectedFeedItemId: null,
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
    signupStep: 0,
    installPrompt: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

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
    try {
        const [profile, classmatesStatus, config] = await Promise.all([
            api.getProfile(api.user.id),
            api.getClassmatesStatus(api.user.id).catch(() => null),
            api.getConfig().catch(() => ({
                nomination_aura_cost: 100,
                question_submission_aura_cost: 200,
                max_custom_question_length: 280,
                max_skips_per_set: 3,
                play_lock_time_seconds: 60,
            })),
        ]);
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
    $("#profileGreeting").textContent = `Hey, ${profile.first_name || profile.username || "there"}`;
    $("#profileSchool").textContent = profile.school_name || `@${profile.username}`;
    $("#auraCount").textContent = Number(profile.aura_points || 0).toLocaleString();
    const avatar = $("#profileAvatar");
    const imageURL = api.assetURL(profile.profile_picture_url_thumb || profile.profile_picture_url);
    avatar.innerHTML = imageURL
        ? `<img src="${escapeHTML(imageURL)}" alt="${escapeHTML(displayName(profile))}">`
        : escapeHTML(initials(profile));
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

function renderProfilePolls(container, questions, emptyMessage) {
    if (!questions?.length) {
        container.innerHTML = `<div class="profile-poll-empty">${escapeHTML(emptyMessage)}</div>`;
        return;
    }
    container.innerHTML = questions.map((question, index) => {
        const imageURL = api.assetURL(question.image_url);
        return `<article class="profile-poll-row">
            <div class="profile-poll-art">${imageURL ? `<img src="${escapeHTML(imageURL)}" alt="">` : `<span>${index + 1}</span>`}</div>
            <div class="profile-poll-copy"><strong>${escapeHTML(question.question_text)}</strong><span>♥ ${Number(question.vote_count || 0).toLocaleString()} votes</span></div>
        </article>`;
    }).join("");
}

function renderProfilePanel() {
    const profile = state.profile;
    if (!profile) return;
    const imageURL = api.assetURL(profile.profile_picture_url_medium || profile.profile_picture_url);
    $("#profileCard").innerHTML = `<article class="full-profile-card">
        <button class="profile-photo-button" type="button" data-edit-profile aria-label="Change profile picture">
            <span class="full-profile-avatar">${imageURL ? `<img src="${escapeHTML(imageURL)}" alt="${escapeHTML(displayName(profile))}">` : `<span>${escapeHTML(initials(profile))}</span>`}</span>
            <span class="photo-edit-badge" aria-hidden="true">✎</span>
        </button>
        <h3>${escapeHTML(displayName(profile))}</h3>
        <div class="profile-handle">@${escapeHTML(profile.username || "valid")}${profile.current_streak > 0 ? ` <span>🔥 ${Number(profile.current_streak)}</span>` : ""}</div>
        ${profile.bio ? `<p class="profile-bio">${escapeHTML(profile.bio)}</p>` : `<button class="add-bio-button" type="button" data-edit-profile>+ Add a bio</button>`}
        <div class="profile-school-meta"><span>🏫 ${escapeHTML(profile.school_name || "Your school")}</span>${profile.grade ? `<span>🎓 ${escapeHTML(formatGrade(profile.grade))}</span>` : ""}</div>
        <div class="profile-stats-grid">
            <div class="profile-stat-card"><strong><img class="profile-aura-icon" src="../assets/app/aura.png" alt="">${Number(profile.aura_points || 0).toLocaleString()}</strong><span>Aura</span></div>
            <div class="profile-stat-card"><strong><span class="heart">♥</span>${Number(profile.vote_count || 0).toLocaleString()}</strong><span>Votes Received</span></div>
        </div>
    </article>`;
    renderProfilePolls($("#weeklyPolls"), state.topQuestionsWeekly, "No polls this week yet");
    renderProfilePolls($("#allTimePolls"), state.topQuestionsAllTime, "No polls yet");
}

async function loadProfilePanel() {
    renderProfilePanel();
    $("#profileStatus").textContent = "Loading your profile...";
    const requests = [];
    if (!state.topQuestionsWeekly) requests.push({ key: "weekly", promise: api.getTopQuestions(api.user.id, "weekly", 10) });
    if (!state.topQuestionsAllTime) requests.push({ key: "allTime", promise: api.getTopQuestions(api.user.id, "all_time", 3) });
    if (!state.askLink) requests.push({ key: "askLink", promise: api.getAskLink(api.user.id) });
    const results = await Promise.allSettled(requests.map((request) => request.promise));
    let profileError = "";
    requests.forEach((request, index) => {
        const result = results[index];
        if (result.status === "fulfilled") {
            if (request.key === "weekly") state.topQuestionsWeekly = result.value;
            if (request.key === "allTime") state.topQuestionsAllTime = result.value;
            if (request.key === "askLink") state.askLink = result.value;
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
    state.signupStep = Math.max(0, Math.min(2, index));
    $$('[data-signup-step]').forEach((step) => step.classList.toggle("hidden", Number(step.dataset.signupStep) !== state.signupStep));
    $$(".signup-progress span").forEach((segment, segmentIndex) => segment.classList.toggle("active", segmentIndex <= state.signupStep));
    $("#signupStatus").textContent = "";
    requestAnimationFrame(() => { $("#signupDialog").scrollTop = 0; });
    if (state.signupStep === 2) {
        $("#signupReview").innerHTML = `<strong>${escapeHTML($("#signupFirstName").value.trim())} ${escapeHTML($("#signupLastName").value.trim())}</strong><span>@${escapeHTML($("#signupUsername").value.trim().toLowerCase())} · ${escapeHTML($("#signupGrade").value)}</span><span>${escapeHTML($("#signupSchool").value.trim())} · ${escapeHTML($("#signupCity").value.trim())}, ${escapeHTML($("#signupState").value.trim().toUpperCase())}</span>`;
    }
}

function advanceSignup() {
    const step = $(`[data-signup-step="${state.signupStep}"]`);
    const fields = [...step.querySelectorAll("input, select")];
    const invalid = fields.find((field) => !field.checkValidity());
    if (invalid) return invalid.reportValidity();
    if (state.signupStep === 0 && !isAtLeastThirteen($("#signupBirthday").value)) {
        $("#signupStatus").textContent = "You must be at least 13 to use Valid.";
        return;
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

function renderFeed() {
    const list = $("#feedList");
    const query = state.feedSearch.trim().toLowerCase();
    const visible = query ? state.feedItems.filter((item) => [item.question_text, item.voted_for_name, item.contact_name, item.voter_name].some((value) => String(value || "").toLowerCase().includes(query))) : state.feedItems;
    if (!visible.length) {
        const text = state.feedSearch ? "No matching votes." : state.myVotesOnly ? "You haven't voted yet. Answer questions in Play to see your votes here." : "No votes here yet. Play a few rounds and check back soon.";
        list.innerHTML = `<div class="empty-card">${escapeHTML(text)}</div>`;
        return;
    }
    list.innerHTML = visible.map((item) => {
        const isPersonal = state.feedType === "personal";
        const title = isPersonal ? `${item.is_nomination ? "👑 " : ""}<strong>You</strong> got ${item.is_nomination ? "nominated" : "voted"}` : `<strong>${escapeHTML(item.voted_for_name || item.contact_name || "A classmate")}</strong> got voted`;
        const detail = formatVoterHint(item);
        return `<article class="feed-card" data-answer-id="${item.question_answer_id}" data-feed-detail="${item.question_answer_id}" role="button" tabindex="0" aria-label="Open poll details: ${escapeHTML(item.question_text)}">
            ${feedAvatar(item)}
            <div class="feed-body">
                <div class="feed-meta"><span>${title}</span><time>${escapeHTML(relativeTime(item.timestamp))}</time></div>
                <div class="feed-question">${escapeHTML(item.question_text)}</div>
                ${detail ? `<div class="feed-answer">${escapeHTML(detail)}</div>` : ""}
            </div>
            <button class="upvote-button ${item.user_has_upvoted ? "active" : ""}" type="button" data-upvote="${item.question_answer_id}" aria-label="Upvote">${item.user_has_upvoted ? "♥" : "♡"}<span>${item.upvote_count || 0}</span></button>
        </article>`;
    }).join("");
}

function selectedFeedItem() {
    return state.feedItems.find((item) => String(item.question_answer_id) === String(state.selectedFeedItemId));
}

function renderFeedDetail() {
    const item = selectedFeedItem();
    if (!item) return;
    const selectedName = item.selected_contact_name || item.voted_for_name || item.contact_name || "A classmate";
    const options = Array.isArray(item.presented_options) ? item.presented_options : [];
    const artworkURL = api.assetURL(item.image_url);
    const hint = formatVoterHint(item);
    $("#feedDetailBody").innerHTML = `<article class="feed-detail-card">
        <h3>${escapeHTML(item.question_text)}</h3>
        ${artworkURL ? `<div class="feed-detail-art"><img src="${escapeHTML(artworkURL)}" alt=""></div>` : ""}
        <div class="feed-detail-result"><span>${avatarMarkup({ first_name: selectedName, profile_picture_url: item.voted_for_profile_picture_url }, "choice-avatar")}</span><div><small>Picked</small><strong>${escapeHTML(selectedName)}</strong>${hint ? `<span>${escapeHTML(hint)}</span>` : ""}</div></div>
        ${options.length ? `<div class="feed-detail-options">${options.map((option) => {
            const name = option.name || option.contact_name || "A classmate";
            const selected = name === selectedName;
            return `<div class="feed-detail-option ${selected ? "selected" : ""}"><span>${selected ? "✓" : ""}</span><strong>${escapeHTML(name)}</strong></div>`;
        }).join("")}</div>` : ""}
    </article>`;
    $("#blockFeedSubmitterButton").classList.toggle("hidden", !item.question_submitted_by_user_id);
    $("#feedDetailStatus").textContent = "";
}

function openFeedDetail(answerId) {
    state.selectedFeedItemId = answerId;
    renderFeedDetail();
    $("#feedDetailDialog").showModal();
}

async function shareFeedItem() {
    const item = selectedFeedItem();
    if (!item) return;
    const text = `${item.question_text}\n${item.voted_for_name || item.contact_name || "A classmate"} got picked on Valid`;
    try {
        if (navigator.share) await navigator.share({ title: "A poll on Valid", text, url: "https://validapp.lol/app/" });
        else {
            await navigator.clipboard.writeText(`${text}\nhttps://validapp.lol/app/`);
            showToast("Poll copied to share");
        }
    } catch (error) {
        if (error.name !== "AbortError") $("#feedDetailStatus").textContent = "Could not share this poll.";
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
        $("#feedDetailDialog").close();
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
        <div class="feed-gate-progress"><span style="--feed-progress:${required ? Math.min(100, (cast / required) * 100) : 0}%"></span></div>
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
    const section = $("#anonymousInboxSection");
    if (state.feedType !== "personal" || !state.anonymousInbox) {
        section.classList.add("hidden");
        return;
    }
    section.classList.remove("hidden");
    const questions = state.anonymousInbox.questions || [];
    const answers = state.anonymousInbox.answers || [];
    const unread = questions.filter((question) => !question.opened_at).length;
    const unreadBadge = $("#anonymousUnreadCount");
    unreadBadge.textContent = unread ? `${unread} new` : "";
    unreadBadge.classList.toggle("hidden", unread === 0);

    const questionRows = questions.slice(0, 4).map((question) => `<button class="anonymous-question-row ${question.opened_at ? "" : "unread"} ${question.status === "answered" ? "answered" : ""}" type="button" data-anonymous-question="${escapeHTML(question.id)}">
        <span class="anonymous-row-icon" aria-hidden="true">?</span>
        <span class="anonymous-row-copy"><strong>${escapeHTML(question.body)}</strong><small>${escapeHTML(question.provenance_label)} · ${escapeHTML(relativeTime(question.created_at))}</small></span>
        <span class="anonymous-row-state">${question.status === "answered" ? "Answered" : "›"}</span>
    </button>`).join("");
    const answerRows = answers.slice(0, 2).map((answer) => `<article class="anonymous-reply-row">
        <span class="anonymous-row-icon reply" aria-hidden="true">↩</span>
        <span class="anonymous-row-copy"><strong>${escapeHTML(answer.answer_text)}</strong><small>Reply from @${escapeHTML(answer.recipient_username)} · ${escapeHTML(relativeTime(answer.answered_at))}</small></span>
    </article>`).join("");
    $("#anonymousInboxList").innerHTML = questionRows || answerRows
        ? `${questionRows}${answerRows}`
        : `<div class="anonymous-empty"><img src="../assets/app/anonymous.png" alt=""><span>No anonymous questions yet. Share your Ask me link from Profile.</span></div>`;
}

async function loadAnonymousInbox() {
    const generation = ++state.anonymousInboxGeneration;
    const status = $("#anonymousInboxStatus");
    status.textContent = "Checking for questions...";
    try {
        state.anonymousInbox = await api.getAnonymousInbox(api.user.id, 30, 0);
        if (generation !== state.anonymousInboxGeneration || state.feedType !== "personal") return;
        status.textContent = "";
        renderAnonymousInbox();
    } catch (error) {
        if (generation !== state.anonymousInboxGeneration || state.feedType !== "personal") return;
        if (error.status === 404) {
            state.anonymousInbox = null;
            $("#anonymousInboxSection").classList.add("hidden");
        } else {
            $("#anonymousInboxSection").classList.remove("hidden");
            status.textContent = error.message || "Could not load anonymous questions.";
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
    $("#anonymousAnswerLabel").textContent = "Your answer";
    $("#anonymousAnswerButton").classList.toggle("hidden", answered);
    $("#anonymousAnswerStatus").textContent = answered
        ? `Answered ${relativeTime(question.answered_at)}${question.aura_points_earned ? ` · +${question.aura_points_earned} aura` : ""}`
        : "";
}

async function openAnonymousQuestionDialog(questionId) {
    state.selectedAnonymousQuestionId = questionId;
    renderAnonymousQuestionDialog();
    $("#anonymousQuestionDialog").showModal();
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
        $("#anonymousQuestionDialog").close();
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
        if (feedType === "personal") items = await api.getPersonalFeed(api.user.id, state.feedOffset);
        else if (myVotesOnly) items = await api.getUserVotes(api.user.id, state.feedCursor);
        else items = await api.getSchoolFeed(api.user.id, state.feedCursor);
        if (generation !== state.feedGeneration || feedType !== state.feedType || myVotesOnly !== state.myVotesOnly) return;
        state.feedItems.push(...items);
        if (feedType === "personal") state.feedOffset += items.length;
        else if (items.length) {
            const last = items.at(-1);
            state.feedCursor = { timestamp: last.timestamp, id: last.question_answer_id };
        }
        status.textContent = "";
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
    return `<button class="choice-button" type="button" data-choice="${escapeHTML(choice.user_id)}">${avatarMarkup(choice, "choice-avatar")}<span>${escapeHTML(displayName(choice))}</span></button>`;
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
            <button class="play-action-button" data-shuffle type="button">↻ Shuffle</button>
            <button class="play-action-button nominate" data-nominate type="button">♛ Nominate</button>
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
            renderProfileHeader();
        }
        $("#nominationDialog").close();
        showToast(`You nominated ${displayName(candidate)} 👑`);
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
    $$(".choice-button").forEach((button) => { button.disabled = true; });
    try {
        const result = await api.answerQuestion(api.user.id, {
            question_id: question.id,
            selected_contact_user_id: selected.user_id,
            selected_contact_name: displayName(selected),
            presented_options: choices.map((choice) => ({ phone: "", name: displayName(choice) })),
            is_nomination: false,
        });
        state.playAuraEarned += Math.max(0, Number(result.aura_points_earned || 0));
        if (state.profile && Number.isFinite(Number(result.total_aura_points))) {
            state.profile.aura_points = Number(result.total_aura_points);
            renderProfileHeader();
        }
        showToast(`You picked ${displayName(selected)} ✨`);
        softHaptic();
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
        <div class="ask-link-heading"><div><strong>${link.is_active ? "Your link is live" : "Your link is paused"}</strong><span>Let friends ask you something anonymously.</span></div><img class="ask-mascot" src="../assets/app/anonymous.png" alt=""></div>
        <div class="ask-url">${escapeHTML(link.share_url)}</div>
        <div class="button-row"><button class="mini-button" type="button" data-share-link>${navigator.share ? "Share link" : "Copy link"}</button><button class="mini-button" type="button" data-toggle-link>${link.is_active ? "Pause" : "Turn on"}</button><button class="mini-button" type="button" data-copy-link>Copy</button><button class="mini-button" type="button" data-rotate-link>New link</button></div>
    </article>`;
}

async function shareAskLink(forceCopy) {
    if (!state.askLink) return;
    try {
        if (!forceCopy && navigator.share) await navigator.share({ title: "Ask me on Valid", text: "Ask me anything anonymously", url: state.askLink.share_url });
        else {
            await navigator.clipboard.writeText(state.askLink.share_url);
            showToast("Ask me link copied");
        }
        api.trackAskShare(api.user.id, forceCopy ? "copy" : "other").catch(() => null);
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
    $("#profileBio").value = profile.bio || "";
    const grade = profile.grade || "Junior";
    const select = $("#profileGrade");
    if (![...select.options].some((option) => option.value === grade)) select.add(new Option(grade, grade));
    select.value = grade;
    const informationLocked = profile.can_change_information === false;
    [$("#profileFirstName"), $("#profileLastName"), $("#profileUsername"), $("#profileGrade")].forEach((field) => { field.disabled = informationLocked; });
    $("#profileEditHint").textContent = profile.can_change_information === false
        ? `Profile information can be changed again ${relativeTime(profile.next_information_change_at)}. Photo and bio can still be updated.`
        : "Name, username and grade share the iOS profile-information cooldown.";
    $("#profileEditStatus").textContent = "";
    $("#profileDialog").showModal();
}

async function saveProfile(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    const nextInfo = {
        first_name: $("#profileFirstName").value.trim(),
        last_name: $("#profileLastName").value.trim(),
        username: $("#profileUsername").value.trim().toLowerCase(),
        grade: $("#profileGrade").value,
        school_id: state.profile.school_id || null,
    };
    const bio = $("#profileBio").value.trim();
    const picture = $("#profilePicture").files[0];
    const infoChanged = ["first_name", "last_name", "username", "grade"].some((key) => nextInfo[key] !== (state.profile[key] || ""));
    const bioChanged = bio !== (state.profile.bio || "");
    setButtonLoading(button, true, "Saving...");
    $("#profileEditStatus").textContent = "";
    try {
        if (picture) await api.uploadProfilePicture(api.user.id, picture);
        if (bioChanged) state.profile = await api.updateBio(api.user.id, bio || null);
        if (infoChanged) state.profile = await api.updateInformation(api.user.id, nextInfo);
        if (picture) state.profile = await api.getProfile(api.user.id);
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

function openClassmatesDialog() {
    $("#classmatesStatus").textContent = contactsPickerSupported()
        ? ""
        : "This browser cannot open selected contacts. You can still share a private invite.";
    $("#chooseContactsButton").classList.toggle("hidden", !contactsPickerSupported());
    $("#classmatesDialog").showModal();
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
        if (event.target.closest("[data-signup-next]")) advanceSignup();
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
    $("#feedSearch").addEventListener("input", (event) => { state.feedSearch = event.currentTarget.value; renderFeed(); });
    $("#loadMoreFeed").addEventListener("click", () => loadFeed(false));
    $("#feedList").addEventListener("click", (event) => {
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
        if (event.target.closest("[data-share-feed-item]")) shareFeedItem();
        if (event.target.closest("[data-report-feed-item]")) moderateFeedItem("report");
        if (event.target.closest("[data-block-feed-submitter]")) moderateFeedItem("block");
    });
    $("#feedGateLock").addEventListener("click", (event) => { if (event.target.closest("[data-vote-to-unlock]")) switchPanel("play"); });
    $("#anonymousInboxList").addEventListener("click", (event) => {
        const question = event.target.closest("[data-anonymous-question]");
        if (question) openAnonymousQuestionDialog(question.dataset.anonymousQuestion);
    });
    $("#anonymousAnswerForm").addEventListener("submit", answerAnonymousQuestion);
    $("#anonymousQuestionDialog").addEventListener("click", (event) => {
        const action = event.target.closest("[data-anonymous-action]");
        if (action) handleAnonymousSafetyAction(action.dataset.anonymousAction);
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
        if (event.target.closest("[data-share-link]")) shareAskLink(false);
        if (event.target.closest("[data-copy-link]")) shareAskLink(true);
        if (event.target.closest("[data-toggle-link]")) toggleAskLink();
        if (event.target.closest("[data-rotate-link]")) rotateAskLink();
    });
    $("#profilePanel").addEventListener("click", (event) => { if (event.target.closest("[data-edit-profile]")) openProfileDialog(); });
    $("#editProfileButton").addEventListener("click", openProfileDialog);
    $("#findClassmatesButton").addEventListener("click", openClassmatesDialog);
    $("#chooseContactsButton").addEventListener("click", chooseContacts);
    $("#shareClassmateInviteButton").addEventListener("click", shareClassmateInvite);
    $("#profileSubmitQuestion").addEventListener("click", openQuestionDialog);
    $("#deleteAccountButton").addEventListener("click", openDeleteAccountDialog);
    $("#deleteAccountForm").addEventListener("submit", requestAccountDeletion);
    $("#cancelDeletionButton").addEventListener("click", cancelAccountDeletion);
    $("#pendingDeletionLogout").addEventListener("click", logoutAndReset);
    $("#installAppButton").addEventListener("click", installWebApp);
    $("#questionForm").addEventListener("submit", reviewQuestionSubmission);
    $("#questionForm").addEventListener("input", resetQuestionSubmissionIfDraftChanged);
    $("#questionForm").addEventListener("change", resetQuestionSubmissionIfDraftChanged);
    $("#confirmQuestionSubmit").addEventListener("click", confirmQuestionSubmission);
    $("#profileForm").addEventListener("submit", saveProfile);
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

bindEvents();
if (!navigator.onLine) updateNetworkStatus();
if ("serviceWorker" in navigator && !demoMode) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => null);
}
if (!passkeysSupported() && !demoMode) {
    $("#passkeyButton").disabled = true;
    $("#authStatus").textContent = "This browser does not support passkeys. Try current Chrome, Safari, or Edge.";
}
