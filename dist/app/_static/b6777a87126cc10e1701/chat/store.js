import { normalizeChat, normalizeMessage } from "./models.js";

export const MAX_MESSAGES_PER_CHAT = 500;

// ChatInboxOrder: most recent activity only (latest message or missed call).
// Unread, invites and Mementos highlight a row; they never move it.
export function chatActivityAt(chat) {
    const times = [chat.last_message_at, chat.unacknowledged_missed_call_at].map(value => Date.parse(value || '')).filter(Number.isFinite);
    return times.length ? Math.max(...times) : Date.parse(chat.updated_at || '') || 0;
}

export function createChatStore() {
    let activityById = new Map();
    const state = {
        chats: [],
        activeChatId: null,
        detail: null,
        messagesByChat: new Map(),
        messagePageByChat: new Map(),
        dailyRow: null,
        displayedDailyRow: null,
        dailyRowsByDate: new Map(),
        typingUserIds: new Set(),
        replyToMessageId: null,
        loadingList: false,
        loadingRoom: false,
        lastEventId: null,
    };

    function replaceChats(items) {
        const chats = [...new Map((items || []).map(normalizeChat)
            .filter(chat => ['accepted', 'invited'].includes(chat.membership_status)).map(chat => [chat.id, chat])).values()];
        const byId = new Map(chats.map(chat => [chat.id, chat]));
        // An older snapshot never moves a row back down.
        const next = new Map(chats.map(chat => [chat.id, Math.max(chatActivityAt(chat), activityById.get(chat.id) || 0)]));
        activityById = next; // Bounded to visible membership, never historical rooms.
        const order = [...next.keys()].sort((a, b) => next.get(b) - next.get(a) || (a < b ? -1 : a > b ? 1 : 0));
        state.chats = order.map(id => byId.get(id));
        return state.chats;
    }

    function upsertChat(chat) {
        const normalized = normalizeChat(chat);
        replaceChats([normalized, ...state.chats.filter((item) => item.id !== normalized.id)]);
        return normalized;
    }

    function messages(chatId = state.activeChatId) {
        return state.messagesByChat.get(String(chatId)) || [];
    }

    function replaceMessages(chatId, items, page = {}) {
        const normalized = (items || []).map(normalizeMessage);
        const unique = new Map();
        for (const message of normalized) unique.set(message.id, message);
        const ordered = [...unique.values()]
            .sort((left, right) => left.room_sequence - right.room_sequence)
            .slice(-MAX_MESSAGES_PER_CHAT);
        state.messagesByChat.set(String(chatId), ordered);
        state.messagePageByChat.set(String(chatId), page);
        return ordered;
    }

    function mergeMessages(chatId, items, { prepend = false } = {}) {
        const existing = messages(chatId);
        const next = prepend ? [...items, ...existing] : [...existing, ...items];
        const byClientRequest = new Map();
        const byServerId = new Map();
        for (const raw of next.map(normalizeMessage)) {
            if (!raw.client_request_id) {
                byServerId.set(raw.id, raw);
                continue;
            }
            const prior = byClientRequest.get(raw.client_request_id);
            const rawIsOptimistic = String(raw.id).startsWith("pending:");
            const priorIsOptimistic = String(prior?.id || "").startsWith("pending:");
            if (!prior || priorIsOptimistic || !rawIsOptimistic) {
                byClientRequest.set(raw.client_request_id, raw);
            }
        }
        const seen = new Set();
        const resolved = [];
        for (const message of [...byServerId.values(), ...byClientRequest.values()]) {
            if (seen.has(message.id)) continue;
            seen.add(message.id);
            resolved.push(message);
        }
        resolved.sort((left, right) => left.room_sequence - right.room_sequence || String(left.created_at).localeCompare(String(right.created_at)));
        // History is a rolling buffer, not a hard stop after 500 messages.
        const bounded = prepend ? resolved.slice(0, MAX_MESSAGES_PER_CHAT) : resolved.slice(-MAX_MESSAGES_PER_CHAT);
        state.messagesByChat.set(String(chatId), bounded);
        return bounded;
    }

    function updateMessage(chatId, message) {
        const normalized = normalizeMessage(message);
        const next = messages(chatId).filter((item) => item.id !== normalized.id && (!normalized.client_request_id || item.client_request_id !== normalized.client_request_id));
        return replaceMessages(chatId, [...next, normalized], state.messagePageByChat.get(String(chatId)) || {});
    }

    return { state, replaceChats, upsertChat, messages, replaceMessages, mergeMessages, updateMessage };
}
