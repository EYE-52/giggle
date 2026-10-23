// Full-pose rendering/input contracts, including poses from the exact internal
// Rapier authority. This does not claim client prediction or network latency.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import COMBAT from '../games/engines/kart-elevated-combat.js';
import PHYSICS from '../games/engines/kart-physics.js';
import ENGINE from '../games/engines/kart-engine.js';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {blendElevatedPose,nextElevatedInput,createElevatedTimeline} from '../public/js/engines/kart-elevated-pose.mjs';
// Verify retention through GC without adding a production diagnostics API.
if(process.argv.includes('--timeline-memory-check')){
  const retained=createElevatedTimeline(),references=[];
  for(let i=0;i<1024;i++){
    const snapshot={instanceId:'memory',simAt:i*50,karts:[]};references.push(new WeakRef(snapshot));retained.ingest(snapshot,1000+i*50);
  }
  for(let i=0;i<3;i++){await new Promise(setImmediate);global.gc();}
  const count=references.filter(reference=>reference.deref()).length;
  assert.ok(count>0&&count<=16,`timeline retains ${count} snapshots, expected 1..16`);
  assert.equal(retained.frame(1000+1023*50).current.snapshot.instanceId,'memory');
  console.log(JSON.stringify({retainedSnapshots:count,totalIngested:references.length}));process.exit(0);
}
await RAPIER.init();
const checks=[],check=(name,value)=>{assert.ok(value,name);checks.push(name);};
const near=(a,b)=>Math.abs(a-b)<1e-6;
const norm=q=>Math.hypot(q.x,q.y,q.z,q.w);
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w;
const point=(id,x,z)=>({id,surface:'floor',x,y:0,z,angle:0});
const map={id:'pose-test',revision:'pose-test-1',half:60,colliders:[
  {id:'floor',shape:'box',half:{x:60,y:1,z:60},position:{x:0,y:-1,z:0}},
  {id:'jump',shape:'wedge',half:{x:4,y:1.5,z:6},position:{x:18,y:1.5,z:0}},
],spawns:[point('a',18,-20),point('b',-12,-22)],sockets:[point('c0',-20,-20),point('c1',-20,20)]};
const world=COMBAT.createElevatedCombat(RAPIER,CONFIG,map,[{id:'a'},{id:'b'}],{instance:'pose-contract',seed:1,startAt:0,countdownMs:0,roundMs:20000,crates:1});
const own=()=>{const value=world.snapshot('a');return {...value,you:'a',youDrive:true,instanceId:value.instance,inputAck:value.you};};
const kart=()=>world.snapshot().karts[0];
const receive=(frame)=>{const {type,...intent}=frame;assert.equal(type,'input');return world.input('a',{...intent,instance:world.snapshot().instance},world.snapshot().serverAt);};
let sequence=0,ascent=null,flight=null,landing=null;
try {
  const initial=own();
  const first=nextElevatedInput(initial,sequence,{steer:0,throttle:1,brake:0,nitro:false,use:false});
  check('first intent carries exact authority life/control epoch and next ACK sequence',first.seq===1&&first.life===initial.inputAck.life&&first.controlEpoch===initial.inputAck.controlEpoch&&receive(first).ok);
  sequence=first.seq;
  check('receiving input ACK does not claim it has already been applied',own().inputAck.receivedSeq===1&&own().inputAck.appliedInputSeq===0);
  for(let tick=0;tick<360&&!landing;tick++) {
    if(tick%6===0){const frame=nextElevatedInput(own(),sequence,{steer:tick<50?0.08:0,throttle:1,brake:0,nitro:false,use:false});sequence=frame.seq;assert.ok(receive(frame).ok);}
    const previous=kart();world.advance(world.snapshot().serverAt+1000/60);const current=kart();
    if(!ascent&&previous.pose.position.y>1.1&&current.pose.grounded&&Math.abs(current.pose.rotation.x)>0.04)ascent={previous,current};
    if(!flight&&previous.pose.position.z>7&&current.pose.position.z>7&&!previous.pose.grounded&&!current.pose.grounded)flight={previous,current};
    if(flight&&current.pose.position.z>14&&current.pose.grounded&&current.pose.position.y<1)landing=current;
  }
  check('actual authority produces rising full-pose ramp samples',!!ascent&&ascent.current.pose.position.y>ascent.previous.pose.position.y&&ascent.current.pose.position.z>ascent.previous.pose.position.z);
  check('actual authority produces unsupported 3D flight then physical landing',!!flight&&!!landing&&flight.current.pose.position.y>3&&landing.pose.grounded);
  const source=JSON.stringify(ascent),mid=blendElevatedPose(ascent.previous,ascent.current,0.5);
  check('interpolation blends all xyz coordinates from physical ramp poses',Object.keys(mid.position).length===3&&['x','y','z'].every(k=>near(mid.position[k],(ascent.previous.pose.position[k]+ascent.current.pose.position[k])/2)));
  check('interpolation retains finite physical velocity and grounding fields',Object.values(mid.linearVelocity).every(Number.isFinite)&&Object.values(mid.angularVelocity).every(Number.isFinite)&&mid.grounded===ascent.current.pose.grounded);
  check('interpolation normalizes physical full-body rotation',near(norm(mid.rotation),1)&&Math.abs(mid.rotation.x)>0.04);
  check('interpolation never mutates previous/current authority samples',JSON.stringify(ascent)===source);
  check('negative alpha clamps to physical previous position',JSON.stringify(blendElevatedPose(ascent.previous,ascent.current,-1).position)===JSON.stringify(ascent.previous.pose.position));
  check('alpha beyond one clamps to physical current position',JSON.stringify(blendElevatedPose(ascent.previous,ascent.current,2).position)===JSON.stringify(ascent.current.pose.position));
  const airborne=blendElevatedPose(flight.previous,flight.current,0.5);
  check('airborne interpolation preserves real height rather than ground-plane projection',airborne.position.y>3&&!airborne.grounded&&near(airborne.position.y,(flight.previous.pose.position.y+flight.current.pose.position.y)/2));
  check('first snapshot is rendered directly without invented movement',blendElevatedPose(null,ascent.current,0.5)===ascent.current.pose);
  const otherLife={...ascent.current,spawnSeq:ascent.current.spawnSeq+1};
  check('same-instance respawn/recovery life snaps without blending through terrain',blendElevatedPose(ascent.previous,otherLife,0.1)===otherLife.pose);
  const otherEpoch={...ascent.current,controlEpoch:ascent.current.controlEpoch+1};
  check('same-instance input epoch changes snap instead of replaying prior motion',blendElevatedPose(ascent.previous,otherEpoch,0.1)===otherEpoch.pose);
  const dead={...ascent.current,alive:false};
  check('a newly KOed hull is not interpolated into a live intermediate state',blendElevatedPose(ascent.previous,dead,0.5)===dead.pose);
  check('a revived hull is not blended from its dead pose',blendElevatedPose({...ascent.previous,alive:false},ascent.current,0.5)===ascent.current.pose);
  const offline={...ascent.current,connected:false};
  check('disconnected hull freezes at its accepted pose',blendElevatedPose(ascent.previous,offline,.2)===offline.pose);
  const sameRotation=structuredClone(ascent.current);sameRotation.pose.rotation=Object.fromEntries(Object.entries(ascent.previous.pose.rotation).map(([k,v])=>[k,-v]));
  check('equivalent quaternion signs never collapse or rotate the kart',Math.abs(dot(blendElevatedPose(ascent.previous,sameRotation,0.5).rotation,ascent.previous.pose.rotation))>0.999999);
  const yaw=degrees=>({x:0,y:Math.sin(degrees*Math.PI/360),z:0,w:Math.cos(degrees*Math.PI/360)});
  const left={...ascent.previous,pose:{...ascent.previous.pose,rotation:yaw(179)}},right={...ascent.current,pose:{...ascent.current.pose,rotation:yaw(-179)}};
  const around=blendElevatedPose(left,right,0.5).rotation;
  check('179 to minus179 uses the short arc across180 rather than yaw zero',near(norm(around),1)&&Math.abs(around.y)>0.999999&&Math.abs(around.w)<1e-6);
  const clamped=nextElevatedInput(own(),sequence,{steer:2,throttle:-2,brake:4,nitro:1,use:0});
  check('wire intent clamps analog axes/brake and uses boolean action fields',clamped.steer===1&&clamped.throttle===-1&&clamped.brake===1&&clamped.nitro===true&&clamped.use===false);
  check('wire intent contains no client position rotation clocks or score',JSON.stringify(Object.keys(clamped).sort())===JSON.stringify(['type','seq','life','controlEpoch','steer','throttle','brake','nitro','use'].sort()));
  check('local sequence ahead of delayed ACK remains monotonic',nextElevatedInput(own(),sequence+10,{steer:0,throttle:0,brake:0}).seq===sequence+11);
  check('authoritative received ACK advances a reset local sequence',nextElevatedInput(own(),0,{steer:0,throttle:0,brake:0}).seq===own().inputAck.receivedSeq+1);
  check('watchers and missing private ACK cannot emit input',nextElevatedInput({...own(),youDrive:false},0,{})===null&&nextElevatedInput({...own(),inputAck:null},0,{})===null);
  check('done/reveal phases cannot emit drive input',nextElevatedInput({...own(),phase:'done'},sequence,{})===null&&nextElevatedInput({...own(),phase:'reveal'},sequence,{})===null);
  const stale=nextElevatedInput(own(),sequence,{steer:0,throttle:1,brake:0,nitro:false,use:false});
  world.setConnected('a',false);world.setConnected('a',true);
  check('actual authority rejects an intent from the previous connection epoch',!receive(stale).ok);
  const fresh=nextElevatedInput(own(),sequence,{steer:0,throttle:0,brake:0,nitro:false,use:false});
  check('next intent adopts the actual reconnect epoch and is accepted',fresh.controlEpoch===own().inputAck.controlEpoch&&fresh.controlEpoch>stale.controlEpoch&&receive(fresh).ok);
  world.advance(world.snapshot().serverAt+1000/60);
  check('fixed-step application ACK catches the accepted reconnect intent',own().inputAck.appliedInputSeq===fresh.seq);
} finally {world.dispose();}
// 20Hz packets with alternating delay and duplicate ACK updates. Playback
// must keep real simulation speed instead of restarting on receipt.
const timeline=createElevatedTimeline(),poseAt=at=>({instanceId:'timing',simAt:at,karts:[{id:'a',alive:true,spawnSeq:1,controlEpoch:1,pose:{position:{x:0,y:1,z:at*.014},rotation:{x:0,y:0,z:0,w:1},speed:14,wheels:[{length:.2+at*.0001,rotation:at*.04,steering:at*.0002}]}}]});
let latest=0,lastZ=-Infinity,maxStep=0;
for(let t=1000;t<=2000;t+=10){
  const at=Math.floor((t-1000)/50)*50,delay=(at/50)%2?20:0;
  if(at>latest&&t>=1000+at+delay){latest=at;timeline.ingest(poseAt(at),t);}
  if(t===1000)timeline.ingest(poseAt(0),t);
  if(t%30===0)timeline.ingest(poseAt(latest),t); // repeated same-tick packet
  const f=timeline.frame(t),kart=f.current.karts.get('a'),p=blendElevatedPose(f.previous.karts.get('a'),kart,f.alpha);
  check('jittered packet frame '+t+' never rewinds',p.position.z>=lastZ);
  if(lastZ!==-Infinity)maxStep=Math.max(maxStep,p.position.z-lastZ);lastZ=p.position.z;
  if(t>=1100)check('jittered frame '+t+' keeps simulation-time speed',near(p.position.z,(t-1075)*.014));
}
check('jittered/duplicate packet playout never exceeds normal frame distance',maxStep<=.140001);
const before=timeline.frame(2000);timeline.ingest(poseAt(400),2010);check('older snapshot cannot rewind buffered simulation',timeline.frame(2000).at===before.at);
const w=blendElevatedPose(poseAt(0).karts[0],poseAt(100).karts[0],.5).wheels[0];
check('suspension steering and accumulated wheel spin blend together',near(w.length,.205)&&near(w.rotation,2)&&near(w.steering,.01));
const output={position:{},rotation:{}},pa=poseAt(0).karts[0],pb=poseAt(100).karts[0],source=JSON.stringify([pa,pb]);
blendElevatedPose(pa,pb,.2,output);const wheelOutput=output.wheels[0],wheelArray=output.wheels,positionOutput=output.position;
check('frame interpolation reuses pose and wheel storage without reallocating',blendElevatedPose(pa,pb,.8,output)===output&&output.wheels===wheelArray&&output.wheels[0]===wheelOutput&&output.position===positionOutput);
check('reused render output cannot mutate authoritative wheel records',JSON.stringify([pa,pb])===source&&output.wheels[0]!==pb.pose.wheels[0]);
const frozen=timeline.frame(9000);check('packet loss freezes at last accepted pose without unbounded lead',frozen.at===latest);
timeline.ingest({...poseAt(0),instanceId:'new'},9100);check('new match resets clock and old history',timeline.frame(9100).current.snapshot.instanceId==='new'&&timeline.frame(9100).current.snapshot.simAt===0);
// Ordered TCP delivery can contain a burst even though all simAt values are
// increasing. The previous fixed clock jumped 150ms / 5.4m in this exact case.
const straight=at=>({instanceId:'burst',simAt:at,karts:[{id:'a',alive:true,connected:true,spawnSeq:1,controlEpoch:1,pose:{position:{x:0,y:1,z:at*.036},rotation:{x:0,y:0,z:0,w:1},speed:36,wheels:[]}}]});
function playback(packets,fps,probe){
  const playback=createElevatedTimeline(),frameMs=1000/fps;
  let index=0,last=null,lastAt=-Infinity,maxStep=0,maxClockStep=0,rewinds=0,penetrations=0,frames=0;
  for(let time=1000;time<=packets.at(-1).arrival+750;time+=frameMs){
    while(index<packets.length&&packets[index].arrival<=time+1e-7){playback.ingest(packets[index].snapshot,time);index++;}
    const frame=playback.frame(time);if(!frame)continue;
    const pose=blendElevatedPose(frame.previous.karts.get('a'),frame.current.karts.get('a'),frame.alpha),position=pose.position;
    if(last){maxStep=Math.max(maxStep,Math.hypot(position.x-last.x,position.y-last.y,position.z-last.z));maxClockStep=Math.max(maxClockStep,frame.at-lastAt);if(frame.at<lastAt-1e-7)rewinds++;}
    if(probe?.(pose))penetrations++;
    last={...position};lastAt=frame.at;frames++;
  }
  return {fps,maxStep,maxClockStep,rewinds,penetrations,frames,finalAt:lastAt};
}
const timelineMeasurements={exactBurst:[],authored:[]};
const exactPackets=[0,50,100,150,200,250].map((at,i)=>({snapshot:straight(at),arrival:[1000,1050,1280,1410,1410,1410][i]}));
for(const fps of [60,30]){
  const result=playback(exactPackets,fps);timelineMeasurements.exactBurst.push(result);
  check(fps+'fps ordered180/260ms late burst has no former5.4m catch-up jump (measured '+result.maxStep+'m)',result.maxStep<=36*1.1/fps+1e-6);
  check(fps+'fps burst playout is monotonic and bounded by frame time',result.rewinds===0&&result.maxClockStep<=1000*1.1/fps+1e-6&&result.finalAt===250);
}
// The active bracket must survive a backlog; blindly retaining the latest
// eight samples renders the first future point even with a bounded clock.
{
  const backlog=createElevatedTimeline();backlog.ingest(straight(0),1000);backlog.frame(1075);
  for(let at=50;at<=700;at+=50)backlog.ingest(straight(at),1080);
  const frame=backlog.frame(1090),pose=blendElevatedPose(frame.previous.karts.get('a'),frame.current.karts.get('a'),frame.alpha);
  check('future backlog retains the active bracket rather than jumping to its oldest survivor',frame.previous.snapshot.simAt===0&&pose.position.z<=.594001);
}
{
  const guard=createElevatedTimeline();guard.ingest(straight(0),1000);guard.ingest(straight(50),1050);guard.frame(1100);
  const before=guard.frame(1110).at,duplicate=straight(50);duplicate.karts[0].pose.position.z=999;
  guard.ingest(duplicate,1110);guard.ingest(straight(0),1120);
  check('same-tick duplicates and stale snapshots cannot change the accepted pose',guard.frame(1110).at===before&&near(guard.frame(1110).current.karts.get('a').pose.position.z,1.8));
  check('render clock calls from the past cannot rewind playback',guard.frame(1090).at===before);
  for(let time=1120;time<=2500;time+=10)guard.frame(time);
  const held=guard.frame(2510);
  check('lost packets freeze at the last confirmed sample without velocity extrapolation',held.at===50&&near(held.current.karts.get('a').pose.position.z,1.8));
  guard.ingest(straight(2000),3000);const resync=guard.frame(3000);
  check('more than one second of missing simulation history adopts a fresh baseline without a fabricated segment',resync.previous===resync.current&&resync.current.snapshot.simAt===2000&&blendElevatedPose(resync.previous.karts.get('a'),resync.current.karts.get('a'),resync.alpha).position.z===72);
  for(const [label,changes]of [['respawn',{spawnSeq:2}],['control epoch',{controlEpoch:2}],['connection',{connected:false}]]){
    guard.reset();check(label+' reset clears retained history',guard.frame(3100)===null);
    const fresh=straight(2100);Object.assign(fresh.karts[0],changes);guard.ingest(fresh,3100);const f=guard.frame(3100);
    check(label+' reset renders its exact fresh confirmed pose',f.previous===f.current&&blendElevatedPose(null,f.current.karts.get('a'),f.alpha)===fresh.karts[0].pose);
  }
  const freshInstance={...straight(0),instanceId:'new-burst'};guard.ingest(freshInstance,3200);
  check('new instance replaces prior playback and jitter history',guard.frame(3200).current.snapshot===freshInstance);
}
{
  const capped=createElevatedTimeline(2000);capped.ingest(straight(0),1000);
  check('requested reserve cannot exceed the350ms bound',capped.frame(1000).at===-350);
  const overflow=createElevatedTimeline();overflow.ingest(straight(0),1000);overflow.frame(1075);
  for(let at=50;at<=800;at+=50)overflow.ingest(straight(at),1080);
  const f=overflow.frame(1090);
  check('exhausted retained history adopts a direct fresh baseline instead of fabricating a long path',f.previous===f.current&&f.current.snapshot.simAt===800);
}
const memory=spawnSync(process.execPath,['--expose-gc',fileURLToPath(import.meta.url),'--timeline-memory-check'],{encoding:'utf8',timeout:10000});
check('actual timeline retention remains bounded after1024 incoming snapshots',memory.status===0);
timelineMeasurements.memory=JSON.parse(memory.stdout);

