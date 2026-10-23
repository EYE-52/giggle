'use strict';
// An 8×8 capture game. Every accepted turn advances the view revision;
// no client-computed flips or scores enter the authoritative board.
const duel = require('../engines/board-duel');
const id = 'reversi';
const DIRECTIONS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const manifest = {
  name: 'Reversi', tagline: 'Turn the table, one disc at a time',
  howto: 'Charcoal moves first. Place a disc on a legal dot to trap ivory discs between yours, in any straight line. All trapped discs flip. If you have no move, your turn passes automatically. When neither player can move, the most discs wins. You can resign or offer a draw. With a move timer, running out of time loses the game. Two play; everyone else watches.',
  cat: 'board', renderer: 'svg', layout: 'immersive', runtime: { type: 'module', waitForResult: true },
  realtime: false, players: { min: 2, max: 24 }, seats: 2, art: 'img/games/reversi.svg',
  settings: [{ ...duel.MOVE_TIMER_SETTING }],
};
function create(ctx) {
  const players = ctx.allPlayers();
  const board = Array(64).fill(0);
  board[27] = board[36] = 2; board[28] = board[35] = 1;
  const s = { phase: 'play', board, seats: [players[0]?.id || null, players[1]?.id || null],
    turn: 1, rev: 0, turnNo: 0, lastMove: null, result: null, scores: {},
    drawOffer: null, drawBlocked: null, moveTimerMs: duel.moveTimerMs(ctx), endsAt: null };
  duel.armMoveTimer(s, ctx);
  return s;
}
function captures(board, cell, side) {
  if (!Number.isInteger(cell) || cell < 0 || cell >= 64 || board[cell] !== 0) return [];
  const row = Math.floor(cell / 8), col = cell % 8, other = 3 - side, flips = [];
  for (const [dy, dx] of DIRECTIONS) {
    let y = row + dy, x = col + dx;
    const line = [];
    while (y >= 0 && y < 8 && x >= 0 && x < 8 && board[y * 8 + x] === other) {
      line.push(y * 8 + x); y += dy; x += dx;
    }
    if (line.length && y >= 0 && y < 8 && x >= 0 && x < 8 && board[y * 8 + x] === side) flips.push(...line);
  }
  return flips;
}
function legal(board, side) {
  const cells = [];
  for (let cell = 0; cell < 64; cell++) if (captures(board, cell, side).length) cells.push(cell);
  return cells;
}
function counts(board) { return [board.filter(x => x === 1).length, board.filter(x => x === 2).length]; }
function finish(state, ctx, winner, reason) {
  if (state.phase === 'done') return;
  state.phase = 'done'; state.endsAt = null; state.drawOffer = null;
  const winnerPid = winner ? state.seats[winner - 1] : null;
  state.result = { winner, winnerPid, reason, counts: counts(state.board) };
  duel.awardAll(state, ctx, duel.duelPoints(state.seats, winnerPid));
}
function bump(state) { state.rev++; state.turnNo = state.rev; }
function onAction(state, ctx, pid, action) {
  if (state.phase !== 'play' || !action || typeof action !== 'object' || Array.isArray(action) ||
      !Number.isSafeInteger(action.rev) || action.rev !== state.rev) return false;
  const side = state.seats.indexOf(pid) + 1;
  if (!side) return false;
  if (duel.moveTimedOut(state, ctx)) { bump(state); finish(state, ctx, 3 - state.turn, 'timeout'); return; }
  if (action.resign === true) { bump(state); finish(state, ctx, 3 - side, 'resign'); return; }
  const offer = duel.drawAction(state, pid, action);
  if (offer === 'accept') { bump(state); finish(state, ctx, null, 'agreement'); return; }
  if (offer) { state.rev++; return; }
  if (side !== state.turn) return false;
  const flips = captures(state.board, action.place, side);
  if (!flips.length) return false;
  state.board[action.place] = side;
  for (const cell of flips) state.board[cell] = side;
  bump(state); duel.clearDrawOffer(state);
  state.lastMove = { cell: action.place, side, flips, rev: state.rev, passed: null };
  const other = 3 - side;
  if (legal(state.board, other).length) state.turn = other;
  else if (legal(state.board, side).length) {
    state.turn = side; state.lastMove.passed = other;
  } else {
    const [charcoal, ivory] = counts(state.board);
    finish(state, ctx, charcoal === ivory ? null : charcoal > ivory ? 1 : 2, 'complete');
  }
  if (state.phase === 'play') duel.armMoveTimer(state, ctx);
}
/* The move timer ran out: the player to move loses on time. */
function onTick(state, ctx) {
  if (!duel.moveTimedOut(state, ctx)) return;
  bump(state); finish(state, ctx, 3 - state.turn, 'timeout'); ctx.broadcast();
}
/* Room hook: a seated player left or stayed away 60 s — they forfeit. */
function onPlayerGone(state, ctx, pid) {
  const side = state.seats.indexOf(pid) + 1;
  if (!side || state.phase === 'done') return false;
  bump(state); finish(state, ctx, 3 - side, 'forfeit');
  return true;
}
function view(state, pid) {
  const youAre = state.seats.indexOf(pid) + 1 || null;
  return { phase: state.phase, board: state.board.slice(), seats: state.seats.slice(), turn: state.turn,
    rev: state.rev, turnNo: state.turnNo, youAre, counts: counts(state.board),
    legal: state.phase === 'play' && youAre === state.turn ? legal(state.board, state.turn) : [],
    lastMove: state.lastMove ? { ...state.lastMove, flips: state.lastMove.flips.slice() } : null,
    result: state.result ? { ...state.result, counts: state.result.counts.slice() } : null,
    scores: { ...state.scores }, drawOffer: state.drawOffer, drawBlocked: state.drawBlocked || null,
    endsAt: state.endsAt, moveTimerMs: state.moveTimerMs };
}
module.exports = { id, manifest, minPlayers: 2, maxPlayers: 24, create, onAction, onTick, onPlayerGone, view };
