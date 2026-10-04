/**
 * Focus layout: same-size tiles per squad that each viewer can reshape.
 *
 * - Every person has a weight (1 = normal). Zooming someone raises their weight
 *   (2 = twice the area, up to MAX_WEIGHT) and everyone else re-flows around them.
 * - A pinned person keeps a fixed pixel size no matter what happens to the others;
 *   the rest of their squad fills the space that is left.
 * - Tiles always fill the squad's space (no holes). Each tile's shape follows the
 *   person's camera (portrait phones get narrow tiles, laptops wide ones) so faces
 *   come out about the same size and little of anyone's video is cropped. A tile
 *   whose crop would still be heavy is shown whole (see videoCrop / CROP_LIMIT).
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
  /** The person's camera shape (width / height) while their video is on; unknown or camera off = any shape. */
  aspect?: number | null;
  /** The viewer themselves: kept reasonable but never bigger than the people they are talking to. */
  self?: boolean;
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

/** Lowest weight the engine accepts (the viewer's own tile uses SELF_WEIGHT). */
export const MIN_WEIGHT = 0.25;
/** The viewer's own video gets half the room of everyone else by default. */
export const SELF_WEIGHT = 0.5;
const clampWeight = (weight?: number) => (Number.isFinite(weight) ? Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, weight as number)) : 1);
const finite = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);

/** Every way to cut n ordered items into contiguous lines (2^(n-1) ways; n is at most 8 per squad). */
function allPartitions(n: number): number[][][] {
  const out: number[][][] = [];
  for (let mask = 0; mask < 1 << (n - 1); mask++) {
    const runs: number[][] = [[0]];
    for (let i = 1; i < n; i++) {
      if (mask & (1 << (i - 1))) runs.push([i]);
      else runs[runs.length - 1].push(i);
    }
    out.push(runs);
  }
  return out;
}

/** Fallback for very large squads: balanced greedy runs for each line count. */
function greedyPartitions(weights: number[]): number[][][] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  const out: number[][][] = [];
  for (let lines = 1; lines <= weights.length; lines++) {
    const runs: number[][] = [];
    let run: number[] = [];
    let acc = 0;
    weights.forEach((weight, index) => {
      const target = (total * (runs.length + 1)) / lines;
      if (run.length && (acc + weight / 2 > target || weights.length - index < lines - runs.length)) { runs.push(run); run = []; }
      run.push(index);
      acc += weight;
    });
    if (run.length) runs.push(run);
    if (runs.length === lines) out.push(runs);
  }
  return out;
}

type Placed = { index: number; x: number; y: number; width: number; height: number };

/** Above this share of a video lost to cropping, the renderer shows the whole video instead. */
export const CROP_LIMIT = 0.3;
const NEUTRAL_ASPECT = 1.15; // camera off / unknown: an avatar is happy in any near-square tile

const knownAspect = (aspect?: number | null) => (aspect && Number.isFinite(aspect) && aspect >= 0.2 && aspect <= 5 ? aspect : null);

/** Share of a camera's picture a tile hides when the video fills it (object-fit: cover). */
export function videoCrop(tileWidth: number, tileHeight: number, aspect?: number | null): number {
  const a = knownAspect(aspect);
  if (!a || tileWidth <= 0 || tileHeight <= 0) return 0;
  const r = tileWidth / tileHeight;
  return 1 - Math.min(r / a, a / r);
}

/**
 * How big a person's face comes out in a tile: the height the video is drawn at
 * (cropped when the crop is light, shown whole when it would be heavy). Camera
 * off: the avatar, which is as big as the tile's shorter side.
 */
function faceSize(width: number, height: number, aspect?: number | null): number {
  const a = knownAspect(aspect);
  if (!a) return Math.min(width, height);
  const r = width / Math.max(1e-6, height);
  const cover = r < a ? height : width / a;
  const contain = r < a ? width / a : height;
  return videoCrop(width, height, a) <= CROP_LIMIT ? cover : contain;
}

type Scored = { width: number; height: number; weight: number; aspect?: number | null; self?: boolean; target?: number };

/**
 * Lower is better. The smallest face among the people you are talking to counts
 * most, then how even everyone is (zoom counted), then overall size, then crop.
 * Your own tile is left out of the fairness and only kept between a floor and the
 * smallest face of everyone else.
 */
