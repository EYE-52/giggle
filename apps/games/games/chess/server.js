'use strict';
/* Chess: two active seats (first two roster members, white then black),
 * everyone else watches via the framework seat cap. All rules — legal
 * moves, turn ownership, promotion, check, checkmate, stalemate, draws —
 * come from the pinned chess.js library (BSD-2-Clause); this module owns
 * only seats, clocks, resignation, and the per-player projection. */

const { Chess } = require('chess.js');
const duel = require('../engines/board-duel');

const id = 'chess';

const manifest = {
  name: 'Chess',
  tagline: 'Two seats, full rules, watchers welcome',
  howto: 'The first two players take white and black; everyone else watches. Tap a piece to see its legal moves, then tap a destination. Pawns promote with a chooser. You can resign or offer a draw. With a time control or a move timer, running out of time loses the game.',
  cat: 'board',
  renderer: 'dom',
  layout: 'immersive',
  runtime: { type: 'module', waitForResult: true },
  realtime: false,
  players: { min: 2, max: 24 },
  seats: 2, // only white + black act; other room members watch
  art: 'img/games/chess.svg',
  settings: [
    { key: 'timeControl', label: 'Time control', type: 'enum',
      options: ['Off', '3 minutes', '5 minutes', '10 minutes'], def: 'Off' },
    { ...duel.MOVE_TIMER_SETTING },
    { key: 'boardTheme', label: 'Board appearance', type: 'enum',
      options: ['Mono', 'Blue', 'Green'], def: 'Mono' },
  ],
};

const TIME_MS = {
  Off: 0,
  '3 minutes': 3 * 60 * 1000,
  '5 minutes': 5 * 60 * 1000,
  '10 minutes': 10 * 60 * 1000,
};
const SQ_RE = /^[a-h][1-8]$/;
const PROMO_RE = /^[nbrq]$/;

function settingsOf(ctx) {
  const s = (ctx.settings ? ctx.settings() : {}) || {};
  // 'Untimed' is the pre-standard name of 'Off' (older stored configs).
  const wantTime = s.timeControl === 'Untimed' ? 'Off' : s.timeControl;
  const timeControl = TIME_MS[wantTime] !== undefined ? wantTime : 'Off';
  /* Pre-D7 palette names map deliberately to the matching new board so
   * an older stored config still renders (never exposed as options). */
  const legacyBoard = { Violet: 'Blue', Mint: 'Green', Monochrome: 'Mono' };
  const wantBoard = legacyBoard[s.boardTheme] || s.boardTheme;
  const boardTheme = ['Mono', 'Blue', 'Green'].includes(wantBoard) ? wantBoard : 'Mono';
  return { timeControl, boardTheme };
}

function create(ctx) {
  const seating = ctx.allPlayers(); // active roster: exactly the two seats
  const { timeControl, boardTheme } = settingsOf(ctx);
  const startMs = TIME_MS[timeControl];
  const state = {
    phase: 'play', // play -> done
    white: seating[0] ? seating[0].id : null,
    black: seating[1] ? seating[1].id : null,
    chess: new Chess(), // server-only; stripped from every view
    lastMove: null, // {from,to,san}
    result: null, // {outcome, detail, winner:'w'|'b'|null, winnerPid}
    clocks: startMs ? { w: startMs, b: startMs } : null,
    clockStamp: ctx.now(),
    timeControl,
    boardTheme,
    scores: {},
    drawOffer: null, // pid whose draw offer waits for an answer
    drawBlocked: null,
    moveTimerMs: duel.moveTimerMs(ctx),
    endsAt: null, // per-move deadline when the Move timer is on
  };
  duel.armMoveTimer(state, ctx);
  return state;
}

/* Charge elapsed wall time to the side to move. Returns true when a flag
 * fell (and finishes the game). Untimed games never expire. */
function tickClock(state, ctx) {
  if (state.phase !== 'play' || !state.clocks) {
    state.clockStamp = ctx.now();
    return flagged(state, ctx, state.chess.turn());
  }
  const now = ctx.now();
  const dt = Math.max(0, now - state.clockStamp);
  state.clockStamp = now;
  const turn = state.chess.turn();
  state.clocks[turn] = Math.max(0, state.clocks[turn] - dt);
  return flagged(state, ctx, turn);
}

/* Either clock reaching zero (time control or move timer) loses on time. */
function flagged(state, ctx, turn) {
  if (state.phase !== 'play') return false;
  if (duel.moveTimedOut(state, ctx)) {
    finish(state, ctx, {
      outcome: 'timeout',
      detail: (turn === 'w' ? 'White' : 'Black') + ' ran out of time',
      winner: turn === 'w' ? 'b' : 'w',
    });
    return true;
  }
  if (!state.clocks) return false;
  if (state.clocks[turn] <= 0) {
    finish(state, ctx, {
      outcome: 'timeout',
      detail: (turn === 'w' ? 'White' : 'Black') + ' flagged',
      winner: turn === 'w' ? 'b' : 'w',
    });
    return true;
  }
  return false;
}

function finish(state, ctx, result) {
  if (state.phase === 'done') return;
  state.phase = 'done';
  state.endsAt = null;
  state.drawOffer = null;
  result.winnerPid = result.winner === 'w' ? state.white
    : result.winner === 'b' ? state.black : null;
  state.result = result;
  // Match points: a win is 300, a draw gives 150 to each player.
  duel.awardAll(state, ctx, duel.duelPoints([state.white, state.black], result.winnerPid));
}

