import { normalizeChat, normalizeMessage } from "./models.js";

export const MAX_MESSAGES_PER_CHAT = 500;

export function createChatStore() {
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
        state.chats = (items || []).map(normalizeChat).sort((left, right) => {
            const leftAttention = left.membership_status === "invited" || left.unread_count > 0;
            const rightAttention = right.membership_status === "invited" || right.unread_count > 0;
            if (leftAttention !== rightAttention) return leftAttention ? -1 : 1;
            return new Date(right.last_message_at || right.updated_at || 0) - new Date(left.last_message_at || left.updated_at || 0);
        });
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
