import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ringbackSamples,RINGBACK_SAMPLE_RATE,RINGBACK_DURATION,RINGBACK_VOLUME,createRingback} from '../../app/calls/ringback.js';

test('native ringback PCM: same three notes, envelope, silence, cadence and volume',()=>{
    const samples=ringbackSamples();
    assert.equal(RINGBACK_SAMPLE_RATE,48000); assert.equal(RINGBACK_DURATION,3.6); assert.equal(RINGBACK_VOLUME,.48);
    assert.equal(samples.length,172800);
    for(const frame of [1,576,12000,24000,36000,47000]) {
        const time=frame/48000;
        let amplitude=0;
        for(const [start,hz,duration] of [[0,659.25,.34],[.24,783.99,.34],[.5,987.77,.48]]) {
            if(time<start||time>=start+duration)continue;
            const t=time-start;
            amplitude+=(Math.sin(2*Math.PI*hz*t)+.18*Math.sin(4*Math.PI*hz*t))*Math.min(t/.012,1)*Math.pow(1-t/duration,1.7)*.16;
        }
        assert.equal(samples[frame],Math.fround(Math.trunc(amplitude*32767)/32768));
    }
    assert(samples.slice(47040).every(value=>value===0));
    assert(samples.some(value=>Math.abs(value)>.05));
});

test('one loop, local output only, bounded resources and dispose', async()=>{
    const previous=globalThis.AudioContext,log=[];
    globalThis.AudioContext=class {
        constructor(){this.state='running';this.destination={localOutput:true};}
        async resume(){} async close(){log.push('close');}
        createBuffer(channels,frames,rate){assert.equal(channels,1);assert.equal(frames,172800);assert.equal(rate,48000);return {copyToChannel(data){assert.equal(data.length,172800);}};}
        createGain(){return {gain:{value:0},connect(destination){assert(destination.localOutput);log.push('localOutput');},disconnect(){}};}
        createBufferSource(){return {connect(gain){assert.equal(gain.gain.value,.48);return gain;},start(){assert(this.loop);log.push('start');},stop(){log.push('stop');},disconnect(){}};}
    };
    try{const tone=createRingback();tone.prepare();tone.play();tone.play();await tone.resume();tone.stop();tone.dispose();assert.deepEqual(log,['localOutput','start','stop','close']);}
    finally{globalThis.AudioContext=previous;}
});
