// Planar-mutating unit fixtures use an explicit generic variant, not physical Pocket.
'use strict';
/* Kart battle-loop regression: the real timed FFA knockout loop on the
 * shared engine — random validated crate layout/recycling, one item slot,
 * all four weapons, KO/respawn/protection, disconnect freeze, same-tick
 * single-KO resolution, large-arena bounds + prediction parity, win-rule
 * and shared-sunset metadata, and rematch lifecycle resets.
 * Run: node test/kart-battle-loop.js */

const assert = require('assert');

const karts = require('./fixtures/kart-planar-variant.cjs');
const battle = require('../games/engines/kart-rules-battle');

const POSE_URL = '../public/js/games/pocket-karts-pose.mjs';

function stubCtx({ players, settings, now }) {
  const ctx = {
    _now: now !== undefined ? now : 3000000,
    _broadcasts: 0,
    _awards: {},
    _connected: null,
    players() { return (this._connected || players).slice(); },
    allPlayers: () => players.slice(),
    content: () => ({}),
    settings: () => ({ ...(settings || {}) }),
    hostId: () => players[0].id,
    broadcast() { ctx._broadcasts += 1; },
    lobby() {},
    later: () => () => {},
    award(pid, pts) { ctx._awards[pid] = (ctx._awards[pid] || 0) + pts; },
    now: () => ctx._now,
  };
  return ctx;
}

function mkPlayers(n) {
  return Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
}

function racing(settings, n = 2, now = 3000000) {
  const players = mkPlayers(n);
  const ctx = stubCtx({ players, settings, now });
  const st = karts.create(ctx);
  ctx._now += 3000;
  karts.onTick(st, ctx);
  assert.strictEqual(st.phase, 'drive', 'countdown reaches drive');
  return [st, ctx];
}

function tick(ctx, st, ms = 100) {
  ctx._now += ms;
  karts.onTick(st, ctx);
}

