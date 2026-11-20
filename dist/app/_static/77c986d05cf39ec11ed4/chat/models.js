export const CHAT_REACTIONS = [
    ["love", "❤️"], ["funny", "😂"], ["eyes", "👀"],
    ["fire", "🔥"], ["surprised", "😮"], ["thumbs_down", "👎"],
];

export function normalizeChat(chat = {}) {
    return {
        ...chat,
        id: String(chat.id || ""),
        display_name: chat.display_name || chat.name || chat.pair_display_name || "Chat",
        membership_status: chat.membership_status || "accepted",
        accepted_count: Number(chat.accepted_count || 0),
        pending_count: Number(chat.pending_count || 0),
        unread_count: Number(chat.unread_count || 0),
        regular_unread_count: Number(chat.regular_unread_count ?? chat.unread_count ?? 0),
        last_room_sequence: Number(chat.last_room_sequence || 0),
        last_read_sequence: Number(chat.last_read_sequence || 0),
        today_memento_count: Number(chat.today_memento_count || 0),
        today_memento_eligible_count: Number(chat.today_memento_eligible_count || 0),
        member_previews: Array.isArray(chat.member_previews) ? chat.member_previews : [],
    };
}

// Native Recent means recent conversations, not a claim about anyone's presence.
export function recentConversations(chats) {
    const activity = chat => Math.max(...[chat.last_message_at, chat.unacknowledged_missed_call_at, chat.updated_at]
        .map(value => Date.parse(value) || 0));
    return chats.filter(chat => chat.membership_status === 'accepted' && chat.status === 'active'
        && (chat.last_message_at || Number(chat.last_room_sequence) > 0))
        .sort((a, b) => activity(b) - activity(a) || String(a.id).localeCompare(String(b.id)))
        .slice(0, 12);
}

export function normalizeMessage(message = {}) {
    return {
        ...message,
        id: String(message.id || message.client_request_id || crypto.randomUUID()),
        client_request_id: message.client_request_id ? String(message.client_request_id) : null,
        chat_id: String(message.chat_id || ""),
        room_sequence: Number(message.room_sequence || 0),
        kind: message.kind || "text",
        status: message.status || "active",
        reaction_count: Number(message.reaction_count || 0),
        reaction_summary: message.reaction_summary && typeof message.reaction_summary === "object" ? message.reaction_summary : {},
        delivery_state: message.delivery_state || "sent",
    };
}

export function chatNeedsMemento(chat, dailyLedgerEnabled) {
    return Boolean(dailyLedgerEnabled
        && chat?.membership_status === "accepted"
        && Number(chat?.accepted_count || 0) >= 2
        && !chat?.has_posted_today_memento);
}

// Matches ChatSummary.inboxAttentionPriority. Skipping unlocks reading, but an
// unposted Memento still belongs in the Memento attention tier on iOS.
export function chatAttentionPriority(chat, { dailyLedgerEnabled = false, callsEnabled = false } = {}) {
    if (callsEnabled && chat.unacknowledged_missed_call_id) return 3;
    if (chat.membership_status === 'invited' || Number(chat.regular_unread_count ?? chat.unread_count ?? 0) > 0
        || (Number(chat.unopened_view_once_count) > 0 && chat.next_view_once_room_sequence != null)) return 2;
    if (dailyLedgerEnabled && chat.membership_status === 'accepted' && Number(chat.accepted_count) >= 2 && !chat.has_posted_today_memento) return 1;
    return 0;
}

// ChatSummary.isGroup: a named chat or three or more people.
export function isGroupChatSummary(chat) {
    return chat?.name != null || Number(chat?.accepted_count || 0) + Number(chat?.pending_count || 0) >= 3;
}

// ChatSummary.invitedByDisplayName.
export function invitedByDisplayName(chat) {
    const name = [chat?.invited_by_first_name, chat?.invited_by_last_name].filter(Boolean).join(" ").trim();
    if (name) return name;
    return chat?.invited_by_username ? `@${chat.invited_by_username}` : "Someone";
}

