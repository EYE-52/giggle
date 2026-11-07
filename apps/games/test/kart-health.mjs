// Planar-mutating unit fixtures use an explicit generic variant, not physical Pocket.
// Hearts acceptance uses the default three hearts, actual elevated crate acquisition,
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
// One acquired clip is one volley: however many rounds connect, the rival
// loses one heart, and the clip never scores a KO from full hearts.
for(const [weapon,ammo] of [['machinegun',24],['trishot',3]]) {
 const w=armed(weapon,weapon==='trishot'?map([point('a',0,0),point('b',0,5.2)]):map());try {
  const initialAmmo=kart(w).ammo;
  fire(w);const seen=new Map();
  for(let i=0;i<180;i++){for(const e of w.snapshot().events)if(e.type==='hit'&&e.other==='b')seen.set(e.id,e);if(seen.size)eq(kart(w,'b').health,2,weapon+' connected clip holds the rival at two hearts');step(w);}
  eq(initialAmmo,ammo,weapon+' actual crate supplies the shared clip');eq(kart(w).firing,false,weapon+' accepted clip finishes');
  eq([...seen.values()].map(e=>[e.damage,e.health,e.maxHealth,e.weapon]),[[1,2,3,weapon]],weapon+' whole clip takes exactly one heart once');
  eq(kart(w).hits,0,weapon+' one clip cannot score from full hearts');eq(kart(w,'b').deaths,0,weapon+' rival survives one clip');
  measurements[weapon+'Clip']={initialAmmo,hits:seen.size,health:kart(w,'b').health};
 }finally{w.dispose();}
}
eq(SHARED.config.maxHealth,3,'shared capacity is three hearts');
eq(['machinegun','trishot','mine','missile','missile','proximity','shield','nuke'].map(id=>SHARED.damageAt(id)),[1,1,1,2,2,1,2,3],'approved whole-heart damage table');
eq(['rail','grenade','emp','bomb','sentry','spikes'].map(id=>SHARED.damageAt(id)),[0,0,0,0,0,0],'retired weapons deal no damage');
eq([0,7,14].map(d=>SHARED.damageAt('nuke',d)),[3,3,3],'Nuke takes every heart with no distance falloff');
eq(Object.values(SHARED.config.weapons).filter(w=>'directDamage' in w||'edgeDamage' in w).length,0,'no direct or edge damage tiers remain');
ok(Object.isFrozen(SHARED.config)&&Object.isFrozen(SHARED.config.weapons.missile),'shared authority description cannot drift through mutation');

