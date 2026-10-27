import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import config from '../public/js/engines/kart-physics-config.mjs';
import * as THREE from 'three';
import {createKartWorld} from '../public/js/engines/kart-world.mjs';
import {createClassicMotion,classicStatics} from '../public/js/engines/kart-classic-motion.mjs';
import {createRoadTerrain} from '../public/js/engines/kart-road-terrain.mjs';
import maps from '../games/engines/kart-maps.js';
await RAPIER.init();
const kart=(pid,x,z,angle)=>({pid,x,z,angle,speed:0,boost:0,boostCd:0,turbo:0,padCd:0,nitro:1,input:{steer:0,throttle:1},spawnSeq:0,upgrades:{},garage:false});
const state=(id,karts)=>{const m=maps.mapDef(id);return{map:id,mode:'battle',half:m.half||30,blocks:m.blocks,pads:m.pads||[],surfaces:m.surfaces||[],karts,physicalEvents:[],physicalEventSeq:0};};
const metrics=[];
for(const id of['ring','blocks','garden','frost','neon']){
 const renderedMap={id,...maps.mapDef(id)},scene=new THREE.Scene(),rendered=createKartWorld(THREE,{scene,map:renderedMap});rendered.syncMap(renderedMap);rendered.group.updateMatrixWorld(true);
 const descriptors=classicStatics(renderedMap),wall=descriptors.find(d=>d.id==='wall-z-2');
 let kerb,rail;
 rendered.group.traverse(mesh=>{if(!mesh.isMesh)return;const box=new THREE.Box3().setFromObject(mesh),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
   if(Math.abs(center.z-(renderedMap.half+.55))<.001&&Math.abs(center.x)<.001&&size.x>renderedMap.half){if(Math.abs(center.y-.25)<.001)kerb=box;if(Math.abs(center.y-1.42)<.001)rail=box;}
 });
 assert.ok(kerb&&rail,'actual authored kerb and rail found');
 assert.ok(Math.abs(kerb.min.z-(wall.position.z-wall.half.z))<.0001,'actual visible inner kerb face matches physics');
 assert.ok(Math.abs(rail.max.y-1.48)<.0001,'low visible rail retained');
 const fence=rendered.group.getObjectByName(id+'-catch-fence'),fenceHeight=createRoadTerrain(renderedMap).wallHeight;
 assert.ok(fence&&Math.abs(new THREE.Box3().setFromObject(fence).max.y-fenceHeight)<.0001,'visible catch fence shares the physical envelope');
 assert.ok(Math.abs(wall.position.y+wall.half.y-fenceHeight)<.0001,'physical wall top matches catch fence');
 renderedMap.blocks.forEach((b,i)=>{
   const proxy=descriptors.find(d=>d.id==='cover-'+i);let base,cap;
   rendered.group.traverse(mesh=>{if(!mesh.isMesh)return;const box=new THREE.Box3().setFromObject(mesh),center=box.getCenter(new THREE.Vector3());if(Math.abs(center.x-b.x)<.001&&Math.abs(center.z-b.z)<.001){if(Math.abs(center.y-.65)<.001)base=box;if(Math.abs(center.y-1.4)<.001)cap=box;}});
   assert.ok(base&&cap,'authored base and cap retained');assert.ok(Math.abs(base.min.x-(proxy.position.x-proxy.half.x))<.0001&&Math.abs(base.max.z-(proxy.position.z+proxy.half.z))<.0001,'cover footprint matches authored base');
   assert.ok(Math.abs(cap.max.y-(proxy.position.y+proxy.half.y))<.0001,'solid cap cannot be shot through above proxy');
 });

 let s=state(id,[kart('a',0,(maps.mapDef(id).half||30)-10,0)]),w=createClassicMotion(RAPIER,config,s),online=new Set(['a']),impacts=0,maxZ=-Infinity,maxSpeed=0;
 for(let i=0;i<600;i++){w.advance(1/60,online);impacts+=s.physicalEvents.filter(e=>e.surfaceId?.startsWith('wall')).length;s.physicalEvents.length=0;maxZ=Math.max(maxZ,s.karts[0].z);maxSpeed=Math.max(maxSpeed,s.karts[0].speed);}
 assert.ok(maxZ+config.chassis.half.z<=s.half+.05+.02,id+' boundary penetration');assert.ok(impacts>0,id+' wall contact');assert.ok(maxSpeed>3,id+' drove');w.dispose();assert.equal(w.stats().disposed,true);
 s=state(id,[kart('a',-6,0,Math.PI/2),kart('b',6,0,-Math.PI/2)]);w=createClassicMotion(RAPIER,config,s);online=new Set(['a','b']);let minDistance=Infinity,contact=false,minHullGap=Infinity,peak;const hull=new RAPIER.Cuboid(config.chassis.half.x,config.chassis.half.y,config.chassis.half.z);
 for(let i=0;i<240;i++){w.advance(1/60,online);minDistance=Math.min(minDistance,Math.hypot(s.karts[0].x-s.karts[1].x,s.karts[0].z-s.karts[1].z));if(s.physicalEvents.some(e=>e.ids.length===2)){contact=true;assert.ok(s.physicalEvents.every(e=>Number.isFinite(e.impulse)&&e.position&&e.normal));}const [a,b]=s.karts.map(k=>k.physicalPose);const overlap=hull.contactShape(a.position,a.rotation,hull,b.position,b.rotation,.5);if(overlap&&overlap.distance<minHullGap){minHullGap=overlap.distance;peak={i,a,b};}s.physicalEvents.length=0;}
 assert.ok(contact,id+' kart contact');console.log(JSON.stringify({id,minHullGap,peak}));assert.ok(minHullGap>-.05,id+' physical hull penetration '+minHullGap);assert.ok(s.karts.every(k=>k.physicalPose.rotation&&k.physicalPose.angularVelocity&&k.physicalPose.linearVelocity));w.dispose();metrics.push({id,maxZ,maxSpeed,minDistance,minHullGap,contact});
}
console.log(JSON.stringify({pass:true,scope:'unit physics, not native acceptance',metrics},null,2));
