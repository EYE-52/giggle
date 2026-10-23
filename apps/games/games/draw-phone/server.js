'use strict';
const { normalizeStroke } = require('../engines/drawing-input');
const { randomUUID } = require('node:crypto');
/* Draw Phone: exquisite-corpse telephone. Everyone writes a phrase, then a
 * shuffled player draws it, then another shuffled player captions the
 * drawing. Chains are revealed one by one. Stroke protocol matches
 * doodle-guess ({pts:[[x,y]...], color, size}, normalized 0..1). */

const { shuffle, dealer, paceSetting, paced } = require('../_sdk');

/* Points (specs/GAME_RULES_STANDARD.md), awarded as each page closes:
 * writing your own phrase 25, a drawing with ink 50, a caption 25 (100 for
 * a full set). When a caption still matches the original phrase, the
 * drawer and the captioner each get +50: the story survived. */
const PHRASE_POINTS = 25;
const DRAWING_POINTS = 50;
const CAPTION_POINTS = 25;
const MATCH_POINTS = 50;
const STORY_SECONDS = 20; // each story page at the reveal, scaled by Pace

const STOP = new Set('a an the of in on at to and or with without is are was be its it his her their our my your some for from by into onto over under very this that these those while who what'.split(' '));
function words(text) {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter((w) => w && !STOP.has(w)).map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
}
/* The caption keeps at least half of the phrase's meaningful words. */
function storySurvived(phrase, caption) {
  const want = [...new Set(words(phrase))];
  if (!want.length) return false;
  const got = new Set(words(caption));
  const kept = want.filter((w) => got.has(w)).length;
  return kept * 2 >= want.length;
}

const id = 'draw-phone';

const manifest = {
  players: { min: 3, max: 12 },
  settings: [
    paceSetting(),
    { key: 'writeSeconds', label: 'Seconds to write', type: 'int', min: 10, max: 120, def: 30 },
    { key: 'drawSeconds', label: 'Seconds to draw', type: 'int', min: 30, max: 300, def: 90 },
    { key: 'guessSeconds', label: 'Seconds to guess', type: 'int', min: 10, max: 120, def: 30 },
  ],
  packs: {
    starters: { label: 'Custom starters', type: 'string[]', minItems: 3 },
  },
};

/* players[i] is assigned the item owned by players[(i+1)%n] — never self. */
function rotateAssign(players) {
  const m = {};
  const n = players.length;
  for (let i = 0; i < n; i++) m[players[i]] = players[(i + 1) % n];
  return m;
}

function create(ctx) {
  const pack = ctx.content(id);
  const starters = pack.starters && pack.starters.length
    ? pack.starters
    : ['A cat wearing a tiny hat'];
  const ps = ctx.allPlayers();
  const s = ctx.settings ? ctx.settings() : {};
  const state = {
    round: 1,
    rounds: 1,
    phase: 'write', // write -> draw -> guess -> reveal -> done
    writeMs: (s.writeSeconds ?? 30) * 1000,
    drawMs: (s.drawSeconds ?? 90) * 1000,
    guessMs: (s.guessSeconds ?? 30) * 1000,
    phrases: {},
    drawAssign: {},
    drawings: {},
    guessAssign: {},
    guesses: {},
    chains: [],
    revealIdx: 0,
    scores: Object.fromEntries(ps.map((p) => [p.id, 0])),
    written: {},   // pid -> true when the player wrote their own phrase
    finished: {},  // pid -> true when the artist pressed Done drawing
    gone: [],
    storyMs: paced(s, STORY_SECONDS) * 1000,
    endsAt: 0,
    hostId: ctx.hostId?.() || ps[0]?.id || null,
  };
  state.deal = dealer(starters);
  state.suggestions = [state.deal(), state.deal(), state.deal()];
  state.endsAt = ctx.now() + state.writeMs;
  ctx.later(state.writeMs, () => {
    startDraw(state, ctx);
    ctx.broadcast();
  });
  return state;
}

function present(state, ctx) {
  return ctx.allPlayers().map((p) => p.id).filter((pid) => !state.gone.includes(pid));
}

/* Connected players still in the match: the ones a page waits for. */
function waitingFor(state, ctx) {
  return ctx.players().map((p) => p.id).filter((pid) => !state.gone.includes(pid));
}

