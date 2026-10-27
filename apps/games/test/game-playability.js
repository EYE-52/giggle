'use strict';
/* Full playthrough coverage for every registered game: create through at
 * least one valid player action with an observable result, then a complete
 * round/game driven ONLY by real legal actions (plus virtual-clock
 * deadlines for genuinely timed phases). Pure ctx harness with a virtual
 * server clock; no network, no browser, no production accounts.
 *
 * Driver discipline:
 * - Actions are informed by real per-player views. Secrets (words, roles,
 *   truths) are read only from the role view that legitimately sees them;
 *   where a driver simulates a knowledgeable player by peeking server
 *   state (trivia/lyric/countdown/bluff answers), it is marked PEEK.
 * - Timers are fired only to advance phases that genuinely require waiting
 *   (spin animations, memorize windows, countdowns); gameplay phases are
 *   completed with actions, never skipped via deadlines.
 * - Deterministic: Math.random is seeded per game; virtual clock starts
 *   fixed. Run: node test/game-playability.js
 */

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

/* Virtual server clock + room ctx double. Timers never run on wall time. */
class FakeCtx {
  constructor(players, settings) {
    this._players = players;
    this._settings = settings || {};
    this._now = 1700000000000;
    this.timers = [];
    this.awards = {};
    this.broadcasts = 0;
    this.seq = 0;
    this.fired = 0;
  }
  players() { return this._players.slice(); }
  allPlayers() { return this._players.slice(); }
  content() { return {}; } // fallbacks only, like a room with no packs
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
  pending() { return this.timers.filter((t) => !t.dead).length; }
  fireNext() {
    const live = this.timers.filter((t) => !t.dead).sort((a, b) => a.at - b.at || a.id - b.id);
    if (!live.length) return false;
    const t = live[0];
    t.dead = true;
    if (t.at > this._now) this._now = t.at;
    t.fn();
    this.fired += 1;
    return true;
  }
  /* Fire timers until cond() or cap; returns fires. */
  fireUntil(cond, cap) {
    let n = 0;
    const lim = cap === undefined ? 200 : cap;
    while (!cond() && n < lim && this.fireNext()) n += 1;
    return n;
  }
  totalAwarded() {
    return Object.values(this.awards).reduce((a, b) => a + b, 0);
  }
}

const NAMES = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus', 'Hal'];
function roster(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ id: 'p' + (i + 1), name: NAMES[i] });
  return out;
}
function ids(players) { return players.map((p) => p.id); }

/* Only keys the game's own manifest schema allows, clamped to range.
 * Games without a schema run unconfigured (legacy defaults). */
function settingsFor(def, wants) {
  const schema = (def.manifest && def.manifest.settings) || [];
  const out = {};
  for (const s of schema) {
    const v = wants[s.key];
    if (v === undefined) continue;
    if (s.type === 'int') {
      if (!Number.isInteger(v)) continue;
      out[s.key] = Math.max(s.min, Math.min(s.max, v));
    } else if (s.type === 'enum') {
      if (typeof v === 'string' && (s.options || []).includes(v)) out[s.key] = v;
    } else if (s.type === 'bool') {
      if (typeof v === 'boolean') out[s.key] = v;
    }
  }
  return out;
}
function enumOpt(def, key, substr) {
  const s = ((def.manifest && def.manifest.settings) || []).find((x) => x.key === key);
  const o = s && (s.options || []).find((x) => x.toLowerCase().includes(substr));
  if (!o) throw new Error(`no ${key} option matching ${substr}`);
  return o;
}

function must(c, msg) {
  if (!c) throw new Error(msg);
}
function walkNoFunctions(x, path) {
  if (x && typeof x === 'object') {
    for (const k of Object.keys(x)) {
      if (typeof x[k] === 'function') throw new Error(`function leaked at ${path}.${k}`);
      walkNoFunctions(x[k], `${path}.${k}`);
    }
  }
}
/* Real per-player view; asserts serializable + function-free. */
function V(def, state, pid) {
  const v = def.view(state, pid);
  must(v && typeof v === 'object', `view for ${pid} must return an object`);
  JSON.stringify(v); // must survive the socket
  walkNoFunctions(v, 'view');
  return v;
}
function act(def, state, ctx, pid, a) {
  return def.onAction(state, ctx, pid, a);
}
/* Inert garbage: must never throw and never mutate game state. The room
 * coerces falsy actions to {} before dispatch (server/room.js onAction),
 * so null/undefined are excluded here; six games rely on that guard. */
const GARBAGE = [{}, [], { zzz_nope: 1 }, { vote: {} }, { next: 0 }, { tap: 0 }];
function garbageOk(def, state, ctx, pid) {
  // clockStamp is legitimately refreshed by clocked games on every action.
  const flat = (s) => JSON.stringify(s, (k, v) => (
    k === 'clockStamp' ? 0 : typeof v === 'function' ? '[fn]' : typeof v === 'bigint' ? '[bi]' : v));
  const before = flat(state);
  for (const a of GARBAGE) def.onAction(state, ctx, pid, a);
  for (const a of GARBAGE) def.onAction(state, ctx, 'ghost', a);
  const after = flat(state);
  must(before === after, `garbage actions mutated state: ${before.slice(0, 200)} vs ${after.slice(0, 200)}`);
}
function expectHiddenVotes(v, game) {
  must(v.votes && Object.keys(v.votes).length === 0, `${game}: votes must stay hidden during vote`);
  must(Array.isArray(v.voted), `${game}: voted list present during vote`);
}

const drivers = {};
function driver(id, fn) { drivers[id] = fn; }

/* ---------------- would-you-rather ---------------- */
driver('would-you-rather', () => {
  const def = registry.get('would-you-rather');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  must(state.phase === 'vote', 'starts in vote');
  garbageOk(def, state, ctx, 'p1');
  for (let r = 0; r < 2; r++) {
    must(state.phase === 'vote', `round ${r + 1} vote phase`);
    const v0 = V(def, state, 'p1');
    expectHiddenVotes(v0, 'wyr');
    must(v0.myVote === null, 'myVote null before voting');
    must(v0.prompt && v0.prompt.a && v0.prompt.b, 'prompt has both options');
    act(def, state, ctx, 'p1', { vote: 'a' });
    act(def, state, ctx, 'p2', { vote: 'a' });
    act(def, state, ctx, 'p3', { vote: 'b' });
    // Simultaneous/duplicate: a second vote from p1 is ignored.
    const before = JSON.stringify(state.votes);
    act(def, state, ctx, 'p1', { vote: 'b' });
    must(JSON.stringify(state.votes) === before, 'duplicate vote ignored');
    must(state.phase === 'vote', '3 of 4 votes must not reveal yet');
    act(def, state, ctx, 'p4', { vote: 'b' });
    must(state.phase === 'reveal', 'unanimous arrival reveals');
    const vr = V(def, state, 'p1');
    must(vr.last && vr.last.winners, 'reveal carries the winners');
    must(vr.last.winners.includes('a') && vr.last.winners.includes('b'), '2-2 tie crowns both sides');
    must(vr.votes.p1 === 'a' && vr.votes.p4 === 'b', 'reveal shows every vote');
    must(ctx.totalAwarded() > 0, 'majority voters awarded session points');
    const nonHost = state.hostId === 'p1' ? 'p2' : 'p1';
    act(def, state, ctx, nonHost, { next: true });
    must(state.phase === 'reveal', 'non-host next ignored');
    act(def, state, ctx, state.hostId, { next: true });
  }
  must(state.phase === 'done', 'done after 2 rounds');
  return '2 rounds, 2-2 split, dup vote ignored, non-host next ignored';
});

/* ---------------- never-ever ---------------- */
driver('never-ever', () => {
  const def = registry.get('never-ever');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  must(state.phase === 'vote', 'starts in vote');
  garbageOk(def, state, ctx, 'p1');
  for (let r = 0; r < 2; r++) {
    const v0 = V(def, state, 'p2');
    expectHiddenVotes(v0, 'never-ever');
    must(typeof v0.statement === 'string' && v0.statement.length > 0, 'statement dealt');
    act(def, state, ctx, 'p1', { vote: 'have' });
    act(def, state, ctx, 'p2', { vote: 'not' });
    act(def, state, ctx, 'p3', { vote: 'have' });
    act(def, state, ctx, 'p4', { vote: 'not' });
    must(state.phase === 'reveal', 'all votes reveal');
    must(state.last, 'reveal has last');
    act(def, state, ctx, state.hostId, { next: true });
  }
  must(state.phase === 'done', 'done after 2 rounds');
  return '2 rounds, honest split, hidden ballots';
});

/* ---------------- pick-one ---------------- */
driver('pick-one', () => {
  const def = registry.get('pick-one');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  for (let r = 0; r < 2; r++) {
    must(state.phase === 'vote', `round ${r + 1} vote`);
    expectHiddenVotes(V(def, state, 'p3'), 'pick-one');
    for (const pid of ['p1', 'p2', 'p3', 'p4']) act(def, state, ctx, pid, { vote: pid < 'p3' ? 'a' : 'b' });
    must(state.phase === 'reveal', 'reveal after all votes');
    must(state.last, 'last recorded');
    act(def, state, ctx, state.hostId, { next: true });
  }
  must(state.phase === 'done', 'done after 2 rounds');
  return '2 rapid rounds, majority path';
});

/* ---------------- most-likely ---------------- */
driver('most-likely', () => {
  const def = registry.get('most-likely');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 1 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'vote', 'starts in vote');
  expectHiddenVotes(V(def, state, 'p1'), 'most-likely');
  must(typeof V(def, state, 'p1').prompt === 'string', 'prompt dealt');
  act(def, state, ctx, 'p1', { vote: 'p1' });
  must(!state.votes.p1, 'self vote ignored');
  act(def, state, ctx, 'p1', { vote: 'ghost' });
  must(!state.votes.p1, 'stranger vote ignored');
  act(def, state, ctx, 'p1', { vote: 'p2' });
  act(def, state, ctx, 'p2', { vote: 'p3' });
  act(def, state, ctx, 'p3', { vote: 'p2' });
  act(def, state, ctx, 'p4', { vote: 'p2' });
  must(state.phase === 'reveal', 'reveal after all vote');
  must(state.last, 'last recorded');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done', 'done after 1 round');
  return 'plurality for p2, self/stranger votes rejected';
});

