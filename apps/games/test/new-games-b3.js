"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  IDS,
  start,
  act,
  finishRound,
  play,
} = require("./new-games-b3-harness");
let checks = 0;
function check(name, fn) {
  fn();
  checks++;
  console.log("B3 PASS " + name);
}
function flat(s) {
  return JSON.stringify(s, (_, v) => (typeof v === "function" ? "[fn]" : v));
}
for (const id of IDS) {
  for (const count of [2, 3, 4, 6])
    check(`${id}: complete ${count}-player match`, () => play(id, count));
  check(id + ": garbage, spectators, end and stale timers", () => {
    const h = start(id),
      before = flat(h.s);
    const bad = [
      null,
      false,
      2,
      [],
      {},
      { next: 1 },
      { guess: {} },
      { card: -1 },
      { card: 25 },
      { clue: "two words", number: 1 },
      { start: 1 },
    ];
    for (const a of bad) {
      act(h, "p1", a);
      act(h, "outsider", a);
    }
    assert.equal(flat(h.s), before);
    for (const p of [...h.ctx.roster, { id: "outsider" }])
      assert.doesNotThrow(() => JSON.stringify(h.def.view(h.s, p.id, h.ctx)));
    const jobs = h.ctx.timers.slice();
    h.def.onEnd(h.s, h.ctx);
    const ended = flat(h.s);
    for (const job of jobs) job.fn();
    assert.equal(flat(h.s), ended);
    assert.equal(h.s.endsAt, 0);
  });
  check(id + ": idle phases finish the whole game", () => {
    const h = start(id, 4, { rounds: 2, pace: "Quick" });
    let n = 0;
    while (h.s.phase !== "done" && n++ < 100) h.ctx.fire();
    assert.equal(h.s.phase, "done");
    assert(n < 100);
    assert.deepEqual(h.ctx.awards, {});
  });
  check(id + ": player leaves during a live round", () => {
    const h = start(id);
    if (h.s.phase === "setup") act(h, "p1", { start: true });
    h.ctx.leave(h.def, h.s, h.s.lead || "p2");
    assert(h.s.gone.length === 1);
    finishRound(h);
    assert(["reveal", "done"].includes(h.s.phase));
    const before = flat(h.s);
    act(h, h.s.gone[0], { next: true, guess: "apple", card: 0 });
    assert.equal(flat(h.s), before);
  });
  check(id + ": host election and reveal Next", () => {
    const h = start(id);
    finishRound(h);
    h.ctx.host = "p2";
    assert.equal(h.def.view(h.s, "p2", h.ctx).hostId, "p2");
    const round = h.s.round;
    act(h, "p2", { next: true });
    assert(h.s.round > round || h.s.phase === "done");
  });
}
check(
  "Clue Grid: key distribution, hidden key, clue validation and first tap",
  () => {
    const h = start("clue-grid");
    act(h, "p1", { start: true });
    const s = h.s,
      spy = h.def.view(s, s.lead, h.ctx),
      guesser = s.teams[s.team].find((p) => p !== s.lead);
    const counts = {};
    for (const c of spy.cards) counts[c.kind] = (counts[c.kind] || 0) + 1;
    assert.deepEqual(
      Object.values(counts).sort((a, b) => a - b),
      [1, 7, 8, 9],
    );
    for (const pid of [guesser, "outsider"])
      assert(
        h.def.view(s, pid, h.ctx).cards.every((c) => !Object.hasOwn(c, "kind")),
      );
    for (const a of [
      { clue: s.cards[0].word, number: 1 },
      { clue: "a-b", number: 2 },
      { clue: "valid", number: 10 },
      { clue: "valid", number: NaN },
    ])
      act(h, s.lead, a);
    assert.equal(s.phase, "clue");
    act(h, s.lead, { clue: "discovery", number: 2 });
    act(h, guesser, { pass: true });
    assert.equal(s.phase, "guess");
    const card = s.cards.findIndex((c) => c.kind === s.team);
    act(h, guesser, { card });
    act(h, guesser, { card });
    assert.equal(s.picks, 1);
    act(h, guesser, { pass: true });
    assert.equal(s.phase, "clue");
  },
);
check("Clue Grid: trap loss, co-op half credit, role rotation", () => {
  const h = start("clue-grid");
  act(h, "p1", { start: true });
  const losing = h.s.team;
  act(h, h.s.lead, { clue: "discovery", number: 0 });
  act(
    h,
    h.s.teams[losing].find((p) => p !== h.s.lead),
    { card: h.s.cards.findIndex((c) => c.kind === "trap") },
  );
  assert.equal(h.s.phase, "reveal");
  for (const p of h.s.teams[losing]) assert.equal(h.s.scores[p], 0);
  const old = { ...h.s.leads };
  act(h, "p1", { next: true });
  assert.notEqual(h.s.leads.red, old.red);
  assert.notEqual(h.s.leads.blue, old.blue);
  const coop = start("clue-grid", 2);
  act(coop, "p1", { start: true });
  act(coop, coop.s.lead, { clue: "discovery", number: 7 });
  const g = coop.s.teams.red.find((p) => p !== coop.s.lead);
  for (const i of coop.s.cards
    .map((c, i) => (c.kind === "red" ? i : -1))
    .filter((i) => i >= 0)
    .slice(0, 8))
    act(coop, g, { card: i });
  finishRound(coop);
  assert.deepEqual(Object.values(coop.s.last.pts), [50, 50]);
});
check(
  "Letter Lock: duplicate rules, points, privacy, dictionary and late input",
  () => {
    const h = start("letter-lock");
    h.s.answer = "apple";
    assert.deepEqual(h.def.marks("allee", "apple"), [
      "right",
      "present",
      "absent",
      "absent",
      "right",
    ]);
    act(h, "p1", { guess: "zzzzz" });
    assert.equal(h.s.rows.p1.length, 0);
    act(h, "p1", { guess: "apple" });
    assert.equal(h.def.view(h.s, "p2").boards.p1[0].word, undefined);
    assert.deepEqual(h.def.view(h.s, "outsider").myRows, []);
    act(h, "p2", { guess: "apple" });
    finishRound(h);
    assert.equal(h.s.last.pts.p1, 200);
    assert.equal(h.s.last.pts.p2, 150);
    const late = start("letter-lock");
    late.ctx.time = late.s.endsAt;
    act(late, "p1", { guess: late.s.answer });
    assert.equal(late.s.last.pts.p1, 0);
    const half = start("letter-lock");
    half.s.answer = "apple";
    act(half, "p1", { guess: "ample" });
    finishRound(half);
    assert.equal(half.s.last.pts.p1, 50);
  },
);
check(
  "Word Grid: dictionary paths, Qu, no reuse, uniqueness, ties and secrets",
  () => {
    const { solve, validPath } = require("../games/engines/word-grid-lexicon");
    const grid = [
      "Qu",
      "I",
      "T",
      "E",
      "A",
      "R",
      "E",
      "S",
      "D",
      "O",
      "G",
      "N",
      "L",
      "I",
      "N",
      "E",
    ];
    assert(validPath(grid, "quit", [0, 1, 2]));
    assert(!validPath(grid, "quit", [0, 1, 2, 0]));
    assert(solve(grid).quit);
    assert(!validPath(grid, "quit", [0, 2, 1]));
    const h = start("word-grid");
    h.s.grid = grid;
    h.s.solutions = solve(grid);
    act(h, "p1", { word: "quit", path: [0, 2, 1] });
    assert.equal(h.s.words.p1.length, 0);
    act(h, "p1", { word: "quit", path: [0, 1, 2] });
    act(h, "p2", { word: "quit" });
    assert(!JSON.stringify(h.def.view(h.s, "outsider")).includes("quit"));
    for (const p of ["p3", "p4"]) act(h, p, { word: "dog" });
    finishRound(h);
    assert(
      Object.values(h.s.last.words)
        .flat()
        .every((w) => w.shared && w.points === 0),
    );
    assert.deepEqual(Object.values(h.s.last.pts), [0, 0, 0, 0]);
    assert(h.s.last.longest.length <= 5);
    assert.deepEqual(
      [3, 4, 5, 6, 7, 8, 10].map((n) => h.def.wordPoints("a".repeat(n))),
      [1, 1, 2, 3, 5, 11, 11],
    );
  },
);
check(
  "Word Grid: family word pool excludes adult dictionary hints and guesses",
  () => {
    const { solve } = require("../games/engines/word-grid-lexicon");
    const h = start("word-grid");
    h.s.grid = [
      "P",
      "O",
      "R",
      "N",
      "C",
      "A",
      "T",
      "O",
      "D",
      "O",
      "G",
      "S",
      "L",
      "I",
      "N",
      "E",
    ];
    h.s.solutions = solve(h.s.grid);
    assert(!h.s.solutions.porno);
    assert(h.s.solutions.cat);
    act(h, "p1", { word: "porno" });
    assert.deepEqual(h.s.words.p1, []);
    act(h, "p1", { word: "cat" });
    assert.deepEqual(h.s.words.p1, ["cat"]);
    finishRound(h);
    assert(!h.s.last.longest.includes("porno"));
  },
);
check(
  "Banned Words: rivals can judge the banned words without seeing the target",
  () => {
    const h = start("banned-words");
    h.s.card = {
      target: "secrettarget",
      banned: ["listen", "quiet", "talk", "clue"],
    };
    const team = h.s.teams[h.s.team];
    const rival = h.s.roster.find((pid) => !team.includes(pid));
    const guesser = team.find((pid) => pid !== h.s.lead);
    const view = h.def.view(h.s, rival, h.ctx);
    assert.equal(view.card, null);
    assert.deepEqual(view.banned, h.s.card.banned);
    assert(!JSON.stringify(view).includes(h.s.card.target));
    for (const pid of [guesser, "outsider"])
      assert.deepEqual(h.def.view(h.s, pid, h.ctx).banned, []);
    view.banned.pop();
    assert.equal(h.s.card.banned.length, 4);
    finishRound(h);
    assert.deepEqual(h.def.view(h.s, rival, h.ctx).banned, []);
    const coop = start("banned-words", 2);
    assert.deepEqual(coop.def.view(coop.s, "p2", coop.ctx).banned, []);
  },
);
check(
  "Banned Words: privacy, stale card protection, skip limit, buzz teams and cap",
  () => {
    const h = start("banned-words"),
      lead = h.s.lead,
      team = h.s.teams[h.s.team],
      guesser = team.find((p) => p !== lead),
      rival = h.s.roster.find((p) => !team.includes(p));
    assert(h.def.view(h.s, lead).card);
    assert.equal(h.def.view(h.s, guesser).card, null);
    assert.equal(h.def.view(h.s, "outsider").card, null);
    const rev = h.s.cardNo;
    act(h, guesser, { buzz: true, cardNo: rev });
    assert.equal(h.s.cardNo, rev);
    act(h, rival, { buzz: true, cardNo: rev });
    assert.equal(h.s.cardNo, rev + 1);
    act(h, rival, { buzz: true, cardNo: rev });
    assert.equal(h.s.cardNo, rev + 1);
    for (let i = 0; i < 4; i++)
      act(h, lead, { skip: true, cardNo: h.s.cardNo });
    assert.equal(h.s.skips, 3);
    for (let i = 0; i < 7; i++)
      act(h, guesser, {
        guess: h.s.card.target.toUpperCase() + "!",
        cardNo: h.s.cardNo,
      });
    finishRound(h);
    for (const p of team) assert.equal(h.s.scores[p], 100);
    const c = start("banned-words", 2),
      no = c.s.cardNo;
    act(c, "p2", { buzz: true, cardNo: no });
    assert.equal(c.s.cardNo, no);
  },
);
check(
  "Read My Lips: word matching, repeated words, best guess, private guesses and rewards",
  () => {
    const h = start("read-my-lips", 6);
    h.s.phrase = "the tiny tiny dog";
    assert.equal(h.def.match("tiny dog", "the tiny tiny dog"), 50);
    assert.equal(h.def.match("dog tiny the tiny", "the tiny tiny dog"), 100);
    assert.equal(h.def.match("tiny", "the tiny tiny dog"), 0);
    act(h, "p2", { guess: "tiny dog" });
    act(h, "p2", { guess: "wrong" });
    assert.equal(h.s.results.p2, 50);
    assert(!JSON.stringify(h.def.view(h.s, "p3")).includes("tiny dog"));
    for (const p of ["p2", "p3", "p4", "p5", "p6"])
      act(h, p, { guess: "the tiny tiny dog" });
    assert.equal(h.s.scores.p1, 100);
    assert.equal(h.s.scores.p2, 150);
    assert.equal(h.s.scores.p3, 100);
  },
);
check(
  "Locale content is complete, original-shaped and dictionary supported",
  () => {
    const pack = (id) =>
      JSON.parse(fs.readFileSync("locales/en/" + id + ".json"));
    assert(pack("clue-grid").words.length >= 300);
    assert(pack("letter-lock").answers.length >= 300);
    const dict =
      require("../games/engines/english-dictionary").createWordValidator();
    assert(
      pack("letter-lock").answers.every((w) => w.length === 5 && dict.has(w)),
    );
    const cards = pack("banned-words").cards;
    assert(cards.length >= 120);
    assert(
      cards.every((c) => c.banned.length === 4 && new Set(c.banned).size === 4),
    );
    const phrases = pack("read-my-lips").phrases;
    assert(phrases.length >= 80);
    assert(
      phrases.every(
        (p) => p.split(" ").length >= 2 && p.split(" ").length <= 5,
      ),
    );
  },
);
for (const id of IDS) {
  check(id + ": pace scales live and reveal clocks", () => {
    for (const pace of ["Quick", "Normal", "Relaxed"]) {
      const h = start(id, 4, { rounds: 2, pace });
      const seconds =
        id === "clue-grid"
          ? 15
          : id === "letter-lock"
            ? 120
            : id === "word-grid"
              ? 90
              : id === "banned-words"
                ? 60
                : 45;
      const factor = pace === "Quick" ? 0.67 : pace === "Relaxed" ? 1.5 : 1;
      assert.equal(h.s.windowMs, Math.round(seconds * factor) * 1000);
      finishRound(h);
      assert.equal(h.s.windowMs, Math.round(8 * factor) * 1000);
    }
  });
}
check("Turn games skip departed seats without duplicate turns", () => {
  for (const id of ["banned-words", "read-my-lips"]) {
    const h = start(id, 4, {}),
      seen = [h.s.lead];
    h.ctx.leave(h.def, h.s, "p2");
    while (h.s.phase !== "done") {
      finishRound(h);
      act(h, "p1", { next: true });
      if (h.s.phase !== "done") seen.push(h.s.lead);
    }
    assert.deepEqual(
      seen,
      id === "banned-words"
        ? ["p1", "p3", "p4"]
        : ["p1", "p3", "p4", "p1", "p3", "p4"],
    );
  }
});
check("Word Grid gives equal positive round points to tied players", () => {
  const h = start("word-grid");
  h.s.grid = [
    "Qu",
    "I",
    "T",
    "E",
    "A",
    "R",
    "E",
    "S",
    "D",
    "O",
    "G",
    "N",
    "L",
    "I",
    "N",
    "E",
  ];
  h.s.solutions = require("../games/engines/word-grid-lexicon").solve(h.s.grid);
  act(h, "p1", { word: "dog" });
  act(h, "p2", { word: "line" });
  finishRound(h);
  assert.deepEqual(Object.values(h.s.last.pts), [100, 100, 0, 0]);
});
check("Read My Lips does not match inherited object keys", () => {
  const h = start("read-my-lips");
  assert.equal(h.def.match("constructor", "tiny dog"), 0);
  assert.equal(h.def.match("toString", "tiny dog"), 0);
});
check("End game keeps earned points and cannot award twice", () => {
  const h = start("letter-lock");
  for (const p of h.ctx.roster) act(h, p.id, { guess: h.s.answer });
  assert(Object.values(h.s.scores).every((n) => n > 0));
  const before = { ...h.s.scores },
    awarded = { ...h.ctx.awards },
    jobs = h.ctx.timers.slice();
  act(h, "p1", { next: true });
  h.def.onEnd(h.s, h.ctx);
  for (const job of jobs) job.fn();
  assert.deepEqual(h.s.scores, before);
  assert.deepEqual(h.ctx.awards, awarded);
});
check("Team games move safely to co-op after a departure", () => {
  for (const id of ["clue-grid", "banned-words"]) {
    const h = start(id);
    if (h.s.phase === "setup") act(h, "p1", { start: true });
    h.ctx.leave(h.def, h.s, "p4");
    finishRound(h);
    act(h, "p1", { next: true });
    assert.equal(h.s.coop, true);
    assert.equal(h.s.teams.red.length, 3);
  }
});
console.log(`NEW_GAMES_B3_PASS: ${checks} rule groups`);
