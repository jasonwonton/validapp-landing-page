// Hold gestures never send: release produces a preview; left cancels; up locks.
// A normal click/keyboard activation remains the accessible toggle fallback.
export function bindVoiceGesture(button, { canStart, begin, recording, stop, discard, hint }) {
    let press = null, timer = null, suppressUntil = 0;
    const clear = () => { clearTimeout(timer); timer = null; press = null; hint(''); };
    button.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !canStart()) return;
        press = { id: event.pointerId, x: event.clientX, y: event.clientY, held: false, locked: false, pending: false };
        const active = press;
        timer = setTimeout(async () => {
            timer = null;
            if (press !== active) return;
            active.held = true; active.pending = true; suppressUntil = Date.now() + 1500;
            try { button.setPointerCapture(active.id); } catch { /* Pointer may have left while permission UI opened. */ }
            hint('Slide left to cancel · Up to lock');
            await begin(); active.pending = false;
            if (press === active && !recording()) clear();
            else if (press === active) hint(active.locked ? 'Recording locked' : 'Slide left to cancel · Up to lock');
        }, 250);
    });
    button.addEventListener('pointermove', event => {
        if (!press?.held || event.pointerId !== press.id || press.locked) return;
        if (event.clientX - press.x < -80) { suppressUntil = Date.now() + 1500; clear(); discard(); }
        else if (event.clientY - press.y < -64) { press.locked = true; hint('Recording locked'); }
    });
    button.addEventListener('pointerup', event => {
        if (!press || event.pointerId !== press.id) return;
        const active = press; clearTimeout(timer); timer = null;
        if (active.held) {
            suppressUntil = Date.now() + 1500;
            if (!active.locked) { if (active.pending) discard(); else stop(); }
            hint(active.locked ? 'Recording locked' : '');
        }
        press = null;
    });
    button.addEventListener('pointercancel', () => { const held = press?.held; clear(); if (held) discard(); });
    button.addEventListener('click', event => {
        if (Date.now() < suppressUntil && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    return { reset: clear };
}

export function createVoiceWaveform(canvas) {
    let context, source, analyser, frame;
    const samples = new Float32Array(48);
    function draw() {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffb15e';
        samples.forEach((sample, index) => {
            const height = Math.max(3, sample * canvas.height);
            ctx.fillRect(index * canvas.width / samples.length, (canvas.height - height) / 2, 3, height);
        });
    }
    function stop() {
        cancelAnimationFrame(frame); frame = null;
        source?.disconnect(); analyser?.disconnect();
        void context?.close().catch(() => {}); context = source = analyser = null;
    }
    function start(stream) {
        stop(); samples.fill(0); draw();
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        try {
            context = new AudioContext(); source = context.createMediaStreamSource(stream);
            analyser = context.createAnalyser(); analyser.fftSize = 256; source.connect(analyser);
            void context.resume().catch(() => {});
            const values = new Uint8Array(256); let last = 0;
            function tick(now) {
                if (!analyser) return;
                if (now - last >= 70) {
                    analyser.getByteTimeDomainData(values);
                    let energy = 0; for (const value of values) energy += ((value - 128) / 128) ** 2;
                    samples.copyWithin(0, 1); samples[samples.length - 1] = Math.min(1, Math.sqrt(energy / values.length) * 4);
                    draw(); last = now;
                }
                frame = requestAnimationFrame(tick);
            }
            frame = requestAnimationFrame(tick);
        } catch { stop(); } // Recording still works if visualization is unavailable.
    }
    return { start, stop, reset() { stop(); samples.fill(0); draw(); } };
}
