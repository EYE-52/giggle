'use strict';
// Real Room snapshots must carry WYR match points separately from session
// totals, including streak bonuses, nonvoters, and a fresh rematch.
const assert = require('node:assert/strict');
const { Room } = require('../server/room');
const game = require('../games/would-you-rather/server');

const room = new Room('WYRS', { 'would-you-rather': { prompts: [{ a: 'Fly', b: 'Be invisible' }] } });
const sockets = Array.from({ length: 3 }, () => ({ readyState: 1, bufferedAmount: 0, frames: [], send(s) { this.frames.push(JSON.parse(s)); }, close() {} }));
const players = sockets.map((socket, i) => room.addPlayer('Score player ' + i, socket).player);
const [a, b, c] = players.map(p => p.id);
const before = { [a]: 700, [b]: 250, [c]: 90 };
Object.assign(room.totals, before);
const lastState = socket => socket.frames.findLast(frame => frame.t === 'state');
try {
  assert(room.startGame(game, { settings: { rounds: 2, voteSeconds: 30 } }, a).ok);
  assert.deepEqual(lastState(sockets[0]).scores, {}, 'fresh match starts at zero');
  assert.deepEqual(lastState(sockets[0]).totals, before, 'fresh match keeps session totals');
  room.onAction(sockets[0], { vote: 'a' });
  room.onAction(sockets[1], { vote: 'a' });
  room.onAction(sockets[2], { vote: 'b' });
  const roundOne = { [a]: 100, [b]: 100 };
  assert.equal(room.game.state.phase, 'reveal');
  for (const socket of sockets) assert.deepEqual(lastState(socket).scores, roundOne, 'all players receive authoritative match scores');
  assert.deepEqual(room.totals, { [a]: 800, [b]: 350, [c]: 90 });
  room.onAction(sockets[0], { next: true });
  room.onAction(sockets[0], { vote: 'b' });
  room.onAction(sockets[1], { vote: 'b' });
  // Close the second round through the authoritative late-input path.
  room.game.state.endsAt = Date.now() - 1;
  room.onAction(sockets[2], { vote: 'a' });
  assert.deepEqual(lastState(sockets[2]).scores, { [a]: 225, [b]: 225 }, 'streak bonus accumulates in match scores');
  assert.equal(lastState(sockets[2]).scores[c], undefined, 'a nonvoter earns no points');
  const totalsAfter = { [a]: 925, [b]: 475, [c]: 90 };
  assert.deepEqual(room.totals, totalsAfter, 'match points are awarded to the session once');
  room.onAction(sockets[0], { next: true });
  assert.equal(lastState(sockets[0]).phase, 'done');
  assert.deepEqual(lastState(sockets[0]).scores, { [a]: 225, [b]: 225 }, 'final match scores stay authoritative');
  assert(room.startGame(game, { settings: { rounds: 1, voteSeconds: 30 } }, a).ok);
  assert.deepEqual(lastState(sockets[0]).scores, {}, 'rematch resets match points');
  assert.deepEqual(lastState(sockets[0]).totals, totalsAfter, 'rematch retains accumulated session points');
  room.game.state.endsAt = Date.now() - 1;
  room.onAction(sockets[0], { vote: 'a' });
  room.onAction(sockets[0], { next: true });
  assert.equal(lastState(sockets[0]).phase, 'done');
  assert.deepEqual(lastState(sockets[0]).scores, {}, 'no-ballot match stays at zero');
  assert.deepEqual(room.totals, totalsAfter, 'no-ballot match awards nothing');
  console.log('WYR_MATCH_SCORES_PASS: real Room awards, streaks, nonvoters, session separation, final scores and rematch');
} finally { room.destroy(); }
