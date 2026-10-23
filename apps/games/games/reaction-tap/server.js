'use strict';
/* Reaction Tap: wait for green, then tap first. Tapping early fouls you
 * out of the round. Five rounds; fastest tap each round scores most. */

const { dealer, roundsSetting, paceSetting, paced } = require('../_sdk');

const id = 'reaction-tap';

const manifest = {
  players: { min: 2, max: 20 },
  howto: 'Wait for green, then tap! Early taps foul. The fastest tap each round earns 100 points, then 75, 50 and 25.',
  settings: [
    roundsSetting({ def: 5 }),
    paceSetting(),
  ],
  packs: {
    tips: { label: 'Custom tips', type: 'string[]', minItems: 3 },
  },
};
const ROUNDS = 5;
const GO_WINDOW_SECONDS = 3;
const MIN_WAIT_MS = 1500;
const MAX_WAIT_MS = 5000;
const GAP_SECONDS = 4;
const RANK_PTS = [100, 75, 50, 25];

function create(ctx) {
  const pack = ctx.content(id);
  const tips = pack.tips && pack.tips.length ? pack.tips : ['Stay loose.'];
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? ROUNDS,
    goMs: paced(s, GO_WINDOW_SECONDS) * 1000,
    gapMs: paced(s, GAP_SECONDS) * 1000,
    phase: 'wait', // wait -> go -> roundEnd -> done
    goAt: 0,
    taps: {},
    fouled: [],
    wins: {},
    scores: {},
    last: null,
    tip: '',
    endsAt: 0,
  };
  state.deal = dealer(tips);
  state.strings = pack.strings || {};
  startRound(state, ctx);
  return state;
}

function startRound(state, ctx) {
  if (state.round >= state.rounds) {
    state.phase = 'done';
    state.endsAt = 0;
    return;
  }
  state.round += 1;
  state.phase = 'wait';
  state.goAt = 0;
  state.taps = {};
  state.fouled = [];
  state.tip = state.deal();
  state.endsAt = 0; // green moment stays secret: no timer bar while waiting
  const delay = MIN_WAIT_MS + Math.random() * (MAX_WAIT_MS - MIN_WAIT_MS);
  const round = state.round;
  ctx.later(delay, () => {
    if (state.round !== round || state.phase !== 'wait') return;
    if (state.phase !== 'wait') return;
    state.phase = 'go';
    state.goAt = ctx.now();
    state.endsAt = ctx.now() + state.goMs;
    ctx.broadcast();
    ctx.later(state.goMs, () => {
      if (state.round !== round || state.phase !== 'go') return;
      endRound(state, ctx);
      ctx.broadcast();
    });
  });
}

function endRound(state, ctx) {
  if (state.phase !== 'go') return;
  state.phase = 'roundEnd';
  const order = Object.keys(state.taps)
    .map((pid) => ({ pid, ms: state.taps[pid] }))
    .sort((a, b) => a.ms - b.ms);
  order.forEach((t) => {
    // Equal times share a rank and its points; seat order never breaks a tie.
    const rank = order.findIndex((o) => o.ms === t.ms);
    t.rank = rank + 1;
    const pts = RANK_PTS[Math.min(rank, RANK_PTS.length - 1)];
    t.pts = pts;
    state.scores[t.pid] = (state.scores[t.pid] || 0) + pts;
    ctx.award(t.pid, pts);
  });
  for (const t of order.filter((o) => o.rank === 1)) {
    state.wins[t.pid] = (state.wins[t.pid] || 0) + 1;
  }
  state.last = { order, fouled: [...state.fouled] };
  state.endsAt = ctx.now() + state.gapMs;
  const round = state.round;
  ctx.later(state.gapMs, () => {
    if (state.round !== round || state.phase !== 'roundEnd') return;
    startRound(state, ctx);
    ctx.broadcast();
  });
}

function onAction(state, ctx, pid, a) {
  if (!ctx.allPlayers().some(p => p.id === pid)) return;
  if (!a || typeof a !== 'object') return;
  if (state.phase === 'roundEnd') {
    if (a.next === true && pid === ctx.hostId()) startRound(state, ctx);
    return;
  }
  if (!a.tap) return;
  if (state.phase === 'wait') {
    if (!state.fouled.includes(pid)) state.fouled.push(pid);
    return;
  }
  if (state.phase === 'go') {
    if (ctx.now() >= state.endsAt) { endRound(state, ctx); return; }

    if (state.fouled.includes(pid) || state.taps[pid] !== undefined) return;
    state.taps[pid] = Math.max(0, ctx.now() - state.goAt);
    if (!waitingFor(state, ctx).length) endRound(state, ctx);
  }
}

function waitingFor(state, ctx) {
  return ctx.players().filter((p) => !state.fouled.includes(p.id) && state.taps[p.id] === undefined);
}

/* A player who left (or stayed away) is no longer waited for. */
function onPlayerGone(state, ctx) {
  if (state.phase === 'go' && ctx.players().length && !waitingFor(state, ctx).length) endRound(state, ctx);
}

/* End game: points already given stay; show the final scores. */
function onEnd(state) {
  state.phase = 'done';
  state.endsAt = 0;
}

function view(state, pid, ctx) {
  const { deal, ...rest } = state;
  return { ...rest, me: pid, hostId: ctx && ctx.hostId ? ctx.hostId() : null };
}

module.exports = { id, minPlayers: 2, maxPlayers: 20, realtime: true, manifest, create, onAction, onPlayerGone, onEnd, view };
