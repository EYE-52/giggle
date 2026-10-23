'use strict';
/* Rules standard (specs/GAME_RULES_STANDARD.md) for Would You Rather, Never
 * Ever, Most Likely, Hot Takes, Rank It, Pick One, Rapid Polls, Truth or
 * Dare, Dare Roulette and Twenty Questions: Rounds/Pace settings, paced
 * timers, points on the standard scale, ties, End game and leaving. */
const assert = require('node:assert/strict');
const { validateManifest } = require('../games/_validate');

const IDS = ['would-you-rather', 'never-ever', 'most-likely', 'hot-takes', 'rank-it', 'pick-one',
  'rapid-polls', 'truth-dare', 'dare-roulette', 'twenty-questions'];
const load = (id) => require('../games/' + id + '/server');

function makeCtx(n = 4, settings = {}, content = {}) {
  const roster = Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), name: 'P' + (i + 1) }));
  const ctx = {
    time: 1000, timers: [], awards: {}, gone: new Set(), host: 'p1',
    now: () => ctx.time,
    hostId: () => ctx.host,
    allPlayers: () => roster,
    players: () => roster.filter((p) => !ctx.gone.has(p.id)),
    settings: () => settings,
    content: () => content,
    later(ms, fn) { const t = { ms, at: ctx.time + ms, fn }; ctx.timers.push(t); return () => { t.dead = true; }; },
    broadcast() {},
    award(pid, pts) { ctx.awards[pid] = (ctx.awards[pid] || 0) + pts; },
    lastMs: () => ctx.timers.at(-1).ms,
    fireLast() { const t = ctx.timers.at(-1); ctx.time = t.at; t.fn(); },
    leave(def, state, pid, why = 'left') { ctx.gone.add(pid); def.onPlayerGone(state, ctx, pid, why); },
  };
  return ctx;
}
const ids = (ctx) => ctx.players().map((p) => p.id);

// 1. Settings: Rounds and Pace first, valid manifests, every game ends and
//    reacts to players leaving.
for (const id of IDS) {
  const def = load(id);
  const keys = def.manifest.settings.map((s) => s.key);
  assert.deepEqual(keys.slice(0, 2), ['rounds', 'pace'], id + ' offers Rounds and Pace first');
  const rounds = def.manifest.settings[0];
  assert.equal(rounds.min, 1, id + ' rounds from 1');
  assert.equal(rounds.max, 12, id + ' rounds up to 12');
  assert(validateManifest(def).ok, id + ' manifest is valid');
  for (const s of def.manifest.settings.filter((x) => /Seconds/.test(x.key))) {
    assert.match(s.label, /^Seconds (to|per) /, id + ' timer label reads "Seconds to …"');
  }
  assert.equal(typeof def.onEnd, 'function', id + ' implements onEnd');
  assert.equal(typeof def.onPlayerGone, 'function', id + ' implements onPlayerGone');
  // End game shows the game's own final screen with points kept.
  const ctx = makeCtx(4);
  const state = def.create(ctx);
  state.scores.p2 = 140;
  def.onEnd(state, ctx, { reason: 'host' });
  assert.equal(state.phase, 'done', id + ' End game moves to its final screen');
  assert.equal(state.endsAt, 0, id + ' final screen has no deadline');
  assert.equal(state.scores.p2, 140, id + ' keeps match points on End game');
}
assert.equal(load('truth-dare').manifest.settings[0].def, null, 'Truth or Dare rounds default to Auto');
assert.equal(load('twenty-questions').manifest.settings[0].def, null, 'Twenty Questions rounds default to Auto');
assert.equal(load('hot-takes').manifest.settings[0].def, 1, 'Hot Takes: one round by default');

