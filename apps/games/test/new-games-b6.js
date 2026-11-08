"use strict";
const assert = require("node:assert/strict");
const { FakeCtx, drivers } = require("./game-playability");
const { validateManifest } = require("../games/_validate");
const fs = require("node:fs");
const IDS = [
  "dice-fibs",
  "sketchy-impostor",
  "draw-off",
  "block-stack",
  "penalty-kicks",
];
const load = (id) => require("../games/" + id + "/server");
const roster = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: "p" + (i + 1),
    name: ["Asha", "Bo", "Cam", "Dev"][i] || "Seat " + i,
  }));
function setup(id, n, settings = {}) {
  const def = load(id),
    ctx = new FakeCtx(roster(n || def.minPlayers), { rounds: 2, ...settings });
  ctx.content = () => JSON.parse(fs.readFileSync(`locales/en/${id}.json`));
  const s = def.create(ctx);
  return {
    def,
    ctx,
    s,
    act: (pid, a) => def.onAction(s, ctx, pid, a),
    view: (pid) => def.view(s, pid, ctx),
  };
}
const flat = (s) =>
  JSON.stringify(s, (k, v) => (typeof v === "function" ? "[fn]" : v));
function stroke(t, pid, overrides = {}) {
  const v = t.view(pid);
  return t.act(pid, {
    stroke: {
      pts: [
        [0.1, 0.2],
        [0.7, 0.8],
      ],
      color: "#2563eb",
      size: 7,
    },
    inkNonce: v.inkNonce,
    inkRevision: v.inkRevision,
    gestureId: (v.lastGestureId || 0) + 1,
    chunk: 0,
    finished: true,
    turnNo: v.turnNo,
    ...overrides,
  });
}
function drawAll(t) {
  for (const p of t.ctx.players()) {
    stroke(t, p.id);
    t.act(p.id, { ready: true });
  }
  assert.equal(t.s.phase, "vote");
}
function laps(t) {
  let n = 0;
  while (t.s.phase === "draw" && n++ < 24) stroke(t, t.s.turnPid);
  assert.equal(t.s.phase, "vote");
}
function random(value, fn) {
  const old = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = old;
  }
}
let checks = 0;
function test(name, fn) {
  fn();
  checks++;
  console.log("B6_RULE_PASS " + name);
}

for (const id of IDS)
  test(id + ": contract, garbage, End game and stale callbacks", () => {
    const t = setup(id),
      { def, s, ctx } = t;
    assert(validateManifest(def).ok);
    assert.equal(typeof def.onEnd, "function");
    assert.equal(typeof def.onPlayerGone, "function");
    const before = flat(s);
    for (const pid of ["p1", "spectator"])
      for (const a of [
        null,
        undefined,
        [],
        {},
        1,
        "bid",
        { vote: {} },
        { bid: null },
        { drop: false },
        { zone: NaN },
        { next: 1 },
      ])
        t.act(pid, a);
    assert.equal(flat(s), before);
    assert.doesNotThrow(() => JSON.stringify(t.view("spectator")));
    s.scores.p1 = 50;
    def.onEnd(s, ctx);
    assert.equal(s.phase, "done");
    assert.equal(s.endsAt, 0);
    assert.equal(s.scores.p1, 50);
    const ended = flat(s);
    for (const timer of ctx.timers.slice()) timer.fn();
    def.onEnd(s, ctx);
    t.act("p1", { next: true, resign: true });
    assert.equal(flat(s), ended, "terminal state cannot re-award or advance");
  });

for (const id of IDS)
  test(id + ": public legal full match driver", () => assert(drivers[id]()));

for (const [id, counts] of [
  ["dice-fibs", [2, 4, 8]],
  ["sketchy-impostor", [4, 10]],
  ["draw-off", [3, 4, 12]],
  ["block-stack", [2, 4, 12]],
  ["penalty-kicks", [2, 6]],
]) {
  for (const n of counts)
    test(`${id}: ${n} seats idle deadlines finish`, () => {
      const t = setup(id, n, { rounds: 1 });
      let fires = 0;
      while (t.s.phase !== "done" && fires++ < 2000)
        assert(t.ctx.fireNext(), "live phase needs a deadline");
      assert.equal(t.s.phase, "done", "idle match finishes without a click");
      assert.equal(t.s.endsAt, 0);
      assert.deepEqual(
        Object.fromEntries(Object.entries(t.s.scores).filter(([, n]) => n)),
        t.ctx.awards,
      );
    });
}

