'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SameRoom, validateStart, createSameRoomHub } = require('../server/same-room');
const registry = require('../games/registry');
const content = Object.fromEntries(fs.readdirSync(path.join(__dirname, '../locales/en')).filter(f => f.endsWith('.json')).map(f => [f.slice(0, -5), require('../locales/en/' + f)]));
const socket = () => ({ readyState: 1, messages: [], send(raw) { this.messages.push(JSON.parse(raw)); } });
function create(game, count = 2, settings = {}) {
  const room = new SameRoom(content, { game, names: ['Sam', 'Jess', 'Mo', 'Ali', 'Bea'].slice(0, count), settings });
  room.attach(socket());
  return room;
}
function op(r, op, fields = {}) { r.receive({ step: r.step, op, ...fields }); }
function ready(r) { op(r, 'ready'); }
function action(r, a) { ready(r); op(r, 'action', { a }); }
function privateTurn(r, a) {
  assert.equal(r.snapshot().gate, 'pass');
  assert.equal(r.snapshot().state, undefined, 'no private projection is sent behind the cover');
  op(r, 'unlock'); assert.equal(r.snapshot().gate, 'play');
  action(r, a); assert.equal(r.snapshot().gate, 'return');
  assert.equal(r.snapshot().state, undefined, 'return screen contains no private state');
  op(r, 'back');
}
function advance(r, ms) { ready(r); for (let i = 0; i < ms; i += 100) r.pump(100); }

assert.equal(registry.list().filter(g => g.sameRoom).length, 21);
for (const g of registry.list()) assert([true, false, 'handoff'].includes(g.sameRoom));
for (const game of ['pose-party', 'show-and-go', 'pocket-karts', 'draw-phone', 'fleet-duel', 'unknown', '__proto__']) assert(validateStart({ game, names: ['Sam', 'Jess'] }).error);
for (const names of [[], ['Sam'], ['Sam', 'sam'], ['Sam', {}], ['Sam', ' '], ['Sam', 'a'.repeat(17)], Array(21).fill('Sam')]) assert(validateStart({ game: 'truth-dare', names }).error);
assert(validateStart({ game: 'chess', names: ['Sam', 'Jess', 'Mo'] }).error, 'no spectator slots in local games');
assert.throws(() => create('truth-dare', 2, { rounds: 999 }), /rounds/i, 'same Room settings validation');
const twenty = new SameRoom(content, { game: 'truth-dare', names: Array.from({ length: 20 }, (_, i) => `Friend ${i + 1}`) });
assert.equal(twenty.snapshot().players.length, 20); twenty.destroy();

for (const count of [2, 5]) for (const promptStyle of ['Random card', 'Room pool vote', 'Ask your own', 'Mixed']) for (const deck of ['classic', 'funny', 'wild']) {
  const r = create('truth-dare', count, { rounds: 1, promptStyle });
  try {
    const target = r.game.state.target;
    assert.equal(r.snapshot().player, target, 'spinner banner names the real target');
    advance(r, 4000); assert.equal(r.game.state.phase, 'choose');
    assert.equal(r.snapshot().player, target, 'choice controls belong to the target');
    assert.equal(r.snapshot().state.me, target, 'game view and shell use the same actor');
    action(r, { deck, kind: deck === 'wild' ? 'random' : 'truth' });
    let writers = 0, pickers = 0;
    while (r.game.state.phase === 'compose') {
      assert.notEqual(r.snapshot().player, target, 'target cannot write a prompt');
      const at = r.logicalNow; advance(r, 100000);
      assert.equal(r.logicalNow, at, 'passing time does not use the private timer');
      privateTurn(r, { entry: `Tell a favourite memory, writer ${++writers}.` });
    }
    if (r.game.state.roundStyle === 'Ask your own') assert.equal(writers, count - 1);
    while (r.game.state.phase === 'prompt-vote') {
      assert.notEqual(r.snapshot().player, target, 'target cannot pick their own prompt');
      privateTurn(r, { promptVote: 0 }); pickers++;
    }
    const poolExpected = r.game.state.roundStyle === 'Room pool vote' ||
      r.game.state.roundStyle === 'Ask your own' && count > 2;
    assert.equal(pickers, poolExpected ? count - 1 : 0, 'every eligible peer picks; one written prompt is used directly');
    assert.equal(r.game.state.phase, 'perform');
    assert.equal(r.snapshot().player, target, 'performance banner returns to the target');
    assert.equal(r.snapshot().state.me, target);
    assert.deepEqual(r.game.state.scores, {}, 'writing and pool votes do not score');
    action(r, { ready: true });
    for (let i = 1; i < count; i++) {
      assert.notEqual(r.snapshot().player, target, 'target cannot judge themself');
      privateTurn(r, { vote: 'yes' });
    }
    assert.equal(r.game.state.phase, 'reveal');
    assert.equal(r.game.state.last.targetPts, 100);
    assert.equal(r.totals[target], 100);
    assert.equal(Object.values(r.totals).reduce((a, b) => a + b, 0), 100 + 25 * (count - 1), 'identical module score rules');
    action(r, { next: true }); assert.equal(r.game.state.phase, 'done');
    op(r, 'rematch'); assert.equal(r.game.state.phase, 'spin');
    assert.equal(r.game.state.promptStyle, promptStyle);
  } finally { r.destroy(); }
}

