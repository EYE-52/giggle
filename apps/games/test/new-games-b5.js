'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Room } = require('../server/room');
const { validateManifest } = require('../games/_validate');
const { playBatch5 } = require('./new-games-b5-driver');
const IDS = ['dots-boxes', 'mega-tic-tac-toe', 'five-row', 'pig-dice', 'snakes-ladders'];
let checks = 0;
const eq = (a, b, note) => { assert.deepEqual(a, b, note); checks++; };
const ok = (a, note) => { assert(a, note); checks++; };

class Clock {
  constructor(n = 2, settings = {}) {
    this.roster = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: ['Asha', 'Bo', 'Cleo', 'Dev'][i] || `Guest ${i + 1}` }));
    this.time = 10000; this.options = settings; this.timers = []; this.awards = {};
  }
  settings() { return this.options; }
  players() { return this.roster; }
  allPlayers() { return this.roster; }
  content(id) { return JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/en', `${id}.json`))); }
  hostId() { return this.roster[0].id; }
  now() { return this.time; }
  broadcast() {}
  award(pid, n) { this.awards[pid] = (this.awards[pid] || 0) + n; }
  later(ms, fn) { this.timers.push({ at: this.time + ms, fn }); }
  fire() {
    this.timers.sort((a, b) => a.at - b.at);
    const timer = this.timers.shift();
    if (!timer) return false;
    this.time = Math.max(this.time, timer.at); timer.fn(); return true;
  }
}
const defs = Object.fromEntries(IDS.map(id => [id, require(`../games/${id}/server`)]));
const move = (g, s, c, a, pid = s.seats[s.turn]) => g.onAction(s, c, pid, { ...a, rev: s.rev });
function inert(g, s, c, pid, a) {
  const before = JSON.stringify([s, c.awards]);
  g.onAction(s, c, pid, a);
  eq(JSON.stringify([s, c.awards]), before, `${g.id}: ignored ${JSON.stringify(a)}`);
}
function dice(value, fn) {
  const original = crypto.randomInt;
  crypto.randomInt = (min, max) => { eq([min, max], [1, 7], 'server die uses exclusive crypto range'); return value; };
  try { fn(); } finally { crypto.randomInt = original; }
}