// 2. Pace scales fixed timers (Relaxed x1.5, Quick x0.67).
{
  const firstTimer = (id, pace) => { const ctx = makeCtx(4, { pace }); load(id).create(ctx); return ctx.lastMs(); };
  for (const [id, normal] of [['pick-one', 5000], ['rapid-polls', 45000], ['truth-dare', 4000], ['dare-roulette', 45000]]) {
    assert.equal(firstTimer(id, 'Normal'), normal, id + ' Normal timer');
    assert.equal(firstTimer(id, 'Relaxed'), Math.round(normal / 1000 * 1.5) * 1000, id + ' Relaxed timer');
    assert.equal(firstTimer(id, 'Quick'), Math.max(3, Math.round(normal / 1000 * 0.67)) * 1000, id + ' Quick timer');
  }
  // Reveal timers are paced too.
  for (const id of ['would-you-rather', 'never-ever', 'most-likely', 'pick-one']) {
    const def = load(id);
    const ctx = makeCtx(3, { pace: 'Quick' });
    const state = def.create(ctx);
    const vote = id === 'never-ever' ? 'not' : id === 'most-likely' ? null : 'a';
    for (const pid of ids(ctx)) def.onAction(state, ctx, pid, { vote: vote || (pid === 'p1' ? 'p2' : 'p1') });
    assert.equal(state.phase, 'reveal', id + ' reveals');
    const base = { 'would-you-rather': 6, 'never-ever': 7, 'most-likely': 7, 'pick-one': 3 }[id];
    assert.equal(ctx.lastMs(), Math.max(3, Math.round(base * 0.67)) * 1000, id + ' reveal follows Pace');
  }
  // Rank It: own "Seconds to rank" setting, unscaled; reveal scaled.
  const ctx = makeCtx(3, { rankSeconds: 30, pace: 'Relaxed' });
  const rank = load('rank-it');
  const st = rank.create(ctx);
  assert.equal(st.endsAt - ctx.now(), 30000, 'Rank It uses Seconds to rank');
  for (const pid of ids(ctx)) rank.onAction(st, ctx, pid, { order: [0, 1, 2, 3, 4] });
  assert.equal(ctx.lastMs(), 15000, 'Rank It reveal follows Pace');
}

// 3. Streak extras stop at +100 per round.
for (const [id, vote] of [['would-you-rather', 'a'], ['pick-one', 'a'], ['never-ever', 'not']]) {
  const def = load(id);
  const ctx = makeCtx(3, { rounds: 10 });
  const state = def.create(ctx);
  let last = 0;
  for (let r = 0; r < 10; r++) {
    const before = state.scores.p1 || 0;
    for (const pid of ids(ctx)) def.onAction(state, ctx, pid, { vote });
    last = state.scores.p1 - before;
    assert(last <= 200, id + ' round points stay at most 200');
    def.onAction(state, ctx, 'p1', { next: true });
  }
  assert.equal(last, 200, id + ' long streak caps at 100 + 100');
  assert.equal(state.phase, 'done');
}
{
  // Most Likely: voter streak plus single-pick crown never passes 200.
  const def = load('most-likely');
  const ctx = makeCtx(3, { rounds: 8 });
  const state = def.create(ctx);
  for (let r = 0; r < 8; r++) {
    const before = { ...state.scores };
    def.onAction(state, ctx, 'p1', { vote: 'p2' });
    def.onAction(state, ctx, 'p2', { vote: 'p3' });
    def.onAction(state, ctx, 'p3', { vote: 'p2' });
    for (const pid of ids(ctx)) assert((state.scores[pid] || 0) - (before[pid] || 0) <= 200, 'Most Likely round points at most 200');
    def.onAction(state, ctx, 'p1', { next: true });
  }
}

// 4. Rapid Polls: 25 points to everyone who took part in a round.
{
  const def = load('rapid-polls');
  const ctx = makeCtx(4, { rounds: 2 });
  const state = def.create(ctx);
  def.onAction(state, ctx, 'p1', { pose: { q: 'Tea or coffee?', options: ['Tea', 'Coffee'] } });
  def.onAction(state, ctx, 'p2', { vote: 0 });
  def.onAction(state, ctx, 'p3', { vote: 1 });
  ctx.leave(def, state, 'p4'); // not waited for, but the poser still votes
  assert.equal(state.phase, 'vote');
  ctx.time = state.endsAt;
  def.onAction(state, ctx, 'p2', { vote: 1 }); // closes the expired vote
  assert.equal(state.phase, 'reveal', 'Rapid Polls reveals at the deadline');
  assert.deepEqual(state.scores, { p1: 25, p2: 25, p3: 25 }, 'poser and voters get 25; the absent player none');
  assert.deepEqual(ctx.awards, state.scores, 'awarded when earned');
}

