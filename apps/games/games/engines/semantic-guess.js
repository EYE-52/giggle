'use strict';
/* Shared semantic guessing rules. The provider contains real normalized word
 * embeddings. Only explicitly selected public fields leave view(). */
const { dealer, paced } = require('../_sdk');

function cosine(a, b) {
  if (a.length !== b.length) throw new Error('Embedding dimensions differ.');
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.max(-1, Math.min(1, dot));
}

function createEmbeddingProvider(data) {
  const { words, vectors, dimensions } = data;
  if (!Array.isArray(words) || !Array.isArray(vectors) || words.length !== vectors.length ||
      !Number.isInteger(dimensions) || dimensions < 1 || new Set(words).size !== words.length) {
    throw new Error('Invalid word embedding data.');
  }
  const byWord = new Map();
  words.forEach((word, i) => {
    const vector = vectors[i];
    if (!/^[a-z]{2,24}$/.test(word) || !Array.isArray(vector) || vector.length !== dimensions || vector.some(x => !Number.isFinite(x))) throw new Error('Invalid word embedding vector.');
    const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
    if (Math.abs(norm - 1) > 0.001) throw new Error(`Embedding for ${word} is not normalized.`);
    byWord.set(word, Float64Array.from(vector, x => x / norm));
  });
  const cache = new Map();
  return {
    size: words.length,
    has: word => byWord.has(word),
    // ponytail: a vocabulary scan per target; bounded curated vocab is <=2500.
    // A vector index is only useful if a future pack grows much larger.
    neighbors(target) {
      if (!byWord.has(target)) throw new Error('Target has no embedding.');
      if (!cache.has(target)) {
        const ranking = words.map(word => ({ word, cosine: word === target ? 1 : cosine(byWord.get(target), byWord.get(word)) }))
          .sort((a, b) => (a.word === target ? -1 : b.word === target ? 1 : b.cosine - a.cosine || a.word.localeCompare(b.word)));
        ranking.forEach((entry, i) => { entry.rank = i + 1; entry.similarity = Math.round(entry.cosine * 10000) / 100; });
        cache.set(target, ranking);
      }
      return cache.get(target);
    },
    compare(target, word) {
      if (!byWord.has(word)) return null;
      const entry = this.neighbors(target).find(x => x.word === word);
      return { word: entry.word, rank: entry.rank, similarity: entry.similarity };
    },
  };
}

function normalizeWord(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const word = value.trim().toLowerCase();
  return /^[a-z]{2,24}$/.test(word) ? word : null;
}

