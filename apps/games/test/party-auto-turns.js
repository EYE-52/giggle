'use strict';
const assert = require('node:assert/strict');

// Follow real authority deadlines, including idle writers, through the full
// rotation. "One per player" must not stop at the old eight-seat cap.
let matches = 0;
for (const id of ['compliment-battle', 'roast-toast', 'two-truths', 'truth-dare']) {
  const game = require('../games/' + id + '/server');
  for (const count of [3, 8, 9, 20]) {
    for (const rounds of [null, 1, 12]) {
      const players = Array.from({length: count}, (_, i) => ({id: 'p' + i}));
      let now = 1000;
      const timers = [];
      const ctx = {allPlayers: () => players, players: () => players,
        content: () => ({}), settings: () => ({rounds}), hostId: () => 'p0',
        now: () => now, later(ms, fn) {timers.push({at: now + ms, fn});},
        broadcast() {}, award() {}};
      const state = game.create(ctx), turns = [];
      let lastRound = 0;
      for (let n = 0; state.phase !== 'done' && n < 500; n++) {
        if (state.round !== lastRound) {
          turns.push(state.subject || state.target);
          lastRound = state.round;
        }
        timers.sort((a, b) => a.at - b.at);
        const next = timers.shift();
        assert(next, id + ' schedules a transition');
        now = next.at;
        next.fn();
      }
      assert.equal(state.phase, 'done', id + ' finishes');
      assert.equal(state.rounds, rounds ?? count);
      assert.equal(turns.length, rounds ?? count);
      if (rounds === null) assert.deepEqual([...turns].sort(), players.map(p => p.id).sort(),
        id + ' gives every starting seat exactly one turn');
      if (id === 'truth-dare') assert(!('rotation' in game.view(state, 'p0', ctx)),
        'private future spinner order stays out of public views');
      matches++;
    }
  }
}
console.log('PARTY_AUTO_TURNS_PASS:', matches, 'full authority matches preserve every seat and explicit round limits');