// Seeded target beyond the host catches a shell accidentally using seat one.
const oldRandom = Math.random; Math.random = () => 0;
const nonhost = create('truth-dare', 5);
Math.random = oldRandom;
try {
  assert.notEqual(nonhost.game.state.target, nonhost.hostId);
  advance(nonhost, 4000);
  assert.equal(nonhost.snapshot().player, nonhost.game.state.target);
  assert.equal(nonhost.snapshot().state.me, nonhost.game.state.target);
} finally { nonhost.destroy(); }

const board = create('four-in-a-row');
try {
  for (const col of [0, 1, 0, 1, 0, 1, 0]) {
    const turn = board.game.state.turn;
    assert.equal(board.snapshot().player, board.game.state.seats[turn - 1]);
    action(board, { drop: col, rev: board.game.state.rev });
  }
  assert.equal(board.game.state.phase, 'done');
  assert.equal(board.game.state.result.winnerPid, 'local-1');
} finally { board.destroy(); }

const vote = create('would-you-rather', 5, { rounds: 1 });
try {
  const closedStep = vote.step;
  op(vote, 'action', { a: { vote: 'a' } });
  assert.deepEqual(vote.game.state.votes, {}, 'cannot vote through a covered screen');
  for (let i = 0; i < 5; i++) {
    const pid = vote.snapshot().player;
    privateTurn(vote, { vote: 'a' });
    assert.equal(vote.game.state.votes[pid], 'a');
  }
  assert.equal(vote.game.state.phase, 'reveal');
  vote.receive({ step: closedStep, op: 'action', a: { next: true } });
  assert.equal(vote.game.state.phase, 'reveal', 'stale and duplicate controls cannot skip steps');
  action(vote, { next: true }); assert.equal(vote.game.state.phase, 'done');
} finally { vote.destroy(); }

const trivia = create('trivia', 2, { rounds: 1 });
try {
  const answer = trivia.game.state.question.answer;
  op(trivia, 'unlock'); ready(trivia); advance(trivia, 2000);
  const first = trivia.snapshot().player;
  op(trivia, 'action', { a: { pick: answer } }); op(trivia, 'back');
  assert.equal(trivia.logicalNow, trivia.phaseStart, 'the next person gets a fresh full answer window');
  privateTurn(trivia, { pick: answer });
  assert.equal(trivia.game.state.phase, 'reveal');
  assert(trivia.game.state.scores['local-2'] > trivia.game.state.scores[first], 'the module scores each person’s actual answer time');
} finally { trivia.destroy(); }

const timeout = create('pick-one');
try {
  op(timeout, 'unlock'); ready(timeout); advance(timeout, 5100);
  assert.equal(timeout.snapshot().gate, 'return');
  op(timeout, 'back'); privateTurn(timeout, { vote: 'b' });
  assert.equal(timeout.game.state.phase, 'reveal');
} finally { timeout.destroy(); }

const charades = create('charades');
try {
  const word = charades.game.state.word;
  assert(!JSON.stringify(charades.snapshot()).includes(word));
  op(charades, 'unlock'); assert.equal(charades.snapshot().state.word, word);
  const beforePeek = charades.logicalNow; advance(charades, 100000);
  assert.equal(charades.logicalNow, beforePeek, 'acting time begins after the word is hidden');
  ready(charades); op(charades, 'hide');
  assert(!JSON.stringify(charades.snapshot()).includes(word));
  op(charades, 'back');
  assert.equal(charades.snapshot().kind, 'guess');
  assert.equal(charades.snapshot().state.word, undefined);
  action(charades, { guess: word }); assert.equal(charades.game.state.phase, 'reveal');
} finally { charades.destroy(); }