test("Dice Fibs: raised bids, wild ones, private cups, timeout and two-player places", () => {
  const t = setup("dice-fibs", 2),
    { s } = t;
  assert.equal(t.view("spectator").myDice.length, 0);
  assert(!("dice" in t.view("p2")));
  assert.equal(t.view("p1").myDice.length, 5);
  s.dice = { p1: [1, 3, 4, 5, 6], p2: [1, 2, 2, 5, 6] };
  t.act("p1", { bid: { quantity: 3, face: 3 }, turnNo: s.turnNo });
  const before = flat(s);
  for (const bid of [
    { quantity: 2, face: 6 },
    { quantity: 3, face: 3 },
    { quantity: 11, face: 6 },
    { quantity: 3, face: 7 },
  ])
    t.act("p2", { bid, turnNo: s.turnNo });
  assert.equal(flat(s), before);
  t.act("p2", { liar: true, turnNo: s.turnNo });
  assert.equal(s.last.actual, 3);
  assert.equal(s.last.loser, "p2");
  assert.equal(s.counts.p2, 4);
  assert.equal(t.view("spectator").last.dice.p1.length, 5);
  t.act("p1", { next: true });
  assert.equal(s.turnPid, "p2");
  const oldTurn = s.turnNo;
  t.ctx.fireUntil(() => s.bid !== null);
  assert(s.bid && s.bid.quantity === 1);
  assert(s.turnNo > oldTurn);
  const after = flat(s);
  t.act(s.turnPid, { liar: true, turnNo: oldTurn });
  assert.equal(flat(s), after);
  const noWild = setup("dice-fibs", 2, { wildOnes: false });
  noWild.s.dice = { p1: [1, 1, 1, 1, 1], p2: [2, 2, 2, 2, 2] };
  noWild.act("p1", { bid: { quantity: 1, face: 3 }, turnNo: noWild.s.turnNo });
  noWild.act("p2", { liar: true, turnNo: noWild.s.turnNo });
  assert.equal(noWild.s.last.actual, 0);
});

test("Sketchy Impostor: no role leak, one continuous stroke, chunk/revision replay rejection", () => {
  const t = setup("sketchy-impostor"),
    { s } = t;
  const imp = t.view(s.impostor),
    watcher = t.view("spectator");
  assert.equal(imp.word, null);
  assert.equal(watcher.word, null);
  assert.equal(watcher.role, null);
  assert.equal(watcher.impostor, null);
  assert(
    !("ink" in watcher) && !("inkNonce" in watcher) && !("votes" in watcher),
  );
  const pid = s.turnPid,
    v = t.view(pid),
    a = {
      inkNonce: v.inkNonce,
      inkRevision: 0,
      gestureId: 1,
      chunk: 0,
      turnNo: v.turnNo,
    };
  const part = {
    pts: [
      [0, 0],
      [0.5, 0.5],
    ],
    color: "#ffffff",
    size: 7,
    tool: "eraser",
  };
  t.act(pid, { ...a, preview: part, sample: 2 });
  assert.equal(s.ink.preview.color, t.view(pid).colors[pid]);
  assert.equal(s.ink.preview.tool, "pen");
  const snap = flat(s);
  t.act(pid, { ...a, preview: part, sample: 1 });
  assert.equal(flat(s), snap);
  t.act(pid, { ...a, stroke: part, finished: false });
  const one = flat(s);
  t.act(pid, { ...a, stroke: part, finished: false });
  assert.equal(flat(s), one);
  t.act(pid, { ...a, chunk: 1, stroke: part, finished: true });
  assert.notEqual(s.turnPid, pid);
  assert.equal(s.canvas.length, 2);
  const next = flat(s);
  t.act(pid, { ...a, stroke: part, finished: true });
  assert.equal(flat(s), next);
  laps(t);
  assert.equal(s.canvas.length, 9);
});

for (const guess of ["wrong", "correct", "tie"])
  test("Sketchy Impostor: " + guess + " vote/guess scoring", () => {
    const t = setup("sketchy-impostor"),
      { s } = t;
    laps(t);
    const imp = s.impostor,
      other = s.order.filter((p) => p !== imp);
    if (guess === "tie") {
      for (const [i, p] of s.order.entries())
        t.act(p, { vote: s.order[(i + 1) % s.order.length] });
      assert.equal(s.phase, "reveal");
      assert.equal(s.last.caught, false);
      assert.equal(s.scores[imp], 150);
    } else {
      for (const p of s.order) t.act(p, { vote: p === imp ? other[0] : imp });
      assert.equal(s.phase, "guess");
      assert.equal(t.view(imp).word, null);
      assert.equal(t.view("spectator").word, null);
      t.act(imp, {
        guess: guess === "correct" ? s.word.toUpperCase() : "wrong",
      });
      assert.equal(s.phase, "reveal");
      if (guess === "correct") assert.equal(s.scores[imp], 150);
      else for (const p of other) assert.equal(s.scores[p], 100);
    }
  });

