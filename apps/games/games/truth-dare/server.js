'use strict';
/* Truth or Dare: the target picks a deck + truth/dare. Prompt style deals
 * a card, lets the others pick from a pool, or asks them to write first.
 * Everyone except the target then judges juicy/not (truth) or done/failed.
 *
 * Points per round (specs/GAME_RULES_STANDARD.md): a "yes" majority gives
 * the target 100 plus a streak extra (+25 per consecutive success, at most
 * +100); an even split is half credit (50) for the target. Voters on the
 * winning side of a clear verdict get 25. No votes: no verdict, no points. */

const { dealer, shuffle, roundsSetting, paceSetting, paced } = require('../_sdk');

const id = 'truth-dare';

const manifest = {
  howto: 'Play with 2–20 people. The spinner picks a player, who chooses a deck and Truth or Dare, or Spin for me. Prompt style sets how the prompt is picked: Random card deals one, Room pool vote offers 3 cards (4 with 5 or more players), Ask your own lets the others write, and Mixed picks a style each round. Only the other players pick the prompt and judge the result. Prompt votes give no points. Tied prompt votes are settled randomly; no prompt votes means a random option. A single written prompt is used directly; no writing means a random card. A yes majority earns 100 plus a streak bonus of 25 per extra success, up to 100 extra. An even judging split earns 50; no votes earns zero. Voters on the winning side earn 25. With two people, the other player alone decides. All steps have timers.',
  guide: {
    goal: "Win the room's yes vote on your truths and dares.",
    tips: [
      'Random card deals one; Room pool vote lets the others pick from 3–4 cards.',
      'Ask your own: others write, then pick. No writing? A random card.',
      'Mixed picks a style each round. With 2 people, the other player decides.',
      'Yes: 100, +25 per extra success (max +100). Split: 50. No or no votes: 0.',
      'Winning judges get 25. Prompt votes give no points. Timers move play on.',
    ],
  },
  players: { min: 2, max: 20 },
  settings: [
    roundsSetting({ def: null, autoLabel: 'Auto (one per player)' }),
    paceSetting(),
    { key: 'promptStyle', label: 'Prompt style', type: 'enum',
      options: ['Random card', 'Room pool vote', 'Ask your own', 'Mixed'], def: 'Random card' },
  ],
};
const DECKS = ['classic', 'funny', 'wild'];
// Every timer is scaled by Pace.
const SPIN_SECONDS = 4;
const CHOOSE_SECONDS = 20;
const COMPOSE_SECONDS = 40;
const PROMPT_VOTE_SECONDS = 25;
const PROMPT_LIMIT = 180;
const PROMPT_STYLES = ['Random card', 'Room pool vote', 'Ask your own'];
const PERFORM_SECONDS = 60;
const VOTE_SECONDS = 25;
const REVEAL_SECONDS = 8;
const WIN_POINTS = 100;
const HALF_POINTS = 50;
const STREAK_STEP = 25;
const STREAK_CAP = 100;
const VOTER_POINTS = 25;

const FALLBACK_TRUTH = ['Tell the group an embarrassing story.', 'What is your secret talent?',
  'What is the funniest dream you remember?', 'What always makes you laugh?'];
const FALLBACK_DARE = ['Do 10 jumping jacks right now.', 'Do your best animal impression.',
  'Sing a line like an opera singer.', 'Give a dramatic weather report for this room.'];

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
    promptStyle: [...PROMPT_STYLES, 'Mixed'].includes(s.promptStyle) ? s.promptStyle : 'Random card',
    roundStyle: null,
    turns: [], // targets who had their turn in this pass of the rotation
    gone: [], // players who left or stayed away
    phase: 'spin', // choose -> [compose -> prompt-vote] -> perform -> vote -> reveal
    target: null,
    deck: 'classic',
    kind: null,
    prompt: null,
    votes: {},
    options: [],
    promptVotes: {},
    entries: {},
    errors: {},
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
  if (ids.size < 2) return onEnd(state);
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
  state.options = [];
  state.promptVotes = {};
  state.entries = {};
  state.errors = {};
  state.roundStyle = state.promptStyle === 'Mixed'
    ? PROMPT_STYLES[Math.floor(Math.random() * PROMPT_STYLES.length)] : state.promptStyle;
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
  beginPrompt(state, ctx);
  ctx.broadcast();
}

function others(state, ctx) {
  return ctx.players().filter((p) => p.id !== state.target && !state.gone.includes(p.id));
}

/* New input phases share the same deadline and stale-timer guard. */
function promptTimer(state, ctx, phase, seconds, finish) {
  state.phase = phase;
  const ms = paced(ctx, seconds) * 1000;
  state.endsAt = ctx.now() + ms;
  const r = state.round;
  ctx.later(ms, () => {
    if (state.phase !== phase || state.round !== r) return;
    finish(state, ctx);
    ctx.broadcast();
  });
}

function beginPrompt(state, ctx) {
  if (state.roundStyle === 'Ask your own') {
    promptTimer(state, ctx, 'compose', COMPOSE_SECONDS, finishCompose);
    if (!others(state, ctx).length) finishCompose(state, ctx);
  } else if (state.roundStyle === 'Room pool vote') {
    const count = ctx.players().filter((p) => !state.gone.includes(p.id)).length >= 5 ? 4 : 3;
    const options = new Set();
    // A short locale pack must not produce duplicate choices or loop forever.
    for (let i = 0; i < count * 2 && options.size < count; i++) {
      options.add(state.deals[state.kind][state.deck]());
    }
    for (const text of state.kind === 'truth' ? FALLBACK_TRUTH : FALLBACK_DARE) {
      if (options.size >= count) break;
      options.add(text);
    }
    state.options = [...options];
    beginPromptVote(state, ctx);
  } else {
    setPrompt(state, ctx);
  }
}

