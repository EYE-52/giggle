"use strict";
const { randomUUID } = require("node:crypto");
const { dealer, shuffle, roundsSetting, paceSetting } = require("../_sdk");
const R = require("../engines/b6-round");
const Ink = require("../engines/b6-ink");
const id = "draw-off";
const manifest = {
  name: "Draw Off",
  tagline: "Same prompt. Twelve very different masterpieces.",
  cat: "draw",
  renderer: "canvas",
  art: "img/games/draw-off.png",
  players: { min: 3, max: 12 },
  howto:
    "Draw the same prompt on your own canvas in 60 seconds. Then browse an anonymous gallery and vote for a favourite other than your own in 30 seconds. The most votes wins 100 points, with ties sharing. Other artists earn 25 per vote, up to 100. Play four rounds by default.",
  guide: {
    goal: "Make the drawing the room wants to frame.",
    tips: [
      "Draw on your private canvas. Done seals it and waits for the others.",
      "Use pen colours, eraser, undo and clear while drawing.",
      "Names stay hidden in the gallery until the reveal. You cannot vote for yourself.",
      "Tied favourites each get 100. Every other vote is worth 25, capped at 100.",
    ],
  },
  settings: [roundsSetting({ def: 4 }), paceSetting()],
  packs: {
    prompts: {
      label: "Custom drawing prompts",
      type: "string[]",
      minItems: 10,
      maxItems: 200,
      maxLen: 100,
    },
  },
};
function create(ctx) {
  const pack = ctx.content(id) || {};
  const s = {
    ...R.base(ctx),
    rounds: ctx.settings().rounds ?? 4,
    deal: dealer(
      pack.prompts?.length ? pack.prompts : ["A cat running a bakery"],
    ),
    prompt: "",
    drawings: {},
    ready: {},
    gallery: [],
    votes: {},
    last: null,
  };
  nextRound(s, ctx);
  return s;
}
function nextRound(s, ctx) {
  if (s.round >= s.rounds || R.active(s).length < 2) {
    R.finish(s);
    return;
  }
  s.round++;
  s.prompt = s.deal();
  s.drawings = Object.fromEntries(
    R.active(s).map((pid) => [pid, Ink.makeInk()]),
  );
  s.ready = {};
  s.gallery = [];
  s.votes = {};
  s.last = null;
  R.arm(s, ctx, "draw", 60, () => openGallery(s, ctx));
}
function openGallery(s, ctx) {
  for (const ink of Object.values(s.drawings)) Ink.seal(ink);
  s.gallery = shuffle(
    R.active(s)
      .filter((pid) => s.drawings[pid]?.strokes.length)
      .map((pid) => ({ pid, aid: randomUUID() })),
  );
  R.arm(s, ctx, "vote", 30, () => reveal(s, ctx));
}
function reveal(s, ctx) {
  if (s.phase !== "vote") return;
  const counts = Object.fromEntries(s.gallery.map((g) => [g.aid, 0]));
  for (const aid of Object.values(s.votes)) if (aid in counts) counts[aid]++;
  const best = Math.max(0, ...Object.values(counts)),
    pts = {},
    winners = [];
  for (const g of s.gallery) {
    const n = counts[g.aid];
    if (best > 0 && n === best) {
      pts[g.pid] = 100;
      winners.push(g.pid);
    } else if (n) pts[g.pid] = Math.min(100, 25 * n);
  }
  s.last = { counts, pts, winners, votes: { ...s.votes } };
  R.award(s, ctx, pts);
  R.arm(s, ctx, "reveal", 8, () => nextRound(s, ctx));
}
function eligible(s, pid) {
  return s.gallery.some((g) => g.pid !== pid);
}
function allVoted(s) {
  return R.active(s)
    .filter((p) => eligible(s, p))
    .every((p) => s.votes[p]);
}
function onAction(s, ctx, pid, a) {
  if (!R.valid(s, pid, a)) return false;
  if (R.expired(s, ctx)) {
    if (s.phase === "draw") openGallery(s, ctx);
    else if (s.phase === "vote") reveal(s, ctx);
    else if (s.phase === "reveal") nextRound(s, ctx);
    return;
  }
  if (s.phase === "draw" && !s.ready[pid]) {
    if (a.ready === true) {
      Ink.seal(s.drawings[pid]);
      s.ready[pid] = true;
      if (R.active(s).every((p) => s.ready[p])) openGallery(s, ctx);
      return;
    }
    return Ink.accept(s.drawings[pid], a) ? undefined : false;
  }
  if (
    s.phase === "vote" &&
    typeof a.vote === "string" &&
    !s.votes[pid] &&
    s.gallery.some((g) => g.aid === a.vote && g.pid !== pid)
  ) {
    s.votes[pid] = a.vote;
    if (allVoted(s)) reveal(s, ctx);
  } else if (s.phase === "reveal" && a.next === true && pid === R.host(s, ctx))
    nextRound(s, ctx);
}
function onPlayerGone(s, ctx, pid) {
  if (!R.gone(s, pid)) return;
  if (R.active(s).length < 2) {
    R.finish(s);
    return;
  }
  if (s.phase === "draw" && R.active(s).every((p) => s.ready[p]))
    openGallery(s, ctx);
  else if (s.phase === "vote" && allVoted(s)) reveal(s, ctx);
}
function view(s, pid, ctx) {
  const player = R.known(s, pid),
    revealed = ["reveal", "done"].includes(s.phase);
  const out = {
    ...R.publicBase(s, ctx),
    prompt: s.prompt,
    ready: Object.keys(s.ready),
    voted: Object.keys(s.votes),
    myVote: player ? s.votes[pid] || null : null,
    myReady: player && !!s.ready[pid],
    strokes: player && s.phase === "draw" ? Ink.strokes(s.drawings[pid]) : [],
    gallery:
      s.phase === "draw"
        ? []
        : s.gallery.map((g) => ({
            aid: g.aid,
            mine: player && g.pid === pid,
            strokes: Ink.strokes(s.drawings[g.pid]),
            ...(revealed ? { pid: g.pid } : {}),
          })),
    last: revealed ? s.last : null,
  };
  if (player && s.phase === "draw" && !s.ready[pid])
    Object.assign(out, Ink.tools(s.drawings[pid]));
  return out;
}
module.exports = {
  id,
  manifest,
  minPlayers: 3,
  maxPlayers: 12,
  create,
  onAction,
  onEnd: R.finish,
  onPlayerGone,
  view,
};
