import {createKartPhysics} from './kart-physics-core.mjs';
import {createRoadTerrain} from './kart-road-terrain.mjs';
import {createSurfaceIndex,surfaceTuning} from './kart-surface.mjs';
import {createFeatureRunner} from './kart-map-features.mjs';
import {arenaFeatureSolids} from './kart-feature-solids.mjs';
import {stepDrift} from './kart-drift.mjs';
import {CLASSIC_CONTACT_TUNING} from './kart-physics-config.mjs';

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const yaw=q=>Math.atan2(2*(q.x*q.z+q.w*q.y),1-2*(q.x*q.x+q.y*q.y));
const wallHalf=.5,wallOffset=.55;
const spawn=(k,terrain)=>({position:{x:k.x,y:.75+(terrain?.heightAt(k.x,k.z)||0),z:k.z},rotation:{x:0,y:Math.sin(k.angle/2),z:0,w:Math.cos(k.angle/2)}});

// Preserve authored placements while every classic arena uses its shared road.
// These descriptors are also consumed by the browser prediction world.
export function classicStatics(map,terrain=createRoadTerrain(map)){
  const half=map.half,wallHeightHalf=(terrain?.wallHeight||1.48)/2;
  const out=[terrain?{id:'floor',shape:'trimesh',vertices:terrain.vertices,indices:terrain.indices,position:{x:0,y:0,z:0}}:
    {id:'floor',shape:'box',half:{x:half+2,y:.5,z:half+2},position:{x:0,y:-.5,z:0}}];
  // Surface grip is sampled once from map data, never multiplied again by
  // the hidden patch collider (which used to square ice's grip).
  for(const [i,s]of(map.surfaces||[]).entries())out.push({id:'grip-'+i,shape:'box',half:{x:s.hw,y:.01,z:s.hd},position:{x:s.x,y:-.005,z:s.z},grip:1});
  for(const [i,b]of(map.blocks||[]).entries()){
    out.push({id:'cover-'+i,shape:'box',half:{x:b.hw,y:.75,z:b.hd},position:{x:b.x,y:.75,z:b.z}});
    // Authored landmark parts travel in the same snapshot as their hull.
    // Water is paint; every stone fountain part is a real finite collider.
    for(const [j,p]of(b.pieces||[]).entries())if(p.material!=='water')out.push({
      id:'cover-piece-'+i+'-'+j,shape:'box',half:{x:p.w/2,y:p.h/2,z:p.d/2},position:{x:b.x,y:p.y,z:b.z},
    });
    const minDim=Math.min(b.hw,b.hd)*2;
    if(map.id==='ring'||map.id==='blocks'){
      const fit=Math.max(.3,Math.min(1,(b.hw*2-.6)/1.72,(b.hd*2-.6)/1.72));
      out.push({id:'cover-top-'+i,shape:'box',half:{x:.84*fit,y:.43*fit,z:.84*fit},position:{x:b.x,y:1.5+.43*fit,z:b.z}});
    }else if(map.id==='neon'&&minDim>=1.4){
      const size=Math.min(minDim*.55,2.6);
      out.push({id:'cover-top-'+i,shape:'box',half:{x:size/2,y:.45,z:size/2},position:{x:b.x,y:1.95,z:b.z}});
    }else if(map.id==='frost'&&minDim>=1.6){
      const height=Math.min(minDim*.9,3.2),foot=Math.min(minDim*.9,4);
      out.push({id:'cover-top-'+i,shape:'box',half:{x:foot/2,y:height/2,z:foot/2},position:{x:b.x,y:1.5+height/2,z:b.z}});
    }
  }
  for(const [i,b]of(map.barriers||[]).entries())out.push({id:'barrier-'+i,shape:'box',half:{x:b.hw,y:.45,z:b.hd},position:{x:b.x,y:.45,z:b.z}});
  for(const [i,r]of(map.ramps||[]).entries())out.push({id:'ramp-'+i,shape:'wedge',half:{x:r.hw,y:r.h/2,z:r.hl},position:{x:r.x,y:r.h/2,z:r.z},rotation:{x:0,y:Math.sin(r.angle/2),z:0,w:Math.cos(r.angle/2)}});
  for(const sign of[-1,1]){
    out.push({id:'wall-x-'+(sign+1),shape:'box',half:{x:wallHalf,y:wallHeightHalf,z:half+wallOffset+wallHalf},position:{x:sign*(half+wallOffset),y:wallHeightHalf,z:0}});
    out.push({id:'wall-z-'+(sign+1),shape:'box',half:{x:half+wallOffset+wallHalf,y:wallHeightHalf,z:wallHalf},position:{x:0,y:wallHeightHalf,z:sign*(half+wallOffset)}});
  }
  out.push(...arenaFeatureSolids(map.features,(x,z)=>terrain?.heightAt(x,z)||0));
  return out;
}

