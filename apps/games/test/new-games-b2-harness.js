"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const IDS = [
  "odd-one-out",
  "moonlit-village",
  "undercover",
  "backronyms",
  "whisper",
];
const roster = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: "p" + (i + 1),
    name:
      ["Asha", "Bo", "Charlie", "Dev", "Eli", "Faye", "Gus", "Hana"][i] ||
      "Guest " + (i + 1),
  }));
class Clock {
  constructor(id, n, settings = {}) {
    this.id = id;
    this.roster = roster(n);
    this.connected = [...this.roster];
    this.options = settings;
    this.time = 1700000000000;
    this.timers = [];
    this.awards = {};
  }
  players() {
    return this.connected;
  }
  allPlayers() {
    return this.roster;
  }
  settings() {
    return this.options;
  }
  content(id) {
    return JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../locales/en", id + ".json"),
        "utf8",
      ),
    );
  }
  hostId() {
    return this.connected[0]?.id || this.roster[0].id;
  }
  now() {
    return this.time;
  }
  later(ms, fn) {
    const timer = { at: this.time + ms, fn, dead: false };
    this.timers.push(timer);
    return () => {
      timer.dead = true;
    };
  }
  award(pid, pts) {
    this.awards[pid] = (this.awards[pid] || 0) + pts;
  }
  broadcast() {}
  lobby() {}
  fire() {
    const timer = this.timers
      .filter((t) => !t.dead)
      .sort((a, b) => a.at - b.at)[0];
    assert(timer, this.id + " has no pending deadline");
    timer.dead = true;
    this.time = Math.max(this.time, timer.at);
    timer.fn();
  }
}
function start(
  id,
  n = id === "moonlit-village" ? 5 : 4,
  settings = { rounds: 1 },
) {
  const game = require("../games/" + id + "/server"),
    ctx = new Clock(id, n, settings),
    s = game.create(ctx);
  return {
    game,
    ctx,
    s,
    act: (pid, a) => game.onAction(s, ctx, pid, a),
    v: (pid) => game.view(s, pid, ctx),
  };
}
function phrase(letters, seat = 0) {
  const endings = [
    "pple",
    "anana",
    "arrot",
    "onut",
    "gg",
    "ig",
    "rape",
    "oney",
  ];
  return letters.map((l) => l + endings[seat % endings.length]).join(" ");
}
/* All decisions use a legitimate seat's projection. Hidden team membership is
 * discovered by comparing those seat views, just as a practice user can. */
function play(
  id,
  n = id === "moonlit-village" ? 5 : 4,
  rounds = 1,
  environment = null,
) {
  const h = environment || start(id, n, { rounds }),
    { game, s, ctx, act, v } = h;
  let steps = 0,
    actions = 0;
  while (s.phase !== "done" && steps++ < 400) {
    const views = ctx.roster.map((p) => ({ pid: p.id, ...v(p.id) }));
    if (s.phase === "reveal") act(ctx.hostId(), { next: true });
    else if (id === "odd-one-out") {
      const outsider = views.find((x) => x.card?.outsider);
      if (s.phase === "talk") {
        act(s.asker, { ask: ctx.roster.find((p) => p.id !== s.asker).id });
        actions++;
        act(ctx.hostId(), { endTalk: true });
      } else if (s.phase === "vote")
        for (const x of views) {
          act(x.pid, {
            vote:
              x.pid === outsider.pid
                ? views.find((y) => y.pid !== x.pid).pid
                : outsider.pid,
          });
          actions++;
        }
      else if (s.phase === "lastChance") {
        const place = views.find((x) => x.card?.place).card.place;
        act(outsider.pid, { place: outsider.places.indexOf(place) });
        actions++;
      }
    } else if (id === "moonlit-village") {
      const wolf = views.find(
        (x) => x.role === "wolf" && x.alive.includes(x.pid),
      );
      if (s.phase === "night") {
        for (const x of views.filter((x) => x.alive.includes(x.pid))) {
          const target =
            x.role === "wolf"
              ? views.find(
                  (y) => y.role === "villager" && y.alive.includes(y.pid),
                )?.pid ||
                views.find((y) => y.role !== "wolf" && y.alive.includes(y.pid))
                  .pid
              : wolf.pid;
          act(x.pid, { target });
          actions++;
        }
        ctx.fire();
      } else if (s.phase === "day")
        for (const x of views.filter((x) => x.alive.includes(x.pid))) {
          act(x.pid, { ready: true });
          actions++;
        }
      else if (s.phase === "vote")
        for (const x of views.filter((x) => x.alive.includes(x.pid))) {
          act(x.pid, {
            vote:
              x.pid === wolf.pid
                ? views.find(
                    (y) => y.role !== "wolf" && y.alive.includes(y.pid),
                  ).pid
                : wolf.pid,
          });
          actions++;
        }
    } else if (id === "undercover") {
      if (s.phase === "clue") {
        act(s.turnPid, {
          clue: "clue" + String.fromCharCode(97 + (steps % 26)),
        });
        actions++;
      } else {
        const counts = {};
        for (const x of views) counts[x.word] = (counts[x.word] || 0) + 1;
        const rare = Object.keys(counts).sort(
          (a, b) => counts[a] - counts[b],
        )[0];
        const target = views.find(
          (x) => x.word === rare && x.alive.includes(x.pid),
        );
        for (const x of views.filter((x) => x.alive.includes(x.pid))) {
          act(x.pid, {
            vote:
              x.pid === target.pid
                ? views.find((y) => y.word !== rare && y.alive.includes(y.pid))
                    .pid
                : target.pid,
          });
          actions++;
        }
      }
    } else if (id === "backronyms") {
      if (s.phase === "write")
        for (const [i, x] of views.entries()) {
          act(x.pid, { phrase: phrase(x.letters, i) });
          actions++;
        }
      else
        for (const x of views) {
          act(x.pid, { vote: x.entries.find((e) => !e.mine).id });
          actions++;
        }
    } else if (id === "whisper") {
      if (s.phase === "pick") {
        act(s.whisperer, { pick: ctx.roster[1].id });
        actions++;
      } else if (s.phase === "guess")
        for (const x of views.filter((x) => x.pid !== s.whisperer)) {
          act(x.pid, { guess: "heads" });
          actions++;
        }
      else ctx.fire();
    }
  }
  assert.equal(s.phase, "done", id + " completes");
  assert(actions > 0, id + " accepted player actions");
  assert.deepEqual(
    s.scores,
    Object.fromEntries(s.ids.map((pid) => [pid, ctx.awards[pid] || 0])),
    id + " room and game scores agree",
  );
  assert(
    Object.values(s.scores).some((n) => n > 0),
    id + " earned points",
  );
  return h;
}
module.exports = { IDS, Clock, roster, start, phrase, play };
