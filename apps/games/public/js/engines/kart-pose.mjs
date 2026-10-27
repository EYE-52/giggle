/* Shared kart visual-pose helper (pure, no DOM). Used by EVERY kart-arena
 * view (WebGL + 2D fallback) so self-prediction and remote smoothing
 * behave identically everywhere.
 *
 * Server stays authoritative: scores, pickups, hits, results, and true
 * poses all come from snapshots. This module only decides what to DRAW:
 * - SELF (while driving): integrate the local intent every frame (instant
 *   visual response), then reconcile toward each 10 Hz authoritative
 *   snapshot (soft blend; hard snap only on big errors/teleports). Visual
 *   stepping freezes once the last snapshot is older than EXTRAPOLATE_MS.
 *   Views pass the snapshot's map geometry via opts.blocks / opts.pads /
 *   opts.surfaces (or opts.map carrying all three) so prediction drifts,
 *   slides, boosts, and collides exactly like the server instead of
 *   tunneling through walls.
 * - REMOTES: ease toward the latest snapshot plus a BOUNDED lead along the
 *   last known heading/speed, clamped to the arena, frozen after
 *   EXTRAPOLATE_MS. Reduced motion snaps remotes/cosmetics but NEVER
 *   disables self prediction (responsiveness is gameplay, not decoration).
 * - Countdown/done/spectate: draw the snapshot (no prediction).
 *
 * Steering convention (camera-anchored, mirrors the server engine):
 * steer +1 = SCREEN RIGHT under the chase camera. Forward is (sin a,
 * cos a); at angle 0 the kart faces +z with the camera behind at -z, so
 * screen right is -x and a right turn DECREASES the angle. forwardOf(),
 * screenRightOf(), and canvasNoseRotation() are the single source the
 * server, the mesh yaw, the chase camera, and the 2D fallback all share.
 *
 * Physics constants mirror games/engines/kart-engine.js stepKart for
 * visual prediction only; test/kart-framework.js asserts both agree.
 * Kart-to-kart contact is deliberately NOT mirrored: it needs every
 * rival's true pose, so it stays authority-only on the server.
 */

export const MAX_SPEED = 20;
export const MAX_REVERSE = 5;
export const ACCEL = 28;
export const BRAKE = 26;
export const DRAG = 1.4;
export const TURN_RATE = 2.3;
export const BOOST_SPEED = 1.6;
export const BOOST_TIME = 1.2;
export const BOOST_CD = 6;
export const BOUND = 28;
export const KART_R = 2.05; // must equal engine KART_R (block collision radius)
export const DRIFT_MIN_SPEED = 6;
export const DRIFT_STEER_MIN = 0.15;
export const DRIFT_TURN = 1.45;
export const DRIFT_SLIP = 0.38;
export const DRIFT_BLEND = 8;
export const SLIP_RECOVER = 6;
export const SLIP_MAX = 8;
export const DRIFT_CHARGE_NEED = 0.9;
export const MINI_TURBO_TIME = 0.9;
export const TURBO_TIME = 1.0;
export const TURBO_SPEED = 1.35;
export const PAD_COOLDOWN = 3;
export const PAD_MIN_SPEED = 3;
export const NITRO_DRAIN = 0.4;
export const NITRO_RECHARGE = 0.15;
export const NITRO_REARM = 0.3;
export const NITRO_SPEED = 1.5;
export const NITRO_PUNCH = 1.75;
// EMP slow factors: must equal the kart-engine.js values bit-for-bit
// (parity-tested). stepSelf reads the snapshot-adopted p.empT and never
// ticks it — the server owns the countdown after motion, exactly like
// shield — so holding it constant across a rollout matches the server.
export const EMP_TOP_SCALE = 0.62;
export const EMP_ACCEL_SCALE = 0.6;
export const EMP_TURN_SCALE = 0.75;
export const SLIDE_KEEP = 0.9;

