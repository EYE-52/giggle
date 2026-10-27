// Real Rapier and authority proof for Harbor Heights. Test-created bodies use
// supported fixtures; the pickup flow uses the unchanged authored map/spawns.
// No authority grant, teleport, injected hit or rendering approval is involved.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import RAPIER from '@dimforge/rapier3d-compat';
import PHYSICS from '../games/engines/kart-physics.js';
import COMBAT from '../games/engines/kart-elevated-combat.js';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import { elevatedMap } from '../public/js/engines/kart-elevated-maps.mjs';

await RAPIER.init();
const map=elevatedMap('harbor'), results=[], measurements={};
const check=(label,value)=>{assert.ok(value,label);results.push(label);};
const finite=v=>typeof v==='number'?Number.isFinite(v):v&&typeof v==='object'?Object.values(v).every(finite):true;
const yaw=a=>({x:0,y:Math.sin(a/2),z:0,w:Math.cos(a/2)});
const step=(w,n)=>{for(let i=0;i<n;i++)w.step();};
function world(){const w=PHYSICS.createKartPhysics(RAPIER,CONFIG);map.colliders.forEach(d=>w.addStatic(d));return w;}
const heading=q=>Math.atan2(2*(q.x*q.z+q.w*q.y),1-2*(q.x*q.x+q.y*q.y));
function toward(p,target) {
  const angle=Math.atan2(target.x-p.position.x,target.z-p.position.z);
  const error=Math.atan2(Math.sin(angle-heading(p.rotation)),Math.cos(angle-heading(p.rotation)));
  // At nose +Z, positive steering is driver-right (-X), so yaw decreases.
  return {throttle:Math.abs(error)>.5?.45:.7,steer:Math.max(-1,Math.min(1,-error*2.5)),brake:0};
}
for(const [id,sha] of Object.entries({
  garden:'84ee23173a2ff4a09f601839079308d6d94147210988695daf67ccb387a2187c',
  frost:'c8bb1385d93d38d200e42640ce2ab702245ad8c289c8bfdf3e284b50df901a4a',
  neon:'25fd377243a0eeea6a71d3cc731933b901fcb355687f415be5f37829346d1e54',
}))check(`${id}: original authored geometry is byte-equivalent`,createHash('sha256').update(JSON.stringify(elevatedMap(id))).digest('hex')===sha);
check('172 m port has eight spawn supports and 24 meaningful sockets',map.half===86&&map.spawns.length===8&&map.sockets.length===24);
check('four ascending routes and five finite connected upper surfaces',map.routes.length===4&&map.colliders.filter(d=>d.shape==='deck').length===5);
check('cover remains bounded rather than hundreds of scattered solids',map.colliders.length===30&&map.colliders.every(d=>['box','deck','wedge'].includes(d.shape)));
{
  const w=world();try {
    for(const p of map.spawns)check(p.id+': supported spawn hull has unobstructed headroom',!w.overlapsStatic({x:p.x,y:p.y+1,z:p.z},yaw(p.angle)));
    for(const p of map.sockets)check(p.id+': pickup ball is outside every actual solid',!w.sweepStatic({x:p.x,y:p.y+.65,z:p.z},{x:p.x,y:p.y+.65,z:p.z},.45));
    const below=w.sweepStatic({x:0,y:1.3,z:20},{x:0,y:8.2,z:20},.18);
    const above=w.sweepStatic({x:0,y:8.2,z:20},{x:0,y:1.3,z:20},.18);
    check('upper/lower projectile corridors hit the finite dock from both sides',below?.surfaceId==='upper-dock'&&above?.surfaceId==='upper-dock'&&below.normal.y<-.9&&above.normal.y>.9);
    check('ground projectiles have a clear full-width lower crossing',w.sweepStatic({x:-76,y:1.3,z:20},{x:76,y:1.3,z:20},.18)===null);
    const cover=w.sweepStatic({x:-8,y:8.2,z:20},{x:-8,y:8.2,z:34},.18);
    check('upper cover stops actual swept projectiles',cover?.surfaceId==='dock-cover-west');
    check('upper cargo does not invent cover on the road beneath',w.sweepStatic({x:-8,y:1.3,z:20},{x:-8,y:1.3,z:34},.18)===null);
  }finally{w.dispose();}
}
for(const [label,y,start,end] of [['upper',8,-67,67],['underpass',1,-76,76]]) {
  const w=world();try {
    w.addKart('driver',{position:{x:start,y,z:20},rotation:yaw(Math.PI/2)});step(w,120);
    w.applyIntent('driver',{throttle:1,steer:0});const contacts=new Set();let minY=Infinity,maxY=0,reached=false;
    for(let i=0;i<1000&&!reached;i++){w.step();const p=w.pose('driver');assert.ok(finite(p));minY=Math.min(minY,p.position.y);maxY=Math.max(maxY,p.position.y);p.wheels.filter(v=>v.contact).forEach(v=>contacts.add(v.surfaceId));reached=p.position.x>end;}
    check(label+': actual throttle crosses the whole port without seam arrest',reached);
    check(label+': physical layer stays supported throughout crossing',y===8?minY>7.4&&maxY<8: minY>.5&&maxY<1);
    check(label+': contact surfaces match the route',y===8?['west-balcony','west-span','upper-dock','east-span','east-balcony'].every(id=>contacts.has(id)):contacts.size===1&&contacts.has('floor'));
    measurements[label]={distance:end-start,minChassisY:minY,maxChassisY:maxY,contacts:[...contacts]};
  }finally{w.dispose();}
}
{
  const w=world();try {
    w.addKart('driver',{position:{x:-20,y:1,z:-45},rotation:yaw(0)});step(w,120);
    const waypoints=[{x:-16,z:-20},{x:-16,z:24}],contacts=new Set();let goal=0,steered=false,reached=false,maxY=0;
    for(let i=0;i<1000&&!reached;i++){
      const p=w.pose('driver');if(Math.hypot(p.position.x-waypoints[goal].x,p.position.z-waypoints[goal].z)<3){if(goal===1){reached=true;break;}goal++;}
      const intent=toward(p,waypoints[goal]);steered ||= Math.abs(intent.steer)>.05;w.applyIntent('driver',intent);w.step();maxY=Math.max(maxY,p.position.y);p.wheels.filter(v=>v.contact).forEach(v=>contacts.add(v.surfaceId));
    }
    check('legal steering aligns from a floor flank and climbs the dock',reached&&steered&&contacts.has('dock-south-climb')&&contacts.has('upper-dock')&&maxY>7.4);
    measurements.steeredClimb={maxChassisY:maxY,contacts:[...contacts]};
  }finally{w.dispose();}
}
{
  const w=world();try {
    w.addKart('driver',{position:{x:61,y:1,z:80},rotation:yaw(Math.PI)});step(w,120);w.applyIntent('driver',{throttle:1,steer:0});
    let climb=false,balcony=false,kicker=false,air=0,landed=false,maxY=0;
    for(let i=0;i<1000&&!landed;i++){
      w.step();const p=w.pose('driver');maxY=Math.max(maxY,p.position.y);
      climb ||= p.wheels.some(v=>v.surfaceId==='east-climb');balcony ||= p.wheels.some(v=>v.surfaceId==='east-balcony');kicker ||= p.wheels.some(v=>v.surfaceId==='balcony-kicker');
      if(kicker&&p.position.z<3&&!p.grounded)air++;
      if(air>5&&p.grounded&&p.wheels.some(v=>v.surfaceId==='floor')&&p.position.z<0)landed=true;
    }
    check('optional shortcut drives floor→climb→balcony→supported kicker',climb&&balcony&&kicker);
    check('shortcut produces actual flight and safe lower-apron landing',air>5&&landed&&maxY>9);
    measurements.optionalDrop={maxChassisY:maxY,airborneSteps:air};
  }finally{w.dispose();}
}

