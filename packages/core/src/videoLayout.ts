export type Tile = { x: number; y: number; width: number; height: number };
export type VideoPack = { tiles: Tile[]; area: number; smallest: number };
const GAP = 10;
const LABEL = 26;
/** Camera metadata can be absent during join, rotation, or camera-off. */
export function normalizeVideoRatio(ratio?: number): number {
  return ratio && Number.isFinite(ratio) && ratio >= 0.2 && ratio <= 5 ? ratio : 1;
}

// Enumerate normal squad sizes exactly; larger rosters use bounded candidates.
// Never let a malformed/expanded roster turn layout into exponential work.
function rowOptions(count: number): number[][][] {
  if (count > 8) {
    return Array.from({ length: Math.min(count, 16) }, (_, rowIndex) => {
      const rowCount = rowIndex + 1;
      const rows: number[][] = Array.from({ length: rowCount }, () => []);
      for (let i = 0; i < count; i++) rows[Math.min(rowCount - 1, Math.floor(i * rowCount / count))].push(i);
      return rows;
    });
  }
  return Array.from({ length: 2 ** Math.max(0, count - 1) }, (_, mask) => {
    const rows: number[][] = [[]];
    for (let i = 0; i < count; i++) {
      rows[rows.length - 1].push(i);
      if (i < count - 1 && mask & (1 << i)) rows.push([]);
    }
    return rows;
  });
}

// Try every row break without changing participant order. Fit each row using
// the actual camera proportions; no frame is stretched to fill spare space.
function packRows(ratios: number[], width: number, height: number): VideoPack {
  if (!ratios.length || width <= 0 || height <= 0)
    return { tiles: [], area: 0, smallest: 0 };
  let best: VideoPack = { tiles: [], area: 0, smallest: 0 };
  let bestScore = -Infinity;
  // Keep the approved 10px gutter unless the box cannot hold the gaps.
  const gap = Math.min(GAP, width / Math.max(1, ratios.length - 1), height / Math.max(1, ratios.length - 1));
  for (const rows of rowOptions(ratios.length)) {
    const naturalHeights = rows.map(
      (row) =>
        Math.max(0, width - gap * (row.length - 1)) /
        row.reduce((sum, i) => sum + ratios[i], 0),
    );
    // Preserve the approved packer's balance between short and tall rows.
    if (Math.max(...naturalHeights) / Math.max(1, Math.min(...naturalHeights)) > 1.8) continue;
    const scale = Math.min(
      1,
      Math.max(0, height - gap * (rows.length - 1)) /
        naturalHeights.reduce((a, b) => a + b, 0),
    );
    const usedHeight =
      naturalHeights.reduce((a, b) => a + b * scale, 0) +
      gap * (rows.length - 1);
    const tiles: Tile[] = [];
    let y = (height - usedHeight) / 2;
    let area = 0;
    let smallest = Infinity;
    rows.forEach((row, rowIndex) => {
      const h = naturalHeights[rowIndex] * scale;
      const usedWidth =
        row.reduce((sum, i) => sum + ratios[i] * h, 0) + gap * (row.length - 1);
      let x = (width - usedWidth) / 2;
      row.forEach((i) => {
        const w = ratios[i] * h;
        tiles[i] = { x, y, width: w, height: h };
        area += w * h;
        smallest = Math.min(smallest, w, h);
        x += w + gap;
      });
      y += h + gap;
    });
    const smallestArea = Math.min(
      ...tiles.map((tile) => tile.width * tile.height),
    );
    const fairness = smallestArea / Math.max(1, area / ratios.length);
    const score = area * fairness ** 0.7 * Math.min(1, smallest / 80);
    if (score > bestScore) {
      best = { tiles, area, smallest };
      bestScore = score;
    }
  }
  return best;
}

function packScore(pack: VideoPack) {
  if (!pack.tiles.length) return 0;
  const minArea = Math.min(
    ...pack.tiles.map((tile) => tile.width * tile.height),
  );
  return (
    pack.area *
    (minArea / Math.max(1, pack.area / pack.tiles.length)) ** 0.7 *
    Math.min(1, pack.smallest / 80)
  );
}
export function packVideoFeeds(
  ratios: number[],
  width: number,
  height: number,
): VideoPack {
  ratios = ratios.map(normalizeVideoRatio);
  width = Number.isFinite(width) ? Math.max(0, width) : 0;
  height = Number.isFinite(height) ? Math.max(0, height) : 0;
  const rows = packRows(ratios, width, height);
  const columns = packRows(
    ratios.map((ratio) => 1 / ratio),
    height,
    width,
  );
  if (packScore(columns) <= packScore(rows)) return rows;
  return {
    ...columns,
    tiles: columns.tiles.map((tile) => ({
      x: tile.y,
      y: tile.x,
      width: tile.height,
      height: tile.width,
    })),
  };
}

