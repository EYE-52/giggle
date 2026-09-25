/**
 * Focus layout: same-size tiles per squad that each viewer can reshape.
 *
 * - Every person has a weight (1 = normal). Zooming someone raises their weight
 *   (2 = twice the area, up to MAX_WEIGHT) and everyone else re-flows around them.
 * - A pinned person keeps a fixed pixel size no matter what happens to the others;
 *   the rest of their squad fills the space that is left.
 * - Video is cropped to fill each tile (the renderer uses object-fit: cover), so
 *   tiles can take whatever shape fills the screen best.
 * - Order is kept: people never jump around when someone is zoomed.
 *
 * Pure and deterministic; no DOM. The viewer's zoom/pin state is local to them.
 */

export type FocusPerson = {
  id: string;
  /** 1 = normal size; 2 = twice the area; clamped to [1, MAX_WEIGHT]. */
  weight?: number;
  /** Fixed pixel size while pinned (captured when the viewer pins). */
  pinned?: { width: number; height: number } | null;
};

export type FocusTile = { id: string; x: number; y: number; width: number; height: number; pinned: boolean; side: "mine" | "theirs" };
export type FocusRect = { x: number; y: number; width: number; height: number };
export type FocusLayout = { stacked: boolean; tiles: FocusTile[]; split: FocusRect | null };
export type FocusOptions = {
  /** Gap between tiles inside a squad. */
  gap?: number;
  /** Gap between the two squads. */
  squadGap?: number;
  /** The smaller squad never gets less than this share of the stage. */
  minShare?: number;
  /** Unpinned tiles are never made smaller than this (zoom is reduced instead). */
  minTile?: number;
};

export const MAX_WEIGHT = 4;
const DEFAULTS = { gap: 4, squadGap: 10, minShare: 0.28, minTile: 72 };

const clampWeight = (weight?: number) => (Number.isFinite(weight) ? Math.max(1, Math.min(MAX_WEIGHT, weight as number)) : 1);
const finite = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);

/** Split items (kept in order) into `lines` contiguous runs with balanced weight. */
function partition(weights: number[], lines: number): number[][] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  const runs: number[][] = [];
  let run: number[] = [];
  let acc = 0;
  weights.forEach((weight, index) => {
    const remainingItems = weights.length - index;
    const remainingLines = lines - runs.length;
    const target = (total * (runs.length + 1)) / lines;
    // close the current line when it reached its share, or when every remaining
    // line needs at least one item
    if (run.length && (acc + weight / 2 > target || remainingItems < remainingLines)) {
      runs.push(run);
      run = [];
    }
    run.push(index);
    acc += weight;
  });
  if (run.length) runs.push(run);
  return runs;
}

type Placed = { index: number; x: number; y: number; width: number; height: number };

/**
 * Justified lines: every line spans the full box; line thickness is proportional to
 * the line's total weight and each tile's length to its own weight, so every tile's
 * area is proportional to its weight. Tries rows and columns and every line count,
 * and keeps the arrangement whose tiles are closest to a comfortable video shape.
 */
function justify(weights: number[], box: FocusRect, gap: number): Placed[] {
  const n = weights.length;
  if (!n || box.width <= 0 || box.height <= 0) return weights.map((_, index) => ({ index, x: box.x, y: box.y, width: 0, height: 0 }));
  let best: { cost: number; placed: Placed[] } | null = null;
  for (const orientation of ["rows", "columns"] as const) {
    for (let lines = 1; lines <= n; lines++) {
      const runs = partition(weights, lines);
      if (runs.length !== lines) continue;
      const along = orientation === "rows" ? box.width : box.height; // length of each line
      const across = orientation === "rows" ? box.height : box.width; // lines stack this way
      const usableAcross = across - gap * (lines - 1);
      const total = weights.reduce((sum, w) => sum + w, 0);
      const placed: Placed[] = [];
      let cost = 0;
      let offset = 0;
      for (const run of runs) {
        const runWeight = run.reduce((sum, i) => sum + weights[i], 0);
        const thickness = (usableAcross * runWeight) / total;
        const usableAlong = along - gap * (run.length - 1);
        let cursor = 0;
        for (const i of run) {
          const length = (usableAlong * weights[i]) / runWeight;
          const tile = orientation === "rows"
            ? { index: i, x: box.x + cursor, y: box.y + offset, width: length, height: thickness }
            : { index: i, x: box.x + offset, y: box.y + cursor, width: thickness, height: length };
          placed.push(tile);
          cursor += length + gap;
          // Prefer 4:3-ish landscape to 3:4-ish portrait tiles; punish slivers hard.
          const aspect = tile.width / Math.max(1e-6, tile.height);
          const deviation = aspect >= 1 ? Math.abs(Math.log(aspect / (4 / 3))) : Math.abs(Math.log(aspect / (3 / 4))) * 1.15;
          cost += weights[i] * (deviation + (aspect > 2.4 || aspect < 0.42 ? 3 : 0));
        }
        offset += thickness + gap;
      }
      if (!best || cost < best.cost - 1e-9) best = { cost, placed };
    }
  }
  return best!.placed.sort((a, b) => a.index - b.index);
}

