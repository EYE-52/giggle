'use strict';
/* Number Hunt: the server hides a number from 1 to 100 and everyone races
 * to find it. Every guess earns a public hotter/colder hint plus a
 * higher/lower nudge. The first finder wins and starts a short overtime.
 * Finders can still submit other numbers while everyone else plays. When
 * the hunt clock runs out without a correct guess, there is no winner. */

const { roundsSetting, paceSetting, paced } = require('../_sdk');

const id = 'number-hunt';

const manifest = {
  sameRoom: false,
  players: { min: 2, max: 20 },
  guide: {
    goal: 'Find the hidden number from 1 to 100 before everyone else.',
    tips: [
      'Each guess tells you to go higher or lower.',
      'From your second guess on, you also hear warmer or colder.',
      'Wrong guesses get public hints. Correct guesses stay private until the reveal.',
      'The first solve starts overtime. You can keep guessing after you find it.',
      'First to find it ranks first: 100, 70, 50, 30, then 20 points.',
    ],
  },
  settings: [
    roundsSetting({ def: 5 }),
    paceSetting(),
    { key: 'huntSeconds', label: 'Seconds to hunt', type: 'int', min: 20, max: 600, def: 60 },
  ],
};
const ROUNDS = 5;
const HUNT_SECONDS = 60;
const OVERTIME_SECONDS = 10;
const GAP_SECONDS = 4;
const RANK_PTS = [100, 70, 50, 30, 20];

function pick(arr, fb) {
  if (!arr || !arr.length) return fb;
  return arr[Math.floor(Math.random() * arr.length)];
}

function create(ctx) {
  const pack = ctx.content(id);
  const ps = ctx.allPlayers();
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? ROUNDS,
    huntMs: (s.huntSeconds ?? HUNT_SECONDS) * 1000,
    overtimeMs: paced(s, OVERTIME_SECONDS) * 1000,
    gapMs: paced(s, GAP_SECONDS) * 1000,
    phase: 'hunt', // hunt -> overtime -> roundEnd -> done
    secret: 0,
    guesses: {},
    history: [],
    finished: [],
    scores: {},
    wins: {},
    last: null,
    endsAt: 0,
    hostId: ctx.hostId ? ctx.hostId() : (ps.length ? ps[0].id : null),
  };
  state.hints = pack.hints || {};
  state.strings = pack.strings || {};
  nextRound(state, ctx);
  return state;
}

function nextRound(state, ctx) {
  if (state.round >= state.rounds) {
    state.phase = 'done';
    state.endsAt = 0;
    return;
  }
  state.round += 1;
  state.secret = 1 + Math.floor(Math.random() * 100);
  state.guesses = {};
  state.history = [];
  state.finished = [];
  state.phase = 'hunt';
  state.endsAt = ctx.now() + state.huntMs;
  const round = state.round;
  ctx.later(state.huntMs, () => {
    if (state.round !== round || state.phase !== 'hunt') return;
    endRound(state, ctx);
    ctx.broadcast();
  });
}

function endRound(state, ctx) {
  if (state.phase !== 'hunt' && state.phase !== 'overtime') return;
  state.phase = 'roundEnd';
  // Finding it first decides the rank (state.finished is in arrival order), so
  // nobody can wait, copy the found number and win on tries.
  const ranked = [...state.finished];
  ranked.forEach((f, rank) => {
    f.rank = rank + 1;
    const pts = RANK_PTS[Math.min(rank, RANK_PTS.length - 1)];
    f.pts = pts;
    state.scores[f.pid] = (state.scores[f.pid] || 0) + pts;
    ctx.award(f.pid, pts);
  });
  if (ranked.length) {
    for (const f of ranked.slice(0, 1)) {
      state.wins[f.pid] = (state.wins[f.pid] || 0) + 1;
    }
  }
  state.last = {
    secret: state.secret,
    finished: ranked,
    history: [...state.history],
  };
  state.endsAt = ctx.now() + state.gapMs;
  const round = state.round;
  ctx.later(state.gapMs, () => {
    if (state.round !== round || state.phase !== 'roundEnd') return;
    nextRound(state, ctx);
    ctx.broadcast();
  });
}

