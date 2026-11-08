"use strict";
const { shuffle, roundsSetting, paceSetting } = require("../_sdk");
const R = require("../engines/word-party");
const id = "clue-grid";
const manifest = {
  name: "Clue Grid",
  tagline: "One clue. Twenty-five possibilities.",
  cat: "word",
  players: { min: 2, max: 16 },
  communication: "voice",
  art: "img/games/clue-grid.png",
  settings: [roundsSetting({ def: 3 }), paceSetting()],
  howto:
    "Two teams search a five-by-five word grid. The starting team has nine targets, the other eight, with seven neutral cards and one trap. Only the rotating Spymasters see the key. Give one word, away from the grid words, and a number from zero to nine within 90 seconds. Teammates have 90 seconds to open up to that number plus one cards, or pass after one. A wrong colour ends the turn; the trap loses the round. Find all your targets for 100 each and 50 extra for the Spymaster. Two turns with no cards end a round as a draw. With two or three players, one Spymaster helps everyone find nine targets in eight turns: 100 each for success, or 50 if only one is missing.",
  guide: {
    goal: "Link your targets with one word and steer clear of the trap.",
    tips: [
      "Spymasters see the key; guessers only see opened cards.",
      "Give one word and a number. Guess at most that number plus one.",
      "A neutral or rival card ends your turn. The trap loses the round.",
      "With two or three players, find nine targets together in eight turns.",
    ],
  },
};
function split(s) {
  s.teams = { red: [], blue: [] };
  shuffle(R.active(s)).forEach((pid, i) =>
    s.teams[s.coop || i % 2 === 0 ? "red" : "blue"].push(pid),
  );
}
function create(ctx) {
  const pack = R.content(ctx, id);
  const s = {
    ...R.base(ctx, 3),
    words: pack.words,
    labels: pack.labels,
    coop: ctx.allPlayers().length < 4,
    turnNo: 0,
    leads: {},
    teams: {},
    cards: [],
    clue: null,
    team: "red",
    idle: 0,
  };
  split(s);
  setup(s, ctx);
  return s;
}
function setup(s, ctx) {
  if (s.round >= s.rounds || R.active(s).length < 2) return R.finish(s);
  if (!s.coop && R.active(s).length < 4) {
    s.coop = true;
    split(s);
  }
  s.round++;
  s.phase = "setup";
  s.last = null;
  s.cards = [];
  s.clue = null;
  s.leads = Object.fromEntries(
    ["red", "blue"].map((team) => {
      const ps = s.teams[team].filter((pid) => R.known(s, pid));
      return [team, ps[(s.round - 1) % ps.length] || null];
    }),
  );
  R.timer(s, ctx, 15, () => start(s, ctx));
}
function start(s, ctx) {
  if (s.phase !== "setup") return;
  s.team = s.coop || s.round % 2 ? "red" : "blue";
  const other = s.team === "red" ? "blue" : "red";
  const key = s.coop
    ? [...Array(9).fill("red"), ...Array(15).fill("neutral"), "trap"]
    : [
        ...Array(9).fill(s.team),
        ...Array(8).fill(other),
        ...Array(7).fill("neutral"),
        "trap",
      ];
  const words = shuffle([...new Set(s.words)]).slice(0, 25);
  s.cards = shuffle(key).map((kind, i) => ({
    word: words[i],
    kind,
    open: false,
  }));
  s.turns = 0;
  s.idle = 0;
  clueTurn(s, ctx);
}
function clueTurn(s, ctx) {
  s.turnNo++;
  s.turns++;
  s.phase = "clue";
  s.clue = null;
  s.picks = 0;
  s.openedBefore = s.cards.filter((c) => c.open).length;
  s.lead = s.leads[s.team];
  R.timer(s, ctx, 90, () => endTurn(s, ctx));
}
function result(s, ctx, winner, reason) {
  if (s.phase === "reveal" || s.phase === "done") return;
  const pts = {};
  if (s.coop) {
    const left = s.cards.filter((c) => c.kind === "red" && !c.open).length;
    const n =
      winner === "red" ? 100 : reason === s.labels.turns && left === 1 ? 50 : 0;
    for (const p of R.active(s)) pts[p] = n;
  } else if (winner) {
    for (const p of s.teams[winner])
      pts[p] = 100 + (s.leads[winner] === p ? 50 : 0);
  }
  R.reveal(s, ctx, { pts, winner, reason }, () => setup(s, ctx));
}
function endTurn(s, ctx) {
  if (!["clue", "guess"].includes(s.phase)) return;
  const changed = s.cards.filter((c) => c.open).length > s.openedBefore;
  s.idle = changed ? 0 : s.idle + 1;
  if (s.coop && s.turns >= 8) return result(s, ctx, null, s.labels.turns);
  if (!s.coop && s.idle >= 2) return result(s, ctx, null, s.labels.noPlay);
  if (!s.coop) s.team = s.team === "red" ? "blue" : "red";
  clueTurn(s, ctx);
}
function onAction(s, ctx, pid, a) {
  if (!R.validAction(s, pid, a)) return;
  if (R.canNext(s, ctx, pid, a)) return setup(s, ctx);
  if (s.phase === "setup") {
    if (pid !== ctx.hostId()) return;
    if (a.reshuffle === true) {
      split(s);
      for (const t of ["red", "blue"])
        s.leads[t] = s.teams[t][(s.round - 1) % s.teams[t].length] || null;
    }
    if (a.start === true) start(s, ctx);
    return;
  }
  if (!["clue", "guess"].includes(s.phase)) return;
  if (R.expired(s, ctx)) return endTurn(s, ctx);
  if (s.phase === "clue" && pid === s.lead && typeof a.clue === "string") {
    const word = a.clue.trim();
    if (
      !/^[a-z]{1,30}$/i.test(word) ||
      !Number.isInteger(a.number) ||
      a.number < 0 ||
      a.number > 9 ||
      s.cards.some((c) => c.word.toLowerCase() === word.toLowerCase())
    )
      return;
    s.clue = { word, number: a.number };
    s.phase = "guess";
    R.timer(s, ctx, 90, () => endTurn(s, ctx));
  } else if (
    s.phase === "guess" &&
    s.teams[s.team].includes(pid) &&
    pid !== s.lead
  ) {
    if (a.pass === true && s.picks >= 1) return endTurn(s, ctx);
    if (
      !Number.isInteger(a.card) ||
      a.card < 0 ||
      a.card >= 25 ||
      s.cards[a.card].open
    )
      return;
    const c = s.cards[a.card];
    c.open = true;
    s.picks++;
    if (c.kind === "trap")
      return result(
        s,
        ctx,
        s.coop ? null : s.team === "red" ? "blue" : "red",
        s.labels.trap,
      );
    const winner = ["red", ...(s.coop ? [] : ["blue"])].find((t) =>
      s.cards.every((c) => c.kind !== t || c.open),
    );
    if (winner) return result(s, ctx, winner, s.labels.complete);
    if (c.kind !== s.team || s.picks >= s.clue.number + 1) endTurn(s, ctx);
  }
}
function onPlayerGone(s, ctx, pid) {
  const wasLead = s.lead === pid;
  if (!R.gone(s, pid) || s.phase === "done") return;
  if (R.active(s).length < 2) return R.finish(s);
  for (const team of ["red", "blue"]) {
    const members = s.teams[team].filter((p) => R.known(s, p));
    if (
      !members.length &&
      !s.coop &&
      s.phase !== "setup" &&
      s.phase !== "reveal"
    )
      return result(s, ctx, team === "red" ? "blue" : "red", s.labels.empty);
    if (!members.includes(s.leads[team])) s.leads[team] = members[0] || null;
  }
  if (
    !s.coop &&
    R.active(s).length < 4 &&
    !["setup", "reveal"].includes(s.phase)
  ) {
    return result(s, ctx, null, s.labels.teamChanged);
  }
  s.lead = s.leads[s.team];
  // The replacement receives a fresh clue window when the current Spymaster leaves.
  if (s.phase === "clue" && wasLead) R.timer(s, ctx, 90, () => endTurn(s, ctx));
}
function view(s, pid, ctx) {
  const spy = R.known(s, pid) && Object.values(s.leads).includes(pid);
  return {
    ...R.commonView(s, ctx),
    coop: s.coop,
    teams: s.teams,
    leads: s.leads,
    lead: s.lead,
    team: s.team,
    turns: s.turns || 0,
    clue: s.clue,
    picks: s.picks || 0,
    cards: s.cards.map((c) => ({
      word: c.word,
      open: c.open,
      ...(c.open || spy || s.phase === "reveal" || s.phase === "done"
        ? { kind: c.kind }
        : {}),
    })),
    isSpymaster: spy,
    acted: [],
  };
}
module.exports = {
  id,
  minPlayers: 2,
  maxPlayers: 16,
  manifest,
  create,
  onAction,
  onPlayerGone,
  onEnd: R.finish,
  dispose: R.cancel,
  view,
};