export const SELF_BLEND = 0.35; // per-snapshot pull of predicted self -> server
export const SELF_ANGLE_BLEND = 0.4;
export const SELF_SPEED_BLEND = 0.5;
export const SELF_SNAP_DIST = 6; // beyond this, snap (teleport/respawn/desync)
export const SELF_SNAP_ANGLE = 1.2; // radians
export const REMOTE_SNAP_DIST = 8;
export const REMOTE_EASE = 9; // per-second ease rate (matches old dt*9 feel)
export const EXTRAPOLATE_MS = 500; // max lead after the last snapshot
export const MAX_FRAME_DT = 0.1; // clamp per-frame dt (tab-away safe)
export const REMOTE_BUFFER_MS = 150;
const CORRECTION_DECAY = 12;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/* Playable bound for prediction: the snapshot's own map bound (large
 * arenas run at 58), an explicit opts.bound override, else the legacy
 * 28. Never silently clamp a big map to the small walls. */
function resolveBound(explicit, map) {
  const v = Number(explicit);
  if (v > 0) return v;
  const m = Number(map && map.bound);
  return m > 0 ? m : BOUND;
}

/* World-space forward for a kart angle. Equals the mesh forward (Three.js
 * yaw rotation of the +z nose) and the 2D nose direction. */
export function forwardOf(angle) {
  return { x: Math.sin(angle), z: Math.cos(angle) };
}

/* Screen-right world direction under the chase camera (camera behind at
 * pose - forward*back, looking ahead). At angle 0 this is (-1, 0). Also
 * the lateral (slip) axis of every kart. */
export function screenRightOf(angle) {
  const f = forwardOf(angle);
  return { x: -f.z, z: f.x };
}

/* True ground-plane velocity from a (speed, slip) pair. Mirrors the
 * engine's kartVelocity exactly; views use it for motion feedback. Slip
 * rides the screen-right axis with an OUTWARD drift target: a right drift
 * (steer +1) slides toward screen LEFT (negative slip) so the velocity
 * heading LAGS the nose. */
export function kartVelocity(kart) {
  const f = forwardOf(kart.angle);
  const r = screenRightOf(kart.angle);
  const speed = Number(kart.speed) || 0;
  const slip = Number(kart.slip) || 0;
  return { vx: f.x * speed + r.x * slip, vz: f.z * speed + r.z * slip };
}

/* Surface grip under a point. Mirrors the engine's gripAt exactly. */
export function gripAt(x, z, surfaces) {
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

function setVelocity(p, vx, vz) {
  const f = forwardOf(p.angle);
  const r = screenRightOf(p.angle);
  p.speed = clamp(vx * f.x + vz * f.z, -MAX_REVERSE, MAX_SPEED * BOOST_SPEED * clamp(Number(p.tuning?.top) || 1, 1, 1.15));
  p.slip = clamp(vx * r.x + vz * r.z, -SLIP_MAX, SLIP_MAX);
}

/* Glancing response along a face with outward normal (nx, nz). Mirrors
 * the engine's slideAlong exactly. */
function slideAlong(p, nx, nz) {
  const v = kartVelocity(p);
  const vn = v.vx * nx + v.vz * nz;
  if (vn >= 0) return;
  const tx = (v.vx - vn * nx) * SLIDE_KEEP;
  const tz = (v.vz - vn * nz) * SLIDE_KEEP;
  setVelocity(p, tx, tz);
}

/* 2D fallback canvas rotation for a kart nose drawn pointing up (-y) with
 * +x right and +z DOWN: rotate(PI - a) points the nose along (sin a,
 * cos a). Pure so tests can anchor the mapping. */
export function canvasNoseRotation(angle) {
  return Math.PI - angle;
}

/* Shortest signed arc from a to b (result in [-PI, PI]). */
export function angDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/* Pure keyboard+touch -> steer/throttle mapping (the action/boost edge is
 * view state, not computed here). keys has 'left'/'right'/'up'/'down';
 * touch has { left, right, gas, brake }. Left = -1, right = +1: +steer
 * means screen right (see the header convention). Drift rides alongside
 * as intent.drift (Shift / DRIFT button), attached by the view. */
export function intentFromKeys(keys, touch) {
  const has = (k) => !!(keys && typeof keys.has === 'function' && keys.has(k));
  const t = touch || {};
  let steer = 0;
  let throttle = 0;
  if (has('left') || t.left) steer -= 1;
  if (has('right') || t.right) steer += 1;
  if (has('up') || t.gas) throttle += 1;
  if (has('down') || t.brake) throttle -= 1;
  return { steer, throttle };
}

/* Block collision mirror of the server's collideBlocks (same radius,
 * same push-out, same face-slide, same position in the step: after the
 * move, before the walls). Without it self-prediction drives THROUGH
 * bumper blocks and rubber-bands on every reconcile; with opts.blocks
 * (the snapshot's map blocks, same shape the server uses) the rollout
 * is bit-identical to the server. Pure: mutates and returns the pose. */
function collideBlocks(p, blocks) {
  for (const b of blocks) {
    const cx = clamp(p.x, b.x - b.hw, b.x + b.hw);
    const cz = clamp(p.z, b.z - b.hd, b.z + b.hd);
    const dx = p.x - cx;
    const dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= KART_R * KART_R) continue;
    if (d2 < 1e-9) {
      const px = b.hw + KART_R - Math.abs(p.x - b.x);
      const pz = b.hd + KART_R - Math.abs(p.z - b.z);
      if (px < pz) {
        const s = p.x >= b.x ? 1 : -1;
        p.x = b.x + s * (b.hw + KART_R);
        slideAlong(p, s, 0);
      } else {
        const s = p.z >= b.z ? 1 : -1;
        p.z = b.z + s * (b.hd + KART_R);
        slideAlong(p, 0, s);
      }
    } else {
      const d = Math.sqrt(d2);
      const push = (KART_R - d) / d;
      slideAlong(p, dx / d, dz / d);
      p.x += dx * push;
      p.z += dz * push;
    }
  }
  return p;
}