/* Map the chess.js terminal state to a result, or null when play continues. */
function terminalResult(chess, mover) {
  if (chess.isCheckmate()) return { outcome: 'checkmate', detail: 'Checkmate', winner: mover };
  if (chess.isStalemate()) return { outcome: 'stalemate', detail: 'Stalemate', winner: null };
  if (chess.isThreefoldRepetition()) return { outcome: 'draw', detail: 'Draw by threefold repetition', winner: null };
  if (chess.isInsufficientMaterial()) return { outcome: 'draw', detail: 'Draw by insufficient material', winner: null };
  if (chess.isDraw()) return { outcome: 'draw', detail: 'Draw by the fifty-move rule', winner: null };
  return null;
}

function ownerOf(state, side) {
  return side === 'w' ? state.white : state.black;
}

function onAction(state, ctx, pid, a) {
  if (!a || typeof a !== 'object') return;
  if (tickClock(state, ctx)) return; // flag fell before this action
  if (state.phase !== 'play') return;

  if (a.resign === true) {
    if (pid === state.white) finish(state, ctx, { outcome: 'resign', detail: 'White resigned', winner: 'b' });
    else if (pid === state.black) finish(state, ctx, { outcome: 'resign', detail: 'Black resigned', winner: 'w' });
    return;
  }
  if (pid === state.white || pid === state.black) {
    const offer = duel.drawAction(state, pid, a);
    if (offer === 'accept') { finish(state, ctx, { outcome: 'draw', detail: 'Draw agreed', winner: null }); return; }
    if (offer) return;
  }

  const mv = a.move;
  if (!mv || typeof mv !== 'object') return;
  if (typeof mv.from !== 'string' || typeof mv.to !== 'string') return;
  if (!SQ_RE.test(mv.from) || !SQ_RE.test(mv.to)) return;
  let promotion;
  if (mv.promotion !== undefined) {
    if (typeof mv.promotion !== 'string') return;
    const p = mv.promotion.toLowerCase();
    if (!PROMO_RE.test(p)) return;
    promotion = p;
  }
  // Turn ownership: only the side to move acts (spectators, watchers, and
  // the waiting player are all ignored).
  const side = state.chess.turn();
  if (pid !== ownerOf(state, side)) return;

  let made;
  try {
    made = state.chess.move({ from: mv.from, to: mv.to, promotion });
  } catch {
    return; // illegal move (or missing/invalid promotion): ignore silently
  }
  if (!made) return;
  state.lastMove = { from: made.from, to: made.to, san: made.san };
  state.clockStamp = ctx.now();
  duel.clearDrawOffer(state);
  const end = terminalResult(state.chess, side);
  if (end) finish(state, ctx, end);
  else duel.armMoveTimer(state, ctx);
}

/* Clock expiry while nobody acts (untimed games: no-op, no broadcast). */
function onTick(state, ctx) {
  if (state.phase !== 'play' || (!state.clocks && !state.endsAt)) return;
  if (tickClock(state, ctx)) ctx.broadcast();
}

/* Room hook: a seated player left or stayed away 60 s — they forfeit. */
function onPlayerGone(state, ctx, pid) {
  if (state.phase !== 'play' || (pid !== state.white && pid !== state.black)) return false;
  const white = pid === state.white;
  finish(state, ctx, { outcome: 'forfeit', detail: (white ? 'White' : 'Black') + ' left the game', winner: white ? 'b' : 'w' });
  return true;
}

function legalMap(chess) {
  const out = {};
  for (const m of chess.moves({ verbose: true })) {
    (out[m.from] = out[m.from] || []).push({
      to: m.to,
      promo: m.promotion ? true : undefined, // a chooser is required
      san: m.san,
    });
  }
  return out;
}

function view(state, pid) {
  const turn = state.chess.turn();
  const board = state.chess.board().map((row) => row.map((cell) =>
    (cell ? { s: cell.square, t: cell.type, c: cell.color } : null)));
  let checkSquare = null;
  const check = state.chess.isCheck();
  if (check) {
    for (const row of board) {
      for (const cell of row) {
        if (cell && cell.t === 'k' && cell.c === turn) checkSquare = cell.s;
      }
    }
  }
  return {
    phase: state.phase,
    white: state.white,
    black: state.black,
    youAre: pid === state.white ? 'w' : pid === state.black ? 'b' : null,
    turn,
    check,
    checkSquare,
    board,
    legal: legalMap(state.chess), // public in chess: same for every pid
    history: state.chess.history(),
    fen: state.chess.fen(),
    lastMove: state.lastMove,
    result: state.result,
    clocks: state.clocks ? { ...state.clocks } : null,
    clockStamp: state.clockStamp,
    timeControl: state.timeControl,
    boardTheme: state.boardTheme,
    scores: { ...state.scores },
    drawOffer: state.drawOffer,
    drawBlocked: state.drawBlocked || null,
    moveTimerMs: state.moveTimerMs,
    endsAt: state.endsAt,
  };
}

module.exports = {
  id, minPlayers: 2, maxPlayers: 24, manifest,
  create, onAction, onTick, onPlayerGone, view,
};
