'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEngine, validateDefinition, targetHeat, pairKey } = require('../games/engines/flow');
const { createRandom, weighted } = require('../games/engines/flow/random');
const { specificity, resolveRules } = require('../games/engines/flow/state');
const { expand } = require('../games/engines/flow/template');
const { simulate } = require('../games/engines/flow/simulate');
const { cardsFromRows, createCardGame, dealText } = require('../games/engines/flow/card-game');
const players = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id.toUpperCase() }));
const card = (id, extra = {}) => ({ id, text: `Card ${id}`, ...extra });
const definition = (extra = {}) => ({ schemaVersion: 1, id: 'test', version: '1', start: 'play', phases: [{ id: 'play', dwell: [1, 1] }], cards: [card('one'), card('two'), card('three')], ...extra });
const engine = (def = definition(), options = {}) => createEngine(def, { seed: 'test', players, ...options });
const predicate = (scope, key, op, value) => ({ scope, key, op, ...(value === undefined ? {} : { value }) });
function finish(e, req) { const r = e.draw(req); assert.equal(r.status, 'offered', JSON.stringify(r)); e.complete(r.token); return r; }

test('string seeds, golden PRNG vector, independent streams and restored stream', () => {
  const a = createRandom('hello'), b = createRandom('hello');
  const rows = Array.from({ length: 100 }, () => a.next());
  assert.deepEqual(rows, Array.from({ length: 100 }, () => b.next()));
  const x = createRandom('ignored', 1);
  assert.deepEqual(Array.from({ length: 3 }, () => x.next() * 4294967296), [270369, 67634689, 2647435461]);
  const c = createRandom('other', a.state()); assert.equal(a.next(), c.next());
  assert(rows.every(n => n >= 0 && n < 1));
  assert.throws(() => createRandom('x', 0));
  assert.equal(weighted([], () => 1, () => 0), null);
  assert.throws(() => weighted([1], () => -1, () => 0));
  assert.equal(weighted(['first', 'last'], () => Number.MAX_VALUE, () => 0.25), 'first', 'weight totals cannot overflow');
});

test('every condition operator, missing qualities, composite specificity and rule fallbacks', () => {
  const w = { players: { a: { qualities: { score: 3, likes: ['music'] } } }, pairs: {}, table: { ready: true }, session: {} };
  const b = { actor: 'a' };
  for (const [op, value] of [['eq', 3], ['neq', 4], ['gt', 2], ['gte', 3], ['lt', 4], ['lte', 3], ['exists', true]]) {
    assert.equal(specificity(predicate('player', 'score', op, value), w, b), 1, op);
  }
  assert.equal(specificity(predicate('player', 'likes', 'includes', 'music'), w, b), 1);
  assert.equal(specificity(predicate('player', 'missing', 'neq', 1), w, b), -1);
  assert.equal(specificity(predicate('partner', 'score', 'eq', 3), w, b), -1);
  assert.equal(specificity(predicate('player', 'missing', 'exists', false), w, b), 1);
  const one = predicate('table', 'ready', 'eq', true), two = predicate('player', 'score', 'gte', 3);
  const rules = [{ id: 'fallback', group: 'tone' }, { id: 'specific', group: 'tone', when: { all: [one, two] } },
    { id: 'generic', group: 'tone', priority: 999, when: one }, { id: 'independent', group: 'other' }];
  assert.deepEqual(resolveRules(rules, w, b).map(r => r.id), ['specific', 'independent']);
  assert.equal(resolveRules(rules, { ...w, table: {} }, {})[0].id, 'fallback');
  assert.equal(specificity({ any: [{ all: [one, two] }, one] }, w, b), 2);
  assert.equal(specificity({ not: predicate('table', 'ready', 'eq', false) }, w, b), 1);
  assert.equal(specificity(predicate('player', 'likes', 'gt', 0), w, b), -1);
});

test('hard filters and contextual rules cannot bypass prerequisites or max heat', () => {
  const def = definition({ cards: [card('locked', { when: predicate('session', 'unlock', 'eq', true), weight: 100000 }),
    card('hot', { heat: 99 }), card('safe', { tags: ['safe'] })],
    director: { curve: [[0, 100]], maxHeat: 50 }, rules: [{ id: 'general', group: 'tone' },
      { id: 'tight', group: 'tone', when: predicate('table', 'quiet', 'eq', true), maxHeat: 10 }] });
  const e = engine(def, { table: { quiet: true } });
  const r = finish(e, { tagsAny: ['safe'] }); assert.equal(r.id, 'safe'); assert.deepEqual(r.rules, ['tight']);
  assert.equal(e.draw().reason, 'exhausted');
  e.setQuality('session', 'unlock', true);
  assert.equal(finish(e).id, 'locked');
});

