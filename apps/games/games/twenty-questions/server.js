'use strict';
/* Twenty Questions: the answerer holds a secret word; guessers ask yes/no
 * questions (answerer taps yes/no/sometimes) and may guess at any time.
 *
 * Points per round (specs/GAME_RULES_STANDARD.md): a correct guess is 100
 * plus a speed extra of up to 100 (more for fewer answered questions), minus
 * 50 per shared letter hint. The answerer gets up to 100 for a word that
 * took many questions, or 100 when nobody guesses it. */

const { dealer, shuffle, roundsSetting, paceSetting, paced } = require('../_sdk');
const { maskWord, hiddenLetters, revealLetter } = require('../engines/word-hints');

const id = 'twenty-questions';

const manifest = {
  howto: 'Ask yes/no questions or guess the secret word. The host chooses 10–50 questions per round (20 by default). Optional shared letter hints cost 50 points each, up to two per round.',
  players: { min: 3, max: 12 },
  settings: [
    roundsSetting({ def: null, autoLabel: 'Auto (one per player)' }),
    paceSetting(),
    { key: 'roundSeconds', label: 'Seconds per round', type: 'int', min: 30, max: 600, def: 180 },
    { key: 'maxQuestions', label: 'Questions per round', type: 'int', min: 10, max: 50, def: 20 },
    { key: 'hints', label: 'Shared letter hints (50 points each, up to 2)', type: 'bool', def: false },
  ],
  packs: {
    words: { label: 'Custom secret words', type: 'string[]', minItems: 5, maxLen: 40 },
  },
};
const REVEAL_SECONDS = 6;
const GUESS_POINTS = 100;
const SPEED_MAX = 100;
const ANSWERER_MAX = 100;
const STUMPER_POINTS = 100;
const HINT_CAP = 2;
const HINT_COST = 50;
const ANSWERS = ['yes', 'no', 'sometimes'];

function create(ctx) {
  const pack = ctx.content(id);
  const words = pack.words && pack.words.length ? pack.words : ['elephant', 'piano', 'castle'];
  const ps = ctx.allPlayers();
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? Math.max(ps.length, 1),
    auto: s.rounds == null, // one turn per player; shrinks when a player leaves first
    turns: [], // answerers so far in this pass of the order
    gone: [], // players who left or stayed away
    roundMs: (s.roundSeconds ?? 180) * 1000,
    maxQ: s.maxQuestions ?? 20,
    hints: s.hints ?? false,
    hintsUsed: 0,
    masked: '',
    order: shuffle(ps.map((p) => p.id)),
    answerer: null,
    word: null,
    questions: [], // [{pid, text, answer}]
    wrong: [], // [{pid, text}] wrong guesses, newest last
    scores: {},
    last: null, // {reason, winner, answered}
    phase: 'play', // play -> reveal -> done
    endsAt: 0,
  };
  state.deal = dealer(words);
  nextTurn(state, ctx);
  return state;
}

function answered(state) {
  return state.questions.filter((q) => q.answer).length;
}

function nextTurn(state, ctx) {
  const alive = ctx.allPlayers().map((p) => p.id).filter((pid) => !state.gone.includes(pid));
  state.order = state.order.filter((pid) => alive.includes(pid));
  for (const pid of alive) if (!state.order.includes(pid)) state.order.push(pid);
  state.round += 1;
  if (state.round > state.rounds || !state.order.length) {
    state.phase = 'done';
    state.endsAt = 0;
    return;
  }
  let pool = state.order.filter((pid) => !state.turns.includes(pid));
  if (!pool.length) {
    state.turns = [];
    pool = state.order.slice();
  }
  state.answerer = pool[0];
  state.turns.push(state.answerer);
  state.word = state.deal();
  state.hintsUsed = 0;
  state.masked = state.hints ? maskWord(state.word) : '';
  state.questions = [];
  state.wrong = [];
  state.last = null;
  state.phase = 'play';
  state.endsAt = ctx.now() + state.roundMs;
  const round = state.round;
  ctx.later(state.roundMs, () => {
    if (state.round !== round || state.phase !== 'play') return;
    endRound(state, ctx, 'time');
    ctx.broadcast();
  });
}

function endRound(state, ctx, reason, winner) {
  if (state.phase !== 'play') return;
  state.phase = 'reveal';
  state.endsAt = 0;
  const n = answered(state);
  if (!winner && reason !== 'left') {
    // Stumper bonus: the answerer survived the round.
    state.scores[state.answerer] = (state.scores[state.answerer] || 0) + STUMPER_POINTS;
    ctx.award(state.answerer, STUMPER_POINTS);
  }
  state.last = { reason, winner: winner || null, answered: n };
  const round = state.round;
  ctx.later(paced(ctx, REVEAL_SECONDS) * 1000, () => {
    if (state.round !== round || state.phase !== 'reveal') return;
    nextTurn(state, ctx);
    ctx.broadcast();
  });
}

