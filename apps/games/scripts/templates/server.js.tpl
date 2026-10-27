'use strict';
/* {{NAME}} (Game Kit starter): answer the prompt, vote the best answer,
 * most votes wins the round. Reference for manifests + settings + packs. */

const { dealer, shuffle, allIn } = require('../_sdk');

const id = '{{ID}}';
const ANSWER_MS = 45000;
const VOTE_MS = 25000;
const REVEAL_MS = 6000;

const manifest = {
  __PRESENTATION__
  name: '{{NAME}}',
  tagline: 'Answer fast, vote the best',
  howto: 'Everyone answers the prompt in secret, then votes the best answer. Most votes wins the round.',
  cat: 'vote',
  renderer: 'dom',
  realtime: false,
  players: { min: 3, max: 12 },
  settings: [
    { key: 'rounds', label: 'Rounds', type: 'int', min: 1, max: 6, def: 3 },
  ],
  packs: {
    prompts: { label: 'Custom prompts', type: 'string[]', minItems: 5, maxItems: 200, maxLen: 140 },
  },
};

function create(ctx) {
  const pack = ctx.content(id);
  const prompts = pack.prompts && pack.prompts.length ? pack.prompts : ['Say something clever'];
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? 3,
    phase: 'answer', // answer -> vote -> reveal -> done
    prompt: '',
    answers: {}, // pid -> text (secret until vote)
    options: [], // [{aid, pid, text}] shuffled at vote time
    votes: {}, // voterPid -> aid
    last: null,
    scores: {},
    endsAt: 0,
  };
  state.deal = dealer(prompts);
  nextRound(state, ctx);
  return state;
}

function nextRound(state, ctx) {
  if (state.round >= state.rounds) {
    state.phase = 'done';
    state.endsAt = 0;
    return;
  }
  state.round += 1;
  state.prompt = state.deal();
  state.answers = {};
  state.options = [];
  state.votes = {};
  state.phase = 'answer';
  state.endsAt = ctx.now() + ANSWER_MS;
  ctx.later(ANSWER_MS, () => {
    if (state.phase !== 'answer') return;
    startVote(state, ctx);
    ctx.broadcast();
  });
}

function startVote(state, ctx) {
  const entries = Object.keys(state.answers);
  if (!entries.length) {
    state.phase = 'reveal';
    state.last = { prompt: state.prompt, options: [], winners: [], skipped: true };
    ctx.later(REVEAL_MS, () => {
      if (state.phase !== 'reveal') return;
      nextRound(state, ctx);
      ctx.broadcast();
    });
    return;
  }
  state.options = shuffle(entries.map((pid, i) => ({ aid: 'a' + i, pid, text: state.answers[pid] })));
  state.phase = 'vote';
  state.votes = {};
  state.endsAt = ctx.now() + VOTE_MS;
  ctx.later(VOTE_MS, () => {
    if (state.phase !== 'vote') return;
    reveal(state, ctx);
    ctx.broadcast();
  });
}

function reveal(state, ctx) {
  if (state.phase !== 'vote') return;
  state.phase = 'reveal';
  state.endsAt = 0;
  const counts = {};
  for (const aid of Object.values(state.votes)) counts[aid] = (counts[aid] || 0) + 1;
  let best = 0;
  const winners = [];
  for (const o of state.options) {
    const n = counts[o.aid] || 0;
    if (n > 0) {
      state.scores[o.pid] = (state.scores[o.pid] || 0) + n * 50;
      ctx.award(o.pid, n * 50);
    }
    if (n > best) {
      best = n;
      winners.length = 0;
      winners.push(o.aid);
    } else if (n === best && n > 0) {
      winners.push(o.aid);
    }
  }
  for (const aid of winners) {
    const o = state.options.find((x) => x.aid === aid);
    if (o) {
      state.scores[o.pid] = (state.scores[o.pid] || 0) + 100;
      ctx.award(o.pid, 100);
    }
  }
  state.last = {
    prompt: state.prompt,
    winners,
    options: state.options.map((o) => ({ aid: o.aid, pid: o.pid, text: o.text, n: counts[o.aid] || 0 })),
  };
  ctx.later(REVEAL_MS, () => {
    if (state.phase !== 'reveal') return;
    nextRound(state, ctx);
    ctx.broadcast();
  });
}

function onAction(state, ctx, pid, a) {
  if (!a || typeof a !== 'object') return;
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
      const eligible = ctx.players().filter((p) => state.options.some((x) => x.pid !== p.id));
      if (eligible.length && eligible.every((p) => state.votes[p.id] !== undefined)) reveal(state, ctx);
    }
  }
}

function view(state, pid) {
  const { deal, ...rest } = state;
  const out = { ...rest };
  if (state.phase === 'answer') {
    out.answers = {};
    out.submitted = Object.keys(state.answers);
    out.myAnswer = state.answers[pid] || '';
    out.options = [];
    out.votes = {};
  } else if (state.phase === 'vote') {
    out.answers = {};
    out.options = state.options.map((o) => ({ aid: o.aid, text: o.text }));
    out.myVote = state.votes[pid] === undefined ? null : state.votes[pid];
    out.votes = {};
    out.voted = Object.keys(state.votes);
  } else {
    out.myVote = state.votes[pid] === undefined ? null : state.votes[pid];
  }
  return out;
}

module.exports = { id, minPlayers: 3, maxPlayers: 12, manifest, create, onAction, view };
