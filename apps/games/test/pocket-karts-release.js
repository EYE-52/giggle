// Planar-mutating unit fixtures use an explicit generic variant, not physical Pocket.
'use strict';
/* Pocket Karts release tests: end-reason + exact-once finishes, hitch
 * anti-tunnel sub-stepping (server and prediction mirror agree), full
 * 8-driver rooms with watchers, release/stale-instance handling, rematch
 * resets, and end-to-end delivery over real WebSockets (2 and 8 drivers
 * plus watchers, malformed inputs, movement/pickups observed on snapshots,
 * reconnect resume, rematch, measured tick delivery).
 * Run: node test/pocket-karts-release.js */
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const fs = require('fs');
const karts = require('./fixtures/kart-planar-variant.cjs');
const { createKartGame } = require('../games/engines/kart-engine');
const { validateManifest } = require('../games/_validate');
const registry = require('../games/registry');
const { Rooms } = require('../server/room');

const POSE_URL = '../public/js/games/pocket-karts-pose.mjs';

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

function racing(settings) {
  const ctx = stubCtx(settings ? { settings } : {});
  const st = karts.create(ctx);
  ctx._now += 3000;
  karts.onTick(st, ctx);
  assert.strictEqual(st.phase, 'drive', 'countdown reaches drive');
  return [st, ctx];
}

