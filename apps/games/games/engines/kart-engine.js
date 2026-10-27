'use strict';
/* Shared kart-arena server factory. One simulation, many thin games:
 * each kart game is a declarative config (metadata, settings defaults,
 * offered modes/maps) plus this engine — no copied physics.
 *
 * Steering convention (fixed, camera-anchored): steer +1 means SCREEN
 * RIGHT under the chase camera. Forward is (sin a, cos a); at angle 0
 * the kart faces +z with the camera behind at -z, so screen right is
 * -x and pressing right DECREASES the angle (see stepKart). The client
 * prediction mirror (public/js/engines/kart-pose.mjs stepSelf) uses the
 * identical sign; test/kart-framework.js anchors both to the camera.
 *
 * Handling model (flat-arena toy karts, NOT a rigidbody sim): scalar
 * forward speed plus a lateral slip component along screen-right. Holding
 * drift (Shift / DRIFT) through a forward turn slides the tail out and
 * charges a mini-turbo, released once when the drift ends at full charge.
 * Boost pads grant a brief automatic turbo with a bounded cooldown.
 * Low-grip surfaces (Frosty ice) widen turns and prolong slides. Wall and
 * obstacle hits slide along the face; kart-to-kart contact separates
 * deterministically (authority only — prediction never resolves it).
 *
 * Boundaries kept from Pocket Karts: kinematic server sim at 10 Hz,
 * validated steer/throttle/boost/drift INTENTS only (never coordinates or
 * client timestamps), receipt-time TTL (1.5 s) with a 500 ms client
 * keepalive, instant freeze on disconnect, countdown -> drive -> done,
 * ties share the win, views never leak inputs. */

const { mapDef, normalizeMapId } = require('./kart-maps');
const starrush = require('./kart-rules-starrush');
const battle = require('./kart-rules-battle');
const { rankStandings } = require('./kart-standings');

const RULES = { starrush, battle };

const ARENA_HALF = 30;
const BOUND = ARENA_HALF - 2;
const KART_R = 2.05; // encloses the shipped kart hull (1.96 radial units)
const COUNTDOWN_MS = 3000;
// Round length: 1 to 5 minutes, 3 by default (GAME_RULES_STANDARD.md).
// Stored in seconds so existing settings and presets keep their key.
const ROUND_MIN_S = 60;
const ROUND_MAX_S = 300;
const ROUND_DEFAULT_S = 180;
// A driver who leaves, or stays gone this long, drops out (room-owned).
const GONE_AFTER_MS = 60000;
const MAX_SPEED = 20;
const MAX_REVERSE = 5;
const ACCEL = 28;
const BRAKE = 26;
const DRAG = 1.4;
const TURN_RATE = 2.3;
const BOOST_SPEED = 1.6;
const BOOST_TIME = 1.2;
const BOOST_COOLDOWN = 6;
const MAX_DT = 0.25;
const INPUT_TTL_MS = 1500;
const START_R = 12;
// Drift: optional boolean intent, useful only in a forward turn at speed.
const DRIFT_MIN_SPEED = 6;
const DRIFT_STEER_MIN = 0.15;
const DRIFT_TURN = 1.45; // sharper yaw while sliding
const DRIFT_SLIP = 0.38; // lateral target = -steer * speed * this (outward)
const DRIFT_BLEND = 8; // per-second approach to the slide target
const SLIP_RECOVER = 6; // per-second lateral decay, scaled by surface grip
const SLIP_MAX = 8;
const DRIFT_CHARGE_NEED = 0.9; // seconds of sustained drift for a full charge
const MINI_TURBO_TIME = 0.9; // release-at-full-charge reward, once per drift
// Turbo strips: automatic on drive-over, bounded, both modes.
const TURBO_TIME = 1.0;
const TURBO_SPEED = 1.35;
const PAD_COOLDOWN = 3;
const PAD_MIN_SPEED = 3; // parked karts never trigger a strip
// Rechargeable nitro: independent hold-to-boost tank, both modes, either
// battle variant. Charge is server-owned 0..1; holding N (or NITRO) drains
// only with useful forward throttle, otherwise it recharges. Empty locks
// until NITRO_REARM. Never stacks multiplicatively: the strongest of
// boost/turbo/nitro sets the top speed, so the cap stays bounded.
const NITRO_DRAIN = 0.4; // full tank ~= 2.5 s of boost
const NITRO_RECHARGE = 0.15; // empty to full ~= 6.7 s of normal driving
const NITRO_REARM = 0.3; // empty tank refuses until 30% refills
const NITRO_SPEED = 1.5;
const NITRO_PUNCH = 1.75;
// EMP slow (battle only; Star Rush karts omit empT): while empT > 0 the
// resolved top speed, acceleration, and turn rate scale down AFTER
// tuning and nitro. Nitro still helps relatively but can never bypass
// the slowed cap; steering/throttle stay live, movement stays playable.
// kart-pose.mjs mirrors these three factors bit-for-bit (parity-tested).
const EMP_TOP_SCALE = 0.62;
const EMP_ACCEL_SCALE = 0.6;
const EMP_TURN_SCALE = 0.75;
// Contact: glance along faces, deterministic kart separation.
const SLIDE_KEEP = 0.9; // tangent velocity kept through a wall/block glance
const CONTACT_KEEP = 0.4; // relative normal motion kept through kart contact
const PALETTES = ['Daybreak', 'Sunset', 'Starlight'];
const LEGACY_PALETTES = { Violet: 'Starlight', Mint: 'Daybreak' };
/* Round rules (server-owned, host-configured). 'Score target' ends the
 * round the instant a goal lands; 'Time limit' always plays to the
 * deadline and crowns the top score. Old derived games without a
 * configured winRule keep 'Score target' (legacy behavior). */
const WIN_RULES = ['Time limit', 'Score target'];
/* Sky presentation. 'Live sunset' publishes a shared skyCycle window the
 * renderers interpolate; 'Fixed light' holds the chosen palette. */
const LIGHT_CYCLES = ['Live sunset', 'Fixed light'];
/* Garage progression (Pocket Karts battle only; classic defaults off).
 * Coins are room-scoped per-seat (ctx.session, no accounts, no paid
 * money). Prices escalate per level: 20 to reach 1, 35 to reach 2, 55 to
 * reach 3. Engine L: top speed AND acceleration x(1+0.05L). Handling L:
 * turn rate x(1+0.04L). Reload L: fire cooldown x(1-0.06L). The pose
 * mirror multiplies its MAX_SPEED/ACCEL/TURN_RATE by the kart's tuning
 * (view.karts[].tuning) when view.garage is true; classic tuning is 1. */
const GARAGE_CATS = ['engine', 'handling', 'reload'];
const GARAGE_MAX = 3;
const GARAGE_PRICES = [20, 35, 55]; // cost to reach level 1/2/3
const GARAGE_NONCE_CAP = 200; // bounded exact-once purchase nonces per game
const GARAGE_WALLET_CAP = 24; // room seats max; departing ghosts pruned past this
const COIN_PARTICIPATION = 5;
const COIN_WIN = 15;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/* World-space forward for a kart angle: MUST equal the mesh forward
 * (nose +z rotated by yaw=angle gives exactly this) and the 2D fallback
 * nose (canvas rotation PI-angle). Single source for all three. */
function forwardOf(angle) {
  return { x: Math.sin(angle), z: Math.cos(angle) };
}

/* Screen-right world direction under the chase camera (camera sits at
 * pose - forward*back looking at pose + forward*ahead): right = -forward
 * rotated... concretely right = forward x up with up=+y gives
 * (fz*1 - 0, ..., ) — for forward (fx,fz): right = (-fz, fx)? Check at
 * angle 0: forward (0,1) -> right must be -x, i.e. (-1, 0). (-fz,fx) =
 * (-1, 0). Correct. Also the lateral (slip) axis of every kart. */
function screenRightOf(angle) {
  const f = forwardOf(angle);
  return { x: -f.z, z: f.x };
}

/* True ground-plane velocity from the (speed, slip) pair. Slip rides the
 * screen-right axis with an OUTWARD drift target (see stepKartOnce): a held
 * right turn (steer +1, nose swinging toward screen right) throws the tail
 * toward screen LEFT, so slip goes negative and the velocity heading LAGS
 * the nose. Pure; the pose mirror duplicates it. */
function kartVelocity(kart) {
  const f = forwardOf(kart.angle);
  const r = screenRightOf(kart.angle);
  const speed = Number(kart.speed) || 0;
  const slip = Number(kart.slip) || 0;
  return { vx: f.x * speed + r.x * slip, vz: f.z * speed + r.z * slip };
}

