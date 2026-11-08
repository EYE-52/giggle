'use strict';

// Match lifecycle shared by the five tabletop additions. Rule hooks own the
// board; this helper owns seats, guarded deadlines and once-only settlement.
const duel = require('./board-duel');
const { moveSeconds, paced } = require('../_sdk');

function createBoardGame(rules) {
  const { id, manifest } = rules;
  const active = s => s.seats.filter(pid => !s.out.includes(pid));

  function finish(s, ctx, reason, winners = [], ranks = null) {
    if (s.phase === 'done') return;
    s.phase = 'done';
    s.endsAt = null;
    s.window++;
    s.drawOffer = null;
    const points = Object.fromEntries(s.seats.map(pid => [pid, 0]));
    if (reason !== 'ended') {
      if (s.seats.length === 2) {
        Object.assign(points, duel.duelPoints(s.seats, winners.length === 1 ? winners[0] : null));
      } else if (winners.length === active(s).length && winners.length > 1) {
        for (const pid of winners) points[pid] = duel.DRAW_POINTS;
      } else if (ranks) Object.assign(points, duel.placePoints(ranks));
      for (const pid of s.out) points[pid] = 0;
    }
    s.result = { reason, winners: winners.slice(), winnerPid: winners.length === 1 ? winners[0] : null, ranks: ranks || [] };
    duel.awardAll(s, ctx, points);
  }

  function rankFinish(s, ctx, reason) {
    const ranked = duel.competitionRanks(active(s).map(pid => ({ pid, value: rules.value(s, pid) })));
    finish(s, ctx, reason, ranked.filter(e => e.rank === 1).map(e => e.pid), ranked);
  }

  function next(s) {
    const before = s.turn;
    do { s.turn = (s.turn + 1) % s.seats.length; }
    while (s.out.includes(s.seats[s.turn]) || s.finished?.includes(s.seats[s.turn]));
    return s.turn <= before;
  }

  function gone(s, ctx, pid, reason = 'forfeit') {
    if (s.phase !== 'play' || !s.seats.includes(pid) || s.out.includes(pid) || s.finished?.includes(pid)) return false;
    s.out.push(pid);
    duel.clearDrawOffer(s);
    if (s.seats.length === 2 || active(s).length <= 1) {
      const winners = active(s);
      const ranked = winners.map((p, i) => ({ pid: p, rank: i + 1, value: 0 }));
      finish(s, ctx, reason, winners, ranked);
    } else if (rules.gone) rules.gone(s, ctx, pid, helpers);
    else if (s.seats[s.turn] === pid) next(s);
    return true;
  }

  function expire(s, ctx) {
    if (rules.timeout) rules.timeout(s, ctx, helpers);
    else gone(s, ctx, s.seats[s.turn], 'timeout');
    s.rev++;
    if (s.lastMove) s.lastMove.rev = s.rev;
    s.turnNo++;
    arm(s, ctx);
  }

  function arm(s, ctx) {
    const window = ++s.window;
    s.endsAt = s.phase === 'play' && s.moveTimerMs > 0 ? ctx.now() + s.moveTimerMs : null;
    if (!s.endsAt) return;
    ctx.later(s.moveTimerMs, () => {
      if (s.phase !== 'play' || s.window !== window || ctx.now() < s.endsAt) return;
      expire(s, ctx);
      ctx.broadcast();
    });
  }

  const helpers = { finish, rankFinish, next, active };
  function create(ctx) {
    const seats = ctx.allPlayers().slice(0, manifest.seats || manifest.players.max).map(p => p.id);
    const s = {
      phase: 'play', seats, turn: 0, rev: 0, turnNo: 0, window: 0,
      out: [], scores: Object.fromEntries(seats.map(pid => [pid, 0])),
      result: null, lastMove: null, drawOffer: null, drawBlocked: null,
      moveTimerMs: rules.timerSeconds ? paced(ctx, rules.timerSeconds) * 1000 : moveSeconds(ctx) * 1000,
      endsAt: null, strings: ctx.content(id)?.strings || {},
    };
    rules.init(s, ctx);
    arm(s, ctx);
    return s;
  }

  function onAction(s, ctx, pid, a) {
    if (s.phase !== 'play' || !a || typeof a !== 'object' || Array.isArray(a) ||
        !Number.isSafeInteger(a.rev) || a.rev !== s.rev ||
        !s.seats.includes(pid) || s.out.includes(pid) || s.finished?.includes(pid)) return false;
    if (s.endsAt && ctx.now() >= s.endsAt) { expire(s, ctx); return; }
    if (a.resign === true) {
      const turn = s.turn;
      gone(s, ctx, pid, 'resign');
      s.rev++;
      if (s.turn !== turn || s.phase === 'done') { s.turnNo++; arm(s, ctx); }
      return;
    }
    if (s.seats.length === 2) {
      const draw = duel.drawAction(s, pid, a);
      if (draw) {
        if (draw === 'accept') finish(s, ctx, 'agreement', s.seats);
        s.rev++;
        return;
      }
    }
    if (pid !== s.seats[s.turn]) return false;
    const moved = rules.move(s, ctx, a, helpers);
    if (!moved) return false;
    s.rev++;
    if (s.lastMove) s.lastMove.rev = s.rev;
    duel.clearDrawOffer(s);
    if (moved !== 'same-window') { s.turnNo++; arm(s, ctx); }
  }

  function onPlayerGone(s, ctx, pid) {
    const turn = s.turn;
    if (!gone(s, ctx, pid)) return false;
    s.rev++;
    if (s.turn !== turn || s.phase === 'done') { s.turnNo++; arm(s, ctx); }
    return true;
  }

  function onEnd(s, ctx) {
    if (s.phase === 'done') return;
    finish(s, ctx, 'ended');
    s.rev++;
  }

  function view(s, pid) {
    const youAre = s.seats.includes(pid) ? s.seats.indexOf(pid) : null;
    const canAct = s.phase === 'play' && youAre === s.turn && !s.out.includes(pid) && !s.finished?.includes(pid);
    // No timer callbacks, RNG source, pack or server-only helpers cross this boundary.
    return JSON.parse(JSON.stringify({
      phase: s.phase, seats: s.seats, turn: s.turn, rev: s.rev, turnNo: s.turnNo,
      youAre, out: s.out, scores: s.scores, result: s.result, lastMove: s.lastMove,
      drawOffer: s.drawOffer, drawBlocked: s.drawBlocked,
      moveTimerMs: s.moveTimerMs, endsAt: s.endsAt, strings: s.strings,
      ...rules.project(s), legal: canAct ? rules.legal(s) : [],
    }));
  }
  return { id, manifest, minPlayers: manifest.players.min, maxPlayers: manifest.players.max, create, onAction, onEnd, onPlayerGone, view };
}

module.exports = { createBoardGame };
