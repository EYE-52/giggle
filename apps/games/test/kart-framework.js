// Planar-mutating unit fixtures use an explicit generic variant, not physical Pocket.
'use strict';
/* Kart framework tests: shared engine + thin variants.
 * - Steering rigor: +steer = screen right under the chase camera, anchored
 *   to screenRightOf() forwards AND reverse, across server physics,
 *   client prediction, mesh yaw, and the 2D nose mapping.
 * - Engine/pose constant agreement (no silent drift between the mirrors).
 * - Battle vertical slice: crate -> ammo -> edge fire -> hit -> shield,
 *   obstacle collision, zap blocking, goal/timer/tie finishes.
 * - Authority in battle: input-only, TTL, disconnect freeze, spectators.
 * - Variant proof: two INDEPENDENT thin games generated in-process into
 *   temp roots (no shell, no registry edit), both load, both play, and
 *   differ by config alone with no copied simulation/view source.
 * Run: npm run test:kart-framework */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const engine = require('../games/engines/kart-engine');
const karts = require('./fixtures/kart-planar-variant.cjs');
const { generate } = require('../scripts/new-game');
const { validateManifest } = require('../games/_validate');
const { Rooms } = require('../server/room');

const POSE_URL = '../public/js/games/pocket-karts-pose.mjs';

function stubCtx(opts = {}) {
  const players = opts.players || [{ id: 'pa', name: 'Ann' }, { id: 'pb', name: 'Bob' }];
  const ctx = {
    _now: opts.now !== undefined ? opts.now : 3000000,
    _broadcasts: 0,
    _awards: {},
    _connected: null,
    players: function () { return (this._connected || players).slice(); },
    allPlayers: () => players.slice(),
    content: () => ({}),
    settings: () => ({ ...(opts.settings || {}) }),
    hostId: () => 'pa',
    broadcast: () => { ctx._broadcasts += 1; },
    lobby: () => {},
    later: () => () => {},
    award: (pid, pts) => { ctx._awards[pid] = (ctx._awards[pid] || 0) + pts; },
    now: () => ctx._now,
  };
  return ctx;
}

function racing(def, settings) {
  const ctx = stubCtx(settings ? { settings } : {});
  const st = def.create(ctx);
  ctx._now += 3000;
  def.onTick(st, ctx);
  assert.strictEqual(st.phase, 'drive', 'countdown reaches drive');
  return [st, ctx];
}

function approx(a, b, tol, msg) {
  assert(Math.abs(a - b) <= tol, `${msg} (saw ${a}, want ${b})`);
}

