import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const release=JSON.parse(readFileSync('tests/fixtures/weekly-game/release.json'));
const bundle=readFileSync('tests/fixtures/weekly-game/package.json');
test.use({serviceWorkers:'block',launchOptions:async({browserName},use)=>use(browserName==='chromium'?{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']}:{} )});
async function open(page,{badPackage=false}={}){
    await page.route(`**/assets/weekly-game/packages/${release.bundle.sha256}.six7game.json`,route=>route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:badPackage?'{}':bundle}));
    await page.goto('/app/?signin=1');
    await page.evaluate(async release=>{
        const {createWeeklyGame}=await import('/app/weekly-game/index.js');
        window.weeklyGame=createWeeklyGame({api:{getWeeklyGame:async()=>({release}),getWeeklyGameLeaderboard:async()=>({entries:[{rank:1,name:'Taylor <script>',score:67}]})}});
        await window.weeklyGame.open();
    },release);
}
async function syntheticTracker(page){
    await page.addInitScript(()=>{
        const NativeWorker=window.Worker;
        window.Worker=class{
            constructor(url,options){if(!String(url).includes('/assets/weekly-game/tracker-'))return new NativeWorker(url,options);this.closed=false;}
            postMessage(data){if(this.closed)return; if(data.type==='init')setTimeout(()=>this.onmessage?.({data:{type:'ready'}}),0);else{data.image.close();const d=.15*Math.cos(Math.PI*data.timestamp/1000);setTimeout(()=>{if(!this.closed)this.onmessage?.({data:{type:'sample',timestamp:data.timestamp,pair:[.25,.5+d,.75,.5-d]}});},4);}}
            terminate(){this.closed=true;}
        };
        window.gameStreams=[];const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia=async c=>{const s=await original(c);window.gameStreams.push(s);return s;};
    });
}
test('weekly game adapter advertises camera capability and uses authenticated release leaderboard',async({page})=>{
    const requests=[];await page.route('**/api/v1/easter-egg/**',r=>{requests.push({url:r.request().url(),headers:r.request().headers(),method:r.request().method()});return r.fulfill({contentType:'application/json',body:'{}'});});
    await page.goto('/app/?signin=1');await page.evaluate(async id=>{const {ValidAPI}=await import('/app/api.js');const api=new ValidAPI();await api.getWeeklyGame();await api.getWeeklyGameLeaderboard(id);await api.unlockWeeklyGame();},release.id);
    expect(requests[0].headers['x-easter-egg-camera-modes']).toBe('hand-package-v1');expect(requests[1].url).toContain(`/releases/${release.id}/leaderboard`);expect(requests.map(r=>r.method)).toEqual(['GET','GET','POST']);expect(requests[2].url).toContain('/easter-egg/unlock');
});
test('instructions, practice label, current artwork, leaderboard and dismissal',async({page})=>{
    await open(page);const d=page.getByRole('dialog',{name:'Weekly game'});await expect(d.getByRole('heading',{name:'67 Challenge'})).toBeVisible();await expect(d.locator('[data-instruction]')).toBeVisible();await expect(d).toContainText('Practice on web');
    await d.getByRole('button',{name:'School leaderboard'}).click();await expect(d.locator('[data-ranking-list]')).toContainText('Taylor <script>');await expect(d.locator('script')).toHaveCount(0);await d.getByRole('button',{name:'Back to game'}).click();await expect(d.locator('[data-title]')).toBeVisible();await d.getByRole('button',{name:'Close weekly game'}).click();await expect(d).toHaveCount(0);
});
test('bad bundle fails before requesting camera access',async({page})=>{
    await page.addInitScript(()=>{window.cameraRequests=0;navigator.mediaDevices.getUserMedia=async()=>{window.cameraRequests++;throw Error('must not request');};});await open(page,{badPackage:true});await expect(page.locator('[data-status]')).toContainText('incomplete');expect(await page.evaluate(()=>window.cameraRequests)).toBe(0);
});
test('permission denial is recoverable and leaves the feed accessible',async({page,browserName})=>{
    test.skip(browserName!=='chromium','Non-Chromium browsers are rejected before camera permission.');
    await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};});await open(page);await page.locator('[data-enable]').click();await expect(page.locator('[data-status]')).toContainText('Camera access was denied');await expect(page.locator('[data-enable]')).toBeEnabled();await page.getByRole('button',{name:'Close weekly game'}).click();await expect(page.locator('.weekly-game-dialog')).toHaveCount(0);
});
test('late permission after close stops every acquired camera track',async({page,browserName})=>{
    test.skip(browserName!=='chromium','Synthetic browser camera is Chromium-only.');await syntheticTracker(page);await page.addInitScript(()=>{const original=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=async c=>{const s=await original(c);await new Promise(r=>window.releasePermission=r);return s;};});await open(page);await page.locator('[data-enable]').click();await expect.poll(()=>page.evaluate(()=>Boolean(window.releasePermission))).toBe(true);await page.getByRole('button',{name:'Close weekly game'}).click();await page.evaluate(()=>window.releasePermission());await expect.poll(()=>page.evaluate(()=>gameStreams.flatMap(s=>s.getTracks()).every(t=>t.readyState==='ended'))).toBe(true);
});
test('backgrounding interrupts and releases camera without submitting a score',async({page,browserName})=>{
    test.skip(browserName!=='chromium','Synthetic browser camera is Chromium-only.');await syntheticTracker(page);await open(page);await page.locator('[data-enable]').click();await expect(page.locator('[data-start]')).toBeEnabled({timeout:15000});await page.locator('[data-start]').click();await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.locator('[data-status]')).toContainText('interrupted');await expect.poll(()=>page.evaluate(()=>gameStreams.flatMap(s=>s.getTracks()).every(t=>t.readyState==='ended'))).toBe(true);
});
test('complete practice round records playable video with score, sharing fallback and clean replay',async({page,browserName})=>{
    test.setTimeout(60000);test.skip(browserName!=='chromium','Synthetic browser camera is Chromium-only.');await syntheticTracker(page);const writes=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('easter-egg'))writes.push(r.url());});await open(page);await page.locator('[data-enable]').click();await expect(page.locator('[data-start]')).toBeEnabled({timeout:15000});await page.locator('[data-start]').click();await expect(page.locator('[data-result]')).toBeVisible({timeout:30000});await expect(page.locator('[data-final-score]')).toHaveText(/\d+ points/);
    const video=await page.evaluate(async()=>{const v=document.querySelector('[data-replay]');await v.play();return{bytes:document.querySelector('.weekly-game-dialog').videoFile.size,type:document.querySelector('.weekly-game-dialog').videoFile.type,width:v.videoWidth,height:v.videoHeight};});expect(video.bytes).toBeGreaterThan(10000);expect(video.width).toBe(720);expect(video.height).toBe(1280);expect(writes).toEqual([]);await expect.poll(()=>page.evaluate(()=>gameStreams.flatMap(s=>s.getTracks()).every(t=>t.readyState==='ended'))).toBe(true);
    await page.evaluate(()=>Object.defineProperty(navigator,'canShare',{value:()=>false,configurable:true}));await page.locator('[data-share]').click();await expect(page.locator('[data-status]')).toContainText('Download your video');await page.locator('[data-again]').click();await expect(page.locator('[data-start]')).toBeEnabled({timeout:15000});await page.getByRole('button',{name:'Close weekly game'}).click();await expect.poll(()=>page.evaluate(()=>gameStreams.flatMap(s=>s.getTracks()).every(t=>t.readyState==='ended'))).toBe(true);
});
test('real self-hosted pose model detects wrists and blank frames produce no wrists',async({page,browserName})=>{
    test.setTimeout(60000);test.skip(browserName!=='chromium','Physical Safari/Firefox GPU behavior is checked through graceful failure paths.');await page.goto('/app/?signin=1');
    const result=await page.evaluate(async()=>{
        const {WristTracker}=await import('/app/weekly-game/tracker.js');const tracker=new WristTracker(()=>{},()=>{});await tracker.start();
        const image=new Image();image.src='/tests/fixtures/weekly-game/pose.jpg';await image.decode();const canvas=new OffscreenCanvas(480,640);canvas.getContext('2d').fillRect(0,0,480,640);
        const run=async(source,timestamp)=>{const bitmap=await createImageBitmap(source);return new Promise((resolve,reject)=>{tracker.onSample=resolve;tracker.onError=reject;tracker.worker.postMessage({type:'frame',image:bitmap,timestamp},[bitmap]);});};
        try{return {pose:await run(image,100),blank:await run(canvas,200)};}finally{tracker.close();}
    });expect(result.pose.pair).toHaveLength(4);expect(result.pose.pair[2]-result.pose.pair[0]).toBeGreaterThan(.12);expect(result.blank.pair).toBeNull();
});

