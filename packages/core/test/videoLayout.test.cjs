const assert = require('node:assert/strict');
const test = require('node:test');

let layout;
test('video layout module loads', async () => {
  layout = await import('../src/videoLayout.ts');
  assert.equal(typeof layout.arrangeVideoCall, 'function');
});

const EPSILON = 1e-7;
const STAGES = [
  [320, 400], [375, 420], [390, 560], [667, 240],
  [768, 800], [1366, 600], [1920, 850],
];

function assertFiniteTile(tile) {
  for (const value of [tile.x, tile.y, tile.width, tile.height]) assert.equal(Number.isFinite(value), true);
  assert.equal(tile.width >= -EPSILON, true);
  assert.equal(tile.height >= -EPSILON, true);
}

function assertPack(pack, width, height, expectedRatios, exactFrameRatio = false) {
  assert.equal(pack.tiles.length, expectedRatios.length);
  for (const tile of pack.tiles) {
    assertFiniteTile(tile);
    assert.equal(tile.x >= -EPSILON, true);
    assert.equal(tile.y >= -EPSILON, true);
    assert.equal(tile.x + tile.width <= width + EPSILON, true);
    assert.equal(tile.y + tile.height <= height + EPSILON, true);
  }
  for (let i = 0; i < pack.tiles.length; i += 1) {
    const tile = pack.tiles[i];
    if (tile.width > EPSILON && tile.height > EPSILON) {
      if (exactFrameRatio) assert.ok(Math.abs(tile.width / tile.height - expectedRatios[i]) < 1e-6);
      else {
        // Frames are balanced; the actual camera remains fully visible inside.
        assert.ok(tile.width / tile.height >= 0.8 - EPSILON && tile.width / tile.height <= 16 / 9 + EPSILON);
        const media = layout.fitVideoWithinFrame(expectedRatios[i], tile.width, tile.height);
        assert.ok(Math.abs(media.width / media.height - expectedRatios[i]) < 1e-6);
        assert.ok(media.width <= tile.width + EPSILON && media.height <= tile.height + EPSILON);
        assert.ok(Math.abs(tile.width * tile.height - pack.tiles[0].width * pack.tiles[0].height) < 1e-6);
      }
    }
    for (let j = i + 1; j < pack.tiles.length; j += 1) {
      const other = pack.tiles[j];
      const overlapWidth = Math.min(tile.x + tile.width, other.x + other.width) - Math.max(tile.x, other.x);
      const overlapHeight = Math.min(tile.y + tile.height, other.y + other.height) - Math.max(tile.y, other.y);
      assert.equal(overlapWidth > EPSILON && overlapHeight > EPSILON, false);
    }
  }
}

test('retains the approved camera-shaped grid with ordered people, bounds, and no overlap', { concurrency: false }, () => {
  const ratios = [0.75, 1, 1.5, 0.5, 2, 1.25, 0.8, 1.8];
  for (const [width, height] of STAGES) {
    for (let mineCount = 1; mineCount <= 8; mineCount += 1) {
      for (let theirsCount = 0; theirsCount <= 8; theirsCount += 1) {
        const mine = ratios.slice(0, mineCount);
        const theirs = ratios.slice(0, theirsCount).map((ratio, index) => ratio + index * 0.01);
        const result = layout.arrangeVideoCall(mine, theirs, width, height);
        assert.equal(result.mine.tiles.length, mineCount);
        assert.equal(result.theirs.tiles.length, theirsCount);
        assertPack(result.mine, result.mine.width, result.mine.height - result.label, mine, true);
        assertPack(result.theirs, result.theirs.width, result.theirs.height - result.label, theirs, true);
        if (mineCount && theirsCount) {
          if (result.stacked) {
            assert.equal(result.mine.height + result.theirs.height + Math.min(10, height / 4) <= height + EPSILON, true);
          } else {
            assert.equal(result.mine.width + result.theirs.width + Math.min(10, width / 4) <= width + EPSILON, true);
          }
        }
        assert.equal(Number.isFinite(result.label), true);
        assert.equal(result.label >= 0, true);
      }
    }
  }
});

test('a single squad gets the full stage box when the other squad is empty', () => {
  const result = layout.arrangeVideoCall([1, 1.5], [], 667, 240);
  assert.deepEqual(
    { width: result.mine.width, height: result.mine.height },
    { width: 667, height: 240 },
  );
  assert.deepEqual(
    { width: result.theirs.width, height: result.theirs.height },
    { width: 667, height: 240 },
  );
});

test('normalizes camera-off and invalid ratios and never creates NaN for tiny stages', () => {
  for (const ratio of [undefined, 0, -1, 0.1, 6, Infinity, NaN]) {
    assert.equal(layout.normalizeVideoRatio(ratio), 1);
  }
  for (const [width, height] of [[0, 0], [1, 1], [1, 20], [20, 1], [NaN, Infinity]]) {
    const result = layout.arrangeVideoCall([undefined, 0, -2], [Infinity], width, height);
    for (const group of [result.mine, result.theirs]) {
      assert.equal(Number.isFinite(group.width), true);
      assert.equal(Number.isFinite(group.height), true);
      for (const tile of group.tiles) assertFiniteTile(tile);
    }
  }
});

test('large rosters retain every participant with bounded work', () => {
  const mine = Array.from({ length: 1000 }, (_, index) => 0.5 + (index % 7) * 0.25);
  const theirs = Array.from({ length: 1000 }, (_, index) => 0.75 + (index % 5) * 0.2);
  const started = Date.now();
  const result = layout.arrangeVideoCall(mine, theirs, 768, 800);
  assert.ok(Date.now() - started < 2000);
  assert.equal(result.mine.tiles.length, mine.length);
  assert.equal(result.theirs.tiles.length, theirs.length);
  for (const group of [result.mine, result.theirs]) {
    for (const tile of group.tiles) assertFiniteTile(tile);
  }
});

test('raw feed packing still preserves ratios when exact frame geometry is needed', () => {
  const ratios = [9 / 16, 16 / 9, 1];
  assertPack(layout.packVideoFeeds(ratios, 375, 420), 375, 420, ratios, true);
});
