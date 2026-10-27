import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import config from '../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {createRoadTerrain} from '../public/js/engines/kart-road-terrain.mjs';
import {classicStatics,createClassicMotion} from '../public/js/engines/kart-classic-motion.mjs';
import {createClassicPrediction} from '../public/js/engines/kart-classic-prediction.mjs';
import maps from '../games/engines/kart-maps.js';

await RAPIER.init();
const map={id:'garden',...maps.mapDef('garden')},terrain=createRoadTerrain(map),v=terrain.vertices;
assert.deepEqual(v,createRoadTerrain(map).vertices,'terrain is deterministic across worlds');
assert.ok(v.length/3<=10000&&terrain.indices.length%3===0);
let maxHeight=0,maxSlope=0;
for(let i=1;i<v.length;i+=3){assert.ok(Number.isFinite(v[i])&&v[i]>=0);maxHeight=Math.max(maxHeight,v[i]);}
for(let i=0;i<terrain.indices.length;i+=3){
  const [a,b,c]=terrain.indices.subarray(i,i+3);
  const ux=v[b*3]-v[a*3],uy=v[b*3+1]-v[a*3+1],uz=v[b*3+2]-v[a*3+2];
  const vx=v[c*3]-v[a*3],vy=v[c*3+1]-v[a*3+1],vz=v[c*3+2]-v[a*3+2];
  const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
  assert.ok(ny>0,'upward triangle winding');maxSlope=Math.max(maxSlope,Math.hypot(nx,nz)/ny);
}
assert.ok(maxHeight>5&&maxHeight<7,'broad visible relief');
assert.ok(maxSlope<=.55,'all triangulated slopes remain drivable');
for(const rect of [...map.blocks,...map.pads,...map.surfaces,{x:0,z:0,hw:16,hd:16}]){
  for(let z=-rect.hd-1;z<=rect.hd+1;z+=.7)for(let x=-rect.hw-1;x<=rect.hw+1;x+=.7)
    assert.equal(terrain.heightAt(rect.x+x,rect.z+z),0,'existing footprint and short margin exactly flat');
}
for(let p=-60;p<=60;p+=.7)for(const [x,z]of [[p,-60],[p,60],[-60,p],[60,p]])assert.equal(terrain.heightAt(x,z),0);
for(const id of ['ring','blocks','frost','neon']){
  const other={id,...maps.mapDef(id)};assert.ok(createRoadTerrain(other));
  const floor=classicStatics(other)[0];assert.equal(floor.shape,'trimesh');assert.equal(floor.position.y,0);
}
assert.equal(createRoadTerrain({...map,half:19}),null);
assert.equal(createRoadTerrain({...map,id:'unknown'}),null);
assert.equal(createRoadTerrain({...map,id:'__proto__'}),null);
assert.equal(classicStatics({...map,id:'unknown'})[0].shape,'box','unsupported map retains safe flat floor');
const floor=classicStatics(map)[0];assert.equal(floor.shape,'trimesh');
assert.equal(classicStatics(map).filter(d=>d.shape==='trimesh').length,1,'one terrain collider');
const world=createKartPhysics(RAPIER,config);world.addStatic(floor);
let maxSupportError=0;
try{
  // Off-grid coordinates exercise both halves of each cell and the exact
  // Float32 triangle plane, including masks and raised routes.
  for(let i=0;i<800;i++){
    const x=-59+((i*37.231)%118),z=-59+((i*53.417)%118),height=terrain.heightAt(x,z);
    const support=world.supportAt({x,y:15,z},20);assert.equal(support?.surfaceId,'floor');
    const error=Math.abs(support.point.y-height);maxSupportError=Math.max(maxSupportError,error);
    assert.ok(error<.000015,'collider supports the exact sampled triangle');
  }
  const rocket=world.sweepStatic({x:38,y:3,z:-55},{x:38,y:3,z:-20});
  assert.equal(rocket?.surfaceId,'floor');assert.ok(rocket.point.y>2.9&&rocket.fraction>0&&rocket.fraction<1);
  const sphere=world.sweepStatic({x:38,y:10,z:-37},{x:38,y:0,z:-37},.45);
  assert.equal(sphere?.surfaceId,'floor');assert.ok(sphere.point.y>terrain.heightAt(38,-37)+.4,'sphere hits before its centre enters terrain');
  const triangle={id:'bad',shape:'trimesh',position:{x:0,y:0,z:0},vertices:new Float32Array([0,0,0,1,0,0,0,0,1]),indices:new Uint32Array([0,2,1])};
  for(const bad of [
    {...triangle,vertices:new Float32Array([0,0,0,1,NaN,0,0,0,1])},
    {...triangle,indices:new Uint32Array([0,3,1])},
    {...triangle,indices:new Uint32Array([0,0,1])},
    {...triangle,vertices:new Float32Array([0,0,0,1,0,0,2,0,0])},
    {...triangle,vertices:new Float32Array(30003)},
    {...triangle,vertices:new Float32Array([0,0,0,1001,0,0,0,0,1])},
    {...triangle,indices:[0,2,1]},
  ])assert.throws(()=>world.addStatic(bad));
  assert.equal(world.stats().statics,1,'malformed meshes cannot mutate world');
}finally{world.dispose();world.dispose();}
assert.throws(()=>world.supportAt({x:0,y:1,z:0}));assert.throws(()=>world.sweepStatic({x:0,y:1,z:0},{x:0,y:0,z:0}));

