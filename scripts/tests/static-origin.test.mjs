import assert from "node:assert/strict";
import { request } from "node:http";
import { after, before, test } from "node:test";

import { createStaticOrigin } from "../serve-production.mjs";

let server;
let origin;

before(async () => {
    server = await createStaticOrigin();
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
});

function rawRequest(requestPath) {
    return new Promise((resolve, reject) => {
        const target = new URL(origin);
        const outgoing = request({ hostname: target.hostname, port: target.port, path: requestPath }, resolve);
        outgoing.once("error", reject);
        outgoing.end();
    });
}

test("serves the app shell with enforceable security and device policies", async () => {
    const response = await fetch(`${origin}/app/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /^text\/html/);
    const policy = response.headers.get("content-security-policy") || "";
    assert.match(policy, /frame-ancestors 'none'/);
    assert.match(policy, /frame-src https:\/\/challenges\.cloudflare\.com/);
    assert.match(policy, /script-src 'self' https:\/\/challenges\.cloudflare\.com/);
    assert.match(policy, /style-src 'self'/);
    assert.doesNotMatch(policy, /'unsafe-inline'/);
    assert.match(response.headers.get("permissions-policy") || "", /camera=\(self\)/);
    assert.match(response.headers.get("permissions-policy") || "", /microphone=\(self\)/);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.match(await response.text(), /<title>Valid<\/title>/);
});

test("serves manifest and worker with exact types and HEAD semantics", async () => {
    const manifest = await fetch(`${origin}/app/manifest.webmanifest`);
    assert.match(manifest.headers.get("content-type") || "", /^application\/manifest\+json/);
    assert.equal((await manifest.json()).display, "standalone");

    const worker = await fetch(`${origin}/app/service-worker.js`, { method: "HEAD" });
    assert.equal(worker.status, 200);
    assert.match(worker.headers.get("content-type") || "", /^text\/javascript/);
    assert.equal(await worker.text(), "");
});

test("never proxies API requests and rejects traversal or write methods", async () => {
    assert.equal((await fetch(`${origin}/api/v1/config`)).status, 404);
    assert.equal((await rawRequest("/%2e%2e/package.json")).statusCode, 400);
    const post = await fetch(`${origin}/app/`, { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");
});
