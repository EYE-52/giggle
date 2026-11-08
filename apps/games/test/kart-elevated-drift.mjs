import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-compat';
import C from '../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {createElevatedMotion} from '../public/js/engines/kart-elevated-motion.mjs';
import {createElevatedPrediction} from '../public/js/engines/kart-elevated-prediction.mjs';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {DRIFT_TIERS,stepDrift} from '../public/js/engines/kart-drift.mjs';
import {blendElevatedPose} from '../public/js/engines/kart-elevated-pose.mjs';
import COMBAT from '../games/engines/kart-elevated-combat.js';
await R.init();
const neutral=()=>({steer:0,throttle:0,brake:0,nitro:false,use:false}),stepMs=1000/60;
// The exact classic charge thresholds and release rewards, with cancellation.
for(const [i,tier]of DRIFT_TIERS.entries()){
 const k={speed:15,turbo:0,input:{steer:1,throttle:1,drift:true}};
 for(let n=0;n<Math.ceil(tier.seconds*60);n++)stepDrift(k,C.fixedDt,true);
 assert.equal(k.driftTier,i+1);k.input.drift=false;stepDrift(k,C.fixedDt,true);assert.equal(k.turbo,tier.boost);
 const air={speed:15,driftCharge:1,_driftHeld:true,input:{steer:1,throttle:1,drift:false}};stepDrift(air,C.fixedDt,false);assert(!air.turbo&&!air.driftCharge,'Leaving the road never awards a release boost');
}
const map=elevatedMap('garden');Object.assign(map.spawns[0],{surface:'floor',x:0,y:0,z:-50,angle:0});
const game=COMBAT.createElevatedCombat(R,C,map,[{id:'a'},{id:'b'}],{instance:'drift-match',seed:9,countdownMs:0,roundMs:20000,crates:1});
const own=()=>{const s=game.snapshot('a');return {...s,instanceId:s.instance,you:'a',youDrive:true,inputAck:s.you,karts:s.karts.map(k=>({...k,driftCharge:+k.driftCharge.toFixed(5),turbo:+k.turbo.toFixed(5),pose:{...k.pose,
 position:Object.fromEntries(Object.entries(k.pose.position).map(([a,n])=>[a,+n.toFixed(3)])),rotation:Object.fromEntries(Object.entries(k.pose.rotation).map(([a,n])=>[a,+n.toFixed(6)])),
 wheels:k.pose.wheels.map(w=>({length:w.length,rotation:w.rotation,steering:w.steering}))}}))};};
const prediction=createElevatedPrediction(R),tiers=new Set();let maxError=0,maxChargeError=0,sawBoost=false;
try{
 game.advance(stepMs);let snapshot=own();prediction.ingest(snapshot,1000,game.snapshot().serverAt);
 for(let n=1;n<330;n++){
  const input={...neutral(),throttle:1,steer:n>=130&&n<250?1:0,brake:n>=130&&n<250?1:0};
  const s=game.snapshot('a');assert(game.input('a',{...input,instance:s.instance,life:s.you.life,controlEpoch:s.you.controlEpoch,seq:s.you.receivedSeq+1},s.serverAt).ok);
  const arrival=1000+n*stepMs,at=s.serverAt+stepMs,predicted=prediction.frame(snapshot,input,C.fixedDt,arrival,at);
  game.advance(at);const current=own(),kart=current.karts[0];
  if(predicted){maxError=Math.max(maxError,Math.hypot(...['x','y','z'].map(k=>predicted.pose.position[k]-kart.pose.position[k])));maxChargeError=Math.max(maxChargeError,Math.abs((predicted.driftCharge||0)-kart.driftCharge));assert.equal(predicted.driftTier||0,kart.driftTier||0,'Client and authority keep the same drift tier');}
  if(kart.driftTier)tiers.add(kart.driftTier);if(kart.turbo>0)sawBoost=true;
  if(n%3===0){snapshot=current;prediction.ingest(snapshot,arrival,at);}
 }
 assert.deepEqual([...tiers],[1,2,3],'Real elevated physics reaches blue, orange and purple with held brake/steer');assert(sawBoost,'Real elevated release activates turbo');
 assert(maxError<.12,'Prediction stays within 12cm through a held/released drift: '+maxError);assert(maxChargeError<.011,'Prediction restores and replays normalized charge: '+maxChargeError);
 const s=own();prediction.ingest(s,7000,s.serverAt);assert(prediction.frame(s,{...neutral(),throttle:1},.016,7300,s.serverAt+300),'A 300ms packet gap keeps prediction active');
 game.setConnected('a',false);game.setConnected('a',true);const fresh=own();prediction.ingest(fresh,7400,fresh.serverAt);assert(!fresh.karts[0].driftCharge&&!fresh.karts[0].turbo,'Reconnect cancels stored drift/boost');assert(prediction.stats().history===0,'Reconnect clears queued prediction intervals');
}finally{game.dispose();prediction.dispose();prediction.dispose();}
// Real wheel traction differs by support surface, without squaring map grip.
function slide(material,grip){
 const map={colliders:[{id:'floor',shape:'box',position:{x:0,y:-1,z:0},half:{x:100,y:1,z:100},material,grip}]},p=createKartPhysics(R,C);map.colliders.forEach(d=>p.addStatic(d));
 p.addKart('a',{position:{x:0,y:1,z:0}});for(let i=0;i<90;i++)p.step();p.restoreKart('a',{...p.pose('a'),linearVelocity:{x:8,y:0,z:12}});
 const k={id:'a',alive:true,connected:true,spawnSeq:0,nitro:1,input:{...neutral(),throttle:1}},motion=createElevatedMotion({physics:p,map,karts:[k]});
 for(let i=0;i<60;i++){motion.controls(k,C.fixedDt);p.step();motion.afterStep(C.fixedDt);}const result={x:p.pose('a').position.x,surface:k.surface};p.dispose();return result;
}
const road=slide('asphalt',1),ice=slide('ice',.38);assert(ice.x>road.x+1,'Ice retains a longer sideways slide than road');assert.equal(ice.surface,'ice');assert.equal(road.surface,'road');
const a={alive:true,spawnSeq:1,controlEpoch:1,pose:{epoch:1}},b={...a,pose:{epoch:2}};assert.equal(blendElevatedPose(a,b,.5),b.pose,'A portal epoch snaps rather than interpolating across floors');
console.log('PASS elevated classic drift tiers/release, real wheel traction, server/client replay, epoch/loss/reset safety');console.log(JSON.stringify({maxError,maxChargeError,tiers:[...tiers],road,ice}));
