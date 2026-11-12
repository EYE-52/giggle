import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-compat';
import C from '../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {createElevatedMotion} from '../public/js/engines/kart-elevated-motion.mjs';
import {createElevatedPrediction} from '../public/js/engines/kart-elevated-prediction.mjs';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {elevatedStatics} from '../public/js/engines/kart-feature-solids.mjs';
import {rebasePreviousPose} from '../public/js/engines/kart-prediction-pose.mjs';
await R.init();
const epoch=1700000000000,neutral={steer:0,throttle:0,brake:0,nitro:false,use:false},intent={...neutral,throttle:.3};
const distance=(a,b)=>Math.hypot(...['x','y','z'].map(k=>a[k]-b[k]));
{
  const before={epoch:1,position:{x:1,y:0,z:2},rotation:{x:0,y:0,z:0,w:1},wheels:[{rotation:10,length:.3,steering:.2}]};
  const prior={...structuredClone(before),position:{x:1,y:0,z:1},wheels:[{rotation:9,length:.31,steering:.1}]};
  const after={...structuredClone(before),position:{x:5,y:3,z:7},rotation:{x:0,y:Math.SQRT1_2,z:0,w:Math.SQRT1_2},wheels:[{rotation:12,length:.28,steering:.3}]};
  const input=JSON.stringify([prior,before,after]),draw=rebasePreviousPose(prior,before,after);
  assert(distance(draw.position,{x:4,y:3,z:7})<1e-9,'prior motion follows the checkpoint translation and rotation');
  assert(Math.abs(Math.hypot(...Object.values(draw.rotation))-1)<1e-9,'rebased orientation remains normalized');
  assert.equal(draw.wheels[0].rotation,11,'wheel spin keeps the previous fixed-step offset');
  assert.equal(JSON.stringify([prior,before,after]),input,'presentation history cannot mutate any physical pose');
  assert.equal(rebasePreviousPose(prior,before,{...after,epoch:2}),null,'teleports cannot retain the old presentation step');
}
function fixture(){
  const map=elevatedMap('garden'),physics=createKartPhysics(R,C),prediction=createElevatedPrediction(R);
  elevatedStatics(map).forEach(d=>physics.addStatic(d));physics.addKart('a',{position:{x:0,y:.7,z:-50}});
  const kart={id:'a',alive:true,connected:true,spawnSeq:0,controlEpoch:0,nitro:1,input:neutral},motion=createElevatedMotion({physics,map,karts:[kart]});let accumulator=0;
  function advance(seconds,input=neutral){
    accumulator+=seconds;kart.input=input;
    while(accumulator>=C.fixedDt-1e-9){motion.controls(kart,C.fixedDt);physics.step();motion.afterStep(C.fixedDt);accumulator-=C.fixedDt;}
  }
  for(let i=0;i<90;i++)advance(C.fixedDt);
  const snapshot=t=>({instanceId:'raised-prediction',mapId:map.id,mapRevision:map.revision,phase:'live',you:'a',youDrive:true,simAt:epoch+t,
    inputAck:{life:kart.spawnSeq,controlEpoch:kart.controlEpoch,receivedSeq:1,appliedInputSeq:1},karts:[{...structuredClone(kart),pose:physics.pose('a')}]});
  return {physics,prediction,advance,snapshot,dispose(){prediction.dispose();motion.dispose();physics.dispose();}};
}

