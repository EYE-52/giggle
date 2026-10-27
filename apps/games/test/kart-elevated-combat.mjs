// Internal authority checks use real Rapier, actual collection/actions and full
// fixed-step rounds. No grant/teleport/hit hooks are exposed by the authority.
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import COMBAT from '../games/engines/kart-elevated-combat.js';
import { elevatedMapIds,elevatedMap } from '../public/js/engines/kart-elevated-maps.mjs';
await RAPIER.init();
const {createElevatedCombat}=COMBAT, results=[], measurements={};
// Freeze the vehicle parameters of the original legal recovery recordings.
// These three historical routes exercise today's recovery authority, while
// every other case below continues to exercise the production physics.
const recordedPhysics={
  version:1,fixedDt:1/60,gravity:{x:0,y:-18,z:0},maxKarts:8,maxStatics:128,
  chassis:{half:{x:1.22,y:.26,z:1.55},mass:120,centerOfMassY:-.12,yawInertiaScale:1,
    linearDamping:.15,angularDamping:2.2,friction:.45,restitution:0,modelOriginY:-.70},
  suspension:{restLength:.30,maxTravel:.24,stiffness:65,compression:7,relaxation:9,maxForce:10000,frictionSlip:2.2,sideStiffness:1},
  handling:{engineForce:460,maxForward:14,maxReverse:5,steering:.43,highSpeedSteer:.035,brake:22,coastBrake:.45},
  combat:{pulseMuzzle:{x:.95,y:.50,z:1.90},rocketMuzzle:{x:-.95,y:.50,z:1.90},seekerMuzzle:{x:-.95,y:.50,z:1.90},
    scatterMuzzle:{x:.95,y:.50,z:1.90},railMuzzle:{x:.95,y:.50,z:1.90},grenadeMuzzle:{x:.95,y:.50,z:1.90},empMuzzle:{x:.95,y:.50,z:1.90}},
  wheels:[{x:-1.05,y:-.015,z:1.02,radius:.385,front:1},{x:1.05,y:-.015,z:1.02,radius:.385,front:1},
    {x:-1.05,y:.065,z:-.92,radius:.465,front:0},{x:1.05,y:.065,z:-.92,radius:.465,front:0}],
};
class RecordedRecoveryWorld extends RAPIER.World {
  set numSolverIterations(_){super.numSolverIterations=6;}
  get numSolverIterations(){return super.numSolverIterations;}
  set maxCcdSubsteps(_){super.maxCcdSubsteps=2;}
  get maxCcdSubsteps(){return super.maxCcdSubsteps;}
  createCollider(desc,parent){
    if(!parent)desc.setFriction(.7).setRestitution(0);
    desc.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Average);
    return super.createCollider(desc,parent);
  }
}
const recordedRapier={...RAPIER,World:RecordedRecoveryWorld};
const check=(label,value)=>{assert.ok(value,label);results.push(label);};
const throws=(label,fn)=>{assert.throws(fn);results.push(label);};
const floor={id:'floor',shape:'box',half:{x:60,y:1,z:60},position:{x:0,y:-1,z:0}};
const point=(id,x,y,z,angle=0,surface='floor')=>({id,x,y,z,angle,surface});
const fixture=(extra=[],spawns=[point('a',0,0,0),point('b',0,0,10,Math.PI)],sockets=[point('s0',-0.7,0,0),point('s1',0.7,0,0)])=>({id:'test',revision:'internal-test-1',half:60,colliders:[floor,...extra],spawns,sockets});
let instances=0;
function create(map=fixture(),options={},seats=[{id:'a',name:'A'},{id:'b',name:'B'}],config=CONFIG,rapier=RAPIER) {
  return createElevatedCombat(rapier,config,map,seats,{instance:'test-'+(++instances),seed:1,startAt:0,countdownMs:0,roundMs:20000,crates:1,...options});
}
function step(w,n=1,each) {
  for(let i=0;i<n;i++) {each?.(i);w.advance(w.snapshot().serverAt+CONFIG.fixedDt*1000);}
}
const kart=(w,id='a')=>w.snapshot(id).karts.find(k=>k.id===id);
function send(w,id='a',value={},receiptAt=w.snapshot().serverAt) {
  const own=w.snapshot(id).you;
  return w.input(id,{instance:w.snapshot().instance,life:own.life,controlEpoch:own.controlEpoch,seq:own.receivedSeq+1,steer:0,throttle:0,brake:0,nitro:false,use:false,...value},receiptAt);
}
function fire(w,id='a') {const a=send(w,id,{use:true}),b=send(w,id,{use:false});assert.ok(a.ok&&b.ok);step(w);}
const seedCache=new Map();
function armed(weapon,map=fixture(),options={},seats) {
  const cacheKey=JSON.stringify(map), old=seedCache.get(cacheKey+'-'+weapon);
  for(const seed of old===undefined?Array.from({length:256},(_,i)=>i):[old]) {
    const w=create(map,{...options,seed},seats);step(w);
    if(kart(w).weapon===weapon) {seedCache.set(cacheKey+'-'+weapon,seed);step(w,160);return w;}
    w.dispose();
  }
  throw new Error('no actual '+weapon+' pickup seed in bounded search');
}
const wireFinite=value=>typeof value==='number'?Number.isFinite(value):typeof value==='object'&&value!==null?Object.values(value).every(wireFinite):true;
const upDot=p=>1-2*(p.rotation.x**2+p.rotation.z**2);
const gap=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);

// Height isolation on the shipped layouts, not a replacement test deck.
// All world solids stay present. Only test seat/pickup locations select a
// clear firing lane, and the item still comes through ordinary collection.
for(const [id,surface,x,z,toZ,height]of [
  ['garden','courtyard',18,1,12,7],
  ['frost','quarry-shelf',-27,2,18,8],
  ['neon','loading-deck',22,4,20,6],
  ['harbor','upper-dock',0,8,24,7],
])for(const upper of [false,true]){
  const map=elevatedMap(id),y=upper?height:0,on=upper?surface:'floor',otherY=upper?0:height,otherSurface=upper?'floor':surface;
  map.spawns=[point('a',x,y,z,0,on),point('b',x,y,toZ,Math.PI,on),point('c',x,otherY,toZ,Math.PI,otherSurface)];
  map.sockets=[point('lane-a',x-.7,y,z,0,on),point('lane-b',x+.7,y,z,0,on)];
  const w=armed('rocket',map,{},[{id:'a'},{id:'b'},{id:'c'}]);
  try{
    fire(w);step(w,35);
    check(id+' '+(upper?'upper':'underpass')+' direct Rocket kills a full-health rival once',kart(w,'b').health===0&&!kart(w,'b').alive&&kart(w).hits===1&&w.snapshot().events.filter(e=>e.type==='hit'&&e.other==='b').length===1);
    check(id+' finite shipped deck blocks cross-height Rocket damage',kart(w,'c').health===100&&kart(w,'c').alive&&!w.snapshot().events.some(e=>e.type==='hit'&&e.other==='c'));
  }finally{w.dispose();}
}

