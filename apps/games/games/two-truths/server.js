'use strict';
/* Two Truths and a Lie: each round one player writes two truths and one
 * lie and secretly marks the lie; everyone else votes for the lie.
 * Guessers score 100 for finding it; the writer scores 50 per player
 * fooled (at most 200 in a round). */

const { dealer, shuffle, roundsSetting, paceSetting, pacedMs } = require('../_sdk');

const id = 'two-truths';

const manifest = {
  players: { min: 3, max: 20 },
  settings: [
    roundsSetting({ def: null, autoLabel: 'Auto (one per player)' }),
    paceSetting(),
    { key: 'writeSeconds', label: 'Seconds to write', type: 'int', min: 30, max: 240, def: 90 },
  ],
  packs: {
    ideas: { label: 'Custom ideas', type: 'string[]', minItems: 3 },
  },
};
const VOTE_S = 25;
const REVEAL_S = 10;
const SPOT_POINTS = 100;
const FOOL_POINTS = 50;
const FOOL_MAX = 200;

function create(ctx) {
  const pack = ctx.content(id);
  const ideas = pack.ideas && pack.ideas.length ? pack.ideas : ['A childhood memory'];
  const examples = pack.examples && pack.examples.length
    ? pack.examples
    : [{ statements: ['I can whistle', 'I own a dog', 'I hate cheese'], lie: 0 }];
  const players = ctx.allPlayers().map((p) => p.id);
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? Math.max(1, players.length),
    autoRounds: s.rounds == null,
    writeMs: (s.writeSeconds ?? 90) * 1000,
    voteMs: pacedMs(s, VOTE_S),
    revealMs: pacedMs(s, REVEAL_S),
    phase: 'write', // write -> vote -> reveal -> done
    subject: null,
    order: shuffle(players),
    ptr: -1,
    turnNo: 0,
    turns: [],
    gone: [],
    statements: [],
    lie: 0,
    votes: {},
    idea: '',
    last: null,
    scores: {},
    endsAt: 0,
  };
  state.dealIdea = dealer(ideas);
  state.dealEx = dealer(examples);
  nextSubject(state, ctx);
  return state;
}

/* Next seat in the shuffled order after the last subject, skipping
 * players who left. Stable when someone leaves mid-match. */
function pickSubject(state, ctx) {
  for (const p of ctx.allPlayers()) if (!state.order.includes(p.id)) state.order.push(p.id);
  const n = state.order.length;
  for (let k = 1; k <= n; k++) {
    const i = (state.ptr + k) % n;
    const pid = state.order[i];
    if (!state.gone.includes(pid)) {
      state.ptr = i;
      return pid;
    }
  }
  return null;
}

function finish(state) {
  state.phase = 'done';
  state.endsAt = 0;
}

function nextSubject(state, ctx) {
  if (state.round >= state.rounds) return finish(state);
  const subject = pickSubject(state, ctx);
  if (!subject) return finish(state);
  state.round += 1;
  state.turnNo += 1;
  state.subject = subject;
  state.turns.push(subject);
  state.statements = [];
  state.votes = {};
  state.idea = state.dealIdea();
  state.phase = 'write';
  state.endsAt = ctx.now() + state.writeMs;
  const wr = state.turnNo;
  ctx.later(state.writeMs, () => {
    if (state.phase !== 'write' || state.turnNo !== wr) return;
    autoFill(state);
    startVote(state, ctx);
    ctx.broadcast();
  });
}

/* Subject timed out: borrow a locale example so the round still plays. */
function autoFill(state) {
  const ex = state.dealEx() || {};
  let ss = Array.isArray(ex.statements)
    ? ex.statements.map((s) => String(s).slice(0, 140))
    : [];
  ss = ss.filter((s) => s.trim().length > 0);
  while (ss.length < 3) ss.push('Something mysterious');
  state.statements = ss.slice(0, 3);
  state.lie = Number.isInteger(ex.lie) && ex.lie >= 0 && ex.lie <= 2 ? ex.lie : 0;
}

function voters(state, ctx) {
  return ctx.players().filter((p) => p.id !== state.subject);
}

function startVote(state, ctx) {
  if (state.phase !== 'write') return;
  state.phase = 'vote';
  state.votes = {};
  state.endsAt = ctx.now() + state.voteMs;
  const vr = state.turnNo;
  ctx.later(state.voteMs, () => {
    if (state.phase !== 'vote' || state.turnNo !== vr) return;
    reveal(state, ctx);
    ctx.broadcast();
  });
}

