import assert from 'node:assert/strict';
import { request, createServer } from 'node:http';
import { before, after, test } from 'node:test';
import { createStagingOrigin } from '../serve-staging.mjs';

const secret = 'ab'.repeat(32), stage = 'https://staging.validapp.lol';
let server, backend, cookie, calls = [], fail = false, activeStreams = 0, authLogs = [], authReply, nativeCallsEnabled = true;
before(async () => {
    backend = createServer((req, res) => {
        calls.push({ path: req.url, headers: req.headers });
        req.resume();
        if (fail) return req.socket.destroy();
        if (authReply && req.url === '/api/v1/auth/passkey/signup/complete') {
            res.writeHead(authReply.status, { 'content-type': 'application/json', 'x-request-id': 'abcdef123456' });
            res.end(authReply.body); return;
        }
        if (req.url === '/api/v1/events') {
            activeStreams += 1;
            res.once('close', () => activeStreams -= 1);
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            res.write('data: ready\n\n');
            return;
        }
        if (req.url === '/api/v1/upload') {
            req.once('end', () => { res.writeHead(200); res.end('uploaded'); });
            return;
        }
        res.writeHead(200, { 'content-type': 'application/json', 'x-active-classmates-this-week': '12', 'set-cookie': [
            '__Host-valid_web_session=test-session; Secure; HttpOnly; Path=/; SameSite=Lax',
            'unrelated=never-forward', '__Host-valid_web_session=bad; Domain=six7.lol',
        ] });
        res.end(JSON.stringify({ enable_chats: true, enable_chat_daily_ledger: true, enable_calls: nativeCallsEnabled, enable_web_calls: true }));
    });
    await new Promise(r => backend.listen(0, '127.0.0.1', r));
    server = await createStagingOrigin({ secret, logAuth: event => authLogs.push(event), upstreamRequest(options, callback) {
        assert.equal(options.hostname, 'api.six7.lol');
        assert.equal(options.port, 443);
        return request({ ...options, hostname: '127.0.0.1', port: backend.address().port }, callback);
    } });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
});
after(async () => {
    server.closeAllConnections(); backend.closeAllConnections();
    await Promise.all([new Promise(r => server.close(r)), new Promise(r => backend.close(r))]);
});
function send(path, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port: server.address().port, path, method,
            headers: { host: 'staging.validapp.lol', ...(cookie ? { cookie } : {}), ...headers } }, res => {
            let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
        req.on('error', error => reject(new Error(`${method} ${path}: ${error.message}`))); req.end(body);
    });
}
test('private entry is host-bound, signed, HttpOnly, and no-store', async () => {
    assert.equal((await send('/healthz', { headers: { host: 'health.internal' } })).status, 200);
    assert.equal((await send('/app/')).status, 403);
    assert.equal((await send(`/preview/${secret}`, { headers: { host: 'evil.test' } })).status, 421);
    assert.equal((await send('/preview/incorrect')).status, 403);
    const entry = await send(`/preview/${secret}`);
    assert.equal(entry.status, 303); assert.equal(entry.headers['cache-control'], 'no-store');
    assert.equal(entry.headers.location, '/app/?signin=1');
    assert.match(entry.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Lax/);
    cookie = entry.headers['set-cookie'][0].split(';')[0];
    assert.equal((await send('/app/')).status, 200);
    assert.equal((await send('/app/', { headers: { cookie: cookie + 'tampered' } })).status, 403);
});
test('only intended API, cookies and exact origins reach backend', async () => {
    const prior = calls.length;
    for (const path of ['/api/v1/../secret', '/api/v1/%2fsecret', '/api/v2/config']) assert.equal((await send(path)).status, 400);
    assert.equal((await send('/api/v1/message', { method: 'POST' })).status, 403);
    assert.equal((await send('/api/v1/message', { method: 'POST', headers: { origin: 'https://evil.test' } })).status, 403);
    assert.equal((await send('/api/v1/auth/passkey/signup/options', { method: 'POST', headers: { origin: stage } })).status, 403);
    assert.equal((await send('/api/v1/upload', { method: 'POST', headers: { origin: stage, 'content-length': '12582913' } })).status, 413);
    assert.equal(calls.length, prior);
    const response = await send('/api/v1/message?exact=1', { method: 'POST', headers: { origin: stage, cookie: `${cookie}; __Host-valid_web_session=real; unrelated=secret` }, body: '{}' });
    assert.equal(response.status, 200);
    assert.equal(calls.at(-1).path, '/api/v1/message?exact=1');
    assert.equal(calls.at(-1).headers.origin, stage);
    assert.equal(calls.at(-1).headers.cookie, '__Host-valid_web_session=real');
    assert.equal(response.headers['set-cookie'].length, 1);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-active-classmates-this-week'], '12');
});
test('private config admits call smoke testing but not Stories or comments', async () => {
    const response = await send('/api/v1/config');
    const config = JSON.parse(response.body);
    assert.equal(config.enable_web_chats, true); assert.equal(config.enable_web_mementos, true);
    assert.equal(config.enable_calls, true); assert.equal(config.enable_web_calls, true);
    assert.equal(config.enable_web_stories, false); assert.equal(config.enable_web_comments, false);
});

