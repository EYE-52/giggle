import config from './kart-physics-config.mjs';
import {createClassicMotion} from './kart-classic-motion.mjs';
import {createInterpolationBuffer} from '../toolkit/realtime/client.mjs';
import {loadKartPhysics} from './kart-physics-loader.mjs';
export const loadClassicPhysics=loadKartPhysics;
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
const multiply=(a,b)=>({x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z});
function slerp(a,b,t){
  let d=a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w;
  if(d<0){b={x:-b.x,y:-b.y,z:-b.z,w:-b.w};d=-d;}
  let u=1-t,v=t;
  if(d<.9995){const angle=Math.acos(Math.min(1,d)),sin=Math.sin(angle);u=Math.sin((1-t)*angle)/sin;v=Math.sin(t*angle)/sin;}
  const q={x:a.x*u+b.x*v,y:a.y*u+b.y*v,z:a.z*u+b.z*v,w:a.w*u+b.w*v},n=Math.hypot(q.x,q.y,q.z,q.w);
  return {x:q.x/n,y:q.y/n,z:q.z/n,w:q.w/n};
}
const identityRotation={x:0,y:0,z:0,w:1};
// Remote pose blend for the interpolation buffer: lerp/slerp between two
// server samples, then a short velocity extrapolation past the newest.
function blendPose(a,b,t,ahead=0){
  const v=b.linearVelocity||{x:0,y:0,z:0},position=mix(a.position,b.position,t);
  return {...b,position:{x:position.x+v.x*ahead,y:position.y+v.y*ahead,z:position.z+v.z*ahead},rotation:slerp(a.rotation,b.rotation,t)};
}
const neutralIntent=()=>({steer:0,throttle:0,drift:false,nitro:false});
function remoteIntent(k,phase){
  const input=k.motionIntent;
  if(phase!=='drive'||k.connected===false||k.respawn>0||!input)return neutralIntent();
  const bounded=n=>Number.isFinite(n)?Math.max(-1,Math.min(1,n)):0;
  return {steer:bounded(input.steer),throttle:bounded(input.throttle),drift:input.drift===true,nitro:input.nitro===true};
}
export function createClassicPrediction(R){
  const hull=new R.Cuboid(config.chassis.half.x,config.chassis.half.y,config.chassis.half.z);
  let selfId,world,state,identity,lastAt=0,lastSeq=0,history=[],elapsed=0,retired=false,lastLife,lastControlEpoch,lastPoseEpoch,lastDraw,correction,observed,observedIdentity,driving,nearField=false,peerWeights=new Map(),advancedAt=null;
  // Remotes play back on SERVER time with an adaptive delay (toolkit buffer).
  const remotes=createInterpolationBuffer({maxDelay:250}),remoteVisual=new Map(),remoteStamps=new Map();
  const counters={corrections:0,snaps:0,maxErrorM:0,starvedMs:0,lastAgeMs:0};
  const yaw=q=>Math.atan2(2*(q.x*q.z+q.w*q.y),1-2*(q.x*q.x+q.y*q.y));
  const sameIntent=(a,b)=>a.steer===b.steer&&a.throttle===b.throttle&&!!a.drift===!!b.drift&&!!a.nitro===!!b.nitro&&!!a.boost===!!b.boost;
  function visualError(before,p,now){
    const inv={x:-p.rotation.x,y:-p.rotation.y,z:-p.rotation.z,w:p.rotation.w};
    return {offset:{x:before.position.x-p.position.x,y:before.position.y-p.position.y,z:before.position.z-p.position.z},rotation:multiply(before.rotation,inv),at:now};
  }
  function corrected(p,c,now,speed,tau){
    const dt=Math.max(0,now-c.at),size=Math.hypot(c.offset.x,c.offset.y,c.offset.z);
    const consumed=Math.min(1-Math.exp(-dt/tau),size>0?speed*dt/1000/size:1),remaining=1-consumed;
    c.offset={x:c.offset.x*remaining,y:c.offset.y*remaining,z:c.offset.z*remaining};
    c.rotation=slerp(c.rotation,identityRotation,Math.min(1-Math.exp(-dt/tau),1));c.at=Math.max(c.at,now);
    return {...p,position:{x:p.position.x+c.offset.x,y:p.position.y+c.offset.y,z:p.position.z+c.offset.z},rotation:multiply(c.rotation,p.rotation)};
  }
  function observe(snapshot,now,serverAt=now){
    if(retired||observed===snapshot)return;
    observed=snapshot;const next=snapshot.instanceId+':'+snapshot.map.id;
    if(next!==observedIdentity){observedIdentity=next;remotes.clear();remoteVisual.clear();remoteStamps.clear();advancedAt=null;}
    const simAt=Number.isFinite(snapshot.simAt)?snapshot.simAt:serverAt;
    remotes.observe(simAt,serverAt);
    const live=new Set();
    for(const k of snapshot.karts){if(k.pid===snapshot.you||!k.physicalPose)continue;live.add(k.pid);
      const at=simAt-(k.rtAge||0),life=k.spawnSeq+':'+k.physicalPose.epoch,previous=remoteStamps.get(k.pid);
      remotes.push(k.pid,at,k.connected===false||k.respawn>0?{...k.physicalPose,linearVelocity:{x:0,y:0,z:0}}:k.physicalPose,{life});
      if(!previous||previous.life!==life){remoteVisual.delete(k.pid);remoteStamps.set(k.pid,{at,life});}
      else if(at>previous.at)remoteStamps.set(k.pid,{at,life});
    }
    for(const id of remoteStamps.keys())if(!live.has(id)){remoteStamps.delete(id);remoteVisual.delete(id);remotes.remove(id);}
  }
  // Big matches simulate only karts near the local driver; distant ones are
  // drawn from the interpolation buffer and cannot touch the local kart.
  const NEAR_SIM=45;
  const online=()=>{
    const live=state.karts.filter(k=>k.connected!==false),self=live.find(k=>k.pid===selfId)?.physicalPose?.position;
    if(live.length<=8||!self)return new Set(live.map(k=>k.pid));
    return new Set(live.filter(k=>k.pid===selfId||Math.hypot(k.x-self.x,k.z-self.z)<=NEAR_SIM).map(k=>k.pid));
  };
  // Blend between the last two fixed steps: even motion at 60/90/120 Hz.
  function stepBlend(k){
    const p=k.physicalPose,prev=k._prevPose,alpha=world.alpha?.()??1;
    return prev&&prev.epoch===p.epoch&&alpha<1?{...p,position:mix(prev.position,p.position,alpha),rotation:slerp(prev.rotation,p.rotation,alpha)}:p;
  }
  function advanceRemotes(serverAt){if(advancedAt!==serverAt){remotes.advance(serverAt);advancedAt=serverAt;}}
  function remoteSample(pid,serverAt){advanceRemotes(serverAt);return remotes.sample(pid,serverAt,blendPose);}
  function ingest(snapshot,now,serverAt=now){
    if(retired)return;
    observe(snapshot,now,serverAt);
    const next=snapshot.instanceId+':'+snapshot.map.id,changed=next!==identity;
    const oldSelf=state?.karts.find(k=>k.pid===selfId),before=oldSelf?.physicalPose?stepBlend(oldSelf):null;
    const previous=before&&correction?{...before,position:{x:before.position.x+correction.offset.x,y:before.position.y+correction.offset.y,z:before.position.z+correction.offset.z},rotation:multiply(correction.rotation,before.rotation)}:before;
    if(changed){world?.dispose();identity=next;state={map:snapshot.map.id,half:snapshot.map.half,blocks:snapshot.map.blocks,pads:snapshot.map.pads,surfaces:snapshot.map.surfaces,features:snapshot.map.features,roads:snapshot.map.roads,offroad:snapshot.map.offroad,barriers:snapshot.map.barriers,ramps:snapshot.map.ramps,mode:snapshot.mode,karts:snapshot.karts.map(k=>({...structuredClone(k),input:neutralIntent(),upgrades:snapshot.upgrades?.[k.pid],garage:snapshot.garage})),physicalEvents:[],physicalEventSeq:0};world=createClassicMotion(R,config,state);history=[];lastSeq=0;elapsed=0;lastDraw=null;correction=null;peerWeights.clear();}
    selfId=snapshot.you;const self=state.karts.find(k=>k.pid===snapshot.you);
    const simAt=Number.isFinite(snapshot.simAt)?snapshot.simAt:serverAt;
    const fresh=serverAt-simAt<=250&&simAt<=serverAt+5;
    world.beginCorrection();
    for(const k of state.karts){const source=snapshot.karts.find(s=>s.pid===k.pid);if(!source?.physicalPose)continue;const renewed=k.spawnSeq!==source.spawnSeq||k.physicalPose?.epoch!==source.physicalPose.epoch;
      // A stale far kart (rtAge > 0) keeps simulating from its local pose; it is restored again when its next record arrives.
      if(source.rtAge>0&&!renewed&&k.physicalPose){Object.assign(k,{...structuredClone(source),physicalPose:k.physicalPose,x:k.x,z:k.z,angle:k.angle,speed:k.speed},{input:fresh?remoteIntent(source,snapshot.phase):neutralIntent(),upgrades:snapshot.upgrades?.[k.pid],garage:snapshot.garage});continue;}
      Object.assign(k,structuredClone(source),{_driftHeld:!!source.driftDirection&&source.drifting===true,input:k.pid===snapshot.you||renewed||!fresh?neutralIntent():remoteIntent(source,snapshot.phase),upgrades:snapshot.upgrades?.[k.pid],garage:snapshot.garage});world.restore(k,source.physicalPose);}
    const reset=changed||self?.spawnSeq!==lastLife||self?.physicalPose?.epoch!==lastPoseEpoch||snapshot.inputAck?.controlEpoch!==lastControlEpoch;
    if(reset){history=[];lastDraw=null;correction=null;lastLife=self?.spawnSeq;lastControlEpoch=snapshot.inputAck?.controlEpoch;lastPoseEpoch=self?.physicalPose?.epoch;if(previous)counters.snaps++;}
    // ACK is an intent receipt, not the end of the time simulated with it.
    // Replay only the local intent intervals after this authoritative pose's
    // calibrated server timestamp, including intervals using the ACKed intent.
    history=history.filter(h=>h.end>Math.max(simAt,serverAt-1500)&&now-h.at<=1500);
    if(history.length)history[0].start=Math.max(history[0].start,serverAt-1500);
    if(self&&snapshot.phase==='drive'&&snapshot.youDrive&&self.connected!==false&&!(self.respawn>0))for(const h of history){let dt=Math.max(0,Math.min(h.end,serverAt)-Math.max(h.start,simAt))/1000;const fixed=Math.round(dt/config.fixedDt)*config.fixedDt;if(Math.abs(fixed-dt)<1e-6)dt=fixed;self.input=h.intent;while(dt>1e-9){const step=Math.min(dt,.05);world.advance(step,online());dt-=step;}}
    else history=[];
    if(!reset&&previous&&self?.physicalPose){
      const p=stepBlend(self),c=visualError(previous,p,now),error=Math.hypot(c.offset.x,c.offset.y,c.offset.z),angle=Math.abs(Math.atan2(Math.sin(yaw(previous.rotation)-yaw(p.rotation)),Math.cos(yaw(previous.rotation)-yaw(p.rotation))));
      counters.corrections++;counters.maxErrorM=Math.max(counters.maxErrorM,error);
      if(error>8||angle>Math.PI/3){correction=null;counters.snaps++;}else correction=c;
    }
    state.physicalEvents.length=0;lastAt=now;counters.lastAgeMs=Math.max(0,serverAt-simAt);
  }
  return {
    observe,ingest,
    stats:()=>({...counters}),
    sent(seq){lastSeq=seq;},
    frame(snapshot,intent,dt,now,serverAt=now){
      if(driving!==snapshot.youDrive){remoteVisual.clear();driving=snapshot.youDrive;}
      if(world)advanceRemotes(serverAt);
      const self=state?.karts.find(k=>k.pid===snapshot.you);if(!world||!self)return null;
      nearField=snapshot.phase==='drive'&&snapshot.youDrive&&self.connected!==false&&!(self.respawn>0)&&now-lastAt<=250;
      counters.starvedMs=Math.max(0,now-lastAt-1500);
      history=history.filter(h=>now-h.at<=1500&&h.end>serverAt-1500);
      if(history.length)history[0].start=Math.max(history[0].start,serverAt-1500);
      if(snapshot.phase==='drive'&&snapshot.youDrive&&self.connected!==false&&!(self.respawn>0)&&now-lastAt<=1500){
        const step=Math.max(0,Math.min(dt,.25));self.input={...intent};let left=step;
        do{const sub=Math.min(left,.05);world.advance(sub,online());left-=sub;}while(left>1e-9);elapsed+=step;
        if(step>0){const previous=history.at(-1),start=serverAt-step*1000;
          if(previous&&Math.abs(previous.end-start)<1&&sameIntent(previous.intent,intent)){previous.end=serverAt;previous.at=now;previous.start=Math.max(previous.start,serverAt-1500);}
          else history.push({seq:lastSeq,intent:{...intent},start,end:serverAt,at:now});
        }state.physicalEvents.length=0;
      }
      let p=stepBlend(self);
      if(now-lastAt>1500&&lastDraw)p=lastDraw;
      else if(correction){
        const size=Math.hypot(correction.offset.x,correction.offset.y,correction.offset.z),visual=corrected(p,correction,now,12,Math.max(60,Math.min(140,90-size*10))),{position,rotation}=visual;
        const overlapsPeer=state.karts.some(k=>{if(k===self||k.connected===false||k.respawn>0)return false;const peer=k.physicalPose,contact=hull.contactShape(position,rotation,hull,peer.position,peer.rotation,.02);return contact&&contact.distance<-.02;});
        if(!world.overlapsStatic(position,rotation)&&!overlapsPeer)p=visual;else correction=null;
      }
      lastDraw=structuredClone(p);
      peerWeights.clear();
      if(nearField){
        const peers=state.karts.filter(k=>k!==self&&k.connected!==false&&!(k.respawn>0));
        for(const k of peers){const q=k.physicalPose.position,distance=Math.hypot(q.x-p.position.x,q.z-p.position.z),band=Math.max(0,Math.min(1,(12-distance)/6));peerWeights.set(k.pid,band*band*(3-2*band));}
        // Nearby peers share one timeline through their own mutual contact.
        const pairs=[],samples=new Map(peers.map(k=>[k.pid,remoteSample(k.pid,serverAt)]));
        for(let i=0;i<peers.length;i++)for(let j=i+1;j<peers.length;j++){const a=peers[i],b=peers[j],pa=a.physicalPose.position,pb=b.physicalPose.position;if(Math.hypot(pa.x-pb.x,pa.z-pb.z)<4.5)pairs.push([a.pid,b.pid]);}
        for(let pass=0;pass<peers.length;pass++){
          let changed=false;
          for(const k of peers){const weight=peerWeights.get(k.pid),sample=samples.get(k.pid),actual=k.physicalPose;if(sample&&weight>0&&weight<1&&world.overlapsStatic(mix(sample.position,actual.position,weight),slerp(sample.rotation,actual.rotation,weight))){peerWeights.set(k.pid,1);changed=true;}}
          for(const [a,b]of pairs){const weight=Math.max(peerWeights.get(a),peerWeights.get(b));if(peerWeights.get(a)!==weight||peerWeights.get(b)!==weight){peerWeights.set(a,weight);peerWeights.set(b,weight);changed=true;}}
          if(!changed)break;
        }
      }
      return {x:p.position.x,z:p.position.z,y:p.position.y,angle:Math.atan2(2*(p.rotation.x*p.rotation.z+p.rotation.w*p.rotation.y),1-2*(p.rotation.x*p.rotation.x+p.rotation.y*p.rotation.y)),speed:self.speed,drifting:self.drifting===true,driftCharge:self.driftCharge,driftTier:self.driftTier,driftHop:self.driftHop,surface:self.surface,turbo:self.turbo,slip:self.slip,grounded:p.grounded,physicalPose:p,flight:self.flight};
    },
    remote(pid,now,serverAt=now){
      let pose=remoteSample(pid,serverAt);if(!pose)return null;
      const stamp=remoteStamps.get(pid),visual=remoteVisual.get(pid),peer=state?.karts.find(k=>k.pid===pid),predicted=peer?.physicalPose;
      const near=nearField&&lastDraw&&predicted&&peer.connected!==false&&!(peer.respawn>0)&&now-lastAt<=250&&predicted.epoch===pose.epoch&&(peerWeights.get(pid)||0)>0;
      if(near){
        const weight=peerWeights.get(pid),position=mix(pose.position,predicted.position,weight),rotation=slerp(pose.rotation,predicted.rotation,weight);
        pose=world.overlapsStatic(position,rotation)?predicted:{...predicted,position,rotation};
      }
      let residual=visual?.correction;
      if(visual?.now===now&&visual.serverAt===serverAt&&!!visual.near===!!near)pose=visual.pose;
      else if(visual&&visual.serverAt<=serverAt){
        if(stamp?.at!==visual.stamp&&visual.ahead||!!visual.near!==!!near)residual=visualError(visual.pose,pose,now);
        if(residual){
          const draw=corrected(pose,residual,now,10,120),overlapsPeer=state?.karts.some(k=>{if(k.pid===pid||k.connected===false||k.respawn>0)return false;const other=k.pid===selfId&&lastDraw?lastDraw:k.physicalPose;if(!other)return false;const contact=hull.contactShape(draw.position,draw.rotation,hull,other.position,other.rotation,.02);return contact&&contact.distance<-.02;});
          if(world?.overlapsStatic(draw.position,draw.rotation)||overlapsPeer)residual=null;else pose=draw;
        }
      }
      remoteVisual.set(pid,{pose,now,serverAt,near:!!near,stamp:stamp?.at,ahead:serverAt-remotes.stats().delay>(stamp?.at??serverAt),correction:residual});
      return {x:pose.position.x,y:pose.position.y,z:pose.position.z,angle:Math.atan2(2*(pose.rotation.x*pose.rotation.z+pose.rotation.w*pose.rotation.y),1-2*(pose.rotation.x*pose.rotation.x+pose.rotation.y*pose.rotation.y)),speed:pose.speed,physicalPose:pose,flight:peer?.flight};
    },
    // Simulated (unblended) own pose, for diagnostics and tests.
    selfPose(){return state?.karts.find(k=>k.pid===selfId)?.physicalPose||null;},
    // Current remote playback delay (ms behind server time).
    remoteDelay:()=>remotes.stats().delay,
    dispose(){retired=true;world?.dispose();world=null;state=null;history=[];remotes.clear();remoteVisual.clear();remoteStamps.clear();observed=null;},
  };
}
