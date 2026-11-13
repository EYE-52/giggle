import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import config from '../public/js/engines/kart-physics-config.mjs';
import {createClassicMotion} from '../public/js/engines/kart-classic-motion.mjs';
import {createClassicPrediction} from '../public/js/engines/kart-classic-prediction.mjs';
import engine from '../games/engines/kart-engine.js';
await RAPIER.init();
const k={pid:'a',x:0,z:0,angle:0,speed:0,boost:0,boostCd:0,turbo:0,padCd:0,nitro:1,input:{throttle:1,steer:0},spawnSeq:0,connected:true};
// Isolate strict correction-jump limits from legitimate road relief/flight.
// The all-map terrain test separately exercises actual Ring climbs/descent.
const flatMap='flat-prediction-fixture';
// The authority's 30 Hz timer has integer millisecond jitter. Drive the real
// game projection through that timer, then deliver it over a bursty 100ms RTT
// link. Its fixed-step checkpoint and round clock must keep their own times.
for(const link of ['bursty','local']){
 const players=[{id:'a',name:'A'},{id:'b',name:'B'}],epoch=1700000000000;
 let now=epoch,motion;
 const ctx={allPlayers:()=>players,players:()=>players,settings:()=>({map:'ring',mode:'battle'}),now:()=>now,broadcast(){},award(){},content:()=>({})};
 const def=engine.createKartGame({id:'fixed-clock',name:'Fixed clock',createMotion:s=>(motion=createClassicMotion(RAPIER,config,s))}),room=def.create(ctx);
 const prediction=createClassicPrediction(RAPIER),input={steer:0,throttle:.5},packets=[];
 const snapshot=()=>({...structuredClone(def.view(room,'a')),instanceId:'fixed-clock',you:'a',youDrive:true});
 try{
  assert.equal(snapshot().poseLagUs,0,'countdown has no pending physics time');
  now+=3000;def.onTick(room,ctx);
  const start=now,initial=snapshot(),tick0=motion.stats().tick;
  assert.equal(initial.poseLagUs,0,'the first live pose starts at the countdown boundary');
  const intervals=[31,35,30,36,33];let lastInput=0;
  for(let i=0;now<start+2000;i++){
   now+=intervals[i%intervals.length];
   def.onAction(room,ctx,'a',{input,seq:++lastInput,life:0,controlEpoch:0});
   def.onTick(room,ctx);
   const s=snapshot(),elapsed=now-start;
   assert.equal(s.simAt,now,'timers and shot lifetimes use the entire timer interval');
   assert(Math.abs(elapsed-s.poseLagUs/1000-(motion.stats().tick-tick0)*config.fixedDt*1000)<.001,'wire pose is stamped at the last completed physics tick');
   const delay=link==='bursty'?50+Math.max(0,150-elapsed%550):[2,3,3.3,2.5,4.1][i%5];
   packets.push({s,arrival:elapsed+delay});
  }
  prediction.ingest(initial,0,start);
  let latest=initial,i=0,previousZ,lastSpeed,maxJolt=0,previousAt=0;
  for(let frame=1;frame<=120;frame++){
   const t=frame*1000/60+(link==='local'?[.1,1.4,-.3,.2,1][frame%5]:0);
   const frameMs=t-previousAt;
   // The renderer measures dt at the top of its loop; physics reads the
   // server clock later in that frame, after variable scene work.
   const dt=(frameMs+(link==='local'?.12*(frame%2?1:-1):0))/1000;
   let fresh;
   while(i<packets.length&&packets[i].arrival<=t){fresh=packets[i++];latest=fresh.s;prediction.observe(latest,fresh.arrival,start+fresh.arrival);}
   if(fresh)prediction.ingest(latest,fresh.arrival,start+fresh.arrival);
   const z=prediction.frame(latest,input,dt,t,start+t).z,speed=(z-previousZ)*1000/frameMs;
   if(t>750)maxJolt=Math.max(maxJolt,Math.abs(speed-lastSpeed));
   previousZ=z;lastSpeed=speed;previousAt=t;
  }
  assert(maxJolt<1,link+' checkpoints cause no extra hold or double step: '+maxJolt);
  assert.equal(prediction.stats().snaps,0);
  now+=600;def.onTick(room,ctx);
  const late=snapshot();assert.equal(late.simAt,now);assert(late.poseLagUs>=0&&late.poseLagUs<16667,'clamped late pumps report only the pending fixed-step fraction');
 }finally{prediction.dispose();def.dispose(room);}
}
// Actual shared Rapier worlds with ordinary 20Hz checkpoints. The timestamp
// belongs to the physical tick, even when a 144Hz frame receives it between
// ticks. Acceleration is real; a checkpoint must not add a hold/double step.
for(const hz of [60,120,144]){
 const driver={pid:'smooth',x:0,z:0,angle:0,speed:0,input:{throttle:0,steer:0},spawnSeq:0,connected:true,nitro:1};
 const room={map:flatMap,mode:'battle',half:200,blocks:[],pads:[],surfaces:[],karts:[driver],physicalEvents:[],physicalEventSeq:0};
 const physics=createClassicMotion(RAPIER,config,room),prediction=createClassicPrediction(RAPIER),seats=new Set(['smooth']),epoch=1700000000000,drive={throttle:.5,steer:0};
 for(let i=0;i<120;i++)physics.advance(config.fixedDt,seats);
 const startTick=physics.stats().tick;
 const snapshot=()=>({instanceId:'periodic-'+hz,phase:'drive',you:'smooth',youDrive:true,mode:'battle',map:{id:flatMap,half:200,blocks:[],pads:[],surfaces:[]},simAt:epoch+(physics.stats().tick-startTick)*config.fixedDt*1000,karts:[structuredClone(driver)],inputAck:{controlEpoch:0}});
 let latest=snapshot(),nextPacket=50,previous,previousSpeed,maxJolt=0;prediction.ingest(latest,0,epoch);
 try{
  for(let frame=1;frame<=Math.floor(hz*1.3);frame++){
   const t=frame*1000/hz;driver.input=drive;physics.advance(1/hz,seats);
   if(t>=nextPacket-1e-6){latest=snapshot();prediction.ingest(latest,t,epoch+t);prediction.frame(latest,drive,0,t,epoch+t);nextPacket+=50;}
   const draw=prediction.frame(latest,drive,1/hz,t,epoch+t).physicalPose.position;
   if(previous&&t>650){const speed=(draw.z-previous.z)*hz;if(previousSpeed!==undefined)maxJolt=Math.max(maxJolt,Math.abs(speed-previousSpeed));previousSpeed=speed;}
   previous=draw;
  }
  assert(prediction.stats().maxErrorM<.01,`${hz}Hz: agreeing physical checkpoints do not invent correction offsets`);
  assert(maxJolt<.65,`${hz}Hz: packet receipt does not hold/double a draw step: ${maxJolt}`);
  assert.equal(prediction.stats().snaps,0);
  console.log(JSON.stringify({classicPeriodicHz:hz,maxJolt,maxCorrectionM:prediction.stats().maxErrorM}));
 }finally{prediction.dispose();physics.dispose();}
}
const state={map:flatMap,mode:'battle',half:30,blocks:[],pads:[],surfaces:[],karts:[k],physicalEvents:[],physicalEventSeq:0};
const authority=createClassicMotion(RAPIER,config,state),client=createClassicPrediction(RAPIER),online=new Set(['a']);let maxYStep=0,maxLengthStep=0,previous,minY=Infinity,maxY=-Infinity,seq=0,correctionCpu=[];
const snap=()=>({instanceId:'fixture-1',phase:'drive',you:'a',youDrive:true,mode:'battle',map:{id:flatMap,half:30,blocks:[],pads:[],surfaces:[]},karts:[structuredClone(k)],inputAck:{appliedInputSeq:seq}});
client.ingest(snap(),0);
for(let i=0;i<240;i++){
 if(i%3===0){seq++;k._receivedSeq=seq;client.sent(seq);}
 authority.advance(1/60,online);
 if(i%3===0){const start=performance.now();client.ingest(snap(),i*1000/60);correctionCpu.push(performance.now()-start);}
 const draw=client.frame(snap(),{throttle:1,steer:0},1/60,i*1000/60);
 assert.ok(draw&&Object.values(draw.physicalPose.position).every(Number.isFinite));
 minY=Math.min(minY,draw.y);maxY=Math.max(maxY,draw.y);
 if(previous){maxYStep=Math.max(maxYStep,Math.abs(draw.y-previous.y));maxLengthStep=Math.max(maxLengthStep,...draw.physicalPose.wheels.map((w,j)=>Math.abs(w.length-previous.physicalPose.wheels[j].length)));}
 previous=draw;
}
assert.ok(maxYStep<.035,'repeated corrections must not cause suspension vertical jumps');assert.ok(maxLengthStep<.06,'wheel suspension remains bounded during correction');
const before=previous;const moved=client.frame(snap(),{throttle:1,steer:.6},1/60,240*1000/60);assert.ok(Math.hypot(moved.x-before.x,moved.z-before.z)>0,'self reacts between received snapshots');
k.connected=false;authority.sync(new Set());client.ingest(snap(),4100);const frozen=client.frame(snap(),{throttle:1,steer:1},.05,4150);assert.ok(Math.hypot(frozen.x-k.x,frozen.z-k.z)<.01,'disconnected body does not ghost drive');
// No latest-quaternion mixing: a remote half-way sample crosses +/-pi
// through the short quaternion arc and samples position at the same time.
const remoteClient=createClassicPrediction(RAPIER);
const remoteSnap=(angle,x,at)=>({...snap(),you:'watcher',youDrive:false,karts:[{...structuredClone(k),pid:'remote',spawnSeq:0,connected:true,physicalPose:{...structuredClone(k.physicalPose),position:{x,y:.65,z:0},rotation:{x:0,y:Math.sin(angle/2),z:0,w:Math.cos(angle/2)}}}],inputAck:null});
remoteClient.ingest(remoteSnap(Math.PI-.05,0),0);remoteClient.ingest(remoteSnap(-Math.PI+.05,2),100);
// Playback runs on server time minus the adaptive buffer delay.
remoteClient.remote('remote',150);const midpoint=remoteClient.remote('remote',50+remoteClient.remoteDelay());
assert.ok(Math.abs(midpoint.x-1)<1e-9,'remote xyz sampled midpoint');
assert.ok(Math.abs(Math.abs(midpoint.angle)-Math.PI)<.001,'rotation follows short wrap arc at same midpoint');
remoteClient.dispose();
// A short transport stall keeps local prediction running.
k.connected=true;client.ingest(snap(),5000);
const current=client.frame(snap(),{throttle:1,steer:0},.01,5010);
const stale=client.frame(snap(),{throttle:1,steer:1},.05,5300);
assert.notDeepEqual(stale.physicalPose.position,current.physicalPose.position,'>250ms dropout keeps physical prediction running');
// Life/epoch changes are exact hard corrections, never blended across respawn.
k.spawnSeq=1;k.physicalPose={...k.physicalPose,epoch:1,position:{x:4,y:.65,z:4},linearVelocity:{x:0,y:0,z:0}};
const fresh={...snap(),inputAck:{appliedInputSeq:0,controlEpoch:1}};
client.ingest(fresh,5400);const restored=client.frame(fresh,{throttle:0,steer:0},0,5400);
assert.deepEqual(restored.physicalPose.position,Object.fromEntries(Object.entries(k.physicalPose.position).map(([key,value])=>[key,Math.fround(value)])),'new life hard snaps exactly to Rapier float32 pose');
// A large authority correction next to the real perimeter cannot be hidden
// by retaining the prior render pose or blending through solid cover.
k.physicalPose={...k.physicalPose,position:{x:0,y:.65,z:28.3}};client.ingest({...snap(),inputAck:{appliedInputSeq:0,controlEpoch:1}},5450);
const wall=client.frame(snap(),{throttle:0,steer:0},0,5450);
assert.ok(Math.abs(wall.z-28.3)<1e-5,'large wall correction uses actual authority pose');
correctionCpu.sort((a,b)=>a-b);client.dispose();authority.dispose();console.log(JSON.stringify({pass:true,scope:'pure shared-core correction fixture; CPU only, no native/perceived timing',maxYStep,maxLengthStep,minY,maxY,correctionCpuP95Ms:correctionCpu[Math.ceil(correctionCpu.length*.95)-1],correctionCpuMaxMs:correctionCpu.at(-1)}));

