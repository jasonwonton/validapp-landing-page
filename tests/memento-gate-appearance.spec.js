import { expect, test } from '@playwright/test';

// iOS never locks a chat behind a Memento (ChatMementoRevealPolicy). What a
// room shows instead is the compact "Take a Memento" card above the composer
// (ChatMementoCaptureCard) and friends' Mementos blurred until the viewer posts.
async function openChat(page) {
    await page.goto('/app/?demo=1&signin=1');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await page.getByRole('button', { name: /Weekend Crew/ }).click();
}

for (const theme of ['light', 'dark']) for (const width of [320, 393]) {
    test(`${theme} Take a Memento card at ${width}px sits above the composer like iOS`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 740 });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await openChat(page);
        const card = page.getByRole('button', { name: 'Take a Memento' });
        await expect(card).toBeVisible();
        await expect(card).toHaveCSS('background-color', 'rgb(255, 177, 94)');
        await expect(card.locator('img[src$="memento-camera.webp"]')).toBeVisible();
        const cardBox = await card.boundingBox();
        const composer = await page.locator('.chat-composer').boundingBox();
        expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(composer.y);
        expect(cardBox.height + .0001).toBeGreaterThanOrEqual(44);
        expect(composer.y + composer.height).toBeLessThanOrEqual(740);
        // No lock, no skip: every message is there.
        await expect(page.getByRole('button', { name: 'Skip for today' })).toHaveCount(0);
        await expect(page.locator('.chat-message')).toHaveCount(4);
        await expect(page.locator('.hidden-memento')).toContainText('Post yours to see Ava’s Memento');
        await expect(page.locator('.hidden-memento')).toContainText('Take Memento');
        await page.screenshot({ path: `artifacts/memento-gate/${theme}-${width}-${testInfo.project.name}.png`, animations: 'disabled' });
        await page.locator('.hidden-memento').click();
        await expect(page.getByRole('dialog', { name: "Today's Memento" })).toBeVisible();
    });
}

test('the card hides while typing or replying and returns after', async ({ page }) => {
    await openChat(page);
    const card = page.getByRole('button', { name: 'Take a Memento' });
    await page.getByRole('textbox', { name: 'Message' }).focus();
    await expect(card).toBeHidden();
    await page.getByRole('textbox', { name: 'Message' }).blur();
    await expect(card).toBeVisible();
    const message = page.locator('[data-message-id="msg-4"]');
    await message.getByRole('button', { name: 'Message actions' }).click();
    await message.getByRole('button', { name: 'Reply' }).click();
    await page.getByRole('textbox', { name: 'Message' }).blur();
    await expect(card).toBeHidden();
    await page.getByRole('button', { name: 'Cancel reply' }).click();
    await expect(card).toBeVisible();
});
