'use strict';
/* Party race/logic regression checks for 19 turn-based games.
 * Virtual ctx with fake clock, cancelable timers, awards. Each test drives
 * legal actions + hostile duplicates/self-votes/ghost/malformed payloads,
 * retains an old phase timer, transitions early via next, then invokes the
 * old timer at dueTime and verifies no later-round scoring/phase mutation.
 * Also asserts private secrets, watcher views, own-ballot fields, stable
 * deadlines, and terminal endsAt=0. Does NOT assert any game is bug-free.
 * Run: node test/party-races.js
 */

const assert = require('node:assert/strict');
const registry = require('../games/registry');

const REAL_RANDOM = Math.random;
function seedRandom(seed) {
  let s = seed >>> 0;
  Math.random = function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(id) {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

class RaceCtx {
  constructor(players, settings) {
    this._players = players;
    this._settings = settings || {};
    this._now = 1700000000000;
    this.timers = [];
    this.awards = {};
    this.broadcasts = 0;
    this.seq = 0;
  }
  players() { return this._players.slice(); }
  allPlayers() { return this._players.slice(); }
  content() { return {}; }
  settings() { return { ...this._settings }; }
  hostId() { return this._players[0].id; }
  broadcast() { this.broadcasts += 1; }
  lobby() {}
  later(ms, fn) {
    const t = { at: this._now + ms, fn, dead: false, id: this.seq++ };
    this.timers.push(t);
    return () => { t.dead = true; };
  }
  award(pid, pts) { this.awards[pid] = (this.awards[pid] || 0) + pts; }
  now() { return this._now; }
  advance(ms) { this._now += ms; }
  setNow(t) { if (t > this._now) this._now = t; }
  lastTimer() { return this.timers[this.timers.length - 1]; }
  fireTimer(t) {
    if (t.dead) return false;
    t.dead = true;
    if (t.at > this._now) this._now = t.at;
    t.fn();
    return true;
  }
  totalAwarded() { return Object.values(this.awards).reduce((a, b) => a + b, 0); }
}

const NAMES = ['Ann', 'Bob', 'Cat', 'Dan'];
function roster(n) {
  const out = [];
  for (let i = 0; i < (n || 4); i++) out.push({ id: 'p' + (i + 1), name: NAMES[i] });
  return out;
}
function settingsFor(def, wants) {
  const schema = (def.manifest && def.manifest.settings) || [];
  const out = {};
  for (const s of schema) {
    const v = wants[s.key];
    if (v === undefined) continue;
    if (s.type === 'int' && Number.isInteger(v)) out[s.key] = Math.max(s.min, Math.min(s.max, v));
  }
  return out;
}
function must(c, msg) { if (!c) throw new Error(msg); }
function V(def, state, pid) {
  const v = def.view(state, pid);
  must(v && typeof v === 'object', `view for ${pid} must be object`);
  JSON.stringify(v);
  return v;
}
function act(def, state, ctx, pid, a) { return def.onAction(state, ctx, pid, a); }
function snap(state) {
  return JSON.stringify(state, (k, v) => (typeof v === 'function' ? '[fn]' : v));
}
function awardsSnap(ctx) { return JSON.stringify(ctx.awards); }
/* Invoke a retained old timer at its dueTime (simulates delayed callback). */
function fireOld(ctx, t) {
  ctx.setNow(Math.max(ctx.now(), t.at));
  t.fn();
}
function nonHost(state) { return state.hostId === 'p1' ? 'p2' : 'p1'; }

const tests = {};
function test(id, fn) { tests[id] = fn; }

/* ---------------- bluff ---------------- */
test('bluff', () => {
  const def = registry.get('bluff');
  const ctx = new RaceCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  must(state.phase === 'bluff' && state.round === 1, 'starts bluff r1');
  must(state.endsAt > ctx.now(), 'bluff deadline set');
  const vb = V(def, state, 'p1');
  must(vb.fact.truth === '', 'truth hidden in bluff');
  must(V(def, state, 'ghost').fact.truth === '', 'watcher sees no truth');
  const s0 = snap(state);
  act(def, state, ctx, 'ghost', { fake: 'ghost bluff' });
  must(snap(state) === s0, 'ghost fake ignored');
  act(def, state, ctx, 'p1', { fake: 123 });
  act(def, state, ctx, 'p1', null);
  must(snap(state) === s0, 'malformed fake ignored');
  const truth = state.fact.truth;
  act(def, state, ctx, 'p1', { fake: truth });
  must(!state.fakes.p1, 'fake equal to truth rejected');
  const f1 = { p1: 'because squirrels unionized', p2: 'because squirrels unionized', p3: 'the moon sneezed', p4: 'pigeons voted twice' };
  for (const pid of Object.keys(f1)) act(def, state, ctx, pid, { fake: f1[pid] });
  must(state.phase === 'pick', 'all fakes -> pick');
  const pickTimer1 = ctx.lastTimer();
  const vp = V(def, state, 'p2');
  must(vp.options.length === 5, 'truth+4 fakes');
  must(vp.options.every((o) => Object.keys(o).sort().join(',') === 'oid,text'), 'options exactly oid,text');
  const own2 = state.options.find((o) => o.pid === 'p2');
  must(V(def, state, 'p2').myOption === own2.oid, 'myOption is own ballot');
  must(V(def, state, 'p1').myOption !== own2.oid, 'identical bluff text still has separate private ballot identities');
  must(V(def, state, 'ghost').myOption === null, 'watcher myOption null');
  must(vp.fact.truth === '', 'truth hidden in pick');
  const dl = state.endsAt;
  act(def, state, ctx, 'ghost', { pick: vp.options[0].oid });
  must(state.picks.ghost === undefined, 'ghost pick ignored');
  act(def, state, ctx, 'p2', { pick: own2.oid });
  must(state.picks.p2 === undefined, 'self pick rejected');
  const truthOpt = state.options.find((o) => o.pid === null);
  act(def, state, ctx, 'p1', { pick: truthOpt.oid });
  must(state.endsAt === dl, 'vote does not churn deadline');
  const pv = JSON.stringify(state.picks);
  act(def, state, ctx, 'p1', { pick: vp.options[0].oid });
  must(JSON.stringify(state.picks) === pv, 'duplicate pick ignored');
  for (const pid of ['p2', 'p3', 'p4']) {
    const own = state.options.find((o) => o.pid === pid);
    const pick = state.options.find((o) => o.oid !== own.oid && o.oid !== truthOpt.oid) || truthOpt;
    act(def, state, ctx, pid, { pick: pick.oid });
  }
  must(state.phase === 'reveal', 'all picks reveal');
  must(state.endsAt === 0, 'reveal clock 0');
  must((state.scores.p1 || 0) > 0, 'truth-finder scores');
  const revealTimer1 = ctx.lastTimer();
  act(def, state, ctx, nonHost(state), { next: true });
  must(state.phase === 'reveal', 'non-host next ignored');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'bluff' && state.round === 2, 'host next -> bluff r2');
  ctx.advance(1000);
  const f2 = { p1: 'r2 squirrels', p2: 'r2 gravity', p3: 'r2 moon', p4: 'r2 pigeons' };
  for (const pid of Object.keys(f2)) act(def, state, ctx, pid, { fake: f2[pid] });
  must(state.phase === 'pick' && state.round === 2, 'r2 pick');
  const sPick = snap(state);
  const aPick = awardsSnap(ctx);
  fireOld(ctx, pickTimer1);
  must(state.phase === 'pick' && state.round === 2, 'old pick timer did not reveal r2');
  must(snap(state) === sPick, 'old pick timer no state mutation');
  must(awardsSnap(ctx) === aPick, 'old pick timer no scoring');
  const t2 = state.options.find((o) => o.pid === null);
  act(def, state, ctx, 'p1', { pick: t2.oid });
  for (const pid of ['p2', 'p3', 'p4']) {
    const own = state.options.find((o) => o.pid === pid);
    const pick = state.options.find((o) => o.oid !== own.oid && o.oid !== t2.oid) || t2;
    act(def, state, ctx, pid, { pick: pick.oid });
  }
  must(state.phase === 'reveal' && state.round === 2, 'r2 reveal');
  const sRev = snap(state);
  const aRev = awardsSnap(ctx);
  fireOld(ctx, revealTimer1);
  must(state.phase === 'reveal' && state.round === 2, 'old reveal timer did not skip');
  must(snap(state) === sRev && awardsSnap(ctx) === aRev, 'old reveal timer no mutation');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done' && state.endsAt === 0, 'done clock 0');
  return 'pick/reveal races blocked, myOption, dup/self/ghost rejected';
});

/* ---------------- compliment-battle ---------------- */
test('compliment-battle', () => {
  const def = registry.get('compliment-battle');
  const ctx = new RaceCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  must(state.phase === 'write' && state.round === 1, 'starts write r1');
  const target = state.target;
  must(target, 'target crowned');
  const vw = V(def, state, 'p1');
  must(vw.entries && Object.keys(vw.entries).length === 0, 'entries hidden in write');
  const s0 = snap(state);
  act(def, state, ctx, 'ghost', { entry: 'ghost praise for all' });
  must(snap(state) === s0, 'ghost entry ignored');
  act(def, state, ctx, target, { entry: 'I am great indeed' });
  must(!state.entries[target], 'target cannot write');
  const writers = ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== target);
  for (const w of writers) act(def, state, ctx, w, { entry: `${w} shines bright` });
  must(state.phase === 'vote', 'all entries -> vote');
  const voteTimer1 = ctx.lastTimer();
  const vv = V(def, state, 'p1');
  must(vv.ballot.length === 3, 'ballot lists entries');
  must(vv.ballot.every((b) => !('author' in b)), 'ballot hides authorship');
  must(!('order' in vv) && !('order' in V(def, state, 'ghost')), 'anonymous author order stays private');
  const myIdx = vv.myEntry;
  if (myIdx >= 0) {
    act(def, state, ctx, 'p1', { vote: myIdx });
    must(state.votes.p1 === undefined, 'self vote rejected');
  }
  act(def, state, ctx, 'ghost', { vote: 0 });
  must(state.votes.ghost === undefined, 'ghost vote ignored');
  const dl = state.endsAt;
  for (const pid of ['p1', 'p2', 'p3', 'p4']) {
    const mine = V(def, state, pid).myEntry;
    const pick = V(def, state, pid).ballot.find((b) => b.i !== mine).i;
    act(def, state, ctx, pid, { vote: pick });
  }
  void dl;
  must(state.phase === 'reveal', 'all votes reveal');
  const dup = JSON.stringify(state.votes);
  act(def, state, ctx, 'p1', { vote: 0 });
  must(state.phase === 'reveal', 'duplicate vote after reveal ignored');
  void dup;
  const revealTimer1 = ctx.lastTimer();
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'write' && state.round === 2, 'next -> write r2');
  ctx.advance(1000);
  const t2 = state.target;
  const w2 = ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== t2);
  for (const w of w2) act(def, state, ctx, w, { entry: `r2 ${w} glows` });
  must(state.phase === 'vote' && state.round === 2, 'r2 vote');
  const sV = snap(state);
  const aV = awardsSnap(ctx);
  fireOld(ctx, voteTimer1);
  must(state.phase === 'vote' && state.round === 2, 'old vote timer no reveal');
  must(snap(state) === sV && awardsSnap(ctx) === aV, 'old vote timer no mutation');
  const vv2 = V(def, state, 'p1');
  for (const pid of ['p1', 'p2', 'p3', 'p4']) {
    const mine = V(def, state, pid).myEntry;
    const pick = V(def, state, pid).ballot.find((b) => b.i !== mine).i;
    act(def, state, ctx, pid, { vote: pick });
  }
  must(state.phase === 'reveal' && state.round === 2, 'r2 reveal');
  const sR = snap(state);
  const aR = awardsSnap(ctx);
  fireOld(ctx, revealTimer1);
  must(state.phase === 'reveal' && state.round === 2, 'old reveal timer no skip');
  must(snap(state) === sR && awardsSnap(ctx) === aR, 'old reveal timer no mutation');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done' && state.endsAt === 0, 'done clock 0');
  return 'vote/reveal races blocked, self/ghost rejected';
});

