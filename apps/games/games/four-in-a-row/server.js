'use strict';
// Gravity and line checks run entirely on the server. A revision is mandatory
// even when the Room compatibility layer accepts an older missing window token.
const duel = require('../engines/board-duel');
const id = 'four-in-a-row';
const manifest = {
  name: 'Four in a Row', tagline: 'Drop a counter. Set a trap.',
  howto: 'Red goes first. Drop a counter into any open column. The first four in a straight line — across, up, or diagonally — wins. A full board without four is a draw. You can resign or offer a draw. With a move timer, running out of time loses the game. Two play; everyone else watches.',
  cat: 'board', renderer: 'svg', layout: 'immersive', runtime: { type: 'module', waitForResult: true },
  realtime: false, players: { min: 2, max: 24 }, seats: 2, art: 'img/games/four-in-a-row.svg',
  settings: [{ ...duel.MOVE_TIMER_SETTING }],
};
function create(ctx) {
  const players = ctx.allPlayers();
  const s = { phase: 'play', board: Array(42).fill(0), seats: [players[0]?.id || null, players[1]?.id || null],
    turn: 1, rev: 0, turnNo: 0, lastMove: null, result: null, winning: [], scores: {},
    drawOffer: null, drawBlocked: null, moveTimerMs: duel.moveTimerMs(ctx), endsAt: null };
  duel.armMoveTimer(s, ctx);
  return s;
}
function openColumns(board) { return Array.from({ length: 7 }, (_, col) => col).filter(col => board[col] === 0); }
function winningLine(board, row, col, side) {
  for (const [dy, dx] of [[0,1],[1,0],[1,1],[1,-1]]) {
    const line = [row * 7 + col];
    for (const sign of [-1, 1]) {
      let y = row + dy * sign, x = col + dx * sign;
      while (y >= 0 && y < 6 && x >= 0 && x < 7 && board[y * 7 + x] === side) {
        line.push(y * 7 + x); y += dy * sign; x += dx * sign;
      }
    }
    if (line.length >= 4) return line.sort((a, b) => a - b);
  }
  return [];
}
function finish(state, ctx, winner, reason) {
  if (state.phase === 'done') return;
  state.phase = 'done'; state.endsAt = null; state.drawOffer = null;
  const winnerPid = winner ? state.seats[winner - 1] : null;
  state.result = { winner, winnerPid, reason };
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
  const col = action.drop;
  if (side !== state.turn || !Number.isInteger(col) || col < 0 || col >= 7 || state.board[col] !== 0) return false;
  let row = 5;
  while (row > 0 && state.board[row * 7 + col] !== 0) row--;
  state.board[row * 7 + col] = side;
  bump(state); duel.clearDrawOffer(state);
  state.lastMove = { row, col, side, rev: state.rev };
  state.winning = winningLine(state.board, row, col, side);
  if (state.winning.length) finish(state, ctx, side, 'four');
  else if (!openColumns(state.board).length) finish(state, ctx, null, 'draw');
  else { state.turn = 3 - side; duel.armMoveTimer(state, ctx); }
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
    rev: state.rev, turnNo: state.turnNo, youAre,
    legal: state.phase === 'play' && youAre === state.turn ? openColumns(state.board) : [],
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    winning: state.winning.slice(), result: state.result ? { ...state.result } : null,
    scores: { ...state.scores }, drawOffer: state.drawOffer, drawBlocked: state.drawBlocked || null,
    endsAt: state.endsAt, moveTimerMs: state.moveTimerMs };
}
module.exports = { id, manifest, minPlayers: 2, maxPlayers: 24, create, onAction, onTick, onPlayerGone, view };
