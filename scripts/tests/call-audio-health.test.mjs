import assert from "node:assert/strict";
import test from "node:test";
import {
    CallAudioHealth, MIC_SILENT_WARNING_MS, WEB_AUDIO_SUMMARY_KEYS,
    percentile, readIncomingAudioStats, readOutgoingAudioStats,
} from "../../app/calls/audio-health.js";

// A sample every 2 s: the mic's cumulative energy and duration, as WebRTC
// reports them on the outbound media-source.
function micSamples(health, { from = 0, steps, energyPerSecond, micOn = true, extra = {} }) {
    let result, energy = health.__energy || 0, duration = health.__duration || 0;
    for (let step = 0; step < steps; step += 1) {
        const at = from + step * 2000;
        result = health.record({ at, micOn, mic: micOn ? { energy, duration } : null, incoming: [], ...extra });
        energy += energyPerSecond * 2; duration += 2;
    }
    health.__energy = energy; health.__duration = duration;
    return result;
}

test("a mic that captures only zeros warns after 8 s and is counted", () => {
    const health = new CallAudioHealth(0);
    assert.equal(micSamples(health, { steps: 4, energyPerSecond: 0 }).micSilent, false); // 6 s of silence
    assert.equal(micSamples(health, { from: 8000, steps: 1, energyPerSecond: 0 }).micSilent, true); // 8 s
    const summary = health.summary(8000);
    assert.equal(summary.cq_mic_on_s, "8");
    assert.equal(summary.cq_mic_silent_s, "8");
});

test("room noise is not silence, and speech clears the warning", () => {
    const health = new CallAudioHealth(0);
    // About -70 dBFS: a quiet room through noise suppression.
    assert.equal(micSamples(health, { steps: 10, energyPerSecond: 1e-7 }).micSilent, false);
    assert.equal(health.summary(18000).cq_mic_silent_s, "0");
    micSamples(health, { from: 20000, steps: 6, energyPerSecond: 0 });
    assert.equal(health.record({ at: 32000, micOn: true, mic: { energy: health.__energy + 0.01, duration: health.__duration + 2 }, incoming: [] }).micSilent, false);
});

test("muting resets the silent run and is not counted as mic time", () => {
    const health = new CallAudioHealth(0);
    micSamples(health, { steps: 4, energyPerSecond: 0 });
    assert.equal(micSamples(health, { from: 8000, steps: 5, energyPerSecond: 0, micOn: false }).micSilent, false);
    assert.equal(micSamples(health, { from: 18000, steps: 4, energyPerSecond: 0 }).micSilent, false);
    assert.equal(health.summary(24000).cq_mic_on_s, "12");
});

test("a capture that stops, mutes or ends counts as silent", () => {
    for (const mic of [{ energy: 1, duration: 10 }, { trackMuted: true }, { ended: true }]) {
        const health = new CallAudioHealth(0);
        let result;
        for (let step = 0; step <= 4; step += 1) result = health.record({ at: step * 2000, micOn: true, mic, incoming: [] });
        assert.equal(result.micSilent, true, JSON.stringify(mic));
    }
});

test("a browser without capture levels never warns and reports no silent time", () => {
    const health = new CallAudioHealth(0);
    let result;
    for (let step = 0; step < 10; step += 1) result = health.record({ at: step * 2000, micOn: true, mic: { energy: null, duration: null }, incoming: [] });
    assert.equal(result.micSilent, false);
    const summary = health.summary(18000);
    assert.equal(summary.cq_mic_on_s, "18");
    assert.equal("cq_mic_silent_s" in summary, false);
});

test("a restarted mic starts its counters again", () => {
    const health = new CallAudioHealth(0);
    micSamples(health, { steps: 5, energyPerSecond: 0 });
    health.micRestarted();
    assert.equal(health.record({ at: 10000, micOn: true, mic: { energy: 0, duration: 0 }, incoming: [] }).micSilent, false);
    assert.equal(health.record({ at: 12000, micOn: true, mic: { energy: 0.01, duration: 2 }, incoming: [] }).micSilent, false);
});

