export function recordingType() {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
    return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp8,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported(type)) || null;
}
export class GameRecording {
    constructor() {
        this.chunks=[]; this.closed=false;
        // Created synchronously from Enable camera / Play again, before the
        // permission promise consumes the mobile browser's user gesture.
        const AudioContext=window.AudioContext||window.webkitAudioContext;
        try { if(AudioContext) {this.audio=new AudioContext();void this.audio.resume().catch(()=>{});} } catch (_) {}
    }
    async prepare(stream,music,presentation={}) {
        if (!this.audio || this.closed) return;
        try {
            this.destination=this.audio.createMediaStreamDestination();
            if (stream.getAudioTracks().length) {
                this.mic=this.audio.createMediaStreamSource(stream); const gain=this.audio.createGain(); gain.gain.value=Math.min(1,Math.max(0,presentation.audio?.reaction_volume ?? 1)); this.mic.connect(gain).connect(this.destination);
            }
            if (music) {
                const raw=atob(music.split(',')[1]); const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
                this.music=await this.audio.decodeAudioData(bytes.buffer);
            }
        } catch (_) { /* Camera recording still works when optional audio is unavailable. */ }
    }
    start(canvas,presentation={}) {
        const mimeType=recordingType(); if (!mimeType) throw new Error('Video recording is unavailable in this browser. Try the latest Chrome.');
        this.stream=canvas.captureStream(30);
        for (const track of this.destination?.stream.getAudioTracks() || []) this.stream.addTrack(track);
        this.recorder=new MediaRecorder(this.stream,{mimeType,videoBitsPerSecond:3000000});
        this.done=new Promise((resolve,reject)=>{
            this.recorder.ondataavailable=({data})=>{ if (data.size) this.chunks.push(data); if (this.chunks.reduce((n,c)=>n+c.size,0)>40000000) { this.recorder.stop(); reject(new Error('The recording is too large. Please retry.')); } };
            this.recorder.onerror=()=>reject(new Error('The video could not be recorded. Please retry.'));
            this.recorder.onstop=()=>{ const blob=new Blob(this.chunks,{type:this.recorder.mimeType || mimeType}); if (!blob.size) reject(new Error('The recording was empty. Please retry.')); else resolve(blob); };
        });
        // Attach immediately, even if interrupted before finalization.
        this.done.catch(()=>{});
        this.recorder.start(500);
        if (this.audio && this.music && this.audio.state==='running') {
            this.source=this.audio.createBufferSource(); this.source.buffer=this.music; this.source.loop=true;
            const live=this.audio.createGain(), recorded=this.audio.createGain();
            live.gain.value=Math.min(1,Math.max(0,presentation.audio?.live_volume ?? .7)); recorded.gain.value=Math.min(1,Math.max(0,presentation.audio?.music_volume ?? 1));
            this.source.connect(live).connect(this.audio.destination); this.source.connect(recorded).connect(this.destination); this.source.start();
        }
    }
    stopMusic() { try { this.source?.stop(); } catch (_) {} this.source=null; }
    async finish() {
        this.stopMusic();
        if (!this.recorder) throw new Error('No recording was started.');
        if (this.recorder.state!=='inactive') this.recorder.stop();
        let timeout;
        try { return await Promise.race([this.done,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('The video could not finish. Please retry.')),10000);})]); }
        finally { clearTimeout(timeout); this.close(); }
    }
    close() {
        this.closed=true; this.stopMusic();
        if (this.recorder?.state && this.recorder.state!=='inactive') this.recorder.stop();
        this.stream?.getTracks().forEach(t=>t.stop());
        this.audio?.close().catch(()=>{});
    }
}
