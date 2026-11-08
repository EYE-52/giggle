'use strict';
const assert = require('node:assert/strict');
const def = require('../games/truth-dare/server');
const pack = require('../locales/en/truth-dare.json');
const registry = require('../games/registry');
const { validateManifest } = require('../games/_validate');
const STYLES = ['Random card', 'Room pool vote', 'Ask your own', 'Mixed'];

function setup(n, promptStyle, extra = {}, content = pack) {
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: ['Asha', 'Bo', 'Charlie', 'Dev', 'Eli', 'Finn'][i] }));
  const timers = [], awards = {}, gone = new Set();
  let time = 1000;
  const ctx = {
    allPlayers: () => roster, players: () => roster.filter(p => !gone.has(p.id)),
    hostId: () => roster[0].id, now: () => time, content: () => content,
    settings: () => ({ rounds: 1, promptStyle, ...extra }), broadcast() {},
    later(ms, fn) { timers.push({ at: time + ms, fn }); },
    award(pid, pts) { awards[pid] = (awards[pid] || 0) + pts; },
  };
  const state = def.create(ctx);
  const x = { state, ctx, roster, awards, timers,
    peers: () => ctx.players().filter(p => p.id !== state.target),
    act: (pid, a) => def.onAction(state, ctx, pid, a),
    fire() { const t = timers.at(-1); time = Math.max(time, t.at); t.fn(); },
    deadline() { time = state.endsAt; },
    leave(pid) { gone.add(pid); def.onPlayerGone(state, ctx, pid); },
    view(pid) { return { ...def.view(state, pid, ctx), players: ctx.players(), me: pid, instanceId: 'td-modes', serverNow: time }; },
  };
  x.fire();
  assert.equal(state.phase, 'choose');
  return x;
}

function choose(x, kind = 'truth', deck = 'classic') { x.act(x.state.target, { deck, kind }); }
function finishPrompt(x) {
  if (x.state.phase === 'compose') for (const p of x.peers()) x.act(p.id, { entry: `Do a funny impression for ${p.name}.` });
  if (x.state.phase === 'prompt-vote') for (const p of x.peers()) x.act(p.id, { promptVote: 0 });
  assert.equal(x.state.phase, 'perform');
}
function randomAt(value, fn) {
  const old = Math.random; Math.random = () => value;
  try { return fn(); } finally { Math.random = old; }
}