// Find an ordinary deterministic crate layout containing the first authored
// socket. This does not change the map, grant an item or teleport a driver.
let combat,seed;
for(seed=0;seed<64;seed++){
  const candidate=COMBAT.createElevatedCombat(RAPIER,CONFIG,map,[{id:'a'},{id:'b'}],{instance:'harbor-pickup-'+seed,seed,startAt:0,countdownMs:0,roundMs:30000,crates:6});
  if(candidate.snapshot().crates.some(c=>c.position.x===-64&&c.position.z===-50)){combat=candidate;break;}candidate.dispose();
}
check('real randomized crate pool can place a sheltered approach pickup',!!combat);
const send=(w,id,intent)=>{const view=w.snapshot(id),own=view.you;return w.input(id,{instance:view.instance,life:own.life,controlEpoch:own.controlEpoch,seq:own.receivedSeq+1,throttle:0,steer:0,brake:0,nitro:false,use:false,...intent},view.serverAt);};
const advance=w=>w.advance(w.snapshot().serverAt+CONFIG.fixedDt*1000);
const kart=(w,id)=>w.snapshot(id).karts.find(k=>k.id===id);
try {
  advance(combat);let acquired=null;
  for(let i=0;i<600&&!acquired;i++){if(i%6===0)assert.ok(send(combat,'a',toward(kart(combat,'a').pose,{x:-64,z:-50})).ok);advance(combat);acquired=kart(combat,'a').weapon;}
  check('authored spawn legally steers to and collects a real crate',!!acquired&&combat.snapshot().events.some(e=>e.type==='pickup'&&e.pid==='a'));
  send(combat,'a',{brake:1});for(let i=0;i<40;i++)advance(combat);
  const ammo=kart(combat,'a').ammo;assert.ok(send(combat,'a',{use:true,brake:1}).ok);assert.ok(send(combat,'a',{use:false,brake:1}).ok);advance(combat);
  check('real acquired item spends once using normal authority edges',kart(combat,'a').ammo===ammo-1&&combat.snapshot().events.some(e=>['fire','mine','shield'].includes(e.type)&&e.pid==='a'));
  measurements.pickup={seed,weapon:acquired,position:kart(combat,'a').pose.position};
}finally{combat.dispose();}

