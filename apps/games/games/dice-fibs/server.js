"use strict";
const { paceSetting } = require("../_sdk");
const { placePoints, competitionRanks } = require("../engines/board-duel");
const R = require("../engines/b6-round");
const id = "dice-fibs";
const manifest = {
  name: "Dice Fibs",
  tagline: "Shake your cup. Raise an eyebrow.",
  cat: "bluff",
  renderer: "dom",
  art: "img/games/dice-fibs.png",
  players: { min: 2, max: 8 },
  howto:
    "Everyone starts with five hidden dice. Bid how many dice of one face are under all cups. Raise the quantity, or keep it and raise the face. Call Liar to reveal: the caller loses a die if the bid holds, otherwise the bidder does. Ones are wild by default. Last cup standing wins 300 points; next places earn 200 and 100.",
  guide: {
    goal: "Keep your dice and catch a fib.",
    tips: [
      "Your cup is private. A bid counts every cup still in play.",
      "Ones count as any face when wild ones are on. A bid of ones counts ones only.",
      "You have 30 seconds. Time calls Liar, or opens with your most common face.",
      "The player who loses a die starts the next round. Zero dice means out.",
    ],
  },
  settings: [
    paceSetting(),
    { key: "wildOnes", label: "Wild ones", type: "bool", def: true },
  ],
};
function create(ctx) {
  const s = {
    ...R.base(ctx),
    counts: {},
    dice: {},
    bid: null,
    turnPid: null,
    turnNo: 0,
    eliminated: [],
    last: null,
    wildOnes: ctx.settings().wildOnes !== false,
  };
  for (const pid of s.order) s.counts[pid] = 5;
  startRound(s, ctx, s.order[0]);
  return s;
}
function alive(s) {
  return R.active(s).filter((pid) => s.counts[pid] > 0);
}
function complete(s, ctx) {
  if (s.phase === "done") return;
  const remaining = alive(s),
    ranking = remaining.concat(s.eliminated.slice().reverse());
  const points = placePoints(
    competitionRanks(
      ranking.map((pid, i) => ({ pid, value: ranking.length - i })),
    ),
  );
  R.award(s, ctx, points);
  s.winners = remaining;
  R.finish(s);
}
function startRound(s, ctx, starter) {
  const ids = alive(s);
  if (ids.length <= 1) {
    complete(s, ctx);
    return;
  }
  s.round++;
  s.bid = null;
  s.last = null;
  s.dice = Object.fromEntries(
    ids.map((pid) => [
      pid,
      Array.from(
        { length: s.counts[pid] },
        () => 1 + Math.floor(Math.random() * 6),
      ),
    ]),
  );
  const next = s.order
    .slice(s.order.indexOf(starter) + 1)
    .concat(s.order)
    .find((pid) => ids.includes(pid));
  takeTurn(s, ctx, ids.includes(starter) ? starter : next);
}
function takeTurn(s, ctx, pid) {
  s.turnPid = pid;
  s.turnNo++;
  R.arm(s, ctx, "bid", 30, () => timeout(s, ctx));
}
function timeout(s, ctx) {
  if (s.bid) challenge(s, ctx, s.turnPid);
  else {
    const dice = s.dice[s.turnPid],
      counts = Array(7).fill(0);
    for (const face of dice) counts[face]++;
    const face = counts.indexOf(Math.max(...counts));
    bid(s, ctx, s.turnPid, { quantity: 1, face });
  }
}
function bid(s, ctx, pid, b) {
  s.bid = { quantity: b.quantity, face: b.face, pid };
  const ids = alive(s);
  takeTurn(s, ctx, ids[(ids.indexOf(pid) + 1) % ids.length]);
}
function challenge(s, ctx, caller) {
  const { face, quantity, pid: bidder } = s.bid;
  const actual = Object.values(s.dice)
    .flat()
    .filter((n) => n === face || (s.wildOnes && face !== 1 && n === 1)).length;
  const loser = actual >= quantity ? caller : bidder;
  s.counts[loser]--;
  if (s.counts[loser] === 0) s.eliminated.push(loser);
  s.last = {
    bid: { ...s.bid },
    caller,
    loser,
    actual,
    dice: structuredClone(s.dice),
    held: actual >= quantity,
  };
  R.arm(s, ctx, "reveal", 7, () => startRound(s, ctx, loser));
}
function onAction(s, ctx, pid, a) {
  if (!R.valid(s, pid, a)) return false;
  if (s.phase === "bid" && R.expired(s, ctx)) {
    timeout(s, ctx);
    return;
  }
  if (s.phase === "reveal" && a.next === true && pid === R.host(s, ctx)) {
    startRound(s, ctx, s.last.loser);
    return;
  }
  if (s.phase !== "bid" || pid !== s.turnPid || a.turnNo !== s.turnNo)
    return false;
  if (a.liar === true && s.bid) {
    challenge(s, ctx, pid);
    return;
  }
  const b = a.bid,
    max = alive(s).reduce((n, p) => n + s.counts[p], 0);
  if (
    !b ||
    typeof b !== "object" ||
    !Number.isInteger(b.quantity) ||
    b.quantity < 1 ||
    b.quantity > max ||
    !Number.isInteger(b.face) ||
    b.face < 1 ||
    b.face > 6
  )
    return false;
  if (
    s.bid &&
    (b.quantity < s.bid.quantity ||
      (b.quantity === s.bid.quantity && b.face <= s.bid.face))
  )
    return false;
  bid(s, ctx, pid, b);
}
function onPlayerGone(s, ctx, pid) {
  if (!R.gone(s, pid)) return;
  if (!s.eliminated.includes(pid)) s.eliminated.push(pid);
  s.counts[pid] = 0;
  delete s.dice[pid];
  if (alive(s).length <= 1) {
    complete(s, ctx);
    return;
  }
  if (s.phase === "bid" && (s.turnPid === pid || s.bid?.pid === pid))
    startRound(s, ctx, pid);
}
function view(s, pid, ctx) {
  return {
    ...R.publicBase(s, ctx),
    counts: { ...s.counts },
    wildOnes: s.wildOnes,
    turnPid: s.turnPid,
    turnNo: s.turnNo,
    bid: s.bid ? { ...s.bid } : null,
    myDice: R.known(s, pid) ? (s.dice[pid] || []).slice() : [],
    last: s.phase === "reveal" ? s.last : null,
    winners: s.winners || [],
  };
}
module.exports = {
  id,
  manifest,
  minPlayers: 2,
  maxPlayers: 8,
  create,
  onAction,
  onEnd: R.finish,
  onPlayerGone,
  view,
};
