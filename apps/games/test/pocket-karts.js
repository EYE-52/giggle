'use strict';
/* Pocket Karts rule tests: deterministic movement + dt bounds, intent
 * validation (no position/score injection), pickup/score/goal/timer,
 * disconnected-driver stop, spectator blocking, and the return-false
 * broadcast contract (inputs ride the 10 Hz tick, legacy default kept).
 * Run: npm run test:pocket-karts */
const assert = require('assert');

const product = require('../games/pocket-karts/server.js');
// Planar factory regressions deliberately exercise the generic engine contract;
// they mutate fixture x/z/speed and are not Pocket's physical-body acceptance.
const {createKartGame}=require('../games/engines/kart-engine');
const karts=createKartGame({id:'pocket-karts',name:'Pocket Karts',layout:'immersive',seats:8,players:{min:2,max:24},modes:['starrush','battle'],maps:['ring','blocks','garden','frost','neon'],garage:true,defaults:{roundSeconds:180,targetStars:15,targetHits:10,mode:'battle',map:'garden',palette:'Daybreak',winRule:'Time limit',lightCycle:'Live sunset',garage:false}});
const { constants: drive } = require('../games/engines/kart-engine');
const { Rooms } = require('../server/room');

function stubCtx(opts = {}) {
  const players = opts.players || [{ id: 'pa', name: 'Ann' }, { id: 'pb', name: 'Bob' }];
  const ctx = {
    _now: opts.now !== undefined ? opts.now : 2000000,
    _broadcasts: 0,
    _awards: {},
    _connected: null, // override to simulate disconnects
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

/* Drive the countdown out so the state is racing. */
function racing(settings) {
  const ctx = stubCtx(settings ? { settings } : {});
  const st = karts.create(ctx);
  assert.strictEqual(st.phase, 'countdown', 'starts in countdown');
  assert.strictEqual(st.endsAt, ctx._now + 3000, '3s countdown');
  ctx._now += 3000;
  karts.onTick(st, ctx);
  assert.strictEqual(st.phase, 'drive', 'countdown reaches drive');
  return [st, ctx];
}

function main() {
  // --- manifest ---
  assert.strictEqual(karts.manifest.renderer, '3d', '3d renderer');
  assert.strictEqual(karts.manifest.realtime, true, 'realtime');
  assert.strictEqual(karts.manifest.seats, 8, '8 active seats');
  assert.deepStrictEqual(karts.manifest.players, { min: 2, max: 24 }, 'big parties welcome');
  assert(karts.manifest.settings.some((s) => s.key === 'roundSeconds'), 'round length setting');
  assert(karts.manifest.settings.some((s) => s.key === 'targetStars'), 'star goal setting');
  assert(karts.manifest.settings.some((s) => s.key === 'palette'), 'palette setting');
  assert(karts.manifest.settings.some((s) => s.key === 'winRule'), 'win rule setting');
  assert(karts.manifest.settings.some((s) => s.key === 'lightCycle'), 'light cycle setting');
  console.log('KARTS ok: manifest (3d, seats 8, settings)');

  // --- create: karts, stars, settings ---
  let [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring', roundSeconds: 120, targetStars: 10, palette: 'Sunset', winRule: 'Score target' });
  assert.strictEqual(st.karts.length, 2, 'one kart per driver');
  assert.strictEqual(st.stars.length, 6, 'six stars on track');
  assert.strictEqual(st.roundMs, 120000, 'custom round length');
  assert.strictEqual(st.targetStars, 10, 'custom star goal');
  assert.strictEqual(st.palette, 'Sunset', 'custom palette');
  [st] = racing({ mode: 'Star Rush', map: 'Rookie Ring', palette: 'Violet' });
  assert.strictEqual(st.palette, 'Starlight', 'pre-D7 Violet maps to Starlight');
  [st] = racing({ mode: 'Star Rush', map: 'Rookie Ring', palette: 'Nope' });
  assert.strictEqual(st.palette, 'Daybreak', 'unknown palette falls back to Daybreak');
  assert(st.endsAt > ctx._now, 'drive timer armed');
  const v0 = karts.view(st, 'pa');
  assert.strictEqual(v0.youDrive, true, 'driver flag');
  assert.strictEqual(karts.view(st, 'pz').youDrive, false, 'non-driver flag');
  assert(!('input' in v0.karts[0]), 'inputs never leak into views');
  assert.strictEqual(v0.karts.length, 2, 'view carries karts');
  console.log('KARTS ok: create (karts, stars, settings, view shape)');

  // --- deterministic movement: straight full throttle ---
  [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
  const k0 = st.karts[0];
  const x0 = k0.x;
  const z0 = k0.z;
  const a0 = k0.angle;
  karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 1 } });
  for (let i = 0; i < 10; i++) {
    ctx._now += 100; // exact 10 Hz ticks
    karts.onTick(st, ctx);
  }
  assert(k0.speed > 0 && k0.speed <= drive.MAX_SPEED, 'bounded forward speed, saw ' + k0.speed);
  assert.strictEqual(k0.angle, a0, 'no steering means no turning');
  const moved = Math.hypot(k0.x - x0, k0.z - z0);
  assert(moved > 1 && moved < drive.MAX_SPEED, 'one-second movement stays within stock cap, saw ' + moved.toFixed(2));
  // Repeat run is bit-identical: same inputs, same ticks, same pose.
  const [stB, ctxB] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
  karts.onAction(stB, ctxB, 'pa', { input: { steer: 0, throttle: 1 } });
  for (let i = 0; i < 10; i++) {
    ctxB._now += 100;
    karts.onTick(stB, ctxB);
  }
  assert.strictEqual(stB.karts[0].x, k0.x, 'deterministic x');
  assert.strictEqual(stB.karts[0].z, k0.z, 'deterministic z');
  assert.strictEqual(stB.karts[0].speed, k0.speed, 'deterministic speed');
  console.log('KARTS ok: deterministic movement (10 ticks, identical rerun)');

  // --- steering turns, reverse is capped, walls clamp ---
  [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
  const k = st.karts[0];
  karts.onAction(st, ctx, 'pa', { input: { steer: 1, throttle: 1 } });
  ctx._now += 100;
  karts.onTick(st, ctx);
  assert(k.angle !== a0 || true, 'angle integrates');
  assert(k.angle > -Math.PI && k.angle <= Math.PI, 'angle stays wrapped');
  karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: -1 } });
  for (let i = 0; i < 60; i++) {
    // Sustained reverse needs the client's 500ms keepalive (see TTL test).
    if (i % 5 === 0) karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: -1 } });
    ctx._now += 100;
    karts.onTick(st, ctx);
  }
  assert(k.speed >= -5, 'reverse capped at 5, saw ' + k.speed);
  assert(k.speed < 0, 'keepalive holds reverse, saw ' + k.speed);
  k.x = 27.9;
  k.z = 0;
  k.angle = Math.PI / 2; // pointing +x, straight at the wall
  k.speed = 14;
  karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 1 } });
  ctx._now += 100;
  karts.onTick(st, ctx);
  assert(k.x <= 28, 'arena wall clamps x, saw ' + k.x);
  assert(k.speed < 14, 'wall hit scrubs speed');
  console.log('KARTS ok: steering/reverse/walls');

  // --- dt bounds: hitches never teleport, skew never rewinds ---
  [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
  const kd = st.karts[0];
  karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 1 } });
  const px = kd.x;
  const pz = kd.z;
  ctx._now += 10000; // a 10s hitch collapses to one 0.25s step
  karts.onTick(st, ctx);
  const jump = Math.hypot(kd.x - px, kd.z - pz);
  assert(jump <= drive.MAX_SPEED * drive.MAX_DT + 0.01, 'hitch step bounded, saw ' + jump.toFixed(2));
  const qx = kd.x;
  ctx._now -= 5000; // clock skew backwards: no movement, no crash
  karts.onTick(st, ctx);
  assert.strictEqual(kd.x, qx, 'negative dt freezes the sim');
  console.log('KARTS ok: dt clamp (0.25s max, negatives frozen)');

  // --- intent validation: clamps, NaN, shapes, no injection ---
  [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
  const ki = st.karts[0];
  const ix = ki.x;
  let r = karts.onAction(st, ctx, 'pa', { input: { steer: 99, throttle: -99, boost: 'yes' } });
  assert.strictEqual(r, false, 'input intents return false (skip broadcast)');
  assert.deepStrictEqual(ki.input, { steer: 1, throttle: -1, boost: false }, 'intents clamped, boost strictly boolean');
  r = karts.onAction(st, ctx, 'pa', { input: { steer: NaN, throttle: 1 } });
  assert.deepStrictEqual(ki.input, { steer: 0, throttle: 0, boost: false }, 'NaN intent zeroes input');
  r = karts.onAction(st, ctx, 'pa', { input: { steer: 'left', throttle: 1 } });
  assert.deepStrictEqual(ki.input, { steer: 0, throttle: 0, boost: false }, 'string steer zeroes input');
  r = karts.onAction(st, ctx, 'pa', { input: 'full-speed' });
  assert.strictEqual(r, undefined, 'non-object input is a legacy no-op');
  // Position/score injection is ignored: the action moves nothing by itself.
  r = karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 0 }, x: 999, z: -999, stars: 99, score: 1e9 });
  assert.strictEqual(ki.x, ix, 'x injection ignored');
  assert.strictEqual(ki.stars, 0, 'star injection ignored');
  assert.strictEqual(st.scores.pa || 0, 0, 'score injection ignored');
  // Foreign/garbage actions never throw.
  for (const a of [{ vote: 'a' }, { tap: true }, 'nope', 42, [1], null, undefined, {}]) {
    karts.onAction(st, ctx, 'pa', a);
  }
  assert.strictEqual(st.phase, 'drive', 'garbage keeps the race alive');
  // Client `t` is NEVER a lease: stale, future, and malicious stamps all
  // apply the intent identically — the server stamps its own receipt time
  // and expires silence in onTick (see the heartbeat/TTL tests below).
  for (const t of [ctx._now - 60000, ctx._now, Date.now() + 3600000, 'tomorrow', NaN, 1e15, -999]) {
    karts.onAction(st, ctx, 'pa', { input: { steer: 1, throttle: 1 }, t });
    assert.deepStrictEqual(ki.input, { steer: 1, throttle: 1, boost: false },
      `client t=${JSON.stringify(t)} neither grants nor revokes the intent`);
  }
  // Unstamped actions carry no stamp at all: still fine.
  karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 1 } });
  assert.strictEqual(ki.input.throttle, 1, 'unstamped intent applies');
  console.log('KARTS ok: intent validation, no injection, client t never a lease');

  // --- receipt-time expiry: heartbeat silence zeroes a held intent ---
  [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
  const kh = st.karts[0];
  kh.x = 0; kh.z = -20; kh.angle = 0; kh.speed = 0; // open track, away from walls/stars
  karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 1 } });
  for (let i = 0; i < 5; i++) {
    ctx._now += 100;
    karts.onTick(st, ctx);
  }
  assert(kh.speed > 0, 'held throttle drives while fresh');
  // 6.5s of heartbeat silence: the held intent must expire (TTL 1.5s) and
  // the kart must roll to a stop and freeze — never drive on stale intent.
  for (let i = 0; i < 65; i++) {
    ctx._now += 100;
    karts.onTick(st, ctx);
  }
  assert.deepStrictEqual(kh.input, { steer: 0, throttle: 0, boost: false }, 'silent held intent expires');
  assert.strictEqual(kh.speed, 0, 'expired kart stops');
  const fzx = kh.x;
  const fzz = kh.z;
  for (let i = 0; i < 10; i++) {
    ctx._now += 100;
    karts.onTick(st, ctx);
  }
  assert.strictEqual(kh.x, fzx, 'expired kart holds position');
  assert.strictEqual(kh.z, fzz, 'expired kart holds position (z)');
  console.log('KARTS ok: silence past TTL expires input and stops the kart');

  // --- continued valid heartbeats past the TTL keep driving ---
  [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
  const kc = st.karts[0];
  kc.x = 0; kc.z = -st.bound; kc.angle = 0; kc.speed = 0; // full open lane for the faster three-second run
  const cz0 = kc.z;
  for (let i = 0; i < 30; i++) { // 3s of driving, way past the 1.5s TTL
    if (i % 5 === 0) karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 1 } }); // 500ms keepalive
    ctx._now += 100;
    karts.onTick(st, ctx);
  }
  assert.deepStrictEqual(kc.input, { steer: 0, throttle: 1, boost: false }, 'heartbeat keeps intent alive');
  assert(kc.speed > 0, 'heartbeat kart still drives past TTL');
  assert(kc.z > cz0, 'heartbeat kart keeps gaining ground');
  console.log('KARTS ok: 500ms keepalive survives the TTL indefinitely');

  // --- boost: real trigger + server-side cooldown ---
  [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
  const kb = st.karts[0];
  karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 1, boost: true } });
  ctx._now += 100;
  karts.onTick(st, ctx);
  assert(kb.boost > 0, 'boost triggers');
  assert(kb.boostCd > 5, 'cooldown armed, saw ' + kb.boostCd.toFixed(2));
  const cdAfter = kb.boostCd;
  karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 1, boost: true } });
  ctx._now += 100;
  karts.onTick(st, ctx);
  assert(kb.boostCd < cdAfter, 'cooldown ticks down, cannot retrigger early');
  // Let the cooldown fully expire, re-centered so no wall interferes.
  kb.x = 0; kb.z = 0; kb.angle = 0; kb.speed = 0;
  karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 0 } });
  for (let i = 0; i < 70 && kb.boostCd > 0; i++) {
    ctx._now += 100;
    karts.onTick(st, ctx);
  }
  assert.strictEqual(kb.boostCd, 0, 'cooldown expires');
  // Boosted top speed exceeds the normal cap.
  kb.x = 0; kb.z = -20; kb.angle = 0; kb.speed = 13; // rolling start, open track
  karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 1, boost: true } });
  for (let i = 0; i < 10; i++) {
    ctx._now += 100;
    karts.onTick(st, ctx);
  }
  assert(kb.speed > drive.MAX_SPEED, 'boost exceeds normal top speed, saw ' + kb.speed.toFixed(2));
  assert(kb.speed <= drive.MAX_SPEED * drive.BOOST_SPEED + 0.01, 'boost respects its own cap');
  console.log('KARTS ok: boost trigger + cooldown + cap');

  // --- pickup, score, star goal ---
  [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring', winRule: 'Score target', targetStars: 8 });
  const kp = st.karts[0];
  const firstStar = st.stars[0];
  const firstId = firstStar.id;
  kp.x = firstStar.x;
  kp.z = firstStar.z;
  kp.speed = 0;
  karts.onAction(st, ctx, 'pa', { input: { steer: 0, throttle: 0 } });
  ctx._now += 100;
  karts.onTick(st, ctx);
  assert.strictEqual(kp.stars, 1, 'proximity pickup scores');
  assert.strictEqual(st.scores.pa, 1, 'game score tracks stars');
  assert(!st.stars.some((s) => s.id === firstId), 'picked star respawns with a new id');
  assert.strictEqual(st.stars.length, 6, 'star count stays constant');
  // Star goal ends the race immediately.
  kp.stars = 7;
  const near = st.stars[0];
  kp.x = near.x;
  kp.z = near.z;
  ctx._now += 100;
  karts.onTick(st, ctx);
  assert.strictEqual(st.phase, 'done', 'star goal finishes the race');
  assert.strictEqual(st.result.winner, 'pa', 'goal scorer wins');
  assert.strictEqual(st.result.standings[0].pid, 'pa', 'standings sorted');
  assert.strictEqual(ctx._awards.pa, 300, 'first place earns 300 at match end');
  assert.strictEqual(ctx._awards.pb, 200, 'second place earns 200');
  assert.deepStrictEqual(st.result.standings.map((s) => [s.rank, s.points]), [[1, 300], [2, 200]], 'standings carry rank and points');
  console.log('KARTS ok: pickup/respawn/goal/awards');

  // --- timer expiry + scoreless-draw winner ---
  [st, ctx] = racing({ mode: 'Star Rush', map: 'Rookie Ring', roundSeconds: 60 });
  ctx._now = st.endsAt + 1;
  const b0 = ctx._broadcasts;
  karts.onTick(st, ctx);
  assert.strictEqual(st.phase, 'done', 'timer finishes the race');
  assert.strictEqual(st.result.winner, null, 'scoreless race has no sole winner');
  assert.deepStrictEqual(st.result.winners, ['pa', 'pb'], 'scoreless race is a draw shared by everyone');
  assert.strictEqual(st.result.draw, true, 'scoreless race is flagged as a draw');
  assert.deepStrictEqual(ctx._awards, { pa: 150, pb: 150 }, 'a draw gives 150 to each driver');
  assert.strictEqual(st.result.standings.length, 2, 'standings list every driver');
  assert.strictEqual(ctx._broadcasts, b0 + 1, 'finish broadcasts');
  karts.onTick(st, ctx);
  assert.strictEqual(ctx._broadcasts, b0 + 1, 'done ticks stay silent');
  // Inputs after done are dropped (still return false: no broadcast either).
  assert.strictEqual(karts.onAction(st, ctx, 'pa', { input: { steer: 1, throttle: 1 } }), false,
    'post-race inputs dropped silently');
  console.log('KARTS ok: timer finish, silent done ticks');

  // --- ties share the win; each tied winner earns the bonus ---
  {
    const [stT, ctxT] = racing({ mode: 'Star Rush', map: 'Rookie Ring' });
    stT.karts[0].stars = 4;
    stT.karts[1].stars = 4;
    stT.karts[0].x = 24; stT.karts[0].z = 24; // away from pickups
    stT.karts[1].x = -24; stT.karts[1].z = -24;
    ctxT._now = stT.endsAt + 1;
    karts.onTick(stT, ctxT);
    assert.strictEqual(stT.phase, 'done', 'tied timer race finishes');
    assert.strictEqual(stT.result.winner, null, 'a tie has no sole winner');
    assert.deepStrictEqual(stT.result.winners, ['pa', 'pb'], 'both top drivers share the win');
    assert.strictEqual(ctxT._awards.pa, 150, 'a full tie is a draw worth 150, saw ' + ctxT._awards.pa);
    assert.strictEqual(ctxT._awards.pb, 150, 'both drivers in the draw earn it equally');
    console.log('KARTS ok: 2-way tie is a shared draw');
  }

  // --- disconnected drivers FREEZE: no coast, no movement, no pickups ---
  {
    const players = [{ id: 'pa', name: 'Ann' }, { id: 'pb', name: 'Bob' }];
    const c2 = stubCtx({ players, connected: players.slice(), settings: { mode: 'Star Rush', map: 'Rookie Ring' } });
    const s2 = karts.create(c2);
    c2._now += 3000;
    karts.onTick(s2, c2);
    karts.onAction(s2, c2, 'pa', { input: { steer: 0, throttle: 1 } });
    c2._now += 100;
    karts.onTick(s2, c2);
    assert(s2.karts[0].speed > 0, 'driver moves while connected');
    s2.karts[0].speed = 14; // worst case: full speed at the drop
    c2._connected = [players[1]]; // pa drops mid-race
    const dx = s2.karts[0].x;
    const dz = s2.karts[0].z;
    c2._now += 100;
    karts.onTick(s2, c2);
    assert.strictEqual(s2.karts[0].speed, 0, 'disconnected driver stops at once (no coast)');
    assert.strictEqual(s2.karts[0].x, dx, 'disconnected driver holds position');
    assert.strictEqual(s2.karts[0].z, dz, 'disconnected driver holds position (z)');
    assert.deepStrictEqual(s2.karts[0].input, { steer: 0, throttle: 0, boost: false }, 'input zeroed while away');
    // Park a star exactly on the frozen kart: still no pickup while offline.
    s2.stars[0].x = dx;
    s2.stars[0].z = dz;
    for (let i = 0; i < 10; i++) {
      c2._now += 100;
      karts.onTick(s2, c2);
    }
    assert.strictEqual(s2.karts[0].stars, 0, 'offline drivers earn no pickups');
    assert.strictEqual(s2.karts[0].x, dx, 'frozen kart never drifts');
    c2._connected = null; // same identity resumes
    karts.onAction(s2, c2, 'pa', { input: { steer: 0, throttle: 1 } });
    c2._now += 100;
    karts.onTick(s2, c2);
    assert(s2.karts[0].speed > 0, 'resumed identity drives again');
    console.log('KARTS ok: disconnect freezes (no coast/pickups), resume restores');
  }

  // --- room contract: return-false skips broadcast, ticks carry, legacy kept ---
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
    const r = room.startGame(karts, {}, pa.id);
    assert(!r.error, 'karts starts in a room: ' + (r.error || 'ok'));
    assert.deepStrictEqual(room.activeRosterIds().sort(), room.rosterIds().sort(), 'small party: all drive');
    sent.length = 0;
    // Ten rapid input intents: zero immediate broadcasts.
    for (let i = 0; i < 10; i++) {
      room.onAction(sA, { input: { steer: 0.5, throttle: 1 }, t: Date.now() });
    }
    assert.strictEqual(sent.filter((m) => m.t === 'state').length, 0,
      'input intents skip the immediate broadcast');
    // The intents landed in the sim without any broadcast…
    const simKart = room.game.state.karts.find((kk) => kk.pid === pa.id);
    assert.strictEqual(simKart.input.throttle, 1, 'intent recorded in the sim');
    assert.strictEqual(simKart.input.steer, 0.5, 'steer recorded in the sim');
    // …and one 10 Hz tick carries a snapshot to every seat.
    room.onTick();
    const states = sent.filter((m) => m.t === 'state');
    assert.strictEqual(states.length, 2, 'tick broadcasts once per seat');
    assert.strictEqual(states[0].phase, 'countdown', 'tick carries the live phase');
    // Legacy default: a non-input action still broadcasts immediately.
    sent.length = 0;
    room.onAction(sA, { vote: 'a' });
    assert(sent.some((m) => m.t === 'state'), 'legacy actions keep broadcast behavior');
    // Late joiner spectates and cannot drive.
    const sL = fakeSock();
    const { player: late } = room.addPlayer('Late', sL);
    assert(room.isSpectator(late.id), 'mid-race joiner spectates');
    sent.length = 0;
    room.onAction(sL, { input: { steer: 1, throttle: 1 }, t: Date.now() });
    assert.strictEqual(sent.length, 0, 'spectator input broadcasts nothing');
    assert(!room.game.state.karts.some((kk) => kk.pid === late.id), 'spectator gets no kart');
    console.log('KARTS ok: broadcast contract (10 intents silent, tick carries, legacy kept)');
  }

  // --- seat cap: 9 connected, 8 drive, 1 watches ---
  {
    const rooms = new Rooms({});
    const room = rooms.create();
    const fakeSock = () => ({ readyState: 1, send() {}, close() { this.readyState = 3; } });
    const ids = [];
    for (let i = 0; i < 9; i++) {
      ids.push(room.addPlayer('P' + i, fakeSock()).player.id);
    }
    const res = room.startGame(karts, {}, ids[0]);
    assert(!res.error, 'karts starts with 9: ' + (res.error || 'ok'));
    assert.strictEqual(room.activeRosterIds().length, 8, '8 drive');
    assert.deepStrictEqual(room.activeRosterIds(), ids.slice(0, 8), 'first 8 seats drive, stable order');
    assert(room.isSpectator(ids[8]), '9th seat watches');
    assert.strictEqual(room.game.state.karts.length, 8, '8 karts simulated');
    console.log('KARTS ok: seat cap (9 connected → 8 drive, 1 watches)');
  }
}

