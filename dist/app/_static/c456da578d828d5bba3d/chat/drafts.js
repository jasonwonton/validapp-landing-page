/** @typedef {{ userId: string, chatId: string, text: string, updatedAt: number, roomRequestId?: string, messageRequestId?: string }} DraftRecord */
const KEY = "valid:chat-drafts:v1";
const MAX_AGE = 7 * 86_400_000;
const MAX_PER_USER = 100;
const MAX_TOTAL = 200;
/** @returns {DraftRecord[]} */
function read() {
    try {
        const rows = JSON.parse(localStorage.getItem(KEY) || "[]");
        return Array.isArray(rows) ? rows.filter((row) => typeof row.userId === "string" && typeof row.chatId === "string" && typeof row.text === "string" && row.text.length <= 2000 && Number.isFinite(row.updatedAt) && Date.now() - row.updatedAt < MAX_AGE) : [];
    } catch { return []; }
}
/** @param {DraftRecord[]} rows */
function write(rows) { try { if (rows.length) localStorage.setItem(KEY, JSON.stringify(rows)); else localStorage.removeItem(KEY); } catch { /* Typing works when storage is unavailable. */ } }
/** @param {string} userId @param {string} chatId */
export function loadChatDraftRecord(userId, chatId) { return read().find((row) => row.userId === String(userId) && row.chatId === String(chatId)) || null; }
/** @param {string} userId @param {string} chatId */
export function loadChatDraft(userId, chatId) { return loadChatDraftRecord(userId, chatId)?.text || ""; }
/** @param {string} userId @param {string} chatId @param {string} text @param {{roomRequestId: string, messageRequestId: string}} ids */
export function saveDraftAttempt(userId, chatId, text, { roomRequestId, messageRequestId }) {
    saveChatDraft(userId, chatId, text);
    const rows = read();
    const row = rows.find((item) => item.userId === String(userId) && item.chatId === String(chatId));
    if (row) { row.roomRequestId = roomRequestId; row.messageRequestId = messageRequestId; write(rows); }
}
/** @param {string} userId @param {string} chatId @param {string} text */
export function saveChatDraft(userId, chatId, text) {
    if (!userId || !chatId) return;
    const owner = String(userId), room = String(chatId);
    let rows = read().filter((row) => row.userId !== owner || row.chatId !== room);
    if (text) rows.push({ userId: owner, chatId: room, text: String(text).slice(0, 2000), updatedAt: Date.now() });
    const mine = rows.filter((row) => row.userId === owner).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_PER_USER);
    rows = [...rows.filter((row) => row.userId !== owner), ...mine].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_TOTAL);
    write(rows);
}
/** @param {string} userId */
export function clearChatDrafts(userId) { write(read().filter((row) => row.userId !== String(userId))); }
