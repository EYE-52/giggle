'use strict';
const crypto = require('node:crypto');
const duel = require('../engines/board-duel');
const id = 'ludo';
const SAFE = [0, 8, 13, 21, 26, 34, 39, 47];
const manifest = {
  name: 'Ludo', tagline: 'Race your four pawns home',
  howto: 'Four pawns each. Roll six to enter and roll again after six. Follow your lane and land exactly at home. Landing on an opponent on an unmarked trail square sends every opponent pawn there back to its yard. Starting squares and stars are safe. No blockades or three-sixes penalty. First with all four home wins; the others place by how far their pawns have come. A player who leaves, resigns or runs out of time on the move timer drops out and the others play on. Two to four play; everyone else watches.',
  cat: 'board', renderer: 'svg', layout: 'immersive', runtime: { type: 'module', waitForResult: true },
  players: { min: 2, max: 24 }, seats: 4, realtime: false, art: 'img/games/ludo.svg',
  settings: [{ ...duel.MOVE_TIMER_SETTING }],
};
function create(ctx) {
  const seats = ctx.allPlayers().slice(0, 4).map(p => p.id);
  const s = { phase: 'roll', seats, lanes: seats.length===2?[0,2]:seats.map((_,i)=>i), pawns: seats.map(() => [-1,-1,-1,-1]), turn: 0, die: null,
    rev: 0, turnNo: 0, lastMove: null, result: null, resigned: [], outReason: {}, scores: {}, places: [],
    moveTimerMs: duel.moveTimerMs(ctx), endsAt: null };
  duel.armMoveTimer(s, ctx);
  return s;
}
/* Pawn progress: yard 0, each trail step 1, home 57 per pawn. */
const progress = pawns => pawns.reduce((n, p) => n + p + 1, 0);
function legal(state) {
  if (state.phase !== 'move') return [];
  return state.pawns[state.turn].flatMap((p, i) => (p === -1 ? state.die === 6 : p < 56 && p + state.die <= 56) ? [i] : []);
}
/* Places: the winner first, then the players still racing by progress
 * (equal progress shares a place), then those who dropped out, the latest
 * first. Points 300/200/100/0 by place; a player who dropped out scores 0. */
function finish(state, ctx, winner, reason) {
  if (state.phase === 'done') return;
  state.phase = 'done'; state.die = null; state.endsAt = null;
  state.result = { winner, winnerPid: state.seats[winner], reason };
  const racing = state.seats.map((pid, side) => ({ pid, side, value: side === winner ? Infinity : progress(state.pawns[side]) }))
    .filter(e => !state.resigned.includes(e.side));
  const dropped = state.resigned.slice().reverse().map((side, i) => ({ pid: state.seats[side], side, value: -1 - i }));
  const ranked = duel.competitionRanks([...racing, ...dropped]);
  const points = duel.placePoints(ranked);
  for (const e of dropped) points[e.pid] = 0;
  state.places = ranked.map(e => ({ pid: e.pid, side: e.side, rank: e.rank, out: state.resigned.includes(e.side), points: points[e.pid] }));
  duel.awardAll(state, ctx, points);
}
/* Drop a player out of the race; the others play on. */
function dropOut(state, ctx, side, reason) {
  if (state.phase === 'done' || side < 0 || state.resigned.includes(side)) return false;
  state.resigned.push(side); state.outReason[side] = reason; state.rev++; state.turnNo = state.rev;
  const alive = state.seats.map((_,i) => i).filter(i => !state.resigned.includes(i));
  if (alive.length === 1) finish(state, ctx, alive[0], reason);
  else if (side === state.turn) { next(state); duel.armMoveTimer(state, ctx); }
  return true;
}
function next(state) {
  do { state.turn = (state.turn + 1) % state.seats.length; } while (state.resigned.includes(state.turn));
  state.phase = 'roll'; state.die = null;
}
function onAction(state, ctx, pid, a) {
  if (state.phase === 'done' || !a || typeof a !== 'object' || Array.isArray(a) ||
      !Number.isSafeInteger(a.rev) || a.rev !== state.rev) return false;
  const side = state.seats.indexOf(pid);
  if (side < 0 || state.resigned.includes(side)) return false;
  if (['roll','move','resign'].filter(k => a[k] !== undefined).length !== 1) return false;
  if (duel.moveTimedOut(state, ctx)) { dropOut(state, ctx, state.turn, 'timeout'); return; }
  if (a.resign === true) { dropOut(state, ctx, side, 'resign'); return; }
  if (side !== state.turn) return false;
  if (a.roll === true && state.phase === 'roll') {
    state.die = crypto.randomInt(1,7); state.phase = 'move'; state.rev++; state.turnNo = state.rev;
    state.lastMove = { kind: 'roll', side, die: state.die, rev: state.rev };
    if (!legal(state).length) {
      state.lastMove.skipped = true;
      if (state.die === 6) { state.phase = 'roll'; state.die = null; } else next(state);
    }
    duel.armMoveTimer(state, ctx);
    return;
  }
  if (state.phase !== 'move' || !Number.isInteger(a.move) || !legal(state).includes(a.move)) return false;
  const from = state.pawns[side][a.move], to = from === -1 ? 0 : from + state.die, die = state.die;
  state.pawns[side][a.move] = to;
  const captured = [], cell = (state.lanes[side] * 13 + to) % 52;
  if (to < 51 && !SAFE.includes(cell)) for (let other = 0; other < state.seats.length; other++) {
    if (other === side || state.resigned.includes(other)) continue;
    state.pawns[other].forEach((p, pawn) => {
      if (p >= 0 && p < 51 && (state.lanes[other] * 13 + p) % 52 === cell) { state.pawns[other][pawn] = -1; captured.push({ side: other, pawn }); }
    });
  }
  state.rev++; state.turnNo = state.rev;
  state.lastMove = { kind: 'move', side, pawn: a.move, from, to, die, captured, rev: state.rev };
  if (state.pawns[side].every(p => p === 56)) finish(state, ctx, side, 'home');
  else if (die === 6) { state.phase = 'roll'; state.die = null; }
  else next(state);
  if (state.phase !== 'done') duel.armMoveTimer(state, ctx);
}
/* The move timer ran out: the player to act drops out of the race. */
function onTick(state, ctx) {
  if (!duel.moveTimedOut(state, ctx)) return;
  dropOut(state, ctx, state.turn, 'timeout'); ctx.broadcast();
}
/* Room hook: a player left or stayed away 60 s — they drop out. */
function onPlayerGone(state, ctx, pid) {
  return dropOut(state, ctx, state.seats.indexOf(pid), 'forfeit');
}
function view(state, pid) {
  const side = state.seats.indexOf(pid);
  return { phase: state.phase, seats: state.seats.slice(), lanes:state.lanes.slice(), pawns: state.pawns.map(p => p.slice()), turn: state.turn,
    die: state.die, rev: state.rev, turnNo: state.turnNo, youAre: side >= 0 ? side : null,
    legal: side === state.turn && !state.resigned.includes(side) ? legal(state) : [], safe: SAFE.slice(),
    resigned: state.resigned.slice(), lastMove: state.lastMove ? structuredClone(state.lastMove) : null,
    result: state.result ? { ...state.result } : null, outReason: { ...state.outReason },
    progress: state.pawns.map(progress), places: state.places.map(p => ({ ...p })), scores: { ...state.scores },
    endsAt: state.endsAt, moveTimerMs: state.moveTimerMs };
}
module.exports = { id, manifest, minPlayers: 2, maxPlayers: 24, create, onAction, onTick, onPlayerGone, view };
