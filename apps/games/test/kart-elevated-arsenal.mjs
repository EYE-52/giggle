// Elevated-only item proof using actual crate acquisition, Rapier poses and
// legal receipt/sequence/life inputs. No grant, teleport or injected hit hooks.
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import COMBAT from '../games/engines/kart-elevated-combat.js';
import LEGACY from '../games/engines/kart-rules-battle.js';
await RAPIER.init();
const results=[],measurements={},seeds=new Map();let instances=0;
const check=(label,value)=>{assert.ok(value,label);results.push(label);};
const point=(id,x,z,angle=0,y=0,surface='floor')=>({id,x,y,z,angle,surface});
const fixture=(colliders=[],spawns=[point('a',0,0),point('b',0,30)],sockets=[point('s0',-.7,0),point('s1',.7,0)])=>({id:'arsenal-test',revision:'test-1',half:180,colliders:[{id:'floor',shape:'box',position:{x:0,y:-1,z:0},half:{x:180,y:1,z:180}},...colliders],spawns,sockets});
const create=(map=fixture(),options={})=>COMBAT.createElevatedCombat(RAPIER,CONFIG,map,map.spawns.map(s=>({id:s.id})),{instance:'arsenal-'+(++instances),seed:0,startAt:0,countdownMs:0,roundMs:15000,crates:1,...options});
const step=(w,n=1,each)=>{for(let i=0;i<n;i++){each?.(i);w.advance(w.snapshot().serverAt+CONFIG.fixedDt*1000);}};
const kart=(w,id='a')=>w.snapshot(id).karts.find(k=>k.id===id);
function send(w,id='a',intent={}){const v=w.snapshot(id),p=v.you;return w.input(id,{instance:v.instance,life:p.life,controlEpoch:p.controlEpoch,seq:p.receivedSeq+1,steer:0,throttle:0,brake:0,nitro:false,use:false,...intent},v.serverAt);}
function fire(w,id='a',intent={}){assert.ok(send(w,id,{...intent,use:true}).ok);assert.ok(send(w,id,{...intent,use:false}).ok);step(w);}
function armed(weapon,map=fixture(),options={},wait=160){
  const key=weapon+JSON.stringify(map)+JSON.stringify(options),saved=seeds.get(key);
  for(const seed of saved===undefined?Array.from({length:512},(_,i)=>i):[saved]){
    const w=create(map,{...options,seed});step(w);
    if(kart(w).weapon===weapon){seeds.set(key,seed);step(w,wait);return w;}w.dispose();
  }
  throw new Error('bounded real pickup search failed for '+weapon);
}
const finite=v=>typeof v==='number'?Number.isFinite(v):v&&typeof v==='object'?Object.values(v).every(finite):true;
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const length=v=>Math.hypot(v.x,v.y,v.z);
const angle=(a,b)=>Math.acos(Math.max(-1,Math.min(1,dot(a,b)/(length(a)*length(b)))));
check('elevated pool has fourteen explicit balanced weapons',Object.keys(COMBAT.arsenal.weights).length===14&&Object.values(COMBAT.arsenal.weights).reduce((a,b)=>a+b,0)===100);
check('legacy flat arsenal remains its original eight items',LEGACY.constants.WEAPON_ORDER.length===8&&!LEGACY.constants.WEAPON_ORDER.includes('seeker')&&!LEGACY.constants.WEAPON_ORDER.includes('bomb'));

