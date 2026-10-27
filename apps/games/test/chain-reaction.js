'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const game = require('../games/chain-reaction/server');
const { geometry, resolveCascade, legalMoves, createChainReaction, MAX_TAPE_EVENTS } = require('../games/engines/chain-reaction');
const { Room } = require('../server/room');
const { actionWindow } = require('../games/_sdk');
const { validateManifest, validateSettings } = require('../games/_validate');

class Clock {
  constructor(n = 2, settings = {}) {
    this.roster = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'Player ' + i, connected: true }));
    this.values = settings; this.time = 1700000000000; this.timers = [];
    this.awards = {}; this.broadcasts = 0;
  }
  now() { return this.time; }
  allPlayers() { return this.roster.slice(); }
  players() { return this.roster.filter((p) => p.connected); }
  settings() { return this.values; }
  award(pid, points) { this.awards[pid] = (this.awards[pid] || 0) + points; }
  broadcast() { this.broadcasts++; }
  later(ms, fn) {
    const timer = { at: this.time + ms, fn, canceled: false }; this.timers.push(timer);
    return () => { timer.canceled = true; };
  }
  deadline() {
    const t = this.timers.find((t) => !t.canceled);
    assert(t, 'a live game must have a deadline');
    this.time = t.at; t.canceled = true; t.fn();
  }
}

const mass = (board) => board.reduce((n, c) => n + c.orbs, 0);
const move = (s, ctx, x, y, pid = s.turnPid) => game.onAction(s, ctx, pid, { x, y, turnNo: s.turnNo });
/* Independent tape replayer: applies placement plus the recorded firing order
 * step by step. Uses the engine's geometry (neighbor order, capacities) but
 * its own application loop, so a mis-recorded tape cannot hide. */
function replayLocal(before, grid, x, y, pid, tape) {
  const next = before.map((c) => ({ owner: c.owner, orbs: c.orbs }));
  const at = y * grid.cols + x;
  next[at].owner = pid; next[at].orbs += 1;
  for (const src of tape) {
    next[src].orbs -= grid.capacities[src];
    next[src].owner = next[src].orbs ? pid : null;
    for (const n of grid.neighbors[src]) { next[n].owner = pid; next[n].orbs += 1; }
  }
  return next;
}
function assertTapeReplays(s, before, x, y, pid, grid) {
  const c = s.lastCascade;
  assert(Array.isArray(c.tape) && c.tape.length <= MAX_TAPE_EVENTS);
  assert.equal(typeof c.truncated, 'boolean');
  assert.equal(c.seq, s.seq);
  assert.equal(s.lastEvent.seq, s.seq);
  if (c.truncated) return; // partial prefix: only the authoritative board counts
  assert.equal(c.tape.length, c.steps, 'every firing is recorded in order');
  assert.deepEqual(new Set(c.bursts), new Set(c.tape), 'burst set matches the firing order');
  assert.deepEqual(replayLocal(before, grid, x, y, pid, c.tape), s.board,
    'placement plus tape replays to the exact server board');
}
function stable(s) {
  const grid = geometry(s.cols, s.rows);
  for (let i = 0; i < s.board.length; i++) {
    const c = s.board[i];
    assert(Number.isSafeInteger(c.orbs) && c.orbs >= 0);
    assert.equal(c.owner === null, c.orbs === 0, 'empty cells have no owner');
    if (s.phase === 'play') assert(c.orbs < grid.capacities[i], 'every live snapshot is stable');
    if (c.owner) assert(s.order.includes(c.owner), 'only actual seats own orbs');
  }
}
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function playMatch(n, settings, seed) {
  const ctx = new Clock(n, settings), s = game.create(ctx), random = rng(seed);
  const maxMoves = geometry(s.cols, s.rows).maxStableOrbs + 1;
  let burstMoves = 0;
  for (let turns = 0; s.phase === 'play'; turns++) {
    assert(turns < maxMoves, 'a conservative grid must finish by its stable mass limit');
    const pid = s.turnPid, options = legalMoves(s, pid);
    assert(options.length, 'the current player always has a legal move');
    const choice = options[Math.floor(random() * options.length)];
    const before = mass(s.board), turnNo = s.turnNo, seq = s.seq;
    const beforeBoard = s.board.map((c) => ({ owner: c.owner, orbs: c.orbs }));
    move(s, ctx, choice.x, choice.y);
    assert.equal(mass(s.board), before + 1, 'every real legal move conserves old orbs plus one');
    assert.equal(s.seq, seq + 1, 'every accepted move bumps the monotonic event seq');
    assertTapeReplays(s, beforeBoard, choice.x, choice.y, pid, geometry(s.cols, s.rows));
    assert(s.entered[pid], 'the accepted player gets an entry');
    assert(s.turnNo > turnNo || s.phase === 'done');
    burstMoves += s.lastCascade.steps > 0 ? 1 : 0;
    stable(s);
    if (s.phase === 'play') assert(!s.eliminated.includes(s.turnPid));
  }
  assert(s.result.winner, 'a match of placed orbs must have a winner');
  assert(s.order.every((id) => s.entered[id]), 'all seats entered before a win');
  assert(burstMoves > 0, 'actual match includes cascades');
  assert.equal(ctx.awards[s.result.winner], 300);
  assert.deepEqual(Object.keys(ctx.awards), [s.result.winner]);
  assert.equal(s.scores[s.result.winner], 300, 'the match scoreboard names the winner');
  assert(s.order.every((id) => id === s.result.winner || s.scores[id] === 0));
  assert.equal(new Set(s.board.filter((c) => c.orbs).map((c) => c.owner)).size, 1);
  assert.equal(s.endsAt, 0, 'terminal timers stop');
  assert.equal(ctx.timers.filter((t) => !t.canceled).length, 0);
  const done = JSON.stringify(game.view(s, 'p0'));
  move(s, ctx, 0, 0, 'p0');
  assert.equal(JSON.stringify(game.view(s, 'p0')), done, 'finished matches ignore further moves');
  console.log(`CHAIN legal match: ${n} seats, ${s.boardSize}, ${s.moves} moves, ${burstMoves} cascade moves, winner ${s.result.winner}`);
  return s;
}