// Confirmed feedback is the authority's final sweep, including shots that
// are born and consumed before even a fixed-tick snapshot can contain them.
{
  const w=armed('pulse',fixture([],[point('a',0,0,0),point('b',0,0,4.5,Math.PI)]));
  try {
    fire(w);const s=w.snapshot(),impact=s.events.find(e=>e.type==='impact'),accepted=s.events.find(e=>e.type==='fire');
    check('same-tick Pulse hit has no live projectile but carries its exact sweep start',s.projectiles.length===0&&impact?.other==='b'&&impact.from&&gap(impact.from,accepted.position)<1e-9&&kart(w,'b').health===90);
    const victim=kart(w,'b').pose.position;
    check('confirmed victim endpoint is the hull intersection, not chassis position',Math.abs(gap(impact.position,{...victim,y:victim.y+.35})-1.7)<.002&&gap(impact.position,victim)>1);
  }finally{w.dispose();}
}
for(const weapon of ['pulse','scatter','rail','sentry']){
  const w=armed(weapon);
  try {
    fire(w);let checked=false;
    for(let i=0;i<60&&!checked;i++){
      const before=w.snapshot();step(w);const s=w.snapshot(),impact=s.events.find(e=>e.type==='impact'&&e.weapon===weapon&&e.tick===s.simTick);
      if(!impact)continue;
      const shot=before.projectiles.find(p=>p.weapon===weapon&&gap(p.position,impact.from)<1e-9);assert.ok(shot,weapon+' exact preceding shot');
      const v=shot.velocity,d={x:impact.position.x-impact.from.x,y:impact.position.y-impact.from.y,z:impact.position.z-impact.from.z},t=(d.x*v.x+d.y*v.y+d.z*v.z)/(v.x*v.x+v.y*v.y+v.z*v.z);
      check(weapon+' impact carries final sweep start and retires the consumed shot immediately',t>=0&&t<=CONFIG.fixedDt&&gap(d,{x:v.x*t,y:v.y*t,z:v.z*t})<1e-6&&!s.projectiles.some(p=>p.id===shot.id));checked=true;
    }
    check(weapon+' real collected weapon reaches the confirmed sweep regression',checked);
  }finally{w.dispose();}
}
{
  const wall={id:'pellet-wall',shape:'box',half:{x:6,y:2,z:.01},position:{x:0,y:2,z:3.5}},w=armed('scatter',fixture([wall]));
  try {
    fire(w);const impacts=w.snapshot().events.filter(e=>e.type==='impact'),accepted=w.snapshot().events.find(e=>e.type==='fire');
    check('three same-tick Scatter pellets carry independent exact surface endpoints',impacts.length===3&&new Set(impacts.map(e=>e.id)).size===3&&new Set(impacts.map(e=>e.position.x.toFixed(4))).size===3&&impacts.every(e=>e.surfaceId==='pellet-wall'&&gap(e.from,accepted.position)<1e-9)&&w.snapshot().projectiles.length===0);
  }finally{w.dispose();}
}

{
  const awards=[],ends=[],w=create(fixture(),{countdownMs:500,roundMs:6000,onAward:(...v)=>awards.push(v),onResult:r=>ends.push(r)});
  try {
    const initial=w.snapshot();
    check('starts in countdown with actual supported body poses',initial.phase==='countdown'&&initial.karts.every(k=>k.pose.position.y>0.5&&k.pose.position.y<0.9));
    send(w,'a',{throttle:1,use:true});step(w,29);
    check('countdown cannot drive collect or spend an item',kart(w).pose.position.z===initial.karts[0].pose.position.z&&w.snapshot().events.length===0&&kart(w).weapon===null);
    step(w,2);
    check('countdown becomes live without queued opening fire',w.snapshot().phase==='live'&&w.snapshot().events.filter(e=>e.type==='fire').length===0);
    check('live collect claims one supported crate and one reward',kart(w).weapon!==null&&awards.length===1&&awards[0][1]===1&&w.snapshot().events.filter(e=>e.type==='pickup').length===1);
    const pub=w.snapshot('watcher'),own=w.snapshot('a');
    check('only owner sees receipt ACK and private wallet',pub.you===null&&own.you.coins===1&&!pub.karts.some(k=>'coins'in k||'input'in k));
    check('wire snapshot has no world handles input queues or RNG',wireFinite(pub)&&!Object.keys(pub).some(k=>/rng|seed|world|queue/i.test(k))&&JSON.stringify(pub).length<20000);
    own.karts[0].pose.position.y=999;own.crates[0].position.y=999;
    check('wire snapshots cannot mutate private authority',kart(w).pose.position.y<1&&w.snapshot().crates[0].position.y<1);
    step(w,390);
    check('deadline produces plain result once',w.snapshot().phase==='done'&&ends.length===1&&w.result().winners.length===2);
    const saved=JSON.stringify(w.result());w.advance(100000);w.result();
    check('late pumps and repeated result reads do not re-award result',ends.length===1&&saved===JSON.stringify(w.result()));
    check('done rejects input',!send(w).ok);
    throws('rematch requires a fresh instance',()=>w.rematch({instance:w.snapshot().instance,seed:1,startAt:100000}));
    const next=w.rematch({instance:'fresh-rematch',seed:2,startAt:100000});
    try {check('rematch starts a fresh world scores events and ACKs',next.snapshot('a').phase==='countdown'&&next.snapshot('a').you.receivedSeq===0&&kart(next).hits===0&&next.snapshot().events.length===0);w.dispose();step(next,10);check('disposing old instance cannot touch fresh rematch',!next.stats().disposed&&next.stats().physics.karts===2);}finally{next.dispose();}
  } finally {w.dispose();}
  check('instance disposal is idempotent and retires all physics resources',w.stats().disposed&&w.stats().physics.disposed&&w.stats().physics.karts===0&&w.stats().physics.statics===0);
  throws('disposed instance rejects queries',()=>w.snapshot());
  throws('disposed instance rejects compact private reads',()=>w.privateStatus('a'));
}

{
  const w=create();try {
    step(w);
    const own=w.snapshot('a').you,base={instance:w.snapshot().instance,life:own.life,controlEpoch:own.controlEpoch,seq:1,steer:0,throttle:1,brake:0,nitro:false,use:false};
    check('spectator cannot submit movement',!w.input('watcher',base,w.snapshot().serverAt).ok);
    check('stale instance life and control epoch are rejected',!w.input('a',{...base,instance:'old'},w.snapshot().serverAt).ok&&!w.input('a',{...base,life:9},w.snapshot().serverAt).ok&&!w.input('a',{...base,controlEpoch:9},w.snapshot().serverAt).ok);
    check('client pose and malformed intent are rejected',!w.input('a',{...base,x:999},w.snapshot().serverAt).ok&&!w.input('a',{...base,throttle:NaN},w.snapshot().serverAt).ok);
    check('accepted input has bounded receipt ACK',w.input('a',base,w.snapshot().serverAt).ok&&w.snapshot('a').you.receivedSeq===1&&w.snapshot('a').you.appliedInputSeq===0);
    check('compact private status agrees with full private snapshot',JSON.stringify(w.privateStatus('a'))===JSON.stringify(w.snapshot('a').you));
    const privateCopy=w.privateStatus('a');privateCopy.receivedSeq=999;privateCopy.coins=-1;
    check('compact private status is detached and never grants a watcher ACK',w.privateStatus('a').receivedSeq===1&&w.privateStatus('a').coins>=0&&w.privateStatus('watcher')===null);
    check('duplicate and backwards sequence cannot repeat intent',!w.input('a',base,w.snapshot().serverAt).ok&&!w.input('a',{...base,seq:0},w.snapshot().serverAt).ok);
    check('unbounded sequence jump and future receipt are rejected',!w.input('a',{...base,seq:9000},w.snapshot().serverAt).ok&&!w.input('a',{...base,seq:2},w.snapshot().serverAt+2000).ok);
    step(w);
    check('fixed step acknowledges applied movement',w.snapshot('a').you.appliedInputSeq===1&&kart(w).pose.speed>0);
    const at=w.snapshot().serverAt;
    send(w,'a',{throttle:-1},at+100);step(w,4);
    check('later receipt cannot retroactively affect earlier fixed steps',w.snapshot('a').you.appliedInputSeq===1&&kart(w).pose.speed>0);
    step(w,3);check('later receipt applies only when reached',w.snapshot('a').you.appliedInputSeq===2);
    check('backdated receipt is rejected',!send(w,'a',{},at).ok);
    step(w,120);const speed=kart(w).pose.speed;step(w,120);
    check('receipt TTL releases throttle and does not keep accelerating',Math.abs(kart(w).pose.speed)<Math.abs(speed)+0.1&&!kart(w).nitroActive);
    const before=kart(w).pose;
    w.setConnected('a',false);step(w,60);
    check('disconnect freezes all axes and clears queued intent',JSON.stringify(kart(w).pose.position)===JSON.stringify(before.position)&&w.stats().queuedInputs===0&&!send(w).ok);
    w.setConnected('a',true);step(w,30);
    check('reconnect is neutral and invalidates old control epoch',Math.abs(kart(w).pose.speed)<0.1&&!w.input('a',{...base,seq:3},w.snapshot().serverAt).ok);
    throws('backward server clock is rejected',()=>w.advance(0));
    w.advance(w.snapshot().serverAt+5000);
    check('long pump stalls execute bounded physics and record dropped time',w.snapshot().droppedMs>4000&&w.stats().physics.tick<500);
    for(let i=0;i<32;i++) assert.ok(send(w,'a',{},w.snapshot().serverAt+100).ok);
    check('input queue cannot grow past bounded capacity',!send(w,'a',{},w.snapshot().serverAt+100).ok&&w.stats().queuedInputs===32);
  }finally{w.dispose();}
}