/* ---------------- dare-roulette ---------------- */
test('dare-roulette', () => {
  const def = registry.get('dare-roulette');
  const ctx = new RaceCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  must(state.phase === 'spin', 'starts spin');
  const s0 = snap(state);
  act(def, state, ctx, 'ghost', { spin: true });
  must(snap(state) === s0, 'ghost spin ignored');
  act(def, state, ctx, 'p2', { spin: true });
  must(state.phase === 'perform' && state.round === 1, 'spin -> performance r1');
  act(def, state, ctx, state.victim, { ready: true });
  must(state.phase === 'verdict', 'victim opens judging');
  const verdictTimer1 = ctx.lastTimer();
  const victim = state.victim;
  must(victim && state.dare, 'victim+dare dealt');
  const vv = V(def, state, 'p1');
  must(vv.votes && Object.keys(vv.votes).length === 0, 'votes hidden in verdict');
  act(def, state, ctx, victim, { vote: 'done' });
  must(!state.votes[victim], 'victim cannot judge');
  act(def, state, ctx, 'ghost', { vote: 'done' });
  must(state.votes.ghost === undefined, 'ghost vote ignored');
  const jurors = ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== victim);
  act(def, state, ctx, jurors[0], { vote: 'done' });
  const vb = JSON.stringify(state.votes);
  act(def, state, ctx, jurors[0], { vote: 'chicken' });
  must(JSON.stringify(state.votes) === vb, 'duplicate verdict ignored');
  for (const j of jurors.slice(1)) act(def, state, ctx, j, { vote: 'done' });
  must(state.phase === 'reveal', 'full jury resolves');
  const revealTimer1 = ctx.lastTimer();
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'spin' && state.round === 1, 'next -> spin (round counts on spin)');
  ctx.advance(1000);
  act(def, state, ctx, 'p3', { spin: true });
  must(state.phase === 'perform' && state.round === 2, 'r2 performance');
  act(def, state, ctx, state.victim, { ready: true });
  must(state.phase === 'verdict', 'r2 victim opens judging');
  const sV = snap(state);
  const aV = awardsSnap(ctx);
  fireOld(ctx, verdictTimer1);
  must(state.phase === 'verdict' && state.round === 2, 'old verdict timer no resolve');
  must(snap(state) === sV && awardsSnap(ctx) === aV, 'old verdict timer no mutation');
  const vic2 = state.victim;
  for (const j of ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== vic2)) act(def, state, ctx, j, { vote: 'done' });
  must(state.phase === 'reveal' && state.round === 2, 'r2 reveal');
  const sR = snap(state);
  const aR = awardsSnap(ctx);
  fireOld(ctx, revealTimer1);
  must(state.phase === 'reveal' && state.round === 2, 'old reveal timer no skip');
  must(snap(state) === sR && awardsSnap(ctx) === aR, 'old reveal timer no mutation');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done' && state.endsAt === 0, 'done clock 0');
  return 'verdict/reveal races blocked, victim/ghost rejected';
});

/* ---------------- emoji-story ---------------- */
test('emoji-story', () => {
  const def = registry.get('emoji-story');
  const ctx = new RaceCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  must(state.phase === 'emoji' && state.round === 1, 'starts emoji r1');
  const dir = state.director;
  const phrase = V(def, state, dir).phrase;
  must(phrase && phrase.length > 0, 'director sees phrase');
  const guesser = ['p1', 'p2', 'p3', 'p4'].find((id) => id !== dir);
  must(V(def, state, guesser).phrase === '', 'phrase hidden from guessers');
  must(V(def, state, 'ghost').phrase === '', 'watcher sees no phrase');
  const s0 = snap(state);
  act(def, state, ctx, guesser, { emoji: '🍕🎉' });
  must(snap(state) === s0, 'non-director emoji ignored');
  act(def, state, ctx, dir, { emoji: 'has letters abc' });
  must(state.phase === 'emoji', 'ASCII emoji rejected');
  act(def, state, ctx, dir, { emoji: '🍕🎉🐱🚀' });
  must(state.phase === 'guess', 'emoji opens guessing');
  const guessTimer1 = ctx.lastTimer();
  act(def, state, ctx, 'ghost', { guess: phrase });
  must(!state.solved.ghost, 'ghost guess ignored');
  act(def, state, ctx, guesser, { guess: 'zzz not the phrase' });
  must(!state.solved[guesser], 'wrong guess solves nothing');
  for (const pid of ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== dir)) act(def, state, ctx, pid, { guess: phrase });
  must(state.phase === 'reveal', 'all solved -> reveal');
  must((state.scores[dir] || 0) > 0, 'director earns per solver');
  const revealTimer1 = ctx.lastTimer();
  act(def, state, ctx, dir, { next: true });
  must(state.phase === 'emoji' && state.round === 2, 'director next -> emoji r2');
  ctx.advance(1000);
  const dir2 = state.director;
  const ph2 = V(def, state, dir2).phrase;
  act(def, state, ctx, dir2, { emoji: '🌊🌙⭐🔥' });
  must(state.phase === 'guess' && state.round === 2, 'r2 guess');
  const sG = snap(state);
  const aG = awardsSnap(ctx);
  fireOld(ctx, guessTimer1);
  must(state.phase === 'guess' && state.round === 2, 'old guess timer no reveal');
  must(snap(state) === sG && awardsSnap(ctx) === aG, 'old guess timer no mutation');
  for (const pid of ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== dir2)) act(def, state, ctx, pid, { guess: ph2 });
  must(state.phase === 'reveal' && state.round === 2, 'r2 reveal');
  const sR = snap(state);
  const aR = awardsSnap(ctx);
  fireOld(ctx, revealTimer1);
  must(state.phase === 'reveal' && state.round === 2, 'old reveal timer no skip');
  must(snap(state) === sR && awardsSnap(ctx) === aR, 'old reveal timer no mutation');
  act(def, state, ctx, dir2, { next: true });
  must(state.phase === 'done' && state.endsAt === 0, 'done clock 0');
  return 'guess/reveal races blocked, secrets projected correctly';
});