function arrangementCost(items: Scored[], minTile: number): number {
  if (!items.length) return 0;
  const others = items.filter(i => !i.self);
  const pool = others.length ? others : items;
  let smallest = Infinity, largest = 0, sum = 0, rawSmallest = Infinity;
  for (const i of pool) {
    const raw = faceSize(i.width, i.height, i.aspect);
    const face = raw / Math.sqrt(i.weight);
    smallest = Math.min(smallest, face);
    largest = Math.max(largest, face);
    rawSmallest = Math.min(rawSmallest, raw);
    sum += face;
  }
  let cost = -Math.log(Math.max(1e-6, smallest)) + 0.5 * Math.log(Math.max(1e-6, largest) / Math.max(1e-6, smallest)) - 0.15 * Math.log(Math.max(1e-6, sum / pool.length));
  let crop = 0, weight = 0;
  const meanOtherArea = pool.reduce((acc, i) => acc + i.width * i.height, 0) / pool.length;
  for (const i of items) {
    // a zoomed person must come out clearly bigger than they were unzoomed
    if (i.target) {
      const face = faceSize(i.width, i.height, i.aspect);
      if (face < i.target) cost += 8 * Math.log(i.target / Math.max(1e-6, face));
    }
    // your own tile is never the big one: about the size of an average tile at most
    if (i.self && others.length && i.width * i.height > meanOtherArea * 1.15) cost += 0.35 * Math.log((i.width * i.height) / (meanOtherArea * 1.15));
    const lost = videoCrop(i.width, i.height, i.aspect);
    crop += (lost <= CROP_LIMIT ? lost : 0.1 + 0.4 * lost) * i.weight; // shown whole: the bars are waste
    weight += i.weight;
    const aspect = i.width / Math.max(1e-6, i.height);
    if (!knownAspect(i.aspect)) cost += Math.max(0, Math.abs(Math.log(aspect)) - 0.75); // avatars: anything but a slab
    // slivers read badly; a video shown whole in one is mostly bars (your own may
    // sit in a wide strip under the people you are talking to)
    const whole = !!knownAspect(i.aspect) && lost > CROP_LIMIT;
    const known = !!knownAspect(i.aspect);
    if (known && !whole && (aspect > 2.6 || aspect < 0.38)) cost += 4;
    else if (!known && (aspect > 3.5 || aspect < 0.28)) cost += 4; // a character sits fine in a tall or wide tile, just not a strip
    else if (whole && !i.self && (aspect > 3.2 || aspect < 0.32)) cost += 2;
    else if (whole && i.self && aspect < 0.32) cost += 2;
    const shorterSide = Math.min(i.width, i.height);
    // A severe sliver must cost more than a tile that only just misses the floor.
    if (shorterSide < minTile) cost += 4 * Math.log(minTile / Math.max(1e-6, shorterSide));
    if (i.self && others.length) {
      const own = faceSize(i.width, i.height, i.aspect);
      if (own > rawSmallest) cost += 0.6 * Math.log(own / rawSmallest);
      if (own < rawSmallest * 0.35) cost += 2 * Math.log((rawSmallest * 0.35) / Math.max(1e-6, own));
    }
  }
  return cost + (1.6 * crop) / Math.max(1e-6, weight);
}

/**
 * Justified lines: every line spans the full box and the lines fill it, so there is
 * never a hole. Inside a line, each tile's length follows the person's camera shape
 * (and zoom), so faces in a line match. Tries rows and columns, every way to break
 * the (ordered) people into lines and a few ways to share the space between lines,
 * and keeps the arrangement whose smallest face is biggest with the least cropping.
 */
