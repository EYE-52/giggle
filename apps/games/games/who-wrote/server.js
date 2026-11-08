"use strict";
const {
  dealer,
  shuffle,
  allIn,
  actionWindow,
  roundsSetting,
  paceSetting,
  paced,
} = require("../_sdk");
const id = "who-wrote";
const manifest = {
  name: "Who Wrote It",
  tagline: "A little note, a little mystery",
  howto:
    "Everyone writes an answer to a personal but safe prompt. Match each anonymous note to a writer, using each name once and skipping your own note. Score 100 times the share you get right, rounded. Writers earn 25 for each wrong guess about their note, up to 100 extra. Fewer than two notes skips the round.",
  guide: {
    goal: "Match the anonymous notes to their writers.",
    tips: [
      "Write a safe personal answer, then match the shuffled notes.",
      "Use each player name once. Your own note needs no guess.",
      "Correct matches earn up to 100; fooling readers adds up to 100.",
    ],
  },
  cat: "vote",
  players: {
    min: 3,
    max: 20,
  },
  renderer: "dom",
  art: "img/games/who-wrote.png",
};
manifest.settings = [roundsSetting({ def: 5 }), paceSetting()];
manifest.packs = {
  prompts: {
    label: "Custom prompts",
    type: "string[]",
    minItems: 5,
    maxItems: 200,
    maxLen: 140,
  },
};

function active(s, ctx) {
  return ctx
    .players()
    .filter((p) => s.roster.includes(p.id) && !s.gone.includes(p.id));
}
function known(s, ctx, pid) {
  return typeof pid === "string" && active(s, ctx).some((p) => p.id === pid);
}
function add(s, ctx, pts) {
  for (const [pid, n] of Object.entries(pts))
    if (n > 0 && s.roster.includes(pid) && !s.gone.includes(pid)) {
      s.scores[pid] = (s.scores[pid] || 0) + n;
      ctx.award(pid, n);
    }
}
// Both the timer and a late action close exactly the same input window.
function windowFor(s, ctx, phase, seconds, close) {
  s.phase = phase;
  const token = actionWindow(s),
    ms = paced(ctx, seconds) * 1000;
  s.endsAt = ctx.now() + ms;
  s.windowMs = ms;
  s.close = () => {
    if (actionWindow(s) !== token) return;
    s.close = null;
    close();
  };
  ctx.later(ms, () => {
    if (actionWindow(s) !== token || !s.close) return;
    s.close();
    ctx.broadcast();
  });
}
function expired(s, ctx) {
  if (s.close && ctx.now() >= s.endsAt) {
    s.close();
    return true;
  }
  return false;
}
function finish(s) {
  s.phase = "done";
  s.endsAt = 0;
  s.close = null;
}
function onEnd(s) {
  finish(s);
}
function showResult(s, ctx, last, seconds = 8) {
  s.last = last;
  add(s, ctx, last.pts || {});
  windowFor(s, ctx, "reveal", seconds, () => nextRound(s, ctx));
}
function base(ctx, pack, rounds) {
  return {
    phase: "",
    round: 0,
    rounds,
    roster: ctx.allPlayers().map((p) => p.id),
    gone: [],
    scores: {},
    last: null,
    endsAt: 0,
    windowMs: 0,
    hostId: ctx.hostId(),
    labels: pack.labels || {},
  };
}
function publicBase(s, pid, ctx) {
  return {
    phase: s.phase,
    round: Math.min(s.round, s.rounds),
    rounds: s.rounds,
    scores: { ...s.scores },
    gone: s.gone.slice(),
    endsAt: s.endsAt,
    windowMs: s.windowMs,
    hostId: ctx ? ctx.hostId() : s.hostId,
    labels: s.labels,
    last: s.last,
    watching: !s.roster.includes(pid) || s.gone.includes(pid),
  };
}
function text(value, max) {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value)
    ? value.trim()
    : null;
}
function onAction(s, ctx, pid, a) {
  if (
    !a ||
    typeof a !== "object" ||
    Array.isArray(a) ||
    !known(s, ctx, pid) ||
    s.phase === "done"
  )
    return;
  if (expired(s, ctx)) return;
  if (s.phase === "reveal") {
    if (a.next === true && (pid === ctx.hostId() || pid === s.lead))
      nextRound(s, ctx);
    return;
  }
  act(s, ctx, pid, a);
}
function onPlayerGone(s, ctx, pid) {
  if (!s.roster.includes(pid) || s.gone.includes(pid) || s.phase === "done")
    return;
  s.gone.push(pid);
  if (s.phase === "reveal") return;
  if (active(s, ctx).length < 2) {
    showResult(s, ctx, { pts: {}, skipped: true, reason: s.labels.tooFew });
    return;
  }
  gone(s, ctx, pid);
}

