'use strict';
/* Camera-party framework tests: deterministic, no sleeps, no network.
 * Covers the shared engine factory + helpers (both modes), secret-ballot
 * projection, stale-timer guards, fixed durations, and scoring.
 * Run: node test/camera-party.js */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createCameraParty,
  normalizeSettings,
  captionFor,
  majorityApproved,
  readyBonus,
  BOUNDS,
  REVEAL_MS,
  BASE_POINTS,
  READY_BONUS_MAX,
} = require('../games/engines/camera-party');

const spotlight = createCameraParty({ id: 'camera-test', mode: 'spotlight' });
const gallery = createCameraParty({ id: 'camera-test', mode: 'gallery' });

const PROMPTS = Array.from({ length: 24 }, (_, i) =>
  `Camera prompt number ${i + 1}: show something round and red on your call`);

class Clock {
  constructor(n = 4, settings = {}, prompts = PROMPTS) {
    this.roster = Array.from({ length: n },
      (_, i) => ({ id: 'p' + i, name: 'Player ' + i, connected: true }));
    this.values = settings;
    this.prompts = prompts;
    this.time = 1700000000000;
    this.timers = [];
    this.awards = {};
    this.broadcasts = 0;
  }
  now() { return this.time; }
  allPlayers() { return this.roster.slice(); }
  players() { return this.roster.filter((p) => p.connected); }
  settings() { return { ...this.values }; }
  content() { return { prompts: this.prompts.slice() }; }
  hostId() { return this.roster.length ? this.roster[0].id : null; }
  award(pid, points) { this.awards[pid] = (this.awards[pid] || 0) + points; }
  broadcast() { this.broadcasts += 1; }
  later(ms, fn) {
    const timer = { at: this.time + ms, fn, canceled: false };
    this.timers.push(timer);
    return () => { timer.canceled = true; };
  }
  live() { return this.timers.filter((t) => !t.canceled); }
  /* Fire the earliest live deadline, exactly like a real event loop. */
  deadline() {
    const live = this.live().sort((a, b) => a.at - b.at);
    assert(live.length, 'a live game must have a deadline');
    const t = live[0];
    this.time = t.at;
    t.canceled = true;
    t.fn();
    return t;
  }
}

function ready(game, s, ctx, pid) {
  game.onAction(s, ctx, pid, { ready: true });
}

function vote(game, s, ctx, voter, candidate, approve) {
  game.onAction(s, ctx, voter, { vote: candidate, approve });
}

function testFactory() {
  assert.throws(() => createCameraParty({}), TypeError);
  assert.throws(() => createCameraParty({ id: 'x' }), TypeError);
  assert.throws(() => createCameraParty({ id: 'x', mode: 'duel' }), TypeError);
  assert.throws(() => createCameraParty({ id: '', mode: 'gallery' }), TypeError);
  for (const game of [spotlight, gallery]) {
    for (const k of ['create', 'onAction', 'view', 'dispose']) {
      assert.equal(typeof game[k], 'function', `factory exports ${k}`);
    }
  }
  assert.deepEqual(BOUNDS.rounds, { min: 1, max: 12, def: 4 });
  assert.deepEqual(BOUNDS.performSeconds, { min: 10, max: 90, def: 30 });
  assert.deepEqual(BOUNDS.voteSeconds, { min: 8, max: 30, def: 15 });
  console.log('CAMERA-PARTY factory: id/mode validation, {create,onAction,view} shape');
}

function testSettings() {
  assert.deepEqual(normalizeSettings({}), { rounds: 4, performSeconds: 30, voteSeconds: 15 });
  assert.deepEqual(normalizeSettings(), { rounds: 4, performSeconds: 30, voteSeconds: 15 });
  assert.deepEqual(normalizeSettings(null), { rounds: 4, performSeconds: 30, voteSeconds: 15 });
  assert.deepEqual(normalizeSettings({ rounds: 2, performSeconds: 45, voteSeconds: 10 }),
    { rounds: 2, performSeconds: 45, voteSeconds: 10 });
  // Integers clamp; anything else falls back to the default.
  assert.deepEqual(normalizeSettings({ rounds: 99, performSeconds: 999, voteSeconds: 1 }),
    { rounds: 12, performSeconds: 90, voteSeconds: 8 });
  assert.deepEqual(normalizeSettings({ rounds: 0, performSeconds: '30', voteSeconds: NaN }),
    { rounds: 1, performSeconds: 30, voteSeconds: 15 });
  assert.deepEqual(normalizeSettings({ rounds: 2.5, performSeconds: null, voteSeconds: [] }),
    { rounds: 4, performSeconds: 30, voteSeconds: 15 });

  const ctx = new Clock(4, { rounds: 2, performSeconds: 45, voteSeconds: 10 });
  const s = spotlight.create(ctx);
  assert.equal(s.rounds, 2);
  assert.equal(s.performMs, 45000);
  assert.equal(s.voteMs, 10000);
  assert.equal(s.endsAt - ctx.now(), 45000, 'perform window is exactly the setting');
  spotlight.dispose(s);
  const clamped = spotlight.create(new Clock(4, { performSeconds: 999, voteSeconds: 1 }));
  assert.equal(clamped.performMs, 90000);
  assert.equal(clamped.voteMs, 8000);
  spotlight.dispose(clamped);
  console.log('CAMERA-PARTY settings: defaults, honored host values, bounds clamping');
}

