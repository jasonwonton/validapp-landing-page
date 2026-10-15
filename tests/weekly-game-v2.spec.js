import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
// The live hand-package-v2 selection (Scuba Challenge); its package is mirrored in assets/.
const release=JSON.parse(readFileSync('tests/fixtures/weekly-game-v2/release.json'));
const packagePath=`**/assets/weekly-game/packages/${release.bundle.sha256}.six7game.json`;
test.use({serviceWorkers:'block',launchOptions:async({browserName},use)=>use(browserName==='chromium'?{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']}:{} )});

async function open(page,{game=release,leaderboard=[{rank:1,name:'Taylor',score:42}],launch=true}={}){
    await page.goto('/app/?signin=1');
    await page.evaluate(async({game,leaderboard,launch})=>{
        const {createWeeklyGame}=await import('/app/weekly-game/index.js');window.gameCalls=[];
        window.weeklyGame=createWeeklyGame({api:{getWeeklyGame:async()=>({release:game}),getWeeklyGameLeaderboard:async()=>{gameCalls.push('leaderboard');return {entries:leaderboard};},unlockWeeklyGame:async()=>{gameCalls.push('unlock');}}});
        await window.weeklyGame.open({launch});
    },{game,leaderboard,launch});
}
// Wrists as the MediaPipe worker reports them: a still nose-pinch hand and a hand that waves at 2.5 Hz (or holds still).
async function syntheticHands(page,{moving}){
    await page.addInitScript(moving=>{
        const NativeWorker=window.Worker;window.cameraRequests=0;
        window.Worker=class{
            constructor(url,options){if(!String(url).includes('/assets/weekly-game/tracker-'))return new NativeWorker(url,options);this.closed=false;}
            postMessage(data){if(this.closed)return;if(data.type==='init')setTimeout(()=>this.onmessage?.({data:{type:'ready'}}),0);else{data.image.close();const x=moving?.72+.1*Math.sin(2*Math.PI*2.5*data.timestamp/1000):.72;const hands=[.4,.62,x,.6];setTimeout(()=>{if(!this.closed)this.onmessage?.({data:{type:'sample',timestamp:data.timestamp,pair:hands,hands}});},4);}}
            terminate(){this.closed=true;}
        };
        window.gameStreams=[];const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia=async c=>{window.cameraRequests++;const s=await original(c);window.gameStreams.push(s);return s;};
    },moving);
}
const tracksEnded=page=>page.evaluate(()=>gameStreams.flatMap(s=>s.getTracks()).every(t=>t.readyState==='ended'));

test('Scuba intro: title, instruction GIF, practice policy, and the package script isolated in a sandbox',async({page,browserName})=>{
    await open(page);const d=page.getByRole('dialog',{name:'Weekly game'});
    await expect(d.getByRole('heading',{name:'Scuba Challenge'})).toBeVisible();
    await expect(d.locator('[data-instruction]')).toBeVisible();expect(await d.locator('[data-instruction]').getAttribute('src')).toMatch(/^data:image\/gif;base64,/);
    await expect(d).toContainText('Just do this on camera.');await expect(d).toContainText('Practice on web');
    if(browserName==='chromium'){
        await expect(d.locator('[data-enable]')).toBeEnabled();
        const frame=d.locator('iframe.weekly-game-sandbox');await expect(frame).toHaveCount(1);
        expect(await frame.getAttribute('sandbox')).toBe('allow-scripts');
        // Opaque origin: the package can't reach the signed-in page, and the page can't reach into it.
        expect(await frame.evaluate(f=>f.contentDocument)).toBeNull();
    } else await expect(d.locator('[data-status]')).toContainText('Chrome');
    await d.getByRole('button',{name:'Close game'}).click();await expect(d).toHaveCount(0);await expect(page.locator('iframe.weekly-game-sandbox')).toHaveCount(0);
    await expect(page.getByRole('dialog',{name:'Game of the Week'}).locator('[data-ranking-list]')).toContainText('Taylor');
});

test('a full Scuba practice round counts real flips, records sprites into the video, and never submits',async({page,browserName})=>{
    test.setTimeout(60000);test.skip(browserName!=='chromium','Synthetic browser camera is Chromium-only.');
    await syntheticHands(page,{moving:true});const writes=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('easter-egg'))writes.push(r.url());});
    await open(page);await page.locator('[data-enable]').click();await expect(page.locator('[data-start]')).toBeEnabled({timeout:15000});await page.locator('[data-start]').click();
    await expect(page.locator('[data-status]')).toHaveText('Go!',{timeout:10000});await page.waitForTimeout(3000);
    // The package's own art (water, seaweed, fish, bubbles) is drawn over the camera, so it is recorded too.
    const sprites=Number(await page.locator('[data-canvas]').getAttribute('data-sprites'));
    await expect(page.locator('[data-result]')).toBeVisible({timeout:30000});
    const score=Number((await page.locator('[data-final-score]').textContent()).match(/^(\d+) flips$/)[1]);
    expect(score).toBeGreaterThanOrEqual(35);expect(score).toBeLessThanOrEqual(52);
    const video=await page.evaluate(async()=>{const v=document.querySelector('[data-replay]');await v.play();const f=document.querySelector('.weekly-game-dialog:not(.weekly-game-home)').videoFile;return{bytes:f.size,name:f.name,width:v.videoWidth,height:v.videoHeight};});
    expect(video.bytes).toBeGreaterThan(10000);expect(video.name).toMatch(new RegExp(`^valid-scuba-${score}\\.`));expect(video.width).toBe(720);expect(video.height).toBe(1280);
    expect(sprites).toBeGreaterThanOrEqual(5);
    expect(writes).toEqual([]);await expect.poll(()=>tracksEnded(page)).toBe(true);
    await page.evaluate(()=>Object.defineProperty(navigator,'canShare',{value:()=>false,configurable:true}));await page.locator('[data-share]').click();await expect(page.locator('[data-status]')).toContainText('Saved your video');
});

test('a still nose-pinch pair scores zero flips',async({page,browserName})=>{
    test.setTimeout(60000);test.skip(browserName!=='chromium','Synthetic browser camera is Chromium-only.');
    await syntheticHands(page,{moving:false});await open(page);await page.locator('[data-enable]').click();await expect(page.locator('[data-start]')).toBeEnabled({timeout:15000});await page.locator('[data-start]').click();
    await expect(page.locator('[data-result]')).toBeVisible({timeout:30000});await expect(page.locator('[data-final-score]')).toHaveText('0 flips');
});

test('a tampered package never loads its script or requests the camera',async({page})=>{
    await page.addInitScript(()=>{window.cameraRequests=0;navigator.mediaDevices&&(navigator.mediaDevices.getUserMedia=async()=>{window.cameraRequests++;throw Error('must not request');});});
    const bytes=readFileSync(`assets/weekly-game/packages/${release.bundle.sha256}.six7game.json`);const tampered=Buffer.from(bytes);tampered[80]^=1;
    await page.route(packagePath,route=>route.fulfill({status:200,contentType:'application/json',body:tampered}));
    await open(page);await expect(page.locator('[data-status]')).toContainText('incomplete');
    await expect(page.locator('iframe.weekly-game-sandbox')).toHaveCount(0);expect(await page.evaluate(()=>window.cameraRequests)).toBe(0);
});

test('a camera game the web cannot run yet shows a friendly iOS-app state with the leaderboard',async({page})=>{
    const requests=[];page.on('request',r=>{if(r.url().includes('six7game'))requests.push(r.url());});
    const next={...release,id:'c'.repeat(64),title:'Next Week Challenge',bundle:{...release.bundle,sha256:'d'.repeat(64)}};
    await page.addInitScript(()=>{window.cameraRequests=0;navigator.mediaDevices&&(navigator.mediaDevices.getUserMedia=async()=>{window.cameraRequests++;throw Error('must not request');});});
    await open(page,{game:next,launch:false});const d=page.getByRole('dialog',{name:'Game of the Week'});
    // The game home names the game and says where to play it, with the leaderboard below; no Play.
    await expect(d.getByRole('heading',{name:'Next Week Challenge'})).toBeVisible();await expect(d).toContainText('Valid iPhone app');await expect(d.locator('img.weekly-game-art-image')).toBeVisible();
    await expect(d.getByRole('button',{name:'Play',exact:true})).toBeHidden();await expect(d.locator('[data-ranking-list]')).toContainText('Taylor');
    await d.getByRole('button',{name:'Done'}).click();await expect(d).toHaveCount(0);
    expect(requests).toEqual([]);expect(await page.evaluate(()=>window.cameraRequests)).toBe(0);expect(await page.evaluate(()=>gameCalls)).toEqual(['leaderboard']);
});

test('the Feed shows this week’s Scuba Challenge with its artwork',async({page})=>{
    await page.goto('/app/?demo=1&signin=1&weeklygame=scuba');await page.getByRole('button',{name:/^sign in$/i}).click();
    // FeedView+PersonalInbox: "Game of the Week" / "‹title› · #rank" as the Inbox's first row.
    const entry=page.locator('#weeklyGameRoot [data-weekly-game-open]');await expect(entry).toBeVisible();await expect(entry).toContainText('Game of the Week');await expect(entry).toContainText('Scuba Challenge · #4');
    await expect(entry.locator('img.weekly-game-art-image')).toHaveAttribute('src',release.artwork_url);
    await entry.click();const home=page.getByRole('dialog',{name:'Game of the Week'});await expect(home.getByRole('heading',{name:'Scuba Challenge'})).toBeVisible();
    await home.getByRole('button',{name:'Play',exact:true}).click();await expect(page.getByRole('dialog',{name:'Weekly game'}).getByRole('heading',{name:'Scuba Challenge'})).toBeVisible();
});
