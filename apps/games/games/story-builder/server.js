'use strict';
/* Story Builder: a seed sentence opens each story, then every player adds
 * one sentence in turn against a short clock (timeouts get a fallback
 * line). The finished story is revealed and each player votes the
 * funniest line — never their own. Each vote is worth 50 (at most 100 a
 * story) and the funniest line earns 100 more; tied lines all count. */

const { dealer, shuffle, tally, roundsSetting, paceSetting, pacedMs } = require('../_sdk');

const id = 'story-builder';

const manifest = {
  howto: 'Add one sentence on your turn before time runs out, then vote for the funniest line (not your own). Each vote is worth 50 (up to 100) and the funniest line earns 100 more.',
  players: { min: 3, max: 20 },
  settings: [
    roundsSetting({ def: 3 }),
    paceSetting(),
    { key: 'turnSeconds', label: 'Seconds per turn', type: 'int', min: 10, max: 120, def: 30 },
  ],
  packs: {
    seeds: { label: 'Custom story seeds', type: 'string[]', minItems: 3 },
    fillers: { label: 'Custom filler lines', type: 'string[]', minItems: 3 },
  },
};
const VOTE_S = 25;
const REVEAL_S = 10;
const VOTE_POINTS = 50;
const VOTE_MAX = 100;
const WIN_POINTS = 100;

function create(ctx) {
  const pack = ctx.content(id);
  const seeds = pack.seeds && pack.seeds.length ? pack.seeds : ['It all started on a Tuesday.'];
  const fillers = pack.fillers && pack.fillers.length
    ? pack.fillers
    : ['Nobody said a word, but everybody thought the same thing.'];
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? 3,
    turnMs: (s.turnSeconds ?? 30) * 1000,
    voteMs: pacedMs(s, VOTE_S),
    revealMs: pacedMs(s, REVEAL_S),
    gone: [],
    phase: 'build', // build -> vote -> reveal -> done
    seed: '',
    lines: [], // [{pid, text}]
    order: [],
    turnIdx: 0,
    turn: null,
    votes: {}, // voterPid -> lineIdx
    last: null,
    scores: {},
    endsAt: 0,
    hostId: ctx.hostId(),
  };
  state.dealSeed = dealer(seeds);
  state.dealFill = dealer(fillers);
  nextStory(state, ctx);
  return state;
}

function finish(state) {
  state.phase = 'done';
  state.turn = null;
  state.endsAt = 0;
}

function nextStory(state, ctx) {
  if (state.round >= state.rounds) return finish(state);
  const alive = ctx.allPlayers().map((p) => p.id).filter((pid) => !state.gone.includes(pid));
  if (!alive.length) return finish(state);
  state.round += 1;
  state.seed = state.dealSeed();
  state.lines = [];
  state.order = shuffle(alive);
  state.turnIdx = 0;
  state.votes = {};
  beginTurn(state, ctx);
}

function beginTurn(state, ctx) {
  // Players who left lose their remaining turns in this story.
  while (state.turnIdx < state.order.length && state.gone.includes(state.order[state.turnIdx])) state.turnIdx += 1;
  if (state.turnIdx >= state.order.length) {
    if (!state.lines.length) {
      // Everyone whose turn it was left: nothing to vote on.
      nextStory(state, ctx);
      return;
    }
    startVote(state, ctx);
    return;
  }
  state.turn = state.order[state.turnIdx];
  state.phase = 'build';
  state.endsAt = ctx.now() + state.turnMs;
  const idx = state.turnIdx;
  const br = state.round;
  ctx.later(state.turnMs, () => {
    if (state.phase !== 'build' || state.turnIdx !== idx || state.round !== br) return;
    timeOutTurn(state, ctx);
    ctx.broadcast();
  });
}

function timeOutTurn(state, ctx) {
  state.lines.push({ pid: state.turn, text: state.dealFill() });
  state.turnIdx += 1;
  beginTurn(state, ctx);
}

function startVote(state, ctx) {
  if (state.phase !== 'build') return;
  state.phase = 'vote';
  state.turn = null;
  state.votes = {};
  state.endsAt = ctx.now() + state.voteMs;
  const vr = state.round;
  ctx.later(state.voteMs, () => {
    if (state.phase !== 'vote' || state.round !== vr) return;
    reveal(state, ctx);
    ctx.broadcast();
  });
}

function score(state, ctx, pid, pts) {
  if (!pts) return;
  state.scores[pid] = (state.scores[pid] || 0) + pts;
  ctx.award(pid, pts);
}

