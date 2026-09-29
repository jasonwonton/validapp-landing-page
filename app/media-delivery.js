// Uploads saved outbox records (chat media, Mementos, Stories) and resumes a
// retry from the last step that finished: finalized assets are not uploaded
// again, parts already PUT are skipped, and ingest segments already sent are
// not sent twice. Every step is idempotent on the server by request id.
import { patchChatMediaOutbox } from "./chat/outbox.js";

function saver(record) {
    return async (patch) => {
        Object.assign(record, patch);
        if (record.id) await patchChatMediaOutbox(record.id, patch).catch(() => null);
    };
}

const isPhoto = (record) => record.content_type === "image/jpeg";

// A finalize that fails right after a skipped PUT means the object never
// landed; upload it once more instead of failing the send.
function missingUpload(error) {
    return [400, 409].includes(Number(error?.status));
}

async function uploadSmallChatMedia(api, userId, record, save, { onProgress, signal }) {
    const session = await api.createChatMediaUpload(userId, {
        contentType: record.content_type,
        sizeBytes: record.file.size,
        thumbnailSizeBytes: record.thumbnail?.size ?? null,
        durationMs: record.duration_ms ?? null,
        previewHash: record.thumbnail ? record.preview_hash || null : null,
        viewOnce: record.view_once,
        clientRequestId: record.upload_request_id,
    });
    if (record.media_asset_id !== session.media_asset_id) {
        await save({ media_asset_id: session.media_asset_id, file_uploaded: false, thumbnail_uploaded: false });
    }
    const skipped = Boolean(record.file_uploaded);
    if (!record.file_uploaded) {
        await api.putDirectUpload(record.file, session, { onProgress: (progress) => onProgress?.(progress * 0.88), signal });
        if (!session.already_finalized) await save({ file_uploaded: true });
    }
    if (!session.already_finalized) {
        if (record.thumbnail && !record.thumbnail_uploaded) {
            try {
                await api.putDirectUpload(record.thumbnail, {
                    upload_url: session.thumbnail_upload_url,
                    upload_method: session.upload_method,
                    required_headers: session.thumbnail_required_headers,
                }, { onProgress: (progress) => onProgress?.(0.88 + progress * 0.1), signal });
                await save({ thumbnail_uploaded: true });
            } catch (error) {
                // A photo preview is best effort (the full photo is the fallback);
                // a video poster is required.
                if (!isPhoto(record) || error?.cancelled) throw error;
            }
        }
    }
    try {
        await api.finalizeChatMediaUpload(userId, session.media_asset_id);
    } catch (error) {
        if (!skipped || !missingUpload(error)) throw error;
        await save({ file_uploaded: false, thumbnail_uploaded: false });
        return uploadSmallChatMedia(api, userId, record, save, { onProgress, signal });
    }
    await save({ finalized_asset_id: session.media_asset_id });
    return session.media_asset_id;
}

// Uploads an ingest (or resumes one) and waits until its segments are ready.
async function readyIngest(api, userId, record, save, { purpose, onProgress, onStatus, signal }) {
    const ingest = await import("./media-ingest.js");
    let status = null;
    if (!record.ingest_id || !record.ingest_finalized) {
        onStatus?.("Uploading video…");
        const session = await ingest.createIngest(api, userId, {
            purpose,
            contentType: record.content_type,
            sizeBytes: record.file.size,
            durationMs: record.duration_ms,
            viewOnce: record.view_once,
            clientRequestId: record.upload_request_id,
        });
        await save({ ingest_id: session.ingest_id });
        status = await ingest.uploadIngest(api, userId, session, record.file, { onProgress: (progress) => onProgress?.(progress * 0.7), signal });
        await save({ ingest_finalized: true });
    }
    onStatus?.("Processing video…");
    onProgress?.(0.75);
    try {
        return await ingest.waitForIngest(api, userId, record.ingest_id, { signal, initial: status?.state ? status : null });
    } catch (error) {
        // processing_failed may succeed as a new ingest; every other failure is final.
        if (error?.retryWithNewRequest) await save({ upload_request_id: crypto.randomUUID(), ingest_id: null, ingest_finalized: false });
        throw error;
    }
}

function segmentRequestIds(record, count, first) {
    const saved = record.segment_request_ids;
    if (Array.isArray(saved) && saved.length === count) return saved;
    return Array.from({ length: count }, (_, index) => index === 0 && first ? first : crypto.randomUUID());
}

// Resolves to the sent message (small path) or every segment's message.
export async function deliverChatMedia(api, userId, record, { onProgress, onStatus, signal } = {}) {
    const save = saver(record);
    if (!record.ingest) {
        const mediaAssetId = record.finalized_asset_id || await uploadSmallChatMedia(api, userId, record, save, { onProgress, signal });
        return api.sendChatMessage(userId, record.chat_id, {
            media_asset_id: mediaAssetId,
            view_once: record.view_once,
            media_text_overlay: record.overlay,
            reply_to_message_id: record.reply_to_message_id,
            client_request_id: record.send_request_id,
        });
    }
    const status = await readyIngest(api, userId, record, save, { purpose: "chat", onProgress, onStatus, signal });
    const segments = status.segments;
    const requestIds = segmentRequestIds(record, segments.length, record.send_request_id);
    if (requestIds !== record.segment_request_ids) await save({ segment_request_ids: requestIds });
    onStatus?.(segments.length > 1 ? `Sending ${segments.length} videos…` : "Sending video…");
    const messages = [];
    for (let index = Number(record.sent_segments || 0); index < segments.length; index++) {
        const payload = {
            media_asset_id: segments[index].media_asset_id,
            view_once: record.view_once,
            client_request_id: requestIds[index],
        };
        // Like iOS, the caption and reply ride on the first clip only.
        if (index === 0) Object.assign(payload, { media_text_overlay: record.overlay, reply_to_message_id: record.reply_to_message_id });
        messages.push(await api.sendChatMessage(userId, record.chat_id, payload));
        await save({ sent_segments: index + 1 });
        onProgress?.(0.8 + 0.2 * (index + 1) / segments.length);
    }
    return messages;
}

