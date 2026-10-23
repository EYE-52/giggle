'use strict';
/* Compliment Battle: each round names a target, everyone else writes a
 * secret compliment, then the room votes the winner on an anonymous ballot.
 * The winning writer earns 100; tied winners all earn 100. */

const { dealer, tally, allIn, shuffle, roundsSetting, paceSetting, pacedMs } = require('../_sdk');

const id = 'compliment-battle';

const manifest = {
  players: { min: 3, max: 20 },
  settings: [
    roundsSetting({ def: null, autoLabel: 'Auto (one per player)' }),
    paceSetting(),
    { key: 'writeSeconds', label: 'Seconds to write', type: 'int', min: 15, max: 180, def: 60 },
  ],
  packs: {
    prompts: { label: 'Custom prompts', type: 'string[]', minItems: 3 },
  },
};
const VOTE_S = 30;
const REVEAL_S = 8;
const WIN_POINTS = 100;

function create(ctx) {
  const pack = ctx.content(id);
  const prompts = pack.prompts && pack.prompts.length ? pack.prompts : ['Say something kind'];
  const ps = ctx.allPlayers();
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? Math.max(1, ps.length),
    autoRounds: s.rounds == null,
    writeMs: (s.writeSeconds ?? 60) * 1000,
    voteMs: pacedMs(s, VOTE_S),
    revealMs: pacedMs(s, REVEAL_S),
    phase: 'write', // write -> vote -> reveal -> done
    target: null,
    prompt: null,
    entries: {},
    votes: {},
    order: [],
    last: null,
    scores: {},
    endsAt: 0,
    hostId: ctx.hostId(),
    turnNo: 0,
    gone: [],
  };
  state.deal = dealer(prompts);
  state.rotation = shuffle(ps.map((p) => p.id));
  state.ptr = -1;
  state.turns = [];
  nextRound(state, ctx);
  return state;
}

function writers(ctx, state) {
  return ctx.players().filter((p) => p.id !== state.target);
}

function voters(ctx, state) {
  return ctx.players().filter((p) => state.order.some((author) => author !== p.id));
}

/* Next seat after the last target, skipping players who left. */
function pickTarget(state, ctx) {
  for (const p of ctx.allPlayers()) if (!state.rotation.includes(p.id)) state.rotation.push(p.id);
  const n = state.rotation.length;
  for (let k = 1; k <= n; k++) {
    const i = (state.ptr + k) % n;
    if (!state.gone.includes(state.rotation[i])) {
      state.ptr = i;
      return state.rotation[i];
    }
  }
  return null;
}

function finish(state) {
  state.phase = 'done';
  state.endsAt = 0;
}

function nextRound(state, ctx) {
  if (state.round >= state.rounds) return finish(state);
  const target = pickTarget(state, ctx);
  if (!target) return finish(state);
  state.round += 1;
  state.turnNo += 1;
  state.target = target;
  state.turns.push(target);
  state.phase = 'write';
  state.prompt = state.deal();
  state.entries = {};
  state.votes = {};
  state.order = [];
  state.endsAt = ctx.now() + state.writeMs;
  const wr = state.turnNo;
  ctx.later(state.writeMs, () => {
    if (state.phase !== 'write' || state.turnNo !== wr) return;
    openVote(state, ctx);
    ctx.broadcast();
  });
}

function openVote(state, ctx) {
  if (state.phase !== 'write') return;
  const authors = Object.keys(state.entries);
  if (!authors.length) {
    nextRound(state, ctx);
    return;
  }
  state.phase = 'vote';
  state.order = shuffle(authors);
  state.votes = {};
  state.eligibleVoters = voters(ctx, state).length;
  state.endsAt = ctx.now() + state.voteMs;
  const vr = state.turnNo;
  ctx.later(state.voteMs, () => {
    if (state.phase !== 'vote' || state.turnNo !== vr) return;
    reveal(state, ctx);
    ctx.broadcast();
  });
}

