"use strict";
const {
  dealer,
  shuffle,
  tally,
  roundsSetting,
  paceSetting,
} = require("../_sdk");
const H = require("../engines/b2-party");
const id = "undercover";
const manifest = {
  name: "Undercover",
  tagline: "Close words. Careful clues. Who sounds different?",
  howto:
    "Read your secret word; nobody is told their side. In seat order, give one single-word clue. Do not use either secret word or repeat a clue. Vote someone out; a tied top vote removes nobody. There are up to three clue and vote cycles each round. Catch every Undercover for 100 each on the majority side. Undercovers who survive earn 150.",
  guide: {
    goal: "Find the players whose word differs from yours.",
    tips: [
      "Use one new clue word. Neither secret word is allowed.",
      "There is one Undercover, or two with seven or more players.",
      "Learn your side at the end. Tied votes remove nobody.",
    ],
  },
  cat: "bluff",
  renderer: "dom",
  realtime: false,
  players: { min: 3, max: 12 },
  settings: [roundsSetting({ def: 4 }), paceSetting()],
  art: "img/games/undercover.png",
};
function create(ctx) {
  const s = H.base(ctx, 4);
  s.deal = dealer(
    (H.content(ctx, id).pairs || []).filter(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((w) => typeof w === "string"),
    ),
  );
  nextRound(s, ctx);
  return s;
}
function nextRound(s, ctx) {
  if (s.round >= s.rounds || H.active(s).length < 3) return H.end(s);
  s.round++;
  s.pair = s.deal();
  if (!s.pair) return H.end(s);
  s.undercover = shuffle(H.active(s)).slice(0, H.active(s).length >= 7 ? 2 : 1);
  s.alive = H.active(s);
  s.clues = [];
  s.cycle = 0;
  s.last = null;
  s.eliminated = null;
  startCycle(s, ctx);
}
function living(s) {
  return s.alive.filter((pid) => !s.gone.includes(pid));
}
function startCycle(s, ctx) {
  s.cycle++;
  s.turnIdx = 0;
  s.order = living(s);
  s.votes = {};
  clueTurn(s, ctx);
}
function clueTurn(s, ctx) {
  while (s.turnIdx < s.order.length && !living(s).includes(s.order[s.turnIdx]))
    s.turnIdx++;
  if (s.turnIdx >= s.order.length) {
    s.turnPid = null;
    return H.window(s, ctx, "vote", 30, () => settleVote(s, ctx));
  }
  s.turnPid = s.order[s.turnIdx];
  H.window(s, ctx, "clue", 20, () => {
    s.clues.push({ pid: s.turnPid, cycle: s.cycle, text: null });
    s.turnIdx++;
    clueTurn(s, ctx);
  });
}
function finish(s, ctx, caught) {
  const pts = {};
  for (const pid of H.active(s)) {
    if (caught && !s.undercover.includes(pid)) pts[pid] = 100;
    if (!caught && s.undercover.includes(pid) && living(s).includes(pid))
      pts[pid] = 150;
  }
  H.reveal(
    s,
    ctx,
    {
      caught,
      pts,
      pair: s.pair,
      undercover: s.undercover,
      eliminated: s.eliminated || null,
    },
    () => nextRound(s, ctx),
  );
}
function settleVote(s, ctx) {
  const top = tally(s.votes).winners;
  s.eliminated = top.length === 1 ? top[0] : null;
  if (s.eliminated) s.alive = s.alive.filter((pid) => pid !== s.eliminated);
  if (!living(s).some((pid) => s.undercover.includes(pid)))
    return finish(s, ctx, true);
  if (s.cycle >= 3 || living(s).length < 2) return finish(s, ctx, false);
  startCycle(s, ctx);
}
function validClue(s, text) {
  if (typeof text !== "string" || text.length > 40) return false;
  const word = text.trim();
  return (
    /^[\p{L}]+(?:['’-][\p{L}]+)*$/u.test(word) &&
    !s.pair.some((w) => w.toLocaleLowerCase() === word.toLocaleLowerCase()) &&
    !s.clues.some(
      (c) => c.text?.toLocaleLowerCase() === word.toLocaleLowerCase(),
    )
  );
}
function onAction(s, ctx, pid, a) {
  if (!H.accept(s, ctx, pid, a)) return;
  if (s.phase === "reveal") {
    if (a.next === true && pid === ctx.hostId()) nextRound(s, ctx);
  } else if (s.phase === "clue" && pid === s.turnPid && validClue(s, a.clue)) {
    s.clues.push({ pid, cycle: s.cycle, text: a.clue.trim() });
    s.turnIdx++;
    clueTurn(s, ctx);
  } else if (
    s.phase === "vote" &&
    living(s).includes(pid) &&
    typeof a.vote === "string" &&
    a.vote !== pid &&
    living(s).includes(a.vote) &&
    !Object.hasOwn(s.votes, pid)
  ) {
    s.votes[pid] = a.vote;
    if (H.complete(s, ctx, s.votes, living(s))) settleVote(s, ctx);
  }
}
function onPlayerGone(s, ctx, pid) {
  if (!H.gone(s, pid) || s.phase === "done" || s.phase === "reveal") return;
  s.alive = s.alive.filter((p) => p !== pid);
  for (const [voter, target] of Object.entries(s.votes))
    if (voter === pid || target === pid) delete s.votes[voter];
  if (!living(s).some((p) => s.undercover.includes(p)))
    return finish(s, ctx, true);
  if (living(s).length < 2) return finish(s, ctx, false);
  if (s.phase === "clue" && s.turnPid === pid) {
    s.turnIdx++;
    clueTurn(s, ctx);
  } else if (s.phase === "vote" && H.complete(s, ctx, s.votes, living(s)))
    settleVote(s, ctx);
}
function view(s, pid, ctx) {
  const member = H.active(s).includes(pid);
  return {
    ...H.projection(s, pid, ctx),
    alive: s.alive || [],
    cycle: s.cycle,
    turnPid: s.turnPid,
    clues: s.clues || [],
    acted: Object.keys(s.votes || {}),
    word: member && s.pair ? s.pair[s.undercover.includes(pid) ? 1 : 0] : null,
    myVote: member ? s.votes?.[pid] || null : null,
  };
}
module.exports = {
  id,
  manifest,
  minPlayers: 3,
  maxPlayers: 12,
  create,
  onAction,
  view,
  onEnd: H.end,
  onPlayerGone,
};