export async function deliverMemento(api, userId, record, { onProgress, signal } = {}) {
    const save = saver(record);
    const session = await api.createDailyHighlightUpload(userId, record.file.size, record.request_id, record.secondary?.size ?? null);
    if (record.media_asset_id !== session.media_asset_id) {
        await save({ media_asset_id: session.media_asset_id, primary_uploaded: false, secondary_uploaded: false });
    }
    const part = (url, relay) => ({
        upload_url: url,
        upload_method: session.upload_method,
        required_headers: session.required_headers,
        already_finalized: Boolean(session.already_finalized),
        ...(relay ? { proxy_upload_url: relay } : {}),
    });
    const skipped = Boolean(record.primary_uploaded || record.secondary_uploaded);
    if (!record.primary_uploaded) {
        await api.putDirectUpload(record.file, part(session.upload_url, session.proxy_upload_url), { onProgress: (progress) => onProgress?.(record.secondary ? progress * 0.48 : progress * 0.96), signal });
        if (!session.already_finalized) await save({ primary_uploaded: true });
    }
    if (record.secondary && !session.already_finalized && !record.secondary_uploaded) {
        if (!session.secondary_upload_url) throw new Error("The second Memento upload session was invalid.");
        await api.putDirectUpload(record.secondary, part(session.secondary_upload_url, session.proxy_secondary_upload_url), { onProgress: (progress) => onProgress?.(0.48 + progress * 0.48), signal });
        await save({ secondary_uploaded: true });
    }
    try {
        await api.finalizeDailyHighlightUpload(userId, session.media_asset_id);
    } catch (error) {
        if (!skipped || !missingUpload(error)) throw error;
        await save({ primary_uploaded: false, secondary_uploaded: false });
        return deliverMemento(api, userId, record, { onProgress, signal });
    }
    onProgress?.(1);
    return api.publishDailyHighlight(userId, session.media_asset_id, record.chat_ids, record.caption, record.request_id);
}

export async function deliverStory(api, userId, record, { onProgress, onStatus, signal } = {}) {
    const save = saver(record);
    if (!record.ingest) {
        let mediaAssetId = record.finalized_asset_id;
        if (!mediaAssetId) {
            const session = await api.createStoryUpload(userId, {
                contentType: record.content_type,
                sizeBytes: record.file.size,
                thumbnailSizeBytes: record.thumbnail?.size ?? null,
                durationMs: record.duration_ms,
                clientRequestId: record.upload_request_id,
            });
            if (record.media_asset_id !== session.media_asset_id) await save({ media_asset_id: session.media_asset_id, file_uploaded: false, thumbnail_uploaded: false });
            if (!record.file_uploaded) {
                await api.putDirectUpload(record.file, session, { onProgress: (progress) => onProgress?.(progress * 0.88), signal });
                if (!session.already_finalized) await save({ file_uploaded: true });
            }
            if (record.thumbnail && !session.already_finalized && !record.thumbnail_uploaded) {
                await api.putDirectUpload(record.thumbnail, {
                    upload_url: session.thumbnail_upload_url,
                    upload_method: session.upload_method,
                    required_headers: session.thumbnail_required_headers,
                }, { onProgress: (progress) => onProgress?.(0.88 + progress * 0.1), signal });
                await save({ thumbnail_uploaded: true });
            }
            await api.finalizeStoryUpload(userId, session.media_asset_id);
            mediaAssetId = session.media_asset_id;
            await save({ finalized_asset_id: mediaAssetId });
        }
        return api.publishStory(userId, mediaAssetId, {
            caption: record.caption,
            overlay: record.overlay,
            clientRequestId: record.publish_request_id,
        });
    }
    const status = await readyIngest(api, userId, record, save, { purpose: "story", onProgress, onStatus, signal });
    const segments = status.segments;
    const requestIds = segmentRequestIds(record, segments.length, record.publish_request_id);
    const captureIds = Array.isArray(record.segment_capture_ids) && record.segment_capture_ids.length === segments.length
        ? record.segment_capture_ids
        : segments.map(() => crypto.randomUUID());
    if (requestIds !== record.segment_request_ids || captureIds !== record.segment_capture_ids) await save({ segment_request_ids: requestIds, segment_capture_ids: captureIds });
    const stories = [];
    for (let index = Number(record.sent_segments || 0); index < segments.length; index++) {
        stories.push(await api.publishStory(userId, segments[index].media_asset_id, {
            caption: index === 0 ? record.caption : null,
            overlay: index === 0 ? record.overlay : null,
            clientRequestId: requestIds[index],
            captureId: captureIds[index],
        }));
        await save({ sent_segments: index + 1 });
        onProgress?.(0.8 + 0.2 * (index + 1) / segments.length);
    }
    return stories;
}