function rulesTests() {
  assert(validateManifest(game).ok);
  assert(validateSettings(game, { boardSize: 'Standard', moveTimer: '30 seconds', palette: 'Ink' }).ok);
  assert(!validateSettings(game, { moveTimer: '15 seconds' }).ok);
  assert(!validateSettings(game, { turnSeconds: 15 }).ok, 'the old seconds setting is gone');
  assert(!validateSettings(game, { boardSize: 'Gigantic' }).ok);
  const g = geometry(5, 6);
  assert.deepEqual([g.capacities[0], g.capacities[1], g.capacities[6]], [2, 3, 4]);
  assert.throws(() => geometry(100, 6), RangeError);
  const compact = game.create(new Clock(2));
  assert.deepEqual([compact.cols, compact.rows, compact.turnSeconds, compact.endsAt], [5, 6, 0, 0], 'move timer off by default');
  game.dispose(compact);
  const custom = game.create(new Clock(2, { boardSize: 'Standard', moveTimer: '60 seconds', palette: 'Ink' }));
  assert.deepEqual([custom.cols, custom.rows, custom.turnSeconds, custom.paletteName], [6, 8, 60, 'Ink']);
  game.dispose(custom);
  const fallback = game.create(new Clock(2, { boardSize: {}, moveTimer: 999, palette: null }));
  assert.deepEqual([fallback.cols, fallback.rows, fallback.turnSeconds, fallback.paletteName], [5, 6, 0, 'Candy']);
  game.dispose(fallback);
  // A second concrete configuration exercises the reusable factory.
  const variant = createChainReaction({ ...game.CHAIN_CONFIG,
    boards: { Tiny: { cols: 4, rows: 4 } }, defaultBoard: 'Tiny', winPoints: 7 });
  const vctx = new Clock(2), vs = variant.create(vctx);
  assert.equal(vs.board.length, 16); variant.dispose(vs);

  let ctx = new Clock(3), s = game.create(ctx);
  move(s, ctx, 0, 0); move(s, ctx, 1, 0);
  assert.equal(s.entered.p2, false);
  assert.deepEqual(s.eliminated, [], 'an unentered player cannot be eliminated');
  move(s, ctx, 4, 5); move(s, ctx, 0, 0); // p0 captures p1's only orb
  assert.equal(s.board[1].owner, 'p0');
  assert(s.eliminated.includes('p1'), 'captured zero-orb owner is eliminated after entry');
  assert.equal(s.turnPid, 'p2', 'eliminated seats are skipped');
  assert.equal(s.lastCascade.steps, 1);
  stable(s); game.dispose(s);

  // First-entry capture without an early elimination. One corner's burst
  // erases an entered seat, while another seat has yet to get an opportunity.
  ctx = new Clock(3); s = game.create(ctx);
  s.board[0] = { owner: 'p0', orbs: 1 };
  s.board[1] = { owner: 'p1', orbs: 1 };
  s.entered.p0 = true; s.entered.p1 = true;
  move(s, ctx, 0, 0);
  assert.equal(s.phase, 'play'); assert.deepEqual(s.eliminated, []);
  assert.equal(s.board[1].owner, 'p0');
  game.dispose(s);

  // Saturated stable board: every cell but the far corner belongs to p0.
  // There is no possible stable state after this legal move. The cascade
  // captures the final owner and ends DURING firing, with exact conservation.
  for (const size of ['Compact', 'Standard']) {
    ctx = new Clock(2, { boardSize: size }); s = game.create(ctx);
    const grid = geometry(s.cols, s.rows);
    s.board = grid.capacities.map((cap, i) => ({ owner: i === grid.capacities.length - 1 ? 'p1' : 'p0', orbs: cap - 1 }));
    s.entered.p0 = s.entered.p1 = true;
    const before = mass(s.board), started = performance.now();
    const denseBefore = s.board.map((c) => ({ owner: c.owner, orbs: c.orbs }));
    move(s, ctx, 0, 0);
    assert.equal(s.phase, 'done'); assert.equal(s.result.winner, 'p0');
    assert.equal(mass(s.board), before + 1);
    assert(s.lastCascade.steps > 1 && s.lastCascade.steps < 20000);
    assert.equal(s.lastCascade.truncated, false, 'dense legal cascades keep a complete tape');
    assertTapeReplays(s, denseBefore, 0, 0, 'p0', grid);
    assert(performance.now() - started < 2000, 'a dense cascade must promptly terminate');
    stable(s);
  }
  // Nonterminal chain resolution is pure and repeatable, with stable counts.
  const board = Array.from({ length: g.capacities.length }, () => ({ owner: null, orbs: 0 }));
  board[0] = { owner: 'p0', orbs: 1 }; board[1] = { owner: 'p1', orbs: 2 };
  board[29] = { owner: 'p1', orbs: 1 };
  const copy = JSON.stringify(board);
  const result = resolveCascade(board, g, 0, 'p0', true);
  assert(result.steps >= 2); assert.equal(result.winner, null);
  assert.equal(result.truncated, false); assert.equal(result.tape.length, result.steps);
  assert.deepEqual(replayLocal(board, g, 0, 0, 'p0', result.tape), result.board);
  assert.equal(mass(result.board), mass(board) + 1); assert.equal(JSON.stringify(board), copy);
  assert.deepEqual(resolveCascade(board, g, 0, 'p0', true), result);
  assert.throws(() => resolveCascade(board, g, 1, 'p0', true), RangeError);

  // Exact FIFO firing order with a repeat: corner (0,0) bursts, refills from
  // both edge neighbors, and bursts again. Tape keeps every firing in order;
  // bursts keeps the unique set.
  const repeat = Array.from({ length: g.capacities.length }, () => ({ owner: null, orbs: 0 }));
  repeat[0] = { owner: 'p0', orbs: 1 };
  repeat[1] = { owner: 'p0', orbs: 2 };
  repeat[5] = { owner: 'p0', orbs: 2 };
  const fired = resolveCascade(repeat, g, 0, 'p0', false);
  assert.deepEqual(fired.tape, [0, 1, 5, 0], 'exact FIFO order, repeat included');
  assert.deepEqual(fired.bursts, [0, 1, 5]);
  assert.equal(fired.steps, 4); assert.equal(fired.truncated, false);
  assert.equal(mass(fired.board), mass(repeat) + 1);
  assert.deepEqual(replayLocal(repeat, g, 0, 0, 'p0', fired.tape), fired.board);

  // One firing sends exactly one orb per orthogonal neighbor and captures on
  // arrival: enemy orbs flip, the spent corner empties, mass is conserved.
  const corner = Array.from({ length: g.capacities.length }, () => ({ owner: null, orbs: 0 }));
  corner[0] = { owner: 'p0', orbs: 1 };
  corner[1] = { owner: 'p1', orbs: 1 };
  corner[5] = { owner: 'p1', orbs: 1 };
  corner[29] = { owner: 'p1', orbs: 1 };
  const burst = resolveCascade(corner, g, 0, 'p0', true);
  assert.deepEqual(burst.tape, [0]);
  assert.deepEqual(burst.board[0], { owner: null, orbs: 0 });
  assert.deepEqual(burst.board[1], { owner: 'p0', orbs: 2 });
  assert.deepEqual(burst.board[5], { owner: 'p0', orbs: 2 });
  assert.equal(burst.board[29].owner, 'p1');
  assert.equal(mass(burst.board), mass(corner) + 1);
  assert.equal(burst.winner, null);

  // Forced truncation bounds only the tape: resolution still completes and
  // conserves, but the partial prefix is explicitly marked unreplayable.
  const cut = resolveCascade(repeat, g, 0, 'p0', false, { tapeLimit: 2 });
  assert.equal(cut.truncated, true); assert.deepEqual(cut.tape, [0, 1]);
  assert.equal(cut.steps, 4);
  assert.deepEqual(cut.board, fired.board, 'truncation never changes the authoritative board');
  const fallbackTape = resolveCascade(repeat, g, 0, 'p0', false, { tapeLimit: -1 });
  assert.equal(fallbackTape.truncated, false, 'an invalid tape limit falls back to the full tape');
  assert.deepEqual(fallbackTape.tape, [0, 1, 5, 0]);
  console.log('CHAIN rules: geometry, configuration, entry gating, elimination, capture, dense and nonterminal cascades');
}

