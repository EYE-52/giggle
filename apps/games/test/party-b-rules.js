'use strict';
/* Rules standard for Two Truths, Punchline, Bluff, Story Builder, Emoji
 * Story, Compliment Battle, Roast Toast and Five Second Rule
 * (specs/GAME_RULES_STANDARD.md): shared Rounds/Pace settings, paced
 * timers, round points on the 100/+100/50 scale awarded when earned, ties
 * scored alike, the host can move on from every reveal, End game shows the
 * game's own final screen, and players who leave are skipped, not waited for.
 * Run: node test/party-b-rules.js */
const assert = require('node:assert/strict');
const { validateManifest } = require('../games/_validate');

const GAMES = ['two-truths', 'funny-answer', 'bluff', 'story-builder', 'emoji-story', 'compliment-battle', 'roast-toast', 'five-second'];
const load = (id) => require('../games/' + id + '/server');

class Ctx {
  constructor(n, settings = {}) {
    this.list = Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), name: 'P' + (i + 1) }));
    this.gone = new Set();
    this.time = 1000;
    this.timers = [];
    this.awards = {};
    this.awardLog = [];
    this.set = settings;
    this.host = 'p1';
  }
  allPlayers() { return this.list.slice(); }
  players() { return this.list.filter((p) => !this.gone.has(p.id)); }
  settings() { return { ...this.set }; }
  content() { return { prompts: ['Prompt one', 'Prompt two'], starters: ['Starter'], seeds: ['Once upon a time.'], fillers: ['Filler line.'], phrases: [{ phrase: 'Pizza party', aliases: [] }], facts: [{ prompt: 'The sky is ___', truth: 'blue' }], categories: ['Animals', 'Fruits', 'Cars', 'Songs', 'Books'], ideas: ['Travel'] }; }
  hostId() { return this.host; }
  now() { return this.time; }
  later(ms, fn) { this.timers.push({ at: this.time + ms, ms, fn }); }
  broadcast() {}
  award(pid, n) { this.awards[pid] = (this.awards[pid] || 0) + n; this.awardLog.push([pid, n]); }
  lastMs() { return this.timers.at(-1).ms; }
  fire() {
    this.timers.sort((a, b) => a.at - b.at);
    const t = this.timers.shift();
    this.time = Math.max(this.time, t.at);
    t.fn();
  }
  leave(def, state, pid) { this.gone.add(pid); def.onPlayerGone(state, this, pid, 'left'); }
}

let checks = 0;
const check = (name, fn) => { fn(); checks++; };

/* ---- settings: Rounds and Pace first, same labels everywhere ---- */
for (const id of GAMES) check(id + ' settings', () => {
  const def = load(id);
  assert.deepEqual(validateManifest(def), { ok: true });
  const [rounds, pace, ...own] = def.manifest.settings;
  assert.equal(rounds.key, 'rounds'); assert.equal(rounds.label, 'Rounds');
  assert.equal(rounds.min, 1); assert.equal(rounds.max, 12);
  assert.equal(pace.key, 'pace'); assert.deepEqual(pace.options, ['Relaxed', 'Normal', 'Quick']);
  for (const s of own) assert.match(s.label, /^Seconds (to|per) /, id + ' timer labels read "Seconds to …"');
  assert.equal(typeof def.onEnd, 'function', id + ' has onEnd');
  assert.equal(typeof def.onPlayerGone, 'function', id + ' has onPlayerGone');
});

