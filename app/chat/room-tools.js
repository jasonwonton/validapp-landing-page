// Room interactions that are not needed to paint a chat, loaded when a room
// opens: the swipe-to-reveal time lane, voice players and the report flow.
import { uiIcon } from "../ui-icons.js";
import { setRuntimeStyles } from "../runtime-style.js";
import { confirmSheet, reasonSheet } from "../ui-dialogs.js";

const VOICE_SPEEDS = [1, 1.5, 2];

// Matches iOS RelativeDateTimeFormatter (.numeric, .abbreviated) for the swipe-to-reveal lane.
export function relativeSentTime(value, now = Date.now()) {
    const at = Date.parse(value);
    if (!Number.isFinite(at)) return "";
    const seconds = Math.round((at - now) / 1000);
    const format = new Intl.RelativeTimeFormat(undefined, { numeric: "always", style: "short" });
    const abs = Math.abs(seconds);
    if (abs < 60) return format.format(seconds, "second");
    if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
    if (abs < 86_400) return format.format(Math.round(seconds / 3600), "hour");
    if (abs < 7 * 86_400) return format.format(Math.round(seconds / 86_400), "day");
    return format.format(Math.round(seconds / (7 * 86_400)), "week");
}

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function formatClock(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

// iOS messageTimeRevealGesture: a leftward drag (22 pt, clearly more horizontal
// than vertical) slides every row up to 86 pt to show send times, then springs back.
export function bindTimeReveal(timeline, { width = 86 } = {}) {
    let gesture = null, suppressClickUntil = 0;
    const set = (offset, settle) => {
        timeline.classList.toggle("is-revealing-times", offset > 0 || settle);
        timeline.classList.toggle("is-settling", settle);
        setRuntimeStyles(timeline, {
            "--chat-time-reveal": `${offset}px`,
            "--chat-time-reveal-opacity": String(Math.min(1, offset / (width * 0.55))),
        });
    };
    timeline.addEventListener("transitionend", (event) => {
        if (event.target.parentElement === timeline && timeline.classList.contains("is-settling")) timeline.classList.remove("is-settling", "is-revealing-times");
    });
    timeline.addEventListener("pointerdown", (event) => {
        if (!event.isPrimary || event.button > 0 || event.target.closest("input, textarea, audio, .chat-message-actions")) return;
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, active: false };
    });
    timeline.addEventListener("pointermove", (event) => {
        if (!gesture || event.pointerId !== gesture.id) return;
        const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
        if (!gesture.active) {
            if (Math.hypot(dx, dy) < 22) return;
            if (!(dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.25)) { gesture = null; return; }
            gesture.active = true;
            try { timeline.setPointerCapture(event.pointerId); } catch (_) { /* Pointer already released. */ }
            for (const time of timeline.querySelectorAll(".chat-reveal-time[datetime]")) time.textContent = relativeSentTime(time.getAttribute("datetime"));
        }
        set(Math.min(width, Math.max(0, -dx)), false);
    });
    const end = (event) => {
        if (!gesture || event.pointerId !== gesture.id) return;
        const active = gesture.active;
        gesture = null;
        if (!active) return;
        suppressClickUntil = performance.now() + 350;
        set(0, !reduceMotion());
        if (reduceMotion()) timeline.classList.remove("is-revealing-times");
    };
    timeline.addEventListener("dragstart", (event) => { if (event.target instanceof HTMLImageElement) event.preventDefault(); });
    timeline.addEventListener("pointerup", end);
    timeline.addEventListener("pointercancel", end);
    timeline.addEventListener("click", (event) => {
        if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
}

// One small player for the composer preview and every voice bubble (iOS
// ChatVoiceMessageViews): play/pause, scrub, "0:12 · −0:30", 1×/1.5×/2×.
export function bindVoicePlayers(root, { composerAudio, showToast, onChange } = {}) {
    const containerOf = (node) => node?.closest?.(".chat-voice-player, [data-voice-message]");
    function parts(container) {
        const composer = container.classList.contains("chat-voice-player");
        return {
            audio: composer ? composerAudio : container.querySelector("audio"),
            toggle: container.querySelector(composer ? "[data-voice-play]" : "[data-voice-toggle]"),
            seek: container.querySelector("input[type=range]"),
            clock: container.querySelector(".chat-voice-clock"),
            speed: container.querySelector("[data-voice-speed]"),
            label: composer ? "voice preview" : "voice message",
        };
    }
    function render(container) {
        const { audio, toggle, seek, clock, speed, label } = parts(container);
        if (!audio) return;
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number(clock?.dataset.duration) || 0;
        if (toggle) {
            const icon = audio.paused ? "play" : "pause";
            if (toggle.dataset.icon !== icon) { toggle.dataset.icon = icon; toggle.innerHTML = uiIcon(icon); }
            toggle.setAttribute("aria-label", `${audio.paused ? "Play" : "Pause"} ${label}`);
        }
        if (seek && !seek.matches(":active")) seek.value = duration ? String(audio.currentTime / duration * 100) : "0";
        seek?.setAttribute("aria-valuetext", `${formatClock(audio.currentTime)} of ${formatClock(duration)}`);
        if (clock) clock.textContent = `${formatClock(audio.currentTime)} · −${formatClock(Math.max(0, duration - audio.currentTime))}`;
        if (speed) speed.textContent = `${audio.playbackRate || 1}×`;
    }
    for (const type of ["play", "pause", "ended", "timeupdate", "loadedmetadata", "durationchange", "ratechange"]) {
        root.addEventListener(type, (event) => {
            if (!(event.target instanceof HTMLAudioElement)) return;
            const container = containerOf(event.target.parentElement) || (event.target === composerAudio ? root.querySelector(".chat-voice-player") : null);
            if (container) render(container);
        }, true);
    }
    root.addEventListener("input", (event) => {
        if (!event.target.matches(".chat-voice-player input[type=range], [data-voice-seek]")) return;
        const { audio } = parts(containerOf(event.target));
        if (audio && Number.isFinite(audio.duration)) audio.currentTime = Number(event.target.value) / 100 * audio.duration;
    });
    return {
        toggle(node) {
            const container = containerOf(node);
            const { audio } = container ? parts(container) : {};
            if (!audio) return;
            if (!audio.paused) return audio.pause();
            for (const other of root.querySelectorAll("audio")) if (other !== audio) other.pause();
            void audio.play().catch(() => showToast?.("Could not play this voice message."));
        },
        cycleSpeed(node) {
            const container = containerOf(node);
            const { audio, speed } = container ? parts(container) : {};
            if (!audio || !speed) return;
            const next = VOICE_SPEEDS[(VOICE_SPEEDS.indexOf(audio.playbackRate) + 1) % VOICE_SPEEDS.length] || 1;
            audio.playbackRate = next;
            audio.defaultPlaybackRate = next;
            speed.textContent = `${next}×`;
            speed.setAttribute("aria-label", `Playback speed ${next}×`);
            onChange?.();
        },
    };
}

// iOS ChatReportReasonView, then its "Report submitted" leave prompt.
export async function reportChatFlow({ chatName, isGroup, submit, leave, showToast, haptic }) {
    const choice = await reasonSheet({
        title: `Why are you reporting ${chatName}?`,
        message: "Your reason is sent for review. After reporting, you can choose whether to leave this chat.",
        reasons: ["Harassment or bullying", "Spam or scam", "Inappropriate content", "I feel unsafe in this chat"].map((label) => ({ value: label, label })),
        allowOther: true,
        otherLabel: "Something else",
        detailsLabel: "Describe what happened",
        detailsPlaceholder: "Or describe what happened…",
        confirmLabel: "Submit Report",
        destructive: true,
        legend: "Reason for reporting",
    });
    if (!choice) return false;
    const reason = (choice.reason === "other" ? choice.details : choice.reason).trim().slice(0, 500);
    if (reason.length < 3) { showToast?.("Tell us what happened so we can review it."); return false; }
    try {
        if (await submit(reason) === false) return false;
    } catch (error) {
        showToast?.(error.message || "Could not submit the report. Try again.");
        return false;
    }
    haptic?.("success");
    const leaving = await confirmSheet({
        title: "Report submitted",
        message: `Your report about ${chatName} was sent for review. Would you also like to leave ${isGroup ? "this group" : "this chat"}?`,
        confirmLabel: isGroup ? "Leave Group" : "Leave & Delete",
        cancelLabel: "Stay",
        destructive: true,
    });
    if (leaving) await leave();
    return true;
}
