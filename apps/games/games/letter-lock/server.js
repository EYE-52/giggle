"use strict";
const { dealer, roundsSetting, paceSetting } = require("../_sdk");
const {
  createWordValidator,
  normalizeWord,
} = require("../engines/english-dictionary");
const R = require("../engines/word-party");
const id = "letter-lock";
const manifest = {
  name: "Letter Lock",
  tagline: "Six rows. One secret. Beat the room.",
  cat: "word",
  players: { min: 2, max: 20 },
  art: "img/games/letter-lock.png",
  settings: [roundsSetting({ def: 5 }), paceSetting()],
  howto:
    "Race to solve the same five-letter word in six tries and 120 seconds. Each row marks letters as right spot, in word, or absent; repeated letters only count as often as they occur. Other players see your marks, never your letters. Solve for 100, plus 10 per unused try and 50 for the first solver, with extras capped at 100. A failed board with at least three right spots in one row gets 50. The host can press Next after results.",
  guide: {
    goal: "Crack the secret word before your six rows run out.",
    tips: [
      "Type a dictionary word with five letters, then check it.",
      "A check means the right spot; a dot means the letter is elsewhere.",
      "Solving scores 100; spare rows and the first solve add up to 100.",
      "Three right spots in one row earn 50 if you do not solve.",
    ],
  },
};
function marks(word, answer) {
  const result = Array(5).fill("absent"),
    remaining = {};
  for (let i = 0; i < 5; i++) {
    if (word[i] === answer[i]) result[i] = "right";
    else remaining[answer[i]] = (remaining[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (result[i] !== "right" && remaining[word[i]]) {
      result[i] = "present";
      remaining[word[i]]--;
    }
  }
  return result;
}
function create(ctx) {
  const pack = R.content(ctx, id),
    validator = createWordValidator();
  const words = pack.answers
    .map((w) => normalizeWord(w, 5))
    .filter((w) => w?.length === 5 && validator.has(w));
  const s = {
    ...R.base(ctx, 5),
    validator,
    labels: pack.labels || {},
    deal: dealer(words.length ? words : ["apple"]),
    rows: {},
    solved: {},
    first: null,
    feedback: {},
  };
  next(s, ctx);
  return s;
}
function next(s, ctx) {
  if (s.round >= s.rounds || R.active(s).length < 2) return R.finish(s);
  s.round++;
  s.phase = "solve";
  s.answer = s.deal();
  s.last = null;
  s.rows = Object.fromEntries(R.active(s).map((pid) => [pid, []]));
  s.solved = {};
  s.feedback = {};
  s.first = null;
  R.timer(s, ctx, 120, () => endRound(s, ctx));
}
function endRound(s, ctx) {
  if (s.phase !== "solve") return;
  const pts = {};
  for (const pid of R.active(s)) {
    const rows = s.rows[pid] || [];
    pts[pid] = s.solved[pid]
      ? 100 + Math.min(100, (6 - rows.length) * 10 + (pid === s.first ? 50 : 0))
      : rows.some((row) => row.marks.filter((m) => m === "right").length >= 3)
        ? 50
        : 0;
  }
  R.reveal(s, ctx, { answer: s.answer, pts, first: s.first }, () =>
    next(s, ctx),
  );
}
function onAction(s, ctx, pid, a) {
  if (!R.validAction(s, pid, a)) return;
  if (R.canNext(s, ctx, pid, a)) return next(s, ctx);
  if (s.phase !== "solve" || typeof a.guess !== "string") return;
  if (R.expired(s, ctx)) return endRound(s, ctx);
  if (s.solved[pid] || s.rows[pid].length >= 6) return;
  const word = normalizeWord(a.guess, 5);
  if (!word || word.length !== 5 || !s.validator.has(word)) {
    s.feedback[pid] = s.labels.invalid || "Use a valid five-letter word.";
    return;
  }
  if (s.rows[pid].some((row) => row.word === word)) {
    s.feedback[pid] = s.labels.repeat || "Try a different word.";
    return;
  }
  s.rows[pid].push({ word, marks: marks(word, s.answer) });
  s.feedback[pid] = s.labels.accepted || "";
  if (word === s.answer) {
    s.solved[pid] = true;
    s.first ||= pid;
  }
  if (R.active(s).every((p) => s.solved[p] || s.rows[p].length >= 6))
    endRound(s, ctx);
}
function onPlayerGone(s, ctx, pid) {
  if (!R.gone(s, pid) || s.phase === "done") return;
  if (
    s.phase === "solve" &&
    (R.active(s).length < 2 ||
      R.active(s).every((p) => s.solved[p] || s.rows[p].length >= 6))
  )
    endRound(s, ctx);
}
function view(s, pid, ctx) {
  const mine = R.known(s, pid);
  return {
    ...R.commonView(s, ctx),
    boards: Object.fromEntries(
      Object.entries(s.rows).map(([p, rows]) => [
        p,
        rows.map((row) => ({
          marks: [...row.marks],
          ...(p === pid && mine ? { word: row.word } : {}),
        })),
      ]),
    ),
    myRows: mine ? s.rows[pid] || [] : [],
    solved: Object.keys(s.solved),
    myFeedback: mine ? s.feedback[pid] || "" : "",
    acted: R.active(s).filter((p) => s.solved[p] || s.rows[p]?.length >= 6),
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
  marks,
};