/* ---- Pace scales the fixed timers (vote, reveal…) ---- */
const voteTimer = {
  'two-truths': (d, s, c) => { d.onAction(s, c, s.subject, { statements: ['a', 'b', 'c'], lie: 0 }); },
  'funny-answer': (d, s, c) => { for (const p of c.players()) d.onAction(s, c, p.id, { answer: 'ans ' + p.id }); },
  'bluff': (d, s, c) => { for (const p of c.players()) d.onAction(s, c, p.id, { fake: 'fake ' + p.id }); },
  'compliment-battle': (d, s, c) => { for (const p of c.players()) if (p.id !== s.target) d.onAction(s, c, p.id, { entry: 'kind ' + p.id }); },
  'roast-toast': (d, s, c) => { for (const p of c.players()) if (p.id !== s.target) d.onAction(s, c, p.id, { entry: 'roast ' + p.id }); },
};
const VOTE_BASE = { 'two-truths': 25, 'funny-answer': 25, bluff: 25, 'compliment-battle': 30, 'roast-toast': 30 };
for (const id of Object.keys(voteTimer)) check(id + ' paced vote timer', () => {
  for (const [pace, f] of [['Relaxed', 1.5], ['Normal', 1], ['Quick', 0.67]]) {
    const def = load(id), ctx = new Ctx(4, { pace }), s = def.create(ctx);
    voteTimer[id](def, s, ctx);
    assert.equal(ctx.lastMs(), Math.max(3, Math.round(VOTE_BASE[id] * f)) * 1000, id + ' ' + pace);
  }
});
check('emoji-story paced emoji window', () => {
  for (const [pace, ms] of [['Relaxed', 68000], ['Normal', 45000], ['Quick', 30000]]) {
    const ctx = new Ctx(3, { pace }); load('emoji-story').create(ctx);
    assert.equal(ctx.lastMs(), ms);
  }
});
check('five-second paced answer window', () => {
  for (const [pace, ms] of [['Relaxed', 8000], ['Normal', 5000], ['Quick', 3000]]) {
    const ctx = new Ctx(3, { pace }); load('five-second').create(ctx);
    assert.equal(ctx.lastMs(), ms);
  }
});
check('story-builder paced vote and reveal', () => {
  const def = load('story-builder'), ctx = new Ctx(3, { pace: 'Quick', turnSeconds: 20 }), s = def.create(ctx);
  assert.equal(ctx.lastMs(), 20000, 'own "Seconds per turn" is not scaled');
  while (s.phase === 'build') def.onAction(s, ctx, s.turn, { line: 'Line by ' + s.turn });
  assert.equal(ctx.lastMs(), 17000);
  for (const p of ctx.players()) def.onAction(s, ctx, p.id, { vote: s.lines.findIndex((l) => l.pid !== p.id) });
  assert.equal(s.phase, 'reveal'); assert.equal(ctx.lastMs(), 7000);
});
check('bluff and emoji-story gained their own timer settings', () => {
  let ctx = new Ctx(3, { writeSeconds: 30 }); load('bluff').create(ctx); assert.equal(ctx.lastMs(), 30000);
  const def = load('emoji-story'); ctx = new Ctx(3, { guessSeconds: 20 }); const s = def.create(ctx);
  def.onAction(s, ctx, s.director, { emoji: '🍕🎉' }); assert.equal(ctx.lastMs(), 20000);
});