test("Draw Off: private canvases, self-vote, anonymous IDs, ties and 25-per-vote points", () => {
  const t = setup("draw-off", 4),
    { s } = t;
  stroke(t, "p1");
  assert.equal(t.view("p2").strokes.length, 0);
  assert.equal(t.view("spectator").strokes.length, 0);
  assert.deepEqual(t.view("spectator").gallery, []);
  assert(!("drawings" in t.view("p2")));
  for (const p of s.order) {
    if (p !== "p1") stroke(t, p);
    t.act(p, { ready: true });
  }
  assert(t.view("p1").gallery.every((g) => !("pid" in g)));
  const gid = (pid) => s.gallery.find((g) => g.pid === pid).aid;
  const snap = flat(s);
  t.act("p1", { vote: gid("p1") });
  assert.equal(flat(s), snap);
  t.act("p1", { vote: gid("p2") });
  t.act("p2", { vote: gid("p1") });
  assert.equal(t.view("spectator").myVote, null);
  assert(!("votes" in t.view("p3")));
  t.act("p3", { vote: gid("p1") });
  t.act("p4", { vote: gid("p3") });
  assert.equal(s.scores.p1, 100);
  assert.equal(s.scores.p2, 25);
  assert.equal(s.scores.p3, 25);
  assert(t.view("spectator").gallery.every((g) => g.pid));
  const tied = setup("draw-off", 4);
  drawAll(tied);
  const ids = Object.fromEntries(tied.s.gallery.map((g) => [g.pid, g.aid]));
  for (const [p, target] of [
    ["p1", "p2"],
    ["p2", "p1"],
    ["p3", "p1"],
    ["p4", "p2"],
  ])
    tied.act(p, { vote: ids[target] });
  assert.equal(tied.s.scores.p1, 100);
  assert.equal(tied.s.scores.p2, 100);
});

test("Draw Off: undo/clear revision cannot restore old queued ink", () => {
  const t = setup("draw-off");
  const v = t.view("p1");
  stroke(t, "p1");
  t.act("p1", { undo: true, inkNonce: v.inkNonce, inkRevision: 0 });
  assert.equal(t.view("p1").strokes.length, 0);
  assert.equal(t.view("p1").inkRevision, 1);
  const before = flat(t.s);
  stroke(t, "p1", { inkRevision: 0 });
  assert.equal(flat(t.s), before);
  stroke(t, "p1");
  assert.equal(t.view("p1").strokes.length, 1);
  const b = flat(t.s);
  stroke(t, "p1", {
    stroke: {
      pts: [
        [NaN, 0],
        [1, 1],
      ],
      color: "#2563eb",
      size: 7,
    },
  });
  assert.equal(flat(t.s), b);
});

test("Block Stack: fixed 3-2-1 countdown ignores early drops at every Pace", () => {
  for (const pace of ["Quick", "Normal", "Relaxed"]) {
    const t = setup("block-stack", 4, { pace }),
      { s, ctx, def } = t,
      start = ctx.now();
    assert.equal(s.phase, "countdown");
    assert.equal(s.startsAt, start + 3000);
    assert.equal(s.endsAt, s.startsAt);
    assert.equal(s.windowMs, 3000);
    assert.equal(t.view("p1").startsAt, s.startsAt);
    assert.equal(t.view("spectator").startsAt, s.startsAt);
    for (const elapsed of [0, 1000, 2000, 2999]) {
      ctx.setNow(start + elapsed);
      const before = flat(s);
      for (const pid of s.order) {
        assert.equal(def.offset(s.towers[pid], ctx.now()), 0);
        t.act(pid, {
          drop: true,
          level: 0,
          round: s.round,
          clientTime: s.startsAt + 10000,
        });
      }
      assert.equal(
        flat(s),
        before,
        "countdown drops must not change any tower",
      );
      assert.equal(ctx.totalAwarded(), 0);
    }
    ctx.fireNext();
    assert.equal(ctx.now(), s.startsAt);
    assert.equal(s.phase, "stack");
    assert.equal(s.endsAt, s.startsAt + s.windowMs);
    for (const tower of Object.values(s.towers)) {
      assert.equal(tower.startedAt, s.startsAt);
      assert.equal(def.offset(tower, s.startsAt), 0);
      assert(
        Math.abs(def.offset(tower, s.startsAt + 250) - 4.5 * Math.sin(0.35)) <
          1e-9,
      );
    }
    t.act("p1", { drop: true, level: 0, round: s.round });
    assert.equal(s.towers.p1.height, 1);
    assert.equal(s.towers.p1.out, false);
    assert.equal(s.towers.p1.perfect, true);
    assert.equal(s.towers.p1.width, 4);
    assert.equal(s.towers.p1.depth, 4);
  }
});

