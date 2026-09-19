import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createCameraGame,CameraEvidence} from '../../app/weekly-game/scoring.js';
import {WristContinuity} from '../../app/weekly-game/tracker.js';
import {verifyPackage,validateRelease} from '../../app/weekly-game/package.js';
const read=async name=>JSON.parse(await readFile(new URL(`../../tests/fixtures/weekly-game/${name}`,import.meta.url)));
const vectors=await read('scoring-vectors.json'),release=await read('release.json'),pkg=await read('package.json');
for(const v of vectors)test(`web / downloaded / server fixture: ${v.name}`,()=>{
    const {mechanic,steps,...rest}=v.rules, input={protocol:1,rules:{...rest,game:{mechanic,steps}}};
    const game=createCameraGame();game.start(input);
    const sandbox=vm.createContext({});vm.runInContext(pkg.script,sandbox,{timeout:100});sandbox.Six7Camera.start(input);
    assert.equal(game.frame({samples:v.samples}).score,v.expected);
    assert.equal(sandbox.Six7Camera.frame({samples:v.samples}).score,v.expected);
});
test('still wrists score zero; ten smooth deliberate swaps score exactly ten',()=>{
    for(const moving of [false,true]){
        const game=createCameraGame();game.start({protocol:1,rules:release.rules});
        const evidence=new CameraEvidence(10),continuity=new WristContinuity();
        for(let ms=0;ms<10000;ms+=34){const d=moving?.2*Math.cos(Math.PI*ms/1000):.2;const {pair,hardBreak}=continuity.observe([.25,.5+d,.75,.5-d],ms);const row=evidence.append(ms,pair,hardBreak);if(row)game.frame({samples:[row]});}
        assert.equal(game.frame({samples:[]}).score,moving?10:0);
    }
});
test('loss, overlap and implausible jumps cannot manufacture a crossing',()=>{
    const c=new WristContinuity();assert.equal(c.observe([.25,.7,.75,.3],0).hardBreak,false);
    assert.equal(c.observe([.25,.3,.75,.7],34).hardBreak,true);
    assert.equal(c.observe([.48,.7,.51,.3],68).hardBreak,true);
    c.observe([.25,.7,.75,.3],102);assert.equal(c.observe([.25,.3,.75,.7],600).hardBreak,true);
    const game=createCameraGame();game.start({protocol:1,rules:release.rules});assert.equal(game.frame({samples:[[0,2500,7000,7500,3000],[100],[200,2500,3000,7500,7000]]}).score,0);
});
test('evidence uses monotonic captured time, 30 ms spacing, loss grace, hard resets and scoring cutoff',()=>{
    const e=new CameraEvidence(10);assert.deepEqual(e.append(0,[.2,.7,.8,.3]),[0,2000,7000,8000,3000]);assert.equal(e.append(29,[.2,.3,.8,.7],true),null);
    assert.deepEqual(e.append(34,[.2,.3,.8,.7]),[34]);assert.equal(e.append(34,[.2,.7,.8,.3]),null);
    assert.deepEqual(e.append(68,[.2,.3,.8,.7]),[68,2000,3000,8000,7000]);assert.equal(e.append(100,null),null);assert.deepEqual(e.append(368,null),[368]);
    assert.equal(e.append(400,null),null);assert.equal(e.append(10000,[.2,.7,.8,.3]),null);assert.equal(e.append(NaN,[]),null);assert.equal(e.payload.frames,600);
});
test('current immutable 67 package is verified without evaluating downloaded code',async()=>{
    const bytes=await readFile(new URL('../../tests/fixtures/weekly-game/package.json',import.meta.url));const result=await verifyPackage(release,bytes);assert.match(result.assets.instruction,/^data:image\/gif/);assert.match(result.assets.music,/^data:audio\/mp4/);
    const corrupted=Buffer.from(bytes);corrupted[40]^=1;await assert.rejects(verifyPackage(release,corrupted),/incomplete/);
});
test('unknown runtimes, validators and malformed rules never reach the camera',()=>{
    for(const override of [{runtime:'web-v1'},{camera_mode:'unknown'},{score_validator:'unknown'},{rules:{...release.rules,duration_seconds:999}},{rules:{...release.rules,game:{mechanic:'new-game',steps:[]}}}])assert.throws(()=>validateRelease({...release,...override}));
});
