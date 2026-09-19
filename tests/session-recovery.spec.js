import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

for (const mode of ['network', 'unexpected401', 'serverError']) test(`startup ${mode} offers reconnection without opening signup`, async ({ page }) => {
    let sessionReads = 0;
    let recovered = false;
    await page.route('**/api/v1/**', route => {
        if (new URL(route.request().url()).pathname.endsWith('/auth/session')) {
            sessionReads++;
            if (recovered) return route.fulfill({ json: { user: { id: 'test-user', first_name: 'Test', username: 'test' } } });
            if (mode === 'network') return route.abort('failed');
            return route.fulfill({ status: mode === 'unexpected401' ? 401 : 503, json: { detail: 'Temporary failure' } });
        }
        return route.fulfill({ json: {} });
    });
    await page.goto('/app/');
    await expect(page.locator('#retrySessionButton')).toBeVisible();
    await expect(page.locator('#signupDialog')).not.toBeVisible();
    await expect(page.locator('#createAccountButton')).toBeHidden();
    expect(sessionReads).toBe(mode === 'network' ? 2 : 1);
    recovered = true;
    await page.locator('#retrySessionButton').click();
    await expect(page.locator('#appView')).toBeVisible();
    await expect(page.locator('#retrySessionButton')).toBeHidden();
    await expect(page.locator('#signupDialog')).not.toBeVisible();
});

test('confirmed missing cookie still permits normal signup', async ({ page }) => {
    // Test session recovery with an explicitly supported authenticator. Linux
    // WebKit does not expose the host's native WebAuthn implementation.
    await page.addInitScript(() => {
        Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: class {} });
        Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
            get: async () => { throw new Error('No ceremony expected'); },
            create: async () => { throw new Error('No ceremony expected'); },
        } });
    });
    await page.route('**/api/v1/**', route => route.fulfill({ status: 401,
        headers: { 'WWW-Authenticate': 'Bearer' }, json: { detail: 'Authentication required' } }));
    await page.goto('/app/');
    await expect(page.locator('#signupDialog')).toBeVisible();
    await expect(page.locator('#retrySessionButton')).toBeHidden();
});

test('missing cookie on an unsupported browser shows help without starting signup', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: undefined });
    });
    await page.route('**/api/v1/**', route => route.fulfill({ status: 401,
        headers: { 'WWW-Authenticate': 'Bearer' }, json: { detail: 'Authentication required' } }));
    await page.goto('/app/');
    await expect(page.locator('#authBrowserHelp')).toBeVisible();
    await expect(page.locator('#authStatus')).toContainText('cannot use passkeys');
    await expect(page.locator('#signupDialog')).toBeHidden();
    await expect(page.locator('#retrySessionButton')).toBeHidden();
    await expect(page.locator('#createAccountButton')).toBeVisible();
});

test('signup setup retry obtains a fresh challenge after browser SecurityError', async ({ page }) => {
    await page.route('**/api/v1/**', route => route.fulfill({ status: 401,
        headers: { 'WWW-Authenticate': 'Bearer' }, json: { detail: 'Authentication required' } }));
    await page.goto('/app/?signin=1');
    const result = await page.evaluate(async () => {
        Object.defineProperty(window, 'PublicKeyCredential', { value: class {
            static async getClientCapabilities() { return { relatedOrigins: true }; }
        }, configurable: true });
        let ceremonies = 0, challenges = 0;
        // Exercise the browser SecurityError classification at the ceremony boundary.
        const { createSignupPasskey } = await import('/app/passkeys.js');
        Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
            get: async () => {}, create: async () => {
                ceremonies++;
                if (ceremonies === 1) {
                    throw new DOMException('browser security', 'SecurityError');
                }
                return { rawId: new Uint8Array([1]).buffer, response: {
                    attestationObject: new Uint8Array([2]).buffer, clientDataJSON: new Uint8Array([3]).buffer,
                } };
            },
        } });
        const result = await createSignupPasskey({ getWebSignupChallenge: async () => {
            challenges++; return { challenge: 'AQID', rpId: 'six7.lol', rpName: 'Valid', userId: 'user', userName: 'name' };
        } }, 'name');
        return { ceremonies, challenges, hasCredential: Boolean(result.credentialId) };
    });
    expect(result).toEqual({ ceremonies: 2, challenges: 2, hasCredential: true });
});
