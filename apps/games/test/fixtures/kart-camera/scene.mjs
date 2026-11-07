// Browser fixture: production views/assets, shared real Rapier motion, local
// public snapshots and real keyboard input. Not a live multiplayer session.
import * as THREE from '/vendor/three/three.module.js';
import {createKartView} from '/js/engines/kart-view.js';
import {createElevatedKartView} from '/js/engines/kart-elevated-view.js';
import {loadClassicPhysics} from '/js/engines/kart-classic-prediction.mjs';
import {createClassicMotion,classicStatics} from '/js/engines/kart-classic-motion.mjs';
import {createKartPhysics} from '/js/engines/kart-physics-core.mjs';
import config from '/js/engines/kart-physics-config.mjs';
import {createRoadTerrain} from '/js/engines/kart-road-terrain.mjs';
import {elevatedMap} from '/js/engines/kart-elevated-maps.mjs';
const params=new URLSearchParams(location.search),id=params.get('map')||'garden',classic=params.get('raised')!=='1',driver=params.get('driver')||'fox';
const map=classic?await(await fetch('/classic-map?id='+id)).json():elevatedMap(id),R=await loadClassicPhysics(),terrain=classic?createRoadTerrain(map):null;
const solids=classic?classicStatics(map,terrain):map.colliders,query=createKartPhysics(R,config);for(const s of solids)query.addStatic(s);
let input={steer:0,throttle:0},seq=0,epoch=0,viewReady=false,built;
const k={pid:'p0',id:'p0',alive:true,connected:true,spawnSeq:1,controlEpoch:1,health:3,maxHealth:3,nitro:1,hits:0,deaths:0,shield:0,guard:false,weapon:null,ammo:0,respawn:0,speed:0,angle:0,x:0,z:0,input};
const room={...map,map:id,mode:'battle',karts:[k],physicalEvents:[],physicalEventSeq:0,featureEvents:[],featureEventSeq:0};
const physics=classic?createClassicMotion(R,config,room):createKartPhysics(R,config);
if(!classic){for(const s of solids)physics.addStatic(s);physics.addKart(k.id,{position:{x:0,y:.75,z:0}});}
const root=document.querySelector('#gbody'),view=classic?createKartView({}):createElevatedKartView();
for(const href of view.styles){const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.append(link);}
function poseAt(x,z,angle,y){return{position:{x,y:y??(terrain?.heightAt(x,z)||0)+.75,z},rotation:{x:0,y:Math.sin(angle/2),z:0,w:Math.cos(angle/2)},linearVelocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0},epoch:++epoch};}
function place(name){
  let p;
  if(classic&&name==='cannon'){
    const c=map.features.cannons[0],s=Math.sin(c.angle),co=Math.cos(c.angle);p=poseAt(c.x+s+co*3.8,c.z+co-s*3.8,c.angle+Math.PI/2);
  }else if(classic&&name==='mouth'){
    const c=map.features.cannons[0];p=poseAt(c.x-Math.sin(c.angle)*6,c.z-Math.cos(c.angle)*6,c.angle);
  }else if(!classic&&name==='wall'){
    outer:for(const d of solids){if(d.shape!=='box'||d.half.y<1.5||d.half.y>10)continue;
      for(const side of [-1,1]){
        const q=new THREE.Quaternion().copy(d.rotation||{x:0,y:0,z:0,w:1}),v=new THREE.Vector3(side*(d.half.x+1.8),0,0).applyQuaternion(q).add(d.position);
        const support=query.supportAt({x:v.x,y:60,z:v.z},100);if(!support)continue;v.y=support.point.y+.75;
        if(query.overlapsStatic(v,{x:0,y:0,z:0,w:1}))continue;
        const angle=Math.atan2(side,0)+2*Math.atan2(q.y,q.w),eye={x:v.x-Math.sin(angle)*8.5,y:v.y+4.4,z:v.z-Math.cos(angle)*8.5};
        if(query.sweepStatic(v,eye,.22)){p=poseAt(v.x,v.z,angle,v.y);break outer;}
      }
    }
  }
  if(!p){const s=map.spawns[0];p=poseAt(s.x,s.z,s.angle||0,classic?undefined:(s.y||0)+.75);}
  input={steer:0,throttle:0};k.input=input;k.flight=null;k.cannonCd=0;k.portalCd=0;
  if(classic)physics.restore(k,p);else physics.resetKart(k.id,p);
  sendSnapshot();return p;
}
function sendSnapshot(){
  const p=classic?k.physicalPose:physics.pose(k.id),time=Date.now();
  const snapshot={instanceId:'camera-'+id,simAt:time,simTick:Math.round(time/16.6667),endsAt:time+180000,mode:'battle',modeLabel:'Kart battle',phase:classic?'drive':'live',you:k.id,youDrive:true,
    map:classic?map:{label:map.label},mapId:id,mapRevision:map.revision,palette:'Daybreak',players:[{id:k.id,name:driver}],crates:[],stars:[],events:[],arenaEvents:room.featureEvents,physicalEvents:[],zaps:[],mines:[],grenades:[],projectiles:[],scores:{},
    inputAck:{life:1,controlEpoch:1,receivedSeq:seq,appliedInputSeq:seq},karts:[{...k,physicalPose:classic?p:undefined,pose:p}],...(classic?{motionProfile:'rapier-classic-v1'}:{profile:'elevated-combat-v1'})};
  view.update(root,snapshot,api);
}
const api={now:()=>Date.now(),send(message){input={...(message.input||message)};seq=message.seq||seq;k.input=input;k._receivedSeq=seq;},name:()=>driver,announce(){},context:()=>({isHost:false,sound:false,connected:true,looks:{p0:{driver,paint:'bubblegum',color:0xca49b0}}})};
globalThis.kartCameraProbe={built(value){built=value;}};
view.mount(root,api);place(params.get('case')||'rear');await view.ready();viewReady=true;
const timer=setInterval(()=>{if(classic)physics.advance(1/60,new Set([k.pid]));else{physics.applyIntent(k.id,input);physics.step();}sendSnapshot();},1000/60);
globalThis.kartCameraCheck={ready:true,place,
  result(){const model=built.scene.children.find(o=>o.name==='GiggleKart'),eye=built.camera.position;return{map:id,classic,driver,pose:classic?k.physicalPose:physics.pose(k.id),eye:eye.toArray(),direction:built.camera.getWorldDirection(new THREE.Vector3()).toArray(),model:model?.position.toArray(),eyeOverlapsSolid:query.overlapsStatic(eye,{x:0,y:0,z:0,w:1},{x:.12,y:.12,z:.12}),modelVisible:model?.visible,flight:k.flight,sceneObjects:built.scene.children.length};},
  dispose(){viewReady=false;clearInterval(timer);view.dispose();physics.dispose();query.dispose();}
};
