import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatPresence, bindPresenceLifecycle, presenceLabel } from '../../app/chat/presence.js';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture(handler) {
    let time = 0, counter = 0;
    const tasks = new Map(), calls = [];
    const api = { updateChatPresence: async (...args) => { calls.push(args); return handler ? handler(...args) : {
        enabled: true, server_now: 1000 + time / 1000,
        chats: args[1].chat_ids.map(id => ({ chat_id: id, members: [{ user_id: 'peer', last_active_at: 1000, active_until: 1060 }] })),
    }; } };
    const presence = createChatPresence({ api, now: () => time, uuid: () => `session-${++counter}`, random: () => .5,
        schedule: (fn, delay) => { const id = ++counter; tasks.set(id, { fn, at: time + delay }); return id; }, cancel: id => tasks.delete(id) });
    async function advance(ms) {
        const end = time + ms;
        for (;;) {
            const item = [...tasks].sort((a,b) => a[1].at - b[1].at)[0];
            if (!item || item[1].at > end) break;
            time = item[1].at; tasks.delete(item[0]); item[1].fn(); await flush();
        }
        time = end; await flush();
    }
    return { presence, calls, advance };
}

test('labels use server time and expire historical activity after three days', () => {
    const member = { last_active_at: 1000, active_until: 1060 };
    for (const [now, label] of [[1000,'Active now'],[1060,'Active recently'],[1300,'Active 5m ago'],[4600,'Active 1h ago'],[87400,'Active yesterday'],[173800,'Active 2 days ago'],[260200,'']]) assert.equal(presenceLabel(member,now),label);
    assert.equal(presenceLabel(member,null),'');
});

test('bounded audiences refresh early, then at native cadence, with no redundant loop', async () => {
    const { presence:p, calls, advance } = fixture();
    p.start('me'); p.start('me'); await flush();
    assert.equal(calls.length,1); assert.deepEqual(calls[0][1].chat_ids,[]);
    p.setWatched(Array.from({length:25},(_,i)=>`chat-${i}`));
    await advance(3000);
    assert.equal(calls.length,2); assert.equal(calls[1][1].chat_ids.length,20);
    assert.equal(p.status('chat-0').label,'Active now');
    await advance(24000); assert.equal(calls.length,2);
    await advance(1000); assert.equal(calls.length,3);
    p.setWatched([]); assert.equal(p.status('chat-0').label,'');
    await advance(3000); assert.equal(calls.at(-1)[1].chat_ids.length,0);
    await advance(34000); assert.equal(calls.length,4);
    await advance(1000); assert.equal(calls.length,5);
    await p.stop();
});

test('a stale snapshot expires while the next request hangs; late stopped response cannot restore it', async () => {
    let resolve;
    const {presence:p,calls,advance}=fixture((_u,body)=>body.sequence===1 ? {
        enabled:true, server_now:1000, chats:[{chat_id:'a',members:[{user_id:'peer',last_active_at:1000,active_until:2000}]}],
    } : body.active ? new Promise(r=>resolve=r) : { enabled:true, server_now:1000,chats:[] });
    p.setWatched(['a']);p.start('me');await flush();
    assert.equal(p.status('a').active,true);
    await advance(36000);assert.equal(p.status('a').label,'');
    await p.stop();
    assert.equal(calls.at(-1)[1].active,false);assert.equal(calls.at(-1)[1].sequence,3);assert.equal(calls.at(-1)[2].keepalive,true);
    resolve({enabled:true,server_now:1000,chats:[{chat_id:'a',members:[{user_id:'peer',last_active_at:1000,active_until:2000}]}]});await flush();
    assert.equal(p.status('a').active,false);
});

test('privacy invalidation rejects an in-flight snapshot and disabled responses hide all peers', async () => {
    let resolve;
    const {presence:p,advance}=fixture((_u,b)=>b.active ? new Promise(r=>resolve=r) : {});
    p.setWatched(['a']);p.start('me');p.invalidate();
    resolve({enabled:true,server_now:1000,chats:[{chat_id:'a',members:[{user_id:'x',last_active_at:1000,active_until:2000}]}]});await flush();
    assert.equal(p.status('a').active,false);
    await advance(3000);
    resolve({enabled:false,server_now:1000,chats:[{chat_id:'a',members:[{user_id:'x',last_active_at:1000,active_until:2000}]}]});await flush();
    assert.equal(p.status('a').active,false);await p.stop();
});

test('rate limits back off even if visible chats change; failure is unknown rather than offline', async () => {
    const {presence:p,calls,advance}=fixture(()=>Promise.reject(Object.assign(new Error(),{status:429,retryAfterSeconds:70})));
    p.start('me');await flush();p.setWatched(['a']);await advance(70000);
    assert.equal(calls.length,1);assert.equal(p.status('a').label,'');
    await advance(2000);assert.equal(calls.length,2);await p.stop();
});

test('session switches reject old responses and never show a previous user snapshot', async () => {
    const pending=[];
    const {presence:p,calls}=fixture((u,b)=>b.active ? new Promise(resolve=>pending.push({u,resolve})) : {});
    p.setWatched(['a']);p.start('first');p.start('second');
    pending[0].resolve({enabled:true,server_now:1000,chats:[{chat_id:'a',members:[{user_id:'x',last_active_at:1000,active_until:2000}]}]});await flush();
    assert.equal(p.status('a').active,false);assert.equal(calls[1][0],'first');assert.equal(calls[1][1].active,false);
    pending[1].resolve({enabled:true,server_now:1000,chats:[]});await flush();await p.stop();
});

test('foreground lifecycle covers hidden tabs, offline, page cache restoration and sign out', () => {
    const doc=new EventTarget(), win=new EventTarget();doc.hidden=false;let online=true;
    const calls=[];const p={start:id=>calls.push(['start',id]),stop:()=>{calls.push(['stop']);return Promise.resolve();},setWatched:()=>{}};
    const lifecycle=bindPresenceLifecycle(p,{document:doc,window:win,online:()=>online});
    lifecycle.setUser('me');doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));
    doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));
    online=false;win.dispatchEvent(new Event('offline'));online=true;win.dispatchEvent(new Event('online'));
    win.dispatchEvent(new Event('pagehide'));win.dispatchEvent(new Event('pageshow'));lifecycle.stop();win.dispatchEvent(new Event('pageshow'));
    assert.deepEqual(calls,[['start','me'],['stop'],['start','me'],['stop'],['start','me'],['stop'],['start','me'],['stop'],['stop']]);
});

test('snapshots exclude unsolicited chats, self activity and malformed members', async () => {
    const {presence:p}=fixture(()=>({enabled:true,server_now:1000,chats:[
        {chat_id:'a',members:[null,{user_id:'me',last_active_at:1000,active_until:2000},{user_id:'bad',last_active_at:'1000',active_until:2000}]},
        {chat_id:'secret',members:[{user_id:'peer',last_active_at:1000,active_until:2000}]},
    ]}));
    p.setWatched(['a']);p.start('me');await flush();
    assert.equal(p.status('a').label,'');assert.equal(p.status('secret').active,false);
    await p.stop();
});
