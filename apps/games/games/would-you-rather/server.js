'use strict';
/* Would You Rather: everyone votes A/B secretly, majority scores.
 * Reference turn-based game: phases, timers, hidden votes, scoring. */

const { dealer, tally, allIn, roundsSetting, paceSetting, paced } = require('../_sdk');

const id = 'would-you-rather';

const manifest = {
  players: { min: 3, max: 20 },
  settings: [
    roundsSetting({ def: 8 }),
    paceSetting(),
    { key: 'voteSeconds', label: 'Seconds to vote', type: 'int', min: 5, max: 60, def: 20 },
  ],
};
const REVEAL_SECONDS = 6;
/* Majority pick: 100. Streak extra: +25 per consecutive majority pick, at
 * most +100 (specs/GAME_RULES_STANDARD.md). */
const BASE_POINTS = 100;
const STREAK_STEP = 25;
const STREAK_CAP = 100;

function create(ctx) {
  const pack = ctx.content(id);
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? 8,
    phase: 'vote', // vote -> reveal -> done
    voteMs: (s.voteSeconds ?? 20) * 1000,
    prompt: null,
    votes: {},
    streaks: {},
    scores: {},
    last: null,
    endsAt: 0,
    hostId: ctx.hostId(),
  };
  state.deal = dealer(pack.prompts && pack.prompts.length ? pack.prompts : [
    { a: 'Fly', b: 'Turn invisible' },
  ]);
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
  state.prompt = state.deal();
  state.votes = {};
  state.endsAt = ctx.now() + state.voteMs;
  const vr = state.round;
  ctx.later(state.voteMs, () => {
    if (state.phase !== 'vote' || state.round !== vr) return;
    reveal(state, ctx);
    ctx.broadcast();
  });
}

function reveal(state, ctx) {
  if (state.phase !== 'vote') return;
  state.phase = 'reveal';
  const { winners } = tally(state.votes);
  const players = ctx.allPlayers();
  for (const p of players) {
    const v = state.votes[p.id];
    if (v && winners.includes(v)) {
      state.streaks[p.id] = (state.streaks[p.id] || 0) + 1;
      const pts = BASE_POINTS + Math.min(STREAK_CAP, (state.streaks[p.id] - 1) * STREAK_STEP);
      state.scores[p.id] = (state.scores[p.id] || 0) + pts;
      ctx.award(p.id, pts);
    } else {
      state.streaks[p.id] = 0;
    }
  }
  state.last = { winners, votes: { ...state.votes } };
  const revealMs = paced(ctx, REVEAL_SECONDS) * 1000;
  state.endsAt = 0;
  const rr = state.round;
  ctx.later(revealMs, () => {
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
  if (state.phase === 'vote' && ctx.now() >= state.endsAt) { reveal(state, ctx); return; }
  if (state.phase === 'vote' && (a.vote === 'a' || a.vote === 'b') && !state.votes[pid]) {
    state.votes[pid] = a.vote;
    if (allIn(ctx.players(), state.votes)) reveal(state, ctx);
  } else if (state.phase === 'reveal' && a.next && pid === ctx.hostId()) {
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
  // Votes stay hidden until reveal.
  if (state.phase === 'vote') {
    out.votes = {};
    out.voted = Object.keys(state.votes);
  }
  return out;
}

module.exports = { id, minPlayers: 3, maxPlayers: 20, manifest, create, onAction, onEnd, onPlayerGone, view };
