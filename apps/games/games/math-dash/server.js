"use strict";
const { roundsSetting, paceSetting, paced } = require("../_sdk");
const round = require("../engines/b4-rounds");
const id = "math-dash";
const manifest = {
  name: "Math Dash",
  tagline: "Small sums. Big sprint.",
  cat: "speed",
  players: { min: 2, max: 20 },
  art: "img/games/math-dash.png",
  howto:
    "Solve as many problems as you can in 45 seconds. Everyone gets the same sequence. A wrong answer locks your pad for 2 seconds. The top count earns 100 points; everyone else earns a share.",
  guide: {
    goal: "Solve the most problems before the sprint ends.",
    tips: [
      "Use your keyboard or the big number pad.",
      "A wrong answer pauses you for 2 seconds.",
      "Tied counts earn equal points.",
      "Easy: sums to 20. Normal: times tables. Hard: two steps.",
    ],
  },
  settings: [
    roundsSetting({ def: 3 }),
    paceSetting(),
    {
      key: "difficulty",
      label: "Difficulty",
      type: "enum",
      options: ["Easy", "Normal", "Hard"],
      def: "Normal",
    },
  ],
};
// A problem is derived from the private round seed and its index. No future
// problems or solutions cross the socket. Every seat sees the same sequence.
function problem(s, index) {
  let seed = (s.seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  const rng = (max) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % max;
  };
  if (s.difficulty === "Easy") {
    const a = rng(21),
      b = rng(21 - a);
    return rng(2)
      ? { text: `${a} + ${b}`, answer: a + b }
      : { text: `${a + b} − ${a}`, answer: b };
  }
  const a = 1 + rng(12),
    b = 1 + rng(12);
  if (s.difficulty === "Hard") {
    const c = rng(21);
    return rng(2)
      ? { text: `(${a} × ${b}) + ${c}`, answer: a * b + c }
      : { text: `(${a * b} ÷ ${b}) − ${c}`, answer: a - c };
  }
  return rng(2)
    ? { text: `${a} × ${b}`, answer: a * b }
    : { text: `${a * b} ÷ ${b}`, answer: a };
}
function start(s, ctx) {
  if (!round.begin(s)) return;
  s.seed = Math.floor(Math.random() * 0x100000000);
  s.correct = Object.fromEntries(s.roster.map((pid) => [pid, 0]));
  s.locked = {};
  round.window(s, ctx, "sprint", paced(ctx, 45) * 1000, () => finish(s, ctx));
}
function finish(s, ctx) {
  round.finish(s, ctx, round.scaled(s, s.correct), () => start(s, ctx), {
    counts: { ...s.correct },
  });
}
function create(ctx) {
  const s = round.create(ctx, id, 3);
  s.difficulty = ["Easy", "Normal", "Hard"].includes(ctx.settings().difficulty)
    ? ctx.settings().difficulty
    : "Normal";
  start(s, ctx);
  return s;
}
function onAction(s, ctx, pid, a) {
  if (!round.valid(s, pid, a)) return;
  if (s.phase === "reveal" && a.next === true && pid === ctx.hostId()) {
    start(s, ctx);
    return;
  }
  if (
    s.phase !== "sprint" ||
    !Number.isSafeInteger(a.answer) ||
    a.index !== s.correct[pid]
  )
    return;
  if (ctx.now() >= s.endsAt) {
    finish(s, ctx);
    return;
  }
  if (ctx.now() < (s.locked[pid] || 0)) return;
  if (a.answer === problem(s, s.correct[pid]).answer) s.correct[pid]++;
  else s.locked[pid] = ctx.now() + 2000;
}
function onPlayerGone(s, ctx, pid) {
  round.gone(s, pid);
  if (!round.active(s).length) round.onEnd(s);
}
function view(s, pid, ctx) {
  const playing = round.active(s).includes(pid);
  return {
    ...round.baseView(s, pid, ctx),
    difficulty: s.difficulty,
    counts: { ...s.correct },
    index: playing ? s.correct[pid] : null,
    problem:
      playing && s.phase === "sprint" ? problem(s, s.correct[pid]).text : "",
    lockedUntil: playing ? s.locked[pid] || 0 : 0,
  };
}
module.exports = {
  id,
  manifest,
  minPlayers: 2,
  maxPlayers: 20,
  create,
  onAction,
  onPlayerGone,
  onEnd: round.onEnd,
  view,
  problem,
};
