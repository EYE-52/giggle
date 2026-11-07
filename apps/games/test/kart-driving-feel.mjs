import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import config,{CLASSIC_CONTACT_TUNING} from '../public/js/engines/kart-physics-config.mjs';
import {createClassicMotion} from '../public/js/engines/kart-classic-motion.mjs';
import {createClassicPrediction} from '../public/js/engines/kart-classic-prediction.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {stepDrift,DRIFT_TIERS} from '../public/js/engines/kart-drift.mjs';
import {SURFACE_PROFILES,createSurfaceIndex,surfaceTuning} from '../public/js/engines/kart-surface.mjs';
import {createKartDrivingFX,DRIVING_PARTICLE_LIMIT} from '../public/js/engines/kart-driving-fx.mjs';
import {createKartSkids} from '../public/js/engines/kart-skids.mjs';
await R.init();
const contactConfig={...config,softCcdPrediction:.7,arcadeContacts:CLASSIC_CONTACT_TUNING,chassis:{...config.chassis,friction:CLASSIC_CONTACT_TUNING.friction,restitution:CLASSIC_CONTACT_TUNING.restitution}};
for(let tier=1;tier<=3;tier++) {
 const k={speed:18,input:{throttle:1,steer:1,drift:true}};
 for(let i=0;i<Math.ceil(DRIFT_TIERS[tier-1].seconds*60);i++)stepDrift(k,1/60);
 assert.equal(k.driftTier,tier);assert.equal(k.turbo||0,0,'holding never awards a turbo');
 k.input.drift=false;stepDrift(k,1/60);assert.equal(k.turbo,DRIFT_TIERS[tier-1].boost);
 k.turbo=0;stepDrift(k,1/60);assert.equal(k.turbo,0,'release cannot repeat');
}
for(const cancel of ['ground','speed','brake']) {
 const k={speed:18,input:{throttle:1,steer:1,drift:true}};
 for(let i=0;i<110;i++)stepDrift(k,1/60);
 if(cancel==='speed')k.speed=0;if(cancel==='brake')k.input.throttle=-1;
 stepDrift(k,1/60,cancel!=='ground');k.input.drift=false;stepDrift(k,1/60);
 assert.equal(k.turbo||0,0,cancel+' cancels without a reward');
}
const index=createSurfaceIndex({roads:[{width:6,points:[[-100,0],[100,0]]}],offroad:{kind:'grass'},surfaces:[{x:0,z:0,hw:4,hd:4,kind:'ice',grip:.22}],pads:[{x:20,z:0,hw:2,hd:2}]});
assert.equal(surfaceTuning(index,0,0).kind,'ice','ice overrides the road beneath it');
assert.equal(surfaceTuning(index,20,0).kind,'boost');assert.equal(surfaceTuning(index,10,0).kind,'road');assert.equal(surfaceTuning(index,0,20).kind,'grass');
assert.equal(surfaceTuning(index,0,20),surfaceTuning(index,0,20),'queries reuse immutable records');
const metrics=[];
for(const kind of Object.keys(SURFACE_PROFILES).filter(k=>k!=='boost')) {
 const map={id:'feel-fixture',half:200,blocks:[],pads:[],surfaces:[],roads:[],offroad:{kind}};
 const k={pid:'a',x:0,z:-50,angle:0,speed:0,input:{throttle:1,steer:0},spawnSeq:0,nitro:1,connected:true};
 const state={...map,map:map.id,mode:'battle',karts:[k],physicalEvents:[],physicalEventSeq:0};
 const motion=createClassicMotion(R,config,state),prediction=createClassicPrediction(R),online=new Set(['a']);
 let t=0,maxError=0,peakAngle=0,straight=0,reward=0;
 const snapshot=()=>{const kart=structuredClone(k);delete kart._driftHeld;return {instanceId:'surface-'+kind,phase:'drive',mode:'battle',you:'a',youDrive:true,map,karts:[kart],simAt:t,inputAck:{controlEpoch:0}};};
 let packet=snapshot();prediction.ingest(packet,0,0);
 for(let i=1;i<=300;i++) {
  t=i*1000/60;k.input={throttle:1,steer:i>180&&i<285?.7:0,drift:i>180&&i<285};
  motion.advance(1/60,online);prediction.frame(packet,k.input,1/60,t,t);
  const p=prediction.selfPose();maxError=Math.max(maxError,Math.hypot(k.x-p.position.x,k.z-p.position.z));
  if(i===180)straight=k.speed;if(k._driftHeld)peakAngle=Math.max(peakAngle,Math.atan2(Math.abs(k.slip),Math.abs(k.speed)));if(i===285)reward=k.turbo;
  if(i%3===0){packet=snapshot();prediction.ingest(packet,t,t);}
 }
 assert.ok(maxError<.025,kind+' prediction agrees through drift and release: '+maxError);
 assert.ok(reward>1.3&&reward<=1.4,kind+' purple release gives long turbo');assert.ok(peakAngle>.2,kind+' visible physical slide angle');
 metrics.push({kind,straight,peakAngle,maxError,reward});motion.dispose();prediction.dispose();
}
const road=metrics.find(m=>m.kind==='road');
for(const kind of ['grass','sand','snow','gravel'])assert.ok(metrics.find(m=>m.kind===kind).straight<road.straight*.85,kind+' slower than asphalt');
const recovery=[];
for(const kind of ['road','ice']) {
 const k={pid:'a',x:0,z:0,angle:0,speed:14,input:{throttle:0,steer:0},spawnSeq:0};
 const s={map:'recovery-fixture',half:200,blocks:[],pads:[],surfaces:[],roads:[],offroad:{kind},karts:[k],physicalEvents:[],physicalEventSeq:0};
 const w=createClassicMotion(R,config,s),online=new Set(['a']);w.restore(k,{...k.physicalPose,linearVelocity:{x:8,y:0,z:14}});let distance=0;
 for(let i=0;i<45;i++){w.advance(1/60,online);distance+=Math.abs(k.slip)/60;}
 recovery.push({kind,distance,slip:k.slip});w.dispose();
}
assert.ok(recovery[1].distance>recovery[0].distance*1.3,'ice carries lateral momentum longer than asphalt');
{
 const w=createKartPhysics(R,contactConfig);
 w.addStatic({id:'floor',shape:'box',half:{x:200,y:.5,z:200},position:{x:0,y:-.5,z:0}});
 w.addStatic({id:'wall',shape:'box',half:{x:.5,y:3,z:100},position:{x:5,y:3,z:0}});
 w.addKart('a',{position:{x:0,y:.75,z:0}});w.step(15);const p=w.pose('a');w.restoreKart('a',{...p,linearVelocity:{x:6,y:0,z:12}});w.applyIntent('a',{throttle:1,steer:0});
 let maxX=0,peakYaw=0;for(let i=0;i<180;i++){w.step();const p=w.pose('a');maxX=Math.max(maxX,p.position.x);peakYaw=Math.max(peakYaw,Math.abs(p.angularVelocity.y));}
 assert.ok(maxX<3.4,'sidewall contact cannot sink into wall');assert.ok(w.pose('a').position.z>25,'wall contact keeps sliding forward');assert.ok(peakYaw<=3.01);w.dispose();
}
// Equal opposing hits separate the real hulls; impulse cannot create overlap.
{
 const w=createKartPhysics(R,contactConfig),hull=new R.Cuboid(config.chassis.half.x,config.chassis.half.y,config.chassis.half.z);
 w.addStatic({id:'floor',shape:'box',half:{x:100,y:.5,z:100},position:{x:0,y:-.5,z:0}});
 w.addKart('a',{position:{x:0,y:.75,z:-6}});w.addKart('b',{position:{x:.35,y:.75,z:6},rotation:{x:0,y:1,z:0,w:0}});w.step(15);
 for(const [id,vz]of [['a',12],['b',-12]])w.restoreKart(id,{...w.pose(id),linearVelocity:{x:0,y:0,z:vz}});
 let minGap=Infinity,contacts=0;
 for(let i=0;i<180;i++){w.step();const a=w.pose('a'),b=w.pose('b'),contact=hull.contactShape(a.position,a.rotation,hull,b.position,b.rotation,1);if(contact)minGap=Math.min(minGap,contact.distance);contacts+=w.drainImpacts().length;}
 const a=w.pose('a'),b=w.pose('b');assert.ok(contacts>0);assert.ok(minGap>-.04,'kart hull penetration stays below four centimetres: '+minGap);assert.ok(Math.hypot(a.position.x-b.position.x,a.position.z-b.position.z)>5,'karts bounce apart instead of staying locked');w.dispose();
}

