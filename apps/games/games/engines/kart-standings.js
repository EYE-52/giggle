'use strict';
/* Final standings for every kart arena (classic and elevated).
 *
 * Whole-match scoring from specs/GAME_RULES_STANDARD.md: places earn
 * 300 / 200 / 100 / 0 by final rank. Equal scores share a rank (1, 1, 3)
 * and the points of that rank; list order never breaks a tie. When every
 * driver still in the match is level, the match is a draw and each gets
 * 150. Drivers who dropped out (left or gone for 60 s) rank after everyone
 * still driving and earn 0. */

const PLACE_POINTS = Object.freeze([300, 200, 100]);
const DRAW_POINTS = 150;

function rankStandings(entries) {
  const list = (Array.isArray(entries) ? entries : []).map((e) => ({
    pid: e.pid,
    score: Math.max(0, Math.floor(Number(e.score) || 0)),
    out: e.out === true,
  }));
  const active = list.filter((e) => !e.out).sort((a, b) => b.score - a.score);
  const gone = list.filter((e) => e.out).sort((a, b) => b.score - a.score);
  const draw = active.length > 1 && active.every((e) => e.score === active[0].score);
  const standings = [];
  active.forEach((e, i) => {
    const rank = i > 0 && e.score === active[i - 1].score ? standings[i - 1].rank : i + 1;
    standings.push({ ...e, rank, points: draw ? DRAW_POINTS : PLACE_POINTS[rank - 1] || 0 });
  });
  for (const e of gone) standings.push({ ...e, rank: active.length + 1, points: 0 });
  // Winners are everyone sharing first place among drivers still in the
  // match. A single driver left is the winner even on zero.
  const winners = active.length ? active.filter((e) => e.score === active[0].score).map((e) => e.pid) : [];
  return { standings, winners, winner: winners.length === 1 ? winners[0] : null, draw };
}

module.exports = { rankStandings, PLACE_POINTS, DRAW_POINTS };