// Actual raised motion and Rapier at high refresh rates. The server ACKs the
// held intent once; every later interval must survive a late FIFO packet.
for(const hz of [60,120,144]){
  const f=fixture(),{prediction:p}=f,initial=f.snapshot(0);p.ingest(initial,0,epoch);
  let previous=p.frame(initial,intent,0,0,epoch),late,maxStep=0;
  const start=structuredClone(previous.renderPose.position);
  try{
    for(let n=1;n<=Math.floor(hz*.6);n++){
      const t=n*1000/hz;f.advance(1/hz,intent);if(!late&&t>=300)late=f.snapshot(t);
      const draw=p.frame(initial,intent,1/hz,t,epoch+t);
      maxStep=Math.max(maxStep,distance(draw.renderPose.position,previous.renderPose.position));previous=draw;
    }
    assert(distance(previous.renderPose.position,start)>.2,hz+'Hz: own kart advances through 600ms without a snapshot');
    assert.equal(p.stats().history,1,'identical consecutive intents share one time interval');
    late.audioBaseline=true;late.karts[0].pose.position.x-=hz===60?.4:.8;
    p.ingest(late,600,epoch+600);
    const recovered=p.frame(late,intent,0,600,epoch+600);
    assert(distance(recovered.renderPose.position,previous.renderPose.position)<.15,'late packet has no immediate visual jump: '+distance(recovered.renderPose.position,previous.renderPose.position));
    assert(Math.abs(recovered.pose.position.z-f.physics.pose('a').position.z)<.1,'late packet replays the ACKed held intent after simAt');
    previous=recovered;
    for(let n=1;n<=Math.floor(hz*.2);n++){
      const t=600+n*1000/hz,draw=p.frame(late,intent,1/hz,t,epoch+t);
      maxStep=Math.max(maxStep,distance(draw.renderPose.position,previous.renderPose.position));previous=draw;
    }
    assert(maxStep<.15,hz+'Hz: no recovery frame exceeds .15m: '+maxStep);
    assert.equal(p.stats().snaps,0,'late packet and audio baseline do not reset prediction');
    const target=previous.pose.position,error=Math.abs(previous.renderPose.position.x-target.x);
    for(let n=1;n<=60;n++)previous=p.frame(late,intent,0,800+n*1000/60,epoch+800+n*1000/60);
    assert(Math.abs(previous.renderPose.position.x-target.x)<error*.01,'visual correction decays to the predicted pose');
    const held=structuredClone(previous.renderPose.position),starved=p.frame(late,intent,.05,2200,epoch+2200);
    assert.deepEqual(starved.renderPose.position,held,'1500ms budget holds the final own pose rather than switching to delayed playback');
    assert.equal(p.stats().starvedMs,100);
    const respawn=structuredClone(late);respawn.simAt=epoch+2200;respawn.karts[0].spawnSeq++;respawn.karts[0].pose.epoch++;
    respawn.karts[0].pose.position={x:8,y:.75,z:-42};respawn.inputAck.life++;
    p.ingest(respawn,2200,epoch+2200);
    assert.deepEqual(p.frame(respawn,neutral,0,2200,epoch+2200).renderPose.position,{x:8,y:.75,z:-42},'real respawn snaps exactly');
    assert.equal(p.stats().snaps,1);assert.equal(p.stats().history,0);
    console.log(JSON.stringify({raisedBurstHz:hz,maxStep,snapsBeforeRespawn:0}));
  }finally{f.dispose();}
}

// A slow frame simulates its full time. Merged intervals can also replay more
// than 250ms in total; each run still uses the shared fixed physics step.
for(const age of [0,100]){
  const f=fixture(),{prediction:p}=f,initial=f.snapshot(0);p.ingest(initial,0,epoch);let late;
  try{
    for(let i=1;i<=12;i++){f.advance(C.fixedDt,intent);if(i===6)late=f.snapshot(100);}
    const draw=p.frame(initial,intent,.2,200,epoch+200);
    assert(distance(draw.pose.position,f.physics.pose('a').position)<.03,'200ms frame covers all authority steps');
    const packet=age?late:f.snapshot(200);p.ingest(packet,200,epoch+200);
    assert(distance(p.frame(packet,intent,0,200,epoch+200).pose.position,f.physics.pose('a').position)<.03,'late replay retains the whole slow-frame interval');
    assert.equal(p.stats().snaps,0);
    const prior=p.stats().simAt;p.frame(packet,intent,1,400,epoch+400);
    assert(Math.abs(p.stats().simAt-prior-250)<.001,'one frame simulates at most 250ms');
  }finally{f.dispose();}
}

