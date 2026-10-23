'use strict';
/* Typing Race: everyone types the same sentence at once. Live progress bars
 * show each racer's correct characters; finish order decides the points:
 * finishing earns 100 plus a place bonus (100, 75, 50, 25), an unfinished
 * race up to 50 for the part typed (rules standard). */

const { dealer, roundsSetting, paceSetting, paced } = require('../_sdk');

const id = 'typing-race';

const manifest = {
  players: { min: 2, max: 20 },
  howto: 'Type the sentence perfectly. Finishing earns 100 points and the fastest finishers earn up to 100 more; an unfinished sentence earns up to 50.',
  settings: [
    roundsSetting({ def: 4 }),
    paceSetting(),
    { key: 'raceSeconds', label: 'Seconds per race', type: 'int', min: 15, max: 120, def: 45 },
  ],
  packs: {
    sentences: { label: 'Custom sentences', type: 'string[]', minItems: 4 },
  },
};
const ROUNDS = 4;
const GAP_SECONDS = 4;
const FINISH_PTS = 100;
const PLACE_PTS = [100, 75, 50, 25];
const PARTIAL_MAX = 50;

function finishPoints(place) {
  return FINISH_PTS + (PLACE_PTS[place] || 0);
}

function create(ctx) {
  const pack = ctx.content(id);
  const sentences = pack.sentences && pack.sentences.length
    ? pack.sentences
    : ['The quick brown fox jumps over the lazy dog.'];
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? ROUNDS,
    raceMs: (s.raceSeconds ?? 45) * 1000,
    gapMs: paced(s, GAP_SECONDS) * 1000,
    phase: 'race', // race -> roundEnd -> done
    target: '',
    progress: {},
    finished: [],
    scores: {},
    last: null,
    startAt: 0,
    endsAt: 0,
  };
  state.deal = dealer(sentences);
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
  state.target = state.deal();
  state.progress = {};
  state.finished = [];
  state.phase = 'race';
  state.startAt = ctx.now();
  state.endsAt = ctx.now() + state.raceMs;
  const round = state.round;
  ctx.later(state.raceMs, () => {
    if (state.round !== round || state.phase !== 'race') return;
    endRound(state, ctx);
    ctx.broadcast();
  });
}

function correctPrefix(target, typed) {
  let n = 0;
  const lim = Math.min(target.length, typed.length);
  while (n < lim && typed[n] === target[n]) n += 1;
  return n;
}

function endRound(state, ctx) {
  if (state.phase !== 'race') return;
  state.phase = 'roundEnd';
  const done = new Set(state.finished.map((f) => f.pid));
  for (const p of ctx.allPlayers()) {
    if (done.has(p.id)) continue;
    const got = state.progress[p.id] || 0;
    const pts = Math.round((got / Math.max(1, state.target.length)) * PARTIAL_MAX);
    if (pts > 0) {
      state.scores[p.id] = (state.scores[p.id] || 0) + pts;
      ctx.award(p.id, pts);
    }
  }
  state.last = {
    target: state.target,
    finished: state.finished.map((f) => ({ ...f })),
    progress: { ...state.progress },
  };
  state.endsAt = ctx.now() + state.gapMs;
  const round = state.round;
  ctx.later(state.gapMs, () => {
    if (state.round !== round || state.phase !== 'roundEnd') return;
    nextRound(state, ctx);
    ctx.broadcast();
  });
}

function onAction(state, ctx, pid, a) {
  if (!ctx.allPlayers().some(p => p.id === pid)) return;
  if (state.phase === 'roundEnd' && a && a.next === true && pid === ctx.hostId()) { nextRound(state, ctx); return; }
  if (state.phase !== 'race' || !a || typeof a.typed !== 'string') return;
  if (ctx.now() >= state.endsAt) { endRound(state, ctx); return; }
  if (state.finished.some((f) => f.pid === pid)) return;
  const typed = a.typed.slice(0, state.target.length + 20);
  state.progress[pid] = correctPrefix(state.target, typed);
  if (typed === state.target) {
    const ms = ctx.now() - state.startAt;
    // Finishing at the same moment shares the place and its points.
    const tie = state.finished.find((f) => f.ms === ms);
    const place = tie ? tie.place : state.finished.length;
    const pts = finishPoints(place);
    state.finished.push({ pid, ms, pts, place });
    state.scores[pid] = (state.scores[pid] || 0) + pts;
    ctx.award(pid, pts);
    if (allFinished(state, ctx)) endRound(state, ctx);
  }
}

function allFinished(state, ctx) {
  const ps = ctx.players();
  return ps.length > 0 && ps.every((p) => state.finished.some((f) => f.pid === p.id));
}

/* A player who left (or stayed away) is no longer waited for. */
function onPlayerGone(state, ctx) {
  if (state.phase === 'race' && allFinished(state, ctx)) endRound(state, ctx);
}

/* End game: points already given stay; show the final scores. */
function onEnd(state) {
  state.phase = 'done';
  state.endsAt = 0;
}

function view(state, pid, ctx) {
  const { deal, ...rest } = state;
  return { ...rest, hostId: ctx && ctx.hostId ? ctx.hostId() : null };
}

module.exports = { id, minPlayers: 2, maxPlayers: 20, realtime: true, manifest, create, onAction, onPlayerGone, onEnd, view, finishPoints };
