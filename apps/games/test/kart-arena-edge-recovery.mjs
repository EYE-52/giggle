import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-compat';
import C from '../public/js/engines/kart-physics-config.mjs';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {selectArenaVariant} from '../public/js/engines/kart-arena-policy.mjs';
import combat from '../games/engines/kart-elevated-combat.js';
await R.init();
function fixture(){
 const map=selectArenaVariant(elevatedMap('skyport-split'),8),start=map.spawns[0];
 // A legal four-wheel start on the actual deck. The lip is reached by inputs.
 Object.assign(start,{x:26.5,y:15,z:24,angle:0,surface:'east-2'});
 Object.assign(map.spawnCandidates.find(p=>p.id===start.id),start);
 return combat.createElevatedCombat(R,C,map,Array.from({length:8},(_,i)=>({id:'p'+i})),{instance:'lip',seed:0,startAt:0,countdownMs:0,roundMs:12000});
}
for(const parked of [false,true]){
 const w=fixture();let s=w.snapshot(),reverse=false,jammed=false,event,coins;
 try{
  assert.equal(s.combat.maxHealth,100);assert.equal(s.combat.weaponOrder.length,12);
  for(let at=0;at<(parked?5500:8000);at+=50){
   const k=s.karts[0],p=k.pose,own=w.privateStatus(k.id);
   reverse||=p.position.z>27;
   if(at>2200&&reverse&&p.wheels.filter(t=>t.contact).length<=2&&1-2*(p.rotation.x**2+p.rotation.z**2)>.9){jammed=true;coins??=own.coins;}
   const throttle=parked&&at>=3000?0:reverse?-.75:.12;
   assert(w.input(k.id,{instance:'lip',life:own.life,controlEpoch:own.controlEpoch,seq:own.receivedSeq+1,steer:0,throttle,brake:0,nitro:false,use:false},at).ok,JSON.stringify({parked,at,alive:k.alive,position:p.position}));
   s=w.advance(at+50);event=s.events.find(e=>e.type==='recover'&&e.pid===k.id);
   if(event)break;
  }
  assert(jammed,'ordinary driving reproduces the upright two-tyre deck-lip jam');
  if(parked){assert(!event,'a driver who stops asking to move is not relocated');continue;}
  assert(event?.reason==='high-centred','failed reverse driving receives bounded production recovery');
  assert(event.tick*C.fixedDt*1000>3000,'recovery is not immediate');
  const k=s.karts[0],own=w.privateStatus(k.id);
  assert.equal(k.health,100);assert.equal(k.deaths,0);assert.equal(k.shield,0);
  assert.equal(own.coins,coins);assert.equal(k.weapon,null);assert.equal(k.spawnSeq,1);
  assert.equal(k.pose.position.z,24,'recovery selects the nearest legal clear authored bay');
  const from={...k.pose.position};
  for(let j=0;j<20;j++){
   const at=s.serverAt,own=w.privateStatus(k.id);
   assert(w.input(k.id,{instance:'lip',life:own.life,controlEpoch:own.controlEpoch,seq:own.receivedSeq+1,steer:0,throttle:-.4,brake:0,nitro:false,use:false},at).ok);s=w.advance(at+50);
  }
  assert(Math.hypot(s.karts[0].pose.position.x-from.x,s.karts[0].pose.position.z-from.z)>2,'fresh inputs drive away after recovery');
 }finally{w.dispose();}
}
console.log('PASS real upright deck-lip jam: normal inputs, bounded recovery, no awards/shield/HP grant, parked denial and drive-away');
