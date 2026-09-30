import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {verifyPackage,validateRelease} from '../../app/weekly-game/package.js';
import {webPlayable,weeklyGameEntry,MIRRORED_PACKAGES,CAMERA_MODES} from '../../app/weekly-game/compat.js';
import {CAMERA_HOSTS} from '../../app/weekly-game/camera-hosts.js';
import {parseOutput,parseSprite,advanceSprite} from '../../app/weekly-game/package-engine.js';
import {CameraEvidence} from '../../app/weekly-game/scoring.js';
import {WristContinuity} from '../../app/weekly-game/tracker.js';

const root=new URL('../../',import.meta.url);
const release=JSON.parse(await readFile(new URL('tests/fixtures/weekly-game-v2/release.json',root)));
const bytes=await readFile(new URL(`assets/weekly-game/packages/${release.bundle.sha256}.six7game.json`,root));
const hex=b=>createHash('sha256').update(b).digest('hex');
const b64=b=>createHash('sha256').update(b).digest('base64');

test('the live Scuba Challenge (hand-package-v2) is mirrored, reviewed and playable on the web',()=>{
    assert.equal(release.id,'2e0f74ae08171f189fcdcf32bc954a0ae45ce7fe768f3255eca9f8681f3f57a4');
    assert.ok(MIRRORED_PACKAGES.has(release.bundle.sha256));
    assert.equal(webPlayable(release),true);assert.equal(weeklyGameEntry(release),'play');
    assert.deepEqual(CAMERA_MODES,['hand-package-v1','hand-package-v2']);
});

test('v2 games the web cannot run still get a friendly entry; the update notice does not',()=>{
    const id='a'.repeat(64);
    // Not mirrored/reviewed (e.g. next week's game before a web release).
    assert.equal(webPlayable({...release,id,bundle:{...release.bundle,sha256:'b'.repeat(64)}}),false);
    assert.equal(weeklyGameEntry({...release,id,bundle:{...release.bundle,sha256:'b'.repeat(64)}}),'app-only');
    // The iOS-only "hands" tracking profile (hand centres, not wrists).
    assert.equal(weeklyGameEntry({...release,rules:{...release.rules,camera_tracking:{version:1,sample_rate_hz:30,profile:'hands'}}}),'app-only');
    // Touch games run in the iOS web view only.
    assert.equal(weeklyGameEntry({id,runtime:'web-v1',renderer_version:1,game_id:'tap-rush',title:'Tap Rush',score_validator:'self-reported-v1'}),'app-only');
    assert.equal(weeklyGameEntry({id,runtime:'web-v1',renderer_version:1,game_id:'update-required',title:'Update Valid',score_validator:'update-required-v1'}),null);
    assert.equal(weeklyGameEntry({...release,id,bundle:{...release.bundle,sha256:'b'.repeat(64)},title:' '}),null);
    assert.equal(weeklyGameEntry(null),null);
});

test('v2 package bytes and script are hash-pinned before anything runs',async()=>{
    const pkg=await verifyPackage(release,bytes);
    assert.equal(pkg.host,CAMERA_HOSTS[release.bundle.sha256].host);
    assert.match(pkg.assets.instruction,/^data:image\/gif;base64,/);assert.match(pkg.assets.music,/^data:audio\/mp4;base64,/);assert.match(pkg.assets.brand_logo,/^data:image\/png;base64,/);
    assert.equal(pkg.presentation.counter.enabled,true);
    const corrupted=Buffer.from(bytes);corrupted[60]^=1;await assert.rejects(verifyPackage(release,corrupted),/incomplete/);
    // A self-consistent package (matching manifest hash) with a different script is refused.
    const json=JSON.parse(bytes);json.script+=';globalThis.extra=1';const forged=Buffer.from(JSON.stringify(json));
    await assert.rejects(verifyPackage({...release,bundle:{...release.bundle,sha256:hex(forged),byte_size:forged.length}},forged),/newer web player/);
});

test('v2 releases are bounded before the package loads',()=>{
    assert.equal(validateRelease(release),release);
    for(const override of [{score_validator:'hand-motion-v1'},{max_score:undefined},{max_score:0},{camera_mode:'hand-package-v3'},
        {rules:{...release.rules,game:[]}},{rules:{...release.rules,game:{blob:'x'.repeat(17000)}}},{rules:{...release.rules,duration_seconds:99}},
        {rules:{...release.rules,camera_tracking:{version:1,sample_rate_hz:60,profile:'responsive'}}},{rules:{...release.rules,instructions:'x'.repeat(300)}}])
        assert.throws(()=>validateRelease({...release,...override}),/newer web player/);
});

