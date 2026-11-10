import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import R from '@dimforge/rapier3d-compat';
import C from '../../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../../public/js/engines/kart-physics-core.mjs';
import {elevatedMap} from '../../public/js/engines/kart-elevated-maps.mjs';
import {selectArenaVariant,validateArenaContract,arenaBoxCount} from '../../public/js/engines/kart-arena-policy.mjs';
import {elevatedStatics} from '../../public/js/engines/kart-feature-solids.mjs';
import {auditArenaEdge} from '../../public/js/engines/kart-arena-navigation.mjs';
import {createKartCameraCollision} from '../../public/js/engines/kart-camera-collision.mjs';
import {createKartElevatedWorld} from '../../public/js/engines/kart-elevated-world.mjs';
import {createKartArenaFeatures} from '../../public/js/engines/kart-arena-features-art.mjs';
import {arenaClearanceGraph,measureArenaArea} from './kart-arena-audit.mjs';
import {spawnLaneOracle,yaw} from './kart-spawn-lane.mjs';
import {driveArenaRoute} from './kart-arena-driver.mjs';
import combat from '../../games/engines/kart-elevated-combat.js';
export async function runLaunchGates({id,players:counts,colliderBudget,drawBudget,triangleBudget,cuts}){
await R.init();const raw=elevatedMap(id),reports=[],drivenVariants=new Set();
for(const players of counts){
 const map=selectArenaVariant(raw,players);assert(validateArenaContract(map));assert.equal(map.spawnCandidates.length,map.maxPlayers*2);assert(elevatedStatics(map).length<=colliderBudget);
 const query=createKartPhysics(R,C);elevatedStatics(map).forEach(d=>query.addStatic(d));
 try{
  const area=measureArenaArea(query,map);assert.equal(area.total,map.usableArea);
  const nav=arenaClearanceGraph(query,map),starts=map.spawns.map(p=>nav.nearest(p)),homes=map.sockets.map(p=>nav.nearest(p));assert([...starts,...homes].every(p=>p?.distance<2));
  for(const id of[null,...(cuts||map.routes.filter(e=>e.kind==='drive'&&e.from!==e.to).map(e=>e.id))]){const ramps=map.colliders.filter(d=>d.shape==='wedge'&&d.id.startsWith(id)),ids=new Set(ramps.map(d=>d.id)),low=Math.min(...ramps.map(d=>d.position.y-d.half.y)),high=Math.max(...ramps.map(d=>d.position.y+d.half.y)),blocked=id?n=>ids.has(n.surface)&&n.y>low+.3&&n.y<high-.3:null,reached=nav.flood(starts[0].n.index,blocked);assert([...starts,...homes].every(p=>reached.has(p.n.index)),'alternate ordinary connection with '+id+' blocked');}
  const openingFields=new Map(),opening=map.spawns.map(p=>{const field=nav.shortest(nav.nearest(p).n.index);openingFields.set(p.id,field);const nearest=map.sockets.filter(s=>s.y===p.y&&s.profile!=='risk').map(s=>field.distance[nav.nearest(s).n.index]).sort((a,b)=>a-b).slice(0,2);assert(nearest[1]<=32,'two ordinary homes within 32m road distance: '+p.id);return {id:p.id,distances:nearest};});
  const lane=spawnLaneOracle(R,query,map);for(const s of map.spawnCandidates)assert(lane(s),s.id+' 20m full-hull departure, including feature frames');
  for(let i=0;i<map.spawns.length;i++){const p=map.spawns[i];for(const q of map.spawns.slice(0,i))if(p.y===q.y)assert(Math.hypot(p.x-q.x,p.z-q.z)>=6);for(const h of map.sockets.filter(h=>h.y===p.y))assert(Math.hypot(h.x-p.x,h.z-p.z)>=8);}
  let cameraSamples=0;const camera=createKartCameraCollision(THREE,elevatedStatics(map));
  for(const e of map.routes.filter(e=>e.kind==='drive')){
   assert.deepEqual(auditArenaEdge(query,e).failures,[],e.id+' supported swept lane');
   for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i],steps=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.5);for(let k=0;k<=steps;k++)for(let h=0;h<12;h++){const t=k/steps,angle=h*Math.PI/6,focus=new THREE.Vector3(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t+.85,a.z+(b.z-a.z)*t),eye=focus.clone().add(new THREE.Vector3(-Math.sin(angle)*8.8,3.2,-Math.cos(angle)*8.8));camera.constrain(eye,focus,.32);assert(!query.overlapsStatic(eye,yaw(0),{x:.14,y:.14,z:.14}),e.id+' eye clear');cameraSamples++;}}
   if(!drivenVariants.has(map.variantId))for(const reverse of[false,true]){const result=driveArenaRoute(R,C,map,reverse?[...e.points].reverse():e.points);assert(result.complete,e.id+' drive '+reverse);assert.deepEqual(result.events,[]);assert(result.stuck<3000);}
  }camera.dispose();
  for(let seed=0;seed<20;seed++){const match=combat.createElevatedCombat(R,C,raw,Array.from({length:players},(_,i)=>({id:'p'+i})),{instance:'gate',seed,startAt:0,countdownMs:0});try{let snapshot=match.snapshot();assert.equal(snapshot.crates.length,arenaBoxCount(map.usableArea,players,map.sockets.length));assert.equal(new Set(snapshot.crates.map(c=>c.homeId)).size,snapshot.crates.length);for(const l of map.levels)assert(snapshot.crates.filter(c=>Math.abs(c.position.y-.6-l.y)<.1).length>=4);for(const start of map.spawns.slice(0,players)){const ordinary=snapshot.crates.filter(c=>c.profile!=='risk').map(c=>map.sockets.find(h=>h.id===c.homeId)).filter(h=>h.y===start.y).map(h=>openingFields.get(start.id).distance[nav.nearest(h).n.index]).sort((a,b)=>a-b);assert(ordinary[1]<=32,'selected round homes cover '+start.id+' seed '+seed+': '+ordinary.slice(0,2));}
   if(seed===0){const origin=snapshot.karts.map(k=>k.pose.position),done=new Set();for(let at=0;at<3000&&done.size<players;at+=50){for(const [i,k]of snapshot.karts.entries()){if(Math.hypot(k.pose.position.x-origin[i].x,k.pose.position.z-origin[i].z)>=20)done.add(k.id);if(!done.has(k.id))assert(k.alive&&k.pose.position.y>origin[i].y-2,'departure stays supported');const own=match.privateStatus(k.id);match.input(k.id,{instance:'gate',life:own.life,controlEpoch:own.controlEpoch,seq:at/50+1,throttle:done.has(k.id)?0:1,brake:done.has(k.id)?1:0,steer:0,nitro:false,use:false},at);}snapshot=match.advance(at+50);}assert.equal(done.size,players,'all selected starts physically drive 20m together');}
  }finally{match.dispose();}}
  drivenVariants.add(map.variantId);reports.push({players,variant:map.variantId,area,statics:elevatedStatics(map).length,starts:map.spawns.length,candidates:map.spawnCandidates.length,homes:map.sockets.length,opening,cameraSamples});
 }finally{query.dispose();}
}
for(const players of[counts[0],counts.at(-1)]){const scene=new THREE.Scene(),map=selectArenaVariant(raw,players),world=createKartElevatedWorld(THREE,{scene,map}),features=createKartArenaFeatures(THREE,scene);features.sync(map);const stats=world.stats();features.root.traverseVisible(o=>{if(o.isMesh&&(!o.isInstancedMesh||o.count)){stats.drawCalls++;stats.triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);}});assert(stats.drawCalls<=drawBudget&&stats.triangles<=triangleBudget,JSON.stringify(stats));assert(stats.textureBytes<=12*1024**2);world.dispose();features.dispose();assert.equal(scene.children.length,0);reports.find(r=>r.players===players).worldIncludingFeatures=stats;}
fs.writeFileSync(new URL('../../../../artifacts/kart-arenas/'+id+'-gates.json',import.meta.url),JSON.stringify({reports},null,2));
console.log('PASS '+id+': variants, two-way real driving, alternate climbs, 20-seed supply, simultaneous starts, camera sweeps and art/feature budgets');return reports;
}