function testHelpers() {
  assert.equal(captionFor('  hello  '), 'hello');
  assert.equal(captionFor('x'.repeat(200)).length, 120, 'captions cap at 120 chars');
  assert.equal(captionFor({ text: 'pose!' }), 'pose!');
  assert.equal(captionFor({ prompt: 'again' }), 'again');
  assert.equal(captionFor(null), '');
  assert.equal(captionFor(42), '');
  // Strict majority of eligible judges.
  assert.equal(majorityApproved(2, 3), true);
  assert.equal(majorityApproved(1, 3), false);
  assert.equal(majorityApproved(1, 2), false, 'ties are not a majority');
  assert.equal(majorityApproved(0, 0), false);
  // Ready bonus: fastest earns the max, deadline earns 0, bounded always.
  assert.equal(readyBonus(1000, 1000, 30000), READY_BONUS_MAX);
  assert.equal(readyBonus(31000, 1000, 30000), 0);
  assert.equal(readyBonus(6000, 1000, 30000), 42);
  assert.equal(BASE_POINTS, 100, 'an approved performance is a good round: 100');
  assert.equal(READY_BONUS_MAX, 50, 'ready bonus is at most +50');
  assert.equal(readyBonus(undefined, 1000, 30000), 0);
  assert.equal(readyBonus(1000, 1000, 0), 0);
  assert(readyBonus(-999, 1000, 30000) <= READY_BONUS_MAX, 'skewed clocks stay bounded');
  console.log('CAMERA-PARTY helpers: captions, majority math, bounded ready bonus');
}

function testCreate() {
  const ctx = new Clock(4);
  const s = spotlight.create(ctx);
  assert.equal(s.phase, 'perform');
  assert.equal(s.round, 1);
  assert.equal(s.rounds, 4);
  assert.deepEqual(s.order, ['p0', 'p1', 'p2', 'p3'], 'start roster order is stable');
  assert.equal(s.actor, 'p0', 'round 1 spotlights the first seat');
  assert.ok(PROMPTS.includes(s.prompt), 'prompt drawn from the locale deck');
  assert.equal(s.hostId, 'p0');
  assert.deepEqual(s.candidates, ['p0'], 'spotlight candidate is known up front');
  assert.deepEqual(s.scores, { p0: 0, p1: 0, p2: 0, p3: 0 });
  assert.equal(s.endsAt - ctx.now(), 30000, 'fixed 30s perform window');
  assert.equal(ctx.live().length, 1, 'exactly one live deadline');
  spotlight.dispose(s);
  assert.equal(ctx.live().length, 0, 'dispose cancels the deadline');

  const g = gallery.create(new Clock(3));
  assert.deepEqual(g.candidates, [], 'gallery candidates accumulate from ready claims');
  gallery.dispose(g);

  // Empty rooms finish immediately with no deadline and no crash.
  const lonely = new Clock(0);
  const d = spotlight.create(lonely);
  assert.equal(d.phase, 'done');
  assert.equal(d.endsAt, 0);
  assert.equal(lonely.live().length, 0);
  assert.match(d.last.reason, /Nobody is here/);
  console.log('CAMERA-PARTY create: roster, rotation seed, prompts, fixed window, empty room');
}

