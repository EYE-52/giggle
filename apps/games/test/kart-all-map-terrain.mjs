import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import config from '../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {createRoadTerrain} from '../public/js/engines/kart-road-terrain.mjs';
import {classicStatics,createClassicMotion} from '../public/js/engines/kart-classic-motion.mjs';
import {createClassicPrediction} from '../public/js/engines/kart-classic-prediction.mjs';
import maps from '../games/engines/kart-maps.js';

await RAPIER.init();
const metrics=[];
const kart=(x,z,angle=0)=>({pid:'driver',x,z,angle,input:{throttle:0,steer:0},nitro:1,spawnSeq:0,connected:true});
const stateFor=(map,karts)=>({map:map.id,mode:'battle',half:map.half,blocks:map.blocks,pads:map.pads,surfaces:map.surfaces,karts,physicalEvents:[],physicalEventSeq:0});
const online=new Set(['driver']);
for(const id of maps.mapIds()){
  const map={id,...maps.mapDef(id)},terrain=createRoadTerrain(map),v=terrain.vertices;
  assert.deepEqual(v,createRoadTerrain(map).vertices,id+' deterministic terrain');
  assert.ok(v.length/3<=10000&&terrain.indices.length<=60000,id+' bounded collider buffers');
  let maxHeight=0,maxSlope=0,peak,maxSupportError=0;
  for(let i=0;i<v.length;i+=3){
    assert.ok(Number.isFinite(v[i+1])&&v[i+1]>=0);
    if(v[i+1]>maxHeight){maxHeight=v[i+1];peak={x:v[i],z:v[i+2]};}
  }
  for(let i=0;i<terrain.indices.length;i+=3){
    const [a,b,c]=terrain.indices.subarray(i,i+3);
    const ux=v[b*3]-v[a*3],uy=v[b*3+1]-v[a*3+1],uz=v[b*3+2]-v[a*3+2];
    const vx=v[c*3]-v[a*3],vy=v[c*3+1]-v[a*3+1],vz=v[c*3+2]-v[a*3+2];
    const ny=uz*vx-ux*vz;
    assert.ok(ny>0,id+' upward winding');
    maxSlope=Math.max(maxSlope,Math.hypot(uy*vz-uz*vy,ux*vy-uy*vx)/ny);
  }
  assert.ok(maxHeight>(map.half===30?.5:3),id+' measurable drivable elevation');
  assert.ok(maxSlope<=.55,id+' triangle slope <= 28.9 degrees: '+maxSlope);
  for(const rect of [...map.blocks,...map.pads,...map.surfaces])
    for(let z=-rect.hd-1;z<=rect.hd+1;z+=.7)for(let x=-rect.hw-1;x<=rect.hw+1;x+=.7)
      assert.equal(terrain.heightAt(rect.x+x,rect.z+z),0,id+' preserved solid/pad/grip foundation');
  for(let p=-map.half;p<=map.half;p+=.7)
    for(const [x,z]of [[p,-map.half],[p,map.half],[-map.half,p],[map.half,p]])assert.equal(terrain.heightAt(x,z),0,id+' flat barrier foundation');

  const floorWorld=createKartPhysics(RAPIER,config);floorWorld.addStatic(classicStatics(map)[0]);
  try{
    for(let i=0;i<500;i++){
      const x=-map.half+1+(i*37.231%(2*map.half-2)),z=-map.half+1+(i*53.417%(2*map.half-2));
      const support=floorWorld.supportAt({x,y:15,z},20);
      const error=Math.abs(support.point.y-terrain.heightAt(x,z));maxSupportError=Math.max(maxSupportError,error);
      assert.ok(support.surfaceId==='floor'&&error<.000015,id+' exact triangle support');
    }
    for(const radius of [0,.45]){
      const hit=floorWorld.sweepStatic({...peak,y:15},{...peak,y:-5},radius);
      assert.equal(hit?.surfaceId,'floor',id+' fast swept projectile terrain contact');
      assert.ok(Math.abs(hit.point.y-(maxHeight+radius))<.00003,id+' sphere centre stops before entering peak');
    }
  }finally{floorWorld.dispose();}

  const parkedConfig=structuredClone(config);parkedConfig.handling.coastBrake=4;parkedConfig.handling.maxForward=20;
  const supportWorld=createKartPhysics(RAPIER,parkedConfig);
  for(const desc of classicStatics(map))supportWorld.addStatic(desc);
  let minSpawnWheels=4,minSpawnClearance=Infinity;
  try{
    for(const angle of [0,Math.PI/2,Math.PI,-Math.PI/2])for(const radius of [0,.45]){
      const s=Math.sin(angle),c=Math.cos(angle);
      const hit=supportWorld.sweepStatic({x:s*(map.half-5),y:1,z:c*(map.half-5)},
        {x:s*(map.half+5),y:1,z:c*(map.half+5)},radius);
      assert.ok(hit?.surfaceId.startsWith('wall-')&&hit.fraction>0&&hit.fraction<1,id+' exact fast boundary sweep');
      assert.ok(hit.normal.x*s+hit.normal.z*c<-.99,id+' inward-facing physical boundary contact');
    }
    for(const [i,b]of map.blocks.entries()){
      const hit=supportWorld.sweepStatic({x:b.x-b.hw-2,y:.75,z:b.z},{x:b.x+b.hw+2,y:.75,z:b.z},.25);
      assert.equal(hit?.surfaceId,'cover-'+i,id+' fast sphere collides with original cover footprint');
    }
    supportWorld.addKart('driver',{position:{x:0,y:.75,z:0}});
    for(const spawn of map.spawns){
      supportWorld.resetKart('driver',{position:{x:spawn.x,y:terrain.heightAt(spawn.x,spawn.z)+.75,z:spawn.z},rotation:{x:0,y:Math.sin(spawn.angle/2),z:0,w:Math.cos(spawn.angle/2)}});
      supportWorld.step(15);supportWorld.step(15);supportWorld.step(15);supportWorld.step(15);
      const pose=supportWorld.pose('driver'),wheels=pose.wheels.filter(w=>w.contact).length;
      minSpawnWheels=Math.min(minSpawnWheels,wheels);
      minSpawnClearance=Math.min(minSpawnClearance,pose.position.y-terrain.heightAt(pose.position.x,pose.position.z));
      assert.ok(wheels>=3&&pose.position.y>terrain.heightAt(pose.position.x,pose.position.z)+.45,id+' original spawn has real wheel support');
      assert.ok(Math.hypot(pose.position.x-spawn.x,pose.position.z-spawn.z)<1.5,id+' spawn does not slide into nearby cover');
    }
    for(const [x,z]of map.spots){
      const support=supportWorld.supportAt({x,y:terrain.heightAt(x,z)+1,z},2);
      assert.ok(support&&Math.abs(support.point.y-terrain.heightAt(x,z))<.01,id+' original pickup on reachable terrain');
      supportWorld.resetKart('driver',{position:{x,y:terrain.heightAt(x,z)+.75,z}});
      for(let i=0;i<60;i++)supportWorld.step();
      const p=supportWorld.pose('driver');
      assert.ok(p.wheels.filter(w=>w.contact).length>=2&&Math.hypot(p.position.x-x,p.position.z-z)<1.5,id+' pickup permits actual suspension support');
      supportWorld.applyIntent('driver',{throttle:1,steer:0});
      for(let i=0;i<45;i++)supportWorld.step();
      const moved=supportWorld.pose('driver');
      assert.ok(Math.hypot(moved.position.x-p.position.x,moved.position.z-p.position.z)>.5,id+' pickup socket allows legal driving away');
      assert.ok(moved.position.y>terrain.heightAt(moved.position.x,moved.position.z)+.4,id+' pickup departure does not sink into mesh');
    }
    // Ordinary-speed approaches contact every real boundary. Legitimate
    // boosted launches/recovery are exercised through the shipping engine.
    for(const angle of [0,Math.PI/2,Math.PI,-Math.PI/2]){
      supportWorld.resetKart('driver',{position:{x:0,y:.75,z:0},rotation:{x:0,y:Math.sin(angle/2),z:0,w:Math.cos(angle/2)}});
      supportWorld.applyIntent('driver',{throttle:1,steer:0});
      for(let i=0;i<360;i++){
        supportWorld.step();const p=supportWorld.pose('driver');
        assert.ok(Math.abs(p.position.x)<map.half&&Math.abs(p.position.z)<map.half,id+' ordinary chassis cannot tunnel through boundary');
      }
    }
  }finally{supportWorld.dispose();}

  const parkedDriver=kart(0,0),parkedMotion=createClassicMotion(RAPIER,config,stateFor(map,[parkedDriver]));
  let maxParkedSpawnDrift=0;
  try{
    for(const spawn of map.spawns){
      Object.assign(parkedDriver,spawn);parkedDriver.spawnSeq++;parkedMotion.sync(online);
      for(let i=0;i<60;i++)parkedMotion.advance(1/60,online);
      const drift=Math.hypot(parkedDriver.x-spawn.x,parkedDriver.z-spawn.z);
      maxParkedSpawnDrift=Math.max(maxParkedSpawnDrift,drift);
      assert.ok(drift<.5&&parkedDriver.physicalPose.grounded,id+' actual classic released spawn remains parked on slope');
    }
  }finally{parkedMotion.dispose();}

  if(map.blocks.length){
    const b=map.blocks[0],driver=kart(b.x,b.z-b.hd-8),motion=createClassicMotion(RAPIER,config,stateFor(map,[driver]));
    try{
      driver.input={throttle:1,steer:0};
      for(let i=0;i<180;i++){
        motion.advance(1/60,online);
        assert.ok(driver.z<b.z-b.hd,id+' body never tunnels through cover');
      }
      const contactZ=driver.z;assert.ok(contactZ>b.z-b.hd-3,id+' body actually reaches original cover');
      driver.input={throttle:-1,steer:0};for(let i=0;i<120;i++)motion.advance(1/60,online);
      assert.ok(driver.z<contactZ-3&&driver.speed< -1,id+' reverse releases a kart pushing against cover');
    }finally{motion.dispose();}
  }

  const driving=[];
  const chassisHull=new RAPIER.Cuboid(config.chassis.half.x,config.chassis.half.y,config.chassis.half.z);
  const terrainHull=new RAPIER.TriMesh(terrain.vertices,terrain.indices),origin={x:0,y:0,z:0},identity={x:0,y:0,z:0,w:1};
  const submerged=chassisHull.contactShape({x:0,y:.1,z:0},identity,terrainHull,origin,identity,1);
  assert.ok(submerged&&submerged.distance<-.1,id+' terrain clearance oracle rejects a genuinely submerged chassis');
  for(const direction of [1,-1]){
    const target=id==='garden'?38:id==='neon'?40:0;
    const limit=map.half-3,driver=kart(target,-limit*direction,direction===1?0:Math.PI),state=stateFor(map,[driver]);
    const motion=createClassicMotion(RAPIER,config,state),prediction=createClassicPrediction(RAPIER);
    let maxRoadHeight=0,minCenterClearance=Infinity,minHullClearance=Infinity,worstHullSample,maxYStep=0,grounded=0,steps=0,descended=false,previousY=driver.physicalPose.position.y,maxPredictionError=0,sequence=0;
    const snapshot=()=>({instanceId:id+'-'+direction,phase:'drive',you:'driver',youDrive:true,mode:'battle',map,karts:[structuredClone(driver)],inputAck:{appliedInputSeq:sequence}});
    prediction.ingest(snapshot(),0);
    try{
      for(let i=0;i<1200&&driver.z*direction<limit;i++){
        const error=Math.atan2(Math.sin(driver.angle-(direction===1?0:Math.PI)),Math.cos(driver.angle-(direction===1?0:Math.PI)));
        driver.input={throttle:1,steer:Math.max(-1,Math.min(1,(driver.x-target)*.45*direction+error*1.8))};
        if(i%3===0){sequence++;driver._receivedSeq=sequence;prediction.sent(sequence);}
        motion.advance(1/60,online);
        if(i%3===0)prediction.ingest(snapshot(),i*1000/60);
        const draw=prediction.frame(snapshot(),driver.input,1/60,i*1000/60).physicalPose;
        const p=driver.physicalPose,h=terrain.heightAt(driver.x,driver.z);
        maxPredictionError=Math.max(maxPredictionError,Math.hypot(draw.position.x-p.position.x,draw.position.y-p.position.y,draw.position.z-p.position.z));
        minCenterClearance=Math.min(minCenterClearance,p.position.y-h);maxRoadHeight=Math.max(maxRoadHeight,h);
        // Suspension compression and chassis tilt change the centre's height
        // above a slope. Measure the actual oriented hull against the authored
        // mesh to detect sinking, rather than imposing a fixed ride height.
        const contact=chassisHull.contactShape(p.position,p.rotation,terrainHull,origin,identity,1);
        if(contact&&contact.distance<minHullClearance){
          minHullClearance=contact.distance;
          worstHullSample={step:i,position:{...p.position},rotation:{...p.rotation},centerClearance:p.position.y-h,grounded:p.grounded,
            wheelContacts:p.wheels.filter(w=>w.contact).length,suspensionLengths:p.wheels.map(w=>w.length)};
        }
        maxYStep=Math.max(maxYStep,Math.abs(p.position.y-previousY));previousY=p.position.y;
        grounded+=p.grounded;steps++;descended ||= maxRoadHeight>(map.half===30?.5:2)&&h<.1&&p.grounded;
        assert.ok(Object.values(p.position).every(Number.isFinite));
      }
      assert.ok(driver.z*direction>=limit&&maxRoadHeight>(map.half===30?.5:2)&&descended,id+' climbs, descends and finishes '+direction);
      assert.ok(Number.isFinite(minHullClearance)&&minHullClearance>0,id+' '+direction+' oriented chassis stays above terrain: '+minHullClearance);
      assert.ok(maxYStep<.3&&grounded/steps>.7,id+' '+direction+' continuous wheel support without steps: '+JSON.stringify({maxYStep,groundedFraction:grounded/steps}));
      assert.ok(maxPredictionError<.7,id+' authority and prediction share exact relief: '+maxPredictionError);
      driver.x=peak.x;driver.z=peak.z;driver.spawnSeq++;motion.sync(online);
      assert.ok(Math.abs(driver.physicalPose.position.y-(maxHeight+.75))<.00001,id+' respawn supports real terrain');
      driving.push({direction,maxRoadHeight,minCenterClearance,minHullClearance,worstHullSample,maxYStep,groundedFraction:grounded/steps,maxPredictionError,steps});
    }finally{prediction.dispose();motion.dispose();}
  }
  const budgetWorld=createKartPhysics(RAPIER,parkedConfig),samples=[];
  for(const desc of classicStatics(map))budgetWorld.addStatic(desc);
  try{
    for(let i=0;i<8;i++){
      const spawn=map.spawns[i];budgetWorld.addKart('p'+i,{position:{x:spawn.x,y:terrain.heightAt(spawn.x,spawn.z)+.75,z:spawn.z},
        rotation:{x:0,y:Math.sin(spawn.angle/2),z:0,w:Math.cos(spawn.angle/2)}});
      budgetWorld.applyIntent('p'+i,{throttle:1,steer:(i%2?1:-1)*.3});
    }
    for(let i=0;i<360;i++){const start=performance.now();budgetWorld.step();samples.push(performance.now()-start);}
    assert.ok(budgetWorld.poses().every(p=>Object.values(p.position).every(Number.isFinite)),id+' eight actual controllers remain finite');
    samples.sort((a,b)=>a-b);
    assert.ok(samples[Math.floor(samples.length*.95)]<16.67,id+' eight-driver CPU p95 fits a 60Hz step budget');
    assert.ok(budgetWorld.stats().statics<=config.maxStatics,id+' original statics fit bounded world');
  }finally{budgetWorld.dispose();}
  metrics.push({id,maxHeight,maxSlope,maxSupportError,minSpawnWheels,minSpawnClearance,maxParkedSpawnDrift,vertices:v.length/3,triangles:terrain.indices.length/3,
    eightKartStepP95Ms:samples[Math.floor(samples.length*.95)],driving});
}
console.log(JSON.stringify({pass:true,scope:'actual Rapier all-map meshes, driving, spawn support, sweeps, boundaries and prediction',metrics},null,2));
