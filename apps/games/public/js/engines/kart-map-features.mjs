/* Arena features shared by the classic authority, client prediction and the
 * renderer: launch cannons, paired portals and fall-off zones. Pure data and
 * math plus one small runner the Rapier motion owns. No imports, no timers.
 *
 * Map data (kart-maps.js `features`):
 *   cannons: [{ x, z, angle, land: { x, z, angle }, flight?, apex? }]
 *     The cannon points along `angle` (forward = (sin a, cos a)). Driving
 *     into its rear mouth fires the kart along a scripted
 *     ballistic arc to `land`, where it touches down facing land.angle.
 *   portals: [[{ x, z, angle }, { x, z, angle }]]
 *     Each ring faces `angle`; a kart leaving a ring drives out along it.
 *     Entering one ring exits its partner with the same planar speed.
 *   falls: [{ x, z, hw, hd, kind }] axis-aligned water/pit rectangles.
 *
 * Flight is kinematic (the body is disabled, then re-enabled on landing),
 * so cover, rivals and cannons cannot deflect it and the landing zone is
 * exact. A portal is an authoritative discontinuity: resetKart bumps the
 * pose epoch, which prediction and interpolation treat like a respawn. */

export const CANNON_FLIGHT = 1.4;      // seconds airborne (allowed 1.2..1.6)
export const CANNON_APEX = 8;          // metres above the straight chord
export const CANNON_COOLDOWN = 2.5;    // seconds after landing before re-arm
export const CANNON_LAND_SPEED = 14;   // m/s along the landing heading
export const CANNON_HALF_WIDTH = .55; // centred in the open rear mouth
export const CANNON_HALF_LENGTH = 1.2;
// Trigger when the front bumper reaches the ring, before the chassis hits
// its now-solid frame. Only the open centre admits a kart, not the uprights.
export const PORTAL_HALF_WIDTH = .55;
export const PORTAL_HALF_DEPTH = 2.7;
export const PORTAL_EXIT = 3.6;        // exit point ahead of the partner ring
export const PORTAL_GRACE = 1.2;       // seconds no ring can trigger again
export const PORTAL_MIN_EXIT_SPEED = 7;
export const FEATURE_MIN_SPEED = 1;    // parked karts never trigger
export const RIDE_HEIGHT = 0.75;       // body centre above ground at spawn
export const CANNON_ENTRY_TIME = .11;
export const CANNON_REVEAL_TIME = .18;
export const CANNON_MOUTH_HEIGHT = 1.5;

// One tube transform for art and collision. The open muzzle follows the
// existing scripted launch arc; neither its path nor its landing changes.
export function cannonTube(c,groundAt=()=>0){
  const y0=c.y??groundAt(c.x,c.z),muzzle=flightPose(c,{x:c.x,y:y0+RIDE_HEIGHT,z:c.z,a:c.angle,ly:(c.land.y??groundAt(c.land.x,c.land.z))+RIDE_HEIGHT},CANNON_REVEAL_TIME).position;
  const forward=(muzzle.x-c.x)*Math.sin(c.angle)+(muzzle.z-c.z)*Math.cos(c.angle),rise=muzzle.y-y0-CANNON_MOUTH_HEIGHT;
  return{y0,muzzle,forward,rise,length:Math.hypot(forward,rise),pitch:Math.atan2(rise,forward)};
}

const TAU = Math.PI * 2;
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const smooth = (t) => t * t * (3 - 2 * t);

/* Point in a feature's local frame: u along its forward, v across it. */
function localUV(f, x, z) {
  const dx = x - f.x, dz = z - f.z, s = Math.sin(f.angle || 0), c = Math.cos(f.angle || 0);
  return { u: dx * s + dz * c, v: dx * c - dz * s };
}

export function inCannon(c, x, z) {
  const p = localUV(c, x, z);
  return p.u>=-CANNON_HALF_LENGTH-1e-6&&p.u<=1e-6&&Math.abs(p.v)<=CANNON_HALF_WIDTH;
}

export function inPortal(p, x, z) {
  const q = localUV(p, x, z);
  return Math.abs(q.u) <= PORTAL_HALF_DEPTH && Math.abs(q.v) <= PORTAL_HALF_WIDTH;
}

export function inFall(f, x, z, margin = 0) {
  return Math.abs(x - f.x) <= f.hw - margin && Math.abs(z - f.z) <= f.hd - margin;
}

/* The fall zone containing (x, z), or null. */
export function fallAt(features, x, z, margin = 0) {
  for (const f of features?.falls || []) if (inFall(f, x, z, margin)) return f;
  return null;
}

