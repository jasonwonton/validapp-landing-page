// The game home, ported from iOS EasterEggGameView: artwork, title, Best /
// Rank, Play, then the Friend Leaderboard (medals, "(you)", your row pinned).
// Opening it never starts a round; Play does, and closing a round comes back
// here with the leaderboard refreshed. A game this browser can't host shows
// where to play it instead of Play.
import { mediaImageMarkup } from '../media-url.js';
import { userMessage } from '../user-message.js';
import { uiIcon } from '../ui-icons.js';

const APP_STORE_URL = 'https://apps.apple.com/us/app/valid-compliment-classmates/id6755367062';
const MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const artwork = url => { try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === 'validappcdn.com' && u.pathname.startsWith('/games/art/') ? u.href : null; } catch (_) { return null; } };

// EasterEggGameArtwork, as far as the web has the art: the release artwork,
// the 67 cat, the Rose Flight rose, else a sparkle.
export function gameArtMarkup(release, size) {
    const art = artwork(release?.artwork_url || '');
    const attributes = `width="${size}" height="${size}"`;
    if (release?.game_id === 'rose-flight') return `<img class="weekly-game-art-image" src="/assets/weekly-game/rose.png" alt="" ${attributes} decoding="async">`;
    if (art) return mediaImageMarkup(art, { alt: '', className: 'weekly-game-art-image', loading: 'eager', attributes });
    if (release?.game_id === '67-challenge') return '<span class="weekly-game-art-text">67</span>';
    return `<span class="weekly-game-art-symbol">${uiIcon('sparkles')}</span>`;
}

// A closing home steps back through history; a new one must not push its
// entry until that step lands, or the late popstate would close it.
let historyStep = Promise.resolve();
function stepBack() {
    historyStep = new Promise(resolve => {
        const done = () => { window.removeEventListener('popstate', done); clearTimeout(timer); resolve(); };
        const timer = setTimeout(done, 600);
        window.addEventListener('popstate', done);
        history.back();
    });
}

const home = release => release?.home && typeof release.home === 'object' ? release.home : {};
const showsScore = release => home(release).score !== false;
const showsLeaderboard = release => home(release).leaderboard !== false && release?.score_validator !== 'unranked-v1';

/**
 * options: { api, playable(release) -> boolean, onPlay(release) -> Promise, onClose() }
 */
