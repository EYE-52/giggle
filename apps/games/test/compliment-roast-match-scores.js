'use strict';
const assert = require('node:assert/strict');
for (const id of ['compliment-battle', 'roast-toast']) {
  const game = require('../games/' + id + '/server');
  const players = ['a', 'b', 'c'].map(id => ({ id, name: id }));
  let time = 0, pending = [], totals = { a: 900, b: 800, c: 700 };
  const ctx = { allPlayers: () => players, players: () => players, hostId: () => 'a', settings: () => ({ rounds: 3, writeSeconds: 15 }), content: () => ({ prompts: ['Kind'], starters: ['Friendly'] }), now: () => time, later: (ms, fn) => pending.push({ at: time + ms, fn }), broadcast() {}, award: (pid, n) => totals[pid] += n };
  const state = game.create(ctx), expected = {};
  assert.deepEqual(state.scores, {});
  for (let round = 1; round <= 3; round++) {
    const authors = players.filter(p => p.id !== state.target).map(p => p.id);
    game.onAction(state, ctx, authors[0], { entry: 'Private note ' + authors[0] });
    const writing = game.view(state, 'watcher', ctx);
    assert.deepEqual(writing.entries, {}); assert.equal(writing.myEntry, null);
    assert.equal(game.view(state, authors[0], ctx).myEntry, 'Private note ' + authors[0]);
    game.onAction(state, ctx, authors[1], { entry: 'Private note ' + authors[1] });
    assert.equal(state.phase, 'vote');
    const secret = game.view(state, 'watcher', ctx);
    assert.deepEqual(secret.entries, {}); assert.deepEqual(secret.votes, {});
    assert(secret.ballot.every(b => Object.keys(b).sort().join() === 'i,text'));
    for (const pid of id === 'roast-toast' ? authors : players.map(p => p.id)) {
      const choice = state.order.findIndex(author => author !== pid);
      game.onAction(state, ctx, pid, { vote: choice });
      game.onAction(state, ctx, pid, { vote: choice }); // duplicate must not double award
    }
    if (id === 'roast-toast') game.onAction(state, ctx, state.target, { pick: 0 });
    assert.equal(state.phase, 'reveal');
    const last = state.last;
    for (const pid of last.winners || last.roomFave) expected[pid] = (expected[pid] || 0) + 100;
    if (id === 'roast-toast') { expected[last.pick] = (expected[last.pick] || 0) + 100; assert(last.roomFave.includes(last.pick), 'same author receives both awards'); }
    assert.deepEqual(state.scores, expected);
    for (const p of players) assert.equal(totals[p.id], ({ a: 900, b: 800, c: 700 })[p.id] + (expected[p.id] || 0));
    const saved = { ...state.scores };
    game.onAction(state, ctx, authors[0], { entry: 'stale', vote: 0, pick: 0 });
    assert.deepEqual(state.scores, saved);
    assert.deepEqual(game.view(state, 'watcher', ctx).scores, saved);
    game.onAction(state, ctx, 'a', { next: true });
  }
  assert.equal(state.phase, 'done');
  const night = { ...totals }, fresh = game.create(ctx);
  assert.deepEqual(fresh.scores, {}); assert.deepEqual(totals, night);
  for (let i = 0; i < 3; i++) { time = fresh.endsAt; game.onAction(fresh, ctx, 'a', { entry: 'late' }); }
  assert.equal(fresh.phase, 'done'); assert.deepEqual(fresh.scores, {}); assert.deepEqual(totals, night);
}
console.log('COMPLIMENT_ROAST_MATCH_SCORES_PASS');
