/* Local-only Rapier prediction. Authority still owns all combat, rewards and
 * teleports. Rewind to each accepted pose, replay only recent local intent
 * intervals, and freeze after packet loss. Remotes stay confirmed colliders. */
import CONFIG from './kart-physics-config.mjs';
import {createKartPhysics} from './kart-physics-core.mjs';
import {elevatedStatics} from './kart-feature-solids.mjs';
import {createElevatedMotion,clearElevatedMotion} from './kart-elevated-motion.mjs';
import {elevatedMap} from './kart-elevated-maps.mjs';
import {blendElevatedPose} from './kart-elevated-pose.mjs';
let loading;
export function loadElevatedPhysics(){
  return loading??=import('/vendor/rapier/rapier.mjs').then(async m=>{const R=m.default;await R.init();if(R.version()!=='0.21.0')throw Error('Unexpected kart physics runtime');return R;});
}
const neutral=()=>({steer:0,throttle:0,brake:0,nitro:false,use:false});
export function createElevatedPrediction(R){
  let physics,motion,kart,identity,lastSnapshot,lastArrival=-Infinity,lastAt=-Infinity,history=[],accumulator=0,retired=false;
  const peers=new Set(),dt=CONFIG.fixedDt,renderOutput={position:{},rotation:{}};let priorPose=null;
  function clear(){motion?.dispose();physics?.dispose();physics=motion=kart=null;peers.clear();history=[];accumulator=0;lastAt=-Infinity;lastSnapshot=null;priorPose=null;}
  function run(seconds,input){
    accumulator=Math.min(.25,accumulator+seconds);kart.input=input;
    while(accumulator>=dt-1e-9){
      kart.frostT=Math.max(0,(kart.frostT||0)-dt);kart.spinT=Math.max(0,(kart.spinT||0)-dt);
      priorPose=physics.pose(kart.id);motion.controls(kart,dt);physics.step();motion.afterStep(dt);
      kart.rammingT=Math.max(0,(kart.rammingT||0)-dt);accumulator-=dt;
    }
  }
  function ingest(snapshot,arrival,serverAt=arrival){
    if(retired||!snapshot.youDrive||!snapshot.inputAck)return;
    const source=snapshot.karts.find(k=>k.id===snapshot.you);if(!source)return;
    const key=[snapshot.instanceId,snapshot.mapId,snapshot.mapRevision,snapshot.you].join(':');
    if(key!==identity){
      clear();identity=key;physics=createKartPhysics(R,CONFIG);
      const map=elevatedMap(snapshot.mapId);elevatedStatics(map).forEach(d=>physics.addStatic(d));
      for(const k of snapshot.karts){physics.addKart(k.id,k.pose);peers.add(k.id);if(k.id!==source.id)physics.freezeKart(k.id,true);}
      kart={...structuredClone(source),input:neutral()};motion=createElevatedMotion({physics,map,karts:[kart]});
    }
    if(lastSnapshot&&snapshot.simAt<lastSnapshot.simAt)return;
    const changed=!lastSnapshot||source.spawnSeq!==kart.spawnSeq||source.controlEpoch!==kart.controlEpoch||source.pose.epoch!==lastSnapshot.karts.find(k=>k.id===source.id)?.pose.epoch;
    if(lastSnapshot&&snapshot.simAt===lastSnapshot.simAt&&!changed&&snapshot.phase===lastSnapshot.phase)return;
    const fresh=serverAt-snapshot.simAt<=250&&serverAt>=snapshot.simAt-5;
    if(changed||!fresh||snapshot.audioBaseline||arrival-lastArrival>250)history=[];
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
    history=history.filter(h=>h.end>snapshot.simAt&&arrival-h.arrival<=250).slice(-30);
    if(fresh&&source.alive&&source.connected!==false&&snapshot.phase==='live'&&!snapshot.preparing){
      for(const h of history){const seconds=Math.max(0,Math.min(h.end,serverAt)-Math.max(h.start,snapshot.simAt))/1000;if(seconds)run(seconds,h.input);}
    }else history=[];
    lastSnapshot=snapshot;lastArrival=arrival;lastAt=snapshot.simAt;
  }
  function frame(snapshot,input,seconds,arrival,serverAt=arrival){
    if(retired||!kart||!physics||snapshot.phase!=='live'||snapshot.preparing||!snapshot.youDrive||!kart.alive||kart.connected===false||arrival-lastArrival>250){history=[];return null;}
    const step=Math.max(0,Math.min(.05,seconds)),value={...input};
    if(step){run(step,value);history.push({start:serverAt-step*1000,end:serverAt,input:value,arrival});while(history.length>30)history.shift();lastAt+=step*1000;}
    const pose=physics.pose(kart.id),current={...kart,pose};
    return {...current,renderPose:blendElevatedPose(priorPose?{...kart,pose:priorPose}:null,current,Math.max(0,Math.min(1,accumulator/dt)),renderOutput)};
  }
  return{ingest,frame,stats:()=>({physics:physics?.stats(),history:history.length,simAt:lastAt}),dispose(){if(retired)return;retired=true;clear();}};
}
