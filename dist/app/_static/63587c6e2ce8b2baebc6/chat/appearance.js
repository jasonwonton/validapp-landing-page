export const CHAT_APPEARANCE_STORAGE_KEY = "valid:chat-appearance:v1";
export const MAX_CHAT_APPEARANCES_PER_USER = 100;
export const MAX_CHAT_APPEARANCES_GLOBAL = 200;

export const CHAT_FONT_STYLES = Object.freeze([
    Object.freeze({ value: "six7", label: "Six7" }),
    Object.freeze({ value: "system", label: "System" }),
    Object.freeze({ value: "rounded", label: "Rounded" }),
    Object.freeze({ value: "serif", label: "Serif" }),
    Object.freeze({ value: "monospaced", label: "Mono" }),
]);

export const CHAT_COLOR_STYLES = Object.freeze([
    Object.freeze({ value: "teal", label: "Teal" }),
    Object.freeze({ value: "blue", label: "Blue" }),
    Object.freeze({ value: "purple", label: "Purple" }),
    Object.freeze({ value: "pink", label: "Pink" }),
    Object.freeze({ value: "orange", label: "Orange" }),
    Object.freeze({ value: "green", label: "Green" }),
]);

export const DEFAULT_CHAT_APPEARANCE = Object.freeze({ font: "six7", color: "teal" });

const FONT_VALUES = new Set(CHAT_FONT_STYLES.map(({ value }) => value));
const COLOR_VALUES = new Set(CHAT_COLOR_STYLES.map(({ value }) => value));

function safeId(value) {
    const normalized = String(value || "").trim();
    return normalized && normalized.length <= 128 ? normalized.toLowerCase() : "";
}

export function normalizeChatAppearance(value) {
    return {
        font: FONT_VALUES.has(value?.font) ? value.font : DEFAULT_CHAT_APPEARANCE.font,
        color: COLOR_VALUES.has(value?.color) ? value.color : DEFAULT_CHAT_APPEARANCE.color,
    };
}

function readEntries(storage) {
    try {
        const parsed = JSON.parse(storage?.getItem(CHAT_APPEARANCE_STORAGE_KEY) || "null");
        if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) return [];
        return parsed.entries.flatMap((entry) => {
            const userId = safeId(entry?.user_id);
            const chatId = safeId(entry?.chat_id);
            if (!userId || !chatId) return [];
            return [{
                user_id: userId,
                chat_id: chatId,
                ...normalizeChatAppearance(entry),
                updated_at: Math.max(0, Number(entry.updated_at) || 0),
            }];
        });
    } catch {
        return [];
    }
}

function writeEntries(storage, entries) {
    try {
        storage?.setItem(CHAT_APPEARANCE_STORAGE_KEY, JSON.stringify({ version: 1, entries }));
        return true;
    } catch {
        return false;
    }
}

function browserStorage() {
    try {
        return globalThis.localStorage;
    } catch {
        return null;
    }
}

export function loadChatAppearance(userId, chatId, providedStorage) {
    const storage = providedStorage === undefined ? browserStorage() : providedStorage;
    const safeUserId = safeId(userId);
    const safeChatId = safeId(chatId);
    if (!safeUserId || !safeChatId) return { ...DEFAULT_CHAT_APPEARANCE };
    const entry = readEntries(storage).find((item) => item.user_id === safeUserId && item.chat_id === safeChatId);
    return normalizeChatAppearance(entry);
}

export function saveChatAppearance(userId, chatId, appearance, providedStorage) {
    const storage = providedStorage === undefined ? browserStorage() : providedStorage;
    const safeUserId = safeId(userId);
    const safeChatId = safeId(chatId);
    const normalized = normalizeChatAppearance(appearance);
    if (!safeUserId || !safeChatId) return normalized;

    let entries = readEntries(storage).filter((entry) => !(entry.user_id === safeUserId && entry.chat_id === safeChatId));
    if (normalized.font !== DEFAULT_CHAT_APPEARANCE.font || normalized.color !== DEFAULT_CHAT_APPEARANCE.color) {
        entries.unshift({ user_id: safeUserId, chat_id: safeChatId, ...normalized, updated_at: Date.now() });
    }

    const retainedByUser = new Map();
    const retainedKeys = new Set();
    entries = entries
        .sort((left, right) => right.updated_at - left.updated_at)
        .filter((entry) => {
            if (entry.font === DEFAULT_CHAT_APPEARANCE.font && entry.color === DEFAULT_CHAT_APPEARANCE.color) return false;
            const key = `${entry.user_id}\n${entry.chat_id}`;
            if (retainedKeys.has(key)) return false;
            const retained = retainedByUser.get(entry.user_id) || 0;
            if (retained >= MAX_CHAT_APPEARANCES_PER_USER) return false;
            retainedKeys.add(key);
            retainedByUser.set(entry.user_id, retained + 1);
            return true;
        })
        .slice(0, MAX_CHAT_APPEARANCES_GLOBAL);
    writeEntries(storage, entries);
    return normalized;
}
