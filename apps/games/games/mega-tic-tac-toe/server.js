'use strict';

const { paceSetting, moveTimerSetting } = require('../_sdk');
const { createBoardGame } = require('../engines/batch5-board');
const id = 'mega-tic-tac-toe';
const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const won = (board, side) => lines.some(line => line.every(i => board[i] === side));
const manifest = {
  name: 'Mega Tic-Tac-Toe', tagline: 'Win the small. Think big.',
  howto: 'Play X or O on nine small boards. The cell you choose sends your opponent to that small board. If that board is won or full, they may play on any open board. Win three cells in a row to claim a small board, then claim three small boards in a row to win. No moves left means a draw. You can resign or offer a draw. Running out of move time or leaving loses the match. Two play; everyone else watches.',
  guide: {
    goal: 'Win three small boards in a row.',
    controls: [{ keys: ['↑ ↓ ← →', 'Enter'], touch: 'Tap a cell', does: 'Place your X or O' }],
    tips: ['The bright rim marks the boards you can play on.', 'Your cell sends the next player to that small board.', 'A closed destination lets the next player go anywhere.'],
  },
  cat: 'board', renderer: 'svg', layout: 'immersive', realtime: false,
  players: { min: 2, max: 24 }, seats: 2, art: 'img/games/mega-tic-tac-toe.png',
  settings: [paceSetting(), moveTimerSetting()],
};

function legal(s) {
  return s.board.flatMap((owner, i) => !owner && !s.small[Math.floor(i / 9)] &&
    (s.forced < 0 || Math.floor(i / 9) === s.forced) ? [i] : []);
}

module.exports = createBoardGame({
  id, manifest,
  init(s) { s.board = Array(81).fill(0); s.small = Array(9).fill(0); s.forced = -1; },
  legal,
  project: s => ({ board: s.board, small: s.small, forced: s.forced }),
  move(s, ctx, a, h) {
    if (!Number.isInteger(a.cell) || !legal(s).includes(a.cell)) return false;
    const small = Math.floor(a.cell / 9), cell = a.cell % 9, side = s.turn + 1;
    s.board[a.cell] = side;
    const local = s.board.slice(small * 9, small * 9 + 9);
    if (won(local, side)) s.small[small] = side;
    else if (local.every(Boolean)) s.small[small] = 3;
    s.lastMove = { cell: a.cell, side: s.turn };
    s.forced = s.small[cell] ? -1 : cell;
    if (won(s.small, side)) h.finish(s, ctx, 'three-boards', [s.seats[s.turn]]);
    else if (!legal(s).length) h.finish(s, ctx, 'draw', s.seats);
    else h.next(s);
    return true;
  },
});