// ACK acknowledges a held intent, not every RAF interval using it. Exercise
// actual Rapier worlds with FIFO snapshots and a calibrated server clock whose
// epoch differs from the client's monotonic clock. Delays are fixture schedules,
// not a claim about native input or measured network RTT.
const delayedMetrics=[];
for(const profile of ['stationary','forward','turn','fresh','wall'])for(const cadence of [50,100]){
 const driver={pid:'driver',x:0,z:0,angle:0,speed:0,boost:0,boostCd:0,turbo:0,padCd:0,nitro:1,input:{throttle:0,steer:0},spawnSeq:0,connected:true};
 const room={map:flatMap,mode:'battle',half:profile==='wall'?30:200,blocks:[],pads:[],surfaces:[],karts:[driver],physicalEvents:[],physicalEventSeq:0};
 const physics=createClassicMotion(RAPIER,config,room),prediction=createClassicPrediction(RAPIER),seats=new Set(['driver']);
 const epoch=1700000000000;let t=0,sequence=1,lastArrival=0,packets=[],commands=[],maxError=0,maxStep=0,maxPhysicalError=0,priorPosition,checks=0;
 const intentAt=at=>({throttle:profile==='stationary'?0:1,steer:profile==='turn'?.6:profile==='fresh'&&at>=2000?.6:0});
 const snapshot=()=>({instanceId:'delayed-'+profile,phase:'drive',you:'driver',youDrive:true,mode:'battle',map:{id:flatMap,half:room.half,blocks:[],pads:[],surfaces:[]},karts:[structuredClone(driver)],simAt:epoch+t,inputAck:{appliedInputSeq:driver._appliedSeq||0,controlEpoch:0}});
 driver.input=intentAt(0);driver._receivedSeq=sequence;prediction.ingest(snapshot(),0,epoch);prediction.sent(sequence);
 for(let frame=1;frame<=360;frame++){
  t=frame*1000/60;
  if(frame%30===0||profile==='fresh'&&frame===120){sequence++;prediction.sent(sequence);commands.push({at:t+65,seq:sequence,intent:intentAt(t)});}
  while(commands.length&&commands[0].at<=t){const command=commands.shift();driver.input=command.intent;driver._receivedSeq=command.seq;}
  physics.advance(1/60,seats);
  if(frame%(cadence/1000*60)===0){const delay=[65,130,90,110][Math.floor(frame/(cadence/1000*60))%4];lastArrival=Math.max(t+delay,lastArrival+.001);packets.push({at:lastArrival,s:snapshot()});}
  while(packets.length&&packets[0].at<=t){
   prediction.ingest(packets.shift().s,t,epoch+t);
   // A zero-dt observation after the render blend expires exposes simulation
   // pose without advancing physics. The receipt remains <250ms old.
   // Read the simulated pose itself: drawn frames blend between fixed steps.
   prediction.frame(snapshot(),intentAt(t),0,t+121,epoch+t);const raw=prediction.selfPose().position;
   if(t>2000)maxPhysicalError=Math.max(maxPhysicalError,Math.hypot(raw.x-driver.x,raw.z-driver.z));
  }
  const draw=prediction.frame(snapshot(),intentAt(t),1/60,t,epoch+t);
  if(t>2000){maxError=Math.max(maxError,Math.hypot(draw.x-driver.x,draw.z-driver.z));if(priorPosition)maxStep=Math.max(maxStep,Math.hypot(draw.x-priorPosition.x,draw.z-priorPosition.z));checks++;}
  priorPosition={x:draw.x,z:draw.z};
 }
 assert.ok(maxPhysicalError<.4,profile+' actual simulation replay error '+maxPhysicalError);
 assert.ok(maxError<.8,profile+' delayed held-intent replay physical/render divergence '+maxError);
 assert.ok(maxStep<.8,profile+' no snapshot-cadence jump '+maxStep);
 // New life/control epoch discards the old held timeline, even when seq restarts.
 driver.spawnSeq++;driver.physicalPose={...driver.physicalPose,epoch:driver.spawnSeq,position:{x:4,y:.75,z:4},linearVelocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}};
 const renewed={...snapshot(),inputAck:{appliedInputSeq:0,controlEpoch:1}};
 prediction.ingest(renewed,t+10,epoch+t+10);
 const resetPose=prediction.frame(renewed,{throttle:0,steer:0},0,t+10,epoch+t+10);
 assert.deepEqual(resetPose.physicalPose.position,{x:4,y:.75,z:4},'life and epoch reset do not replay retired held intent');
 const epochOnly={...renewed,inputAck:{appliedInputSeq:0,controlEpoch:2}};
 prediction.frame(renewed,{throttle:1,steer:0},.05,t+30,epoch+t+30);
 prediction.ingest(epochOnly,t+40,epoch+t+40);
 const neutralEpoch=prediction.frame(epochOnly,{throttle:0,steer:0},0,t+40,epoch+t+40);
 assert.deepEqual(neutralEpoch.physicalPose.position,resetPose.physicalPose.position,'control epoch alone discards retired input timeline');
 const stopped=prediction.frame(epochOnly,{throttle:1,steer:1},.05,t+1600,epoch+t+1600);
 assert.deepEqual(stopped.physicalPose.position,resetPose.physicalPose.position,'1500ms starvation budget holds without clearing the timeline');
 prediction.dispose();physics.dispose();delayedMetrics.push({profile,cadence,maxError,maxStep,maxPhysicalError,checks});
}
console.log(JSON.stringify({delayedMetrics,scope:'actual Rapier deterministic FIFO timing fixtures; visual blend remains active; no native/network acceptance'}));

