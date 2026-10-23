import config from './kart-physics-config.mjs';
import {createClassicMotion} from './kart-classic-motion.mjs';
let loading;
export function loadClassicPhysics(){
  if(!loading)loading=import('/vendor/rapier/rapier.mjs').then(async module=>{const R=module.default;await R.init();if(R.version()!=='0.21.0')throw Error('Unexpected kart physics runtime');return R;});
  return loading;
}
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
const neutralIntent=()=>({steer:0,throttle:0,drift:false,nitro:false});
function remoteIntent(k,phase){
  const input=k.motionIntent;
  if(phase!=='drive'||k.connected===false||k.respawn>0||!input)return neutralIntent();
  const bounded=n=>Number.isFinite(n)?Math.max(-1,Math.min(1,n)):0;
  return {steer:bounded(input.steer),throttle:bounded(input.throttle),drift:input.drift===true,nitro:input.nitro===true};
}
export function createClassicPrediction(R){
  const hull=new R.Cuboid(config.chassis.half.x,config.chassis.half.y,config.chassis.half.z);
  let world,state,identity,lastAt=0,lastSeq=0,history=[],elapsed=0,retired=false,lastLife,lastControlEpoch,lastDraw,correction,nearField=false,remotes=new Map(),peerWeights=new Map();
  const online=()=>new Set(state.karts.filter(k=>k.connected!==false).map(k=>k.pid));
  function remoteSample(pid,now){
    const list=remotes.get(pid);if(!list?.length)return null;
    const time=now-100;let a=list[0],b=a;
    for(const sample of list){if(sample.at<=time)a=sample;if(sample.at>=time){b=sample;break;}b=sample;}
    const t=a.life===b.life&&b.at>a.at?Math.max(0,Math.min(1,(time-a.at)/(b.at-a.at))):1;
    return {...b.pose,position:mix(a.pose.position,b.pose.position,t),rotation:slerp(a.pose.rotation,b.pose.rotation,t)};
  }
  function ingest(snapshot,now,serverAt=now){
    if(retired)return;
    const next=snapshot.instanceId+':'+snapshot.map.id;
    if(next!==identity){world?.dispose();identity=next;state={map:snapshot.map.id,half:snapshot.map.half,blocks:snapshot.map.blocks,pads:snapshot.map.pads,surfaces:snapshot.map.surfaces,mode:snapshot.mode,karts:snapshot.karts.map(k=>({...structuredClone(k),input:neutralIntent(),upgrades:snapshot.upgrades?.[k.pid],garage:snapshot.garage})),physicalEvents:[],physicalEventSeq:0};world=createClassicMotion(R,config,state);history=[];lastSeq=0;elapsed=0;lastDraw=null;correction=null;remotes.clear();peerWeights.clear();}
    const previous=lastDraw;
    for(const k of snapshot.karts){if(k.pid===snapshot.you||!k.physicalPose)continue;let list=remotes.get(k.pid)||[];if(list.at(-1)?.life!==k.spawnSeq||list.at(-1)?.pose.epoch!==k.physicalPose.epoch)list=[];list.push({at:now,life:k.spawnSeq,pose:structuredClone(k.physicalPose)});while(list.length>8)list.shift();remotes.set(k.pid,list);}
    const self=state.karts.find(k=>k.pid===snapshot.you);
    const simAt=Number.isFinite(snapshot.simAt)?snapshot.simAt:serverAt;
    const fresh=serverAt-simAt<=250&&simAt<=serverAt+5;
    world.beginCorrection();
    for(const k of state.karts){const source=snapshot.karts.find(s=>s.pid===k.pid);if(!source?.physicalPose)continue;const renewed=k.spawnSeq!==source.spawnSeq||k.physicalPose?.epoch!==source.physicalPose.epoch;Object.assign(k,structuredClone(source),{input:k.pid===snapshot.you||renewed||!fresh?neutralIntent():remoteIntent(source,snapshot.phase),upgrades:snapshot.upgrades?.[k.pid],garage:snapshot.garage});world.restore(k,source.physicalPose);}
    const reset=self?.spawnSeq!==lastLife||snapshot.inputAck?.controlEpoch!==lastControlEpoch||now-lastAt>250;
    if(reset){history=[];lastDraw=null;correction=null;lastLife=self?.spawnSeq;lastControlEpoch=snapshot.inputAck?.controlEpoch;}
    // ACK is an intent receipt, not the end of the time simulated with it.
    // Replay only the local intent intervals after this authoritative pose's
    // calibrated server timestamp, including intervals using the ACKed intent.
    history=history.filter(h=>h.end>simAt&&now-h.at<=250).slice(-30);
    if(serverAt-simAt>250||simAt>serverAt+5)history=[];
    if(self&&snapshot.phase==='drive'&&!(self.respawn>0))for(const h of history){const dt=Math.max(0,Math.min(h.end,serverAt)-Math.max(h.start,simAt))/1000;if(dt>0){self.input=h.intent;world.advance(dt,online());}}
    else history=[];
    if(!reset&&previous&&self?.physicalPose){
      const p=self.physicalPose,offset={x:previous.position.x-p.position.x,y:previous.position.y-p.position.y,z:previous.position.z-p.position.z};
      const inv={x:-p.rotation.x,y:-p.rotation.y,z:-p.rotation.z,w:p.rotation.w},delta=multiply(previous.rotation,inv);
      // Small network corrections blend only visually. Large/contact corrections snap
      // to authority; the simulation is always restored immediately.
      correction=Math.hypot(offset.x,offset.y,offset.z)<=.75&&Math.abs(delta.w)>=Math.cos(Math.PI/12)?{offset,rotation:delta,at:now}:null;
    }
    state.physicalEvents.length=0;lastAt=now;
  }
  return {
    ingest,
    sent(seq){lastSeq=seq;},
    frame(snapshot,intent,dt,now,serverAt=now){
      const self=state?.karts.find(k=>k.pid===snapshot.you);if(!world||!self)return null;
      nearField=snapshot.phase==='drive'&&snapshot.youDrive&&self.connected!==false&&!(self.respawn>0)&&now-lastAt<=250;
      if(now-lastAt>250){history=[];correction=null;lastDraw=null;}
      if(snapshot.phase==='drive'&&snapshot.youDrive&&!(self.respawn>0)&&now-lastAt<=250){
        const step=Math.max(0,Math.min(dt,.05));self.input={...intent};world.advance(step,online());elapsed+=step;
        if(step>0)history.push({seq:lastSeq,intent:{...intent},start:serverAt-step*1000,end:serverAt,at:now});while(history.length>30)history.shift();state.physicalEvents.length=0;
      }
      let p=self.physicalPose;
      if(correction){
        const remaining=Math.max(0,1-(now-correction.at)/120),position={x:p.position.x+correction.offset.x*remaining,y:p.position.y+correction.offset.y*remaining,z:p.position.z+correction.offset.z*remaining},rotation=multiply(slerp(identityRotation,correction.rotation,remaining),p.rotation);
        const overlapsPeer=state.karts.some(k=>{if(k===self||k.connected===false||k.respawn>0)return false;const peer=k.physicalPose,contact=hull.contactShape(position,rotation,hull,peer.position,peer.rotation,.02);return contact&&contact.distance<-.02;});
        if(remaining>0&&!world.overlapsStatic(position,rotation)&&!overlapsPeer)p={...p,position,rotation};else correction=null;
      }
      lastDraw=structuredClone(p);
      peerWeights.clear();
      if(nearField){
        const peers=state.karts.filter(k=>k!==self&&k.connected!==false&&!(k.respawn>0));
        for(const k of peers){const q=k.physicalPose.position,distance=Math.hypot(q.x-p.position.x,q.z-p.position.z),band=Math.max(0,Math.min(1,(12-distance)/6));peerWeights.set(k.pid,band*band*(3-2*band));}
        // Nearby peers share one timeline through their own mutual contact.
        const pairs=[],samples=new Map(peers.map(k=>[k.pid,remoteSample(k.pid,now)]));
        for(let i=0;i<peers.length;i++)for(let j=i+1;j<peers.length;j++){const a=peers[i],b=peers[j],pa=a.physicalPose.position,pb=b.physicalPose.position;if(Math.hypot(pa.x-pb.x,pa.z-pb.z)<4.5)pairs.push([a.pid,b.pid]);}
        for(let pass=0;pass<peers.length;pass++){
          let changed=false;
          for(const k of peers){const weight=peerWeights.get(k.pid),sample=samples.get(k.pid),actual=k.physicalPose;if(sample&&weight>0&&weight<1&&world.overlapsStatic(mix(sample.position,actual.position,weight),slerp(sample.rotation,actual.rotation,weight))){peerWeights.set(k.pid,1);changed=true;}}
          for(const [a,b]of pairs){const weight=Math.max(peerWeights.get(a),peerWeights.get(b));if(peerWeights.get(a)!==weight||peerWeights.get(b)!==weight){peerWeights.set(a,weight);peerWeights.set(b,weight);changed=true;}}
          if(!changed)break;
        }
      }
      return {x:p.position.x,z:p.position.z,y:p.position.y,angle:Math.atan2(2*(p.rotation.x*p.rotation.z+p.rotation.w*p.rotation.y),1-2*(p.rotation.x*p.rotation.x+p.rotation.y*p.rotation.y)),speed:self.speed,drifting:self.drifting===true,slip:self.slip,grounded:p.grounded,physicalPose:p};
    },
    remote(pid,now){
      let pose=remoteSample(pid,now);if(!pose)return null;
      const peer=state?.karts.find(k=>k.pid===pid),predicted=peer?.physicalPose;
      if(nearField&&lastDraw&&predicted&&peer.connected!==false&&!(peer.respawn>0)&&now-lastAt<=250&&predicted.epoch===pose.epoch){
        // Nearby rendered bodies use the same time as their collision proxies.
        const weight=peerWeights.get(pid)||0;
        if(weight>0){const position=mix(pose.position,predicted.position,weight),rotation=slerp(pose.rotation,predicted.rotation,weight);pose=world.overlapsStatic(position,rotation)?predicted:{...predicted,position,rotation};}
      }
      return {x:pose.position.x,y:pose.position.y,z:pose.position.z,angle:Math.atan2(2*(pose.rotation.x*pose.rotation.z+pose.rotation.w*pose.rotation.y),1-2*(pose.rotation.x*pose.rotation.x+pose.rotation.y*pose.rotation.y)),speed:pose.speed,physicalPose:pose};
    },
    dispose(){retired=true;world?.dispose();world=null;state=null;history=[];},
  };
}