for (const g of Object.values(defs)) {
  eq(validateManifest(g), { ok: true }, 'valid manifest');
  eq(g.manifest.settings[0].key, 'pace');
  for (const n of [2, 4]) {
    const c = new Clock(n), s = g.create(c);
    eq(s.seats.length, Math.min(n, g.manifest.seats));
    eq(g.view(s, 'watcher').youAre, null); eq(g.view(s, 'watcher').legal, []);
    eq(g.view(s, s.seats[1]).legal, []);
    for (const pid of [s.seats[0], s.seats[1], 'watcher']) {
      const v = g.view(s, pid), json = JSON.stringify(v);
      ok(!/"window"|"randomInt"|"pack"/.test(json), 'projection has no server machinery');
      v.seats[0] = 'evil'; v.scores.p1 = 999; v.strings.help.push('evil');
      eq(s.seats[0], 'p1'); eq(s.scores.p1, 0); ok(!s.strings.help.includes('evil'), 'fully detached projection');
    }
    for (const a of [null, undefined, [], {}, 3, 'roll', { rev: '0' }, { rev: -1 }, { rev: NaN }, { rev: 0.5 },
      { rev: 0, cell: -1, edge: -1 }, { rev: 0, cell: 1000, edge: 1000 }, { rev: 0, cell: '0', edge: '0' },
      { rev: 0, roll: 'yes', hold: 1, swap: {} }, { rev: 0, cell: {}, edge: [] }]) inert(g, s, c, 'p1', a);
    inert(g, s, c, 'watcher', { rev: 0, resign: true });
    inert(g, s, c, 'p2', { rev: 0, edge: 0, cell: 0, roll: true });
    playBatch5(g, new Clock(n)); checks++;
    move(g, s, c, { resign: true }, 'p1');
    if (s.seats.length === 2) { eq(s.phase, 'done'); eq(s.scores.p2, 300); eq(s.scores.p1, 0); }
    else { eq(s.phase, 'play'); eq(s.out, ['p1']); ok(s.seats[s.turn] !== 'p1', 'skips forfeited seat'); }
    g.onEnd(s, c);
    const before = JSON.stringify([s, c.awards]);
    for (const t of c.timers) t.fn();
    g.onEnd(s, c); g.onPlayerGone(s, c, 'p2'); move(g, s, c, { roll: true, cell: 1, edge: 1 });
    eq(JSON.stringify([s, c.awards]), before, 'terminal callbacks cannot mutate or award twice');
  }
  {
    const c = new Clock(2), s = g.create(c);
    move(g, s, c, { offerDraw: true }, 'p1'); eq(s.drawOffer, 'p1');
    move(g, s, c, { acceptDraw: true }, 'p1'); eq(s.phase, 'play', 'cannot accept own offer');
    move(g, s, c, { declineDraw: true }, 'p2'); eq(s.drawBlocked, 'p1');
    inert(g, s, c, 'p1', { rev: s.rev, offerDraw: true });
    move(g, s, c, { offerDraw: true }, 'p2');
    move(g, s, c, { acceptDraw: true }, 'p1');
    eq(s.phase, 'done'); eq(s.scores, { p1: 150, p2: 150 }); eq(c.awards, s.scores);
  }
  {
    const c = new Clock(4), s = g.create(c);
    g.onEnd(s, c); eq(s.phase, 'done'); eq(s.endsAt, null); eq(c.awards, {});
    ok(Object.values(s.scores).every(n => n === 0), 'End game keeps earned points only');
  }
  {
    const c = new Clock(2), s = g.create(c);
    eq(g.onPlayerGone(s, c, 'watcher'), false);
    eq(g.onPlayerGone(s, c, 'p2'), true); eq(s.result.winnerPid, 'p1'); eq(s.scores, { p1: 300, p2: 0 });
  }
  // The production Room, not only the game helper, enforces seat caps and
  // rejects both pre-start extra watchers and late-joining spectators.
  {
    const room = new Room('B5QA', {});
    const peers = Array.from({ length: g.manifest.players.max }, (_, i) => {
      const ws = { readyState: 1, send() {}, close() {} };
      return { ws, player: room.addPlayer(`Guest ${i + 1}`, ws).player };
    });
    eq(room.startGame(g, {}, peers[0].player.id).ok, true);
    eq(room.game.state.seats.length, g.manifest.seats);
    const lateSocket = { readyState: 1, send() {}, close() {} };
    const late = room.addPlayer('Late watcher', lateSocket).player;
    const state = room.game.state, before = JSON.stringify(state);
    for (const watcher of [peers[g.manifest.seats], { ws: lateSocket, player: late }].filter(Boolean)) {
      room.onAction(watcher.ws, { rev: state.rev, resign: true, roll: true, cell: 0, edge: 0 }, { i: room.game.instanceId, w: room._actionToken() });
      eq(JSON.stringify(state), before, 'Room rejects watcher actions');
      eq(g.view(state, watcher.player.id).youAre, null);
    }
    const oldInstance = room.game.instanceId;
    eq(room.endGame(peers[0].player.id).ok, true); eq(state.phase, 'done');
    // Late watchers also enter the roster on rematch, within the room's
    // declared start limit; remove only the fixture late seat first.
    eq(room.leave(lateSocket).ok, true);
    eq(room.startGame(g, {}, peers[0].player.id).ok, true);
    ok(room.game.instanceId !== oldInstance, 'real rematch mints an instance');
    const fresh = JSON.stringify(room.game.state);
    room.onAction(peers[0].ws, { rev: 0, roll: true, cell: 0, edge: 0 }, { i: oldInstance, w: 'old-window' });
    eq(JSON.stringify(room.game.state), fresh, 'stale instance cannot enter a rematch');
    room.destroy();
  }
}