/* Tick split, mirroring the server's lockstep exactly (same threshold,
 * same count, same substep): every tick integrates in <=0.04 s pieces so
 * prediction collides with bumper blocks identically instead of tunneling,
 * and single-kart rollouts stay bit-identical with the server (which also
 * resolves kart contact after each shared substep — authority-only, never
 * predicted here). Ordinary 10 Hz ticks take 3 substeps on both sides. */
const STEP_MAX = 0.04;

export function stepSelf(p, intent, dt, opts) {
  const n = dt > STEP_MAX ? Math.ceil(dt / STEP_MAX) : 1;
  if (n > 1) {
    const h = dt / n;
    for (let i = 0; i < n; i++) stepSelfOnce(p, intent, h, opts);
    return p;
  }
  return stepSelfOnce(p, intent, dt, opts);
}

/* One visual-prediction step for SELF. Mirrors server stepKartOnce (same
 * constants, same order, same CORRECTED steer sign, same drift / turbo /
 * pad / surface / slide math). opts.allowBoost false in battle mode (the
 * button fires; prediction must not pop). opts.blocks / opts.pads /
 * opts.surfaces (or opts.map carrying all three) enable the geometry
 * mirror; omit them and prediction ignores obstacles (legacy behavior,
 * still the default). opts.bound (or opts.map.bound) sets the walls;
 * without it the legacy +/-28 applies. intent.drift is an optional
 * boolean (missing means off, exactly like the server). Kart contact is
 * authority-only and never predicted. Pure: mutates the passed pose. */