const driving=[];
for(const target of [-38,38,-46,46]){
  const k={pid:'driver',x:target,z:-52,angle:0,input:{steer:0,throttle:1},spawnSeq:0,nitro:1};
  const state={map:'garden',mode:'battle',half:60,blocks:map.blocks,pads:map.pads,surfaces:map.surfaces,karts:[k],physicalEvents:[],physicalEventSeq:0};
  const motion=createClassicMotion(RAPIER,config,state),online=new Set(['driver']);
  let minClearance=Infinity,maxRoadHeight=0,maxYStep=0,previousY=k.physicalPose.position.y,grounded=0,steps=0,descended=false;
  try{
    for(let i=0;i<900&&k.z<50;i++){
      // Legal steering keeps the straight line despite gravity across its
      // camber. Y and quaternion are always owned by the controller.
      k.input={throttle:1,steer:Math.max(-1,Math.min(1,(k.x-target)*.45+k.angle*1.8))};
      motion.advance(1/60,online);const p=k.physicalPose,h=terrain.heightAt(k.x,k.z);
      assert.ok(Object.values(p.position).every(Number.isFinite));
      minClearance=Math.min(minClearance,p.position.y-h);maxRoadHeight=Math.max(maxRoadHeight,h);
      maxYStep=Math.max(maxYStep,Math.abs(p.position.y-previousY));previousY=p.position.y;
      grounded+=p.grounded;steps++;descended ||= maxRoadHeight>2&&k.z>0&&h<.1&&p.grounded;
    }
    assert.ok(k.z>50&&maxRoadHeight>2&&descended,'ordinary driving climbs and descends both flank routes');
    assert.ok(minClearance>.45&&maxYStep<.25&&grounded/steps>.7,'suspension crosses triangles without sinking or steps');
    k.x=38;k.z=-37;k.angle=0;k.spawnSeq++;
    motion.sync(online);assert.ok(Math.abs(k.physicalPose.position.y-(terrain.heightAt(38,-37)+.75))<.000001,'respawn uses terrain elevation');
    assert.equal(motion.groundAt(38,-37),terrain.heightAt(38,-37));
    driving.push({target,maxRoadHeight,minClearance,maxYStep,groundedFraction:grounded/steps});
  }finally{motion.dispose();}
}
const driver={pid:'driver',x:38,z:-52,angle:0,speed:0,input:{steer:0,throttle:1},spawnSeq:0,nitro:1,connected:true};
const state={map:'garden',mode:'battle',half:60,blocks:map.blocks,pads:map.pads,surfaces:map.surfaces,karts:[driver],physicalEvents:[],physicalEventSeq:0};
const authority=createClassicMotion(RAPIER,config,state),prediction=createClassicPrediction(RAPIER),online=new Set(['driver']);
let seq=0,maxPredictionError=0,maxPredictedHeight=0;
const snapshot=()=>({instanceId:'terrain-prediction',phase:'drive',you:'driver',youDrive:true,mode:'battle',map,karts:[structuredClone(driver)],inputAck:{appliedInputSeq:seq}});
prediction.ingest(snapshot(),0);
try{
  for(let i=0;i<320;i++){
    if(i%3===0){seq++;driver._receivedSeq=seq;prediction.sent(seq);}
    authority.advance(1/60,online);
    if(i%3===0)prediction.ingest(snapshot(),i*1000/60);
    const draw=prediction.frame(snapshot(),driver.input,1/60,i*1000/60),p=draw.physicalPose.position;
    maxPredictionError=Math.max(maxPredictionError,Math.hypot(p.x-driver.x,p.y-driver.physicalPose.position.y,p.z-driver.z));
    maxPredictedHeight=Math.max(maxPredictedHeight,p.y);
    assert.ok(p.y>terrain.heightAt(p.x,p.z)+.4,'prediction cannot sink through raised terrain');
  }
  assert.ok(maxPredictionError<.6&&maxPredictedHeight>5,'Garden prediction follows real authority climb and descent');
}finally{prediction.dispose();authority.dispose();}
console.log(JSON.stringify({pass:true,maxHeight,maxSlope,maxSupportError,maxPredictionError,maxPredictedHeight,driving},null,2));
