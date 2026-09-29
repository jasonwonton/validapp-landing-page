export function openBlockedUsers({ api, userId }) {
    const existing = document.querySelector('.blocked-users-dialog');
    if (existing) { existing.focus(); return; }
    const dialog = document.createElement('dialog');
    dialog.className = 'blocked-users-dialog';
    dialog.setAttribute('aria-label', 'Blocked Users');
    dialog.innerHTML = `<header><button type="button" data-close aria-label="Back to profile">‹</button><h2>Blocked Users</h2></header><div class="blocked-users-list"></div><p role="status">Loading blocked users…</p><button type="button" class="secondary-button" data-retry hidden>Try again</button>`;
    document.body.append(dialog); dialog.showModal();
    const list = dialog.querySelector('.blocked-users-list'), status = dialog.querySelector('[role="status"]'), retry = dialog.querySelector('[data-retry]');
    const current = () => dialog.isConnected && api.user?.id === userId;
    let profiles = [], pending = false;
    function render() {
        list.replaceChildren();
        status.textContent = profiles.length ? '' : 'No blocked users. People you block will appear here.';
        for (const profile of profiles) {
            const row = document.createElement('article'), name = document.createElement('strong'), avatar = document.createElement('span'), button = document.createElement('button');
            row.className = 'blocked-user-row'; avatar.className = 'blocked-user-avatar';
            const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'Valid user';
            name.textContent = fullName; avatar.textContent = [profile.first_name,profile.last_name].filter(Boolean).map(s=>s[0]).join('');
            const picture = profile.profile_picture_url_thumb || profile.profile_picture_url;
            if (picture) { const img = document.createElement('img'); img.src = api.assetURL(picture); img.alt = ''; avatar.replaceChildren(img); }
            button.type = 'button'; button.textContent = 'Unblock'; button.className = 'secondary-button'; button.disabled = pending;
            button.setAttribute('aria-label', `Unblock ${fullName}`);
            button.onclick = () => {
                if (pending || !current()) return;
                const confirmation = document.createElement('dialog'); confirmation.className = 'activity-settings-dialog'; confirmation.setAttribute('aria-label','Unblock User');
                const heading = document.createElement('h2'), message = document.createElement('p'), cancel = document.createElement('button'), confirm = document.createElement('button');
                heading.textContent = 'Unblock User'; message.textContent = `Unblock ${fullName}? You’ll be able to see and invite them again.`;
                cancel.type = confirm.type = 'button'; cancel.textContent = 'Cancel'; confirm.textContent = 'Unblock'; cancel.className = 'secondary-button'; confirm.className = 'primary-button';
                confirmation.append(heading,message,cancel,confirm); dialog.append(confirmation); confirmation.showModal();
                cancel.onclick = () => confirmation.close(); confirmation.onclose = () => confirmation.remove();
                confirm.onclick = async () => {
                    if (pending || !current()) return;
                    pending = true; confirmation.close(); render(); status.textContent = 'Unblocking…';
                    try {
                        await api.unblockUser(userId, profile.user_id);
                        if (!current()) return;
                        profiles = profiles.filter(p => p.user_id !== profile.user_id);
                        pending = false; render();
                    } catch (_) { if (current()) { pending = false; render(); status.textContent = 'Couldn’t unblock this person. Please try again.'; } }
                };
            };
            row.append(avatar,name,button); list.append(row);
        }
    }
    async function load() {
        retry.hidden = true; status.textContent = 'Loading blocked users…';
        try {
            const result = await api.getBlockedUsers(userId);
            if (!current()) return;
            if (!Array.isArray(result)) throw Error('Invalid blocked users response');
            profiles = result.sort((a,b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)); render();
        } catch (_) { if (current()) { status.textContent = 'Couldn’t load blocked users. Please try again.'; retry.hidden = false; } }
    }
    retry.onclick = load;
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { if (!dialog.open) dialog.remove(); });
    void load();
}
