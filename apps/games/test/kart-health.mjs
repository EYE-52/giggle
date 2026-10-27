// Planar-mutating unit fixtures use an explicit generic variant, not physical Pocket.
// Health acceptance uses default100HP, actual elevated crate acquisition,
// physical driving and accepted inputs. Legacy declared poses isolate its
// existing planar sweep/LOS contracts; no elevated post-start mutation hooks.
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import AUTHORITY from '../games/engines/kart-elevated-combat.js';
import SHARED from '../games/engines/kart-combat-config.js';
import GAME from './fixtures/kart-planar-variant.cjs';
import CLASSIC from '../games/engines/kart-engine.js';
import PHYSICS from '../games/engines/kart-physics.js';
await RAPIER.init();
let serial=0,checks=0;const measurements={};
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;},ok=(v,label)=>{assert.ok(v,label);checks++;};
const point=(id,x,z,angle=0)=>({id,x,y:0,z,angle,surface:'floor'});
const map=(spawns=[point('a',0,0),point('b',0,10)],cover=[])=>({id:'health',revision:'1',half:80,colliders:[{id:'floor',shape:'box',position:{x:0,y:-1,z:0},half:{x:80,y:1,z:80}},...cover],spawns,sockets:[point('s0',-.7,0),point('s1',.7,0)]});
const kart=(w,id='a')=>w.snapshot().karts.find(k=>k.id===id);
const step=(w,n=1,each)=>{for(let i=0;i<n;i++){each?.(i);w.advance(w.snapshot().serverAt+CONFIG.fixedDt*1000);}};
const send=(w,id='a',intent={})=>{const s=w.snapshot(id),p=s.you;return w.input(id,{instance:s.instance,seq:p.receivedSeq+1,life:p.life,controlEpoch:p.controlEpoch,steer:0,throttle:0,brake:0,nitro:false,use:false,...intent},s.serverAt);};
const fire=(w,id='a')=>{assert.ok(send(w,id,{use:true}).ok);assert.ok(send(w,id,{use:false}).ok);step(w);};
function armed(weapon,m=map(),opts={}) {
 for(let seed=0;seed<512;seed++){
  const w=AUTHORITY.createElevatedCombat(RAPIER,CONFIG,m,m.spawns.map(p=>({id:p.id})),{instance:'health-'+(++serial),seed,countdownMs:0,roundMs:20000,crates:1,...opts});step(w);
  if(kart(w).weapon===weapon){step(w,160);return w;}w.dispose();
 }
 throw Error('bounded real pickup search failed '+weapon);
}
for(const [weapon,ammo,killShots,perShot] of [['pulse',12,10,10],['scatter',5,4,27],['rail',5,4,25]]) {
 const w=armed(weapon,weapon==='scatter'?map([point('a',0,0),point('b',0,5.2)]):map());try {
  const initialAmmo=kart(w).ammo;
  fire(w);const seen=new Set();let connectedRounds=0;
  for(let i=0;i<180;i++){
   const fresh=w.snapshot().events.filter(e=>e.type==='hit'&&e.other==='b'&&!seen.has(e.id));for(const e of fresh)seen.add(e.id);
   if(fresh.length){connectedRounds++;eq(kart(w,'b').health,Math.max(0,100-connectedRounds*perShot),weapon+' connected round '+connectedRounds+' preserves the approved damage boundary');if(connectedRounds<killShots)eq(kart(w).hits,0,weapon+' no score before lethal boundary');}
   if(!kart(w,'b').alive)break;step(w);
  }
  eq(connectedRounds,killShots,weapon+' full automatic payload reaches the same lethal round');eq(kart(w,'b').health,0,weapon+' approved fraction of one acquired clip kills');eq(kart(w).hits,1,weapon+' one acquired clip scores one KO');
  const remainingAtKo=kart(w).ammo;eq(initialAmmo,ammo,weapon+' actual crate supplies the shared clip');eq(remainingAtKo,ammo-killShots,weapon+' remaining automatic rounds stay visible until the accepted clip finishes');
  step(w,26);eq(kart(w,'b').deaths,1,weapon+' remaining automatic shots cannot double hit a dead life');
  measurements[weapon+'Clip']={initialAmmo,killShots,remainingAmmoAtKo:remainingAtKo,hits:kart(w).hits};
 }finally{w.dispose();}
}
eq(SHARED.config.maxHealth,100,'shared health capacity100');
eq(['rocket','seeker','pulse','sentry','scatter','rail','grenade','bomb','proximity','mine','spikes'].map(id=>SHARED.damageAt(id)),[40,40,10,13,9,25,65,80,70,50,30],'approved damage table');
eq([0,7,14].map(d=>SHARED.damageAt('nuke',d)),[100,60,20],'nuke radial curve reaches100 center and20 edge');
ok(Object.isFrozen(SHARED.config)&&Object.isFrozen(SHARED.config.weapons.rocket),'shared authority description cannot drift through mutation');