/* ---------------- trivia (PEEK: p1 simulates knowing the answer) ---------------- */
driver('trivia', () => {
  const def = registry.get('trivia');
  const ctx = new FakeCtx(roster(4), settingsFor(def, {}));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.rounds === 8, 'legacy 8 rounds unconfigured');
  let p1Before = 0;
  for (let r = 0; r < 8; r++) {
    must(state.phase === 'answer', `round ${r + 1} answer phase`);
    const va = V(def, state, 'p1');
    must(va.question && va.question.options.length === 4, 'question with 4 options');
    must(!('answer' in va.question), 'answer hidden while answering');
    must(va.myPick === null, 'myPick null before answering');
    const correct = state.question.answer; // PEEK: knowledge simulation
    act(def, state, ctx, 'p1', { pick: correct });
    act(def, state, ctx, 'p2', { pick: (correct + 1) % 4 });
    act(def, state, ctx, 'p3', { pick: (correct + 2) % 4 });
    act(def, state, ctx, 'p4', { pick: (correct + 3) % 4 });
    must(state.phase === 'reveal', 'all answers reveal');
    must(state.last && state.last.results, 'reveal has graded results');
    must(state.last.results.p1.ok === true, 'correct pick graded ok');
    must(state.last.results.p2.ok === false, 'wrong pick graded miss');
    must((ctx.awards.p1 || 0) > p1Before, 'correct answer scores session points');
    p1Before = ctx.awards.p1 || 0;
    act(def, state, ctx, state.hostId, { next: true });
  }
  must(state.phase === 'done', 'done after 8 rounds');
  must(ctx.totalAwarded() > 0, 'session points awarded');
  return '8 rounds, correct-answer scoring + streaks, hidden answers';
});

/* ---------------- hot-takes ---------------- */
driver('hot-takes', () => {
  const def = registry.get('hot-takes');
  const ctx = new FakeCtx(roster(4), settingsFor(def, {}));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'submit', 'starts in submit');
  const takes = { p1: 'Pineapple belongs on pizza', p2: 'Mornings are the best', p3: 'Cats beat dogs', p4: 'Socks with sandals rule' };
  for (const pid of ['p1', 'p2', 'p3']) {
    act(def, state, ctx, pid, { take: takes[pid] });
    must(V(def, state, pid).myTake === takes[pid], `${pid} sees own draft`);
  }
  act(def, state, ctx, 'p4', { take: takes.p4 }); // final submit flips to vote
  must(state.phase === 'vote', 'all submitted -> vote');
  let judged = 0;
  for (let guard = 0; guard < 12 && state.phase !== 'done'; guard++) {
    must(state.phase === 'vote', 'voting phase per take');
    const cur = V(def, state, 'p1').current;
    must(cur && cur.text, 'current take presented');
    must(cur.author === null, 'author anonymous while voting');
    // Every non-author votes; alternate sides for a divisive split.
    let i = 0;
    for (const pid of ['p1', 'p2', 'p3', 'p4']) {
      if (V(def, state, pid).current.mine) continue;
      act(def, state, ctx, pid, { vote: i++ % 2 === 0 ? 'agree' : 'disagree' });
    }
    must(state.phase === 'reveal', 'take revealed after eligible votes');
    must(V(def, state, 'p1').current.author !== null, 'author revealed after voting');
    judged += 1;
    act(def, state, ctx, state.hostId, { next: true });
  }
  must(state.phase === 'done', 'done after every take judged');
  must(judged === 4, `all 4 takes judged, saw ${judged}`);
  must(state.winners && state.winners.length > 0, 'most divisive take crowned (ties share it)');
  must(ctx.totalAwarded() > 0, 'points awarded');
  return '4 takes, anonymous ballots, divisive winner';
});

/* ---------------- rank-it ---------------- */
driver('rank-it', () => {
  const def = registry.get('rank-it');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 1 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'rank', 'starts in rank');
  const vr = V(def, state, 'p1');
  must(vr.set, 'ranking set dealt');
  must(vr.ranks && Object.keys(vr.ranks).length === 0, 'ranks hidden while ranking');
  act(def, state, ctx, 'p1', { order: [0, 1] });
  must(!state.ranks.p1, 'short order rejected');
  act(def, state, ctx, 'p1', { order: [0, 0, 1, 2, 3] });
  must(!state.ranks.p1, 'duplicate order rejected');
  const orders = { p1: [0, 1, 2, 3, 4], p2: [0, 1, 2, 3, 4], p3: [4, 3, 2, 1, 0], p4: [0, 1, 2, 4, 3] };
  for (const pid of Object.keys(orders)) act(def, state, ctx, pid, { order: orders[pid] });
  must(state.phase === 'reveal', 'all ranked -> reveal');
  must(state.last, 'consensus reveal recorded');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done', 'done after 1 round');
  return 'consensus scoring, invalid orders rejected';
});

/* ---------------- two-truths ---------------- */
driver('two-truths', () => {
  const def = registry.get('two-truths');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 1 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'write', 'starts in write');
  const subject = state.subject;
  must(subject, 'a subject is chosen');
  must(typeof V(def, state, subject).idea === 'string', 'subject sees an idea');
  const other = ids(ctx.players()).find((id) => id !== subject);
  must(V(def, state, other).idea === '', 'idea hidden from non-subjects');
  must(V(def, state, other).statements.length === 0, 'no statements while writing');
  act(def, state, ctx, other, { statements: ['a', 'b', 'c'], lie: 0 });
  must(state.phase === 'write', 'non-subject statements ignored');
  act(def, state, ctx, subject, {
    statements: ['I once met a parrot mayor', 'I hate birthdays', 'I can juggle'],
    lie: 1,
  });
  must(state.phase === 'vote', 'subject writing opens the vote');
  must(!('lie' in V(def, state, other)), 'lie index hidden while voting');
  const voters = ids(ctx.players()).filter((id) => id !== subject);
  act(def, state, ctx, voters[0], { vote: 1 }); // spots it
  act(def, state, ctx, voters[1], { vote: 0 });
  act(def, state, ctx, voters[2], { vote: 2 });
  must(state.phase === 'reveal', 'all votes reveal');
  must(state.lie === 1, 'lie revealed');
  must((state.scores[voters[0]] || 0) > 0, 'lie-spotter scores');
  act(def, state, ctx, subject, { next: true });
  must(state.phase === 'done', 'done after 1 round');
  return 'lie hidden then revealed, spotter scores';
});

/* ---------------- funny-answer ---------------- */
driver('funny-answer', () => {
  const def = registry.get('funny-answer');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 1 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'answer', 'starts in answer');
  must(typeof V(def, state, 'p1').prompt === 'string', 'prompt dealt');
  const mine = { p1: 'a confused penguin', p2: 'my left sock', p3: 'tax season', p4: 'a haunted toaster' };
  for (const pid of Object.keys(mine)) act(def, state, ctx, pid, { answer: mine[pid] });
  must(state.phase === 'vote', 'all answered -> vote');
  const vv = V(def, state, 'p1');
  must(vv.options.length === 4, 'four anonymous options');
  must(vv.options.every((o) => !('pid' in o)), 'options hide authorship');
  // Vote a rival's option by matching our own text (what a player knows).
  for (const pid of Object.keys(mine)) {
    const mineOpt = vv.options.find((o) => o.text === mine[pid]);
    const rival = vv.options.find((o) => o.aid !== mineOpt.aid);
    const before = state.votes[pid];
    act(def, state, ctx, pid, { vote: mineOpt.aid });
    must(state.votes[pid] === before, 'self vote rejected');
    act(def, state, ctx, pid, { vote: rival.aid });
  }
  must(state.phase === 'reveal', 'all votes reveal');
  must(state.last, 'winner reveal recorded');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done', 'done after 1 round');
  return 'anonymous ballot, self-vote rejected, winner crowned';
});

/* ---------------- bluff (PEEK: p1 identifies the truth option) ---------------- */
driver('bluff', () => {
  const def = registry.get('bluff');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 1 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'bluff', 'starts in bluff');
  const vb = V(def, state, 'p1');
  must(vb.fact && vb.fact.prompt, 'prompt shown');
  must(vb.fact.truth === '', 'truth hidden while bluffing');
  const truth = state.fact.truth; // PEEK only to avoid submitting it
  act(def, state, ctx, 'p1', { fake: truth });
  must(!state.fakes.p1, 'a fake that IS the truth is rejected');
  const fakes = { p1: 'because squirrels unionized', p2: 'gravity took a day off', p3: 'the moon sneezed', p4: 'pigeons voted twice' };
  for (const pid of Object.keys(fakes)) act(def, state, ctx, pid, { fake: fakes[pid] });
  must(state.phase === 'pick', 'all fakes -> pick');
  const vp = V(def, state, 'p2');
  must(vp.fact.truth === '', 'truth still hidden while picking');
  must(vp.options.length === 5, 'truth + 4 fakes offered');
  const truthOpt = state.options.find((o) => o.pid === null); // PEEK: knowledge
  const before = { ...state.scores };
  void before;
  act(def, state, ctx, 'p1', { pick: truthOpt.oid });
  for (const pid of ['p2', 'p3', 'p4']) {
    const own = state.options.find((o) => o.pid === pid);
    const pick = state.options.find((o) => o.oid !== own.oid && o.oid !== truthOpt.oid) || truthOpt;
    act(def, state, ctx, pid, { pick: pick.oid });
  }
  must(state.phase === 'reveal', 'all picks reveal');
  must(state.fact.truth.length > 0, 'truth shown at reveal');
  must((state.scores.p1 || 0) > 0, 'truth-finder scores');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done', 'done after 1 round');
  return 'truth hidden then found, fool-votes scored';
});

/* ---------------- story-builder ---------------- */
driver('story-builder', () => {
  const def = registry.get('story-builder');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 1 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'build', 'starts in build');
  must(typeof V(def, state, 'p1').seed === 'string', 'seed line dealt');
  const ownLines = {};
  for (let guard = 0; guard < 10 && state.phase === 'build'; guard++) {
    const turn = V(def, state, 'p1').turn;
    must(turn, 'a turn holder is seated');
    act(def, state, ctx, turn, { line: `And then ${turn} found a mysterious key.` });
    const idx = state.lines.length - 1;
    (ownLines[turn] = ownLines[turn] || []).push(idx);
  }
  must(state.phase === 'vote', 'full rotation opens the vote');
  must(state.lines.length === 4, 'one line per player');
  const vv = V(def, state, 'p1');
  must(vv.lines.every((l) => !('pid' in l)), 'ballot anonymizes authors');
  for (const pid of ['p1', 'p2', 'p3', 'p4']) {
    const mine = new Set(ownLines[pid] || []);
    const pick = vv.lines.findIndex((_, i) => !mine.has(i));
    act(def, state, ctx, pid, { vote: pick });
  }
  must(state.phase === 'reveal', 'all votes reveal');
  must(state.last, 'favorite-line reveal recorded');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done', 'done after 1 story');
  return '4-link story, anonymous favorite vote';
});