// Authored apertures are measured in chassis-local space. Rotation must apply
// to the lateral mount as well as forward distance on both equipment pods.
for(const weapon of ['pulse','scatter','rail','grenade','emp','rocket','seeker'])for(const heading of [0,Math.PI/2,Math.PI,-Math.PI/2]){
  const w=armed(weapon,fixture([],[point('a',0,0,heading),point('b',25,-25)]));
  try{
    const p=kart(w).pose,q=p.rotation,v=CONFIG.combat[weapon+'Muzzle'];
    const t={x:2*(q.y*v.z-q.z*v.y),y:2*(q.z*v.x-q.x*v.z),z:2*(q.x*v.y-q.y*v.x)};
    const expected={x:p.position.x+v.x+q.w*t.x+q.y*t.z-q.z*t.y,y:p.position.y+v.y+q.w*t.y+q.z*t.x-q.x*t.z,z:p.position.z+v.z+q.w*t.z+q.x*t.y-q.y*t.x};
    fire(w);const event=w.snapshot().events.find(e=>e.type==='fire'&&e.weapon===weapon);
    check(weapon+' launches from its actual mounted bore at heading '+heading,event&&Math.hypot(event.position.x-expected.x,event.position.y-expected.y,event.position.z-expected.z)<.002);
  }finally{w.dispose();}
}
for(const weapon of ['rocket','seeker']){
  const wall={id:'left-barrel-cover',shape:'box',position:{x:-.95,y:1.14,z:1.83},half:{x:.3,y:.35,z:.08}};
  const w=armed(weapon,fixture([wall]));try{fire(w);check(weapon+': left bore corridor blocks launch even when kart centre is clear',w.snapshot().projectiles.length===0&&w.snapshot().events.some(e=>e.type==='impact'&&e.surfaceId==='left-barrel-cover'));}finally{w.dispose();}
}
for(const weapon of ['pulse','scatter','rail','grenade']){
  const wall={id:'right-barrel-cover',shape:'box',position:{x:.95,y:1.14,z:1.83},half:{x:.3,y:.35,z:.08}};
  const w=armed(weapon,fixture([wall]));try{
    fire(w);const s=w.snapshot();
    check(weapon+': right bore corridor stops the shot when the kart centre is clear',weapon==='grenade'?s.grenades.length===1&&s.grenades[0].position.z<1.75:s.projectiles.length===0&&s.events.some(e=>e.type==='impact'&&e.surfaceId==='right-barrel-cover'));
  }finally{w.dispose();}
}