/* ---------------- five-second ---------------- */
test('five-second', () => {
  const def = registry.get('five-second');
  const ctx = new RaceCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  must(state.phase === 'answer' && state.round === 1, 'starts answer r1');
  const perf = state.performer;
  const other = ['p1', 'p2', 'p3', 'p4'].find((id) => id !== perf);
  must(V(def, state, perf).category, 'category dealt');
  const s0 = snap(state);
  act(def, state, ctx, other, { answers: 'x, y, z' });
  must(snap(state) === s0, 'non-performer answer ignored');
  act(def, state, ctx, 'ghost', { answers: 'a, b, c' });
  must(snap(state) === s0, 'ghost answer ignored');
  act(def, state, ctx, perf, { answers: 'lions, tigers, bears' });
  must(state.phase === 'vote', 'performer answers -> vote');
  const voteTimer1 = ctx.lastTimer();
  must(V(def, state, other).answers.length === 3, 'judges see answers');
  act(def, state, ctx, perf, { vote: 'pass' });
  must(state.votes[perf] === undefined, 'performer cannot judge');
  act(def, state, ctx, 'ghost', { vote: 'pass' });
  must(state.votes.ghost === undefined, 'ghost vote ignored');
  const voters = ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== perf);
  act(def, state, ctx, voters[0], { vote: 'pass' });
  const vb = JSON.stringify(state.votes);
  act(def, state, ctx, voters[0], { vote: 'fail' });
  must(JSON.stringify(state.votes) === vb, 'duplicate judge vote ignored');
  for (const v of voters.slice(1)) act(def, state, ctx, v, { vote: 'pass' });
  must(state.phase === 'reveal', 'all judges reveal');
  must(state.endsAt === 0, 'reveal clock 0');
  const revealTimer1 = ctx.lastTimer();
  act(def, state, ctx, perf, { next: true });
  must(state.phase === 'answer' && state.round === 2, 'performer next -> answer r2');
  ctx.advance(1000);
  const perf2 = state.performer;
  act(def, state, ctx, perf2, { answers: 'red, green, blue' });
  must(state.phase === 'vote' && state.round === 2, 'r2 vote');
  const sV = snap(state);
  const aV = awardsSnap(ctx);
  fireOld(ctx, voteTimer1);
  must(state.phase === 'vote' && state.round === 2, 'old vote timer no reveal');
  must(snap(state) === sV && awardsSnap(ctx) === aV, 'old vote timer no mutation');
  for (const v of ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== perf2)) act(def, state, ctx, v, { vote: 'fail' });
  must(state.phase === 'reveal' && state.round === 2, 'r2 reveal');
  const sR = snap(state);
  const aR = awardsSnap(ctx);
  fireOld(ctx, revealTimer1);
  must(state.phase === 'reveal' && state.round === 2, 'old reveal timer no skip');
  must(snap(state) === sR && awardsSnap(ctx) === aR, 'old reveal timer no mutation');
  act(def, state, ctx, perf2, { next: true });
  must(state.phase === 'done' && state.endsAt === 0, 'done clock 0');
  return 'vote/reveal races blocked, performer/ghost rejected';
});

/* ---------------- funny-answer ---------------- */
test('funny-answer', () => {
  const def = registry.get('funny-answer');
  const ctx = new RaceCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  must(state.phase === 'answer' && state.round === 1, 'starts answer r1');
  const va = V(def, state, 'p1');
  must(typeof va.prompt === 'string', 'prompt dealt');
  const s0 = snap(state);
  act(def, state, ctx, 'ghost', { answer: 'ghost joke here' });
  must(snap(state) === s0, 'ghost answer ignored');
  const m1 = { p1: 'a confused penguin', p2: 'a confused penguin', p3: 'tax season', p4: 'a haunted toaster' };
  for (const pid of Object.keys(m1)) act(def, state, ctx, pid, { answer: m1[pid] });
  must(state.phase === 'vote', 'all answered -> vote');
  const voteTimer1 = ctx.lastTimer();
  const vv = V(def, state, 'p1');
  must(vv.options.length === 4, 'four anonymous options');
  must(vv.options.every((o) => Object.keys(o).sort().join(',') === 'aid,text'), 'options exactly aid,text');
  const ownAid = state.options.find((o) => o.pid === 'p1').aid;
  must(V(def, state, 'p1').myEntry === ownAid, 'myEntry is own ballot');
  must(V(def, state, 'p2').myEntry !== ownAid, 'identical jokes still have separate private ballot identities');
  must(V(def, state, 'ghost').myEntry === null, 'watcher myEntry null');
  act(def, state, ctx, 'p1', { vote: ownAid });
  must(state.votes.p1 === undefined, 'self vote rejected');
  act(def, state, ctx, 'ghost', { vote: vv.options[0].aid });
  must(state.votes.ghost === undefined, 'ghost vote ignored');
  for (const pid of Object.keys(m1)) {
    const mine = state.options.find((o) => o.pid === pid);
    const rival = state.options.find((o) => o.aid !== mine.aid);
    act(def, state, ctx, pid, { vote: rival.aid });
  }
  const pv = JSON.stringify(state.votes);
  act(def, state, ctx, 'p1', { vote: vv.options[0].aid });
  void pv;
  must(state.phase === 'reveal', 'all votes reveal');
  must(state.endsAt === 0, 'reveal clock 0');
  const revealTimer1 = ctx.lastTimer();
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'answer' && state.round === 2, 'next -> answer r2');
  ctx.advance(1000);
  const m2 = { p1: 'r2 penguin', p2: 'r2 sock', p3: 'r2 taxes', p4: 'r2 toaster' };
  for (const pid of Object.keys(m2)) act(def, state, ctx, pid, { answer: m2[pid] });
  must(state.phase === 'vote' && state.round === 2, 'r2 vote');
  const sV = snap(state);
  const aV = awardsSnap(ctx);
  fireOld(ctx, voteTimer1);
  must(state.phase === 'vote' && state.round === 2, 'old vote timer no reveal');
  must(snap(state) === sV && awardsSnap(ctx) === aV, 'old vote timer no mutation');
  for (const pid of Object.keys(m2)) {
    const mine = state.options.find((o) => o.pid === pid);
    const rival = state.options.find((o) => o.aid !== mine.aid);
    act(def, state, ctx, pid, { vote: rival.aid });
  }
  must(state.phase === 'reveal' && state.round === 2, 'r2 reveal');
  const sR = snap(state);
  const aR = awardsSnap(ctx);
  fireOld(ctx, revealTimer1);
  must(state.phase === 'reveal' && state.round === 2, 'old reveal timer no skip');
  must(snap(state) === sR && awardsSnap(ctx) === aR, 'old reveal timer no mutation');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done' && state.endsAt === 0, 'done clock 0');
  return 'vote/reveal races blocked, myEntry, self/ghost rejected';
});