export function portalExit(p) {
  const s = Math.sin(p.angle), c = Math.cos(p.angle);
  return { x: p.x + s * PORTAL_EXIT, z: p.z + c * PORTAL_EXIT, angle: wrap(p.angle),
    ...(Number.isFinite(p.y)?{y:p.y,surface:p.surface}:{}) };
}

export function cannonFlightTime(c) {
  const t = Number(c?.flight);
  return Number.isFinite(t) && t >= 1.2 && t <= 1.6 ? t : CANNON_FLIGHT;
}

/* Yaw then nose pitch (positive pitch lifts the nose toward +Y). */
export function yawPitchRotation(angle, pitch = 0, out = {}) {
  const cy = Math.cos(angle / 2), sy = Math.sin(angle / 2), cp = Math.cos(-pitch / 2), sp = Math.sin(-pitch / 2);
  out.x = cy * sp; out.y = sy * cp; out.z = -sy * sp; out.w = cy * cp;
  return out;
}

/* Scripted arc pose at flight time t (seconds). `flight` is the state
 * captured at launch: { c, t, x, y, z, a, ly, life }. */
export function flightPose(cannon, flight, t = flight.t) {
  const T = cannonFlightTime(cannon), s = Math.max(0, Math.min(1, t / T));
  const apex = Number.isFinite(cannon.apex) ? cannon.apex : CANNON_APEX;
  const lx = cannon.land.x, lz = cannon.land.z, la = cannon.land.angle;
  const x = flight.x + (lx - flight.x) * s, z = flight.z + (lz - flight.z) * s;
  const y = flight.y + (flight.ly - flight.y) * s + 4 * apex * s * (1 - s);
  const vx = (lx - flight.x) / T, vz = (lz - flight.z) / T, vy = ((flight.ly - flight.y) + 4 * apex * (1 - 2 * s)) / T;
  const angle = wrap(flight.a + wrap(la - flight.a) * smooth(s));
  // The nose follows a softened flight path so the arc reads clearly.
  const pitch = Math.atan2(vy, Math.hypot(vx, vz)) * 0.45 * Math.sin(Math.PI * Math.min(1, s * 1.15 + .02));
  return {
    position: { x, y, z }, rotation: yawPitchRotation(angle, pitch),
    linearVelocity: { x: vx, y: vy, z: vz }, angularVelocity: { x: 0, y: 0, z: 0 }, angle, done: s >= 1,
  };
}

/* Flight progress 0..1 for presentation (null when grounded). */
export function flightProgress(features, kart) {
  const f = kart?.flight, c = f && features?.cannons?.[f.c];
  return c ? Math.max(0, Math.min(1, f.t / cannonFlightTime(c))) : null;
}

/* Runner owned by createClassicMotion. Runs once per fixed step after the
 * physics step, for authority and prediction alike. Feature events are
 * appended to state.featureEvents when that array exists (authority only). */