function stepSelfOnce(p, intent, dt, opts) {
  const steer = clamp(Number(intent && intent.steer) || 0, -1, 1);
  const throttle = clamp(Number(intent && intent.throttle) || 0, -1, 1);
  const allowBoost = !opts || opts.allowBoost !== false;
  if (p.boost === undefined) p.boost = 0;
  if (p.boostCd === undefined) p.boostCd = 0;
  if (p.turbo === undefined) p.turbo = 0;
  if (p.padCd === undefined) p.padCd = 0;
  if (allowBoost && intent && intent.boost === true && p.boostCd <= 0 && p.boost <= 0) {
    p.boost = BOOST_TIME;
    p.boostCd = BOOST_CD;
  }
  p.boost = Math.max(0, p.boost - dt);
  p.boostCd = Math.max(0, p.boostCd - dt);
  p.turbo = Math.max(0, p.turbo - dt);
  p.padCd = Math.max(0, p.padCd - dt);
  if (p.nitro === undefined) p.nitro = 1;
  if (p.nitroActive === undefined) p.nitroActive = false;
  if (p.nitroLocked === undefined) p.nitroLocked = false;
  p.nitro = clamp(Number(p.nitro), 0, 1);
  const wantNitro = !!intent && intent.nitro === true;
  const useful = throttle > 0;
  if (p.nitroLocked === true) {
    p.nitroActive = false;
    p.nitro = Math.min(1, p.nitro + NITRO_RECHARGE * dt);
    if (p.nitro >= NITRO_REARM) p.nitroLocked = false;
  } else if (wantNitro && useful && p.nitro > 0) {
    p.nitroActive = true;
    p.nitro = Math.max(0, p.nitro - NITRO_DRAIN * dt);
    if (p.nitro <= 0) p.nitroLocked = true;
  } else {
    p.nitroActive = false;
    p.nitro = Math.min(1, p.nitro + NITRO_RECHARGE * dt);
  }
  const boosting = p.boost > 0;
  const turboing = p.turbo > 0;
  const nitroing = p.nitroActive === true;
  const slowed = Number(p.empT) > 0;
  // Multipliers are projected by authority; classic snapshots carry 1.0.
  // Keep prediction identical to upgraded server physics after rematches.
  const tune = p.tuning || {};
  const topScale = clamp(Number(tune.top) || 1, 1, 1.15);
  const accelScale = clamp(Number(tune.accel) || 1, 1, 1.15);
  const turnScale = clamp(Number(tune.turn) || 1, 1, 1.12);
  const top = MAX_SPEED * topScale * Math.max(boosting ? BOOST_SPEED : 1, turboing ? TURBO_SPEED : 1, nitroing ? NITRO_SPEED : 1) * (slowed ? EMP_TOP_SCALE : 1);
  const punch = boosting ? 2 : nitroing ? NITRO_PUNCH : turboing ? 1.5 : 1;
  const accel = ACCEL * accelScale * (slowed ? EMP_ACCEL_SCALE : 1);
  if (throttle > 0) p.speed = Math.min(top, p.speed + accel * punch * throttle * dt);
  else if (throttle < 0) {
    p.speed = p.speed > 0.5
      ? Math.max(0, p.speed + BRAKE * throttle * dt)
      : Math.max(-MAX_REVERSE, p.speed + accel * 0.7 * throttle * dt);
  } else {
    const d = DRAG * dt;
    p.speed = p.speed > d ? p.speed - d : p.speed < -d ? p.speed + d : 0;
  }
  p.speed = clamp(p.speed, -MAX_REVERSE, top);
  const map = opts && opts.map;
  const surfaces = (opts && opts.surfaces) || (map && map.surfaces);
  const grip = gripAt(p.x, p.z, surfaces);
  p.grip = grip;
  const wantDrift = !!intent && intent.drift === true;
  const active = wantDrift && p.speed > DRIFT_MIN_SPEED && Math.abs(steer) > DRIFT_STEER_MIN;
  const was = p.drifting === true;
  if (p.slip === undefined) p.slip = 0;
  if (p.driftCharge === undefined) p.driftCharge = 0;
  if (active) {
    // OUTWARD tail slide (mirrors the server): right drift targets negative
    // slip along screen-right so the velocity heading LAGS the nose.
    const target = -steer * p.speed * DRIFT_SLIP;
    p.slip += (target - p.slip) * Math.min(1, DRIFT_BLEND * dt);
    p.slip = clamp(p.slip, -SLIP_MAX, SLIP_MAX);
    p.driftCharge = Math.min(1, p.driftCharge + dt / DRIFT_CHARGE_NEED);
  } else {
    // Release pays ONLY on a deliberate drift-key release at useful forward
    // speed (mirrors the server); stale held intent pays nothing.
    if (was && p.driftCharge >= 1 && !wantDrift && p.speed > DRIFT_MIN_SPEED) {
      p.turbo = Math.max(p.turbo, MINI_TURBO_TIME);
    }
    p.driftCharge = 0;
    p.slip -= p.slip * Math.min(1, SLIP_RECOVER * grip * dt);
    if (Math.abs(p.slip) < 1e-9) p.slip = 0;
  }
  p.drifting = active;
  const gripSpeed = clamp(Math.abs(p.speed) / 8, 0.35, 1);
  const surfTurn = 0.65 + 0.35 * clamp(grip, 0, 1);
  const driftTurn = active ? DRIFT_TURN : 1;
  /* CORRECTED SIGN: +steer turns toward screen right (see header).
   * The EMP turn factor sits in the identical chain position as the
   * server's, so slowed yaw agrees bit-for-bit. */
  let a = p.angle - steer * TURN_RATE * turnScale * (slowed ? EMP_TURN_SCALE : 1) * gripSpeed * surfTurn * driftTurn * dt * (p.speed < -0.5 ? -1 : 1);
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  p.angle = a;
  const f = forwardOf(p.angle);
  const r = screenRightOf(p.angle);
  p.x += (f.x * p.speed + r.x * p.slip) * dt;
  p.z += (f.z * p.speed + r.z * p.slip) * dt;
  const pads = (opts && opts.pads) || (map && map.pads);
  if (pads) {
    for (const pad of pads) {
      if (!pad) continue;
      if (Math.abs(p.x - pad.x) <= pad.hw && Math.abs(p.z - pad.z) <= pad.hd &&
          p.padCd <= 0 && p.speed > PAD_MIN_SPEED) {
        p.turbo = Math.max(p.turbo, TURBO_TIME);
        p.padCd = PAD_COOLDOWN;
        break;
      }
    }
  }
  const blocks = (opts && opts.blocks) || (map && map.blocks);
  if (blocks && blocks.length) collideBlocks(p, blocks);
  const bound = resolveBound(opts && opts.bound, map);
  if (p.x < -bound || p.x > bound) {
    slideAlong(p, p.x < 0 ? 1 : -1, 0);
    p.x = clamp(p.x, -bound, bound);
  }
  if (p.z < -bound || p.z > bound) {
    slideAlong(p, 0, p.z < 0 ? 1 : -1);
    p.z = clamp(p.z, -bound, bound);
  }
  return p;
}

