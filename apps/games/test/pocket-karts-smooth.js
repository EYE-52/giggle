// Planar-mutating unit fixtures use an explicit generic variant, not physical Pocket.
'use strict';
/* Pocket Karts smoothness tests: shared visual-pose helper (self prediction
 * + server reconcile, bounded remote extrapolation, angle wrap, stale
 * cutoff, countdown/done, reduced motion, new-instance reset) and the
 * discardable-tick slow-client guard (drive ticks skippable, done/turn
 * events always delivered). Run: npm run test:pocket-karts-smooth */
const assert = require('assert');

const karts = require('./fixtures/kart-planar-variant.cjs');
const engine = require('../games/engines/kart-engine');
const { Rooms, SLOW_SOCKET_BYTES } = require('../server/room');

const NODE = '../public/js/games/pocket-karts-pose.mjs';

function kart(pid, x, z, angle, speed) {
  return { pid, x, z, angle, speed: speed || 0, boost: 0, boostCd: 0, stars: 0 };
}
function driveSnap(kartsArr) {
  return { phase: 'drive', karts: kartsArr };
}
function approx(a, b, tol, msg) {
  assert(Math.abs(a - b) <= tol, `${msg} (saw ${a}, want ${b})`);
}

async function main() {
  const pose = await import(NODE);

  // --- 1. self prediction moves instantly on fresh input (no new snapshot) ---
  {
    const st = pose.createPoseStore();
    const S = driveSnap([kart('pa', 0, -20, 0, 0), kart('pb', 5, -20, 0, 0)]);
    pose.ingestSnapshot(st, S, 'pa', 1000);
    let p = null;
    for (let i = 1; i <= 30; i++) { // 500 ms of held throttle, SAME snapshot
      p = pose.framePoses(st, S, { steer: 0, throttle: 1, boost: false }, 1 / 60, 1000 + i * 16.7, {});
    }
    const me = p.get('pa');
    assert(me.z > -20 + 1, 'held throttle drives self with zero snapshots, z=' + me.z.toFixed(2));
    approx(me.x, 0, 1e-9, 'no steering means no lateral drift');
    console.log('SMOOTH ok: self predicts instantly on held input (delayed snapshots)');
  }

  // --- 2. server reconcile: soft blend on small error, snap on teleport ---
  {
    const st = pose.createPoseStore();
    pose.ingestSnapshot(st, driveSnap([kart('pa', 0, 0, 0, 0)]), 'pa', 1000);
    for (let i = 1; i <= 20; i++) {
      pose.framePoses(st, driveSnap([kart('pa', 0, 0, 0, 0)]),
        { steer: 0, throttle: 1, boost: false }, 1 / 60, 1000 + i * 16.7, {});
    }
    const ahead = st.self.z;
    assert(ahead > 1, 'prediction ran ahead, z=' + ahead.toFixed(2));
    // Lagging server truth: soft-blend pulls back partway (no snap, no pop).
    pose.ingestSnapshot(st, driveSnap([kart('pa', 0, 1, 0, 5)]), 'pa', 1200);
    assert(st.self.z > 1 && st.self.z < ahead, `blend pulls toward server (1 < ${st.self.z.toFixed(2)} < ${ahead.toFixed(2)})`);
    // Teleport/respawn: hard snap.
    pose.ingestSnapshot(st, driveSnap([kart('pa', 24, 24, 0, 0)]), 'pa', 1300);
    assert.strictEqual(st.self.x, 24, 'big error snaps x');
    assert.strictEqual(st.self.z, 24, 'big error snaps z');
    console.log('SMOOTH ok: reconcile blends small errors, snaps teleports');
  }

  // --- 3. angle wrap: shortest arc across +-PI, prediction stays wrapped ---
  {
    assert(Math.abs(pose.angDiff(Math.PI - 0.1, -Math.PI + 0.1)) < 0.3, 'wrap delta is ~0.2, not ~2PI');
    assert(Math.abs(pose.angDiff(0, Math.PI) - Math.PI) < 1e-9, 'half-turn exact');
    const st = pose.createPoseStore();
    pose.ingestSnapshot(st, driveSnap([kart('pa', 0, 0, Math.PI - 0.05, 8)]), 'pa', 1000);
    for (let i = 1; i <= 30; i++) {
      pose.framePoses(st, driveSnap([kart('pa', 0, 0, Math.PI - 0.05, 8)]),
        { steer: 1, throttle: 1, boost: false }, 1 / 60, 1000 + i * 16.7, {});
    }
    assert(st.self.angle >= -Math.PI && st.self.angle <= Math.PI, 'predicted angle stays wrapped');
    console.log('SMOOTH ok: angle wrap (shortest arc, bounded prediction)');
  }

  // --- 4. remotes coast briefly, then freeze (never extrapolate forever) ---
  {
    const st = pose.createPoseStore();
    const S = driveSnap([kart('pb', 0, 0, 0, 14)]); // full speed up +z
    pose.ingestSnapshot(st, S, 'pa', 1000);
    const idle = { steer: 0, throttle: 0, boost: false };
    const run = (from, to) => {
      let p = null;
      for (let t = from; t <= to; t += 16.7) p = pose.framePoses(st, S, idle, 1 / 60, t, {}).get('pb');
      return p;
    };
    assert(run(1016, 1200).z > 0.2, 'remote coasts through a dropped tick');
    const frozen1 = run(1216, 3000).z; // converged past the 500 ms lead cap
    const frozen2 = run(3016, 6000).z; // 3 s more silence: must hold still
    approx(frozen1, frozen2, 1e-6, 'stale remote freezes after the cutoff');
    assert(frozen1 < 14 * 0.5 + 2, 'bounded lead, z=' + frozen1.toFixed(2));
    console.log('SMOOTH ok: bounded remote extrapolation + stale freeze');
  }

  // --- 5. new instance starts exact; WebGL and 2D share one behavior ---
  {
    const fresh = pose.createPoseStore();
    const S = driveSnap([kart('pa', 3, 4, 0.5, 2), kart('pb', -3, -4, -1, 6)]);
    pose.ingestSnapshot(fresh, S, 'pa', 5000);
    const p0 = pose.framePoses(fresh, S, { steer: 0, throttle: 0, boost: false }, 0, 5000, {});
    assert.deepStrictEqual(p0.get('pa'), { x: 3, z: 4, angle: 0.5 }, 'new instance self exact');
    assert.deepStrictEqual(p0.get('pb'), { x: -3, z: -4, angle: -1 }, 'new instance remote exact');
    // Two renderers, one helper: identical ingest + frames => identical poses.
    const gl = pose.createPoseStore();
    const fb = pose.createPoseStore();
    pose.ingestSnapshot(gl, S, 'pa', 5000);
    pose.ingestSnapshot(fb, S, 'pa', 5000);
    const intent = { steer: 0.5, throttle: 1, boost: false };
    let a;
    let b;
    for (let i = 1; i <= 10; i++) {
      a = pose.framePoses(gl, S, intent, 1 / 60, 5000 + i * 16.7, {});
      b = pose.framePoses(fb, S, intent, 1 / 60, 5000 + i * 16.7, {});
    }
    assert.deepStrictEqual([...a.entries()], [...b.entries()], 'WebGL and 2D agree');
    console.log('SMOOTH ok: new-instance exactness + shared WebGL/2D poses');
  }

  // --- 6. countdown/done draw the snapshot; reduced motion keeps response ---
  {
    const st = pose.createPoseStore();
    const cd = { phase: 'countdown', karts: [kart('pa', 1, 2, 0.3, 0)] };
    pose.ingestSnapshot(st, cd, 'pa', 1000);
    const p = pose.framePoses(st, cd, { steer: 1, throttle: 1, boost: true }, 0.1, 1100, {});
    assert.deepStrictEqual(p.get('pa'), { x: 1, z: 2, angle: 0.3 }, 'countdown holds snapshot');
    const done = { phase: 'done', karts: [kart('pa', 7, 8, 1, 0)] };
    pose.ingestSnapshot(st, done, 'pa', 2000);
    assert.deepStrictEqual(
      pose.framePoses(st, done, { steer: 1, throttle: 1, boost: true }, 0.1, 2100, {}).get('pa'),
      { x: 7, z: 8, angle: 1 }, 'done holds final poses');
    // Reduced motion: remotes snap, but SELF still predicts (responsiveness
    // is gameplay, never decoration).
    const rm = pose.createPoseStore();
    pose.ingestSnapshot(rm, driveSnap([kart('pa', 0, 0, 0, 0), kart('pb', 0, 0, 0, 0)]), 'pa', 3000);
    pose.ingestSnapshot(rm, driveSnap([kart('pa', 0, 0, 0, 0), kart('pb', 3, 0, 0, 0)]), 'pa', 3100);
    const prm = pose.framePoses(rm, driveSnap([kart('pa', 0, 0, 0, 0), kart('pb', 3, 0, 0, 0)]),
      { steer: 0, throttle: 1, boost: false }, 1 / 60, 3116, { reducedMotion: true });
    assert.deepStrictEqual(prm.get('pb'), { x: 3, z: 0, angle: 0 }, 'reduced motion snaps remotes');
    assert(prm.get('pa').z > 0, 'reduced motion keeps self prediction');
    console.log('SMOOTH ok: countdown/done exact, reduced-motion responsive');
  }

  // --- 7. prediction mirrors the server sim (same straight-line rollout) ---
  {
    const players = [{ id: 'pa', name: 'Ann' }, { id: 'pb', name: 'Bob' }];
    const ctx = {
      _now: 4000000, players: () => players.slice(), allPlayers: () => players.slice(),
      content: () => ({}), settings: () => ({ mode: 'Star Rush', map: 'Rookie Ring' }), hostId: () => 'pa',
      broadcast: () => {}, lobby: () => {}, later: () => () => {}, award: () => {},
      now: function () { return this._now; },
    };
    const sim = karts.create(ctx);
    ctx._now += 3000;
    karts.onTick(sim, ctx);
    const k0 = sim.karts[0];
    k0.x = 0; k0.z = -20; k0.angle = 0; k0.speed = 0; // open track
    karts.onAction(sim, ctx, 'pa', { input: { steer: 0, throttle: 1 } });
    for (let i = 0; i < 10; i++) {
      ctx._now += 100;
      karts.onTick(sim, ctx);
    }
    const p = { x: 0, z: -20, angle: 0, speed: 0, boost: 0, boostCd: 0 };
    for (let i = 0; i < 10; i++) pose.stepSelf(p, { steer: 0, throttle: 1, boost: false }, 0.1);
    approx(p.x, k0.x, 1e-9, 'prediction x matches server');
    approx(p.z, k0.z, 1e-9, 'prediction z matches server');
    approx(p.speed, k0.speed, 1e-9, 'prediction speed matches server');
    console.log('SMOOTH ok: client prediction mirrors server physics');
  }

  // --- 8. karts marks drive ticks discardable, done terminal ---
  {
    const seen = [];
    const players = [{ id: 'pa', name: 'Ann' }, { id: 'pb', name: 'Bob' }];
    const ctx = {
      _now: 5000000, players: () => players.slice(), allPlayers: () => players.slice(),
      content: () => ({}), settings: () => ({}), hostId: () => 'pa',
      broadcast: (opts) => { seen.push(opts); }, lobby: () => {}, later: () => () => {},
      award: () => {}, now: function () { return this._now; },
    };
    const sim = karts.create(ctx);
    karts.onTick(sim, ctx); // countdown
    assert.deepStrictEqual(seen.pop(), { discardable: true }, 'countdown tick discardable');
    ctx._now += 3000;
    karts.onTick(sim, ctx); // flips to drive
    assert.deepStrictEqual(seen.pop(), { discardable: true }, 'drive tick discardable');
    ctx._now = sim.endsAt + 1;
    karts.onTick(sim, ctx); // finishes
    assert.strictEqual(sim.phase, 'done', 'race finished');
    assert.strictEqual(seen.pop(), undefined, 'done broadcast is terminal (never skipped)');
    console.log('SMOOTH ok: discardable drive ticks, terminal done');
  }

  // --- 9. slow socket skips drive ticks, still gets done + turn events ---
  {
    assert(Number.isFinite(SLOW_SOCKET_BYTES) && SLOW_SOCKET_BYTES > 4096, 'guard threshold sane');
    const rooms = new Rooms({});
    const room = rooms.create();
    const mkSock = (slow) => ({
      readyState: 1, bufferedAmount: slow ? SLOW_SOCKET_BYTES + 1 : 0,
      sent: [], send(m) { this.sent.push(JSON.parse(m)); }, close() { this.readyState = 3; },
    });
    const fast = mkSock(false);
    const slow = mkSock(true);
    const { player: pa } = room.addPlayer('Ann', fast);
    room.addPlayer('Bob', slow);
    const r = room.startGame(karts, {}, pa.id);
    assert(!r.error, 'karts starts: ' + (r.error || 'ok'));
    fast.sent.length = 0;
    slow.sent.length = 0;
    room.onTick(); // countdown tick: discardable
    assert.strictEqual(fast.sent.filter((m) => m.t === 'state').length, 1, 'fast gets countdown tick');
    assert.strictEqual(slow.sent.length, 0, 'slow skips the discardable tick');
    room.game.state.endsAt = Date.now() - 1; // flip to drive on next tick
    room.onTick();
    fast.sent.length = 0;
    slow.sent.length = 0;
    room.onTick(); // drive tick: discardable
    assert.strictEqual(fast.sent.filter((m) => m.t === 'state').length, 1, 'fast gets drive tick');
    assert.strictEqual(slow.sent.length, 0, 'slow skips the drive tick too');
    // Legacy turn-style action: immediate broadcast, NEVER discardable.
    room.onAction(fast, { vote: 'a' });
    assert(slow.sent.some((m) => m.t === 'state'), 'slow still gets turn events');
    slow.sent.length = 0;
    room.game.state.endsAt = Date.now() - 1; // timer expires -> done
    room.onTick();
    assert.strictEqual(room.game.state.phase, 'done', 'race done');
    const got = slow.sent.filter((m) => m.t === 'state');
    assert.strictEqual(got.length, 1, 'slow gets the terminal done snapshot');
    assert(got[0].result && Array.isArray(got[0].result.standings), 'done carries results');
    console.log('SMOOTH ok: slow-client guard (ticks skippable, done/turns delivered)');
  }

  // --- 10. remote extrapolated target never crosses the arena walls ---
  {
    const idle = { steer: 0, throttle: 0, boost: false };
    for (const [sx, angle, want] of [[28, Math.PI / 2, 28], [-28, -Math.PI / 2, -28]]) {
      const st = pose.createPoseStore();
      // Raw lead would be sx + speed*0.5 = +/-35 (past the +/-28 wall).
      const S = driveSnap([kart('pb', sx, 0, angle, 14)]);
      pose.ingestSnapshot(st, S, 'pa', 1000);
      let p = null;
      for (let t = 1016; t <= 4000; t += 16.7) {
        p = pose.framePoses(st, S, idle, 1 / 60, t, {}).get('pb');
        assert(Math.abs(p.x) <= pose.BOUND + 1e-9 && Math.abs(p.z) <= pose.BOUND + 1e-9,
          `remote stays inside the arena (x=${p.x.toFixed(2)}, z=${p.z.toFixed(2)})`);
      }
      approx(p.x, want, 0.5, 'remote converges to the clamped wall target');
    }
    console.log('SMOOTH ok: remote extrapolation clamped to arena walls');
  }

  // --- 11. self freezes past the snapshot cutoff, recovers on fresh data ---
  {
    const st = pose.createPoseStore();
    const S = driveSnap([kart('pa', 0, -20, 0, 0)]);
    pose.ingestSnapshot(st, S, 'pa', 1000);
    const gas = { steer: 0, throttle: 1, boost: false };
    let p = null;
    for (let t = 1016; t <= 1400; t += 16.7) p = pose.framePoses(st, S, gas, 1 / 60, t, {}).get('pa');
    assert(p.z > -20 + 0.5, 'ordinary delayed snapshots still drive, z=' + p.z.toFixed(2));
    for (let t = 1416; t <= 3000; t += 16.7) p = pose.framePoses(st, S, gas, 1 / 60, t, {}).get('pa');
    const frozen = p.z;
    for (let t = 3016; t <= 6000; t += 16.7) p = pose.framePoses(st, S, gas, 1 / 60, t, {}).get('pa');
    approx(p.z, frozen, 1e-9, 'frozen connection stops driving past the cutoff');
    // Fresh snapshot (recovery): prediction resumes from the reconciled pose.
    const S2 = driveSnap([kart('pa', 0, frozen, 0, 5)]);
    pose.ingestSnapshot(st, S2, 'pa', 6100);
    p = pose.framePoses(st, S2, gas, 1 / 60, 6116, {}).get('pa');
    assert(p.z > frozen, 'fresh snapshot resumes self prediction');
    console.log('SMOOTH ok: self freezes past cutoff, recovers on fresh snapshots');
  }

  // --- 12. prediction collides with bumper blocks exactly like the server ---
  {
    assert.strictEqual(pose.KART_R, engine.constants.KART_R, 'KART_R agrees');
    // Real server rollout into the (16,16) block face, mirrored step for step.
    const players = [{ id: 'pa', name: 'Ann' }, { id: 'pb', name: 'Bob' }];
    const ctx = {
      _now: 6000000, players: () => players.slice(), allPlayers: () => players.slice(),
      content: () => ({}), settings: () => ({ mode: 'Star Rush', map: 'Bumper Blocks' }), hostId: () => 'pa',
      broadcast: () => {}, lobby: () => {}, later: () => () => {}, award: () => {},
      now: function () { return this._now; },
    };
    const sim = karts.create(ctx);
    ctx._now += 3000;
    karts.onTick(sim, ctx);
    assert.strictEqual(sim.blocks.length, 4, 'blocks map collides');
    const k0 = sim.karts[0];
    k0.x = 16; k0.z = 5; k0.angle = 0; k0.speed = 0; // straight at the block
    karts.onAction(sim, ctx, 'pa', { input: { steer: 0, throttle: 1 } });
    for (let i = 0; i < 10; i++) {
      if (i % 5 === 0) karts.onAction(sim, ctx, 'pa', { input: { steer: 0, throttle: 1 } });
      ctx._now += 100;
      karts.onTick(sim, ctx);
    }
    const p = { x: 16, z: 5, angle: 0, speed: 0, boost: 0, boostCd: 0 };
    for (let i = 0; i < 10; i++) {
      pose.stepSelf(p, { steer: 0, throttle: 1, boost: false }, 0.1, { blocks: sim.blocks });
    }
    assert.strictEqual(p.x, k0.x, 'block rollout x matches server');
    assert.strictEqual(p.z, k0.z, 'block rollout z matches server');
    assert.strictEqual(p.speed, k0.speed, 'block rollout speed matches server');
    approx(k0.z, 13.5 - engine.constants.KART_R, 0.05, 'both rest on the block face');
    // Control: without blocks the same rollout tunnels INTO the block rect
    // (z 13.5..18.5) — the divergence the mirror eliminates.
    const q = { x: 16, z: 5, angle: 0, speed: 0, boost: 0, boostCd: 0 };
    for (let i = 0; i < 10; i++) {
      pose.stepSelf(q, { steer: 0, throttle: 1, boost: false }, 0.1);
    }
    assert(q.z > 13.5, `blockless prediction tunnels into the block (z=${q.z.toFixed(2)})`);
    // framePoses plumbing: opts.blocks reaches the self stepper.
    const mk = () => {
      const st = pose.createPoseStore();
      pose.ingestSnapshot(st, driveSnap([kart('pa', 16, 11, 0, 0)]), 'pa', 1000);
      return st;
    };
    const gas = { steer: 0, throttle: 1, boost: false };
    const run = (st, opts) => {
      let out = null;
      const S = driveSnap([kart('pa', 16, 11, 0, 0)]);
      for (let t = 1016; t <= 1490; t += 16.7) {
        out = pose.framePoses(st, S, gas, 1 / 60, t, opts).get('pa');
      }
      return out;
    };
    const withB = run(mk(), { blocks: sim.blocks });
    const withoutB = run(mk(), {});
    assert(withB.z <= 13.5 - engine.constants.KART_R + 0.05, `framed self rests on the face (z=${withB.z.toFixed(2)})`);
    assert(withoutB.z > withB.z + 0.2, 'framed self without blocks runs past the face');
    console.log('SMOOTH ok: prediction block mirror is bit-identical to the server');
  }
}

main().then(
  () => console.log('SMOOTH_PASS'),
  (e) => { console.error(e); process.exit(1); },
);
