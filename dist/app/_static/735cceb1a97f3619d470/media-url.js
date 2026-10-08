// Public image routes, ported from iOS PublicMediaRoutePolicy
// (Services/Cache/CachedAsyncImage.swift). Some school and home networks block
// *.six7.lol (and occasionally validappcdn.com); the same public R2 object is
// also served by the other CDN host, a Cloudflare worker, and the API's narrow
// /media/<key> route. Only public, unsigned objects under the prefixes the
// backend allows are ever rewritten; everything else keeps its original URL.

export const PUBLIC_MEDIA_HOSTS = Object.freeze(["media.six7.lol", "validappcdn.com"]);
const STAGING_MEDIA_HOST = "staging.validappcdn.com";
const WORKER_FALLBACK_BASE = "https://six7-public-media-fallback.empty-snow-d731.workers.dev/media";
const ALLOWED_PREFIXES = ["questions/images/", "question-images/", "profile-pictures/", "logos/"];
const MAX_KEY_LENGTH = 512;
// Signed/private URLs carry their authority in the query string. Never move them.
const SIGNED_QUERY = /(^|&)(x-amz-|x-goog-|signature|sig|expires|token|policy|key-pair-id)/i;
const PLACEHOLDER_SRC = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

let configuredApiBase = null;

export function configureMediaFallback({ apiBase } = {}) {
    configuredApiBase = apiBase || null;
}

function defaultApiBase() {
    if (configuredApiBase) return configuredApiBase;
    if (typeof window === "undefined") return null;
    return window.VALID_API_BASE_URL || `${window.location.origin}/api/v1`;
}

function parse(url) {
    try { return new URL(String(url)); } catch (_) { return null; }
}

function objectKey(url) {
    let key;
    try { key = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, ""); } catch (_) { return null; }
    if (!key || key.length > MAX_KEY_LENGTH || key.includes("\\")
        || key.split("/").some((part) => !part || part === "." || part === "..")) return null;
    return ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix)) ? key : null;
}

