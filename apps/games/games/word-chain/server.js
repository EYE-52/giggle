'use strict';
/* Word Chain checks spelling offline; players judge the relationship.
 * Unsupported spellings can be retried without extending the turn clock.
 * Whole-match game (rules standard): last player standing wins 300; the
 * others place by when they went out (200, 100, then 0). A host who ends
 * the match early makes everyone still in the chain share first place
 * (a draw: 150 each). */
const { pick, paceSetting, paced } = require('../_sdk');
const { createWordValidator, normalizeWord } = require('../engines/english-dictionary');
const id = 'word-chain';
const manifest = {
  players: { min: 3, max: 20 },
  settings: [
    paceSetting(),
    { key: 'lives', label: 'Lives', type: 'int', min: 1, max: 3, def: 1 },
    { key: 'turnSeconds', label: 'Seconds per turn', type: 'int', min: 5, max: 60, def: 10 },
  ],
  packs: {
    starters: { label: 'Custom starter words', type: 'string[]', minItems: 3, maxLen: 24 },
    words: { label: 'Extra accepted words (letters A–Z)', type: 'string[]', minItems: 1, maxItems: 200, maxLen: 24 },
  },
  howto: 'On your turn, say a supported English word related to the last word before time runs out. Unsupported spellings get feedback and you may retry on the same clock. A repeat, a blank or running out of time costs a life; with no lives left you are out. The offline dictionary checks spelling; the room judges the relationship. A majority of the players still in may challenge the previous word, which costs its author a life. Pace scales the turn time. Last player standing earns 300 points; the next places earn 200 and 100.',
};
const PLACE_PTS = [300, 200, 100];
const DRAW_PTS = 150;
function cancel(state) {
  if (typeof state.cancelTimer === 'function') state.cancelTimer();
  state.cancelTimer = null;
}
function create(ctx) {
  const pack = ctx.content(id) || {};
  const ps = ctx.allPlayers();
  const settings = ctx.settings ? ctx.settings() : {};
  const starters = (Array.isArray(pack.starters) ? pack.starters : ['apple']).map(word => normalizeWord(word)).filter(Boolean);
  const extra = (Array.isArray(pack.words) ? pack.words : []).map(word => normalizeWord(word)).filter(Boolean);
  const seed = pick(starters.length ? starters : ['apple']);
  const maxLives = settings.lives ?? 1;
  const state = {
    phase: 'play', turnMs: paced(settings, settings.turnSeconds ?? 10) * 1000,
    rules: pack.rules || 'Say a supported English word related to the last word. The room judges the relationship.',
    alive: ps.map(player => player.id), out: [], turnIdx: 0, turnPid: null,
    turnNo: 0, current: seed, used: [seed], author: null, challenges: {},
    maxLives, lives: Object.fromEntries(ps.map(player => [player.id, maxLives])),
    lastOut: null, lastLife: null, winner: null, winners: [], places: {}, scores: {}, endsAt: 0,
    hostId: ctx.hostId ? ctx.hostId() : ps[0].id,
    validator: createWordValidator([...starters, ...extra]), feedback: Object.create(null), cancelTimer: null,
    contentNote: (Array.isArray(pack.starters) && starters.length < pack.starters.length) ||
      (Array.isArray(pack.words) && extra.length < pack.words.length) ? 'Some custom entries were skipped: use one word with letters A–Z only, at most 24 letters.' : '',
  };
  seatNext(state, ctx);
  return state;
}
function seatNext(state, ctx) {
  cancel(state);
  if (state.alive.length <= 1) { finish(state, ctx); return; }
  state.turnIdx %= state.alive.length;
  state.turnPid = state.alive[state.turnIdx]; state.turnNo += 1;
  state.feedback = Object.create(null);
  state.endsAt = ctx.now() + state.turnMs;
  const pid = state.turnPid, turnNo = state.turnNo;
  state.cancelTimer = ctx.later(state.turnMs, () => {
    if (state.phase !== 'play' || state.turnPid !== pid || state.turnNo !== turnNo) return;
    eliminate(state, ctx, pid, 'timeout'); ctx.broadcast();
  });
}
/* A miss costs a life; the last life knocks the player out. 'left' always
 * knocks out. The turn passes on either way. */