test("Block Stack: countdown boundary and late callbacks keep the server swing timeline", () => {
  const t = setup("block-stack", 2),
    { s, ctx, def } = t,
    start = s.startsAt,
    countdownTimer = ctx.timers[0];
  ctx.setNow(start + 250);
  const waiting = flat(s);
  for (const action of [
    {},
    { drop: true, level: 0, round: s.round - 1 },
    { drop: true, level: 9, round: s.round },
  ])
    t.act("p1", action);
  assert.equal(
    flat(s),
    waiting,
    "invalid actions cannot consume the countdown transition",
  );
  const delta = 4.5 * Math.sin(0.35);
  assert(Math.abs(def.offset(s.towers.p1, ctx.now()) - delta) < 1e-9);
  t.act("p1", { drop: true, level: 0, round: s.round });
  assert.equal(
    s.phase,
    "stack",
    "a drop at or after the deadline can start play",
  );
  assert.equal(s.towers.p1.height, 1);
  assert(Math.abs(s.towers.p1.width - (4 - delta)) < 1e-9);
  assert.equal(
    s.towers.p2.startedAt,
    start,
    "late timer cannot restart the swing",
  );
  const after = flat(s);
  countdownTimer.fn();
  assert.equal(
    flat(s),
    after,
    "stale countdown callback cannot reset a live round",
  );
  ctx.fireUntil(() => s.phase === "reveal");
  t.act("p1", { next: true });
  assert.equal(s.phase, "countdown");
  assert.equal(s.startsAt, ctx.now() + 3000);
  const nextRound = flat(s);
  countdownTimer.fn();
  assert.equal(
    flat(s),
    nextRound,
    "an old countdown cannot start the next round",
  );
});

test("Block Stack: server time, perfect tolerance, clipping both axes, full miss and proportional ties", () => {
  const t = setup("block-stack", 4),
    { s, ctx } = t;
  const dropAt = (pid, delta) => {
    const tower = s.towers[pid];
    const target =
      tower.startedAt +
      ((Math.asin(delta / 4.5) + (tower.height === 0 ? 0 : Math.PI / 2)) /
        tower.speed) *
        1000;
    const period = ((Math.PI * 2) / tower.speed) * 1000;
    ctx.setNow(
      target + Math.max(0, Math.ceil((ctx.now() - target) / period)) * period,
    );
    t.act(pid, {
      drop: true,
      level: tower.height,
      round: s.round,
      x: 0,
      clientTime: 0,
    });
  };
  dropAt("p1", 0.1);
  assert.equal(s.towers.p1.width, 4);
  assert.equal(s.towers.p1.perfect, true);
  dropAt("p1", 1);
  assert(Math.abs(s.towers.p1.depth - 3) < 1e-5);
  assert.equal(s.towers.p1.axis, "x");
  dropAt("p2", 0);
  dropAt("p3", 0);
  // p4's old path is far off-centre at this receipt time, regardless of forged x.
  ctx.advance(10000);
  const tower = s.towers.p4;
  tower.startedAt = ctx.now();
  ctx.advance((Math.PI / (2 * tower.speed)) * 1000);
  t.act("p4", { drop: true, level: 0, round: s.round, x: 0 });
  assert.equal(tower.out, true);
  ctx.fireUntil(() => s.phase === "reveal");
  assert.deepEqual(s.last.pts, { p1: 100, p2: 50, p3: 50, p4: 0 });
  const snap = flat(s);
  t.act("p1", { drop: true, level: 2, round: s.round });
  assert.equal(flat(s), snap);
});

