'use strict';
/* Rank It: each round deals a topic with 5 items. Everyone ranks them
 * privately; the group consensus (Borda count) is revealed and the
 * closest rankings score. */

const { dealer, allIn, roundsSetting, paceSetting, paced } = require('../_sdk');

const id = 'rank-it';

const manifest = {
  players: { min: 3, max: 20 },
  settings: [
    roundsSetting({ def: 5 }),
    paceSetting(),
    { key: 'rankSeconds', label: 'Seconds to rank', type: 'int', min: 15, max: 120, def: 45 },
  ],
};
const RANK_SECONDS = 45;
const REVEAL_SECONDS = 10;
const ROUNDS = 5;
/* Points (specs/GAME_RULES_STANDARD.md): a ranking that matches the room
 * scores 100, minus 10 per place of difference; the closest ranking(s) add
 * +50. Ties share the bonus. */
const BASE_POINTS = 100;
const PER_PLACE = 10;
const CLOSEST_BONUS = 50;

const FALLBACK_SETS = [
  { topic: 'Best pizza toppings', items: ['Pepperoni', 'Mushrooms', 'Extra cheese', 'Pineapple', 'Olives'] },
];

function validSet(s) {
  return s && typeof s.topic === 'string' && Array.isArray(s.items)
    && s.items.length === 5 && s.items.every((x) => typeof x === 'string');
}

function create(ctx) {
  const pack = ctx.content(id) || {};
  const sets = Array.isArray(pack.sets) && pack.sets.length && pack.sets.every(validSet)
    ? pack.sets
    : FALLBACK_SETS;
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0,
    rounds: s.rounds ?? ROUNDS,
    rankMs: (s.rankSeconds ?? RANK_SECONDS) * 1000,
    phase: 'rank', // rank -> reveal -> done
    set: null,
    ranks: {}, // pid -> [itemIdx...] best-first
    scores: {},
    last: null,
    endsAt: 0,
    hostId: ctx.hostId(),
    labels: pack.labels || {},
  };
  state.deal = dealer(sets);
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
  state.phase = 'rank';
  state.set = state.deal();
  state.ranks = {};
  state.last = null;
  state.endsAt = ctx.now() + state.rankMs;
  const r = state.round;
  ctx.later(state.rankMs, () => {
    if (state.phase !== 'rank' || state.round !== r) return;
    reveal(state, ctx);
    ctx.broadcast();
  });
}

function validOrder(order) {
  if (!Array.isArray(order) || order.length !== 5) return false;
  const s = new Set(order);
  if (s.size !== 5) return false;
  for (const x of order) {
    if (!Number.isInteger(x) || x < 0 || x > 4) return false;
  }
  return true;
}

function reveal(state, ctx) {
  if (state.phase !== 'rank') return;
  state.phase = 'reveal';
  // Borda consensus: each item earns (5 - position) per ballot.
  const borda = [0, 0, 0, 0, 0];
  for (const pid of Object.keys(state.ranks)) {
    const order = state.ranks[pid];
    for (let pos = 0; pos < 5; pos++) borda[order[pos]] += 5 - pos;
  }
  // Display order: most points first (equal points keep the topic's order).
  const consensus = [0, 1, 2, 3, 4].sort((a, b) => borda[b] - borda[a] || a - b);
  // Items with equal points share their places (their average place), so a
  // tie never favours whichever item the topic happened to list first.
  const conPos = {};
  for (let i = 0; i < 5;) {
    let j = i;
    while (j + 1 < 5 && borda[consensus[j + 1]] === borda[consensus[i]]) j += 1;
    for (let k = i; k <= j; k++) conPos[consensus[k]] = (i + j) / 2;
    i = j + 1;
  }
  // Distance = total place difference vs the room (max 12 on 5 items).
  const dist = {};
  let best = Infinity;
  for (const pid of Object.keys(state.ranks)) {
    const order = state.ranks[pid];
    const posOf = {};
    order.forEach((item, pos) => { posOf[item] = pos; });
    let d = 0;
    for (let item = 0; item < 5; item++) d += Math.abs(posOf[item] - conPos[item]);
    dist[pid] = d;
    if (d < best) best = d;
  }
  const pts = {};
  const multi = Object.keys(dist).length > 1;
  for (const pid of Object.keys(dist)) {
    let p = Math.max(0, Math.round(BASE_POINTS - dist[pid] * PER_PLACE));
    if (multi && dist[pid] === best) p += CLOSEST_BONUS;
    pts[pid] = p;
    if (!p) continue;
    state.scores[pid] = (state.scores[pid] || 0) + p;
    ctx.award(pid, p);
  }
  state.last = {
    topic: state.set.topic,
    items: state.set.items,
    consensus,
    borda,
    closest: Object.keys(dist).filter((pid) => multi && dist[pid] === best),
    ranks: { ...state.ranks },
    dist,
    pts,
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
  if (state.phase === 'rank' && ctx.now() >= state.endsAt) {
    reveal(state, ctx);
    return;
  }
  if (state.phase === 'rank' && validOrder(a.order)) {
    state.ranks[pid] = a.order.slice();
    if (allIn(ctx.players(), state.ranks)) reveal(state, ctx);
  } else if (state.phase === 'reveal' && a.next
      && pid === ctx.hostId()) {
    nextRound(state, ctx);
  }
}

/* End game: points already awarded stay; show the game's own final screen. */
function onEnd(state) {
  state.phase = 'done';
  state.endsAt = 0;
}

/* A player who left (or stayed away) is not waited for. */
function onPlayerGone(state, ctx) {
  if (state.phase === 'rank' && allIn(ctx.players(), state.ranks)) reveal(state, ctx);
}

function view(state, pid, ctx) {
  const { deal, ...rest } = state;
  const out = { ...rest, hostId: ctx ? ctx.hostId() : state.hostId };
  if (state.phase === 'rank') {
    out.ranks = {};
    out.ranked = Object.keys(state.ranks);
    out.myRank = state.ranks[pid] || null;
  }
  return out;
}

module.exports = { id, minPlayers: 3, maxPlayers: 20, manifest, create, onAction, onEnd, onPlayerGone, view };
