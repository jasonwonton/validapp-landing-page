import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function filesBelow(root, prefix = '') {
    const files = [];
    for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
        if (entry.name === '_static') continue;
        const relative = path.posix.join(prefix, entry.name);
        if (entry.isDirectory()) files.push(...await filesBelow(root, relative));
        else if (/\.(js|css)$/.test(relative) && relative !== 'service-worker.js') files.push(relative);
    }
    return files.sort();
}

// Preserve the module graph and lazy imports inside an immutable release directory.
// Old directories remain in dist so an already-open app can load a lazy module
// after a newer release deploys, even when its edge cache is cold.
export async function versionStaticAssets(outputRoot) {
    const appRoot = path.join(outputRoot, 'app');
    const files = await filesBelow(appRoot);
    const sources = new Map();
    for (const file of files) {
        let source = await readFile(path.join(appRoot, file), 'utf8');
        if (file.endsWith('.css')) {
            source = source.replace(/url\((['"]?)([^)'"\s]+)\1\)/g, (match, quote, value) => {
                if (/^(?:[a-z]+:|\/|#)/i.test(value)) return match;
                const absolute = new URL(value, `https://static.invalid/app/${file}`);
                return `url(${quote}${absolute.pathname}${absolute.search}${absolute.hash}${quote})`;
            });
        }
        sources.set(file, source);
    }
    const indexPath = path.join(appRoot, 'index.html');
    const workerPath = path.join(appRoot, 'service-worker.js');
    const index = await readFile(indexPath, 'utf8');
    const worker = await readFile(workerPath, 'utf8');
    const hash = createHash('sha256').update(await readFile(new URL(import.meta.url))).update(index).update(worker);
    for (const [file, source] of sources) hash.update(file).update('\0').update(source).update('\0');
    const release = hash.digest('hex').slice(0, 20);
    const prefix = `/app/_static/${release}/`;
    const assets = Object.fromEntries(files.map(file => [`/app/${file}`, prefix + file]));
    for (const [file, source] of sources) {
        const destination = path.join(appRoot, '_static', release, file);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, source);
    }
    const versionURL = value => {
        const url = new URL(value, 'https://static.invalid/app/');
        if (url.origin !== 'https://static.invalid' || !assets[url.pathname]) return value;
        return assets[url.pathname] + url.search + url.hash;
    };
    await writeFile(indexPath, index.replace(/\b(src|href)="([^"]+)"/g,
        (match, attribute, value) => `${attribute}="${versionURL(value)}"`));
    const shellEnd = worker.indexOf('];');
    if (shellEnd < 0) throw new Error('Service worker APP_SHELL was not found');
    const shell = worker.slice(0, shellEnd).replace(/"([^"\n]+)"/g,
        (match, value) => `"${versionURL(value)}"`);
    const localConfig = assets['/app/local-config.js'];
    const extraShell = localConfig && !shell.includes(localConfig) ? `    "${localConfig}",\n` : '';
    let versionedWorker = shell + extraShell + worker.slice(shellEnd);
    versionedWorker = versionedWorker.replace(/(const CACHE_NAME = `[^`]+)(`;)/,
        `$1-${release}$2`);
    if (versionedWorker === worker) throw new Error('Service worker was not versioned');
    await writeFile(workerPath, versionedWorker);
    const manifest = { release, prefix, assets };
    await writeFile(path.join(appRoot, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return manifest;
}
