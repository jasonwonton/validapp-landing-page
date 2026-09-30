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
