import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import config from '../public/js/engines/kart-physics-config.mjs';
import {createClassicMotion,classicControls} from '../public/js/engines/kart-classic-motion.mjs';
await RAPIER.init();
function run({manual=false,ice=false,garage=false}={}){
 const k={pid:'a',x:0,z:-35,angle:0,speed:0,boost:0,boostCd:0,turbo:0,padCd:0,nitro:1,input:{throttle:1,steer:0},spawnSeq:0,connected:true,garage,upgrades:{engine:3,handling:3}};
 const s={map:'garden',mode:'battle',half:120,blocks:[],pads:[],surfaces:ice?[{x:0,z:0,hw:110,hd:110,grip:.4}]:[],karts:[k],physicalEvents:[],physicalEventSeq:0};
 const w=createClassicMotion(RAPIER,config,s),online=new Set(['a']);let peakSlip=0,peakSpeed=0,peakAngular=0;
 const step=(n,input)=>{let maxSlip=0,minSpeed=Infinity,minLinearSpeed=Infinity,path=0,heading=0;k.input=input;for(let i=0;i<n;i++){const before={x:k.x,z:k.z,angle:k.angle};w.advance(1/60,online);path+=Math.hypot(k.x-before.x,k.z-before.z);heading+=Math.atan2(Math.sin(k.angle-before.angle),Math.cos(k.angle-before.angle));peakSlip=Math.max(peakSlip,Math.abs(k.slip));maxSlip=Math.max(maxSlip,Math.abs(k.slip));minSpeed=Math.min(minSpeed,k.speed);minLinearSpeed=Math.min(minLinearSpeed,Math.hypot(k.physicalPose.linearVelocity.x,k.physicalPose.linearVelocity.z));peakSpeed=Math.max(peakSpeed,Math.abs(k.speed));peakAngular=Math.max(peakAngular,Math.hypot(...Object.values(k.physicalPose.angularVelocity)));s.physicalEvents.length=0;}return {maxSlip,minSpeed,minLinearSpeed,path,heading,radius:path/Math.max(.0001,Math.abs(heading))};};
 step(180,{throttle:1,steer:0});const straight=k.speed;
 const turnStats=step(90,{throttle:1,steer:1,drift:manual});const turn={speed:k.speed,slip:k.slip,angle:k.angle,velocity:{...k.physicalPose.linearVelocity}};
 step(90,{throttle:1,steer:-1,drift:manual});const counter={speed:k.speed,slip:k.slip,angle:k.angle};
 step(120,{throttle:-1,steer:0});const brake=k.speed;
 step(480,{throttle:1,steer:0,nitro:true});const nitro={amount:k.nitro,locked:k.nitroLocked,active:k.nitroActive,speed:k.speed};
 assert.ok(Number.isFinite(peakSlip)&&Number.isFinite(peakAngular));assert.ok(peakSpeed<40,'bounded forward/boost speed');assert.ok(peakAngular<8,'no infinite spin');assert.ok(nitro.amount>=0&&nitro.amount<=1,'finite fuel');
 w.dispose();return {manual,ice,garage,straight,turnStats,turn,counter,brake,nitro,peakSlip,peakSpeed,peakAngular};
}
const cases=[run(),run({manual:true}),run({ice:true}),run({garage:true})];
const [normal,manual,ice,garage]=cases;
assert.ok(manual.turnStats.maxSlip>1.4,'manual drift produces measured lateral slip');
assert.ok(manual.turnStats.minLinearSpeed>manual.straight*.45,'held sharp drift retains bounded world momentum');
assert.ok(Math.abs(manual.counter.angle)<Math.abs(manual.turn.angle),'counter steering recovers heading');
assert.ok(normal.turnStats.maxSlip<manual.turnStats.maxSlip,'automatic slip is milder');
assert.ok(ice.turnStats.radius>normal.turnStats.radius,'actual ice grip changes physical turn radius');
assert.ok(cases.every(c=>c.brake<0),'opposite throttle brakes and then reverses');
assert.ok(garage.straight>normal.straight,'actual Garage engine tuning increases speed');
for(const grounded of [false,true]){
 const k={speed:grounded?0:18,slip:0,nitro:1,input:{throttle:1,steer:1,drift:true},physicalPose:{grounded,angularVelocity:{y:0}}};
 const controls=classicControls(k,1/60,{pads:[]},true);
 assert.equal(controls.tuning.rearTraction,1,'no manual drift while parked or airborne');
 assert.equal(k.driftCharge,0);
}

console.log(JSON.stringify({scope:'actual controller legal-intent unit fixture, not native acceptance',cases},null,2));