/* Rewrite (speed, slip) from a velocity vector after a collision keeps or
 * kills part of it. Collisions only ever REMOVE energy (see slideAlong and
 * resolveContacts); the clamps below are backstops, never additions. The
 * top backstop respects garage tuning so tuned karts are not capped to
 * the stock max through a glance (classic stays bit-identical at 1.0). */
function setVelocity(kart, vx, vz) {
  const f = forwardOf(kart.angle);
  const r = screenRightOf(kart.angle);
  const cap = MAX_SPEED * BOOST_SPEED * tuningFor(kart).top;
  kart.speed = clamp(vx * f.x + vz * f.z, -MAX_REVERSE, cap);
  kart.slip = clamp(vx * r.x + vz * r.z, -SLIP_MAX, SLIP_MAX);
}

/* Glancing response along a face with outward normal (nx, nz): the
 * into-surface component dies, the tangent keeps SLIDE_KEEP. Head-on hits
 * stop dead (tangent ~0); grazes slide instead of sticking or jittering.
 * Pure apart from the kart it mutates; mirrored by the pose helper. */
function slideAlong(kart, nx, nz) {
  const v = kartVelocity(kart);
  const vn = v.vx * nx + v.vz * nz;
  if (vn >= 0) return; // resting contact or moving away: position only
  const tx = (v.vx - vn * nx) * SLIDE_KEEP;
  const tz = (v.vz - vn * nz) * SLIDE_KEEP;
  setVelocity(kart, tx, tz);
}

function startPose(i, n) {
  const a = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
  return { x: Math.cos(a) * START_R, z: Math.sin(a) * START_R, angle: wrapAngle(a + Math.PI / 2) };
}

/* Per-match seed, generated ONCE at create: FNV-1a over the server clock
 * plus the stable driver roster. Deterministic for a fixed (now, roster)
 * pair (so fixtures rerun bit-identically) yet varying across real
 * matches and rematches. Authority-only: never sent to views. */
function matchSeed(now, players) {
  let h = 0x811c9dc5;
  const s = String(now) + ':' + players.map((p) => p.id).join(',');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/* Surface grip under a point: first matching zone wins (map zones never
 * overlap), clamped sane. 1 is normal asphalt; Frosty ice runs ~0.3. */
function gripAt(x, z, surfaces) {
  if (surfaces) {
    for (const s of surfaces) {
      if (!s) continue;
      if (Math.abs(x - s.x) <= s.hw && Math.abs(z - s.z) <= s.hd) {
        return clamp(Number(s.grip), 0.15, 1.25);
      }
    }
  }
  return 1;
}

function collideBlocks(kart, blocks) {
  for (const b of blocks) {
    const cx = clamp(kart.x, b.x - b.hw, b.x + b.hw);
    const cz = clamp(kart.z, b.z - b.hd, b.z + b.hd);
    let dx = kart.x - cx;
    let dz = kart.z - cz;
    let d2 = dx * dx + dz * dz;
    if (d2 >= KART_R * KART_R) continue;
    if (d2 < 1e-9) {
      // Center inside the block: push out along the smallest penetration.
      const px = b.hw + KART_R - Math.abs(kart.x - b.x);
      const pz = b.hd + KART_R - Math.abs(kart.z - b.z);
      if (px < pz) {
        const s = kart.x >= b.x ? 1 : -1;
        kart.x = b.x + s * (b.hw + KART_R);
        slideAlong(kart, s, 0);
      } else {
        const s = kart.z >= b.z ? 1 : -1;
        kart.z = b.z + s * (b.hd + KART_R);
        slideAlong(kart, 0, s);
      }
    } else {
      const d = Math.sqrt(d2);
      const push = (KART_R - d) / d;
      slideAlong(kart, dx / d, dz / d);
      kart.x += dx * push;
      kart.z += dz * push;
    }
  }
}

/* Deterministic kart-to-kart separation, AUTHORITY ONLY (the prediction
 * mirror never runs this: it cannot know rivals' true poses). Stable
 * roster order, no RNG: overlaps split evenly, and only the APPROACHING
 * part of relative normal motion is damped (CONTACT_KEEP < 1), so contact
 * strictly removes energy — no repeated injection, no overlap exploit, no
 * flying karts, no damage or scoring. A frozen (disconnected) kart never
 * moves: the connected rival takes the full push. One sweep over all pairs;
 * the tick driver repeats it (bounded) with solid reprojection between
 * passes until no overlap remains. Returns true when any pair overlapped. */
function resolveContacts(karts, connected, bound, contacts) {
  const B = Number(bound) > 0 ? Number(bound) : BOUND;
  const MIN_D = KART_R * 2;
  // Penetration slop: resting contact at 2R +/- 1ulp must NOT re-fire
  // every tick (1ulp jitter breaks exact position holds). Resolution
  // still pushes out to exactly MIN_D; anything within slop is at rest.
  const REST_D2 = (MIN_D - 1e-9) * (MIN_D - 1e-9);
  let hit = false;
  for (let i = 0; i < karts.length; i++) {
    for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i];
      const b = karts[j];
      // KO'd karts are skipped entirely: rivals drive through the wreck
      // instead of piling onto it (battle sets respawn > 0 while out).
      if ((Number(a.respawn) || 0) > 0 || (Number(b.respawn) || 0) > 0) continue;
      const aOn = !connected || connected.has(a.pid);
      const bOn = !connected || connected.has(b.pid);
      if (!aOn && !bOn) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= REST_D2) continue;
      if(contacts)contacts.set(a.pid+':'+b.pid,[a,b]);
      // Position separation still needs solid reprojection when the pair
      // is stationary or already moving apart (no velocity impulse).
      hit = true;
      let nx;
      let nz;
      let d;
      if (d2 < 1e-9) {
        // Exactly stacked: deterministic axis from seat order, never NaN.
        nx = (i + j) % 2 === 0 ? 1 : 0;
        nz = nx ? 0 : 1;
        d = 0;
      } else {
        d = Math.sqrt(d2);
        nx = dx / d;
        nz = dz / d;
      }
      if (aOn && bOn) {
        const push = (MIN_D - d) / 2;
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;
        a.x = clamp(a.x, -B, B);
        a.z = clamp(a.z, -B, B);
        b.x = clamp(b.x, -B, B);
        b.z = clamp(b.z, -B, B);
        const va = kartVelocity(a);
        const vb = kartVelocity(b);
        const rvn = (vb.vx - va.vx) * nx + (vb.vz - va.vz) * nz;
        if (rvn >= 0) continue; // separating: positions only
        const vai = va.vx * nx + va.vz * nz;
        const vbi = vb.vx * nx + vb.vz * nz;
        const avg = (vai + vbi) / 2;
        const nai = avg + (vai - avg) * CONTACT_KEEP;
        const nbi = avg + (vbi - avg) * CONTACT_KEEP;
        setVelocity(a, va.vx + (nai - vai) * nx, va.vz + (nai - vai) * nz);
        setVelocity(b, vb.vx + (nbi - vbi) * nx, vb.vz + (nbi - vbi) * nz);
      } else {
        // One side frozen: it never moves; the live kart takes the push
        // and loses its into-ghost component. No hiding inside ghosts.
        const mover = aOn ? a : b;
        const s = aOn ? -1 : 1;
        mover.x += s * nx * (MIN_D - d);
        mover.z += s * nz * (MIN_D - d);
        mover.x = clamp(mover.x, -B, B);
        mover.z = clamp(mover.z, -B, B);
        const v = kartVelocity(mover);
        const vn = v.vx * nx + v.vz * nz;
        if (vn * s < 0) setVelocity(mover, v.vx - vn * nx, v.vz - vn * nz);
      }
    }
  }
  return hit;
}

/* Reproject a LIVE kart against solids after contact separation: pushing
 * two karts apart can shove one into a block face or past a wall. Blocks
 * reuse collideBlocks (face slide + push-out); walls clamp and kill outward
 * velocity. Only ever removes energy; frozen karts are never passed here. */
function reprojectLive(kart, blocks, bound) {
  const B = Number(bound) > 0 ? Number(bound) : BOUND;
  if (blocks) collideBlocks(kart, blocks);
  if (kart.x <= -B || kart.x >= B) {
    slideAlong(kart, kart.x < 0 ? 1 : -1, 0);
    kart.x = clamp(kart.x, -B, B);
  }
  if (kart.z <= -B || kart.z >= B) {
    slideAlong(kart, 0, kart.z < 0 ? 1 : -1);
    kart.z = clamp(kart.z, -B, B);
  }
}

