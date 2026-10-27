'use strict';
/* Five Second Rule: performer names 3 in a category in 5 seconds by typing
 * a comma-separated list; the room then votes pass/fail. A pass is worth
 * 100, plus 25 for each pass in a row before it (at most 100 extra). */

const { dealer, shuffle, tally, roundsSetting, paceSetting, pacedMs } = require('../_sdk');

const id = 'five-second';

const manifest = {
  howto: 'Name 3 things in the category within 5 seconds. The room judges pass or fail: a pass is worth 100, and a streak of passes adds up to 100 more.',
  players: { min: 3, max: 20 },
  settings: [
    roundsSetting({ def: null, autoLabel: 'Auto (one per player)' }),
    paceSetting(),
    { key: 'voteSeconds', label: 'Seconds to vote', type: 'int', min: 5, max: 60, def: 15 },
  ],
  packs: {
    categories: { label: 'Custom categories', type: 'string[]', minItems: 5, maxLen: 60 },
  },
};
const ANSWER_S = 5;
const REVEAL_S = 5;
const PASS_POINTS = 100;
const STREAK_POINTS = 25;
const STREAK_MAX = 100;

function create(ctx) {
  const pack = ctx.content(id);
  const cats = pack.categories && pack.categories.length
    ? pack.categories
    : ['Animals', 'Movies', 'Foods'];
  const ps = ctx.allPlayers();
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? Math.max(ps.length, 1),
    autoRounds: s.rounds == null,
    answerMs: pacedMs(s, ANSWER_S),
    voteMs: (s.voteSeconds ?? 15) * 1000,
    revealMs: pacedMs(s, REVEAL_S),
    order: shuffle(ps.map((p) => p.id)),
    ptr: -1,
    turnNo: 0,
    turns: [],
    gone: [],
    performer: null,
    category: null,
    answers: null,
    votes: {},
    streaks: {},
    scores: {},
    last: null,
    phase: 'answer', // answer -> vote -> reveal -> done
    endsAt: 0,
  };
  state.deal = dealer(cats);
  nextTurn(state, ctx);
  return state;
}

/* Next seat after the last performer, skipping players who left. */
function pickPerformer(state, ctx) {
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
  const performer = pickPerformer(state, ctx);
  if (!performer) return finish(state);
  state.round += 1;
  state.turnNo += 1;
  state.performer = performer;
  state.turns.push(performer);
  state.category = state.deal();
  state.answers = null;
  state.votes = {};
  state.last = null;
  state.phase = 'answer';
  state.endsAt = ctx.now() + state.answerMs;
  const ar = state.turnNo;
  ctx.later(state.answerMs, () => {
    if (state.phase !== 'answer' || state.turnNo !== ar) return;
    closeAnswer(state, ctx);
    ctx.broadcast();
  });
}

function judges(state, ctx) {
  return ctx.players().filter((p) => p.id !== state.performer);
}

function closeAnswer(state, ctx) {
  if (state.phase !== 'answer') return;
  if (!state.answers) state.answers = [];
  state.phase = 'vote';
  state.endsAt = ctx.now() + state.voteMs;
  const vr = state.turnNo;
  ctx.later(state.voteMs, () => {
    if (state.phase !== 'vote' || state.turnNo !== vr) return;
    reveal(state, ctx);
    ctx.broadcast();
  });
  maybeReveal(state, ctx);
}

function maybeReveal(state, ctx) {
  if (state.phase !== 'vote') return;
  if (judges(state, ctx).every((p) => state.votes[p.id] !== undefined)) reveal(state, ctx);
}

function reveal(state, ctx) {
  if (state.phase !== 'vote') return;
  state.phase = 'reveal';
  const { winners } = tally(state.votes);
  const hasAnswers = state.answers && state.answers.length > 0;
  // A tied vote (as many passes as fails) counts as a pass.
  const passed = hasAnswers && winners.includes('pass');
  const points = {};
  if (passed) {
    state.streaks[state.performer] = (state.streaks[state.performer] || 0) + 1;
    const pts = PASS_POINTS + Math.min(STREAK_MAX, (state.streaks[state.performer] - 1) * STREAK_POINTS);
    points[state.performer] = pts;
    state.scores[state.performer] = (state.scores[state.performer] || 0) + pts;
    ctx.award(state.performer, pts);
  } else {
    state.streaks[state.performer] = 0;
  }
  state.last = { winners, votes: { ...state.votes }, passed, points };
  state.endsAt = 0; // the reveal shows no clock; Next or the paced timer moves on
  const rr = state.turnNo;
  ctx.later(state.revealMs, () => {
    if (state.phase !== 'reveal' || state.turnNo !== rr) return;
    nextTurn(state, ctx);
    ctx.broadcast();
  });
}

function parseList(raw) {
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5);
}

function knownPid(ctx, pid) {
  return typeof pid === 'string' && ctx.allPlayers().some((p) => p.id === pid);
}

function onAction(state, ctx, pid, a) {
  if (!a || typeof a !== 'object') return;
  if (!knownPid(ctx, pid)) return;
  // Close expired input before a delayed timer can admit it.
  if (state.phase === 'answer' && ctx.now() >= state.endsAt) {
    closeAnswer(state, ctx);
    return;
  }
  if (state.phase === 'vote' && ctx.now() >= state.endsAt) {
    reveal(state, ctx);
    return;
  }
  if (state.phase === 'answer' && pid === state.performer && typeof a.answers === 'string') {
    if (state.answers) return;
    const items = parseList(a.answers);
    if (!items.length) return;
    state.answers = items;
    closeAnswer(state, ctx);
  } else if (state.phase === 'vote' && pid !== state.performer &&
      (a.vote === 'pass' || a.vote === 'fail') && state.votes[pid] === undefined) {
    state.votes[pid] = a.vote;
    maybeReveal(state, ctx);
  } else if (state.phase === 'reveal' && a.next && (pid === state.performer || pid === hostOf(ctx))) {
    // The host, or the performer, moves on from the verdict.
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

/* A player left or stayed away. A performer who has not answered yet loses
 * the turn (it does not count as a round); otherwise stop waiting for their
 * vote. With Auto rounds their future turn is dropped. */
function onPlayerGone(state, ctx, pid) {
  if (state.gone.includes(pid)) return;
  state.gone.push(pid);
  if (state.phase === 'done') return;
  const hadTurn = state.turns.includes(pid);
  if (state.phase === 'answer' && pid === state.performer) {
    state.turns.pop();
    state.round -= 1;
    if (state.autoRounds) state.rounds = Math.max(state.round, state.rounds - 1);
    nextTurn(state, ctx);
    return;
  }
  if (!hadTurn && state.autoRounds) state.rounds = Math.max(state.round, state.rounds - 1);
  if (state.phase === 'vote') maybeReveal(state, ctx);
}

function view(state, pid, ctx) {
  const { deal, order, ptr, turns, ...rest } = state;
  const out = { ...rest, ...(ctx ? { hostId: hostOf(ctx) } : {}) };
  if (state.phase === 'answer' && pid !== state.performer) {
    out.answers = null;
  }
  if (pid === state.performer) out.myAnswers = state.answers;
  if (state.phase === 'vote') {
    out.votes = {};
    out.voted = Object.keys(state.votes);
    out.myVote = state.votes[pid] || null;
  }
  return out;
}

module.exports = { id, minPlayers: 3, maxPlayers: 20, manifest, create, onAction, onEnd, onPlayerGone, view };
