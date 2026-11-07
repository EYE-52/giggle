"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { IDS, Ctx, legal, step, play } = require("./new-games-b1-harness");
const { validateManifest } = require("../games/_validate");
const load = (id) => require("../games/" + id + "/server");
const make = (id, n = 4, settings = { rounds: 2 }) => {
  const def = load(id),
    ctx = new Ctx(n, settings),
    s = def.create(ctx);
  return { def, ctx, s };
};
let checks = 0;
function test(name, fn) {
  fn();
  checks++;
  console.log("B1_PASS " + name);
}
function action(g, pid, a) {
  g.def.onAction(g.s, g.ctx, pid, a);
}
function enter(g, phase) {
  for (let i = 0; g.s.phase !== phase && i < 8; i++)
    step(g.def.id, g.def, g.s, g.ctx);
  assert.equal(g.s.phase, phase);
}
function deadline(g) {
  const t = g.ctx.timers.findLast((t) => t.at === g.s.endsAt);
  assert(t);
  g.ctx.time = t.at;
  t.fn();
  return t;
}
function clean(s) {
  return JSON.stringify(s, (key, value) =>
    typeof value === "function" ? "fn" : value,
  );
}
for (const id of IDS) {
  test(id + " manifest, content and asset paths", () => {
    const def = load(id),
      p = new Ctx().content(id);
    assert(validateManifest(def).ok);
    assert.deepEqual(
      def.manifest.settings.slice(0, 2).map((s) => s.key),
      ["rounds", "pace"],
    );
    assert.equal(def.manifest.art, "img/games/" + id + ".png");
    const rows = p.questions || p.prompts || p.spectra;
    assert(rows.length >= ({ ballpark: 60, "think-alike": 60 }[id] || 50));
    assert.equal(new Set(rows.map((r) => JSON.stringify(r))).size, rows.length);
    if (id === "know-me")
      assert(
        rows.every(
          (q) => q.options.length === 4 && new Set(q.options).size === 4,
        ),
      );
    if (id === "ballpark")
      assert(
        rows.every(
          (q) =>
            Number.isFinite(q.answer) &&
            q.unit &&
            q.fact &&
            /^https:\/\//.test(q.source),
        ),
      );
  });
  for (const n of [...new Set([load(id).minPlayers, 4, 20])])
    test(id + " complete " + n + "-player game", () => {
      const { ctx, s } = play(id, n);
      assert.equal(s.phase, "done");
      assert.equal(s.endsAt, 0);
      assert(Object.values(s.scores).some((p) => p > 0) || id === "dial-in");
      assert.deepEqual(
        ctx.awards,
        Object.fromEntries(Object.entries(s.scores).filter(([, n]) => n > 0)),
      );
      const before = clean(s);
      load(id).onAction(s, ctx, "p1", { next: true });
      assert.equal(clean(s), before);
    });
  test(id + " garbage, outsiders, duplicate actions", () => {
    const g = make(id),
      before = clean(g.s);
    for (const a of [
      null,
      undefined,
      42,
      "a",
      [],
      {},
      { pick: -1 },
      { pick: 4 },
      { pick: "1" },
      { guess: NaN },
      { guess: Infinity },
      { guess: 1.5 },
      { answer: {} },
      { matches: [] },
      { next: "yes" },
    ])
      action(g, "p1", a);
    action(g, "watch", legal(id, g.s, "p1"));
    assert.equal(clean(g.s), before);
    const pid = id === "dial-in" ? g.s.lead : "p1",
      a = legal(id, g.s, pid);
    action(g, pid, a);
    const after = clean(g.s);
    action(g, pid, a);
    assert.equal(clean(g.s), after);
  });
  test(id + " no-action deadlines finish and do not score", () => {
    const g = make(id);
    for (let i = 0; g.s.phase !== "done" && i < 100; i++) assert(g.ctx.fire());
    assert.equal(g.s.phase, "done");
    assert.deepEqual(g.ctx.awards, {});
  });
  test(id + " End game keeps earned points and stops timers", () => {
    const g = make(id);
    enter(g, "reveal");
    const points = { ...g.ctx.awards };
    g.def.onEnd(g.s, g.ctx);
    const before = clean(g.s);
    while (g.ctx.fire()) {}
    action(g, "p1", { next: true });
    assert.equal(clean(g.s), before);
    assert.deepEqual(g.ctx.awards, points);
    const early = make(id);
    early.def.onEnd(early.s, early.ctx);
    assert.deepEqual(early.ctx.awards, {});
    assert.equal(early.s.endsAt, 0);
  });
  test(id + " leaving and elected host", () => {
    const g = make(id);
    g.ctx.leave(g.def, g.s, "p4");
    const before = clean(g.s);
    action(g, "p4", legal(id, g.s, "p4"));
    assert.equal(clean(g.s), before);
    for (let i = 0; g.s.phase !== "reveal" && i < 10; i++)
      step(id, g.def, g.s, g.ctx);
    assert.equal(g.s.phase, "reveal");
    g.ctx.host = "p2";
    const v = g.def.view(g.s, "p2", g.ctx);
    assert.equal(v.hostId, "p2");
    action(g, "p2", { next: true });
    assert.equal(g.s.round, 2);
    for (let i = 0; g.s.phase !== "done" && i < 20; i++)
      step(id, g.def, g.s, g.ctx);
    assert.equal(g.s.phase, "done");
  });
  test(id + " Pace scales all windows", () => {
    const normal = make(id),
      quick = make(id, 4, { rounds: 2, pace: "Quick" }),
      relaxed = make(id, 4, { rounds: 2, pace: "Relaxed" });
    assert(
      quick.s.windowMs < normal.s.windowMs &&
        relaxed.s.windowMs > normal.s.windowMs,
    );
    enter(quick, "reveal");
    assert(quick.s.windowMs >= 3000);
    assert(quick.s.windowMs < 8000 || id === "who-wrote");
  });
  const phases = {
    "dial-in": ["clue", "guess"],
    ballpark: ["answer"],
    "think-alike": ["answer"],
    "who-wrote": ["write", "match"],
    "know-me": ["pick"],
  }[id];
  for (const phase of phases)
    test(id + " " + phase + " deadline race + privacy", () => {
      const real = Math.random;
      let expected, late;
      try {
        Math.random = () => 0.2;
        expected = make(id);
        late = make(id);
      } finally {
        Math.random = real;
      }
      try {
        Math.random = () => 0.2;
        enter(expected, phase);
        enter(late, phase);
      } finally {
        Math.random = real;
      }
      const actor = late.ctx.players().find((p) => legal(id, late.s, p.id));
      const hidden =
        phase === "clue" ? "target" : id === "ballpark" ? "question" : null;
      for (const pid of ["p1", "p2", "watch"]) {
        const v = late.def.view(late.s, pid, late.ctx);
        for (const k of [
          "deal",
          "close",
          "rotation",
          "roster",
          "answers",
          "guesses",
          "picks",
          "matches",
        ])
          assert(!Object.hasOwn(v, k), id + " leaks " + k);
        if (hidden === "target" && pid !== late.s.lead)
          assert(!Object.hasOwn(v, "target"));
        if (id === "ballpark") {
          assert(!Object.hasOwn(v.question, "answer"));
          assert(!Object.hasOwn(v.question, "fact"));
        }
        if (pid === "watch")
          for (const k of ["myAnswer", "myGuess", "myPick", "myMatches"])
            assert(v[k] == null);
        if (id === "who-wrote" && phase === "match")
          assert(v.notes.every((n) => !Object.hasOwn(n, "author")));
      }
      deadline(expected);
      late.ctx.time = late.s.endsAt;
      const delayed = late.ctx.timers.findLast((t) => t.at === late.s.endsAt);
      action(late, actor.id, legal(id, late.s, actor.id));
      assert.equal(clean(late.s), clean(expected.s));
      assert.deepEqual(late.ctx.awards, expected.ctx.awards);
      const once = clean(late.s);
      delayed.fn();
      assert.equal(clean(late.s), once);
    });
}
test("Dial In boundaries, average, skip, 2-player rotation and Auto", () => {
  for (const [d, points] of [
    [0, 100],
    [4, 100],
    [5, 50],
    [10, 50],
    [11, 25],
    [18, 25],
    [19, 0],
  ]) {
    const g = make("dial-in", 2);
    g.s.target = 50;
    action(g, g.s.lead, { clue: "Warm toast" });
    const guesser = g.ctx.players().find((p) => p.id !== g.s.lead).id;
    action(g, guesser, { guess: 50 + d });
    assert.equal(g.s.last.pts[guesser], points);
    assert.equal(g.s.last.pts[g.s.lead], points);
  }
  const g = make("dial-in", 4);
  g.s.target = 50;
  action(g, g.s.lead, { clue: "Tea" });
  action(g, "p2", { guess: 50 });
  action(g, "p3", { guess: 60 });
  action(g, "p4", { guess: 68 });
  assert.equal(g.s.last.pts.p1, 58);
  const pair = make("dial-in", 2, {}),
    lead = pair.s.lead;
  assert.equal(pair.s.rounds, 2);
  deadline(pair);
  assert(pair.s.last.skipped && pair.s.last.reason);
  action(pair, lead, { next: true });
  assert.notEqual(pair.s.lead, lead);
  const many = make("dial-in", 20, {});
  assert.equal(many.s.rounds, 20);
});
test("Ballpark exact, shared closest, half credit and decimal validation", () => {
  const g = make("ballpark");
  g.s.question = {
    q: "Test",
    answer: 100,
    unit: "units",
    fact: "Fixture",
    decimals: false,
  };
  for (const [i, n] of [100, 100, 110, 111].entries())
    action(g, "p" + (i + 1), { answer: n });
  assert.deepEqual(g.s.last.pts, { p1: 150, p2: 150, p3: 50, p4: 0 });
  const tie = make("ballpark", 2);
  tie.s.question.answer = 100;
  action(tie, "p1", { answer: 80 });
  action(tie, "p2", { answer: 120 });
  assert.deepEqual(tie.s.last.pts, { p1: 100, p2: 100 });
  const d = make("ballpark", 2);
  d.s.question.decimals = false;
  action(d, "p1", { answer: 2.5 });
  assert.deepEqual(d.s.answers, {});
  d.s.question.decimals = true;
  action(d, "p1", { answer: 2.5 });
  assert.equal(d.s.answers.p1, 2.5);
});
test("Think Alike normalization, tied piles, smaller matches and pair", () => {
  const norm = load("think-alike").normalize;
  assert.equal(norm("  The   APPLES  "), "apple");
  assert.equal(norm("an apple"), "apple");
  assert.equal(norm("boxes"), "box");
  assert.equal(norm("peaches"), "peach");
  assert.equal(norm("glass"), "glass");
  const g = make("think-alike", 6);
  for (const [i, a] of [
    "apple",
    "the apples",
    "pear",
    "pears",
    "a pear",
    "banana",
  ].entries())
    action(g, "p" + (i + 1), { answer: a });
  assert.deepEqual(g.s.last.pts, {
    p1: 50,
    p2: 50,
    p3: 100,
    p4: 100,
    p5: 100,
    p6: 0,
  });
  const tied = make("think-alike");
  for (const [i, a] of ["a cat", "cats", "dog", "dogs"].entries())
    action(tied, "p" + (i + 1), { answer: a });
  assert.deepEqual(Object.values(tied.s.last.pts), [100, 100, 100, 100]);
  assert.deepEqual(play("think-alike", 2, 1).s.scores, { p1: 100, p2: 100 });
});
test("Who Wrote It shuffled privacy, one-use names, absent writer, partial and cap", () => {
  const g = make("who-wrote");
  enter(g, "match");
  assert.equal(g.s.windowMs, 45000);
  action(g, "p1", {
    matches: Object.fromEntries(
      g.s.notes.filter((n) => n.author !== "p1").map((n) => [n.id, "p2"]),
    ),
  });
  assert(!g.s.matches.p1);
  action(g, "p1", legal("who-wrote", g.s, "p1"));
  deadline(g);
  assert.equal(g.s.last.pts.p1, 100);
  assert.equal(g.def.view(g.s, "watch", g.ctx).last.notes[0].author, null);
  g.ctx.time += 5000;
  while (g.ctx.timers.some((t) => !t.dead && t.at <= g.ctx.time)) {
    const t = g.ctx.timers.find((t) => !t.dead && t.at <= g.ctx.time);
    t.dead = true;
    t.fn();
  }
  assert(g.def.view(g.s, "watch", g.ctx).last.notes.every((n) => n.author));
  const absent = make("who-wrote");
  action(absent, "p1", { answer: "Just one" });
  deadline(absent);
  assert(absent.s.last.skipped);
  assert.deepEqual(absent.ctx.awards, {});
  const larger = make("who-wrote", 20);
  enter(larger, "match");
  assert.equal(larger.s.windowMs, 90000);
  assert(larger.s.notes.length === 20);
});
test("Know Me pair bonus, predictor privacy, cap, hot-seat timeout, Auto", () => {
  const pair = play("know-me", 2, 1);
  assert.equal(pair.s.scores.p1, 50);
  assert.equal(pair.s.scores.p2, 100);
  const g = make("know-me", 8);
  action(g, g.s.lead, { pick: 3 });
  for (const pid of ["p2", "watch"])
    assert.equal(g.def.view(g.s, pid, g.ctx).myPick, null);
  for (const p of g.ctx.players())
    if (p.id !== g.s.lead) action(g, p.id, { pick: 3 });
  assert.equal(g.s.last.pts[g.s.lead], 100);
  const skip = make("know-me", 2);
  action(skip, "p2", { pick: 0 });
  deadline(skip);
  assert(skip.s.last.skipped);
  assert.deepEqual(skip.ctx.awards, {});
  assert.equal(make("know-me", 2, {}).s.rounds, 4);
  assert.equal(make("know-me", 20, {}).s.rounds, 12);
});
test("Who Wrote It exact partial credit, capped writer extras and absent writers", () => {
  const partial = make("who-wrote");
  enter(partial, "match");
  const ballot = legal("who-wrote", partial.s, "p1").matches,
    keys = Object.keys(ballot);
  [ballot[keys[0]], ballot[keys[1]]] = [ballot[keys[1]], ballot[keys[0]]];
  action(partial, "p1", { matches: ballot });
  for (const pid of ["p2", "p3", "p4"])
    action(partial, pid, legal("who-wrote", partial.s, pid));
  assert.equal(partial.s.last.pts.p1, 33);
  const capped = make("who-wrote", 8);
  enter(capped, "match");
  for (const p of capped.ctx.players()) {
    const notes = capped.s.notes.filter((n) => n.author !== p.id),
      wrong = Object.fromEntries(
        notes.map((n, i) => [n.id, notes[(i + 1) % notes.length].author]),
      );
    action(capped, p.id, { matches: wrong });
  }
  assert(
    Object.values(capped.s.last.pts).every((n) => n === 100),
    "every author bonus caps at 100",
  );
  const absent = make("who-wrote");
  action(absent, "p1", { answer: "A small note" });
  action(absent, "p2", { answer: "A different note" });
  deadline(absent);
  assert.equal(absent.s.notes.length, 2);
  assert(
    !absent.def.view(absent.s, "p3", absent.ctx).notes.some((n) => n.mine),
  );
  for (const p of absent.ctx.players())
    action(absent, p.id, legal("who-wrote", absent.s, p.id));
  assert.deepEqual(absent.s.last.pts, { p1: 100, p2: 100, p3: 100, p4: 100 });
});
test("Auto schedules drop unplayed turns when players leave", () => {
  for (const id of ["dial-in", "know-me"]) {
    const g = make(id, 4, {});
    g.ctx.leave(g.def, g.s, "p4");
    assert.equal(g.s.rounds, id === "dial-in" ? 3 : 6);
    assert(!g.s.schedule.slice(g.s.round).includes("p4"));
    const leads = [];
    for (let i = 0; g.s.phase !== "done" && i < 30; i++) {
      if (!leads.some((x) => x.round === g.s.round))
        leads.push({ round: g.s.round, pid: g.s.lead });
      step(id, g.def, g.s, g.ctx);
    }
    assert.equal(g.s.phase, "done");
    assert.equal(
      leads.filter((x) => x.pid === "p1").length,
      id === "dial-in" ? 1 : 2,
    );
  }
});
test("Submitted hidden inputs stay private until their reveal", () => {
  for (const id of ["think-alike", "who-wrote"]) {
    const g = make(id);
    action(g, "p1", { answer: "SecretMarkerOne" });
    for (const pid of ["p2", "watch"])
      assert(
        !JSON.stringify(g.def.view(g.s, pid, g.ctx)).includes(
          "SecretMarkerOne",
        ),
      );
    assert.equal(g.def.view(g.s, "p1", g.ctx).myAnswer, "SecretMarkerOne");
  }
  const d = make("dial-in");
  action(d, d.s.lead, { clue: "A kettle" });
  action(d, "p2", { guess: 37 });
  assert.equal(d.def.view(d.s, "p3", d.ctx).myGuess, null);
  assert.equal(d.def.view(d.s, "p2", d.ctx).myGuess, 37);
  const b = make("ballpark");
  action(b, "p1", { answer: 7654321 });
  assert.equal(b.def.view(b.s, "p2", b.ctx).myAnswer, null);
  assert(!JSON.stringify(b.def.view(b.s, "watch", b.ctx)).includes("7654321"));
});
test("Dial In band path clamps edges and traces the upper annulus in both directions", () => {
  const vm = require("node:vm");
  const source = fs
    .readFileSync(
      require("node:path").join(__dirname, "../public/js/games/dial-in.js"),
      "utf8",
    )
    .split("export default")[0]
    .replace(/^import .*;$/gm, "");
  const { targetBand, point } = vm.runInNewContext(
    source + "\n({targetBand,point})",
  );
  for (const target of [0, 2, 50, 98, 100]) {
    const band = targetBand(target);
    assert.equal(band.start, Math.max(0, target - 4));
    assert.equal(band.end, Math.min(100, target + 4));
    assert(band.end > band.start);
    assert(!/NaN|Infinity/.test(band.path));
    const match = band.path.match(
      /^M([\d.e+-]+) ([\d.e+-]+) A151 151 0 0 1 ([\d.e+-]+) ([\d.e+-]+) L([\d.e+-]+) ([\d.e+-]+) A113 113 0 0 0 ([\d.e+-]+) ([\d.e+-]+) Z$/,
    );
    assert(match, "closed annulus with opposing sweep flags");
    const coords = match.slice(1).map(Number);
    const endpoints = [
      [band.start, 151],
      [band.end, 151],
      [band.end, 113],
      [band.start, 113],
    ];
    endpoints.forEach(([value, radius], index) => {
      const [x, y] = point(value, radius);
      assert(Math.abs(coords[index * 2] - x) < 1e-9);
      assert(Math.abs(coords[index * 2 + 1] - y) < 1e-9);
      assert(
        x >= 29 - 1e-9 && x <= 331 + 1e-9 && y >= 7 - 1e-9 && y <= 158 + 1e-9,
      );
      assert(Math.abs(Math.hypot(x - 180, y - 158) - radius) < 1e-9);
    });
    assert(
      Math.abs(
        band.marker[0] - (180 - 132 * Math.cos((target * Math.PI) / 100)),
      ) < 1e-9,
    );
    assert(
      Math.abs(
        band.marker[1] - (158 - 132 * Math.sin((target * Math.PI) / 100)),
      ) < 1e-9,
    );
  }
});
console.log(`NEW_GAMES_B1_PASS: ${checks} checks across all five games`);
