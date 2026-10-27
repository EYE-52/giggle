'use strict';
/* Lyric fill: a famous line with one word blanked out. Everyone fills the
 * blank in 20s; exact matches score 100, close matches score 50 (rules
 * standard half credit). The reveal shows the real lyric plus every
 * player's guess; the match keeps a scoreboard. */

const { dealer, allIn, roundsSetting, paceSetting, paced } = require('../_sdk');

const id = 'lyric-fill';

const manifest = {
  players: { min: 2, max: 20 },
  howto: 'Fill the missing words before time runs out. Exact answers earn 100 points; close answers earn 50.',
  settings: [
    roundsSetting({ def: 6 }),
    paceSetting(),
    { key: 'fillSeconds', label: 'Seconds to answer', type: 'int', min: 10, max: 60, def: 20 },
  ],
};
const ROUNDS = 6;
const FILL_SECONDS = 20;
const REVEAL_SECONDS = 7;
const EXACT_PTS = 100;
const CLOSE_PTS = 50;

function create(ctx) {
  const pack = ctx.content(id);
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? ROUNDS,
    fillMs: (s.fillSeconds ?? FILL_SECONDS) * 1000,
    revealMs: paced(s, REVEAL_SECONDS) * 1000,
    scores: {},
    phase: 'fill', // fill -> reveal -> done
    line: null,
    answers: {},
    last: null,
    endsAt: 0,
    hostId: ctx.hostId(),
  };
  state.deal = dealer(pack.lines && pack.lines.length ? pack.lines : [
    { before: 'Hello', after: '', answer: 'world', song: 'Fallback', artist: 'Fallback' },
  ]);
  nextRound(state, ctx);
  return state;
}

function nextRound(state, ctx) {
  state.round += 1;
  if (state.round > state.rounds) {
    state.round = state.rounds;
    state.phase = 'done';
    state.endsAt = 0;
    return;
  }
  state.phase = 'fill';
  state.line = state.deal();
  state.answers = {};
  state.last = null;
  state.endsAt = ctx.now() + state.fillMs;
  const fr = state.round;
  ctx.later(state.fillMs, () => {
    if (state.phase !== 'fill' || state.round !== fr) return;
    reveal(state, ctx);
    ctx.broadcast();
  });
}

function norm(s) {
  return String(s || '').normalize('NFC').trim().toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, '').replace(/\s+/g, ' ');
}

function distance(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    const t = prev;
    prev = cur;
    cur = t;
  }
  return prev[n];
}

function verdict(guess, answer) {
  if (guess && guess === answer) return 'exact';
  if (guess.length >= 4 && answer.length >= 4 &&
      (answer.includes(guess) || guess.includes(answer))) return 'close';
  if (guess && distance(guess, answer) <= 2) return 'close';
  return 'miss';
}

function reveal(state, ctx) {
  if (state.phase !== 'fill') return;
  state.phase = 'reveal';
  const answer = norm(state.line.answer);
  const verdicts = {};
  for (const p of ctx.allPlayers()) {
    const raw = state.answers[p.id];
    if (raw === undefined) continue;
    const v = verdict(norm(raw), answer);
    const pts = v === 'exact' ? EXACT_PTS : v === 'close' ? CLOSE_PTS : 0;
    if (pts) {
      state.scores[p.id] = (state.scores[p.id] || 0) + pts;
      ctx.award(p.id, pts);
    }
    verdicts[p.id] = { text: raw, verdict: v, pts };
  }
  state.last = { line: { ...state.line }, verdicts };
  state.endsAt = 0; // reveal has no visible clock; host can press Next
  const rr = state.round;
  ctx.later(state.revealMs, () => {
    if (state.phase !== 'reveal' || state.round !== rr) return;
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
  if (state.phase === 'fill' && ctx.now() >= state.endsAt) {
    reveal(state, ctx);
    return;
  }
  if (state.phase === 'fill' && typeof a.text === 'string' && !state.answers[pid]) {
    const t = a.text.trim().slice(0, 60);
    if (t) {
      state.answers[pid] = t;
      if (allIn(ctx.players(), state.answers)) reveal(state, ctx);
    }
  } else if (state.phase === 'reveal' && a.next && pid === ctx.hostId()) {
    nextRound(state, ctx);
  }
}

/* A player who left (or stayed away) is no longer waited for. */
function onPlayerGone(state, ctx) {
  if (state.phase === 'fill' && ctx.players().length && allIn(ctx.players(), state.answers)) reveal(state, ctx);
}

/* End game: points already given stay; show the final scores. */
function onEnd(state) {
  state.phase = 'done';
  state.endsAt = 0;
}

function view(state, pid, ctx) {
  const { deal, ...rest } = state;
  const out = { ...rest, scores: { ...state.scores }, hostId: ctx ? ctx.hostId() : state.hostId };
  if (state.phase === 'fill') {
    out.line = state.line ? {
      before: state.line.before,
      after: state.line.after,
      song: state.line.song,
      artist: state.line.artist,
    } : null;
    out.answers = {};
    out.mine = state.answers[pid] || '';
    out.filled = Object.keys(state.answers);
  }
  return out;
}

module.exports = { id, minPlayers: 2, maxPlayers: 20, manifest, create, onAction, onPlayerGone, onEnd, view };
