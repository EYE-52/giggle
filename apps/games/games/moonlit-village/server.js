"use strict";
const { dealer, shuffle, tally, paceSetting } = require("../_sdk");
const H = require("../engines/b2-party");
const id = "moonlit-village";
const manifest = {
  name: "Moonlit Village",
  tagline: "Keep the lanterns glowing. Find the wolves.",
  howto:
    "At night wolves choose whose lantern to take, the Seer checks one side and the Healer protects one player. The Healer cannot protect the same player on consecutive nights. Discuss by day, then vote someone home; tied votes send nobody home. Out players watch with all roles visible. The village wins with no wolves left; wolves win when they match or outnumber the others. The winning side earns 300 each; surviving losers earn 100.",
  guide: {
    goal: "Find the wolves, or quietly take over the village.",
    tips: [
      "Night choices are secret. Wolves can see their pack.",
      "Tap Ready to shorten discussion once everyone is ready.",
      "A tied day vote sends nobody home. Out players can watch all roles.",
    ],
  },
  cat: "bluff",
  renderer: "dom",
  realtime: false,
  communication: "voice",
  players: { min: 5, max: 16 },
  settings: [paceSetting()],
  art: "img/games/moonlit-village.png",
};
function create(ctx) {
  const s = H.base(ctx, null),
    ids = shuffle(s.ids);
  const pack = H.content(ctx, id);
  s.sceneDeal = dealer(pack.nightScenes || []);
  s.labels = pack.labels || {};
  s.roles = {};
  const wolves = Math.max(1, Math.floor(ids.length / 4));
  ids.forEach((pid, i) => {
    s.roles[pid] =
      i < wolves
        ? "wolf"
        : i === wolves
          ? "seer"
          : i === wolves + 1
            ? "healer"
            : "villager";
  });
  s.alive = [...ids];
  s.previousProtection = null;
  s.events = [];
  night(s, ctx);
  return s;
}
function living(s) {
  return s.alive.filter((pid) => !s.gone.includes(pid));
}
function finishIfWon(s, ctx) {
  const ids = living(s),
    wolves = ids.filter((pid) => s.roles[pid] === "wolf").length;
  const winner =
    wolves === 0 ? "village" : wolves >= ids.length - wolves ? "wolves" : null;
  if (!winner) return false;
  const pts = {};
  for (const pid of s.ids) {
    const wins = (s.roles[pid] === "wolf") === (winner === "wolves");
    pts[pid] = wins ? 300 : ids.includes(pid) ? 100 : 0;
  }
  H.award(s, ctx, pts);
  s.last = { winner, pts, roles: { ...s.roles } };
  H.end(s);
  return true;
}
function night(s, ctx) {
  if (finishIfWon(s, ctx)) return;
  s.round++;
  s.scene = s.sceneDeal();
  s.nightVotes = {};
  s.peek = null;
  s.protect = null;
  s.seen = null;
  s.ready = {};
  s.votes = {};
  H.window(s, ctx, "night", 30, () => dawn(s, ctx));
}
function dawn(s, ctx) {
  const top = tally(s.nightVotes).winners;
  const target = top.length ? shuffle(top)[0] : null;
  const lost =
    target && target !== s.protect && living(s).includes(target)
      ? target
      : null;
  if (lost) s.alive = s.alive.filter((pid) => pid !== lost);
  s.previousProtection = s.protect;
  s.events = [{ type: lost ? "lantern" : "quiet", pid: lost }];
  if (finishIfWon(s, ctx)) return;
  H.window(s, ctx, "day", 90, () => vote(s, ctx));
}
function vote(s, ctx) {
  s.votes = {};
  H.window(s, ctx, "vote", 30, () => exile(s, ctx));
}
function exile(s, ctx) {
  const top = tally(s.votes).winners;
  const target = top.length === 1 ? top[0] : null;
  if (target) s.alive = s.alive.filter((pid) => pid !== target);
  s.events.push({ type: target ? "home" : "tie", pid: target });
  if (finishIfWon(s, ctx)) return;
  H.reveal(s, ctx, { events: s.events, pts: {} }, () => night(s, ctx));
}
function onAction(s, ctx, pid, a) {
  if (!H.accept(s, ctx, pid, a)) return;
  if (s.phase === "reveal") {
    if (a.next === true && pid === ctx.hostId()) night(s, ctx);
    return;
  }
  if (!living(s).includes(pid)) return;
  if (s.phase === "night") {
    const target = a.target;
    if (typeof target !== "string" || !living(s).includes(target)) return;
    const role = s.roles[pid];
    if (
      role === "wolf" &&
      s.roles[target] !== "wolf" &&
      !Object.hasOwn(s.nightVotes, pid)
    )
      s.nightVotes[pid] = target;
    if (role === "seer" && !s.peek && target !== pid) {
      s.peek = target;
      s.seen = s.roles[target] === "wolf" ? "wolves" : "village";
    }
    if (role === "healer" && !s.protect && target !== s.previousProtection)
      s.protect = target;
    // Keep night length fixed: timing must not reveal which secret roles remain.
  } else if (s.phase === "day" && a.ready === true) {
    s.ready[pid] = true;
    if (H.complete(s, ctx, s.ready, living(s))) vote(s, ctx);
  } else if (
    s.phase === "vote" &&
    typeof a.vote === "string" &&
    a.vote !== pid &&
    living(s).includes(a.vote) &&
    !Object.hasOwn(s.votes, pid)
  ) {
    s.votes[pid] = a.vote;
    if (H.complete(s, ctx, s.votes, living(s))) exile(s, ctx);
  }
}
function onPlayerGone(s, ctx, pid) {
  if (!H.gone(s, pid) || s.phase === "done") return;
  s.alive = s.alive.filter((p) => p !== pid);
  for (const record of [s.nightVotes, s.votes, s.ready]) {
    for (const [voter, target] of Object.entries(record))
      if (voter === pid || target === pid) delete record[voter];
  }
  if (s.protect === pid) s.protect = null;
  if (finishIfWon(s, ctx)) return;
  if (s.phase === "day" && H.complete(s, ctx, s.ready, living(s))) vote(s, ctx);
  else if (s.phase === "vote" && H.complete(s, ctx, s.votes, living(s)))
    exile(s, ctx);
}
function view(s, pid, ctx) {
  const member = s.ids.includes(pid),
    alive = living(s),
    ghost = member && !alive.includes(pid);
  const role = member ? s.roles[pid] : null;
  const roles =
    s.phase === "done" || ghost
      ? { ...s.roles }
      : role === "wolf"
        ? Object.fromEntries(
            Object.entries(s.roles).filter(([, r]) => r === "wolf"),
          )
        : {};
  const myTarget =
    s.phase === "night" && member && !ghost
      ? role === "wolf"
        ? s.nightVotes[pid]
        : role === "seer"
          ? s.peek
          : role === "healer"
            ? s.protect
            : null
      : null;
  return {
    ...H.projection(s, pid, ctx),
    rounds: null,
    alive,
    ghost,
    roles,
    role,
    scene: s.scene || null,
    labels: s.labels,
    myTarget: myTarget || null,
    seen: role === "seer" && member && !ghost ? s.seen : null,
    previousProtection:
      role === "healer" && !ghost ? s.previousProtection : null,
    acted:
      s.phase === "day"
        ? Object.keys(s.ready)
        : s.phase === "vote"
          ? Object.keys(s.votes)
          : [],
    myVote: member ? s.votes[pid] || null : null,
    packVotes:
      role === "wolf" && !ghost && s.phase === "night"
        ? { ...s.nightVotes }
        : {},
    events: s.phase === "night" ? [] : s.events,
  };
}
module.exports = {
  id,
  manifest,
  minPlayers: 5,
  maxPlayers: 16,
  create,
  onAction,
  view,
  onEnd: H.end,
  onPlayerGone,
};