/* ---------------- hot-takes ---------------- */
test('hot-takes', () => {
  const def = registry.get('hot-takes');
  const ctx = new RaceCtx(roster(4), settingsFor(def, {}));
  const state = def.create(ctx);
  must(state.phase === 'submit', 'starts submit');
  const s0 = snap(state);
  act(def, state, ctx, 'ghost', { take: 'ghost take over here' });
  must(snap(state) === s0, 'ghost take ignored');
  act(def, state, ctx, 'p1', { take: '   ' });
  must(snap(state) === s0, 'empty take ignored');
  const takes = { p1: 'Pineapple belongs on pizza', p2: 'Mornings are the best', p3: 'Cats beat dogs', p4: 'Socks with sandals rule' };
  for (const pid of Object.keys(takes)) act(def, state, ctx, pid, { take: takes[pid] });
  must(state.phase === 'vote' && state.index === 0, 'all submitted -> vote take0');
  const voteTimer0 = ctx.lastTimer();
  const cur0 = V(def, state, 'p1').current;
  must(cur0 && cur0.author === null, 'author anonymous in vote');
  const author0 = state.takes.find((t) => t.tid === state.order[0]).author;
  act(def, state, ctx, author0, { vote: 'agree' });
  must(state.votes[author0] === undefined, 'author cannot vote own take');
  act(def, state, ctx, 'ghost', { vote: 'agree' });
  must(state.votes.ghost === undefined, 'ghost vote ignored');
  let i = 0;
  for (const pid of ['p1', 'p2', 'p3', 'p4']) {
    if (pid === author0) continue;
    if (i === 0) {
      act(def, state, ctx, pid, { vote: 'agree' });
      const vb = JSON.stringify(state.votes);
      act(def, state, ctx, pid, { vote: 'disagree' });
      must(JSON.stringify(state.votes) === vb, 'duplicate take vote ignored');
    } else {
      act(def, state, ctx, pid, { vote: i % 2 ? 'disagree' : 'agree' });
    }
    i += 1;
  }
  must(state.phase === 'reveal' && state.index === 0, 'take0 reveal');
  must(V(def, state, 'p1').current.author !== null, 'author revealed after vote');
  const revealTimer0 = ctx.lastTimer();
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'vote' && state.index === 1, 'next -> vote take1');
  const sV = snap(state);
  const aV = awardsSnap(ctx);
  fireOld(ctx, voteTimer0);
  must(state.phase === 'vote' && state.index === 1, 'old take0 vote timer no reveal of take1');
  must(snap(state) === sV && awardsSnap(ctx) === aV, 'old vote timer no mutation');
  const author1 = state.takes.find((t) => t.tid === state.order[1]).author;
  let j = 0;
  for (const pid of ['p1', 'p2', 'p3', 'p4']) {
    if (pid === author1) continue;
    act(def, state, ctx, pid, { vote: j++ % 2 ? 'disagree' : 'agree' });
  }
  must(state.phase === 'reveal' && state.index === 1, 'take1 reveal');
  const sR = snap(state);
  const aR = awardsSnap(ctx);
  fireOld(ctx, revealTimer0);
  must(state.phase === 'reveal' && state.index === 1, 'old take0 reveal timer no advance');
  must(snap(state) === sR && awardsSnap(ctx) === aR, 'old reveal timer no mutation');
  for (let g = 0; g < 6 && state.phase !== 'done'; g++) {
    if (state.phase === 'reveal') { act(def, state, ctx, state.hostId, { next: true }); continue; }
    if (state.phase === 'vote') {
      const au = state.takes.find((t) => t.tid === state.order[state.index]).author;
      let k = 0;
      for (const pid of ['p1', 'p2', 'p3', 'p4']) {
        if (pid === au) continue;
        act(def, state, ctx, pid, { vote: k++ % 2 ? 'disagree' : 'agree' });
      }
    }
  }
  must(state.phase === 'done' && state.endsAt === 0, 'done after all takes');
  must(state.winners && state.winners.length > 0, 'divisive winner crowned (ties share it)');
  return 'index-guarded vote/reveal races blocked, author/ghost rejected';
});

/* ---------------- lyric-fill ---------------- */
test('lyric-fill', () => {
  const def = registry.get('lyric-fill');
  const ctx = new RaceCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  must(state.phase === 'fill' && state.round === 1, 'starts fill r1');
  const vf = V(def, state, 'p1');
  must(!('answer' in vf.line), 'answer hidden in fill');
  must(V(def, state, 'ghost').mine === '', 'watcher mine empty');
  const s0 = snap(state);
  act(def, state, ctx, 'ghost', { text: 'ghost lyric' });
  must(snap(state) === s0, 'ghost fill ignored');
  act(def, state, ctx, 'p1', null);
  must(snap(state) === s0, 'null action no throw, no mutation');
  const ans = state.line.answer;
  act(def, state, ctx, 'p1', { text: ans });
  const ab = JSON.stringify(state.answers);
  act(def, state, ctx, 'p1', { text: 'changed lyric' });
  must(JSON.stringify(state.answers) === ab, 'duplicate fill ignored');
  act(def, state, ctx, 'p2', { text: 'zzz wrong words' });
  act(def, state, ctx, 'p3', { text: ans });
  act(def, state, ctx, 'p4', { text: 'zzz wrong' });
  must(state.phase === 'reveal', 'all filled -> reveal');
  must(state.endsAt === 0, 'reveal clock 0');
  const fillTimer1 = ctx.timers[0];
  const revealTimer1 = ctx.lastTimer();
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'fill' && state.round === 2, 'next -> fill r2');
  ctx.advance(1000);
  const sF = snap(state);
  const aF = awardsSnap(ctx);
  fireOld(ctx, fillTimer1);
  must(state.phase === 'fill' && state.round === 2, 'old fill timer no reveal');
  must(snap(state) === sF && awardsSnap(ctx) === aF, 'old fill timer no mutation');
  const ans2 = state.line.answer;
  for (const pid of ['p1', 'p2', 'p3', 'p4']) act(def, state, ctx, pid, { text: pid < 'p3' ? ans2 : 'zzz wrong' });
  must(state.phase === 'reveal' && state.round === 2, 'r2 reveal');
  const sR = snap(state);
  const aR = awardsSnap(ctx);
  fireOld(ctx, revealTimer1);
  must(state.phase === 'reveal' && state.round === 2, 'old reveal timer no skip');
  must(snap(state) === sR && awardsSnap(ctx) === aR, 'old reveal timer no mutation');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done' && state.endsAt === 0, 'done clock 0');
  return 'fill/reveal races blocked, dup/ghost rejected';
});

/* ---------------- most-likely ---------------- */
test('most-likely', () => {
  const def = registry.get('most-likely');
  const ctx = new RaceCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  must(state.phase === 'vote' && state.round === 1, 'starts vote r1');
  must(typeof V(def, state, 'p1').prompt === 'string', 'prompt dealt');
  const s0 = snap(state);
  act(def, state, ctx, 'ghost', { vote: 'p2' });
  must(snap(state) === s0, 'ghost vote ignored');
  act(def, state, ctx, 'p1', { vote: 'p1' });
  must(!state.votes.p1, 'self vote rejected');
  act(def, state, ctx, 'p1', { vote: 'ghost' });
  must(!state.votes.p1, 'stranger vote rejected');
  const dl = state.endsAt;
  act(def, state, ctx, 'p1', { vote: 'p2' });
  must(state.endsAt === dl, 'vote keeps deadline');
  const vb = JSON.stringify(state.votes);
  act(def, state, ctx, 'p1', { vote: 'p3' });
  must(JSON.stringify(state.votes) === vb, 'duplicate vote ignored');
  act(def, state, ctx, 'p2', { vote: 'p3' });
  act(def, state, ctx, 'p3', { vote: 'p2' });
  act(def, state, ctx, 'p4', { vote: 'p2' });
  must(state.phase === 'reveal', 'all vote -> reveal');
  const voteTimer1 = ctx.timers[0];
  const revealTimer1 = ctx.lastTimer();
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'vote' && state.round === 2, 'next -> vote r2');
  ctx.advance(1000);
  act(def, state, ctx, 'p1', { vote: 'p2' });
  const sV = snap(state);
  const aV = awardsSnap(ctx);
  fireOld(ctx, voteTimer1);
  must(state.phase === 'vote' && state.round === 2, 'old vote timer no reveal');
  must(snap(state) === sV && awardsSnap(ctx) === aV, 'old vote timer no mutation');
  act(def, state, ctx, 'p2', { vote: 'p1' });
  act(def, state, ctx, 'p3', { vote: 'p1' });
  act(def, state, ctx, 'p4', { vote: 'p1' });
  must(state.phase === 'reveal' && state.round === 2, 'r2 reveal');
  const sR = snap(state);
  const aR = awardsSnap(ctx);
  fireOld(ctx, revealTimer1);
  must(state.phase === 'reveal' && state.round === 2, 'old reveal timer no skip');
  must(snap(state) === sR && awardsSnap(ctx) === aR, 'old reveal timer no mutation');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done' && state.endsAt === 0, 'done clock 0');
  return 'vote/reveal races blocked, self/stranger/ghost rejected';
});

