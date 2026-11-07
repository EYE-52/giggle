// Arena features on the classic Rapier authority: launch cannons, portal
// pairs and fall-off zones. Real shared motion, real map data.
// Run: node test/kart-arena-features.mjs
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import config from '../public/js/engines/kart-physics-config.mjs';
import {createClassicMotion} from '../public/js/engines/kart-classic-motion.mjs';
import {createRoadTerrain} from '../public/js/engines/kart-road-terrain.mjs';
import * as F from '../public/js/engines/kart-map-features.mjs';
import maps from '../games/engines/kart-maps.js';
await RAPIER.init();
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};
const MAP_IDS=['ring','blocks','garden','frost','neon'];
const rectD=(r,x,z)=>Math.hypot(Math.max(0,Math.abs(x-r.x)-r.hw),Math.max(0,Math.abs(z-r.z)-r.hd));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));

// ---- placement: every classic map has 1-2 cannons, one portal pair and one
// fall zone, all clear of spawns, crate sockets, cover and turbo strips ----
for(const id of MAP_IDS){
 const m=maps.mapDef(id),f=m.features;
 ok(f&&f.cannons.length>=1&&f.cannons.length<=2,id+': one or two cannons');
 ok(f.portals.length===1&&f.portals[0].length===2,id+': one portal pair');
 ok(f.falls.length===1,id+': one fall zone');
 for(const c of f.cannons){
  ok(F.cannonFlightTime(c)>=1.2&&F.cannonFlightTime(c)<=1.6,id+': flight lasts 1.2-1.6 s');
  ok(m.spawns.every(s=>Math.hypot(s.x-c.x,s.z-c.z)>=7.5),id+': cannon clear of spawns');
  ok(m.spots.every(([x,z])=>Math.hypot(x-c.x,z-c.z)>=6),id+': cannon clear of crate sockets');
  ok(m.blocks.every(b=>rectD(b,c.x,c.z)>=5)&&m.blocks.every(b=>rectD(b,c.land.x,c.land.z)>=5),id+': cannon and landing clear of cover');
  ok(f.falls.every(r=>rectD(r,c.land.x,c.land.z)>=5),id+': landing never in a fall zone');
  ok(Math.max(Math.abs(c.land.x),Math.abs(c.land.z))<=m.half-6,id+': landing well inside the fence');
 }
 for(const p of f.portals.flat()){
  const e=F.portalExit(p);
  ok(m.spawns.every(s=>Math.hypot(s.x-p.x,s.z-p.z)>=6.5),id+': portal clear of spawns');
  ok(m.spots.every(([x,z])=>Math.hypot(x-p.x,z-p.z)>=5),id+': portal clear of crate sockets');
  ok(m.blocks.every(b=>rectD(b,e.x,e.z)>=4),id+': portal exit clear of cover');
  ok(Math.max(Math.abs(e.x),Math.abs(e.z))<=m.half-4.5,id+': portal exit inside the fence');
  ok(!F.inPortal(p,e.x,e.z)&&f.portals.flat().every(q=>!F.inPortal(q,e.x,e.z)),id+': exit point is outside every ring');
 }
 for(const r of f.falls){
  ok(m.spots.every(([x,z])=>rectD(r,x,z)>=3.2),id+': fall zone keeps crates out');
  ok(m.spawns.every(s=>rectD(r,s.x,s.z)>=6),id+': fall zone keeps spawns out');
  ok(m.blocks.every(b=>Math.hypot(Math.max(0,Math.abs(r.x-b.x)-r.hw-b.hw),Math.max(0,Math.abs(r.z-b.z)-r.hd-b.hd))>=2.5),id+': fall zone clear of cover');
 }
}

