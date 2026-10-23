'use strict';
/* Memory Tray: 8 items shown for 12s, then hidden; players have 30s to type
 * the items they recall as a comma-separated list. Points follow the rules
 * standard: recalling the whole tray earns 150 + 50 (200), half the tray 75. */

const { dealer, allIn, roundsSetting, paceSetting, paced } = require('../_sdk');

const id = 'memory-tray';

const manifest = {
  players: { min: 2, max: 20 },
  howto: 'Memorize the items, then type all you remember. Points grow with every item you recall: the whole tray earns 200, half of it 75.',
  settings: [
    roundsSetting({ def: 3 }),
    paceSetting(),
    { key: 'memSeconds', label: 'Seconds to memorize', type: 'int', min: 5, max: 60, def: 12 },
    { key: 'recallSeconds', label: 'Seconds to recall', type: 'int', min: 10, max: 120, def: 30 },
  ],
  packs: {
    items: { label: 'Custom items', type: 'string[]', minItems: 12, maxLen: 40 },
  },
};
const REVEAL_SECONDS = 7;
const RECALL_PTS = 150;
const FULL_TRAY_PTS = 50;

/* Points for recalling `count` of `total` items: up to 150, +50 for all. */
function recallPoints(count, total) {
  if (!count || !total) return 0;
  return Math.round((Math.min(count, total) / total) * RECALL_PTS) + (count >= total ? FULL_TRAY_PTS : 0);
}
const TRAY_N = 8;
const ROUNDS = 3;

function create(ctx) {
  const pack = ctx.content(id);
  const items = pack.items && pack.items.length
    ? pack.items
    : ['apple', 'key', 'balloon', 'book', 'spoon', 'hat', 'clock', 'fish'];
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? ROUNDS,
    memMs: (s.memSeconds ?? 12) * 1000,
    recallMs: (s.recallSeconds ?? 30) * 1000,
    revealMs: paced(s, REVEAL_SECONDS) * 1000,
    phase: 'memorize', // memorize -> recall -> reveal -> done
    items: [],
    submissions: {}, // pid -> [normalized recalls]
    scores: {},
    last: null, // {items, results: {pid: {correct, count, pts}}}
    endsAt: 0,
    hostId: ctx.hostId(),
  };
  state.deal = dealer(items);
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
  const tray = [];
  const seen = new Set();
  let guard = 0;
  while (tray.length < TRAY_N && guard++ < 300) {
    const w = String(state.deal()).trim();
    const key = w.toLowerCase();
    if (w && !seen.has(key)) { seen.add(key); tray.push(w); }
  }
  state.items = tray;
  state.submissions = {};
  state.last = null;
  state.phase = 'memorize';
  state.endsAt = ctx.now() + state.memMs;
  const round = state.round;
  ctx.later(state.memMs, () => {
    if (state.round !== round || state.phase !== 'memorize') return;
    startRecall(state, ctx);
    ctx.broadcast();
  });
}

function startRecall(state, ctx) {
  if (state.phase !== 'memorize') return;
  state.phase = 'recall';
  state.endsAt = ctx.now() + state.recallMs;
  const round = state.round;
  ctx.later(state.recallMs, () => {
    if (state.round !== round || state.phase !== 'recall') return;
    reveal(state, ctx);
    ctx.broadcast();
  });
}

function reveal(state, ctx) {
  if (state.phase !== 'recall') return;
  state.phase = 'reveal';
  state.endsAt = ctx.now() + state.revealMs;
  const key = state.items.map((w) => w.toLowerCase());
  const results = {};
  for (const p of ctx.allPlayers()) {
    const rec = state.submissions[p.id] || [];
    const correct = [];
    for (const w of rec) {
      if (key.includes(w) && !correct.includes(w)) correct.push(w);
    }
    const pts = recallPoints(correct.length, state.items.length);
    results[p.id] = { correct, count: correct.length, pts };
    if (pts > 0) {
      state.scores[p.id] = (state.scores[p.id] || 0) + pts;
      ctx.award(p.id, pts);
    }
  }
  state.last = { items: [...state.items], results };
  const round = state.round;
  ctx.later(state.revealMs, () => {
    if (state.round !== round || state.phase !== 'reveal') return;
    nextRound(state, ctx);
    ctx.broadcast();
  });
}

function onAction(state, ctx, pid, a) {
  if (!a || typeof a !== 'object' || Array.isArray(a) || !ctx.allPlayers().some(p => p.id === pid)) return;
  if (state.phase === 'recall' && ctx.now() >= state.endsAt) { reveal(state, ctx); return; }
  if (state.phase === 'recall' && typeof a.recall === 'string') {
    const seen = new Set();
    const list = [];
    const separator = a.recallFormat === 'lines' ? /\r\n|\r|\n/ : ',';
    for (const part of String(a.recall).split(separator)) {
      const w = part.trim().toLowerCase();
      if (w && !seen.has(w)) {
        seen.add(w);
        list.push(w);
      }
      if (list.length >= 12) break;
    }
    if (!list.length) return;
    state.submissions[pid] = list;
    if (allIn(ctx.players(), state.submissions)) reveal(state, ctx);
  } else if (state.phase === 'reveal' && a.next && pid === ctx.hostId()) {
    nextRound(state, ctx);
  }
}

/* A player who left (or stayed away) is no longer waited for. */
function onPlayerGone(state, ctx) {
  if (state.phase === 'recall' && ctx.players().length && allIn(ctx.players(), state.submissions)) reveal(state, ctx);
}

/* End game: points already given stay; show the final scores. */
function onEnd(state) {
  state.phase = 'done';
  state.endsAt = 0;
}

function view(state, pid, ctx) {
  const { deal, submissions, ...rest } = state;
  const out = { ...rest, hostId: ctx ? ctx.hostId() : state.hostId };
  if (state.phase === 'recall') {
    delete out.items; // tray is hidden while recalling
    out.submitted = Object.keys(state.submissions);
    out.myRecall = state.submissions[pid] || null;
    // Format metadata supports literal commas without exposing hidden labels.
    out.recallFormat = state.items.some(w => w.includes(',')) ? 'lines' : 'comma';
  }
  if (state.phase === 'memorize') out.myRecall = null;
  return out;
}

module.exports = { id, minPlayers: 2, maxPlayers: 20, manifest, create, onAction, onPlayerGone, onEnd, view, recallPoints };
