'use strict';
/* Never Ever: a "never have I ever" card is shown, everyone taps
 * Have / Never, counts are revealed. Pure players score + streaks. */

const { dealer, allIn, roundsSetting, paceSetting, paced } = require('../_sdk');

const id = 'never-ever';

const manifest = {
  players: { min: 3, max: 20 },
  settings: [
    roundsSetting({ def: 8 }),
    paceSetting(),
    { key: 'voteSeconds', label: 'Seconds to vote', type: 'int', min: 5, max: 120, def: 20 },
  ],
  packs: {
    statements: { label: 'Custom statements', type: 'string[]', minItems: 5 },
  },
};
const REVEAL_SECONDS = 7;
const ROUNDS = 8;
/* "Never" answer: 100. Streak extra: +25 per consecutive "Never", at most
 * +100 (specs/GAME_RULES_STANDARD.md). */
const BASE_POINTS = 100;
const STREAK_STEP = 25;
const STREAK_CAP = 100;

const FALLBACK = ['Pretended to be sick to skip school or work.'];

function create(ctx) {
  const pack = ctx.content(id) || {};
  const list = Array.isArray(pack.statements) && pack.statements.length
    ? pack.statements
    : FALLBACK;
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? ROUNDS,
    voteMs: (s.voteSeconds ?? 20) * 1000,
    phase: 'vote', // vote -> reveal -> done
    statement: null,
    votes: {},
    scores: {},
    streaks: {},
    last: null,
    endsAt: 0,
    hostId: ctx.hostId(),
    labels: pack.labels || {},
  };
  state.deal = dealer(list);
  nextRound(state, ctx);
  return state;
}

function nextRound(state, ctx) {
  state.round += 1;
  if (state.round > state.rounds) {
    state.phase = 'done';
    state.endsAt = 0;
    return;
  }
  state.phase = 'vote';
  state.statement = state.deal();
  state.votes = {};
  state.last = null;
  state.endsAt = ctx.now() + state.voteMs;
  const r = state.round;
  ctx.later(state.voteMs, () => {
    if (state.phase !== 'vote' || state.round !== r) return;
    reveal(state, ctx);
    ctx.broadcast();
  });
}

function reveal(state, ctx) {
  if (state.phase !== 'vote') return;
  state.phase = 'reveal';
  let have = 0;
  let pure = 0;
  const pts = {};
  for (const p of ctx.allPlayers()) {
    if (!state.votes[p.id]) state.streaks[p.id] = 0;
  }
  for (const pid of Object.keys(state.votes)) {
    if (state.votes[pid] === 'not') {
      pure += 1;
      state.streaks[pid] = (state.streaks[pid] || 0) + 1;
      const p = BASE_POINTS + Math.min(STREAK_CAP, (state.streaks[pid] - 1) * STREAK_STEP);
      pts[pid] = p;
      state.scores[pid] = (state.scores[pid] || 0) + p;
      ctx.award(pid, p);
    } else {
      have += 1;
      state.streaks[pid] = 0;
    }
  }
  state.last = { statement: state.statement, have, pure, votes: { ...state.votes }, pts };
  const revealMs = paced(ctx, REVEAL_SECONDS) * 1000;
  state.endsAt = ctx.now() + revealMs;
  const r = state.round;
  ctx.later(revealMs, () => {
    if (state.phase !== 'reveal' || state.round !== r) return;
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
  if (state.phase === 'vote' && ctx.now() >= state.endsAt) {
    reveal(state, ctx);
    return;
  }
  if (state.phase === 'vote' && (a.vote === 'have' || a.vote === 'not') && !state.votes[pid]) {
    state.votes[pid] = a.vote;
    if (allIn(ctx.players(), state.votes)) reveal(state, ctx);
  } else if (state.phase === 'reveal' && a.next
      && pid === ctx.hostId()) {
    nextRound(state, ctx);
  }
}

/* End game: points already awarded stay; show the game's own final screen. */
function onEnd(state) {
  state.phase = 'done';
  state.endsAt = 0;
}

/* A player who left (or stayed away) is not waited for. */
function onPlayerGone(state, ctx) {
  if (state.phase === 'vote' && allIn(ctx.players(), state.votes)) {
    reveal(state, ctx);
  }
}

function view(state, pid, ctx) {
  const { deal, ...rest } = state;
  const out = { ...rest, hostId: ctx ? ctx.hostId() : state.hostId, myVote: state.votes[pid] || null };
  if (state.phase === 'vote') {
    out.votes = {};
    out.voted = Object.keys(state.votes);
  }
  return out;
}

module.exports = { id, minPlayers: 3, maxPlayers: 20, manifest, create, onAction, onEnd, onPlayerGone, view };