/* Every tick integrates in shared <=0.04 s substeps with kart contact
 * resolved after EACH substep (not once at the end). At the boosted top
 * speed (22.4 u/s) two head-on karts close at 44.8 u/s, so a 0.04 s substep
 * moves them 1.79u relative — shorter than the 2.2u hull diameter, so they
 * always overlap mid-tick and separate instead of crossing through each
 * other. The same split keeps single steps shorter than any obstacle (a
 * 0.25 s hitch tick travels 5.6u unsplit — wider than a bumper block).
 * Ordinary 10 Hz ticks take 3 substeps. The visual prediction mirror
 * (kart-pose.mjs stepSelf) implements the SAME split so single-kart
 * rollouts stay bit-identical. */
const STEP_MAX = 0.04;
/* Contact settle passes per substep: one sweep separates a pair, but 8
 * karts piled in a corner need a few passes to all reach 2R. Bounded and
 * deterministic; every pass only removes energy. */
const CONTACT_ITERS = 8;

function stepKart(kart, dt, opts) {
  const n = dt > STEP_MAX ? Math.ceil(dt / STEP_MAX) : 1;
  if (n <= 1) {
    stepKartOnce(kart, dt, opts);
    return;
  }
  const h = dt / n;
  for (let i = 0; i < n; i++) stepKartOnce(kart, h, opts);
}

/* Garage tuning multipliers for a kart. Classic (kart.garage !== true)
 * and fixtures without upgrades return flat 1.0 — bit-identical physics.
 * Garage: engine L scales top speed AND acceleration, handling L scales
 * turn rate. Reload affects fire cooldown in the battle rules, not here. */
function tuningFor(kart) {
  if (!kart || kart.garage !== true) return { top: 1, accel: 1, turn: 1 };
  const up = kart.upgrades && typeof kart.upgrades === 'object' ? kart.upgrades : null;
  const eng = up ? clamp(Math.floor(Number(up.engine) || 0), 0, GARAGE_MAX) : 0;
  const han = up ? clamp(Math.floor(Number(up.handling) || 0), 0, GARAGE_MAX) : 0;
  return { top: 1 + 0.05 * eng, accel: 1 + 0.05 * eng, turn: 1 + 0.04 * han };
}

function stepKartOnce(kart, dt, opts) {
  const { steer, throttle } = kart.input;
  const allowBoost = !opts || opts.allowBoost !== false;
  if (allowBoost && kart.input.boost && kart.boostCd <= 0 && kart.boost <= 0) {
    kart.boost = BOOST_TIME;
    kart.boostCd = BOOST_COOLDOWN;
  }
  kart.boost = Math.max(0, kart.boost - dt);
  kart.boostCd = Math.max(0, kart.boostCd - dt);
  kart.turbo = Math.max(0, (Number(kart.turbo) || 0) - dt);
  kart.padCd = Math.max(0, (Number(kart.padCd) || 0) - dt);
  if (kart.nitro === undefined) kart.nitro = 1;
  if (kart.nitroActive === undefined) kart.nitroActive = false;
  if (kart.nitroLocked === undefined) kart.nitroLocked = false;
  kart.nitro = clamp(Number(kart.nitro), 0, 1);
  // Nitro drains only on a held N with useful forward throttle and a
  // non-empty unlocked tank; otherwise the tank recharges. Empty locks
  // until NITRO_REARM — holding longer never extends the boost.
  const wantNitro = kart.input.nitro === true;
  const useful = throttle > 0;
  if (kart.nitroLocked === true) {
    kart.nitroActive = false;
    kart.nitro = Math.min(1, kart.nitro + NITRO_RECHARGE * dt);
    if (kart.nitro >= NITRO_REARM) kart.nitroLocked = false;
  } else if (wantNitro && useful && kart.nitro > 0) {
    kart.nitroActive = true;
    kart.nitro = Math.max(0, kart.nitro - NITRO_DRAIN * dt);
    if (kart.nitro <= 0) kart.nitroLocked = true;
  } else {
    kart.nitroActive = false;
    kart.nitro = Math.min(1, kart.nitro + NITRO_RECHARGE * dt);
  }
  const boosting = kart.boost > 0;
  const turboing = kart.turbo > 0;
  const nitroing = kart.nitroActive === true;
  const tune = tuningFor(kart);
  // EMP slow reads the battle-owned empT timer (this step never ticks it:
  // rules.tick owns the countdown after motion, exactly like shield).
  // NaN/missing/negative read clean; only finite > 0 slows.
  const slowed = Number(kart.empT) > 0;
  // Boost, pad/mini turbo, and nitro never stack multiplicatively: the
  // strongest cap wins, so the top speed stays bounded at 1.6x either
  // way (times the garage top multiplier when it applies). The EMP scale
  // applies last, so nitro cannot bypass the slowed cap.
  const top = MAX_SPEED * tune.top * Math.max(boosting ? BOOST_SPEED : 1, turboing ? TURBO_SPEED : 1, nitroing ? NITRO_SPEED : 1) * (slowed ? EMP_TOP_SCALE : 1);
  const punch = boosting ? 2 : nitroing ? NITRO_PUNCH : turboing ? 1.5 : 1;
  const accel = ACCEL * tune.accel * (slowed ? EMP_ACCEL_SCALE : 1);
  if (throttle > 0) kart.speed = Math.min(top, kart.speed + accel * punch * throttle * dt);
  else if (throttle < 0) {
    kart.speed = kart.speed > 0.5
      ? Math.max(0, kart.speed + BRAKE * throttle * dt)
      : Math.max(-MAX_REVERSE, kart.speed + accel * 0.7 * throttle * dt);
  } else {
    const d = DRAG * dt;
    kart.speed = kart.speed > d ? kart.speed - d : kart.speed < -d ? kart.speed + d : 0;
  }
  kart.speed = clamp(kart.speed, -MAX_REVERSE, top);
  const surfaces = opts && opts.surfaces;
  const grip = gripAt(kart.x, kart.z, surfaces);
  kart.grip = grip;
  // Drift is a HELD turn at forward speed: useless parked, straight, or
  // reversing, and it never fires the mode action by itself.
  const wantDrift = kart.input.drift === true;
  const active = wantDrift && kart.speed > DRIFT_MIN_SPEED && Math.abs(steer) > DRIFT_STEER_MIN;
  const was = kart.drifting === true;
  if (kart.slip === undefined) kart.slip = 0;
  if (kart.driftCharge === undefined) kart.driftCharge = 0;
  if (active) {
    // OUTWARD tail slide: a right turn (steer +1, nose swinging toward
    // screen right) throws the tail toward screen LEFT, so the slip target
    // is NEGATIVE along the screen-right axis and the velocity heading lags
    // the nose instead of leading it. Left turns mirror. (The old +steer
    // sign pushed INTO the turn — velocity ahead of the nose, not a slide.)
    const target = -steer * kart.speed * DRIFT_SLIP;
    kart.slip += (target - kart.slip) * Math.min(1, DRIFT_BLEND * dt);
    kart.slip = clamp(kart.slip, -SLIP_MAX, SLIP_MAX);
    // Normalized 0..1 charge (snapshots and the drift meter read it raw).
    kart.driftCharge = Math.min(1, kart.driftCharge + dt / DRIFT_CHARGE_NEED);
  } else {
    // Release: a full charge cashes in EXACTLY once, and ONLY on a
    // deliberate release of the drift key at useful forward speed. Holding
    // Shift while the speed sags or the steering centers (stale intent),
    // coasting after a wall kill, or a TTL input wipe must never mint a
    // turbo — those clear the charge silently. (TTL/disconnect also clear
    // drifting+charge before stepping, so `was` is already false there.)
    if (was && kart.driftCharge >= 1 && !wantDrift && kart.speed > DRIFT_MIN_SPEED) {
      kart.turbo = Math.max(kart.turbo, MINI_TURBO_TIME);
    }
    kart.driftCharge = 0;
    // Recoverable grip: lateral velocity bleeds off fast on asphalt and
    // lingers on ice (grip scales the decay, never below zero).
    kart.slip -= kart.slip * Math.min(1, SLIP_RECOVER * grip * dt);
    if (Math.abs(kart.slip) < 1e-9) kart.slip = 0;
  }
  kart.drifting = active;
  const gripSpeed = clamp(Math.abs(kart.speed) / 8, 0.35, 1);
  const surfTurn = 0.65 + 0.35 * clamp(grip, 0, 1); // 1.0 on asphalt
  const driftTurn = active ? DRIFT_TURN : 1;
  /* CORRECTED SIGN: +steer (right key) turns toward screen right. At
   * angle 0 (facing +z, camera behind at -z) screen right is -x, so a
   * right turn must decrease the angle (x velocity = sin(a)*speed). In
   * reverse the car-like inversion is preserved via the speed factor.
   * The EMP turn factor sits in the identical chain position as the
   * pose mirror's, so slowed yaw agrees bit-for-bit. */
  kart.angle = wrapAngle(kart.angle - steer * TURN_RATE * tune.turn * (slowed ? EMP_TURN_SCALE : 1) * gripSpeed * surfTurn * driftTurn * dt * (kart.speed < -0.5 ? -1 : 1));
  const f = forwardOf(kart.angle);
  const r = screenRightOf(kart.angle);
  kart.x += (f.x * kart.speed + r.x * kart.slip) * dt;
  kart.z += (f.z * kart.speed + r.z * kart.slip) * dt;
  const pads = opts && opts.pads;
  if (pads) {
    for (const p of pads) {
      if (!p) continue;
      if (Math.abs(kart.x - p.x) <= p.hw && Math.abs(kart.z - p.z) <= p.hd &&
          kart.padCd <= 0 && kart.speed > PAD_MIN_SPEED) {
        kart.turbo = Math.max(kart.turbo, TURBO_TIME);
        kart.padCd = PAD_COOLDOWN;
        break; // one strip per substep: overlapping strips never double-pay
      }
    }
  }
  if (opts && opts.blocks) collideBlocks(kart, opts.blocks);
  // Large arenas (half=60) drive at bound=58; legacy callers without
  // opts.bound keep the historical +/-28 walls. Never silently clamp a
  // big map to the small walls: the tick always passes state.bound.
  const wall = opts && Number(opts.bound) > 0 ? Number(opts.bound) : BOUND;
  if (kart.x < -wall || kart.x > wall) {
    slideAlong(kart, kart.x < 0 ? 1 : -1, 0);
    kart.x = clamp(kart.x, -wall, wall);
  }
  if (kart.z < -wall || kart.z > wall) {
    slideAlong(kart, 0, kart.z < 0 ? 1 : -1);
    kart.z = clamp(kart.z, -wall, wall);
  }
}

