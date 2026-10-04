import { test, expect } from '@playwright/test';

test('management link survives sign-in and requires confirmation to cancel', async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1&godmode=1&freeweek=0&manage=god-mode');
    await expect(page.locator('#profileDialog')).not.toBeVisible();
    await expect(page).toHaveURL(/manage=god-mode/);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.locator('#profileDialog')).toBeVisible();
    await expect(page.locator('#godModeUnsubscribeButton')).toBeVisible();
    await expect(page.locator('#godModeUnsubscribeButton')).toBeEnabled();
    await expect(page).not.toHaveURL(/manage=god-mode/);
    await page.locator('#godModeUnsubscribeButton').click();
    const confirmation = page.getByRole('dialog', { name: 'Unsubscribe from God Mode?', exact: true });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Keep God Mode', exact: true }).click();
    await expect(page.locator('#godModeUnsubscribeButton')).toBeEnabled();
    await page.locator('#godModeUnsubscribeButton').click();
    await confirmation.getByRole('button', { name: 'Unsubscribe', exact: true }).click();
    await expect(page.locator('#profileGodModeStatus')).toContainText('Unsubscribed');
    await expect(page.locator('#godModeUnsubscribeButton')).toBeDisabled();
});

test('App Store access does not offer Stripe cancellation', async ({ page }) => {
    await page.goto('/app/?demo=1&signin=1&godmode=1&godmodeprovider=apple&manage=god-mode');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.locator('#profileDialog')).toBeVisible();
    await expect(page.locator('#godModeUnsubscribeButton')).toBeHidden();
});

test('public management page provides web and App Store paths', async ({ page }) => {
    await page.goto('/manage-subscription.html');
    await expect(page.getByRole('link', { name: 'Open subscription settings', exact: true }))
        .toHaveAttribute('href', '/app/?signin=1&tab=profile&manage=god-mode');
    await expect(page.getByRole('link', { name: 'open the billing portal', exact: true }))
        .toHaveAttribute('href', /^https:\/\/billing\.stripe\.com\/p\/login\//);
    await expect(page.getByRole('link', { name: 'Open Apple subscriptions', exact: true }))
        .toHaveAttribute('href', 'https://apps.apple.com/account/subscriptions');
});
