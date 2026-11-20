import {WEB_PACKAGE} from './web-assets.js';
import {uiIcon} from '../ui-icons.js';
import {shareResultFile,snapchatGlyph} from './share.js';
const channel='valid-weekly-web';
const pendingKey=id=>`valid.web-game.pending.v1.${id}`;
export function validateWebRelease(r){
    if(!r || !/^[a-f0-9]{64}$/.test(r.id) || r.runtime!=='web-v1' || r.game_id!=='rose-flight' || r.renderer_version!==1 || r.score_validator!=='rose-flight-endless-v1' || ![100,120,130,140,160].includes(r.rules?.pipe_gap) || r.bundle?.sha256!==WEB_PACKAGE.sha256 || r.bundle?.byte_size!==WEB_PACKAGE.byteSize)throw Error('This game needs a newer web player. Please update Valid and try again.');
    return r;
}
export function validEvidence(e){return Boolean(e&&Number.isInteger(e.frames)&&e.frames>=1&&e.frames<=216000&&Array.isArray(e.taps)&&e.taps.length<=18000&&e.taps.every((t,i)=>Number.isInteger(t)&&t>=1&&t<=e.frames&&(!i||t>e.taps[i-1]))&&JSON.stringify(e).length<=128000);}
export function createWebGame({api,onClose=()=>{},getProfilePhoto=()=>null}){
    let dialog,frame,release,run,abort,token,session,generation=0,phase='closed',timer,shareTimer,score,imageURL,pending,owner,hadHistory=false,saving=false,destination;
    const el=s=>dialog?.querySelector(s);
    const status=s=>{if(dialog)el('[data-status]').textContent=s;};
    const show=(s,v)=>{if(dialog)el(s).hidden=!v;};
    const send=(type,body={})=>frame?.contentWindow?.postMessage({bridge:channel,token,type,...body},'*');
    const clearImage=()=>{if(imageURL)URL.revokeObjectURL(imageURL);imageURL=null;};
    function writePending(value){pending=value;try{if(value)localStorage.setItem(pendingKey(owner),JSON.stringify(value));else localStorage.removeItem(pendingKey(owner));}catch(_){if(value)status('Keep this game open until your score finishes saving.');}}
    function readPending(){try{const raw=localStorage.getItem(pendingKey(owner));if(!raw||raw.length>140000)return null;const p=JSON.parse(raw);validateWebRelease(p.release);if(!validEvidence(p.evidence)||typeof p.runId!=='string'||Date.now()-p.createdAt>3600000)return null;return p;}catch(_){return null;}}
    function close(fromHistory=false){
        generation++;abort?.abort();clearTimeout(timer);clearTimeout(shareTimer);send('pause');frame?.remove();frame=null;clearImage();
        window.removeEventListener('message',message);window.removeEventListener('popstate',popstate);window.removeEventListener('pagehide',pagehide);document.removeEventListener('visibilitychange',visibility);
        if(!dialog)return;const old=dialog;dialog=null;phase='closed';saving=false;old.close();old.remove();if(!fromHistory&&hadHistory&&history.state?.weeklyGame)history.back();hadHistory=false;onClose();
    }
    const popstate=()=>close(true),pagehide=()=>close(true);
    const pause=()=>{if(phase==='playing'){send('pause');status('Paused. Tap the game to resume.');}};
    const visibility=()=>{if(document.hidden)pause();};
    async function open(featured){
        close();const current=++generation;abort=new AbortController();owner=String(api.user?.id||'');if(!owner)throw Error('Sign in again to play.');
        release=validateWebRelease(featured.release);destination=undefined;pending=readPending();if(pending)release=pending.release;
        dialog=document.createElement('dialog');dialog.className='weekly-game-dialog web-game-dialog';dialog.setAttribute('aria-label','Weekly game');
        // EasterEggWebGameView: Close / title / Pause above the game; the result is the
        // score, Share on Snapchat (with the system share as More…), then
        // [Leaderboard] [Play again]. Leaderboard returns to the game home.
        dialog.innerHTML=`<header class="weekly-game-header"><button data-close aria-label="Close game">${uiIcon('close')}</button><strong data-title></strong><button data-pause aria-label="Pause game">${uiIcon('pause-fill')}</button></header><div class="weekly-game-content"><div data-player class="web-game-player"></div><section data-result class="weekly-game-result" hidden><h2 data-score></h2><img data-poster hidden width="1080" height="1920" decoding="async" alt="Love Flap score poster with the rose, pipes, and validapp.lol"><div class="weekly-game-share-row"><button class="weekly-game-snapchat" data-share-snapchat disabled>${snapchatGlyph()}<span>Share on Snapchat</span></button><button class="weekly-game-more" data-share disabled>More…</button></div><div class="weekly-game-result-actions"><button data-leaderboard>Leaderboard</button><button data-again>Play again</button></div></section><p data-status class="weekly-game-status" role="status" aria-live="polite">Loading this week's game…</p><div class="weekly-game-actions"><button data-retry hidden>Retry</button><button data-discard hidden>Discard round and play again</button><button data-back-home hidden>Back to leaderboard</button></div></div>`;
        el('[data-title]').textContent=release.title;document.body.append(dialog);dialog.showModal();history.pushState({...history.state,weeklyGame:true},'');hadHistory=true;
        el('[data-close]').onclick=()=>close();dialog.addEventListener('cancel',e=>{e.preventDefault();close();});el('[data-pause]').onclick=pause;
        el('[data-again]').onclick=()=>{writePending(null);void start();};el('[data-retry]').onclick=()=>pending?void save():void start();el('[data-discard]').onclick=()=>{writePending(null);void start();};el('[data-share]').onclick=()=>share('more');el('[data-share-snapchat]').onclick=()=>share('snapchat');el('[data-leaderboard]').onclick=()=>close();el('[data-back-home]').onclick=()=>close();
        window.addEventListener('message',message);window.addEventListener('popstate',popstate);window.addEventListener('pagehide',pagehide);document.addEventListener('visibilitychange',visibility);
        if(current!==generation)return;
        if(pending){phase='saving';status('Finishing your previous round…');mount();}else await start();
    }
    async function start(){
        if(!dialog||phase==='starting'||saving)return;
        const current=++generation;phase='starting';clearTimeout(timer);clearTimeout(shareTimer);frame?.remove();frame=null;clearImage();score=undefined;show('[data-result]',false);show('[data-player]',true);show('[data-retry]',false);show('[data-discard]',false);show('[data-back-home]',false);el('[data-share]').disabled=true;el('[data-share-snapchat]').disabled=true;el('[data-pause]').disabled=true;status('Starting game…');
        try{
            destination=await profileImage(getProfilePhoto());if(current!==generation)return;
            await api.unlockWeeklyGame({signal:abort.signal});if(current!==generation)return;
            const next=await api.startWeeklyGameRun(release.id,{signal:abort.signal});if(current!==generation)return;
            if(next.release_id!==release.id||next.version!==release.renderer_version||!Number.isInteger(next.seed)||next.seed<0||next.seed>4294967295||!/^[a-f0-9-]{36}$/i.test(next.run_id))throw Error('The game session could not be verified. Please retry.');
            run=next;mount();
        }catch(e){if(current===generation)fail(e.message||'Could not start a round. Check your connection and retry.');}
    }
    function mount(){
        token=crypto.randomUUID();session=crypto.randomUUID();frame=document.createElement('iframe');frame.title='Love Flap — tap or press space to flap';frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('referrerpolicy','no-referrer');frame.src=`${WEB_PACKAGE.host}#${token}`;el('[data-player]').replaceChildren(frame);
        timer=setTimeout(()=>fail('The game took too long to load. Check your connection and retry.'),20000);
    }
    function fail(message){if(!dialog)return;clearTimeout(timer);clearTimeout(shareTimer);send('pause');phase=pending?'saving-error':'error';el('[data-pause]').disabled=true;status(message);show('[data-retry]',true);el('[data-retry]').textContent=pending?'Retry saving score':'Retry';show('[data-discard]',Boolean(pending));show('[data-back-home]',!pending);}
    async function message(event){
        const m=event.data;if(!dialog||event.source!==frame?.contentWindow||m?.bridge!==channel||m.token!==token)return;
        if(m.type==='ready'){
            if(pending){send('start',{config:{protocol:1,session,seed:67,rules:release.rules,reduceMotion:true}});return;}
            if(phase!=='starting'||!run)return;send('start',{config:{protocol:1,session,seed:run.seed,rules:release.rules,destination,reduceMotion:matchMedia('(prefers-reduced-motion: reduce)').matches}});return;
        }
        if(m.session!==session)return;
        if(m.type==='loaded'){
            clearTimeout(timer);if(pending){void save();return;}phase='playing';el('[data-pause]').disabled=false;status('Tap or press space to flap through the pipes.');frame.focus();if(document.hidden)pause();
        }else if(m.type==='complete'&&phase==='playing'){
            if(!validEvidence(m.evidence)){fail('This round returned an invalid result. Please retry.');return;}
            writePending({release,runId:run.run_id,evidence:m.evidence,createdAt:Date.now()});void save();
        }else if(m.type==='share'&&phase==='result'){
            clearTimeout(shareTimer);try{if(typeof m.image!=='string'||m.image.length>6000000||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(m.image))throw Error();const blob=new Blob([Uint8Array.from(atob(m.image.split(',')[1]),c=>c.charCodeAt(0))],{type:'image/png'});const bitmap=await createImageBitmap(blob);const valid=bitmap.width===1080&&bitmap.height===1920;bitmap.close();if(!valid)throw Error();if(!dialog||m.token!==token)return;clearImage();imageURL=URL.createObjectURL(blob);dialog.shareFile=new File([blob],`love-flap-${score}.png`,{type:'image/png'});el('[data-poster]').src=imageURL;el('[data-share]').disabled=false;el('[data-share-snapchat]').disabled=false;status('');}catch(_){status('Score saved, but the image could not be created.');}
        }else if(m.type==='error')fail('The game stopped unexpectedly. Please retry.');
    }
    async function save(){
        if(!pending||saving||!dialog)return;const current=generation,p=pending;saving=true;phase='saving';show('[data-retry]',false);show('[data-discard]',false);el('[data-pause]').disabled=true;send('pause');status('Saving your score…');
        try{const result=await api.finishWeeklyGameRun(p.release.id,p.runId,p.evidence,{signal:abort.signal});if(current!==generation)return;if(!Number.isInteger(result.score)||result.score<0||result.score>1000000)throw Error('The saved score could not be verified.');score=result.score;writePending(null);phase='result';el('[data-score]').textContent=`Score: ${score}`;show('[data-player]',false);show('[data-result]',true);status('Score saved. Preparing your image…');send('share',{session,result:{score,title:release.title}});shareTimer=setTimeout(()=>status('Score saved, but the image took too long to load.'),15000);
        }catch(e){if(current===generation)fail(e.message||'Could not save your score. Retry when connected.');}finally{if(current===generation)saving=false;}
    }
    async function share(target){const file=dialog?.shareFile;if(!file)return;const message=await shareResultFile(file,{target,title:release.title,text:`I got ${score} on ${release.title}! validapp.lol`});if(message&&dialog)status(message);}
    return {open,close};
}

// Match the native boundary: only a small image reaches the isolated game.
async function profileImage(url){
    if(!url)return undefined;
    try{
        const parsed=new URL(url,location.href);if(parsed.protocol!=='https:' && parsed.origin!==location.origin)return undefined;
        const image=new Image();image.crossOrigin='anonymous';image.referrerPolicy='no-referrer';
        await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{image.src='';reject(Error());},3000);image.onload=()=>{clearTimeout(timer);resolve();};image.onerror=()=>{clearTimeout(timer);reject(Error());};image.src=parsed.href;});
        if(image.naturalWidth>4096||image.naturalHeight>4096)return undefined;
        const c=document.createElement('canvas');c.width=c.height=128;c.getContext('2d').drawImage(image,0,0,128,128);return c.toDataURL('image/jpeg',.8);
    }catch(_){return undefined;}
}
