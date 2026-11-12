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
for(const [weapon,count] of [['machinegun',30],['trishot',9],['cannon',3]]){
 const w=armed(weapon);try{
  tap(w);const fires=new Map(w.snapshot().events.filter(e=>e.type==='fire').map(e=>[e.id,e]));
  check(kart(w).firing===true&&kart(w).weapon===weapon&&kart(w).ammo===count-(weapon==='trishot'?3:1),weapon+' publishes the in-progress inventory after one tap');
  step(w,150,s=>{for(const e of s.events)if(e.type==='fire')fires.set(e.id,e);});
  check([...fires.values()].filter(e=>e.weapon===weapon).length===count/(weapon==='trishot'?3:1),weapon+' one tap and release delivers every payload round after input TTL');
  check(kart(w).firing===false,weapon+' completes its bounded sequence');
  step(w,80,s=>{for(const e of s.events)if(e.type==='fire')fires.set(e.id,e);});
  check(fires.size===count/(weapon==='trishot'?3:1),weapon+' never activates a subsequent pickup automatically');
  metrics.push({weapon,rounds:fires.size});
 }finally{w.dispose();}
}
{
 const w=armed('machinegun');try{
  assert(send(w,'a',{use:true}).ok);step(w);const fires=new Map();
  step(w,220,s=>{for(const e of s.events)if(e.type==='fire')fires.set(e.id,e);if(s.simTick%6===0)send(w,'a',{use:true});});
  check(fires.size===30,'held Use spends exactly one full Pulse pickup');
  check(kart(w).weapon!==null&&!kart(w).firing,'recycled actual crate stays unused while Use remains held');
  check(w.snapshot().karts.every(k=>typeof k.firing==='boolean'&&!('sequence'in k)&&!('itemSeq'in k)),'public karts expose only firing, not private sequence identity/timers');
 }finally{w.dispose();}
 const staleHeld=armed('machinegun');try{
  assert(send(staleHeld,'a',{use:true}).ok);step(staleHeld);const fires=new Set();
  step(staleHeld,230,s=>{for(const e of s.events)if(e.type==='fire')fires.add(e.id);if(kart(staleHeld).firing&&s.simTick%6===0){send(staleHeld,'a',{use:false});send(staleHeld,'a',{use:true});}});
  check(fires.size===30&&kart(staleHeld).weapon!==null&&!kart(staleHeld).firing,'repeated presses during a sequence cannot queue reuse of the next real pickup');
  assert(send(staleHeld,'a',{use:true}).ok);step(staleHeld,30,s=>{for(const e of s.events)if(e.type==='fire')fires.add(e.id);});
  check(fires.size===30&&!kart(staleHeld).firing,'input TTL cannot manufacture a new activation edge from still-held Use');
  const nextAmmo=kart(staleHeld).ammo;assert(send(staleHeld).ok);assert(send(staleHeld,'a',{use:true}).ok);step(staleHeld);
  check(kart(staleHeld).ammo<nextAmmo||kart(staleHeld).weapon===null,'explicit neutral release followed by a new press can activate the next actual pickup');
 }finally{staleHeld.dispose();}
 const disconnected=armed('machinegun');try{
  tap(disconnected);const fired=disconnected.snapshot().events.filter(e=>e.type==='fire').length;disconnected.setConnected('a',false);step(disconnected,90);disconnected.setConnected('a',true);step(disconnected,90);
  check(disconnected.snapshot().events.filter(e=>e.type==='fire').length===fired&&!kart(disconnected).firing,'disconnect/epoch change retires accepted remaining rounds across reconnect');
 }finally{disconnected.dispose();}
 const duelMap=map([],[point('a',0,0),{...point('b',0,12),angle:Math.PI}]);duelMap.sockets=[point('s0',-.7,0),point('s1',.7,0),point('s2',-.7,12),point('s3',.7,12)];let duel;
 for(let seed=0;seed<2048;seed++){
  const candidate=COMBAT.createElevatedCombat(R,CONFIG,duelMap,[{id:'a'},{id:'b'}],{instance:'payload-ko-'+(++instance),seed,startAt:0,countdownMs:0,roundMs:30000,crates:2,initialHealth:1});step(candidate);
  if(kart(candidate).weapon==='machinegun'&&['machinegun','trishot'].includes(kart(candidate,'b').weapon)){duel=candidate;break;}candidate.dispose();
 }
 check(!!duel,'KO lifecycle fixture acquires both opposing weapons through real crates');
 try{
  step(duel,160);tap(duel);assert(send(duel,'b',{use:true}).ok);assert(send(duel,'b').ok);step(duel,10);
  check(kart(duel).deaths===1&&!kart(duel).firing,'real enemy shot impact cancels the accepted Pulse sequence on KO');
  const emitted=new Set(duel.snapshot().events.filter(e=>e.type==='fire'&&e.pid==='a').map(e=>e.id));
  step(duel,200,s=>{for(const e of s.events)if(e.type==='fire'&&e.pid==='a')emitted.add(e.id);});
  check(kart(duel).alive&&kart(duel).spawnSeq===1&&emitted.size===1&&!kart(duel).firing,'respawn life cannot inherit or resume the cancelled payload');
 }finally{duel.dispose();}
 const ends=[],deadline=armed('machinegun',map(),{roundMs:3000,onResult:r=>ends.push(r)});try{
  tap(deadline);step(deadline,60);check(deadline.snapshot().phase==='done'&&ends.length===1&&!kart(deadline).firing&&deadline.snapshot().projectiles.length===0,'results discard unfinished accepted payload and all flight entities');
  const next=deadline.rematch({instance:'payload-rematch',seed:1,startAt:10000});try{check(next.snapshot().karts.every(k=>!k.firing&&k.weapon===null),'rematch has no inherited firing sequence');}finally{next.dispose();}
 }finally{deadline.dispose();}
}
for(const kind of ['machinegun','trishot','cannon']){
 const target=kind==='cannon'?point('b',0,10):point('b',6,15);
 const w=armed(kind,map([],[point('a',0,0),target]));try{
  tap(w);const hits=new Map();let remaining=null;
  step(w,90,s=>{
   for(const e of s.events)if(e.type==='hit'&&e.other==='b'&&e.weapon===kind)hits.set(e.id,e);
   if(remaining===null&&s.karts[1].alive===false)remaining={ammo:s.karts[0].ammo,firing:s.karts[0].firing};
  });
  if(kind==='cannon'){
   assert.deepEqual([...hits.values()].map(e=>e.health),[50,0]);
   assert.deepEqual(remaining,{ammo:1,firing:true});
   check(!kart(w).firing,'third rocket completes after KO');
  }else check(kind==='machinegun'?hits.size>0:hits.size===0,kind+' off-axis target result');
 }finally{w.dispose();}
}
for(const blocked of [false,true]){
 const cover=blocked?[{id:'rear-cover',shape:'box',position:{x:0,y:1,z:-4},half:{x:3,y:2,z:.4}}]:[];
 const w=armed('machinegun',map(cover,[point('a',0,0),point('b',0,-10),point('left',-15,2)]));
 try{
  tap(w);const event=w.snapshot().events.find(e=>e.type==='fire');
  check(blocked?event.direction.x<-.95:event.direction.z<-.95,'accepted tracking shot points at closest uncovered side or rear rival');
  step(w,13);
  check(kart(w,blocked?'left':'b').health<100&&kart(w,blocked?'b':'left').health===100,'only the visible target receives tracking hits');
 }finally{w.dispose();}
}
for(const kind of ['missile','machinegun']){
 const w=armed(kind,map([],[point('a',0,0),point('b',0,kind==='missile'?-12:-45)]));
 try{
  tap(w);const shot=w.snapshot().projectiles[0];check(shot.velocity.z>0&&!shot.targetId,kind+' respects its range or forward lock cone');
 }finally{w.dispose();}
}
for(const kind of ['fakecrate','proximity']){
 const w=armed(kind,map([],[point('a',0,0),point('b',0,-9)]));try{
  tap(w);const trap=w.snapshot().mines[0];check(trap?.kind===kind,kind+' deployed behind driver');
  step(w,55);check(w.snapshot().mines[0].armed,'trap arms before contact');
  step(w,90,s=>{if(s.simTick%5===0&&s.karts[1].alive)send(w,'b',{throttle:1});});
  check(w.snapshot().mines.length===0,kind+' consumed on approach');
  check(kind==='fakecrate'?!kart(w,'b').alive:(kart(w,'b').health<100&&kart(w,'b').alive),kind+' applies its own damage');
 }finally{w.dispose();}
}
for(const kind of ['blades','supernova']){
 const w=armed(kind,map([],[point('a',0,0),point('b',2.5,0)]));try{
  tap(w);step(w,5);
  check(!kart(w,'b').alive&&kart(w).hits===1&&kart(w)[kind==='blades'?'bladesT':'supernovaT']>0,kind+' contact scores while its timer continues');
 }finally{w.dispose();}
}
// The next real box is within reach when a timed pickup is activated.
for(const [kind,timer] of [['blades','bladesT'],['supernova','supernovaT'],['ram','rammingT']]){
 const w=armed(kind);
 try{
  tap(w);
  check(kart(w)[timer]>0,kind+' activated');
  step(w,20,s=>{
   const a=s.karts.find(k=>k.id==='a');
   check(a.weapon===null&&a[timer]>0,kind+' keeps the active slot when crossing another box');
  });
 }finally{w.dispose();}
}
for(const moving of [false,true]){
 const w=armed('mine');try{
  tap(w);check(w.snapshot().mines.length===1&&kart(w).ammo===2&&kart(w).firing,'Mine activation begins one of three sequential drops');
  const deployments=new Map();const observe=s=>{for(const e of s.events)if(e.type==='mine')deployments.set(e.id,e);};observe(w.snapshot());
  step(w,70,s=>{if(moving&&s.simTick%6===0)send(w,'a',{throttle:1});observe(s);});
  const events=[...deployments.values()],mines=w.snapshot().mines;
  check(events.length===(moving?3:1)&&mines.length===events.length&&kart(w).firing===!moving,'extra mines wait for travel');
  check(events.slice(1).every((e,i)=>(e.tick-events[i].tick)*CONFIG.fixedDt>=.24),'Mine drops remain separated by their real cadence');
  check(mines.every((m,i)=>mines.every((n,j)=>i===j||Math.hypot(m.position.x-n.position.x,m.position.y-n.position.y,m.position.z-n.position.z)>1)),'Mine trail has nonoverlapping real spacing');
  check(mines.every(m=>m.radius===.41&&m.surfaceId==='floor'&&m.position.z<kart(w).pose.position.z),'Mine disc radius/support and current-pose rear deployment are preserved');
  step(w,750);check(w.snapshot().mines.length===0&&!w.snapshot().events.some(e=>e.type==='blast'||e.type==='hit'),'unused owner-immune Mine trail expires quietly after12seconds');
  metrics.push({weapon:'mine',moving,dropTicks:events.map(e=>e.tick),positions:mines.map(m=>m.position)});
 }finally{w.dispose();}
}
{
 const ramp=map([{id:'climb',shape:'wedge',half:{x:6,y:3,z:12},position:{x:0,y:3,z:0},grip:1}],[point('a',0,-16),point('b',35,35)]);
 ramp.sockets=[point('s0',-.7,-16),point('s1',.7,-16)];
 const w=armed('mine',ramp);
 try{
  let fired=false;
  for(let i=0;i<210;i++){
   const p=kart(w).pose.position;
   if(!fired&&p.z>=-5){assert(send(w,'a',{throttle:1,use:true}).ok);fired=true;}
   if(i%5===0)assert(send(w,'a',{throttle:w.snapshot().mines.length===3?0:1}).ok);
   step(w);
   if(w.snapshot().mines.length===3)break;
  }
  const mines=w.snapshot().mines;
  check(fired&&mines.length===3&&mines.every(m=>m.surfaceId==='climb'&&m.normal.y<.98),'one tap lays all three mines while driving uphill on the launch arena slope');
 }finally{w.dispose();}
}
console.log(JSON.stringify({pass:true,checks,metrics,scope:'Real Rapier authority, legal crate pickup and input; no native visual/audio claim'}));