function testDuplicateReady() {
  const ctx = new Clock(4);
  const s = gallery.create(ctx);
  ctx.time += 1000;
  ready(gallery, s, ctx, 'p1');
  const first = s.readyAt.p1;
  ctx.time += 5000;
  ready(gallery, s, ctx, 'p1');
  ready(gallery, s, ctx, 'p1');
  assert.equal(s.readyAt.p1, first, 'duplicate ready keeps the first timestamp');
  assert.deepEqual(s.candidates, ['p1'], 'duplicate ready claims one candidacy');
  const v = gallery.view(s, 'p1');
  assert.deepEqual(v.ready, { p0: false, p1: true, p2: false, p3: false });
  gallery.dispose(s);
  console.log('CAMERA-PARTY ready: first timestamp stands, duplicates ignored');
}

function testRejectedInputs() {
  const ctx = new Clock(4);
  const s = gallery.create(ctx);
  const before = JSON.stringify({ ...s, _cancel: null });
  for (const a of [null, 42, [], 'ready', { ready: false }, { ready: 1 },
    { vote: 'p1', approve: true }, { next: true }]) {
    gallery.onAction(s, ctx, 'p0', a);
  }
  gallery.onAction(s, ctx, 'watcher', { ready: true });
  gallery.onAction(s, ctx, 'p0', { ready: true, vote: 'p1' });
  ctx.roster[2].connected = false;
  gallery.onAction(s, ctx, 'p2', { ready: true });
  assert.equal(s.ready.p2, undefined, 'disconnected seats cannot claim');
  assert.equal(s.ready.watcher, undefined, 'watchers cannot claim');
  ctx.roster[2].connected = true;
  gallery.onAction(s, ctx, 'p2', { ready: true });
  assert.equal(s.ready.p2, true, 'reconnected seats can claim again');
  assert.deepEqual(Object.keys(s.ready).sort(), ['p0', 'p2']);
  assert.equal(JSON.stringify({ ...s, ready: undefined, readyAt: undefined,
    candidates: undefined, _cancel: null }),
    JSON.stringify({ ...JSON.parse(before), ready: undefined, readyAt: undefined,
      candidates: undefined, _cancel: null }), 'garbage changes nothing else');
  gallery.dispose(s);
  console.log('CAMERA-PARTY guards: garbage, watchers, and disconnected seats ignored');
}

function drivePerformTimer(game, ctx, s) {
  assert.equal(s.phase, 'perform');
  const at = s.endsAt;
  ctx.time = at;
  ctx.deadline();
  return at;
}

function testSpotlightScoring() {
  const ctx = new Clock(4, { rounds: 1 });
  const s = spotlight.create(ctx);
  ctx.time += 5000; // actor performs, then taps ready 5s in
  ready(spotlight, s, ctx, 'p0');
  ready(spotlight, s, ctx, 'p2');
  assert.equal(s.ready.p2, undefined, 'audience cannot claim a performance');
  ready(spotlight, s, ctx, s.actor);
  drivePerformTimer(spotlight, ctx, s);
  assert.equal(s.phase, 'vote');
  assert.deepEqual(s.candidates, ['p0']);
  assert.equal(s.endsAt - ctx.now(), 15000, 'fixed 15s vote window');

  // Secret ballot: nothing visible mid-vote except your own.
  vote(spotlight, s, ctx, 'p1', 'p0', true);
  let v1 = spotlight.view(s, 'p1');
  let v2 = spotlight.view(s, 'p2');
  assert.deepEqual(v1.votes, {}, 'ballots hidden during the vote');
  assert.deepEqual(v2.votes, {}, 'ballots hidden from non-voters too');
  assert.deepEqual(v1.myVotes, { p0: true }, 'voters see their own ballot');
  assert.deepEqual(v2.myVotes, {}, 'non-voters see no ballots');
  assert.deepEqual(v1.ballots, { p0: 1 }, 'counts (not choices) stay public');

  // Self voting is unauthorized and earns nothing.
  vote(spotlight, s, ctx, 'p0', 'p0', true);
  assert.equal(s.votes.p0, undefined, 'self ballots are dropped');
  vote(spotlight, s, ctx, 'p1', 'p0', false);
  assert.equal(s.votes.p1.p0, true, 'duplicate votes keep the first ballot');

  vote(spotlight, s, ctx, 'p2', 'p0', true);
  assert.equal(s.phase, 'vote', 'two of three judges is not all-in yet');
  vote(spotlight, s, ctx, 'p3', 'p0', false);
  assert.equal(s.phase, 'reveal', 'all-in reveals without waiting for the deadline');
  assert.equal(s.last.round, 1);
  assert.equal(s.last.outcomes.length, 1);
  const o = s.last.outcomes[0];
  assert.deepEqual({ approvals: o.approvals, rejects: o.rejects, eligible: o.eligible },
    { approvals: 2, rejects: 1, eligible: 3 });
  assert.equal(o.approved, true, '2 of 3 is a majority');
  const wantBonus = readyBonus(s.readyAt.p0, s.performStart, s.performMs);
  assert.equal(o.bonus, wantBonus);
  assert.equal(o.points, BASE_POINTS + wantBonus);
  assert.equal(s.scores.p0, o.points);
  assert.equal(ctx.awards.p0, o.points, 'room totals mirror game scores');
  assert.equal(ctx.awards.p1, 25, 'judges who agree with the room get 25');
  assert.equal(ctx.awards.p2, 25);
  assert.equal(ctx.awards.p3, undefined, 'a judge who disagreed gets nothing');
  assert.deepEqual(s.last.judges, { p1: 25, p2: 25 });
  assert.deepEqual(s.last.points, { p0: o.points, p1: 25, p2: 25 }, 'round points are public at the reveal');
  assert.match(s.last.reason, /Approved by 2 of 3/, 'explicit reason names the outcome');
  assert.equal(s.endsAt - ctx.now(), REVEAL_MS, 'short fixed reveal window');

  // Reveal opens the ballots to everyone, including watchers.
  v1 = spotlight.view(s, 'p1');
  const vw = spotlight.view(s, 'watcher');
  assert.deepEqual(v1.votes, { p1: { p0: true }, p2: { p0: true }, p3: { p0: false } });
  assert.deepEqual(vw.votes, v1.votes, 'reveal is public');
  assert.deepEqual(vw.myVotes, {}, 'watchers have no ballots');
  spotlight.dispose(s);
  console.log(`SPOTLIGHT scoring: 2/3 approves -> +${o.points} (base ${BASE_POINTS} + bonus ${o.bonus})`);
}

