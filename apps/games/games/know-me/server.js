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
const id = "know-me";
const manifest = {
  name: "Know Me",
  tagline: "How well do you know your people?",
  howto:
    "The hot seat picks a true answer while everyone else predicts that choice. Correct predictions earn 100. The hot seat earns 25 per correct prediction, capped at 100, or 50 when there is just one predictor. A missing hot-seat pick skips the round. Auto gives two turns per player, up to 12 rounds.",
  guide: {
    goal: "Predict what the hot-seat player will pick.",
    tips: [
      "The hot seat secretly picks one of four options.",
      "Everyone else predicts at the same time. A match earns 100.",
      "The hot seat earns 25 per match, or 50 in a two-player game.",
    ],
  },
  cat: "social",
  players: {
    min: 2,
    max: 20,
  },
  renderer: "dom",
  art: "img/games/know-me.png",
};
manifest.settings = [
  roundsSetting({ def: null, autoLabel: "Two turns each, up to 12" }),
  paceSetting(),
];

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
  if (s.autoRounds) {
    s.schedule = s.schedule
      .slice(0, s.round)
      .concat(s.schedule.slice(s.round).filter((p) => p !== pid));
    s.rounds = s.schedule.length;
  }
  if (s.phase === "reveal") return;
  if (active(s, ctx).length < 2) {
    showResult(s, ctx, { pts: {}, skipped: true, reason: s.labels.tooFew });
    return;
  }
  gone(s, ctx, pid);
}

function create(ctx) {
  const pack = ctx.content(id) || {},
    n = ctx.allPlayers().length,
    s = base(ctx, pack, ctx.settings().rounds ?? Math.min(12, n * 2));
  s.rotation = s.roster.slice();
  s.cursor = 0;
  s.autoRounds = ctx.settings().rounds == null;
  s.schedule = Array.from(
    { length: s.rounds },
    (_, i) => s.roster[i % s.roster.length],
  );
  s.deal = dealer(
    pack.questions?.length
      ? pack.questions
      : [{ q: "", options: ["", "", "", ""] }],
  );
  nextRound(s, ctx);
  return s;
}
function nextRound(s, ctx) {
  if (s.round >= s.rounds || active(s, ctx).length < 2) return finish(s);
  const live = active(s, ctx).map((p) => p.id);
  if (s.autoRounds) s.lead = s.schedule[s.round];
  else
    do {
      s.lead = s.rotation[s.cursor++ % s.rotation.length];
    } while (!live.includes(s.lead));
  s.round++;
  s.last = null;
  s.picks = {};
  s.question = s.deal();
  windowFor(s, ctx, "pick", 25, () => reveal(s, ctx));
}
function reveal(s, ctx) {
  if (s.phase !== "pick") return;
  if (!Object.hasOwn(s.picks, s.lead))
    return showResult(s, ctx, {
      pts: {},
      skipped: true,
      reason: s.labels.noPick,
    });
  const answer = s.picks[s.lead],
    predictors = active(s, ctx).filter((p) => p.id !== s.lead),
    pts = {};
  for (const p of predictors) pts[p.id] = s.picks[p.id] === answer ? 100 : 0;
  pts[s.lead] = Math.min(
    100,
    predictors.filter((p) => pts[p.id] === 100).length *
      (predictors.length === 1 ? 50 : 25),
  );
  showResult(s, ctx, { pts, answer, picks: { ...s.picks } });
}
function act(s, ctx, pid, a) {
  if (
    s.phase !== "pick" ||
    Object.hasOwn(s.picks, pid) ||
    !Number.isInteger(a.pick) ||
    a.pick < 0 ||
    a.pick > 3
  )
    return;
  s.picks[pid] = a.pick;
  if (allIn(active(s, ctx), s.picks)) reveal(s, ctx);
}
function gone(s, ctx, pid) {
  delete s.picks[pid];
  if (pid === s.lead)
    showResult(s, ctx, { pts: {}, skipped: true, reason: s.labels.leadLeft });
  else if (allIn(active(s, ctx), s.picks)) reveal(s, ctx);
}
function view(s, pid, ctx) {
  const v = publicBase(s, pid, ctx);
  return Object.assign(v, {
    lead: s.lead,
    question: { q: s.question.q, options: s.question.options.slice() },
    acted: Object.keys(s.picks),
    myPick: v.watching ? null : (s.picks[pid] ?? null),
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