function everyoneFound(state, ctx) {
  const ps = ctx.players();
  return ps.length > 0 && ps.every((p) => state.finished.some((f) => f.pid === p.id));
}

function onAction(state, ctx, pid, a) {
  if (!ctx.allPlayers().some(p => p.id === pid)) return;
  if (!a || typeof a !== 'object') return;
  if (state.phase === 'roundEnd') {
    if (a.next === true && pid === ctx.hostId()) nextRound(state, ctx);
    return;
  }
  if (state.phase !== 'hunt' && state.phase !== 'overtime') return;
  if (state.endsAt > 0 && ctx.now() >= state.endsAt) { endRound(state, ctx); return; }
  const g = a.guess;
  if (!Number.isInteger(g) || g < 1 || g > 100) return;
  // Only the first hit counts. Later wrong guesses stay in the public feed.
  if (g === state.secret && state.finished.some(f => f.pid === pid)) return;
  const mine = state.guesses[pid] || [];
  // Compare against the last public guess. A private hit must not change
  // the warmer/colder clue that everyone else can see.
  const previous = mine.at(-1) === state.secret ? mine.at(-2) : mine.at(-1);
  mine.push(g);
  state.guesses[pid] = mine;
  const h = state.hints;
  if (g === state.secret) {
    state.history.push({ pid, guess: g, result: 'correct', flavor: pick(h.correct, 'Bullseye!') });
    state.finished.push({ pid, tries: mine.length });
    if (state.history.length > 200) state.history.splice(0, state.history.length - 200);
    if (everyoneFound(state, ctx)) {
      endRound(state, ctx);
    } else if (state.phase === 'hunt') {
      state.phase = 'overtime';
      state.endsAt = ctx.now() + state.overtimeMs;
      const round = state.round;
      ctx.later(state.overtimeMs, () => {
        if (state.round !== round || state.phase !== 'overtime') return;
        endRound(state, ctx);
        ctx.broadcast();
      });
    }
    return;
  }
  const d = Math.abs(state.secret - g);
  let result;
  if (previous === undefined) {
    result = 'first';
  } else {
    const prev = Math.abs(state.secret - previous);
    result = d < prev ? 'hotter' : d > prev ? 'colder' : 'same';
  }
  const dir = g < state.secret ? 'higher' : 'lower';
  const flavor = pick(h[result], result) + ' — ' + pick(h[dir], dir);
  state.history.push({ pid, guess: g, result, dir, flavor });
  if (state.history.length > 200) state.history.splice(0, state.history.length - 200);
}

/* A player who left (or stayed away) is no longer waited for in overtime. */
function onPlayerGone(state, ctx) {
  if (state.phase === 'overtime' && everyoneFound(state, ctx)) endRound(state, ctx);
}

/* End game: points already given stay; show the final scores. */
function onEnd(state) {
  state.phase = 'done';
  state.endsAt = 0;
}

function view(state, pid, ctx) {
  const { secret, hints, ...rest } = state;
  void secret;
  void hints;
  if (state.phase === 'hunt' || state.phase === 'overtime') {
    rest.foundCount = state.finished.length;
    rest.finished = state.finished.filter(f => f.pid === pid);
    rest.history = state.history.filter(h => h.result !== 'correct' || h.pid === pid);
    rest.guesses = Object.fromEntries(Object.entries(state.guesses).map(([player, guesses]) =>
      [player, player === pid ? guesses : guesses.filter(g => g !== secret)]
    ).filter(([, guesses]) => guesses.length));
  }
  return { ...rest, hostId: ctx && ctx.hostId ? ctx.hostId() : state.hostId };
}

module.exports = { id, minPlayers: 2, maxPlayers: 20, realtime: true, manifest, create, onAction, onPlayerGone, onEnd, view };