// 5. Hot Takes: equal splits share the place; rounds repeat.
{
  const def = load('hot-takes');
  const ctx = makeCtx(4, { rounds: 2 });
  const state = def.create(ctx);
  for (const pid of ids(ctx)) def.onAction(state, ctx, pid, { take: 'Take by ' + pid });
  assert.equal(state.phase, 'vote');
  // Every take splits 2 agree / 1 disagree: all four tie.
  while (state.phase === 'vote' || state.phase === 'reveal') {
    if (state.phase === 'reveal') { def.onAction(state, ctx, 'p1', { next: true }); continue; }
    const author = state.takes.find((t) => t.tid === state.order[state.index]).author;
    let k = 0;
    for (const pid of ids(ctx)) if (pid !== author) def.onAction(state, ctx, pid, { vote: k++ < 2 ? 'agree' : 'disagree' });
  }
  assert.equal(state.phase, 'standings', 'round 1 ends on the standings');
  assert.equal(state.winners.length, 4, 'four equal splits all win (never list order)');
  assert.deepEqual(state.runnersUp, []);
  for (const pid of ids(ctx)) assert.equal(state.scores[pid], 115, pid + ' gets 100 + 3 votes x 5');
  def.onAction(state, ctx, 'p2', { next: true });
  assert.equal(state.phase, 'standings', 'only the host moves on from the standings');
  def.onAction(state, ctx, 'p1', { next: true });
  assert.equal(state.phase, 'submit');
  assert.equal(state.round, 2);
  assert.deepEqual(state.takes, [], 'a new round starts with no takes');
  // Round 2: p1's take splits, the others are unanimous; p3 leaves.
  for (const pid of ['p1', 'p2', 'p3']) def.onAction(state, ctx, pid, { take: 'Second take ' + pid });
  ctx.leave(def, state, 'p4');
  assert.equal(state.phase, 'vote', 'the last missing writer left: voting starts');
  while (state.phase === 'vote' || state.phase === 'reveal') {
    if (state.phase === 'reveal') { def.onAction(state, ctx, 'p1', { next: true }); continue; }
    const author = state.takes.find((t) => t.tid === state.order[state.index]).author;
    for (const pid of ids(ctx)) if (pid !== author) def.onAction(state, ctx, pid, { vote: author === 'p1' && pid === 'p2' ? 'disagree' : 'agree' });
  }
  assert.equal(state.phase, 'done');
  const p1Take = state.takes.find((t) => t.author === 'p1').tid;
  assert.deepEqual(state.winners, [p1Take], 'the only split take wins round 2');
  assert.equal(state.roundPts.p1, 110);
  assert.equal(state.roundPts.p2, 10, 'unanimous takes only get their vote extra');
}

// 6. Rank It: tied items share places; tied closest rankings share +50.
{
  const def = load('rank-it');
  const ctx = makeCtx(2, { rounds: 1 });
  const state = def.create(ctx);
  def.onAction(state, ctx, 'p1', { order: [0, 1, 2, 3, 4] });
  def.onAction(state, ctx, 'p2', { order: [1, 0, 2, 3, 4] });
  assert.equal(state.phase, 'reveal');
  assert.equal(state.last.dist.p1, state.last.dist.p2, 'mirror rankings are equally close');
  assert.equal(state.last.pts.p1, state.last.pts.p2, 'equal rankings get equal points');
  assert.deepEqual(state.last.closest.sort(), ['p1', 'p2'], 'both share the closest bonus');
  assert(state.last.pts.p1 <= 200);
}

// 7. Truth or Dare: an even split is half credit; nobody else scores.
{
  const def = load('truth-dare');
  const ctx = makeCtx(3, { rounds: 2 });
  const state = def.create(ctx);
  ctx.fireLast(); // spin -> choose
  const t = state.target;
  def.onAction(state, ctx, t, { deck: 'classic', kind: 'dare' });
  def.onAction(state, ctx, t, { ready: true });
  const [v1, v2] = ids(ctx).filter((pid) => pid !== t);
  def.onAction(state, ctx, v1, { vote: 'yes' });
  def.onAction(state, ctx, v2, { vote: 'no' });
  assert.equal(state.last.verdict, 'split');
  assert.deepEqual(state.scores, { [t]: 50 }, 'a tie gives the target 50 and no one else points');
  def.onAction(state, ctx, t, { next: true });
  assert.equal(state.phase, 'spin', 'the target can press Next');
  // The next target leaves before choosing: their turn is skipped.
  const second = state.target;
  ctx.fireLast();
  ctx.leave(def, state, second);
  assert.equal(state.phase, 'done', 'gone target: turn skipped (last round)');
}
{
  // Auto rounds: a player who leaves before their turn no longer counts.
  const def = load('truth-dare');
  const ctx = makeCtx(4);
  const state = def.create(ctx);
  assert.equal(state.rounds, 4);
  const later = state.rotation.find((pid) => pid !== state.target && !state.turns.includes(pid));
  ctx.leave(def, state, later);
  assert.equal(state.rounds, 3, 'Auto drops the gone player\'s turn');
  // A voter who leaves is not waited for.
  ctx.fireLast();
  def.onAction(state, ctx, state.target, { deck: 'classic', kind: 'truth' });
  def.onAction(state, ctx, state.target, { ready: true });
  const voters = ids(ctx).filter((pid) => pid !== state.target);
  def.onAction(state, ctx, voters[0], { vote: 'yes' });
  ctx.leave(def, state, voters[1]);
  assert.equal(state.phase, 'reveal', 'remaining voters done: reveal');
  assert.equal(state.last.verdict, 'yes');
  for (let r = 0; r < 6 && state.phase !== 'done'; r++) {
    if (state.phase === 'reveal') { def.onAction(state, ctx, 'p1', { next: true }); continue; }
    if (state.phase === 'spin') { ctx.fireLast(); continue; }
    if (state.phase === 'choose') { def.onAction(state, ctx, state.target, { deck: 'classic', kind: 'truth' }); continue; }
    if (state.phase === 'perform') { def.onAction(state, ctx, state.target, { ready: true }); continue; }
    if (state.phase === 'vote') { for (const pid of ids(ctx)) if (pid !== state.target) def.onAction(state, ctx, pid, { vote: 'yes' }); }
  }
  assert.equal(state.phase, 'done');
  assert(!state.turns.includes(later), 'the player who left never got a turn');
}