function parkFar(st, except = []) {
  // Spread non-test karts to far corners (inside the actual bound) so
  // they never interfere with the fixture under test.
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

function crateIds(st) {
  return st.crates.map((c) => c.id);
}

function minCrateGap(st) {
  let m = Infinity;
  for (let i = 0; i < st.crates.length; i++) {
    for (let j = i + 1; j < st.crates.length; j++) {
      m = Math.min(m, Math.hypot(st.crates[i].x - st.crates[j].x, st.crates[i].z - st.crates[j].z));
    }
  }
  return m;
}

async function main() {
  const pose = await import(POSE_URL);

  // --- 1. arena scale, spawn allocation, crate population ---
  {
    const [st] = racing({ mode: 'Zap Battle', map: 'Garden Circuit' });
    assert.strictEqual(st.half, 60, 'garden half');
    assert.strictEqual(st.bound, 58, 'garden bound');
    assert.strictEqual(st.spawns.length, 10, 'garden spawn pool');
    const [a, b] = st.karts;
    assert.deepStrictEqual([a.x, a.z], [st.spawns[0].x, st.spawns[0].z], 'p0 takes pool slot 0');
    assert.deepStrictEqual([b.x, b.z], [st.spawns[1].x, st.spawns[1].z], 'p1 takes pool slot 1');
    const d01 = Math.hypot(a.x - b.x, a.z - b.z);
    assert(d01 < 45, `opening pair meets fast (d=${d01.toFixed(1)})`);
    for (const k of st.karts) {
      assert.strictEqual(k.weapon, null, 'spawn unarmed');
      assert.strictEqual(k.ammo, 0, 'spawn without ammo');
      assert.strictEqual(k.shield, 2.5, 'spawn shielded');
      assert.strictEqual(k.spawnSeq, 0, 'spawn epoch zero');
    }
    const [ring] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    assert.strictEqual(ring.half, 30, 'ring keeps legacy half');
    assert.strictEqual(ring.bound, 28, 'ring keeps legacy bound');
    for (const [n, want] of [[2, 6], [3, 7], [6, 10], [8, 10]]) {
      const [s] = racing({ mode: 'Zap Battle', map: 'Garden Circuit' }, n);
      assert.strictEqual(s.crates.length, want, `clamp(4+${n}) crates`);
      assert.strictEqual(new Set(crateIds(s)).size, want, 'crate ids unique');
    }
    console.log('BATTLE ok: scale, pool allocation, crate population');
  }

  // --- 2. seeded layout: deterministic, varying, spaced, unique ids ---
  {
    const mk = (now) => {
      const players = mkPlayers(2);
      const ctx = stubCtx({ players, settings: { mode: 'Zap Battle', map: 'Garden Circuit' }, now });
      return karts.create(ctx);
    };
    const s1 = mk(1000000);
    const s2 = mk(1000000);
    assert.deepStrictEqual(s1.crates, s2.crates, 'same (now, roster) reruns the layout');
    const s3 = mk(2000000);
    assert.notStrictEqual(JSON.stringify(s1.crates), JSON.stringify(s3.crates), 'matches vary');
    assert.notStrictEqual(s1.rngState, s3.rngState, 'RNG state advances per match');
    assert(minCrateGap(s1) >= 8 - 1e-9, `large-map crates spread, gap=${minCrateGap(s1).toFixed(2)}`);
    const [ring] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    assert(minCrateGap(ring) >= 5 - 1e-9, `compact crates spread, gap=${minCrateGap(ring).toFixed(2)}`);
    // Crates start away from live karts.
    for (const c of s1.crates) {
      for (const k of s1.karts) {
        assert(Math.hypot(c.x - k.x, c.z - k.z) >= 5 - 1e-9, 'crate starts clear of karts');
      }
    }
    console.log('BATTLE ok: seeded random layout (deterministic, varying, spaced)');
  }

  // --- 3. recycle: new id, new spot, stable count, no same-spot reuse ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Garden Circuit' });
    const a = st.karts[0];
    parkFar(st, ['p0']);
    const crate = st.crates[0];
    const oldId = crate.id;
    const oldSpot = { x: crate.x, z: crate.z };
    a.x = crate.x; a.z = crate.z; a.speed = 0;
    tick(ctx, st);
    assert(a.weapon, 'empty slot collects');
    assert.strictEqual(st.crates.length, 6, 'count stable across recycle');
    assert.strictEqual(new Set(crateIds(st)).size, 6, 'ids stay unique');
    assert(!crateIds(st).includes(oldId), 'consumed id retires');
    assert.notStrictEqual(crate.id, oldId, 'relocated crate carries a new id');
    assert(Math.hypot(crate.x - oldSpot.x, crate.z - oldSpot.z) > 0.01, 'never the consumed spot');
    console.log('BATTLE ok: crate recycle (new id, new spot, stable count)');
  }

  // --- 4. slot: no farm while parked, no replace while loaded ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Garden Circuit' });
    const a = st.karts[0];
    parkFar(st, ['p0']);
    a.weapon = 'pulse'; a.ammo = 2; a.shield = 0;
    const crate = st.crates[0];
    crate.x = a.x; crate.z = a.z;
    const cid = crate.id;
    for (let i = 0; i < 20; i++) {
      if (i % 5 === 0) karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0 } });
      tick(ctx, st);
    }
    assert.strictEqual(a.weapon, 'pulse', 'parked kart keeps its item');
    assert.strictEqual(a.ammo, 2, 'parked kart farms nothing');
    assert.strictEqual(crate.id, cid, 'crate never consumed by a loaded kart');
    assert.strictEqual(crate.x, a.x, 'crate stays put under a loaded kart');
    console.log('BATTLE ok: one slot (no farm, no replace)');
  }

  // --- 5. competing pickups resolve once, in roster order ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Garden Circuit' });
    const [a, b] = st.karts;
    const crate = st.crates[0];
    a.x = crate.x; a.z = crate.z; a.speed = 0;
    b.x = crate.x; b.z = crate.z; b.speed = 0;
    const before = st.events.length;
    tick(ctx, st);
    assert(a.weapon, 'roster-first kart claims the crate');
    assert.strictEqual(b.weapon, null, 'roster-second kart gets nothing');
    assert.strictEqual(b.ammo, 0, 'no double award');
    const pickups = st.events.slice(before).filter((e) => e.type === 'pickup');
    assert.strictEqual(pickups.length, 1, 'exactly one pickup event');
    assert.strictEqual(pickups[0].pid, 'p0', 'first claimer recorded');
    console.log('BATTLE ok: deterministic single-claim pickups');
  }

  // --- 7. scatter: one fan of three, spread angles ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    const a = st.karts[0];
    parkFar(st, ['p0']);
    a.weapon = 'scatter'; a.ammo = 1; a.shield = 0; a.fireCd = 0; a.prevAction = false;
    a.x = 0; a.z = -20; a.angle = 0.5; a.speed = 0;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
    tick(ctx, st);
    assert.strictEqual(st.zaps.length, 3, 'one press launches the fan');
    const angles = st.zaps.map((z) => z.angle).sort((x, y) => x - y);
    for (const [i, off] of [-0.22, 0, 0.22].entries()) {
      assert(Math.abs(angles[i] - (0.5 + off)) < 1e-9, `pellet ${i} spreads ${off}`);
    }
    assert(st.zaps.every((z) => z.kind === 'scatter'), 'pellets carry scatter kind');
    assert.strictEqual(a.weapon, null, 'fan spends the item');
    console.log('BATTLE ok: scatter fan (3 pellets, spread, one use)');
  }

  // --- 8. mines: drop, arm delay, trigger, owner immunity, expiry, cap ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    st.karts.forEach(k=>k.health=1); // Wounded KO/settlement fixture; full-health acceptance is separate.
    const [a, b] = st.karts;
    for (const c of st.crates) { c.x = 24; c.z = -24; } // fixtures drive pickups, not luck
    a.weapon = 'mine'; a.ammo = 1; a.shield = 0; a.fireCd = 0; a.prevAction = false;
    a.x = 0; a.z = 0; a.angle = 0; a.speed = 0;
    b.shield = 0; b.x = 0; b.z = -8; b.angle = 0; b.speed = 10;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
    tick(ctx, st);
    assert.strictEqual(st.mines.length, 1, 'press drops one mine');
    const mine = st.mines[0];
    assert.deepStrictEqual([mine.x, mine.z], [0, -2], 'mine lands behind the kart');
    assert.strictEqual(mine.armed, false, 'mine starts unarmed');
    assert.strictEqual(a.weapon, null, 'drop spends the item');
    // Park the owner far: kart contact would otherwise slow the crossing
    // and leave the victim inside the blast radius when the mine arms.
    a.x = 20; a.z = 20; a.speed = 0;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0 } });
    // The victim crosses the unarmed mine: no trigger.
    karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 1 } });
    for (let i = 0; i < 5; i++) tick(ctx, st);
    assert(b.z > -2, 'victim crossed the mine line');
    assert.strictEqual(st.mines[0].armed, false, 'mine still arming during the pass');
    assert.strictEqual(a.hits, 0, 'unarmed mine never triggers');
    assert.strictEqual(st.mines.length, 1, 'mine survives the early pass');
    for (let i = 0; i < 3; i++) tick(ctx, st);
    assert.strictEqual(st.mines[0].armed, true, 'mine arms after 0.7 s');
    // Armed: the next vulnerable crossing KOs and consumes the mine.
    b.x = 0; b.z = -2; b.speed = 0; b.shield = 0;
    karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 0 } });
    tick(ctx, st);
    assert.strictEqual(a.hits, 1, 'armed mine KOs');
    assert.strictEqual(st.mines.length, 0, 'trigger consumes the mine');
    // Owner immunity: the owner parks on their own armed mine safely.
    a.weapon = 'mine'; a.ammo = 1; a.fireCd = 0; a.prevAction = false;
    a.x = 10; a.z = 10; a.angle = 0; a.speed = 0;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
    tick(ctx, st);
    for (let i = 0; i < 8; i++) tick(ctx, st);
    assert.strictEqual(st.mines[0].armed, true, 'second mine arms');
    a.x = st.mines[0].x; a.z = st.mines[0].z;
    tick(ctx, st);
    assert.strictEqual(a.respawn, 0, 'exact owner never hit by their mine');
    assert.strictEqual(st.mines.length, 1, 'owner never consumes their mine');
    // Expiry removes stale mines.
    st.mines[0].ttl = 0.05;
    tick(ctx, st);
    assert.strictEqual(st.mines.length, 0, 'expired mine clears');
    // Round cap: the 17th mine is denied and the item is kept.
    for (let i = 0; i < 16; i++) {
      st.mines.push({ id: 'mfill' + i, owner: 'p1', x: 20 + (i % 4), z: 20 + Math.floor(i / 4), armT: 0, armed: true, ttl: 12 });
    }
    a.x = -20; a.z = -20; a.weapon = 'mine'; a.ammo = 1; a.fireCd = 0; a.prevAction = false;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
    tick(ctx, st);
    assert.strictEqual(st.mines.length, 16, 'mines cap at 16');
    assert.strictEqual(a.weapon, 'mine', 'denied drop keeps the item');
    assert.strictEqual(a.ammo, 1, 'denied drop keeps the ammo');
    console.log('BATTLE ok: mines (arm, trigger, owner immunity, expiry, cap)');
  }

  // --- 9. shield: defensive activation extends, never cancels ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    const a = st.karts[0];
    parkFar(st, ['p0']);
    a.weapon = 'shield'; a.ammo = 1; a.shield = 1.0; a.fireCd = 0; a.prevAction = false;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
    tick(ctx, st);
    assert.strictEqual(a.shield, 4, 'activation extends protection to 4 s');
    assert.strictEqual(a.weapon, null, 'activation spends the item');
    const ev = st.events[st.events.length - 1];
    assert.strictEqual(ev.type, 'shield', 'shield event recorded');
    assert.strictEqual(ev.pid, 'p0', 'shield event credits the driver');
    console.log('BATTLE ok: shield (4 s defense, event)');
  }

  // --- 10. KO freeze: no drive, collect, fire, or duplicate KO ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    st.karts.forEach(k=>k.health=1); // Wounded KO/settlement fixture; full-health acceptance is separate.
    const [a, b] = st.karts;
    a.weapon = 'pulse'; a.ammo = 3; a.shield = 0; a.fireCd = 0; a.prevAction = false;
    a.x = 0; a.z = -8; a.angle = 0; a.speed = 0;
    b.x = 0; b.z = 0; b.angle = 0; b.speed = 0; b.shield = 0;
    b.weapon = 'pulse'; b.ammo = 2;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
    for (let i = 0; i < 5 && b.respawn <= 0; i++) tick(ctx, st);
    assert(b.respawn > 0 && b.respawn <= 2, 'KO sits the victim out');
    assert.strictEqual(b.deaths, 1, 'death recorded');
    assert.strictEqual(b.weapon, null, 'KO strips the item');
    assert.strictEqual(b.ammo, 0, 'KO strips the ammo');
    assert.strictEqual(b.speed, 0, 'KO stops the kart');
    assert.deepStrictEqual(b.input, { steer: 0, throttle: 0, boost: false }, 'KO clears input');
    const kx = b.x;
    const kz = b.z;
    // Driving inputs move nothing while out.
    for (let i = 0; i < 5; i++) {
      karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 1 } });
      tick(ctx, st);
    }
    assert.strictEqual(b.x, kx, 'corpse never drives');
    assert.strictEqual(b.z, kz, 'corpse never drives (z)');
    // A crate parked on the corpse grants nothing.
    st.crates[0].x = b.x; st.crates[0].z = b.z;
    tick(ctx, st);
    assert.strictEqual(b.weapon, null, 'corpse collects nothing');
    // Firing while out launches nothing.
    karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 0, boost: true } });
    tick(ctx, st);
    assert(st.zaps.every((z) => z.owner !== 'p1'), 'corpse fires nothing');
    // A second zap into the corpse: consumed, no duplicate KO.
    const hitsBefore = a.hits;
    st.zaps.push({ id: 'zfix', owner: 'p0', kind: 'pulse', x: b.x, z: b.z - 2, angle: 0, ttl: 3 });
    tick(ctx, st);
    assert.strictEqual(a.hits, hitsBefore, 'no duplicate KO on a corpse');
    assert.strictEqual(b.deaths, 1, 'death counted once');
    console.log('BATTLE ok: KO freeze (no drive/collect/fire/re-KO)');
  }

  // --- 11. respawn: farthest safe pose, shield, epoch, fresh edge ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Garden Circuit' });
    st.karts.forEach(k=>k.health=1); // Wounded KO/settlement fixture; full-health acceptance is separate.
    const [a, b] = st.karts;
    for (const c of st.crates) { c.x = 55; c.z = 55; } // clean respawn: no lucky pickup
    a.x = 0; a.z = 0; a.angle = Math.PI; a.speed = 0; a.shield = 0;
    a.weapon = 'pulse'; a.ammo = 3; a.fireCd = 0; a.prevAction = false;
    b.x = 0; b.z = -8; b.angle = 0; b.speed = 0; b.shield = 0;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
    for (let i = 0; i < 5 && b.respawn <= 0; i++) tick(ctx, st);
    assert(b.respawn > 0, 'victim out');
    // Hold fire through the whole death: the edge tracker keeps running.
    for (let i = 0; i < 25 && b.respawn > 0; i++) {
      if (i % 5 === 0) karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 0, boost: true } });
      tick(ctx, st);
    }
    assert.strictEqual(b.respawn, 0, 'victim rejoins after 2 s');
    assert.deepStrictEqual([b.x, b.z], [-42, 28], 'respawn takes the farthest legal pose');
    assert(Math.hypot(b.x - a.x, b.z - a.z) >= 2.5, 'no live-kart overlap');
    assert.strictEqual(b.shield, 2.5, 'fresh spawn shield');
    assert.strictEqual(b.spawnSeq, 1, 'epoch bumps on respawn');
    assert.strictEqual(b.weapon, null, 'rejoin unarmed');
    assert(st.events.some((e) => e.type === 'respawn' && e.pid === 'p1'), 'respawn event recorded');
    assert(st.zaps.every((z) => z.owner !== 'p1'), 'held-through-death button fires nothing');
    // A genuinely new press after release works again.
    b.weapon = 'pulse'; b.ammo = 3; b.fireCd = 0;
    karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 0 } });
    tick(ctx, st);
    karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 0, boost: true } });
    tick(ctx, st);
    assert(st.zaps.some((z) => z.owner === 'p1'), 'fresh edge fires the new life');
    console.log('BATTLE ok: safe respawn (farthest pose, shield, epoch, fresh edge)');
  }

  // --- 12. offense drops protection; disconnect freezes every timer ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    const [a, b] = st.karts;
    parkFar(st, ['p0']);
    a.weapon = 'pulse'; a.ammo = 3; a.shield = 2.5; a.fireCd = 0; a.prevAction = false;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
    tick(ctx, st);
    assert.strictEqual(st.zaps.length, 1, 'attack launches');
    assert.strictEqual(a.shield, 0, 'attack drops spawn protection immediately');
    // Disconnect holds the shield still.
    b.shield = 2.0;
    ctx._connected = [{ id: 'p0', name: 'P0' }];
    const fx = b.x;
    for (let i = 0; i < 10; i++) tick(ctx, st);
    assert.strictEqual(b.shield, 2.0, 'offline shield never ticks');
    assert.strictEqual(b.x, fx, 'offline kart frozen');
    // Disconnect holds the respawn countdown; rejoin resumes it.
    b.respawn = 1.5;
    for (let i = 0; i < 5; i++) tick(ctx, st);
    assert.strictEqual(b.respawn, 1.5, 'offline respawn never counts down');
    ctx._connected = null;
    karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 0 } });
    for (let i = 0; i < 20 && b.respawn > 0; i++) tick(ctx, st);
    assert.strictEqual(b.respawn, 0, 'rejoin resumes the countdown');
    assert(b.shield > 0, 'rejoin still protected');
    console.log('BATTLE ok: attack cancels shield; disconnect freezes timers');
  }

  // --- 13. same-tick arrivals: one KO total, no double score ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 3);
    st.karts.forEach(k=>k.health=1); // Wounded KO/settlement fixture; full-health acceptance is separate.
    const [p0, p1, p2] = st.karts;
    p0.x = 0; p0.z = -15; p0.angle = 0; p0.speed = 0; p0.shield = 0;
    p0.weapon = 'pulse'; p0.ammo = 3; p0.fireCd = 0; p0.prevAction = false;
    p2.x = 0; p2.z = 15; p2.angle = Math.PI; p2.speed = 0; p2.shield = 0;
    p2.weapon = 'pulse'; p2.ammo = 3; p2.fireCd = 0; p2.prevAction = false;
    p1.x = 0; p1.z = 0; p1.angle = 0; p1.speed = 0; p1.shield = 0;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
    karts.onAction(st, ctx, 'p2', { input: { steer: 0, throttle: 0, boost: true } });
    tick(ctx, st);
    assert.strictEqual(st.zaps.length, 2, 'both shooters launch');
    tick(ctx, st);
    assert.strictEqual(p1.deaths, 1, 'victim KO’d exactly once');
    assert.strictEqual(p0.hits + p2.hits, 1, 'exactly one shooter scores');
    assert.strictEqual(p0.hits, 1, 'roster-first arrival scores');
    // A KO landing on the exact expiry tick still counts.
    const [se, ce] = racing({ mode: 'Zap Battle', map: 'Rookie Ring', winRule: 'Time limit' });
    se.karts.forEach(k=>k.health=1); // Wounded KO/settlement fixture; full-health acceptance is separate.
    const [e0, e1] = se.karts;
    e1.x = 0; e1.z = 5; e1.speed = 0; e1.shield = 0;
    se.zaps.push({ id: 'zexp', owner: 'p0', kind: 'pulse', x: 0, z: 2, angle: 0, ttl: 3 });
    ce._now = se.endsAt;
    karts.onTick(se, ce);
    assert.strictEqual(se.phase, 'done', 'deadline finishes the round');
    assert.strictEqual(se.result.endReason, 'timeout', 'timeout reason kept');
    assert.strictEqual(e0.hits, 1, 'expiry-tick KO counts');
    assert.strictEqual(se.result.winner, 'p0', 'expiry-tick KO wins');
    console.log('BATTLE ok: same-tick one-KO; expiry-tick score counts');
  }

  // --- 14. large-arena bounds on server and prediction ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Garden Circuit' });
    const a = st.karts[0];
    parkFar(st, ['p0']);
    // Past the legacy walls: the big arena never clamps to +/-28.
    a.x = 50; a.z = 0; a.angle = Math.PI / 2; a.speed = 10;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1 } });
    tick(ctx, st);
    assert(a.x > 50, `big-map driving passes 28, saw ${a.x.toFixed(2)}`);
    // ...but the real walls still clamp and scrub.
    a.x = 57; a.z = -40; a.angle = Math.PI / 2; a.speed = 14;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1 } });
    tick(ctx, st);
    assert(a.x <= 58, `bound clamps at 58, saw ${a.x.toFixed(2)}`);
    assert(a.speed < 14, 'wall hit scrubs speed');
    // Prediction with the snapshot map mirrors the server bit-for-bit.
    const v = karts.view(st, 'p0');
    a.x = 40; a.z = -30; a.angle = 0; a.speed = 12; a.slip = 0;
    a.boost = 0; a.boostCd = 0; a.turbo = 0; a.padCd = 0;
    a.drifting = false; a.driftCharge = 0;
    const p = { x: 40, z: -30, angle: 0, speed: 12, boost: 0, boostCd: 0 };
    const intent = { steer: 0.5, throttle: 1, boost: false };
    for (let i = 0; i < 5; i++) {
      karts.onAction(st, ctx, 'p0', { input: intent });
      tick(ctx, st);
      pose.stepSelf(p, intent, 0.1, { map: v.map });
      assert.strictEqual(p.x, a.x, 'big-map rollout x matches');
      assert.strictEqual(p.z, a.z, 'big-map rollout z matches');
      assert.strictEqual(p.speed, a.speed, 'big-map rollout speed matches');
    }
    // Remote leads clamp to the actual bound, not the legacy one.
    const store = pose.createPoseStore();
    const S = { phase: 'drive', mode: 'battle', map: { bound: 58 }, karts: [{ pid: 'p1', x: 58, z: 0, angle: Math.PI / 2, speed: 14 }] };
    pose.ingestSnapshot(store, S, 'p0', 1000);
    let rp = null;
    for (let t = 1016; t <= 4000; t += 16.7) {
      rp = pose.framePoses(store, S, { steer: 0, throttle: 0 }, 1 / 60, t, {}).get('p1');
      assert(Math.abs(rp.x) <= 58 + 1e-9, 'remote respects the big bound');
    }
    assert(rp.x > 28, `remote lead passes the legacy wall, saw ${rp.x.toFixed(2)}`);
    console.log('BATTLE ok: half-60 bounds (server, prediction, remotes)');
  }

  // --- 15. respawn epoch forces a snap even when nearby ---
  {
    const store = pose.createPoseStore();
    const snap = (x, seq) => ({
      phase: 'drive',
      karts: [{ pid: 'p0', x, z: 0, angle: 0, speed: 5, slip: 0, boost: 0, boostCd: 0, spawnSeq: seq }],
    });
    pose.ingestSnapshot(store, snap(0, 0), 'p0', 1000);
    for (let i = 1; i <= 10; i++) {
      pose.framePoses(store, snap(0, 0), { steer: 0, throttle: 1 }, 1 / 60, 1000 + i * 16.7, {});
    }
    const ahead = store.self.z;
    assert(ahead > 0.5, 'prediction ran ahead');
    // Same epoch, small error: soft blend, never a snap.
    pose.ingestSnapshot(store, snap(0.5, 0), 'p0', 1200);
    assert(store.self.x > 0 && store.self.x < 0.5, 'same epoch blends');
    // New epoch 1u away (inside the 6u snap radius): still snaps.
    store.self.x = 0;
    pose.ingestSnapshot(store, snap(1, 1), 'p0', 1300);
    assert.strictEqual(store.self.x, 1, 'new epoch snaps nearby self');
    assert.strictEqual(store.self.speed, 5, 'new epoch resets velocity');
    // Remotes snap on epoch too.
    const rstore = pose.createPoseStore();
    const rsnap = (x, seq) => ({
      phase: 'drive', karts: [{ pid: 'p1', x, z: 0, angle: 0, speed: 0, spawnSeq: seq }],
    });
    pose.ingestSnapshot(rstore, rsnap(10, 0), 'p0', 1000);
    pose.framePoses(rstore, rsnap(10, 0), { steer: 0, throttle: 0 }, 1 / 60, 1016, {});
    pose.ingestSnapshot(rstore, rsnap(11, 1), 'p0', 1100);
    const r = rstore.rem.get('p1');
    assert.strictEqual(r.rx, 11, 'new epoch snaps nearby remote');
    console.log('BATTLE ok: spawnSeq epoch snaps self + remotes');
  }

  // --- 16. win rule, sunset metadata, rematch lifecycle ---
  {
    // Score target ends on the goal; Time limit plays to the whistle.
    const [sg, cg] = racing({ mode: 'Zap Battle', map: 'Rookie Ring', winRule: 'Score target', targetHits: 1 });
    sg.karts[1].health=1; // Wounded KO isolates score-target result settlement.
    sg.karts[1].shield = 0; sg.karts[1].x = 0; sg.karts[1].z = 4;
    sg.karts[0].weapon = 'pulse'; sg.karts[0].ammo = 3; sg.karts[0].shield = 0;
    sg.karts[0].fireCd = 0; sg.karts[0].prevAction = false;
    sg.karts[0].x = 0; sg.karts[0].z = 0; sg.karts[0].angle = 0;
    karts.onAction(sg, cg, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
    for (let i = 0; i < 5 && sg.phase !== 'done'; i++) tick(cg, sg);
    assert.strictEqual(sg.phase, 'done', 'score target ends on the goal');
    assert.strictEqual(sg.result.endReason, 'goal', 'goal reason');
    const [sl, cl] = racing({ mode: 'Zap Battle', map: 'Rookie Ring', winRule: 'Time limit', targetHits: 1 });
    sl.karts[0].hits = 1; // already past the target: still driving
    sl.karts[0].x = 24; sl.karts[0].z = 24;
    sl.karts[1].x = -24; sl.karts[1].z = -24;
    tick(cl, sl);
    assert.strictEqual(sl.phase, 'drive', 'time limit ignores the target');
    cl._now = sl.endsAt + 1;
    tick(cl, sl);
    assert.strictEqual(sl.phase, 'done', 'deadline finishes');
    assert.strictEqual(sl.result.winner, 'p0', 'top KOs win the timed round');
    // Sunset metadata: identical for every client, frozen at results.
    const [ss, cs] = racing({ mode: 'Zap Battle', map: 'Garden Circuit', lightCycle: 'Live sunset', roundSeconds: 60 });
    assert(ss.skyCycle, 'live sunset publishes a cycle');
    assert.strictEqual(ss.skyCycle.startedAt, 3003000, 'cycle starts at the countdown deadline');
    assert.strictEqual(ss.skyCycle.durationMs, 60000, 'cycle spans the round');
    assert.strictEqual(karts.view(ss, 'p0').skyCycle.startedAt, karts.view(ss, 'p1').skyCycle.startedAt,
      'same cycle start for all clients');
    cs._now = ss.endsAt + 1;
    tick(cs, ss);
    assert.deepStrictEqual(ss.skyCycle, karts.view(ss, 'p0').skyCycle, 'results freeze the cycle');
    const [sf] = racing({ mode: 'Zap Battle', map: 'Garden Circuit', lightCycle: 'Fixed light' });
    assert.strictEqual(sf.skyCycle, null, 'fixed light publishes no cycle');
    assert.strictEqual(karts.view(sf, 'p0').skyCycle, null, 'view carries the null cycle');
    // Rematch lifecycle: a fresh instance clears every battle system.
    const players = mkPlayers(2);
    const ctx = stubCtx({ players, settings: { mode: 'Zap Battle', map: 'Rookie Ring' }, now: 5000000 });
    let dirty = karts.create(ctx);
    dirty.zaps.push({ id: 'z9', owner: 'p0', kind: 'pulse', x: 0, z: 0, angle: 0, ttl: 3 });
    dirty.mines.push({ id: 'm9', owner: 'p0', x: 1, z: 1, armT: 0, armed: true, ttl: 9 });
    dirty.grenades.push({
      id: 'g9', owner: 'p0', x: 2, z: 2, y: 1, angle: 0,
      vx: 0, vz: 0, vy: 0, fuse: 1, bounces: 0,
    });
    dirty.events.push({ id: 'e9', type: 'ko', pid: 'p0', other: 'p1' });
    dirty.karts[0].hits = 7;
    dirty.karts[0].empT = 1.6;
    const fresh = karts.create(ctx);
    assert.deepStrictEqual(fresh.zaps, [], 'zaps clear');
    assert.deepStrictEqual(fresh.mines, [], 'mines clear');
    assert.deepStrictEqual(fresh.grenades, [], 'grenades clear');
    assert.deepStrictEqual(fresh.events, [], 'events clear');
    assert(fresh.karts.every((k) => k.hits === 0 && k.deaths === 0 && k.spawnSeq === 0), 'tallies reset');
    assert(fresh.karts.every((k) => k.weapon === null && k.ammo === 0 && k.shield === 2.5), 'slots reset');
    assert(fresh.karts.every((k) => k.empT === 0), 'slows reset');
    assert.strictEqual(fresh.crateSeq, fresh.crates.length, 'crate ids restart');
    // Events stay bounded to the last twelve semantic records (fire +
    // KO + pickups retained for sound; was six before fire events).
    const [se2, ce2] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    for (let i = 0; i < 16; i++) {
      se2.karts[0].x = se2.crates[i % se2.crates.length].x;
      se2.karts[0].z = se2.crates[i % se2.crates.length].z;
      se2.karts[0].weapon = null; // force an empty slot each round
      se2.karts[0].speed = 0;
      tick(ce2, se2);
    }
    assert(se2.events.length <= 12, `events bounded, saw ${se2.events.length}`);
    assert(se2.events.every((e) => e.id && e.type && e.pid), 'events carry semantic records');
    console.log('BATTLE ok: win rule, sunset metadata, rematch, bounded events');
  }

  // --- 17. fire edge: short presses survive, non-Pulse holds/dead/offline/countdown never auto-fire ---
  {
    const press = (st, ctx, pid) => karts.onAction(st, ctx, pid, { input: { steer: 0, throttle: 0, boost: true } });
    const release = (st, ctx, pid) => karts.onAction(st, ctx, pid, { input: { steer: 0, throttle: 0 } });
    const armedOnRing = () => {
      const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
      const a = st.karts[0];
      parkFar(st, ['p0']);
      a.weapon = 'pulse'; a.ammo = 3; a.shield = 0; a.fireCd = 0;
      a.x = 0; a.z = -20; a.angle = 0; a.speed = 0;
      return [st, ctx, a];
    };
    // An offline receipt followed by reconnect before the next tick must
    // never bypass the receipt latch through the direct-input fallback.
    {
      const [st, ctx, a] = armedOnRing();
      ctx._connected = [st.karts[1]].map(k => ({id:k.pid}));
      press(st, ctx, 'p0');
      ctx._connected = null;
      tick(ctx, st);
      assert.strictEqual(a.ammo, 3, 'offline receipt cannot cross immediate reconnect');
      assert.strictEqual(st.zaps.length, 0, 'offline direct input remains neutral');
      press(st, ctx, 'p0'); tick(ctx, st);
      assert.strictEqual(a.ammo, 2, 'new live press works after reconnect');
    }
    // Short press: true then false before the same tick still fires once.
    {
      const [st, ctx, a] = armedOnRing();
      press(st, ctx, 'p0');
      release(st, ctx, 'p0');
      tick(ctx, st);
      assert.strictEqual(st.zaps.length, 1, 'short press fires');
      assert.strictEqual(a.ammo, 2, 'short press spends one round');
    }
    // A newer steering intent after the press preserves the edge too.
    {
      const [st, ctx] = armedOnRing();
      press(st, ctx, 'p0');
      karts.onAction(st, ctx, 'p0', { input: { steer: 0.5, throttle: 1 } });
      tick(ctx, st);
      assert.strictEqual(st.zaps.length, 1, 'steering after press keeps the edge');
    }
    // Multiple edges in one tick collapse to a single shot.
    {
      const [st, ctx, a] = armedOnRing();
      press(st, ctx, 'p0'); release(st, ctx, 'p0');
      press(st, ctx, 'p0'); release(st, ctx, 'p0');
      tick(ctx, st);
      assert.strictEqual(st.zaps.length, 1, 'one tick consumes one edge');
      assert.strictEqual(a.ammo, 2, 'one round spent');
    }
    // Other guns remain tap-only, even past cooldown and held keepalive.
    {
      const [st, ctx, a] = armedOnRing();a.weapon='rail';
      press(st, ctx, 'p0'); tick(ctx, st);
      assert.strictEqual(st.zaps.length, 1, 'first press fires');
      for (let i = 0; i < 6; i++) tick(ctx, st); // cooldown clears, button held
      press(st, ctx, 'p0'); tick(ctx, st); // keepalive resend of held true
      assert.strictEqual(a.ammo, 2, 'held true never spends more ammo');
      assert.strictEqual(st.events.filter(e=>e.type==='fire').length, 1, 'held true never auto-fires after the fast shot expires');
      release(st, ctx, 'p0'); tick(ctx, st);
      press(st, ctx, 'p0'); tick(ctx, st);
      assert.strictEqual(a.ammo, 1, 'fresh press after release spends the next round');
      assert.strictEqual(st.events.filter(e=>e.type==='fire').length, 2, 'fresh press after release fires');
    }
    // Malformed input neither fires nor clobbers a latched edge.
    {
      const [st, ctx] = armedOnRing();
      karts.onAction(st, ctx, 'p0', {});
      karts.onAction(st, ctx, 'p0', { input: null });
      karts.onAction(st, ctx, 'p0', { input: { steer: NaN, throttle: 0, boost: true } });
      tick(ctx, st);
      assert.strictEqual(st.zaps.length, 0, 'malformed input fires nothing');
      press(st, ctx, 'p0');
      karts.onAction(st, ctx, 'p0', {});
      tick(ctx, st);
      assert.strictEqual(st.zaps.length, 1, 'malformed input keeps the latch');
    }
    // Dead intents are rejected: neutral now, no motion after respawn.
    {
      const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
      const a = st.karts[0];
      parkFar(st, ['p0']);
      a.respawn = 0.05; a.weapon = null; a.ammo = 0; a.shield = 0;
      a.x = 0; a.z = -20; a.angle = 0; a.speed = 0;
      karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1 } });
      assert.deepStrictEqual(a.input, { steer: 0, throttle: 0, boost: false }, 'dead drive intent rejected');
      karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
      assert.strictEqual(a.pendingFire, false, 'dead fire intent latches nothing');
      tick(ctx, st);
      assert.strictEqual(a.respawn, 0, 'rejoined');
      tick(ctx, st);
      assert.strictEqual(a.speed, 0, 'no dead-life motion after respawn');
      assert.deepStrictEqual(a.input, { steer: 0, throttle: 0, boost: false }, 'fresh life starts neutral');
      assert.strictEqual(st.zaps.length, 0, 'dead press fires nothing');
      karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1 } });
      tick(ctx, st);
      assert(a.speed > 0, 'new live intent drives');
    }
    // Disconnect discards the latch; reconnect needs a fresh press.
    {
      const [st, ctx] = armedOnRing();
      press(st, ctx, 'p0');
      ctx._connected = [{ id: 'p1', name: 'P1' }];
      tick(ctx, st);
      assert.strictEqual(st.zaps.length, 0, 'offline edge fires nothing');
      assert.strictEqual(st.karts[0].pendingFire, false, 'disconnect discards the latch');
      ctx._connected = null;
      release(st, ctx, 'p0');
      tick(ctx, st);
      assert.strictEqual(st.zaps.length, 0, 'reconnect alone fires nothing');
      press(st, ctx, 'p0'); tick(ctx, st);
      assert.strictEqual(st.zaps.length, 1, 'fresh press after reconnect fires');
    }
    // TTL expiry discards a latched edge (fixture-aged latch: a receipt
    // latch never survives a live tick, so only the discard path is aged).
    {
      const [st, ctx, a] = armedOnRing();
      a.pendingFire = true;
      a.lastInputAt = ctx._now - 1600;
      tick(ctx, st);
      assert.strictEqual(st.zaps.length, 0, 'TTL-aged latch fires nothing');
      assert.strictEqual(a.pendingFire, false, 'TTL discards the latch');
    }
    // Countdown presses never queue; the opening needs a live press.
    {
      const players = mkPlayers(2);
      const ctx = stubCtx({ players, settings: { mode: 'Zap Battle', map: 'Rookie Ring' }, now: 4000000 });
      const st = karts.create(ctx);
      assert.strictEqual(st.phase, 'countdown', 'fixture starts in countdown');
      karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
      ctx._now += 2900;
      karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
      ctx._now += 100;
      karts.onTick(st, ctx);
      assert.strictEqual(st.phase, 'drive', 'countdown reaches drive');
      assert.strictEqual(st.karts[0].pendingFire, false, 'countdown latches nothing');
      st.karts[0].weapon = 'pulse'; st.karts[0].ammo = 3; st.karts[0].shield = 0;
      st.karts[0].x = 0; st.karts[0].z = -20; st.karts[0].angle = 0; st.karts[0].speed = 0;
      parkFar(st, ['p0']);
      tick(ctx, st); // input still fresh: only the re-arm blocks the fire
      assert.strictEqual(st.zaps.length, 0, 'countdown press fires nothing live');
      release(st, ctx, 'p0'); tick(ctx, st);
      press(st, ctx, 'p0'); tick(ctx, st);
      assert.strictEqual(st.zaps.length, 1, 'live press after countdown fires');
    }
    // Snapshots never carry input or edge state.
    {
      const [st] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
      for (const k of karts.view(st, 'p0').karts) {
        assert(!('input' in k), 'no input in snapshots');
        assert(!('pendingFire' in k), 'no latch in snapshots');
        assert(!('prevAction' in k), 'no edge tracker in snapshots');
      }
    }
    console.log('BATTLE ok: fire edge (short press, holds, malformed, dead, offline, countdown, no leak)');
  }

  // --- 18. results freeze the shared sunset at the finish instant ---
  {
    // Early Score target: endedAt stamps once and never advances.
    const [st, ctx] = racing({
      mode: 'Zap Battle', map: 'Garden Circuit', winRule: 'Score target',
      targetHits: 1, lightCycle: 'Live sunset', roundSeconds: 90,
    });
    st.karts.forEach(k=>k.health=1); // Wounded KO/settlement fixture; full-health acceptance is separate.
    assert(!('endedAt' in st.skyCycle), 'no endedAt while driving');
    assert(!('endedAt' in karts.view(st, 'p0').skyCycle), 'no endedAt in live views');
    st.karts[0].hits = 1; // goal already banked
    st.karts[0].x = 50; st.karts[0].z = 50;
    st.karts[1].x = -50; st.karts[1].z = -50;
    const finishAt = ctx._now + 100;
    tick(ctx, st);
    assert.strictEqual(st.phase, 'done', 'early goal finishes');
    assert.strictEqual(st.result.endReason, 'goal', 'goal reason');
    assert.strictEqual(st.skyCycle.endedAt, finishAt, 'finish stamps the authoritative instant');
    assert.strictEqual(karts.view(st, 'p0').skyCycle.endedAt, finishAt, 'view carries endedAt');
    assert.strictEqual(karts.view(st, 'p1').skyCycle.endedAt, finishAt, 'late join sees the same freeze');
    for (let i = 0; i < 5; i++) tick(ctx, st); // server time marches on
    assert.strictEqual(st.skyCycle.endedAt, finishAt, 'result never advances the sky');
    assert.strictEqual(karts.view(st, 'p0').skyCycle.endedAt, finishAt, 'later views stay frozen');
    // Timeout stamps and freezes the same way.
    const [sl, cl] = racing({
      mode: 'Zap Battle', map: 'Garden Circuit', winRule: 'Time limit',
      targetHits: 1, lightCycle: 'Live sunset', roundSeconds: 90,
    });
    sl.karts.forEach(k=>k.health=1); // Wounded KO/settlement fixture; full-health acceptance is separate.
    sl.karts[0].x = 50; sl.karts[0].z = 50;
    sl.karts[1].x = -50; sl.karts[1].z = -50;
    const timeoutAt = sl.endsAt + 1; // finish resets endsAt to 0: capture first
    cl._now = timeoutAt;
    karts.onTick(sl, cl);
    assert.strictEqual(sl.phase, 'done', 'deadline finishes');
    assert.strictEqual(sl.result.endReason, 'timeout', 'timeout reason');
    assert.strictEqual(sl.skyCycle.endedAt, timeoutAt, 'timeout stamps endedAt');
    assert.strictEqual(karts.view(sl, 'p0').skyCycle.endedAt, timeoutAt, 'timeout view carries endedAt');
    // Fixed light stays null through the finish.
    const [sf, cf] = racing({
      mode: 'Zap Battle', map: 'Rookie Ring', winRule: 'Score target',
      targetHits: 1, lightCycle: 'Fixed light',
    });
    sf.karts.forEach(k=>k.health=1); // Wounded KO/settlement fixture; full-health acceptance is separate.
    sf.karts[0].hits = 1;
    sf.karts[0].x = 24; sf.karts[0].z = 24;
    sf.karts[1].x = -24; sf.karts[1].z = -24;
    tick(cf, sf);
    assert.strictEqual(sf.phase, 'done', 'fixed-light goal finishes');
    assert.strictEqual(sf.skyCycle, null, 'no cycle to stamp');
    assert.strictEqual(karts.view(sf, 'p0').skyCycle, null, 'view carries the null cycle');
    console.log('BATTLE ok: sunset freeze (early goal, timeout, fixed null, late join)');
  }

  // --- 19. projectiles ignore the corpse-to-spawn teleport line ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 3);
    st.karts.forEach(k=>k.health=1); // Wounded KO/settlement fixture; full-health acceptance is separate.
    const [a, b, c] = st.karts;
    for (const crate of st.crates) { crate.x = 24; crate.z = 24; }
    st.spawns = [{ x: 0, z: -20, angle: 0 }]; // deterministic re-entry
    a.weapon = 'pulse'; a.ammo = 3; a.shield = 0; a.fireCd = 0;
    a.x = -8; a.z = -10; a.angle = Math.PI / 2; a.speed = 0;
    b.respawn = 0.15; b.weapon = null; b.ammo = 0; b.shield = 0;
    b.x = 0; b.z = 0; b.angle = 0; b.speed = 0;
    c.x = 20; c.z = -10; c.angle = 0; c.speed = 0; c.shield = 0;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
    tick(ctx, st); // zap away; victim still out
    assert.strictEqual(st.zaps.length, 1, 'shot in flight');
    assert(b.respawn > 0, 'victim still out while the shot travels');
    tick(ctx, st); // respawn lands mid-flight, across the shot line
    assert.strictEqual(b.respawn, 0, 'victim rejoins');
    assert.deepStrictEqual([b.x, b.z], [0, -20], 're-entry takes the pinned pose');
    assert.strictEqual(st.zaps.length, 1, 'teleport line swallows nothing');
    assert(st.zaps[0].x > 0, 'shot crossed the teleport line');
    assert(b.shield > 0, 'fresh spawn keeps its protection');
    for (let i = 0; i < 4 && c.respawn <= 0; i++) tick(ctx, st);
    assert(c.respawn > 0, 'the shot continues to its real target');
    assert.strictEqual(a.hits, 1, 'shooter scores the far KO');
    assert.strictEqual(b.deaths, 0, 'respawned kart never re-KO’d mid-flight');
    console.log('BATTLE ok: respawn retargets the sweep (shot crosses, far KO lands)');
  }

  // --- 20. mines land on legal ground, never inside cover ---
  {
    // Kart hugging cover: the drop falls back toward the owner, off the block.
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Bumper Blocks' });
    st.karts.forEach(k=>k.health=1); // Wounded KO/settlement fixture; full-health acceptance is separate.
    const a = st.karts[0];
    const b = st.karts[1];
    parkFar(st, ['p0']);
    for (const crate of st.crates) { crate.x = -24; crate.z = 24; }
    a.weapon = 'mine'; a.ammo = 1; a.shield = 0; a.fireCd = 0;
    a.x = 16; a.z = 12; a.angle = Math.PI; a.speed = 0; // rear to the (16,16) block
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
    tick(ctx, st);
    assert.strictEqual(st.mines.length, 1, 'cover drop still spawns');
    const mine = st.mines[0];
    assert(Math.abs(mine.x - 16) < 1e-9, 'mine stays on the owner line');
    assert(Math.abs(mine.z - 12.6) < 1e-9, 'mine falls back toward the owner');
    for (const bl of st.blocks) {
      assert(Math.abs(mine.x - bl.x) >= bl.hw + 0.5 || Math.abs(mine.z - bl.z) >= bl.hd + 0.5,
        'mine clears every block face');
    }
    assert.strictEqual(a.weapon, null, 'legal drop spends the item');
    // The relocated mine still arms, triggers, and consumes exactly once.
    for (let i = 0; i < 8; i++) tick(ctx, st);
    assert.strictEqual(mine.armed, true, 'cover mine arms');
    b.x = mine.x; b.z = mine.z; b.speed = 0; b.shield = 0;
    karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 0 } });
    tick(ctx, st);
    assert.strictEqual(a.hits, 1, 'cover mine KOs');
    assert.strictEqual(st.mines.length, 0, 'trigger consumes the mine');
    // One mine, two victims on it: exactly one KO, mine gone.
    {
      const [sx, cx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 3);
    sx.karts.forEach(k=>k.health=1); // Wounded KO/settlement fixture; full-health acceptance is separate.
      const [o, v1, v2] = sx.karts;
      for (const crate of sx.crates) { crate.x = 24; crate.z = 24; }
      o.weapon = 'mine'; o.ammo = 1; o.shield = 0; o.fireCd = 0;
      o.x = 0; o.z = 0; o.angle = 0; o.speed = 0;
      karts.onAction(sx, cx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
      tick(cx, sx);
      assert.deepStrictEqual([sx.mines[0].x, sx.mines[0].z], [0, -2], 'open drop keeps the classic spot');
      for (let i = 0; i < 8; i++) tick(cx, sx);
      v1.x = 0; v1.z = -2; v1.speed = 0; v1.shield = 0;
      v2.x = 0.5; v2.z = -2; v2.speed = 0; v2.shield = 0;
      tick(cx, sx);
      assert.strictEqual(sx.mines.length, 0, 'first trigger consumes the mine');
      assert.strictEqual([v1, v2].filter((k) => k.respawn > 0).length, 1, 'exactly one victim KO’d');
      assert.strictEqual(o.hits, 1, 'shooter scores once');
    }
    // Backed against the wall: the drop clamps inside the arena.
    {
      const [sw, cw] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    sw.karts.forEach(k=>k.health=1); // Wounded KO/settlement fixture; full-health acceptance is separate.
      const w = sw.karts[0];
      parkFar(sw, ['p0']);
      w.weapon = 'mine'; w.ammo = 1; w.shield = 0; w.fireCd = 0;
      w.x = 0; w.z = 27; w.angle = Math.PI; w.speed = 0;
      karts.onAction(sw, cw, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
      tick(cw, sw);
      assert.strictEqual(sw.mines.length, 1, 'wall drop spawns');
      assert.strictEqual(sw.mines[0].z, 28, 'drop clamps to the bound');
      assert(Math.abs(sw.mines[0].x) < 1e-9, 'wall drop stays centered');
      assert.strictEqual(w.weapon, null, 'wall drop spends the item');
    }
    // No legal ground anywhere near: the item and the shield stay loaded.
    {
      const [sn, cn] = racing({ mode: 'Zap Battle', map: 'Bumper Blocks' });
    sn.karts.forEach(k=>k.health=1); // Wounded KO/settlement fixture; full-health acceptance is separate.
      const n = sn.karts[0];
      parkFar(sn, ['p0']);
      n.weapon = 'mine'; n.ammo = 1; n.shield = 2.5; n.fireCd = 0;
      n.x = 16; n.z = 16; n.angle = 0; n.speed = 0; // pinned inside solid
      karts.onAction(sn, cn, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
      tick(cn, sn);
      assert.strictEqual(sn.mines.length, 0, 'no mine without legal ground');
      assert.strictEqual(n.weapon, 'mine', 'item kept');
      assert.strictEqual(n.ammo, 1, 'ammo kept');
      assert(n.shield > 2, 'protection never dropped for a failed drop');
      assert.strictEqual(n.fireCd, 0, 'no cooldown on a failed drop');
      assert.strictEqual(n.pendingFire, false, 'failed drop still consumes the edge');
    }
    console.log('BATTLE ok: mine placement (cover fallback, bounds, keep-on-fail, exact-once)');
  }

  console.log('KART_BATTLE_LOOP_PASS');
}

main().then(
  () => {},
  (e) => { console.error(e); process.exit(1); },
);
