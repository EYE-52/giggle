// Authority/rule fixtures backed by real Rapier poses and static queries.
// Shipping Pocket seq/life/epoch/TTL integration lives in kart-physical-fire.
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import config from '../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import battle from '../games/engines/kart-rules-battle.js';
import {CURATED_MUZZLE} from '../public/js/engines/kart-weapon-contract.mjs';
import combat from '../games/engines/kart-combat-config.js';
import rooms from '../server/room.js';
import pocket from '../games/pocket-karts/server.js';
await RAPIER.init();
let checks=0;const metrics=[];
const check=(ok,label)=>{assert.ok(ok,label);checks++;};
const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
function fixture(weapon='machinegun'){
 const physics=createKartPhysics(RAPIER,config),connected=new Set(),s={phase:'drive',lastTick:0,half:100,bound:98,blocks:[],pads:[],surfaces:[],
  karts:[],scores:{},crates:[],zaps:[],zapSeq:0,volleyHits:new Map(),mines:[],mineSeq:0,grenades:[],grenadeSeq:0,events:[],eventSeq:0,targetHits:99};
 physics.addStatic({id:'floor',shape:'box',half:{x:100,y:.5,z:100},position:{x:0,y:-.5,z:0}});
 const sync=()=>{for(const k of s.karts){k.physicalPose=physics.pose(k.pid);k.x=k.physicalPose.position.x;k.z=k.physicalPose.position.z;const q=k.physicalPose.rotation;k.angle=Math.atan2(2*(q.x*q.z+q.w*q.y),1-2*(q.x*q.x+q.y*q.y));}};
 function add(pid,x,z,kind){physics.addKart(pid,{position:{x,y:.7,z}});const k={pid,x,z,angle:0,speed:0,boost:0,input:{throttle:0,steer:0,boost:false},controlEpoch:0,...battle.blankKart(),shield:0,weapon:kind||null,ammo:combat.config.weapons[kind]?.ammo||0};s.karts.push(k);s.scores[pid]=0;connected.add(pid);sync();return k;}
 const a=add('a',0,0,weapon),b=add('b',40,40);physics.step(15);sync();
 const geometry={sweepStatic:(...args)=>physics.sweepStatic(...args),supportAt:(...args)=>physics.supportAt(...args),groundAt:()=>0};
 return {s,a,b,physics,geometry,connected,add,
  firing:()=>battle.kartViewExtra(a).firing,
  tap(k=a){k.pendingFire=true;k.input.boost=false;},
  pose(k,x,z,angle=0){const p=physics.pose(k.pid);physics.restoreKart(k.pid,{...p,position:{x,y:.7,z},rotation:{x:0,y:Math.sin(angle/2),z:0,w:Math.cos(angle/2)},linearVelocity:{x:0,y:0,z:0},angularVelocity:{x:0,y:0,z:0}});sync();},
  tick(ms=50){const before=new Map(s.karts.map(k=>[k.pid,structuredClone(k)]));s.lastTick+=ms;
   let steps=Math.round(ms/1000/config.fixedDt);while(steps>0){const n=Math.min(15,steps);physics.step(n);steps-=n;}sync();
   battle.tick(s,connected,ms/1000,before,null,new Map(),geometry);},
  close(){battle.cancelPayloads(s);physics.dispose();},
 };
}
// Collect normally, spend the whole pickup, then wait at its old position.
// The empty slot must not turn a recycled box into a camping reward loop.
{
 let f;
 for(let seed=0;seed<256;seed++){
  const candidate=fixture('');candidate.s.rngState=seed;candidate.s.crateSeq=1;
  candidate.s.spots=[[0,0],[20,0],[-20,0],[20,20]];
  candidate.s.crates=[{id:'camping-box',x:0,z:0}];candidate.tick(0);
  if(candidate.a.weapon==='trishot'){f=candidate;break;}candidate.close();
 }
 assert(f,'seeded normal crate roll supplies the camping test');
 try{
  const origin=f.physics.pose('a').position,pickups=new Set(f.s.events.filter(e=>e.type==='pickup'&&e.pid==='a').map(e=>e.id));
  f.tap();for(let i=0;i<280;i++){f.tick(50);for(const e of f.s.events)if(e.type==='pickup'&&e.pid==='a')pickups.add(e.id);}
  check(!f.a.weapon&&!f.firing(),'parked driver spent the complete pickup');
  equal(pickups.size,1,'empty parked driver earns no additional pickup across seven 2s intervals');
  check(Math.hypot(f.a.x-origin.x,f.a.z-origin.z)<.1,'camping driver stayed at the original pickup coordinates');
  check(f.s.crates.every(c=>Math.hypot(c.x-origin.x,c.z-origin.z)>2.4),'classic crate recycles outside the parked pickup radius');
 }finally{f.close();}
}
for(const weapon of ['machinegun','missile','trishot','cannon'])for(const pump of [50,100]){
 const f=fixture(weapon),rounds=combat.config.weapons[weapon].ammo/(weapon==='trishot'?3:1),events=new Map();
 try{
  f.tap();let previous=f.a.ammo;
  for(let i=0;i<Math.ceil(3000/pump);i++){
   // A repeated fresh edge while firing must not append another pickup.
   if(i===2||i===4)f.tap();f.tick(pump);
   check(previous-f.a.ammo<=Math.ceil(pump/1000*(weapon==='machinegun'?12:4))*(weapon==='trishot'?3:1),weapon+' emits at most one shell per existing tick');previous=f.a.ammo;
   for(const e of f.s.events)if(e.type==='fire'&&!events.has(e.id))events.set(e.id,{...e,at:f.s.lastTick});
  }
  equal(events.size,rounds,weapon+' one released activation emits its entire configured payload');
  equal([f.a.weapon,f.a.ammo,f.firing()],[null,0,false],weapon+' leaves no reusable partial inventory');
  const cadence=weapon==='machinegun'?1000/12:weapon==='trishot'?280:weapon==='cannon'?340:400,times=[...events.values()].map(e=>e.at);
  check(Math.abs(times.at(-1)-times[0]-(rounds-1)*cadence)<=pump,weapon+' retains existing bounded cadence');
  equal(f.s.zapSeq,rounds*(weapon==='trishot'?3:1),weapon+' pellets retain original fan size');
  const publicKart=battle.kartViewExtra(f.a);check(typeof publicKart.firing==='boolean'&&!JSON.stringify(publicKart).includes('deadline'),'public firing flag contains no private scheduler');
  metrics.push({weapon,pump,rounds:events.size,durationMs:times.at(-1)-times[0],projectiles:f.s.zapSeq});
 }finally{f.close();}
}
{
 const f=fixture('trishot');try{
  f.tap();f.tick(0);const first=f.s.events.find(e=>e.type==='fire');check(first.direction.z>.99,'first missile follows initial barrel');
  f.pose(f.a,0,0,Math.PI/2);f.pose(f.b,7,-CURATED_MUZZLE.x);f.tick(400);
  const fires=f.s.events.filter(e=>e.type==='fire');equal(fires.length,2,'second committed missile emitted without another press');
  check(fires[1].direction.x>.99&&Math.abs(fires[1].position.x-CURATED_MUZZLE.z)<.1,'queued shot samples the current rotated mount');
  check(f.b.health<100&&f.b.health>=50-1e-8&&f.s.events.some(e=>e.type==='impact'&&e.other===f.b.pid),'new aim hits (2 hearts) a target that moved away from the original line');
 }finally{f.close();}
}
for(const kind of ['machinegun','trishot']){
 const f=fixture(kind);try{
  f.pose(f.b,6,15);f.tap();f.tick(0);
  const fire=f.s.events.find(e=>e.type==='fire');
  check(kind==='machinegun'?fire.direction.x>.3:Math.abs(fire.direction.x)<.01,kind+' uses its own aiming rule');
  for(let i=0;i<5;i++)f.tick(50);
  check(kind==='machinegun'?f.b.health<100:f.b.health===100,kind+' off-axis target result');
 }finally{f.close();}
}
for(const blocked of [false,true]){
 const f=fixture('machinegun');try{
  f.pose(f.b,0,-10);const left=f.add('left',-15,2);
  if(blocked)f.physics.addStatic({id:'rear-cover',shape:'box',position:{x:0,y:1,z:-4},half:{x:3,y:2,z:.4}});
  f.tap();f.tick(0);
  const first=f.s.events.find(e=>e.type==='fire');
  check(blocked?first.direction.x<-.95:first.direction.z<-.95,'tracks the nearest visible rival beside or behind the kart');
  f.tick(150);
  check((blocked?left:f.b).health<100&&(blocked?f.b:left).health===100,'only the visible target receives tracking hits');
 }finally{f.close();}
}
for(const kind of ['machinegun','missile']){
 const f=fixture(kind);try{
  f.pose(f.b,0,kind==='missile'?-12:-45);f.tap();f.tick(0);
  const e=f.s.events.find(e=>e.type==='fire');
  check(e.direction.z>.99&&!e.targetId,kind+' respects its range or forward lock cone');
 }finally{f.close();}
}
{
 const f=fixture('cannon');try{
  f.pose(f.b,0,10);f.tap();f.tick(0);
  for(let i=0;i<5;i++)f.tick(50);
  equal(f.b.health,50,'first rocket takes half the rival HP');
  for(let i=0;i<7;i++)f.tick(50);
  equal(f.b.health,0,'second rocket scores a knockout');
  equal([f.a.hits,f.a.ammo,f.firing()],[1,1,true],'knockout keeps the third rocket loaded');
  for(let i=0;i<4;i++)f.tick(50);
  equal(f.s.zapSeq,3,'third rocket still launches after scoring');
 }finally{f.close();}
}
for(const kind of ['fakecrate','proximity']){
 const f=fixture(kind);try{
  f.tap();f.tick(0);const mine=f.s.mines[0];equal(mine.kind,kind,'trap publishes its own identity');
  f.tick(750);f.pose(f.b,mine.x,mine.z);f.tick(0);
  check(kind==='fakecrate'?f.b.health===0:(f.b.health>0&&f.b.health<100),'armed '+kind+' resolves its own contact effect');
  equal(f.s.mines.length,0,'spent trap disappears');
 }finally{f.close();}
}
for(const kind of ['blades','supernova']){
 const f=fixture(kind);try{
  f.pose(f.b,2.5,0);f.tap();f.tick(0);f.tick(50);
  equal(f.a.hits,1,kind+' contact scores a knockout');
  const timer=kind==='blades'?'bladesT':'supernovaT';check(f.a[timer]>0,kind+' remains active after scoring');
  const c=f.add('c',-2.5,0);f.tick(150);equal(c.health,0,kind+' can then knock out another rival');
 }finally{f.close();}
}
for(const block of ['muzzle','cap']){
 const f=fixture();try{
  if(block==='muzzle')f.physics.addStatic({id:'barrel-block',shape:'box',half:{x:2,y:2,z:.2},position:{x:CURATED_MUZZLE.x,y:.7+CURATED_MUZZLE.y,z:1}});
  else f.s.zaps=Array.from({length:64},(_,i)=>({id:'cap-'+i,owner:'a',kind:'machinegun',physical:true,x:70,y:20,z:70,vx:0,vy:0,vz:0,ttl:20,angle:0}));
  f.tap();f.tick(0);equal([f.a.weapon,f.a.ammo,f.firing()],['machinegun',30,false],block+' refusal keeps the untouched pickup');
  if(block==='muzzle')f.pose(f.a,10,0);else f.s.zaps=[];
  f.tick(250);equal(f.s.zapSeq,0,'unaccepted input cannot auto-retry after '+block+' clears');
  f.tap();f.tick(0);equal(f.a.ammo,29,'a fresh accepted press starts after '+block+' clears');
  // Once committed, later obstruction/cap cannot leave a reusable remainder.
  f.geometry.sweepStatic=()=>({fraction:0,point:{x:0,y:0,z:0},normal:{x:0,y:0,z:1}});
  f.tick(8100);equal([f.a.weapon,f.a.ammo,f.firing()],[null,0,false],'blocked committed payload expires within8s and discards remainder');
 }finally{f.close();}
}
{
 const f=fixture();try{
  f.tap();f.tick(0);f.s.crates=[{id:'new-crate',x:f.a.x,z:f.a.z}];const crate=f.s.crates[0];
  f.tick(50);equal(f.s.crates[0].id,crate.id,'active payload explicitly blocks a new pickup');
  const before=JSON.stringify(battle.kartViewExtra(f.a));f.s.phase='countdown';f.tick(100);
  equal([f.a.ammo,f.firing()],[0,false],'preparation/phase reset cancels an active payload');
  check(!before.includes('payload')&&!before.includes('deadline')&&!before.includes('poseEpoch'),'private queue fields never project');
 }finally{f.close();}
}
{
 const f=fixture('mine');try{
  f.tap();f.tick(0);equal(f.s.mines.length,1,'one activation starts with one mine, not simultaneous traps');
  check(f.firing()&&f.a.ammo===2,'mine HUD retains weapon and two committed remaining drops');
  f.tick(230);equal(f.s.mines.length,1,'next mine waits for .24s interval');
  f.tick(10);equal(f.s.mines.length,1,'stationary kart waits for movement');
  f.pose(f.a,0,3);f.tick(0);equal(f.s.mines.length,2,'second mine releases after driving');
  f.pose(f.a,0,6);f.tick(240);equal(f.s.mines.length,3,'third mine completes the one-press payload');
  equal([f.a.weapon,f.a.ammo,f.firing()],[null,0,false],'all three mines consume the pickup');
  const mines=f.s.mines.map(m=>structuredClone(m));
  for(let i=0;i<mines.length;i++)for(let j=i+1;j<mines.length;j++)check(Math.hypot(mines[i].x-mines[j].x,mines[i].z-mines[j].z)>=combat.config.weapons.mine.bodyRadius*2+.12,'moving trail has nonoverlapping bodies');
  check(mines.every((m,i)=>m.z<i*3&&m.y===0&&!m.armed),'three supported traps stay behind and initially unarmed');
  f.tick(220);check(f.s.mines[0].armed,'first mine arms after .7s');
  f.pose(f.a,mines[0].x,mines[0].z);f.tick(50);equal(f.a.health,100,'exact owner is immune to own armed traps');
  const eventCount=f.s.eventSeq;f.tick(13000);equal(f.s.mines.length,0,'untriggered three-mine payload quietly expires');
  equal(f.s.eventSeq,eventCount,'quiet lifetime expiry emits no blast or damage event');
  metrics.push({weapon:'mine',drops:mines.map(m=>({x:m.x,z:m.z,y:m.y})),armTime:combat.config.weapons.mine.armTime,lifetime:combat.config.weapons.mine.lifetime});
 }finally{f.close();}
}
{
 const f=fixture('mine');try{
  f.tap();f.tick(0);f.pose(f.a,0,3);f.tick(240);check(f.s.mines[1].z>0,'second moving drop follows current pose rather than a frozen spread');
  f.geometry.supportAt=()=>null;f.tick(8000);equal([f.a.weapon,f.a.ammo,f.firing()],[null,0,false],'lost future mine ground cancels without reusable partial ammo');
 }finally{f.close();}
}
{
 const f=fixture('mine');try{
  const support=f.geometry.supportAt;
  f.geometry.supportAt=(point,...args)=>Math.hypot(point.x-f.a.x,point.z-f.a.z)<.01?support(point,...args):null;
  f.tap();f.tick(0);
  equal([f.s.mines.length,f.a.ammo,f.firing()],[0,3,false],'support only beneath owner cannot place a behind-kart trap');
  f.geometry.supportAt=support;f.tap();f.tick(0);equal(f.a.ammo,2,'fresh legal rear support accepts the full pickup');
  f.geometry.supportAt=(point,...args)=>Math.hypot(point.x-f.a.x,point.z-f.a.z)<.01?support(point,...args):null;
  f.tick(8100);equal([f.s.mines.length,f.a.ammo,f.firing()],[1,0,false],'blocked rear after commitment expires without owner-center drops or reusable remainder');
 }finally{f.close();}
}
{
 const f=fixture('mine');try{
  f.pose(f.a,0,-f.s.bound);f.tap();f.tick(0);
  equal([f.s.mines.length,f.a.ammo,f.firing()],[0,3,false],'rear candidates outside map cannot clamp into owner-center drops');
 }finally{f.close();}
}
{
 const f=fixture('mine');try{
  const owners=[f.a];for(let i=1;i<6;i++)owners.push(f.add('layer'+i,i*10,0,'mine'));
  for(const k of owners)f.tap(k);f.tick(0);
  equal(f.s.mines.length,5,'five full three-mine payloads reserve15 of16 slots');
  equal([owners[5].ammo,battle.kartViewExtra(owners[5]).firing],[3,false],'sixth payload stays untouched when all three drops cannot fit');
  for(const z of [3,6]){for(const k of owners)f.pose(k,k.x,z);f.tick(240);}equal(f.s.mines.length,15,'accepted mine reservations complete without exceeding cap16');
  equal(owners.slice(0,5).map(k=>k.ammo),[0,0,0,0,0],'every accepted mine inventory releases all three traps');
 }finally{f.close();}
}
// Actual Room readiness, action tokens and private wire projections. Inventory
// is a declared UNIT fixture; all activation/release/replay actions use the
// production input path and poses remain owned by shipping Rapier motion.
await pocket.initialize();
{
 const realNow=Date.now;let now=4000000;Date.now=()=>now;
 const room=new rooms.Room('PAYL',{}),peers=[];
 try{
  const join=i=>{const socket={readyState:1,bufferedAmount:0,raw:[],send(text){this.raw.push(text);},close(){}},player=room.addPlayer('Payload '+i,socket).player;peers.push({socket,player});};
  for(let i=0;i<8;i++)join(i);
  equal(room.startGame(pocket,{ready:true,settings:{map:'Rookie Ring',mode:'Zap Battle',roundSeconds:60,winRule:'Time limit'}},room.hostId),{ok:true},'actual Room starts physical Pocket preparation');
  join(8); // classic arenas seat 32, so the watcher is a late joiner
  const frame=p=>JSON.parse(p.socket.raw.at(-1)),host=peers[0],watcher=peers[8],s=room.game.state,a=s.karts.find(k=>k.pid===host.player.id);
  s.crates=[];a.weapon='trishot';a.ammo=9;a.shield=0;a.fireCd=0;
  const send=(peer,seq,boost,extra={},tokens=frame(peer))=>room.onAction(peer.socket,{seq,life:tokens.inputAck?.life,controlEpoch:tokens.inputAck?.controlEpoch,input:{steer:0,throttle:0,boost,...extra}},{i:tokens.instanceId,w:tokens.w});
  send(host,1,true);equal([a.ammo,battle.kartViewExtra(a).firing],[9,false],'protocol preparation cannot commit or consume an item');
  for(const peer of peers.slice(0,8)){const f=frame(peer);room.onReady(peer.socket,{i:f.instanceId,w:f.w});}
  const retiredWindow=frame(host);
  now+=3000;room.onTick(now);equal(s.phase,'drive','normal protocol readiness/countdown releases play');
  send(host,1,true);equal(a.ammo,9,'new drive-window preparation also rejects input');
  for(const peer of peers.slice(0,8)){const f=frame(peer);room.onReady(peer.socket,{i:f.instanceId,w:f.w});}
  send(host,1,true);send(host,2,false);now+=50;room.onTick(now);
  const first=frame(host),published=first.karts.find(k=>k.pid===host.player.id);
  equal([published.weapon,published.ammo,published.firing],['trishot',6,true],'short press+release publishes one committed Scatter payload');
  equal(first.inputAck.receivedSeq,2,'neutral release acknowledged through production action path');
  equal(frame(watcher).inputAck,null,'watcher never receives a private driver ACK');
  check(frame(watcher).karts.find(k=>k.pid===host.player.id).firing,'watcher receives only the public firing presentation flag');
  check(!JSON.stringify(first.karts).match(/"(?:payload|deadline|poseEpoch|pendingFire|machineHeld)"/),'private queue/latch state never leaks into real wire');
  send(host,1,true);send(host,3,true,{firing:true});send(host,3,true,{},retiredWindow);
  equal(a._receivedSeq,2,'replayed sequence, private-field injection and retired action window cannot restart a payload');
  const fires=new Set(first.events.filter(e=>e.type==='fire').map(e=>e.id));let ttlObserved=false;
  for(let i=0;i<40;i++){now+=50;room.onTick(now);const f=frame(host);for(const e of f.events)if(e.type==='fire'&&e.pid===host.player.id)fires.add(e.id);ttlObserved ||= now-a.lastInputAt>1500&&a.input.boost===false;}
  equal(fires.size,3,'released physical Scatter finishes every round even after movement-input TTL');
  check(ttlObserved,'actual movement-input TTL was crossed during the committed sequence');
  equal([a.weapon,a.ammo,battle.kartViewExtra(a).firing],[null,0,false],'real Room leaves no reusable partial ammo');
  a.weapon='machinegun';a.ammo=24;a.fireCd=0;send(host,3,true);now+=50;room.onTick(now);
  check(battle.kartViewExtra(a).firing,'new accepted payload exists before lobby disposal');
  equal(room.endGameToLobby(room.hostId),{ok:true},'owned test Room returns to lobby');
  equal([a.ammo,a.weapon,battle.kartViewExtra(a).firing],[0,null,false],'lobby disposal clears private queue and committed remainder');
  check(peers.every(p=>frame(p).room?.game===null),'all local transport peers see lobby');
 }finally{room.destroy();Date.now=realNow;}
}
console.log(JSON.stringify({pass:true,checks,metrics,scope:'Classic private payload scheduler and actual Rapier poses/static queries; no native/browser claim'}));
