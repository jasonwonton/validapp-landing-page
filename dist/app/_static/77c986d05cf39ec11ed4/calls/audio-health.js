// In-call audio checks. Chrome on Android can hand a page a silent
// microphone while another call or app holds it, and a browser that refuses
// to play the call leaves it silent too. On 2026-10-30 two friends on a
// phone browser and an iPhone tried five calls in a row and heard nothing,
// and nothing was recorded. Every few seconds the controller passes in a
// sample (the WebRTC statistics plus what the page knows). This module
// decides when to warn and builds the `call.quality_summary` sent when the
// call ends. The iOS app sends the same event; the `cq_*` keys are
// allowlisted by the server (six7 app/models/client_diagnostics.py).
// Pure: no DOM, no LiveKit.

export const AUDIO_SAMPLE_INTERVAL_MS = 2000;
// A mic that sends nothing for this long gets a warning; a pause in talking
// still carries room noise, so only true silence counts.
export const MIC_SILENT_WARNING_MS = 8000;
// Mean squared audio level below about -100 dBFS. A working mic in a quiet
// room stays well above it; a mic another app holds delivers zeros.
const SILENT_MEAN_SQUARED_LEVEL = 1e-10;
const MAX_COUNT = 99_999;

// Fields only the web app sends. A server without them rejects the event,
// so the summary is sent again without them (sendCallQualitySummary).
export const WEB_AUDIO_SUMMARY_KEYS = Object.freeze([
    'cq_mic_on_s', 'cq_mic_silent_s', 'cq_audio_in_s', 'cq_audio_in_none_s',
    'cq_playback_blocked_s', 'cq_mic_warnings', 'cq_sound_warnings',
]);

const CANDIDATE_TYPES = new Set(['host', 'srflx', 'prflx', 'relay']);
const TRANSPORTS = new Set(['udp', 'tcp', 'tls']);

const finite = value => typeof value === 'number' && Number.isFinite(value);
const count = value => String(Math.min(Math.max(Math.round(value) || 0, 0), MAX_COUNT));
const seconds = ms => count(ms / 1000);
const permille = (part, whole) => count(whole > 0 ? part / whole * 1000 : 0);

// Nearest-rank percentile, as the iOS summary computes it; null without values.
export function percentile(values, fraction) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.ceil(fraction * sorted.length);
    return sorted[Math.min(Math.max(rank - 1, 0), sorted.length - 1)];
}

function statsList(report) {
    if (!report) return [];
    if (typeof report.values === 'function') return [...report.values()];
    return Array.isArray(report) ? report : Object.values(report);
}

// The media path (round trip, candidate type, transport) from any report
// that carries the selected candidate pair.
function readPath(stats) {
    const byId = new Map(stats.map(item => [item.id, item]));
    const transport = stats.find(item => item.type === 'transport' && item.selectedCandidatePairId);
    let pair = transport ? byId.get(transport.selectedCandidatePairId) : null;
    pair ||= stats.find(item => item.type === 'candidate-pair' && (item.selected || (item.nominated && item.state === 'succeeded')));
    if (!pair) return null;
    const local = byId.get(pair.localCandidateId);
    const candidate = local?.candidateType || null;
    const protocol = candidate === 'relay' ? (local?.relayProtocol || local?.protocol) : local?.protocol;
    return {
        rttMs: finite(pair.currentRoundTripTime) ? pair.currentRoundTripTime * 1000 : null,
        candidate,
        transport: protocol || null,
    };
}

// The microphone as captured, before it is encoded: cumulative energy and
// duration (null where the browser does not report them).
export function readOutgoingAudioStats(report) {
    const stats = statsList(report);
    if (!stats.length) return null;
    const source = stats.find(item => item.type === 'media-source' && item.kind === 'audio');
    return {
        energy: finite(source?.totalAudioEnergy) ? source.totalAudioEnergy : null,
        duration: finite(source?.totalSamplesDuration) ? source.totalSamplesDuration : null,
        path: readPath(stats),
    };
}