for(const weapon of ['machinegun','missile','cannon','trishot']) {
 const w=armed(weapon,weapon==='trishot'?map([point('a',0,0),point('b',0,5.2)]):map());try {
  eq(w.snapshot().karts.map(k=>[k.health,k.maxHealth]),[[3,3],[3,3]],weapon+' fresh default hearts');
  if(weapon==='missile')eq(kart(w).ammo,1,'missile crate supplies one missile');
  fire(w);const seen=new Map();step(w,60,()=>{for(const e of w.snapshot().events)if(e.type==='hit'&&e.other==='b')seen.set(e.id,e);});
  const hits=[...seen.values()],damage=hits.reduce((sum,e)=>sum+e.damage,0);
  eq(damage,SHARED.damageAt(weapon),weapon+' accepted pickup deals its whole-heart damage once');eq(hits.length,1,weapon+' one hit event per pickup');
  eq(kart(w,'b').health,3-damage,weapon+' hit updates authoritative hearts');
  ok(kart(w,'b').alive&&kart(w).hits===0&&kart(w,'b').deaths===0,weapon+' one pickup wounds a full rival without a score');
  ok(hits.every(e=>e.health>=0&&e.maxHealth===3&&Object.values(e.position).every(Number.isFinite)),weapon+' bounded semantic hit data');
 }finally{w.dispose();}
}
{
 // Two-heart diagnostic start: the Rocket clip's two hearts are lethal.
 const awards=[],w=armed('missile',map(),{initialHealth:2,onAward:(...v)=>awards.push(v)});try {
  const old=w.snapshot('b').you;
  fire(w);step(w,26);eq(kart(w,'b').health,0,'one actual direct Rocket takes two hearts without splash double-count');eq(kart(w).hits,1,'direct Rocket scores at zero hearts');
  fire(w);step(w,26);eq(kart(w,'b').deaths,1,'remaining Rockets cannot duplicate damage/KO for the dead life');
  const hits=w.snapshot().events.filter(e=>e.type==='hit'&&e.other==='b');eq(hits.map(e=>e.damage),[2],'direct lethal damage is applied exactly once');
  eq(w.snapshot().events.filter(e=>e.type==='ko').length,1,'one KO event');eq(awards.filter(v=>v[1]===10).length,1,'one KO coin award');
  ok(!send(w,'b').ok&&!kart(w,'b').alive,'dead kart cannot drive');
  step(w,130);eq(kart(w,'b').health,3,'safe respawn restores all three hearts');ok(kart(w,'b').alive&&kart(w,'b').shield>0&&kart(w,'b').spawnSeq===old.life+1,'respawn has fresh protected life');
  ok(!w.input('b',{instance:w.snapshot().instance,life:old.life,controlEpoch:old.controlEpoch,seq:1,steer:0,throttle:1,brake:0,nitro:false,use:false},w.snapshot().serverAt).ok,'old-life input cannot control healthy respawn');
  const before=JSON.stringify(w.snapshot().karts.map(k=>[k.health,k.hits]));w.advance(w.snapshot().deadline);const done=JSON.stringify(w.snapshot().karts.map(k=>[k.health,k.hits]));w.advance(w.snapshot().deadline+10000);eq(JSON.stringify(w.snapshot().karts.map(k=>[k.health,k.hits])),done,'late pumps cannot damage or rescore finished round');ok(before===done,'deadline clean-up does not fabricate healing or damage');
 }finally{w.dispose();}
}
for(const gate of ['cover','offline']) {
 const cover={id:'cover',shape:'box',position:{x:0,y:2,z:5},half:{x:8,y:2,z:.02}};
 const w=armed('missile',map(undefined,gate==='cover'?[cover]:[]));
 try {
  if(gate==='offline')w.setConnected('b',false);
  fire(w);step(w,35);eq(kart(w,'b').health,3,gate+' blocks physical rocket damage');eq(kart(w).hits,0,gate+' blocks scoring');eq(kart(w).health,3,'owner immune to its blast');
 }finally{w.dispose();}
}
{
 let w;for(let seed=0;seed<512;seed++){const m=map(),v=AUTHORITY.createElevatedCombat(RAPIER,CONFIG,m,m.spawns.map(p=>({id:p.id})),{instance:'protected-'+(++serial),seed,countdownMs:0,roundMs:10000,crates:1});step(v);if(kart(v).weapon==='missile'){w=v;break;}v.dispose();}
 try{fire(w);step(w,20);eq(kart(w,'b').health,3,'real spawn shield absorbs rocket');ok(w.snapshot().events.some(e=>e.type==='impact'&&e.other==='b')&&!w.snapshot().events.some(e=>e.type==='hit'||e.type==='block'),'protected physical impact stays distinct from a heart hit or Shield block');}finally{w.dispose();}
}
{
 const w=armed('nuke',map([point('a',0,0),point('b',-3,16),point('c',10,16)]));try {
  fire(w);step(w,215);const blast=w.snapshot().events.find(e=>e.type==='blast'),hits=w.snapshot().events.filter(e=>e.type==='hit');
  ok(blast&&hits.length===2,'actual delayed Nuke reaches multiple physical rivals');
  eq(hits.map(h=>[h.damage,h.health]),[[3,0],[3,0]],'Nuke takes every heart at any distance inside its radius');
  ok(!kart(w,'b').alive&&!kart(w,'c').alive&&kart(w).hits===2,'Nuke knocks out every rival in range');
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
  eq(kart(w,'b').health,0,'one acquired Nuke direct hit empties a physically moving full-heart hull');
  eq([...seen.values()].filter(e=>e.type==='hit'&&e.other==='b').map(e=>e.damage),[3],'direct Nuke target is excluded from duplicate splash');eq([...seen.values()].filter(e=>e.type==='blast'&&e.weapon==='nuke').length,1,'direct Nuke detonates exactly once before its fuse');eq(w.snapshot().grenades.length,0,'direct Nuke canister is consumed');
  ok(sweep&&sweep.fraction>=0&&sweep.fraction<=1&&sweep.targetMovement>.05&&Math.abs(sweep.radius-1.7)<1e-6,'direct Nuke contact interpolates moving hull at unchanged swept radius');
  eq([...seen.values()].filter(e=>e.type==='hit'&&e.other==='c').map(e=>e.damage),[3],'nearby indirect Nuke victim also loses every heart once');
  eq(kart(w).hits,2,'direct Nuke awards exactly one KO per victim');eq(kart(w).health,3,'direct Nuke owner remains immune');measurements.nukeDirect=sweep;
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
  eq(kart(w,'b').health,3,gate+' prevents Nuke heart damage');eq(kart(w).hits,0,gate+' prevents Nuke score');eq(kart(w).health,3,gate+' preserves Nuke self immunity');
  if(gate==='shield')ok([...seen.values()].some(e=>e.type==='impact'&&e.weapon==='nuke'&&e.other==='b'),'protected Nuke hull contact remains a real impact without a heart hit');
  if(gate==='cover')ok([...seen.values()].some(e=>e.type==='blast'&&e.weapon==='nuke'&&e.position.z<5),'solid cover blocks direct Nuke travel before its fuse blast');
 }finally{w.dispose();}
}
{
 const w=armed('machinegun'),seen=new Map();try {
  for(let i=0;i<240;i++){if(i%6===0)send(w,'a',{use:true});step(w);for(const e of w.snapshot().events)seen.set(e.id,e);}
  eq([...seen.values()].filter(e=>e.type==='fire'&&e.weapon==='machinegun').length,24,'held Pulse consumes one finite twelve-round clip');eq([...seen.values()].filter(e=>e.type==='hit').length,1,'held Pulse clip lands exactly one heart');eq(kart(w).hits,0,'held Pulse clip cannot score from full hearts');ok(kart(w,'b').alive&&kart(w,'b').health===2,'long Pulse burst leaves the rival on two hearts');
 }finally{w.dispose();}
}
{
 const w=armed('mine',map([point('a',0,0),point('b',0,-10)]));try {
  fire(w);step(w,45);
  for(let i=0;i<140&&kart(w,'b').health===3;i++){if(i%8===0)send(w,'b',{throttle:.45});step(w);}
  const hit=w.snapshot().events.find(e=>e.type==='hit'&&e.weapon==='mine');
  ok(hit&&kart(w,'b').alive,'actual physical crossing reaches an armed trap and remains alive');
  eq(kart(w,'b').health,2,'one armed Mine takes one heart');
  eq(w.snapshot().mines.length,2,'only the triggered trap is consumed');eq(kart(w).hits,0,'one Mine wound awards no KO');
  measurements.mine={hit,position:kart(w,'b').pose.position};
 }finally{w.dispose();}
}

