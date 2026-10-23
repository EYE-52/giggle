// Actual classic production render loop, public rounded packets, loaded/fallback
// meshes and initialized Rapier surfaces. Geometry/authority QA, no GPU claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from '../public/vendor/three/libs/meshopt_decoder.mjs';
import {createKartCombatArt,projectileContactInset} from '../public/js/engines/kart-combat-art.mjs';
import {projectilePose} from '../public/js/engines/kart-flight.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {classicStatics} from '../public/js/engines/kart-classic-motion.mjs';
import {createRoadTerrain} from '../public/js/engines/kart-road-terrain.mjs';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import maps from '../games/engines/kart-maps.js';
import battle from '../games/engines/kart-rules-battle.js';
import combatConfig from '../games/engines/kart-combat-config.js';
await Promise.all([RAPIER.init(),MeshoptDecoder.ready]);
globalThis.self=globalThis;
globalThis.createImageBitmap=async blob=>{const b=Buffer.from(await blob.arrayBuffer());return{width:b.readUInt32BE(16),height:b.readUInt32BE(20),close(){}};};
const libs={};
for(const[key,file]of Object.entries({combat:'combat',pulse:'pulse-mounted',arsenal:'arsenal-mounted',secondary:'arsenal-secondary'})){
 const b=fs.readFileSync(new URL('../public/assets/karts/combat/'+file+'.meshopt.glb',import.meta.url));
 libs[key]=(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;
}
const get=name=>libs.pulse.getObjectByName(name)||libs.arsenal.getObjectByName(name)||(name!=='ScatterShot'&&libs.secondary.getObjectByName(name))||libs.combat.getObjectByName(name);
const source=fs.readFileSync(new URL('../public/js/engines/kart-view.js',import.meta.url),'utf8');
const preparation=source.slice(source.indexOf('function prepareShotContact('),source.indexOf('const cueBounds='));
const placement=source.slice(source.indexOf('const liveZ = new Set();'),source.indexOf('for (const [zid, mesh] of zaps)'));
assert(preparation.includes('projectileContactInset')&&placement.includes('radius-(c.tipZ||0)-c.contactInset'));
const radii=combatConfig.config.staticSweepRadii,kinds=['pulse','scatter','rocket','rail'],point=new THREE.Vector3(),results=[],measurements=[];
const check=(ok,label)=>{assert.ok(ok,label);results.push(label);};
function packet(raw){return battle.viewExtra({zaps:[raw],crates:[],mines:[],grenades:[],events:[]}).zaps[0];}
function vertices(object,visit){object.updateWorldMatrix(true,true);object.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++)visit(point.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld),o);});}
const sites={ring:[-17.5,-20.5],blocks:[-5.5,-20.5],garden:[-52,-52],frost:[-50.5,-52],neon:[-47.5,-52]};
for(const[tag,assets]of[['shipping',{get}],['fallback',null]]){
 const art=createKartCombatArt(THREE,{assets});
 try{for(const mapId of maps.mapIds()){
  const map={id:mapId,...maps.mapDef(mapId)},terrain=createRoadTerrain(map),physics=createKartPhysics(RAPIER,CONFIG);
  for(const d of classicStatics(map,terrain))physics.addStatic(d);
  try{for(const kind of kinds){
   const shot=art.projectile(kind),radius=radii[kind],buffers=[];shot.traverse(o=>{if(o.isMesh)buffers.push(o.geometry.attributes.position.array);});
   let calibrations=0;
   const context=vm.createContext({THREE,shotContactInsets:new Map(),projectileContactInset:(...args)=>{calibrations++;return projectileContactInset(...args);},zaps:new Map([['a',shot]]),shotPools:new Map(),combat:art,scene:new THREE.Scene(),projectilePose,serverNow:()=>1000,shotDirection:new THREE.Vector3(),shotForward:new THREE.Vector3(0,0,1),tmpV:new THREE.Vector3(),dt:1/60,t:0,rm:false});
   vm.runInContext(preparation+';globalThis.prepare=prepareShotContact;globalThis.render=function(){'+placement+'};',context);
   context.prepare(shot,kind,radius);assert.equal(calibrations,1);
   const face=map.half+.05,[x,z]=sites[mapId],height=terrain.heightAt(x,z);
   const dx=(terrain.heightAt(x+.03,z)-terrain.heightAt(x-.03,z))/.06,dz=(terrain.heightAt(x,z+.03)-terrain.heightAt(x,z-.03))/.06;
   const wallDirection=new THREE.Vector3(Math.sin(.12),.02,Math.cos(.12)).normalize(),floorDirection=new THREE.Vector3(dz,-.01,-dx).normalize();
   const paths=[{name:'oblique wall',from:{x:face-2,y:1.2,z:-5},to:{x:face+1,y:1.2,z:-5},retreat:new THREE.Vector3(-1,0,0),direction:wallDirection,surface:null},
    {name:'grazing hillside',from:{x,y:height+2,z},to:{x,y:height-1,z},retreat:new THREE.Vector3(0,1,0),direction:floorDirection,surface:'floor'}];
   for(const path of paths){
    const hit=physics.sweepStatic(path.from,path.to,radius);assert(hit);if(path.surface)assert.equal(hit.surfaceId,path.surface);
    const centre=new THREE.Vector3().copy(hit.point).addScaledVector(path.retreat,.00001),raw={id:'a',owner:'a',physical:true,kind,radius,x:centre.x,y:centre.y,z:centre.z,angle:0,vx:path.direction.x*85,vy:path.direction.y*85,vz:path.direction.z*85,ttl:1};
    assert.equal(physics.sweepStatic(path.from,centre,radius),null);
    const publicShot=packet(raw);assert.equal(publicShot.radius,radius);
    check(Math.hypot(publicShot.x-raw.x,publicShot.y-raw.y,publicShot.z-raw.z)<=Math.sqrt(3)*.0005+1e-10,tag+' '+mapId+' '+kind+' '+path.name+' actual public xyz rounds to 3 decimals');
    let penetration=-Infinity;
    for(const rm of[false,true])for(const time of[0,.47,1.3]){
     context.S={zaps:[publicShot],combat:combatConfig.config,simAt:1000};context.rm=rm;context.t=time;context.render();
     vertices(shot,p=>{if(path.name==='oblique wall')penetration=Math.max(penetration,p.x-face);else{const support=physics.supportAt({x:p.x,y:64,z:p.z},128);if(support?.surfaceId==='floor')penetration=Math.max(penetration,support.point.y-p.y);}});
    }
    check(penetration<0,tag+' '+mapId+' '+kind+' '+path.name+' full animated model avoids actual solid: '+penetration);
    measurements.push({tag,map:mapId,kind,path:path.name,clearance:-penetration});
   }
   check(calibrations===1,tag+' '+mapId+' '+kind+' stationary render reuses readiness calibration');
   const after=[];shot.traverse(o=>{if(o.isMesh)after.push(o.geometry.attributes.position.array);});assert.deepEqual(after,buffers);for(let i=0;i<after.length;i++)assert.strictEqual(after[i],buffers[i]);
   const legacy=packet({id:'a',kind,physical:true,x:2,y:3,z:4,vx:0,vy:0,vz:85,angle:0,ttl:1,radius:0});delete legacy.radius;context.S={zaps:[legacy],simAt:1000};context.render();shot.updateWorldMatrix(true,true);
   const nose=shot.localToWorld(new THREE.Vector3(0,0,shot.userData.combat.tipZ));check(nose.distanceTo(new THREE.Vector3(2,3,4))<1e-6,tag+' '+mapId+' '+kind+' missing/zero radius retains point nose contract');
  }}finally{physics.dispose();}
 }}finally{art.dispose();}
}
// Keep the old failure as a regression witness, using actual body geometry.
const art=createKartCombatArt(THREE,{assets:{get}}),rocket=art.projectile('rocket'),map={id:'ring',...maps.mapDef('ring')},physics=createKartPhysics(RAPIER,CONFIG);
for(const d of classicStatics(map))physics.addStatic(d);
try{const face=map.half+.05,tip=new THREE.Vector3(face-.005,1.2,-5),direction=new THREE.Vector3(Math.sin(.12),0,Math.cos(.12));rocket.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),direction);rocket.position.copy(tip).addScaledVector(direction,-rocket.userData.combat.tipZ);
 assert.equal(physics.sweepStatic(tip.clone().addScaledVector(direction,-.5),tip),null);let penetration=-Infinity;vertices(rocket,(p,o)=>{if(o!==rocket.userData.combat.tail&&physics.overlapsStatic(p,{x:0,y:0,z:0,w:1},{x:.00001,y:.00001,z:.00001}))penetration=Math.max(penetration,p.x-face);});check(penetration>.13,'original point-sweep failure remains independently reproduced by actual Rocket body');
}finally{physics.dispose();art.dispose();}
console.log(JSON.stringify({pass:true,checks:results.length,measurements,scope:'Production classic placement and actual rounded public packets; shipping/fallback whole meshes including animated tracers, real Rapier walls/hills on all five maps. No native/GPU/FPS claim.'}));
