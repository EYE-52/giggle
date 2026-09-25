const assert = require('node:assert/strict');
const test = require('node:test');

let focus;
test('focus layout module loads', async () => {
  focus = await import('../src/focusLayout.ts');
  assert.equal(typeof focus.arrangeFocusCall, 'function');
});

const STAGES = [[1440, 900], [1280, 720], [820, 1180], [390, 844], [844, 390], [320, 400]];
const people = (side, n, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: `${side}-${i}`, ...(extra[i] || {}) }));
const EPS = 0.5;

function assertSane(layout, width, height, expected) {
  assert.equal(layout.tiles.length, expected);
  for (const t of layout.tiles) {
    for (const v of [t.x, t.y, t.width, t.height]) assert.equal(Number.isFinite(v), true);
    assert.ok(t.x >= -EPS && t.y >= -EPS, `tile ${t.id} starts on stage`);
    assert.ok(t.x + t.width <= width + EPS && t.y + t.height <= height + EPS, `tile ${t.id} ends on stage`);
  }
  const ts = layout.tiles;
  for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
    const a = ts[i], b = ts[j];
    const overlap = a.x < b.x + b.width - EPS && b.x < a.x + a.width - EPS && a.y < b.y + b.height - EPS && b.y < a.y + a.height - EPS;
    assert.equal(overlap, false, `${a.id} overlaps ${b.id}`);
  }
}

test('every roster from 1v1 to 8v8 fits every stage without overlap', () => {
  for (const [w, h] of STAGES) for (let m = 0; m <= 8; m++) for (let t = 0; t <= 8; t++) {
    if (!m && !t) continue;
    assertSane(focus.arrangeFocusCall(people('mine', m), people('theirs', t), w, h), w, h, m + t);
  }
});

test('without zoom, tiles inside a squad are the same size', () => {
  const layout = focus.arrangeFocusCall(people('mine', 4), people('theirs', 4), 1440, 900);
  for (const side of ['mine', 'theirs']) {
    const areas = layout.tiles.filter(t => t.side === side).map(t => t.width * t.height);
    assert.ok(Math.max(...areas) / Math.min(...areas) < 1.05, `${side} tiles differ: ${areas}`);
  }
});

test('zooming someone makes them bigger and everyone else re-flows', () => {
  const base = focus.arrangeFocusCall(people('mine', 4), people('theirs', 4), 1440, 900);
  const zoomed = focus.arrangeFocusCall(people('mine', 4), people('theirs', 4, { 1: { weight: 3 } }), 1440, 900);
  const area = (l, id) => { const t = l.tiles.find(x => x.id === id); return t.width * t.height; };
  assert.ok(area(zoomed, 'theirs-1') > area(base, 'theirs-1') * 1.6, 'zoomed tile grew');
  assert.ok(area(zoomed, 'theirs-0') < area(base, 'theirs-0'), 'others in that squad shrank');
  assertSane(zoomed, 1440, 900, 8);
});

test('a pinned person keeps their exact size whatever happens to the others', () => {
  const pin = { pinned: { width: 420, height: 300 } };
  const sizes = [];
  for (const zoom of [1, 2, 4]) {
    const theirs = people('theirs', 5, { 0: pin, 2: { weight: zoom }, 3: { weight: zoom } });
    const layout = focus.arrangeFocusCall(people('mine', 3, { 1: { weight: zoom } }), theirs, 1440, 900);
    assertSane(layout, 1440, 900, 8);
    const t = layout.tiles.find(x => x.id === 'theirs-0');
    assert.equal(t.pinned, true);
    sizes.push([Math.round(t.width), Math.round(t.height)]);
  }
  assert.deepEqual(sizes, [[420, 300], [420, 300], [420, 300]]);
});

test('a pinned size that cannot fit shrinks instead of spilling off stage', () => {
  const layout = focus.arrangeFocusCall(people('mine', 2), people('theirs', 3, { 0: { pinned: { width: 2000, height: 2000 } } }), 390, 844);
  assertSane(layout, 390, 844, 5);
});

test('zoom never squeezes anyone below the minimum tile size when it can be avoided', () => {
  const layout = focus.arrangeFocusCall(people('mine', 8, { 0: { weight: 4 } }), people('theirs', 8), 390, 844, { minTile: 60 });
  assertSane(layout, 390, 844, 16);
  for (const t of layout.tiles) assert.ok(Math.min(t.width, t.height) >= 40, `${t.id} is ${t.width}x${t.height}`);
});

test('order is kept and nothing is NaN on tiny or broken stages', () => {
  const layout = focus.arrangeFocusCall(people('mine', 3), people('theirs', 2), 1440, 900);
  assert.deepEqual(layout.tiles.filter(t => t.side === 'mine').map(t => t.id), ['mine-0', 'mine-1', 'mine-2']);
  for (const [w, h] of [[0, 0], [NaN, 500], [20, 20]]) {
    const l = focus.arrangeFocusCall(people('mine', 4), people('theirs', 4, { 0: { weight: NaN } }), w, h);
    for (const t of l.tiles) for (const v of [t.x, t.y, t.width, t.height]) assert.equal(Number.isFinite(v), true);
  }
});

test('on a phone, a pinned person stays the same size when the other squad grows', () => {
  const sizes = [];
  for (const zoom of [1, 2, 4]) {
    const layout = focus.arrangeFocusCall(people('mine', 3, { 2: { pinned: { width: 121, height: 228 } } }), people('theirs', 5, { 2: { weight: zoom }, 4: { weight: zoom } }), 390, 844);
    assertSane(layout, 390, 844, 8);
    const t = layout.tiles.find(x => x.id === 'mine-2');
    sizes.push([Math.round(t.width), Math.round(t.height)]);
  }
  assert.deepEqual(sizes, [[121, 228], [121, 228], [121, 228]]);
});

test('a zoomed person is never smaller than an unzoomed squadmate, even beside a pin', () => {
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    const layout = focus.arrangeFocusCall(people('mine', 3, { 0: { weight: 4 }, 2: { pinned: { width: 121, height: 228 } } }), people('theirs', 5), w, h);
    const area = id => { const t = layout.tiles.find(x => x.id === id); return t.width * t.height; };
    assert.ok(area('mine-0') >= area('mine-1'), `${w}x${h}: zoomed ${area('mine-0')} < unzoomed ${area('mine-1')}`);
  }
});