/* ---------------- emoji-story ---------------- */
driver('emoji-story', () => {
  const def = registry.get('emoji-story');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 1 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'emoji', 'starts in emoji');
  const director = state.director;
  must(director, 'a director is chosen');
  const dp = V(def, state, director).phrase;
  must(dp && dp.length > 0, 'director sees the secret phrase');
  const guesser = ids(ctx.players()).find((id) => id !== director);
  must(V(def, state, guesser).phrase === '', 'phrase hidden from guessers');
  act(def, state, ctx, director, { emoji: 'this has letters' });
  must(state.phase === 'emoji', 'ASCII text rejected as emoji story');
  act(def, state, ctx, guesser, { emoji: '🍕🎉' });
  must(state.phase === 'emoji', 'non-director emoji ignored');
  act(def, state, ctx, director, { emoji: '🍕🎉🐱🚀' });
  must(state.phase === 'guess', 'emoji story opens guessing');
  must(V(def, state, guesser).phrase === '', 'phrase still hidden while guessing');
  act(def, state, ctx, guesser, { guess: 'definitely not the phrase zzz' });
  must(!state.solved[guesser], 'wrong guess solves nothing');
  for (const pid of ids(ctx.players()).filter((id) => id !== director)) {
    act(def, state, ctx, pid, { guess: dp }); // director view informs the shot
  }
  must(state.phase === 'reveal', 'all solved -> reveal');
  must(Object.keys(state.solved).length === 3, 'every guesser solved');
  must((state.scores[director] || 0) > 0, 'director earns per solver');
  act(def, state, ctx, director, { next: true });
  must(state.phase === 'done', 'done after 1 round');
  return 'secret phrase projected to director only, speed scoring';
});

/* ---------------- scattergories ---------------- */
driver('scattergories', () => {
  const def = registry.get('scattergories');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 1 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'write', 'starts in write');
  const vw = V(def, state, 'p1');
  must(typeof vw.letter === 'string' && vw.letter.length === 1, 'letter dealt');
  must(vw.categories.length === 5, 'five categories dealt');
  must(vw.mine.length === 5, 'blank sheet of five');
  const L = vw.letter.toLowerCase();
  // Unique answers per player per category; p4 duplicates p1 in cat 0.
  const sheets = {};
  for (const pid of ['p1', 'p2', 'p3', 'p4']) {
    sheets[pid] = vw.categories.map((_, i) => `${L}answer${pid}${i}`);
  }
  sheets.p4[0] = sheets.p1[0];
  for (const pid of Object.keys(sheets)) {
    act(def, state, ctx, pid, { answers: sheets[pid] });
    must(V(def, state, pid).mine[0] === sheets[pid][0], `${pid} sheet echoes`);
  }
  must(V(def, state, 'p2').locked !== undefined, 'lock roster visible');
  for (const pid of Object.keys(sheets)) act(def, state, ctx, pid, { lock: true });
  must(state.phase === 'reveal', 'all locked -> reveal');
  must(state.last && state.last.points, 'reveal carries points');
  must(state.last.points.p1 === 160, `p1 scores 4 unique (40 each), saw ${state.last.points.p1}`);
  must(state.last.points.p4 === 160, `p4 scores 4 unique (40 each), saw ${state.last.points.p4}`);
  must(state.last.points.p2 === 200 && state.last.points.p3 === 200, 'clean sheets score 200 (40 per unique answer)');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done', 'done after 1 round');
  return 'uniqueness rule enforced (dupes score 0), lock flow';
});

/* ---------------- countdown-word ---------------- */
driver('countdown-word', () => {
  const def = registry.get('countdown-word');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  const dictionary = require('../games/engines/english-dictionary').createWordValidator();
  for (let round = 1; round <= 2; round++) {
    must(state.phase === 'make' && state.round === round, 'every Countdown round starts');
    const view = V(def, state, 'p1');
    must(view.letters.length === 9 && view.best === null && !('validator' in view), 'solvable tray; house word/dictionary objects hidden');
    // PEEK: simulate players who know a genuine word from this solvable tray.
    const answer = state.best;
    must(dictionary.validate(answer, { minLength: 3, maxLength: 9, letters: view.letters }).ok, 'generated house word is supported English and fits');
    const nonsense = [...view.letters].map(l => l.toLowerCase()).sort().join('');
    must(!dictionary.has(nonsense), 'full-tray anagram is nonsense, not English');
    const deadline = state.endsAt;
    act(def, state, ctx, 'p1', { word: nonsense, lock: true });
    must(!state.answers.p1 && !state.locked.p1, 'arbitrary letter subset cannot score or lock');
    must(V(def, state, 'p1').myFeedback?.ok === false, 'dictionary rejection surfaced');
    act(def, state, ctx, 'p1', { word: 'zzz', lock: true });
    must(!state.answers.p1 && state.endsAt === deadline, 'unknown word cannot extend clock');
    act(def, state, ctx, 'p1', { word: answer, lock: true });
    act(def, state, ctx, 'p2', { word: answer.toUpperCase(), lock: true });
    act(def, state, ctx, 'p3', { word: answer });
    act(def, state, ctx, 'p3', { word: nonsense, lock: true });
    must(state.answers.p3 === answer && !state.locked.p3, 'invalid replacement cannot silently lock previous answer');
    act(def, state, ctx, 'p3', { lock: true });
    act(def, state, ctx, 'p4', { pass: true });
    must(state.phase === 'reveal', 'three valid locks and pass reveal');
    const points = 50 + answer.length * 10 + 50;
    must(state.last.points.p1 === points && state.last.points.p2 === points && state.last.points.p3 === points, 'all longest ties earn length plus bonus');
    must(state.last.points.p4 === 0, 'pass scores zero');
    act(def, state, ctx, 'p2', { next: true });
    must(state.phase === 'reveal', 'peer next ignored');
    act(def, state, ctx, 'p1', { next: true });
  }
  must(state.phase === 'done' && ctx.totalAwarded() > 0, 'complete valid two-round match');
  def.dispose(state);
  return 'real offline dictionary + subset checks, supported generated trays, private retry feedback, longest ties/pass and two rounds';
});

/* ---------------- lyric-fill (PEEK: p1 knows the lyric) ---------------- */
driver('lyric-fill', () => {
  const def = registry.get('lyric-fill');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 1 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'fill', 'starts in fill');
  const vf = V(def, state, 'p1');
  must(vf.line && vf.line.before !== undefined, 'line lead-in shown');
  must(!('answer' in vf.line), 'answer hidden while filling');
  const answer = state.line.answer; // PEEK: knowledge simulation
  act(def, state, ctx, 'p1', { text: answer });
  act(def, state, ctx, 'p2', { text: 'something entirely wrong zzz' });
  act(def, state, ctx, 'p3', { text: answer.toUpperCase() + ' ' });
  act(def, state, ctx, 'p4', { text: 'zzz wrong' });
  must(state.phase === 'reveal', 'all filled -> reveal');
  must(state.last, 'reveal recorded');
  const pts = state.last.points || state.last.scores || {};
  void pts;
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done', 'done after 1 round');
  return 'exact-match path exercised, hidden answer';
});

/* ---------------- five-second ---------------- */
driver('five-second', () => {
  const def = registry.get('five-second');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  for (let r = 0; r < 2; r++) {
    must(state.phase === 'answer', `round ${r + 1} answer phase`);
    const perf = state.performer;
    must(perf, 'a performer is seated');
    must(typeof V(def, state, perf).category === 'string', 'category dealt');
    const other = ids(ctx.players()).find((id) => id !== perf);
    act(def, state, ctx, other, { answers: 'x, y, z' });
    must(state.phase === 'answer', 'non-performer answers ignored');
    act(def, state, ctx, perf, { answers: 'lions, tigers, bears' });
    must(state.phase === 'vote', 'performer answers open judging');
    must(V(def, state, other).answers.length === 3, 'judges see the three answers');
    const voters = ids(ctx.players()).filter((id) => id !== perf);
    if (r === 0) {
      for (const v of voters) act(def, state, ctx, v, { vote: 'pass' });
    } else {
      act(def, state, ctx, voters[0], { vote: 'pass' });
      act(def, state, ctx, voters[1], { vote: 'fail' });
      act(def, state, ctx, voters[2], { vote: 'fail' });
    }
    must(state.phase === 'reveal', 'all judges reveal');
    must(state.last, 'verdict recorded');
    if (r === 0) must((state.scores[perf] || 0) > 0, 'passed performer scores');
    act(def, state, ctx, perf, { next: true });
  }
  must(state.phase === 'done', 'done after 2 rounds');
  // Timeout path: silence from the performer still advances.
  const ctx2 = new FakeCtx(roster(4), settingsFor(def, { rounds: 1 }));
  const st2 = def.create(ctx2);
  ctx2.fireUntil(() => st2.phase !== 'answer');
  must(st2.phase === 'vote', 'answer deadline advances to judging');
  return 'pass + fail verdicts, performer rotation, answer timeout';
});

/* ---------------- charades ---------------- */
driver('charades', () => {
  const def = registry.get('charades');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 1, roundSeconds: 30 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'act', 'starts in act');
  const actor = state.actor;
  const word = V(def, state, actor).wordShown;
  must(word && word.length > 0, 'actor sees the word');
  const guesser = ids(ctx.players()).find((id) => id !== actor);
  const gv = V(def, state, guesser);
  must(!('word' in gv) && gv.masked, 'guessers see only the mask');
  act(def, state, ctx, guesser, { guess: 'zzz wrong guess' });
  must(!state.guessed[guesser], 'wrong guess scores nothing');
  must(V(def, state, guesser).guesses.length === 1, 'guesser sees own attempt');
  const other = ids(ctx.players()).find((id) => id !== actor && id !== guesser);
  must(V(def, state, other).guesses.length === 0, 'guessers cannot see each other');
  must(V(def, state, actor).guesses.length === 1, 'actor sees the full stream');
  for (const pid of ids(ctx.players()).filter((id) => id !== actor)) {
    act(def, state, ctx, pid, { guess: word }); // actor view informs the shot
  }
  must(state.phase === 'reveal', 'all correct -> reveal');
  must(Object.keys(state.guessed).length === 3, 'every guesser scored by speed');
  must((state.scores[actor] || 0) > 0, 'actor earns a share');
  act(def, state, ctx, actor, { next: true });
  must(state.phase === 'done', 'done after 1 round');
  // Timeout path: the clock ends the turn with no guesses.
  const ctx2 = new FakeCtx(roster(4), settingsFor(def, { rounds: 1, roundSeconds: 30 }));
  const st2 = def.create(ctx2);
  ctx2.fireUntil(() => st2.phase !== 'act');
  must(st2.phase === 'reveal', 'round deadline ends the turn');
  return 'masked projection, per-guesser streams, speed scoring, timeout';
});