{
  const wall={id:'driven-wall',shape:'box',half:{x:8,y:2,z:.5},position:{x:0,y:2,z:6}};
  const w=create(fixture([wall],[point('a',0,0,0),point('b',20,0,20)]));
  try {
    step(w,220,i=>{if(i%20===0)send(w,'a',{throttle:1});});
    const impacts=w.snapshot().events.filter(e=>e.type==='collision'&&e.surfaceId==='driven-wall');
    check('driven chassis is stopped by physical wall without tunnelling',kart(w).pose.position.z<4.5);
    check('wall impact reports real manifold position, bounded impulse and authoritative tick',impacts.length>0&&impacts.every(e=>wireFinite(e)&&e.impulse>=100&&e.impulse<=4000&&e.tick<=w.snapshot().simTick&&Math.abs(e.position.z-5.5)<.1));
    check('persistent wall contact cannot spam collision feedback each tick',impacts.every((e,i)=>!i||e.tick-impacts[i-1].tick>=21));
    check('ordinary wall collision neither KOs nor awards points',kart(w).alive&&kart(w).hits===0&&kart(w).deaths===0);
    measurements.wallContacts={events:impacts.map(e=>({tick:e.tick,impulse:e.impulse,position:e.position,normal:e.normal})),finalPose:kart(w).pose.position,health:kart(w).health};
  }finally{w.dispose();}
  const free=create(fixture([],[point('a',0,0,0),point('b',20,0,20)]));
  try {
    step(free,70,i=>{if(i%20===0)send(free,'a',{throttle:1});});
    step(free,50,i=>{if(i%20===0)send(free,'a',{brake:1});});
    check('ordinary acceleration and braking do not invent collision contacts',!free.snapshot().events.some(e=>e.type==='collision'));
  }finally{free.dispose();}
}

for(const weapon of ['pulse','scatter','rocket','rail']) {
  // Wounded constructor isolates single-impact sweep/KO cleanup. Default100
  // health, repeated missile damage and full-health scoring are in kart-health.
  const awards=[],w=armed(weapon,fixture(),{initialHealth:1,onAward:(...v)=>awards.push(v)});
  try {
    check(weapon+' is acquired from actual shared weighted crate pool',kart(w).weapon===weapon);
    const life=w.snapshot('b').you;fire(w);step(w,8);
    check(weapon+' full 3D projectile flow KOs once',kart(w).hits===1&&!kart(w,'b').alive&&kart(w,'b').deaths===1);
    check(weapon+' KO awards once and disables dead hull',awards.filter(v=>v[1]===10).length===1&&!send(w,'b').ok);
    step(w,125);
    check(weapon+' 2s respawn receives protection and fresh life',kart(w,'b').alive&&kart(w,'b').spawnSeq===life.life+1&&kart(w,'b').shield>2&&Math.abs(kart(w,'b').pose.speed)<0.1);
    check(weapon+' old-life input cannot control respawn',!w.input('b',{instance:w.snapshot().instance,life:life.life,controlEpoch:life.controlEpoch,seq:1,steer:0,throttle:1,brake:0,nitro:false,use:true},w.snapshot().serverAt).ok);
    step(w,30);check(weapon+' dead target cannot be awarded twice',kart(w).hits===1&&kart(w,'b').deaths===1);
  }finally{w.dispose();}
}

{
  // At the actual Rail speed each 60Hz step travels 2.67u. Both sampled
  // endpoints of this grazing chord miss the 1.7u combat hull; only the
  // swept path can confirm the hit. Use a real collected Rail and poses.
  const w=armed('rail',fixture([],[point('a',0,0,0),point('b',2.57,0,5.9,Math.PI)]),{initialHealth:1});
  try {
    fire(w);const before=w.snapshot(),shot=before.projectiles[0],target=kart(w,'b').pose;
    assert.ok(shot&&kart(w,'b').alive);
    const h={x:target.position.x,y:target.position.y+.35,z:target.position.z},end={x:shot.position.x+shot.velocity.x*CONFIG.fixedDt,y:shot.position.y+shot.velocity.y*CONFIG.fixedDt,z:shot.position.z+shot.velocity.z*CONFIG.fixedDt};
    check('fast Rail grazing endpoints both lie outside the real combat hull',Math.hypot(shot.position.x-h.x,shot.position.y-h.y,shot.position.z-h.z)>1.7&&Math.hypot(end.x-h.x,end.y-h.y,end.z-h.z)>1.7);
    step(w);
    check('fast Rail swept grazing chord KOs once despite both endpoints missing',kart(w).hits===1&&kart(w,'b').deaths===1&&!kart(w,'b').alive&&w.snapshot().projectiles.length===0);
    step(w,10);check('grazing fast projectile cannot re-award a consumed impact',kart(w).hits===1&&kart(w,'b').deaths===1);
  }finally{w.dispose();}
  const wall={id:'thin-cover',shape:'box',half:{x:6,y:2,z:.01},position:{x:0,y:2,z:5.9}};
  const cover=armed('rail',fixture([wall],[point('a',0,0,0),point('b',0,0,10)]));
  try {
    fire(cover);step(cover,3);
    check('fast Rail stops at 2cm actual static cover before a farther hull',kart(cover,'b').alive&&kart(cover).hits===0&&cover.snapshot().projectiles.length===0&&cover.snapshot().events.some(e=>e.type==='impact'&&e.surfaceId==='thin-cover'));
  }finally{cover.dispose();}
}

// The authored side-mounted barrel must match the server launch position at
// every heading. Use actual crate acquisition and settled physical poses.
for(const angle of [0,Math.PI/2,Math.PI,-Math.PI/2]) {
  const map=fixture([],[point('a',0,0,0,angle),point('b',20,0,20)]),w=armed('pulse',map);
  try {
    const before=kart(w).pose,offset=CONFIG.combat.pulseMuzzle,q=before.rotation;
    const v={x:offset.x,y:offset.y,z:offset.z};
    const t={x:2*(q.y*v.z-q.z*v.y),y:2*(q.z*v.x-q.x*v.z),z:2*(q.x*v.y-q.y*v.x)};
    const expected={x:before.position.x+v.x+q.w*t.x+q.y*t.z-q.z*t.y,y:before.position.y+v.y+q.w*t.y+q.z*t.x-q.x*t.z,z:before.position.z+v.z+q.w*t.z+q.x*t.y-q.y*t.x};
    fire(w);const e=w.snapshot().events.find(e=>e.type==='fire');
    check('mounted Pulse launches from the measured bore at heading '+angle,!!e&&Math.hypot(e.position.x-expected.x,e.position.y-expected.y,e.position.z-expected.z)<.002);
    check('mounted Pulse remains a forward projectile at heading '+angle,w.snapshot().projectiles.length===1&&w.snapshot().projectiles[0].velocity.x*e.direction.x+w.snapshot().projectiles[0].velocity.y*e.direction.y+w.snapshot().projectiles[0].velocity.z*e.direction.z>0);
  }finally{w.dispose();}
}
{
  // Cover is in front of the side barrel while leaving the centre line clear.
  // A centre-mounted sweep would miss this and create a shot beyond the wall.
  const cover={id:'barrel-cover',shape:'box',half:{x:.30,y:.35,z:.08},position:{x:.95,y:1.14,z:1.83}};
  const w=armed('pulse',fixture([cover]));
  try {
    const before=kart(w).pose,offset=CONFIG.combat.pulseMuzzle;
    fire(w);
    check('side-mounted Pulse checks the actual barrel corridor before launching',w.snapshot().projectiles.length===0&&w.snapshot().events.some(e=>e.type==='impact'&&e.surfaceId==='barrel-cover'));
    const impact=w.snapshot().events.find(e=>e.type==='impact');
    check('blocked barrel reports its actual sweep origin before the muzzle',gap(impact.from,{x:before.position.x+offset.x,y:before.position.y+offset.y,z:before.position.z})<.002&&impact.position.z<before.position.z+offset.z);
    check('blocked side-mounted Pulse spends one shot without a KO',kart(w).ammo===11&&kart(w).hits===0&&kart(w,'b').alive);
  }finally{w.dispose();}
}