function run() {
  assert(validateManifest(def).ok);
  const meta = registry.list().find(g => g.id === def.id);
  assert.equal(meta.players, '2–20', 'home/lobby count comes from manifest');
  assert.equal(meta.minPlayers, 2);
  assert.equal(def.minPlayers, 2);
  assert.deepEqual(meta.schema.settings.find(s => s.key === 'promptStyle').options, STYLES);
  for (const n of [2, 3, 6]) for (const style of STYLES) for (const kind of ['truth', 'dare']) {
    const x = setup(n, style), s = x.state;
    const target = s.target;
    x.act('watch', { deck: 'wild', kind });
    x.act(x.peers()[0].id, { deck: 'wild', kind });
    assert.equal(s.phase, 'choose', 'only target chooses');
    choose(x, kind, 'funny');
    if (s.roundStyle === 'Random card') assert(pack[kind + 's'].funny.includes(s.prompt));
    if (s.roundStyle === 'Room pool vote') {
      assert.equal(s.options.length, n >= 5 ? 4 : 3);
      assert.equal(new Set(s.options).size, s.options.length);
      assert(s.options.every(text => pack[kind + 's'].funny.includes(text)), 'cards come from chosen deck');
    }
    for (const phase of ['compose', 'prompt-vote']) if (s.phase === phase) {
      x.act(target, { entry: 'Self prompt', promptVote: 0, vote: 'yes' });
      x.act('watch', { entry: 'Watcher prompt', promptVote: 0, vote: 'yes' });
      assert.deepEqual(s.entries, {});
      assert.deepEqual(s.promptVotes, {});
    }
    finishPrompt(x);
    assert.deepEqual(s.scores, {}, 'writing and picking never score');
    x.act(x.peers()[0].id, { ready: true });
    assert.equal(s.phase, 'perform');
    x.act(target, { ready: true });
    x.act(target, { vote: 'yes' });
    assert.deepEqual(s.votes, {}, 'target cannot judge themself');
    for (const p of x.peers()) x.act(p.id, { vote: 'yes' });
    assert.equal(s.phase, 'reveal');
    assert.equal(s.last.targetPts, 100);
    assert.equal(s.last.verdict, 'yes');
    assert.equal(s.last.yes, n - 1);
    assert.equal(Object.values(x.awards).reduce((a, b) => a + b, 0), 100 + (n - 1) * 25);
    const scores = JSON.stringify(s.scores);
    for (const t of x.timers) t.fn();
    assert.equal(JSON.stringify(s.scores), scores, 'old callbacks do not duplicate scores');
  }

  for (const n of [2, 3, 6]) {
    // Plurality, random ties, no-vote auto-pick, immutable/private ballots.
    for (const random of [0, 0.999]) {
      const x = setup(n, 'Room pool vote'); choose(x);
      const s = x.state, original = [...s.options], peers = x.peers();
      x.act(peers[0].id, { promptVote: -1 }); x.act(peers[0].id, { promptVote: 99 });
      assert.deepEqual(s.promptVotes, {});
      if (n > 2) {
        x.act(peers[0].id, { promptVote: 0 });
        x.act(peers[0].id, { promptVote: 2 });
        assert.equal(s.promptVotes[peers[0].id], 0, 'first pick is final');
        assert(!('promptVotes' in x.view(s.target)), 'picks stay private');
        if (n === 6) { x.act(peers[1].id, { promptVote: 0 }); x.act(peers[2].id, { promptVote: 1 }); }
        randomAt(random, () => x.act(peers.at(-1).id, { promptVote: 1 }));
        // Six players: 2–2 tie with one abstention, settled by deadline.
        if (s.phase === 'prompt-vote') randomAt(random, () => x.fire());
        assert.equal(s.prompt, original[random === 0 ? 0 : 1]);
      } else {
        x.act(peers[0].id, { promptVote: 2 });
        assert.equal(s.prompt, original[2], 'one peer picks directly');
      }
    }
    const noVote = setup(n, 'Room pool vote'); choose(noVote, 'dare');
    const options = [...noVote.state.options];
    noVote.deadline(); noVote.act(noVote.peers()[0].id, { promptVote: 0 });
    assert(options.includes(noVote.state.prompt)); assert.deepEqual(noVote.state.promptVotes, {});
    const plurality = setup(n, 'Room pool vote'); choose(plurality);
    const expected = plurality.state.options[1];
    plurality.act(plurality.peers()[0].id, { promptVote: 1 }); plurality.fire();
    assert.equal(plurality.state.prompt, expected, 'nonvoters do not override a leading card');

    const x = setup(n, 'Ask your own'); choose(x, 'dare');
    const s = x.state, peer = x.peers()[0].id;
    for (const entry of ['', '  \n ', 'x', 'x'.repeat(181)]) x.act(peer, { entry });
    assert.deepEqual(s.entries, {}); assert(x.view(peer).myError);
    x.act(peer, { entry: '  Sing\n a tune.  ' });
    assert.equal(s.entries[peer], 'Sing a tune.');
    x.act(peer, { entry: 'Replace it' }); assert.equal(s.entries[peer], 'Sing a tune.');
    for (const role of [s.target, 'watch']) {
      const v = x.view(role);
      assert(!('entries' in v)); assert.equal(v.myEntry, null);
      if (s.phase === 'compose') assert(!JSON.stringify(v).includes('Sing a tune.'), 'draft text stays private until picking');
    }
    if (n > 2) x.fire();
    assert.equal(s.phase, 'perform'); assert.equal(s.prompt, 'Sing a tune.', 'one submission used directly');
    const empty = setup(n, 'Ask your own'); choose(empty);
    empty.deadline(); empty.act(empty.peers()[0].id, { entry: 'Too late' });
    assert.equal(empty.state.phase, 'perform');
    assert(pack.truths.classic.includes(empty.state.prompt));
    assert.deepEqual(empty.state.entries, {});

    const written = setup(n, 'Ask your own'); choose(written);
    for (const [i, p] of written.peers().entries()) written.act(p.id, { entry: `Which funny story do you remember, ${i}?` });
    if (n > 2) {
      assert.equal(written.state.phase, 'prompt-vote');
      assert.equal(written.state.options.length, n - 1);
      written.act(written.state.target, { promptVote: 0 });
      assert.deepEqual(written.state.promptVotes, {}, 'target cannot pick a written prompt');
      assert(!('entries' in written.view(written.state.target)), 'authors stay private on ballot');
      const card = written.state.options[1];
      for (const p of written.peers()) written.act(p.id, { promptVote: 1 });
      assert.equal(written.state.prompt, card);
    } else assert.equal(written.state.phase, 'perform');
    assert.deepEqual(written.state.scores, {});

    const duplicates = setup(n, 'Ask your own'); choose(duplicates);
    for (const p of duplicates.peers()) duplicates.act(p.id, { entry: 'Tell a funny story.' });
    assert.equal(duplicates.state.phase, 'perform', 'identical submissions need no extra ballot');

    // Every style completes on timers alone and auto rotates all seats once.
    for (const style of STYLES) {
      const timed = setup(n, style, { rounds: null, pace: 'Quick' }), seen = new Set([timed.state.target]);
      for (let i = 0; timed.state.phase !== 'done' && i < 100; i++) {
        timed.fire();
        if (timed.state.phase === 'spin') seen.add(timed.state.target);
      }
      assert.equal(timed.state.phase, 'done'); assert.equal(seen.size, n);
      assert.deepEqual(timed.state.scores, {}, 'no judging votes gives no points');
    }
    const spin = setup(n, 'Random card'); randomAt(0, () => choose(spin, 'random'));
    assert.equal(spin.state.kind, 'truth');
    const spinDare = setup(n, 'Random card'); randomAt(0.99, () => choose(spinDare, 'random'));
    assert.equal(spinDare.state.kind, 'dare');
    for (const [i, style] of STYLES.slice(0, 3).entries()) {
      const mixed = randomAt((i + 0.1) / 3, () => setup(n, 'Mixed'));
      assert.equal(mixed.state.roundStyle, style, 'Mixed can choose every style');
    }
    for (const [votes, verdict, pts] of [[['no'], 'no', 0], [[], 'none', 0], [['yes', 'no'], n === 2 ? 'yes' : 'split', n === 2 ? 100 : 50]]) {
      const judge = setup(n, 'Random card'); choose(judge); judge.act(judge.state.target, { ready: true });
      judge.peers().slice(0, votes.length).forEach((p, i) => judge.act(p.id, { vote: votes[i] }));
      if (judge.state.phase === 'vote') judge.fire();
      assert.equal(judge.state.last.verdict, verdict); assert.equal(judge.state.last.targetPts, pts);
    }
  }
  for (const style of ['Room pool vote', 'Ask your own']) {
    const short = setup(6, style, {}, { truths: { classic: ['Only one local card'] } });
    choose(short); if (short.state.phase === 'prompt-vote') assert.equal(new Set(short.state.options).size, 4);
    const gone = setup(3, style); choose(gone); const old = gone.timers.at(-1);
    gone.leave(gone.state.target); assert.equal(gone.state.phase, 'done'); old.fn(); assert.equal(gone.state.phase, 'done');
    const survivor = setup(3, style); choose(survivor);
    const [a, b] = survivor.peers();
    survivor.act(a.id, style === 'Ask your own' ? { entry: 'Do an impression.' } : { promptVote: 1 });
    survivor.leave(b.id); assert.equal(survivor.state.phase, 'perform', 'departed peers do not block prompt choice');
  }
  for (const [pace, factor] of [['Normal', 1], ['Relaxed', 1.5], ['Quick', 0.67]]) {
    const x = setup(3, 'Ask your own', { pace }); choose(x);
    assert.equal(x.state.endsAt - x.ctx.now(), Math.round(40 * factor) * 1000);
    for (const p of x.peers()) x.act(p.id, { entry: `Tell a story about ${p.name}.` });
    assert.equal(x.state.phase, 'prompt-vote');
    assert.equal(x.state.endsAt - x.ctx.now(), Math.round(25 * factor) * 1000);
    const retired = x.timers.at(-1);
    for (const p of x.peers()) x.act(p.id, { promptVote: 0 });
    const prompt = x.state.prompt; retired.fn();
    assert.equal(x.state.phase, 'perform'); assert.equal(x.state.prompt, prompt);
  }
  // Streak scoring remains the same through each new path.
  for (const style of STYLES) {
    const x = setup(2, style, { rounds: 12 }), earned = {};
    while (x.state.phase !== 'done') {
      const target = x.state.target;
      choose(x); finishPrompt(x); x.act(target, { ready: true });
      x.act(x.peers()[0].id, { vote: 'yes' });
      const prior = earned[target] || 0;
      assert.equal(x.state.last.targetPts, 100 + Math.min(100, prior * 25)); earned[target] = prior + 1;
      x.act(target, { next: true }); if (x.state.phase === 'spin') x.fire();
    }
  }

  // Real Room start/rematch: two seats, enum validation, fresh instance,
  // settings retained, late actions from the old match rejected.
  const { Room } = require('../server/room');
  for (const promptStyle of STYLES) {
    const room = new Room('TDQA', { 'truth-dare': pack });
    const socket = () => ({ readyState: 1, send() {} });
    const a = room.addPlayer('Asha', socket()).player;
    room.addPlayer('Bo', socket());
    try {
      assert.equal(room.startGame(def, { settings: { promptStyle, rounds: 2 } }, a.id).ok, true);
      const old = room.game.instanceId;
      const token = room._actionToken();
      room.game.state.scores[a.id] = 100; room.game.state.streaks[a.id] = 2;
      def.onEnd(room.game.state);
      assert.equal(room.startGame(def, {}, a.id).ok, true);
      assert.notEqual(room.game.instanceId, old);
      assert.equal(room.game.state.promptStyle, promptStyle);
      assert.deepEqual(room.game.state.scores, {}); assert.deepEqual(room.game.state.streaks, {});
      const before = JSON.stringify(room.game.state);
      room.onAction(a.socket, { next: true }, { i: old, w: token });
      assert.equal(JSON.stringify(room.game.state), before);
    } finally { room.clearTimers(); }
  }
  console.log('TRUTH_DARE_MODES_PASS: 2/3/6 players, all styles, private input, deals, ties, deadlines, fallbacks, rotation, scoring and Room rematches');
}
/* Real projections for the optional browser geometry/screenshot suite. */
function browserFrames() {
  const frames = [];
  for (const n of [2, 3, 6]) for (const style of ['Room pool vote', 'Ask your own']) {
    const x = setup(n, style), peer = x.peers()[0].id;
    const capture = pid => frames.push(JSON.parse(JSON.stringify({ ...x.view(pid), spectator: pid === 'watch', instanceId: `td-browser-${n}-${style}` })));
    capture(x.state.target); choose(x); capture(peer); capture(x.state.target); capture('watch');
    if (x.state.phase === 'compose') {
      for (const p of x.peers()) { x.act(p.id, { entry: `Tell a funny story about ${p.name}.` }); capture(p.id); }
    }
    if (x.state.phase === 'prompt-vote') {
      capture(peer); capture(x.state.target); capture('watch');
      x.act(peer, { promptVote: 0 }); capture(peer);
      for (const p of x.peers().slice(1)) x.act(p.id, { promptVote: 0 });
    }
    capture(x.state.target); x.act(x.state.target, { ready: true }); capture(peer);
    for (const p of x.peers()) x.act(p.id, { vote: 'yes' }); capture(x.state.target);
  }
  return frames;
}
module.exports = { setup, choose, finishPrompt, STYLES, browserFrames };
if (require.main === module) run();
