'use strict';
/* Classic battle authority. 100 HP, one inventory slot and twelve
 * curated pickups from kart-combat-config.js. The server owns every hit,
 * status timer, knockout, respawn and expiry; renderers only draw snapshots.
 *
 * Each shot uses the current mount. Tracking fire aims at a visible rival;
 * burst fire and straight rockets follow the kart. Mines wait for movement.
 *
 * Sweeps stop at the earliest static surface, hull or expiry. Static cover
 * wins exact ties. Lifecycle caps are 64 shots, 16 traps and 12 canisters.
 * KO/disconnect/result retire committed payloads and attached effects.
 * Old inventory IDs normalize before spending. Legacy in-flight handlers
 * and wire names remain for old fixtures and already-created bodies.
 */

const {config:COMBAT,damageAt,blastDamage,weaponForRoll,bladeContact,volleyHit} = require('./kart-combat-config');
const {normalizeWeapon}=require('./kart-combat-config');
const {activeKartPower,weaponForward,launchVelocity,TRI_FAN,CURATED_MUZZLE,inWeaponCone,WEAPON_FEEL}=require('../../public/js/engines/kart-weapon-contract.mjs');
const LEGACY={laser:{speed:190,ttl:.7},bouncer:{speed:48,ttl:3.5,bounces:4},cluster:{fuse:.75,bomblets:5,splashRadius:3}};
const PHYSICS = require('../../public/js/engines/kart-physics-config.mjs').default;
const PICKUP_R2 = 2.4 * 2.4;
const ZAP_HIT_R2 = 1.7 * 1.7;
// Quick arcade ballistics in both battle modes; swept impacts prevent tunneling.
const PULSE_SPEED = COMBAT.weapons.machinegun.speed;
const PULSE_TTL = COMBAT.weapons.machinegun.ttl;
const PULSE_AMMO = COMBAT.weapons.machinegun.ammo;
const SCATTER_SPEED = 95;
const SCATTER_TTL = 1.2;
const SCATTER_FAN = TRI_FAN;
const ROCKET_SPEED = COMBAT.weapons.cannon.speed;
const ROCKET_TTL = COMBAT.weapons.cannon.ttl;
const ROCKET_SPLASH_R = COMBAT.weapons.cannon.splashRadius;
const ROCKET_SPLASH_R2 = ROCKET_SPLASH_R * ROCKET_SPLASH_R;
const SEEKER_SPEED = 60;
const SEEKER_TTL = 2.4;
const SEEKER_RANGE = COMBAT.weapons.missile.range;
const SEEKER_HALF_ANGLE = COMBAT.weapons.missile.halfAngle * Math.PI / 180;
const SEEKER_TURN = COMBAT.weapons.missile.turnRate; // rad/s
const SEEKER_SPLASH_R = COMBAT.weapons.missile.splashRadius;
const PROXIMITY_R2 = COMBAT.weapons.proximity.triggerRadius ** 2;
const PROXIMITY_SPLASH_R = COMBAT.weapons.proximity.splashRadius;
const MINE_ARM = COMBAT.weapons.mine.armTime;
const MINE_TTL = COMBAT.weapons.mine.lifetime;
const MINE_R2 = COMBAT.weapons.mine.triggerRadius ** 2;
const MINE_CLEAR = 0.5; // mine center clearance from block faces
const MAX_MINES = 16;
const MAX_ZAPS = 64;
// Second eight weapons (see kart-combat-config.js for every number).
const W = COMBAT.weapons;
const LASER_SPEED = LEGACY.laser.speed;
const LASER_TTL = LEGACY.laser.ttl;
const BOUNCER_SPEED = LEGACY.bouncer.speed;
const BOUNCER_TTL = LEGACY.bouncer.ttl;
const BOUNCER_BOUNCES = LEGACY.bouncer.bounces;
const SPIN_TIME = 0;
const SPIN_KICK = 7; // legacy wire-status yaw kick
const FROST_TIME = W.frost.slowTime;
const RAM_TIME = W.ram.duration;
const RAM_REACH = W.ram.reach;
const BOMBLET_FUSE = .42;
const BOMBLET_STAGGER = .11;
const BOMBLET_SPEED = 7.5;
const BOMBLET_VY = 5;
// Lobbed kinds: blast radius and fuse per canister kind. A Cluster bursts
// into bomblets; retained only for already-created legacy bodies.
const LOBBED = {
  nuke: {fuse: 2.5, radius: W.nuke.splashRadius, weapon: 'nuke'},
  frost: {fuse: W.frost.fuse, radius: W.frost.splashRadius, weapon: 'frost'},
  cluster: {fuse: LEGACY.cluster.fuse, radius: 0, weapon: 'cluster'},
  bomblet: {fuse: BOMBLET_FUSE + BOMBLET_STAGGER * 5, radius: LEGACY.cluster.splashRadius, weapon: 'cluster'},
};
const muzzleOf = kind => COMBAT.muzzleKind[kind] || kind;
// Lobbed ordnance ("grenade" bodies) carries the Nuke: forward at 22 u/s
// planar, vy 8, gravity 30 (apex ~2.07u at ~0.27 s, first touchdown
// ~0.64 s / ~14u out). Cover is full-height (the map schema has no block
// heights), so the arc bounces off faces mid-flight exactly like a ground
// roll. At most 2 bounces (floor, cover face, or world wall), each damping
// planar x0.55; floor bounces reflect vy x0.45, face bounces reflect the
// normal x0.5. Past the budget, faces slide (normal killed, tangent
// damped) and the floor grounds the warhead (bounded linear friction).
// Fuse 2.5 s, splash 14u, final 1.2 s warning ring.
const GRENADE_SPEED = 22;
const GRENADE_VY0 = 8;
const GRENADE_GRAVITY = 30;
const GRENADE_Y0 = 1;
const GRENADE_FUSE = 2.5;
const GRENADE_WARN = 1.2;
const GRENADE_SPLASH_R = COMBAT.weapons.nuke.splashRadius;
const GRENADE_SPLASH_R2 = GRENADE_SPLASH_R * GRENADE_SPLASH_R;
const GRENADE_BOUNCE_PLANAR = 0.55;
const GRENADE_BOUNCE_VY = 0.45;
const GRENADE_FACE_KEEP = 0.5;
const GRENADE_GROUND_FRICTION = 3;
const GRENADE_MAX_BOUNCES = 2;
const GRENADE_REST_VY = 1.5; // softer floor touches ground instead of bouncing
const GRENADE_R = 0.45; // body radius: blocks expand, walls inset by this
const GRENADE_YMAX = 12; // sanity clamp for malformed fixture bodies
const GRENADE_VMAX = 40; // sanity clamp for malformed fixture velocities
const GRENADE_STEP = 0.04; // motion substep: 22 u/s * 0.04 = 0.88u < any cover
const MAX_GRENADES = 12;
const MAX_EVENTS = 12; // last 12 semantic records (fire + KO + pickups retained)
const FIRE_CD = 0.4;
const SPAWN_SHIELD = 2.5;
const RESPAWN_TIME = 2;
const RESPAWN_CLEAR = 2.5; // min live-kart clearance for a respawn pose
const CRATE_KART_KEEP = 5; // crates recycle away from live karts
const PAYLOAD_WEAPONS = new Set(['machinegun','trishot','cannon','mine','laser','bouncer']);
const SHOT_WEAPONS = ['machinegun','trishot','cannon','missile','nuke','laser','bouncer','frost','cluster'];
// Private to authority: public views contain only ammo/weapon/firing.
const payloads = new WeakMap();
// Receipt-time button state survives movement TTL; only a real neutral receipt
// releases it. Unregistered rule fixtures keep their historical input edge.
const fireButtons = new WeakMap();
function fireInputEdge(kart,held){const pressed=held===true&&fireButtons.get(kart)!==true;fireButtons.set(kart,held===true);return pressed;}
function resetFireInput(kart){fireButtons.delete(kart);}
function cancelPayload(kart) {
  const payload=payloads.get(kart);if(!payload)return;
  payloads.delete(kart);
  if(kart.weapon===payload.weapon){kart.weapon=null;kart.ammo=0;}
}
function cancelPayloads(state) {for(const kart of state.karts){cancelPayload(kart);kart.bladesT=0;kart.supernovaT=0;kart.bladesAge=0;kart.bladesVolley=null;kart.supernovaVolley=null;kart.bladesHits=null;}}
// Garage coins (battle only, awarded exactly once server-side via econ).
const COIN_KO = 10;
const COIN_PICKUP = 1;