const kart=(pid,x,z,angle,input={steer:0,throttle:1})=>({pid,x,z,angle,speed:0,boost:0,boostCd:0,turbo:0,padCd:0,nitro:1,input,spawnSeq:0,connected:true,flight:null,cannonCd:0,portalCd:0});
// Include the arena network and structures in authority and prediction.
const room=(id,karts)=>{const m=maps.mapDef(id);return {map:id,mode:'battle',half:m.half,blocks:m.blocks,pads:m.pads,surfaces:m.surfaces,roads:m.roads,offroad:m.offroad,barriers:m.barriers,ramps:m.ramps,features:m.features,karts,physicalEvents:[],physicalEventSeq:0,featureEvents:[],featureEventSeq:0};};
/* An approach pose `distance` metres from (x,z) facing it, from the first
 * open side: behind, left, right, then front. */
function approach(id,x,z,angle,distance){
 const m=maps.mapDef(id),terrain=createRoadTerrain({...m,id});
 for(const offset of [Math.PI,Math.PI/2,-Math.PI/2,3*Math.PI/4,-3*Math.PI/4,Math.PI/4,-Math.PI/4,0]){
  const a=angle+offset,px=x+Math.sin(a)*distance,pz=z+Math.cos(a)*distance;
  if(Math.max(Math.abs(px),Math.abs(pz))>m.half-4||m.blocks.some(b=>rectD(b,px,pz)<2.5))continue;
  if(m.features.falls.some(r=>rectD(r,px,pz)<3)||terrain.heightAt(px,pz)>1.5)continue;
  return {x:px,z:pz,angle:wrap(a+Math.PI)};
 }
 throw Error(id+': no open approach');
}
const metrics=[];

// ---- cannons: launch on entry, readable arc, land in the zone facing the
// landing heading at a sensible speed, steering ignored, cooldown holds ----
for(const id of MAP_IDS)maps.mapDef(id).features.cannons.forEach((c,index)=>{
 const start=approach(id,c.x,c.z,c.angle,7),k=kart('a',start.x,start.z,start.angle),s=room(id,[k]),w=createClassicMotion(RAPIER,config,s),online=new Set(['a']);
 let launchedAt=null,landedAt=null,peak=-Infinity,time=0,afterLand=null,groundedSoon=null;
 for(let i=0;i<60*9&&!(afterLand!==null&&time-afterLand>3);i++){
  // Wild steering in flight must change nothing.
  k.input={throttle:1,steer:k.flight?(i%2?1:-1):0};
  w.advance(1/60,online);time+=1/60;
  if(launchedAt===null&&s.featureEvents.some(e=>e.type==='launch'))launchedAt=time;
  if(k.flight)peak=Math.max(peak,k.physicalPose.position.y);
  if(landedAt===null&&s.featureEvents.some(e=>e.type==='land')){
   landedAt=time;afterLand=time;
   ok(Math.hypot(k.x-c.land.x,k.z-c.land.z)<.6,id+' cannon '+index+': lands inside its zone');
   ok(Math.abs(wrap(k.angle-c.land.angle))<.05,id+' cannon '+index+': lands facing the landing heading');
   ok(k.speed>10&&k.speed<16,id+' cannon '+index+': lands at a sensible speed '+k.speed.toFixed(2));
  }
  if(afterLand!==null&&groundedSoon===null&&time-afterLand>=.5)groundedSoon=k.physicalPose.grounded;
 }
 ok(launchedAt!==null,id+' cannon '+index+': driving in launches');
 ok(landedAt!==null,id+' cannon '+index+': the flight lands');
 const flight=landedAt-launchedAt;
 ok(flight>=1.2-1/30&&flight<=1.6+1/30,id+' cannon '+index+': flight time '+flight.toFixed(3));
 ok(peak>=6,id+' cannon '+index+': high readable arc ('+peak.toFixed(1)+' m)');
 ok(s.featureEvents.filter(e=>e.type==='launch').length===1,id+' cannon '+index+': exactly one launch');
 ok(groundedSoon===true,id+' cannon '+index+': back on its wheels after landing');
 metrics.push({id,cannon:index,flight:+flight.toFixed(3),peak:+peak.toFixed(2)});
 w.dispose();
});

