'use strict';
// Exercise the real authority with delayed callbacks, then cross the actual
// WebSocket join/ready boundary. No browser or simulated game implementation.
const assert = require('node:assert/strict');
const { Room } = require('../server/room');
const registry = require('../games/registry');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const WebSocket = require('ws');
const flush = () => new Promise(resolve => setImmediate(resolve));
const socket = () => ({ readyState: 1, sent: [], send(json) { this.sent.push(JSON.parse(json)); }, close() { this.readyState = 3; } });
const stateOf = ws => ws.sent.findLast(m => m.t === 'state');
const stamp = room => ({ i: room.game.instanceId, w: room._actionToken() });
const readyAll = room => {
  const meta = stamp(room);
  room.activeRosterPlayers().filter(p => p.connected).forEach(p => room.onReady(p.socket, meta));
};

async function authorities() {
  const kartGame = registry.get('pocket-karts');
  await kartGame.initialize(); // actual Pocket Rapier boot, before controlled callback clocks
  const original = { now: Date.now, setTimeout, clearTimeout };
  let now = 1700000000000, seq = 0;
  const timers = new Map(), rooms = [];
  Date.now = () => now;
  global.setTimeout = (fn, ms) => { const id = ++seq; timers.set(id, { fn, due: now + ms }); return id; };
  global.clearTimeout = id => timers.delete(id);
  const advance = async ms => {
    await flush();
    const until = now + ms;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.due <= until).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      now = next[1].due; timers.delete(next[0]); next[1].fn(); await flush();
    }
    now = until; await flush();
  };
  function make(n = 3, giggle = false) {
    const room = new Room('TEST', {}); rooms.push(room);
    const ws = Array.from({ length: n }, socket);
    const ps = ws.map((s, i) => giggle ? room.addGigglePlayer('sub-' + i, 'P' + i, s).player : room.addPlayer('P' + i, s).player);
    const resume = (i, s) => giggle ? room.addGigglePlayer('sub-' + i, 'P' + i, s) : room.addPlayer('P' + i, s, ps[i].token);
    return { room, ws, ps, resume };
  }
  try {
    for (const giggle of [false, true]) {
      const { room, ws, ps, resume } = make(3, giggle);
      assert(room.startGame(registry.get('typing-race'), { ready: true, settings: { rounds: 1, raceSeconds: 15 } }, ps[0].id).ok);
      await flush();
      const initial = stateOf(ws[0]), meta = stamp(room), prepareDeadline = room.game.readyDeadline;
      room.onReady(ws[0], meta);
      room.disconnect(ws[2]);
      const resumed = socket(); assert.equal(resume(2, resumed).resumed, true);
      room.broadcastState();
      assert(stateOf(resumed).waitingFor.includes(ps[2].id), 'a resumed seat rejoins the pending quorum');
      assert.equal(room.game.readyDeadline, prepareDeadline, 'resume never extends the loading timeout');
      room.onReady(ws[1], meta);
      assert.equal(room.game.preparing, true, 'other peers cannot release an unprepared resumed seat');
      room.onAction(resumed, { typed: initial.target }, meta);
      room.onReady(ws[2], meta); // retired socket no longer owns the seat
      room.onReady(resumed, { ...meta, w: 'old-window' });
      assert.equal(room.game.state.finished.length, 0);
      assert.equal(room.game.preparing, true);
      await advance(4000);
      assert.equal(room._gameNow(), initial.gameNow, 'the entire pending interval stays frozen');
      room.onReady(resumed, meta);
      assert.equal(room.game.preparing, false);
      assert.equal(room.game.state.endsAt, initial.endsAt, 'release preserves the authoritative deadline');
      await advance(321);
      room.onAction(resumed, { typed: initial.target }, stamp(room));
      assert.equal(room.game.state.finished[0].ms, 321, 'reconnect loading never inflates the race result');
      const liveDeadline = room.game.state.endsAt, liveNow = room._gameNow();
      room.disconnect(resumed); const liveResume = socket(); resume(2, liveResume);
      assert.equal(room.game.preparing, false, 'already-live rounds never restart preparation');
      assert.equal(room.game.state.endsAt, liveDeadline);
      assert.equal(room._gameNow(), liveNow);
      room.destroy();
    }

    // Replacing a connected, already-ready socket must load again; watchers
    // are never required. The old socket cannot acknowledge for its replacement.
    {
      const { room, ws, ps, resume } = make();
      room.startGame(registry.get('typing-race'), { ready: true }, ps[0].id); await flush();
      const meta = stamp(room); room.onReady(ws[0], meta);
      const replacement = socket(); resume(0, replacement);
      const watcher = socket(); room.addPlayer('Watcher', watcher);
      room.onReady(watcher, meta); room.onReady(ws[0], meta);
      room.onReady(ws[1], meta); room.onReady(ws[2], meta);
      assert.equal(room.game.preparing, true);
      assert.equal(room.game.requiredReady.size, 3);
      room.onReady(replacement, meta); assert.equal(room.game.preparing, false);
      room.destroy();
    }

    for (const id of ['pose-party', 'show-and-go']) {
      const { room, ws, ps } = make(4);
      room.startGame(registry.get(id), { ready: true, settings: { rounds: 1, performSeconds: 10, voteSeconds: 8 } }, ps[0].id);
      await flush(); readyAll(room);
      const s = room.game.state;
      const candidates = id === 'pose-party' ? [s.actor] : ps.slice(0, 2).map(p => p.id);
      const sockOf = pid => room.players.find(p => p.id === pid).socket;
      candidates.forEach(pid => room.onAction(sockOf(pid), { ready: true }, stamp(room)));
      const performToken = stamp(room);
      const oldPerform = [...timers.values()].find(t => t.due === now + s.performMs);
      assert(oldPerform, 'the actual perform callback is captured');
      now = s.endsAt; // delay its callback while a network action reaches expiry
      ws.forEach(w => { w.sent = []; });
      room.onAction(ws[0], { ready: true }, performToken);
      assert.equal(s.phase, 'vote');
      assert(ws.every(w => stateOf(w)?.phase === 'vote'), id + ' expired action publishes the changed window');
      assert.equal(room.game.preparing, true);
      assert.notEqual(stamp(room).w, performToken.w);
      room.onReady(ws[0], performToken); assert.equal(room.game.ready.size, 0);
      oldPerform.fn(); assert.equal(s.phase, 'vote', 'queued perform callback cannot enter twice');
      await flush(); readyAll(room); await flush();
      const voteToken = stamp(room);
      // A strict majority exists, but one judge remains unsubmitted, keeping
      // the vote window open until the deadline. The late ballot must be dropped.
      for (const candidate of candidates) {
        const judges = ps.filter(p => p.id !== candidate);
        for (const judge of judges.slice(0, 2)) room.onAction(sockOf(judge.id), { vote: candidate, approve: true }, voteToken);
      }
      assert.equal(s.phase, 'vote');
      const missing = ps.find(p => p.id !== candidates[0] && s.votes[p.id]?.[candidates[0]] === undefined);
      const oldVote = [...timers.values()].find(t => t.due === now + s.voteMs);
      assert(oldVote);
      now = s.endsAt; ws.forEach(w => { w.sent = []; });
      room.onAction(sockOf(missing.id), { vote: candidates[0], approve: false }, voteToken);
      assert.equal(s.phase, 'reveal');
      assert(ws.every(w => stateOf(w)?.phase === 'reveal'), id + ' expired vote publishes scores and readiness');
      assert.equal(s.votes[missing.id]?.[candidates[0]], undefined, 'expired ballot is not recorded');
      assert(s.last.outcomes.every(o => o.approvals === 2 && o.points === 150));
      const totals = { ...room.totals }; oldVote.fn();
      room.onAction(sockOf(missing.id), { vote: candidates[0], approve: true }, voteToken);
      assert.deepEqual(room.totals, totals, 'queued callback and stale ballot cannot award twice');
      readyAll(room); await advance(6000);
      assert.equal(s.phase, 'done'); assert.deepEqual(room.totals, totals);
      room.destroy();
    }

    for (const offset of [-1, 0, 1]) {
      const { room, ws, ps } = make();
      room.startGame(registry.get('doodle-guess'), { ready: true, settings: { rounds: 1 } }, ps[0].id);
      await flush(); readyAll(room); await flush();
      const s = room.game.state, meta = stamp(room), fallback = s.choices[0];
      // Ensure the alternate is distinct even if a small pack exhausted its bag.
      s.choices = [fallback, 'late-alternate'];
      const oldPick = [...timers.values()].find(t => t.due === s.endsAt);
      assert(oldPick);
      now = s.endsAt + offset; ws.forEach(w => { w.sent = []; });
      const drawer = room.players.find(p => p.id === s.drawer);
      room.onAction(drawer.socket, { choose: 'late-alternate' }, meta);
      assert.equal(s.phase, 'draw');
      assert.equal(s.word, offset < 0 ? 'late-alternate' : fallback, 'selection deadline uses the same automatic fallback as the timer');
      assert(ws.every(w => stateOf(w)?.phase === 'draw'));
      const word = s.word, totals = { ...room.totals }; oldPick.fn();
      assert.equal(s.word, word); assert.deepEqual(room.totals, totals);
      assert.equal(room.game.preparing, true, 'the selected drawing content is prepared before its clock');
      room.onAction(drawer.socket, { choose: 'late-alternate' }, meta);
      assert.equal(s.word, word, 'old pick token cannot affect the drawing');
      room.destroy();
    }

    // Compare an on-time final tick with a delayed pump. A grenade scheduled
    // beyond the deadline cannot turn a tie into a win; a pre-deadline blast
    // and already-accepted fire in the remaining slice must still count.
    function kartCase({ fuse, lateMs = 0, fireAt = null, mode = 'Zap Battle' }) {
      let time = 1000000;
      const players = [{ id: 'a' }, { id: 'b' }], awards = {};
      const ctx = { players: () => players, allPlayers: () => players, content: () => ({}),
        settings: () => ({ mode, map: 'Rookie Ring', winRule: 'Time limit', roundSeconds: 60 }),
        now: () => time, award: (pid, points) => { awards[pid] = (awards[pid] || 0) + points; },
        broadcast() {}, later: () => () => {} };
      const s = kartGame.create(ctx); time += 3000; kartGame.onTick(s, ctx);
      try {
        const [a, b] = s.karts, deadline = s.endsAt;
        const initial = kartGame.view(s, 'a');
        assert.equal(initial.motionProfile, 'rapier-classic-v1', 'final-slice case uses initialized shipping Pocket physics');
        assert(s.karts.every(k => k.physicalPose?.position && k.physicalPose?.rotation), 'poses remain owned by the actual Rapier World');
        Object.assign(a, { shield: 0, respawn: 0, fireCd: 0, prevAction: false });
        // Controlled UNIT wounded/equipped/fuse/clock setup isolates cutoff scoring.
        // Keep actual settled spawns: never mutate obsolete planar x/z/angle/speed.
        Object.assign(b, { shield: 0, respawn: 0, health:1 });
        const target = initial.karts.find(k => k.pid === 'b').physicalPose.position;
        s.crates = []; s.lastTick = deadline - 10;
        if (fuse !== undefined) s.grenades = [{ id: 'cutoff-grenade', owner: 'a', x: target.x, z: target.z, y: target.y,
          vx: 0, vz: 0, vy: 0, angle: 0, fuse, bounces: 0 }];
        if (fireAt !== null) {
          a.weapon = 'rail'; a.ammo = 1; time = deadline + fireAt;
          const ack = kartGame.view(s, 'a').inputAck;
          kartGame.onAction(s, ctx, 'a', { seq: ack.receivedSeq + 1, life: ack.life, controlEpoch: ack.controlEpoch,
            input: { steer: 0, throttle: 0, boost: true } });
          assert.equal(kartGame.view(s, 'a').inputAck.receivedSeq, fireAt < 0 ? ack.receivedSeq + 1 : ack.receivedSeq, 'deadline gates the public current-life sequenced intent');
          assert.equal(a.pendingFire, fireAt < 0, 'only a fire received before the deadline can latch');
          assert.equal(a.lastInputAt, fireAt < 0 ? time : 1000000, 'late input cannot refresh the authoritative intent');
        }
        time = deadline + lateMs; kartGame.onTick(s, ctx);
        assert.equal(s.phase, 'done'); assert.equal(s.lastTick, deadline, 'final simulation time stops at the deadline');
        const totals = { ...awards }; kartGame.onTick(s, ctx);
        assert.deepEqual(awards, totals, 'final pump rewards once');
        return { scores: { ...s.scores }, winners: s.result.winners.slice(), awards, events: (s.events || []).map(e => e.type) };
      } finally { kartGame.dispose(s); }
    }
    for (const fuse of [.005, .05]) {
      const exact = kartCase({ fuse }), delayed = kartCase({ fuse, lateMs: 100 });
      assert.deepEqual(delayed, exact, 'delayed pump has the same cutoff result as an on-time pump');
      assert.equal(delayed.scores.a, fuse < .01 ? 1 : 0, 'only a blast within the remaining slice earns a knockout');
    }
    const before = kartCase({ fireAt: -1, lateMs: 100 });
    assert(before.events.includes('fire'), 'pre-deadline rail intent survives the final slice');
    for (const fireAt of [0, 1, 100]) {
      const late = kartCase({ fireAt, lateMs: 100 });
      assert.equal(late.scores.a, 0); assert(!late.events.includes('fire'), 'post-deadline fire never launches');
    }
    for (const mode of ['Star Rush', 'Garage Battle']) {
      const exact = kartCase({ mode }), delayed = kartCase({ mode, lateMs: 100 });
      assert.deepEqual(delayed, exact, mode + ' keeps its existing cutoff scoring');
    }
    console.log('SERVER_LIFECYCLE_AUTHORITY_PASS: anonymous/Giggle pending resume, replacement/watchers, held/live clocks, camera expiry broadcasts/scores-once, Doodle selection deadline, kart final-slice/cutoff scoring');
  } finally {
    rooms.forEach(room => room.destroy());
    Date.now = original.now; global.setTimeout = original.setTimeout; global.clearTimeout = original.clearTimeout;
  }
}