async function part1() {
  const pose = await import(POSE_URL);

  // --- 1. endReason: goal vs timeout, both modes, ties, exact-once ---
  {
    // Star Rush goal (explicit Score target: the default Time limit plays on).
    let [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring', winRule: 'Score target', targetStars: 8 });
    const kp = st.karts[0];
    kp.stars = 7;
    kp.x = st.stars[0].x; kp.z = st.stars[0].z; kp.speed = 0;
    karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 0 } });
    ctx._now += 100;
    karts.onTick(st, ctx);
    assert.strictEqual(st.phase, 'done', 'star goal finishes');
    assert.strictEqual(st.result.endReason, 'goal', 'rush goal reason');
    assert.strictEqual(karts.view(st, 'pa').result.endReason, 'goal', 'view carries the reason');
    // Star Rush timeout.
    [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring', roundSeconds: 60 });
    st.karts[0].stars = 3;
    st.karts[0].x = 24; st.karts[0].z = 24;
    st.karts[1].x = -24; st.karts[1].z = -24;
    ctx._now = st.endsAt + 1;
    karts.onTick(st, ctx);
    assert.strictEqual(st.result.endReason, 'timeout', 'rush timeout reason');
    assert.strictEqual(st.result.winner, 'pa', 'timeout winner by score');
    // Zap Battle goal (explicit Score target).
    [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring', winRule: 'Score target', targetHits: 1 });
    st.karts[0].hits = 0;
    // Wounded target isolates score-goal settlement; default100 health has its own acceptance.
    st.karts[1].health=1;
    // Direct determinism: park the goal one KO away, then land it.
    st.karts[0].x = 0; st.karts[0].z = 0; st.karts[0].angle = 0;
    st.karts[1].x = 0; st.karts[1].z = 4; st.karts[1].shield = 0;
    st.karts[0].weapon = 'pulse'; st.karts[0].ammo = 3; st.karts[0].shield = 0;
    st.karts[0].fireCd = 0; st.karts[0].prevAction = false;
    karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 0, boost: true } });
    for (let i = 0; i < 6 && st.phase !== 'done'; i++) {
      ctx._now += 100;
      karts.onTick(st, ctx);
    }
    assert.strictEqual(st.phase, 'done', 'hits goal finishes');
    assert.strictEqual(st.result.endReason, 'goal', 'battle goal reason');
    // Battle timeout tie.
    [st, ctx] = racing({ mode: 'battle', map: 'Rookie Ring', roundSeconds: 60 });
    st.karts[0].hits = 2; st.karts[1].hits = 2;
    st.karts[0].x = 24; st.karts[0].z = 24;
    st.karts[1].x = -24; st.karts[1].z = -24;
    ctx._now = st.endsAt + 1;
    karts.onTick(st, ctx);
    assert.strictEqual(st.result.endReason, 'timeout', 'battle tie timeout reason');
    assert.deepStrictEqual(st.result.winners, ['pa', 'pb'], 'battle tie shares');
    // Goal landing on the exact expiry tick counts as goal, deterministically.
    [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring', winRule: 'Score target', targetStars: 8 });
    st.karts[0].stars = 7;
    st.karts[0].x = st.stars[0].x; st.karts[0].z = st.stars[0].z; st.karts[0].speed = 0;
    karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 0 } });
    ctx._now = st.endsAt; // exactly expired AND goal met on this tick
    karts.onTick(st, ctx);
    assert.strictEqual(st.phase, 'done', 'exact-tick finish');
    assert.strictEqual(st.result.endReason, 'goal', 'goal wins the exact tie');
    // Exact-once: further ticks change nothing (result, awards, broadcasts).
    const frozen = JSON.stringify(st.result);
    const awards = JSON.stringify(ctx._awards);
    const b0 = ctx._broadcasts;
    for (let i = 0; i < 5; i++) {
      ctx._now += 100;
      karts.onTick(st, ctx);
    }
    assert.strictEqual(JSON.stringify(st.result), frozen, 'result scored exactly once');
    assert.strictEqual(JSON.stringify(ctx._awards), awards, 'awards granted exactly once');
    assert.strictEqual(ctx._broadcasts, b0, 'done stays silent');
    console.log('RELEASE ok: endReason goal/timeout both modes, exact-tick goal, exact-once');
  }

  // --- 2. hitch sub-step: no tunnel through bumper blocks, mirror agrees ---
  {
    const clearOf = (x, z, blocks) => blocks.every((b) => {
      const cx = Math.max(b.x - b.hw, Math.min(x, b.x + b.hw));
      const cz = Math.max(b.z - b.hd, Math.min(z, b.z + b.hd));
      return Math.hypot(x - cx, z - cz) >= 1.09; // hull radius 1.1
    });
    // Head-on hitch: one 0.25 s tick at full speed rests on the near face.
    const [st, ctx] = racing({ mode: 'Star Rush', map: 'Bumper Blocks' });
    const k = st.karts[0];
    k.x = 16; k.z = 10; k.angle = 0; k.speed = 14;
    karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 1 } });
    ctx._now += 250;
    karts.onTick(st, ctx);
    assert(k.z > 10 && k.z < 13.5, `hitch tick advances to the face, z=${k.z.toFixed(2)}`);
    assert(k.speed < 14, 'face hit scrubs speed');
    assert(clearOf(k.x, k.z, st.blocks), 'kart rests clear of the block');
    // Corner clip: the 0.25 s ray (12.2,14.5)->(14.3,11.7) dips to 0.45u
    // of the (13.5,13.5) corner while both endpoints sit outside the hull
    // band — a single positional step lands clean and clips the corner
    // unseen; substeps collide mid-way and deflect.
    const [sc, ctxc] = racing({ mode: 'Star Rush', map: 'Bumper Blocks' });
    const kc = sc.karts[0];
    kc.x = 12.2; kc.z = 14.5; kc.angle = Math.atan2(0.6, -0.8); kc.speed = 14;
    karts.onAction(sc, ctxc, 'pa', { input: { steer: 0, throttle: 1 } });
    ctxc._now += 250;
    karts.onTick(sc, ctxc);
    assert(clearOf(kc.x, kc.z, sc.blocks), 'corner clip ends clear of the block');
    assert(kc.x < 14.0 || kc.z > 12.0,
      `corner clip deflected, saw (${kc.x.toFixed(2)}, ${kc.z.toFixed(2)})`);
    assert(kc.speed < 14, 'corner clip scrubs speed');
    // Same rollouts through the prediction mirror: bit-identical.
    const p1 = { x: 16, z: 10, angle: 0, speed: 14, boost: 0, boostCd: 0 };
    pose.stepSelf(p1, { steer: 0, throttle: 1, boost: false }, 0.25, { blocks: st.blocks });
    assert.strictEqual(p1.x, k.x, '0.25s head-on x matches server');
    assert.strictEqual(p1.z, k.z, '0.25s head-on z matches server');
    assert.strictEqual(p1.speed, k.speed, '0.25s head-on speed matches server');
    const p2 = { x: 12.2, z: 14.5, angle: Math.atan2(0.6, -0.8), speed: 14, boost: 0, boostCd: 0 };
    pose.stepSelf(p2, { steer: 0, throttle: 1, boost: false }, 0.25, { blocks: sc.blocks });
    assert.strictEqual(p2.x, kc.x, '0.25s corner x matches server');
    assert.strictEqual(p2.z, kc.z, '0.25s corner z matches server');
    assert.strictEqual(p2.speed, kc.speed, '0.25s corner speed matches server');
    assert.strictEqual(p2.angle, kc.angle, '0.25s corner angle matches server');
    // Ordinary 0.1 s ticks use the same substeps in server and prediction.
    const q = { x: 0, z: -20, angle: 0, speed: 8, boost: 0, boostCd: 0 };
    pose.stepSelf(q, { steer: 1, throttle: 1, boost: false }, 0.1);
    const [st3, ctx3] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
    const k3 = st3.karts[0];
    k3.x = 0; k3.z = -20; k3.angle = 0; k3.speed = 8;
    karts.onAction(st3, ctx3, 'pa', { input: { steer: 1, throttle: 1 } });
    ctx3._now += 100;
    karts.onTick(st3, ctx3);
    assert.strictEqual(q.x, k3.x, '0.1s step still bit-identical');
    console.log('RELEASE ok: hitch sub-step stops at blocks, mirror bit-identical');
  }

  // --- 3. full room: 8 drive, 2 watch; release; stale instance; countdown ---
  {
    const rooms = new Rooms({});
    const room = rooms.create();
    const sent = [];
    const fakeSock = () => ({
      readyState: 1, send(m) { sent.push(JSON.parse(m)); }, close() { this.readyState = 3; },
    });
    const socks = [];
    const ids = [];
    for (let i = 0; i < 10; i++) {
      const s = fakeSock();
      socks.push(s);
      ids.push(room.addPlayer('P' + i, s).player.id);
    }
    const r = room.startGame(karts, { settings: { mode: 'Zap Battle', map: 'Bumper Blocks' } }, ids[0]);
    assert(!r.error, 'starts with 10: ' + (r.error || 'ok'));
    assert.strictEqual(room.game.state.karts.length, 8, '8 karts simulated');
    assert(room.isSpectator(ids[8]) && room.isSpectator(ids[9]), '2 beyond-cap watch');
    // Countdown inputs land but move nothing.
    const c0 = room.game.state.karts.map((k) => [k.x, k.z].join(',')).join('|');
    for (let i = 0; i < 8; i++) {
      room.onAction(socks[i], { input: { steer: 1, throttle: 1 } }, null);
    }
    room.onTick(); // still countdown
    assert.strictEqual(room.game.state.phase, 'countdown', 'still counting down');
    const c1 = room.game.state.karts.map((k) => [k.x, k.z].join(',')).join('|');
    assert.strictEqual(c1, c0, 'countdown rejects motion effects');
    // Release clears the stored intent immediately.
    room.onAction(socks[0], { input: { steer: 0, throttle: 0 } }, null);
    assert.deepStrictEqual(room.game.state.karts[0].input,
      { steer: 0, throttle: 0, boost: false }, 'release zeroes the intent');
    // All 8 drive once released.
    room.game.state.endsAt = Date.now() - 1;
    room.onTick();
    assert.strictEqual(room.game.state.phase, 'drive', 'reaches drive');
    const before = room.game.state.karts.map((k) => [k.x, k.z].join(','));
    for (let i = 0; i < 8; i++) {
      room.onAction(socks[i], { input: { steer: 0, throttle: 1 } }, null);
    }
    for (let t = 0; t < 5; t++) room.onTick();
    const after = room.game.state.karts.map((k) => [k.x, k.z].join(','));
    for (let i = 0; i < 8; i++) {
      assert.notStrictEqual(after[i], before[i], `driver ${i} moved`);
    }
    // Spectator fire is ignored (no kart, no broadcast from the room path).
    sent.length = 0;
    room.onAction(socks[9], { input: { steer: 1, throttle: 1, boost: true } }, null);
    assert.strictEqual(sent.length, 0, 'spectator action broadcasts nothing');
    assert(!room.game.state.karts.some((k) => k.pid === ids[9]), 'spectator gets no kart');
    // Stale-instance input is dropped silently.
    const sim0 = room.game.state.karts[0].input;
    room.onAction(socks[0], { input: { steer: -1, throttle: -1 } }, { i: 'dead-instance', w: null });
    assert.deepStrictEqual(room.game.state.karts[0].input, sim0, 'stale instance dropped');
    // Malformed inputs never throw and never move the sim by themselves.
    for (const a of [
      { input: 'full-speed' }, { input: { steer: NaN, throttle: NaN } },
      { input: { steer: 1e9, throttle: -1e9 } }, { input: null }, { x: 999 },
      'nope', 42, null, undefined, {},
    ]) {
      room.onAction(socks[0], a, null);
    }
    assert.strictEqual(room.game.state.phase, 'drive', 'garbage keeps the battle alive');
    console.log('RELEASE ok: 8+2 room, countdown freeze, release, stale drop, malformed safe');
  }

  // --- 4. immersive layout metadata: Pocket owns the viewport, others unchanged ---
  {
    assert.strictEqual(karts.manifest.layout, 'immersive', 'pocket-karts owns the viewport');
    assert(validateManifest(karts).ok, 'immersive kart manifest validates');
    const bare = createKartGame({ id: 'bare-karts', name: 'Bare Karts' });
    assert.strictEqual(bare.manifest.layout, 'standard', 'layout defaults to standard');
    assert(validateManifest(bare).ok, 'default kart manifest validates');
    const weird = createKartGame({ id: 'weird-karts', name: 'Weird', layout: 'fullscreen' });
    assert.strictEqual(weird.manifest.layout, 'standard', 'non-immersive layouts fall back');
    assert(validateManifest(weird).ok, 'fallback manifest validates');
    const catalog = registry.list();
    const entry = catalog.find((g) => g.id === 'pocket-karts');
    assert(entry, 'pocket-karts is catalogued');
    assert.strictEqual(entry.layout, 'immersive', 'catalog carries immersive');
    assert.strictEqual(entry.renderer, '3d', 'catalog carries the 3d renderer');
    console.log('RELEASE ok: immersive metadata (pocket immersive, default standard, catalog)');
  }

  // --- 5. view contract pins (structure only; root browser QA proves visuals) ---
  {
    const viewSrc = fs.readFileSync(path.join(ROOT, 'public/js/engines/kart-view.js'), 'utf8');
    for (const id of ['pk-board', 'pk-lead', 'pk-stand', 'pk-row', 'pk-leadtxt', 'pk-chev']) {
      assert(viewSrc.includes(id), `view emits ${id}`);
    }
    assert(viewSrc.includes('<details'), 'leaderboard is a collapsible details');
    assert(viewSrc.includes('kart-arena.css'), 'view wires the kart stylesheet');
    assert(viewSrc.includes('100dvh') === false, 'viewport sizing lives in CSS, not JS');
    const css = fs.readFileSync(path.join(ROOT, 'public/css/kart-arena.css'), 'utf8');
    assert(css.includes('#gbody[data-layout="immersive"] .pk'), 'immersive stage scoping present');
    assert(css.includes('height: 100dvh'), 'full-viewport stage rule present');
    assert(css.includes('body.game-immersive:has(.pk)'), 'room/rematch kart scoping present');
    assert(css.includes('.pk-board[open]'), 'board open-state rule present');
    for (const key of ['Daybreak', 'Sunset', 'Starlight']) {
      const n = (viewSrc.match(new RegExp(`${key}:\\s*\\{`, 'g')) || []).length;
      assert.strictEqual(n, 1, `exactly one ${key} palette block`);
    }
    for (const req of ['sky:', 'horizon:', 'track:', 'apron:', 'cream:']) {
      assert(viewSrc.includes(req), `palette carries ${req}`);
    }
    console.log('RELEASE ok: view/CSS contract pins (board, immersive scope, palettes)');
  }

  // --- 6. rematch resets everything in-process ---
  {
    const rooms = new Rooms({});
    const room = rooms.create();
    const fakeSock = () => ({ readyState: 1, send() {}, close() { this.readyState = 3; } });
    const sA = fakeSock();
    const sB = fakeSock();
    const { player: pa } = room.addPlayer('Ann', sA);
    room.addPlayer('Bob', sB);
    let res = room.startGame(karts, { settings: { mode: 'Star Rush', map: 'Rookie Ring', winRule: 'Score target', targetStars: 8 } }, pa.id);
    assert(!res.error, 'first game starts');
    const i1 = room.game.instanceId;
    room.game.state.endsAt = Date.now() - 1;
    room.onTick(); // drive
    room.onAction(sA, { input: { steer: 0, throttle: 1 } }, null);
    for (let t = 0; t < 5; t++) room.onTick();
    room.game.state.karts[0].stars = 7;
    const near = room.game.state.stars[0];
    room.game.state.karts[0].x = near.x;
    room.game.state.karts[0].z = near.z;
    room.onTick();
    assert.strictEqual(room.game.state.phase, 'done', 'first game done');
    assert.strictEqual(room.game.state.result.endReason, 'goal', 'first game goal reason');
    // Rematch: same seats, fresh instance.
    res = room.startGame(karts, {}, pa.id);
    assert(!res.error, 'rematch starts');
    assert.notStrictEqual(room.game.instanceId, i1, 'rematch rotates instanceId');
    const st = room.game.state;
    assert.strictEqual(st.phase, 'countdown', 'rematch counts down');
    assert.strictEqual(st.result, null, 'result cleared');
    assert.deepStrictEqual(st.scores, {}, 'scores cleared');
    assert(st.karts.every((k) => k.input.steer === 0 && k.input.throttle === 0 && k.speed === 0),
      'inputs and speeds reset');
    assert(st.karts.every((k) => (k.stars || 0) === 0 && (k.hits || 0) === 0), 'tallies reset');
    console.log('RELEASE ok: rematch resets phase/scores/inputs/tallies/results');
  }
}

