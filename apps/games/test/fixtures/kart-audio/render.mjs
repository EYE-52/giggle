/* Deterministic listening preview of the PRODUCTION audio graph + WAV assets.
 * Run: node test/fixtures/kart-audio/render.mjs /absolute/output.wav [assetOverridesDir]
 * This small offline backend supports the nodes used by the continuous kart
 * graph: recorded buffer loops, exponential AudioParam targets, gains, and
 * Web Audio low/highpass coefficients. Linear sample interpolation is used;
 * browser resampling/compression and a listener's assessment remain separate.
 * Biquad coefficients: https://www.w3.org/TR/webaudio-1.0/#filters-characteristics
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createKartAudio} from '../../../public/js/engines/kart-audio.mjs';

const sampleRate=44100;
const output=path.resolve(process.argv[2]||'/tmp/pocket-karts-throttle-preview.wav');
const overrides=process.argv[3]&&path.resolve(process.argv[3]);
const nodes=[];
const ctx={currentTime:0,state:'running',resume:()=>Promise.resolve(),close:()=>Promise.resolve()};
function param(initial=0){
  let value=initial,cursor=0,target=initial,tc=0,time=0,held=initial;
  const events=[];
  return {
    get value(){return value;},
    set value(v){value=v;events.push({value:v,time:ctx.currentTime,tc:0});},
    setValueAtTime(v,t){value=v;events.push({value:v,time:t,tc:0});},
    setTargetAtTime(v,t,c){value=v;events.push({value:v,time:t,tc:c});},
    sample(t){
      while(cursor<events.length&&events[cursor].time<=t){
        const event=events[cursor++];
        held=tc ? target+(held-target)*Math.exp(-(event.time-time)/tc) : target;
        target=event.value;tc=event.tc;time=event.time;
      }
      return tc ? target+(held-target)*Math.exp(-(t-time)/tc) : target;
    },
  };
}
function node(kind){
  const n={kind,inputs:[],disconnect(){},connect(dest){dest.inputs.push(n);},cachedIndex:-1,cachedValue:0};
  nodes.push(n);return n;
}
ctx.destination=node('destination');
ctx.createGain=()=>Object.assign(node('gain'),{gain:param(1)});
ctx.createBiquadFilter=()=>Object.assign(node('filter'),{type:'lowpass',frequency:param(350),Q:param(1),x1:0,x2:0,y1:0,y2:0});
ctx.createBufferSource=()=>Object.assign(node('source'),{
  playbackRate:param(1),buffer:null,loop:false,position:0,startTime:Infinity,stopTime:Infinity,
  start(t=ctx.currentTime){this.startTime=t;},stop(t=ctx.currentTime){this.stopTime=t;},
});
ctx.decodeAudioData=bytes=>{
  const b=Buffer.from(bytes);let offset=12,data,rate;
  while(offset+8<=b.length){
    const kind=b.toString('ascii',offset,offset+4),size=b.readUInt32LE(offset+4);
    if(kind==='fmt '){assert.equal(b.readUInt16LE(offset+10),1);assert.equal(b.readUInt16LE(offset+22),16);rate=b.readUInt32LE(offset+12);}
    if(kind==='data')data=b.subarray(offset+8,offset+8+size);
    offset+=8+size+(size%2);
  }
  assert(data&&rate===sampleRate);
  const samples=new Float32Array(data.length/2);
  for(let i=0;i<samples.length;i++)samples[i]=data.readInt16LE(i*2)/32768;
  return Promise.resolve({duration:samples.length/rate,sampleRate:rate,samples});
};
const audio=createKartAudio({createContext:()=>ctx,loader:url=>{
  const source=fileURLToPath(new URL(url)),override=overrides&&path.join(overrides,path.basename(source));
  const bytes=fs.readFileSync(override&&fs.existsSync(override)?override:source);
  return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
}});
audio.update({active:true,engineActive:false});audio.unlock();assert(await audio.ready());
const phases=[
  {label:'Idle',seconds:1.2,throttle:0,speed:()=>0},
  {label:'Press from rest, accelerate',seconds:2.4,throttle:1,speed:t=>26*t},
  {label:'Hold gas at26m/s',seconds:18,throttle:1,speed:()=>26},
  {label:'Lift at unchanged26m/s',seconds:1.2,throttle:0,speed:()=>26},
  {label:'Press again at26m/s',seconds:1.2,throttle:1,speed:()=>26},
  {label:'Lift and coast to rest',seconds:2,throttle:0,speed:t=>26*(1-t)},
  {label:'Reverse from rest',seconds:1.3,throttle:-1,speed:t=>-6*t},
  {label:'Forward pedal brakes reverse motion',seconds:.8,throttle:1,speed:t=>-6*(1-t)},
  {label:'Forward acceleration with nitro',seconds:1.6,throttle:1,boost:true,speed:t=>26*t},
  {label:'Nitro cruise',seconds:.8,throttle:1,boost:true,speed:()=>26},
  {label:'Released pedal and nitro',seconds:1,throttle:0,speed:()=>26},
  {label:'Inactive, fade to silence',seconds:.3,throttle:0,active:false,speed:()=>26},
];
let duration=0;
for(const phase of phases){phase.start=duration;duration+=phase.seconds;phase.end=duration;}
const frameAt=time=>{
  const phase=phases.find(p=>time>=p.start&&time<p.end)||phases.at(-1);
  audio.update({active:phase.active!==false,engineActive:true,throttle:phase.throttle,boost:phase.boost===true,
    speed:phase.speed(Math.min(1,(time-phase.start)/phase.seconds))});
};
for(let frame=0;frame<Math.ceil(duration*60);frame++){ctx.currentTime=frame/60;frameAt(ctx.currentTime);}
assert.equal(nodes.filter(n=>n.kind==='source').length,4,'preview follows the four persistent production sources');
function signal(n,index,t){
  if(n.cachedIndex===index)return n.cachedValue;
  let value=0;
  if(n.kind==='source'){
    if(t>=n.startTime&&t<n.stopTime){
      const samples=n.buffer.samples;
      if(n.loop)n.position%=samples.length;
      if(n.position<samples.length){
        const i=Math.floor(n.position),mix=n.position-i,next=n.loop?(i+1)%samples.length:Math.min(i+1,samples.length-1);
        value=samples[i]*(1-mix)+samples[next]*mix;
      }
      n.position+=n.playbackRate.sample(t);
    }
  }else{
    for(const input of n.inputs)value+=signal(input,index,t);
    if(n.kind==='gain')value*=n.gain.sample(t);
    if(n.kind==='filter'){
      const w=2*Math.PI*n.frequency.sample(t)/sampleRate,cos=Math.cos(w),alpha=Math.sin(w)/(2*10**(n.Q.sample(t)/20));
      const a0=1+alpha,a1=-2*cos,a2=1-alpha;
      const b0=(1+(n.type==='highpass'?cos:-cos))/2,b1=n.type==='highpass'?-(1+cos):1-cos;
      const y=(b0*value+b1*n.x1+b0*n.x2-a1*n.y1-a2*n.y2)/a0;
      n.x2=n.x1;n.x1=value;n.y2=n.y1;n.y1=y;value=y;
    }
  }
  n.cachedIndex=index;n.cachedValue=value;return value;
}
const frames=Math.ceil(duration*sampleRate),wav=Buffer.alloc(44+frames*2);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*2,28);
wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(frames*2,40);
let peak=0,power=0;
for(let i=0;i<frames;i++){
  const value=signal(ctx.destination,i,i/sampleRate);peak=Math.max(peak,Math.abs(value));power+=value*value;
  wav.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(value*32768))),44+i*2);
}
assert(peak<.126,'engine-only preview stays below the production compressor threshold');
function rmsBetween(start,end){
  let sum=0;const from=Math.round(start*sampleRate),to=Math.round(end*sampleRate);
  for(let i=from;i<to;i++)sum+=(wav.readInt16LE(44+i*2)/32768)**2;
  return Math.sqrt(sum/(to-from));
}
const phaseRms=(index,offset=.35)=>rmsBetween(phases[index].start+offset,phases[index].end-.1);
const measurements={idleRms:phaseRms(0),gasAt26Rms:phaseRms(2),liftAt26Rms:phaseRms(3),
  pressAgainAt26Rms:phaseRms(4),nitroRms:phaseRms(9,.25),inactiveRms:phaseRms(11,.15)};
// Inspect 16 seconds of settled PCM. A short broadband RMS average cannot
// detect slowly repeating changes within the bass/mid/exhaust bands.
const cruiseStart=phases[2].start+1,cruiseEnd=phases[2].end-1;
function slowBandModulation(lo,hi){
  const lowDecay=Math.exp(-2*Math.PI*lo/sampleRate),highDecay=Math.exp(-2*Math.PI*hi/sampleRate);
  const block=220,envelope=[];let low=0,high=0,power=0,count=0;
  for(let i=Math.round(cruiseStart*sampleRate);i<Math.round(cruiseEnd*sampleRate);i++){
    const sample=wav.readInt16LE(44+i*2)/32768;
    low=sample*(1-lowDecay)+low*lowDecay;high=sample*(1-highDecay)+high*highDecay;
    power+=(high-low)**2;
    if(++count===block){envelope.push(power/block);count=0;power=0;}
  }
  // Exclude filter settling; Hann weighting rejects leakage from the normal
  // 20Hz combustion pulse into the unwanted0.5–8Hz rev/wah-wah band.
  envelope.splice(0,200);
  const mean=envelope.reduce((a,b)=>a+b,0)/envelope.length,dt=block/sampleRate;
  const weighted=envelope.map((value,i)=>(value-mean)*(.5-.5*Math.cos(2*Math.PI*i/(envelope.length-1))));
  let maxDepth=0,peakHz=0;
  for(let hz=.5;hz<=8;hz+=1/(envelope.length*dt)){
    let real=0,imag=0;
    for(let i=0;i<weighted.length;i++){const angle=2*Math.PI*hz*i*dt;real+=weighted[i]*Math.cos(angle);imag+=weighted[i]*Math.sin(angle);}
    const depth=4*Math.hypot(real,imag)/(weighted.length*mean);
    if(depth>maxDepth){maxDepth=depth;peakHz=hz;}
  }
  return {bandHz:[lo,hi],maxPowerModulationDepth:maxDepth,peakHz};
}
function cruisePitchSpread(){
  const step=8,rate=sampleRate/step,samples=[];
  for(let i=Math.round(cruiseStart*sampleRate);i<Math.round(cruiseEnd*sampleRate);i+=step)samples.push(wav.readInt16LE(44+i*2)/32768);
  const periods=[],size=Math.round(.3*rate),firstLag=Math.round(.043*rate),lastLag=Math.round(.065*rate);
  for(let start=0;start+size<samples.length;start+=Math.round(.2*rate)){
    const correlation=[];
    for(let lag=firstLag;lag<=lastLag;lag++){
      let cross=0,left=0,right=0;
      for(let i=0;i<size-lag;i++){const a=samples[start+i],b=samples[start+i+lag];cross+=a*b;left+=a*a;right+=b*b;}
      correlation.push(cross/Math.sqrt(left*right));
    }
    const peak=correlation.indexOf(Math.max(...correlation));
    const left=correlation[peak-1],center=correlation[peak],right=correlation[peak+1];
    const fraction=Number.isFinite(left)&&Number.isFinite(right)?.5*(left-right)/(left-2*center+right):0;
    periods.push((firstLag+peak+fraction)/rate);
  }
  periods.sort((a,b)=>a-b);
  return {p95p5Cents:1200*Math.log2(periods[Math.floor(periods.length*.95)]/periods[Math.floor(periods.length*.05)]),windows:periods.length};
}
measurements.cruiseBands=[[25,150],[150,400],[400,1200],[1200,3500]].map(([lo,hi])=>slowBandModulation(lo,hi));
measurements.cruisePitch=cruisePitchSpread();
assert(measurements.cruiseBands.every(band=>band.maxPowerModulationDepth<.02),
  'rendered PCM: held throttle/speed must not repeat >2% slow band-power wobble: '+JSON.stringify(measurements.cruiseBands));
assert(measurements.cruisePitch.p95p5Cents<5,'rendered PCM: held cruise note must stay within5cents instead of cycling through a prerecorded rev');
measurements.liftDropDb=20*Math.log10(measurements.gasAt26Rms/measurements.liftAt26Rms);
assert(measurements.liftDropDb>4,'rendered PCM: lifting must reduce the engine by >4dB at unchanged road speed');
assert(measurements.pressAgainAt26Rms>measurements.liftAt26Rms*1.6,'rendered PCM: re-press must restore engine load at unchanged speed');
assert(measurements.gasAt26Rms>measurements.idleRms*2,'rendered PCM: full drive must be meaningfully different from parked idle');
assert(measurements.inactiveRms<.0001,'rendered PCM: leaving live drive must settle to silence');
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,wav);
const report={output,durationSeconds:duration,peak,rms:Math.sqrt(power/frames),measurements,phases,
  boundary:'Production module and recordings; offline AudioParam/biquad rendering with linear resampling and no compressor. Not native-browser or subjective listening evidence.'};
fs.writeFileSync(output.replace(/\.wav$/i,'')+'.json',JSON.stringify(report,null,2)+'\n');
audio.dispose();console.log(JSON.stringify(report,null,2));
