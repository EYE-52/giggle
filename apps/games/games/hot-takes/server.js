'use strict';
/* Hot Takes: everyone submits a take, then each take is voted
 * agree/disagree with the author hidden. Each round, the most divisive
 * take (closest to 50/50) scores its submitter.
 *
 * Points per round (specs/GAME_RULES_STANDARD.md): most divisive take 100,
 * next most divisive 50, plus 5 for every vote a take drew (at most +100).
 * Equal splits share the place: every tied author gets the same points. */

const { dealer, shuffle, roundsSetting, paceSetting, paced } = require('../_sdk');
const { randomUUID } = require('node:crypto');

const id = 'hot-takes';

const manifest = {
  players: { min: 3, max: 20 },
  settings: [
    roundsSetting({ def: 1 }),
    paceSetting(),
    { key: 'submitSeconds', label: 'Seconds to write', type: 'int', min: 15, max: 120, def: 45 },
    { key: 'voteSeconds', label: 'Seconds to vote', type: 'int', min: 5, max: 60, def: 20 },
  ],
  packs: {
    seeds: { label: 'Backup takes', type: 'string[]', minItems: 3 },
    starters: { label: 'Starter ideas', type: 'string[]', minItems: 3 },
  },
};
const REVEAL_SECONDS = 6;
const STANDINGS_SECONDS = 8;
const MAX_TAKE = 140;
const WIN_POINTS = 100;
const RUNNER_UP_POINTS = 50;
const PER_VOTE = 5;
const VOTE_CAP = 100;

const FALLBACK_SEEDS = ['Hot take: this game night is the best one yet.'];

function addScore(state, ctx, pid, pts) {
  state.scores[pid] = (state.scores[pid] || 0) + pts;
  ctx.award(pid, pts);
}

function currentTid(state) {
  return state.order[state.index];
}

function currentTake(state) {
  const tid = currentTid(state);
  return state.takes.find((t) => t.tid === tid) || null;
}

function create(ctx) {
  const pack = ctx.content(id) || {};
  const seeds = Array.isArray(pack.seeds) && pack.seeds.length ? pack.seeds : FALLBACK_SEEDS;
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? 1,
    phase: 'submit', // submit -> (vote -> reveal)* -> standings -> … -> done
    submitMs: (s.submitSeconds ?? 45) * 1000,
    voteMs: (s.voteSeconds ?? 20) * 1000,
    takes: [], // {tid, author|null, text}
    order: [],
    index: 0,
    votes: {},
    results: [], // {tid, agree:[pid], disagree:[pid]}
    scores: {},
    winners: [], // this round's most divisive take ids (several on a tie)
    runnersUp: [],
    roundPts: {},
    endsAt: 0,
    hostId: ctx.hostId(),
    labels: pack.labels || {},
    starters: Array.isArray(pack.starters) ? pack.starters : [],
    house: 0,
  };
  state.deal = dealer(seeds);
  startRound(state, ctx);
  return state;
}

function startRound(state, ctx) {
  state.round += 1;
  state.phase = 'submit';
  state.takes = [];
  state.order = [];
  state.index = 0;
  state.votes = {};
  state.results = [];
  state.winners = [];
  state.runnersUp = [];
  state.roundPts = {};
  state.endsAt = ctx.now() + state.submitMs;
  const r = state.round;
  ctx.later(state.submitMs, () => {
    if (state.phase !== 'submit' || state.round !== r) return;
    beginVoting(state, ctx);
    ctx.broadcast();
  });
}

function beginVoting(state, ctx) {
  if (state.phase !== 'submit') return;
  while (state.takes.length < 2) {
    state.house += 1;
    state.takes.push({ tid: 'house' + state.house, author: null, text: state.deal() });
  }
  state.order = shuffle(state.takes.map((t) => t.tid));
  state.index = 0;
  state.results = [];
  startVote(state, ctx);
}

function startVote(state, ctx) {
  state.phase = 'vote';
  state.votes = {};
  state.endsAt = ctx.now() + state.voteMs;
  const idx = state.index;
  const r = state.round;
  ctx.later(state.voteMs, () => {
    if (state.phase !== 'vote' || state.index !== idx || state.round !== r) return;
    revealTake(state, ctx);
    ctx.broadcast();
  });
}

function revealTake(state, ctx) {
  if (state.phase !== 'vote') return;
  const tid = currentTid(state);
  const agree = [];
  const disagree = [];
  for (const pid of Object.keys(state.votes)) {
    if (state.votes[pid] === 'agree') agree.push(pid);
    else disagree.push(pid);
  }
  state.results.push({ tid, agree, disagree });
  state.phase = 'reveal';
  const revealMs = paced(ctx, REVEAL_SECONDS) * 1000;
  state.endsAt = ctx.now() + revealMs;
  const idx = state.index;
  const r = state.round;
  ctx.later(revealMs, () => {
    if (state.round !== r) return;
    advance(state, ctx, idx);
    ctx.broadcast();
  });
}

function advance(state, ctx, idx) {
  if (state.phase !== 'reveal' || state.index !== idx) return;
  state.index += 1;
  if (state.index >= state.order.length) finishRound(state, ctx);
  else startVote(state, ctx);
}

/* Score the round, then show the standings (or the final screen). */
function finishRound(state, ctx) {
  scoreRound(state, ctx);
  if (state.round >= state.rounds) {
    state.phase = 'done';
    state.endsAt = 0;
    return;
  }
  state.phase = 'standings';
  const ms = paced(ctx, STANDINGS_SECONDS) * 1000;
  state.endsAt = ctx.now() + ms;
  const r = state.round;
  ctx.later(ms, () => {
    if (state.phase !== 'standings' || state.round !== r) return;
    startRound(state, ctx);
    ctx.broadcast();
  });
}