/* ---------------- never-ever ---------------- */
test('never-ever', () => {
  const def = registry.get('never-ever');
  const ctx = new RaceCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  must(state.phase === 'vote' && state.round === 1, 'starts vote r1');
  const s0 = snap(state);
  act(def, state, ctx, 'ghost', { vote: 'not' });
  must(snap(state) === s0, 'ghost vote ignored');
  act(def, state, ctx, 'p1', { vote: 'have' });
  const vb = JSON.stringify(state.votes);
  act(def, state, ctx, 'p1', { vote: 'not' });
  must(JSON.stringify(state.votes) === vb, 'duplicate vote ignored');
  act(def, state, ctx, 'p2', { vote: 'not' });
  act(def, state, ctx, 'p3', { vote: 'have' });
  act(def, state, ctx, 'p4', { vote: 'not' });
  must(state.phase === 'reveal', 'all vote -> reveal');
  const voteTimer1 = ctx.timers[0];
  const revealTimer1 = ctx.lastTimer();
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'vote' && state.round === 2, 'next -> vote r2');
  ctx.advance(1000);
  act(def, state, ctx, 'p1', { vote: 'have' });
  const sV = snap(state);
  const aV = awardsSnap(ctx);
  fireOld(ctx, voteTimer1);
  must(state.phase === 'vote' && state.round === 2, 'old vote timer no reveal');
  must(snap(state) === sV && awardsSnap(ctx) === aV, 'old vote timer no mutation');
  act(def, state, ctx, 'p2', { vote: 'not' });
  act(def, state, ctx, 'p3', { vote: 'have' });
  act(def, state, ctx, 'p4', { vote: 'not' });
  must(state.phase === 'reveal' && state.round === 2, 'r2 reveal');
  const sR = snap(state);
  const aR = awardsSnap(ctx);
  fireOld(ctx, revealTimer1);
  must(state.phase === 'reveal' && state.round === 2, 'old reveal timer no skip');
  must(snap(state) === sR && awardsSnap(ctx) === aR, 'old reveal timer no mutation');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done' && state.endsAt === 0, 'done clock 0');
  return 'vote/reveal races blocked, dup/ghost rejected';
});

/* ---------------- pick-one ---------------- */
test('pick-one', () => {
  const def = registry.get('pick-one');
  const ctx = new RaceCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  must(state.phase === 'vote' && state.round === 1, 'starts vote r1');
  const v0 = V(def, state, 'p1');
  must(v0.votes && Object.keys(v0.votes).length === 0, 'votes hidden');
  const s0 = snap(state);
  act(def, state, ctx, 'ghost', { vote: 'a' });
  must(snap(state) === s0, 'ghost vote ignored');
  act(def, state, ctx, 'p1', { vote: 'a' });
  const vb = JSON.stringify(state.votes);
  act(def, state, ctx, 'p1', { vote: 'b' });
  must(JSON.stringify(state.votes) === vb, 'duplicate vote ignored');
  act(def, state, ctx, 'p2', { vote: 'a' });
  act(def, state, ctx, 'p3', { vote: 'b' });
  act(def, state, ctx, 'p4', { vote: 'b' });
  must(state.phase === 'reveal', 'all vote -> reveal');
  must(state.endsAt === 0, 'reveal clock 0');
  const voteTimer1 = ctx.timers[0];
  const revealTimer1 = ctx.lastTimer();
  act(def, state, ctx, nonHost(state), { next: true });
  must(state.phase === 'reveal', 'non-host next ignored');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'vote' && state.round === 2, 'next -> vote r2');
  ctx.advance(1000);
  act(def, state, ctx, 'p1', { vote: 'a' });
  const sV = snap(state);
  const aV = awardsSnap(ctx);
  fireOld(ctx, voteTimer1);
  must(state.phase === 'vote' && state.round === 2, 'old vote timer no reveal');
  must(snap(state) === sV && awardsSnap(ctx) === aV, 'old vote timer no mutation');
  act(def, state, ctx, 'p2', { vote: 'a' });
  act(def, state, ctx, 'p3', { vote: 'b' });
  act(def, state, ctx, 'p4', { vote: 'b' });
  must(state.phase === 'reveal' && state.round === 2, 'r2 reveal');
  const sR = snap(state);
  const aR = awardsSnap(ctx);
  fireOld(ctx, revealTimer1);
  must(state.phase === 'reveal' && state.round === 2, 'old reveal timer no skip');
  must(snap(state) === sR && awardsSnap(ctx) === aR, 'old reveal timer no mutation');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done' && state.endsAt === 0, 'done clock 0');
  return 'vote/reveal races blocked, dup/ghost rejected';
});

/* ---------------- rank-it ---------------- */
test('rank-it', () => {
  const def = registry.get('rank-it');
  const ctx = new RaceCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  must(state.phase === 'rank' && state.round === 1, 'starts rank r1');
  must(V(def, state, 'p1').set, 'set dealt');
  must(Object.keys(V(def, state, 'p1').ranks).length === 0, 'ranks hidden');
  const s0 = snap(state);
  act(def, state, ctx, 'ghost', { order: [0, 1, 2, 3, 4] });
  must(snap(state) === s0, 'ghost rank ignored');
  act(def, state, ctx, 'p1', { order: [0, 1] });
  must(!state.ranks.p1, 'short order rejected');
  act(def, state, ctx, 'p1', { order: [0, 0, 1, 2, 3] });
  must(!state.ranks.p1, 'duplicate order rejected');
  const o1 = { p1: [0, 1, 2, 3, 4], p2: [0, 1, 2, 3, 4], p3: [4, 3, 2, 1, 0], p4: [0, 1, 2, 4, 3] };
  for (const pid of Object.keys(o1)) act(def, state, ctx, pid, { order: o1[pid] });
  must(state.phase === 'reveal', 'all ranked -> reveal');
  const rankTimer1 = ctx.timers[0];
  const revealTimer1 = ctx.lastTimer();
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'rank' && state.round === 2, 'next -> rank r2');
  ctx.advance(1000);
  act(def, state, ctx, 'p1', { order: [0, 1, 2, 3, 4] });
  const sR1 = snap(state);
  const aR1 = awardsSnap(ctx);
  fireOld(ctx, rankTimer1);
  must(state.phase === 'rank' && state.round === 2, 'old rank timer no reveal');
  must(snap(state) === sR1 && awardsSnap(ctx) === aR1, 'old rank timer no mutation');
  act(def, state, ctx, 'p2', { order: [0, 1, 2, 3, 4] });
  act(def, state, ctx, 'p3', { order: [4, 3, 2, 1, 0] });
  act(def, state, ctx, 'p4', { order: [0, 1, 2, 4, 3] });
  must(state.phase === 'reveal' && state.round === 2, 'r2 reveal');
  const sR = snap(state);
  const aR = awardsSnap(ctx);
  fireOld(ctx, revealTimer1);
  must(state.phase === 'reveal' && state.round === 2, 'old reveal timer no skip');
  must(snap(state) === sR && awardsSnap(ctx) === aR, 'old reveal timer no mutation');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done' && state.endsAt === 0, 'done clock 0');
  return 'rank/reveal races blocked, invalid/ghost rejected';
});

