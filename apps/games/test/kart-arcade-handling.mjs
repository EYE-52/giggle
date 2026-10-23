// Actual Rapier rollout: compare the shipped prior handling with the arcade
// response, including production authority Nitro drain and turning.
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import PHYSICS from '../games/engines/kart-physics.js';
import COMBAT from '../games/engines/kart-elevated-combat.js';
import ENGINE from '../games/engines/kart-engine.js';
import {stepSelf} from '../public/js/engines/kart-pose.mjs';
import {elevatedMap,elevatedMapIds} from '../public/js/engines/kart-elevated-maps.mjs';
import {PROTOTYPE_SOLIDS} from './fixtures/kart-elevation/layout.mjs';
await RAPIER.init();
const results=[],check=(name,value)=>{assert.ok(value,name);results.push(name);};
const floor={id:'floor',shape:'box',half:{x:500,y:1,z:500},position:{x:0,y:-1,z:0}},spawn=(x=0,z=0)=>({position:{x,y:1,z}});
const up=p=>1-2*(p.rotation.x**2+p.rotation.z**2),yaw=p=>Math.atan2(2*(p.rotation.x*p.rotation.z+p.rotation.w*p.rotation.y),1-2*(p.rotation.x**2+p.rotation.y**2));
const world=(config=CONFIG,solids=[floor])=>{const w=PHYSICS.createKartPhysics(RAPIER,config);for(const s of solids)w.addStatic(s);w.addKart('driver',spawn());for(let i=0;i<120;i++)w.step();return w;};
const baseline={...CONFIG,handling:{...CONFIG.handling,engineForce:650,maxForward:20,highSpeedSteer:.045}};
function rollout(config,boost=false,steer=.6){
 const w=world(config);try{
  if(boost)w.tuneKart('driver',{top:ENGINE.constants.NITRO_SPEED,engine:ENGINE.constants.NITRO_PUNCH});
  w.applyIntent('driver',{throttle:1,steer:0});let timeTo10=null;const trajectory=[];
  for(let i=1;i<=480;i++){w.step();const p=w.pose('driver');if(p.speed>=10&&timeTo10===null)timeTo10=i/60;if([30,60,120,180].includes(i))trajectory.push({seconds:i/60,speed:p.speed,distance:p.position.z});}
  const cruise=w.pose('driver');w.applyIntent('driver',{throttle:1,steer});let lastYaw=yaw(cruise),turn=0,minUp=1,minWheelContacts=4;
  for(let i=0;i<120;i++){w.step();const p=w.pose('driver'),nextYaw=yaw(p);turn+=((nextYaw-lastYaw+3*Math.PI)%(2*Math.PI))-Math.PI;lastYaw=nextYaw;minUp=Math.min(minUp,up(p));minWheelContacts=Math.min(minWheelContacts,p.wheels.filter(w=>w.contact).length);}
  const turned=w.pose('driver');w.applyIntent('driver',{throttle:0,steer:0,brake:1});let brakeSeconds=null;for(let i=1;i<=90;i++){w.step();if(brakeSeconds===null&&Math.abs(w.pose('driver').speed)<.5)brakeSeconds=i/60;}
  check((boost?'nitro':'cruise')+' brakes physical forward motion without changing mass/brakes',Math.abs(w.pose('driver').speed)<.5);
  return {timeTo10,trajectory,brakeSeconds,cruise:cruise.speed,turnSpeed:turned.speed,turnDegrees:turn*180/Math.PI,minUp,minWheelContacts};
 }finally{w.dispose();}
}
const before=rollout(baseline),after=rollout(CONFIG),nitro=rollout(CONFIG,true),nitroFullTurn=rollout(CONFIG,true,1);
check('arcade launch reaches ten m/s within half a second and sooner than prior handling',after.timeTo10<=.5&&after.timeTo10<before.timeTo10);
check('actual flat-ground cruise is 23 to 26 m/s and over 25 percent faster',after.cruise>23&&after.cruise<26&&after.cruise>before.cruise*1.25);
check('one-second acceleration and three-second distance improve at least 25 percent',after.trajectory[1].speed>before.trajectory[1].speed*1.25&&after.trajectory[3].distance>before.trajectory[3].distance*1.25);
check('normal and Nitro high-speed turns retain upright wheel support',after.minUp>.98&&nitro.minUp>.98&&after.minWheelContacts===4&&nitro.minWheelContacts===4);
check('full-lock boosted turn remains upright with all four wheels supported',nitroFullTurn.minUp>.98&&nitroFullTurn.minWheelContacts===4);
check('turn response stays useful without spinning across a full revolution',Math.abs(after.turnDegrees)>100&&Math.abs(after.turnDegrees)<200&&Math.abs(nitro.turnDegrees)>80&&Math.abs(nitro.turnDegrees)<200);
check('Nitro has distinct faster physical speed with bounded cap',nitro.cruise>after.cruise*1.4&&nitro.cruise<CONFIG.handling.maxForward*ENGINE.constants.NITRO_SPEED);
{
 const wall={id:'wall',shape:'box',half:{x:8,y:3,z:.5},position:{x:0,y:3,z:60}},w=world(CONFIG,[floor,wall]);
 try{w.tuneKart('driver',{top:ENGINE.constants.NITRO_SPEED,engine:ENGINE.constants.NITRO_PUNCH});w.applyIntent('driver',{throttle:1,steer:0});let maxZ=0,finite=true;for(let i=0;i<360;i++){w.step();const p=w.pose('driver');maxZ=Math.max(maxZ,p.position.z);finite &&=Object.values(p.position).every(Number.isFinite)&&Object.values(p.rotation).every(Number.isFinite);}check('boosted wall contact keeps full physical pose finite',finite);check('boosted hull cannot tunnel through wall at new speed',maxZ<58.2&&w.pose('driver').position.z>57.6);}finally{w.dispose();}
}
const mapClimbs=[];
for(const id of elevatedMapIds){
 const map=elevatedMap(id),route=map.routes[0],ramp=map.colliders.find(s=>s.id===route.via),w=world(CONFIG,map.colliders);
 try{
  const angle=2*Math.atan2(ramp.rotation?.y||0,ramp.rotation?.w??1),distance=ramp.half.z+8;
  w.resetKart('driver',{position:{x:ramp.position.x-Math.sin(angle)*distance,y:1,z:ramp.position.z-Math.cos(angle)*distance},rotation:ramp.rotation});
  for(let i=0;i<120;i++)w.step();w.applyIntent('driver',{throttle:1,steer:0});let climbed=false,finite=true,maxY=0;
  for(let i=0;i<360;i++){w.step();const p=w.pose('driver');maxY=Math.max(maxY,p.position.y);climbed ||=p.wheels.some(w=>w.contact&&w.surfaceId===route.to);finite &&=Object.values(p.position).every(Number.isFinite)&&Object.values(p.rotation).every(Number.isFinite);}
  check(id+' production ramp reaches its raised deck with finite physical pose',climbed&&finite);
  mapClimbs.push({id,route:route.id,reached:route.to,maxY});
 }finally{w.dispose();}
}
const classic={x:0,z:0,angle:0,speed:0,input:{throttle:1,steer:0,boost:false}},predicted={...classic};const classicTrajectory=[];
for(let tick=1;tick<=180;tick++){
 ENGINE.helpers.stepKart(classic,1/60,{bound:100,allowBoost:false});stepSelf(predicted,classic.input,1/60,{bound:100,allowBoost:false});
 check('classic speed and pose mirror agree at tick '+tick,['x','z','angle','speed','slip'].every(k=>Math.abs((classic[k]||0)-(predicted[k]||0))<1e-9));
 if([30,60,120,180].includes(tick))classicTrajectory.push({seconds:tick/60,speed:classic.speed,distance:classic.z});
}
check('classic launch reaches stock twenty m/s and keeps full throttle intent',classicTrajectory[1].speed===20&&classic.speed===20&&classic.input.throttle===1);
{
 const w=world(CONFIG,[floor,...PROTOTYPE_SOLIDS.slice(1,5)]);try{
  w.resetKart('driver',spawn(0,-25));for(let i=0;i<120;i++)w.step();w.applyIntent('driver',{throttle:1,steer:0});let maxY=0,bridge=false,down=false,landed=false;
  for(let i=0;i<360;i++){w.step();const p=w.pose('driver');maxY=Math.max(maxY,p.position.y);bridge ||=p.wheels.some(w=>w.surfaceId==='bridge');down ||=p.wheels.some(w=>w.surfaceId==='ramp-down');landed ||=p.position.z>34&&p.position.y<1&&p.grounded;}
  check('faster kart climbs and traverses real ramp/raised deck/descent',maxY>4.5&&bridge&&down&&landed);
  w.resetKart('driver',spawn(18,-25));for(let i=0;i<120;i++)w.step();w.applyIntent('driver',{throttle:1,steer:0});let flight=false,landedJump=false;
  for(let i=0;i<360;i++){w.step();const p=w.pose('driver');flight ||=p.position.z>7&&!p.grounded&&p.position.y>3.5;landedJump ||=flight&&p.position.z>14&&p.grounded&&p.position.y<1;}
  check('faster jump preserves physical flight and supported landing',flight&&landedJump);
 }finally{w.dispose();}
}
const point=(id,x,z)=>({id,surface:'floor',x,y:0,z,angle:0});
const map={id:'handling',revision:'handling-1',half:500,colliders:[floor],spawns:[point('a',0,0),point('b',200,200)],sockets:[point('c0',-100,-100),point('c1',-100,100)]};
const battle=COMBAT.createElevatedCombat(RAPIER,CONFIG,map,[{id:'a'},{id:'b'}],{instance:'handling',seed:1,startAt:0,countdownMs:0,roundMs:20000,crates:1});
let authorityNitroPeak=0,spent=false,sawNitro=false,minAuthorityUp=1;
try{
 for(let tick=1;tick<=480;tick++){
  const at=(tick-1)*1000/60,ack=battle.snapshot('a').you;
  if(tick%6===1)assert.ok(battle.input('a',{instance:'handling',seq:ack.receivedSeq+1,life:ack.life,controlEpoch:ack.controlEpoch,throttle:1,steer:tick>180&&tick<300?.6:0,brake:0,nitro:tick>120&&tick<=360,use:false},at).ok);
  battle.advance(tick*1000/60);const k=battle.snapshot().karts[0];sawNitro ||=k.nitroActive;spent ||=tick>180&&tick<=360&&!k.nitroActive&&k.nitro<.3;minAuthorityUp=Math.min(minAuthorityUp,up(k.pose));if(k.nitroActive)authorityNitroPeak=Math.max(authorityNitroPeak,k.pose.speed);
 }
 check('real authority Nitro produces faster speed, drains and locks',sawNitro&&spent&&authorityNitroPeak>35&&authorityNitroPeak<CONFIG.handling.maxForward*ENGINE.constants.NITRO_SPEED);
 check('real authority held Nitro turning remains upright',minAuthorityUp>.98);
}finally{battle.dispose();}
console.log(JSON.stringify({pass:true,checks:results.length,before,after,nitro,nitroFullTurn,mapClimbs,classicTrajectory,authorityNitroPeak,minAuthorityUp,scope:'Actual Rapier driving/turn/brake/ramp/jump/wall rollout, four production map climbs, production authority input/Nitro, and classic prediction parity. Does not claim subjective fun or native frame performance.'},null,2));