/** True for an https, unsigned, public-bucket image on a Valid media host. */
export function isEligiblePublicMediaURL(value) {
    const url = parse(value);
    if (!url || url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    if (!PUBLIC_MEDIA_HOSTS.includes(host) && host !== STAGING_MEDIA_HOST) return false;
    if (url.search && SIGNED_QUERY.test(url.search.slice(1))) return false;
    return objectKey(url) !== null;
}

function keyedFallback(url, base) {
    const root = parse(base);
    if (!root) return null;
    const key = objectKey(url);
    if (!key) return null;
    root.pathname = `${root.pathname.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
    root.search = "";
    root.hash = "";
    return root.href;
}

/** The API host's copy of a public object, or null when the URL is not eligible. */
export function apiMediaFallbackURL(value, apiBase = defaultApiBase()) {
    if (!apiBase || !isEligiblePublicMediaURL(value)) return null;
    return keyedFallback(parse(value), `${String(apiBase).replace(/\/+$/, "")}/media`);
}

/**
 * Every route for one image, best first: the original, the other production
 * CDN host, the Cloudflare worker, then the API. Ineligible URLs (private,
 * signed, blob:, data:, other hosts) return just themselves.
 */
export function publicMediaCandidates(value, { apiBase = defaultApiBase() } = {}) {
    if (!value) return [];
    const original = String(value);
    if (!isEligiblePublicMediaURL(original)) return [original];
    const url = parse(original);
    const host = url.hostname.toLowerCase();
    const candidates = [url.href];
    if (PUBLIC_MEDIA_HOSTS.includes(host)) {
        for (const fallbackHost of PUBLIC_MEDIA_HOSTS) {
            if (fallbackHost === host) continue;
            const swapped = new URL(url.href);
            swapped.hostname = fallbackHost;
            candidates.push(swapped.href);
        }
        candidates.push(keyedFallback(url, WORKER_FALLBACK_BASE));
    }
    candidates.push(apiMediaFallbackURL(url.href, apiBase));
    return [...new Set(candidates.filter(Boolean))];
}

/**
 * Candidates for several sources of the same picture (e.g. thumbnail, then
 * original), interleaved by route so a blocked host moves to the next route
 * quickly instead of exhausting one source first.
 */
export function imageCandidates(...sources) {
    const lists = sources.flat().filter(Boolean).map((source) => publicMediaCandidates(source));
    const ordered = [];
    for (let index = 0; lists.some((list) => index < list.length); index += 1) {
        for (const list of lists) if (index < list.length) ordered.push(list[index]);
    }
    return [...new Set(ordered)];
}

function escapeAttribute(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
}

/**
 * Attribute text (`src` plus fallback data) for an `<img>` built as a string.
 * Pass `initials` for avatars: when every route fails the image becomes a
 * `<span>` with those initials. Other images turn into a neutral placeholder.
 */
export function mediaImageAttributes(sources, { initials = null } = {}) {
    const [first, ...rest] = imageCandidates(sources);
    if (!first) return "";
    const fallbacks = rest.length ? ` data-media-fallbacks="${escapeAttribute(rest.join(" "))}"` : "";
    const kind = initials != null
        ? ` data-media-kind="avatar" data-avatar-image data-avatar-initials="${escapeAttribute(initials || "V")}"`
        : ' data-media-kind="image"';
    return `src="${escapeAttribute(first)}"${fallbacks}${kind}`;
}

/**
 * A complete `<img>` string. Returns "" when there is no source so callers can
 * write `mediaImageMarkup(url) || placeholder`.
 */
export function mediaImageMarkup(sources, { alt = "", className = "", initials = null, loading = "lazy", attributes = "" } = {}) {
    const media = mediaImageAttributes(sources, { initials });
    if (!media) return "";
    const classAttribute = className ? ` class="${escapeAttribute(className)}"` : "";
    const loadingAttribute = loading ? ` loading="${escapeAttribute(loading)}"` : "";
    return `<img${classAttribute}${loadingAttribute} decoding="async" ${media} alt="${escapeAttribute(alt)}"${attributes ? ` ${attributes}` : ""}>`;
}

/** Point an existing `<img>` at a public image, with the same fallbacks. */
export function setMediaImageSource(image, sources, { initials = null } = {}) {
    const [first, ...rest] = imageCandidates(sources);
    image.classList.remove("media-placeholder");
    if (rest.length) image.dataset.mediaFallbacks = rest.join(" ");
    else delete image.dataset.mediaFallbacks;
    image.dataset.mediaKind = initials != null ? "avatar" : "image";
    if (initials != null) {
        image.dataset.avatarImage = "";
        image.dataset.avatarInitials = initials || "V";
    }
    if (first) image.src = first;
    else image.removeAttribute("src");
    return image;
}

function handleMediaImageError(event) {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.dataset.mediaKind) return;
    const remaining = (image.dataset.mediaFallbacks || "").split(" ").filter(Boolean);
    const next = remaining.shift();
    if (next) {
        if (remaining.length) image.dataset.mediaFallbacks = remaining.join(" ");
        else delete image.dataset.mediaFallbacks;
        image.src = next;
        return;
    }
    if (image.dataset.mediaKind === "avatar") {
        const fallback = document.createElement("span");
        fallback.className = "media-initials";
        fallback.textContent = image.dataset.avatarInitials || "V";
        image.replaceWith(fallback);
        return;
    }
    if (image.classList.contains("media-placeholder")) return;
    image.classList.add("media-placeholder");
    image.src = PLACEHOLDER_SRC;
}

let installed = false;

/** One capture-phase listener for every tagged image; safe to call repeatedly. */
export function installMediaImageFallback(target = document) {
    if (installed) return;
    installed = true;
    target.addEventListener("error", handleMediaImageError, true);
    // The worker keeps a decoded chat/Story/avatar photo (service-worker.js
    // media cache); it can't tell a photo from an error page on its own.
    target.addEventListener("load", (event) => {
        const src = event.target?.currentSrc || "";
        if (event.target?.tagName === "IMG" && /\/(chat-attachments|chat-daily|stories|profile-pictures)\//.test(src)) {
            navigator.serviceWorker?.controller?.postMessage({ type: "VALID_MEDIA_LOADED", url: src });
        }
    }, true);
}