for(const weapon of ['pulse','rocket','seeker','rail','scatter']) {
 const w=armed(weapon,weapon==='scatter'?map([point('a',0,0),point('b',0,5.2)]):map());try {
  eq(w.snapshot().karts.map(k=>[k.health,k.maxHealth]),[[100,100],[100,100]],weapon+' fresh default health');
  if(weapon==='rocket')eq(kart(w).ammo,3,'rocket crate supplies three missiles');
  fire(w);for(let i=0;i<20&&!w.snapshot().events.some(e=>e.type==='hit'&&e.other==='b');i++)step(w);
  const hits=w.snapshot().events.filter(e=>e.type==='hit'&&e.other==='b'),damage=hits.reduce((sum,e)=>sum+e.damage,0);
  eq(damage,weapon==='scatter'?27:['rocket','seeker'].includes(weapon)?100:SHARED.damageAt(weapon),weapon+' accepted shot deals approved damage once');
  eq(kart(w,'b').health,100-damage,weapon+' hit updates authoritative health');
  if(['rocket','seeker'].includes(weapon))ok(!kart(w,'b').alive&&kart(w).hits===1&&kart(w,'b').deaths===1,weapon+' one direct hit knocks out once');
  else ok(kart(w,'b').alive&&kart(w).hits===0&&kart(w,'b').deaths===0,weapon+' one hit wounds without a score');
  ok(hits.every(e=>e.health>=0&&e.maxHealth===100&&Object.values(e.position).every(Number.isFinite)),weapon+' bounded semantic hit data');
 }finally{w.dispose();}
}
{
 const awards=[],w=armed('rocket',map(),{onAward:(...v)=>awards.push(v)});try {
  const old=w.snapshot('b').you;
  fire(w);step(w,26);eq(kart(w,'b').health,0,'one actual direct Rocket applies100 damage without splash double-count');eq(kart(w).hits,1,'direct Rocket scores at zero health');
  fire(w);step(w,26);eq(kart(w,'b').deaths,1,'second Rocket cannot duplicate damage/KO for the dead life');
  const hits=w.snapshot().events.filter(e=>e.type==='hit'&&e.other==='b');eq(hits.map(e=>e.damage),[100],'direct lethal damage is applied exactly once');
  eq(w.snapshot().events.filter(e=>e.type==='ko').length,1,'one KO event');eq(awards.filter(v=>v[1]===10).length,1,'one KO coin award');
  ok(!send(w,'b').ok&&!kart(w,'b').alive,'dead kart cannot drive');
  step(w,130);eq(kart(w,'b').health,100,'safe respawn restores100 health');ok(kart(w,'b').alive&&kart(w,'b').shield>0&&kart(w,'b').spawnSeq===old.life+1,'respawn has fresh protected life');
  ok(!w.input('b',{instance:w.snapshot().instance,life:old.life,controlEpoch:old.controlEpoch,seq:1,steer:0,throttle:1,brake:0,nitro:false,use:false},w.snapshot().serverAt).ok,'old-life input cannot control healthy respawn');
  const before=JSON.stringify(w.snapshot().karts.map(k=>[k.health,k.hits]));w.advance(w.snapshot().deadline);const done=JSON.stringify(w.snapshot().karts.map(k=>[k.health,k.hits]));w.advance(w.snapshot().deadline+10000);eq(JSON.stringify(w.snapshot().karts.map(k=>[k.health,k.hits])),done,'late pumps cannot damage or rescore finished round');ok(before===done,'deadline clean-up does not fabricate healing or damage');
 }finally{w.dispose();}
}
for(const gate of ['cover','offline']) {
 const cover={id:'cover',shape:'box',position:{x:0,y:2,z:5},half:{x:8,y:2,z:.02}};
 const w=armed('rocket',map(undefined,gate==='cover'?[cover]:[]));
 try {
  if(gate==='offline')w.setConnected('b',false);
  fire(w);step(w,35);eq(kart(w,'b').health,100,gate+' blocks physical rocket damage');eq(kart(w).hits,0,gate+' blocks scoring');eq(kart(w).health,100,'owner immune to its blast');
 }finally{w.dispose();}
}
{
 let w;for(let seed=0;seed<512;seed++){const m=map(),v=AUTHORITY.createElevatedCombat(RAPIER,CONFIG,m,m.spawns.map(p=>({id:p.id})),{instance:'protected-'+(++serial),seed,countdownMs:0,roundMs:10000,crates:1});step(v);if(kart(v).weapon==='rocket'){w=v;break;}v.dispose();}
 try{fire(w);step(w,20);eq(kart(w,'b').health,100,'real spawn shield absorbs rocket');ok(w.snapshot().events.some(e=>e.type==='impact'&&e.other==='b')&&!w.snapshot().events.some(e=>e.type==='hit'),'protected physical impact stays distinct from health hit');}finally{w.dispose();}
}
for(const weapon of ['grenade','bomb']) {
 const w=armed(weapon,map(weapon==='bomb'?[point('a',0,0),point('b',0,12),point('c',3,12)]:[point('a',0,0),point('b',0,22),point('c',3,21)]));try {
  fire(w);step(w,weapon==='grenade'?90:140);
  eq(['b','c'].map(id=>kart(w,id).health),[100-SHARED.damageAt(weapon),100-SHARED.damageAt(weapon)],weapon+' one blast damages every visible victim');
  eq(w.snapshot().events.filter(e=>e.type==='hit').length,2,weapon+' one hit per victim');eq(kart(w).hits,0,weapon+' wounds do not score');eq(kart(w).health,100,weapon+' owner immune');
 }finally{w.dispose();}
}
{
 const w=armed('nuke',map([point('a',0,0),point('b',-3,16),point('c',10,16)]));try {
  fire(w);step(w,215);const blast=w.snapshot().events.find(e=>e.type==='blast'),hits=w.snapshot().events.filter(e=>e.type==='hit');
  ok(blast&&hits.length===2,'actual delayed Nuke damages multiple physical rivals');ok(kart(w,'b').health<kart(w,'c').health&&kart(w,'c').health<100,'actual Nuke damage falls with radius');
  for(const h of hits){const p=kart(w,h.other).pose.position,d=Math.hypot(p.x-blast.position.x,p.y+.35-blast.position.y,p.z-blast.position.z);eq(h.damage,SHARED.damageAt('nuke',d),'actual Nuke uses shared radial falloff');}
  measurements.nuke={blast:blast.position,hits};
 }finally{w.dispose();}
}
// Existing1.7u relative-motion proxy, actual acquired canister/accepted input.
// A moving hull is sampled before and after its physical authority step.
{
 const w=armed('nuke',map([point('a',0,0),point('b',-4,8,Math.PI/2),point('c',6,8)])),seen=new Map();let sweep;
 try {
  fire(w);
  for(let i=0;i<80;i++) {
   if(i%6===0&&kart(w,'b').alive)send(w,'b',{throttle:1});
   const before=w.snapshot(),g=before.grenades[0],a=kart(w,'b').pose;step(w);const after=w.snapshot(),impact=after.events.find(e=>e.type==='impact'&&e.weapon==='nuke'&&e.tick===after.simTick);
   for(const e of after.events)seen.set(e.id,e);
   if(impact&&g) {
    const dt=CONFIG.fixedDt,end={x:g.position.x+g.velocity.x*dt,y:g.position.y+(g.velocity.y-30*dt)*dt,z:g.position.z+g.velocity.z*dt},d={x:end.x-g.position.x,y:end.y-g.position.y,z:end.z-g.position.z},p={x:impact.position.x-g.position.x,y:impact.position.y-g.position.y,z:impact.position.z-g.position.z},t=(p.x*d.x+p.y*d.y+p.z*d.z)/(d.x*d.x+d.y*d.y+d.z*d.z),b=kart(w,'b').pose;
    const hull=p=>({x:p.position.x+.7*(p.rotation.x*p.rotation.y-p.rotation.w*p.rotation.z),y:p.position.y+.35*(1-2*(p.rotation.x**2+p.rotation.z**2)),z:p.position.z+.7*(p.rotation.y*p.rotation.z+p.rotation.w*p.rotation.x)}),ha=hull(a),hb=hull(b),target={x:ha.x+(hb.x-ha.x)*t,y:ha.y+(hb.y-ha.y)*t,z:ha.z+(hb.z-ha.z)*t};
    sweep={fraction:t,targetMovement:Math.hypot(hb.x-ha.x,hb.y-ha.y,hb.z-ha.z),radius:Math.hypot(impact.position.x-target.x,impact.position.y-target.y,impact.position.z-target.z),position:impact.position};
   }
  }
  eq(kart(w,'b').health,0,'one acquired Nuke direct hit kills a physically moving full-health hull');eq(kart(w).hits,1,'direct Nuke awards exactly one KO');
  eq([...seen.values()].filter(e=>e.type==='hit'&&e.other==='b').map(e=>e.damage),[100],'direct Nuke target is excluded from duplicate splash');eq([...seen.values()].filter(e=>e.type==='blast'&&e.weapon==='nuke').length,1,'direct Nuke detonates exactly once before its fuse');eq(w.snapshot().grenades.length,0,'direct Nuke canister is consumed');
  ok(sweep&&sweep.fraction>=0&&sweep.fraction<=1&&sweep.targetMovement>.05&&Math.abs(sweep.radius-1.7)<1e-6,'direct Nuke contact interpolates moving hull at unchanged swept radius');
  const secondary=[...seen.values()].find(e=>e.type==='hit'&&e.other==='c');ok(secondary&&secondary.damage>0&&secondary.damage<100,'nearby indirect Nuke victim keeps radial falloff');eq(kart(w).health,100,'direct Nuke owner remains immune');measurements.nukeDirect=sweep;
 }finally{w.dispose();}
}
for(const gate of ['cover','offline','shield']) {
 const cover={id:'nuke-cover',shape:'box',position:{x:0,y:3,z:5},half:{x:8,y:3,z:.05}},m=map([point('a',0,0),point('b',-.95,8)],gate==='cover'?[cover]:[]);
 let w;
 if(gate==='shield') {
  for(let seed=0;seed<512;seed++){const v=AUTHORITY.createElevatedCombat(RAPIER,CONFIG,m,m.spawns.map(p=>({id:p.id})),{instance:'nuke-protected-'+(++serial),seed,countdownMs:0,roundMs:20000,crates:1});step(v);if(kart(v).weapon==='nuke'){w=v;break;}v.dispose();}
 }else w=armed('nuke',m);
 try {
  if(gate==='offline')w.setConnected('b',false);fire(w);const seen=new Map();step(w,gate==='shield'?60:230,()=>{for(const e of w.snapshot().events)seen.set(e.id,e);});
  eq(kart(w,'b').health,100,gate+' prevents Nuke health damage');eq(kart(w).hits,0,gate+' prevents Nuke score');eq(kart(w).health,100,gate+' preserves Nuke self immunity');
  if(gate==='shield')ok([...seen.values()].some(e=>e.type==='impact'&&e.weapon==='nuke'&&e.other==='b'),'protected Nuke hull contact remains a real impact without a health hit');
  if(gate==='cover')ok([...seen.values()].some(e=>e.type==='blast'&&e.weapon==='nuke'&&e.position.z<5),'solid cover blocks direct Nuke travel before its fuse blast');
 }finally{w.dispose();}
}
for(const kind of ['shield','spikes']) {
 const w=armed(kind,map([point('a',0,0),point('b',0,8)]));try {
  fire(w);const near=[],seen=new Map();
  step(w,145,i=>{if(i%8===0&&kart(w).alive){send(w,'a',{throttle:.45});send(w,'b',{brake:1});}const s=w.snapshot(),a=kart(w).pose.position,b=kart(w,'b').pose.position;if(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)<3.3)near.push(s.simTick);for(const e of s.events)if(e.type==='hit'&&e.weapon===kind)seen.set(e.id,e);});
  const hits=[...seen.values()];ok(hits.length>0,kind+' real driving creates contact health feedback');
  if(kind==='shield'){eq(hits[0].damage,100,'activated invincible ram shield keeps contact KO');eq(kart(w).hits,1,'activated Shield scores exactly one contact KO');}
  else {ok(hits.every(e=>e.damage<=30),'Spikes contact caps each strike at30');ok(hits.slice(1).every((e,i)=>e.tick-hits[i].tick>=30),'per-victim Spikes cooldown is at least500ms');ok(near.length>1,'contact sample covers multiple60Hz proximity frames');ok(hits[0].health===70,'first Spikes contact wounds instead of instant KO');}
  measurements[kind]={nearFrames:near.length,hits};
 }finally{w.dispose();}
}
{
 const w=armed('sentry',map([point('a',0,0),point('b',0,10),point('c',14,10)])),seen=new Map();try {
  fire(w);const deployed=w.snapshot().events.find(e=>e.type==='fire'&&e.weapon==='sentry').id;eq(w.snapshot().sentries[0]?.ammo,10,'one deployed Sentry has ten finite rounds');
  step(w,600,()=>{for(const e of w.snapshot().events)seen.set(e.id,e);});
  for(const e of w.snapshot().events)seen.set(e.id,e);
  const fires=[...seen.values()].filter(e=>e.type==='fire'&&e.weapon==='sentry'&&e.id!==deployed),hits=[...seen.values()].filter(e=>e.type==='hit'&&e.weapon==='sentry'&&e.other==='b');
  eq(fires.length,10,'long Sentry deployment fires no more than its ten-round magazine');eq(hits.map(e=>e.damage),[13,13,13,13,13,13,13,9],'eight actual Sentry hits kill and lethal damage is clipped to remaining health');eq(kart(w).hits,1,'long Sentry deployment awards one KO');eq(kart(w,'b').deaths,1,'returning life is not a duplicate Sentry victim');eq(w.snapshot().sentries.length,0,'spent Sentry retires');measurements.sentry={fires:fires.length,hits:hits.map(e=>e.damage)};
 }finally{w.dispose();}
}
{
 const w=armed('pulse'),seen=new Map();try {
  for(let i=0;i<240;i++){if(i%6===0)send(w,'a',{use:true});step(w);for(const e of w.snapshot().events)seen.set(e.id,e);}
  eq([...seen.values()].filter(e=>e.type==='fire'&&e.weapon==='pulse').length,12,'held Pulse consumes one finite twelve-round clip');eq([...seen.values()].filter(e=>e.type==='hit').length,10,'held Pulse stops health hits at its lethal tenth connection');eq(kart(w).hits,1,'held Pulse awards one KO without replay on protected respawn');ok(kart(w,'b').alive&&kart(w,'b').health===100&&kart(w,'b').shield>0,'long Pulse burst preserves fresh-life full health and shield');
 }finally{w.dispose();}
}
{
 const w=armed('mine',map([point('a',0,0),point('b',0,-10)]));try {
  fire(w);step(w,45);
  for(let i=0;i<140&&kart(w,'b').health===100;i++){if(i%8===0)send(w,'b',{throttle:.45});step(w);}
  const hit=w.snapshot().events.find(e=>e.type==='hit'&&e.weapon==='mine');
  ok(hit&&kart(w,'b').alive,'actual physical crossing reaches an armed trap and remains alive');
  eq(kart(w,'b').health,50,'one armed Mine deals50 at default100 health');
  eq(w.snapshot().mines.length,2,'only the triggered trap is consumed');eq(kart(w).hits,0,'one Mine wound awards no KO');
  measurements.mine={hit,position:kart(w,'b').pose.position};
 }finally{w.dispose();}
}

