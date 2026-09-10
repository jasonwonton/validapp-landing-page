import test from 'node:test';
import assert from 'node:assert/strict';
import { permitsAuthRouteRecovery, fetchAuthWithRecovery } from '../../app/auth-route-recovery.js';
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
const origin = 'https://validapp.lol';
const url = origin + '/api/v1/users/phone-check';

test('only anonymous safe production requests can change origin', () => {
    assert.equal(permitsAuthRouteRecovery('/users/phone-check', {method:'POST',auth:false}, origin+'/api/v1', origin),true);
    for (const path of ['/auth/phone/request/web','/auth/phone/confirm','/auth/passkey/authenticate','/auth/passkey/signup/complete','/auth/session','/users/phone-check?redirect=x']) {
        assert.equal(permitsAuthRouteRecovery(path,{method:'POST',auth:false},origin+'/api/v1',origin),false);
    }
    assert.equal(permitsAuthRouteRecovery('/users/phone-check',{method:'POST',auth:true},origin+'/api/v1',origin),false);
    assert.equal(permitsAuthRouteRecovery('/users/phone-check',{method:'POST',auth:false},origin+'/api/v1','https://staging.validapp.lol'),false);
});

test('network fallback keeps exact body and omits credentials on alternate', async () => {
    const calls=[];
    const r=await fetchAuthWithRecovery(url,{method:'POST',body:'{"phone_number":"test"}',headers:{Authorization:'Bearer must-not-forward'}},{fetcher:async(u,o)=>{
        calls.push([u,o]); if(calls.length<2) throw new TypeError('network');
        return new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}});
    }});
    assert.deepEqual(await r.json(),{ok:true});
    assert.equal(calls[1][0],'https://api.validappcdn.com/api/v1/users/phone-check');
    assert.equal(calls[1][1].body,calls[0][1].body);
    assert.equal(calls[1][1].credentials,'omit');
    assert.equal(calls[1][1].headers.has('Authorization'),false);
    assert.equal(calls[1][1].redirect,'error');
});

test('HTTP rejection never changes origin', async () => {
    let calls=0;
    const r=await fetchAuthWithRecovery(url,{},{fetcher:async()=>{calls++;return new Response('denied',{status:403});}});
    assert.equal(r.status,403);assert.equal(calls,1);
});

test('caller cancellation does not start a fallback', async () => {
    const controller=new AbortController();let calls=0;
    await assert.rejects(fetchAuthWithRecovery(url,{},{signal:controller.signal,fetcher:async()=>{
        calls++;controller.abort();throw new DOMException('abort','AbortError');
    }}));
    assert.equal(calls,1);
});

test('exhaustion is bounded and prevents the outer challenge retry', async () => {
    let calls=0;
    await assert.rejects(fetchAuthWithRecovery(url,{},{fetcher:async()=>{calls++;throw new TypeError('network');}}), e=>e.routeRecoveryAttempted===true);
    assert.equal(calls,3);
});

test('overall deadline cancels a stalled fetch', async () => {
    let calls=0;const start=Date.now();
    await assert.rejects(fetchAuthWithRecovery(url,{},{timeoutMs:25,fetcher:async(u,o)=>{
        calls++; return new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(new DOMException('abort','AbortError'))));
    }}));
    assert.equal(calls,1);assert.ok(Date.now()-start<500);
});

test('phone expiry classification does not treat arbitrary errors as expiration', async () => {
    const {needsPhoneReverification}=await import('../../app/auth-reliability.js');
    assert.equal(needsPhoneReverification({code:'phone_verification_expired'}),true);
    assert.equal(needsPhoneReverification({code:'phone_not_verified'}),true);
    assert.equal(needsPhoneReverification({code:'network_failure'}),false);
});

test('diagnostic identity survives different errors and a fresh module', async () => {
    const saved=new Map();globalThis.localStorage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
    const first=await import('../../app/auth-reliability.js?first');
    const second=await import('../../app/auth-reliability.js?second');
    assert.match(first.authDiagnosticInstance(),/^[a-f0-9]{64}$/);
    assert.equal(first.authDiagnosticInstance(),second.authDiagnosticInstance());
});
