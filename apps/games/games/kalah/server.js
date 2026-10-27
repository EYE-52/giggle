'use strict';

// One declared Kalah preset. The 14-slot ring conserves exactly 48 seeds.
const duel = require('../engines/board-duel');
const id = 'kalah';
const manifest = {
  name: 'Kalah', tagline: 'Sow a little. Steal a lot.', cat: 'board', renderer: 'svg',
  layout: 'immersive', runtime: { type: 'module', waitForResult: true }, realtime: false,
  players: { min: 2, max: 24 }, seats: 2, art: 'img/games/kalah.svg',
  howto: 'Two players each have six bowls and a score store. Every bowl starts with four seeds. Pick a non-empty bowl on your side to sow its seeds around the board, one at a time. Include your store and skip the other store. Finish in your store for another turn. Finish in an empty bowl on your side to capture that seed and the opposite bowl, if the opposite bowl contains seeds. When either side is empty, the other player adds their remaining seeds to their own store. Most seeds wins; 24 each is a draw. You can resign or offer a draw. With a move timer, running out of time loses the game. This is the six-bowl, four-seed Kalah preset of Mancala.',
  settings: [{ ...duel.MOVE_TIMER_SETTING }],
};
const storeOf = side => side ? 13 : 6;
const owns = (side, pit) => side ? pit >= 7 && pit <= 12 : pit >= 0 && pit <= 5;
const empty = (s, side) => s.pits.slice(side ? 7 : 0, side ? 13 : 6).every(n => n === 0);
function create(ctx) {
  const s = { phase: 'play', pits: [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0],
    seats: ctx.allPlayers().slice(0, 2).map(p => p.id), turn: 0, revision: 0,
    lastMove: null, endsAt: null, result: null, scores: {}, strings: ctx.content(id)?.strings || {},
    drawOffer: null, drawBlocked: null, moveTimerMs: duel.moveTimerMs(ctx) };
  duel.armMoveTimer(s, ctx);
  return s;
}
function finish(s, ctx, reason, winner) {
  if (s.phase === 'done') return;
  s.phase = 'done'; s.endsAt = null; s.drawOffer = null;
  s.result = { reason, winner, winnerPid: winner === null ? null : s.seats[winner] };
  duel.awardAll(s, ctx, duel.duelPoints(s.seats, s.result.winnerPid));
}
function onAction(s, ctx, pid, a) {
  if (!a || typeof a !== 'object' || Array.isArray(a) || s.phase !== 'play' || !Number.isInteger(a.revision) || a.revision !== s.revision) return;
  const side = s.seats.indexOf(pid);
  if (side < 0) return;
  if (duel.moveTimedOut(s, ctx)) { s.revision++; finish(s, ctx, 'timeout', 1 - s.turn); return; }
  if (a.resign === true) { s.revision++; finish(s, ctx, 'resign', 1 - side); return; }
  const offer = duel.drawAction(s, pid, a);
  if (offer === 'accept') { s.revision++; finish(s, ctx, 'agreement', null); return; }
  if (offer) { s.revision++; return; }
  if (side !== s.turn || !Number.isInteger(a.pit) || !owns(side, a.pit) || !s.pits[a.pit]) return;
  const before = s.pits.slice(), steps = [], captures = [], swept = [], store = storeOf(side);
  let seeds = s.pits[a.pit], to = a.pit;
  s.pits[to] = 0;
  while (seeds > 0) {
    to = (to + 1) % 14;
    if (to === storeOf(1 - side)) continue;
    s.pits[to]++; steps.push(to); seeds--;
  }
  const opposite = 12 - to;
  if (owns(side, to) && s.pits[to] === 1 && s.pits[opposite] > 0) {
    captures.push(to, opposite); s.pits[store] += s.pits[to] + s.pits[opposite]; s.pits[to] = s.pits[opposite] = 0;
  }
  s.revision++; duel.clearDrawOffer(s);
  const extra = to === store;
  if (empty(s, 0) || empty(s, 1)) {
    for (let pit = 0; pit < 14; pit++) if (pit !== 6 && pit !== 13 && s.pits[pit]) {
      swept.push(pit); s.pits[storeOf(pit > 6 ? 1 : 0)] += s.pits[pit]; s.pits[pit] = 0;
    }
    finish(s, ctx, 'collected', s.pits[6] === s.pits[13] ? null : s.pits[6] > s.pits[13] ? 0 : 1);
  } else if (!extra) s.turn = 1 - side;
  s.lastMove = { revision: s.revision, before, pit: a.pit, side, steps, captures, swept, extra: extra && s.phase === 'play' };
  if (s.phase === 'play') duel.armMoveTimer(s, ctx);
}
/* The move timer ran out: the player to move loses on time. */
function onTick(s, ctx) {
  if (!duel.moveTimedOut(s, ctx)) return;
  s.revision++; finish(s, ctx, 'timeout', 1 - s.turn); ctx.broadcast();
}
/* Room hook: a seated player left or stayed away 60 s — they forfeit. */
function onPlayerGone(s, ctx, pid) {
  const side = s.seats.indexOf(pid);
  if (side < 0 || s.phase === 'done') return false;
  s.revision++; finish(s, ctx, 'forfeit', 1 - side);
  return true;
}
function view(s, pid) {
  const seat = s.seats.indexOf(pid);
  const legal = s.phase === 'play' ? s.pits.map((n, pit) => owns(s.turn, pit) && n > 0 ? pit : -1).filter(pit => pit >= 0) : [];
  return { phase: s.phase, pits: s.pits.slice(), seats: s.seats.slice(), turn: s.turn,
    youAre: seat < 0 ? null : seat, legal, revision: s.revision, endsAt: s.endsAt, moveTimerMs: s.moveTimerMs,
    drawOffer: s.drawOffer, drawBlocked: s.drawBlocked || null,
    lastMove: s.lastMove ? { ...s.lastMove, before: s.lastMove.before.slice(), steps: s.lastMove.steps.slice(), captures: s.lastMove.captures.slice(), swept: s.lastMove.swept.slice() } : null,
    result: s.result ? { ...s.result } : null, scores: { ...s.scores }, strings: s.strings };
}
module.exports = { id, minPlayers: 2, maxPlayers: 24, manifest, create, onAction, onTick, onPlayerGone, view };