{
  const map=fixture([],[point('a',0,0),point('b',6,32,Math.PI/2),point('c',-5,40)]),w=armed('seeker',map);
  try{
    step(w,24,i=>{if(i%6===0)send(w,'b',{throttle:1});});fire(w);
    const launch=w.snapshot().projectiles[0];check('Seeker acquires the nearest vulnerable target in its launch cone',launch?.targetId==='b'&&launch.targetLife===0&&launch.weapon==='seeker');
    check('Seeker uses its physical speed TTL and measured static sweep radius',Math.abs(length(launch.velocity)-60)<1e-8&&launch.ttl<2.4&&launch.ttl>2.38&&launch.radius===COMBAT.staticSweepRadii.seeker);
    let previous=launch.velocity,maxTurn=0,maxX=launch.position.x,curved=false;
    for(let i=0;i<90&&w.snapshot().projectiles.length;i++){
      if(i%6===0)send(w,'b',{throttle:1});step(w);const s=w.snapshot().projectiles[0];if(!s)break;
      maxTurn=Math.max(maxTurn,angle(previous,s.velocity));maxX=Math.max(maxX,s.position.x);curved ||= Math.abs(s.velocity.x-launch.velocity.x)>2;previous=s.velocity;assert.ok(finite(s));
    }
    check('guidance visibly curves toward a physically moving rival',curved&&maxX>2&&kart(w,'b').pose.position.x>8);
    check('guidance turn rate never exceeds 2.6 radians per second',maxTurn<=2.6*CONFIG.fixedDt+1e-7);
    check('guided direct impact confirms one100-health KO and one splash event',kart(w).hits===1&&!kart(w,'b').alive&&kart(w,'b').health===0&&w.snapshot().events.filter(e=>e.type==='hit'&&e.other==='b').length===1&&w.snapshot().events.filter(e=>e.type==='blast'&&e.weapon==='seeker').length===1);
    measurements.guidance={maxTurnPerStep:maxTurn,maxX,targetX:kart(w,'b').pose.position.x};
  }finally{w.dispose();}
}
{
  const wall={id:'hidden-target-cover',shape:'box',position:{x:3,y:3,z:14},half:{x:1,y:3,z:1}};
  const w=armed('seeker',fixture([wall],[point('a',0,0),point('b',4,20),point('c',0,30),point('d',0,-10)]));
  try{fire(w);check('Seeker rejects nearer targets without actual line of sight',w.snapshot().projectiles[0]?.targetId==='c');}finally{w.dispose();}
  const distant=armed('seeker',fixture([],[point('a',0,0),point('b',25,-25)]));
  try{fire(distant);check('no in-cone target launches a straight missile without a forced lock',distant.snapshot().projectiles[0]?.targetId===null&&Math.abs(distant.snapshot().projectiles[0].velocity.x)<.001);step(distant,150);check('unimpacted Seeker expires without an invented blast',distant.snapshot().projectiles.length===0&&!distant.snapshot().events.some(e=>e.type==='blast'));}finally{distant.dispose();}
  const outOfRange=armed('seeker',fixture([],[point('a',0,0),point('b',0,60)]));
  try{fire(outOfRange);check('Seeker does not lock a target beyond 45 metres',outOfRange.snapshot().projectiles[0]?.targetId===null);}finally{outOfRange.dispose();}
}
{
  const wall={id:'missile-cover',shape:'box',position:{x:0,y:3,z:12},half:{x:6,y:3,z:1}};
  const w=armed('seeker',fixture([wall],[point('a',0,0),point('b',0,20)]));
  try{fire(w);step(w,40);check('finite solid cover stops Seeker sweep and shields the rival',kart(w,'b').alive&&kart(w).hits===0&&w.snapshot().projectiles.length===0&&w.snapshot().events.some(e=>e.type==='impact'&&e.weapon==='seeker'&&e.surfaceId==='missile-cover'));step(w,130);check('covered Seeker impact cannot replay a late expiry blast',w.snapshot().events.filter(e=>e.type==='blast'&&e.weapon==='seeker').length===1);}finally{w.dispose();}
  const crowded=armed('seeker',fixture([],[point('a',0,0),point('b',0,18),point('c',2.6,17.6)]));
  try{fire(crowded);step(crowded,35);const direct=crowded.snapshot().events.find(e=>e.type==='impact'&&e.weapon==='seeker')?.other;check('Seeker first swept target takes100 once and indirect rival40 once',['b','c'].includes(direct)&&kart(crowded).hits===1&&kart(crowded,direct).health===0&&kart(crowded,direct==='b'?'c':'b').health===60&&crowded.snapshot().events.filter(e=>e.type==='hit').length===2);}finally{crowded.dispose();}
  const shield=armed('seeker',fixture([],[point('a',0,0),point('b',0,12)]),{},0);
  try{fire(shield);check('protected target is not acquired at launch',shield.snapshot().projectiles[0]?.targetId===null);step(shield,25);check('existing spawn shield absorbs the real Seeker collision',kart(shield,'b').alive&&kart(shield).hits===0&&shield.snapshot().events.some(e=>e.type==='impact'&&e.other==='b'));}finally{shield.dispose();}
}
{
  const w=armed('seeker',fixture([],[point('a',0,0),point('b',10,40)]));
  try{
    fire(w);const velocity=w.snapshot().projectiles[0].velocity;w.setConnected('b',false);step(w);
    const shot=w.snapshot().projectiles[0];check('disconnected target permanently loses guidance without a snap or reacquisition',shot.targetId===null&&shot.targetLife===null&&JSON.stringify(shot.velocity)===JSON.stringify(velocity));
    w.setConnected('b',true);step(w,8);check('reconnected target cannot resurrect a retired guidance lock',w.snapshot().projectiles.every(s=>s.targetId===null));
  }finally{w.dispose();}
}
{
  // Two real pickups arm A and C. C fires from behind B while A's slower
  // Seeker is still travelling; the target dies through ordinary combat.
  const map=fixture([],[point('a',0,0),point('b',0,30),point('c',0,42,Math.PI)],[point('s0',-.7,0),point('s1',.7,0),point('s2',-.7,42),point('s3',.7,42)]);
  let w;
  // Wounded constructor isolates target-death guidance retirement, without
  // post-start damage hooks. Full-health Seeker wounds are checked above.
  for(let seed=0;seed<1024;seed++){const candidate=create(map,{seed,crates:2,initialHealth:1});step(candidate);if(kart(candidate).weapon==='seeker'&&['pulse','scatter','rocket','rail','seeker'].includes(kart(candidate,'c').weapon)){w=candidate;measurements.targetDeathSeed=seed;break;}candidate.dispose();}
  check('target-death scenario uses two actual acquired offensive items',!!w);
  try{step(w,160);fire(w);fire(w,'c');let retired=false;for(let i=0;i<25;i++){step(w);retired ||= !kart(w,'b').alive&&w.snapshot().projectiles.some(s=>s.owner==='a'&&s.targetId===null);}check('ordinary target KO retires guidance before its next life',retired&&kart(w,'b').deaths===1);}finally{w.dispose();}
}