test("incoming audio: arrival, stalls, loss and concealment", () => {
    const health = new CallAudioHealth(0);
    const stream = (packetsReceived, packetsLost, concealedSamples, totalSamples, jitterMs = 10) =>
        ({ id: "TR_A", packetsReceived, packetsLost, concealedSamples, totalSamples, jitterMs });
    health.record({ at: 0, micOn: false, incoming: [stream(0, 0, 0, 0)] });
    health.record({ at: 2000, micOn: false, incoming: [stream(100, 0, 0, 96000)] });
    health.record({ at: 4000, micOn: false, incoming: [stream(100, 0, 960, 96000, 40)] }); // nothing arrived
    // A new receiver for the same track: its counters start again.
    health.record({ at: 6000, micOn: false, incoming: [stream(40, 10, 0, 38400)] });
    const summary = health.summary(6000);
    assert.equal(summary.cq_audio_in_s, "6");
    assert.equal(summary.cq_audio_in_none_s, "2");
    assert.equal(summary.cq_audio_loss_permille, "67"); // 10 lost of 150
    assert.equal(summary.cq_audio_concealed_permille, "7"); // 960 of 134,400
    assert.equal(summary.cq_audio_jitter_p95_ms, "40");
});

test("the summary carries path, time, warnings and only allowlisted keys", () => {
    const health = new CallAudioHealth(1000);
    health.record({ at: 1000, micOn: false, incoming: [], participants: 3, quality: "good", rttMs: 80, candidate: "relay", transport: "tls" });
    health.record({ at: 3000, micOn: false, incoming: [], participants: 4, quality: "poor", remoteDegraded: true, playbackBlocked: true, rttMs: 200 });
    health.reconnectStarted(4000);
    health.warningShown("sound"); health.warningShown("mic"); health.warningShown("mic"); health.cameraPaused();
    const summary = health.summary(9000);
    assert.deepEqual(summary, {
        call_participant_count: "4", call_connected_seconds: "8",
        cq_samples: "2", cq_reconnects: "1", cq_reconnect_s: "5", cq_poor_s: "2", cq_lost_s: "0",
        cq_remote_poor_s: "2", cq_camera_pauses: "1", cq_candidate: "relay", cq_transport: "tls",
        cq_audio_route: "unknown", cq_mic_on_s: "0", cq_audio_in_s: "0", cq_playback_blocked_s: "2",
        cq_mic_warnings: "2", cq_sound_warnings: "1", cq_rtt_p50_ms: "80", cq_rtt_p95_ms: "200",
    });
    for (const value of Object.values(summary)) assert.match(value, /^[a-z]+$|^[0-9]{1,5}$/);
    for (const key of WEB_AUDIO_SUMMARY_KEYS) assert.ok(key.startsWith("cq_"));
});

test("unknown path labels become other; numbers saturate", () => {
    const health = new CallAudioHealth(0);
    health.record({ at: 0, micOn: false, incoming: [], candidate: "carrier-pigeon", transport: "quic", rttMs: 1e9 });
    const summary = health.summary(0);
    assert.equal(summary.cq_candidate, "other");
    assert.equal(summary.cq_transport, "other");
    assert.equal(summary.cq_rtt_p50_ms, "99999");
});

test("WebRTC reports are read for the mic, remote audio and the selected path", () => {
    const report = new Map([
        ["T1", { id: "T1", type: "transport", selectedCandidatePairId: "CP1" }],
        ["CP1", { id: "CP1", type: "candidate-pair", localCandidateId: "L1", currentRoundTripTime: 0.123 }],
        ["L1", { id: "L1", type: "local-candidate", candidateType: "relay", protocol: "udp", relayProtocol: "tls" }],
        ["S1", { id: "S1", type: "media-source", kind: "audio", totalAudioEnergy: 0.5, totalSamplesDuration: 12.5 }],
        ["I1", { id: "I1", type: "inbound-rtp", kind: "audio", packetsReceived: 500, packetsLost: -2, concealedSamples: 10, totalSamplesReceived: 48000, jitter: 0.02 }],
    ]);
    assert.deepEqual(readOutgoingAudioStats(report), { energy: 0.5, duration: 12.5, path: { rttMs: 123, candidate: "relay", transport: "tls" } });
    assert.deepEqual(readIncomingAudioStats(report), {
        packetsReceived: 500, packetsLost: 0, concealedSamples: 10, totalSamples: 48000, jitterMs: 20,
        path: { rttMs: 123, candidate: "relay", transport: "tls" },
    });
    assert.deepEqual(readOutgoingAudioStats(new Map([["X", { id: "X", type: "outbound-rtp", kind: "audio" }]])), { energy: null, duration: null, path: null });
    assert.equal(readOutgoingAudioStats(null), null);
    assert.equal(readIncomingAudioStats(new Map()), null);
});

test("percentile is nearest-rank", () => {
    assert.equal(percentile([], 0.5), null);
    assert.equal(percentile([30, 10, 20], 0.5), 20);
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10);
});

test("the silent-mic threshold is 8 s", () => {
    assert.equal(MIC_SILENT_WARNING_MS, 8000);
});