export function createGameHome({ api, playable, onPlay, onClose = () => {} }) {
    let dialog = null, release = null, abort = null, generation = 0, hadHistory = false, starting = false, board = null, opening = 0;
    const el = selector => dialog?.querySelector(selector);

    function close(fromHistory = false) {
        opening++;
        if (!dialog) return;
        generation++; abort?.abort();
        const old = dialog; dialog = null; old.close(); old.remove();
        window.removeEventListener('popstate', popstate); window.removeEventListener('pagehide', pagehide);
        if (!fromHistory && hadHistory && history.state?.weeklyGame) stepBack();
        hadHistory = false; onClose();
    }
    // A round's own entry sits above this one; going back to it keeps the home.
    const popstate = () => { if (!history.state?.weeklyGame) close(true); };
    const pagehide = () => close(true);

    function render() {
        if (!dialog) return;
        const canPlay = playable(release);
        el('[data-home-art]').innerHTML = gameArtMarkup(release, 80);
        el('[data-home-title]').textContent = release?.title || 'Game of the Week';
        const stats = el('[data-home-stats]');
        if (!showsScore(release)) stats.hidden = true;
        else if (release?.score_validator === 'unranked-v1') { stats.hidden = false; stats.innerHTML = '<p class="weekly-game-home-note">Just for fun this week · No scores or leaderboard</p>'; }
        else if (board) {
            stats.hidden = false;
            stats.innerHTML = `<div><strong>${Number(board.personal_best || 0).toLocaleString()}</strong><small>Best</small></div><div><strong>${board.me?.rank ? `#${board.me.rank}` : '—'}</strong><small>Rank</small></div>`;
        } else stats.hidden = true;
        const play = el('[data-play]');
        play.hidden = !canPlay;
        play.disabled = starting;
        play.textContent = starting ? 'Getting ready…' : 'Play';
        const appOnly = el('[data-app-only]');
        appOnly.hidden = canPlay;
        if (!canPlay) {
            appOnly.querySelector('p').textContent = isIOS()
                ? 'Play this week’s game in the Valid app. Scores there count for your leaderboard.'
                : 'This week’s game is only in the Valid iPhone app for now.';
            appOnly.querySelector('a').hidden = !isIOS();
        }
        const section = el('[data-home-leaderboard]');
        section.hidden = !showsLeaderboard(release);
        if (section.hidden) return;
        const list = el('[data-ranking-list]');
        list.replaceChildren();
        if (!board) return;
        const me = String(api.user?.id || board.me?.user_id || '');
        const row = (entry, pinned = false) => {
            const li = document.createElement('li');
            li.className = `weekly-game-rank-row${String(entry.user_id || '') === me && me ? ' me' : ''}${pinned ? ' pinned' : ''}`;
            const rank = document.createElement('span'); rank.className = 'weekly-game-rank';
            rank.textContent = entry.rank >= 1 && entry.rank <= 3 ? MEDALS[entry.rank - 1] : `#${entry.rank}`;
            const name = document.createElement('span'); name.className = 'weekly-game-rank-name';
            name.textContent = String(entry.user_id || '') === me && me ? `${entry.name} (you)` : String(entry.name || '');
            const score = document.createElement('strong'); score.textContent = String(entry.score ?? 0);
            li.append(rank, name, score);
            return li;
        };
        const entries = (board.entries || []).slice(0, 100);
        if (!entries.length) {
            const empty = document.createElement('li'); empty.className = 'weekly-game-rank-empty'; empty.textContent = 'Set the first score.';
            list.append(empty);
        }
        for (const entry of entries) list.append(row(entry));
        if (board.me && !entries.some(entry => String(entry.user_id) === String(board.me.user_id))) {
            const divider = document.createElement('li'); divider.className = 'weekly-game-rank-divider'; divider.setAttribute('aria-hidden', 'true');
            list.append(divider, row(board.me, true));
        }
    }

    async function refresh() {
        if (!dialog || !release || !showsLeaderboard(release) && !showsScore(release)) { render(); return; }
        const current = ++generation;
        el('[data-home-error]').hidden = true;
        el('[data-home-loading]').hidden = Boolean(board);
        try {
            let result = await api.getWeeklyGameLeaderboard(release.id, { signal: abort.signal });
            if (current !== generation || !dialog) return;
            // The leaderboard needs its one-time discovery record; this never starts a run.
            if (result?.unlocked === false && api.unlockWeeklyGame) {
                await api.unlockWeeklyGame({ signal: abort.signal });
                if (current !== generation || !dialog) return;
                result = await api.getWeeklyGameLeaderboard(release.id, { signal: abort.signal });
                if (current !== generation || !dialog) return;
            }
            board = result || { entries: [] };
        } catch (error) {
            if (current !== generation || !dialog || error?.name === 'AbortError') return;
            el('[data-home-error]').hidden = false;
            el('[data-home-error] p').textContent = userMessage(error, 'Could not load the leaderboard.');
        } finally {
            if (current === generation && dialog) el('[data-home-loading]').hidden = true;
        }
        render();
    }

    async function play() {
        if (!dialog || starting || !playable(release)) return;
        starting = true; render();
        try { await onPlay(release); }
        catch (error) { if (dialog) { el('[data-home-error]').hidden = false; el('[data-home-error] p').textContent = userMessage(error, 'Could not open the game.'); } }
        finally { starting = false; render(); }
    }

    async function open(nextRelease) {
        close();
        const current = ++opening;
        await historyStep;
        if (current !== opening) return;
        release = nextRelease; board = null; abort = new AbortController();
        dialog = document.createElement('dialog');
        dialog.className = 'weekly-game-dialog weekly-game-home';
        dialog.setAttribute('aria-label', 'Game of the Week');
        dialog.innerHTML = `<header class="weekly-game-home-toolbar"><span></span><button type="button" data-done>Done</button></header>
        <div class="weekly-game-home-content">
            <div class="weekly-game-home-art" data-home-art></div>
            <h1 data-home-title></h1>
            <div class="weekly-game-home-stats" data-home-stats hidden></div>
            <button class="primary-button weekly-game-home-play" type="button" data-play>Play</button>
            <div class="weekly-game-home-app-only" data-app-only hidden><p></p><a class="primary-button" href="${APP_STORE_URL}" hidden>Open Valid in the App Store</a></div>
            <div class="weekly-game-home-error" data-home-error hidden><p></p><button type="button" data-home-retry>Retry leaderboard</button></div>
            <section class="weekly-game-home-leaderboard" data-home-leaderboard>
                <h2>Friend Leaderboard</h2>
                <span class="weekly-game-home-loading" data-home-loading role="status" aria-label="Loading leaderboard"></span>
                <ol data-ranking-list></ol>
            </section>
        </div>`;
        document.body.append(dialog); dialog.showModal();
        history.pushState({ ...history.state, weeklyGame: true }, ''); hadHistory = true;
        el('[data-done]').onclick = () => close();
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        el('[data-play]').onclick = () => void play();
        el('[data-home-retry]').onclick = () => void refresh();
        window.addEventListener('popstate', popstate); window.addEventListener('pagehide', pagehide);
        render();
        void refresh();
        el('[data-play]').focus({ preventScroll: true });
    }

    return { open, close, play, refresh, isOpen: () => Boolean(dialog) };
}
