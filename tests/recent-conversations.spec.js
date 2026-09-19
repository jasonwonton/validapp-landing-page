import { test, expect } from '@playwright/test';
import { recentConversations } from '../app/chat/models.js';

test('Recent uses accepted active conversations, ordered by latest activity, capped at twelve', () => {
    const chats = Array.from({ length: 15 }, (_, i) => ({
        id: `chat-${i}`, status: 'active', membership_status: 'accepted', last_room_sequence: 1,
        updated_at: new Date(1_000_000 + i * 1_000).toISOString(),
    }));
    chats[0].unacknowledged_missed_call_at = new Date(2_000_000).toISOString();
    const snapshot = structuredClone(chats);
    const result = recentConversations([...chats,
        { ...chats[14], id: 'invited', membership_status: 'invited' },
        { ...chats[14], id: 'inactive', status: 'closed' },
        { ...chats[14], id: 'empty', last_room_sequence: 0 },
    ]);
    expect(result.map(chat => chat.id)).toEqual(['chat-0', ...Array.from({ length: 11 }, (_, i) => `chat-${14-i}`)]);
    expect(chats).toEqual(snapshot);
});

test('Recent shortcuts open the right conversation without replacing the full inbox', async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    const recent = page.getByRole('region', { name: 'Recent conversations' });
    await expect(recent.getByRole('link')).toHaveCount(2);
    await expect(recent.getByRole('link').first()).toHaveAccessibleName(/Weekend Crew.*Memento needed.*2 unread/);
    await expect(recent.getByRole('link', { name: /Art Club/ })).toHaveCount(0);
    await expect(page.locator('.chat-list .chat-row')).toHaveCount(3);
    // No conversation timestamp is presented as a person's activity status.
    await expect(recent).not.toContainText(/active now|active recently/i);
    await recent.getByRole('link', { name: 'Noah Williams', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/chat=chat-noah/);
    await expect(page.locator('.chat-room-title')).toContainText('Noah Williams');
    await page.getByRole('button', { name: 'Back to chats', exact: true }).click();
    await expect(recent).toBeVisible();
    await expect(page.locator('.chat-list .chat-row')).toHaveCount(3);
});