function give(state, ctx, pid, points) {
  if (!pid || !(points > 0)) return;
  state.scores[pid] = (state.scores[pid] || 0) + points;
  ctx.award(pid, points);
}

function closeWrite(state, ctx) {
  for (const pid of Object.keys(state.written)) give(state, ctx, pid, PHRASE_POINTS);
}
function closeDraw(state, ctx) {
  for (const [pid, d] of Object.entries(state.drawings)) if (d.strokes.length) give(state, ctx, pid, DRAWING_POINTS);
}
function closeGuess(state, ctx) {
  for (const pid of Object.keys(state.guesses)) if (state.guesses[pid]) give(state, ctx, pid, CAPTION_POINTS);
}

function startDraw(state, ctx) {
  if (state.phase !== 'write') return;
  closeWrite(state, ctx);
  const ps = present(state, ctx);
  for (const pid of ps) {
    if (!state.phrases[pid]) state.phrases[pid] = state.deal();
  }
  state.drawAssign = rotateAssign(shuffle(ps));
  state.drawings = {};
  for (const pid of ps) state.drawings[pid] = { strokes: [], preview: null, inkNonce: randomUUID(), inkRevision: 0, lastGestureId: 0, inkActive: null, inkFeedback: null };
  state.finished = {};
  state.phase = 'draw';
  state.endsAt = ctx.now() + state.drawMs;
  ctx.later(state.drawMs, () => {
    startGuess(state, ctx);
    ctx.broadcast();
  });
}

function startGuess(state, ctx) {
  if (state.phase !== 'draw') return;
  for (const drawing of Object.values(state.drawings)) {
    if (drawing.preview) drawing.strokes.push(drawing.preview);
    delete drawing.preview;
  }
  closeDraw(state, ctx);
  const ps = present(state, ctx).filter((pid) => state.drawAssign[pid]);
  // Pass each book one more seat around its original shuffled ring. A new
  // independent shuffle can return the drawing to its phrase's author.
  state.guessAssign = Object.fromEntries(ps.map(pid => [pid, state.drawAssign[pid]]));
  state.guesses = {};
  state.phase = 'guess';
  state.endsAt = ctx.now() + state.guessMs;
  ctx.later(state.guessMs, () => {
    startReveal(state, ctx);
    ctx.broadcast();
  });
}

function startReveal(state, ctx) {
  if (state.phase !== 'guess') return;
  closeGuess(state, ctx);
  // Every phrase that was handed out is a story, even when its author left.
  const handed = new Set(Object.values(state.drawAssign));
  const ps = ctx.allPlayers().map((p) => p.id).filter((pid) => handed.has(pid));
  const drawerOf = {};
  for (const d of Object.keys(state.drawAssign)) drawerOf[state.drawAssign[d]] = d;
  const guesserOf = {};
  for (const g of Object.keys(state.guessAssign)) guesserOf[state.guessAssign[g]] = g;
  state.chains = ps.map((origin) => {
    const drawBy = drawerOf[origin] || null;
    const guessBy = (drawBy && guesserOf[drawBy]) || null;
    return {
      origin,
      phrase: state.phrases[origin] || '',
      drawBy,
      strokes: (drawBy && state.drawings[drawBy]) ? state.drawings[drawBy].strokes : [],
      guessBy,
      guess: (guessBy && state.guesses[guessBy]) || '',
    };
  });
  for (const c of state.chains) {
    c.survived = !!(c.strokes.length && c.guess && storySurvived(c.phrase, c.guess));
    if (c.survived) {
      give(state, ctx, c.drawBy, MATCH_POINTS);
      give(state, ctx, c.guessBy, MATCH_POINTS);
    }
  }
  state.phase = 'reveal';
  state.revealIdx = 0;
  if (!state.chains.length) { finish(state); return; }
  armStory(state, ctx);
}

/* Each story page turns by itself after a paced moment; the host can turn
 * it sooner (Next) or go back (Previous). */
function armStory(state, ctx) {
  state.pageNo = (state.pageNo || 0) + 1;
  const page = state.pageNo;
  state.endsAt = ctx.now() + state.storyMs;
  ctx.later(state.storyMs, () => {
    if (state.phase !== 'reveal' || state.pageNo !== page) return;
    turnPage(state, ctx, 1);
    ctx.broadcast();
  });
}

