"use strict";
// Batch 4's round lifecycle. Each game owns its rules and safe projection.
const { paced } = require("../_sdk");

function create(ctx, id, rounds) {
  const settings = ctx.settings();
  const roster = ctx.allPlayers().map((p) => p.id);
  return {
    phase: "ready",
    round: 0,
    rounds: settings.rounds ?? rounds,
    roster,
    gone: [],
    scores: Object.fromEntries(roster.map((pid) => [pid, 0])),
    turnNo: 0,
    endsAt: 0,
    windowMs: 0,
    last: null,
    strings: ctx.content(id).strings || {},
  };
}
function active(s) {
  return s.roster.filter((pid) => !s.gone.includes(pid));
}
function valid(s, pid, a) {
  return (
    active(s).includes(pid) && a && typeof a === "object" && !Array.isArray(a)
  );
}
function window(s, ctx, phase, ms, callback) {
  s.phase = phase;
  s.turnNo++;
  const token = s.turnNo,
    round = s.round;
  s.windowMs = ms;
  s.endsAt = ctx.now() + ms;
  ctx.later(ms, () => {
    if (s.phase !== phase || s.round !== round || s.turnNo !== token) return;
    callback();
    ctx.broadcast();
  });
}
function onEnd(s) {
  s.phase = "done";
  s.endsAt = 0;
  s.turnNo++;
}
function finish(s, ctx, pts, next, details = {}) {
  if (s.phase === "reveal" || s.phase === "done") return;
  for (const pid of s.roster) {
    const n = pts[pid] || 0;
    s.scores[pid] += n;
    if (n) ctx.award(pid, n);
  }
  s.last = { ...details, pts };
  window(s, ctx, "reveal", paced(ctx, 5) * 1000, next);
}
function scaled(s, values) {
  const top = Math.max(0, ...Object.values(values));
  return Object.fromEntries(
    s.roster.map((pid) => [
      pid,
      top ? Math.round((100 * (values[pid] || 0)) / top) : 0,
    ]),
  );
}
function begin(s) {
  if (s.round >= s.rounds || !active(s).length) {
    onEnd(s);
    return false;
  }
  s.round++;
  return true;
}
function gone(s, pid) {
  if (s.roster.includes(pid) && !s.gone.includes(pid)) s.gone.push(pid);
}
function baseView(s, pid, ctx) {
  return {
    phase: s.phase,
    round: s.round,
    rounds: s.rounds,
    scores: { ...s.scores },
    gone: [...s.gone],
    strings: s.strings,
    endsAt: s.endsAt,
    windowMs: s.windowMs,
    last: s.last,
    me: active(s).includes(pid) ? pid : null,
    watching: !active(s).includes(pid),
    hostId: ctx?.hostId?.() || null,
  };
}
module.exports = {
  create,
  active,
  valid,
  window,
  onEnd,
  finish,
  scaled,
  begin,
  gone,
  baseView,
};
