// Shared hand-motion-v1 mechanics from Six7 games/src/hand-camera.mjs.
// The web host runs this reviewed implementation; downloaded code is never evaluated.
export function createCameraGame() {
    let rules, score, stepIndex, heldSince, previousTargets, lastTime, direction;
    const matches = (target, row) => {
        const offset = target.hand === 'screen_left' ? 1 : 3;
        return row[offset] >= target.x_min && row[offset] <= target.x_max && row[offset + 1] >= target.y_min && row[offset + 1] <= target.y_max;
    };
    const state = () => ({ score, prompt: rules.game.steps[stepIndex]?.prompt ?? '', targets: rules.game.steps[stepIndex]?.targets ?? [] });
    return {
        start(input) {
            if (input.protocol !== 1) throw new Error('Unsupported camera bridge');
            rules = input.rules; score = stepIndex = direction = 0;
            heldSince = previousTargets = lastTime = null;
            return state();
        },
        frame({ samples }) {
            for (const row of samples) {
                const gap = lastTime !== null && row[0] - lastTime > 400;
                lastTime = row[0];
                if (rules.game.mechanic === 'height_crossings') {
                    if (gap || row.length !== 5) direction = 0;
                    if (row.length !== 5) continue;
                    if (row[3] - row[1] <= 1200) { direction = 0; continue; }
                    const threshold = Math.max(150, Math.floor((row[3] - row[1]) * 3 / 100));
                    const difference = row[2] - row[4];
                    const next = difference > threshold ? 1 : difference < -threshold ? -1 : 0;
                    if (next !== 0) { if (direction !== 0 && next !== direction) score++; direction = next; }
                    continue;
                }
                if (gap) heldSince = null;
                if (row.length !== 5 || row[3] - row[1] <= 1200) { heldSince = null; continue; }
                if (previousTargets) {
                    if (previousTargets.every(t => matches(t, row))) continue;
                    previousTargets = null;
                }
                const step = rules.game.steps[stepIndex];
                if (!step.targets.every(t => matches(t, row))) { heldSince = null; continue; }
                if (heldSince === null) heldSince = row[0];
                if (row[0] - heldSince >= step.hold_ms) {
                    if (rules.game.mechanic !== 'pose_cycle' || stepIndex === rules.game.steps.length - 1) score++;
                    previousTargets = step.targets;
                    stepIndex = (stepIndex + 1) % rules.game.steps.length;
                    if (rules.game.mechanic === 'pose_cycle' && stepIndex === 0) stepIndex = 1;
                    heldSince = null;
                }
            }
            return state();
        },
    };
}

// Keep capture timestamps, including late replies. A UI tick never creates evidence.
export class CameraEvidence {
    constructor(duration) { this.duration = duration; this.samples = []; this.lastSeen = null; this.lastSource = -Infinity; this.needsBreak = false; }
    append(ms, pair, hardBreak = false) {
        if (!Number.isFinite(ms) || ms < 0 || ms >= this.duration * 1000 || ms <= this.lastSource) return null;
        this.lastSource = ms;
        if (hardBreak) { this.needsBreak = true; this.lastSeen = null; }
        ms = Math.round(ms);
        if (ms >= this.duration * 1000 || ms - (this.samples.at(-1)?.[0] ?? -30) < 30 || this.samples.length >= 2001) return null;
        let row = [ms];
        if (this.needsBreak) { this.needsBreak = false; this.lastSeen = null; }
        else if (Array.isArray(pair) && pair.length === 4 && pair.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) {
            this.lastSeen = ms; row.push(...pair.map(v => Math.round(v * 10000)));
        } else {
            if (this.lastSeen !== null && ms - this.lastSeen < 300) return null;
            if (this.samples.at(-1)?.length === 1) return null;
        }
        this.samples.push(row); return row;
    }
    get payload() { return { frames: this.duration * 60, samples: this.samples }; }
}
