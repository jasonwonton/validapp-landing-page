import { relationshipFor, parseAddLink, suggestionDescription } from "./model.js";

export function createFriendsView({ api, getUser, getConfig, escapeHTML: esc, avatarMarkup, openProfile, openChat, onChanged, showToast }) {
    const dialog = document.createElement("dialog");
    dialog.className = "modal friends-dialog";
    dialog.setAttribute("aria-label", "Add Friends");
    document.body.append(dialog);
    let owner = null;
    let generation = 0;
    let searchGeneration = 0;
    let tab = "suggestions";
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
    const alive = (id, epoch) => String(getUser()?.id) === id && owner === id && generation === epoch;
    const enabled = () => getConfig()?.friends_enabled === true;
    const personId = (person) => String(person.user_id);
    const allPeople = () => [...(data.friends?.friends || []), ...(data.requests?.incoming || []), ...(data.requests?.outgoing || []), ...(data.suggestions?.suggestions || []), ...(data.classmates || []), ...(data.blocked || []), ...searchResults];
    const relation = (person) => relationshipFor(person, { friends: data.friends?.friends, incoming: data.requests?.incoming, outgoing: data.requests?.outgoing });
    const button = (action, id, label, disabled = false) => `<button class="secondary-button" type="button" data-friend-action="${action}" data-person-id="${esc(id)}" ${disabled || busy.has(id) ? "disabled" : ""}>${busy.has(id) ? "Working…" : esc(label)}</button>`;

    function row(person, { blocked = false, suggested = false } = {}) {
        const id = personId(person);
        const state = blocked ? "blocked" : relation(person);
        const name = person.name || [person.first_name, person.last_name].filter(Boolean).join(" ") || person.username || "Valid user";
        const description = suggested ? suggestionDescription(person) : person.username ? `@${person.username}` : person.school_name || "";
        const warning = person.held || person.connection?.known === false
            ? `<small class="friend-warning">You may not know this person.${person.requester_is_adult ? " This account is an adult." : ""}</small>` : "";
        // Held request text must never enter the DOM, even if a stale response
        // accidentally still carries a preview field.
        const preview = person.messages_held === true || (person.messages_held == null && person.held) ? "" : person.latest_message_body || person.first_message_body || "";
        let actions = "";
        if (state === "blocked") actions = button("unblock", id, "Unblock");
        else if (state === "unavailable" || state === "self") actions = button("none", id, state === "self" ? "You" : "Unavailable", true);
        else if (state === "added_you") actions = `${button("accept", id, "Accept")}${button("decline", id, "Decline")}`;
        else if (state === "requested") actions = `<span class="friend-state">Pending</span>${button("cancel", id, "Cancel request")}`;
        else if (state === "added") actions = `${button("message", id, "Message")}${button("remove", id, "Remove friend")}`;
        else actions = button("add", id, "Add friend");
        if (suggested && state === "none") actions += button("dismiss", id, "Dismiss suggestion");
        return `<article class="friend-row" data-friend-row="${esc(id)}"><button class="friend-person" type="button" data-friend-profile="${esc(id)}" ${blocked ? "disabled" : ""}>${avatarMarkup(person, "row-avatar")}<span><strong>${esc(name)}</strong><small>${esc(description)}</small>${warning}${preview ? `<small>${esc(preview)}</small>` : ""}</span></button><div class="friend-row-actions">${actions}</div></article>`;
    }

    function section(key, rows, empty, options = {}) {
        if (errors[key]) return `<div class="empty-card"><p>${esc(errors[key])}</p><button class="secondary-button" type="button" data-friends-retry>Try again</button></div>`;
        if (!data[key]) return `<p role="status">${loading ? "Loading…" : "Open this section to load it."}</p>`;
        return rows.length ? rows.map((person) => row(person, options)).join("") : `<div class="empty-card"><p>${esc(empty)}</p></div>`;
    }

    function render() {
        if (!dialog.open) return;
        const focused = document.activeElement;
        const selection = focused?.id === "friendsSearch" ? [focused.selectionStart, focused.selectionEnd] : null;
        const tabs = [["suggestions", "Suggested"], ["classmates", "Classmates"], ["friends", "Friends"], ["requests", "Requests"], ["privacy", "Privacy"], ["blocked", "Blocked"]];
        let content = "";
        if (query) content = searchLoading ? `<p role="status">Searching…</p>` : searchError ? `<p role="status">${esc(searchError)}</p><button class="secondary-button" type="button" data-search-retry>Try again</button>` : searchResults.length ? searchResults.map((person) => row(person)).join("") : `<p>No matching people. Try an exact username or a classmate's name.</p>`;
        else if (tab === "suggestions") content = section("suggestions", data.suggestions?.enabled === true ? data.suggestions.suggestions : [], data.suggestions?.enabled === false ? "Suggestions are not available right now. Find classmates or search by username." : "You're all caught up. Check classmates or search for someone.", { suggested: true });
        else if (tab === "classmates") content = section("classmates", data.classmates || [], "No classmates are visible yet.");
        else if (tab === "friends") content = `${section("friends", data.friends?.friends || [], "Your friends will appear here after a request is accepted.")}${data.friends?.next_cursor ? '<button class="secondary-button" type="button" data-friends-more>Load more friends</button>' : ""}`;
        else if (tab === "requests") content = `<h3>Received</h3>${section("requests", data.requests?.incoming || [], "No incoming requests.")}<h3>Sent</h3>${section("requests", data.requests?.outgoing || [], "No pending requests.")}`;
        else if (tab === "blocked") content = section("blocked", data.blocked || [], "No blocked accounts.", { blocked: true });
        else if (tab === "privacy") content = privacyMarkup();
        dialog.innerHTML = `<div class="modal-heading"><h2>Add Friends</h2><button class="icon-button" type="button" data-friends-close aria-label="Close Add Friends">×</button></div>
            <form class="friends-search-form" role="search"><label for="friendsSearch">Find people</label><input id="friendsSearch" type="search" maxlength="64" placeholder="${data.requests?.can_add_people === false ? "Search classmates" : "Username or classmate name"}" autocomplete="off" value="${esc(query)}"><button type="submit" class="secondary-button">Search</button></form>
            <div class="friends-tabs" role="group" aria-label="Friends sections">${tabs.map(([key, name]) => `<button type="button" data-friends-tab="${key}" aria-pressed="${!query && tab === key}">${name}${key === "requests" && data.requests?.incoming.length ? ` (${data.requests.incoming.length})` : ""}</button>`).join("")}</div>
            ${getConfig()?.add_links_enabled === true ? '<button class="text-button" type="button" data-my-code>My link & QR code</button><button class="text-button" type="button" data-open-add-link>Open a link or QR code</button>' : ""}
            <p class="status-message" role="status">${esc(actionError)}</p><div class="friends-content" aria-busy="${loading || searchLoading}">${content}</div>`;
        if (selection) {
            const input = dialog.querySelector("#friendsSearch");
            input.focus({ preventScroll: true });
            // type=search supports selection in all supported engines.
            input.setSelectionRange?.(...selection);
        }
    }

    function privacyMarkup() {
        if (errors.privacy) return `<p>${esc(errors.privacy)}</p><button type="button" data-friends-retry>Try again</button>`;
        if (!data.reach || !data.messages) return '<p role="status">Loading privacy settings…</p>';
        const reach = data.reach, messages = data.messages;
        const locked = reach.forced || reach.locked_by_parent;
        return `<h3>Who can add you</h3>${reach.available || locked ? `<label class="friend-setting"><span><strong>School and contacts only</strong><small>${locked ? "This protection is required or managed by your parent." : "Only your school and contacts can find and add you. This also limits who you can add."}</small></span><input type="checkbox" data-friend-setting="reach" ${reach.school_contacts_only ? "checked" : ""} ${locked || !reach.available || busy.has("privacy") ? "disabled" : ""}></label>` : '<p>Adding people is unavailable for this account.</p>'}
        <h3>Messaging</h3>${messages.available || messages.locked_by_parent ? `<label class="friend-setting"><span><strong>Message requests from anyone</strong><small>${messages.locked_by_parent ? "Managed by your parent." : "Messages from people you don't know wait in Requests. Server age and safety restrictions still apply."}</small></span><input type="checkbox" data-friend-setting="messages" ${messages.from_anyone ? "checked" : ""} ${messages.locked_by_parent || !messages.available || busy.has("privacy") ? "disabled" : ""}></label>` : '<p>Message requests from strangers are unavailable for this account.</p>'}`;
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
            } else errors[key] = result.reason.message || "Couldn't load this section.";
        }
        errors.privacy = errors.reach || errors.messages;
        loading = false;
        render();
        onChanged?.();
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
        const people = new Map();
        if (results[1].status === "fulfilled") results[1].value.forEach((person) => people.set(personId(person), person));
        if (results[0].status === "fulfilled" && results[0].value) people.set(personId(results[0].value), results[0].value);
        searchResults = [...people.values()];
        const failure = results.find((result) => result.status === "rejected" && result.reason.status !== 404);
        searchError = failure && !searchResults.length ? failure.reason.message : "";
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
        const person = allPeople().find((p) => personId(p) === id);
        if (!person) return;
        if (["remove", "block", "report"].includes(action) && !confirm(`${action === "remove" ? "Remove friend" : action === "block" ? "Block" : "Report and block"} ${person.first_name || "this account"}?`)) return;
        if (action === "message") { dialog.close(); return openChat(person); }
        const mutations = {
            add: () => api.sendFriendRequest(owner, id, linkSource), accept: () => api.acceptFriendRequest(owner, id),
            decline: () => api.declineFriendRequest(owner, id), cancel: () => api.cancelFriendRequest(owner, id),
            remove: () => api.removeFriend(owner, id), block: () => api.blockUser(owner, id),
            unblock: () => api.unblockUser(owner, id), report: () => api.reportUser(owner, id),
            dismiss: () => api.dismissFriendSuggestion(owner, id),
        };
        if (!mutations[action]) return;
        const account = owner;
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
            if (query) await search();
            onChanged?.({ action, userId: id });
        } catch (error) {
            if (String(getUser()?.id) !== account || owner !== account) return;
            actionError = error.message || "Couldn't update this person. Try again.";
            // A timed out write may have committed; repair before another tap.
            await refresh();
        } finally { if (owner === account) { busy.delete(id); render(); } }
    }

    async function open({ section: requested = "suggestions", username = null, source = "link", person = null } = {}) {
        if (!enabled() || !getUser()?.id) return;
        const id = String(getUser().id);
        if (owner !== id) clear();
        owner = id; tab = requested; query = ""; actionError = "";
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
            } catch (error) { if (alive(id, epoch)) { searchResults = []; searchError = error.message; } }
            if (alive(id, epoch)) { searchLoading = false; render(); }
        }
    }

    async function myCode() {
        const id = owner, epoch = generation;
        try {
            const response = await api.getAddLink(id);
            if (!alive(id, epoch) || !dialog.open) return;
            link = response;
            if (!link.available || !link.url) { actionError = "An Add me link is unavailable for this account."; render(); return; }
            dialog.querySelector(".friends-content").innerHTML = `<h3>My link & QR code</h3><p>People can use this link to request to be friends.</p><div data-friend-qr></div><p class="friend-link">${esc(link.url)}</p><button class="primary-button" type="button" data-share-add-link>Share link</button><label class="friend-setting">Link enabled<input type="checkbox" data-add-link-enabled ${link.enabled ? "checked" : ""}></label><p data-add-link-status role="status">${link.enabled ? "Your link is active." : "Your link is off. A completed share turns it on."}</p>`;
            const { toCanvas } = await import("./qr.js");
            if (!alive(id, epoch) || !dialog.open) return;
            const canvas = document.createElement("canvas");
            canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", "QR code for your Add me link");
            await toCanvas(canvas, link.url, { width: 240, margin: 2 });
            dialog.querySelector("[data-friend-qr]")?.append(canvas);
        } catch (error) { if (alive(id, epoch)) { actionError = error.message; render(); } }
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
        } catch (error) { if (error.name !== "AbortError" && owner === id) { actionError = error.message; render(); } }
    }

    function clear() {
        ++generation; ++searchGeneration; clearTimeout(timer);
        owner = null; data = {}; errors = {}; searchResults = []; busy = new Set();
        query = ""; link = null; linkSource = null; returnFromProfile = false;
        if (dialog.open) dialog.close();
        dialog.replaceChildren();
    }

    dialog.addEventListener("input", (event) => {
        if (event.target.id !== "friendsSearch") return;
        query = event.target.value; linkSource = null; ++searchGeneration;
        clearTimeout(timer); timer = setTimeout(search, 300);
    });
    dialog.addEventListener("submit", (event) => { event.preventDefault(); clearTimeout(timer); void search(); });
    dialog.addEventListener("click", (event) => {
        const target = event.target.closest("button");
        if (!target || target.disabled) return;
        if (target.matches("[data-friends-close]")) return dialog.close();
        if (target.dataset.friendsTab) { tab = target.dataset.friendsTab; query = ""; ++searchGeneration; clearTimeout(timer); render(); return void refresh(); }
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
            const input = prompt("Paste a Valid Add me link, including a link read by your camera's QR scanner:");
            if (input === null) return;
            const username = parseAddLink(input.trim());
            if (username) void open({ username, source: "qr" });
            else { actionError = "Use a https://validapp.lol/add/username link."; render(); }
        }
    });
    dialog.addEventListener("change", async (event) => {
        const input = event.target;
        if (!input.matches("[data-friend-setting], [data-add-link-enabled]")) return;
        const id = owner;
        if (busy.has("privacy")) return;
        busy.add("privacy"); input.disabled = true;
        try {
            if (input.matches("[data-add-link-enabled]")) link = await api.updateAddLink(id, input.checked);
            else if (input.dataset.friendSetting === "reach") data.reach = await api.updateFriendReach(id, input.checked);
            else data.messages = await api.updateMessageRequests(id, input.checked);
        } catch (error) { if (owner === id) actionError = error.message; }
        finally { if (owner === id) { busy.delete("privacy"); await refresh(); } }
    });
    window.addEventListener("focus", () => { if (dialog.open && owner) void refresh(); });
    window.addEventListener("online", () => { if (dialog.open && owner) void refresh(); });
    return { open, refresh, clear, relationship: relation, returnFromProfile() { if (!returnFromProfile) return false; returnFromProfile = false; if (owner && enabled()) { dialog.showModal(); render(); void refresh(); } return true; } };
}
