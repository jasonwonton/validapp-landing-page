import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function mount(page, { host = 'validapp.lol', capabilities = true, ua = '' } = {}) {
    await page.route(`https://${host}/**`, async route => {
        const path = new URL(route.request().url()).pathname;
        if (['/app/auth-reliability.js', '/app/auth-diagnostics.js', '/app/passkeys.js', '/app/api.js'].includes(path)) return route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL(`../${path.slice(1)}`, import.meta.url), 'utf8') });
        if (path === '/api/v1/client-logs') return route.fulfill({ status: 201, json: {} });
        return route.fulfill({ contentType: 'text/html', body: '<meta name="valid-app-version" content="web-v82"><title>Auth fixture</title>' });
    });
    await page.goto(`https://${host}/app/?phone=must-not-leak&token=private`);
    await page.evaluate(({ capabilities, ua }) => {
        if (ua) Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
        Object.defineProperty(window, 'PublicKeyCredential', { value: class {
            static async getClientCapabilities() { return { relatedOrigins: capabilities }; }
        }, configurable: true });
        Object.defineProperty(navigator, 'credentials', { value: { create: async () => {}, get: async () => {} }, configurable: true });
    }, { capabilities, ua });
}

test('staging signup opt-in can be cancelled and never silently enables real account creation', async ({ page }) => {
    await mount(page, { host: 'staging.validapp.lol' });
    let calls = 0;
    await page.route('**/preview/signup-enable', route => { calls++; return route.fulfill({ status: 200, json: {} }); });
    page.once('dialog', dialog => dialog.dismiss());
    expect(await page.evaluate(async () => (await import('/app/auth-reliability.js')).enablePreviewSignup())).toBe(false);
    expect(calls).toBe(0);
    page.once('dialog', dialog => { expect(dialog.message()).toContain('real account'); return dialog.accept(); });
    expect(await page.evaluate(async () => (await import('/app/auth-reliability.js')).enablePreviewSignup())).toBe(true);
    expect(calls).toBe(1);
});

test('HTTP signup rejection records a normalized reason and request ID without raw body data', async ({ page }) => {
    await mount(page, { host: 'staging.validapp.lol' });
    const reports = [];
    page.on('request', request => { if (request.url().endsWith('/client-logs')) reports.push(request.postDataJSON()); });
    await page.route('**/api/v1/auth/passkey/signup/complete', route => route.fulfill({ status: 400,
        headers: { 'x-request-id': 'abcdef123456' }, json: { detail: 'Phone number is not verified.', private: '4155550123' } }));
    const result = await page.evaluate(async () => {
        const { ValidAPI } = await import('/app/api.js');
        try { await new ValidAPI().request('/auth/passkey/signup/complete', { method: 'POST', body: '{}' }); }
        catch (error) { return { code: error.code, stage: error.stage, status: error.status }; }
    });
    expect(result).toEqual({ code: 'phone_not_verified', stage: 'signup_complete', status: 400 });
    await expect.poll(() => reports.length).toBe(1);
    expect(reports[0].context.server_request_id).toBe('abcdef123456');
    expect(JSON.stringify(reports)).not.toContain('4155550123');
});

test('signup network diagnostics identify the step without retrying SMS or exposing the phone', async ({ page }) => {
    await mount(page);
    const reports = [];
    page.on('request', request => { if (request.url().endsWith('/client-logs')) reports.push(request.postDataJSON()); });
    let attempts = 0;
    await page.route('**/api/v1/auth/phone/request/web', route => { attempts++; return route.abort('failed'); });
    const result = await page.evaluate(async () => {
        const { ValidAPI } = await import('/app/api.js');
        try { await new ValidAPI().request('/auth/phone/request/web', { method: 'POST', body: JSON.stringify({ phone_number: '4155550123', turnstile_token: 'private-token' }) }); }
        catch (error) { return { status: error.status, code: error.code, stage: error.stage }; }
    });
    expect(result).toEqual({ status: 0, code: 'network_failure', stage: 'phone_request' });
    expect(attempts).toBe(1);
    await expect.poll(() => reports.length).toBe(1);
    expect(reports[0].context.stage).toBe('phone_request');
    expect(JSON.stringify(reports)).not.toMatch(/4155550123|private-token/);
});

test('missing diagnostic browser APIs cannot interrupt authentication recovery', async ({ page }) => {
    await mount(page);
    expect(await page.evaluate(async () => {
        Object.defineProperty(crypto, 'randomUUID', { value: undefined });
        (await import('/app/auth-reliability.js')).reportAuthFailure({ code: 'passkeys_unavailable' });
        return true;
    })).toBe(true);
});

test('cross-domain capability failure is caught before issuing a challenge', async ({ page }) => {
    await mount(page, { capabilities: false });
    const result = await page.evaluate(async () => {
        const { createSignupPasskey } = await import('/app/passkeys.js');
        let calls = 0;
        try { await createSignupPasskey({ getWebSignupChallenge: async () => { calls++; } }, 'private_name'); }
        catch (error) { return { calls, code: error.code }; }
    });
    expect(result).toEqual({ calls: 0, code: 'related_origins_unavailable' });
});

