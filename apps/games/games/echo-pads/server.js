"use strict";
const { roundsSetting, paceSetting, paced, paceFactor } = require("../_sdk");
const round = require("../engines/b4-rounds");
const id = "echo-pads";
const manifest = {
  name: "Echo Pads",
  tagline: "Watch the beat. Tap it back.",
  cat: "speed",
  players: { min: 2, max: 20 },
  art: "img/games/echo-pads.png",
  howto:
    "Watch the four pads light up, then repeat the sequence. It starts at 3 steps and grows by one each level. A miss knocks you out of the round. Last survivors earn 100; others earn a share for the levels cleared. Clear level 15 to finish.",
  guide: {
    goal: "Remember the longest sequence.",
    tips: [
      "Every pad has a shape and a sound as well as a colour.",
      "Wait until the prompt says to repeat.",
      "You have 3 seconds plus 0.8 seconds per step, scaled by Pace.",
    ],
  },
  settings: [roundsSetting({ def: 3 }), paceSetting()],
};
function finish(s, ctx, winners) {
  const best = Math.max(1, ...Object.values(s.reached));
  const pts = Object.fromEntries(
    s.roster.map((pid) => [
      pid,
      winners.includes(pid) ? 100 : Math.round((100 * s.reached[pid]) / best),
    ]),
  );
  round.finish(s, ctx, pts, () => start(s, ctx), {
    reached: { ...s.reached },
    winners,
  });
}
function settle(s, ctx) {
  if (s.phase !== "repeat" || !s.alive.every((pid) => s.passed.includes(pid)))
    return;
  if (!s.alive.length) {
    finish(
      s,
      ctx,
      s.levelPlayers.filter((pid) => !s.gone.includes(pid)),
    );
    return;
  }
  if (s.alive.length === 1 || s.level === 15) {
    finish(s, ctx, [...s.alive]);
    return;
  }
  s.level++;
  show(s, ctx);
}
function repeat(s, ctx) {
  s.cursor = Object.fromEntries(s.alive.map((pid) => [pid, 0]));
  s.passed = [];
  round.window(
    s,
    ctx,
    "repeat",
    paced(ctx, 3 + 0.8 * s.sequence.length) * 1000,
    () => {
      s.alive = s.alive.filter((pid) => s.passed.includes(pid));
      settle(s, ctx);
    },
  );
}
function show(s, ctx) {
  s.levelPlayers = [...s.alive];
  s.sequence.push(
    ...Array.from({ length: s.level === 1 ? 3 : 1 }, () =>
      Math.floor(Math.random() * 4),
    ),
  );
  s.showIndex = 0;
  s.stepMs = Math.round(750 * paceFactor(ctx));
  round.window(s, ctx, "show", s.sequence.length * s.stepMs, () =>
    repeat(s, ctx),
  );
  const token = s.turnNo,
    level = s.level;
  for (let i = 1; i < s.sequence.length; i++) {
    ctx.later(i * s.stepMs, () => {
      if (s.phase !== "show" || s.turnNo !== token || s.level !== level) return;
      s.showIndex = i;
      ctx.broadcast();
    });
  }
}
function start(s, ctx) {
  if (!round.begin(s)) return;
  s.level = 1;
  s.alive = round.active(s);
  s.reached = Object.fromEntries(s.roster.map((pid) => [pid, 0]));
  s.sequence = [];
  s.cursor = {};
  s.passed = [];
  show(s, ctx);
}
function create(ctx) {
  const s = round.create(ctx, id, 3);
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
    s.phase !== "repeat" ||
    !s.alive.includes(pid) ||
    s.passed.includes(pid) ||
    !Number.isInteger(a.pad) ||
    a.pad < 0 ||
    a.pad > 3 ||
    a.level !== s.level ||
    a.step !== s.cursor[pid]
  )
    return;
  if (ctx.now() >= s.endsAt) {
    s.alive = s.alive.filter((p) => s.passed.includes(p));
    settle(s, ctx);
    return;
  }
  if (a.pad !== s.sequence[s.cursor[pid]])
    s.alive = s.alive.filter((p) => p !== pid);
  else {
    s.cursor[pid]++;
    if (s.cursor[pid] === s.sequence.length) {
      s.passed.push(pid);
      s.reached[pid] = s.level;
    }
  }
  settle(s, ctx);
}
function onPlayerGone(s, ctx, pid) {
  round.gone(s, pid);
  s.alive = s.alive.filter((p) => p !== pid);
  if (!round.active(s).length) round.onEnd(s);
  else if (s.phase === "repeat") settle(s, ctx);
}
function view(s, pid, ctx) {
  return {
    ...round.baseView(s, pid, ctx),
    level: s.level,
    length: s.sequence.length,
    activePad: s.phase === "show" ? s.sequence[s.showIndex] : null,
    showIndex: s.showIndex,
    stepMs: s.stepMs,
    alive: [...s.alive],
    acted: [...s.passed],
    reached: { ...s.reached },
    myStep: round.active(s).includes(pid) ? s.cursor[pid] || 0 : null,
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
};
