'use strict';
/* Truth or Dare: spinner lands on a player, they pick a deck + truth/dare
 * from the locale pack, everyone else votes juicy/not (truth) or
 * done/failed (dare).
 *
 * Points per round (specs/GAME_RULES_STANDARD.md): a "yes" majority gives
 * the target 100 plus a streak extra (+25 per consecutive success, at most
 * +100); an even split is half credit (50) for the target. Voters on the
 * winning side of a clear verdict get 25. No votes: no verdict, no points. */

const { dealer, shuffle, roundsSetting, paceSetting, paced } = require('../_sdk');

const id = 'truth-dare';

const manifest = {
  players: { min: 3, max: 20 },
  settings: [
    roundsSetting({ def: null, autoLabel: 'Auto (one per player)' }),
    paceSetting(),
  ],
};
const DECKS = ['classic', 'funny', 'wild'];
// Every timer is scaled by Pace.
const SPIN_SECONDS = 4;
const CHOOSE_SECONDS = 20;
const PERFORM_SECONDS = 60;
const VOTE_SECONDS = 25;
const REVEAL_SECONDS = 8;
const WIN_POINTS = 100;
const HALF_POINTS = 50;
const STREAK_STEP = 25;
const STREAK_CAP = 100;
const VOTER_POINTS = 25;

const FALLBACK_TRUTH = ['Tell the group an embarrassing story.'];
const FALLBACK_DARE = ['Do 10 jumping jacks right now.'];

function addScore(state, ctx, pid, pts) {
  state.scores[pid] = (state.scores[pid] || 0) + pts;
  ctx.award(pid, pts);
}

function create(ctx) {
  const pack = ctx.content(id) || {};
  const ps = ctx.allPlayers();
  const deals = {};
  for (const kind of ['truth', 'dare']) {
    deals[kind] = {};
    const src = pack[kind + 's'] || {};
    for (const d of DECKS) {
      const list = Array.isArray(src[d]) && src[d].length
        ? src[d]
        : (kind === 'truth' ? FALLBACK_TRUTH : FALLBACK_DARE);
      deals[kind][d] = dealer(list);
    }
  }
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? Math.max(1, ps.length),
    auto: s.rounds == null, // one turn per player; shrinks when a player leaves first
    turns: [], // targets who had their turn in this pass of the rotation
    gone: [], // players who left or stayed away
    phase: 'spin', // spin -> choose -> perform -> vote -> reveal -> done
    target: null,
    deck: 'classic',
    kind: null,
    prompt: null,
    votes: {},
    scores: {},
    streaks: {},
    last: null,
    endsAt: 0,
    hostId: ctx.hostId(),
    labels: pack.labels || {},
  };
  state.deals = deals;
  state.rotation = shuffle(ps.map((p) => p.id));
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
  const ps = ctx.allPlayers();
  if (!ps.length) {
    state.phase = 'done';
    state.endsAt = 0;
    return;
  }
  const ids = new Set(ps.map((p) => p.id).filter((pid) => !state.gone.includes(pid)));
  state.rotation = state.rotation.filter((pid) => ids.has(pid));
  for (const pid of ids) if (!state.rotation.includes(pid)) state.rotation.push(pid);
  if (!state.rotation.length) {
    state.phase = 'done';
    state.endsAt = 0;
    return;
  }
  let pool = state.rotation.filter((pid) => !state.turns.includes(pid));
  if (!pool.length) {
    state.turns = [];
    pool = state.rotation.slice();
  }
  state.target = pool[0];
  state.turns.push(state.target);
  state.deck = 'classic';
  state.kind = null;
  state.prompt = null;
  state.votes = {};
  state.last = null;
  state.phase = 'spin';
  const spinMs = paced(ctx, SPIN_SECONDS) * 1000;
  state.endsAt = ctx.now() + spinMs;
  const r = state.round;
  ctx.later(spinMs, () => {
    if (state.phase !== 'spin' || state.round !== r) return;
    state.phase = 'choose';
    const chooseMs = paced(ctx, CHOOSE_SECONDS) * 1000;
    state.endsAt = ctx.now() + chooseMs;
    ctx.later(chooseMs, () => autoChoose(state, ctx, r));
    ctx.broadcast();
  });
}

function autoChoose(state, ctx, r) {
  if (state.phase !== 'choose' || state.round !== r) return;
  state.deck = DECKS[Math.floor(Math.random() * DECKS.length)];
  state.kind = Math.random() < 0.5 ? 'truth' : 'dare';
  setPrompt(state, ctx);
  ctx.broadcast();
}

function setPrompt(state, ctx) {
  state.prompt = state.deals[state.kind][state.deck]();
  state.phase = 'perform';
  const performMs = paced(ctx, PERFORM_SECONDS) * 1000;
  state.endsAt = ctx.now() + performMs;
  const r = state.round;
  ctx.later(performMs, () => {
    if (state.phase !== 'perform' || state.round !== r) return;
    beginVote(state, ctx);
    ctx.broadcast();
  });
}

