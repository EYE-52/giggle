'use strict';
/* Roast Toast: each round names a target, everyone else writes one friendly
 * roast line. The room votes the funniest (100 to the room favorite; tied
 * favorites all earn 100) and the target crowns a favorite (100 more).
 * Friendly fire only — roast the habit, love the human. */

const { dealer, tally, allIn, shuffle, roundsSetting, paceSetting, pacedMs } = require('../_sdk');

const id = 'roast-toast';

const manifest = {
  howto: 'Write a friendly roast for the target. Vote on anonymous entries except your own. The room favorite earns 100 points; the target’s favorite earns 100 more.',
  players: { min: 3, max: 20 },
  settings: [
    roundsSetting({ def: null, autoLabel: 'Auto (one per player)' }),
    paceSetting(),
    { key: 'writeSeconds', label: 'Seconds to write', type: 'int', min: 15, max: 180, def: 60 },
  ],
  packs: {
    starters: { label: 'Custom starters', type: 'string[]', minItems: 3 },
  },
};
const VOTE_S = 30;
const REVEAL_S = 8;
const WIN_POINTS = 100;
const PICK_POINTS = 100;

function create(ctx) {
  const pack = ctx.content(id);
  const starters = pack.starters && pack.starters.length ? pack.starters : ['Your style reminds me of...'];
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
    tagline: typeof pack.tagline === 'string' ? pack.tagline : '',
    target: null,
    starter: null,
    entries: {},
    votes: {},
    pick: null,
    order: [],
    last: null,
    scores: {},
    endsAt: 0,
    hostId: ctx.hostId(),
    turnNo: 0,
    gone: [],
  };
  state.deal = dealer(starters);
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
  return writers(ctx, state).filter((p) => state.order.some((author) => author !== p.id));
}

/* Is the target still here to crown a favorite? */
function targetPresent(ctx, state) {
  return ctx.players().some((p) => p.id === state.target);
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
  state.starter = state.deal();
  state.entries = {};
  state.votes = {};
  state.pick = null;
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
  state.pick = null;
  state.eligibleVoters = voters(ctx, state).length;
  state.endsAt = ctx.now() + state.voteMs;
  const vr = state.turnNo;
  ctx.later(state.voteMs, () => {
    if (state.phase !== 'vote' || state.turnNo !== vr) return;
    reveal(state, ctx);
    ctx.broadcast();
  });
}

/* Reveal once every voter voted and the target crowned a favorite (or
 * the target is no longer here to do it). */
function maybeReveal(state, ctx) {
  if (state.phase !== 'vote') return;
  if ((state.pick !== null || !targetPresent(ctx, state)) && allIn(voters(ctx, state), state.votes)) reveal(state, ctx);
}

function reveal(state, ctx) {
  if (state.phase !== 'vote') return;
  state.phase = 'reveal';
  const { winners } = tally(state.votes);
  const points = {};
  for (const w of winners) points[w] = WIN_POINTS;
  if (state.pick !== null) points[state.pick] = (points[state.pick] || 0) + PICK_POINTS;
  for (const pid of Object.keys(points)) {
    state.scores[pid] = (state.scores[pid] || 0) + points[pid];
    ctx.award(pid, points[pid]);
  }
  state.last = {
    target: state.target, starter: state.starter,
    entries: { ...state.entries }, votes: { ...state.votes },
    pick: state.pick, roomFave: winners, points,
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
      const text = a.entry.trim().slice(0, 140);
      if (text.length >= 2) {
        state.entries[pid] = text;
        if (allIn(writers(ctx, state), state.entries)) openVote(state, ctx);
      }
    }
  } else if (state.phase === 'vote') {
    if (pid === state.target) {
      if (Number.isInteger(a.pick) && a.pick >= 0 && a.pick < state.order.length && state.pick === null) {
        state.pick = state.order[a.pick];
        maybeReveal(state, ctx);
      }
    } else if (Number.isInteger(a.vote) && a.vote >= 0 && a.vote < state.order.length
        && state.votes[pid] === undefined && state.order[a.vote] !== pid) {
      state.votes[pid] = state.order[a.vote];
      maybeReveal(state, ctx);
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

/* A player left or stayed away. A target who leaves while roasts are being
 * written loses the round (it does not count); otherwise stop waiting for
 * their roast, vote or crown. With Auto rounds their future turn is dropped. */
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
    maybeReveal(state, ctx);
  }
}

function view(state, pid, ctx) {
  const { deal, rotation, order, ptr, turns, pick, ...rest } = state;
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
    out.myPick = pid === state.target && state.pick !== null ? state.order.indexOf(state.pick) : null;
    out.picked = state.pick !== null;
  } else {
    out.myEntry = state.entries[pid] || null;
    out.myVote = null;
    out.myPick = null;
  }
  return out;
}

module.exports = { id, minPlayers: 3, maxPlayers: 20, manifest, create, onAction, onEnd, onPlayerGone, view };
