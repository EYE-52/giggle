'use strict';
/* Actual checked-in transformer vectors + complete legal gameplay + real
 * Room identity/window tests. Run: node test/warm-words.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cosine, createEmbeddingProvider } = require('../games/engines/semantic-guess');
const def = require('../games/warm-words/server');
const vocabulary = require('../games/warm-words/vocabulary.json');
const data = require('../games/warm-words/embeddings.json');
const info = require('../games/warm-words/model-info.json');
const { Rooms } = require('../server/room');
const { actionWindow } = require('../games/_sdk');

const players = [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Ben' }];
class Clock {
  constructor(settings = {}, pack = { targets: ['car', 'apple'] }) {
    this.time = 1700000000000; this.settingsValue = settings; this.pack = pack;
    this.timers = []; this.awards = {}; this.broadcasts = 0;
  }
  now() { return this.time; }
  settings() { return this.settingsValue; }
  content() { return this.pack; }
  allPlayers() { return players; }
  players() { return players; }
  hostId() { return 'a'; }
  later(ms, fn) { const t = { at: this.time + ms, fn, canceled: false }; this.timers.push(t); return () => { t.canceled = true; }; }
  award(pid, points) { this.awards[pid] = (this.awards[pid] || 0) + points; }
  broadcast() { this.broadcasts += 1; }
  advance(ms = 400) { this.time += ms; }
  fireNext() {
    const timer = this.timers.filter(t => !t.canceled).sort((a, b) => a.at - b.at)[0];
    assert(timer, 'live timer exists'); timer.canceled = true;
    this.time = Math.max(this.time, timer.at); timer.fn(); return timer;
  }
}
const act = (state, ctx, pid, a) => def.onAction(state, ctx, pid, a);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', 'games/warm-words', file))).digest('hex');
function noPrivate(v) {
  for (const key of ['target', 'deal', 'provider', 'vectors', 'guessed', 'roster', 'lastAction', 'errors', 'cancelTimer', 'hintWords']) assert(!(key in v), `${key} stays private`);
  assert(!JSON.stringify(v).includes('vectors'), 'vectors never project');
}
function embeddingChecks() {
  assert.strictEqual(info.model, 'Xenova/all-MiniLM-L6-v2');
  assert.strictEqual(info.revision, '751bff37182d3f1213fa05d7196b954e230abad9');
  assert.strictEqual(info.license, 'Apache-2.0');
  assert.strictEqual(info.libraryVersion, '3.8.1');
  assert.strictEqual(info.pooling, 'mean');
  assert.strictEqual(info.dtype, 'q8');
  assert.strictEqual(info.dimensions, 384);
  assert.strictEqual(info.wordCount, vocabulary.words.length);
  assert.strictEqual(info.targetCount, vocabulary.targets.length);
  assert.strictEqual(info.embeddingsSha256, hash('embeddings.json'));
  assert.strictEqual(info.vocabularySha256, hash('vocabulary.json'));
  assert.strictEqual(info.weightsSha256, 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1');
  assert.strictEqual(info.tokenizerSha256, 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0');
  assert.deepStrictEqual(data.words, vocabulary.words);
  assert(data.words.length >= 1500 && data.words.length <= 2500);
  assert(vocabulary.targets.length >= 80);
  for (const vector of data.vectors) {
    assert.strictEqual(vector.length, 384);
    assert(vector.every(Number.isFinite));
    assert(Math.abs(Math.sqrt(vector.reduce((s, x) => s + x*x, 0)) - 1) < 0.0001);
  }
  const provider = createEmbeddingProvider(data);
  const car = provider.compare('car', 'car');
  const automobile = provider.compare('car', 'automobile');
  const spoon = provider.compare('car', 'spoon');
  assert.strictEqual(car.similarity, 100); assert.strictEqual(car.rank, 1);
  assert(automobile.similarity > 80 && spoon.similarity < 30, 'actual semantic relationship, not spelling');
  assert(automobile.rank < spoon.rank);
  assert.strictEqual(cosine([1, 0], [1, 0]), 1);
  const ranked = provider.neighbors('car');
  assert.strictEqual(ranked.length, provider.size);
  ranked.forEach((entry, i) => { assert.strictEqual(entry.rank, i + 1); if (i) assert(ranked[i-1].cosine >= entry.cosine); });
  assert.throws(() => createEmbeddingProvider({ words: ['car'], vectors: [[2]], dimensions: 1 }), /normalized/);
  assert.throws(() => createEmbeddingProvider({ words: ['car'], vectors: [[NaN]], dimensions: 1 }), /Invalid/);
  console.log('SEMANTIC actual embeddings:', automobile.similarity, 'car/automobile;', spoon.similarity, 'car/spoon;', data.words.length, 'words');
}
function gameChecks() {
  const ctx = new Clock({ rounds: 2, roundSeconds: 30, hints: true });
  const state = def.create(ctx);
  assert.strictEqual(state.phase, 'guess');
  noPrivate(def.view(state, 'a'));
  assert.strictEqual(def.view(state, 'a').hintsEnabled, true);
  assert.strictEqual(def.view(state, 'a').hintCost, 50);
  const snapshot = JSON.stringify(def.view(state, 'a'));
  for (const action of [{}, [], { guess: 1 }, { next: 1 }, { hint: 0 }, { score: 999, vectors: [1] }]) act(state, ctx, 'a', action);
  act(state, ctx, 'ghost', { guess: state.target });
  assert.strictEqual(JSON.stringify(def.view(state, 'a')), snapshot);
  act(state, ctx, 'a', { guess: 'no-such-word' });
  assert(/one English word/.test(def.view(state, 'a').myError.message));
  ctx.advance(); act(state, ctx, 'a', { guess: 'qwertyword' });
  assert(/outside/.test(def.view(state, 'a').myError.message));
  assert.strictEqual(def.view(state, 'b').myError, null, 'errors are private');
  assert.strictEqual(state.history.length, 0);
  ctx.advance(); act(state, ctx, 'a', { guess: 'spoon', similarity: 100, rank: 1, vectors: [1] });
  assert(state.history[0].rank > 1 && state.history[0].similarity < 100, 'forged score ignored');
  act(state, ctx, 'a', { guess: 'automobile' });
  assert.strictEqual(state.history.length, 1, 'cooldown enforced');
  ctx.advance(); act(state, ctx, 'a', { guess: ' SPOON ' });
  assert.strictEqual(state.history.length, 1, 'per-player duplicate blocked');
  assert(/already/.test(def.view(state, 'a').myError.message));
  act(state, ctx, 'b', { guess: 'spoon' });
  assert.strictEqual(state.history.length, 2, 'peer may submit same guess');
  ctx.advance(); act(state, ctx, 'a', { hint: true });
  const hint = state.history[state.history.length - 1];
  assert(hint.hint && hint.rank > 1 && hint.word !== state.target);
  assert.strictEqual(state.hintsUsed, 1);
  assert(!JSON.stringify(def.view(state, 'b')).includes(`"target":"${state.target}"`));
  ctx.advance(); act(state, ctx, 'b', { hint: true });
  const secondHint = state.history[state.history.length - 1];
  assert(secondHint.hint && secondHint.word !== hint.word && secondHint.word !== state.target);
  ctx.advance(); act(state, ctx, 'a', { hint: true });
  assert.strictEqual(state.hintsUsed, 2);
  // PEEK only to simulate a knowledgeable solver, after valid semantic guesses.
  act(state, ctx, 'a', { guess: state.target });
  assert.strictEqual(state.phase, 'reveal');
  assert(state.last.points <= 200 && state.last.points >= 25, 'two hints reduce prize by100');
  assert.strictEqual(ctx.awards.a, state.last.points);
  const won = ctx.awards.a;
  act(state, ctx, 'b', { guess: state.target });
  assert.strictEqual(ctx.awards.a, won); assert.strictEqual(ctx.awards.b, undefined, 'only first correct wins');
  act(state, ctx, 'b', { next: true }); assert.strictEqual(state.round, 1, 'next is host-only');
  const oldTimers = ctx.timers.slice();
  act(state, ctx, 'a', { next: true });
  assert.strictEqual(state.round, 2); assert.strictEqual(state.phase, 'guess');
  oldTimers.forEach(t => t.fn());
  assert.strictEqual(state.round, 2); assert.strictEqual(state.phase, 'guess', 'stale timers are inert');
  noPrivate(def.view(state, 'a'));
  act(state, ctx, 'b', { guess: 'automobile' }); ctx.advance();
  act(state, ctx, 'b', { guess: state.target });
  assert.strictEqual(state.phase, 'reveal');
  act(state, ctx, 'a', { next: true }); assert.strictEqual(state.phase, 'done');
  assert.strictEqual(state.results.length, 2);
  const scores = { ...ctx.awards };
  ctx.timers.forEach(t => t.fn()); assert.deepStrictEqual(ctx.awards, scores);
  def.dispose(state);
  const timeoutCtx = new Clock({ rounds: 1, roundSeconds: 30 });
  const timeoutState = def.create(timeoutCtx);
  act(timeoutState, timeoutCtx, 'a', { hint: true }); assert.strictEqual(timeoutState.hintsUsed, 0, 'hints default off');
  timeoutCtx.time = timeoutState.endsAt;
  act(timeoutState, timeoutCtx, 'a', { guess: timeoutState.target });
  assert.strictEqual(timeoutState.phase, 'reveal'); assert.strictEqual(timeoutState.last.winner, null, 'deadline beats late answer');
  timeoutCtx.fireNext(); assert.strictEqual(timeoutState.phase, 'done');
  const customCtx = new Clock({}, { targets: ['car', 'qwertyword'] });
  const custom = def.create(customCtx);
  assert.strictEqual(custom.target, 'car'); assert(/skipped/.test(custom.contentNote)); def.dispose(custom);
  const feedCtx = new Clock({ roundSeconds: 300, hints: true });
  const feedState = def.create(feedCtx);
  act(feedState, feedCtx, 'b', { hint: true });
  const earlyHint = feedState.history.at(-1).word;
  for (const word of vocabulary.words.filter(w => w !== feedState.target).slice(0, 220)) { act(feedState, feedCtx, 'a', { guess: word }); feedCtx.advance(); }
  assert.strictEqual(feedState.history.length, 200, 'shared history bounded');
  assert(!feedState.history.some(entry => entry.hint), 'old hint fell out of bounded feed');
  act(feedState, feedCtx, 'b', { hint: true });
  assert.notStrictEqual(feedState.history.at(-1).word, earlyHint, 'hint remains new even after feed truncation');
  def.dispose(feedState);
  console.log('SEMANTIC legal 2-round play, hints/cost, validation, deadline, history and disposal PASS');
}

function hostMigrationChecks() {
  const ctx = new Clock({ rounds: 2, roundSeconds: 30, hints: true });
  let host = 'a'; ctx.hostId = () => host;
  const state = def.create(ctx);
  assert.strictEqual(def.view(state, 'a', ctx).hostId, 'a');
  host = 'b';
  ctx.fireNext(); // Natural deadline without a player action to refresh saved authority.
  assert.strictEqual(state.phase, 'reveal');
  assert.strictEqual(state.hostId, 'a', 'projection must not mutate saved state');
  assert.strictEqual(def.view(state, 'b', ctx).hostId, 'b', 'quiet elected host owns reveal controls');
  assert.strictEqual(def.view(state, 'a', ctx).hostId, 'b', 'former host no longer receives reveal authority');
  assert.strictEqual(def.view(state, 'watcher', ctx).hostId, 'b');
  noPrivate(def.view(state, 'watcher', ctx));
  act(state, ctx, 'a', { next: true });
  assert.strictEqual(state.round, 1, 'former host cannot advance');
  act(state, ctx, 'b', { next: true });
  assert.strictEqual(state.round, 2, 'current host advances');
  ctx.fireNext();
  act(state, ctx, 'b', { next: true });
  assert.strictEqual(state.phase, 'done');
  assert.deepStrictEqual(state.scores, {}, 'timeout migration does not fabricate scores');
  const rematch = def.create(ctx);
  assert.strictEqual(rematch.hostId, 'b', 'rematch begins with elected authority');
  assert.strictEqual(def.view(rematch, 'b').hostId, 'b', 'legacy isolated projections retain stored fallback');
  def.dispose(rematch); def.dispose(state);
  console.log('SEMANTIC quiet host migration: projection, former/current permissions, timeout scores and rematch PASS');
}

async function roomChecks() {
  const realSet = global.setTimeout, realClear = global.clearTimeout;
  const timers = new Map(); let seq = 0;
  global.setTimeout = fn => { const id = ++seq; timers.set(id, fn); return id; };
  global.clearTimeout = id => timers.delete(id);
  const socket = () => ({ readyState: 1, bufferedAmount: 0, messages: [], send(text) { this.messages.push(JSON.parse(text)); }, close() { this.readyState = 3; } });
  const drain = () => new Promise(resolve => setImmediate(resolve));
  const rooms = new Rooms({ 'warm-words': { targets: ['car', 'apple'] } });
  const room = rooms.create(); const a = socket(), b = socket();
  const host = room.addPlayer('Host', a).player, peer = room.addPlayer('Peer', b).player;
  const meta = () => ({ i: room.game.instanceId, w: actionWindow(room.game.state) });
  try {
    assert(room.startGame(def, { settings: { rounds: 2, roundSeconds: 30, hints: true } }, host.id).ok);
    await drain();
    const token = meta(); const first = room.game.state.target;
    const unknown = socket(), attacker = room.addPlayer('Host', unknown).player;
    assert.notStrictEqual(attacker.id, host.id, 'same name does not seize host identity');
    room.onAction(unknown, { guess: first }, token); assert.strictEqual(room.game.state.phase, 'guess', 'spectator cannot answer');
    room.onAction(a, { guess: first }, token);
    room.onAction(b, { guess: first }, token);
    assert.strictEqual(room.game.state.phase, 'reveal');
    assert(room.totals[host.id] > 0); assert(!room.totals[peer.id]);
    room.onAction(a, { next: true }, meta()); await drain();
    assert.strictEqual(room.game.state.round, 2);
    room.onAction(b, { guess: room.game.state.target }, token);
    assert.strictEqual(room.game.state.phase, 'guess', 'stale window dropped');
    const resume = socket(); room.addPlayer('Host', resume, host.token);
    assert.strictEqual(host.socket, resume, 'real token resumes original seat');
    room.onAction(a, { guess: room.game.state.target }, meta());
    assert.strictEqual(room.game.state.phase, 'guess', 'old resumed socket cannot act');
    room.onAction(resume, { guess: room.game.state.target }, meta());
    room.onAction(resume, { next: true }, meta()); await drain();
    assert.strictEqual(room.game.state.phase, 'done');
    const oldInstance = meta(); const total = room.totals[host.id];
    assert(room.startGame(def, {}, host.id).ok); await drain();
    assert.notStrictEqual(room.game.instanceId, oldInstance.i);
    assert.strictEqual(room.game.state.round, 1, 'rematch resets rounds');
    assert.deepStrictEqual(room.game.state.scores, {}, 'rematch clears game scores');
    room.onAction(resume, { guess: room.game.state.target }, oldInstance);
    assert.strictEqual(room.game.state.phase, 'guess', 'stale rematch action dropped');
    assert.strictEqual(room.totals[host.id], total);
    const publicState = resume.messages.filter(m => m.t === 'state').at(-1);
    noPrivate(publicState);
    assert(!('targets' in publicState));
    room.endGameToLobby(host.id);
    assert.strictEqual(timers.size, 0, 'Room cancels game timers');
    console.log('SEMANTIC real Room: first award once, token resume, spectator, stale window/instance and rematch PASS');
  } finally {
    room.clearTimers(); global.setTimeout = realSet; global.clearTimeout = realClear;
  }
}

(async () => { embeddingChecks(); gameChecks(); hostMigrationChecks(); await roomChecks(); console.log('WARM_WORDS_PASS'); })().catch(error => { console.error('WARM_WORDS_FAIL', error); process.exitCode = 1; });
