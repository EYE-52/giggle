'use strict';
// A real Room receives correct, expired and wrong answers. Only consecutive
// correct answers earn streak points; a missed round keeps its no-answer view.
const assert = require('node:assert/strict');
const { Room } = require('../server/room');
const game = require('../games/trivia/server');
const room = new Room('TSTR', { trivia: { questions: [{ q: 'One plus one?', options: ['Two', 'Three', 'Four', 'Five'], answer: 0 }] } });
const sockets = Array.from({ length: 2 }, () => ({ readyState: 1, bufferedAmount: 0, frames: [], send(raw) { this.frames.push(JSON.parse(raw)); }, close() {} }));
const [a, b] = sockets.map((socket, i) => room.addPlayer('Quiz ' + i, socket).player.id);
const snapshot = () => sockets[0].frames.findLast(frame => frame.t === 'state');
const next = () => { room.onAction(sockets[0], { next: true }); assert.equal(room.game.state.phase, 'answer'); };
const answer = pick => {
  const state = room.game.state, deadline = state.endsAt;
  room.onAction(sockets[0], { pick });
  const receivedAt = state.answers[a].at;
  room.onAction(sockets[1], { pick: 1 });
  assert.equal(state.phase, 'reveal');
  // Rules standard: 100 for a correct answer, speed up to +50.
  return 100 + Math.round(Math.max(0, deadline - receivedAt) / 15000 * 50);
};
try {
  room.totals[a] = 9000;
  assert(room.startGame(game, {}, a).ok);
  const privateView = game.view(room.game.state, b, room.ctx());
  assert.equal(privateView.question.answer, undefined, 'correct answer remains private during input');
  assert.deepEqual(privateView.answers, {});
  const first = answer(0);
  assert.equal(snapshot().scores[a], first, 'match scores exclude pre-existing room totals');
  assert.equal(room.totals[a], 9000 + first);
  const projected = game.view(room.game.state, b, room.ctx());
  projected.scores[a] = -1;
  assert.equal(room.game.state.scores[a], first, 'score projection does not expose a mutable state reference');
  assert.equal(snapshot().last.results[a].pts, first);
  assert.equal(room.game.state.streaks[a], 1);
  next();
  room.onAction(sockets[1], { pick: 1 });
  room.game.state.endsAt = Date.now() - 1;
  room.onAction(sockets[0], { pick: 0 }); // Received after expiry, before timer delivery.
  assert.equal(room.game.state.phase, 'reveal');
  assert.equal(snapshot().last.results[a], undefined, 'missed answers retain the existing no-answer representation');
  assert.equal(room.game.state.streaks[a], 0, 'an expired unanswered round breaks the correct-answer streak');
  const totals = { ...room.totals };
  room.onAction(sockets[0], { pick: 0 });
  assert.deepEqual(room.totals, totals, 'a closed round cannot award a late answer');
  next();
  const afterMiss = answer(0);
  assert.equal(snapshot().last.results[a].pts, afterMiss, 'correct after a timeout earns base and speed only');
  next();
  const consecutive = answer(0);
  assert.equal(snapshot().last.results[a].pts, consecutive + 25, 'consecutive correct answers still earn the streak bonus');
  next();
  answer(1);
  assert.equal(room.game.state.streaks[a], 0, 'a wrong answer also breaks the streak');
  next();
  const afterWrong = answer(0);
  assert.equal(snapshot().last.results[a].pts, afterWrong, 'correct after wrong earns base and speed only');
  while (room.game.state.round < room.game.state.rounds) { next(); answer(0); }
  room.onAction(sockets[0], { next: true });
  assert.equal(snapshot().phase, 'done');
  assert.equal(snapshot().scores[a], room.totals[a] - 9000, 'final projection retains exact per-match awarded delta');
  assert.equal(snapshot().scores[b], undefined, 'wrong-only player has zero match points');
  assert(room.startGame(game, {}, a).ok);
  assert.deepEqual(snapshot().scores, {}, 'rematch clears match scores while retaining room totals');
  const rematch = answer(0);
  assert.equal(snapshot().last.results[a].pts, rematch, 'rematch starts a fresh streak');
  console.log('TRIVIA_STREAK_PASS: real Room correct, missed, late, consecutive, wrong and rematch scoring');
} finally { room.destroy(); }