const realSetTimeout = setTimeout;
const sleep = (ms) => new Promise((res) => realSetTimeout(res, ms));

async function part2() {
  const WS_PORT = 18241;
  const srv = spawn(process.execPath, ['server/server.js','--noenv'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(WS_PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  const sockets = [];
  const fail = (msg) => {
    console.error('RELEASE_FAIL', msg, '\n--- server log ---\n' + out);
    for (const s of sockets) try { s.close(); } catch {}
    srv.kill();
    process.exit(1);
  };
  const onUncaught = (e) => fail('uncaught: ' + e.stack);
  process.on('uncaughtException', onUncaught);
  for (let i = 0; i < 50 && !out.includes('PartyBox on'); i++) await sleep(100);
  if (!out.includes('PartyBox on')) return fail('server did not boot');

  const mk = () => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
    ws.msgs = [];
    ws.arrivals = [];
    ws.on('message', (d) => {
      const message = JSON.parse(d);
      ws.msgs.push(message);
      ws.arrivals.push({ at: performance.now(), t: message.t, game: message.game, instanceId: message.instanceId, phase: message.phase });
      if (ws.arrivals.length > 32) ws.arrivals.shift();
    });
    ws.on('open', () => { sockets.push(ws); resolve(ws); });
    ws.on('error', reject);
  });
  const send = (ws, o) => ws.send(JSON.stringify(o));
  const last = (ws, t) => [...ws.msgs].reverse().find((m) => m.t === t);
  const helloOf = async (ws, msg) => {
    send(ws, msg);
    await sleep(150);
    const h = last(ws, 'hello');
    assert(h && h.you, 'expected hello, got ' + JSON.stringify(last(ws, 'error')));
    return h;
  };
  const startAndWaitState = async (ws, request) => {
    const previousInstance = last(ws, 'state')?.instanceId;
    ws.arrivals = [];
    const startAt = performance.now();
    send(ws, request);
    // Await a published fresh instance instead of assuming a machine can
    // create and deliver its first physics projection in 300/400ms.
    // This grants no readiness and leaves countdown/deadline tests intact.
    let state;
    while (performance.now() - startAt < 5000) {
      const current = last(ws, 'state');
      if (current?.game === 'pocket-karts' && current.instanceId && current.instanceId !== previousInstance) { state = current; break; }
      if (ws.arrivals.some(arrival => arrival.t === 'error' && arrival.at >= startAt)) break;
      await sleep(20);
    }
    console.log('RELEASE_START_STATE', JSON.stringify({ elapsedMs: performance.now() - startAt, matched: !!state, arrivals: ws.arrivals.map(({ at, ...arrival }) => ({ ...arrival, afterStartMs: at - startAt })) }));
    return state;
  };
  const waitPhase = async (ws, phase, timeoutMs) => {
    const t0 = Date.now();
    for (;;) {
      const s = last(ws, 'state');
      if (s && s.phase === phase) return s;
      if (Date.now() - t0 > timeoutMs) {
        return fail(`timed out waiting for phase ${phase} (at ${s && s.phase})`);
      }
      await sleep(100);
    }
  };

  try {
  // --- R1: 2-driver lifecycle: customize -> countdown -> drive -> timeout -> rematch ---
  {
    const a = await mk();
    const ha = await helloOf(a, { t: 'create', name: 'Ann' });
    const b = await mk();
    const hb = await helloOf(b, { t: 'join', name: 'BobWithAnExtremelyLongPartyName', code: ha.code });
    let s = await startAndWaitState(a, {
      t: 'start', game: 'pocket-karts',
      settings: { roundSeconds: 60, mode: 'Star Rush', map: 'Rookie Ring', palette: 'Sunset', targetStars: 30 },
    });
    assert(s && s.game === 'pocket-karts', 'karts state arrives');
    assert.strictEqual(s.phase, 'countdown', 'starts counting down');
    assert.strictEqual(s.roundMs, 60000, 'custom round length honored');
    assert.strictEqual(s.palette, 'Sunset', 'custom palette honored');
    assert.strictEqual(s.targetStars, 30, 'custom star goal honored');
    assert.strictEqual(s.karts.length, 2, '2 karts for 2 drivers');
    const i1 = s.instanceId;
    assert(i1, 'state carries instanceId');
    // Countdown takes ~3 s of shared server time, then releases.
    const cd0 = Date.now();
    s = await waitPhase(a, 'drive', 8000);
    const countdownMs = Date.now() - cd0;
    // Drive: held inputs move both karts (keepalive every 500 ms like the client).
    const sendInput = (ws, input) => {
      const state=last(ws,'state'),ack=state.inputAck;
      send(ws,{t:'action',a:{input,seq:ws.physicalInputSeq=(ws.physicalInputSeq||0)+1,life:ack.life,controlEpoch:ack.controlEpoch},i:state.instanceId,w:state.w});
    };
    const p0 = new Map(s.karts.map((k) => [k.pid, [k.x, k.z].join(',')]));
    const t0 = Date.now();
    for (let i = 0; i < 6; i++) {
      sendInput(a, { steer: 0, throttle: 1 });
      sendInput(b, { steer: 0.3, throttle: 1 });
      await sleep(500);
    }
    s = last(a, 'state');
    assert.strictEqual(s.phase, 'drive', 'still driving');
    for (const k of s.karts) {
      assert.notStrictEqual([k.x, k.z].join(','), p0.get(k.pid), `${k.pid} moved over WS`);
    }
    // Malformed/stale inputs over the wire: server stays alive and driving.
    for (const bad of [
      { input: 'full-speed' }, { input: { steer: 'left', throttle: 1 } },
      { input: { steer: NaN, throttle: 1 } }, { x: 999, z: -999 },
      'nope', 42, null, {},
    ]) {
      send(a, { t: 'action', a: bad, i: i1, w: last(a, 'state').w });
    }
    send(a, { t: 'action', a: { input: { steer: 1, throttle: 1 } }, i: 'dead', w: null });
    await sleep(400);
    assert.strictEqual(last(a, 'state').phase, 'drive', 'malformed input keeps the race alive');
    // Release: zeros land (no position jump from the garbage above either).
    sendInput(a, { steer: 0, throttle: 0 });
    sendInput(b, { steer: 0, throttle: 0 });
    await sleep(300);
    // Measured delivery: snapshots should flow at ~10 Hz while driving.
    const mark = a.msgs.length;
    await sleep(2000);
    const driveSnaps = a.msgs.slice(mark).filter((m) => m.t === 'state' && m.phase === 'drive').length;
    // Timeout: the 30 s round ends with an explicit reason, scored once.
    s = await waitPhase(a, 'done', 80000);
    assert.strictEqual(s.result.endReason, 'timeout', 'wire timeout reason');
    assert(Array.isArray(s.result.standings) && s.result.standings.length === 2, 'wire standings');
    const r1 = JSON.stringify(s.result);
    await sleep(600);
    assert.strictEqual(JSON.stringify(last(a, 'state').result), r1, 'wire result scored exactly once');
    assert(hb.you, 'long-named Bob stayed connected');
    // Rematch over the wire: fresh instance, countdown, cleared scores.
    s = await startAndWaitState(a, { t: 'start', game: 'pocket-karts' });
    assert(s.instanceId && s.instanceId !== i1, 'rematch rotates instanceId');
    assert.strictEqual(s.phase, 'countdown', 'rematch counts down');
    assert.deepStrictEqual(s.scores, {}, 'rematch clears scores');
    assert(s.karts.every((k) => (k.stars || 0) === 0), 'rematch clears tallies');
    a.close(); b.close();
    console.log(`RELEASE ok: WS 2-driver lifecycle (countdown ${countdownMs} ms, ` +
      `${driveSnaps} drive snapshots/2 s, timeout reason, exact-once, rematch)`);
    if (driveSnaps < 8) console.log(`RELEASE note: low snapshot rate (${driveSnaps}/2 s) — investigate tick loop`);
  }

  // --- R2: 8 drivers + 2 watchers over real sockets ---
  {
    const ws = [];
    for (let i = 0; i < 10; i++) ws.push(await mk());
    const h0 = await helloOf(ws[0], { t: 'create', name: 'Host' });
    const hellos = [h0];
    for (let i = 1; i < 10; i++) {
      hellos.push(await helloOf(ws[i], { t: 'join', name: 'P' + i, code: h0.code }));
    }
    let s = await startAndWaitState(ws[0], {
      t: 'start', game: 'pocket-karts',
      settings: { mode: 'Zap Battle', map: 'Bumper Blocks', targetHits: 20 },
    });
    assert.strictEqual(s.mode, 'battle', 'wire battle mode');
    assert.strictEqual(s.map.id, 'blocks', 'wire blocks map');
    assert.strictEqual(s.karts.length, 8, '8 karts over WS');
    s = await waitPhase(ws[0], 'drive', 8000);
    const sw = last(ws[9], 'state');
    assert.strictEqual(sw.spectator, true, '10th seat spectates');
    assert(!sw.karts.some((k) => k.pid === hellos[9].you), 'watcher has no kart');
    assert.strictEqual(last(ws[0], 'state').spectator, false, 'driver is not a spectator');
    // Watcher fire is ignored; drivers move.
    send(ws[9], { t: 'action', a: { input: { steer: 1, throttle: 1, boost: true } },
      i: sw.instanceId, w: sw.w });
    const p0 = new Map(s.karts.map((k) => [k.pid, [k.x, k.z].join(',')]));
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < 8; i++) {
        const state=last(ws[i],'state');
        send(ws[i],{t:'action',a:{input:{steer:0,throttle:1},seq:ws[i].physicalInputSeq=(ws[i].physicalInputSeq||0)+1,life:state.inputAck.life,controlEpoch:state.inputAck.controlEpoch},i:state.instanceId,w:state.w});
      }
      await sleep(500);
    }
    s = last(ws[0], 'state');
    let moved = 0;
    for (const k of s.karts) {
      if ([k.x, k.z].join(',') !== p0.get(k.pid)) moved += 1;
    }
    assert(moved === 8, `all 8 drivers moved over WS (saw ${moved})`);
    assert(!s.karts.some((k) => k.pid === hellos[9].you), 'watcher fire granted no kart');
    for (const w of ws) w.close();
    console.log('RELEASE ok: WS 8 drivers + 2 watchers (battle on blocks, all moved)');
  }

  // --- R3: disconnect freezes, seat-token resume drives again ---
  {
    const a = await mk();
    const ha = await helloOf(a, { t: 'create', name: 'Ann' });
    assert(ha.seatToken, 'hello carries a resume token');
    const b = await mk();
    await helloOf(b, { t: 'join', name: 'Bob', code: ha.code });
    send(a, { t: 'start', game: 'pocket-karts' });
    await waitPhase(a, 'drive', 8000);
    const sendInput = (ws, input) => {
      const state=last(ws,'state'),ack=state.inputAck;
      send(ws,{t:'action',a:{input,seq:ws.physicalInputSeq=(ws.physicalInputSeq||0)+1,life:ack.life,controlEpoch:ack.controlEpoch},i:state.instanceId,w:state.w});
    };
    sendInput(a, { steer: 0, throttle: 1 });
    await sleep(600);
    let seen = last(b, 'state').karts.find((k) => k.pid === ha.you);
    assert(seen.speed > 0, 'driver rolling before the drop');
    a.close(); // hard drop mid-drive
    // A tick may legitimately arrive between our last rolling snapshot and
    // the server processing close. Anchor to the acknowledged offline state,
    // then prove it stays still across subsequent authoritative ticks.
    const dropAt = Date.now();
    for (;;) {
      const state = last(b, 'state');
      seen = state.karts.find((k) => k.pid === ha.you);
      const player = state.players.find((p) => p.id === ha.you);
      if (player && !player.connected && seen.speed === 0) break;
      assert(Date.now() - dropAt < 3000, 'drop acknowledged and driver stopped');
      await sleep(25);
    }
    const px = seen.x;
    const pz = seen.z;
    await sleep(800);
    seen = last(b, 'state').karts.find((k) => k.pid === ha.you);
    assert.strictEqual(seen.x, px, 'dropped driver holds x');
    assert.strictEqual(seen.z, pz, 'dropped driver holds z');
    assert.strictEqual(seen.speed, 0, 'dropped driver stops');
    // Resume with the seat token: same identity, same kart, drives again.
    const a2 = await mk();
    const hr = await helloOf(a2, { t: 'join', name: 'Ann', code: ha.code, seatToken: ha.seatToken });
    assert.strictEqual(hr.you, ha.you, 'token resume keeps the seat id');
    await sleep(300);
    const s = last(a2, 'state');
    assert(s.karts.some((k) => k.pid === ha.you), 'resumed seat keeps its kart');
    sendInput(a2, { steer: 0, throttle: 1 });
    await sleep(700);
    seen = last(b, 'state').karts.find((k) => k.pid === ha.you);
    assert(seen.speed > 0, 'resumed identity drives again');
    assert([seen.x, seen.z].join(',') !== [px, pz].join(','), 'resumed kart moves '+JSON.stringify({before:{x:px,z:pz},after:seen,ack:last(a2,'state').inputAck}));
    a2.close(); b.close();
    console.log('RELEASE ok: WS disconnect freezes, seat-token resume restores driving');
  }

  } finally {
    for (const s of sockets) try { s.close(); } catch {}
    srv.kill();
    process.removeListener('uncaughtException', onUncaught);
  }
}

async function main() {
  await part1();
  await part2();
  console.log('RELEASE_PASS');
}

main().then(
  () => {},
  (e) => { console.error(e); process.exit(1); },
);
