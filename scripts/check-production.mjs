import assert from "node:assert/strict";

async function fetchOK(url, options) {
    const response = await fetch(url, { redirect: "follow", ...options });
    assert.equal(response.status, 200, `${url} returned ${response.status}`);
    return response;
}

const checks = [
    ["app shell and security headers", async () => {
        const app = await fetchOK("https://validapp.lol/app/");
        const appHTML = await app.text();
        assert.match(appHTML, /<title>Valid on the web<\/title>/, "production app shell is missing");
        assert.match(appHTML, /content-security-policy/i, "production app is missing its fallback CSP");
        assert.match(app.headers.get("content-security-policy") || "", /frame-ancestors 'none'/, "response CSP must prevent framing");
        assert.equal(app.headers.get("x-content-type-options"), "nosniff", "nosniff header is missing");
        assert.match(app.headers.get("permissions-policy") || "", /camera=\(\)/, "permissions policy is missing");
    }],
    ["PWA manifest and service worker", async () => {
        const manifest = await fetchOK("https://validapp.lol/app/manifest.webmanifest");
        assert.match(manifest.headers.get("content-type") || "", /json|manifest/, "manifest content type is invalid");
        const manifestPayload = await manifest.json();
        assert.equal(manifestPayload.display, "standalone", "PWA is not configured for standalone display");
        await fetchOK("https://validapp.lol/app/service-worker.js");
    }],
    ["related-origin passkeys", async () => {
        const relatedOrigin = await fetchOK("https://six7.lol/.well-known/webauthn");
        assert.match(relatedOrigin.headers.get("content-type") || "", /json/, "related-origin response must be JSON");
        const payload = await relatedOrigin.json();
        assert.ok(payload.origins?.includes("https://validapp.lol"), "six7.lol must authorize validapp.lol");
    }],
    ["API health and CORS", async () => {
        const config = await fetchOK("https://api.six7.lol/api/v1/config", {
            headers: { Origin: "https://validapp.lol" },
        });
        assert.equal(config.headers.get("access-control-allow-origin"), "https://validapp.lol", "API CORS does not authorize the web app");
        const payload = await config.json();
        assert.ok(Number(payload.question_limit) > 0, "API config payload is invalid");
    }],
];

const results = await Promise.allSettled(checks.map(([, check]) => check()));
const failures = [];
results.forEach((result, index) => {
    const name = checks[index][0];
    if (result.status === "fulfilled") console.log(`✓ ${name}`);
    else {
        failures.push(`${name}: ${result.reason?.message || result.reason}`);
        console.error(`✗ ${name}`);
    }
});

if (failures.length) {
    throw new Error(`Production preflight failed:\n- ${failures.join("\n- ")}`);
}
console.log("Production preflight passed.");
