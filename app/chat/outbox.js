const DATABASE_NAME = "six7-pwa";
const DATABASE_VERSION = 2;
const STORE_NAME = "chat-text-outbox";
const MEDIA_STORE_NAME = "chat-media-outbox";
const MAX_RECORDS_PER_USER = 50;
const MAX_RECORDS_GLOBAL = 200;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_AUTOMATIC_ATTEMPTS = 8;
export const MAX_MEDIA_AUTOMATIC_ATTEMPTS = 4;
const MAX_MEDIA_RECORDS_PER_USER = 3;
const MAX_MEDIA_RECORDS_GLOBAL = 10;
const MAX_MEDIA_AGE_MS = 24 * 60 * 60 * 1000;
let latestCreatedAt = 0;
let latestMediaCreatedAt = 0;

function openDatabase() {
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
                store.createIndex("user_id", "user_id", { unique: false });
            }
            if (!database.objectStoreNames.contains(MEDIA_STORE_NAME)) {
                const mediaStore = database.createObjectStore(MEDIA_STORE_NAME, { keyPath: "id" });
                mediaStore.createIndex("user_id", "user_id", { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function withStore(mode, callback) {
    return withNamedStore(STORE_NAME, mode, callback);
}

async function withNamedStore(storeName, mode, callback) {
    const database = await openDatabase();
    if (!database) return null;
    try {
        const transaction = database.transaction(storeName, mode);
        const completion = new Promise((resolve, reject) => {
            transaction.oncomplete = resolve;
            transaction.onabort = () => reject(transaction.error);
            transaction.onerror = () => reject(transaction.error);
        });
        const result = await callback(transaction.objectStore(storeName));
        await completion;
        return result;
    } finally {
        database.close();
    }
}

async function allMediaRecords() {
    return (await withNamedStore(MEDIA_STORE_NAME, "readonly", (store) => requestResult(store.getAll()))) || [];
}

async function pruneMedia(now = Date.now()) {
    const records = await allMediaRecords();
    const expired = records.filter((record) => now - Number(record.created_at || 0) > MAX_MEDIA_AGE_MS);
    const retained = records.filter((record) => !expired.includes(record));
    const overflow = [];
    const byUser = new Map();
    for (const record of retained) {
        const items = byUser.get(record.user_id) || [];
        items.push(record);
        byUser.set(record.user_id, items);
    }
    for (const items of byUser.values()) {
        items.sort((left, right) => Number(right.created_at) - Number(left.created_at));
        overflow.push(...items.slice(MAX_MEDIA_RECORDS_PER_USER));
    }
    const globallyRetained = retained.filter((record) => !overflow.includes(record)).sort((left, right) => Number(right.created_at) - Number(left.created_at));
    overflow.push(...globallyRetained.slice(MAX_MEDIA_RECORDS_GLOBAL));
    const ids = new Set([...expired, ...overflow].map((record) => record.id));
    if (ids.size) await withNamedStore(MEDIA_STORE_NAME, "readwrite", (store) => Promise.all([...ids].map((id) => requestResult(store.delete(id)))));
}

function recordId(userId, clientRequestId) {
    return `${String(userId)}:${String(clientRequestId)}`;
}

async function allRecords() {
    return (await withStore("readonly", (store) => requestResult(store.getAll()))) || [];
}

async function prune(now = Date.now()) {
    const records = await allRecords();
    const expired = records.filter((record) => now - Number(record.created_at || 0) > MAX_AGE_MS);
    const retained = records.filter((record) => !expired.includes(record));
    const overflow = [];
    const byUser = new Map();
    for (const record of retained) {
        const items = byUser.get(record.user_id) || [];
        items.push(record);
        byUser.set(record.user_id, items);
    }
    for (const items of byUser.values()) {
        items.sort((left, right) => Number(right.created_at) - Number(left.created_at));
        overflow.push(...items.slice(MAX_RECORDS_PER_USER));
    }
    const globallyRetained = retained
        .filter((record) => !overflow.includes(record))
        .sort((left, right) => Number(right.created_at) - Number(left.created_at));
    overflow.push(...globallyRetained.slice(MAX_RECORDS_GLOBAL));
    const ids = new Set([...expired, ...overflow].map((record) => record.id));
    if (ids.size) await withStore("readwrite", (store) => Promise.all([...ids].map((id) => requestResult(store.delete(id)))));
}

export async function putChatTextOutbox({ userId, chatId, clientRequestId, body, replyToMessageId = null }) {
    if (!userId || !chatId || !clientRequestId || !String(body || "").trim()) return null;
    const id = recordId(userId, clientRequestId);
    const previous = await withStore("readonly", (store) => requestResult(store.get(id))).catch(() => null);
    const now = Date.now();
    const createdAt = Number(previous?.created_at || Math.max(now, latestCreatedAt + 1));
    latestCreatedAt = Math.max(latestCreatedAt, createdAt);
    const record = {
        id,
        user_id: String(userId),
        chat_id: String(chatId),
        client_request_id: String(clientRequestId),
        body: String(body).trim().slice(0, 2000),
        reply_to_message_id: replyToMessageId ? String(replyToMessageId) : null,
        created_at: createdAt,
        attempts: Number(previous?.attempts || 0),
        next_attempt_at: Number(previous?.next_attempt_at || 0),
    };
    await withStore("readwrite", (store) => requestResult(store.put(record)));
    await prune(now);
    return record;
}

export async function listChatTextOutbox(userId) {
    if (!userId) return [];
    await prune();
    const records = await allRecords();
    return records
        .filter((record) => record.user_id === String(userId))
        .sort((left, right) => Number(left.created_at) - Number(right.created_at));
}

export async function removeChatTextOutbox(userId, clientRequestId) {
    if (!userId || !clientRequestId) return;
    await withStore("readwrite", (store) => requestResult(store.delete(recordId(userId, clientRequestId))));
}

export async function markChatTextOutboxAttempt(userId, clientRequestId, now = Date.now()) {
    const id = recordId(userId, clientRequestId);
    const record = await withStore("readonly", (store) => requestResult(store.get(id)));
    if (!record) return null;
    const attempts = Number(record.attempts || 0) + 1;
    const delay = Math.min(5 * 60_000, 1_000 * (2 ** Math.min(attempts, 8)));
    const updated = { ...record, attempts, next_attempt_at: now + delay };
    await withStore("readwrite", (store) => requestResult(store.put(updated)));
    return updated;
}

export async function clearChatTextOutbox(userId) {
    if (!userId) return;
    const records = await allRecords();
    const ids = records.filter((record) => record.user_id === String(userId)).map((record) => record.id);
    if (ids.length) await withStore("readwrite", (store) => Promise.all(ids.map((id) => requestResult(store.delete(id)))));
}

export async function putChatMediaOutbox(record) {
    if (!record?.id || !record?.user_id || !record?.file || !record?.kind) return null;
    const previous = await withNamedStore(MEDIA_STORE_NAME, "readonly", (store) => requestResult(store.get(record.id))).catch(() => null);
    const now = Date.now();
    const createdAt = Number(previous?.created_at || record.created_at || Math.max(now, latestMediaCreatedAt + 1));
    latestMediaCreatedAt = Math.max(latestMediaCreatedAt, createdAt);
    const saved = {
        ...record,
        id: String(record.id),
        user_id: String(record.user_id),
        created_at: createdAt,
        attempts: Number(record.attempts ?? previous?.attempts ?? 0),
        next_attempt_at: Number(record.next_attempt_at ?? previous?.next_attempt_at ?? 0),
    };
    await withNamedStore(MEDIA_STORE_NAME, "readwrite", (store) => requestResult(store.put(saved)));
    await pruneMedia();
    return saved;
}

export async function listChatMediaOutbox(userId) {
    if (!userId) return [];
    await pruneMedia();
    return (await allMediaRecords()).filter((record) => record.user_id === String(userId)).sort((left, right) => Number(left.created_at) - Number(right.created_at));
}

export async function markChatMediaOutboxAttempt(id, now = Date.now()) {
    const record = await withNamedStore(MEDIA_STORE_NAME, "readonly", (store) => requestResult(store.get(String(id))));
    if (!record) return null;
    const attempts = Number(record.attempts || 0) + 1;
    const updated = { ...record, attempts, next_attempt_at: now + Math.min(5 * 60_000, 2_000 * (2 ** Math.min(attempts, 7))) };
    await withNamedStore(MEDIA_STORE_NAME, "readwrite", (store) => requestResult(store.put(updated)));
    return updated;
}

export async function removeChatMediaOutbox(id) {
    if (!id) return;
    await withNamedStore(MEDIA_STORE_NAME, "readwrite", (store) => requestResult(store.delete(String(id))));
}

export async function clearChatMediaOutbox(userId) {
    if (!userId) return;
    const records = await allMediaRecords();
    const ids = records.filter((record) => record.user_id === String(userId)).map((record) => record.id);
    if (ids.length) await withNamedStore(MEDIA_STORE_NAME, "readwrite", (store) => Promise.all(ids.map((id) => requestResult(store.delete(id)))));
}

export async function clearChatOutboxes(userId) {
    await Promise.all([clearChatTextOutbox(userId), clearChatMediaOutbox(userId)]);
}

export function chatTextSendIsRetryable(error) {
    const status = Number(error?.status || 0);
    return !status || status === 408 || status === 425 || status === 429 || status >= 500;
}
