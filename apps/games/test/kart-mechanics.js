// Planar-mutating unit fixtures use an explicit generic variant, not physical Pocket.
'use strict';
/* Kart mechanics tests: new maps, drift/mini-turbo, pads, ice, sliding
 * collisions, kart contact, and server/prediction parity across all of it.
 * - Map contract: every arena carries {id,label,theme,blocks,pads,
 *   surfaces}; spawns for 2-8 drivers and all pickup spots stay clear;
 *   pads never overlap obstacles; every spawn/spot is mutually reachable.
 * - Drift: boolean-only intent, armed only in a forward turn at speed;
 *   charge accrues 0..1, a full charge releases EXACTLY once, parked /
 *   straight / reversing karts earn nothing, fake values never arm it.
 * - Pads (both modes) and ice change the sim identically on the server
 *   and in prediction; glancing hits slide, hitches never tunnel, kart
 *   contact separates deterministically without scoring or free energy.
 * - TTL/disconnect/reset clear drift state; snapshots expose the feedback
 *   fields the views read. Run: node test/kart-mechanics.js */

const assert = require('assert');

const engine = require('../games/engines/kart-engine');
const karts = require('./fixtures/kart-planar-variant.cjs');
const maps = require('../games/engines/kart-maps');

const POSE_URL = '../public/js/games/pocket-karts-pose.mjs';
const BOUND = engine.constants.BOUND;
const NEED = engine.constants.DRIFT_CHARGE_NEED;