// Optional move timers lose the duel, and a captured old timer cannot touch
// the new turn. Off really has no timer. Multiplayer Dots drops timed-out seats.
for (const id of IDS.slice(0, 3)) {
  const g = defs[id], c = new Clock(2, { moveTimer: '30 seconds' }), s = g.create(c);
  eq(s.endsAt, 40000); const stale = c.timers[0];
  move(g, s, c, id === 'dots-boxes' ? { edge: 0 } : { cell: 0 });
  c.time = stale.at;
  const before = JSON.stringify(s); stale.fn(); eq(JSON.stringify(s), before);
  for (let n = 0; n < 5 && s.phase === 'play'; n++) c.fire();
  eq(s.phase, 'done'); eq(s.result.reason, 'timeout'); eq(s.scores.p1, 300);
  const off = new Clock(2); g.create(off); eq(off.timers.length, 0);
  const delayed = new Clock(2, { moveTimer: '60 seconds' }), d = g.create(delayed);
  delayed.time = d.endsAt;
  move(g, d, delayed, id === 'dots-boxes' ? { edge: 0 } : { cell: 0 });
  eq(d.result.reason, 'timeout'); eq(d.result.winnerPid, 'p2', 'deadline wins over a delayed action');
}
{
  const g = defs['dots-boxes'], c = new Clock(4, { moveTimer: '30 seconds' }), s = g.create(c);
  for (let n = 0; n < 8 && s.phase === 'play'; n++) c.fire();
  eq(s.phase, 'done'); eq(s.out, ['p1', 'p2', 'p3']); eq(s.scores.p4, 300);
  for (const size of ['4×4', '5×5', '6×6']) {
    const c2 = new Clock(4, { boardSize: size }), s2 = g.create(c2);
    playBatch5(g, c2); eq(s2.boxes.length, Number(size[0]) ** 2);
  }
  const two = new Clock(2), b = g.create(two);
  // Two boxes share the vertical edge 21. Closing it claims both.
  for (const edge of [0, 1, 4, 5, 20, 22]) b.edges[edge] = 2;
  move(g, b, two, { edge: 21 });
  eq(b.lastMove.claimed, [0, 1]); eq(b.counts.p1, 2); eq(b.turn, 0, 'capture gives another move');
  inert(g, b, two, 'p1', { rev: b.rev, edge: 21 });
  // Equal score ties share the same rank, rather than awarding by seat.
  const tie = g.create(two); tie.edges.fill(1); tie.edges[0] = 0; tie.boxes.fill(1); tie.boxes[0] = 0;
  tie.counts = { p1: 7, p2: 8 }; move(g, tie, two, { edge: 0 });
  eq(tie.scores, { p1: 150, p2: 150 });
  const multi = g.create(c); multi.edges.fill(1); multi.edges[0] = 0; multi.boxes.fill(1); multi.boxes[0] = 0;
  multi.counts = { p1: 5, p2: 6, p3: 3, p4: 1 }; move(g, multi, c, { edge: 0 });
  eq(multi.scores, { p1: 300, p2: 300, p3: 100, p4: 0 });
  eq(multi.result.ranks.map(e => e.rank), [1, 1, 3, 4]);
}
{
  const g = defs['mega-tic-tac-toe'], c = new Clock(), s = g.create(c);
  move(g, s, c, { cell: 4 }); eq(s.forced, 4);
  inert(g, s, c, 'p2', { rev: s.rev, cell: 0 });
  move(g, s, c, { cell: 36 }); eq(s.forced, 0);
  s.small[2] = 1; move(g, s, c, { cell: 2 }); eq(s.forced, -1, 'won destination frees all boards');
  const win = g.create(c); win.small[0] = 1; win.small[1] = 1; win.board[18] = 1; win.board[19] = 1;
  move(g, win, c, { cell: 20 }); eq(win.small[2], 1); eq(win.result.winnerPid, 'p1');
  const tie = g.create(c); tie.small.fill(3); tie.small[8] = 0;
  tie.board.splice(72, 9, ...[1, 2, 1, 1, 2, 2, 2, 1, 0]);
  move(g, tie, c, { cell: 80 }); eq(tie.result.reason, 'draw'); eq(tie.scores, { p1: 150, p2: 150 });
}
{
  const g = defs['five-row'], c = new Clock(), s = g.create(c);
  move(g, s, c, { cell: 112 }); eq(s.swapAvailable, true);
  move(g, s, c, { swap: true }); eq(s.colours, [2, 1]); eq(s.turn, 0); eq(s.board[112], 1);
  inert(g, s, c, 'p1', { rev: s.rev, swap: true });
  const disabled = g.create(new Clock(2, { swapRule: false }));
  move(g, disabled, c, { cell: 0 }); eq(disabled.swapAvailable, false);
  for (const line of [[30, 31, 32, 33, 34], [2, 17, 32, 47, 62], [0, 16, 32, 48, 64], [8, 22, 36, 50, 64]]) {
    const b = g.create(c); for (const cell of line.slice(0, -1)) b.board[cell] = 1;
    move(g, b, c, { cell: line.at(-1) }); eq(b.phase, 'done'); eq(b.winning.length, 5);
  }
  const over = g.create(c); for (const cell of [0, 1, 2, 4, 5]) over.board[cell] = 1;
  move(g, over, c, { cell: 3 }); eq(over.phase, 'play'); eq(over.winning, [], 'six is not five');
  const tied = g.create(c); tied.board = Array.from({ length: 225 }, (_, i) => (Math.floor(i / 15) + i % 15) % 2 + 1);
  tied.board[224] = 0; tied.moves = 224;
  move(g, tied, c, { cell: 224 }); eq(tied.result.reason, 'draw');
}
{
  const g = defs['pig-dice'], c = new Clock(4, { target: '50', pace: 'Quick' }), s = g.create(c);
  eq(s.moveTimerMs, 20000); const deadline = s.endsAt;
  dice(6, () => { move(g, s, c, { roll: true }); move(g, s, c, { roll: true }); });
  eq(s.turnTotal, 12); eq(s.endsAt, deadline, 'rolling does not extend turn');
  c.fire(); eq(s.banked.p1, 12); eq(s.turn, 1); eq(s.turnTotal, 0);
  dice(1, () => move(g, s, c, { roll: true })); eq(s.turn, 2); eq(s.banked.p2, 0);
  const finish = g.create(c); finish.banked = { p1: 45, p2: 40, p3: 50, p4: 2 };
  finish.turnTotal = 6; move(g, finish, c, { hold: true }); eq(finish.phase, 'play'); eq(finish.finalRound, 1);
  finish.turnTotal = 11; move(g, finish, c, { hold: true });
  move(g, finish, c, { hold: true }); move(g, finish, c, { hold: true });
  eq(finish.phase, 'done'); eq(finish.turns, { p1: 1, p2: 1, p3: 1, p4: 1 });
  eq(finish.scores, { p1: 300, p2: 300, p3: 100, p4: 0 });
  const idleC = new Clock(4), idle = g.create(idleC); for (let n = 0; n < 8; n++) idleC.fire();
  ok(idle.turnNo > 0, 'idle turns continue automatically');
  const leave = g.create(c); g.onPlayerGone(leave, c, 'p1'); eq(leave.turn, 1); eq(leave.out, ['p1']);
  const waitingC = new Clock(4), waitingLeave = g.create(waitingC);
  const deadlineBefore = waitingLeave.endsAt;
  waitingC.time += 5000;
  g.onPlayerGone(waitingLeave, waitingC, 'p2');
  eq(waitingLeave.endsAt, deadlineBefore, 'another seat leaving cannot extend your turn');
  waitingC.fire(); eq(waitingLeave.turn, 2, 'the original deadline still skips the gone seat');
}
{
  const g = defs['snakes-ladders'], c = new Clock(4), s = g.create(c);
  eq(Object.keys(s.snakes || g.view(s, 'p1').snakes).length, 8);
  const v = g.view(s, 'p1'); eq(Object.keys(v.ladders).length, 8);
  eq(new Set([...Object.entries(v.snakes), ...Object.entries(v.ladders)].flat().map(Number)).size, 32, 'unique original endpoints');
  dice(3, () => move(g, s, c, { roll: true })); eq(s.positions.p1, 26);
  s.positions.p2 = 20; dice(3, () => move(g, s, c, { roll: true })); eq(s.positions.p2, 6);
  const exact = g.create(new Clock(2, { exactFinish: true })); exact.positions.p1 = 98;
  dice(5, () => move(g, exact, c, { roll: true })); eq(exact.positions.p1, 97, 'overshoot bounces back');
  const finish = g.create(c); finish.positions = { p1: 98, p2: 98, p3: 98, p4: 98 };
  dice(6, () => { move(g, finish, c, { roll: true }); move(g, finish, c, { roll: true }); move(g, finish, c, { roll: true }); });
  eq(finish.phase, 'done'); eq(finish.finished, ['p1', 'p2', 'p3', 'p4']);
  eq(finish.scores, { p1: 300, p2: 200, p3: 100, p4: 0 });
  const idleC = new Clock(6, { pace: 'Relaxed' }), idle = g.create(idleC);
  eq(idle.moveTimerMs, 23000);
  dice(6, () => { for (let n = 0; n < 150 && idle.phase !== 'done'; n++) idleC.fire(); });
  eq(idle.phase, 'done', 'auto-rolls complete a silent match');
  const left = g.create(c); g.onPlayerGone(left, c, 'p1'); eq(left.turn, 1); eq(left.out, ['p1']);
}

require('./new-games-b5-view');
console.log(`NEW_GAMES_B5_PASS: ${checks} rule, scoring, timer, projection, leave and lifecycle checks`);
module.exports = { Clock };
