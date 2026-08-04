import { ValidAPI } from "./api.js";
import { DemoAPI, localDemoAllowed } from "./demo-api.js";
import { passkeysSupported, signInWithPasskey } from "./passkeys.js";

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
    questions: [],
    classmates: [],
    questionIndex: 0,
    choicesByQuestion: new Map(),
    playLocked: null,
    inviteStatus: null,
    askLink: null,
    topQuestionsWeekly: null,
    topQuestionsAllTime: null,
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
        state.profile = await api.getProfile(api.user.id);
        renderProfileHeader();
        await loadFeed(true);
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
    try {
        const requests = [];
        if (!state.topQuestionsWeekly) requests.push(api.getTopQuestions(api.user.id, "weekly", 10).then((value) => { state.topQuestionsWeekly = value; }));
        if (!state.topQuestionsAllTime) requests.push(api.getTopQuestions(api.user.id, "all_time", 3).then((value) => { state.topQuestionsAllTime = value; }));
        if (!state.askLink) requests.push(api.getAskLink(api.user.id).then((value) => { state.askLink = value; }));
        await Promise.all(requests);
        $("#profileStatus").textContent = "";
        $("#askStatus").textContent = "";
        renderProfilePanel();
        renderAskLink();
    } catch (error) {
        $("#profileStatus").textContent = error.message || "Could not load all profile details.";
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
        return `<article class="feed-card" data-answer-id="${item.question_answer_id}">
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

async function loadFeed(reset = false) {
    if (reset) {
        state.feedItems = [];
        state.feedOffset = 0;
        state.feedCursor = null;
        renderFeed();
    }
    const status = $("#feedStatus");
    const loadMore = $("#loadMoreFeed");
    status.textContent = "Loading votes...";
    loadMore.classList.add("hidden");
    try {
        let items;
        if (state.feedType === "personal") items = await api.getPersonalFeed(api.user.id, state.feedOffset);
        else if (state.myVotesOnly) items = await api.getUserVotes(api.user.id, state.feedCursor);
        else items = await api.getSchoolFeed(api.user.id, state.feedCursor);
        state.feedItems.push(...items);
        if (state.feedType === "personal") state.feedOffset += items.length;
        else if (items.length) {
            const last = items.at(-1);
            state.feedCursor = { timestamp: last.timestamp, id: last.question_answer_id };
        }
        status.textContent = "";
        renderFeed();
        loadMore.classList.toggle("hidden", items.length < 20);
    } catch (error) {
        status.textContent = error.message || "Could not load the feed.";
    }
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
    const message = until ? `Unlocks ${relativeTime(until)}` : "New polls drop soon.";
    $("#playCard").innerHTML = `<article class="locked-play-card">
        <h3>Next Poll Set Locked</h3>
        <img class="lock-art" src="../assets/app/lock.png" alt="">
        <p>${escapeHTML(message)}</p>
        ${renderInviteUnlock()}
        <button class="question-secondary-action" type="button" data-open-question><img src="../assets/app/pencil-clipboard.png" alt="">Submit a school question</button>
    </article>`;
}

function renderPlay() {
    const card = $("#playCard");
    if (state.playLocked) return renderLockedPlay();
    const question = state.questions[state.questionIndex];
    $("#playProgress").textContent = state.questions.length ? `Question ${Math.min(state.questionIndex + 1, state.questions.length)} of ${state.questions.length}` : "";
    if (!question) {
        state.playLocked = {};
        renderLockedPlay();
        return;
    }
    const choices = choicesForQuestion(question);
    if (choices.length < 4) {
        card.innerHTML = `<div class="empty-card locked-card"><img class="empty-state-art" src="../assets/app/lock.png" alt=""><strong>Add more classmates to play Valid.</strong><span>You need at least four classmates before a poll can start.</span><button class="primary-button" type="button" data-invite-unlock>Invite classmates</button></div>`;
        return;
    }
    const artworkURL = api.assetURL(question.image_url);
    const attribution = question.is_user_submitted ? `<div class="question-attribution">${question.is_anonymous ? avatarMarkup({ first_name: "Anonymous", profile_picture_url: "../assets/app/anonymous.png" }, "attribution-avatar") : avatarMarkup({ first_name: question.submitted_by_name || "A classmate", profile_picture_url: question.submitted_by_avatar_url }, "attribution-avatar")}<span><small>Question submitted by</small><strong>${escapeHTML(question.is_anonymous ? "Someone at your school" : question.submitted_by_name || "A classmate")}</strong></span></div>` : "";
    card.innerHTML = `<article class="play-card">
        <h3>${escapeHTML(question.question_text)}</h3>
        ${attribution}
        <div class="question-artwork">${artworkURL ? `<img src="${escapeHTML(artworkURL)}" alt="">` : `<div class="artwork-placeholder"><img src="../assets/app/pencil-clipboard.png" alt=""><span>Question artwork</span></div>`}</div>
        <div class="choice-grid">${choices.map(choiceMarkup).join("")}</div>
        <div class="play-actions"><button class="skip-button" data-skip="${question.id}" type="button">Skip this question</button></div>
    </article>`;
}

async function loadPlay() {
    if (state.questions.length || state.playLocked) return renderPlay();
    $("#playStatus").textContent = "Finding questions and classmates...";
    try {
        const [questionBatch, classmates, inviteStatus] = await Promise.all([
            api.getPlayQuestions(api.user.id),
            api.getClassmates(api.user.id),
            api.getInviteStatus(api.user.id).catch(() => null),
        ]);
        state.questions = questionBatch.questions || [];
        state.classmates = classmates || [];
        state.inviteStatus = inviteStatus;
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

async function answerPlayQuestion(choiceId) {
    const question = state.questions[state.questionIndex];
    const choices = choicesForQuestion(question);
    const selected = choices.find((choice) => String(choice.user_id) === choiceId);
    if (!selected) return;
    $$(".choice-button").forEach((button) => { button.disabled = true; });
    try {
        await api.answerQuestion(api.user.id, {
            question_id: question.id,
            selected_contact_user_id: selected.user_id,
            selected_contact_name: displayName(selected),
            presented_options: choices.map((choice) => ({ phone: "", name: displayName(choice) })),
            is_nomination: false,
        });
        showToast(`You picked ${displayName(selected)} ✨`);
        state.questionIndex += 1;
        renderPlay();
        refreshProfile();
    } catch (error) {
        showToast(error.message || "Could not save your answer.");
        renderPlay();
    }
}

async function skipPlayQuestion(questionId) {
    try {
        await api.skipQuestion(api.user.id, questionId);
        state.questionIndex += 1;
        renderPlay();
    } catch (error) {
        showToast(error.message || "Could not skip that question.");
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
        api.trackAskShare(api.user.id, forceCopy ? "copy" : "web_share").catch(() => null);
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

async function submitQuestion(event) {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    const image = $("#questionImage").files[0];
    if (!image) {
        $("#questionStatus").textContent = "Please attach artwork before submitting.";
        return;
    }
    const formData = new FormData();
    formData.set("question_text", $("#questionText").value.trim());
    formData.set("include_name", String($("input[name=questionIdentity]:checked").value === "named"));
    formData.set("idempotency_key", crypto.randomUUID());
    formData.set("image", image);
    setButtonLoading(button, true, "Submitting...");
    $("#questionStatus").textContent = "";
    try {
        await api.submitQuestion(api.user.id, formData);
        event.currentTarget.reset();
        $("#questionDialog").close();
        refreshProfile();
        showToast("Question sent for review ✨");
    } catch (error) {
        $("#questionStatus").textContent = error.message || "Could not submit your question.";
    } finally { setButtonLoading(button, false); }
}

function openQuestionDialog() {
    $("#questionStatus").textContent = "";
    $("#questionDialog").showModal();
}

function switchPanel(panel) {
    state.activePanel = panel;
    $$(".panel").forEach((element) => element.classList.add("hidden"));
    $(`#${panel}Panel`).classList.remove("hidden");
    $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.panel === panel));
    scrollTo({ top: 0, behavior: "smooth" });
    if (panel === "play") loadPlay();
    if (panel === "profile") loadProfilePanel();
}

