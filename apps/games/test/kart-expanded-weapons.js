// Planar-mutating unit fixtures use an explicit generic variant, not physical Pocket.
'use strict';
/* Expanded battle weapons: grenade canisters + EMP discharge on the real
 * reusable engine (room ctx stub only — full create/onAction/onTick/view).
 * - Grenade: accepted Fire via the shared edge (short press/hold/cooldown),
 *   22 u/s lob with gravity arc, <=2 damped bounces off floor/cover/walls
 *   at 100/250ms and clamped hitches (swept, never tunnels), fuse 1.4s
 *   with final-0.5s ground warning, ONE detonation (splash 4u, line of
 *   sight, owner/shield/dead/offline immune, every vulnerable victim KO'd
 *   exactly once via knockOut with exact-once coins), 12-body cap keeps
 *   item/shield/cooldown. The flying body never scores on contact.
 * - EMP: accepted Fire, instantaneous 12u / 0.55rad cone from the live pose
 *   (front hits; rear/side/range/cover/shield/dead/offline/owner excluded),
 *   empT 1.6s refresh-never-stack, top x0.62 / accel x0.6 / turn x0.75
 *   AFTER nitro (nitro cannot bypass, charge deterministic), engine/pose
 *   bit-parity incl. garage tuning, lifecycle (countdown/done frozen,
 *   disconnect frozen, TTL keeps ticking, KO/respawn/rematch clear), no
 *   score. One fire event + one bounded emp record per victim.
 * - Pool: deterministic weighted 8-item pickup pool, IDENTICAL in classic
 *   and garage (pulse .20, scatter .16, mine .13, shield .14, rocket .11,
 *   rail .08, grenade .10, emp .08; sum 1; stronger lethal rarer). No
 *   input injection, malformed fixtures bounded, exact event/view/flight
 *   shapes for parent + audio.
 * Run: node test/kart-expanded-weapons.js */

const assert = require('assert');

const karts = require('./fixtures/kart-planar-variant.cjs');
const engine = require('../games/engines/kart-engine');
const battle = require('../games/engines/kart-rules-battle');

const POSE_URL = '../public/js/games/pocket-karts-pose.mjs';
const FLIGHT_URL = '../public/js/engines/kart-flight.mjs';
const C = battle.constants;

function stubCtx({ players, settings, now, session }) {
  const ctx = {
    _now: now !== undefined ? now : 9500000,
    _connected: null,
    _session: session || null,
    players() { return (this._connected || players).slice(); },
    allPlayers: () => players.slice(),
    content: () => ({}),
    settings: () => ({ ...(settings || {}) }),
    hostId: () => players[0].id,
    broadcast() {},
    lobby() {},
    later: () => () => {},
    award() {},
    now: () => ctx._now,
  };
  if (session) ctx.session = () => session;
  return ctx;
}
function mkPlayers(n) { return Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })); }
function racing(settings, n = 2, now = 9500000, session) {
  const players = mkPlayers(n);
  const ctx = stubCtx({ players, settings, now, session });
  const st = karts.create(ctx);
  ctx._now += 3000;
  karts.onTick(st, ctx);
  assert.strictEqual(st.phase, 'drive', 'countdown reaches drive');
  for (const c of st.crates) { c.x = st.bound - 1; c.z = -(st.bound - 1); }
  return [st, ctx];
}
function tick(ctx, st, ms = 100) { ctx._now += ms; karts.onTick(st, ctx); }
function parkFar(st, except = []) {
  const c = st.bound - 4;
  let i = 0;
  for (const k of st.karts) {
    if (except.includes(k.pid)) continue;
    k.x = i % 2 === 0 ? c : -c;
    k.z = i % 4 < 2 ? c : -c;
    i += 1;
    k.angle = 0; k.speed = 0;
    k.input = { steer: 0, throttle: 0, boost: false };
  }
}
const press = (st, ctx, pid) => karts.onAction(st, ctx, pid, { input: { steer: 0, throttle: 0, boost: true } });
const release = (st, ctx, pid) => karts.onAction(st, ctx, pid, { input: { steer: 0, throttle: 0 } });
function approx(a, b, tol, msg) {
  assert(Math.abs(a - b) <= tol, `${msg} (saw ${a}, want ${b})`);
}

