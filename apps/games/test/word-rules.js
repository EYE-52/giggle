'use strict';
/* Rules standard for the word and speed games (specs/GAME_RULES_STANDARD.md):
 * points on the standard scale, shared ties, Rounds/Pace settings with every
 * fixed timer paced, End game (onEnd) and leaving players (onPlayerGone).
 * Pure ctx harness with a virtual clock. Run: node test/word-rules.js */

const assert = require('assert');
const registry = require('../games/registry');
const { FakeCtx } = require('./game-playability');
const V = require('../games/_validate');

const IDS = ['trivia', 'scattergories', 'word-chain', 'countdown-word', 'lyric-fill', 'number-hunt',
  'warm-words', 'charades', 'memory-tray', 'reaction-tap', 'typing-race'];

/* A room double whose players() drops seats that left. */
class Ctx extends FakeCtx {
  constructor(n, settings) {
    super(Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), name: ['Ann', 'Bob', 'Cat', 'Dan', 'Eve'][i] })), settings);
    this.goneIds = new Set();
  }
  players() { return this._players.filter((p) => !this.goneIds.has(p.id)); }
  gone(def, state, pid) { this.goneIds.add(pid); def.onPlayerGone(state, this, pid, 'left'); }
  lastTimerMs() { const t = this.timers.filter((x) => !x.dead).at(-1); return t ? t.at - this._now : null; }
}
function start(id, n, settings = {}) {
  const def = registry.get(id);
  const ctx = new Ctx(n, settings);
  const state = def.create(ctx);
  return { def, ctx, state };
}

// ---- Settings: Rounds (where the game has rounds) and Pace come first ----
for (const id of IDS) {
  const def = registry.get(id);
  const keys = def.manifest.settings.map((s) => s.key);
  assert(V.validateManifest(def).ok, `${id} manifest validates`);
  if (id === 'word-chain') {
    assert.deepEqual(keys.slice(0, 1), ['pace'], 'Word Chain is a whole-match game: Pace first, no Rounds');
    assert(!keys.includes('rounds'));
  } else {
    assert.deepEqual(keys.slice(0, 2), ['rounds', 'pace'], `${id}: Rounds and Pace first`);
    const rounds = def.manifest.settings[0];
    assert.equal(rounds.min, 1); assert.equal(rounds.max, 12);
  }
  for (const s of def.manifest.settings) {
    if (/Seconds$/.test(s.key)) assert(/^Seconds (to|per) /.test(s.label), `${id}.${s.key} label "${s.label}"`);
  }
}
assert.equal(registry.get('trivia').manifest.settings[0].def, 8, 'Trivia keeps 8 questions by default');
assert.equal(registry.get('charades').manifest.settings[0].def, null, 'Charades Auto: one turn per player');

// ---- Trivia ----
{
  const { def, ctx, state } = start('trivia', 3, { rounds: 2, answerSeconds: 20, pace: 'Quick' });
  assert.equal(state.rounds, 2);
  assert.equal(state.endsAt - ctx.now(), 20000, 'Seconds to answer setting');
  const pts = def.pointsFor;
  assert.equal(pts(20000, 20000, 1), 150, 'instant correct: 100 + 50 speed');
  assert.equal(pts(0, 20000, 1), 100, 'last-moment correct: 100');
  assert.equal(pts(20000, 20000, 5), 200, 'streak bonus caps the round at 200');
  // Ann answers right instantly, Bob wrong, Cat leaves: no waiting for Cat.
  def.onAction(state, ctx, 'p1', { pick: 0 });
  def.onAction(state, ctx, 'p2', { pick: 1 });
  assert.equal(state.phase, 'answer');
  ctx.gone(def, state, 'p3');
  assert.equal(state.phase, 'reveal', 'a gone player is not waited for');
  assert.equal(state.last.results.p1.pts, 150);
  assert.equal(state.scores.p1, 150);
  assert.equal(ctx.lastTimerMs(), 3000, 'reveal 5 s at Quick pace = 3 s');
  def.onAction(state, ctx, 'p1', { next: true });
  assert.equal(state.round, 2, 'host Next during the reveal');
  def.onEnd(state, ctx, { reason: 'host' });
  assert.equal(state.phase, 'done', 'End game shows the final scores');
  assert.equal(state.scores.p1, 150, 'points so far stay');
}

