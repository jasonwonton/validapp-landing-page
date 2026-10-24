// Port of iOS CallRingbackSoundPlayer (CallCoordinator.swift).
// Local playback only: never connect this buffer to the microphone/published stream.
export const RINGBACK_SAMPLE_RATE = 48000;
export const RINGBACK_DURATION = 3.6;
export const RINGBACK_VOLUME = 0.48;

export function ringbackSamples() {
    return toneSamples([[0, 659.25, .34], [.24, 783.99, .34], [.50, 987.77, .48]], RINGBACK_DURATION);
}

// Incoming ring for an open page (no CallKit on the web): two bright arpeggios per loop.
export const RINGTONE_DURATION = 2.6;
export function ringtoneSamples() {
    return toneSamples([[0, 1046.5, .2], [.16, 1318.51, .2], [.32, 1567.98, .34], [.86, 1046.5, .2], [1.02, 1318.51, .2], [1.18, 1567.98, .4]], RINGTONE_DURATION);
}

function toneSamples(notes, duration) {
    const samples = new Float32Array(RINGBACK_SAMPLE_RATE * duration);
    for (let frame = 0; frame < samples.length; frame++) {
        const time = frame / RINGBACK_SAMPLE_RATE;
        let value = 0;
        for (const [start, frequency, duration] of notes) {
            if (time < start || time >= start + duration) continue;
            const t = time - start;
            const envelope = Math.min(t / .012, 1) * Math.pow(Math.max(0, 1 - t / duration), 1.7);
            value += (Math.sin(2 * Math.PI * frequency * t) + Math.sin(4 * Math.PI * frequency * t) * .18) * envelope * .16;
        }
        // Same signed 16-bit PCM quantization as the native WAV generator.
        samples[frame] = Math.trunc(Math.max(-.95, Math.min(.95, value)) * 32767) / 32768;
    }
    return samples;
}

function wavURL(samples, rate) {
    const bytes = new DataView(new ArrayBuffer(44 + samples.length * 2));
    const text = (offset, value) => [...value].forEach((character, index) => bytes.setUint8(offset + index, character.charCodeAt(0)));
    text(0, 'RIFF'); bytes.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
    bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true);
    bytes.setUint32(24, rate, true); bytes.setUint32(28, rate * 2, true); bytes.setUint16(32, 2, true); bytes.setUint16(34, 16, true);
    text(36, 'data'); bytes.setUint32(40, samples.length * 2, true);
    samples.forEach((value, index) => bytes.setInt16(44 + index * 2, Math.round(value * 32767), true));
    return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

/**
 * The incoming ring for an open page (the web has no CallKit). An <audio>
 * element plays it when the browser allows sound; otherwise the ring stays
 * visual only and nothing is reported as an error.
 */
export function createRingtone({ volume = 0.6 } = {}) {
    let audio = null, url = null;
    function play() {
        try {
            url ||= wavURL(ringtoneSamples(), RINGBACK_SAMPLE_RATE);
            audio ||= Object.assign(document.createElement('audio'), { loop: true, preload: 'auto' });
            audio.src = url;
            audio.volume = volume;
            void audio.play()?.catch?.(() => {});
        } catch (_) { /* Sound is optional; the ring is always visual. */ }
    }
    function stop() {
        if (!audio) return;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
    }
    return { play, stop };
}

export function createRingback({ onBlocked = () => {} } = {}) {
    let context = null, buffer = null, source = null, gain = null;
    function prepare() {
        const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!context && Audio) {
            try { context = new Audio(); } catch { return; }
        }
        // Called synchronously from the outgoing call gesture, before network awaits.
        if (context) void context.resume().catch(() => {});
    }
    async function resume() {
        const active = context;
        if (!active) return;
        await active.resume();
        if (context === active && source && active.state !== 'running') throw new Error('Audio playback needs a tap.');
    }
    function play() {
        try {
            if (source) return;
            if (!context) { onBlocked(); return; }
            if (!buffer) {
                buffer = context.createBuffer(1, RINGBACK_SAMPLE_RATE * RINGBACK_DURATION, RINGBACK_SAMPLE_RATE);
                buffer.copyToChannel(ringbackSamples(), 0);
            }
            gain = context.createGain(); gain.gain.value = RINGBACK_VOLUME;
            source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
            source.connect(gain).connect(context.destination); source.start();
            const playing = source;
            void resume().catch(() => { if (source === playing) onBlocked(); });
        } catch { stop(); onBlocked(); }
    }
    function stop() {
        if (source) { try { source.stop(); } catch {} source.disconnect(); }
        gain?.disconnect(); source = null; gain = null;
    }
    function dispose() {
        stop();
        const closing = context; context = null; buffer = null;
        if (closing) void closing.close().catch(() => {});
    }
    return { prepare, resume, play, stop, dispose };
}
