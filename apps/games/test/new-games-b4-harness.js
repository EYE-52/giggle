"use strict";
const IDS = [
  "math-dash",
  "emoji-spotter",
  "echo-pads",
  "color-clash",
  "hot-potato",
];
// Reused by the registry and real Room sweeps. Definitions/context come from
// the caller so the real Room adapter still routes EVERY action through Room.
function play(id, { def, ctx, act, view }) {
  const s = def.create(ctx),
    pids = ctx.players().map((p) => p.id);
  let steps = 0;
  while (s.phase !== "done" && steps++ < 1200) {
    if (s.phase === "reveal") {
      act(def, s, ctx, ctx.hostId(), { next: true });
      continue;
    }
    if (id === "math-dash") {
      for (const pid of pids) {
        // PEEK: simulate a player solving their current arithmetic problem.
        const answer = def.problem(s, s.correct[pid]).answer;
        act(def, s, ctx, pid, { answer, index: s.correct[pid] });
      }
      ctx.fireNext();
    } else if (id === "emoji-spotter") {
      for (const pid of pids)
        if (s.phase === "spot") {
          const v = view(def, s, pid),
            counts = {};
          for (const emoji of v.grid) counts[emoji] = (counts[emoji] || 0) + 1;
          const tap = v.grid.findIndex((e) => counts[e] === 1);
          act(def, s, ctx, pid, { tap, round: s.round });
        }
    } else if (id === "echo-pads") {
      if (s.phase === "show") {
        ctx.fireNext();
        continue;
      }
      for (const pid of [...s.alive]) {
        if (s.phase !== "repeat") break;
        const level = s.level;
        // PEEK: a perfect memory player recalls the sequence shown earlier.
        for (const pad of [...s.sequence]) {
          if (s.phase !== "repeat" || s.level !== level) break;
          act(def, s, ctx, pid, { pad, level, step: s.cursor[pid] });
        }
      }
    } else if (id === "color-clash") {
      for (const pid of pids) {
        const v = view(def, s, pid);
        act(def, s, ctx, pid, { pick: v.card[v.card.mode], card: v.index });
      }
      ctx.fireNext();
    } else {
      const v = view(def, s, s.holder);
      act(def, s, ctx, s.holder, {
        answer: "Kitchen item " + steps,
        pass: v.passNo,
      });
      ctx.fireNext();
    }
  }
  if (s.phase !== "done") throw Error(id + " did not finish");
  return s;
}
module.exports = { IDS, play };