/* ---------------- twenty-questions ---------------- */
driver('twenty-questions', () => {
  const def = registry.get('twenty-questions');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 1, roundSeconds: 60 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'play', 'starts in play');
  const answerer = state.answerer;
  const word = V(def, state, answerer).wordShown;
  must(word, 'answerer sees the secret');
  const q1 = ids(ctx.players()).find((id) => id !== answerer);
  must(!('word' in V(def, state, q1)) || V(def, state, q1).word === undefined, 'secret hidden from askers');
  act(def, state, ctx, q1, { question: 'Is it alive?' });
  must(state.questions.length === 1, 'question recorded');
  act(def, state, ctx, q1, { question: 'Is it big?' });
  must(state.questions.length === 1, 'second open question from same asker refused');
  act(def, state, ctx, answerer, { answer: 'yes', qi: 0 });
  must(state.questions[0].answer === 'yes', 'answer recorded');
  act(def, state, ctx, q1, { guess: 'zzz not it' });
  must(state.wrong.length === 1, 'wrong guess logged publicly');
  const q2 = ids(ctx.players()).find((id) => id !== answerer && id !== q1);
  act(def, state, ctx, q2, { question: 'Is it in this room?' });
  act(def, state, ctx, answerer, { answer: 'no', qi: 1 });
  act(def, state, ctx, q2, { guess: word }); // answerer view informs the shot
  must(state.phase === 'reveal', 'correct guess reveals');
  must(state.last && state.last.winner === q2, 'winner recorded');
  must((state.scores[q2] || 0) > 0, 'winner scores by few-questions bonus');
  act(def, state, ctx, answerer, { next: true });
  must(state.phase === 'done', 'done after 1 round');
  return 'yes/no flow, wrong-guess log, bonus scoring';
});

/* ---------------- memory-tray ---------------- */
driver('memory-tray', () => {
  const def = registry.get('memory-tray');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 1, memSeconds: 5, recallSeconds: 10 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'memorize', 'starts in memorize');
  const items = V(def, state, 'p1').items.slice();
  must(items.length === 8, `tray holds 8, saw ${items.length}`);
  ctx.fireUntil(() => state.phase !== 'memorize');
  must(state.phase === 'recall', 'memorize deadline opens recall');
  const vr = V(def, state, 'p1');
  must(!('items' in vr), 'tray hidden while recalling');
  act(def, state, ctx, 'p1', { recall: items.join(', ') });
  act(def, state, ctx, 'p2', { recall: items.slice(0, 4).join(', ') });
  act(def, state, ctx, 'p3', { recall: 'zzz-nope, nothing-here' });
  act(def, state, ctx, 'p4', { recall: items.slice(0, 2).join(', ') });
  must(state.phase === 'reveal', 'all recalled -> reveal');
  must(state.last, 'recall reveal recorded');
  const res = state.last.results || {};
  if (res.p1) {
    const n = Array.isArray(res.p1.correct) ? res.p1.correct.length : res.p1.correct;
    must(n === 8, `perfect recall scores 8, saw ${JSON.stringify(res.p1.correct)}`);
  }
  must((state.scores.p1 || 0) > (state.scores.p2 || 0), 'more recall outscores less');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done', 'done after 1 round');
  return 'memorize window, hidden tray, graded recall';
});

/* ---------------- rapid-polls ---------------- */
driver('rapid-polls', () => {
  const def = registry.get('rapid-polls');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'pose', 'starts in pose');
  act(def, state, ctx, 'p1', { pose: { q: 'x', options: ['only'] } });
  must(state.phase === 'pose', 'malformed poll rejected');
  act(def, state, ctx, 'p1', { pose: { q: 'Best ship snack?', options: ['Chips', 'Fruit', 'Cake'] } });
  must(state.phase === 'vote', 'custom poll opens voting');
  must(V(def, state, 'p1').poll.by === 'p1', 'poser credited');
  act(def, state, ctx, 'p1', { vote: 0 });
  act(def, state, ctx, 'p2', { vote: 1 });
  const mid = V(def, state, 'p3');
  must(mid.counts.join(',') === '1,1,0', `live counts roll in, saw ${mid.counts}`);
  must(mid.myVote === null, 'myVote null until voting');
  act(def, state, ctx, 'p3', { vote: 0 });
  const before = JSON.stringify(state.votes);
  act(def, state, ctx, 'p3', { vote: 2 });
  must(JSON.stringify(state.votes) === before, 'duplicate vote ignored');
  act(def, state, ctx, 'p4', { vote: 2 });
  must(state.phase === 'reveal', 'all votes reveal');
  must(state.last.poll.q === 'Best ship snack?', 'poll recorded');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'pose', 'back to pose for round 2');
  act(def, state, ctx, 'p2', { starter: true });
  must(state.phase === 'vote', 'seeded starter poll works');
  for (const pid of ['p1', 'p2', 'p3', 'p4']) act(def, state, ctx, pid, { vote: 0 });
  must(state.phase === 'reveal', 'round 2 reveals');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done', 'done after 2 rounds');
  return 'custom + starter polls, live counts, no scoring by design';
});

/* ---------------- truth-dare ---------------- */
driver('truth-dare', () => {
  const def = registry.get('truth-dare');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 1 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'spin', 'starts in spin');
  must(state.target, 'spinner lands on a target');
  ctx.fireUntil(() => state.phase !== 'spin');
  must(state.phase === 'choose', 'spin animation advances to choose');
  const target = state.target;
  const other = ids(ctx.players()).find((id) => id !== target);
  act(def, state, ctx, other, { deck: 'classic', kind: 'truth' });
  must(state.phase === 'choose', 'non-target choice ignored');
  act(def, state, ctx, target, { deck: 'classic', kind: 'truth' });
  must(state.phase === 'perform', 'target choice grants performance time');
  act(def, state, ctx, other, {vote:'yes'});
  must(Object.keys(state.votes).length === 0, 'no judging during performance');
  act(def, state, ctx, target, {ready:true});
  must(state.phase === 'vote', 'actor opens judging');
  must(typeof V(def, state, other).prompt === 'string', 'prompt shown to voters');
  expectHiddenVotes(V(def, state, other), 'truth-dare');
  for (const pid of ids(ctx.players()).filter((id) => id !== target)) {
    act(def, state, ctx, pid, { vote: 'yes' });
  }
  must(state.phase === 'reveal', 'unanimous jury reveals');
  must(state.last && state.last.yes === 3, 'yes votes tallied');
  must(state.last.targetPts >= 100, `target earns a good round, saw ${state.last.targetPts}`);
  must(ctx.totalAwarded() > 0, 'voters + target awarded');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done', 'done after 1 round');
  return 'spin->choose->vote->reveal, majority bonus';
});

/* ---------------- dare-roulette ---------------- */
driver('dare-roulette', () => {
  const def = registry.get('dare-roulette');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 1 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'spin', 'starts in spin');
  act(def, state, ctx, 'p2', { spin: true });
  must(state.phase === 'perform', 'spin seats a victim with performance time');
  act(def, state, ctx, state.victim, { ready: true });
  must(state.phase === 'verdict', 'victim opens judging');
  must(state.victim && state.dare, 'victim + dare dealt');
  const jurors = ids(ctx.players()).filter((id) => id !== state.victim);
  expectHiddenVotes(V(def, state, jurors[0]), 'dare-roulette');
  act(def, state, ctx, state.victim, { vote: 'done' });
  must(!state.votes[state.victim], 'victim cannot judge themselves');
  for (const j of jurors) act(def, state, ctx, j, { vote: 'done' });
  must(state.phase === 'reveal', 'full jury resolves');
  must(state.last, 'verdict recorded');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done', 'done after 1 round');
  // Timeout path: nobody spins, the wheel spins itself.
  const ctx2 = new FakeCtx(roster(4), settingsFor(def, { rounds: 1 }));
  const st2 = def.create(ctx2);
  ctx2.fireUntil(() => st2.phase !== 'spin');
  must(st2.phase === 'perform', 'spin deadline auto-spins into performance');
  return 'wheel spin, jury verdict, auto-spin timeout';
});

/* ---------------- compliment-battle ---------------- */
driver('compliment-battle', () => {
  const def = registry.get('compliment-battle');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 1 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'write', 'starts in write');
  const target = state.target;
  must(target, 'a target is crowned');
  act(def, state, ctx, target, { entry: 'I am great' });
  must(!state.entries[target], 'target cannot write their own praise');
  const writers = ids(ctx.players()).filter((id) => id !== target);
  for (const w of writers) act(def, state, ctx, w, { entry: `${w} says: you shine like a lighthouse` });
  must(state.phase === 'vote', 'all entries open the vote');
  const vv = V(def, state, 'p1');
  must(vv.ballot.length === 3, 'ballot lists three entries');
  must(vv.ballot.every((b) => !('author' in b)), 'ballot hides authorship');
  for (const pid of ['p1', 'p2', 'p3', 'p4']) {
    const mineIdx = V(def, state, pid).myEntry;
    const before = state.votes[pid];
    if (mineIdx >= 0) {
      act(def, state, ctx, pid, { vote: mineIdx });
      must(state.votes[pid] === before, 'self vote rejected');
    }
    const ballot = V(def, state, pid);
    const pick = ballot.ballot.find((b) => b.i !== ballot.myEntry).i;
    act(def, state, ctx, pid, { vote: pick });
  }
  must(state.phase === 'reveal', 'all votes reveal');
  must(state.last, 'sweetest-entry reveal recorded');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done', 'done after 1 round');
  return 'target rotation, anonymous ballot, winner crowned';
});

/* ---------------- roast-toast ---------------- */
driver('roast-toast', () => {
  const def = registry.get('roast-toast');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 1 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'write', 'starts in write');
  const target = state.target;
  const writers = ids(ctx.players()).filter((id) => id !== target);
  for (const w of writers) act(def, state, ctx, w, { entry: `${w} roasts gently: nice haircut, time traveler` });
  must(state.phase === 'vote', 'all entries open the vote');
  const vv = V(def, state, 'p1');
  must(vv.ballot.length === 3, 'ballot lists three roasts');
  for (const pid of writers) {
    const ballot = V(def, state, pid);
    const pick = ballot.ballot.find((b) => b.i !== ballot.myEntry).i;
    act(def, state, ctx, pid, { vote: pick });
  }
  must(state.phase === 'vote', 'votes alone do not reveal without the target pick');
  act(def, state, ctx, target, { pick: 0 });
  must(state.phase === 'reveal', 'target pick + votes reveal');
  must(state.last, 'best-burn reveal recorded');
  act(def, state, ctx, state.hostId, { next: true });
  must(state.phase === 'done', 'done after 1 round');
  return 'target favorite pick gates the reveal';
});

