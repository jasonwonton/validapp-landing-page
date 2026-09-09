import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { versionStaticAssets } from '../version-static-assets.mjs';

test('release URLs cover the module graph and change with dependencies while old files remain', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'valid-assets-'));
    const app = path.join(root, 'app');
    const html = '<script src="app.js"></script><link href="styles.css"><script src="https://example.com/external.js"></script>';
    const worker = 'const CACHE_PREFIX = "valid-web-";\nconst CACHE_NAME = `${CACHE_PREFIX}v88`;\nconst APP_SHELL = ["./", "./app.js", "./nested/module.js", "./styles.css"];\n';
    try {
        await mkdir(path.join(app, 'nested'), { recursive: true });
        await writeFile(path.join(app, 'index.html'), html);
        await writeFile(path.join(app, 'service-worker.js'), worker);
        await writeFile(path.join(app, 'app.js'), 'export const lazy = () => import("./nested/module.js");');
        await writeFile(path.join(app, 'nested/module.js'), 'export const version = 1;');
        await writeFile(path.join(app, 'styles.css'), 'body { background: url("../assets/logo.png"); }');
        const first = await versionStaticAssets(root);
        assert.match(first.release, /^[a-f0-9]{20}$/);
        assert.match(await readFile(path.join(app, 'index.html'), 'utf8'), new RegExp(first.prefix));
        assert.match(await readFile(path.join(app, 'index.html'), 'utf8'), /https:\/\/example.com\/external.js/);
        assert.match(await readFile(path.join(root, first.assets['/app/styles.css']), 'utf8'), /url\("\/assets\/logo.png"\)/);
        assert.match(await readFile(path.join(app, 'service-worker.js'), 'utf8'), new RegExp(`v88-${first.release}`));
        assert.equal(first.assets['/app/service-worker.js'], undefined);
        await writeFile(path.join(app, 'index.html'), html);
        await writeFile(path.join(app, 'service-worker.js'), worker);
        assert.equal((await versionStaticAssets(root)).release, first.release, 'same input has stable URLs');
        await writeFile(path.join(app, 'index.html'), html);
        await writeFile(path.join(app, 'service-worker.js'), worker);
        await writeFile(path.join(app, 'nested/module.js'), 'export const version = 2;');
        const second = await versionStaticAssets(root);
        assert.notEqual(second.release, first.release);
        assert.match(await readFile(path.join(root, first.assets['/app/nested/module.js']), 'utf8'), /version = 1/);
        assert.match(await readFile(path.join(root, second.assets['/app/nested/module.js']), 'utf8'), /version = 2/);
    } finally { await rm(root, { recursive: true, force: true }); }
});
