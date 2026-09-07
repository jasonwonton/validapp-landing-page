import { chatAttentionPriority, normalizeChat, normalizeMessage } from "./models.js";

export const MAX_MESSAGES_PER_CHAT = 500;

export function createChatStore({ attentionPriority = chatAttentionPriority } = {}) {
    let activityTokens = new Map();
    const activityAt = chat => Date.parse(chat.last_message_at || chat.updated_at || '') || 0;
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
        eventSource: null,
        reconnectTimer: null,
        lastEventId: null,
    };

    function replaceChats(items) {
        const chats = [...new Map((items || []).map(normalizeChat)
            .filter(chat => ['accepted', 'invited'].includes(chat.membership_status)).map(chat => [chat.id, chat])).values()];
        const byId = new Map(chats.map(chat => [chat.id, chat]));
        // The initial order within each tier is the authoritative inbox order.
        let order = state.chats.length ? state.chats.map(chat => chat.id).filter(id => byId.has(id))
            : [...chats].sort((a, b) => attentionPriority(b) - attentionPriority(a)).map(chat => chat.id);
        const nextTokens = new Map();
        const comesBefore = (a, b) => attentionPriority(a) > attentionPriority(b)
            || (attentionPriority(a) === attentionPriority(b) && (activityAt(a) > activityAt(b)
                || (activityAt(a) === activityAt(b) && a.id < b.id)));
        for (const chat of chats) {
            const previous = activityTokens.get(chat.id);
            const token = { sequence: chat.last_room_sequence, activity: activityAt(chat), priority: attentionPriority(chat) };
            const changed = previous && (token.sequence > previous.sequence || token.activity > previous.activity || token.priority !== previous.priority);
            if (changed) order = order.filter(id => id !== chat.id);
            if (!order.includes(chat.id)) {
                const index = order.findIndex(id => comesBefore(chat, byId.get(id)));
                order.splice(index < 0 ? order.length : index, 0, chat.id);
            }
            // Old snapshots must not lower the activity watermark.
            nextTokens.set(chat.id, { ...token, sequence: Math.max(token.sequence, previous?.sequence || 0), activity: Math.max(token.activity, previous?.activity || 0) });
        }
        activityTokens = nextTokens; // Bounded to visible membership, never historical rooms.
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
        const bounded = resolved.slice(-MAX_MESSAGES_PER_CHAT);
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
