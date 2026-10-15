// The chat list's status line, the Memento streak label and its hourglass,
// drawn as iOS 1.6033/1.6034 draw them (ChatInboxStatusLine,
// ChatInboxStatusGlyph, MementoStreakLabel, MementoStreakHourglass).
import { uiIcon } from "../ui-icons.js";
import {
    chatInboxStatusDate, chatInboxStatusLabel, compactChatTime, escapeChatHTML, inboxMessageNoun, isGroupChatSummary,
    streakAccessibilityLabel, streakAtRisk, streakBroken, streakCountdown, streakIsFinalHour, streakTimeLeft,
    STREAK_WARNING_WINDOW_MS,
} from "./models.js";

// ChatInboxGlyphShapes, on the same 16 × 16 box. Unions are drawn as one outline
// so a stroke never shows the seam between the parts.
const GLYPHS = {
    memento: {
        silhouette: "M.8 7A3 3 0 0 1 3.8 4h.8v-.8a1.6 1.6 0 0 1 1.6-1.6h3.6a1.6 1.6 0 0 1 1.6 1.6V4h.8a3 3 0 0 1 3 3v4.6a3 3 0 0 1-3 3H3.8a3 3 0 0 1-3-3Z",
        mark: "M4.5 9.4a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0ZM6.5 9.4a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0Z",
    },
    bubble: {
        silhouette: "M5.5 1.5h5A4.5 4.5 0 0 1 15 6v1.5A4.5 4.5 0 0 1 10.5 12H7.2L2.2 15l.6-3.4A4.5 4.5 0 0 1 1 7.5V6a4.5 4.5 0 0 1 4.5-4.5Z",
        mark: null,
    },
    photo: {
        silhouette: "M5.2 2h5.6A3.2 3.2 0 0 1 14 5.2v5.6a3.2 3.2 0 0 1-3.2 3.2H5.2A3.2 3.2 0 0 1 2 10.8V5.2A3.2 3.2 0 0 1 5.2 2Z",
        mark: "M8.4 6.1a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0-3.4 0Z",
        transform: "rotate(-9.74 8 8)",
    },
    video: {
        silhouette: "M4.2 3h7.6A3.2 3.2 0 0 1 15 6.2v4.1a3.2 3.2 0 0 1-3.2 3.2H4.2A3.2 3.2 0 0 1 1 10.3V6.2A3.2 3.2 0 0 1 4.2 3Z",
        mark: "M6.4 5.6v5.3l4.4-2.65Z",
    },
    voice: {
        silhouette: "M5.3 3.5h5.4a4.5 4.5 0 0 1 0 9H5.3a4.5 4.5 0 0 1 0-9Z",
        mark: "M4.6 7.2a.8.8 0 0 1 1.6 0v1.6a.8.8 0 0 1-1.6 0ZM7.2 6a.8.8 0 0 1 1.6 0v4a.8.8 0 0 1-1.6 0ZM9.8 7.2a.8.8 0 0 1 1.6 0v1.6a.8.8 0 0 1-1.6 0Z",
    },
    story: {
        silhouette: "M6.2.8h3.6a3 3 0 0 1 3 3v8.4a3 3 0 0 1-3 3H6.2a3 3 0 0 1-3-3V3.8a3 3 0 0 1 3-3Z",
        mark: "M6.4 5.4a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0ZM7.1 8.4h1.8a1.7 1.7 0 0 1 0 3.4H7.1a1.7 1.7 0 0 1 0-3.4Z",
    },
};

const glyphShape = type => GLYPHS[type === "text" || type === "sticker" ? "bubble" : type] || GLYPHS.bubble;

// ChatInboxStatusGlyph: filled (not opened yet), half (some of a group),
// hollow (opened) or a dashed grey outline (still sending). Decorative.
export function inboxGlyphMarkup(type, fill, size = 17) {
    const shape = glyphShape(type);
    const transform = shape.transform ? ` transform="${shape.transform}"` : "";
    const clip = `inbox-glyph-half-${type}`;
    let body;
    if (fill === "filled") {
        body = `<path class="glyph-fill" d="${shape.silhouette}"/>${shape.mark ? `<path class="glyph-mark" fill-rule="evenodd" d="${shape.mark}"/>` : ""}<path class="glyph-outline" d="${shape.silhouette}"/>`;
    } else if (fill === "half") {
        body = `<clipPath id="${clip}"><rect x="0" y="0" width="8" height="16"/></clipPath><path class="glyph-fill" clip-path="url(#${clip})" d="${shape.silhouette}"/><path class="glyph-stroke" d="${shape.silhouette}"/>${shape.mark ? `<path class="glyph-tint" fill-rule="evenodd" d="${shape.mark}"/>` : ""}`;
    } else if (fill === "sending") {
        body = `<path class="glyph-sending" d="${shape.silhouette}"/>`;
    } else {
        body = `<path class="glyph-stroke" d="${shape.silhouette}"/>${shape.mark ? `<path class="glyph-tint" fill-rule="evenodd" d="${shape.mark}"/>` : ""}`;
    }
    return `<svg class="inbox-glyph ${escapeChatHTML(type)} ${fill}" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" focusable="false"><g${transform}>${body}</g></svg>`;
}