function score(state, ctx, pid, pts) {
  if (!pts) return;
  state.scores[pid] = (state.scores[pid] || 0) + pts;
  ctx.award(pid, pts);
}

function maybeReveal(state, ctx) {
  if (state.phase !== 'vote') return;
  const v = voters(state, ctx);
  if (v.every((p) => state.votes[p.id] !== undefined)) reveal(state, ctx);
}

function reveal(state, ctx) {
  if (state.phase !== 'vote') return;
  state.phase = 'reveal';
  let fooled = 0;
  const points = {};
  for (const pid of Object.keys(state.votes)) {
    if (pid === state.subject) continue;
    if (state.votes[pid] === state.lie) points[pid] = SPOT_POINTS;
    else fooled += 1;
  }
  if (fooled > 0 && state.subject) points[state.subject] = Math.min(FOOL_MAX, fooled * FOOL_POINTS);
  for (const pid of Object.keys(points)) score(state, ctx, pid, points[pid]);
  state.last = {
    subject: state.subject,
    statements: state.statements.slice(),
    lie: state.lie,
    votes: { ...state.votes },
    fooled,
    points,
  };
  state.endsAt = 0; // the reveal shows no clock; Next or the paced timer moves on
  const rr = state.turnNo;
  ctx.later(state.revealMs, () => {
    if (state.phase !== 'reveal' || state.turnNo !== rr) return;
    nextSubject(state, ctx);
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
  if (state.phase === 'write' && ctx.now() >= state.endsAt) {
    autoFill(state);
    startVote(state, ctx);
    return;
  }
  if (state.phase === 'vote' && ctx.now() >= state.endsAt) {
    reveal(state, ctx);
    return;
  }
  if (state.phase === 'write' && pid === state.subject && Array.isArray(a.statements)) {
    const ss = a.statements;
    if (ss.length === 3
        && ss.every((s) => typeof s === 'string' && s.trim().length >= 1 && s.length <= 140)
        && Number.isInteger(a.lie) && a.lie >= 0 && a.lie <= 2) {
      state.statements = ss.map((s) => s.trim().slice(0, 140));
      state.lie = a.lie;
      startVote(state, ctx);
    }
    return;
  }
  if (state.phase === 'vote' && pid !== state.subject && Number.isInteger(a.vote)
      && a.vote >= 0 && a.vote <= 2 && state.votes[pid] === undefined) {
    state.votes[pid] = a.vote;
    maybeReveal(state, ctx);
    return;
  }
  // The host, or the round's writer, moves on from the reveal.
  if (state.phase === 'reveal' && a.next && (pid === state.subject || pid === ctx.hostId())) {
    nextSubject(state, ctx);
  }
}

/* End game: the room keeps every point already given; show our own
 * final screen. */
function onEnd(state) {
  finish(state);
}

/* A player left or stayed away: skip their writing turn, stop waiting
 * for their vote, and drop their future turn when rounds are Auto. */
function onPlayerGone(state, ctx, pid) {
  if (state.gone.includes(pid)) return;
  state.gone.push(pid);
  if (state.phase === 'done') return;
  const hadTurn = state.turns.includes(pid);
  if (state.phase === 'write' && pid === state.subject) {
    // Their turn never happened: it does not count as a round.
    state.turns.pop();
    state.round -= 1;
    if (state.autoRounds) state.rounds = Math.max(state.round, state.rounds - 1);
    nextSubject(state, ctx);
    return;
  }
  if (!hadTurn && state.autoRounds) state.rounds = Math.max(state.round, state.rounds - 1);
  if (state.phase === 'vote') maybeReveal(state, ctx);
}

function view(state, pid) {
  const { dealIdea, dealEx, order, ptr, turns, ...rest } = state;
  const out = { ...rest, myVote: state.votes[pid] };
  if (out.myVote === undefined) out.myVote = null;
  if (state.phase === 'write') {
    out.statements = [];
    out.idea = pid === state.subject ? state.idea : '';
    out.votes = {};
  } else if (state.phase === 'vote') {
    delete out.lie;
    out.idea = '';
    out.votes = {};
    out.voted = Object.keys(state.votes);
  }
  return out;
}

module.exports = { id, minPlayers: 3, maxPlayers: 20, manifest, create, onAction, onEnd, onPlayerGone, view };
