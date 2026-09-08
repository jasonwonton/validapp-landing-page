// Read-only live checks. Never print or persist the private invitation/cookie.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const invitation = process.env.STAGING_PREVIEW_URL;
assert(invitation, 'Set STAGING_PREVIEW_URL to the private invitation');
const target = new URL(invitation);
assert.equal(target.origin, 'https://staging.validapp.lol');
assert.match(target.pathname, /^\/preview\/[a-f0-9]{64}$/);
const origin = target.origin;
const anonymous = await fetch(`${origin}/app/`);
assert.equal(anonymous.status, 403);
const entry = await fetch(invitation, { redirect: 'manual' });
assert.equal(entry.status, 303);
assert.equal(entry.headers.get('cache-control'), 'no-store');
const invitationCookie = entry.headers.getSetCookie().find(value => value.startsWith('__Host-valid-preview='));
assert.match(invitationCookie, /HttpOnly; Secure; SameSite=Lax/);
const cookie = invitationCookie.split(';')[0];
const read = path => fetch(`${origin}${path}`, { headers: { cookie }, redirect: 'manual' });
const shell = await read('/app/');
assert.equal(shell.status, 200);
const shellHTML = await shell.text();
const version = shellHTML.match(/name="valid-app-version" content="([^"]+)"/)?.[1];
assert.match(version || '', /^web-v\d+$/);
if (process.env.STAGING_EXPECTED_VERSION) assert.equal(version, process.env.STAGING_EXPECTED_VERSION);
const nativeAssets = JSON.parse(await readFile(new URL('../assets/app/ios-interface-provenance.json', import.meta.url), 'utf8'));
for (const asset of nativeAssets) {
    const response = await read(`/${asset.web}`);
    assert.equal(response.status, 200, asset.web);
    assert.match(response.headers.get('content-type'), /^image\/webp/);
    assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), asset.webSHA256, asset.web);
}
console.log(`PASS: ${version} shell and all three native interface asset hashes`);
for (const file of ['chat/index.js', 'chat/call-history.js', 'chat/styles.css', 'calls/index.js', 'stories/index.js', 'ui-icons.js', 'service-worker.js']) {
    const response = await read(`/app/${file}`);
    assert.equal(response.status, 200, file);
    const local = await readFile(new URL(`../app/${file}`, import.meta.url));
    assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), createHash('sha256').update(local).digest('hex'), `${file} differs from validated source`);
}
assert(shell.headers.get('content-security-policy').includes('https://9472d27fa2e1a3762bd91728bb7d9437.r2.cloudflarestorage.com'));
console.log('PASS: changed photo/call assets match validated source and CSP allows the exact signed-storage origin');
assert.match(shell.headers.get('content-security-policy'), /frame-ancestors 'none'/);
assert.match(shell.headers.get('permissions-policy'), /camera=\(self\)/);
const configResponse = await read('/api/v1/config');
assert.equal(configResponse.status, 200);
assert.equal(configResponse.headers.get('cache-control'), 'no-store');
const config = await configResponse.json();
assert.equal(config.enable_web_chats, config.enable_chats === true);
assert.equal(config.enable_web_mementos, config.enable_chat_daily_ledger === true);
assert.equal(config.enable_web_calls, config.enable_calls === true);
assert.equal(config.enable_web_stories, false);
const challenge = await read('/api/v1/auth/passkey/authenticate/challenge');
assert.equal(challenge.status, 200);
assert.equal((await challenge.json()).rpId, 'six7.lol');
const related = await fetch('https://six7.lol/.well-known/webauthn').then(r => r.json());
assert(related.origins.includes(origin));
assert(related.origins.includes('https://validapp.lol'));
const denied = await fetch(`${origin}/api/v1/auth/passkey/authenticate`, { method: 'POST', headers: { cookie, origin: 'https://untrusted.invalid' }, body: '{}' });
assert.equal(denied.status, 403);
const signupDenied = await fetch(`${origin}/api/v1/auth/passkey/signup/complete`, { method: 'POST', headers: { cookie, origin }, body: '{}' });
assert.equal(signupDenied.status, 403); // No opt-in: must not reach the backend.
console.log('PASS: private access, HTTPS/CSP, production challenge, related origins, no-store, cohort gates and cross-origin rejection');

const browser = await chromium.launch({ headless: true });
try {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 393, height: 852 }]) {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const failures = [];
        page.on('pageerror', error => failures.push(error.message));
        await page.goto(invitation, { waitUntil: 'networkidle' });
        assert.equal(new URL(page.url()).pathname, '/app/');
        await page.getByRole('button', { name: /sign in/i }).first().waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(failures, []);
        console.log(`PASS: signed-out browser ${viewport.width}px, no runtime errors or horizontal overflow`);
        if (viewport.width === 1280) {
            // A synthetic local credential verifies browser related-origin support.
            // The assertion is NEVER sent to production or associated with an account.
            const cdp = await context.newCDPSession(page);
            await cdp.send('WebAuthn.enable');
            const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
            const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
            const credentialId = randomBytes(32).toString('base64');
            await cdp.send('WebAuthn.addCredential', { authenticatorId, credential: { credentialId, rpId: 'six7.lol', privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'), isResidentCredential: true, userHandle: randomBytes(16).toString('base64'), signCount: 0 } });
            const assertionOrigin = await page.evaluate(async id => {
                await (await import('/app/auth-reliability.js')).checkPasskeyEnvironment();
                const credential = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: 'six7.lol', allowCredentials: [{ type: 'public-key', id: Uint8Array.from(atob(id), c => c.charCodeAt(0)) }], userVerification: 'required', timeout: 15_000 } });
                return JSON.parse(new TextDecoder().decode(credential.response.clientDataJSON)).origin;
            }, credentialId);
            assert.equal(assertionOrigin, origin);
            console.log('PASS: Chromium related-origin WebAuthn ceremony (synthetic credential, no production authentication)');
        }
        await context.close();
    }
} finally { await browser.close(); }
for (const allowed of [origin, 'https://validapp.lol', 'https://six7.lol']) {
    const preflight = await fetch('https://api.six7.lol/api/v1/config', { method: 'OPTIONS', headers: { origin: allowed, 'access-control-request-method': 'GET' } });
    assert.equal(preflight.status, 200, `Origin not enabled: ${allowed}`);
    assert.equal(preflight.headers.get('access-control-allow-origin'), allowed);
}
console.log('PASS: exact staging CORS enabled and existing native/web origins preserved');