function stubCtx(opts = {}) {
  const players = opts.players || [{ id: 'pa', name: 'Ann' }, { id: 'pb', name: 'Bob' }];
  const ctx = {
    _now: opts.now !== undefined ? opts.now : 7000000,
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

function racing(settings, n = 2) {
  const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const ctx = stubCtx({ players, settings });
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

function approx(a, b, tol, msg) {
  assert(Math.abs(a - b) <= tol, `${msg} (saw ${a}, want ${b})`);
}

async function main() {
  const pose = await import(POSE_URL);

  // --- 1. map contract: shape, labels, themes, geometry sanity ---
  {
    const want = {
      ring: ['Rookie Ring', 'ring', 30, 0, 0, 0],
      blocks: ['Bumper Blocks', 'blocks', 30, 4, 0, 0],
      garden: ['Garden Circuit', 'garden', 60, 6, 2, 0],
      frost: ['Frosty Pass', 'frost', 60, 6, 2, 5],
      neon: ['Neon Yard', 'neon', 60, 6, 3, 0],
    };
    assert.deepStrictEqual(maps.mapIds(), ['ring', 'blocks', 'garden', 'frost', 'neon'], 'map roster');
    for (const [id, [label, theme, half, nb, np, ns]] of Object.entries(want)) {
      const m = maps.mapDef(id);
      const bound = half - 2;
      assert.strictEqual(m.label, label, id + ' label');
      assert.strictEqual(m.theme, theme, id + ' theme');
      assert.strictEqual(m.half, half, id + ' half-extent');
      assert.strictEqual(m.blocks.length, nb, id + ' block count');
      assert.strictEqual(m.pads.length, np, id + ' pad count');
      assert.strictEqual(m.surfaces.length, ns, id + ' surface count');
      assert(m.spots.length >= (half > 30 ? 32 : 24), id + ' has full socket list');
      assert(m.spawns.length >= 8, id + ' spawn pool covers a full room');
      for (const b of m.blocks) {
        assert(Math.abs(b.x) + b.hw <= bound && Math.abs(b.z) + b.hd <= bound, `${id} block in bounds`);
        assert(b.hw > 0 && b.hd > 0, `${id} block has size`);
      }
      for (const p of m.pads) {
        assert(Math.abs(p.x) + p.hw <= bound && Math.abs(p.z) + p.hd <= bound, `${id} pad in bounds`);
        for (const b of m.blocks) {
          const overlap = Math.abs(p.x - b.x) < p.hw + b.hw && Math.abs(p.z - b.z) < p.hd + b.hd;
          assert(!overlap, `${id} pad (${p.x},${p.z}) clear of block (${b.x},${b.z})`);
        }
      }
      for (const s of m.surfaces) {
        assert(s.grip > 0 && s.grip <= 1.5, `${id} surface grip sane`);
        assert(Math.abs(s.x) + s.hw <= bound && Math.abs(s.z) + s.hd <= bound, `${id} surface in bounds`);
      }
      // No neat obstacle rows on the large arenas: at most 2 blocks share
      // an x or z center line.
      if (half > 30) {
        const xc = {};
        const zc = {};
        for (const b of m.blocks) {
          xc[b.x] = (xc[b.x] || 0) + 1;
          zc[b.z] = (zc[b.z] || 0) + 1;
        }
        assert(Math.max(...Object.values(xc)) <= 2, id + ' has no column row');
        assert(Math.max(...Object.values(zc)) <= 2, id + ' has no lane row');
      }
    }
    // Garden keeps a broad center passage (no cover near the middle).
    for (const b of maps.mapDef('garden').blocks) {
      assert(Math.abs(b.x) - b.hw >= 10 || Math.abs(b.z) - b.hd >= 10, 'garden center stays open');
    }
    // The view carries the whole contract; the renderers draw from it.
    const [st] = racing({ mode: 'Star Rush', map: 'Frosty Pass' });
    assert.strictEqual(st.map, 'frost', 'label setting selects frost');
    assert.strictEqual(st.half, 60, 'large arena half');
    assert.strictEqual(st.bound, 58, 'large arena bound');
    const v = karts.view(st, 'p0');
    assert.deepStrictEqual(Object.keys(v.map).sort(),
      ['blocks', 'bound', 'half', 'id', 'label', 'pads', 'surfaces', 'theme'], 'map snapshot keys');
    assert.strictEqual(v.map.id, 'frost', 'snapshot id');
    assert.strictEqual(v.map.label, 'Frosty Pass', 'snapshot label');
    assert.strictEqual(v.map.theme, 'frost', 'snapshot theme');
    assert.strictEqual(v.map.half, 60, 'snapshot half');
    assert.strictEqual(v.map.bound, 58, 'snapshot bound');
    assert.deepStrictEqual(v.map.blocks, st.blocks, 'snapshot blocks are the server geometry');
    assert.deepStrictEqual(v.map.pads, st.pads, 'snapshot pads are the server geometry');
    assert.deepStrictEqual(v.map.surfaces, st.surfaces, 'snapshot surfaces are the server geometry');
    console.log('MECH ok: map contract (5 arenas, labels, themes, geometry)');
  }

  // --- 2. spawn pools, sockets, and route connectivity on every map ---
  {
    const rectDist = (x, z, b) => Math.hypot(
      Math.max(Math.abs(x - b.x) - b.hw, 0), Math.max(Math.abs(z - b.z) - b.hd, 0));
    for (const id of maps.mapIds()) {
      const m = maps.mapDef(id);
      const bound = m.half - 2;
      // Large arenas hold a 2.4u clear radius around every candidate;
      // legacy small arenas keep their historical 1.5u margin.
      const need = m.half > 30 ? 2.4 : 1.5;
      for (const s of m.spawns) {
        assert(Math.abs(s.x) <= bound - engine.constants.KART_R && Math.abs(s.z) <= bound - engine.constants.KART_R,
          `${id} spawn in bounds (${s.x},${s.z})`);
        assert(Number.isFinite(s.angle), `${id} spawn faces somewhere`);
        for (const b of m.blocks) {
          assert(rectDist(s.x, s.z, b) >= need, `${id} spawn (${s.x},${s.z}) clear of block (${b.x},${b.z})`);
        }
      }
      for (const [sx, sz] of m.spots) {
        assert(Math.abs(sx) <= bound - engine.constants.KART_R && Math.abs(sz) <= bound - engine.constants.KART_R, `${id} spot in bounds`);
        for (const b of m.blocks) {
          assert(rectDist(sx, sz, b) >= need, `${id} spot (${sx},${sz}) clear of block (${b.x},${b.z})`);
        }
      }
      // The opening pair meets quickly: nearby central pockets, never
      // isolated at opposite outer corners.
      const d01 = Math.hypot(m.spawns[0].x - m.spawns[1].x, m.spawns[0].z - m.spawns[1].z);
      assert(d01 < (m.half > 30 ? 45 : 30), `${id} opening pair meets fast (d=${d01.toFixed(1)})`);
      // BFS on a 1u grid with hull clearance: every spawn and socket joins
      // one connected region (no trapped seats or pickups).
      const N = bound * 2 + 1;
      const at = (x, z) => (z + bound) * N + (x + bound);
      const blocked = new Uint8Array(N * N);
      for (let gx = -bound; gx <= bound; gx++) {
        for (let gz = -bound; gz <= bound; gz++) {
          for (const b of m.blocks) {
            if (Math.abs(gx - b.x) < b.hw + 1.5 && Math.abs(gz - b.z) < b.hd + 1.5) {
              blocked[at(gx, gz)] = 1;
              break;
            }
          }
        }
      }
      assert(!blocked[at(0, -12)], `${id} BFS seed is open`);
      const seen = new Uint8Array(N * N);
      const q = [[0, -12]];
      seen[at(0, -12)] = 1;
      while (q.length) {
        const [cx, cz] = q.pop();
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < -bound || nx > bound || nz < -bound || nz > bound) continue;
          if (blocked[at(nx, nz)] || seen[at(nx, nz)]) continue;
          seen[at(nx, nz)] = 1;
          q.push([nx, nz]);
        }
      }
      const reach = (x, z) => [Math.floor(x), Math.ceil(x)].some((gx) =>
        [Math.floor(z), Math.ceil(z)].some((gz) =>
          gx >= -bound && gx <= bound && gz >= -bound && gz <= bound && seen[at(gx, gz)]));
      for (const s of m.spawns) assert(reach(s.x, s.z), `${id} spawn (${s.x},${s.z}) reachable`);
      for (const [sx, sz] of m.spots) assert(reach(sx, sz), `${id} spot (${sx},${sz}) reachable`);
      // ...and every new map actually differs from four corner blocks.
      if (id !== 'ring' && id !== 'blocks') {
        const cornered = m.blocks.every((b) =>
          Math.abs(Math.abs(b.x) - 16) < 0.01 && Math.abs(Math.abs(b.z) - 16) < 0.01);
        assert(!cornered, `${id} is not four corner blocks`);
      }
    }
    console.log('MECH ok: spawn pools + sockets clear and connected on all maps');
  }

  // --- 3. drift arms only as a held forward turn at speed ---
  {
    const [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
    const k = st.karts[0];
    const other = st.karts[1];
    other.x = 24; other.z = 24; // parked far away: contacts never interfere
    const drive = (x, z, angle, speed, input, n = 1) => {
      k.x = x; k.z = z; k.angle = angle; k.speed = speed;
      karts.onAction(st, ctx, 'p0', { input });
      for (let i = 0; i < n; i++) {
        if (i % 5 === 0) karts.onAction(st, ctx, 'p0', { input });
        tick(ctx, st);
      }
    };
    // Stationary + drift + steer: no slide, no charge, no turbo on release.
    drive(0, -20, 0, 0, { steer: 1, throttle: 0, drift: true }, 12);
    assert.strictEqual(k.drifting, false, 'parked kart never drifts');
    assert.strictEqual(k.driftCharge, 0, 'parked kart charges nothing');
    assert.strictEqual(k.slip, 0, 'parked kart slides nowhere');
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0 } });
    tick(ctx, st);
    assert.strictEqual(k.turbo, 0, 'no reward for stationary wiggling');
    // Straight at speed + drift: still no drift (nothing to slide).
    drive(0, -20, 0, 12, { steer: 0, throttle: 1, drift: true }, 12);
    assert.strictEqual(k.drifting, false, 'straight-line drift stays off');
    assert.strictEqual(k.driftCharge, 0, 'straight-line charges nothing');
    assert.strictEqual(k.slip, 0, 'straight-line slides nowhere');
    // Reverse + drift + steer: no drift either.
    drive(0, 20, 0, -4, { steer: 1, throttle: -1, drift: true }, 5);
    assert.strictEqual(k.drifting, false, 'reverse never drifts');
    // Forward turn at speed + drift: armed, sliding, charging.
    drive(0, -20, 0, 12, { steer: 1, throttle: 1, drift: true }, 5);
    assert.strictEqual(k.drifting, true, 'forward turn at speed drifts');
    assert(k.slip !== 0, 'drift builds lateral slip');
    assert(k.driftCharge > 0 && k.driftCharge < 1, 'partial charge mid-drift');
    // Releasing early (partial charge) pays nothing, exactly once.
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1 } });
    tick(ctx, st);
    assert.strictEqual(k.drifting, false, 'release ends the drift');
    assert.strictEqual(k.turbo, 0, 'partial charge pays no turbo');
    // Full charge then release: ONE mini-turbo, no re-trigger spam.
    drive(0, -20, 0, 12, { steer: 1, throttle: 1, drift: true }, 12);
    assert.strictEqual(k.driftCharge, 1, 'sustained drift fills the charge');
    assert.strictEqual(k.turbo, 0, 'holding full charge fires nothing yet');
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1 } });
    tick(ctx, st);
    // Granted mid-tick on the release edge, then decayed by the remaining
    // lockstep substeps — so it sits within one tick of full, never 0/full.
    assert(k.turbo > 0 && k.turbo <= engine.constants.MINI_TURBO_TIME,
      `release pays one mini-turbo, saw ${k.turbo}`);
    assert(k.turbo > engine.constants.MINI_TURBO_TIME - 0.11, 'turbo granted this tick');
    for (let i = 0; i < 30; i++) tick(ctx, st);
    assert(k.turbo < engine.constants.MINI_TURBO_TIME, 'turbo decays, never refreshes itself');
    assert.strictEqual(k.driftCharge, 0, 'charge resets with the drift');
    // Slip bleeds off on asphalt once the drift ends (recoverable grip).
    drive(0, -20, 0, 12, { steer: 1, throttle: 1, drift: true }, 6);
    const sliding = Math.abs(k.slip);
    assert(sliding > 1, 'drift slides wide, |slip|=' + sliding.toFixed(2));
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1 } });
    for (let i = 0; i < 10; i++) tick(ctx, st);
    assert(Math.abs(k.slip) < sliding / 4, 'grip recovers after release');
    console.log('MECH ok: drift gating, charge, exact-once release, recovery');
  }

  // --- 4. drift intent is boolean-only; charge/fields never injectable ---
  {
    const [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
    const k = st.karts[0];
    karts.onAction(st, ctx, 'p0', { input: { steer: 1, throttle: 1, drift: 'yes' } });
    assert.deepStrictEqual(k.input, { steer: 1, throttle: 1, boost: false }, 'string drift ignored');
    karts.onAction(st, ctx, 'p0', { input: { steer: 1, throttle: 1, drift: 1 } });
    assert.deepStrictEqual(k.input, { steer: 1, throttle: 1, boost: false }, 'numeric drift ignored');
    karts.onAction(st, ctx, 'p0', { input: { steer: 1, throttle: 1, drift: { x: 1 } } });
    assert.deepStrictEqual(k.input, { steer: 1, throttle: 1, boost: false }, 'object drift ignored');
    karts.onAction(st, ctx, 'p0', { input: { steer: 1, throttle: 1, drift: true } });
    assert.deepStrictEqual(k.input, { steer: 1, throttle: 1, boost: false, drift: true }, 'true arms');
    karts.onAction(st, ctx, 'p0', { input: { steer: 1, throttle: 1 } });
    assert.deepStrictEqual(k.input, { steer: 1, throttle: 1, boost: false }, 'legacy shape intact');
    // Charge/turbo/slip/velocity are server-computed: action smuggling fails.
    karts.onAction(st, ctx, 'p0', {
      input: { steer: 0, throttle: 0 }, driftCharge: 99, turbo: 99, slip: 99, vx: 99, speed: 99,
    });
    assert.strictEqual(k.driftCharge, 0, 'charge injection ignored');
    assert.strictEqual(k.turbo, 0, 'turbo injection ignored');
    assert.strictEqual(k.slip, 0, 'slip injection ignored');
    console.log('MECH ok: boolean-only drift, no field injection');
  }

  // --- 5. pads: automatic turbo with bounded cooldown, both modes ---
  {
    for (const mode of ['Star Rush', 'Zap Battle']) {
      const [st, ctx] = racing({ mode, map: 'Neon Yard' });
      const k = st.karts[0];
      st.karts[1].x = -24; st.karts[1].z = -24;
      // Straight at the (18,18) shortcut pad at speed.
      const runStrip = () => {
        k.x = 18; k.z = 8; k.angle = 0; k.speed = 10;
        for (let i = 0; i < 8 && k.turbo <= 0; i++) {
          karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1 } });
          tick(ctx, st);
        }
      };
      runStrip();
      assert(k.z >= 15 && k.z <= 21, `${mode}: kart reaches the strip`);
      // Granted mid-tick, then decayed by the remaining substeps of that
      // same tick — within one tick of full, never 0 and never over full.
      assert(k.turbo > 0 && k.turbo <= engine.constants.TURBO_TIME,
        `${mode}: strip grants turbo, saw ${k.turbo}`);
      assert(k.padCd > engine.constants.PAD_COOLDOWN - 0.11 &&
        k.padCd <= engine.constants.PAD_COOLDOWN, `${mode}: cooldown armed`);
      // Turbo raises the top speed past the stock cruise cap (open straight).
      k.x = 0; k.z = -14; k.angle = 0;
      for (let i = 0; i < 5; i++) {
        karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1 } });
        tick(ctx, st);
      }
      assert(k.speed > engine.constants.MAX_SPEED, `${mode}: turbo exceeds cruise, v=${k.speed.toFixed(2)}`);
      assert(k.speed <= engine.constants.MAX_SPEED * engine.constants.TURBO_SPEED + 0.01, `${mode}: turbo respects its cap`);
      // Immediate re-entry during cooldown pays nothing.
      k.x = -18; k.z = -14; // near a different strip, same cooldown
      karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1 } });
      tick(ctx, st);
      assert(k.turbo < engine.constants.TURBO_TIME, `${mode}: cooldown blocks re-trigger`);
      // Parked on a strip past cooldown: stationary karts earn nothing.
      k.x = 18; k.z = 18; k.speed = 0;
      karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0 } });
      for (let i = 0; i < 40; i++) tick(ctx, st);
      assert.strictEqual(k.padCd, 0, `${mode}: cooldown expires`);
      assert.strictEqual(k.turbo, 0, `${mode}: parked kart never re-triggers`);
      // Rolling over it again re-arms honestly.
      runStrip();
      assert(k.turbo > 0 && k.turbo <= engine.constants.TURBO_TIME,
        `${mode}: rolling re-entry pays, saw ${k.turbo}`);
    }
    console.log('MECH ok: turbo strips (grant, cooldown, no stationary spam, both modes)');
  }

  // --- 6. ice changes handling; snapshots expose grip + feedback fields ---
  {
    const [st, ctx] = racing({ mode: 'Star Rush', map: 'Frosty Pass' });
    const k = st.karts[0];
    st.karts[1].x = 24; st.karts[1].z = -24;
    // Same turn on the center rink vs asphalt: ice yaws wider.
    k.x = 0; k.z = 0; k.angle = 0; k.speed = 10;
    karts.onAction(st, ctx, 'p0', { input: { steer: 1, throttle: 1 } });
    tick(ctx, st);
    const iceTurn = k.angle;
    assert.strictEqual(k.grip, 0.45, 'center rink reports its grip');
    const [sa, ctxa] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
    const ka = sa.karts[0];
    sa.karts[1].x = 24; sa.karts[1].z = 24;
    ka.x = 0; ka.z = 0; ka.angle = 0; ka.speed = 10;
    karts.onAction(sa, ctxa, 'p0', { input: { steer: 1, throttle: 1 } });
    tick(ctxa, sa);
    assert.strictEqual(ka.grip, 1, 'asphalt reports full grip');
    assert(Math.abs(iceTurn) < Math.abs(ka.angle), 'ice turns lazier than asphalt');
    // Slides linger on ice and die on asphalt.
    const patch = st.surfaces.find((s) => s.grip === 0.3 && s.x < 0 && s.z < 0); // clear forward route, away from the enlarged hull/cover
    k.x = patch.x; k.z = patch.z; k.angle = 0; k.speed = 10; k.slip = 5;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1 } });
    for (let i = 0; i < 5; i++) tick(ctx, st);
    const iceSlip = Math.abs(k.slip);
    ka.x = 0; ka.z = -20; ka.angle = 0; ka.speed = 10; ka.slip = 5;
    karts.onAction(sa, ctxa, 'p0', { input: { steer: 0, throttle: 1 } });
    for (let i = 0; i < 5; i++) tick(ctxa, sa);
    assert(iceSlip > Math.abs(ka.slip) * 3, `ice keeps sliding (${iceSlip.toFixed(2)} vs ${ka.slip.toFixed(2)})`);
    // Snapshot feedback shape the views read.
    const v = karts.view(st, 'p0');
    const kv = v.karts[0];
    for (const f of ['vx', 'vz', 'slip', 'drifting', 'driftCharge', 'turbo', 'padCd', 'grip']) {
      assert(f in kv, `snapshot carries ${f}`);
    }
    assert.strictEqual(typeof kv.drifting, 'boolean', 'drifting is boolean');
    assert(kv.driftCharge >= 0 && kv.driftCharge <= 1, 'charge is a 0..1 fraction');
    const vv = engine.helpers.kartVelocity(k);
    approx(kv.vx, +vv.vx.toFixed(3), 0.011, 'snapshot vx matches sim');
    approx(kv.vz, +vv.vz.toFixed(3), 0.011, 'snapshot vz matches sim');
    console.log('MECH ok: ice handling + snapshot feedback fields');
  }

  // --- 7. server and prediction agree bit-for-bit (drift/pad/ice/slide) ---
  {
    const c = engine.constants;
    for (const key of ['DRIFT_MIN_SPEED', 'DRIFT_STEER_MIN', 'DRIFT_TURN', 'DRIFT_SLIP',
      'DRIFT_BLEND', 'SLIP_RECOVER', 'SLIP_MAX', 'DRIFT_CHARGE_NEED', 'MINI_TURBO_TIME',
      'TURBO_TIME', 'TURBO_SPEED', 'PAD_COOLDOWN', 'PAD_MIN_SPEED', 'SLIDE_KEEP',
      'NITRO_DRAIN', 'NITRO_RECHARGE', 'NITRO_REARM', 'NITRO_SPEED', 'NITRO_PUNCH',
      'EMP_TOP_SCALE', 'EMP_ACCEL_SCALE', 'EMP_TURN_SCALE']) {
      assert.strictEqual(pose[key], c[key], `pose/engine ${key} agree`);
    }
    // One rollout exercising everything: drift charge + release, a pad
    // crossing, ice grip, and a block glance — server vs mirror, per tick.
    const [st, ctx] = racing({ mode: 'Star Rush', map: 'Frosty Pass' });
    const k = st.karts[0];
    st.karts[1].x = 24; st.karts[1].z = 24;
    k.x = 14; k.z = -6; k.angle = 0; k.speed = 12;
    const p = { x: 14, z: -6, angle: 0, speed: 12, boost: 0, boostCd: 0 };
    const geo = { blocks: st.blocks, pads: st.pads, surfaces: st.surfaces, bound: st.bound };
    const script = [];
    for (let i = 0; i < 12; i++) script.push({ steer: 1, throttle: 1, boost: false, drift: true });
    for (let i = 0; i < 8; i++) script.push({ steer: 0, throttle: 1, boost: false }); // release + pad run
    let sawDrift = false;
    let sawTurbo = false;
    for (const intent of script) {
      karts.onAction(st, ctx, 'p0', { input: intent });
      tick(ctx, st);
      pose.stepSelf(p, intent, 0.1, geo);
      assert.strictEqual(p.x, k.x, 'drift rollout x matches');
      assert.strictEqual(p.z, k.z, 'drift rollout z matches');
      assert.strictEqual(p.angle, k.angle, 'drift rollout angle matches');
      assert.strictEqual(p.speed, k.speed, 'drift rollout speed matches');
      assert.strictEqual(p.slip, k.slip, 'drift rollout slip matches');
      assert.strictEqual(p.turbo, k.turbo, 'drift rollout turbo matches');
      assert.strictEqual(p.padCd, k.padCd, 'drift rollout padCd matches');
      assert.strictEqual(p.driftCharge, k.driftCharge, 'drift rollout charge matches');
      assert.strictEqual(p.drifting, k.drifting, 'drift rollout drifting matches');
      sawDrift = sawDrift || k.drifting;
      sawTurbo = sawTurbo || k.turbo > 0;
    }
    assert(sawDrift, 'rollout actually drifted');
    assert(sawTurbo, 'rollout actually turboed (mini-turbo and/or pad)');
    // opts.map (whole snapshot map object) plumbs identically.
    const q = { x: 14, z: -6, angle: 0, speed: 12, boost: 0, boostCd: 0 };
    pose.stepSelf(q, { steer: 1, throttle: 1, drift: true }, 0.1, { map: karts.view(st, 'p0').map });
    const q2 = { x: 14, z: -6, angle: 0, speed: 12, boost: 0, boostCd: 0 };
    pose.stepSelf(q2, { steer: 1, throttle: 1, drift: true }, 0.1, geo);
    assert.deepStrictEqual(q, q2, 'opts.map equals split geometry');
    // Reconcile adopts velocity + timers: slip blends, grants snap.
    const store = pose.createPoseStore();
    const snap = (over) => ({
      phase: 'drive',
      karts: [{ pid: 'p0', x: 0, z: 0, angle: 0, speed: 10, slip: 4, boost: 0, boostCd: 0,
        turbo: 0.5, padCd: 2, driftCharge: 0.5, drifting: true, ...over }],
    });
    pose.ingestSnapshot(store, snap(), 'p0', 1000);
    assert.strictEqual(store.self.slip, 4, 'first sight adopts slip');
    store.self.slip = 0; // prediction ran dry; server says sliding
    store.self.speed = 0;
    pose.ingestSnapshot(store, snap(), 'p0', 1100);
    assert(store.self.slip > 0 && store.self.slip < 4, 'slip blends toward server');
    assert.strictEqual(store.self.turbo, 0.5, 'turbo adopts authoritatively');
    assert.strictEqual(store.self.padCd, 2, 'padCd adopts authoritatively');
    assert.strictEqual(store.self.driftCharge, 0.5, 'charge adopts authoritatively');
    console.log('MECH ok: server/prediction parity (constants, rollout, reconcile)');
  }

  // --- 8. glancing hits slide, head-on stops, hitches never tunnel ---
  {
    const [st, ctx] = racing({ mode: 'Star Rush', map: 'Bumper Blocks' });
    const k = st.karts[0];
    st.karts[1].x = -24; st.karts[1].z = -24;
    // Glance along the west face of the (16,16) block: mostly tangential.
    k.x = 12.5; k.z = 16; k.angle = Math.atan2(0.25, 1); k.speed = 10;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0 } });
    tick(ctx, st);
    assert(k.z > 16.3, `glance slides along the face, z=${k.z.toFixed(2)}`);
    assert(Math.abs(k.x - (13.5 - engine.constants.KART_R)) < 0.2, `glance rests off the face, x=${k.x.toFixed(2)}`);
    assert(k.speed > 3, `glance keeps rolling speed, v=${k.speed.toFixed(2)}`);
    // Head-on coast into the same face stops nearly dead.
    k.x = 16; k.z = 10; k.angle = 0; k.speed = 10;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0 } });
    for (let i = 0; i < 5; i++) tick(ctx, st);
    assert(k.speed < 0.6, `head-on coast stops dead, v=${k.speed.toFixed(2)}`);
    approx(k.z, 13.5 - engine.constants.KART_R, 0.3, 'head-on rests on the face');
    // Boosted hitch into a NEON container face: substeps stop at the face.
    const [sn, ctxn] = racing({ mode: 'Star Rush', map: 'Neon Yard' });
    const kn = sn.karts[0];
    sn.karts[1].x = -44; sn.karts[1].z = -44;
    kn.x = 18; kn.z = -16; kn.angle = Math.PI / 2; kn.speed = 20; kn.boost = 1.2;
    karts.onAction(sn, ctxn, 'p0', { input: { steer: 0, throttle: 1 } });
    ctxn._now += 250;
    karts.onTick(sn, ctxn);
    assert(kn.x < 23, `hitch never tunnels the container, x=${kn.x.toFixed(2)}`);
    const b = sn.blocks.find((bb) => bb.x === 28 && bb.z === -16);
    const cx = Math.max(b.x - b.hw, Math.min(kn.x, b.x + b.hw));
    const cz = Math.max(b.z - b.hd, Math.min(kn.z, b.z + b.hd));
    assert(Math.hypot(kn.x - cx, kn.z - cz) >= engine.constants.KART_R - .01, 'hitch rests clear of the crate');
    // Mirror agrees on the same hitch, bit-for-bit.
    const p = { x: 18, z: -16, angle: Math.PI / 2, speed: 20, boost: 1.2, boostCd: 6 };
    pose.stepSelf(p, { steer: 0, throttle: 1, boost: false }, 0.25, { blocks: sn.blocks, bound: sn.bound });
    assert.strictEqual(p.x, kn.x, 'hitch x matches server');
    assert.strictEqual(p.z, kn.z, 'hitch z matches server');
    assert.strictEqual(p.speed, kn.speed, 'hitch speed matches server');
    console.log('MECH ok: face slide, head-on stop, hitch substeps on new maps');
  }

  // --- 9. kart contact: separate, damp, deterministic, scoreless ---
  {
    const speed2 = (kk) => {
      const v = engine.helpers.kartVelocity(kk);
      return v.vx * v.vx + v.vz * v.vz;
    };
    // Head-on: both separate to exactly 2R with strictly less energy.
    const runHeadOn = () => {
      const [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
      const [a, b] = st.karts;
      a.x = 10; a.z = -1; a.angle = 0; a.speed = 8; // off the (0,0) star
      b.x = 10; b.z = 1; b.angle = Math.PI; b.speed = 8;
      karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1 } });
      karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 1 } });
      const before = speed2(a) + speed2(b);
      tick(ctx, st);
      return [st, before];
    };
    const [st, before] = runHeadOn();
    const [a, b] = st.karts;
    approx(Math.hypot(a.x - b.x, a.z - b.z), engine.constants.KART_R*2, 1e-9, 'head-on separates to 2R');
    assert(speed2(a) + speed2(b) < before, 'contact strictly removes energy');
    assert.strictEqual(a.stars, 0, 'contact scores nothing');
    assert.deepStrictEqual(st.scores, {}, 'contact awards nothing');
    const [st2] = runHeadOn();
    assert.strictEqual(st2.karts[0].x, a.x, 'contact is deterministic (x)');
    assert.strictEqual(st2.karts[0].speed, a.speed, 'contact is deterministic (v)');
    // Separating overlap: positions split, velocities untouched.
    const [ss, ctxs] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
    const [c, d] = ss.karts;
    c.x = 0; c.z = -0.5; c.angle = Math.PI; c.speed = 1;
    d.x = 0; d.z = 0.5; d.angle = 0; d.speed = 1;
    tick(ctxs, ss);
    // Contacts now resolve mid-tick, then both karts drive on — so the pair
    // ends CLEAR of 2R rather than exactly at it (the old exact-2R pinned
    // end-of-tick-only resolution). The invariant is never-overlapping.
    assert(Math.hypot(c.x - d.x, c.z - d.z) >= engine.constants.KART_R*2 - 1e-9, 'separating pair never overlaps');
    assert(c.speed > 0.8 && d.speed > 0.8, 'separating pair keeps its pace');
    // Exactly stacked trio: no NaN, spreads out, reruns identically.
    const runStack = () => {
      const [sx, cx3] = racing({ mode: 'Star Rush', map: 'Rookie Ring' }, 3);
      for (const kk of sx.karts) { kk.x = 0; kk.z = 0; kk.angle = 0; kk.speed = 0; }
      tick(cx3, sx);
      return sx;
    };
    const s1 = runStack();
    const s2 = runStack();
    for (let i = 0; i < 3; i++) {
      assert(Number.isFinite(s1.karts[i].x) && Number.isFinite(s1.karts[i].z), 'stack stays finite');
      assert.strictEqual(s1.karts[i].x, s2.karts[i].x, 'stack reruns identically');
      for (let j = i + 1; j < 3; j++) {
        const dd = Math.hypot(s1.karts[i].x - s1.karts[j].x, s1.karts[i].z - s1.karts[j].z);
        assert(dd > 1.0, `stack spreads apart (${dd.toFixed(2)})`);
      }
    }
    // Frozen karts never move: the live rival takes the whole push.
    const [sf, ctxf] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
    const [live, ghost] = sf.karts;
    live.x = 0; live.z = -1; live.angle = 0; live.speed = 6;
    ghost.x = 0; ghost.z = 0.5; ghost.angle = 0; ghost.speed = 6;
    ctxf._connected = [{ id: 'p0', name: 'P0' }]; // p1 drops
    karts.onAction(sf, ctxf, 'p0', { input: { steer: 0, throttle: 1 } });
    tick(ctxf, sf);
    assert.strictEqual(ghost.x, 0, 'frozen kart holds x');
    assert.strictEqual(ghost.z, 0.5, 'frozen kart holds z');
    approx(Math.hypot(live.x - ghost.x, live.z - ghost.z), engine.constants.KART_R*2, 1e-9, 'live kart pushed clear');
    console.log('MECH ok: kart contact (separate, damp, deterministic, frozen-safe)');
  }

  // --- 10. TTL/disconnect/reset clear drift state; mode action intact ---
  {
    // TTL silence zeroes drift intent and bleeds the slide to a stop.
    const [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
    const k = st.karts[0];
    st.karts[1].x = 24; st.karts[1].z = 24;
    k.x = 0; k.z = -20; k.angle = 0; k.speed = 12;
    karts.onAction(st, ctx, 'p0', { input: { steer: 1, throttle: 1, drift: true } });
    for (let i = 0; i < 5; i++) tick(ctx, st);
    assert.strictEqual(k.drifting, true, 'drift armed before silence');
    for (let i = 0; i < 120; i++) tick(ctx, st); // coast down from full speed
    assert.deepStrictEqual(k.input, { steer: 0, throttle: 0, boost: false }, 'silent drift expires');
    assert.strictEqual(k.drifting, false, 'expired drift switches off');
    assert.strictEqual(k.driftCharge, 0, 'expired charge clears');
    assert.strictEqual(k.slip, 0, 'expired slide stops');
    assert.strictEqual(k.speed, 0, 'expired kart stops');
    // Disconnect mid-drift freezes everything, including the slide.
    k.x = 0; k.z = -20; k.angle = 0; k.speed = 12;
    karts.onAction(st, ctx, 'p0', { input: { steer: 1, throttle: 1, drift: true } });
    tick(ctx, st);
    ctx._connected = [{ id: 'p1', name: 'P1' }];
    const fx = k.x;
    const fz = k.z;
    for (let i = 0; i < 10; i++) tick(ctx, st);
    assert.strictEqual(k.x, fx, 'offline drift holds x');
    assert.strictEqual(k.z, fz, 'offline drift holds z');
    assert.strictEqual(k.slip, 0, 'offline slide zeroes');
    assert.strictEqual(k.drifting, false, 'offline drift switches off');
    ctx._connected = null;
    // Fresh matches reset every new field.
    ctx._now = st.endsAt + 1;
    tick(ctx, st);
    assert.strictEqual(st.phase, 'done', 'timeout finishes');
    const st2 = karts.create(ctx);
    for (const kk of st2.karts) {
      assert.strictEqual(kk.slip, 0, 'rematch slip reset');
      assert.strictEqual(kk.turbo, 0, 'rematch turbo reset');
      assert.strictEqual(kk.padCd, 0, 'rematch padCd reset');
      assert.strictEqual(kk.driftCharge, 0, 'rematch charge reset');
      assert.strictEqual(kk.drifting, false, 'rematch drifting reset');
      assert.strictEqual(kk.grip, 1, 'rematch grip reset');
    }
    assert(Array.isArray(st2.pads) && Array.isArray(st2.surfaces), 'rematch carries map geometry');
    // Space stays mode-specific next to drift: boost in Rush, zap in Battle.
    const [sr, ctxr] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
    const kr = sr.karts[0];
    kr.x = 0; kr.z = -20; kr.angle = 0; kr.speed = 12;
    karts.onAction(sr, ctxr, 'p0', { input: { steer: 1, throttle: 1, boost: true, drift: true } });
    tick(ctxr, sr);
    assert(kr.boost > 0, 'rush: Space still boosts');
    assert.strictEqual(kr.drifting, true, 'rush: drift works alongside boost');
    const [sb, ctxb] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    const kb = sb.karts[0];
    sb.karts[1].x = 24; sb.karts[1].z = 24;
    kb.x = 0; kb.z = -20; kb.angle = 0; kb.speed = 12;
    karts.onAction(sb, ctxb, 'p0', { input: { steer: 1, throttle: 1, drift: true } });
    tick(ctxb, sb);
    assert.strictEqual(sb.zaps.length, 0, 'battle: drift alone fires nothing');
    assert.strictEqual(kb.drifting, true, 'battle: drift arms normally');
    assert.strictEqual(kb.boost, 0, 'battle: still no boost timer');
    console.log('MECH ok: TTL/disconnect/reset clear drift; Space stays modal');
  }

  // --- 11. ordinary driving is untouched when drift is off ---
  {
    const [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
    const k = st.karts[0];
    st.karts[1].x = 24; st.karts[1].z = 24;
    // Straight: no lateral anything, angle bit-stable.
    k.x = 0; k.z = -20; k.angle = 0; k.speed = 0;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1 } });
    for (let i = 0; i < 10; i++) tick(ctx, st);
    assert.strictEqual(k.angle, 0, 'straight keeps its nose');
    assert.strictEqual(k.slip, 0, 'straight builds no slip');
    assert.strictEqual(k.driftCharge, 0, 'straight charges nothing');
    // Plain turn without the drift key: tight, no slide.
    k.x = 0; k.z = -20; k.angle = 0; k.speed = 8;
    karts.onAction(st, ctx, 'p0', { input: { steer: 1, throttle: 1 } });
    tick(ctx, st);
    assert(k.angle < 0, 'right still turns screen-right');
    assert.strictEqual(k.slip, 0, 'keyless turn never slides');
    assert.strictEqual(k.drifting, false, 'keyless turn never drifts');
    // Touch parity: the sim only sees the boolean, whatever sent it.
    k.x = 0; k.z = -20; k.angle = 0; k.speed = 12;
    karts.onAction(st, ctx, 'p0', { input: { steer: -1, throttle: 1, drift: true } });
    tick(ctx, st);
    assert.strictEqual(k.drifting, true, 'any sender arms the same drift');
    // Outward tail slide: a left turn drifts toward screen RIGHT of the
    // nose (positive slip), so the velocity heading lags the yaw.
    assert(k.slip > 0, 'left drift slides outward');
    console.log('MECH ok: drift-off driving unchanged, input-source agnostic');
  }

  // --- 12. boosted head-on karts meet mid-tick, never cross ---
  {
    const speed2 = (kk) => {
      const v = engine.helpers.kartVelocity(kk);
      return v.vx * v.vx + v.vz * v.vz;
    };
    for (const ms of [100, 250]) {
      const run = () => {
        const [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
        const [a, b] = st.karts;
        // Near-touching valid approach: 2R+0.04 apart, straight at each other
        // at boosted top speed (offset to x=10 so no star interferes).
        a.x = 10; a.z = -engine.constants.KART_R - .02; a.angle = 0; a.speed = 22.4;
        a.boost = 1; a.boostCd = 6; a.slip = 0;
        b.x = 10; b.z = engine.constants.KART_R + .02; b.angle = Math.PI; b.speed = 22.4;
        b.boost = 1; b.boostCd = 6; b.slip = 0;
        karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1 } });
        karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 1 } });
        const before = speed2(a) + speed2(b);
        ctx._now += ms;
        karts.onTick(st, ctx);
        return [st, before];
      };
      const [st, before] = run();
      const [a, b] = st.karts;
      assert(a.z < b.z, `${ms}ms: head-on pair never crosses (a=${a.z}, b=${b.z})`);
      approx(Math.hypot(a.x - b.x, a.z - b.z), engine.constants.KART_R*2, 1e-9, `${ms}ms: pair rests at 2R`);
      assert(speed2(a) + speed2(b) < before, `${ms}ms: contact removes energy`);
      assert.strictEqual(a.stars, 0, `${ms}ms: contact scores nothing`);
      assert.deepStrictEqual(st.scores, {}, `${ms}ms: contact awards nothing`);
      const [st2] = run();
      assert.strictEqual(st2.karts[0].z, a.z, `${ms}ms: contact is deterministic`);
    }
    console.log('MECH ok: boosted head-on no-tunnel at 100ms and 250ms');
  }

  // --- 13. contacts beside solids stay valid; 8-kart pile stays stable ---
  {
    const clearOfAll = (kk, blocks) => blocks.every((bb) => {
      const cx = Math.max(bb.x - bb.hw, Math.min(kk.x, bb.x + bb.hw));
      const cz = Math.max(bb.z - bb.hd, Math.min(kk.z, bb.z + bb.hd));
      return Math.hypot(kk.x - cx, kk.z - cz) >= engine.constants.KART_R - .01;
    });
    // Pair shoved toward the (16,16) block face: separation must not embed.
    const [st, ctx] = racing({ mode: 'Star Rush', map: 'Bumper Blocks' });
    const [a, b] = st.karts;
    a.x = 16; a.z = 11; a.angle = 0; a.speed = 8;
    b.x = 16; b.z = 13; b.angle = 0; b.speed = 0;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1 } });
    karts.onAction(st, ctx, 'p1', { input: { steer: 0, throttle: 0 } });
    tick(ctx, st);
    // Sandwiched between a kart push and a solid face, the pair settles
    // geometrically to a sub-mm skin (bounded iterations) — never crossing
    // and never embedding. Open-field pairs still rest at exactly 2R.
    assert(Math.hypot(a.x - b.x, a.z - b.z) >= engine.constants.KART_R*2 - 1e-3, 'block-side pair never overlaps');
    assert(clearOfAll(a, st.blocks) && clearOfAll(b, st.blocks), 'block-side pair never embeds');
    // Pair against the east wall: order kept, both inside the arena.
    const [sw, ctxw] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
    const [c, d] = sw.karts;
    c.x = 26.5; c.z = 0; c.angle = Math.PI / 2; c.speed = 10;
    d.x = 27.5; d.z = 0; d.angle = Math.PI / 2; d.speed = 0;
    karts.onAction(sw, ctxw, 'p0', { input: { steer: 0, throttle: 1 } });
    karts.onAction(sw, ctxw, 'p1', { input: { steer: 0, throttle: 0 } });
    tick(ctxw, sw);
    assert(c.x <= d.x, `wall pair never crosses (c=${c.x}, d=${d.x})`);
    assert(Math.hypot(c.x - d.x, c.z - d.z) >= engine.constants.KART_R*2 - 1e-3, 'wall pair never overlaps');
    for (const kk of [c, d]) assert(Math.abs(kk.x) <= BOUND && Math.abs(kk.z) <= BOUND, 'wall pair in bounds');
    // 8 karts stacked in a corner: finite, bounded, no energy from nothing.
    const [sx, cxx] = racing({ mode: 'Star Rush', map: 'Rookie Ring' }, 8);
    for (const kk of sx.karts) { kk.x = 24; kk.z = 24; kk.angle = 0; kk.speed = 0; }
    const spread = () => {
      let m = Infinity;
      for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
        m = Math.min(m, Math.hypot(sx.karts[i].x - sx.karts[j].x, sx.karts[i].z - sx.karts[j].z));
      }
      return m;
    };
    tick(cxx, sx);
    const early = spread();
    for (let i = 0; i < 9; i++) tick(cxx, sx);
    for (const kk of sx.karts) {
      assert(Number.isFinite(kk.x) && Number.isFinite(kk.z), 'piled kart stays finite');
      assert(Math.abs(kk.x) <= BOUND && Math.abs(kk.z) <= BOUND, 'piled kart stays in bounds');
      assert.strictEqual(kk.speed, 0, 'piled kart gains no speed');
    }
    assert(spread() > early, `pile keeps spreading (${early.toFixed(2)} -> ${spread().toFixed(2)})`);
    console.log('MECH ok: contacts beside solids valid, 8-kart pile stable');
  }

  // --- 14. mini-turbo pays only a deliberate fast release ---
  {
    const chargeUp = () => {
      const [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
      const k = st.karts[0];
      st.karts[1].x = 24; st.karts[1].z = 24;
      k.x = 0; k.z = -20; k.angle = 0; k.speed = 12;
      const inp = { steer: 1, throttle: 1, drift: true };
      karts.onAction(st, ctx, 'p0', { input: inp });
      for (let i = 0; i < 12; i++) {
        if (i % 5 === 0) karts.onAction(st, ctx, 'p0', { input: inp });
        tick(ctx, st);
      }
      assert.strictEqual(k.driftCharge, 1, 'setup reaches full charge');
      return [st, ctx, k];
    };
    // Steering centers while Shift stays held: stale intent, no reward.
    {
      const [st, ctx, k] = chargeUp();
      karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1, drift: true } });
      tick(ctx, st);
      assert.strictEqual(k.turbo, 0, 'centered steering with Shift held pays nothing');
      assert.strictEqual(k.driftCharge, 0, 'stale charge clears');
    }
    // Braking to a crawl while Shift stays held: slow release, no reward.
    {
      const [st, ctx, k] = chargeUp();
      karts.onAction(st, ctx, 'p0', { input: { steer: 1, throttle: -1, drift: true } });
      const brakeTicks = Math.ceil((k.speed - engine.constants.DRIFT_MIN_SPEED) / engine.constants.BRAKE / .1) + 1;
      for (let i = 0; i < brakeTicks; i++) tick(ctx, st);
      assert(k.speed < 6, `braking kills useful speed, saw ${k.speed.toFixed(2)}`);
      assert.strictEqual(k.turbo, 0, 'slow stale drift pays nothing');
    }
    // Radio silence with a full charge: TTL wipes the intent, no reward.
    {
      const [st, ctx, k] = chargeUp();
      for (let i = 0; i < 16; i++) tick(ctx, st);
      assert.deepStrictEqual(k.input, { steer: 0, throttle: 0, boost: false }, 'silent intent expires');
      assert.strictEqual(k.turbo, 0, 'TTL expiry mints no turbo');
      assert.strictEqual(k.driftCharge, 0, 'TTL clears the charge');
    }
    // Wall kill then release: the impact voids the charge.
    {
      const [st, ctx, k] = chargeUp();
      k.x = 0; k.z = 27.2; k.angle = 0; // facing the north wall at speed
      karts.onAction(st, ctx, 'p0', { input: { steer: 1, throttle: 1, drift: true } });
      tick(ctx, st);
      assert(k.speed < 6, `wall impact kills speed, saw ${k.speed.toFixed(2)}`);
      karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 1 } });
      tick(ctx, st);
      assert.strictEqual(k.turbo, 0, 'post-impact release pays nothing');
    }
    // Steering held, only Shift released: the true edge still pays once.
    {
      const [st, ctx, k] = chargeUp();
      karts.onAction(st, ctx, 'p0', { input: { steer: 1, throttle: 1 } });
      tick(ctx, st);
      assert(k.turbo > 0 && k.turbo <= engine.constants.MINI_TURBO_TIME,
        `Shift-only release pays, saw ${k.turbo}`);
      const paid = k.turbo;
      for (let i = 0; i < 30; i++) tick(ctx, st);
      assert(k.turbo < paid, 'release turbo decays without refresh');
    }
    console.log('MECH ok: mini-turbo release gating (stale/TTL/wall void, true edge pays)');
  }

  // --- 15. drift slides outward: velocity heading lags the nose ---
  {
    // Physical check on world velocity, not on the slip variable itself:
    // heading = atan2(vx, vz) in the same convention as the yaw angle.
    for (const steer of [1, -1]) {
      const [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
      const k = st.karts[0];
      st.karts[1].x = 24; st.karts[1].z = 24;
      k.x = 0; k.z = -20; k.angle = 0; k.speed = 12; k.slip = 0;
      karts.onAction(st, ctx, 'p0', { input: { steer, throttle: 1, drift: true } });
      tick(ctx, st);
      assert.strictEqual(k.drifting, true, `steer ${steer}: drift armed`);
      const v = engine.helpers.kartVelocity(k);
      const heading = Math.atan2(v.vx, v.vz);
      if (steer > 0) {
        assert(k.angle < -0.05, 'right drift yaws screen-right');
        assert(heading > k.angle + 0.05,
          `right drift velocity lags the nose (head=${heading.toFixed(3)}, yaw=${k.angle.toFixed(3)})`);
        assert(k.slip < 0, 'right drift slip points outward (screen left)');
      } else {
        assert(k.angle > 0.05, 'left drift yaws screen-left');
        assert(heading < k.angle - 0.05,
          `left drift velocity lags the nose (head=${heading.toFixed(3)}, yaw=${k.angle.toFixed(3)})`);
        assert(k.slip > 0, 'left drift slip points outward (screen right)');
      }
      // The prediction mirror slides the same way (bit-identical rollout).
      const p = { x: 0, z: -20, angle: 0, speed: 12, boost: 0, boostCd: 0 };
      pose.stepSelf(p, { steer, throttle: 1, boost: false, drift: true }, 0.1, {});
      assert.strictEqual(p.slip, k.slip, `steer ${steer}: mirror slip matches server`);
      const pv = pose.kartVelocity(p);
      const phead = Math.atan2(pv.vx, pv.vz);
      assert.strictEqual(phead, heading, `steer ${steer}: mirror heading matches server`);
    }
    console.log('MECH ok: outward drift (velocity lags nose, both signs, mirror agrees)');
  }

  // Stationary or separating contact still moves positions. Even without
  // an approaching velocity impulse, the solver must reproject solids.
  for (const speed of [0, -2]) {
    const [st, ctx] = racing({ mode: 'Star Rush', map: 'Bumper Blocks' });
    const [a,b] = st.karts;
    a.x=b.x=16; a.z=11; b.z=12.4;
    a.angle=b.angle=0; a.speed=speed; b.speed=0;
    tick(ctx,st);
    for(const k of [a,b]) for(const block of st.blocks) {
      const cx=Math.max(block.x-block.hw,Math.min(k.x,block.x+block.hw));
      const cz=Math.max(block.z-block.hd,Math.min(k.z,block.z+block.hd));
      assert(Math.hypot(k.x-cx,k.z-cz)>=engine.constants.KART_R-1e-8,
        'position-only kart separation stays outside solids');
    }
    assert(Math.hypot(a.x-b.x,a.z-b.z)>=engine.constants.KART_R*2-1e-3,'position-only contact settles');
  }
  console.log('MECH ok: stationary/separating contacts reproject solids');
  console.log('KART_MECHANICS_PASS');
}

main().then(
  () => {},
  (e) => { console.error(e); process.exit(1); },
);
