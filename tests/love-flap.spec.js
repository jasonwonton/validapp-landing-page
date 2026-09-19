import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const release=JSON.parse(readFileSync('tests/fixtures/love-flap/release.json'));
const runId='12345678-1234-4234-8234-123456789abc';
test.use({serviceWorkers:'block'});
async function open(page,{failSave=false}={}){
    await page.goto('/app/?signin=1');
    await page.evaluate(async({release,runId,failSave})=>{
        window.gameCalls=[];window.failSave=failSave;
        const api={user:{id:'love-flap-test'},getWeeklyGame:async()=>({release}),unlockWeeklyGame:async()=>{gameCalls.push({type:'unlock'});return{unlocked:true};},startWeeklyGameRun:async(id)=>{gameCalls.push({type:'start',id});return{run_id:runId,release_id:id,version:1,seed:67};},finishWeeklyGameRun:async(id,runId,evidence)=>{gameCalls.push({type:'finish',id,runId,evidence});if(window.failSave)throw Error('Connection lost');return{score:0};},getWeeklyGameLeaderboard:async()=>({entries:[{rank:1,name:'Taylor <script>',score:12}]})};
        const {createWeeklyGame}=await import('/app/weekly-game/index.js');window.gameApi=api;window.weeklyGame=createWeeklyGame({api});await weeklyGame.open();
    },{release,runId,failSave});
    await expect(page.locator('[data-status]')).toHaveText('Tap or press space to flap through the pipes.',{timeout:20000});
}
async function finish(page){const game=page.frameLocator('iframe[title^="Love Flap"]');await game.locator('canvas').click();await expect(page.locator('[data-result]')).toBeVisible({timeout:15000});await expect(page.locator('[data-share]')).toBeEnabled({timeout:15000});return game;}
test('published Love Flap plays, saves once, shares its real poster and replays',async({page})=>{
    await open(page);await finish(page);await expect(page.locator('[data-score]')).toHaveText('0 pipes');
    expect(await page.evaluate(()=>gameCalls.filter(c=>c.type==='finish').length)).toBe(1);
    expect(await page.evaluate(()=>gameCalls.find(c=>c.type==='finish').evidence.taps)).toEqual([1]);
    const img=await page.locator('[data-poster]').evaluate(async img=>{await img.decode();return {width:img.naturalWidth,height:img.naturalHeight};});expect(img).toEqual({width:1080,height:1920});
    await page.screenshot({path:`output/love-flap/result-${test.info().project.name}.png`});
    await page.evaluate(()=>Object.defineProperty(navigator,'canShare',{value:()=>false,configurable:true}));await page.locator('[data-share]').click();await expect(page.locator('[data-status]')).toContainText('Download the image');
    await page.locator('[data-leaderboard]').click();await expect(page.locator('[data-list]')).toContainText('Taylor <script>');await expect(page.locator('[data-list] script')).toHaveCount(0);await page.locator('[data-back]').click();await page.locator('[data-again]').click();await expect(page.locator('[data-status]')).toContainText('Tap or press space');expect(await page.evaluate(()=>gameCalls.filter(c=>c.type==='start').length)).toBe(2);await page.getByRole('button',{name:'Close weekly game'}).click();await expect(page.locator('iframe[title^="Love Flap"]')).toHaveCount(0);
});
test('opaque sandbox blocks authenticated storage, network, and forged results',async({page})=>{
    await open(page);const frame=page.frames().find(f=>f.url().includes('/assets/weekly-game/web/'));
    const isolated=await frame.evaluate(async()=>{let storage=false,parentRead=false,network=false;try{localStorage.getItem('token');}catch(_){storage=true;}try{parent.document.body;}catch(_){parentRead=true;}try{await fetch('/api/v1/profile');}catch(_){network=true;}return{storage,parentRead,network};});expect(isolated).toEqual({storage:true,parentRead:true,network:true});
    await page.evaluate(()=>window.postMessage({bridge:'valid-weekly-web',type:'complete',token:document.querySelector('iframe').src.split('#')[1],evidence:{frames:1,taps:[]}},'*'));expect(await page.evaluate(()=>gameCalls.some(c=>c.type==='finish'))).toBe(false);
});
test('pause, keyboard control, and backgrounding preserve the round',async({page})=>{
    await open(page);const canvas=page.frameLocator('iframe[title^="Love Flap"]').locator('canvas');await canvas.click();await page.locator('[data-pause]').click();await expect(page.locator('[data-status]')).toContainText('Paused');await page.waitForTimeout(1500);expect(await page.evaluate(()=>gameCalls.some(c=>c.type==='finish'))).toBe(false);await canvas.click();await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.locator('[data-status]')).toContainText('Paused');await page.waitForTimeout(1200);expect(await page.evaluate(()=>gameCalls.some(c=>c.type==='finish'))).toBe(false);
});
test('failed score resumes with the same evidence and run after closing',async({page})=>{
    await open(page,{failSave:true});await page.frameLocator('iframe[title^="Love Flap"]').locator('canvas').click();await expect(page.locator('[data-retry]')).toHaveText('Retry saving score',{timeout:15000});const original=await page.evaluate(()=>gameCalls.find(c=>c.type==='finish'));await page.getByRole('button',{name:'Close weekly game'}).click();await page.waitForTimeout(100);await page.evaluate(async()=>{window.failSave=false;await weeklyGame.open();});await expect(page.locator('[data-share]')).toBeEnabled({timeout:20000});expect(await page.evaluate(()=>gameCalls.filter(c=>c.type==='start').length)).toBe(1);expect(await page.evaluate(()=>gameCalls.filter(c=>c.type==='finish'))).toEqual([original,original]);expect(await page.evaluate(()=>localStorage.getItem('valid.web-game.pending.v1.love-flap-test'))).toBeNull();
});
test('real feed routes web releases to Love Flap without loading camera tracking',async({page})=>{
    const camera=[];page.on('request',r=>{if(/mediapipe|tracker-.*\.js/.test(r.url()))camera.push(r.url());});await page.goto('/app/?demo=1&signin=1');await page.evaluate(async({release,runId})=>{const{DemoAPI}=await import('/app/demo-api.js');DemoAPI.prototype.getWeeklyGame=async()=>({release});DemoAPI.prototype.unlockWeeklyGame=async()=>({unlocked:true});DemoAPI.prototype.startWeeklyGameRun=async()=>({run_id:runId,release_id:release.id,version:1,seed:67});}, {release,runId});await page.getByRole('button',{name:/^sign in$/i}).click();await expect(page.locator('#weeklyGameTitle')).toHaveText('Rose Flight');await page.locator('#weeklyGameButton').click();await expect(page.locator('[data-status]')).toContainText('Tap or press space');expect(camera).toEqual([]);
});
test('web game API uses the native release run and evidence contracts',async({page})=>{
    const requests=[];await page.route('**/api/v1/easter-egg/**',r=>{requests.push({url:r.request().url(),method:r.request().method(),body:r.request().postDataJSON()});return r.fulfill({json:{}});});await page.goto('/app/?signin=1');await page.evaluate(async({id,runId})=>{const{ValidAPI}=await import('/app/api.js');const api=new ValidAPI();await api.startWeeklyGameRun(id);await api.finishWeeklyGameRun(id,runId,{frames:60,taps:[1]});},{id:release.id,runId});expect(requests.map(r=>r.method)).toEqual(['POST','POST']);expect(requests[0].url).toContain(`/releases/${release.id}/runs`);expect(requests[1].body).toEqual({run_id:runId,evidence:{frames:60,taps:[1]}});
});
test('space starts a real round and only the server-confirmed score is shown',async({page})=>{
    await open(page);await page.evaluate(()=>{gameApi.finishWeeklyGameRun=async(id,runId,evidence)=>{gameCalls.push({type:'finish',id,runId,evidence});return{score:23};};});await page.locator('iframe[title^="Love Flap"]').focus();await page.keyboard.press('Space');await expect(page.locator('[data-share]')).toBeEnabled({timeout:15000});await expect(page.locator('[data-score]')).toHaveText('23 pipes');expect(await page.evaluate(()=>document.querySelector('.web-game-dialog').shareFile.name)).toBe('love-flap-23.png');expect(await page.evaluate(()=>gameCalls.find(c=>c.type==='finish').evidence.taps)).toEqual([1]);
});
test('unsupported package stops before opening a ranked run',async({page})=>{
    await page.goto('/app/?signin=1');const result=await page.evaluate(async release=>{let writes=0;const {createWeeklyGame}=await import('/app/weekly-game/index.js');const api={user:{id:'test'},getWeeklyGame:async()=>({release:{...release,bundle:{...release.bundle,sha256:'0'.repeat(64)}}}),unlockWeeklyGame:async()=>{writes++;}};try{await createWeeklyGame({api}).open();}catch(e){return {message:e.message,writes};}},{...release});expect(result.writes).toBe(0);expect(result.message).toContain('newer web player');await expect(page.locator('iframe[title^="Love Flap"]')).toHaveCount(0);
});
test('profile destination crosses the game boundary only as a small image',async({page})=>{
    await open(page);await page.getByRole('button',{name:'Close weekly game'}).click();await page.waitForTimeout(100);await page.evaluate(async()=>{const {createWeeklyGame}=await import('/app/weekly-game/index.js');window.weeklyGame=createWeeklyGame({api:gameApi,getProfilePhoto:()=>location.origin+'/assets/weekly-game/rose.png'});await weeklyGame.open();});await expect(page.frameLocator('iframe[title^="Love Flap"]').locator('canvas')).toHaveAttribute('aria-label',/Your photo awaits/,{timeout:15000});
});
test('an unsavable round can be explicitly discarded without resubmitting it',async({page})=>{
    await open(page,{failSave:true});await page.frameLocator('iframe[title^="Love Flap"]').locator('canvas').click();await expect(page.locator('[data-discard]')).toBeVisible({timeout:15000});await page.locator('[data-discard]').click();await expect(page.locator('[data-status]')).toContainText('Tap or press space');expect(await page.evaluate(()=>gameCalls.filter(c=>c.type==='finish').length)).toBe(1);expect(await page.evaluate(()=>gameCalls.filter(c=>c.type==='start').length)).toBe(2);expect(await page.evaluate(()=>localStorage.getItem('valid.web-game.pending.v1.love-flap-test'))).toBeNull();
});
