"use strict";
const { paceSetting } = require("../_sdk");
const {
  duelPoints,
  drawAction,
  clearDrawOffer,
} = require("../engines/board-duel");
const R = require("../engines/b6-round");
const id = "penalty-kicks";
const manifest = {
  name: "Penalty Kicks",
  tagline: "Pick a corner. Read the keeper.",
  cat: "3d",
  renderer: "3d",
  art: "img/games/penalty-kicks.png",
  players: { min: 2, max: 12 },
  seats: 2,
  howto:
    "Two players alternate shooter and keeper for five kicks each. Both secretly pick one of six goal zones in eight seconds. The shooter also picks soft or hard. An exact keeper pick saves. An adjacent zone has a thirty percent save chance against soft shots. Hard top shots have a twenty percent chance to miss high. A level score goes to paired sudden death. A win is 300 points; an agreed draw is 150 each. Watchers welcome.",
  guide: {
    goal: "Score more penalties than the other player.",
    tips: [
      "Top and bottom each have left, centre and right zones.",
      "Soft shots can be saved from the same or a neighbouring zone.",
      "Hard shots beat neighbouring dives, but top shots can fly over the bar.",
      "Choices stay secret until both lock in. Time picks a random zone for you.",
      "Sudden death ends only after both players have taken the same number of kicks.",
    ],
  },
  settings: [paceSetting()],
};
function create(ctx) {
  const s = {
    ...R.base(ctx),
    kick: 0,
    shooter: null,
    keeper: null,
    choices: {},
    last: null,
    goals: {},
    taken: {},
    history: [],
    drawOffer: null,
    drawBlocked: null,
  };
  s.order = s.order.slice(0, 2);
  s.scores = Object.fromEntries(s.order.map((p) => [p, 0]));
  s.goals = Object.fromEntries(s.order.map((p) => [p, 0]));
  s.taken = Object.fromEntries(s.order.map((p) => [p, 0]));
  nextKick(s, ctx);
  return s;
}
function nextKick(s, ctx) {
  if (
    s.kick >= 10 &&
    s.kick % 2 === 0 &&
    s.goals[s.order[0]] !== s.goals[s.order[1]]
  ) {
    finish(
      s,
      ctx,
      s.goals[s.order[0]] > s.goals[s.order[1]] ? s.order[0] : s.order[1],
      "goals",
    );
    return;
  }
  s.kick++;
  s.round = s.kick;
  s.shooter = s.order[(s.kick - 1) % 2];
  s.keeper = s.order[s.kick % 2];
  s.choices = {};
  s.last = null;
  clearDrawOffer(s);
  R.arm(s, ctx, "pick", 8, () => resolve(s, ctx));
}
function adjacent(a, b) {
  return (
    Math.abs((a % 3) - (b % 3)) +
      Math.abs(Math.floor(a / 3) - Math.floor(b / 3)) ===
    1
  );
}
function resolve(s, ctx) {
  if (s.phase !== "pick") return;
  for (const pid of s.order)
    if (!s.choices[pid])
      s.choices[pid] = { zone: Math.floor(Math.random() * 6), power: "soft" };
  const shot = s.choices[s.shooter],
    dive = s.choices[s.keeper];
  let outcome = "goal";
  if (shot.power === "hard" && shot.zone < 3 && Math.random() < 0.2)
    outcome = "miss";
  else if (
    shot.zone === dive.zone ||
    (shot.power === "soft" &&
      adjacent(shot.zone, dive.zone) &&
      Math.random() < 0.3)
  )
    outcome = "save";
  s.taken[s.shooter]++;
  if (outcome === "goal") s.goals[s.shooter]++;
  s.last = {
    kick: s.kick,
    shooter: s.shooter,
    keeper: s.keeper,
    zone: shot.zone,
    dive: dive.zone,
    power: shot.power,
    outcome,
    shotAt: ctx.now(),
  };
  s.history.push({ ...s.last });
  R.arm(s, ctx, "reveal", 4, () => nextKick(s, ctx));
}
function finish(s, ctx, winner, reason) {
  if (s.phase === "done") return;
  R.award(s, ctx, duelPoints(s.order, winner));
  s.result = { winner, winners: winner ? [winner] : s.order.slice(), reason };
  R.finish(s);
}
function onAction(s, ctx, pid, a) {
  if (!R.valid(s, pid, a)) return false;
  if (a.resign === true) {
    finish(
      s,
      ctx,
      s.order.find((p) => p !== pid),
      "resign",
    );
    return;
  }
  const draw = drawAction(s, pid, a);
  if (draw === "accept") {
    finish(s, ctx, null, "draw");
    return;
  }
  if (draw) return;
  if (s.phase === "pick" && R.expired(s, ctx)) {
    resolve(s, ctx);
    return;
  }
  if (s.phase === "reveal" && a.next === true && pid === R.host(s, ctx)) {
    nextKick(s, ctx);
    return;
  }
  if (
    s.phase !== "pick" ||
    a.kick !== s.kick ||
    s.choices[pid] ||
    !Number.isInteger(a.zone) ||
    a.zone < 0 ||
    a.zone > 5 ||
    (pid === s.shooter && !["soft", "hard"].includes(a.power))
  )
    return false;
  s.choices[pid] = {
    zone: a.zone,
    ...(pid === s.shooter ? { power: a.power } : {}),
  };
  if (s.order.every((p) => s.choices[p])) resolve(s, ctx);
}
function onPlayerGone(s, ctx, pid) {
  if (s.phase === "done" || !s.order.includes(pid)) return;
  finish(
    s,
    ctx,
    s.order.find((p) => p !== pid),
    "forfeit",
  );
}
function view(s, pid, ctx) {
  const player = R.known(s, pid);
  return {
    ...R.publicBase(s, ctx),
    kick: s.kick,
    shooter: s.shooter,
    keeper: s.keeper,
    goals: { ...s.goals },
    taken: { ...s.taken },
    locked: Object.keys(s.choices),
    myChoice: player && s.choices[pid] ? { ...s.choices[pid] } : null,
    role: player ? (pid === s.shooter ? "shooter" : "keeper") : null,
    last: s.last,
    history: s.history.slice(),
    result: s.result || null,
    drawOffer: s.drawOffer,
    drawBlocked: s.drawBlocked,
  };
}
module.exports = {
  id,
  manifest,
  minPlayers: 2,
  maxPlayers: 12,
  create,
  onAction,
  onEnd: R.finish,
  onPlayerGone,
  view,
  adjacent,
};
