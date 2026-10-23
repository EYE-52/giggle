'use strict';
/* Dare Roulette: the wheel lands on a player + dare, the room votes
 * done/chicken.
 *
 * Points per round (specs/GAME_RULES_STANDARD.md): a "done" majority gives
 * the player 100 plus a streak extra (+25 per consecutive completed dare, at
 * most +100); an even split is half credit (50). No votes: no verdict. */

const { dealer, shuffle, allIn, roundsSetting, paceSetting, paced } = require('../_sdk');

const id = 'dare-roulette';

const manifest = {
  players: { min: 3, max: 20 },
  settings: [
    roundsSetting({ def: 8 }),
    paceSetting(),
    { key: 'dareSeconds', label: 'Seconds to perform', type: 'int', min: 10, max: 180, def: 60 },
  ],
  packs: {
    dares: { label: 'Custom dares', type: 'string[]', minItems: 5 },
  },
};
const ROUNDS = 8;
// Scaled by Pace ("Seconds to perform" is the host's own setting).
const SPIN_SECONDS = 45;
const JUDGE_SECONDS = 25;
const REVEAL_SECONDS = 7;
const WIN_POINTS = 100;
const HALF_POINTS = 50;
const STREAK_STEP = 25;
const STREAK_CAP = 100;

function create(ctx) {
  const pack = ctx.content(id);
  const dares = pack.dares && pack.dares.length ? pack.dares : ['Do 10 jumping jacks'];
  const ps = ctx.allPlayers();
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? ROUNDS,
    dareMs: (s.dareSeconds ?? 60) * 1000,
    phase: 'spin', // spin -> perform -> verdict -> reveal -> done
    victim: null,
    dare: null,
    votes: {},
    streaks: {},
    scores: {},
    gone: [], // players who left or stayed away
    last: null,
    endsAt: 0,
    hostId: ctx.hostId(),
  };
  state.deal = dealer(dares);
  state.wheel = shuffle(ps.map((p) => p.id));
  state.wheelPos = 0;
  waitSpin(state, ctx);
  return state;
}

function nextVictim(state, ctx) {
  const ids = ctx.allPlayers().map((p) => p.id).filter((pid) => !state.gone.includes(pid));
  state.wheel = state.wheel.filter((pid) => ids.includes(pid));
  for (const pid of ids) {
    if (!state.wheel.includes(pid)) state.wheel.push(pid);
  }
  if (!state.wheel.length) return null;
  const pid = state.wheel[state.wheelPos % state.wheel.length];
  state.wheelPos += 1;
  return pid;
}

function waitSpin(state, ctx) {
  state.phase = 'spin';
  state.victim = null;
  state.dare = null;
  state.votes = {};
  const spinMs = paced(ctx, SPIN_SECONDS) * 1000;
  state.endsAt = ctx.now() + spinMs;
  const sr = state.round;
  ctx.later(spinMs, () => {
    if (state.phase !== 'spin' || state.round !== sr) return;
    spin(state, ctx);
    ctx.broadcast();
  });
}

function spin(state, ctx) {
  if (state.phase !== 'spin') return;
  state.round += 1;
  const victim = nextVictim(state, ctx);
  if (!victim || state.round > state.rounds) {
    state.phase = 'done';
    state.endsAt = 0;
    return;
  }
  state.phase = 'perform';
  state.victim = victim;
  state.dare = state.deal();
  state.votes = {};
  state.endsAt = ctx.now() + state.dareMs;
  const vr = state.round;
  ctx.later(state.dareMs, () => {
    if (state.phase !== 'perform' || state.round !== vr) return;
    beginJudging(state, ctx);
    ctx.broadcast();
  });
}

function beginJudging(state, ctx) {
  if (state.phase !== 'perform') return;
  state.phase = 'verdict';
  state.votes = {};
  const judgeMs = paced(ctx, JUDGE_SECONDS) * 1000;
  state.endsAt = ctx.now() + judgeMs;
  const round = state.round;
  ctx.later(judgeMs, () => {
    if (state.phase !== 'verdict' || state.round !== round) return;
    resolve(state, ctx);
    ctx.broadcast();
  });
}

function jurors(ctx, state) {
  return ctx.players().filter((p) => p.id !== state.victim);
}

