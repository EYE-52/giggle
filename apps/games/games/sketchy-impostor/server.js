"use strict";
const { dealer, roundsSetting, paceSetting } = require("../_sdk");
const R = require("../engines/b6-round");
const Ink = require("../engines/b6-ink");
const id = "sketchy-impostor";
const manifest = {
  name: "Sketchy Impostor",
  tagline: "One pen has no idea what it is drawing.",
  cat: "draw",
  renderer: "canvas",
  art: "img/games/sketchy-impostor.png",
  players: { min: 4, max: 10 },
  howto:
    "Everyone but the Impostor sees a secret word. The Impostor sees only its category. Take two laps in seat order: add one continuous stroke on your turn. Vote for the Impostor. A unique top vote catches them, but they can steal 150 points by guessing the word. If that guess is wrong, correct voters get 100 each. An uncaught Impostor gets 150.",
  guide: {
    goal: "Draw just enough to prove you know the word.",
    tips: [
      "You have one continuous stroke per turn. Lifting your finger ends the turn.",
      "Two laps share one canvas. Each player has a different ink colour.",
      "A tied vote catches nobody. Votes stay hidden until voting ends.",
      "If caught, the Impostor has one guess and 20 seconds to steal the round.",
    ],
  },
  settings: [roundsSetting({ def: 4 }), paceSetting()],
};
function create(ctx) {
  const pack = ctx.content(id) || {};
  const categories = pack.categories?.length
    ? pack.categories
    : [
        {
          name: "Fruit",
          words: [
            "apple",
            "banana",
            "pear",
            "grapes",
            "lemon",
            "orange",
            "cherry",
            "pineapple",
          ],
        },
      ];
  const list = categories.flatMap((c) =>
    c.words.map((word) => ({ category: c.name, word })),
  );
  const s = {
    ...R.base(ctx),
    rounds: ctx.settings().rounds ?? 4,
    deal: dealer(list),
    impostor: null,
    word: "",
    category: "",
    turnIdx: 0,
    turnNo: 0,
    turnPid: null,
    ink: null,
    canvas: [],
    votes: {},
    last: null,
  };
  nextRound(s, ctx);
  return s;
}
function nextRound(s, ctx) {
  if (s.round >= s.rounds || R.active(s).length < 3) {
    R.finish(s);
    return;
  }
  s.round++;
  const item = s.deal();
  s.word = item.word;
  s.category = item.category;
  const ids = R.active(s);
  s.impostor = ids[Math.floor(Math.random() * ids.length)];
  s.canvas = [];
  s.ink = null;
  s.votes = {};
  s.last = null;
  s.turnIdx = -1;
  nextStroke(s, ctx);
}
function nextStroke(s, ctx) {
  if (s.ink) {
    Ink.seal(s.ink);
    s.canvas.push(
      ...s.ink.strokes.map((stroke) => ({ ...stroke, pid: s.turnPid })),
    );
  }
  s.ink = null;
  do {
    s.turnIdx++;
  } while (
    s.turnIdx < s.order.length * 2 &&
    s.gone.includes(s.order[s.turnIdx % s.order.length])
  );
  s.turnNo++;
  if (s.turnIdx >= s.order.length * 2) {
    s.turnPid = null;
    R.arm(s, ctx, "vote", 40, () => countVotes(s, ctx));
    return;
  }
  s.turnPid = s.order[s.turnIdx % s.order.length];
  s.ink = Ink.makeInk();
  R.arm(s, ctx, "draw", 20, () => nextStroke(s, ctx));
}
function countVotes(s, ctx) {
  const counts = Object.fromEntries(R.active(s).map((pid) => [pid, 0]));
  for (const target of Object.values(s.votes))
    if (target in counts) counts[target]++;
  const best = Math.max(0, ...Object.values(counts));
  const top = Object.keys(counts).filter(
    (pid) => counts[pid] === best && best > 0,
  );
  const caught = top.length === 1 && top[0] === s.impostor;
  s.last = {
    caught,
    impostor: s.impostor,
    votes: { ...s.votes },
    counts,
    pts: {},
    guess: "",
    correct: false,
  };
  if (caught && !s.gone.includes(s.impostor))
    R.arm(s, ctx, "guess", 20, () => settle(s, ctx, ""));
  else settle(s, ctx, "");
}
function settle(s, ctx, guess) {
  if (s.phase === "reveal" || s.phase === "done") return;
  const correct =
    guess.trim().toLocaleLowerCase("en") === s.word.toLocaleLowerCase("en");
  const pts = {};
  if (!s.last.caught || correct) pts[s.impostor] = 150;
  else
    for (const [voter, target] of Object.entries(s.votes))
      if (target === s.impostor) pts[voter] = 100;
  s.last = { ...s.last, word: s.word, guess, correct, pts };
  R.award(s, ctx, pts);
  R.arm(s, ctx, "reveal", 8, () => nextRound(s, ctx));
}
function onAction(s, ctx, pid, a) {
  if (!R.valid(s, pid, a)) return false;
  if (R.expired(s, ctx)) {
    if (s.phase === "draw") nextStroke(s, ctx);
    else if (s.phase === "vote") countVotes(s, ctx);
    else if (s.phase === "guess") settle(s, ctx, "");
    else if (s.phase === "reveal") nextRound(s, ctx);
    return;
  }
  if (s.phase === "draw" && pid === s.turnPid && a.turnNo === s.turnNo) {
    const result = Ink.accept(s.ink, a, Ink.COLORS[s.order.indexOf(pid)], true);
    if (result === "finished") nextStroke(s, ctx);
    return result ? undefined : false;
  }
  if (
    s.phase === "vote" &&
    typeof a.vote === "string" &&
    !s.votes[pid] &&
    a.vote !== pid &&
    R.known(s, a.vote)
  ) {
    s.votes[pid] = a.vote;
    if (R.active(s).every((p) => s.votes[p])) countVotes(s, ctx);
  } else if (
    s.phase === "guess" &&
    pid === s.impostor &&
    typeof a.guess === "string" &&
    a.guess.trim() &&
    a.guess.length <= 80
  ) {
    settle(s, ctx, a.guess.trim());
  } else if (s.phase === "reveal" && a.next === true && pid === R.host(s, ctx))
    nextRound(s, ctx);
}
function onPlayerGone(s, ctx, pid) {
  if (!R.gone(s, pid)) return;
  if (R.active(s).length < 3) {
    R.finish(s);
    return;
  }
  if (pid === s.impostor && ["draw", "vote"].includes(s.phase)) {
    s.last = {
      caught: true,
      impostor: pid,
      votes: { ...s.votes },
      counts: {},
      pts: {},
    };
    settle(s, ctx, "");
  } else if (s.phase === "draw" && s.turnPid === pid) nextStroke(s, ctx);
  else if (s.phase === "guess" && s.impostor === pid) settle(s, ctx, "");
  else if (s.phase === "vote" && R.active(s).every((p) => s.votes[p]))
    countVotes(s, ctx);
}
function view(s, pid, ctx) {
  const player = R.known(s, pid),
    revealed = ["guess", "reveal", "done"].includes(s.phase);
  const out = {
    ...R.publicBase(s, ctx),
    category: s.category,
    turnPid: s.turnPid,
    turnNo: s.turnNo,
    lap: Math.min(2, 1 + Math.floor(s.turnIdx / s.order.length)),
    strokes: [
      ...s.canvas,
      ...(s.ink
        ? Ink.strokes(s.ink).map((stroke) => ({ ...stroke, pid: s.turnPid }))
        : []),
    ],
    colors: Object.fromEntries(s.order.map((p, i) => [p, Ink.COLORS[i]])),
    voted: Object.keys(s.votes),
    myVote: player ? s.votes[pid] || null : null,
    role: player ? (pid === s.impostor ? "impostor" : "artist") : null,
    word:
      (player && pid !== s.impostor) || ["reveal", "done"].includes(s.phase)
        ? s.word
        : null,
    impostor: revealed ? s.impostor : null,
    last: revealed ? s.last : null,
  };
  if (player && s.phase === "draw" && pid === s.turnPid)
    Object.assign(out, Ink.tools(s.ink));
  return out;
}
module.exports = {
  id,
  manifest,
  minPlayers: 4,
  maxPlayers: 10,
  create,
  onAction,
  onEnd: R.finish,
  onPlayerGone,
  view,
};
