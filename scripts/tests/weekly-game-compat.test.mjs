import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { webPlayable } from '../../app/weekly-game/compat.js';
import { WEB_PACKAGE } from '../../app/weekly-game/web-assets.js';

const read = async (path) => JSON.parse(await readFile(new URL(`../../tests/fixtures/${path}`, import.meta.url), 'utf8'));
const sixtySeven = await read('weekly-game/release.json');
const roseFlight = await read('love-flap/release.json');
const id = 'a'.repeat(64);

test('the live 67 Challenge (hand-package-v1, mirrored) and Rose Flight are playable on the web', () => {
    assert.equal(webPlayable(sixtySeven), true);
    assert.equal(roseFlight.bundle.sha256, WEB_PACKAGE.sha256);
    assert.equal(webPlayable(roseFlight), true);
});

test('releases the web player cannot run never show a Feed entry', () => {
    // An unreviewed hand-package-v2 package has no web sandbox host (it opens the app-only state instead).
    assert.equal(webPlayable({ ...sixtySeven, id, camera_mode: 'hand-package-v2', score_validator: 'self-reported-v1', bundle: { sha256: 'b'.repeat(64), byte_size: 1 } }), false);
    // The server's update notice for clients that lack a mode.
    assert.equal(webPlayable({ id, runtime: 'web-v1', renderer_version: 1, game_id: 'update-required', score_validator: 'update-required-v1', bundle: { sha256: 'c'.repeat(64), byte_size: 1 } }), false);
    // Touch games run in the iOS web view only.
    assert.equal(webPlayable({ id, runtime: 'web-v1', renderer_version: 1, game_id: 'tap-rush', score_validator: 'self-reported-v1', bundle: { sha256: 'd'.repeat(64), byte_size: 1 } }), false);
    // A hand-package-v1 game that is not mirrored cannot be downloaded (no CDN CORS).
    assert.equal(webPlayable({ ...sixtySeven, id, bundle: { ...sixtySeven.bundle, sha256: 'e'.repeat(64) } }), false);
    // A different Rose Flight build than the vendored web package.
    assert.equal(webPlayable({ ...roseFlight, bundle: { ...roseFlight.bundle, sha256: 'f'.repeat(64) } }), false);
    assert.equal(webPlayable(null), false);
    assert.equal(webPlayable({ ...sixtySeven, runtime: 'camera-v2' }), false);
});