// Public controls describe the already simulated pose, never pending input or
// weapons. Exercise the real classic projection and input/life/TTL gates.
{
 const players=[{id:'a',name:'A'},{id:'b',name:'B'}];let now=100000;
 const ctx={allPlayers:()=>players,players:()=>players,settings:()=>({map:'ring',mode:'battle'}),now:()=>now,broadcast(){},award(){},content:()=>({})};
 const def=engine.createKartGame({id:'motion-intent-fixture',name:'Motion intent fixture',createMotion:s=>createClassicMotion(RAPIER,config,s)}),room=def.create(ctx);
 const published=()=>JSON.parse(JSON.stringify(def.view(room,'a'))).karts[1].motionIntent;
 const neutral={steer:0,throttle:0,drift:false,nitro:false};
 assert.deepEqual(published(),neutral,'countdown has neutral public controls');
 now+=3000;def.onTick(room,ctx);
 def.onAction(room,ctx,'b',{seq:1,life:0,controlEpoch:0,input:{steer:.4,throttle:1,drift:true,nitro:true,boost:true}});
 assert.deepEqual(published(),neutral,'merely received input does not replace applied public controls');
 now+=50;def.onTick(room,ctx);
 assert.deepEqual(published(),{steer:.4,throttle:1,drift:true,nitro:true},'wire publishes bounded applied controls without weapon fields');
 def.onAction(room,ctx,'b',{seq:2,life:0,controlEpoch:0,input:{steer:-.5,throttle:.5,drift:false,nitro:false}});
 assert.equal(published().steer,.4,'pending new command cannot change the old pose intent');
 now+=50;def.onTick(room,ctx);assert.equal(published().steer,-.5,'next pose carries the newly applied intent');
 now+=engine.constants.INPUT_TTL_MS+1;def.onTick(room,ctx);assert.deepEqual(published(),neutral,'expired held input is neutral on wire');
 def.onConnection(room,ctx,'b',false);assert.deepEqual(published(),neutral,'disconnect clears public motion');
 def.onConnection(room,ctx,'b',true);room.karts[1].spawnSeq++;assert.deepEqual(published(),neutral,'new life cannot reuse retired intent');
 room.karts[1].respawn=1;assert.deepEqual(published(),neutral,'respawning peer carries neutral public controls');room.karts[1].respawn=0;
 room.karts[1]._motionIntent={steer:Infinity,throttle:NaN,drift:'true',nitro:1,life:room.karts[1].spawnSeq,epoch:room.karts[1].controlEpoch};
 assert.deepEqual(published(),neutral,'public controls sanitize even malformed internal fields');
 def.dispose(room);
}