// One remote audio track as received.
export function readIncomingAudioStats(report) {
    const stats = statsList(report);
    const inbound = stats.find(item => item.type === 'inbound-rtp' && item.kind === 'audio');
    if (!inbound) return null;
    return {
        packetsReceived: finite(inbound.packetsReceived) ? inbound.packetsReceived : 0,
        packetsLost: finite(inbound.packetsLost) ? Math.max(inbound.packetsLost, 0) : 0,
        concealedSamples: finite(inbound.concealedSamples) ? inbound.concealedSamples : 0,
        totalSamples: finite(inbound.totalSamplesReceived) ? inbound.totalSamplesReceived : 0,
        jitterMs: finite(inbound.jitter) ? inbound.jitter * 1000 : null,
        path: readPath(stats),
    };
}

export class CallAudioHealth {
    constructor(startedAt) {
        this.startedAt = startedAt;
        this.lastAt = null;
        this.samples = 0;
        this.participants = 1;
        this.previousMic = null;
        this.micOnMs = 0;
        this.micSilentMs = 0;
        this.micSilentRunMs = 0;
        this.micMeasured = false;
        this.incoming = new Map();
        this.retiredIncoming = [];
        this.audioInMs = 0;
        this.audioInNoneMs = 0;
        this.audioInJudged = false;
        this.playbackBlockedMs = 0;
        this.warnings = { mic: 0, sound: 0 };
        this.roundTrips = [];
        this.jitters = [];
        this.candidate = null;
        this.transport = null;
        this.qualityMs = { poor: 0, lost: 0 };
        this.remoteDegradedMs = 0;
        this.reconnects = 0;
        this.reconnectingSince = null;
        this.reconnectingMs = 0;
        this.cameraPauses = 0;
    }

    // Records one sample and returns whether the mic warning should show.
    // sample: { at, micOn, mic: { energy, duration, trackMuted, ended } | null,
    //   incoming: [{ id, packetsReceived, packetsLost, concealedSamples,
    //   totalSamples, jitterMs }], playbackBlocked, quality, remoteDegraded,
    //   participants, rttMs, candidate, transport }
    record(sample) {
        const at = sample.at;
        const elapsed = this.lastAt === null ? 0 : Math.max(at - this.lastAt, 0);
        this.lastAt = at;
        this.samples += 1;
        this.participants = Math.max(this.participants, sample.participants || 1);
        this.recordMicrophone(sample, elapsed);
        this.recordIncoming(sample.incoming || [], elapsed);
        if (sample.playbackBlocked) this.playbackBlockedMs += elapsed;
        if (sample.quality === 'poor' || sample.quality === 'lost') this.qualityMs[sample.quality] += elapsed;
        if (sample.remoteDegraded) this.remoteDegradedMs += elapsed;
        if (finite(sample.rttMs)) this.roundTrips.push(sample.rttMs);
        if (sample.candidate) this.candidate = sample.candidate;
        if (sample.transport) this.transport = sample.transport;
        return { micSilent: Boolean(sample.micOn) && this.micSilentRunMs >= MIC_SILENT_WARNING_MS };
    }

    recordMicrophone({ micOn, mic }, elapsed) {
        const previous = this.previousMic;
        this.previousMic = micOn && mic ? mic : null;
        if (!micOn || !mic) { this.micSilentRunMs = 0; return; }
        if (!previous) return;
        this.micOnMs += elapsed;
        let silent = null;
        if (mic.ended || mic.trackMuted) silent = true;
        else if (finite(mic.duration) && finite(previous.duration) && finite(mic.energy) && finite(previous.energy)) {
            const duration = mic.duration - previous.duration;
            const energy = mic.energy - previous.energy;
            // Counters that went down belong to a restarted track.
            if (duration >= 0 && energy >= 0) {
                // Capture that stopped delivering audio is as silent as zeros.
                silent = duration < elapsed / 4000 || energy / duration < SILENT_MEAN_SQUARED_LEVEL;
            }
        }
        if (silent === null) return;
        this.micMeasured = true;
        if (silent) {
            this.micSilentMs += elapsed;
            this.micSilentRunMs += elapsed;
        } else this.micSilentRunMs = 0;
    }

    // A restarted mic starts its counters again.
    micRestarted() {
        this.previousMic = null;
        this.micSilentRunMs = 0;
    }

