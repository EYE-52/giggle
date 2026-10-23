/* Chain Reaction visual replay contract: pure, DOM-free, dependency-free.
 *
 * The server stays authoritative: it resolves every cascade and ships the
 * final board plus a bounded firing tape (ordered source indices, repeats
 * included). This module lets the renderer replay that tape cosmetically —
 * placement, then each burst with its orthogonal transfers and arrival
 * captures in order — and guarantees the replay settles on the exact
 * authoritative board. It never invents game state: truncated, gapped, or
 * otherwise unreplayable updates resolve to an instant authoritative snap.
 *
 * Board shape matches the engine: [{ owner: string|null, orbs: number }].
 * Neighbor order matches the engine exactly: west, east, north, south.
 */

export const MAX_TAPE_EVENTS = 1500;
export const MAX_REPLAY_MS = 6000;
export const PLACE_MS = 220;
export const STAGE_MS = 300;
export const TRAVEL_FRACTION = 0.55;

export function neighborsOf(cols, rows, index) {
  const x = index % cols;
  const y = Math.floor(index / cols);
  const out = [];
  if (x > 0) out.push(index - 1);
  if (x < cols - 1) out.push(index + 1);
  if (y > 0) out.push(index - cols);
  if (y < rows - 1) out.push(index + cols);
  return out;
}

export function capacityAt(cols, rows, index) {
  return neighborsOf(cols, rows, index).length;
}

export function cloneBoard(board) {
  return board.map((c) => ({ owner: c.owner, orbs: c.orbs }));
}

export function boardsEqual(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
    a.every((c, i) => c.owner === b[i].owner && c.orbs === b[i].orbs);
}

/* One placement: exactly one added mass, capturing an empty cell. */
export function applyPlacement(board, index, pid) {
  const next = cloneBoard(board);
  next[index].owner = pid;
  next[index].orbs += 1;
  return next;
}

/* One firing, staged for visuals: the source sheds its capacity first ... */
export function applyBurstSource(board, cols, rows, src, pid) {
  const next = cloneBoard(board);
  next[src].orbs -= capacityAt(cols, rows, src);
  next[src].owner = next[src].orbs ? pid : null;
  return next;
}

/* ... then each traveling orb lands, capturing its destination. */
export function applyArrival(board, index, pid) {
  const next = cloneBoard(board);
  next[index].owner = pid;
  next[index].orbs += 1;
  return next;
}

/* One complete firing: source burst plus every orthogonal arrival. */
export function applyFiring(board, cols, rows, src, pid) {
  const next = cloneBoard(board);
  const cap = capacityAt(cols, rows, src);
  next[src].orbs -= cap;
  next[src].owner = next[src].orbs ? pid : null;
  for (const n of neighborsOf(cols, rows, src)) {
    next[n].owner = pid;
    next[n].orbs += 1;
  }
  return next;
}

/* Placement plus the full tape in order. On a non-truncated tape this
 * reproduces the authoritative server board exactly. */
export function replayTape(baseline, cols, rows, place, pid, tape) {
  if (!validTape(tape, baseline.length) || !Number.isInteger(place) || place < 0 || place >= baseline.length ||
      baseline[place].owner !== null && baseline[place].owner !== pid) throw new RangeError('Invalid replay placement.');
  let board = applyPlacement(baseline, place, pid);
  for (const src of tape) {
    if (board[src].orbs < capacityAt(cols, rows, src)) throw new RangeError('Invalid replay firing.');
    board = applyFiring(board, cols, rows, src, pid);
  }
  return board;
}

export function validTape(tape, cellCount) {
  return Array.isArray(tape) && tape.length <= MAX_TAPE_EVENTS &&
    tape.every((i) => Number.isInteger(i) && i >= 0 && i < cellCount);
}

/* Monotonic per-game event id shared by lastEvent and lastCascade. */
export function eventSeq(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return 0;
  const e = snapshot.lastEvent;
  if (e && Number.isInteger(e.seq)) return e.seq;
  const c = snapshot.lastCascade;
  if (c && Number.isInteger(c.seq)) return c.seq;
  return 0;
}

/* Adaptive pacing: the whole tape always plays in order, compressed to fit
 * the replay budget. Placement-only moves still get a visible orb drop. */
export function planTimings(tapeLength, opts = {}) {
  if (opts.reducedMotion || !Number.isInteger(tapeLength) || tapeLength < 0) {
    return { mode: 'instant', placeMs: 0, stageMs: 0, travelMs: 0, totalMs: 0 };
  }
  if (tapeLength === 0) {
    return { mode: 'animate', placeMs: PLACE_MS, stageMs: 0, travelMs: 0, totalMs: PLACE_MS };
  }
  // The budget always wins: long tapes compress per-stage pacing (never
  // order) so the whole avalanche still settles inside MAX_REPLAY_MS.
  const stageMs = Math.min(STAGE_MS, Math.max(0, Math.floor((MAX_REPLAY_MS - PLACE_MS) / tapeLength)));
  const travelMs = Math.max(0, Math.round(stageMs * TRAVEL_FRACTION));
  return { mode: 'animate', placeMs: PLACE_MS, stageMs, travelMs, totalMs: PLACE_MS + stageMs * tapeLength };
}

/* Single routing decision for an incoming snapshot. The renderer keeps only
 * the latest authoritative snapshot (a bounded queue of one): while a replay
 * runs, a consecutive update queues behind it and a gapped one snaps.
 *
 * action animate: replay placement + tape from the displayed baseline.
 * action queue:   keep replaying; the latest snapshot waits (re-decided at
 *                 settle, so only ever the newest event can chain next).
 * action instant: render the authoritative board now, no replay.
 * action ignore:  duplicate heartbeat or stale event; change nothing.
 */
export function decideUpdate(u) {
  const snapSeq = u.snapSeq;
  const snapInstance = u.snapInstance;
  const lastSeq = u.lastSeq;
  const lastInstance = u.lastInstance;
  if (snapInstance !== lastInstance) return { action: 'instant', reason: 'rematch' };
  if (!Number.isInteger(snapSeq) || !Number.isInteger(lastSeq)) {
    return { action: 'instant', reason: 'unknown-seq' };
  }
  if (snapSeq === lastSeq) return { action: 'ignore', reason: 'duplicate' };
  if (snapSeq < lastSeq) return { action: 'ignore', reason: 'stale' };
  if (u.replaying) {
    if (snapSeq > lastSeq + 1) return { action: 'instant', reason: 'gap-during-replay' };
    return { action: 'queue', reason: 'replay-busy' };
  }
  if (snapSeq > lastSeq + 1) return { action: 'instant', reason: 'gap' };
  if (u.truncated) return { action: 'instant', reason: 'truncated' };
  if (u.kind !== 'move') return { action: 'instant', reason: 'no-placement' };
  if (u.reducedMotion) return { action: 'instant', reason: 'reduced-motion' };
  if (!u.measurable) return { action: 'instant', reason: 'no-layout' };
  if (!validTape(u.tape, u.cellCount)) return { action: 'instant', reason: 'bad-tape' };
  if (!Number.isInteger(u.place) || u.place < 0 || u.place >= u.cellCount ||
      typeof u.pid !== 'string') {
    return { action: 'instant', reason: 'bad-place' };
  }
  return {
    action: 'animate',
    reason: u.tape && u.tape.length ? 'chain' : 'placement',
  };
}
