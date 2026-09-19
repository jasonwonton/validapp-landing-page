// Package code runs only in an opaque-origin sandbox, never in the signed-in app.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../../',import.meta.url);
const sha='529da2385e5c772909c9b808b1f3c4038ce56a08668f343b88abdb88733ee6f8';
const bytes=await readFile(new URL(`assets/weekly-game/packages/${sha}.six7game.json`,root));
if(createHash('sha256').update(bytes).digest('hex')!==sha || bytes.length!==3019456)throw Error('Love Flap package changed');
const pkg=JSON.parse(bytes);
const bootstrap=`(()=>{const token=location.hash.slice(1);const send=m=>parent.postMessage({bridge:'valid-weekly-web',token,...m},'*');window.SIX7_ASSETS=${JSON.stringify(pkg.assets).replaceAll('<','\\u003c')};window.webkit={messageHandlers:{six7Game:{postMessage:send}}};window.addEventListener('message',async({source,data:m})=>{if(source!==parent||m?.bridge!=='valid-weekly-web'||m.token!==token)return;try{if(m.type==='start'){window.Six7Game.start(m.config);}else if(m.type==='pause'){window.Six7Game.pause();}else if(m.type==='share'){const image=await window.Six7Game.shareCard(m.result);send({type:'share',session:m.session,image});}}catch(_){send({type:'error',message:'The game could not complete this action.'});}});})();`;
const game=pkg.script.replace(/<\/script/gi,'<\\/script');
const digest=s=>createHash('sha256').update(s).digest('base64');
const policy=`default-src 'none'; script-src 'sha256-${digest(bootstrap)}' 'sha256-${digest(game)}'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
const html=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Love Flap</title><style>${pkg.style}</style></head><body><div id="game"></div><script>${bootstrap}</script><script>${game}</script></body></html>`;
const hash=createHash('sha256').update(html).digest('hex').slice(0,20);const dir=new URL(`assets/weekly-game/web/${hash}/`,root);await mkdir(dir,{recursive:true});await writeFile(new URL('index.html',dir),html);
await writeFile(new URL('app/weekly-game/web-assets.js',root),`// Generated from the exact published Love Flap package.\nexport const WEB_PACKAGE={sha256:'${sha}',byteSize:${bytes.length},host:'/assets/weekly-game/web/${hash}/index.html'};\n`);
await writeFile(new URL('assets/weekly-game/rose.png',root),Buffer.from(pkg.assets.rose.split(',')[1],'base64'));
console.log('Love Flap sandbox',hash);