function legacy(n=2){let now=1000000,volleys=0;const players=Array.from({length:n},(_,i)=>({id:'p'+i,name:'P'+i})),ctx={now:()=>now,settings:()=>({mode:'Zap Battle',map:'Rookie Ring',winRule:'Time limit'}),players:()=>players.filter(p=>!ctx.offline?.has(p.id)),allPlayers:()=>players,broadcast(){},award(){},later:()=>()=>{}};const history=new Map();const s=GAME.create(ctx);now+=3000;GAME.onTick(s,ctx);s.blocks=[];s.crates=[];s.karts.forEach((k,i)=>{k.x=0;k.z=i*10;k.angle=0;k.shield=0;k.speed=0;});return {s,ctx,history,step(ms=100){now+=ms;GAME.onTick(s,ctx);for(const e of s.events)history.set(e.id,e)},fire(weapon,ammo=1){const a=s.karts[0];a.weapon=weapon;a.ammo=ammo;a.fireCd=0;a.prevAction=false;a.volley='t'+(++volleys);GAME.onAction(s,ctx,a.pid,{input:{steer:0,throttle:0,boost:true}});GAME.onAction(s,ctx,a.pid,{input:{steer:0,throttle:0,boost:false}});}};}
// Controlled classic placement isolates actual crate acquisition and planar
// authority; never a shipping Room actor or hidden-state acceptance claim.
for(const [weapon,ammo] of [['machinegun',24],['trishot',3]]) {
 let r;
 for(let seed=0;seed<512;seed++) {const v=legacy();v.s.rngState=seed;v.s.crates=[{id:'pickup',x:0,z:0}];v.step(100);if(v.s.karts[0].weapon===weapon){r=v;break;}}
 ok(r,weapon+' bounded classic pickup fixture reaches weapon');const [a,b]=r.s.karts;if(weapon==='trishot')b.z=5.2;
 const initialAmmo=a.ammo;r.s.crates=[];
 for(let i=0;i<ammo&&a.weapon;i++) {a.fireCd=0;a.prevAction=false;GAME.onAction(r.s,r.ctx,'p0',{input:{steer:0,throttle:0,boost:true}});r.step(100);GAME.onAction(r.s,r.ctx,'p0',{input:{steer:0,throttle:0,boost:false}});for(let t=0;t<4;t++)r.step(100);eq(b.health,2,'classic '+weapon+' acquired clip connection '+(i+1)+' stays at one heart');eq(a.hits,0,'classic '+weapon+' one clip cannot score from full hearts');}
 eq(initialAmmo,ammo,'classic '+weapon+' actual pickup supplies same clip as elevated');eq([...r.history.values()].filter(e=>e.type==='hit').map(e=>e.damage),[1],'classic '+weapon+' whole clip lands one heart once');measurements['classic'+weapon+'Clip']={initialAmmo,remainingAmmo:a.ammo,hits:a.hits};
}
{
 const r=legacy(),[a,b]=r.s.karts;eq([a.health,b.health],[3,3],'legacy engine starts with three hearts');eq(GAME.view(r.s,r.ctx,'p0').combat,SHARED.config,'legacy projects shared damage/range description');
 r.fire('missile');r.step(150);eq(b.health,1,'legacy direct Rocket takes two hearts');eq(a.hits,0,'legacy wounding Rocket awards no KO');
 r.fire('missile');r.step(150);eq(b.health,0,'a second Rocket pickup takes the last heart');eq(a.hits,1,'legacy lethal Rocket awards one KO');r.fire('missile');r.step(150);eq(b.deaths,1,'legacy dead life cannot be hit twice');
 eq(r.s.events.filter(e=>e.type==='hit').map(e=>e.damage),[2,1],'legacy direct rockets never count splash twice and clip to the hearts left');for(let i=0;i<21;i++)r.step(100);eq(b.health,3,'legacy respawn restores three hearts');ok(b.shield>0,'legacy respawn protected');
}
for(const weapon of ['machinegun','trishot','nuke','mine']){
 const r=legacy(),b=r.s.karts[1];
 if(weapon==='trishot')b.z=5.2;
 if(weapon==='nuke')r.s.grenades=[{id:'g',owner:'p0',kind:'nuke',x:0,z:10,y:0,vx:0,vz:0,vy:0,angle:0,fuse:.01,bounces:2}];
 else if(weapon==='mine'||weapon==='proximity')r.s.mines=[{id:'m',owner:'p0',x:0,z:10,armed:true,armT:0,ttl:5,...(weapon==='proximity'?{kind:'proximity'}:{})}];
 else r.fire(weapon);
 r.step(100);const damage=r.s.events.filter(e=>e.type==='hit').reduce((sum,e)=>sum+e.damage,0);eq(damage,SHARED.damageAt(weapon),'legacy '+weapon+' full-heart damage');eq(b.health,3-damage,'legacy '+weapon+' updates hearts');eq(r.s.karts[0].hits,weapon==='nuke'?1:0,'legacy '+weapon+' scores only when it empties the hearts');
}

