"use strict";
/* Batch 2's small, server-only party helpers. No game secrets are projected here. */
const { paced, actionWindow } = require("../_sdk");

function content(ctx, id) {
  const pack = ctx.content(id) || {};
  // Isolated rule hosts may not install a content provider. The same locale
  // file supplies that fallback; English content never lives in rule code.
  return Object.keys(pack).length
    ? pack
    : require("../../locales/en/" + id + ".json");
}
function base(ctx, fallbackRounds) {
  const ids = ctx.allPlayers().map((p) => p.id);
  const setting = ctx.settings?.().rounds;
  return {
    ids,
    gone: [],
    scores: Object.fromEntries(ids.map((pid) => [pid, 0])),
    hostId: ctx.hostId(),
    round: 0,
    rounds: Number.isInteger(setting)
      ? Math.max(1, Math.min(12, setting))
      : fallbackRounds,
    phase: "setup",
    endsAt: 0,
    windowMs: 0,
    turnNo: 0,
    last: null,
  };
}
function active(s) {
  return s.ids.filter((pid) => !s.gone.includes(pid));
}
function waiting(s, ctx, ids = active(s)) {
  const connected = new Set(ctx.players().map((p) => p.id));
  return ids.filter((pid) => connected.has(pid));
}
function complete(s, ctx, record, ids) {
  return waiting(s, ctx, ids).every((pid) => Object.hasOwn(record, pid));
}
function window(s, ctx, phase, seconds, expire) {
  s._cancel?.();
  s.phase = phase;
  s.turnNo++;
  const token = actionWindow(s);
  s.windowMs = paced(ctx, seconds) * 1000;
  s.endsAt = ctx.now() + s.windowMs;
  s._expire = () => {
    if (actionWindow(s) !== token || !s.endsAt) return;
    s._cancel?.();
    s._expire = null;
    expire();
  };
  s._cancel = ctx.later(s.windowMs, () => {
    if (actionWindow(s) !== token || !s.endsAt) return;
    s._expire?.();
    ctx.broadcast();
  });
}
function end(s) {
  s._cancel?.();
  s._cancel = s._expire = null;
  s.phase = "done";
  s.turnNo++;
  s.endsAt = 0;
}
function accept(s, ctx, pid, a) {
  if (
    !a ||
    typeof a !== "object" ||
    Array.isArray(a) ||
    !active(s).includes(pid) ||
    s.phase === "done"
  )
    return false;
  if (s.endsAt && ctx.now() >= s.endsAt) {
    s._expire?.();
    return false;
  }
  return true;
}
function award(s, ctx, pts) {
  for (const [pid, n] of Object.entries(pts)) {
    if (!s.ids.includes(pid) || !Number.isFinite(n) || n <= 0) continue;
    s.scores[pid] = (s.scores[pid] || 0) + n;
    ctx.award(pid, n);
  }
}
function reveal(s, ctx, last, next, lead) {
  award(s, ctx, last.pts || {});
  s.last = last;
  s.lead = lead || null;
  window(s, ctx, "reveal", 8, next);
}
function gone(s, pid) {
  if (!s.ids.includes(pid) || s.gone.includes(pid)) return false;
  s.gone.push(pid);
  return true;
}
function projection(s, pid, ctx) {
  return {
    phase: s.phase,
    round: s.round,
    rounds: s.rounds,
    turnNo: s.turnNo,
    endsAt: s.endsAt,
    windowMs: s.windowMs,
    scores: { ...s.scores },
    hostId: ctx?.hostId?.() || s.hostId,
    gone: [...s.gone],
    watching: !active(s).includes(pid),
    lead: s.lead || null,
    last: s.phase === "reveal" || s.phase === "done" ? s.last : null,
  };
}
module.exports = {
  content,
  base,
  active,
  waiting,
  complete,
  window,
  end,
  accept,
  award,
  reveal,
  gone,
  projection,
};