function resolve(state, ctx) {
  if (state.phase !== 'verdict') return;
  state.phase = 'reveal';
  let done = 0;
  let chicken = 0;
  for (const pid of Object.keys(state.votes)) {
    if (state.votes[pid] === 'done') done += 1;
    else chicken += 1;
  }
  const success = done > chicken;
  const split = done > 0 && done === chicken;
  let points = 0;
  if (state.victim) {
    if (success) {
      state.streaks[state.victim] = (state.streaks[state.victim] || 0) + 1;
      points = WIN_POINTS + Math.min(STREAK_CAP, (state.streaks[state.victim] - 1) * STREAK_STEP);
    } else {
      state.streaks[state.victim] = 0;
      if (split) points = HALF_POINTS;
    }
    if (points) {
      state.scores[state.victim] = (state.scores[state.victim] || 0) + points;
      ctx.award(state.victim, points);
    }
  }
  state.last = {
    victim: state.victim, dare: state.dare,
    votes: { ...state.votes }, done, chicken, success, split, points,
  };
  const revealMs = paced(ctx, REVEAL_SECONDS) * 1000;
  state.endsAt = ctx.now() + revealMs;
  const rr = state.round;
  ctx.later(revealMs, () => {
    if (state.phase !== 'reveal' || state.round !== rr) return;
    afterReveal(state, ctx);
    ctx.broadcast();
  });
}

function afterReveal(state, ctx) {
  if (state.round >= state.rounds) {
    state.phase = 'done';
    state.endsAt = 0;
  } else {
    waitSpin(state, ctx);
  }
}

function knownPid(ctx, pid) {
  return typeof pid === 'string' && ctx.allPlayers().some((p) => p.id === pid);
}

function onAction(state, ctx, pid, a) {
  if (!a || typeof a !== 'object') return;
  if (!knownPid(ctx, pid)) return;
  // Close expired input before a delayed timer can admit it.
  if (state.phase === 'perform' && ctx.now() >= state.endsAt) {
    beginJudging(state, ctx);
    return;
  }
  if (state.phase === 'verdict' && ctx.now() >= state.endsAt) {
    resolve(state, ctx);
    return;
  }
  if (state.phase === 'spin') {
    if (a.spin) spin(state, ctx);
  } else if (state.phase === 'perform') {
    if (pid === state.victim && a.ready) beginJudging(state, ctx);
  } else if (state.phase === 'verdict') {
    if (pid !== state.victim && (a.vote === 'done' || a.vote === 'chicken') && !state.votes[pid]) {
      state.votes[pid] = a.vote;
      if (allIn(jurors(ctx, state), state.votes)) resolve(state, ctx);
    }
  } else if (state.phase === 'reveal' && a.next && (pid === ctx.hostId() || pid === state.victim)) {
    // The host or the round's player can move on from the reveal.
    afterReveal(state, ctx);
  }
}

/* End game: points already awarded stay; show the game's own final screen. */
function onEnd(state) {
  state.phase = 'done';
  state.endsAt = 0;
}

/* A player who left or stayed away leaves the wheel: their dare is
 * skipped and their verdict is not waited for. */
function onPlayerGone(state, ctx, pid) {
  if (!state.gone.includes(pid)) state.gone.push(pid);
  if (state.phase === 'perform' && pid === state.victim) {
    state.last = { victim: pid, dare: state.dare, votes: {}, done: 0, chicken: 0, success: false, split: false, points: 0, skipped: true };
    afterReveal(state, ctx);
  } else if (state.phase === 'verdict' && allIn(jurors(ctx, state), state.votes)) {
    resolve(state, ctx);
  }
}

function view(state, pid, ctx) {
  const { deal, wheel, wheelPos, gone, ...rest } = state;
  const out = { ...rest, hostId: ctx ? ctx.hostId() : state.hostId, scores: { ...state.scores }, myVote: state.votes[pid] || null };
  if (state.phase === 'verdict') {
    out.votes = {};
    out.voted = Object.keys(state.votes);
  }
  return out;
}

module.exports = { id, minPlayers: 3, maxPlayers: 20, manifest, create, onAction, onEnd, onPlayerGone, view };