const collisionMetrics=[];
for(const profile of ['head','rear','offcentre','cross'])for(const delay of [65,130])for(const cadence of [50,100]){
 const make=(pid,x,z,angle,input)=>({pid,x,z,angle,speed:0,boost:0,boostCd:0,turbo:0,padCd:0,nitro:1,input,spawnSeq:0,connected:true});
 const self=make('a',profile==='head'?-8:0,profile==='head'?0:-8,profile==='head'?Math.PI/2:0,{throttle:1,steer:0});
 const peer=make('b',profile==='head'||profile==='cross'?8:profile==='offcentre'?1.8:0,0,profile==='head'||profile==='cross'?-Math.PI/2:0,{throttle:profile==='head'||profile==='cross'?1:0,steer:0});
 const room={map:flatMap,mode:'battle',half:60,blocks:[],pads:[],surfaces:[],karts:[self,peer],physicalEvents:[],physicalEventSeq:0};
 const physics=createClassicMotion(RAPIER,config,room),prediction=createClassicPrediction(RAPIER),online=new Set(['a','b']),hull=new RAPIER.Cuboid(config.chassis.half.x,config.chassis.half.y,config.chassis.half.z);
 let t=0,packets=[],latest,maxError=0,maxDrawLag=0,minRenderGap=Infinity,minAuthorityGap=Infinity,maxRemoteStep=0,previousPeer,contacts=0;const cpu=[];
 const snapshot=()=>({instanceId:profile+delay+cadence,phase:'drive',you:'a',youDrive:true,mode:'battle',map:{id:flatMap,half:60,blocks:[],pads:[],surfaces:[]},karts:room.karts.map(k=>({...structuredClone(k),motionIntent:structuredClone(k.input)})),simAt:100000+t,inputAck:{controlEpoch:0}});
 latest=snapshot();prediction.ingest(latest,0,100000);
 for(let frame=1;frame<=240;frame++){
  t=frame*1000/60;physics.advance(1/60,online);contacts+=room.physicalEvents.filter(e=>e.ids.length===2).length;room.physicalEvents.length=0;
  const [pa,pb]=room.karts.map(k=>k.physicalPose),authorityContact=hull.contactShape(pa.position,pa.rotation,hull,pb.position,pb.rotation,10);if(authorityContact)minAuthorityGap=Math.min(minAuthorityGap,authorityContact.distance);
  if(frame%(cadence/1000*60)===0)packets.push({at:t+delay,s:snapshot()});
  while(packets.length&&packets[0].at<=t){latest=packets.shift().s;const start=performance.now();prediction.ingest(latest,t,100000+t);cpu.push(performance.now()-start);}
  const a=prediction.frame(latest,self.input,1/60,t,100000+t),b=prediction.remote('b',t,100000+t);
  // Simulation error; the drawn pose may trail it by under one fixed step.
  const sim=prediction.selfPose().position;maxError=Math.max(maxError,Math.hypot(sim.x-self.x,sim.z-self.z));
  maxDrawLag=Math.max(maxDrawLag,Math.hypot(a.x-sim.x,a.z-sim.z));
  const contact=hull.contactShape(a.physicalPose.position,a.physicalPose.rotation,hull,b.physicalPose.position,b.physicalPose.rotation,10);if(contact)minRenderGap=Math.min(minRenderGap,contact.distance);
  if(previousPeer)maxRemoteStep=Math.max(maxRemoteStep,Math.hypot(b.x-previousPeer.x,b.z-previousPeer.z));previousPeer=b;
 }
 assert.ok(contacts>0,profile+' actual authority collision occurred');
 assert.ok(maxError<.2,profile+' replay preserves physical collision response: '+maxError);
 assert.ok(maxDrawLag<.45,profile+' step blend trails simulation by under one step: '+maxDrawLag);
 assert.ok(minRenderGap>(profile==='cross'?-.085:-.035),profile+' displayed local/peer hull penetration is bounded: '+minRenderGap);
 assert.ok(minRenderGap>=minAuthorityGap-.02,profile+' display does not add penetration beyond solver tolerance');
 assert.ok(maxRemoteStep<.5,profile+' near-field transition has no teleport: '+maxRemoteStep);
 // A respawn discards the interpolation trail immediately, even inside its
 // usual 100ms delay; dropped transport freezes the last accepted sample.
 peer.spawnSeq++;peer.physicalPose={...peer.physicalPose,epoch:peer.spawnSeq,position:{x:20,y:.65,z:20},linearVelocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}};
 latest=snapshot();prediction.ingest(latest,t,100000+t);prediction.frame(latest,{throttle:0,steer:0},0,t,100000+t);
 assert.deepEqual(prediction.remote('b',t,100000+t).physicalPose.position,{x:20,y:.65,z:20},'remote new life never blends with retired location');
 const stale=prediction.remote('b',t+300,100000+t+300);prediction.frame(latest,{throttle:1,steer:1},.05,t+400,100000+t+400);
 assert.deepEqual(prediction.remote('b',t+400,100000+t+400).physicalPose.position,stale.physicalPose.position,'stale remote remains frozen');
 cpu.sort((a,b)=>a-b);collisionMetrics.push({profile,delay,cadence,maxError,minRenderGap,minAuthorityGap,maxRemoteStep,contacts,correctionCpuP95Ms:cpu[Math.ceil(cpu.length*.95)-1]});prediction.dispose();physics.dispose();
}
console.log(JSON.stringify({collisionMetrics,scope:'two actual Rapier worlds, four two-driver impact routes, 65/130ms FIFO delay and50/100ms snapshots; CPU and hull geometry only'}));