async function main() {
  const pose = await import(POSE_URL);
  const flight = await import(FLIGHT_URL);

  // --- 1. grenade Fire: accepted spend, shield dropped, slot emptied ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    const a = st.karts[0];
    parkFar(st, ['p0']);
    a.weapon = 'grenade'; a.ammo = 1; a.shield = 2.5; a.fireCd = 0; a.prevAction = false;
    a.x = 0; a.z = -20; a.angle = 0; a.speed = 0;
    const n = st.events.length;
    press(st, ctx, 'p0');
    tick(ctx, st);
    assert.strictEqual(st.grenades.length, 1, 'press lobs one canister');
    const g = st.grenades[0];
    assert.strictEqual(g.owner, 'p0', 'canister carries its owner');
    assert(/^g\d+$/.test(g.id), 'canister id namespaced, saw ' + g.id);
    assert.strictEqual(a.ammo, 0, 'lob spends the round');
    assert.strictEqual(a.weapon, null, 'lob empties the slot');
    assert.strictEqual(a.shield, 0, 'offensive lob drops protection');
    assert(a.fireCd > 0, 'lob arms the cooldown');
    const fresh = st.events.slice(n).filter((e) => e.type === 'fire');
    assert.strictEqual(fresh.length, 1, 'exactly one fire record');
    assert.strictEqual(fresh[0].weapon, 'grenade', 'fire carries weapon grenade');
    assert.strictEqual(fresh[0].pid, 'p0', 'fire credits the shooter');
    // Ballistics after one 100ms tick: planar ~22 forward, vy fallen by ~3, risen.
    assert.strictEqual(g.vx, 0, 'straight lob has no lateral drift');
    assert.strictEqual(g.vz, C.GRENADE_SPEED, 'planar launch holds 22 u/s');
    approx(g.vy, C.GRENADE_VY0 - C.GRENADE_GRAVITY * 0.1, 0.05, 'gravity arcs vy');
    assert(g.y > C.GRENADE_Y0, `lob rises first, y=${g.y.toFixed(2)}`);
    approx(g.z, -20 + 2 + C.GRENADE_SPEED * 0.1, 0.05, 'muzzle +2u, planar travel');
    approx(g.fuse, C.GRENADE_FUSE - 0.1, 1e-9, 'fuse ticks from authoritative dt');
    console.log('WEAPONS ok: grenade Fire (spend, shield drop, 22u/s lob, gravity arc)');
  }

  // --- 2. grenade edge: short press fires, holds/cooldown never refire ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    const a = st.karts[0];
    parkFar(st, ['p0']);
    a.x = 0; a.z = -20; a.angle = 0; a.speed = 0; a.shield = 0;
    const load = () => { a.weapon = 'grenade'; a.ammo = 1; a.fireCd = 0; a.prevAction = false; };
    const ev0 = st.events.length;
    // Accepted lobs are counted cumulatively (live bodies detonate away).
    const lobs = () => st.events.slice(ev0).filter((e) => e.type === 'fire' && e.weapon === 'grenade').length;
    load();
    press(st, ctx, 'p0'); // held down: no release before the tick
    tick(ctx, st);
    assert.strictEqual(st.grenades.length, 1, 'press lobs');
    assert.strictEqual(lobs(), 1, 'press records one lob');
    // Hold: reload the item while the button stays physically down (input
    // and prevAction both true) — never re-latches, never auto-lobs.
    a.weapon = 'grenade'; a.ammo = 1; a.fireCd = 0;
    for (let i = 0; i < 2; i++) {
      karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
      tick(ctx, st);
    }
    assert.strictEqual(lobs(), 1, 'held button never auto-lobs');
    assert.strictEqual(a.weapon, 'grenade', 'held reload keeps its item');
    release(st, ctx, 'p0');
    tick(ctx, st);
    press(st, ctx, 'p0');
    tick(ctx, st);
    assert.strictEqual(lobs(), 2, 'fresh press after release lobs');
    // Short press: true then false before the same tick still lobs once.
    release(st, ctx, 'p0');
    tick(ctx, st);
    a.weapon = 'grenade'; a.ammo = 1; a.fireCd = 0;
    press(st, ctx, 'p0');
    release(st, ctx, 'p0');
    tick(ctx, st);
    assert.strictEqual(lobs(), 3, 'short press lobs');
    // Cooldown: reload but keep the fresh fireCd — the immediate re-press
    // is denied and keeps everything.
    a.weapon = 'grenade'; a.ammo = 1; a.prevAction = false;
    assert(a.fireCd > 0, 'cooldown armed');
    press(st, ctx, 'p0');
    tick(ctx, st);
    assert.strictEqual(lobs(), 3, 'cooldown blocks the quick lob');
    assert.strictEqual(a.weapon, 'grenade', 'denied lob keeps the item');
    for (let i = 0; i < 5; i++) tick(ctx, st);
    release(st, ctx, 'p0');
    tick(ctx, st);
    press(st, ctx, 'p0');
    tick(ctx, st);
    assert.strictEqual(lobs(), 4, 'cooled press lobs again');
    assert.strictEqual(a.weapon, null, 'cooled lob spends the item');
    console.log('WEAPONS ok: grenade edge (short press, hold-safe, cooldown)');
  }

  // --- 3. floor bounces: bounded, damped, then grounded roll ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    parkFar(st, []);
    st.grenades.push({
      id: 'gb1', owner: 'p0', x: 0, z: 0, y: 0.5, angle: 0,
      vx: 0, vz: 10, vy: -5, fuse: 1.4, bounces: 0,
    });
    tick(ctx, st);
    const g = st.grenades[0];
    assert.strictEqual(g.bounces, 1, 'first touchdown bounces once');
    assert.strictEqual(g.y, 0, 'bounce resolves exactly on the floor');
    assert(g.vy > 3 && g.vy < 4, `vy reflects damped, saw ${g.vy}`);
    assert.strictEqual(g.vz, 5.5, 'planar damps x0.55 on the bounce');
    // Fly on: a second bounce lands, the third touch grounds (budget 2).
    for (let i = 0; i < 10; i++) tick(ctx, st);
    assert.strictEqual(g.bounces, 2, 'bounces cap at two');
    assert.strictEqual(g.y, 0, 'spent canister rests grounded');
    assert.strictEqual(g.vy, 0, 'grounded vy dies');
    assert(g.vz >= 0 && g.vz < 3, `ground friction bleeds the roll, saw ${g.vz}`);
    assert(g.fuse > 0 && g.fuse < 0.5, `fuse survives the bounces, saw ${g.fuse}`);
    console.log('WEAPONS ok: floor bounces (2 bounded, damped, grounded roll)');
  }

  // --- 4. cover + walls: swept, reflected, never tunneled (100/250/clamped) ---
  {
    // 100ms cover face: contact at the expanded face, planar reflected x0.5.
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Bumper Blocks' });
    parkFar(st, []);
    st.grenades.push({
      id: 'gc1', owner: 'p0', x: 16, z: 11, y: 1, angle: 0,
      vx: 0, vz: 22, vy: 0, fuse: 1.4, bounces: 0,
    });
    tick(ctx, st);
    const g = st.grenades[0];
    assert(g.z > 12.9 && g.z <= 13.05 + 1e-9, `face contact, no tunnel, z=${g.z}`);
    assert(g.vz > -11.5 && g.vz < -10.5, `normal reflects damped, vz=${g.vz}`);
    assert.strictEqual(g.bounces, 1, 'face hit spends one bounce');
    assert(g.y > 0.5 && g.y < 1, 'arc still airborne through the face hit');
    // 250ms hitch from farther out: swept substeps still catch the face.
    const [h, ch] = racing({ mode: 'Zap Battle', map: 'Bumper Blocks' }, 2, 9500100);
    parkFar(h, []);
    h.grenades.push({
      id: 'gc2', owner: 'p0', x: 16, z: 11, y: 1, angle: 0,
      vx: 0, vz: 22, vy: 0, fuse: 1.4, bounces: 0,
    });
    tick(ch, h, 250);
    const gh = h.grenades[0];
    assert(gh.z <= 13.05 + 1e-9, `hitch never tunnels cover, z=${gh.z}`);
    assert(gh.vz < 0, 'hitch face hit reflects');
    assert(gh.bounces >= 1, 'hitch face hit spends bounces');
    // Clamped hitch: 1000ms behaves EXACTLY like 250ms (dt clamps to .25).
    const [c, cc] = racing({ mode: 'Zap Battle', map: 'Bumper Blocks' }, 2, 9500200);
    parkFar(c, []);
    c.grenades.push({
      id: 'gc2', owner: 'p0', x: 16, z: 11, y: 1, angle: 0,
      vx: 0, vz: 22, vy: 0, fuse: 1.4, bounces: 0,
    });
    tick(cc, c, 1000);
    const gc = c.grenades[0];
    for (const k of ['x', 'z', 'y', 'vx', 'vz', 'vy', 'fuse', 'bounces']) {
      assert.strictEqual(gc[k], gh[k], `clamped hitch matches 250ms on ${k}`);
    }
    // World wall: endpoint clamp + damped reflection, never past the wall.
    const [w, cw] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 2, 9500300);
    parkFar(w, []);
    w.grenades.push({
      id: 'gw1', owner: 'p0', x: 0, z: 26, y: 1, angle: 0,
      vx: 0, vz: 22, vy: 0, fuse: 1.4, bounces: 0,
    });
    tick(cw, w);
    const gw = w.grenades[0];
    assert.strictEqual(gw.z, 28 - C.GRENADE_R, 'wall clamps to the inset bound');
    assert.strictEqual(gw.vz, -11, 'wall reflects the normal x0.5');
    assert.strictEqual(gw.bounces, 1, 'wall hit spends one bounce');
    console.log('WEAPONS ok: cover/wall bounces (swept, damped, 100/250/clamped, no tunnel)');
  }

  // --- 5. fuse: warning window, exactly-once detonation + blast record ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    const a = st.karts[0];
    parkFar(st, ['p0']);
    a.weapon = 'grenade'; a.ammo = 1; a.shield = 0; a.fireCd = 0; a.prevAction = false;
    a.x = 0; a.z = -20; a.angle = 0; a.speed = 0;
    press(st, ctx, 'p0');
    tick(ctx, st);
    for (let i = 0; i < 4; i++) tick(ctx, st); // fuse ~0.9: no warning yet
    let v = karts.view(st, 'p0').grenades[0];
    assert(v.fuse > C.GRENADE_WARN, `early fuse reads ${v.fuse}`);
    assert.strictEqual(v.warning, false, 'no warning outside the window');
    for (let i = 0; i < 5; i++) tick(ctx, st); // fuse ~0.4: warning live
    v = karts.view(st, 'p0').grenades[0];
    assert(v.fuse <= C.GRENADE_WARN && v.fuse > 0, `late fuse reads ${v.fuse}`);
    assert.strictEqual(v.warning, true, 'final window projects warning:true');
    const n = st.events.length;
    for (let i = 0; i < 10 && st.grenades.length; i++) tick(ctx, st);
    assert.strictEqual(st.grenades.length, 0, 'fuse consumes the body');
    const blasts = st.events.slice(n).filter((e) => e.type === 'blast');
    assert.strictEqual(blasts.length, 1, 'exactly one detonation');
    assert.deepStrictEqual(Object.keys(blasts[0]).sort(),
      ['id', 'pid', 'type', 'weapon', 'x', 'z'].sort(), 'blast shape');
    assert.strictEqual(blasts[0].pid, 'p0', 'blast credits the owner');
    assert.strictEqual(blasts[0].weapon, 'grenade', 'blast carries weapon');
    assert(Number.isFinite(blasts[0].x) && Number.isFinite(blasts[0].z), 'blast marks the point');
    for (let i = 0; i < 10; i++) tick(ctx, st);
    assert.strictEqual(st.events.filter((e) => e.type === 'blast').length, 1, 'no second blast');
    console.log('WEAPONS ok: fuse (warning window, once-only blast record)');
  }

  // --- 6. splash: multi-victim each-once, exact-once coins, range edge ---
  {
    const session = {};
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 3, 9501000, session);
    st.karts.forEach(k=>k.health=1); // Wounded splash/KO contract; full-health acceptance is separate.
    const [o, v1, v2] = st.karts;
    o.x = 20; o.z = 20; o.speed = 0; o.shield = 0; // owner far away
    v1.x = 2; v1.z = 0; v1.speed = 0; v1.shield = 0; // d=2: inside
    v2.x = 0; v2.z = 3; v2.speed = 0; v2.shield = 0; // d=3: inside
    st.grenades.push({
      id: 'gs1', owner: 'p0', x: 0, z: 0, y: 0, angle: 0,
      vx: 0, vz: 0, vy: 0, fuse: 0.05, bounces: 2,
    });
    const n = st.events.length;
    tick(ctx, st);
    assert.strictEqual(st.grenades.length, 0, 'blast consumes the body');
    assert(v1.respawn > 0 && v2.respawn > 0, 'both victims fall');
    assert.strictEqual(v1.deaths, 1, 'victim 1 KO’d once');
    assert.strictEqual(v2.deaths, 1, 'victim 2 KO’d once');
    assert.strictEqual(o.hits, 2, 'shooter scores each victim once');
    assert.strictEqual(session.coins.p0, 20, 'KO coins pay exactly once each');
    const kos = st.events.slice(n).filter((e) => e.type === 'ko');
    assert.strictEqual(kos.length, 2, 'two KO records');
    assert(kos.every((e) => e.weapon === 'grenade' && e.pid === 'p0'), 'KOs credit grenade/p0');
    assert.deepStrictEqual(kos.map((e) => e.other).sort(), ['p1', 'p2'], 'each victim named once');
    // Range edge: d=3 falls, d=5 stands, same blast.
    const [r, cr] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 3, 9501100);
    r.karts.forEach(k=>k.health=1); // Wounded splash/KO contract; full-health acceptance is separate.
    r.karts[0].x = 20; r.karts[0].z = 20;
    r.karts[1].x = 3; r.karts[1].z = 0; r.karts[1].speed = 0; r.karts[1].shield = 0;
    r.karts[2].x = 5; r.karts[2].z = 0; r.karts[2].speed = 0; r.karts[2].shield = 0;
    r.grenades.push({
      id: 'gs2', owner: 'p0', x: 0, z: 0, y: 0, angle: 0,
      vx: 0, vz: 0, vy: 0, fuse: 0.05, bounces: 2,
    });
    tick(cr, r);
    assert(r.karts[1].respawn > 0, 'd=3 inside the 4u splash');
    assert.strictEqual(r.karts[2].respawn, 0, 'd=5 outside the 4u splash');
    assert.strictEqual(r.karts[0].hits, 1, 'only the inside victim scores');
    console.log('WEAPONS ok: splash (multi-victim each-once, coins x2, 4u range)');
  }

  // --- 7. splash immunities: owner/shield/dead/offline/cover ---
  {
    // Owner parks on the blast: safe. Nearest shield holds while a farther
    // clean kart in the same blast falls (shields never area-block).
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 3, 9502000);
    st.karts.forEach(k=>k.health=1); // Wounded splash/KO contract; full-health acceptance is separate.
    const [o, s, v] = st.karts;
    o.x = 0; o.z = -3.2; o.speed = 0; o.shield = 0; // owner inside splash, with legal hull spacing
    s.x = -3; s.z = 1; s.speed = 0; s.shield = 2; // shielded, clear of rival hulls
    v.x = 3; v.z = 1; v.speed = 0; v.shield = 0; // clean, clear of rival hulls
    st.grenades.push({
      id: 'gi1', owner: 'p0', x: 0, z: 0, y: 0, angle: 0,
      vx: 0, vz: 0, vy: 0, fuse: 0.05, bounces: 2,
    });
    tick(ctx, st);
    assert.strictEqual(o.respawn, 0, 'owner immune at ground zero');
    assert.strictEqual(s.respawn, 0, 'shield holds at d=1');
    assert(v.respawn > 0, 'clean kart at d=3 falls anyway');
    assert.strictEqual(o.hits, 1, 'only the clean KO scores');
    // Corpses cannot re-KO: deaths stay counted once.
    const [d, cd] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 2, 9502100);
    d.karts.forEach(k=>k.health=1); // Wounded splash/KO contract; full-health acceptance is separate.
    d.karts[0].x = 20; d.karts[0].z = 20;
    d.karts[1].x = 0; d.karts[1].z = 0; d.karts[1].respawn = 1.5; d.karts[1].deaths = 1;
    d.grenades.push({
      id: 'gi2', owner: 'p0', x: 0, z: 0, y: 0, angle: 0,
      vx: 0, vz: 0, vy: 0, fuse: 0.05, bounces: 2,
    });
    tick(cd, d);
    assert.strictEqual(d.karts[1].deaths, 1, 'corpse never re-KOs');
    assert.strictEqual(d.karts[0].hits, 0, 'corpse blast scores nothing');
    // Offline karts are immune (and the blast still records).
    const [f, cf] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 2, 9502200);
    f.karts.forEach(k=>k.health=1); // Wounded splash/KO contract; full-health acceptance is separate.
    f.karts[0].x = 20; f.karts[0].z = 20;
    f.karts[1].x = 1; f.karts[1].z = 0; f.karts[1].speed = 0; f.karts[1].shield = 0;
    f.grenades.push({
      id: 'gi3', owner: 'p0', x: 0, z: 0, y: 0, angle: 0,
      vx: 0, vz: 0, vy: 0, fuse: 0.05, bounces: 2,
    });
    cf._connected = [{ id: 'p0', name: 'P0' }];
    tick(cf, f);
    assert.strictEqual(f.karts[1].respawn, 0, 'offline kart immune');
    assert.strictEqual(f.karts[0].hits, 0, 'offline blast scores nothing');
    assert(f.events.some((e) => e.type === 'blast'), 'whiffed blast still records');
    cf._connected = null;
    // Cover vetoes radial damage: same-side falls, far-side stands.
    const [b, cb] = racing({ mode: 'Zap Battle', map: 'Bumper Blocks' }, 3, 9502300);
    b.karts.forEach(k=>k.health=1); // Wounded splash/KO contract; full-health acceptance is separate.
    b.karts[0].x = 0; b.karts[0].z = -20; // owner far
    b.karts[1].x = 16; b.karts[1].z = 8; b.karts[1].speed = 0; b.karts[1].shield = 0;
    b.karts[2].x = 16; b.karts[2].z = 20; b.karts[2].speed = 0; b.karts[2].shield = 0;
    b.grenades.push({
      id: 'gi4', owner: 'p0', x: 16, z: 11, y: 0, angle: 0,
      vx: 0, vz: 0, vy: 0, fuse: 0.05, bounces: 2,
    });
    tick(cb, b);
    assert(b.karts[1].respawn > 0, 'same-side victim falls');
    assert.strictEqual(b.karts[2].respawn, 0, 'cover blocks the far side');
    assert.strictEqual(b.karts[0].hits, 1, 'blocked victim scores nothing');
    console.log('WEAPONS ok: splash immunities (owner/shield/dead/offline/cover)');
  }

  // --- 8. flying bodies never score; 12-cap keeps item/shield/cooldown ---
  {
    // Airborne pass straight through a victim tile: no contact KO.
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    const v = st.karts[1];
    st.karts[0].x = 20; st.karts[0].z = 20;
    v.x = 0; v.z = 0; v.speed = 0; v.shield = 0;
    st.grenades.push({
      id: 'gf1', owner: 'p0', x: 0, z: -2, y: 2, angle: 0,
      vx: 0, vz: 22, vy: 0, fuse: 1.4, bounces: 0,
    });
    tick(ctx, st);
    const g = st.grenades[0];
    assert(g.z > -0.5, `body crosses the victim tile, z=${g.z.toFixed(2)}`);
    assert.strictEqual(v.respawn, 0, 'fly-through never KOs');
    assert.strictEqual(st.karts[0].hits, 0, 'fly-through scores nothing');
    assert.strictEqual(st.grenades.length, 1, 'body keeps flying');
    // Grounded roll-through is equally harmless (splash at fuse only).
    const [r, cr] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 2, 9503100);
    r.karts[0].x = 20; r.karts[0].z = 20;
    r.karts[1].x = 0; r.karts[1].z = 0; r.karts[1].speed = 0; r.karts[1].shield = 0;
    r.grenades.push({
      id: 'gf2', owner: 'p0', x: 0, z: -0.5, y: 0, angle: 0,
      vx: 0, vz: 0, vy: 0, fuse: 1.4, bounces: 2,
    });
    tick(cr, r);
    assert.strictEqual(r.karts[1].respawn, 0, 'grounded body never contact-KOs');
    // Cap: the 13th lob is denied and keeps everything.
    const [cap, cctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 2, 9503200);
    const a = cap.karts[0];
    parkFar(cap, ['p0']);
    for (let i = 0; i < 12; i++) {
      cap.grenades.push({
        id: 'gfill' + i, owner: 'p1', x: 20, z: 20, y: 0, angle: 0,
        vx: 0, vz: 0, vy: 0, fuse: 1.4, bounces: 0,
      });
    }
    a.weapon = 'grenade'; a.ammo = 1; a.shield = 2.5; a.fireCd = 0; a.prevAction = false;
    const n = cap.events.length;
    press(cap, cctx, 'p0');
    tick(cctx, cap);
    assert.strictEqual(cap.grenades.length, 12, 'bodies cap at 12');
    assert.strictEqual(a.weapon, 'grenade', 'denied lob keeps the item');
    assert.strictEqual(a.ammo, 1, 'denied lob keeps the ammo');
    assert(a.shield > 2 && a.shield <= 2.5, `denied lob keeps protection, saw ${a.shield}`);
    assert.strictEqual(a.fireCd, 0, 'denied lob arms no cooldown');
    assert.strictEqual(cap.events.length, n, 'denied lob emits nothing');
    console.log('WEAPONS ok: no contact KO (air/ground), 12-cap keep-on-fail');
  }

  // --- 9. EMP Fire: cone from the live pose, one fire + one emp record ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    const [a, b] = st.karts;
    a.weapon = 'emp'; a.ammo = 1; a.shield = 2.5; a.fireCd = 0; a.prevAction = false;
    a.x = 0; a.z = 0; a.angle = 0; a.speed = 0;
    b.x = 0; b.z = 6; b.speed = 0; b.shield = 0; // straight ahead, d=6
    const n = st.events.length;
    press(st, ctx, 'p0');
    tick(ctx, st);
    assert.strictEqual(a.weapon, null, 'discharge spends the item');
    assert.strictEqual(a.ammo, 0, 'discharge spends the round');
    assert.strictEqual(a.shield, 0, 'offensive discharge drops protection');
    assert(a.fireCd > 0, 'discharge arms the cooldown');
    assert.strictEqual(b.empT, C.EMP_TIME, 'cone victim slowed for the full duration');
    assert.strictEqual(b.respawn, 0, 'EMP never KOs');
    assert.strictEqual(a.hits, 0, 'EMP grants no score');
    const fresh = st.events.slice(n);
    const fires = fresh.filter((e) => e.type === 'fire');
    assert.strictEqual(fires.length, 1, 'exactly one fire record');
    assert.strictEqual(fires[0].weapon, 'emp', 'fire carries weapon emp');
    const emps = fresh.filter((e) => e.type === 'emp');
    assert.strictEqual(emps.length, 1, 'one emp record per victim');
    assert.deepStrictEqual(Object.keys(emps[0]).sort(),
      ['angle', 'id', 'other', 'pid', 'type', 'weapon', 'x', 'z'].sort(), 'emp shape');
    assert.strictEqual(emps[0].pid, 'p0', 'emp names the source');
    assert.strictEqual(emps[0].other, 'p1', 'emp names the target');
    assert.strictEqual(emps[0].x, 0, 'emp carries the source origin x');
    assert.strictEqual(emps[0].z, 0, 'emp carries the source origin z');
    assert.strictEqual(emps[0].angle, 0, 'emp carries the source facing');
    // Short press discharges; a spent hold never refires.
    release(st, ctx, 'p0');
    tick(ctx, st);
    a.weapon = 'emp'; a.ammo = 1; a.fireCd = 0;
    press(st, ctx, 'p0');
    release(st, ctx, 'p0');
    tick(ctx, st);
    assert.strictEqual(st.events.slice(n).filter((e) => e.type === 'fire').length, 2,
      'short press discharges');
    // Roster order never changes the duration: a later-roster shooter
    // slowing an earlier-roster victim lands the same full 1.6s.
    const [rv, rc] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 2, 9503500);
    const [v0, s1] = rv.karts;
    s1.weapon = 'emp'; s1.ammo = 1; s1.shield = 0; s1.fireCd = 0; s1.prevAction = false;
    s1.x = 0; s1.z = 0; s1.angle = 0; s1.speed = 0;
    v0.x = 0; v0.z = 6; v0.speed = 0; v0.shield = 0;
    press(rv, rc, 'p1');
    tick(rc, rv);
    assert.strictEqual(v0.empT, C.EMP_TIME, 'reverse-order victim slowed fully');
    console.log('WEAPONS ok: EMP Fire (cone hit, events, short press, no score)');
  }

  // --- 10. EMP cone exclusions: rear/side/edge/range/cover/immunities ---
  {
    let seed = 9504000;
    const fireAt = (ax, az, angle, bx, bz, map = 'Rookie Ring') => {
      seed += 100;
      const [st, ctx] = racing({ mode: 'Zap Battle', map }, 2, seed);
      const [a, b] = st.karts;
      a.weapon = 'emp'; a.ammo = 1; a.shield = 0; a.fireCd = 0; a.prevAction = false;
      a.x = ax; a.z = az; a.angle = angle; a.speed = 0;
      b.x = bx; b.z = bz; b.speed = 0; b.shield = 0;
      press(st, ctx, 'p0');
      tick(ctx, st);
      return [st, ctx];
    };
    {
      const [st] = fireAt(0, 0, 0, 0, -6); // directly behind
      assert.strictEqual(st.karts[1].empT, 0, 'rear victim excluded');
      assert(!st.events.some((e) => e.type === 'emp'), 'rear fires no emp record');
    }
    {
      const [st] = fireAt(0, 0, 0, 6, 0); // 90 degrees off-axis
      assert.strictEqual(st.karts[1].empT, 0, 'side victim excluded');
    }
    { // cone edge: 0.5 rad inside hits, 0.6 rad outside misses (half-angle 0.55)
      const [hit] = fireAt(0, 0, 0, 6 * Math.sin(0.5), 6 * Math.cos(0.5));
      assert.strictEqual(hit.karts[1].empT, C.EMP_TIME, '0.5rad inside the cone');
      const [miss] = fireAt(0, 0, 0, 6 * Math.sin(0.6), 6 * Math.cos(0.6));
      assert.strictEqual(miss.karts[1].empT, 0, '0.6rad outside the cone');
    }
    { // range: d=11 inside, d=13 outside (range 12), same discharge
      const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 3, 9504100);
      const [a, near, far] = st.karts;
      a.weapon = 'emp'; a.ammo = 1; a.shield = 0; a.fireCd = 0; a.prevAction = false;
      a.x = 0; a.z = 0; a.angle = 0; a.speed = 0;
      near.x = 0; near.z = 11; near.speed = 0; near.shield = 0;
      far.x = 0; far.z = 13; far.speed = 0; far.shield = 0;
      press(st, ctx, 'p0');
      tick(ctx, st);
      assert.strictEqual(near.empT, C.EMP_TIME, 'd=11 inside the range');
      assert.strictEqual(far.empT, 0, 'd=13 outside the range');
      assert.strictEqual(st.events.filter((e) => e.type === 'emp').length, 1,
        'only the inside victim records');
    }
    { // cover: same cone, one lane blocked by the (16,16) block
      const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Bumper Blocks' }, 3, 9504200);
      const [a, open, shut] = st.karts;
      a.weapon = 'emp'; a.ammo = 1; a.shield = 0; a.fireCd = 0; a.prevAction = false;
      a.x = 0; a.z = 8; a.angle = 0; a.speed = 0;
      open.x = 0; open.z = 19; open.speed = 0; open.shield = 0; // d=11, open lane
      shut.x = 16; shut.z = 19; shut.speed = 0; shut.shield = 0;
      a.x = 16; a.z = 8; // re-aim down the blocked lane for the second victim
      open.x = -20; open.z = -20; // park the control far away
      press(st, ctx, 'p0');
      tick(ctx, st);
      assert.strictEqual(shut.empT, 0, 'cover vetoes the cone');
      assert.strictEqual(a.hits, 0, 'blocked discharge scores nothing');
      const [st2, ctx2] = racing({ mode: 'Zap Battle', map: 'Bumper Blocks' }, 2, 9504300);
      st2.karts[0].weapon = 'emp'; st2.karts[0].ammo = 1;
      st2.karts[0].shield = 0; st2.karts[0].fireCd = 0; st2.karts[0].prevAction = false;
      st2.karts[0].x = 0; st2.karts[0].z = 8; st2.karts[0].angle = 0; st2.karts[0].speed = 0;
      st2.karts[1].x = 0; st2.karts[1].z = 19; st2.karts[1].speed = 0; st2.karts[1].shield = 0;
      press(st2, ctx2, 'p0');
      tick(ctx2, st2);
      assert.strictEqual(st2.karts[1].empT, C.EMP_TIME, 'open lane slows on a cover map');
    }
    { // owner/shield/dead/offline immune — stacked point-blank included
      const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 3, 9504400);
      const [a, b, c] = st.karts;
      a.weapon = 'emp'; a.ammo = 1; a.shield = 0; a.fireCd = 0; a.prevAction = false;
      a.x = 0; a.z = 0; a.angle = 0; a.speed = 0;
      b.x = 0; b.z = 0; b.speed = 0; b.shield = 2; // stacked but shielded
      c.x = 0; c.z = 2; c.speed = 0; c.shield = 0; // clean, stacked lane
      press(st, ctx, 'p0');
      tick(ctx, st);
      assert.strictEqual(a.empT, 0, 'owner immune');
      assert.strictEqual(b.empT, 0, 'shield immune point-blank');
      assert.strictEqual(c.empT, C.EMP_TIME, 'clean kart in the cone slows');
      // Dead + offline victims: same discharge, excluded.
      const [st2, ctx2] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 3, 9504500);
      const [a2, b2, c2] = st2.karts;
      a2.weapon = 'emp'; a2.ammo = 1; a2.shield = 0; a2.fireCd = 0; a2.prevAction = false;
      a2.x = 0; a2.z = 0; a2.angle = 0; a2.speed = 0;
      b2.x = 0; b2.z = 4; b2.respawn = 1.5; b2.deaths = 1;
      c2.x = 0; c2.z = 5; c2.speed = 0; c2.shield = 0;
      ctx2._connected = [{ id: 'p0', name: 'P0' }, { id: 'p1', name: 'P1' }];
      press(st2, ctx2, 'p0');
      tick(ctx2, st2);
      assert.strictEqual(b2.empT, 0, 'dead victim excluded');
      assert.strictEqual(c2.empT, 0, 'offline victim excluded');
      assert(!st2.events.some((e) => e.type === 'emp'), 'excluded victims record nothing');
      assert(st2.events.some((e) => e.type === 'fire' && e.weapon === 'emp'),
        'the discharge itself still records');
      ctx2._connected = null;
    }
    console.log('WEAPONS ok: EMP cone (rear/side/edge/range/cover/immunities)');
  }

  // --- 11. EMP slow: fixed duration, refresh-never-stack, honest motion ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    const [a, b] = st.karts;
    a.weapon = 'emp'; a.ammo = 1; a.shield = 0; a.fireCd = 0; a.prevAction = false;
    a.x = 0; a.z = -6; a.angle = 0; a.speed = 0;
    b.x = 0; b.z = 0; b.speed = 0; b.shield = 0;
    press(st, ctx, 'p0');
    tick(ctx, st);
    assert.strictEqual(b.empT, 1.6, 'slow lands at the full 1.6s');
    // Immediate re-zap refreshes instead of stacking past the fixed max.
    a.weapon = 'emp'; a.ammo = 1; a.fireCd = 0; a.prevAction = false;
    release(st, ctx, 'p0');
    tick(ctx, st); // empT 1.6 -> 1.5
    assert(b.empT > 1.4 && b.empT < 1.6, `slow ticks down, saw ${b.empT}`);
    press(st, ctx, 'p0');
    tick(ctx, st); // refresh back to exactly the max, never 1.5+1.6
    assert.strictEqual(b.empT, 1.6, 're-zap refreshes, never stacks');
    // Motion while slowed: accel/top/turn scaled, steering still live.
    b.x = 0; b.z = -20; b.angle = 0; b.speed = 0;
    karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 1 } });
    tick(ctx, st);
    approx(b.speed, engine.constants.ACCEL * 0.6 * 0.1, 0.05, 'slowed accel x0.6');
    assert(b.speed > 0.5, 'slowed kart still moves (playable)');
    b.speed = engine.constants.MAX_SPEED; b.empT = 1.6;
    karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 1 } });
    tick(ctx, st);
    approx(b.speed, engine.constants.MAX_SPEED * 0.62, 1e-9, 'slowed top clamps x0.62');
    // Turn: slowed yaw is exactly x0.75 of clean yaw on identical inputs.
    const yaw = (emp) => {
      const [s, c] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 2, 9505000 + (emp ? 7 : 0));
      const k = s.karts[0];
      parkFar(s, ['p0']);
      k.x = 0; k.z = -20; k.angle = 0; k.speed = 10; k.empT = emp ? 1.6 : 0;
      karts.onAction(s, c, 'p0', { input: { steer: 1, throttle: 0 } });
      tick(c, s);
      if (emp) k.empT = 1.6;
      return k.angle;
    };
    const clean = yaw(false);
    const slow = yaw(true);
    assert(clean < 0 && slow < 0, 'both yaw toward screen right');
    approx(slow / clean, 0.75, 0.001, 'slowed turn x0.75');
    // Duration: slowed past 0.8s, clean after 1.7s, no permafreeze.
    for (let i = 0; i < 8; i++) tick(ctx, st);
    assert(b.empT > 0, 'still slowed at ~0.8s');
    for (let i = 0; i < 9; i++) tick(ctx, st);
    assert.strictEqual(b.empT, 0, 'clean after the fixed duration');
    const v = karts.view(st, 'p1').karts.find((k) => k.pid === 'p1');
    assert.strictEqual(v.slowed, false, 'view reports clean');
    console.log('WEAPONS ok: EMP slow (1.6s refresh-only, x0.62/x0.6/x0.75, playable)');
  }

  // --- 12. EMP + nitro: capped relative boost, deterministic charge ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    const k = st.karts[0];
    parkFar(st, ['p0']);
    k.x = 0; k.z = -20; k.angle = 0; k.speed = 20; k.empT = 1.6;
    k.nitro = 1; k.nitroLocked = false;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1, nitro: true } });
    tick(ctx, st);
    assert(k.speed < engine.constants.MAX_SPEED, `nitro cannot bypass the slowed cap, saw ${k.speed}`);
    approx(k.speed, engine.constants.MAX_SPEED * engine.constants.NITRO_SPEED * 0.62, 0.05, 'slowed+nitro top = 1.5x of slowed');
    assert(k.nitro < 1, 'charge still drains deterministically while slowed');
    assert.strictEqual(k.nitroActive, true, 'nitro still engages while slowed');
    // Control: clean + nitro DOES pass cruise (nitro itself is untouched).
    const [c2, x2] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 2, 9505100);
    const j = c2.karts[0];
    parkFar(c2, ['p0']);
    j.x = 0; j.z = -20; j.angle = 0; j.speed = 20; j.empT = 0;
    j.nitro = 1; j.nitroLocked = false;
    karts.onAction(c2, x2, 'p0', { input: { steer: 0, throttle: 1, nitro: true } });
    tick(x2, c2);
    assert(j.speed > 14, `clean nitro passes cruise, saw ${j.speed}`);
    console.log('WEAPONS ok: EMP+nitro (capped boost, deterministic charge)');
  }

  // --- 13. engine/pose parity under slow (classic + garage tuning) ---
  {
    for (const key of ['EMP_TOP_SCALE', 'EMP_ACCEL_SCALE', 'EMP_TURN_SCALE']) {
      assert.strictEqual(pose[key], engine.constants[key], `pose/engine ${key} agree`);
    }
    const roll = (garage) => {
      const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring', garage }, 2, garage ? 9506100 : 9506000);
      const k = st.karts[0];
      parkFar(st, ['p0']);
      k.x = 0; k.z = -20; k.angle = 0.3; k.speed = 10; k.slip = 0;
      k.boost = 0; k.boostCd = 0; k.turbo = 0; k.padCd = 0;
      k.drifting = false; k.driftCharge = 0;
      k.nitro = 1; k.nitroActive = false; k.nitroLocked = false; k.empT = 1.6;
      const p = {
        x: 0, z: -20, angle: 0.3, speed: 10, slip: 0, boost: 0, boostCd: 0,
        turbo: 0, padCd: 0, driftCharge: 0, drifting: false,
        nitro: 1, nitroActive: false, nitroLocked: false, empT: 1.6,
      };
      if (garage) {
        k.upgrades = { engine: 3, handling: 2, reload: 0 };
        p.tuning = { top: 1.15, accel: 1.15, turn: 1.08 };
      }
      const geo = { allowBoost: false, blocks: st.blocks, pads: st.pads, surfaces: st.surfaces, bound: st.bound };
      const script = [
        { steer: 0.5, throttle: 1, boost: false, nitro: true },
        { steer: 1, throttle: 1, boost: false, drift: true },
        { steer: 1, throttle: 1, boost: false, drift: true },
        { steer: 0, throttle: 1, boost: false, nitro: true },
        { steer: -0.5, throttle: 0.5, boost: false },
        { steer: 0, throttle: -1, boost: false },
      ];
      for (const intent of script) {
        karts.onAction(st, ctx, 'p0', { input: intent });
        tick(ctx, st);
        k.empT = 1.6; // hold the slow (server ticks post-motion; pose holds constant)
        pose.stepSelf(p, intent, 0.1, geo);
        for (const f of ['x', 'z', 'angle', 'speed', 'slip', 'turbo', 'padCd',
          'driftCharge', 'drifting', 'nitro', 'nitroActive', 'nitroLocked']) {
          assert.strictEqual(p[f], k[f], `${garage ? 'garage' : 'classic'} slowed ${f} matches`);
        }
        assert.strictEqual(p.empT, 1.6, 'pose never ticks empT');
      }
    };
    roll(false);
    roll(true);
    // Reconcile adopts the slow authoritatively (create + update).
    const store = pose.createPoseStore();
    const snap = (over) => ({
      phase: 'drive',
      karts: [{ pid: 'p0', x: 0, z: 0, angle: 0, speed: 5, slip: 0, boost: 0, boostCd: 0, empT: 1.2, ...over }],
    });
    pose.ingestSnapshot(store, snap(), 'p0', 1000);
    assert.strictEqual(store.self.empT, 1.2, 'first sight adopts empT');
    pose.ingestSnapshot(store, snap({ empT: 0 }), 'p0', 1100);
    assert.strictEqual(store.self.empT, 0, 'recovery adopts clean');
    console.log('WEAPONS ok: slowed parity (constants, rollout classic+garage, resnapshot)');
  }

  // --- 14. slow lifecycle: countdown/done/disconnect freeze, TTL ticks, KO/respawn/rematch clear ---
  {
    // Countdown: neither the slow nor grenade fuses tick.
    const players = mkPlayers(2);
    const ctx = stubCtx({ players, settings: { mode: 'Zap Battle', map: 'Rookie Ring' }, now: 4000000 });
    const pre = karts.create(ctx);
    pre.karts[0].empT = 1.6;
    pre.grenades.push({
      id: 'gl', owner: 'p0', x: 0, z: -10, y: 1, angle: 0,
      vx: 0, vz: 22, vy: 8, fuse: 1.4, bounces: 0,
    });
    ctx._now += 100;
    karts.onTick(pre, ctx);
    assert.strictEqual(pre.phase, 'countdown', 'still counting down');
    assert.strictEqual(pre.karts[0].empT, 1.6, 'countdown freezes the slow');
    assert.strictEqual(pre.grenades[0].fuse, 1.4, 'countdown freezes fuses');
    assert.strictEqual(pre.grenades[0].z, -10, 'countdown freezes bodies');
    // Done: same freeze past the results.
    const [dn, dc] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 2, 9507000);
    dc._now = dn.endsAt + 1;
    tick(dc, dn);
    assert.strictEqual(dn.phase, 'done', 'timeout finishes');
    dn.karts[0].empT = 1.6;
    dn.grenades.push({
      id: 'gd', owner: 'p0', x: 0, z: 0, y: 0, angle: 0,
      vx: 0, vz: 0, vy: 0, fuse: 0.05, bounces: 2,
    });
    tick(dc, dn);
    assert.strictEqual(dn.karts[0].empT, 1.6, 'done freezes the slow');
    assert.strictEqual(dn.grenades.length, 1, 'done freezes fuses');
    // Disconnect freezes the victim timer; rejoin resumes it.
    const [of, oc] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 2, 9507100);
    of.karts[1].empT = 1.6;
    of.karts[1].x = 5; of.karts[1].z = 5;
    oc._connected = [{ id: 'p0', name: 'P0' }];
    for (let i = 0; i < 5; i++) tick(oc, of);
    assert.strictEqual(of.karts[1].empT, 1.6, 'offline slow never ticks');
    assert.strictEqual(of.karts[1].x, 5, 'offline kart frozen');
    oc._connected = null;
    karts.onAction(of, oc, 'p1', { input: { steer: 0, throttle: 0 } });
    tick(oc, of);
    assert(of.karts[1].empT < 1.6, 'rejoin resumes the countdown');
    // TTL silence wipes input but the connected timer keeps ticking (like shield).
    const [tt, tc] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 2, 9507200);
    tt.karts[1].empT = 1.6;
    tt.karts[1].lastInputAt = tc._now - 1600;
    tick(tc, tt);
    assert.deepStrictEqual(tt.karts[1].input, { steer: 0, throttle: 0, boost: false }, 'TTL wipes input');
    assert(tt.karts[1].empT < 1.6, 'TTL keeps the connected timer ticking');
    // KO clears; the rejoin is clean with a fresh shield.
    const [ko, kc] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 2, 9507300);
    const [s, vic] = ko.karts;
    vic.health=1; // Wounded KO isolates EMP cleanup and protected respawn.
    s.weapon = 'emp'; s.ammo = 1; s.shield = 0; s.fireCd = 0; s.prevAction = false;
    s.x = 0; s.z = -6; s.angle = 0; s.speed = 0;
    vic.x = 0; vic.z = 0; vic.speed = 0; vic.shield = 0;
    press(ko, kc, 'p0');
    tick(kc, ko);
    assert.strictEqual(vic.empT, 1.6, 'victim slowed first');
    s.weapon = 'pulse'; s.ammo = 3; s.fireCd = 0; s.prevAction = false;
    release(ko, kc, 'p0');
    tick(kc, ko);
    press(ko, kc, 'p0');
    for (let i = 0; i < 6 && vic.respawn <= 0; i++) tick(kc, ko);
    assert(vic.respawn > 0, 'victim KO’d');
    assert.strictEqual(vic.empT, 0, 'KO clears the slow');
    for (let i = 0; i < 25 && vic.respawn > 0; i++) tick(kc, ko);
    assert.strictEqual(vic.respawn, 0, 'victim rejoins');
    assert.strictEqual(vic.empT, 0, 'rejoin stays clean');
    assert(vic.shield > 0, 'rejoin still protected');
    // Rematch: fresh instances clear slows, bodies, and tallies.
    const fresh = karts.create(stubCtx({
      players: mkPlayers(2), settings: { mode: 'Zap Battle', map: 'Rookie Ring' }, now: 9507400,
    }));
    assert.deepStrictEqual(fresh.grenades, [], 'rematch clears bodies');
    assert(fresh.karts.every((k) => k.empT === 0), 'rematch clears slows');
    console.log('WEAPONS ok: lifecycle (countdown/done/offline freeze, TTL, KO/rejoin/rematch)');
  }

  // --- 15. pickup pool: all 8 in both modes, published weights, sum 1 ---
  {
    const sum = Object.values(C.WEAPON_WEIGHTS).reduce((a, b) => a + b, 0);
    assert(Math.abs(sum - 1) < 1e-9, `weights sum to 1, saw ${sum}`);
    assert.deepStrictEqual(Object.keys(C.WEAPON_WEIGHTS).sort(),
      ['emp', 'grenade', 'mine', 'pulse', 'rail', 'rocket', 'scatter', 'shield'], 'eight items');
    assert.deepStrictEqual(C.WEAPON_WEIGHTS, {
      pulse: 0.20, scatter: 0.16, mine: 0.13, shield: 0.14,
      rocket: 0.11, rail: 0.08, grenade: 0.10, emp: 0.08,
    }, 'published weights (stronger lethal rarer)');
    for (const garage of [false, true]) {
      const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring', garage }, 2, garage ? 9600000 : 9510000);
      const k = st.karts[0];
      parkFar(st, ['p0']);
      const seen = {};
      const N = 2000;
      for (let i = 0; i < N; i++) {
        const crate = st.crates[i % st.crates.length];
        k.x = crate.x; k.z = crate.z; k.speed = 0;
        k.weapon = null; // force an empty slot every round
        tick(ctx, st);
        if (k.weapon) seen[k.weapon] = (seen[k.weapon] || 0) + 1;
      }
      for (const w of Object.keys(C.WEAPON_WEIGHTS)) {
        assert((seen[w] || 0) >= 50, `${garage ? 'garage' : 'classic'} rolls ${w} (${seen[w] || 0})`);
        approx((seen[w] || 0) / N, C.WEAPON_WEIGHTS[w], 0.04, `${garage ? 'garage' : 'classic'} ${w} share`);
      }
    }
    console.log('WEAPONS ok: 8-item pool (classic+garage, weights, sum 1)');
  }

  // --- 16. no injection; malformed fixtures bounded; missing array safe ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    const a = st.karts[0];
    parkFar(st, ['p0']);
    const ax = a.x;
    karts.onAction(st, ctx, 'p0', {
      input: { steer: 0, throttle: 0 },
      x: 999, z: -999, empT: 99, slowed: true, weapon: 'grenade', ammo: 5,
      fuse: 0, grenades: [{ id: 'evil', fuse: 0 }], vx: 99, vy: 99,
    });
    assert.strictEqual(a.x, ax, 'coordinate smuggling ignored');
    assert.strictEqual(a.empT, 0, 'empT smuggling ignored');
    assert.strictEqual(a.weapon, null, 'weapon smuggling ignored');
    assert.strictEqual(st.grenades.length, 0, 'body smuggling spawns nothing');
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true, empT: true } });
    tick(ctx, st);
    assert.strictEqual(a.empT, 0, 'intent-field smuggling slows nothing');
    assert(!st.events.some((e) => e.type === 'emp'), 'smuggled edge slows nobody');
    // Malformed bodies + timers: bounded, never throwing.
    const [m, mc] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 2, 9508000);
    parkFar(m, []);
    m.grenades.push(null, 'junk', { owner: 'p0' }, {
      id: 'mbad', owner: 'p1', x: 9999, z: -9999, y: -5, angle: NaN,
      vx: 1e9, vz: -1e9, vy: 1e9, fuse: 99, bounces: 99,
    });
    m.karts[0].empT = NaN;
    m.karts[1].empT = 999;
    tick(mc, m);
    assert.strictEqual(m.grenades.length, 2, 'non-objects dropped, partials kept');
    for (const g of m.grenades) {
      assert(Number.isFinite(g.x) && Number.isFinite(g.z) && Number.isFinite(g.y), 'positions finite');
      assert(Math.abs(g.x) <= m.bound + 1 && Math.abs(g.z) <= m.bound + 1, 'positions in-arena');
      assert(g.y >= 0 && g.y <= C.GRENADE_YMAX, 'height bounded');
      assert(Math.abs(g.vx) <= C.GRENADE_VMAX && Math.abs(g.vy) <= C.GRENADE_VMAX, 'velocities capped');
      assert(g.fuse >= 0 && g.fuse <= C.GRENADE_FUSE, 'fuse within one fresh fuse');
      assert(g.bounces >= 0 && g.bounces <= C.GRENADE_MAX_BOUNCES, 'bounces in budget');
    }
    assert.strictEqual(m.karts[0].empT, 0, 'NaN slow reads clean');
    assert(m.karts[1].empT <= C.EMP_TIME, 'huge slow clamps to one slow');
    // Missing array (old fixture): firing recreates it, ticking tolerates it.
    const [o, oc] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 2, 9508100);
    delete o.grenades;
    tick(oc, o);
    assert.deepStrictEqual(o.grenades, [], 'tick recreates a missing array');
    delete o.grenades;
    o.karts[0].weapon = 'grenade'; o.karts[0].ammo = 1;
    o.karts[0].shield = 0; o.karts[0].fireCd = 0; o.karts[0].prevAction = false;
    press(o, oc, 'p0');
    tick(oc, o);
    assert.strictEqual(o.grenades.length, 1, 'fire recreates a missing array');
    console.log('WEAPONS ok: no injection, malformed bounded, missing array safe');
  }

  // --- 17. transport: grenade projection, empT/slowed, flight lead ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    const [a, b] = st.karts;
    a.weapon = 'grenade'; a.ammo = 1; a.shield = 0; a.fireCd = 0; a.prevAction = false;
    a.x = 0; a.z = -20; a.angle = 0; a.speed = 0;
    b.x = 20; b.z = 20; b.empT = 1.0;
    press(st, ctx, 'p0');
    tick(ctx, st);
    const v = karts.view(st, 'p0');
    assert(Array.isArray(v.grenades) && v.grenades.length === 1, 'view carries grenades');
    assert.deepStrictEqual(Object.keys(v.grenades[0]).sort(),
      ['angle', 'fuse', 'id', 'owner', 'ttl', 'vx', 'vy', 'vz', 'warning', 'x', 'y', 'z'].sort(),
      'grenade projection shape');
    for (const f of ['x', 'z', 'y', 'angle', 'vx', 'vz', 'vy', 'fuse', 'ttl']) {
      assert.strictEqual(typeof v.grenades[0][f], 'number', `grenade.${f} numeric`);
      assert(Number.isFinite(v.grenades[0][f]), `grenade.${f} finite`);
    }
    assert.strictEqual(typeof v.grenades[0].warning, 'boolean', 'warning boolean');
    const kb = v.karts.find((k) => k.pid === 'p1');
    assert.strictEqual(typeof kb.empT, 'number', 'kart view carries empT');
    assert(kb.empT > 0 && kb.empT <= C.EMP_TIME, 'empT honest while slowed');
    assert.strictEqual(kb.slowed, true, 'kart view carries slowed:true');
    assert(!('input' in kb) && !('pendingFire' in kb) && !('empFresh' in kb), 'no input/edge leak');
    JSON.parse(JSON.stringify(v)); // plain wire JSON throughout
    // Cosmetic flight lead: gravity arc, floor clamp, fuse visibility.
    assert.strictEqual(flight.GRENADE_GRAVITY, C.GRENADE_GRAVITY, 'flight gravity mirrors authority');
    const g = { x: 0, z: 0, y: 1, vx: 0, vz: 22, vy: 8, fuse: 1.4, warning: false };
    const snap = { simAt: 10000, map: { bound: 28 } };
    const p0 = flight.grenadePose(g, snap, 10100); // 0.1s lead
    approx(p0.z, 2.2, 1e-9, 'lead tracks planar velocity');
    approx(p0.y, 1 + 0.8 - 15 * 0.01, 1e-9, 'lead arcs under gravity');
    assert.strictEqual(p0.warning, false, 'lead passes warning through');
    assert.strictEqual(p0.visible, true, 'live fuse renders');
    const old = flight.grenadePose(g, snap, 10400); // stale packet
    assert.strictEqual(old.visible, false, 'stale lead expires');
    const floor = flight.grenadePose({ ...g, y: 0.01, vy: -8 }, snap, 10100);
    assert.strictEqual(floor.y, 0, 'lead clamps to the floor');
    const warn = flight.grenadePose({ ...g, fuse: 0.4, warning: true }, snap, 10100);
    assert.strictEqual(warn.warning, true, 'warning flag survives the lead');
    console.log('WEAPONS ok: transport (grenade/empT shapes, flight lead)');
  }

  console.log('KART_EXPANDED_WEAPONS_PASS');
}

main().then(() => {}, (e) => { console.error(e); process.exit(1); });
