// Rule-level fixtures plus actual Rapier cover queries. Not native gameplay.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import battle from '../games/engines/kart-rules-battle.js';
import physicsModule from '../games/engines/kart-physics.js';
import POCKET from '../games/pocket-karts/server.js';
await RAPIER.init();
let checks=0;
const check=(ok,message)=>{assert.ok(ok,message);checks++;};
function kart(pid, position, rotation={x:0,y:0,z:0,w:1}) {
  return {pid,x:position.x,z:position.z,angle:0,speed:0,input:{boost:false},
    ...battle.blankKart(),shield:0,physicalPose:{position,rotation}};
}
function state(karts) {
  return {karts,scores:Object.fromEntries(karts.map(k=>[k.pid,0])),bound:100,blocks:[],crates:[],zaps:[],zapSeq:0,events:[],eventSeq:0,
    mines:[],mineSeq:0,grenades:[],grenadeSeq:0,scatterHits:new Map(),targetHits:99};
}
function tick(s,dt,physics,before=new Map(s.karts.map(k=>[k.pid,structuredClone(k)]))) {
  return battle.tick(s,new Set(s.karts.map(k=>k.pid)),dt,before,null,new Map(),
    {sweepStatic:(from,to,radius)=>physics.sweepStatic(from,to,radius)});
}
function arm(s,kind='pulse',ammo=1) {const k=s.karts[0];k.weapon=kind;k.ammo=ammo;k.pendingFire=true;}
for (const euler of [[0,0,0],[.3,Math.PI*2+.7,-.2],[-.4,-Math.PI*2-.7,.25]]) {
  const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(...euler));
  const p={x:4,y:5,z:-3},s=state([kart('a',p,{x:q.x,y:q.y,z:q.z,w:q.w})]);
  const physics=physicsModule.createKartPhysics(RAPIER,CONFIG);
  try {
    arm(s);tick(s,0,physics);
    const expected=new THREE.Vector3(...Object.values(CONFIG.combat.pulseMuzzle)).applyQuaternion(q).add(new THREE.Vector3(p.x,p.y,p.z));
    const shot=s.zaps[0];check(!!shot,'Unobstructed authority spend creates shot');
    check(new THREE.Vector3(shot.x,shot.y,shot.z).distanceTo(expected)<1e-8,'Shared authored muzzle follows full chassis quaternion');
    const forward=new THREE.Vector3(0,0,1).applyQuaternion(q);
    check(new THREE.Vector3(shot.vx,shot.vy,shot.vz).normalize().distanceTo(forward)<1e-8,'Direction follows pitched and rolled barrel');
    check(Math.abs(Math.hypot(shot.vx,shot.vy,shot.vz)-battle.constants.PULSE_SPEED)<1e-8,'Authority speed unchanged');
    const fire=s.events.find(e=>e.type==='fire');check(Math.abs(fire.position.y-shot.y)<1e-8&&Number.isFinite(fire.direction.y),'Public accepted fire has real xyz and direction');
  } finally {physics.dispose();}
}
{
  const s=state([kart('a',{x:0,y:.7,z:0})]),physics=physicsModule.createKartPhysics(RAPIER,CONFIG);
  try {
    physics.addStatic({id:'barrel-cover',shape:'box',position:{x:.95,y:1.2,z:1},half:{x:.2,y:.3,z:.1}});
    arm(s,'pulse',3);tick(s,0,physics);
    check(s.zaps.length===0&&s.events.length===0,'Obstructed chassis-to-muzzle path never emits shot or fire');
    check(s.karts[0].ammo===3&&s.karts[0].fireCd===0,'Blocked barrel keeps ammo and cooldown');
  } finally {physics.dispose();}
}
// Centreline clears this cover; the authored bullet envelope does not.
{
  const s=state([kart('a',{x:0,y:.7,z:0})]),physics=physicsModule.createKartPhysics(RAPIER,CONFIG);
  try {
    physics.addStatic({id:'grazing-barrel-cover',shape:'box',position:{x:1.16,y:1.2,z:1},half:{x:.05,y:.3,z:.1}});
    const from={x:.95,y:1.2,z:0},to={x:.95,y:1.2,z:1.9};
    check(physics.sweepStatic(from,to)===null,'Old barrel centreline accepts near-cover path');
    check(!!physics.sweepStatic(from,to,battle.viewExtra(s).combat.staticSweepRadii.pulse),'Actual bullet sphere detects near-cover barrel path');
    arm(s,'pulse',3);tick(s,0,physics);
    check(s.zaps.length===0&&s.events.length===0&&s.karts[0].ammo===3&&s.karts[0].fireCd===0,'Sphere-blocked mounted fire keeps ammo/cooldown and emits no shot');
  } finally {physics.dispose();}
}
for (const moving of [false,true]) {
  const shooter=kart('a',{x:0,y:.7,z:0}),target=kart('b',{x:moving?3:.95,y:.85,z:7});
  const s=state([shooter,target]),physics=physicsModule.createKartPhysics(RAPIER,CONFIG);
  try {
    arm(s);tick(s,0,physics);
    const before=new Map(s.karts.map(k=>[k.pid,structuredClone(k)]));
    if(moving){target.x=-1;target.physicalPose.position={x:-1,y:.85,z:7};}
    tick(s,.1,physics,before);
    check(target.health<100,'Full segment sweep hits '+(moving?'moving':'stationary')+' vulnerable hull');
    check(s.zaps.length===0&&s.events.filter(e=>e.type==='impact').length===1,'Hit retires one projectile and emits one impact');
    const health=target.health;tick(s,.1,physics);check(target.health===health,'Retired projectile never awards damage twice');
  } finally {physics.dispose();}
}
{
  const s=state([kart('a',{x:0,y:.7,z:0}),kart('b',{x:.95,y:.85,z:7})]);
  const physics=physicsModule.createKartPhysics(RAPIER,CONFIG);
  try {
    physics.addStatic({id:'cover',shape:'box',position:{x:0,y:2,z:4},half:{x:5,y:2,z:.2}});
    arm(s);tick(s,0,physics);tick(s,.1,physics);
    check(s.karts[1].health===100&&s.zaps.length===0,'Real static cover consumes shot before hull');
    const impact=s.events.find(e=>e.type==='impact');
    check(impact&&Math.abs(impact.position.z-(3.8-battle.viewExtra(s).combat.staticSweepRadii.pulse))<1e-5&&impact.position.y>1,'Impact xyz records accepted sphere centre before actual cover surface');
    const projected=battle.viewExtra(s);
    check(projected.zaps.length===0,'Consumed shot cannot remain in public projection');
  } finally {physics.dispose();}
}
for (const covered of [false,true]) {
  const s=state([kart('a',{x:0,y:3,z:0}),kart('b',{x:-.95,y:3.15,z:7})]);
  const physics=physicsModule.createKartPhysics(RAPIER,CONFIG);
  try {
    if(covered)physics.addStatic({id:'rocket-cover',shape:'box',position:{x:0,y:4,z:4},half:{x:5,y:2,z:.2}});
    arm(s,'rocket');tick(s,0,physics);tick(s,.2,physics);
    const impact=s.events.find(e=>e.type==='impact'),blasts=s.events.filter(e=>e.type==='blast');
    check(s.zaps.length===0&&!!impact,'Rocket retires at actual '+(covered?'cover':'hull')+' contact');
    check(blasts.length===1&&Math.abs(blasts[0].position.y-impact.position.y)<1e-8,'One explosion preserves actual airborne contact height');
    check(Math.abs(blasts[0].position.z-impact.position.z)<1e-8,'Explosion cannot extend past accepted contact');
    const count=s.events.length;tick(s,.2,physics);check(s.events.length===count,'Retired rocket never replays impact or blast');
  } finally {physics.dispose();}
}
for(const tire of [false,true]){
  const s=state([kart('a',{x:0,y:.7,z:0}),kart('front',{x:-3.2,y:.7,z:3.4}),kart('behind',{x:-3.2,y:.7,z:4.4}),kart('above',{x:-3.2,y:5,z:3.4})]);
  const physics=physicsModule.createKartPhysics(RAPIER,CONFIG);
  try{
    physics.addStatic({id:'wall',shape:'box',position:{x:0,y:.75,z:4},half:{x:5,y:.75,z:.2}});
    if(tire)physics.addStatic({id:'tire-style-prop',shape:'box',position:{x:-2.1,y:.75,z:3.6},half:{x:.4,y:.75,z:.3}});
    arm(s,'rocket');tick(s,0,physics);tick(s,.2,physics);
    check(s.karts[1].health===(tire?100:60),'Physical splash '+(tire?'is blocked by real prop collider':'damages visible same-side target by40'));
    check(s.karts[2].health===100,'Impact-face nudge never leaks splash through wall');
    check(s.karts[3].health===100,'Planar-near target at another elevation is outside 3D splash radius');
    check(s.events.filter(e=>e.type==='blast').length===1,'Cover-vetoed splash still emits one explosion');
  }finally{physics.dispose();}
}
// Initialized shipping Pocket path: controlled UNIT KO/zap setup with real
// motion world. A fresh life must never sweep its corpse-to-spawn teleport.
{
 await POCKET.initialize();let now=1000000;
 const players=[{id:'ra',name:'A'},{id:'rb',name:'B'}],ctx={instanceId:'respawn-integration-unit',now:()=>now,
   settings:()=>({mode:'Zap Battle',map:'Garden Circuit',roundSeconds:60,winRule:'Time limit',garage:false}),
   players:()=>players,allPlayers:()=>players,broadcast(){},award(){},later:()=>()=>{}};
 const s=POCKET.create(ctx);
 try {
  now+=3000;POCKET.onTick(s,ctx);now+=100;POCKET.onTick(s,ctx);
  const [a,b]=s.karts,corpse=structuredClone(b.physicalPose),oldLife=b.spawnSeq,
   spawn=s.spawns.slice().sort((p,q)=>Math.hypot(q.x-a.x,q.z-a.z)-Math.hypot(p.x-a.x,p.z-a.z))[0],
   dx=corpse.position.x-spawn.x,dz=corpse.position.z-spawn.z,len=Math.hypot(dx,dz),perp={x:-dz/len,z:dx/len},
   mid={x:(spawn.x+corpse.position.x)/2,y:(1.05+corpse.position.y+.35)/2,z:(spawn.z+corpse.position.z)/2};
  b.health=0;b.respawn=.05;b.weapon=null;b.ammo=0;b.shield=0;
  s.zaps=[{id:'declared-inflight',owner:a.pid,kind:'pulse',physical:true,
   x:mid.x-perp.x*5.5,y:mid.y,z:mid.z-perp.z*5.5,vx:perp.x*110,vy:0,vz:perp.z*110,ttl:1,angle:Math.atan2(perp.x,perp.z)}];
  s.crates=[];s.events=[];const before=POCKET.view(s,'ra'),beforeBytes=JSON.stringify(before);
  now+=100;POCKET.onTick(s,ctx);const after=POCKET.view(s,'ra'),fresh=after.karts.find(k=>k.pid==='rb');
  check(after.zaps.length===1,'Projectile away from corpse and fresh spawn survives the respawn tick');
  check(!after.events.some(e=>e.type==='impact'&&e.other==='rb'),'No phantom impact along corpse-to-spawn teleport');
  check(after.events.filter(e=>e.type==='respawn'&&e.pid==='rb').length===1,'Fresh life emits one respawn event');
  check(fresh.health===100&&fresh.shield>0&&fresh.spawnSeq===oldLife+1,'Fresh life restores full protected health');
  check(fresh.physicalPose.epoch>corpse.epoch&&fresh.physicalPose.position.x===spawn.x&&fresh.physicalPose.position.z===spawn.z,'Actual Rapier reset projects the fresh pose before collision sweeps');
  check(JSON.stringify(before)===beforeBytes,'Fresh reset does not mutate prior public pose projection');
  const ack=POCKET.view(s,'rb').inputAck;
  POCKET.onAction(s,ctx,'rb',{seq:1,life:oldLife,controlEpoch:ack.controlEpoch,input:{steer:0,throttle:1,boost:true}});
  check(b.input.throttle===0&&!b.pendingFire,'Dead-life intent cannot act on the fresh collider');
  POCKET.onAction(s,ctx,'rb',{seq:1,life:ack.life,controlEpoch:ack.controlEpoch,input:{steer:0,throttle:1,boost:false}});
  check(b.input.throttle===1,'Current-life ordinary intent remains usable after reset');
 } finally {POCKET.dispose(s);}
}
// Physical-only committed Pulse contract, using initialized shipping Pocket and
// current seq/life/controlEpoch inputs. Controlled rule inventory/KO fixtures;
// poses remain owned by the actual Rapier world, not planar mutations.
await POCKET.initialize();
function heldFixture() {
 let now=2000000,seq=0,connected=null;
 const players=[{id:'hold-a',name:'A'},{id:'hold-b',name:'B'}];
 const ctx={instanceId:'pulse-hold-physical-unit',now:()=>now,
  settings:()=>({mode:'Zap Battle',map:'Rookie Ring',roundSeconds:60,winRule:'Time limit',garage:false}),
  players:()=>connected||players,allPlayers:()=>players,broadcast(){},award(){},later:()=>()=>{}};
 const s=POCKET.create(ctx);now+=3000;POCKET.onTick(s,ctx);
 const a=s.karts[0];s.crates=[];a.weapon='pulse';a.ammo=12;a.shield=0;a.fireCd=0;a.prevAction=false;
 return {s,ctx,a,tick(ms){now+=ms;POCKET.onTick(s,ctx);},
  press(boost){const ack=POCKET.view(s,a.pid).inputAck;POCKET.onAction(s,ctx,a.pid,{seq:++seq,life:ack.life,controlEpoch:ack.controlEpoch,input:{steer:0,throttle:0,boost}});},
  disconnect(){connected=[players[1]];POCKET.onConnection(s,ctx,a.pid,false);},
  reconnect(){connected=null;POCKET.onConnection(s,ctx,a.pid,true);},
  done(){now=s.endsAt;POCKET.onTick(s,ctx);}};
}
for(const pump of [50,100]) {
 const f=heldFixture(),{s,a}=f;
 try {
  f.press(true);f.press(false); // accepted receipt edge survives a short tap
  const fired=new Map();let lastAmmo=a.ammo;
  for(let i=0;i<Math.ceil(2000/pump);i++) {
   if(i===2||i>2&&i*pump%500===0)f.press(true); // extra presses/holds cannot add a payload
   f.tick(pump);check(lastAmmo-a.ammo<=1,'committed Pulse never catches up a batch in one observed tick');lastAmmo=a.ammo;
   for(const e of s.events)if(e.type==='fire'&&!fired.has(e.id))fired.set(e.id,{...e,at:f.ctx.now()});
  }
  check(fired.size===12,'one short Pulse press fires the whole twelve-round clip at'+pump+'ms');
  check(a.ammo===0&&a.weapon===null&&!POCKET.view(s,a.pid).karts.find(k=>k.pid===a.pid).firing,'empty clip finishes the payload');
  const times=[...fired.values()].map(e=>e.at),window=times.at(-1)-times[0];
  check(Math.abs(window-11*120)<=pump,'quantized .12 cadence remains within one pump');
  s.rngState=7;s.crates=[{id:'held-crate',x:a.x,z:a.z}];f.tick(pump);s.crates=[];
  check(a.weapon==='pulse','actual seeded pickup supplies another Pulse');const ammo=a.ammo;
  for(let i=0;i<8;i++)f.tick(pump);
  check(a.ammo===ammo,'held-through-pickup cannot auto-spend new slot');
  f.press(false);f.tick(pump);f.press(true);f.tick(pump);
  check(a.ammo===ammo-1&&POCKET.view(s,a.pid).karts.find(k=>k.pid===a.pid).firing,'new pickup needs a new accepted press');
 }finally{POCKET.dispose(s);}
}
{
 const f=heldFixture(),{s,a}=f;try{
  f.press(true);for(let i=0;i<36;i++)f.tick(50);
  check(a.weapon===null&&a.input.boost===false,'completed held clip crosses movement TTL');
  s.rngState=7;s.crates=[{id:'ttl-held-crate',x:a.x,z:a.z}];f.tick(50);s.crates=[];
  check(a.weapon==='pulse'&&a.ammo===12,'new actual pickup remains after held clip and TTL');
  f.press(true);f.tick(50);
  check(a.ammo===12&&!POCKET.view(s,a.pid).karts.find(k=>k.pid===a.pid).firing,'resumed held keepalive after TTL cannot impersonate a new Fire press');
  f.press(false);f.press(true);f.tick(50);
  check(a.ammo===11&&POCKET.view(s,a.pid).karts.find(k=>k.pid===a.pid).firing,'explicit release then fresh press still activates after TTL');
 }finally{POCKET.dispose(s);}
}
for(const stop of ['release','ttl','disconnect','ko','life','epoch','done','dispose']) {
 const f=heldFixture(),{s,a}=f;
 try {
  f.press(true);f.tick(50);check(a.ammo===11&&POCKET.view(s,a.pid).karts.find(k=>k.pid===a.pid).firing,'fresh legal press commits physical payload');
  if(stop==='release')f.press(false);
  if(stop==='ttl')f.tick(1600);
  if(stop==='disconnect')f.disconnect();
  if(stop==='ko') {const p=a.physicalPose.position;a.health=10;
   s.zaps=[{id:'stop-hit',owner:'hold-b',kind:'rail',physical:true,x:p.x,y:p.y+.35,z:p.z-3,vx:0,vy:0,vz:110,angle:0,ttl:1}];f.tick(50);
   check(a.health===0,'actual physical projectile KOs held shooter');}
  if(stop==='done')f.done();
  if(stop==='life'){battle.respawnKart(s,a);f.tick(50);}
  if(stop==='epoch'){a.controlEpoch++;f.tick(50);}
  if(stop==='dispose')POCKET.dispose(s);
  if(stop==='release'||stop==='ttl'){
   check(POCKET.view(s,a.pid).karts.find(k=>k.pid===a.pid).firing,stop+' keeps an already committed payload');
   for(let i=0;i<40;i++)f.tick(50);
   check(a.ammo===0&&a.weapon===null,stop+' completes the committed clip without another press');
   continue;
  }
  check(!POCKET.view(s,a.pid).karts.find(k=>k.pid===a.pid).firing&&a.ammo===0&&a.weapon===null,stop+' discards committed remainder');
  if(stop==='dispose')continue;
  const emissions=s.zapSeq;
  for(let i=0;i<5;i++)f.tick(50);
  check(s.zapSeq===emissions,stop+' cannot replay queued shots');
  if(stop==='disconnect') {
   f.reconnect();f.tick(50);f.press(true);f.tick(50);
   check(a.ammo===0&&a.weapon===null&&s.zapSeq===emissions,'reconnect/fresh press cannot reuse consumed remainder');
  }
 }finally{POCKET.dispose(s);}
}
console.log(JSON.stringify({pass:true,checks,scope:'Maintained rule fixtures + actual initialized Rapier Pocket; no native claim'}));