/* Drift and nitro are OPTIONAL boolean intents: legacy clients omit
 * them (falsy) and keep the exact 3-key shape, so old intents validate
 * bit-for-bit. Only an explicit `drift: true` arms the slide and an
 * explicit `nitro: true` holds the tank open — never coordinates,
 * scores, charge values, or client timestamps. */
function cleanInput(a) {
  const raw = a && typeof a === 'object' ? a.input : undefined;
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.steer !== 'number' || typeof raw.throttle !== 'number' ||
      !Number.isFinite(raw.steer) || !Number.isFinite(raw.throttle)) {
    return { steer: 0, throttle: 0, boost: false };
  }
  const out = {
    steer: clamp(raw.steer, -1, 1),
    throttle: clamp(raw.throttle, -1, 1),
    boost: raw.boost === true,
  };
  if (raw.drift === true) out.drift = true;
  if (raw.nitro === true) out.nitro = true;
  return out;
}

/* Garage store: room-scoped per-seat wallet + upgrades + purchase
 * nonces. Preferred: ctx.session() (room.js, scoped automatically to the
 * running game id, survives rematches and away/back, dies with the room).
 * Fixtures without ctx.session fall back to a per-match object on the
 * state (functional single-match economy, no persistence). Shape:
 * { coins:{pid:n}, upgrades:{pid:{engine,handling,reload}},
 *   seen:{nonce:1}, seenOrder:[nonce...] }. Trusted server-only; clients
 * never address it (no pids or keys from the wire reach the store
 * except the sender's own validated pid and nonce). */
function ensureGarageShape(store) {
  if (!store || typeof store !== 'object') return { coins: {}, upgrades: {}, seen: {}, seenOrder: [] };
  if (!store.coins || typeof store.coins !== 'object') store.coins = {};
  if (!store.upgrades || typeof store.upgrades !== 'object') store.upgrades = {};
  if (!store.seen || typeof store.seen !== 'object') store.seen = {};
  if (!Array.isArray(store.seenOrder)) store.seenOrder = [];
  return store;
}

function garageStore(ctx, state) {
  let store = null;
  if (ctx && typeof ctx.session === 'function') {
    try { store = ctx.session(); } catch { store = null; }
  }
  if (!store || typeof store !== 'object') {
    if (!state._garageLocal || typeof state._garageLocal !== 'object') state._garageLocal = {};
    store = state._garageLocal;
  }
  return ensureGarageShape(store);
}

function garageCoins(store, pid) {
  if (!store || !store.coins) return 0;
  return Math.max(0, Math.floor(Number(store.coins[pid]) || 0));
}

function garageLevels(store, pid) {
  const out = { engine: 0, handling: 0, reload: 0 };
  const up = store && store.upgrades ? store.upgrades[pid] : null;
  if (up && typeof up === 'object') {
    for (const c of GARAGE_CATS) out[c] = clamp(Math.floor(Number(up[c]) || 0), 0, GARAGE_MAX);
  }
  return out;
}

/* Award coins exactly once (server-side only). Prunes departing ghosts
 * past the 24-seat cap (non-drivers first), so the wallet never grows
 * without bound. keepPids is the current driver set (may be null). */
function awardGarageCoins(store, pid, amount, keepPids) {
  ensureGarageShape(store);
  if (!pid || typeof pid !== 'string') return 0;
  const amt = Math.floor(Number(amount) || 0);
  if (amt <= 0) return garageCoins(store, pid);
  if (!Object.prototype.hasOwnProperty.call(store.coins, pid) &&
      Object.keys(store.coins).length >= GARAGE_WALLET_CAP) {
    const keys = Object.keys(store.coins);
    let evicted = false;
    for (const k of keys) {
      if (!keepPids || !keepPids.has(k)) {
        delete store.coins[k];
        delete store.upgrades[k];
        evicted = true;
        break;
      }
    }
    if (!evicted && keys.length) {
      delete store.coins[keys[0]];
      delete store.upgrades[keys[0]];
    }
  }
  store.coins[pid] = garageCoins(store, pid) + amt;
  return store.coins[pid];
}

/* Claim a purchase nonce exactly once. False for missing/malformed or
 * replayed nonces (no-op, never double-charges). Bounded to the last
 * GARAGE_NONCE_CAP entries. */
function claimGarageNonce(store, nonce) {
  ensureGarageShape(store);
  if (typeof nonce !== 'string' || nonce.length < 1 || nonce.length > 64) return false;
  if (store.seen[nonce]) return false;
  store.seen[nonce] = 1;
  store.seenOrder.push(nonce);
  while (store.seenOrder.length > GARAGE_NONCE_CAP) {
    const drop = store.seenOrder.shift();
    delete store.seen[drop];
  }
  return true;
}

function hasGarageNonce(store, nonce) {
  return !!store && !!store.seen && typeof nonce === 'string' && !!store.seen[nonce];
}

/* Copy the persistent wallet/upgrades into the match state for views
 * (views never receive ctx, so the state carries a projection). Small:
 * at most 24 seats. */
function syncGarageState(state, store) {
  ensureGarageShape(store);
  const coins = {};
  for (const pid of Object.keys(store.coins)) coins[pid] = garageCoins(store, pid);
  state.coins = coins;
  const ups = {};
  for (const pid of Object.keys(store.upgrades)) ups[pid] = garageLevels(store, pid);
  for (const pid of Object.keys(coins)) {
    if (!ups[pid]) ups[pid] = { engine: 0, handling: 0, reload: 0 };
  }
  state.garageUpgrades = ups;
  if (!state.garageResults || typeof state.garageResults !== 'object') state.garageResults = {};
}

/* endReason is explicit so an early goal finish never reads as a timer
 * bug: 'goal' (target reached) or 'timeout' (deadline). A goal landing on
 * the exact expiry tick counts as 'goal' — deterministic, scored once. */
function finish(state, ctx, rules, endReason) {
  battle.cancelPayloads(state);
  state.phase = 'done';
  state.endsAt = 0;
  state.endReason = endReason;
  for (const k of state.karts) {
    k.nitroActive = false;
    k.machineHeld = false;
    k.spikesT=0; k.spikesUntil=0;
    k.pendingFire = false;
    k.input = { steer: 0, throttle: 0, boost: false };
  }
  // Freeze the shared sunset at the authoritative finish instant: every
  // later view and late join renders the same fixed sky; the result tick
  // never advances it (onTick returns early once done).
  if (state.skyCycle) state.skyCycle.endedAt = ctx.now();
  // Places pay 300/200/100/0, ties share rank and points, a full draw
  // pays 150 each, and drivers who dropped out rank last with 0.
  const { standings, winners, winner, draw } = rankStandings(state.karts
    .map((k) => ({ pid: k.pid, score: rules.scoreOf(k), out: k.out === true })));
  state.result = { standings, winner, winners, draw, endReason };
  for (const s of standings) {
    state.scores[s.pid] = s.score;
    if (s.points > 0) ctx.award(s.pid, s.points);
  }
  // Garage coins (battle only, exactly once): every driver banks
  // participation, winners bank extra. Runs inside finish, which the tick
  // driver calls at most once (done returns early).
  if (rules && rules.key === 'battle') {
    try {
      const store = garageStore(ctx, state);
      const keep = new Set(state.karts.map((k) => k.pid));
      // Coin bonus keeps its old meaning: a scoreless draw wins no coins.
      const winSet = new Set(standings.some((s) => !s.out && s.score > 0) ? winners : []);
      for (const k of state.karts) {
        awardGarageCoins(store, k.pid, COIN_PARTICIPATION, keep);
        if (winSet.has(k.pid)) awardGarageCoins(store, k.pid, COIN_WIN, keep);
      }
      syncGarageState(state, store);
    } catch { /* economy never breaks the finish */ }
  }
}

