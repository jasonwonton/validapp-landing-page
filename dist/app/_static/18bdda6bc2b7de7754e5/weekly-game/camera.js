import { downloadPackage } from './package.js';
import { createCameraGame, CameraEvidence } from './scoring.js';
import { WristTracker } from './tracker.js';
import { cameraGameSupport } from './support.js';
import { GameRecording, recordingType } from './recording.js';

const cssURL=new URL('./styles.css',import.meta.url).href;
const text=(root,selector,value)=>{ root.querySelector(selector).textContent=String(value ?? ''); };
const show=(root,selector,visible)=>{ root.querySelector(selector).hidden=!visible; };
const color=(v,fallback)=>/^#[a-fA-F0-9]{6}$/.test(v||'')?v:fallback;
const clamp=(v,lo,hi,fallback)=>Number.isFinite(v)?Math.min(hi,Math.max(lo,v)):fallback;

export function createCameraWeeklyGame({api,onClose=()=>{}}) {
    let dialog,release,pkg,abort,generation=0,stream,tracker,recording,raf,wakeLock,videoURL,phase='closed',engine,evidence,scene;
    let countStart=0,playStart=0,lastPair=null,lastPairTime=-Infinity,pointTime=-Infinity,finishing=false,hadHistory=false,overlays=[];
    const supported=()=>Boolean(navigator.mediaDevices?.getUserMedia && recordingType());
    const status=message=>dialog && text(dialog,'[data-status]',message);
    const stopCapture=()=>{
        cancelAnimationFrame(raf); tracker?.close(); tracker=null;
        stream?.getTracks().forEach(t=>t.stop()); stream=null;
        recording?.close(); recording=null;
        wakeLock?.release().catch(()=>{}); wakeLock=null;
        if (dialog) dialog.querySelector('[data-source]').srcObject=null;
    };
    const revoke=()=>{
        const replay=dialog?.querySelector('[data-replay]');
        if(replay){replay.pause();replay.removeAttribute('src');replay.load();delete dialog.videoFile;}
        if (videoURL) URL.revokeObjectURL(videoURL); videoURL=null;
    };
    function close(fromHistory=false) {
        if (!dialog) return;
        generation++; abort?.abort(); phase='closed'; stopCapture(); revoke();
        const old=dialog;dialog=null;old.close();old.remove();
        document.removeEventListener('visibilitychange',visibility); window.removeEventListener('pagehide',pagehide); window.removeEventListener('popstate',popstate);
        if (!fromHistory && hadHistory && history.state?.weeklyGame) history.back();
        hadHistory=false;onClose();
    }
    const popstate=()=>close(true);
    const pagehide=()=>close(true);
    function visibility() {
        if (document.hidden && ['preparing','ready','countdown','playing','reaction','finishing'].includes(phase)) interrupt('Round interrupted when you left the game. Tap Try again to start a fresh round.');
    }
    function interrupt(message) {
        if (!dialog || phase==='closed' || phase==='result') return;
        generation++; phase='error'; stopCapture();
        show(dialog,'[data-camera]',false);show(dialog,'[data-intro]',true);show(dialog,'[data-audio-label]',true);show(dialog,'[data-start]',false);show(dialog,'[data-enable]',true);
        const button=dialog.querySelector('[data-enable]');button.disabled=false;button.textContent='Try again';status(message);
    }
    async function open(providedFeatured) {
        close();
        if (!document.querySelector('link[data-weekly-game-css]')) { const link=document.createElement('link');link.rel='stylesheet';link.href=cssURL;link.dataset.weeklyGameCss='';document.head.append(link); }
        const current=++generation;abort=new AbortController();phase='loading';
        dialog=document.createElement('dialog');dialog.className='weekly-game-dialog';dialog.setAttribute('aria-label','Weekly game');
        dialog.innerHTML=`<header class="weekly-game-header"><button type="button" data-close aria-label="Close weekly game">‹ <span>Inbox</span></button><strong>Weekly game</strong><button type="button" data-leaderboard aria-label="School leaderboard">Leaderboard</button></header>
        <div class="weekly-game-content"><section data-intro class="weekly-game-intro"><span class="weekly-game-eyebrow">THIS WEEK’S CHALLENGE</span><h1 data-title>Loading game…</h1><img data-instruction hidden alt="How to play the hand challenge" decoding="async" width="220" height="220"><p data-instructions></p><p class="weekly-game-practice">Practice on web · leaderboard scores stay on iOS for now</p></section>
        <div data-camera class="weekly-game-camera" hidden><video data-source class="weekly-game-source" muted playsinline></video><canvas data-canvas width="720" height="1280" aria-label="Live camera with game score"></canvas><div class="weekly-game-tracking" data-tracking role="status">Keep both hands in view</div></div>
        <section data-result class="weekly-game-result" hidden><span class="weekly-game-eyebrow">YOUR SCORE · PRACTICE</span><h2 data-final-score></h2><p>How many can your friends get?</p><video data-replay controls playsinline aria-label="Your challenge video"></video><div class="weekly-game-actions"><button type="button" data-share>Share video</button><a data-download download>Download video</a><button type="button" data-again>Play again</button></div></section>
        <section data-rankings class="weekly-game-rankings" hidden><h2>School leaderboard</h2><p data-ranking-note></p><ol data-ranking-list></ol><button type="button" data-back>Back to game</button></section>
        <p data-status class="weekly-game-status" role="status" aria-live="polite">Loading this week’s game…</p>
        <div class="weekly-game-controls"><label data-audio-label><input data-audio type="checkbox" checked> Include my microphone</label><button type="button" data-enable disabled>Enable camera</button><button type="button" data-start hidden disabled>Start</button><small data-privacy>Your camera stays on this device. You choose whether to share your video.</small></div></div>`;
        document.body.append(dialog);dialog.showModal();
        history.pushState({...history.state,weeklyGame:true},'');hadHistory=true;
        dialog.querySelector('[data-close]').onclick=()=>close();dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
        dialog.querySelector('[data-enable]').onclick=enableCamera;dialog.querySelector('[data-start]').onclick=startRound;
        dialog.querySelector('[data-again]').onclick=()=>{revoke();show(dialog,'[data-result]',false);show(dialog,'[data-intro]',true);enableCamera();};
        dialog.querySelector('[data-share]').onclick=shareVideo;
        dialog.querySelector('[data-leaderboard]').onclick=leaderboard;
        dialog.querySelector('[data-back]').onclick=()=>{show(dialog,'[data-rankings]',false);show(dialog,phase==='result'?'[data-result]':'[data-intro]',true);show(dialog,'.weekly-game-controls',phase!=='result');status('');};
        document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',pagehide);window.addEventListener('popstate',popstate);
        try {
            const featured=providedFeatured || await api.getWeeklyGame({signal:abort.signal});
            if(current!==generation)return;
            release=featured.release;
            text(dialog,'[data-title]',release?.title || 'Weekly game');
            pkg=await downloadPackage(release,AbortSignal.any([abort.signal,AbortSignal.timeout(30000)]));
            if(current!==generation)return;
            overlays=await Promise.all((pkg.presentation.overlays || []).slice(0,4).map(async style=>{
                let image;
                if (/^data:image\/(png|jpeg);/.test(pkg.assets[style.asset] || '')) {
                    try {image=new Image();image.src=pkg.assets[style.asset];await image.decode();if(image.width>4096 || image.height>4096)image=null;} catch (_) {image=null;}
                }
                return {style,image};
            }));
            if(current!==generation)return;
            text(dialog,'[data-instructions]',release.rules.instructions);
            const instruction=dialog.querySelector('[data-instruction]');if(pkg.assets.instruction?.startsWith('data:image/')){instruction.src=pkg.assets.instruction;instruction.hidden=false;}
            const support=cameraGameSupport();
            if(!support.supported){phase='unsupported';show(dialog,'[data-enable]',false);show(dialog,'[data-audio-label]',false);status(support.message);if(support.ios){const link=document.createElement('a');link.href='https://apps.apple.com/us/app/valid-compliment-classmates/id6755367062';link.textContent='Open Valid in the App Store';link.className='weekly-game-ios-link';dialog.querySelector('.weekly-game-controls').prepend(link);}return;}
            if (!supported()) throw new Error('This browser cannot record camera games. Open Valid in the latest Chrome.');
            phase='intro';dialog.querySelector('[data-enable]').disabled=false;status('Prop up your phone and leave room for both hands.');
        } catch(error) {
            if(current!==generation)return;
            phase='error';status(error.message || 'Could not load the game. Please retry.');
            dialog.querySelector('[data-enable]').textContent='Reload game';dialog.querySelector('[data-enable]').disabled=false;dialog.querySelector('[data-enable]').onclick=()=>{close(true);history.replaceState({...history.state,weeklyGame:false},'');void open();};
        }
    }
    async function enableCamera() {
        if (!dialog || ['preparing','countdown','playing','reaction','finishing'].includes(phase))return;
        if (document.querySelector('.call-overlay[open]')) { status('Finish your call before opening the camera game.'); return; }
        const current=++generation;phase='preparing';finishing=false;stopCapture();revoke();lastPair=null;lastPairTime=-Infinity;
        show(dialog,'[data-rankings]',false);show(dialog,'.weekly-game-controls',true);show(dialog,'[data-enable]',true);show(dialog,'[data-start]',false);
        const button=dialog.querySelector('[data-enable]');button.disabled=true;button.textContent='Preparing camera…';status('Allow camera access. Hand tracking may take a moment to download the first time.');
        const wantsAudio=dialog.querySelector('[data-audio]').checked;
        // Construct/resume in the user gesture for mobile audio policies.
        const nextRecording=new GameRecording();recording=nextRecording;
        let acquired;
        try {
            try { acquired=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:720},height:{ideal:1280},frameRate:{ideal:30,max:30}},audio:wantsAudio}); }
            catch(error) {
                if (!wantsAudio || !['NotAllowedError','NotFoundError','OverconstrainedError'].includes(error.name)) throw error;
                if (current!==generation)return;
                acquired=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:720},height:{ideal:1280},frameRate:{ideal:30,max:30}},audio:false});
            }
            if(current!==generation){acquired.getTracks().forEach(t=>t.stop());return;}
            stream=acquired;stream.getVideoTracks()[0].addEventListener('ended',()=>{if(current===generation)interrupt('The camera disconnected. Please retry.');});
            const video=dialog.querySelector('[data-source]');video.srcObject=stream;await video.play();
            if(current!==generation)return;
            tracker=new WristTracker(sample=>receive(sample,current),error=>{if(current===generation)interrupt(error.message);});
            const nextTracker=tracker;
            await Promise.all([nextTracker.start(),nextRecording.prepare(stream,pkg.assets.music,pkg.presentation)]);
            if(current!==generation)return;
            phase='ready';show(dialog,'[data-intro]',false);show(dialog,'[data-camera]',true);show(dialog,'[data-enable]',false);show(dialog,'[data-start]',true);show(dialog,'[data-audio-label]',false);
            status(wantsAudio&&!stream.getAudioTracks().length?'Microphone unavailable. Your video will use the game soundtrack.':'Get both wrists in the frame, then tap Start.');
            if(navigator.wakeLock) navigator.wakeLock.request('screen').then(lock=>{if(current===generation)wakeLock=lock;else void lock.release();}).catch(()=>{});
            loop(current);
        } catch(error) {
            if(current!==generation)return;
            interrupt(error.name==='NotAllowedError'?'Camera access was denied. Allow camera access in your browser settings, then try again.':error.message || 'Could not start the camera. Please retry.');
        }
    }
    function receive(sample,current) {
        if(current!==generation || !dialog)return;
        lastPair=sample.pair;lastPairTime=sample.timestamp;
        if (['playing','reaction','finishing'].includes(phase)) {
            const row=evidence.append(sample.timestamp-playStart,sample.pair,sample.hardBreak);
            if(row){const prior=scene.score;scene=engine.frame({samples:[row]});if(scene.score>prior)pointTime=performance.now();}
        }
    }
    function startRound() {
        if(phase!=='ready' || !lastPair || performance.now()-lastPairTime>300)return;
        engine=createCameraGame();scene=engine.start({protocol:1,seed:crypto.getRandomValues(new Uint32Array(1))[0],rules:release.rules});
        evidence=new CameraEvidence(release.rules.duration_seconds);countStart=performance.now();phase='countdown';pointTime=-Infinity;
        show(dialog,'[data-start]',false);status(pkg.presentation.copy?.countdown || 'Step back. Get ready!');
        recording.audio?.resume().catch(()=>{});
    }
    function loop(current) {
        if(current!==generation || !dialog)return;
        if(document.querySelector('.call-overlay[open]')) {interrupt('Your call interrupted the round. Play again after the call.');return;}
        const now=performance.now(),rules=release.rules;
        if(phase==='countdown' && now-countStart>=rules.countdown_seconds*1000){
            try {playStart=now;recording.start(dialog.querySelector('[data-canvas]'),pkg.presentation);phase='playing';status('Go!');}
            catch(error){interrupt(error.message);return;}
        }
        if(phase==='playing' && now-playStart>=rules.duration_seconds*1000){phase='reaction';recording.stopMusic();status(pkg.presentation.copy?.reaction || 'Time’s up!');}
        if(phase==='reaction' && now-playStart>=(rules.duration_seconds+rules.reaction_seconds)*1000){void finishRound(current);return;}
        const visible=lastPair && now-lastPairTime<300;
        const start=dialog.querySelector('[data-start]');start.disabled=!visible;
        text(dialog,'[data-tracking]',visible?'Hands in view':pkg.presentation.copy?.tracking || 'Keep both hands in view');
        dialog.querySelector('[data-tracking]').classList.toggle('ready',Boolean(visible));
        if(['ready','countdown','playing'].includes(phase))void tracker.capture(dialog.querySelector('[data-source]'),now,rules.camera_tracking?.sample_rate_hz || 30);
        draw(now);
        raf=requestAnimationFrame(()=>loop(current));
    }
    function draw(now) {
        const canvas=dialog.querySelector('[data-canvas]'),ctx=canvas.getContext('2d'),video=dialog.querySelector('[data-source]'),w=canvas.width,h=canvas.height;
        ctx.fillStyle='#07181a';ctx.fillRect(0,0,w,h);
        if(video.videoWidth){const scale=Math.min(w/video.videoWidth,h/video.videoHeight),vw=video.videoWidth*scale,vh=video.videoHeight*scale;ctx.save();ctx.translate(w,0);ctx.scale(-1,1);ctx.drawImage(video,(w-vw)/2,(h-vh)/2,vw,vh);ctx.restore();}
        const p=pkg.presentation,c=p.counter||{};
        const label=(value,x,y,size=40)=>{ctx.font=`${size}px Jua, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=5;ctx.strokeStyle='rgba(0,0,0,.65)';ctx.strokeText(value,x,y);ctx.fillText(value,x,y);};
        ctx.fillStyle=color(c.color,'#FFFFFF');
        if(['playing','reaction'].includes(phase)){
            const cx=clamp(c.x,.1,.9,.5)*w,cy=(1-clamp(c.y,.1,.95,.93))*h;
            ctx.save();ctx.globalAlpha=clamp(c.background_opacity,0,1,.6);ctx.fillStyle=color(c.background,'#000000');ctx.beginPath();ctx.roundRect(cx-w*.22,cy-40,w*.44,80,24);ctx.fill();ctx.restore();label(`${scene.score} ${release.rules.score_unit || 'points'}`,cx,cy,42);
            const remaining=Math.max(0,Math.ceil(release.rules.duration_seconds-(now-playStart)/1000));label(phase==='reaction'?(p.copy?.reaction || 'Time’s up!'):`${remaining}s`,w/2,cy+85,36);
            if(p.points?.enabled!==false && now-pointTime<650){ctx.fillStyle=color(p.points?.color,'#A1FF3D');label(String(p.points?.text||'+1').slice(0,8),w/2,h*.25-(now-pointTime)*.06,70);}
            for(const t of scene.targets){const vw=video.videoWidth,vh=video.videoHeight,scale=Math.min(w/vw,h/vh),ox=(w-vw*scale)/2,oy=(h-vh*scale)/2;ctx.strokeStyle=color(release.rules.accent,'#00E5C4');ctx.lineWidth=6;ctx.strokeRect(ox+t.x_min/10000*vw*scale,oy+(1-t.y_max/10000)*vh*scale,(t.x_max-t.x_min)/10000*vw*scale,(t.y_max-t.y_min)/10000*vh*scale);}
            if(scene.prompt){ctx.fillStyle='#FFFFFF';label(scene.prompt,w/2,h*.75,30);}
        } else if(phase==='countdown'){
            ctx.fillStyle='#FFFFFF';label(String(Math.max(1,Math.ceil(release.rules.countdown_seconds-(now-countStart)/1000))),w/2,h*.4,160);label(p.copy?.countdown || 'Step back. Get ready!',w/2,h*.55,36);
        }
        for(const {style,image} of overlays){
            const ow=w*clamp(style.width,.1,.6,.34),oh=style.text?ow*.2:Math.min(ow,image?ow*image.height/image.width:ow*.2),inset=w*clamp(style.inset,.02,.2,.065);
            const x=String(style.corner).endsWith('right')?w-inset-ow:inset,y=String(style.corner).startsWith('top')?inset:h-inset-oh;
            ctx.save();ctx.globalAlpha=clamp(style.opacity,0,1,.95)*clamp(style.background_opacity,0,1,.45);ctx.fillStyle=color(style.background,'#000000');ctx.beginPath();ctx.roundRect(x,y,ow,oh,10);ctx.fill();ctx.restore();
            ctx.save();ctx.globalAlpha=clamp(style.opacity,0,1,.95);const icon=oh*.75;if(image)ctx.drawImage(image,x+6,y+(oh-icon)/2,icon,icon);
            ctx.fillStyle=color(style.color,'#FFFFFF');ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`${Math.min(32,oh*.55)}px Jua, sans-serif`;ctx.fillText(String(style.text||'').slice(0,64),x+(image?icon+10:0)+(ow-(image?icon+10:0))/2,y+oh/2,ow-(image?icon+18:12));ctx.restore();
        }
        ctx.fillStyle='#FFFFFF';if(!overlays.length)label('validapp.lol',w*.26,h*.93,32);ctx.font='22px Jua, sans-serif';ctx.textAlign='right';ctx.fillText('PRACTICE',w*.94,h*.94);
    }
    async function finishRound(current) {
        if(finishing || current!==generation)return;finishing=true;phase='finishing';status('Finishing your video…');
        try {
            // Reaction time normally drains the one in-flight observation. A
            // slow tracker must never produce a partially finalized score.
            const deadline=performance.now()+5000;
            while(tracker?.busy && performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
            if(current!==generation)return;
            if(tracker?.busy)throw new Error('Tracking could not finish. Please retry.');
            const blob=await recording.finish();if(current!==generation)return;
            stopCapture();phase='result';revoke();videoURL=URL.createObjectURL(blob);
            const extension=blob.type.includes('mp4')?'mp4':'webm';dialog.videoFile=new File([blob],`valid-${release.game_id}-${scene.score}.${extension}`,{type:blob.type});
            const replay=dialog.querySelector('[data-replay]');replay.src=videoURL;
            const download=dialog.querySelector('[data-download]');download.href=videoURL;download.download=dialog.videoFile.name;
            text(dialog,'[data-final-score]',`${scene.score} ${release.rules.score_unit || 'points'}`);
            show(dialog,'[data-camera]',false);show(dialog,'[data-result]',true);show(dialog,'.weekly-game-controls',false);status('Practice complete. Your video is ready to share.');
        } catch(error) {if(current===generation)interrupt(error.message);}
    }
    async function shareVideo() {
        const file=dialog?.videoFile;if(!file)return;
        const button=dialog.querySelector('[data-share]');button.disabled=true;
        try {
            if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file],title:release.title,text:`I got ${scene.score} on ${release.title}! Play on validapp.lol`});
            else status('Download your video, then upload it to Snapchat, Instagram, or TikTok.');
        } catch(error) {if(error.name!=='AbortError')status('Sharing could not open. Use Download video, then share it from your photos or files.');}
        finally {if(dialog)button.disabled=false;}
    }
    async function leaderboard() {
        if(!release || ['loading','preparing','countdown','playing','reaction','finishing'].includes(phase))return;
        if(phase==='ready'){generation++;stopCapture();phase='intro';show(dialog,'[data-camera]',false);show(dialog,'[data-start]',false);show(dialog,'[data-enable]',true);dialog.querySelector('[data-enable]').disabled=false;dialog.querySelector('[data-enable]').textContent='Enable camera';}
        const current=generation;show(dialog,'[data-intro]',false);show(dialog,'[data-result]',false);show(dialog,'.weekly-game-controls',false);show(dialog,'[data-rankings]',true);status('Loading leaderboard…');
        try {
            let result=await api.getWeeklyGameLeaderboard(release.id,{signal:abort.signal});if(current!==generation || !dialog)return;
            // The native leaderboard requires its one-time discovery record,
            // including when discovery is disabled. This never starts a run.
            if(result.unlocked===false){await api.unlockWeeklyGame({signal:abort.signal});if(current!==generation || !dialog)return;result=await api.getWeeklyGameLeaderboard(release.id,{signal:abort.signal});if(current!==generation || !dialog)return;}
            const list=dialog.querySelector('[data-ranking-list]');list.replaceChildren();
            for(const entry of (result.entries||[]).slice(0,100)){const li=document.createElement('li'),name=document.createElement('span'),score=document.createElement('strong');name.textContent=`${entry.rank}. ${entry.name}`;score.textContent=String(entry.score);li.append(name,score);list.append(li);}
            text(dialog,'[data-ranking-note]',result.entries?.length?'This week’s scores. Web practice rounds don’t affect rankings yet.':'No scores yet this week. Web rounds are practice for now.');status('');
        } catch(error){if(current===generation)status(error.message || 'Could not load the leaderboard.');}
    }
    return {open,close};
}
