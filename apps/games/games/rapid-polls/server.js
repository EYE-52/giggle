'use strict';
/* Rapid Polls: anyone poses an A/B/C/D poll, room votes with live bars.
 * Just for fun: everyone who takes part in a round (poses or votes) gets
 * 25 points, so the match still has a scoreboard
 * (specs/GAME_RULES_STANDARD.md). */

const { dealer, allIn, roundsSetting, paceSetting, paced } = require('../_sdk');

const id = 'rapid-polls';

const manifest = {
  players: { min: 2, max: 20 },
  settings: [
    roundsSetting({ def: 8 }),
    paceSetting(),
  ],
};
const ROUNDS = 8;
const POSE_SECONDS = 45;
const VOTE_SECONDS = 25;
const REVEAL_SECONDS = 8;
const TOOK_PART_POINTS = 25;

function create(ctx) {
  const pack = ctx.content(id);
  const seeds = pack.seedPolls && pack.seedPolls.length ? pack.seedPolls : [
    { q: 'Best snack?', options: ['Chips', 'Fruit', 'Chocolate', 'Popcorn'] },
  ];
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? ROUNDS,
    phase: 'pose', // pose -> vote -> reveal -> done
    poll: null, // {q, options[], by}
    votes: {},
    scores: {},
    last: null,
    endsAt: 0,
    hostId: ctx.hostId(),
  };
  state.deal = dealer(seeds);
  waitPose(state, ctx);
  return state;
}

function waitPose(state, ctx) {
  state.phase = 'pose';
  state.poll = null;
  state.votes = {};
  const poseMs = paced(ctx, POSE_SECONDS) * 1000;
  state.endsAt = ctx.now() + poseMs;
  const sr = state.round;
  ctx.later(poseMs, () => {
    if (state.phase !== 'pose' || state.round !== sr) return;
    startPoll(state, ctx, { ...state.deal(), by: null });
    ctx.broadcast();
  });
}

function startPoll(state, ctx, poll) {
  if (state.phase !== 'pose') return;
  state.round += 1;
  if (state.round > state.rounds) {
    state.phase = 'done';
    state.endsAt = 0;
    return;
  }
  state.phase = 'vote';
  state.poll = poll;
  state.votes = {};
  const voteMs = paced(ctx, VOTE_SECONDS) * 1000;
  state.endsAt = ctx.now() + voteMs;
  const vr = state.round;
  ctx.later(voteMs, () => {
    if (state.phase !== 'vote' || state.round !== vr) return;
    reveal(state, ctx);
    ctx.broadcast();
  });
}

function reveal(state, ctx) {
  if (state.phase !== 'vote') return;
  state.phase = 'reveal';
  const tookPart = new Set(Object.keys(state.votes));
  if (state.poll && state.poll.by) tookPart.add(state.poll.by);
  const pts = {};
  for (const pid of tookPart) {
    pts[pid] = TOOK_PART_POINTS;
    state.scores[pid] = (state.scores[pid] || 0) + TOOK_PART_POINTS;
    ctx.award(pid, TOOK_PART_POINTS);
  }
  state.last = { poll: state.poll, votes: { ...state.votes }, pts };
  const revealMs = paced(ctx, REVEAL_SECONDS) * 1000;
  state.endsAt = ctx.now() + revealMs;
  const rr = state.round;
  ctx.later(revealMs, () => {
    if (state.phase !== 'reveal' || state.round !== rr) return;
    if (state.round >= state.rounds) {
      state.phase = 'done';
      state.endsAt = 0;
    } else {
      waitPose(state, ctx);
    }
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
  if (state.phase === 'pose' && ctx.now() >= state.endsAt) {
    startPoll(state, ctx, { ...state.deal(), by: null });
    return;
  }
  if (state.phase === 'vote' && ctx.now() >= state.endsAt) {
    reveal(state, ctx);
    return;
  }
  if (state.phase === 'pose') {
    if (a.starter) {
      startPoll(state, ctx, { ...state.deal(), by: pid });
    } else if (a.pose && typeof a.pose === 'object') {
      const q = String(a.pose.q || '').trim().slice(0, 140);
      const raw = Array.isArray(a.pose.options) ? a.pose.options : [];
      const options = raw
        .map((o) => String(o == null ? '' : o).trim().slice(0, 60))
        .filter(Boolean);
      if (q.length >= 2 && options.length >= 2 && options.length <= 4) {
        startPoll(state, ctx, { q, options, by: pid });
      }
    }
  } else if (state.phase === 'vote') {
    const n = state.poll ? state.poll.options.length : 0;
    if (Number.isInteger(a.vote) && a.vote >= 0 && a.vote < n && state.votes[pid] === undefined) {
      state.votes[pid] = a.vote;
      if (allIn(ctx.players(), state.votes)) reveal(state, ctx);
    }
  } else if (state.phase === 'reveal' && a.next && pid === ctx.hostId()) {
    if (state.round >= state.rounds) {
      state.phase = 'done';
      state.endsAt = 0;
    } else {
      waitPose(state, ctx);
    }
  }
}

/* End game: points already awarded stay; show the game's own final screen. */
function onEnd(state) {
  state.phase = 'done';
  state.endsAt = 0;
}

/* A player who left (or stayed away) is not waited for. */
function onPlayerGone(state, ctx) {
  if (state.phase === 'vote' && allIn(ctx.players(), state.votes)) reveal(state, ctx);
}

function countsOf(state) {
  const counts = state.poll ? state.poll.options.map(() => 0) : [];
  for (const pid of Object.keys(state.votes)) {
    const v = state.votes[pid];
    if (counts[v] !== undefined) counts[v] += 1;
  }
  return counts;
}

function view(state, pid, ctx) {
  const { deal, ...rest } = state;
  const out = { ...rest, hostId: ctx ? ctx.hostId() : state.hostId, myVote: state.votes[pid] === undefined ? null : state.votes[pid] };
  if (state.phase === 'vote') {
    out.votes = {};
    out.voted = Object.keys(state.votes);
    out.counts = countsOf(state);
  }
  return out;
}

module.exports = { id, minPlayers: 2, maxPlayers: 20, manifest, create, onAction, onEnd, onPlayerGone, view };
