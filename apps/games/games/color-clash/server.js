"use strict";
const { roundsSetting, paceSetting, paceFactor } = require("../_sdk");
const round = require("../engines/b4-rounds");
const id = "color-clash";
const manifest = {
  name: "Color Clash",
  tagline: "Read it. Or ignore it.",
  cat: "speed",
  players: { min: 2, max: 20 },
  art: "img/games/color-clash.png",
  howto:
    "Read the big prompt: tap the ink colour or the written word. Everyone sees the same 20 cards. Each card lasts 2.5 seconds at Normal pace. A correct answer earns 5 plus up to 5 for speed. Round scores scale to 100 for the top total.",
  guide: {
    goal: "Follow the prompt without mixing up word and ink.",
    tips: [
      "The prompt alternates between ink and word.",
      "Answer buttons show colour names too.",
      "The small shape marks the ink. Match it to the shape on an answer button.",
      "You get one answer per card. Correct and quick earns the most.",
    ],
  },
  settings: [roundsSetting({ def: 3 }), paceSetting()],
};
function card(s, ctx) {
  if (s.index >= 20) {
    finish(s, ctx);
    return;
  }
  const word = Math.floor(Math.random() * 4);
  s.card = {
    word,
    ink: (word + 1 + Math.floor(Math.random() * 3)) % 4,
    mode: s.index % 2 ? "word" : "ink",
  };
  s.picks = {};
  s.startedAt = ctx.now();
  // A card's explicitly specified sub-three-second pace is part of the game.
  round.window(s, ctx, "card", Math.round(2500 * paceFactor(ctx)), () => {
    s.index++;
    card(s, ctx);
  });
}
function start(s, ctx) {
  if (!round.begin(s)) return;
  s.raw = Object.fromEntries(s.roster.map((pid) => [pid, 0]));
  s.index = 0;
  card(s, ctx);
}
function finish(s, ctx) {
  round.finish(s, ctx, round.scaled(s, s.raw), () => start(s, ctx), {
    raw: { ...s.raw },
  });
}
function create(ctx) {
  const s = round.create(ctx, id, 3);
  s.colors = ctx.content(id).colors || {
    names: ["Blue", "Orange", "Purple", "Teal"],
  };
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
    s.phase !== "card" ||
    !Number.isInteger(a.pick) ||
    a.pick < 0 ||
    a.pick > 3 ||
    a.card !== s.index
  )
    return;
  if (ctx.now() >= s.endsAt) {
    s.index++;
    card(s, ctx);
    return;
  }
  if (s.picks[pid] !== undefined) return;
  const correct = a.pick === s.card[s.card.mode];
  const bonus = Math.max(
    0,
    Math.min(5, Math.round((5 * (s.endsAt - ctx.now())) / s.windowMs)),
  );
  s.picks[pid] = { pick: a.pick, correct };
  if (correct) s.raw[pid] += 5 + bonus;
}
function onPlayerGone(s, ctx, pid) {
  round.gone(s, pid);
  if (!round.active(s).length) round.onEnd(s);
}
function view(s, pid, ctx) {
  return {
    ...round.baseView(s, pid, ctx),
    colors: s.colors,
    card: { ...s.card },
    index: s.index,
    raw: { ...s.raw },
    acted: Object.keys(s.picks),
    myPick: s.picks[pid] || null,
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
