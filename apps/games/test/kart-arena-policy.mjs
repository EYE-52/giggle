import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {createKartCameraCollision} from '../public/js/engines/kart-camera-collision.mjs';
import {auditArenaEdge,arenaOrdinaryConnectivity} from '../public/js/engines/kart-arena-navigation.mjs';
import {createRaisedPickups} from '../public/js/engines/kart-raised-pickups.mjs';
import RAPIER from '@dimforge/rapier3d-compat';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import combat from '../games/engines/kart-elevated-combat.js';
import contract from '../games/engines/kart-combat-config.js';
import {arenaBoxCount,arenaFloorQuotas,selectArenaHomes,selectArenaVariant,validateArenaContract,createArenaRewardPolicy,arenaRespawnMs} from '../public/js/engines/kart-arena-policy.mjs';
assert.deepEqual([2,4,8,16,24,32].map(n=>arenaBoxCount(15000,n,72)),[48,48,48,48,48,48]);
assert.equal(arenaBoxCount(7795,8,40),36);assert.equal(arenaBoxCount(5404,8,32),28);
assert.equal(arenaBoxCount(1800,2,16),12);assert.equal(arenaBoxCount(2800,8,20),18);
assert.equal(arenaBoxCount(6300,16,44),39);assert.equal(arenaBoxCount(9600,24,48),43);
assert.deepEqual(['safe','exposed','risk'].map(arenaRespawnMs),[2000,3000,4000]);
for(const seats of [2,8,16,32]){
 let i=0;const reward=createArenaRewardPolicy(contract.config.weapons,seats,()=>i++%2?.99:.999),cap=seats<=8?1:seats<=16?2:3;
 for(let n=0;n<cap;n++)assert.equal(contract.config.weapons[reward.roll('risk',8000)].tier,'rare');
 for(let n=0;n<100;n++)assert.notEqual(contract.config.weapons[reward.roll('risk',8001)].tier,'rare');
 assert.equal(contract.config.weapons[reward.roll('risk',20000)].tier,'rare');
 let a=0;const early=createArenaRewardPolicy(contract.config.weapons,seats,()=>a++%2?.1:.92);
 assert.equal(contract.config.weapons[early.roll('risk',7999)].tier,'uncommon');
 assert.equal(contract.config.weapons[early.roll('risk',8000)].tier,'rare');
}
await RAPIER.init();
// The legacy elevated map and launch policy both recycle away from an
// empty driver who spent a real pickup and stayed on its original home.
for(const id of ['rookie-ribbons','garden']){
 const map=id==='rookie-ribbons'?selectArenaVariant(elevatedMap(id),2):elevatedMap(id);
 const home=map.sockets.find(s=>s.y===0&&(id==='rookie-ribbons'?s.x===9&&s.z===2:s.x===-44&&s.z===-28));
 const other=map.spawns.find(s=>Math.hypot(s.x-home.x,s.z-home.z)>15);
 map.spawns=[{...home,id:'camp-start',z:home.z-6,angle:0},other];
 let match;
 const step=w=>w.advance(w.snapshot().serverAt+CONFIG.fixedDt*1000);
 const input=(w,value)=>{const s=w.snapshot('a'),p=s.you;assert(w.input('a',{instance:s.instance,life:p.life,controlEpoch:p.controlEpoch,seq:p.receivedSeq+1,steer:0,throttle:0,brake:1,nitro:false,use:false,...value},s.serverAt).ok);};
 for(let seed=0;seed<128;seed++){
  const candidate=combat.createElevatedCombat(RAPIER,CONFIG,map,[{id:'a'},{id:'b'}],{instance:'camp-'+id,seed,startAt:0,countdownMs:0,roundMs:60000});
  const available=candidate.snapshot().crates.find(c=>Math.hypot(c.position.x-home.x,c.position.z-home.z)<.1);
  if(!available){candidate.dispose();continue;}
  for(let tick=0;tick<240&&!candidate.snapshot().karts[0].weapon;tick++){if(tick%6===0)input(candidate,{throttle:.5,brake:0});step(candidate);}
  if(candidate.snapshot().karts[0].weapon==='trishot'){match=candidate;break;}candidate.dispose();
 }
 assert(match,id+' camping fixture collects its seeded pickup through actual driving');
 try{
  input(match,{});for(let i=0;i<30;i++)step(match);
  const origin=match.snapshot().karts[0].pose.position;
  assert(Math.hypot(origin.x-home.x,origin.z-home.z)<2.4,'parked driver remains inside the original collection radius');
  const pickups=new Set(match.snapshot().events.filter(e=>e.type==='pickup'&&e.pid==='a').map(e=>e.id));
  input(match,{use:true});step(match);input(match,{});
  for(let tick=0;tick<840;tick++){if(tick%6===0)input(match,{});step(match);for(const e of match.snapshot().events)if(e.type==='pickup'&&e.pid==='a')pickups.add(e.id);}
  const last=match.snapshot(),kart=last.karts[0];
  assert(!kart.weapon&&!kart.firing,id+' normal activation spent the complete pickup');
  assert.equal(pickups.size,1,id+' parked empty driver receives no second pickup across seven 2s intervals');
  assert(Math.hypot(kart.pose.position.x-origin.x,kart.pose.position.z-origin.z)<.1,id+' driver did not leave the original home');
  assert(last.crates.every(c=>Math.hypot(c.position.x-origin.x,c.position.z-origin.z)>2.4),id+' boxes recycle clear of the parked driver');
 }finally{match.dispose();}
}
for(const id of ['garden','skyport']){
 const base=elevatedMap(id);base.arenaVersion=1;base.maxPlayers=8;
 const heights=[...new Set(base.sockets.map(s=>s.y))].sort((a,b)=>a-b);
 base.levels=heights.map((y,i)=>({id:'L'+i,y}));base.playBounds={halfX:base.half,halfZ:base.half};
 base.sockets.forEach((s,i)=>Object.assign(s,{level:'L'+heights.indexOf(s.y),district:'core',profile:i%5?'safe':'exposed'}));
 base.spawnCandidates=structuredClone(base.spawns);base.variants=[{id:'test',minPlayers:2,maxPlayers:8,usableArea:3600,districts:['core'],startIds:base.spawns.slice(0,8).map(s=>s.id)}];
 const map=selectArenaVariant(base,8);assert(validateArenaContract(map));
 assert.equal(selectArenaVariant(base,32).variantId,'test');assert.throws(()=>selectArenaVariant(base,33),/unavailable/);assert.throws(()=>selectArenaVariant(base,8,'missing'),/unavailable/);
 const expectedCount=arenaBoxCount(map.usableArea,8,map.sockets.length),homes=selectArenaHomes(map,8,()=>.5);assert.equal(homes.length,expectedCount);assert.equal(new Set(homes.map(s=>s.id)).size,expectedCount);
 const quotas=arenaFloorQuotas(expectedCount,map.levels,map.sockets);for(let i=0;i<heights.length;i++)assert.equal(homes.filter(s=>s.level==='L'+i).length,quotas[i]);
 const match=combat.createElevatedCombat(RAPIER,CONFIG,map,Array.from({length:8},(_,i)=>({id:'p'+i})),{instance:'test',seed:42,startAt:0,countdownMs:0,roundMs:10000});
 try{
   const before=match.snapshot(),homes=before.crates.map(c=>[c.id,c.homeId,c.position]);assert.equal(before.variantId,'test');assert.equal(before.crates.length,expectedCount);
   match.advance(50);match.setConnected('p0',false);match.setConnected('p0',true);
   assert.deepEqual(match.snapshot().crates.map(c=>[c.id,c.homeId,c.position]),homes,'reconnect preserves fixed homes');
 }finally{match.dispose();}
}
console.log('PASS arena policy, two/three-floor authority and reconnect');