// These are actual production colliders/config and the real Rapier adapter.
// Continuous diagnostic Nitro tuning isolates playback at speed; it does not
// claim natural Nitro recharge/pickups or a browser/network playthrough.
for(const [mapId,x,z,ramp]of [['garden',-48,-52,false],['harbor',-76,-72,false],['garden',16,-40,true]]){
  const authored=elevatedMap(mapId),physical=PHYSICS.createKartPhysics(RAPIER,CONFIG),snapshots=[];
  try{
    for(const collider of authored.colliders)physical.addStatic(collider);
    physical.addKart('a',{position:{x,y:1,z},rotation:{x:0,y:0,z:0,w:1}});
    for(let i=0;i<120;i++)physical.step();
    if(!ramp)physical.tuneKart('a',{top:ENGINE.constants.NITRO_SPEED,engine:ENGINE.constants.NITRO_PUNCH});physical.applyIntent('a',{throttle:1,steer:0,brake:0});
    for(let tick=0;tick<=480;tick++){
      if(tick%3===0)snapshots.push({instanceId:mapId+'-physical',simAt:tick*1000/60,karts:[{id:'a',spawnSeq:1,controlEpoch:1,alive:true,connected:true,pose:physical.pose('a')}]});
      if(tick<480)physical.step();
    }
    const peak=Math.max(...snapshots.map(s=>s.karts[0].pose.speed)),maxY=Math.max(...snapshots.map(s=>s.karts[0].pose.position.y));
    check(mapId+(ramp?' ramp':' lane')+' supplies real moving and wall-contact authority poses',peak>(ramp?20:30)&&snapshots.at(-1).karts[0].pose.position.z>authored.half-3);
    if(ramp)check('authored Alpine ramp/deck supplies supported height and physical flight',maxY>7&&snapshots.some(s=>s.karts[0].pose.wheels.some(w=>w.contact&&w.surfaceId==='courtyard'))&&snapshots.some(s=>!s.karts[0].pose.grounded&&s.karts[0].pose.position.y>3));
    const toleranceHull=Object.fromEntries(Object.entries(CONFIG.chassis.half).map(([axis,half])=>[axis,half-.02]));
    const penetration=pose=>physical.overlapsStatic(pose.position,pose.rotation,toleranceHull);
    check(mapId+' physical trace has no chassis-static penetration over2cm',snapshots.every(s=>!penetration(s.karts[0].pose)));
    for(const fps of [60,30]){
      let lastArrival=-Infinity;
      const packets=snapshots.map(snapshot=>{const at=snapshot.simAt,delay=at>=1000&&at<2500?(Math.round(at/50)%2?180:260):0;lastArrival=Math.max(lastArrival,1000+at+delay);return {snapshot,arrival:lastArrival};});
      const result=playback(packets,fps,penetration);timelineMeasurements.authored.push({mapId,ramp,peak,maxY,...result});
      check(fps+'fps '+mapId+(ramp?' ramp':' lane')+' delayed playback advances at a bounded simulation rate',result.rewinds===0&&result.maxClockStep<=1000*1.1/fps+1e-6&&result.finalAt===8000);
      check(fps+'fps '+mapId+(ramp?' ramp':' lane')+' burst has no physical hull catch-up jump',result.maxStep<peak*1.1/fps+.02);
      check(fps+'fps '+mapId+(ramp?' ramp':' lane')+' stays outside authored walls/ramps within2cm contact tolerance',result.penetrations===0);
    }
  }finally{physical.dispose();}
}
console.log(JSON.stringify({pass:true,checks:checks.length,results:checks,timelineMeasurements,scope:'Full-pose interpolation and sequenced intent, actual internal authority/Rapier ramp flight and reconnect; ordered delayed-packet clock, bounded retention and authored wall/ramp playback. No prediction/network/physical-phone claim.'},null,2));
