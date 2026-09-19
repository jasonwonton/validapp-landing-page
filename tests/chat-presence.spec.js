import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Keep unrelated account data deterministic, but exercise the real HTTP adapter
// for all presence and settings requests. No production account is mutated.
async function setup(page, options = {}) {
    const state = { enabled: true, mode: 'active', requests: [], puts: [], ...options };
    const source = await readFile(new URL('../app/demo-api.js', import.meta.url), 'utf8');
    await page.route('**/app/demo-api.js', route => route.fulfill({ contentType: 'text/javascript', body: source + `
import { ValidAPI } from './api.js';
const transport = new ValidAPI();
for (const method of ['updateChatPresence','getActivityStatus','setActivityStatus']) {
    DemoAPI.prototype[method] = function(...args) { transport.user = this.user; return transport[method](...args); };
}` }));
    await page.route('**/api/v1/users/*/chat-presence', async route => {
        const body = route.request().postDataJSON(); state.requests.push(body);
        if (state.mode === 'failure') return route.fulfill({ status: 503, json: { detail: 'Unavailable' } });
        const now = Date.now()/1000;
        await route.fulfill({ json: { enabled: state.enabled, server_now: now, chats: body.chat_ids.map(id => ({
            chat_id: id, members: state.enabled && state.mode !== 'empty' ? (id === 'chat-noah' ? ['classmate-2'] : ['classmate-1', 'classmate-2']).map(user_id => ({
                user_id, last_active_at: now - (state.mode === 'recent' ? 120 : 0), active_until: state.mode === 'recent' ? null : now + 60,
            })) : [],
        })) } });
    });
    await page.route('**/api/v1/users/*/activity-status', async route => {
        if (route.request().method() === 'PUT') {
            state.enabled = route.request().postDataJSON().enabled; state.puts.push(state.enabled);
            if (state.ambiguous) return route.fulfill({ status: 503, json: { detail: 'Lost confirmation' } });
        }
        await route.fulfill({ json: { enabled: state.enabled } });
    });
    await page.goto('/app/?demo=1&signin=1');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.locator('#appView')).toBeVisible();
    return state;
}

test('real adapter renders active peers in Recent, inbox, direct header and group members', async ({page}) => {
    const state = await setup(page);
    await expect.poll(() => state.requests.length).toBeGreaterThan(0);
    expect(state.requests[0].chat_ids).toEqual([]); // Activity is app-wide, even before Chats opens.
    await page.getByRole('button',{name:'Chats',exact:true}).click();
    const recent = page.getByRole('region',{name:'Recent conversations'});
    await expect(recent.locator('[data-presence-label="chat-noah"]')).toHaveText('Active now',{timeout:10000});
    await expect(recent.locator('[data-presence-label="chat-friends"]')).toHaveText('2 active now');
    await expect(recent.getByRole('link',{name:'Noah Williams',exact:true})).toHaveAccessibleDescription('Active now');
    await expect(page.locator('.chat-list [data-presence-dot="chat-noah"]')).toBeVisible();
    expect(state.requests.flatMap(r=>r.chat_ids)).not.toContain('chat-invite');
    await recent.getByRole('link',{name:'Noah Williams',exact:true}).click();
    await expect(page.locator('.chat-room-title small')).toHaveText('Active now');
    await page.getByRole('button',{name:'Back to chats',exact:true}).click();
    await recent.getByRole('link',{name:/Weekend Crew/}).click();
    await expect(page.locator('.chat-room-title small')).toContainText('2 active now');
    await page.getByRole('button',{name:'Chat settings',exact:true}).click();
    await expect(page.locator('[data-presence-member="classmate-1"]')).toHaveText('Active now');
    await expect(page.locator('[data-presence-member="demo-user"]')).toHaveCount(0);
    expect(state.requests.every(r => r.chat_ids.length<=20)).toBe(true);
    expect(state.requests[0].session_id).toMatch(/^[\da-f-]{36}$/i);
});

test('last-active labels do not show green dots, and errors never fabricate offline status', async ({page}) => {
    const state=await setup(page,{mode:'recent'});
    await page.getByRole('button',{name:'Chats',exact:true}).click();
    await expect(page.locator('[data-presence-label="chat-noah"]')).toHaveText('Active recently',{timeout:10000});
    await expect(page.locator('.chat-list [data-presence-dot="chat-noah"]')).toBeHidden();
    await page.getByRole('region',{name:'Recent conversations'}).getByRole('link',{name:'Noah Williams',exact:true}).click();
    await expect(page.locator('.chat-room-title small')).toHaveText('Active recently');
    state.mode='failure';
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect(page.locator('.chat-room-title small')).toBeEmpty();
    await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    await expect.poll(() => state.requests.filter(r=>r.active).length).toBeGreaterThan(2);
    await expect(page.locator('.chat-room-title small')).toBeEmpty();
});