function finishCompose(state, ctx) {
  if (state.phase !== 'compose') return;
  state.options = shuffle([...new Set(Object.values(state.entries))]);
  if (state.options.length > 1) beginPromptVote(state, ctx);
  else setPrompt(state, ctx, state.options[0]);
}

function beginPromptVote(state, ctx) {
  state.promptVotes = {};
  promptTimer(state, ctx, 'prompt-vote', PROMPT_VOTE_SECONDS, finishPromptVote);
  if (!others(state, ctx).length) finishPromptVote(state, ctx);
}

function finishPromptVote(state, ctx) {
  if (state.phase !== 'prompt-vote') return;
  const counts = state.options.map((_, i) => Object.values(state.promptVotes).filter((v) => v === i).length);
  const top = Math.max(...counts);
  const tied = state.options.filter((_, i) => counts[i] === top);
  setPrompt(state, ctx, tied[Math.floor(Math.random() * tied.length)]);
}

function setPrompt(state, ctx, prompt) {
  state.prompt = prompt || state.deals[state.kind][state.deck]();
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
  return typeof pid === 'string' && ctx.players().some((p) => p.id === pid);
}

function onAction(state, ctx, pid, a) {
  if (!a || typeof a !== 'object') return;
  if (!knownPid(ctx, pid) || state.gone.includes(pid)) return;
  // Close expired input before a delayed timer can admit it.
  if (state.phase === 'choose' && ctx.now() >= state.endsAt) {
    autoChoose(state, ctx, state.round);
    return;
  }
  if (state.phase === 'perform' && ctx.now() >= state.endsAt) {
    beginVote(state, ctx);
    return;
  }
  if (state.phase === 'compose' && ctx.now() >= state.endsAt) {
    finishCompose(state, ctx);
    return;
  }
  if (state.phase === 'prompt-vote' && ctx.now() >= state.endsAt) {
    finishPromptVote(state, ctx);
    return;
  }
  if (state.phase === 'vote' && ctx.now() >= state.endsAt) {
    reveal(state, ctx);
    return;
  }
  if (state.phase === 'choose' && pid === state.target && a.deck && a.kind) {
    if (DECKS.includes(a.deck) && ['truth', 'dare', 'random'].includes(a.kind)) {
      state.deck = a.deck;
      state.kind = a.kind === 'random' ? (Math.random() < 0.5 ? 'truth' : 'dare') : a.kind;
      beginPrompt(state, ctx);
    }
    return;
  }
  if (state.phase === 'compose' && pid !== state.target && typeof a.entry === 'string' && !state.entries[pid]) {
    const text = a.entry.replace(/\s+/gu, ' ').trim();
    // No shared profanity/text-safety helper exists here. Apply the same
    // local length/blank boundary as the other writing games; escape in UI.
    if (text.length < 2 || a.entry.length > PROMPT_LIMIT) {
      state.errors[pid] = `Write 2–${PROMPT_LIMIT} characters.`;
      return;
    }
    state.entries[pid] = text;
    delete state.errors[pid];
    if (others(state, ctx).every((p) => state.entries[p.id])) finishCompose(state, ctx);
    return;
  }
  if (state.phase === 'prompt-vote' && pid !== state.target && Number.isInteger(a.promptVote)
      && a.promptVote >= 0 && a.promptVote < state.options.length && state.promptVotes[pid] === undefined) {
    state.promptVotes[pid] = a.promptVote;
    if (others(state, ctx).every((p) => state.promptVotes[p.id] !== undefined)) finishPromptVote(state, ctx);
    return;
  }
  if (state.phase === 'perform' && pid === state.target && a.ready === true) {
    beginVote(state, ctx);
    return;
  }
  if (state.phase === 'vote' && (a.vote === 'yes' || a.vote === 'no')
      && pid !== state.target && !state.votes[pid]) {
    state.votes[pid] = a.vote;
    const voters = others(state, ctx);
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
  if (pid === state.target && ['spin', 'choose', 'compose', 'prompt-vote', 'perform'].includes(state.phase)) {
    nextRound(state, ctx);
    return;
  }
  if (state.phase === 'compose' && others(state, ctx).every((p) => state.entries[p.id])) finishCompose(state, ctx);
  if (state.phase === 'prompt-vote' && others(state, ctx).every((p) => state.promptVotes[p.id] !== undefined)) finishPromptVote(state, ctx);
  if (state.phase === 'vote') {
    const voters = others(state, ctx);
    if (voters.every((p) => state.votes[p.id] !== undefined)) reveal(state, ctx);
  }
}

function view(state, pid, ctx) {
  const { deals, rotation, turns, gone, auto, entries, errors, promptVotes, ...rest } = state;
  const out = { ...rest, hostId: ctx ? ctx.hostId() : state.hostId, myVote: state.votes[pid] || null,
    myEntry: entries[pid] || null, myError: errors[pid] || null, promptLimit: PROMPT_LIMIT,
    submitted: Object.keys(entries), promptVoted: Object.keys(promptVotes), myPromptVote: promptVotes[pid] ?? null };
  if (state.phase === 'vote') {
    out.votes = {};
    out.voted = Object.keys(state.votes);
  }
  return out;
}

module.exports = { id, minPlayers: 2, maxPlayers: 20, manifest, create, onAction, onEnd, onPlayerGone, view };