test('scoped typed effects are committed once, skip never unlocks, and pairs are symmetric', () => {
  const def = definition({ cards: [card('unlock', { roles: 2, effects: [
    { scope: 'player', key: 'points', op: 'add', value: 3 },
    { scope: 'partner', key: 'ready', op: 'set', value: true },
    { scope: 'pair', key: 'steps', op: 'append', value: 'hello' },
    { scope: 'table', key: 'rounds', op: 'add', value: 1 },
    { scope: 'session', key: 'opened', op: 'set', value: true },
  ] }), card('later', { when: predicate('session', 'opened', 'eq', true) })] });
  const e = engine(def), offered = e.draw({ actor: 'a', partner: 'b' });
  assert.deepEqual(e.inspect().world.pairs, {});
  assert.throws(() => e.draw(), /pending/); assert.throws(() => e.setQuality('table', 'x', true), /offer/);
  assert.equal(e.complete('stale'), false); assert.equal(e.complete(offered.token), true); assert.equal(e.complete(offered.token), false);
  const w = e.inspect().world;
  assert.equal(w.players.a.qualities.points, 3); assert.equal(w.players.b.qualities.ready, true);
  assert.deepEqual(w.pairs[pairKey('b', 'a')].steps, ['hello']);
  assert.equal(w.table.rounds, 1); assert.equal(w.session.opened, true); assert.equal(finish(e).id, 'later');
  assert.notEqual(pairKey('a|b', 'c'), pairKey('a', 'b|c'));
  const skipped = engine(def), r = skipped.draw({ actor: 'a', partner: 'b' });
  assert(skipped.skip(r.token)); assert(!skipped.skip(r.token));
  assert.deepEqual(skipped.inspect().world.session, {}); assert.equal(skipped.draw().reason, 'exhausted');
});

test('type errors and numeric overflow roll back all effects', () => {
  for (const existing of ['wrong', Number.MAX_VALUE]) {
    const e = engine(definition({ cards: [card('bad', { effects: [{ scope: 'table', key: 'before', op: 'set', value: true },
      { scope: 'table', key: 'count', op: 'add', value: Number.MAX_VALUE }] })] }), { table: { count: existing } });
    const r = e.draw(); assert.throws(() => e.complete(r.token));
    assert.deepEqual(e.inspect().world.table, { count: existing }); assert.equal(e.inspect().pending.token, r.token);
    assert(e.skip(r.token));
  }
});

test('phase dwell is inclusive, completion controlled, and prerequisites gate graph edges', () => {
  const def = definition({ start: 'start', phases: [
    { id: 'start', dwell: [2, 4], next: [{ to: 'locked' }] },
    { id: 'locked', prerequisites: ['start'], when: predicate('session', 'key', 'eq', true), dwell: [1, 1], next: [{ to: 'end' }] },
    { id: 'end', dwell: [1, 1], terminal: true },
  ], cards: Array.from({ length: 12 }, (_, i) => card(`c${i}`)) });
  const dwell = new Set();
  for (let i = 0; i < 40; i++) {
    const e = engine(def, { seed: i }); dwell.add(e.inspect().dwell);
    const skipped = e.draw(); e.skip(skipped.token); assert.equal(e.inspect().completed, 0);
    for (let n = 0; n < e.inspect().dwell; n++) assert.equal(finish(e).phase, 'start');
    assert.deepEqual(e.draw(), { status: 'dead-end', reason: 'blocked-transition' });
    e.setQuality('session', 'key', true);
    assert.equal(finish(e).phase, 'locked'); assert.deepEqual(e.draw(), { status: 'done' });
  }
  assert.deepEqual([...dwell].sort(), [2, 3, 4]);
});

test('heat interpolation, hard breather intervals and no unsafe breather fallback', () => {
  assert.equal(targetHeat([[0, 0], [10, 100], [20, 0]], 5), 50);
  assert.equal(targetHeat([[0, 0], [10, 100]], 100), 100);
  const def = definition({ repeat: 'cycle', cards: [card('h1', { heat: 60 }), card('h2', { heat: 60 }), card('pause', { heat: 5, breather: true, weight: 0.001 })],
    director: { curve: [[0, 60]], breatherEvery: 2, breatherHeat: 10 } });
  const e = engine(def);
  for (let i = 0; i < 20; i++) { const before = e.inspect().sinceBreather; const r = finish(e); if (before >= 2) assert(r.breather); }
  const missing = engine({ ...def, cards: def.cards.slice(0, 2) }); finish(missing); finish(missing);
  assert.equal(missing.draw().reason, 'breather-required');
});