const fixture=elevatedMap('garden'),world=createKartPhysics(RAPIER,CONFIG);
try{
 fixture.colliders.forEach(d=>world.addStatic(d));
 const edge={id:'south',from:'L0',to:'L1',points:[{x:16,y:0,z:-32},{x:16,y:7,z:-4}]};
 const audit=auditArenaEdge(world,edge);assert.deepEqual(audit.failures,[]);
 assert(arenaOrdinaryConnectivity(['L0','L1'],[edge,{...edge,id:'north'}],'south'));
 assert(!arenaOrdinaryConnectivity(['L0','L1'],[{...edge,kind:'portal'}]));
 const collision=createKartCameraCollision(THREE,fixture.colliders),focus=new THREE.Vector3(20,.85,5),eye=new THREE.Vector3(20,12,5);
 assert(collision.constrain(eye,focus));assert(eye.y<6.2,'underside is finite and solid to the camera');collision.dispose();
}finally{world.dispose();}
const scene=new THREE.Scene(),pickups=createRaisedPickups(THREE,scene);
const homes=Array.from({length:48},(_,i)=>({id:'c'+i,homeId:'home'+i,profile:i<4?'risk':'safe',position:{x:i*4,y:.6,z:0},available:true}));
pickups.update(homes,0);assert.equal(pickups.mesh.count,48);assert.equal(pickups.homes.count,48);
homes.forEach(c=>c.available=false);pickups.update(homes,1);assert.equal(pickups.mesh.count,0);assert.equal(pickups.homes.count,48);pickups.dispose();assert.equal(scene.children.length,0);
console.log('PASS ordinary route support, alternate-climb exclusion, camera underside, 48-box/48-outline batch disposal');