/* ---------------- draw-phone ---------------- */
driver('draw-phone', () => {
  const def = registry.get('draw-phone');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { writeSeconds: 10, drawSeconds: 30, guessSeconds: 10 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'write', 'starts in write');
  must(V(def, state, 'p1').suggestions.length === 3, 'starter suggestions dealt');
  const phrases = { p1: 'A cat wearing a tiny hat', p2: 'A robot eating spaghetti', p3: 'A pirate ship in space', p4: 'A dinosaur disco party' };
  for (const pid of Object.keys(phrases)) act(def, state, ctx, pid, { phrase: phrases[pid] });
  must(state.phase === 'draw', 'all phrases -> draw');
  const inkMeta = (pid, gestureId) => ({ inkNonce: V(def,state,pid).inkNonce, inkRevision: V(def,state,pid).inkRevision, gestureId, chunk: 0, finished: true });
  const stroke = (x) => ({ pts: [[x, 0.1], [x + 0.1, 0.2], [x + 0.2, 0.1]], color: '#c0a', size: 5 });
  for (const pid of Object.keys(phrases)) {
    const vd = V(def, state, pid);
    must(vd.myPrompt && vd.myPrompt.length > 0, `${pid} assigned a prompt to draw`);
    must(vd.myPrompt !== phrases[pid], `${pid} never draws their own phrase`);
    act(def, state, ctx, pid, { stroke: stroke(0.1), ...inkMeta(pid,1) });
    act(def, state, ctx, pid, { stroke: stroke(0.4), ...inkMeta(pid,2) });
  }
  must(V(def, state, 'p1').myStrokes.length === 2, 'strokes echo to the artist');
  act(def, state, ctx, 'p1', { clear: true, ...inkMeta('p1',2) });
  must(V(def, state, 'p1').myStrokes.length === 0, 'clear wipes the canvas');
  act(def, state, ctx, 'p1', { stroke: stroke(0.2), ...inkMeta('p1',3) });
  act(def, state, ctx, 'p1', { stroke: { pts: [[0.5, 0.5]], color: '#111', size: 4 }, ...inkMeta('p1',4) });
  must(V(def, state, 'p1').myStrokes.length === 1, 'single-point stroke rejected');
  ctx.fireUntil(() => state.phase !== 'draw');
  must(state.phase === 'guess', 'draw deadline opens guessing');
  for (const pid of Object.keys(phrases)) {
    const vg = V(def, state, pid);
    must(vg.myDrawing.length > 0, `${pid} assigned a drawing to caption`);
    act(def, state, ctx, pid, { guess: `caption by ${pid}: a masterpiece` });
  }
  must(state.phase === 'reveal', 'all captions -> reveal');
  must(state.chains.length === 4, 'one chain per origin phrase');
  for (const c of state.chains) {
    must(c.phrase && c.drawBy && c.guessBy && c.guess, 'chain links origin->drawing->guess');
    must(c.strokes.length > 0, 'chain carries the drawing');
  }
  must(ctx.totalAwarded() > 0, 'participation awarded');
  for (let i = 0; i < 4; i++) {
    must(state.phase === 'reveal', `chain ${i} on stage`);
    act(def, state, ctx, state.hostId, { next: true });
  }
  must(state.phase === 'done', ' stepping through every chain finishes');
  return 'write->draw->guess->reveal, rotated chains, stroke protocol';
});

/* ---------------- reaction-tap ---------------- */
driver('reaction-tap', () => {
  const def = registry.get('reaction-tap');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 2 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'wait', 'starts in wait');
  must(state.endsAt === 0, 'green moment stays secret: no timer bar');
  // Round 1: p1 jumps the gun and fouls out.
  act(def, state, ctx, 'p1', { tap: true });
  must(state.fouled.includes('p1'), 'early tap fouls');
  ctx.fireUntil(() => state.phase !== 'wait');
  must(state.phase === 'go', 'wait deadline shows green');
  must(state.goAt > 0, 'go timestamp set');
  act(def, state, ctx, 'p1', { tap: true });
  must(state.taps.p1 === undefined, 'fouled player cannot tap in');
  ctx.advance(120); act(def, state, ctx, 'p2', { tap: true });
  ctx.advance(60); act(def, state, ctx, 'p3', { tap: true });
  const before = JSON.stringify(state.taps);
  act(def, state, ctx, 'p2', { tap: true });
  must(JSON.stringify(state.taps) === before, 'second tap ignored');
  ctx.advance(90); act(def, state, ctx, 'p4', { tap: true });
  must(state.phase === 'roundEnd', 'last clean tap ends the round');
  must(state.last.order.map((t) => t.pid).join(',') === 'p2,p3,p4', 'taps ranked by reaction');
  must(state.scores.p2 === 100 && state.scores.p3 === 75 && state.scores.p4 === 50, 'rank points 100/75/50');
  must(state.wins.p2 === 1, 'round win recorded');
  ctx.fireUntil(() => state.phase !== 'roundEnd');
  must(state.phase === 'wait' && state.round === 2, 'gap advances to round 2');
  // Round 2: clean round, everyone taps.
  ctx.fireUntil(() => state.phase !== 'wait');
  must(state.phase === 'go', 'round 2 goes green');
  for (const pid of ['p1', 'p2', 'p3', 'p4']) {
    ctx.advance(40);
    act(def, state, ctx, pid, { tap: true });
  }
  must(state.phase === 'roundEnd', 'round 2 ends on taps');
  ctx.fireUntil(() => state.phase !== 'roundEnd');
  must(state.phase === 'done', 'done after 2 rounds');
  must(ctx.totalAwarded() > 0, 'reaction points awarded');
  return 'foul path + clean round, ranked taps, auto rounds';
});

/* ---------------- typing-race ---------------- */
driver('typing-race', () => {
  const def = registry.get('typing-race');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 1, raceSeconds: 15 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'race', 'starts in race');
  const target = V(def, state, 'p1').target;
  must(target && target.length > 5, 'race sentence dealt');
  act(def, state, ctx, 'p1', { typed: target.slice(0, 5) });
  must(state.progress.p1 === 5, 'live progress counts correct prefix');
  act(def, state, ctx, 'p2', { typed: 'zzz' + target.slice(3) });
  must(state.progress.p2 === 0, 'wrong prefix counts zero');
  ctx.advance(500); act(def, state, ctx, 'p1', { typed: target });
  ctx.advance(500); act(def, state, ctx, 'p3', { typed: target });
  ctx.advance(500); act(def, state, ctx, 'p2', { typed: target });
  must(state.phase === 'race', 'one racer still out keeps the race alive');
  ctx.advance(500); act(def, state, ctx, 'p4', { typed: target });
  must(state.phase === 'roundEnd', 'last finisher ends the round');
  must(state.finished.map((f) => f.pid).join(',') === 'p1,p3,p2,p4', 'finish order recorded');
  must(state.finished.map((f) => f.pts).join(',') === '200,175,150,125', 'finish 100 + place bonus 100..25');
  ctx.fireUntil(() => state.phase !== 'roundEnd');
  must(state.phase === 'done', 'done after 1 race');
  return 'live progress, finish-order points, auto advance';
});

/* ---------------- number-hunt ---------------- */
driver('number-hunt', () => {
  const def = registry.get('number-hunt');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 1 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'hunt', 'starts in hunt');
  must(!('secret' in V(def, state, 'p1')), 'secret never projected');
  act(def, state, ctx, 'p1', { guess: 0 });
  act(def, state, ctx, 'p1', { guess: 101 });
  act(def, state, ctx, 'p1', { guess: 50.5 });
  must(!(state.guesses.p1 || []).length, 'out-of-range guesses rejected');
  // Binary search on the public hotter/colder + higher/lower hints.
  const band = { p1: [1, 100], p2: [1, 100], p3: [1, 100], p4: [1, 100] };
  let solved = 0;
  for (let guard = 0; guard < 60 && solved < 4; guard++) {
    for (const pid of ['p1', 'p2', 'p3', 'p4']) {
      if (state.finished.some((f) => f.pid === pid)) continue;
      const [lo, hi] = band[pid];
      const g = Math.floor((lo + hi) / 2);
      const n = state.history.length;
      act(def, state, ctx, pid, { guess: g });
      const h = state.history[n];
      must(h && h.guess === g, 'every guess earns a public hint');
      if (h.result === 'correct') {
        solved += 1;
        continue;
      }
      must(h.dir === 'higher' || h.dir === 'lower', 'hint nudges higher/lower');
      if (guard > 0) must(['hotter', 'colder', 'same', 'first'].includes(h.result), 'temperature hint present');
      band[pid] = h.dir === 'higher' ? [g + 1, hi] : [lo, g - 1];
    }
  }
  must(solved === 4, 'binary search solves for everyone');
  must(state.phase === 'roundEnd', 'last solver ends the round');
  must(state.last.secret >= 1 && state.last.secret <= 100, 'secret revealed at round end');
  must(state.last.finished[0].tries <= state.last.finished[3].tries, 'fewest tries ranked first');
  must(state.wins[state.last.finished[0].pid] === 1, 'round win recorded');
  ctx.fireUntil(() => state.phase !== 'roundEnd');
  must(state.phase === 'done', 'done after 1 round');
  return 'hint-guided binary search, tries-ranked scoring';
});

/* ---------------- word-chain ---------------- */
driver('word-chain', () => {
  const def = registry.get('word-chain');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { turnSeconds: 5 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'play' && state.turnPid, 'first turn seated');
  const author = state.turnPid, deadline = state.endsAt, turnNo = state.turnNo;
  for (const word of ['zzz', 'zebra1']) {
    act(def, state, ctx, author, { word });
    must(state.turnPid === author && state.turnNo === turnNo && state.endsAt === deadline, 'bad spelling retries on same clock');
    must(V(def, state, author).myFeedback?.ok === false, 'word error surfaced');
  }
  must(!('validator' in V(def, state, author)), 'dictionary/private feedback map not projected');
  act(def, state, ctx, author, { word: 'zebra' });
  must(state.current === 'zebra', 'supported English accepted');
  const current = state.turnPid, currentDeadline = state.endsAt;
  for (const pid of state.alive.filter(id => id !== author)) act(def, state, ctx, pid, { challenge: true });
  must(!state.alive.includes(author) && state.alive.length === 3, 'majority challenge including current player eliminates author');
  must(state.turnPid === current && state.endsAt === currentDeadline, 'challenge cannot reset current clock');
  const repeater = state.turnPid;
  act(def, state, ctx, repeater, { word: state.used[0] });
  must(!state.alive.includes(repeater) && state.lastOut.reason === 'repeat', 'repeat eliminates');
  const staller = state.turnPid;
  ctx.fireUntil(() => !state.alive.includes(staller));
  must(state.phase === 'done' && state.winner && ctx.awards[state.winner] === 300, 'timeout leaves one300-point survivor');
  def.dispose(state);
  return 'real spelling validation/retry, room relationship challenge, repeat/timeout eliminations and unchanged challenge clock';
});

