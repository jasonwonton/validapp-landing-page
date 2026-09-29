// Public CDN package responses currently lack browser CORS headers. Serve the
// exact hash-verified selected package from the PWA origin without modifying it.
const MIRRORED_PACKAGES = new Set(['75eeb783b361dfbf063465a6b87aac862db76831d31aeab601488d2b2e8cfa46']);
const SCRIPT_HASHES = new Set(['b05b1f7576b857ed281e12f89270844846475dc99cc0a0fead717adf5a457560']);
const bounded = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const fail = () => { throw new Error('This weekly game needs a newer web player. Please try again after updating Valid.'); };
export async function sha256(bytes) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
}
export function validateRelease(release) {
    if (!release || !/^[a-f0-9]{64}$/.test(release.id) || release.runtime !== 'camera-v1' || release.camera_mode !== 'hand-package-v1' || release.score_validator !== 'hand-motion-v1' || release.renderer_version !== 1) fail();
    const r = release.rules;
    if (!r || !bounded(r.duration_seconds,10,55) || !bounded(r.countdown_seconds,3,10) || !bounded(r.reaction_seconds,3,5)) fail();
    if (!['height_crossings','pose_sequence','pose_cycle'].includes(r.game?.mechanic) || !Array.isArray(r.game.steps) || r.game.steps.length > 16) fail();
    if (r.game.mechanic !== 'height_crossings' && (!r.game.steps.length || (r.game.mechanic === 'pose_cycle' && r.game.steps.length < 2))) fail();
    for (const step of r.game.steps) {
        if (!bounded(step.hold_ms,0,3000) || typeof step.prompt !== 'string' || step.prompt.length > 80 || !Array.isArray(step.targets) || !step.targets.length || step.targets.length > 2) fail();
        for (const t of step.targets) if (!['screen_left','screen_right'].includes(t.hand) || !['x_min','x_max','y_min','y_max'].every(k => bounded(t[k],0,10000)) || t.x_min >= t.x_max || t.y_min >= t.y_max) fail();
    }
    if (r.camera_tracking && (r.camera_tracking.version !== 1 || ![15,20,30].includes(r.camera_tracking.sample_rate_hz) || !['responsive','balanced'].includes(r.camera_tracking.profile))) fail();
    return release;
}
export async function verifyPackage(release, bytes) {
    validateRelease(release);
    if (bytes.byteLength !== release.bundle.byte_size || await sha256(bytes) !== release.bundle.sha256) throw new Error('The game download was incomplete. Please retry.');
    const pkg = JSON.parse(new TextDecoder().decode(bytes));
    if (pkg.format !== 1 || typeof pkg.script !== 'string' || !SCRIPT_HASHES.has(await sha256(new TextEncoder().encode(pkg.script)))) fail();
    // Known script hash binds the reviewed mechanics. Artwork/rules can rotate
    // independently; unknown executable code cannot enter the authenticated page.
    const assets = {};
    for (const [name, value] of Object.entries(pkg.assets || {})) {
        if (/^[a-zA-Z0-9_-]{1,40}$/.test(name) && typeof value === 'string' && value.length <= 2800000 && /^data:(image\/(png|jpeg|gif)|audio\/(mp4|mpeg));base64,[A-Za-z0-9+/=]+$/.test(value)) assets[name] = value;
    }
    return { assets, presentation: pkg.camera_presentation?.version === 1 ? pkg.camera_presentation : {} };
}
export async function downloadPackage(release, signal) {
    validateRelease(release);
    const bundle = release.bundle;
    if (!bundle || !bounded(bundle.byte_size,1,4000000) || !/^[a-f0-9]{64}$/.test(bundle.sha256)) fail();
    const url = new URL(bundle.url);
    if (url.protocol !== 'https:' || url.hostname !== 'validappcdn.com' || !url.pathname.startsWith('/games/') || url.username || url.password) fail();
    const downloadURL = MIRRORED_PACKAGES.has(bundle.sha256) ? `/assets/weekly-game/packages/${bundle.sha256}.six7game.json` : url;
    const response = await fetch(downloadURL, {signal, credentials:'omit', redirect:'error', cache:'force-cache'});
    if (!response.ok) throw new Error('Could not download this week’s game. Check your connection and retry.');
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try { for (;;) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > bundle.byte_size) throw new Error('Game download size did not match.'); chunks.push(value); } }
    finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset=0; for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
    return verifyPackage(release, bytes);
}