// Two remotes must stay on the same near-field timeline when they collide,
// even if one is farther from the local driver than the other.
{
 const make=(pid,z,throttle)=>({pid,x:0,z,angle:0,speed:0,boost:0,boostCd:0,turbo:0,padCd:0,nitro:1,input:{steer:0,throttle},spawnSeq:0,connected:true});
 const room={map:flatMap,mode:'battle',half:60,blocks:[],pads:[],surfaces:[],karts:[make('a',-20,1),make('b',-9,1),make('c',0,0)],physicalEvents:[],physicalEventSeq:0};
 const physics=createClassicMotion(RAPIER,config,room),prediction=createClassicPrediction(RAPIER),online=new Set(['a','b','c']),hull=new RAPIER.Cuboid(config.chassis.half.x,config.chassis.half.y,config.chassis.half.z);
 let t=0,packets=[],latest,minRemoteGap=Infinity,maxRemoteStep=0,previous=new Map();
 const snapshot=()=>({instanceId:'three-driver',phase:'drive',you:'a',youDrive:true,mode:'battle',map:{id:flatMap,half:60,blocks:[],pads:[],surfaces:[]},karts:room.karts.map(k=>({...structuredClone(k),motionIntent:structuredClone(k.input)})),simAt:100000+t,inputAck:{controlEpoch:0}});
 latest=snapshot();prediction.ingest(latest,0,100000);
 for(let frame=1;frame<=240;frame++){
  t=frame*1000/60;physics.advance(1/60,online);if(frame%6===0)packets.push({at:t+130,s:snapshot()});
  while(packets.length&&packets[0].at<=t){latest=packets.shift().s;prediction.ingest(latest,t,100000+t);}
  prediction.frame(latest,room.karts[0].input,1/60,t,100000+t);
  const peers=['b','c'].map(pid=>prediction.remote(pid,t,100000+t)),[b,c]=peers.map(k=>k.physicalPose),contact=hull.contactShape(b.position,b.rotation,hull,c.position,c.rotation,10);if(contact)minRemoteGap=Math.min(minRemoteGap,contact.distance);
  for(let i=0;i<peers.length;i++){const pid=['b','c'][i],peer=peers[i],old=previous.get(pid);if(old)maxRemoteStep=Math.max(maxRemoteStep,Math.hypot(peer.x-old.x,peer.z-old.z));previous.set(pid,peer);}
 }
 assert.ok(minRemoteGap>-.035,'two rendered remotes cannot overlap at different near-field times: '+minRemoteGap);
 assert.ok(maxRemoteStep<.5,'three-driver near-field transition has no teleport: '+maxRemoteStep);
 console.log(JSON.stringify({threeDriver:{minRemoteGap,maxRemoteStep},scope:'three actual Rapier drivers,130ms FIFOdelay/100ms snapshots; CPU/hull geometry only'}));prediction.dispose();physics.dispose();
}

