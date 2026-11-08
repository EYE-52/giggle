'use strict';

// Registry playthroughs use only public legal moves. Dice are deterministic in
// this unit fixture; the browser suite uses the real server crypto source.
const crypto = require('node:crypto');

function playBatch5(def, ctx) {
  const original = crypto.randomInt;
  try {
    crypto.randomInt = () => 6;
    const s = def.create(ctx);
    let actions = 0;
    while (s.phase === 'play' && actions < 3000) {
      const pid = s.seats[s.turn], v = def.view(s, pid);
      let action;
      if (def.id === 'dots-boxes') action = { edge: v.legal[0] };
      else if (def.id === 'pig-dice') action = s.turnTotal >= s.target ? { hold: true } : { roll: true };
      else if (def.id === 'snakes-ladders') action = { roll: true };
      else action = { cell: v.legal[(actions * 13) % v.legal.length] };
      const rev = s.rev;
      def.onAction(s, ctx, pid, { ...action, rev });
      if (s.rev !== rev + 1) throw Error(def.id + ': legal action did not advance');
      if (def.view(s, 'watcher').legal.length) throw Error('Watcher received moves');
      actions++;
    }
    if (s.phase !== 'done') throw Error(def.id + ': match did not finish');
    if (!Object.values(s.scores).some(n => n > 0)) throw Error('No match points');
    return `${actions} legal actions to a natural finish; match scores and watcher projection`;
  } finally { crypto.randomInt = original; }
}

module.exports = { playBatch5 };