test('strict no repeats, normalized duplicate lines, exhaustion and explicit cycle policy', () => {
  const e = engine(definition({ cards: [card('a', { text: 'SAME   text' }), card('b', { text: 'same text' }), card('c')] }));
  const ids = [finish(e).text, finish(e).text]; assert.equal(ids.length, new Set(ids).size);
  assert(['exhausted', 'text-exhausted'].includes(e.draw().reason));
  const cycle = engine(definition({ repeat: 'cycle' })); let previous;
  for (let i = 0; i < 60; i++) { const r = finish(cycle); assert.notEqual(r.id, previous); previous = r.id; }
  const duplicateTemplates = engine(definition({ repeat: 'cycle', cards: [{ id: 'x', template: 'Same' }, { id: 'y', template: 'Same' }] }));
  for (let i = 0; i < 5; i++) assert.equal(finish(duplicateTemplates).text, 'Same');
  const single = engine(definition({ repeat: 'cycle', cards: [card('single')] }));
  for (let i = 0; i < 4; i++) assert.equal(finish(single).id, 'single');
});

test('authored weights remain random rather than always selecting the maximum', () => {
  const def = definition({ cards: [card('heavy', { weight: 9 }), card('light', { weight: 1 })] });
  let heavy = 0;
  for (let i = 0; i < 1000; i++) heavy += engine(def, { seed: `weighted-${i}` }).draw().id === 'heavy';
  assert(heavy > 820 && heavy < 970, `heavy samples: ${heavy}`);
});

test('recency penalties and novelty bonuses prefer a fresh topic statistically', () => {
  let fresh = 0;
  for (let i = 0; i < 400; i++) {
    const e = engine(definition({ cards: [card('start', { tags: ['old', 'start'] }), card('old', { tags: ['old'] }), card('fresh', { tags: ['new'] })],
      director: { curve: [[0, 0]], noveltyBonus: 5, recencyWindow: 3 } }), { seed: `novel-${i}` });
    finish(e, { tagsAll: ['start'] }); fresh += e.draw({ excludeIds: ['start'] }).id === 'fresh';
  }
  assert(fresh > 330, `fresh samples: ${fresh}`);
});

test('player turns remain fair across seeds and pair assignments vary', () => {
  const def = definition({ cards: Array.from({ length: 24 }, (_, i) => card(`p${i}`, { roles: 1 })) });
  const assignments = new Set();
  for (let i = 0; i < 50; i++) {
    const e = engine(def, { seed: i });
    for (let n = 0; n < 24; n++) finish(e);
    assert.deepEqual(Object.values(e.inspect().exposure), [6, 6, 6, 6]);
    assignments.add(e.inspect().history.map(h => h.binding.actor).join(''));
  }
  assert(assignments.size > 40);
  const pairs = engine(definition({ cards: Array.from({ length: 60 }, (_, i) => card(`pair${i}`, { roles: 2 })) }));
  for (let i = 0; i < 60; i++) { const r = finish(pairs); assert.notEqual(r.binding.actor, r.binding.partner); }
  assert(Object.keys(pairs.inspect().pairExposure).length === 6);
  assert.equal(new Set(Object.values(pairs.inspect().exposure)).size, 1);
  assert.equal(pairs.draw({ actor: 'unknown' }).reason, 'no-eligible-cards');
});