function reveal(state, ctx) {
  if (state.phase !== 'vote') return;
  state.phase = 'reveal';
  const { winners } = tally(state.votes);
  const counts = {};
  for (const idx of Object.values(state.votes)) counts[idx] = (counts[idx] || 0) + 1;
  // Per author: votes across their lines (capped), plus one winner bonus.
  // Tied funniest lines all earn the bonus, so ties score the same.
  const votesBy = {};
  const winBy = {};
  state.lines.forEach((line, i) => {
    votesBy[line.pid] = (votesBy[line.pid] || 0) + (counts[i] || 0);
    if (winners.includes(String(i))) winBy[line.pid] = true;
  });
  const points = {};
  for (const pid of Object.keys(votesBy)) {
    const pts = Math.min(VOTE_MAX, votesBy[pid] * VOTE_POINTS) + (winBy[pid] ? WIN_POINTS : 0);
    if (pts) points[pid] = pts;
  }
  for (const pid of Object.keys(points)) score(state, ctx, pid, points[pid]);
  state.last = {
    seed: state.seed,
    winners: winners.map(Number),
    lines: state.lines.map((line, i) => ({ pid: line.pid, text: line.text, n: counts[i] || 0 })),
    votes: { ...state.votes },
    points,
  };
  state.endsAt = 0; // the reveal shows no clock; Next or the paced timer moves on
  const rr = state.round;
  ctx.later(state.revealMs, () => {
    if (state.phase !== 'reveal' || state.round !== rr) return;
    nextStory(state, ctx);
    ctx.broadcast();
  });
}

function maybeReveal(state, ctx) {
  if (state.phase !== 'vote') return;
  const eligible = ctx.players().filter((p) => state.lines.some((l) => l.pid !== p.id));
  if (eligible.every((p) => state.votes[p.id] !== undefined)) reveal(state, ctx);
}

function knownPid(ctx, pid) {
  return typeof pid === 'string' && ctx.allPlayers().some((p) => p.id === pid);
}

function onAction(state, ctx, pid, a) {
  if (!a || typeof a !== 'object') return;
  if (!knownPid(ctx, pid)) return;
  // Close expired input before a delayed timer can admit it.
  if (state.phase === 'build' && ctx.now() >= state.endsAt) {
    timeOutTurn(state, ctx);
    return;
  }
  if (state.phase === 'vote' && ctx.now() >= state.endsAt) {
    reveal(state, ctx);
    return;
  }
  if (state.phase === 'build' && pid === state.turn && typeof a.line === 'string') {
    const t = a.line.trim().slice(0, 200);
    if (t.length >= 1) {
      state.lines.push({ pid, text: t });
      state.turnIdx += 1;
      beginTurn(state, ctx);
    }
    return;
  }
  if (state.phase === 'vote' && Number.isInteger(a.vote) && state.votes[pid] === undefined) {
    const line = state.lines[a.vote];
    if (line && line.pid !== pid) {
      state.votes[pid] = a.vote;
      maybeReveal(state, ctx);
    }
    return;
  }
  if (state.phase === 'reveal' && a.next && pid === ctx.hostId()) {
    nextStory(state, ctx);
  }
}

/* End game: points already given stay; show our own final screen. */
function onEnd(state) {
  finish(state);
}

/* A player left or stayed away: skip their turn (no filler line) and
 * stop waiting for their vote. */
function onPlayerGone(state, ctx, pid) {
  if (!state.gone.includes(pid)) state.gone.push(pid);
  if (state.phase === 'build' && state.turn === pid) {
    state.turnIdx += 1;
    beginTurn(state, ctx);
  } else if (state.phase === 'vote') {
    maybeReveal(state, ctx);
  }
}

function view(state, pid, ctx) {
  const { dealSeed, dealFill, order, ...rest } = state;
  const out = { ...rest, hostId: ctx ? ctx.hostId() : state.hostId, totalTurns: order.length };
  if (state.phase === 'build') {
    out.myVote = null;
  } else if (state.phase === 'vote') {
    out.lines = state.lines.map((l) => ({ text: l.text }));
    out.myLines = state.lines.flatMap((l, i) => l.pid === pid ? [i] : []);
    out.myVote = state.votes[pid] === undefined ? null : state.votes[pid];
    out.votes = {};
    out.voted = Object.keys(state.votes);
  } else {
    out.myVote = state.votes[pid] === undefined ? null : state.votes[pid];
  }
  return out;
}

module.exports = { id, minPlayers: 3, maxPlayers: 20, manifest, create, onAction, onEnd, onPlayerGone, view };