const GLYPH_FILL = { new: "filled", newCount: "filled", sending: "sending", delivered: "filled", opened: "hollow", openedBy: "half", openedByEveryone: "hollow", sent: "filled" };
const WORDS = { sending: "Sending…", delivered: "Delivered", opened: "Opened", openedByEveryone: "Opened by everyone", sent: "Sent" };

function statusWord(status) {
    if (status.kind === "new") return `New ${inboxMessageNoun(status.type)}`;
    if (status.kind === "newCount") return `${status.count} new`;
    if (status.kind === "openedBy") return `Opened by ${status.count}`;
    return WORDS[status.kind] || "";
}

// ChatInboxStatusLine: an icon, a word and a time. Incoming words are bold.
export function inboxStatusLineMarkup(status, chat, { now = Date.now() } = {}) {
    const at = chatInboxStatusDate(status, chat);
    const time = at ? compactChatTime(at, now) : "";
    const label = chatInboxStatusLabel(status, { isGroup: isGroupChatSummary(chat), time });
    const timeMarkup = time ? `<time datetime="${escapeChatHTML(new Date(Date.parse(at)).toISOString())}">· ${escapeChatHTML(time)}</time>` : "";
    let inner;
    if (status.kind === "failed") inner = `<span class="chat-status-failed-icon" aria-hidden="true">!</span><b>Didn't send · Tap to retry</b>`;
    else if (status.kind === "plain") inner = `<span class="chat-status-text">${escapeChatHTML(status.text)}</span>`;
    else if (status.kind === "missedCall") inner = `<i class="chat-status-call" aria-hidden="true">${uiIcon(status.video ? "video" : "phone")}</i><b>Missed call</b>${timeMarkup}`;
    else if (status.kind === "yourMove") inner = `${inboxGlyphMarkup(status.type, "hollow")}<b class="chat-your-move">Your move</b>${timeMarkup}`;
    else {
        const incoming = status.kind === "new" || status.kind === "newCount";
        inner = `${inboxGlyphMarkup(status.type, GLYPH_FILL[status.kind] || "filled")}<span class="${incoming ? "chat-status-word incoming" : "chat-status-word"}">${escapeChatHTML(statusWord(status))}</span>${timeMarkup}`;
    }
    // Plain lines read as written; the rest say in words what the glyphs show.
    if (status.kind === "plain") return `<span class="chat-status-line plain"><span class="chat-status-visual">${inner}</span></span>`;
    return `<span class="chat-status-line ${escapeChatHTML(status.kind)}"><span class="visually-hidden">${escapeChatHTML(label)}</span><span class="chat-status-visual" aria-hidden="true">${inner}</span></span>`;
}

// MementoStreakHourglass: tinted glass, sand draining with the time left
// (the top bulb holds what remains of the four-hour window), red in the
// final hour. Paths on iOS's 24-point grid.
export function hourglassMarkup(timeLeft, size = 14) {
    const remaining = Math.min(Math.max(timeLeft / STREAK_WARNING_WINDOW_MS, 0), 1);
    const topY = 12 - 6.4 * remaining;
    const bottomY = 19 - 5.4 * (1 - remaining);
    const glass = "M6.5 4.5h11c0 4-4.3 6-4.3 7.5s4.3 3.5 4.3 7.5h-11c0-4 4.3-6 4.3-7.5S6.5 8.5 6.5 4.5Z";
    const red = streakIsFinalHour(timeLeft);
    const id = `hourglass-${Math.round(remaining * 1000)}`;
    return `<svg class="streak-hourglass${red ? " final-hour" : ""}" data-ui-icon="hourglass" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false"><defs><clipPath id="${id}"><path d="${glass}"/></clipPath></defs><path d="${glass}" fill="currentColor" fill-opacity=".28"/><g clip-path="url(#${id})" fill="currentColor"><rect x="4" y="${topY.toFixed(2)}" width="16" height="${(12 - topY).toFixed(2)}"/><rect x="4" y="${bottomY.toFixed(2)}" width="16" height="${(20 - bottomY).toFixed(2)}"/>${remaining > 0 ? `<rect x="11.7" y="12" width=".6" height="${(bottomY - 12).toFixed(2)}"/>` : ""}</g><rect x="4.5" y="2" width="15" height="2.6" rx="1.3" fill="currentColor"/><rect x="4.5" y="19.4" width="15" height="2.6" rx="1.3" fill="currentColor"/></svg>`;
}

// MementoStreakLabel: the flame (grey while broken), the bold number, and the
// hourglass in the last four hours before an at-risk streak drops.
export function streakLabelMarkup(chat, { now = new Date(), countdown = false } = {}) {
    const streak = Number(chat?.moment_streak);
    if (!Number.isSafeInteger(streak) || streak <= 0 || Number(chat?.accepted_count) < 2) return "";
    const atRisk = streakAtRisk(chat), broken = streakBroken(chat);
    const left = streakTimeLeft(atRisk, now);
    const risk = left == null ? "" : `<span class="streak-risk${streakIsFinalHour(left) ? " final-hour" : ""}">${hourglassMarkup(left)}${countdown ? `<span>${escapeChatHTML(streakCountdown(left))}</span>` : ""}</span>`;
    return `<span class="chat-moment-streak${broken ? " broken" : ""}" role="img" aria-label="${escapeChatHTML(streakAccessibilityLabel(streak, { broken, atRisk }))}">${uiIcon("fire")}<b>${streak}</b>${risk}</span>`;
}