/* ---------------- doodle-guess ---------------- */
driver('doodle-guess', () => {
  const def = registry.get('doodle-guess');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 1, roundSeconds: 30 }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'pick', 'starts in pick');
  const drawer = state.drawer;
  must(drawer, 'a drawer is seated');
  const dv = V(def, state, drawer);
  must(dv.choices.length === 3, 'drawer offered three words');
  const guesser = ids(ctx.players()).find((id) => id !== drawer);
  must(!('word' in V(def, state, guesser)), 'word hidden from guessers');
  act(def, state, ctx, drawer, { choose: 'not-an-offered-word' });
  must(state.phase === 'pick', 'invalid choice ignored');
  act(def, state, ctx, guesser, { choose: dv.choices[0] });
  must(state.phase === 'pick', 'non-drawer choice ignored');
  act(def, state, ctx, drawer, { choose: dv.choices[1] });
  must(state.phase === 'draw', 'choice opens drawing');
  const word = V(def, state, drawer).wordShown;
  must(word === dv.choices[1], 'drawer sees the chosen word');
  must(V(def, state, guesser).masked.replace(/_/g, '').length === 0, 'guessers see a blank mask');
  // Stroke transmission: valid strokes relay, junk is dropped.
  let gesture = 0;
  const drawing = a => ({...a,inkNonce:V(def,state,drawer).inkNonce,inkRevision:state.inkRevision,gestureId:++gesture,chunk:0,finished:true});
  const good = { pts: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.1]], color: '#c0a', size: 5 };
  act(def, state, ctx, drawer, drawing({ stroke: good }));
  must(V(def, state, guesser).strokes.length === 1, 'stroke relays to guessers');
  must(V(def, state, guesser).strokes[0].pts.length === 3, 'stroke points preserved');
  act(def, state, ctx, drawer, drawing({ stroke: { pts: [[0.5, 0.5]], color: '#111', size: 4 } }));
  must(V(def, state, guesser).strokes.length === 1, 'single-point stroke dropped');
  act(def, state, ctx, guesser, drawing({ stroke: good }));
  must(V(def, state, guesser).strokes.length === 1, 'guesser strokes ignored');
  act(def, state, ctx, drawer, drawing({ clear: true }));
  must(V(def, state, guesser).strokes.length === 0, 'clear wipes the canvas');
  act(def, state, ctx, drawer, drawing({ stroke: good }));
  // Mid-draw hint reveals one letter via the tick.
  const masked0 = V(def, state, guesser).masked;
  ctx.setNow(state.hintAt);
  def.onTick(state, ctx);
  const masked1 = V(def, state, guesser).masked;
  must(masked1 !== masked0 && masked1.includes('_'), `hint reveals a letter (${masked0} -> ${masked1})`);
  act(def, state, ctx, guesser, { guess: 'zzz wrong' });
  must(!state.guessed[guesser], 'wrong guess scores nothing');
  for (const pid of ids(ctx.players()).filter((id) => id !== drawer)) {
    act(def, state, ctx, pid, { guess: word }); // drawer view informs the shot
  }
  must(state.phase === 'reveal', 'all correct -> reveal');
  must(Object.keys(state.guessed).length === 3, 'every guesser scored by speed');
  must((state.scores[drawer] || 0) > 0, 'drawer earns a share');
  act(def, state, ctx, drawer, { next: true });
  must(state.phase === 'done', 'done after 1 round');
  // Drawer rotation across turns.
  const ctx2 = new FakeCtx(roster(4), settingsFor(def, { rounds: 2, roundSeconds: 30 }));
  const st2 = def.create(ctx2);
  const d1 = st2.drawer;
  act(def, st2, ctx2, d1, { choose: V(def, st2, d1).choices[0] });
  ctx2.fireUntil(() => st2.phase !== 'draw');
  must(st2.phase === 'reveal', 'round deadline ends the turn');
  ctx2.fireUntil(() => st2.phase !== 'reveal');
  must(st2.phase === 'pick' && st2.round === 2, 'reveal auto-advances to turn 2');
  must(st2.drawer && st2.drawer !== d1, `drawer rotates (${d1} -> ${st2.drawer})`);
  act(def, st2, ctx2, st2.drawer, { choose: V(def, st2, st2.drawer).choices[0] });
  ctx2.fireUntil(() => st2.phase !== 'draw');
  ctx2.fireUntil(() => st2.phase !== 'reveal' && st2.phase !== 'draw');
  must(st2.phase === 'done', 'two turns complete the game');
  // Pick timeout: silence auto-starts the drawing.
  const ctx3 = new FakeCtx(roster(4), settingsFor(def, { rounds: 1 }));
  const st3 = def.create(ctx3);
  ctx3.fireUntil(() => st3.phase !== 'pick');
  must(st3.phase === 'draw', 'pick deadline auto-begins the drawing');
  must(st3.word === st3.choices[0], 'auto-pick takes the first choice');
  return 'stroke relay + clear, masked word, hint tick, rotation, timeouts';
});

/* ---------------- chess ---------------- */
driver('chess', () => {
  const def = registry.get('chess');
  // Scholar's mate: 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6 4.Qxf7#.
  const ctx = new FakeCtx(roster(2), settingsFor(def, {}));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'play', 'starts in play');
  must(state.white === 'p1' && state.black === 'p2', 'first two seats take white/black');
  must(V(def, state, 'p1').youAre === 'w', 'white identified');
  must(V(def, state, 'p2').youAre === 'b', 'black identified');
  must(V(def, state, 'ghost').youAre === null, 'watchers are neither side');
  must(Object.keys(V(def, state, 'p1').legal).length > 0, 'legal-move map served');
  const mv = (pid, from, to, promotion) => act(def, state, ctx, pid, { move: { from, to, promotion } });
  mv('p1', 'e2', 'e5'); // illegal: pawn cannot jump three
  must(!state.lastMove, 'illegal move ignored');
  mv('p2', 'e7', 'e5'); // wrong side to move
  must(!state.lastMove, 'out-of-turn move ignored');
  mv('p1', 'e2', 'e4');
  mv('p2', 'e7', 'e5');
  mv('p1', 'd1', 'h5');
  mv('p2', 'b8', 'c6');
  mv('p1', 'f1', 'c4');
  mv('p2', 'g8', 'f6');
  must(state.phase === 'play', 'no premature finish');
  mv('p1', 'h5', 'f7');
  must(state.phase === 'done', 'checkmate finishes');
  must(state.result && state.result.outcome === 'checkmate', 'checkmate recorded');
  must(state.result.winner === 'w' && state.result.winnerPid === 'p1', 'white wins');
  must(V(def, state, 'p1').check === true, 'mate position shows check');
  must(ctx.awards.p1 === 300, 'winner takes 300 match points');
  mv('p2', 'e8', 'f7'); // moves after mate are dead
  must(state.history === undefined || state.phase === 'done', 'post-game moves ignored');
  // Resignation path.
  const ctx2 = new FakeCtx(roster(2), settingsFor(def, {}));
  const st2 = def.create(ctx2);
  act(def, st2, ctx2, 'ghost', { resign: true });
  must(st2.phase === 'play', 'watcher resignation ignored');
  act(def, st2, ctx2, 'p2', { resign: true });
  must(st2.phase === 'done' && st2.result.outcome === 'resign', 'resignation finishes');
  must(st2.result.winnerPid === 'p1', 'resigned opponent wins');
  // Clock path: a timed game flags the side to move.
  const ctx3 = new FakeCtx(roster(2), settingsFor(def, { timeControl: '3 minutes' }));
  const st3 = def.create(ctx3);
  must(st3.clocks && st3.clocks.w === 180000, '3-minute clocks set');
  ctx3.advance(200000);
  def.onTick(st3, ctx3);
  must(st3.phase === 'done' && st3.result.outcome === 'timeout', 'expired clock flags');
  must(st3.result.winner === 'b', 'flagged white loses');
  return "legal scholar's mate, resign + flag paths, turn ownership";
});

