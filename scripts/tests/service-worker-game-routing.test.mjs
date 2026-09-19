import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../../app/service-worker.js',import.meta.url),'utf8');
function harness(){const events={};const self={location:{origin:'https://validapp.lol'},addEventListener:(name,fn)=>{events[name]=fn;}};vm.runInNewContext(source,{self,URL,caches:{open:async()=>({match:async()=> 'cached app shell'})},fetch:async()=> 'network'});return request=>{let response;events.fetch({request:{method:'GET',...request},respondWith:r=>{response=r;}});return response;};}
test('only top-level app navigation can use the offline HTML shell',async()=>{const route=harness();assert.equal(await route({url:'https://validapp.lol/app/?tab=feed',mode:'navigate',destination:'document'}),'cached app shell');});
test('sandbox game navigation never receives the cached authenticated app HTML',()=>{const route=harness();for(const url of ['https://validapp.lol/assets/weekly-game/web/abc/index.html','https://validapp.lol/app/'])assert.equal(route({url,mode:'navigate',destination:'iframe'}),undefined);});
test('non-app top-level navigations and authenticated API reads remain network-only',()=>{const route=harness();assert.equal(route({url:'https://validapp.lol/privacy-policy.html',mode:'navigate',destination:'document'}),undefined);assert.equal(route({url:'https://validapp.lol/api/v1/easter-egg/featured',mode:'cors',destination:''}),undefined);});