function scoreRound(state, ctx) {
  const scored = state.results.map((r) => {
    const t = state.takes.find((x) => x.tid === r.tid);
    return {
      tid: r.tid,
      author: t ? t.author : null,
      div: Math.min(r.agree.length, r.disagree.length),
      total: r.agree.length + r.disagree.length,
    };
  }).filter((x) => x.author);
  // Most divisive first: the closer split, then the bigger turnout. Equal
  // splits share a place; list order never breaks a tie.
  const key = (x) => x.div * 1000 + x.total;
  const levels = [...new Set(scored.filter((x) => x.div > 0).map(key))].sort((a, b) => b - a);
  const pts = {};
  const add = (pid, n) => { pts[pid] = (pts[pid] || 0) + n; };
  state.winners = levels.length ? scored.filter((x) => key(x) === levels[0]).map((x) => x.tid) : [];
  state.runnersUp = levels.length > 1 ? scored.filter((x) => key(x) === levels[1]).map((x) => x.tid) : [];
  for (const x of scored) {
    if (state.winners.includes(x.tid)) add(x.author, WIN_POINTS);
    else if (state.runnersUp.includes(x.tid)) add(x.author, RUNNER_UP_POINTS);
    if (x.total > 0) add(x.author, Math.min(VOTE_CAP, x.total * PER_VOTE));
  }
  state.roundPts = pts;
  for (const pid of Object.keys(pts)) addScore(state, ctx, pid, pts[pid]);
}

function knownPid(ctx, pid) {
  return typeof pid === 'string' && ctx.allPlayers().some((p) => p.id === pid);
}

function onAction(state, ctx, pid, a) {
  if (!a || typeof a !== 'object') return;
  if (!knownPid(ctx, pid)) return;
  // Close expired input before a delayed timer can admit it.
  if (state.phase === 'submit' && ctx.now() >= state.endsAt) {
    beginVoting(state, ctx);
    return;
  }
  if (state.phase === 'vote' && ctx.now() >= state.endsAt) {
    revealTake(state, ctx);
    return;
  }
  if (state.phase === 'submit' && typeof a.take === 'string') {
    const text = a.take.trim().slice(0, MAX_TAKE);
    if (!text) return;
    const mine = state.takes.find((t) => t.author === pid);
    if (mine) mine.text = text;
    else state.takes.push({ tid: randomUUID(), author: pid, text });
    const authors = new Set(state.takes.map((t) => t.author));
    if (ctx.players().every((p) => authors.has(p.id))) beginVoting(state, ctx);
    return;
  }
  if (state.phase === 'vote' && (a.vote === 'agree' || a.vote === 'disagree') && !state.votes[pid]) {
    const cur = currentTake(state);
    if (cur && pid === cur.author) return; // author sits out their own take
    state.votes[pid] = a.vote;
    const eligible = ctx.players().filter((p) => !cur || p.id !== cur.author);
    if (eligible.length && eligible.every((p) => state.votes[p.id] !== undefined)) {
      revealTake(state, ctx);
    }
    return;
  }
  if (state.phase === 'reveal' && a.next
      && pid === ctx.hostId()) {
    advance(state, ctx, state.index);
    return;
  }
  if (state.phase === 'standings' && a.next && pid === ctx.hostId()) {
    startRound(state, ctx);
  }
}

/* End game: points already awarded stay; show the game's own final screen. */
function onEnd(state) {
  state.phase = 'done';
  state.endsAt = 0;
}

/* A player who left (or stayed away) is not waited for. */
function onPlayerGone(state, ctx) {
  if (state.phase === 'submit') {
    const authors = new Set(state.takes.map((t) => t.author));
    const live = ctx.players();
    if (live.length && live.every((p) => authors.has(p.id))) beginVoting(state, ctx);
  } else if (state.phase === 'vote') {
    const cur = currentTake(state);
    const eligible = ctx.players().filter((p) => !cur || p.id !== cur.author);
    if (eligible.every((p) => state.votes[p.id] !== undefined)) revealTake(state, ctx);
  }
}

function resultPublic(state, r) {
  const t = state.takes.find((x) => x.tid === r.tid) || {};
  return { tid: r.tid, text: t.text || '', author: t.author || null, agree: r.agree, disagree: r.disagree };
}

function view(state, pid, ctx) {
  const { deal, takes, ...rest } = state;
  const out = { ...rest, hostId: ctx ? ctx.hostId() : state.hostId };
  out.submitted = takes.filter((t) => t.author).map((t) => t.author);
  out.total = state.order.length || takes.length;
  if (state.phase === 'submit') {
    const mine = takes.find((t) => t.author === pid);
    out.myTake = mine ? mine.text : null;
  } else {
    const cur = currentTake(state);
    if (cur) {
      out.current = state.phase === 'vote'
        ? { tid: cur.tid, text: cur.text, author: null, mine: cur.author === pid }
        : { tid: cur.tid, text: cur.text, author: cur.author, mine: cur.author === pid };
    } else {
      out.current = null;
    }
    out.results = state.results.map((r) => resultPublic(state, r));
    out.myVote = state.votes[pid] || null;
    if (state.phase === 'vote') {
      out.votes = {};
      out.voted = Object.keys(state.votes);
    }
  }
  return out;
}

module.exports = { id, minPlayers: 3, maxPlayers: 20, manifest, create, onAction, onEnd, onPlayerGone, view };