export function createPoseStore() {
  return {
    self: null, // {x,z,angle,speed,slip,boost,boostCd,turbo,padCd,driftCharge,drifting,pid} predicted self
    rem: new Map(), // pid -> {rx,rz,ra,sx,sz,sa,speed,tSnap}
    simAt: null,
  };
}

export function resetPoseStore(store) {
  store.self = null;
  store.rem.clear();
  store.simAt = null;
}

function kartById(S, pid) {
  const ks = (S && S.karts) || [];
  for (const k of ks) if (k.pid === pid) return k;
  return null;
}

/* Ingest one authoritative snapshot (call from view.update, ~10 Hz).
 * - Self: soft-blend predicted pose toward server (snap if far), adopt
 *   server boost/turbo/pad/drift timers (authoritative), blend the full
 *   velocity (speed + slip). Drops prediction entirely outside drive.
 * - Remotes: store the new server target; snap render pose on first sight
 *   or teleports. Prunes pids that left. `now` is a client ms clock.
 * - Respawn epoch: the server bumps spawnSeq on every (re)spawn; a
 *   changed epoch snaps and resets the pose even when the new pose is
 *   nearby, so a fresh life never eases through the arena. Snapshots
 *   without spawnSeq (Star Rush) compare undefined-to-undefined: no-op. */
