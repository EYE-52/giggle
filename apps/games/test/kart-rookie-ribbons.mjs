import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {selectArenaVariant,validateArenaContract} from '../public/js/engines/kart-arena-policy.mjs';
import {auditArenaEdge,arenaOrdinaryConnectivity} from '../public/js/engines/kart-arena-navigation.mjs';
import {spawnLaneOracle,yaw} from './helpers/kart-spawn-lane.mjs';
import {createKartCameraCollision} from '../public/js/engines/kart-camera-collision.mjs';
import {createKartElevatedWorld} from '../public/js/engines/kart-elevated-world.mjs';
import {arenaClearanceGraph,measureArenaArea} from './helpers/kart-arena-audit.mjs';
import {driveArenaRoute} from './helpers/kart-arena-driver.mjs';
import {rookieCircuit} from './helpers/kart-rookie-route.mjs';
import combat from '../games/engines/kart-elevated-combat.js';
await RAPIER.init();
const source=elevatedMap('rookie-ribbons'),report=[];
for(const players of[2,4,8]){
 const map=selectArenaVariant(source,players);assert(validateArenaContract(map));assert(map.colliders.length<=44);
 const physics=createKartPhysics(RAPIER,CONFIG);let match;
 try{
  map.colliders.forEach(d=>physics.addStatic(d));physics.addKart('bot',{position:{x:0,y:1,z:0}});
  const area=measureArenaArea(physics,map);assert.equal(area.total,map.usableArea,'formula uses measured area, not the sketch target');
  const nav=arenaClearanceGraph(physics,map),starts=map.spawns.map(p=>nav.nearest(p)),homes=map.sockets.map(p=>nav.nearest(p));
  assert([...starts,...homes].every(p=>p?.distance<2),'all starts/homes join real clearance graph');
  for(const blocked of[null,'west-climb','east-climb']){const reached=nav.flood(starts[0].n.index,blocked);assert([...starts,...homes].every(p=>reached.has(p.n.index)),'ordinary network stays connected with '+blocked+' blocked');}
  for(const s of map.spawns.slice(0,players)){assert(map.sockets.filter(h=>h.y===s.y).every(h=>Math.hypot(s.x-h.x,s.z-h.z)>=8-1e-6),s.id+' is at least 8m from a home');}
  const lane=spawnLaneOracle(RAPIER,physics,map);
  for(const s of map.spawnCandidates){assert(lane(s),s.id+' clears full 20m lane');physics.resetKart('bot',{position:{x:s.x,y:s.y+1,z:s.z},rotation:yaw(s.angle)});physics.applyIntent('bot',{throttle:0,steer:0});for(let i=0;i<90;i++)physics.step();physics.applyIntent('bot',{throttle:1,steer:0});for(let i=0;i<150;i++){physics.step();const p=physics.pose('bot').position;if(Math.hypot(p.x-s.x,p.z-s.z)>=20)break;}const pose=physics.pose('bot');assert(pose.speed>=8,s.id+' drives away');assert(Math.hypot(pose.position.x-s.x,pose.position.z-s.z)>15,s.id+' progresses');}
  for(const e of map.routes){const audit=auditArenaEdge(physics,e);assert.deepEqual(audit.failures,[],e.id+' has supported hull clearance');}
  for(const blocked of ['west-climb','east-climb'])assert(arenaOrdinaryConnectivity(['L0','L1'],map.routes,blocked));
  const camera=createKartCameraCollision(THREE,map.colliders);let samples=0;
  for(const e of map.routes)for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i],run=Math.hypot(b.x-a.x,b.z-a.z),steps=Math.ceil(run/.5);for(let t=0;t<=steps;t++){const f=t/steps,focus=new THREE.Vector3(a.x+(b.x-a.x)*f,a.y+(b.y-a.y)*f+.85,a.z+(b.z-a.z)*f);for(let h=0;h<12;h++){const angle=h*Math.PI/6,eye=new THREE.Vector3(focus.x-Math.sin(angle)*8.8,focus.y+3.2,focus.z-Math.cos(angle)*8.8);camera.constrain(eye,focus,.32);assert(!physics.overlapsStatic(eye,yaw(0),{x:.14,y:.14,z:.14}),e.id+' camera outside solids');samples++;}}}camera.dispose();
  match=combat.createElevatedCombat(RAPIER,CONFIG,source,Array.from({length:players},(_,i)=>({id:'p'+i})),{instance:'rookie',seed:42,startAt:0,countdownMs:0});
  const snapshot=match.snapshot();assert.equal(snapshot.variantId,players===2?'duel':'full');assert.equal(snapshot.crates.length,players===2?14:20);assert.equal(snapshot.crates.filter(c=>c.position.y>2).length,4);
  report.push({players,variant:map.variantId,colliders:map.colliders.length,boxes:snapshot.crates.length,cameraSamples:samples});
 }finally{match?.dispose();physics.dispose();}
}
for(const players of[2,8])for(const reverse of[false,true]){const map=selectArenaVariant(source,players),points=rookieCircuit(players);if(reverse)points.reverse();const driven=driveArenaRoute(RAPIER,CONFIG,map,points);assert(driven.complete,'full circuit '+players+'/'+reverse+' completes');assert.deepEqual(driven.events,[],'no route resets or recovery');assert(driven.stuck<3000);}
const scene=new THREE.Scene(),world=createKartElevatedWorld(THREE,{scene,map:selectArenaVariant(source,8)});const stats=world.stats();assert(stats.drawCalls<=45&&stats.triangles<=28000);world.dispose();assert.equal(scene.children.length,0);
console.log('PASS Rookie Ribbons',JSON.stringify({report,world:stats}));
