import { TRACKER_URL } from './tracker-asset.js';

export class WristContinuity {
    constructor() { this.last = null; }
    observe(pair, timestamp) {
        if (!pair || pair.length !== 4 || !pair.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) return {pair:null,hardBreak:false};
        if (pair[2] - pair[0] <= 0.12) { this.last = null; return {pair:null,hardBreak:true}; }
        let hardBreak = false;
        if (this.last) {
            const dt = (timestamp - this.last.timestamp) / 1000;
            hardBreak = dt <= 0 || dt > 0.15 || pair.some((v,i) => Math.abs(v-this.last.pair[i]) > (i%2 ? Math.min(0.3,0.05+dt*4) : Math.min(0.18,0.025+dt*1.5)));
        }
        this.last = {pair,timestamp}; return {pair,hardBreak};
    }
}

export class WristTracker {
    constructor(onSample, onError) { this.onSample=onSample; this.onError=onError; this.closed=false; this.busy=false; this.continuity=new WristContinuity(); this.lastVideoTime=-1; this.lastCapture=-Infinity; }
    async start() {
        if (!window.Worker || !window.createImageBitmap || !window.OffscreenCanvas) throw new Error('Hand tracking needs a newer browser. Open Valid in the latest Chrome.');
        this.worker = new Worker(TRACKER_URL);
        await new Promise((resolve,reject) => {
            this.rejectStart=reject;
            this.startTimeout=setTimeout(()=>reject(new Error('Hand tracking took too long to load. Check your connection and retry.')),45000);
            this.worker.onerror=()=>{ const error=new Error('Hand tracking could not start on this browser. Please try the latest Chrome.'); reject(error); this.onError(error); };
            this.worker.onmessage=({data})=>{
                if (this.closed) return;
                if (data.type==='ready') { clearTimeout(this.startTimeout); this.rejectStart=null; resolve(); }
                else if (data.type==='sample') { clearTimeout(this.frameTimeout); this.busy=false; this.onSample({...this.continuity.observe(data.pair,data.timestamp),timestamp:data.timestamp}); }
                else if (data.type==='error') { const error=new Error(data.message); reject(error); this.onError(error); }
            };
            this.worker.postMessage({type:'init'});
        });
        this.ready=true;
    }
    async capture(video, timestamp, sampleRate=30) {
        if (this.closed || !this.ready || this.busy || video.readyState<2 || video.currentTime===this.lastVideoTime || timestamp-this.lastCapture<1000/sampleRate) return;
        this.busy=true; this.lastVideoTime=video.currentTime; this.lastCapture=timestamp;
        try {
            const scale=Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));
            const image=await createImageBitmap(video,{resizeWidth:Math.max(1,Math.round(video.videoWidth*scale)),resizeHeight:Math.max(1,Math.round(video.videoHeight*scale))});
            if (this.closed) { image.close(); return; }
            this.frameTimeout=setTimeout(()=>this.onError(new Error('Hand tracking stopped responding. Please retry.')),5000);
            this.worker.postMessage({type:'frame',image,timestamp},[image]);
        } catch (_) { this.busy=false; if (!this.closed) this.onError(new Error('Could not read the camera. Please retry.')); }
    }
    close() { this.closed=true; clearTimeout(this.startTimeout); clearTimeout(this.frameTimeout); this.rejectStart?.(new DOMException('Closed','AbortError')); this.rejectStart=null; this.worker?.terminate(); this.worker=null; this.busy=false; }
}
