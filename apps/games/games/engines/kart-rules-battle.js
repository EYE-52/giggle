'use strict';
/* Kart rule module: Zap Battle. Timed free-for-all arena combat: grab a
 * mystery item from a crate, spend it, damage100-health rivals, score
 * KNOCKOUTS only at zero health, respawn safely, rejoin the fight. Most KOs
 * at the deadline wins; ties share the win, exactly like Star Rush.
 *
 * hits/targetHits keep their historical names for framework compatibility
 * but now count KNOCKOUTS. One item slot: holding a weapon blocks further
 * pickups until it is spent ("use it first").
 *
 * Generic variants retain the eight-item pool. Pocket physical mode adds
 * Spikes (5 seconds,30 damage,500ms per victim) through its private facade.
 * Weapons (both generic modes share one deterministic 8-item pool; weights sum
 * to 1, stronger lethal weapons rarer — see WEAPON_WEIGHTS: Pulse 20 /
 * Scatter 16 / Mine 13 / Shield 14 / Rocket 11 / Rail 8 / Grenade 10 /
 * EMP 8; the garage never gates any of them):
 * - pulse: 12 straight zaps (speed110 ttl1.6), one committed burst at a 0.12 s base cooldown.
 * - scatter: five fans of 3 pellets (+/-0.22 rad; speed95 ttl1.2); at most one KO per victim no matter
 *   how many pellets connect.
 * - mine: three traps dropped behind at 0.24 s intervals, arms in 0.7 s, lives 12 s, triggers
 *   within 2.2u; the exact owner is never hit; <=16 live mines.
 * - shield: one 4 s defensive activation (never cancels itself).
 * - rocket: three finned shells (speed 85, ttl 1.6, direct sweep 1.7);
 *   on hull/block/wall impact it detonates (splash 3u, line-of-sight
 *   only, never through walls, owner immune; direct100 damage, indirect40,
 *   at most one KO per victim); TTL expiry fizzles with no blast.
 * - rail: one tight slug (speed 160, ttl 1.2, swept projectile, never
 *   hitscan); stops at the first hull/block like pulse, 5 ammo.
 * - grenade: one lobbed canister (planar 22 u/s forward, vy 8, gravity
 *   30), up to 2 damped bounces off the floor, cover faces, and world
 *   walls; fuse 1.4 s, then ONE splash (radius 4u, line-of-sight only,
 *   owner/shield/dead/offline immune, every vulnerable victim KO'd
 *   exactly once via knockOut). The flying body never scores on contact:
 *   splash at fuse only. <=12 live grenades. Final 0.5 s projects
 *   warning:true for the ground ring.
 * - emp: one instantaneous directed discharge (range 12u, half-angle
 *   0.55 rad, line-of-sight): every valid victim in the cone is SLOWED
 *   (empT 1.6 s, refreshed never stacked) instead of KO'd. The slow
 *   scales top speed x0.62, accel x0.6, turn x0.75 (engine + pose apply
 *   the identical factor AFTER nitro, so nitro helps relatively but can
 *   never bypass the slowed cap); steering/throttle stay live, movement
 *   stays playable. Owner/shield/dead/offline immune. Grants no KOs.
 * Firing an OFFENSIVE weapon (everything but shield) drops all spawn
 * protection first — grenade and emp included.
 * Every accepted spend emits exactly one authoritative event for sound:
 * 'fire' (pulse/scatter/rocket/rail/grenade/emp), 'mine', or 'shield' —
 * each with a weapon field. Grenade detonations add one bounded 'blast'
 * {id,type:'blast',pid:owner,weapon:'grenade',x,z} (blast point, even
 * with zero victims); each EMP victim adds one bounded 'emp'
 * {id,type:'emp',pid:source,other:victim,weapon:'emp',x,z,angle}
 * (source origin + facing for the discharge visual). KO events keep the
 * existing {id,type:'ko',pid,other,weapon} shape with weapon 'grenade'
 * for splash victims. No input-predicted KOs: only the sweep/splash
 * scores. No input-predicted slows: only the cone applies empT.
 *
 * KO/respawn: the victim freezes (speed/slip/boost/drift/turbo/input
 * cleared, item lost, deaths+1), sits out 2 s, then respawns at the
 * farthest-from-threats legal pose with a fresh 2.5 s shield, no item,
 * and spawnSeq+1 (the teleport epoch: prediction snaps on change).
 * Dead karts cannot drive, collect, fire, or be KO'd again; timers use
 * the authoritative clamped dt and freeze while disconnected.
 *
 * Firing rides the shared `boost` intent bit as a rising edge. Physical
 * Pocket commits the whole loaded payload on its first accepted emission;
 * releasing movement/fire never cancels it. Generic planar variants keep
 * their per-press spend. A fresh edge is required for every new pickup.
 * The engine latches one validated receipt-time edge (`pendingFire`, a
 * bounded boolean) so a short press still fires when a newer neutral or
 * steering intent lands before the next tick; the tick consumes it once.
 * KO, disconnect, TTL expiry, and respawn all discard the receipt latch;
 * accepted payloads survive input TTL, but never life/epoch/result/disposal.
 *
 * Preserved from the original solver: swept projectile motion, wall and
 * block impacts winning exact ties over hulls, no self-hits, TTL
 * ordering, disconnect safety, and bounded lives (zaps <= 64). */

