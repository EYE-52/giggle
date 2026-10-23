'use strict';
/* Doodle Guess: one player draws, rest guess. Reference realtime game:
 * stroke streaming, per-player hidden word, speed scoring, hints. */

const { dealer, shuffle, roundsSetting, paceSetting, paced } = require('../_sdk');
const { maskWord, revealLetter } = require('../engines/word-hints');
const { normalizeStroke } = require('../engines/drawing-input');
const { randomUUID } = require('node:crypto');

const id = 'doodle-guess';
const CHOICES = 3;
const PICK_SECONDS = 15;   // word choice, scaled by Pace
const REVEAL_SECONDS = 6;  // round result, scaled by Pace; host or artist can press Next

/* Points (specs/GAME_RULES_STANDARD.md): a correct guess is 100, plus up
 * to 75 for speed and 25 / 15 / 5 for the first three to get it (extras
 * never above 100). The artist earns 50 once anyone gets it plus up to
 * 50 more as more of the room does (100 when everyone guesses). Points
 * are awarded when the round ends. */
const GUESS_POINTS = 100;
const SPEED_MAX = 75;
const ORDER_BONUS = [25, 15, 5];
function guessPoints(leftMs, roundMs, order) {
  const speed = roundMs > 0 ? Math.round(Math.max(0, Math.min(1, leftMs / roundMs)) * SPEED_MAX) : 0;
  return GUESS_POINTS + speed + (ORDER_BONUS[order] || 0);
}
function artistPoints(correct, guessers) {
  if (!correct || !guessers) return 0;
  return 50 + Math.round(50 * Math.min(1, correct / guessers));
}

const manifest = {
  name: 'Doodle Guess',
  tagline: 'Draw it, friends guess it',
  howto: 'One player draws, everyone else guesses. A correct guess is worth 100 points plus up to 100 for speed; the artist scores when the room gets it.',
  cat: 'draw',
  renderer: 'canvas',
  realtime: true,
  players: { min: 3, max: 12 },
  settings: [
    roundsSetting({ def: null, autoLabel: 'Auto (two per player)' }),
    paceSetting(),
    { key: 'roundSeconds', label: 'Seconds to draw', type: 'int', min: 10, max: 180, def: 80 },
    { key: 'hints', label: 'Timed letter hints (up to three)', type: 'bool', def: true },
  ],
  packs: {
    words: { label: 'Custom words', type: 'string[]', minItems: 10, maxItems: 200, maxLen: 60 },
  },
};

function create(ctx) {
  const pack = ctx.content(id);
  const words = pack.words && pack.words.length ? pack.words : ['apple', 'rocket', 'pizza'];
  const s = ctx.settings ? ctx.settings() : {};
  const players = ctx.allPlayers().map((p) => p.id);
  const state = {
    round: 0,
    rounds: s.rounds ?? Math.min(players.length * 2, 8),
    roundMs: (s.roundSeconds ?? 80) * 1000,
    hints: s.hints ?? true,
    drawer: null,
    order: shuffle(players),
    word: null,
    masked: '',
    choices: [],
    strokes: [],
    preview: null,
    previewDirty: false,
    inkNonce: '',
    inkRevision: 0,
    lastGestureId: 0,
    inkActive: null,
    inkFeedback: null,
    guesses: [],
    guessSerial: 0,
    feedback: {},
    guessed: {},
    scores: Object.fromEntries(players.map((pid) => [pid, 0])),
    roundPoints: {},
    lastRound: null,
    gone: [],
    pickMs: paced(s, PICK_SECONDS) * 1000,
    revealMs: paced(s, REVEAL_SECONDS) * 1000,
    hostId: typeof ctx.hostId === 'function' ? ctx.hostId() : null,
    phase: 'pick', // pick -> draw -> reveal -> done
    endsAt: 0,
    hintAt: 0,
    hintsUsed: 0,
  };
  state.deal = dealer(words);
  nextTurn(state, ctx);
  return state;
}

function present(state, ctx) {
  return ctx.allPlayers().map((p) => p.id).filter((pid) => !state.gone.includes(pid));
}

function guessersOf(state, ctx) {
  return present(state, ctx).filter((pid) => pid !== state.drawer);
}

function finish(state) {
  state.phase = 'done';
  state.endsAt = 0;
  state.hintAt = 0;
  state.drawer = null;
}