for (const id of ['never-ever', 'most-likely', 'pick-one', 'rank-it', 'two-truths', 'hot-takes', 'five-second', 'dare-roulette', 'story-builder', 'rapid-polls', 'doodle-guess']) {
  const r = create(id, 2, { rounds: 1 });
  try {
    let steps = 0;
    while (r.game.state.phase !== 'done' && steps++ < 60) {
      const s = r.game.state;
      const phase = s.phase;
      if (r.snapshot().gate === 'return') { op(r, 'back'); continue; }
      if (r.snapshot().gate === 'pass') op(r, 'unlock');
      ready(r);
      const pid = r.plan().pid;
      let a;
      if (phase === 'reveal' || phase === 'standings') a = { next: true };
      else if (id === 'never-ever') a = { vote: 'have' };
      else if (id === 'most-likely') a = { vote: r.players.find(p => p.id !== pid).id };
      else if (id === 'pick-one') a = { vote: 'a' };
      else if (id === 'rank-it') a = { order: [0, 1, 2, 3, 4] };
      else if (id === 'two-truths') a = phase === 'write' ? { statements: ['I like tea', 'I have a cat', 'I am a dragon'], lie: 2 } : { vote: 2 };
      else if (id === 'hot-takes') a = phase === 'submit' ? { take: `${pid} thinks dogs are the best pets` } : { vote: 'agree' };
      else if (id === 'five-second') a = phase === 'answer' ? { spoken: true } : { vote: 'pass' };
      else if (id === 'dare-roulette') a = phase === 'spin' ? { spin: true } : phase === 'perform' ? { ready: true } : { vote: 'done' };
      else if (id === 'story-builder') a = phase === 'build' ? { line: `A sentence from ${pid}.` } : { vote: s.lines.findIndex(line => line.pid !== pid) };
      else if (id === 'rapid-polls') a = phase === 'pose' ? { pose: { q: 'Tea or coffee?', options: ['Tea', 'Coffee'] } } : { vote: 0 };
      else if (id === 'doodle-guess') {
        if (phase === 'pick') a = { choose: s.choices[0] };
        else {
          assert.equal(r.snapshot().state.word, undefined);
          assert.equal(r.snapshot().state.wordShown, undefined);
          op(r, 'guess', { pid: r.players.find(p => p.id !== s.drawer).id, text: s.word });
          continue;
        }
      }
      action(r, a);
    }
    assert.equal(r.game.state.phase, 'done', `${id} completes with two people through the real rules`);
    if (id === 'five-second') assert(Object.values(r.game.state.scores).some(points => points >= 100), 'the group’s pass verdict scores spoken answers');
  } finally { r.destroy(); }
}

// Every manifest opt-in must start, project and expose a known actor/phase.
for (const g of registry.list().filter(g => g.sameRoom)) {
  const r = create(g.id);
  try {
    const initial = r.snapshot(); assert(initial.player, `${g.id} names the next actor`);
    if (initial.gate === 'pass') op(r, 'unlock');
    assert(r.snapshot().state, `${g.id} projects through its real module`);
  } finally { r.destroy(); }
}

const hub = createSameRoomHub(content), a = socket(), b = socket();
hub.handle(a, { t: 'same-start', game: 'truth-dare', names: ['Sam', 'Jess'] });
const token = a.messages.find(m => m.t === 'same-created').token;
hub.handle(b, { t: 'same-resume', token }); assert.equal(b.messages.at(-1).t, 'same-error', 'one live controller');
hub.detach(a); hub.handle(b, { t: 'same-resume', token }); assert.equal(b.messages.at(-1).t, 'same-state');
hub.handle(b, { t: 'same-stop' }); hub.handle(a, { t: 'same-resume', token }); assert.equal(a.messages.at(-1).t, 'same-error');
console.log('SAME_ROOM_PASS: Truth or Dare 2/5 people and all styles; board win; five-seat vote; private projections; deadlines; resume; 21 manifest opt-ins');
