"use strict";
const { dealer, roundsSetting, paceSetting } = require("../_sdk");
const R = require("../engines/word-party");
const id = "read-my-lips";
const manifest = {
  name: "Read My Lips",
  tagline: "Silent words. Loud guesses.",
  cat: "camera",
  communication: "video",
  players: { min: 2, max: 12 },
  art: "img/games/read-my-lips.png",
  settings: [
    roundsSetting({ autoLabel: "Each player mouths twice", max: 24 }),
    paceSetting(),
  ],
  howto:
    "The rotating Mouther sees a short phrase and mouths it silently on video with their microphone muted. Everyone else types guesses for 45 seconds. Match all the words for 100 points, or at least half for 50; word order does not matter and repeated words count separately. The first full match gets 50 extra. The Mouther earns 25 for each full match, capped at 100. Your best guess counts. Auto gives every player two mouthing turns. No video is recorded.",
  guide: {
    goal: "Read a silent phrase from the Mouther’s lips.",
    tips: [
      "Mouther: mute your mic and mouth the phrase on your video.",
      "Guessers: type the words you see. Your best guess counts.",
      "All words score 100; at least half score 50. First full match adds 50.",
      "The Mouther gets 25 per full match, capped at 100.",
    ],
  },
};
function match(guess, phrase) {
  const expected = R.text(phrase).split(" "),
    given = R.text(guess).split(" ");
  const counts = Object.create(null);
  for (const w of expected) counts[w] = (counts[w] || 0) + 1;
  let hits = 0;
  for (const w of given)
    if (counts[w]) {
      hits++;
      counts[w]--;
    }
  return hits === expected.length
    ? 100
    : hits >= Math.ceil(expected.length / 2)
      ? 50
      : 0;
}
function create(ctx) {
  const pack = R.content(ctx, id);
  const s = {
    turnCursor: 0,
    auto: ctx.settings().rounds == null,
    repeats: 2,
    ...R.base(ctx, ctx.allPlayers().length * 2),
    deal: dealer(pack.phrases),
    labels: pack.labels,
    results: {},
    guesses: {},
    feedback: {},
    first: null,
  };
  next(s, ctx);
  return s;
}
function next(s, ctx) {
  if (s.round >= s.rounds || R.active(s).length < 2) return R.finish(s);
  s.round++;
  let pid;
  do {
    pid = s.roster[s.turnCursor++ % s.roster.length];
  } while (!R.known(s, pid));
  s.lead = pid;
  s.phrase = s.deal();
  s.phase = "mouth";
  s.results = {};
  s.guesses = {};
  s.feedback = {};
  s.first = null;
  s.last = null;
  R.timer(s, ctx, 45, () => endRound(s, ctx));
}
function endRound(s, ctx) {
  if (s.phase !== "mouth") return;
  const pts = { ...s.results };
  if (s.first) pts[s.first] += 50;
  pts[s.lead] = Math.min(
    100,
    Object.values(s.results).filter((n) => n === 100).length * 25,
  );
  R.reveal(
    s,
    ctx,
    {
      pts,
      phrase: s.phrase,
      results: { ...s.results },
      guesses: { ...s.guesses },
      first: s.first,
    },
    () => next(s, ctx),
  );
}
function onAction(s, ctx, pid, a) {
  if (!R.validAction(s, pid, a)) return;
  if (R.canNext(s, ctx, pid, a)) return next(s, ctx);
  if (
    s.phase !== "mouth" ||
    pid === s.lead ||
    typeof a.guess !== "string" ||
    !R.text(a.guess)
  )
    return;
  if (R.expired(s, ctx)) return endRound(s, ctx);
  if (s.results[pid] === 100) return;
  const score = match(a.guess, s.phrase);
  if (score >= (s.results[pid] || 0)) {
    s.results[pid] = score;
    s.guesses[pid] = a.guess.trim();
  }
  s.feedback[pid] =
    score === 100
      ? s.labels.full
      : score === 50
        ? s.labels.half
        : s.labels.miss;
  if (score === 100) s.first ||= pid;
  if (
    R.active(s)
      .filter((p) => p !== s.lead)
      .every((p) => s.results[p] === 100)
  )
    endRound(s, ctx);
}
function onPlayerGone(s, ctx, pid) {
  if (!R.gone(s, pid) || s.phase === "done") return;
  if (s.auto) {
    let pending = 0;
    for (let i = s.turnCursor; i < s.roster.length * s.repeats; i++) {
      if (s.roster[i % s.roster.length] === pid) pending++;
    }
    s.rounds = Math.max(s.round, s.rounds - pending);
  }
  if (
    s.phase === "mouth" &&
    (pid === s.lead ||
      R.active(s).length < 2 ||
      R.active(s)
        .filter((p) => p !== s.lead)
        .every((p) => s.results[p] === 100))
  )
    endRound(s, ctx);
}
function view(s, pid, ctx) {
  const mine = R.known(s, pid);
  return {
    ...R.commonView(s, ctx),
    lead: s.lead,
    phrase: mine && pid === s.lead && s.phase === "mouth" ? s.phrase : null,
    myGuess: mine ? s.guesses[pid] || "" : "",
    myResult: mine ? s.results[pid] || 0 : 0,
    myFeedback: mine ? s.feedback[pid] || "" : "",
    acted: Object.keys(s.results).filter((p) => s.results[p] === 100),
  };
}
module.exports = {
  id,
  minPlayers: 2,
  maxPlayers: 12,
  manifest,
  create,
  onAction,
  onPlayerGone,
  onEnd: R.finish,
  dispose: R.cancel,
  view,
  match,
};