function createSemanticGuess({ contentId, provider, targets, schema, hintCost = 50, cooldownMs = 350 }) {
  const validTargets = [...new Set(targets)].filter(word => provider.has(word));
  if (!validTargets.length) throw new Error('Semantic game needs known targets.');
  const defaults = Object.fromEntries(schema.settings.map(setting => [setting.key, setting.def]));
  const GAP_SECONDS = 5;
  function cancel(state) {
    if (state.cancelTimer) state.cancelTimer();
    state.cancelTimer = null;
  }
  function nextRound(state, ctx) {
    cancel(state);
    if (state.round >= state.rounds) {
      state.phase = 'done'; state.endsAt = 0;
      return;
    }
    state.round += 1;
    state.phase = 'guess';
    state.target = state.deal();
    state.history = [];
    state.guessed = Object.create(null);
    state.lastAction = Object.create(null);
    state.errors = Object.create(null);
    state.hintsUsed = 0;
    state.hintWords = [];
    state.best = null;
    state.startAt = ctx.now();
    state.endsAt = state.startAt + state.roundSeconds * 1000;
    const round = state.round;
    state.cancelTimer = ctx.later(state.roundSeconds * 1000, () => {
      if (state.phase !== 'guess' || state.round !== round) return;
      reveal(state, ctx, null);
      ctx.broadcast();
    });
  }
  function reveal(state, ctx, winner) {
    if (state.phase !== 'guess') return;
    cancel(state);
    state.phase = 'reveal';
    let points = 0;
    if (winner) {
      const fraction = Math.max(0, Math.min(1, (state.endsAt - ctx.now()) / (state.roundSeconds * 1000)));
      // Rules standard: 100 for the find, up to 100 more for speed; each
      // room hint takes hintCost off, never below half credit (50).
      points = Math.max(50, Math.round(100 + 100 * fraction) - state.hintsUsed * hintCost);
      state.scores[winner] = (state.scores[winner] || 0) + points;
      ctx.award(winner, points);
    }
    state.last = { target: state.target, winner, points, hintsUsed: state.hintsUsed, best: state.best };
    state.results.push({ round: state.round, ...state.last });
    state.endsAt = ctx.now() + state.gapMs;
    const round = state.round;
    state.cancelTimer = ctx.later(state.gapMs, () => {
      if (state.phase !== 'reveal' || state.round !== round) return;
      nextRound(state, ctx);
      ctx.broadcast();
    });
  }
  function addGuess(state, entry) {
    state.history.push(entry);
    if (state.history.length > 200) state.history.shift();
    if (!state.best || entry.rank < state.best.rank) state.best = { ...entry };
  }
  function error(state, pid, message, now) {
    state.errors[pid] = { message, at: now };
  }
  return {
    create(ctx) {
      const pack = ctx.content(contentId) || {};
      const settings = { ...defaults, ...(ctx.settings ? ctx.settings() : {}) };
      const supplied = Array.isArray(pack.targets) ? pack.targets.map(normalizeWord) : validTargets;
      const known = [...new Set(supplied.filter(word => word && provider.has(word)))];
      const rejected = supplied.length - known.length;
      const state = {
        phase: 'guess', round: 0, rounds: settings.rounds,
        roundSeconds: settings.roundSeconds, hintsEnabled: settings.hints,
        gapMs: paced(settings, GAP_SECONDS) * 1000,
        target: null, deal: dealer(known.length ? known : validTargets),
        roster: ctx.allPlayers().map(p => p.id), hostId: ctx.hostId ? ctx.hostId() : ctx.allPlayers()[0].id,
        scores: {}, results: [], history: [], best: null, last: null,
        strings: pack.strings || {},
        contentNote: rejected ? `${rejected} custom target(s) without a supported word embedding were skipped.${known.length ? '' : ' Using the standard targets.'}` : '',
        guessed: {}, errors: {}, lastAction: {}, hintsUsed: 0, hintWords: [],
        startAt: 0, endsAt: 0, cancelTimer: null,
      };
      nextRound(state, ctx);
      return state;
    },
    onAction(state, ctx, pid, action) {
      if (!action || typeof action !== 'object' || Array.isArray(action) || !state.roster.includes(pid)) return;
      state.hostId = ctx.hostId ? ctx.hostId() : state.hostId;
      if (state.phase === 'reveal') {
        if (action.next === true && pid === state.hostId) nextRound(state, ctx);
        return;
      }
      if (state.phase !== 'guess') return;
      const isGuess = typeof action.guess === 'string';
      const isHint = action.hint === true && state.hintsEnabled && state.hintsUsed < 2;
      if (!isGuess && !isHint) return;
      const now = ctx.now();
      if (now >= state.endsAt) { reveal(state, ctx, null); return; }
      if (state.lastAction[pid] !== undefined && now - state.lastAction[pid] < cooldownMs) {
        error(state, pid, 'Give each guess a moment — try again.', now); return;
      }
      state.lastAction[pid] = now;
      delete state.errors[pid];
      if (isHint && !isGuess) {
        const seen = new Set(state.hintWords);
        for (const used of Object.values(state.guessed)) for (const word of used) seen.add(word);
        const hint = provider.neighbors(state.target).find(entry => entry.rank > 1 && !seen.has(entry.word));
        if (hint) {
          state.hintsUsed += 1;
          state.hintWords.push(hint.word);
          addGuess(state, { word: hint.word, rank: hint.rank, similarity: hint.similarity, pid, hint: true });
        }
        return;
      }
      const word = normalizeWord(action.guess);
      if (!word) { error(state, pid, 'Enter one English word, using letters only.', now); return; }
      if (!provider.has(word)) { error(state, pid, 'That word is outside our common-word vocabulary. Try another everyday English word.', now); return; }
      const used = state.guessed[pid] || (state.guessed[pid] = new Set());
      if (used.has(word)) { error(state, pid, 'You already tried that word this round.', now); return; }
      used.add(word);
      const result = provider.compare(state.target, word);
      addGuess(state, { ...result, pid, hint: false });
      if (word === state.target) reveal(state, ctx, pid);
    },
    // End game: points already given stay; show the final scores.
    onEnd(state) {
      cancel(state);
      state.phase = 'done'; state.endsAt = 0;
    },
    view(state, pid, ctx) {
      return {
        phase: state.phase, round: state.round, rounds: state.rounds,
        roundSeconds: state.roundSeconds, hintsEnabled: state.hintsEnabled,
        hintsUsed: state.hintsUsed, hintCost, vocabularySize: provider.size,
        scores: { ...state.scores }, history: state.history.map(entry => ({ ...entry })),
        best: state.best ? { ...state.best } : null,
        last: state.last ? { ...state.last } : null,
        results: state.results.map(result => ({ ...result })),
        startAt: state.startAt, endsAt: state.endsAt, hostId: ctx?.hostId ? ctx.hostId() : state.hostId,
        strings: { ...state.strings }, contentNote: state.contentNote,
        myError: state.errors[pid] ? { ...state.errors[pid] } : null,
      };
    },
    dispose(state) { cancel(state); },
  };
}

module.exports = { cosine, createEmbeddingProvider, createSemanticGuess, normalizeWord };