// SayHiModel.wave: the opener a Say hi card sends.
export const SAY_HI_WAVE = "\u{1F44B}";

// ChatInvitationReviewModel.friendOpener: a friend's 1:1 opener (the server
// sends invitation_preview only between mutual contacts).
export function friendInvitationOpener(chat) {
    if (isGroupChatSummary(chat) || chat?.invitation_story_context || chat?.has_viewer_blocked_member === true) return null;
    return chat?.invitation_preview || null;
}

// ChatInboxMessageType: the status line's per-type icon and noun.
const INBOX_MESSAGE_TYPES = { memento: "memento", photo: "photo", video: "video", text: "text", sticker: "sticker", audio: "voice", story: "story" };
const INBOX_NOUNS = { memento: "Memento", photo: "photo", video: "video", text: "message", sticker: "sticker", voice: "voice note", story: "Story" };
export function inboxMessageType(kind) { return INBOX_MESSAGE_TYPES[kind] || null; }
export function inboxMessageNoun(type) { return INBOX_NOUNS[type] || "message"; }

// ChatInboxRowModel.messagePreview: old copy for rows the status line does not describe.
function inboxMessagePreview(chat, regularUnreadCount) {
    const separated = chat.regular_unread_count != null && chat.last_regular_message_kind !== undefined;
    const mine = separated ? chat.last_regular_message_is_mine === true : chat.last_message_is_mine === true;
    if (regularUnreadCount > 0 && mine) return regularUnreadCount === 1 ? "1 unread message" : `${regularUnreadCount} unread messages`;
    const sender = mine ? "You" : ((separated ? chat.last_regular_message_sender_first_name : chat.last_message_sender_first_name) || "Someone");
    const kind = separated ? chat.last_regular_message_kind : chat.last_message_kind;
    const body = separated ? chat.last_regular_message_body : chat.last_message_body;
    const nouns = { photo: "a photo", video: "a video", audio: "a voice message", memento: "a Memento", story: "a Story", sticker: "a sticker" };
    let detail;
    if (nouns[kind]) detail = `${sender} sent ${nouns[kind]}`;
    else if (body) detail = kind === "text" ? `${sender}: ${body}` : body;
    else if (Number(chat.unopened_view_once_count) > 0 && chat.next_view_once_room_sequence != null) detail = "No unread messages";
    else detail = "No messages yet";
    return regularUnreadCount > 0 ? `${regularUnreadCount} unread · ${detail}` : detail;
}

