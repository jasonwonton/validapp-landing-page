// Browser sessions are host-bound HttpOnly cookies. Never move authenticated
// requests to another domain or expose the cookie as a JavaScript token.
export function confirmsInvalidSession(response, payload) {
    return response.status === 401 && !response.redirected
        && response.headers.get('content-type')?.includes('application/json')
        && response.headers.get('www-authenticate')?.toLowerCase() === 'bearer'
        && ['Authentication required', 'Invalid browser session',
            'Invalid or expired session token', 'User for session not found'].includes(payload?.detail);
}

export async function fetchSessionRequest(url, options, { retry = false, timeoutMs = 15000,
    signal, fetcher = fetch, now = () => performance.now() } = {}) {
    const deadline = now() + Math.max(1, timeoutMs);
    const attempts = retry ? 2 : 1;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
        if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
        const remaining = deadline - now();
        if (remaining <= 0) break;
        const controller = new AbortController();
        const abort = () => controller.abort(signal.reason);
        signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(() => controller.abort(), remaining / (attempts - attempt));
        try {
            const response = await fetcher(url, { ...options, signal: controller.signal,
                cache: 'no-store', redirect: 'error' });
            // The deadline covers the body, not just arrival of HTTP headers.
            const text = await response.text();
            const json = response.headers.get('content-type')?.includes('application/json');
            let payload = text;
            if (json) {
                try { payload = text ? JSON.parse(text) : null; }
                catch (error) {
                    if (response.ok) throw error;
                    payload = null; // An unreadable rejection cannot revoke a session.
                }
            }
            return { response, payload };
        } catch (error) {
            if (signal?.aborted || navigator.onLine === false) throw error;
            lastError = error;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
        }
    }
    throw lastError || new DOMException('Timed out', 'TimeoutError');
}