function onAction(state, ctx, pid, a) {
  if (!a || typeof a !== 'object' || !ctx.allPlayers().some((p) => p.id === pid)) return;
  if (state.phase === 'play' && ctx.now() >= state.endsAt) { endRound(state, ctx, 'time'); return; }
  if (state.phase === 'play' && pid !== state.answerer && a.hint === true) {
    if (!state.hints || state.hintsUsed >= HINT_CAP || hiddenLetters(state.word, state.masked) <= 1) return;
    state.masked = revealLetter(state.word, state.masked);
    state.hintsUsed += 1;
  } else if (state.phase === 'play' && pid !== state.answerer && typeof a.question === 'string') {
    const text = String(a.question).trim().slice(0, 140);
    if (!text || state.questions.length >= state.maxQ) return;
    if (state.questions.some((q) => q.pid === pid && !q.answer)) return;
    state.questions.push({ pid, text, answer: null });
  } else if (state.phase === 'play' && pid !== state.answerer && typeof a.guess === 'string') {
    const text = String(a.guess).trim().slice(0, 40);
    if (!text) return;
    if (text.toLowerCase() === String(state.word).toLowerCase()) {
      const n = answered(state);
      const pts = Math.max(0, GUESS_POINTS + Math.round((state.maxQ - n) / state.maxQ * SPEED_MAX) - state.hintsUsed * HINT_COST);
      state.scores[pid] = (state.scores[pid] || 0) + pts;
      ctx.award(pid, pts);
      const ap = Math.round(n / state.maxQ * ANSWERER_MAX);
      if (ap > 0) {
        state.scores[state.answerer] = (state.scores[state.answerer] || 0) + ap;
        ctx.award(state.answerer, ap);
      }
      endRound(state, ctx, 'guessed', pid);
    } else {
      const low = text.toLowerCase();
      if (state.wrong.some((w) => w.text.toLowerCase() === low)) return;
      state.wrong.push({ pid, text });
      if (state.wrong.length > 50) state.wrong.splice(0, state.wrong.length - 50);
    }
  } else if (state.phase === 'play' && pid === state.answerer && typeof a.answer === 'string' &&
      Number.isInteger(a.qi)) {
    const q = state.questions[a.qi];
    if (!q || q.answer || !ANSWERS.includes(a.answer)) return;
    q.answer = a.answer;
    if (answered(state) >= state.maxQ) endRound(state, ctx, 'questions');
  } else if (state.phase === 'reveal' && a.next && (pid === state.answerer || pid === ctx.hostId())) {
    // The answerer or the host moves on from the reveal.
    nextTurn(state, ctx);
  }
}

/* End game: points already awarded stay; show the game's own final screen. */
function onEnd(state) {
  state.phase = 'done';
  state.endsAt = 0;
}

/* A player who left or stayed away: an answerer's round ends without a
 * stumper bonus and their turn no longer counts with Auto rounds. */
function onPlayerGone(state, ctx, pid) {
  if (state.gone.includes(pid)) return;
  state.gone.push(pid);
  if (state.auto && !state.turns.includes(pid)) state.rounds = Math.max(state.round, state.rounds - 1);
  if (state.phase === 'play' && pid === state.answerer) endRound(state, ctx, 'left');
}

function view(state, pid, ctx) {
  const { deal, turns, gone, auto, ...rest } = state;
  const out = {
    ...rest,
    questions: state.questions.map((q) => ({ ...q })),
    wrong: state.wrong.map((w) => ({ ...w })),
    scores: { ...state.scores },
    order: [...state.order],
    last: state.last && { ...state.last },
    answered: answered(state),
    hintCap: HINT_CAP,
    hintCost: HINT_COST,
    hostId: ctx && typeof ctx.hostId === 'function' ? ctx.hostId() : undefined,
    hintAvailable: state.hints && state.phase === 'play' && pid !== state.answerer && state.order.includes(pid) && state.hintsUsed < HINT_CAP && hiddenLetters(state.word, state.masked) > 1,
  };
  if (pid !== state.answerer) {
    if (state.phase !== 'reveal') delete out.word;
  } else {
    out.wordShown = state.word;
  }
  return out;
}

module.exports = { id, minPlayers: 3, maxPlayers: 12, manifest, create, onAction, onEnd, onPlayerGone, view };