{
  const awards=[],w=armed('bomb',fixture([],[point('a',0,0),point('b',-2,10),point('c',2,10)]),{initialHealth:1,onAward:(...v)=>awards.push(v)});
  try{
    fire(w,'a',{throttle:1});const initial=w.snapshot().grenades[0];check('Bomb has a swept dynamite body, bounded lifetime and real lob velocity',initial?.weapon==='bomb'&&initial.radius===.6&&initial.ttl>11.98&&initial.ttl<12&&Math.abs(initial.velocity.z-12)<.02&&initial.velocity.y>5&&!initial.landed&&!initial.armed);
    let peak=initial.position.y,rolling=false,warn=false,earlyWarning=false,rollSpeed=null,slowed=false,ownerAtBlast=null;
    for(let i=0;i<145;i++){
      if(i%6===0&&kart(w).alive){const follow=kart(w).pose.position.z<8;send(w,'a',{throttle:follow?1:0,brake:follow?0:1});}step(w);if(!ownerAtBlast&&w.snapshot().events.some(e=>e.type==='blast'&&e.weapon==='bomb'))ownerAtBlast=kart(w).pose.position;const g=w.snapshot().grenades[0];if(!g)continue;
      peak=Math.max(peak,g.position.y);assert.ok(finite(g)&&g.bounces===0);earlyWarning ||= g.warning&&(!g.landed||!g.armed);warn ||= g.warning&&g.armed;
      if(g.landed&&g.position.y<.65&&Math.abs(g.velocity.y)<1e-6){rolling=true;const planar=Math.hypot(g.velocity.x,g.velocity.z);if(rollSpeed!==null&&planar<rollSpeed-.02)slowed=true;rollSpeed=planar;}
    }
    const blast=w.snapshot().events.find(e=>e.type==='blast'&&e.weapon==='bomb');
    check('Bomb lob settles on real ground with friction and zero bounce spring',rolling&&slowed&&peak>1.5&&peak<2&&blast.position.z>7);
    check('Bomb never warns before landed arming',!earlyWarning);
    check('Bomb enemy proximity produces one LOS multi-victim blast',kart(w).hits===2&&!kart(w,'b').alive&&!kart(w,'c').alive&&w.snapshot().events.filter(e=>e.type==='blast'&&e.weapon==='bomb').length===1);
    check('Bomb owner physically inside the blast stays immune',Math.hypot(ownerAtBlast.x-blast.position.x,ownerAtBlast.z-blast.position.z)<5.5&&kart(w).alive&&kart(w).deaths===0);
    check('each Bomb KO awards exactly once',awards.filter(v=>v[1]===10).length===2);
    step(w,150,i=>{if(i%6===0)send(w,'a',{throttle:-1});});check('spent Bomb cannot rehit protected respawns or re-award after the owner clears their spawn footprints',kart(w,'b').alive&&kart(w,'c').alive&&kart(w,'b').deaths===1&&kart(w,'c').deaths===1&&kart(w).hits===2&&awards.filter(v=>v[1]===10).length===2);
    measurements.bomb={peakY:peak,blast:blast.position,rolling:true};
  }finally{w.dispose();}
}
{
  const wall={id:'bomb-cover',shape:'box',position:{x:0,y:2,z:11},half:{x:6,y:2,z:.25}};
  const w=armed('bomb',fixture([wall],[point('a',0,0),point('b',0,13.5),point('c',1,8)]));
  try{fire(w);step(w,140);check('Bomb stops at finite wall and80-damage splash cannot cross it',kart(w,'b').health===100&&kart(w,'c').health===20&&kart(w).hits===0&&w.snapshot().events.find(e=>e.type==='blast'&&e.weapon==='bomb')?.position.z<10.5);}finally{w.dispose();}
  const slideWall={id:'slide-wall',shape:'box',position:{x:5,y:2,z:10},half:{x:.1,y:2,z:20}};
  const slide=armed('bomb',fixture([slideWall],[point('a',0,0,Math.PI/4),point('b',-30,30)]));
  try{fire(slide);let slideAt=null,furthestZ=0;for(let i=0;i<130;i++){step(slide);const g=slide.snapshot().grenades[0];if(!g)continue;assert.ok(g.position.x<4.31&&g.bounces===0);if(g.position.x>4.25&&Math.abs(g.velocity.x)<.001){slideAt??=g.position.z;furthestZ=Math.max(furthestZ,g.position.z);}}check('Bomb wall contact removes inward velocity while preserving a real slide',slideAt!==null&&furthestZ>slideAt+.5);measurements.wallSlide={firstZ:slideAt,finalZ:furthestZ};}finally{slide.dispose();}
  const offline=armed('bomb',fixture([],[point('a',0,0),point('b',0,12),point('c',2.5,10)]));
  try{fire(offline);offline.setConnected('b',false);step(offline,140);check('offline Bomb victim remains immune while exposed live rival loses80 health',kart(offline,'b').health===100&&kart(offline,'c').health===20&&kart(offline).hits===0);}finally{offline.dispose();}
}
{
  const map=fixture([],[point('a',0,0),point('b',0,12),point('c',2.6,10)],[point('s0',-.7,0),point('s1',.7,0),point('s2',-.7,12),point('s3',.7,12)]);let w;
  for(let seed=0;seed<2048;seed++){const candidate=create(map,{seed,crates:2});step(candidate);if(kart(candidate).weapon==='bomb'&&kart(candidate,'b').weapon==='shield'){w=candidate;measurements.bombShieldSeed=seed;break;}candidate.dispose();}
  check('Bomb shield scenario acquires both items through real crates',!!w);
  try{step(w,160);fire(w,'b');fire(w);step(w,140);check('live Shield absorbs Bomb splash without a KO or award',kart(w,'b').alive&&kart(w,'b').health===100&&kart(w,'b').shield>1&&kart(w,'c').health===20&&kart(w).hits===0&&w.snapshot().events.some(e=>e.type==='blast'&&e.weapon==='bomb'));}finally{w.dispose();}
}