// Treat public motionIntent as a small validated boundary. Unexpected values
// and stale/retired controls cannot inject nitro, weapons or non-finite motion.
{
 const make=(pid,x,z)=>({pid,x,z,angle:0,speed:0,boost:0,boostCd:0,turbo:0,padCd:0,nitro:1,input:{steer:0,throttle:0},spawnSeq:0,connected:true});
 const room={map:flatMap,mode:'battle',half:30,blocks:[],pads:[],surfaces:[],karts:[make('a',0,0),make('b',3.5,0)],physicalEvents:[],physicalEventSeq:0};
 const physics=createClassicMotion(RAPIER,config,room);
 const snapshot=(motionIntent,extra={},peerExtra={})=>({instanceId:'validation',phase:'drive',you:'a',youDrive:true,mode:'battle',map:{id:flatMap,half:30,blocks:[],pads:[],surfaces:[]},karts:room.karts.map(k=>({...structuredClone(k),motionIntent,...(k.pid==='b'?peerExtra:{})})),simAt:100000,inputAck:{controlEpoch:0},...extra});
 const project=(intent,extra,peerExtra)=>{const p=createClassicPrediction(RAPIER),s=snapshot(intent,extra,peerExtra);p.ingest(s,0,100000);for(let i=1;i<=10;i++)p.frame(s,{throttle:0,steer:0},1/60,i*1000/60,100000+i*1000/60);const remote=p.remote('b',100,100000+100);p.dispose();return remote.physicalPose;};
 const neutral={steer:0,throttle:0,drift:false,nitro:false},base=project(neutral);
 assert.deepEqual(project({steer:Infinity,throttle:'1',drift:1,nitro:'true',boost:true,brake:1,use:true}).position,base.position,'arbitrary control fields cannot alter peer dynamics');
 assert.deepEqual(project({steer:2,throttle:99,drift:true,nitro:true}).position,project({steer:1,throttle:1,drift:true,nitro:true}).position,'numeric controls are bounded');
 assert.deepEqual(project({steer:1,throttle:1,nitro:true},{simAt:99000}).position,base.position,'stale authoritative timestamp neutralizes remote controls');
 for(const retired of [{connected:false},{respawn:1}])assert.deepEqual(project({steer:1,throttle:1,nitro:true},{},retired).position,room.karts[1].physicalPose.position,'disconnected/respawning public controls cannot move the peer');
 physics.dispose();
}

// A near-field blend around cover must never cut through the real static
// hull. Watchers keep their coherent delayed interpolation timeline.
{
 const make=(pid,x,z)=>({pid,x,z,angle:0,speed:0,boost:0,boostCd:0,turbo:0,padCd:0,nitro:1,input:{steer:0,throttle:0},spawnSeq:0,connected:true});
 const room={map:flatMap,mode:'battle',half:30,blocks:[{x:0,z:0,hw:2,hd:2}],pads:[],surfaces:[],karts:[make('a',0,16),make('b',4,0),make('c',4,3.5)],physicalEvents:[],physicalEventSeq:0};
 const physics=createClassicMotion(RAPIER,config,room),prediction=createClassicPrediction(RAPIER);
 const snapshot=()=>({instanceId:'cover',phase:'drive',you:'a',youDrive:true,mode:'battle',map:{id:flatMap,half:30,blocks:room.blocks,pads:[],surfaces:[]},karts:structuredClone(room.karts),inputAck:{controlEpoch:0}});
 const before=snapshot();prediction.ingest(before,0);room.karts[1].physicalPose.position={x:0,y:.65,z:4};room.karts[2].physicalPose.position={x:0,y:.65,z:7.5};const next=snapshot();prediction.ingest(next,100);prediction.frame(next,{throttle:0,steer:0},0,100);const middleAt=50+prediction.remoteDelay();prediction.frame(next,{throttle:0,steer:0},0,middleAt);
 const remote=prediction.remote('b',middleAt).physicalPose,hull=new RAPIER.Cuboid(config.chassis.half.x,config.chassis.half.y,config.chassis.half.z),cover=new RAPIER.Cuboid(2,.75,2);
 assert.ok(hull.contactShape(remote.position,remote.rotation,cover,{x:0,y:.75,z:0},{x:0,y:0,z:0,w:1},10).distance>=0,'near-field curve cannot interpolate through cover');
 assert.deepEqual(prediction.remote('c',middleAt).physicalPose.position,{x:0,y:Math.fround(.65),z:7.5},'static safety fallback moves the whole contact group to one predicted timeline');
 prediction.frame({...next,youDrive:false},{throttle:0,steer:0},0,50+prediction.remoteDelay());
 const initial=before.karts[1].physicalPose.position;
 assert.deepEqual(prediction.remote('b',50+prediction.remoteDelay()).physicalPose.position,{x:initial.x/2,y:initial.y+(.65-initial.y)*.5,z:initial.z+(4-initial.z)*.5},'non-driving role retains delayed interpolation');
 prediction.dispose();physics.dispose();
}

// A locally predicted entry must dress the tube before the next server
// snapshot knows about the launch. The physics pose and landing stay shared.
{
 const features={cannons:[{x:0,z:0,angle:0,land:{x:0,z:20,angle:0},flight:1.4,apex:8}],portals:[],falls:[]};
 const driver={pid:'entry',x:0,z:-1.35,angle:0,speed:0,input:{throttle:1,steer:0},spawnSeq:0,connected:true,nitro:1};
 const state={map:'mouth-prediction',mode:'battle',half:30,blocks:[],pads:[],surfaces:[],features,karts:[driver],physicalEvents:[],physicalEventSeq:0};
 const physics=createClassicMotion(RAPIER,config,state),prediction=createClassicPrediction(RAPIER);
 physics.restore(driver,{...driver.physicalPose,linearVelocity:{x:0,y:0,z:4}});
 const snapshot={instanceId:'mouth-prediction',phase:'drive',you:driver.pid,youDrive:true,mode:'battle',map:{id:'mouth-prediction',half:30,blocks:[],pads:[],surfaces:[],features},karts:[structuredClone(driver)],inputAck:{appliedInputSeq:0}};
 prediction.ingest(snapshot,0);let draw;
 for(let i=0;i<12&&!draw?.flight;i++)draw=prediction.frame(snapshot,{throttle:1,steer:0},1/60,(i+1)*1000/60);
 assert.ok(draw.flight&&draw.flight.c===0,'draw pose carries the predicted launch through the real mouth trigger');
 assert.ok(!snapshot.karts[0].flight,'no authoritative launch snapshot was injected');
 prediction.dispose();physics.dispose();
 console.log('KART_CANNON_PREDICTION_PASS: tube entry is visible before the next server snapshot');
}

