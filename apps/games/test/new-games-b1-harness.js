"use strict";
// Shared only by local tests. Production games use the normal room context.
const fs = require("node:fs");
const path = require("node:path");
const IDS = ["dial-in", "ballpark", "think-alike", "who-wrote", "know-me"];
class Ctx {
  constructor(n = 4, settings = { rounds: 2 }) {
    this.roster = Array.from({ length: n }, (_, i) => ({
      id: "p" + (i + 1),
      name: ["Asha", "Bo", "Charlie", "Dev"][i] || "Friend " + (i + 1),
    }));
    this.gone = new Set();
    this.time = 1000;
    this.timers = [];
    this.awards = {};
    this.config = settings;
    this.host = "p1";
  }
  allPlayers() {
    return this.roster.slice();
  }
  players() {
    return this.roster.filter((p) => !this.gone.has(p.id));
  }
  settings() {
    return this.config;
  }
  hostId() {
    return this.host;
  }
  content(id) {
    return JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../locales/en", id + ".json"),
        "utf8",
      ),
    );
  }
  now() {
    return this.time;
  }
  broadcast() {}
  lobby() {}
  later(ms, fn) {
    const t = { at: this.time + ms, fn, dead: false };
    this.timers.push(t);
    return () => {
      t.dead = true;
    };
  }
  award(pid, n) {
    this.awards[pid] = (this.awards[pid] || 0) + n;
  }
  fire() {
    const t = this.timers.filter((t) => !t.dead).sort((a, b) => a.at - b.at)[0];
    if (!t) return false;
    t.dead = true;
    this.time = Math.max(this.time, t.at);
    t.fn();
    return true;
  }
  leave(def, s, pid) {
    this.gone.add(pid);
    def.onPlayerGone(s, this, pid);
  }
}
function legal(id, s, pid) {
  if (s.phase === "reveal")
    return pid === s.lead || pid === s.hostId ? { next: true } : null;
  if (id === "dial-in")
    return s.phase === "clue"
      ? pid === s.lead
        ? { clue: "A friendly kettle" }
        : null
      : pid !== s.lead
        ? { guess: 50 }
        : null;
  // PEEK: factual answer supplies a deterministic knowledgeable test player.
  if (id === "ballpark") return { answer: s.question.answer };
  if (id === "think-alike") return { answer: "The apples" };
  if (id === "who-wrote")
    return s.phase === "write"
      ? { answer: "A note from " + pid }
      : {
          matches: Object.fromEntries(
            s.notes
              .filter((n) => n.author !== pid)
              .map((n) => [n.id, n.author]),
          ),
        }; // PEEK: authors only in this test helper.
  if (id === "know-me") return { pick: 1 };
  return null;
}
function step(id, def, s, ctx) {
  const phase = s.phase,
    round = s.round;
  for (const p of ctx.players()) {
    if (s.phase !== phase || s.round !== round) break;
    const a =
      phase === "reveal"
        ? p.id === ctx.hostId()
          ? { next: true }
          : null
        : legal(id, s, p.id);
    if (a) def.onAction(s, ctx, p.id, a);
  }
}
function play(id, n, rounds = 2) {
  const def = require("../games/" + id + "/server"),
    ctx = new Ctx(n, { rounds }),
    s = def.create(ctx);
  let turns = 0;
  while (s.phase !== "done" && turns++ < 150) step(id, def, s, ctx);
  if (s.phase !== "done") throw new Error(id + " did not finish");
  return { def, ctx, s };
}
module.exports = { IDS, Ctx, legal, step, play };