test('safe grammar, literal slots, bounded expansion, modifiers and missing slots', () => {
  const def = definition({ cards: [{ id: 'g', roles: 1, template: '{actor}: #line.capitalize#' }],
    grammar: { line: ['a #animal#'], animal: ['cat', 'dog'] } });
  const e = engine(def, { players: [{ id: 'a', name: '#animal# {partner}' }] });
  assert.match(finish(e).text, /^#animal# \{partner\}: A (cat|dog)$/);
  const huge = { a: Array(1).fill('#b#'.repeat(100)), b: ['#c#'.repeat(100)], c: ['word'] };
  assert.throws(() => expand('#a#', huge, {}, () => 0), /limit|4096/);
  const slot = engine(definition({ cards: [{ id: 'slot', template: '{custom}' }], slots: ['custom'] }));
  const before = slot.snapshot(); assert.throws(() => slot.draw(), /Missing slot/);
  assert.deepEqual(slot.snapshot(), before, 'failed expansion rolls back graph, RNG and histories');
  assert.equal(finish(slot, { slots: { custom: '<b>literal</b>' } }).text, '<b>literal</b>');
});

test('snapshot replay includes pending offer, private state, seed and content version', () => {
  const def = definition({ repeat: 'cycle', cards: [card('a', { roles: 1 }), card('b', { roles: 1 }), card('c', { roles: 1 })] });
  const a = engine(def); finish(a); const pending = a.draw();
  const saved = JSON.parse(JSON.stringify(a.snapshot())), b = createEngine(def, { snapshot: saved });
  assert.deepEqual(a.inspect(), b.inspect()); assert(b.complete(pending.token)); a.complete(pending.token);
  for (let i = 0; i < 20; i++) assert.deepEqual(finish(a), finish(b));
  assert.throws(() => createEngine({ ...def, version: '2' }, { snapshot: saved }), /mismatch/);
  assert.throws(() => createEngine(def, { snapshot: { ...saved, rng: 0 } }), /RNG/);
  const corrupt = structuredClone(saved); corrupt.state.world.table.bad = null;
  assert.throws(() => createEngine(def, { snapshot: corrupt }), /qualities/);
  const leaked = a.inspect(); leaked.world.table.changed = true;
  assert.deepEqual(a.inspect().world.table, {});
});

test('lint rejects malformed data, grammar errors, unknown fields, and unsafe keys', () => {
  const bad = [
    { schemaVersion: 2 }, { repeat: 'always' }, { start: 'missing' }, { cards: [] },
    { cards: [card('same'), card('same')] }, { cards: [card('x', { weight: -1 })] },
    { cards: [card('x', { heat: 101 })] }, { cards: [card('x', { condition: {} })] },
    { cards: [card('x', { when: { all: [] } })] }, { cards: [card('x', { when: { any: [undefined] } })] }, { cards: [card('x', { when: { not: undefined } })] },
    { cards: [card('x', { when: predicate('table', 'constructor', 'eq', 'bad') })] },
    { cards: [card('x', { when: predicate('table', 'v', 'oops', 1) })] },
    { cards: [card('x', { effects: [{ scope: 'pair', key: 'x', op: 'set', value: true }] })] },
    { phases: [{ id: 'play', dwell: [3, 1] }] }, { phases: [{ id: 'play', dwell: [1, 1], next: {} }] },
    { phases: [{ id: 'play', dwell: [1, 1], next: [{ to: 'typo' }] }] },
    { phases: [{ id: 'play', dwell: [1, 1] }, { id: 'unreachable', dwell: [1, 1] }] },
    { director: { curve: [[1, 10], [0, 20]] } }, { director: { curve: [[0, 0]], fairness: -1 } },
    { rules: [{ id: 'bad', group: 'g', tagWeights: { x: Infinity } }] },
    { cards: [{ id: 'x', template: '#missing#' }] },
    { cards: [{ id: 'x', template: '#x#' }], grammar: { x: ['#x#'] } },
    { cards: [{ id: 'x', template: '#x.unsafe#' }], grammar: { x: ['ok'] } },
    { cards: [{ id: 'x', template: '{typo}' }] }, { cards: [{ id: 'x', template: '{actor}' }] },
    { cards: [{ id: 'x', template: '#line#', roles: 1 }], grammar: { line: ['{partner}'] } }, { cards: [{ id: 'x', template: '#bad' }] },
  ];
  for (const change of bad) { const d = definition(change); assert(validateDefinition(d).length, JSON.stringify(change)); assert.throws(() => engine(d)); }
  assert(validateDefinition(null).length);
  assert.throws(() => engine(definition(), { table: { bad: NaN } }));
  assert.throws(() => engine(definition(), { players: [{ id: '__proto__', name: 'bad' }] }));
  assert.throws(() => engine().setQuality('table', '__proto__', true));
  assert.throws(() => engine().setQuality('table', 'toString', true));
  assert.throws(() => engine(definition(), { players: [{ id: 'hasOwnProperty', name: 'unsafe key' }] }));
  const tagged = engine(definition({ cards: [card('tagged', { tags: ['toString'] })], rules: [{ id: 'safe', group: 'g', tagWeights: { other: 2 } }] }));
  assert.equal(finish(tagged).id, 'tagged', 'tag weights never read inherited properties');
  assert.equal({}.polluted, undefined);
});

test('validators are pluggable and exceptions fail closed', () => {
  assert.throws(() => engine(definition(), { validators: [d => d.cards.some(c => !c.tags) ? ['Tags are required here'] : []] }), /Tags are required/);
  assert.throws(() => engine(definition(), { validators: [() => { throw new Error('broken'); }] }), /Validator failed: broken/);
  assert.throws(() => engine(definition(), { validators: [() => null] }), /string\[\]/);
});

test('locale adapter deduplicates strings, keeps literal braces and supports JSON metadata', () => {
  const cards = cardsFromRows(['same', ' SAME ', '{literal}', { text: 'later', weight: 3, tags: ['extra'] }], 'bank', ['deck']);
  assert.equal(cards.length, 3); assert.equal(cards[2].weight, 3); assert.deepEqual(cards[2].tags, ['deck', 'extra']);
  const e = createCardGame('adapter', cards, { seed: 'adapter' });
  const rows = Array.from({ length: 3 }, () => dealText(e)); assert(rows.includes('{literal}'));
  assert.notEqual(dealText(e), rows.at(-1));
});

test('simulator has reproducible metrics, path variety, fair exposure and no dead ends', () => {
  const demo = require('../../../docs/engine/examples/party.json');
  const report = simulate(demo, { sessions: 100, turns: 40, seed: 'baseline' });
  assert.deepEqual(report, simulate(demo, { sessions: 100, turns: 40, seed: 'baseline' }));
  assert.equal(report.completed, 100); assert.deepEqual(report.deadEnds, {}); assert.equal(report.variety.repeats, 0);
  assert.equal(report.variety.uniqueOrderedPaths, 100); assert.equal(report.variety.uniquePhasePaths, 2);
  assert(report.variety.meanJaccardSimilarity < 0.4); assert(report.variety.meanPositionSimilarity < 0.15);
  assert(report.pacing.meanAbsoluteHeatError < 15); assert(report.fairness.maxPlayerExposureSpread <= 1);
  const dead = simulate(definition({ cards: [card('one')] }), { sessions: 3, turns: 4 });
  assert.equal(dead.deadEnds.exhausted, 3); assert.equal(dead.completed, 0);
  assert.throws(() => simulate(demo, { sessions: 0 }));
});

test('pair prerequisites use only completed facts for the requested pair', () => {
  const e = engine(definition({ cards: [card('hello', { roles: 2, tags: ['first'], effects: [{ scope: 'pair', key: 'introduced', op: 'set', value: true }] }),
    card('followup', { roles: 2, tags: ['next'], when: predicate('pair', 'introduced', 'eq', true) })] }));
  assert.equal(e.draw({ actor: 'a', partner: 'b', tagsAll: ['next'] }).reason, 'no-eligible-cards');
  finish(e, { actor: 'a', partner: 'b', tagsAll: ['first'] });
  assert.equal(e.draw({ actor: 'a', partner: 'c', tagsAll: ['next'] }).reason, 'no-eligible-cards');
  assert.equal(finish(e, { actor: 'b', partner: 'a', tagsAll: ['next'] }).id, 'followup');
});

test('CLI distinguishes successful simulations, dead ends and invalid arguments', () => {
  const { spawnSync } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-flow-cli-'));
  try {
    const script = path.join(__dirname, '../scripts/simulate-flow.js'), content = path.join(dir, 'content.json');
    fs.writeFileSync(content, JSON.stringify(definition({ cards: [card('single')] })));
    const dead = spawnSync(process.execPath, [script, '--content', content, '--sessions', '2', '--turns', '3'], { encoding: 'utf8' });
    assert.equal(dead.status, 2); assert.equal(JSON.parse(dead.stdout).deadEnds.exhausted, 2);
    const ok = spawnSync(process.execPath, [script, '--sessions', '2'], { cwd: dir, encoding: 'utf8' });
    assert.equal(ok.status, 0); assert.equal(JSON.parse(ok.stdout).completed, 2);
    const bad = spawnSync(process.execPath, [script, '--sessions', 'oops'], { encoding: 'utf8' });
    assert.equal(bad.status, 1); assert.match(bad.stderr, /Invalid simulation limits/);
    assert.equal(spawnSync(process.execPath, [script, '--unknown', '1']).status, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
