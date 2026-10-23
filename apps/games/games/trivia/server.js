'use strict';
/* Trivia: N questions (default 8), 4 options each. A correct answer earns
 * 100, plus up to 50 for speed and up to 50 for an answer streak (rules
 * standard: good round 100, extras at most +100). */

const { dealer, allIn, roundsSetting, paceSetting, paced } = require('../_sdk');

const id = 'trivia';
const ROUNDS = 8;
const ANSWER_SECONDS = 15;
const REVEAL_SECONDS = 5;
const BASE_PTS = 100;
const SPEED_MAX = 50;
const STREAK_STEP = 25;
const STREAK_MAX = 50;

const manifest = {
  players: { min: 2, max: 20 },
  howto: 'Pick the right answer before time runs out. A correct answer earns 100 points, faster answers up to 50 more, and a streak of correct answers up to 50 more.',
  settings: [
    roundsSetting({ def: ROUNDS }),
    paceSetting(),
    { key: 'answerSeconds', label: 'Seconds to answer', type: 'int', min: 5, max: 60, def: ANSWER_SECONDS },
  ],
};

function create(ctx) {
  const pack = ctx.content(id);
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? ROUNDS,
    answerMs: (s.answerSeconds ?? ANSWER_SECONDS) * 1000,
    revealMs: paced(s, REVEAL_SECONDS) * 1000,
    phase: 'answer', // answer -> reveal -> done
    question: null,
    answers: {},
    streaks: {},
    scores: {},
    last: null,
    endsAt: 0,
    hostId: ctx.hostId(),
  };
  state.deal = dealer(pack.questions && pack.questions.length ? pack.questions : [
    { q: 'Fallback?', options: ['A', 'B', 'C', 'D'], answer: 0 },
  ]);
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
  state.phase = 'answer';
  state.question = state.deal();
  state.answers = {};
  state.last = null;
  state.endsAt = ctx.now() + state.answerMs;
  const ar = state.round;
  ctx.later(state.answerMs, () => {
    if (state.phase !== 'answer' || state.round !== ar) return;
    reveal(state, ctx);
    ctx.broadcast();
  });
}

/* Points for one correct answer: 100, speed up to +50, streak up to +50. */
function pointsFor(msLeft, answerMs, streak) {
  const speed = Math.round((Math.max(0, Math.min(answerMs, msLeft)) / Math.max(1, answerMs)) * SPEED_MAX);
  const bonus = Math.min(STREAK_MAX, Math.max(0, streak - 1) * STREAK_STEP);
  return BASE_PTS + speed + bonus;
}

function reveal(state, ctx) {
  if (state.phase !== 'answer') return;
  state.phase = 'reveal';
  const correct = state.question.answer;
  const results = {};
  for (const p of ctx.allPlayers()) {
    const a = state.answers[p.id];
    if (a && a.pick === correct) {
      state.streaks[p.id] = (state.streaks[p.id] || 0) + 1;
      const pts = pointsFor(state.endsAt - a.at, state.answerMs, state.streaks[p.id]);
      state.scores[p.id] = (state.scores[p.id] || 0) + pts;
      ctx.award(p.id, pts);
      results[p.id] = { pick: a.pick, ok: true, pts, streak: state.streaks[p.id] };
    } else {
      state.streaks[p.id] = 0;
      if (a) results[p.id] = { pick: a.pick, ok: false, pts: 0 };
    }
  }
  state.last = { correct, results };
  state.endsAt = 0; // reveal has no visible clock; host can press Next
  const rr = state.round;
  ctx.later(state.revealMs, () => {
    if (state.phase !== 'reveal' || state.round !== rr) return;
    nextRound(state, ctx);
    ctx.broadcast();
  });
}

function knownPid(ctx, pid) {
  return typeof pid === 'string' && ctx.allPlayers().some((p) => p.id === pid);
}

function onAction(state, ctx, pid, a) {
  if (!a || typeof a !== 'object') return;
  if (!knownPid(ctx, pid)) return;
  // Close expired input before a delayed timer can admit it.
  if (state.phase === 'answer' && ctx.now() >= state.endsAt) {
    reveal(state, ctx);
    return;
  }
  if (state.phase === 'answer' && Number.isInteger(a.pick) &&
      a.pick >= 0 && a.pick < 4 && !state.answers[pid]) {
    state.answers[pid] = { pick: a.pick, at: ctx.now() };
    if (allIn(ctx.players(), state.answers)) reveal(state, ctx);
  } else if (state.phase === 'reveal' && a.next && pid === ctx.hostId()) {
    nextRound(state, ctx);
  }
}

/* A player who left (or stayed away) is no longer waited for. */
function onPlayerGone(state, ctx) {
  if (state.phase === 'answer' && ctx.players().length && allIn(ctx.players(), state.answers)) reveal(state, ctx);
}

/* End game: points already given stay; show the final scores. */
function onEnd(state) {
  state.phase = 'done';
  state.endsAt = 0;
}

function view(state, pid, ctx) {
  const { deal, ...rest } = state;
  const out = { ...rest, scores: { ...state.scores }, hostId: ctx ? ctx.hostId() : state.hostId, myPick: state.answers[pid] ? state.answers[pid].pick : null };
  if (state.phase === 'answer') {
    out.question = state.question
      ? { q: state.question.q, options: state.question.options } : null;
    out.answers = {};
    out.answered = Object.keys(state.answers);
  }
  return out;
}

module.exports = { id, minPlayers: 2, maxPlayers: 20, manifest, create, onAction, onPlayerGone, onEnd, view, pointsFor };