const {config:COMBAT,damageAt} = require('./kart-combat-config');
const PHYSICS = require('../../public/js/engines/kart-physics-config.mjs').default;
const PICKUP_R2 = 2.4 * 2.4;
const ZAP_HIT_R2 = 1.7 * 1.7;
// Quick arcade ballistics in both battle modes; swept impacts prevent tunneling.
const PULSE_SPEED = 110;
const PULSE_TTL = 1.6;
const PULSE_AMMO = COMBAT.weapons.pulse.ammo;
const SCATTER_SPEED = 95;
const SCATTER_TTL = 1.2;
const SCATTER_FAN = [-0.22, 0, 0.22];
const ROCKET_SPEED = 85;
const ROCKET_TTL = 1.6;
const ROCKET_SPLASH_R = COMBAT.weapons.rocket.splashRadius;
const ROCKET_SPLASH_R2 = ROCKET_SPLASH_R * ROCKET_SPLASH_R;
const RAIL_SPEED = 160;
const RAIL_TTL = 1.2;
const MINE_ARM = COMBAT.weapons.mine.armTime;
const MINE_TTL = COMBAT.weapons.mine.lifetime;
const MINE_R2 = COMBAT.weapons.mine.triggerRadius ** 2;
const MINE_CLEAR = 0.5; // mine center clearance from block faces
const MAX_MINES = 16;
const MAX_ZAPS = 64;
// Grenade canister: lobbed forward at 22 u/s planar, vy 8, gravity 30
// (apex ~2.07u at ~0.27 s, first touchdown ~0.64 s / ~14u out). Cover
// is full-height (the map schema has no block heights), so the arc
// bounces off faces mid-flight exactly like a ground roll. At most 2
// bounces (floor, cover face, or world wall), each damping planar x0.55;
// floor bounces reflect vy x0.45, face bounces reflect the normal x0.5.
// Past the budget, faces slide (normal killed, tangent damped) and the
// floor grounds the canister (bounded linear friction). Fuse 1.4 s,
// splash radius 4u, final 0.5 s warning (spec needs >= 0.35 s).
const GRENADE_SPEED = 22;
const GRENADE_VY0 = 8;
const GRENADE_GRAVITY = 30;
const GRENADE_Y0 = 1;
const GRENADE_FUSE = 1.4;
const GRENADE_WARN = 0.5;
const GRENADE_SPLASH_R = COMBAT.weapons.grenade.splashRadius;
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
// EMP discharge: instantaneous cone from the live pose, range 12u,
// half-angle 0.55 rad, line-of-sight. Victims are slowed (empT 1.6 s,
// refreshed never stacked); the motion scales live in kart-engine.js
// (EMP_TOP/ACCEL/TURN_SCALE, mirrored by kart-pose.mjs) and apply AFTER
// nitro. Range is strict-inside like splash; the cone edge is inclusive;
// point-blank (stacked) always counts as inside the cone.
const EMP_RANGE = COMBAT.weapons.emp.range;
const EMP_R2 = EMP_RANGE * EMP_RANGE;
const EMP_HALF_ANGLE = 0.55;
const EMP_COS_HALF = Math.cos(EMP_HALF_ANGLE);
const EMP_TIME = 1.6;
const MAX_EVENTS = 12; // last 12 semantic records (fire + KO + pickups retained)
const FIRE_CD = 0.4;
const SPAWN_SHIELD = 2.5;
const SHIELD_TIME = 4;
const RESPAWN_TIME = 2;
const RESPAWN_CLEAR = 2.5; // min live-kart clearance for a respawn pose
const CRATE_KART_KEEP = 5; // crates recycle away from live karts
const PAYLOAD_WEAPONS = new Set(['pulse','scatter','rocket','rail','mine']);
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
function cancelPayloads(state) {for(const kart of state.karts)cancelPayload(kart);}
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

/* Both battle modes share one deterministic 8-item arsenal (classic and
 * garage roll the identical pool; the garage controls earned kart tuning,
 * never whether a player gets the improved weapons). Weights sum to 1;
 * stronger lethal weapons are rarer: pulse 0.20, scatter 0.16, mine 0.13,
 * shield 0.14, rocket 0.11, rail 0.08, grenade 0.10, emp 0.08.
 * rollWeapon derives its edges from this table by construction, so the
 * published weights, the code, and the tests cannot drift apart. */
const WEAPON_ORDER = ['pulse', 'scatter', 'mine', 'shield', 'rocket', 'rail', 'grenade', 'emp'];
const WEAPON_WEIGHTS = {
  pulse: 0.20, scatter: 0.16, mine: 0.13, shield: 0.14,
  rocket: 0.11, rail: 0.08, grenade: 0.10, emp: 0.08,
};
const WEAPON_CUM = (() => {
  const out = [];
  let edge = 0;
  for (const w of WEAPON_ORDER) {
    edge += WEAPON_WEIGHTS[w];
    out.push([edge, w]);
  }
  return out;
})();
function rollWeapon(state, physical=false) {
  // Pocket physical mode alone adds Spikes; generic variants retain eight.
  const r = rand01(state) * (physical ? 1.08 : 1);
  if(physical && r>=1)return 'spikes';
  for (const [edge, w] of WEAPON_CUM) {
    if (r < edge) return w;
  }
  return WEAPON_ORDER[WEAPON_ORDER.length - 1]; // float backstop, unreachable for r < 1
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
  if (!pool.length) return { x: 0, z: 0 };
  let tier = pool.filter((p) => p.dc >= spacing && p.dk >= CRATE_KART_KEEP);
  if (!tier.length) tier = pool.filter((p) => p.dc >= spacing);
  if (!tier.length) {
    tier = pool.slice().sort((a, b) => (b.dc - a.dc) || (b.dk - a.dk));
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
      else if(['position','direction','from'].includes(k) && v && [v.x,v.y,v.z].every(Number.isFinite)) e[k]={x:v.x,y:v.y,z:v.z};
    }
  }
  state.events.push(e);
  while (state.events.length > MAX_EVENTS) state.events.shift();
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
  victim.empT = 0; // KO clears the slow: the fresh life starts clean
  victim.empFresh = false;
  victim.nitroActive = false;
  victim.input = { steer: 0, throttle: 0, boost: false };
  victim.prevAction = false;
  victim.pendingFire = false; // KO discards a latched edge
  victim.machineHeld = false;
  victim.ramT = 0; victim.spikesT=0; victim.spikesUntil=0;
  const shooter = state.karts.find((k) => k.pid === shooterPid);
  if (shooter) {
    shooter.hits += 1;
    state.scores[shooter.pid] = shooter.hits;
  }
  if (econ && typeof econ.award === 'function' && shooterPid) {
    try { econ.award(shooterPid, COIN_KO); } catch { /* economy never breaks the tick */ }
  }
  pushEvent(state, 'ko', shooterPid, victim.pid, weapon,victim.physicalPose?{position:physicalHullCenter(victim)}:undefined);
}

