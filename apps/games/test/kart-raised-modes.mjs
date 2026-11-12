// Real shared Rapier authorities and prediction. Starting maps are declared
// diagnostic fixtures; movement and scoring use accepted input only.
import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-compat';
import C from '../public/js/engines/kart-physics-config.mjs';
import combat from '../games/engines/kart-elevated-combat.js';
import adapter from '../games/engines/kart-elevated-adapter.js';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {createElevatedPrediction} from '../public/js/engines/kart-elevated-prediction.mjs';
await R.init();
const {createElevatedCombat}=combat;
const point=(id,x,z,y=0,surface='floor',angle=0)=>({id,x,y,z,surface,angle});
const floor={id:'floor',shape:'box',half:{x:60,y:1,z:60},position:{x:0,y:-1,z:0}};
const fixture=(extra={})=>({id:'garden',revision:'mode-fixture-1',name:'Alpine Courtyard',environment:'alpine',half:60,colliders:[floor],spawns:[point('a',0,0),point('b',-30,-30)],sockets:[[0,4],[12,0],[0,12],[-12,0],[0,-12],[12,12],[-12,-12],[12,-12],[-12,12]].map(([x,z],i)=>point('home-'+i,x,z)),...extra});
let serial=0;const create=(map,opts={},seats=[{id:'a'},{id:'b'}])=>createElevatedCombat(R,C,map,seats,{instance:'mode-'+(++serial),seed:23,countdownMs:0,roundMs:90000,...opts});
const step=game=>game.advance(game.snapshot().serverAt+1000/60);
function send(game,id,extra={}){const s=game.snapshot(id),own=s.you;assert(game.input(id,{instance:s.instance,life:own.life,controlEpoch:own.controlEpoch,seq:own.receivedSeq+1,steer:0,throttle:0,brake:0,nitro:false,use:false,...extra},s.serverAt).ok);}
function pilot(game,id,target){
 const k=game.snapshot().karts.find(k=>k.id===id),p=k.pose.position,q=k.pose.rotation;
 const yaw=Math.atan2(2*(q.x*q.z+q.w*q.y),1-2*(q.x*q.x+q.y*q.y)),wanted=Math.atan2(target.x-p.x,target.z-p.z),error=Math.atan2(Math.sin(wanted-yaw),Math.cos(wanted-yaw));
 const speed=Math.hypot(k.pose.linearVelocity.x,k.pose.linearVelocity.z),desired=Math.abs(error)>1.1?3:7;
 send(game,id,{steer:Math.max(-1,Math.min(1,-error*2.5)),throttle:Math.max(0,Math.min(.65,(desired-speed)*.3)),brake:speed>desired+1?.35:0});
}
const reports=[];
// All shipping raised authorities accept all five modes, including 15 min.
for(const map of Object.values((await adapter.loadElevatedDependencies()).maps))for(const [mode,garage]of [['battle',false],['battle',true],['starrush',false],['teambattle',false],['ctf',false]]){
 const seats=mode==='ctf'?[{id:'z'},{id:'a'}]:[{id:'a'},{id:'b'}],game=create(map,{mode,garage,roundMs:900000},seats);const s=game.snapshot();
 assert.equal(s.mode,mode);assert.equal(s.garage,garage);assert.equal(s.deadline-s.liveAt,900000);
 if(mode==='starrush'){assert.equal(s.stars.length,6);assert.equal(s.crates.length,0);assert(s.karts.every(k=>!k.weapon));}
 if(mode==='ctf'){
  assert.equal(s.flags.length,2);assert.equal(s.bases.length,2);
  for(const kart of s.karts){const own=s.bases.find(b=>b.teamId===s.teamByPlayer[kart.id]),other=s.bases.find(b=>b!==own),p=kart.pose.position;assert(Math.hypot(p.x-own.position.x,p.z-own.position.z)<=Math.hypot(p.x-other.position.x,p.z-other.position.z),map.id+' shuffled seat starts on its own CTF side');assert(Math.min(...s.bases.map(b=>Math.hypot(p.x-b.position.x,p.z-b.position.z)))>=5.19,map.id+' initial hull does not cover a flag home');}
 }

 game.dispose();
}
assert.throws(()=>create(fixture(),{roundMs:900001}),/round timing/);
for(const mode of ['battle','starrush','teambattle','ctf']){
 const game=create(fixture(),{mode,roundMs:900000,winRule:'Time limit'});game.advance(900000);assert.equal(game.snapshot().phase,'done');assert.equal(game.result().endedAt,900000);assert.equal(game.result().reason,'deadline');game.dispose();
}

