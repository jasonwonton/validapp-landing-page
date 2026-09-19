// A UI hint only: the backend still checks approval and expiry on signup.
// Use the response's server clock so an incorrectly set device clock cannot
// force repeated SMS verification. Missing timing evidence leaves recovery to
// the backend; do not assume a fresh TTL when an approval is reused.
export function phoneVerificationDeadline(verification, serverDate, {
    now = Date.now(), elapsedMs = 0,
} = {}) {
    if (!verification?.is_approved || typeof verification.expires_at !== 'string'
        || typeof serverDate !== 'string') return null;
    const expires = Date.parse(verification.expires_at);
    const server = Date.parse(serverDate);
    if (!Number.isFinite(expires) || !Number.isFinite(server)
        || !Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
    // HTTP Date has second precision. Budget one second plus the full round
    // trip conservatively; a slow response must not extend the approval.
    return now + Math.max(0, expires - server - 1000 - elapsedMs);
}