function nextTurn(state, ctx) {
  const alive = ctx.allPlayers().map((p) => p.id);
  state.order = state.order.filter((pid) => alive.includes(pid));
  for (const pid of alive) if (!state.order.includes(pid)) state.order.push(pid);
  // A player who left keeps their seat in the order (so turns do not shift)
  // but their turn is skipped.
  const playable = state.order.filter((pid) => !state.gone.includes(pid));
  if (state.round >= state.rounds || playable.length < 2) {
    finish(state);
    return;
  }
  state.round += 1;
  let drawer = null;
  const n = state.order.length;
  for (let i = 0; i < n && !drawer; i++) {
    const idx = ((state.nextSeat || 0) + i) % n;
    if (!state.gone.includes(state.order[idx])) { drawer = state.order[idx]; state.nextSeat = idx + 1; }
  }
  state.drawer = drawer;
  state.roundPoints = {};
  state.choices = [state.deal(), state.deal(), state.deal()].slice(0, CHOICES);
  state.word = null;
  state.masked = '';
  state.hintAt = 0;
  state.hintsUsed = 0;
  state.strokes = [];
  state.preview = null;
  state.previewDirty = false;
  state.inkNonce = randomUUID();
  state.inkRevision = 0;
  state.lastGestureId = 0;
  state.inkActive = null;
  state.inkFeedback = null;
  state.guesses = [];
  state.guessSerial = 0;
  state.feedback = {};
  state.guessed = {};
  state.phase = 'pick';
  state.endsAt = ctx.now() + state.pickMs;
  const round = state.round;
  ctx.later(state.pickMs, () => {
    if (state.round !== round || state.phase !== 'pick') return;
    if (state.phase === 'pick' && state.drawer) {
      beginDraw(state, ctx, state.choices[0]);
      ctx.broadcast();
    }
  });
}

function beginDraw(state, ctx, word) {
  state.word = word;
  state.masked = maskWord(word);
  state.phase = 'draw';
  state.endsAt = ctx.now() + state.roundMs;
  state.hintAt = state.hints ? ctx.now() + state.roundMs / 2 : 0;
  const round = state.round;
  ctx.later(state.roundMs, () => {
    if (state.round !== round || state.phase !== 'draw') return;
    endTurn(state, ctx);
    ctx.broadcast();
  });
}

/* Close the round: the artist's share is fixed now, and every point of the
 * round is awarded at once (also when the host ends the game mid-round). */
function settleRound(state, ctx, reason) {
  const guessers = guessersOf(state, ctx).length + Object.keys(state.guessed).filter((pid) => state.gone.includes(pid)).length;
  const correct = Object.keys(state.guessed).length;
  const points = { ...state.guessed };
  const drawerPts = state.drawer ? artistPoints(correct, guessers) : 0;
  if (drawerPts) points[state.drawer] = drawerPts;
  for (const pid of Object.keys(points)) {
    if (pid === state.drawer) state.scores[pid] = (state.scores[pid] || 0) + drawerPts;
    if (points[pid] > 0) ctx.award(pid, points[pid]);
  }
  state.roundPoints = points;
  state.lastRound = { round: state.round, drawer: state.drawer, word: state.word, correct, guessers, points, reason: reason || '' };
}

function endTurn(state, ctx, reason) {
  if (state.phase !== 'draw') return;
  state.phase = 'reveal';
  state.hintAt = 0;
  if (state.preview) appendStroke(state, state.preview);
  state.preview = null;
  state.previewDirty = false;
  state.inkActive = null;
  settleRound(state, ctx, reason);
  state.endsAt = ctx.now() + state.revealMs;
  const round = state.round;
  ctx.later(state.revealMs, () => {
    if (state.round !== round || state.phase !== 'reveal') return;
    nextTurn(state, ctx);
    ctx.broadcast();
  });
}

// Doodle adds gesture identity around the unchanged Draw Phone stroke format.
// Increasing IDs need no ever-growing replay ledger, including after reconnect.
function appendStroke(state, stroke) {
  state.strokes.push(stroke);
  while (state.strokes.length > 400) {
    const oldest = state.strokes[0].gestureId;
    state.strokes = state.strokes.filter(s => s.gestureId !== oldest);
  }
}

