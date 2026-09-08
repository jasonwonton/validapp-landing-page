// Port of iOS CallRingbackSoundPlayer (CallCoordinator.swift).
// Local playback only: never connect this buffer to the microphone/published stream.
export const RINGBACK_SAMPLE_RATE = 48000;
export const RINGBACK_DURATION = 3.6;
export const RINGBACK_VOLUME = 0.48;

export function ringbackSamples() {
    const samples = new Float32Array(RINGBACK_SAMPLE_RATE * RINGBACK_DURATION);
    const notes = [[0, 659.25, .34], [.24, 783.99, .34], [.50, 987.77, .48]];
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
