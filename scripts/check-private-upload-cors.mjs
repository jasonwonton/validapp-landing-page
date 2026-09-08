// Read-only release gate: OPTIONS only, no credentials, object reads or writes.
import assert from 'node:assert/strict';

const endpoint = 'https://9472d27fa2e1a3762bd91728bb7d9437.r2.cloudflarestorage.com/six7-private-media/browser-upload-preflight';
for (const [origin, method, approved] of [
    ['https://validapp.lol', 'PUT', true],
    ['https://staging.validapp.lol', 'PUT', true],
    ['https://untrusted.invalid', 'PUT', false],
    ['https://validapp.lol', 'DELETE', false],
]) {
    const response = await fetch(endpoint, {
        method: 'OPTIONS', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { Origin: origin, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'content-type,cache-control' },
    });
    const result = {
        requestedOrigin: origin, requestedMethod: method, status: response.status,
        origin: response.headers.get('access-control-allow-origin'),
        methods: response.headers.get('access-control-allow-methods'),
        headers: response.headers.get('access-control-allow-headers'),
    };
    console.log(JSON.stringify(result));
    await response.body?.cancel();
    if (!approved) {
        assert.equal(result.origin, null, 'Unapproved browser access must remain denied');
        assert.ok(response.status >= 400, 'Unapproved preflight unexpectedly succeeded');
        continue;
    }
    assert.ok(response.ok, `${origin} upload preflight rejected`);
    assert.equal(result.origin, origin, 'Upload origin must be exact, never wildcard');
    assert.deepEqual(result.methods?.toUpperCase().split(/,\s*/), ['PUT']);
    assert.deepEqual(result.headers?.toLowerCase().split(/,\s*/).sort(), ['cache-control', 'content-type']);
}
console.log('PASS: production/staging upload CORS and negative-access checks (signed upload/finalize still needs a real-account smoke test)');
