import {createKartPhysics} from './kart-physics-core.mjs';
import {createRoadTerrain} from './kart-road-terrain.mjs';

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
  for(const [i,s]of(map.surfaces||[]).entries())out.push({id:'grip-'+i,shape:'box',half:{x:s.hw,y:.01,z:s.hd},position:{x:s.x,y:-.005,z:s.z},grip:s.grip});
  for(const [i,b]of(map.blocks||[]).entries()){
    out.push({id:'cover-'+i,shape:'box',half:{x:b.hw,y:.75,z:b.hd},position:{x:b.x,y:.75,z:b.z}});
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
  for(const sign of[-1,1]){
    out.push({id:'wall-x-'+(sign+1),shape:'box',half:{x:wallHalf,y:wallHeightHalf,z:half+wallOffset+wallHalf},position:{x:sign*(half+wallOffset),y:wallHeightHalf,z:0}});
    out.push({id:'wall-z-'+(sign+1),shape:'box',half:{x:half+wallOffset+wallHalf,y:wallHeightHalf,z:wallHalf},position:{x:0,y:wallHeightHalf,z:sign*(half+wallOffset)}});
  }
  return out;
}

// Mode meters remain the existing rules: no physics-derived score or award.
export function classicControls(k,dt,map,battle){
  const input=k.input||{},throttle=input.throttle||0,steer=input.steer||0;
  if(!battle&&input.boost&&k.boostCd<=0&&k.boost<=0){k.boost=1.2;k.boostCd=6;}
  for(const key of['boost','boostCd','turbo','padCd'])k[key]=Math.max(0,(k[key]||0)-dt);
  k.nitro=clamp(k.nitro??1,0,1);
  if(k.nitroLocked){k.nitroActive=false;k.nitro=Math.min(1,k.nitro+.15*dt);if(k.nitro>=.3)k.nitroLocked=false;}
  else if(input.nitro&&throttle>0&&k.nitro>0){k.nitroActive=true;k.nitro=Math.max(0,k.nitro-.4*dt);if(k.nitro===0)k.nitroLocked=true;}
  else{k.nitroActive=false;k.nitro=Math.min(1,k.nitro+.15*dt);}
  const active=input.drift===true&&k.physicalPose?.grounded===true&&k.speed>6&&Math.abs(steer)>.15,was=k._driftHeld;
  if(active)k.driftCharge=Math.min(1,(k.driftCharge||0)+dt/.9);
  else{if(was&&k.driftCharge>=1&&!input.drift&&k.speed>6)k.turbo=Math.max(k.turbo,.9);k.driftCharge=0;}
  k._driftHeld=active;
  for(const pad of map.pads||[])if(Math.abs(k.x-pad.x)<=pad.hw&&Math.abs(k.z-pad.z)<=pad.hd&&k.padCd<=0&&k.speed>3){k.turbo=Math.max(k.turbo,1);k.padCd=3;break;}
  const engine=k.garage?1+.05*clamp(k.upgrades?.engine||0,0,3):1;
  const handling=k.garage?1+.04*clamp(k.upgrades?.handling||0,0,3):1;
  // Grip recovers from measured slip and opposite steering, rather than
  // rotating the chassis or granting velocity during a slide.
  const recovery=steer*(k.physicalPose?.angularVelocity.y||0)>.2?1:clamp((Math.abs(k.slip||0)-1.4)/1.5,0,1);
  const boost=Math.max(k.boost>0?1.6:1,k.turbo>0?1.35:1,k.nitroActive?1.6:1),slow=k.empT>0;
  return {intent:{throttle,steer,brake:0},tuning:{top:engine*boost*(slow?.62:1),engine:Math.min(2,engine*(boost>1?1.6:1)*(slow?.6:1)),steering:handling*(active?1.05:1)*(slow?.75:1),traction:1,rearTraction:active?.25+.75*recovery:(k.physicalPose?.grounded&&Math.abs(steer)>.55&&k.speed>12?.82:1),rearStiffness:active?.7+.3*recovery:1}};
}