{
  const w=armed('pulse');try {
    send(w,'a',{use:true});send(w,'a',{use:false});step(w);check('short Use edge survives newer neutral packet exactly once',kart(w).ammo===11&&w.snapshot().events.filter(e=>e.type==='fire').length===1);
    send(w,'a',{use:true});step(w,30);send(w,'a',{use:true});step(w,30);
    check('accepted Pulse sequence keeps its authoritative cadence despite repeated held Use',w.snapshot().events.filter(e=>e.type==='fire'&&e.weapon==='pulse').length>1&&kart(w).ammo<11);
  }finally{w.dispose();}
}

{
  const w=armed('shield');try {fire(w);check('Shield activates four second protection without cancelling itself',kart(w).shield>3.9&&w.snapshot().events.some(e=>e.type==='shield'));step(w,60);check('Shield duration advances once per fixed step',kart(w).shield>2.8&&kart(w).shield<3.1);}finally{w.dispose();}
  const emp=armed('emp');try{fire(emp);check('EMP applies directed slow without a KO',kart(emp,'b').empT>1.5&&kart(emp).hits===0&&kart(emp,'b').alive);step(emp,100);check('EMP duration refresh expires without stacked slow',kart(emp,'b').empT===0);}finally{emp.dispose();}
}

{
  // Two separated rivals inside the right-pod thrower's actual blast radius.
  const spawns=[point('a',0,0,0),point('b',0,0,22),point('c',3,0,21)];
  const map=fixture([],spawns), seats=[{id:'a'},{id:'b'},{id:'c'}];
  // Find an actual grenade pickup seed with this three-seat constructor.
  let w;
  // Low-health victims isolate multi-victim final KO and respawn settlement.
  for(let seed=0;seed<256;seed++) {const candidate=create(map,{seed,initialHealth:1},seats);step(candidate);if(kart(candidate).weapon==='grenade'){w=candidate;break;}candidate.dispose();}
  assert.ok(w);step(w,160);
  try {
    fire(w);const launch=w.snapshot().grenades[0];let peak=launch.position.y,bounces=0;
    step(w,83,()=>{const g=w.snapshot().grenades[0];if(g){peak=Math.max(peak,g.position.y);bounces=Math.max(bounces,g.bounces);}});
    const blast=w.snapshot().events.find(e=>e.type==='blast'&&e.weapon==='grenade');
    measurements.grenade={peakY:peak,bounces,blast:blast?.position};
    check('Grenade actually launches a 3D arc and bounces on physical floor',peak>2&&bounces>0);
    check('Grenade fuse produces one blast and multiple confirmed KOs',!!blast&&kart(w).hits===2&&!kart(w,'b').alive&&!kart(w,'c').alive&&w.snapshot().grenades.length===0);
    step(w,125);check('Grenade victims safely respawn without duplicate splash awards',kart(w,'b').alive&&kart(w,'c').alive&&kart(w).hits===2);
  }finally{w.dispose();}
}

{
  // A mine is placed behind A; B must physically drive forward into it.
  const map=fixture([],[point('a',0,0,0),point('b',0,0,-10)]),w=armed('mine',map,{initialHealth:1});
  try {
    fire(w);check('Mine sequence starts on actual support with arm delay',w.snapshot().mines.length===1&&kart(w).ammo===2&&kart(w).firing&&!w.snapshot().mines[0].armed&&w.snapshot().mines[0].surfaceId==='floor');
    step(w,45);check('Mine trail has three separated drops and first arms after 0.7 fixed seconds',w.snapshot().mines.length===3&&w.snapshot().mines[0]?.armed===true);
    step(w,70,i=>{if(i%20===0)send(w,'b',{throttle:1});});
    check('moving rival crossing supported Mine KOs once',kart(w).hits===1&&!kart(w,'b').alive&&w.snapshot().mines.length===2);
    check('Mine owner is immune and its corpse cannot retrigger',kart(w).alive&&kart(w,'b').deaths===1);
    step(w,125);check('Mine victim gets safe protected fresh respawn',kart(w,'b').alive&&kart(w,'b').spawnSeq===1&&kart(w).hits===1);
  }finally{w.dispose();}
}

{
  const wall={id:'cover',shape:'box',half:{x:6,y:2,z:0.5},position:{x:0,y:2,z:5}};
  for(const weapon of ['pulse','scatter','rocket','rail','emp']) {
    const w=armed(weapon,fixture([wall]));try {
      fire(w);step(w,110);
      check(weapon+' respects actual finite solid cover',kart(w,'b').alive&&kart(w).hits===0&&kart(w,'b').empT===0);
      if(weapon!=='emp')check(weapon+' stops at first cover without late expiry blast',w.snapshot().projectiles.length===0&&w.snapshot().events.some(e=>e.type==='impact'&&e.surfaceId==='cover'));
    }finally{w.dispose();}
  }
  const low={id:'low-cover',shape:'box',half:{x:6,y:0.2,z:0.5},position:{x:0,y:0.2,z:5}};
  const over=armed('rail',fixture([low]));try{fire(over);step(over,8);check('finite low cover permits a genuine25-damage wound above it',kart(over,'b').health===75&&kart(over).hits===0);}finally{over.dispose();}
}

{
  const roof={id:'upper-deck',shape:'deck',half:{x:8,y:0.3,z:15},position:{x:0,y:3.7,z:7}};
  const upper=[point('a',0,4,0,0,'upper-deck'),point('b',0,0,10)];
  const sockets=[point('s0',-0.7,4,0,0,'upper-deck'),point('s1',0.7,4,0,0,'upper-deck')];
  for(const weapon of ['pulse','scatter','rocket','rail','emp']) {
    const w=armed(weapon,fixture([roof],upper,sockets));try{fire(w);step(w,110);check(weapon+' cannot hit a separate underpass layer at shared x/z',kart(w,'b').alive&&kart(w).hits===0&&kart(w,'b').empT===0);}finally{w.dispose();}
  }
  const lowerCrates=create(fixture([roof],upper,[point('s0',-0.7,0,0),point('s1',0.7,0,0)]));
  try{step(lowerCrates,180);check('upper kart cannot collect an overlapping lower-layer crate',kart(lowerCrates).weapon===null);}finally{lowerCrates.dispose();}
  const shortRoof={id:'mine-roof',shape:'deck',half:{x:6,y:0.2,z:12},position:{x:0,y:1.6,z:0}};
  const mine=armed('mine',fixture([shortRoof],[point('a',0,1.8,0,0,'mine-roof'),point('b',0,0,-2.5)],[point('s0',-0.7,1.8,0,0,'mine-roof'),point('s1',0.7,1.8,0,0,'mine-roof')]));
  try{fire(mine);step(mine,55);check('Mine on a low deck cannot trigger through its solid underside',kart(mine,'b').alive&&kart(mine).hits===0&&mine.snapshot().mines[0]?.armed);}finally{mine.dispose();}
}

{
  const w=armed('pulse');try {
    send(w,'a',{use:true});send(w,'a',{use:false},w.snapshot().serverAt+1000);w.advance(w.snapshot().serverAt+3000);
    check('stale Use edge cannot borrow freshness from newer neutral input',!w.snapshot().events.some(e=>e.type==='fire')&&kart(w).ammo===12);
  }finally{w.dispose();}
  const countdown=create(fixture(),{countdownMs:100});try{
    step(countdown,5);send(countdown,'a',{throttle:1},110);step(countdown,4);
    check('live receipt queued before countdown pump survives phase transition',countdown.snapshot('a').you.appliedInputSeq===1&&kart(countdown).pose.speed>0);
  }finally{countdown.dispose();}
}

