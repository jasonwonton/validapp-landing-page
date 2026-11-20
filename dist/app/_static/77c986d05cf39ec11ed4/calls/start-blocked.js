// A call tap that stopped in the browser before any request reached the
// server (the iOS app reports the same event from CallStartBlock.swift).
// These used to leave no trace: on 2026-10-23 two friends reported a call
// button that did nothing, and neither the API logs nor client diagnostics
// had a thing. Reported as `call.start_blocked`, the reason as its stage,
// once per reason and chat per page load. Best effort: never throws, never
// sends names, ids, URLs or raw error messages.
import { callDiagnosticContext, sendCallDiagnostic } from './call-diagnostics.js';

export const CALL_START_BLOCK_REASONS = new Set([
    'calls_unavailable', 'already_in_call', 'start_in_flight', 'chat_unavailable',
    'unsupported_browser', 'microphone_denied', 'microphone_unavailable', 'microphone_timeout',
]);

const reported = new Set();

export function reportCallStartBlocked(reason, { chatId = null, mediaType = 'audio', direction = 'outgoing', errorName = null } = {}) {
    try {
        if (!CALL_START_BLOCK_REASONS.has(reason)) return;
        const key = `${reason}:${chatId || 'none'}`;
        if (reported.has(key)) return;
        reported.add(key);
        const context = callDiagnosticContext({ stage: reason, direction, mediaType });
        if (/^[A-Za-z]{1,48}$/.test(errorName || '')) context.error_code = errorName;
        void sendCallDiagnostic('call.start_blocked', 'A call stopped in the browser before reaching the server.', context);
    } catch (_) { /* Diagnostics must never get in the way of a call. */ }
}
