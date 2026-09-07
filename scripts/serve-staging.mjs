// Private production-account preview. No database credentials or provider SDKs.
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createStaticOrigin } from "./serve-production.mjs";

const COOKIE = "__Host-valid-preview";
const SESSION_COOKIE = "__Host-valid_web_session";
const MAX_BODY = 12_582_912;
const MAX_ACTIVE = 64;
const TTL = 86_400;
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const FORWARDED = new Set(["accept", "content-type", "authorization", "origin", "user-agent", "last-event-id", "x-client-version", "x-client-platform"]);

function equal(a, b) {
    const x = Buffer.from(a || ""), y = Buffer.from(b || "");
    return x.length === y.length && timingSafeEqual(x, y);
}
function signature(secret, value) { return createHmac("sha256", secret).update(value).digest("hex"); }
function cookieValue(request, name) {
    return String(request.headers.cookie || "").split(";").map((v) => v.trim()).find((v) => v.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}
function admitted(request, secret) {
    const [expiry, sig] = cookieValue(request, COOKIE).split(".");
    const now = Math.floor(Date.now() / 1000);
    return /^\d+$/.test(expiry || "") && Number(expiry) > now && Number(expiry) <= now + TTL && equal(sig, signature(secret, expiry));
}
function reply(response, status, detail, headers = {}) {
    response.writeHead(status, {
        "content-type": "application/json", "cache-control": "no-store",
        "connection": "close",
        "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
        ...headers,
    });
    response.end(JSON.stringify({ detail }));
}

export async function createStagingOrigin({
    origin = "https://staging.validapp.lol",
    secret = process.env.PREVIEW_ACCESS_KEY,
    root,
    upstreamRequest = httpsRequest,
} = {}) {
    if (!/^[a-f0-9]{64}$/.test(secret || "")) throw new Error("PREVIEW_ACCESS_KEY must be 32 random hex bytes");
    if (origin !== "https://staging.validapp.lol") throw new Error("Unapproved staging origin");
    const staticServer = await createStaticOrigin({ root });
    const staticHandler = staticServer.listeners("request")[0];
    let active = 0;
    return createServer((request, response) => {
        const rawPath = String(request.url || "/").split("?", 1)[0];
        if (rawPath === "/healthz" && SAFE.has(request.method)) return reply(response, 200, "ready");
        if (request.headers.host !== new URL(origin).hostname) return reply(response, 421, "Use staging.validapp.lol");
        if (rawPath.startsWith("/preview/") && request.method === "GET") {
            if (!equal(rawPath.slice("/preview/".length), secret)) return reply(response, 403, "Invalid preview link");
            const expiry = String(Math.floor(Date.now() / 1000) + TTL);
            return reply(response, 303, "Preview enabled. Actions use your real production account.", {
                location: "/app/?signin=1",
                "set-cookie": `${COOKIE}=${expiry}.${signature(secret, expiry)}; Path=/; Max-Age=${TTL}; HttpOnly; Secure; SameSite=Lax`,
            });
        }
        if (!admitted(request, secret)) return reply(response, 403, "Private preview. Reopen your preview link to continue.");
        if (!rawPath.startsWith("/api/")) return staticHandler(request, response);
        // Reject encoded/ambiguous paths and client-chosen upstreams before forwarding cookies.
        if (!rawPath.startsWith("/api/v1/") || /[%\\\x00-\x20]/.test(rawPath) || rawPath.split("/").some((p) => p === "." || p === "..")) {
            return reply(response, 400, "Invalid API path");
        }
        if (!new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]).has(request.method)) return reply(response, 405, "Method not allowed");
        if ((request.headers.origin && request.headers.origin !== origin) || (!SAFE.has(request.method) && request.headers.origin !== origin)) return reply(response, 403, "Invalid request origin");
        // Existing accounts only. Production account safety rules remain authoritative.
        if (rawPath.startsWith("/api/v1/auth/passkey/signup/")) return reply(response, 403, "Preview is for existing accounts. Sign in with your passkey.");
        if (active >= MAX_ACTIVE) return reply(response, 503, "Preview is busy. Try again shortly.", { "retry-after": "5" });
        if (Number(request.headers["content-length"] || 0) > MAX_BODY) return reply(response, 413, "Request too large");
        const headers = {};
        for (const [name, value] of Object.entries(request.headers)) if (FORWARDED.has(name)) headers[name] = value;
        const session = cookieValue(request, SESSION_COOKIE);
        if (session) headers.cookie = `${SESSION_COOKIE}=${session}`;
        headers["accept-encoding"] = "identity";
        active += 1;
        let settled = false, deadline;
        const finish = () => { if (!settled) { settled = true; active -= 1; clearTimeout(deadline); } };
        let upstream;
        try { upstream = upstreamRequest({ hostname: "api.six7.lol", port: 443, path: request.url, method: request.method, headers }, (incoming) => {
            const output = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
            for (const name of ["content-type", "retry-after", "x-request-id", "www-authenticate", "x-active-classmates-this-week"]) if (incoming.headers[name]) output[name] = incoming.headers[name];
            // Preserve only host-bound application session cookies. Never relay CDN cookies.
            const cookies = (incoming.headers["set-cookie"] || []).filter((v) => v.startsWith(`${SESSION_COOKIE}=`) && !/;\s*domain=/i.test(v));
            if (cookies.length) output["set-cookie"] = cookies;
            const isConfig = rawPath === "/api/v1/config" && request.method === "GET" && incoming.statusCode === 200;
            if (isConfig) {
                let bytes = 0; const chunks = [];
                incoming.on("data", (chunk) => { bytes += chunk.length; if (bytes > 65_536) { upstream.destroy(); if (!response.headersSent) reply(response, 502, "Invalid configuration response"); } else chunks.push(chunk); });
                incoming.on("end", () => {
                    if (response.writableEnded) return;
                    try {
                        const config = JSON.parse(Buffer.concat(chunks).toString());
                        // Presentation-only private cohort gates. Native capability and all
                        // permissions/membership/idempotency checks remain owned by the API.
                        config.enable_web_chats = config.enable_chats === true;
                        config.enable_web_mementos = config.enable_chat_daily_ledger === true;
                        config.enable_web_stories = false;
                        config.enable_web_calls = false;
                        config.enable_web_comments = false;
                        response.writeHead(200, output); response.end(JSON.stringify(config));
                    } catch { reply(response, 502, "Invalid configuration response"); }
                });
            } else {
                response.writeHead(incoming.statusCode || 502, output);
                incoming.pipe(response);
            }
            incoming.on("error", () => response.destroy());
            incoming.on("aborted", () => response.destroy());
        }); } catch { finish(); return reply(response, 400, "Invalid upstream request"); }
        deadline = setTimeout(() => { upstream.destroy(); if (!response.headersSent) reply(response, 504, "Preview request timed out"); else response.destroy(); }, 300_000);
        deadline.unref();
        upstream.setTimeout(60_000, () => upstream.destroy());
        upstream.on("error", () => { if (!response.headersSent) reply(response, 502, "Could not reach Six7. Please retry."); else response.destroy(); finish(); });
        response.on("close", () => { upstream.destroy(); finish(); });
        request.on("aborted", () => { upstream.destroy(); finish(); });
        let bodyBytes = 0;
        request.on("data", (chunk) => {
            bodyBytes += chunk.length;
            if (bodyBytes > MAX_BODY) { request.unpipe(upstream); upstream.destroy(); if (!response.headersSent) reply(response, 413, "Request too large"); }
        });
        request.pipe(upstream);
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const server = await createStagingOrigin();
    server.listen(Number(process.env.PORT || 8080), "0.0.0.0", () => console.log("Private PWA preview ready"));
    const shutdown = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 10_000).unref(); };
    process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
}