/* ---------------- rapid-polls ---------------- */
test('rapid-polls', () => {
  const def = registry.get('rapid-polls');
  const ctx = new RaceCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  must(state.phase === 'pose', 'starts pose');
  const s0 = snap(state);
  act(def, state, ctx, 'ghost', { starter: true });
  must(snap(state) === s0, 'ghost starter ignored');
  act(def, state, ctx, 'p1', { pose: { q: 'x', options: ['only'] } });
  must(state.phase === 'pose', 'malformed poll rejected');
  act(def, state, ctx, 'p1', { pose: { q: 'Best ship snack?', options: ['Chips', 'Fruit', 'Cake'] } });
  must(state.phase === 'vote' && state.round === 1, 'custom poll -> vote r1');
  const voteTimer1 = ctx.lastTimer();
  must(V(def, state, 'p1').poll.by === 'p1', 'poser credited');
  act(def, state, ctx, 'ghost', { vote: 0 });
  must(state.votes.ghost === undefined, 'ghost vote ignored');
  act(def, state, ctx, 'p1', { vote: 0 });
  act(def, state, ctx, 'p2', { vote: 1 });
  const mid = V(def, state, 'p3');
  must(mid.counts.join(',') === '1,1,0', 'live counts roll in');
  const vb = JSON.stringify(state.votes);
  act(def, state, ctx, 'p1', { vote: 2 });
  must(JSON.stringify(state.votes) === vb, 'duplicate vote ignored');
  act(def, state, ctx, 'p3', { vote: 0 });
  act(def, state, ctx, 'p4', { vote: 2 });
  must(state.phase === 'reveal', 'all vote -> reveal');
  const revealTimer1 = ctx.lastTimer();
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'pose' && state.round === 1, 'next -> pose');
  ctx.advance(1000);
  act(def, state, ctx, 'p2', { starter: true });
  must(state.phase === 'vote' && state.round === 2, 'starter -> vote r2');
  act(def, state, ctx, 'p1', { vote: 0 });
  const sV = snap(state);
  const aV = awardsSnap(ctx);
  fireOld(ctx, voteTimer1);
  must(state.phase === 'vote' && state.round === 2, 'old vote timer no reveal');
  must(snap(state) === sV && awardsSnap(ctx) === aV, 'old vote timer no mutation');
  for (const pid of ['p2', 'p3', 'p4']) act(def, state, ctx, pid, { vote: 0 });
  must(state.phase === 'reveal' && state.round === 2, 'r2 reveal');
  const sR = snap(state);
  const aR = awardsSnap(ctx);
  fireOld(ctx, revealTimer1);
  must(state.phase === 'reveal' && state.round === 2, 'old reveal timer no skip');
  must(snap(state) === sR && awardsSnap(ctx) === aR, 'old reveal timer no mutation');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done' && state.endsAt === 0, 'done clock 0');
  return 'vote/reveal races blocked, malformed/ghost rejected';
});

/* ---------------- roast-toast ---------------- */
test('roast-toast', () => {
  const def = registry.get('roast-toast');
  const ctx = new RaceCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  must(state.phase === 'write' && state.round === 1, 'starts write r1');
  const target = state.target;
  const s0 = snap(state);
  act(def, state, ctx, 'ghost', { entry: 'ghost roast line' });
  must(snap(state) === s0, 'ghost entry ignored');
  act(def, state, ctx, target, { entry: 'self praise roast' });
  must(!state.entries[target], 'target cannot write');
  const writers = ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== target);
  for (const w of writers) act(def, state, ctx, w, { entry: `${w} roasts gently` });
  must(state.phase === 'vote', 'all entries -> vote');
  const voteTimer1 = ctx.lastTimer();
  const vv = V(def, state, 'p1');
  must(vv.ballot.length === 3, 'ballot lists roasts');
  must(!('order' in vv) && !('pick' in vv), 'ballot omits private author mapping');
  act(def, state, ctx, target, { pick: 0 });
  must(state.phase === 'vote', 'target can crown before votes finish');
  must(V(def, state, target).myPick === 0, 'target sees their own crown');
  for (const pid of [...writers, 'watch']) {
    const projected = V(def, state, pid);
    must(!('pick' in projected) && !('order' in projected) && projected.myPick === null, 'crown author stays private until reveal');
  }
  const selfW = writers[0];
  const selfIdx = V(def, state, selfW).myEntry;
  act(def, state, ctx, selfW, { vote: selfIdx });
  must(state.votes[selfW] === undefined, 'self vote rejected');
  act(def, state, ctx, 'ghost', { vote: 0 });
  must(state.votes.ghost === undefined, 'ghost vote ignored');
  for (const pid of writers) {
    const mine = V(def, state, pid).myEntry;
    const pick = V(def, state, pid).ballot.find((b) => b.i !== mine).i;
    act(def, state, ctx, pid, { vote: pick });
  }
  must(state.phase === 'reveal', 'crown plus all votes reveals');
  const awarded = awardsSnap(ctx);
  act(def, state, ctx, target, { pick: 0 });
  must(awardsSnap(ctx) === awarded, 'duplicate crown cannot award twice');
  const revealTimer1 = ctx.lastTimer();
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'write' && state.round === 2, 'next -> write r2');
  ctx.advance(1000);
  const t2 = state.target;
  for (const w of ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== t2)) act(def, state, ctx, w, { entry: `r2 ${w} roasts` });
  must(state.phase === 'vote' && state.round === 2, 'r2 vote');
  const sV = snap(state);
  const aV = awardsSnap(ctx);
  fireOld(ctx, voteTimer1);
  must(state.phase === 'vote' && state.round === 2, 'old vote timer no reveal');
  must(snap(state) === sV && awardsSnap(ctx) === aV, 'old vote timer no mutation');
  const vv2 = V(def, state, 'p1');
  for (const pid of ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== t2)) {
    const mine = V(def, state, pid).myEntry;
    const pick = V(def, state, pid).ballot.find((b) => b.i !== mine).i;
    act(def, state, ctx, pid, { vote: pick });
  }
  act(def, state, ctx, t2, { pick: 0 });
  must(state.phase === 'reveal' && state.round === 2, 'r2 reveal');
  const sR = snap(state);
  const aR = awardsSnap(ctx);
  fireOld(ctx, revealTimer1);
  must(state.phase === 'reveal' && state.round === 2, 'old reveal timer no skip');
  must(snap(state) === sR && awardsSnap(ctx) === aR, 'old reveal timer no mutation');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done' && state.endsAt === 0, 'done clock 0');
  return 'vote/reveal races blocked, pick gate + self/ghost rejected';
});

/* ---------------- story-builder ---------------- */
test('story-builder', () => {
  const def = registry.get('story-builder');
  const ctx = new RaceCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  must(state.phase === 'build' && state.round === 1, 'starts build r1');
  const buildTimer0r1 = ctx.lastTimer();
  const s0 = snap(state);
  const turn0 = state.turn;
  const notTurn = ['p1', 'p2', 'p3', 'p4'].find((id) => id !== turn0);
  act(def, state, ctx, notTurn, { line: 'out of turn line' });
  must(snap(state) === s0, 'non-turn line ignored');
  act(def, state, ctx, 'ghost', { line: 'ghost line' });
  must(snap(state) === s0, 'ghost line ignored');
  const own = {};
  for (let g = 0; g < 10 && state.phase === 'build'; g++) {
    const t = state.turn;
    act(def, state, ctx, t, { line: `And then ${t} found a key.` });
    (own[t] = own[t] || []).push(state.lines.length - 1);
  }
  must(state.phase === 'vote' && state.lines.length === 4, 'full rotation -> vote');
  const voteTimer1 = ctx.lastTimer();
  const vv = V(def, state, 'p1');
  must(vv.lines.every((l) => !('pid' in l)), 'ballot anonymizes authors');
  for (const pid of ['p1', 'p2', 'p3', 'p4']) {
    must(JSON.stringify(V(def, state, pid).myLines) === JSON.stringify(own[pid] || []), 'requester sees only their own line positions');
  }
  must(V(def, state, 'watch').myLines.length === 0, 'watcher gets no private line positions');
  const myIdx = (own.p1 || [])[0];
  if (myIdx !== undefined) {
    act(def, state, ctx, 'p1', { vote: myIdx });
    must(state.votes.p1 === undefined, 'self line vote rejected');
  }
  act(def, state, ctx, 'ghost', { vote: 0 });
  must(state.votes.ghost === undefined, 'ghost vote ignored');
  for (const pid of ['p1', 'p2', 'p3', 'p4']) {
    const mine = new Set(own[pid] || []);
    const pick = vv.lines.findIndex((_, idx) => !mine.has(idx));
    act(def, state, ctx, pid, { vote: pick });
  }
  const vb = JSON.stringify(state.votes);
  act(def, state, ctx, 'p1', { vote: 0 });
  void vb;
  must(state.phase === 'reveal', 'all votes reveal');
  const revealTimer1 = ctx.lastTimer();
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'build' && state.round === 2, 'next -> build r2');
  ctx.advance(1000);
  must(state.turnIdx === 0, 'r2 starts at turn 0');
  const sB = snap(state);
  const aB = awardsSnap(ctx);
  fireOld(ctx, buildTimer0r1);
  must(state.phase === 'build' && state.round === 2 && state.turnIdx === 0, 'old r1 turn0 timer no advance of r2 turn0');
  must(snap(state) === sB && awardsSnap(ctx) === aB, 'old build timer no mutation');
  const own2 = {};
  for (let g = 0; g < 10 && state.phase === 'build'; g++) {
    const t = state.turn;
    act(def, state, ctx, t, { line: `r2 ${t} opened a door.` });
    (own2[t] = own2[t] || []).push(state.lines.length - 1);
  }
  must(state.phase === 'vote' && state.round === 2, 'r2 vote');
  const sV = snap(state);
  const aV = awardsSnap(ctx);
  fireOld(ctx, voteTimer1);
  must(state.phase === 'vote' && state.round === 2, 'old vote timer no reveal');
  must(snap(state) === sV && awardsSnap(ctx) === aV, 'old vote timer no mutation');
  const vv2 = V(def, state, 'p1');
  for (const pid of ['p1', 'p2', 'p3', 'p4']) {
    const mine = new Set(own2[pid] || []);
    const pick = vv2.lines.findIndex((_, idx) => !mine.has(idx));
    act(def, state, ctx, pid, { vote: pick });
  }
  must(state.phase === 'reveal' && state.round === 2, 'r2 reveal');
  const sR = snap(state);
  const aR = awardsSnap(ctx);
  fireOld(ctx, revealTimer1);
  must(state.phase === 'reveal' && state.round === 2, 'old reveal timer no skip');
  must(snap(state) === sR && awardsSnap(ctx) === aR, 'old reveal timer no mutation');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done' && state.endsAt === 0, 'done clock 0');
  return 'build/vote/reveal races blocked, turn/self/ghost rejected';
});

