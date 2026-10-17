// validapp.lol/add/<username> without the app (six7 docs/add-links-api.md).
//
// Reads GET /api/v1/public/add-links/<username> (same origin): a first name
// and a photo, nothing else. Every miss (no such person, under 13, a link
// that is off) is the same 404, shown as "This link isn't active". The
// username is never sent anywhere else and the page loads no analytics.
(() => {
  'use strict';

  const USERNAME = /^[a-z0-9_]{3,30}$/;
  const APP_STORE = 'https://apps.apple.com/us/app/valid-compliment-classmates/id6755367062';

  function usernameFromLocation() {
    // /add/<username> (the shared link) or /add.html?u=<username> (direct).
    const match = location.pathname.match(/^\/add\/([^/]+)\/?$/);
    let raw = match ? match[1] : new URLSearchParams(location.search).get('u') || '';
    try { raw = decodeURIComponent(raw); } catch { return null; }
    const username = raw.trim().toLowerCase();
    return USERNAME.test(username) ? username : null;
  }

  function show(state) {
    const avatar = document.querySelector('.al-avatar');
    const photo = document.querySelector('.al-photo');
    const initial = document.querySelector('.al-initial');
    const name = document.querySelector('.al-name');
    const line = document.querySelector('.al-line');
    const note = document.querySelector('.al-note');
    const open = document.querySelector('.al-open');
    avatar.dataset.state = state.kind;

    if (state.kind === 'found') {
      document.title = `Add ${state.firstName} on Valid`;
      name.textContent = state.firstName;
      line.textContent = 'Add me on Valid';
      initial.textContent = state.firstName.slice(0, 1).toUpperCase();
      initial.hidden = false;
      if (state.photoUrl) {
        photo.addEventListener('load', () => { initial.hidden = true; photo.hidden = false; }, { once: true });
        photo.addEventListener('error', () => { photo.hidden = true; }, { once: true });
        photo.src = state.photoUrl;
      }
      open.href = `validapp://add/${state.username}`;
      open.textContent = `Already have Valid? Add ${state.firstName}`;
      open.hidden = false;
      note.textContent = `After you sign up, open this link again to add ${state.firstName}.`;
      return;
    }
    avatar.dataset.state = 'inactive';
    initial.textContent = '?';
    initial.hidden = false;
    if (state.kind === 'busy') {
      name.textContent = 'Try again soon';
      line.textContent = 'Too many tries right now. Wait a minute and reload.';
    } else {
      name.textContent = "This link isn't active";
      line.textContent = 'It may have been turned off, or mistyped. You can still get Valid.';
    }
    note.hidden = true;
  }

  async function lookUp(username) {
    try {
      const response = await fetch(`/api/v1/public/add-links/${encodeURIComponent(username)}`, {
        credentials: 'omit',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (response.status === 429 || response.status === 503) return { kind: 'busy' };
      if (!response.ok) return { kind: 'inactive' };
      const body = await response.json();
      const firstName = typeof body.first_name === 'string' ? body.first_name.trim().slice(0, 40) : '';
      if (!firstName) return { kind: 'inactive' };
      let photoUrl = null;
      try {
        const url = new URL(body.profile_picture_url);
        // Only an https image (http only on a local http preview); the
        // default placeholder shows the initial instead.
        const secure = url.protocol === 'https:' || (location.protocol === 'http:' && url.protocol === 'http:');
        if (secure && !/\/default\.png$/.test(url.pathname)) photoUrl = url.href;
      } catch {}
      return { kind: 'found', firstName, photoUrl, username };
    } catch {
      return { kind: 'busy' };
    }
  }

  async function start() {
    document.querySelectorAll('a.vs-button').forEach(link => { link.href = APP_STORE; });
    const username = usernameFromLocation();
    show(username ? await lookUp(username) : { kind: 'inactive' });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
