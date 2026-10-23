// Planar-mutating unit fixtures use an explicit generic variant, not physical Pocket.
'use strict';
/* Rechargeable nitro: server authority, drain/recharge/lock, Fire
 * independence, malformed/TTL/offline/KO/rematch handling, speed caps,
 * and prediction parity across modes and garage tuning.
 * Run: node test/kart-nitro.js */
const assert = require('assert');
const engine = require('../games/engines/kart-engine');
const karts = require('./fixtures/kart-planar-variant.cjs');
const POSE_URL = '../public/js/games/pocket-karts-pose.mjs';
const C = engine.constants;

function stubCtx({ players, settings, now }) {
  const ctx = {
    _now: now !== undefined ? now : 8000000,
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
function racing(settings, n = 2, now = 8000000) {
  const players = mkPlayers(n);
  const ctx = stubCtx({ players, settings, now });
  const st = karts.create(ctx);
  ctx._now += 3000;
  karts.onTick(st, ctx);
  assert.strictEqual(st.phase, 'drive');
  return [st, ctx];
}
function tick(ctx, st, ms = 100) { ctx._now += ms; karts.onTick(st, ctx); }
function parkFar(st, except = []) {
  const c = st.bound - 4;
  let i = 0;
  for (const k of st.karts) {
    if (except.includes(k.pid)) continue;
    k.x = i % 2 === 0 ? c : -c; k.z = i % 4 < 2 ? c : -c; i += 1;
    k.angle = 0; k.speed = 0; k.input = { steer: 0, throttle: 0, boost: false };
  }
}

async function main() {
  const pose = await import(POSE_URL);

  // 1. Drain only with useful throttle; release recharges; park holds nothing.
  {
    const [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
    const k = st.karts[0]; parkFar(st, ['p0']);
    k.x = 0; k.z = -20; k.angle = 0; k.speed = 10;
    assert.strictEqual(k.nitro, 1, 'fresh tank full');
    assert.strictEqual(k.nitroActive, false, 'fresh tank idle');
    assert.strictEqual(k.nitroLocked, false, 'fresh tank unlocked');
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1, nitro: true } });
    tick(ctx, st);
    assert.strictEqual(k.nitroActive, true, 'N with gas activates');
    assert(k.nitro < 1 && k.nitro > 0.9, `bounded drain, saw ${k.nitro}`);
    assert(k.speed > 10, 'nitro accelerates');
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1 } });
    const before = k.nitro; tick(ctx, st);
    assert.strictEqual(k.nitroActive, false, 'release deactivates');
    assert(k.nitro > before, 'release recharges');
    k.x = 0; k.z = -20; k.speed = 0; k.nitro = 1; k.nitroLocked = false;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, nitro: true } });
    tick(ctx, st);
    assert.strictEqual(k.nitroActive, false, 'parked hold never activates');
    assert.strictEqual(k.nitro, 1, 'parked hold never drains');
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: -1, nitro: true } });
    tick(ctx, st);
    assert.strictEqual(k.nitroActive, false, 'reverse hold never activates');
    console.log('NITRO ok: drain/recharge gating');
  }

  // 2. Empty locks until rearm; holding never extends; no indefinite speed.
  {
    const [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
    const k = st.karts[0]; parkFar(st, ['p0']);
    k.x = 0; k.z = -20; k.angle = 0; k.speed = 12; k.nitro = 0.05; k.nitroLocked = false;
    const inp = { steer: 0, throttle: 1, nitro: true };
    karts.onAction(st, ctx, 'p0', { input: inp });
    tick(ctx, st); tick(ctx, st);
    assert(k.nitroLocked === true, 'empty locks');
    assert(k.nitro < 0.05, `tank near empty, saw ${k.nitro}`);
    karts.onAction(st, ctx, 'p0', { input: inp });
    tick(ctx, st);
    assert.strictEqual(k.nitroActive, false, 'locked refuses while held');
    assert(k.nitroLocked === true, 'stays locked below rearm');
    let guard = 0;
    while (k.nitroLocked && guard++ < 60) {
      karts.onAction(st, ctx, 'p0', { input: inp });
      tick(ctx, st);
    }
    assert(k.nitroLocked === false, 'rearms at threshold');
    assert(k.nitro > 0.2, `rearm charge near threshold, saw ${k.nitro.toFixed(3)}`);
    assert.strictEqual(k.nitroActive, true, 'held N resumes after rearm');
    // Full-tank hold cannot run forever: ~2.5 s then locks.
    k.nitro = 1; k.nitroLocked = false;
    let activeTicks = 0;
    for (let i = 0; i < 60; i++) {
      karts.onAction(st, ctx, 'p0', { input: inp });
      tick(ctx, st);
      if (k.nitroActive) activeTicks += 1;
      if (k.nitroLocked) break;
    }
    assert(k.nitroLocked === true, 'sustained hold eventually locks');
    assert(activeTicks >= 20 && activeTicks <= 30, `bounded boost window, saw ${activeTicks} ticks`);
    console.log('NITRO ok: empty lockout and bounded boost');
  }

  // 3. Fire + nitro + steering coexist; nitro never fires; malformed ignored.
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    const k = st.karts[0]; parkFar(st, ['p0']);
    k.x = 0; k.z = -20; k.angle = 0; k.speed = 12;
    k.weapon = 'pulse'; k.ammo = 3; k.shield = 0; k.fireCd = 0; k.prevAction = false;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0.5, throttle: 1, boost: true, nitro: true } });
    tick(ctx, st);
    assert.strictEqual(st.zaps.length, 1, 'fire edge launches with nitro held');
    assert.strictEqual(k.nitroActive, true, 'nitro holds through the fire edge');
    assert(k.angle < 0, 'steering applies with fire+nitro');
    // Nitro alone never fires.
    const n = st.zaps.length;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1, nitro: true } });
    tick(ctx, st);
    assert.strictEqual(st.zaps.length, n, 'nitro hold fires nothing');
    // Malformed nitro values never arm; charge smuggling ignored.
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1, nitro: 'yes' } });
    assert(!('nitro' in k.input), 'string nitro ignored');
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1, nitro: 1 } });
    assert(!('nitro' in k.input), 'numeric nitro ignored');
    const charge = k.nitro;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1, nitro: true }, nitro: 99, nitroActive: true });
    tick(ctx, st);
    assert(k.nitro <= charge, 'client charge never injects');
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1 } });
    assert.deepStrictEqual(k.input, { steer: 0, throttle: 1, boost: false }, 'legacy shape intact');
    console.log('NITRO ok: fire independence and input validation');
  }

  // 4. TTL/offline freeze the tank; KO refills the fresh life; rematch resets.
  {
    const [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
    const k = st.karts[0]; parkFar(st, ['p0']);
    k.x = 0; k.z = -20; k.angle = 0; k.speed = 12; k.nitro = 0.6; k.nitroLocked = false;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1, nitro: true } });
    tick(ctx, st);
    const draining = k.nitro;
    assert(draining < 0.6, 'setup drains');
    for (let i = 0; i < 16; i++) tick(ctx, st); // radio silence past TTL
    assert.deepStrictEqual(k.input, { steer: 0, throttle: 0, boost: false }, 'silent nitro expires');
    assert.strictEqual(k.nitroActive, false, 'TTL clears active');
    const frozen = k.nitro;
    for (let i = 0; i < 5; i++) tick(ctx, st);
    // TTL wipe leaves throttle 0: the tank neither drains nor (usefully)
    // recharges without a live intent — it coasts on drag. Charge must
    // never jump from smuggled values; it only moves via the stepper.
    assert(Math.abs(k.nitro - frozen) < 0.2, 'TTL tank coasts without live intent');
    // Offline freezes motion and the tank.
    k.x = 0; k.z = -20; k.speed = 12; k.nitro = 0.5; k.nitroLocked = false;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1, nitro: true } });
    tick(ctx, st);
    ctx._connected = [{ id: 'p1', name: 'P1' }];
    const fx = k.x, fz = k.z, fc = k.nitro;
    for (let i = 0; i < 10; i++) tick(ctx, st);
    assert.strictEqual(k.x, fx, 'offline holds x');
    assert.strictEqual(k.z, fz, 'offline holds z');
    assert.strictEqual(k.nitro, fc, 'offline tank frozen');
    assert.strictEqual(k.nitroActive, false, 'offline active cleared');
    ctx._connected = null;
    // Battle KO clears active; the fresh life refills.
    const [sb, cxb] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    const [a, b] = sb.karts;
    b.health=1; // Wounded KO isolates tank cleanup and fresh-life refill.
    a.x = 0; a.z = -8; a.angle = 0; a.speed = 0; a.shield = 0;
    a.weapon = 'pulse'; a.ammo = 3; a.fireCd = 0; a.prevAction = false;
    b.x = 0; b.z = 0; b.speed = 0; b.shield = 0; b.nitro = 0.2; b.nitroLocked = true;
    karts.onAction(sb, cxb, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
    for (let i = 0; i < 5 && b.respawn <= 0; i++) tick(cxb, sb);
    assert(b.respawn > 0, 'victim out');
    assert.strictEqual(b.nitroActive, false, 'KO clears active');
    for (let i = 0; i < 25 && b.respawn > 0; i++) tick(cxb, sb);
    assert.strictEqual(b.respawn, 0, 'victim rejoins');
    assert.strictEqual(b.nitro, 1, 'fresh life refills');
    assert.strictEqual(b.nitroLocked, false, 'fresh life unlocked');
    // Countdown never drains; rematch resets.
    const players = mkPlayers(2);
    const cc = stubCtx({ players, settings: { mode: 'Star Rush', map: 'Rookie Ring' }, now: 9000000 });
    const sc = karts.create(cc);
    karts.onAction(sc, cc, 'p0', { input: { steer: 0, throttle: 1, nitro: true } });
    cc._now += 100; karts.onTick(sc, cc);
    assert.strictEqual(sc.phase, 'countdown', 'still counting');
    assert.strictEqual(sc.karts[0].nitro, 1, 'countdown never drains');
    assert.strictEqual(sc.karts[0].nitroActive, false, 'countdown never activates');
    const [sd, cxd] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
    sd.karts[0].nitro = 0.1; sd.karts[0].nitroLocked = true;
    cxd._now = sd.endsAt + 1; tick(cxd, sd);
    assert.strictEqual(sd.phase, 'done', 'timeout finishes');
    const se = karts.create(cxd);
    for (const kk of se.karts) {
      assert.strictEqual(kk.nitro, 1, 'rematch tank reset');
      assert.strictEqual(kk.nitroActive, false, 'rematch idle reset');
      assert.strictEqual(kk.nitroLocked, false, 'rematch lock reset');
    }
    console.log('NITRO ok: TTL/offline freeze, KO refill, countdown/rematch');
  }

  // 5. Speed caps: nitro beats cruise, never exceeds boost, never stacks.
  {
    const [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
    const k = st.karts[0]; parkFar(st, ['p0']);
    k.x = 0; k.z = -20; k.angle = 0; k.speed = 14;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1, nitro: true } });
    for (let i = 0; i < 10; i++) { if (i % 5 === 0) karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1, nitro: true } }); tick(ctx, st); }
    assert(k.speed > engine.constants.MAX_SPEED, `nitro beats cruise, saw ${k.speed.toFixed(2)}`);
    assert(k.speed <= engine.constants.MAX_SPEED * engine.constants.NITRO_SPEED + 0.01, `nitro respects its cap, saw ${k.speed.toFixed(2)}`);
    // Boost + nitro together never exceed the boost cap.
    k.x = 0; k.z = -20; k.speed = 14; k.nitro = 1; k.nitroLocked = false;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1, boost: true, nitro: true } });
    for (let i = 0; i < 10; i++) { if (i % 5 === 0) karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1, nitro: true } }); tick(ctx, st); }
    assert(k.speed <= engine.constants.MAX_SPEED * engine.constants.BOOST_SPEED + 0.01, `combined never exceeds boost cap, saw ${k.speed.toFixed(2)}`);
    // Battle (no boost timer) still nitros.
    const [sb, cxb] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    const kb = sb.karts[0]; parkFar(sb, ['p0']);
    kb.x = 0; kb.z = -20; kb.angle = 0; kb.speed = 14;
    karts.onAction(sb, cxb, 'p0', { input: { steer: 0, throttle: 1, nitro: true } });
    for (let i = 0; i < 10; i++) { if (i % 5 === 0) karts.onAction(sb, cxb, 'p0', { input: { steer: 0, throttle: 1, nitro: true } }); tick(cxb, sb); }
    assert(kb.speed > engine.constants.MAX_SPEED && kb.speed <= engine.constants.MAX_SPEED * engine.constants.NITRO_SPEED + 0.01, `battle nitro capped, saw ${kb.speed.toFixed(2)}`);
    assert.strictEqual(kb.boost, 0, 'battle still has no boost timer');
    // View exposes charge/active/lock and leaks no inputs.
    const v = karts.view(sb, 'p0');
    for (const f of ['nitro', 'nitroActive', 'nitroLocked']) assert(f in v.karts[0], `snapshot carries ${f}`);
    assert(v.karts[0].nitro >= 0 && v.karts[0].nitro <= 1, 'charge is 0..1');
    assert(!('input' in v.karts[0]), 'no inputs leaked');
    console.log('NITRO ok: speed caps and snapshot fields');
  }

  // 6. Prediction parity: server and mirror agree bit-for-bit, both modes,
  // garage tuning included; resnapshots correct the tank.
  {
    for (const mode of ['Star Rush', 'Zap Battle']) {
      const [st, ctx] = racing({ mode, map: 'Frosty Pass' });
      const k = st.karts[0]; parkFar(st, ['p0']);
      k.x = 14; k.z = -6; k.angle = 0; k.speed = 12; k.nitro = 1; k.nitroLocked = false;
      const p = { x: 14, z: -6, angle: 0, speed: 12, boost: 0, boostCd: 0, nitro: 1, nitroLocked: false };
      const geo = { blocks: st.blocks, pads: st.pads, surfaces: st.surfaces, bound: st.bound, allowBoost: mode !== 'Zap Battle' };
      const script = [];
      for (let i = 0; i < 8; i++) script.push({ steer: 0.3, throttle: 1, boost: false, nitro: true });
      for (let i = 0; i < 8; i++) script.push({ steer: 0, throttle: 1, boost: false });
      for (let i = 0; i < 4; i++) script.push({ steer: 0, throttle: 0, boost: false, nitro: true });
      let sawActive = false;
      for (const intent of script) {
        karts.onAction(st, ctx, 'p0', { input: intent });
        tick(ctx, st);
        pose.stepSelf(p, intent, 0.1, geo);
        assert.strictEqual(p.x, k.x, `${mode} nitro rollout x matches`);
        assert.strictEqual(p.z, k.z, `${mode} nitro rollout z matches`);
        assert.strictEqual(p.speed, k.speed, `${mode} nitro rollout speed matches`);
        assert.strictEqual(p.nitro, k.nitro, `${mode} nitro charge matches`);
        assert.strictEqual(p.nitroActive, k.nitroActive, `${mode} nitro active matches`);
        assert.strictEqual(p.nitroLocked, k.nitroLocked, `${mode} nitro lock matches`);
        sawActive = sawActive || k.nitroActive;
      }
      assert(sawActive, `${mode} rollout actually boosted`);
    }
    // Garage engine tuning scales the nitro top identically on both sides.
    const [st, ctx] = racing({ mode: 'Garage Battle', map: 'Rookie Ring' });
    const k = st.karts[0]; parkFar(st, ['p0']);
    k.upgrades = { engine: 3, handling: 0, reload: 0 };
    k.garage = true; st.garage = true;
    k.x = 0; k.z = -20; k.angle = 0; k.speed = 14; k.nitro = 1; k.nitroLocked = false;
    const v = karts.view(st, 'p0');
    const tune = v.karts[0].tuning;
    assert(tune.top > 1, 'garage top applies');
    const p = { x: 0, z: -20, angle: 0, speed: 14, boost: 0, boostCd: 0, nitro: 1, nitroLocked: false, tuning: tune };
    const intent = { steer: 0, throttle: 1, boost: false, nitro: true };
    for (let i = 0; i < 6; i++) {
      karts.onAction(st, ctx, 'p0', { input: intent });
      tick(ctx, st);
      pose.stepSelf(p, intent, 0.1, { bound: st.bound, allowBoost: false });
      assert.strictEqual(p.speed, k.speed, 'garage nitro speed matches');
      assert.strictEqual(p.nitro, k.nitro, 'garage nitro charge matches');
    }
    assert(k.speed > engine.constants.MAX_SPEED * engine.constants.NITRO_SPEED, `tuned nitro exceeds stock cap, saw ${k.speed.toFixed(2)}`);
    assert(k.speed <= engine.constants.MAX_SPEED * 1.15 * engine.constants.NITRO_SPEED + 0.01, 'tuned nitro respects its cap');
    // Resnapshot adopts the tank authoritatively.
    const store = pose.createPoseStore();
    const snap = (over) => ({
      phase: 'drive',
      karts: [{ pid: 'p0', x: 0, z: 0, angle: 0, speed: 10, slip: 0, boost: 0, boostCd: 0,
        turbo: 0, padCd: 0, driftCharge: 0, drifting: false, nitro: 0.4, nitroActive: true, nitroLocked: false, ...over }],
    });
    pose.ingestSnapshot(store, snap(), 'p0', 1000);
    assert.strictEqual(store.self.nitro, 0.4, 'first sight adopts charge');
    store.self.nitro = 0.9; // prediction ran rich; server says leaner
    pose.ingestSnapshot(store, snap(), 'p0', 1100);
    assert.strictEqual(store.self.nitro, 0.4, 'charge corrects authoritatively');
    assert.strictEqual(store.self.nitroActive, true, 'active adopts');
    pose.ingestSnapshot(store, snap({ nitro: 0.1, nitroActive: false, nitroLocked: true }), 'p0', 1200);
    assert.strictEqual(store.self.nitroLocked, true, 'lock adopts');
    console.log('NITRO ok: prediction parity, garage tuning, resnapshot');
  }

  console.log('KART_NITRO_PASS');
}

main().then(() => {}, (e) => { console.error(e); process.exit(1); });