function damage(state,victim,owner,weapon,connected,econ,amount=damageAt(weapon),volley=null) {
  if(!victim || victim.pid===owner || !connected.has(victim.pid) || victim.respawn>0 || victim.shield>0 || !Number.isFinite(amount) || amount<=0) return false;
  if(volley) {
    let hits=state.scatterHits.get(volley);if(!hits)state.scatterHits.set(volley,hits=new Map());
    const dealt=hits.get(victim.pid)||0;amount=Math.min(amount,COMBAT.weapons.scatter.maxShotDamage-dealt);
    if(amount<=0)return false;hits.set(victim.pid,dealt+amount);
  }
  const health=Number.isFinite(victim.health)?victim.health:COMBAT.maxHealth;
  const taken=Math.min(health,amount);victim.health=Math.max(0,health-taken);
  const hitPosition = victim.physicalPose ? physicalHullCenter(victim) : {x:+victim.x.toFixed(3),y:0,z:+victim.z.toFixed(3)};
  pushEvent(state,'hit',owner,victim.pid,weapon,{damage:taken,health:victim.health,maxHealth:COMBAT.maxHealth,position:hitPosition});
  if(victim.health===0)knockOut(state,victim,owner,weapon,econ);
  return true;
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
  kart.health = COMBAT.maxHealth;
  kart.ramT = 0; kart.spikesT=0; kart.spikesUntil=0;
  kart.fireCd = 0;
  kart.empT = 0;
  kart.empFresh = false;
  kart.nitro = 1;
  kart.nitroActive = false;
  kart.nitroLocked = false;
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
  if (kind === 'scatter') return SCATTER_TTL;
  if (kind === 'rocket') return ROCKET_TTL;
  if (kind === 'rail') return RAIL_TTL;
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
  const offset = PHYSICS.combat[kind + 'Muzzle'];
  if (!offset) return null;
  const q = pose.rotation;
  const p = pose.position;
  const originOffset = rotateFire({x:offset.x,y:offset.y,z:0}, q);
  const muzzleOffset = rotateFire(offset, q);
  const origin = {x:p.x+originOffset.x,y:p.y+originOffset.y,z:p.z+originOffset.z};
  const muzzle = {x:p.x+muzzleOffset.x,y:p.y+muzzleOffset.y,z:p.z+muzzleOffset.z};
  const direction = rotateFire({x:Math.sin(yawOffset),y:0,z:Math.cos(yawOffset)}, q);
  const blocked = !!fireGeometry.sweepStatic(origin,muzzle,kind==='grenade'?GRENADE_R:(COMBAT.staticSweepRadii[kind]||0));
  return {origin,muzzle,direction,physical:true,blocked};
}

function launchZap(state, kart, start, angle, kind, volley=null, geometry=null) {
  state.zapSeq += 1;
  state.zaps.push({
    id: 'z' + state.zapSeq,
    owner: kart.pid,
    kind,
    x: geometry ? geometry.muzzle.x : start.x + Math.sin(angle) * 2,
    z: geometry ? geometry.muzzle.z : start.z + Math.cos(angle) * 2,
    ...(geometry?.physical ? {physical:true,radius:COMBAT.staticSweepRadii[kind]||0,y:geometry.muzzle.y,
      vx:geometry.direction.x*zapSpeed({kind}),vy:geometry.direction.y*zapSpeed({kind}),
      vz:geometry.direction.z*zapSpeed({kind})} : {}),
    angle,
    ttl: zapTtlFor(kind),
    ...(volley?{volley}:{}),
  });
}

/* Effective fire cooldown: Pulse0.12s, other items0.4s; minus6% per reload
 * level (0..3) when the garage applies. Classic (state.garage !== true)
 * and fixtures without upgrades always get the flat base. */