function justify(people: { weight: number; aspect?: number | null; self?: boolean; target?: number }[], box: FocusRect, gap: number, minTile: number): Placed[] {
  const n = people.length;
  if (!n || box.width <= 0 || box.height <= 0) return people.map((_, index) => ({ index, x: box.x, y: box.y, width: 0, height: 0 }));
  const weights = people.map(p => p.weight);
  const shape = people.map(p => knownAspect(p.aspect) ?? NEUTRAL_ASPECT);
  let best: { cost: number; placed: Placed[] } | null = null;
  // Big squads: lopsided line breaks never win, so only near-even ones are tried.
  const candidates = n <= 5 ? allPartitions(n)
    : n <= 8 ? allPartitions(n).filter(runs => Math.max(...runs.map(r => r.length)) - Math.min(...runs.map(r => r.length)) <= 2)
    : greedyPartitions(weights);
  for (const orientation of ["rows", "columns"] as const) {
    const along = orientation === "rows" ? box.width : box.height; // length of each line
    const across = orientation === "rows" ? box.height : box.width; // lines stack this way
    // a tile's length along its line per unit of line thickness; zoomed people get
    // either sqrt(zoom) (same shape, bigger) or zoom (a longer tile) along the line
    const anyZoom = weights.some(w => w > 1);
    for (const zoomPow of anyZoom ? [0.5, 1] : [0.5]) {
    const unit = (i: number) => (orientation === "rows" ? shape[i] : 1 / shape[i]) * Math.pow(weights[i], zoomPow);
    for (const runs of candidates) {
      const usableAcross = across - gap * (runs.length - 1);
      if (usableAcross <= 0) continue;
      // natural thickness: what each line needs to show everyone uncropped
      const natural = runs.map(run => Math.max(1e-6, (along - gap * (run.length - 1)) / run.reduce((sum, i) => sum + unit(i), 0)));
      for (const policy of [natural, natural.map(Math.sqrt), natural.map(() => 1)]) {
        const total = policy.reduce((sum, t) => sum + t, 0);
        const placed: Placed[] = [];
        let offset = 0;
        runs.forEach((run, r) => {
          const thickness = (usableAcross * policy[r]) / total;
          const usableAlong = along - gap * (run.length - 1);
          const runUnits = run.reduce((sum, i) => sum + unit(i), 0);
          let cursor = 0;
          for (const i of run) {
            const length = (usableAlong * unit(i)) / runUnits;
            placed.push(orientation === "rows"
              ? { index: i, x: box.x + cursor, y: box.y + offset, width: length, height: thickness }
              : { index: i, x: box.x + offset, y: box.y + cursor, width: thickness, height: length });
            cursor += length + gap;
          }
          offset += thickness + gap;
        });
        const cost = arrangementCost(placed.map(t => ({ width: t.width, height: t.height, weight: weights[t.index], aspect: people[t.index].aspect, self: people[t.index].self, target: people[t.index].target })), minTile);
        if (!best || cost < best.cost - 1e-9) best = { cost, placed };
      }
    }
    }
  }
  return best!.placed.sort((a, b) => a.index - b.index);
}

/**
 * Face size each zoomed person must reach in the arrangement being built: their
 * unzoomed face times the square root of their zoom (zoom is area). Set by
 * arrangeFocusCall for the duration of one arrangement.
 */
let zoomTargets = new Map<string, number>();

