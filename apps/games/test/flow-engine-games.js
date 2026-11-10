'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCardGame } = require('../games/engines/flow/card-game');
function room(id, pack, settings = {}) {
  const game = require(`../games/${id}/server`), timers = [], awards = {}, gone = new Set();
  const roster = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `Player ${i}` }));
  let now = 1000;
  const ctx = { flowSeed: 'integration', allPlayers: () => roster, players: () => roster.filter(p => !gone.has(p.id)),
    content: () => pack, settings: () => ({ rounds: 8, ...settings }), hostId: () => roster[0].id,
    now: () => now, broadcast() {}, later(ms, fn) { timers.push({ at: now + ms, fn }); },
    award(id, points) { awards[id] = (awards[id] || 0) + points; } };
  const state = game.create(ctx);
  return { state, game, ctx, roster, awards,
    act(id, action) { game.onAction(state, ctx, id, action); },
    fire() { const t = timers.at(-1); now = Math.max(now, t.at); t.fn(); },
    leave(id) { gone.add(id); game.onPlayerGone(state, ctx, id); },
    view(id) { return game.view(state, id, ctx); },
  };
}

test('Never Have I Ever uses one private seeded engine through a full match', () => {
  const statements = Array.from({ length: 10 }, (_, i) => `Statement ${i}`);
  const a = room('never-ever', { statements }), b = room('never-ever', { statements });
  const seen = [];
  for (let round = 0; round < 8; round++) {
    assert.equal(a.state.statement, b.state.statement, 'seeded prompt replay');
    seen.push(a.state.statement);
    for (const r of [a, b]) {
      assert.equal(r.state.phase, 'vote');
      for (const p of r.roster) {
        const view = r.view(p.id);
        for (const privateKey of ['flow', 'deal', 'seed', 'world', 'history']) assert(!Object.hasOwn(view, privateKey));
      }
      r.act('watcher', { vote: 'not' }); assert.deepEqual(r.state.votes, {});
      for (const p of r.roster) r.act(p.id, { vote: 'not' });
      assert.equal(r.state.phase, 'reveal'); assert.equal(r.state.last.pure, 4);
      r.fire();
    }
  }
  assert.equal(a.state.phase, 'done'); assert.equal(new Set(seen).size, 8);
  assert.deepEqual(a.awards, b.awards); assert.equal(a.awards.p0, 1350);
  assert.equal(a.state.flow.inspect().history.length, 8);
});

test('Never Have I Ever keeps custom strings, tiny-pack cycling, fallback and departures', () => {
  for (const statements of [['{literal}'], ['first', 'second'], []]) {
    const r = room('never-ever', { statements }, { rounds: 4 });
    const seen = [];
    for (let n = 0; n < 4; n++) { seen.push(r.state.statement); r.fire(); r.fire(); }
    assert.equal(r.state.phase, 'done');
    if (statements.length === 1) assert(seen.every(s => s === statements[0]));
    if (statements.length === 2) for (let n = 1; n < seen.length; n++) assert.notEqual(seen[n], seen[n - 1]);
  }
  const r = room('never-ever', { statements: ['test'] });
  for (const p of r.roster.slice(0, 3)) r.act(p.id, { vote: 'not' });
  r.leave('p3'); assert.equal(r.state.phase, 'reveal');
});

test('Truth or Dare preserves deck/kind choices, rotation, scoring and engine privacy', () => {
  const pack = require('../locales/en/truth-dare.json');
  const r = room('truth-dare', pack), seen = new Set(), targets = [];
  for (let n = 0; n < 8; n++) {
    r.fire(); assert.equal(r.state.phase, 'choose'); targets.push(r.state.target);
    const target = r.state.target;
    r.act(target, { deck: 'funny', kind: 'dare' });
    assert(pack.dares.funny.includes(r.state.prompt)); assert(!seen.has(r.state.prompt)); seen.add(r.state.prompt);
    const view = r.view(target);
    assert(!('flow' in view)); assert(!('deals' in view)); assert(!('rotation' in view));
    r.act(target, { ready: true });
    for (const p of r.roster.filter(p => p.id !== target)) r.act(p.id, { vote: 'yes' });
    assert.equal(r.state.phase, 'reveal'); assert(r.state.last.targetPts >= 100);
    r.fire();
  }
  assert.equal(r.state.phase, 'done');
  assert.equal(new Set(targets.slice(0, 4)).size, 4); assert.equal(new Set(targets.slice(4, 8)).size, 4);
  assert.equal(r.state.flow.inspect().history.length, 8);
  assert.deepEqual(Object.values(r.state.flow.inspect().exposure), [2, 2, 2, 2]);
});

test('Truth or Dare room pools remain unique even when a short custom deck cycles', () => {
  const r = room('truth-dare', { truths: { classic: ['Only one card'] } }, { promptStyle: 'Room pool vote', rounds: 1 });
  r.fire(); r.act(r.state.target, { deck: 'classic', kind: 'truth' });
  assert.equal(r.state.options.length, 3); assert.equal(new Set(r.state.options).size, 3);
  const option = r.state.options[0];
  for (const p of r.roster.filter(p => p.id !== r.state.target)) r.act(p.id, { promptVote: 0 });
  assert.equal(r.state.prompt, option); assert.equal(r.state.phase, 'perform');
});

test('instant-prompt adapter rejects activity effects so unchosen pool options cannot unlock state', () => {
  assert.throws(() => createCardGame('bad', [{ id: 'x', text: 'x', effects: [{ scope: 'table', key: 'x', op: 'set', value: true }] }]), /offer\/complete/);
});
