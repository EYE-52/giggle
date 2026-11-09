// User screenshots: actual Three geometry, production renderer frames, and
// real Rapier bodies. Pixel/Chrome acceptance is a separate browser run.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import R from '@dimforge/rapier3d-compat';
import {createKartCombatArt} from '../public/js/engines/kart-combat-art.mjs';
import {createKartWorld} from '../public/js/engines/kart-world.mjs';
import {createClassicMotion} from '../public/js/engines/kart-classic-motion.mjs';
import C from '../public/js/engines/kart-physics-config.mjs';
import maps from '../games/engines/kart-maps.js';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {rig,base} from './helpers/kart-view-fixture.mjs';
const metrics={tracers:[],confirmed:[],recovery:[],removedModels:[]},measure=process.argv.includes('--measure');
const check=(value,message)=>{if(!measure)assert(value,message);};
globalThis.self=globalThis;globalThis.createImageBitmap=async blob=>{const b=Buffer.from(await blob.arrayBuffer());return {width:b.readUInt32BE(16),height:b.readUInt32BE(20),close(){}};};
const art=createKartCombatArt(THREE);
// Run the classic frame's actual placement block with real borrowed geometry.
const classicSource=readFileSync(new URL('../public/js/engines/kart-view.js',import.meta.url),'utf8');
const cueStart=classicSource.indexOf('const from=e.from||e.position;'),cueEnd=classicSource.indexOf('\n            }\n          }\n          if(e.kind',cueStart);
assert(cueStart>0&&cueEnd>cueStart);
const placeCue=vm.runInNewContext('(e,cue,shotDirection,shotForward)=>{'+classicSource.slice(cueStart,cueEnd)+'}');
for(const kind of ['machinegun','trishot']){
 const shot=art.projectile(kind),tail=shot.userData.combat.tail;shot.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(tail),size=bounds.getSize(new THREE.Vector3());
 metrics.tracers.push({kind,shape:tail.geometry.type,color:tail.material.color.getHexString(),size:size.toArray()});
 check(size.z<.85&&Math.max(size.x,size.y)<.1,kind+' live bullet streak is short and pencil thin');
 check(tail.geometry.type!=='BoxGeometry',kind+' tracer cannot look like an opaque rectangular slab');
 const same=art.projectile(kind).userData.combat.tail;assert.equal(same.geometry,tail.geometry);assert.equal(same.material,tail.material);
 const object=new THREE.Group(),mesh=tail.clone(false);mesh.position.set(0,0,0);object.add(mesh);
 const cue={object,length:size.z},e={from:{x:0,y:1,z:0},position:{x:0,y:1,z:18},at:1000,until:1400};
 placeCue(e,cue,new THREE.Vector3(),new THREE.Vector3(0,0,1));object.updateMatrixWorld(true);const accepted=new THREE.Box3().setFromObject(object);
 metrics.confirmed.push({kind,length:accepted.max.z-accepted.min.z,end:accepted.max.z,width:accepted.max.x-accepted.min.x});
 check(accepted.max.z-accepted.min.z<=1.250001&&accepted.max.x-accepted.min.x<.1,kind+' classic confirmed sweep stays short and thin');
 assert(Math.abs(accepted.max.z-18)<1e-6,'short streak still ends exactly at the accepted wall contact');
}
art.dispose();
const world=createKartWorld(THREE,{scene:new THREE.Scene(),map:{id:'neon',...maps.mapDef('neon')},palette:'Starlight'});
metrics.cityBlocks=world.group.getObjectByName('neon-city')?.count||0;check(metrics.cityBlocks===0,'painted harbor panorama has no duplicate opaque city box layer');world.dispose();
await R.init();
const online=new Set(['driver']);
for(const id of maps.mapIds())for(const angle of [Math.PI,Math.PI/2]){
 const map={id,...maps.mapDef(id)},k={pid:'driver',x:0,z:0,angle:0,speed:0,health:2,weapon:'trishot',ammo:2,hits:4,deaths:1,input:{steer:0,throttle:0},spawnSeq:1},state={...map,map:id,mode:'battle',karts:[k],physicalEvents:[],physicalEventSeq:0,featureEvents:[],featureEventSeq:0};
 const motion=createClassicMotion(R,C,state);motion.restore(k,{...k.physicalPose,position:{x:0,y:angle===Math.PI?.4:1.3,z:0},rotation:{x:0,y:0,z:Math.sin(angle/2),w:Math.cos(angle/2)},linearVelocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}});
 let uprightAt=null;
 for(let tick=0;tick<600;tick++){motion.advance(1/60,online);const p=k.physicalPose;if(uprightAt===null&&1-2*(p.rotation.x*p.rotation.x+p.rotation.z*p.rotation.z)>.9)uprightAt=(tick+1)/60;}
 metrics.recovery.push({id,roll:angle,up:1-2*(k.physicalPose.rotation.x**2+k.physicalPose.rotation.z**2),uprightAt,epoch:k.physicalPose.epoch});
 check(uprightAt!==null&&uprightAt<4,id+' stopped overturned kart rights itself in under four seconds');
 assert.deepEqual([k.health,k.weapon,k.ammo,k.hits,k.deaths,k.spawnSeq],[2,'trishot',2,4,1,1],'righting a live kart preserves health, payload, score and life');
 check(k.physicalPose.epoch===1,id+' recovery changes pose epoch exactly once');
 // A legitimate inverted jump has no support and must not be snapped upright.
 motion.restore(k,{...k.physicalPose,position:{x:0,y:20,z:0},rotation:{x:0,y:0,z:1,w:0},linearVelocity:{x:0,y:5,z:0},angularVelocity:{x:0,y:0,z:0}});const epoch=k.physicalPose.epoch;
 for(let tick=0;tick<20;tick++)motion.advance(1/60,online);assert.equal(k.physicalPose.epoch,epoch,'airborne inverted motion stays physical');motion.dispose();
}
{
 const map=maps.mapDef('ring'),karts=['driver','nearby'].map((pid,i)=>({pid,x:i*3.2,z:0,angle:0,speed:0,health:2,input:{steer:0,throttle:0},spawnSeq:1}));
 const state={...map,map:'ring',mode:'battle',karts,physicalEvents:[],physicalEventSeq:0,featureEvents:[],featureEventSeq:0},motion=createClassicMotion(R,C,state),k=karts[0],connected=new Set(karts.map(k=>k.pid));
 motion.restore(k,{...k.physicalPose,position:{x:0,y:.4,z:0},rotation:{x:0,y:0,z:1,w:0},linearVelocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}});
 for(let tick=0;tick<240;tick++)motion.advance(1/60,connected);
 assert.equal(k.physicalPose.epoch,0,'recovery waits rather than entering another live kart');
 connected.delete('nearby');for(let tick=0;tick<60;tick++)motion.advance(1/60,connected);
 check(k.physicalPose.epoch===1,'recovery retries when the nearby kart leaves');
 // A disabled KO body follows the existing respawn path, never live righting.
 k.respawn=3;motion.advance(1/60,connected);const epoch=k.physicalPose.epoch;
 for(let tick=0;tick<240;tick++)motion.advance(1/60,connected);
 assert.equal(k.physicalPose.epoch,epoch,'KO/disabled bodies are not auto-righted');motion.dispose();
}
for(const mapId of ['garden','frost','neon','harbor','skyport','foundry']){
 const r=rig({graphics:true}),s=base();s.mapId=mapId;s.mapRevision=elevatedMap(mapId).revision;
 for(const k of s.karts){k.spawnSeq=1;k.controlEpoch=1;}
 s.karts[1].weapon='trishot';s.karts[1].ammo=2;
 s.karts[1].pose.rotation={x:0,y:0,z:Math.SQRT1_2,w:Math.SQRT1_2};
 r.render(s);const gl=await r.settle();r.frame();const models=gl.built.scene.children.filter(o=>o.name==='GiggleKart'),victim=models[1];assert(victim.visible);
 const allocation=r.allocations(),weaponRig=victim.getObjectByName('Curatedtrishot');assert(weaponRig);
 // Missing authority records can arrive during a leave or roster change.
 const removed=structuredClone(s);removed.simTick++;removed.simAt+=50;removed.karts=removed.karts.slice(0,1);r.render(removed);r.frame();
 metrics.removedModels.push({mapId,visible:victim.visible});check(!victim.visible,mapId+' absent kart cannot leave a stale detailed model');
 check(weaponRig.parent===null,'absent kart returns its weapon rig to the pool');
 const returned=structuredClone(s);returned.simTick+=2;returned.simAt+=100;returned.karts[1].spawnSeq++;returned.karts[1].pose.rotation={x:0,y:0,z:0,w:1};
 r.render(returned);r.frame();assert(victim.visible&&victim.scale.x===1&&1-2*(victim.quaternion.x**2+victim.quaternion.z**2)>.9,'returned life reuses the upright full model');
 assert.equal(victim.getObjectByName('Curatedtrishot'),weaponRig,'returned driver reuses its prepared rig');assert.deepEqual(r.allocations(),allocation,'roster removal/reuse creates no graphics resources');
 returned.simTick++;returned.events=[{id:'long-wall-sweep',type:'impact',weapon:'trishot',pid:'b',from:{x:0,y:1,z:0},position:{x:0,y:1,z:18}}];r.render(returned);r.frame();
 const cue=gl.built.scene.children.find(o=>o.name==='CombatConfirmedShot'&&o.visible);assert(cue,'confirmed wall cue exists');const bounds=new THREE.Box3().setFromObject(cue);
 metrics.confirmed.push({mapId,length:bounds.max.z-bounds.min.z,end:bounds.max.z,width:bounds.max.x-bounds.min.x});
 check(bounds.max.z-bounds.min.z<=1.250001&&bounds.max.x-bounds.min.x<.1,mapId+' confirmed sweep stays short and thin');assert(Math.abs(bounds.max.z-18)<1e-6,'raised streak ends at accepted contact');
 r.advance(150);r.frame(.15);assert(!cue.visible,'raised confirmed cue expires within150ms');r.view.dispose();
}
console.log(JSON.stringify({pass:!measure,metrics,scope:'Real Three geometry/production frames and real shared classic Rapier motion; Chrome pixels are separate'}));