function turnPage(state, ctx, dir) {
  if (dir < 0 && state.revealIdx === 0) return;
  state.revealIdx += dir;
  if (state.revealIdx >= state.chains.length) { finish(state); return; }
  armStory(state, ctx);
}

function finish(state) {
  state.phase = 'done';
  state.endsAt = 0;
  state.pageNo = (state.pageNo || 0) + 1;
}

/* End game: the open page counts (phrases, drawings or captions made so
 * far), then the final scores show. */
function onEnd(state, ctx) {
  if (state.phase === 'write') closeWrite(state, ctx);
  else if (state.phase === 'draw') {
    for (const drawing of Object.values(state.drawings)) {
      if (drawing.preview) drawing.strokes.push(drawing.preview);
      delete drawing.preview;
    }
    closeDraw(state, ctx);
  } else if (state.phase === 'guess') closeGuess(state, ctx);
  finish(state);
}

/* A player who left (or stays away) is no longer waited for. */
function onPlayerGone(state, ctx, pid) {
  if (!state.gone.includes(pid)) state.gone.push(pid);
  syncHost(state, ctx);
  advanceIfAllIn(state, ctx);
}

function advanceIfAllIn(state, ctx) {
  const wait = waitingFor(state, ctx);
  if (state.phase === 'write' && wait.every((p) => state.phrases[p])) startDraw(state, ctx);
  else if (state.phase === 'draw' && wait.every((p) => state.finished[p] || !state.drawings[p])) startGuess(state, ctx);
  else if (state.phase === 'guess' && wait.every((p) => state.guesses[p] || !state.guessAssign[p])) startReveal(state, ctx);
}

function syncHost(state, ctx) {
  const connected = ctx.players();
  const host = ctx.hostId?.();
  state.hostId = connected.some(p => p.id === host) ? host : connected[0]?.id || state.hostId;
}

function appendStroke(drawing, stroke) {
  drawing.strokes.push(stroke);
  while (drawing.strokes.length > 400) {
    const oldest = drawing.strokes[0].gestureId;
    drawing.strokes = drawing.strokes.filter(s => s.gestureId !== oldest);
  }
}

function drawingAction(drawing, a) {
  if (a.inkNonce !== drawing.inkNonce || a.inkRevision !== drawing.inkRevision) {
    drawing.inkFeedback = a.inkNonce === undefined || a.inkRevision === undefined
      ? 'Drawing tools are out of date. Reload the game to draw.'
      : 'Drawing changed. Your canvas has been refreshed; try again.';
    return;
  }
  drawing.inkFeedback = null;
  if (a.clear || a.undo) {
    const gestureId = drawing.inkActive?.id || drawing.preview?.gestureId || drawing.strokes.at(-1)?.gestureId;
    drawing.strokes = a.clear ? [] : drawing.strokes.filter(s => s.gestureId !== gestureId);
    drawing.preview = null;
    drawing.inkActive = null;
    drawing.inkRevision += 1;
    return;
  }
  const ink = normalizeStroke(a.stroke || a.preview);
  if (!ink || !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(ink.color) ||
      !Number.isSafeInteger(a.gestureId) || a.gestureId < 1 || a.gestureId > 1e9 ||
      !Number.isSafeInteger(a.chunk) || a.chunk < 0 || a.chunk >= 400 ||
      (a.stroke && typeof a.finished !== 'boolean') ||
      (a.preview && (!Number.isSafeInteger(a.sample) || a.sample < 1 || a.sample > 1e6))) return false;
  const stroke = { ...ink, color: ink.color.toLowerCase(), gestureId: a.gestureId, chunk: a.chunk };
  let active = drawing.inkActive;
  if (!active || active.id !== a.gestureId) {
    if (a.gestureId <= drawing.lastGestureId || a.chunk !== 0) return false;
    if (drawing.preview) appendStroke(drawing, drawing.preview);
    drawing.preview = null;
    active = drawing.inkActive = { id: a.gestureId, chunk: 0, sample: 0, color: stroke.color, size: stroke.size };
    drawing.lastGestureId = a.gestureId;
  }
  if (a.chunk !== active.chunk || stroke.color !== active.color || stroke.size !== active.size) return false;
  if (a.preview) {
    if (a.sample <= active.sample) return false;
    active.sample = a.sample;
    drawing.preview = stroke;
    return false; // Private preview is retained for the deadline, never broadcast.
  }
  appendStroke(drawing, stroke);
  drawing.preview = null;
  active.chunk += 1;
  active.sample = 0;
  if (a.finished || active.chunk >= 400) drawing.inkActive = null;
}

