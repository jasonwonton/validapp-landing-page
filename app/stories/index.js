import { prepareChatMedia } from "../chat/media.js";
import {
    MAX_MEDIA_AUTOMATIC_ATTEMPTS,
    chatTextSendIsRetryable,
    listChatMediaOutbox,
    markChatMediaOutboxAttempt,
    putChatMediaOutbox,
    removeChatMediaOutbox,
} from "../chat/outbox.js";
import { setRuntimeStyles } from "../runtime-style.js";

const REFRESH_MS = 30_000;
const MAX_RECORDED_VIEWS = 200;
const MAX_STORY_VIEWERS = 500;

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

export function createStoriesView({ root, api, getUser, escapeHTML, showToast }) {
    let authors = [];
    let authorIndex = 0;
    let itemIndex = 0;
    let loading = false;
    let lastLoaded = 0;
    let cancelMediaWait = null;
    let viewerCursor = null;
    let viewerRows = [];
    let selectedStoryMedia = null;
    let selectedStoryPreview = null;
    let storyUploadRequestId = null;
    let storyPublishRequestId = null;
    let storyRetrying = false;
    let storyRetryTimer = null;
    let sharePeople = [];
    const shareSelected = new Set();
    const storyDeliveryIntents = new Map();
    const recordedViews = new Set();

    root.innerHTML = `
        <section class="stories-shell hidden" aria-label="Stories">
            <header><strong>Stories</strong><span class="stories-status" role="status"></span><button type="button" data-create-story aria-label="Add Story">＋</button></header>
            <div class="stories-rail"></div>
        </section>
        <dialog class="story-viewer" aria-label="Story viewer">
            <div class="story-progress" aria-hidden="true"></div>
            <header><div class="story-author"></div><button type="button" data-close-story aria-label="Close Story">×</button></header>
            <div class="story-media"><img alt="" decoding="async" hidden><video playsinline controls hidden></video><span class="story-text-overlay" hidden></span></div>
            <div class="story-copy"><p></p><small></small></div>
            <button class="story-previous" type="button" data-previous-story aria-label="Previous Story">‹</button>
            <button class="story-next" type="button" data-next-story aria-label="Next Story">›</button>
            <form class="story-reply"><input type="text" maxlength="2000" placeholder="Reply to Story" aria-label="Reply to Story"><button type="submit">Send</button></form>
            <footer><button type="button" data-share-story>Share</button><button type="button" data-story-viewers hidden>Viewers</button><button type="button" data-delete-story hidden>Delete Story</button><button type="button" data-report-story hidden>Report Story</button></footer>
        </dialog>
        <dialog class="story-viewers-sheet" aria-label="Story viewers"><header><strong>Story viewers</strong><button type="button" data-close-story-viewers>Done</button></header><div></div></dialog>
        <dialog class="story-composer" aria-label="Create Story">
            <form>
                <header><button type="button" data-close-story-composer>Cancel</button><strong>New Story</strong><span></span></header>
                <div class="story-composer-preview"><span aria-hidden="true">＋</span><p>Choose a photo or an MP4 video.</p></div>
                <input class="story-file-input" type="file" accept="image/*,video/mp4" capture="environment">
                <label>Caption <input class="story-caption" type="text" maxlength="120" placeholder="Optional caption"></label>
                <label>Text overlay <input class="story-overlay" type="text" maxlength="160" placeholder="Optional centered text"></label>
                <div class="story-upload-progress hidden"><span></span></div>
                <p class="story-composer-status" role="status"></p>
                <button class="primary-button story-publish" type="submit" disabled>Post Story</button>
            </form>
        </dialog>
        <dialog class="story-share-sheet" aria-label="Share Story">
            <form>
                <header><strong>Send Story</strong><button type="button" data-close-story-share>Done</button></header>
                <input class="story-share-search" type="search" placeholder="Search classmates" aria-label="Search classmates">
                <p class="story-share-status" role="status"></p>
                <div class="story-share-people"></div>
                <button class="primary-button story-share-send" type="submit" disabled>Send Story</button>
            </form>
        </dialog>`;

    const $ = (selector) => root.querySelector(selector);
    root.addEventListener("click", handleClick);
    $(".story-file-input").addEventListener("change", selectStoryMedia);
    $(".story-composer form").addEventListener("submit", publishSelectedStory);
    $(".story-composer").addEventListener("close", resetStoryComposer);
    $(".story-reply").addEventListener("submit", sendStoryReply);
    $(".story-share-sheet form").addEventListener("submit", sendSharedStory);
    $(".story-share-search").addEventListener("input", renderSharePeople);
    $(".story-share-people").addEventListener("change", updateShareSelection);
    window.addEventListener("online", () => void retryPendingStories());
    $(".story-viewer").addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight") { event.preventDefault(); void next(); }
        if (event.key === "ArrowLeft") { event.preventDefault(); void previous(); }
    });
    $(".story-viewer").addEventListener("close", () => { resetMedia(); clearStoryURL(); });

    function currentAuthor() { return authors[authorIndex] || null; }
    function currentItem() { return currentAuthor()?.items?.[itemIndex] || null; }

    function renderRail() {
        const shell = $(".stories-shell");
        const visibleAuthors = authors.filter((author) => author.items?.length);
        shell.classList.toggle("hidden", !visibleAuthors.length);
        $(".stories-rail").innerHTML = visibleAuthors.map((author) => {
            const index = authors.indexOf(author);
            const name = author.is_owner ? "Your Story" : displayName(author);
            const avatar = safeURL(author.profile_picture_url, api);
            const label = `${name}'s Story${author.has_unviewed ? ", new" : ""}`.replace("Your Story's Story", "Your Story");
            return `<button type="button" data-story-author="${index}" class="${author.has_unviewed ? "unviewed" : ""}" aria-label="${escapeHTML(label)}"><span>${avatar ? `<img src="${escapeHTML(avatar)}" alt="" loading="lazy" decoding="async">` : escapeHTML(name.slice(0, 1))}</span><small>${escapeHTML(name)}</small></button>`;
        }).join("");
    }

    async function activate({ force = false } = {}) {
        if (loading || (!force && lastLoaded && Date.now() - lastLoaded < REFRESH_MS)) return;
        loading = true;
        $(".stories-status").textContent = authors.length ? "Refreshing…" : "Loading…";
        try {
            const result = await api.getStories(getUser().id);
            authors = (result.authors || []).filter((author) => Array.isArray(author.items) && author.items.length);
            lastLoaded = Date.now();
            renderRail();
            $(".stories-status").textContent = "";
            const requestedStoryId = new URLSearchParams(location.search).get("story");
            if (requestedStoryId && !$(".story-viewer").open) openStoryById(requestedStoryId);
            void retryPendingStories();
        } catch (error) {
            $(".stories-status").textContent = error.message || "Stories unavailable";
        } finally {
            loading = false;
        }
    }

    function resetMedia() {
        cancelMediaWait?.();
        cancelMediaWait = null;
        const video = $(".story-media video");
        video.pause();
        video.removeAttribute("src");
        video.load();
        $(".story-media img").removeAttribute("src");
    }

    function waitForMedia(item) {
        const media = item.media_type === "video" ? $(".story-media video") : $(".story-media img");
        if (item.media_type === "video" && media.readyState >= 1) return Promise.resolve();
        if (item.media_type !== "video" && media.complete && media.naturalWidth) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const success = item.media_type === "video" ? "loadedmetadata" : "load";
            const cleanup = () => {
                clearTimeout(timeout);
                media.removeEventListener(success, loaded);
                media.removeEventListener("error", failed);
                if (cancelMediaWait === cancelled) cancelMediaWait = null;
            };
            const loaded = () => { cleanup(); resolve(); };
            const failed = () => { cleanup(); reject(new Error("This Story could not be opened.")); };
            const cancelled = () => {
                cleanup();
                reject(new DOMException("Story load replaced", "AbortError"));
            };
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error("This Story took too long to open."));
            }, 10_000);
            cancelMediaWait?.();
            cancelMediaWait = cancelled;
            media.addEventListener(success, loaded, { once: true });
            media.addEventListener("error", failed, { once: true });
        });
    }

    function rememberRecordedView(id) {
        if (recordedViews.size >= MAX_RECORDED_VIEWS) recordedViews.delete(recordedViews.values().next().value);
        recordedViews.add(id);
    }

    async function showCurrent() {
        const author = currentAuthor();
        const item = currentItem();
        if (!author || !item) return closeViewer();
        const mediaURL = safeURL(item.media_url, api);
        if (!mediaURL) {
            closeViewer();
            return showToast?.("This Story is unavailable.");
        }
        resetMedia();
        const image = $(".story-media img");
        const video = $(".story-media video");
        image.hidden = item.media_type === "video";
        video.hidden = item.media_type !== "video";
        (item.media_type === "video" ? video : image).src = mediaURL;
        image.alt = item.media_type === "photo" ? `${displayName(author)}'s Story` : "";
        $(".story-author").innerHTML = `<strong>${escapeHTML(author.is_owner ? "Your Story" : displayName(author))}</strong><small>${itemIndex + 1} of ${author.items.length}</small>`;
        $(".story-progress").innerHTML = author.items.map((_, index) => `<i class="${index <= itemIndex ? "viewed" : ""}"></i>`).join("");
        const overlay = $(".story-text-overlay");
        overlay.hidden = !item.text_overlay;
        overlay.textContent = item.text_overlay || "";
        setRuntimeStyles(overlay, {
            left: `${Number(item.text_overlay_x ?? 0.5) * 100}%`,
            top: `${Number(item.text_overlay_y ?? 0.5) * 100}%`,
        });
        $(".story-copy p").textContent = item.caption || "";
        $(".story-copy small").textContent = `Expires ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(item.expires_at))}`;
        $("[data-story-viewers]").hidden = !author.is_owner;
        $("[data-delete-story]").hidden = !author.is_owner;
        $("[data-report-story]").hidden = author.is_owner;
        $(".story-reply").classList.toggle("hidden", author.is_owner);
        const dialog = $(".story-viewer");
        if (!dialog.open) dialog.showModal();
        try {
            await waitForMedia(item);
            if (!author.is_owner && !recordedViews.has(String(item.id))) {
                rememberRecordedView(String(item.id));
                await api.recordStoryView(getUser().id, item.id);
                item.viewer_has_viewed = true;
                author.has_unviewed = author.items.some((candidate) => !candidate.viewer_has_viewed);
                renderRail();
            }
        } catch (error) {
            recordedViews.delete(String(item.id));
            if (error.name === "AbortError") return;
            showToast?.(error.message || "This Story could not be opened.");
        }
    }

    function openAuthor(index) {
        authorIndex = Math.max(0, Math.min(authors.length - 1, Number(index) || 0));
        const items = currentAuthor()?.items || [];
        itemIndex = Math.max(0, items.findIndex((item) => !item.viewer_has_viewed));
        updateStoryURL();
        void showCurrent();
    }

    function openStoryById(storyId) {
        const index = authors.findIndex((author) => author.items.some((item) => String(item.id) === String(storyId)));
        if (index < 0) return showToast?.("That Story is unavailable or has expired.");
        authorIndex = index;
        itemIndex = authors[index].items.findIndex((item) => String(item.id) === String(storyId));
        void showCurrent();
    }

    function updateStoryURL() {
        const item = currentItem();
        if (!item) return;
        const url = new URL(location.href);
        url.searchParams.set("story", item.id);
        history.replaceState(history.state, "", `${url.pathname}${url.search}`);
    }

    function closeViewer() {
        const dialog = $(".story-viewer");
        if (dialog.open) dialog.close();
        else clearStoryURL();
    }

    function clearStoryURL() {
        const url = new URL(location.href);
        if (url.searchParams.has("story")) {
            url.searchParams.delete("story");
            history.replaceState(history.state, "", `${url.pathname}${url.search}`);
        }
    }

    async function next() {
        if (itemIndex + 1 < (currentAuthor()?.items?.length || 0)) itemIndex += 1;
        else if (authorIndex + 1 < authors.length) { authorIndex += 1; itemIndex = 0; }
        else return closeViewer();
        updateStoryURL();
        await showCurrent();
    }

    async function previous() {
        if (itemIndex > 0) itemIndex -= 1;
        else if (authorIndex > 0) { authorIndex -= 1; itemIndex = Math.max(0, (currentAuthor()?.items?.length || 1) - 1); }
        else return;
        updateStoryURL();
        await showCurrent();
    }

    function openStoryComposer() {
        resetStoryComposer();
        $(".story-composer").showModal();
    }

    async function selectStoryMedia(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        $(".story-composer-status").textContent = "Preparing media…";
        $(".story-publish").disabled = true;
        storyUploadRequestId = null;
        storyPublishRequestId = null;
        try {
            selectedStoryMedia = await prepareChatMedia(file);
            if (selectedStoryMedia.kind === "audio") throw new Error("Choose a photo or MP4 video for your Story.");
            if (selectedStoryPreview) URL.revokeObjectURL(selectedStoryPreview);
            selectedStoryPreview = URL.createObjectURL(selectedStoryMedia.file);
            $(".story-composer-preview").innerHTML = selectedStoryMedia.kind === "video"
                ? `<video src="${escapeHTML(selectedStoryPreview)}" muted playsinline controls aria-label="Story video preview"></video>`
                : `<img src="${escapeHTML(selectedStoryPreview)}" alt="Story photo preview" decoding="async">`;
            $(".story-composer-status").textContent = `${selectedStoryMedia.kind === "video" ? "Video" : "Photo"} ready to post`;
            $(".story-publish").disabled = false;
        } catch (error) {
            selectedStoryMedia = null;
            $(".story-composer-status").textContent = error.message || "Could not prepare that Story.";
        }
    }

    async function deliverStoryRecord(record, { onProgress } = {}) {
        const session = await api.createStoryUpload(record.user_id, {
            contentType: record.content_type,
            sizeBytes: record.file.size,
            thumbnailSizeBytes: record.thumbnail?.size ?? null,
            durationMs: record.duration_ms,
            clientRequestId: record.upload_request_id,
        });
        await api.putDirectUpload(record.file, session, { onProgress: (progress) => onProgress?.(progress * 0.88) });
        if (record.thumbnail && !session.already_finalized) {
            await api.putDirectUpload(record.thumbnail, {
                upload_url: session.thumbnail_upload_url,
                upload_method: session.upload_method,
                required_headers: session.thumbnail_required_headers,
            }, { onProgress: (progress) => onProgress?.(0.88 + progress * 0.1) });
        }
        await api.finalizeStoryUpload(record.user_id, session.media_asset_id);
        return api.publishStory(record.user_id, session.media_asset_id, {
            caption: record.caption,
            overlay: record.overlay,
            clientRequestId: record.publish_request_id,
        });
    }

    async function publishSelectedStory(event) {
        event.preventDefault();
        if (!selectedStoryMedia) return;
        const button = $(".story-publish");
        storyUploadRequestId ||= crypto.randomUUID();
        storyPublishRequestId ||= crypto.randomUUID();
        const record = {
            id: `${getUser().id}:story:${storyUploadRequestId}`,
            user_id: getUser().id,
            kind: "story",
            file: selectedStoryMedia.file,
            thumbnail: selectedStoryMedia.thumbnail || null,
            content_type: selectedStoryMedia.file.type,
            duration_ms: selectedStoryMedia.durationMs,
            caption: $(".story-caption").value.trim() || null,
            overlay: $(".story-overlay").value.trim() ? { text: $(".story-overlay").value.trim(), x: 0.5, y: 0.5 } : null,
            upload_request_id: storyUploadRequestId,
            publish_request_id: storyPublishRequestId,
        };
        button.disabled = true;
        button.textContent = "Posting…";
        $(".story-upload-progress").classList.remove("hidden");
        let saved = false;
        try {
            await putChatMediaOutbox(record);
            saved = true;
            await deliverStoryRecord(record, { onProgress: (progress) => {
                setRuntimeStyles($(".story-upload-progress span"), { width: `${Math.round(progress * 100)}%` });
            } });
            await removeChatMediaOutbox(record.id);
            $(".story-composer").close();
            showToast?.("Story posted");
            await activate({ force: true });
        } catch (error) {
            if (saved && chatTextSendIsRetryable(error)) {
                await markChatMediaOutboxAttempt(record.id).catch(() => null);
                $(".story-composer-status").textContent = `${error.message || "Could not post your Story."} It is saved on this device and will retry while Six7 is open.`;
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
        selectedStoryMedia = null;
        if (selectedStoryPreview) URL.revokeObjectURL(selectedStoryPreview);
        selectedStoryPreview = null;
        storyUploadRequestId = null;
        storyPublishRequestId = null;
        $(".story-file-input").value = "";
        $(".story-caption").value = "";
        $(".story-overlay").value = "";
        $(".story-composer-preview").innerHTML = `<span aria-hidden="true">＋</span><p>Choose a photo or an MP4 video.</p>`;
        $(".story-composer-status").textContent = "";
        $(".story-upload-progress").classList.add("hidden");
        setRuntimeStyles($(".story-upload-progress span"), { width: "0" });
        $(".story-publish").textContent = "Post Story";
        $(".story-publish").disabled = true;
    }

    function deliveryIntent(storyId, recipientId, context) {
        const key = `${storyId}:${recipientId}:${context}`;
        if (!storyDeliveryIntents.has(key)) {
            if (storyDeliveryIntents.size >= 30) storyDeliveryIntents.delete(storyDeliveryIntents.keys().next().value);
            storyDeliveryIntents.set(key, { createRequestId: crypto.randomUUID(), sendRequestId: crypto.randomUUID() });
        }
        return { key, ...storyDeliveryIntents.get(key) };
    }

    async function deliverStory({ storyId, recipientId, context, body = null }) {
        const intent = deliveryIntent(storyId, recipientId, context);
        const created = await api.createChat(getUser().id, [recipientId], null, intent.createRequestId);
        const chatId = created.chat?.id || created.id;
        if (!chatId) throw new Error("Could not open a chat for this Story.");
        const message = await api.sendChatMessage(getUser().id, chatId, {
            body: body?.trim() || null,
            story_id: storyId,
            story_share_context: context,
            client_request_id: intent.sendRequestId,
        });
        storyDeliveryIntents.delete(intent.key);
        return { chat: created.chat || created, message };
    }

    async function sendStoryReply(event) {
        event.preventDefault();
        const author = currentAuthor();
        const item = currentItem();
        const input = $(".story-reply input");
        const body = input.value.trim();
        if (!author || !item || author.is_owner || !body) return;
        const button = $(".story-reply button");
        button.disabled = true;
        button.textContent = "Sending…";
        try {
            const outcome = await deliverStory({ storyId: item.id, recipientId: author.user_id, context: "reply", body });
            input.value = "";
            showToast?.(Number(outcome.chat.pending_count || 0) > 0 ? "Reply sent · chat approval pending" : "Reply sent");
        } catch (error) {
            showToast?.(`${error.message || "Could not send your reply."} Tap Send to retry safely.`);
        } finally {
            button.disabled = false;
            button.textContent = "Send";
        }
    }

    async function openStoryShare() {
        const author = currentAuthor();
        if (!author || !currentItem()) return;
        const dialog = $(".story-share-sheet");
        shareSelected.clear();
        $(".story-share-search").value = "";
        $(".story-share-status").textContent = "Finding classmates…";
        $(".story-share-people").innerHTML = "";
        $(".story-share-send").disabled = true;
        dialog.showModal();
        try {
            const result = await api.getClassmates(getUser().id, "", 500);
            sharePeople = (Array.isArray(result) ? result : result.items || result.classmates || [])
                .filter((person) => String(person.user_id || person.id) !== String(getUser().id)
                    && String(person.user_id || person.id) !== String(author.user_id))
                .slice(0, 500);
            $(".story-share-status").textContent = author.is_owner
                ? "Choose up to 10 classmates. Registered contacts remain available in iOS."
                : "Someone else's Story stays inside their school.";
            renderSharePeople();
        } catch (error) {
            $(".story-share-status").textContent = error.message || "Could not load classmates.";
        }
    }

    function renderSharePeople() {
        const query = $(".story-share-search").value.trim().toLowerCase();
        $(".story-share-people").innerHTML = sharePeople.filter((person) => {
            const text = `${displayName(person)} ${person.username || ""} ${person.school_name || ""}`.toLowerCase();
            return !query || text.includes(query);
        }).map((person) => {
            const id = String(person.user_id || person.id);
            return `<label><input type="checkbox" value="${escapeHTML(id)}" ${shareSelected.has(id) ? "checked" : ""}> <span><strong>${escapeHTML(displayName(person))}</strong><small>${escapeHTML(person.username ? `@${person.username}` : person.school_name || "Classmate")}</small></span></label>`;
        }).join("") || `<p>No classmates found.</p>`;
        updateShareSelection();
    }

    function updateShareSelection(event) {
        if (event?.target?.matches("input")) {
            if (event.target.checked && shareSelected.size >= 10) {
                event.target.checked = false;
                showToast?.("Choose up to 10 people at a time.");
            } else if (event.target.checked) shareSelected.add(event.target.value);
            else shareSelected.delete(event.target.value);
        }
        $(".story-share-send").disabled = !shareSelected.size;
    }

    async function sendSharedStory(event) {
        event.preventDefault();
        const item = currentItem();
        const recipients = [...shareSelected].slice(0, 10);
        if (!item || !recipients.length) return;
        const button = $(".story-share-send");
        button.disabled = true;
        button.textContent = "Sending…";
        let sent = 0;
        try {
            for (const recipientId of recipients) {
                await deliverStory({ storyId: item.id, recipientId, context: "share" });
                sent += 1;
                shareSelected.delete(recipientId);
                const input = [...$(".story-share-people").querySelectorAll("input")].find((candidate) => candidate.value === recipientId);
                if (input) { input.checked = false; input.disabled = true; }
            }
            $(".story-share-sheet").close();
            showToast?.(sent === 1 ? "Story sent" : `Story sent to ${sent} people`);
        } catch (error) {
            $(".story-share-status").textContent = `${error.message || "Could not send that Story."} ${sent ? `${sent} already sent. ` : ""}Keep the remaining people selected and retry.`;
        } finally {
            button.disabled = false;
            button.textContent = "Send Story";
        }
    }

    async function showViewers() {
        const item = currentItem();
        if (!item || !currentAuthor()?.is_owner) return;
        const dialog = $(".story-viewers-sheet");
        dialog.querySelector("div").innerHTML = `<p>Loading…</p>`;
        viewerCursor = null;
        viewerRows = [];
        dialog.showModal();
        await loadMoreViewers();
    }

    function renderViewers() {
        const container = $(".story-viewers-sheet div");
        const rows = viewerRows.map((viewer) => {
            const captures = [Number(viewer.screenshot_count || 0) ? `${Number(viewer.screenshot_count)} screenshot${Number(viewer.screenshot_count) === 1 ? "" : "s"}` : "", Number(viewer.screen_capture_count || 0) ? `${Number(viewer.screen_capture_count)} screen recording${Number(viewer.screen_capture_count) === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
            return `<article><strong>${escapeHTML(displayName(viewer))}</strong><small>${escapeHTML(new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(viewer.viewed_at)))}</small>${captures ? `<span>${escapeHTML(captures)}</span>` : ""}</article>`;
        }).join("");
        const more = viewerCursor && viewerRows.length < MAX_STORY_VIEWERS
            ? `<button type="button" data-more-story-viewers>Load more viewers</button>`
            : "";
        container.innerHTML = rows || `<p>No views yet.</p>`;
        container.insertAdjacentHTML("beforeend", more);
    }

    async function loadMoreViewers() {
        const item = currentItem();
        if (!item || !currentAuthor()?.is_owner || viewerRows.length >= MAX_STORY_VIEWERS) return;
        const button = $("[data-more-story-viewers]");
        if (button) button.disabled = true;
        try {
            const result = await api.getStoryViewers(getUser().id, item.id, { cursor: viewerCursor, limit: 50 });
            const seen = new Set(viewerRows.map((viewer) => String(viewer.user_id)));
            viewerRows.push(...(result.viewers || []).filter((viewer) => !seen.has(String(viewer.user_id))));
            viewerRows = viewerRows.slice(0, MAX_STORY_VIEWERS);
            viewerCursor = result.next_cursor || null;
            renderViewers();
        } catch (error) {
            $(".story-viewers-sheet div").insertAdjacentHTML("beforeend", `<p>${escapeHTML(error.message || "Could not load viewers.")}</p>`);
        }
    }

    async function deleteCurrent() {
        const item = currentItem();
        if (!item || !currentAuthor()?.is_owner || !confirm("Delete this Story?")) return;
        try {
            await api.deleteStory(getUser().id, item.id);
            closeViewer();
            await activate({ force: true });
            showToast?.("Story deleted");
        } catch (error) { showToast?.(error.message || "Could not delete this Story."); }
    }

    async function reportCurrent() {
        const item = currentItem();
        if (!item || currentAuthor()?.is_owner) return;
        const reason = prompt("Tell us why you're reporting this Story:");
        if (!reason?.trim()) return;
        try {
            await api.reportStory(getUser().id, item.id, reason);
            closeViewer();
            await activate({ force: true });
            showToast?.("Story reported");
        } catch (error) { showToast?.(error.message || "Could not report this Story."); }
    }

    function handleClick(event) {
        const target = event.target.closest("button");
        if (!target) return;
        if (target.matches("[data-create-story]")) return openStoryComposer();
        if (target.matches("[data-close-story-composer]")) return $(".story-composer").close();
        if (target.matches("[data-share-story]")) return void openStoryShare();
        if (target.matches("[data-close-story-share]")) return $(".story-share-sheet").close();
        if (target.dataset.storyAuthor !== undefined) return openAuthor(target.dataset.storyAuthor);
        if (target.matches("[data-close-story]")) return closeViewer();
        if (target.matches("[data-next-story]")) return void next();
        if (target.matches("[data-previous-story]")) return void previous();
        if (target.matches("[data-story-viewers]")) return void showViewers();
        if (target.matches("[data-more-story-viewers]")) return void loadMoreViewers();
        if (target.matches("[data-close-story-viewers]")) return $(".story-viewers-sheet").close();
        if (target.matches("[data-delete-story]")) return void deleteCurrent();
        if (target.matches("[data-report-story]")) return void reportCurrent();
    }

    return { activate, refresh: () => activate({ force: true }) };
}
