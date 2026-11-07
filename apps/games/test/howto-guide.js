'use strict';
// manifest.guide: validation limits, registry exposure, and how-to rendering.
const assert = require('node:assert/strict');
const { validateManifest } = require('../games/_validate');
const registry = require('../games/registry');

const def = guide => ({ id: 'guide-check', manifest: { guide } });
const ok = guide => validateManifest(def(guide)).ok;

assert.equal(ok({ goal: 'Win.' }), true, 'a goal alone is enough');
assert.equal(ok({ goal: 'Win.', controls: [{ keys: ['Space'], touch: 'Tap', does: 'Fire' }], tips: ['Short tip.'] }), true);
assert.equal(ok({}), false, 'goal is required');
assert.equal(ok({ goal: 'x'.repeat(91) }), false, 'goal is one glanceable line');
assert.equal(ok({ goal: 'Win.', controls: [{ does: 'Fire' }] }), false, 'a control needs keys or touch');
assert.equal(ok({ goal: 'Win.', controls: [{ keys: [], does: 'Fire' }] }), false, 'an empty key list is not a control');
assert.equal(ok({ goal: 'Win.', controls: [{ keys: ['A', 'B', 'C', 'D', 'E'], does: 'Too many' }] }), false);
assert.equal(ok({ goal: 'Win.', controls: Array(7).fill({ keys: ['A'], does: 'x' }) }), false);
assert.equal(ok({ goal: 'Win.', tips: Array(6).fill('tip') }), false);
assert.equal(ok({ goal: 'Win.', tips: ['x'.repeat(81)] }), false);

// Every shipped guide is valid and reaches the catalog the client receives.
for (const game of registry.list()) {
  if (!game.guide) continue;
  assert.equal(validateManifest({ id: game.id, manifest: { guide: game.guide } }).ok, true, `${game.id} guide is valid`);
}
assert.ok(registry.list().filter(g => g.guide).length >= 40, 'catalog games carry their guides');

(async () => {
  // Minimal DOM for the renderer: games without a guide fold long rules.
  class Node {
    constructor(tag) { this.tagName = tag; this.children = []; this.className = ''; this.textContent = ''; this.attrs = {}; }
    append(...n) { this.children.push(...n); }
    replaceChildren(...n) { this.children = n; }
    get firstChild() { return this.children[0]; }
    setAttribute(k, v) { this.attrs[k] = v; }
  }
  global.document = { createElement: tag => new Node(tag) };
  const fs = require('node:fs'), path = require('node:path');
  const data = src => 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
  const stub = data('export function closeCustomizer() {}');
  const source = fs.readFileSync(path.join(__dirname, '../public/js/howto.js'), 'utf8').replace("'./customize.js'", JSON.stringify(stub));
  const { renderRules, guideGlance } = await import(data(source));

  const long = { howto: 'One. Two. Three. Four. Five.' };
  const body = new Node('div');
  renderRules(body, long);
  assert.deepEqual(body.children.map(n => n.tagName), ['p', 'p', 'details'], 'first two sentences, rest folded');
  assert.equal(body.children[2].children.length, 4, 'summary plus the three folded sentences');

  const short = new Node('div');
  renderRules(short, { howto: 'One. Two.' });
  assert.deepEqual(short.children.map(n => n.tagName), ['p', 'p'], 'short rules stay open');

  const guided = new Node('div');
  renderRules(guided, { howto: 'One. Two. Three.', guide: { goal: 'Win.', tips: ['Tip one.', 'Tip two.'] } });
  assert.deepEqual(guided.children.map(n => n.tagName), ['ul', 'details'], 'tips, then all rules folded');

  assert.equal(guideGlance({ howto: 'x' }), null, 'no guide, no glance');
  const glance = guideGlance({ guide: { goal: 'Win.', controls: [{ keys: ['W', 'S'], touch: 'Stick', does: 'Drive' }] } });
  const row = glance.children[1].children[0];
  assert.equal(row.className, 'has-touch');
  assert.deepEqual(row.children[0].children.map(k => k.textContent), ['W', 'S']);
  assert.equal(row.children[1].textContent, 'Stick');
  const touchOnly = guideGlance({ guide: { goal: 'Pick one.', controls: [{ touch: 'Tap', does: 'Choose an answer' }] } });
  assert.equal(touchOnly.children[1].children[0].className, 'has-touch is-touch-only', 'touch-only labels stay visible on every device');
  console.log('HOWTO_GUIDE_PASS: validation limits, catalog exposure, folded rules, glance markup');
})().catch(e => { console.error(e); process.exit(1); });