/* ---------------- trivia ---------------- */
test('trivia', () => {
  const def = registry.get('trivia');
  const ctx = new RaceCtx(roster(4), {});
  const state = def.create(ctx);
  must(state.phase === 'answer' && state.round === 1, 'starts answer r1');
  must(state.rounds === 8, 'fixed 8 rounds');
  const va = V(def, state, 'p1');
  must(va.question && va.question.options.length === 4, '4 options dealt');
  must(!('answer' in va.question), 'answer hidden');
  const s0 = snap(state);
  act(def, state, ctx, 'ghost', { pick: 0 });
  must(snap(state) === s0, 'ghost pick ignored');
  act(def, state, ctx, 'p1', null);
  must(snap(state) === s0, 'null action no throw');
  const correct = state.question.answer;
  act(def, state, ctx, 'p1', { pick: correct });
  const ab = JSON.stringify(state.answers);
  act(def, state, ctx, 'p1', { pick: (correct + 1) % 4 });
  must(JSON.stringify(state.answers) === ab, 'duplicate pick ignored');
  act(def, state, ctx, 'p2', { pick: (correct + 1) % 4 });
  act(def, state, ctx, 'p3', { pick: (correct + 2) % 4 });
  act(def, state, ctx, 'p4', { pick: (correct + 3) % 4 });
  must(state.phase === 'reveal', 'all answered -> reveal');
  must(state.endsAt === 0, 'reveal clock 0');
  must(state.last.results.p1.ok === true, 'correct graded ok');
  const ansTimer1 = ctx.timers[0];
  const revealTimer1 = ctx.lastTimer();
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'answer' && state.round === 2, 'next -> answer r2');
  ctx.advance(1000);
  const c2 = state.question.answer;
  act(def, state, ctx, 'p1', { pick: c2 });
  const sA = snap(state);
  const aA = awardsSnap(ctx);
  fireOld(ctx, ansTimer1);
  must(state.phase === 'answer' && state.round === 2, 'old answer timer no reveal');
  must(snap(state) === sA && awardsSnap(ctx) === aA, 'old answer timer no mutation');
  act(def, state, ctx, 'p2', { pick: (c2 + 1) % 4 });
  act(def, state, ctx, 'p3', { pick: (c2 + 2) % 4 });
  act(def, state, ctx, 'p4', { pick: (c2 + 3) % 4 });
  must(state.phase === 'reveal' && state.round === 2, 'r2 reveal');
  const sR = snap(state);
  const aR = awardsSnap(ctx);
  fireOld(ctx, revealTimer1);
  must(state.phase === 'reveal' && state.round === 2, 'old reveal timer no skip');
  must(snap(state) === sR && awardsSnap(ctx) === aR, 'old reveal timer no mutation');
  for (let r = 2; r <= 8; r++) {
    act(def, state, ctx, state.hostId, { next: true });
    if (state.phase === 'done') break;
    const c = state.question.answer;
    for (const pid of ['p1', 'p2', 'p3', 'p4']) act(def, state, ctx, pid, { pick: (c + (pid === 'p1' ? 0 : 1)) % 4 });
    must(state.phase === 'reveal', `round ${r} reveal`);
  }
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done' && state.endsAt === 0, 'done after 8');
  must(ctx.totalAwarded() > 0, 'points awarded');
  return 'answer/reveal races blocked, 8-round completion';
});

/* ---------------- truth-dare ---------------- */
test('truth-dare', () => {
  const def = registry.get('truth-dare');
  const ctx = new RaceCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  must(state.phase === 'spin' && state.round === 1, 'starts spin r1');
  const spinTimer1 = ctx.lastTimer();
  ctx.fireTimer(spinTimer1);
  must(state.phase === 'choose', 'spin timer -> choose');
  const target = state.target;
  const other = ['p1', 'p2', 'p3', 'p4'].find((id) => id !== target);
  const s0 = snap(state);
  act(def, state, ctx, other, { deck: 'classic', kind: 'truth' });
  must(snap(state) === s0, 'non-target choose ignored');
  act(def, state, ctx, 'ghost', { deck: 'classic', kind: 'truth' });
  must(snap(state) === s0, 'ghost choose ignored');
  act(def, state, ctx, target, { deck: 'classic', kind: 'truth' });
  must(state.phase === 'perform', 'target choose -> perform');
  const performTimer1 = ctx.lastTimer();
  act(def, state, ctx, other, { ready: true });
  must(state.phase === 'perform', 'peer cannot end performance');
  act(def, state, ctx, target, { ready: true });
  must(state.phase === 'vote', 'actor ready -> vote');
  const voteTimer1 = ctx.lastTimer();
  must(typeof V(def, state, other).prompt === 'string', 'prompt shown');
  act(def, state, ctx, target, { vote: 'yes' });
  must(!state.votes[target], 'target cannot vote');
  act(def, state, ctx, 'ghost', { vote: 'yes' });
  must(state.votes.ghost === undefined, 'ghost vote ignored');
  const voters = ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== target);
  act(def, state, ctx, voters[0], { vote: 'yes' });
  const vb = JSON.stringify(state.votes);
  act(def, state, ctx, voters[0], { vote: 'no' });
  must(JSON.stringify(state.votes) === vb, 'duplicate vote ignored');
  for (const v of voters.slice(1)) act(def, state, ctx, v, { vote: 'yes' });
  must(state.phase === 'reveal', 'unanimous reveal');
  const revealTimer1 = ctx.lastTimer();
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'spin' && state.round === 2, 'next -> spin r2');
  ctx.advance(1000);
  const spinTimer2 = ctx.lastTimer();
  ctx.fireTimer(spinTimer2);
  must(state.phase === 'choose' && state.round === 2, 'r2 choose');
  const t2 = state.target;
  act(def, state, ctx, t2, { deck: 'funny', kind: 'dare' });
  must(state.phase === 'perform' && state.round === 2, 'r2 perform');
  act(def, state, ctx, t2, { ready: true });
  must(state.phase === 'vote' && state.round === 2, 'r2 vote');
  const v2 = ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== t2);
  act(def, state, ctx, v2[0], { vote: 'yes' });
  const sV = snap(state);
  const aV = awardsSnap(ctx);
  fireOld(ctx, voteTimer1);
  must(state.phase === 'vote' && state.round === 2, 'old vote timer no reveal');
  must(snap(state) === sV && awardsSnap(ctx) === aV, 'old vote timer no mutation');
  for (const v of v2.slice(1)) act(def, state, ctx, v, { vote: 'no' });
  must(state.phase === 'reveal' && state.round === 2, 'r2 reveal');
  const sR = snap(state);
  const aR = awardsSnap(ctx);
  fireOld(ctx, revealTimer1);
  must(state.phase === 'reveal' && state.round === 2, 'old reveal timer no skip');
  must(snap(state) === sR && awardsSnap(ctx) === aR, 'old reveal timer no mutation');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done' && state.endsAt === 0, 'done clock 0');
  const beforeRetiredPerformance = snap(state);
  fireOld(ctx, performTimer1);
  must(snap(state) === beforeRetiredPerformance, 'retired performance timer cannot reopen judging');
  return 'vote/reveal races blocked, target/ghost rejected';
});

