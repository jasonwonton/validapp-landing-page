// Which weekly releases this web player can actually run. The Feed entry uses
// this before showing the game, and the players re-validate everything (rules,
// byte size and SHA-256 of the download) before playing.
import { WEB_PACKAGE } from './web-assets.js';

// Public CDN package responses lack browser CORS headers, so only packages
// mirrored on the PWA origin (hash-verified, unmodified) can be downloaded.
export const MIRRORED_PACKAGES = new Set(['75eeb783b361dfbf063465a6b87aac862db76831d31aeab601488d2b2e8cfa46']);
// Reviewed hand-package-v1 mechanics. The web player reimplements them and
// never runs package code, so an unknown script means an unsupported game.
export const SCRIPT_HASHES = new Set(['b05b1f7576b857ed281e12f89270844846475dc99cc0a0fead717adf5a457560']);

export function webPlayable(release) {
    if (!release || !/^[a-f0-9]{64}$/.test(release.id || '') || release.renderer_version !== 1) return false;
    if (release.runtime === 'camera-v1') {
        // hand-package-v2 (sandboxed package scripts, hands tracking) is iOS-only;
        // the server substitutes an update notice for clients that lack it.
        return release.camera_mode === 'hand-package-v1' && release.score_validator === 'hand-motion-v1'
            && MIRRORED_PACKAGES.has(release.bundle?.sha256);
    }
    if (release.runtime === 'web-v1') {
        // Update notices (update-required-v1), touch games (self-reported-v1) and
        // unranked games all arrive as web-v1 but only Rose Flight runs here.
        return release.game_id === 'rose-flight' && release.score_validator === 'rose-flight-endless-v1'
            && release.bundle?.sha256 === WEB_PACKAGE.sha256 && release.bundle?.byte_size === WEB_PACKAGE.byteSize;
    }
    return false;
}
