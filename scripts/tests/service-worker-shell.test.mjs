import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The installed app starts offline only when every module in its static import
// graph is in the service-worker APP_SHELL: one missing file (for example a chat
// helper imported by chat/index.js) fails the whole module graph.
//
// Policy for dynamic import(): a lazily loaded module either joins APP_SHELL
// (route modules, comments, chat outbox...) or is listed below as deliberately
// network-only. The worker never runtime-caches unlisted responses.
const NETWORK_ONLY_DYNAMIC_IMPORTS = new Map([
    ["demo-api.js", "localhost-only demo fixtures; never used in production"],
    ["weekly-game/index.js", "the weekly game needs the live release, CDN package and camera"],
    ["weekly-game/compat.js", "checked only after the live weekly release was fetched"],
    ["weekly-game/web-game.js", "loaded by the weekly game"],
    ["weekly-game/camera.js", "loaded by the weekly game"],
    ["weekly-game/unavailable.js", "loaded by the weekly game for a release the web can't run"],
    ["weekly-game/demo-release.js", "demo fixture"],
    ["calls/livekit.bundle.js", "built at package time and loaded only when a call starts"],
    ["calls/index.js", "the call controller loads when a call starts or rings; calls need the network"],
    ["vault/index.js", "Memories and Vault read signed media from the API"],
    ["share-cards.js", "share images are drawn only when sharing, which needs the network"],
    ["avatar-crop.js", "the crop step precedes an upload"],
    ["media-delivery.js", "delivers queued media; runs only online"],
    ["stories/photo-filter.js", "optional Story photo looks; offline, the original photo still posts"],
    ["chat/room-tools.js", "reporting and voice playback in an open chat need the network"],
    ["chat/viewer-gestures.js", "the media viewer shows network media"],
    ["stories/viewer.js", "Stories are network media"],
    ["lenses/index.js", "face lenses need the MediaPipe model download"],
]);

const appRoot = fileURLToPath(new URL("../../app/", import.meta.url));
const worker = readFileSync(path.join(appRoot, "service-worker.js"), "utf8");
const shell = new Set([...worker.match(/const APP_SHELL = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)]
    .map(([, entry]) => entry === "./" ? "index.html" : path.posix.normalize(entry.replace(/^\.\//, ""))));

const relative = (from, specifier) => path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
const STATIC_IMPORT = /(?:^|[\s;}])(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

function imports(file, pattern) {
    const source = readFileSync(path.join(appRoot, file), "utf8");
    return [...source.matchAll(pattern)].map(([, specifier]) => specifier)
        .filter((specifier) => specifier.startsWith("."))
        .map((specifier) => relative(file, specifier));
}

function entryPoints() {
    const html = readFileSync(path.join(appRoot, "index.html"), "utf8");
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(([, src]) => src);
    const styles = [...html.matchAll(/<link\b[^>]*rel="(?:stylesheet|manifest)"[^>]*href="([^"]+)"/g)].map(([, href]) => href);
    return [...scripts, ...styles]
        .filter((url) => !/^[a-z]+:/i.test(url) && url !== "local-config.js")
        .map((url) => path.posix.normalize(url));
}

test("index.html loads only precached scripts and styles", () => {
    const missing = entryPoints().filter((file) => !shell.has(file));
    assert.deepEqual(missing, [], `Add these startup files to APP_SHELL: ${missing.join(", ")}`);
});

test("every precached module's static imports are precached too", () => {
    const missing = [];
    const seen = new Set();
    const queue = [...shell].filter((file) => file.endsWith(".js"));
    while (queue.length) {
        const file = queue.shift();
        if (seen.has(file)) continue;
        seen.add(file);
        assert.ok(existsSync(path.join(appRoot, file)), `APP_SHELL lists a missing file: ${file}`);
        for (const dependency of imports(file, STATIC_IMPORT)) {
            if (!shell.has(dependency)) missing.push(`${dependency} (imported by ${file})`);
            queue.push(dependency);
        }
    }
    assert.deepEqual([...new Set(missing)], [], "Statically imported modules missing from APP_SHELL");
});

test("every dynamic import is either precached or deliberately network-only", () => {
    const undecided = [];
    const files = [...shell].filter((file) => file.endsWith(".js"));
    for (const file of files) {
        for (const dependency of imports(file, DYNAMIC_IMPORT)) {
            if (!shell.has(dependency) && !NETWORK_ONLY_DYNAMIC_IMPORTS.has(dependency)) undecided.push(`${dependency} (from ${file})`);
        }
    }
    assert.deepEqual(undecided, [], "Precache these lazy modules or add them to NETWORK_ONLY_DYNAMIC_IMPORTS with a reason");
});

test("the graph walker sees multi-line and side-effect imports", () => {
    const sample = `import {\n  a,\n  b\n} from "./x.js";\nimport "./y.js";\nexport { c } from './z.js';\nconst lazy = () => import("./lazy.js");`;
    assert.deepEqual([...sample.matchAll(STATIC_IMPORT)].map(([, s]) => s), ["./x.js", "./y.js", "./z.js"]);
    assert.deepEqual([...sample.matchAll(DYNAMIC_IMPORT)].map(([, s]) => s), ["./lazy.js"]);
});
