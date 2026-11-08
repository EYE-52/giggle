"use strict";
const {
  dealer,
  shuffle,
  tally,
  roundsSetting,
  paceSetting,
} = require("../_sdk");
const H = require("../engines/b2-party");
const id = "backronyms";
const manifest = {
  name: "Backronyms",
  tagline: "Tiny letters. Ridiculous big ideas.",
  howto:
    "Write a phrase using the shown letters as word initials, in order. Use exactly one word per letter and no more than 80 characters. Vote for an anonymous phrase other than your own. The top entries earn 100, including ties. Others earn 25 per vote, up to 100. Voting for any top entry adds 25.",
  guide: {
    goal: "Turn the initials into the phrase everyone picks.",
    tips: [
      "Use exactly one word per letter, in the same order.",
      "Entries stay secret until voting. You cannot vote for your own.",
      "Every tied top entry earns 100; picking a top entry adds 25.",
    ],
  },
  cat: "bluff",
  renderer: "dom",
  realtime: false,
  players: { min: 3, max: 20 },
  settings: [roundsSetting({ def: 6 }), paceSetting()],
  packs: {
    categories: {
      label: "Custom categories",
      type: "string[]",
      minItems: 5,
      maxLen: 100,
    },
  },
  art: "img/games/backronyms.png",
};
function create(ctx) {
  const s = H.base(ctx, 6),
    pack = H.content(ctx, id);
  s.answers = {};
  s.votes = {};
  s.entries = [];
  s.labels = pack.labels || {};
  s.deal = dealer(pack.categories || []);
  s.letterBag =
    pack.letterBag ||
    "AAAAABBCCDDDDEEEEEFFGGHHIIIIJKLLLMMMNNNNOOOOPPRRRRSSSSTTTTTUUUVWWY";
  nextRound(s, ctx);
  return s;
}
function nextRound(s, ctx) {
  if (s.round >= s.rounds || H.active(s).length < 3) return H.end(s);
  s.round++;
  s.category = s.deal();
  if (!s.category) return H.end(s);
  const length = 3 + Math.floor(Math.random() * 3);
  s.letters = Array.from(
    { length },
    () => s.letterBag[Math.floor(Math.random() * s.letterBag.length)],
  );
  // A rare unusual starter is deliberate, never the normal experience.
  if (Math.random() < 0.02) s.letters[0] = shuffle(["Q", "X", "Z"])[0];
  s.answers = {};
  s.votes = {};
  s.entries = [];
  s.last = null;
  H.window(s, ctx, "write", 60, () => vote(s, ctx));
}
function valid(s, text) {
  if (typeof text !== "string" || text.trim().length < 1 || text.length > 80)
    return false;
  const words = text.trim().split(/\s+/u);
  return (
    words.length === s.letters.length &&
    words.every(
      (word, i) =>
        /^[\p{L}]+(?:['’-][\p{L}]+)*[.!?,]?$/u.test(word) &&
        word[0].toUpperCase() === s.letters[i],
    )
  );
}
function vote(s, ctx) {
  s.entries = shuffle(
    Object.entries(s.answers).filter(([pid]) => H.active(s).includes(pid)),
  ).map(([pid, text], i) => ({ id: "entry-" + i, pid, text }));
  if (!s.entries.length) return finish(s, ctx);
  H.window(s, ctx, "vote", 30, () => finish(s, ctx));
}
function finish(s, ctx) {
  const { winners, counts } = tally(s.votes),
    pts = {};
  for (const entry of s.entries) {
    const n = counts[entry.id]?.n || 0;
    if (n)
      pts[entry.pid] = winners.includes(entry.id) ? 100 : Math.min(100, n * 25);
  }
  for (const [pid, choice] of Object.entries(s.votes))
    if (winners.includes(choice)) pts[pid] = (pts[pid] || 0) + 25;
  H.reveal(
    s,
    ctx,
    {
      pts,
      winners,
      entries: s.entries,
      votes: { ...s.votes },
      skipped: !s.entries.length,
      reason: !s.entries.length ? s.labels.noPhrases || null : null,
    },
    () => nextRound(s, ctx),
  );
}
function voters(s) {
  return H.active(s).filter((pid) => s.entries.some((e) => e.pid !== pid));
}
function onAction(s, ctx, pid, a) {
  if (!H.accept(s, ctx, pid, a)) return;
  if (s.phase === "reveal") {
    if (a.next === true && pid === ctx.hostId()) nextRound(s, ctx);
  } else if (
    s.phase === "write" &&
    !Object.hasOwn(s.answers, pid) &&
    valid(s, a.phrase)
  ) {
    s.answers[pid] = a.phrase.trim();
    if (H.complete(s, ctx, s.answers)) vote(s, ctx);
  } else if (
    s.phase === "vote" &&
    typeof a.vote === "string" &&
    s.entries.some((e) => e.id === a.vote && e.pid !== pid) &&
    !Object.hasOwn(s.votes, pid)
  ) {
    s.votes[pid] = a.vote;
    if (H.complete(s, ctx, s.votes, voters(s))) finish(s, ctx);
  }
}
function onPlayerGone(s, ctx, pid) {
  if (!H.gone(s, pid) || s.phase === "done" || s.phase === "reveal") return;
  if (s.phase === "write" && H.complete(s, ctx, s.answers)) vote(s, ctx);
  else if (s.phase === "vote" && H.complete(s, ctx, s.votes, voters(s)))
    finish(s, ctx);
}
function view(s, pid, ctx) {
  const member = H.active(s).includes(pid);
  return {
    ...H.projection(s, pid, ctx),
    letters: s.letters || [],
    category: s.category,
    acted: Object.keys(s.phase === "write" ? s.answers : s.votes),
    myPhrase: member ? s.answers[pid] || null : null,
    myVote: member ? s.votes[pid] || null : null,
    entries:
      s.phase === "vote"
        ? s.entries.map((e) => ({
            id: e.id,
            text: e.text,
            mine: member && e.pid === pid,
          }))
        : [],
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
