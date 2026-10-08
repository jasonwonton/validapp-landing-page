// hand-package-v2 host: the reviewed package script runs in an opaque-origin
// sandbox frame (see scripts/weekly-game/build-camera-host.mjs) and talks JSON
// only. Mirrors iOS CameraPackageEngine: one call in flight, at most ten new
// evidence rows per call, every response bounded and checked before use.
const bridge = 'valid-weekly-camera';
export const MAX_SPRITES = 96, MAX_SPRITE_IMAGES = 64, MAX_SPRITE_LEAD = .25, MIN_SPRITE_ALPHA = .03;
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** `[key, x, y, size‰, degrees, alpha%]`, optionally `vx, vy, ay, spin`, as iOS CameraGameSprite. */
export function parseSprite(fields) {
    if (!Array.isArray(fields) || ![6, 10].includes(fields.length) || typeof fields[0] !== 'string' || !/^[a-z0-9_]{1,32}$/.test(fields[0])) return null;
    const [key, x, y, size, degrees, alpha, vx = 0, vy = 0, ay = 0, spin = 0] = fields;
    if (!int(x, -5000, 15000) || !int(y, -5000, 15000) || !int(size, 10, 1500) || !int(degrees, -3600, 3600) || !int(alpha, 0, 100)) return null;
    if (fields.length === 10 && (![vx, vy, ay].every(v => int(v, -100000, 100000)) || !int(spin, -7200, 7200))) return null;
    return { key, x: x / 10000, y: y / 10000, width: size / 1000, rotation: degrees * Math.PI / 180, alpha: alpha / 100, vx: vx / 10000, vy: vy / 10000, ay: ay / 10000, spin: spin * Math.PI / 180 };
}

/** Where a sprite is `seconds` after the package placed it (never more than 0.25 s ahead). */
export function advanceSprite(sprite, seconds) {
    const t = Math.min(MAX_SPRITE_LEAD, Math.max(0, seconds || 0));
    if (!t || (!sprite.vx && !sprite.vy && !sprite.ay && !sprite.spin)) return sprite;
    return { ...sprite, x: sprite.x + sprite.vx * t, y: sprite.y + sprite.vy * t + .5 * sprite.ay * t * t, rotation: sprite.rotation + sprite.spin * t };
}

const validTarget = t => t && ['screen_left', 'screen_right'].includes(t.hand) && ['x_min', 'x_max', 'y_min', 'y_max'].every(k => int(t[k], 0, 10000)) && t.x_min < t.x_max && t.y_min < t.y_max;

/** Accept a start/frame response only if it matches the native host's bounds. */
export function parseOutput(text, previousScore = 0) {
    if (typeof text !== 'string' || text.length > 16384) return null;
    let state; try { state = JSON.parse(text); } catch (_) { return null; }
    if (!state || !int(state.score, previousScore, Math.min(10000, previousScore + 10)) || typeof state.prompt !== 'string' || state.prompt.length > 48) return null;
    if (!Array.isArray(state.targets) || state.targets.length > 2 || !state.targets.every(validTarget)) return null;
    const raw = state.sprites ?? [];
    if (!Array.isArray(raw) || raw.length > MAX_SPRITES) return null;
    const sprites = raw.map(parseSprite);
    if (sprites.some(s => !s)) return null;
    const haptic = ['light', 'success', 'error'].includes(state.haptic) ? state.haptic : null;
    return { score: state.score, prompt: state.prompt, targets: state.targets, sprites, haptic };
}

/** Decode the package's one-time sprite sheet (PNG data URLs) like iOS decodeSpriteSheet. */
export async function decodeSpriteSheet(text) {
    const images = new Map();
    if (typeof text !== 'string' || text.length > 12000000) return images;
    let sheet; try { sheet = JSON.parse(text); } catch (_) { return images; }
    if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet) || Object.keys(sheet).length > MAX_SPRITE_IMAGES) return images;
    await Promise.all(Object.entries(sheet).map(async ([key, value]) => {
        if (!/^[a-z0-9_]{1,32}$/.test(key) || typeof value !== 'string' || value.length > 1500000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)) return;
        try {
            const image = new Image(); image.src = value; await image.decode();
            if (image.naturalWidth && image.naturalWidth <= 1024 && image.naturalHeight <= 1024) images.set(key, image);
        } catch (_) { /* A broken sprite is skipped, as on iOS. */ }
    }));
    return images;
}

