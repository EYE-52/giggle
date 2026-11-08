"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FakeCtx } = require("./game-playability");
const { IDS, play } = require("./new-games-b4-harness");
const registry = require("../games/registry");
const roster = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: "p" + (i + 1),
    name: ["Asha", "Bo", "Cam", "Dev"][i % 4],
  }));
class Ctx extends FakeCtx {
  constructor(n = 4, settings = {}) {
    super(roster(n), settings);
    this.all = this._players.slice();
  }
  allPlayers() {
    return this.all.slice();
  }
  content(id) {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, "../locales/en", id + ".json")),
    );
  }
}
const act = (def, s, ctx, pid, a) => def.onAction(s, ctx, pid, a);
const view = (def, s, pid) => def.view(s, pid);
const flat = (s) =>
  JSON.stringify(s, (k, v) => (typeof v === "function" ? "[fn]" : v));
function make(id, n = 4, settings = { rounds: 1 }) {
  const def = registry.get(id),
    ctx = new Ctx(n, settings),
    s = def.create(ctx);
  return { def, ctx, s, send: (pid, a) => act(def, s, ctx, pid, a) };
}
let checks = 0;
for (const id of IDS) {
  for (const n of [2, 4]) {
    const def = registry.get(id),
      ctx = new Ctx(n, { rounds: 2 });
    const s = play(id, { def, ctx, act, view });
    assert.equal(s.phase, "done");
    assert.deepEqual(s.scores, {
      ...Object.fromEntries(s.roster.map((pid) => [pid, 0])),
      ...ctx.awards,
    });
    assert(
      Object.values(s.scores).every(
        (v) => v >= 0 && v <= (id === "hot-potato" ? 300 : 200),
      ),
    );
    if (id === "hot-potato")
      assert.deepEqual(
        Object.values(s.scores).sort((a, b) => b - a),
        n === 2 ? [300, 200] : [300, 200, 100, 0],
      );
    if (id === "echo-pads")
      assert.equal(s.level, 15, "perfect survivors clear level 15");
    checks++;
  }
  const { def, ctx, s, send } = make(id);
  const before = flat(s);
  for (const a of [
    null,
    [],
    {},
    { next: 0 },
    { answer: {} },
    { pick: NaN },
    { tap: -1 },
    { pad: 9 },
    { nope: -1 },
  ]) {
    send("p1", a);
    send("ghost", a);
  }
  assert.equal(flat(s), before, id + " garbage ignored");
  const watch = def.view(s, "ghost", ctx);
  assert.equal(watch.watching, true);
  assert.equal(watch.me, null);
  for (const secret of [
    "seed",
    "sequence",
    "odd",
    "locked",
    "picks",
    "taps",
    "used",
    "deal",
    "roster",
    "pending",
  ])
    assert(!(secret in watch), id + " hides " + secret);
  const terminal = { ...s.scores };
  def.onEnd(s, ctx);
  assert.equal(s.phase, "done");
  assert.equal(s.endsAt, 0);
  assert.deepEqual(s.scores, terminal);
  const ended = flat(s);
  ctx.fireUntil(() => !ctx.pending(), 200);
  assert.equal(flat(s), ended, id + " ended timers inert");
  const idle = make(id, 4, { rounds: 2 });
  idle.ctx.fireUntil(() => idle.s.phase === "done", 2000);
  assert.equal(idle.s.phase, "done", id + " idle match finishes");
  const left = make(id);
  left.ctx._players = left.ctx._players.filter((p) => p.id !== "p2");
  left.def.onPlayerGone(left.s, left.ctx, "p2");
  assert(left.s.gone.includes("p2"));
  const departed = flat(left.s);
  left.send("p2", { answer: "fresh", pass: left.s.passNo });
  assert.equal(flat(left.s), departed);
  left.ctx.fireUntil(() => left.s.phase === "done", 2000);
  assert.equal(left.s.phase, "done", id + " leaving does not stall");
  checks += 5;
}
// Shared seeded stream and exactly two seconds of lockout, without shaking.
{
  const { def, ctx, s, send } = make("math-dash");
  assert.equal(def.view(s, "p1").problem, def.view(s, "p2").problem);
  const answer = def.problem(s, 0).answer;
  send("p1", { answer: answer + 1, index: 0 });
  assert.equal(s.locked.p1, ctx.now() + 2000);
  send("p1", { answer, index: 0 });
  assert.equal(s.correct.p1, 0);
  ctx.advance(1999);
  send("p1", { answer, index: 0 });
  assert.equal(s.correct.p1, 0);
  ctx.advance(1);
  send("p1", { answer, index: 0 });
  assert.equal(s.correct.p1, 1);
  send("p1", { answer, index: 0 });
  assert.equal(s.correct.p1, 1, "stale duplicate ignored");
  send("p2", { answer, index: 0 });
  ctx.setNow(s.endsAt);
  send("p3", { answer, index: 0 });
  assert.equal(s.scores.p1, 100);
  assert.equal(s.scores.p2, 100);
  assert.equal(s.scores.p3, 0);
  const scored = flat(s);
  ctx.fireNext();
  assert.equal(flat(s), scored, "late math timer cannot reaward");
  for (const difficulty of ["Easy", "Normal", "Hard"]) {
    const m = make("math-dash", 2, { difficulty });
    for (let i = 0; i < 300; i++) {
      const p = m.def.problem(m.s, i);
      assert(Number.isInteger(p.answer));
      if (difficulty === "Easy") assert(p.answer >= 0 && p.answer <= 20);
    }
  }
  checks += 10;
}
{
  const { ctx, s, send } = make("emoji-spotter");
  send("p1", { tap: (s.odd + 1) % s.grid.length, round: s.round });
  send("p1", { tap: s.odd, round: s.round });
  assert.equal(s.taps.p1, undefined);
  send("p2", { tap: s.odd, round: s.round });
  send("p3", { tap: s.odd, round: s.round });
  ctx.advance(1);
  send("p4", { tap: s.odd, round: s.round });
  assert.deepEqual(s.scores, { p1: 0, p2: 100, p3: 100, p4: 50 });
  const pack = ctx.content("emoji-spotter");
  assert(pack.pairs.length >= 40);
  assert(pack.pairs.every((p) => p.length === 2 && p[0] !== p[1]));
  const grow = make("emoji-spotter", 2, { rounds: 8 });
  for (let r = 1; r <= 8; r++) {
    assert(grow.s.size >= 4 && grow.s.size <= 8);
    const counts = {};
    for (const e of grow.s.grid) counts[e] = (counts[e] || 0) + 1;
    assert.equal(Object.values(counts).filter((n) => n === 1).length, 1);
    if (r === 8) assert.equal(grow.s.size, 8);
    grow.ctx.fireUntil(() => grow.s.phase === "reveal");
    grow.send("p1", { next: true });
  }
  checks += 6;
}
{
  const { def, ctx, s, send } = make("echo-pads");
  ctx.fireUntil(() => s.phase === "repeat");
  assert(!("sequence" in def.view(s, "p1")));
  send("p1", { pad: (s.sequence[0] + 1) % 4, step: 0, level: s.level });
  assert(!s.alive.includes("p1"));
  for (const pid of ["p2", "p3", "p4"])
    for (const pad of s.sequence.slice())
      send(pid, { pad, level: s.level, step: s.cursor[pid] });
  assert.equal(s.phase, "show");
  assert.equal(s.level, 2);
  assert.equal(s.sequence.length, 4);
  ctx.fireUntil(() => s.phase === "repeat");
  for (const pid of ["p2", "p3", "p4"])
    send(pid, { pad: (s.sequence[0] + 1) % 4, step: 0, level: s.level });
  assert.equal(s.phase, "reveal");
  assert.equal(s.scores.p1, 0);
  assert.equal(s.scores.p2, 100);
  checks += 5;
}
{
  const { ctx, s, send } = make("color-clash");
  assert.equal(s.windowMs, 2500);
  assert.equal(
    new Set(ctx.content("color-clash").colors.marks).size,
    4,
    "ink has four distinct non-colour cues",
  );
  send("p1", { pick: s.card[s.card.mode], card: s.index });
  assert.equal(s.raw.p1, 10);
  send("p1", { pick: s.card[s.card.mode], card: s.index });
  assert.equal(s.raw.p1, 10);
  ctx.advance(2400);
  send("p2", { pick: s.card[s.card.mode], card: s.index });
  assert.equal(s.raw.p2, 5);
  const old = s.index;
  ctx.advance(100);
  send("p3", { pick: s.card[s.card.mode], card: old });
  assert.equal(s.index, old + 1);
  assert.equal(s.raw.p3, 0);
  assert.equal(s.card.mode, "word");
  const card = flat(s);
  ctx.fireNext();
  assert.equal(flat(s), card, "old card timer inert");
  ctx.fireUntil(() => s.phase === "reveal");
  assert.equal(s.scores.p1, 100);
  assert.equal(s.scores.p2, 50);
  checks += 6;
}
{
  const { def, ctx, s, send } = make("hot-potato");
  assert(ctx.content("hot-potato").categories.length >= 60);
  assert.equal(def.view(s, "p1", ctx).endsAt, 0);
  assert.equal(def.view(s, "ghost", ctx).windowMs, 0);
  const fuse = s.endsAt;
  send("p2", { answer: "Spoon", pass: s.passNo });
  assert.equal(s.holder, "p1");
  send("p1", { answer: "Spoon", pass: s.passNo });
  assert.equal(s.holder, "p2");
  const entry = s.pending[0];
  send("p1", { nope: entry.id });
  assert.equal(entry.voters.length, 0);
  send("p2", { nope: entry.id });
  send("p2", { nope: entry.id });
  assert.equal(s.holder, "p2");
  send("p3", { nope: entry.id });
  assert.equal(s.holder, "p1");
  assert.equal(s.endsAt, fuse);
  send("p1", { answer: " spoon ", pass: s.passNo });
  assert.equal(s.holder, "p1", "normalized repeat rejected");
  for (const text of [
    "a",
    "<script>",
    "https://x.test",
    "!!!!!!!!",
    "aaaaaaaaaa",
    "x".repeat(31),
  ]) {
    const before = flat(s);
    send("p1", { answer: text, pass: s.passNo });
    assert.equal(flat(s), before);
  }
  send("p1", { answer: "Plate", pass: s.passNo });
  const last = s.pending.at(-1);
  ctx.setNow(last.until);
  send("p2", { nope: last.id });
  assert.equal(last.voters.length, 0, "late challenge ignored");
  ctx.setNow(fuse);
  send(s.holder, { answer: "Cup", pass: s.passNo });
  assert.equal(s.phase, "reveal");
  const two = make("hot-potato", 2);
  two.send("p1", { answer: "Spoon", pass: two.s.passNo });
  two.send("p2", { nope: two.s.pending[0].id });
  assert.equal(two.s.holder, "p1");
  checks += 12;
}
console.log(
  `NEW_GAMES_B4_PASS: ${checks} groups; 2/4-seat full matches, ties, deadlines, privacy, leaving, End game, garbage, content and pace`,
);
// Pace covers every round deadline; explicit short card/step timers preserve
// their sub-three-second rhythm. The maths penalty stays exactly 2 seconds.
for (const id of IDS) {
  const original = Math.random;
  try {
    Math.random = () => 0.25;
    const quick = make(id, 4, { rounds: 1, pace: "Quick" });
    Math.random = () => 0.25;
    const relaxed = make(id, 4, { rounds: 1, pace: "Relaxed" });
    assert(
      relaxed.s.windowMs > quick.s.windowMs,
      id + " Pace scales initial window",
    );
    for (const item of [quick, relaxed]) {
      const { def, ctx, s } = item;
      for (let i = 0; i < 6 && s.phase !== "done"; i++) {
        const projected = def.view(s, "ghost", ctx);
        assert(
          !("seed" in projected) &&
            !("sequence" in projected) &&
            !("odd" in projected),
        );
        const saved = flat(s.scores);
        const phase = s.phase;
        if (i === 5 || phase === "reveal") {
          def.onEnd(s, ctx);
          const terminal = flat(s);
          ctx.fireUntil(() => !ctx.pending(), 500);
          assert.equal(flat(s), terminal);
          assert.equal(flat(s.scores), saved);
          break;
        }
        ctx.fireNext();
      }
    }
  } finally {
    Math.random = original;
  }
}
console.log(
  "NEW_GAMES_B4_PACE_PASS: Quick/Relaxed deadlines and End game during live phases",
);

