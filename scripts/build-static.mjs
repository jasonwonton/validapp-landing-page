import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

await rm(outputRoot, { recursive: true, force: true });
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

console.log(`Static site packaged in ${path.relative(repositoryRoot, outputRoot)}/`);
