'use strict';

const { paceSetting, moveTimerSetting } = require('../_sdk');
const { createBoardGame } = require('../engines/batch5-board');
const id = 'five-row';
const manifest = {
  name: 'Five in a Row', tagline: 'Five stones. A thousand traps.',
  howto: 'Black places the first stone on a 15×15 board. Take turns placing a stone on an empty intersection. Exactly five stones in a straight line wins; six or more does not count. With the swap rule on, White may swap colours instead of placing the second stone. The new White plays next. A full board is a draw. You can resign or offer a draw. Running out of move time or leaving loses the match. Two play; everyone else watches.',
  guide: {
    goal: 'Make exactly five stones in a straight line.',
    controls: [{ keys: ['↑ ↓ ← →', 'Enter'], touch: 'Tap a point', does: 'Place a stone' }],
    tips: ['Black plays first.', 'Six or more stones in one line does not win.', 'White can swap colours just after the opening move.'],
  },
  cat: 'board', renderer: 'svg', layout: 'immersive', realtime: false,
  players: { min: 2, max: 24 }, seats: 2, art: 'img/games/five-row.png',
  settings: [paceSetting(), moveTimerSetting(), { key: 'swapRule', label: 'Swap rule', type: 'bool', def: true }],
};

function five(board, cell, colour) {
  const row = Math.floor(cell / 15), col = cell % 15;
  for (const [dy, dx] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const line = [cell];
    for (const sign of [-1, 1]) {
      let y = row + dy * sign, x = col + dx * sign;
      while (y >= 0 && y < 15 && x >= 0 && x < 15 && board[y * 15 + x] === colour) {
        line.push(y * 15 + x); y += dy * sign; x += dx * sign;
      }
    }
    if (line.length === 5) return line;
  }
  return [];
}

module.exports = createBoardGame({
  id, manifest,
  init(s, ctx) {
    s.board = Array(225).fill(0); s.colours = [1, 2]; s.moves = 0;
    s.swapRule = ctx.settings().swapRule !== false; s.swapAvailable = false; s.winning = [];
  },
  legal: s => s.board.flatMap((owner, i) => owner ? [] : [i]),
  project: s => ({ board: s.board, colours: s.colours, moves: s.moves, swapAvailable: s.swapAvailable, winning: s.winning }),
  move(s, ctx, a, h) {
    if (a.swap === true) {
      if (!s.swapAvailable || s.turn !== 1) return false;
      s.colours.reverse(); s.swapAvailable = false;
      s.lastMove = { swap: true, side: s.turn, cell: s.lastMove.cell, colour: 1 };
      h.next(s);
      return true;
    }
    if (!Number.isInteger(a.cell) || a.cell < 0 || a.cell >= 225 || s.board[a.cell]) return false;
    const colour = s.colours[s.turn];
    s.board[a.cell] = colour; s.moves++;
    s.swapAvailable = s.swapRule && s.moves === 1;
    s.lastMove = { cell: a.cell, side: s.turn, colour };
    s.winning = five(s.board, a.cell, colour);
    if (s.winning.length) h.finish(s, ctx, 'five', [s.seats[s.turn]]);
    else if (s.moves === 225) h.finish(s, ctx, 'draw', s.seats);
    else h.next(s);
    return true;
  },
});