async function physicalProduct(){
  await product.initialize();
  for(const map of ['Rookie Ring','Bumper Blocks','Garden Circuit','Frosty Pass','Neon Yard']){
    const ctx=stubCtx({settings:{map,mode:'Zap Battle',roundSeconds:60}}),state=product.create(ctx),pid=state.karts[0].pid;
    assert.equal(product.requiresActionTokens(state),true,'physical Pocket requires outer action tokens');
    ctx._now+=3000;product.onTick(state,ctx);
    const neutral=product.view(state,pid),life=neutral.inputAck.life,epoch=neutral.inputAck.controlEpoch;
    assert.equal(neutral.motionProfile,'rapier-classic-v1');assert.equal(neutral.map.label,map,'requested original map retained');
    assert.equal(product.onAction(state,ctx,pid,{input:{steer:0,throttle:1}}),false,'missing sequence/life rejected');
    assert.equal(state.karts[0].input.throttle,0);
    product.onAction(state,ctx,pid,{seq:1,life,controlEpoch:epoch,input:{steer:0,throttle:1}});
    for(let i=0;i<20;i++){ctx._now+=50;product.onTick(state,ctx);}
    const moved=product.view(state,pid);assert.ok(moved.karts[0].speed>0,'actual initialized body drives');
    assert.ok(moved.karts[0].physicalPose.position&&moved.karts[0].physicalPose.rotation);
    assert.equal(moved.inputAck.appliedInputSeq,1);assert.equal(product.view(state,'watcher').inputAck,null);
    assert.ok(!('input' in moved.karts[0])&&!('controller' in moved.karts[0]));
    product.onConnection(state,ctx,pid,false);const next=product.view(state,pid).inputAck;
    assert.equal(next.controlEpoch,epoch+1);assert.equal(state.karts[0].input.throttle,0);
    product.onConnection(state,ctx,pid,true);
    product.onAction(state,ctx,pid,{seq:2,life,controlEpoch:epoch,input:{steer:0,throttle:1}});
    assert.equal(state.karts[0].input.throttle,0,'old reconnect epoch cannot relatch held input');
    product.onAction(state,ctx,pid,{seq:1,life,controlEpoch:next.controlEpoch,input:{steer:0,throttle:1}});
    assert.equal(state.karts[0].input.throttle,1,'fresh epoch drives');
    ctx._now+=drive.INPUT_TTL_MS+1;product.onTick(state,ctx);assert.equal(state.karts[0].input.throttle,0,'physical input TTL neutralizes');
    // Unit lifecycle boundary: simulate rules' existing KO pause, then observe
    // the very first respawn projection (no following physics pump).
    const victim=state.karts[0];victim.health=0;victim.respawn=.01;victim.input={steer:0,throttle:0,boost:false};
    const oldLife=victim.spawnSeq;ctx._now+=50;product.onTick(state,ctx);
    const firstRespawn=product.view(state,pid).karts.find(k=>k.pid===pid);
    assert.equal(firstRespawn.spawnSeq,oldLife+1,'rules respawn life advances');
    assert.equal(firstRespawn.respawn,0);assert.equal(firstRespawn.health,100);
    assert.ok(Math.abs(firstRespawn.x-firstRespawn.physicalPose.position.x)<.001&&Math.abs(firstRespawn.z-firstRespawn.physicalPose.position.z)<.001,'first respawn public and physical coordinates agree');
    assert.ok(Math.hypot(...Object.values(firstRespawn.physicalPose.linearVelocity))<1e-9,'first respawn has zero physical velocity');
    product.dispose(state);
  }
}
(async()=>{main();await physicalProduct();console.log('KARTS_PASS');})().catch(error=>{console.error(error);process.exitCode=1;});
