// Send To: where a capture goes after review (CaptureSendSheet,
// SendToRecipientList) and who gets a Memento from the Camera tab
// (MementoAudiencePicker). It only picks: chats to start with people are
// started here, and the caller queues the sends once it resolves.
//
//   const choice = await openSendTo({ api, userId, config, mode: "capture", startsWithStory: true });
//   if (choice) queue(choice.story, choice.tags, choice.chatIds);
import { uiIcon } from "../ui-icons.js";
import { mediaImageMarkup } from "../media-url.js";
import { escapeChatHTML as escapeHTML, isGroupChatSummary, normalizeChat, safeMediaURL, streakAtRisk, streakBroken, streakTimeLeft } from "../chat/models.js";
import { streakLabelMarkup } from "../chat/inbox-status.js";
import { chatPersonSubtitle, mergeChatPeople } from "../chat/people.js";
import { userMessage } from "../user-message.js";

// StoryTags.limit (CaptionMention.swift).
export const STORY_TAG_LIMIT = 5;
const BEST_FRIENDS_LIMIT = 6;
const START_CHAT_CONCURRENCY = 6;
const CAPTURE_CHAT_PAGES = 5;
const MEMENTO_CHAT_PAGES = 10;
const CHAT_PAGE_SIZE = 100;

// MementoAudienceLimits: /config daily_entry_max_audience_chats, clamped to
// 1...500; builds before that field used 10.
export function mementoAudienceCap(config) {
    const value = Number(config?.daily_entry_max_audience_chats);
    if (!Number.isFinite(value) || value <= 0) return 10;
    return Math.max(1, Math.min(500, Math.floor(value)));
}

// The send bar of the shoot-first sheet (CaptureSendSheet.sendTitle).
export function captureSendTitle({ story, count, lastName }) {
    if (!story && count === 0) return "Choose where to send";
    if (story && count === 0) return "Post to My Story";
    const target = count === 1 && lastName ? lastName : String(count);
    return story ? `Post + send to ${target}` : `Send to ${target}`;
}

// MementoAudiencePicker.sendTitle.
export function mementoSendTitle({ chats, people }) {
    if (chats.length === 1 && !people.length) return `Send to ${chats[0].display_name}`;
    if (people.length === 1 && !chats.length) return `Send to ${people[0].first || "1 friend"}`;
    if (!chats.length && !people.length) return "Choose where to send";
    return `Send to ${chats.length + people.length}`;
}