function create(ctx) {
  const pack = ctx.content(id) || {},
    s = base(ctx, pack, ctx.settings().rounds ?? 5);
  s.deal = dealer(pack.prompts?.length ? pack.prompts : [""]);
  nextRound(s, ctx);
  return s;
}
function nextRound(s, ctx) {
  if (s.round >= s.rounds || active(s, ctx).length < 2) return finish(s);
  s.round++;
  s.last = null;
  s.answers = {};
  s.matches = {};
  s.notes = [];
  s.prompt = s.deal();
  s.revealIndex = 0;
  windowFor(s, ctx, "write", 60, () => match(s, ctx));
}
function match(s, ctx) {
  if (s.phase !== "write") return;
  // IDs are assigned AFTER shuffling and never encode author/roster order.
  s.notes = shuffle(
    active(s, ctx)
      .filter((p) => s.answers[p.id])
      .map((p) => ({ author: p.id, text: s.answers[p.id] })),
  ).map((n, i) => ({ ...n, id: "note-" + i }));
  if (s.notes.length < 2)
    return showResult(s, ctx, {
      pts: {},
      skipped: true,
      reason: s.labels.tooFewNotes,
    });
  windowFor(
    s,
    ctx,
    "match",
    Math.min(90, 45 + Math.max(0, active(s, ctx).length - 4) * 5),
    () => reveal(s, ctx),
  );
}
function toGuess(s, pid) {
  return s.notes.filter((n) => n.author !== pid);
}
function reveal(s, ctx) {
  if (s.phase !== "match") return;
  const pts = {},
    live = active(s, ctx);
  for (const p of live) {
    const notes = toGuess(s, p.id),
      ballot = s.matches[p.id] || {};
    pts[p.id] = notes.length
      ? Math.round(
          (100 * notes.filter((n) => ballot[n.id] === n.author).length) /
            notes.length,
        )
      : 0;
  }
  for (const n of s.notes) {
    // Only submitted wrong guesses earn the author bonus, bounded by the +100 cap.
    const wrong = live.filter(
      (p) =>
        p.id !== n.author &&
        Object.hasOwn(s.matches, p.id) &&
        s.matches[p.id][n.id] !== n.author,
    ).length;
    pts[n.author] = (pts[n.author] || 0) + Math.min(100, 25 * wrong);
  }
  showResult(
    s,
    ctx,
    {
      pts,
      notes: s.notes.map((n) => ({ ...n })),
      matches: JSON.parse(JSON.stringify(s.matches)),
    },
    Math.max(8, s.notes.length + 3),
  );
  // Publish the authors in order. The host can still press Next at once.
  const token = actionWindow(s),
    count = s.notes.length;
  for (let i = 1; i <= count; i++)
    ctx.later((i * paced(ctx, 8) * 1000) / 8, () => {
      if (actionWindow(s) !== token) return;
      s.revealIndex = i;
      ctx.broadcast();
    });
}
function act(s, ctx, pid, a) {
  if (s.phase === "write" && !Object.hasOwn(s.answers, pid)) {
    const answer = text(a.answer, 160);
    if (!answer) return;
    s.answers[pid] = answer;
    if (allIn(active(s, ctx), s.answers)) match(s, ctx);
  } else if (s.phase === "match" && !Object.hasOwn(s.matches, pid)) {
    const ballot = a.matches,
      notes = toGuess(s, pid);
    if (
      !ballot ||
      typeof ballot !== "object" ||
      Array.isArray(ballot) ||
      Object.keys(ballot).length !== notes.length
    )
      return;
    const authors = notes.map((n) => n.author),
      chosen = notes.map((n) => ballot[n.id]);
    if (
      chosen.some(
        (author) => typeof author !== "string" || !authors.includes(author),
      ) ||
      new Set(chosen).size !== notes.length
    )
      return;
    s.matches[pid] = Object.fromEntries(notes.map((n) => [n.id, ballot[n.id]]));
    if (allIn(active(s, ctx), s.matches)) reveal(s, ctx);
  }
}
function gone(s, ctx, pid) {
  if (s.phase === "write") {
    delete s.answers[pid];
    if (allIn(active(s, ctx), s.answers)) match(s, ctx);
  } else if (s.phase === "match" && allIn(active(s, ctx), s.matches))
    reveal(s, ctx);
}
function view(s, pid, ctx) {
  const v = publicBase(s, pid, ctx),
    own = !v.watching;
  const last = s.last ? { ...s.last } : null;
  if (last?.notes)
    last.notes = last.notes.map((n, i) => ({
      id: n.id,
      text: n.text,
      author: i < s.revealIndex ? n.author : null,
    }));
  // Match grids would reveal authors before their reveal slot. Keep them private.
  if (last) delete last.matches;
  return Object.assign(v, {
    last,
    prompt: s.prompt,
    acted: Object.keys(s.phase === "write" ? s.answers : s.matches),
    myAnswer: own ? (s.answers[pid] ?? null) : null,
    myMatches: own ? (s.matches[pid] ?? null) : null,
    notes:
      s.phase === "match"
        ? s.notes.map((n) => ({
            id: n.id,
            text: n.text,
            mine: own && n.author === pid,
          }))
        : [],
    authors:
      s.phase === "match"
        ? s.notes
            .map((n) => n.author)
            .filter((author) => !own || author !== pid)
            .sort()
        : [],
    revealIndex: s.revealIndex,
  });
}

module.exports = {
  id,
  minPlayers: 3,
  maxPlayers: 20,
  manifest,
  create,
  onAction,
  onEnd,
  onPlayerGone,
  view,
};