function testSpotlightReject() {
  const ctx = new Clock(4, { rounds: 1 });
  const s = spotlight.create(ctx);
  ready(spotlight, s, ctx, s.actor);
  drivePerformTimer(spotlight, ctx, s);
  vote(spotlight, s, ctx, 'p1', 'p0', true);
  vote(spotlight, s, ctx, 'p2', 'p0', false);
  vote(spotlight, s, ctx, 'p3', 'p0', false);
  assert.equal(s.phase, 'reveal');
  const o = s.last.outcomes[0];
  assert.equal(o.approved, false, '1 of 3 is not a majority');
  assert.equal(o.points, 0);
  assert.equal(o.bonus, 0, 'rejected acts earn no ready bonus');
  assert.deepEqual(s.scores.p0, 0);
  assert.deepEqual(ctx.awards, { p2: 25, p3: 25 }, 'only judges who agreed with the room score');
  assert.match(s.last.reason, /No majority/);
  spotlight.dispose(s);
  console.log('SPOTLIGHT reject: minority approval scores nothing with an explicit reason');
}

function testGalleryScoring() {
  const ctx = new Clock(4, { rounds: 1 });
  const s = gallery.create(ctx);
  ctx.time += 1000;
  ready(gallery, s, ctx, 'p0');
  ctx.time += 1000;
  ready(gallery, s, ctx, 'p1');
  drivePerformTimer(gallery, ctx, s);
  assert.equal(s.phase, 'vote');
  assert.deepEqual(s.candidates, ['p0', 'p1'], 'candidates freeze at the vote');

  // Late claims during the vote change nothing.
  ready(gallery, s, ctx, 'p2');
  assert.deepEqual(s.candidates, ['p0', 'p1']);

  // Peers judge both; self ballots are dropped.
  vote(gallery, s, ctx, 'p0', 'p0', true);
  vote(gallery, s, ctx, 'p1', 'p1', true);
  vote(gallery, s, ctx, 'p0', 'p1', true);
  vote(gallery, s, ctx, 'p1', 'p0', true);
  vote(gallery, s, ctx, 'p2', 'p0', true);
  vote(gallery, s, ctx, 'p2', 'p1', false);
  vote(gallery, s, ctx, 'p3', 'p0', false);
  assert.equal(s.phase, 'vote', 'p3 still owes a ballot on p1');
  assert.equal(s.votes.p0.p0, undefined);
  assert.equal(s.votes.p1.p1, undefined);
  vote(gallery, s, ctx, 'p3', 'p1', false);
  assert.equal(s.phase, 'reveal');

  const by = Object.fromEntries(s.last.outcomes.map((o) => [o.candidate, o]));
  assert.equal(by.p0.approved, true, 'p0 takes 2 of 3');
  assert.equal(by.p1.approved, false, 'p1 takes 1 of 3');
  assert.equal(by.p0.points, BASE_POINTS + by.p0.bonus);
  assert(by.p0.bonus >= 0 && by.p0.bonus <= READY_BONUS_MAX, 'bonus stays bounded');
  assert.equal(by.p1.points, 0);
  assert.equal(s.scores.p0, by.p0.points);
  assert.equal(s.scores.p1, 25, 'p1 agreed with the room on p0');
  assert.equal(ctx.awards.p0, by.p0.points, 'p0 disagreed on p1, so only the performance counts');
  assert.equal(ctx.awards.p1, 25);
  assert.equal(ctx.awards.p2, 50, 'judge points are capped at 50 a round');
  assert.equal(ctx.awards.p3, 25);
  assert.match(s.last.reason, /1 of 2 performances earned a majority/);
  gallery.dispose(s);
  console.log(`GALLERY scoring: p0 +${by.p0.points}, p1 +0, self-votes dropped`);
}