async function main() {
  require('./kart-projectiles').run();
  const pose = await import(POSE_URL);

  // --- 1. manifest carries the framework settings ---
  {
    const keys = karts.manifest.settings.map((s) => s.key);
    for (const k of ['roundSeconds', 'targetStars', 'targetHits', 'mode', 'map', 'palette', 'winRule', 'lightCycle']) {
      assert(keys.includes(k), 'pocket-karts setting ' + k);
    }
    const mode = karts.manifest.settings.find((s) => s.key === 'mode');
    assert.deepStrictEqual(mode.options, ['Star Rush', 'Zap Battle', 'Garage Battle'], 'mode options');
    assert.strictEqual(mode.def, 'Zap Battle', 'default mode is Zap Battle');
    const defOf = (k) => karts.manifest.settings.find((s) => s.key === k).def;
    assert.strictEqual(defOf('map'), 'Garden Circuit', 'default arena is Garden Circuit');
    assert.strictEqual(defOf('roundSeconds'), 180, 'default round is 180s');
    assert.strictEqual(defOf('winRule'), 'Time limit', 'default win rule is Time limit');
    assert.strictEqual(defOf('lightCycle'), 'Live sunset', 'default light is Live sunset');
    assert(validateManifest(karts).ok, 'engine-built manifest validates');
    console.log('KART ok: manifest (mode/map/targets/win-rule/light settings)');
  }

  // --- 2. steering anchored to camera-right, forwards and reverse ---
  {
    const { forwardOf, screenRightOf } = engine.helpers;
    // At angle 0 the kart faces +z with the chase camera behind at -z, so
    // screen right is world -x. This is the anchor everything else obeys.
    approx(forwardOf(0).x, 0, 1e-12, 'forward(0).x');
    approx(forwardOf(0).z, 1, 1e-12, 'forward(0).z');
    approx(screenRightOf(0).x, -1, 1e-12, 'screenRight(0).x');
    approx(screenRightOf(0).z, 0, 1e-12, 'screenRight(0).z');
    // Forwards: +steer (right key) must move toward screen right.
    // (Explicit legacy Rush/Ring: steering physics must not depend on defaults.)
    let [st, ctx] = racing(karts, { mode: 'Star Rush', map: 'Rookie Ring' });
    const k = st.karts[0];
    k.x = 0; k.z = -20; k.angle = 0; k.speed = 8;
    karts.onAction(st, ctx, 'pa', { input: { steer: 1, throttle: 1 } });
    ctx._now += 100;
    karts.onTick(st, ctx);
    const sr = screenRightOf(0);
    const dot = (k.x - 0) * sr.x + (k.z - -20) * sr.z;
    assert(k.angle < 0, `right turn decreases angle, saw ${k.angle}`);
    assert(k.x < 0, `right turn moves -x (screen right), saw ${k.x}`);
    assert(dot > 0, `displacement aligns with screen right, dot=${dot}`);
    // Reverse keeps the car-like inversion: +steer swings the nose the
    // other way while backing up.
    [st, ctx] = racing(karts, { mode: 'Star Rush', map: 'Rookie Ring' });
    const kr = st.karts[0];
    kr.x = 0; kr.z = -20; kr.angle = 0; kr.speed = -4;
    karts.onAction(st, ctx, 'pa', { input: { steer: 1, throttle: -1 } });
    ctx._now += 100;
    karts.onTick(st, ctx);
    assert(kr.angle > 0, `reverse +steer increases angle, saw ${kr.angle}`);
    // Prediction mirror obeys the same anchor (forwards + reverse).
    const pf = { x: 0, z: -20, angle: 0, speed: 8, boost: 0, boostCd: 0 };
    pose.stepSelf(pf, { steer: 1, throttle: 1, boost: false }, 0.1);
    assert(pf.angle < 0 && pf.x < 0, 'prediction: right turn goes screen right');
    const pr = { x: 0, z: -20, angle: 0, speed: -4, boost: 0, boostCd: 0 };
    pose.stepSelf(pr, { steer: 1, throttle: -1, boost: false }, 0.1);
    assert(pr.angle > 0, 'prediction: reverse keeps the inversion');
    assert.strictEqual(pf.x, k.x, 'server and prediction agree bit-for-bit (forward)');
    console.log('KART ok: steering = screen right (server + prediction, fwd + rev)');
  }

  // --- 3. mesh yaw, 2D nose, and input mapping share the model ---
  {
    // Mesh: nose +z rotated by Three.js yaw a lands on (sin a, cos a) —
    // exactly forwardOf, so visual forward matches motion by construction.
    for (const a of [0, 0.5, -1.2, Math.PI, -Math.PI + 0.1]) {
      const nose = { x: Math.sin(a), z: Math.cos(a) }; // yaw-rotated +z
      const f = engine.helpers.forwardOf(a);
      approx(nose.x, f.x, 1e-12, `mesh forward x at a=${a}`);
      approx(nose.z, f.z, 1e-12, `mesh forward z at a=${a}`);
      // 2D fallback: nose drawn pointing up (0,-1), canvas +x right and
      // +z DOWN, rotated by canvasNoseRotation(a) must equal (sin a, cos a).
      const t = pose.canvasNoseRotation(a);
      const nx = 0 * Math.cos(t) - (-1) * Math.sin(t);
      const ny = 0 * Math.sin(t) + (-1) * Math.cos(t);
      approx(nx, f.x, 1e-9, `2D nose x at a=${a}`);
      approx(ny, f.z, 1e-9, `2D nose z at a=${a}`);
      // Client pose module agrees with the server engine on both vectors.
      approx(pose.forwardOf(a).x, f.x, 1e-12, 'pose/server forward agree');
      approx(pose.screenRightOf(a).x, engine.helpers.screenRightOf(a).x, 1e-12, 'pose/server right agree');
    }
    // Input mapping: left -1, right +1, gas/brake on throttle, incl. touch.
    const S = (arr) => new Set(arr);
    assert.deepStrictEqual(pose.intentFromKeys(S(['left']), {}), { steer: -1, throttle: 0 }, 'key left');
    assert.deepStrictEqual(pose.intentFromKeys(S(['right']), {}), { steer: 1, throttle: 0 }, 'key right');
    assert.deepStrictEqual(pose.intentFromKeys(S(['up']), {}), { steer: 0, throttle: 1 }, 'key up');
    assert.deepStrictEqual(pose.intentFromKeys(S(['down']), {}), { steer: 0, throttle: -1 }, 'key down');
    assert.deepStrictEqual(pose.intentFromKeys(S([]), { left: true, gas: true }), { steer: -1, throttle: 1 }, 'touch left+gas');
    assert.deepStrictEqual(pose.intentFromKeys(S([]), { right: true, brake: true }), { steer: 1, throttle: -1 }, 'touch right+brake');
    console.log('KART ok: mesh yaw + 2D nose + key/touch mapping aligned');
  }

  // --- 4. engine <-> pose constants agree (no silent drift) ---
  {
    const c = engine.constants;
    assert.strictEqual(pose.MAX_SPEED, c.MAX_SPEED, 'MAX_SPEED');
    assert.strictEqual(pose.MAX_REVERSE, c.MAX_REVERSE, 'MAX_REVERSE');
    assert.strictEqual(pose.ACCEL, c.ACCEL, 'ACCEL');
    assert.strictEqual(pose.BRAKE, c.BRAKE, 'BRAKE');
    assert.strictEqual(pose.DRAG, c.DRAG, 'DRAG');
    assert.strictEqual(pose.TURN_RATE, c.TURN_RATE, 'TURN_RATE');
    assert.strictEqual(pose.BOOST_SPEED, c.BOOST_SPEED, 'BOOST_SPEED');
    assert.strictEqual(pose.BOOST_TIME, c.BOOST_TIME, 'BOOST_TIME');
    assert.strictEqual(pose.BOOST_CD, c.BOOST_COOLDOWN, 'BOOST_CD');
    assert.strictEqual(pose.BOUND, c.BOUND, 'BOUND');
    assert.strictEqual(pose.KART_R, c.KART_R, 'KART_R');
    console.log('KART ok: physics constants agree across the mirror');
  }

  // --- 5. battle: crate -> item -> edge fire -> KO -> respawn -> goal ---
  {
    // Explicit Score-target goal: the default Time-limit rule plays on.
    const [st, ctx] = racing(karts, { mode: 'Zap Battle', map: 'Rookie Ring', winRule: 'Score target', targetHits: 2 });
    assert.strictEqual(st.mode, 'battle', 'host setting selects battle');
    assert.strictEqual(st.crates.length, 6, 'clamp(4+2 drivers, 6, 10) crates');
    assert.deepStrictEqual(st.zaps, [], 'no zaps yet');
    assert.deepStrictEqual(st.mines, [], 'no mines yet');
    const a = st.karts[0];
    const b = st.karts[1];
    assert.strictEqual(a.ammo, 0, 'drivers start unarmed');
    assert.strictEqual(a.weapon, null, 'drivers start with an empty slot');
    assert.strictEqual(a.shield, 2.5, 'drivers start spawn-shielded');
    // Crate pickup loads one mystery item (exactly once, new crate id).
    a.x = st.crates[0].x; a.z = st.crates[0].z; a.speed = 0;
    const firstId = st.crates[0].id;
    karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 0 } });
    ctx._now += 100;
    karts.onTick(st, ctx);
    assert(['pulse', 'scatter', 'mine', 'shield', 'rocket', 'rail', 'grenade', 'emp'].includes(a.weapon), 'crate grants an item, saw ' + a.weapon);
    assert(a.ammo > 0, 'item has uses');
    assert.strictEqual(st.crates.length, 6, 'crate count stays constant');
    assert(!st.crates.some((c) => c.id === firstId), 'consumed crate relocates with a new id');
    // Rising-edge fire: one zap per press (pulse spends 1 of 3).
    a.weapon = 'pulse'; a.ammo = 3; a.shield = 0; a.fireCd = 0; a.prevAction = false;
    a.x = 0; a.z = -10; a.angle = 0; a.speed = 0;
    // This wound isolates rising-edge fire, KO cleanup and score-target contracts.
    // Default100-health damage and repeated accepted shots live in kart-health.mjs.
    b.x = 0; b.z = 5; b.angle = 0; b.speed = 0; b.shield = 0; b.health = 1;
    karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 0, boost: true } });
    ctx._now += 100;
    karts.onTick(st, ctx);
    assert.strictEqual(st.zaps.length, 1, 'press fires one zap');
    assert.strictEqual(st.zaps[0].kind, 'pulse', 'zap carries its kind');
    assert.strictEqual(a.ammo, 2, 'ammo spent');
    for (let i = 0; i < 10 && st.zaps.length; i++) {
      ctx._now += 100;
      karts.onTick(st, ctx);
    }
    assert.strictEqual(a.hits, 1, 'zap KOs for the shooter');
    assert.strictEqual(st.scores.pa, 1, 'game score tracks KOs');
    assert(b.respawn > 0, 'victim sits out a respawn');
    assert.strictEqual(b.weapon, null, 'KO clears the victim item');
    assert.strictEqual(b.deaths, 1, 'KO records the death');
    assert.strictEqual(b.speed, 0, 'victim stopped cold');
    // A shield consumes the follow-up (zap dies, no KO, no score).
    for (let i = 0; i < 25 && b.respawn > 0; i++) { // respawn first (2 s out)
      ctx._now += 100;
      karts.onTick(st, ctx);
    }
    assert.strictEqual(b.respawn, 0, 'victim rejoins');
    assert(b.shield > 0, 'rejoin carries spawn protection');
    b.x = 5; b.z = 5;
    a.x = 5; a.z = 0; a.angle = 0; a.weapon = 'pulse'; a.ammo = 3; a.fireCd = 0; a.prevAction = false;
    karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 0, boost: true } });
    for (let i = 0; i < 8; i++) {
      ctx._now += 100;
      karts.onTick(st, ctx);
    }
    assert.strictEqual(a.hits, 1, 'shielded victim grants no second KO');
    // Second KO lands the Score-target goal immediately.
    b.shield = 0; b.x = 0; b.z = 5; b.health = 1;
    a.x = 0; a.z = 0; a.angle = 0; a.weapon = 'pulse'; a.ammo = 3; a.fireCd = 0; a.prevAction = false;
    karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 0, boost: true } });
    for (let i = 0; i < 6 && st.phase !== 'done'; i++) {
      ctx._now += 100;
      karts.onTick(st, ctx);
    }
    assert.strictEqual(st.phase, 'done', 'KO goal finishes the battle');
    assert.strictEqual(st.result.winner, 'pa', 'goal scorer wins');
    assert.strictEqual(st.result.endReason, 'goal', 'goal end reason');
    assert.strictEqual(ctx._awards.pa, 300, 'the winner earns 300 at match end');
    const v = karts.view(st, 'pa');
    assert.strictEqual(v.mode, 'battle', 'view carries the mode');
    assert(Array.isArray(v.crates) && Array.isArray(v.zaps), 'view carries crates+zaps');
    assert(Array.isArray(v.mines) && Array.isArray(v.events), 'view carries mines+events');
    assert(!('stars' in v), 'battle view has no stars');
    assert.strictEqual(v.karts[0].hits, 2, 'view carries KOs');
    assert(!('input' in v.karts[0]), 'inputs never leak into battle views');
    assert(!('seed' in v) && !('rngState' in v), 'RNG state never leaks into views');
    console.log('KART ok: battle loop (crate, edge fire, KO, respawn, shield, goal)');
  }

  // --- 6. battle: holds never auto-fire, no boost in battle ---
  {
    const [st, ctx] = racing(karts, { mode: 'battle', map: 'Rookie Ring' });
    const c = st.karts[0];
    c.weapon = 'pulse'; c.ammo = 3; c.shield = 0; c.x = 0; c.z = -20; c.angle = 0; c.speed = 0;
    karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 1, boost: true } });
    for (let i = 0; i < 20; i++) {
      // 500 ms keepalive holds the button down across the TTL, exactly
      // like a real client — still exactly one rising edge total.
      if (i % 5 === 0) karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 1, boost: true } });
      ctx._now += 100;
      karts.onTick(st, ctx);
    }
    assert.strictEqual(st.zapSeq, 1, '2s hold fires exactly once');
    assert.strictEqual(c.boost, 0, 'no boost timer in battle');
    assert(c.speed <= engine.constants.MAX_SPEED, 'no boosted top speed in battle');
    // Prediction mirror matches the server exactly with boost disabled.
    const p = { x: 0, z: -20, angle: 0, speed: 0, boost: 0, boostCd: 0 };
    for (let i = 0; i < 20; i++) {
      pose.stepSelf(p, { steer: 0, throttle: 1, boost: true }, 0.1, { allowBoost: false });
    }
    approx(p.x, c.x, 1e-9, 'battle prediction x matches server');
    approx(p.z, c.z, 1e-9, 'battle prediction z matches server');
    assert.strictEqual(p.boost, 0, 'prediction pops no boost in battle');
    console.log('KART ok: edge-only fire, boost fully off in battle');
  }

  // --- 7. obstacles: karts collide, zaps die, spawns stay clear ---
  {
    const [st, ctx] = racing(karts, { mode: 'Zap Battle', map: 'Bumper Blocks' });
    assert.strictEqual(st.map, 'blocks', 'host setting selects the blocks map');
    assert.strictEqual(st.blocks.length, 4, 'four bumper blocks');
    const v = karts.view(st, 'pa');
    assert.strictEqual(v.map.id, 'blocks', 'view carries the map id');
    assert.deepStrictEqual(v.map.blocks, st.blocks, 'view carries block geometry (single source)');
    // Every pickup socket and every legal spawn pose stays clear of blocks.
    for (const [sx, sz] of st.spots) {
      for (const b of st.blocks) {
        const inside = Math.abs(sx - b.x) < b.hw + 1.5 && Math.abs(sz - b.z) < b.hd + 1.5;
        assert(!inside, `spot (${sx},${sz}) clear of block (${b.x},${b.z})`);
      }
    }
    assert(st.spawns.length >= 8, 'spawn pool covers a full room');
    for (const s of st.spawns) {
      for (const b of st.blocks) {
        assert(Math.abs(s.x - b.x) > b.hw + 1.5 || Math.abs(s.z - b.z) > b.hd + 1.5,
          `spawn (${s.x.toFixed(1)},${s.z.toFixed(1)}) clear of block (${b.x},${b.z})`);
      }
    }
    // Driving into a block pushes out and scrubs speed.
    const a = st.karts[0];
    a.x = 16; a.z = 12.5; a.angle = 0; a.speed = 10;
    karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 1 } });
    for (let i = 0; i < 5; i++) {
      ctx._now += 100;
      karts.onTick(st, ctx);
    }
    approx(a.z, 13.5 - engine.constants.KART_R, 0.05, 'kart rests on the block face');
    assert(a.speed < 10, 'block hit scrubs speed');
    // Zaps die on blocks.
    a.x = 16; a.z = 5; a.angle = 0; a.weapon = 'pulse'; a.ammo = 3; a.shield = 0; a.fireCd = 0; a.prevAction = false;
    karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 0, boost: true } });
    ctx._now += 50;
    karts.onTick(st, ctx);
    assert.strictEqual(st.zaps.length, 1, 'zap away toward the block');
    for (let i = 0; i < 10 && st.zaps.length; i++) {
      ctx._now += 100;
      karts.onTick(st, ctx);
    }
    assert.strictEqual(st.zaps.length, 0, 'block swallows the zap');
    // Star Rush plays on the blocks map too (stars use map spots).
    const [stR] = racing(karts, { mode: 'Star Rush', map: 'Bumper Blocks' });
    assert.strictEqual(stR.stars.length, 6, 'rush on blocks: six stars');
    console.log('KART ok: bumper blocks (kart + zap collision, clear spawns)');
  }

  // --- 8. battle authority: injection, TTL, freeze, spectators, ties ---
  {
    const [st, ctx] = racing(karts, { mode: 'battle', map: 'Rookie Ring' });
    const a = st.karts[0];
    const ax = a.x;
    karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 0 }, x: 999, z: -999, hits: 99, ammo: 99, weapon: 'pulse', shield: 99, respawn: 0, spawnSeq: 9, deaths: 9, score: 1e9 });
    assert.strictEqual(a.x, ax, 'x injection ignored in battle');
    assert.strictEqual(a.hits, 0, 'hits injection ignored');
    assert.strictEqual(a.ammo, 0, 'ammo injection ignored');
    assert.strictEqual(a.weapon, null, 'weapon injection ignored');
    assert.strictEqual(a.shield, 2.5, 'shield injection ignored');
    assert.strictEqual(a.spawnSeq, 0, 'spawnSeq injection ignored');
    assert.strictEqual(a.deaths, 0, 'deaths injection ignored');
    // TTL: silence expires the held intent in battle too.
    a.x = 0; a.z = -20; a.angle = 0; a.speed = 0;
    karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 1 } });
    for (let i = 0; i < 5; i++) {
      ctx._now += 100;
      karts.onTick(st, ctx);
    }
    assert(a.speed > 0, 'held throttle drives while fresh');
    for (let i = 0; i < 65; i++) {
      ctx._now += 100;
      karts.onTick(st, ctx);
    }
    assert.deepStrictEqual(a.input, { steer: 0, throttle: 0, boost: false }, 'silent intent expires');
    assert.strictEqual(a.speed, 0, 'expired kart stops');
    // Disconnect freezes: no fire, no pickup, no drift, held timers.
    ctx._connected = [{ id: 'pb', name: 'Bob' }];
    a.weapon = 'pulse'; a.ammo = 3; a.prevAction = false;
    a.speed = 17; a.slip = 3; a.drifting = true; a.driftCharge = 1;
    a.nitroActive = true; a.pendingFire = true;
    a.input = { throttle: 1, steer: 1, boost: true, drift: true, nitro: true };
    const parked = { x: a.x, z: a.z, nitro: a.nitro };
    karts.onConnection(st, ctx, 'pa', false);
    assert.deepStrictEqual(a.input, { steer: 0, throttle: 0, boost: false }, 'connection hook immediately neutralizes held input');
    assert.strictEqual(a.speed, 0, 'connection hook immediately stops classic speed');
    assert.strictEqual(a.slip, 0, 'connection hook immediately stops lateral motion');
    assert.strictEqual(a.drifting, false, 'connection hook clears drift');
    assert.strictEqual(a.driftCharge, 0, 'connection hook cannot mint release turbo');
    assert.strictEqual(a.nitroActive, false, 'connection hook clears active Nitro');
    assert.strictEqual(a.pendingFire, false, 'connection hook drops pending fire');
    assert.deepStrictEqual({ x: a.x, z: a.z, nitro: a.nitro }, parked, 'connection hook preserves pose and tank without stepping');
    karts.onConnection(st, ctx, 'pa', true);
    assert.strictEqual(a.input.throttle, 0, 'reconnection needs fresh drive intent');
    const frozenShield = a.shield;
    st.crates[0].x = a.x; st.crates[0].z = a.z;
    karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 1, boost: true } });
    const fx = a.x;
    const fz = a.z;
    for (let i = 0; i < 10; i++) {
      ctx._now += 100;
      karts.onTick(st, ctx);
    }
    assert.strictEqual(st.zaps.length, 0, 'offline kart fires nothing');
    assert.strictEqual(a.ammo, 3, 'offline kart picks up nothing');
    assert.strictEqual(a.shield, frozenShield, 'offline shield never ticks down');
    assert.strictEqual(a.x, fx, 'offline kart never drifts');
    assert.strictEqual(a.z, fz, 'offline kart never drifts (z)');
    ctx._connected = null;
    // Timer tie shares the win in battle.
    st.karts[0].hits = 2;
    st.karts[1].hits = 2;
    st.karts[0].x = 24; st.karts[0].z = 24;
    st.karts[1].x = -24; st.karts[1].z = -24;
    ctx._now = st.endsAt + 1;
    karts.onTick(st, ctx);
    assert.strictEqual(st.phase, 'done', 'tied battle finishes');
    assert.strictEqual(st.result.winner, null, 'a tie has no sole winner');
    assert.deepStrictEqual(st.result.winners, ['pa', 'pb'], 'both share the battle win');
    assert.strictEqual(ctx._awards.pa, 150, 'a tied two-driver battle is a draw worth 150');
    assert.strictEqual(ctx._awards.pb, 150, 'each driver in the draw earns 150');
    console.log('KART ok: battle authority (injection, TTL, freeze, tie)');
  }

  // --- 9. battle spectators via a real room ---
  {
    const rooms = new Rooms({});
    const room = rooms.create();
    const sent = [];
    const fakeSock = () => ({
      readyState: 1, send(m) { sent.push(JSON.parse(m)); }, close() { this.readyState = 3; },
    });
    const sA = fakeSock();
    const sB = fakeSock();
    const { player: pa } = room.addPlayer('Ann', sA);
    room.addPlayer('Bob', sB);
    const r = room.startGame(karts, { settings: { mode: 'Zap Battle', map: 'Bumper Blocks' } }, pa.id);
    assert(!r.error, 'battle starts in a room: ' + (r.error || 'ok'));
    assert.strictEqual(room.game.state.mode, 'battle', 'room honors the mode setting');
    const sL = fakeSock();
    const { player: late } = room.addPlayer('Late', sL);
    assert(room.isSpectator(late.id), 'mid-battle joiner spectates');
    sent.length = 0;
    room.onAction(sL, { input: { steer: 1, throttle: 1, boost: true }, t: Date.now() });
    assert.strictEqual(sent.length, 0, 'spectator fire broadcasts nothing');
    assert(!room.game.state.karts.some((kk) => kk.pid === late.id), 'spectator gets no kart');
    console.log('KART ok: battle spectators blocked by the room');
  }

  // --- 10. two independent thin variants, in-process, temp roots ---
  {
    const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'kart-var-a-'));
    const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'kart-var-b-'));
    try {
      // In-process generation: no shell, no registry edit.
      const genA = generate('alpha-karts', { root: tmpA, template: 'kart' });
      const genB = generate('beta-karts', { root: tmpB, template: 'kart' });
      assert.deepStrictEqual(genA.files.length, 3, 'three files per variant');
      // Variant B declares a different game by config alone.
      const srvB = path.join(tmpB, 'games', 'beta-karts', 'server.js');
      let srcB = fs.readFileSync(srvB, 'utf8');
      srcB = srcB
        .replace("mode: 'battle'", "mode: 'starrush'")
        .replace("map: 'blocks'", "map: 'ring'")
        .replace("palette: 'Sunset'", "palette: 'Starlight'");
      // (keep the edit declarative: only config values change)
      assert(srcB.includes("mode: 'starrush'") && srcB.includes("map: 'ring'"), 'B config edit applied');
      fs.writeFileSync(srvB, srcB);
      assert(!fs.existsSync(path.join(ROOT, 'games', 'alpha-karts')), 'repo games/ untouched by A');
      assert(!fs.existsSync(path.join(ROOT, 'games', 'beta-karts')), 'repo games/ untouched by B');

      const defA = require(path.join(tmpA, 'games', 'alpha-karts', 'server.js'));
      const defB = require(path.join(tmpB, 'games', 'beta-karts', 'server.js'));
      assert.strictEqual(defA.id, 'alpha-karts', 'A loads with its id');
      assert.strictEqual(defB.id, 'beta-karts', 'B loads with its id');
      assert(validateManifest(defA).ok && validateManifest(defB).ok, 'both manifests validate');
      // Old derived games predate the win-rule setting: goals still count.
      for (const def of [defA, defB]) {
        const wr = def.manifest.settings.find((s) => s.key === 'winRule');
        assert(wr && wr.def === 'Score target', def.id + ' keeps the Score-target default');
        const lc = def.manifest.settings.find((s) => s.key === 'lightCycle');
        assert(lc && lc.def === 'Fixed light', def.id + ' keeps the Fixed-light default');
      }
      assert.strictEqual(defA.manifest.name, 'Alpha Karts', 'A title');
      assert.strictEqual(defB.manifest.name, 'Beta Karts', 'B title');

      // Lifecycle both, with config differences honored.
      const mkCtx = (settings) => {
        const players = [{ id: 'pa', name: 'A' }, { id: 'pb', name: 'B' }];
        let now = 9000000;
        return {
          players: () => players.slice(), allPlayers: () => players.slice(),
          content: () => ({}), settings: () => ({ ...settings }), hostId: () => 'pa',
          broadcast: () => {}, lobby: () => {}, later: () => () => {}, award: () => {},
          now: () => now, _tick: (ms) => { now += ms; },
        };
      };
      const ctxA = mkCtx({});
      const stA = defA.create(ctxA);
      const ctxB = mkCtx({});
      const stB = defB.create(ctxB);
      assert.strictEqual(stA.mode, 'battle', 'A defaults to battle');
      assert.strictEqual(stA.map, 'blocks', 'A defaults to blocks');
      assert.strictEqual(stB.mode, 'starrush', 'B defaults to rush by config');
      assert.strictEqual(stB.map, 'ring', 'B defaults to ring by config');
      assert.strictEqual(stB.palette, 'Starlight', 'B palette by config');
      for (const [def, st, ctx] of [[defA, stA, ctxA], [defB, stB, ctxB]]) {
        ctx._tick(3000);
        def.onTick(st, ctx);
        assert.strictEqual(st.phase, 'drive', def.id + ' reaches drive');
        def.onAction(st, ctx, 'pa', { input: { steer: 0.5, throttle: 1 } });
        for (let i = 0; i < 5; i++) {
          ctx._tick(100);
          def.onTick(st, ctx);
        }
        const vv = def.view(st, 'pa');
        assert(vv.youDrive && vv.karts.length === 2, def.id + ' view drives');
      }
      // Independence: ticking A never moves B.
      const bx = stB.karts[0].x;
      const bz = stB.karts[0].z;
      defA.onAction(stA, ctxA, 'pa', { input: { steer: 1, throttle: 1 } });
      for (let i = 0; i < 10; i++) {
        ctxA._tick(100);
        defA.onTick(stA, ctxA);
      }
      assert.strictEqual(stB.karts[0].x, bx, 'B unaffected by A ticks');
      assert.strictEqual(stB.karts[0].z, bz, 'B unaffected by A ticks (z)');
      const vA = defA.view(stA, 'pa');
      const vB = defB.view(stB, 'pa');
      assert(Array.isArray(vA.crates) && !('stars' in vA), 'A view is battle-shaped');
      assert(Array.isArray(vB.stars) && !('crates' in vB), 'B view is rush-shaped');

      // Thinness: no copied simulation/view source in EITHER variant.
      for (const [tmp, id] of [[tmpA, 'alpha-karts'], [tmpB, 'beta-karts']]) {
        const srv = fs.readFileSync(path.join(tmp, 'games', id, 'server.js'), 'utf8');
        const cli = fs.readFileSync(path.join(tmp, 'public', 'js', 'games', id + '.js'), 'utf8');
        assert(srv.split('\n').length <= 45, `${id} server stays thin`);
        assert(cli.split('\n').length <= 15, `${id} client stays thin`);
        for (const banned of ['stepKart', 'framePoses', 'Math.sin', 'new THREE', 'createPoseStore', 'collideBlocks']) {
          assert(!srv.includes(banned) && !cli.includes(banned), `${id} copies no ${banned}`);
        }
        assert(srv.includes('createKartGame'), id + ' server uses the engine factory');
        assert(cli.includes('createKartView'), id + ' client uses the view factory');
      }
      // Registry untouched: temp variants are never catalog games.
      const registry = require('../games/registry');
      assert(!registry.list().some((g) => g.id === 'alpha-karts' || g.id === 'beta-karts'),
        'variants never leak into the catalog');
      console.log('KART ok: two thin variants (temp roots, in-process, independent)');
    } finally {
      fs.rmSync(tmpA, { recursive: true, force: true });
      fs.rmSync(tmpB, { recursive: true, force: true });
    }
  }

  console.log('KART_FRAMEWORK_PASS');
}

main().then(
  () => {},
  (e) => { console.error(e); process.exit(1); },
);
