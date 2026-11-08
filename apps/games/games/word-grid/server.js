"use strict";
const { shuffle, dealer, roundsSetting, paceSetting } = require("../_sdk");
const { normalizeWord } = require("../engines/english-dictionary");
const { solve, validPath } = require("../engines/word-grid-lexicon");
const R = require("../engines/word-party");
const id = "word-grid";
const manifest = {
  name: "Word Grid",
  tagline: "Trace a word nobody else spots.",
  cat: "word",
  players: { min: 2, max: 20 },
  art: "img/games/word-grid.png",
  settings: [roundsSetting({ def: 3 }), paceSetting()],
  howto:
    "Find dictionary words of three or more letters in the shared four-by-four grid within 90 seconds. Trace touching tiles in any direction, using each tile once per word; Qu is one tile and two letters. You may also type a word and the server finds its path. Three or four letters score 1, five score 2, six score 3, seven score 5, and eight or more score 11. A word found by more than one player scores zero. The top word score earns 100 round points, with equal scores tied; other players earn their share of 100. Finish early when everyone is done. Results show everyone’s words and the five longest possible words.",
  guide: {
    goal: "Find long words that no one else finds.",
    tips: [
      "Trace touching letters, including diagonals. Do not reuse a tile.",
      "Qu counts as two letters on one tile. You can type words too.",
      "Shared words cancel out. Longer unique words score more.",
      "The top score gets 100; everyone else gets a share of 100.",
    ],
  },
};
function wordPoints(word) {
  return word.length <= 4
    ? 1
    : word.length === 5
      ? 2
      : word.length === 6
        ? 3
        : word.length === 7
          ? 5
          : 11;
}
function create(ctx) {
  const pack = R.content(ctx, id);
  const s = {
    ...R.base(ctx, 3),
    dice: pack.dice,
    trayDeal: dealer(pack.trays),
    labels: pack.labels,
    grid: [],
    solutions: {},
    words: {},
    locked: {},
    feedback: {},
  };
  next(s, ctx);
  return s;
}
function next(s, ctx) {
  if (s.round >= s.rounds || R.active(s).length < 2) return R.finish(s);
  s.round++;
  s.phase = "find";
  s.last = null;
  s.locked = {};
  s.feedback = {};
  s.words = Object.fromEntries(R.active(s).map((pid) => [pid, []]));
  // Authored dice-style trays are shuffled into a fresh layout each round.
  s.grid = shuffle(s.trayDeal());
  s.solutions = solve(s.grid);
  // Shuffling positions can make a sparse tray; fall back to its dealt layout.
  if (Object.keys(s.solutions).length < 10) {
    s.grid = s.trayDeal();
    s.solutions = solve(s.grid);
  }
  R.timer(s, ctx, 90, () => endRound(s, ctx));
}
function endRound(s, ctx) {
  if (s.phase !== "find") return;
  const count = {},
    totals = {},
    pts = {};
  for (const words of Object.values(s.words))
    for (const word of words) count[word] = (count[word] || 0) + 1;
  for (const pid of R.active(s))
    totals[pid] = s.words[pid].reduce(
      (n, w) => n + (count[w] === 1 ? wordPoints(w) : 0),
      0,
    );
  const top = Math.max(0, ...Object.values(totals));
  for (const pid of R.active(s))
    pts[pid] = top ? Math.round((100 * totals[pid]) / top) : 0;
  const words = Object.fromEntries(
    Object.entries(s.words).map(([p, words]) => [
      p,
      words.map((word) => ({
        word,
        shared: count[word] > 1,
        points: count[word] === 1 ? wordPoints(word) : 0,
      })),
    ]),
  );
  const longest = Object.keys(s.solutions)
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, 5);
  R.reveal(s, ctx, { pts, totals, words, longest }, () => next(s, ctx));
}
function onAction(s, ctx, pid, a) {
  if (!R.validAction(s, pid, a)) return;
  if (R.canNext(s, ctx, pid, a)) return next(s, ctx);
  if (s.phase !== "find" || s.locked[pid]) return;
  if (R.expired(s, ctx)) return endRound(s, ctx);
  if (a.done === true) {
    s.locked[pid] = true;
    if (R.active(s).every((p) => s.locked[p])) endRound(s, ctx);
    return;
  }
  if (typeof a.word !== "string") return;
  const word = normalizeWord(a.word, 24);
  if (!word || word.length < 3 || !Object.hasOwn(s.solutions, word)) {
    s.feedback[pid] = s.labels.invalid;
    return;
  }
  if (a.path !== undefined && !validPath(s.grid, word, a.path)) {
    s.feedback[pid] = s.labels.path;
    return;
  }
  if (s.words[pid].includes(word)) {
    s.feedback[pid] = s.labels.repeat;
    return;
  }
  s.words[pid].push(word);
  s.feedback[pid] = s.labels.accepted;
}
function onPlayerGone(s, ctx, pid) {
  if (!R.gone(s, pid) || s.phase === "done") return;
  if (
    s.phase === "find" &&
    (R.active(s).length < 2 || R.active(s).every((p) => s.locked[p]))
  )
    endRound(s, ctx);
}
function view(s, pid, ctx) {
  const mine = R.known(s, pid);
  return {
    ...R.commonView(s, ctx),
    grid: [...s.grid],
    mine: mine ? [...(s.words[pid] || [])] : [],
    myLocked: mine && !!s.locked[pid],
    counts: Object.fromEntries(
      Object.entries(s.words).map(([p, words]) => [p, words.length]),
    ),
    acted: Object.keys(s.locked),
    myFeedback: mine ? s.feedback[pid] || "" : "",
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
  wordPoints,
};
