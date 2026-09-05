import { reconcileKeyedElements } from "../keyed-list.js";
import { createStoriesView } from "../stories/index.js";

export async function activate({ isCurrent, refreshGate, isLocked, hasItems, load }) {
    await refreshGate();
    if (isCurrent() && !isLocked() && !hasItems()) await load(true);
}

export function createFeedView(context) {
    const {
        $, $$, state, api, personalInboxFilters,
        avatarMarkup, displayName, escapeHTML, formatGrade, relativeTime,
        normalizeReactionState, dominantReaction, promptForKey, tbhAuthorLine,
        tbhRequestsEnabled, renderTabBadges, showToast,
    } = context;
    const storiesView = state.config?.enable_stories === true && state.config?.enable_web_stories === true
        ? createStoriesView({ root: $("#storiesRoot"), api, getUser: () => api.user, escapeHTML, showToast })
        : null;

    const reactionControlMarkup = (item, targetType, targetId) => {
        normalizeReactionState(item);
        const displayed = dominantReaction(item);
        const selected = context.reactionByType.get(item.current_user_reaction);
        const canReact = item.can_react !== false && Boolean(targetId);
        const target = `${targetType}:${targetId}`;
        return `<span class="reaction-control ${selected ? "selected" : ""} ${canReact ? "" : "disabled"}" data-reaction-control="${escapeHTML(target)}"><button class="reaction-picker-button" type="button" data-reaction-picker="${escapeHTML(target)}" aria-label="${escapeHTML(selected ? `Your reaction is ${selected.label}. Change reaction` : "React")}" ${canReact ? "" : "disabled"}>${displayed ? `<span aria-hidden="true">${displayed.emoji}</span>` : `<span aria-hidden="true">☺</span>`}</button><span class="reaction-divider" aria-hidden="true"></span><button class="reaction-count-button" type="button" data-reactors="${escapeHTML(target)}" aria-label="View ${Number(item.reaction_count || 0)} reactions">${Number(item.reaction_count || 0)}</button></span>`;
    };
    const tbhAvatarMarkup = (profile, request = false) => `<span class="tbh-avatar-shell ${request ? "request" : "response"}">${avatarMarkup(profile, "row-avatar tbh-avatar")}<span class="tbh-avatar-badge" aria-hidden="true">${request ? "TBH" : "❞"}</span></span>`;
    const feedAvatar = (item) => state.feedType === "personal" ? avatarMarkup(state.profile) : avatarMarkup({ first_name: item.voted_for_name || item.contact_name || "Student", profile_picture_url: item.voted_for_profile_picture_url });

    function pendingTbhRows() {
        if (state.feedType !== "personal" || !tbhRequestsEnabled() || state.feedSearch.trim()) return [];
        return state.tbhPendingRequests.map((request) => ({ key: `tbh-request:${request.id}`, timestamp: request.created_at, html: `<article class="tbh-row tbh-request-row ${request.opened_at ? "" : "unread"}"><button class="tbh-row-main" type="button" data-tbh-request="${escapeHTML(request.id)}">${tbhAvatarMarkup({ first_name: request.requester_first_name, last_name: request.requester_last_name, profile_picture_url: request.requester_profile_picture_url }, true)}<span class="tbh-row-copy"><span><strong>${escapeHTML(request.requester_first_name)} wants a TBH</strong>${request.opened_at ? "" : `<i aria-label="Unread"></i>`}</span><small>${escapeHTML(promptForKey(request.prompt_key).title)}</small></span></button><details class="tbh-row-menu"><summary aria-label="More options for ${escapeHTML(request.requester_first_name)}'s TBH request">•••</summary><span><button type="button" data-tbh-dismiss="${escapeHTML(request.id)}">Dismiss request</button><button type="button" data-tbh-suppress="${escapeHTML(request.requester_user_id)}">Stop requests from ${escapeHTML(request.requester_first_name)}</button></span></details></article>` }));
    }

    function tbhFeedRows(items, kind) {
        return items.map((item) => {
            const received = kind === "received";
            const school = kind === "school";
            const firstName = received ? item.author_first_name : item.subject_first_name;
            const lastName = received ? item.author_last_name : item.subject_last_name;
            const picture = received ? item.author_profile_picture_url : item.subject_profile_picture_url;
            const title = received ? `<strong>${escapeHTML(`${firstName} ${lastName}`)}</strong> sent your TBH` : school ? `<strong>${escapeHTML(`${firstName} ${lastName}`)}</strong> got a TBH` : `<strong>${escapeHTML(`${firstName} ${lastName}`)}</strong> got your TBH`;
            const detail = school ? tbhAuthorLine(item) : promptForKey(item.prompt_key).title;
            return { key: `tbh-${kind}:${item.id}`, timestamp: item.created_at, item, html: `<article class="feed-card tbh-row tbh-feed-row tbh-${kind}" data-tbh-detail="${escapeHTML(`${kind}:${item.id}`)}" role="button" tabindex="0" aria-label="Open TBH details">${tbhAvatarMarkup({ first_name: firstName, last_name: lastName, profile_picture_url: picture })}<div class="tbh-feed-copy"><div class="tbh-feed-title">${title}</div><div class="tbh-feed-body">${escapeHTML(item.body)}</div><div class="tbh-feed-meta"><span>${escapeHTML(detail)}</span><time>${escapeHTML(relativeTime(item.created_at))}</time></div></div>${reactionControlMarkup(item, "activity", item.activity_id)}</article>` };
        });
    }

    function schoolHotScore(entry) {
        const item = entry.item;
        normalizeReactionState(item);
        const total = Number(item.reaction_count || 0);
        const negative = Number(item.reaction_summary?.thumbs_down || 0);
        const positive = Math.max(0, total - negative);
        const hours = Math.max(0, (Date.now() - (Date.parse(entry.timestamp) || Date.now())) / 3_600_000);
        return (positive * 2 + total) / Math.pow(hours + 2, 1.15);
    }

    function anonymousInboxRows() {
        if (state.feedType !== "personal" || !state.anonymousInbox || state.feedSearch.trim()) return [];
        const answers = (state.anonymousInbox.answers || []).map((answer) => ({ key: `ask-answer:${answer.id}`, timestamp: answer.answered_at, html: `<button class="anonymous-reply-row" type="button" data-anonymous-answer="${escapeHTML(answer.id)}">${avatarMarkup({ first_name: answer.recipient_display_name, profile_picture_url: answer.recipient_profile_picture_url }, "anonymous-row-icon reply")}<span class="anonymous-row-copy"><strong>${escapeHTML(answer.recipient_display_name)} replied to you</strong><span class="anonymous-row-message">${escapeHTML(answer.answer_text)}</span><span class="anonymous-row-meta"><span>Your message: ${escapeHTML(answer.question_body)}</span><time>${escapeHTML(relativeTime(answer.answered_at))}</time></span></span><span class="anonymous-row-state" aria-hidden="true">›</span></button>` }));
        const questions = (state.anonymousInbox.questions || []).map((question) => ({ key: `ask-question:${question.id}`, timestamp: question.created_at, html: `<button class="anonymous-question-row ${question.opened_at ? "" : "unread"} ${question.status === "answered" ? "answered" : ""}" type="button" data-anonymous-question="${escapeHTML(question.id)}"><span class="anonymous-row-icon" aria-hidden="true">?</span><span class="anonymous-row-copy"><span class="anonymous-row-title"><strong>${escapeHTML(question.provenance_label)}</strong>${question.opened_at ? "" : `<span class="anonymous-new-pill">New</span>`}</span><span class="anonymous-row-message">${escapeHTML(question.body)}</span><span class="anonymous-row-meta"><span>${escapeHTML(question.source_platform ? `From ${question.source_platform[0].toUpperCase()}${question.source_platform.slice(1)}` : "Anonymous")}</span><time>${escapeHTML(relativeTime(question.created_at))}</time></span></span><span class="anonymous-row-state" aria-hidden="true">›</span></button>` }));
        return [...answers, ...questions];
    }

    function personalInboxUnreadCounts() {
        const polls = state.feedItems.filter((item) => item.is_new === true || item.unread === true).length;
        const tbhs = state.tbhPendingRequests.filter((item) => !item.opened_at).length + state.tbhInboxItems.filter((item) => !item.opened_at).length;
        const askMe = (state.anonymousInbox?.questions || []).filter((item) => !item.opened_at).length;
        return { all: polls + tbhs + askMe, polls, tbhs, ask_me: askMe };
    }

    function renderPersonalInboxControls() {
        const controls = $("#personalInboxControls");
        const visible = state.feedType === "personal" && !state.feedSearch.trim();
        controls.classList.toggle("hidden", !visible);
        if (!visible) return;
        if (!personalInboxFilters[state.personalInboxFilter]) state.personalInboxFilter = "all";
        const counts = personalInboxUnreadCounts();
        $$('[data-inbox-filter]').forEach((button) => {
            const filter = button.dataset.inboxFilter;
            const selected = filter === state.personalInboxFilter;
            button.classList.toggle("active", selected);
            button.setAttribute("aria-pressed", String(selected));
            const badge = button.querySelector("[data-inbox-count]");
            const count = counts[filter] || 0;
            badge.textContent = count > 99 ? "99+" : String(count || "");
            badge.classList.toggle("hidden", count < 1);
        });
        $("#personalInboxDescription").textContent = personalInboxFilters[state.personalInboxFilter].description;
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

    function renderFeed() {
        void storiesView?.activate();
        const list = $("#feedList");
        const query = state.feedSearch.trim().toLowerCase();
        renderPersonalInboxControls();
        renderFeedClassmateResults();
        const visible = query ? state.feedItems.filter((item) => [item.question_text, item.voted_for_name, item.contact_name, item.voter_name].some((value) => String(value || "").toLowerCase().includes(query))) : state.feedItems;
        const appliesPersonalFilter = state.feedType === "personal" && !query;
        const showPolls = !appliesPersonalFilter || ["all", "polls"].includes(state.personalInboxFilter);
        const showTbhs = !appliesPersonalFilter || ["all", "tbhs"].includes(state.personalInboxFilter);
        const showAskMe = !appliesPersonalFilter || ["all", "ask_me"].includes(state.personalInboxFilter);
        const anonymousRows = showAskMe ? anonymousInboxRows() : [];
        const personalTbhRows = state.feedType === "personal" && !query && showTbhs ? [...pendingTbhRows(), ...tbhFeedRows(state.tbhInboxItems, "received"), ...tbhFeedRows(state.tbhSentItems, "sent")] : [];
        const schoolTbhRows = state.feedType === "school" && !query && state.schoolFeedContent !== "my_votes" ? tbhFeedRows(state.schoolTbhItems, "school") : [];
        const filteredVotes = (state.feedType === "school" && state.schoolFeedContent === "tbhs") || !showPolls ? [] : visible;
        if (!filteredVotes.length && !anonymousRows.length && !personalTbhRows.length && !schoolTbhRows.length) {
            const emptyState = query ? { title: "No results found", message: "Try searching for a name or question." } : state.schoolFeedContent === "tbhs" ? { title: "No TBHs yet", message: "Public TBHs from your school will show up here." } : state.myVotesOnly ? { title: "You haven't voted yet", message: "Answer some questions in the Play tab to see your votes here." } : state.feedType === "personal" ? { title: state.personalInboxFilter === "all" ? "Nothing in your Inbox yet" : `No ${personalInboxFilters[state.personalInboxFilter].title} yet`, message: personalInboxFilters[state.personalInboxFilter].empty } : { title: "No school activity yet", message: "As students at your school answer questions, activity will appear here." };
            list.innerHTML = `<div class="feed-empty-state"><span class="feed-empty-art" aria-hidden="true"><svg viewBox="0 0 160 120"><path d="M22 36 80 76l58-40v54a12 12 0 0 1-12 12H34a12 12 0 0 1-12-12Z"/><path d="m22 36 58-22 58 22-58 40Z"/><path d="m22 96 41-34M138 96 97 62"/></svg></span><strong>${escapeHTML(emptyState.title)}</strong><p>${escapeHTML(emptyState.message)}</p></div>`;
            renderTabBadges();
            return;
        }
        const voteRows = filteredVotes.map((item) => {
            normalizeReactionState(item);
            const title = state.feedType === "personal" ? `${item.is_nomination ? "👑 " : ""}<strong>You</strong> got ${item.is_nomination ? "nominated" : "voted"}` : `<strong>${escapeHTML(item.voted_for_name || item.contact_name || "A classmate")}</strong> got voted`;
            const detail = context.formatVoterHint(item);
            return { key: `poll:${item.question_answer_id}`, timestamp: item.timestamp, item, html: `<article class="feed-card vote-feed-row" data-answer-id="${item.question_answer_id}" data-feed-detail="${item.question_answer_id}" role="button" tabindex="0" aria-label="Open poll details: ${escapeHTML(item.question_text)}">${feedAvatar(item)}<div class="feed-body"><div class="feed-meta"><span>${title}</span></div><div class="feed-question">${escapeHTML(item.question_text)}</div><div class="feed-detail-row">${detail ? `<span class="feed-answer">${escapeHTML(detail)}</span>` : "<span></span>"}<time>${escapeHTML(relativeTime(item.timestamp))}</time></div></div>${reactionControlMarkup(item, "poll", item.question_answer_id)}</article>` };
        });
        const rows = [...anonymousRows, ...personalTbhRows, ...schoolTbhRows, ...voteRows];
        const sortedRows = rows.sort((left, right) => state.feedType === "school" && state.schoolFeedSort === "hottest" ? schoolHotScore(right) - schoolHotScore(left) : (Date.parse(right.timestamp) || 0) - (Date.parse(left.timestamp) || 0));
        reconcileKeyedElements(list, sortedRows);
        renderTabBadges();
    }

    return { renderFeed, renderFeedClassmateResults, refreshStories: () => storiesView?.refresh() };
}
