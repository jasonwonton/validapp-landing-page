import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateWebRelease,validEvidence} from '../../app/weekly-game/web-game.js';
import {WEB_PACKAGE} from '../../app/weekly-game/web-assets.js';
const release=JSON.parse(await readFile(new URL('../../tests/fixtures/love-flap/release.json',import.meta.url)));
test('only the verified native endless-flight release family reaches the sandbox',()=>{
 assert.equal(validateWebRelease(release),release);
 for(const change of [{runtime:'camera-v1'},{score_validator:'rose-flight-v2'},{renderer_version:3},{rules:{pipe_gap:999}},{bundle:{...release.bundle,sha256:'f'.repeat(64)}}])assert.throws(()=>validateWebRelease({...release,...change}));
});
test('game evidence is bounded, ordered integer input, never a client-provided score',()=>{
 assert(validEvidence({frames:120,taps:[1,30,60]}));
 for(const e of [{frames:0,taps:[]},{frames:216001,taps:[]},{frames:120,taps:[2,1]},{frames:120,taps:[1,1]},{frames:120,taps:[121]},{frames:120,taps:[.5]},{frames:120,taps:[],junk:'x'.repeat(128000)}])assert(!validEvidence(e));
});
test('published package and sandbox scripts are content-bound with no network access',async()=>{
 const bytes=await readFile(new URL(`../../assets/weekly-game/packages/${WEB_PACKAGE.sha256}.six7game.json`,import.meta.url));assert.equal(bytes.length,WEB_PACKAGE.byteSize);assert.equal(createHash('sha256').update(bytes).digest('hex'),WEB_PACKAGE.sha256);
 const html=await readFile(new URL(`../..${WEB_PACKAGE.host}`,import.meta.url),'utf8');assert(html.includes("connect-src 'none'"));assert(!html.includes("script-src 'unsafe-inline'"));assert(!html.includes("'unsafe-eval'"));for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)){const hash=createHash('sha256').update(script[1]).digest('base64');assert(html.includes(`'sha256-${hash}'`));}
});
