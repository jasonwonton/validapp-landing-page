// Read-only verification. No sign-in, camera permission, score writes or sharing.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
const origin=new URL(process.env.PWA_RELEASE_ORIGIN || 'https://validapp.lol').origin;
assert(origin==='https://validapp.lol' || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
const root=new URL('../',import.meta.url);
const release=JSON.parse(await readFile(new URL('tests/fixtures/weekly-game/release.json',root)));
const local=JSON.parse(await readFile(new URL('dist/app/build-manifest.json',root)));
const manifest=await(await fetch(`${origin}/app/build-manifest.json`)).json();assert.equal(manifest.release,local.release);
async function files(prefix){const result=[];for(const entry of await readdir(new URL(prefix,root),{withFileTypes:true})){const path=`${prefix}/${entry.name}`;if(entry.isDirectory())result.push(...await files(path));else result.push(path);}return result;}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const path of await files('assets/weekly-game')){
    const response=await fetch(`${origin}/${path}`,{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200,path);assert.equal(sha(Buffer.from(await response.arrayBuffer())),sha(await readFile(new URL(path,root))),path);
    if(path.endsWith('.wasm'))assert.match(response.headers.get('content-type'),/application\/wasm/);
    if(path.endsWith('.js'))assert.match(response.headers.get('content-type'),/javascript/);
}
console.log('PASS all self-hosted game package, model, WASM and worker bytes match the reviewed release');
const browser=await chromium.launch({channel:'chromium'});
try{
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${origin}/app/?signin=1`);await page.getByRole('heading',{name:'Welcome Back'}).waitFor();
    await page.evaluate(async({path,release})=>{const {createWeeklyGame}=await import(path);window.releaseGame=createWeeklyGame({api:{getWeeklyGame:async()=>({release}),getWeeklyGameLeaderboard:async()=>({entries:[]})}});await releaseGame.open();},{path:manifest.assets['/app/weekly-game/index.js'],release});
    await page.getByRole('heading',{name:release.title}).waitFor();assert.match(await page.locator('[data-status]').textContent(),/Prop up your phone/);await page.locator('[data-instruction]').evaluate(img=>img.decode());
    const pose='data:image/jpeg;base64,'+(await readFile(new URL('tests/fixtures/weekly-game/pose.jpg',root))).toString('base64');
    const sample=await page.evaluate(async({path,pose})=>{
        const {WristTracker}=await import(path);const tracker=new WristTracker(()=>{},()=>{});
        try{await tracker.start();const image=new Image();image.src=pose;await image.decode();const bitmap=await createImageBitmap(image);return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Inference timed out')),10000);tracker.onSample=s=>{clearTimeout(timer);resolve(s);};tracker.onError=e=>{clearTimeout(timer);reject(e);};tracker.worker.postMessage({type:'frame',image:bitmap,timestamp:100},[bitmap]);});}finally{tracker.close();}
    },{path:manifest.assets['/app/weekly-game/tracker.js'],pose});
    assert.equal(sample.pair.length,4);assert(sample.pair.every(v=>v>=0&&v<=1));assert.deepEqual(errors,[]);
    await page.getByRole('button',{name:'Close weekly game'}).click();console.log('PASS built player: verified package, native instructions, real worker/model wrist inference, clean close; no camera or score writes');
}finally{await browser.close();}