for(const count of [2,8]){
  const ends=[],seats=Array.from({length:count},(_,i)=>({id:'p'+i})),w=COMBAT.createElevatedCombat(RAPIER,CONFIG,map,seats,{instance:'harbor-round-'+count,seed:42,startAt:0,countdownMs:500,roundMs:12000,crates:6,onResult:r=>ends.push(r)});
  try{
    for(let i=0;i<760;i++){
      if(i%6===0&&w.snapshot().phase==='live')for(let p=0;p<count;p++)if(kart(w,'p'+p).alive)send(w,'p'+p,{throttle:1,steer:(p%2?.25:-.25),nitro:i%180<60,use:i%60===0});
      advance(w);assert.ok(finite(w.snapshot('watcher')));
    }
    check(count+' seats: complete server deadline produces exactly one finite result',w.snapshot().phase==='done'&&ends.length===1&&w.result().scores.length===count);
    const saved=JSON.stringify(w.result());w.advance(60000);check(count+' seats: late pumps cannot repeat or mutate the result',JSON.stringify(w.result())===saved&&ends.length===1);
    const next=w.rematch({instance:'harbor-rematch-'+count,seed:43,startAt:60000});try{check(count+' seats: fresh rematch starts clean supported bodies',next.snapshot().karts.length===count&&next.snapshot().karts.every(k=>k.alive&&k.hits===0&&k.weapon===null)&&finite(next.snapshot()));}finally{next.dispose();}
  }finally{w.dispose();}
  check(count+' seats: disposal frees the entire isolated physics world',w.stats().physics.statics===0&&w.stats().physics.karts===0);
}
console.log(JSON.stringify({pass:true,checks:results.length,results,measurements,scope:'Node Rapier map/authority only; no native rendering, phone, network or art-quality claim'},null,2));