test("Penalty Kicks: same/adjacent zones, soft random saves, hard high misses, secret picks", () => {
  for (const [shot, keeper, power, rand, want] of [
    [0, 0, "soft", 0.9, "save"],
    [0, 1, "soft", 0.2, "save"],
    [0, 1, "soft", 0.9, "goal"],
    [0, 1, "hard", 0.3, "goal"],
    [0, 5, "hard", 0.1, "miss"],
    [3, 4, "hard", 0.1, "goal"],
  ]) {
    const t = setup("penalty-kicks", 4),
      { s } = t;
    assert.equal(s.order.length, 2);
    assert.equal(t.view("p3").role, null);
    t.act(s.shooter, { zone: shot, power, kick: s.kick });
    const v = t.view(s.keeper),
      watcher = t.view("p3");
    assert.equal(v.myChoice, null);
    assert.equal(watcher.myChoice, null);
    assert(!("choices" in v));
    const snap = flat(s);
    t.act(s.shooter, { zone: 5, power: "hard", kick: s.kick });
    assert.equal(flat(s), snap);
    random(rand, () => t.act(s.keeper, { zone: keeper, kick: s.kick }));
    assert.equal(s.last.outcome, want);
  }
});

test("Penalty Kicks: equal kick counts in sudden death, agreed draw, resign and forfeit", () => {
  const t = setup("penalty-kicks"),
    { s } = t;
  function kick(goal) {
    t.act(s.shooter, { zone: 3, power: "hard", kick: s.kick });
    t.act(s.keeper, { zone: goal ? 2 : 3, kick: s.kick });
    t.act("p1", { next: true });
  }
  for (let i = 0; i < 10; i++) kick(true);
  assert.equal(s.kick, 11);
  kick(true);
  assert.equal(s.kick, 12);
  assert.notEqual(s.phase, "done");
  kick(false);
  assert.equal(s.phase, "done");
  assert.deepEqual(s.scores, { p1: 300, p2: 0 });
  const draw = setup("penalty-kicks");
  draw.act("p1", { offerDraw: true });
  draw.act("p2", { acceptDraw: true });
  assert.deepEqual(draw.s.scores, { p1: 150, p2: 150 });
  const resign = setup("penalty-kicks");
  resign.act("p1", { resign: true });
  assert.equal(resign.s.scores.p2, 300);
  const leave = setup("penalty-kicks");
  leave.def.onPlayerGone(leave.s, leave.ctx, "p2");
  assert.equal(leave.s.scores.p1, 300);
});

for (const id of IDS)
  test(id + ": leave mid-round and elected host", () => {
    const t = setup(id, id === "penalty-kicks" ? 2 : 4),
      { s, ctx, def } = t;
    const victim = id === "sketchy-impostor" ? s.turnPid : "p2";
    def.onPlayerGone(s, ctx, victim);
    assert.doesNotThrow(() => t.view("spectator"));
    if (s.phase !== "done") {
      assert(s.gone.includes(victim));
      const before = flat(s);
      t.act(victim, { next: true, vote: "p1", drop: true });
      assert.equal(flat(s), before);
      ctx.hostId = () => "p3";
      assert.equal(t.view("p3").hostId, "p3");
    }
  });

test("Pace scales play windows after the fixed Block Stack countdown", () => {
  const seconds = {
    "dice-fibs": 30,
    "sketchy-impostor": 20,
    "draw-off": 60,
    "block-stack": 60,
    "penalty-kicks": 8,
  };
  for (const id of IDS)
    for (const [pace, factor] of [
      ["Quick", 0.67],
      ["Relaxed", 1.5],
    ]) {
      const t = setup(id, undefined, { pace });
      if (id === "block-stack") {
        assert.equal(t.s.windowMs, 3000);
        t.ctx.fireUntil(() => t.s.phase === "stack");
      }
      assert.equal(
        t.s.windowMs,
        Math.max(3, Math.round(seconds[id] * factor)) * 1000,
      );
    }
});
test("Content: forty eight-word categories and eighty distinct original prompts", () => {
  const { categories } = JSON.parse(
    fs.readFileSync("locales/en/sketchy-impostor.json"),
  );
  assert(categories.length >= 40);
  assert.equal(new Set(categories.map((c) => c.name)).size, categories.length);
  for (const c of categories) {
    assert(c.words.length >= 8);
    assert.equal(new Set(c.words).size, c.words.length);
  }
  const { prompts } = JSON.parse(fs.readFileSync("locales/en/draw-off.json"));
  assert(prompts.length >= 80);
  assert.equal(new Set(prompts).size, prompts.length);
});
console.log(
  `NEW_GAMES_B6_PASS: ${checks} scenarios; legal matches, privacy, draws/ties, clocks, ink replay, leaving and End game`,
);
