// Authority/rule fixtures backed by real Rapier poses and static queries.
// Shipping Pocket seq/life/epoch/TTL integration lives in kart-physical-fire.
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import config from '../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import battle from '../games/engines/kart-rules-battle.js';
import combat from '../games/engines/kart-combat-config.js';
import rooms from '../server/room.js';
import pocket from '../games/pocket-karts/server.js';
await RAPIER.init();
let checks=0;const metrics=[];
const check=(ok,label)=>{assert.ok(ok,label);checks++;};
const equal=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
function fixture(weapon='pulse'){
 const physics=createKartPhysics(RAPIER,config),connected=new Set(),s={phase:'drive',lastTick:0,half:100,bound:98,blocks:[],pads:[],surfaces:[],
  karts:[],scores:{},crates:[],zaps:[],zapSeq:0,scatterHits:new Map(),mines:[],mineSeq:0,grenades:[],grenadeSeq:0,events:[],eventSeq:0,targetHits:99};
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
for(const weapon of ['pulse','rocket','scatter','rail'])for(const pump of [50,100]){
 const f=fixture(weapon),rounds=combat.config.weapons[weapon].ammo,events=new Map();
 try{
  f.tap();let previous=rounds;
  for(let i=0;i<Math.ceil(3000/pump);i++){
   // A repeated fresh edge while firing must not append another pickup.
   if(i===2||i===4)f.tap();f.tick(pump);
   check(previous-f.a.ammo<=1,weapon+' emits at most one shell per existing tick');previous=f.a.ammo;
   for(const e of f.s.events)if(e.type==='fire'&&!events.has(e.id))events.set(e.id,{...e,at:f.s.lastTick});
  }
  equal(events.size,rounds,weapon+' one released activation emits its entire configured payload');
  equal([f.a.weapon,f.a.ammo,f.firing()],[null,0,false],weapon+' leaves no reusable partial inventory');
  const cadence=weapon==='pulse'?120:400,times=[...events.values()].map(e=>e.at);
  check(Math.abs(times.at(-1)-times[0]-(rounds-1)*cadence)<=pump,weapon+' retains existing bounded cadence');
  equal(f.s.zapSeq,rounds*(weapon==='scatter'?3:1),weapon+' pellets retain original fan size');
  const publicKart=battle.kartViewExtra(f.a);check(typeof publicKart.firing==='boolean'&&!JSON.stringify(publicKart).includes('deadline'),'public firing flag contains no private scheduler');
  metrics.push({weapon,pump,rounds:events.size,durationMs:times.at(-1)-times[0],projectiles:f.s.zapSeq});
 }finally{f.close();}
}
{
 const f=fixture('rocket');try{
  f.tap();f.tick(0);const first=f.s.events.find(e=>e.type==='fire');check(first.direction.z>.99,'first missile follows initial barrel');
  f.pose(f.a,0,0,Math.PI/2);f.pose(f.b,7,.95);f.tick(400);
  const fires=f.s.events.filter(e=>e.type==='fire');equal(fires.length,2,'second committed missile emitted without another press');
  check(fires[1].direction.x>.99&&Math.abs(fires[1].position.x-1.9)<.1,'queued shot samples the current rotated mount');
  check(f.b.health===0&&f.s.events.some(e=>e.type==='impact'&&e.other===f.b.pid),'new aim hits a target that moved away from the original line');
 }finally{f.close();}
}
for(const block of ['muzzle','cap']){
 const f=fixture();try{
  if(block==='muzzle')f.physics.addStatic({id:'barrel-block',shape:'box',half:{x:2,y:2,z:.2},position:{x:0,y:2,z:1}});
  else f.s.zaps=Array.from({length:64},(_,i)=>({id:'cap-'+i,owner:'a',kind:'pulse',physical:true,x:70,y:20,z:70,vx:0,vy:0,vz:0,ttl:20,angle:0}));
  f.tap();f.tick(0);equal([f.a.weapon,f.a.ammo,f.firing()],['pulse',12,false],block+' refusal keeps the untouched pickup');
  if(block==='muzzle')f.pose(f.a,10,0);else f.s.zaps=[];
  f.tick(250);equal(f.s.zapSeq,0,'unaccepted input cannot auto-retry after '+block+' clears');
  f.tap();f.tick(0);equal(f.a.ammo,11,'a fresh accepted press starts after '+block+' clears');
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
  f.tick(10);equal(f.s.mines.length,2,'second mine releases at .24s');
  f.tick(240);equal(f.s.mines.length,3,'third mine completes the one-press payload');
  equal([f.a.weapon,f.a.ammo,f.firing()],[null,0,false],'all three mines consume the pickup');
  const mines=f.s.mines.map(m=>structuredClone(m));
  for(let i=0;i<mines.length;i++)for(let j=i+1;j<mines.length;j++)check(Math.hypot(mines[i].x-mines[j].x,mines[i].z-mines[j].z)>=combat.config.weapons.mine.bodyRadius*2+.12,'stationary line fallback has nonoverlapping bodies');
  check(mines.every(m=>m.z<0&&m.y===0&&!m.armed),'three supported traps stay behind and initially unarmed');
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
  f.tick(240);f.tick(240);equal(f.s.mines.length,15,'accepted mine reservations complete without exceeding cap16');
  equal(owners.slice(0,5).map(k=>k.ammo),[0,0,0,0,0],'every accepted mine inventory releases all three traps');
 }finally{f.close();}
}
for(const weapon of ['bomb','proximity'])equal(Object.fromEntries(['triggerRadius','armTime','lifetime','bodyRadius'].map(k=>[k,combat.config.weapons[weapon][k]])),{triggerRadius:3,armTime:.7,lifetime:12,bodyRadius:.60},weapon+' shared proximity/body contract');

// Actual Room readiness, action tokens and private wire projections. Inventory
// is a declared UNIT fixture; all activation/release/replay actions use the
// production input path and poses remain owned by shipping Rapier motion.
await pocket.initialize();
{
 const realNow=Date.now;let now=4000000;Date.now=()=>now;
 const room=new rooms.Room('PAYL',{}),peers=[];
 try{
  for(let i=0;i<9;i++){const socket={readyState:1,bufferedAmount:0,raw:[],send(text){this.raw.push(text);},close(){}},player=room.addPlayer('Payload '+i,socket).player;peers.push({socket,player});}
  equal(room.startGame(pocket,{ready:true,settings:{map:'Rookie Ring',mode:'Zap Battle',roundSeconds:60,winRule:'Time limit'}},room.hostId),{ok:true},'actual Room starts physical Pocket preparation');
  const frame=p=>JSON.parse(p.socket.raw.at(-1)),host=peers[0],watcher=peers[8],s=room.game.state,a=s.karts.find(k=>k.pid===host.player.id);
  s.crates=[];a.weapon='rail';a.ammo=5;a.shield=0;a.fireCd=0;
  const send=(peer,seq,boost,extra={},tokens=frame(peer))=>room.onAction(peer.socket,{seq,life:tokens.inputAck?.life,controlEpoch:tokens.inputAck?.controlEpoch,input:{steer:0,throttle:0,boost,...extra}},{i:tokens.instanceId,w:tokens.w});
  send(host,1,true);equal([a.ammo,battle.kartViewExtra(a).firing],[5,false],'protocol preparation cannot commit or consume an item');
  for(const peer of peers.slice(0,8)){const f=frame(peer);room.onReady(peer.socket,{i:f.instanceId,w:f.w});}
  const retiredWindow=frame(host);
  now+=3000;room.onTick(now);equal(s.phase,'drive','normal protocol readiness/countdown releases play');
  send(host,1,true);equal(a.ammo,5,'new drive-window preparation also rejects input');
  for(const peer of peers.slice(0,8)){const f=frame(peer);room.onReady(peer.socket,{i:f.instanceId,w:f.w});}
  send(host,1,true);send(host,2,false);now+=50;room.onTick(now);
  const first=frame(host),published=first.karts.find(k=>k.pid===host.player.id);
  equal([published.weapon,published.ammo,published.firing],['rail',4,true],'short press+release publishes one committed Rail payload');
  equal(first.inputAck.receivedSeq,2,'neutral release acknowledged through production action path');
  equal(frame(watcher).inputAck,null,'watcher never receives a private driver ACK');
  check(frame(watcher).karts.find(k=>k.pid===host.player.id).firing,'watcher receives only the public firing presentation flag');
  check(!JSON.stringify(first.karts).match(/"(?:payload|deadline|poseEpoch|pendingFire|machineHeld)"/),'private queue/latch state never leaks into real wire');
  send(host,1,true);send(host,3,true,{firing:true});send(host,3,true,{},retiredWindow);
  equal(a._receivedSeq,2,'replayed sequence, private-field injection and retired action window cannot restart a payload');
  const fires=new Set(first.events.filter(e=>e.type==='fire').map(e=>e.id));let ttlObserved=false;
  for(let i=0;i<40;i++){now+=50;room.onTick(now);const f=frame(host);for(const e of f.events)if(e.type==='fire'&&e.pid===host.player.id)fires.add(e.id);ttlObserved ||= now-a.lastInputAt>1500&&a.input.boost===false;}
  equal(fires.size,5,'released physical Rail finishes every round even after movement-input TTL');
  check(ttlObserved,'actual movement-input TTL was crossed during the committed sequence');
  equal([a.weapon,a.ammo,battle.kartViewExtra(a).firing],[null,0,false],'real Room leaves no reusable partial ammo');
  a.weapon='rocket';a.ammo=3;a.fireCd=0;send(host,3,true);now+=50;room.onTick(now);
  check(battle.kartViewExtra(a).firing,'new accepted payload exists before lobby disposal');
  equal(room.endGameToLobby(room.hostId),{ok:true},'owned test Room returns to lobby');
  equal([a.ammo,a.weapon,battle.kartViewExtra(a).firing],[0,null,false],'lobby disposal clears private queue and committed remainder');
  check(peers.every(p=>frame(p).room?.game===null),'all local transport peers see lobby');
 }finally{room.destroy();Date.now=realNow;}
}
console.log(JSON.stringify({pass:true,checks,metrics,scope:'Classic private payload scheduler and actual Rapier poses/static queries; no native/browser claim'}));