test('activity privacy persists via PUT and reconciles a lost save response', async ({page}) => {
    const state=await setup(page,{ambiguous:true});
    await page.getByRole('button',{name:'Profile',exact:true}).click();
    await page.getByRole('button',{name:'Activity status',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Activity status',exact:true});
    const toggle=dialog.getByRole('switch',{name:'Show activity status'});
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect(toggle).toBeEnabled();
    await expect(toggle).not.toBeChecked();
    expect(state.puts).toEqual([false]);
    await expect(dialog.getByRole('status')).toContainText('current setting');
    await dialog.getByRole('button',{name:'Close activity status'}).click();
    await page.getByRole('button',{name:'Chats',exact:true}).click();
    await expect.poll(()=>state.requests.some(r=>r.chat_ids.includes('chat-noah'))).toBe(true);
    await expect(page.locator('[data-presence-label="chat-noah"]')).toBeHidden();
    await expect(page.locator('.chat-list [data-presence-dot="chat-noah"]')).toBeHidden();
});

test('pagehide sends a fenced inactive pulse and resume starts a fresh presence session', async ({page}) => {
    const state=await setup(page);
    await expect.poll(()=>state.requests.length).toBeGreaterThan(0);
    const first=state.requests[0];
    await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
    await expect.poll(()=>state.requests.some(r=>!r.active)).toBe(true);
    const stop=state.requests.find(r=>!r.active);
    expect(stop.session_id).toBe(first.session_id);expect(stop.sequence).toBeGreaterThan(first.sequence);
    await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
    await expect.poll(()=>state.requests.some(r=>r.active&&r.session_id!==first.session_id)).toBe(true);
});

test('two independent clients publish presence and observe a peer leaving on the next heartbeat', async ({ browser, baseURL }) => {
    const leases = new Map();
    const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    const source = await readFile(new URL('../app/demo-api.js', import.meta.url), 'utf8');
    try {
        for (const [index,page] of pages.entries()) {
            await page.clock.install();
            const user = index === 0 ? 'demo-user' : 'classmate-2';
            await page.route('**/app/demo-api.js',route=>route.fulfill({contentType:'text/javascript',body:source.replaceAll('demo-user',user)+`
import { ValidAPI } from './api.js';
const transport = new ValidAPI();
DemoAPI.prototype.updateChatPresence = function(...args) { transport.user = this.user; return transport.updateChatPresence(...args); };
`}));
            await page.route('**/api/v1/users/*/chat-presence',async route=>{
                const body=route.request().postDataJSON(), now=Date.now()/1000;
                const previous=leases.get(body.session_id);
                if (!previous || body.sequence>previous.sequence) leases.set(body.session_id,{...body,user,last:now});
                const peers=[...leases.values()].filter(lease=>lease.user!==user);
                await route.fulfill({json:{enabled:true,server_now:now,chats:body.chat_ids.map(chat_id=>({chat_id,members:peers.map(peer=>({
                    user_id:peer.user,last_active_at:peer.last,active_until:peer.active?now+60:null,
                }))}))}});
            });
            await page.goto(`${baseURL}/app/?demo=1&signin=1`);
            await page.getByRole('button',{name:/^sign in$/i}).click();
            await expect.poll(()=>[...leases.values()].some(lease=>lease.user===user&&lease.active)).toBe(true);
            await page.getByRole('button',{name:'Chats',exact:true}).click();
        }
        await pages[0].clock.fastForward(30_000);
        await expect(pages[0].locator('[data-presence-label="chat-noah"]')).toHaveText('Active now');
        await pages[1].evaluate(()=>window.dispatchEvent(new Event('pagehide')));
        await expect.poll(()=>[...leases.values()].some(lease=>lease.user==='classmate-2'&&!lease.active)).toBe(true);
        await pages[0].clock.fastForward(30_000);
        await expect(pages[0].locator('[data-presence-label="chat-noah"]')).toHaveText('Active recently');
        await expect(pages[0].locator('.chat-list [data-presence-dot="chat-noah"]')).toBeHidden();
    } finally { await Promise.all(contexts.map(context=>context.close())); }
});
