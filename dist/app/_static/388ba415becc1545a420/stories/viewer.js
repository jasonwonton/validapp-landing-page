// The full-screen Story viewer, loaded on demand the first time someone opens
// a Story so it stays out of the startup shell. iOS reference:
// Views/Feed/StoryViews.swift (StoryViewerView, StoryMediaPage,
// StoryViewersSheet) and StoryInteractionViews.swift (StorySharePeopleView).
import { uiIcon } from "../ui-icons.js";
import { mediaImageMarkup } from "../media-url.js";
import { setRuntimeStyles } from "../runtime-style.js";
import { confirmSheet, reasonSheet } from "../ui-dialogs.js";
import { userMessage } from "../user-message.js";

export const PHOTO_DURATION_MS = 5_000;
// StoryViewerView.dismissDragGesture and StoryAuthorSwipePolicy.
const GESTURE_MIN_DISTANCE = 12;
const DISMISS_DISTANCE = 110;
const DISMISS_PROJECTED_DISTANCE = 220;
const AUTHOR_COMMIT_DISTANCE = 64;
const AUTHOR_PROJECTED_DISTANCE = 120;
const AUTHOR_RUBBER_BAND = 0.18;
const PROJECTION_MS = 200;
const HOLD_DELAY_MS = 200;
const TAP_SLOP = 10;
const PROCESSING_POLL_MS = [3_000, 6_000, 12_000, 24_000, 30_000];
const MAX_STORY_VIEWERS = 500;
const MAX_RECORDED_VIEWS = 200;
const SHARE_LIMIT = 10;
const MAX_PRELOADED = 4;
const REPORT_REASONS = [
    { value: "inappropriate_content", label: "Inappropriate content" },
    { value: "harassment", label: "Harassment or bullying" },
    { value: "sexual_content", label: "Sexual content" },
    { value: "threat", label: "Threat or violence" },
    { value: "personal_information", label: "Personal information" },
    { value: "spam", label: "Spam" },
];

// Symbols the shared icon set does not carry, drawn on the same 24-point grid.
const icons = {
    eye: '<path d="M1.5 12S5.5 4.5 12 4.5 22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/>',
    "speaker-off": '<path d="M3 9h4l5-5v16l-5-5H3zM16 9l6 6M22 9l-6 6"/>',
    screenshot: '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="12" r="3.5"/>',
    recording: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/>',
    alert: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7v6M12 16.5v.5"/>',
};
function icon(name) {
    if (!icons[name]) return uiIcon(name);
    return `<svg class="ui-icon" data-ui-icon="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[name]}</svg>`;
}

function haptic(kind) {
    try { return window.ValidPreferences?.haptic(kind) ?? false; } catch (_) { return false; }
}

function firstUnviewedIndex(author) {
    return Math.max(0, (author?.items || []).findIndex((item) => !item.viewer_has_viewed));
}

// Every caption to draw. Stories published before the list existed carry only
// the scalar fields (StoryItem.allTextOverlays).
export function storyTextOverlays(item = {}) {
    const list = Array.isArray(item.text_overlays) ? item.text_overlays.filter((overlay) => overlay?.text) : [];
    if (list.length) return list;
    if (!item.text_overlay) return [];
    return [{ text: item.text_overlay, x: item.text_overlay_x ?? 0.5, y: item.text_overlay_y ?? 0.44 }];
}

function relativeAge(value) {
    const hours = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 3_600_000));
    return Number.isFinite(hours) && hours > 0 ? `${hours}h` : "now";
}

function viewAge(value) {
    const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
    if (!Number.isFinite(seconds)) return "";
    const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });
    const abs = Math.abs(seconds);
    if (abs < 60) return format.format(seconds, "second");
    if (abs < 3_600) return format.format(Math.round(seconds / 60), "minute");
    if (abs < 86_400) return format.format(Math.round(seconds / 3_600), "hour");
    return format.format(Math.round(seconds / 86_400), "day");
}