// Many changing inputs must be retained by age, never a 30-frame cap. Only
// authoritative life, control and teleport changes discard their history.
{
  const f=fixture(),{prediction:p}=f,initial=f.snapshot(0);p.ingest(initial,0,epoch);
  try{
    for(let n=1;n<=72;n++)p.frame(initial,{...intent,steer:n%2?.1:-.1},1/120,n*1000/120,epoch+n*1000/120);
    assert.equal(p.stats().history,72,'600ms of distinct 120Hz intents are retained');
    const packet=f.snapshot(100);p.ingest(packet,600,epoch+600);
    assert(p.stats().history>=59,'late packet keeps all intervals after simAt');
    for(const field of ['control','teleport']){
      const changed=structuredClone(packet);changed.simAt+=field==='control'?1:2;
      if(field==='control')changed.inputAck.controlEpoch++;else changed.karts[0].pose.epoch++;
      p.ingest(changed,610,epoch+610);assert.equal(p.stats().history,0,field+' clears retired history');
      assert.deepEqual(p.frame(changed,neutral,0,610,epoch+610).renderPose.position,changed.karts[0].pose.position,field+' snaps exactly');
    }
  }finally{f.dispose();}
}

// Starvation holds the draw, but the retained simulated tail is still replayed
// when authority arrives. A merged interval longer than 250ms must run in full.
{
  const f=fixture(),{prediction:p}=f,initial=f.snapshot(0);p.ingest(initial,0,epoch);let late,held,heldRaw;
  try{
    for(let n=1;n<=192;n++){
      const t=n*1000/120;f.advance(1/120,intent);if(n===120)late=f.snapshot(t);
      const draw=p.frame(initial,intent,1/120,t,epoch+t);
      if(n===180){held=draw.renderPose.position;heldRaw=draw.pose.position;}
      if(n>180)assert.deepEqual(draw.renderPose.position,held,'starvation holds the last render');
    }
    p.ingest(late,1600,epoch+1600);const resumed=p.frame(late,intent,0,1600,epoch+1600);
    assert(distance(resumed.renderPose.position,held)<.15,'return after starvation remains continuous');
    assert(distance(resumed.pose.position,heldRaw)<.03,'retained merged tail replays the held simulation timeline');
    assert.equal(p.stats().snaps,0);
  }finally{f.dispose();}
}
// Repeated ordinary 20Hz checkpoints must not turn a smooth 60Hz physical
// trajectory into a packet-paced pulse, including fractional render frames.
for(const hz of [60,120,144]){
  const f=fixture(),p=f.prediction,startTick=f.physics.stats().tick,drive={...neutral,throttle:.5};
  let latest=f.snapshot(0),nextPacket=50,previous,previousSpeed,maxJolt=0;
  p.ingest(latest,0,epoch);
  try{
    for(let frame=1;frame<=Math.floor(hz*1.3);frame++){
      const t=frame*1000/hz;f.advance(1/hz,drive);
      if(t>=nextPacket-1e-6){
        latest=f.snapshot((f.physics.stats().tick-startTick)*C.fixedDt*1000);
        p.ingest(latest,t,epoch+t);p.frame(latest,drive,0,t,epoch+t);nextPacket+=50;
      }
      const draw=p.frame(latest,drive,1/hz,t,epoch+t).renderPose.position;
      if(previous&&t>650){const speed=(draw.z-previous.z)*hz;if(previousSpeed!==undefined)maxJolt=Math.max(maxJolt,Math.abs(speed-previousSpeed));previousSpeed=speed;}
      previous=draw;
    }
    assert(p.stats().maxErrorM<.01,`${hz}Hz: agreeing physical checkpoints do not invent correction offsets`);
    assert(maxJolt<.65,`${hz}Hz: packet receipt does not hold/double a draw step: ${maxJolt}`);
    assert.equal(p.stats().snaps,0);
    console.log(JSON.stringify({raisedPeriodicHz:hz,maxJolt,maxCorrectionM:p.stats().maxErrorM}));
  }finally{f.dispose();}
}
console.log('PASS raised prediction: periodic checkpoints, late packets, time history, slow frames, visual correction and reset safety');