// ---- Scattergories ----
{
  const { def, ctx, state } = start('scattergories', 3, { pace: 'Relaxed' });
  const L = String(state.letter).toLowerCase();
  def.onAction(state, ctx, 'p1', { answers: [L + 'aa', L + 'bb', L + 'cc', L + 'dd', L + 'ee'], lock: true });
  def.onAction(state, ctx, 'p2', { answers: [L + 'aa', '', '', '', ''], lock: true });
  ctx.gone(def, state, 'p3');
  assert.equal(state.phase, 'reveal', 'gone writer is not waited for');
  assert.equal(state.last.points.p1, 160, '40 per unique answer');
  assert.equal(state.last.points.p2, 0, 'shared answers score nothing');
  assert.equal(state.endsAt - ctx.now(), 15000, 'reveal 10 s at Relaxed pace = 15 s');
  def.onEnd(state, ctx, { reason: 'host' });
  assert.equal(state.phase, 'done');
}

// ---- Word Chain: whole match, places, lives, draws ----
{
  const { def, ctx, state } = start('word-chain', 4, { turnSeconds: 10, pace: 'Quick' });
  assert.equal(state.turnMs, 7000, 'Pace scales the turn time (10 s Quick = 7 s)');
  const first = state.turnPid;
  def.onAction(state, ctx, first, { word: '' });
  assert(!state.alive.includes(first), 'one life: a blank knocks out');
  const second = state.turnPid;
  ctx.advance(state.turnMs); ctx.fireNext();
  assert(!state.alive.includes(second), 'timeout knocks out');
  const third = state.turnPid;
  def.onAction(state, ctx, third, { word: '' });
  assert.equal(state.phase, 'done');
  const winner = state.alive[0];
  assert.equal(state.winner, winner);
  assert.equal(ctx.awards[winner], 300, 'last player standing: 300');
  assert.equal(ctx.awards[third], 200, 'last out: 200');
  assert.equal(ctx.awards[second], 100, 'next: 100');
  assert.equal(ctx.awards[first] || 0, 0, 'first out: 0');
  assert.equal(state.scores[winner], 300, 'match scoreboard');
  assert.deepEqual([state.places[winner], state.places[third], state.places[second], state.places[first]], [1, 2, 3, 4]);
}
{
  const { def, ctx, state } = start('word-chain', 4, { lives: 2 });
  const first = state.turnPid;
  def.onAction(state, ctx, first, { word: '' });
  assert(state.alive.includes(first), 'two lives: first miss keeps the player in');
  assert.equal(state.lives[first], 1);
  assert.notEqual(state.turnPid, first, 'the turn passes on after a lost life');
  // The host ends the match with three players still in: a draw for them.
  const out = state.turnPid;
  ctx.gone(def, state, out);
  assert(!state.alive.includes(out), 'leaving knocks the player out');
  def.onEnd(state, ctx, { reason: 'host' });
  assert.equal(state.phase, 'done');
  for (const pid of state.alive) assert.equal(ctx.awards[pid], 150, 'players still in share first: 150 each');
  assert.equal(ctx.awards[out] || 0, 0, 'a player who left earns no place points');
}

// ---- Word Countdown ----
{
  const { def, ctx, state } = start('countdown-word', 2, { makeSeconds: 45, pace: 'Quick' });
  assert.equal(state.endsAt - ctx.now(), 45000, 'Seconds to build setting');
  assert.equal(def.wordPoints(5, 7), 100, 'five letters: 100');
  assert.equal(def.wordPoints(9, 9), 190, 'nine letters and longest: 190 (≤ 200)');
  assert.equal(def.wordPoints(3, 3), 130, 'tied longest earns the bonus');
  def.onAction(state, ctx, 'p1', { pass: true });
  ctx.gone(def, state, 'p2');
  assert.equal(state.phase, 'reveal');
  assert.equal(state.endsAt - ctx.now(), 5000, 'reveal 8 s at Quick pace = 5 s');
  def.onEnd(state, ctx, { reason: 'host' });
  assert.equal(state.phase, 'done');
}

