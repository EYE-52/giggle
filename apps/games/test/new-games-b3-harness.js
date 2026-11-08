"use strict";
const assert = require("node:assert/strict");
const IDS = [
  "clue-grid",
  "letter-lock",
  "word-grid",
  "banned-words",
  "read-my-lips",
];
const names = ["Asha", "Bo", "Charlie", "Dev", "Esha", "Farah"];
class Clock {
  constructor(n = 4, settings = { rounds: 2 }) {
    this.roster = names
      .slice(0, n)
      .map((name, i) => ({ id: "p" + (i + 1), name }));
    this.settingsValue = settings;
    this.time = 1700000000000;
    this.timers = [];
    this.awards = {};
    this.gone = [];
    this.host = "p1";
  }
  allPlayers() {
    return this.roster.slice();
  }
  players() {
    return this.roster.filter((p) => !this.gone.includes(p.id));
  }
  settings() {
    return this.settingsValue;
  }
  content() {
    return {};
  }
  now() {
    return this.time;
  }
  hostId() {
    return this.host;
  }
  broadcast() {}
  award(pid, n) {
    this.awards[pid] = (this.awards[pid] || 0) + n;
  }
  later(ms, fn) {
    const job = { at: this.time + ms, fn, cancelled: false };
    this.timers.push(job);
    return () => {
      job.cancelled = true;
    };
  }
  fire() {
    const job = this.timers
      .filter((j) => !j.cancelled)
      .sort((a, b) => a.at - b.at)[0];
    assert(job, "a live phase must have a timer");
    job.cancelled = true;
    this.time = Math.max(this.time, job.at);
    job.fn();
  }
  leave(def, s, pid) {
    this.gone.push(pid);
    def.onPlayerGone(s, this, pid, "left");
  }
}
function start(id, n = 4, settings) {
  const def = require("../games/" + id + "/server"),
    ctx = new Clock(n, settings);
  return { def, ctx, s: def.create(ctx) };
}
function act(h, pid, action) {
  h.def.onAction(h.s, h.ctx, pid, action);
}
function finishRound(h) {
  const round = h.s.round;
  let loops = 0;
  while (
    h.s.phase !== "reveal" &&
    h.s.phase !== "done" &&
    h.s.round === round &&
    loops++ < 40
  )
    h.ctx.fire();
  assert(loops < 40, "round must advance without input");
}
function play(id, n = 4, supplied = null) {
  const h = supplied ? { ...supplied, s: supplied.def.create(supplied.ctx) } : start(id, n, { rounds: 2 });
  let moves = 0,
    loops = 0;
  while (h.s.phase !== "done" && loops++ < 100) {
    const s = h.s;
    if (s.phase === "reveal") {
      act(h, h.ctx.hostId(), { next: true });
      continue;
    }
    if (id === "clue-grid") {
      if (s.phase === "setup") act(h, h.ctx.hostId(), { start: true });
      const spy = h.def.view(s, s.lead, h.ctx);
      if (s.phase === "clue") act(h, s.lead, { clue: "discovery", number: 9 });
      const guesser = s.teams[s.team].find((p) => p !== s.lead);
      const targets = spy.cards
        .map((c, i) => (c.kind === s.team && !c.open ? i : -1))
        .filter((i) => i >= 0);
      for (const card of targets) {
        if (s.phase !== "guess") break;
        act(h, guesser, { card });
        moves++;
      }
    } else if (id === "letter-lock") {
      // PEEK: emulate a solver who knows the hidden answer.
      for (const p of h.ctx.players()) {
        act(h, p.id, { guess: s.answer });
        moves++;
      }
    } else if (id === "word-grid") {
      // PEEK: the offline solver supplies legal dictionary paths for test input.
      const words = Object.keys(s.solutions);
      h.ctx.players().forEach((p, i) => {
        act(h, p.id, { word: words[i], path: s.solutions[words[i]] });
        act(h, p.id, { done: true });
        moves++;
      });
    } else if (id === "banned-words") {
      const guesser = s.teams[s.team].find((p) => p !== s.lead);
      for (let i = 0; i < 5; i++) {
        const card = h.def.view(s, s.lead, h.ctx).card;
        act(h, guesser, { guess: card.target, cardNo: s.cardNo });
        moves++;
      }
      (h.ctx.fire || h.ctx.fireNext).call(h.ctx);
    } else {
      const phrase = h.def.view(s, s.lead, h.ctx).phrase;
      for (const p of h.ctx.players().filter((p) => p.id !== s.lead)) {
        act(h, p.id, { guess: phrase });
        moves++;
      }
    }
  }
  assert.equal(h.s.phase, "done", id + " full match");
  assert(
    moves > 0 && Object.values(h.ctx.awards).some((n) => n > 0),
    id + " must earn points",
  );
  assert.deepEqual(
    h.s.scores,
    Object.fromEntries(h.s.roster.map((pid) => [pid, h.ctx.awards[pid] || 0])),
  );
  return h;
}
module.exports = { IDS, Clock, start, act, finishRound, play };