function eliminate(state, ctx, pid, reason) {
  const index = state.alive.indexOf(pid);
  if (index < 0 || state.phase !== 'play') return;
  const wasTurn = state.turnPid === pid;
  const lives = reason === 'left' ? 0 : Math.max(0, (state.lives[pid] ?? 1) - 1);
  state.lives[pid] = lives;
  if (lives > 0) {
    state.lastLife = { pid, reason, lives };
    state.lastOut = null;
    if (wasTurn) {
      state.turnIdx = (index + 1) % state.alive.length;
      seatNext(state, ctx);
    }
    return;
  }
  state.alive.splice(index, 1); state.out.push(pid); state.lastOut = { pid, reason };
  state.lastLife = null;
  if (reason === 'left') state.leftIds = [...(state.leftIds || []), pid];
  delete state.challenges[pid];
  if (state.alive.length <= 1) { finish(state, ctx); return; }
  if (wasTurn) {
    state.turnIdx = index % state.alive.length;
    seatNext(state, ctx);
  } else {
    // A challenged previous author cannot buy the current player extra time.
    state.turnIdx = state.alive.indexOf(state.turnPid);
  }
}
/* Places: everyone still in shares first (one survivor: 300; several: a
 * draw, 150 each); the others rank by when they went out, latest first.
 * Players who left the match earn no place points. */
function placeAll(state, ctx) {
  const places = {};
  const award = (pid, pts) => {
    if (!pts) return;
    state.scores[pid] = (state.scores[pid] || 0) + pts;
    ctx.award(pid, pts);
  };
  const first = state.alive.slice();
  for (const pid of first) places[pid] = 1;
  for (const pid of first) award(pid, first.length === 1 ? PLACE_PTS[0] : DRAW_PTS);
  let place = first.length + 1;
  const left = new Set(state.leftIds || []);
  for (const pid of [...state.out].reverse()) {
    places[pid] = place;
    if (!left.has(pid)) award(pid, PLACE_PTS[place - 1] || 0);
    place += 1;
  }
  state.places = places;
  state.winners = first;
}
function finish(state, ctx) {
  if (state.phase === 'done') return;
  cancel(state); state.phase = 'done';
  state.winner = state.alive.length === 1 ? state.alive[0] : null;
  state.turnPid = null; state.endsAt = 0;
  placeAll(state, ctx);
}
function onAction(state, ctx, pid, action) {
  if (!action || typeof action !== 'object' || Array.isArray(action) || state.phase !== 'play' || !state.alive.includes(pid)) return;
  const isWord = pid === state.turnPid && typeof action.word === 'string';
  const isChallenge = action.challenge === true && state.author && pid !== state.author && state.alive.includes(state.author);
  if (!isWord && !isChallenge) return;
  if (ctx.now() >= state.endsAt) { eliminate(state, ctx, state.turnPid, 'timeout'); return; }
  if (isWord) {
    if (!action.word.trim()) { eliminate(state, ctx, pid, 'empty'); return; }
    const result = state.validator.validate(action.word);
    if (!result.ok) { state.feedback[pid] = result; return; }
    const word = result.word;
    if (state.used.includes(word)) { eliminate(state, ctx, pid, 'repeat'); return; }
    state.used.push(word); state.current = word; state.author = pid; state.challenges = {};
    state.lastLife = null;
    state.turnIdx = (state.alive.indexOf(pid) + 1) % state.alive.length;
    seatNext(state, ctx);
    return;
  }
  if (isChallenge) {
    state.challenges[pid] = true;
    if (Object.keys(state.challenges).length > state.alive.length / 2) {
      const author = state.author;
      state.used.pop(); state.current = state.used.at(-1) || null;
      state.author = null; state.challenges = {};
      eliminate(state, ctx, author, 'challenged');
    }
  }
}
/* Leaving (or staying away) knocks the player out; their turn passes on. */
function onPlayerGone(state, ctx, pid) {
  if (state.phase !== 'play') return;
  if (state.author === pid) { state.author = null; state.challenges = {}; }
  delete state.challenges[pid];
  eliminate(state, ctx, pid, 'left');
}
/* End game: whoever is still in shares first place. */
function onEnd(state, ctx) {
  if (state.phase === 'done') return;
  cancel(state); state.phase = 'done';
  state.winner = state.alive.length === 1 ? state.alive[0] : null;
  state.turnPid = null; state.endsAt = 0;
  placeAll(state, ctx);
}
function view(state, pid) {
  const { validator, feedback, cancelTimer, ...publicState } = state;
  return { ...publicState, challenged: !!state.challenges[pid], myFeedback: feedback[pid] || null };
}
module.exports = { id, minPlayers: 3, maxPlayers: 20, manifest, create, onAction, onPlayerGone, onEnd, view, dispose: cancel };