for(const weapon of ['seeker','bomb'])for(const upper of [false,true]){
  const roof={id:'layer-deck',shape:'deck',position:{x:0,y:3.2,z:8},half:{x:6,y:.3,z:16}};
  const ay=upper?3.5:0,by=upper?0:3.5,as=upper?'layer-deck':'floor',bs=upper?'floor':'layer-deck';
  const map=fixture([roof],[point('a',0,0,0,ay,as),point('b',0,12,0,by,bs)],[point('s0',-.7,0,0,ay,as),point('s1',.7,0,0,ay,as)]),w=armed(weapon,map);
  try{
    fire(w);
    if(weapon==='seeker')check('Seeker '+(upper?'above':'below')+': solid deck denies an otherwise in-cone guidance lock',w.snapshot().projectiles[0]?.targetId===null);
    step(w,150);
    check(weapon+' '+(upper?'above':'below')+': finite solid deck protects the other physical layer',kart(w,'b').alive&&kart(w).hits===0);
    if(weapon==='bomb'){
      const charge=w.snapshot().grenades[0];
      check('Bomb '+(upper?'above':'below')+': landed charge arms on its own real layer without a timed blast',charge?.armed&&(upper?charge.position.y>4:charge.position.y<1)&&!w.snapshot().events.some(e=>e.type==='blast'&&e.weapon==='bomb'));
    }
  }finally{w.dispose();}
}

