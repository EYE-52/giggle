'use strict';
/* Emoji Story: each round one player gets a secret phrase and retells it
 * using emoji only (no letters); everyone else races to guess the phrase.
 * A correct guess is worth 100, plus up to 100 for speed (the first solver
 * gets a small extra). The storyteller scores 50 per solver (at most 200). */

const { dealer, shuffle, roundsSetting, paceSetting, pacedMs } = require('../_sdk');

const id = 'emoji-story';

const manifest = {
  howto: 'Describe your secret phrase in emoji only. Others race to guess it: 100 for a correct guess plus up to 100 for speed. The storyteller earns 50 per solver.',
  players: { min: 3, max: 20 },
  settings: [
    roundsSetting({ def: null, autoLabel: 'Auto (one per player)' }),
    paceSetting(),
    { key: 'guessSeconds', label: 'Seconds to guess', type: 'int', min: 15, max: 180, def: 60 },
  ],
};
const EMOJI_S = 45;
const REVEAL_S = 8;
const SOLVE_POINTS = 100;
const SPEED_MAX = 75;
const FIRST_BONUS = 25;
const DIRECTOR_POINTS = 50;
const DIRECTOR_MAX = 200;

function create(ctx) {
  const pack = ctx.content(id);
  const phrases = pack.phrases && pack.phrases.length
    ? pack.phrases
    : [{ phrase: 'Pizza party', aliases: [] }];
  const players = ctx.allPlayers().map((p) => p.id);
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? Math.max(players.length, 1),
    autoRounds: s.rounds == null,
    emojiMs: pacedMs(s, EMOJI_S),
    guessMs: (s.guessSeconds ?? 60) * 1000,
    revealMs: pacedMs(s, REVEAL_S),
    phase: 'emoji', // emoji -> guess -> reveal -> done
    director: null,
    order: shuffle(players),
    ptr: -1,
    turnNo: 0,
    turns: [],
    gone: [],
    phrase: '',
    aliases: [],
    emoji: '',
    solved: {}, // pid -> {pts}
    last: null,
    scores: {},
    endsAt: 0,
  };
  state.deal = dealer(phrases);
  nextTurn(state, ctx);
  return state;
}

/* Next seat after the last storyteller, skipping players who left. */
function pickDirector(state, ctx) {
  for (const p of ctx.allPlayers()) if (!state.order.includes(p.id)) state.order.push(p.id);
  const n = state.order.length;
  for (let k = 1; k <= n; k++) {
    const i = (state.ptr + k) % n;
    if (!state.gone.includes(state.order[i])) {
      state.ptr = i;
      return state.order[i];
    }
  }
  return null;
}

function finish(state) {
  state.phase = 'done';
  state.endsAt = 0;
}

function nextTurn(state, ctx) {
  if (state.round >= state.rounds) return finish(state);
  const director = pickDirector(state, ctx);
  if (!director) return finish(state);
  state.round += 1;
  state.turnNo += 1;
  state.director = director;
  state.turns.push(director);
  const dealt = state.deal() || {};
  state.phrase = String(dealt.phrase || 'Pizza party').slice(0, 80);
  state.aliases = Array.isArray(dealt.aliases)
    ? dealt.aliases.map((s) => String(s).slice(0, 80))
    : [];
  state.emoji = '';
  state.solved = {};
  state.phase = 'emoji';
  state.endsAt = ctx.now() + state.emojiMs;
  const er = state.turnNo;
  ctx.later(state.emojiMs, () => {
    if (state.phase !== 'emoji' || state.turnNo !== er) return;
    skipStory(state, ctx);
    ctx.broadcast();
  });
}

function scheduleNext(state, ctx) {
  state.endsAt = 0; // the reveal shows no clock; Next or the paced timer moves on
  const rr = state.turnNo;
  ctx.later(state.revealMs, () => {
    if (state.phase !== 'reveal' || state.turnNo !== rr) return;
    nextTurn(state, ctx);
    ctx.broadcast();
  });
}

function skipStory(state, ctx) {
  if (state.phase !== 'emoji') return;
  state.phase = 'reveal';
  state.last = { skipped: true, phrase: state.phrase, emoji: '', director: state.director, solvers: [], points: {} };
  scheduleNext(state, ctx);
}

function startGuess(state, ctx) {
  if (state.phase !== 'emoji') return;
  state.phase = 'guess';
  state.endsAt = ctx.now() + state.guessMs;
  const gr = state.turnNo;
  ctx.later(state.guessMs, () => {
    if (state.phase !== 'guess' || state.turnNo !== gr) return;
    reveal(state, ctx);
    ctx.broadcast();
  });
}

function score(state, ctx, pid, pts) {
  if (!pts) return;
  state.scores[pid] = (state.scores[pid] || 0) + pts;
  ctx.award(pid, pts);
}

function norm(s) {
  return String(s).trim().toLowerCase().replace(/\s+/g, ' ');
}