test('the native call gate and independent staging kill switch both disable web calls', async () => {
    nativeCallsEnabled = false;
    try { assert.equal(JSON.parse((await send('/api/v1/config')).body).enable_web_calls, false); }
    finally { nativeCallsEnabled = true; }
    const disabled = await createStagingOrigin({secret, enableCalls:false, upstreamRequest(options, callback) {
        return request({...options,hostname:'127.0.0.1',port:backend.address().port},callback);
    }});
    await new Promise(resolve => disabled.listen(0,'127.0.0.1',resolve));
    try {
        const config = await new Promise((resolve,reject) => {
            const req = request({hostname:'127.0.0.1',port:disabled.address().port,path:'/api/v1/config',headers:{host:'staging.validapp.lol',cookie}}, res => {
                let data = ''; res.on('data',chunk => data += chunk); res.on('end',() => resolve(JSON.parse(data)));
            }); req.on('error',reject); req.end();
        });
        assert.equal(config.enable_calls,true); assert.equal(config.enable_web_calls,false);
    } finally { disabled.closeAllConnections(); await new Promise(resolve => disabled.close(resolve)); }
});
test('signup needs a private session and explicit same-origin confirmation; rejection logging is bounded and private', async () => {
    const target = '/api/v1/auth/passkey/signup/complete';
    const headers = { origin: stage };
    assert.equal((await send(target, { method: 'POST', headers })).status, 403);
    assert.equal((await send('/preview/signup-enable', { method: 'POST', headers })).status, 403);
    assert.equal((await send('/preview/signup-enable', { method: 'POST', headers: { origin: 'https://evil.test', 'x-valid-preview-signup': 'confirm-production' } })).status, 403);
    const enabled = await send('/preview/signup-enable', { method: 'POST', headers: { ...headers, 'x-valid-preview-signup': 'confirm-production' } });
    assert.equal(enabled.status, 200);
    assert.match(enabled.headers['set-cookie'][0], /Max-Age=3600; HttpOnly; Secure; SameSite=Strict/);
    const signupCookie = enabled.headers['set-cookie'][0].split(';')[0];
    assert.equal((await send(target, { method: 'POST', headers: { ...headers, cookie: signupCookie } })).status, 403);
    const permitted = { ...headers, cookie: `${cookie}; ${signupCookie}`, 'user-agent': 'Android Chrome private-UA', 'x-client-version': 'web-v83' };
    assert.equal((await send(target, { method: 'POST', headers: { ...permitted, cookie: permitted.cookie + 'tampered' } })).status, 403);
    authReply = { status: 400, body: JSON.stringify({ detail: 'Phone number is not verified.', private: '4155550123 credential-data' }) };
    const response = await send(target, { method: 'POST', headers: permitted, body: '{}' });
    assert.equal(response.status, 400); assert.equal(response.body, authReply.body);
    assert.equal(authLogs.at(-1).code, 'phone_not_verified');
    assert.equal(authLogs.at(-1).device, 'android_chrome');
    assert.equal(authLogs.at(-1).build, 'web-v83');
    assert.equal(authLogs.at(-1).request_id, 'abcdef123456');
    assert.doesNotMatch(JSON.stringify(authLogs), /4155550123|credential-data|private-UA/);
    authReply.body = JSON.stringify({ detail: 'secret ' + 'x'.repeat(9000) });
    assert.equal((await send(target, { method: 'POST', headers: permitted, body: '{}' })).body, authReply.body);
    assert.equal(authLogs.at(-1).code, 'auth_request_rejected');
    assert.equal((await send('/api/v1/auth/passkey/signup/options', { method: 'POST', headers: permitted })).status, 403);
    authReply = null;
});
test('private diagnostics admit preview cookie but strip account credentials before upstream', async () => {
    const response = await send('/api/v1/client-logs', { method: 'POST', headers: { origin: stage,
        cookie: `${cookie}; __Host-valid_web_session=account-secret`, authorization: 'Bearer account-secret' }, body: '{}' });
    assert.equal(response.status, 200);
    assert.equal(calls.at(-1).headers.cookie, undefined);
    assert.equal(calls.at(-1).headers.authorization, undefined);
});
test('SSE streams immediately and client close aborts upstream', async () => {
    await new Promise((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/v1/events', headers: { host: 'staging.validapp.lol', cookie } }, res => {
            assert.equal(res.headers['content-type'], 'text/event-stream');
            res.once('data', chunk => { assert.match(chunk.toString(), /data: ready/); req.destroy(); resolve(); });
        });
        req.on('error', reject); req.end();
    });
    for (let attempt = 0; attempt < 20 && activeStreams; attempt++) await new Promise(r => setTimeout(r, 5));
    assert.equal(activeStreams, 0);
});
test('ambiguous upstream failure never retries a write', async () => {
    fail = true;
    const prior = calls.length;
    assert.equal((await send('/api/v1/message', { method: 'POST', headers: { origin: stage }, body: '{}' })).status, 502);
    assert.equal(calls.length, prior + 1);
    fail = false;
});
test('chunked uploads are bounded even without Content-Length', async () => {
    const response = await send('/api/v1/upload', { method: 'POST', headers: { origin: stage, 'transfer-encoding': 'chunked' }, body: Buffer.alloc(12_582_913) });
    assert.equal(response.status, 413);
});
test('SSE concurrency cap is finite and slots recover after disconnect', async () => {
    const requests = [];
    try {
        await Promise.all(Array.from({ length: 64 }, () => new Promise((resolve, reject) => {
            const req = request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/v1/events', headers: { host: 'staging.validapp.lol', cookie } }, res => {
                assert.equal(res.statusCode, 200);
                res.once('data', resolve);
            });
            requests.push(req); req.on('error', reject); req.end();
        })));
        assert.equal(activeStreams, 64);
        assert.equal((await send('/api/v1/config')).status, 503);
    } finally { for (const req of requests) req.destroy(); }
    for (let attempt = 0; attempt < 30 && activeStreams; attempt++) await new Promise(r => setTimeout(r, 5));
    assert.equal(activeStreams, 0);
    assert.equal((await send('/api/v1/config')).status, 200);
});