// ChatInboxRowModel.status (iOS 1.6033 status line), highest precedence first.
// Returns { kind, type?, count?, text?, video? }.
export function chatInboxStatus(chat, { callsEnabled = false, hasSendFailure = false, isSending = false } = {}) {
    if (hasSendFailure) return { kind: "failed" };
    if (chat.membership_status === "invited") {
        if (isGroupChatSummary(chat)) {
            if (chat.has_viewer_blocked_member === true) return { kind: "plain", text: "Someone you blocked is in this group · Tap to review" };
            return { kind: "plain", text: `${invitedByDisplayName(chat)} invited you · ${Number(chat.accepted_count || 0) + Number(chat.pending_count || 0)} people` };
        }
        const preview = friendInvitationOpener(chat);
        if (preview) return { kind: "plain", text: preview === SAY_HI_WAVE ? `Said hi ${SAY_HI_WAVE} · Tap to wave back` : `${preview} · Tap to reply` };
        return { kind: "plain", text: `${invitedByDisplayName(chat)} invited you · Tap to review` };
    }
    if (Number(chat.accepted_count || 0) < 2 && Number(chat.pending_count || 0) > 0) return { kind: "plain", text: "Waiting for them to accept" };
    if (callsEnabled && chat.unacknowledged_missed_call_id) return { kind: "missedCall", video: chat.unacknowledged_missed_call_media_type === "video" };
    const regularUnread = Math.max(0, Number(chat.regular_unread_count ?? chat.unread_count ?? 0));
    const separated = chat.last_regular_message_kind !== undefined;
    const latestIsMine = separated ? chat.last_regular_message_is_mine === true : chat.last_message_is_mine === true;
    const latestKind = separated ? chat.last_regular_message_kind : chat.last_message_kind;
    const latestType = inboxMessageType(latestKind);
    const hasSnaps = Number(chat.unopened_view_once_count) > 0 && chat.next_view_once_room_sequence != null;
    const unopenedSnaps = hasSnaps ? Math.max(Number(chat.unopened_view_once_count) || 1, 1) : 0;
    const newCount = regularUnread + unopenedSnaps;
    if (newCount > 0) {
        const newest = regularUnread > 0
            ? (latestIsMine ? (inboxMessageType(chat.newest_unread_message_kind) || "text") : (latestType || "text"))
            : (inboxMessageType(chat.next_view_once_kind) || "photo");
        return newCount === 1 ? { kind: "new", type: newest } : { kind: "newCount", count: newCount, type: newest };
    }
    if (isSending) return { kind: "sending", type: latestType || "text" };
    if (!latestKind) return { kind: "plain", text: "No messages yet" };
    if (!latestType) return { kind: "plain", text: inboxMessagePreview(chat, regularUnread) };
    if (!latestIsMine) return { kind: "yourMove", type: latestType };
    const opened = chat.last_regular_message_opened_count;
    if (!separated || opened == null) return { kind: "sent", type: latestType };
    if (Number(opened) <= 0) return { kind: "delivered", type: latestType };
    if (!isGroupChatSummary(chat)) return { kind: "opened", type: latestType };
    const audience = Math.max(Number(chat.last_regular_message_audience_count ?? (Number(chat.accepted_count || 0) - 1)), 1);
    return Number(opened) >= audience ? { kind: "openedByEveryone", type: latestType } : { kind: "openedBy", count: Number(opened), type: latestType };
}

// When the status line's event happened; null for lines with no time.
export function chatInboxStatusDate(status, chat) {
    if (status.kind === "failed" || status.kind === "plain") return null;
    if (status.kind === "missedCall") return chat.unacknowledged_missed_call_at || chat.last_message_at || chat.updated_at || null;
    return (chat.last_regular_message_kind !== undefined ? chat.last_regular_message_at : null) || chat.last_message_at || chat.updated_at || null;
}