export function createStoryViewer({
    root, api, getUser, getConfig = () => null, escapeHTML, showToast,
    safeURL, displayName, onViewed, onChanged, onClosed,
}) {
    const chatsEnabled = () => {
        const config = getConfig?.();
        return !config || (config.enable_chats === true && config.enable_web_chats === true);
    };

    root.insertAdjacentHTML("beforeend", `
        <dialog class="story-viewer" aria-label="Story viewer">
            <div class="story-stage">
                <div class="story-media">
                    <img class="story-photo" alt="" decoding="async" hidden>
                    <video class="story-video" playsinline webkit-playsinline preload="auto" disablepictureinpicture hidden></video>
                    <div class="story-overlays" aria-live="off"></div>
                    <div class="story-media-state" role="status" hidden><span class="story-spinner" aria-hidden="true"></span><strong></strong><small></small></div>
                </div>
                <div class="story-zones">
                    <button class="story-previous" type="button" data-previous-story aria-label="Previous Story"><span>${uiIcon("back")}</span></button>
                    <button class="story-next" type="button" data-next-story aria-label="Next Story"><span>${uiIcon("next")}</span></button>
                </div>
                <div class="story-top">
                    <div class="story-progress" aria-hidden="true"></div>
                    <header>
                        <span class="story-header-avatar" aria-hidden="true"></span>
                        <span class="story-author"><strong></strong><small></small></span>
                        <button type="button" class="story-icon-button" data-story-options aria-label="Story options" aria-haspopup="menu" aria-expanded="false">${uiIcon("more")}</button>
                        <button type="button" class="story-icon-button" data-close-story aria-label="Close Story" autofocus>${uiIcon("close")}</button>
                    </header>
                    <button class="story-sound" type="button" data-story-unmute hidden>${icon("speaker-off")}<span>Tap to unmute</span></button>
                </div>
                <div class="story-menu" role="menu" aria-label="Story options" hidden></div>
                <div class="story-person-actions">
                    <button type="button" data-story-previous-person>Previous person</button>
                    <button type="button" data-story-next-person>Next person</button>
                </div>
                <div class="story-bottom">
                    <p class="story-item-caption"></p>
                    <small class="story-capture-note" hidden>Screenshots aren’t detected on the web</small>
                    <div class="story-owner-bar" hidden>
                        <button type="button" class="story-views" data-story-viewers aria-describedby="story-views-hint">${icon("eye")}<span></span></button>
                        <span id="story-views-hint" hidden>Shows who viewed this Story</span>
                        <button type="button" class="story-round-button" data-share-story aria-label="Send Story">${uiIcon("paperplane")}</button>
                    </div>
                    <form class="story-reply" hidden>
                        <button type="button" class="story-round-button" data-share-story aria-label="Send Story">${uiIcon("paperplane")}</button>
                        <span class="story-reply-field">
                            <input type="text" maxlength="2000" enterkeyhint="send" autocomplete="off" aria-label="Reply to Story">
                            <button type="submit" aria-label="Send reply" disabled>${uiIcon("send")}</button>
                        </span>
                    </form>
                </div>
            </div>
        </dialog>
        <dialog class="story-viewers-sheet story-sheet" aria-label="Story viewers">
            <header><span></span><strong id="story-viewers-title">Viewed by 0</strong><button type="button" data-close-story-viewers>Done</button></header>
            <div class="story-viewers-list"></div>
        </dialog>
        <dialog class="story-share-sheet story-sheet" aria-label="Share Story">
            <form>
                <header><button type="button" data-close-story-share>Close</button><strong>Send Story</strong><span></span></header>
                <div class="story-share-preview"><span class="story-share-thumb"></span><span><strong>Share this Story</strong><small></small></span></div>
                <input class="story-share-search" type="search" placeholder="Search classmates" aria-label="Search classmates" autocomplete="off">
                <p class="story-share-status" role="status"></p>
                <div class="story-share-people"></div>
                <div class="story-share-bar">
                    <small class="story-share-count" aria-live="polite"></small>
                    <button class="primary-button story-share-send" type="submit" disabled>${uiIcon("paperplane")}<span>Choose people</span></button>
                </div>
            </form>
        </dialog>`);

    const $ = (selector) => root.querySelector(selector);
    const dialog = $(".story-viewer");
    const stage = $(".story-stage");
    const photo = $(".story-photo");
    const video = $(".story-video");
    const menu = $(".story-menu");
    const viewersSheet = $(".story-viewers-sheet");
    const shareSheet = $(".story-share-sheet");
    const replyInput = $(".story-reply input");

    let authors = [];
    let authorIndex = 0;
    let itemIndex = 0;
    let generation = 0;
    let soundOn = true;
    let frame = null;
    let lastFrameAt = null;
    let paintedProgress = -1;
    let pollTimer = null;
    let spinnerTimer = null;
    let sendingReply = false;
    let viewerCursor = null;
    let viewerRows = [];
    let viewersItem = null;
    let viewersObserver = null;
    let viewersLoading = false;
    let sharePeople = [];
    let shareItem = null;
    let shareAuthor = null;
    let sharing = false;
    const shareSelected = new Set();
    const shareSent = new Set();
    const shareFailed = new Set();
    const storyDeliveryIntents = new Map();
    const recordedViews = new Set();
    const pauseReasons = new Set();
    const preloaded = new Map();
    let mediaListeners = new AbortController();
    // What the current page is showing: "loading" | "photo" | "video" | "processing" | "unavailable".
    let media = { mode: "loading", ready: false, timed: false, elapsed: 0, renewed: false, polls: 0 };

    const currentAuthor = () => authors[authorIndex] || null;
    const currentItem = () => currentAuthor()?.items?.[itemIndex] || null;

    // Pausing ------------------------------------------------------------------
    function isPaused() { return pauseReasons.size > 0; }
    function setPaused(reason, paused) {
        const before = isPaused();
        if (paused) pauseReasons.add(reason);
        else pauseReasons.delete(reason);
        dialog.classList.toggle("paused", pauseReasons.has("hold"));
        if (before !== isPaused()) syncPlayback();
    }
    function syncPlayback() {
        if (media.mode !== "video") return;
        if (isPaused() || !dialog.open) video.pause();
        else void playVideo();
    }

    async function playVideo() {
        const expected = generation;
        video.muted = !soundOn;
        try {
            await video.play();
        } catch (error) {
            if (expected !== generation || error?.name === "AbortError") return;
            if (error?.name === "NotAllowedError" && !video.muted) {
                // Sound was not allowed without a fresh gesture. Keep the Story
                // moving silently and offer a tap to turn the sound on.
                video.muted = true;
                showSoundPill("Tap to unmute", "Unmute Story");
                try { await video.play(); } catch (retryError) {
                    // Even silent autoplay was refused (for example Low Power
                    // Mode). One tap on the pill starts it with sound.
                    if (expected === generation && retryError?.name === "NotAllowedError") showSoundPill("Tap to play", "Play Story");
                }
            } else if (error?.name === "NotAllowedError" && expected === generation) {
                showSoundPill("Tap to play", "Play Story");
            }
        }
        if (expected !== generation || isPaused()) video.pause();
    }

    function showSoundPill(label, accessibleLabel) {
        const pill = $("[data-story-unmute]");
        pill.querySelector("span").textContent = label;
        pill.setAttribute("aria-label", accessibleLabel);
        pill.hidden = false;
    }

    // The progress clock --------------------------------------------------------
    function startClock() {
        if (frame !== null) return;
        lastFrameAt = null;
        frame = requestAnimationFrame(tick);
    }
    function stopClock() {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        lastFrameAt = null;
    }
    function tick(now) {
        frame = requestAnimationFrame(tick);
        // Never count time spent in a background tab or a blocked frame.
        const delta = lastFrameAt === null ? 0 : Math.min(250, Math.max(0, now - lastFrameAt));
        lastFrameAt = now;
        if (media.timed && media.ready && !isPaused()) media.elapsed += delta;
        let progress = 0;
        if (media.mode === "video") {
            const duration = Number.isFinite(video.duration) && video.duration > 0
                ? video.duration
                : Number(currentItem()?.video_duration_ms || 0) / 1000;
            progress = duration > 0 ? video.currentTime / duration : 0;
        } else if (media.timed) {
            progress = media.elapsed / PHOTO_DURATION_MS;
        }
        paintProgress(Math.min(1, Math.max(0, progress)));
        if (media.timed && media.elapsed >= PHOTO_DURATION_MS) advance();
    }
    function paintProgress(value) {
        const rounded = Math.round(value * 1000) / 1000;
        if (rounded === paintedProgress) return;
        paintedProgress = rounded;
        const bar = $(".story-progress i.current b");
        if (bar) setRuntimeStyles(bar, { transform: `scaleX(${rounded})` });
        $(".story-progress").dataset.progress = String(rounded);
    }

    // Rendering -----------------------------------------------------------------
    function renderChrome(author, item) {
        const name = author.is_owner ? "Your Story" : displayName(author);
        const avatar = safeURL(author.profile_picture_url);
        $(".story-header-avatar").innerHTML = avatar
            ? mediaImageMarkup(avatar, { initials: displayName(author).slice(0, 1).toUpperCase(), loading: "eager" })
            : `<span>${escapeHTML(displayName(author).slice(0, 1).toUpperCase())}</span>`;
        $(".story-author strong").textContent = name;
        $(".story-author small").textContent = relativeAge(item.published_at);
        $(".story-author small").setAttribute("aria-label", `Posted ${relativeAge(item.published_at) === "now" ? "just now" : `${relativeAge(item.published_at)} ago`}, Story ${itemIndex + 1} of ${author.items.length}`);
        $(".story-progress").innerHTML = author.items
            .map((_, index) => `<i class="${index < itemIndex ? "done" : index === itemIndex ? "current" : ""}"><b></b></i>`).join("");
        paintedProgress = -1;
        paintProgress(0);
        $(".story-overlays").innerHTML = storyTextOverlays(item).map((overlay) => `<span class="story-text-overlay">${escapeHTML(overlay.text)}</span>`).join("");
        storyTextOverlays(item).forEach((overlay, index) => setRuntimeStyles($(".story-overlays").children[index], {
            left: `${Math.min(1, Math.max(0, Number(overlay.x ?? 0.5))) * 100}%`,
            top: `${Math.min(1, Math.max(0, Number(overlay.y ?? 0.44))) * 100}%`,
        }));
        $(".story-item-caption").textContent = item.caption || "";
        const chats = chatsEnabled();
        $(".story-owner-bar").hidden = !author.is_owner;
        // iOS tells the author about screenshots of their Story; a browser can't see them.
        $(".story-capture-note").hidden = author.is_owner;
        $(".story-owner-bar [data-share-story]").hidden = !chats;
        const views = Number(item.view_count || 0);
        $(".story-views span").textContent = `${views} ${views === 1 ? "view" : "views"}`;
        $(".story-reply").hidden = author.is_owner || !chats;
        replyInput.placeholder = `Reply to ${author.first_name || displayName(author)}…`;
        $(".story-person-actions [data-story-previous-person]").disabled = authorIndex === 0;
        $(".story-person-actions [data-story-next-person]").disabled = authorIndex + 1 >= authors.length;
        dialog.classList.toggle("owner", Boolean(author.is_owner));
    }

    function showMediaState(title = "", detail = "", { spinner = false } = {}) {
        const state = $(".story-media-state");
        state.hidden = !title && !spinner;
        state.classList.toggle("spinning", spinner);
        state.classList.toggle("quiet", !title);
        state.querySelector("strong").textContent = title;
        state.querySelector("small").textContent = detail;
    }

    function resetMediaElements() {
        // Listeners belong to one page; drop the previous page's before reuse.
        mediaListeners.abort();
        mediaListeners = new AbortController();
        clearTimeout(pollTimer);
        clearTimeout(spinnerTimer);
        pollTimer = null;
        video.pause();
        video.removeAttribute("src");
        video.removeAttribute("poster");
        video.load();
        video.hidden = true;
        photo.hidden = true;
        photo.removeAttribute("src");
        $("[data-story-unmute]").hidden = true;
        showMediaState();
    }

    function show() {
        const author = currentAuthor();
        const item = currentItem();
        if (!author || !item) return close();
        generation += 1;
        media = { mode: "loading", ready: false, timed: false, elapsed: 0, renewed: false, polls: 0 };
        resetMediaElements();
        renderChrome(author, item);
        updateStoryURL();
        if (!dialog.open) {
            dialog.showModal();
            setRuntimeStyles(dialog, { "--story-dim": "1" });
            setRuntimeStyles(stage, { transform: null, transition: null });
        }
        startClock();
        loadMedia(item);
        preloadUpcoming();
    }

    function loadMedia(item) {
        const expected = generation;
        const url = safeURL(item.media_url);
        if (!url) return showUnavailable("This Story is unavailable.");
        spinnerTimer = setTimeout(() => {
            if (expected === generation && !media.ready && media.mode !== "processing") showMediaState("", "", { spinner: true });
        }, 250);
        if (item.media_type !== "video") return loadPhoto(item, url, expected);
        const poster = safeURL(item.thumbnail_url);
        if (poster) video.poster = poster;
        if (item.video_state === "processing") return showProcessing(item, expected);
        media.mode = "video";
        video.hidden = false;
        video.src = url;
        const playing = () => {
            if (expected !== generation) return;
            media.ready = true;
            clearTimeout(spinnerTimer);
            showMediaState();
            revealed(item);
        };
        const { signal } = mediaListeners;
        video.addEventListener("loadeddata", playing, { once: true, signal });
        video.addEventListener("error", () => {
            if (expected !== generation) return;
            video.removeEventListener("loadeddata", playing);
            if (item.video_state === "unavailable") {
                showUnavailable("This video can't play on the web yet.", "Open it in the Valid app to watch.");
            } else void renewOrFail(item, expected);
        }, { once: true, signal });
        video.addEventListener("ended", () => { if (expected === generation) advance(); }, { once: true, signal });
        void playVideo();
    }

    function loadPhoto(item, url, expected) {
        media.mode = "photo";
        media.timed = true;
        photo.alt = `${displayName(currentAuthor())}'s Story`;
        const decoded = preloaded.get(url);
        photo.src = url;
        const ready = () => {
            if (expected !== generation) return;
            media.ready = true;
            clearTimeout(spinnerTimer);
            showMediaState();
            photo.hidden = false;
            revealed(item);
        };
        const failed = () => { if (expected === generation) void renewOrFail(item, expected); };
        if (decoded?.ready) return ready();
        (photo.decode ? photo.decode() : new Promise((resolve, reject) => {
            photo.addEventListener("load", resolve, { once: true });
            photo.addEventListener("error", reject, { once: true });
        })).then(ready, () => {
            // decode() also rejects when the source is replaced; only report a
            // real failure for this page.
            if (expected !== generation) return;
            if (photo.complete && photo.naturalWidth) ready();
            else failed();
        });
    }

    function showProcessing(item, expected) {
        media.mode = "processing";
        // A processing clip keeps the Story moving like a photo, so a viewer is
        // never stuck; if the web version lands first it plays from the start.
        media.timed = true;
        media.ready = true;
        clearTimeout(spinnerTimer);
        const poster = safeURL(item.thumbnail_url);
        if (poster) {
            photo.src = poster;
            photo.alt = "";
            photo.hidden = false;
        }
        showMediaState("Processing video…", "It will play here as soon as it's ready.", { spinner: true });
        const poll = async () => {
            if (expected !== generation) return;
            const fresh = await refreshItem(item).catch(() => null);
            if (expected !== generation) return;
            if (fresh && fresh.video_state !== "processing") {
                generation += 1;
                media = { mode: "loading", ready: false, timed: false, elapsed: 0, renewed: false, polls: 0 };
                resetMediaElements();
                paintedProgress = -1;
                paintProgress(0);
                return loadMedia(item);
            }
            media.polls += 1;
            pollTimer = setTimeout(poll, PROCESSING_POLL_MS[Math.min(media.polls, PROCESSING_POLL_MS.length - 1)]);
        };
        pollTimer = setTimeout(poll, PROCESSING_POLL_MS[0]);
    }

    function showUnavailable(title, detail = "") {
        clearTimeout(spinnerTimer);
        video.pause();
        video.hidden = true;
        $("[data-story-unmute]").hidden = true;
        const poster = video.getAttribute("poster");
        if (poster) {
            photo.src = poster;
            photo.alt = "";
        }
        photo.hidden = !poster;
        media.mode = "unavailable";
        media.timed = true;
        media.ready = true;
        media.elapsed = 0;
        showMediaState(title, detail);
    }

    // Signed media links expire. Fetch the feed once for a fresh link before
    // telling the viewer the Story is gone (StoryMediaPage.renewMedia).
    async function renewOrFail(item, expected) {
        if (!media.renewed) {
            media.renewed = true;
            const before = item.media_url;
            const fresh = await refreshItem(item).catch(() => null);
            if (expected !== generation) return;
            if (fresh && fresh.media_url && fresh.media_url !== before) {
                resetMediaElements();
                media = { ...media, mode: "loading", ready: false, timed: false, elapsed: 0 };
                return loadMedia(item);
            }
        }
        if (expected === generation) showUnavailable("This Story is unavailable.");
    }

    async function refreshItem(item) {
        const result = await api.getStories(getUser().id);
        const fresh = (result?.authors || []).flatMap((author) => author.items || []).find((candidate) => String(candidate.id) === String(item.id));
        if (fresh) Object.assign(item, fresh);
        return fresh || null;
    }

    function revealed(item) {
        const author = currentAuthor();
        if (!author || author.is_owner || recordedViews.has(String(item.id))) return;
        if (recordedViews.size >= MAX_RECORDED_VIEWS) recordedViews.delete(recordedViews.values().next().value);
        recordedViews.add(String(item.id));
        api.recordStoryView(getUser().id, item.id).then(() => {
            item.viewer_has_viewed = true;
            author.has_unviewed = author.items.some((candidate) => !candidate.viewer_has_viewed);
            onViewed?.(author, item);
        }).catch(() => recordedViews.delete(String(item.id)));
    }

    function preloadUpcoming() {
        const author = currentAuthor();
        const upcoming = [];
        if (author?.items?.[itemIndex + 1]) upcoming.push(author.items[itemIndex + 1]);
        const nextAuthor = authors[authorIndex + 1];
        if (nextAuthor) upcoming.push(nextAuthor.items[firstUnviewedIndex(nextAuthor)]);
        for (const item of upcoming.filter(Boolean)) {
            const url = safeURL(item.media_url);
            if (!url || preloaded.has(url)) continue;
            if (preloaded.size >= MAX_PRELOADED) {
                const [oldest, entry] = preloaded.entries().next().value;
                entry.element.removeAttribute?.("src");
                preloaded.delete(oldest);
            }
            if (item.media_type === "video") {
                if (item.video_state === "processing") continue;
                const element = document.createElement("video");
                element.preload = "metadata";
                element.muted = true;
                element.src = url;
                const poster = safeURL(item.thumbnail_url);
                if (poster) new Image().src = poster;
                preloaded.set(url, { element, ready: false });
            } else {
                const element = new Image();
                element.decoding = "async";
                const entry = { element, ready: false };
                element.src = url;
                element.decode?.().then(() => { entry.ready = true; }, () => preloaded.delete(url));
                preloaded.set(url, entry);
            }
        }
    }

    // Navigation ------------------------------------------------------------------
    function navigate(nextAuthorIndex, nextItemIndex) {
        closeMenu();
        authorIndex = nextAuthorIndex;
        itemIndex = nextItemIndex;
        show();
    }
    function advance() {
        const author = currentAuthor();
        if (!author) return close();
        if (itemIndex + 1 < author.items.length) navigate(authorIndex, itemIndex + 1);
        else if (authorIndex + 1 < authors.length) navigate(authorIndex + 1, firstUnviewedIndex(authors[authorIndex + 1]));
        else close();
    }
    function retreat() {
        if (itemIndex > 0) navigate(authorIndex, itemIndex - 1);
        else if (authorIndex > 0) navigate(authorIndex - 1, Math.max(0, authors[authorIndex - 1].items.length - 1));
        else navigate(authorIndex, itemIndex);
    }
    function adjacentAuthor(direction) {
        const target = authorIndex + (direction === "next" ? 1 : -1);
        if (target < 0 || target >= authors.length) return false;
        haptic("selection");
        navigate(target, direction === "next" ? firstUnviewedIndex(authors[target]) : Math.max(0, authors[target].items.length - 1));
        return true;
    }

    function updateStoryURL() {
        const item = currentItem();
        if (!item) return;
        const url = new URL(location.href);
        url.searchParams.set("story", item.id);
        history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    function clearStoryURL() {
        const url = new URL(location.href);
        if (!url.searchParams.has("story") && !url.searchParams.has("viewers")) return;
        url.searchParams.delete("story");
        url.searchParams.delete("viewers");
        history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }

    function close() {
        // The close event is queued; clear the deep link now so a refresh that
        // follows (delete, report) does not try to reopen the Story.
        clearStoryURL();
        if (dialog.open) dialog.close();
    }

    dialog.addEventListener("close", () => {
        generation += 1;
        stopClock();
        resetMediaElements();
        closeMenu();
        pauseReasons.clear();
        dialog.classList.remove("paused");
        for (const entry of preloaded.values()) entry.element.removeAttribute?.("src");
        preloaded.clear();
        clearStoryURL();
        onClosed?.();
    });

    // Gestures ----------------------------------------------------------------------
    let gesture = null;
    let suppressClick = false;

    function interactiveTarget(target) {
        return target.closest("button:not(.story-previous):not(.story-next), input, a, form, .story-menu");
    }
    stage.addEventListener("pointerdown", (event) => {
        if (!event.isPrimary || event.button > 0 || interactiveTarget(event.target) || !menu.hidden) return;
        gesture = {
            id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp,
            dx: 0, dy: 0, mode: null, samples: [{ x: event.clientX, y: event.clientY, t: event.timeStamp }],
            holding: false,
        };
        suppressClick = false;
        gesture.holdTimer = setTimeout(() => {
            if (!gesture || gesture.mode) return;
            gesture.holding = true;
            setPaused("hold", true);
        }, HOLD_DELAY_MS);
    });
    stage.addEventListener("pointermove", (event) => {
        if (!gesture || event.pointerId !== gesture.id) return;
        gesture.dx = event.clientX - gesture.x;
        gesture.dy = event.clientY - gesture.y;
        gesture.samples.push({ x: event.clientX, y: event.clientY, t: event.timeStamp });
        if (gesture.samples.length > 8) gesture.samples.shift();
        if (!gesture.mode && Math.hypot(gesture.dx, gesture.dy) >= GESTURE_MIN_DISTANCE) {
            const horizontal = Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.15;
            const downward = gesture.dy > 0 && Math.abs(gesture.dy) > Math.abs(gesture.dx);
            gesture.mode = horizontal ? "author" : downward ? "dismiss" : "none";
            clearTimeout(gesture.holdTimer);
            if (gesture.mode !== "none") {
                setPaused("drag", true);
                // Capture only once a drag starts: a captured tap would retarget
                // its click away from the tap-zone button.
                try { stage.setPointerCapture(event.pointerId); } catch (_) { /* Synthetic pointers may not capture. */ }
            }
        }
        if (gesture.mode === "dismiss") {
            const offset = Math.max(0, gesture.dy);
            setRuntimeStyles(stage, { transform: `translate3d(0, ${offset}px, 0)`, transition: "none" });
            setRuntimeStyles(dialog, { "--story-dim": String(Math.max(0.25, 1 - offset / 600)) });
        } else if (gesture.mode === "author") {
            const hasDestination = gesture.dx < 0 ? authorIndex + 1 < authors.length : authorIndex > 0;
            const offset = hasDestination ? gesture.dx : gesture.dx * AUTHOR_RUBBER_BAND;
            setRuntimeStyles(stage, { transform: `translate3d(${offset}px, 0, 0)`, transition: "none" });
        }
    });
    // Roughly SwiftUI's predictedEndTranslation: where a flick would come to
    // rest, from the finger's velocity over the last 100 ms before release.
    function projected(current) {
        const last = current.samples.at(-1);
        const recent = current.samples.filter((sample) => last.t - sample.t <= 100);
        const first = recent[0];
        const elapsed = last.t - first.t;
        if (recent.length < 2 || elapsed <= 0) return { x: current.dx, y: current.dy };
        return {
            x: current.dx + ((last.x - first.x) / elapsed) * PROJECTION_MS,
            y: current.dy + ((last.y - first.y) / elapsed) * PROJECTION_MS,
        };
    }
    function springBack() {
        setRuntimeStyles(stage, { transform: "translate3d(0, 0, 0)", transition: null });
        setRuntimeStyles(dialog, { "--story-dim": "1" });
    }
    function finishGesture(event, cancelled = false) {
        if (!gesture || event.pointerId !== gesture.id) return;
        const current = gesture;
        gesture = null;
        current.samples.push({ x: event.clientX, y: event.clientY, t: event.timeStamp });
        clearTimeout(current.holdTimer);
        try { if (stage.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture(event.pointerId); } catch (_) { /* Already released. */ }
        setPaused("hold", false);
        setPaused("drag", false);
        if (current.mode || current.holding) suppressClick = true;
        if (cancelled) return springBack();
        const end = projected(current);
        if (current.mode === "dismiss") {
            if (current.dy > DISMISS_DISTANCE || end.y > DISMISS_PROJECTED_DISTANCE) {
                setRuntimeStyles(stage, { transform: `translate3d(0, ${Math.max(end.y, window.innerHeight)}px, 0)`, transition: null });
                setRuntimeStyles(dialog, { "--story-dim": "0" });
                const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
                setTimeout(close, reduce ? 0 : 160);
            } else springBack();
            return;
        }
        if (current.mode === "author") {
            const committed = Math.abs(current.dx) >= AUTHOR_COMMIT_DISTANCE || Math.abs(end.x) >= AUTHOR_PROJECTED_DISTANCE;
            const direction = (Math.abs(end.x) > Math.abs(current.dx) ? end.x : current.dx) < 0 ? "next" : "previous";
            setRuntimeStyles(stage, { transform: "translate3d(0, 0, 0)", transition: "none" });
            if (!committed || !adjacentAuthor(direction)) springBack();
            return;
        }
        if (current.mode === "none") springBack();
    }
    stage.addEventListener("pointerup", (event) => finishGesture(event));
    stage.addEventListener("pointercancel", (event) => finishGesture(event, true));
    stage.addEventListener("contextmenu", (event) => { if (!interactiveTarget(event.target)) event.preventDefault(); });
    // A hold or a swipe that ends over a tap zone must not also navigate.
    stage.addEventListener("click", (event) => {
        if (!suppressClick) return;
        suppressClick = false;
        if (event.target.closest(".story-previous, .story-next")) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);

    // Menu ------------------------------------------------------------------------
    function openMenu() {
        const author = currentAuthor();
        if (!author) return;
        const entries = [];
        if (chatsEnabled()) entries.push(`<button type="button" role="menuitem" data-share-story>${uiIcon("paperplane")}<span>Send Story</span></button>`);
        entries.push(author.is_owner
            ? `<button type="button" role="menuitem" class="destructive" data-delete-story>${uiIcon("trash")}<span>Delete Story</span></button>`
            : `<button type="button" role="menuitem" class="destructive" data-report-story>${icon("alert")}<span>Report inappropriate content</span></button>`);
        entries.push(`<button type="button" role="menuitem" data-close-menu><span>Cancel</span></button>`);
        menu.innerHTML = entries.join("");
        menu.hidden = false;
        $("[data-story-options]").setAttribute("aria-expanded", "true");
        setPaused("menu", true);
        menu.querySelector("button")?.focus({ preventScroll: true });
    }
    function closeMenu({ restoreFocus = false } = {}) {
        if (menu.hidden) return;
        menu.hidden = true;
        $("[data-story-options]").setAttribute("aria-expanded", "false");
        setPaused("menu", false);
        if (restoreFocus) $("[data-story-options]").focus({ preventScroll: true });
    }
    menu.addEventListener("keydown", (event) => {
        const items = [...menu.querySelectorAll("[role=menuitem]")];
        const index = items.indexOf(document.activeElement);
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu({ restoreFocus: true }); }
        if (event.key === "ArrowDown") { event.preventDefault(); items[(index + 1) % items.length]?.focus(); }
        if (event.key === "ArrowUp") { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus(); }
    });

    // Sheets pause the Story (and its sound) while they are open ----------------------
    async function whilePaused(reason, work) {
        setPaused(reason, true);
        try { return await work(); } finally { setPaused(reason, false); }
    }

    async function deleteCurrent() {
        const item = currentItem();
        if (!item || !currentAuthor()?.is_owner) return;
        const confirmed = await whilePaused("dialog", () => confirmSheet({
            title: "Delete this Story?",
            message: "It will be removed for everyone right away.",
            confirmLabel: "Delete Story",
            destructive: true,
        }));
        if (!confirmed) return;
        await whilePaused("action", async () => {
            try {
                await api.deleteStory(getUser().id, item.id);
                close();
                showToast?.("Story deleted");
                await onChanged?.();
            } catch (error) {
                haptic("error");
                showToast?.(userMessage(error, "Couldn't delete this Story. Try again."));
            }
        });
    }

    async function reportCurrent() {
        const item = currentItem();
        if (!item || currentAuthor()?.is_owner) return;
        const report = await whilePaused("dialog", () => reasonSheet({
            title: "Report this Story",
            message: "Valid's team will review it. They won't know you reported it.",
            reasons: REPORT_REASONS,
            allowOther: true,
            otherLabel: "Something else",
            confirmLabel: "Report",
            destructive: true,
        }));
        if (!report) return;
        const reason = report.details ? `${report.reason}: ${report.details}`.slice(0, 500) : report.reason;
        await whilePaused("action", async () => {
            try {
                await api.reportStory(getUser().id, item.id, reason);
                close();
                haptic("success");
                showToast?.("Story reported");
                await onChanged?.();
            } catch (error) {
                haptic("error");
                showToast?.(userMessage(error, "Couldn't report this Story. Try again."));
            }
        });
    }

    // Chat delivery (StoryChatDeliveryCoordinator) ------------------------------------
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

    function updateReplyButton() {
        $(".story-reply [type=submit]").disabled = sendingReply || !replyInput.value.trim();
    }

    async function sendStoryReply(event) {
        event.preventDefault();
        const author = currentAuthor();
        const item = currentItem();
        const body = replyInput.value.trim();
        if (!author || !item || author.is_owner || !body || sendingReply) return;
        sendingReply = true;
        setPaused("reply-send", true);
        const button = $(".story-reply [type=submit]");
        button.classList.add("sending");
        updateReplyButton();
        replyInput.blur();
        try {
            const outcome = await deliverStory({ storyId: item.id, recipientId: author.user_id, context: "reply", body });
            replyInput.value = "";
            haptic("success");
            showToast?.(Number(outcome.chat.pending_count || 0) > 0 ? "Reply sent · chat approval pending" : "Reply sent");
        } catch (error) {
            haptic("error");
            showToast?.(`${userMessage(error, "Couldn't send your reply.")} Tap send to retry safely.`);
        } finally {
            sendingReply = false;
            button.classList.remove("sending");
            updateReplyButton();
            setPaused("reply-send", false);
        }
    }

    // Send Story to people (StorySharePeopleView) -------------------------------------
    async function openStoryShare() {
        const author = currentAuthor();
        const item = currentItem();
        if (!author || !item || !chatsEnabled()) return;
        closeMenu();
        shareItem = item;
        shareAuthor = author;
        shareSelected.clear();
        shareSent.clear();
        shareFailed.clear();
        sharePeople = [];
        const own = String(author.user_id) === String(getUser().id) || author.is_owner;
        $(".story-share-search").value = "";
        $(".story-share-preview small").textContent = own
            ? "Send your Story to classmates."
            : "Only classmates who can already view it are shown.";
        const thumbnail = safeURL(item.thumbnail_url) || (item.media_type === "photo" ? safeURL(item.media_url) : "");
        $(".story-share-thumb").innerHTML = `${thumbnail ? mediaImageMarkup(thumbnail, { alt: "", loading: "eager" }) : ""}${item.media_type === "video" ? `<i aria-hidden="true">${uiIcon("play")}</i>` : ""}`;
        $(".story-share-status").textContent = "Finding classmates…";
        $(".story-share-people").innerHTML = "";
        renderShareBar();
        setPaused("share", true);
        shareSheet.showModal();
        try {
            const [result, blocked] = await Promise.all([
                api.getClassmates(getUser().id, "", 500),
                api.getBlockedUsers ? api.getBlockedUsers(getUser().id).catch(() => []) : [],
            ]);
            const blockedIds = new Set((Array.isArray(blocked) ? blocked : []).map((person) => String(person.user_id || person.id)));
            sharePeople = (Array.isArray(result) ? result : result.items || result.classmates || [])
                .filter((person) => {
                    const id = String(person.user_id || person.id);
                    return id !== String(getUser().id) && id !== String(author.user_id) && !blockedIds.has(id);
                })
                .sort((left, right) => displayName(left).localeCompare(displayName(right), undefined, { sensitivity: "base" }))
                .slice(0, 500);
            $(".story-share-status").textContent = "";
            renderSharePeople();
        } catch (error) {
            $(".story-share-status").textContent = userMessage(error, "Couldn't load classmates.");
        }
    }

    function renderSharePeople() {
        const query = $(".story-share-search").value.trim().toLowerCase();
        const own = Boolean(shareAuthor?.is_owner);
        const rows = sharePeople.filter((person) => {
            const text = `${displayName(person)} ${person.username || ""} ${person.school_name || ""}`.toLowerCase();
            return !query || text.includes(query);
        }).map((person) => {
            const id = String(person.user_id || person.id);
            const sent = shareSent.has(id);
            const failed = shareFailed.has(id);
            const selected = shareSelected.has(id);
            const avatar = safeURL(person.profile_picture_url_thumb || person.profile_picture_url);
            const state = sent ? "sent" : failed ? "failed" : selected ? "selected" : "";
            const status = sent ? "Sent" : failed ? "Not sent, select to retry" : "";
            return `<label class="${state}"><input type="checkbox" value="${escapeHTML(id)}" ${selected || sent ? "checked" : ""} ${sent || sharing ? "disabled" : ""}><span class="story-share-avatar">${avatar ? mediaImageMarkup(avatar, { initials: displayName(person).slice(0, 1).toUpperCase() }) : `<span>${escapeHTML(displayName(person).slice(0, 1).toUpperCase())}</span>`}</span><span class="story-share-name"><strong>${escapeHTML(displayName(person))}</strong><small>${escapeHTML(person.username ? `@${person.username}` : person.school_name || "Classmate")}</small>${status ? `<em>${escapeHTML(status)}</em>` : ""}</span><span class="story-share-check" aria-hidden="true">${failed ? icon("alert") : uiIcon("check")}</span></label>`;
        }).join("");
        $(".story-share-people").innerHTML = rows || (sharePeople.length
            ? `<p class="story-share-empty">No one matches that search.</p>`
            : `<p class="story-share-empty"><strong>No classmates to send to</strong><small>${own ? "Classmates will appear here." : "Someone else's Story stays inside their school."}</small></p>`);
        renderShareBar();
    }

    function renderShareBar() {
        const count = shareSelected.size;
        $(".story-share-count").textContent = count >= SHARE_LIMIT ? `Maximum ${SHARE_LIMIT} people at a time` : count ? `${count} selected` : "";
        $(".story-share-send span").textContent = sharing ? "Sending…" : count ? "Send Story" : "Choose people";
        $(".story-share-send").disabled = sharing || !count;
        $("[data-close-story-share]").disabled = sharing;
    }

    function updateShareSelection(event) {
        const input = event.target.closest("input[type=checkbox]");
        if (!input) return;
        if (input.checked && shareSelected.size >= SHARE_LIMIT) {
            input.checked = false;
            showToast?.(`Choose up to ${SHARE_LIMIT} people at a time.`);
            return;
        }
        haptic("selection");
        if (input.checked) shareSelected.add(input.value);
        else shareSelected.delete(input.value);
        input.closest("label")?.classList.toggle("selected", input.checked);
        renderShareBar();
    }

    async function sendSharedStory(event) {
        event.preventDefault();
        const item = shareItem;
        const recipients = [...shareSelected].slice(0, SHARE_LIMIT);
        if (!item || !recipients.length || sharing) return;
        sharing = true;
        shareFailed.clear();
        renderSharePeople();
        let pending = 0;
        for (const recipientId of recipients) {
            try {
                const outcome = await deliverStory({ storyId: item.id, recipientId, context: "share" });
                shareSent.add(recipientId);
                shareSelected.delete(recipientId);
                if (Number(outcome.chat?.pending_count || 0) > 0) pending += 1;
            } catch (_) {
                shareFailed.add(recipientId);
            }
        }
        sharing = false;
        renderSharePeople();
        if (!shareSent.size) {
            haptic("error");
            $(".story-share-status").textContent = "The Story wasn't sent. Check your connection and try again.";
            return;
        }
        if (shareFailed.size) {
            haptic("warning");
            $(".story-share-status").textContent = `Sent to ${shareSent.size}. The people marked in red weren't sent; tap Send Story to retry.`;
            return;
        }
        haptic("success");
        const sentText = shareSent.size === 1 ? "Story sent" : `Story sent to ${shareSent.size} people`;
        shareSheet.close();
        showToast?.(pending ? `${sentText} · chat approval pending` : sentText);
    }

    // Viewers (StoryViewersSheet) -----------------------------------------------------
    async function showViewers() {
        const item = currentItem();
        if (!item || !currentAuthor()?.is_owner) return;
        closeMenu();
        viewersItem = item;
        viewerCursor = null;
        viewerRows = [];
        $("#story-viewers-title").textContent = `Viewed by ${Number(item.view_count || 0)}`;
        setPaused("viewers", true);
        if (!viewersSheet.open) viewersSheet.showModal();
        await loadViewers({ reset: true });
    }

    function renderViewers({ state = null, message = "" } = {}) {
        const list = $(".story-viewers-list");
        viewersObserver?.disconnect();
        if (state === "loading") {
            list.innerHTML = `<div class="story-viewers-state"><span class="story-spinner" aria-hidden="true"></span><p>Loading viewers…</p></div>`;
            return;
        }
        if (state === "error") {
            list.innerHTML = `<div class="story-viewers-state" role="alert"><strong>Couldn't load viewers</strong><p>${escapeHTML(message)}</p><button type="button" class="primary-button" data-retry-story-viewers>Try Again</button></div>`;
            return;
        }
        if (!viewerRows.length) {
            list.innerHTML = `<div class="story-viewers-state">${icon("eye")}<strong>No views yet</strong><p>People who view this Story will appear here.</p></div>`;
            return;
        }
        const chats = chatsEnabled();
        list.innerHTML = viewerRows.map((viewer) => {
            const name = displayName(viewer);
            const username = viewer.username ? (viewer.username.startsWith("@") ? viewer.username : `@${viewer.username}`) : "";
            const subtitle = [username, `Viewed ${viewAge(viewer.viewed_at)}`].filter(Boolean).join("  ·  ");
            const screenshots = Number(viewer.screenshot_count || 0);
            const recordings = Number(viewer.screen_capture_count || 0);
            const captures = screenshots + recordings;
            const recording = recordings > 0;
            const latest = [viewer.last_screenshot_at, viewer.last_screen_capture_at].filter(Boolean).sort().at(-1);
            const captureLabel = [
                screenshots ? `${screenshots} screenshot${screenshots === 1 ? "" : "s"}` : "",
                recordings ? `${recordings} screen recording${recordings === 1 ? "" : "s"}` : "",
            ].filter(Boolean).join(", ") + (latest ? `, ${viewAge(latest)}` : "");
            const badge = captures ? `<span class="story-capture-badge">${icon(recording ? "recording" : "screenshot")}${captures > 1 ? `<b aria-hidden="true">${captures}</b>` : ""}<span class="visually-hidden">${escapeHTML(captureLabel)}</span></span>` : "";
            const avatar = safeURL(viewer.profile_picture_url);
            const content = `<span class="story-viewer-avatar">${avatar ? mediaImageMarkup(avatar, { initials: name.slice(0, 1).toUpperCase() }) : `<span>${escapeHTML(name.slice(0, 1).toUpperCase())}</span>`}</span><span class="story-viewer-copy"><strong>${escapeHTML(name)}</strong><small>${escapeHTML(subtitle)}</small></span>${badge}`;
            return chats
                ? `<button type="button" class="story-viewer-row" data-message-viewer="${escapeHTML(viewer.user_id)}" aria-describedby="story-viewer-dm-hint">${content}<span class="story-viewer-chat" aria-hidden="true">${uiIcon("chat")}</span></button>`
                : `<article class="story-viewer-row">${content}</article>`;
        }).join("") + `<span id="story-viewer-dm-hint" hidden>Opens your chat</span>`;
        if (viewerCursor && viewerRows.length < MAX_STORY_VIEWERS) {
            list.insertAdjacentHTML("beforeend", `<button type="button" class="story-viewers-more" data-more-story-viewers>Load more viewers</button>`);
            if ("IntersectionObserver" in window) {
                viewersObserver = new IntersectionObserver((entries) => {
                    if (entries.some((entry) => entry.isIntersecting)) void loadViewers();
                }, { root: list });
                viewersObserver.observe(list.querySelector("[data-more-story-viewers]"));
            }
        }
    }

    async function loadViewers({ reset = false } = {}) {
        const item = viewersItem;
        if (!item || viewersLoading || (!reset && (!viewerCursor || viewerRows.length >= MAX_STORY_VIEWERS))) return;
        viewersLoading = true;
        if (reset) renderViewers({ state: "loading" });
        const more = $("[data-more-story-viewers]");
        if (more) more.disabled = true;
        try {
            const result = await api.getStoryViewers(getUser().id, item.id, { cursor: reset ? null : viewerCursor, limit: 50 });
            if (item !== viewersItem) return;
            const seen = new Set(viewerRows.map((viewer) => String(viewer.user_id)));
            viewerRows.push(...(result.viewers || []).filter((viewer) => !seen.has(String(viewer.user_id))));
            viewerRows = viewerRows.slice(0, MAX_STORY_VIEWERS);
            viewerCursor = result.next_cursor || null;
            renderViewers();
        } catch (error) {
            // Keep a loaded page usable; only an empty first page shows the error.
            if (reset || !viewerRows.length) renderViewers({ state: "error", message: userMessage(error, "Check your connection and try again.") });
            else if (more) more.disabled = false;
        } finally {
            viewersLoading = false;
        }
    }

    async function messageViewer(userId, button) {
        if (!userId || button.disabled) return;
        for (const row of viewersSheet.querySelectorAll("[data-message-viewer]")) row.disabled = true;
        button.classList.add("opening");
        try {
            const created = await api.createChat(getUser().id, [userId], null);
            const chatId = created.chat?.id || created.id;
            if (!chatId) throw new Error("Couldn't open that chat.");
            haptic("medium");
            viewersSheet.close();
            close();
            const url = new URL(location.href);
            url.searchParams.set("chat", chatId);
            history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
            document.querySelector('.nav-item[data-panel="chats"]')?.click();
        } catch (error) {
            haptic("error");
            showToast?.(userMessage(error, "Couldn't open chat. Try again."));
        } finally {
            button.classList.remove("opening");
            for (const row of viewersSheet.querySelectorAll("[data-message-viewer]")) row.disabled = false;
        }
    }

    // Wiring ----------------------------------------------------------------------------
    dialog.addEventListener("click", (event) => {
        const target = event.target.closest("button");
        if (!target) {
            if (!menu.hidden && !event.target.closest(".story-menu")) closeMenu();
            return;
        }
        if (!menu.hidden && !target.closest(".story-menu") && !target.matches("[data-story-options]")) {
            closeMenu();
            return;
        }
        if (target.matches("[data-close-story]")) return close();
        if (target.matches("[data-next-story]")) return advance();
        if (target.matches("[data-previous-story]")) return retreat();
        if (target.matches("[data-story-next-person]")) return void adjacentAuthor("next");
        if (target.matches("[data-story-previous-person]")) return void adjacentAuthor("previous");
        if (target.matches("[data-story-options]")) return menu.hidden ? openMenu() : closeMenu();
        if (target.matches("[data-close-menu]")) return closeMenu({ restoreFocus: true });
        if (target.matches("[data-share-story]")) return void openStoryShare();
        if (target.matches("[data-story-viewers]")) return void showViewers();
        if (target.matches("[data-delete-story]")) { closeMenu(); return void deleteCurrent(); }
        if (target.matches("[data-report-story]")) { closeMenu(); return void reportCurrent(); }
        if (target.matches("[data-story-unmute]")) {
            soundOn = true;
            video.muted = false;
            target.hidden = true;
            if (!isPaused()) void playVideo();
        }
    });
    dialog.addEventListener("keydown", (event) => {
        if (event.target.closest("input, .story-menu")) return;
        if (event.key === "ArrowRight") { event.preventDefault(); advance(); }
        if (event.key === "ArrowLeft") { event.preventDefault(); retreat(); }
    });
    dialog.addEventListener("cancel", (event) => {
        if (!menu.hidden) { event.preventDefault(); closeMenu({ restoreFocus: true }); }
    });
    $(".story-reply").addEventListener("submit", sendStoryReply);
    replyInput.addEventListener("input", updateReplyButton);
    replyInput.addEventListener("focus", () => setPaused("reply", true));
    replyInput.addEventListener("blur", () => setPaused("reply", false));
    document.addEventListener("visibilitychange", () => setPaused("hidden", document.hidden));

    viewersSheet.addEventListener("click", (event) => {
        const target = event.target.closest("button");
        if (target?.matches("[data-close-story-viewers]")) return viewersSheet.close();
        if (target?.matches("[data-more-story-viewers]")) return void loadViewers();
        if (target?.matches("[data-retry-story-viewers]")) return void loadViewers({ reset: true });
        if (target?.matches("[data-message-viewer]")) return void messageViewer(target.dataset.messageViewer, target);
        if (event.target === viewersSheet) viewersSheet.close();
    });
    viewersSheet.addEventListener("close", () => {
        viewersObserver?.disconnect();
        viewersItem = null;
        setPaused("viewers", false);
    });
    shareSheet.querySelector("form").addEventListener("submit", sendSharedStory);
    shareSheet.addEventListener("click", (event) => {
        if (event.target.closest("[data-close-story-share]")) shareSheet.close();
        else if (event.target === shareSheet && !sharing) shareSheet.close();
    });
    shareSheet.addEventListener("cancel", (event) => { if (sharing) event.preventDefault(); });
    shareSheet.addEventListener("close", () => {
        shareItem = null;
        setPaused("share", false);
    });
    $(".story-share-search").addEventListener("input", renderSharePeople);
    $(".story-share-people").addEventListener("change", updateShareSelection);

    return {
        /** Opens at an author, at their first unseen item (or a given item). */
        open(nextAuthors, nextAuthorIndex, nextItemIndex = null) {
            authors = nextAuthors.filter((author) => author.items?.length);
            const target = nextAuthors[nextAuthorIndex];
            authorIndex = Math.max(0, authors.indexOf(target));
            itemIndex = nextItemIndex ?? firstUnviewedIndex(authors[authorIndex]);
            pauseReasons.delete("hidden");
            show();
        },
        showViewers,
        isOpen: () => dialog.open,
        close,
    };
}