{
  const map=fixture([],[point('a',0,0,0),point('b',20,0,-20)]),plain=create(map),boost=create(map);try {
    step(plain);step(boost);
    step(plain,140,i=>{if(i%20===0)send(plain,'a',{throttle:1});});
    step(boost,140,i=>{if(i%20===0)send(boost,'a',{throttle:1,nitro:true});});
    measurements.nitro={baseSpeed:kart(plain).pose.speed,boostSpeed:kart(boost).pose.speed,charge:kart(boost).nitro};
    check('Nitro adds real top-speed and punch to authoritative chassis',kart(boost).pose.speed>18&&kart(boost).pose.speed>kart(plain).pose.speed+3&&kart(boost).nitro<0.1);
    step(boost,50,i=>{if(i%20===0)send(boost,'a',{throttle:1,nitro:true});});
    check('empty Nitro locks and recharges rather than extending held boost',!kart(boost).nitroActive&&kart(boost).nitro>0&&kart(boost).nitro<0.3);
  }finally{plain.dispose();boost.dispose();}
}

{
  const ramp={id:'ascent',shape:'wedge',half:{x:5,y:2,z:8},position:{x:0,y:2,z:0}};
  // A longer diagnostic plateau permits braking after the real ramp jump,
  // then a sustained full-health fight under the faster current handling.
  const bridge={id:'battle-deck',shape:'deck',half:{x:5,y:0.35,z:20},position:{x:0,y:3.65,z:28}};
  const map=fixture([ramp,bridge],[point('a',0,0,-20),point('b',0,4,40,Math.PI,'battle-deck')],[point('s0',-0.7,4,10,0,'battle-deck'),point('s1',0.7,4,10,0,'battle-deck')]);
  const seed=seedCache.get(JSON.stringify(fixture())+'-pulse'),ends=[],w=create(map,{seed,roundMs:10000,onResult:r=>ends.push(r)});
  try {
    step(w);let peak=0,picked=false;
    for(let i=0;i<480&&!picked;i++) {if(i%8===0)send(w,'a',{throttle:.35});step(w);peak=Math.max(peak,kart(w).pose.position.y);picked=kart(w).weapon!==null;}
    check('complete elevated flow physically ascends and collects deck crate',picked&&kart(w).weapon==='pulse'&&peak>4.4&&kart(w).pose.wheels.some(s=>s.surfaceId==='battle-deck'));
    check('ordinary driven ramp ascent never triggers stuck recovery',w.snapshot().events.every(e=>e.type!=='recover')&&kart(w).spawnSeq===0);
    const aimed=p=>p.grounded&&Math.abs(p.speed)<.1&&Math.hypot(...Object.values(p.angularVelocity))<.05&&Math.abs(2*(p.rotation.y*p.rotation.z-p.rotation.w*p.rotation.x))<.01;
    for(let i=0;i<150;i++){if(i%8===0)send(w,'a',{brake:1});step(w);if(aimed(kart(w).pose))break;}
    check('physical approach brakes on the deck before its rival',kart(w).pose.grounded&&Math.abs(kart(w).pose.speed)<.4&&kart(w).pose.position.z<kart(w,'b').pose.position.z-3.5);
    for(let shot=0;shot<10;shot++){fire(w);step(w,9);send(w,'a',{brake:1});}
    check('elevated deck collection produces ten real same-layer hits and a full-health KO',kart(w).hits===1&&!kart(w,'b').alive&&kart(w,'b').health===0);
    step(w,125);check('elevated KO respawns on a legal supported clear pose',kart(w,'b').alive&&kart(w,'b').shield>2&&kart(w,'b').spawnSeq===1);
    step(w,400);check('complete elevated deadline has a unique confirmed winner once',w.snapshot().phase==='done'&&w.result().winners.join()==='a'&&ends.length===1);
    const next=w.rematch({instance:'elevated-rematch',seed:seed+1,startAt:w.snapshot().serverAt});
    try{check('complete elevated rematch resets scores items entities and life',next.snapshot().karts.every(k=>k.hits===0&&k.spawnSeq===0&&k.weapon===null)&&next.snapshot().projectiles.length===0);}finally{next.dispose();}
    measurements.elevatedRound={maxChassisY:peak,winner:w.result().winners[0],knockouts:kart(w).hits};
  }finally{w.dispose();}
}

{
  const jump={id:'jump',shape:'wedge',half:{x:4,y:1.5,z:6},position:{x:18,y:1.5,z:0}};
  const map=fixture([jump],[point('a',18,0,-20),point('b',-12,0,-22)],[point('s0',17.3,0,-20),point('s1',18.7,0,-20)]),w=armed('mine',map);
  try {
    let flying=false;
    for(let i=0;i<240&&!flying;i++) {if(i%20===0)send(w,'a',{throttle:1});step(w);const p=kart(w).pose;flying=p.position.z>9.5&&!p.grounded;}
    check('internal authority retains actual physical airborne state',flying&&kart(w).pose.position.y>3);
    fire(w);check('unsupported Mine use keeps item and does not invent support',kart(w).weapon==='mine'&&w.snapshot().mines.length===0);
    const pose=kart(w).pose,charge=kart(w).nitro;w.setConnected('a',false);step(w,60);
    check('airborne disconnect freezes gravity rotation and charge',JSON.stringify(kart(w).pose.position)===JSON.stringify(pose.position)&&JSON.stringify(kart(w).pose.rotation)===JSON.stringify(pose.rotation)&&kart(w).nitro===charge);
    w.setConnected('a',true);step(w,100);check('airborne reconnect falls and lands without held movement',kart(w).pose.grounded&&kart(w).pose.position.y<1&&Math.abs(kart(w).pose.speed)<0.5);
    check('ordinary physical jump and landing never trigger stuck recovery',w.snapshot().events.every(e=>e.type!=='recover')&&kart(w).spawnSeq===0);
  }finally{w.dispose();}
}

{
  const roof={id:'grenade-roof',shape:'deck',half:{x:6,y:0.3,z:16},position:{x:0,y:2.05,z:8}};
  const map=fixture([roof],[point('a',0,0,0),point('b',0,2.35,6,0,'grenade-roof')]);
  const w=armed('grenade',map);try{
    fire(w);let peak=0;step(w,84,()=>{const g=w.snapshot().grenades[0];if(g)peak=Math.max(peak,g.position.y);});
    const blast=w.snapshot().events.find(e=>e.type==='blast'&&e.weapon==='grenade'),victim=kart(w,'b').pose.position;
    measurements.roofGrenade={peakY:peak,blast:blast?.position,target: victim};
    check('Grenade ceiling sweep uses actual roof normal and bounds arc',peak<1.36&&!!blast);
    check('nearby roof blocks Grenade splash across layers',Math.hypot(victim.x-blast.position.x,victim.y+0.35-blast.position.y,victim.z-blast.position.z)<4&&kart(w,'b').alive&&kart(w).hits===0);
  }finally{w.dispose();}
  const rmap=fixture([],[point('a',0,0,0),point('b',0,0,10),point('c',-2.6,0,8.5)]),rocket=armed('rocket',rmap,{},[{id:'a'},{id:'b'},{id:'c'}]);
  try{fire(rocket);step(rocket,8);const direct=rocket.snapshot().events.find(e=>e.type==='impact'&&e.weapon==='rocket')?.other;check('Rocket kills first swept hull and wounds indirect rival exactly once',['b','c'].includes(direct)&&kart(rocket).hits===1&&kart(rocket,direct).health===0&&kart(rocket,direct==='b'?'c':'b').health===60&&rocket.snapshot().events.filter(e=>e.type==='hit').length===2);}finally{rocket.dispose();}
}