{
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,1,.1,200),fx=createKartDrivingFX(THREE,scene,camera),skids=createKartSkids(THREE,scene);
 for(let frame=0;frame<240;frame++){for(let p=0;p<32;p++)fx.track(String(p),p,.65,frame/3,0,20,true,1,SURFACE_PROFILES.gravel);fx.update(1/60,25,true);}
 assert.equal(fx.stats().capacity,DRIVING_PARTICLE_LIMIT);assert.ok(fx.stats().live<=DRIVING_PARTICLE_LIMIT);assert.equal(fx.stats().drivers,32);assert.ok(fx.speedLines.visible);
 for(let i=0;i<90;i++)fx.update(1/60);assert.equal(fx.stats().live,0);
 skids.track('a',0,0,0,true,SURFACE_PROFILES.sand);skids.track('a',0,1,0,true,SURFACE_PROFILES.sand);assert.ok(Math.abs(skids.mesh.geometry.getAttribute('skidTint').array[3]-SURFACE_PROFILES.sand.opacity)<1e-6);
 fx.reset();assert.equal(fx.stats().drivers,0);fx.dispose();fx.dispose();skids.dispose();assert.equal(fx.particles.parent,null);
 const reduced=createKartDrivingFX(THREE,scene,camera,{reducedMotion:true});reduced.track('a',0,.65,0,0,25,true,1,SURFACE_PROFILES.road);reduced.update(1/60,25,true);assert.equal(reduced.stats().live,0);assert.equal(reduced.speedLines.visible,false);reduced.dispose();
}
console.log(JSON.stringify({pass:true,scope:'shared Rapier drift/surface/prediction and bounded Three.js pools; no physical-phone verdict',tiers:DRIFT_TIERS,metrics,recovery}));
