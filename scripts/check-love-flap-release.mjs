// Read-only production verification. API boundaries are local stubs: no account,
// ranked run, score, game selection, or external share is written.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from '@playwright/test';
const origin=new URL(process.env.PWA_RELEASE_ORIGIN||'https://validapp.lol').origin;
assert(origin==='https://validapp.lol'||/^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
const root=new URL('../',import.meta.url),release=JSON.parse(await readFile(new URL('tests/fixtures/love-flap/release.json',root)));
const local=JSON.parse(await readFile(new URL('dist/app/build-manifest.json',root)));
const manifest=await(await fetch(`${origin}/app/build-manifest.json`)).json();assert.equal(manifest.release,local.release);
// DigitalOcean static hosting ignores _headers; check the actual edge policy.
// A correct HTML meta policy cannot loosen a stale response-header policy.
const shell=await fetch(`${origin}/app/`);assert.equal(shell.status,200);
const csp=shell.headers.get('content-security-policy')||'';
const frameSources=csp.split(';').map(s=>s.trim().split(/\s+/)).find(parts=>parts[0]==='frame-src');
assert(frameSources?.includes("'self'"),'Live PWA response CSP must allow self-hosted game frames; update the existing Cloudflare PWA response-header rule');
const{WEB_PACKAGE}=await import('../app/weekly-game/web-assets.js');
const response=await fetch(origin+WEB_PACKAGE.host);assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());const sha=v=>createHash('sha256').update(v).digest('hex');assert.equal(sha(bytes),sha(await readFile(new URL(`dist${WEB_PACKAGE.host}`,root))));
for(const [name,type] of [['chromium',chromium],['firefox',firefox],['webkit',webkit]].filter(([name])=>!process.env.PWA_GAME_BROWSER||name===process.env.PWA_GAME_BROWSER)){
 const browser=await type.launch();try{
  const page=await browser.newPage();
  // This WebKit runner reloads/stalls during service-worker activation. Keep
  // its engine/game check separate from Chromium/Firefox's controlled-SW check.
  // Main-frame only: Playwright's built-in blocker touches navigator.serviceWorker
  // inside opaque frames and itself throws SecurityError there.
  if(name==='webkit')await page.addInitScript(()=>{if(window===window.top&&navigator.serviceWorker)navigator.serviceWorker.register=async()=>{throw Error('Worker disabled in WebKit test harness');};});
  const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/'))writes.push(r.url());});
  await page.goto(origin+'/app/?signin=1');await page.getByRole('heading',{name:'Welcome Back'}).waitFor();
  // Exercise an installed, controlling service worker before opening the iframe.
  if(name!=='webkit')await page.waitForFunction(()=>navigator.serviceWorker.controller?.state==='activated',{},{timeout:30000});
  await page.getByRole('heading',{name:'Welcome Back'}).waitFor();
  await page.evaluate(async({path,release})=>{const {createWeeklyGame}=await import(path);window.gameCalls=[];const api={user:{id:'release-verification'},getWeeklyGame:async()=>({release}),unlockWeeklyGame:async()=>({unlocked:true}),startWeeklyGameRun:async()=>({run_id:'12345678-1234-4234-8234-123456789abc',release_id:release.id,version:1,seed:67}),finishWeeklyGameRun:async(id,runId,evidence)=>{gameCalls.push({id,runId,evidence});return{score:0};},getWeeklyGameLeaderboard:async()=>({entries:[]})};window.game=createWeeklyGame({api});await game.open();},{path:manifest.assets['/app/weekly-game/index.js'],release});
  const iframe=page.frameLocator('iframe[title^="Love Flap"]');try{await iframe.locator('canvas').click({timeout:20000});}catch(error){console.log('Game interaction failed',name,await page.evaluate(()=>({status:document.querySelector('[data-status]')?.textContent,url:location.href,state:history.state})),errors);await page.screenshot({path:`output/love-flap/built-error-${name}.png`});console.log(await page.evaluate(()=>({frame:document.querySelector('iframe[title^="Love Flap"]')?.outerHTML,hidden:document.hidden}))); throw error;}await page.locator('[data-share]:not([disabled])').waitFor({timeout:20000});assert.equal(await page.locator('[data-score]').textContent(),'0 pipes');
  const result=await page.evaluate(async()=>{const img=document.querySelector('[data-poster]');await img.decode();const file=document.querySelector('.web-game-dialog').shareFile;return{width:img.naturalWidth,height:img.naturalHeight,bytes:file.size,calls:gameCalls};});assert.equal(result.width,1080);assert.equal(result.height,1920);assert(result.bytes>10000);assert.equal(result.calls.length,1);assert.deepEqual(result.calls[0].evidence.taps,[1]);assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  if(name==='chromium'){await mkdir(new URL('output/love-flap',root),{recursive:true});const file=await page.evaluate(async()=>Array.from(new Uint8Array(await document.querySelector('.web-game-dialog').shareFile.arrayBuffer())));await writeFile(new URL('output/love-flap/verified-poster.png',root),Buffer.from(file));}
  await page.getByRole('button',{name:'Close weekly game'}).click();console.log(`PASS ${name}: exact production sandbox, full Love Flap round, one evidence submission to local stub, native 1080×1920 PNG, clean close; ${name==='webkit'?'WebKit worker disabled':'service worker active'}; no production writes`);
 }finally{await browser.close();}
}
