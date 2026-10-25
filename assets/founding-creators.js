(() => {
  'use strict';
  const form = document.getElementById('creator-form');
  const links = document.getElementById('post-links');
  const add = document.getElementById('add-post');
  const submit = document.getElementById('submit-posts');
  const status = document.getElementById('form-status');
  const batchHint = document.getElementById('batch-hint');
  let nextId = 2;
  let sending = false;
  submit.disabled = false;

  function updateLimit() {
    const full = links.children.length >= 10;
    add.hidden = full;
    batchHint.hidden = !full;
  }
  add.addEventListener('click', () => {
    if (sending || links.children.length >= 10) return;
    const row = document.createElement('div');
    row.className = 'post-row';
    const id = `post-${nextId++}`;
    const label = document.createElement('label');
    label.htmlFor = id;
    label.className = 'sr-only';
    label.textContent = `Post link ${links.children.length + 1}`;
    const input = links.querySelector('input').cloneNode();
    input.id = id;
    input.value = '';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-post';
    remove.setAttribute('aria-label', `Remove ${label.textContent.toLowerCase()}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => { row.remove(); updateLimit(); add.focus(); });
    row.append(label, input, remove);
    links.append(row);
    updateLimit();
    input.focus();
  });
  function message(text, error = false) {
    status.textContent = text;
    status.dataset.tone = error ? 'error' : 'success';
    status.hidden = false;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || !form.reportValidity()) return;
    const data = new FormData(form);
    const postUrls = data.getAll('post_url').map(value => value.trim());
    try {
      for (const value of postUrls) {
        const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
        if (!['https:', 'http:'].includes(url.protocol) || !url.hostname.includes('.')) throw new Error();
      }
      if (!String(data.get('handle')).trim().replace(/^@+/, '') || !String(data.get('valid_username')).trim().replace(/^@+/, '')) throw new Error('username');
    } catch (error) {
      message(error.message === 'username' ? 'Add both your social username and your Valid username.' : 'Check your post links. Please use public website links.', true);
      status.focus();
      return;
    }
    sending = true;
    const controls = [...form.querySelectorAll('input, button')];
    controls.forEach(control => { control.disabled = true; });
    submit.textContent = 'Sending…';
    message('Saving your posts…');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/v1/founding-creator-submissions', {
        method: 'POST',
        credentials: 'omit',
        headers: {'Content-Type': 'application/json'},
        signal: controller.signal,
        body: JSON.stringify({
          platform: data.get('platform'),
          handle: data.get('handle').trim(),
          valid_username: data.get('valid_username').trim(),
          post_urls: postUrls,
          consent: data.get('consent') === 'on',
          consent_version: '2026-10-25-v1',
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.received !== true) {
        if (response.status === 429) throw new Error('Too many submissions. Please try again later.');
        if ([422, 503].includes(response.status) && typeof body.detail === 'string') throw new Error(body.detail);
        throw new Error("That didn't send. Your links are still here—please try again.");
      }
      // Keep identity fields for the next batch. Permission is checked afresh.
      [...links.children].slice(1).forEach(row => row.remove());
      links.querySelector('input').value = '';
      form.elements.consent.checked = false;
      updateLimit();
      message("You're in! We've received your posts. Got more? Add more links and submit again.");
      status.focus();
    } catch (error) {
      message(error.name === 'AbortError' ? 'That took too long. Your links are still here. You can safely try again.' : (error.message || "That didn't send. Please try again."), true);
      status.focus();
    } finally {
      clearTimeout(timeout);
      sending = false;
      controls.forEach(control => { control.disabled = false; });
      submit.innerHTML = 'Submit my posts <span aria-hidden="true">↗</span>';
    }
  });
})();
