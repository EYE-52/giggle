// Exercise served-source instrumentation and analysis without a browser,
// network requests, a relay, or any listening socket.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import R from '@dimforge/rapier3d-compat';
import C from '../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
const source=fs.readFileSync(new URL('../tools/realtime/prod-probe.cjs',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('const pct ='),source.indexOf('// TCP-like'))+
  source.slice(source.indexOf('function patch('),source.indexOf('function initScript('))+
  source.slice(source.indexOf('function analyse('),source.indexOf('\n(async () => {'));
const {patch,PATCHES,analyse}=new Function(helpers+';return {patch,PATCHES,analyse};')();
const patched=new Map();
function checkSyntax(code,label){
  const result=spawnSync(process.execPath,['--input-type=module','--check'],{input:code,encoding:'utf8'});
  assert.equal(result.status,0,label+': '+result.stderr);
}
for(const file of Object.keys(PATCHES)){
  const url=new URL(file==='client.mjs'?'../public/js/toolkit/realtime/client.mjs':'../public/js/engines/'+file,import.meta.url);
  const code=patch(fs.readFileSync(url,'utf8'),PATCHES[file],file);checkSyntax(code,file);patched.set(file,{url,code});
}
assert.match(source,/engines\\\/kart-elevated-\(\?:pose\|prediction\)/,'route intercepts raised pose and prediction modules');

// The released predictor had no visual correction. Check the old alternatives
// still instrument its restore/replay path, including a corr record.
const old=`function ingest(snapshot,arrival,serverAt=arrival){
 const changed=!lastSnapshot;
 if(changed||!fresh||snapshot.audioBaseline||arrival-lastArrival>250)history=[];
 lastSnapshot=snapshot;lastArrival=arrival;lastAt=snapshot.simAt;
}
function frame(){
 return {...current,renderPose:blendElevatedPose(priorPose?{...kart,pose:priorPose}:null,current,Math.max(0,Math.min(1,accumulator/dt)),renderOutput)};
}`;
const instrumentedOld=patch(old,PATCHES['kart-elevated-prediction.mjs'],'released raised prediction');
for(const kind of ['ingest','corr','frame'])assert(instrumentedOld.includes("__pkD?.('"+kind+"'"),'old source emits '+kind);
checkSyntax(instrumentedOld,'released raised prediction');
assert.throws(()=>patch('unrecognized source',PATCHES['kart-elevated-prediction.mjs'],'unknown'),/did not match/,'unknown source fails visibly');

// Run the patched raised module itself, proving hooks see actual own-kart
// frames, soft corrections, and authoritative resets with valid timestamps.
await R.init();
const {url,code}=patched.get('kart-elevated-prediction.mjs');
const absolute=code.replace(/from '([^']+)'/g,(_,path)=>"from '"+new URL(path,url).href+"'");
const {createElevatedPrediction}=await import('data:text/javascript;base64,'+Buffer.from(absolute).toString('base64'));
const D={ingest:[],corr:[],frame:[],remote:[],under:[],eframe:[],eingest:[],msgs:[],raf:[]};
const priorHook=globalThis.__pkD;globalThis.__pkD=(kind,value)=>D[kind].push(value);
const physics=createKartPhysics(R,C),p=createElevatedPrediction(R),epoch=1700000000000;
physics.addKart('a',{position:{x:0,y:.75,z:-50}});
const snapshot=t=>({instanceId:'probe-fixture',mapId:'garden',phase:'live',you:'a',youDrive:true,simAt:epoch+t,inputAck:{life:0,controlEpoch:0},
  karts:[{id:'a',alive:true,connected:true,spawnSeq:0,controlEpoch:0,nitro:1,pose:physics.pose('a')}]});
try{
  const initial=snapshot(0),input={steer:0,throttle:.3,brake:0,nitro:false,use:false};p.ingest(initial,0,epoch);
  p.frame(initial,input,.1,100,epoch+100);p.ingest(snapshot(50),400,epoch+400);p.frame(initial,input,.016,416,epoch+416);
  p.frame(initial,input,.016,700,epoch+700);
  const reset=snapshot(100);reset.karts[0].spawnSeq++;reset.karts[0].pose.epoch++;reset.inputAck.life++;
  p.ingest(reset,710,epoch+710);p.frame(reset,input,0,710,epoch+710);
  assert.equal(D.ingest.length,3);assert.equal(D.corr.length,1);assert.equal(D.frame.length,4);
  assert(D.ingest[0].reset&&!D.ingest[1].reset&&D.ingest[2].reset);
  assert(Number.isFinite(D.corr[0].d)&&typeof D.corr[0].snap==='boolean');
  for(const frame of D.frame)for(const field of ['x','y','z','speed','now','delay'])assert(Number.isFinite(frame[field]),'finite '+field);
  const report=analyse(D,true);assert.equal(report.ownKart.frames,4);assert.equal(report.prediction.ingests,3);
  assert.equal(report.prediction.staleFrames,1);assert.equal(report.prediction.resets,2);assert(report.timeline);
  const timelineOnly=analyse({...D,frame:[],ingest:[],corr:[],eingest:[{at:0},{at:50}]},true);
  assert(!timelineOnly.ownKart&&!timelineOnly.prediction,'old timeline-only captures stay valid');assert.equal(timelineOnly.server.simAtStepMs.p50,50);
  assert(analyse(D,false).remote,'classic report still includes remote measurements');
}finally{
  p.dispose();physics.dispose();if(priorHook===undefined)delete globalThis.__pkD;else globalThis.__pkD=priorHook;
}
console.log('PASS probe: current/released source patches parse, raised hooks execute, ownKart/prediction and timeline reports coexist');