// ---- Lyric Fill: scoreboard, 100 / 50 ----
{
  const { def, ctx, state } = start('lyric-fill', 3, { rounds: 2, fillSeconds: 30 });
  assert.equal(state.endsAt - ctx.now(), 30000, 'Seconds to answer setting');
  const answer = state.line.answer;
  def.onAction(state, ctx, 'p1', { text: answer });
  def.onAction(state, ctx, 'p2', { text: answer + 'x' });
  ctx.gone(def, state, 'p3');
  assert.equal(state.phase, 'reveal', 'gone player is not waited for');
  assert.equal(state.last.verdicts.p1.pts, 100, 'exact: 100');
  assert.equal(state.last.verdicts.p2.pts, 50, 'close: half credit 50');
  assert.deepEqual(def.view(state, 'p1', ctx).scores, { p1: 100, p2: 50 }, 'Lyric Fill keeps a scoreboard');
  def.onAction(state, ctx, 'p1', { next: true });
  assert.equal(state.round, 2);
  def.onEnd(state, ctx, { reason: 'host' });
  assert.equal(state.phase, 'done');
  assert.equal(def.view(state, 'p2', ctx).scores.p2, 50);
}

// ---- Number Hunt: hunt clock, overtime, host Next ----
{
  const { def, ctx, state } = start('number-hunt', 3, { huntSeconds: 30, pace: 'Relaxed' });
  assert.equal(state.endsAt - ctx.now(), 30000, 'the hunt phase has a clock');
  ctx.advance(30000); ctx.fireNext();
  assert.equal(state.phase, 'roundEnd', 'hunt clock runs out: round over');
  assert.equal(state.last.finished.length, 0, 'nobody found it');
  assert.equal(state.endsAt - ctx.now(), 6000, 'results gap 4 s at Relaxed = 6 s');
  def.onAction(state, ctx, 'p2', { next: true });
  assert.equal(state.phase, 'roundEnd', 'only the host may skip');
  def.onAction(state, ctx, 'p1', { next: true });
  assert.equal(state.phase, 'hunt', 'host Next starts the next number');
  const secret = state.secret;
  def.onAction(state, ctx, 'p1', { guess: secret });
  assert.equal(state.phase, 'overtime');
  assert.equal(state.endsAt - ctx.now(), 15000, 'overtime 10 s at Relaxed = 15 s');
  def.onAction(state, ctx, 'p2', { guess: secret });
  ctx.gone(def, state, 'p3');
  assert.equal(state.phase, 'roundEnd', 'the gone hunter is not waited for');
  assert.equal(state.last.finished[0].pts, 100);
  assert.equal(state.last.finished[1].pts, 100, 'equal tries share first place');
  def.onEnd(state, ctx, { reason: 'host' });
  assert.equal(state.phase, 'done');
}

// ---- Warm Words: 100–200, paced gap, onEnd ----
{
  const { def, ctx, state } = start('warm-words', 2, { pace: 'Quick' });
  def.onAction(state, ctx, 'p1', { guess: state.target });
  assert.equal(state.phase, 'reveal');
  assert.equal(state.last.points, 200, 'instant find: 100 + 100 speed');
  assert.equal(state.endsAt - ctx.now(), 3000, 'gap 5 s at Quick = 3 s');
  def.onEnd(state, ctx, { reason: 'host' });
  assert.equal(state.phase, 'done');
}

// ---- Charades: guesser ≤ 200, actor 50 per guesser, host Next, leaving ----
{
  const { def, ctx, state } = start('charades', 4, { roundSeconds: 60, pace: 'Relaxed' });
  assert.equal(state.rounds, 4, 'Auto: one turn per player');
  assert.equal(def.guessPoints(60000, 60000, 0), 200, 'instant first guess: 100 + 50 + 50');
  assert.equal(def.guessPoints(0, 60000, 2), 100, 'third guess at the buzzer: 100');
  const actor = state.actor;
  const guessers = ['p1', 'p2', 'p3', 'p4'].filter((p) => p !== actor);
  def.onAction(state, ctx, guessers[0], { guess: state.word });
  def.onAction(state, ctx, guessers[1], { guess: state.word });
  assert.equal(state.scores[actor], 100, 'actor: 50 per correct guesser');
  ctx.gone(def, state, guessers[2]);
  assert.equal(state.phase, 'reveal', 'gone guesser is not waited for');
  assert.equal(state.rounds, 3, 'Auto length skips the gone player’s turn');
  assert.equal(state.endsAt - ctx.now(), 8000, 'reveal 5 s at Relaxed = 8 s');
  def.onAction(state, ctx, 'p1', { next: true });
  assert.equal(state.phase, 'act', 'the host can press Next during the reveal');
  assert.notEqual(state.actor, actor);
  assert.notEqual(state.actor, guessers[2], 'a gone player never acts');
  const acting = state.actor;
  ctx.gone(def, state, acting);
  assert.equal(state.phase, 'reveal', 'the actor leaving ends the turn');
  def.onEnd(state, ctx, { reason: 'host' });
  assert.equal(state.phase, 'done');
}