export function ingestSnapshot(store, S, selfPid, now) {
  const timed = Number.isFinite(S?.simAt);
  if (timed && store.simAt !== null && S.simAt < store.simAt) return store;
  const duplicate = timed && S.simAt === store.simAt;
  if (timed) store.simAt = S.simAt;
  const phase = (S && S.phase) || '';
  const live = new Set();
  for (const k of (S && S.karts) || []) live.add(k.pid);
  for (const pid of [...store.rem.keys()]) {
    if (!live.has(pid)) store.rem.delete(pid);
  }
  if (store.self && (!store.self.pid || !live.has(store.self.pid))) store.self = null;

  if (phase !== 'drive') {
    // Static phases: no prediction. Snap remotes to the snapshot so the
    // next frame is exact; self prediction restarts on the next drive.
    store.self = null;
    for (const k of (S && S.karts) || []) {
      store.rem.set(k.pid, {
        rx: k.x, rz: k.z, ra: k.angle,
        sx: k.x, sz: k.z, sa: k.angle,
        speed: 0, tSnap: now,
      });
    }
    return store;
  }

  const me = selfPid ? kartById(S, selfPid) : null;
  if (me) {
    if (!store.self || store.self.pid !== me.pid) {
      store.self = {
        pid: me.pid, x: me.x, z: me.z, angle: me.angle,
        speed: me.speed || 0, slip: me.slip || 0,
        boost: me.boost || 0, boostCd: me.boostCd || 0,
        turbo: me.turbo || 0, padCd: me.padCd || 0,
        driftCharge: me.driftCharge || 0, drifting: me.drifting === true,
        nitro: me.nitro === undefined ? 1 : clamp(Number(me.nitro) || 0, 0, 1),
        nitroActive: me.nitroActive === true,
        nitroLocked: me.nitroLocked === true,
        empT: clamp(Number(me.empT) || 0, 0, 99),
        grip: me.grip || 1,
        spawnSeq: me.spawnSeq,
        ox: 0, oz: 0, oa: 0,
        dead: (me.respawn || 0) > 0,
        tuning: me.tuning,
        tSnap: now,
      };
    } else {
      const p = store.self;
      const err = Math.hypot(me.x - p.x, me.z - p.z);
      const ad = Math.abs(angDiff(p.angle, me.angle));
      const visible = {x:p.x+(p.ox||0), z:p.z+(p.oz||0), a:p.angle+(p.oa||0)};
      const hard = me.spawnSeq !== p.spawnSeq || err > SELF_SNAP_DIST || ad > SELF_SNAP_ANGLE;
      if (me.spawnSeq !== p.spawnSeq) {
        // New life: hard snap + velocity reset even when nearby.
        p.x = me.x; p.z = me.z; p.angle = me.angle;
        p.speed = me.speed || 0;
        p.slip = me.slip || 0;
        p.spawnSeq = me.spawnSeq;
      } else if (err > SELF_SNAP_DIST || ad > SELF_SNAP_ANGLE) {
        p.x = me.x; p.z = me.z; p.angle = me.angle;
        p.speed += ((me.speed || 0) - p.speed) * SELF_SPEED_BLEND;
        p.slip += ((me.slip || 0) - (p.slip || 0)) * SELF_SPEED_BLEND;
      } else if (!duplicate) {
        p.x += (me.x - p.x) * SELF_BLEND;
        p.z += (me.z - p.z) * SELF_BLEND;
        p.angle += angDiff(p.angle, me.angle) * SELF_ANGLE_BLEND;
        p.speed += ((me.speed || 0) - p.speed) * SELF_SPEED_BLEND;
        p.slip += ((me.slip || 0) - (p.slip || 0)) * SELF_SPEED_BLEND;
      }
      if (hard || (me.respawn || 0) > 0) {
        p.ox = p.oz = p.oa = 0;
        if ((me.respawn || 0) > 0) { p.x=me.x; p.z=me.z; p.angle=me.angle; p.speed=p.slip=0; }
      } else {
        // Reconcile physics immediately; decay the visual error each FRAME.
        // Pulling the visible kart backwards on each packet caused 10Hz jolts.
        p.ox = visible.x-p.x; p.oz = visible.z-p.z;
        p.oa = angDiff(p.angle,visible.a);
      }
      p.dead = (me.respawn || 0) > 0;
      p.tuning = me.tuning;
      p.boost = me.boost || 0; // authoritative: corrects ungranted local pops
      p.boostCd = me.boostCd || 0;
      p.turbo = me.turbo || 0; // authoritative: pad/mini-turbo grants
      p.padCd = me.padCd || 0;
      p.driftCharge = me.driftCharge || 0;
      p.drifting = me.drifting === true;
      p.nitro = me.nitro === undefined ? 1 : clamp(Number(me.nitro) || 0, 0, 1);
      p.nitroActive = me.nitroActive === true;
      p.nitroLocked = me.nitroLocked === true;
      p.empT = clamp(Number(me.empT) || 0, 0, 99);
      p.tSnap = now; // receipt time: the self freeze cutoff counts from here
    }
  } else if (store.self) {
    store.self = null; // spectator now, or kart gone: stop predicting
  }

  for (const k of (S && S.karts) || []) {
    if (me && k.pid === me.pid) continue; // self is predicted, not eased
    let r = store.rem.get(k.pid);
    if (!r) {
      store.rem.set(k.pid, {
        rx: k.x, rz: k.z, ra: k.angle,
        sx: k.x, sz: k.z, sa: k.angle,
        speed: k.speed || 0, tSnap: now,
        seq: k.spawnSeq,
      });
      continue;
    }
    const jump = Math.hypot(k.x - r.rx, k.z - r.rz);
    const epoch = k.spawnSeq !== r.seq;
    r.sx = k.x; r.sz = k.z; r.sa = k.angle;
    r.speed = k.speed || 0;
    r.tSnap = now;
    r.seq = k.spawnSeq;
    if (epoch || jump > REMOTE_SNAP_DIST) {
      r.rx = k.x; r.rz = k.z; r.ra = k.angle;
    }
  }
  if (timed) {
    for (const k of S.karts || []) {
      if (me && k.pid === me.pid) continue;
      const r = store.rem.get(k.pid);
      if (!r) continue;
      if (!r.samples || r.samples.at(-1)?.seq !== k.spawnSeq ||
          Math.hypot(k.x-r.samples.at(-1).x,k.z-r.samples.at(-1).z)>REMOTE_SNAP_DIST) r.samples=[];
      const sample = {at:S.simAt, seq:k.spawnSeq, x:k.x, z:k.z, angle:k.angle,
        vx:Number(k.vx)||0, vz:Number(k.vz)||0, dead:(k.respawn||0)>0};
      if (r.samples.at(-1)?.at === sample.at) r.samples[r.samples.length-1]=sample;
      else r.samples.push(sample);
      while (r.samples.length>8) r.samples.shift();
    }
  }
  return store;
}