function testUnclaimedAndDisposed() {
  const ctx = new Clock(3, { rounds: 1 });
  const s = spotlight.create(ctx);
  ctx.deadline();
  assert.equal(s.phase, 'reveal');
  assert.deepEqual(s.last.outcomes, []);
  assert.deepEqual(ctx.awards, {});
  const pending = ctx.live()[0];
  spotlight.dispose(s);
  pending.fn();
  assert.equal(s.phase, 'reveal', 'disposed queued timer is inert');
  console.log('CAMERA-PARTY no claim: no phantom score; dispose invalidates queued callbacks');
}

function testGalleryEmpty() {
  const ctx = new Clock(4, { rounds: 1 });
  const s = gallery.create(ctx);
  drivePerformTimer(gallery, ctx, s);
  assert.equal(s.phase, 'reveal', 'nothing to judge skips the vote window');
  assert.deepEqual(s.last.outcomes, []);
  assert.match(s.last.reason, /Nobody was ready/);
  assert.deepEqual(ctx.awards, {});
  gallery.dispose(s);
  console.log('GALLERY empty: no claims skip the vote with an explicit reason');
}

function testStaleTimers() {
  // A stale vote deadline cannot touch an early reveal.
  let ctx = new Clock(4, { rounds: 2 });
  let s = spotlight.create(ctx);
  ready(spotlight, s, ctx, s.actor);
  drivePerformTimer(spotlight, ctx, s);
  const staleVote = ctx.live()[0];
  vote(spotlight, s, ctx, 'p1', 'p0', true);
  vote(spotlight, s, ctx, 'p2', 'p0', true);
  vote(spotlight, s, ctx, 'p3', 'p0', true);
  assert.equal(s.phase, 'reveal');
  const snap = JSON.stringify(spotlight.view(s, 'p0'));
  staleVote.fn();
  assert.equal(JSON.stringify(spotlight.view(s, 'p0')), snap, 'stale vote timer is inert');
  assert.equal(s.phase, 'reveal');

  // A stale reveal deadline cannot skip the round a host Next started.
  const staleReveal = ctx.live()[0];
  spotlight.onAction(s, ctx, 'p0', { next: true });
  assert.equal(s.phase, 'perform');
  assert.equal(s.round, 2);
  assert.equal(s.actor, 'p1', 'rounds rotate through the start roster');
  assert.notEqual(s.prompt, JSON.parse(snap).prompt, 'prompts advance without repeats');
  staleReveal.fn();
  assert.equal(s.round, 2, 'stale reveal timer skips nothing');
  assert.equal(s.phase, 'perform');
  spotlight.dispose(s);

  // Only the host advances early; anyone else is ignored silently.
  ctx = new Clock(4, { rounds: 1 });
  s = spotlight.create(ctx);
  ready(spotlight, s, ctx, s.actor);
  drivePerformTimer(spotlight, ctx, s);
  vote(spotlight, s, ctx, 'p1', 'p0', true);
  vote(spotlight, s, ctx, 'p2', 'p0', true);
  vote(spotlight, s, ctx, 'p3', 'p0', true);
  spotlight.onAction(s, ctx, 'p2', { next: true });
  assert.equal(s.phase, 'reveal', 'non-host Next is ignored');
  spotlight.dispose(s);

  // Full-run determinism: every round reveals, the clock clears at done,
  // and leftover timers are fully inert.
  ctx = new Clock(4, { rounds: 4 });
  s = gallery.create(ctx);
  const seen = [];
  for (let i = 0; i < 40 && s.phase !== 'done'; i++) {
    if (s.phase === 'perform') {
      ready(gallery, s, ctx, 'p0');
      ready(gallery, s, ctx, 'p1');
      ctx.deadline();
    } else if (s.phase === 'vote') {
      for (const voter of ['p0', 'p1', 'p2', 'p3']) {
        for (const cand of s.candidates) {
          if (voter !== cand) vote(gallery, s, ctx, voter, cand, true);
        }
      }
    } else if (s.phase === 'reveal') {
      seen.push(s.round);
      ctx.deadline();
    }
  }
  assert.deepEqual(seen, [1, 2, 3, 4], 'every round reveals exactly once');
  assert.equal(s.phase, 'done');
  assert.equal(s.endsAt, 0, 'done carries no deadline');
  assert.equal(ctx.live().length, 0, 'no live timers survive done');
  const totals = JSON.stringify({ awards: ctx.awards, scores: s.scores, round: s.round });
  for (const t of ctx.timers) t.fn();
  assert.equal(JSON.stringify({ awards: ctx.awards, scores: s.scores, round: s.round }),
    totals, 'leftover timers after done are inert');
  const doneView = JSON.stringify(gallery.view(s, 'p0'));
  gallery.onAction(s, ctx, 'p0', { ready: true });
  gallery.onAction(s, ctx, 'p0', { vote: 'p1', approve: true });
  gallery.onAction(s, ctx, 'p0', { next: true });
  assert.equal(JSON.stringify(gallery.view(s, 'p0')), doneView, 'done ignores actions');
  gallery.dispose(s);
  console.log('CAMERA-PARTY timers: stale deadlines inert, rotation p0..p3, done clears the clock');
}

