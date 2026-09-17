import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSessionRequest } from '../../app/session-recovery.js';
import { ValidAPI } from '../../app/api.js';
import { completePasskeySignInSafely, retryPasskeySetup } from '../../app/auth-reliability.js';
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.location = { origin: 'http://localhost', hostname: 'localhost' };
let expired = 0;
globalThis.window = { location, dispatchEvent: () => expired++ };
globalThis.document = { querySelector: () => null };
const json = (payload, status = 200, headers = {}) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const invalid = () => json({ detail: 'Invalid or expired session token' }, 401, { 'WWW-Authenticate': 'Bearer' });
const loggedIn = () => { const api = new ValidAPI(); api.saveSession({ user: { id: 'original' } }); expired = 0; return api; };

test('safe read retries only the same URL and retains cookies', async () => {
    const calls = [];
    const result = await fetchSessionRequest('https://validapp.lol/api/v1/auth/session', { credentials: 'include' }, { retry: true, fetcher: async (url, options) => {
        calls.push([url, options]); if (calls.length === 1) throw new TypeError('connection lost'); return json({ user: { id: 'u' } });
    } });
    assert.equal(result.payload.user.id, 'u');
    assert.equal(calls.length, 2);
    assert.equal(calls[0][0], calls[1][0]);
    assert.equal(calls[1][1].credentials, 'include');
    assert.equal(calls[1][1].redirect, 'error');
});

test('writes, HTTP errors, offline and cancellation never replay', async () => {
    for (const scenario of ['write', 'http', 'offline', 'abort']) {
        let calls = 0; const controller = new AbortController();
        navigator.onLine = scenario !== 'offline';
        const promise = fetchSessionRequest('https://validapp.lol/api/v1/test', {}, { retry: scenario !== 'write', signal: controller.signal, fetcher: async () => {
            calls++; if (scenario === 'http') return json({}, 503);
            if (scenario === 'abort') controller.abort();
            throw new TypeError('failed');
        } });
        if (scenario === 'http') assert.equal((await promise).response.status, 503);
        else await assert.rejects(promise);
        assert.equal(calls, 1, scenario);
    }
    navigator.onLine = true;
});

test('deadline includes a stalled response body and caps attempts', async () => {
    let calls = 0;
    const start = performance.now();
    await assert.rejects(fetchSessionRequest('https://validapp.lol/api/v1/test', {}, { retry: true, timeoutMs: 40, fetcher: async (url, options) => {
        calls++;
        return { headers: new Headers(), text: () => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) };
    } }));
    assert.equal(calls, 2);
    assert.ok(performance.now() - start < 500);
});

test('generic 401, 403, 404, 5xx and network failures preserve session', async () => {
    for (const status of [0, 401, 403, 404, 503]) {
        const api = loggedIn();
        globalThis.fetch = async () => { if (!status) throw new TypeError('network'); return json({ detail: 'unrelated failure' }, status); };
        await assert.rejects(api.getProfile('original'));
        assert.equal(api.user.id, 'original'); assert.equal(expired, 0);
    }
});

test('anonymous credential rejection never clears an existing session', async () => {
    const api = loggedIn(); globalThis.fetch = async () => invalid();
    await assert.rejects(api.authenticatePasskey({}));
    assert.equal(api.user.id, 'original'); assert.equal(expired, 0);
});

test('protected 401 checks current cookie before logging out', async () => {
    for (const currentValid of [true, false]) {
        const api = loggedIn(); const urls = [];
        globalThis.fetch = async url => { urls.push(url); return url.endsWith('/auth/session') && currentValid ? json({ user: { id: 'original' } }) : invalid(); };
        await assert.rejects(api.getProfile('original'));
        assert.equal(urls.length, 2); assert.equal(api.hasSession(), currentValid); assert.equal(expired, currentValid ? 0 : 1);
    }
});

test('failed confirmation retains session', async () => {
    const api = loggedIn();
    globalThis.fetch = async url => { if (url.endsWith('/auth/session')) throw new TypeError('network'); return invalid(); };
    await assert.rejects(api.getProfile('original'));
    assert.equal(api.user.id, 'original'); assert.equal(expired, 0);
});

test('a late 401 cannot clear a newer sign-in', async () => {
    const api = loggedIn(); let resolve;
    globalThis.fetch = () => new Promise(r => { resolve = r; });
    const pending = api.getProfile('original');
    api.saveSession({ user: { id: 'new' } }); resolve(invalid());
    await assert.rejects(pending);
    assert.equal(api.user.id, 'new'); assert.equal(expired, 0);
});

test('a late session confirmation cannot clear a newer sign-in', async () => {
    const api = loggedIn(); let resolve, started;
    const confirming = new Promise(r => { started = r; });
    globalThis.fetch = async url => {
        if (!url.endsWith('/auth/session')) return invalid();
        return new Promise(r => { resolve = r; started(); });
    };
    const pending = api.getProfile('original'); await confirming;
    api.saveSession({ user: { id: 'new' } }); resolve(invalid()); await assert.rejects(pending);
    assert.equal(api.user.id, 'new'); assert.equal(expired, 0);
});

test('truncated successful JSON retries reads but never repeats credential writes', async () => {
    const api = loggedIn(); let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('{', { headers: { 'Content-Type': 'application/json' } }); };
    await assert.rejects(api.getProfile('original')); assert.equal(calls, 2);
    calls = 0; await assert.rejects(api.authenticatePasskey({})); assert.equal(calls, 1);
    assert.equal(api.user.id, 'original');
});

test('lost sign-in response restores only the matching credential owner', async () => {
    const expected = '12345678-1234-1234-1234-123456789abc';
    for (const id of [expected, 'another-user', null]) {
        let writes = 0, reads = 0;
        const promise = completePasskeySignInSafely({ authenticatePasskey: async () => { writes++; throw { status: 0 }; }, restoreSession: async () => { reads++; return { user: { id } }; } }, {}, expected);
        if (id === expected) assert.equal((await promise).user.id, id);
        else await assert.rejects(promise, { code: 'signin_result_unknown' });
        assert.equal(writes, 1); assert.equal(reads, 1);
    }
});

test('unknown credential owner and HTTP rejection do not recover the wrong cookie', async () => {
    for (const status of [0, 401]) {
        let reads = 0;
        await assert.rejects(completePasskeySignInSafely({ authenticatePasskey: async () => { throw { status }; }, restoreSession: async () => { reads++; } }, {}, null));
        assert.equal(reads, 0);
    }
});

test('supported browser security failure gets exactly one fresh setup attempt', async () => {
    const error = Object.assign(new Error('security'), { code: 'passkey_security', passkeyContext: 'webauthn.related_origin_supported' });
    let calls = 0;
    assert.equal(await retryPasskeySetup(async () => { if (++calls === 1) throw error; return 'success'; }, async () => {}), 'success');
    assert.equal(calls, 2); calls = 0;
    await assert.rejects(retryPasskeySetup(async () => { calls++; throw error; }, async () => {})); assert.equal(calls, 2);
    for (const code of ['passkey_not_completed', 'network_failure']) {
        calls = 0; await assert.rejects(retryPasskeySetup(async () => { calls++; throw { code }; }, async () => {})); assert.equal(calls, 1);
    }
});