test('real detector plus recorder completes a still-person round at zero',async({page,browserName})=>{
    test.setTimeout(60000);test.skip(browserName!=='chromium','Real worker/video capture integration is exercised in Chromium.');
    await page.addInitScript(()=>{
        window.gameStreams=[];
        navigator.mediaDevices.getUserMedia=async()=>{
            const image=new Image();image.src='/tests/fixtures/weekly-game/pose.jpg';await image.decode();
            const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
            const ctx=canvas.getContext('2d');let frame;const draw=()=>{ctx.drawImage(image,0,0);frame=requestAnimationFrame(draw);};draw();
            const stream=canvas.captureStream(30);window.gameStreams.push(stream);
            const track=stream.getVideoTracks()[0],stop=track.stop.bind(track);track.stop=()=>{cancelAnimationFrame(frame);stop();};return stream;
        };
    });
    await open(page);await page.locator('[data-enable]').click();await expect(page.locator('[data-start]')).toBeEnabled({timeout:30000});await page.locator('[data-start]').click();await expect(page.locator('[data-result]')).toBeVisible({timeout:30000});await expect(page.locator('[data-final-score]')).toHaveText('0 points');
    await expect.poll(()=>page.evaluate(()=>gameStreams.flatMap(s=>s.getTracks()).every(t=>t.readyState==='ended'))).toBe(true);
    await page.locator('[data-replay]').evaluate(async video=>{await video.play();video.currentTime=5;});
    await page.screenshot({path:`output/weekly-game/real-still-${test.info().project.name}.png`});
});