// ChatInboxRowModel.compactTime: "now", "5m", "2h", "3d", "2w".
export function compactChatTime(value, now = Date.now()) {
    const at = Date.parse(value);
    if (!Number.isFinite(at)) return "";
    const seconds = Math.max(0, (now - at) / 1000);
    if (seconds < 60) return "now";
    if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
    if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`;
    return `${Math.floor(seconds / (7 * 86_400))}w`;
}

// ChatInboxRowModel.accessibilityLabel.
export function chatInboxStatusLabel(status, { isGroup = false, time = "" } = {}) {
    const when = time ? `, ${time === "now" ? "just now" : `${time} ago`}` : "";
    const noun = inboxMessageNoun(status.type);
    switch (status.kind) {
    case "failed": return "A message didn't send. Open the chat to retry.";
    case "plain": return status.text;
    case "missedCall": return `Missed ${status.video ? "video" : "voice"} call${when}`;
    case "new": return `New ${noun}${when}`;
    case "newCount": return `${status.count} new, the newest a ${noun}${when}`;
    case "sending": return `Sending your ${noun}`;
    case "yourMove": return `Your move. Their ${noun}${when}`;
    case "delivered": return `Your ${noun}, delivered, ${isGroup ? "nobody has opened it yet" : "not opened yet"}${when}`;
    case "opened": return `Your ${noun}, opened${when}`;
    case "openedBy": return `Your ${noun}, opened by ${status.count} ${status.count === 1 ? "person" : "people"}${when}`;
    case "openedByEveryone": return `Your ${noun}, opened by everyone${when}`;
    default: return `You sent a ${noun}${when}`;
    }
}

// Memento streak (MementoStreakRiskBadge / MementoStreakDeadline).
export const STREAK_WARNING_WINDOW_MS = 4 * 60 * 60_000;
export const STREAK_FINAL_HOUR_MS = 60 * 60_000;

export function streakAtRisk(chat) {
    return chat?.moment_streak_at_risk === true && Number(chat?.moment_streak) > 0 && Number(chat?.accepted_count) >= 2;
}

export function streakBroken(chat) {
    return chat?.moment_streak_broken === true && Number(chat?.moment_streak) > 0 && Number(chat?.accepted_count) >= 2;
}

// The next local midnight: the end of the viewer's ledger day.
export function nextLocalMidnight(now = new Date()) {
    const end = new Date(now);
    end.setHours(24, 0, 0, 0);
    return end;
}

// Time left before an at-risk streak drops while the hourglass shows; null
// when it is safe or midnight is more than four hours away.
export function streakTimeLeft(atRisk, now = new Date()) {
    if (!atRisk) return null;
    const left = nextLocalMidnight(now) - now;
    return left > 0 && left <= STREAK_WARNING_WINDOW_MS ? left : null;
}

export function streakIsFinalHour(timeLeft) { return timeLeft < STREAK_FINAL_HOUR_MS; }

// "1h 48m", "38m", "<1m". Minutes round up; the red final hour never reads "1h 0m".
export function streakCountdown(timeLeft) {
    if (!Number.isFinite(timeLeft) || timeLeft <= 0) return "<1m";
    let minutes = Math.ceil(timeLeft / 60_000);
    if (streakIsFinalHour(timeLeft)) minutes = Math.min(minutes, 59);
    if (minutes < 1) return "<1m";
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// MementoStreakWording.accessibilityLabel.
export function streakAccessibilityLabel(streak, { broken = false, atRisk = false } = {}) {
    const base = `${streak} day Memento streak`;
    if (!broken) return base + (atRisk ? ", breaks tonight unless someone posts a Memento" : "");
    return `${base}, broken. Post a Memento${atRisk ? " by midnight" : ""} to restore it`;
}

// ChatMementoRevealPolicy.isHidden: someone else's Memento from the viewer's
// today (or later) waits until the viewer has posted to this chat today.
export function mementoIsHidden(message, { today, revealsToday }) {
    if (revealsToday || message?.kind !== "memento" || message.viewer_is_sender) return false;
    const date = String(message.memento_ledger_date || "").slice(0, 10);
    return Boolean(date) && date >= today;
}

export function chatPreview(chat) {
    if (chat.membership_status === "invited") return `${chat.invited_by_first_name || "Someone"} invited you`;
    if (chat.last_message_kind === "memento") return `${chat.last_message_sender_first_name || "Someone"} sent a Memento`;
    if (["photo", "video"].includes(chat.last_message_kind)) return `${chat.last_message_sender_first_name || "Someone"} sent ${chat.last_message_kind === "photo" ? "a photo" : "a video"}`;
    if (chat.last_message_kind === "sticker") return `${chat.last_message_sender_first_name || "Someone"} sent a sticker`;
    if (chat.last_message_kind === "audio") return `${chat.last_message_sender_first_name || "Someone"} sent a voice message`;
    if (chat.last_message_kind === "story") return `${chat.last_message_sender_first_name || "Someone"} sent a Story`;
    return chat.last_message_body || "Start the conversation";
}

export function displayMember(member = {}) {
    return [member.first_name, member.last_name].filter(Boolean).join(" ").trim()
        || (member.username ? `@${member.username}` : "Student");
}

export function messageTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

const DAY_MS = 86_400_000;
const SEPARATOR_GAP_MS = 60 * 60_000;

function localDayStart(value) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

// "Today", "Yesterday", a weekday this week, then "Sep 7" (with the year once it differs).
export function chatDayLabel(value, now = new Date()) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    const days = Math.round((localDayStart(now) - localDayStart(date)) / DAY_MS);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days > 1 && days < 7) return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
    return new Intl.DateTimeFormat(undefined, {
        month: "short", day: "numeric",
        ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}),
    }).format(date);
}

// A separator starts the conversation, every new local day, and any gap over an hour.
export function chatSeparatorBefore(message, previous) {
    const at = Date.parse(message?.created_at);
    if (!Number.isFinite(at) || message?.delivery_state === "sending" || message?.delivery_state === "failed") return null;
    const before = Date.parse(previous?.created_at);
    if (previous && Number.isFinite(before) && localDayStart(before) === localDayStart(at) && at - before < SEPARATOR_GAP_MS) return null;
    return { at: new Date(at).toISOString(), day: chatDayLabel(at), time: messageTime(at) };
}

// Long-press footer: "Today at 3:42 PM", "Mon at 9:10 AM", "Sep 7 at 2:00 PM".
export function messageDateTime(value, now = new Date()) {
    const day = chatDayLabel(value, now);
    const time = messageTime(value);
    return day && time ? `${day} at ${time}` : time;
}

const LINK_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

function trimLinkTail(text) {
    let value = text;
    while (/[.,!?;:'"\]}>)]$/.test(value)) {
        if (value.endsWith(")") && value.split("(").length > value.split(")").length - 1) break;
        value = value.slice(0, -1);
    }
    return value;
}

// Escaped message text with http(s) links made tappable. Nothing else becomes markup.
export function linkifyChatText(text) {
    const value = String(text ?? "");
    let html = "";
    let last = 0;
    for (const match of value.matchAll(LINK_PATTERN)) {
        const raw = trimLinkTail(match[0]);
        if (!raw || /^www\.$/i.test(raw)) continue;
        let href;
        try {
            const url = new URL(/^www\./i.test(raw) ? `https://${raw}` : raw);
            if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
            href = url.href;
        } catch (_) { continue; }
        html += `${escapeChatHTML(value.slice(last, match.index))}<a href="${escapeChatHTML(href)}" target="_blank" rel="noopener noreferrer">${escapeChatHTML(raw)}</a>`;
        last = match.index + raw.length;
    }
    return html + escapeChatHTML(value.slice(last));
}

