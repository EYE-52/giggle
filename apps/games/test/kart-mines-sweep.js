// Planar-mutating unit fixtures use an explicit generic variant, not physical Pocket.
'use strict';
/* Mine sweep: fast crossings trigger, slow/endpoint still work, arm/expiry
 * windows bound the catch, owner/shield/offline/KO never trigger, one
 * mine KOs at most one victim with honest economy. Real engine only.
 * Run: node test/kart-mines-sweep.js */
const assert = require('assert');
const karts = require('./fixtures/kart-planar-variant.cjs');

function stubCtx({ players, settings, now }) {
  const ctx = {
    _now: now !== undefined ? now : 5000000,
    _connected: null,
    players() { return (this._connected || players).slice(); },
    allPlayers: () => players.slice(),
    settings: () => ({ ...(settings || {}) }),
    broadcast() {}, lobby() {}, later: () => () => {},
    award() {}, now: () => ctx._now,
  };
  return ctx;
}
function mkPlayers(n) { return Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })); }
function battle(map = 'Rookie Ring', n = 2, now = 5000000) {
  const players = mkPlayers(n);
  const ctx = stubCtx({ players, settings: { mode: 'Zap Battle', map }, now });
  const st = karts.create(ctx);
  ctx._now += 3000;
  karts.onTick(st, ctx);
  assert.strictEqual(st.phase, 'drive');
  // Wounded victims isolate mine sweep/KO timing; kart-health uses default100.
  for(const k of st.karts)k.health=1;
  for (const c of st.crates) { c.x = 24; c.z = -24; }
  return [st, ctx];
}
function tick(ctx, st, ms = 100) { ctx._now += ms; karts.onTick(st, ctx); }

