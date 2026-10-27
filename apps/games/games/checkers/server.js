'use strict';

// English draughts: short kings, forward men, mandatory captures and crown-stop.
const duel = require('../engines/board-duel');
const id = 'checkers';
const manifest = {
  name: 'Checkers', tagline: 'Set a trap. Make a king.', cat: 'board', renderer: 'svg',
  layout: 'immersive', runtime: { type: 'module', waitForResult: true }, realtime: false,
  players: { min: 2, max: 24 }, seats: 2, art: 'img/games/checkers.svg',
  howto: 'Two players take red and charcoal; friends can watch. English rules: men move and jump diagonally forward; kings move and jump in both directions without flying. Captures are compulsory, and further jumps must use the same piece. Choose any available capture path. Reaching the far edge makes a king and ends the turn. Win when your opponent has no pieces or no legal moves. Repeated positions three times or 40 turns each without a capture or a man moving draw the game. You can also resign or agree to a draw. With a move timer, running out of time loses the game.',
  settings: [{ ...duel.MOVE_TIMER_SETTING }],
};
const sideOf = p => p ? (p - 1) % 2 : -1;
const king = p => p > 2;
const valid = i => Number.isInteger(i) && i >= 0 && i < 64;
const at = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8 ? r * 8 + c : -1;

function jumps(board, from) {
  const p = board[from], side = sideOf(p), r = Math.floor(from / 8), c = from % 8;
  if (!p) return [];
  const out = [];
  for (const dr of king(p) ? [-1, 1] : [side ? 1 : -1]) for (const dc of [-1, 1]) {
    const over = at(r + dr, c + dc), to = at(r + 2 * dr, c + 2 * dc);
    if (to >= 0 && over >= 0 && !board[to] && board[over] && sideOf(board[over]) !== side) out.push({ to, capture: over });
  }
  return out;
}

function legalMoves(state) {
  if (state.phase !== 'play') return {};
  if (state.forced !== null) return { [state.forced]: jumps(state.board, state.forced) };
  const captures = {}, ordinary = {};
  for (let from = 0; from < 64; from++) {
    const p = state.board[from];
    if (!p || sideOf(p) !== state.turn) continue;
    const js = jumps(state.board, from);
    if (js.length) captures[from] = js;
    const r = Math.floor(from / 8), c = from % 8;
    for (const dr of king(p) ? [-1, 1] : [state.turn ? 1 : -1]) for (const dc of [-1, 1]) {
      const to = at(r + dr, c + dc);
      if (to >= 0 && !state.board[to]) (ordinary[from] ||= []).push({ to, capture: null });
    }
  }
  return Object.keys(captures).length ? captures : ordinary;
}

const position = s => s.turn + ':' + s.board.join('');
function create(ctx) {
  const board = Array(64).fill(0);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 && (r < 3 || r > 4)) board[r * 8 + c] = r < 3 ? 2 : 1;
  const s = { phase: 'play', board, seats: ctx.allPlayers().slice(0, 2).map(p => p.id),
    turn: 0, forced: null, revision: 0, noProgress: 0, repetition: {},
    endsAt: null, result: null, lastMove: null, drawOffer: null, drawBlocked: null, scores: {}, strings: ctx.content(id)?.strings || {},
    moveTimerMs: duel.moveTimerMs(ctx) };
  s.repetition[position(s)] = 1;
  duel.armMoveTimer(s, ctx);
  return s;
}
function finish(s, ctx, reason, winner) {
  if (s.phase === 'done') return;
  s.phase = 'done'; s.endsAt = null; s.forced = null; s.drawOffer = null;
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
  if (side !== s.turn || !valid(a.from) || !valid(a.to)) return;
  const m = (legalMoves(s)[a.from] || []).find(m => m.to === a.to);
  if (!m) return;
  const before = s.board.slice(), piece = s.board[a.from];
  s.board[a.from] = 0; s.board[a.to] = piece;
  if (m.capture !== null) s.board[m.capture] = 0;
  const crowned = !king(piece) && Math.floor(a.to / 8) === (side ? 7 : 0);
  if (crowned) s.board[a.to] += 2;
  s.revision++; duel.clearDrawOffer(s);
  s.lastMove = { revision: s.revision, before, from: a.from, to: a.to, capture: m.capture, crowned, side };
  // A jump is one atomic revision. A second jump is legal only from this piece.
  if (m.capture !== null && !crowned && jumps(s.board, a.to).length) { s.forced = a.to; duel.armMoveTimer(s, ctx); return; }
  s.forced = null;
  s.noProgress = m.capture !== null || !king(piece) ? 0 : s.noProgress + 1;
  if (m.capture !== null || !king(piece)) s.repetition = {};
  s.turn = 1 - side;
  if (!Object.keys(legalMoves(s)).length) { finish(s, ctx, 'blocked', side); return; }
  const key = position(s); s.repetition[key] = (s.repetition[key] || 0) + 1;
  if (s.repetition[key] >= 3) finish(s, ctx, 'repetition', null);
  else if (s.noProgress >= 80) finish(s, ctx, 'no-progress', null);
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
  return { phase: s.phase, board: s.board.slice(), seats: s.seats.slice(), turn: s.turn,
    youAre: seat < 0 ? null : seat, forced: s.forced, legal: legalMoves(s), revision: s.revision,
    lastMove: s.lastMove ? { ...s.lastMove, before: s.lastMove.before.slice() } : null,
    result: s.result ? { ...s.result } : null, drawOffer: s.drawOffer, drawBlocked: s.drawBlocked || null, scores: { ...s.scores },
    endsAt: s.endsAt, moveTimerMs: s.moveTimerMs, strings: s.strings };
}
module.exports = { id, minPlayers: 2, maxPlayers: 24, manifest, create, onAction, onTick, onPlayerGone, view };