/* Compute draw poses for this frame (call from any renderer at rAF rate).
 * Returns a fresh Map pid -> {x,z,angle}. `intent` is the live local input
 * (self only, drive phase; intent.drift arms the predicted slide);
 * `now` is the same client ms clock as ingest. Map geometry reaches the
 * self stepper via opts.blocks / opts.pads / opts.surfaces or a single
 * opts.map snapshot object carrying all three. Reduced motion snaps
 * remotes but keeps self prediction (responsive). */
export function framePoses(store, S, intent, dt, now, opts) {
  const out = new Map();
  if (!S) return out;
  const phase = S.phase || '';
  const rm = !!(opts && opts.reducedMotion);
  const step = clamp(Number(dt) || 0, 0, MAX_FRAME_DT);
  const allowBoost = (S && S.mode) !== 'battle';
  const map = (opts && opts.map) || (S && S.map);
  const blocks = (opts && opts.blocks) || (map && map.blocks);
  const pads = (opts && opts.pads) || (map && map.pads);
  const surfaces = (opts && opts.surfaces) || (map && map.surfaces);
  const bound = resolveBound(opts && opts.bound, map);

  if (phase !== 'drive') {
    // Static phases draw the snapshot exactly (also covers countdown/done).
    for (const k of S.karts || []) out.set(k.pid, { x: k.x, z: k.z, angle: k.angle });
    return out;
  }

  // Self: integrate local intent from the reconciled pose (instant), or
  // fall back to the snapshot when not predicting (spectator/first frame).
  const selfPid = store.self ? store.self.pid : null;
  if (store.self) {
    // Frozen connection: once the last snapshot is older than
    // EXTRAPOLATE_MS, hold the pose instead of driving on forever.
    // Ordinary delayed snapshots (age under the cutoff) still step.
    const selfAge = Math.max(0, now - (store.self.tSnap || 0));
    if (selfAge <= EXTRAPOLATE_MS && !store.self.dead) {
      stepSelf(store.self, intent, step, { allowBoost, blocks, pads, surfaces, bound });
    }
    const p=store.self;
    const decay=Math.exp(-CORRECTION_DECAY*step);
    p.ox=(p.ox||0)*decay; p.oz=(p.oz||0)*decay; p.oa=(p.oa||0)*decay;
    const draw={x:clamp(p.x+p.ox,-bound,bound),z:clamp(p.z+p.oz,-bound,bound),angle:p.angle+p.oa,speed:p.speed,slip:p.slip};
    if (blocks) collideBlocks(draw,blocks);
    out.set(p.pid, {x:draw.x,z:draw.z,angle:draw.angle});
  } else if (selfPid === null) {
    // No prediction state (e.g. remote-only view): remotes below cover all.
  }

  for (const k of S.karts || []) {
    if (store.self && k.pid === store.self.pid) continue;
    const r = store.rem.get(k.pid);
    if (!r) {
      out.set(k.pid, { x: k.x, z: k.z, angle: k.angle });
      continue;
    }
    if(k.respawn>0||k.connected===false){r.rx=k.x;r.rz=k.z;r.ra=k.angle;out.set(k.pid,{x:k.x,z:k.z,angle:k.angle});continue;}
    if (rm) {
      // Reduced motion: remotes track the snapshot exactly (no ease, no
      // lead). Self prediction above is unaffected by design.
      r.rx = r.sx; r.rz = r.sz; r.ra = r.sa;
      out.set(k.pid, { x: r.rx, z: r.rz, angle: r.ra });
      continue;
    }
    if (r.samples?.length && Number.isFinite(opts?.serverNow)) {
      const samples=r.samples;
      const target=opts.serverNow-REMOTE_BUFFER_MS;
      let left=samples[0], right=null;
      for (const s of samples) { if(s.at<=target) left=s; else {right=s;break;} }
      if (right && right!==left) {
        const f=clamp((target-left.at)/(right.at-left.at),0,1);
        r.rx=left.x+(right.x-left.x)*f; r.rz=left.z+(right.z-left.z)*f;
        r.ra=left.angle+angDiff(left.angle,right.angle)*f;
      } else {
        const lead=left.dead ? 0 : clamp((target-left.at)/1000,0,.15);
        const draw={x:clamp(left.x+left.vx*lead,-bound,bound),z:clamp(left.z+left.vz*lead,-bound,bound),angle:left.angle,speed:0,slip:0};
        if(blocks) collideBlocks(draw,blocks);
        r.rx=draw.x;r.rz=draw.z;r.ra=draw.angle;
      }
      const draw={x:r.rx,z:r.rz,angle:r.ra,speed:0,slip:0};
      if(blocks)collideBlocks(draw,blocks);r.rx=draw.x;r.rz=draw.z;
      out.set(k.pid,{x:r.rx,z:r.rz,angle:r.ra});
      continue;
    }
    // Bounded lead: coast along the last known heading/speed for at most
    // EXTRAPOLATE_MS past the snapshot, then hold (freeze, never run away).
    const stale = Math.max(0, now - (r.tSnap || 0));
    const lead = Math.min(stale, EXTRAPOLATE_MS) / 1000;
    const f = forwardOf(r.sa);
    const tx = clamp(r.sx + f.x * r.speed * lead, -bound, bound);
    const tz = clamp(r.sz + f.z * r.speed * lead, -bound, bound);
    const ease = Math.min(1, step * REMOTE_EASE);
    r.rx += (tx - r.rx) * ease;
    r.rz += (tz - r.rz) * ease;
    r.ra += angDiff(r.ra, r.sa) * ease;
    const draw={x:r.rx,z:r.rz,angle:r.ra,speed:0,slip:0};
    if(blocks)collideBlocks(draw,blocks);r.rx=draw.x;r.rz=draw.z;
    out.set(k.pid, { x: r.rx, z: r.rz, angle: r.ra });
  }
  return out;
}
