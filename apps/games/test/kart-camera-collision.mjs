import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import config from '../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {classicStatics,createClassicMotion} from '../public/js/engines/kart-classic-motion.mjs';
import {createClassicPrediction} from '../public/js/engines/kart-classic-prediction.mjs';
import {createKartCameraCollision} from '../public/js/engines/kart-camera-collision.mjs';
import {createRoadTerrain} from '../public/js/engines/kart-road-terrain.mjs';
import {elevatedMap,elevatedMapIds} from '../public/js/engines/kart-elevated-maps.mjs';
import {cannonTube,CANNON_MOUTH_HEIGHT} from '../public/js/engines/kart-map-features.mjs';
import maps from '../games/engines/kart-maps.js';
await RAPIER.init();
const rotation={x:0,y:0,z:0,w:1},volume={x:.12,y:.12,z:.12},reports=[];let samples=0;
function oracle(solids){const w=createKartPhysics(RAPIER,config);for(const d of solids)w.addStatic(d);return w;}
function checkViews(label,solids,sites){
  const physics=oracle(solids),collision=createKartCameraCollision(THREE,solids),eye=new THREE.Vector3(),focus=new THREE.Vector3();let checked=0,blocked=0;
  for(const site of sites){
    focus.copy(site);if(physics.overlapsStatic(focus,rotation,{x:.24,y:.24,z:.24}))continue;
    for(let i=0;i<12;i++){
      const angle=i*Math.PI/6;eye.copy(focus);eye.x+=Math.sin(angle)*9;eye.z+=Math.cos(angle)*9;eye.y+=i%2?3.2:4.2;
      if(collision.constrain(eye,focus))blocked++;
      assert(!physics.overlapsStatic(eye,rotation,volume),label+' camera volume clears real Rapier solids at '+JSON.stringify({focus,eye}));
      const obstruction=physics.sweepStatic(focus,eye,0);
      assert(!obstruction||obstruction.fraction>.999,label+' eye stays on the kart side of the first solid');checked++;
    }
  }
  assert(checked>0&&blocked>0,label+' exercises clear and obstructed cameras');samples+=checked;
  reports.push({label,samples:checked,blocked});collision.dispose();physics.dispose();
}
for(const id of maps.mapIds()){
  const map={id,...maps.mapDef(id)},terrain=createRoadTerrain(map),solids=classicStatics(map,terrain),sites=[];
  for(const f of [...map.features.cannons,...map.features.portals.flat()])for(const u of [-5,-2,0,2,5])for(const v of [-6,-3,0,3,6]){
    const s=Math.sin(f.angle),c=Math.cos(f.angle),x=f.x+s*u+c*v,z=f.z+c*u-s*v;
    sites.push({x,y:terrain.heightAt(x,z)+.75,z});
  }
  for(const f of [...map.blocks,...map.barriers,...map.ramps])for(const sign of [-1,1])sites.push({x:f.x+sign*(f.hw+2),y:terrain.heightAt(f.x,f.z)+.75,z:f.z});
  checkViews('classic-'+id,solids,sites);
  const collision=createKartCameraCollision(THREE,solids);
  for(const c of map.features.cannons){
    const tube=cannonTube(c,terrain.heightAt),focus=new THREE.Vector3(c.x,tube.y0+CANNON_MOUTH_HEIGHT,c.z),eye=new THREE.Vector3(tube.muzzle.x,tube.muzzle.y,tube.muzzle.z);
    assert(!collision.constrain(eye,focus),'cannon bore stays genuinely open for camera and launch');
  }
  collision.dispose();
  // Side entry used to drive straight through the navy tube. Compare two
  // real Rapier worlds: authority and production client prediction.
  for(const c of map.features.cannons)for(const side of [-1,1]){
    const s=Math.sin(c.angle),co=Math.cos(c.angle),u=.8,v=side*4.2,angle=c.angle-side*Math.PI/2;
    const k={pid:'driver',x:c.x+s*u+co*v,z:c.z+co*u-s*v,angle,speed:0,nitro:1,spawnSeq:1,connected:true,input:{throttle:1,steer:0}};
    const state={...structuredClone(map),map:id,mode:'battle',karts:[k],physicalEvents:[],physicalEventSeq:0},world=createClassicMotion(RAPIER,config,state),prediction=createClassicPrediction(RAPIER);
    world.restore(k,{...k.physicalPose,linearVelocity:{x:Math.sin(angle)*18,y:0,z:Math.cos(angle)*18}});
    const snapshot={instanceId:id+'-side-'+side,phase:'drive',you:k.pid,youDrive:true,mode:'battle',map,karts:[structuredClone(k)],simAt:0,inputAck:{controlEpoch:1}};
    prediction.ingest(snapshot,0,0);let error=0;
    for(let i=1;i<=12;i++){
      world.advance(1/60,new Set([k.pid]));prediction.frame(snapshot,k.input,1/60,i*1000/60,i*1000/60);
      const predicted=prediction.selfPose();error=Math.max(error,Math.hypot(k.x-predicted.position.x,k.z-predicted.position.z));
      assert(!k.flight,'side walls never trigger a launch');
      const lateral=(k.x-c.x)*co-(k.z-c.z)*s;assert(lateral*side>2,'kart cannot pass through the tube side');
    }
    assert(error<.06,'authority and prediction share tube collision: '+error);world.dispose();prediction.dispose();
  }
}
for(const id of elevatedMapIds){
  const map=elevatedMap(id),sites=[];
  for(const d of map.colliders){
    const q=new THREE.Quaternion().copy(d.rotation||rotation),local=new THREE.Vector3();
    for(const sign of [-1,1])for(const axis of ['x','z']){
      local.set(0,0,0);local[axis]=sign*(d.half[axis]+2);local.applyQuaternion(q).add(d.position);local.y=Math.max(.75,d.position.y);sites.push(local.clone());
    }
    sites.push({x:d.position.x,y:d.position.y+d.half.y+.75,z:d.position.z});
  }
  checkViews('raised-'+id,map.colliders,sites);
}
// Final smoothing/shake is constrained too. A thin edge outside a centre ray
// still catches the near-plane sphere, and loading/frames add no Three objects.
{
  let allocations=0;const counted={...THREE};for(const n of ['Vector3','Box3','Ray','Triangle','Matrix4','Quaternion'])counted[n]=class extends THREE[n]{constructor(...args){super(...args);allocations++;}};
  const collision=createKartCameraCollision(counted,[{shape:'box',half:{x:.1,y:3,z:2},position:{x:0,y:2,z:0}}]);
  const focus=new THREE.Vector3(-2,1,0),eye=new THREE.Vector3(),prepared=allocations;
  for(let i=0;i<240;i++){eye.set(2,2+Math.sin(i)*.1,0);assert(collision.constrain(eye,focus));assert(eye.x<-.32);}
  assert.equal(allocations,prepared,'camera queries allocate no Three objects');collision.dispose();
}
console.log(JSON.stringify({pass:true,samples,reports,scope:'Camera volumes checked against independent real Rapier colliders on every map; tube side collisions in authority and prediction; open bores and allocation checks.'}));