// Bursty FIFO arrivals at real high-refresh frame rates. Keep all held
// intervals, including the already ACKed intent, across a 600 ms stall.
for(const hz of [120,144]){
 const driver={pid:'self',x:0,z:0,angle:0,speed:0,input:{throttle:.3,steer:0},spawnSeq:0,connected:true,nitro:1};
 const room={map:flatMap,mode:'battle',half:200,blocks:[],pads:[],surfaces:[],karts:[driver],physicalEvents:[],physicalEventSeq:0};
 const physics=createClassicMotion(RAPIER,config,room),prediction=createClassicPrediction(RAPIER),seats=new Set(['self']),epoch=1700000000000;
 const snapshot=t=>({instanceId:'burst-'+hz,phase:'drive',you:'self',youDrive:true,mode:'battle',map:{id:flatMap,half:200,blocks:[],pads:[],surfaces:[]},karts:[structuredClone(driver)],simAt:epoch+t,inputAck:{life:0,controlEpoch:0}});
 const intent={throttle:.3,steer:0};let s=snapshot(0),previous,maxStep=0,at300,stale=[];
 prediction.ingest(s,0,epoch);
 for(let f=1;f<=hz*.6;f++){
  const t=f*1000/hz;physics.advance(1/hz,seats);
  if(!at300&&t>=300)at300=snapshot(t);
  if(stale.length<10&&t>=stale.length*30+30)stale.push(snapshot(t));
  const draw=prediction.frame(s,intent,1/hz,t,epoch+t);
  if(previous)maxStep=Math.max(maxStep,Math.hypot(draw.x-previous.x,draw.y-previous.y,draw.z-previous.z));previous=draw;
 }
 assert.ok(previous.z>.2,'own kart advances through 600ms without a packet at '+hz+'Hz');
 const arrival=600;at300.karts[0].physicalPose.position.x-=.8;
 prediction.ingest(at300,arrival,epoch+arrival);
 let draw=prediction.frame(s,intent,0,arrival,epoch+arrival);
 assert.ok(Math.hypot(draw.x-previous.x,draw.y-previous.y,draw.z-previous.z)<.15,'late pose stays continuous');
 for(let f=1;f<=hz*.2;f++){
  const t=arrival+f*1000/hz;draw=prediction.frame(s,intent,1/hz,t,epoch+t);
  maxStep=Math.max(maxStep,Math.hypot(draw.x-previous.x,draw.y-previous.y,draw.z-previous.z));previous=draw;
 }
 assert.ok(maxStep<.15,'no late-packet frame exceeds .15m: '+maxStep);
 const before=prediction.stats().corrections;
 for(const packet of stale)prediction.observe(packet,800,epoch+800);
 const fresh=snapshot(800);fresh.karts[0].physicalPose.position.x+=.6;
 prediction.observe(fresh,800,epoch+800);prediction.ingest(fresh,800,epoch+800);
 const first=prediction.frame(fresh,intent,0,800,epoch+800),target=prediction.selfPose().position;
 assert.equal(prediction.stats().corrections,before+1,'eleven observations do one authoritative replay');
 assert.equal(prediction.stats().snaps,0,'stale burst and recovery never hard snap');
 const error=Math.abs(first.x-target.x);let settled=first;
 for(let f=1;f<=60;f++)settled=prediction.frame(fresh,intent,0,800+f*1000/60,epoch+800+f*1000/60);
 assert.ok(Math.abs(settled.x-target.x)<error*.01,'remaining visual error decays');
 assert.equal(prediction.stats().lastAgeMs,0);
 prediction.frame(fresh,intent,0,2400,epoch+2400);assert.equal(prediction.stats().starvedMs,100);
 const respawn={...fresh,karts:structuredClone(fresh.karts)};respawn.karts[0].spawnSeq++;respawn.karts[0].physicalPose.epoch++;respawn.karts[0].physicalPose.position={x:8,y:.75,z:8};
 prediction.ingest(respawn,2400,epoch+2400);
 assert.deepEqual(prediction.frame(respawn,intent,0,2400,epoch+2400).physicalPose.position,{x:8,y:.75,z:8},'real respawn still snaps');
 assert.equal(prediction.stats().snaps,1);
 prediction.dispose();physics.dispose();
 console.log(JSON.stringify({burstHz:hz,maxStep,snapsBeforeRespawn:0}));
}