function guardsAndDeadlines() {
  const ctx = new Clock(2, { moveTimer: '30 seconds' }), s = game.create(ctx);
  const before = JSON.stringify(game.view(s, 'p0'));
  for (const a of [null, 42, [], {}, { x: 0, y: 0 }, { x: -1, y: 0, turnNo: 1 },
    { x: 5, y: 0, turnNo: 1 }, { x: 0, y: 6, turnNo: 1 }, { x: 0.5, y: 0, turnNo: 1 },
    { x: Infinity, y: 0, turnNo: 1 }, { x: '0', y: 0, turnNo: 1 }, { x: 0, y: 0, turnNo: 0 }]) {
    game.onAction(s, ctx, 'p0', a);
    assert.equal(JSON.stringify(game.view(s, 'p0')), before);
  }
  const oldTimer = ctx.timers[0], duplicate = { x: 0, y: 0, turnNo: 1 };
  game.onAction(s, ctx, 'p1', duplicate); game.onAction(s, ctx, 'watcher', duplicate);
  assert.equal(mass(s.board), 0); assert.equal(s.seq, 0, 'rejected actors bump no event seq');
  game.onAction(s, ctx, 'p0', duplicate);
  assert.equal(s.seq, 1);
  assert.deepEqual(s.lastEvent, { kind: 'move', pid: 'p0', x: 0, y: 0, turnNo: 1, seq: 1 });
  assert.equal(s.lastCascade.seq, 1);
  game.onAction(s, ctx, 'p0', duplicate);
  assert.equal(mass(s.board), 1, 'a duplicate cannot double place');
  assert.equal(s.seq, 1, 'a duplicate bumps no event seq');
  assert.equal(s.turnNo, 2);
  oldTimer.fn(); assert.equal(s.turnNo, 2, 'an old deadline cannot skip the new turn');
  move(s, ctx, 4, 5);
  const turn = s.turnNo;
  game.onAction(s, ctx, 'p0', duplicate);
  assert.equal(s.turnNo, turn, 'an old move cannot land after a full lap');
  move(s, ctx, 4, 5);
  assert.equal(s.turnNo, turn, 'opponent-owned cells reject placement');
  const projection = game.view(s, 'watcher');
  assert.equal(projection.mySeat, -1);
  assert(!('_cancel' in projection)); assert(!('inputs' in projection));
  assert(Array.isArray(projection.lastCascade.tape));
  assert.equal(projection.lastCascade.seq, projection.lastEvent.seq);
  projection.board[0].orbs = 500; projection.entered.p0 = false;
  projection.palette[0].color = 'bad'; projection.order.push('bad');
  projection.lastCascade.tape.push(999); projection.lastCascade.steps = 999;
  projection.lastCascade.bursts.push(999); projection.lastEvent.seq = 999;
  assert.equal(s.board[0].orbs, 1); assert(s.entered.p0);
  assert.notEqual(s.palette[0].color, 'bad'); assert.equal(s.order.length, 2);
  assert(!s.lastCascade.tape.includes(999), 'the replay tape is a deep projection copy');
  assert(!s.lastCascade.bursts.includes(999));
  assert.notEqual(s.lastCascade.steps, 999); assert.notEqual(s.lastEvent.seq, 999);
  game.dispose(s); assert.equal(ctx.timers.filter((t) => !t.canceled).length, 0);

  const away = new Clock(2, { moveTimer: '30 seconds' }), a = game.create(away);
  away.roster[0].connected = false;
  away.deadline(); assert.equal(a.turnPid, 'p1'); assert(a.entered.p0);
  assert.equal(a.lastEvent.kind, 'timeout'); assert.equal(a.lastEvent.seq, 1);
  assert.deepEqual(a.lastCascade.tape, []); assert.equal(a.lastCascade.truncated, false);
  assert.equal(a.lastCascade.seq, 1); assert.equal(away.broadcasts, 1);
  move(a, away, 4, 5);
  assert.equal(a.phase, 'done'); assert.equal(a.result.winner, 'p1');
  assert.equal(a.seq, 2, 'a move after a deadline keeps the seq monotonic');
  const idle = new Clock(2, { moveTimer: '30 seconds' }), idleState = game.create(idle);
  idle.deadline(); idle.deadline();
  assert.equal(idleState.phase, 'done'); assert.equal(idleState.result.winner, null);
  assert.equal(idleState.seq, 2, 'each deadline is its own dedupable event');
  const late = new Clock(2, { moveTimer: '30 seconds' }), l = game.create(late);
  late.time = l.endsAt; move(l, late, 0, 0);
  assert.equal(mass(l.board), 0); assert.equal(l.turnPid, 'p1');
  game.dispose(l);
  const disconnected = new Clock(2, { moveTimer: '30 seconds' }), d = game.create(disconnected);
  move(d, disconnected, 0, 0); move(d, disconnected, 4, 5);
  disconnected.roster[0].connected = disconnected.roster[1].connected = false;
  disconnected.deadline(); disconnected.deadline();
  assert.equal(d.phase, 'play'); assert.equal(d.turnPid, 'p0');
  disconnected.roster[0].connected = true; move(d, disconnected, 0, 0);
  assert.equal(d.moves, 3, 'a resumed player can continue after away deadlines');
  game.dispose(d);
  // Move timer Off: no deadline at all, a turn waits for its player.
  const untimed = new Clock(2), u = game.create(untimed);
  assert.equal(untimed.timers.length, 0, 'no timer is armed');
  untimed.time += 3600000; game.onTick(u, untimed);
  assert.equal(u.turnPid, 'p0'); assert.equal(u.seq, 0); move(u, untimed, 0, 0); assert.equal(u.moves, 1);
  game.dispose(u);
  // A player who is gone: a duel ends by forfeit; bigger tables play on.
  const duel = new Clock(2), du = game.create(duel);
  move(du, duel, 0, 0);
  assert.equal(game.onPlayerGone(du, duel, 'watcher'), false);
  assert.equal(game.onPlayerGone(du, duel, 'p0'), true);
  assert.equal(du.phase, 'done'); assert.equal(du.result.winner, 'p1'); assert.deepEqual(duel.awards, { p1: 300 });
  assert.equal(game.onPlayerGone(du, duel, 'p1'), false, 'finished matches stay finished');
  const table = new Clock(3, { moveTimer: '30 seconds' }), tb = game.create(table);
  move(tb, table, 0, 0); move(tb, table, 4, 0); // p0, p1 placed; p2 to move
  assert.equal(tb.turnPid, 'p2');
  assert.equal(game.onPlayerGone(tb, table, 'p1'), true);
  assert.equal(tb.phase, 'play'); assert.equal(tb.board[4].orbs, 0, 'the leaver\'s orbs leave the board');
  assert(tb.dropped.includes('p1') && tb.eliminated.includes('p1'));
  assert.equal(tb.lastEvent.kind, 'left'); assert.equal(tb.lastCascade.seq, tb.seq);
  move(tb, table, 2, 5); assert.equal(tb.turnPid, 'p0', 'turns skip the player who left');
  assert.equal(game.onPlayerGone(tb, table, 'p0'), true);
  assert.equal(tb.phase, 'done'); assert.equal(tb.result.winner, 'p2'); assert.deepEqual(table.awards, { p2: 300 });
  const gone = new Clock(3), gt = game.create(gone);
  assert.equal(game.onPlayerGone(gt, gone, 'p0'), true); assert.equal(gt.turnPid, 'p1', 'the leaver\'s own turn passes on');
  game.dispose(gt);
  console.log('CHAIN guards: malformed/opponent/stale/duplicate actions, projection privacy, deadline skips, resumption, disposal');
}

