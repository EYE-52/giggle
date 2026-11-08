"use strict";
const { dealer, roundsSetting, paceSetting } = require("../_sdk");
const R = require("../engines/word-party");
const id = "banned-words";
const manifest = {
  name: "Banned Words",
  tagline: "Describe it. Dodge the forbidden four.",
  cat: "word",
  communication: "voice",
  players: { min: 2, max: 20 },
  art: "img/games/banned-words.png",
  settings: [
    roundsSetting({ autoLabel: "Each player describes once", max: 24 }),
    paceSetting(),
  ],
  howto:
    "Take turns describing a secret target aloud without saying its four banned words. Your teammates type guesses during a 60-second turn. Each correct guess deals another card. The other team can Buzz if you say a banned word, discarding that card. The Describer can skip up to three cards. Everyone on the describing team earns 20 points per correct card, capped at 100. With two or three players everyone plays on one team and there is no Buzz. Auto gives every player one describing turn.",
  guide: {
    goal: "Help your team name the target without saying the four banned words.",
    tips: [
      "Only the Describer sees the target. Rivals see the four banned words.",
      "Teammates type guesses; correct answers bring a fresh card.",
      "Rivals may Buzz a banned word. You can skip three times per turn.",
      "Each correct card is worth 20 points per teammate, up to 100.",
    ],
  },
};
function create(ctx) {
  const pack = R.content(ctx, id),
    roster = ctx.allPlayers().map((p) => p.id);
  const s = {
    turnCursor: 0,
    auto: ctx.settings().rounds == null,
    repeats: 1,
    ...R.base(ctx, roster.length),
    coop: roster.length < 4,
    teams: { red: [], blue: [] },
    deal: dealer(pack.cards),
    labels: pack.labels,
    card: null,
    cardNo: 0,
    feedback: {},
  };
  roster.forEach((pid, i) =>
    s.teams[s.coop || i % 2 === 0 ? "red" : "blue"].push(pid),
  );
  next(s, ctx);
  return s;
}
function next(s, ctx) {
  if (s.round >= s.rounds || R.active(s).length < 2) return R.finish(s);
  if (!s.coop && R.active(s).length < 4) {
    s.coop = true;
    s.teams = { red: R.active(s), blue: [] };
  }
  s.round++;
  let pid;
  do {
    pid = s.roster[s.turnCursor++ % s.roster.length];
  } while (!R.known(s, pid));
  s.lead = pid;
  s.team = s.teams.red.includes(s.lead) ? "red" : "blue";
  s.phase = "describe";
  s.correct = 0;
  s.skips = 0;
  s.last = null;
  s.feedback = {};
  deal(s);
  R.timer(s, ctx, 60, () => endRound(s, ctx));
}
function deal(s) {
  s.card = s.deal();
  s.cardNo++;
}
function endRound(s, ctx) {
  if (s.phase !== "describe") return;
  const pts = Object.fromEntries(
    s.teams[s.team].map((p) => [p, Math.min(100, 20 * s.correct)]),
  );
  R.reveal(s, ctx, { pts, correct: s.correct, team: s.team }, () =>
    next(s, ctx),
  );
}
function onAction(s, ctx, pid, a) {
  if (!R.validAction(s, pid, a)) return;
  if (R.canNext(s, ctx, pid, a)) return next(s, ctx);
  if (s.phase !== "describe") return;
  if (R.expired(s, ctx)) return endRound(s, ctx);
  // A revision closes first-tap races: delayed guesses/buzzes cannot hit the next card.
  if (a.cardNo !== s.cardNo) return;
  if (a.skip === true && pid === s.lead && s.skips < 3) {
    s.skips++;
    deal(s);
    s.feedback[pid] = s.labels.skipped;
  } else if (a.buzz === true && !s.coop && !s.teams[s.team].includes(pid)) {
    deal(s);
    s.feedback[pid] = s.labels.buzzed;
  } else if (
    typeof a.guess === "string" &&
    pid !== s.lead &&
    s.teams[s.team].includes(pid)
  ) {
    const guess = R.text(a.guess);
    if (!guess) return;
    if (guess === R.text(s.card.target)) {
      s.correct++;
      s.feedback[pid] = s.labels.correct;
      deal(s);
    } else s.feedback[pid] = s.labels.wrong;
  }
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
    s.phase === "describe" &&
    (pid === s.lead ||
      R.active(s).length < 2 ||
      !s.teams[s.team].some((p) => p !== s.lead && R.known(s, p)))
  )
    endRound(s, ctx);
}
function view(s, pid, ctx) {
  const mine = R.known(s, pid);
  return {
    ...R.commonView(s, ctx),
    lead: s.lead,
    team: s.team,
    teams: s.teams,
    coop: s.coop,
    correct: s.correct,
    skips: s.skips,
    cardNo: s.cardNo,
    card: mine && pid === s.lead && s.phase === "describe" ? s.card : null,
    banned:
      mine &&
      !s.coop &&
      !s.teams[s.team].includes(pid) &&
      s.phase === "describe"
        ? s.card.banned.slice()
        : [],
    myFeedback: mine ? s.feedback[pid] || "" : "",
    acted: [],
  };
}
module.exports = {
  id,
  minPlayers: 2,
  maxPlayers: 20,
  manifest,
  create,
  onAction,
  onPlayerGone,
  onEnd: R.finish,
  dispose: R.cancel,
  view,
};