// Six7SendButton.summary: "A, B, C" or "A, B +3" over the pill.
export function sendSummary(names) {
    if (names.length < 2) return "";
    return names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

const activity = (chat) => Math.max(...[chat.last_message_at, chat.unacknowledged_missed_call_at].map((value) => Date.parse(value) || 0))
    || Date.parse(chat.updated_at) || 0;
const normalizedQuery = (value) => String(value || "").trim().toLowerCase().replace(/^@/, "");

let sheetSequence = 0;

/**
 * @param {object} options
 * @param {"capture"|"memento"} options.mode capture: My Story + chats + people; memento: chats only, today's rules.
 * @param {object|null} options.keptChat the chat camera's own chat: pre-ticked, cannot be unticked.
 * @param {boolean} options.chatsViewOnce the caption under the bar: "Chats open once" or "Stays in the chats".
 * @param {boolean} options.showsChatsCaption shows that caption once a chat is chosen (keptChat always shows it).
 * @param {boolean} options.startsWithStory My Story starts ticked (the Story rail's +).
 * @param {boolean} options.allowsStory /config allows Stories.
 * @param {boolean} options.allowsChats /config allows chats.
 * @param {Set<string>} options.postedChatIds chats this device already sent today's Memento to.
 * @returns {Promise<{ story: boolean, tags: string[], chatIds: string[], chats: object[] } | null>}
 */
export function openSendTo({
    api, userId, config = null, mode = "capture", keptChat = null, chatsViewOnce = true, startsWithStory = false,
    allowsStory = false, allowsChats = true, postedChatIds = new Set(), haptic = null, showsChatsCaption = false,
} = {}) {
    const memento = mode === "memento";
    const id = `send-to-${++sheetSequence}`;
    const cap = memento ? mementoAudienceCap(config) : Infinity;
    const kept = keptChat ? normalizeChat(keptChat) : null;
    const state = {
        loading: true, error: "", query: "", working: false,
        chats: kept ? [kept] : [], people: [], classmates: [], blocked: new Set(),
        story: !memento && allowsStory && startsWithStory, tags: [],
        chosenChats: new Set(kept ? [kept.id] : []), chosenPeople: new Set(),
        // Pick order, for "Send to Maya" (the last name chosen).
        order: kept ? [`chat:${kept.id}`] : [],
        // Chats started for people on an earlier attempt, kept for a retry.
        started: new Map(), requestIds: new Map(),
    };
    const dialog = document.createElement("dialog");
    dialog.className = "send-to-sheet";
    dialog.setAttribute("aria-labelledby", `${id}-title`);
    dialog.innerHTML = `
        <div class="send-to-content">
            <header class="send-to-header"><button type="button" class="send-to-cancel" data-send-to-cancel>Cancel</button><h2 id="${id}-title">Send to</h2><span aria-hidden="true"></span></header>
            <div class="send-to-scroll">
                <div class="send-to-story-slot"></div>
                <label class="send-to-search"><span aria-hidden="true">${uiIcon("search")}</span><input type="search" placeholder="Search chats and people" aria-label="Search chats and people" autocomplete="off" enterkeyhint="search"><button type="button" data-send-to-clear aria-label="Clear search" hidden>${uiIcon("close")}</button></label>
                <div class="send-to-list" aria-live="polite"></div>
            </div>
            <footer class="send-to-bar">
                <p class="send-to-summary" hidden></p>
                <button type="button" class="send-to-send" data-send-to-confirm disabled><span class="send-to-send-title"></span><span class="send-to-send-disc" aria-hidden="true">${uiIcon("send")}</span></button>
                <p class="send-to-caption" hidden></p>
            </footer>
        </div>`;
    const $ = (selector) => dialog.querySelector(selector);
    const search = $(".send-to-search input");

    const chatById = () => new Map(state.chats.map((chat) => [chat.id, chat]));
    const personById = () => new Map(state.people.map((person) => [person.id, person]));
    const isKept = (chat) => Boolean(kept) && chat.id === kept.id;
    // MementoAudience: a chat that already has today's Memento stays listed, disabled.
    const unavailableReason = (chat) => (memento && !isKept(chat) && (chat.has_posted_today_memento || postedChatIds.has(chat.id)) ? "Already shared today" : "");
    const selectable = (chat) => !unavailableReason(chat);
    const chosenCount = () => state.chosenChats.size + state.chosenPeople.size;
    const full = () => chosenCount() >= cap;

    function sections() {
        const query = normalizedQuery(state.query);
        const chats = state.chats;
        if (query) {
            const chatMatches = chats.filter((chat) => chat.display_name.toLowerCase().includes(query));
            const peopleMatches = state.people.filter((person) => [person.name, person.username, person.school].some((value) => String(value || "").toLowerCase().includes(query)));
            return [
                { key: "recent", title: "Recent chats", chats: orderRecent(chatMatches) },
                { key: "people", title: chatMatches.length ? "Start a chat with" : "People", people: peopleMatches },
            ];
        }
        const now = new Date();
        // SendToOrdering.endingTonight: broken, or at risk inside the last four hours.
        const streaks = chats.filter((chat) => !isKept(chat) && selectable(chat)
            && (streakBroken(chat) || (streakAtRisk(chat) && streakTimeLeft(true, now) != null)))
            .sort((a, b) => Number(b.moment_streak || 0) - Number(a.moment_streak || 0));
        const inStreaks = new Set(streaks.map((chat) => chat.id));
        const best = chats.filter((chat) => !isKept(chat) && selectable(chat) && !inStreaks.has(chat.id)
            && Number(chat.accepted_count) >= 2 && Number(chat.moment_streak || 0) >= 3)
            .sort((a, b) => Number(b.moment_streak || 0) - Number(a.moment_streak || 0) || activity(b) - activity(a))
            .slice(0, BEST_FRIENDS_LIMIT);
        const listed = new Set([...inStreaks, ...best.map((chat) => chat.id)]);
        const recent = orderRecent(chats.filter((chat) => !listed.has(chat.id)));
        return [
            { key: "streaks", title: "Save your streaks", chats: streaks },
            { key: "best", title: "Best friends", chats: best },
            { key: "recent", title: "Recent chats", chats: recent, selectAll: memento },
            { key: "people", title: recent.length ? "Start a chat with" : "People", people: state.people },
        ];
    }

    function orderRecent(chats) {
        return [...chats].sort((a, b) => Number(isKept(b)) - Number(isKept(a))
            || Number(selectable(b)) - Number(selectable(a))
            || activity(b) - activity(a)
            || String(a.id).localeCompare(String(b.id)));
    }

    // Select all covers Save your streaks, Best friends and Recent chats, in list order.
    function selectAllIds() {
        return sections().filter((section) => section.chats).flatMap((section) => section.chats).filter(selectable).map((chat) => chat.id);
    }

    function avatar(name, url) {
        const image = safeMediaURL(url, api);
        const initial = escapeHTML(String(name || "?").slice(0, 1).toUpperCase());
        return `<span class="send-to-avatar" aria-hidden="true">${image ? mediaImageMarkup(image, { initials: initial }) : `<span>${initial}</span>`}</span>`;
    }

    function chatAvatar(chat) {
        const member = chat.member_previews?.[0];
        return avatar(chat.display_name, chat.chat_photo_url || chat.pair_profile_picture_url || member?.profile_picture_url);
    }

    const mark = (selected) => `<span class="send-to-mark ${selected ? "selected" : ""}" aria-hidden="true">${uiIcon(selected ? "checkmark-circle-filled" : "circle-outline")}</span>`;

    function chatRow(chat) {
        const selected = state.chosenChats.has(chat.id);
        const reason = unavailableReason(chat);
        const subtitle = reason || (isKept(chat) ? "You’re here" : isGroupChatSummary(chat) ? "Group" : "");
        const disabled = Boolean(reason) || (!selected && full());
        return `<button type="button" class="send-to-row ${selected ? "selected" : ""}" data-send-to-chat="${escapeHTML(chat.id)}" aria-pressed="${selected}" aria-label="${escapeHTML(chat.display_name)}" aria-description="${selected ? "Selected" : "Not selected"}"${disabled ? " disabled" : ""}>${chatAvatar(chat)}<span class="send-to-row-copy"><strong>${escapeHTML(chat.display_name)}</strong>${subtitle ? `<small>${escapeHTML(subtitle)}</small>` : ""}</span>${streakLabelMarkup(chat)}${mark(selected)}</button>`;
    }

    function personRow(person) {
        const selected = state.chosenPeople.has(person.id);
        const disabled = !selected && full();
        return `<button type="button" class="send-to-row ${selected ? "selected" : ""}" data-send-to-person="${escapeHTML(person.id)}" aria-pressed="${selected}" aria-label="${escapeHTML(person.name)}" aria-description="${selected ? "Selected" : "Not selected"}"${disabled ? " disabled" : ""}>${avatar(person.name, person.avatar)}<span class="send-to-row-copy"><strong>${escapeHTML(person.name)}</strong><small>${escapeHTML(chatPersonSubtitle(person, true))}</small></span>${mark(selected)}</button>`;
    }

    function renderStory() {
        const slot = $(".send-to-story-slot");
        if (memento || !allowsStory) { slot.innerHTML = ""; return; }
        const tags = state.tags.length;
        slot.innerHTML = `<button type="button" class="send-to-row send-to-story ${state.story ? "selected" : ""}" data-send-to-story aria-pressed="${state.story}" aria-label="My Story" aria-description="${state.story ? "Selected" : "Not selected"}"><span class="send-to-avatar send-to-story-icon" aria-hidden="true">${uiIcon("circle-dashed")}</span><span class="send-to-row-copy"><strong>My Story</strong><small>Your school sees it for 24 hours</small></span>${mark(state.story)}</button>${state.story ? `<button type="button" class="send-to-tag-row" data-send-to-tags>${uiIcon("person-badge-plus")}<span>${tags ? `Tagged ${tags}` : "Tag classmates"}</span>${uiIcon("next")}</button>` : ""}`;
    }

    function renderList() {
        const list = $(".send-to-list");
        if (state.loading && !state.chats.length && !state.people.length) {
            list.innerHTML = `<p class="send-to-empty">Loading…</p>`;
            return;
        }
        const groups = sections().filter((section) => (section.chats || section.people).length);
        if (!groups.length) {
            list.innerHTML = `<p class="send-to-empty">${state.error ? escapeHTML(state.error) : state.query.trim() ? "No matches." : "No one to send to yet."}</p>`;
            return;
        }
        const allIds = memento ? selectAllIds() : [];
        const allChosen = allIds.length > 0 && allIds.every((chatId) => state.chosenChats.has(chatId));
        list.innerHTML = groups.map((section) => {
            const rows = section.chats ? section.chats.map(chatRow) : section.people.map(personRow);
            const selectAll = section.selectAll && allIds.length > 1
                ? `<button type="button" class="send-to-select-all" data-send-to-select-all="${allChosen ? "off" : "on"}">${allChosen ? "Deselect all" : "Select all"}</button>` : "";
            return `<section class="send-to-section" aria-label="${escapeHTML(section.title)}"><header><h3>${escapeHTML(section.title)}</h3>${selectAll}</header>${rows.join("")}</section>`;
        }).join("") + (Number.isFinite(cap) && full() ? `<p class="send-to-cap">You can send to ${cap} at a time.</p>` : "");
    }

    function chosen() {
        const chats = chatById(), people = personById();
        return {
            chats: [...state.chosenChats].map((chatId) => chats.get(chatId)).filter(Boolean),
            people: [...state.chosenPeople].map((personId) => people.get(personId)).filter(Boolean),
        };
    }

    function chosenNames() {
        const chats = chatById(), people = personById();
        return state.order.map((key) => {
            const [kind, value] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
            if (kind === "chat") return state.chosenChats.has(value) ? chats.get(value)?.display_name : null;
            return state.chosenPeople.has(value) ? (memento ? people.get(value)?.first : people.get(value)?.name) : null;
        }).filter(Boolean);
    }

    function renderBar() {
        const { chats, people } = chosen();
        const count = chats.length + people.length;
        const names = chosenNames();
        const title = state.working
            ? (memento ? "Starting chats…" : "Sending…")
            : memento ? mementoSendTitle({ chats, people }) : captureSendTitle({ story: state.story, count, lastName: names.at(-1) });
        $(".send-to-send-title").textContent = title;
        $("[data-send-to-confirm]").disabled = state.working || !(state.story || count > 0);
        $("[data-send-to-confirm]").setAttribute("aria-busy", String(state.working));
        const summary = sendSummary([...(state.story ? ["My Story"] : []), ...names]);
        $(".send-to-summary").textContent = summary;
        $(".send-to-summary").hidden = !summary;
        const caption = $(".send-to-caption");
        caption.hidden = memento || !(kept || (showsChatsCaption && count > 0));
        caption.textContent = chatsViewOnce ? "Chats open once" : "Stays in the chats";
        $("[data-send-to-cancel]").disabled = state.working;
    }

    function render() {
        renderStory();
        renderList();
        renderBar();
        $("[data-send-to-clear]").hidden = !state.query;
    }

    function toggleChat(chatId) {
        const chat = chatById().get(chatId);
        if (!chat || !selectable(chat) || state.working) return;
        if (isKept(chat)) { haptic?.("light"); return; }
        if (state.chosenChats.has(chatId)) state.chosenChats.delete(chatId);
        else if (!full()) { state.chosenChats.add(chatId); state.order.push(`chat:${chatId}`); }
        haptic?.("selection");
        render();
    }

    function togglePerson(personId) {
        if (state.working) return;
        if (state.chosenPeople.has(personId)) state.chosenPeople.delete(personId);
        else if (!full()) { state.chosenPeople.add(personId); state.order.push(`person:${personId}`); }
        haptic?.("selection");
        render();
    }

    function selectAll(on) {
        if (on) {
            for (const chatId of selectAllIds()) {
                if (full()) break;
                if (!state.chosenChats.has(chatId)) { state.chosenChats.add(chatId); state.order.push(`chat:${chatId}`); }
            }
        } else {
            state.chosenChats = new Set(kept ? [kept.id] : []);
        }
        haptic?.("selection");
        render();
    }

    async function load() {
        const pages = memento ? MEMENTO_CHAT_PAGES : CAPTURE_CHAT_PAGES;
        const loadChats = async () => {
            if (!allowsChats) return [];
            const rows = [];
            for (let page = 0; page < pages; page++) {
                const result = await api.getChats(userId, CHAT_PAGE_SIZE, page * CHAT_PAGE_SIZE);
                const items = Array.isArray(result) ? result : result?.items || [];
                rows.push(...items);
                if (items.length < CHAT_PAGE_SIZE) break;
            }
            return rows;
        };
        const [chats, classmates, contacts, blocked] = await Promise.allSettled([
            loadChats(),
            allowsChats || allowsStory ? api.getClassmates(userId, "", 500) : Promise.resolve([]),
            allowsChats && api.getAllContacts ? api.getAllContacts(userId) : Promise.resolve([]),
            api.getBlockedUsers ? api.getBlockedUsers(userId) : Promise.resolve([]),
        ]);
        state.loading = false;
        state.blocked = new Set((blocked.status === "fulfilled" && Array.isArray(blocked.value) ? blocked.value : []).map((user) => String(user.user_id || user.id || user.blocked_user_id)));
        const chatRows = (chats.status === "fulfilled" ? chats.value : []).map(normalizeChat)
            // CaptureFlowModel: accepted chats with nobody the viewer blocked;
            // MementoAudience.eligible: active chats that take a Memento today.
            .filter((chat) => chat.membership_status === "accepted" && chat.has_viewer_blocked_member !== true)
            .filter((chat) => !memento || (chat.status === "active" && chat.is_memento_eligible_today !== false));
        if (kept && !chatRows.some((chat) => chat.id === kept.id)) chatRows.unshift(kept);
        state.chats = chatRows;
        const classmateRows = classmates.status === "fulfilled" ? (Array.isArray(classmates.value) ? classmates.value : classmates.value?.items || []) : [];
        state.classmates = classmateRows.filter((person) => !state.blocked.has(String(person.user_id || person.id)));
        if (allowsChats) {
            const partners = new Set(chatRows.filter((chat) => !isGroupChatSummary(chat))
                .map((chat) => String((chat.member_previews || []).find((member) => String(member.user_id) !== String(userId))?.user_id || "")).filter(Boolean));
            const contactRows = contacts.status === "fulfilled" && Array.isArray(contacts.value) ? contacts.value : [];
            // People with no one-to-one chat yet: contacts first, then classmates, then mutuals.
            state.people = mergeChatPeople(classmateRows, contactRows, userId)
                .filter((person) => !partners.has(person.id) && !state.blocked.has(person.id))
                .sort((a, b) => Number(b.contact) - Number(a.contact) || Number(b.school_mate) - Number(a.school_mate)
                    || b.mutual - a.mutual || a.name.localeCompare(b.name));
        }
        if (chats.status === "rejected" && !state.chats.length && !state.people.length) state.error = userMessage(chats.reason, "Couldn't load your chats.");
        render();
    }

    // CaptureSendSheet.startChats: one chat per person, six at a time. The
    // server reuses an existing one-to-one chat; started chats are kept.
    async function startChats(people) {
        const failed = [];
        const queue = [...people];
        const worker = async () => {
            while (queue.length) {
                const person = queue.shift();
                if (state.started.has(person.id)) continue;
                if (!state.requestIds.has(person.id)) state.requestIds.set(person.id, crypto.randomUUID());
                try {
                    const chat = normalizeChat(await api.createChat(userId, [person.id], null, state.requestIds.get(person.id)));
                    state.started.set(person.id, chat);
                } catch (_) {
                    failed.push(person);
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(START_CHAT_CONCURRENCY, people.length) }, worker));
        // Started chats join the chosen chats, so a retry only starts the rest.
        for (const [personId, chat] of state.started) {
            if (!state.chosenPeople.has(personId)) continue;
            state.chosenPeople.delete(personId);
            if (!state.chats.some((item) => item.id === chat.id)) state.chats.push(chat);
            state.chosenChats.add(chat.id);
            state.order = state.order.map((key) => (key === `person:${personId}` ? `chat:${chat.id}` : key));
            state.people = state.people.filter((person) => person.id !== personId);
        }
        return failed;
    }

    function startFailureMessage(failed) {
        if (memento) {
            const names = new Intl.ListFormat(undefined, { style: "long", type: "conjunction" }).format(failed.map((person) => person.first || person.name));
            return { title: "Couldn't start every chat", message: `Couldn't start a chat with ${names}. Check your connection and try again.` };
        }
        return {
            title: "Couldn't send",
            message: failed.length === 1
                ? "Couldn't start a chat with 1 person. Check your connection and try again."
                : `Couldn't start chats with ${failed.length} people. Check your connection and try again.`,
        };
    }

    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
            dialog.close();
        };
        async function confirm() {
            if (state.working) return;
            const { people } = chosen();
            if (!state.story && !chosenCount()) return;
            state.working = true;
            renderBar();
            const failed = people.length ? await startChats(people) : [];
            state.working = false;
            if (failed.length) {
                render();
                const { alertSheet } = await import("../ui-dialogs.js");
                await alertSheet(startFailureMessage(failed));
                return;
            }
            const list = sections().filter((section) => section.chats).flatMap((section) => section.chats);
            const order = new Map(list.map((chat, index) => [chat.id, index]));
            const chats = chosen().chats.sort((a, b) => Number(isKept(b)) - Number(isKept(a)) || (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
            haptic?.("success");
            finish({ story: state.story, tags: state.story ? [...state.tags] : [], chatIds: chats.map((chat) => chat.id), chats });
        }

        dialog.addEventListener("click", (event) => {
            const target = event.target.closest("button");
            if (!target || target.disabled) return;
            if (target.matches("[data-send-to-cancel]")) return finish(null);
            if (target.matches("[data-send-to-confirm]")) return void confirm();
            if (target.matches("[data-send-to-story]")) { state.story = !state.story; haptic?.("selection"); return render(); }
            if (target.matches("[data-send-to-tags]")) return void openTags();
            if (target.matches("[data-send-to-clear]")) { search.value = ""; state.query = ""; render(); return search.focus(); }
            if (target.dataset.sendToSelectAll) return selectAll(target.dataset.sendToSelectAll === "on");
            if (target.dataset.sendToChat) return toggleChat(target.dataset.sendToChat);
            if (target.dataset.sendToPerson) return togglePerson(target.dataset.sendToPerson);
        });
        search.addEventListener("input", () => { state.query = search.value; render(); });
        // No dismissing while chats are being started (interactiveDismissDisabled).
        dialog.addEventListener("cancel", (event) => { event.preventDefault(); if (!state.working) finish(null); });
        dialog.addEventListener("close", () => { if (!settled) { settled = true; resolve(null); } dialog.remove(); }, { once: true });

        async function openTags() {
            const tags = await openStoryTags({ api, classmates: state.classmates, loading: state.loading, selected: state.tags });
            if (tags) state.tags = tags;
            render();
        }

        document.body.append(dialog);
        dialog.showModal();
        render();
        $("[data-send-to-confirm]").focus({ preventScroll: true });
        void load().catch((error) => { state.loading = false; state.error = userMessage(error, "Couldn't load your chats."); render(); });
    });
}