function socket() {
  return { readyState: 1, messages: [], send(s) { this.messages.push(JSON.parse(s)); } };
}
const lastState = (ws) => ws.messages.findLast((m) => m.t === 'state');
async function roomTests() {
  const room = new Room('CHAI', {}), sockets = Array.from({ length: 7 }, socket);
  try {
    const seats = sockets.map((ws, i) => room.addPlayer('P' + i, ws).player);
    assert(room.configure(game.id, game, { moveTimer: '30 seconds', boardSize: 'Standard', palette: 'Ink' }).ok);
    assert(room.startGame(game, {}, seats[0].id).ok);
    await Promise.resolve(); // real framework's timer-window capture
    const watching = lastState(sockets[6]);
    assert(watching.spectator); assert.equal(watching.mySeat, -1);
    assert.equal(watching.players.length, 6); assert.equal(watching.spectators.length, 1);
    assert.equal(watching.paletteName, 'Ink'); assert.equal(watching.cols, 6);
    const lateSocket = socket(); room.addPlayer('Late', lateSocket); room.broadcastState();
    assert(lastState(lateSocket).spectator);
    const s = room.game.state, pid = s.turnPid, command = { x: 0, y: 0, turnNo: s.turnNo };
    const token = { i: room.game.instanceId, w: actionWindow(s) };
    room.onAction(sockets[6], command, token); room.onAction(lateSocket, command, token);
    assert.equal(mass(s.board), 0, 'both roster overflow and late watchers cannot act');
    room.onAction(sockets[0], command, { ...token, i: 'old-match' });
    room.onAction(sockets[0], command, { ...token, w: 'old-window' });
    assert.equal(mass(s.board), 0, 'room rejects stale instances and windows');
    room.onAction(sockets[0], command, token); room.onAction(sockets[0], command, token);
    assert.equal(s.moves, 1); assert.equal(s.board[0].owner, pid);
    assert.equal(lastState(sockets[6]).board[0].owner, pid, 'watchers see accepted board actions');
    const snap = lastState(sockets[0]);
    assert(!('_cancel' in snap)); assert(!('token' in snap));
    const oldInstance = room.game.instanceId;
    assert(room.startGame(game, {}, seats[0].id).ok);
    assert.notEqual(room.game.instanceId, oldInstance); assert.equal(room.game.state.moves, 0);
    assert.equal(room.game.state.seq, 0, 'a rematch instance restarts the event seq');
    assert.equal(room.game.state.lastCascade.seq, 0);
    assert.equal(room.game.state.boardSize, 'Standard', 'rematch retains validated settings');
  } finally { room.destroy(); }

  // Complete another legal match THROUGH Room.onAction, using the snapshot's
  // real instance/window tokens for every move. No state fixture or deadline.
  const matchRoom = new Room('BOOM', {}), peers = [socket(), socket()];
  try {
    peers.forEach((ws, i) => matchRoom.addPlayer('Legal ' + i, ws));
    matchRoom.startGame(game, {}, matchRoom.players[0].id);
    const random = rng(41);
    while (matchRoom.game.state.phase === 'play') {
      const s = matchRoom.game.state, seat = matchRoom.players.findIndex((p) => p.id === s.turnPid);
      const snap = lastState(peers[seat]);
      const options = snap.board.flatMap((c, i) => c.owner === null || c.owner === snap.you ? [i] : []);
      const i = options[Math.floor(random() * options.length)];
      const before = mass(s.board);
      const roomBefore = s.board.map((c) => ({ owner: c.owner, orbs: c.orbs }));
      const seatPid = s.turnPid;
      matchRoom.onAction(peers[seat], { x: i % snap.cols, y: Math.floor(i / snap.cols), turnNo: snap.turnNo }, { i: snap.instanceId, w: snap.w });
      assert.equal(mass(s.board), before + 1); assert(s.moves <= 100);
      assertTapeReplays(s, roomBefore, i % snap.cols, Math.floor(i / snap.cols), seatPid, geometry(s.cols, s.rows));
      stable(s);
    }
    assert(lastState(peers[0]).result.winner);
    assert.equal(matchRoom.totals[matchRoom.game.state.result.winner], 300);
    console.log(`CHAIN Room legal match: ${matchRoom.game.state.moves} moves; spectators, stale windows, rematch and points verified`);
  } finally { matchRoom.destroy(); }
}

/* Small DOM double executes real mount/update/click/dispose code. Browser
 * screenshots remain the integration owner's job; this checks lifecycle and
 * actual submitted intents, staged replay timers, skip, dedupe, and disposal.
 * The renderer imports the pure planner, so the harness loads the exact
 * planner source alongside it (imports stripped, like the util import). */
