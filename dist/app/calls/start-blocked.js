// A call tap that stopped in the browser before any request reached the
// server (the iOS app reports the same event from CallStartBlock.swift).
// These used to leave no trace: on 2026-10-23 two friends reported a call
// button that did nothing, and neither the API logs nor client diagnostics
// had a thing. Reported as `call.start_blocked`, the reason as its stage,
// once per reason and chat per page load. Best effort: never throws, never
// sends names, ids, URLs or raw error messages.
import { authDiagnosticInstance } from '../auth-reliability.js';
import { authDeviceFamily } from '../auth-diagnostics.js';

export const CALL_START_BLOCK_REASONS = new Set([
    'calls_unavailable', 'already_in_call', 'start_in_flight', 'chat_unavailable',
    'unsupported_browser', 'microphone_denied', 'microphone_unavailable', 'microphone_timeout',
]);

const reported = new Set();

function displayMode() {
    if (matchMedia('(display-mode: standalone)').matches) return 'standalone';
    if (matchMedia('(display-mode: fullscreen)').matches) return 'fullscreen';
    if (matchMedia('(display-mode: minimal-ui)').matches) return 'minimal-ui';
    return 'browser';
}

export function reportCallStartBlocked(reason, { chatId = null, mediaType = 'audio', direction = 'outgoing', errorName = null } = {}) {
    try {
        if (!CALL_START_BLOCK_REASONS.has(reason)) return;
        const key = `${reason}:${chatId || 'none'}`;
        if (reported.has(key)) return;
        reported.add(key);
        const version = document.querySelector('meta[name="valid-app-version"]')?.content || 'web-unknown';
        const context = {
            app_version: version,
            build_number: version.match(/\d+/)?.[0] || '0',
            client_instance_id: authDiagnosticInstance(),
            distribution_channel: 'web_pwa',
            flow: 'voice_video_call',
            stage: reason,
            call_direction: direction === 'incoming' ? 'incoming' : 'outgoing',
            call_media_type: mediaType === 'video' ? 'video' : 'audio',
            display_mode: displayMode(),
            device_model: authDeviceFamily(navigator.userAgent),
            network_connected: String(navigator.onLine),
        };
        if (/^[A-Za-z]{1,48}$/.test(errorName || '')) context.error_code = errorName;
        const body = JSON.stringify({
            id: crypto.randomUUID(), event: 'call.start_blocked', severity: 'warning',
            message: 'A call stopped in the browser before reaching the server.',
            occurred_at: new Date().toISOString(), context, breadcrumbs: [],
        });
        void fetch('/api/v1/client-logs', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
            credentials: 'same-origin', keepalive: true,
        }).catch(() => null);
    } catch (_) { /* Diagnostics must never get in the way of a call. */ }
}