/* ---------------- two-truths ---------------- */
test('two-truths', () => {
  const def = registry.get('two-truths');
  const ctx = new RaceCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  must(state.phase === 'write' && state.round === 1, 'starts write r1');
  const subject = state.subject;
  must(typeof V(def, state, subject).idea === 'string', 'subject sees idea');
  const other = ['p1', 'p2', 'p3', 'p4'].find((id) => id !== subject);
  must(V(def, state, other).idea === '', 'idea hidden from others');
  must(V(def, state, other).statements.length === 0, 'no statements in write');
  const s0 = snap(state);
  act(def, state, ctx, other, { statements: ['a', 'b', 'c'], lie: 0 });
  must(snap(state) === s0, 'non-subject write ignored');
  act(def, state, ctx, 'ghost', { statements: ['a', 'b', 'c'], lie: 0 });
  must(snap(state) === s0, 'ghost write ignored');
  act(def, state, ctx, subject, { statements: ['I met a parrot mayor', 'I hate birthdays', 'I can juggle'], lie: 1 });
  must(state.phase === 'vote', 'subject write -> vote');
  const voteTimer1 = ctx.lastTimer();
  must(!('lie' in V(def, state, other)), 'lie hidden in vote');
  act(def, state, ctx, subject, { vote: 0 });
  must(state.votes[subject] === undefined, 'subject cannot vote');
  act(def, state, ctx, 'ghost', { vote: 1 });
  must(state.votes.ghost === undefined, 'ghost vote ignored');
  const voters = ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== subject);
  act(def, state, ctx, voters[0], { vote: 1 });
  const vb = JSON.stringify(state.votes);
  act(def, state, ctx, voters[0], { vote: 0 });
  must(JSON.stringify(state.votes) === vb, 'duplicate vote ignored');
  act(def, state, ctx, voters[1], { vote: 0 });
  act(def, state, ctx, voters[2], { vote: 2 });
  must(state.phase === 'reveal', 'all votes reveal');
  const revealTimer1 = ctx.lastTimer();
  act(def, state, ctx, subject, { next: true });
  must(state.phase === 'write' && state.round === 2, 'subject next -> write r2');
  ctx.advance(1000);
  const subj2 = state.subject;
  act(def, state, ctx, subj2, { statements: ['r2 sky', 'r2 sea', 'r2 sand'], lie: 2 });
  must(state.phase === 'vote' && state.round === 2, 'r2 vote');
  const v2 = ['p1', 'p2', 'p3', 'p4'].filter((id) => id !== subj2);
  act(def, state, ctx, v2[0], { vote: 2 });
  const sV = snap(state);
  const aV = awardsSnap(ctx);
  fireOld(ctx, voteTimer1);
  must(state.phase === 'vote' && state.round === 2, 'old vote timer no reveal');
  must(snap(state) === sV && awardsSnap(ctx) === aV, 'old vote timer no mutation');
  act(def, state, ctx, v2[1], { vote: 0 });
  act(def, state, ctx, v2[2], { vote: 1 });
  must(state.phase === 'reveal' && state.round === 2, 'r2 reveal');
  const sR = snap(state);
  const aR = awardsSnap(ctx);
  fireOld(ctx, revealTimer1);
  must(state.phase === 'reveal' && state.round === 2, 'old reveal timer no skip');
  must(snap(state) === sR && awardsSnap(ctx) === aR, 'old reveal timer no mutation');
  act(def, state, ctx, subj2, { next: true });
  must(state.phase === 'done' && state.endsAt === 0, 'done clock 0');
  return 'vote/reveal races blocked, subject/ghost rejected';
});

/* ---------------- would-you-rather ---------------- */
test('would-you-rather', () => {
  const def = registry.get('would-you-rather');
  const ctx = new RaceCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  must(state.phase === 'vote' && state.round === 1, 'starts vote r1');
  const v0 = V(def, state, 'p1');
  must(v0.votes && Object.keys(v0.votes).length === 0, 'votes hidden');
  must(v0.myVote === null, 'myVote null before voting');
  const s0 = snap(state);
  act(def, state, ctx, 'ghost', { vote: 'a' });
  must(snap(state) === s0, 'ghost vote ignored');
  act(def, state, ctx, 'p1', null);
  must(snap(state) === s0, 'null action no throw');
  act(def, state, ctx, 'p1', { vote: 'a' });
  act(def, state, ctx, 'p2', { vote: 'a' });
  act(def, state, ctx, 'p3', { vote: 'b' });
  const vb = JSON.stringify(state.votes);
  act(def, state, ctx, 'p1', { vote: 'b' });
  must(JSON.stringify(state.votes) === vb, 'duplicate vote ignored');
  must(state.phase === 'vote', '3 of 4 must not reveal');
  act(def, state, ctx, 'p4', { vote: 'b' });
  must(state.phase === 'reveal', 'all votes reveal');
  must(state.endsAt === 0, 'reveal clock 0');
  const voteTimer1 = ctx.timers[0];
  const revealTimer1 = ctx.lastTimer();
  act(def, state, ctx, nonHost(state), { next: true });
  must(state.phase === 'reveal', 'non-host next ignored');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'vote' && state.round === 2, 'next -> vote r2');
  ctx.advance(1000);
  act(def, state, ctx, 'p1', { vote: 'a' });
  const sV = snap(state);
  const aV = awardsSnap(ctx);
  fireOld(ctx, voteTimer1);
  must(state.phase === 'vote' && state.round === 2, 'old vote timer no reveal');
  must(snap(state) === sV && awardsSnap(ctx) === aV, 'old vote timer no mutation');
  act(def, state, ctx, 'p2', { vote: 'a' });
  act(def, state, ctx, 'p3', { vote: 'b' });
  act(def, state, ctx, 'p4', { vote: 'b' });
  must(state.phase === 'reveal' && state.round === 2, 'r2 reveal');
  const sR = snap(state);
  const aR = awardsSnap(ctx);
  fireOld(ctx, revealTimer1);
  must(state.phase === 'reveal' && state.round === 2, 'old reveal timer no skip');
  must(snap(state) === sR && awardsSnap(ctx) === aR, 'old reveal timer no mutation');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done' && state.endsAt === 0, 'done clock 0');
  return 'vote/reveal races blocked, dup/ghost rejected';
});

/* ---------------- runner ---------------- */
function main() {
  const ids = ['bluff', 'compliment-battle', 'dare-roulette', 'emoji-story', 'five-second',
    'funny-answer', 'hot-takes', 'lyric-fill', 'most-likely', 'never-ever', 'pick-one',
    'rank-it', 'rapid-polls', 'roast-toast', 'story-builder', 'trivia', 'truth-dare',
    'two-truths', 'would-you-rather'];
  let pass = 0;
  let fail = 0;
  const failed = [];
  for (const id of ids) {
    const fn = tests[id];
    if (!fn) {
      console.log(`PARTY-RACES ${id}: SKIP (no test)`);
      fail += 1;
      failed.push(id);
      continue;
    }
    seedRandom(hashSeed(`races:${id}`));
    try {
      const notes = fn();
      const def = registry.get(id);
      const rc = new RaceCtx(roster(4), {});
      const rs = def.create(rc);
      for (const p of roster(4)) V(def, rs, p.id);
      V(def, rs, 'ghost');
      console.log(`PARTY-RACES ${id}: PASS (${notes})`);
      pass += 1;
    } catch (e) {
      console.log(`PARTY-RACES ${id}: FAIL ${e.message}`);
      failed.push(id);
      fail += 1;
    }
  }
  Math.random = REAL_RANDOM;
  console.log(`PARTY-RACES SUMMARY: ${pass} passed, ${fail} failed of ${ids.length}`);
  if (failed.length) console.log(`PARTY-RACES FAILED: ${failed.join(',')}`);
  process.exit(fail ? 1 : 0);
}

if (require.main === module) main();
module.exports = { tests, RaceCtx };