{
  // The ordinary spawn shield is tested against a genuine offensive shot.
  const w=create(fixture(),{seed:seedCache.get(JSON.stringify(fixture())+'-pulse')});
  try{step(w);fire(w);step(w,8);check('spawn Shield absorbs real first-hull projectiles without KO',kart(w,'b').alive&&kart(w,'b').shield>2&&kart(w).hits===0&&w.snapshot().events.some(e=>e.type==='impact'&&e.other==='b'));check('offensive spend drops shooter spawn protection immediately',kart(w).shield===0);}finally{w.dispose();}
  const distant=armed('rocket',fixture([],[point('a',0,0,0),point('b',25,0,-25)]));
  try{fire(distant);step(distant,180);check('entire Rocket payload expires after its final missile TTL without an invented blast',distant.snapshot().projectiles.length===0&&!distant.snapshot().events.some(e=>e.type==='blast'));}finally{distant.dispose();}
  const mine=armed('mine',fixture([],[point('a',0,0,0),point('b',25,0,-25)]));
  try{fire(mine);step(mine,45);step(mine,80,i=>{if(i%20===0)send(mine,'a',{throttle:-1});});check('Mine owner physically crosses its armed trap and remains immune',kart(mine).pose.position.z<-3&&kart(mine).alive&&mine.snapshot().mines.length===3);step(mine,640);check('every armed Mine expires at its own bounded lifetime without scoring',mine.snapshot().mines.length===0&&kart(mine).hits===0);}finally{mine.dispose();}
}

{
  const ramp={id:'aim-ramp',shape:'wedge',half:{x:5,y:2,z:8},position:{x:0,y:2,z:0}};
  const map=fixture([ramp],[point('a',0,0,-20),point('b',20,0,-20)],[point('s0',-0.7,0,-20),point('s1',0.7,0,-20)]),w=armed('pulse',map);
  try{
    let onRamp=false;
    for(let i=0;i<180&&!onRamp;i++){if(i%20===0)send(w,'a',{throttle:1});step(w);const p=kart(w).pose;onRamp=p.position.z>-2&&p.position.z<5&&Math.abs(p.rotation.x)>0.1;}
    const before=kart(w).pose;fire(w);const event=w.snapshot().events.findLast(e=>e.type==='fire'),shot=w.snapshot().projectiles[0];
    check('actual ramp pitch rotates 3D muzzle and projectile direction',onRamp&&event.direction.y>0.2&&event.position.y>before.position.y+0.7&&shot.velocity.y>20);
  }finally{w.dispose();}
}

{
  const w=armed('pulse');try {
    for(let shot=0;shot<10;shot++){fire(w);step(w,9);}
    const remaining=kart(w,'b').respawn,seq=w.snapshot('b').you;
    w.setConnected('b',false);step(w,180);
    check('offline KO countdown and corpse stay frozen',!kart(w,'b').alive&&kart(w,'b').respawn===remaining);
    w.setConnected('b',true);step(w,125);
    check('reconnected KO resumes safe respawn with fresh control life',kart(w,'b').alive&&kart(w,'b').spawnSeq>seq.life&&w.snapshot('b').you.controlEpoch>seq.controlEpoch);
    const protection=kart(w,'b').shield;w.setConnected('b',false);step(w,60);check('offline protection timer freezes rather than expiring',kart(w,'b').shield===protection);
  }finally{w.dispose();}
  const empMap=fixture([],[point('a',0,0,0),point('b',0,0,7)]),emp=armed('emp',empMap),ordinary=armed('emp',empMap);
  try{
    fire(emp);step(ordinary);
    for(const w of [emp,ordinary])step(w,70,i=>{if(i%20===0)send(w,'b',{throttle:1,nitro:true});});
    const slowed=kart(emp,'b'),normal=kart(ordinary,'b');measurements.empNitroSpeed=slowed.pose.speed;measurements.ordinaryNitroSpeed=normal.pose.speed;
    check('EMP applies after Nitro to real physical speed',slowed.empT>0&&slowed.pose.speed<normal.pose.speed*.85&&slowed.pose.speed>3&&slowed.nitroActive&&normal.nitroActive);
  }finally{emp.dispose();ordinary.dispose();}
}

{
  const wall={id:'pickup-wall',shape:'box',half:{x:0.1,y:1.5,z:5},position:{x:1.6,y:1.5,z:0}};
  const map=fixture([wall],[point('a',0,0,0),point('b',-10,0,10)],[point('s0',2.2,0,0),point('s1',2.3,0,0)]),w=create(map);
  try{step(w,60);check('same-layer pickup cannot pass through finite cover',kart(w).weapon===null);}finally{w.dispose();}
}

{
  const w=create();try{step(w);const one=w.snapshot();step(w,6);const unchanged=w.snapshot();w.advance(unchanged.serverAt);check('duplicate time pump has no physics combat or timer effect',JSON.stringify(unchanged)===JSON.stringify(w.snapshot()));check('another instance preserves independent sequence and physics worlds',one.instance===unchanged.instance);}finally{w.dispose();}
  const a=create(),b=create();try{step(a);step(b);const frozen=JSON.stringify(b.snapshot());send(a,'a',{throttle:1});step(a,50);check('combat worlds share no mutable RNG events bodies or clocks',JSON.stringify(b.snapshot())===frozen);a.dispose();step(b,30);check('disposing one combat leaves the other playable',!b.stats().disposed&&b.stats().physics.karts===2);}finally{a.dispose();b.dispose();}
  let fail=false,freed=0;
  class FailingWorld extends RAPIER.World {step(...v){super.step(...v);if(fail)throw new Error('injected post-step failure');}free(){freed++;super.free();}}
  const wfail=createElevatedCombat({...RAPIER,World:FailingWorld},CONFIG,fixture(),[{id:'a'},{id:'b'}],{instance:'fail-closed',seed:1,startAt:0,countdownMs:0,roundMs:10000,crates:1});
  fail=true;throws('partial simulation failure retires authority instead of replaying tick',()=>wfail.advance(20));check('failed combat frees exact world once and clears private entities',wfail.stats().disposed&&freed===1&&wfail.stats().physics.karts===0);wfail.dispose();check('failed disposal remains idempotent',freed===1);
  throws('one driver is not a combat match',()=>create(fixture(),{},[{id:'a'}]));
  throws('duplicate seats and unbounded seats are rejected',()=>create(fixture(),{},[{id:'a'},{id:'a'}]));
  const bad=fixture();bad.spawns[0].y=30;throws('unsupported spawn cannot start a match',()=>create(bad));
  const bs=fixture();bs.sockets[0].y=30;throws('unsupported crate sockets cannot start a match',()=>create(bs));
  const overlap=fixture();overlap.spawns[1].z=1;throws('initial chassis overlap cannot start a match',()=>create(overlap));
  const duplicate=fixture();duplicate.sockets[1].id=duplicate.sockets[0].id;throws('duplicate authored socket identities are rejected',()=>create(duplicate));
}

