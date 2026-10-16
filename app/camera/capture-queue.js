// Hands a reviewed capture to the durable outbox and returns at once
// (CameraFirstFlowView.queue): the camera closes, chat sends upload in the
// background, and the Story rail shows "Posting…" or "Tap to retry"
// (StoryPostQueue). Every step is idempotent by request id, so a retry after
// a reload never posts twice.
import {
    MAX_MEDIA_AUTOMATIC_ATTEMPTS,
    chatTextSendIsRetryable,
    deliveringMediaRecords,
    listChatMediaOutbox,
    markChatMediaOutboxAttempt,
    patchChatMediaOutbox,
    putChatMediaOutbox,
    removeChatMediaOutbox,
} from "../chat/outbox.js";
import { userMessage } from "../user-message.js";

export const STORY_QUEUE_EVENT = "valid:story-queue";
export const CAPTURE_SENT_EVENT = "valid:capture-sent";

let storyRetryTimer = null;
let chatRetryTimer = null;

const announceStories = () => dispatchEvent(new CustomEvent(STORY_QUEUE_EVENT));

function storyRecord(userId, media, tags) {
    const uploadRequestId = crypto.randomUUID();
    return {
        id: `${userId}:story:${uploadRequestId}`,
        user_id: String(userId),
        kind: "story",
        file: media.file,
        // A photo Story has no poster (the chat preview is for chats only).
        thumbnail: media.kind === "video" ? media.thumbnail || null : null,
        content_type: media.ingest ? (media.contentType || media.file.type) : media.file.type,
        ingest: Boolean(media.ingest),
        duration_ms: media.durationMs ?? null,
        caption: null,
        overlay: media.overlay || null,
        tagged_user_ids: tags?.length ? [...tags] : null,
        upload_request_id: uploadRequestId,
        publish_request_id: crypto.randomUUID(),
    };
}

function chatRecord(userId, media, chatId, viewOnce) {
    const uploadRequestId = crypto.randomUUID();
    return {
        id: `${userId}:chat-media:${uploadRequestId}`,
        user_id: String(userId),
        kind: "chat_media",
        // Send To's chat sends retry here; the chat room retries its own.
        source: "send_to",
        file: media.file,
        thumbnail: media.thumbnail || null,
        preview_hash: media.previewHash || null,
        chat_id: String(chatId),
        content_type: media.ingest ? (media.contentType || media.file.type) : media.file.type,
        ingest: Boolean(media.ingest),
        duration_ms: media.durationMs ?? null,
        view_once: Boolean(viewOnce),
        overlay: media.overlay || null,
        reply_to_message_id: null,
        upload_request_id: uploadRequestId,
        send_request_id: crypto.randomUUID(),
    };
}

// "This wasn't sent to your Story or 2 chats." (CaptureFlowModel.failureMessage)
export function queueFailureMessage({ story = false, chats = 0 } = {}) {
    const parts = [];
    if (story) parts.push("your Story");
    if (chats) parts.push(chats === 1 ? "1 chat" : `${chats} chats`);
    return parts.length ? `This wasn't sent to ${parts.join(" or ")}.` : "Please try again.";
}

/**
 * Saves every send before it starts, then delivers them without waiting.
 * @returns {Promise<{ story: boolean, chats: number }>} what could not be saved (nothing on success).
 */
export async function queueCapture({ api, userId, media, story = false, tags = [], chatIds = [], viewOnce = true, showToast = null }) {
    const records = [];
    const failed = { story: false, chats: 0 };
    if (story) {
        const record = storyRecord(userId, media, tags);
        try { await putChatMediaOutbox(record); records.push(record); } catch (_) { failed.story = true; }
    }
    for (const chatId of chatIds) {
        const record = chatRecord(userId, media, chatId, viewOnce);
        try { await putChatMediaOutbox(record); records.push(record); } catch (_) { failed.chats += 1; }
    }
    if (records.some((record) => record.kind === "story")) announceStories();
    for (const record of records) void deliver(api, record, { showToast });
    return failed;
}

async function deliverRecord(api, record) {
    const delivery = await import("../media-delivery.js");
    if (record.kind === "story") return delivery.deliverStory(api, record.user_id, record);
    return delivery.deliverChatMedia(api, record.user_id, record);
}