function clampNum(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/* Authoritative per-match RNG (mulberry32 over state.rngState, seeded once
 * at create). Drives crate layout and item rolls. Never Math.random, never
 * renderer-driven, never exposed to views. */
function rand01(state) {
  let t = (Number(state.rngState) || 0) >>> 0;
  t = (t + 0x6d2b79f5) >>> 0;
  state.rngState = t;
  let z = t;
  z = Math.imul(z ^ (z >>> 15), z | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
  return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
}

function randInt(state, n) {
  return Math.floor(rand01(state) * n);
}

/* Both battle modes share one deterministic curated arsenal (classic and
 * garage roll the identical pool; the garage controls earned kart tuning,
 * never which weapons a player gets). Tier odds live in the shared config
 * (common 60% / uncommon 33% / rare 7%), so the published weights, the
 * code and the tests cannot drift apart. */
const WEAPON_ORDER = COMBAT.weaponOrder;
const WEAPON_WEIGHTS = COMBAT.pickupWeights;
function rollWeapon(state) {
  return weaponForRoll(rand01(state));
}

function liveBodies(state) {
  return state.karts.filter((k) => (Number(k.respawn) || 0) <= 0);
}

/* Random validated socket for a crate: fixed authored coordinates,
 * randomly SELECTED. Hard rules: never the just-consumed spot, never an
 * occupied socket. Soft rules: active crates stay spread (~8u on large
 * maps, ~5u on compact ones) and away from live karts (~5u). Tiers relax
 * gracefully when the arena is crowded — always deterministic from the
 * match seed, never an arbitrary coordinate. */
function pickSocket(state, crates, exclude) {
  const spots = Array.isArray(state.spots) ? state.spots : [];
  const spacing = (Number(state.half) || 30) > 30 ? 8 : 5;
  const bodies = liveBodies(state);
  const pool = [];
  for (const spot of spots) {
    const x = spot[0];
    const z = spot[1];
    if (exclude && Math.abs(exclude.x - x) < 0.01 && Math.abs(exclude.z - z) < 0.01) continue;
    if (crates.some((c) => Math.abs(c.x - x) < 0.01 && Math.abs(c.z - z) < 0.01)) continue;
    let dc = Infinity;
    let dk = Infinity;
    for (const c of crates) dc = Math.min(dc, Math.hypot(c.x - x, c.z - z));
    for (const k of bodies) dk = Math.min(dk, Math.hypot(k.x - x, k.z - z));
    pool.push({ x, z, dc, dk });
  }
  if (!pool.length) return exclude || null;
  let tier = pool.filter((p) => p.dc >= spacing && p.dk >= CRATE_KART_KEEP);
  if (!tier.length) tier = pool.filter((p) => p.dk >= CRATE_KART_KEEP);
  if (!tier.length) {
    tier = pool.slice().sort((a, b) => (b.dk - a.dk) || (b.dc - a.dc));
    const top = tier.filter((p) => p.dc === tier[0].dc && p.dk === tier[0].dk);
    return top[randInt(state, top.length)];
  }
  return tier[randInt(state, tier.length)];
}

/* Bounded semantic records for sound + discharge/blast visuals. extra
 * carries finite numbers only (blast/discharge origin); non-finite values
 * are dropped so views stay plain wire JSON. */
function pushEvent(state, type, pid, other, weapon, extra) {
  state.eventSeq += 1;
  const e = { id: 'e' + state.eventSeq, type, pid };
  if (other !== undefined) e.other = other;
  if (weapon !== undefined) e.weapon = weapon;
  if (extra && typeof extra === 'object') {
    for (const k of Object.keys(extra)) {
      const v = extra[k];
      if (typeof v === 'number' && Number.isFinite(v)) e[k] = v;
      else if(['targetId','crateId'].includes(k)&&typeof v==='string')e[k]=v;
      else if(['position','direction','from'].includes(k) && v && [v.x,v.y,v.z].every(Number.isFinite)) e[k]={x:v.x,y:v.y,z:v.z};
    }
  }
  if((type==='fire'||type==='mine')&&!e.position){const k=state.karts.find(k=>k.pid===pid);if(k){e.position=k.physicalPose?physicalHullCenter(k):{x:k.x,y:.7,z:k.z};e.direction=k.physicalPose?weaponForward(k.physicalPose.rotation):{x:Math.sin(k.angle),y:0,z:Math.cos(k.angle)};}}
  state.events.push(e);
  while (state.events.length > MAX_EVENTS) state.events.shift();
}

function rivals(state, owner, other) {
  return state.teamRules ? state.teamRules.canDamage(owner, other) : owner !== other;
}

/* Score the shooter once and freeze the victim out for RESPAWN_TIME. The
 * shield value freezes untouched (never ticks while KO'd); duplicate-KO
 * protection comes from the dead state itself: dead karts are skipped by
 * every target check, contact pass, and motion step. econ (optional
 * {award(pid,amount)}) pays the KO coin exactly once alongside the hit. */
function knockOut(state, victim, shooterPid, weapon, econ) {
  cancelPayload(victim);
  resetFireInput(victim);
  victim.health = 0;
  victim.respawn = RESPAWN_TIME;
  victim.weapon = null;
  victim.ammo = 0;
  victim.deaths = (Number(victim.deaths) || 0) + 1;
  victim.speed = 0;
  victim.slip = 0;
  victim.boost = 0;
  victim.drifting = false;
  victim.driftCharge = 0;
  victim.turbo = 0;
  victim.fireCd = 0;
  victim.guard = false;
  victim.nitroActive = false;
  clearStatus(victim);
  victim.input = { steer: 0, throttle: 0, boost: false };
  victim.prevAction = false;
  victim.pendingFire = false; // KO discards a latched edge
  victim.machineHeld = false;
  const shooter = state.karts.find((k) => k.pid === shooterPid);
  if (shooter) {
    shooter.hits += 1;
    state.scores[shooter.pid] = shooter.hits;
  }
  if (econ && typeof econ.award === 'function' && shooterPid) {
    try { econ.award(shooterPid, COIN_KO); } catch { /* economy never breaks the tick */ }
  }
  pushEvent(state, 'ko', shooterPid, victim.pid, weapon,victim.physicalPose?{position:physicalHullCenter(victim)}:undefined);
  if (shooter) state.teamRules?.scoreKO(shooter.pid, victim.pid, 'e' + state.eventSeq, state.nowMs);
}

/* Timed status effects. Frost slows and ram boosts. A KO or
 * respawn ends every one of them. */
function clearStatus(kart) {
  kart.bladesT=0;kart.bladesAge=0;kart.supernovaT=0;kart.bladesVolley=null;kart.supernovaVolley=null;kart.bladesHits=null;
  kart.frostT = 0; kart.spinT = 0; kart.rammingT = 0; kart.ramVolley = null; kart.spinKick = 0;
}
function applyStatus(state, victim, weapon) {
  if (weapon === 'frost') victim.frostT = FROST_TIME;
}

/* HP damage, with independent bullets and one contact per activation. Supernova blocks every hit
 * while active. The old guard field only serves legacy state. */
function damage(state,victim,owner,weapon,connected,econ,volley=null,override=null,shot=null) {
  const amount=override??damageAt(weapon);
  if(!victim || !rivals(state, owner, victim.pid) || !connected.has(victim.pid) || victim.respawn>0 || victim.shield>0 || !(amount>0)) return false;
  const hitPosition = victim.physicalPose ? physicalHullCenter(victim) : {x:+victim.x.toFixed(3),y:0,z:+victim.z.toFixed(3)};
  if(victim.supernovaT>0){
    let announce=true;
    if(volley){let hits=state.volleyHits.get(volley);if(!hits)state.volleyHits.set(volley,hits=new Map());const key='blocked:'+victim.pid+':'+(victim.spawnSeq||0);announce=!hits.has(key);hits.set(key,true);}
    if(announce)pushEvent(state,'block',owner,victim.pid,weapon,{position:hitPosition});return true;
  }
  if(weapon!=='blades'&&!volleyHit(state.volleyHits,volley,victim.pid,victim.spawnSeq||0,weapon,state.nowMs/1000,shot))return false;
  if(victim.guard){victim.guard=false;pushEvent(state,'block',owner,victim.pid,weapon,{position:hitPosition});return true;}
  const health=Number.isFinite(victim.health)?victim.health:COMBAT.maxHealth;
  const taken=Math.min(health,amount);victim.health=Math.max(0,health-taken<1e-8?0:health-taken);
  pushEvent(state,'hit',owner,victim.pid,weapon,{damage:taken,health:victim.health,maxHealth:COMBAT.maxHealth,position:hitPosition});
  if(victim.health===0)knockOut(state,victim,owner,weapon,econ);
  else {
    applyStatus(state,victim,weapon);
    const ownerKart=state.karts.find(k=>k.pid===owner),strength=(WEAPON_FEEL[weapon]?.kick||0)*(override==null?1:Math.min(1,override/(damageAt(weapon)||1)));
    if(ownerKart&&strength)bumpAway(state,victim,ownerKart.x,ownerKart.z,strength,tickGeometry.get(state));
  }
  return true;
}

// Pushes stay in the physical authority; prediction receives the resulting velocity.
function bumpAway(state,victim,x,z,strength,geometry){
 if(victim.supernovaT>0||victim.guard||victim.respawn>0)return;
 const dx=victim.x-x,dz=victim.z-z,n=Math.hypot(dx,dz)||1;
 if(victim.physicalPose)geometry?.kickKart?.(victim.pid,{x:dx/n*strength,y:Math.min(1.3,strength*.07),z:dz/n*strength});
 else {victim.speed=(victim.speed||0)+Math.cos(victim.angle-Math.atan2(dx,dz))*strength;victim.slip=(victim.slip||0)+Math.sin(victim.angle-Math.atan2(dx,dz))*strength;}
}
function updateCuratedStatus(state,connected,dt,econ,geometry){
 for(const k of state.karts){
  if(!connected.has(k.pid)||k.respawn>0)continue;
  const me=k.physicalPose?physicalHullCenter(k):{x:k.x,y:0,z:k.z};
  if(k.bladesT>0){
   const h=Math.min(dt,k.bladesT),age=k.bladesAge||0;k.bladesAge=age+h;k.bladesT=Math.max(0,k.bladesT-dt);
   for(const v of state.karts){
    if(v===k||!connected.has(v.pid)||v.respawn>0||v.shield>0)continue;
    const p=v.physicalPose?physicalHullCenter(v):{x:v.x,y:0,z:v.z};let touch=false;
    for(let n=0;n<3&&!touch;n++)for(let j=0;j<=Math.ceil(h/.03);j++){
     const a=(age+Math.min(h,j*.03))*W.blades.turnRate+n*Math.PI*2/3;
     if(Math.hypot(p.x-me.x-Math.cos(a)*2.2,p.y-me.y,p.z-me.z-Math.sin(a)*2.2)<2.25){touch=true;break;}
    }
    if(touch&&!(geometry?.sweepStatic?.(me,p))&&!splashBlocked(me.x,me.z,p.x,p.z,state.blocks))bladeContact(k,v.pid,v.spawnSeq||0,()=>damage(state,v,k.pid,'blades',connected,econ,k.bladesVolley));
   }
   if(k.bladesT===0){k.bladesVolley=null;k.bladesHits=null;}
  }
  if(k.supernovaT>0){
   for(const rival of state.karts){
    if(rival===k||!connected.has(rival.pid)||rival.respawn>0||rival.shield>0)continue;
    const p=rival.physicalPose?physicalHullCenter(rival):{x:rival.x,y:0,z:rival.z};
    if(Math.hypot(p.x-me.x,p.y-me.y,p.z-me.z)<W.supernova.contactRadius &&
       !(geometry?.sweepStatic?.(me,p))&&!splashBlocked(me.x,me.z,p.x,p.z,state.blocks))
      damage(state,rival,k.pid,'supernova',connected,econ,k.supernovaVolley,W.supernova.contactDamage);
   }
   k.supernovaT=Math.max(0,k.supernovaT-dt);if(k.supernovaT===0){
   detonateArea(state,me,k.pid,'supernova',connected,econ,k.supernovaVolley,geometry);
   k.supernovaVolley=null;
  }}
 }
}

/* Safe respawn: the farthest legal pool candidate from the other live
 * karts (never inside blocks/bounds by pool construction, never
 * overlapping a live kart when any legal candidate exists). When every
 * candidate is crowded, take the maximum-clearance one and rely on the
 * fresh spawn shield. Sequential processing reserves each pick: a kart
 * respawned earlier this tick already counts as live for the next one,
 * so simultaneous KOs never telefrag. */
function respawnPose(state, kart) {
  const pool = state.spawns && state.spawns.length
    ? state.spawns
    : [{ x: 0, z: -12, angle: 0 }];
  const others = state.karts.filter((k) => k.pid !== kart.pid && (Number(k.respawn) || 0) <= 0);
  let best = pool[0];
  let bestClear = -Infinity;
  let bestLegal = -Infinity;
  let bestLegalPose = null;
  for (const pose of pool) {
    let clear = Infinity;
    for (const o of others) clear = Math.min(clear, Math.hypot(o.x - pose.x, o.z - pose.z));
    if (clear > bestClear) { bestClear = clear; best = pose; }
    if (clear >= RESPAWN_CLEAR && clear > bestLegal) { bestLegal = clear; bestLegalPose = pose; }
  }
  return bestLegalPose || best;
}

function respawnKart(state, kart) {
  cancelPayload(kart);
  resetFireInput(kart);
  const pose = respawnPose(state, kart);
  kart.x = pose.x;
  kart.z = pose.z;
  kart.angle = pose.angle;
  kart.speed = 0;
  kart.slip = 0;
  kart.boost = 0;
  kart.boostCd = 0;
  kart.turbo = 0;
  kart.padCd = 0;
  kart.drifting = false;
  kart.driftCharge = 0;
  kart.weapon = null;
  kart.ammo = 0;
  kart.shield = SPAWN_SHIELD;
  kart.guard = false;
  kart.volley = null;
  kart.health = COMBAT.maxHealth;
  kart.fireCd = 0;
  kart.nitro = 1;
  kart.nitroActive = false;
  kart.nitroLocked = false;
  clearStatus(kart);
  kart.spawnSeq = (Number(kart.spawnSeq) || 0) + 1;
  // The fresh life starts fully neutral: dead-life motion state is
  // already zeroed above, and the input, edge tracker, and latch reset
  // here so only a NEW live intent can drive or fire it.
  kart.input = { steer: 0, throttle: 0, boost: false };
  kart.prevAction = false;
  kart.pendingFire = false;
  kart.machineHeld = false;
  pushEvent(state, 'respawn', kart.pid);
}

function zapTtlFor(kind) {
  if (kind === 'laser') return LASER_TTL;

  if (kind === 'bouncer') return BOUNCER_TTL;
  if (kind === 'trishot') return SCATTER_TTL;
  if (kind === 'cannon') return ROCKET_TTL;
  if (kind === 'missile') return SEEKER_TTL;
  return PULSE_TTL;
}

// The render model sits modelOriginY below the physical chassis. Only
// physical-mode shots use full xyz motion; legacy variants stay planar.
function rotateFire(v, q) {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {x:v.x+q.w*tx+q.y*tz-q.z*ty,
    y:v.y+q.w*ty+q.z*tx-q.x*tz,
    z:v.z+q.w*tz+q.x*ty-q.y*tx};
}

function fireMount(state, start, kind, fireGeometry, yawOffset=0) {
  const pose = start.physicalPose;
  // Authored 3D mounts belong to actual physical motion. Generic planar
  // factories retain their established central two-unit launch origin.
  if (!pose || typeof fireGeometry?.sweepStatic !== 'function') return null;
  const primaryOffset = ['machinegun','trishot','missile','cannon'].includes(muzzleOf(kind)) ? CURATED_MUZZLE : PHYSICS.combat[muzzleOf(kind) + 'Muzzle'];
  const offset=kind==='trishot'&&yawOffset?{...primaryOffset,x:primaryOffset.x+Math.sign(yawOffset)*.2}:primaryOffset;
  if (!offset) return null;
  const q = pose.rotation;
  const p = pose.position;
  const originOffset = rotateFire({x:offset.x,y:offset.y,z:0}, q);
  const muzzleOffset = rotateFire(offset, q);
  const origin = {x:p.x+originOffset.x,y:p.y+originOffset.y,z:p.z+originOffset.z};
  const muzzle = {x:p.x+muzzleOffset.x,y:p.y+muzzleOffset.y,z:p.z+muzzleOffset.z};
  const direction = weaponForward(q,yawOffset);
  const radius=LOBBED[kind]?GRENADE_R:(COMBAT.staticSweepRadii[kind]||0);
  const blocked = !!(fireGeometry.sweepStatic(origin,{x:origin.x,y:origin.y+1e-6,z:origin.z},radius)||fireGeometry.sweepStatic(origin,muzzle,radius));
  return {origin,muzzle,direction,velocity:pose.linearVelocity||{x:0,y:0,z:0},physical:true,blocked};
}

function launchZap(state, kart, start, angle, kind, volley=null, geometry=null, extra=null) {
  // Level shots follow the ground height at launch.
  if (geometry?.physical && kind === 'bouncer') {
    const n = Math.hypot(geometry.direction.x, geometry.direction.z) || 1;
    geometry = {...geometry, direction: {x: geometry.direction.x / n, y: 0, z: geometry.direction.z / n}};
  }
  const mountAngle=kind==='machinegun'?kart.angle:angle;
  state.zapSeq += 1;
  state.zaps.push({...extra,
    id: 'z' + state.zapSeq,
    owner: kart.pid,
    kind,
    x: geometry ? geometry.muzzle.x : start.x + Math.sin(mountAngle) * 2,
    z: geometry ? geometry.muzzle.z : start.z + Math.cos(mountAngle) * 2,
    ...(!geometry?{vx:Math.sin(angle)*zapSpeed({kind})+Math.sin(kart.angle)*(kind==='cannon'?0:kart.speed||0),vz:Math.cos(angle)*zapSpeed({kind})+Math.cos(kart.angle)*(kind==='cannon'?0:kart.speed||0),vy:kind==='cannon'?W.cannon.launchY:0,y:1.2}:{}),
    ...(geometry?.physical ? {physical:true,radius:COMBAT.staticSweepRadii[kind]||0,y:geometry.muzzle.y,
      ...(()=>{const v=launchVelocity(geometry.direction,zapSpeed({kind}),kind==='cannon'?undefined:geometry.velocity,kind==='cannon'?W.cannon.launchY:0);return {vx:v.x,vy:v.y,vz:v.z};})()} : {}),
    angle:geometry?Math.atan2(geometry.direction.x,geometry.direction.z):angle,
    ...(kind==='missile'?{age:0}:{}),
    ...(payloads.get(kart)?.started?{stepDt:Math.max(0,-kart.fireCd)}:{}),
    ttl: zapTtlFor(kind),
    ...(volley?{volley}:{}),
  });
}

/* Effective fire cooldown: Pulse0.12s, other items0.4s; minus6% per reload
 * level (0..3) when the garage applies. Classic (state.garage !== true)
 * and fixtures without upgrades always get the flat base. */
function fireCooldownFor(state, kart) {
  const mine=kart.weapon==='mine'&&!!kart.physicalPose;
  const base=COMBAT.weapons[kart.weapon]?.cooldown??(mine?COMBAT.weapons[kart.weapon].dropInterval:FIRE_CD);
  if(mine)return base;
  if (!state || state.garage !== true) return base;
  const up = kart && kart.upgrades && typeof kart.upgrades === 'object' ? kart.upgrades : null;
  const lvl = up ? clampNum(Math.floor(Number(up.reload) || 0), 0, 3) : 0;
  return base * (1 - 0.06 * lvl);
}

/* Legal ground for a mine: a few bounded candidates straight behind the
 * owner's tick-start pose, falling back toward that known-legal pose
 * itself (distance 0). Every candidate is clamped to the arena and kept
 * clear of block faces. Physical drops stay strictly behind the owner;
 * planar compatibility may fall back to its own center. With no legal
 * spot the item stays loaded (or an accepted payload retries until its
 * deadline). Checks use bounded distances along the current rearward line. */
function mineSpot(state, kart, start, fireGeometry) {
  const bound = Number(state.bound) > 0 ? Number(state.bound) : 28;
  const blocks = Array.isArray(state.blocks) ? state.blocks : [];
  const fx = Math.sin(start.angle??kart.angle);
  const fz = Math.cos(start.angle??kart.angle);
  const physical=!!start.physicalPose&&typeof fireGeometry?.sweepStatic==='function';
  for (const d of physical?[2,3.2,4.4,5.6,1.2,.6]:[2,1.2,.6,0]) {
    const x = physical ? start.x-fx*d : clampNum(start.x-fx*d,-bound,bound);
    const z = physical ? start.z-fz*d : clampNum(start.z-fz*d,-bound,bound);
    // Clamping a rearward candidate at the boundary can collapse it beneath
    // the owner. Physical placements retain their actual rearward line.
    if(physical&&(Math.abs(x)>bound||Math.abs(z)>bound))continue;
    let inside = false;
    for (const b of blocks) {
      if (!b) continue;
      if (Math.abs(x - b.x) < (Number(b.hw) || 0) + MINE_CLEAR &&
          Math.abs(z - b.z) < (Number(b.hd) || 0) + MINE_CLEAR) {
        inside = true;
        break;
      }
    }
    if(physical&&state.mines.some(m=>Math.hypot(x-m.x,z-m.z)<COMBAT.weapons.mine.bodyRadius*2+.12))continue;
    if (!inside) {
      if (start.physicalPose && fireGeometry?.groundAt && fireGeometry?.supportAt) {
        const ground = fireGeometry.groundAt(x,z);
        const support = fireGeometry.supportAt({x,y:ground+1,z},2);
        if (!support || support.normal.y < .5) continue;
        // A small query skin keeps supported endpoint contact with the floor
        // from masquerading as a blocker before the end of the drop path.
        const hit=fireGeometry.sweepStatic(start.physicalPose.position,{x,y:support.point.y+COMBAT.weapons.mine.bodyRadius+.03,z},COMBAT.weapons.mine.bodyRadius);
        if(hit&&hit.fraction<1-1e-5)continue;
        return {x,z,y:support.point.y,physical:true};
      }
      return { x, z };
    }
  }
  return null;
}

/* The tracking blaster scans all around. Homing missiles scan ahead. */
function seekerLock(state, kart, from, direction, connected, fireGeometry, rule=W.missile) {
  let best=null,bestD=Infinity;
  const fx=direction?direction.x:Math.sin(kart.angle),fz=direction?direction.z:Math.cos(kart.angle);
  const physical=!!kart.physicalPose&&typeof fireGeometry?.sweepStatic==='function';
  for(const k of state.karts) {
    if(!rivals(state,kart.pid,k.pid)||!connected.has(k.pid)||(Number(k.respawn)||0)>0||(Number(k.shield)||0)>0)continue;
    const to=physical?physicalHullCenter(k):{x:k.x,z:k.z};
    const dx=to.x-from.x,dz=to.z-from.z,dy=physical?to.y-from.y:0,d=Math.hypot(dx,dy,dz);
    if(!inWeaponCone(from,direction||{x:fx,y:0,z:fz},to,rule.range,rule.halfAngle))continue;
    if(physical?fireGeometry.sweepStatic(from,to):splashBlocked(from.x,from.z,to.x,to.z,state.blocks))continue;
    if(d<bestD){bestD=d;best=k;}
  }
  return best;
}

/* Thunder has no fallback target. A miss is a visible ground strike. */

// The tick's economy handle, for spends that score at once (Thunder).
const tickEcon = new WeakMap(),tickGeometry=new WeakMap();
function econOf(state){return tickEcon.get(state)||null;}

/* Spend the loaded item on a rising edge. Offensive launches drop spawn
 * protection first; Supernova starts its timed protection. At a
 * lifecycle cap, or with no legal ground for a mine or charge, the item is
 * KEPT (no consume, no cooldown, no event): the driver retries on the next
 * fresh press. Every ACCEPTED spend emits exactly one event ('fire' with
 * the weapon or 'mine') so the root plays one sound per
 * acceptance; blasts add their own bounded 'blast' records later. */
function tryFire(state, kart, start, connected, fireGeometry) {
  const weapon = kart.weapon = normalizeWeapon(kart.weapon);
  if (!W[weapon] || (Number(kart.ammo) || 0) <= 0 || kart.fireCd > 1e-8) return;
  let geometry = SHOT_WEAPONS.includes(weapon)
    ? fireMount(state,{...start,angle:start.angle??kart.angle},weapon,fireGeometry) : null;
  if (geometry?.blocked) return;
  const cd = fireCooldownFor(state, kart);
  const volley=kart.volley||(kart.volley='v'+(state.volleySeq=(state.volleySeq||0)+1));
  if (weapon === 'supernova') {
    kart.supernovaT=W.supernova.duration; kart.supernovaVolley=volley;
    kart.guard = false;
    kart.ammo = 0;
    kart.weapon = null;
    kart.fireCd = cd;
    pushEvent(state, 'fire', kart.pid, undefined, 'supernova');
    return true;
  }
  if(weapon==='blades'){kart.bladesT=W.blades.duration;kart.bladesAge=0;kart.bladesVolley=volley;kart.bladesHits=new Map();kart.shield=0;kart.ammo=0;kart.weapon=null;pushEvent(state,'fire',kart.pid,undefined,'blades');return true;}
  if (weapon === 'machinegun' || weapon === 'cannon' || weapon === 'laser' || weapon === 'bouncer') {
    if (state.zaps.length + 1 > MAX_ZAPS) return;
    kart.shield = 0;
    // A Boomerang curves to the side it was not last thrown toward.
    const extra = weapon === 'bouncer' ? {bounces:0} : null;
    let angle=kart.angle;
    if(weapon==='machinegun'){
      const from=geometry?.muzzle||{x:start.x+2*Math.sin(angle),y:0,z:start.z+2*Math.cos(angle)};
      const target=seekerLock(state,kart,from,geometry?.direction,connected,fireGeometry,W.machinegun);
      if(target){
        const at=geometry?physicalHullCenter(target):{x:target.x,y:0,z:target.z};
        const x=at.x-from.x,y=at.y-from.y,z=at.z-from.z,n=Math.hypot(x,y,z);
        if(geometry)geometry={...geometry,direction:{x:x/n,y:y/n,z:z/n}};
        angle=Math.atan2(x,z);
      }
    }
    launchZap(state,kart,start,angle,weapon,volley,geometry,extra);
    kart.ammo -= 1;
    const accepted=geometry?{position:geometry.muzzle,direction:geometry.direction}:weapon==='machinegun'?{
      position:{x:start.x+2*Math.sin(kart.angle),y:1.2,z:start.z+2*Math.cos(kart.angle)},
      direction:{x:Math.sin(angle),y:0,z:Math.cos(angle)}
    }:undefined;
    pushEvent(state,'fire',kart.pid,undefined,weapon,accepted);
  } else if (weapon === 'trishot') {
    if (state.zaps.length + SCATTER_FAN.length > MAX_ZAPS) return;
    kart.shield = 0;
    for(const off of SCATTER_FAN){const ray=geometry?fireMount(state,start,'trishot',fireGeometry,off):null;if(!ray?.blocked)launchZap(state,kart,start,kart.angle+off,'trishot',volley,ray);}
    kart.ammo -= 3;
    pushEvent(state, 'fire', kart.pid, undefined, 'trishot',geometry?{position:geometry.muzzle,direction:geometry.direction}:undefined);
  } else if (weapon === 'missile') {
    if (state.zaps.length + 1 > MAX_ZAPS) return;
    kart.shield = 0;
    const from = geometry ? geometry.muzzle : {x:start.x+Math.sin(kart.angle)*2,z:start.z+Math.cos(kart.angle)*2};
    // Reserve a launch-time lock only. No lock means straight flight forever.
    const lock=seekerLock(state,kart,from,geometry?.direction,connected,fireGeometry);
    launchZap(state,kart,start,kart.angle,'missile',volley,geometry,{targetId:lock?.pid??null,targetLife:lock?(lock.spawnSeq||0):null,acquired:true});
    kart.ammo -= 1;
    pushEvent(state,'fire',kart.pid,undefined,'missile',{...(geometry?{position:geometry.muzzle,direction:geometry.direction}:{}),...(lock?{targetId:lock.pid}:{})});
  } else if (weapon === 'ram') {
    kart.shield = 0;
    kart.rammingT = RAM_TIME;
    kart.ramVolley = volley;
    kart.ammo -= 1;
    pushEvent(state, 'fire', kart.pid, undefined, 'ram');
  } else if (weapon === 'mine' || weapon === 'proximity' || weapon === 'fakecrate') {
    if (state.mines.length >= MAX_MINES) return;
    const payload=payloads.get(kart);
    if(payload&&!payload.started){
      const reserved=state.karts.reduce((n,k)=>n+(payloads.get(k)?.weapon==='mine'?Math.max(0,k.ammo||0):0),0);
      if(state.mines.length+reserved>MAX_MINES)return;
    }
    if(payload?.lastDrop && Math.hypot(start.x-payload.lastDrop.x,start.z-payload.lastDrop.z)<W.mine.spacing)return;
    const spot = mineSpot(state, kart, start, fireGeometry);
    if (!spot) return; // no legal ground: keep the item and the shield
    kart.shield = 0;
    if(payload && weapon==='mine')payload.lastDrop={x:start.x,z:start.z};
    state.mineSeq += 1;
    state.mines.push({
      id: 'm' + state.mineSeq,
      owner: kart.pid,
      ...(weapon === 'mine' ? {} : {kind:weapon}),
      x: spot.x,
      z: spot.z,
      ...(spot.physical ? {physical:true,y:spot.y} : {}),
      armT: W[weapon].armTime,
      armed: false,
      ttl: W[weapon].lifetime,
    });
    kart.ammo -= 1;
    pushEvent(state, weapon === 'mine' ? 'mine' : 'fire', kart.pid, undefined, weapon,spot.physical?{position:{x:spot.x,y:spot.y,z:spot.z}}:undefined);
  } else if (weapon === 'nuke' || weapon === 'frost' || weapon === 'cluster') {
    if (!Array.isArray(state.grenades)) state.grenades = [];
    // A Cluster reserves room for its bomblets as well as its own canister.
    const room = weapon === 'cluster' ? 1 + LEGACY.cluster.bomblets : 1;
    if (state.grenades.length + room > MAX_GRENADES) return; // cap: keep item/shield/cooldown
    kart.shield = 0;
    state.grenadeSeq += 1;
    const fx = Math.sin(kart.angle);
    const fz = Math.cos(kart.angle);
    state.grenades.push({
      id: 'g' + state.grenadeSeq,
      owner: kart.pid,
      kind: weapon,
      ...(volley ? {volley} : {}),
      x: geometry ? geometry.muzzle.x : start.x + fx * 2,
      z: geometry ? geometry.muzzle.z : start.z + fz * 2,
      y: geometry ? geometry.muzzle.y - GRENADE_R : GRENADE_Y0,
      ...(geometry ? {physical:true,groundY:fireGeometry.groundAt?.(geometry.muzzle.x,geometry.muzzle.z)||0} : {}),
      angle: kart.angle,
      vx: (geometry ? geometry.direction.x : fx) * GRENADE_SPEED,
      vz: (geometry ? geometry.direction.z : fz) * GRENADE_SPEED,
      vy: GRENADE_VY0 + (geometry ? geometry.direction.y * GRENADE_SPEED : 0),
      fuse: LOBBED[weapon].fuse,
      bounces: 0,
    });
    kart.ammo -= 1;
    pushEvent(state, 'fire', kart.pid, undefined, weapon,geometry?{position:geometry.muzzle,direction:geometry.direction}:undefined);
  } else {
    return; // unknown item: keep the slot, never crash the tick
  }
  // One emission maximum per existing tick; bounded cooldown carry preserves
  // cadence without replaying a scheduling pause as a simultaneous burst.
  kart.fireCd = payloads.has(kart)?cd+Math.max(-cd,Math.min(0,kart.fireCd)):cd;
  if (kart.ammo <= 0) {
    kart.ammo = 0;
    kart.machineHeld = false;
    kart.weapon = null; // slot empties: the next crate may refill it
  }
  return true;
}

function firePayload(state,kart,start,connected,geometry,pressed) {
  kart.weapon=normalizeWeapon(kart.weapon);
  let payload=payloads.get(kart);
  if(payload&&(payload.life!==(kart.spawnSeq||0)||payload.epoch!==(kart.controlEpoch||0)||payload.poseEpoch!==kart.physicalPose?.epoch||
    payload.weapon!==kart.weapon||state.nowMs>=payload.deadline)){
    cancelPayload(kart);payload=null;
    // The same tick cannot reinterpret an old press as a new payload.
    return;
  }
  if(payload){
    // Keep the 12 Hz stream when snapshots/ticks arrive at 10 Hz. At most
    // four due emissions on a clamped tick; each flies only its own elapsed
    // fraction, so this never stacks a burst at the far endpoint.
    for(let n=0;n<4&&kart.weapon&&kart.fireCd<=1e-8;n++){
      if(!tryFire(state,kart,start,connected,geometry))break;
    }
  }
  else if(pressed){
    const physical=!!kart.physicalPose&&typeof geometry?.sweepStatic==='function';
    if(physical&&PAYLOAD_WEAPONS.has(kart.weapon)){
      payload={weapon:kart.weapon,life:kart.spawnSeq||0,epoch:kart.controlEpoch||0,poseEpoch:kart.physicalPose.epoch,deadline:state.nowMs+8000};
      payloads.set(kart,payload);
      if(!tryFire(state,kart,start,connected,geometry))payloads.delete(kart);
      else payload.started=true;
    }else tryFire(state,kart,start,connected,geometry);
  }
  if(!(kart.ammo>0)||!kart.weapon)payloads.delete(kart);
}

/* Times along a tick's 0..1 path. Sweeping relative motion catches a
 * moving hull, a grazing shot, and a shot born inside a hull. */
function hullImpact(from, to, before, after) {
  const x = from.x - before.x, z = from.z - before.z;
  const dx = to.x - after.x - x, dz = to.z - after.z - z;
  const c = x * x + z * z - ZAP_HIT_R2;
  if (c <= 0) return 0;
  const a = dx * dx + dz * dz;
  if (a <= 1e-12) return null;
  const b = 2 * (x * dx + z * dz);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

function physicalHullCenter(kart) {
  const pose = kart.physicalPose;
  if (!pose) return {x:kart.x,y:-PHYSICS.chassis.modelOriginY+.35,z:kart.z};
  const up = rotateFire({x:0,y:.35,z:0},pose.rotation);
  return {x:pose.position.x+up.x,y:pose.position.y+up.y,z:pose.position.z+up.z};
}

function physicalHullImpact(from, to, before, after) {
  const aCenter=physicalHullCenter(before),bCenter=physicalHullCenter(after);
  let a=0,b=0,c=-ZAP_HIT_R2;
  for (const axis of ['x','y','z']) {
    const x=from[axis]-aCenter[axis],d=to[axis]-bCenter[axis]-x;
    a+=d*d;b+=2*x*d;c+=x*x;
  }
  if(c<=0)return 0;
  if(a<=1e-12)return null;
  const disc=b*b-4*a*c;
  if(disc<0)return null;
  const t=(-b-Math.sqrt(disc))/(2*a);
  return t>=0&&t<=1?t:null;
}

function boxInterval(from, to, box) {
  let enter = 0, exit = 1;
  for (const [axis, half] of [['x', 'hw'], ['z', 'hd']]) {
    const start = from[axis], delta = to[axis] - start;
    const low = box[axis] - box[half], high = box[axis] + box[half];
    if (Math.abs(delta) <= 1e-12) {
      if (start < low || start > high) return null;
      continue;
    }
    const a = (low - start) / delta, b = (high - start) / delta;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (enter > exit) return null;
  }
  return { enter, exit };
}

function zapSpeed(zap) {
  if (!zap) return PULSE_SPEED;
  if (zap.kind === 'laser') return LASER_SPEED;

  if (zap.kind === 'bouncer') return BOUNCER_SPEED;
  if (zap.kind === 'trishot') return SCATTER_SPEED;
  if (zap.kind === 'cannon') return ROCKET_SPEED;
  if (zap.kind === 'missile') return SEEKER_SPEED;
  return PULSE_SPEED;
}

/* Rocket splash line-of-sight: true when a solid block lies strictly
 * between the blast point and the victim center. Touching the blast
 * face itself (enter ~0) never blocks; reaching THROUGH a block does.
 * Both points are inside the convex arena, so walls need no check. */
function splashBlocked(ix, iz, kx, kz, blocks) {
  if (!blocks) return false;
  const from = { x: ix, z: iz };
  const to = { x: kx, z: kz };
  for (const b of blocks) {
    if (!b) continue;
    const iv = boxInterval(from, to, b);
    if (iv && iv.enter > 1e-9 && iv.enter < 1 - 1e-9) return true;
  }
  return false;
}

/* Mine trigger sweep: earliest t in [t0,t1] where the kart segment
 * B->A comes within the 2.2u trigger radius of the mine, or null.
 * Strict < R2 matches the historical endpoint test. Stationary karts
 * (or fixtures without previousKarts) reduce to the endpoint check. */
function mineEntryTime(bx, bz, ax, az, mx, mz, t0, t1, by=0, ay=0, my=0, r2=MINE_R2) {
  const dx = ax - bx;
  const dz = az - bz;
  const dy = ay - by;
  const fx = bx - mx;
  const fz = bz - mz;
  const fy = by - my;
  const a = dx * dx + dz * dz + dy * dy;
  if (a <= 1e-12) {
    return fx * fx + fz * fz + fy * fy < r2 ? t0 : null;
  }
  const px0 = bx + dx * t0;
  const pz0 = bz + dz * t0;
  const py0 = by + dy * t0;
  if ((px0 - mx) ** 2 + (pz0 - mz) ** 2 + (py0 - my) ** 2 < r2) return t0;
  const c = fx * fx + fz * fz + fy * fy - r2;
  const b = 2 * (fx * dx + fz * dz + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc <= 1e-9) return null; // exact tangency never enters the strict trigger disk
  const sqrt = Math.sqrt(disc);
  const tEnter = (-b - sqrt) / (2 * a);
  const tExit = (-b + sqrt) / (2 * a);
  if (tExit < t0 || tEnter > t1) return null;
  const t = Math.max(tEnter, t0);
  if (t > t1) return null;
  return t;
}

/* Kart path through solid ground: true when the straight B->trigger leg
 * crosses a block interior. The sim already slides karts around solids,
 * so a chord cutting through a block means the trigger point is on the
 * far side of cover the kart never touched — never a real drive-over. */
function minePathBlocked(bx, bz, px, pz, blocks) {
  if (!blocks) return false;
  const from = { x: bx, z: bz };
  const to = { x: px, z: pz };
  for (const b of blocks) {
    if (!b) continue;
    const iv = boxInterval(from, to, b);
    if (iv && iv.enter > 1e-9 && iv.enter < 1 - 1e-9) return true;
  }
  return false;
}

/* Rockets and seekers: the direct victim and every nearby visible victim
 * take smooth radial HP damage. The splash respects 3D cover,
 * ownership, protection and active lives. */
function detonateArea(state,origin,owner,weapon,connected,econ,volley=null,geometry=null,direct=null,directAmount=null,shot=null) {
  const radius=W[weapon].splashRadius;
  pushEvent(state,'blast',owner,null,weapon,{x:origin.x,z:origin.z,position:origin,radius});
  for(const kart of state.karts){
    if(kart===direct){damage(state,kart,owner,weapon,connected,econ,volley,directAmount,shot);continue;}
    const p=kart.physicalPose?physicalHullCenter(kart):{x:kart.x,y:0,z:kart.z};
    const d=Math.hypot(p.x-origin.x,p.y-origin.y,p.z-origin.z),amount=blastDamage(weapon,d,radius);
    if(!(amount>0))continue;
    if(kart.physicalPose&&geometry?.sweepStatic){
      const n=d>1e-6?Math.min(.03,d*.5)/d:0;
      if(geometry.sweepStatic({x:origin.x+(p.x-origin.x)*n,y:origin.y+(p.y-origin.y)*n,z:origin.z+(p.z-origin.z)*n},p))continue;
    }else if(splashBlocked(origin.x,origin.z,p.x,p.z,state.blocks))continue;
    damage(state,kart,owner,weapon,connected,econ,volley,amount,shot);
  }
}
function detonateRocket(state,zap,ix,iz,connected,econ,direct=null,position=null,fireGeometry=null){
 const weapon=zap.kind==='missile'?'missile':'cannon';
 detonateArea(state,position||{x:ix,y:0,z:iz},zap.owner,weapon,connected,econ,zap.volley,fireGeometry,direct,null,zap.id);
}

/* Turn a missile toward its locked rival by at most SEEKER_TURN*dt. A lock
 * on a rival who was knocked out, respawned or went offline is dropped and
 * the missile flies straight. */
function steerSeeker(state, zap, connected, dt, geometry) {
  if (!zap.targetId) return;
  const target = state.karts.find((k) => k.pid === zap.targetId);
  if (!target || !connected.has(target.pid) || (Number(target.respawn) || 0) > 0 || (target.spawnSeq || 0) !== zap.targetLife) {
    zap.targetId = null; zap.targetLife = null; return;
  }
  const maxTurn = SEEKER_TURN * Math.max(0, dt);
  if (zap.physical) {
    const to = physicalHullCenter(target), v = {x:zap.vx,y:zap.vy,z:zap.vz};
    const d = {x:to.x-zap.x,y:to.y-zap.y,z:to.z-zap.z};
    const speed = Math.hypot(v.x,v.y,v.z), range = Math.hypot(d.x,d.y,d.z);
    if (speed < 1e-8 || range < 1e-8) return;
    const u = {x:v.x/speed,y:v.y/speed,z:v.z/speed}, w = {x:d.x/range,y:d.y/range,z:d.z/range};
    const cos = clampNum(u.x*w.x+u.y*w.y+u.z*w.z,-1,1), angle = Math.acos(cos);
    let next = w;
    if (angle > maxTurn) {
      const p = {x:w.x-u.x*cos,y:w.y-u.y*cos,z:w.z-u.z*cos}, n = Math.hypot(p.x,p.y,p.z);
      if (n < 1e-8) return;
      next = {x:u.x*Math.cos(maxTurn)+p.x/n*Math.sin(maxTurn),y:u.y*Math.cos(maxTurn)+p.y/n*Math.sin(maxTurn),z:u.z*Math.cos(maxTurn)+p.z/n*Math.sin(maxTurn)};
    }
    zap.vx = next.x*speed; zap.vy = next.y*speed; zap.vz = next.z*speed;
    zap.angle = Math.atan2(zap.vx, zap.vz);
    return;
  }
  const want = Math.atan2(target.x - zap.x, target.z - zap.z);
  let delta = want - zap.angle;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  zap.angle += clampNum(delta, -maxTurn, maxTurn);zap.vx=Math.sin(zap.angle)*SEEKER_SPEED;zap.vz=Math.cos(zap.angle)*SEEKER_SPEED;
}

/* Boomerang flight: curve out to one side for outTime, then home on the
 * thrower's hull. With no live thrower it keeps circling until its TTL. */




/* Outward planar normal at a wall/cover contact point. */
function planarNormal(p, bound, blocks, vx, vz) {
  let best = null, bestGap = Infinity;
  for (const b of blocks || []) {
    if (!b) continue;
    const hw = Number(b.hw) || 0, hd = Number(b.hd) || 0;
    const gap = Math.max(Math.abs(p.x - b.x) - hw, Math.abs(p.z - b.z) - hd);
    if (gap < bestGap) { bestGap = gap; best = b; }
  }
  const wallGap = bound - Math.max(Math.abs(p.x), Math.abs(p.z));
  if (best && bestGap < wallGap) return grenadeFaceNormal(p.x, p.z, best, Number(best.hw) || 0, Number(best.hd) || 0, vx, vz);
  return Math.abs(p.x) >= Math.abs(p.z) ? {nx: p.x > 0 ? -1 : 1, nz: 0} : {nx: 0, nz: p.z > 0 ? -1 : 1};
}

function numOr(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/* Clamp a grenade body into sane bounds (old fixtures may omit or
 * corrupt fields): positions inside the arena, height/velocities capped,
 * fuse within one fresh fuse, bounces within budget, owner nulled when
 * missing (a null owner simply matches nobody's immunity). Returns false
 * only for non-objects, which the tick drops silently. */
function sanitizeGrenade(state, g, bound) {
  if (!g || typeof g !== 'object') return false;
  if (typeof g.id !== 'string' || !g.id) {
    state.grenadeSeq = (Number(state.grenadeSeq) || 0) + 1;
    g.id = 'g' + state.grenadeSeq;
  }
  const B = (g.physical ? (Number(state.half) || bound+2) : bound) + GRENADE_R;
  g.x = clampNum(numOr(g.x, 0), -B, B);
  g.z = clampNum(numOr(g.z, 0), -B, B);
  g.y = clampNum(numOr(g.y, 0), g.physical ? -999 : 0, g.physical ? 999 : GRENADE_YMAX);
  g.angle = numOr(g.angle, 0);
  g.vx = clampNum(numOr(g.vx, 0), -GRENADE_VMAX, GRENADE_VMAX);
  g.vz = clampNum(numOr(g.vz, 0), -GRENADE_VMAX, GRENADE_VMAX);
  g.vy = clampNum(numOr(g.vy, 0), -GRENADE_VMAX, GRENADE_VMAX);
  g.fuse = clampNum(numOr(g.fuse, GRENADE_FUSE), 0, GRENADE_FUSE);
  g.bounces = clampNum(Math.floor(numOr(g.bounces, 0)), 0, GRENADE_MAX_BOUNCES);
  if (typeof g.owner !== 'string') g.owner = null;
  return true;
}

/* Outward normal of the contacted expanded face. Interior points (a
 * muzzle born inside cover) resolve along the least-penetration axis;
 * exact corner ties oppose the velocity — deterministic, never sticks. */
function grenadeFaceNormal(cx, cz, b, hw, hd, vx, vz) {
  const dx = Math.abs(cx - b.x) - hw;
  const dz = Math.abs(cz - b.z) - hd;
  if (dx > dz) return { nx: cx >= b.x ? 1 : -1, nz: 0 };
  if (dz > dx) return { nx: 0, nz: cz >= b.z ? 1 : -1 };
  if (Math.abs(vx) >= Math.abs(vz)) return { nx: vx >= 0 ? -1 : 1, nz: 0 };
  return { nx: 0, nz: vz >= 0 ? -1 : 1 };
}

/* Face response along an outward normal: the into-face component
 * reflects damped while bounces remain, else dies (slide); the tangent
 * always keeps GRENADE_BOUNCE_PLANAR. Only ever removes energy. */
function grenadeCollideFace(g, nx, nz) {
  const vn = g.vx * nx + g.vz * nz;
  if (vn >= 0) return; // resting contact or moving away
  const tx = g.vx - vn * nx;
  const tz = g.vz - vn * nz;
  if (g.bounces < GRENADE_MAX_BOUNCES) {
    g.bounces += 1;
    g.vx = tx * GRENADE_BOUNCE_PLANAR - vn * GRENADE_FACE_KEEP * nx;
    g.vz = tz * GRENADE_BOUNCE_PLANAR - vn * GRENADE_FACE_KEEP * nz;
  } else {
    g.vx = tx * GRENADE_BOUNCE_PLANAR;
    g.vz = tz * GRENADE_BOUNCE_PLANAR;
  }
}

// Physical canisters sweep their full radius against the same finite
// cover and road triangles as the karts. Contact retains the accepted
// point and discards the remaining substep, like the planar solver.
function stepPhysicalGrenade(g,h,fireGeometry) {
  if (h <= 0) return;
  const from={x:g.x,y:g.y+GRENADE_R,z:g.z};
  g.vy -= GRENADE_GRAVITY*h;
  const to={x:g.x+g.vx*h,y:from.y+g.vy*h,z:g.z+g.vz*h};
  const hit=fireGeometry.sweepStatic(from,to,GRENADE_R);
  if (!hit) {g.x=to.x;g.y=to.y-GRENADE_R;g.z=to.z;}
  else {
    const n=hit.normal;
    g.x=hit.point.x+n.x*.005;
    g.y=hit.point.y+n.y*.005-GRENADE_R;
    g.z=hit.point.z+n.z*.005;
    const vn=g.vx*n.x+g.vy*n.y+g.vz*n.z;
    if (vn<0) {
      const floor=n.y>.5;
      const bounce=g.bounces<GRENADE_MAX_BOUNCES && (!floor || -vn>GRENADE_REST_VY);
      if (bounce) g.bounces++;
      const keep=bounce ? (floor?GRENADE_BOUNCE_VY:GRENADE_FACE_KEEP) : 0;
      g.vx=(g.vx-vn*n.x)*GRENADE_BOUNCE_PLANAR-vn*keep*n.x;
      g.vy=(g.vy-vn*n.y)*GRENADE_BOUNCE_PLANAR-vn*keep*n.y;
      g.vz=(g.vz-vn*n.z)*GRENADE_BOUNCE_PLANAR-vn*keep*n.z;
      if (floor && !bounce) {
        const friction=Math.max(0,1-GRENADE_GROUND_FRICTION*h);
        g.vx*=friction;g.vy*=friction;g.vz*=friction;
      }
    }
  }
  g.groundY=fireGeometry.groundAt?.(g.x,g.z)||0;
}

/* One grenade motion substep (h <= 0.04 s): gravity integrates first,
 * then the planar move sweeps cover (earliest enter wins, contact point
 * kept, remainder discarded — at most 0.88u, once per bounce) and the
 * world walls clamp. Swept segments plus substeps shorter than any cover
 * mean a canister can never tunnel, even on a 0.25 s hitch tick. */
function stepGrenadeSub(g, h, blocks, bound) {
  const px = g.x;
  const pz = g.z;
  g.vy -= GRENADE_GRAVITY * h;
  g.x += g.vx * h;
  g.z += g.vz * h;
  g.y += g.vy * h;
  if (g.y <= 0) {
    g.y = 0;
    if (g.vy < 0) {
      if (g.bounces < GRENADE_MAX_BOUNCES && -g.vy > GRENADE_REST_VY) {
        g.bounces += 1;
        g.vy = -g.vy * GRENADE_BOUNCE_VY;
        g.vx *= GRENADE_BOUNCE_PLANAR;
        g.vz *= GRENADE_BOUNCE_PLANAR;
      } else {
        g.vy = 0;
      }
    }
  }
  if (g.y === 0 && g.vy === 0) {
    const f = Math.max(0, 1 - GRENADE_GROUND_FRICTION * h);
    g.vx *= f;
    g.vz *= f;
  }
  const from = { x: px, z: pz };
  const to = { x: g.x, z: g.z };
  let bestT = Infinity;
  let bestB = null;
  for (const b of blocks) {
    if (!b) continue;
    const hw = (Number(b.hw) || 0) + GRENADE_R;
    const hd = (Number(b.hd) || 0) + GRENADE_R;
    if (!(hw > 0 && hd > 0)) continue;
    const iv = boxInterval(from, to, { x: b.x, z: b.z, hw, hd });
    if (!iv) continue;
    if (iv.enter < bestT) { bestT = iv.enter; bestB = b; }
  }
  if (bestB && bestT <= 1) {
    const hw = (Number(bestB.hw) || 0) + GRENADE_R;
    const hd = (Number(bestB.hd) || 0) + GRENADE_R;
    if (bestT <= 1e-9) {
      // Born inside: snap out to the nearest face along its normal, then
      // bounce/slide — a canister never rests inside cover.
      const n0 = grenadeFaceNormal(px, pz, bestB, hw, hd, g.vx, g.vz);
      if (n0.nx !== 0) g.x = bestB.x + n0.nx * hw;
      else g.z = bestB.z + n0.nz * hd;
      grenadeCollideFace(g, n0.nx, n0.nz);
    } else {
      g.x = px + (g.x - px) * bestT;
      g.z = pz + (g.z - pz) * bestT;
      const n = grenadeFaceNormal(g.x, g.z, bestB, hw, hd, g.vx, g.vz);
      grenadeCollideFace(g, n.nx, n.nz);
    }
  }
  const W = bound - GRENADE_R;
  if (g.x < -W) { g.x = -W; grenadeCollideFace(g, 1, 0); }
  else if (g.x > W) { g.x = W; grenadeCollideFace(g, -1, 0); }
  if (g.z < -W) { g.z = -W; grenadeCollideFace(g, 0, 1); }
  else if (g.z > W) { g.z = W; grenadeCollideFace(g, 0, -1); }
}

/* Detonate a Nuke at its fuse-end position: EVERY vulnerable victim
 * within 14u takes smooth radial damage, up to 120 HP at the centre.
 * Supernova blocks it. Owner, spawn-protected, KO'd, and offline karts
 * are immune. One bounded 'blast' record marks the point even when nobody
 * falls, so the blast is never silent. The flying body itself never
 * scores on contact: splash at fuse only. */
function detonateGrenade(state,g,connected,econ,fireGeometry){
 const weapon=(LOBbed=>LOBbed?.weapon||'nuke')(LOBBED[g.kind]);
 detonateArea(state,{x:g.x,y:g.physical?g.y+GRENADE_R:0,z:g.z},g.owner,weapon,connected,econ,g.volley||null,fireGeometry);
}

/* Cluster burst: the canister pops (no damage) into bomblets that trishot
 * on a fixed fan and go off one after another. Bomblets share the pickup's
 * volley. Retained for already-created legacy canisters only. */
function burstCluster(state, g, keptG) {
  pushEvent(state, 'burst', g.owner, undefined, 'cluster', {x: +g.x.toFixed(2), z: +g.z.toFixed(2), ...(g.physical ? {position: {x: g.x, y: g.y + GRENADE_R, z: g.z}} : {})});
  // The canister reserved its bomblets' room at launch; never exceed the cap.
  const pending = state.grenades.length - state.grenades.indexOf(g) - 1;
  const room = Math.max(0, MAX_GRENADES - keptG.length - pending);
  const count = Math.min(LEGACY.cluster.bomblets, room), spin = Number.isFinite(g.angle) ? g.angle : 0;
  for (let i = 0; i < count; i++) {
    const a = spin + i * Math.PI * 2 / count + .35;
    state.grenadeSeq += 1;
    keptG.push({id: 'g' + state.grenadeSeq, owner: g.owner, kind: 'bomblet', ...(g.volley ? {volley: g.volley} : {}),
      x: g.x, z: g.z, y: g.y, ...(g.physical ? {physical: true, groundY: g.groundY || 0} : {}), angle: a,
      vx: Math.sin(a) * BOMBLET_SPEED + g.vx * .3, vz: Math.cos(a) * BOMBLET_SPEED + g.vz * .3, vy: BOMBLET_VY,
      fuse: BOMBLET_FUSE + BOMBLET_STAGGER * i, bounces: 0});
  }
}

module.exports = {
  key: 'battle',
  label: 'Zap Battle',
  scoreNoun: 'hits',
  respawnPose, respawnKart, cancelPayload, cancelPayloads, fireInputEdge, resetFireInput,

  constants: {
    PICKUP_R2, ZAP_HIT_R2,
    PULSE_SPEED, PULSE_TTL, PULSE_AMMO,
    SCATTER_SPEED, SCATTER_TTL, SCATTER_FAN,
    ROCKET_SPEED, ROCKET_TTL, ROCKET_SPLASH_R, ROCKET_SPLASH_R2,
    SEEKER_SPEED, SEEKER_TTL, SEEKER_RANGE, SEEKER_HALF_ANGLE, SEEKER_TURN, SEEKER_SPLASH_R,
    PROXIMITY_R2, PROXIMITY_SPLASH_R,
    MINE_ARM, MINE_TTL, MINE_R2, MINE_CLEAR, MAX_MINES, MAX_ZAPS, MAX_EVENTS,
    GRENADE_SPEED, GRENADE_VY0, GRENADE_GRAVITY, GRENADE_Y0,
    GRENADE_FUSE, GRENADE_WARN, GRENADE_SPLASH_R, GRENADE_SPLASH_R2,
    GRENADE_BOUNCE_PLANAR, GRENADE_BOUNCE_VY, GRENADE_FACE_KEEP,
    GRENADE_GROUND_FRICTION, GRENADE_MAX_BOUNCES, GRENADE_REST_VY,
    GRENADE_R, GRENADE_YMAX, GRENADE_VMAX, GRENADE_STEP, MAX_GRENADES,
    WEAPON_ORDER, WEAPON_WEIGHTS,
    LASER_SPEED, LASER_TTL, BOUNCER_SPEED, BOUNCER_TTL, BOUNCER_BOUNCES,
    SPIN_TIME, SPIN_KICK, FROST_TIME, RAM_TIME, RAM_REACH,
    BOMBLET_FUSE, BOMBLET_STAGGER, BOMBLET_SPEED, BOMBLET_VY,
    FIRE_CD, SPAWN_SHIELD, RESPAWN_TIME, RESPAWN_CLEAR,
    COIN_KO, COIN_PICKUP,
  },

  blankKart() {
    return {
      hits: 0, ammo: 0, weapon: null, volley: null, health:COMBAT.maxHealth, maxHealth:COMBAT.maxHealth, guard: false,
      shield: SPAWN_SHIELD, respawn: 0, spawnSeq: 0, deaths: 0,
      frostT: 0, spinT: 0, rammingT: 0, ramVolley: null, spinKick: 0,
      fireCd: 0, prevAction: false, pendingFire: false, machineHeld: false,
    };
  },

  createExtra(state) {
    state.zaps = [];
    state.zapSeq = 0;
    state.volleyHits = new Map();
    state.volleySeq = 0;
    state.nowMs = 0;
    state.mines = [];
    state.mineSeq = 0;
    state.grenades = [];
    state.grenadeSeq = 0;
    state.events = [];
    state.eventSeq = 0;
    // Mystery-item crates: clamp(4+drivers, 6, 10), on random validated
    // sockets with unique ids. Every rematch rebuilds from the new seed.
    state.crates = [];
    state.crateSeq = 0;
    const count = clampNum(4 + state.karts.length, 6, 10);
    for (let i = 0; i < count; i++) {
      const spot = pickSocket(state, state.crates, null);
      if (!spot) break;
      state.crateSeq += 1;
      state.crates.push({ id: 'c' + state.crateSeq, x: spot.x, z: spot.z });
    }
  },

  tick(state, connected, dt, previousKarts, econ, contacts=new Map(), fireGeometry) {
    if(state.phase&&state.phase!=='drive'){cancelPayloads(state);return false;}
    state.nowMs=Number.isFinite(state.lastTick)?state.lastTick:(state.nowMs||0)+dt*1000;
    tickGeometry.set(state,fireGeometry);if(econ)tickEcon.set(state,econ);else tickEcon.delete(state);
    if(!(state.volleyHits instanceof Map))state.volleyHits=new Map();
    const bound = Number(state.bound) > 0 ? Number(state.bound) : 28;
    const blocks = state.blocks;
    // Rising edges, respawns, fire, and pickups in stable roster order so
    // competing claims resolve deterministically exactly once.
    for (const kart of state.karts) {
      kart.weapon=normalizeWeapon(kart.weapon);
      // The receipt latch fires a short press even when a newer neutral
      // intent already replaced it; the direct edge keeps test fixtures
      // that set inputs without onAction working. Consumed once per tick.
      const pressed = kart.pendingFire === true ||
        (!fireButtons.has(kart) && kart.input.boost === true && kart.prevAction !== true);
      kart.pendingFire = false;
      kart.prevAction = kart.input.boost === true;
      if (!connected.has(kart.pid)) {cancelPayload(kart);kart.machineHeld=false;continue;} // frozen: no fire or pickup
      if ((Number(kart.respawn) || 0) > 0) {
        cancelPayload(kart);
        kart.respawn -= dt;
        if (kart.respawn > 0) continue; // still KO'd: out of the fight
        kart.respawn = 0;
        respawnKart(state, kart);
        fireGeometry?.syncRespawn?.(); // reset/project the actual physical fresh life before sweeps
        // Retarget the sweep origin to the fresh pose: the snapshot was
        // taken at the corpse, and projectiles must not sweep the
        // corpse-to-spawn teleport line (a shielded fresh spawn would
        // otherwise swallow somebody else's shot mid-flight).
        if (previousKarts) previousKarts.set(kart.pid, { x: kart.x, z: kart.z,
          ...(kart.physicalPose ? { physicalPose: structuredClone(kart.physicalPose), angle: kart.angle, spawnSeq: kart.spawnSeq || 0 } : {}) });
        // Fresh life falls through: it may collect or fire on a genuinely
        // new edge this same tick (a held-through-death button is inert).
      } else {
        kart.shield = Math.max(0, (Number(kart.shield) || 0) - dt);
        kart.frostT = Math.max(0, (Number(kart.frostT) || 0) - dt);
        kart.spinT = Math.max(0, (Number(kart.spinT) || 0) - dt);
        kart.fireCd = Math.max(payloads.has(kart)?-fireCooldownFor(state,kart):0, (Number(kart.fireCd) || 0) - dt);
      }
      if ((pressed || payloads.has(kart)) && (Number(kart.respawn) || 0) <= 0) {
        // Physical fire uses the current body pose after driving. Previous poses
        // remain collision history for moving targets, never an aiming source.
        const start = kart.physicalPose?kart:(previousKarts?.get(kart.pid)||kart);
        firePayload(state, kart, start, connected, fireGeometry, pressed);
      }
      if ((Number(kart.respawn) || 0) > 0) continue;
      for (const crate of state.crates) {
        const dx = kart.x - crate.x;
        const dz = kart.z - crate.z;
        // One slot: a loaded kart never consumes or replaces ("use it
        // first"), so parking on a crate can never farm items.
        const nearGround = !kart.physicalPose || !fireGeometry?.groundAt ||
          Math.abs(kart.physicalPose.position.y-fireGeometry.groundAt(crate.x,crate.z)) < 2.4;
        if (dx * dx + dz * dz < PICKUP_R2 && nearGround && !kart.weapon && !activeKartPower(kart) && !payloads.has(kart)) {
          const collectedId=crate.id;
          const weapon = rollWeapon(state);
          kart.weapon = weapon;
          state.volleySeq = (Number(state.volleySeq) || 0) + 1;
          kart.volley = 'v' + state.volleySeq;
          kart.ammo = weapon === 'machinegun' ? PULSE_AMMO : (COMBAT.weapons[weapon]?.ammo||1);
          const spot = pickSocket(state, state.crates, crate);
          state.crateSeq += 1;
          crate.id = 'c' + state.crateSeq;
          crate.x = spot.x;
          crate.z = spot.z;
          pushEvent(state, 'pickup', kart.pid, undefined, weapon,{crateId:collectedId});
          if (econ && typeof econ.award === 'function') {
            try { econ.award(kart.pid, COIN_PICKUP); } catch { /* economy never breaks the tick */ }
          }
          break; // exactly one award per kart per tick
        }
      }
    }
    for(const k of state.karts){if(k.weapon==='missile'&&connected.has(k.pid)&&!(k.respawn>0)){
      const mount=fireMount(state,k,'missile',fireGeometry),from=mount?.muzzle||{x:k.x+Math.sin(k.angle)*2,z:k.z+Math.cos(k.angle)*2};
      k.lockTarget=mount?.blocked?null:seekerLock(state,k,from,mount?.direction,connected,fireGeometry)?.pid||null;
    }else k.lockTarget=null;}
    updateCuratedStatus(state,connected,dt,econ,fireGeometry);
    // Zaps fly straight (seekers turn toward their lock), die on
    // walls/blocks/expiry, and damage hull hits. Rockets and seekers
    // detonate on hull/block/wall impact (splash, LOS only); TTL expiry
    // fizzles with no blast. Sweeping, wall-first ties, and exactly-once
    // scoring hold at all speeds.
    const alive = [];
    for (const zap of state.zaps) {
      const shotDt=Math.min(dt,zap.stepDt??dt);delete zap.stepDt;
      if(zap.kind==='missile'){zap.age=(zap.age||0)+shotDt;if(zap.age>W.missile.lockDelay)steerSeeker(state,zap,connected,shotDt,fireGeometry);}
      if(zap.kind==='cannon')zap.vy=(zap.vy||0)-W.cannon.gravity*shotDt;

      const speed = zapSpeed(zap);
      const physical = zap.physical===true && fireGeometry?.sweepStatic;
      const from = { x: zap.x, z: zap.z, ...(physical?{y:zap.y}:{}) };
      const to = physical ? {x:zap.x+zap.vx*shotDt,y:zap.y+zap.vy*shotDt,z:zap.z+zap.vz*shotDt}
        : {x:zap.x+(Number.isFinite(zap.vx)?zap.vx:Math.sin(zap.angle)*speed)*shotDt,z:zap.z+(Number.isFinite(zap.vz)?zap.vz:Math.cos(zap.angle)*speed)*shotDt};
      // Stop at the earliest expiry, world edge, block, or hull. A block or
      // boundary wins an exact tie, so a shot never scores through a wall.
      // impact tracks the winner for rockets (wall/block => blast, ttl =>
      // fizzle, void => muzzle outside, never blasts through the wall).
      let stop = zap.ttl <= 0 ? 0 : shotDt > 0 && zap.ttl <= shotDt ? zap.ttl / shotDt : Infinity;
      let impact = (zap.ttl <= 0 || (shotDt > 0 && zap.ttl <= shotDt)) ? 'ttl' : null;
      let staticNormal=null;
      if (physical) {
        const hit=fireGeometry.sweepStatic(from,to,COMBAT.staticSweepRadii[zap.kind]||0);
        if(hit&&hit.fraction<=stop){stop=hit.fraction;impact='block';staticNormal=hit.normal;}
      } else if (Math.abs(from.x) >= bound || Math.abs(from.z) >= bound) { stop = 0; impact = 'void'; }
      else if (Math.abs(to.x) >= bound || Math.abs(to.z) >= bound) {
        const world = boxInterval(from, to, { x: 0, z: 0, hw: bound, hd: bound });
        const t = world ? world.exit : 0;
        if (t < stop) { stop = t; impact = 'wall'; }
      }
      for (const block of physical?[]:blocks) {
        const bi = boxInterval(from, to, block);
        if (bi && bi.enter < stop) { stop = bi.enter; impact = 'block'; }
      }
      let victim = null;
      // A Boomerang blade passes through every rival it cuts this tick.

      for (const kart of state.karts) {
        if (!rivals(state, zap.owner, kart.pid)) continue;
        if (!connected.has(kart.pid)) continue; // offline karts are immune
        if ((Number(kart.respawn) || 0) > 0) continue; // KO'd: no duplicate KO
        const before = previousKarts?.get(kart.pid) || kart;
        const time = physical?physicalHullImpact(from,to,before,kart):hullImpact(from, to, before, kart);
        if (time !== null && time < stop) {
          stop = time;
          victim = kart;
          impact = 'hull';
        }
      }
      const isRocket = zap.kind === 'cannon' || zap.kind === 'missile';
      // A Bounce Ball ricochets off walls and cover up to its bounce budget.
      const bounce = zap.kind === 'bouncer' && !victim && stop <= 1 && (impact === 'wall' || impact === 'block') && (Number(zap.bounces) || 0) < BOUNCER_BOUNCES;
      if(physical&&stop<=1&&impact!=='ttl'&&impact!=='void'&&!bounce){
        const position={x:from.x+(to.x-from.x)*stop,y:from.y+(to.y-from.y)*stop,z:from.z+(to.z-from.z)*stop};
        pushEvent(state,'impact',zap.owner,victim?.pid,zap.kind,{position,from});
      }
      if (victim) {
        if (isRocket) {
          const ix = from.x + (to.x - from.x) * stop;
          const iz = from.z + (to.z - from.z) * stop;
          detonateRocket(state, zap, ix, iz, connected, econ,victim,{x:ix,y:physical?from.y+(to.y-from.y)*stop:-PHYSICS.chassis.modelOriginY+PHYSICS.combat.rocketMuzzle.y,z:iz},fireGeometry);
        } else if ((Number(victim.shield) || 0) <= 0) {
          // A shield consumes the shot (no KO); the first KO freezes the
          // victim out, so later pellets this tick skip them — one KO max
          // per victim however many shots connect at once.
          damage(state,victim,zap.owner,zap.kind||'machinegun',connected,econ,zap.volley,null,zap.id);
        }
      } else if (bounce) {
        const p = {x: from.x + (to.x - from.x) * stop, y: physical ? from.y + (to.y - from.y) * stop : 0, z: from.z + (to.z - from.z) * stop};
        let n = physical && staticNormal ? {x: staticNormal.x, y: staticNormal.y, z: staticNormal.z} : null;
        if (!n) { const pn = planarNormal(p, bound, blocks, to.x - from.x, to.z - from.z); n = {x: pn.nx, y: 0, z: pn.nz}; }
        const v = physical ? {x: zap.vx, y: zap.vy, z: zap.vz} : {x: Math.sin(zap.angle) * speed, y: 0, z: Math.cos(zap.angle) * speed};
        const vn = v.x * n.x + v.y * n.y + v.z * n.z;
        if (physical && n.y > .55) {
          // Rolling up a slope is not a bounce: slide along the ground.
          v.x -= vn * n.x; v.y = Math.max(0, v.y - vn * n.y); v.z -= vn * n.z;
        } else {
          v.x -= 2 * vn * n.x; v.z -= 2 * vn * n.z; v.y = physical ? Math.max(-2, v.y - 2 * vn * n.y) * .5 : 0;
          zap.bounces = (Number(zap.bounces) || 0) + 1;
          pushEvent(state, 'bounce', zap.owner, undefined, 'bouncer', {x: +p.x.toFixed(2), z: +p.z.toFixed(2), ...(physical ? {position: p} : {})});
        }
        const flat = Math.hypot(v.x, v.z) || 1, keep = speed / (Math.hypot(v.x, v.y, v.z) || 1);
        zap.x = p.x + n.x * .06; zap.z = p.z + n.z * .06; if (physical) { zap.y = p.y + n.y * .06; zap.vx = v.x * keep; zap.vy = v.y * keep; zap.vz = v.z * keep; }
        zap.angle = Math.atan2(v.x / flat, v.z / flat);
        zap.ttl -= shotDt;
        if (zap.ttl > 0) alive.push(zap);
      } else if (stop > 1) {
        zap.x = to.x; zap.z = to.z; if(physical)zap.y=to.y; zap.ttl -= shotDt;
        alive.push(zap);
      } else if (isRocket && (impact === 'wall' || impact === 'block')) {
        const ix = from.x + (to.x - from.x) * stop;
        const iz = from.z + (to.z - from.z) * stop;
        detonateRocket(state, zap, ix, iz, connected, econ,null,{x:ix,y:physical?from.y+(to.y-from.y)*stop:-PHYSICS.chassis.modelOriginY+PHYSICS.combat.rocketMuzzle.y,z:iz},fireGeometry);
      }
      // Else: consumed by a blocker (non-cannon), TTL fizzle (cannon or
      // not), or void muzzle — gone, no blast, no score.
    }
    state.zaps = alive;
    // A volley stays open while its shots fly or its clip is still loaded.
    const liveVolleys=new Set(alive.map(z=>z.volley).filter(Boolean));
    for(const k of state.karts)if(k.weapon&&k.volley)liveVolleys.add(k.volley);
    for(const k of state.karts){if(k.rammingT>0&&k.ramVolley)liveVolleys.add(k.ramVolley);if(k.bladesT>0&&k.bladesVolley)liveVolleys.add(k.bladesVolley);if(k.supernovaT>0&&k.supernovaVolley)liveVolleys.add(k.supernovaVolley);}
    for(const g of Array.isArray(state.grenades)?state.grenades:[])if(g&&g.volley)liveVolleys.add(g.volley);
    for(const id of state.volleyHits.keys())if(!liveVolleys.has(id))state.volleyHits.delete(id);
    // Mines arm, tick down, and trigger on a swept drive-over segment.
    // Shielded, KO'd, offline, and owner karts never trigger them (a spawn
    // shield drives straight over). Each mine KOs at most one victim — the
    // earliest crossing in this tick, roster order breaking ties — and the
    // trigger consumes the mine. Arm/expiry bound the swept window: a mine
    // arming mid-tick only catches the post-arm leg, and one expiring
    // mid-tick only catches the pre-expiry leg. Cover blocks both the
    // kart's path leg and the mine-to-kart line of sight, and teleport
    // jumps (respawns retarget previousKarts already) never sweep.
    const kept = [];
    for (const mine of state.mines) {
      const ttlBefore = Number(mine.ttl) || 0;
      const armBefore = Number(mine.armT) || 0;
      const wasArmed = mine.armed === true;
      mine.ttl = ttlBefore - dt;
      if (!wasArmed) {
        mine.armT = armBefore - dt;
        if (mine.armT <= 0) mine.armed = true;
      }
      const expired = mine.ttl <= 0;
      let t0 = 0;
      let t1 = 1;
      let live = false;
      if (dt <= 0) {
        live = mine.armed === true && !expired && ttlBefore > 0;
        t0 = 0; t1 = 1;
      } else {
        if (ttlBefore <= 0) continue; // stale: gone, no blast
        let tArm;
        if (wasArmed) tArm = 0;
        else if (armBefore <= dt) tArm = Math.max(0, Math.min(1, armBefore / dt));
        else {
          if (!expired) kept.push(mine);
          continue; // unarmed the whole tick
        }
        const tExp = ttlBefore >= dt ? 1 : Math.max(0, Math.min(1, ttlBefore / dt));
        if (tArm >= tExp) {
          if (!expired) kept.push(mine);
          continue; // no armed-and-alive window
        }
        t0 = tArm; t1 = tExp; live = true;
      }
      let victim = null;
      let bestT = Infinity;
      const triggerR2 = (W[mine.kind]?.triggerRadius||W.mine.triggerRadius)**2;
      if (live) {
        const maxTravel = 40 * Math.max(0, dt) + 3;
        for (const kart of state.karts) {
          if (!rivals(state, mine.owner, kart.pid)) continue;
          if (!connected.has(kart.pid)) continue;
          if ((Number(kart.respawn) || 0) > 0) continue;
          if ((Number(kart.shield) || 0) > 0) continue;
          const before = previousKarts?.get(kart.pid) || kart;
          const bx = Number(before.x);
          const bz = Number(before.z);
          const ax = Number(kart.x);
          const az = Number(kart.z);
          if (!Number.isFinite(bx) || !Number.isFinite(bz) ||
              !Number.isFinite(ax) || !Number.isFinite(az)) continue;
          const travel = Math.hypot(ax - bx, az - bz);
          const physical = mine.physical === true && !!kart.physicalPose && !!fireGeometry?.sweepStatic;
          const by = physical ? physicalHullCenter(before).y : 0;
          const ay = physical ? physicalHullCenter(kart).y : 0;
          const my = physical ? mine.y : 0;
          if (dt > 0 && travel > maxTravel) {
            // Teleport leg: never sweep, endpoint only with line of sight.
            const dx = ax - mine.x;
            const dz = az - mine.z;
            if (dx * dx + dz * dz + (ay-my)**2 >= triggerR2) continue;
            if (physical ? fireGeometry.sweepStatic({x:mine.x,y:my+.2,z:mine.z},{x:ax,y:ay,z:az}) : splashBlocked(mine.x,mine.z,ax,az,blocks)) continue;
            if (t1 < bestT) { bestT = t1; victim = kart; }
            continue;
          }
          const tEnter = mineEntryTime(bx, bz, ax, az, mine.x, mine.z, t0, t1, by,ay,my,triggerR2);
          if (tEnter === null || tEnter === undefined) continue;
          if (!(tEnter < bestT)) continue; // strict: roster-first wins ties
          const px = bx + (ax - bx) * tEnter;
          const pz = bz + (az - bz) * tEnter;
          if (physical ? fireGeometry.sweepStatic({x:mine.x,y:my+.2,z:mine.z},{x:px,y:by+(ay-by)*tEnter,z:pz}) : splashBlocked(mine.x,mine.z,px,pz,blocks)) continue;
          if (minePathBlocked(bx, bz, px, pz, blocks)) continue;
          bestT = tEnter;
          victim = kart;
        }
      }
      if(victim && mine.kind==='fakecrate')damage(state,victim,mine.owner,'fakecrate',connected,econ);
      else if (victim) {
        const before=previousKarts?.get(victim.pid)||victim,physical=mine.physical&&victim.physicalPose;
        const a=physical?physicalHullCenter(before):{x:before.x,y:0,z:before.z},b=physical?physicalHullCenter(victim):{x:victim.x,y:0,z:victim.z};
        const d=Math.hypot(a.x+(b.x-a.x)*bestT-mine.x,a.y+(b.y-a.y)*bestT-(physical?mine.y:0),a.z+(b.z-a.z)*bestT-mine.z);
        const kind=mine.kind||'mine';
        detonateArea(state,{x:mine.x,y:physical?mine.y:0,z:mine.z},mine.owner,kind,connected,econ,null,fireGeometry,victim,blastDamage(kind,d));
      }
      else if (!expired) kept.push(mine);
    }
    state.mines = kept;
    // Turbo Ram: while it runs, touching a rival takes 100 HP, once per
    // rival per pickup. A frozen or KO'd rammer pauses; respawn ends it.
    for (const kart of state.karts) {
      if (!((Number(kart.rammingT) || 0) > 0)) continue;
      if (!connected.has(kart.pid) || (Number(kart.respawn) || 0) > 0) continue;
      kart.rammingT = Math.max(0, kart.rammingT - dt);
      const me = kart.physicalPose ? physicalHullCenter(kart) : {x: kart.x, y: 0, z: kart.z};
      for (const other of state.karts) {
        if (other === kart || !connected.has(other.pid) || (Number(other.respawn) || 0) > 0 || (Number(other.shield) || 0) > 0) continue;
        const o = other.physicalPose ? physicalHullCenter(other) : {x: other.x, y: 0, z: other.z};
        if (Math.hypot(o.x - me.x, o.z - me.z) < RAM_REACH && Math.abs(o.y - me.y) < 1.6 && !fireGeometry?.sweepStatic?.(me,o) && !splashBlocked(me.x,me.z,o.x,o.z,state.blocks))
          damage(state, other, kart.pid, 'ram', connected, econ, kart.ramVolley);
      }
      if (kart.rammingT <= 0) kart.ramVolley = null;
    }
    // Grenades arc, bounce, and detonate at fuse. World bodies like zaps:
    // they fly during drive regardless of owner connection, and only the
    // targeting skips offline karts. The fuse ticks once per tick from the
    // authoritative clamped dt; motion integrates in bounded <=0.04 s
    // substeps so cover is swept, never tunneled. Detonation consumes the
    // body exactly once (removed, never reprocessed).
    if (!Array.isArray(state.grenades)) state.grenades = [];
    const keptG = [];
    const gblocks = Array.isArray(blocks) ? blocks : [];
    for (const g of state.grenades) {
      if (!sanitizeGrenade(state, g, bound)) continue;
      const n = dt > 0 ? Math.max(1, Math.ceil(dt / GRENADE_STEP)) : 1;
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        if (g.physical && fireGeometry?.sweepStatic) stepPhysicalGrenade(g,h,fireGeometry);
        else stepGrenadeSub(g,h,gblocks,bound);
      }
      g.fuse -= dt;
      if (g.fuse > 0) keptG.push(g);
      else if (g.kind === 'cluster') burstCluster(state, g, keptG);
      else detonateGrenade(state,g,connected,econ,fireGeometry);
    }
    state.grenades = keptG;
    return state.karts.some((k) => k.hits >= state.targetHits);
  },

  scoreOf(kart) {
    return kart.hits;
  },

  viewExtra(state) {
    const garageOn = state && state.garage === true;
    return {
      combat: COMBAT,
      crates: state.crates.map((c) => ({ id: c.id, x: c.x, z: c.z })),
      zaps: state.zaps.map((z) => {
        const speed = zapSpeed(z, garageOn);
        const physical=z.physical===true;
        const vx = Number.isFinite(z.vx)?z.vx:Math.sin(z.angle) * speed;
        const vz = Number.isFinite(z.vz)?z.vz:Math.cos(z.angle) * speed;
        return {
          id: z.id, owner: z.owner, kind: z.kind || 'machinegun',
          x: +z.x.toFixed(physical?3:2), z: +z.z.toFixed(physical?3:2), angle: +z.angle.toFixed(3),
          speed,
          ttl: +Math.max(0, Number(z.ttl) || 0).toFixed(2),
          vx: +vx.toFixed(2), vz: +vz.toFixed(2),
          ...(z.kind==='missile'&&z.targetId?{targetId:z.targetId}:{}),
        ...(z.kind==='bouncer'?{bounces:Number(z.bounces)||0}:{}),
        ...(physical?{physical:true,radius:z.radius??(COMBAT.staticSweepRadii[z.kind]||0),y:+z.y.toFixed(3),vy:+z.vy.toFixed(2)}:{y:-PHYSICS.chassis.modelOriginY+(PHYSICS.combat[muzzleOf(z.kind||'machinegun')+'Muzzle']?.y||0)}),
        };
      }),
      mines: state.mines.map((m) => ({
        id: m.id, owner: m.owner, ...(m.kind ? {kind:m.kind} : {}),
        x: +m.x.toFixed(2), z: +m.z.toFixed(2),
        ...(m.physical?{physical:true,y:m.y,groundY:m.y}:{}),
        armed: m.armed === true, ttl: +Math.max(0, m.ttl).toFixed(2),
      })),
      // Grenade canisters: full ballistic state for the renderer (planar
      // + vertical velocities, fuse, ground-warning flag). ttl aliases
      // fuse for transport compatibility. All plain wire JSON.
      grenades: (Array.isArray(state.grenades) ? state.grenades : []).map((g) => {
        const fuse = Math.max(0, Number(g.fuse) || 0);
        return {
          id: typeof g.id === 'string' ? g.id : '?',
          kind: LOBBED[g.kind] ? g.kind : 'nuke',
          owner: typeof g.owner === 'string' ? g.owner : null,
          x: +clampNum(Number(g.x) || 0, -999, 999).toFixed(2),
          z: +clampNum(Number(g.z) || 0, -999, 999).toFixed(2),
          y: +clampNum(Number(g.y) || 0, g.physical ? -999 : 0, g.physical ? 999 : GRENADE_YMAX).toFixed(2),
          ...(g.physical?{physical:true,groundY:g.groundY||0}:{}),
          angle: +(Number.isFinite(Number(g.angle)) ? Number(g.angle) : 0).toFixed(3),
          vx: +clampNum(Number(g.vx) || 0, -GRENADE_VMAX, GRENADE_VMAX).toFixed(2),
          vz: +clampNum(Number(g.vz) || 0, -GRENADE_VMAX, GRENADE_VMAX).toFixed(2),
          vy: +clampNum(Number(g.vy) || 0, -GRENADE_VMAX, GRENADE_VMAX).toFixed(2),
          fuse: +fuse.toFixed(2),
          ttl: +fuse.toFixed(2),
          warning: (!g.kind || g.kind === 'nuke') && fuse <= GRENADE_WARN,
        };
      }),
      events: state.events.map((e) => ({ ...e })),
    };
  },

  kartViewExtra(kart) {
    // Owned upgrade levels (public, for kart cosmetics) plus the effective
    // tuning multipliers the sim applies (1.0 flat when the garage does
    // not apply: classic mode or fixtures without upgrades). Formulas —
    // engine L: top/accel 1+0.05L; handling L: turn 1+0.04L; reload L:
    // fire-cooldown 1-0.06L. The pose mirror multiplies its MAX_SPEED,
    // ACCEL, and TURN_RATE by top/accel/turn when garage is on.
    const up = kart && kart.upgrades && typeof kart.upgrades === 'object' ? kart.upgrades : null;
    const engine = up ? clampNum(Math.floor(Number(up.engine) || 0), 0, 3) : 0;
    const handling = up ? clampNum(Math.floor(Number(up.handling) || 0), 0, 3) : 0;
    const reload = up ? clampNum(Math.floor(Number(up.reload) || 0), 0, 3) : 0;
    const applied = kart && kart.garage === true;
    return {
      hits: kart.hits,
      health: Number.isFinite(kart.health)?kart.health:COMBAT.maxHealth,
      maxHealth: COMBAT.maxHealth,
      guard: kart.guard === true,
      bladesT:+(kart.bladesT||0).toFixed(3),bladesAge:+(kart.bladesAge||0).toFixed(3),supernovaT:+(kart.supernovaT||0).toFixed(3),
      ammo: kart.ammo,
      weapon: normalizeWeapon(kart.weapon) || null,
      ...(kart.weapon==='missile'?{lockTarget:kart.lockTarget||null}:{}),
      firing: payloads.has(kart),
      shield: +Math.max(0, Number(kart.shield) || 0).toFixed(2),
      respawn: +Math.max(0, Number(kart.respawn) || 0).toFixed(2),
      spawnSeq: Number(kart.spawnSeq) || 0,
      deaths: Number(kart.deaths) || 0,
      frostT: +Math.max(0, Number(kart.frostT) || 0).toFixed(2),
      spinT: +Math.max(0, Number(kart.spinT) || 0).toFixed(2),
      rammingT: +Math.max(0, Number(kart.rammingT) || 0).toFixed(2),
      upgrades: { engine, handling, reload },
      tuning: applied
        ? {
          top: +(1 + 0.05 * engine).toFixed(4),
          accel: +(1 + 0.05 * engine).toFixed(4),
          turn: +(1 + 0.04 * handling).toFixed(4),
          reload: +(1 - 0.06 * reload).toFixed(4),
        }
        : { top: 1, accel: 1, turn: 1, reload: 1 },
    };
  },
};

/* ---- Arena hazards: fall-off zones ----
 * Falling in is a self-knockout through the normal KO/respawn flow, but
 * nobody is credited: the faller loses one KO (never below zero) and the
 * feed records a 'fell' event instead of a 'ko'. No coins change hands. */
function fallOut(state, kart) {
  if (!kart || (Number(kart.respawn) || 0) > 0) return false;
  const before = state.eventSeq;
  knockOut(state, kart, null, 'fall', null);
  const e = state.events[state.events.length - 1];
  if (e && state.eventSeq === before + 1 && e.type === 'ko' && e.other === kart.pid) {
    e.type = 'fell';
    e.pid = kart.pid;
    delete e.other;
  }
  kart.hits = Math.max(0, (Number(kart.hits) || 0) - 1);
  state.scores[kart.pid] = kart.hits;
  return true;
}
module.exports.fallOut = fallOut;