export function createFeatureRunner({ physics, state, features, enabled, project, groundAt, canEnter=()=>true, canArrive=()=>true, onEvent }) {
  const cannons = features?.cannons || [], portals = features?.portals || [];
  const flying = new Set();
  const active = cannons.length > 0 || portals.length > 0;
  function emit(type, k, extra) {
    if(onEvent){onEvent(type,k,extra);return;}
    if (!Array.isArray(state.featureEvents)) return;
    state.featureEventSeq = (state.featureEventSeq || 0) + 1;
    state.featureEvents.push({ id: 'f' + state.featureEventSeq, type, pid: k.pid, ...extra });
    while (state.featureEvents.length > 16) state.featureEvents.shift();
  }
  // A flight belongs to one life; a KO or respawn mid-air discards it.
  function reconcile(k) {
    if (k.flight && (k.respawn > 0 || k.flight.life !== (k.spawnSeq || 0) || !cannons[k.flight.c])) { k.flight = null; flying.delete(k.pid); }
    if (k.flight) flying.add(k.pid);
    return !!k.flight;
  }
  function launch(k, index) {
    const c = cannons[index], start = physics.pose(k.pid);
    physics.setKartEnabled(k.pid, false); enabled.set(k.pid, false); flying.add(k.pid);
    k.flight = { c: index, t: 0, x: start.position.x, y: start.position.y, z: start.position.z, a: k.angle,
      ly: (Number.isFinite(c.land.y)?c.land.y:groundAt(c.land.x,c.land.z)||0) + RIDE_HEIGHT, life: k.spawnSeq || 0 };
    k.drifting=false;k.driftCharge=0;k.driftDirection=0;k.driftTier=0;k.driftHop=0;k._driftHeld=false;
    physics.restoreKart(k.pid, flightPose(c, k.flight, 0));
    emit('launch', k, { cannon: index, x: c.x, z: c.z, angle: c.angle, to: { x: c.land.x, z: c.land.z } });
  }
  function land(k) {
    const c = cannons[k.flight.c], la = c.land.angle;
    const pose = flightPose(c, k.flight, cannonFlightTime(c));
    pose.linearVelocity = { x: Math.sin(la) * CANNON_LAND_SPEED, y: -1, z: Math.cos(la) * CANNON_LAND_SPEED };
    pose.rotation = yawPitchRotation(la, 0);
    physics.setKartEnabled(k.pid, true); enabled.set(k.pid, true); flying.delete(k.pid);
    physics.restoreKart(k.pid, pose);
    emit('land', k, { cannon: k.flight.c, x: c.land.x, z: c.land.z });
    k.flight = null; k.cannonCd = CANNON_COOLDOWN;
  }
  function warp(k, pair, side) {
    const from = portals[pair][side], to = portals[pair][1 - side], exit = portalExit(to);
    const before = physics.pose(k.pid), v = before.linearVelocity;
    const speed = Math.max(PORTAL_MIN_EXIT_SPEED, Math.hypot(v.x, v.z));
    const position = { x: exit.x, y: (Number.isFinite(exit.y)?exit.y:groundAt(exit.x,exit.z)||0) + RIDE_HEIGHT, z: exit.z };
    const rotation = yawPitchRotation(exit.angle, 0);
    physics.resetKart(k.pid, { position, rotation }); // epoch++: a hard discontinuity
    physics.restoreKart(k.pid, { position, rotation, angularVelocity: { x: 0, y: 0, z: 0 },
      linearVelocity: { x: Math.sin(exit.angle) * speed, y: 0, z: Math.cos(exit.angle) * speed } });
    k.portalCd = PORTAL_GRACE;
    k.drifting=false;k.driftCharge=0;k.driftDirection=0;k.driftTier=0;k.driftHop=0;k._driftHeld=false;
    emit('warp', k, { pair, side, from: { x: from.x, z: from.z }, to: { x: to.x, z: to.z } });
  }
  function step(dt, connected) {
    if (!active) return;
    for (const k of state.karts) {
      if (!connected.has(k.pid) || k.respawn > 0) { reconcile(k); continue; }
      k.cannonCd = Math.max(0, (Number(k.cannonCd) || 0) - dt);
      k.portalCd = Math.max(0, (Number(k.portalCd) || 0) - dt);
      if (reconcile(k)) {
        k.flight.t += dt;
        const c = cannons[k.flight.c];
        if (k.flight.t >= cannonFlightTime(c)) land(k);
        else physics.restoreKart(k.pid, flightPose(c, k.flight));
        project(k);
        continue;
      }
      if (!enabled.get(k.pid) || !(Math.abs(k.speed) >= FEATURE_MIN_SPEED)) continue;
      let fired = false;
      if (k.cannonCd <= 0) for (let i = 0; i < cannons.length; i++) if (inCannon(cannons[i], k.x, k.z)&&canEnter(k,cannons[i])&&canArrive(k,cannons[i].land)) { launch(k, i); fired = true; break; }
      if (!fired && k.portalCd <= 0) {
        outer: for (let i = 0; i < portals.length; i++) for (let side = 0; side < 2; side++) {
          if (inPortal(portals[i][side], k.x, k.z)&&canEnter(k,portals[i][side])&&canArrive(k,portalExit(portals[i][1-side]))) { warp(k, i, side); fired = true; break outer; }
        }
      }
      if (fired) project(k);
    }
  }
  /* Prediction: authority says this kart has landed while the local body
   * is still parked for flight. Re-enable it BEFORE the authoritative pose
   * (with its landing velocity) is restored: a disabled Rapier body would
   * drop that velocity, and enabling later would halt it like a respawn. */
  function resumeLanded(k) {
    if (!flying.has(k.pid) || k.flight) return false;
    flying.delete(k.pid);
    if (enabled.get(k.pid) === false && !(k.respawn > 0) && k.connected !== false) {
      physics.setKartEnabled(k.pid, true); enabled.set(k.pid, true);
    }
    return true;
  }
  return { step, reconcile, resumeLanded, cancel(k){k.flight=null;flying.delete(k.pid);},clear(){flying.clear();}, flying: (pid) => flying.has(pid) };
}
