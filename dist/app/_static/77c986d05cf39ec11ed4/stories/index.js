import { uiIcon } from "../ui-icons.js";
import { mediaImageMarkup } from "../media-url.js";
import { userMessage } from "../user-message.js";
// The Story queue (StoryPostQueue) is shared with the camera's Send to.
const loadQueue = () => import("../camera/capture-queue.js");
const STORY_QUEUE_EVENT = "valid:story-queue";

const REFRESH_MS = 30_000;

function safeURL(value, api) {
    if (!value) return "";
    try {
        const url = new URL(api.assetURL(value));
        return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch (_) {
        return "";
    }
}

function displayName(author = {}) {
    return [author.first_name, author.last_name].filter(Boolean).join(" ").trim() || author.username || "Student";
}

// The Story rail's + opens the live camera with My Story ticked in Send to
// (FeedView onCreate → CameraFirstFlowView(startsWithStory: true)).
export function createStoriesView({ root, api, getUser, getProfile = getUser, getConfig = () => null, escapeHTML, showToast, onCreate = null }) {
    let authors = [];
    let loading = false;
    let lastLoaded = 0;
    let viewerPromise = null;
    // The own label: "Posting…", "Tap to retry", or "Your Story" (StoryStrip).
    let postStatus = null;
    let postStatusGeneration = 0;

    root.innerHTML = `
        <section class="stories-shell" aria-label="Stories">
            <p class="stories-status" role="status"></p>
            <div class="stories-rail"></div>
        </section>
        <dialog class="story-failed-sheet ui-sheet" aria-labelledby="storyFailedTitle">
            <div class="ui-sheet-content">
                <span class="ui-sheet-grabber" aria-hidden="true"></span>
                <h2 id="storyFailedTitle">Your Story didn't post</h2>
                <div class="story-failed-actions">
                    <button type="button" class="primary-button" data-story-retry>Try again</button>
                    <button type="button" class="danger-button" data-story-discard>Discard</button>
                    <button type="button" class="secondary-button" data-story-failed-cancel>Cancel</button>
                </div>
            </div>
        </dialog>`;

    const $ = (selector) => root.querySelector(selector);
    root.addEventListener("click", handleClick);
    $(".story-failed-sheet").addEventListener("click", (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
    window.addEventListener("online", () => void resumeStories());
    window.addEventListener(STORY_QUEUE_EVENT, () => void refreshPostStatus());
    window.addEventListener("valid:capture-sent", (event) => { if (event.detail?.kind === "story") void activate({ force: true }); });

    // The viewer, its sheets, and their gestures load on first use.
    function loadViewer() {
        viewerPromise ||= import("./viewer.js").then(({ createStoryViewer }) => createStoryViewer({
            root, api, getUser, getConfig, escapeHTML, showToast, displayName,
            safeURL: (value) => safeURL(value, api),
            onViewed: () => renderRail(),
            onChanged: () => activate({ force: true }),
        })).catch((error) => {
            viewerPromise = null;
            throw error;
        });
        return viewerPromise;
    }

    async function openViewer(authorIndex, itemIndex = null, { viewers = false } = {}) {
        try {
            const viewer = await loadViewer();
            viewer.open(authors, authorIndex, itemIndex);
            if (viewers && authors[authorIndex]?.is_owner) await viewer.showViewers();
        } catch (error) {
            showToast?.(userMessage(error, "Couldn't open this Story. Try again."));
        }
    }

    function renderRail() {
        // Your Story first, then people with something new, then the rest (StoryStrip).
        const visibleAuthors = authors.filter((author) => author.items?.length)
            .map((author, order) => ({ author, order }))
            .sort((left, right) => Number(Boolean(right.author.has_unviewed)) - Number(Boolean(left.author.has_unviewed)) || left.order - right.order)
            .map(({ author }) => author);
        const owner = visibleAuthors.find((author) => author.is_owner);
        const profile = getProfile() || {};
        const avatarMarkup = (name, url) => {
            const avatar = safeURL(url, api);
            return `<span class="story-avatar">${avatar ? mediaImageMarkup(avatar, { initials: name.slice(0, 1).toUpperCase() }) : `<span>${escapeHTML(name.slice(0, 1).toUpperCase())}</span>`}</span>`;
        };
        const addBadge = `<span class="story-add-badge" aria-hidden="true">${uiIcon("plus")}</span>`;
        const label = postStatus === "posting" ? "Posting…" : postStatus === "failed" ? "Tap to retry" : "Your Story";
        const pending = label !== "Your Story";
        // Always reserve the first position for the viewer, even on an empty or
        // unavailable feed. The additional-story action is a sibling, not a nested button.
        const ownStory = owner
            ? `<div class="own-story"><button type="button" data-story-author="${authors.indexOf(owner)}" class="story-author-button unviewed ${pending ? `story-${postStatus}` : ""}" aria-label="${pending ? `Your Story, ${label}` : "Open Your Story"}">${avatarMarkup("Your Story", owner.profile_picture_url || profile.profile_picture_url)}<small>${label}</small></button><button class="story-add-another" type="button" data-create-story aria-label="Add another Story">${addBadge}</button></div>`
            : `<div class="own-story"><button class="story-author-button ${pending ? `story-${postStatus}` : ""}" type="button" data-create-story aria-label="${pending ? `Your Story, ${label}` : "Add to Your Story"}"><span class="story-avatar-wrap">${avatarMarkup(displayName(profile), profile.profile_picture_url)}${addBadge}</span><small>${label}</small></button></div>`;
        $(".stories-rail").innerHTML = ownStory + visibleAuthors.filter(author => !author.is_owner).map((author) => {
            const name = displayName(author);
            const label = `${name}'s Story${author.has_unviewed ? ", new" : ""}`;
            return `<button type="button" data-story-author="${authors.indexOf(author)}" class="story-author-button ${author.has_unviewed ? "unviewed" : ""}" aria-label="${escapeHTML(label)}">${avatarMarkup(name, author.profile_picture_url)}<small>${escapeHTML(name)}</small></button>`;
        }).join("");
    }
    renderRail();

    async function refreshPostStatus() {
        const generation = ++postStatusGeneration;
        const { storyPostStatus } = await loadQueue();
        const status = await storyPostStatus(getUser()?.id);
        if (generation !== postStatusGeneration || status === postStatus) return;
        postStatus = status;
        renderRail();
    }

    async function resumeStories() {
        if (!getUser()?.id) return;
        const { resumeQueue } = await loadQueue();
        await resumeQueue(api, getUser().id, { showToast });
    }

    async function activate({ force = false } = {}) {
        if (!loading && (force || !lastLoaded || Date.now() - lastLoaded >= REFRESH_MS)) await load();
        await openRequestedStory();
    }

    async function load() {
        loading = true;
        $(".stories-status").textContent = authors.length ? "Refreshing…" : "Loading…";
        try {
            const result = await api.getStories(getUser().id);
            authors = (result.authors || []).filter((author) => Array.isArray(author.items) && author.items.length);
            lastLoaded = Date.now();
            renderRail();
            $(".stories-status").textContent = "";
            if (authors.length) void loadViewer().catch(() => null);
            void refreshPostStatus();
            void resumeStories().catch(() => null);
        } catch (error) {
            $(".stories-status").textContent = userMessage(error, "Stories unavailable");
        } finally {
            loading = false;
        }
    }

    // `?story=<id>` opens that Story; `&viewers=1` (a story_capture
    // notification) also opens its viewers list when it is the viewer's own.
    async function openRequestedStory() {
        const params = new URLSearchParams(location.search);
        const storyId = params.get("story");
        const viewers = params.get("viewers") === "1";
        if (!storyId || !lastLoaded) return;
        const viewer = await loadViewer().catch(() => null);
        if (viewer?.isOpen()) return;
        const index = authors.findIndex((author) => author.items.some((item) => String(item.id) === String(storyId)));
        if (index < 0) {
            const url = new URL(location.href);
            url.searchParams.delete("story");
            url.searchParams.delete("viewers");
            history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
            return showToast?.("That Story is unavailable or has expired.");
        }
        const itemIndex = authors[index].items.findIndex((item) => String(item.id) === String(storyId));
        if (viewers) {
            // Handled once: a reload or refresh must not reopen the list.
            const url = new URL(location.href);
            url.searchParams.delete("viewers");
            history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
        }
        await openViewer(index, itemIndex, { viewers });
    }

    // Tap: a failed post asks first ("Your Story didn't post"); otherwise
    // your Story opens, or the camera when there is none (StoryStrip).
    function handleClick(event) {
        const target = event.target.closest("button");
        if (!target) return;
        if (target.matches("[data-story-retry]")) { $(".story-failed-sheet").close(); return void loadQueue().then(({ retryFailedStories }) => retryFailedStories(api, getUser().id, { showToast })); }
        if (target.matches("[data-story-discard]")) { $(".story-failed-sheet").close(); return void loadQueue().then(({ discardFailedStories }) => discardFailedStories(getUser().id)); }
        if (target.matches("[data-story-failed-cancel]")) return $(".story-failed-sheet").close();
        const own = target.closest(".own-story");
        if (own && postStatus === "failed" && !target.matches(".story-add-another")) return $(".story-failed-sheet").showModal();
        if (target.matches("[data-create-story]")) return onCreate?.();
        if (target.dataset.storyAuthor !== undefined) return void openViewer(Number(target.dataset.storyAuthor));
    }

    return { activate, refresh: () => activate({ force: true }) };
}
