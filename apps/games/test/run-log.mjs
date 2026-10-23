import assert from 'node:assert/strict';
import { createRunLog } from '../public/js/toolkit/run-log.mjs';
import { sanitizeRunLog } from '../public/js/toolkit/run-log-schema.mjs';

let time=100, hidden=false, callback, stored='[]', frames=0;
const storage={getItem:()=>stored,setItem:(key,value)=>{assert.equal(key,'giggle-run-logs-v1');stored=value;}};
const log=createRunLog({now:()=>time,storage,requestFrame:fn=>{callback=fn;return ++frames;},cancelFrame:()=>{callback=null;},visible:()=>!hidden});
const state=(extra={})=>({game:'pocket-karts',instanceId:'private-seat-and-room',phase:'live',...extra});
function frame(ms=16){time+=ms;const cb=callback;callback=null;cb?.(time);}
log.snapshot(state({preparing:true}));frame();frame(100);assert.equal(log.latest().frameCount,0,'asset preparation is separate from playable frame timing');
time+=250;log.snapshot(state());
for(let i=0;i<2000;i++)frame(i===50?120:16);
let result=log.latest();assert.equal(result.frameCount,1999);assert.equal(result.sampleWindowFrames,1800);assert.equal(result.frameP95Ms,16);assert.equal(result.frameMaxMs,120);assert.equal(result.longFrames,1);
assert.ok(result.readyMs>=350);assert.equal(JSON.stringify(result).includes('private-seat-and-room'),false);
hidden=true;log.visibility();log.save();time+=3000;hidden=false;log.visibility();frame();frame();assert.equal(log.latest().frameMaxMs,120,'background suspension with no hidden rAF is not reported as lag');
assert.equal(log.latest().rendererSampleCount,0);assert.equal('renderCpuP95Ms' in log.latest(),false,'unobserved renderer is not represented as measured zero');
log.renderFrame(7,{render:{calls:120,triangles:23000},memory:{geometries:22,textures:8}});log.renderFrame(12,{render:{calls:80,triangles:18000}});
assert.equal(log.latest().renderCpuP95Ms,12);assert.equal(log.latest().drawCallsMax,120);
for(let i=0;i<100;i++)log.event('fire');log.event('SECRET');assert.equal(log.latest().counts.fire,100);assert.equal(log.latest().events.length,32);assert.equal('SECRET' in log.latest().counts,false);
log.snapshot(state({phase:'done'}));result=log.latest();frame(800);log.snapshot(state({phase:'done'}));assert.deepEqual(log.latest(),result,'final repeated snapshots do not reopen timing or change the saved match');
assert.equal(JSON.parse(stored).length,1);assert.equal(JSON.parse(stored)[0].counts.fire,100);
log.save();log.event('socket-close');log.save();assert.equal(JSON.parse(stored).length,1,'report/visibility saves never duplicate a finished run');assert.deepEqual(log.latest(),result,'late lobby errors cannot mutate a completed match');
for(let i=0;i<15;i++){log.snapshot(state({game:'ludo',instanceId:'rematch'+i}));frame();log.finish();}
assert.equal(JSON.parse(stored).length,10,'last ten runs only');assert.equal(log.latest('pocket-karts'),null,'expired local history is removed');assert.equal(log.latest('ludo').game,'ludo');
const invalid={schema:1,game:'ludo',room:'SECRET',token:'SECRET',durationMs:NaN,frameP95Ms:Infinity,frameCount:-1,counts:{fire:1,secret:2},events:[{type:'fire',atMs:5,message:'SECRET'},{type:'secret',atMs:6},{type:'hit',atMs:-2}]};
assert.deepEqual(sanitizeRunLog(invalid,new Set(['ludo'])),{schema:1,game:'ludo',counts:{fire:1},events:[{type:'fire',atMs:5}]});assert.equal(sanitizeRunLog(invalid,new Set(['chess'])),null);
const recovered=createRunLog({now:()=>time,storage,requestFrame:null});assert.equal(recovered.latest('ludo').game,'ludo');
const privateMode=createRunLog({now:()=>time,storage:{getItem(){throw Error('denied');},setItem(){throw Error('denied');}},requestFrame:null});privateMode.snapshot(state());privateMode.event('runtime-error');privateMode.save();privateMode.finish();assert.equal(privateMode.latest().counts['runtime-error'],1);
const immediate=createRunLog({now:()=>time,storage,requestFrame:null});immediate.snapshot(state());time+=20;immediate.snapshot(state({events:[{id:1,type:'fire'}]}));assert.equal(immediate.latest().readyMs,0,'instant readiness stays zero');immediate.snapshot(state({events:[{id:1,type:'fire'},{id:2,type:'hit'}],phase:'done'}));assert.equal(immediate.latest().counts.fire,1);assert.equal(immediate.latest().counts.hit,1,'terminal accepted hits are saved before settlement');immediate.save();assert.equal(immediate.latest().counts.fire,1,'duplicate snapshots do not replay event history');
// RAF scheduling timestamps can precede collector execution on the same clock.
let observed=1000, observedRaf;
const delayedObservation=createRunLog({now:()=>observed,storage:{getItem:()=>null,setItem:()=>{}},requestFrame:fn=>{observedRaf=fn;return 1;},cancelFrame:()=>{}});
delayedObservation.snapshot(state());observed=1020;observedRaf(1016);observed=1150;observedRaf(1143);
assert.deepEqual(delayedObservation.latest().timings.frame,[{atMs:150,durationMs:127}],'frame endpoint is collector observation; duration remains RAF scheduler interval');
// The RAF stamp, render completion and receive/event clocks share a run origin.
let clock=1000, rafStamp, isHidden=false, boundedStorage='[]';
const correlated=createRunLog({now:()=>clock,storage:{getItem:()=>boundedStorage,setItem:(_,v)=>boundedStorage=v},requestFrame:fn=>{rafStamp=fn;return 1;},cancelFrame:()=>{},visible:()=>!isHidden});
const tick=ms=>{clock+=ms;rafStamp(clock);};
const receive=(extra={})=>correlated.snapshot(state(extra));
receive();tick(16);tick(50);assert.deepEqual(correlated.latest().timings.frame,[],'50ms is not a long frame');
clock+=40;correlated.renderFrame(40,{});correlated.event('fire');receive();tick(127);
let facts=correlated.latest();
assert.deepEqual(facts.timings.frame,[{atMs:233,durationMs:167}]);
assert.deepEqual(facts.timings.render,[{atMs:106,durationMs:40}]);
assert.deepEqual(facts.timings.snapshot,[{atMs:106,durationMs:106}]);
assert.deepEqual(facts.events,[{type:'fire',atMs:106}],'accepted event aligns exactly with CPU completion/receive');
assert.equal(facts.renderCpuMaxMs,40);
clock+=16.67;correlated.renderFrame(16.67,{});assert.equal(correlated.latest().timings.render.length,1,'nominal budget inclusive boundary');
clock+=100;receive();assert.equal(correlated.latest().timings.snapshot.length,2);
clock+=100;receive();assert.equal(correlated.latest().timings.snapshot.length,2,'100ms receive boundary is excluded');
for(const boundary of ['hidden','pause','preparing','baseline']){
 if(boundary==='hidden'){isHidden=true;correlated.visibility();clock+=2000;receive();isHidden=false;correlated.visibility();}
 if(boundary==='pause'){correlated.pause();clock+=2000;}
 if(boundary==='preparing'){receive({preparing:true});clock+=2000;}
 if(boundary==='baseline'){clock+=2000;receive({audioBaseline:true});}
 const before=correlated.latest().timings.snapshot.length;
 receive();assert.equal(correlated.latest().timings.snapshot.length,before,boundary+' does not create a suspended receive gap');
 clock+=101;receive();assert.equal(correlated.latest().timings.snapshot.at(-1).durationMs,101,boundary+' establishes a fresh playable baseline');
}
// Independent channel caps preserve a slow frame amid a receive/render burst.
for(let i=0;i<24;i++){tick(60+i);clock+=101+i;receive();clock+=20+i;correlated.renderFrame(20+i,{});}
facts=correlated.latest();for(const key of ['frame','render','snapshot'])assert.equal(facts.timings[key].length,16);
assert.equal(facts.timings.frame[0].durationMs,203);assert.equal(facts.timings.render[0].durationMs,28);assert.equal(facts.timings.snapshot.at(-1).durationMs,249);
assert.equal(facts.renderCpuMaxMs,43);
tick(16);const wholeLongFrames=correlated.latest().longFrames;
for(let i=0;i<1900;i++){tick(16);correlated.renderFrame(1,{});}
facts=correlated.latest();assert.equal(facts.renderCpuP95Ms,1);assert.equal(facts.renderCpuMaxMs,43,'whole-run CPU max survives percentile sample eviction');assert.equal(facts.longFrames,wholeLongFrames,'whole-run long count survives sparse and percentile eviction');
receive({phase:'done',events:[{id:9,type:'hit'}]});const final=correlated.latest();assert.equal(final.counts.hit,1);assert.deepEqual(final.events.at(-1),{type:'hit',atMs:clock-1000});
clock+=1000;receive({phase:'done'});assert.deepEqual(correlated.latest(),final,'finished sparse spans remain immutable');
const revived=createRunLog({now:()=>clock,storage:{getItem:()=>boundedStorage},requestFrame:null});assert.deepEqual(revived.latest(),final,'sparse diagnostics recover through the shared whitelist');
clock+=100;receive({instanceId:'new-private-instance'});assert.deepEqual(correlated.latest().timings,{frame:[],render:[],snapshot:[]});assert.equal('renderCpuMaxMs' in correlated.latest(),false,'unmeasured new renderer has no CPU maximum');
const hostile={schema:1,game:'pocket-karts',timings:{frame:[null,{atMs:NaN,durationMs:1},{atMs:10,durationMs:Infinity},{atMs:-1,durationMs:0},{atMs:10,durationMs:-1},{atMs:86400001,durationMs:1},{atMs:10,durationMs:11},{atMs:20.126,durationMs:5.125,token:'SECRET'}],render:'SECRET',snapshot:[],private:'SECRET'},renderCpuMaxMs:Infinity};
assert.deepEqual(sanitizeRunLog(hostile),{schema:1,game:'pocket-karts',counts:{},events:[],timings:{frame:[{atMs:20.13,durationMs:5.13}],render:[],snapshot:[]}});
const ceiling={schema:1,game:'pocket-karts',renderCpuMaxMs:100000000,events:Array.from({length:32},()=>({type:'runtime-error',atMs:86399999.99})),counts:{'runtime-error':1000000},timings:Object.fromEntries(['frame','render','snapshot'].map(k=>[k,Array.from({length:40},()=>({atMs:86399999.99,durationMs:86399999.99,token:'SECRET'}))]))};
const clean=sanitizeRunLog(ceiling);for(const key of ['frame','render','snapshot'])assert.equal(clean.timings[key].length,16);assert.equal(JSON.stringify(clean).includes('SECRET'),false);
assert.ok(JSON.stringify(Array(10).fill(clean)).length<100000,'ten maximal sparse runs fit existing local recovery bound');
assert.ok(Buffer.byteLength(JSON.stringify({id:'00000000-0000-4000-8000-000000000000',game:'pocket-karts',category:'performance',impact:'problem',description:'Normal detailed report '.repeat(100),steps:'Drive and fire.',context:{run:clean}}))<24576,'maximal diagnostics plus representative report fit existing HTTP bound');
assert.equal('timings' in sanitizeRunLog({schema:1,game:'ludo'}),false,'old schema1 records remain unchanged');
console.log('RUN_LOG_PASS: bounded timing/history, readiness/visibility, final settlement, renderer CPU facts, storage recovery and shared privacy whitelist');