function acceptInk(state, a) {
  if (a.inkNonce !== state.inkNonce || a.inkRevision !== state.inkRevision) {
    state.inkFeedback = a.inkNonce === undefined || a.inkRevision === undefined
      ? 'Drawing tools are out of date. Reload the game to draw.'
      : 'Drawing changed. Your canvas has been refreshed; try again.';
    return false;
  }
  state.inkFeedback = null;
  return true;
}

function drawingAction(state, a) {
  const source = a.stroke || a.preview;
  const ink = normalizeStroke(source);
  if (!ink || !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(ink.color) ||
      (source.tool !== undefined && !['pen', 'eraser'].includes(source.tool)) ||
      !Number.isSafeInteger(a.gestureId) || a.gestureId < 1 || a.gestureId > 1e9 ||
      !Number.isSafeInteger(a.chunk) || a.chunk < 0 || a.chunk >= 400 ||
      (a.stroke && typeof a.finished !== 'boolean') ||
      (a.preview && (!Number.isSafeInteger(a.sample) || a.sample < 1 || a.sample > 1e6))) return false;
  ink.tool = source.tool || 'pen';
  ink.color = ink.tool === 'eraser' ? '#ffffff' : ink.color.toLowerCase();
  const stroke = { ...ink, gestureId: a.gestureId, chunk: a.chunk };
  let active = state.inkActive;
  if (!active || active.id !== a.gestureId) {
    if (a.gestureId <= state.lastGestureId || a.chunk !== 0) return false;
    // A resumed artist starts a fresh gesture; preserve the last live fragment.
    if (state.preview) appendStroke(state, state.preview);
    state.preview = null;
    active = state.inkActive = { id: a.gestureId, chunk: 0, sample: 0, color: ink.color, size: ink.size, tool: ink.tool };
    state.lastGestureId = a.gestureId;
  }
  if (a.chunk !== active.chunk || ink.color !== active.color || ink.size !== active.size || ink.tool !== active.tool) return false;
  if (a.preview) {
    if (a.sample <= active.sample) return false;
    active.sample = a.sample;
    state.preview = stroke;
    state.previewDirty = true;
    return false; // Room's 10 Hz heartbeat coalesces live ink.
  }
  appendStroke(state, stroke);
  state.preview = null;
  state.previewDirty = false;
  active.chunk += 1;
  active.sample = 0;
  if (a.finished || active.chunk >= 400) state.inkActive = null;
}

function onAction(state, ctx, pid, a) {
  if (!a || typeof a !== 'object' || Array.isArray(a) || !ctx.allPlayers().some((p) => p.id === pid)) return false;
  if (state.gone.includes(pid)) state.gone = state.gone.filter((g) => g !== pid); // back from away
  if (state.phase === 'pick' && ctx.now() >= state.endsAt) { beginDraw(state, ctx, state.choices[0]); return; }
  if (state.phase === 'draw' && ctx.now() >= state.endsAt) { endTurn(state, ctx); return; }
  if (state.phase === 'pick' && pid === state.drawer && a.choose) {
    if (state.choices.includes(a.choose)) {
      beginDraw(state, ctx, a.choose);
    }
    return;
  }
  if (a.stroke || a.preview || a.clear || a.undo) {
    if (['stroke', 'preview', 'clear', 'undo'].filter(key => a[key]).length !== 1) return false;
    if ((a.clear && a.clear !== true) || (a.undo && a.undo !== true)) return false;
    if (state.phase !== 'draw' || pid !== state.drawer) return false;
    if (!acceptInk(state, a)) return; // private friendly feedback, no rejected payload echo
    if (a.stroke || a.preview) return drawingAction(state, a);
    const gestureId = state.inkActive?.id || state.preview?.gestureId || state.strokes.at(-1)?.gestureId;
    if (a.clear) state.strokes = [];
    else state.strokes = state.strokes.filter(s => s.gestureId !== gestureId);
    state.preview = null;
    state.previewDirty = false;
    state.inkActive = null;
    state.inkRevision += 1; // queued preview/commit/duplicate undo cannot restore old ink
    return;
  }
  if (state.phase === 'draw' && pid !== state.drawer && typeof a.guess === 'string' && !state.guessed[pid]) {
    const text = a.guess.trim();
    if (text.length > 60) return false;
    const g = text.toLowerCase();
    if (!g) return false;
    state.feedback[pid] = { message: `“${text}” is not it. Try again.` };
    if (g && g === state.word.toLowerCase()) {
      const left = Math.max(0, state.endsAt - ctx.now());
      const order = Object.keys(state.guessed).length;
      const pts = guessPoints(left, state.roundMs, order);
      state.guessed[pid] = pts;
      state.feedback[pid] = { message: `You got it! +${pts} points.` };
      state.scores[pid] = (state.scores[pid] || 0) + pts;
      state.guesses.push({ id: ++state.guessSerial, pid, correct: true, points: pts });
      if (allGuessed(state, ctx)) endTurn(state, ctx, 'Everyone got it');
    } else state.guesses.push({ id: ++state.guessSerial, pid, correct: false, text });
    if (state.guesses.length > 80) state.guesses.splice(0, state.guesses.length - 80);
    return;
  }
  if (state.phase === 'reveal' && a.next === true && (pid === state.drawer || pid === hostOf(state, ctx))) {
    nextTurn(state, ctx);
  }
}

