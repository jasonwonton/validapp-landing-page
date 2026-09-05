import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const defaultRoot = path.join(repositoryRoot, "dist");

const CONTENT_TYPES = new Map([
    [".css", "text/css; charset=utf-8"],
    [".html", "text/html; charset=utf-8"],
    [".ico", "image/x-icon"],
    [".jpeg", "image/jpeg"],
    [".jpg", "image/jpeg"],
    [".js", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".mp4", "video/mp4"],
    [".png", "image/png"],
    [".svg", "image/svg+xml"],
    [".webmanifest", "application/manifest+json; charset=utf-8"],
    [".webp", "image/webp"],
    [".woff2", "font/woff2"],
]);

async function readAppHeaders(root) {
    const source = await readFile(path.join(root, "_headers"), "utf8");
    const headers = {};
    let inAppRule = false;
    for (const line of source.split(/\r?\n/)) {
        if (!line.trim()) continue;
        if (!/^\s/.test(line)) {
            inAppRule = line.trim() === "/app/*";
            continue;
        }
        if (!inAppRule) continue;
        const separator = line.indexOf(":");
        if (separator < 1) continue;
        headers[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
    if (!headers["Content-Security-Policy"]?.includes("frame-ancestors 'none'")) {
        throw new Error("dist/_headers must define an /app/* CSP with frame-ancestors 'none'");
    }
    return Object.freeze(headers);
}

function requestPath(rawURL = "/") {
    const rawPath = rawURL.split("?", 1)[0];
    let decoded;
    try {
        decoded = decodeURIComponent(rawPath);
    } catch {
        return null;
    }
    if (decoded.includes("\0") || decoded.split("/").includes("..")) return null;
    return decoded.startsWith("/") ? decoded : `/${decoded}`;
}

async function resolveFile(root, pathname) {
    const candidatePath = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
    const resolved = path.resolve(root, `.${candidatePath}`);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
    try {
        const info = await stat(resolved);
        if (!info.isFile()) return null;
        const physicalPath = await realpath(resolved);
        if (physicalPath !== root && !physicalPath.startsWith(`${root}${path.sep}`)) return null;
        return { path: physicalPath, info };
    } catch (error) {
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
        throw error;
    }
}

function sendText(response, status, body, headers = {}) {
    response.writeHead(status, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "X-Content-Type-Options": "nosniff",
        ...headers,
    });
    response.end(body);
}

export async function createStaticOrigin({ root = defaultRoot } = {}) {
    const absoluteRoot = await realpath(path.resolve(root));
    const appHeaders = await readAppHeaders(absoluteRoot);
    return createServer(async (request, response) => {
        const pathname = requestPath(request.url);
        const securityHeaders = pathname?.startsWith("/app/") ? appHeaders : {};
        if (!pathname) return sendText(response, 400, "Bad request\n", securityHeaders);
        if (!new Set(["GET", "HEAD"]).has(request.method || "GET")) {
            return sendText(response, 405, "Method not allowed\n", { Allow: "GET, HEAD", ...securityHeaders });
        }
        try {
            const file = await resolveFile(absoluteRoot, pathname);
            if (!file) return sendText(response, 404, "Not found\n", securityHeaders);
            const extension = path.extname(file.path).toLowerCase();
            const etag = `\"${file.info.size.toString(16)}-${Math.trunc(file.info.mtimeMs).toString(16)}\"`;
            const headers = {
                "Content-Type": CONTENT_TYPES.get(extension) || "application/octet-stream",
                "Content-Length": file.info.size,
                "Cache-Control": pathname.startsWith("/app/") ? "no-cache" : "public, max-age=300",
                ETag: etag,
                "X-Content-Type-Options": "nosniff",
                ...securityHeaders,
            };
            if (request.headers["if-none-match"] === etag) {
                response.writeHead(304, headers);
                return response.end();
            }
            response.writeHead(200, headers);
            if (request.method === "HEAD") return response.end();
            const stream = createReadStream(file.path);
            stream.on("error", () => response.destroy());
            stream.pipe(response);
        } catch (error) {
            console.error("Static origin request failed", error);
            if (!response.headersSent) sendText(response, 500, "Internal server error\n", securityHeaders);
            else response.destroy();
        }
    });
}

const executedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (executedDirectly) {
    const port = Number(process.env.PORT || 8080);
    const server = await createStaticOrigin();
    server.listen(port, "0.0.0.0", () => console.log(`Valid static origin listening on ${port}`));
    const shutdown = () => server.close(() => process.exit(0));
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
}
