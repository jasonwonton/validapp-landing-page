// Read-only release gate: OPTIONS only, no credentials, object reads or writes.
import assert from 'node:assert/strict';

const origin = 'https://staging.validapp.lol';
const endpoint = 'https://9472d27fa2e1a3762bd91728bb7d9437.r2.cloudflarestorage.com/six7-private-media/browser-upload-preflight';
const response = await fetch(endpoint, {
    method: 'OPTIONS', redirect: 'error', signal: AbortSignal.timeout(10_000),
    headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type,cache-control' },
});
const result = {
    status: response.status,
    origin: response.headers.get('access-control-allow-origin'),
    methods: response.headers.get('access-control-allow-methods'),
    headers: response.headers.get('access-control-allow-headers'),
};
console.log(JSON.stringify(result));
await response.body?.cancel();
assert.ok(response.ok, 'Staging browser upload preflight rejected; uploads are not release-ready');
assert.ok([origin, '*'].includes(result.origin), 'Staging origin not allowed');
assert.ok(result.methods?.toUpperCase().split(/,\s*/).includes('PUT'), 'PUT not allowed');
const allowed = result.headers?.toLowerCase().split(/,\s*/) || [];
assert.ok(allowed.includes('*') || ['content-type', 'cache-control'].every(header => allowed.includes(header)), 'Signed upload headers not allowed');
console.log('PASS: staging upload CORS preflight (signed upload/finalize still needs a real-account smoke test)');
