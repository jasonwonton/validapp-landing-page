// Demo-only media ingest (docs/web-media-contract.md): accepts the upload,
// "processes" for about a second, then returns one ≤15 s segment per 15 s of
// clip. `?ingest=fail` makes processing fail like a corrupt file would.
function assertLocalDemo() {
    if (!["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)) throw new Error("Demo media is local only.");
}

function notFound() {
    return Object.assign(new Error("Media ingest was not found."), { status: 404, detail: { code: "media_ingest_not_found" } });
}

function statusBody(ingest) {
    const ready = ingest.state === "processing" && Date.now() >= ingest.readyAt;
    if (ready && ingest.fail) Object.assign(ingest, { state: "failed", failure_code: "media_unreadable", failure_message: "That video could not be read. Try a different clip." });
    else if (ready) {
        ingest.state = "ready";
        const count = Math.max(1, Math.ceil(Number(ingest.duration_ms || 5000) / 15_000));
        ingest.segments = Array.from({ length: count }, (_, index) => ({ media_asset_id: `${ingest.ingest_id}-segment-${index + 1}`, content_type: ingest.media_kind === "voice" ? "audio/mp4" : "video/mp4", duration_ms: Math.round(Number(ingest.duration_ms || 5000) / count), size_bytes: Math.round(ingest.size_bytes / count) }));
    }
    const { readyAt, fail, ...body } = ingest;
    return structuredClone({ ...body, poll_after_ms: ingest.state === "processing" ? 300 : null });
}

export async function demoMediaRequest(api, path, { method = "GET", body = null } = {}) {
    assertLocalDemo();
    api.demoIngests ||= new Map();
    const match = path.match(/^\/users\/[^/]+\/media-ingests(?:\/([^/]+))?(\/finalize)?$/);
    if (!match) throw Object.assign(new Error("That request is not available in the demo."), { status: 404 });
    const [, ingestId, finalize] = match;
    if (!ingestId && method === "POST") {
        if (api.config?.enable_web_media_ingest !== true) throw Object.assign(new Error("Not found"), { status: 404 });
        const payload = JSON.parse(body || "{}");
        (api.mediaIngestRequests ||= []).push(payload);
        const existing = [...api.demoIngests.values()].find((ingest) => ingest.client_request_id === payload.client_request_id);
        if (existing) return { ...statusBody(existing), upload_url: existing.state === "upload_pending" ? `/app/demo-upload/${existing.ingest_id}` : "", upload_method: "PUT", required_headers: {}, already_uploaded: existing.state !== "upload_pending" };
        const ingest = {
            ingest_id: `ingest-${api.demoIngests.size + 1}-${Date.now()}`,
            client_request_id: payload.client_request_id,
            purpose: payload.purpose,
            media_kind: String(payload.content_type).startsWith("audio/") ? "voice" : "video",
            view_once: Boolean(payload.view_once),
            state: "upload_pending",
            segments: [],
            failure_code: null,
            failure_message: null,
            duration_ms: payload.duration_ms || null,
            size_bytes: payload.size_bytes,
            fail: new URLSearchParams(location.search).get("ingest") === "fail",
        };
        api.demoIngests.set(ingest.ingest_id, ingest);
        return { ...statusBody(ingest), upload_url: `/app/demo-upload/${ingest.ingest_id}`, upload_method: "PUT", required_headers: { "Content-Type": String(payload.content_type).split(";")[0] }, expires_at: new Date(Date.now() + 3_600_000).toISOString(), already_uploaded: false, max_size_bytes: 52_428_800, max_duration_ms: 60_000 };
    }
    const ingest = api.demoIngests.get(ingestId);
    if (!ingest) throw notFound();
    if (finalize && method === "POST") {
        if (ingest.state === "upload_pending") Object.assign(ingest, { state: "processing", readyAt: Date.now() + 900 });
        return statusBody(ingest);
    }
    const status = statusBody(ingest);
    if (status.state === "ready") for (const segment of status.segments) api.chatMediaAssets[segment.media_asset_id] = { kind: ingest.media_kind === "voice" ? "audio" : "video", view_once: ingest.view_once, durationMs: segment.duration_ms };
    return status;
}
