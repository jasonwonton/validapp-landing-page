import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { versionStaticAssets } from "./version-static-assets.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const outputRoot = path.join(repositoryRoot, "dist");
const staticDirectories = [".well-known", "app", "assets"];
const staticFiles = [
    "_headers",
    "about.html",
    "community-guidelines.html",
    "contact.html",
    "index.html",
    "privacy-policy.html",
    "terms.html",
];

// Keep immutable releases reachable for installed clients and cold edge caches.
for (const entry of await readdir(outputRoot, { withFileTypes: true }).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
})) {
    if (entry.name === "app" && entry.isDirectory()) {
        for (const child of await readdir(path.join(outputRoot, "app"))) {
            if (child !== "_static") await rm(path.join(outputRoot, "app", child), { recursive: true, force: true });
        }
    } else await rm(path.join(outputRoot, entry.name), { recursive: true, force: true });
}
await mkdir(outputRoot, { recursive: true });

for (const directory of staticDirectories) {
    await cp(path.join(repositoryRoot, directory), path.join(outputRoot, directory), {
        recursive: true,
        filter: (source) => path.basename(source) !== "local-config.js",
    });
}

for (const file of staticFiles) {
    await cp(path.join(repositoryRoot, file), path.join(outputRoot, file));
}

// The source checkout can provide a gitignored local override. Production uses
// the same-origin /api/v1 proxy, but index.html still loads this file, so keep
// the packaged app shell complete instead of shipping a guaranteed 404.
await writeFile(
    path.join(outputRoot, "app", "local-config.js"),
    "// Production uses the same-origin /api/v1 proxy.\n",
);

// LiveKit is self-hosted and loaded only after a user starts or accepts a call.
// It is deliberately omitted from the service-worker app shell.
await build({
    entryPoints: [path.join(repositoryRoot, "app", "calls", "livekit-entry.js")],
    outfile: path.join(outputRoot, "app", "calls", "livekit.bundle.js"),
    bundle: true,
    format: "esm",
    target: ["es2020"],
    minify: true,
    legalComments: "none",
});
await rm(path.join(outputRoot, "app", "calls", "livekit-entry.js"), { force: true });

await versionStaticAssets(outputRoot);

console.log(`Static site packaged in ${path.relative(repositoryRoot, outputRoot)}/`);
