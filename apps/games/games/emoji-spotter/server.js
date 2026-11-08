"use strict";
const { roundsSetting, paceSetting, paced, dealer } = require("../_sdk");
const round = require("../engines/b4-rounds");
const id = "emoji-spotter";
const manifest = {
  name: "Emoji Spotter",
  tagline: "One face does not fit.",
  cat: "speed",
  players: { min: 2, max: 20 },
  art: "img/games/emoji-spotter.png",
  howto:
    "Find the one different emoji in the grid. First correct tap earns 100 points, then 75, 50 and 25. A wrong tap locks you out for the round. The grid grows from 4 by 4 to 8 by 8.",
  guide: {
    goal: "Spot the odd emoji before everyone else.",
    tips: [
      "Look closely: only one tile is different.",
      "A wrong tap ends your attempt this round.",
      "You have 20 seconds. Equal server times share a place and points.",
    ],
  },
  settings: [roundsSetting({ def: 8 }), paceSetting()],
};
function start(s, ctx) {
  if (!round.begin(s)) return;
  s.size = Math.min(
    8,
    4 + Math.floor(((s.round - 1) * 4) / Math.max(1, s.rounds - 1)),
  );
  const pair = s.deal();
  s.odd = Math.floor(Math.random() * s.size * s.size);
  s.grid = Array.from(
    { length: s.size * s.size },
    (_, i) => pair[i === s.odd ? 1 : 0],
  );
  s.taps = {};
  s.wrong = [];
  round.window(s, ctx, "spot", paced(ctx, 20) * 1000, () => finish(s, ctx));
}
function finish(s, ctx) {
  const times = Object.values(s.taps).sort((a, b) => a - b);
  const pts = Object.fromEntries(
    Object.entries(s.taps).map(([pid, time]) => [
      pid,
      [100, 75, 50, 25][Math.min(3, times.indexOf(time))],
    ]),
  );
  round.finish(s, ctx, pts, () => start(s, ctx), { odd: s.odd });
}
function create(ctx) {
  const s = round.create(ctx, id, 8),
    pairs = ctx.content(id).pairs;
  s.deal = dealer(pairs?.length ? pairs : [["😀", "😃"]]);
  start(s, ctx);
  return s;
}
function settle(s, ctx) {
  if (
    round
      .active(s)
      .every((pid) => s.wrong.includes(pid) || s.taps[pid] !== undefined)
  )
    finish(s, ctx);
}
function onAction(s, ctx, pid, a) {
  if (!round.valid(s, pid, a)) return;
  if (s.phase === "reveal" && a.next === true && pid === ctx.hostId()) {
    start(s, ctx);
    return;
  }
  if (
    s.phase !== "spot" ||
    !Number.isInteger(a.tap) ||
    a.tap < 0 ||
    a.tap >= s.grid.length ||
    a.round !== s.round
  )
    return;
  if (ctx.now() >= s.endsAt) {
    finish(s, ctx);
    return;
  }
  if (s.wrong.includes(pid) || s.taps[pid] !== undefined) return;
  if (a.tap === s.odd) s.taps[pid] = ctx.now();
  else s.wrong.push(pid);
  settle(s, ctx);
}
function onPlayerGone(s, ctx, pid) {
  round.gone(s, pid);
  if (!round.active(s).length) round.onEnd(s);
  else if (s.phase === "spot") settle(s, ctx);
}
function view(s, pid, ctx) {
  return {
    ...round.baseView(s, pid, ctx),
    size: s.size,
    grid: [...s.grid],
    acted: [...Object.keys(s.taps), ...s.wrong],
    wrong: [...s.wrong],
    myHit: s.taps[pid] !== undefined,
    myWrong: s.wrong.includes(pid),
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