export class CameraPackageSandbox {
    constructor({ host, rules, duration, container = document.body, onChange = () => {}, onHaptic = () => {} }) {
        this.host = host; this.container = container; this.rules = rules; this.duration = duration; this.onChange = onChange; this.onHaptic = onHaptic;
        this.pending = new Map(); this.nextId = 1; this.spriteImages = new Map(); this.generation = 0;
        this.message = this.message.bind(this); this.resetRound();
    }
    get hasPendingSamples() { return this.inFlight || this.sentCount < this.rows.length; }
    load(signal) {
        this.token = crypto.randomUUID();
        const frame = document.createElement('iframe');
        frame.className = 'weekly-game-sandbox'; frame.title = 'Game logic'; frame.tabIndex = -1;
        frame.setAttribute('aria-hidden', 'true'); frame.setAttribute('sandbox', 'allow-scripts');
        frame.setAttribute('referrerpolicy', 'no-referrer'); frame.setAttribute('allow', '');
        frame.src = `${this.host}#${this.token}`;
        this.frame = frame; window.addEventListener('message', this.message);
        const loaded = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('This game took too long to load. Check your connection and retry.')), 20000);
            const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
            signal?.addEventListener('abort', abort, { once: true });
            this.readyResolve = ok => { clearTimeout(timer); signal?.removeEventListener('abort', abort); ok ? resolve() : reject(new Error('This game could not start. Please retry.')); };
        });
        this.container.append(frame);
        return loaded.then(async () => {
            // Packages draw their sprite art once, up front, from rules.game.
            const sheet = await this.call('sprites', this.rules.game ?? {}, 10000);
            this.spriteImages = await decodeSpriteSheet(sheet);
            this.loaded = true;
        });
    }
    message(event) {
        const m = event.data;
        if (!this.frame || event.source !== this.frame.contentWindow || m?.bridge !== bridge || m.token !== this.token) return;
        if (m.type === 'ready') { this.readyResolve?.(m.loaded === true); this.readyResolve = null; return; }
        const call = this.pending.get(m.id); if (!call) return;
        this.pending.delete(m.id); clearTimeout(call.timer);
        if (m.type === 'result' && typeof m.value === 'string') call.resolve(m.value); else call.reject(new Error('This game stopped responding. Please try again.'));
    }
    call(type, payload, timeout = 2000) {
        return new Promise((resolve, reject) => {
            if (!this.frame?.contentWindow) { reject(new Error('This game stopped responding. Please try again.')); return; }
            const id = this.nextId++;
            // Same budget as iOS: a call taking over two seconds fails the round.
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('This game stopped responding. Please try again.')); }, timeout);
            this.pending.set(id, { resolve, reject, timer });
            this.frame.contentWindow.postMessage({ bridge, token: this.token, id, type, payload }, '*');
        });
    }
    resetRound() {
        this.generation++; this.inFlight = false; this.rows = []; this.sentCount = 0; this.hands = []; this.pendingTime = 0;
        this.state = { score: 0, prompt: '', targets: [], sprites: [] }; this.spriteTime = 0; this.ready = false; this.error = null; this.lastHaptic = -Infinity;
    }
    /** Start a round (iOS reset → start). Resolves once the package answered. */
    async start(seed) {
        this.resetRound(); const generation = this.generation; this.inFlight = true;
        const tracking = this.rules.camera_tracking ?? { version: 1, sample_rate_hz: 30, profile: 'responsive' };
        try {
            const next = parseOutput(await this.call('start', { protocol: 1, seed, rules: this.rules, tracking }), 0);
            if (generation !== this.generation) return;
            if (!next) throw new Error('This game stopped responding. Please try again.');
            this.inFlight = false; this.apply(next, 0); this.ready = true; this.dispatch();
        } catch (error) { if (generation === this.generation) this.fail(error); }
    }
    /** One tracker observation: its evidence row (if kept) and every detected wrist. */
    observe(row, hands, elapsedMs) {
        if (this.error || !Number.isFinite(elapsedMs) || elapsedMs < 0) return;
        if (row) this.rows.push(row);
        if (elapsedMs < this.duration * 1000 && hands.length <= 4) {
            this.hands.push([Math.round(elapsedMs), hands.length / 2, ...hands.map(v => Math.round(Math.min(1, Math.max(0, v)) * 10000))]);
            if (this.hands.length > 16) this.hands.splice(0, this.hands.length - 16);
        }
        this.pendingTime = Math.max(this.pendingTime, Math.min(this.duration * 1000, Math.round(elapsedMs)));
        this.dispatch();
    }
    /** Drain evidence the package hasn't seen yet (reaction/finishing). */
    flush() { if (this.sentCount < this.rows.length) this.dispatch(); }
    dispatch() {
        if (!this.ready || this.inFlight || this.error) return;
        const samples = this.rows.slice(this.sentCount, this.sentCount + 10);
        this.sentCount += samples.length;
        const hands = this.hands; this.hands = [];
        const time = this.pendingTime, generation = this.generation; this.inFlight = true;
        this.call('frame', { elapsed_ms: time, samples, hands }).then(text => {
            if (generation !== this.generation) return;
            const next = parseOutput(text, this.state.score);
            if (!next) throw new Error('This game stopped responding. Please try again.');
            this.inFlight = false; this.apply(next, time / 1000);
            // Drain immediately after acknowledgement so UI timing can't strand evidence.
            if (this.sentCount < this.rows.length) this.dispatch();
        }).catch(error => { if (generation === this.generation) this.fail(error); });
    }
    apply(next, time) {
        const scored = next.score > this.state.score;
        this.state = next; this.spriteTime = time;
        const now = performance.now();
        if (next.haptic && now - this.lastHaptic > 120) { this.lastHaptic = now; this.onHaptic(next.haptic); }
        this.onChange(this.state, scored);
    }
    fail(error) { this.inFlight = false; this.ready = false; this.error = error?.message || 'This game stopped responding. Please try again.'; this.onChange(this.state, false); }
    close() {
        this.generation++; window.removeEventListener('message', this.message);
        for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(new DOMException('Closed', 'AbortError')); }
        this.pending.clear(); this.readyResolve = null; this.frame?.remove(); this.frame = null; this.spriteImages = new Map();
    }
}
