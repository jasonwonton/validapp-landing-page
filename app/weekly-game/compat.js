// Which weekly releases this web player can actually run. The Feed entry uses
// this before showing the game, and the players re-validate everything (rules,
// byte size and SHA-256 of the download) before playing.
import { WEB_PACKAGE } from './web-assets.js';
import { CAMERA_HOSTS } from './camera-hosts.js';

// Public CDN package responses lack browser CORS headers, so only packages
// mirrored on the PWA origin (hash-verified, unmodified) can be downloaded.
export const MIRRORED_PACKAGES = new Set(['75eeb783b361dfbf063465a6b87aac862db76831d31aeab601488d2b2e8cfa46', ...Object.keys(CAMERA_HOSTS)]);
// Reviewed hand-package-v1 mechanics. The web player reimplements them and
// never runs package code, so an unknown script means an unsupported game.
export const SCRIPT_HASHES = new Set(['b05b1f7576b857ed281e12f89270844846475dc99cc0a0fead717adf5a457560']);
// Camera modes this player can host; sent as X-Easter-Egg-Camera-Modes. For a
// mode missing here the server substitutes its update notice.
export const CAMERA_MODES = ['hand-package-v1', 'hand-package-v2'];

const releaseShape = release => Boolean(release) && /^[a-f0-9]{64}$/.test(release.id || '') && release.renderer_version === 1;
const webTracking = rules => {
    const tracking = rules?.camera_tracking;
    // The web tracker follows wrists; the iOS-only "hands" profile follows hand centres.
    return tracking === undefined || ['responsive', 'balanced'].includes(tracking?.profile);
};

export function webPlayable(release) {
    if (!releaseShape(release)) return false;
    if (release.runtime === 'camera-v1') {
        if (release.camera_mode === 'hand-package-v1') return release.score_validator === 'hand-motion-v1' && MIRRORED_PACKAGES.has(release.bundle?.sha256);
        // hand-package-v2 scripts run in a prebuilt sandbox host, which exists
        // only for reviewed, mirrored packages.
        return release.camera_mode === 'hand-package-v2' && release.score_validator === 'self-reported-v1'
            && Number.isInteger(release.max_score) && Boolean(CAMERA_HOSTS[release.bundle?.sha256]) && webTracking(release.rules);
    }
    if (release.runtime === 'web-v1') {
        // Update notices (update-required-v1), touch games (self-reported-v1) and
        // unranked games all arrive as web-v1 but only Rose Flight runs here.
        return release.game_id === 'rose-flight' && release.score_validator === 'rose-flight-endless-v1'
            && release.bundle?.sha256 === WEB_PACKAGE.sha256 && release.bundle?.byte_size === WEB_PACKAGE.byteSize;
    }
    return false;
}

// 'play' when this player runs the release; 'app-only' for a real weekly game
// it can't run yet (the Feed still shows it, with a friendly iOS-app state and
// the leaderboard); null for nothing to show, including the server's generic
// update notice, which names no game.
export function weeklyGameEntry(release) {
    if (webPlayable(release)) return 'play';
    if (!releaseShape(release) || typeof release.title !== 'string' || !release.title.trim()) return null;
    if (release.runtime === 'camera-v1') return 'app-only';
    if (release.runtime === 'web-v1' && release.score_validator !== 'update-required-v1' && release.game_id !== 'update-required') return 'app-only';
    return null;
}
