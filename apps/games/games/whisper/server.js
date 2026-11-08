"use strict";
const { dealer, roundsSetting, paceSetting } = require("../_sdk");
const H = require("../engines/b2-party");
const id = "whisper";
const manifest = {
  name: "Whisper",
  tagline: "One name. One coin. Will the secret escape?",
  howto:
    "The Whisperer privately reads a kind question and picks a player in 20 seconds. Everyone sees only that name. Before the coin flips, everyone else guesses heads or tails. A correct guess earns 100; choosing a name in time earns the Whisperer 100. Heads reveals the question. Tails keeps it secret forever. Auto rounds gives everyone one turn as Whisperer.",
  guide: {
    goal: "Read the room, then call the coin.",
    tips: [
      "Only the Whisperer sees the question before the coin flip.",
      "Choose a name in time for 100. A correct coin guess also earns 100.",
      "Heads opens the question. Tails keeps it secret, even at the end.",
    ],
  },
  cat: "social",
  renderer: "dom",
  realtime: false,
  players: { min: 3, max: 20 },
  settings: [
    roundsSetting({ def: null, autoLabel: "One turn each" }),
    paceSetting(),
  ],
  packs: {
    questions: {
      label: "Custom questions",
      type: "string[]",
      minItems: 5,
      maxLen: 140,
    },
  },
  art: "img/games/whisper.png",
};
function create(ctx) {
  const s = H.base(ctx, ctx.allPlayers().length);
  const pack = H.content(ctx, id);
  s.labels = pack.labels || {};
  s.deal = dealer(pack.questions || []);
  s.index = -1;
  nextRound(s, ctx);
  return s;
}
function nextRound(s, ctx) {
  if (s.round >= s.rounds || H.active(s).length < 3) return H.end(s);
  s.round++;
  do {
    s.index = (s.index + 1) % s.ids.length;
  } while (s.gone.includes(s.ids[s.index]));
  s.whisperer = s.ids[s.index];
  s.lead = s.whisperer;
  s.question = s.deal();
  if (!s.question) return H.end(s);
  s.chosen = null;
  s.coin = null;
  s.guesses = {};
  s.last = null;
  H.window(s, ctx, "pick", 20, () => skip(s, ctx, s.labels.timeout || null));
}
function skip(s, ctx, reason) {
  H.reveal(
    s,
    ctx,
    { skipped: true, reason, pts: {}, question: null },
    () => nextRound(s, ctx),
    s.whisperer,
  );
}
function flip(s, ctx) {
  s.coin = Math.random() < 0.5 ? "heads" : "tails";
  // The result stays server-only until the animation finishes.
  H.window(s, ctx, "flip", 3, () => finish(s, ctx));
}
function finish(s, ctx) {
  const pts = {};
  for (const [pid, guess] of Object.entries(s.guesses))
    if (guess === s.coin) pts[pid] = 100;
  H.reveal(
    s,
    ctx,
    {
      pts,
      coin: s.coin,
      chosen: s.chosen,
      question: s.coin === "heads" ? s.question : null,
      guesses: { ...s.guesses },
    },
    () => nextRound(s, ctx),
    s.whisperer,
  );
  // The pick was awarded at once. Include it in the round receipt without awarding twice.
  s.last.pts[s.whisperer] = (s.last.pts[s.whisperer] || 0) + 100;
}
function onAction(s, ctx, pid, a) {
  if (!H.accept(s, ctx, pid, a)) return;
  if (s.phase === "reveal") {
    if (a.next === true && (pid === ctx.hostId() || pid === s.whisperer))
      nextRound(s, ctx);
  } else if (
    s.phase === "pick" &&
    pid === s.whisperer &&
    typeof a.pick === "string" &&
    H.active(s).includes(a.pick)
  ) {
    s.chosen = a.pick;
    H.award(s, ctx, { [pid]: 100 });
    H.window(s, ctx, "guess", 10, () => flip(s, ctx));
  } else if (
    s.phase === "guess" &&
    pid !== s.whisperer &&
    ["heads", "tails"].includes(a.guess) &&
    !Object.hasOwn(s.guesses, pid)
  ) {
    s.guesses[pid] = a.guess;
    if (
      H.complete(
        s,
        ctx,
        s.guesses,
        H.active(s).filter((p) => p !== s.whisperer),
      )
    )
      flip(s, ctx);
  }
}
function onPlayerGone(s, ctx, pid) {
  if (!H.gone(s, pid) || s.phase === "done" || s.phase === "reveal") return;
  if (s.phase === "pick" && pid === s.whisperer)
    return skip(s, ctx, s.labels.left || null);
  if (
    s.phase === "guess" &&
    H.complete(
      s,
      ctx,
      s.guesses,
      H.active(s).filter((p) => p !== s.whisperer),
    )
  )
    flip(s, ctx);
}
function view(s, pid, ctx) {
  const member = H.active(s).includes(pid);
  return {
    ...H.projection(s, pid, ctx),
    whisperer: s.whisperer,
    chosen: s.chosen,
    question:
      member && pid === s.whisperer && ["pick", "guess"].includes(s.phase)
        ? s.question
        : null,
    acted: s.phase === "pick" ? [] : Object.keys(s.guesses || {}),
    myGuess: member ? s.guesses?.[pid] || null : null,
  };
}
module.exports = {
  id,
  manifest,
  minPlayers: 3,
  maxPlayers: 20,
  create,
  onAction,
  view,
  onEnd: H.end,
  onPlayerGone,
};
