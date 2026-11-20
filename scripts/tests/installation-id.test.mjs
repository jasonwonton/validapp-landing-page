import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';

const KEY = 'valid.web.installation-id';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem: (key) => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
        values,
    };
}

function install({ storage = memoryStorage(), digest = (...args) => webcrypto.subtle.digest(...args), subtle = true } = {}) {
    const calls = { digest: 0 };
    const crypto = {
        randomUUID: () => webcrypto.randomUUID(),
        getRandomValues: (array) => webcrypto.getRandomValues(array),
        subtle: subtle ? { digest: (...args) => { calls.digest++; return digest(...args); } } : undefined,
    };
    Object.defineProperty(globalThis, 'crypto', { value: crypto, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
    return { storage, calls };
}

// Each case gets its own module instance, so the module-level cache starts empty.
let instanceCount = 0;
const freshModule = () => import(`../../app/installation-id.js?case=${++instanceCount}`);

test('the hash is the SHA-256 of the same id sign-up sends, created once and kept', async () => {
    const { storage } = install();
    const module = await freshModule();
    const hash = await module.clientInstanceHash();
    const id = storage.getItem(KEY);
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.equal(module.deviceInstallationId(), id);
    assert.equal(hash, sha256(id));
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.equal(module.CLIENT_INSTANCE_HEADER, 'X-Client-Instance-ID');
});

test('an existing id is reused and hashed once', async () => {
    const { calls } = install({ storage: memoryStorage({ [KEY]: 'existing-installation' }) });
    const module = await freshModule();
    assert.equal(module.readyClientInstanceHash(), undefined);
    assert.equal(await module.clientInstanceHash(), sha256('existing-installation'));
    assert.equal(module.readyClientInstanceHash(), sha256('existing-installation'));
    assert.equal(await module.clientInstanceHash(), sha256('existing-installation'));
    assert.equal(calls.digest, 1);
});

test('a replaced id is hashed again, so the header always matches sign-up', async () => {
    const { storage, calls } = install({ storage: memoryStorage({ [KEY]: 'first' }) });
    const module = await freshModule();
    assert.equal(await module.clientInstanceHash(), sha256('first'));
    storage.removeItem(KEY);
    const replaced = await module.clientInstanceHash();
    assert.equal(replaced, sha256(storage.getItem(KEY)));
    assert.equal(calls.digest, 2);
});

test('blocked storage, missing WebCrypto or a failed digest give no hash and never throw', async () => {
    const throwing = { getItem() { throw new DOMException('denied', 'SecurityError'); }, setItem() { throw new DOMException('denied', 'SecurityError'); } };
    install({ storage: throwing });
    let module = await freshModule();
    assert.equal(module.readyClientInstanceHash(), null);
    assert.equal(await module.clientInstanceHash(), null);

    install({ subtle: false });
    module = await freshModule();
    assert.equal(await module.clientInstanceHash(), null);

    install({ digest: () => Promise.reject(new Error('digest failed')) });
    module = await freshModule();
    assert.equal(await module.clientInstanceHash(), null);
    assert.equal(module.readyClientInstanceHash(), null);
});

test('a stalled first digest is waited on only briefly', async () => {
    install({ digest: () => new Promise(() => {}) });
    const module = await freshModule();
    const start = performance.now();
    assert.equal(await module.clientInstanceHash({ waitMs: 20 }), null);
    assert.ok(performance.now() - start < 500);
    assert.equal(module.readyClientInstanceHash(), undefined);
});

test('every API request carries X-Client-Instance-ID, and goes without it when it cannot be computed', async () => {
    const { storage } = install({ storage: memoryStorage({ [KEY]: 'browser-installation' }) });
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
    globalThis.location = { origin: 'http://localhost', hostname: 'localhost', href: 'http://localhost/app/' };
    globalThis.window = { location, dispatchEvent: () => true };
    globalThis.document = { querySelector: () => null };
    const sent = [];
    globalThis.fetch = async (url, options) => {
        sent.push(new Headers(options.headers));
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    };
    const { ValidAPI } = await import('../../app/api.js');
    const api = new ValidAPI();
    await api.request('/config', { auth: false });
    await api.request('/users/me/profile', { method: 'POST', body: '{}' });
    assert.equal(sent.length, 2);
    for (const headers of sent) assert.equal(headers.get('X-Client-Instance-ID'), sha256(storage.getItem(KEY)));

    Object.defineProperty(globalThis, 'localStorage', { value: { getItem() { throw new Error('blocked'); } }, configurable: true, writable: true });
    const result = await api.request('/config', { auth: false });
    assert.deepEqual(result, { ok: true });
    assert.equal(sent.at(-1).has('X-Client-Instance-ID'), false);
});
