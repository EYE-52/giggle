'use strict';
// Real Room and game definitions, with a deterministic server clock. Network
// negotiation is exercised separately against the actual WebSocket server.
const assert = require('node:assert/strict');
const { Room } = require(process.env.ROOM_SOURCE || '../server/room');
const registry = require('../games/registry');
const { spawn } = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const flush = () => new Promise(resolve => setImmediate(resolve));
const socket = () => ({ readyState: 1, sent: [], send(json) { this.sent.push(JSON.parse(json)); } });
const stateOf = ws => ws.sent.findLast(m => m.t === 'state');
const stamp = room => ({ i: room.game.instanceId, w: room._actionToken() });

async function rooms() {
  await registry.get('pocket-karts').initialize();
  const original = { now: Date.now, setTimeout, clearTimeout };
  let now = 1700000000000, seq = 0;
  const timers = new Map();
  Date.now = () => now;
  global.setTimeout = (fn, ms) => { const id = ++seq; timers.set(id, { fn, due: now + ms }); return id; };
  global.clearTimeout = id => timers.delete(id);
  const advance = async ms => {
    await flush();
    const until = now + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, t]) => t.due <= until).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      now = next[1].due; timers.delete(next[0]); next[1].fn(); await flush();
    }
    now = until; await flush();
  };
  const all = [];
  function make(n = 2) {
    const room = new Room('TEST', {}); all.push(room);
    const socks = Array.from({ length: n }, socket);
    const ps = socks.map((ws, i) => room.addPlayer('Player ' + i, ws).player);
    return { room, socks, ps };
  }
  const readyAll = room => {
    const meta = stamp(room);
    for (const p of room.activeRosterPlayers().filter(p => p.connected)) room.onReady(p.socket, meta);
  };
  try {
    // Five seconds must survive a much slower preparation, including phases
    // after the first prompt. Neither actions nor tick callbacks can run early.
    const { room, socks, ps } = make(3);
    assert.equal(room.startGame(registry.get('five-second'), { ready: true, settings: { rounds: 1 } }, ps[0].id).ok, true);
    await flush();
    const first = stateOf(socks[0]), deadline = first.endsAt;
    assert.equal(first.preparing, true, 'the actual prompt is prepared before its five seconds begin');
    assert.equal(first.endsAt - first.gameNow, 5000);
    const old = stamp(room);
    const performer = room.players.find(p => p.id === room.game.state.performer);
    room.onAction(performer.socket, { answers: 'one,two,three' }, old);
    assert.equal(room.game.state.answers, null, 'prepared controls cannot submit early');
    room.onReady(socks[0], old);
    const watcher = socket(); room.addPlayer('Watcher', watcher);
    room.onReady(watcher, old); room.onReady(socks[1], { ...old, w: 'old-window' });
    await advance(6000); room.broadcastState();
    assert.equal(room.game.state.phase, 'answer', 'slow critical assets cannot exhaust a five-second prompt');
    assert.equal(stateOf(socks[1]).gameNow, first.gameNow);
    assert.equal(stateOf(socks[1]).serverNow, now, 'global calibration time keeps running');
    readyAll(room);
    assert.equal(stateOf(socks[0]).preparing, false);
    assert.equal(stateOf(socks[0]).clockOffset, 6000);
    assert.equal(stateOf(socks[0]).endsAt, deadline, 'the one phase deadline is preserved');
    await advance(4999); assert.equal(room.game.state.phase, 'answer');
    await advance(1); assert.equal(room.game.state.phase, 'vote');
    assert.equal(stateOf(socks[0]).preparing, true, 'later phase content also gets a preparation gate');
    room.onReady(socks[0], old); assert.equal(room.game.preparing, true, 'old quorum ACK cannot unfreeze a new phase');
    const vote = stamp(room); readyAll(room);
    room.onAction(socks[0], { vote: 'pass' });
    assert.equal(Object.keys(room.game.state.votes).length, 0, 'prepared network instances require action tokens');
    for (const p of ps.filter(p => p.id !== performer.id)) room.onAction(p.socket, { vote: 'pass' }, vote);
    assert.equal(room.game.state.phase, 'reveal');
    const awards = { ...room.totals }; readyAll(room); await advance(5000);
    assert.equal(room.game.state.phase, 'done'); assert.deepEqual(room.totals, awards);
    room.onAction(socks[0], { vote: 'pass' }, vote); assert.deepEqual(room.totals, awards);
    const finished = stateOf(socks[0]); room.broadcastState();
    assert.equal(stateOf(socks[0]).phaseStartedAt, finished.phaseStartedAt, 'reconnect/repeated snapshots retain the phase clock');

    // Typed finish times share the held clock, even when preparation exceeds
    // the entire normal race duration. Rematch contexts cannot award afterward.
    const typed = make();
    typed.room.startGame(registry.get('typing-race'), { ready: true, settings: { rounds: 1, raceSeconds: 15 } }, typed.ps[0].id);
    const ctx = typed.room.ctx(); await flush(); await advance(9000); readyAll(typed.room); await advance(321);
    typed.room.onAction(typed.socks[0], { typed: typed.room.game.state.target }, stamp(typed.room));
    assert.equal(typed.room.game.state.finished[0].ms, 321, 'loading time never becomes a finish-time penalty');
    const earned = typed.room.totals[typed.ps[0].id];
    typed.room.endGameToLobby(typed.ps[0].id);
    typed.room.startGame(registry.get('typing-race'), {}, typed.ps[0].id);
    ctx.award(typed.ps[0].id, 999); ctx.later(1, () => { throw new Error('retired timer ran'); });
    assert.equal(typed.room.totals[typed.ps[0].id], earned, 'old contexts are inert even when generation numbers are reused');
    await flush(); await advance(1);

    const drop = make(3);
    drop.room.startGame(registry.get('typing-race'), { ready: true }, drop.ps[0].id); await flush();
    drop.room.onReady(drop.socks[0], stamp(drop.room)); drop.room.onReady(drop.socks[1], stamp(drop.room));
    drop.room.disconnect(drop.socks[2]);
    assert.equal(drop.room.game.preparing, false, 'a disconnected seat does not hold the quorum forever');
    const token = stamp(drop.room), endsAt = drop.room.game.state.endsAt;
    const rejoined = socket(); drop.room.addPlayer('Player 2', rejoined, drop.ps[2].token);
    drop.room.broadcastState(); drop.room.onReady(rejoined, token);
    assert.equal(drop.room.game.preparing, false); assert.equal(drop.room.game.state.endsAt, endsAt, 'resume never restarts the deadline');

    const tooFew = make(); tooFew.room.startGame(registry.get('typing-race'), { ready: true }, tooFew.ps[0].id);
    tooFew.room.disconnect(tooFew.socks[0]);
    assert.equal(tooFew.room.game, null, 'host departure below the minimum exits safely to the lobby');
    assert.equal(tooFew.room.hostId, tooFew.ps[1].id);
    const timeout = make(); timeout.room.startGame(registry.get('typing-race'), { ready: true }, timeout.ps[0].id); await flush();
    await advance(12000); assert.equal(timeout.room.game, null, 'missing resources have a finite recovery path');
    assert.match(timeout.socks[0].sent.findLast(m => m.t === 'error').msg, /load.*time/);
    const legacy = make(); legacy.room.startGame(registry.get('five-second'), {}, legacy.ps[0].id);
    assert.equal(legacy.room.game, null, 'game player-count validation remains enforced');
    legacy.room.startGame(registry.get('typing-race'), { settings: { rounds: 1, raceSeconds: 15 } }, legacy.ps[0].id);
    await flush(); legacy.room.onAction(legacy.socks[0], { typed: legacy.room.game.state.target });
    assert.equal(legacy.room.game.state.finished.length, 1, 'legacy Room/SDK harnesses retain their explicit ungated contract');

    const karts = make(); karts.room.startGame(registry.get('pocket-karts'), { ready: true }, karts.ps[0].id); await flush();
    const initialKart = stateOf(karts.socks[0]); await advance(4000); karts.room.onTick();
    assert.equal(karts.room.game.state.phase, 'countdown'); assert.equal(karts.room.game.state.lastTick, initialKart.simAt, 'held physics never advances early');
    readyAll(karts.room); await advance(3000);
    for (const ws of karts.socks) ws.bufferedAmount = 9000;
    karts.room.onTick();
    assert.equal(karts.room.game.state.phase, 'drive'); assert.equal(stateOf(karts.socks[0]).preparing, true, 'phase readiness cannot be discarded as a congested realtime tick');
    readyAll(karts.room); const driving = stamp(karts.room);
    for (const ws of karts.socks) ws.bufferedAmount = 0;
    await advance(100); karts.room.onTick();
    assert.equal(karts.room.game.preparing, false); assert.deepEqual(stamp(karts.room), driving, 'ordinary realtime snapshots never reopen preparation');
    const board = make(); board.room.startGame(registry.get('chess'), { ready: true, settings: { timeControl: '3 minutes' } }, board.ps[0].id); await flush();
    const startClocks = { ...board.room.game.state.clocks }; await advance(4000); board.room.onTick();
    assert.deepEqual(board.room.game.state.clocks, startClocks, 'loading time never drains either chess clock');
    readyAll(board.room); await advance(1200); board.room.onTick();
    const turn = stateOf(board.socks[0]).turn;
    assert.equal(startClocks[turn] - board.room.game.state.clocks[turn], 1200, 'clockStamp and ctx.now remain in one time domain');
    console.log('GAME_READINESS_ROOM_PASS: held clocks, later phases, quorum/stale input, exact finish time, resume, disposal, disconnect/timeout and legacy compatibility');
  } finally {
    for (const room of all) room.destroy();
    Date.now = original.now; global.setTimeout = original.setTimeout; global.clearTimeout = original.clearTimeout;
  }
}

