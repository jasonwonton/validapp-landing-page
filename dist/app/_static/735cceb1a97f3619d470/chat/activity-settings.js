export async function openActivitySettings({ api, userId, presence }) {
    const existing = document.querySelector('.activity-settings-dialog');
    if (existing) { existing.focus(); return; }
    const dialog = document.createElement('dialog');
    dialog.className = 'activity-settings-dialog';
    dialog.setAttribute('aria-label', 'Activity status');
    dialog.innerHTML = `<form method="dialog"><h2>Activity status</h2><button class="secondary-button" aria-label="Close activity status">Done</button></form><label><span>Show activity status</span><input type="checkbox" role="switch" aria-label="Show activity status" disabled></label><p>People in chats you’ve both joined can see when you’re active in the app or were recently active. This doesn’t tell them which chat you’re viewing. Blocked people can’t see your activity.</p><p role="status">Loading…</p><button type="button" class="secondary-button" data-retry hidden>Try again</button>`;
    document.body.append(dialog);
    const toggle = dialog.querySelector('input'), status = dialog.querySelector('[role="status"]'), retry = dialog.querySelector('[data-retry]');
    const current = () => dialog.isConnected && api.user?.id === userId;
    const valid = response => typeof response?.enabled === 'boolean';
    let confirmed = null;
    async function load() {
        retry.hidden = true;
        toggle.disabled = true;
        status.textContent = 'Loading…';
        try {
            const response = await api.getActivityStatus(userId);
            if (!current()) return;
            if (!valid(response)) throw new Error();
            confirmed = response.enabled;
            toggle.checked = confirmed;
            toggle.disabled = false;
            status.textContent = '';
        } catch (_) {
            if (!current()) return;
            status.textContent = 'Activity status couldn’t be loaded. Please try again.';
            retry.hidden = false;
        }
    }
    toggle.addEventListener('change', async () => {
        const desired = toggle.checked;
        toggle.disabled = true;
        presence.invalidate();
        status.textContent = 'Saving…';
        try {
            const response = await api.setActivityStatus(userId, desired);
            if (!current()) return;
            if (!valid(response)) throw new Error();
            confirmed = response.enabled;
            toggle.checked = confirmed;
            status.textContent = confirmed ? 'Activity status is on.' : 'Activity status is off.';
        } catch (_) {
            if (!current()) return;
            // A lost response may have committed. Reconcile before showing a value.
            try {
                const response = await api.getActivityStatus(userId);
                if (!current()) return;
                if (!valid(response)) throw new Error();
                confirmed = response.enabled;
                toggle.checked = confirmed;
                status.textContent = 'Showing your current setting. The change couldn’t be confirmed.';
            } catch (_) {
                confirmed = null;
                status.textContent = 'Your setting couldn’t be confirmed. Please try again.';
                retry.hidden = false;
            }
        } finally {
            if (current()) { toggle.disabled = confirmed == null; presence.invalidate(); }
        }
    });
    retry.addEventListener('click', load);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
    await load();
}
