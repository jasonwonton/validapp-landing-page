const RP_ID = 'six7.lol'; // Released iOS credentials must keep this RP ID.
const WEB_ORIGINS = new Set(['https://validapp.lol', 'https://staging.validapp.lol', 'https://six7.lol']);

export function authError(code, message, stage = 'browser') {
    return Object.assign(new Error(message), { code, stage });
}

export async function checkPasskeyEnvironment(rpId = RP_ID) {
    if (!window.isSecureContext) throw authError('secure_context', 'Open Valid using HTTPS to use your passkey.');
    const android = /Android/i.test(navigator.userAgent);
    if (android && /; wv\)|\bInstagram\b|\bFBAN\b|\bFBAV\b/i.test(navigator.userAgent)) {
        throw authError('embedded_browser', 'Open Valid in Chrome to sign in or create your account. This in-app browser cannot reliably use passkeys.');
    }
    if (!window.PublicKeyCredential || !navigator.credentials?.create || !navigator.credentials?.get) {
        throw authError('passkeys_unavailable', 'This browser cannot use passkeys. Open Valid in an updated Chrome or Safari browser.');
    }
    const host = location.hostname;
    if (host === rpId || host.endsWith(`.${rpId}`)) return;
    // Local development uses mocked ceremonies. Never weaken the browser or
    // server's actual origin verification or change the challenge's RP ID.
    if (['localhost', '127.0.0.1'].includes(host)) return;
    if (!WEB_ORIGINS.has(location.origin)) {
        throw authError('unsupported_origin', 'Open validapp.lol to use your Valid passkey. This website address is not supported.');
    }
    const capabilities = await PublicKeyCredential.getClientCapabilities?.().catch(() => null);
    if (capabilities?.relatedOrigins === false) {
        throw authError('related_origins_unavailable', 'This browser cannot use your Six7 passkey on Valid. Open Valid in updated Chrome or Safari.');
    }
}

export function authBrowserURL({ signup = false } = {}) {
    const origin = WEB_ORIGINS.has(location.origin) ? location.origin : 'https://validapp.lol';
    const target = new URL(`/app/?${signup ? 'signup=1' : 'signin=1'}`, origin);
    // Do not carry phone numbers, invitations, challenge data or arbitrary URLs.
    return /Android/i.test(navigator.userAgent)
        ? `intent://${target.host}${target.pathname}${target.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(target.href)};end`
        : target.href;
}

export async function requestAuthChallenge(operation, stage) {
    // These endpoints issue a short-lived challenge, not an account or SMS.
    // Retry only a transport failure, once; never retry credential verification.
    for (let attempt = 0; ; attempt++) {
        try { return await operation(); }
        catch (error) {
            if (attempt === 0 && navigator.onLine !== false && [0, 408].includes(error.status)) continue;
            error.stage = stage;
            if ([0, 408].includes(error.status)) {
                error.code = navigator.onLine === false ? 'offline' : 'challenge_network';
                error.message = navigator.onLine === false ? 'You’re offline. Reconnect, then try again.'
                    : 'The connection dropped before passkey setup. Try again or switch between Wi-Fi and mobile data.';
            }
            throw error;
        }
    }
}

export async function completeSignupSafely(api, payload) {
    try {
        const result = await api.completeWebSignup(payload);
        if (!result?.user?.id) throw Object.assign(new Error('Incomplete signup response'), { status: 0 });
        return result;
    }
    catch (error) {
        error.stage = 'signup_complete';
        if (![0, 408, 500, 502, 503, 504].includes(error.status)) throw error;
        // A committed response may have set its HttpOnly cookie before its body
        // was lost. A read is safe; replaying a consumed attestation is not.
        try {
            const session = await api.restoreSession();
            if (session?.user?.id === payload.userId) return session;
        } catch (_) { /* Offer an explicit sign-in ceremony below. */ }
        throw authError('signup_result_unknown', 'Your connection dropped while finishing signup. Your account may already exist. Sign in with the passkey you just saved before trying signup again.', 'signup_complete');
    }
}

let diagnosticsSent = 0;
const reported = new Set();
export function reportAuthFailure(error) {
    try { sendAuthDiagnostic(error); } catch (_) { /* Diagnostics must never interrupt authentication. */ }
}

function sendAuthDiagnostic(error) {
    if (!WEB_ORIGINS.has(location.origin) || diagnosticsSent >= 3) return;
    const code = /^[a-z_]{1,48}$/.test(error.code || '') ? error.code : 'request_failed';
    const stage = /^[a-z_]{1,48}$/.test(error.stage || '') ? error.stage : 'browser';
    const key = `${stage}:${code}`;
    if (reported.has(key)) return;
    reported.add(key); diagnosticsSent++;
    const version = document.querySelector('meta[name="valid-app-version"]')?.content || 'web-unknown';
    const instance = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const ua = navigator.userAgent;
    const browser = /SamsungBrowser/i.test(ua) ? 'samsung_internet' : /; wv\)|Instagram|FBAN|FBAV/i.test(ua) ? 'embedded' : /Firefox/i.test(ua) ? 'firefox' : /Chrome/i.test(ua) ? 'chrome' : /Safari/i.test(ua) ? 'safari' : 'other';
    const body = JSON.stringify({ id: crypto.randomUUID(), event: 'auth.web_failure', severity: 'warning', message: 'Web authentication could not complete.', occurred_at: new Date().toISOString(), context: {
        app_version: version, build_number: version.match(/\d+/)?.[0] || '0', client_instance_id: instance,
        distribution_channel: 'web_pwa', flow: 'authentication', stage, error_code: code,
        http_status: String(Number(error.status) || 0), route: location.hostname,
        device_model: `${/Android/i.test(ua) ? 'android' : /iPhone|iPad/i.test(ua) ? 'ios_web' : 'desktop'}_${browser}`,
        network_connected: String(navigator.onLine),
    }, breadcrumbs: [] });
    // Best effort only: no persistent queue, retries, raw errors, credentials,
    // names, phone numbers, URLs with queries, or full user-agent strings.
    void fetch('/api/v1/client-logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, credentials: 'omit', keepalive: true }).catch(() => null);
}
