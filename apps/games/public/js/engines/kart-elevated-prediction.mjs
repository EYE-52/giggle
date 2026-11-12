/* Local-only Rapier prediction. Authority still owns all combat, rewards and
 * teleports. Rewind to each accepted pose, replay only recent local intent
 * intervals, and hold after 1500ms of packet loss. Remotes stay confirmed colliders. */
import CONFIG from './kart-physics-config.mjs';
import {createKartPhysics} from './kart-physics-core.mjs';
import {elevatedStatics} from './kart-feature-solids.mjs';
import {createElevatedMotion,clearElevatedMotion} from './kart-elevated-motion.mjs';
import {elevatedMap} from './kart-elevated-maps.mjs';
import {blendElevatedPose} from './kart-elevated-pose.mjs';
import {loadKartPhysics} from './kart-physics-loader.mjs';
import {rebasePreviousPose} from './kart-prediction-pose.mjs';
export const loadElevatedPhysics=loadKartPhysics;
const neutral=()=>({steer:0,throttle:0,brake:0,nitro:false,use:false});
const sameIntent=(a,b)=>a.steer===b.steer&&a.throttle===b.throttle&&a.brake===b.brake&&!!a.nitro===!!b.nitro&&!!a.use===!!b.use;
const yaw=q=>Math.atan2(2*(q.x*q.z+q.w*q.y),1-2*(q.x*q.x+q.y*q.y));
const multiply=(a,b)=>({x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z});
const identityRotation={x:0,y:0,z:0,w:1};
function slerp(a,b,t){
  let d=a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w;
  if(d<0){b={x:-b.x,y:-b.y,z:-b.z,w:-b.w};d=-d;}
  let u=1-t,v=t;
  if(d<.9995){const angle=Math.acos(Math.min(1,d)),sin=Math.sin(angle);u=Math.sin((1-t)*angle)/sin;v=Math.sin(t*angle)/sin;}
  const q={x:a.x*u+b.x*v,y:a.y*u+b.y*v,z:a.z*u+b.z*v,w:a.w*u+b.w*v},n=Math.hypot(q.x,q.y,q.z,q.w)||1;
  return {x:q.x/n,y:q.y/n,z:q.z/n,w:q.w/n};
}
export function createElevatedPrediction(R){
  let physics,motion,kart,identity,lastSnapshot,lastArrival=-Infinity,lastAt=-Infinity,history=[],accumulator=0,frameCredit=0,retired=false,lastDraw=null,correction=null;
  const peers=new Set(),dt=CONFIG.fixedDt,renderOutput={position:{},rotation:{}};let priorPose=null;
  const counters={corrections:0,snaps:0,maxErrorM:0,starvedMs:0};
  function clear(){motion?.dispose();physics?.dispose();physics=motion=kart=null;peers.clear();history=[];accumulator=frameCredit=0;lastAt=-Infinity;lastArrival=-Infinity;lastSnapshot=null;priorPose=lastDraw=correction=null;}
  function trimHistory(arrival,serverAt){
    history=history.filter(h=>arrival-h.arrival<=1500&&h.end>serverAt-1500);
    if(history.length)history[0].start=Math.max(history[0].start,serverAt-1500);
  }
  function run(seconds,input){
    kart.input=input;let left=seconds;
    while(left>1e-9){
      const sub=Math.min(left,.05);accumulator+=sub;left-=sub;
      while(accumulator>=dt-1e-9){
        kart.frostT=Math.max(0,(kart.frostT||0)-dt);kart.spinT=Math.max(0,(kart.spinT||0)-dt);
        priorPose=physics.pose(kart.id);motion.controls(kart,dt);physics.step();motion.afterStep(dt);
        kart.rammingT=Math.max(0,(kart.rammingT||0)-dt);accumulator-=dt;
      }
    }
  }
  function drawPose(){
    const current={...kart,pose:physics.pose(kart.id)};
    return blendElevatedPose(priorPose?{...kart,pose:priorPose}:null,current,Math.max(0,Math.min(1,accumulator/dt)),renderOutput);
  }
  function corrected(p){
    if(!correction)return p;
    return {...p,position:{x:p.position.x+correction.offset.x,y:p.position.y+correction.offset.y,z:p.position.z+correction.offset.z},rotation:multiply(correction.rotation,p.rotation)};
  }
  function ingest(snapshot,arrival,serverAt=arrival){
    if(retired||!snapshot.youDrive||!snapshot.inputAck)return;
    const source=snapshot.karts.find(k=>k.id===snapshot.you);if(!source)return;
    const key=[snapshot.instanceId,snapshot.mapId,snapshot.mapRevision,snapshot.variantId||'',snapshot.you].join(':');
    if(key!==identity){
      clear();identity=key;physics=createKartPhysics(R,CONFIG);
      const map=elevatedMap(snapshot.mapId,snapshot.variantId);elevatedStatics(map).forEach(d=>physics.addStatic(d));
      for(const k of snapshot.karts){physics.addKart(k.id,k.pose);peers.add(k.id);if(k.id!==source.id)physics.freezeKart(k.id,true);}
      kart={...structuredClone(source),input:neutral()};motion=createElevatedMotion({physics,map,karts:[kart]});
    }
    if(lastSnapshot&&snapshot.simAt<lastSnapshot.simAt)return;
    const oldSource=lastSnapshot?.karts.find(k=>k.id===source.id);
    const reset=!lastSnapshot||source.spawnSeq!==oldSource?.spawnSeq||source.controlEpoch!==oldSource?.controlEpoch||source.pose.epoch!==oldSource?.pose.epoch||snapshot.inputAck.life!==lastSnapshot.inputAck.life||snapshot.inputAck.controlEpoch!==lastSnapshot.inputAck.controlEpoch;
    if(lastSnapshot&&snapshot.simAt===lastSnapshot.simAt&&!reset&&snapshot.phase===lastSnapshot.phase)return;
    // A packet may contain the tick just after the last render's fractional
    // simulation time. Compare that same tick before restoring the checkpoint.
    const gap=snapshot.simAt-lastAt;
    if(!reset&&source.alive&&source.connected!==false&&snapshot.phase==='live'&&!snapshot.preparing&&gap>.001&&gap<=dt*1000+.001){
      let step=gap/1000;if(Math.abs(step-dt)<1e-6)step=dt;
      run(step,kart.input);lastAt=snapshot.simAt;frameCredit+=step;
    }
    // Reconcile physics against physics. A restored snapshot has no previous
    // render step yet; comparing it with the interpolated draw pose invents
    // a one-tick correction on every packet and makes steady driving pulse.
    const before=physics.pose(kart.id),beforePrior=priorPose;
    const previous=lastDraw?structuredClone(corrected(before)):null;
    if(reset){history=[];frameCredit=0;lastDraw=correction=null;if(previous)counters.snaps++;}
    accumulator=0;priorPose=null;
    for(const peer of snapshot.karts){
      if(peer.id===source.id||!peers.has(peer.id))continue;
      physics.setKartEnabled(peer.id,peer.alive&&peer.connected!==false&&!peer.flight);
      physics.restoreKart(peer.id,peer.pose);
    }
    // Omitted compact fields mean inactive, never carry a prior turbo/flight.
    clearElevatedMotion(kart);kart.nitroLocked=false;
    physics.freezeKart(source.id,snapshot.phase!=='live'||source.connected===false);
    motion.restore(kart,source);
    // ACK receipt does not retire the later time spent holding that intent.
    // A late packet still replays every retained interval after its simAt.
    trimHistory(arrival,serverAt);history=history.filter(h=>h.end>snapshot.simAt);lastAt=snapshot.simAt;
    if(source.alive&&source.connected!==false&&snapshot.phase==='live'&&!snapshot.preparing){
      for(const h of history){let seconds=Math.max(0,Math.min(h.end,serverAt)-Math.max(h.start,snapshot.simAt))/1000;const fixed=Math.round(seconds/dt)*dt;if(Math.abs(fixed-seconds)<1e-6)seconds=fixed;if(seconds){run(seconds,h.input);lastAt+=seconds*1000;}}
    }
    if(!reset&&!priorPose)priorPose=rebasePreviousPose(beforePrior,before,physics.pose(kart.id));
    if(!reset&&previous){
      const p=physics.pose(kart.id),offset={x:previous.position.x-p.position.x,y:previous.position.y-p.position.y,z:previous.position.z-p.position.z},error=Math.hypot(offset.x,offset.y,offset.z),angle=Math.abs(Math.atan2(Math.sin(yaw(previous.rotation)-yaw(p.rotation)),Math.cos(yaw(previous.rotation)-yaw(p.rotation))));
      counters.corrections++;counters.maxErrorM=Math.max(counters.maxErrorM,error);
      if(error>8||angle>Math.PI/3){correction=null;counters.snaps++;}
      else correction={offset,rotation:multiply(previous.rotation,{x:-p.rotation.x,y:-p.rotation.y,z:-p.rotation.z,w:p.rotation.w}),at:arrival};
    }
    lastSnapshot=snapshot;lastArrival=arrival;
  }
  function frame(snapshot,input,seconds,arrival,serverAt=arrival){
    if(retired||!kart||!physics||snapshot.phase!=='live'||snapshot.preparing||!snapshot.youDrive||!kart.alive||kart.connected===false)return null;
    const age=arrival-lastArrival;trimHistory(arrival,serverAt);counters.starvedMs=Math.max(0,age-1500);
    // Alignment already simulated part of this render interval. Consume it
    // once, retaining any remainder across zero/very short draw calls.
    const budget=Math.max(0,Math.min(.25,seconds)),credited=Math.min(budget,frameCredit);
    frameCredit-=credited;
    const step=age<=1500?budget-credited:0,value={...input};
    if(step){
      run(step,value);const start=serverAt-step*1000,previous=history.at(-1);
      if(previous&&Math.abs(previous.end-start)<1&&sameIntent(previous.input,value)){previous.end=serverAt;previous.arrival=arrival;previous.start=Math.max(previous.start,serverAt-1500);}
      else history.push({start,end:serverAt,input:value,arrival});lastAt+=step*1000;
    }
    const pose=physics.pose(kart.id),current={...kart,pose};
    let p=drawPose();
    if(age>1500&&lastDraw)p=lastDraw;
    else if(correction){
      const elapsed=Math.max(0,arrival-correction.at),size=Math.hypot(correction.offset.x,correction.offset.y,correction.offset.z),tau=Math.max(60,Math.min(140,90-size*10));
      const consumed=Math.min(1-Math.exp(-elapsed/tau),size>0?12*elapsed/1000/size:1);
      for(const key of ['x','y','z'])correction.offset[key]*=1-consumed;
      correction.rotation=slerp(correction.rotation,identityRotation,1-Math.exp(-elapsed/tau));correction.at=Math.max(correction.at,arrival);
      const visual=corrected(p);
      if(!physics.overlapsStatic(visual.position,visual.rotation))p=visual;else correction=null;
    }
    lastDraw=structuredClone(p);p=lastDraw;
    return {...current,renderPose:p};
  }
  return{ingest,frame,stats:()=>({...counters,physics:physics?.stats(),history:history.length,simAt:lastAt}),dispose(){if(retired)return;retired=true;clear();}};
}