async function deliver(api, record, { showToast = null } = {}) {
    if (deliveringMediaRecords.has(record.id)) return;
    deliveringMediaRecords.add(record.id);
    if (record.kind === "story") announceStories();
    try {
        await deliverRecord(api, record);
        await removeChatMediaOutbox(record.id);
        dispatchEvent(new CustomEvent(CAPTURE_SENT_EVENT, { detail: { kind: record.kind, chatId: record.chat_id || null } }));
    } catch (error) {
        if (chatTextSendIsRetryable(error)) {
            await markChatMediaOutboxAttempt(record.id).catch(() => null);
        } else if (record.kind === "story") {
            // A Story the server refused waits for "Tap to retry".
            await patchChatMediaOutbox(record.id, { attempts: MAX_MEDIA_AUTOMATIC_ATTEMPTS, refused: true }).catch(() => null);
        } else {
            await removeChatMediaOutbox(record.id).catch(() => null);
            showToast?.(userMessage(error, "Couldn't send"));
        }
    } finally {
        deliveringMediaRecords.delete(record.id);
        if (record.kind === "story") announceStories();
        scheduleRetries(api, record.user_id, { showToast });
    }
}

async function scheduleRetries(api, userId, options) {
    const records = await listChatMediaOutbox(userId).catch(() => []);
    const next = (kind) => records.filter((record) => record.kind === kind && (kind === "story" || record.source === "send_to")
        && !deliveringMediaRecords.has(record.id)
        && Number(record.attempts || 0) < MAX_MEDIA_AUTOMATIC_ATTEMPTS)
        .reduce((earliest, record) => Math.min(earliest, Number(record.next_attempt_at || 0)), Infinity);
    const arm = (timer, at, run) => {
        clearTimeout(timer);
        return Number.isFinite(at) ? setTimeout(run, Math.max(2_000, Math.min(5 * 60_000, at - Date.now()))) : null;
    };
    storyRetryTimer = arm(storyRetryTimer, next("story"), () => void resumeQueue(api, userId, options));
    chatRetryTimer = arm(chatRetryTimer, next("chat_media"), () => void resumeQueue(api, userId, options));
}

// Resumes saved Story posts and chat sends that are due (app start, coming
// back online, a timer). The chat room retries its own sends the same way.
export async function resumeQueue(api, userId, options = {}) {
    if (!userId || navigator.onLine === false) return;
    let records = await listChatMediaOutbox(userId).catch(() => []);
    // web-v118..v120 sent a photo Story's chat preview as a poster and the API
    // refused it; those posts now go through, so try them again once.
    const refusedPhotos = records.filter((record) => record.kind === "story" && record.refused && record.content_type === "image/jpeg" && !record.photo_poster_retried);
    for (const record of refusedPhotos) {
        await patchChatMediaOutbox(record.id, { attempts: 0, next_attempt_at: 0, refused: false, photo_poster_retried: true }).catch(() => null);
    }
    if (refusedPhotos.length) {
        records = await listChatMediaOutbox(userId).catch(() => []);
        announceStories();
    }
    const due = records.filter((record) => (record.kind === "story" || (record.kind === "chat_media" && record.source === "send_to"))
        && !deliveringMediaRecords.has(record.id)
        && Number(record.attempts || 0) < MAX_MEDIA_AUTOMATIC_ATTEMPTS
        && Number(record.next_attempt_at || 0) <= Date.now());
    for (const record of due.slice(0, 3)) await deliver(api, record, options);
    if (!due.length) scheduleRetries(api, userId, options);
}

/**
 * The own Story label on the rail (StoryStrip): "Posting…" while a post is
 * running or waiting for an automatic retry, "Tap to retry" once it gave up.
 * @returns {Promise<"posting" | "failed" | null>}
 */
export async function storyPostStatus(userId) {
    if (!userId) return null;
    const records = (await listChatMediaOutbox(userId).catch(() => [])).filter((record) => record.kind === "story");
    if (records.some((record) => deliveringMediaRecords.has(record.id) || Number(record.attempts || 0) < MAX_MEDIA_AUTOMATIC_ATTEMPTS)) return "posting";
    return records.length ? "failed" : null;
}

// "Your Story didn't post": Try again.
export async function retryFailedStories(api, userId, options = {}) {
    const records = (await listChatMediaOutbox(userId).catch(() => [])).filter((record) => record.kind === "story" && !deliveringMediaRecords.has(record.id));
    for (const record of records) {
        await patchChatMediaOutbox(record.id, { attempts: 0, next_attempt_at: 0, refused: false }).catch(() => null);
        Object.assign(record, { attempts: 0, next_attempt_at: 0 });
    }
    announceStories();
    for (const record of records) void deliver(api, record, options);
}

// "Your Story didn't post": Discard.
export async function discardFailedStories(userId) {
    const records = (await listChatMediaOutbox(userId).catch(() => [])).filter((record) => record.kind === "story" && !deliveringMediaRecords.has(record.id));
    await Promise.all(records.map((record) => removeChatMediaOutbox(record.id).catch(() => null)));
    announceStories();
}