for(const weapon of ['seeker','bomb']){
  const w=armed(weapon,fixture([],[point('a',0,0),point('b',-30,-30)]));
  try{
    const v=w.snapshot('a'),base={instance:v.instance,life:v.you.life,controlEpoch:v.you.controlEpoch,seq:v.you.receivedSeq+1,steer:0,throttle:0,brake:0,nitro:false,use:true};
    check(weapon+': stale instance life and control epoch cannot spend item',!w.input('a',{...base,instance:'old'},v.serverAt).ok&&!w.input('a',{...base,life:99},v.serverAt).ok&&!w.input('a',{...base,controlEpoch:99},v.serverAt).ok&&kart(w).weapon===weapon);
    check(weapon+': normal Use accepted once and duplicate packet rejected',w.input('a',base,v.serverAt).ok&&!w.input('a',base,v.serverAt).ok);step(w);send(w,'a',{use:true});step(w,30);
    // A standing kart can legitimately collect the recycled second crate after
    // its one-ammo spend. Held Use must not spend that newly acquired item.
    check(weapon+': held or duplicate Use cannot replay the one-ammo spend',w.snapshot().events.filter(e=>e.type==='fire'&&e.weapon===weapon).length===1&&w.snapshot().events.filter(e=>e.type==='fire').length===1);
  }finally{w.dispose();}
  const ends=[],deadline=armed(weapon,fixture([],[point('a',0,0),point('b',-30,-30)]),{roundMs:1000,onResult:r=>ends.push(r)},0);
  try{
    fire(deadline);step(deadline,65);check(weapon+': deadline clears unfinished entity without late explosion',deadline.snapshot().phase==='done'&&ends.length===1&&deadline.snapshot().projectiles.length===0&&deadline.snapshot().grenades.length===0&&!deadline.snapshot().events.some(e=>e.type==='blast'));
    const next=deadline.rematch({instance:'arsenal-rematch-'+weapon,seed:0,startAt:10000});try{check(weapon+': rematch has fresh entities item state and epochs',next.snapshot().karts.every(k=>k.weapon===null&&k.spawnSeq===0)&&next.snapshot().projectiles.length===0&&next.snapshot().grenades.length===0&&finite(next.snapshot()));}finally{next.dispose();}
  }finally{deadline.dispose();}
}
const grenade=armed('grenade');try{fire(grenade);check('legacy Grenade trajectory carries its original fuse/radius plus explicit weapon',grenade.snapshot().grenades[0]?.weapon==='grenade'&&grenade.snapshot().grenades[0].radius===LEGACY.constants.GRENADE_R&&grenade.snapshot().grenades[0].fuse<LEGACY.constants.GRENADE_FUSE&&grenade.snapshot().grenades[0].fuse>LEGACY.constants.GRENADE_FUSE-.02);}finally{grenade.dispose();}
console.log(JSON.stringify({pass:true,checks:results.length,results,measurements,scope:'Actual Node authority and Rapier, no native visual or network performance claim'},null,2));