// StoryTagPeopleView: classmates to notify when the Story posts.
export function openStoryTags({ api, classmates = [], loading = false, selected = [] } = {}) {
    const dialog = document.createElement("dialog");
    const id = `story-tags-${++sheetSequence}`;
    dialog.className = "send-to-sheet story-tags-sheet";
    dialog.setAttribute("aria-labelledby", `${id}-title`);
    const chosen = [...selected];
    let query = "";
    dialog.innerHTML = `
        <div class="send-to-content">
            <header class="send-to-header"><button type="button" class="send-to-cancel" data-tags-cancel>Cancel</button><h2 id="${id}-title">Tag classmates</h2><span aria-hidden="true"></span></header>
            <div class="send-to-scroll">
                <p class="story-tags-prompt">They'll get a notification when your Story posts.</p>
                <label class="send-to-search"><span aria-hidden="true">${uiIcon("search")}</span><input type="search" placeholder="Search classmates" aria-label="Search classmates" autocomplete="off"></label>
                <div class="send-to-list"></div>
            </div>
            <footer class="send-to-bar"><button type="button" class="send-to-send" data-tags-confirm><span class="send-to-send-title"></span><span class="send-to-send-disc" aria-hidden="true">${uiIcon("check")}</span></button></footer>
        </div>`;
    const $ = (selector) => dialog.querySelector(selector);
    const people = classmates.map((person) => ({ id: String(person.user_id || person.id), name: [person.first_name, person.last_name].filter(Boolean).join(" ") || person.username || "Classmate", username: person.username, avatar: person.profile_picture_url, grade: person.grade }));
    function render() {
        const q = normalizedQuery(query);
        const rows = people.filter((person) => !q || [person.name, person.username].some((value) => String(value || "").toLowerCase().includes(q)));
        $(".send-to-list").innerHTML = loading && !people.length ? `<p class="send-to-empty">Finding classmates…</p>`
            : rows.length ? rows.map((person) => {
                const on = chosen.includes(person.id);
                const disabled = !on && chosen.length >= STORY_TAG_LIMIT;
                const image = safeMediaURL(person.avatar, api);
                const initial = escapeHTML(person.name.slice(0, 1));
                return `<button type="button" class="send-to-row ${on ? "selected" : ""}" data-tag-person="${escapeHTML(person.id)}" aria-pressed="${on}"${disabled ? " disabled" : ""}><span class="send-to-avatar" aria-hidden="true">${image ? mediaImageMarkup(image, { initials: initial }) : `<span>${initial}</span>`}</span><span class="send-to-row-copy"><strong>${escapeHTML(person.name)}</strong>${person.username ? `<small>@${escapeHTML(person.username)}</small>` : ""}</span><span class="send-to-mark ${on ? "selected" : ""}" aria-hidden="true">${uiIcon(on ? "checkmark-circle-filled" : "circle-outline")}</span></button>`;
            }).join("") : `<p class="send-to-empty">${q ? "No matches." : "No classmates yet."}</p>`;
        $(".send-to-send-title").textContent = chosen.length ? `Tag ${chosen.length}` : "No tags";
    }
    return new Promise((resolve) => {
        let result = null;
        dialog.addEventListener("click", (event) => {
            const target = event.target.closest("button");
            if (!target || target.disabled) return;
            if (target.matches("[data-tags-cancel]")) return dialog.close();
            if (target.matches("[data-tags-confirm]")) { result = [...chosen]; return dialog.close(); }
            const personId = target.dataset.tagPerson;
            if (!personId) return;
            const index = chosen.indexOf(personId);
            if (index >= 0) chosen.splice(index, 1);
            else if (chosen.length < STORY_TAG_LIMIT) chosen.push(personId);
            render();
        });
        $(".send-to-search input").addEventListener("input", (event) => { query = event.target.value; render(); });
        dialog.addEventListener("close", () => { resolve(result); dialog.remove(); }, { once: true });
        document.body.append(dialog);
        dialog.showModal();
        render();
    });
}