// A kart that parks in the mouth, or sits there during the cooldown, never
// re-fires; after the cooldown a fresh entry fires again.
{
 const c=maps.mapDef('garden').features.cannons[0];
 const k=kart('a',c.x,c.z,c.angle,{steer:0,throttle:0}),s=room('garden',[k]),w=createClassicMotion(RAPIER,config,s),online=new Set(['a']);
 for(let i=0;i<60;i++)w.advance(1/60,online);
 ok(!s.featureEvents.length&&!k.flight,'a parked kart in the mouth never launches');
 k.cannonCd=.3;k.input={steer:0,throttle:1};
 for(let i=0;i<12;i++)w.advance(1/60,online);
 ok(!s.featureEvents.length,'cooldown blocks a repeat trigger');
 for(let i=0;i<60&&!s.featureEvents.length;i++)w.advance(1/60,online);
 ok(s.featureEvents.some(e=>e.type==='launch'),'re-arms once the cooldown ends');
 w.dispose();
}

// ---- portals: enter one ring, leave the partner with the same speed and its
// heading; no ping-pong, a full round trip is exactly two jumps ----
for(const id of MAP_IDS){
 const [A,B]=maps.mapDef(id).features.portals[0];
 const start=approach(id,A.x,A.z,A.angle+Math.PI,9);
 // approach() puts us 9 m out on the ring's front side, facing the ring.
 const k=kart('a',start.x,start.z,start.angle),s=room(id,[k]),w=createClassicMotion(RAPIER,config,s),online=new Set(['a']);
 let entry=null,time=0,jumps=[];
 for(let i=0;i<60*4;i++){
  const before={speed:Math.hypot(k.physicalPose?.linearVelocity.x||0,k.physicalPose?.linearVelocity.z||0),epoch:k.physicalPose?.epoch};
  w.advance(1/60,online);time+=1/60;
  if(k.physicalPose.epoch!==before.epoch){jumps.push({time,x:k.x,z:k.z,angle:k.angle,speed:Math.hypot(k.physicalPose.linearVelocity.x,k.physicalPose.linearVelocity.z)});entry??=before.speed;}
 }
 const warps=s.featureEvents.filter(e=>e.type==='warp');
 ok(warps.length===1&&jumps.length===1,id+': one ring entry is exactly one jump');
 const exit=F.portalExit(B),j=jumps[0];
 ok(Math.hypot(j.x-exit.x,j.z-exit.z)<.3,id+': leaves through the partner ring');
 ok(Math.abs(wrap(j.angle-B.angle))<.02,id+': heading turned to the exit ring');
 ok(Math.abs(j.speed-Math.max(F.PORTAL_MIN_EXIT_SPEED,entry))<.6,id+': planar speed preserved '+j.speed.toFixed(2)+' vs '+entry.toFixed(2));
 ok(!F.inPortal(B,k.x,k.z)&&!F.inPortal(A,k.x,k.z),id+': not stuck in a ring');
 // Turn around and drive back into the partner: exactly one more jump.
 const back=approach(id,B.x,B.z,B.angle+Math.PI,9);k.x=back.x;k.z=back.z;k.angle=back.angle;k.spawnSeq++;k.portalCd=0;
 for(let i=0;i<60*4;i++)w.advance(1/60,online);
 const returns=s.featureEvents.filter(e=>e.type==='warp');
 ok(returns.length===2&&returns[1].side===1,id+': round trip back through the partner is one more jump');
 const home=F.portalExit(A);
 ok(Math.hypot(k.x-home.x,k.z-home.z)>4,id+': drove on out of the first ring');
 metrics.push({id,portalEntrySpeed:+entry.toFixed(2)});
 w.dispose();
}

// The exit grace stops any re-trigger, even when the exit point is nudged
// back into the partner ring by a bump.
{
 const [A,B]=maps.mapDef('garden').features.portals[0];
 const k=kart('a',A.x,A.z,A.angle+Math.PI),s=room('garden',[k]),w=createClassicMotion(RAPIER,config,s),online=new Set(['a']);
 k.portalCd=F.PORTAL_GRACE;
 for(let i=0;i<30;i++)w.advance(1/60,online);
 ok(!s.featureEvents.length,'grace period: a ring cannot fire straight after an exit');
 w.dispose();
}
console.log(JSON.stringify({pass:true,checks,scope:'classic authority motion, real map data',metrics}));
