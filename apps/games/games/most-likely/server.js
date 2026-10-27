'use strict';
/* Most Likely: a prompt names a superlative, everyone votes for another
 * player (never self). Voters who pick a plurality winner score. */

const { dealer, tally, allIn, roundsSetting, paceSetting, paced } = require('../_sdk');

const id = 'most-likely';

const manifest = {
  players: { min: 3, max: 20 },
  settings: [
    roundsSetting({ def: 8 }),
    paceSetting(),
    { key: 'voteSeconds', label: 'Seconds to vote', type: 'int', min: 5, max: 120, def: 20 },
  ],
  packs: {
    prompts: { label: 'Custom prompts', type: 'string[]', minItems: 5 },
  },
};
const REVEAL_SECONDS = 7;
const ROUNDS = 8;
/* Voting with the room's pick: 100. Extras (at most +100 per round,
 * specs/GAME_RULES_STANDARD.md): +25 per consecutive matching vote, and +50
 * for being the room's single pick. */
const BASE_POINTS = 100;
const STREAK_STEP = 25;
const CROWN_POINTS = 50;
const EXTRA_CAP = 100;

const FALLBACK = ['Most likely to become famous.'];

function create(ctx) {
  const pack = ctx.content(id) || {};
  const list = Array.isArray(pack.prompts) && pack.prompts.length ? pack.prompts : FALLBACK;
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? ROUNDS,
    voteMs: (s.voteSeconds ?? 20) * 1000,
    phase: 'vote', // vote -> reveal -> done
    prompt: null,
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
  state.prompt = state.deal();
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
  const { winners, counts } = tally(state.votes);
  const pts = {};
  const crownedBonus = {};
  for (const p of ctx.allPlayers()) {
    if (!state.votes[p.id]) state.streaks[p.id] = 0;
  }
  const extra = {};
  for (const pid of Object.keys(state.votes)) {
    const v = state.votes[pid];
    if (winners.includes(v)) {
      state.streaks[pid] = (state.streaks[pid] || 0) + 1;
      pts[pid] = BASE_POINTS;
      extra[pid] = (state.streaks[pid] - 1) * STREAK_STEP;
    } else {
      state.streaks[pid] = 0;
    }
  }
  if (winners.length === 1) {
    const w = winners[0];
    crownedBonus[w] = CROWN_POINTS;
    pts[w] = pts[w] || 0;
    extra[w] = (extra[w] || 0) + CROWN_POINTS;
  }
  for (const pid of Object.keys(pts)) {
    pts[pid] += Math.min(EXTRA_CAP, extra[pid] || 0);
    if (!pts[pid]) { delete pts[pid]; continue; }
    state.scores[pid] = (state.scores[pid] || 0) + pts[pid];
    ctx.award(pid, pts[pid]);
  }
  const tallies = {};
  for (const c of Object.keys(counts)) tallies[c] = counts[c].n;
  state.last = {
    prompt: state.prompt,
    winners,
    tallies,
    votes: { ...state.votes },
    pts,
    crownedBonus,
  };
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
  if (state.phase === 'vote' && typeof a.vote === 'string' && !state.votes[pid]) {
    const ids = ctx.allPlayers().map((p) => p.id);
    if (a.vote !== pid && ids.includes(a.vote)) {
      state.votes[pid] = a.vote;
      if (allIn(ctx.players(), state.votes)) reveal(state, ctx);
    }
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
