import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-compat';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import COMBAT from '../games/engines/kart-elevated-combat.js';
await R.init();
const point=(id,x,z,y=0,surface='floor')=>({id,x,y,z,angle:0,surface});
const map=(extra=[],spawns=[point('a',0,0),point('b',35,35)])=>({id:'payload-test',revision:'1',half:80,
 colliders:[{id:'floor',shape:'box',half:{x:80,y:1,z:80},position:{x:0,y:-1,z:0}},...extra],spawns,
 sockets:[point('s0',-.7,0),point('s1',.7,0)]});
let instance=0,checks=0;const metrics=[];
const check=(v,label)=>{assert.ok(v,label);checks++;};
const kart=(w,id='a')=>w.snapshot().karts.find(k=>k.id===id);
const step=(w,n=1,each)=>{for(let i=0;i<n;i++){w.advance(w.snapshot().serverAt+CONFIG.fixedDt*1000);each?.(w.snapshot());}};
function send(w,id='a',extra={}){const s=w.snapshot(id),p=s.you;return w.input(id,{instance:s.instance,life:p.life,controlEpoch:p.controlEpoch,seq:p.receivedSeq+1,steer:0,throttle:0,brake:0,nitro:false,use:false,...extra},s.serverAt);}
function armed(weapon,m=map(),options={}){
 for(let seed=0;seed<512;seed++){
  const w=COMBAT.createElevatedCombat(R,CONFIG,m,m.spawns.map(s=>({id:s.id})),{instance:'payload-'+(++instance),seed,startAt:0,countdownMs:0,roundMs:30000,crates:1,...options});step(w);
  if(kart(w).weapon===weapon){step(w,160);return w;}w.dispose();
 }throw Error('No real pickup seed for '+weapon);
}
function tap(w){assert(send(w,'a',{use:true}).ok);assert(send(w).ok);step(w);}
for(const [weapon,count] of [['pulse',12],['rocket',3],['scatter',5],['rail',5]]){
 const w=armed(weapon);try{
  tap(w);const fires=new Map(w.snapshot().events.filter(e=>e.type==='fire').map(e=>[e.id,e]));
  check(kart(w).firing===true&&kart(w).weapon===weapon&&kart(w).ammo===count-1,weapon+' publishes the in-progress inventory after one tap');
  step(w,150,s=>{for(const e of s.events)if(e.type==='fire')fires.set(e.id,e);});
  check([...fires.values()].filter(e=>e.weapon===weapon).length===count,weapon+' one tap and release delivers every payload round after input TTL');
  check(kart(w).firing===false,weapon+' completes its bounded sequence');
  step(w,80,s=>{for(const e of s.events)if(e.type==='fire')fires.set(e.id,e);});
  check(fires.size===count,weapon+' never activates a subsequent pickup automatically');
  metrics.push({weapon,rounds:fires.size});
 }finally{w.dispose();}
}
{
 const w=armed('pulse');try{
  assert(send(w,'a',{use:true}).ok);step(w);const fires=new Map();
  step(w,220,s=>{for(const e of s.events)if(e.type==='fire')fires.set(e.id,e);if(s.simTick%6===0)send(w,'a',{use:true});});
  check(fires.size===12,'held Use spends exactly one full Pulse pickup');
  check(kart(w).weapon!==null&&!kart(w).firing,'recycled actual crate stays unused while Use remains held');
  check(w.snapshot().karts.every(k=>typeof k.firing==='boolean'&&!('sequence'in k)&&!('itemSeq'in k)),'public karts expose only firing, not private sequence identity/timers');
 }finally{w.dispose();}
 const staleHeld=armed('pulse');try{
  assert(send(staleHeld,'a',{use:true}).ok);step(staleHeld);const fires=new Set();
  step(staleHeld,230,s=>{for(const e of s.events)if(e.type==='fire')fires.add(e.id);if(kart(staleHeld).firing&&s.simTick%6===0){send(staleHeld,'a',{use:false});send(staleHeld,'a',{use:true});}});
  check(fires.size===12&&kart(staleHeld).weapon!==null&&!kart(staleHeld).firing,'repeated presses during a sequence cannot queue reuse of the next real pickup');
  assert(send(staleHeld,'a',{use:true}).ok);step(staleHeld,30,s=>{for(const e of s.events)if(e.type==='fire')fires.add(e.id);});
  check(fires.size===12&&!kart(staleHeld).firing,'input TTL cannot manufacture a new activation edge from still-held Use');
  const nextAmmo=kart(staleHeld).ammo;assert(send(staleHeld).ok);assert(send(staleHeld,'a',{use:true}).ok);step(staleHeld);
  check(kart(staleHeld).ammo<nextAmmo||kart(staleHeld).weapon===null,'explicit neutral release followed by a new press can activate the next actual pickup');
 }finally{staleHeld.dispose();}
 const disconnected=armed('pulse');try{
  tap(disconnected);const fired=disconnected.snapshot().events.filter(e=>e.type==='fire').length;disconnected.setConnected('a',false);step(disconnected,90);disconnected.setConnected('a',true);step(disconnected,90);
  check(disconnected.snapshot().events.filter(e=>e.type==='fire').length===fired&&!kart(disconnected).firing,'disconnect/epoch change retires accepted remaining rounds across reconnect');
 }finally{disconnected.dispose();}
 const duelMap=map([],[point('a',0,0),{...point('b',0,12),angle:Math.PI}]);duelMap.sockets=[point('s0',-.7,0),point('s1',.7,0),point('s2',-.7,12),point('s3',.7,12)];let duel;
 for(let seed=0;seed<2048;seed++){
  const candidate=COMBAT.createElevatedCombat(R,CONFIG,duelMap,[{id:'a'},{id:'b'}],{instance:'payload-ko-'+(++instance),seed,startAt:0,countdownMs:0,roundMs:30000,crates:2,initialHealth:1});step(candidate);
  if(kart(candidate).weapon==='pulse'&&kart(candidate,'b').weapon==='rail'){duel=candidate;break;}candidate.dispose();
 }
 check(!!duel,'KO lifecycle fixture acquires both opposing weapons through real crates');
 try{
  step(duel,160);tap(duel);assert(send(duel,'b',{use:true}).ok);assert(send(duel,'b').ok);step(duel,10);
  check(kart(duel).deaths===1&&!kart(duel).firing,'real enemy Rail impact cancels the accepted Pulse sequence on KO');
  const emitted=new Set(duel.snapshot().events.filter(e=>e.type==='fire'&&e.pid==='a').map(e=>e.id));
  step(duel,200,s=>{for(const e of s.events)if(e.type==='fire'&&e.pid==='a')emitted.add(e.id);});
  check(kart(duel).alive&&kart(duel).spawnSeq===1&&emitted.size===1&&!kart(duel).firing,'respawn life cannot inherit or resume the cancelled payload');
 }finally{duel.dispose();}
 const ends=[],deadline=armed('pulse',map(),{roundMs:3000,onResult:r=>ends.push(r)});try{
  tap(deadline);step(deadline,60);check(deadline.snapshot().phase==='done'&&ends.length===1&&!kart(deadline).firing&&deadline.snapshot().projectiles.length===0,'results discard unfinished accepted payload and all flight entities');
  const next=deadline.rematch({instance:'payload-rematch',seed:1,startAt:10000});try{check(next.snapshot().karts.every(k=>!k.firing&&k.weapon===null),'rematch has no inherited firing sequence');}finally{next.dispose();}
 }finally{deadline.dispose();}
}
for(const moving of [false,true]){
 const w=armed('mine');try{
  tap(w);check(w.snapshot().mines.length===1&&kart(w).ammo===2&&kart(w).firing,'Mine activation begins one of three sequential drops');
  const deployments=new Map();const observe=s=>{for(const e of s.events)if(e.type==='mine')deployments.set(e.id,e);};observe(w.snapshot());
  step(w,70,s=>{if(moving&&s.simTick%6===0)send(w,'a',{throttle:1});observe(s);});
  const events=[...deployments.values()],mines=w.snapshot().mines;
  check(events.length===3&&mines.length===3&&!kart(w).firing,'one Mine tap leaves exactly three deployed mines');
  check(events.slice(1).every((e,i)=>(e.tick-events[i].tick)*CONFIG.fixedDt>=.24),'Mine drops remain separated by their real cadence');
  check(mines.every((m,i)=>mines.every((n,j)=>i===j||Math.hypot(m.position.x-n.position.x,m.position.y-n.position.y,m.position.z-n.position.z)>1)),'Mine trail has nonoverlapping real spacing');
  check(mines.every(m=>m.radius===.41&&m.surfaceId==='floor'&&m.position.z<kart(w).pose.position.z),'Mine disc radius/support and current-pose rear deployment are preserved');
  if(!moving)check(mines.every(m=>Math.abs(m.position.x)<.01)&&mines[0].position.z>mines[1].position.z&&mines[1].position.z>mines[2].position.z,'stationary fallback is a rearward line, not an instant lateral triplet');
  step(w,750);check(w.snapshot().mines.length===0&&!w.snapshot().events.some(e=>e.type==='blast'||e.type==='hit'),'unused owner-immune Mine trail expires quietly after12seconds');
  metrics.push({weapon:'mine',moving,dropTicks:events.map(e=>e.tick),positions:mines.map(m=>m.position)});
 }finally{w.dispose();}
}
for(const weapon of ['bomb','proximity']){
 const w=armed(weapon);try{
  tap(w);const first=w.snapshot().grenades[0];check(first?.weapon===weapon&&first.radius===.6&&first.velocity.z>11&&first.velocity.y>5&&!first.landed&&!first.armed,weapon+' is a visible forward lob with its .60m swept body');
  let landedTick=null,armedTick=null,peak=first.position.y,settled=false,previousSpeed=Infinity,slowed=false;
  step(w,240,s=>{const g=s.grenades[0];if(!g)return;peak=Math.max(peak,g.position.y);if(g.landed)landedTick??=s.simTick;if(g.armed)armedTick??=s.simTick;check(!g.armed||g.landed,weapon+' cannot arm in flight');const speed=Math.hypot(g.velocity.x,g.velocity.z);if(g.landed&&speed<previousSpeed-.01)slowed=true;previousSpeed=speed;settled ||= g.landed&&speed<.05;check(Number.isFinite(g.position.y)&&g.position.y>=.6,weapon+' physical body never sinks through its support');});
  check(landedTick!==null&&armedTick!==null&&(armedTick-landedTick)*CONFIG.fixedDt>=.7-1e-8,weapon+' arms only after .7seconds on real landing support');
  check(peak>first.position.y+.3&&settled&&slowed,weapon+' lob has a real arc then frictional settling');
  step(w,500);check(w.snapshot().grenades.length===0&&!w.snapshot().events.some(e=>e.type==='blast'),weapon+' expires quietly at12seconds without a timed detonation');
  metrics.push({weapon,landedTick,armedTick,peak});
 }finally{w.dispose();}
 const trigger=armed(weapon,map([],[point('a',0,0),point('b',0,10)]));try{
  tap(trigger);let blast=null;step(trigger,180,s=>{blast??=s.events.find(e=>e.type==='blast'&&e.weapon===weapon);});
  check(!!blast&&kart(trigger,'b').health===(weapon==='bomb'?20:30),weapon+' one landed enemy-proximity activation retains its distinct damage');
  check(kart(trigger).health===100&&kart(trigger).deaths===0,weapon+' owner remains immune');
  check(trigger.snapshot().events.filter(e=>e.type==='blast'&&e.weapon===weapon).length===1,weapon+' accepted proximity charge detonates once');
 }finally{trigger.dispose();}
 const lowRoof={id:'charge-launch-roof',shape:'box',half:{x:5,y:.1,z:5},position:{x:0,y:1.75,z:0}};
 const obstructed=armed(weapon,map([lowRoof]));try{
  tap(obstructed);check(kart(obstructed).firing&&obstructed.snapshot().grenades.length===0,weapon+' cannot create a body inside a roof overlapping its launch volume');
  step(obstructed,500);check(!kart(obstructed).firing&&obstructed.snapshot().grenades.length===0&&!obstructed.snapshot().events.some(e=>e.type==='blast'),weapon+' impossible launch retries remain bounded and expire without fabricated blast');
 }finally{obstructed.dispose();}
 const wall={id:'charge-wall',shape:'box',half:{x:8,y:3,z:.1},position:{x:0,y:3,z:4}};
 const cover=armed(weapon,map([wall],[point('a',0,0),point('b',0,7)]));try{
  tap(cover);step(cover,180);check(cover.snapshot().grenades[0]?.position.z<3.31&&kart(cover,'b').health===100&&!cover.snapshot().events.some(e=>e.type==='blast'),weapon+' swept wall blocks movement and proximity LOS');
 }finally{cover.dispose();}
 const deck={id:'charge-deck',shape:'deck',half:{x:8,y:.15,z:10},position:{x:0,y:1.65,z:12}};
 const layered=armed(weapon,map([deck],[point('a',0,0),point('b',0,3,1.8,'charge-deck')]));try{
  tap(layered);step(layered,200);const charge=layered.snapshot().grenades[0],target=kart(layered,'b').pose.position;
  check(charge?.landed&&Math.hypot(target.x-charge.position.x,target.y+.35-charge.position.y,target.z-charge.position.z)<3&&kart(layered,'b').health===100&&!layered.snapshot().events.some(e=>e.type==='blast'),weapon+' solid deck denies an otherwise in-radius enemy on another level');
 }finally{layered.dispose();}
}
console.log(JSON.stringify({pass:true,checks,metrics,scope:'Real Rapier authority, legal crate pickup and input; no native visual/audio claim'}));