function bindEvents() {
    $("#passkeyButton").addEventListener("click", handlePasskeySignIn);
    $("#logoutButton").addEventListener("click", async () => {
        await api.logout().catch(() => null);
        api.clearSession();
        location.reload();
    });
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
    $("#feedList").addEventListener("click", (event) => { const button = event.target.closest("[data-upvote]"); if (button) toggleUpvote(button); });
    $$(".nav-item").forEach((button) => button.addEventListener("click", () => switchPanel(button.dataset.panel)));
    $("#playCard").addEventListener("click", (event) => {
        const choice = event.target.closest("[data-choice]");
        const skip = event.target.closest("[data-skip]");
        const invite = event.target.closest("[data-invite-unlock]");
        if (choice) answerPlayQuestion(choice.dataset.choice);
        if (skip) skipPlayQuestion(Number(skip.dataset.skip));
        if (invite) inviteAndUnlock(invite);
        if (event.target.closest("[data-open-question]")) openQuestionDialog();
    });
    $("#askLinkCard").addEventListener("click", (event) => {
        if (event.target.closest("[data-share-link]")) shareAskLink(false);
        if (event.target.closest("[data-copy-link]")) shareAskLink(true);
        if (event.target.closest("[data-toggle-link]")) toggleAskLink();
        if (event.target.closest("[data-rotate-link]")) rotateAskLink();
    });
    $("#profilePanel").addEventListener("click", (event) => { if (event.target.closest("[data-edit-profile]")) openProfileDialog(); });
    $("#editProfileButton").addEventListener("click", openProfileDialog);
    $("#profileSubmitQuestion").addEventListener("click", openQuestionDialog);
    $("#questionForm").addEventListener("submit", submitQuestion);
    $("#profileForm").addEventListener("submit", saveProfile);
    $$("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
    addEventListener("valid:session-expired", () => showSignedOut("Your session expired. Sign in with your passkey again."));
}

bindEvents();
if ("serviceWorker" in navigator && !demoMode) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => null);
}
if (!passkeysSupported() && !demoMode) {
    $("#passkeyButton").disabled = true;
    $("#authStatus").textContent = "This browser does not support passkeys. Try current Chrome, Safari, or Edge.";
}
