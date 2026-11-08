"use strict";
/* Small lifecycle helpers used only by the five batch-six games. */
const { paced } = require("../_sdk");

function roster(ctx) {
  return ctx.allPlayers().map((p) => p.id);
}
function active(s) {
  return s.order.filter((pid) => !s.gone.includes(pid));
}
function known(s, pid) {
  return typeof pid === "string" && active(s).includes(pid);
}
function valid(s, pid, a) {
  return (
    s.phase !== "done" &&
    known(s, pid) &&
    a &&
    typeof a === "object" &&
    !Array.isArray(a)
  );
}
function base(ctx) {
  const order = roster(ctx);
  return {
    order,
    gone: [],
    scores: Object.fromEntries(order.map((pid) => [pid, 0])),
    round: 0,
    phase: "start",
    endsAt: 0,
    windowMs: 0,
    windowNo: 0,
    hostId: ctx.hostId(),
  };
}
function arm(s, ctx, phase, seconds, fn) {
  s.phase = phase;
  s.windowMs = paced(ctx, seconds) * 1000;
  s.endsAt = ctx.now() + s.windowMs;
  const token = ++s.windowNo,
    round = s.round;
  ctx.later(s.windowMs, () => {
    if (s.phase !== phase || s.round !== round || s.windowNo !== token) return;
    fn();
    ctx.broadcast();
  });
}
function expired(s, ctx) {
  return s.endsAt > 0 && ctx.now() >= s.endsAt;
}
function finish(s) {
  if (s.phase === "done") return;
  s.phase = "done";
  s.endsAt = 0;
  s.windowMs = 0;
  s.windowNo++;
}
function award(s, ctx, pts) {
  for (const [pid, n] of Object.entries(pts)) {
    if (!s.order.includes(pid) || !Number.isFinite(n) || n <= 0) continue;
    s.scores[pid] += n;
    ctx.award(pid, n);
  }
}
function gone(s, pid) {
  if (!s.order.includes(pid) || s.gone.includes(pid) || s.phase === "done")
    return false;
  s.gone.push(pid);
  return true;
}
function host(s, ctx) {
  return ctx?.hostId ? ctx.hostId() : s.hostId;
}
function publicBase(s, ctx) {
  return {
    phase: s.phase,
    round: s.round,
    rounds: s.rounds,
    scores: { ...s.scores },
    order: s.order.slice(),
    gone: s.gone.slice(),
    endsAt: s.endsAt,
    windowMs: s.windowMs,
    windowNo: s.windowNo,
    hostId: host(s, ctx),
  };
}
module.exports = {
  base,
  active,
  known,
  valid,
  arm,
  expired,
  finish,
  award,
  gone,
  host,
  publicBase,
};
