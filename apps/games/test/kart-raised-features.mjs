import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import C from '../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {createElevatedMotion} from '../public/js/engines/kart-elevated-motion.mjs';
import {elevatedMap,elevatedMapIds} from '../public/js/engines/kart-elevated-maps.mjs';
import {flightPose,portalExit,CANNON_COOLDOWN,PORTAL_GRACE} from '../public/js/engines/kart-map-features.mjs';
import {createKartArenaFeatures} from '../public/js/engines/kart-arena-features-art.mjs';
import {createKartElevatedWorld} from '../public/js/engines/kart-elevated-world.mjs';
import COMBAT from '../games/engines/kart-elevated-combat.js';
import ADAPTER from '../games/engines/kart-elevated-adapter.js';
import {createElevatedPrediction} from '../public/js/engines/kart-elevated-prediction.mjs';
import {arenaFeatureSolids,elevatedStatics} from '../public/js/engines/kart-feature-solids.mjs';
await R.init();
const yaw=a=>({x:0,y:Math.sin(a/2),z:0,w:Math.cos(a/2)}),near=(a,b)=>Math.abs(a-b)<.06;
const reports=[];
for(const id of elevatedMapIds){
 const map=elevatedMap(id),p=createKartPhysics(R,C);map.colliders.forEach(d=>p.addStatic(d));
 const statics=elevatedStatics(map),featureSolids=arenaFeatureSolids(map.features),solidProbe=createKartPhysics(R,C);
 assert.equal(statics.length,map.colliders.length+map.features.cannons.length+map.features.portals.flat().length,id+' one solid shell per feature');
 assert.equal(new Set(statics.map(d=>d.id)).size,statics.length,id+' no duplicate static ids');
 for(const d of featureSolids)solidProbe.addStatic(d);
 for(const [i,c]of map.features.cannons.entries()){
  const s=Math.sin(c.angle),co=Math.cos(c.angle),point=(v)=>({x:c.x+s*.8+co*v,y:c.y+1.5,z:c.z+co*.8-s*v});
  assert.equal(solidProbe.sweepStatic(point(-4.2),point(4.2),.22)?.surfaceId,'cannon-solid-'+i,id+' raised cannon sides are solid');
 }
 for(const [pair,rings]of map.features.portals.entries())for(const [side,f]of rings.entries()){
  const s=Math.sin(f.angle),co=Math.cos(f.angle),point=(u)=>({x:f.x+s*u+co*2.15,y:f.y+2.45,z:f.z+co*u-s*2.15});
  assert.equal(solidProbe.sweepStatic(point(-2),point(2),.22)?.surfaceId,`portal-solid-${pair}-${side}`,id+' portal upright is solid on its authored storey');
 }
 for(const d of map.colliders)solidProbe.addStatic(d);
 for(const s of map.spawns)assert(!solidProbe.overlapsStatic({x:s.x,y:s.y+1,z:s.z},yaw(s.angle)),id+'/'+s.id+' starts clear of every solid feature');
 solidProbe.dispose();
 const checkPoint=(f,label,lane=0)=>{
  const rot=yaw(f.angle);
  for(let t=0;t<=lane;t+=.5){
   const x=f.x+Math.sin(f.angle)*t,z=f.z+Math.cos(f.angle)*t,position={x,y:f.y+.75,z};
   assert(!p.overlapsStatic(position,rot),id+' '+label+' hull is clear at '+t);
   for(const w of C.wheels){const wx=x+w.x*Math.cos(f.angle)+w.z*Math.sin(f.angle),wz=z-w.x*Math.sin(f.angle)+w.z*Math.cos(f.angle),s=p.supportAt({x:wx,y:f.y+.4,z:wz},.8);assert(s&&s.normal.y>.65&&near(s.point.y,f.y),id+' '+label+' all wheels supported at '+t);}
   assert(!(map.fallZones||[]).some(h=>Math.abs(x-h.x)<h.halfX+2&&Math.abs(z-h.z)<h.halfZ+2),id+' '+label+' outside fall openings');
  }
  assert.equal(p.supportAt({...f,y:f.y+.4},.8)?.surfaceId,f.surface,id+' '+label+' uses its authored surface');
 };
 assert(map.features.cannons.length>=1&&map.features.cannons.length<=2);assert.equal(map.features.portals.length,1);
 for(const c of map.features.cannons){
  checkPoint(c,'cannon entry');checkPoint(c.land,'landing',10);
  const f={x:c.x,y:c.y+.75,z:c.z,a:c.angle,ly:c.land.y+.75};
  for(let i=0;i<=192;i++){const a=flightPose(c,f,i/120);assert(!p.overlapsStatic(a.position,a.rotation),id+' cannon arc clears all actual solids at '+i);}
 }
 for(const ring of map.features.portals.flat()){checkPoint(ring,'ring');checkPoint(portalExit(ring),'portal exit',10);}
 // Exercise the same runner as authority/prediction, including repeat entry
 // fixture teleports, wrong-floor triggers and an actual suspended arc.
 const c=map.features.cannons[0],k={id:'bot',pid:'bot',alive:true,connected:true,spawnSeq:0,input:{throttle:1,steer:0,brake:0},nitro:1},events=[];
 p.addKart(k.id,{position:{x:c.x,y:c.y+1,z:c.z},rotation:yaw(c.angle)});p.step(15);p.step(15);p.step(15);p.step(15);
 const motion=createElevatedMotion({physics:p,map,karts:[k],emit:(type,pid,e)=>events.push({type,pid,...e})});
 function place(f,speed=9){p.resetKart(k.id,{position:{x:f.x,y:f.y+1,z:f.z},rotation:yaw(f.angle)});p.step(15);p.step(15);p.restoreKart(k.id,{...p.pose(k.id),linearVelocity:{x:Math.sin(f.angle)*speed,y:0,z:Math.cos(f.angle)*speed}});motion.project(k);}
 place(c);motion.afterStep(C.fixedDt);assert(k.flight,id+' cannon enters from its supported mouth');
 for(let n=0;n<97&&k.flight;n++){motion.controls(k,C.fixedDt);p.step();motion.afterStep(C.fixedDt);}
 assert(!k.flight&&k.cannonCd>2.4&&near(p.pose(k.id).position.y,c.land.y+.75),id+' lands on the upper deck with cooldown');
 assert.equal(events.filter(e=>e.type==='launch').length,1);assert.equal(events.filter(e=>e.type==='land').length,1);
 place(c);motion.afterStep(C.fixedDt);assert(!k.flight&&events.filter(e=>e.type==='launch').length===1,id+' cannon cooldown prevents an immediate loop');
 const wait=map.spawns.find(s=>s.y===0&&Math.hypot(s.x-c.x,s.z-c.z)>12);
 place(wait,0);k.input={steer:0,throttle:0,brake:1};
 for(let n=0;n<151;n++){motion.controls(k,C.fixedDt);p.step();motion.afterStep(C.fixedDt);}
 assert.equal(k.cannonCd,0,id+' cannon cooldown expires on fixed simulation time');place(c);motion.afterStep(C.fixedDt);assert(k.flight&&events.filter(e=>e.type==='launch').length===2,id+' cannon re-arms after its full cooldown');motion.reset(k);
 const pair=map.features.portals[0];place(pair[0]);motion.afterStep(C.fixedDt);
 const exit=portalExit(pair[1]);assert(k.portalCd>PORTAL_GRACE-.02&&near(p.pose(k.id).position.y,exit.y+.75)&&near(p.pose(k.id).position.x,exit.x),id+' portal changes real height and pose epoch');
 assert.equal(events.filter(e=>e.type==='warp').length,1);place(pair[1]);motion.afterStep(C.fixedDt);assert.equal(events.filter(e=>e.type==='warp').length,1,id+' global portal grace prevents ping pong');
 place(wait,0);for(let n=0;n<73;n++){motion.controls(k,C.fixedDt);p.step();motion.afterStep(C.fixedDt);}assert.equal(k.portalCd,0);place(pair[1]);motion.afterStep(C.fixedDt);assert.equal(events.filter(e=>e.type==='warp').length,2,id+' portal re-arms after grace');
 const upper=pair[1],below={...upper,y:0,surface:'floor'};
 if(!p.overlapsStatic({...below,y:1},yaw(below.angle))&&p.supportAt({...below,y:.4},.8)?.point.y<.1){k.portalCd=0;place(below);motion.afterStep(C.fixedDt);assert.equal(events.filter(e=>e.type==='warp').length,2,id+' ring cannot trigger through its deck');}
 p.dispose();
 // Drive a real authority through the entry. Inputs contain no pose/feature id.
 const authored=structuredClone(map),entry={...c,x:c.x-Math.sin(c.angle)*4,z:c.z-Math.cos(c.angle)*4};
 authored.spawns[0]={...entry,id:'approach',surface:c.surface};
 const game=COMBAT.createElevatedCombat(R,C,authored,[{id:'a'},{id:'b'}],{instance:'routes-'+id,seed:7,countdownMs:0,roundMs:15000,crates:1});
 assert.equal(game.stats().physics.statics,statics.length,id+' authority installs every solid exactly once');
 const prediction=createElevatedPrediction(R);let maxPredictionError=0;
 const convert=raw=>({...raw,instanceId:raw.instance,you:'a',youDrive:true,inputAck:raw.you});
 try{let landed=false,last=convert(game.snapshot('a'));
  game.advance(1000/60);last=convert(game.snapshot('a'));prediction.ingest(last,1000,last.serverAt);
  assert.equal(prediction.stats().physics.statics,statics.length,id+' prediction installs the same solids exactly once');
  for(let n=0;n<420;n++){const s=game.snapshot('a');if(n%6===0)assert(game.input('a',{instance:s.instance,life:s.you.life,controlEpoch:s.you.controlEpoch,seq:s.you.receivedSeq+1,steer:0,throttle:.8,brake:0,nitro:false,use:false},s.serverAt).ok);const at=s.serverAt+1000/60,arrival=1000+(n+1)*1000/60;
   const predicted=prediction.frame(last,{steer:0,throttle:.8,brake:0,nitro:false,use:false},C.fixedDt,arrival,at);
   game.advance(at);const next=convert(game.snapshot('a'));
   if(predicted)maxPredictionError=Math.max(maxPredictionError,Math.hypot(...['x','y','z'].map(axis=>predicted.pose.position[axis]-next.karts[0].pose.position[axis])));
   if(n%3===0){prediction.ingest(next,arrival,at);last=next;}
   if(game.snapshot().events.some(e=>e.type==='land')){landed=true;break;}}
  assert(landed,id+' real authority input reaches the high landing');assert(game.snapshot().karts[0].pose.position.y>c.land.y+.45);
  assert(maxPredictionError<.15,id+' cannon prediction matches server within 15cm: '+maxPredictionError);
 }finally{game.dispose();prediction.dispose();}
 // Exercise the production projection, whose compact vectors need height.
 const maps=Object.fromEntries(elevatedMapIds.map(id=>[id,elevatedMap(id)]));maps[id]=authored;
 const adapter=ADAPTER.createElevatedKartAdapter({RAPIER:R,config:C,maps,defaults:{}});
 let clock=0;const ctx={instanceId:'public-'+id,settings:()=>({map:map.name,mode:'Zap Battle',roundSeconds:60}),now:()=>clock,allPlayers:()=>[{id:'a'},{id:'b'}],broadcast(){},award(){}};
 const state=adapter.create(ctx);
 try{let landed=false;for(let i=0;i<600;i++){
   const s=adapter.view(state,'a');if(s.phase==='live'&&i%6===0)adapter.onAction(state,ctx,'a',{type:'input',seq:s.inputAck.receivedSeq+1,life:s.inputAck.life,controlEpoch:s.inputAck.controlEpoch,steer:0,throttle:.8,brake:0,nitro:false,use:false});
   clock+=1000/60;adapter.onTick(state,ctx);const view=adapter.view(state,'a');assert(!view.error,id+' production route projection stays live');
   const launch=view.events.find(e=>e.type==='launch');if(launch)assert(launch.to&&Number.isFinite(launch.to.y),id+' launch target height survives public projection');
   if(view.events.some(e=>e.type==='land')){landed=true;break;}
  }assert(landed,id+' production projection carries a complete cannon journey');
 }finally{adapter.dispose(state);}
 // The opposite shortcut also travels through the actual compact adapter.
 const ring=map.features.portals[0][0],portalMap=structuredClone(map);
 portalMap.spawns[0]={id:'portal-approach',surface:ring.surface,x:ring.x-Math.sin(ring.angle)*4,y:ring.y,z:ring.z-Math.cos(ring.angle)*4,angle:ring.angle};
 const portalAdapter=ADAPTER.createElevatedKartAdapter({RAPIER:R,config:C,maps:{...maps,[id]:portalMap},defaults:{}});
 clock=0;ctx.instanceId='portal-public-'+id;const portalState=portalAdapter.create(ctx);
 try{let warped=false;for(let i=0;i<600;i++){
   const s=portalAdapter.view(portalState,'a');if(s.phase==='live'&&i%6===0)portalAdapter.onAction(portalState,ctx,'a',{type:'input',seq:s.inputAck.receivedSeq+1,life:s.inputAck.life,controlEpoch:s.inputAck.controlEpoch,steer:0,throttle:.8,brake:0,nitro:false,use:false});
   clock+=1000/60;portalAdapter.onTick(portalState,ctx);const view=JSON.parse(JSON.stringify(portalAdapter.view(portalState,'a')));assert(!view.error,id+' portal projection stays live');
   const warp=view.events.find(e=>e.type==='warp');if(warp){
     assert.equal(warp.from.y,ring.y);assert.equal(warp.to.y,map.features.portals[0][1].y);assert(view.karts[0].portalCd>1.18&&view.karts[0].pose.epoch>0,id+' portal transports its cooldown and discontinuity');warped=true;break;
   }
  }assert(warped,id+' production input drives through a cross-level portal');
 }finally{portalAdapter.dispose(portalState);}

 const scene=new THREE.Scene(),world=createKartElevatedWorld(THREE,{scene,map}),art=createKartArenaFeatures(THREE,scene);art.sync(map);
 let draws=0,triangles=0;scene.traverseVisible(o=>{if(o.isMesh&&(!o.isInstancedMesh||o.count)){draws++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);}});
 assert(draws<=112&&triangles<=100000,id+' world plus feature art stays in phone geometry budget');
 for(const ring of map.features.portals[0])assert(scene.getObjectByName('arena-portal-0-'+map.features.portals[0].indexOf(ring)).position.y===ring.y,id+' portal art uses the right storey');
 const nodes=[];scene.traverse(o=>nodes.push(o));const portal=scene.getObjectByName('arena-portal-0-0'),before=portal.children[2].rotation.z;
 art.animate(.1,1,{},new Map());assert.notEqual(portal.children[2].rotation.z,before,id+' portal swirl is animated');const after=[];scene.traverse(o=>after.push(o));assert.deepEqual(after,nodes,id+' feature animation reuses all scene nodes');
 reports.push({id,cannons:map.features.cannons.length,portals:2,draws,triangles,maxPredictionError});art.dispose();world.dispose();assert.equal(scene.children.length,0);
}
console.log('PASS raised feature support, hull/arc/exit clearance, authority input, wrong-floor isolation, cooldowns, animated art and phone budgets');console.log(JSON.stringify(reports));
