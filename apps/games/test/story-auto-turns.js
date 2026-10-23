'use strict';
const assert = require('node:assert/strict');

// Drive real server deadlines through every turn. Auto must include every
// starting seat, even when the roster is larger than the manual round limit.
let matches = 0;
for (const id of ['charades', 'emoji-story']) {
  const game = require('../games/' + id + '/server');
  for (const count of [3, 8, 9, game.manifest.players.max]) {
    for (const rounds of [null, 1, 12]) {
      const players = Array.from({length: count}, (_, i) => ({id: 'seat-' + i}));
      const timers = [];
      let now = 0;
      const ctx = {allPlayers: () => players, players: () => players,
        content: () => ({words: ['robot'], phrases: [{phrase: 'Pizza party'}]}),
        settings: () => ({rounds}), now: () => now, broadcast() {}, award() {},
        later(ms, fn) {timers.push({at: now + ms, fn});}};
      const state = game.create(ctx), actors = [];
      let lastRound = 0;
      for (let step = 0; state.phase !== 'done' && step < 100; step++) {
        if (state.round !== lastRound) {
          actors.push(state.actor || state.director);
          lastRound = state.round;
        }
        const timer = timers.shift();
        assert(timer, id + ' must schedule its next transition');
        now = timer.at;
        timer.fn();
      }
      assert.equal(state.phase, 'done', id + ' completes the full match');
      assert.equal(state.rounds, rounds ?? count, id + ' honors auto or explicit rounds');
      assert.equal(actors.length, rounds ?? count, id + ' plays the promised number of turns');
      if (rounds === null) assert.deepEqual([...actors].sort(), players.map(p => p.id).sort(),
        id + ' auto gives every starting player exactly one turn');
      matches++;
    }
  }
}
console.log('STORY_AUTO_TURNS_PASS:', matches, 'complete auto/manual matches across small and maximum rosters');
