'use strict';

// Elevated combat authority used by the opt-in Room profile.
// Caller initializes Rapier once, injects the shared numeric config and authored
// elevated map, and supplies server receipt/advance times (never client clocks).
const { createKartPhysics } = require('./kart-physics');
const B = require('./kart-rules-battle').constants;
const H = require('./kart-engine').constants;
const {config:COMBAT,damageAt} = require('./kart-combat-config');
const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });
const IDENTITY = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
const LIMIT = Object.freeze({ queue: 32, seq: 0x7fffffff, seqJump: 4096, events: 32, steps: 15, activationMs:8000 });
const RECOVERY = Object.freeze({ up: 0.35, linear: 0.5, angular: 0.5, progress: 0.3, seconds: 2, retryMs: 500, cooldownMs: 5000 });
// Elevated arsenal; the established flat rules keep their original pool.
const ARSENAL = Object.freeze({
  weights:Object.freeze({pulse:16,scatter:10,mine:10,shield:10,rocket:10,rail:6,grenade:7,emp:6,seeker:7,bomb:6,proximity:4,spikes:4,sentry:3,nuke:1}),
  pulse:Object.freeze({ammo:COMBAT.weapons.pulse.ammo,cooldown:COMBAT.weapons.pulse.cooldown,speed:140}),
  spikes:Object.freeze({duration:5,radius:COMBAT.weapons.spikes.radius}),
  sentry:Object.freeze({duration:9,rounds:COMBAT.weapons.sentry.rounds,range:COMBAT.weapons.sentry.range,cooldown:.45,max:8}),
  nuke:Object.freeze({speed:16,launchY:5,fuse:3.5,radius:.5,friction:2,splashRadius:COMBAT.weapons.nuke.splashRadius,warning:1.2}),
  proximity:Object.freeze({speed:12,launchY:6,radius:COMBAT.weapons.proximity.bodyRadius,friction:4,splashRadius:COMBAT.weapons.proximity.splashRadius}),
  seeker:Object.freeze({speed:60,ttl:2.4,range:45,halfAngle:35*Math.PI/180,turnRate:2.6,splashRadius:COMBAT.weapons.seeker.splashRadius}),
  bomb:Object.freeze({speed:12,launchY:6,radius:COMBAT.weapons.bomb.bodyRadius,friction:4,splashRadius:COMBAT.weapons.bomb.splashRadius}),
});
const finite = Number.isFinite;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const add = (a,b) => ({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
const sub = (a,b) => ({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const mul = (a,n) => ({x:a.x*n,y:a.y*n,z:a.z*n});
const dot = (a,b) => a.x*b.x+a.y*b.y+a.z*b.z;
const cross = (a,b) => ({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const length = a => Math.hypot(a.x,a.y,a.z);
const distance = (a,b) => length(sub(a,b));
const lerp = (a,b,t) => add(a,mul(sub(b,a),t));
const neutral = () => ({steer:0,throttle:0,brake:0,nitro:false,use:false});
const proximityCharge = weapon => weapon==='bomb'||weapon==='proximity';
function rotate(v,q) {
  const t = {x:2*(q.y*v.z-q.z*v.y),y:2*(q.z*v.x-q.x*v.z),z:2*(q.x*v.y-q.y*v.x)};
  return {x:v.x+q.w*t.x+q.y*t.z-q.z*t.y,y:v.y+q.w*t.y+q.z*t.x-q.x*t.z,z:v.z+q.w*t.z+q.x*t.y-q.y*t.x};
}
function validId(v) { return typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v); }
function boundedTime(v) { return typeof v === 'number' && finite(v) && v >= 0 && v <= 1e15; }
function hull(p) { return add(p.position,rotate({x:0,y:0.35,z:0},p.rotation)); }
// Existing 1.7u combat hit radius, now a real 3D sphere centred 0.35u above
// chassis centre. Static sweeps use the measured projectile art envelopes.
// Relative target displacement prevents a moving hull crossing a fast shot.
function hullImpact(from,to,a,b,radius) {
  const p = sub(from,a), d = sub(sub(to,from),sub(b,a));
  const c = dot(p,p)-radius*radius;
  if (c <= 0) return 0;
  const aa=dot(d,d), bb=2*dot(p,d), disc=bb*bb-4*aa*c;
  if (aa < 1e-12 || disc < 0) return null;
  const t=(-bb-Math.sqrt(disc))/(2*aa);
  return t >= 0 && t <= 1 ? t : null;
}
function guidedVelocity(velocity,delta,maxTurn) {
  const speed=length(velocity),range=length(delta);
  if(speed<1e-8 || range<1e-8) return velocity;
  const direction=mul(velocity,1/speed),desired=mul(delta,1/range),cos=clamp(dot(direction,desired),-1,1),angle=Math.acos(cos);
  if(angle<=maxTurn) return mul(desired,speed);
  let perpendicular=sub(desired,mul(direction,cos)),n=length(perpendicular);
  if(n<1e-8) {perpendicular=cross(direction,Math.abs(direction.y)<.9?{x:0,y:1,z:0}:{x:1,y:0,z:0});n=length(perpendicular);}
  return mul(add(mul(direction,Math.cos(maxTurn)),mul(perpendicular,Math.sin(maxTurn)/n)),speed);
}

function createElevatedCombat(RAPIER,config,map,seats,options={}) {
  if (!Array.isArray(seats) || seats.length < 2 || seats.length > 8 || seats.some(s => !validId(s?.id)) || new Set(seats.map(s=>s.id)).size !== seats.length) throw new TypeError('2..8 unique seats required');
  const instance = options.instance;
  if (!validId(instance) || !Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff) throw new TypeError('server instance and uint32 seed required');
  const startAt = options.startAt ?? 0, countdownMs = options.countdownMs ?? H.COUNTDOWN_MS, roundMs = options.roundMs ?? 90000;
  // Diagnostic constructors can start wounded to isolate a sweep/KO contract.
  // The production adapter never forwards this option from Room or settings.
  const initialHealth=options.initialHealth??COMBAT.maxHealth;
  // Optional score target: the first knockout that reaches it ends the match.
  const targetHits=options.targetHits??null;
  if(targetHits!==null&&(!Number.isInteger(targetHits)||targetHits<1||targetHits>100))throw new RangeError('invalid score target');
  if(!Number.isInteger(initialHealth)||initialHealth<1||initialHealth>COMBAT.maxHealth)throw new RangeError('invalid initial health');
  if (!boundedTime(startAt) || !finite(countdownMs) || countdownMs < 0 || countdownMs > 10000 || !finite(roundMs) || roundMs < 1000 || roundMs > 600000) throw new RangeError('invalid round timing');
  const M = structuredClone(map), C = structuredClone(config);
  if (!validId(M?.id) || typeof M.revision !== 'string' || !M.revision.length || M.revision.length > 64 || !finite(M.half) || M.half < 10 || M.half > 500 || !Array.isArray(M.colliders) || !Array.isArray(M.spawns) || M.spawns.length < seats.length || M.spawns.length > 32 || !Array.isArray(M.sockets) || M.sockets.length < 2 || M.sockets.length > 64 || new Set(M.spawns.map(s=>s.id)).size!==M.spawns.length || new Set(M.sockets.map(s=>s.id)).size!==M.sockets.length) throw new TypeError('bounded authored map required');
  const physics = createKartPhysics(RAPIER,C), dt=C.fixedDt, stepMs=dt*1000;
  const karts = new Map(), events=[], shots=[], mines=[], grenades=[], sentries=[], crates=[], collisionAt=new Map(), spikeAt=new Map(), scatterHits=new Map();
  let targetReached=false, rng=options.seed, eventSeq=0, entitySeq=0, phase='countdown', simTick=0, simAt=startAt, wallAt=startAt, accumulator=0, resultData=null, disposed=false, droppedMs=0;
  const liveAt=startAt+countdownMs, deadline=liveAt+roundMs;
  const rand = () => { rng=(rng+0x6d2b79f5)>>>0; let n=rng; n=Math.imul(n^(n>>>15),n|1); n^=n+Math.imul(n^(n>>>7),n|61); return ((n^(n>>>14))>>>0)/4294967296; };
  const choose = list => list[Math.floor(rand()*list.length)];
  const entity = prefix => prefix+(++entitySeq);
  function alive() { if (disposed) throw new Error('combat instance disposed'); }
  function emit(type,pid,extra={}) { events.push({...extra,id:instance+'-e'+(++eventSeq),tick:simTick,type,pid}); if(events.length>LIMIT.events) events.shift(); }
  function award(k,amount,key) {
    k.coins+=amount;
    // One call per confirmed authority transition; failure never replays award.
    if(typeof options.onAward==='function') { try { options.onAward(k.id,amount,instance+'-'+key); } catch {} }
  }
  function clean(k) { if(k.sequence){k.weapon=null;k.ammo=0;}k.input=neutral(); k.queue.length=0; k.pendingFire=false; k.pendingFireAt=null; k.useDown=false; k.lastInputAt=null; k.nitroActive=false; k.sequence=null; k.stuck=null; }
  function supported(point) {
    if(!point || !validId(point.id) || !validId(point.surface) || ![point.x,point.y,point.z,point.angle].every(finite) || Math.abs(point.x)>M.half-2 || Math.abs(point.z)>M.half-2 || Math.abs(point.angle)>2*Math.PI) return false;
    const s=physics.supportAt({x:point.x,y:point.y+0.4,z:point.z},0.8);
    return s?.surfaceId===point.surface && Math.abs(s.point.y-point.y)<0.04 && s.normal.y>0.65;
  }
  const spawnPose = s => ({position:{x:s.x,y:s.y+1,z:s.z},rotation:{x:0,y:Math.sin(s.angle/2),z:0,w:Math.cos(s.angle/2)}});
  const chassisShape=new RAPIER.Cuboid(C.chassis.half.x,C.chassis.half.y,C.chassis.half.z);
  const hullsOverlap=(a,b)=>chassisShape.intersectsShape(a.position,a.rotation,chassisShape,b.position,b.rotation);
  function legalSpawn(s) {
    if(!supported(s)) return false;
    const p=spawnPose(s);
    if(physics.overlapsStatic(p.position,p.rotation)) return false;
    return C.wheels.every(w => {
      const v=add({x:s.x,y:s.y+0.4,z:s.z},rotate({x:w.x,y:0,z:w.z},p.rotation));
      const support=physics.supportAt(v,0.8);
      return support && Math.abs(support.point.y-s.y)<0.15 && support.normal.y>0.65;
    });
  }
  let spawns,sockets;
  function pickSocket(exclude) {
    let pool=sockets.filter(s=>s.id!==exclude && !crates.some(c=>c.socketId===s.id));
    if(!pool.length) return null;
    const positions=[...karts.values()].filter(k=>k.alive).map(k=>physics.pose(k.id).position);
    const far=pool.filter(s=>positions.every(p=>distance(p,{x:s.x,y:s.y+0.6,z:s.z})>=5));
    if(far.length) pool=far;
    return choose(pool);
  }
  function crateAt(socket) { return {id:entity('c'),socketId:socket.id,surfaceId:socket.surface,position:{x:socket.x,y:socket.y+0.6,z:socket.z},availableAt:simAt}; }
  function rollWeapon() { let edge=0; const r=rand()*100; for(const [id,weight] of Object.entries(ARSENAL.weights)) { edge+=weight; if(r<edge) return id; } return 'nuke'; }
  try {
    for(const d of M.colliders) physics.addStatic(d);
    spawns=M.spawns.filter(legalSpawn);
    sockets=M.sockets.filter(s=>supported(s) && !physics.sweepStatic({x:s.x,y:s.y+0.65,z:s.z},{x:s.x,y:s.y+0.65,z:s.z},0.45));
    if(spawns.length < seats.length || sockets.length < 2) throw new Error('map lacks supported clear spawns/sockets');
    for(let i=0;i<seats.length;i++) for(let j=0;j<i;j++) if(hullsOverlap(spawnPose(spawns[i]),spawnPose(spawns[j]))) throw new Error('initial spawn hulls overlap');
    for(let i=0;i<seats.length;i++) {
      const s=seats[i], k={id:s.id,name:String(s.name||s.id).slice(0,48),connected:true,alive:true,spawnSeq:0,controlEpoch:0,
        input:neutral(),queue:[],receivedSeq:0,appliedSeq:0,lastReceipt:startAt,lastInputAt:null,pendingFire:false,useDown:false,
        hits:0,deaths:0,coins:0,health:initialHealth,maxHealth:COMBAT.maxHealth,weapon:null,ammo:0,itemSeq:0,sequence:null,shield:B.SPAWN_SHIELD,ramT:0,spikesT:0,respawn:0,fireCd:0,empT:0,nitro:1,nitroLocked:false,nitroActive:false,stuck:null,recoverAfter:0};
      karts.set(k.id,k); physics.addKart(k.id,spawnPose(spawns[i]));
    }
    physics.step(15); physics.step(15); physics.step(15); physics.step(15); physics.step(15); physics.step(15);
    for(const k of karts.values()) physics.freezeKart(k.id,true);
    const count=options.crates ?? Math.min(6,sockets.length-1);
    if(!Number.isInteger(count) || count<1 || count>=sockets.length || count>12) throw new RangeError('invalid crate subset size');
    for(let i=0;i<count;i++) { const s=pickSocket(); if(s) crates.push(crateAt(s)); }
  } catch(error) { physics.dispose(); throw error; }

  function input(pid,p,receiptAt) {
    alive(); const k=karts.get(pid);
    if(!k || !k.connected || !k.alive || phase==='done') return {ok:false,reason:'inactive seat'};
    if(!p || p.instance!==instance || p.life!==k.spawnSeq || p.controlEpoch!==k.controlEpoch) return {ok:false,reason:'stale instance or life'};
    if(!Number.isInteger(p.seq) || p.seq<=k.receivedSeq || p.seq>LIMIT.seq || p.seq-k.receivedSeq>LIMIT.seqJump) return {ok:false,reason:'duplicate or out-of-window sequence'};
    if(!boundedTime(receiptAt) || receiptAt<k.lastReceipt || receiptAt<wallAt-H.INPUT_TTL_MS || receiptAt>wallAt+H.INPUT_TTL_MS) return {ok:false,reason:'stale server receipt'};
    if(!['steer','throttle','brake'].every(key=>typeof p[key]==='number' && finite(p[key])) || typeof p.nitro!=='boolean' || typeof p.use!=='boolean' || Object.keys(p).some(key=>!['instance','life','controlEpoch','seq','steer','throttle','brake','nitro','use'].includes(key))) return {ok:false,reason:'invalid intent'};
    if(k.queue.length>=LIMIT.queue) return {ok:false,reason:'input queue full'};
    const v={steer:clamp(p.steer,-1,1),throttle:clamp(p.throttle,-1,1),brake:clamp(p.brake,0,1),nitro:p.nitro,use:p.use};
    const fire=p.use&&!k.useDown && !!k.weapon && !k.sequence && receiptAt>=liveAt && receiptAt<deadline;
    k.useDown=p.use; k.receivedSeq=p.seq; k.lastReceipt=receiptAt;
    k.queue.push({seq:p.seq,at:receiptAt,value:v,fire,item:k.itemSeq});
    return {ok:true,receivedSeq:k.receivedSeq};
  }
  function setConnected(pid,connected) {
    alive(); const k=karts.get(pid);
    if(!k || typeof connected!=='boolean') return false;
    if(k.out) return !connected; // a dropped driver never rejoins this match
    if(k.connected===connected) return true;
    clean(k); k.controlEpoch++; k.connected=connected;
    physics.freezeKart(pid,!connected || phase!=='live' || !k.alive);
    emit(connected?'reconnect':'disconnect',pid);
    return true;
  }
  // A driver who left (or stayed away 60 s) drops out: the kart leaves the
  // arena for good, keeps its knockouts on the board and ranks last. When
  // fewer than two drivers remain the match ends at once.
  function drop(pid) {
    alive();const k=karts.get(pid);
    if(!k || k.out || phase==='done') return false;
    clean(k);k.controlEpoch++;
    k.out=true;k.connected=false;k.alive=false;k.respawn=0;k.weapon=null;k.ammo=0;k.shield=0;k.ramT=0;k.spikesT=0;k.empT=0;
    physics.freezeKart(pid,true);physics.setKartEnabled(pid,false);
    emit('dropout',pid);
    if([...karts.values()].filter(v=>!v.out).length<2) finish('players-left');
    return true;
  }
  function vulnerable(k) { return k.alive && k.connected && k.shield<=0; }
  // Rapier's zero-displacement shape cast skips initial overlaps. A micron
  // query retains the exact sphere test while detecting blocked launch space.
  function sphereBlocked(position,radius) {return !!physics.sweepStatic(position,add(position,{x:0,y:1e-6,z:0}),radius);}
  function los(a,b) { const d=sub(b,a), n=length(d); if(n<0.001) return true; const start=add(a,mul(d,Math.min(0.01/n,0.01))); const h=physics.sweepStatic(start,b); return !h || h.fraction>=1-1e-6; }
  function knockOut(k,owner,weapon) {
    if(!vulnerable(k) || k.id===owner) return false;
    k.alive=false; k.health=0; k.deaths++; k.respawn=B.RESPAWN_TIME; k.weapon=null; k.ammo=0; k.shield=0; k.ramT=0; k.spikesT=0; k.fireCd=0; k.empT=0; clean(k); k.controlEpoch++;
    physics.freezeKart(k.id,true); physics.setKartEnabled(k.id,false);
    const scorer=karts.get(owner); if(scorer) { scorer.hits++; award(scorer,B.COIN_KO,'ko-'+k.id+'-'+k.deaths); if(targetHits!==null&&scorer.hits>=targetHits) targetReached=true; }
    emit('ko',owner,{other:k.id,weapon,position:physics.pose(k.id).position});
    return true;
  }
  function damage(k,owner,weapon,amount=damageAt(weapon),volley=null) {
    if(!vulnerable(k) || k.id===owner || !finite(amount) || amount<=0) return false;
    if(volley) {
      let hits=scatterHits.get(volley);if(!hits)scatterHits.set(volley,hits=new Map());
      const dealt=hits.get(k.id)||0;amount=Math.min(amount,COMBAT.weapons.scatter.maxShotDamage-dealt);
      if(amount<=0)return false;hits.set(k.id,dealt+amount);
    }
    const taken=Math.min(k.health,amount);k.health=Math.max(0,k.health-taken);
    emit('hit',owner,{other:k.id,weapon,damage:taken,health:k.health,maxHealth:k.maxHealth,position:physics.pose(k.id).position});
    if(k.health===0)knockOut(k,owner,weapon);
    return true;
  }
  function splash(origin,owner,radius,weapon,direct=null) {
    const candidates=[...karts.values()].filter(k=>k.id!==owner && vulnerable(k)).map(k=>({k,p:hull(physics.pose(k.id))})).filter(v=>distance(v.p,origin)<radius && los(origin,v.p)).sort((a,b)=>distance(a.p,origin)-distance(b.p,origin));
    const hit=new Set();
    if(direct && damage(direct,owner,weapon,COMBAT.weapons[weapon].directDamage))hit.add(direct.id);
    for(const {k,p} of candidates) if(!hit.has(k.id))damage(k,owner,weapon,damageAt(weapon,distance(p,origin)));
  }
  function clearSpawns(k) {
    const others=[...karts.values()].filter(v=>v.id!==k.id&&v.alive).map(v=>physics.pose(v.id));
    return spawns.filter(s=>legalSpawn(s)&&others.every(p=>!hullsOverlap(spawnPose(s),p))).map(s=>({s,clear:Math.min(...others.map(p=>distance(p.position,spawnPose(s).position)))})).filter(v=>v.clear>=B.RESPAWN_CLEAR);
  }
  function respawn(k) {
    const safe=clearSpawns(k).sort((a,b)=>b.clear-a.clear);
    if(!safe.length) return; // Keep non-solid; retry until a safe pose exists.
    clean(k); k.spawnSeq++; k.controlEpoch++; k.alive=true; k.health=COMBAT.maxHealth; k.respawn=0; k.shield=B.SPAWN_SHIELD; k.ramT=0;k.spikesT=0; k.nitro=1; k.nitroLocked=false;
    physics.resetKart(k.id,spawnPose(safe[0].s)); physics.setKartEnabled(k.id,true); physics.freezeKart(k.id,false); physics.tuneKart(k.id,{top:1,engine:1,steering:1,traction:1});
    emit('respawn',k.id,{spawnSeq:k.spawnSeq,position:physics.pose(k.id).position});
  }
  function recoverStuck(k,p) {
    // A stopped kart on its side can have suspension rays touching a nearby
    // ramp. Contacts alone neither prove it is upright nor distinguish flight.
    if(simAt<k.recoverAfter || rotate({x:0,y:1,z:0},p.rotation).y>=RECOVERY.up || length(p.linearVelocity)>RECOVERY.linear || length(p.angularVelocity)>RECOVERY.angular) {k.stuck=null;return false;}
    const support=physics.supportAt(p.position,length(C.chassis.half)+0.15);
    if(!support || support.normal.y<=0.65) {k.stuck=null;return false;}
    if(!k.stuck || distance(k.stuck.anchor,p.position)>RECOVERY.progress) k.stuck={anchor:p.position,seconds:0,retryAt:0};
    k.stuck.seconds+=dt;
    if(k.stuck.seconds<RECOVERY.seconds-1e-8 || simAt<k.stuck.retryAt) return false;
    k.stuck.retryAt=simAt+RECOVERY.retryMs;
    // The nearest authored spawn still needs full support, static clearance
    // and separation from every live rival. Never teleport into a crowded hull.
    const safe=clearSpawns(k).sort((a,b)=>distance(spawnPose(a.s).position,p.position)-distance(spawnPose(b.s).position,p.position));
    if(!safe.length) return false;
    clean(k);k.spawnSeq++;k.controlEpoch++;k.weapon=null;k.ammo=0;k.shield=0;k.ramT=0;k.spikesT=0;k.recoverAfter=simAt+RECOVERY.cooldownMs;
    physics.resetKart(k.id,spawnPose(safe[0].s));
    emit('recover',k.id,{reason:'stuck',spawnSeq:k.spawnSeq,controlEpoch:k.controlEpoch,from:p.position,position:physics.pose(k.id).position});
    return true;
  }
  function spend(k,p) {
    if(!k.weapon || k.fireCd>0) return;
    const weapon=k.weapon, offset=C.combat[(weapon==='nuke'?'rocket':weapon)+'Muzzle']||{x:0,y:0.5,z:1.9};
    const origin=add(p.position,rotate({x:offset.x,y:offset.y,z:0},p.rotation)), muzzle=add(p.position,rotate(offset,p.rotation));
    const forward=rotate({x:0,y:0,z:1},p.rotation);
    let deployed=null;
    if(weapon==='mine' || weapon==='sentry') {
      if(!p.grounded || (weapon==='mine' ? mines.length>=B.MAX_MINES : sentries.length>=ARSENAL.sentry.max)) return;
      const radius=weapon==='mine'?COMBAT.weapons.mine.bodyRadius:.32;
      // Moving karts leave a trail at their current pose; a stationary kart
      // extends that trail backwards instead of stacking three identical discs.
      for(let slot=0;slot<(weapon==='mine'?8:1);slot++) {
        const behind=add(p.position,rotate({x:0,y:0,z:-2.8-slot*1.2},p.rotation));
        const s=physics.supportAt(add(behind,{x:0,y:0.4,z:0}),2);
        if(!s || s.normal.y<0.65 || Math.abs(s.point.y-p.position.y)>1.3)continue;
        const position=add(s.point,mul(s.normal,radius+.015));
        if(!los(add(p.position,{x:0,y:.3,z:0}),position) || sphereBlocked(position,radius) ||
          (weapon==='mine'&&mines.some(m=>distance(m.position,position)<radius*2+.2)))continue;
        if(weapon==='mine')mines.push({id:entity('m'),owner:k.id,position,radius,surfaceId:s.surfaceId,normal:s.normal,arm:COMBAT.weapons.mine.armTime,ttl:COMBAT.weapons.mine.lifetime});
        else sentries.push({id:entity('t'),owner:k.id,position,direction:forward,ttl:ARSENAL.sentry.duration,ammo:ARSENAL.sentry.rounds,fireCd:.4});
        deployed=position;break;
      }
      if(!deployed)return;
    } else if(weapon==='shield') {k.shield=B.SHIELD_TIME;k.ramT=B.SHIELD_TIME;}
    else if(weapon==='spikes') k.spikesT=ARSENAL.spikes.duration;
    else if(weapon==='emp') {
      for(const target of karts.values()) {
        if(target.id===k.id || !vulnerable(target)) continue;
        const targetPos=hull(physics.pose(target.id)), delta=sub(targetPos,origin), d=length(delta);
        if(d<B.EMP_RANGE && (d<1e-6 || dot(delta,forward)/d>=Math.cos(B.EMP_HALF_ANGLE)) && los(origin,targetPos)) { target.empT=B.EMP_TIME; emit('emp',k.id,{other:target.id,weapon,position:origin,direction:forward}); }
      }
    } else if(weapon==='grenade' || weapon==='bomb' || weapon==='proximity' || weapon==='nuke') {
      if(grenades.length>=B.MAX_GRENADES) return;
      const heavy=ARSENAL[weapon],radius=heavy?heavy.radius:B.GRENADE_R;
      if(proximityCharge(weapon)&&sphereBlocked(origin,radius))return;
      const blocked=physics.sweepStatic(origin,muzzle,radius);
      grenades.push({id:entity('g'),owner:k.id,weapon,radius,position:blocked?add(blocked.point,mul(blocked.normal,0.02)):muzzle,velocity:add(mul(forward,heavy?heavy.speed:B.GRENADE_SPEED),{x:0,y:heavy?heavy.launchY:B.GRENADE_VY0,z:0}),
        ...(proximityCharge(weapon)?{ttl:COMBAT.weapons[weapon].lifetime,arm:COMBAT.weapons[weapon].armTime,landed:false}:{fuse:heavy?heavy.fuse:B.GRENADE_FUSE}),bounces:0});
    } else {
      const angles=weapon==='scatter'?B.SCATTER_FAN:[0];
      if(shots.length+angles.length>B.MAX_ZAPS) return;
      const speed=weapon==='pulse'?ARSENAL.pulse.speed:weapon==='scatter'?B.SCATTER_SPEED:weapon==='rocket'?B.ROCKET_SPEED:weapon==='seeker'?ARSENAL.seeker.speed:B.RAIL_SPEED;
      const ttl=weapon==='pulse'?B.PULSE_TTL:weapon==='scatter'?B.SCATTER_TTL:weapon==='rocket'?B.ROCKET_TTL:weapon==='seeker'?ARSENAL.seeker.ttl:B.RAIL_TTL;
      const lock=weapon==='seeker'?[...karts.values()].filter(v=>v.id!==k.id&&vulnerable(v))
        .map(v=>({kart:v,delta:sub(hull(physics.pose(v.id)),muzzle)}))
        .filter(v=>length(v.delta)<=ARSENAL.seeker.range && dot(v.delta,forward)>=length(v.delta)*Math.cos(ARSENAL.seeker.halfAngle) && los(muzzle,add(muzzle,v.delta)))
        .sort((a,b)=>length(a.delta)-length(b.delta))[0]?.kart:null;
      const radius=COMBAT.staticSweepRadii[weapon],blocked=physics.sweepStatic(origin,muzzle,radius);
      const volley=weapon==='scatter'?entity('v'):null;
      for(const angle of angles) {
        const shot={id:entity('p'),owner:k.id,weapon,position:muzzle,velocity:mul(rotate({x:Math.sin(angle),y:0,z:Math.cos(angle)},p.rotation),speed),ttl,radius,...(volley?{volley}:{})};
        if(weapon==='seeker') {shot.targetId=lock?.id??null;shot.targetLife=lock?.spawnSeq??null;}
        if(blocked) { if(weapon==='rocket'||weapon==='seeker') splash(add(blocked.point,mul(blocked.normal,0.02)),k.id,weapon==='seeker'?ARSENAL.seeker.splashRadius:B.ROCKET_SPLASH_R,weapon); emit('impact',k.id,{weapon,position:blocked.point,surfaceId:blocked.surfaceId,...(['pulse','scatter','rail'].includes(weapon)?{from:origin}:{})}); }
        else shots.push(shot);
      }
    }
    if(weapon!=='shield') {k.shield=0;k.ramT=0;}
    k.fireCd=weapon==='pulse'?ARSENAL.pulse.cooldown:weapon==='mine'?COMBAT.weapons.mine.dropInterval:B.FIRE_CD;
    k.ammo--; if(k.ammo<=0) { k.weapon=null; k.ammo=0; }
    emit(weapon==='mine'?'mine':weapon==='shield'?'shield':'fire',k.id,{weapon,position:deployed||muzzle,direction:forward});
    return true;
  }
  function updateShots(before,after) {
    for(let i=shots.length-1;i>=0;i--) {
      const s=shots[i], h=Math.min(dt,s.ttl);
      if(s.weapon==='seeker' && s.targetId) {
        const target=karts.get(s.targetId);
        if(!target?.alive || !target.connected || target.spawnSeq!==s.targetLife) {s.targetId=null;s.targetLife=null;}
        else s.velocity=guidedVelocity(s.velocity,sub(hull(after.get(target.id)),s.position),ARSENAL.seeker.turnRate*h);
      }
      const end=add(s.position,mul(s.velocity,h));
      const solid=physics.sweepStatic(s.position,end,s.radius); let hit=null, t=solid?.fraction??Infinity;
      for(const k of karts.values()) {
        if(k.id===s.owner || !k.alive || !k.connected) continue;
        const a=before.get(k.id),b=after.get(k.id);
        // A respawn is a teleport epoch, never a swept target across the arena.
        const start=a.epoch===b.epoch?hull(a):hull(b), finish=lerp(start,hull(b),h/dt);
        const fraction=hullImpact(s.position,end,start,finish,Math.sqrt(B.ZAP_HIT_R2));
        if(fraction!==null && fraction<t-1e-7 && los(lerp(s.position,end,fraction),lerp(start,finish,fraction))) { t=fraction; hit=k; }
      }
      if(t<=1) {
        const point=lerp(s.position,end,t), normal=hit?ZERO:solid.normal;
        if(s.weapon==='rocket'||s.weapon==='seeker') { splash(add(point,mul(normal,0.02)),s.owner,s.weapon==='seeker'?ARSENAL.seeker.splashRadius:B.ROCKET_SPLASH_R,s.weapon,hit); emit('blast',s.owner,{weapon:s.weapon,position:point}); }
        else if(hit) damage(hit,s.owner,s.weapon,damageAt(s.weapon),s.volley);
        emit('impact',s.owner,{weapon:s.weapon,position:point,...(!hit?{surfaceId:solid.surfaceId}:{other:hit.id}),...(['pulse','scatter','rail','sentry'].includes(s.weapon)?{from:s.position}:{})}); shots.splice(i,1);
      } else { s.position=end; s.ttl-=h; if(s.ttl<=1e-8) shots.splice(i,1); }
    }
    const liveVolleys=new Set(shots.map(s=>s.volley).filter(Boolean));
    for(const id of scatterHits.keys())if(!liveVolleys.has(id))scatterHits.delete(id);
  }
  function updateMines(before,after) {
    for(let i=mines.length-1;i>=0;i--) {
      const m=mines[i], oldArm=m.arm, startFraction=clamp(oldArm/dt,0,1), endFraction=clamp(m.ttl/dt,0,1), remaining=m.ttl;
      m.arm=Math.max(0,m.arm-dt); m.ttl-=dt;
      if(oldArm<dt && remaining>0) {
        let best=null,bestT=Infinity;
        for(const k of karts.values()) {
          if(k.id===m.owner || !vulnerable(k)) continue;
          const a=before.get(k.id),b=after.get(k.id);
          if(a.epoch!==b.epoch) continue;
          const start=lerp(a.position,b.position,startFraction),end=lerp(a.position,b.position,endFraction);
          const t=hullImpact(m.position,m.position,start,end,Math.sqrt(B.MINE_R2));
          if(t!==null && t<bestT && los(m.position,lerp(start,end,t))) {bestT=t;best=k;}
        }
        if(best) {damage(best,m.owner,'mine');mines.splice(i,1);continue;}
      }
      if(m.ttl<=0) mines.splice(i,1);
    }
  }
  function updateGrenades(before,after) {
    for(let i=grenades.length-1;i>=0;i--) {
      const g=grenades[i],charge=proximityCharge(g.weapon),h=Math.min(dt,charge?g.ttl:g.fuse),heavy=ARSENAL[g.weapon],bomb=!!heavy;
      if(charge&&g.landed){
        const support=physics.supportAt(g.position,g.radius+.06);
        if(!support||support.normal.y<.65||Math.abs(g.position.y-support.point.y-g.radius)>.06){g.landed=false;g.arm=COMBAT.weapons[g.weapon].armTime;}
      }
      const wasLanded=g.landed;
      g.velocity.y-=B.GRENADE_GRAVITY*h;
      let remaining=h,direct=null;
      for(let impacts=0;impacts<3 && remaining>1e-6;impacts++) {
        const end=add(g.position,mul(g.velocity,remaining)), hit=physics.sweepStatic(g.position,end,g.radius);
        if(g.weapon==='nuke') {
          // Match projectile hull sweeps, including target motion during each
          // bounded segment after a bounce. Static cover wins equal contacts.
          let fraction=hit?.fraction??Infinity;
          for(const k of karts.values()) {
            if(k.id===g.owner || !k.alive || !k.connected) continue;
            const a=before.get(k.id),b=after.get(k.id),start=a.epoch===b.epoch?hull(a):hull(b);
            const from=lerp(start,hull(b),(h-remaining)/dt),to=lerp(start,hull(b),h/dt);
            const t=hullImpact(g.position,end,from,to,Math.sqrt(B.ZAP_HIT_R2));
            if(t!==null && t<fraction-1e-7 && los(lerp(g.position,end,t),lerp(from,to,t))) {fraction=t;direct=k;}
          }
          if(direct) {g.position=lerp(g.position,end,fraction);break;}
        }
        if(!hit) {g.position=end;break;}
        g.position=add(hit.point,mul(hit.normal,0.015)); remaining*=1-hit.fraction;
        const vn=dot(g.velocity,hit.normal);
        if(vn>=0) break;
        const bounce=!bomb && g.bounces<B.GRENADE_MAX_BOUNCES && (hit.normal.y<0.65 || Math.abs(vn)>B.GRENADE_REST_VY);
        const keep=bounce?(hit.normal.y>0.65?B.GRENADE_BOUNCE_VY:B.GRENADE_FACE_KEEP):0;
        const tangent=sub(g.velocity,mul(hit.normal,vn));
        g.velocity=add(mul(tangent,bomb?1:B.GRENADE_BOUNCE_PLANAR),mul(hit.normal,-keep*vn));
        if(bounce) g.bounces++;
        if(!bounce && hit.normal.y>0.65) {
          g.velocity=mul(g.velocity,Math.max(0,1-(bomb?(heavy.friction||0):B.GRENADE_GROUND_FRICTION)*h));
          if(charge)g.landed=true;
          break;
        }
      }
      if(charge){
        g.ttl-=h;
        if(g.ttl<=1e-8){grenades.splice(i,1);continue;}
        if(wasLanded&&g.landed)g.arm=Math.max(0,g.arm-h);
        if(g.landed&&g.arm<=1e-8&&[...karts.values()].some(k=>k.id!==g.owner&&vulnerable(k)&&distance(hull(after.get(k.id)),g.position)<COMBAT.weapons[g.weapon].triggerRadius&&los(g.position,hull(after.get(k.id))))){
          splash(g.position,g.owner,heavy.splashRadius,g.weapon);
          emit('blast',g.owner,{weapon:g.weapon,position:g.position});grenades.splice(i,1);
        }
        continue;
      }
      g.fuse-=h;
      if(direct || g.fuse<=1e-8) {
        splash(g.position,g.owner,bomb?heavy.splashRadius:B.GRENADE_SPLASH_R,g.weapon,direct);
        if(direct)emit('impact',g.owner,{weapon:g.weapon,position:g.position,other:direct.id});
        emit('blast',g.owner,{weapon:g.weapon,position:g.position});grenades.splice(i,1);
      }
    }
  }
  function updateSentries(after) {
    for(let i=sentries.length-1;i>=0;i--) {
      const t=sentries[i];t.ttl-=dt;t.fireCd=Math.max(0,t.fireCd-dt);
      if(t.ttl<=0 || t.ammo<=0) {sentries.splice(i,1);continue;}
      // A disconnected/dead owner cannot keep earning unattended shots.
      const owner=karts.get(t.owner);if(!owner?.alive||!owner.connected) continue;
      const origin=add(t.position,{x:0,y:.65,z:0});
      const target=[...karts.values()].filter(k=>k.id!==t.owner&&vulnerable(k)).map(k=>hull(after.get(k.id))).filter(p=>distance(origin,p)<ARSENAL.sentry.range&&los(origin,p)).sort((a,b)=>distance(origin,a)-distance(origin,b))[0];
      if(!target) continue;
      t.direction=mul(sub(target,origin),1/distance(target,origin));
      if(t.fireCd>0||shots.length>=B.MAX_ZAPS) continue;
      const muzzle=add(origin,mul(t.direction,.6));
      if(physics.sweepStatic(origin,muzzle,COMBAT.staticSweepRadii.sentry)) continue;
      shots.push({id:entity('p'),owner:t.owner,weapon:'sentry',position:muzzle,velocity:mul(t.direction,ARSENAL.pulse.speed),ttl:B.PULSE_TTL,radius:COMBAT.staticSweepRadii.sentry});
      t.ammo--;t.fireCd=ARSENAL.sentry.cooldown;emit('fire',t.owner,{weapon:'sentry',position:muzzle,direction:t.direction});
    }
  }
  // Expanded chassis proxy catches touching hardware after Rapier resolves
  // penetration; spawn shields never gain the offensive contact effect.
  const contactShape=new RAPIER.Cuboid(C.chassis.half.x+.08,C.chassis.half.y+.08,C.chassis.half.z+.08);
  function updateContactWeapons(before,after) {
    for(const source of karts.values()) {
      if(!source.alive||!source.connected||!(source.ramT>0||source.spikesT>0)) continue;
      const p=after.get(source.id),a=before.get(source.id);
      for(const target of karts.values()) {
        if(target.id===source.id||!vulnerable(target)) continue;
        const q=after.get(target.id),b=before.get(target.id);
        if(source.ramT>0 && contactShape.intersectsShape(p.position,p.rotation,chassisShape,q.position,q.rotation) && los(hull(p),hull(q))) damage(target,source.id,'shield');
        else if(source.spikesT>0 && a.epoch===p.epoch && b.epoch===q.epoch && hullImpact(hull(a),hull(p),hull(b),hull(q),ARSENAL.spikes.radius)!==null && los(hull(p),hull(q))) {
          const key=source.id+':'+target.id,prior=spikeAt.get(key),sameLife=prior?.sourceLife===source.spawnSeq&&prior?.targetLife===target.spawnSeq;
          if(!sameLife || simAt-prior.at>=COMBAT.weapons.spikes.cooldownMs-1e-6) {spikeAt.set(key,{at:simAt,sourceLife:source.spawnSeq,targetLife:target.spawnSeq});damage(target,source.id,'spikes');}
        }
      }
    }
  }
  function finish(reason='deadline') {
    if(phase==='done') return;
    phase='done'; const scores=[...karts.values()].map(k=>({id:k.id,hits:k.hits,deaths:k.deaths,...(k.out?{out:true}:{})})), active=scores.filter(s=>!s.out), best=Math.max(...active.map(s=>s.hits));
    resultData={instance,mapId:M.id,reason,endedAt:reason==='deadline'?deadline:simAt,scores,winners:active.filter(s=>s.hits===best).map(s=>s.id)};
    for(const k of karts.values()) {clean(k);physics.freezeKart(k.id,true);}
    shots.length=0;mines.length=0;grenades.length=0;sentries.length=0;
    emit('result',null,{winners:resultData.winners});
    if(typeof options.onResult==='function') {try {options.onResult(structuredClone(resultData));}catch {}}
  }
  function fixedStep(at) {
    simAt=at;simTick++;
    if(phase==='countdown') {
      if(at<liveAt-1e-6) return;
      phase='live';
      for(const k of karts.values()) {
        const liveQueue=k.queue.filter(p=>p.at>=liveAt);
        clean(k);k.queue=liveQueue;k.useDown=liveQueue.at(-1)?.value.use||false;
        k.appliedSeq=liveQueue.length?liveQueue[0].seq-1:k.receivedSeq;physics.freezeKart(k.id,!k.connected);
      }
      emit('live',null);
    }
    if(at>=deadline-1e-6) {finish();return;}
    const before=new Map([...karts.keys()].map(id=>[id,physics.pose(id)]));
    for(const k of karts.values()) {
      if(!k.connected) continue;
      if(!k.alive) { k.respawn=Math.max(0,k.respawn-dt); if(k.respawn<=1e-8) respawn(k); continue; }
      while(k.queue.length && k.queue[0].at<=at+1e-6) {
        const p=k.queue.shift();k.appliedSeq=p.seq;k.input=p.value;k.lastInputAt=p.at;
        if(p.fire && p.item===k.itemSeq && !k.sequence && at-p.at<=H.INPUT_TTL_MS && !k.pendingFire) {k.pendingFire=true;k.pendingFireAt=p.at;}
      }
      if(k.lastInputAt===null || at-k.lastInputAt>H.INPUT_TTL_MS) { k.input=neutral();k.pendingFire=false;k.nitroActive=false; }
      k.shield=Math.max(0,k.shield-dt);k.ramT=Math.max(0,k.ramT-dt);k.spikesT=Math.max(0,k.spikesT-dt);k.fireCd=Math.max(0,k.fireCd-dt); k.empT=Math.max(0,k.empT-dt);
      if(k.nitroLocked) {k.nitroActive=false;k.nitro=Math.min(1,k.nitro+H.NITRO_RECHARGE*dt);if(k.nitro>=H.NITRO_REARM)k.nitroLocked=false;}
      else if(k.input.nitro&&k.input.throttle>0&&k.nitro>0) {k.nitroActive=true;k.nitro=Math.max(0,k.nitro-H.NITRO_DRAIN*dt);if(k.nitro<=0)k.nitroLocked=true;}
      else {k.nitroActive=false;k.nitro=Math.min(1,k.nitro+H.NITRO_RECHARGE*dt);}
    }
    // Tick every timer before spending; an EMP cannot lose a step or miss the
    // first affected drive step because its target happens to be an earlier seat.
    for(const k of karts.values()) if(k.connected&&k.alive){
      if(k.pendingFire){
        const reservedMines=mines.length+[...karts.values()].reduce((n,v)=>n+(v.sequence?.weapon==='mine'?v.ammo:0),0);
        if(!k.sequence&&k.weapon&&at-k.pendingFireAt<=H.INPUT_TTL_MS&&(k.weapon!=='mine'||reservedMines+k.ammo<=B.MAX_MINES))k.sequence={weapon:k.weapon,item:k.itemSeq,until:at+LIMIT.activationMs};
        k.pendingFire=false;k.pendingFireAt=null;
      }
      if(k.sequence){
        if(at>=k.sequence.until||k.sequence.item!==k.itemSeq||k.sequence.weapon!==k.weapon){k.sequence=null;k.weapon=null;k.ammo=0;}
        else if(spend(k,before.get(k.id))&&!k.weapon)k.sequence=null;
      }
    }
    for(const k of karts.values()) if(k.connected&&k.alive) {
      physics.tuneKart(k.id,{top:(k.nitroActive?H.NITRO_SPEED:1)*(k.empT>0?H.EMP_TOP_SCALE:1),engine:(k.nitroActive?H.NITRO_PUNCH:1)*(k.empT>0?H.EMP_ACCEL_SCALE:1),steering:k.empT>0?H.EMP_TURN_SCALE:1,traction:1});
      physics.applyIntent(k.id,k.input);
    }
    physics.step();
    const after=new Map([...karts.keys()].map(id=>[id,physics.pose(id)]));
    for(const contact of physics.drainImpacts()) {
      const ids=contact.ids.filter(id=>karts.get(id)?.alive&&karts.get(id)?.connected);
      if(!ids.length)continue;
      if(ids.length===2) for(const id of ids) {const source=karts.get(id),target=karts.get(ids.find(v=>v!==id));if(source.alive&&source.ramT>0)damage(target,source.id,'shield');}
      const key=contact.surfaceId?ids[0]+':'+contact.surfaceId:[...ids].sort().join(':');
      if(at-(collisionAt.get(key)??-Infinity)<350)continue;
      collisionAt.set(key,at);
      emit(Math.abs(contact.normal.y)>.7?'landing':'collision',ids[0],{...contact,other:ids[1]||null});
    }
    updateContactWeapons(before,after);updateSentries(after);updateShots(before,after);updateMines(before,after);updateGrenades(before,after);
    if(targetReached) {finish('target');return;}
    for(const k of karts.values()) {
      if(!k.connected || !k.alive) continue;
      const p=physics.pose(k.id);
      if(p.position.y < -12 || Math.abs(p.position.x)>M.half+8 || Math.abs(p.position.z)>M.half+8) { k.alive=false;k.health=0;k.respawn=B.RESPAWN_TIME;k.weapon=null;k.ammo=0;k.shield=0;k.ramT=0;k.spikesT=0;clean(k);k.controlEpoch++;physics.freezeKart(k.id,true);physics.setKartEnabled(k.id,false);emit('recovery',k.id);continue; }
      if(recoverStuck(k,p)) continue;
      if(k.weapon || k.sequence || !p.grounded) continue;
      for(const c of crates) {
        if(at<c.availableAt || distance(p.position,c.position)>Math.sqrt(B.PICKUP_R2) || !p.wheels.some(w=>w.contact&&w.surfaceId===c.surfaceId) || !los(c.position,p.position)) continue;
        k.itemSeq++;k.weapon=rollWeapon();k.ammo=k.weapon==='pulse'?ARSENAL.pulse.ammo:(COMBAT.weapons[k.weapon]?.ammo||1);award(k,B.COIN_PICKUP,'pickup-'+c.id);emit('pickup',k.id,{weapon:k.weapon,crateId:c.id,position:c.position});
        const s=pickSocket(c.socketId);
        if(s) Object.assign(c,crateAt(s),{availableAt:at+2000});
        break;
      }
    }
  }
  function advance(now) {
    alive();if(!boundedTime(now)||now<wallAt) throw new RangeError('monotonic server time required');
    if(phase==='done') {wallAt=now;return snapshot();}
    const elapsed=now-wallAt;wallAt=now;accumulator+=elapsed;
    const budget=LIMIT.steps*stepMs;
    // Wall deadline remains honest under a scheduler stall; we drop excess
    // physical backlog rather than simulate a teleport or retroactive inputs.
    // Offline timers remain frozen; connected timers advance executed steps.
    if(accumulator>budget) {const drop=accumulator-budget;droppedMs+=drop;simAt+=drop;accumulator=budget;}
    let steps=0;
    try {
      while(accumulator+1e-7>=stepMs && steps<LIMIT.steps && phase!=='done') {accumulator-=stepMs;fixedStep(simAt+stepMs);steps++;}
    } catch(error) {dispose();throw new Error('elevated combat simulation retired after failure',{cause:error});}
    if(now>=deadline && phase!=='done') {simAt=deadline;finish();}
    return snapshot();
  }
  function privateStatus(viewer) {
    alive(); const own=karts.get(viewer);
    return own?{id:own.id,receivedSeq:own.receivedSeq,appliedInputSeq:own.appliedSeq,life:own.spawnSeq,controlEpoch:own.controlEpoch,coins:own.coins}:null;
  }
  function snapshot(viewer=null) {
    alive();
    return structuredClone({instance,profile:'internal-elevated-combat-v2',combat:COMBAT,projectileRadii:COMBAT.staticSweepRadii,physicsVersion:physics.apiVersion,configVersion:C.version,mapId:M.id,mapRevision:M.revision,phase,simTick,simAt,serverAt:wallAt,liveAt,deadline,droppedMs,
      karts:[...karts.values()].map(k=>({id:k.id,name:k.name,connected:k.connected,...(k.out?{out:true}:{}),alive:k.alive,health:k.health,maxHealth:k.maxHealth,hits:k.hits,deaths:k.deaths,spawnSeq:k.spawnSeq,controlEpoch:k.controlEpoch,weapon:k.weapon,ammo:k.ammo,firing:!!k.sequence,shield:k.shield,ramT:k.ramT,spikesT:k.spikesT,respawn:k.respawn,empT:k.empT,nitro:k.nitro,nitroActive:k.nitroActive,pose:physics.pose(k.id)})),
      crates:crates.map(c=>({id:c.id,position:c.position,surfaceId:c.surfaceId,available:c.availableAt<=simAt})),
      projectiles:shots,sentries,mines:mines.map(m=>({...m,armed:m.arm<=0})),grenades:grenades.map(g=>({...g,...(proximityCharge(g.weapon)?{armed:g.landed&&g.arm<=1e-8,warning:g.landed&&g.arm<=1e-8}:{warning:g.fuse<=(ARSENAL[g.weapon]?.warning??B.GRENADE_WARN)})})),events,
      you:privateStatus(viewer),result:resultData});
  }
  function result() {alive();return resultData?structuredClone(resultData):null;}
  function rematch(next) {
    alive(); if(phase!=='done' || !next || next.instance===instance || !validId(next.instance)) throw new Error('finished instance and fresh rematch id required');
    return createElevatedCombat(RAPIER,C,M,seats,{...options,...next});
  }
  function dispose() {if(disposed)return;physics.dispose();for(const k of karts.values())clean(k);shots.length=0;mines.length=0;grenades.length=0;sentries.length=0;crates.length=0;events.length=0;collisionAt.clear();spikeAt.clear();scatterHits.clear();karts.clear();disposed=true;}
  function stats() {return {instance,disposed,karts:karts.size,projectiles:shots.length,mines:mines.length,grenades:grenades.length,sentries:sentries.length,queuedInputs:[...karts.values()].reduce((n,k)=>n+k.queue.length,0),recovery:[...karts.values()].map(k=>({id:k.id,stuckSeconds:k.stuck?.seconds||0,retryAt:k.stuck?.retryAt||0,cooldownUntil:k.recoverAfter})),physics:physics.stats()};}
  return Object.freeze({input,setConnected,drop,advance,snapshot,privateStatus,result,rematch,dispose,stats});
}
module.exports={createElevatedCombat,arsenal:ARSENAL,staticSweepRadii:COMBAT.staticSweepRadii};
