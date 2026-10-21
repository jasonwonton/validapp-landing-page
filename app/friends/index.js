import { uiIcon } from "../ui-icons.js";
import { userMessage } from "../user-message.js";
import { confirmSheet } from "../ui-dialogs.js";
import { relationshipFor, parseAddLink, suggestionDescription } from "./model.js";

export function createFriendsView({ api, getUser, getConfig, escapeHTML: esc, avatarMarkup, openProfile, openChat, onChanged, showToast }) {
    const dialog = document.createElement("dialog");
    dialog.className = "modal friends-dialog parity-page friends-page";
    dialog.setAttribute("aria-label", "Add Friends");
    document.body.append(dialog);
    let owner = null;
    let generation = 0;
    let searchGeneration = 0;
    let tab = "friends";
    let query = "";
    let data = {};
    let errors = {};
    let loading = false;
    let searchResults = [];
    let searchError = "";
    let searchLoading = false;
    let timer;
    let busy = new Set();
    let actionError = "";
    let link = null;
    let linkSource = null;
    let returnFromProfile = false;
    let page = "list", menu = false, rowMenu = null, privacyPage = null, privacyOnly = false, qrCanvas = null, linkDraft = "";
    const alive = (id, epoch) => String(getUser()?.id) === id && owner === id && generation === epoch;
    const enabled = () => getConfig()?.friends_enabled === true;
    const personId = (person) => String(person.user_id);
    const allPeople = () => [...(data.friends?.friends || []), ...(data.requests?.incoming || []), ...(data.requests?.outgoing || []), ...(data.suggestions?.suggestions || []), ...(data.classmates || []), ...(data.blocked || []), ...searchResults];
    const relation = (person) => relationshipFor(person, { friends: data.friends?.friends, incoming: data.requests?.incoming, outgoing: data.requests?.outgoing });
    const button = (action, id, label, disabled = false, title = label) => `<button class="friend-pill ${action === "accept" ? "friend-pill-accept" : ""}" type="button" data-friend-action="${action}" data-person-id="${esc(id)}" aria-label="${esc(title)}" ${disabled || busy.has(id) ? "disabled" : ""}>${busy.has(id) ? "Working…" : `${["add", "message", "accept"].includes(action) ? uiIcon(action === "add" ? "person-add" : action === "message" ? "chat-pair-filled" : "check") : ""}${esc(label)}`}</button>`;
    function row(person, { blocked = false, suggested = false } = {}) {
        const id = personId(person);
        if (person.anonymous_sender === true) person = { user_id: id, first_name: "Anonymous sender", anonymous_sender: true };
        const state = blocked ? "blocked" : relation(person);
        const name = person.name || [person.first_name, person.last_name].filter(Boolean).join(" ") || person.username || "Valid user";
        const warning = person.held || person.connection?.known === false
            ? `<small class="friend-warning">You may not know this person.${person.requester_is_adult ? " This account is an adult." : ""}</small>` : "";
        const preview = person.messages_held === true || (person.messages_held == null && person.held) ? "" : person.latest_message_body || person.first_message_body || "";
        const description = suggested ? suggestionDescription(person) : person.username ? `@${person.username}` : "";
        let actions = "", extra = "";
        if (state === "blocked") actions = button("unblock", id, "Unblock");
        else if (state === "unavailable" || state === "self") actions = `<span class="friend-state">${state === "self" ? "You" : "Unavailable"}</span>`;
        else if (state === "added_you") actions = `${button("accept", id, "Accept")}<button class="friend-dismiss" type="button" data-friend-action="decline" data-person-id="${esc(id)}" aria-label="Decline" ${busy.has(id) ? "disabled" : ""}>×</button>`;
        else if (state === "requested") { actions = '<span class="friend-state">Requested</span>'; extra = button("cancel", id, "Cancel request"); }
        else if (state === "added") { actions = button("message", id, "Chat", false, "Message"); extra = button("remove", id, "Remove friend"); }
        else actions = button("add", id, "Add", false, "Add friend");
        if (suggested && state === "none") actions += `<button class="friend-dismiss" type="button" data-friend-action="dismiss" data-person-id="${esc(id)}" aria-label="Dismiss suggestion" ${busy.has(id) ? "disabled" : ""}>×</button>`;
        if (extra) actions += `<div class="friend-more-wrap"><button class="friend-dismiss" type="button" data-friend-more="${esc(id)}" aria-label="More for ${esc(name)}" aria-expanded="${rowMenu === id}">${uiIcon("more")}</button>${rowMenu === id ? `<div class="friend-menu">${extra}</div>` : ""}</div>`;
        const avatar = `<span class="friend-avatar" aria-hidden="true">${avatarMarkup({ ...person, first_name: person.first_name || name.split(" ")[0], last_name: "" }, "row-avatar")}</span>`;
        return `<article class="friend-row" data-friend-row="${esc(id)}"><button class="friend-person" type="button" data-friend-profile="${esc(id)}" ${blocked ? "disabled" : ""}>${avatar}<span><strong>${esc(name)}</strong>${description ? `<small>${esc(description)}</small>` : ""}${person.school_name ? `<small class="friend-school">${esc(person.school_name)}</small>` : ""}${warning}${preview ? `<small>${esc(preview)}</small>` : ""}</span></button><div class="friend-row-actions">${actions}</div></article>`;
    }
    function section(key, rows, empty, options = {}) {
        if (errors[key]) return `<div class="friends-empty"><p>${esc(errors[key])}</p><button class="secondary-button" type="button" data-friends-retry>Try again</button></div>`;
        if (!data[key]) return `<p role="status">${loading ? "Loading…" : "Open this section to load it."}</p>`;
        return rows.length ? rows.map((person) => row(person, options)).join("") : `<div class="friends-empty">${uiIcon("group")}<p>${esc(empty)}</p></div>`;
    }
    const title = (text, count = null) => `<h3 class="friends-section-title">${text}${count != null ? `<span class="friends-count">${count}</span>` : ""}</h3>`;
    function render() {
        if (!dialog.open) return;
        const focused = document.activeElement;
        const selection = focused?.id === "friendsSearch" ? [focused.selectionStart, focused.selectionEnd] : null;
        const isList = page === "list" && !["privacy", "blocked"].includes(tab);
        let content = "";
        if (query && isList) content = searchLoading ? `<p role="status">Searching…</p>` : searchError ? `<p role="status">${esc(searchError)}</p><button class="secondary-button" type="button" data-search-retry>Try again</button>` : searchResults.length ? searchResults.map((person) => row(person)).join("") : `<div class="friends-empty">${uiIcon("text-search")}<p>No matching people.</p><small>Try an exact username or a classmate's name.</small></div>`;
        else if (tab === "suggestions" && isList) content = `${section("suggestions", data.suggestions?.enabled === true ? data.suggestions.suggestions : [], data.suggestions?.enabled === false ? "Suggestions are not available right now." : "You're all caught up.", { suggested: true })}<button class="friends-disclosure" type="button" data-friends-tab="classmates"><span>Classmates</span><span aria-hidden="true">›</span></button>`;
        else if (tab === "classmates" && isList) content = `${title("Classmates")}${section("classmates", data.classmates || [], "No classmates are visible yet.")}`;
        else if (["friends", "requests"].includes(tab) && isList) {
            const incoming = data.requests?.incoming || [], outgoing = data.requests?.outgoing || [];
            content = `${incoming.length || errors.requests ? `${title("Requests", incoming.length)}${section("requests", incoming, "No incoming requests.")}` : ""}${title(`${data.friends?.total ?? data.friends?.friends.length ?? 0} ${(data.friends?.total ?? data.friends?.friends.length) === 1 ? "friend" : "friends"}`)}${section("friends", data.friends?.friends || [], "Your friends will appear here after a request is accepted.")}${data.friends?.next_cursor ? '<button class="secondary-button" type="button" data-friends-more>Load more friends</button>' : ""}${outgoing.length ? `${title("Sent requests", outgoing.length)}${section("requests", outgoing, "No pending requests.")}` : ""}`;
        } else if (tab === "blocked") content = section("blocked", data.blocked || [], "No blocked accounts.", { blocked: true });
        else if (tab === "privacy") content = privacyMarkup();
        if (page === "code") content = codeMarkup();
        if (page === "link") content = linkMarkup();
        const heading = isList ? "Friends" : tab === "blocked" ? "Blocked accounts" : tab === "privacy" ? privacyPage === "reach" ? "Who can add you" : privacyPage === "messages" ? "Who can message you" : "Privacy" : page === "code" ? "My code" : "Add by link";
        dialog.innerHTML = `<header class="parity-page-header"><button class="parity-back" type="button" ${isList ? 'data-friends-close aria-label="Close Add Friends"' : 'data-friends-back aria-label="Back"'}>‹</button><h2>${heading}</h2><div class="parity-header-actions">${isList && getConfig()?.add_links_enabled === true ? `<button class="parity-icon-button" type="button" data-my-code aria-label="My link & QR code">${uiIcon("qr-code")}</button>` : ""}${isList ? `<button class="parity-icon-button" type="button" data-friends-menu aria-label="Friends options" aria-expanded="${menu}">${uiIcon("more")}</button>` : ""}</div></header>
            ${menu ? `<nav class="friend-menu friends-options" aria-label="Friends options"><button type="button" data-friends-tab="privacy">Privacy</button><button type="button" data-friends-tab="blocked">Blocked</button>${getConfig()?.add_links_enabled === true ? '<button type="button" data-open-add-link>Open a link or QR code</button>' : ""}</nav>` : ""}
            ${isList ? `<form class="friends-search-form" role="search"><button type="submit" aria-label="Search">${uiIcon("text-search")}</button><input id="friendsSearch" aria-label="Find people" type="search" maxlength="64" placeholder="Search people by name or @username" autocomplete="off" value="${esc(query)}"></form><div class="friends-tabs" role="group" aria-label="Friends sections"><button type="button" data-friends-tab="friends" aria-pressed="${["friends", "requests"].includes(tab)}">Friends${data.requests?.incoming.length ? `<span class="friends-count" aria-hidden="true">${data.requests.incoming.length}</span>` : ""}</button>${data.suggestions?.enabled !== false ? `<button type="button" data-friends-tab="suggestions" aria-pressed="${["suggestions", "classmates"].includes(tab)}">Suggested</button>` : `<button type="button" data-friends-tab="classmates" aria-pressed="${tab === "classmates"}">Classmates</button>`}</div>` : ""}
            <p class="status-message parity-status" role="status">${esc(actionError)}</p><div class="friends-content parity-page-content" aria-busy="${loading || searchLoading}">${content}</div>`;
        if (page === "code" && qrCanvas) dialog.querySelector("[data-friend-qr]")?.append(qrCanvas);
        if (selection) {
            const input = dialog.querySelector("#friendsSearch");
            input?.focus({ preventScroll: true });
            input?.setSelectionRange?.(...selection);
        }
    }
    function privacyMarkup() {
        if (errors.privacy) return `<p>${esc(errors.privacy)}</p><button type="button" data-friends-retry>Try again</button>`;
        if (!data.reach || !data.messages) return '<p role="status">Loading privacy settings…</p>';
        const reach = data.reach, messages = data.messages, locked = reach.forced || reach.locked_by_parent;
        if (!privacyPage) return `<div class="parity-settings-card"><button class="parity-setting-row" type="button" data-privacy-page="reach">${uiIcon("person-add")}<span><strong>Who can add you</strong><small>${reach.school_contacts_only ? "School & contacts" : "Anyone"}</small></span><span aria-hidden="true">›</span></button><button class="parity-setting-row" type="button" data-privacy-page="messages">${uiIcon("chat-pair")}<span><strong>Who can message you</strong><small>${messages.from_anyone ? "Anyone" : "People you know"}</small></span><span aria-hidden="true">›</span></button></div>`;
        const isReach = privacyPage === "reach", value = isReach ? reach.school_contacts_only : messages.from_anyone, disabled = isReach ? locked || !reach.available : messages.locked_by_parent || !messages.available;
        const choices = isReach ? [[false, "Everyone", "Anyone with your username can add you, even from other schools"], [true, "School & contacts", "Only people from your school or your contacts can find and add you"]] : [[false, "People you know", "Anyone else has to wait until you accept their friend request"], [true, "Anyone who adds you", "People you don't know can send a message with their friend request"]];
        const notes = isReach ? ["Contacts are people whose number you saved, or who saved yours.", "With School & contacts, you can only add people from your school and contacts, too.", "Changing this doesn't remove anyone. Friends you have stay friends."] : ["People you know go to your school, are saved in your contacts, share a friend with you, or have chatted with you.", "Adults you don't know can never message you first.", "Blocked people can never message you."];
        return `<div class="parity-settings-card" role="radiogroup" aria-label="${isReach ? "Who can add you" : "Who can message you"}">${choices.map(([checked, label, detail]) => `<label class="parity-choice"><span><strong>${label}</strong><small>${detail}</small></span><input type="radio" name="friend-privacy" data-friend-setting="${isReach ? "reach" : "messages"}" value="${checked}" ${value === checked ? "checked" : ""} ${disabled || busy.has("privacy") ? "disabled" : ""}></label>`).join("")}${disabled ? '<p class="parity-locked-note">This protection is required or managed by your parent.</p>' : ""}</div><div class="parity-choice-notes">${notes.map(note => `<p>${note}</p>`).join("")}</div>`;

    }

    async function refresh({ more = false } = {}) {
        if (!owner || !enabled()) return;
        const id = owner, epoch = ++generation;
        loading = true;
        render();
        const requests = more ? { friends: () => api.getFriends(id, data.friends?.next_cursor) } : {
            friends: () => api.getFriends(id), requests: () => api.getPeopleRequests(id),
            suggestions: () => api.getFriendSuggestions(id), classmates: () => api.getClassmates(id, "", 500),
        };
        if (tab === "blocked") requests.blocked = () => api.getBlockedProfiles(id);
        if (tab === "privacy") {
            requests.reach = () => api.getFriendReach(id);
            requests.messages = () => api.getMessageRequests(id);
        }
        const results = await Promise.allSettled(Object.values(requests).map((fn) => fn()));
        if (!alive(id, epoch)) return;
        for (const [index, key] of Object.keys(requests).entries()) {
            const result = results[index];
            if (result.status === "fulfilled") {
                delete errors[key];
                if (more && key === "friends") {
                    const map = new Map([...(data.friends?.friends || []), ...result.value.friends].map((item) => [personId(item), item]));
                    data.friends = { ...result.value, friends: [...map.values()] };
                } else data[key] = result.value;
            } else errors[key] = userMessage(result.reason, "Couldn't load this section.");
        }
        errors.privacy = errors.reach || errors.messages;
        loading = false;
        render();
        onChanged?.();
        if (query) await search();
    }

    async function search() {
        const text = query.trim(), id = owner, epoch = generation, searchEpoch = ++searchGeneration;
        searchError = "";
        searchResults = [];
        if (!text) { searchLoading = false; render(); return; }
        searchLoading = true;
        render();
        const lookup = data.requests?.can_add_people === true
            ? api.lookupPerson(id, text.replace(/^@/, "")) : Promise.resolve(null);
        const results = await Promise.allSettled([lookup, api.getClassmates(id, text, 50)]);
        if (!alive(id, epoch) || searchEpoch !== searchGeneration || query.trim() !== text) return;
        const normalized = text.toLocaleLowerCase().replace(/^@/, "");
        const people = new Map(allPeople().filter(p => [p.name, p.first_name, p.last_name, p.username].filter(Boolean).join(" ").toLocaleLowerCase().includes(normalized)).map(p => [personId(p), p]));
        if (results[1].status === "fulfilled") results[1].value.forEach((person) => people.set(personId(person), person));
        if (results[0].status === "fulfilled" && results[0].value) people.set(personId(results[0].value), results[0].value);
        searchResults = [...people.values()];
        const failure = results.find((result) => result.status === "rejected" && result.reason.status !== 404);
        searchError = failure && !searchResults.length ? userMessage(failure.reason, "Couldn't search. Try again.") : "";
        searchLoading = false;
        render();
    }

    function reconcile(id, result) {
        const person = allPeople().find((p) => personId(p) === id);
        for (const key of ["incoming", "outgoing"]) if (data.requests) data.requests[key] = data.requests[key].filter((p) => personId(p) !== id);
        if (person) { person.relation = result; if (result === "requested" && data.requests) data.requests.outgoing.push(person); }
        if (["none", "blocked"].includes(result) && data.friends) data.friends.friends = data.friends.friends.filter((p) => personId(p) !== id);
        if (result === "added" && person && data.friends && !data.friends.friends.some((p) => personId(p) === id)) data.friends.friends.push(person);
    }

    async function act(action, id) {
        if (busy.has(id) || !owner || String(getUser()?.id) !== owner) return;
        const account = owner, epoch = generation;
        const person = allPeople().find((p) => personId(p) === id);
        if (!person) return;
        if (["remove", "block", "report"].includes(action) && !await confirmSheet({ title: `${action === "remove" ? "Remove friend" : action === "block" ? "Block" : "Report and block"} ${person.first_name || "this account"}?`, confirmLabel: action === "remove" ? "Remove friend" : action === "block" ? "Block" : "Report", destructive: true })) return;
        if (action === "accept" && (person.held || person.connection?.known === false) && !await confirmSheet({ title: `Do you know ${person.first_name || "this person"}?`, message: `Only accept people you know.${person.requester_is_adult ? " This account is an adult." : ""}`, confirmLabel: "Accept", cancelLabel: "Go back" })) return;
        if (!alive(account, epoch)) return;
        if (action === "message") { dialog.close(); return openChat(person); }
        const mutations = {
            add: () => api.sendFriendRequest(owner, id, linkSource), accept: () => api.acceptFriendRequest(owner, id),
            decline: () => api.declineFriendRequest(owner, id), cancel: () => api.cancelFriendRequest(owner, id),
            remove: () => api.removeFriend(owner, id), block: () => api.blockUser(owner, id),
            unblock: () => api.unblockUser(owner, id), report: () => api.reportUser(owner, id),
            dismiss: () => api.dismissFriendSuggestion(owner, id),
        };
        if (!mutations[action]) return;
        ++generation; // Retire reads started before this write.
        ++searchGeneration;
        busy.add(id); actionError = ""; render();
        try {
            const response = await mutations[action]();
            if (String(getUser()?.id) !== account || owner !== account) return;
            const next = response?.relation || (action === "accept" ? "added" : ["block", "report"].includes(action) ? "blocked" : "none");
            reconcile(id, next);
            if (action === "dismiss") data.suggestions.suggestions = data.suggestions.suggestions.filter((p) => personId(p) !== id);
            if (["block", "report"].includes(action)) searchResults = searchResults.filter((p) => personId(p) !== id);
            showToast(next === "requested" ? "Friend request sent" : next === "added" ? "You're friends" : action === "unblock" ? "Unblocked. Your previous friendship stays removed." : "Updated");
            await refresh();
            onChanged?.({ action, userId: id });
        } catch (error) {
            if (String(getUser()?.id) !== account || owner !== account) return;
            actionError = userMessage(error, "Couldn't update this person. Try again.");
            // A timed out write may have committed; repair before another tap.
            await refresh();
        } finally { if (owner === account) { busy.delete(id); render(); } }
    }

    async function open({ section: requested = "friends", username = null, source = "link", person = null, privacy = null, returnToSettings = false } = {}) {
        if (!enabled() || !getUser()?.id) return;
        const id = String(getUser().id);
        if (owner !== id) clear();
        owner = id; tab = requested; page = "list"; menu = false; rowMenu = null; privacyPage = privacy; privacyOnly = returnToSettings; query = ""; actionError = "";
        if (!dialog.open) dialog.showModal();
        render();
        await refresh();
        if (person && owner === id) {
            query = person.username || person.first_name || "Profile";
            searchResults = [person]; render();
        }
        if (username && owner === id) {
            query = username; linkSource = source; searchLoading = true; render();
            const epoch = generation;
            try {
                const person = await api.resolveAddLink(id, username);
                if (!alive(id, epoch)) return;
                searchResults = [person]; searchError = "";
            } catch (error) { if (alive(id, epoch)) { searchResults = []; searchError = userMessage(error, "This link is unavailable."); } }
            if (alive(id, epoch)) { searchLoading = false; render(); }
        }
    }

    function codeMarkup() {
        if (!link?.available) return '<p role="status">Loading your code…</p>';
        return `<div class="friend-code-card"><h3>${esc(getUser()?.first_name || "Your Valid")}</h3><div data-friend-qr></div><p>Scan to add me on Valid</p><p class="friend-link">${esc(link.url)}</p><button class="primary-button" type="button" data-share-add-link>Share link</button><label class="friend-setting">Link enabled<input type="checkbox" data-add-link-enabled ${link.enabled ? "checked" : ""}></label><p data-add-link-status role="status">${link.enabled ? "Your link is active." : "Your link is off. A completed share turns it on."}</p></div>`;
    }
    function linkMarkup() {
        return `<form data-add-link-form><label for="friendAddLink">Valid Add me link</label><input id="friendAddLink" type="url" required value="${esc(linkDraft)}" placeholder="https://validapp.lol/add/username" autocomplete="off"><p>Paste a link, or use your device's camera QR scanner and open the result in Valid.</p><button class="primary-button" type="submit">Open link</button></form>${typeof BarcodeDetector === "function" ? '<label>Read a QR image<input type="file" accept="image/*" data-friend-qr-file></label>' : ''}`;
    }
    async function myCode() {
        const id = owner, epoch = generation;
        page = "code"; menu = false; render();
        try {
            const response = await api.getAddLink(id);
            if (!alive(id, epoch) || !dialog.open || page !== "code") return;
            link = response;
            if (!link.available || !link.url) { actionError = "An Add me link is unavailable for this account."; render(); return; }
            const { toCanvas } = await import("./qr.js");
            if (!alive(id, epoch) || !dialog.open || page !== "code") return;
            const canvas = document.createElement("canvas");
            canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", "QR code for your Add me link");
            await toCanvas(canvas, link.url, { width: 240, margin: 2 });
            if (!alive(id, epoch) || !dialog.open || page !== "code") return;
            qrCanvas = canvas; render();
        } catch (error) { if (alive(id, epoch)) { actionError = userMessage(error, "Couldn't complete this step. Try again."); render(); } }
    }

    async function shareLink() {
        if (!link?.available) return;
        const id = owner, url = link.url;
        try {
            if (navigator.share) await navigator.share({ url });
            else { await navigator.clipboard.writeText(url); showToast("Add me link copied"); }
            if (String(getUser()?.id) !== id || owner !== id) return;
            link = await api.updateAddLink(id, true);
            if (owner === id) await myCode();
        } catch (error) { if (error.name !== "AbortError" && owner === id) { actionError = userMessage(error, "Couldn't complete this step. Try again."); render(); } }
    }

    function clear() {
        ++generation; ++searchGeneration; clearTimeout(timer);
        owner = null; data = {}; errors = {}; qrCanvas = null; linkDraft = ""; searchResults = []; busy = new Set();
        loading = false; searchLoading = false; searchError = ""; actionError = "";
        query = ""; link = null; linkSource = null; returnFromProfile = false;
        if (dialog.open) dialog.close();
        dialog.replaceChildren();
    }

    dialog.addEventListener("input", (event) => {
        if (event.target.id === "friendAddLink") { linkDraft = event.target.value; return; }
        if (event.target.id !== "friendsSearch") return;
        query = event.target.value; linkSource = null; ++searchGeneration;
        clearTimeout(timer); timer = setTimeout(search, 300);
    });
    dialog.addEventListener("submit", (event) => {
        event.preventDefault();
        if (event.target.matches("[data-add-link-form]")) {
            const username = parseAddLink(dialog.querySelector("#friendAddLink").value.trim());
            if (username) void open({ username, source: "link" });
            else { actionError = "Use a https://validapp.lol/add/username link."; render(); }
            return;
        }
        clearTimeout(timer); void search();
    });
    function back() {
        if (privacyOnly) return dialog.close();
        if (privacyPage) privacyPage = null;
        else { page = "list"; tab = "friends"; }
        actionError = ""; render();
    }
    dialog.addEventListener("cancel", event => {
        if (!privacyOnly && (page !== "list" || ["privacy", "blocked"].includes(tab))) { event.preventDefault(); back(); }
    });
    dialog.addEventListener("click", (event) => {
        const target = event.target.closest("button");
        if (!target || target.disabled) return;
        if (target.matches("[data-friends-close]")) return dialog.close();
        if (target.matches("[data-friends-menu]")) { menu = !menu; render(); return; }
        if (target.dataset.friendMore) { rowMenu = rowMenu === target.dataset.friendMore ? null : target.dataset.friendMore; render(); return; }
        if (target.dataset.privacyPage) { privacyPage = target.dataset.privacyPage; render(); return; }
        if (target.matches("[data-friends-back]")) return back();
        if (target.dataset.friendsTab) { page = "list"; menu = false; rowMenu = null; privacyPage = null; tab = target.dataset.friendsTab; query = ""; ++searchGeneration; clearTimeout(timer); render(); return void refresh(); }
        if (target.matches("[data-friends-retry]")) return void refresh();
        if (target.matches("[data-search-retry]")) return void search();
        if (target.matches("[data-friends-more]")) return void refresh({ more: true });
        if (target.dataset.friendAction) return void act(target.dataset.friendAction, target.dataset.personId);
        if (target.dataset.friendProfile) {
            const person = allPeople().find((p) => personId(p) === target.dataset.friendProfile);
            if (person) { returnFromProfile = true; dialog.close(); openProfile(person); }
        }
        if (target.matches("[data-my-code]")) return void myCode();
        if (target.matches("[data-share-add-link]")) return void shareLink();
        if (target.matches("[data-open-add-link]")) {
            page = "link"; menu = false; render();
            dialog.querySelector("#friendAddLink").focus();
        }
    });
    dialog.addEventListener("change", async (event) => {
        const input = event.target;
        if (input.matches("[data-friend-qr-file]")) {
            const file = input.files?.[0], account = owner, epoch = generation;
            if (!file) return;
            try {
                if (file.size > 8 * 1024 * 1024) throw new Error("Choose a QR image smaller than 8 MB.");
                const bitmap = await createImageBitmap(file);
                try {
                    const codes = await new BarcodeDetector({ formats: ["qr_code"] }).detect(bitmap);
                    const username = codes.map((code) => parseAddLink(code.rawValue)).find(Boolean);
                    if (!username) throw new Error("No Valid Add me QR code was found. Paste the link instead.");
                    if (alive(account, epoch)) await open({ username, source: "qr" });
                } finally { bitmap.close(); }
            } catch (error) { if (alive(account, epoch)) { actionError = userMessage(error, "Couldn't complete this step. Try again."); render(); } }
            return;
        }
        if (!input.matches("[data-friend-setting], [data-add-link-enabled]")) return;
        const id = owner, epoch = generation;
        if (busy.has("privacy")) return;
        const previousReach = data.reach, previousMessages = data.messages;
        if (input.dataset.friendSetting === "reach") data.reach = { ...data.reach, school_contacts_only: input.value === "true" };
        if (input.dataset.friendSetting === "messages") data.messages = { ...data.messages, from_anyone: input.value === "true" };
        busy.add("privacy"); input.disabled = true; actionError = ""; render();
        try {
            const key = input.matches("[data-add-link-enabled]") ? "link" : input.dataset.friendSetting;
            const result = key === "link" ? await api.updateAddLink(id, input.checked)
                : key === "reach" ? await api.updateFriendReach(id, input.value === "true") : await api.updateMessageRequests(id, input.value === "true");
            if (!alive(id, epoch)) return;
            if (key === "link") link = result;
            else data[key] = result;
        } catch (error) { if (owner === id) { data.reach = previousReach; data.messages = previousMessages; actionError = userMessage(error, "Couldn't complete this step. Try again."); } }
        finally { if (owner === id) { busy.delete("privacy"); await refresh(); } }
    });
    window.addEventListener("focus", () => { if (dialog.open && owner) void refresh(); });
    window.addEventListener("online", () => { if (dialog.open && owner) void refresh(); });
    return { open, refresh, clear, invalidate() { if (dialog.open) void refresh(); else { ++generation; data = {}; } }, relationship: relation, returnFromProfile() { if (!returnFromProfile) return false; returnFromProfile = false; if (owner && enabled()) { dialog.showModal(); render(); void refresh(); } return true; } };
}