export function createClassicMotion(RAPIER,baseConfig,state){
  const config=structuredClone(baseConfig);config.softCcdPrediction=.7;config.handling.maxForward=20;config.handling.engineForce=840;
  // Keep a released/respawned kart parked on real slopes using wheel brakes.
  config.handling.coastBrake=4;
  const physics=createKartPhysics(RAPIER,config),life=new Map(),enabled=new Map();let accumulator=0,disposed=false;
  const map={id:state.map,half:state.half,blocks:state.blocks,pads:state.pads,surfaces:state.surfaces};
  const terrain=createRoadTerrain(map);
  for(const item of classicStatics(map,terrain))physics.addStatic(item);
  for(const k of state.karts){physics.addKart(k.pid,spawn(k,terrain));life.set(k.pid,k.spawnSeq||0);enabled.set(k.pid,true);}
  // Settle before readiness, not on the first playable frame.
  physics.step(6);
  function project(k){const p=physics.pose(k.pid);k.physicalPose=p;k.x=p.position.x;k.z=p.position.z;k.angle=yaw(p.rotation);k.speed=p.speed;const right={x:-Math.cos(k.angle),z:Math.sin(k.angle)};k.slip=p.linearVelocity.x*right.x+p.linearVelocity.z*right.z;k.drifting=p.grounded&&Math.abs(k.slip)>.8&&Math.abs(k.speed)>6;}
  for(const k of state.karts)project(k);
  function sync(connected){for(const k of state.karts){
    const current=k.spawnSeq||0;
    if(life.get(k.pid)!==current){physics.resetKart(k.pid,spawn(k,terrain));life.set(k.pid,current);project(k);}
    const live=connected.has(k.pid)&&!(k.respawn>0);
    if(enabled.get(k.pid)!==live){physics.setKartEnabled(k.pid,live);enabled.set(k.pid,live);project(k);}
  }}
  return {
    advance(dt,connected){if(disposed)throw Error('classic world disposed');sync(connected);accumulator=Math.min(.25,accumulator+dt);const contacts=new Map();
      while(accumulator>=config.fixedDt-1e-9){
        for(const k of state.karts)if(enabled.get(k.pid)){const control=classicControls(k,config.fixedDt,map,state.mode==='battle');physics.tuneKart(k.pid,control.tuning);physics.applyIntent(k.pid,control.intent);k._appliedSeq=k._receivedSeq||0;}
        physics.step();for(const k of state.karts)project(k);accumulator-=config.fixedDt;
        for(const ids of physics.kartContacts())contacts.set(ids.join('|'),ids.map(id=>state.karts.find(k=>k.pid===id)));
        for(const impact of physics.drainImpacts()){
          state.physicalEvents.push({...impact,id:'physical-'+physics.stats().tick+'-'+state.physicalEventSeq++,kind:'contact'});while(state.physicalEvents.length>24)state.physicalEvents.shift();
        }
      }
      return contacts;
    },
    sync,disconnect(pid){physics.setKartEnabled(pid,false);enabled.set(pid,false);const k=state.karts.find(k=>k.pid===pid);if(k)project(k);},
    beginCorrection(){accumulator=0;},
    restore(k,p){if(physics.pose(k.pid).epoch!==p.epoch)physics.resetKart(k.pid,{position:p.position,rotation:p.rotation});physics.restoreKart(k.pid,p);life.set(k.pid,k.spawnSeq||0);project(k);},
    sweepStatic:(from,to,radius)=>physics.sweepStatic(from,to,radius),
    supportAt:(origin,maxDistance)=>physics.supportAt(origin,maxDistance),
    groundAt:(x,z)=>terrain?.heightAt(x,z)||0,
    overlapsStatic:(position,rotation)=>physics.overlapsStatic(position,rotation),
    isOutOfBounds:pose=>Math.max(Math.abs(pose.position.x),Math.abs(pose.position.z))>map.half+wallOffset+wallHalf||pose.position.y< -3,
    stats:()=>physics.stats(),dispose(){if(!disposed){physics.dispose();disposed=true;}},
  };
}