/** One squad in its box: pinned people in a fixed strip along the outer edge, the rest justified. */
/** Everyone unpinned in one rect: justified, zoom honoured as far as it keeps others at minTile. */
function placeFree(free: FocusPerson[], rect: FocusRect, o: Required<FocusOptions>): Omit<FocusTile, "side">[] {
  if (!free.length) return [];
  let weights = free.map(p => clampWeight(p.weight));
  let placed = justify(weights, rect, o.gap);
  for (let guard = 0; guard < 12; guard++) {
    const smallest = Math.min(...placed.map(t => Math.min(t.width, t.height)));
    if (smallest >= o.minTile || weights.every(w => w <= 1)) break;
    weights = weights.map(w => (w > 1 ? Math.max(1, w * 0.8) : w));
    placed = justify(weights, rect, o.gap);
  }
  // A lone person should not become a letterbox-shaped slab: keep 9:16..16:9, centred.
  if (free.length === 1) {
    const t = placed[0];
    const aspect = t.width / Math.max(1e-6, t.height);
    if (aspect > 16 / 9) { const w = t.height * 16 / 9; t.x += (t.width - w) / 2; t.width = w; }
    else if (aspect < 9 / 16) { const h = t.width * 16 / 9; t.y += (t.height - h) / 2; t.height = h; }
  }
  return placed.map(t => ({ id: free[t.index].id, x: t.x, y: t.y, width: t.width, height: t.height, pinned: false }));
}

/**
 * One squad in its box. Pinned people sit in a strip along the squad's outer edge,
 * starting at the strip's beginning; everyone else fills both the main area and the
 * part of the strip beside the pinned people, so no space is left dead.
 */