function reveal(state, ctx) {
  if (state.phase !== 'vote') return;
  state.phase = 'reveal';
  const { winners } = tally(state.votes);
  const points = {};
  for (const w of winners) {
    points[w] = WIN_POINTS;
    state.scores[w] = (state.scores[w] || 0) + WIN_POINTS;
    ctx.award(w, WIN_POINTS);
  }
  state.last = {
    target: state.target, prompt: state.prompt,
    entries: { ...state.entries }, votes: { ...state.votes }, winners, points,
  };
  state.endsAt = ctx.now() + state.revealMs;
  const rr = state.turnNo;
  ctx.later(state.revealMs, () => {
    if (state.phase !== 'reveal' || state.turnNo !== rr) return;
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
  if (state.phase === 'write' && ctx.now() >= state.endsAt) {
    openVote(state, ctx);
    return;
  }
  if (state.phase === 'vote' && ctx.now() >= state.endsAt) {
    reveal(state, ctx);
    return;
  }
  if (state.phase === 'write') {
    if (typeof a.entry === 'string' && pid !== state.target && !state.entries[pid]) {
      const text = a.entry.trim().slice(0, 280);
      if (text.length >= 2) {
        state.entries[pid] = text;
        if (allIn(writers(ctx, state), state.entries)) openVote(state, ctx);
      }
    }
  } else if (state.phase === 'vote') {
    if (Number.isInteger(a.vote) && a.vote >= 0 && a.vote < state.order.length
        && state.votes[pid] === undefined && state.order[a.vote] !== pid) {
      state.votes[pid] = state.order[a.vote];
      if (allIn(voters(ctx, state), state.votes)) reveal(state, ctx);
    }
  } else if (state.phase === 'reveal' && a.next && (pid === ctx.hostId() || pid === state.target)) {
    // The host, or the round's target, moves on from the reveal.
    nextRound(state, ctx);
  }
}

/* End game: points already given stay; show our own final screen. */
function onEnd(state) {
  finish(state);
}

/* A player left or stayed away. A target who leaves while notes are being
 * written loses the round (it does not count); otherwise stop waiting for
 * their note or vote. With Auto rounds their future turn is dropped. */
function onPlayerGone(state, ctx, pid) {
  if (state.gone.includes(pid)) return;
  state.gone.push(pid);
  if (state.phase === 'done') return;
  const hadTurn = state.turns.includes(pid);
  if (state.phase === 'write' && pid === state.target) {
    state.turns.pop();
    state.round -= 1;
    if (state.autoRounds) state.rounds = Math.max(state.round, state.rounds - 1);
    nextRound(state, ctx);
    return;
  }
  if (!hadTurn && state.autoRounds) state.rounds = Math.max(state.round, state.rounds - 1);
  if (state.phase === 'write') {
    if (Object.keys(state.entries).length && allIn(writers(ctx, state), state.entries)) openVote(state, ctx);
  } else if (state.phase === 'vote') {
    if (allIn(voters(ctx, state), state.votes)) reveal(state, ctx);
  }
}

function view(state, pid, ctx) {
  const { deal, rotation, order, ptr, turns, ...rest } = state;
  const out = { ...rest, hostId: ctx ? ctx.hostId() : state.hostId };
  if (state.phase === 'write') {
    out.entries = {};
    out.submitted = Object.keys(state.entries);
    out.myEntry = state.entries[pid] || null;
  } else if (state.phase === 'vote') {
    out.ballot = state.order.map((author, i) => ({ i, text: state.entries[author] }));
    out.entries = {};
    out.votes = {};
    out.voted = Object.keys(state.votes);
    out.myEntry = state.order.indexOf(pid);
    const mine = state.votes[pid];
    out.myVote = mine === undefined ? null : state.order.indexOf(mine);
  } else {
    out.myEntry = state.entries[pid] || null;
    out.myVote = null;
  }
  return out;
}

module.exports = { id, minPlayers: 3, maxPlayers: 20, manifest, create, onAction, onEnd, onPlayerGone, view };
