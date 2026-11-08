"use strict";
const { roundsSetting, paceSetting } = require("../_sdk");
const R = require("../engines/b6-round");
const id = "block-stack";
const COUNTDOWN_MS = 3000;
const manifest = {
  name: "Block Stack",
  tagline: "One tap. A smaller landing. A taller tower.",
  cat: "3d",
  renderer: "3d",
  art: "img/games/block-stack.png",
  players: { min: 2, max: 12 },
  howto:
    "Wait for 3–2–1, then tap Drop as the sliding block lines up with your tower. The first block starts over your base. Overhang is trimmed off and the smaller block carries on. A perfect drop within three percent keeps its full size. A full miss ends your run. Everyone builds at once for 60 seconds after the countdown. The tallest scores 100; other towers score their height as a share of the best. Play three rounds by default.",
  guide: {
    goal: "Keep a wide landing and build the tallest tower.",
    tips: [
      "Your tower has a bright base. Everyone drops independently.",
      "Wait for 3–2–1. The first swing starts directly over your base.",
      "Drop with the button, Space or Enter. Follow the landing guide.",
      "Tied tallest towers each earn 100. A missed tower keeps its height.",
    ],
    controls: [
      {
        keys: ["Space", "Enter"],
        touch: "Drop button",
        does: "Drop your block",
      },
    ],
  },
  settings: [roundsSetting({ def: 3 }), paceSetting()],
};
function create(ctx) {
  const s = {
    ...R.base(ctx),
    rounds: ctx.settings().rounds ?? 3,
    towers: {},
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
  s.last = null;
  s.startsAt = ctx.now() + COUNTDOWN_MS;
  s.towers = Object.fromEntries(
    R.active(s).map((pid) => [
      pid,
      {
        x: 0,
        z: 0,
        width: 4,
        depth: 4,
        height: 0,
        axis: "x",
        speed: 1.4,
        startedAt: s.startsAt,
        lastDropAt: 0,
        out: false,
        perfect: false,
        blocks: [],
      },
    ]),
  );
  s.phase = "countdown";
  s.windowMs = COUNTDOWN_MS;
  s.endsAt = s.startsAt;
  const token = ++s.windowNo,
    round = s.round;
  ctx.later(COUNTDOWN_MS, () => {
    if (s.phase !== "countdown" || s.round !== round || s.windowNo !== token)
      return;
    startStack(s, ctx);
    ctx.broadcast();
  });
}
function startStack(s, ctx) {
  R.arm(s, ctx, "stack", 60, () => settle(s, ctx));
}
// Same deterministic path is drawn by the client; only the receipt-time
// calculation below decides the landing. Client positions/times are ignored.
function offset(tower, now) {
  return (
    4.5 *
    Math.sin(
      Math.max(0, (now - tower.startedAt) / 1000) * tower.speed -
        (tower.height === 0 ? 0 : Math.PI / 2),
    )
  );
}
function drop(s, ctx, pid) {
  const t = s.towers[pid],
    delta = offset(t, ctx.now()),
    axis = t.axis;
  const size = axis === "x" ? "width" : "depth";
  t.lastDropAt = ctx.now();
  t.perfect = Math.abs(delta) <= t[size] * 0.03;
  if (!t.perfect && Math.abs(delta) >= t[size]) {
    t.out = true;
    t.miss = { axis, offset: delta };
  } else {
    if (!t.perfect) {
      t[size] -= Math.abs(delta);
      t[axis] += delta / 2;
    }
    t.height++;
    t.blocks.push({
      x: t.x,
      z: t.z,
      width: t.width,
      depth: t.depth,
      perfect: t.perfect,
    });
    t.axis = axis === "x" ? "z" : "x";
    t.speed = 1.4 + t.height * 0.12;
    t.startedAt = ctx.now();
  }
  if (Object.values(s.towers).every((tower) => tower.out)) settle(s, ctx);
}
function settle(s, ctx) {
  if (s.phase !== "stack") return;
  const best = Math.max(0, ...Object.values(s.towers).map((t) => t.height));
  const pts = Object.fromEntries(
    Object.entries(s.towers).map(([pid, t]) => [
      pid,
      best ? Math.round((100 * t.height) / best) : 0,
    ]),
  );
  const winners = best
    ? Object.keys(s.towers).filter((p) => s.towers[p].height === best)
    : [];
  s.last = { best, pts, winners };
  R.award(s, ctx, pts);
  R.arm(s, ctx, "reveal", 7, () => nextRound(s, ctx));
}
function onAction(s, ctx, pid, a) {
  if (!R.valid(s, pid, a)) return false;
  if (s.phase === "countdown" && ctx.now() < s.startsAt) return false;
  if (s.phase === "stack" && R.expired(s, ctx)) {
    settle(s, ctx);
    return;
  }
  if (s.phase === "reveal" && a.next === true && pid === R.host(s, ctx)) {
    nextRound(s, ctx);
    return;
  }
  const t = s.towers[pid];
  if (
    (s.phase !== "stack" && s.phase !== "countdown") ||
    a.drop !== true ||
    !t ||
    t.out ||
    a.round !== s.round ||
    a.level !== t.height ||
    ctx.now() - t.lastDropAt < 180
  )
    return false;
  if (s.phase === "countdown") startStack(s, ctx);
  drop(s, ctx, pid);
}
function onPlayerGone(s, ctx, pid) {
  if (!R.gone(s, pid)) return;
  if (s.towers[pid]) s.towers[pid].out = true;
  if (s.phase === "stack" && Object.values(s.towers).every((t) => t.out))
    settle(s, ctx);
  if (!R.active(s).length) R.finish(s);
}
function view(s, pid, ctx) {
  return {
    ...R.publicBase(s, ctx),
    startsAt: s.startsAt,
    towers: structuredClone(s.towers),
    last: s.last,
    myTower: R.known(s, pid) ? pid : null,
    serverNow: ctx?.now ? ctx.now() : null,
  };
}
module.exports = {
  id,
  manifest,
  minPlayers: 2,
  maxPlayers: 12,
  create,
  onAction,
  onEnd: R.finish,
  onPlayerGone,
  view,
  offset,
};