    recordIncoming(streams, elapsed) {
        if (streams.length) this.audioInMs += elapsed;
        let judged = false, arrived = false, worstJitter = null;
        for (const stream of streams) {
            const previous = this.incoming.get(stream.id);
            if (previous && (stream.packetsReceived < previous.packetsReceived || stream.totalSamples < previous.totalSamples)) {
                this.retiredIncoming.push(previous);
            } else if (previous) {
                judged = true;
                if (stream.packetsReceived > previous.packetsReceived) arrived = true;
            }
            this.incoming.set(stream.id, stream);
            if (finite(stream.jitterMs)) worstJitter = Math.max(worstJitter ?? 0, stream.jitterMs);
        }
        if (worstJitter !== null) this.jitters.push(worstJitter);
        if (judged) {
            this.audioInJudged = true;
            if (!arrived) this.audioInNoneMs += elapsed;
        }
    }

    warningShown(kind) {
        if (kind in this.warnings) this.warnings[kind] += 1;
    }

    reconnectStarted(at) {
        if (this.reconnectingSince !== null) return;
        this.reconnects += 1;
        this.reconnectingSince = at;
    }

    reconnectFinished(at) {
        if (this.reconnectingSince === null) return;
        this.reconnectingMs += Math.max(at - this.reconnectingSince, 0);
        this.reconnectingSince = null;
    }

    cameraPaused() {
        this.cameraPauses += 1;
    }

    // The summary's context: every value a string, as diagnostics require.
    summary(at) {
        const reconnectingMs = this.reconnectingMs + (this.reconnectingSince === null ? 0 : Math.max(at - this.reconnectingSince, 0));
        const context = {
            call_participant_count: String(Math.min(this.participants, 50)),
            call_connected_seconds: String(Math.min(Math.max(Math.round((at - this.startedAt) / 1000), 0), 86_400)),
            cq_samples: count(this.samples),
            cq_reconnects: count(this.reconnects),
            cq_reconnect_s: seconds(reconnectingMs),
            cq_poor_s: seconds(this.qualityMs.poor),
            cq_lost_s: seconds(this.qualityMs.lost),
            cq_remote_poor_s: seconds(this.remoteDegradedMs),
            cq_camera_pauses: count(this.cameraPauses),
            cq_candidate: this.candidate ? (CANDIDATE_TYPES.has(this.candidate) ? this.candidate : 'other') : 'unknown',
            cq_transport: this.transport ? (TRANSPORTS.has(this.transport) ? this.transport : 'other') : 'unknown',
            cq_audio_route: 'unknown',
            cq_mic_on_s: seconds(this.micOnMs),
            cq_audio_in_s: seconds(this.audioInMs),
            cq_playback_blocked_s: seconds(this.playbackBlockedMs),
            cq_mic_warnings: count(this.warnings.mic),
            cq_sound_warnings: count(this.warnings.sound),
        };
        if (this.micMeasured) context.cq_mic_silent_s = seconds(this.micSilentMs);
        if (this.audioInJudged) context.cq_audio_in_none_s = seconds(this.audioInNoneMs);
        const rttP50 = percentile(this.roundTrips, 0.5), rttP95 = percentile(this.roundTrips, 0.95);
        if (rttP50 !== null) context.cq_rtt_p50_ms = count(rttP50);
        if (rttP95 !== null) context.cq_rtt_p95_ms = count(rttP95);
        const jitterP95 = percentile(this.jitters, 0.95);
        if (jitterP95 !== null) context.cq_audio_jitter_p95_ms = count(jitterP95);
        const audio = [...this.incoming.values(), ...this.retiredIncoming];
        const lost = audio.reduce((sum, item) => sum + item.packetsLost, 0);
        const received = audio.reduce((sum, item) => sum + item.packetsReceived, 0);
        if (lost + received > 0) context.cq_audio_loss_permille = permille(lost, lost + received);
        const totalSamples = audio.reduce((sum, item) => sum + item.totalSamples, 0);
        if (totalSamples > 0) context.cq_audio_concealed_permille = permille(audio.reduce((sum, item) => sum + item.concealedSamples, 0), totalSamples);
        return context;
    }
}