// 8. Dare Roulette: split verdict is half credit; a dared player who leaves
//    is skipped; they can also press Next.
{
  const def = load('dare-roulette');
  const ctx = makeCtx(3, { rounds: 3 });
  const state = def.create(ctx);
  def.onAction(state, ctx, 'p1', { spin: true });
  const v = state.victim;
  def.onAction(state, ctx, v, { ready: true });
  const [j1, j2] = ids(ctx).filter((pid) => pid !== v);
  def.onAction(state, ctx, j1, { vote: 'done' });
  def.onAction(state, ctx, j2, { vote: 'chicken' });
  assert.equal(state.last.split, true);
  assert.deepEqual(state.scores, { [v]: 50 }, 'even split: half credit');
  def.onAction(state, ctx, v, { next: true });
  assert.equal(state.phase, 'spin', 'the dared player can press Next');
  def.onAction(state, ctx, 'p1', { spin: true });
  const gone = state.victim;
  ctx.leave(def, state, gone);
  assert.equal(state.phase, 'spin', 'gone performer: dare skipped');
  assert.equal(state.last.skipped, true);
  def.onAction(state, ctx, 'p1', { spin: true });
  assert.notEqual(state.victim, gone, 'the wheel skips a player who left');
}

// 9. Twenty Questions: standard scale; answerer leaving ends the round.
{
  const def = load('twenty-questions');
  const ctx = makeCtx(3, { rounds: 2 });
  const state = def.create(ctx);
  const guesser = ids(ctx).find((pid) => pid !== state.answerer);
  def.onAction(state, ctx, guesser, { guess: state.word });
  assert.equal(state.scores[guesser], 200, 'first-question guess: 100 + 100 speed');
  const outsider = ids(ctx).find((pid) => pid !== state.answerer && pid !== 'p1');
  def.onAction(state, ctx, outsider, { next: true });
  assert.equal(state.phase, 'reveal');
  def.onAction(state, ctx, 'p1', { next: true });
  assert.equal(state.phase, 'play', 'the host can press Next');
  const answerer = state.answerer;
  const before = { ...state.scores };
  ctx.leave(def, state, answerer);
  assert.equal(state.phase, 'reveal', 'answerer left: round ends');
  assert.equal(state.last.reason, 'left');
  assert.deepEqual(state.scores, before, 'no stumper bonus for leaving');
}
{
  const def = load('twenty-questions');
  const ctx = makeCtx(3);
  const state = def.create(ctx);
  ctx.fireLast(); // nobody guessed in time
  assert.equal(state.scores[state.answerer], 100, 'stumper bonus is 100');
}

// 10. Voting games stop waiting for a player who left.
for (const [id, action] of [['would-you-rather', { vote: 'a' }], ['never-ever', { vote: 'have' }], ['pick-one', { vote: 'b' }],
  ['most-likely', null], ['rank-it', { order: [4, 3, 2, 1, 0] }]]) {
  const def = load(id);
  const ctx = makeCtx(4);
  const state = def.create(ctx);
  for (const pid of ['p1', 'p2', 'p3']) def.onAction(state, ctx, pid, action || { vote: pid === 'p1' ? 'p2' : 'p1' });
  assert.notEqual(state.phase, 'reveal', id + ' waits for p4');
  ctx.leave(def, state, 'p4', 'away');
  assert.equal(state.phase, 'reveal', id + ' reveals once p4 is gone');
}

console.log('PARTY_A_RULES_PASS: Rounds/Pace settings, paced timers, capped extras, shared ties, Rapid Polls points, End game and leaving across 10 party games');
