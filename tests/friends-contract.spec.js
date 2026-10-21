import { expect, test } from '@playwright/test';

test('friendship adapters use the existing routes and parent capabilities omit child credentials', async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1');
    const calls = await page.evaluate(async () => {
        const { ValidAPI } = await import('/app/api.js');
        const original = window.fetch, calls = [];
        window.fetch = async (url, options) => {
            calls.push({ path: new URL(url, location.href).pathname + new URL(url, location.href).search, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null, credentials: options.credentials, headers: Object.fromEntries(new Headers(options.headers)) });
            return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
        };
        try {
            const api = new ValidAPI(); api.saveSession({ access_token: 'fixture-child-token', user: { id: 'owner' } });
            await api.getFriends('owner', 'cursor-safe', 999);
            await api.getPeopleRequests('owner'); await api.lookupPerson('owner', 'maya_c');
            await api.sendFriendRequest('owner', 'peer', 'qr'); await api.acceptFriendRequest('owner', 'peer');
            await api.declineFriendRequest('owner', 'peer'); await api.cancelFriendRequest('owner', 'peer');
            await api.removeFriend('owner', 'peer'); await api.dismissFriendSuggestion('owner', 'peer');
            await api.getFriendRequestMessages('owner', 'peer'); await api.getBlockedProfiles('owner'); await api.unblockUser('owner', 'peer');
            await api.updateFriendReach('owner', true); await api.updateMessageRequests('owner', false);
            await api.getAnonymousInbox('owner', 30, 0, { sent_before_id: 'sent-id' });
            await api.request('/parent-access/children', { auth: false, credentials: 'omit', headers: { 'X-Parent-Access-Token': 'parentv1_fixture' } });
            return calls;
        } finally { window.fetch = original; }
    });
    expect(calls.map(row => [row.method, row.path])).toEqual([
        ['GET', '/api/v1/users/owner/friends?limit=500&cursor=cursor-safe'], ['GET', '/api/v1/users/owner/people/requests'], ['GET', '/api/v1/users/owner/people/lookup?username=maya_c'],
        ['POST', '/api/v1/users/owner/people/requests'], ['POST', '/api/v1/users/owner/people/requests/peer/accept'], ['POST', '/api/v1/users/owner/people/requests/peer/ignore'], ['DELETE', '/api/v1/users/owner/people/requests/peer'],
        ['DELETE', '/api/v1/users/owner/friends/peer'], ['POST', '/api/v1/users/owner/friends/suggestions/peer/dismiss'], ['GET', '/api/v1/users/owner/people/requests/peer/messages'], ['GET', '/api/v1/users/owner/blocks/profiles'], ['DELETE', '/api/v1/users/owner/blocks/peer'],
        ['PUT', '/api/v1/users/owner/friend-reach'], ['PUT', '/api/v1/users/owner/message-requests'], ['GET', '/api/v1/users/owner/anonymous-inbox?limit=30&offset=0&include_sent=true&sent_before_id=sent-id'], ['GET', '/api/v1/parent-access/children'],
    ]);
    expect(calls[3].body).toMatchObject({ user_id: 'peer', source: 'qr' }); expect(calls[3].body.timezone).toBeTruthy();
    expect(calls[12].body).toEqual({ school_contacts_only: true }); expect(calls[13].body).toEqual({ from_anyone: false });
    expect(calls.slice(0, -1).every(row => row.headers.authorization === 'Bearer fixture-child-token')).toBe(true);
    expect(calls.at(-1)).toMatchObject({ credentials: 'omit', headers: { 'x-parent-access-token': 'parentv1_fixture' } });
    expect(calls.at(-1).headers.authorization).toBeUndefined();
});

for (const held of [false, true]) test(`request preview uses no room reads or media URLs (held=${held})`, async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(async held => {
        const { createChatsView } = await import('/app/chat/index.js');
        const root = document.createElement('div'); root.id = 'request-fixture'; document.body.append(root);
        const chat = { id: 'request-room', membership_id: 'member-id', membership_status: 'invited', friendship: 'incoming', friend_request: 'incoming', accepted_count: 1, pending_count: 1, owner_user_id: 'peer', invited_by_first_name: 'Taylor' };
        window.requestReads = [];
        const api = { assetURL: value => value, getChats: async () => ({ items: [chat] }),
            getPeopleRequests: async () => ({ incoming: [{ user_id: 'peer', chat_id: chat.id, first_name: 'Taylor', held, messages_held: held, requester_is_adult: held, connection: { known: !held } }] }),
            getFriendRequestMessages: async () => { window.requestReads.push('preview'); return { held: false, messages: [{ kind: 'text', body: 'Permitted preview' }, { kind: 'photo', view_once: true, image_url: 'https://private.invalid/SECRET-MEDIA' }] }; },
            getChat: async () => { window.requestReads.push('room'); throw new Error('Request preview must not read the room'); },
            getChatMessages: async () => { window.requestReads.push('messages'); throw new Error('Request preview must not read messages'); },
            markChatRead: async () => { window.requestReads.push('receipt'); },
        };
        const view = createChatsView({ root, api, getUser: () => ({ id: 'viewer' }), getConfig: () => ({ enable_chats: true, enable_web_chats: true, friends_enabled: true }), showToast: () => {} });
        await view.activate({}); await view.openChat(chat.id, { updateHistory: false });
    }, held);
    const root = page.locator('#request-fixture');
    await expect(root).toContainText('Taylor wants to be friends');
    await expect(root.locator('[data-invite-accept]')).toBeEnabled();
    expect(await page.evaluate(() => window.requestReads)).toEqual(held ? [] : ['preview']);
    await expect(root).not.toContainText('SECRET-MEDIA');
    await expect(root.locator('[src*="private.invalid"]')).toHaveCount(0);
    if (held) { await expect(root).not.toContainText('Permitted preview'); await expect(root).toContainText('This account is an adult'); }
    else { await expect(root).toContainText('Permitted preview'); await expect(root).toContainText('available after accepting'); }
});