{
  // Exact legal intent stream from the read-only Garden reproduction. No body
  // reset, grant, rotation, impulse or hit hook is used to create the stuck kart.
  // Preserve the full recorded physics: different chassis/contact tuning
  // need not produce this historical seed's specific sideways collision.
  const map=elevatedMap('garden'),seats=Array.from({length:8},(_,i)=>({id:'p'+i})),awards=[];
  const w=create(map,{seed:3,roundMs:90000,crates:6,onAward:(...v)=>awards.push(v)},seats,recordedPhysics,recordedRapier);
  let rng=3*2654435761>>>0,intents=[],event=null,before=null,after=null,previousSeconds=0,coinsBefore=0,coinsAfter=0,awardCount=0,queued=false;
  const random=()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return(rng>>>0)/4294967296;};
  try {
    for(let i=0;i<3600&&!event;i++) {
      if(i%120===0)intents=seats.map(()=>({steer:random()<0.45?0:random()*2-1,throttle:random()<0.08?-1:1,nitro:true}));
      if(i%6===0)for(let p=0;p<8;p++)send(w,'p'+p,intents[p]);
      before=kart(w,'p7');previousSeconds=w.stats().recovery.find(k=>k.id==='p7').stuckSeconds;
      // A later-received action is still queued when recovery changes life.
      if(previousSeconds>1.98&&!queued) {send(w,'p7',{use:true},w.snapshot().serverAt+500);queued=true;}
      coinsBefore=w.snapshot('p7').you.coins;awardCount=awards.filter(v=>v[0]==='p7').length;
      step(w);event=w.snapshot().events.find(e=>e.type==='recover'&&e.pid==='p7'&&e.tick===w.snapshot().simTick);
    }
    after=kart(w,'p7');coinsAfter=w.snapshot('p7').you.coins;
    check('legal Garden seed3 sideways kart recovers before the old tick3003 lock',!!event&&event.tick<3003&&upDot(before.pose)<0.35&&before.pose.wheels.some(v=>v.contact));
    check('sideways recovery requires two consecutive seconds of stopped supported physics',previousSeconds>1.98&&previousSeconds<2&&Math.hypot(...Object.values(before.pose.linearVelocity))<0.5&&Math.hypot(...Object.values(before.pose.angularVelocity))<0.5);
    check('recovery emits one distinct epoch event and keeps the live kart alive',event.reason==='stuck'&&event.spawnSeq===before.spawnSeq+1&&event.controlEpoch===before.controlEpoch+1&&after.spawnSeq===event.spawnSeq&&after.controlEpoch===event.controlEpoch&&after.alive&&after.respawn===0);
    check('recovery preserves KO death and wallet without awarding an escape',after.hits===before.hits&&after.deaths===before.deaths&&coinsAfter===coinsBefore&&awards.filter(v=>v[0]==='p7').length===awardCount);
    check('recovery clears item without granting shield or full Nitro',after.weapon===null&&after.ammo===0&&after.shield===0&&after.nitro<=before.nitro+CONFIG.fixedDt*0.15&&after.nitro<0.5&&!after.nitroActive);
    check('recovery uses a clear authored support and upright neutral pose',map.spawns.some(s=>s.x===after.pose.position.x&&s.z===after.pose.position.z&&s.y+1===after.pose.position.y)&&upDot(after.pose)===1&&Math.hypot(...Object.values(after.pose.linearVelocity))===0);
    check('recovery discards queued future Use and retires its life/control epoch',queued&&w.stats().queuedInputs===0&&!w.input('p7',{instance:w.snapshot().instance,life:before.spawnSeq,controlEpoch:before.controlEpoch,seq:w.snapshot('p7').you.receivedSeq+1,steer:0,throttle:1,brake:0,nitro:false,use:true},w.snapshot().serverAt).ok);
    const relocated={...after.pose.position};step(w,420);
    const settled=kart(w,'p7'),counter=w.stats().recovery.find(k=>k.id==='p7');
    check('recovered kart settles on real support without replaying old input or fire',settled.pose.grounded&&settled.pose.wheels.filter(v=>v.contact).length===4&&Math.hypot(settled.pose.position.x-relocated.x,settled.pose.position.z-relocated.z)<0.02&&w.snapshot().projectiles.length===0);
    check('upright recovery resets the stuck counter and five-second cooldown expires quietly',counter.stuckSeconds===0&&Math.abs(counter.cooldownUntil-event.tick*CONFIG.fixedDt*1000-5000)<1e-6&&w.snapshot().serverAt>counter.cooldownUntil&&w.snapshot().events.filter(e=>e.type==='recover'&&e.pid==='p7').length===1);
    send(w,'p7',{throttle:1});step(w,60);
    check('fresh post-recovery input can drive the new life normally',Math.hypot(kart(w,'p7').pose.position.x-relocated.x,kart(w,'p7').pose.position.z-relocated.z)>2&&kart(w,'p7').spawnSeq===after.spawnSeq);
    check('recovery counters and retry internals stay outside every player projection',!Object.hasOwn(w.snapshot(),'recovery')&&!Object.hasOwn(w.snapshot('p7').karts[7],'stuck')&&!Object.hasOwn(w.snapshot('watcher'),'recovery'));
    measurements.sidewaysRecovery={mapId:'garden',intentSeed:3,eventTick:event.tick,beforeUp:upDot(before.pose),beforeContacts:before.pose.wheels.filter(v=>v.contact).length,previousStuckSeconds:previousSeconds,event,walletPreserved:coinsBefore===coinsAfter};
  } finally {w.dispose();}
}

{
  // Historical physics reproduces a narrow physical ramp that rolls the kart through a brief stopped tilt, then
  // actual collision/drive motion resumes. The partial timer must be discarded.
  const ramp={id:'edge-ramp',shape:'wedge',half:{x:1.4,y:1.5,z:6},position:{x:0,y:1.5,z:0}};
  const w=create(fixture([ramp],[point('a',1.5,0,-20),point('b',-12,0,-22)],[point('s0',-20,0,-20),point('s1',-20,0,20)]),{roundMs:20000},undefined,recordedPhysics,recordedRapier);
  let reset=null,previousSeconds=0;
  try {
    for(let i=0;i<260&&!reset;i++) {
      if(i%6===0)send(w,'a',{throttle:1,nitro:true});
      previousSeconds=w.stats().recovery[0].stuckSeconds;step(w);const p=kart(w).pose,c=w.stats().recovery[0];
      if(previousSeconds>0&&c.stuckSeconds===0&&upDot(p)<0.35&&Math.hypot(...Object.values(p.linearVelocity))>0.5)reset={tick:w.snapshot().simTick,previousSeconds,position:p.position,speed:Math.hypot(...Object.values(p.linearVelocity))};
    }
    check('renewed physical movement clears a partially accumulated sideways timer',!!reset&&reset.previousSeconds>0.2&&reset.previousSeconds<2&&w.snapshot().events.every(e=>e.type!=='recover')&&kart(w).spawnSeq===0);
    step(w,118,i=>{if(i%6===0)send(w,'a',{throttle:1,nitro:true});});
    check('partial sideways time cannot carry across motion into an early recovery',w.snapshot().events.every(e=>e.type!=='recover')&&kart(w).spawnSeq===0);
    step(w,320,i=>{if(i%6===0)send(w,'a',{throttle:0});});
    check('a physically righted kart keeps the counter reset while stationary',upDot(kart(w).pose)>0.99&&w.stats().recovery[0].stuckSeconds===0&&kart(w).spawnSeq===0&&w.snapshot().events.every(e=>e.type!=='recover'));
    measurements.recoveryMovementReset=reset;
  } finally {w.dispose();}
}

{
  // Replay with historical physics: two legal floor spawns are initially four units apart. The rival drives
  // between them and brakes, physically blocking both recovery footprints.
  const map=elevatedMap('garden'),original=map.spawns[7];
  map.spawns=[original,{...original,id:'blocker',x:-6,z:-52}];
  const w=create(map,{seed:3,roundMs:90000,crates:6},[{id:'p7'},{id:'b'}],recordedPhysics,recordedRapier);
  let rng=3*2654435761>>>0,intent=null,parked=false,retries=[],retryAt=0;
  const random=()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return(rng>>>0)/4294967296;};
  try {
    for(let i=0;i<3300;i++) {
      if(i%120===0)intent=Array.from({length:8},()=>({steer:random()<0.45?0:random()*2-1,throttle:random()<0.08?-1:1,nitro:true}))[7];
      if(i%6===0){send(w,'p7',intent);parked ||= kart(w,'b').pose.position.z>-50.6;send(w,'b',{throttle:parked?0:1,brake:parked?1:0});}
      step(w);const r=w.stats().recovery[0];if(r.retryAt&&r.retryAt!==retryAt){retryAt=r.retryAt;retries.push({tick:w.snapshot().simTick,retryAt});}
    }
    const blocked=kart(w,'p7'),waiting=w.stats().recovery[0];
    check('crowded supported spawns defer recovery without overlap or life change',upDot(blocked.pose)<0.1&&waiting.stuckSeconds>5&&blocked.spawnSeq===0&&blocked.alive&&w.snapshot().events.every(e=>e.type!=='recover'));
    check('crowded recovery queries retry at most twice per second',retries.length>=5&&retries.length<12&&retries.slice(1).every((v,i)=>v.retryAt-retries[i].retryAt>=500-1e-6));
    let recovered=null;
    for(let i=0;i<120&&!recovered;i++){if(i%6===0)send(w,'b',{throttle:1});step(w);recovered=w.snapshot().events.find(e=>e.type==='recover'&&e.pid==='p7');}
    const self=kart(w,'p7'),rival=kart(w,'b');
    check('clearing an actual rival footprint lets one bounded retry recover safely',!!recovered&&self.spawnSeq===1&&upDot(self.pose)>0.99&&Math.hypot(self.pose.position.x-rival.pose.position.x,self.pose.position.y-rival.pose.position.y,self.pose.position.z-rival.pose.position.z)>=2.5);
    step(w,120);
    check('crowded retry callbacks do not duplicate the successful recovery',w.snapshot().events.filter(e=>e.type==='recover'&&e.pid==='p7').length===1&&kart(w,'p7').spawnSeq===1&&kart(w,'p7').deaths===0);
    measurements.crowdedRecovery={retryTicks:retries.map(v=>v.tick),event:recovered,waitingSeconds:waiting.stuckSeconds};
  } finally {w.dispose();}
}

