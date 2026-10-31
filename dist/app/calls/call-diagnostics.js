// Call diagnostics sent to /client-logs: the context every call event
// shares, and the end-of-call `call.quality_summary`. Best effort: never
// throws, never sends names, URLs or raw error messages.
import { authDiagnosticInstance } from '../auth-reliability.js';
import { authDeviceFamily } from '../auth-diagnostics.js';
import { WEB_AUDIO_SUMMARY_KEYS } from './audio-health.js';

function displayMode() {
    if (matchMedia('(display-mode: standalone)').matches) return 'standalone';
    if (matchMedia('(display-mode: fullscreen)').matches) return 'fullscreen';
    if (matchMedia('(display-mode: minimal-ui)').matches) return 'minimal-ui';
    return 'browser';
}

export function callDiagnosticContext({ stage, direction = 'outgoing', mediaType = 'audio' }) {
    const version = document.querySelector('meta[name="valid-app-version"]')?.content || 'web-unknown';
    return {
        app_version: version,
        build_number: version.match(/\d+/)?.[0] || '0',
        client_instance_id: authDiagnosticInstance(),
        distribution_channel: 'web_pwa',
        flow: 'voice_video_call',
        stage,
        call_direction: direction === 'incoming' ? 'incoming' : 'outgoing',
        call_media_type: mediaType === 'video' ? 'video' : 'audio',
        display_mode: displayMode(),
        device_model: authDeviceFamily(navigator.userAgent),
        network_connected: String(navigator.onLine),
    };
}

export function sendCallDiagnostic(event, message, context, { onRejected = null } = {}) {
    const body = JSON.stringify({
        id: crypto.randomUUID(), event, severity: 'warning', message,
        occurred_at: new Date().toISOString(), context, breadcrumbs: [],
    });
    return fetch('/api/v1/client-logs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        credentials: 'same-origin', keepalive: true,
    }).then(response => { if (response.status === 422) onRejected?.(); }).catch(() => null);
}

// One per connected call, when it ends. `summary` is CallAudioHealth's.
export function sendCallQualitySummary({ callId, direction, mediaType, summary }) {
    try {
        const context = { ...callDiagnosticContext({ stage: 'quality_summary', direction, mediaType }), ...summary };
        if (/^[0-9a-f-]{36}$/i.test(String(callId || ''))) context.call_id = String(callId);
        const message = 'Call quality summary';
        // A server that predates the web audio fields rejects the whole
        // event; the shared fields still go through on a second try.
        void sendCallDiagnostic('call.quality_summary', message, context, {
            onRejected: () => {
                const shared = { ...context };
                for (const key of WEB_AUDIO_SUMMARY_KEYS) delete shared[key];
                void sendCallDiagnostic('call.quality_summary', message, shared);
            },
        });
    } catch (_) { /* Diagnostics must never get in the way of a call. */ }
}
