"use strict";
const { paceSetting, paced, dealer } = require("../_sdk");
const round = require("../engines/b4-rounds");
const id = "hot-potato";
const manifest = {
  name: "Hot Potato",
  tagline: "Name it. Pass it. Hope.",
  cat: "speed",
  players: { min: 2, max: 16 },
  art: "img/games/hot-potato.png",
  howto:
    "Type a fresh answer for the category to pass the potato to the next seat. The hidden fuse lasts 20–45 seconds at Normal pace. Whoever holds it when it pops loses one of 3 lives. Tap Nope within 4 seconds to challenge an answer: a strict majority of the other players sends it back. The last player with lives earns 300 points, then 200 and 100 by elimination order. Players judge whether answers fit the category.",
  guide: {
    goal: "Keep your lives by passing before the hidden fuse pops.",
    tips: [
      "Answers need 2–30 characters and cannot repeat this round.",
      "The server checks repeats and basic text only. The room judges the category.",
      "Every player except the answer writer can challenge. More than half must agree.",
      "The fuse keeps burning while answers are challenged.",
    ],
  },
  settings: [paceSetting()],
  packs: {
    categories: {
      label: "Categories",
      type: "string[]",
      minItems: 10,
      maxItems: 200,
      maxLen: 90,
    },
  },
};
function alive(s) {
  return round.active(s).filter((pid) => s.lives[pid] > 0);
}
function nextSeat(s, pid) {
  const start = s.roster.indexOf(pid);
  for (let i = 1; i <= s.roster.length; i++) {
    const next = s.roster[(start + i) % s.roster.length];
    if (alive(s).includes(next)) return next;
  }
  return null;
}
function finish(s, ctx) {
  if (s.phase === "done") return;
  const winners = alive(s);
  const order = [
    ...winners,
    ...s.eliminated
      .slice()
      .reverse()
      .filter((pid) => !s.gone.includes(pid)),
  ];
  for (const pid of s.roster) {
    const rank = order.indexOf(pid);
    const pts = rank < 0 ? 0 : [300, 200, 100][rank] || 0;
    s.scores[pid] = pts;
    if (pts) ctx.award(pid, pts);
  }
  s.winners = winners;
  round.onEnd(s);
}
function explode(s, ctx) {
  if (s.phase !== "pass") return;
  const victim = s.holder;
  s.lives[victim] = Math.max(0, s.lives[victim] - 1);
  if (!s.lives[victim]) s.eliminated.push(victim);
  s.last = { victim, lives: s.lives[victim], pts: {} };
  s.pending = [];
  if (alive(s).length <= 1) {
    finish(s, ctx);
    return;
  }
  s.nextHolder = nextSeat(s, victim);
  round.window(s, ctx, "reveal", paced(ctx, 5) * 1000, () => start(s, ctx));
}
function start(s, ctx) {
  if (alive(s).length <= 1) {
    finish(s, ctx);
    return;
  }
  s.round++;
  s.category = s.deal();
  s.used = [];
  s.history = [];
  s.pending = [];
  s.holder = alive(s).includes(s.nextHolder) ? s.nextHolder : alive(s)[0];
  s.passNo++;
  const seconds = 20 + Math.floor(Math.random() * 26);
  round.window(s, ctx, "pass", paced(ctx, seconds) * 1000, () =>
    explode(s, ctx),
  );
}
function create(ctx) {
  const s = round.create(ctx, id, 0);
  delete s.rounds; // A life match has no fixed round count.
  const categories = ctx.content(id).categories;
  s.deal = dealer(categories?.length ? categories : ["Things in a kitchen"]);
  s.lives = Object.fromEntries(s.roster.map((pid) => [pid, 3]));
  s.eliminated = [];
  s.passNo = 0;
  s.answerNo = 0;
  s.winners = [];
  start(s, ctx);
  return s;
}
function normalize(text) {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/\s+/gu, " ")
    .trim();
}
function validAnswer(text) {
  return (
    typeof text === "string" &&
    text.length <= 100 &&
    [...text.trim()].length >= 2 &&
    [...text.trim()].length <= 30 &&
    /[\p{L}\p{N}]/u.test(text) &&
    /^[\p{L}\p{M}\p{N} '\u2019-]+$/u.test(text.trim()) &&
    !/(.)\1{7}/u.test(text) &&
    !/(?:https?|www)/iu.test(text)
  );
}
function challenge(s, ctx, entry) {
  const eligible = alive(s).filter((pid) => pid !== entry.author);
  if (
    !entry.bounced &&
    eligible.length &&
    entry.voters.filter((pid) => eligible.includes(pid)).length >
      eligible.length / 2
  ) {
    entry.bounced = true;
    if (alive(s).includes(entry.author)) {
      s.holder = entry.author;
      s.passNo++;
    }
  }
}
function onAction(s, ctx, pid, a) {
  if (!round.valid(s, pid, a)) return;
  if (s.phase === "reveal" && a.next === true && pid === ctx.hostId()) {
    start(s, ctx);
    return;
  }
  if (s.phase !== "pass" || !alive(s).includes(pid)) return;
  if (typeof a.nope === "number" && Number.isInteger(a.nope)) {
    if (ctx.now() >= s.endsAt) {
      explode(s, ctx);
      return;
    }
    const entry = s.pending.find((e) => e.id === a.nope);
    if (
      !entry ||
      entry.author === pid ||
      entry.bounced ||
      ctx.now() >= entry.until ||
      entry.voters.includes(pid)
    )
      return;
    entry.voters.push(pid);
    challenge(s, ctx, entry);
    return;
  }
  if (pid !== s.holder || a.pass !== s.passNo || !validAnswer(a.answer)) return;
  if (ctx.now() >= s.endsAt) {
    explode(s, ctx);
    return;
  }
  const answer = a.answer.trim().replace(/\s+/gu, " "),
    key = normalize(answer);
  if (s.used.includes(key)) return;
  s.used.push(key);
  const entry = {
    id: ++s.answerNo,
    author: pid,
    answer,
    voters: [],
    bounced: false,
    until: ctx.now() + paced(ctx, 4) * 1000,
  };
  s.history.push(entry);
  // The fuse uses the round window, not holder changes. Several challenge
  // windows can stay open while the potato keeps moving.
  s.pending.push(entry);
  s.holder = nextSeat(s, pid);
  s.passNo++;
  const r = s.round;
  ctx.later(paced(ctx, 4) * 1000, () => {
    if (s.phase !== "pass" || s.round !== r || !s.pending.includes(entry))
      return;
    s.pending = s.pending.filter((e) => e !== entry);
    ctx.broadcast();
  });
}
function onPlayerGone(s, ctx, pid) {
  if (s.phase === "done") return;
  round.gone(s, pid);
  s.lives[pid] = 0;
  if (!s.eliminated.includes(pid)) s.eliminated.push(pid);
  if (alive(s).length <= 1) {
    finish(s, ctx);
    return;
  }
  if (s.holder === pid) {
    s.holder = nextSeat(s, pid);
    s.passNo++;
  }
  for (const entry of s.pending) challenge(s, ctx, entry);
}
function view(s, pid, ctx) {
  return {
    ...round.baseView(s, pid, ctx),
    endsAt: s.phase === "reveal" ? s.endsAt : 0,
    windowMs: s.phase === "reveal" ? s.windowMs : 0,
    category: s.category,
    holder: s.holder,
    lives: { ...s.lives },
    passNo: s.passNo,
    usedAnswers: [...s.used],
    history: s.history.slice(-4).map((e) => ({
      id: e.id,
      author: e.author,
      answer: e.answer,
      bounced: e.bounced,
      votes: e.voters.length,
    })),
    challenges: s.pending
      .filter((e) => (ctx ? ctx.now() < e.until : true))
      .map((e) => ({
        id: e.id,
        author: e.author,
        answer: e.answer,
        until: e.until,
        bounced: e.bounced,
        votes: e.voters.length,
        myNope: e.voters.includes(pid),
        needed:
          Math.floor(alive(s).filter((p) => p !== e.author).length / 2) + 1,
      })),
    winners: [...s.winners],
  };
}
module.exports = {
  id,
  manifest,
  minPlayers: 2,
  maxPlayers: 16,
  create,
  onAction,
  onPlayerGone,
  onEnd: round.onEnd,
  view,
};