// Mode meters remain the existing rules: no physics-derived score or award.
export function classicControls(k,dt,map,battle,surfaceIndex){
  const input=k.input||{},throttle=input.throttle||0,steer=input.steer||0;
  if(!battle&&input.boost&&k.boostCd<=0&&k.boost<=0){k.boost=1.2;k.boostCd=6;}
  for(const key of['boost','boostCd','turbo','padCd'])k[key]=Math.max(0,(k[key]||0)-dt);
  k.nitro=clamp(k.nitro??1,0,1);
  if(k.nitroLocked){k.nitroActive=false;k.nitro=Math.min(1,k.nitro+.15*dt);if(k.nitro>=.3)k.nitroLocked=false;}
  else if(input.nitro&&throttle>0&&k.nitro>0){k.nitroActive=true;k.nitro=Math.max(0,k.nitro-.4*dt);if(k.nitro===0)k.nitroLocked=true;}
  else{k.nitroActive=false;k.nitro=Math.min(1,k.nitro+.15*dt);}
  const surface=surfaceIndex?surfaceTuning(surfaceIndex,k.x,k.z):null;
  k.surface=surface?.kind||'road';k.grip=surface?.traction??1;
  const active=stepDrift(k,dt,k.physicalPose?.grounded===true&&!(k.spinT>0),surface?.driftEase??1);
  for(const pad of map.pads||[])if(Math.abs(k.x-pad.x)<=pad.hw&&Math.abs(k.z-pad.z)<=pad.hd&&k.padCd<=0&&k.speed>3){k.turbo=Math.max(k.turbo,1);k.padCd=3;break;}
  const engine=k.garage?1+.05*clamp(k.upgrades?.engine||0,0,3):1;
  const handling=k.garage?1+.04*clamp(k.upgrades?.handling||0,0,3):1;
  const boost=Math.max(k.boost>0?1.6:1,k.turbo>0?1.35:1,k.nitroActive?1.6:1,k.rammingT>0?1.5:1);
  // Weapon status: Frost caps top speed, an Oil Slick strips rear grip.
  const frost=k.frostT>0?.55:1,spun=k.spinT>0;
  const top=k.physicalPose?.grounded?(surface?.top??1):1,grip=k.physicalPose?.grounded?(surface?.traction??1):1;
  const tune=n=>clamp(n,.1,2);
  return {intent:{throttle,steer,brake:0},slide:{active:active&&!spun,direction:k.driftDirection||0,ease:surface?.driftEase??1,traction:grip},tuning:{top:tune(engine*boost*frost*top*(active?1.08:1)),engine:tune(Math.min(2,engine*(boost>1?1.6:active?1.12:1))*(frost<1?.7:1)*(.75+.25*top)),steering:handling,traction:grip,rearTraction:spun?.12:active?.55:(k.physicalPose?.grounded&&Math.abs(steer)>.55&&k.speed>12?.82:1),rearStiffness:spun?.2:active?.7:1}};
}

