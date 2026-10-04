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

test('mixed cameras in a full Plus call keep phone tile targets at least 44px', () => {
  const aspects = [16 / 9, 9 / 16, null, 4 / 3];
  const roster = side => Array.from({ length: 8 }, (_, i) => ({ id: `${side}-${i}`, aspect: aspects[i % 4], self: side === 'mine' && i === 0 }));
  // 320×568 viewport minus the call preview's 10px inset on each edge.
  const layout = focus.arrangeFocusCall(roster('mine'), roster('theirs'), 300, 548);
  assertSane(layout, 300, 548, 16);
  for (const tile of layout.tiles) assert.ok(Math.min(tile.width, tile.height) >= 44, `${tile.id} is ${tile.width}×${tile.height}`);
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

test('zooming never turns a squadmate into a sliver', () => {
  for (const [w, h] of [[1440, 900], [1280, 720], [390, 844], [844, 390]]) for (const n of [2, 3, 4, 5, 8]) for (const target of [0, 1, n - 1]) {
    const layout = focus.arrangeFocusCall(people('mine', 3), people('theirs', n, { [target]: { weight: 4 } }), w, h);
    for (const t of layout.tiles) {
      const aspect = t.width / t.height;
      // camera-off tiles hold only a character: tall or wide is fine, a strip is not
      assert.ok(aspect < 3.5 && aspect > 0.28, `${w}x${h} n=${n} zoom ${target}: ${t.id} is ${Math.round(t.width)}x${Math.round(t.height)}`);
    }
  }
});

test('a pinned squad never leaves a dead sliver beside the pin', () => {
  const layout = focus.arrangeFocusCall(people('mine', 3, { 1: { pinned: { width: 420, height: 300 } } }), people('theirs', 4, { 1: { weight: 4 } }), 1440, 900);
  const mine = layout.tiles.filter(t => t.side === 'mine');
  const minX = Math.min(...mine.map(t => t.x)), maxX = Math.max(...mine.map(t => t.x + t.width));
  assert.ok(maxX - minX <= 420 + 1, `your squad spans ${Math.round(maxX - minX)}px for a 420px pin`);
});

test('camera shapes: tiles fill the squad without holes and follow each camera', () => {
  const L = 16 / 9, T = 4 / 3, P = 9 / 16;
  const layout = focus.arrangeFocusCall(
    [{ id: 'you', aspect: L, self: true }, { id: 'max', aspect: T }, { id: 'zoe', aspect: P }],
    [{ id: 'ben', aspect: P }, { id: 'chidi', aspect: L }],
    1440, 900);
  assertSane(layout, 1440, 900, 5);
  // no holes: the tiles cover the stage apart from the gaps
  const covered = layout.tiles.reduce((sum, t) => sum + t.width * t.height, 0) / (1440 * 900);
  assert.ok(covered > 0.97, `tiles cover ${Math.round(covered * 100)}% of the stage`);
  // a portrait phone gets a portrait tile and a laptop a landscape one
  const zoe = layout.tiles.find(t => t.id === 'zoe'), max = layout.tiles.find(t => t.id === 'max');
  assert.ok(zoe.width / zoe.height < 0.8, `portrait camera got ${Math.round(zoe.width)}x${Math.round(zoe.height)}`);
  assert.ok(max.width / max.height > 1.05, `4:3 camera got ${Math.round(max.width)}x${Math.round(max.height)}`);
  for (const t of layout.tiles) {
    const aspect = { you: L, max: T, zoe: P, ben: P, chidi: L }[t.id];
    const crop = focus.videoCrop(t.width, t.height, aspect);
    assert.ok(crop <= focus.CROP_LIMIT || t.id === 'ben', `${t.id} loses ${Math.round(crop * 100)}% of their video`);
  }
});

test('your own tile is never the biggest', () => {
  for (const [w, h] of [[1440, 900], [390, 844], [1280, 720]]) {
    const layout = focus.arrangeFocusCall([{ id: 'you', self: true }, { id: 'm1' }], [{ id: 't0' }, { id: 't1' }], w, h);
    const area = id => { const t = layout.tiles.find(x => x.id === id); return t.width * t.height; };
    assert.ok(area('you') <= Math.max(area('t0'), area('t1'), area('m1')), `${w}x${h}: your tile is the biggest`);
  }
});

test('zooming a camera-off person makes them clearly bigger', () => {
  const mine = [{ id: 'm0', self: true }, { id: 'm1' }];
  const before = focus.arrangeFocusCall(mine, [{ id: 't0' }, { id: 't1' }], 1440, 900).tiles.find(t => t.id === 't0');
  const after = focus.arrangeFocusCall(mine, [{ id: 't0', weight: 2 }, { id: 't1' }], 1440, 900).tiles.find(t => t.id === 't0');
  assert.ok(after.width * after.height > before.width * before.height * 1.25, `${Math.round(before.width)}x${Math.round(before.height)} -> ${Math.round(after.width)}x${Math.round(after.height)}`);
});