/* ---- points: capped per round, ties alike, awarded per round ---- */
check('funny-answer tie: both winners same points, votes capped at 100', () => {
  const def = load('funny-answer'), ctx = new Ctx(4, { rounds: 2 }), s = def.create(ctx);
  for (const p of ctx.players()) def.onAction(s, ctx, p.id, { answer: 'ans ' + p.id });
  const aid = (pid) => s.options.find((o) => o.pid === pid).aid;
  // p1 and p2 each get two votes: a tie for funniest.
  def.onAction(s, ctx, 'p1', { vote: aid('p2') });
  def.onAction(s, ctx, 'p2', { vote: aid('p1') });
  def.onAction(s, ctx, 'p3', { vote: aid('p1') });
  def.onAction(s, ctx, 'p4', { vote: aid('p2') });
  assert.equal(s.phase, 'reveal');
  assert.equal(s.last.winners.length, 2);
  assert.deepEqual(s.scores, { p1: 200, p2: 200 }, 'tied winners: 100 for votes + 100 win, each');
  assert.deepEqual(ctx.awards, s.scores, 'awarded in the round, not at the end');
  assert.deepEqual(s.last.points, { p1: 200, p2: 200 });
});
check('funny-answer many votes never exceed 200 a round', () => {
  const def = load('funny-answer'), ctx = new Ctx(6, { rounds: 1 }), s = def.create(ctx);
  for (const p of ctx.players()) def.onAction(s, ctx, p.id, { answer: 'ans ' + p.id });
  const a1 = s.options.find((o) => o.pid === 'p1').aid, a2 = s.options.find((o) => o.pid === 'p2').aid;
  for (const p of ctx.players()) def.onAction(s, ctx, p.id, { vote: p.id === 'p1' ? a2 : a1 });
  assert.equal(s.scores.p1, 200); assert.equal(s.scores.p2, 50);
});
check('story-builder tie scores alike and caps votes', () => {
  const def = load('story-builder'), ctx = new Ctx(4, { rounds: 1 }), s = def.create(ctx);
  while (s.phase === 'build') def.onAction(s, ctx, s.turn, { line: 'Line by ' + s.turn });
  const idx = (pid) => s.lines.findIndex((l) => l.pid === pid);
  def.onAction(s, ctx, 'p1', { vote: idx('p2') });
  def.onAction(s, ctx, 'p2', { vote: idx('p1') });
  def.onAction(s, ctx, 'p3', { vote: idx('p1') });
  def.onAction(s, ctx, 'p4', { vote: idx('p2') });
  assert.equal(s.phase, 'reveal');
  assert.deepEqual(s.scores, { p1: 200, p2: 200 });
});
for (const id of ['compliment-battle', 'roast-toast']) check(id + ' tie: every tied writer earns 100', () => {
  const def = load(id), ctx = new Ctx(5, { rounds: 1 }), s = def.create(ctx);
  const writers = ctx.players().filter((p) => p.id !== s.target).map((p) => p.id);
  for (const w of writers) def.onAction(s, ctx, w, { entry: 'entry ' + w });
  const at = (pid) => s.order.indexOf(pid);
  const [a, b, c, d] = writers;
  def.onAction(s, ctx, a, { vote: at(b) });
  def.onAction(s, ctx, b, { vote: at(a) });
  def.onAction(s, ctx, c, { vote: at(a) });
  def.onAction(s, ctx, d, { vote: at(b) });
  if (id === 'compliment-battle') def.onAction(s, ctx, s.target, { vote: at(c) });
  else def.onAction(s, ctx, s.target, { pick: at(a) });
  assert.equal(s.phase, 'reveal');
  const want = id === 'roast-toast' ? { [a]: 200, [b]: 100 } : { [a]: 100, [b]: 100 };
  assert.deepEqual(s.scores, want);
  assert.deepEqual(ctx.awards, want);
});
check('roast-toast crown is 100, so one writer earns at most 200 a round', () => {
  const def = load('roast-toast'), ctx = new Ctx(3, { rounds: 1 }), s = def.create(ctx);
  const [a, b] = ctx.players().filter((p) => p.id !== s.target).map((p) => p.id);
  def.onAction(s, ctx, a, { entry: 'roast a' }); def.onAction(s, ctx, b, { entry: 'roast b' });
  def.onAction(s, ctx, a, { vote: s.order.indexOf(b) });
  def.onAction(s, ctx, b, { vote: s.order.indexOf(a) });
  def.onAction(s, ctx, s.target, { pick: s.order.indexOf(a) });
  assert.equal(s.phase, 'reveal');
  assert.equal(s.scores[a], 200);
});
check('two-truths writer earns 50 per fooled player, at most 200', () => {
  const def = load('two-truths'), ctx = new Ctx(7, { rounds: 1 }), s = def.create(ctx);
  def.onAction(s, ctx, s.subject, { statements: ['a', 'b', 'c'], lie: 2 });
  const voters = ctx.players().filter((p) => p.id !== s.subject);
  voters.forEach((p, i) => def.onAction(s, ctx, p.id, { vote: i === 0 ? 2 : 0 }));
  assert.equal(s.phase, 'reveal');
  assert.equal(s.scores[s.subject], 200, '5 fooled is capped at 200');
  assert.equal(s.scores[voters[0].id], 100);
});
check('bluff fooled votes cap at 100 on top of 100 for the truth', () => {
  const def = load('bluff'), ctx = new Ctx(5, { rounds: 1 }), s = def.create(ctx);
  for (const p of ctx.players()) def.onAction(s, ctx, p.id, { fake: 'fake ' + p.id });
  const truth = s.options.find((o) => o.pid === null).oid, p1 = s.options.find((o) => o.pid === 'p1').oid;
  def.onAction(s, ctx, 'p1', { pick: truth });
  for (const pid of ['p2', 'p3', 'p4', 'p5']) def.onAction(s, ctx, pid, { pick: p1 });
  assert.equal(s.phase, 'reveal');
  assert.equal(s.scores.p1, 200);
});
check('emoji-story solver at most 200, storyteller 50 each up to 200', () => {
  const def = load('emoji-story'), ctx = new Ctx(6, { rounds: 1 }), s = def.create(ctx);
  def.onAction(s, ctx, s.director, { emoji: '🍕🎉' });
  const guessers = ctx.players().filter((p) => p.id !== s.director);
  for (const p of guessers) def.onAction(s, ctx, p.id, { guess: 'pizza party' });
  assert.equal(s.phase, 'reveal');
  for (const p of guessers) assert(s.scores[p.id] >= 100 && s.scores[p.id] <= 200, 'solver ' + s.scores[p.id]);
  assert.equal(s.scores[guessers[0].id], 200, 'instant first solver: 100 + 75 speed + 25 first');
  assert.equal(s.scores[s.director], 200, '5 solvers capped at 200');
});
check('five-second streak bonus caps at +100', () => {
  const def = load('five-second'), ctx = new Ctx(3, { rounds: 12 }), s = def.create(ctx);
  const gains = {};
  while (s.phase !== 'done') {
    const perf = s.performer, before = s.scores[perf] || 0;
    def.onAction(s, ctx, perf, { answers: 'a, b, c' });
    for (const p of ctx.players()) if (p.id !== perf) def.onAction(s, ctx, p.id, { vote: 'pass' });
    (gains[perf] = gains[perf] || []).push(s.scores[perf] - before);
    def.onAction(s, ctx, 'p1', { next: true });
  }
  for (const g of Object.values(gains)) assert.deepEqual(g, [100, 125, 150, 175]);
  const ctx2 = new Ctx(2, { rounds: 7 }); ctx2.list.push({ id: 'p3' });
  const s2 = def.create(ctx2), perf = s2.performer, seen = [];
  for (let i = 0; i < 7 && s2.phase !== 'done'; i++) {
    const before = s2.scores[perf] || 0;
    s2.performer = perf;
    def.onAction(s2, ctx2, perf, { answers: 'a, b, c' });
    for (const p of ctx2.players()) if (p.id !== perf) def.onAction(s2, ctx2, p.id, { vote: 'pass' });
    seen.push(s2.scores[perf] - before);
    def.onAction(s2, ctx2, 'p1', { next: true });
  }
  assert.equal(Math.max(...seen), 200, 'a long streak never earns more than 200 in a round');
});