async function network() {
  const root = path.join(__dirname, '..'), port = 18327;
  const child = spawn(process.execPath, ['server/server.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
  const sockets = [];
  const connect = () => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`); sockets.push(ws); ws.sent = [];
    ws.on('message', data => ws.sent.push(JSON.parse(data))); ws.on('open', () => resolve(ws)); ws.on('error', reject);
  });
  const send = (ws, msg) => ws.send(JSON.stringify(msg));
  const until = async predicate => {
    for (let i = 0; i < 150; i++) { if (predicate()) return; await sleep(20); }
    throw new Error('Network readiness wait timed out: ' + log);
  };
  try {
    await until(() => log.includes('PartyBox on'));
    const a = await connect(); send(a, { t: 'create', name: 'Ready A' }); await until(() => a.sent.some(m => m.t === 'hello'));
    const code = a.sent.find(m => m.t === 'hello').code;
    const b = await connect(); send(b, { t: 'join', name: 'Ready B', code }); await until(() => b.sent.some(m => m.t === 'hello'));
    send(a, { t: 'start', game: 'typing-race', ready: true, settings: { rounds: 1, raceSeconds: 15 } });
    await until(() => stateOf(a)?.preparing);
    const first = stateOf(a);
    send(a, { t: 'game-ready', i: first.instanceId, w: first.w }); await sleep(100);
    assert.equal(stateOf(a).preparing, true, 'the actual server waits for the second client');
    send(b, { t: 'game-ready', i: first.instanceId, w: first.w }); await until(() => stateOf(a)?.preparing === false);
    assert.equal(stateOf(a).endsAt, first.endsAt); assert(stateOf(a).clockOffset >= 100);
    send(a, { t: 'action', i: first.instanceId, w: first.w, a: { typed: first.target } });
    await until(() => stateOf(a).finished?.length === 1);
    assert.equal(stateOf(a).phase, 'race'); assert.equal(stateOf(b).w, stateOf(a).w);
    send(a, { t: 'lobby' }); await until(() => a.sent.findLast(m => m.t === 'room')?.room.game === null);
    console.log('GAME_READINESS_WS_PASS: real transport ready negotiation, delayed peer, authoritative shared deadline and tokened action');
  } finally {
    for (const ws of sockets) ws.terminate(); child.kill(); await new Promise(resolve => child.once('exit', resolve));
  }
}
rooms().then(() => process.env.READINESS_SKIP_NETWORK ? undefined : network()).catch(error => { console.error(error); process.exitCode = 1; });
