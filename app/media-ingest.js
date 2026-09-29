// Browser media ingest client (docs/web-media-contract.md, "Ingest sequence").
// For anything the small upload path cannot take: MediaRecorder output, long or
// large clips, non-fast-start MP4/MOV, Opus voice. The server transcodes and
// splits it into iOS-compatible segments that are then sent like any media.

const POLL_TIMEOUT_MS = 5 * 60_000;

export function ingestBaseType(type) {
    const base = String(type || "").split(";")[0].trim().toLowerCase();
    return base === "audio/x-m4a" || base === "audio/aac" ? "audio/mp4" : base;
}

export class IngestFailedError extends Error {
    constructor(status) {
        super(status?.failure_message || "That media could not be processed.");
        this.name = "IngestFailedError";
        this.code = status?.failure_code || "processing_failed";
        // Only a processing failure is worth a fresh attempt (new client_request_id).
        this.status = this.code === "processing_failed" ? 0 : 422;
        this.retryWithNewRequest = this.code === "processing_failed";
        this.ingest = status || null;
    }
}

// 1. Create (idempotent per client_request_id; repeat it to resume).
export function createIngest(api, userId, { purpose = "chat", contentType, sizeBytes, durationMs = null, viewOnce = false, clientRequestId }) {
    const body = {
        purpose,
        content_type: contentType,
        size_bytes: sizeBytes,
        view_once: purpose === "chat" && Boolean(viewOnce),
        client_request_id: clientRequestId,
    };
    if (Number.isFinite(Number(durationMs)) && Number(durationMs) > 0) body.duration_ms = Math.round(Number(durationMs));
    return api.request(`/users/${userId}/media-ingests`, { method: "POST", body: JSON.stringify(body) });
}

// 2 + 3. PUT the original with exactly `required_headers`, then finalize.
// A finalize that races the PUT (409 media_ingest_upload_missing) is retried.
export async function uploadIngest(api, userId, session, blob, { onProgress, signal } = {}) {
    if (!session?.ingest_id) throw new Error("The upload session was invalid.");
    if (!session.already_uploaded && session.state === "upload_pending") {
        if (!session.upload_url) throw new Error("The upload session was invalid.");
        await api.putDirectUpload(blob, {
            upload_url: session.upload_url,
            upload_method: session.upload_method || "PUT",
            required_headers: session.required_headers || {},
        }, { onProgress, signal });
    }
    if (session.state !== "upload_pending" && session.already_uploaded) return session;
    for (let attempt = 0; ; attempt++) {
        try {
            return await api.request(`/users/${userId}/media-ingests/${session.ingest_id}/finalize`, { method: "POST", signal, timeoutMs: 30_000 });
        } catch (error) {
            if (error?.detail?.code !== "media_ingest_upload_missing" || attempt >= 3) throw error;
            await delay(1000 * (attempt + 1), signal);
        }
    }
}

export function getIngest(api, userId, ingestId, { signal } = {}) {
    return api.request(`/users/${userId}/media-ingests/${ingestId}`, { signal });
}

// 4. Poll every `poll_after_ms` until ready (returns the status with segments)
// or failed (throws IngestFailedError). Stops after about five minutes.
export async function waitForIngest(api, userId, ingestId, { signal, onState, initial = null, timeoutMs = POLL_TIMEOUT_MS } = {}) {
    const started = Date.now();
    let status = initial;
    while (true) {
        if (status) {
            onState?.(status);
            if (status.state === "ready") {
                if (!Array.isArray(status.segments) || !status.segments.length) throw new IngestFailedError({ failure_code: "processing_failed", failure_message: "That media could not be processed." });
                return status;
            }
            if (status.state === "failed") throw new IngestFailedError(status);
        }
        if (Date.now() - started > timeoutMs) {
            const error = new Error("This is taking longer than usual. Try again in a minute.");
            error.status = 0;
            throw error;
        }
        if (status) await delay(Math.min(10_000, Math.max(500, Number(status.poll_after_ms) || 2000)), signal);
        status = await getIngest(api, userId, ingestId, { signal });
    }
}

function delay(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason || new DOMException("Aborted", "AbortError"));
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason || new DOMException("Aborted", "AbortError")); }, { once: true });
    });
}
