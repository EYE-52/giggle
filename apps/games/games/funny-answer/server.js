'use strict';
/* Funny Answer: everyone secretly answers the same prompt, answers are
 * revealed anonymously, and each player votes the funniest — never their
 * own. Authors earn 50 per vote (at most 100) and the funniest answer earns
 * 100 more; tied answers all count as funniest. */

const { dealer, shuffle, tally, allIn, roundsSetting, paceSetting, pacedMs } = require('../_sdk');

const id = 'funny-answer';
const VOTE_S = 25;
const REVEAL_S = 8;
const VOTE_POINTS = 50;
const VOTE_MAX = 100;
const WIN_POINTS = 100;

const manifest = {
  name: 'Punchline',
  tagline: 'Funniest answer takes the round',
  howto: 'Answer the prompt secretly, then vote for the funniest answer (not your own). Each vote is worth 50 (up to 100) and the funniest answer earns 100 more.',
  cat: 'bluff',
  renderer: 'dom',
  realtime: false,
  players: { min: 3, max: 20 },
  settings: [
    roundsSetting({ def: 6 }),
    paceSetting(),
    { key: 'answerSeconds', label: 'Seconds to answer', type: 'int', min: 10, max: 180, def: 45 },
  ],
  packs: {
    prompts: { label: 'Custom prompts', type: 'string[]', minItems: 5, maxItems: 200, maxLen: 140 },
  },
};

function create(ctx) {
  const pack = ctx.content(id);
  const prompts = pack.prompts && pack.prompts.length ? pack.prompts : ['Say something funny'];
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? 6,
    answerMs: (s.answerSeconds ?? 45) * 1000,
    voteMs: pacedMs(s, VOTE_S),
    revealMs: pacedMs(s, REVEAL_S),
    phase: 'answer', // answer -> vote -> reveal -> done
    prompt: '',
    answers: {}, // pid -> text (secret until vote)
    options: [], // [{aid, pid, text}] shuffled at vote time
    votes: {}, // voterPid -> aid
    last: null,
    scores: {},
    endsAt: 0,
    hostId: ctx.hostId(),
  };
  state.deal = dealer(prompts);
  nextRound(state, ctx);
  return state;
}

function finish(state) {
  state.phase = 'done';
  state.endsAt = 0;
}

function nextRound(state, ctx) {
  if (state.round >= state.rounds) return finish(state);
  state.round += 1;
  state.prompt = state.deal();
  state.answers = {};
  state.options = [];
  state.votes = {};
  state.phase = 'answer';
  state.endsAt = ctx.now() + state.answerMs;
  const ar = state.round;
  ctx.later(state.answerMs, () => {
    if (state.phase !== 'answer' || state.round !== ar) return;
    startVote(state, ctx);
    ctx.broadcast();
  });
}

function startVote(state, ctx) {
  if (state.phase !== 'answer') return;
  const entries = Object.keys(state.answers);
  if (!entries.length) {
    state.phase = 'reveal';
    state.endsAt = 0; // the reveal shows no clock; Next or the paced timer moves on
    state.last = { prompt: state.prompt, options: [], winners: [], points: {}, skipped: true };
    const sr = state.round;
    ctx.later(state.revealMs, () => {
      if (state.phase !== 'reveal' || state.round !== sr) return;
      nextRound(state, ctx);
      ctx.broadcast();
    });
    return;
  }
  state.options = shuffle(entries.map(pid => ({ pid, text: state.answers[pid] })))
    .map((entry, i) => ({ ...entry, aid: 'a' + i }));
  state.phase = 'vote';
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
  for (const aid of Object.values(state.votes)) counts[aid] = (counts[aid] || 0) + 1;
  // Every tied winner gets the same points: equal votes, equal bonus.
  const points = {};
  for (const o of state.options) {
    const n = counts[o.aid] || 0;
    let pts = Math.min(VOTE_MAX, n * VOTE_POINTS);
    if (winners.includes(o.aid)) pts += WIN_POINTS;
    if (pts) points[o.pid] = (points[o.pid] || 0) + pts;
  }
  for (const pid of Object.keys(points)) score(state, ctx, pid, points[pid]);
  state.last = {
    prompt: state.prompt,
    winners,
    options: state.options.map((o) => ({ aid: o.aid, pid: o.pid, text: o.text, n: counts[o.aid] || 0 })),
    votes: { ...state.votes },
    points,
  };
  state.endsAt = 0; // the reveal shows no clock; Next or the paced timer moves on
  const rr = state.round;
  ctx.later(state.revealMs, () => {
    if (state.phase !== 'reveal' || state.round !== rr) return;
    nextRound(state, ctx);
    ctx.broadcast();
  });
}

function maybeReveal(state, ctx) {
  if (state.phase !== 'vote') return;
  const eligible = ctx.players().filter((p) => state.options.some((x) => x.pid !== p.id));
  if (eligible.every((p) => state.votes[p.id] !== undefined)) reveal(state, ctx);
}

function knownPid(ctx, pid) {
  return typeof pid === 'string' && ctx.allPlayers().some((p) => p.id === pid);
}

function onAction(state, ctx, pid, a) {
  if (!a || typeof a !== 'object') return;
  if (!knownPid(ctx, pid)) return;
  // Close expired input before a delayed timer can admit it.
  if (state.phase === 'answer' && ctx.now() >= state.endsAt) {
    startVote(state, ctx);
    return;
  }
  if (state.phase === 'vote' && ctx.now() >= state.endsAt) {
    reveal(state, ctx);
    return;
  }
  if (state.phase === 'answer' && typeof a.answer === 'string') {
    const t = a.answer.trim().slice(0, 120);
    if (t.length >= 1) {
      state.answers[pid] = t;
      if (allIn(ctx.players(), state.answers)) startVote(state, ctx);
    }
    return;
  }
  if (state.phase === 'vote' && typeof a.vote === 'string' && state.votes[pid] === undefined) {
    const o = state.options.find((x) => x.aid === a.vote);
    if (o && o.pid !== pid) {
      state.votes[pid] = a.vote;
      maybeReveal(state, ctx);
    }
    return;
  }
  if (state.phase === 'reveal' && a.next && pid === ctx.hostId()) {
    nextRound(state, ctx);
  }
}

/* End game: points already given stay; show our own final screen. */
function onEnd(state) {
  finish(state);
}

/* A player left or stayed away: stop waiting for their answer or vote. */
function onPlayerGone(state, ctx) {
  if (state.phase === 'answer') {
    if (Object.keys(state.answers).length && allIn(ctx.players(), state.answers)) startVote(state, ctx);
  } else if (state.phase === 'vote') {
    maybeReveal(state, ctx);
  }
}

function view(state, pid, ctx) {
  const { deal, ...rest } = state;
  const out = { ...rest, hostId: ctx ? ctx.hostId() : state.hostId };
  if (state.phase === 'answer') {
    out.answers = {};
    out.submitted = Object.keys(state.answers);
    out.myAnswer = state.answers[pid] || '';
    out.options = [];
    out.votes = {};
  } else if (state.phase === 'vote') {
    out.answers = {};
    out.options = state.options.map((o) => ({ aid: o.aid, text: o.text }));
    out.myEntry = state.options.find((o) => o.pid === pid)?.aid || null;
    out.myVote = state.votes[pid] === undefined ? null : state.votes[pid];
    out.votes = {};
    out.voted = Object.keys(state.votes);
  } else {
    out.myVote = state.votes[pid] === undefined ? null : state.votes[pid];
  }
  return out;
}

module.exports = { id, minPlayers: 3, maxPlayers: 20, manifest, create, onAction, onEnd, onPlayerGone, view };
