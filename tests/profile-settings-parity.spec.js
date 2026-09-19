import { test, expect } from '@playwright/test';

async function profile(page) {
    await page.goto('/app/?demo=1&signin=1&tab=profile');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.locator('#privacySettings')).toBeVisible();
}

test('native settings grouping, theme buttons and stacked account actions', async ({page}) => {
    await profile(page);
    await expect(page.locator('#privacySettings #activityStatusButton')).toBeVisible();
    await expect(page.locator('#privacySettings #blockedUsersButton')).toBeVisible();
    await expect(page.getByRole('button', {name:'Use system appearance'})).toHaveAttribute('aria-pressed','true');
    await page.getByRole('button', {name:'Use dark appearance'}).click();
    await expect(page.locator('#appearanceHint')).toHaveText('This choice stays on until you change it.');
    const bounds = await page.evaluate(() => ['feedbackButton','profileSignOutButton'].map(id => {const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,bottom:r.bottom};}));
    expect(bounds[1].y).toBeGreaterThan(bounds[0].bottom);
    expect(bounds[1].x).toBe(bounds[0].x);
    expect(bounds[1].width).toBe(bounds[0].width);
    await page.locator('#blockedUsersButton').click();
    await expect(page.getByRole('dialog', {name:'Blocked Users',exact:true})).toContainText('No blocked users');
    await page.getByRole('button',{name:'Back to profile'}).click();
    await expect(page.getByRole('dialog', {name:'Blocked Users',exact:true})).toHaveCount(0);
});

test('blocked-user management confirms, retains failures, and removes only successful unblocks', async ({page}) => {
    await profile(page);
    await page.evaluate(async () => {
        const {DemoAPI}=await import('/app/demo-api.js');
        window.unblocks=[]; window.failUnblock=true;
        DemoAPI.prototype.getBlockedUsers=async()=>[{user_id:'blocked-1',first_name:'Maya',last_name:'Chen'},{user_id:'blocked-2',first_name:'Noah',last_name:'Williams'}];
        DemoAPI.prototype.unblockUser=async(user,id)=>{unblocks.push(id);if(failUnblock)throw Error('offline');};
    });
    await page.locator('#blockedUsersButton').click();
    const dialog=page.getByRole('dialog',{name:'Blocked Users',exact:true});
    await dialog.getByRole('button',{name:'Unblock Maya Chen'}).click();
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    expect(await page.evaluate(()=>unblocks)).toEqual([]);
    await dialog.getByRole('button',{name:'Unblock Maya Chen'}).click();
    await page.getByRole('dialog',{name:'Unblock User',exact:true}).getByRole('button',{name:'Unblock',exact:true}).click();
    await expect(dialog).toContainText('Couldn’t unblock');
    await expect(dialog.getByRole('button',{name:'Unblock Maya Chen'})).toBeEnabled();
    await page.evaluate(()=>window.failUnblock=false);
    await dialog.getByRole('button',{name:'Unblock Maya Chen'}).click();
    await page.getByRole('dialog',{name:'Unblock User',exact:true}).getByRole('button',{name:'Unblock',exact:true}).click();
    await expect(dialog.getByRole('button',{name:'Unblock Maya Chen'})).toHaveCount(0);
    await expect(dialog.getByRole('button',{name:'Unblock Noah Williams'})).toBeVisible();
});

test('chat search is requested explicitly and cancel ignores a late response',async({page})=>{
    await profile(page);
    await page.getByRole('button',{name:'Chats',exact:true}).click();
    const search=page.getByRole('searchbox',{name:'Search chats and messages'});
    await expect(search).toBeHidden();
    await page.getByRole('button',{name:'Search chats',exact:true}).click();
    await expect(search).toBeFocused();
    await page.evaluate(async()=>{
        const {DemoAPI}=await import('/app/demo-api.js');
        DemoAPI.prototype.searchChats=()=>new Promise(resolve=>window.finishSearch=()=>resolve({chats:{items:[]},messages:{items:[]}}));
    });
    await search.fill('Noah');
    await page.getByRole('button',{name:'Search',exact:true}).click();
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.evaluate(()=>finishSearch());
    await expect(search).toBeHidden();
    await expect(page.locator('.chat-search-results')).toBeHidden();
    await expect(page.locator('.chat-list')).toBeVisible();
});