/* ---- host can always press Next during a reveal; lead player too ---- */
const toReveal = {
  'two-truths': (d, s, c) => { d.onAction(s, c, s.subject, { statements: ['a', 'b', 'c'], lie: 0 }); for (const p of c.players()) if (p.id !== s.subject) d.onAction(s, c, p.id, { vote: 1 }); return s.subject; },
  'emoji-story': (d, s, c) => { d.onAction(s, c, s.director, { emoji: '🍕' }); for (const p of c.players()) if (p.id !== s.director) d.onAction(s, c, p.id, { guess: 'pizza party' }); return s.director; },
  'five-second': (d, s, c) => { d.onAction(s, c, s.performer, { answers: 'a, b, c' }); for (const p of c.players()) if (p.id !== s.performer) d.onAction(s, c, p.id, { vote: 'fail' }); return s.performer; },
  'compliment-battle': (d, s, c) => { for (const p of c.players()) if (p.id !== s.target) d.onAction(s, c, p.id, { entry: 'kind ' + p.id }); for (const p of c.players()) d.onAction(s, c, p.id, { vote: s.order.findIndex((a) => a !== p.id) }); return s.target; },
  'roast-toast': (d, s, c) => { for (const p of c.players()) if (p.id !== s.target) d.onAction(s, c, p.id, { entry: 'roast ' + p.id }); for (const p of c.players()) if (p.id !== s.target) d.onAction(s, c, p.id, { vote: s.order.findIndex((a) => a !== p.id) }); d.onAction(s, c, s.target, { pick: 0 }); return s.target; },
};
for (const id of Object.keys(toReveal)) check(id + ' Next: host and lead player', () => {
  for (const who of ['host', 'lead']) {
    const def = load(id), ctx = new Ctx(4, { rounds: 2 }), s = def.create(ctx);
    const lead = toReveal[id](def, s, ctx);
    assert.equal(s.phase, 'reveal');
    const outsider = ctx.players().find((p) => p.id !== lead && p.id !== ctx.host).id;
    def.onAction(s, ctx, outsider, { next: true });
    assert.equal(s.phase, 'reveal', 'other players cannot skip');
    const pid = who === 'host' ? (lead === ctx.host ? ctx.host : ctx.host) : lead;
    def.onAction(s, ctx, pid, { next: true });
    assert.equal(s.round, 2, id + ' ' + who + ' moves on');
  }
});