async function transport() {
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['server/server.js'], { cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
  const sockets = [], sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async predicate => { for (let i = 0; i < 250; i++) { if (predicate()) return; await sleep(20); } throw Error('Lifecycle transport timeout: ' + log); };
  const send = (ws, msg) => ws.send(JSON.stringify(msg));
  const connect = () => new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port); sockets.push(ws); ws.sent = [];
    ws.on('message', data => ws.sent.push(JSON.parse(data))); ws.once('open', () => resolve(ws)); ws.once('error', reject);
  });
  try {
    await until(() => log.includes('PartyBox on'));
    const a = await connect(); send(a, { t: 'create', name: 'Lifecycle A' }); await until(() => a.sent.some(m => m.t === 'hello'));
    const code = a.sent.find(m => m.t === 'hello').code, ws = [a];
    for (const name of ['Lifecycle B', 'Lifecycle C']) {
      const peer = await connect(); ws.push(peer); send(peer, { t: 'join', code, name }); await until(() => peer.sent.some(m => m.t === 'hello'));
    }
    const seat = ws[2].sent.find(m => m.t === 'hello');
    send(a, { t: 'start', game: 'typing-race', ready: true, settings: { rounds: 1, raceSeconds: 15 } });
    await until(() => stateOf(a)?.preparing);
    const first = stateOf(a), meta = { i: first.instanceId, w: first.w };
    send(a, { t: 'game-ready', ...meta });
    send(a, { t: 'clock', id: 'initial-ready-processed' });
    await until(() => a.sent.some(m => m.t === 'clock' && m.id === 'initial-ready-processed'));
    ws[2].close(); await until(() => stateOf(a)?.players.find(p => p.id === seat.you)?.connected === false);
    const resumed = await connect(); send(resumed, { t: 'join', code, name: seat.name, seatToken: seat.seatToken });
    await until(() => stateOf(resumed)?.waitingFor.includes(seat.you));
    assert.equal(resumed.sent.find(m => m.t === 'hello').you, seat.you);
    send(ws[1], { t: 'game-ready', ...meta });
    send(ws[1], { t: 'clock', id: 'pending-peer-processed' });
    await until(() => ws[1].sent.some(m => m.t === 'clock' && m.id === 'pending-peer-processed'));
    assert.equal(stateOf(a).preparing, true, 'the processed peer ACK cannot release an unprepared resumed client');
    assert.equal(stateOf(resumed).preparing, true);
    send(resumed, { t: 'game-ready', ...meta }); await until(() => stateOf(a)?.preparing === false);
    assert.equal(stateOf(a).endsAt, first.endsAt, 'actual transport release retains the original game deadline');
    send(resumed, { t: 'action', ...meta, a: { typed: first.target } }); await until(() => stateOf(a)?.finished?.length === 1);
    assert.equal(stateOf(a).finished[0].pid, seat.you);
    send(a, { t: 'lobby' }); await until(() => a.sent.findLast(m => m.t === 'room')?.room.game === null);
    console.log('SERVER_LIFECYCLE_WS_PASS: production token resume cannot bypass pending readiness; acknowledged resume submits on the held clock');
  } finally {
    sockets.forEach(ws => ws.terminate());
    if (child.exitCode === null) { const ended = new Promise(resolve => child.once('exit', resolve)); child.kill(); await ended; }
  }
}

authorities().then(() => transport()).catch(error => { console.error(error); process.exitCode = 1; });
