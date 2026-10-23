'use strict';
// Real Room + registered playability drivers. Controlled Date.now, timeout
// queue, microtasks, seeded choices/dice and socket doubles; no browser/WS.
// Driver source is loaded unchanged except its context implementation and
// deterministic fixture seat IDs. Authority actions always use Room.onAction.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const crypto = require('node:crypto');
const { Room, SEAT_REMOVED_CODE } = require('../server/room');
const registry = require('../games/registry');
const { manifestPlayers } = require('../games/_validate');
const root = path.resolve(__dirname, '..');
const output = process.argv[2];
const original = { now: Date.now, setTimeout, clearTimeout, queueMicrotask, random: Math.random };
let now = 1700000000000, owner = null, seq = 0, mode = '', currentRow;
const timers = new Map(), queued = [], contexts = [];
const socket = () => ({ readyState: 1, messages: [], send(s) { this.messages.push(JSON.parse(s)); },
  close(code, reason) { this.closed = { code, reason }; this.readyState = 3; } });
const flat = s => JSON.stringify(s, (k, v) => k === 'clockStamp' ? 0 : typeof v === 'function' ? '[fn]' : typeof v === 'bigint' ? '[bi]' : v);
const stamp = room => ({ i: room.game.instanceId, w: room._actionToken() });
function check(condition, message) { assert(condition, message); currentRow.checks++; }
function equal(a, b, message) { assert.deepEqual(a, b, message); currentRow.checks++; }
class Stopped extends Error {}
function flush() { while (queued.length) { const t = queued.shift(); const previous = owner; owner = t.owner; t.fn(); owner = previous; } }
function run(ctx, fn) { const previous = owner; owner = ctx; now = ctx._now; try { return fn(); } finally { flush(); owner = previous; } }
function ready(room) {
  if (!room.game?.preparing) return;
  const previous = owner; owner = contexts.find(ctx => ctx.room === room); now = owner._now;
  const meta = stamp(room);
  for (const p of room.activeRosterPlayers().filter(p => p.connected)) room.onReady(p.socket, meta);
  flush(); owner = previous;
}
class RealRoomCtx {
  constructor(players, settings = {}) {
    this._now = 1700000000000; this.settingsInput = settings; this.history = []; this.actions = 0; this.acceptedActions = 0; this.fired = 0;
    this.room = new Room('SWEEP', {}); contexts.push(this);
    // Deterministic IDs are confined to fixture seats; real random resume
    // tokens and every removal/authentication method remain production code.
    for (const fixture of players) {
      const p = this.room.addPlayer(fixture.name, socket()).player;
      delete this.room.totals[p.id]; p.id = fixture.id; this.room.totals[p.id] = 0;
    }
    this.room.hostId = this.room.players[0].id;
    this.content = () => ({});
  }
  get awards() { return this.room.totals; }
  players() { return this.room.connectedPlayers(); }
  hostId() { return this.room.hostId; }
  totalAwarded() { return Object.values(this.awards).reduce((a, b) => a + b, 0); }
  advance(ms) { this._now += ms; now = this._now; }
  setNow(t) { if (t > this._now) this.advance(t - this._now); }
  pending() { return [...timers.values()].filter(t => t.owner === this).length; }
  fireNext() {
    const next = [...timers].filter(([, t]) => t.owner === this).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
    if (!next) return false;
    this.setNow(next[1].due); timers.delete(next[0]);
    run(this, next[1].fn); this.fired++; ready(this.room); this.inspect('timer'); return true;
  }
  fireUntil(cond, cap = 200) { let n = 0; while (!cond() && n < cap && this.fireNext()) n++; return n; }
  start(def) {
    this.def = def; this.room.content = { [def.id]: this.content(def.id) };
    const result = run(this, () => this.room.startGame(def, { settings: this.settingsInput, ready: true }, this.hostId()));
    check(result.ok, def.id + ': Room start accepted');
    ready(this.room); this.inspect('start'); return this.room.game.state;
  }
  action(pid, action) {
    const before = flat(this.room.game.state);
    run(this, () => this.room.onAction(this.room.players.find(p => p.id === pid)?.socket || {}, action, stamp(this.room)));
    this.actions++; ready(this.room);
    const changed = before !== flat(this.room.game.state);
    if (changed) this.acceptedActions++;
    this.inspect('action', changed);
  }
  tick() { run(this, () => this.room.onTick()); ready(this.room); this.inspect('tick'); }
  inspect(trigger, changed = false) {
    if (mode === 'live' && trigger === 'action' && changed && this.room.game.state.phase !== 'done') {
      lifecycle(this, 'live'); throw new Stopped();
    }
    if (mode === 'done' && this.room.game.state.phase === 'done') {
      check(this.acceptedActions > 0, this.def.id + ': accepted legal actions precede the final');
      currentRow.completion = { actions: this.actions, acceptedActions: this.acceptedActions, deadlines: this.fired, phase: this.room.game.state.phase };
      lifecycle(this, 'done'); throw new Stopped();
    }
  }
}
function assertRevoked(room, victim, ws, token, meta) {
  equal(ws.closed?.code, SEAT_REMOVED_CODE, 'removed socket closes terminally');
  check(!room.bySocket(ws), 'removed socket owns no seat');
  check(room.preflightAdd(token).error && room.addPlayer('Retry', socket(), token).error, 'removed token cannot resume');
  const before = room.game && flat(room.game.state), totals = flat(room.totals);
  room.onAction(ws, { next: true, resign: true, roll: true, vote: 'a', input: { throttle: 1, boost: true } }, meta);
  room.onReady(ws, meta); room.disconnect(ws);
  equal(room.game && flat(room.game.state), before, 'removed socket action/ready/late close does not mutate current match');
  equal(flat(room.totals), totals, 'removed socket cannot score');
}
function retireAndRestart(ctx, oldGame, oldContext, snapshots) {
  const room = ctx.room, host = room.players[0];
  equal(room.endGameToLobby(host.id).ok, true, 'host returns surviving room to lobby');
  const totals = flat(room.totals), oldState = flat(oldGame.state);
  equal(room.game, null, 'lobby clears game'); equal(room.timers.size, 0, 'lobby cancels all game timers');
  const invalidSocket = socket();
  const beforeLobby = flat(room.lobby);
  equal(room.startGame(registry.get('chess'), {}, 'unowned').error, 'Only the host can start games.', 'unowned player cannot start');
  equal(flat(room.lobby), beforeLobby, 'rejected start retains lobby');
  for (const t of snapshots) run(ctx, t.fn);
  oldContext.award(host.id, 999); oldContext.later(1, () => { throw Error('retired context timer ran'); }); oldContext.broadcast();
  equal(flat(room.totals), totals, 'retired timers/context cannot duplicate awards');
  equal(flat(oldGame.state), oldState, 'retired timer callbacks cannot mutate old state');
  equal(room.timers.size, 0, 'retired context cannot schedule work');
  while (room.connectedPlayers().length < 2) room.addPlayer('New survivor', socket());
  equal(run(ctx, () => room.startGame(registry.get('chess'), { ready: true }, host.id)).ok, true, 'fresh lobby selects another shipping game');
  check(room.game.instanceId !== oldGame.instanceId, 'restart mints a new instance'); ready(room);
  equal(room.game.preparing, false, 'fresh match releases real readiness quorum');
  const newBefore = flat(room.game.state);
  room.onAction(host.socket, { move: { from: 'e2', to: 'e4' } }, { i: oldGame.instanceId, w: 'retired' });
  for (const t of snapshots) run(ctx, t.fn);
  equal(flat(room.game.state), newBefore, 'old actions/timers cannot touch another selected game');
  room.onAction(host.socket, { move: { from: 'e2', to: 'e4' } }, stamp(room)); ready(room);
  check(room.game.state.lastMove, 'survivors legally continue selected chess match');
  check(!room.bySocket(invalidSocket), 'unattached socket remains unowned');
}
function lifecycle(ctx, phase) {
  const room = ctx.room, game = room.game, host = room.players[0], oldContext = room.ctx(), meta = stamp(room);
  const victim = room.activeRosterPlayers().find(p => p.id !== host.id);
  check(victim, 'there is an active removable seat');
  if (phase === 'done') {
    const result = flat(game.state), awards = flat(room.totals);
    run(ctx, () => {
      room.onAction(host.socket, { next: true, resign: true, roll: true, vote: 'a' }, meta);
      room.onTick();
      for (const t of ctx.history.slice()) t.fn();
    });
    equal(flat(game.state), result, 'settled final rejects repeated input/ticks/phase callbacks');
    equal(flat(room.totals), awards, 'settled final awards remain exactly once');
  }
  const ws = victim.socket, token = victim.token;
  const before = flat(game.state);
  equal(room.kickPlayer(ws, host.id, { i: game.instanceId }).error, 'Only the host can remove players.', 'only host removes seats');
  equal(room.endGameToLobby(victim.id).error, 'Only the host can change games.', 'only host ends game');
  equal(flat(game.state), before, 'rejected management leaves live/final game unchanged');
  const watcher = room.addPlayer('Late watcher', socket()).player, watchSocket = watcher.socket, watchToken = watcher.token;
  const totals = flat(room.totals);
  check(room.isSpectator(watcher.id), 'late joiner is a watcher');
  equal(room.kickPlayer(host.socket, watcher.id, { i: 'retired' }).error, 'The match changed. Choose the player again.', 'stale management instance rejected');
  equal(room.kickPlayer(host.socket, watcher.id, { i: game.instanceId }).ended, false, 'watcher removal retains live/final instance');
  equal(room.game, game, 'watcher removal preserves game identity');
  equal(flat(game.state), before, 'watcher removal preserves game state'); equal(flat(room.totals), totals, 'watcher removal preserves awards');
  assertRevoked(room, watcher, watchSocket, watchToken, meta);
  const snapshots = ctx.history.slice();
  const result = room.kickPlayer(host.socket, victim.id, { i: game.instanceId });
  check(result.ok, 'host active removal accepted in ' + phase);
  const continues = ctx.def.id === 'pocket-karts' && room.connectedPlayers().length >= 2;
  equal(result.ended, !continues, 'active removal follows declared safe-roster policy');
  if (continues) {
    equal(room.game, game, 'two remaining kart drivers retain instance'); ready(room);
    if (phase === 'live') {
      const driver = room.activeRosterPlayers()[0];
      const ack = game.def.view(game.state, driver.id).inputAck;
      run(ctx, () => room.onAction(driver.socket, { seq: ack.receivedSeq + 1, life: ack.life, controlEpoch: ack.controlEpoch, input: { steer: 0, throttle: 1, boost: false } }, stamp(room)));
      ctx.advance(100); run(ctx, () => room.onTick());
      check(game.state.karts.some(k => k.pid === driver.id && k.speed > 0), 'surviving kart driver continues actual authority input');
    }
    if (phase === 'live') {
      ctx.setNow(Math.max(game.state.endsAt, ctx._now) + 3100);
      run(ctx, () => room.onTick()); ready(room);
      if (game.state.phase !== 'done') { ctx.setNow(game.state.endsAt); run(ctx, () => room.onTick()); }
      equal(game.state.phase, 'done', 'surviving kart drivers reach actual timed final');
    }
    const settled = flat(room.totals); run(ctx, () => room.onTick()); equal(flat(room.totals), settled, 'kart terminal tick cannot duplicate awards');
  } else equal(room.game, null, 'surviving stable-order game returns to lobby');
  assertRevoked(room, victim, ws, token, meta);
  retireAndRestart(ctx, game, oldContext, snapshots);
}
function cappedWatcherSweep(def) {
  const seats = def.manifest?.seats, { max } = manifestPlayers(def);
  if (!Number.isInteger(seats) || seats >= max) return;
  const room = new Room('CAP', {}), peers = Array.from({ length: seats + 1 }, (_, i) => room.addPlayer('Capped ' + i, socket()).player);
  const ctx = { room, _now: now, history: [] }; contexts.push(ctx);
  check(run(ctx, () => room.startGame(def, { ready: true }, peers[0].id)).ok, 'capped roster starts');
  const game = room.game, watcher = peers[seats], ws = watcher.socket, token = watcher.token, meta = stamp(room);
  check(game.roster.includes(watcher.id) && room.isSpectator(watcher.id), 'earlier roster member beyond seat cap watches');
  const active = room.activeRosterIds();
  equal(room.kickPlayer(peers[0].socket, watcher.id, { i: game.instanceId }).ended, false, 'capped watcher removal retains preparation');
  equal(room.game, game, 'capped watcher removal preserves instance');
  equal(room.activeRosterIds(), active, 'capped watcher removal does not rewrite stable active order');
  assertRevoked(room, watcher, ws, token, meta); ready(room);
  equal(game.preparing, false, 'active seats release preparation after capped watcher removal');
  room.destroy();
}
function minimumSweep(def) {
  const { min } = manifestPlayers(def);
  for (const preparation of [true, false]) {
    const room = new Room('MIN', {}), peers = Array.from({ length: min }, (_, i) => room.addPlayer('Minimum ' + i, socket()).player);
    const ctx = { room, _now: now, history: [] }; contexts.push(ctx);
    check(run(ctx, () => room.startGame(def, { ready: true }, peers[0].id)).ok, 'minimum roster starts');
    if (!preparation) ready(room);
    equal(room.game.preparing, preparation, 'minimum removal uses declared readiness state');
    const game = room.game, oldContext = room.ctx(), victim = peers[1], ws = victim.socket, token = victim.token;
    equal(room.kickPlayer(peers[0].socket, victim.id, { i: game.instanceId }).ended, true, 'minimum active removal ends safely');
    equal(room.game, null, 'minimum roster returns to lobby'); equal(room.timers.size, 0, 'minimum removal cancels timers');
    assertRevoked(room, victim, ws, token, { i: game.instanceId, w: 'old' });
    const totals = flat(room.totals); for (const t of ctx.history) run(ctx, t.fn); oldContext.award(peers[0].id, 1000);
    equal(flat(room.totals), totals, 'minimum removal stale work cannot award'); room.destroy();
  }
}
async function main() {
  await registry.get('pocket-karts').initialize();
  const driverFile = path.join(__dirname, 'game-playability.js');
  let source = fs.readFileSync(driverFile, 'utf8');
  for (const marker of ['/* ---------------- runner ---------------- */', 'class FakeCtx', 'const NAMES']) {
    assert(source.includes(marker), `registered driver adapter requires ${marker}`);
  }
  source = source.slice(0, source.indexOf('/* ---------------- runner ---------------- */'));
  source = source.slice(0, source.indexOf('class FakeCtx')) + 'const FakeCtx = RealRoomCtx;\n' + source.slice(source.indexOf('const NAMES'));
  source = source.replace(/\bp([1-8])\b/g, (_, n) => 'p' + Number(n).toString(16).padStart(8, '0'))
    .replace("'p' + (i + 1)", "'p' + (i + 1).toString(16).padStart(8, '0')");
  const proxyRegistry = { ...registry, get(id) {
    const def = registry.get(id);
    return new Proxy(def, { get(target, key) {
      if (key === 'create') return ctx => ctx.start(target);
      if (key === 'onAction') return (state, ctx, pid, action) => ctx.action(pid, action);
      if (key === 'onTick' && target.onTick) return (state, ctx) => ctx.tick();
      return target[key];
    } });
  } };
  const driverRequire = createRequire(driverFile);
  const sandbox = { RealRoomCtx, require: id => id === '../games/registry' ? proxyRegistry : driverRequire(id), Math, console };
  vm.createContext(sandbox); vm.runInContext(source + '\nglobalThis.harness = { drivers, seedRandom, hashSeed };', sandbox, { filename: driverFile });
  Date.now = () => now;
  global.queueMicrotask = fn => queued.push({ fn, owner });
  global.setTimeout = (fn, ms) => {
    const id = ++seq, task = { fn, due: now + ms, owner };
    timers.set(id, task); owner?.history.push(task); return id;
  };
  global.clearTimeout = id => timers.delete(id);
  const report = { scope: 'Production Room/definitions with socket doubles, controlled Date/timeouts/microtask queue, seeded registered legal drivers and seeded Ludo crypto dice. No native/browser/physical/WS/RTC/audio claim.', node: process.version, games: [], failures: [] };
  assert.equal(registry.count(), 42, 'shipping catalogue remains 42');
  for (const entry of registry.list()) {
    currentRow = { id: entry.id, checks: 0, scenarios: {} }; report.games.push(currentRow);
    for (const scenario of ['minimum', 'live', 'done']) {
      mode = scenario; sandbox.harness.seedRandom(sandbox.harness.hashSeed('play:' + entry.id));
      const start = contexts.length;
      try {
        if (scenario === 'minimum') { minimumSweep(registry.get(entry.id)); cappedWatcherSweep(registry.get(entry.id)); }
        else {
          check(sandbox.harness.drivers[entry.id], 'registered legal driver exists');
          let stopped = false;
          try { sandbox.harness.drivers[entry.id](); } catch (error) { if (error instanceof Stopped) stopped = true; else throw error; }
          check(stopped, scenario + ' observed through registered Room driver');
        }
        currentRow.scenarios[scenario] = 'pass';
      } catch (error) {
        currentRow.scenarios[scenario] = 'fail'; report.failures.push({ id: entry.id, scenario, error: error.stack });
      } finally {
        for (const ctx of contexts.slice(start)) run(ctx, () => ctx.room.destroy()); flush();
      }
    }
    console.log(entry.id + ': ' + JSON.stringify(currentRow.scenarios));
  }
  report.hashes = Object.fromEntries(['server/room.js', 'test/game-playability.js', 'test/catalogue-room-removal.js', ...registry.list().map(g => 'games/' + g.id + '/server.js')].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
  report.summary = { games: report.games.length, checks: report.games.reduce((n, g) => n + g.checks, 0), failedScenarios: report.failures.length, legalDone: report.games.filter(g => g.completion).length };
  if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log('CATALOGUE_ROOM_REMOVAL: ' + JSON.stringify(report.summary));
  if (report.failures.length) { console.error(report.failures.map(f => `${f.id}/${f.scenario}: ${f.error.split('\n')[0]}`).join('\n')); process.exitCode = 1; }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const ctx of contexts) ctx.room.destroy();
  Date.now = original.now; global.setTimeout = original.setTimeout; global.clearTimeout = original.clearTimeout;
  global.queueMicrotask = original.queueMicrotask; Math.random = original.random;
});