test('unsupported browsers show a supported-browser path before any camera request',async({page,browserName})=>{test.skip(browserName==='chromium','Chromium is supported');await page.addInitScript(()=>{window.cameraRequests=0;navigator.mediaDevices.getUserMedia=async()=>{window.cameraRequests++;throw Error('unexpected');};});await open(page);await expect(page.locator('[data-status]')).toContainText('Chrome');await expect(page.locator('[data-enable]')).toBeHidden();expect(await page.evaluate(()=>window.cameraRequests)).toBe(0);await page.getByRole('button',{name:'School leaderboard'}).click();await expect(page.locator('[data-ranking-list]')).toContainText('Taylor');});

test('selected weekly game is visible in the real feed without a feature flag',async({page})=>{
    await page.goto('/app/?demo=1&signin=1');await page.evaluate(async release=>{const {DemoAPI}=await import('/app/demo-api.js');DemoAPI.prototype.getWeeklyGame=async()=>({release,discovery_required:false});DemoAPI.prototype.getWeeklyGameLeaderboard=async()=>({entries:[]});},release);
    await page.getByRole('button',{name:/^sign in$/i}).click();await expect(page.locator('#weeklyGameButton')).toBeVisible();await expect(page.locator('#weeklyGameTitle')).toHaveText('67 Challenge');await page.locator('#weeklyGameButton').click();await expect(page.getByRole('dialog',{name:'Weekly game'})).toBeVisible();await expect(page.locator('[data-instruction]')).toBeVisible();
});

test('first-time web players unlock leaderboard access without creating a ranked run',async({page})=>{
    await page.goto('/app/?signin=1');
    await page.evaluate(async release=>{
        const {createWeeklyGame}=await import('/app/weekly-game/index.js');window.gameCalls=[];let unlocked=false;
        const api={getWeeklyGame:async()=>({release}),getWeeklyGameLeaderboard:async()=>{gameCalls.push('leaderboard');return {unlocked,entries:unlocked?[{rank:1,name:'Taylor',score:67}]:[]};},unlockWeeklyGame:async()=>{gameCalls.push('unlock');unlocked=true;}};
        window.weeklyGame=createWeeklyGame({api});await weeklyGame.open();
    },release);
    await page.getByRole('button',{name:'School leaderboard'}).click();await expect(page.locator('[data-ranking-list]')).toContainText('Taylor');expect(await page.evaluate(()=>gameCalls)).toEqual(['leaderboard','unlock','leaderboard']);
});
