"use strict";
const {
  dealer,
  shuffle,
  allIn,
  actionWindow,
  roundsSetting,
  paceSetting,
  paced,
} = require("../_sdk");
const id = "ballpark";
const manifest = {
  name: "Ballpark",
  tagline: "Big guesses, tiny margins",
  howto:
    "Type a number before time runs out. The closest guesses all score 100, with 50 extra for an exact answer. Other guesses within 10 percent of the answer score 50. Reveal the number line and a fact, then try the next question.",
  guide: {
    goal: "Get closest to the real number.",
    tips: [
      "Everyone answers the same number question.",
      "Closest guesses earn 100; an exact answer adds 50.",
      "Other guesses within 10% earn 50. Ties share the points.",
    ],
  },
  cat: "vote",
  players: {
    min: 2,
    max: 20,
  },
  renderer: "dom",
  art: "img/games/ballpark.png",
};
manifest.settings = [roundsSetting({ def: 8 }), paceSetting()];

function active(s, ctx) {
  return ctx
    .players()
    .filter((p) => s.roster.includes(p.id) && !s.gone.includes(p.id));
}
function known(s, ctx, pid) {
  return typeof pid === "string" && active(s, ctx).some((p) => p.id === pid);
}
function add(s, ctx, pts) {
  for (const [pid, n] of Object.entries(pts))
    if (n > 0 && s.roster.includes(pid) && !s.gone.includes(pid)) {
      s.scores[pid] = (s.scores[pid] || 0) + n;
      ctx.award(pid, n);
    }
}
// Both the timer and a late action close exactly the same input window.
function windowFor(s, ctx, phase, seconds, close) {
  s.phase = phase;
  const token = actionWindow(s),
    ms = paced(ctx, seconds) * 1000;
  s.endsAt = ctx.now() + ms;
  s.windowMs = ms;
  s.close = () => {
    if (actionWindow(s) !== token) return;
    s.close = null;
    close();
  };
  ctx.later(ms, () => {
    if (actionWindow(s) !== token || !s.close) return;
    s.close();
    ctx.broadcast();
  });
}
function expired(s, ctx) {
  if (s.close && ctx.now() >= s.endsAt) {
    s.close();
    return true;
  }
  return false;
}
function finish(s) {
  s.phase = "done";
  s.endsAt = 0;
  s.close = null;
}
function onEnd(s) {
  finish(s);
}
function showResult(s, ctx, last, seconds = 8) {
  s.last = last;
  add(s, ctx, last.pts || {});
  windowFor(s, ctx, "reveal", seconds, () => nextRound(s, ctx));
}
function base(ctx, pack, rounds) {
  return {
    phase: "",
    round: 0,
    rounds,
    roster: ctx.allPlayers().map((p) => p.id),
    gone: [],
    scores: {},
    last: null,
    endsAt: 0,
    windowMs: 0,
    hostId: ctx.hostId(),
    labels: pack.labels || {},
  };
}
function publicBase(s, pid, ctx) {
  return {
    phase: s.phase,
    round: Math.min(s.round, s.rounds),
    rounds: s.rounds,
    scores: { ...s.scores },
    gone: s.gone.slice(),
    endsAt: s.endsAt,
    windowMs: s.windowMs,
    hostId: ctx ? ctx.hostId() : s.hostId,
    labels: s.labels,
    last: s.last,
    watching: !s.roster.includes(pid) || s.gone.includes(pid),
  };
}
function text(value, max) {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value)
    ? value.trim()
    : null;
}
function onAction(s, ctx, pid, a) {
  if (
    !a ||
    typeof a !== "object" ||
    Array.isArray(a) ||
    !known(s, ctx, pid) ||
    s.phase === "done"
  )
    return;
  if (expired(s, ctx)) return;
  if (s.phase === "reveal") {
    if (a.next === true && (pid === ctx.hostId() || pid === s.lead))
      nextRound(s, ctx);
    return;
  }
  act(s, ctx, pid, a);
}
function onPlayerGone(s, ctx, pid) {
  if (!s.roster.includes(pid) || s.gone.includes(pid) || s.phase === "done")
    return;
  s.gone.push(pid);
  if (s.phase === "reveal") return;
  if (active(s, ctx).length < 2) {
    showResult(s, ctx, { pts: {}, skipped: true, reason: s.labels.tooFew });
    return;
  }
  gone(s, ctx, pid);
}

function create(ctx) {
  const pack = ctx.content(id) || {},
    s = base(ctx, pack, ctx.settings().rounds ?? 8);
  s.deal = dealer(
    pack.questions?.length
      ? pack.questions
      : [{ q: "", answer: 1, unit: "", fact: "", decimals: false }],
  );
  nextRound(s, ctx);
  return s;
}
function nextRound(s, ctx) {
  if (s.round >= s.rounds || active(s, ctx).length < 2) return finish(s);
  s.round++;
  s.last = null;
  s.answers = {};
  s.question = s.deal();
  windowFor(s, ctx, "answer", 30, () => reveal(s, ctx));
}
function reveal(s, ctx) {
  if (s.phase !== "answer") return;
  const entries = active(s, ctx)
    .filter((p) => Object.hasOwn(s.answers, p.id))
    .map((p) => [p.id, s.answers[p.id]]);
  const truth = s.question.answer,
    best = Math.min(...entries.map(([, g]) => Math.abs(g - truth))),
    pts = {};
  for (const [pid, g] of entries) {
    const d = Math.abs(g - truth),
      closest = Math.abs(d - best) <= Number.EPSILON * Math.max(1, d, best) * 8;
    pts[pid] = closest
      ? 100 + (g === truth ? 50 : 0)
      : d <= Math.abs(truth) * 0.1 + Number.EPSILON
        ? 50
        : 0;
  }
  showResult(s, ctx, {
    pts,
    answers: Object.fromEntries(entries),
    answer: truth,
    fact: s.question.fact,
    source: s.question.source,
  });
}
function act(s, ctx, pid, a) {
  if (
    s.phase !== "answer" ||
    Object.hasOwn(s.answers, pid) ||
    typeof a.answer !== "number" ||
    !Number.isFinite(a.answer) ||
    Math.abs(a.answer) > 1e12 ||
    (!s.question.decimals && !Number.isInteger(a.answer))
  )
    return;
  s.answers[pid] = a.answer;
  if (allIn(active(s, ctx), s.answers)) reveal(s, ctx);
}
function gone(s, ctx, pid) {
  delete s.answers[pid];
  if (allIn(active(s, ctx), s.answers)) reveal(s, ctx);
}
function view(s, pid, ctx) {
  const v = publicBase(s, pid, ctx);
  return Object.assign(v, {
    question: {
      q: s.question.q,
      unit: s.question.unit,
      decimals: !!s.question.decimals,
    },
    acted: Object.keys(s.answers),
    myAnswer: v.watching ? null : (s.answers[pid] ?? null),
  });
}

module.exports = {
  id,
  minPlayers: 2,
  maxPlayers: 20,
  manifest,
  create,
  onAction,
  onEnd,
  onPlayerGone,
  view,
};
