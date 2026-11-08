"use strict";
const {
  dealer,
  shuffle,
  tally,
  roundsSetting,
  paceSetting,
} = require("../_sdk");
const H = require("../engines/b2-party");
const id = "odd-one-out";
const manifest = {
  name: "Odd One Out",
  tagline: "One secret place. One very lost guest.",
  howto:
    "Everyone but the Outsider sees a place and a role. Ask a player a question out loud; they ask next. Anyone can call a vote once each round. Catch the Outsider with a single top vote. The Outsider can guess the place early for 150 points, or after being caught for 100. Correct voters earn 100; an escaping Outsider earns 150.",
  guide: {
    goal: "Find the Outsider without giving away the place.",
    tips: [
      "Ask about the place without naming it. Your answer should fit your role.",
      "A tied vote lets the Outsider escape. Correct voters earn 100.",
      "The Outsider gets one place guess, including a last chance if caught.",
    ],
  },
  cat: "bluff",
  renderer: "dom",
  realtime: false,
  communication: "voice",
  players: { min: 3, max: 12 },
  settings: [roundsSetting({ def: 4 }), paceSetting()],
  art: "img/games/odd-one-out.png",
};
function create(ctx) {
  const s = H.base(ctx, 4);
  s.places = (H.content(ctx, id).places || []).filter(
    (p) =>
      typeof p.name === "string" && Array.isArray(p.roles) && p.roles.length,
  );
  s.deal = dealer(s.places);
  nextRound(s, ctx);
  return s;
}
function nextRound(s, ctx) {
  if (s.round >= s.rounds || H.active(s).length < 3 || s.places.length < 12)
    return H.end(s);
  s.round++;
  s.place = s.deal();
  const ids = shuffle(H.active(s));
  s.outsider = ids[0];
  s.roles = Object.fromEntries(
    ids
      .slice(1)
      .map((pid, i) => [pid, s.place.roles[i % s.place.roles.length]]),
  );
  s.options = shuffle([
    s.place.name,
    ...shuffle(s.places.filter((p) => p.name !== s.place.name))
      .slice(0, 11)
      .map((p) => p.name),
  ]);
  s.asker = ids[1];
  s.order = [...ids.slice(1), ids[0]];
  s.calls = {};
  s.votes = {};
  s.last = null;
  H.window(s, ctx, "talk", 150, () => vote(s, ctx));
}
function vote(s, ctx) {
  s.votes = {};
  H.window(s, ctx, "vote", 30, () => settleVote(s, ctx));
}
function finish(s, ctx, reason, pts, guess = null) {
  H.reveal(
    s,
    ctx,
    {
      reason,
      pts,
      guess,
      place: s.place.name,
      outsider: s.outsider,
      votes: { ...s.votes },
    },
    () => nextRound(s, ctx),
    s.outsider,
  );
}
function settleVote(s, ctx) {
  const winners = tally(s.votes).winners;
  if (
    winners.length === 1 &&
    winners[0] === s.outsider &&
    H.active(s).includes(s.outsider)
  ) {
    s.catchPts = Object.fromEntries(
      Object.entries(s.votes)
        .filter(([pid, target]) => pid !== s.outsider && target === s.outsider)
        .map(([pid]) => [pid, 100]),
    );
    H.window(s, ctx, "lastChance", 15, () =>
      finish(s, ctx, "caught", s.catchPts),
    );
  } else
    finish(
      s,
      ctx,
      "escaped",
      H.active(s).includes(s.outsider) ? { [s.outsider]: 150 } : {},
    );
}
function onAction(s, ctx, pid, a) {
  if (!H.accept(s, ctx, pid, a)) return;
  if (s.phase === "reveal") {
    if (a.next === true && (pid === ctx.hostId() || pid === s.outsider))
      nextRound(s, ctx);
    return;
  }
  if (
    ["talk", "vote", "lastChance"].includes(s.phase) &&
    pid === s.outsider &&
    Number.isInteger(a.place) &&
    a.place >= 0 &&
    a.place < s.options.length
  ) {
    const correct = s.options[a.place] === s.place.name;
    const caught = s.phase === "lastChance";
    const pts = caught
      ? { ...s.catchPts, ...(correct ? { [pid]: 100 } : {}) }
      : correct
        ? { [pid]: 150 }
        : Object.fromEntries(
            H.active(s)
              .filter((p) => p !== pid)
              .map((p) => [p, 100]),
          );
    finish(s, ctx, correct ? "found" : "wrong", pts, s.options[a.place]);
  } else if (s.phase === "talk") {
    if (
      pid === s.asker &&
      typeof a.ask === "string" &&
      a.ask !== pid &&
      H.active(s).includes(a.ask)
    )
      s.asker = a.ask;
    if (
      (a.callVote === true && !s.calls[pid]) ||
      (a.endTalk === true && pid === ctx.hostId())
    ) {
      s.calls[pid] = true;
      vote(s, ctx);
    }
  } else if (
    s.phase === "vote" &&
    typeof a.vote === "string" &&
    a.vote !== pid &&
    H.active(s).includes(a.vote) &&
    !Object.hasOwn(s.votes, pid)
  ) {
    s.votes[pid] = a.vote;
    if (H.complete(s, ctx, s.votes)) settleVote(s, ctx);
  }
}
function onPlayerGone(s, ctx, pid) {
  if (!H.gone(s, pid) || s.phase === "done" || s.phase === "reveal") return;
  if (pid === s.outsider) return finish(s, ctx, "outsiderLeft", {});
  if (H.active(s).length < 3) return finish(s, ctx, "tooFew", {});
  if (s.asker === pid) s.asker = H.active(s)[0];
  for (const [voter, target] of Object.entries(s.votes))
    if (voter === pid || target === pid) delete s.votes[voter];
  if (s.phase === "vote" && H.complete(s, ctx, s.votes)) settleVote(s, ctx);
}
function view(s, pid, ctx) {
  const out = H.projection(s, pid, ctx),
    member = H.active(s).includes(pid);
  const open = ["talk", "vote", "lastChance"].includes(s.phase);
  return {
    ...out,
    asker: s.asker,
    order: s.order || [],
    acted: Object.keys(s.votes || {}),
    myVote: member ? s.votes?.[pid] || null : null,
    called: member && !!s.calls?.[pid],
    card:
      member && open
        ? pid === s.outsider
          ? { outsider: true }
          : { place: s.place.name, role: s.roles[pid] }
        : null,
    places: member && open && pid === s.outsider ? s.options : [],
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
