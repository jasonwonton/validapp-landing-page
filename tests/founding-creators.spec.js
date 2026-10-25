import { test, expect } from '@playwright/test';

async function fill(page) {
    await page.goto('/founding-creators.html');
    await page.getByText('Instagram', {exact: true}).click();
    await page.getByLabel('Your username there').fill('@kayla.edits');
    await page.getByLabel('Your Valid username', {exact: true}).fill('@kayla');
    await page.getByLabel('Post link 1', {exact: true}).fill('https://instagram.com/p/first/');
}
const permission = page => page.locator('#consent');

test('multiple posts submit together; another batch keeps identity and asks permission again', async ({page}) => {
    const requests = [];
    await page.route('**/api/v1/founding-creator-submissions', async route => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({json: {received:true}});
    });
    await fill(page);
    await page.getByRole('button', {name: '+ Add another post', exact:true}).click();
    await page.getByLabel('Post link 2', {exact:true}).fill('https://instagram.com/p/second/');
    await permission(page).check();
    await page.getByRole('button', {name:'Submit my posts'}).click();
    await expect(page.getByRole('status')).toContainText("You're in!");
    expect(requests[0].post_urls).toHaveLength(2);
    expect(requests[0].consent).toBe(true);
    expect(requests[0].consent_version).toBe('2026-10-25-v1');
    await expect(page.getByLabel('Your Valid username', {exact:true})).toHaveValue('@kayla');
    await expect(page.getByLabel('Your username there')).toHaveValue('@kayla.edits');
    await expect(permission(page)).not.toBeChecked();
    await page.getByLabel('Post link 1', {exact:true}).fill('https://instagram.com/p/third/');
    await permission(page).check();
    await page.getByRole('button', {name:'Submit my posts'}).click();
    await expect.poll(() => requests.length).toBe(2);
});

test('unchecked permission never sends a request', async ({page}) => {
    let count = 0;
    await page.route('**/api/v1/founding-creator-submissions', route => { count++; return route.fulfill({json:{received:true}}); });
    await fill(page);
    await page.getByRole('button', {name:'Submit my posts'}).click();
    expect(await permission(page).evaluate(node => node.validity.valueMissing)).toBe(true);
    expect(count).toBe(0);
});

test('server error preserves every link and consent for retry', async ({page}) => {
    await page.route('**/api/v1/founding-creator-submissions', route => route.fulfill({status:503,json:{detail:'Please try again shortly.'}}));
    await fill(page);
    await permission(page).check();
    await page.getByRole('button', {name:'Submit my posts'}).click();
    await expect(page.getByRole('status')).toContainText('Please try again shortly.');
    await expect(page.getByLabel('Post link 1', {exact:true})).toHaveValue('https://instagram.com/p/first/');
    await expect(permission(page)).toBeChecked();
    await expect(page.getByRole('button', {name:'Submit my posts'})).toBeEnabled();
});

test('links can be removed and the page fits narrow screens', async ({page}) => {
    await fill(page);
    await page.getByRole('button', {name:'+ Add another post',exact:true}).click();
    await page.getByRole('button', {name:'Remove post link 2',exact:true}).click();
    await expect(page.locator('[name=post_url]')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (test.info().project.name === 'android') {
        await page.screenshot({path:'test-results/founding-creators-mobile.png',fullPage:true});
    }
    if (test.info().project.name === 'desktop') {
        await page.screenshot({path:'test-results/founding-creators-desktop.png',fullPage:true});
    }
});

test('a fallback HTML response is never reported as a saved application', async ({page}) => {
    await page.route('**/api/v1/founding-creator-submissions', route => route.fulfill({body:'<html>fallback</html>',contentType:'text/html'}));
    await fill(page);
    await permission(page).check();
    await page.getByRole('button', {name:'Submit my posts'}).click();
    await expect(page.getByRole('status')).toContainText("That didn't send");
    await expect(page.getByLabel('Post link 1', {exact:true})).toHaveValue('https://instagram.com/p/first/');
});