/* Config: {
 *   id, name, tagline, howto, art?,
 *   seats?, players?, communication?,
 *   layout?: 'immersive' (default 'standard'; other games unchanged),
 *   modes?: ['starrush','battle'] (offered; default both),
 *   maps?: ['ring','blocks',...] (offered; default ring+blocks),
 *   garage?: true (Pocket Karts only: offers the Garage Battle toggle;
 *     thin variants omit it and never see the setting),
 *   defaults?: { roundSeconds, targetStars, targetHits, palette, mode,
 *     map, winRule, lightCycle, garage } (winRule defaults to
 *     'Score target', lightCycle to 'Fixed light', garage to false, for
 *     games that predate them)
 * } */
function createKartGame(config) {
  const motions = new WeakMap();
  const cfg = config && typeof config === 'object' ? config : {};
  if (!cfg.id || !cfg.name) throw new Error('kart-engine: config needs id + name');
  const modes = Array.isArray(cfg.modes) && cfg.modes.length
    ? cfg.modes.filter((m) => RULES[m]) : ['starrush', 'battle'];
  if (!modes.length) throw new Error('kart-engine: no valid modes');
  const maps = Array.isArray(cfg.maps) && cfg.maps.length ? cfg.maps.slice() : ['ring', 'blocks'];
  const d = cfg.defaults && typeof cfg.defaults === 'object' ? cfg.defaults : {};
  const defMode = RULES[d.mode] ? d.mode : modes[0];
  const defMap = normalizeMapId(d.map, maps);
  const defPalette = PALETTES.includes(d.palette) ? d.palette : 'Daybreak';
  const defRound = Number.isInteger(d.roundSeconds) ? clamp(d.roundSeconds, ROUND_MIN_S, ROUND_MAX_S) : ROUND_DEFAULT_S;
  const defStars = Number.isInteger(d.targetStars) ? clamp(d.targetStars, 8, 30) : 15;
  const defHits = Number.isInteger(d.targetHits) ? clamp(d.targetHits, 1, 20) : 5;
  const defWinRule = WIN_RULES.includes(d.winRule) ? d.winRule : 'Score target';
  const defLight = LIGHT_CYCLES.includes(d.lightCycle) ? d.lightCycle : 'Fixed light';
  const offersGarage = cfg.garage === true && modes.includes('battle');
  const defGarage = d.garage === true;

  const modeOptions = modes.map((m) => RULES[m].label);
  if(offersGarage) modeOptions.splice(modeOptions.indexOf(RULES.battle.label)+1,0,'Garage Battle');
  const mapOptions = maps.map((m) => mapDef(m).label);
  // Immersive is opt-in per game: only an explicit 'immersive' passes, so
  // thin variants generated without a layout keep the standard card.
  const layout = cfg.layout === 'immersive' ? 'immersive' : 'standard';
  const manifest = {
    name: cfg.name,
    tagline: cfg.tagline || 'Tiny karts, big finishes',
    howto: cfg.howto || 'Drive with WASD/arrows or touch controls.',
    cat: '3d',
    renderer: '3d',
    layout,
    realtime: true,
    players: cfg.players || { min: 2, max: 24 },
    seats: cfg.seats || 8,
    settings: [
      { key: 'roundSeconds', label: 'Round length (seconds)', type: 'int', min: ROUND_MIN_S, max: ROUND_MAX_S, def: defRound },
      { key: 'targetStars', label: 'Stars to win (Star Rush)', type: 'int', min: 8, max: 30, def: defStars },
      { key: 'targetHits', label: 'Knockouts to win (Zap Battle)', type: 'int', min: 1, max: 20, def: defHits },
      { key: 'mode', label: 'Mode', type: 'enum', options: modeOptions, def: RULES[defMode].label },
      { key: 'map', label: 'Arena', type: 'enum', options: mapOptions, def: mapDef(defMap).label },
      { key: 'palette', label: 'Arena palette', type: 'enum', options: PALETTES.slice(), def: defPalette },
      { key: 'winRule', label: 'Win rule', type: 'enum', options: WIN_RULES.slice(), def: defWinRule },
      { key: 'lightCycle', label: 'Light cycle', type: 'enum', options: LIGHT_CYCLES.slice(), def: defLight },
    ],
  };
  if (cfg.art) manifest.art = cfg.art;
  if (cfg.communication) manifest.communication = cfg.communication;

  function settingsOf(ctx) {
    const s = (ctx.settings ? ctx.settings() : {}) || {};
    const roundSeconds = Number.isInteger(s.roundSeconds) ? clamp(s.roundSeconds, ROUND_MIN_S, ROUND_MAX_S) : defRound;
    const targetStars = Number.isInteger(s.targetStars) ? clamp(s.targetStars, 8, 30) : defStars;
    const targetHits = Number.isInteger(s.targetHits) ? clamp(s.targetHits, 1, 20) : defHits;
    let mode = defMode;
    for (const m of modes) {
      if (s.mode === RULES[m].label || s.mode === m) { mode = m; break; }
    }
    if (offersGarage && s.mode==='Garage Battle') mode='battle';
    let map = defMap;
    for (const m of maps) {
      if (s.map === mapDef(m).label || s.map === m) { map = m; break; }
    }
    const wantPal = LEGACY_PALETTES[s.palette] || s.palette;
    const palette = PALETTES.includes(wantPal) ? wantPal : defPalette;
    const winRule = WIN_RULES.includes(s.winRule) ? s.winRule : defWinRule;
    const lightCycle = LIGHT_CYCLES.includes(s.lightCycle) ? s.lightCycle : defLight;
    // Garage Battle = battle rules (rulesKey stays 'battle') plus the
    // progression flag. Classic default off; Star Rush never applies it.
    const garage = offersGarage && mode === 'battle' && (s.mode==='Garage Battle'||s.garage === true || (s.garage === undefined && defGarage));
    return { roundSeconds, targetStars, targetHits, mode, map, palette, winRule, lightCycle, garage };
  }

  function create(ctx) {
    const drivers = ctx.allPlayers();
    const { roundSeconds, targetStars, targetHits, mode, map, palette, winRule, lightCycle, garage } = settingsOf(ctx);
    const rules = RULES[mode];
    const mapD = mapDef(map);
    const half = Number(mapD.half) > 0 ? Number(mapD.half) : ARENA_HALF;
    const bound = half - 2;
    const t0 = ctx.now();
    // Garage store first: owned levels attach to every kart for the view
    // (cosmetics), but physics applies them only when garage is on —
    // classic rematches stay bit-identical while the wallet persists.
    const preStore = garageStore(ctx, { _garageLocal: undefined });
    const spawnPool = Array.isArray(mapD.spawns) && mapD.spawns.length ? mapD.spawns : null;
    const karts = drivers.map((p, i) => {
      const pose = spawnPool ? spawnPool[i % spawnPool.length] : startPose(i, drivers.length);
      return {
        pid: p.id, connected:true, controlEpoch:0, x: pose.x, z: pose.z, angle: pose.angle, speed: 0,
        boost: 0, boostCd: 0,
        slip: 0, turbo: 0, padCd: 0, drifting: false, driftCharge: 0, grip: 1,
        nitro: 1, nitroActive: false, nitroLocked: false,
        input: { steer: 0, throttle: 0, boost: false },
        lastInputAt: t0,
        ...rules.blankKart(),
        upgrades: garageLevels(preStore, p.id),
        garage: garage === true && rules.key === 'battle',
      };
    });
    const countdownEnds = t0 + COUNTDOWN_MS;
    const seed = matchSeed(t0, drivers);
    const state = {
      phase: 'countdown',
      mode,
      map,
      rulesKey: rules.key,
      garage: garage === true && rules.key === 'battle',
      roundMs: roundSeconds * 1000,
      targetStars,
      targetHits,
      palette,
      winRule,
      lightCycle,
      // Shared sunset window: starts at the countdown deadline, spans the
      // round, identical for every client (late joiners derive the same
      // phase from the server clock). Null under Fixed light.
      skyCycle: lightCycle === 'Live sunset'
        ? { startedAt: countdownEnds, durationMs: roundSeconds * 1000 }
        : null,
      endsAt: countdownEnds,
      lastTick: t0,
      karts,
      blocks: mapD.blocks,
      pads: mapD.pads || [],
      surfaces: mapD.surfaces || [],
      spots: mapD.spots,
      spawns: spawnPool ? spawnPool.map((s) => ({ x: s.x, z: s.z, angle: s.angle })) : [],
      half,
      bound,
      // Per-match authoritative RNG state (crate layout, item rolls).
      // Internal only: views never see the seed or its state.
      seed,
      rngState: seed,
      result: null,
      scores: {},
      coins: {},
      garageUpgrades: {},
      garageResults: {},
    };
    // Re-resolve against the real state so the fixture fallback (no
    // ctx.session) lands on THIS state object, then project for views.
    try {
      const store = garageStore(ctx, state);
      for (const k of state.karts) k.upgrades = garageLevels(store, k.pid);
      syncGarageState(state, store);
    } catch { /* economy never breaks create */ }
    rules.createExtra(state, mapD.spots);
    if (cfg.createMotion) { state.physicalEvents=[];state.physicalEventSeq=0;motions.set(state,cfg.createMotion(state)); }
    return state;
  }

  /* Garage purchase (results-only). Validates mode, stage, seat, id,
   * balance, cap, and nonce; deducts and levels up exactly once. Returns
   * undefined so the room broadcasts the updated wallet/result. Errors
   * are recorded privately per seat (view.garageResult) with clear text —
   * never silent, never a throw, never a cross-seat spend. */
  function garagePurchase(state, ctx, pid, req) {
    const fail = (error) => {
      if (!state.garageResults || typeof state.garageResults !== 'object') state.garageResults = {};
      state.garageResults[pid] = {
        ok: false, error,
        nonce: req && typeof req.nonce === 'string' ? req.nonce.slice(0, 64) : null,
        category: req && typeof req.category === 'string' ? req.category.slice(0, 16) : null,
      };
      return undefined; // broadcast the error to the buyer
    };
    if (state.rulesKey !== 'battle') return fail('Garage is available in Zap Battle results only.');
    if (state.phase !== 'done') return fail('Garage opens on the results screen.');
    let roster = [];
    let online = [];
    try {
      roster = ctx.allPlayers().map((p) => p.id);
      online = ctx.players().map((p) => p.id);
    } catch { roster = state.karts.map((k) => k.pid); online = roster.slice(); }
    if (!roster.includes(pid) || !state.karts.some(k=>k.pid===pid)) return fail('Only drivers in this match can use the garage.');
    if (!online.includes(pid)) return fail('Reconnect to use the garage.');
    const r = req && typeof req === 'object' ? req : {};
    if (r.pid !== undefined && r.pid !== pid) return fail('You can only upgrade your own kart.');
    if (r.target !== undefined && r.target !== pid) return fail('You can only upgrade your own kart.');
    if (r.seat !== undefined && r.seat !== pid) return fail('You can only upgrade your own kart.');
    const cat = r.category;
    if (typeof cat !== 'string' || !GARAGE_CATS.includes(cat)) {
      return fail(`Unknown upgrade "${String(cat).slice(0, 16)}" (want engine, handling, or reload).`);
    }
    if (typeof r.nonce !== 'string' || r.nonce.length < 1 || r.nonce.length > 64) {
      return fail('Purchase needs a nonce (1..64 chars).');
    }
    let store;
    try { store = garageStore(ctx, state); } catch { return fail('Garage unavailable. Try again.'); }
    if (hasGarageNonce(store, r.nonce)) return fail('Duplicate purchase (already applied).');
    const levels = garageLevels(store, pid);
    if (levels[cat] >= GARAGE_MAX) return fail(`${cat} is already at max level ${GARAGE_MAX}.`);
    const cost = GARAGE_PRICES[levels[cat]];
    const have = garageCoins(store, pid);
    if (have < cost) return fail(`Need ${cost} coins for ${cat} ${levels[cat] + 1} (have ${have}).`);
    if (!claimGarageNonce(store, r.nonce)) return fail('Duplicate purchase (already applied).');
    store.coins[pid] = have - cost;
    if (!store.upgrades[pid] || typeof store.upgrades[pid] !== 'object') {
      store.upgrades[pid] = { engine: 0, handling: 0, reload: 0 };
    }
    store.upgrades[pid][cat] = levels[cat] + 1;
    syncGarageState(state, store);
    const kart = state.karts.find((k) => k.pid === pid);
    if (kart) kart.upgrades = garageLevels(store, pid);
    state.garageResults[pid] = {
      ok: true, category: cat, level: levels[cat] + 1,
      coins: store.coins[pid], nonce: r.nonce,
    };
    return undefined; // broadcast the new wallet/levels
  }

  function onAction(state, ctx, pid, a) {
    // Garage purchases ride a dedicated non-input action and are handled
    // before intents (results-only; done phase broadcasts them at once).
    if (a && typeof a === 'object' && a.garage !== undefined) {
      return garagePurchase(state, ctx, pid, a.garage);
    }
    const intent = cleanInput(a);
    if (!intent) return;
    const kart = state.karts.find((k) => k.pid === pid);
    if (!kart || state.phase === 'done') return false;
    if (state.phase === 'drive' && ctx.now() >= state.endsAt) return false;
    const battleKart = state.rulesKey === 'battle';
    if (battleKart && ((Number(kart.respawn) || 0) > 0 || !ctx.players().some((p) => p.id === pid))) {
      battle.cancelPayload(kart);
      // KO'd or disconnected: the intent is rejected — neutral motion, no latched edge.
      // The fresh life starts neutral and needs a new live intent.
      kart.input = { steer: 0, throttle: 0, boost: false };
      kart.pendingFire = false;
      kart.machineHeld = false;
      kart.nitroActive = false;
      return false; // input-only: the 20 Hz Pocket tick broadcast carries it
    }
    if(motions.has(state)){
      const keys=new Set(['steer','throttle','boost','drift','nitro']);
      if(!a.input||Object.keys(a.input).some(key=>!keys.has(key))||
        !Number.isFinite(a.input.steer)||!Number.isFinite(a.input.throttle)||
        Math.abs(a.input.steer)>1||Math.abs(a.input.throttle)>1||
        ['boost','drift','nitro'].some(key=>a.input[key]!==undefined&&typeof a.input[key]!=='boolean')||
        a.life!==(kart.spawnSeq||0)||a.controlEpoch!==(kart.controlEpoch||0)||
        !kart.connected||!Number.isSafeInteger(a.seq)||a.seq<1||a.seq>1000000000||a.seq<=(kart._receivedSeq||0))return false;
      kart._receivedSeq=a.seq;
    }
    const fireEdge = battleKart && state.phase === 'drive' && (motions.has(state)
      ? battle.fireInputEdge(kart,intent.boost) : intent.boost === true && kart.input.boost !== true);
    if (fireEdge) {
      // Validated rising edge at receipt: a single bounded boolean latch,
      // surviving newer neutral/steering intents until the next tick
      // consumes it exactly once. Physical button receipts survive movement
      // TTL, so a resumed held keepalive never re-latches. Malformed input
      // returned above, and no
      // edge queues during countdown or while disconnected.
      kart.pendingFire = true;
    }
    kart.input = intent;
    if(battleKart && !intent.boost)kart.machineHeld=false;
    kart.lastInputAt = ctx.now();
    return false; // input-only: the 20 Hz Pocket tick broadcast carries it
  }

  function onConnection(state, ctx, pid, connected) {
    const kart = state.karts.find((k) => k.pid === pid);
    if (!kart) return;
    if (kart.out && connected) return; // dropped drivers never rejoin this match
    if(motions.has(state)&&!connected&&kart.connected!==false){kart.controlEpoch=(kart.controlEpoch||0)+1;kart._receivedSeq=0;kart._appliedSeq=0;}
    kart.connected=connected;
    if(connected)return;
    battle.cancelPayload(kart);
    battle.resetFireInput(kart);
    kart.input = { steer: 0, throttle: 0, boost: false };
    kart.speed = 0;
    kart.slip = 0;
    kart.drifting = false;
    kart.driftCharge = 0;
    kart.nitroActive = false;
    kart.pendingFire = false;
    kart.machineHeld = false;
    kart.spikesT=0; kart.spikesUntil=0;
    motions.get(state)?.disconnect(pid);
  }

  /* A driver who leaves, or stays disconnected for GONE_AFTER_MS, drops
   * out: the kart leaves the arena (no collisions, hits or pickups), its
   * score stays on the board, and it ranks after every driver still in
   * the match. The others play on; a lone driver left wins at once. The
   * room calls this hook; onTick applies the same 60 s rule itself. */
  function dropOut(state, ctx, pid) {
    const kart = state.karts.find((k) => k.pid === pid);
    if (!kart || kart.out || state.phase === 'done') return false;
    onConnection(state, ctx, pid, false);
    kart.out = true;
    kart.connected = false;
    delete kart.goneSince;
    if (state.karts.filter((k) => !k.out).length < 2) {
      finish(state, ctx, RULES[state.rulesKey] || RULES[modes[0]], 'players-left');
    }
    return true;
  }

  function onPlayerGone(state, ctx, pid) {
    const dropped = dropOut(state, ctx, pid);
    if (dropped) ctx.broadcast?.();
    return dropped;
  }

  function onTick(state, ctx) {
    if (state.phase === 'done') return;
    const rules = RULES[state.rulesKey] || RULES[modes[0]];
    const now = ctx.now();
    // A delayed final pump still simulates the last playable slice, but
    // cannot advance fuses, movement or scoring beyond the match deadline.
    const simNow = state.phase === 'drive' ? Math.min(now, state.endsAt) : now;
    const dt = clamp((simNow - state.lastTick) / 1000, 0, MAX_DT);
    state.lastTick = simNow;
    if (state.phase === 'countdown') {
      if (now >= state.endsAt) {
        state.phase = 'drive';
        state.endsAt = now + state.roundMs;
        // No edge queued during countdown may fire the opening: battle
        // karts re-arm, so only a new live press launches. Nitro holds
        // during countdown never drain (karts never step there).
        for (const kart of state.karts) kart.nitroActive = false;
        if (rules.key === 'battle') {
          for (const kart of state.karts) {
            kart.pendingFire = false;
            kart.machineHeld = false;
            kart.prevAction = kart.input.boost === true;
          }
        }
      }
      ctx.broadcast({ discardable: true });
      return;
    }
    const out = new Set(state.karts.filter((k) => k.out).map((k) => k.pid));
    const connected = new Set(ctx.players().map((p) => p.id).filter((id) => !out.has(id)));
    // Gone for a minute: drop out (the room hook does the same; idempotent).
    for (const kart of state.karts) {
      if (kart.out) continue;
      if (connected.has(kart.pid)) { delete kart.goneSince; continue; }
      if (kart.goneSince === undefined) kart.goneSince = now;
      else if (now - kart.goneSince >= GONE_AFTER_MS) dropOut(state, ctx, kart.pid);
    }
    if (state.phase === 'done') { ctx.broadcast(); return; }
    const battleMode = rules.key === 'battle';
    const bound = Number(state.bound) > 0 ? Number(state.bound) : BOUND;
    const previousKarts = battleMode
      ? new Map(state.karts.map((kart) => [kart.pid, { x: kart.x, z: kart.z,...(kart.physicalPose?{physicalPose:structuredClone(kart.physicalPose),angle:kart.angle,spawnSeq:kart.spawnSeq||0}: {}) }])) : null;
    // Freeze pass (once per tick, before any motion): disconnected karts
    // stop dead and TTL-expired intents wipe to neutral. TTL also clears
    // drift state HERE so the wipe cannot mint a release turbo below.
    // Nitro holds freeze too: intent wipes, active clears, but the tank
    // charge holds (no drain, no recharge) until a live intent returns.
    for (const kart of state.karts) {
      if (!connected.has(kart.pid)) {
        onConnection(state, ctx, kart.pid, false);
        continue;
      }
      if (now - (kart.lastInputAt === undefined ? now : kart.lastInputAt) > INPUT_TTL_MS) {
        kart.input = { steer: 0, throttle: 0, boost: false };
        kart.drifting = false;
        kart.driftCharge = 0;
        kart.nitroActive = false;
        if (battleMode) {kart.pendingFire = false;kart.machineHeld=false;} // TTL clears only an unaccepted edge; committed payloads continue.
      }
    }
    // Lockstep motion: every live kart advances the SAME substep, then
    // contacts resolve before the next substep — head-on pairs meet
    // mid-tick instead of crossing. Projectiles still sweep the WHOLE tick
    // (previousKarts -> final) in rules.tick, so cover/hull ordering is
    // unchanged and awards still apply once.
    const stepOpts = {
      blocks: state.blocks,
      pads: state.pads,
      surfaces: state.surfaces,
      bound,
      allowBoost: !battleMode,
    };
    const n = dt <= 0 ? 1 : Math.ceil(dt / STEP_MAX);
    const h = dt / n;
    const motion=motions.get(state);
    const contacts=motion ? motion.advance(dt,connected) : new Map();
    if (motion) {
      // Publish the intent used by this pose, not a newer received command.
      for (const kart of state.karts) if((kart._receivedSeq||0)===(kart._appliedSeq||0)) kart._motionIntent={steer:kart.input.steer,throttle:kart.input.throttle,drift:kart.input.drift,nitro:kart.input.nitro,life:kart.spawnSeq||0,epoch:kart.controlEpoch||0};
      // Recover a chassis that has cleared the outer face of the real fence
      // or fallen below the floor. High jumps over playable terrain remain
      // physical; recovery is a new life, never a KO or a position clamp.
      const recovered = new Set();
      for (const kart of state.karts) {
        if (!connected.has(kart.pid) || kart.respawn > 0 || !kart.physicalPose) continue;
        if (!motion.isOutOfBounds?.(kart.physicalPose)) continue;
        if (battleMode) battle.respawnKart(state,kart);
        else {
          Object.assign(kart,battle.respawnPose(state,kart));
          kart.spawnSeq=(kart.spawnSeq||0)+1;
        }
        Object.assign(kart,{speed:0,slip:0,boost:0,boostCd:0,turbo:0,padCd:0,drifting:false,driftCharge:0,
          nitro:1,nitroActive:false,nitroLocked:false,_driftHeld:false,input:{steer:0,throttle:0,boost:false},prevAction:false,pendingFire:false,machineHeld:false,
          controlEpoch:(kart.controlEpoch||0)+1,_receivedSeq:0,_appliedSeq:0});
        recovered.add(kart.pid);
      }
      if (recovered.size) {
        motion.sync(connected);
        // Replace the swept prior pose with the new life before projectile,
        // mine and contact rules observe this tick's teleport.
        for (const kart of state.karts) if (recovered.has(kart.pid)) previousKarts?.set(kart.pid,
          {x:kart.x,z:kart.z,angle:kart.angle,spawnSeq:kart.spawnSeq||0,physicalPose:structuredClone(kart.physicalPose)});
        for (const [key,pair] of contacts) if (pair.some(k=>recovered.has(k.pid))) contacts.delete(key);
      }
    }
    if (!motion) {
    for (let s = 0; s < n; s++) {
      for (const kart of state.karts) {
        if (!connected.has(kart.pid)) continue; // frozen: never steps
        if (battleMode && (Number(kart.respawn) || 0) > 0) continue; // KO'd: frozen until respawn
        stepKartOnce(kart, h, stepOpts);
      }
      for (let it = 0; it < CONTACT_ITERS; it++) {
        if (!resolveContacts(state.karts, connected, bound, contacts)) break;
        for (const kart of state.karts) {
          if (!connected.has(kart.pid)) continue;
          if (battleMode && (Number(kart.respawn) || 0) > 0) continue;
          reprojectLive(kart, state.blocks, bound);
        }
      }
    }
    }
    // Battle economy: KO (+10) and crate-pickup (+1) coins flow through
    // this tick-scoped econ into the room store (or the fixture fallback),
    // then project into state.coins for views. Star Rush passes null.
    let econ = null;
    let econStore = null;
    if (battleMode) {
      try {
        econStore = garageStore(ctx, state);
        const keep = new Set(state.karts.map((k) => k.pid));
        econ = { award: (ap, amt) => awardGarageCoins(econStore, ap, amt, keep) };
      } catch { econ = null; econStore = null; }
    }
    // Ground pickups cannot be claimed by a kart flying over them. Battle
    // performs its own per-item check; Star Rush only needs the live roster.
    const pickupDrivers = rules.key === 'starrush' && motion?.groundAt
      ? new Set(state.karts.filter(k => connected.has(k.pid) &&
        Math.abs(k.physicalPose.position.y - motion.groundAt(k.x,k.z)) < 2.4).map(k => k.pid))
      : connected;
    const goalMet = rules.tick(state, pickupDrivers, dt, previousKarts, econ, contacts,motion?{sweepStatic:motion.sweepStatic,supportAt:motion.supportAt,groundAt:motion.groundAt,syncRespawn:()=>motion.sync(connected)}:undefined);
    motion?.sync(connected);
    if (battleMode && econStore) {
      try { syncGarageState(state, econStore); } catch { /* views keep last projection */ }
    }
    // A goal only ends the round under the 'Score target' win rule; under
    // 'Time limit' every round plays to the deadline (scores still count).
    const goalCounts = state.winRule !== 'Time limit' && goalMet;
    if (goalCounts || now >= state.endsAt) {
      finish(state, ctx, rules, goalCounts ? 'goal' : 'timeout');
    }
    ctx.broadcast(state.phase === 'done' ? undefined : { discardable: true });
  }

  function view(state, pid) {
    const rules = RULES[state.rulesKey] || RULES[modes[0]];
    const mapD = mapDef(state.map);
    const half = Number(state.half) > 0 ? Number(state.half) : (Number(mapD.half) > 0 ? Number(mapD.half) : ARENA_HALF);
    const bound = Number(state.bound) > 0 ? Number(state.bound) : half - 2;
    const isGarage = state.garage === true;
    const coinsMap = state.coins && typeof state.coins === 'object' ? state.coins : {};
    const upsMap = state.garageUpgrades && typeof state.garageUpgrades === 'object' ? state.garageUpgrades : {};
    const resMap = state.garageResults && typeof state.garageResults === 'object' ? state.garageResults : {};
    const extras = rules.viewExtra(state), motion = motions.get(state);
    if (motion?.groundAt) {
      for (const key of ['stars','crates']) if (extras[key]) {
        extras[key] = extras[key].map(item => ({...item,groundY:motion.groundAt(item.x,item.z)}));
      }
    }
    const pubUps = {};
    for (const k of Object.keys(upsMap)) {
      const u = upsMap[k];
      pubUps[k] = {
        engine: clamp(Math.floor(Number(u && u.engine) || 0), 0, GARAGE_MAX),
        handling: clamp(Math.floor(Number(u && u.handling) || 0), 0, GARAGE_MAX),
        reload: clamp(Math.floor(Number(u && u.reload) || 0), 0, GARAGE_MAX),
      };
    }
    return {
      phase: state.phase,
      ...(motions.has(state)?{motionProfile:'rapier-classic-v1',physicalEvents:state.physicalEvents,inputAck:state.karts.some(k=>k.pid===pid)?{receivedSeq:state.karts.find(k=>k.pid===pid)._receivedSeq||0,appliedInputSeq:state.karts.find(k=>k.pid===pid)._appliedSeq||0,life:state.karts.find(k=>k.pid===pid).spawnSeq||0,controlEpoch:state.karts.find(k=>k.pid===pid).controlEpoch||0}:null}:{}),
      mode: rules.key,
      modeLabel: isGarage ? 'Garage Battle' : rules.label,
      garage: isGarage,
      simAt: state.lastTick,
      map: {
        id: state.map,
        label: mapD.label,
        theme: mapD.theme,
        half,
        bound,
        blocks: state.blocks,
        pads: state.pads,
        surfaces: state.surfaces,
      },
      roundMs: state.roundMs,
      targetStars: state.targetStars,
      targetHits: state.targetHits,
      palette: state.palette,
      winRule: state.winRule || 'Score target',
      lightCycle: state.lightCycle || 'Fixed light',
      skyCycle: state.skyCycle
        ? {
          startedAt: state.skyCycle.startedAt,
          durationMs: state.skyCycle.durationMs,
          ...(state.skyCycle.endedAt !== undefined ? { endedAt: state.skyCycle.endedAt } : {}),
        }
        : null,
      endsAt: state.endsAt,
      youDrive: state.karts.some((k) => k.pid === pid),
      karts: state.karts.map((k) => {
        const v = kartVelocity(k);
        const applied=k._motionIntent,live=motion&&state.phase==='drive'&&k.connected!==false&&!(k.respawn>0)&&applied?.life===(k.spawnSeq||0)&&applied?.epoch===(k.controlEpoch||0);
        const bounded=n=>Number.isFinite(n)?clamp(n,-1,1):0;
        return {
          ...(motion?{motionIntent:{steer:live?bounded(applied.steer):0,throttle:live?bounded(applied.throttle):0,drift:live&&applied.drift===true,nitro:live&&applied.nitro===true}}:{}),
          pid: k.pid, connected:k.connected!==false, ...(k.out ? { out: true } : {}), spawnSeq:Number(k.spawnSeq)||0, ...(k.physicalPose ? {physicalPose:{position:{...k.physicalPose.position},rotation:{...k.physicalPose.rotation},linearVelocity:{...k.physicalPose.linearVelocity},angularVelocity:{...k.physicalPose.angularVelocity},epoch:k.physicalPose.epoch,speed:k.physicalPose.speed,grounded:k.physicalPose.grounded,wheels:k.physicalPose.wheels.map(w=>({length:w.length,rotation:w.rotation,steering:w.steering}))}} : {}), x: +k.x.toFixed(3), z: +k.z.toFixed(3),
          angle: +k.angle.toFixed(4), speed: +k.speed.toFixed(3),
          boost: +(Math.max(0, k.boost)).toFixed(2),
          boostCd: +(Math.max(0, k.boostCd)).toFixed(2),
          vx: +v.vx.toFixed(3),
          vz: +v.vz.toFixed(3),
          slip: +(Number(k.slip) || 0).toFixed(3),
          drifting: k.drifting === true,
          driftCharge: +clamp(Number(k.driftCharge) || 0, 0, 1).toFixed(2),
          turbo: +(Math.max(0, Number(k.turbo) || 0)).toFixed(2),
          padCd: +(Math.max(0, Number(k.padCd) || 0)).toFixed(2),
          grip: +(Number.isFinite(Number(k.grip)) ? Number(k.grip) : 1).toFixed(2),
          nitro: +clamp(Number(k.nitro) === undefined ? 1 : Number(k.nitro) || 0, 0, 1).toFixed(2),
          nitroActive: k.nitroActive === true,
          nitroLocked: k.nitroLocked === true,
          ...rules.kartViewExtra(k),
        };
      }),
      ...extras,
      scores: { ...state.scores },
      result: state.result,
      // Garage: private wallet (owner only) + private last purchase result,
      // public owned levels (kart cosmetics), static price table. simAt is
      // the authoritative lastTick for freshness/jitter handling.
      coins: Math.max(0, Math.floor(Number(coinsMap[pid]) || 0)),
      upgrades: pubUps,
      garagePrices: { cats: GARAGE_CATS.slice(), prices: GARAGE_PRICES.slice(), max: GARAGE_MAX },
      garageResult: resMap[pid] ? { ...resMap[pid] } : null,
    };
  }

  return {
    id: cfg.id,
    minPlayers: (cfg.players && cfg.players.min) || 2,
    maxPlayers: (cfg.players && cfg.players.max) || 24,
    manifest,
    create, onAction, onTick, onConnection, onPlayerGone, view,
    dispose(state){battle.cancelPayloads(state);motions.get(state)?.dispose();motions.delete(state);},
  };
}

