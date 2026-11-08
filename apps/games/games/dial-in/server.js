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
const id = "dial-in";
const manifest = {
  name: "Dial In",
  tagline: "Give a clue, find the spot",
  howto:
    "The Dialer sees a secret target from 0 to 100 and gives a clue on a spectrum. Everyone else locks a guess. Within 4 scores 100, within 10 scores 50, and within 18 scores 25. The Dialer earns the rounded average. A missing clue skips the round.",
  guide: {
    goal: "Guide the room to a secret spot on a spectrum.",
    tips: [
      "Take turns giving one short clue for a secret target.",
      "Move the dial, then lock your guess. Closer earns more.",
      "The Dialer earns the average of the guessing points.",
    ],
  },
  cat: "vote",
  players: {
    min: 2,
    max: 20,
  },
  renderer: "dom",
  art: "img/games/dial-in.png",
};
manifest.settings = [
  roundsSetting({ def: null, max: 20, autoLabel: "One turn each" }),
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
    n = ctx.allPlayers().length;
  const s = base(ctx, pack, ctx.settings().rounds ?? Math.max(2, n));
  s.deal = dealer(pack.spectra?.length ? pack.spectra : [["", ""]]);
  s.rotation = s.roster.slice();
  s.cursor = 0;
  s.autoRounds = ctx.settings().rounds == null;
  s.schedule = Array.from(
    { length: s.rounds },
    (_, i) => s.roster[i % s.roster.length],
  );
  nextRound(s, ctx);
  return s;
}
function nextRound(s, ctx) {
  if (s.round >= s.rounds || active(s, ctx).length < 2) return finish(s);
  s.round++;
  s.last = null;
  s.clue = "";
  s.guesses = {};
  const live = active(s, ctx).map((p) => p.id);
  if (s.autoRounds) s.lead = s.schedule[s.round - 1];
  else
    do {
      s.lead = s.rotation[s.cursor++ % s.rotation.length];
    } while (!live.includes(s.lead));
  s.spectrum = s.deal();
  s.target = Math.floor(Math.random() * 101);
  windowFor(s, ctx, "clue", 45, () => skip(s, ctx, s.labels.noClue));
}
function skip(s, ctx, reason) {
  showResult(s, ctx, { pts: {}, skipped: true, reason });
}
function guessers(s, ctx) {
  return active(s, ctx).filter((p) => p.id !== s.lead);
}
function reveal(s, ctx) {
  if (s.phase !== "guess") return;
  const pts = {},
    guesses = {};
  for (const p of guessers(s, ctx))
    if (Object.hasOwn(s.guesses, p.id)) {
      const g = s.guesses[p.id],
        d = Math.abs(g - s.target);
      guesses[p.id] = g;
      pts[p.id] = d <= 4 ? 100 : d <= 10 ? 50 : d <= 18 ? 25 : 0;
    }
  const voters = guessers(s, ctx);
  if (voters.length)
    pts[s.lead] = Math.round(
      voters.reduce((sum, p) => sum + (pts[p.id] || 0), 0) / voters.length,
    );
  showResult(s, ctx, { pts, guesses, target: s.target });
}
function act(s, ctx, pid, a) {
  if (s.phase === "clue" && pid === s.lead) {
    const clue = text(a.clue, 40);
    if (!clue) return;
    s.clue = clue;
    windowFor(s, ctx, "guess", 30, () => reveal(s, ctx));
  } else if (
    s.phase === "guess" &&
    pid !== s.lead &&
    !Object.hasOwn(s.guesses, pid) &&
    Number.isInteger(a.guess) &&
    a.guess >= 0 &&
    a.guess <= 100
  ) {
    s.guesses[pid] = a.guess;
    if (allIn(guessers(s, ctx), s.guesses)) reveal(s, ctx);
  }
}
function gone(s, ctx, pid) {
  delete s.guesses[pid];
  if (pid === s.lead) skip(s, ctx, s.labels.leadLeft);
  else if (s.phase === "guess" && allIn(guessers(s, ctx), s.guesses))
    reveal(s, ctx);
}
function view(s, pid, ctx) {
  const v = publicBase(s, pid, ctx);
  Object.assign(v, {
    lead: s.lead,
    spectrum: s.spectrum.slice(),
    clue: s.clue,
    acted: Object.keys(s.guesses),
    myGuess: v.watching ? null : (s.guesses[pid] ?? null),
  });
  if (!v.watching && pid === s.lead && s.phase === "clue") v.target = s.target;
  return v;
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
