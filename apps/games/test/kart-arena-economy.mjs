import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {selectArenaVariant} from '../public/js/engines/kart-arena-policy.mjs';
import {createKartPickupPrediction} from '../public/js/engines/kart-pickup-prediction.mjs';
import combat from '../games/engines/kart-elevated-combat.js';
await RAPIER.init();
// Diagnostic home at an actual legal start. No grants, authority-private
// calls, clock mutations or position resets: all claims use ordinary inputs.
const map=selectArenaVariant(elevatedMap('rookie-ribbons'),2),start=map.spawns[0];
Object.assign(map.sockets[0],{x:start.x,y:start.y,z:start.z,surface:start.surface});
let match,initial;
for(let seed=0;seed<64;seed++){
 match=combat.createElevatedCombat(RAPIER,CONFIG,map,[{id:'a'},{id:'b'}],{instance:'economy',seed,startAt:0,countdownMs:0,roundMs:20000});
 initial=match.advance(50);if(initial.karts[0].weapon==='machinegun')break;match.dispose();match=null;
}
assert(match,'real pickup selects a machinegun within seed bound');
try{
 const home=initial.crates.find(c=>!c.available),position=home.position,coins=match.privateStatus('a').coins;
 assert(home&&home.homeId&&coins===1);assert(initial.karts[0].ammo>0);
 const input=(at,value)=>{const s=match.privateStatus('a');return match.input('a',{instance:'economy',life:s.life,controlEpoch:s.controlEpoch,seq:s.receivedSeq+1,steer:0,throttle:0,brake:0,nitro:false,use:false,...value},at);};
 input(50,{use:true});let snapshot;
 const oldIds=new Set(initial.crates.map(c=>c.id));
 for(let at=100;at<=5000;at+=50){
   if(at%100===0)input(at-50,{});
   snapshot=match.advance(at);
   if(at===1950)assert(!snapshot.crates.find(c=>c.id===home.id).available);
   if(at===2050){
     const returned=snapshot.crates.find(c=>!oldIds.has(c.id));
     assert(returned?.available,'safe box returns after two seconds with a fresh ID');
     assert.notEqual(returned.homeId,home.homeId);
     const socket=map.sockets.find(s=>s.id===returned.homeId);
     assert.deepEqual(returned.position,{x:socket.x,y:socket.y+.6,z:socket.z});
     assert(Math.hypot(returned.position.x-position.x,returned.position.z-position.z)>=6);
     assert.equal(new Set(snapshot.crates.map(c=>c.homeId)).size,initial.crates.length);
     const predicted=[];
     const prediction=createKartPickupPrediction({now:()=>at,onPredict:c=>predicted.push(c.id)});
     prediction.sync('economy',1);
     prediction.update({alive:true},position,snapshot.crates);
     assert.deepEqual(predicted,[],'old pad produces no local pickup');
     prediction.update({alive:true},returned.position,snapshot.crates);
     assert.deepEqual(predicted,[returned.id]);
     assert(prediction.hidden(returned.id)&&prediction.accept(returned.id));
   }
 }
 assert.equal(snapshot.karts[0].weapon,null,'real full clip retires');
 assert.equal(match.privateStatus('a').coins,coins,'parked kart cannot farm the former pad');
 match.setConnected('a',false);match.setConnected('a',true);
 assert.deepEqual(match.snapshot().crates,snapshot.crates,'reconnect retains relocated boxes');
 console.log('PASS rotating box: real pickup, full clip, 2s return at a different valid pad, parked denial and reconnect');
}finally{match.dispose();}

// Replay the real overlapping road slabs that trapped the firing probe.
for(const x of [-24,24]){
 const joined=selectArenaVariant(elevatedMap('rookie-ribbons'),8);
 const home=joined.sockets.find(h=>h.x===x&&h.z===-14&&h.y===0);
 const start=joined.spawns[0];Object.assign(start,{x,y:0,z:-14,angle:Math.PI/2,surface:home.surface});
 Object.assign(joined.spawnCandidates.find(p=>p.id===start.id),start);
 const w=combat.createElevatedCombat(RAPIER,CONFIG,joined,Array.from({length:8},(_,i)=>({id:'seam'+i})),{instance:'seam',seed:0,startAt:0,countdownMs:0,roundMs:10000});
 try{
  const s=w.advance(50),kart=s.karts[0],crate=s.crates.find(c=>c.homeId===home.id);
  assert(crate,'opening selector includes the diagnostic home');
  assert(kart.pose.wheels.every(t=>t.contact&&t.surfaceId!==crate.surfaceId),'recorded overlap uses a different wheel support ID');
  assert(kart.weapon&&w.privateStatus(kart.id).coins===1,'same-height joined floor permits a real pickup');
  assert.equal(kart.maxHealth,100);
 }finally{w.dispose();}
}
console.log('PASS real Rookie joined-slab pickups on both sides; different tyre/home IDs');