export const KNOWN_MESSAGE_KINDS = new Set(["text", "system", "tombstone", "memento", "photo", "video", "audio", "story", "sticker"]);

export function relativeChatTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
    if (minutes < 1) return "now";
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 1_440) return `${Math.floor(minutes / 60)}h`;
    if (minutes < 10_080) return `${Math.floor(minutes / 1_440)}d`;
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export function escapeChatHTML(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
}

export function safeMediaURL(value, api) {
    if (!value) return "";
    try {
        const url = new URL(api.assetURL(value));
        return ["http:", "https:", "blob:"].includes(url.protocol) ? url.href : "";
    } catch (_) {
        return "";
    }
}

// A browser is never handed the phone's HEVC master. While the H.264
// rendition is being made the server sends no video_url and says whether to
// wait ("processing") or send the viewer to the app ("unavailable").
export function videoPlaybackState(message = {}) {
    if (message.kind !== "video") return null;
    if (message.video_url) return "ready";
    if (message.video_state === "processing" || message.video_state === "unavailable") return message.video_state;
    return null;
}

export const VIDEO_REFRESH_DELAYS_MS = [3_000, 5_000, 8_000, 13_000, 20_000, 30_000];
export const VIDEO_REFRESH_GIVE_UP_MS = 4 * 60_000;

// Backoff for re-reading a processing video, or null once it is time to stop.
export function videoRefreshDelay(attempt, elapsedMs) {
    if (elapsedMs >= VIDEO_REFRESH_GIVE_UP_MS) return null;
    const delay = VIDEO_REFRESH_DELAYS_MS[Math.min(attempt, VIDEO_REFRESH_DELAYS_MS.length - 1)];
    return Math.min(delay, VIDEO_REFRESH_GIVE_UP_MS - elapsedMs);
}

export const VIDEO_UNAVAILABLE_MESSAGE = "This video can't play on the web. Open it in the Valid app.";
export const VIDEO_PROCESSING_MESSAGE = "This video is still processing. It will play in a moment.";