module.exports = {
  createKartGame,
  RULES,
  constants: {
    ARENA_HALF, BOUND, KART_R, COUNTDOWN_MS, ROUND_MIN_S, ROUND_MAX_S, ROUND_DEFAULT_S, GONE_AFTER_MS, MAX_SPEED, MAX_REVERSE,
    ACCEL, BRAKE, DRAG, TURN_RATE, BOOST_SPEED, BOOST_TIME,
    BOOST_COOLDOWN, MAX_DT, INPUT_TTL_MS, START_R,
    WIN_RULES, LIGHT_CYCLES,
    DRIFT_MIN_SPEED, DRIFT_STEER_MIN, DRIFT_TURN, DRIFT_SLIP, DRIFT_BLEND,
    SLIP_RECOVER, SLIP_MAX, DRIFT_CHARGE_NEED, MINI_TURBO_TIME,
    TURBO_TIME, TURBO_SPEED, PAD_COOLDOWN, PAD_MIN_SPEED,
    NITRO_DRAIN, NITRO_RECHARGE, NITRO_REARM, NITRO_SPEED, NITRO_PUNCH,
    EMP_TOP_SCALE, EMP_ACCEL_SCALE, EMP_TURN_SCALE,
    SLIDE_KEEP, CONTACT_KEEP,
    GARAGE_CATS, GARAGE_MAX, GARAGE_PRICES, GARAGE_NONCE_CAP,
    GARAGE_WALLET_CAP, COIN_PARTICIPATION, COIN_WIN,
  },
  helpers: { clamp, wrapAngle, forwardOf, screenRightOf, stepKart, cleanInput, kartVelocity, gripAt, tuningFor },
};
