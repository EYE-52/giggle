'use strict';
/* Scattergories: each round deals a letter + 5 categories, 60s on the clock.
 * An answer scores 40 only if it starts with the letter and no one else in
 * the room wrote the same thing for that category (all five: 200, the
 * rules standard's round maximum). */

const { dealer, shuffle, allIn, roundsSetting, paceSetting, paced } = require('../_sdk');

const id = 'scattergories';

const manifest = {
  players: { min: 2, max: 20 },
  howto: 'Fill every category with a word that starts with the round letter before time runs out. Each answer nobody else wrote earns 40 points (all five: 200).',
  settings: [
    roundsSetting({ def: 3 }),
    paceSetting(),
    { key: 'writeSeconds', label: 'Seconds to write', type: 'int', min: 30, max: 180, def: 60 },
  ],
  packs: {
    categories: { label: 'Custom categories', type: 'string[]', minItems: 5, maxLen: 40 },
    letters: { label: 'Custom letters', type: 'string[]', minItems: 5, maxLen: 2, maxItems: 26 },
  },
};
const ROUNDS = 3;
const REVEAL_SECONDS = 10;
const CATS_PER_ROUND = 5;
const UNIQUE_PTS = 40;

function create(ctx) {
  const pack = ctx.content(id);
  const ps = ctx.allPlayers();
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? ROUNDS,
    writeMs: (s.writeSeconds ?? 60) * 1000,
    revealMs: paced(s, REVEAL_SECONDS) * 1000,
    scores: {},
    phase: 'write', // write -> reveal -> done
    letter: null,
    categories: [],
    answers: {},
    locked: {},
    last: null,
    endsAt: 0,
    hostId: ctx.hostId ? ctx.hostId() : (ps.length ? ps[0].id : null),
  };
  const letters = pack.letters && pack.letters.length ? pack.letters : ['S'];
  const cats = pack.categories && pack.categories.length
    ? pack.categories : ['Animals', 'Foods', 'Places', 'Movies', 'Songs'];
  state.letterDeal = dealer(letters);
  state.cats = cats;
  nextRound(state, ctx);
  return state;
}

function nextRound(state, ctx) {
  state.round += 1;
  if (state.round > state.rounds) {
    state.round = state.rounds;
    state.phase = 'done';
    state.endsAt = 0;
    return;
  }
  state.phase = 'write';
  state.letter = state.letterDeal();
  state.categories = shuffle(state.cats).slice(0, CATS_PER_ROUND);
  state.answers = {};
  state.locked = {};
  state.last = null;
  state.endsAt = ctx.now() + state.writeMs;
  const round = state.round;
  ctx.later(state.writeMs, () => {
    if (state.round !== round || state.phase !== 'write') return;
    reveal(state, ctx);
    ctx.broadcast();
  });
}

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

function reveal(state, ctx) {
  if (state.phase !== 'write') return;
  state.phase = 'reveal';
  state.endsAt = ctx.now() + state.revealMs;
  const letter = String(state.letter).toLowerCase();
  // Count normalized answers per category.
  const counts = state.categories.map(() => ({}));
  for (const pid of Object.keys(state.answers)) {
    const arr = state.answers[pid];
    arr.forEach((s, i) => {
      const n = norm(s);
      if (!n) return;
      counts[i][n] = (counts[i][n] || 0) + 1;
    });
  }
  const unique = {};
  const points = {};
  for (const p of ctx.allPlayers()) {
    const arr = state.answers[p.id] || [];
    const flags = state.categories.map((_, i) => {
      const n = norm(arr[i]);
      return !!n && n[0] === letter && counts[i][n] === 1;
    });
    unique[p.id] = flags;
    const pts = flags.filter(Boolean).length * UNIQUE_PTS;
    points[p.id] = pts;
    state.scores[p.id] = (state.scores[p.id] || 0) + pts;
    if (pts) ctx.award(p.id, pts);
  }
  state.last = {
    letter: state.letter,
    categories: state.categories.slice(),
    answers: JSON.parse(JSON.stringify(state.answers)),
    unique,
    points,
  };
  const round = state.round;
  ctx.later(state.revealMs, () => {
    if (state.round !== round || state.phase !== 'reveal') return;
    nextRound(state, ctx);
    ctx.broadcast();
  });
}

function validAnswers(a) {
  return Array.isArray(a.answers) && a.answers.length === CATS_PER_ROUND &&
    a.answers.every((s) => typeof s === 'string' && s.length <= 40);
}

function onAction(state, ctx, pid, a) {
  if (!a || typeof a !== 'object' || Array.isArray(a) || !ctx.allPlayers().some(p => p.id === pid)) return;
  if (state.phase === 'write' && ctx.now() >= state.endsAt) { reveal(state, ctx); return; }
  if (state.phase === 'write') {
    if (validAnswers(a) && !state.locked[pid]) {
      state.answers[pid] = a.answers.map((s) => s.slice(0, 40));
    }
    if (a.lock && state.answers[pid]) {
      state.locked[pid] = true;
      if (allIn(ctx.players(), state.locked)) reveal(state, ctx);
    } else if (a.finish && pid === (ctx.hostId ? ctx.hostId() : state.hostId)) {
      reveal(state, ctx);
    }
  } else if (state.phase === 'reveal' && a.next && pid === (ctx.hostId ? ctx.hostId() : state.hostId)) {
    nextRound(state, ctx);
  }
}

/* A player who left (or stayed away) is no longer waited for. */
function onPlayerGone(state, ctx) {
  if (state.phase === 'write' && ctx.players().length && allIn(ctx.players(), state.locked)) reveal(state, ctx);
}

/* End game: points already given stay; show the final scores. */
function onEnd(state) {
  state.phase = 'done';
  state.endsAt = 0;
}

function view(state, pid, ctx) {
  const { letterDeal, cats, ...rest } = state;
  const out = { ...rest, hostId: ctx ? ctx.hostId() : state.hostId };
  if (state.phase === 'write') {
    out.answers = {};
    out.mine = state.answers[pid] || ['', '', '', '', ''];
    out.locked = Object.keys(state.locked);
    out.myLocked = !!state.locked[pid];
  }
  return out;
}

module.exports = { id, minPlayers: 2, maxPlayers: 20, manifest, create, onAction, onPlayerGone, onEnd, view };
