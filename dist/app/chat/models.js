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
        && chat?.is_memento_eligible_today !== false
        && !chat?.has_posted_today_memento);
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
