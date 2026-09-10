// Cookie-bearing requests must remain first-party. Only these anonymous,
// audited reads/challenge allocations may cross an owned API origin.
const ALTERNATES = ['https://api.validappcdn.com/api/v1', 'https://api.six7.lol/api/v1'];
export function permitsAuthRouteRecovery(path, options, baseURL, origin) {
    if (origin !== 'https://validapp.lol' || baseURL !== `${origin}/api/v1` || options.auth !== false) return false;
    const method = (options.method || 'GET').toUpperCase();
    return (method === 'GET' && (path === '/auth/passkey/authenticate/challenge'
        || /^\/users\/username-available\/[A-Za-z0-9_.-]{1,64}$/.test(path)))
        || (method === 'POST' && ['/users/phone-check', '/auth/passkey/signup/challenge'].includes(path));
}

export async function fetchAuthWithRecovery(url, options, { fetcher = fetch, timeoutMs = 10000,
    signal, now = () => performance.now() } = {}) {
    const primary = new URL(url);
    const suffix = primary.pathname.slice('/api/v1'.length) + primary.search;
    const routes = [url, ...ALTERNATES.map(base => base + suffix)];
    const endsAt = now() + Math.min(10000, Math.max(1, timeoutMs));
    let lastError;
    for (let index = 0; index < routes.length; index++) {
        if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
        const remaining = endsAt - now();
        if (remaining <= 0) break;
        const controller = new AbortController();
        const abort = () => controller.abort(signal.reason);
        signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(() => controller.abort(), Math.min(4000, remaining));
        try {
            const headers = new Headers(options.headers);
            headers.delete('Authorization'); headers.delete('Cookie');
            const response = await fetcher(routes[index], { ...options, headers, signal: controller.signal,
                credentials: index === 0 ? 'same-origin' : 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
            // Consume the small anonymous JSON response within the same deadline.
            // HTTP rejections stay authoritative; no retry across domains.
            const body = await response.text();
            return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
        } catch (error) {
            if (signal?.aborted) throw error;
            if (navigator.onLine === false) throw error;
            lastError = error;
        } finally {
            clearTimeout(timer); signal?.removeEventListener('abort', abort);
        }
    }
    const failure = lastError || new DOMException('Timed out', 'TimeoutError');
    failure.routeRecoveryAttempted = true;
    throw failure;
}