// ---- Memory Tray ----
{
  const { def, ctx, state } = start('memory-tray', 3, { memSeconds: 5, recallSeconds: 10 });
  assert.equal(def.recallPoints(8, 8), 200, 'whole tray: 200');
  assert.equal(def.recallPoints(4, 8), 75, 'half the tray: 75');
  assert.equal(def.recallPoints(0, 8), 0);
  ctx.advance(5000); ctx.fireNext();
  assert.equal(state.phase, 'recall');
  def.onAction(state, ctx, 'p1', { recall: state.items.join(',') });
  def.onAction(state, ctx, 'p2', { recall: state.items.slice(0, 4).join(',') });
  ctx.gone(def, state, 'p3');
  assert.equal(state.phase, 'reveal', 'gone player is not waited for');
  assert.equal(state.last.results.p1.pts, 200);
  assert.equal(state.last.results.p2.pts, 75);
  def.onAction(state, ctx, 'p1', { next: true });
  assert.equal(state.phase, 'memorize');
  def.onEnd(state, ctx, { reason: 'host' });
  assert.equal(state.phase, 'done');
}

// ---- Reaction Tap: paced windows, ties, host Next ----
{
  const { def, ctx, state } = start('reaction-tap', 3, { pace: 'Quick' });
  ctx.fireNext(); // the secret wait ends: green
  assert.equal(state.phase, 'go');
  assert.equal(state.endsAt - ctx.now(), 3000, 'go window 3 s stays 3 s (never below 3)');
  ctx.advance(200);
  def.onAction(state, ctx, 'p1', { tap: true });
  def.onAction(state, ctx, 'p2', { tap: true });
  ctx.gone(def, state, 'p3');
  assert.equal(state.phase, 'roundEnd', 'gone player is not waited for');
  assert.deepEqual(state.last.order.map((t) => t.pts), [100, 100], 'equal times share first place');
  assert.equal(state.endsAt - ctx.now(), 3000, 'results gap 4 s at Quick = 3 s');
  def.onAction(state, ctx, 'p2', { next: true });
  assert.equal(state.phase, 'roundEnd', 'only the host may skip');
  def.onAction(state, ctx, 'p1', { next: true });
  assert.equal(state.phase, 'wait', 'host Next starts the next round');
  def.onEnd(state, ctx, { reason: 'host' });
  assert.equal(state.phase, 'done');
}

// ---- Typing Race ----
{
  const { def, ctx, state } = start('typing-race', 3, { raceSeconds: 30 });
  assert.equal(def.finishPoints(0), 200);
  assert.equal(def.finishPoints(4), 100, 'later finishers: 100');
  ctx.advance(1000);
  def.onAction(state, ctx, 'p1', { typed: state.target });
  ctx.advance(1000);
  def.onAction(state, ctx, 'p2', { typed: state.target });
  ctx.gone(def, state, 'p3');
  assert.equal(state.phase, 'roundEnd', 'gone racer is not waited for');
  assert.deepEqual(state.last.finished.map((f) => f.pts), [200, 175]);
  def.onAction(state, ctx, 'p1', { next: true });
  assert.equal(state.phase, 'race', 'host Next starts the next race');
  def.onEnd(state, ctx, { reason: 'host' });
  assert.equal(state.phase, 'done');
}

console.log('WORD-RULES: PASS (settings, standard points, ties, paced timers, End game, leaving players)');
