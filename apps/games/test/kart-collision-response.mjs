import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-compat';
import config from '../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {createClassicMotion} from '../public/js/engines/kart-classic-motion.mjs';
await R.init();
const metrics=[];
function run(scenario,restitution=config.chassis.restitution){
 const C=structuredClone(config);C.chassis.restitution=restitution;C.handling.coastBrake=4;
 const w=createKartPhysics(R,C),angle=scenario==='glance'?.6:0,rotation={x:0,y:Math.sin(angle/2),z:0,w:Math.cos(angle/2)};
 w.addStatic({id:'floor',shape:'box',half:{x:100,y:.5,z:100},position:{x:0,y:-.5,z:0}});
 const wall=['wall','glance'].includes(scenario),pair=['transfer','offcentre'].includes(scenario);
 if(wall)w.addStatic({id:'wall',shape:'box',half:{x:100,y:3,z:.5},position:{x:0,y:3,z:8}});
 w.addKart('a',{position:{x:0,y:.75,z:0},rotation});
 if(pair)w.addKart('b',{position:{x:scenario==='offcentre'?1.8:0,y:.75,z:8},rotation:{x:0,y:0,z:0,w:1}});
 w.step(15);w.step(15);const settled=w.pose('a');
 w.restoreKart('a',{...settled,position:scenario==='landing'?{x:0,y:4,z:0}:settled.position,linearVelocity:scenario==='landing'?{x:0,y:-8,z:0}:{x:Math.sin(angle)*12,y:0,z:Math.cos(angle)*12}});
 if(scenario==='wall')w.applyIntent('a',{throttle:1,steer:0});
 const hull=new R.Cuboid(C.chassis.half.x,C.chassis.half.y,C.chassis.half.z),wallHull=new R.Cuboid(100,3,.5);
 let first,before,peakYaw=0,maxY=settled.position.y,minGap=Infinity,grounded=false,landingPeak=0,final,eventCount=0,restingEvents=0;
 for(let i=0;i<240;i++){
  const prior=w.pose('a');w.step();const a=w.pose('a'),b=pair?w.pose('b'):null,events=w.drainImpacts();
  eventCount+=events.length;if(i>=120)restingEvents+=events.length;
  if(events.length&&!first){before=prior;first={a,b,impulse:events[0].impulse};}
  peakYaw=Math.max(peakYaw,Math.abs(a.angularVelocity.y),Math.abs(b?.angularVelocity.y||0));
  if(scenario!=='landing')maxY=Math.max(maxY,a.position.y,b?.position.y||0);
  grounded ||= a.grounded;if(grounded)landingPeak=Math.max(landingPeak,a.position.y);
  const contact=pair?hull.contactShape(a.position,a.rotation,hull,b.position,b.rotation,.5):wall?hull.contactShape(a.position,a.rotation,wallHull,{x:0,y:3,z:8},{x:0,y:0,z:0,w:1},.5):null;
  if(contact)minGap=Math.min(minGap,contact.distance);
  final=a;
 }
 w.dispose();return{scenario,first,before,peakYaw,maxY,minGap,landingPeak,final,eventCount,restingEvents};
}
for(const scenario of ['wall','glance','transfer','offcentre']){
 const m=run(scenario);assert.ok(m.first,scenario+' has a physical impact');
 assert.ok(m.minGap>-.035,scenario+' hull penetration is bounded: '+m.minGap);
 assert.ok(m.maxY<.8,scenario+' contact does not hop: '+m.maxY);
 if(scenario==='wall'){assert.ok(m.before.linearVelocity.z>15,'held throttle reaches driving speed');assert.ok(m.first.a.linearVelocity.z< -1.5,'wall causes visible normal rebound');assert.equal(m.restingEvents,0,'held throttle at rest does not chatter with impact events');}
 if(scenario==='glance'){assert.ok(m.first.a.linearVelocity.z<-.2,'glance separates along wall normal');assert.ok(m.first.a.linearVelocity.x>m.before.linearVelocity.x*.6,'glance preserves tangential motion');}
 if(scenario==='transfer'){assert.ok(m.first.b.linearVelocity.z>m.first.a.linearVelocity.z+.5,'striker transfers momentum and separates');assert.ok(m.first.a.linearVelocity.z>0,'striker retains bounded forward motion');}
 if(scenario==='offcentre'){assert.ok(m.peakYaw>.6&&m.peakYaw<3,'offcentre impulse produces bounded angular response');}
 metrics.push({scenario,incoming:m.before.linearVelocity,outgoing:m.first.a.linearVelocity,peerOutgoing:m.first.b?.linearVelocity,peakYaw:m.peakYaw,maxY:m.maxY,minGap:m.minGap,eventCount:m.eventCount,restingEvents:m.restingEvents});
}
const landing=run('landing'),inelastic=run('landing',0);
assert.ok(landing.landingPeak<1,'landing suspension remains bounded');
assert.ok(Math.abs(landing.final.position.y-inelastic.final.position.y)<.0001,'floor remains inelastic with chassis restitution');
assert.ok(Math.abs(landing.landingPeak-inelastic.landingPeak)<.0001,'floor bounce behavior is unchanged');
metrics.push({scenario:'landing',landingPeak:landing.landingPeak,finalY:landing.final.position.y,inelasticFinalY:inelastic.final.position.y});
// Wheel force at rest is not incoming crash velocity, including the maximum
// production garage engine upgrade while nitro pushes against a real fence.
for(const garage of [false,true]){
 const kart={pid:'pressure',x:0,z:28,angle:0,speed:0,boost:0,boostCd:0,turbo:0,padCd:0,nitro:1,
  input:{throttle:1,steer:0,nitro:true},spawnSeq:0,connected:true,garage,upgrades:{engine:3}};
 const state={map:'flat-pressure-fixture',mode:'battle',half:30,blocks:[],pads:[],surfaces:[],karts:[kart],physicalEvents:[],physicalEventSeq:0};
 const motion=createClassicMotion(R,config,state),online=new Set([kart.pid]);
 let contacts=0,restingContacts=0,nitroRestingSteps=0;
 for(let frame=0;frame<180;frame++){
  motion.advance(1/60,online);
  const wallContacts=state.physicalEvents.filter(e=>e.surfaceId?.startsWith('wall'));
  contacts+=wallContacts.length;
  if(frame>=60){restingContacts+=wallContacts.length;if(kart.nitroActive)nitroRestingSteps++;}
  state.physicalEvents.length=0;
 }
 assert.ok(contacts>0,'held nitro reaches the real fence with an initial impact');
 assert.ok(nitroRestingSteps>60,'resting-contact check includes sustained active nitro');
 assert.equal(restingContacts,0,'sustained fence pressure cannot retrigger crashes with garage='+garage);
 metrics.push({scenario:'nitro-fence-pressure',garage,contacts,restingContacts,nitroRestingSteps});
 motion.dispose();
}
console.log(JSON.stringify({pass:true,scope:'actual Rapier impulses, wheel suspension and hull distances; no native/browser verdict',metrics}));
