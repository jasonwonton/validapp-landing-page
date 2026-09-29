import { uiIcon } from "../ui-icons.js";
import { mediaImageMarkup } from "../media-url.js";
import { ingestEnabled, ingestSegmentCount, prepareChatMedia } from "../chat/media.js";
import {
    MAX_MEDIA_AUTOMATIC_ATTEMPTS,
    chatTextSendIsRetryable,
    listChatMediaOutbox,
    markChatMediaOutboxAttempt,
    putChatMediaOutbox,
    removeChatMediaOutbox,
} from "../chat/outbox.js";
import { setRuntimeStyles } from "../runtime-style.js";
import { createMediaOverlayPositioner } from "../media-overlay-positioner.js";
import { userMessage } from "../user-message.js";

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

export function createStoriesView({ root, api, getUser, getProfile = getUser, getConfig = () => null, escapeHTML, showToast }) {
    let authors = [];
    let loading = false;
    let lastLoaded = 0;
    let viewerPromise = null;
    let selectedStoryMedia = null;
    let selectedStoryPreview = null;
    let storyPreparationGeneration = 0;
    let storyUploadRequestId = null;
    let storyPublishRequestId = null;
    let storyRetrying = false;
    let storyRetryTimer = null;

    root.innerHTML = `
        <section class="stories-shell" aria-label="Stories">
            <p class="stories-status" role="status"></p>
            <div class="stories-rail"></div>
        </section>
        <dialog class="story-composer" aria-label="Create Story">
            <form>
                <header><button type="button" data-close-story-composer>Cancel</button><strong>New Story</strong><span></span></header>
                <div class="story-composer-preview"><span aria-hidden="true">${uiIcon("plus")}</span><p>Choose a photo or an MP4 video.</p></div>
                <div class="story-source-buttons">
                    <label class="story-source-button">${uiIcon("camera")}<span>Camera</span><input class="story-camera-input" type="file" accept="image/*,video/mp4" capture="environment"></label>
                    <label class="story-source-button">${uiIcon("photo")}<span>Library</span><input class="story-file-input" type="file" accept="image/*,video/mp4"></label>
                </div>
                <label>Caption <input class="story-caption" type="text" maxlength="120" placeholder="Optional caption"></label>
                <label>Text overlay <input class="story-overlay" type="text" maxlength="160" placeholder="Optional text — drag it in the preview"></label>
                <div class="story-upload-progress hidden"><span></span></div>
                <p class="story-composer-status" role="status"></p>
                <button class="primary-button story-publish" type="submit" disabled>Post Story</button>
            </form>
        </dialog>`;

    const $ = (selector) => root.querySelector(selector);
    const storyOverlay = createMediaOverlayPositioner({
        preview: $(".story-composer-preview"),
        input: $(".story-overlay"),
    });
    root.addEventListener("click", handleClick);
    $(".story-file-input").addEventListener("change", selectStoryMedia);
    $(".story-camera-input").addEventListener("change", selectStoryMedia);
    $(".story-composer form").addEventListener("submit", publishSelectedStory);
    $(".story-composer").addEventListener("close", resetStoryComposer);
    window.addEventListener("online", () => void retryPendingStories());

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
        // Always reserve the first position for the viewer, even on an empty or
        // unavailable feed. The additional-story action is a sibling, not a nested button.
        const ownStory = owner
            ? `<div class="own-story"><button type="button" data-story-author="${authors.indexOf(owner)}" class="story-author-button unviewed" aria-label="Your Story">${avatarMarkup("Your Story", owner.profile_picture_url || profile.profile_picture_url)}<small>Your Story</small></button><button class="story-add-another" type="button" data-create-story aria-label="Add Story" title="Add another Story">${addBadge}</button></div>`
            : `<div class="own-story"><button class="story-author-button" type="button" data-create-story aria-label="Add Story"><span class="story-avatar-wrap">${avatarMarkup(displayName(profile), profile.profile_picture_url)}${addBadge}</span><small>Your Story</small></button></div>`;
        $(".stories-rail").innerHTML = ownStory + visibleAuthors.filter(author => !author.is_owner).map((author) => {
            const name = displayName(author);
            const label = `${name}'s Story${author.has_unviewed ? ", new" : ""}`;
            return `<button type="button" data-story-author="${authors.indexOf(author)}" class="story-author-button ${author.has_unviewed ? "unviewed" : ""}" aria-label="${escapeHTML(label)}">${avatarMarkup(name, author.profile_picture_url)}<small>${escapeHTML(name)}</small></button>`;
        }).join("");
    }
    renderRail();

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
            void retryPendingStories();
        } catch (error) {
            $(".stories-status").textContent = error.message || "Stories unavailable";
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

    function openStoryComposer() {
        resetStoryComposer();
        // Longer, larger or non-MP4 clips go through the server ingest when it is on.
        $(".story-file-input").accept = ingestEnabled(api.config) ? "image/*,video/*" : "image/*,video/mp4";
        $(".story-composer").showModal();
    }

    async function selectStoryMedia(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        storyOverlay.reset();
        await prepareSelectedStoryMedia(file, {
            preserveOverlay: false,
        });
    }

    async function prepareSelectedStoryMedia(file, { preserveOverlay = false } = {}) {
        const generation = ++storyPreparationGeneration;
        $(".story-composer-status").textContent = "Preparing media…";
        $(".story-publish").disabled = true;
        $(".story-overlay").disabled = true;
        storyOverlay.setDisabled(true);
        storyUploadRequestId = null;
        storyPublishRequestId = null;
        try {
            const prepared = await prepareChatMedia(file, { config: api.config });
            if (generation !== storyPreparationGeneration) return;
            if (prepared.kind === "audio") throw new Error("Choose a photo or MP4 video for your Story.");
            selectedStoryMedia = prepared;
            if (selectedStoryPreview) URL.revokeObjectURL(selectedStoryPreview);
            selectedStoryPreview = URL.createObjectURL(selectedStoryMedia.file);
            $(".story-composer-preview").innerHTML = selectedStoryMedia.kind === "video"
                ? `<video src="${escapeHTML(selectedStoryPreview)}" muted playsinline controls aria-label="Story video preview"></video>`
                : `<img src="${escapeHTML(selectedStoryPreview)}" alt="Story photo preview" decoding="async">`;
            if (!preserveOverlay) storyOverlay.reset();
            storyOverlay.mount();
            const parts = selectedStoryMedia.ingest ? ingestSegmentCount(selectedStoryMedia.durationMs) : 1;
            $(".story-composer-status").textContent = parts > 1 ? `Posts as ${parts} Stories` : `${selectedStoryMedia.kind === "video" ? "Video" : "Photo"} ready to post`;
            $(".story-publish").disabled = false;
        } catch (error) {
            if (generation !== storyPreparationGeneration) return;
            selectedStoryMedia = null;
            $(".story-composer-status").textContent = error.message || "Could not prepare that Story.";
        } finally {
            if (generation === storyPreparationGeneration) {
                $(".story-overlay").disabled = false;
                storyOverlay.setDisabled(false);
            }
        }
    }

    async function deliverStoryRecord(record, { onProgress, onStatus } = {}) {
        // Resumes from the last finished step; long clips post one Story per segment.
        const { deliverStory } = await import("../media-delivery.js");
        return deliverStory(api, record.user_id, record, { onProgress, onStatus });
    }

    async function publishSelectedStory(event) {
        event.preventDefault();
        if (!selectedStoryMedia) return;
        const button = $(".story-publish");
        storyUploadRequestId ||= crypto.randomUUID();
        storyPublishRequestId ||= crypto.randomUUID();
        const overlayPosition = storyOverlay.value();
        const record = {
            id: `${getUser().id}:story:${storyUploadRequestId}`,
            user_id: getUser().id,
            kind: "story",
            file: selectedStoryMedia.file,
            thumbnail: selectedStoryMedia.thumbnail || null,
            content_type: selectedStoryMedia.ingest ? selectedStoryMedia.contentType : selectedStoryMedia.file.type,
            ingest: Boolean(selectedStoryMedia.ingest),
            duration_ms: selectedStoryMedia.durationMs,
            caption: $(".story-caption").value.trim() || null,
            overlay: $(".story-overlay").value.trim() ? { text: $(".story-overlay").value.trim(), ...overlayPosition } : null,
            upload_request_id: storyUploadRequestId,
            publish_request_id: storyPublishRequestId,
        };
        button.disabled = true;
        button.textContent = "Posting…";
        storyOverlay.setDisabled(true);
        $(".story-upload-progress").classList.remove("hidden");
        let saved = false;
        try {
            await putChatMediaOutbox(record);
            saved = true;
            await deliverStoryRecord(record, {
                onStatus: (text) => { $(".story-composer-status").textContent = text; },
                onProgress: (progress) => { setRuntimeStyles($(".story-upload-progress span"), { width: `${Math.round(progress * 100)}%` }); },
            });
            await removeChatMediaOutbox(record.id);
            $(".story-composer").close();
            showToast?.("Story posted");
            await activate({ force: true });
        } catch (error) {
            if (saved && chatTextSendIsRetryable(error)) {
                await markChatMediaOutboxAttempt(record.id).catch(() => null);
                $(".story-composer-status").textContent = `${error.message || "Could not post your Story."} It is saved on this device and will retry while Valid is open.`;
                scheduleStoryRetry(await listChatMediaOutbox(getUser().id).catch(() => []));
            } else {
                await removeChatMediaOutbox(record.id).catch(() => null);
                $(".story-composer-status").textContent = saved
                    ? (error.message || "Could not post your Story.")
                    : "This Story could not be saved for a safe retry. Free some device storage and try again.";
            }
        } finally {
            button.textContent = "Post Story";
            button.disabled = !selectedStoryMedia;
        }
    }

    function scheduleStoryRetry(records) {
        clearTimeout(storyRetryTimer);
        storyRetryTimer = null;
        const next = records.filter((record) => record.kind === "story" && Number(record.attempts || 0) < MAX_MEDIA_AUTOMATIC_ATTEMPTS)
            .reduce((earliest, record) => Math.min(earliest, Number(record.next_attempt_at || 0)), Infinity);
        if (!Number.isFinite(next)) return;
        storyRetryTimer = setTimeout(() => void retryPendingStories(), Math.max(2_000, Math.min(5 * 60_000, next - Date.now())));
    }

    async function retryPendingStories() {
        if (storyRetrying || navigator.onLine === false || !getUser()?.id) return;
        storyRetrying = true;
        let completed = 0;
        try {
            const records = await listChatMediaOutbox(getUser().id).catch(() => []);
            const due = records.filter((record) => record.kind === "story"
                && Number(record.attempts || 0) < MAX_MEDIA_AUTOMATIC_ATTEMPTS
                && Number(record.next_attempt_at || 0) <= Date.now()).slice(0, 2);
            for (const record of due) {
                try {
                    await deliverStoryRecord(record);
                    await removeChatMediaOutbox(record.id);
                    completed += 1;
                } catch (error) {
                    if (chatTextSendIsRetryable(error)) await markChatMediaOutboxAttempt(record.id);
                    else await removeChatMediaOutbox(record.id);
                }
            }
            const remaining = await listChatMediaOutbox(getUser().id).catch(() => []);
            scheduleStoryRetry(remaining);
            if (completed) {
                showToast?.(`${completed} saved ${completed === 1 ? "Story" : "Stories"} posted`);
                await activate({ force: true });
            }
        } finally { storyRetrying = false; }
    }

    function resetStoryComposer() {
        storyPreparationGeneration += 1;
        selectedStoryMedia = null;
        if (selectedStoryPreview) URL.revokeObjectURL(selectedStoryPreview);
        selectedStoryPreview = null;
        storyOverlay.reset();
        storyUploadRequestId = null;
        storyPublishRequestId = null;
        $(".story-file-input").value = "";
        $(".story-camera-input").value = "";
        $(".story-caption").value = "";
        $(".story-overlay").value = "";
        $(".story-composer-preview").innerHTML = `<span aria-hidden="true">${uiIcon("plus")}</span><p>Choose a photo or an MP4 video.</p>`;
        $(".story-composer-status").textContent = "";
        $(".story-upload-progress").classList.add("hidden");
        setRuntimeStyles($(".story-upload-progress span"), { width: "0" });
        $(".story-publish").textContent = "Post Story";
        $(".story-publish").disabled = true;
    }

    function handleClick(event) {
        const target = event.target.closest("button");
        if (!target) return;
        if (target.matches("[data-create-story]")) return openStoryComposer();
        if (target.matches("[data-close-story-composer]")) return $(".story-composer").close();
        if (target.dataset.storyAuthor !== undefined) return void openViewer(Number(target.dataset.storyAuthor));
    }

    return { activate, refresh: () => activate({ force: true }) };
}