function isCorrect(state, guess) {
  const g = norm(guess);
  if (!g) return false;
  if (g === norm(state.phrase)) return true;
  return state.aliases.some((a) => g === norm(a));
}

/* Points for one solve: 100, plus up to 75 for time left, plus 25 for
 * the first solver. Never more than 200. */
function solvePoints(state, ctx) {
  const left = Math.max(0, state.endsAt - ctx.now());
  const speed = Math.round((left / state.guessMs) * SPEED_MAX);
  const first = Object.keys(state.solved).length === 0 ? FIRST_BONUS : 0;
  return SOLVE_POINTS + Math.min(100, speed + first);
}

function guessers(state, ctx) {
  return ctx.players().filter((p) => p.id !== state.director);
}

function maybeReveal(state, ctx) {
  if (state.phase !== 'guess') return;
  if (guessers(state, ctx).every((p) => state.solved[p.id])) reveal(state, ctx);
}

function reveal(state, ctx) {
  if (state.phase !== 'guess') return;
  state.phase = 'reveal';
  const points = {};
  for (const pid of Object.keys(state.solved)) points[pid] = state.solved[pid].pts;
  const n = Object.keys(state.solved).length;
  const dPts = Math.min(DIRECTOR_MAX, n * DIRECTOR_POINTS);
  if (dPts && state.director) {
    score(state, ctx, state.director, dPts);
    points[state.director] = dPts;
  }
  state.last = {
    phrase: state.phrase,
    emoji: state.emoji,
    director: state.director,
    solvers: Object.keys(state.solved).map((pid) => ({ pid, pts: state.solved[pid].pts })),
    points,
  };
  scheduleNext(state, ctx);
}

function knownPid(ctx, pid) {
  return typeof pid === 'string' && ctx.allPlayers().some((p) => p.id === pid);
}

function onAction(state, ctx, pid, a) {
  if (!a || typeof a !== 'object') return;
  if (!knownPid(ctx, pid)) return;
  // Close expired input before a delayed timer can admit it.
  if (state.phase === 'emoji' && ctx.now() >= state.endsAt) {
    skipStory(state, ctx);
    return;
  }
  if (state.phase === 'guess' && ctx.now() >= state.endsAt) {
    reveal(state, ctx);
    return;
  }
  if (state.phase === 'emoji' && pid === state.director && typeof a.emoji === 'string') {
    const t = a.emoji.trim().slice(0, 200);
    // Letters in any language reveal text rather than an emoji story.
    if (t.length >= 1 && !/\p{L}/u.test(t)) {
      state.emoji = t;
      startGuess(state, ctx);
    }
    return;
  }
  if (state.phase === 'guess' && pid !== state.director && typeof a.guess === 'string' && !state.solved[pid]) {
    const g = a.guess.trim().slice(0, 80);
    if (g.length >= 1 && isCorrect(state, g)) {
      const pts = solvePoints(state, ctx);
      state.solved[pid] = { pts };
      score(state, ctx, pid, pts);
      maybeReveal(state, ctx);
    }
    return;
  }
  // The host, or the storyteller, moves on from the reveal.
  if (state.phase === 'reveal' && a.next && (pid === state.director || pid === hostOf(ctx))) {
    nextTurn(state, ctx);
  }
}

function hostOf(ctx) {
  return typeof ctx.hostId === 'function' ? ctx.hostId() : null;
}

/* End game: points already given stay; show our own final screen. */
function onEnd(state) {
  finish(state);
}

/* A player left or stayed away: a storyteller who has not sent emoji yet
 * loses the turn (it does not count as a round); otherwise stop waiting
 * for their guess. With Auto rounds their future turn is dropped. */
function onPlayerGone(state, ctx, pid) {
  if (state.gone.includes(pid)) return;
  state.gone.push(pid);
  if (state.phase === 'done') return;
  const hadTurn = state.turns.includes(pid);
  if (state.phase === 'emoji' && pid === state.director) {
    state.turns.pop();
    state.round -= 1;
    if (state.autoRounds) state.rounds = Math.max(state.round, state.rounds - 1);
    nextTurn(state, ctx);
    return;
  }
  if (!hadTurn && state.autoRounds) state.rounds = Math.max(state.round, state.rounds - 1);
  if (state.phase === 'guess') maybeReveal(state, ctx);
}

function view(state, pid) {
  const { deal, order, ptr, turns, ...rest } = state;
  const out = { ...rest };
  if (state.phase === 'emoji') {
    out.phrase = pid === state.director ? state.phrase : '';
    out.aliases = [];
    out.solved = {};
  } else if (state.phase === 'guess') {
    out.phrase = pid === state.director ? state.phrase : '';
    out.aliases = [];
    out.mySolved = !!state.solved[pid];
    out.solvers = Object.keys(state.solved);
    out.solved = {};
  } else {
    out.mySolved = !!state.solved[pid];
  }
  return out;
}

module.exports = { id, minPlayers: 3, maxPlayers: 20, manifest, create, onAction, onEnd, onPlayerGone, view };