// Old answers remain challengeable for their full window after later passes.
{
  const { ctx, s, send } = make("hot-potato");
  const fuse = s.endsAt;
  send("p1", { answer: "Spoon", pass: s.passNo });
  const first = s.pending[0].id;
  send("p2", { answer: "Plate", pass: s.passNo });
  const second = s.pending[1].id;
  assert.equal(s.holder, "p3");
  send("p2", { nope: first });
  send("p3", { nope: first });
  assert.equal(s.holder, "p1");
  send("p1", { nope: second });
  send("p3", { nope: second });
  assert.equal(s.holder, "p2");
  assert.equal(s.endsAt, fuse);
  ctx.fireNext();
  ctx.fireNext();
  assert.equal(
    s.pending.length,
    0,
    "challenge deadlines survive holder changes",
  );
  assert.deepEqual(s.used, ["spoon", "plate"]);
}
{
  const { ctx, s, send } = make("emoji-spotter");
  for (const pid of s.roster) {
    send(pid, { tap: s.odd, round: s.round });
    ctx.advance(1);
  }
  assert.deepEqual(s.scores, { p1: 100, p2: 75, p3: 50, p4: 25 });
}
console.log(
  "NEW_GAMES_B4_EDGE_PASS: full podium, level 15, distinct tap ranks and concurrent challenge windows",
);