// Preferred sides never reduce the approved crowded Foundry grid capacity.
{
 const game=create(elevatedMap('foundry'),{mode:'ctf'},Array.from({length:32},(_,i)=>({id:'p'+String(32-i).padStart(2,'0')}))),s=game.snapshot();
 assert.equal(s.karts.length,32);assert(s.teams.every(t=>t.members.length===16));
 for(const k of s.karts)for(const b of s.bases)assert(Math.abs(k.pose.position.y-.65-b.position.y)>=2.5||Math.hypot(k.pose.position.x-b.position.x,k.pose.position.z-b.position.z)>=5.19,'crowded starts clear flag homes');game.dispose();
}

// Drive to eight real stars. No weapon pickup or wallet change in Star Rush.
{
 const game=create(fixture(),{mode:'starrush',targetStars:8,winRule:'Score target'});let ticks=0;
 while(game.snapshot().phase!=='done'&&ticks++<5400){const s=game.snapshot(),p=s.karts[0].pose.position,target=s.stars.reduce((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)<Math.hypot(b.x-p.x,b.z-p.z)?a:b);if(ticks%3===0)pilot(game,'a',target);step(game);}
 const s=game.snapshot();assert.equal(s.phase,'done','legal driving reaches Star Rush target');assert.equal(s.karts[0].stars,8);assert.equal(s.result.scores[0].score,8);assert.deepEqual(s.result.winners,['a']);assert.equal(s.you,null);assert.equal(game.privateStatus('a').coins,0);assert.equal(s.crates.length,0);
 reports.push({mode:'starrush',stars:s.karts[0].stars,ticks});game.dispose();
}
// A star directly over the kart on another deck cannot be collected below.
{
 const upper={id:'upper',shape:'deck',half:{x:8,y:.5,z:8},position:{x:0,y:5.5,z:0}},map=fixture({colliders:[floor,upper],sockets:[point('upper-home',0,0,6,'upper'),point('floor-home',25,25)]}),game=create(map,{mode:'starrush'});
 for(let n=0;n<120;n++)step(game);assert.equal(game.snapshot().stars[0].y,6);assert.equal(game.snapshot().karts[0].stars,0,'stacked stars require the correct height and support');game.dispose();
}
// Team mode authority keeps teams/results and shuts off allied targeting.
{
 const map=fixture({spawns:[point('a',0,0),point('b',15,0),point('c',0,15),point('d',15,15)]}),game=create(map,{mode:'teambattle',roundMs:1000},[{id:'a'},{id:'b'},{id:'c'},{id:'d'}]);
 const s=game.snapshot();assert.equal(s.teamByPlayer.a,s.teamByPlayer.c);assert.notEqual(s.teamByPlayer.a,s.teamByPlayer.b);game.advance(1000);const done=game.snapshot();assert.equal(done.result.teamResult.draw,true);assert(done.result.teamResult.standings.every(r=>r.points===150));game.dispose();
}
// Real weapon activation passes through an allied hull to the rival behind.
{
 const map=fixture({spawns:[point('a',0,0),point('b',20,0),point('c',0,8),point('d',0,18)],sockets:[point('near-a',-.7,0),point('near-a-alt',.7,0)]});let game;
 for(let seed=0;seed<256;seed++){
  const attempt=create(map,{mode:'teambattle',seed,initialHealth:1,targetHits:1,winRule:'Score target',crates:1},['a','b','c','d'].map(id=>({id})));step(attempt);
  if(attempt.snapshot().karts[0].weapon==='machinegun'){game=attempt;break;}attempt.dispose();
 }
 assert(game,'bounded real pickup finds machinegun');for(let n=0;n<160;n++)step(game);
 send(game,'a',{use:true});send(game,'a',{use:false});for(let n=0;n<180&&game.snapshot().phase!=='done';n++)step(game);
 const s=game.snapshot();assert.equal(s.karts.find(k=>k.id==='c').health,1,'ally takes no damage and does not stop the shot');assert.equal(s.karts.find(k=>k.id==='d').alive,false,'rival behind ally receives the lethal hit');assert.equal(s.result.reason,'target');
 assert.deepEqual(s.result.teamResult.winners,['a','c']);assert(s.result.teamResult.standings.filter(r=>['a','c'].includes(r.pid)).every(r=>r.points===300));assert(s.result.teamResult.standings.filter(r=>['b','d'].includes(r.pid)).every(r=>r.points===200));game.dispose();
}
// A score target does not shorten a time-limit Star Rush, and a whole team
// leaving awards the remaining team without calling a scoreless draw.
{
 const game=create(fixture({sockets:[point('first',0,0),point('next',12,12)]}),{mode:'starrush',targetStars:1,winRule:'Time limit',roundMs:1000});step(game);assert.equal(game.snapshot().karts[0].stars,1);assert.equal(game.snapshot().phase,'live');game.advance(1000);assert.equal(game.snapshot().result.reason,'deadline');game.dispose();
 const team=create(fixture({spawns:[point('a',0,0),point('b',15,0),point('c',0,15),point('d',15,15)]}),{mode:'teambattle'},['a','b','c','d'].map(id=>({id})));
 team.drop('a');team.drop('c');assert.equal(team.snapshot().phase,'done');assert.equal(team.result().teamResult.draw,false);assert.deepEqual(team.result().teamResult.winners,['b','d']);team.dispose();
}
// Real flag pickup/carry/return to base; the other driver leaves its base
// through accepted throttle. No direct flag, score, pose or hit mutation.
{
 const map=fixture({spawns:[point('a',0,0),point('b',0,22)]}),game=create(map,{mode:'ctf',targetFlags:1,winRule:'Score target'});let ticks=0,carried=false;
 while(game.snapshot().phase!=='done'&&ticks++<5400){const s=game.snapshot(),own=s.teamByPlayer.a,enemy=s.flags.find(f=>f.teamId!==own),home=s.bases.find(b=>b.teamId===own),target=enemy.carrierId==='a'?home.position:enemy.position;carried||=enemy.carrierId==='a';if(ticks%3===0){pilot(game,'a',target);const defender=s.karts.find(k=>k.id==='b');if(defender.alive)send(game,'b',{throttle:defender.pose.position.z<38?.4:0,brake:defender.pose.position.z<38?0:1});}step(game);}
 const s=game.snapshot();assert(carried,'a real moving kart carries the enemy flag');assert.equal(s.phase,'done','returning to home scores the target capture');assert.equal(s.capturesByPlayer.a,1);assert.deepEqual(s.result.teamResult.winners,['a']);reports.push({mode:'ctf',captures:s.capturesByPlayer.a,ticks});game.dispose();
}
// Reload upgrades alter actual committed fire intervals, not just labels.
{
 const map=fixture({spawns:[point('a',0,0),point('b',-30,-30)],sockets:[point('pickup',-.7,0),point('alternate',.7,0)]}),timings=[];
 for(const level of [0,3]){
  let game;for(let seed=0;seed<256;seed++){const attempt=create(map,{seed,garage:true,upgrades:{a:{reload:level}},crates:1});step(attempt);if(attempt.snapshot().karts[0].weapon==='machinegun'){game=attempt;break;}attempt.dispose();}
  assert(game);send(game,'a',{use:true});send(game,'a',{use:false});const fires=new Map();
  for(let n=0;n<180&&fires.size<9;n++){step(game);for(const e of game.snapshot().events)if(e.type==='fire'&&e.pid==='a')fires.set(e.id,e.tick);}
  const ticks=[...fires.values()];assert.equal(ticks.length,9);timings.push((ticks[8]-ticks[0])/60);game.dispose();
 }
 assert(timings[1]<timings[0]*.9,'reload levels shorten real fire cadence');reports.push({mode:'garage-reload',baseSeconds:timings[0],level3Seconds:timings[1]});
 const parked=create(fixture({sockets:[point('one',-.7,0),point('two',.7,0)]}),{mode:'starrush',winRule:'Time limit'});for(let n=0;n<120;n++)step(parked);assert.equal(parked.snapshot().karts[0].stars,1,'returning stars cannot be farmed without leaving their home');parked.dispose();
}
// Raised local prediction applies the same Garage levels as authority.
{
 const map=elevatedMap('garden'),game=create(map,{garage:true,upgrades:{a:{engine:3,handling:3,reload:3}}}),prediction=createElevatedPrediction(R);let maxError=0;
 const view=raw=>({...raw,instanceId:raw.instance,you:'a',youDrive:true,inputAck:raw.you,profile:'elevated-combat-v1'});let last=view(game.snapshot('a'));prediction.ingest(last,0,last.serverAt);
 for(let n=1;n<=90;n++){if(n%3===1)send(game,'a',{throttle:.4,steer:.15});const at=n*1000/60;const predicted=prediction.frame(last,{throttle:.4,steer:.15,brake:0,nitro:false,use:false},1/60,at,at);game.advance(at);const next=view(game.snapshot('a'));if(predicted)maxError=Math.max(maxError,Math.hypot(...['x','y','z'].map(axis=>predicted.pose.position[axis]-next.karts[0].pose.position[axis])));if(n%3===0){prediction.ingest(next,at,at);last=next;}}
 const s=game.snapshot();assert.equal(s.karts[0].tuning.top,1.15);assert.equal(s.karts[0].tuning.turn,1.12);assert.equal(s.karts[0].tuning.reload,.82);assert(maxError<.15,'Garage authority/prediction agree '+maxError);reports.push({mode:'garage',maxPredictionErrorM:maxError});prediction.dispose();game.dispose();
}
console.log(JSON.stringify({pass:true,scope:'real raised Rapier modes, supported authored maps, accepted input scoring, no gameplay mutation hooks',reports}));
