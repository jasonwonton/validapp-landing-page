// The server owns retention, saves and deadlines. Never infer deletion from reads.
export const HISTORY_MODES = [
    { value: 'save', title: 'Keep history', subtitle: 'Keep messages for everyone', icon: 'chat-pair' },
    { value: 'after24Hours', title: 'Clear after 24 hours', subtitle: '24 hours after everyone views', icon: 'clock' },
    { value: 'afterLeaving', title: 'Clear after leaving', subtitle: 'After everyone views and leaves', icon: 'leave' },
];
export function canSaveMessage(message) {
    return message.status === 'active' && message.delivery_state === 'sent' && !message.view_once
        && Number.isSafeInteger(message.room_sequence) && message.room_sequence > 0
        && ['text', 'photo', 'video', 'audio', 'sticker'].includes(message.kind);
}
export function historyVisible(message, now = Date.now()) {
    return message.kind === 'memento' || (!message.history_cleared_at && message.status !== 'history_cleared'
        && !(Date.parse(message.history_expires_at) <= now));
}

function availableStorage() { try { return globalThis.localStorage; } catch (_) { return null; } }
export function createHistoryReceipts({ api, userId, onChange = () => {}, storage = availableStorage(),
    now = () => Date.now(), sessionId = crypto.randomUUID() }) {
    const prefix = `valid:chat-history-views:v1:${userId}:`;
    const key = prefix + sessionId;
    const rooms = new Map();
    let running = null, closed = false;
    // Separate keys prevent one tab from overwriting another's receipts. Open
    // rows survive crashes; reclaim only expired leases, never another live tab.
    function persist() {
        try {
            const data = [...rooms].map(([chat, room]) => ({ chat, open: [...room.open], ended: [...room.ended] }));
            if (data.some(r => r.open.length || r.ended.length)) storage.setItem(key, JSON.stringify({ at: now(), rooms: data }));
            else storage.removeItem(key);
        } catch (_) { /* In-memory receipts still work when storage is unavailable. */ }
    }
    function room(id) {
        if (!rooms.has(id)) rooms.set(id, { open: new Set(), ended: new Set(), sent: new Set() });
        return rooms.get(id);
    }
    function recover() {
        try {
            for (let i = storage.length - 1; i >= 0; i--) {
                const oldKey = storage.key(i);
                if (!oldKey?.startsWith(prefix) || oldKey === key) continue;
                const raw = storage.getItem(oldKey);
                if (!raw || raw.length > 2_000_000) continue;
                const old = JSON.parse(raw);
                if (!(old.at < now() - 120_000) || !Array.isArray(old.rooms)) continue;
                for (const row of old.rooms) {
                    if (typeof row.chat !== 'string' || !Array.isArray(row.open) || !Array.isArray(row.ended)) continue;
                    for (const n of [...row.open, ...row.ended]) if (Number.isSafeInteger(n) && n > 0) room(row.chat).ended.add(n);
                }
                // Keep source until the merged record has been durably written.
                persist();
                if (storage.getItem(key)) storage.removeItem(oldKey);
            }
        } catch (_) { /* Do not interrupt chat because of a damaged local queue. */ }
    }
    async function flush() {
        if (running) return running;
        if (api.user?.id !== userId) return;
        running = (async () => {
            for (const [chat, r] of rooms) {
                for (const ended of [false, true]) {
                    const numbers = [...(ended ? r.ended : r.open)].filter(n => ended || !r.sent.has(n));
                    for (let i = 0; i < numbers.length; i += 200) {
                        if (api.user?.id !== userId) return;
                        const batch = numbers.slice(i, i + 200);
                        try {
                            const result = await api.recordChatHistoryViews(userId, chat, batch, ended);
                            for (const n of batch) { if (ended) r.ended.delete(n); else r.sent.add(n); }
                            persist();
                            if (result.history_changed) onChange(chat);
                        } catch (_) { return; } // Retain exact receipts for reconnect/retry.
                    }
                }
                if (!r.open.size && !r.ended.size) rooms.delete(chat);
            }
        })().finally(() => { running = null; });
        return running;
    }
    function viewed(chat, sequences) {
        if (closed || !chat || api.user?.id !== userId) return;
        const r = room(chat);
        const size = r.open.size;
        for (const n of sequences) if (Number.isSafeInteger(n) && n > 0 && !r.ended.has(n)) r.open.add(n);
        if (r.open.size === size) return;
        persist();
        void flush();
    }
    function leave(chat) {
        for (const [id, r] of rooms) if (!chat || id === chat) {
            for (const n of r.open) r.ended.add(n);
            r.open.clear(); r.sent.clear();
        }
        persist();
        return flush().then(flush); // Include exits queued during an open receipt.
    }
    recover();
    if (rooms.size) void flush();
    const timer = setInterval(() => { if (api.user?.id === userId) { recover(); persist(); void flush(); } }, 30_000);
    return { viewed, leave, flush, close: async () => { closed = true; clearInterval(timer); await leave(); } };
}