function legacy(n=2){let now=1000000;const players=Array.from({length:n},(_,i)=>({id:'p'+i,name:'P'+i})),ctx={now:()=>now,settings:()=>({mode:'Zap Battle',map:'Rookie Ring',winRule:'Time limit'}),players:()=>players.filter(p=>!ctx.offline?.has(p.id)),allPlayers:()=>players,broadcast(){},award(){},later:()=>()=>{}};const s=GAME.create(ctx);now+=3000;GAME.onTick(s,ctx);s.blocks=[];s.crates=[];s.karts.forEach((k,i)=>{k.x=0;k.z=i*10;k.angle=0;k.shield=0;k.speed=0;});return {s,ctx,step(ms=100){now+=ms;GAME.onTick(s,ctx)},fire(weapon,ammo=1){const a=s.karts[0];a.weapon=weapon;a.ammo=ammo;a.fireCd=0;a.prevAction=false;GAME.onAction(s,ctx,a.pid,{input:{steer:0,throttle:0,boost:true}});GAME.onAction(s,ctx,a.pid,{input:{steer:0,throttle:0,boost:false}});}};}
// Controlled classic placement isolates actual crate acquisition and planar
// authority; never a shipping Room actor or hidden-state acceptance claim.
for(const [weapon,ammo,killShots,perShot] of [['pulse',12,10,10],['scatter',5,4,27],['rail',5,4,25]]) {
 let r;
 for(let seed=0;seed<512;seed++) {const v=legacy();v.s.rngState=seed;v.s.crates=[{id:'pickup',x:0,z:0}];v.step(100);if(v.s.karts[0].weapon===weapon){r=v;break;}}
 ok(r,weapon+' bounded classic pickup fixture reaches weapon');const [a,b]=r.s.karts;if(weapon==='scatter')b.z=5.2;
 const initialAmmo=a.ammo;r.s.crates=[];
 for(let i=1;i<=killShots;i++) {a.fireCd=0;a.prevAction=false;GAME.onAction(r.s,r.ctx,'p0',{input:{steer:0,throttle:0,boost:true}});r.step(100);GAME.onAction(r.s,r.ctx,'p0',{input:{steer:0,throttle:0,boost:false}});for(let t=0;t<4;t++)r.step(100);eq(b.health,Math.max(0,100-i*perShot),'classic '+weapon+' acquired clip connection '+i);eq(a.hits,i===killShots?1:0,'classic '+weapon+' score only at lethal boundary');}
 eq(initialAmmo,ammo,'classic '+weapon+' actual pickup supplies same clip as elevated');eq(a.ammo,ammo-killShots,'classic '+weapon+' lethal boundary leaves expected clip remainder');measurements['classic'+weapon+'Clip']={initialAmmo,killShots,remainingAmmo:a.ammo,hits:a.hits};
}
{
 const r=legacy(),[a,b]=r.s.karts;eq([a.health,b.health],[100,100],'legacy engine starts100 health');eq(GAME.view(r.s,r.ctx,'p0').combat,SHARED.config,'legacy projects shared damage/range description');
 r.fire('rocket');r.step(100);eq(b.health,0,'legacy direct Rocket kills from100 health');eq(a.hits,1,'legacy direct Rocket awards one KO');r.fire('rocket');r.step(100);eq(b.deaths,1,'legacy dead life cannot be hit twice');
 eq(r.s.events.filter(e=>e.type==='hit').map(e=>e.damage),[100],'legacy direct rocket cannot count splash twice');for(let i=0;i<21;i++)r.step(100);eq(b.health,100,'legacy respawn restores100');ok(b.shield>0,'legacy respawn protected');
}
for(const weapon of ['pulse','scatter','rail','grenade','mine']){
 const r=legacy(),b=r.s.karts[1];
 if(weapon==='scatter')b.z=5.2;
 if(weapon==='grenade')r.s.grenades=[{id:'g',owner:'p0',x:0,z:10,y:0,vx:0,vz:0,vy:0,angle:0,fuse:.01,bounces:2}];
 else if(weapon==='mine')r.s.mines=[{id:'m',owner:'p0',x:0,z:10,armed:true,armT:0,ttl:5}];
 else r.fire(weapon);
 r.step(100);const damage=r.s.events.filter(e=>e.type==='hit').reduce((sum,e)=>sum+e.damage,0);eq(damage,weapon==='scatter'?27:SHARED.damageAt(weapon),'legacy '+weapon+' full-health damage');eq(b.health,100-damage,'legacy '+weapon+' updates health');eq(r.s.karts[0].hits,0,'legacy '+weapon+' wound grants no KO');
}
{
 const r=legacy(3);r.s.karts[1].x=-2.2;r.s.karts[2].x=2.2;r.s.karts[1].z=r.s.karts[2].z=10;
 r.s.grenades=[{id:'g',owner:'p0',x:0,z:10,y:0,vx:0,vz:0,vy:0,angle:0,fuse:.01,bounces:2}];r.step(100);eq(r.s.karts.map(k=>k.health),[100,35,35],'legacy grenade damages both visible rivals once');
}
{
 const r=legacy(3),[a,b,c]=r.s.karts;c.x=-2.2;c.z=6.4; // Generic central muzzle: separate hulls, nearby splash, no direct corridor hit
 const sweepRadius=Math.sqrt(CLASSIC.RULES.battle.constants.ZAP_HIT_R2),splashRadius=CLASSIC.RULES.battle.constants.ROCKET_SPLASH_R,expectedImpactZ=b.z-sweepRadius;
 ok(Math.abs(c.x)>sweepRadius,'generic splash rival stays outside the actual central projectile hull corridor');
 ok(Math.hypot(c.x-b.x,c.z-expectedImpactZ)<splashRadius,'generic splash rival is inside actual central-impact splash radius');
 ok(Math.hypot(b.x-c.x,b.z-c.z)>CLASSIC.constants.KART_R*2,'legacy multi-victim Rocket starts with two physically separated hulls');
 r.fire('rocket');r.step(100);
 const blast=r.s.events.find(e=>e.type==='blast');ok(blast&&Math.abs(blast.x)<1e-9&&Math.abs(blast.z-expectedImpactZ)<1e-9,'actual generic rocket blast occurs at the earliest central hull sweep contact');
 ok(Math.hypot(c.x-blast.x,c.z-blast.z)<splashRadius,'actual accepted generic blast contains the splash rival');
 eq([a.health,b.health,c.health],[100,0,60],'legacy direct Rocket kills while nearby splash victim takes40 once');
 eq(r.s.events.filter(e=>e.type==='hit').map(e=>[e.other,e.damage]).sort(),[['p1',100],['p2',40]],'legacy Rocket reports both visible victims without direct double-count');eq(a.hits,1,'legacy multi-victim Rocket awards only its direct KO');
}
for(const gate of ['shield','offline','cover','dead']){
 const r=legacy(),b=r.s.karts[1];if(gate==='shield')b.shield=2;if(gate==='offline')r.ctx.offline=new Set(['p1']);if(gate==='cover')r.s.blocks=[{x:0,z:5,hw:8,hd:.02}];if(gate==='dead'){b.health=0;b.respawn=1;}
 const before=b.health;r.fire('rocket');r.step(100);eq(b.health,before,'legacy '+gate+' immune to rocket damage');eq(r.s.karts[0].hits,0,'legacy '+gate+' cannot score');
}
for(const activated of [false,true]){
 const r=legacy(),[a,b]=r.s.karts; b.z=7;
 if(activated)r.fire('shield');else a.shield=2.5;
 let touches=0;
 for(let i=0;i<30&&b.respawn===0;i++){
  GAME.onAction(r.s,r.ctx,'p0',{input:{steer:0,throttle:.5,boost:false}});r.step(100);
  if(Math.hypot(a.x-b.x,a.z-b.z)<=CLASSIC.constants.KART_R*2+.01)touches++;
 }
 if(activated){eq(b.health,0,'legacy activated ram Shield KOs a full-health physical contact');eq(a.hits,1,'legacy ram Shield awards exactly one KO');}
 else {ok(touches>0,'legacy spawn protection test physically reaches its rival');eq(b.health,100,'legacy defensive spawn Shield never deals contact damage');eq(a.hits,0,'legacy spawn Shield grants no ram KO');}
 measurements['legacyShield'+(activated?'Active':'Spawn')]={touches,health:b.health,hits:a.hits};
}
// Physical-only classic knife rules: declared authority poses, actual Rapier
// cover queries and seeded actual crate rolls. Separate from Room acceptance.
{
 const battle=CLASSIC.RULES.battle;
 function fixture(distance=3,height=.75){
  const make=(pid,x,y)=>({pid,x,z:0,angle:0,speed:0,input:{boost:false},...battle.blankKart(),shield:0,physicalPose:{position:{x,y,z:0},rotation:{x:0,y:0,z:0,w:1},epoch:0}}),a=make('ka',0,.75),b=make('kb',distance,height);
  const s={karts:[a,b],bound:30,blocks:[],spots:[[20,20],[-20,-20]],rngState:1,scores:{ka:0,kb:0},lastTick:1000000};battle.createExtra(s);s.crates=[];
  const physics=PHYSICS.createKartPhysics(RAPIER,CONFIG),geometry={sweepStatic:(from,to)=>physics.sweepStatic(from,to)},connected=new Set(['ka','kb']);
  physics.addStatic({id:'floor',shape:'box',position:{x:0,y:-1,z:0},half:{x:40,y:1,z:40}});
  return {s,a,b,physics,geometry,connected,tick(ms=50,old){const before=old||new Map(s.karts.map(k=>[k.pid,structuredClone(k)]));s.lastTick+=ms;battle.tick(s,connected,ms/1000,before,null,new Map(),geometry);},arm(kind='spikes'){a.weapon=kind;a.ammo=1;a.fireCd=0;a.pendingFire=true;}};
 }
 // Bounded seeds prove actual pickup availability; generic rolls never add it.
 const observed=new Set();let spikesSeed;
 for(let seed=0;seed<512;seed++) {
  const f=fixture(10);try {f.s.rngState=seed;f.s.crates=[{id:'seed-crate',x:0,z:0}];f.tick(0);observed.add(f.a.weapon);if(f.a.weapon==='spikes'){spikesSeed=seed;eq(f.a.ammo,1,'physical Spikes pickup has one finite activation');eq(f.s.events.filter(e=>e.type==='pickup').length,1,'physical seed rolls through actual pickup authority');break;}}finally{f.physics.dispose();}
 }
 ok(Number.isInteger(spikesSeed),'Spikes available through bounded seeded actual physical pickup');
 const generic=new Set();for(let seed=0;seed<512;seed++) {const f=fixture(10);try {f.s.rngState=seed;f.s.crates=[{id:'generic-crate',x:0,z:0}];battle.tick(f.s,f.connected,0,new Map(f.s.karts.map(k=>[k.pid,structuredClone(k)])),null,new Map());generic.add(f.a.weapon);}finally{f.physics.dispose();}}
 eq([...generic].sort(),battle.constants.WEAPON_ORDER.slice().sort(),'generic variants retain exactly their original eight items');
 {
  const f=fixture();try {f.arm();f.tick(0);eq(f.a.spikesT,5,'accepted knives activate for five seconds');eq([f.a.weapon,f.a.ammo],[null,0],'activation consumes one item');eq(f.b.health,70,'first actual xyz contact deals30');for(let i=0;i<9;i++)f.tick(50);eq(f.b.health,70,'same victim cannot take another hit before500ms');f.tick(50);eq(f.b.health,40,'same victim takes30 at500ms');for(let i=0;i<10;i++)f.tick(50);eq(f.b.health,10,'third contact at1s retains positive health');for(let i=0;i<10;i++)f.tick(50);eq(f.b.health,0,'four bounded contacts knock out');eq(f.a.hits,1,'one contact KO');const count=f.s.events.filter(e=>e.type==='ko').length;for(let i=0;i<5;i++)f.tick(50);eq(f.a.hits,1,'dead target cannot duplicate knife score');ok(f.s.spikeHits.size<=2,'pair cooldown map remains roster bounded');eq(count,1,'single KO event at natural lethal boundary');}finally{f.physics.dispose();}
 }
 for(const guard of ['cover','vertical','invincible','offline','dead','teleport']) {
  const f=fixture(guard==='vertical'?0:3,guard==='vertical'?4.2:.75);try {
   if(guard==='cover')f.physics.addStatic({id:'knife-cover',shape:'box',position:{x:1.5,y:2,z:0},half:{x:.05,y:2,z:2}});
   if(guard==='invincible'){f.b.weapon='shield';f.b.ammo=1;f.b.pendingFire=true;}
   if(guard==='offline')f.connected.delete('kb');if(guard==='dead'){f.b.health=0;f.b.respawn=1;}
   const old=new Map(f.s.karts.map(k=>[k.pid,structuredClone(k)]));if(guard==='teleport')f.b.physicalPose.epoch++;
   f.arm();f.tick(0,old);eq(f.b.health,guard==='dead'?0:100,guard+' prevents knife damage');eq(f.a.hits,0,guard+' no knife KO');
   if(guard==='invincible'){eq(f.b.ramT,4,'shield protocol retains activated Invincibility contact effect');eq(f.b.shield,4,'Invincibility remains immune after activation');}
  }finally{f.physics.dispose();}
 }
 {
  const f=fixture(5);try {f.arm();f.tick(0);const old=new Map(f.s.karts.map(k=>[k.pid,structuredClone(k)]));f.b.x=-5;f.b.physicalPose.position.x=-5;f.tick(50,old);eq(f.b.health,70,'relative xyz sweep catches a moving hull passing through knife reach');}finally{f.physics.dispose();}
 }
 {
  const f=fixture(10);try {f.arm();f.tick(0);f.tick(4999);ok(f.a.spikesT>0,'effect remains before real authority5s expiry');f.tick(1);eq(f.a.spikesT,0,'effect ends at5s even after scheduler-sized timestamp gap');eq(battle.kartViewExtra(f.a).spikesT,0,'public projection removes expired knives');ok(!('spikesUntil' in battle.kartViewExtra(f.a)),'public projection keeps private knife deadline hidden');}finally{f.physics.dispose();}
 }
 {
  const f=fixture(10);try {f.arm();f.tick(0);f.connected.delete('ka');f.tick(50);eq(f.a.spikesT,0,'offline cancels knives immediately');f.connected.add('ka');f.tick(50);eq(f.a.spikesT,0,'reconnect does not revive knives');}finally{f.physics.dispose();}
 }
 {
  const f=fixture();try {f.arm();f.tick(0);f.b.weapon='shield';f.b.ammo=1;f.b.pendingFire=true;const old=new Map(f.s.karts.map(k=>[k.pid,structuredClone(k)]));battle.tick(f.s,f.connected,0,old,null,new Map([['contact',[f.b,f.a]]]),f.geometry);eq(f.a.health,0,'activated Invincibility contact knocks out once');eq(f.b.health,70,'activated Invincibility is immune to enemy knives');eq(f.a.spikesT,0,'KO cancels active knives');f.tick(2100);eq(f.a.spikesT,0,'fresh respawn clears knives');eq(f.a.health,100,'fresh protected life restores100');}finally{f.physics.dispose();}
 }
 {
  const f=fixture(10);try {f.arm();f.tick(0);const s=f.s,ctx={now:()=>s.lastTick,settings:()=>({}),players:()=>s.karts.map(k=>({id:k.pid})),award(){},broadcast(){},allPlayers:()=>[]};GAME.onConnection(s,ctx,'ka',false);eq(f.a.spikesT,0,'actual engine disconnect immediately clears knife projection');}finally{f.physics.dispose();}
 }
}
console.log('KART_HEALTH_PASS: '+checks+' default-health authority assertions; '+JSON.stringify(measurements));
