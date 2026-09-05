import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../", import.meta.url));
const appRoot = path.join(root, "app");
const read = (file) => readFile(path.join(root, file), "utf8");
const bytes = async (file) => (await stat(path.join(root, file))).size;

const [appJS, indexHTML, serviceWorker, styles, feedRoute, storiesRoute] = await Promise.all([
    read("app/app.js"),
    read("app/index.html"),
    read("app/service-worker.js"),
    read("app/styles.css"),
    read("app/routes/feed.js"),
    read("app/stories/index.js"),
]);

const fontBytes = await bytes("assets/Jua-Latin.woff2");
assert.ok(fontBytes <= 25_000, `Latin WOFF2 exceeds 25 KB (${fontBytes} bytes)`);
assert.ok(!serviceWorker.includes("Jua-Regular.ttf"), "The service-worker shell must not pre-cache the full TTF");
assert.ok(!serviceWorker.includes("assets/app/aura.webp"), "Route artwork must not be in the minimal app shell");
assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)\) return;/, "Authenticated API GETs must remain network-only");
assert.doesNotMatch(serviceWorker, /cache\.put\(/, "The service worker must not runtime-cache unlisted responses or private media");
const appVersion = indexHTML.match(/name="valid-app-version" content="web-v(\d+)"/)?.[1];
const workerVersion = serviceWorker.match(/CACHE_NAME = `\$\{CACHE_PREFIX\}v(\d+)`/)?.[1];
assert.equal(appVersion, workerVersion, "App telemetry and service-worker cache versions must advance together");
assert.match(indexHTML, /name="theme-color" content="#0b2528" media="\(prefers-color-scheme: dark\)"/, "Installed dark mode needs a matching browser chrome color");

const appArtwork = [
    "anonymous", "aura", "crown", "letter_aligned", "lock", "magnifying_glass",
    "message", "pencil-clipboard", "rocket", "scroll", "snapchat-logo",
];
const artworkBytes = (await Promise.all(appArtwork.map((name) => bytes(`assets/app/${name}.webp`))))
    .reduce((total, size) => total + size, 0);
assert.ok(artworkBytes <= 400_000, `Optimized app artwork exceeds 400 KB (${artworkBytes} bytes)`);

for (const match of indexHTML.matchAll(/<img\b[^>]*\bsrc=[^>]+>/g)) {
    const tag = match[0];
    assert.match(tag, /\bdecoding="async"/, `Static image is missing async decoding: ${tag}`);
    assert.match(tag, /\bwidth="\d+"/, `Static image is missing intrinsic width: ${tag}`);
    assert.match(tag, /\bheight="\d+"/, `Static image is missing intrinsic height: ${tag}`);
}
for (const match of `${appJS}\n${feedRoute}\n${storiesRoute}`.matchAll(/<img\b[^>]*>/g)) {
    assert.match(match[0], /\bdecoding="async"/, `Generated image is missing async decoding: ${match[0]}`);
}
assert.doesNotMatch(`${indexHTML}\n${appJS}\n${feedRoute}\n${storiesRoute}\n${serviceWorker}`, /assets\/app\/[^"')]+\.png/, "App artwork must use optimized formats");
assert.match(appJS, /function initializeParkedUI\(\)/, "Inactive dialogs must remain on-demand");
assert.match(feedRoute, /reconcileKeyedElements\(list, sortedRows\)/, "Feed rows must retain keyed DOM identity");
assert.match(feedRoute, /export function createFeedView\(context\)/, "Feed rendering must remain in its route chunk");
assert.doesNotMatch(appJS, /function pendingTbhRows\(/, "Feed row construction must not return to the main module");
assert.doesNotMatch(appJS, /list\.innerHTML = rows\s*\n?\s*\.sort/, "The feed must not rebuild every row with innerHTML");
assert.match(styles, /#feedList > \[data-list-key\] \{ content-visibility: auto;/, "Offscreen feed rows must skip rendering work");
assert.match(appJS, /activateRoute\(panel, context\)/, "Panel activation must use route modules");
assert.match(appJS, /feedItemsStore\.apply\(event\);/, "Feed must accept batched realtime events");
assert.match(appJS, /feedRealtimeRenderFrame = requestAnimationFrame/, "Realtime feed rendering must batch to one frame");

const shellSource = serviceWorker.match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[1] || "";
const shellEntries = [...shellSource.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
assert.ok(shellEntries.length > 0, "Could not read the service-worker app shell");

let shellTransferEstimate = 0;
for (const entry of shellEntries) {
    const relative = entry === "./"
        ? "app/index.html"
        : path.relative(root, path.resolve(appRoot, entry));
    const body = await readFile(path.join(root, relative));
    shellTransferEstimate += /\.(?:html|css|js|json|webmanifest|svg)$/.test(relative)
        ? gzipSync(body, { level: 9 }).length
        : body.length;
}
assert.ok(shellTransferEstimate <= 750_000, `Estimated app-shell transfer exceeds 750 KB (${shellTransferEstimate} bytes)`);

console.log(JSON.stringify({
    fontBytes,
    artworkBytes,
    shellEntries: shellEntries.length,
    shellTransferEstimate,
}, null, 2));