/** One squad in its box: pinned people in a fixed strip along the outer edge, the rest justified. */
/** Everyone unpinned in one rect: justified, zoom honoured as far as it keeps others at minTile. */
function placeFree(freeInOrder: FocusPerson[], rect: FocusRect, o: Required<FocusOptions>): Omit<FocusTile, "side">[] {
  if (!freeInOrder.length) return [];
  // Zoomed people lead their squad (so they get their own line); everyone else keeps
  // their order. Unzooming puts a person straight back in place.
  const free = freeInOrder.map((p, i) => ({ p, i })).sort((a, b) => clampWeight(b.p.weight) - clampWeight(a.p.weight) || a.i - b.i).map(x => x.p);
  // the viewer's own tile (unzoomed) starts at half weight
  const isSelf = (p: FocusPerson) => !!p.self && clampWeight(p.weight) === 1;
  let weights = free.map(p => (isSelf(p) ? SELF_WEIGHT : clampWeight(p.weight)));
  const arrange = () => justify(free.map((p, i) => ({ weight: weights[i], aspect: p.aspect, self: isSelf(p), target: zoomTargets.get(p.id) })), rect, o.gap, o.minTile);
  let placed = arrange();
  for (let guard = 0; guard < 12; guard++) {
    const smallest = Math.min(...placed.map(t => Math.min(t.width, t.height)));
    if (smallest >= o.minTile || weights.every(w => w <= 1)) break; // only zooms give way
    weights = weights.map(w => (w > 1 ? Math.max(1, w * 0.8) : w));
    placed = arrange();
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
  // Default: squads side by side, stacked on a portrait phone. Without pins the
  // other direction is tried too and kept when faces come out clearly bigger
  // (e.g. two laptops 1-on-1 on a wide screen read better one above the other).
  const preferStacked = width < 700 && height > width * 0.65;
  // Zoom is relative to where someone would be without it, so "bigger" always shows.
  const zoomed = [...mine, ...theirs].filter(p => !p.pinned && clampWeight(p.weight) > 1);
  zoomTargets = new Map();
  if (zoomed.length) {
    const plain = (people: FocusPerson[]) => people.map(p => (zoomed.includes(p) ? { ...p, weight: 1 } : p));
    const base = arrangeFocusCall(plain(mine), plain(theirs), width, height, options);
    for (const p of zoomed) {
      const tile = base.tiles.find(t => t.id === p.id);
      if (tile) zoomTargets.set(p.id, faceSize(tile.width, tile.height, p.aspect) * Math.sqrt(clampWeight(p.weight)) * 0.9);
    }
  }
  const preferred = arrangeOriented(mine, theirs, width, height, o, preferStacked);
  const anyPinned = [...mine, ...theirs].some(p => p.pinned && p.pinned.width > 0 && p.pinned.height > 0);
  if (anyPinned || !mine.length || !theirs.length) return preferred;
  const other = arrangeOriented(mine, theirs, width, height, o, !preferStacked);
  const cost = (layout: FocusLayout) => stageCost(layout, [...mine, ...theirs], o.minTile);
  return cost(other) < cost(preferred) - 0.12 ? other : preferred;
}

function stageCost(layout: FocusLayout, people: FocusPerson[], minTile: number): number {
  const person = new Map(people.map(p => [p.id, p]));
  return arrangementCost(layout.tiles.map(t => {
    const p = person.get(t.id);
    const self = !!p?.self && clampWeight(p?.weight) === 1;
    return { width: t.width, height: t.height, weight: self ? SELF_WEIGHT : clampWeight(p?.weight), aspect: p?.aspect, self, target: zoomTargets.get(t.id) };
  }), minTile);
}

function arrangeOriented(mine: FocusPerson[], theirs: FocusPerson[], width: number, height: number, o: Required<FocusOptions>, stacked: boolean): FocusLayout {
  const stage = { x: 0, y: 0, width, height };
  const tag = (side: "mine" | "theirs") => (t: Omit<FocusTile, "side">): FocusTile => ({ ...t, side });
  if (!mine.length || !theirs.length) {
    const side = mine.length ? "mine" : "theirs";
    const people = mine.length ? mine : theirs;
    return { stacked: false, split: null, tiles: layoutSquad(people, stage, stacked ? "top" : "left", o).map(tag(side)) };
  }
  const mass = (people: FocusPerson[]) => people.reduce((sum, p) => sum + (p.pinned ? MAX_WEIGHT / 2 : p.self && clampWeight(p.weight) === 1 ? SELF_WEIGHT : clampWeight(p.weight)), 0);
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
  const build = (theirExtent: number): FocusLayout => {
    const theirShare = usable ? theirExtent / usable : 0.5;
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
  };
  // A squad with pinned people can either keep its share (others beside the pinned
  // strip and in the main area) or shrink to the pinned strip (others beside the pins
  // only, the other squad gets the rest). Build both and keep the fairer, fuller one.
  const stripOf = (people: FocusPerson[]) => {
    const pins = people.filter(p => p.pinned && p.pinned.width > 0 && p.pinned.height > 0);
    return pins.length && pins.length < people.length ? Math.max(...pins.map(p => (stacked ? p.pinned!.height : p.pinned!.width))) : 0;
  };
  const candidates = [theirSize];
  const mineStrip = stripOf(mine), theirStrip = stripOf(theirs);
  if (mineStrip && mineStrip < usable - theirSize) candidates.push(usable - mineStrip);
  if (theirStrip && theirStrip < theirSize) candidates.push(theirStrip);
  if (candidates.length === 1) {
    if ([...mine, ...theirs].some(p => p.pinned && p.pinned.width > 0 && p.pinned.height > 0)) return build(theirSize);
    // No pins: slide the split between the squads to where faces come out biggest
    // and most even (camera shapes decide how much room each squad really needs).
    const faceCost = (layout: FocusLayout) => stageCost(layout, [...mine, ...theirs], o.minTile);
    const lo = Math.max(usable * o.minShare, theirNeed), hi = Math.min(usable * (1 - o.minShare), usable - mineNeed);
    let best = build(theirSize);
    let bestCost = faceCost(best);
    for (let k = 1; k <= 8; k++) {
      const extent = lo + ((hi - lo) * k) / 9;
      if (Math.abs(extent - theirSize) < usable * 0.02) continue;
      const next = build(extent);
      const nextCost = faceCost(next);
      // only move off the even split for a real gain
      if (nextCost < bestCost - 0.03) { best = next; bestCost = nextCost; }
    }
    return best;
  }
  const weightOf = new Map([...mine, ...theirs].map(p => [p.id, clampWeight(p.weight)]));
  const score = (layout: FocusLayout) => {
    const free = layout.tiles.filter(t => !t.pinned);
    const fair = free.length ? Math.min(...free.map(t => (t.width * t.height) / (weightOf.get(t.id) ?? 1))) : 1;
    const covered = layout.tiles.reduce((sum, t) => sum + t.width * t.height, 0) / Math.max(1, width * height);
    return fair * covered * covered;
  };
  let best = build(candidates[0]);
  let bestScore = score(best);
  for (const extent of candidates.slice(1)) {
    const next = build(extent);
    const nextScore = score(next);
    if (nextScore > bestScore * 1.02) { best = next; bestScore = nextScore; }
  }
  return best;
}