function clientTests() {
  const intervals = new Map(), frames = new Map(), timeouts = new Map(); let nextId = 0, visualTime = 0, timerLag = 0;
  let reducedMotion = false, shortLandscape = false;
  const focused = [];
  class Element {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.parentNode = null;
      this.dataset = {}; this.attrs = {}; this.className = ''; this.listeners = new Map();
      this.style = { setProperty() {} };
      this.getBoundingClientRect = () => {
        const i = Number(this.dataset.cell);
        const left = this.className.includes('cr-flight') ? 8 : this.dataset.cell !== undefined ? 12 + i % 5 * 48 : 0;
        const top = this.className.includes('cr-flight') ? 8 : this.dataset.cell !== undefined ? 12 + Math.floor(i / 5) * 48 : 0;
        return { left, top, width: 44, height: 44, right: left + 44, bottom: top + 44 };
      };
      this.classList = {
        contains: (c) => this.className.split(' ').includes(c),
        add: (c) => { if (!this.classList.contains(c)) this.className += ' ' + c; },
        remove: (c) => { this.className = this.className.split(' ').filter((x) => x !== c).join(' '); },
        toggle: (c, flag) => { if (flag) this.classList.add(c); else this.classList.remove(c); },
      };
    }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    append(...children) { children.forEach((c) => this.appendChild(c)); }
    replaceChildren(...children) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this.append(...children); }
    set innerHTML(s) {
      this.replaceChildren();
      for (const m of s.matchAll(/<([a-z0-9]+)[^>]*class="([^"]+)"[^>]*>/g)) {
        const node = new Element(m[1]); node.className = m[2]; this.appendChild(node);
      }
    }
    setAttribute(k, v) { this.attrs[k] = v; }
    querySelector(s) {
      for (const c of this.children) {
        if (s[0] === '.' && c.classList.contains(s.slice(1))) return c;
        const found = c.querySelector(s); if (found) return found;
      }
      return null;
    }
    closest(s) { if (s === '[data-cell]' && this.dataset.cell !== undefined) return this; return this.parentNode?.closest(s) || null; }
    contains(c) { return c === this || this.children.some((n) => n.contains(c)); }
    addEventListener(event, fn) { const set = this.listeners.get(event) || new Set(); set.add(fn); this.listeners.set(event, set); }
    removeEventListener(event, fn) { this.listeners.get(event)?.delete(fn); }
    emit(event, target = this, extra = {}) {
      for (const fn of this.listeners.get(event) || []) fn({ target, preventDefault() {}, ...extra });
    }
    dispatchEvent(event) { this.emit(event.type, this, event); return true; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; }
    focus() { focused.push(this); }
  }
  const document = new Element('document');
  document.head = new Element('head'); document.createElement = (tag) => new Element(tag); document.hidden = false;
  const motion = new Element('mediaquery');
  Object.defineProperty(motion, 'matches', { get: () => reducedMotion });
  const landscape = new Element('mediaquery');
  Object.defineProperty(landscape, 'matches', { get: () => shortLandscape });
  const rendererSource = fs.readFileSync(path.join(__dirname, '../public/js/games/chain-reaction.js'), 'utf8');
  assert(rendererSource.includes('../engines/chain-visual.mjs'), 'the renderer replays through the shared planner');
  assert(rendererSource.includes('cr-fly'), 'the renderer flies visible orb transfers');
  const plannerSource = fs.readFileSync(path.join(__dirname, '../public/js/engines/chain-visual.mjs'), 'utf8')
    .replace(/^export /gm, '');
  const source = rendererSource
    .replace(/import\s*{[^}]+}\s*from\s*'[^']*';/g, '')
    .replace(/export default view;/, 'globalThis.view = view;');
  const sandbox = {
    document, Date: { now: () => visualTime }, console,
    nameOf: (s, id) => s.players.find((p) => p.id === id)?.name || '???',
    countdown: (endsAt, now) => Math.max(0, Math.ceil((endsAt - now) / 1000)),
    setInterval: (fn) => { const id = ++nextId; intervals.set(id, fn); return id; },
    clearInterval: (id) => intervals.delete(id),
    setTimeout: (fn, ms) => { const id = ++nextId; timeouts.set(id, { fn, at: visualTime + ms }); return id; },
    clearTimeout: (id) => timeouts.delete(id),
    requestAnimationFrame: (fn) => { const id = ++nextId; frames.set(id, fn); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    matchMedia: q => q.includes('reduced-motion') ? motion : landscape,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(plannerSource, sandbox);
  vm.runInContext(source, sandbox);
  const stepTimers = (n) => {
    for (let i = 0; i < n && timeouts.size; i++) {
      const [id, task] = [...timeouts].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      visualTime = Math.max(visualTime, task.at) + timerLag; timeouts.delete(id); task.fn();
    }
  };
  const drain = () => {
    let guard = 0;
    while (timeouts.size) {
      assert(guard++ < 10000, 'replay timers must terminate');
      stepTimers(1);
    }
    for (const fn of [...frames.values()]) fn(16);
    frames.clear();
  };
  const el = new Element('div'), ctx = new Clock(2), s = game.create(ctx), sent = [];
  const replaySignals = []; el.addEventListener('chain-replay', (e) => replaySignals.push(e.detail.active));
  const cues = [];
  const api = { now: () => ctx.now(), send: (a) => sent.push(a), cue: (name, options) => cues.push({name,...options}) };
  const snapshot = () => ({ ...game.view(s, 'p0'), you: 'p0', players: ctx.roster, instanceId: 'client-1', spectator: false });
  const view = sandbox.view;
  view.mount(el, api); view.update(el, snapshot(), api);
  const grid = el.querySelector('.cr-grid');
  const skip = el.querySelector('.cr-skip');
  const bar = el.querySelector('.cr-replay');
  assert.equal(grid.children.length, 30);
  assert.equal(el.querySelector('.cr-seats').children.length, 2);
  assert.equal(timeouts.size, 0, 'first paint renders the authoritative board instantly');
  assert.equal(cues.length,0,'initial Chain board is quiet');
  grid.emit('click', grid.children[0]); grid.emit('click', grid.children[0]);
  assert.equal(sent.length, 1, 'double taps send one intent per turn');
  assert.equal(sent[0].turnNo, 1); assert.equal(sent[0].x, 0); assert.equal(sent[0].y, 0);
  grid.emit('keydown', grid.children[0], { key: 'ArrowRight' });
  assert.equal(focused[0], grid.children[1], 'arrow keys move cell focus');
  game.onAction(s, ctx, 'p0', sent[0]); view.update(el, snapshot(), api);
  assert(timeouts.size > 0, 'a new move starts a visible placement replay');
  assert.equal(bar.hidden, false);
  grid.emit('click', grid.children[1]); assert.equal(sent.length, 1, 'waiting client sends no actions');
  const replayingTimers = timeouts.size;
  view.update(el, snapshot(), api);
  assert.equal(timeouts.size, replayingTimers, 'a heartbeat never restarts the running replay');
  drain();
  assert.equal(timeouts.size, 0); assert.equal(bar.hidden, true, 'settle hides the replay bar');
  assert.equal(cues.length,1,'visible placement has one gameplay cue'); assert.equal(cues[0].name,'place'); assert(cues[0].id.startsWith('client-1:'));
  assert(grid.children[0].attrs['aria-label'].includes('1 orb'), 'settle shows the authoritative board');
  move(s, ctx, 4, 5); view.update(el, snapshot(), api); drain();
  const staleSnap = snapshot();
  move(s, ctx, 0, 0); // p0 corner burst: tape [0], captures both neighbors
  assert.deepEqual(s.lastCascade.tape, [0]);
  view.update(el, snapshot(), api);
  assert(timeouts.size > 0, 'a burst starts a staged chain replay');
  stepTimers(1); // placement lands; the burst is still traveling
  assert(timeouts.size > 0, 'the chain continues stage by stage');
  stepTimers(1); // source bursts and sends two travelers; capture has not landed
  const travelers = el.querySelector('.cr-flight').children;
  assert.equal(travelers.length, 2, 'a corner sends exactly one visible atom to each neighbor');
  assert.equal(travelers[0].style.left, '26px', 'travelers use the flight overlay origin, not the board border');
  assert(grid.children[1].attrs['aria-label'].includes('Empty'), 'a destination changes ownership only on arrival');
  assert.equal(cues.at(-1).name,'burst','source burst cues at its visible firing');
  const cueCount=cues.length;
  const midReplay = timeouts.size;
  view.update(el, snapshot(), api);
  assert.equal(timeouts.size, midReplay, 'same-event updates dedupe mid-replay');
  assert.equal(cues.length,cueCount,'same-event replay does not sound again');
  grid.emit('click', grid.children[2]); assert.equal(sent.length, 1, 'no intents are sent from a mid-replay board');
  skip.emit('click'); // the player skips straight to the authoritative end
  assert.equal(timeouts.size, 0); assert.equal(frames.size, 0);
  assert.equal(bar.hidden, true);
  assert(grid.children[0].attrs['aria-label'].includes('Empty'), 'skip settles the spent corner');
  assert(grid.children[1].attrs['aria-label'].includes('Player 0'), 'skip settles arrival captures');
  const turnText = el.querySelector('.cr-turn').textContent;
  view.update(el, staleSnap, api);
  assert.equal(timeouts.size, 0, 'a stale snapshot never replays');
  assert(grid.children[0].attrs['aria-label'].includes('Empty'), 'a stale snapshot never regresses the board');
  assert.equal(el.querySelector('.cr-turn').textContent, turnText, 'a stale snapshot never regresses turn text');
  reducedMotion = true;
  move(s, ctx, 4, 5); view.update(el, snapshot(), api);
  assert.equal(timeouts.size, 0, 'reduced motion renders the authoritative board instantly');
  assert(grid.children[29].attrs['aria-label'].includes('Empty'), 'reduced motion still shows the burst corner spent');
  assert(grid.children[28].attrs['aria-label'].includes('Player 1'), 'reduced motion still shows arrival captures');
  reducedMotion = false;

  // A reconnect during a running cascade suppresses every remaining cue.
  const rctx=new Clock(2),rs=game.create(rctx),rsnap=()=>({...game.view(rs,'p0'),you:'p0',players:rctx.roster,instanceId:'reconnect-audio',spectator:false});
  view.update(el,rsnap(),api); move(rs,rctx,0,0); view.update(el,rsnap(),api);
  const beforeReconnect=cues.length;
  view.update(el,{...rsnap(),audioBaseline:true},api); view.update(el,rsnap(),api); drain();
  assert.equal(cues.length,beforeReconnect,'a resumed replay never sounds after reconnect baseline is gone');

  // Fast authoritative moves queue only the latest consecutive event. A stale
  // heartbeat must not erase that queued state; a gap settles immediately.
  const qctx = new Clock(2), qs = game.create(qctx);
  const qsnap = () => ({ ...game.view(qs, 'p0'), you: 'p0', players: qctx.roster, instanceId: 'queue-client', spectator: false });
  view.update(el, qsnap(), api);
  move(qs, qctx, 0, 0); const queuedOld = qsnap(); view.update(el, queuedOld, api);
  move(qs, qctx, 4, 5); view.update(el, qsnap(), api);
  view.update(el, queuedOld, api); drain();
  assert.equal(view.isReplaying(el), false);
  assert(grid.children[29].attrs['aria-label'].includes('Player 1'), 'a stale heartbeat cannot erase a queued move');
  assert(el.querySelector('.cr-turn').textContent.includes('Your turn'), 'the latest queued turn opens after replay');
  move(qs, qctx, 0, 0); view.update(el, qsnap(), api);
  reducedMotion = true; motion.emit('change');
  assert.equal(timeouts.size, 0, 'changing reduced motion during a replay settles immediately');
  assert.equal(view.isReplaying(el), false); reducedMotion = false;
  move(qs, qctx, 4, 5); view.update(el, qsnap(), api);
  document.hidden = true; document.emit('visibilitychange');
  assert.equal(timeouts.size, 0, 'backgrounded views settle before their timers can be throttled');
  const hiddenCues = cues.length;
  for (const [x,y] of [[2,0],[4,5]]) {
    move(qs, qctx, x, y); view.update(el, qsnap(), api);
    assert.equal(view.isReplaying(el), false, 'a later hidden snapshot cannot start a suspended replay');
    assert.equal(timeouts.size, 0, 'already hidden turns need no replay watchdog to release readiness');
    qs.board.forEach((c,i) => assert.equal(grid.children[i].dataset.content, c.owner + ':' + c.orbs, 'hidden board is authoritative before its readiness signal'));
  }
  assert.equal(cues.length, hiddenCues, 'unseen hidden moves do not start queued cosmetic sound');
  document.hidden = false;
  move(qs, qctx, 2, 0); view.update(el, qsnap(), api);
  move(qs, qctx, 4, 5); view.update(el, qsnap(), api);
  move(qs, qctx, 3, 0); view.update(el, qsnap(), api);
  assert.equal(timeouts.size, 0, 'three fast snapshots never build an animation backlog');
  qs.board.forEach((c, i) => assert.equal(grid.children[i].dataset.content, c.owner + ':' + c.orbs));

  // A little lateness on every browser timer must not accumulate until the
  // safety deadline skips the end of an otherwise replayable long chain.
  const dctx = new Clock(2, { boardSize: 'Standard' }), ds = game.create(dctx);
  const dg = geometry(ds.cols, ds.rows);
  ds.board = dg.capacities.map((cap, i) => ({ owner: i === dg.capacities.length - 1 ? 'p1' : 'p0', orbs: cap - 1 }));
  ds.entered.p0 = ds.entered.p1 = true;
  const dsnap = () => ({ ...game.view(ds, 'p0'), you: 'p0', players: dctx.roster, instanceId: 'delayed-client', spectator: false });
  view.update(el, dsnap(), api); move(ds, dctx, 0, 0);
  assert.equal(ds.lastCascade.tape.length, 133);
  const beganAt = visualTime; timerLag = 10;
  view.update(el, dsnap(), api); drain(); timerLag = 0;
  assert.equal(el.querySelector('.cr-progress').textContent, 'Reacting…', 'reaction status stays quiet despite long tapes');
  assert(visualTime - beganAt < 6500, 'late timers follow the original clock instead of adding delay per firing');
  ds.board.forEach((c, i) => assert.equal(grid.children[i].dataset.content, c.owner + ':' + c.orbs));

  // The winning burst is still shown, and the winner is announced once it
  // finishes; repeated authoritative heartbeats cannot reveal the end early.
  const wctx = new Clock(2), ws = game.create(wctx);
  ws.board[0] = { owner: 'p0', orbs: 1 }; ws.board[1] = { owner: 'p1', orbs: 1 };
  ws.entered.p0 = ws.entered.p1 = true;
  const wsnap = () => ({ ...game.view(ws, 'p0'), you: 'p0', players: wctx.roster, instanceId: 'win-client', spectator: false });
  view.update(el, wsnap(), api); move(ws, wctx, 0, 0); view.update(el, wsnap(), api);
  assert.equal(ws.phase, 'done'); assert(view.isReplaying(el));
  view.update(el, wsnap(), api);
  assert(!el.querySelector('.cr-turn').textContent.includes('wins'), 'heartbeats defer the winner until the atoms land');
  assert.equal(el.querySelector('.cr-result').hidden, true);
  const staleWinningTimer = [...timeouts.values()][0].fn;
  stepTimers(4); // placement, burst launch, arrival, then the final stage boundary
  assert(view.isReplaying(el), 'last arrival motion settles before the winner/clock opens');
  assert.equal(el.querySelector('.cr-result').hidden, true, 'final visual tail cannot celebrate early');
  assert.equal(el.querySelector('.cr-clock').hidden, true, 'final visual tail keeps the next clock closed');
  drain(); assert(el.querySelector('.cr-turn').textContent.includes('wins'));
  assert.equal(replaySignals.at(-1), false, 'the frame receives a settled signal to reveal its result controls');
  const oldWinner = wsnap();
  const ctx2 = new Clock(2), s2 = game.create(ctx2);
  view.update(el, { ...game.view(s2, 'p0'), you: 'p0', players: ctx2.roster, instanceId: 'client-2', spectator: false }, api);
  assert.equal(grid.children.length, 30, 'a rematch instance rebuilds the board');
  assert.equal(timeouts.size, 0);
  staleWinningTimer();
  assert.equal(timeouts.size, 0, 'a retired callback cannot start work in a rematch');
  assert(grid.children[0].attrs['aria-label'].includes('Empty'), 'a retired callback cannot repaint old atoms');
  view.update(el, oldWinner, api);
  assert(grid.children[0].attrs['aria-label'].includes('Empty'), 'an old match cannot return after a rematch');
  assert(grid.children[0].attrs['aria-label'].includes('Bursts at 2'));
  // Touch tap targets: inner labels bubble to their cell via closest(), while
  // taps on grid background send nothing. A second tap on a different cell in
  // the same turn still sends one intent (pendingTurn), matching double-tap.
  grid.emit('click', grid);
  assert.equal(sent.length, 1, 'background taps send no intent');
  const capChild = grid.children[2].children[0];
  assert(capChild, 'empty cells render an inner capacity label');
  grid.emit('click', capChild);
  assert.equal(sent.length, 2, 'inner-label taps bubble to their cell');
  assert.equal(sent[1].turnNo, 1); assert.equal(sent[1].x, 2); assert.equal(sent[1].y, 0);
  grid.emit('click', grid.children[4]);
  assert.equal(sent.length, 2, 'a second tap on another cell sends no duplicate');
  // Visual transpose never changes actions, but arrow focus follows the screen.
  const tc = new Clock(2, { boardSize: 'Standard' }), ts = game.create(tc);
  shortLandscape = true;
  view.update(el, { ...game.view(ts, 'p0'), you: 'p0', players: tc.roster, instanceId: 'transpose-client', spectator: false }, api);
  grid.emit('keydown', grid.children[0], { key: 'ArrowRight' });
  assert.equal(focused.at(-1), grid.children[6], 'Right follows the transposed screen to logical row2/col1');
  grid.emit('keydown', grid.children[0], { key: 'ArrowDown' });
  assert.equal(focused.at(-1), grid.children[1], 'Down follows the transposed screen to logical row1/col2');
  shortLandscape = false; landscape.emit('change');
  grid.emit('keydown', grid.children[0], { key: 'ArrowRight' });
  assert.equal(focused.at(-1), grid.children[1], 'rotation restores normal visual arrow navigation');
  assert.equal(intervals.size, 1);
  assert.equal([...grid.listeners.values()].reduce((n, set) => n + set.size, 0), 2);
  assert.equal([...skip.listeners.values()].reduce((n, set) => n + set.size, 0), 1);
  view.dispose(el); view.dispose(el);
  assert.equal(intervals.size, 0); assert.equal(frames.size, 0); assert.equal(timeouts.size, 0);
  assert.equal([...grid.listeners.values()].reduce((n, set) => n + set.size, 0), 0);
  assert.equal([...skip.listeners.values()].reduce((n, set) => n + set.size, 0), 0);
  assert.equal(document.head.children.length, 0);
  assert.equal([...motion.listeners.values()].reduce((n, set) => n + set.size, 0), 0);
  assert.equal([...document.listeners.values()].reduce((n, set) => n + set.size, 0), 0);
  grid.emit('click', grid.children[0]); assert.equal(sent.length, 2, 'disposed views cannot send');
  game.dispose(ts); game.dispose(s); game.dispose(s2); game.dispose(qs); game.dispose(ds); game.dispose(ws);
  console.log('CHAIN client: real mount/update/intents, staged replay, skip, dedupe, stale drops, reduced motion, rematch, disposal');
}

async function frameResultTests() {
  const ids = new Map(), scrolls = [], resultsReady = [], prepared = [], paints = []; let replaying = false;
  const element = () => ({ dataset: {}, hidden: true, disabled: true, className: '', textContent: '',
    style: { setProperty() {} },
    setAttribute() {}, removeEventListener() {},
    appendChild(c) { this.children = [...(this.children || []), c]; return c; },
    replaceChildren(...children) { this.children = children; },
    scrollIntoView(options) { scrolls.push(options); } });
  const main = element();
  const visibilityListeners = new Set();
  const document = { hidden: false, addEventListener(type, fn) { if (type === 'visibilitychange') visibilityListeners.add(fn); }, removeEventListener(type, fn) { visibilityListeners.delete(fn); }, fonts: { ready: Promise.resolve() }, getElementById: (id) => {
    if (!ids.has(id)) ids.set(id, element()); return ids.get(id);
  }, querySelector: () => main, createElement: element };
  const source = fs.readFileSync(path.join(__dirname, '../games/chain-reaction/browser/play.js'), 'utf8')
    .replace(/\nboot\(\);\s*$/, '\nclient = testClient; view = testView; mounted = true; globalThis.snapshot = onSnapshot; globalThis.settled = onReplayState; globalThis.clean = cleanup;');
  const harness = { document, console, requestAnimationFrame: fn => { paints.push(fn); return fn; }, cancelAnimationFrame: fn => { const i = paints.indexOf(fn); if (i >= 0) paints.splice(i, 1); }, testClient: { name: (id) => id, ready: state => prepared.push(state), resultsReady() {
      assert.equal(replaying, false, 'the last atom must have landed before the room is notified');
      assert.equal(ids.get('result').hidden, false, 'winner is visible before resultsReady');
      assert.equal(ids.get('controls').hidden, false, 'rematch is visible before resultsReady');
      resultsReady.push(main.dataset.phase);
    } },
    testView: { update() {}, isReplaying: () => replaying }, clearTimeout() {} };
  vm.runInNewContext(source, harness);
  const palette = [
    { color: '#ff557c', shape: 'circle', label: 'Raspberry circles' },
    { color: '#36dec4', shape: 'diamond', label: 'Teal diamonds' },
  ];
  const state = (instanceId, phase) => ({ instanceId, phase, cols: 5, rows: 6,
    board: [], order: ['p0', 'p1'], palette, turnPid: 'p0', you: 'p0', turnNo: 1,
    lastEvent: { seq: phase === 'done' ? 1 : 0 }, result: { winner: 'p0', detail: 'Last atom standing.' } });
  harness.snapshot(state('frame-a', 'play'), { isHost: true });
  assert.equal(ids.get('controls').hidden, true); assert.equal(scrolls.length, 0);
  replaying = true;
  harness.snapshot(state('frame-a', 'done'), { isHost: true });
  assert.equal(ids.get('result').hidden, true); assert.equal(scrolls.length, 0, 'winning motion does not jump to the result');
  harness.snapshot(state('frame-a', 'done'), { isHost: true }); harness.settled();
  assert.equal(resultsReady.length, 0, 'done heartbeats and active replay signals cannot celebrate early');
  replaying = false; harness.settled();
  assert.equal(ids.get('controls').hidden, false); assert.equal(ids.get('rematchBtn').disabled, false);
  assert.equal(scrolls.length, 1, 'settlement reveals the result actions once');
  assert.deepEqual(resultsReady, ['done'], 'settlement notifies the room exactly once');
  assert.equal(scrolls[0].block, 'start'); assert.equal(scrolls[0].behavior, 'auto');
  const doneChildren = ids.get('result').children;
  assert.equal(ids.get('result').hidden, false);
  assert.equal(doneChildren.length, 3, 'tabletop result keeps game name, winner, and brief outcome');
  assert.equal(doneChildren[0].textContent, 'Chain Reaction', 'game identity remains readable on the result');
  assert(doneChildren[1].children[0].className.includes('winner-mark'), 'winner atom mark renders');
  assert(doneChildren[1].children[0].children[0].className.includes('cr-orb'), 'winner mark reuses orb shape');
  assert(doneChildren[1].children[1].textContent.includes('wins'), 'winner name stays readable');
  assert(!doneChildren[2].textContent.includes('100 session points'), 'single result owns the outcome, no points duplication');
  harness.snapshot(state('frame-a', 'done'), { isHost: true }); harness.settled();
  assert.equal(scrolls.length, 1, 'repeated snapshots do not keep scrolling the phone');
  assert.equal(resultsReady.length, 1, 'repeated done snapshots and settled signals do not celebrate twice');
  harness.snapshot(state('frame-b', 'play'), { isHost: true });
  assert.equal(ids.get('controls').hidden, true);
  harness.snapshot(state('frame-a', 'done'), { isHost: true });
  assert.equal(scrolls.length, 1, 'a retired result cannot return after rematch');
  assert.equal(resultsReady.length, 1, 'retired snapshots cannot notify resultsReady');
  harness.snapshot(state('frame-b', 'done'), { isHost: false });
  assert.equal(scrolls.length, 2, 'a new match can reveal its own result');
  assert.equal(ids.get('rematchBtn').disabled, true, 'result reveal keeps host controls gated');
  assert.equal(resultsReady.length, 2, 'an instant/reduced-motion result can notify its own new instance');
  const preparing = w => ({ ...state('frame-ready', 'play'), w, preparing: true });
  const paintAll = async () => { await new Promise(setImmediate); while (paints.length) paints.shift()(16); await new Promise(setImmediate); };
  const firstWindow = preparing('turn-1');
  harness.snapshot(firstWindow, { isHost: true });
  await new Promise(setImmediate);
  assert.equal(prepared.length, 0, 'fonts alone cannot acknowledge an unpainted field');
  paints.shift()(16); await new Promise(setImmediate);
  assert.equal(prepared.length, 0, 'one painted frame cannot open the room clock');
  paints.shift()(32); await new Promise(setImmediate);
  assert.equal(prepared.length, 1); assert.equal(prepared[0], firstWindow, 'ready acknowledges the exact prepared window');
  harness.snapshot(firstWindow, { isHost: true }); await paintAll();
  assert.equal(prepared.length, 1, 'a heartbeat cannot acknowledge twice');
  harness.snapshot(preparing('turn-2'), { isHost: true });
  harness.snapshot(preparing('turn-3'), { isHost: true }); await paintAll();
  assert.equal(prepared.length, 2); assert.equal(prepared[1].w, 'turn-3', 'a retired paint callback cannot acknowledge the next turn');
  replaying = true; harness.snapshot(preparing('turn-4'), { isHost: true }); await paintAll();
  assert.equal(prepared.length, 2, 'cascade motion keeps readiness closed');
  replaying = false; harness.settled(); await paintAll();
  assert.equal(prepared.length, 3, 'the settled field acknowledges its own window');
  document.hidden = true;
  harness.snapshot(preparing('hidden-start'), { isHost: true }); await new Promise(setImmediate);
  assert.equal(prepared.length, 4, 'already hidden field acknowledges without suspended animation frames');
  assert.equal(paints.length, 0); assert.equal(visibilityListeners.size, 0, 'hidden readiness removes visibility listeners');
  document.hidden = false;
  harness.snapshot(preparing('hidden-during-paint'), { isHost: true }); await new Promise(setImmediate);
  paints.shift()(16); await new Promise(setImmediate); assert.equal(prepared.length, 4, 'visible field still requires two paints');
  document.hidden = true; for (const fn of [...visibilityListeners]) fn(); await new Promise(setImmediate);
  assert.equal(prepared.length, 5, 'real visibility change releases an in-flight field paint');
  assert.equal(prepared.at(-1).w, 'hidden-during-paint'); assert.equal(paints.length, 0, 'hiding cancels suspended callbacks'); assert.equal(visibilityListeners.size, 0);
  harness.snapshot(preparing('hidden-during-paint'), { isHost: true }); await new Promise(setImmediate); assert.equal(prepared.length, 5, 'hidden heartbeat cannot duplicate readiness');
  document.hidden = false; document.documentElement = {};
  const observers = [];
  harness.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
    emit(isIntersecting) { this.callback([{ target: this.target, isIntersecting }]); }
  };
  let resolveOffscreenFont; document.fonts.ready = new Promise(resolve => resolveOffscreenFont = resolve);
  harness.snapshot(preparing('offscreen-initial'), { isHost: true }); await new Promise(setImmediate);
  assert.equal(observers.length, 0, 'offscreen paint cannot bypass loaded fonts'); assert.equal(prepared.length, 5);
  resolveOffscreenFont(); await new Promise(setImmediate); const initiallyOffscreen = observers.at(-1);
  assert.ok(initiallyOffscreen); assert.equal(initiallyOffscreen.target, document.documentElement);
  initiallyOffscreen.emit(false); await new Promise(setImmediate);
  assert.equal(prepared.length, 6); assert.equal(prepared.at(-1).w, 'offscreen-initial');
  assert.ok(initiallyOffscreen.disconnected); assert.equal(paints.length, 0); assert.equal(visibilityListeners.size, 0);
  initiallyOffscreen.emit(false); await new Promise(setImmediate); assert.equal(prepared.length, 6, 'late IO cannot duplicate child readiness');
  harness.snapshot(preparing('io-visible'), { isHost: true }); await new Promise(setImmediate);
  const visibleObserver = observers.at(-1); visibleObserver.emit(true); paints.shift()(16); await new Promise(setImmediate);
  assert.equal(prepared.length, 6, 'visible IO does not replace two paint callbacks'); paints.shift()(32); await new Promise(setImmediate);
  assert.equal(prepared.length, 7); assert.ok(visibleObserver.disconnected);
  harness.snapshot(preparing('io-midwait'), { isHost: true }); await new Promise(setImmediate); paints.shift()(16);
  const midObserver = observers.at(-1), cancelledFrame = paints[0]; midObserver.emit(false); await new Promise(setImmediate);
  assert.equal(prepared.length, 8); assert.equal(prepared.at(-1).w, 'io-midwait'); assert.ok(midObserver.disconnected); assert.equal(paints.length, 0);
  cancelledFrame(); midObserver.emit(false); await new Promise(setImmediate); assert.equal(prepared.length, 8); assert.equal(paints.length, 0, 'late cancelled callback cannot restart a paint loop');
  harness.snapshot(preparing('io-retired'), { isHost: true }); await new Promise(setImmediate); const retiredObserver = observers.at(-1);
  retiredObserver.emit(false); harness.snapshot(preparing('io-current'), { isHost: true }); await new Promise(setImmediate);
  assert.equal(prepared.length, 8, 'replacement cannot acknowledge the retired field'); assert.ok(retiredObserver.disconnected);
  observers.at(-1).emit(false); await new Promise(setImmediate); assert.equal(prepared.length, 9); assert.equal(prepared.at(-1).w, 'io-current');
  document.hidden = false;
  harness.snapshot(preparing('turn-5'), { isHost: true }); await new Promise(setImmediate);
  const disposedObserver = observers.at(-1);

  harness.clean(); await paintAll();
  assert.equal(prepared.length, 9, 'disposed frame paint callbacks cannot acknowledge');
  assert.ok(disposedObserver.disconnected); assert.equal(paints.length, 0); assert.equal(visibilityListeners.size, 0);
  disposedObserver.emit(false); await new Promise(setImmediate); assert.equal(prepared.length, 9);
  harness.snapshot(state('frame-c', 'done'), { isHost: true }); harness.settled();
  assert.equal(resultsReady.length, 2, 'disposed frames cannot notify resultsReady');
  assert.equal(game.manifest.runtime.waitForResult, true, 'the room waits for Chain presentation before celebration');
  console.log('CHAIN frame: result actions revealed after motion once per match; heartbeat, rematch and host gates verified');
}

(async () => {
  rulesTests(); guardsAndDeadlines();
  playMatch(2, {}, 12); playMatch(3, {}, 8);
  playMatch(2, { boardSize: 'Standard' }, 25); playMatch(3, { boardSize: 'Standard' }, 18);
  playMatch(6, {}, 44);
  await roomTests(); clientTests(); await frameResultTests();
  console.log('CHAIN_REACTION_PASS');
})().catch((e) => { console.error('CHAIN_REACTION_FAIL', e.stack); process.exitCode = 1; });