function testLateActionExpiry() {
  const ctx = new Clock(4, { rounds: 1 });
  const s = gallery.create(ctx);
  // The deadline passes but the timer callback has not run yet: a late
  // ready advances the phase first, then is dropped.
  ctx.time = s.endsAt + 1;
  gallery.onAction(s, ctx, 'p0', { ready: true });
  assert.equal(s.phase, 'reveal', 'expired perform skips the empty vote');
  assert.equal(s.ready.p0, undefined, 'the late claim is dropped');
  gallery.dispose(s);

  const ctx2 = new Clock(4, { rounds: 1 });
  const s2 = spotlight.create(ctx2);
  ready(spotlight, s2, ctx2, s2.actor);
  drivePerformTimer(spotlight, ctx2, s2);
  ctx2.time = s2.endsAt + 1;
  spotlight.onAction(s2, ctx2, 'p1', { vote: 'p0', approve: true });
  assert.equal(s2.phase, 'reveal', 'expired vote reveals');
  assert.deepEqual(s2.votes, {}, 'the late ballot is dropped');
  assert.equal(s2.last.outcomes[0].approved, false);
  spotlight.dispose(s2);
  console.log('CAMERA-PARTY expiry: late actions advance then drop, never sneak in');
}

function testCameraView() {
  const ctx = new Clock(4);
  const s = spotlight.create(ctx);
  let v = spotlight.view(s, 'p2');
  assert.deepEqual(Object.keys(v).sort(), ['actor', 'ballots', 'camera', 'candidates',
    'endsAt', 'hostId', 'last', 'mode', 'myVotes', 'performSeconds', 'phase',
    'prompt', 'ready', 'round', 'rounds', 'scores', 'voteSeconds', 'votes', 'revealSeconds', 'gone'].sort());
  assert.equal(v.mode, 'spotlight');
  assert.deepEqual(v.camera, { mode: 'spotlight', featured: 'p0', caption: s.prompt });
  assert(v.camera.caption.length <= 120, 'captions fit the camera frame');
  spotlight.dispose(s);

  const long = 'L'.repeat(500);
  const ctx2 = new Clock(3, {}, [long]);
  const g = gallery.create(ctx2);
  const gv = gallery.view(g, 'p0');
  assert.equal(gv.camera.mode, 'gallery');
  assert.equal(gv.camera.featured, null, 'gallery features nobody');
  assert.equal(gv.camera.caption.length, 120);
  assert.equal(gv.prompt.length, 500, 'the full prompt still shows in controls');

  // Projections are copies: mutating them cannot touch server state.
  gv.candidates.push('evil');
  gv.scores.p0 = 99999;
  gv.ready.p0 = true;
  gv.myVotes.p1 = true;
  gv.ballots.p0 = 99;
  assert.deepEqual(g.candidates, []);
  assert.equal(g.scores.p0, 0);
  assert.equal(g.ready.p0, undefined);
  gallery.dispose(g);

  // Done may omit the camera; seat ids only, no helpers leak.
  const ctx3 = new Clock(4, { rounds: 1 });
  const d = spotlight.create(ctx3);
  drivePerformTimer(spotlight, ctx3, d);
  for (const voter of ['p1', 'p2', 'p3']) vote(spotlight, d, ctx3, voter, 'p0', true);
  ctx3.deadline(); // reveal -> done
  assert.equal(d.phase, 'done');
  const dv = spotlight.view(d, 'p0');
  assert.equal(dv.camera, null);
  assert.equal(dv.endsAt, 0);
  assert(!('_cancel' in dv) && !('_token' in dv) && !('readyAt' in dv) &&
    !('prompts' in dv) && !('performStart' in dv), 'no server helpers leak');
  spotlight.dispose(d);
  console.log('CAMERA-PARTY view: camera frame, 120-char captions, copies, done clears');
}