/* ---- End game: own final screen, points kept ---- */
for (const id of GAMES) check(id + ' onEnd', () => {
  const def = load(id), ctx = new Ctx(4, { rounds: 3 }), s = def.create(ctx);
  s.scores = { p2: 100 };
  def.onEnd(s, ctx, { reason: 'host' });
  assert.equal(s.phase, 'done');
  assert.equal(s.endsAt, 0);
  assert.deepEqual(s.scores, { p2: 100 });
  const v = def.view(s, 'p1', ctx);
  assert.equal(v.phase, 'done');
});

/* ---- players who leave: skipped turns, not waited for ---- */
const leadOf = { 'two-truths': 'subject', 'emoji-story': 'director', 'five-second': 'performer', 'compliment-battle': 'target', 'roast-toast': 'target' };
for (const id of Object.keys(leadOf)) check(id + ' gone lead player: turn skipped, Auto rounds shrink', () => {
  const def = load(id), ctx = new Ctx(4), s = def.create(ctx);
  assert.equal(s.rounds, 4);
  const lead = s[leadOf[id]];
  ctx.leave(def, s, lead);
  assert.equal(s.round, 1, 'the skipped turn is not a round');
  assert.equal(s.rounds, 3, 'Auto: one turn per remaining player');
  assert.notEqual(s[leadOf[id]], lead);
  const seen = [s[leadOf[id]]];
  for (let n = 0; s.phase !== 'done' && n < 100; n++) {
    const r = s.round;
    ctx.fire();
    if (s.round !== r && s.phase !== 'done') seen.push(s[leadOf[id]]);
  }
  assert.equal(s.phase, 'done');
  assert(!seen.includes(lead), 'a player who left gets no turn');
  assert.equal(new Set(seen).size, 3, 'everyone still here gets a turn: ' + seen);
});
for (const id of Object.keys(leadOf)) check(id + ' gone player who already had a turn: rounds unchanged', () => {
  const def = load(id), ctx = new Ctx(4), s = def.create(ctx);
  const lead = s[leadOf[id]];
  ctx.fire(); // first window times out
  if (s.phase !== 'reveal' && s.round === 1) ctx.fire();
  ctx.leave(def, s, lead);
  assert.equal(s.rounds, 4);
});
check('two-truths stops waiting for a gone voter', () => {
  const def = load('two-truths'), ctx = new Ctx(4, { rounds: 1 }), s = def.create(ctx);
  def.onAction(s, ctx, s.subject, { statements: ['a', 'b', 'c'], lie: 0 });
  const voters = ctx.players().filter((p) => p.id !== s.subject).map((p) => p.id);
  def.onAction(s, ctx, voters[0], { vote: 0 });
  def.onAction(s, ctx, voters[1], { vote: 1 });
  assert.equal(s.phase, 'vote');
  ctx.leave(def, s, voters[2]);
  assert.equal(s.phase, 'reveal');
});
for (const [id, write, vote] of [
  ['funny-answer', (pid) => ({ answer: 'ans ' + pid }), (s, pid) => ({ vote: s.options.find((o) => o.pid !== pid).aid })],
  ['bluff', (pid) => ({ fake: 'fake ' + pid }), (s, pid) => ({ pick: s.options.find((o) => o.pid !== pid).oid })],
]) check(id + ' stops waiting for gone writers and voters', () => {
  const def = load(id), ctx = new Ctx(4, { rounds: 1 }), s = def.create(ctx);
  for (const pid of ['p1', 'p2', 'p3']) def.onAction(s, ctx, pid, write(pid));
  const first = s.phase;
  ctx.leave(def, s, 'p4');
  assert.notEqual(s.phase, first, 'gone writer is not waited for');
  def.onAction(s, ctx, 'p1', vote(s, 'p1'));
  def.onAction(s, ctx, 'p2', vote(s, 'p2'));
  ctx.leave(def, s, 'p3');
  assert.equal(s.phase, 'reveal', 'gone voter is not waited for');
});
check('story-builder skips a gone writer without a filler line', () => {
  const def = load('story-builder'), ctx = new Ctx(4, { rounds: 1 }), s = def.create(ctx);
  const gone = s.order[1];
  def.onAction(s, ctx, s.turn, { line: 'First line.' });
  assert.equal(s.turn, gone);
  ctx.leave(def, s, gone);
  assert.notEqual(s.turn, gone);
  while (s.phase === 'build') def.onAction(s, ctx, s.turn, { line: 'More by ' + s.turn });
  assert.equal(s.lines.length, 3);
  assert(!s.lines.some((l) => l.pid === gone));
});
check('roast-toast reveals without the crown when the target left', () => {
  const def = load('roast-toast'), ctx = new Ctx(4, { rounds: 1 }), s = def.create(ctx);
  const writers = ctx.players().filter((p) => p.id !== s.target).map((p) => p.id);
  for (const w of writers) def.onAction(s, ctx, w, { entry: 'roast ' + w });
  for (const w of writers) def.onAction(s, ctx, w, { vote: s.order.findIndex((a) => a !== w) });
  assert.equal(s.phase, 'vote');
  ctx.leave(def, s, s.target);
  assert.equal(s.phase, 'reveal');
});
check('compliment-battle and emoji-story stop waiting for gone players', () => {
  let def = load('compliment-battle'), ctx = new Ctx(4, { rounds: 1 }), s = def.create(ctx);
  const writers = ctx.players().filter((p) => p.id !== s.target).map((p) => p.id);
  def.onAction(s, ctx, writers[0], { entry: 'kind 1' });
  def.onAction(s, ctx, writers[1], { entry: 'kind 2' });
  ctx.leave(def, s, writers[2]);
  assert.equal(s.phase, 'vote');
  def = load('emoji-story'); ctx = new Ctx(4, { rounds: 1 }); s = def.create(ctx);
  def.onAction(s, ctx, s.director, { emoji: '🍕' });
  const g = ctx.players().filter((p) => p.id !== s.director).map((p) => p.id);
  def.onAction(s, ctx, g[0], { guess: 'pizza party' });
  def.onAction(s, ctx, g[1], { guess: 'pizza party' });
  ctx.leave(def, s, g[2]);
  assert.equal(s.phase, 'reveal');
});
check('five-second stops waiting for a gone judge', () => {
  const def = load('five-second'), ctx = new Ctx(4, { rounds: 1 }), s = def.create(ctx);
  def.onAction(s, ctx, s.performer, { answers: 'a, b, c' });
  const j = ctx.players().filter((p) => p.id !== s.performer).map((p) => p.id);
  def.onAction(s, ctx, j[0], { vote: 'pass' });
  def.onAction(s, ctx, j[1], { vote: 'pass' });
  ctx.leave(def, s, j[2]);
  assert.equal(s.phase, 'reveal');
  assert(s.last.passed);
});
check('a stale timer from a skipped turn cannot end the next one', () => {
  const def = load('two-truths'), ctx = new Ctx(4), s = def.create(ctx);
  ctx.leave(def, s, s.subject);
  const subject = s.subject;
  ctx.timers.sort((a, b) => a.at - b.at);
  const stale = ctx.timers.shift();
  stale.fn();
  assert.equal(s.phase, 'write');
  assert.equal(s.subject, subject);
});

console.log('PARTY_B_RULES_PASS:', checks, 'checks');
