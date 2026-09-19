import { test, expect } from '@playwright/test';

async function room(page) {
    await page.goto('/app/?demo=1&signin=1&tab=chats&chat=chat-noah');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.locator('[data-message-id="msg-n4"]')).toBeVisible();
}
const menu = page => page.getByRole('dialog', { name: 'Message actions', exact: true });
async function press(page, target, dx = 0) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    if (dx) await page.mouse.move(x + dx, y + 1);
}

test('hold tolerates finger jitter, leaves the timeline still, traps focus, and Escape dismisses', async ({ page }) => {
    await room(page);
    const bubble = page.locator('[data-message-id="msg-n3"] .chat-bubble');
    await bubble.scrollIntoViewIfNeeded();
    const before = await page.locator('.chat-timeline').evaluate(n => n.scrollTop);
    await press(page, bubble, 5);
    await expect(menu(page)).toBeVisible(); await page.mouse.up();
    await expect(menu(page)).toBeVisible();
    expect(await page.locator('.chat-timeline').evaluate(n => n.scrollTop)).toBe(before);
    await expect(menu(page).getByRole('button', { name: 'Unsend for everyone' })).toBeVisible();
    await page.keyboard.press('Shift+Tab');
    expect(await menu(page).evaluate(n => n.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape'); await expect(menu(page)).toHaveCount(0);
    await expect(bubble.locator('[data-message-menu]')).toHaveAttribute('aria-expanded', 'false');
});

test('scroll movement and pointer cancellation abandon a pending touch hold', async ({ page }) => {
    await room(page);
    const bubble = page.locator('[data-message-id="msg-n3"] .chat-bubble');
    await press(page, bubble, 20); await page.waitForTimeout(450); await page.mouse.up();
    await expect(menu(page)).toHaveCount(0);
    await bubble.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0, pointerId: 5, clientX: 100, clientY: 200 });
    await bubble.dispatchEvent('pointermove', { pointerType: 'touch', isPrimary: true, pointerId: 5, clientX: 105, clientY: 201 });
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await bubble.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0, pointerId: 6, clientX: 100, clientY: 200 });
    await bubble.dispatchEvent('pointercancel', { pointerType: 'touch', pointerId: 6 });
    await page.waitForTimeout(450); await expect(menu(page)).toHaveCount(0);
});

test('holding media opens actions without viewing or consuming it; replay keeps its own gesture', async ({ page }) => {
    await room(page);
    const card = page.getByRole('button', { name: 'Photo · Tap to view', exact: true });
    await press(page, card);
    await expect(menu(page)).toBeVisible();
    // The release remains suppressed even if the finger stays down for seconds.
    await page.waitForTimeout(1700); await page.mouse.up();
    await expect(menu(page)).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Chat media', exact: true })).toBeHidden();
    await expect(menu(page).getByRole('button', { name: 'Save in chat', exact: true })).toHaveCount(0);
    await expect(menu(page).getByRole('button', { name: 'Unsend for everyone' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await card.click();
    const viewer = page.getByRole('dialog', { name: 'Chat media', exact: true });
    await expect(viewer).toBeVisible(); await viewer.getByRole('button', { name: 'Close', exact: true }).click();
    await press(page, page.getByRole('button', { name: 'Photo · Hold to replay', exact: true }));
    await expect(page.getByRole('button', { name: 'Photo · Tap to replay', exact: true })).toBeVisible();
    await page.mouse.up(); await expect(menu(page)).toHaveCount(0); await expect(viewer).toBeHidden();
});

test('Memento menu preserves native eligibility and reactions close the menu', async ({ page }) => {
    await room(page);
    const memento = page.locator('[data-message-id="msg-n2"]');
    await press(page, memento.locator('.chat-message-media'));
    await expect(menu(page)).toBeVisible(); await page.mouse.up();
    await expect(menu(page).getByRole('button', { name: 'Copy', exact: true })).toHaveCount(0);
    await expect(menu(page).getByRole('button', { name: 'Unsend for everyone' })).toHaveCount(0);
    await expect(menu(page).getByRole('button', { name: 'React funny' })).toHaveAttribute('aria-pressed', 'false');
    await menu(page).getByRole('button', { name: 'React love' }).click();
    await expect(menu(page)).toHaveCount(0);
    await expect(memento.locator('.chat-reaction-cluster')).toContainText('❤️');
});

test('menu fits a short narrow screen and outside dismissal works after right click', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 480 });
    await room(page);
    const message = page.locator('[data-message-id="msg-n3"]');
    await message.getByRole('button', { name: 'Message actions' }).click();
    await expect(menu(page)).toBeVisible();
    await expect.poll(async () => {
        const b = await menu(page).boundingBox();
        return b && b.x >= 11 && b.y >= 11 && b.x + b.width <= 309 && b.y + b.height <= 469;
    }).toBe(true);
    await menu(page).getByRole('button', { name: 'Save in chat', exact: true }).click();
    await expect(message.locator('.chat-saved-label')).toBeVisible();
    await message.locator('.chat-bubble').click({ button: 'right' });
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole('button', { name: 'Unsave', exact: true })).toBeVisible();
    await page.mouse.click(2, 2); await expect(menu(page)).toHaveCount(0);
});