test('an old privacy write cannot replace the next account settings', async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(async () => {
        const { createFriendsView } = await import('/app/friends/index.js');
        window.fixtureOwner = 'A';
        const api = { getFriends: async () => ({ friends: [] }), getPeopleRequests: async () => ({ incoming: [], outgoing: [], can_add_people: true }), getFriendSuggestions: async () => ({ enabled: false }), getClassmates: async () => [], getFriendReach: async () => ({ available: true, school_contacts_only: false }), getMessageRequests: async () => ({ available: true, from_anyone: false }), updateFriendReach: async () => new Promise(resolve => { window.releasePrivacy = () => resolve({ available: true, school_contacts_only: true }); }) };
        window.fixtureFriends = createFriendsView({ api, getUser: () => ({ id: window.fixtureOwner }), getConfig: () => ({ friends_enabled: true }), escapeHTML: text => String(text || ''), avatarMarkup: () => '', showToast: () => {} });
        await window.fixtureFriends.open({ section: 'privacy' });
    });
    const dialog = page.getByRole('dialog', { name: 'Add Friends', exact: true });
    await dialog.getByRole('button', { name: /Who can add you/ }).click();
    await dialog.getByRole('radio', { name: /^School & contacts/ }).check();
    await expect.poll(() => page.evaluate(() => typeof window.releasePrivacy)).toBe('function');
    await page.evaluate(async () => { window.fixtureFriends.clear(); window.fixtureOwner = 'B'; await window.fixtureFriends.open({ section: 'privacy' }); window.releasePrivacy(); });
    await dialog.getByRole('button', { name: /Who can add you/ }).click();
    await expect(dialog.getByRole('radio', { name: /^School & contacts/ })).not.toBeChecked();
    await expect(dialog.getByRole('radio', { name: /^School & contacts/ })).toBeEnabled();
});

test('first-message retry survives reload with the same body and two request IDs', async ({ page }) => {
    const open = async fail => page.evaluate(async fail => {
        const { openDirectDraft } = await import('/app/chat/direct-draft.js');
        window.draftCalls = [];
        const api = { getDirectChat: async () => ({ state: 'message' }), createChat: async (...args) => { window.draftCalls.push(args); if (fail) throw Object.assign(new Error('Offline'), { status: 503 }); return { id: 'room' }; } };
        await openDirectDraft({ api, getUser: () => ({ id: 'draft-owner' }), targetId: 'peer', name: 'Taylor', escapeHTML: text => String(text || ''), onOpen: () => {} });
    }, fail);
    await page.goto('/app/?demo=1&signin=1'); await open(true);
    const dialog = page.getByRole('dialog', { name: 'Chat with Taylor', exact: true });
    await dialog.getByLabel('First message').fill('Private draft'); await dialog.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('Valid is having trouble');
    const before = await page.evaluate(() => window.draftCalls[0]);
    await page.reload(); await open(false);
    await expect(dialog.getByLabel('First message')).toHaveValue('Private draft');
    await dialog.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(dialog).toBeHidden();
    const after = await page.evaluate(() => window.draftCalls[0]);
    expect(after[3]).toBe(before[3]); expect(after[5]).toEqual(before[5]);
});

test('parent activity-status lock disables the child switch without a write', async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1');
    await page.evaluate(async () => {
        const { openActivitySettings } = await import('/app/chat/activity-settings.js');
        const api = { user: { id: 'child' }, getActivityStatus: async () => ({ enabled: false, locked_by_parent: true }), setActivityStatus: async () => { window.unexpectedActivityWrite = true; return { enabled: true }; } };
        await openActivitySettings({ api, userId: 'child', presence: { invalidate() {} } });
    });
    const dialog = page.getByRole('dialog', { name: 'Activity status', exact: true });
    await expect(dialog.getByRole('switch', { name: 'Show activity status', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('switch', { name: 'Show activity status', exact: true })).not.toBeChecked();
    await expect(dialog).toContainText('Managed by your parent');
    expect(await page.evaluate(() => window.unexpectedActivityWrite)).toBeUndefined();
});