test('the sandbox host admits exactly the reviewed script and bridge, nothing else',async()=>{
    const {host,script}=CAMERA_HOSTS[release.bundle.sha256];
    const html=await readFile(new URL(host.slice(1),root),'utf8');
    assert.equal(host,`/assets/weekly-game/camera/${hex(html).slice(0,20)}/index.html`);
    const pkg=JSON.parse(bytes);assert.equal(hex(pkg.script),script);
    const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
    assert.equal(scripts.length,2);assert.equal(scripts[1],pkg.script.replace(/<\/script/gi,'<\\/script'));
    const csp=html.match(/content="([^"]+)"/)[1];
    assert.equal(csp.match(/script-src ([^;]+)/)[1],scripts.map(s=>`'sha256-${b64(s)}'`).join(' '));
    for(const directive of ["connect-src 'none'","media-src 'none'","frame-src 'none'","worker-src 'none'","default-src 'none'","form-action 'none'"])assert.ok(csp.includes(directive),directive);
});

test('package responses are held to the native host bounds',()=>{
    const ok=JSON.stringify({score:3,prompt:'Wave!',targets:[],sprites:[['water',5000,5000,1000,0,100],['bubble',100,9800,80,0,55,10,-20,0,90]]});
    const state=parseOutput(ok,2);assert.equal(state.score,3);assert.equal(state.sprites.length,2);
    assert.equal(parseOutput(ok,4),null,'score may never go down');
    assert.equal(parseOutput(JSON.stringify({score:13,prompt:'',targets:[]}),2),null,'at most ten points per response');
    assert.equal(parseOutput(JSON.stringify({score:0,prompt:'x'.repeat(49),targets:[]})),null);
    assert.equal(parseOutput(JSON.stringify({score:0,prompt:'',targets:[],sprites:[['Water',0,0,100,0,100]]})),null,'one malformed sprite rejects the response');
    assert.equal(parseOutput(JSON.stringify({score:0,prompt:'',targets:[],sprites:Array(97).fill(['a',0,0,100,0,100])})),null);
    assert.equal(parseOutput(JSON.stringify({score:0,prompt:'',targets:[{hand:'screen_left',x_min:0,x_max:10,y_min:0,y_max:10}]})).targets.length,1);
    assert.equal(parseOutput(JSON.stringify({score:0,prompt:'',targets:[{hand:'nose',x_min:0,x_max:10,y_min:0,y_max:10}]})),null);
    assert.equal(parseOutput('x'.repeat(16385)),null);assert.equal(parseOutput('not json'),null);
    assert.equal(parseSprite(['fish',0,0,9,0,100]),null);assert.equal(parseSprite(['fish',0,0,100,0,101]),null);
    const moving=parseSprite(['fish',5000,5000,100,0,100,10000,0,0,0]);
    assert.equal(advanceSprite(moving,1).x,.75,'extrapolates at most 0.25 s');assert.equal(advanceSprite(moving,-1).x,.5);
});

test('Scuba through the web host path: a real wave scores and a still pair scores zero',()=>{
    // Same batching as package-engine: evidence rows (≤10 per call) plus every detection.
    const pkg=JSON.parse(bytes);
    for(const moving of [false,true]){
        const sandbox=vm.createContext({});vm.runInContext(pkg.script,sandbox,{timeout:1000});
        const game=sandbox.Six7Camera;game.start({protocol:1,seed:7,rules:release.rules,tracking:release.rules.camera_tracking});
        const evidence=new CameraEvidence(10),continuity=new WristContinuity();let score=0;
        for(let ms=0;ms<10000;ms+=33){
            const x=moving?.72+.1*Math.sin(2*Math.PI*2.5*ms/1000):.72;const hands=[.4,.62,x,.6];
            const {pair,hardBreak}=continuity.observe(hands,ms);const row=evidence.append(ms,pair,hardBreak);
            const out=game.frame({elapsed_ms:ms,samples:row?[row]:[],hands:[[ms,2,...hands.map(v=>Math.round(v*10000))]]});
            assert.ok(out.score>=score);score=out.score;
        }
        if(moving)assert.ok(score>=45 && score<=50,`2.5 Hz wave for 10 s is ~50 flips, got ${score}`);else assert.equal(score,0);
    }
});
