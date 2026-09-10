import { fetchAuthWithRecovery } from './auth-route-recovery.js';
import { authDeviceFamily } from './auth-diagnostics.js';
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
            if (attempt === 0 && !error.routeRecoveryAttempted && navigator.onLine !== false && [0, 408].includes(error.status)) continue;
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

export async function enablePreviewSignup() {
    if (location.origin !== 'https://staging.validapp.lol') return true;
    if (!window.confirm('Staging uses live production accounts. This test can send a real verification SMS and create a real account. Use a phone number you control that is not already registered. Continue?')) return false;
    const response = await fetch('/preview/signup-enable', { method: 'POST', credentials: 'same-origin',
        headers: { 'X-Valid-Preview-Signup': 'confirm-production' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Could not enable signup testing. Reopen your private staging link and try again.');
    return true;
}

let pageDiagnosticInstance;
export function authDiagnosticInstance() {
    if (pageDiagnosticInstance) return pageDiagnosticInstance;
    const key = 'valid:auth-diagnostic-instance:v1';
    try {
        const saved = localStorage.getItem(key);
        if (/^[a-f0-9]{64}$/.test(saved || '')) return pageDiagnosticInstance = saved;
    } catch (_) { /* Private browsing/storage restrictions must not break auth. */ }
    pageDiagnosticInstance = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(key, pageDiagnosticInstance); } catch (_) {}
    return pageDiagnosticInstance;
}

export function needsPhoneReverification(error) {
    return ['phone_verification_expired', 'phone_not_verified'].includes(error?.code);
}

export async function passkeySecurityFailure(rpId, stage) {
    const sameRP = location.hostname === rpId || location.hostname.endsWith(`.${rpId}`);
    let related = 'unknown';
    try {
        const caps = await PublicKeyCredential.getClientCapabilities?.();
        if (typeof caps?.relatedOrigins === 'boolean') related = caps.relatedOrigins ? 'supported' : 'unsupported';
    } catch (_) {}
    const error = authError('passkey_security',
        sameRP ? 'Your browser could not complete the passkey security check. Open Valid in an updated Chrome or Safari browser and try again.'
            : 'Your browser could not verify access to your Six7 passkey. Try mobile data or an updated Chrome or Safari browser. Opening the same page again may not resolve this domain check.', stage);
    error.passkeyContext = sameRP ? 'webauthn.same_rp' : `webauthn.related_origin_${related}`;
    return error;
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
    const instance = authDiagnosticInstance();
    const body = JSON.stringify({ id: crypto.randomUUID(), event: 'auth.web_failure', severity: 'warning', message: 'Web authentication could not complete.', occurred_at: new Date().toISOString(), context: {
        app_version: version, build_number: version.match(/\d+/)?.[0] || '0', client_instance_id: instance,
        distribution_channel: 'web_pwa', flow: 'authentication', stage, error_code: code,
        http_status: String(Number(error.status) || 0), route: location.hostname,
        device_model: authDeviceFamily(navigator.userAgent),
        ...(['webauthn.same_rp', 'webauthn.related_origin_supported', 'webauthn.related_origin_unsupported', 'webauthn.related_origin_unknown'].includes(error.passkeyContext)
            ? { underlying_error_code: error.passkeyContext } : {}),
        ...( /^[a-f0-9-]{12,36}$/i.test(error.requestId || '') ? { server_request_id: error.requestId } : {} ),
        network_connected: String(navigator.onLine),
    }, breadcrumbs: [] });
    // Best effort only: no persistent queue, raw errors, credentials,
    // names, phone numbers, URLs with queries, or full user-agent strings.
    const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        credentials: location.origin === 'https://staging.validapp.lol' ? 'same-origin' : 'omit', keepalive: true };
    // The event UUID deduplicates this explicitly replay-safe write. Do not
    // route through ValidAPI, which would recursively report its own failure.
    const delivery = location.origin === 'https://validapp.lol'
        ? fetchAuthWithRecovery(`${location.origin}/api/v1/client-logs`, options, { timeoutMs: 6000 })
        : fetch('/api/v1/client-logs', options);
    void delivery.catch(() => null);
}
