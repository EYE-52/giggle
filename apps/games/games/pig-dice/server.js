'use strict';

const crypto = require('node:crypto');
const { paceSetting } = require('../_sdk');
const { createBoardGame } = require('../engines/batch5-board');
const id = 'pig-dice';
const manifest = {
  name: 'Pig Dice', tagline: 'One more roll? Famous last words.',
  howto: 'Roll to add to your turn total. A 1 loses that total and ends your turn. Hold to bank it safely. Reach the target of 50 or 100 to start the final round: everyone gets the same number of turns. Highest banked total wins, with equal totals sharing a place. Your 30-second turn timer auto-holds and Pace changes its length. The server rolls the die. Leaving forfeits your seat. With two players you can resign or offer a draw.',
  guide: {
    goal: 'Bank the most points by the end of the final round.',
    controls: [{ keys: ['Tab', 'Enter'], touch: 'Roll or Hold', does: 'Risk the total or bank it' }],
    tips: ['A 1 loses only the points from this turn.', 'Hold before the timer runs out to bank safely.', 'Reaching the target gives every seat one equal final chance.'],
  },
  cat: 'board', renderer: 'dom', layout: 'immersive', realtime: false,
  players: { min: 2, max: 12 }, seats: 12, art: 'img/games/pig-dice.png',
  settings: [paceSetting(), { key: 'target', label: 'Target', type: 'enum', options: ['50', '100'], def: '100' }],
};

function endTurn(s, ctx, h, bank) {
  const pid = s.seats[s.turn];
  if (bank) s.banked[pid] += s.turnTotal;
  s.turns[pid]++;
  s.turnTotal = 0;
  if (s.banked[pid] >= s.target) s.finalRound = s.roundNo;
  const wrapped = h.next(s);
  if (wrapped) {
    if (s.finalRound !== null) h.rankFinish(s, ctx, 'target');
    else s.roundNo++;
  }
}

module.exports = createBoardGame({
  id, manifest, timerSeconds: 30,
  init(s, ctx) {
    s.target = ctx.settings().target === '50' ? 50 : 100;
    s.banked = Object.fromEntries(s.seats.map(pid => [pid, 0]));
    s.turns = Object.fromEntries(s.seats.map(pid => [pid, 0]));
    s.turnTotal = 0; s.die = null; s.roundNo = 1; s.finalRound = null;
  },
  legal: () => ['roll', 'hold'],
  value: (s, pid) => s.banked[pid],
  project: s => ({ target: s.target, banked: s.banked, turns: s.turns, turnTotal: s.turnTotal, die: s.die, roundNo: s.roundNo, finalRound: s.finalRound }),
  move(s, ctx, a, h) {
    if (a.hold === true) {
      s.lastMove = { side: s.turn, hold: true, banked: s.turnTotal };
      endTurn(s, ctx, h, true);
      return true;
    }
    if (a.roll !== true) return false;
    s.die = crypto.randomInt(1, 7);
    s.lastMove = { side: s.turn, die: s.die };
    if (s.die === 1) { endTurn(s, ctx, h, false); return true; }
    s.turnTotal += s.die;
    return 'same-window'; // Rolling never buys more time.
  },
  timeout(s, ctx, h) {
    s.lastMove = { side: s.turn, hold: true, auto: true, banked: s.turnTotal };
    endTurn(s, ctx, h, true);
  },
  gone(s, ctx, pid, h) {
    if (s.seats[s.turn] !== pid) return;
    s.turnTotal = 0;
    const wrapped = h.next(s);
    if (wrapped && s.finalRound !== null) h.rankFinish(s, ctx, 'target');
    else if (wrapped) s.roundNo++;
  },
});