function hostOf(state, ctx) {
  if (typeof ctx.hostId === 'function') state.hostId = ctx.hostId();
  return state.hostId;
}

function allGuessed(state, ctx) {
  const guessers = guessersOf(state, ctx);
  return guessers.length > 0 && guessers.every((pid) => state.guessed[pid]);
}

/* End game: points of a round in progress are settled, then the final
 * scores show (the room already cancelled the timers). */
function onEnd(state, ctx) {
  if (state.phase === 'draw') {
    if (state.preview) appendStroke(state, state.preview);
    state.preview = null;
    settleRound(state, ctx, 'The game ended');
  }
  finish(state);
}

/* A player who leaves (or stays away): the artist's turn is skipped, and
 * guessers are no longer waited for. */
function onPlayerGone(state, ctx, pid) {
  if (!state.gone.includes(pid)) state.gone.push(pid);
  if (state.phase === 'done') return;
  if (pid === state.drawer) {
    if (state.phase === 'pick') nextTurn(state, ctx);
    else if (state.phase === 'draw') endTurn(state, ctx, `${nameOf(ctx, pid)} left, so this turn ends`);
    return;
  }
  if (state.phase === 'draw' && allGuessed(state, ctx)) endTurn(state, ctx, 'Everyone got it');
}

function nameOf(ctx, pid) {
  return ctx.allPlayers().find((p) => p.id === pid)?.name || 'The artist';
}

function onTick(state, ctx) {
  let hinted = false;
  if (state.hints && state.phase === 'draw' && state.hintAt && ctx.now() >= state.hintAt) {
    // Catch up after a paused tab/tick, with a small fixed budget. The word
    // helper keeps the final letter hidden, even for tiny custom words.
    const startedAt = state.endsAt - state.roundMs;
    const times = [.5, .7, .85];
    while (state.hintAt && ctx.now() >= state.hintAt && ctx.now() < state.endsAt) {
      state.masked = revealLetter(state.word, state.masked);
      state.hintsUsed += 1;
      state.hintAt = state.hintsUsed < times.length ? startedAt + state.roundMs * times[state.hintsUsed] : 0;
      hinted = true;
    }
  }
  const previewChanged = state.phase === 'draw' && state.previewDirty;
  state.previewDirty = false;
  if (hinted) ctx.broadcast();
  else if (previewChanged) ctx.broadcast({ discardable: true });
}

function view(state, pid, ctx) {
  const { deal, feedback, previewDirty, inkActive, inkFeedback, lastGestureId, inkNonce, pickMs, revealMs, nextSeat, ...rest } = state;
  const out = { ...rest, myFeedback: feedback?.[pid] || null };
  // The current host may press Next at the reveal (rooms re-elect hosts).
  if (ctx && typeof ctx.hostId === 'function') out.hostId = ctx.hostId();
  // Only the drawer sees the word; everyone sees the mask.
  if (pid !== state.drawer) {
    delete out.choices;
    if (state.phase !== 'reveal' && state.phase !== 'done') delete out.word;
  } else {
    out.wordShown = state.word;
    if (state.phase === 'draw') {
      out.inkNonce = inkNonce;
      out.lastGestureId = lastGestureId;
      out.myInkFeedback = inkFeedback;
    }
  }
  return out;
}

module.exports = { id, minPlayers: 3, maxPlayers: 12, realtime: true, manifest, create, onAction, onTick, onEnd, onPlayerGone, view, guessPoints, artistPoints };
