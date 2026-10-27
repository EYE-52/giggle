'use strict';
/* Charades: one player acts out a secret word for 60s while guessers type
 * guesses. A correct guess earns 100, up to 50 more for speed and 50 for
 * being first (25 second); the actor earns 50 per correct guesser, at most
 * 200 a turn (rules standard). The actor sees every guess. */

const { dealer, shuffle, roundsSetting, paceSetting, paced } = require('../_sdk');
const { maskWord } = require('../engines/word-hints');

const id = 'charades';
const REVEAL_SECONDS = 5;
const GUESS_PTS = 100;
const SPEED_MAX = 50;
const ORDER_PTS = [50, 25];
const ACTOR_PER_GUESS = 50;
const ACTOR_MAX = 200;

/* Points for a correct guess: 100, speed up to +50, first +50 / second +25. */
function guessPoints(msLeft, roundMs, order) {
  const speed = Math.round((Math.max(0, Math.min(roundMs, msLeft)) / Math.max(1, roundMs)) * SPEED_MAX);
  return GUESS_PTS + speed + (ORDER_PTS[order] || 0);
}

const manifest = {
  name: 'Charades',
  tagline: 'Act it out, guess fast',
  howto: 'Act out your word in Giggle Meet with your camera on — no talking. Guessers race to name it: a correct guess earns 100 points, more for speed and for being first. The actor earns 50 for each player who gets it.',
  cat: 'speed',
  renderer: 'dom',
  realtime: false,
  communication: 'video',
  players: { min: 3, max: 12 },
  settings: [
    roundsSetting({ def: null, autoLabel: 'Auto (one per player)' }),
    paceSetting(),
    { key: 'roundSeconds', label: 'Seconds per turn', type: 'int', min: 10, max: 180, def: 60 },
  ],
  packs: {
    words: { label: 'Custom words', type: 'string[]', minItems: 10, maxItems: 200, maxLen: 60 },
  },
};

function create(ctx) {
  const pack = ctx.content(id);
  const words = pack.words && pack.words.length ? pack.words : ['apple', 'robot', 'pirate'];
  const s = ctx.settings ? ctx.settings() : {};
  const ps = ctx.allPlayers();
  const state = {
    round: 0,
    rounds: s.rounds ?? Math.max(ps.length, 1),
    autoRounds: s.rounds === undefined || s.rounds === null,
    acted: [],
    cycle: [],
    roundMs: (s.roundSeconds ?? 60) * 1000,
    revealMs: paced(s, REVEAL_SECONDS) * 1000,
    gone: [],
    actorPts: 0,
    order: shuffle(ps.map((p) => p.id)),
    actor: null,
    word: null,
    masked: '',
    guesses: [], // [{pid, text}] every attempt, newest last
    guessed: {}, // pid -> pts for correct guessers
    scores: {},
    phase: 'act', // act -> reveal -> done
    endsAt: 0,
  };
  state.deal = dealer(words);
  nextTurn(state, ctx);
  return state;
}

function nextTurn(state, ctx) {
  const alive = ctx.allPlayers().map((p) => p.id).filter((pid) => !state.gone.includes(pid));
  state.order = state.order.filter((pid) => alive.includes(pid));
  for (const pid of alive) if (!state.order.includes(pid)) state.order.push(pid);
  state.round += 1;
  if (state.round > state.rounds || !state.order.length) {
    state.round = Math.min(state.round, state.rounds);
    state.phase = 'done';
    state.endsAt = 0;
    state.endReason = 'All turns complete';
    return;
  }
  // Next actor: the first in the order who has not acted this cycle, so a
  // player leaving never shifts or repeats anyone else's turn.
  let fresh = state.order.filter((pid) => !state.cycle.includes(pid));
  if (!fresh.length) { state.cycle = []; fresh = state.order.slice(); }
  state.actor = fresh[0];
  state.cycle.push(state.actor);
  state.acted.push(state.actor);
  state.word = state.deal();
  state.masked = maskWord(state.word);
  state.guesses = [];
  state.guessed = {};
  state.actorPts = 0;
  state.phase = 'act';
  state.endReason = null;
  state.endsAt = ctx.now() + state.roundMs;
  const round = state.round;
  ctx.later(state.roundMs, () => {
    if (state.round !== round || state.phase !== 'act') return;
    endTurn(state, ctx);
    ctx.broadcast();
  });
}