/** The full camera fits inside a calm frame, without cropping or stretching. */
export function fitVideoWithinFrame(ratio: number, width: number, height: number): Tile {
  ratio = normalizeVideoRatio(ratio);
  const h = Math.max(0, Math.min(height, width / ratio));
  const w = h * ratio;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

/** Equal frames keep people equally prominent even with mixed camera shapes. */
export function packBalancedVideoFrames(ratios: number[], width: number, height: number): VideoPack {
  if (!ratios.length || width <= 0 || height <= 0) return { tiles: [], area: 0, smallest: 0 };
  const count = ratios.length;
  const gap = Math.min(GAP, width / (count * 2), height / (count * 2));
  let best: VideoPack = { tiles: [], area: 0, smallest: 0 };
  let bestScore = -Infinity;
  const maxColumns = Math.min(count, Math.max(8, Math.ceil(Math.sqrt(count) * 2)));
  for (let columns = 1; columns <= maxColumns; columns++) {
    const rows = Math.ceil(count / columns);
    for (const frameRatio of [0.8, 1, 4 / 3, 16 / 9]) {
      const tileHeight = Math.max(0, Math.min((height - gap * (rows - 1)) / rows,
        (width - gap * (columns - 1)) / columns / frameRatio));
      const tileWidth = tileHeight * frameRatio;
      const usedHeight = rows * tileHeight + (rows - 1) * gap;
      const tiles = ratios.map((ratio, index) => {
        const row = Math.floor(index / columns);
        const rowLength = Math.min(columns, count - row * columns);
        const rowWidth = rowLength * tileWidth + (rowLength - 1) * gap;
        return { x: (width - rowWidth) / 2 + (index % columns) * (tileWidth + gap),
          y: (height - usedHeight) / 2 + row * (tileHeight + gap), width: tileWidth, height: tileHeight };
      });
      const area = count * tileWidth * tileHeight;
      const visibleArea = ratios.reduce((sum, ratio) => {
        const fit = fitVideoWithinFrame(ratio, tileWidth, tileHeight);
        return sum + fit.width * fit.height;
      }, 0);
      const smallest = Math.min(tileWidth, tileHeight);
      const score = (visibleArea * 0.7 + area * 0.3) * Math.min(1, smallest / 90);
      if (score > bestScore) { bestScore = score; best = { tiles, area, smallest }; }
    }
  }
  return best;
}

export function arrangeVideoCall(
  mine: number[],
  theirs: number[],
  width: number,
  height: number,
) {
  width = Number.isFinite(width) ? Math.max(0, width) : 0;
  height = Number.isFinite(height) ? Math.max(0, height) : 0;
  const label = Math.min(LABEL, height / 4);
  const gap = Math.min(GAP, width / 4, height / 4);
  if (!mine.length || !theirs.length) {
    const box = { width, height };
    return { stacked: false, label, gap,
      mine: { ...box, ...packVideoFeeds(mine, width, Math.max(0, height - label)) },
      theirs: { ...box, ...packVideoFeeds(theirs, width, Math.max(0, height - label)) },
    };
  }
  const stacked = width < 700 && height > width * 0.65;
  let bestScore = -Infinity;
  let result = null;
  // Give each squad enough space for its actual feeds, not a fixed 70/30 split.
  for (let share = 0.25; share <= 0.751; share += 0.025) {
    const usable = Math.max(0, (stacked ? height : width) - gap);
    const theirSize = usable * share;
    const mySize = usable - theirSize;
    const theirBox = {
      width: stacked ? width : theirSize,
      height: stacked ? theirSize : height,
    };
    const myBox = {
      width: stacked ? width : mySize,
      height: stacked ? mySize : height,
    };
    const theirPack = packVideoFeeds(
      theirs,
      theirBox.width,
      Math.max(0, theirBox.height - label),
    );
    const myPack = packVideoFeeds(
      mine,
      myBox.width,
      Math.max(0, myBox.height - label),
    );
    const totalArea = theirPack.area + myPack.area;
    const smallest = Math.min(
      myPack.smallest,
      theirs.length ? theirPack.smallest : myPack.smallest,
    );
    const score =
      totalArea * (0.6 + 0.4 * Math.min(1, smallest / 100)) -
      Math.abs(share - 0.5) * 50;
    if (score > bestScore) {
      bestScore = score;
      result = {
        stacked, label, gap,
        mine: { ...myBox, ...myPack },
        theirs: { ...theirBox, ...theirPack },
      };
    }
  }
  if (result?.stacked) {
    for (const group of [result.mine, result.theirs]) {
      if (!group.tiles.length) continue;
      const top = Math.min(...group.tiles.map(tile => tile.y));
      const bottom = Math.max(...group.tiles.map(tile => tile.y + tile.height));
      group.height = bottom - top + label;
      group.tiles = group.tiles.map(tile => ({ ...tile, y: tile.y - top }));
    }
  }
  return result!;
}