/* ---------------- pocket-karts ---------------- */
function kartWrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function driveKarts(def, state, ctx, control, maxTicks) {
  // control(view, kart) -> {steer, throttle, boost}; ticks at 10 Hz.
  const seen = { fires: 0, impacts: 0, damage: 0 };
  const observedEvents = new Set();
  const sequences = new Map();
  for (let t = 0; t < maxTicks && state.phase !== 'done'; t++) {
    const v = V(def, state, ctx.players()[0].id);
    for (const k of v.karts) {
      const input = control(v, k);
      const ack = V(def, state, k.pid).inputAck;
      const seq = (sequences.get(k.pid) || 0) + 1;
      sequences.set(k.pid, seq);
      act(def, state, ctx, k.pid, v.motionProfile
        ? { seq, life: ack.life, controlEpoch: ack.controlEpoch, input }
        : { input });
    }
    ctx.advance(100);
    def.onTick(state, ctx);
    // Fast physical shots can launch and hit within this 100ms step.
    // Require their authoritative mounted fire, impact and damage evidence
    // rather than depending on a projectile surviving until a snapshot.
    const after = V(def, state, ctx.players()[0].id);
    for (const event of after.events || []) {
      if (observedEvents.has(event.id)) continue;
      observedEvents.add(event.id);
      const physical = event.position && ['x', 'y', 'z'].every(axis => Number.isFinite(event.position[axis]));
      if (!physical) continue;
      if (event.type === 'fire' && ['pulse', 'scatter', 'rail', 'rocket'].includes(event.weapon)) seen.fires += 1;
      if (event.type === 'impact' && ['pulse', 'scatter', 'rail', 'rocket'].includes(event.weapon)) seen.impacts += 1;
      if (event.type === 'hit' && ['pulse', 'scatter', 'rail', 'rocket'].includes(event.weapon) && event.damage > 0) seen.damage += event.damage;
    }
  }
  return seen;
}
driver('pocket-karts', () => {
  const def = registry.get('pocket-karts');
  const starMode = enumOpt(def, 'mode', 'star');
  const battleMode = enumOpt(def, 'mode', 'zap');
  const ring = enumOpt(def, 'map', 'rookie');
  const ownedStates = [];
  try {
  // --- Star Rush: pursuit driving, real pickups, movement asserted.
  const ctx = new FakeCtx(roster(3), settingsFor(def, {
    mode: starMode, map: ring, palette: 'Daybreak', roundSeconds: 30, targetStars: 8,
  }));
  const state = def.create(ctx);
  ownedStates.push(state);
  garbageOk(def, state, ctx, 'p1');
  must(state.phase === 'countdown', 'starts in countdown');
  must(V(def, state, 'p1').youDrive === true, 'drivers flagged');
  must(V(def, state, 'ghost').youDrive === false, 'watchers flagged');
  ctx.setNow(state.endsAt);
  def.onTick(state, ctx);
  must(state.phase === 'drive', 'countdown releases the karts');
  const spawn = {};
  for (const k of V(def, state, 'p1').karts) spawn[k.pid] = { x: k.x, z: k.z };
  driveKarts(def, state, ctx, (v, k) => {
    let best = null;
    let bd = Infinity;
    for (const s of v.stars) {
      const d = (s.x - k.x) ** 2 + (s.z - k.z) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    const want = Math.atan2(best.x - k.x, best.z - k.z);
    const err = kartWrap(want - k.angle);
    return { steer: Math.max(-1, Math.min(1, -err * 2.5)), throttle: Math.abs(err) < 1.0 ? 1 : 0.3, boost: false };
  }, 700);
  must(state.phase === 'done', 'star rush finishes (goal or clock)');
  for (const k of V(def, state, 'p1').karts) {
    const d = Math.hypot(k.x - spawn[k.pid].x, k.z - spawn[k.pid].z);
    must(d > 1, `${k.pid} actually drove (${d.toFixed(1)}u)`);
    must(!('input' in k), 'kart inputs never leak into views');
  }
  const stars = Object.values(state.scores).reduce((a, b) => a + b, 0);
  must(stars > 0, 'pursuit driving collected stars');
  must(state.result && state.result.standings.length === 3, 'full standings recorded');
  // --- Zap Battle: chase, rising-edge fire, hits score.
  const ctx2 = new FakeCtx(roster(2), settingsFor(def, {
    mode: battleMode, map: ring, palette: 'Daybreak', roundSeconds: 30, targetHits: 1,
  }));
  const st2 = def.create(ctx2);
  ownedStates.push(st2);
  ctx2.setNow(st2.endsAt);
  def.onTick(st2, ctx2);
  must(st2.phase === 'drive' && V(def, st2, 'p1').mode === 'battle', 'battle mode drives');
  const lastBoost = {};
  const escape = new Map();
  const seen = driveKarts(def, st2, ctx2, (v, k) => {
    const foe = v.karts.find((o) => o.pid !== k.pid);
    let tgt = { x: foe.x, z: foe.z };
    let seekingFoe = true;
    if (k.ammo <= 0 && v.crates.length) {
      seekingFoe = false;
      tgt = v.crates.reduce((a, b) =>
        ((a.x - k.x) ** 2 + (a.z - k.z) ** 2 < (b.x - k.x) ** 2 + (b.z - k.z) ** 2 ? a : b));
    }
    const want = Math.atan2(tgt.x - k.x, tgt.z - k.z);
    const err = kartWrap(want - k.angle);
    const dist = Math.hypot(tgt.x - k.x, tgt.z - k.z);
    // Recover from an actual boundary approach, retaining reverse until the
    // body clears the wall and its public heading can pursue the target.
    const recovery = escape.get(k.pid) || { reversing: false, previous: null, stalled: 0 };
    const clearance = v.map.bound - Math.max(Math.abs(k.x), Math.abs(k.z));
    const outward = (Math.abs(k.x) >= Math.abs(k.z)
      ? Math.sign(k.x) * Math.sin(k.angle) : Math.sign(k.z) * Math.cos(k.angle)) > .35;
    const progress = recovery.previous ? Math.hypot(k.x-recovery.previous.x,k.z-recovery.previous.z) : 1;
    recovery.stalled = progress < .025 && Math.abs(k.speed) < .4 ? recovery.stalled+1 : 0;
    recovery.previous = {x:k.x,z:k.z};
    if ((clearance < 2 && outward) || recovery.stalled >= 4) recovery.reversing = true;
    // Once the real body faces inward, forward driving can clear this wall.
    // Requiring clearance first leaves reverse pinned against the wall.
    if (recovery.reversing && (clearance >= 3 || !outward) && Math.abs(err) < .8) recovery.reversing = false;
    escape.set(k.pid, recovery);
    if (recovery.reversing) {
      return { steer: Math.max(-1, Math.min(1, err * 2)), throttle: -1, boost: false };
    }
    const aligned = seekingFoe && k.ammo > 0 && (k.weapon === 'shield' || (k.weapon === 'mine' ? dist < 10 : dist < 40 && Math.abs(err) < 0.2));
    const boost = aligned && (k.weapon === 'pulse' || lastBoost[k.pid] !== true);
    lastBoost[k.pid] = boost;
    // Use measured public speed to approach at an aiming pace. Full throttle
    // overshoots the rival and can pitch the real barrel into the sky after
    // a bumper/hill contact; yaw alignment alone cannot make that shot hit.
    return { steer: Math.max(-1, Math.min(1, -err * 2.5)), throttle: Math.abs(err) > 1.0 ? 0.25 : k.speed > 6 ? 0 : 0.5, boost };
  }, 700);
  must(st2.phase === 'done', 'battle finishes');
  must(seen.fires > 0, 'rising-edge input produced accepted physical mounted fire');
  must(seen.impacts > 0, 'real physical projectile produced an authoritative impact');
  must(seen.damage > 0, 'physical weapon impact dealt authoritative damage');
  const hits = Object.values(st2.scores).reduce((a, b) => a + b, 0);
  must(hits > 0, 'at least one item scored a knockout');
  must(st2.result && st2.result.standings.length === 2, 'battle standings recorded');
  return `star rush (${stars} stars) + zap battle (${hits} KOs), movement verified`;
  } finally { for (const state of ownedStates) def.dispose(state); }
});

driver('chain-reaction', () => {
  const def = registry.get('chain-reaction');
  const results = [];
  for (const n of [2, 3]) {
    const ctx = new FakeCtx(roster(n), { boardSize: 'Compact' });
    const state = def.create(ctx);
    garbageOk(def, state, ctx, state.turnPid);
    while (state.phase === 'play') {
      const pid = state.turnPid;
      const v = V(def, state, pid);
      const legal = v.board.flatMap((cell, i) =>
        cell.owner === null || cell.owner === pid ? [i] : []);
      must(legal.length > 0, 'current seat has a legal move');
      const i = legal[Math.floor(Math.random() * legal.length)];
      const before = v.board.reduce((total, cell) => total + cell.orbs, 0);
      act(def, state, ctx, pid, {
        x: i % v.cols, y: Math.floor(i / v.cols), turnNo: v.turnNo,
      });
      const after = V(def, state, pid);
      must(after.board.reduce((total, cell) => total + cell.orbs, 0) === before + 1,
        'legal move conserves previous orbs plus one');
      must(state.moves <= 100, 'compact legal match terminates');
    }
    must(state.result && state.result.winner, 'legal match has a winner');
    must(ctx.awards[state.result.winner] === 300, 'winner awarded');
    results.push(`${n} seats: ${state.moves} legal moves`);
    def.dispose(state);
  }
  return results.join('; ');
});

/* Add before the runner in test/game-playability.js (root owns that file). */
driver('warm-words', () => {
  const def = registry.get('warm-words');
  const ctx = new FakeCtx(roster(4), settingsFor(def, { rounds: 2, roundSeconds: 30, hints: true }));
  const state = def.create(ctx);
  garbageOk(def, state, ctx, 'p1');
  for (let round = 1; round <= 2; round++) {
    must(state.phase === 'guess' && state.round === round, 'every semantic round starts');
    const before = V(def, state, 'p1');
    must(!('target' in before) && !('vectors' in before) && !('deal' in before), 'target and embeddings are private');
    act(def, state, ctx, 'p1', { guess: 'qwertyword' });
    must(!state.history.length, 'unknown vocabulary word does not score');
    ctx.advance(400);
    // This supported word cannot be a default target, so it is a legal miss.
    act(def, state, ctx, 'p1', { guess: 'automobile', similarity: 100, rank: 1 });
    const scored = V(def, state, 'p2').history[0];
    must(scored && scored.rank > 1 && scored.similarity < 100, 'server cosine and vocabulary rank ignore forged score');
    ctx.advance(400);
    act(def, state, ctx, 'p2', { hint: true });
    const hint = V(def, state, 'p1').history.at(-1);
    must(hint.hint && hint.rank > 1 && hint.word !== state.target, 'hint is a real nearest neighbor, never the answer');
    // PEEK: simulate a knowledgeable solver after genuine semantic gameplay.
    act(def, state, ctx, 'p3', { guess: state.target });
    must(state.phase === 'reveal' && state.last.winner === 'p3', 'exact word wins and reveals');
    must(state.last.points > 0 && state.last.points <= 250, '50-point hint cost applied');
    const total = ctx.totalAwarded();
    act(def, state, ctx, 'p4', { guess: state.target });
    must(ctx.totalAwarded() === total, 'concurrent late correct guess cannot award twice');
    act(def, state, ctx, 'p2', { next: true });
    must(state.phase === 'reveal', 'peer next cannot advance');
    act(def, state, ctx, 'p1', { next: true });
  }
  must(state.phase === 'done' && state.results.length === 2, 'complete two-round match');
  must(ctx.totalAwarded() > 0, 'legal match scores');
  const total = ctx.totalAwarded();
  ctx.fireUntil(() => !ctx.pending());
  must(ctx.totalAwarded() === total, 'stale timers cannot re-award or skip');
  def.dispose(state);
  return 'real transformer cosine/ranks, private target, optional nearest-neighbor hint, first-correct score and two rounds';
});


/* Camera games share the framework; legal actions drive a full match. */
for (const id of ['pose-party', 'show-and-go']) driver(id, () => {
  const def = registry.get(id), ctx = new FakeCtx(roster(4), { rounds: 3, performSeconds: 10, voteSeconds: 8 });
  ctx.content = () => ({ prompts: ['Be a robot', 'Show a book', 'Make a silly face'] });
  const state = def.create(ctx);
  for (let r = 1; r <= 3; r++) {
    must(state.phase === 'perform' && state.round === r, 'each round starts performing');
    const view = V(def, state, 'p1');
    must(view.camera.mode === (id === 'pose-party' ? 'spotlight' : 'gallery'), 'camera scene follows mode');
    for (const pid of state.mode === 'spotlight' ? [state.actor] : state.order) act(def, state, ctx, pid, { ready: true });
    must(state.phase === 'perform', 'ready never ends the performance early');
    ctx.fireNext();
    must(state.phase === 'vote', 'fixed deadline opens ballot');
    const candidates = V(def, state, 'p1').candidates;
    for (const pid of state.order) for (const candidate of candidates) if (pid !== candidate) {
      act(def, state, ctx, pid, { vote: candidate, approve: true });
    }
    must(state.phase === 'reveal' && state.last.outcomes.every(o => o.points > 0), 'peers confirm and score each performance');
    act(def, state, ctx, ctx.hostId(), { next: true });
  }
  must(state.phase === 'done' && state.endsAt === 0, 'terminal clock clears');
  must(V(def, state, 'p1').camera === null && ctx.totalAwarded() > 0, 'done returns camera stage and scores');
  def.dispose(state);
  return '3 full rounds, public video scene, private peer ballots, fixed perform deadlines and clean finish';
});

/* Untimed board games complete through published legal moves. No forced
 * deadline, resignation, private-state rewrite or simulated result. */
driver('four-in-a-row', () => {
  const def = registry.get('four-in-a-row'), ctx = new FakeCtx(roster(2), {});
  const state = def.create(ctx);
  for (const drop of [0, 1, 0, 1, 0, 1, 0]) {
    const pid = state.seats[state.turn - 1], v = V(def, state, pid);
    must(v.legal.includes(drop), 'four-in-a-row column must be legal');
    act(def, state, ctx, pid, { drop, rev: v.rev });
  }
  must(state.phase === 'done' && state.result.winnerPid === 'p1' && state.winning.length === 4, 'seven legal drops produce a vertical win');
  must(ctx.totalAwarded() === 300, 'four-in-a-row awards one win');
  return 'seven real drops, gravity, terminal vertical line and one award';
});

driver('reversi', () => {
  const def = registry.get('reversi'), ctx = new FakeCtx(roster(2), {});
  const state = def.create(ctx);
  let moves = 0;
  while (state.phase !== 'done' && moves < 60) {
    const pid = state.seats[state.turn - 1], v = V(def, state, pid);
    must(v.legal.length > 0, 'reversi authority must pass an immobile side');
    const place = v.legal[Math.floor(Math.random() * v.legal.length)];
    act(def, state, ctx, pid, { place, rev: v.rev });
    moves++;
    must(state.rev === moves, 'one accepted reversi move per revision');
  }
  must(state.phase === 'done' && moves > 10, 'reversi completes a full legal match');
  const done = V(def, state, 'p1');
  must(done.counts[0] + done.counts[1] === moves + 4, 'reversi discs conserved');
  must(ctx.totalAwarded() === 300, 'reversi awards the actual result once (300 win, 150 each draw)');
  return `${moves} legal placements, directional flips, automatic passes and terminal result`;
});

for (const id of ['checkers', 'kalah']) driver(id, () => {
  const def = registry.get(id), ctx = new FakeCtx(roster(2), {});
  const state = def.create(ctx);
  let moves = 0;
  while (state.phase !== 'done' && moves < 4000) {
    const pid = state.seats[state.turn], v = V(def, state, pid);
    let action;
    if (id === 'kalah') {
      must(v.legal.length > 0, 'kalah has a nonempty own bowl on every live turn');
      action = { pit: v.legal[Math.floor(Math.random() * v.legal.length)], revision: v.revision };
    } else {
      const sources = Object.keys(v.legal);
      must(sources.length > 0, 'checkers live turn has legal moves');
      const from = Number(sources[Math.floor(Math.random() * sources.length)]);
      const choices = v.legal[from];
      action = { from, to: choices[Math.floor(Math.random() * choices.length)].to, revision: v.revision };
    }
    act(def, state, ctx, pid, action);
    moves++;
    must(state.revision === moves, `${id} accepted moves advance once`);
    if (id === 'kalah') must(state.pits.reduce((a, b) => a + b, 0) === 48, 'kalah conserves all 48 seeds');
  }
  must(state.phase === 'done' && moves > 5, `${id} completes through legal play`);
  must(ctx.totalAwarded() === 300, `${id} awards its result once (300 win, 150 each draw)`);
  const before = JSON.stringify(state), award = ctx.totalAwarded();
  def.onAction(state, ctx, 'p1', { resign: true, revision: state.revision });
  must(JSON.stringify(state) === before && ctx.totalAwarded() === award, `${id} terminal input cannot mutate or re-award`);
  return `${moves} legal moves, complete rule-driven match and immutable terminal result`;
});

driver('ludo', () => {
  const def = registry.get('ludo'), crypto = require('node:crypto');
  const originalDice = crypto.randomInt;
  let totalActions = 0;
  // A repeatable dice-source fixture; every roll still travels through the
  // game's roll action. Native/transport tests use the actual crypto source.
  crypto.randomInt = (min, max) => min + Math.floor(Math.random() * (max - min));
  try {
    for (const count of [2, 3, 4]) {
      const ctx = new FakeCtx(roster(count), {}), state = def.create(ctx);
      let actions = 0;
      while (state.phase !== 'done' && actions < 20000) {
        const pid = state.seats[state.turn], v = V(def, state, pid);
        let action = { roll: true, rev: v.rev };
        if (v.phase === 'move') {
          must(v.legal.length > 0, 'ludo pending move has a legal pawn');
          // Finish advanced pawns first; choose only the published legal list.
          const pawn = v.legal.slice().sort((a, b) => v.pawns[v.youAre][b] - v.pawns[v.youAre][a])[0];
          action = { move: pawn, rev: v.rev };
        }
        act(def, state, ctx, pid, action);
        must(state.rev === v.rev + 1, 'one ludo roll/move advances one revision');
        const after = V(def, state, 'ghost');
        must(after.pawns.length === count && after.pawns.every(row => row.length === 4 && row.every(p => Number.isInteger(p) && p >= -1 && p <= 56)), 'all ludo pawns remain on the published paths');
        actions++;
      }
      must(state.phase === 'done' && state.result.reason === 'home', `${count}-player ludo reaches home through legal rolls and moves`);
      must(state.pawns[state.result.winner].every(p => p === 56), 'winning ludo player brought all four pawns home');
      const places = Object.values(state.scores).sort((a, b) => b - a);
      must(state.scores[state.result.winnerPid] === 300 && places[0] === 300 && places.slice(1).every(n => n < 300), 'ludo winner awarded exactly once');
      must(ctx.totalAwarded() === places.reduce((a, b) => a + b, 0), 'ludo places awarded exactly once');
      const terminal = JSON.stringify(state);
      act(def, state, ctx, state.result.winnerPid, { roll: true, rev: state.rev });
      must(JSON.stringify(state) === terminal && ctx.totalAwarded() === Object.values(state.scores).reduce((a, b) => a + b, 0), 'terminal ludo roll cannot mutate or re-award');
      totalActions += actions;
    }
  } finally { crypto.randomInt = originalDice; }
  return `${totalActions} legal roll/move actions across complete 2-, 3- and 4-player matches`;
});

driver('fleet-duel', () => {
  const def = registry.get('fleet-duel'), ctx = new FakeCtx(roster(2), {}), state = def.create(ctx);
  // Two actual captains place legal fleets using only their own views.
  for (const pid of state.seats) {
    for (const [ship, at] of [0, 20, 40, 60, 80].entries()) {
      const v = V(def, state, pid);
      act(def, state, ctx, pid, { place: { ship, at, vertical: false }, rev: v.actionRev });
    }
    const v = V(def, state, pid);
    must(v.ownFleet.length === 5 && v.enemyFleet.length === 0, 'captain sees own placement and no enemy vessels');
    act(def, state, ctx, pid, { ready: true, rev: v.actionRev });
  }
  must(state.phase === 'play', 'both confirmed fleets enter fleet play');
  let shots = 0;
  while (state.phase !== 'done' && shots < 200) {
    const pid = state.seats[state.turn], v = V(def, state, pid);
    // Scan unexplored bearings without peeking at an opponent's fleet.
    const fire = v.shots[v.youAre].findIndex(value => value === 0);
    must(fire >= 0, 'live fleet match has an unexplored bearing');
    act(def, state, ctx, pid, { fire, rev: v.actionRev });
    must(state.rev === v.rev + 1, 'fleet shot accepted exactly once');
    const peer = V(def, state, state.seats[1 - v.youAre]);
    const watcher = V(def, state, 'ghost');
    must(peer.enemyFleet.every(ship => ship.sunk) && watcher.publicFleets.every(fleet => fleet.every(ship => ship.sunk)), 'unsunk fleets remain private after each shot');
    shots++;
  }
  must(state.phase === 'done' && state.result.reason === 'fleet' && shots > 17, 'fleet finishes by sinking ships through legal shots');
  must(ctx.totalAwarded() === 300, 'fleet winner awarded exactly once');
  const terminal = JSON.stringify(state);
  act(def, state, ctx, state.result.winnerPid, { fire: 99, rev: state.rev });
  must(JSON.stringify(state) === terminal && ctx.totalAwarded() === 300, 'terminal fleet input cannot mutate or re-award');
  return `${shots} alternating legal shots, confirmed placement, masked opponents/watchers and complete sinking win`;
});

/* ---------------- runner ---------------- */
async function main() {
  await registry.get('pocket-karts').initialize();
  const list = registry.list();
  let pass = 0;
  let fail = 0;
  let skip = 0;
  const failed = [];
  for (const g of list) {
    const fn = drivers[g.id];
    if (!fn) {
      console.log(`PLAYABILITY ${g.id}: SKIP (no driver — unverified)`);
      skip += 1;
      continue;
    }
    seedRandom(hashSeed(`play:${g.id}`));
    try {
      const notes = fn(g);
      // Rematch invariant: a fresh instance boots clean for every pid.
      const def = registry.get(g.id);
      const n = g.id === 'chess' ? 2 : 4;
      const rc = new FakeCtx(roster(n), {});
      const rs = def.create(rc);
      for (const p of roster(n)) V(def, rs, p.id);
      V(def, rs, 'ghost');
      if (def.dispose) def.dispose(rs);
      console.log(`PLAYABILITY ${g.id}: PASS (${notes})`);
      pass += 1;
    } catch (e) {
      console.log(`PLAYABILITY ${g.id}: FAIL ${e.message}`);
      failed.push(g.id);
      fail += 1;
    }
  }
  Math.random = REAL_RANDOM;
  console.log(`PLAYABILITY SUMMARY: ${pass} passed, ${fail} failed, ${skip} skipped of ${list.length} (played=${pass} notplayed=${fail + skip})`);
  if (failed.length) console.log(`PLAYABILITY FAILED: ${failed.join(',')}`);
  process.exit(fail || skip ? 1 : 0);
}

if (require.main === module) main();
module.exports = { drivers, FakeCtx, settingsFor };
