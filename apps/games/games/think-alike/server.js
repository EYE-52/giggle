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
const id = "think-alike";
const manifest = {
  name: "Think Alike",
  tagline: "Find your shared brainwave",
  howto:
    "Everyone writes a short answer to the same prompt. Matching answers become sticker piles. The biggest piles with at least two people score 100 each. Other matches score 50 each. Solo answers score zero. Simple plurals and leading a, an or the are ignored.",
  guide: {
    goal: "Find the answer other people are thinking of.",
    tips: [
      "Write one short answer. Keep it simple.",
      "The biggest matching piles earn 100; other matches earn 50.",
      "Solo answers score zero. Tied biggest piles share first place.",
    ],
  },
  cat: "word",
  players: {
    min: 2,
    max: 20,
  },
  renderer: "dom",
  art: "img/games/think-alike.png",
};
manifest.settings = [roundsSetting({ def: 8 }), paceSetting()];
manifest.packs = {
  prompts: {
    label: "Custom prompts",
    type: "string[]",
    minItems: 5,
    maxItems: 200,
    maxLen: 140,
  },
};

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

// A small plural normalizer, not a stemmer: keep bus, glass and cheese intact.
function normalize(value) {
  let x = value
    .toLocaleLowerCase("en")
    .trim()
    .replace(/^(?:a|an|the)\s+/, "")
    .replace(/\s+/g, " ");
  if (/(?:ches|shes|xes|zes|sses)$/.test(x)) x = x.slice(0, -2);
  else if (x.length > 3 && /s$/.test(x) && !/(?:ss|us|is)$/.test(x))
    x = x.slice(0, -1);
  return x;
}
function create(ctx) {
  const pack = ctx.content(id) || {},
    s = base(ctx, pack, ctx.settings().rounds ?? 8);
  s.deal = dealer(pack.prompts?.length ? pack.prompts : [""]);
  nextRound(s, ctx);
  return s;
}
function nextRound(s, ctx) {
  if (s.round >= s.rounds || active(s, ctx).length < 2) return finish(s);
  s.round++;
  s.last = null;
  s.answers = {};
  s.prompt = s.deal();
  windowFor(s, ctx, "answer", 25, () => reveal(s, ctx));
}
function reveal(s, ctx) {
  if (s.phase !== "answer") return;
  const map = new Map(),
    pts = {};
  for (const p of active(s, ctx))
    if (s.answers[p.id]) {
      const answer = s.answers[p.id],
        key = normalize(answer);
      if (!map.has(key)) map.set(key, { answer, members: [] });
      map.get(key).members.push(p.id);
    }
  const groups = [...map.values()],
    biggest = Math.max(0, ...groups.map((g) => g.members.length));
  for (const g of groups)
    for (const pid of g.members)
      pts[pid] =
        g.members.length < 2 ? 0 : g.members.length === biggest ? 100 : 50;
  showResult(s, ctx, { pts, groups });
}
function act(s, ctx, pid, a) {
  if (s.phase !== "answer" || Object.hasOwn(s.answers, pid)) return;
  const answer = text(a.answer, 30);
  if (!answer || !normalize(answer)) return;
  s.answers[pid] = answer;
  if (allIn(active(s, ctx), s.answers)) reveal(s, ctx);
}
function gone(s, ctx, pid) {
  delete s.answers[pid];
  if (allIn(active(s, ctx), s.answers)) reveal(s, ctx);
}
function view(s, pid, ctx) {
  const v = publicBase(s, pid, ctx);
  return Object.assign(v, {
    prompt: s.prompt,
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
  normalize,
};
