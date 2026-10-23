'use strict';
/* Number Hunt: the server hides a number from 1 to 100 and everyone races
 * to find it. Every guess earns a public hotter/colder hint plus a
 * higher/lower nudge. First to hit it starts a short overtime; fewest
 * tries wins the round. The hunt itself has a clock too: when it runs out
 * with nobody on the number, the round ends without a winner. */

const { roundsSetting, paceSetting, paced } = require('../_sdk');

const id = 'number-hunt';

const manifest = {
  players: { min: 2, max: 20 },
  settings: [
    roundsSetting({ def: 5 }),
    paceSetting(),
    { key: 'huntSeconds', label: 'Seconds to hunt', type: 'int', min: 20, max: 180, def: 60 },
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
  const ranked = [...state.finished].sort((a, b) => a.tries - b.tries);
  ranked.forEach((f) => {
    // Fewest tries decides the rank; arrival order cannot break an equal score.
    const rank = ranked.findIndex(other => other.tries === f.tries);
    f.rank = rank + 1;
    const pts = RANK_PTS[Math.min(rank, RANK_PTS.length - 1)];
    f.pts = pts;
    state.scores[f.pid] = (state.scores[f.pid] || 0) + pts;
    ctx.award(f.pid, pts);
  });
  if (ranked.length) {
    for (const f of ranked.filter(f => f.tries === ranked[0].tries)) {
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
  if (state.finished.some((f) => f.pid === pid)) return;
  const mine = state.guesses[pid] || [];
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
  if (mine.length < 2) {
    result = 'first';
  } else {
    const prev = Math.abs(state.secret - mine[mine.length - 2]);
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
  return { ...rest, hostId: ctx && ctx.hostId ? ctx.hostId() : state.hostId };
}

module.exports = { id, minPlayers: 2, maxPlayers: 20, realtime: true, manifest, create, onAction, onPlayerGone, onEnd, view };