test('RP-native domains work without related-origin support', async ({ page }) => {
    await mount(page, { host: 'six7.lol', capabilities: false });
    expect(await page.evaluate(async () => { await (await import('/app/auth-reliability.js')).checkPasskeyEnvironment(); return true; })).toBe(true);
});

test('Android embedded browser is detected and Chrome handoff carries no signup secrets', async ({ page }) => {
    await mount(page, { ua: 'Mozilla/5.0 (Linux; Android 13; Pixel Build/test; wv) Chrome/110 Mobile Instagram' });
    const result = await page.evaluate(async () => {
        const { checkPasskeyEnvironment, authBrowserURL } = await import('/app/auth-reliability.js');
        try { await checkPasskeyEnvironment(); }
        catch (error) { return { code: error.code, url: authBrowserURL({ signup: true }) }; }
    });
    expect(result.code).toBe('embedded_browser');
    expect(result.url).toContain('intent://validapp.lol/app/?signup=1');
    expect(result.url).toContain('package=com.android.chrome');
    expect(result.url).not.toMatch(/private|phone|token/);
});

test('challenge transport retries once, but HTTP rejection and offline never loop', async ({ page }) => {
    await mount(page);
    const result = await page.evaluate(async () => {
        const { requestAuthChallenge } = await import('/app/auth-reliability.js');
        let calls = 0;
        const success = await requestAuthChallenge(async () => { if (++calls === 1) throw { status: 0 }; return 'challenge'; }, 'signup_challenge');
        let rejected = 0, offline = 0;
        try { await requestAuthChallenge(async () => { rejected++; throw { status: 429 }; }, 'signup_challenge'); } catch (_) {}
        Object.defineProperty(navigator, 'onLine', { value: false });
        try { await requestAuthChallenge(async () => { offline++; throw { status: 0 }; }, 'signup_challenge'); } catch (_) {}
        return { calls, success, rejected, offline };
    });
    expect(result).toEqual({ calls: 2, success: 'challenge', rejected: 1, offline: 1 });
});

test('lost signup response restores only the matching session and never repeats the write', async ({ page }) => {
    await mount(page);
    const result = await page.evaluate(async () => {
        const { completeSignupSafely } = await import('/app/auth-reliability.js');
        const outcomes = [];
        for (const session of [{ user: { id: 'new-user' } }, { user: { id: 'other-user' } }, null]) {
            let writes = 0, reads = 0;
            try {
                const restored = await completeSignupSafely({ completeWebSignup: async () => { writes++; throw { status: 0 }; }, restoreSession: async () => { reads++; return session; } }, { userId: 'new-user' });
                outcomes.push({ writes, reads, userId: restored.user.id });
            } catch (error) { outcomes.push({ writes, reads, code: error.code }); }
        }
        return outcomes;
    });
    expect(result).toEqual([{ writes: 1, reads: 1, userId: 'new-user' }, { writes: 1, reads: 1, code: 'signup_result_unknown' }, { writes: 1, reads: 1, code: 'signup_result_unknown' }]);
});

test('browser SecurityError is actionable without changing RP or verification requirements', async ({ page }) => {
    await mount(page);
    const result = await page.evaluate(async () => {
        const { createSignupPasskey } = await import('/app/passkeys.js');
        let requested;
        navigator.credentials.create = async options => { requested = options.publicKey; throw new DOMException('sensitive browser error', 'SecurityError'); };
        try { await createSignupPasskey({ getWebSignupChallenge: async () => ({ challenge: 'AQID', rpId: 'six7.lol', rpName: 'Six7', userId: 'new-user', userName: 'private_name' }) }, 'private_name'); }
        catch (error) { return { code: error.code, message: error.message, rp: requested.rp.id, uv: requested.authenticatorSelection.userVerification }; }
    });
    expect(result.code).toBe('passkey_security');
    expect(result.message).toContain('updated Chrome or Safari');
    expect(result.message).not.toContain('not enabled');
    expect(result.rp).toBe('six7.lol'); expect(result.uv).toBe('required');
});

test('diagnostics are capped, deduplicated and omit personal and credential data', async ({ page }) => {
    await mount(page);
    const reports = [];
    page.on('request', request => { if (request.url().endsWith('/client-logs')) reports.push(request.postDataJSON()); });
    await page.evaluate(async () => {
        const { reportAuthFailure } = await import('/app/auth-reliability.js');
        for (const code of ['offline', 'offline', 'passkey_security', 'signup_result_unknown', 'extra_error']) {
            reportAuthFailure({ code, stage: 'signup_complete', message: 'private_name phone=1234567890 credential=secret', status: 0 });
        }
    });
    await expect.poll(() => reports.length).toBe(3);
    expect(JSON.stringify(reports)).not.toMatch(/private_name|1234567890|credential=secret|must-not-leak/);
    for (const report of reports) expect(report.context.client_instance_id).toMatch(/^[a-f0-9]{64}$/);
});