{
 const r=legacy(3),[a,b,c]=r.s.karts;c.x=-2.2;c.z=6.4; // Generic central muzzle: separate hulls, nearby splash, no direct corridor hit
 const sweepRadius=Math.sqrt(CLASSIC.RULES.battle.constants.ZAP_HIT_R2),splashRadius=SHARED.config.weapons.missile.splashRadius,expectedImpactZ=b.z-sweepRadius;
 ok(Math.abs(c.x)>sweepRadius,'generic splash rival stays outside the actual central projectile hull corridor');
 ok(Math.hypot(c.x-b.x,c.z-expectedImpactZ)<splashRadius,'generic splash rival is inside actual central-impact splash radius');
 ok(Math.hypot(b.x-c.x,b.z-c.z)>CLASSIC.constants.KART_R*2,'legacy multi-victim Rocket starts with two physically separated hulls');
 r.fire('missile');r.step(150);
 const blast=r.s.events.find(e=>e.type==='blast');ok(blast&&Math.abs(blast.x)<1e-9&&Math.abs(blast.z-expectedImpactZ)<1e-9,'actual generic rocket blast occurs at the earliest central hull sweep contact');
 ok(Math.hypot(c.x-blast.x,c.z-blast.z)<splashRadius,'actual accepted generic blast contains the splash rival');
 eq([a.health,b.health,c.health],[3,1,1],'legacy Rocket takes two hearts from the direct and the nearby splash victim once each');
 eq(r.s.events.filter(e=>e.type==='hit').map(e=>[e.other,e.damage]).sort(),[['p1',2],['p2',2]],'legacy Rocket reports both visible victims without direct double-count');eq(a.hits,0,'legacy two-heart Rocket wounds without a KO');
}
for(const gate of ['shield','offline','cover','dead']){
 const r=legacy(),b=r.s.karts[1];if(gate==='shield')b.shield=2;if(gate==='offline')r.ctx.offline=new Set(['p1']);if(gate==='cover')r.s.blocks=[{x:0,z:5,hw:8,hd:.02}];if(gate==='dead'){b.health=0;b.respawn=1;}
 const before=b.health;r.fire('missile');r.step(150);eq(b.health,before,'legacy '+gate+' immune to rocket damage');eq(r.s.karts[0].hits,0,'legacy '+gate+' cannot score');
}
// Physical classic pickups: declared authority poses and seeded actual crate
// rolls. Separate from Room acceptance.
{
 const battle=CLASSIC.RULES.battle;
 function fixture(distance=3,height=.75){
  const make=(pid,x,y)=>({pid,x,z:0,angle:0,speed:0,input:{boost:false},...battle.blankKart(),shield:0,physicalPose:{position:{x,y,z:0},rotation:{x:0,y:0,z:0,w:1},epoch:0}}),a=make('ka',0,.75),b=make('kb',distance,height);
  const s={karts:[a,b],bound:30,blocks:[],spots:[[20,20],[-20,-20]],rngState:1,scores:{ka:0,kb:0},lastTick:1000000};battle.createExtra(s);s.crates=[];
  const physics=PHYSICS.createKartPhysics(RAPIER,CONFIG),geometry={sweepStatic:(from,to)=>physics.sweepStatic(from,to)},connected=new Set(['ka','kb']);
  physics.addStatic({id:'floor',shape:'box',position:{x:0,y:-1,z:0},half:{x:40,y:1,z:40}});
  return {s,a,b,physics,geometry,connected,tick(ms=50,old){const before=old||new Map(s.karts.map(k=>[k.pid,structuredClone(k)]));s.lastTick+=ms;battle.tick(s,connected,ms/1000,before,null,new Map(),geometry);}};
 }
 // Bounded seeds prove actual pickup availability of the rare Nuke.
 let nukeSeed;
 for(let seed=0;seed<512;seed++) {
  const f=fixture(10);try {f.s.rngState=seed;f.s.crates=[{id:'seed-crate',x:0,z:0}];f.tick(0);if(f.a.weapon==='nuke'){nukeSeed=seed;eq(f.a.ammo,1,'physical Nuke pickup has one finite activation');eq(f.s.events.filter(e=>e.type==='pickup').length,1,'physical seed rolls through actual pickup authority');break;}}finally{f.physics.dispose();}
 }
 ok(Number.isInteger(nukeSeed),'Nuke available through bounded seeded actual physical pickup');
 const generic=new Set();for(let seed=0;seed<512;seed++) {const f=fixture(10);try {f.s.rngState=seed;f.s.crates=[{id:'generic-crate',x:0,z:0}];battle.tick(f.s,f.connected,0,new Map(f.s.karts.map(k=>[k.pid,structuredClone(k)])),null,new Map());generic.add(f.a.weapon);}finally{f.physics.dispose();}}
 eq([...generic].sort(),battle.constants.WEAPON_ORDER.slice().sort(),'classic pickups roll exactly the eight kept weapons');
}
console.log('KART_HEALTH_PASS: '+checks+' default-hearts authority assertions; '+JSON.stringify(measurements));