function layoutSquad(people: FocusPerson[], box: FocusRect, outer: "left" | "right" | "top" | "bottom", o: Required<FocusOptions>): Omit<FocusTile, "side">[] {
  if (!people.length) return [];
  const isPinned = (p: FocusPerson) => !!(p.pinned && p.pinned.width > 0 && p.pinned.height > 0);
  const pinned = people.filter(isPinned);
  const free = people.filter(p => !isPinned(p));
  const column = outer === "left" || outer === "right"; // pinned stack top-to-bottom in a column
  const out: Omit<FocusTile, "side">[] = [];
  const regions: FocusRect[] = [];

  if (!pinned.length) regions.push({ ...box });
  else {
    // Pinned sizes are honoured exactly unless they cannot fit; then they shrink together.
    const sizes = pinned.map(p => ({ w: p.pinned!.width, h: p.pinned!.height }));
    const stackLen = sizes.reduce((sum, sz) => sum + (column ? sz.h : sz.w), 0) + o.gap * (sizes.length - 1);
    const thick = Math.max(...sizes.map(sz => (column ? sz.w : sz.h)));
    const along = column ? box.height : box.width;
    const acrossRoom = column ? box.width : box.height;
    const scale = Math.min(1, along / Math.max(1, stackLen), acrossRoom / Math.max(1, thick));
    const stripThick = thick * scale;
    let cursor = 0;
    for (let k = 0; k < pinned.length; k++) {
      const w = sizes[k].w * scale, h = sizes[k].h * scale;
      const x = column ? (outer === "left" ? box.x : box.x + box.width - stripThick) + (stripThick - w) / 2 : box.x + cursor;
      const y = column ? box.y + cursor : (outer === "top" ? box.y : box.y + box.height - stripThick) + (stripThick - h) / 2;
      out.push({ id: pinned[k].id, x, y, width: w, height: h, pinned: true });
      cursor += (column ? h : w) + o.gap;
    }
    // what is left of the strip beside the pinned people
    const stripStart = column ? (outer === "left" ? box.x : box.x + box.width - stripThick) : (outer === "top" ? box.y : box.y + box.height - stripThick);
    const leftover = column
      ? { x: stripStart, y: box.y + cursor, width: stripThick, height: box.height - cursor }
      : { x: box.x + cursor, y: stripStart, width: box.width - cursor, height: stripThick };
    // the main area on the inner side of the strip
    const used = stripThick + o.gap;
    const main = outer === "left" ? { x: box.x + used, y: box.y, width: box.width - used, height: box.height }
      : outer === "right" ? { x: box.x, y: box.y, width: box.width - used, height: box.height }
      : outer === "top" ? { x: box.x, y: box.y + used, width: box.width, height: box.height - used }
      : { x: box.x, y: box.y, width: box.width, height: box.height - used };
    const usable = (r: FocusRect) => r.width >= o.minTile * 0.9 && r.height >= o.minTile * 0.9;
    if (usable(main)) regions.push(main);
    if (usable(leftover)) regions.push(leftover);
    if (!regions.length && free.length) regions.push(main.width > 0 && main.height > 0 ? main : leftover);
  }

  if (free.length && regions.length === 1) out.push(...placeFree(free, regions[0], o));
  else if (free.length && regions.length === 2) {
    // Split people (in order) between the main area and the space beside the pinned
    // people; keep the split where everyone's size best matches their zoom.
    let best: { score: number; tiles: Omit<FocusTile, "side">[] } | null = null;
    for (let k = 0; k <= free.length; k++) {
      const tiles = [...placeFree(free.slice(0, k), regions[0], o), ...placeFree(free.slice(k), regions[1], o)];
      const weightOf = new Map(free.map(p => [p.id, clampWeight(p.weight)]));
      const fair = Math.min(...tiles.map(t => (t.width * t.height) / (weightOf.get(t.id) ?? 1)));
      // an area left empty is dead space; prefer using both unless it makes someone tiny
      const dead = (k === 0 ? regions[0].width * regions[0].height : 0) + (k === free.length ? regions[1].width * regions[1].height : 0);
      const score = fair * Math.pow(1 - dead / Math.max(1, box.width * box.height), 3);
      if (!best || score > best.score + 1e-6) best = { score, tiles };
    }
    out.push(...best!.tiles);
  }
  // keep the caller's order
  const order = new Map(people.map((p, i) => [p.id, i]));
  return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/**
 * Lay out a squad-vs-squad call. Their squad goes left (desktop) or top (phone), yours
 * right or bottom. Stage share follows each squad's total weight, never below minShare.
 */
export function arrangeFocusCall(mine: FocusPerson[], theirs: FocusPerson[], width: number, height: number, options: FocusOptions = {}): FocusLayout {
  const o = { ...DEFAULTS, ...options } as Required<FocusOptions>;
  width = finite(width);
  height = finite(height);
  const stage = { x: 0, y: 0, width, height };
  const stacked = width < 700 && height > width * 0.65;
  const tag = (side: "mine" | "theirs") => (t: Omit<FocusTile, "side">): FocusTile => ({ ...t, side });
  if (!mine.length || !theirs.length) {
    const side = mine.length ? "mine" : "theirs";
    const people = mine.length ? mine : theirs;
    return { stacked: false, split: null, tiles: layoutSquad(people, stage, stacked ? "top" : "left", o).map(tag(side)) };
  }
  const mass = (people: FocusPerson[]) => people.reduce((sum, p) => sum + (p.pinned ? MAX_WEIGHT / 2 : clampWeight(p.weight)), 0);
  const gap = Math.min(o.squadGap, (stacked ? height : width) / 4);
  const usable = Math.max(0, (stacked ? height : width) - gap);
  // Space a squad must keep along the split so its pinned people stay exactly their
  // size: the pinned strip, plus room for one row of everyone else.
  const need = (people: FocusPerson[]) => {
    const pins = people.filter(p => p.pinned && p.pinned.width > 0 && p.pinned.height > 0);
    if (!pins.length) return 0;
    const strip = Math.max(...pins.map(p => (stacked ? p.pinned!.height : p.pinned!.width)));
    const stackLen = pins.reduce((sum, p) => sum + (stacked ? p.pinned!.width : p.pinned!.height), 0) + o.gap * (pins.length - 1);
    // others can sit beside the pinned people when the strip has room; otherwise keep a row for them
    const besideRoom = (stacked ? width : height) - stackLen - o.gap;
    return strip + (pins.length < people.length && besideRoom < o.minTile ? o.gap + o.minTile : 0);
  };
  let theirSize = usable * Math.max(o.minShare, Math.min(1 - o.minShare, mass(theirs) / (mass(theirs) + mass(mine))));
  const theirNeed = need(theirs), mineNeed = need(mine);
  if (theirNeed + mineNeed <= usable) theirSize = Math.max(theirNeed, Math.min(usable - mineNeed, theirSize));
  const theirShare = usable ? theirSize / usable : 0.5;
  if (stacked) {
    const theirH = (height - gap) * theirShare;
    const theirBox = { x: 0, y: 0, width, height: theirH };
    const mineBox = { x: 0, y: theirH + gap, width, height: height - theirH - gap };
    return {
      stacked,
      split: { x: 0, y: theirH, width, height: gap },
      tiles: [...layoutSquad(theirs, theirBox, "top", o).map(tag("theirs")), ...layoutSquad(mine, mineBox, "bottom", o).map(tag("mine"))],
    };
  }
  const theirW = (width - gap) * theirShare;
  const theirBox = { x: 0, y: 0, width: theirW, height };
  const mineBox = { x: theirW + gap, y: 0, width: width - theirW - gap, height };
  return {
    stacked,
    split: { x: theirW, y: 0, width: gap, height },
    tiles: [...layoutSquad(theirs, theirBox, "left", o).map(tag("theirs")), ...layoutSquad(mine, mineBox, "right", o).map(tag("mine"))],
  };
}