function endTurn(state, ctx, reason = "Time's up") {
  if (state.phase !== 'act') return;
  state.phase = 'reveal';
  state.endsAt = ctx.now() + state.revealMs;
  state.endReason = reason;
  const round = state.round;
  ctx.later(state.revealMs, () => {
    if (state.round !== round || state.phase !== 'reveal') return;
    nextTurn(state, ctx);
    ctx.broadcast();
  });
}

function onAction(state, ctx, pid, a) {
  if (!a || typeof a !== 'object' || !ctx.allPlayers().some((p) => p.id === pid)) return;
  if (state.phase === 'act' && ctx.now() >= state.endsAt) { endTurn(state, ctx); return; }
  if (state.phase === 'act' && pid !== state.actor && typeof a.guess === 'string') {
    const text = String(a.guess).trim().slice(0, 60);
    if (!text) return;
    state.guesses.push({ pid, text });
    if (state.guesses.length > 200) state.guesses.splice(0, state.guesses.length - 200);
    if (!state.guessed[pid] && text.toLowerCase() === String(state.word).toLowerCase()) {
      const order = Object.keys(state.guessed).length;
      const pts = guessPoints(state.endsAt - ctx.now(), state.roundMs, order);
      state.guessed[pid] = pts;
      state.scores[pid] = (state.scores[pid] || 0) + pts;
      ctx.award(pid, pts);
      const ap = Math.min(ACTOR_PER_GUESS, ACTOR_MAX - state.actorPts);
      if (ap > 0) {
        state.actorPts += ap;
        state.scores[state.actor] = (state.scores[state.actor] || 0) + ap;
        ctx.award(state.actor, ap);
      }
      if (allGuessed(state, ctx)) endTurn(state, ctx, 'Everyone guessed it');
    }
  } else if (state.phase === 'reveal' && a.next && (pid === state.actor || pid === ctx.hostId())) {
    nextTurn(state, ctx);
  }
}

/* Every guesser still playing has the word. */
function allGuessed(state, ctx) {
  const guessers = ctx.players().filter((p) => p.id !== state.actor && !state.gone.includes(p.id));
  return guessers.length > 0 && guessers.every((p) => state.guessed[p.id]);
}

/* A player who left (or stayed away): their acting turn ends, their guess
 * is no longer waited for, and they get no more turns. */
function onPlayerGone(state, ctx, pid) {
  if (!state.gone.includes(pid)) state.gone.push(pid);
  // Auto length is one turn per player: a gone player's turn is skipped.
  if (state.autoRounds && !state.acted.includes(pid)) state.rounds = Math.max(state.round, state.rounds - 1);
  state.order = state.order.filter((x) => x !== pid);
  if (state.phase !== 'act') return;
  const name = (ctx.allPlayers().find((p) => p.id === pid) || {}).name || 'The actor';
  if (pid === state.actor) endTurn(state, ctx, `${name} left the stage`);
  else if (allGuessed(state, ctx)) endTurn(state, ctx, 'Everyone guessed it');
}

/* End game: points already given stay; show the final scores. */
function onEnd(state) {
  state.phase = 'done';
  state.endsAt = 0;
  state.endReason = 'Game ended';
}

function view(state, pid, ctx) {
  const { deal, ...rest } = state;
  const out = { ...rest, hostId: ctx && ctx.hostId ? ctx.hostId() : null };
  out.camera = state.phase === 'done' ? null : { mode: 'spotlight', featured: state.actor, caption: state.phase === 'act' ? 'Act it out · no talking' : 'Take a bow!' };
  if (pid !== state.actor) {
    if (state.phase !== 'reveal') delete out.word;
    // Guessers see only their own attempts; the actor sees the full stream.
    out.guesses = state.guesses.filter((g) => g.pid === pid);
  } else {
    out.wordShown = state.word;
  }
  return out;
}

module.exports = { id, minPlayers: 3, maxPlayers: 12, manifest, create, onAction, onPlayerGone, onEnd, view, guessPoints };
