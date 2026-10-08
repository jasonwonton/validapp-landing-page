// A real weekly game this web player can't run yet: show what it is, where to
// play it, and the school leaderboard, instead of hiding the Game of the Week.
import { mediaImageMarkup } from '../media-url.js';
import { userMessage } from '../user-message.js';

const APP_STORE_URL = 'https://apps.apple.com/us/app/valid-compliment-classmates/id6755367062';
const cssURL = new URL('./styles.css', import.meta.url).href;
const artwork = url => { try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === 'validappcdn.com' && u.pathname.startsWith('/games/art/') ? u.href : null; } catch (_) { return null; } };
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

export function createUnavailableGame({ api, onClose = () => {} }) {
    let dialog, release, abort, hadHistory = false, generation = 0;
    const el = selector => dialog.querySelector(selector);
    const show = (selector, visible) => { el(selector).hidden = !visible; };
    const status = message => { if (dialog) el('[data-status]').textContent = message; };
    function close(fromHistory = false) {
        if (!dialog) return;
        generation++; abort?.abort();
        const old = dialog; dialog = null; old.close(); old.remove();
        window.removeEventListener('popstate', popstate); window.removeEventListener('pagehide', pagehide);
        if (!fromHistory && hadHistory && history.state?.weeklyGame) history.back();
        hadHistory = false; onClose();
    }
    const popstate = () => close(true), pagehide = () => close(true);
    async function open(featured) {
        close();
        if (!document.querySelector('link[data-weekly-game-css]')) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = cssURL; link.dataset.weeklyGameCss = ''; document.head.append(link); }
        abort = new AbortController(); release = featured.release;
        dialog = document.createElement('dialog'); dialog.className = 'weekly-game-dialog'; dialog.setAttribute('aria-label', 'Weekly game');
        const art = artwork(release.artwork_url);
        dialog.innerHTML = `<header class="weekly-game-header"><button type="button" data-close aria-label="Close weekly game">‹ <span>Inbox</span></button><strong>Weekly game</strong><button type="button" data-leaderboard aria-label="School leaderboard">Leaderboard</button></header>
        <div class="weekly-game-content"><section data-intro class="weekly-game-intro"><span class="weekly-game-eyebrow">THIS WEEK’S CHALLENGE</span><h1 data-title></h1>${art ? mediaImageMarkup(art, { alt: '', className: 'weekly-game-artwork', loading: 'eager' }) : ''}<p data-description></p>
        <p class="weekly-game-app-only" data-app-only></p><div class="weekly-game-actions" data-actions></div></section>
        <section data-rankings class="weekly-game-rankings" hidden><h2>School leaderboard</h2><p data-ranking-note></p><ol data-ranking-list></ol><button type="button" data-back>Back to game</button></section>
        <p data-status class="weekly-game-status" role="status" aria-live="polite"></p></div>`;
        el('[data-title]').textContent = release.title;
        el('[data-description]').textContent = release.rules?.instructions || release.description || '';
        el('[data-app-only]').textContent = isIOS()
            ? 'Play this week’s game in the Valid app. Scores there count for your school leaderboard.'
            : 'This week’s game is only in the Valid iPhone app for now. You can still check your school leaderboard here.';
        if (isIOS()) { const link = document.createElement('a'); link.href = APP_STORE_URL; link.className = 'weekly-game-ios-link'; link.textContent = 'Open Valid in the App Store'; el('[data-actions]').append(link); }
        document.body.append(dialog); dialog.showModal();
        history.pushState({ ...history.state, weeklyGame: true }, ''); hadHistory = true;
        el('[data-close]').onclick = () => close(); dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        el('[data-leaderboard]').onclick = leaderboard;
        el('[data-back]').onclick = () => { show('[data-rankings]', false); show('[data-intro]', true); status(''); };
        window.addEventListener('popstate', popstate); window.addEventListener('pagehide', pagehide);
    }
    async function leaderboard() {
        if (!dialog) return;
        const current = ++generation; show('[data-intro]', false); show('[data-rankings]', true); status('Loading leaderboard…');
        try {
            let result = await api.getWeeklyGameLeaderboard(release.id, { signal: abort.signal }); if (current !== generation || !dialog) return;
            // The leaderboard needs its one-time discovery record; this never starts a run.
            if (result.unlocked === false) { await api.unlockWeeklyGame({ signal: abort.signal }); if (current !== generation || !dialog) return; result = await api.getWeeklyGameLeaderboard(release.id, { signal: abort.signal }); if (current !== generation || !dialog) return; }
            const list = el('[data-ranking-list]'); list.replaceChildren();
            for (const entry of (result.entries || []).slice(0, 100)) { const li = document.createElement('li'), name = document.createElement('span'), score = document.createElement('strong'); name.textContent = `${entry.rank}. ${entry.name}`; score.textContent = String(entry.score); li.append(name, score); list.append(li); }
            el('[data-ranking-note]').textContent = result.entries?.length ? 'This week’s scores from the Valid app.' : 'No scores yet this week.'; status('');
        } catch (error) { if (current === generation && error.name !== 'AbortError') status(userMessage(error, 'Could not load the leaderboard.')); }
    }
    return { open, close };
}