// Watcher playback recovers from held/extrapolated poses without a jump.
{
 const driver={pid:'remote',x:0,z:0,angle:0,speed:6,input:{throttle:0,steer:0},spawnSeq:0,connected:true};
 const room={map:flatMap,half:200,blocks:[],pads:[],surfaces:[],karts:[driver],physicalEvents:[],physicalEventSeq:0};
 const physics=createClassicMotion(RAPIER,config,room),prediction=createClassicPrediction(RAPIER);
 const snapshot=t=>({instanceId:'remote-burst',phase:'drive',you:'watcher',youDrive:false,map:{id:flatMap,half:200,blocks:[],pads:[],surfaces:[]},simAt:t,karts:[{...structuredClone(driver),physicalPose:{...structuredClone(driver.physicalPose),position:{x:t*.006,y:.65,z:0},linearVelocity:{x:6,y:0,z:0}}}]});
 prediction.ingest(snapshot(0),40,40);prediction.ingest(snapshot(33),73,73);
 let previous,maxStep=0;
 for(let f=5;f<100;f++){
  const now=f*1000/60;
  if(f===42)prediction.observe(snapshot(now-70),now,now);
  if(f>42&&f%2===0)prediction.observe(snapshot(now-70),now,now);
  const pose=prediction.remote('remote',now,now);
  if(previous)maxStep=Math.max(maxStep,Math.abs(pose.x-previous.x));previous=pose;
 }
 assert.ok(maxStep<.3,'remote underrun recovery is capped at 60Hz: '+maxStep);
 // Five ordered snapshots can land together after a 165ms queue. A rival
 // maintaining 6m/s must still move on the first frame after each delivery.
 const viewer=createClassicPrediction(RAPIER),packets=[];
 for(let at=0;at<15000;at+=33)packets.push({at,arrival:at+50+Math.max(0,165-at%1050)});
 let index=0,lastX,stops=0;
 for(let frame=0;frame<900;frame++){
  const t=frame*1000/60;
  while(index<packets.length&&packets[index].arrival<=t){
   const {at,arrival}=packets[index++];viewer.observe(snapshot(at),arrival,arrival);
  }
  const rival=viewer.remote('remote',t,t);
  if(!rival)continue;
  if(t>2000&&(rival.x-lastX)*60<.3)stops++;
  lastX=rival.x;
 }
 assert.equal(stops,0,'late snapshots never cancel a frame of ordinary travel');
 viewer.dispose();
 prediction.dispose();physics.dispose();console.log(JSON.stringify({remoteRecoveryMaxStep:maxStep}));
}

// Reaching the starvation budget holds the draw pose, but must retain the
// simulated input tail so a late authority can still replay up to that pose.
{
 const driver={pid:'tail',x:0,z:0,angle:0,speed:0,input:{throttle:.3,steer:0},spawnSeq:0,connected:true,nitro:1};
 const room={map:flatMap,half:200,blocks:[],pads:[],surfaces:[],karts:[driver],physicalEvents:[],physicalEventSeq:0};
 const physics=createClassicMotion(RAPIER,config,room),prediction=createClassicPrediction(RAPIER),seats=new Set(['tail']);
 const snapshot=t=>({instanceId:'starved-tail',phase:'drive',you:'tail',youDrive:true,map:{id:flatMap,half:200,blocks:[],pads:[],surfaces:[]},simAt:t,karts:[structuredClone(driver)],inputAck:{controlEpoch:0}});
 const initial=snapshot(0);prediction.ingest(initial,0);let late,held,heldRaw,draw;
 for(let f=1;f<=192;f++){
  const t=f*1000/120;physics.advance(1/120,seats);if(f===120)late=snapshot(t);
  draw=prediction.frame(initial,driver.input,1/120,t);if(f===180){held=draw;heldRaw=structuredClone(prediction.selfPose().position);}
 }
 assert.deepEqual(draw.physicalPose.position,held.physicalPose.position,'budget holds last rendered pose');
 prediction.ingest(late,1600,1600);const resumed=prediction.frame(late,driver.input,0,1600);
 assert.ok(Math.hypot(resumed.x-held.x,resumed.z-held.z)<.15,'return after starvation remains continuous');
 assert.ok(Math.abs(prediction.selfPose().position.z-heldRaw.z)<.01,'retained input tail replays the held simulation timeline');
 assert.equal(prediction.stats().snaps,0);prediction.dispose();physics.dispose();
}

// A slow render frame still covers its whole simulated interval. A late
// packet must replay that interval as well as a fresh packet can restore it.
for(const age of [0,100]){
 const intent={throttle:.3,steer:0},driver={pid:'slow',x:0,z:0,angle:0,speed:0,input:{throttle:0,steer:0},spawnSeq:0,connected:true,nitro:1};
 const room={map:flatMap,mode:'battle',half:200,blocks:[],pads:[],surfaces:[],karts:[driver],physicalEvents:[],physicalEventSeq:0};
 const physics=createClassicMotion(RAPIER,config,room),prediction=createClassicPrediction(RAPIER),seats=new Set(['slow']),epoch=1700000000000;
 for(let i=0;i<60;i++)physics.advance(1/60,seats);
 physics.restore(driver,{...driver.physicalPose,linearVelocity:{x:0,y:0,z:8}});driver.input=intent;
 const snapshot=t=>({instanceId:'slow-frame-'+age,phase:'drive',you:'slow',youDrive:true,mode:'battle',map:{id:flatMap,half:200,blocks:[],pads:[],surfaces:[]},simAt:epoch+t,karts:[structuredClone(driver)],inputAck:{controlEpoch:0}});
 const initial=snapshot(0);prediction.ingest(initial,0,epoch);let late;
 for(let i=1;i<=12;i++){physics.advance(1/60,seats);if(i===6)late=snapshot(100);}
 const fresh=snapshot(200);prediction.frame(initial,intent,.2,200,epoch+200);
 const error=()=>Math.hypot(...['x','y','z'].map(key=>prediction.selfPose().position[key]-driver.physicalPose.position[key]));
 assert.ok(error()<.3,'200ms frame covers the same time as authority: '+error());
 prediction.ingest(age?late:fresh,200,epoch+200);
 assert.ok(error()<.3,'history replays all simulated time after the snapshot: '+error());
 assert.ok(prediction.stats().maxErrorM<.3,'slow-frame correction stays below .3m: '+prediction.stats().maxErrorM);
 assert.equal(prediction.stats().snaps,0,'agreeing slow-frame authority never snaps');
 console.log(JSON.stringify({slowFrameMs:200,age,physicalErrorM:error(),maxCorrectionM:prediction.stats().maxErrorM,snaps:prediction.stats().snaps}));
 prediction.dispose();physics.dispose();
}
