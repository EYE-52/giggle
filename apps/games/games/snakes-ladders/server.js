'use strict';

const crypto = require('node:crypto');
const { paceSetting } = require('../_sdk');
const { createBoardGame } = require('../engines/batch5-board');
const id = 'snakes-ladders';
// Original garden trail: eight climbs and eight slides, all endpoints unique.
const LADDERS = { 3: 26, 11: 34, 18: 39, 29: 52, 42: 63, 56: 78, 67: 88, 81: 97 };
const SNAKES = { 23: 6, 37: 16, 49: 31, 61: 44, 73: 54, 84: 65, 93: 72, 99: 86 };
const manifest = {
  name: 'Snakes & Ladders', tagline: 'A garden full of ups and downs.',
  howto: 'Roll one die and follow the winding trail to 100. Land at the foot of a ladder to climb, or on a snake head to slide. By default any roll reaching 100 finishes. Turn on Exact finish to bounce backwards by the overshoot instead. Places follow finishing order. The server auto-rolls after 15 seconds; Pace changes this timer. Leaving forfeits your seat. With two players you can resign or offer a draw.',
  guide: {
    goal: 'Reach square 100 before the other explorers.',
    controls: [{ keys: ['Tab', 'Enter'], touch: 'Roll the die', does: 'Move along the garden trail' }],
    tips: ['Ladders lift you; snakes send you down.', 'The timer rolls for you if you wait.', 'With Exact finish on, extra steps bounce back from 100.'],
  },
  cat: 'board', renderer: 'svg', layout: 'immersive', realtime: false,
  players: { min: 2, max: 24 }, seats: 6, art: 'img/games/snakes-ladders.png',
  settings: [paceSetting(), { key: 'exactFinish', label: 'Exact finish', type: 'bool', def: false }],
};

function settle(s, ctx, h) {
  const remaining = h.active(s).filter(pid => !s.finished.includes(pid));
  if (remaining.length > 1) return false;
  if (remaining.length) s.finished.push(remaining[0]);
  const ranks = s.finished.map((pid, i) => ({ pid, rank: i + 1, value: s.finished.length - i }));
  h.finish(s, ctx, 'finish', s.finished.slice(0, 1), ranks);
  return true;
}

function roll(s, ctx, h, auto = false) {
  const pid = s.seats[s.turn], from = s.positions[pid];
  s.die = crypto.randomInt(1, 7);
  const reached = from + s.die;
  let landing = reached > 100 && s.exactFinish ? 200 - reached : Math.min(100, reached);
  const to = LADDERS[landing] || SNAKES[landing] || landing;
  s.positions[pid] = to;
  s.lastMove = { side: s.turn, die: s.die, from, landing, to, auto };
  if (to === 100) s.finished.push(pid);
  if (!settle(s, ctx, h)) h.next(s);
}

module.exports = createBoardGame({
  id, manifest, timerSeconds: 15,
  init(s, ctx) {
    s.positions = Object.fromEntries(s.seats.map(pid => [pid, 0]));
    s.finished = []; s.die = null; s.exactFinish = ctx.settings().exactFinish === true;
  },
  legal: () => ['roll'],
  project: s => ({ positions: s.positions, finished: s.finished, die: s.die, exactFinish: s.exactFinish, snakes: SNAKES, ladders: LADDERS }),
  move(s, ctx, a, h) { if (a.roll !== true) return false; roll(s, ctx, h); return true; },
  timeout(s, ctx, h) { roll(s, ctx, h, true); },
  gone(s, ctx, pid, h) { if (!settle(s, ctx, h) && s.seats[s.turn] === pid) h.next(s); },
});