for(const id of elevatedMapIds) {
  const w=create(elevatedMap(id),{roundMs:12000,crates:6},Array.from({length:8},(_,i)=>({id:'p'+i})));
  try {
    step(w);
    check(id+' supports eight seats and randomized supported crate subset',w.snapshot().karts.length===8&&w.snapshot().crates.length===6&&new Set(w.snapshot().crates.map(c=>c.position.x+','+c.position.y+','+c.position.z)).size===6);
    const samples=[],cpuStart=process.cpuUsage(),initialTick=w.stats().physics.tick;
    for(let i=0;i<600;i++) {
      if(i%20===0)for(let p=0;p<8;p++)send(w,'p'+p,{throttle:i<200?0:1,steer:i<200?0:(p%2?0.3:-0.3),nitro:i>=400});
      const now=w.snapshot().serverAt+CONFIG.fixedDt*1000,start=performance.now();w.advance(now);samples.push(performance.now()-start);
    }
    const cpu=process.cpuUsage(cpuStart),bytes=Buffer.byteLength(JSON.stringify(w.snapshot()));samples.sort((a,b)=>a-b);
    check(id+' benchmark executes exactly 600 fixed physical steps',w.stats().physics.tick-initialTick===600);
    measurements[id]={fixedSteps:600,advanceProcessingMs:{median:samples[300],p95:samples[570],max:samples.at(-1)},cpuLoopMs:(cpu.user+cpu.system)/1000,snapshotBytes:bytes,
      scope:'Node24 isolated one-instance authority advance includes projection; neutral200/drive200/Nitro200; initialization excluded; CPU loop includes legal input preparation, no network/phone measurement'};
    step(w,125);
    check(id+' eight-driver real combat deadline remains finite',w.snapshot().phase==='done'&&wireFinite(w.snapshot())&&w.result().scores.length===8);
  }finally{w.dispose();}
}
{
  const spawns=Array.from({length:8},(_,i)=>point('p'+i,[-18,-6,6,18][i%4],0,i<4?-12:12,i<4?0:Math.PI));
  const sockets=spawns.flatMap((s,i)=>[point('s'+i+'a',s.x-0.7,0,s.z),point('s'+i+'b',s.x+0.7,0,s.z)]);
  const seats=spawns.map(s=>({id:s.id})),w=create(fixture([],spawns,sockets),{seed:42,roundMs:12000,crates:8},seats);
  try {
    step(w);const samples=[],cpuStart=process.cpuUsage(),initialTick=w.stats().physics.tick;let pickup=0,spend=0,ko=0,lastEvent=0,maxBytes=0,maxShots=0;
    for(let i=0;i<600;i++) {
      if(i%20===0)for(const s of seats){if(kart(w,s.id).alive){send(w,s.id,{throttle:i<90?0:1,steer:i>=250?0.2:0,nitro:i>=300,use:true});send(w,s.id,{throttle:i<90?0:1,steer:i>=250?0.2:0,nitro:i>=300,use:false});}}
      const now=w.snapshot().serverAt+CONFIG.fixedDt*1000,start=performance.now(),view=w.advance(now);samples.push(performance.now()-start);
      for(const e of view.events){const n=Number(e.id.split('-e').at(-1));if(n<=lastEvent)continue;pickup+=e.type==='pickup';spend+=['fire','mine','shield'].includes(e.type);ko+=e.type==='ko';lastEvent=n;}
      maxBytes=Math.max(maxBytes,Buffer.byteLength(JSON.stringify(view)));maxShots=Math.max(maxShots,view.projectiles.length);
      assert.ok(view.projectiles.length<=64&&view.mines.length<=16&&view.grenades.length<=12&&view.events.length<=32&&wireFinite(view));
    }
    const cpu=process.cpuUsage(cpuStart);samples.sort((a,b)=>a-b);
    measurements.activeWeapons={fixedSteps:600,pickups:pickup,spends:spend,knockouts:ko,maxShots,maxSnapshotBytes:maxBytes,advanceProcessingMs:{median:samples[300],p95:samples[570],max:samples.at(-1)},cpuLoopMs:(cpu.user+cpu.system)/1000,
      scope:'Diagnostic eight-seat legal collect/use workload; same real authority and adapter, no grant/hit/teleport hooks; initialization excluded; no network/phone performance claim'};
    check('eight-seat active arsenal uses real pickups and bounded entities',pickup>0&&spend>0&&maxShots>0);
    check('active arsenal benchmark executes exactly 600 fixed physical steps',w.stats().physics.tick-initialTick===600);
    check('eight-seat active arsenal confirms KOs without invalid state',ko>0&&w.snapshot().karts.some(k=>k.hits>0));
    step(w,125);check('eight-seat active arsenal completes a real deadline result',w.snapshot().phase==='done'&&w.result().scores.length===8);
  }finally{w.dispose();}
}

{
  // Score target (GAME_RULES_STANDARD): the knockout that reaches it ends the
  // match early with reason 'target', well before the round deadline.
  const w=armed('rail',fixture(),{initialHealth:1,targetHits:1});
  try {
    const deadline=w.snapshot().deadline;fire(w);step(w,8);
    check('score target ends the elevated match at the reaching knockout',w.snapshot().phase==='done'&&w.result().reason==='target');
    check('score target result is stamped at the knockout, not the deadline',w.result().endedAt<deadline&&w.result().winners.join()==='a');
    step(w,20);check('a finished score-target match never scores again',kart(w).hits===1);
  }finally{w.dispose();}
  throws('score target must be a positive integer',()=>create(fixture(),{targetHits:0}));
}
{
  // Leaving: a dropped driver leaves the arena for good; the others play on.
  const seats=[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}];
  const w=create(fixture([],[point('a',0,0,0),point('b',0,0,10,Math.PI),point('c',8,0,0)]),{},seats);
  try {
    step(w,5);
    check('drop removes a driver once',w.drop('c')===true&&w.drop('c')===false);
    const c=kart(w,'c');
    check('dropped kart is out, offline and off the field',c.out===true&&c.connected===false&&c.alive===false);
    check('dropped driver cannot reconnect or steer',w.setConnected('c',true)===false&&!send(w,'c').ok);
    check('two drivers left keep playing',w.snapshot().phase==='live');
    step(w,3);check('dropped kart never respawns',!kart(w,'c').alive&&kart(w,'c').respawn===0);
    check('one driver left ends the match at once',w.drop('b')===true&&w.snapshot().phase==='done'&&w.result().reason==='players-left');
    const scores=w.result().scores;
    check('result keeps dropped drivers, flagged out, and only the last driver wins',scores.length===3&&scores.filter(s=>s.out).map(s=>s.id).join()==='b,c'&&w.result().winners.join()==='a');
  }finally{w.dispose();}
}
console.log(JSON.stringify({pass:true,checks:results.length,results,measurements,rapierVersion:RAPIER.version()},null,2));