function testClientContract() {
  const root = path.join(__dirname, '..');
  const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
  const client = fs.readFileSync(
    path.join(root, 'public/js/toolkit/camera-party.js'), 'utf8');
  const code = strip(client);
  assert.match(client, /export function renderCameraParty\(el, S, api\)/,
    'toolkit exports renderCameraParty(el, S, api)');
  assert.match(client, /export function disposeCameraParty\(el\)/,
    'toolkit exports disposeCameraParty(el)');
  assert.match(client, /from '\.\.\/util\.js'/, 'toolkit reuses esc/nameOf/countdown');
  assert.ok(client.includes('Show it on your call. Giggle Meet puts your friends on the game stage.'),
    'standalone hint is exact');
  assert.ok(!/getUserMedia|RTCPeerConnection|MediaStream|getDisplayMedia|AudioContext/i.test(code),
    'renderer never captures media');
  assert.ok(!/innerHTML\s*=.*querySelector|querySelectorAll\('\[data-v\]'/.test(code),
    'no legacy whole-root rerender of action targets');
  assert.ok(/WeakMap/.test(code), 'skeleton instances persist across snapshots');
  assert.ok(/api\.now\(\)/.test(code), 'countdown uses the calibrated server clock');

  const css = fs.readFileSync(path.join(root, 'public/css/camera-party.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = css.split('}').map((r) => r.split('{')[0] || '');
  const selectors = rules.flatMap((r) => r.split(',')).map((s) => s.trim())
    .filter((s) => s && !s.startsWith('@') && s !== 'to' && s !== 'from');
  for (const sel of selectors) {
    assert.ok(sel.startsWith('.camera-party'),
      `CSS scoped to .camera-party root (saw "${sel}")`);
  }
  assert.ok(/prefers-reduced-motion/.test(css), 'CSS honors reduced motion');
  assert.ok(/max-width:\s*420px/.test(css), 'CSS adapts at phone widths');
  assert.ok(/--accent|--sun|--teal/.test(css), 'CSS uses the party theme vars');
  console.log('CAMERA-PARTY client: renderer contract, no media capture, scoped CSS');
}

/* Rules standard: Rounds/Pace settings, paced reveal, Auto turns,
 * host or performer Next, End game and players who leave. */
function testRulesStandard() {
  const { cameraSettings, REVEAL_SECONDS } = require('../games/engines/camera-party');
  const { validateManifest } = require('../games/_validate');
  for (const id of ['pose-party', 'show-and-go']) {
    const def = require(`../games/${id}/server`);
    assert.deepEqual(def.manifest.settings.slice(0, 2).map((x) => x.key), ['rounds', 'pace'], `${id}: Rounds and Pace first`);
    assert.equal(def.manifest.settings.find((x) => x.key === 'voteSeconds').label, 'Seconds to vote');
    assert(validateManifest(def).ok, `${id} manifest validates`);
  }
  assert.equal(cameraSettings('spotlight')[0].def, null, 'spotlight Rounds default to Auto');
  assert.equal(cameraSettings('gallery')[0].def, 4);
  // Auto: one spotlight turn per player.
  const auto = spotlight.create(new Clock(5));
  assert.equal(auto.rounds, 5, 'Auto gives every player one turn');
  spotlight.dispose(auto);
  // Pace scales the reveal (Relaxed 9s, Quick 4s).
  for (const [pace, secs] of [['Relaxed', 9], ['Normal', REVEAL_SECONDS], ['Quick', 4]]) {
    const ctx = new Clock(3, { rounds: 1, pace });
    const s = spotlight.create(ctx);
    ready(spotlight, s, ctx, s.actor);
    ctx.deadline();
    for (const p of ['p1', 'p2']) vote(spotlight, s, ctx, p, 'p0', true);
    assert.equal(s.phase, 'reveal');
    assert.equal(s.endsAt - ctx.now(), secs * 1000, `${pace} reveal is paced`);
    spotlight.dispose(s);
  }
  // The performer (not only the host) can press Next at the reveal.
  {
    const ctx = new Clock(3, { rounds: 3 });
    const s = spotlight.create(ctx);
    ctx.deadline(); // nobody ready -> reveal
    assert.equal(s.phase, 'reveal');
    spotlight.onAction(s, ctx, 'p2', { next: true });
    assert.equal(s.phase, 'reveal', 'a watcher cannot skip');
    spotlight.onAction(s, ctx, 'p0', { next: true });
    assert.equal(s.round, 2, 'host moves on');
    ctx.deadline();
    spotlight.onAction(s, ctx, s.actor, { next: true });
    assert.equal(s.round, 3, 'the round performer moves on too');
    spotlight.dispose(s);
  }
  // A performer who leaves: the turn is skipped, and later turns skip them.
  {
    const ctx = new Clock(4, { rounds: 4 });
    const s = spotlight.create(ctx);
    assert.equal(s.actor, 'p0');
    spotlight.onPlayerGone(s, ctx, 'p0', 'left');
    assert.equal(s.phase, 'reveal');
    assert.match(s.last.reason, /left/);
    assert.deepEqual(ctx.awards, {});
    ctx.deadline();
    assert.equal(s.actor, 'p1');
    ready(spotlight, s, ctx, 'p1');
    ctx.deadline();
    // Judges p2, p3 only: p0 left and is not waited for or counted.
    vote(spotlight, s, ctx, 'p2', 'p1', true);
    assert.equal(s.phase, 'vote');
    vote(spotlight, s, ctx, 'p3', 'p1', true);
    assert.equal(s.phase, 'reveal', 'gone judge is not waited for');
    assert.equal(s.last.outcomes[0].eligible, 2);
    spotlight.dispose(s);
  }
  // A judge who goes away mid-vote unblocks the reveal.
  {
    const ctx = new Clock(4, { rounds: 1 });
    const s = gallery.create(ctx);
    ready(gallery, s, ctx, 'p0');
    ctx.deadline();
    for (const p of ['p1', 'p2']) vote(gallery, s, ctx, p, 'p0', true);
    assert.equal(s.phase, 'vote');
    gallery.onPlayerGone(s, ctx, 'p3', 'away');
    assert.equal(s.phase, 'reveal');
    assert.equal(s.last.outcomes[0].approved, true);
    gallery.dispose(s);
  }
  // End game keeps the awarded points and shows the final scores.
  {
    const ctx = new Clock(3, { rounds: 3 });
    const s = spotlight.create(ctx);
    ready(spotlight, s, ctx, 'p0');
    ctx.deadline();
    for (const p of ['p1', 'p2']) vote(spotlight, s, ctx, p, 'p0', true);
    const awarded = { ...ctx.awards };
    spotlight.onEnd(s, ctx, { reason: 'host' });
    assert.equal(s.phase, 'done');
    assert.equal(s.endsAt, 0);
    assert.deepEqual(ctx.awards, awarded, 'End game keeps points, adds none');
    assert.equal(ctx.live().length, 0, 'no live timers after End game');
    assert.deepEqual(spotlight.view(s, 'p1').scores, { p0: awarded.p0, p1: 25, p2: 25 });
    assert(awarded.p0 >= 100 && awarded.p0 <= 150, 'performance is on the standard scale');
  }
  console.log('CAMERA-PARTY rules: Rounds/Pace, paced reveal, Auto turns, performer Next, gone players, End game');
}

function suite() {
  testFactory();
  testSettings();
  testHelpers();
  testCreate();
  testDuplicateReady();
  testRejectedInputs();
  testSpotlightScoring();
  testSpotlightReject();
  testGalleryScoring();
  testGalleryEmpty();
  testUnclaimedAndDisposed();
  testStaleTimers();
  testLateActionExpiry();
  testCameraView();
  testClientContract();
  testRulesStandard();
  console.log('CAMERA-PARTY ok: all camera-party framework tests passed');
}

if (require.main === module) suite();

module.exports = { suite };