function fireCooldownFor(state, kart) {
  const mine=kart.weapon==='mine'&&!!kart.physicalPose;
  const base=kart.weapon==='pulse'?COMBAT.weapons.pulse.cooldown:mine?COMBAT.weapons.mine.dropInterval:FIRE_CD;
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

/* Spend the loaded item on a rising edge. Offensive launches drop ALL of
 * the attacker's own protection first (no shielded aggression); the
 * defensive shield instead grants 4 s without cancelling itself. At a
 * lifecycle cap, or with no legal mine ground, the item is KEPT (no
 * consume, no cooldown, no event, shield untouched): the driver retries
 * on the next fresh press. Every ACCEPTED spend emits exactly one event
 * ('fire' with the weapon, 'mine', or 'shield' with the weapon) so the
 * root can play one sound per acceptance; grenade detonations and EMP
 * victims add their own bounded 'blast'/'emp' records later (see the
 * header for the exact shapes). */
// Scene-aligned hull centers and relative xyz sweeps; no planar reach through
// cover or between levels. Only the private physical facade enables knives.
function spikeCenter(kart) {
  const p=kart?.physicalPose;if(!p)return null;const q=p.rotation,v=.35;
  return {x:p.position.x+2*(q.x*q.y-q.w*q.z)*v,
    y:p.position.y+(1-2*(q.x*q.x+q.z*q.z))*v,
    z:p.position.z+2*(q.y*q.z+q.w*q.x)*v};
}
function spikeContacts(state,connected,before,econ,geometry) {
  state.spikeHits ||= new Map();
  for(const source of state.karts) {
    if(!(source.spikesT>0)||source.respawn>0||!connected.has(source.pid))continue;
    const old=before?.get(source.pid),a=spikeCenter(old),b=spikeCenter(source);
    if(!a||!b||old.spawnSeq!==source.spawnSeq||old.physicalPose.epoch!==source.physicalPose.epoch)continue;
    for(const target of state.karts) {
      if(target.pid===source.pid||target.respawn>0||target.shield>0||!connected.has(target.pid))continue;
      const prev=before?.get(target.pid),c=spikeCenter(prev),d=spikeCenter(target);
      if(!c||!d||prev.spawnSeq!==target.spawnSeq||prev.physicalPose.epoch!==target.physicalPose.epoch)continue;
      const r={x:a.x-c.x,y:a.y-c.y,z:a.z-c.z},v={x:b.x-d.x-r.x,y:b.y-d.y-r.y,z:b.z-d.z-r.z};
      const vv=v.x*v.x+v.y*v.y+v.z*v.z,t=vv?clampNum(-(r.x*v.x+r.y*v.y+r.z*v.z)/vv,0,1):0;
      if(Math.hypot(r.x+t*v.x,r.y+t*v.y,r.z+t*v.z)>COMBAT.weapons.spikes.radius)continue;
      const from={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t},to={x:c.x+(d.x-c.x)*t,y:c.y+(d.y-c.y)*t,z:c.z+(d.z-c.z)*t};
      const hit=geometry.sweepStatic(from,to);if(hit&&hit.fraction<1-1e-6)continue;
      const key=source.pid+':'+target.pid,prior=state.spikeHits.get(key),sameLife=prior?.sourceLife===source.spawnSeq&&prior?.targetLife===target.spawnSeq;
      if(sameLife&&state.spikesAtMs-prior.at<COMBAT.weapons.spikes.cooldownMs-1e-6)continue;
      if(damage(state,target,source.pid,'spikes',connected,econ))state.spikeHits.set(key,{at:state.spikesAtMs,sourceLife:source.spawnSeq,targetLife:target.spawnSeq});
    }
  }
}

function tryFire(state, kart, start, connected, fireGeometry) {
  const weapon = kart.weapon;
  if (!weapon || (Number(kart.ammo) || 0) <= 0 || kart.fireCd > 0) return;
  const geometry = ['pulse','scatter','rocket','rail','grenade'].includes(weapon)
    ? fireMount(state,{...start,angle:start.angle??kart.angle},weapon,fireGeometry) : null;
  if (geometry?.blocked) return;
  const cd = fireCooldownFor(state, kart);
  if(weapon==='spikes') {
    if(typeof fireGeometry?.sweepStatic!=='function')return;
    kart.spikesUntil=state.spikesAtMs+5000; kart.spikesT=5;
    kart.shield=0; kart.ramT=0; kart.ammo=0; kart.weapon=null; kart.fireCd=cd;
    pushEvent(state,'fire',kart.pid,undefined,'spikes');return true;
  }
  if (weapon === 'shield') {
    kart.shield = Math.max(Number(kart.shield) || 0, SHIELD_TIME);
    kart.ramT = SHIELD_TIME;
    kart.ammo = 0;
    kart.weapon = null;
    kart.fireCd = cd;
    pushEvent(state, 'shield', kart.pid, undefined, 'shield');
    return true;
  }
  if (weapon === 'pulse') {
    if (state.zaps.length + 1 > MAX_ZAPS) return;
    kart.shield = 0;
    launchZap(state, kart, start, kart.angle, 'pulse',null,geometry);
    kart.ammo -= 1;
    pushEvent(state, 'fire', kart.pid, undefined, 'pulse',geometry?{position:geometry.muzzle,direction:geometry.direction}:undefined);
  } else if (weapon === 'scatter') {
    if (state.zaps.length + SCATTER_FAN.length > MAX_ZAPS) return;
    kart.shield = 0;
    const volley='v'+(state.zapSeq+1);
    for (const off of SCATTER_FAN) launchZap(state, kart, start, kart.angle + off, 'scatter',volley,geometry?fireMount(state,{...start,angle:start.angle??kart.angle},'scatter',fireGeometry,off):null);
    kart.ammo -= 1;
    pushEvent(state, 'fire', kart.pid, undefined, 'scatter',geometry?{position:geometry.muzzle,direction:geometry.direction}:undefined);
  } else if (weapon === 'rocket') {
    if (state.zaps.length + 1 > MAX_ZAPS) return;
    kart.shield = 0;
    launchZap(state, kart, start, kart.angle, 'rocket',null,geometry);
    kart.ammo -= 1;
    pushEvent(state, 'fire', kart.pid, undefined, 'rocket',geometry?{position:geometry.muzzle,direction:geometry.direction}:undefined);
  } else if (weapon === 'rail') {
    if (state.zaps.length + 1 > MAX_ZAPS) return;
    kart.shield = 0;
    launchZap(state, kart, start, kart.angle, 'rail',null,geometry);
    kart.ammo -= 1;
    pushEvent(state, 'fire', kart.pid, undefined, 'rail',geometry?{position:geometry.muzzle,direction:geometry.direction}:undefined);
  } else if (weapon === 'mine') {
    if (state.mines.length >= MAX_MINES) return;
    const payload=payloads.get(kart);
    if(payload&&!payload.started){
      const reserved=state.karts.reduce((n,k)=>n+(payloads.get(k)?.weapon==='mine'?Math.max(0,k.ammo||0):0),0);
      if(state.mines.length+reserved>MAX_MINES)return;
    }
    const spot = mineSpot(state, kart, start, fireGeometry);
    if (!spot) return; // no legal ground: keep the item and the shield
    kart.shield = 0;
    state.mineSeq += 1;
    state.mines.push({
      id: 'm' + state.mineSeq,
      owner: kart.pid,
      x: spot.x,
      z: spot.z,
      ...(spot.physical ? {physical:true,y:spot.y} : {}),
      armT: MINE_ARM,
      armed: false,
      ttl: MINE_TTL,
    });
    kart.ammo -= 1;
    pushEvent(state, 'mine', kart.pid, undefined, 'mine',spot.physical?{position:{x:spot.x,y:spot.y,z:spot.z}}:undefined);
  } else if (weapon === 'grenade') {
    if (!Array.isArray(state.grenades)) state.grenades = [];
    if (state.grenades.length >= MAX_GRENADES) return; // cap: keep item/shield/cooldown
    kart.shield = 0;
    state.grenadeSeq += 1;
    const fx = Math.sin(kart.angle);
    const fz = Math.cos(kart.angle);
    state.grenades.push({
      id: 'g' + state.grenadeSeq,
      owner: kart.pid,
      x: geometry ? geometry.muzzle.x : start.x + fx * 2,
      z: geometry ? geometry.muzzle.z : start.z + fz * 2,
      y: geometry ? geometry.muzzle.y - GRENADE_R : GRENADE_Y0,
      ...(geometry ? {physical:true,groundY:fireGeometry.groundAt?.(geometry.muzzle.x,geometry.muzzle.z)||0} : {}),
      angle: kart.angle,
      vx: (geometry ? geometry.direction.x : fx) * GRENADE_SPEED,
      vz: (geometry ? geometry.direction.z : fz) * GRENADE_SPEED,
      vy: GRENADE_VY0 + (geometry ? geometry.direction.y * GRENADE_SPEED : 0),
      fuse: GRENADE_FUSE,
      bounces: 0,
    });
    kart.ammo -= 1;
    pushEvent(state, 'fire', kart.pid, undefined, 'grenade',geometry?{position:geometry.muzzle,direction:geometry.direction}:undefined);
  } else if (weapon === 'emp') {
    kart.shield = 0; // offensive debuff: no shielded aggression
    pushEvent(state, 'fire', kart.pid, undefined, 'emp',kart.physicalPose?{
      position:physicalHullCenter(kart),direction:{x:Math.sin(kart.angle),y:0,z:Math.cos(kart.angle)}}:undefined);
    fireEmp(state,kart,connected,fireGeometry);
    kart.ammo -= 1;
  } else {
    return; // unknown item: keep the slot, never crash the tick
  }
  // One emission maximum per existing tick; bounded cooldown carry preserves
  // cadence without replaying a scheduling pause as a simultaneous burst.
  kart.fireCd = payloads.has(kart)?cd+Math.max(-cd,Math.min(0,kart.fireCd)):cd;
  kart.ramT = 0;
  if (kart.ammo <= 0) {
    kart.ammo = 0;
    kart.machineHeld = false;
    kart.weapon = null; // slot empties: the next crate may refill it
  }
  return true;
}

function firePayload(state,kart,start,connected,geometry,pressed) {
  let payload=payloads.get(kart);
  if(payload&&(payload.life!==(kart.spawnSeq||0)||payload.epoch!==(kart.controlEpoch||0)||payload.poseEpoch!==kart.physicalPose?.epoch||
    payload.weapon!==kart.weapon||state.spikesAtMs>=payload.deadline)){
    cancelPayload(kart);payload=null;
    // The same tick cannot reinterpret an old press as a new payload.
    return;
  }
  if(payload){tryFire(state,kart,start,connected,geometry);}
  else if(pressed){
    const physical=!!kart.physicalPose&&typeof geometry?.sweepStatic==='function';
    if(physical&&PAYLOAD_WEAPONS.has(kart.weapon)){
      payload={weapon:kart.weapon,life:kart.spawnSeq||0,epoch:kart.controlEpoch||0,poseEpoch:kart.physicalPose.epoch,deadline:state.spikesAtMs+8000};
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
  if (zap.kind === 'scatter') return SCATTER_SPEED;
  if (zap.kind === 'rocket') return ROCKET_SPEED;
  if (zap.kind === 'rail') return RAIL_SPEED;
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
function mineEntryTime(bx, bz, ax, az, mx, mz, t0, t1, by=0, ay=0, my=0) {
  const dx = ax - bx;
  const dz = az - bz;
  const dy = ay - by;
  const fx = bx - mx;
  const fz = bz - mz;
  const fy = by - my;
  const a = dx * dx + dz * dz + dy * dy;
  if (a <= 1e-12) {
    return fx * fx + fz * fz + fy * fy < MINE_R2 ? t0 : null;
  }
  const px0 = bx + dx * t0;
  const pz0 = bz + dz * t0;
  const py0 = by + dy * t0;
  if ((px0 - mx) ** 2 + (pz0 - mz) ** 2 + (py0 - my) ** 2 < MINE_R2) return t0;
  const c = fx * fx + fz * fz + fy * fy - MINE_R2;
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

/* Direct contact applies 100 once; nearby visible victims take 40 once.
 * The 3u splash respects 3D cover, ownership, protection and active lives. */
function detonateRocket(state, zap, ix, iz, connected, econ, direct=null, position=null, fireGeometry=null) {
  pushEvent(state,'blast',zap.owner,null,'rocket',{x:ix,z:iz,position:position||{x:ix,y:-PHYSICS.chassis.modelOriginY+PHYSICS.combat.rocketMuzzle.y,z:iz}});
  const hit=new Set();
  if(direct && damage(state,direct,zap.owner,'rocket',connected,econ,COMBAT.weapons.rocket.directDamage))hit.add(direct.pid);
  for (const kart of state.karts) {
    if (kart.pid === zap.owner) continue;
    if (!connected.has(kart.pid)) continue;
    if ((Number(kart.respawn) || 0) > 0) continue;
    if ((Number(kart.shield) || 0) > 0) continue;
    if(zap.physical&&position&&fireGeometry?.sweepStatic){
      const center=physicalHullCenter(kart),dx=center.x-position.x,dy=center.y-position.y,dz=center.z-position.z;
      const distance=Math.hypot(dx,dy,dz);
      if(distance*distance>=ROCKET_SPLASH_R2)continue;
      if(distance>1e-6){
        const nudge=Math.min(.03,distance*.5)/distance;
        const from={x:position.x+dx*nudge,y:position.y+dy*nudge,z:position.z+dz*nudge};
        if(fireGeometry.sweepStatic(from,center))continue;
      }
    }else{
      const dx=kart.x-ix,dz=kart.z-iz;
      if(dx*dx+dz*dz>=ROCKET_SPLASH_R2)continue;
      if(splashBlocked(ix,iz,kart.x,kart.z,state.blocks))continue;
    }
    if(!hit.has(kart.pid))damage(state,kart,zap.owner,'rocket',connected,econ);
  }
}

/* EMP discharge: instantaneous cone from the shooter's LIVE pose (no
 * sweep window — the effect lands the same tick it fires). Owner,
 * shielded, KO'd, and offline karts are immune. Physical mode checks
 * terrain/cover visibility in xyz while retaining the horizontal cone;
 * planar variants retain their original cover helper. empT REFRESHES to
 * EMP_TIME (never adds, never exceeds): repeat zaps extend nothing past
 * the fixed duration. One bounded 'emp' record per victim carries the
 * source origin + facing for the discharge visual; the 'fire' record
 * itself is pushed by tryFire. Grants no KOs, no coins, no score. */
function fireEmp(state, kart, connected, fireGeometry) {
  const fx = Math.sin(kart.angle);
  const fz = Math.cos(kart.angle);
  const source = kart.physicalPose && fireGeometry?.sweepStatic ? physicalHullCenter(kart) : null;
  const ox = source ? source.x : Number.isFinite(kart.x) ? kart.x : 0;
  const oz = source ? source.z : Number.isFinite(kart.z) ? kart.z : 0;
  const fa = Number.isFinite(kart.angle) ? kart.angle : 0;
  for (const k of state.karts) {
    if (!k || k.pid === kart.pid) continue;
    if (connected && !connected.has(k.pid)) continue;
    if ((Number(k.respawn) || 0) > 0) continue;
    if ((Number(k.shield) || 0) > 0) continue;
    const target = source ? physicalHullCenter(k) : null;
    const kx = target ? target.x : Number(k.x);
    const kz = target ? target.z : Number(k.z);
    if (!Number.isFinite(kx) || !Number.isFinite(kz)) continue;
    const dx = kx - ox;
    const dz = kz - oz;
    const d2 = dx * dx + dz * dz;
    const dy = source ? target.y-source.y : 0;
    if (Math.abs(dy)>3 || d2+dy*dy >= EMP_R2) continue; // strict inside, like splash
    if (d2 > 1e-12) {
      const cos = (dx * fx + dz * fz) / Math.sqrt(d2);
      if (cos < EMP_COS_HALF) continue; // outside the cone (edge inclusive)
    } // point-blank (stacked): always inside the cone
    if (source ? fireGeometry.sweepStatic(source,target) : splashBlocked(ox,oz,kx,kz,state.blocks)) continue;
    k.empT = EMP_TIME;
    // Fresh this tick: the victim's own timer pass below must not eat dt
    // off the new slow, or later-roster victims would run 1.5 s while
    // earlier-roster ones run 1.6 s. The flag always clears same-tick.
    k.empFresh = true;
    pushEvent(state, 'emp', kart.pid, k.pid, 'emp',
      { x: +ox.toFixed(2), z: +oz.toFixed(2), angle: +fa.toFixed(3),
        ...(source?{position:source,direction:{x:fx,y:0,z:fz}}:{}) });
  }
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

/* Detonate a grenade at its fuse-end position: EVERY vulnerable victim
 * within 4u with line-of-sight is KO'd exactly once via knockOut (each
 * pays its own KO coin exactly once — unlike the rocket's max-1 blast).
 * Owner, shields, KO'd, and offline karts are immune. One bounded
 * 'blast' record marks the point even when nobody falls, so the blast
 * is never silent. The flying body itself never scores on contact:
 * splash at fuse only. */
function detonateGrenade(state, g, connected, econ, fireGeometry) {
  const ix = g.x;
  const iz = g.z;
  pushEvent(state, 'blast', g.owner, undefined, 'grenade',
    { x: +ix.toFixed(2), z: +iz.toFixed(2), ...(g.physical?{position:{x:ix,y:g.y+GRENADE_R,z:iz}}:{}) });
  for (const kart of state.karts) {
    if (!kart || kart.pid === g.owner) continue;
    if (!connected.has(kart.pid)) continue;
    if ((Number(kart.respawn) || 0) > 0) continue;
    if ((Number(kart.shield) || 0) > 0) continue;
    if (g.physical && fireGeometry?.sweepStatic) {
      const from={x:ix,y:g.y+GRENADE_R,z:iz},target=physicalHullCenter(kart);
      if (Math.hypot(target.x-from.x,target.y-from.y,target.z-from.z)>=GRENADE_SPLASH_R) continue;
      if (fireGeometry.sweepStatic(from,target)) continue;
    } else {
      const dx = kart.x - ix;
      const dz = kart.z - iz;
      if (dx * dx + dz * dz >= GRENADE_SPLASH_R2) continue;
      if (splashBlocked(ix, iz, kart.x, kart.z, state.blocks)) continue;
    }
    damage(state,kart,g.owner,'grenade',connected,econ);
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
    RAIL_SPEED, RAIL_TTL,
    MINE_ARM, MINE_TTL, MINE_R2, MINE_CLEAR, MAX_MINES, MAX_ZAPS, MAX_EVENTS,
    GRENADE_SPEED, GRENADE_VY0, GRENADE_GRAVITY, GRENADE_Y0,
    GRENADE_FUSE, GRENADE_WARN, GRENADE_SPLASH_R, GRENADE_SPLASH_R2,
    GRENADE_BOUNCE_PLANAR, GRENADE_BOUNCE_VY, GRENADE_FACE_KEEP,
    GRENADE_GROUND_FRICTION, GRENADE_MAX_BOUNCES, GRENADE_REST_VY,
    GRENADE_R, GRENADE_YMAX, GRENADE_VMAX, GRENADE_STEP, MAX_GRENADES,
    EMP_RANGE, EMP_HALF_ANGLE, EMP_TIME,
    WEAPON_ORDER, WEAPON_WEIGHTS,
    FIRE_CD, SPAWN_SHIELD, SHIELD_TIME, RESPAWN_TIME, RESPAWN_CLEAR,
    COIN_KO, COIN_PICKUP,
  },

  blankKart() {
    return {
      hits: 0, ammo: 0, weapon: null, health:COMBAT.maxHealth, maxHealth:COMBAT.maxHealth, ramT:0, spikesT:0, spikesUntil:0,
      shield: SPAWN_SHIELD, respawn: 0, spawnSeq: 0, deaths: 0,
      fireCd: 0, empT: 0, empFresh: false, prevAction: false, pendingFire: false, machineHeld: false,
    };
  },

  createExtra(state) {
    state.zaps = [];
    state.zapSeq = 0;
    state.scatterHits = new Map();
    state.spikeHits = new Map(); state.spikesAtMs=0;
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
      state.crateSeq += 1;
      state.crates.push({ id: 'c' + state.crateSeq, x: spot.x, z: spot.z });
    }
  },

  tick(state, connected, dt, previousKarts, econ, contacts=new Map(), fireGeometry) {
    if(state.phase&&state.phase!=='drive'){cancelPayloads(state);return false;}
    state.spikesAtMs=Number.isFinite(state.lastTick)?state.lastTick:(state.spikesAtMs||0)+dt*1000;
    const bound = Number(state.bound) > 0 ? Number(state.bound) : 28;
    const blocks = state.blocks;
    // Rising edges, respawns, fire, and pickups in stable roster order so
    // competing claims resolve deterministically exactly once.
    for (const kart of state.karts) {
      // The receipt latch fires a short press even when a newer neutral
      // intent already replaced it; the direct edge keeps test fixtures
      // that set inputs without onAction working. Consumed once per tick.
      const pressed = kart.pendingFire === true ||
        (!fireButtons.has(kart) && kart.input.boost === true && kart.prevAction !== true);
      kart.pendingFire = false;
      kart.prevAction = kart.input.boost === true;
      if (!connected.has(kart.pid)) {cancelPayload(kart);kart.machineHeld=false;kart.spikesT=0;kart.spikesUntil=0;continue;} // frozen: no fire or pickup
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
        kart.ramT = Math.max(0, (Number(kart.ramT) || 0) - dt);
        kart.spikesT=Math.max(0,Math.min(5,((kart.spikesUntil||0)-state.spikesAtMs)/1000));
        kart.fireCd = Math.max(payloads.has(kart)?-fireCooldownFor(state,kart):0, (Number(kart.fireCd) || 0) - dt);
        // EMP slow ticks only for connected live karts in drive (offline
        // karts `continue` above with the timer frozen; countdown/done
        // never reach this tick). Malformed values clamp into one slow.
        // A slow landed THIS tick keeps its full duration (see fireEmp).
        if (kart.empFresh === true) kart.empFresh = false;
        else kart.empT = Math.max(0, clampNum(Number(kart.empT) || 0, 0, EMP_TIME) - dt);
      }
      if ((pressed || payloads.has(kart)) && (Number(kart.respawn) || 0) <= 0) {
        // Inputs apply over this tick: fire from its start pose, then sweep
        // the new projectile and all moving targets through the same span.
        const start = previousKarts?.get(kart.pid) || kart;
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
        if (dx * dx + dz * dz < PICKUP_R2 && nearGround && !kart.weapon && !payloads.has(kart)) {
          const weapon = rollWeapon(state, typeof fireGeometry?.sweepStatic==='function');
          kart.weapon = weapon;
          kart.ammo = weapon === 'pulse' ? PULSE_AMMO : (COMBAT.weapons[weapon]?.ammo||1);
          const spot = pickSocket(state, state.crates, crate);
          state.crateSeq += 1;
          crate.id = 'c' + state.crateSeq;
          crate.x = spot.x;
          crate.z = spot.z;
          pushEvent(state, 'pickup', kart.pid, undefined, weapon);
          if (econ && typeof econ.award === 'function') {
            try { econ.award(kart.pid, COIN_PICKUP); } catch { /* economy never breaks the tick */ }
          }
          break; // exactly one award per kart per tick
        }
      }
    }
    // Contacts originate in the shared physical solver. Spawn protection
    // stays defensive; only an activated Shield carries offensive ramT.
    for(const [a,b] of contacts.values()) for(const [source,target] of [[a,b],[b,a]]) {
      if(connected.has(source.pid)&&source.respawn<=0&&source.ramT>0&&!splashBlocked(source.x,source.z,target.x,target.z,blocks))damage(state,target,source.pid,'shield',connected,econ);
    }
    if(typeof fireGeometry?.sweepStatic==='function')spikeContacts(state,connected,previousKarts,econ,fireGeometry);
    // Zaps fly straight, die on walls/blocks/expiry, and damage hull hits.
    // Rockets detonate on hull/block/wall impact (splash, LOS only, max 1
    // KO); TTL expiry fizzles with no blast. Rails stop first-hit like
    // pulse. Sweeping, wall-first ties, and exactly-once scoring hold at
    // all speeds (110/95/85/160).
    const alive = [];
    for (const zap of state.zaps) {
      const speed = zapSpeed(zap);
      const physical = zap.physical===true && fireGeometry?.sweepStatic;
      const from = { x: zap.x, z: zap.z, ...(physical?{y:zap.y}:{}) };
      const to = physical ? {x:zap.x+zap.vx*dt,y:zap.y+zap.vy*dt,z:zap.z+zap.vz*dt}
        : {x:zap.x+Math.sin(zap.angle)*speed*dt,z:zap.z+Math.cos(zap.angle)*speed*dt};
      // Stop at the earliest expiry, world edge, block, or hull. A block or
      // boundary wins an exact tie, so a shot never scores through a wall.
      // impact tracks the winner for rockets (wall/block => blast, ttl =>
      // fizzle, void => muzzle outside, never blasts through the wall).
      let stop = zap.ttl <= 0 ? 0 : dt > 0 && zap.ttl <= dt ? zap.ttl / dt : Infinity;
      let impact = (zap.ttl <= 0 || (dt > 0 && zap.ttl <= dt)) ? 'ttl' : null;
      if (physical) {
        const hit=fireGeometry.sweepStatic(from,to,COMBAT.staticSweepRadii[zap.kind]||0);
        if(hit&&hit.fraction<=stop){stop=hit.fraction;impact='block';}
      } else if (Math.abs(from.x) > bound || Math.abs(from.z) > bound) { stop = 0; impact = 'void'; }
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
      for (const kart of state.karts) {
        if (kart.pid === zap.owner) continue; // never self-hit
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
      const isRocket = zap.kind === 'rocket';
      if(physical&&stop<=1&&impact!=='ttl'&&impact!=='void'){
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
          damage(state,victim,zap.owner,zap.kind||'pulse',connected,econ,damageAt(zap.kind||'pulse'),zap.volley);
        }
      } else if (stop > 1) {
        zap.x = to.x; zap.z = to.z; if(physical)zap.y=to.y; zap.ttl -= dt;
        alive.push(zap);
      } else if (isRocket && (impact === 'wall' || impact === 'block')) {
        const ix = from.x + (to.x - from.x) * stop;
        const iz = from.z + (to.z - from.z) * stop;
        detonateRocket(state, zap, ix, iz, connected, econ,null,{x:ix,y:physical?from.y+(to.y-from.y)*stop:-PHYSICS.chassis.modelOriginY+PHYSICS.combat.rocketMuzzle.y,z:iz},fireGeometry);
      }
      // Else: consumed by a blocker (non-rocket), TTL fizzle (rocket or
      // not), or void muzzle — gone, no blast, no score.
    }
    state.zaps = alive;
    const liveVolleys=new Set(alive.map(z=>z.volley).filter(Boolean));
    for(const id of state.scatterHits.keys())if(!liveVolleys.has(id))state.scatterHits.delete(id);
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
      if (live) {
        const maxTravel = 40 * Math.max(0, dt) + 3;
        for (const kart of state.karts) {
          if (kart.pid === mine.owner) continue; // exact owner never hit
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
            if (dx * dx + dz * dz + (ay-my)**2 >= MINE_R2) continue;
            if (physical ? fireGeometry.sweepStatic({x:mine.x,y:my+.2,z:mine.z},{x:ax,y:ay,z:az}) : splashBlocked(mine.x,mine.z,ax,az,blocks)) continue;
            if (t1 < bestT) { bestT = t1; victim = kart; }
            continue;
          }
          const tEnter = mineEntryTime(bx, bz, ax, az, mine.x, mine.z, t0, t1, by,ay,my);
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
      if (victim) damage(state,victim,mine.owner,'mine',connected,econ);
      else if (!expired) kept.push(mine);
    }
    state.mines = kept;
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
      if (g.fuse <= 0) detonateGrenade(state,g,connected,econ,fireGeometry);
      else keptG.push(g);
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
        const vx = physical?z.vx:Math.sin(z.angle) * speed;
        const vz = physical?z.vz:Math.cos(z.angle) * speed;
        return {
          id: z.id, kind: z.kind || 'pulse',
          x: +z.x.toFixed(physical?3:2), z: +z.z.toFixed(physical?3:2), angle: +z.angle.toFixed(3),
          speed,
          ttl: +Math.max(0, Number(z.ttl) || 0).toFixed(2),
          vx: +vx.toFixed(2), vz: +vz.toFixed(2),
          ...(physical?{physical:true,radius:z.radius??(COMBAT.staticSweepRadii[z.kind]||0),y:+z.y.toFixed(3),vy:+z.vy.toFixed(2)}:{y:-PHYSICS.chassis.modelOriginY+(PHYSICS.combat[(z.kind||'pulse')+'Muzzle']?.y||0)}),
        };
      }),
      mines: state.mines.map((m) => ({
        id: m.id, owner: m.owner,
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
          warning: fuse <= GRENADE_WARN,
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
      ramT: +Math.max(0,Number(kart.ramT)||0).toFixed(2),
      spikesT: +Math.max(0,Number(kart.spikesT)||0).toFixed(2),
      ammo: kart.ammo,
      weapon: kart.weapon || null,
      firing: payloads.has(kart),
      shield: +Math.max(0, Number(kart.shield) || 0).toFixed(2),
      respawn: +Math.max(0, Number(kart.respawn) || 0).toFixed(2),
      spawnSeq: Number(kart.spawnSeq) || 0,
      deaths: Number(kart.deaths) || 0,
      // EMP slow: honest feedback for the discharge visual + handling
      // readout. empT is the authoritative remaining slow in seconds
      // (0 when clean); slowed mirrors empT > 0.
      empT: +clampNum(Number(kart.empT) || 0, 0, EMP_TIME).toFixed(2),
      slowed: (Number(kart.empT) || 0) > 0,
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
