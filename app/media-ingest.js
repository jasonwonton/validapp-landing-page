// Client for the server media ingest (`/config.enable_web_media_ingest`), per
// the backend's docs/web-media-contract.md: create → PUT the original to R2 →
// finalize → poll until `ready`, then send each segment. Loaded on demand.

const DEFAULT_POLL_MS = 2000;
const MAX_WAIT_MS = 5 * 60_000;

function baseType(value) {
    return String(value || "").split(";")[0].trim().toLowerCase();
}

export function ingestError(status) {
    const error = new Error(status?.failure_message || "This recording could not be processed. Try again.");
    error.code = status?.failure_code || "media_ingest_failed";
    // Only a processing failure may be retried, and only with a new request id.
    error.status = status?.failure_code === "processing_failed" ? 500 : 422;
    return error;
}

/** `purpose`: "chat" | "story". Repeating a `clientRequestId` returns the same ingest. */
export function createIngest(api, userId, { purpose = "chat", contentType, sizeBytes, durationMs = null, viewOnce = false, clientRequestId }) {
    const payload = {
        purpose,
        content_type: contentType,
        size_bytes: sizeBytes,
        view_once: Boolean(viewOnce),
        client_request_id: clientRequestId,
    };
    if (Number.isFinite(durationMs) && durationMs > 0) payload.duration_ms = Math.round(durationMs);
    if (typeof api.createMediaIngest === "function") return api.createMediaIngest(userId, payload);
    return api.request(`/users/${userId}/media-ingests`, { method: "POST", body: JSON.stringify(payload) });
}

/** PUTs the original (unless already uploaded) and finalizes. Safe to repeat. */
export async function uploadIngest(api, userId, ingest, file, { onProgress } = {}) {
    if (!ingest.already_uploaded && ingest.upload_url) {
        // Content-Type must be the base type from required_headers, never the Blob's `;codecs=`.
        const headers = { ...(ingest.required_headers || {}) };
        if (!headers["Content-Type"]) headers["Content-Type"] = baseType(file.type);
        await api.putDirectUpload(file, {
            upload_url: ingest.upload_url,
            upload_method: ingest.upload_method || "PUT",
            required_headers: headers,
        }, { onProgress });
    }
    onProgress?.(1);
    const path = `/users/${userId}/media-ingests/${ingest.ingest_id}/finalize`;
    return typeof api.finalizeMediaIngest === "function"
        ? api.finalizeMediaIngest(userId, ingest.ingest_id)
        : api.request(path, { method: "POST" });
}

/** Polls until `ready` (returns the status with `segments`) or throws on `failed`/timeout. */
export async function waitForIngest(api, userId, ingestId, { initial = null, signal, sleep, now = () => Date.now(), maxWaitMs = MAX_WAIT_MS } = {}) {
    const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const started = now();
    let status = initial;
    for (;;) {
        if (status?.state === "ready") return status;
        if (status?.state === "failed") throw ingestError(status);
        if (signal?.aborted) throw new DOMException("The upload was cancelled.", "AbortError");
        if (now() - started > maxWaitMs) {
            const error = new Error("This recording is taking too long to process. Try again.");
            error.status = 504;
            throw error;
        }
        if (status) await wait(Math.max(500, Math.min(10_000, Number(status.poll_after_ms) || DEFAULT_POLL_MS)));
        status = typeof api.getMediaIngest === "function"
            ? await api.getMediaIngest(userId, ingestId)
            : await api.request(`/users/${userId}/media-ingests/${ingestId}`);
    }
}
