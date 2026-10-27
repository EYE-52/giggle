'use strict';
/* Word Countdown: supported English words from a solvable nine-letter tray.
 * Host extra words are additive; the full offline dictionary stays available. */
const { dealer, allIn, shuffle, roundsSetting, paceSetting, paced } = require('../_sdk');
const { createWordValidator, normalizeWord } = require('../engines/english-dictionary');
const id = 'countdown-word';
const manifest = {
  players: { min: 2, max: 20 },
  settings: [
    roundsSetting({ def: 4 }),
    paceSetting(),
    { key: 'makeSeconds', label: 'Seconds to build', type: 'int', min: 15, max: 90, def: 30 },
  ],
  packs: { words: { label: 'Extra accepted words (3–9 letters)', type: 'string[]', minItems: 1, maxItems: 200, maxLen: 9 } },
  howto: 'Build a supported English word with 3–9 letters from the nine tiles before time runs out. Every letter can be used only as many times as it appears. Save to keep editing, lock in to submit, or pass. Unsupported words get feedback while the clock keeps running. A valid word earns 50 points plus 10 per letter (five letters: 100); everyone tied for the longest earns 50 more. Each tray has a valid word. The host may add extra accepted words to the offline dictionary.',
};
const MAKE_SECONDS = 30, REVEAL_SECONDS = 8;
const WORD_PTS = 50, LETTER_PTS = 10, LONGEST_PTS = 50;
/* A valid word: 50 + 10 per letter (5 letters = 100), +50 for the longest. */
function wordPoints(length, longest) {
  return WORD_PTS + length * LETTER_PTS + (length === longest ? LONGEST_PTS : 0);
}
const SEEDS = ['chocolate', 'spaceship', 'keyboards', 'campfires', 'lightbulb', 'pineapple', 'sunflower', 'butterfly', 'crocodile', 'breakfast', 'afternoon', 'blueberry', 'raspberry', 'bluebirds', 'bookmarks', 'notebooks', 'cardboard', 'clipboard', 'sandwich', 'mountains', 'rainbows', 'treasure', 'pictures', 'carnival', 'personal', 'stapler', 'flowers', 'windows', 'thunder', 'friends', 'puzzles', 'whistles'];
const FILLERS = 'aaaaaeeeeeeiiiiooouuunnnrrrssstttlll';
function generatedSet(word) {
  const letters = word.toUpperCase().split('');
  while (letters.length < 9) letters.push(FILLERS[Math.floor(Math.random() * FILLERS.length)].toUpperCase());
  return { letters: shuffle(letters), best: word };
}
function cancel(state) {
  if (typeof state.cancelTimer === 'function') state.cancelTimer();
  state.cancelTimer = null;
}
function create(ctx) {
  const pack = ctx.content(id) || {};
  const extra = Array.isArray(pack.words) ? pack.words.map(word => normalizeWord(word, 9)).filter(word => word && word.length >= 3) : [];
  // The authored English lightbulb tray needs this spelling omitted by SCOWL
  // size60, even when a host replaces the bundled extra-word list.
  const validator = createWordValidator(['lightbulb', ...extra]);
  const validSets = (Array.isArray(pack.sets) ? pack.sets : []).filter(set => {
    if (!set || !Array.isArray(set.letters) || set.letters.length !== 9 || !set.letters.every(letter => typeof letter === 'string' && /^[a-z]$/i.test(letter))) return false;
    return validator.validate(set.best, { minLength: 3, maxLength: 9, letters: set.letters }).ok;
  }).map(set => ({ letters: set.letters.map(letter => letter.toUpperCase()), best: normalizeWord(set.best, 9) }));
  const seeds = [...new Set(extra.length ? extra : SEEDS)].filter(word => validator.has(word));
  const settings = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 0, rounds: settings.rounds ?? 4,
    makeMs: (settings.makeSeconds ?? MAKE_SECONDS) * 1000, revealMs: paced(settings, REVEAL_SECONDS) * 1000,
    phase: 'make', scores: {}, letters: [], answers: {}, locked: {}, last: null, endsAt: 0,
    hostId: ctx.hostId ? ctx.hostId() : ctx.allPlayers()[0].id,
    roster: ctx.allPlayers().map(player => player.id),
    deal: dealer(validSets.length ? validSets : seeds.map(generatedSet)), validator,
    feedback: Object.create(null), cancelTimer: null,
    contentNote: [
      Array.isArray(pack.sets) && validSets.length < pack.sets.length ? 'Some letter trays with unsupported or impossible solutions were skipped. Every tray played has a supported solution.' : '',
      Array.isArray(pack.words) && extra.length < pack.words.length ? 'Some extra words were skipped: use one word with 3–9 letters A–Z only.' : '',
    ].filter(Boolean).join(' '),
  };
  nextRound(state, ctx);
  return state;
}
function nextRound(state, ctx) {
  cancel(state);
  if (state.round >= state.rounds) { state.phase = 'done'; state.endsAt = 0; return; }
  state.round += 1; state.phase = 'make';
  const set = state.deal();
  state.letters = shuffle(set.letters); state.best = set.best;
  state.answers = {}; state.locked = {}; state.feedback = Object.create(null); state.last = null;
  state.endsAt = ctx.now() + state.makeMs;
  const round = state.round;
  state.cancelTimer = ctx.later(state.makeMs, () => {
    if (state.phase !== 'make' || state.round !== round) return;
    reveal(state, ctx); ctx.broadcast();
  });
}
function reveal(state, ctx) {
  if (state.phase !== 'make') return;
  cancel(state); state.phase = 'reveal';
  const valid = {}, points = {}; let longest = 0;
  for (const pid of Object.keys(state.answers)) {
    const word = state.answers[pid];
    valid[pid] = state.validator.validate(word, { minLength: 3, maxLength: 9, letters: state.letters }).ok;
    if (valid[pid]) longest = Math.max(longest, word.length);
  }
  for (const player of ctx.allPlayers()) {
    const word = state.answers[player.id];
    const score = word && valid[player.id] ? wordPoints(word.length, longest) : 0;
    points[player.id] = score;
    state.scores[player.id] = (state.scores[player.id] || 0) + score;
    if (score) ctx.award(player.id, score);
  }
  state.last = { letters: [...state.letters], best: state.best, answers: { ...state.answers }, valid, points, longest };
  state.endsAt = ctx.now() + state.revealMs;
  const round = state.round;
  state.cancelTimer = ctx.later(state.revealMs, () => {
    if (state.phase !== 'reveal' || state.round !== round) return;
    nextRound(state, ctx); ctx.broadcast();
  });
}
function onAction(state, ctx, pid, action) {
  if (!action || typeof action !== 'object' || Array.isArray(action) || !state.roster.includes(pid)) return;
  if (ctx.hostId) state.hostId = ctx.hostId();
  if (state.phase === 'reveal') {
    if (action.next === true && pid === state.hostId) nextRound(state, ctx);
    return;
  }
  if (state.phase !== 'make') return;
  const attempt = typeof action.word === 'string' || action.lock === true || action.pass === true || action.finish === true;
  if (!attempt) return;
  if (ctx.now() >= state.endsAt) { reveal(state, ctx); return; }
  if (action.finish === true && pid === state.hostId) { reveal(state, ctx); return; }
  if (state.locked[pid]) return;
  if (action.pass === true) {
    delete state.answers[pid]; state.locked[pid] = true;
    state.feedback[pid] = { ok: true, message: 'Passed this round. No word submitted.' };
  } else {
    if (typeof action.word === 'string') {
      const result = state.validator.validate(action.word, { minLength: 3, maxLength: 9, letters: state.letters });
      if (!result.ok) { state.feedback[pid] = result; return; }
      state.answers[pid] = result.word;
      state.feedback[pid] = { ok: true, message: `Saved “${result.word}” (${result.word.length} letters).` };
    }
    if (action.lock === true) {
      if (!state.answers[pid]) { state.feedback[pid] = { ok: false, message: 'Save a valid word first, or pass this round.' }; return; }
      state.locked[pid] = true;
      state.feedback[pid] = { ok: true, message: `Locked in “${state.answers[pid]}”.` };
    }
  }
  if (allIn(ctx.players(), state.locked)) reveal(state, ctx);
}
/* A player who left (or stayed away) is no longer waited for. */
function onPlayerGone(state, ctx) {
  if (state.phase === 'make' && ctx.players().length && allIn(ctx.players(), state.locked)) reveal(state, ctx);
}
/* End game: points already given stay; show the final scores. */
function onEnd(state) {
  cancel(state);
  state.phase = 'done'; state.endsAt = 0;
}
function view(state, pid, ctx) {
  const { deal, validator, feedback, cancelTimer, roster, ...rest } = state;
  const out = { ...rest, hostId: ctx ? ctx.hostId() : state.hostId, myFeedback: feedback[pid] || null };
  if (state.phase === 'make') {
    out.answers = {}; out.best = null; out.mine = state.answers[pid] || '';
    out.locked = Object.keys(state.locked); out.myLocked = !!state.locked[pid];
  }
  return out;
}
module.exports = { id, minPlayers: 2, maxPlayers: 20, manifest, create, onAction, onPlayerGone, onEnd, view, dispose: cancel, wordPoints };