function beginVote(state, ctx) {
  state.phase = 'vote';
  state.votes = {};
  const voteMs = paced(ctx, VOTE_SECONDS) * 1000;
  state.endsAt = ctx.now() + voteMs;
  const r = state.round;
  ctx.later(voteMs, () => {
    if (state.phase !== 'vote' || state.round !== r) return;
    reveal(state, ctx);
    ctx.broadcast();
  });
}

function reveal(state, ctx) {
  if (state.phase !== 'vote') return;
  state.phase = 'reveal';
  let yes = 0;
  let no = 0;
  for (const pid of Object.keys(state.votes)) {
    if (state.votes[pid] === 'yes') yes += 1;
    else no += 1;
  }
  const t = state.target;
  const voterPts = {};
  let targetPts = 0;
  let verdict = 'none';
  if (yes + no === 0) {
    state.streaks[t] = 0;
  } else if (yes > no) {
    verdict = 'yes';
    state.streaks[t] = (state.streaks[t] || 0) + 1;
    targetPts = WIN_POINTS + Math.min(STREAK_CAP, (state.streaks[t] - 1) * STREAK_STEP);
  } else if (yes === no) {
    verdict = 'split';
    state.streaks[t] = 0;
    targetPts = HALF_POINTS;
  } else {
    verdict = 'no';
    state.streaks[t] = 0;
  }
  if (verdict === 'yes' || verdict === 'no') {
    for (const pid of Object.keys(state.votes)) {
      if (state.votes[pid] === verdict) {
        voterPts[pid] = VOTER_POINTS;
        addScore(state, ctx, pid, VOTER_POINTS);
      }
    }
  }
  if (targetPts) addScore(state, ctx, t, targetPts);
  state.last = {
    target: t,
    deck: state.deck,
    kind: state.kind,
    prompt: state.prompt,
    yes,
    no,
    votes: { ...state.votes },
    targetPts,
    voterPts,
    verdict,
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
  if (state.phase === 'choose' && ctx.now() >= state.endsAt) {
    autoChoose(state, ctx, state.round);
    return;
  }
  if (state.phase === 'perform' && ctx.now() >= state.endsAt) {
    beginVote(state, ctx);
    return;
  }
  if (state.phase === 'vote' && ctx.now() >= state.endsAt) {
    reveal(state, ctx);
    return;
  }
  if (state.phase === 'choose' && pid === state.target && a.deck && a.kind) {
    if (DECKS.includes(a.deck) && (a.kind === 'truth' || a.kind === 'dare')) {
      state.deck = a.deck;
      state.kind = a.kind;
      setPrompt(state, ctx);
    }
    return;
  }
  if (state.phase === 'perform' && pid === state.target && a.ready === true) {
    beginVote(state, ctx);
    return;
  }
  if (state.phase === 'vote' && (a.vote === 'yes' || a.vote === 'no')
      && pid !== state.target && !state.votes[pid]) {
    state.votes[pid] = a.vote;
    const voters = ctx.players().filter((p) => p.id !== state.target);
    if (voters.length && voters.every((p) => state.votes[p.id] !== undefined)) {
      reveal(state, ctx);
    }
    return;
  }
  // The host or the round's target can move on from the reveal.
  if (state.phase === 'reveal' && a.next && (pid === ctx.hostId() || pid === state.target)) {
    nextRound(state, ctx);
  }
}

/* End game: points already awarded stay; show the game's own final screen. */
function onEnd(state) {
  state.phase = 'done';
  state.endsAt = 0;
}

/* A player who left or stayed away: skip their turn, stop waiting for
 * their vote. With Auto rounds their turn no longer counts. */
function onPlayerGone(state, ctx, pid) {
  if (state.gone.includes(pid)) return;
  state.gone.push(pid);
  if (state.auto && !state.turns.includes(pid)) state.rounds = Math.max(state.round, state.rounds - 1);
  if (pid === state.target && ['spin', 'choose', 'perform'].includes(state.phase)) {
    nextRound(state, ctx);
    return;
  }
  if (state.phase === 'vote') {
    const voters = ctx.players().filter((p) => p.id !== state.target);
    if (voters.every((p) => state.votes[p.id] !== undefined)) reveal(state, ctx);
  }
}

function view(state, pid, ctx) {
  const { deals, rotation, turns, gone, auto, ...rest } = state;
  const out = { ...rest, hostId: ctx ? ctx.hostId() : state.hostId, myVote: state.votes[pid] || null };
  if (state.phase === 'vote') {
    out.votes = {};
    out.voted = Object.keys(state.votes);
  }
  return out;
}

module.exports = { id, minPlayers: 3, maxPlayers: 20, manifest, create, onAction, onEnd, onPlayerGone, view };