// Classic arenas' unboosted top speed (m/s); the gear readout shares it.
export const CLASSIC_MAX_FORWARD=20;

export function createClassicMotion(RAPIER,baseConfig,state){
  const config=structuredClone(baseConfig);config.softCcdPrediction=.7;config.handling.maxForward=CLASSIC_MAX_FORWARD;config.handling.engineForce=840;
  config.arcadeContacts=CLASSIC_CONTACT_TUNING;
  config.chassis.friction=CLASSIC_CONTACT_TUNING.friction;config.chassis.restitution=CLASSIC_CONTACT_TUNING.restitution;
  // Keep a released/respawned kart parked on real slopes using wheel brakes.
  config.handling.coastBrake=4;
  const physics=createKartPhysics(RAPIER,config),life=new Map(),enabled=new Map(),overturned=new Map();let accumulator=0,disposed=false;
  const recoveryPose={position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0,w:1}};
  const map={id:state.map,half:state.half,blocks:state.blocks,pads:state.pads,surfaces:state.surfaces,roads:state.roads,offroad:state.offroad,barriers:state.barriers,ramps:state.ramps,features:state.features};
  const surfaceIndex=createSurfaceIndex(map);
  const terrain=createRoadTerrain(map);
  // Arena features (cannons, portals) step after physics; see kart-map-features.mjs.
  const features=createFeatureRunner({physics,state,features:state.features,enabled,project:k=>project(k),groundAt:(x,z)=>terrain?.heightAt(x,z)||0});
  for(const item of classicStatics(map,terrain))physics.addStatic(item);
  for(const k of state.karts){physics.addKart(k.pid,spawn(k,terrain));life.set(k.pid,k.spawnSeq||0);enabled.set(k.pid,true);overturned.set(k.pid,0);}
  // Settle before readiness, not on the first playable frame.
  physics.step(6);
  function project(k){const p=physics.pose(k.pid);k.physicalPose=p;k.x=p.position.x;k.z=p.position.z;k.angle=yaw(p.rotation);k.speed=p.speed;const right={x:-Math.cos(k.angle),z:Math.sin(k.angle)};k.slip=p.linearVelocity.x*right.x+p.linearVelocity.z*right.z;k.drifting=p.grounded&&Math.abs(k.speed)>6&&(k._driftHeld===true||Math.abs(k.slip)>.8);}
  for(const k of state.karts)project(k);
  // A live flipped body is not a KO wreck. Classic maps lacked the raised
  // authority's stopped-overturn recovery, so it could remain on its roof
  // forever with its driver hidden below the road. Right it on the same
  // supported spot; health, inventory, score and life never change.
  function recoverOverturned(k){
    const p=k.physicalPose,q=p.rotation;
    if(!enabled.get(k.pid)||k.flight||1-2*(q.x*q.x+q.z*q.z)>=.35||
      Math.hypot(p.linearVelocity.x,p.linearVelocity.y,p.linearVelocity.z)>.5||
      Math.hypot(p.angularVelocity.x,p.angularVelocity.y,p.angularVelocity.z)>.5){overturned.set(k.pid,0);return;}
    const seconds=(overturned.get(k.pid)||0)+config.fixedDt;overturned.set(k.pid,seconds);
    if(seconds<2)return;
    // A blocked recovery retries at 4 Hz, not on every physics step.
    overturned.set(k.pid,1.75);
    const support=physics.supportAt(p.position,2.4);
    if(!support||support.normal.y<.65)return;
    const angle=yaw(q),{position,rotation}=recoveryPose;
    rotation.y=Math.sin(angle/2);rotation.w=Math.cos(angle/2);
    position.x=p.position.x;position.y=support.point.y+.75;position.z=p.position.z;
    // Never right through cover, a fence or another live chassis.
    if(physics.overlapsStatic(position,rotation))return;
    for(const other of state.karts)if(other!==k&&enabled.get(other.pid)&&
      Math.hypot(other.x-position.x,other.z-position.z)<3.5)return;
    physics.resetKart(k.pid,recoveryPose);overturned.set(k.pid,0);k._prevPose=null;project(k);
  }
  function sync(connected){for(const k of state.karts){
    const current=k.spawnSeq||0;
    if(life.get(k.pid)!==current){physics.resetKart(k.pid,spawn(k,terrain));k._driftHeld=false;k.driftCharge=0;k.driftDirection=0;k.driftHop=0;k.driftTier=0;life.set(k.pid,current);overturned.set(k.pid,0);project(k);}
    const live=connected.has(k.pid)&&!(k.respawn>0)&&!features.reconcile(k);
    if(enabled.get(k.pid)!==live){physics.setKartEnabled(k.pid,live);enabled.set(k.pid,live);project(k);}
  }}
  return {
    advance(dt,connected){if(disposed)throw Error('classic world disposed');sync(connected);accumulator=Math.min(.25,accumulator+dt);const contacts=new Map();
      while(accumulator>=config.fixedDt-1e-9){
        for(const k of state.karts)if(enabled.get(k.pid)){if(k.spinKick){physics.spinKart?.(k.pid,k.spinKick);k.spinKick=0;}const control=classicControls(k,config.fixedDt,map,state.mode==='battle',surfaceIndex);physics.tuneKart(k.pid,control.tuning);physics.applyIntent(k.pid,control.intent);physics.arcadeSlide(k.pid,control.slide);k._appliedSeq=k._receivedSeq||0;}
        for(const k of state.karts)k._prevPose=k.physicalPose;
        physics.step();for(const k of state.karts){project(k);recoverOverturned(k);}accumulator-=config.fixedDt;
        features.step(config.fixedDt,connected);
        for(const ids of physics.kartContacts())contacts.set(ids.join('|'),ids.map(id=>state.karts.find(k=>k.pid===id)));
        for(const impact of physics.drainImpacts()){
          state.physicalEvents.push({...impact,id:'physical-'+physics.stats().tick+'-'+state.physicalEventSeq++,kind:'contact'});while(state.physicalEvents.length>24)state.physicalEvents.shift();
        }
      }
      return contacts;
    },
    sync,disconnect(pid){physics.setKartEnabled(pid,false);enabled.set(pid,false);const k=state.karts.find(k=>k.pid===pid);if(k)project(k);},
    beginCorrection(){accumulator=0;},
    // Unsimulated fraction of the next fixed step: renderers blend
    // _prevPose -> physicalPose by it so motion is even at any frame rate.
    alpha:()=>Math.max(0,Math.min(1,accumulator/config.fixedDt)),
    // Elapsed time owed to the next physics tick. Keep the wire value small
    // and retain sub-millisecond precision for fixed-step input replay.
    poseLagUs:()=>Math.round(Math.max(0,accumulator)*1e6),
    restore(k,p){overturned.set(k.pid,0);k._prevPose=null;features.resumeLanded(k);if(physics.pose(k.pid).epoch!==p.epoch)physics.resetKart(k.pid,{position:p.position,rotation:p.rotation});physics.restoreKart(k.pid,p);life.set(k.pid,k.spawnSeq||0);project(k);},
    sweepStatic:(from,to,radius)=>physics.sweepStatic(from,to,radius),
    kickKart:(id,delta)=>physics.kickKart(id,delta),
    supportAt:(origin,maxDistance)=>physics.supportAt(origin,maxDistance),
    groundAt:(x,z)=>terrain?.heightAt(x,z)||0,
    overlapsStatic:(position,rotation)=>physics.overlapsStatic(position,rotation),
    isOutOfBounds:pose=>Math.max(Math.abs(pose.position.x),Math.abs(pose.position.z))>map.half+wallOffset+wallHalf||pose.position.y< -3,
    stats:()=>physics.stats(),dispose(){if(!disposed){physics.dispose();disposed=true;}},
  };
}
