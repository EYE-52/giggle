'use strict';
/* Shared rules for the Game Night board games (Chess, Checkers, Reversi,
 * Four in a Row, Kalah, Fleet Duel, Ludo, Chain Reaction). One place for
 * the match points, the optional Move timer, the draw offer and the
 * placement ranking, so every board game follows GAME_RULES_STANDARD.md the
 * same way. Pure helpers: no transport, no clock of their own. */

const WIN_POINTS = 300;
const DRAW_POINTS = 150;
const PLACE_POINTS = [300, 200, 100, 0];

/* Move timer: Off (default), 30 or 60 seconds per move. */
const MOVE_TIMER_OPTIONS = { Off: 0, '30 seconds': 30000, '60 seconds': 60000 };
const MOVE_TIMER_SETTING = Object.freeze({
  key: 'moveTimer', label: 'Move timer', type: 'enum',
  options: Object.keys(MOVE_TIMER_OPTIONS), def: 'Off',
});

/* Gone players forfeit after this long (the room shell owns the countdown;
 * games implement def.onPlayerGone and never time it themselves). */
const GONE_FORFEIT_MS = 60000;

function moveTimerMs(ctx) {
  let s = {};
  try { s = (ctx && typeof ctx.settings === 'function' ? ctx.settings() : {}) || {}; } catch { s = {}; }
  return MOVE_TIMER_OPTIONS[s.moveTimer] || 0;
}

/* Arm (or clear) the per-move deadline on the shared `endsAt` field. */
function armMoveTimer(state, ctx) {
  state.endsAt = state.moveTimerMs > 0 && isLive(state) ? ctx.now() + state.moveTimerMs : null;
  return state.endsAt;
}

function isLive(state) {
  return !!state && state.phase !== 'done';
}

/* True once the active move timer ran out (callers end or skip the turn). */
function moveTimedOut(state, ctx) {
  return isLive(state) && Number.isFinite(state.endsAt) && state.endsAt > 0 && ctx.now() >= state.endsAt;
}

/* 2-player result → points per pid: winner 300, loser 0, a draw 150 each. */
function duelPoints(seats, winnerPid) {
  const out = {};
  for (const pid of seats) if (pid) out[pid] = winnerPid === null || winnerPid === undefined
    ? DRAW_POINTS : pid === winnerPid ? WIN_POINTS : 0;
  return out;
}

/* Award once, at match end, and keep the match scoreboard. */
function awardAll(state, ctx, points) {
  state.scores = { ...points };
  for (const [pid, n] of Object.entries(points)) if (n > 0) ctx.award(pid, n);
  return state.scores;
}

/* Competition ranking (1, 1, 3): `entries` = [{pid, value}] where a higher
 * value is better. Returns [{pid, value, rank}] best first. */
function competitionRanks(entries) {
  const sorted = entries.slice().sort((a, b) => b.value - a.value);
  return sorted.map((e, i) => ({ ...e, rank: i && sorted[i - 1].value === e.value ? null : i + 1 }))
    .map((e, i, all) => {
      if (e.rank === null) { let j = i; while (all[j].rank === null) j--; e.rank = all[j].rank; }
      return e;
    });
}

/* Places 300/200/100/0 by rank; tied players share the better place. */
function placePoints(ranked) {
  const out = {};
  for (const e of ranked) out[e.pid] = PLACE_POINTS[e.rank - 1] ?? 0;
  return out;
}

/* Draw offers for 2-player games. state.drawOffer = pid of the offer
 * waiting for an answer; state.drawBlocked = pid who may not offer again
 * until the next move (stops offer spam after a decline). Returns
 * 'offer' | 'accept' | 'decline' | null; the caller ends the game on
 * 'accept'. A move must call clearDrawOffer(). */
function drawAction(state, pid, action) {
  if (!isLive(state) || !action) return null;
  if (state.drawOffer === undefined) state.drawOffer = null;
  if (action.offerDraw === true) {
    if (state.drawOffer !== null || state.drawBlocked === pid) return null;
    state.drawOffer = pid;
    return 'offer';
  }
  if (action.acceptDraw === true) {
    if (state.drawOffer === null || state.drawOffer === pid) return null;
    state.drawOffer = null;
    return 'accept';
  }
  if (action.declineDraw === true) {
    if (state.drawOffer === null || state.drawOffer === pid) return null;
    state.drawBlocked = state.drawOffer;
    state.drawOffer = null;
    return 'decline';
  }
  return null;
}

function clearDrawOffer(state) {
  state.drawOffer = null;
  state.drawBlocked = null;
}

module.exports = {
  WIN_POINTS, DRAW_POINTS, PLACE_POINTS, GONE_FORFEIT_MS,
  MOVE_TIMER_SETTING, MOVE_TIMER_OPTIONS,
  moveTimerMs, armMoveTimer, moveTimedOut, duelPoints, awardAll,
  competitionRanks, placePoints, drawAction, clearDrawOffer,
};