function main() {
  // 1. Fast crossing triggers: endpoints beyond 2.2 on both sides, .1 and .25.
  for (const ms of [100, 250]) {
    const [st, ctx] = battle();
    const [a, b] = st.karts;
    a.x = 20; a.z = 20; a.speed = 0; a.shield = 0;
    b.x = 0; b.z = -2.5; b.angle = 0; b.speed = 22.4; b.shield = 0;
    b.boost = 1.2; b.boostCd = 6; // battle-legal timer: top 1.6x this tick
    st.mines.push({ id: 'm-fast', owner: 'p0', x: 0, z: 0, armT: 0, armed: true, ttl: 12 });
    karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 1 } });
    tick(ctx, st, ms);
    assert(b.respawn > 0, `${ms}ms crossing KOs`);
    assert.strictEqual(a.hits, 1, `${ms}ms crossing credits`);
    assert.strictEqual(st.mines.length, 0, `${ms}ms crossing consumes`);
    console.log(`MINES ok: fast crossing triggers (${ms}ms)`);
  }

  // 2. Unarmed sweep never triggers, even crossing the plate at speed.
  {
    const [st, ctx] = battle();
    const [a, b] = st.karts;
    a.x = 20; a.z = 20; a.speed = 0;
    b.x = 0; b.z = -6; b.angle = 0; b.speed = 14; b.shield = 0;
    st.mines.push({ id: 'm-raw', owner: 'p0', x: 0, z: 0, armT: 0.7, armed: false, ttl: 12 });
    karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 1 } });
    tick(ctx, st);
    assert.strictEqual(st.mines.length, 1, 'unarmed crossing keeps the mine');
    assert.strictEqual(b.respawn, 0, 'unarmed crossing never KOs');
    assert.strictEqual(st.mines[0].armed, false, 'still arming');
    console.log('MINES ok: unarmed sweep silent');
  }

  // 3. Arm mid-tick: only the post-arm leg catches.
  {
    // Victim starts on the plate but boosts clear before the arm point.
    const [st, ctx] = battle();
    const [a, b] = st.karts;
    a.x = 20; a.z = 20; a.speed = 0;
    b.x = 0; b.z = 0.5; b.angle = 0; b.speed = 22; b.shield = 0;
    b.boost = 1.2; b.boostCd = 6;
    st.mines.push({ id: 'm-arm-late', owner: 'p0', x: 0, z: 0, armT: 0.09, armed: false, ttl: 12 });
    karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 1 } });
    tick(ctx, st, 100);
    // Mine armed at 90% through the tick; victim cleared by then.
    assert.strictEqual(st.mines[0]?.armed, true, 'mine armed');
    assert.strictEqual(b.respawn, 0, 'pre-arm leg never catches');
    // Kart enters after the arm point: catch.
    const [st2, ctx2] = battle();
    const [a2, b2] = st2.karts;
    a2.x = 20; a2.z = 20; a2.speed = 0;
    b2.x = 0; b2.z = -3; b2.angle = 0; b2.speed = 14; b2.shield = 0;
    st2.mines.push({ id: 'm-arm-early', owner: 'p0', x: 0, z: 0, armT: 0.01, armed: false, ttl: 12 });
    karts.onAction(st2, ctx2, 'p1', { input: { steer: 0, throttle: 1 } });
    tick(ctx2, st2, 100);
    assert(b2.respawn > 0, 'post-arm leg catches');
    console.log('MINES ok: arm window bounds the catch');
  }

  // 4. Expiry mid-tick: pre-expiry leg catches, post-expiry never does.
  {
    const [st, ctx] = battle();
    const [a, b] = st.karts;
    a.x = 20; a.z = 20; a.speed = 0;
    b.x = 0; b.z = 0; b.angle = 0; b.speed = 0; b.shield = 0; // parked on plate
    st.mines.push({ id: 'm-exp', owner: 'p0', x: 0, z: 0, armT: 0, armed: true, ttl: 0.05 });
    karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 0 } });
    tick(ctx, st, 100);
    assert(b.respawn > 0, 'parked victim KOs before expiry');
    assert.strictEqual(st.mines.length, 0, 'trigger consumes before expiry');
    // Far victim, mine expires quietly.
    const [st2, ctx2] = battle();
    const [a2, b2] = st2.karts;
    a2.x = 20; a2.z = 20; b2.x = 20; b2.z = -20;
    st2.mines.push({ id: 'm-exp2', owner: 'p0', x: 0, z: 0, armT: 0, armed: true, ttl: 0.05 });
    tick(ctx2, st2, 100);
    assert.strictEqual(st2.mines.length, 0, 'lonely mine expires quietly');
    assert.strictEqual(a2.hits, 0, 'expiry scores nothing');
    console.log('MINES ok: expiry window');
  }

  // 5. Owner, shield, KO, offline never trigger — even swept at speed.
  {
    const [st, ctx] = battle(undefined, 3);
    const [a, b, c] = st.karts;
    a.x = 20; a.z = 20; a.speed = 0;
    // Owner drives over own armed mine at speed.
    a.x = 0; a.z = -4; a.angle = 0; a.speed = 14; a.shield = 0;
    st.mines.push({ id: 'm-own', owner: 'p0', x: 0, z: 0, armT: 0, armed: true, ttl: 12 });
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1 } });
    tick(ctx, st);
    assert.strictEqual(st.mines.length, 1, 'owner never triggers own mine');
    assert.strictEqual(a.respawn, 0, 'owner never self-KOs');
    // Shielded rival drives over.
    b.x = 0; b.z = -4; b.angle = 0; b.speed = 14; b.shield = 2;
    karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 1 } });
    tick(ctx, st);
    assert.strictEqual(st.mines.length, 1, 'shielded kart never triggers');
    // KO'd rival on the plate.
    b.x = 0; b.z = 0; b.respawn = 1.5; b.shield = 0;
    tick(ctx, st);
    assert.strictEqual(st.mines.length, 1, 'KO body never triggers');
    b.respawn = 0;
    // Offline rival on the plate.
    ctx._connected = [{ id: 'p0', name: 'P0' }, { id: 'p2', name: 'P2' }];
    b.x = 0; b.z = 0; b.shield = 0;
    tick(ctx, st);
    assert.strictEqual(st.mines.length, 1, 'offline kart never triggers');
    ctx._connected = null;
    // And the live unshielded rival still triggers (no over-suppression).
    a.x = 20; a.z = 20; a.speed = 0;
    b.x = 20; b.z = -20; b.respawn = 0; b.shield = 0; b.speed = 0;
    c.x = 0; c.z = -3; c.angle = 0; c.speed = 14; c.shield = 0; c.respawn = 0;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0 } });
    karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 0 } });
    karts.onAction(st, ctx, 'p2', { input: { steer: 0, throttle: 1 } });
    tick(ctx, st);
    assert(c.respawn > 0, 'live rival still triggers');
    console.log('MINES ok: immunity set');
  }

  // 6. One mine, two crossers, one KO: earliest crossing wins, economy once.
  {
    const [st, ctx] = battle(undefined, 3);
    const [a, b, c] = st.karts;
    a.x = 20; a.z = 20; a.speed = 0; a.shield = 0;
    // b starts closer (earlier crossing), c farther; both drive over.
    b.x = 0; b.z = -3; b.angle = 0; b.speed = 14; b.shield = 0;
    c.x = 0; c.z = -5; c.angle = 0; c.speed = 14; c.shield = 0;
    st.mines.push({ id: 'm-duel', owner: 'p0', x: 0, z: 0, armT: 0, armed: true, ttl: 12 });
    karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 1 } });
    karts.onAction(st, ctx, 'p2', { input: { steer: 0, throttle: 1 } });
    tick(ctx, st);
    const kos = [b, c].filter((k) => k.respawn > 0).length;
    assert.strictEqual(kos, 1, 'exactly one KO per mine per tick');
    assert.strictEqual(a.hits, 1, 'exactly one credit');
    assert.strictEqual(st.mines.length, 0, 'mine consumed');
    assert(b.respawn > 0, 'earliest crosser wins');
    const v = karts.view(st, 'p0');
    assert((v.events || []).length <= 64, 'event log bounded');
    console.log('MINES ok: exactly-once KO and economy');
  }

  // 7. Cover arenas: mines still catch in the open, no cheap misses.
  {
    const [st, ctx] = battle('Bumper Blocks');
    const [a, b] = st.karts;
    a.x = 20; a.z = 20; a.speed = 0;
    b.x = 0; b.z = -3; b.angle = 0; b.speed = 14; b.shield = 0;
    st.mines.push({ id: 'm-cover', owner: 'p0', x: 0, z: 0, armT: 0, armed: true, ttl: 12 });
    karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 1 } });
    tick(ctx, st);
    assert(b.respawn > 0, 'open-lane mine catches on a cover map');
    console.log('MINES ok: cover-map catch');
  }

  console.log('KART_MINES_SWEEP_PASS');
}

main();
