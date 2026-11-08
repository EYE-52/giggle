"use strict";
const assert = require("node:assert/strict");
const { IDS, start, play, phrase } = require("./new-games-b2-harness");
let checks = 0;
function test(label, run) {
  run();
  checks++;
  console.log("B2 PASS " + label);
}
function unchanged(h, pid, action) {
  const before = JSON.stringify(h.s),
    points = JSON.stringify(h.ctx.awards);
  h.act(pid, action);
  assert.equal(JSON.stringify(h.s), before);
  assert.equal(JSON.stringify(h.ctx.awards), points);
}
for (const id of IDS) {
  for (const n of id === "moonlit-village"
    ? [5, 8, 16]
    : [3, 4, id === "odd-one-out" || id === "undercover" ? 12 : 20])
    test(id + " complete game with " + n + " players", () => play(id, n, 2));
  test(id + " garbage, spectator, deadlines, End game and stale timer", () => {
    const h = start(id);
    for (const a of [
      null,
      false,
      42,
      "next",
      [],
      {},
      { vote: "__proto__" },
      { place: NaN },
      { target: {} },
      { next: "yes" },
    ])
      unchanged(h, "p1", a);
    unchanged(h, "spectator", {
      vote: "p1",
      pick: "p1",
      target: "p1",
      next: true,
    });
    const old = h.ctx.timers[0].fn;
    const initial = h.s.phase;
    h.ctx.fire();
    assert(h.s.phase !== initial || h.s.turnNo > 1);
    if (id !== "moonlit-village") {
      let cap = 0;
      while (h.s.phase !== "done" && cap++ < 120) h.ctx.fire();
      assert.equal(h.s.phase, "done");
    } else {
      h.ctx.fire();
      h.ctx.fire();
      h.ctx.fire();
      assert.equal(h.s.phase, "night");
    }
    h.game.onEnd(h.s, h.ctx);
    assert.equal(h.s.endsAt, 0);
    const final = JSON.stringify(h.s),
      awards = JSON.stringify(h.ctx.awards);
    old();
    h.act("p1", { next: true });
    assert.equal(JSON.stringify(h.s), final);
    assert.equal(JSON.stringify(h.ctx.awards), awards);
  });
  test(id + " late action rejected at exact deadline", () => {
    const h = start(id);
    h.ctx.time = h.s.endsAt;
    const a =
      id === "odd-one-out"
        ? { callVote: true }
        : id === "undercover"
          ? { clue: "bright" }
          : id === "backronyms"
            ? { phrase: phrase(h.s.letters) }
            : id === "whisper"
              ? { pick: "p2" }
              : { target: "p2" };
    h.act(
      id === "undercover"
        ? h.s.turnPid
        : id === "whisper"
          ? h.s.whisperer
          : "p1",
      a,
    );
    assert(!h.s.answers?.p1);
    assert(!h.s.chosen);
    assert(!h.s.nightVotes?.p1);
  });
  test(id + " leaves mid-round without waiting on departed seat", () => {
    const h = start(id),
      pid =
        id === "undercover"
          ? h.s.turnPid
          : id === "whisper"
            ? h.s.whisperer
            : "p2";
    h.ctx.connected = h.ctx.connected.filter((p) => p.id !== pid);
    h.game.onPlayerGone(h.s, h.ctx, pid);
    assert(h.s.gone.includes(pid));
    assert.equal(h.v(pid).watching, true);
    const before = JSON.stringify(h.s);
    h.act(pid, { next: true, pick: "p1", callVote: true });
    assert.equal(JSON.stringify(h.s), before);
    for (let i = 0; i < 12 && h.s.phase !== "done"; i++) h.ctx.fire();
    h.game.onEnd(h.s);
    assert.equal(h.s.phase, "done");
  });
  test(id + " privacy and safe host election", () => {
    const h = start(id),
      spectator = h.v("spectator");
    for (const field of [
      "deal",
      "answers",
      "pair",
      "undercover",
      "outsider",
      "protect",
      "peek",
      "nightVotes",
      "questionBank",
      "options",
      "_expire",
      "_cancel",
    ])
      assert(!Object.hasOwn(spectator, field), field);
    assert(
      !spectator.word &&
        !spectator.card &&
        !spectator.question &&
        !spectator.role,
    );
    h.ctx.connected.shift();
    assert.equal(h.v("p2").hostId, "p2");
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(spectator)));
  });
}
test("Odd One Out: strict tie, escape, early correct/wrong and caught last chance", () => {
  for (const mode of ["tie", "correct", "wrong", "caught"]) {
    const h = start("odd-one-out"),
      { s, ctx, act } = h,
      out = s.outsider;
    const index = s.options.indexOf(s.place.name);
    if (mode === "correct" || mode === "wrong")
      act(out, { place: mode === "correct" ? index : (index + 1) % 12 });
    else {
      act(ctx.hostId(), { endTalk: true });
      if (mode === "tie") {
        const others = s.ids.filter((pid) => pid !== out);
        act(others[0], { vote: out });
        act(out, { vote: others[0] });
        ctx.fire();
      } else {
        for (const pid of s.ids)
          act(pid, { vote: pid === out ? s.ids.find((p) => p !== out) : out });
        assert.equal(s.phase, "lastChance");
        act(out, { place: index });
      }
    }
    assert.equal(s.phase, "reveal");
    assert.equal(
      s.scores[out],
      mode === "wrong" ? 0 : mode === "caught" ? 100 : 150,
    );
    if (mode === "wrong" || mode === "caught")
      for (const pid of s.ids.filter((p) => p !== out))
        assert.equal(s.scores[pid], 100);
    const before = JSON.stringify(ctx.awards);
    act(out, { place: index });
    assert.equal(JSON.stringify(ctx.awards), before);
  }
});
test("Moonlit Village: roles scale, healer restriction, Seer privacy, ghost roles and tied day", () => {
  const h = start("moonlit-village", 8),
    { s, ctx, act, v } = h;
  assert.equal(Object.values(s.roles).filter((r) => r === "wolf").length, 2);
  const seer = s.ids.find((p) => s.roles[p] === "seer"),
    healer = s.ids.find((p) => s.roles[p] === "healer"),
    wolf = s.ids.find((p) => s.roles[p] === "wolf");
  const villager = s.ids.find((p) => s.roles[p] === "villager");
  act(wolf, { target: villager });
  act(healer, { target: villager });
  act(seer, { target: wolf });
  assert.equal(v(seer).seen, "wolves");
  assert.equal(v(villager).seen, null);
  assert.deepEqual(v(villager).roles, {});
  assert.equal(Object.keys(v(wolf).roles).length, 2);
  ctx.fire();
  assert(s.alive.includes(villager));
  for (const pid of s.alive) act(pid, { ready: true });
  act(s.alive[0], { vote: s.alive[1] });
  act(s.alive[1], { vote: s.alive[0] });
  ctx.fire();
  assert.equal(s.alive.length, 8);
  act(ctx.hostId(), { next: true });
  unchanged(h, healer, { target: villager });
  for (const pid of s.ids.filter((p) => s.roles[p] === "wolf"))
    act(pid, { target: villager });
  ctx.fire();
  assert(!s.alive.includes(villager));
  assert.equal(Object.keys(v(villager).roles).length, 8);
  assert.deepEqual(v("spectator").roles, {});
});
test("Moonlit Village: wolves win, fallen allies win, surviving losers get 100", () => {
  const h = start("moonlit-village"),
    { s, ctx, act } = h;
  const wolf = s.ids.find((p) => s.roles[p] === "wolf");
  while (s.phase !== "done") {
    if (s.phase === "night") {
      act(wolf, { target: s.alive.find((p) => p !== wolf) });
      ctx.fire();
    } else if (s.phase === "day")
      for (const p of [...s.alive]) act(p, { ready: true });
    else if (s.phase === "vote") {
      const target = s.alive.find((p) => p !== wolf);
      for (const p of [...s.alive])
        act(p, { vote: p === target ? wolf : target });
    } else act(ctx.hostId(), { next: true });
  }
  assert.equal(s.last.winner, "wolves");
  assert.equal(s.scores[wolf], 300);
  for (const p of s.ids.filter((p) => p !== wolf))
    assert.equal(s.scores[p], s.alive.includes(p) ? 100 : 0);
});
test("Undercover: no role disclosure, clue validation, ties, timeout survival and two spies", () => {
  const h = start("undercover", 7),
    { s, ctx, act, v } = h;
  assert.equal(s.undercover.length, 2);
  assert(!Object.hasOwn(v(s.undercover[0]), "role"));
  const pid = s.turnPid;
  for (const clue of ["two words", "", s.pair[0], s.pair[1], 12])
    unchanged(h, pid, { clue });
  act(pid, { clue: "Sparkly" });
  unchanged(h, s.turnPid, { clue: "sparkly" });
  while (s.phase === "clue") ctx.fire();
  act(s.alive[0], { vote: s.alive[1] });
  act(s.alive[1], { vote: s.alive[0] });
  ctx.fire();
  assert.equal(s.alive.length, 7);
  assert.equal(s.cycle, 2);
  while (s.phase !== "reveal") ctx.fire();
  for (const spy of s.undercover) assert.equal(s.scores[spy], 150);
  assert.equal(v("spectator").word, null);
});
test("Backronyms: ordered initials, anonymous ballot, self vote and equal tied points", () => {
  const h = start("backronyms", 3),
    { s, ctx, act, v } = h;
  unchanged(h, "p1", { phrase: "wrong initials" });
  unchanged(h, "p1", { phrase: "A".repeat(81) });
  act("p1", { phrase: phrase(s.letters) });
  assert.equal(v("p2").myPhrase, null);
  assert.equal(v("spectator").entries.length, 0);
  act("p2", { phrase: phrase(s.letters, 1) });
  act("p3", { phrase: phrase(s.letters, 2) });
  for (const e of v("spectator").entries)
    assert(!Object.hasOwn(e, "pid") && !e.mine);
  const entry = (pid) => s.entries.find((e) => e.pid === pid).id;
  unchanged(h, "p1", { vote: entry("p1") });
  act("p1", { vote: entry("p2") });
  act("p2", { vote: entry("p3") });
  act("p3", { vote: entry("p1") });
  assert.deepEqual(s.scores, { p1: 125, p2: 125, p3: 125 });
  assert.equal(s.last.winners.length, 3);
});
test("Whisper: private pick, sealed coin, heads and tails privacy, no duplicate awards", () => {
  for (const coin of ["heads", "tails"]) {
    const random = Math.random;
    try {
      const h = start("whisper"),
        { s, ctx, act, v } = h;
      const whisperer = s.whisperer,
        secret = s.question;
      assert.equal(v("p2").question, null);
      assert.equal(v(whisperer).question, secret);
      act(whisperer, { pick: "p2" });
      assert.equal(s.scores[whisperer], 100);
      const before = JSON.stringify(ctx.awards);
      act(whisperer, { pick: "p3" });
      assert.equal(JSON.stringify(ctx.awards), before);
      Math.random = () => (coin === "heads" ? 0 : 0.99);
      for (const pid of s.ids.filter((p) => p !== whisperer))
        act(pid, { guess: coin });
      assert.equal(s.phase, "flip");
      assert(!JSON.stringify(v("spectator")).includes(secret));
      assert(!Object.hasOwn(v("p2"), "coin"));
      ctx.fire();
      for (const pid of s.ids) assert.equal(s.scores[pid], 100);
      assert.equal(v("p2").last.question, coin === "heads" ? secret : null);
      if (coin === "tails")
        for (const pid of [...s.ids, "spectator"])
          assert(!JSON.stringify(v(pid)).includes(secret));
      act(ctx.hostId(), { next: true });
      if (coin === "tails")
        assert(!JSON.stringify(v(whisperer)).includes(secret));
    } finally {
      Math.random = random;
    }
  }
});
test("Whisper: Auto gives each player one turn, and empty picks skip without points", () => {
  const h = start("whisper", 4, {}),
    seen = [];
  assert.equal(h.s.rounds, 4);
  while (h.s.phase !== "done") {
    if (h.s.phase === "pick") seen.push(h.s.whisperer);
    h.ctx.fire();
  }
  assert.equal(new Set(seen).size, 4);
  assert.equal(
    Object.values(h.s.scores).reduce((a, b) => a + b),
    0,
  );
});
test("Pace scales every game window", () => {
  for (const id of IDS) {
    const n = id === "moonlit-village" ? 5 : 3;
    const normal = start(id, n, { rounds: 1 }).s.windowMs;
    const relaxed = start(id, n, { rounds: 1, pace: "Relaxed" }).s.windowMs;
    const quick = start(id, n, { rounds: 1, pace: "Quick" }).s.windowMs;
    assert.equal(relaxed, Math.round((normal / 1000) * 1.5) * 1000);
    assert.equal(quick, Math.max(3, Math.round((normal / 1000) * 0.67)) * 1000);
  }
});
test("Content counts and unique original entries", () => {
  const content = (id) => require("../locales/en/" + id + ".json");
  const places = content("odd-one-out").places;
  assert(places.length >= 30);
  assert.equal(new Set(places.map((p) => p.name)).size, places.length);
  for (const p of places)
    assert(p.roles.length >= 6 && new Set(p.roles).size === p.roles.length);
  const pairs = content("undercover").pairs;
  assert(pairs.length >= 50);
  assert.equal(new Set(pairs.map((p) => p.join("/"))).size, pairs.length);
  for (const pair of pairs) assert(pair.length === 2 && pair[0] !== pair[1]);
  for (const [id, field, min] of [
    ["backronyms", "categories", 40],
    ["whisper", "questions", 50],
    ["moonlit-village", "nightScenes", 40],
  ]) {
    const list = content(id)[field];
    assert(list.length >= min);
    assert.equal(new Set(list).size, list.length);
  }
});
test("Whisper: End game keeps a pick already earned and cancels future points", () => {
  const h = start("whisper", 4, { rounds: 2 });
  h.act(h.s.whisperer, { pick: "p2" });
  const scores = { ...h.s.scores },
    awards = { ...h.ctx.awards },
    callbacks = h.ctx.timers.map((t) => t.fn);
  h.game.onEnd(h.s);
  for (const fn of callbacks) fn();
  assert.equal(h.s.phase, "done");
  assert.deepEqual(h.s.scores, scores);
  assert.deepEqual(h.ctx.awards, awards);
  assert.equal(scores[h.s.whisperer], 100);
});
console.log("NEW_GAMES_B2_PASS: " + checks + " rule cases");