function onConnection(state, ctx) { syncHost(state, ctx); }

function onAction(state, ctx, pid, a) {
  if (!a || typeof a !== 'object' || Array.isArray(a) || !ctx.allPlayers().some(p => p.id === pid)) return false;
  if (state.gone.includes(pid)) state.gone = state.gone.filter((g) => g !== pid); // back from away
  syncHost(state, ctx);
  if (state.endsAt && ctx.now() >= state.endsAt) {
    if (state.phase === 'write') startDraw(state, ctx);
    else if (state.phase === 'draw') startGuess(state, ctx);
    else if (state.phase === 'guess') startReveal(state, ctx);
    else if (state.phase === 'reveal') turnPage(state, ctx, 1);
    return;
  }
  if (state.phase === 'write' && typeof a.phrase === 'string') {
    const t = a.phrase.trim().slice(0, 80);
    if (t) {
      state.phrases[pid] = t;
      state.written[pid] = true;
      advanceIfAllIn(state, ctx);
    }
    return;
  }
  if (a.stroke || a.preview || a.clear || a.undo) {
    if (['stroke', 'preview', 'clear', 'undo'].filter(key => a[key]).length !== 1 ||
        (a.clear && a.clear !== true) || (a.undo && a.undo !== true) ||
        state.phase !== 'draw' || !state.drawings[pid]) return false;
    const out = drawingAction(state.drawings[pid], a);
    if (state.finished[pid]) state.finished[pid] = false; // drawing again reopens the page
    return out;
  }
  if (state.phase === 'draw' && state.drawings[pid] && typeof a.done === 'boolean') {
    if (a.done && !state.drawings[pid].strokes.length) return false; // Done needs some ink
    state.finished[pid] = a.done;
    advanceIfAllIn(state, ctx);
    return;
  }
  if (state.phase === 'guess' && typeof a.guess === 'string') {
    const t = a.guess.trim().slice(0, 80);
    if (t) {
      state.guesses[pid] = t;
      advanceIfAllIn(state, ctx);
    }
    return;
  }
  if (state.phase === 'reveal' && pid === state.hostId && a.next === true) {
    turnPage(state, ctx, 1);
    return;
  }
  if (state.phase === 'reveal' && pid === state.hostId && a.prev === true && state.revealIdx > 0) {
    turnPage(state, ctx, -1);
  }
}

function view(state, pid) {
  const { deal, ...rest } = state;
  const out = {
    round: rest.round,
    rounds: rest.rounds,
    phase: rest.phase,
    endsAt: rest.endsAt,
    hostId: rest.hostId,
    scores: rest.scores,
    gone: rest.gone,
  };
  if (state.phase === 'write') {
    out.myPhrase = state.phrases[pid] || '';
    out.submitted = Object.keys(state.phrases);
    out.suggestions = state.suggestions || [];
  } else if (state.phase === 'draw') {
    const chain = state.drawAssign[pid];
    out.myPrompt = (chain && state.phrases[chain]) || '';
    const drawing = state.drawings[pid];
    out.myStrokes = drawing?.strokes || [];
    if (drawing) {
      out.inkNonce = drawing.inkNonce;
      out.inkRevision = drawing.inkRevision;
      out.lastGestureId = drawing.lastGestureId;
      out.myInkFeedback = drawing.inkFeedback;
    }
    out.drawn = Object.keys(state.drawings).filter(
      (d) => state.drawings[d].strokes.length > 0
    );
    out.finished = Object.keys(state.finished).filter((d) => state.finished[d]);
    out.myDone = !!state.finished[pid];
  } else if (state.phase === 'guess') {
    const drawer = state.guessAssign[pid];
    out.myDrawing = (drawer && state.drawings[drawer] && state.drawings[drawer].strokes) || [];
    out.myGuess = state.guesses[pid] || '';
    out.guessed = Object.keys(state.guesses);
  } else {
    out.chains = state.chains;
    out.revealIdx = state.revealIdx;
  }
  return out;
}

module.exports = { id, minPlayers: 3, maxPlayers: 12, realtime: true, manifest, create, onAction, onConnection, onEnd, onPlayerGone, view, storySurvived };
