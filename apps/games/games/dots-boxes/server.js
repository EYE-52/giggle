'use strict';

const { paceSetting, moveTimerSetting } = require('../_sdk');
const { createBoardGame } = require('../engines/batch5-board');
const id = 'dots-boxes';
const manifest = {
  name: 'Dots & Boxes', tagline: 'One little line. One big chain.',
  howto: 'Take turns joining two neighbouring dots. Close the fourth side of a box to claim it and move again. Most boxes wins; tied players share their place. Choose 4×4, 5×5 or 6×6 boxes. Two to four play and everyone else watches. In a two-player match you can resign or offer a draw. A move timeout or leaving forfeits your seat.',
  guide: {
    goal: 'Close more boxes than anyone else.',
    controls: [{ keys: ['Tab', 'Enter'], touch: 'Tap a line', does: 'Join two neighbouring dots' }],
    tips: ['Close a box and take another move.', 'Avoid giving away the third side of a box.', 'One line can close two boxes at once.'],
  },
  cat: 'board', renderer: 'svg', layout: 'immersive', realtime: false,
  players: { min: 2, max: 24 }, seats: 4, art: 'img/games/dots-boxes.png',
  settings: [paceSetting(), moveTimerSetting(), { key: 'boardSize', label: 'Boxes', type: 'enum', options: ['4×4', '5×5', '6×6'], def: '4×4' }],
};

function borders(n, box) {
  const row = Math.floor(box / n), col = box % n, offset = n * (n + 1);
  return [row * n + col, (row + 1) * n + col, offset + row * (n + 1) + col, offset + row * (n + 1) + col + 1];
}

module.exports = createBoardGame({
  id, manifest,
  init(s, ctx) {
    s.size = ({ '4×4': 4, '5×5': 5, '6×6': 6 })[ctx.settings().boardSize] || 4;
    s.edges = Array(2 * s.size * (s.size + 1)).fill(0);
    s.boxes = Array(s.size * s.size).fill(0);
    s.counts = Object.fromEntries(s.seats.map(pid => [pid, 0]));
  },
  legal: s => s.edges.flatMap((owner, i) => owner ? [] : [i]),
  value: (s, pid) => s.counts[pid],
  project: s => ({ size: s.size, edges: s.edges, boxes: s.boxes, counts: s.counts }),
  move(s, ctx, a, h) {
    if (!Number.isInteger(a.edge) || a.edge < 0 || a.edge >= s.edges.length || s.edges[a.edge]) return false;
    s.edges[a.edge] = s.turn + 1;
    const claimed = [];
    s.boxes.forEach((owner, box) => {
      if (!owner && borders(s.size, box).every(edge => s.edges[edge])) {
        s.boxes[box] = s.turn + 1;
        s.counts[s.seats[s.turn]]++;
        claimed.push(box);
      }
    });
    s.lastMove = { edge: a.edge, side: s.turn, claimed };
    if (s.boxes.every(Boolean)) h.rankFinish(s, ctx, 'boxes');
    else if (!claimed.length) h.next(s);
    return true;
  },
});
