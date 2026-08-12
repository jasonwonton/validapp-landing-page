import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const outputRoot = path.join(repositoryRoot, "dist");
const staticDirectories = [".well-known", "app", "assets"];
const staticFiles = [
    "_headers",
    "about.html",
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

console.log(`Static site packaged in ${path.relative(repositoryRoot, outputRoot)}/`);
