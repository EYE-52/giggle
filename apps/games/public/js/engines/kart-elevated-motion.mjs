import CONFIG from './kart-physics-config.mjs';
/* One fixed-step motion path for raised authority and local prediction.
 * Weapons, scores and input receipt stay in the server. No render geometry. */
import {stepDrift} from './kart-drift.mjs';
import {surfaceProfile} from './kart-surface.mjs';
import {createFeatureRunner,RIDE_HEIGHT} from './kart-map-features.mjs';
import {applyElevatedBelts} from './kart-elevated-surfaces.mjs';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const ELEVATED_MOTION_FIELDS=Object.freeze(['drifting','driftCharge','driftDirection','driftTier','driftHop','turbo','surface','flight','cannonCd','portalCd','nitroLocked']);
export function clearElevatedDrift(k){
  k.drifting=false;k.driftCharge=0;k.driftDirection=0;k.driftTier=0;k.driftHop=0;k.turbo=0;k._driftHeld=false;
}
export function clearElevatedMotion(k){
  clearElevatedDrift(k);
  k.flight=null;k.cannonCd=0;k.portalCd=0;k.surface='road';k._restoredPose=null;
}
export function createElevatedMotion({physics,map,karts,emit}){
  const surfaces=new Map(map.colliders.map(d=>[d.id,d])),enabled=new Map();
  const state={karts},yaw=q=>Math.atan2(2*(q.x*q.z+q.w*q.y),1-2*(q.x*q.x+q.y*q.y));
  function project(k){
    const p=physics.pose(k.id);k.pid=k.id;k.physicalPose=p;k.x=p.position.x;k.z=p.position.z;k.angle=yaw(p.rotation);k.speed=p.speed;
    k.drifting=!!p.grounded&&!k.flight&&Math.abs(p.speed)>6&&k._driftHeld===true;
  }
  for(const k of karts){enabled.set(k.id,!k.flight);project(k);}
  function arrival(k,p){
    const position={x:p.x,y:p.y+RIDE_HEIGHT,z:p.z},rotation={x:0,y:Math.sin(p.angle/2),z:0,w:Math.cos(p.angle/2)};
    const s=physics.supportAt({...position,y:p.y+.4},.8);
    return !!s&&Math.abs(s.point.y-p.y)<.12&&!physics.overlapsStatic(position,rotation);
  }
  const runner=createFeatureRunner({physics,state,features:map.features,enabled,project,groundAt:()=>0,
    canEnter(k,f){const p=k.physicalPose,cannon=map.features?.cannons?.indexOf(f)??-1;return !!p.grounded&&Math.abs(p.position.y-f.y-RIDE_HEIGHT)<.65&&p.wheels.some(w=>w.contact&&(w.surfaceId===f.surface||cannon>=0&&w.surfaceId==='cannon-solid-'+cannon));},
    canArrive:arrival,onEvent(type,k,e){
      const position={...physics.pose(k.id).position};
      const extra={...e,position};
      if(type==='launch'){const land=map.features.cannons[e.cannon].land;extra.to={x:land.x,y:land.y,z:land.z};}
      if(type==='warp'){const pair=map.features.portals[e.pair];extra.from={x:pair[e.side].x,y:pair[e.side].y,z:pair[e.side].z};extra.to={x:pair[1-e.side].x,y:pair[1-e.side].y,z:pair[1-e.side].z};}
      emit?.(type,k.id,extra);
    }});
  function reset(k){
    clearElevatedMotion(k);runner.cancel(k);
    const live=k.alive!==false;
    physics.setKartEnabled(k.id,live);enabled.set(k.id,live);physics.arcadeSlide(k.id,null);
  }
  function controls(k,dt){
    const restored=k._restoredPose;project(k);if(restored){k.physicalPose=restored;k._restoredPose=null;}
    if(k.flight){physics.arcadeSlide(k.id,null);return;}
    if(enabled.get(k.id)!==true){physics.setKartEnabled(k.id,true);enabled.set(k.id,true);}
    const input=k.input||{},p=k.physicalPose,ground=p.wheels.find(w=>w.contact&&surfaces.has(w.surfaceId)),d=surfaces.get(ground?.surfaceId);
    const kind=d?.material==='ice'?'ice':d?.material==='snow'?'snow':d?.material==='slate'?'gravel':d?.material==='steel'?'metal':['concrete','stone','level-1','level-2','ramp'].includes(d?.material)?map.environment==='industrial'?'metal':'concrete':'road',s=surfaceProfile(kind);
    k.surface=kind;k.turbo=Math.max(0,(k.turbo||0)-dt);
    k.nitro=clamp(k.nitro??1,0,1);
    if(k.nitroLocked){k.nitroActive=false;k.nitro=Math.min(1,k.nitro+.15*dt);if(k.nitro>=.3)k.nitroLocked=false;}
    else if(input.nitro&&input.throttle>0&&k.nitro>0){k.nitroActive=true;k.nitro=Math.max(0,k.nitro-.4*dt);if(k.nitro<=0)k.nitroLocked=true;}
    else{k.nitroActive=false;k.nitro=Math.min(1,k.nitro+.15*dt);}
    const active=stepDrift(k,dt,p.grounded&&!(k.spinT>0),s.driftEase,{...input,drift:input.brake>.5});
    const boost=Math.max(k.nitroActive?1.5:1,k.turbo>0?1.35:1,k.rammingT>0?1.5:1),frost=k.frostT>0?.55:1,spun=k.spinT>0;
    const grip=p.grounded?s.traction:1,top=p.grounded?s.top:1;
    // Rapier already applies the authored wheel collider grip. Normalize it
    // once here so ice does not have its friction multiplied twice.
    physics.tuneKart(k.id,{top:clamp(boost*frost*top*(active?1.08:1),.1,2),engine:clamp(Math.max(k.nitroActive?1.75:1,k.turbo>0?1.6:active?1.12:1,k.rammingT>0?1.6:1)*(frost<1?.7:1)*(.75+.25*top),.1,2),
      steering:1,traction:clamp(grip/(d?.grip||1),.1,2),rearTraction:spun?.12:active?.55:1,rearStiffness:spun?.2:active?.7:1});
    physics.arcadeSlide(k.id,{active:active&&!spun,direction:k.driftDirection||0,ease:s.driftEase,traction:grip});
    physics.applyIntent(k.id,{...input,brake:active?0:input.brake||0});
    applyElevatedBelts(physics,k.id,p,map,dt);
  }
  function afterStep(dt){
    for(const k of karts)project(k);
    runner.step(dt,new Set(karts.filter(k=>k.connected!==false&&k.alive!==false).map(k=>k.id)));
  }
  function restore(k,source){
    Object.assign(k,structuredClone(source));k.pid=k.id;k._driftHeld=!!k.driftDirection&&k.drifting===true;
    const live=k.alive!==false&&!k.flight;
    physics.setKartEnabled(k.id,live);enabled.set(k.id,live);
    physics.restoreKart(k.id,source.pose);runner.reconcile(k);project(k);
    // Compact public wheels omit contact ids. Recover the first corrected
    // step's support at the authoritative height, including stacked decks.
    const p=source.pose,q=p.rotation;
    const wheels=(p.wheels||[]).map((w,i)=>{
      if(typeof w.contact==='boolean')return w;
      // Standard shared wheel centres, in the chassis frame.
      const {x,z}=CONFIG.wheels[i];
      const wx=p.position.x+(1-2*(q.y*q.y+q.z*q.z))*x+2*(q.x*q.z+q.w*q.y)*z;
      const wz=p.position.z+2*(q.x*q.z-q.w*q.y)*x+(1-2*(q.x*q.x+q.y*q.y))*z;
      const s=p.grounded?physics.supportAt({x:wx,y:p.position.y+.25,z:wz},1.4):null;
      return {...w,contact:!!s,surfaceId:s?.surfaceId||null};
    });
    k._restoredPose={...p,wheels};
  }
  return{controls,afterStep,project,reset,restore,dispose(){enabled.clear();surfaces.clear();runner.clear();karts.length=0;}};
}
