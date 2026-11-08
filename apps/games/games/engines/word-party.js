"use strict";
/* Lifecycle shared by the five word/camera games. Views use explicit projections. */
const { actionWindow, paced } = require("../_sdk");

function content(ctx, id) {
  return {
    ...require("../../locales/en/" + id + ".json"),
    ...(ctx.content(id) || {}),
  };
}
function base(ctx, defaults) {
  const roster = ctx.allPlayers().map((p) => p.id);
  const settings = ctx.settings ? ctx.settings() : {};
  return {
    roster,
    gone: [],
    scores: Object.fromEntries(roster.map((pid) => [pid, 0])),
    round: 0,
    rounds: settings.rounds ?? defaults,
    phase: "setup",
    endsAt: 0,
    windowMs: 0,
    hostId: ctx.hostId(),
    last: null,
    timerNo: 0,
    cancelTimer: null,
  };
}
function active(s) {
  return s.roster.filter((pid) => !s.gone.includes(pid));
}
function known(s, pid) {
  return typeof pid === "string" && active(s).includes(pid);
}
function validAction(s, pid, a) {
  return known(s, pid) && a && typeof a === "object" && !Array.isArray(a);
}
function cancel(s) {
  s.cancelTimer?.();
  s.cancelTimer = null;
  s.timerNo++;
}
function timer(s, ctx, seconds, fn) {
  cancel(s);
  s.windowMs = paced(ctx, seconds) * 1000;
  s.endsAt = ctx.now() + s.windowMs;
  const token = s.timerNo,
    window = actionWindow(s);
  s.cancelTimer = ctx.later(s.windowMs, () => {
    if (s.timerNo !== token || actionWindow(s) !== window) return;
    fn();
    ctx.broadcast();
  });
}
function finish(s) {
  cancel(s);
  s.phase = "done";
  s.endsAt = 0;
  s.windowMs = 0;
}
function award(s, ctx, points) {
  for (const pid of active(s)) {
    const n = points[pid] || 0;
    if (!n) continue;
    s.scores[pid] += n;
    ctx.award(pid, n);
  }
}
function reveal(s, ctx, last, next) {
  s.phase = "reveal";
  s.last = last;
  award(s, ctx, last.pts || {});
  timer(s, ctx, 8, next);
}
function gone(s, pid) {
  if (!s.roster.includes(pid) || s.gone.includes(pid)) return false;
  s.gone.push(pid);
  return true;
}
function commonView(s, ctx) {
  return {
    phase: s.phase,
    round: s.round,
    rounds: s.rounds,
    endsAt: s.endsAt,
    windowMs: s.windowMs,
    hostId: ctx ? ctx.hostId() : s.hostId,
    scores: { ...s.scores },
    gone: [...s.gone],
    last: s.last,
  };
}
function canNext(s, ctx, pid, a) {
  return (
    s.phase === "reveal" &&
    a.next === true &&
    (pid === ctx.hostId() || pid === s.lead)
  );
}
function expired(s, ctx) {
  return s.endsAt > 0 && ctx.now() >= s.endsAt;
}
function text(raw) {
  return typeof raw === "string" && raw.length <= 160
    ? raw
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .trim()
        .replace(/\s+/g, " ")
    : "";
}
module.exports = {
  content,
  base,
  active,
  known,
  validAction,
  cancel,
  timer,
  finish,
  award,
  reveal,
  gone,
  commonView,
  canNext,
  expired,
  text,
};
