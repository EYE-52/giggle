/* Chain Reaction visual planner tests: the pure replay contract in
 * public/js/engines/chain-visual.mjs, exercised against real event tapes
 * from the authoritative engine. Run with: node test/chain-visual.mjs */
import assert from 'node:assert/strict';
import engine from '../games/engines/chain-reaction.js';
import game from '../games/chain-reaction/server.js';
import * as visual from '../public/js/engines/chain-visual.mjs';

const { geometry, resolveCascade } = engine;

class Clock {
  constructor(n = 2, settings = {}) {
    this.roster = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'Player ' + i, connected: true }));
    this.values = settings; this.time = 1700000000000; this.timers = [];
  }
  now() { return this.time; }
  allPlayers() { return this.roster.slice(); }
  players() { return this.roster.filter((p) => p.connected); }
  settings() { return this.values; }
  award() {}
  broadcast() {}
  later(ms, fn) {
    const timer = { at: this.time + ms, fn, canceled: false }; this.timers.push(timer);
    return () => { timer.canceled = true; };
  }
}

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const mass = (board) => board.reduce((n, c) => n + c.orbs, 0);

function geometryTests() {
  assert.equal(visual.MAX_TAPE_EVENTS, engine.MAX_TAPE_EVENTS, 'planner and engine share one tape bound');
  for (const [cols, rows] of [[4, 4], [5, 6], [6, 8]]) {
    const grid = geometry(cols, rows);
    for (let i = 0; i < cols * rows; i++) {
      assert.deepEqual(visual.neighborsOf(cols, rows, i), grid.neighbors[i],
        `planner neighbor order matches the engine at ${cols}x${rows}:${i}`);
      assert.equal(visual.capacityAt(cols, rows, i), grid.capacities[i]);
    }
  }
  console.log('VISUAL geometry: planner neighbors/capacities match the engine on 4x4, 5x6, 6x8');
}

function stepTests() {
  const grid = geometry(5, 6);
  const board = Array.from({ length: 30 }, () => ({ owner: null, orbs: 0 }));
  board[0] = { owner: 'p0', orbs: 1 };
  board[1] = { owner: 'p1', orbs: 1 };
  const placed = visual.applyPlacement(board, 0, 'p0');
  assert.deepEqual(placed[0], { owner: 'p0', orbs: 2 });
  assert.equal(mass(placed), mass(board) + 1, 'placement adds exactly one mass');
  assert.deepEqual(board[0], { owner: 'p0', orbs: 1 }, 'placement never mutates its input');
  const burst = visual.applyBurstSource(placed, 5, 6, 0, 'p0');
  assert.deepEqual(burst[0], { owner: null, orbs: 0 }, 'a spent corner empties');
  assert.deepEqual(placed[0], { owner: 'p0', orbs: 2 }, 'burst never mutates its input');
  const landed = visual.applyArrival(burst, 1, 'p0');
  assert.deepEqual(landed[1], { owner: 'p0', orbs: 2 }, 'arrival captures on landing');
  const whole = visual.applyFiring(placed, 5, 6, 0, 'p0');
  let staged = visual.applyBurstSource(placed, 5, 6, 0, 'p0');
  for (const n of grid.neighbors[0]) staged = visual.applyArrival(staged, n, 'p0');
  assert(visual.boardsEqual(whole, staged), 'staged burst plus arrivals equal one firing');
  assert.equal(mass(whole), mass(placed), 'a firing conserves mass');
  const clone = visual.cloneBoard(board);
  clone[1].orbs = 500; clone[1].owner = 'p9';
  assert.deepEqual(board[1], { owner: 'p1', orbs: 1 }, 'clones are deep copies');
  assert(visual.boardsEqual(board, visual.cloneBoard(board)));
  assert(!visual.boardsEqual(board, placed));
  assert(!visual.boardsEqual(board, board.slice(0, 29)));
  // Tape validation: bounded length, integer in-range indices only.
  assert(visual.validTape([0, 29, 0], 30));
  assert(visual.validTape([], 30));
  assert(!visual.validTape(new Array(visual.MAX_TAPE_EVENTS + 1).fill(0), 30));
  assert(!visual.validTape([30], 30));
  assert(!visual.validTape([-1], 30));
  assert(!visual.validTape([1.5], 30));
  assert(!visual.validTape('0', 30));
  assert(!visual.validTape(null, 30));
  console.log('VISUAL steps: placement, staged burst/arrival, firing conservation, copies, tape validation');
}

function replayEngineTapes() {
  // Fixed nonterminal fixture: ordered repeats replay exactly.
  const grid = geometry(5, 6);
  const fixture = Array.from({ length: 30 }, () => ({ owner: null, orbs: 0 }));
  fixture[0] = { owner: 'p0', orbs: 1 };
  fixture[1] = { owner: 'p1', orbs: 2 };
  fixture[29] = { owner: 'p1', orbs: 1 };
  const resolved = resolveCascade(fixture, grid, 0, 'p0', true);
  assert.equal(resolved.truncated, false);
  assert(visual.boardsEqual(
    visual.replayTape(fixture, 5, 6, 0, 'p0', resolved.tape), resolved.board),
  'planner replay of a real tape equals the server board');

  // Dense endgame fixtures on both boards: complete tapes, exact replay.
  for (const [cols, rows] of [[5, 6], [6, 8]]) {
    const dense = geometry(cols, rows);
    const saturated = dense.capacities.map((cap, i) => ({
      owner: i === dense.capacities.length - 1 ? 'p1' : 'p0', orbs: cap - 1,
    }));
    const end = resolveCascade(saturated, dense, 0, 'p0', true);
    assert.equal(end.truncated, false);
    assert(visual.boardsEqual(
      visual.replayTape(saturated, cols, rows, 0, 'p0', end.tape), end.board),
    `dense ${cols}x${rows} tape replays exactly (${end.steps} firings)`);
  }

  // Randomized stable boards: every legal tape replays to the server board.
  const random = rng(20261006);
  const seats = ['p0', 'p1', 'p2'];
  let checked = 0;
  for (let trial = 0; trial < 300; trial++) {
    const cells = grid.capacities.map((cap) => {
      if (random() < 0.35) return { owner: null, orbs: 0 };
      const orbs = 1 + Math.floor(random() * (cap - 1));
      return { owner: seats[Math.floor(random() * seats.length)], orbs };
    });
    const pid = seats[Math.floor(random() * seats.length)];
    const legal = cells.flatMap((c, i) => c.owner === null || c.owner === pid ? [i] : []);
    if (!legal.length) continue;
    const at = legal[Math.floor(random() * legal.length)];
    const out = resolveCascade(cells, grid, at, pid, true);
    assert.equal(out.truncated, false);
    assert(visual.boardsEqual(visual.replayTape(cells, 5, 6, at, pid, out.tape), out.board),
      `random tape ${trial} replays to the server board`);
    checked++;
  }
  assert(checked > 250, 'random sweep covers hundreds of real tapes');

  // Full legal matches through the game: every move's tape replays.
  let moves = 0;
  for (const [n, boardSize, seed] of [[2, 'Compact', 7], [3, 'Standard', 9], [6, 'Compact', 11]]) {
    const ctx = new Clock(n, { boardSize });
    const s = game.create(ctx);
    const pick = rng(seed);
    const g = geometry(s.cols, s.rows);
    while (s.phase === 'play') {
      const pid = s.turnPid;
      const options = s.board.flatMap((c, i) => c.owner === null || c.owner === pid ? [i] : []);
      const at = options[Math.floor(pick() * options.length)];
      const before = visual.cloneBoard(s.board);
      game.onAction(s, ctx, pid, { x: at % s.cols, y: Math.floor(at / s.cols), turnNo: s.turnNo });
      const c = s.lastCascade;
      assert.equal(c.truncated, false);
      assert.equal(c.tape.length, c.steps);
      assert(visual.boardsEqual(
        visual.replayTape(before, s.cols, s.rows, at, pid, c.tape), s.board),
      'every legal match move replays to the server board');
      moves++;
    }
    game.dispose(s);
  }
  assert(moves > 100, 'match sweep covers full legal games');
  console.log(`VISUAL replay: fixture, dense, ${checked} random and ${moves} match tapes equal their server boards`);
}

function truncationTests() {
  const grid = geometry(5, 6);
  const fixture = Array.from({ length: 30 }, () => ({ owner: null, orbs: 0 }));
  fixture[0] = { owner: 'p0', orbs: 1 };
  fixture[1] = { owner: 'p0', orbs: 2 };
  fixture[5] = { owner: 'p0', orbs: 2 };
  const cut = resolveCascade(fixture, grid, 0, 'p0', false, { tapeLimit: 2 });
  assert.equal(cut.truncated, true);
  assert.deepEqual(cut.tape, [0, 1]);
  // A partial prefix must NOT replay to the authoritative board: the client
  // snaps instead of showing a wrong intermediate state as final.
  assert(!visual.boardsEqual(visual.replayTape(fixture, 5, 6, 0, 'p0', cut.tape), cut.board));
  const d = visual.decideUpdate({
    snapSeq: 4, snapInstance: 'a', lastSeq: 3, lastInstance: 'a', replaying: false,
    truncated: true, kind: 'move', reducedMotion: false, measurable: true,
    tape: cut.tape, cellCount: 30, place: 0, pid: 'p0',
  });
  assert.deepEqual(d, { action: 'instant', reason: 'truncated' });
  console.log('VISUAL truncation: partial tapes never replay; the client snaps authoritatively');
}

function timingTests() {
  const still = visual.planTimings(0, {});
  assert.deepEqual(still, { mode: 'animate', placeMs: 220, stageMs: 0, travelMs: 0, totalMs: 220 },
    'placement-only moves stay visible');
  const small = visual.planTimings(4, {});
  assert.equal(small.mode, 'animate');
  assert.equal(small.stageMs, 300);
  assert.equal(small.totalMs, 220 + 4 * 300);
  assert(small.travelMs > 0 && small.travelMs < small.stageMs);
  for (const len of [1, 10, 100, 500, 1500]) {
    const t = visual.planTimings(len, {});
    assert.equal(t.mode, 'animate');
    assert(t.totalMs <= visual.MAX_REPLAY_MS, `tape of ${len} fits the replay budget`);
    assert(t.stageMs >= 0 && t.stageMs <= visual.STAGE_MS);
    assert(t.travelMs >= 0 && t.travelMs <= t.stageMs);
    assert.equal(t.totalMs, t.placeMs + t.stageMs * len, 'the whole tape keeps its order in time');
  }
  assert.deepEqual(visual.planTimings(10, { reducedMotion: true }),
    { mode: 'instant', placeMs: 0, stageMs: 0, travelMs: 0, totalMs: 0 });
  console.log('VISUAL timing: placement stays visible, long tapes compress into the 6s budget in order');
}

function decideTests() {
  const base = {
    snapSeq: 6, snapInstance: 'a', lastSeq: 5, lastInstance: 'a', replaying: false,
    truncated: false, kind: 'move', reducedMotion: false, measurable: true,
    tape: [0, 1], cellCount: 30, place: 0, pid: 'p0',
  };
  const decide = (over) => visual.decideUpdate({ ...base, ...over });
  assert.deepEqual(decide({}), { action: 'animate', reason: 'chain' });
  assert.deepEqual(decide({ tape: [] }), { action: 'animate', reason: 'placement' });
  // Dedupe and staleness: heartbeats and old events change nothing.
  assert.deepEqual(decide({ snapSeq: 5 }), { action: 'ignore', reason: 'duplicate' });
  assert.deepEqual(decide({ snapSeq: 4 }), { action: 'ignore', reason: 'stale' });
  // Bounded queue of one: a consecutive event waits; a gap snaps to latest.
  assert.deepEqual(decide({ replaying: true }), { action: 'queue', reason: 'replay-busy' });
  assert.deepEqual(decide({ replaying: true, snapSeq: 7 }), { action: 'instant', reason: 'gap-during-replay' });
  assert.deepEqual(decide({ snapSeq: 7 }), { action: 'instant', reason: 'gap' });
  // Rematch and unknown seq reset to the authoritative board.
  assert.deepEqual(decide({ snapInstance: 'b' }), { action: 'instant', reason: 'rematch' });
  assert.deepEqual(decide({ snapSeq: null }), { action: 'instant', reason: 'unknown-seq' });
  // Anything unreplayable snaps instead of animating a guess.
  assert.deepEqual(decide({ truncated: true }), { action: 'instant', reason: 'truncated' });
  assert.deepEqual(decide({ kind: 'timeout', tape: [] }), { action: 'instant', reason: 'no-placement' });
  assert.deepEqual(decide({ kind: null, tape: [] }), { action: 'instant', reason: 'no-placement' });
  assert.deepEqual(decide({ reducedMotion: true }), { action: 'instant', reason: 'reduced-motion' });
  assert.deepEqual(decide({ measurable: false }), { action: 'instant', reason: 'no-layout' });
  assert.deepEqual(decide({ tape: [31] }), { action: 'instant', reason: 'bad-tape' });
  assert.deepEqual(decide({ tape: null }), { action: 'instant', reason: 'bad-tape' });
  assert.deepEqual(decide({ place: 30 }), { action: 'instant', reason: 'bad-place' });
  assert.deepEqual(decide({ place: -1 }), { action: 'instant', reason: 'bad-place' });
  assert.deepEqual(decide({ pid: null }), { action: 'instant', reason: 'bad-place' });
  // Event seq reads lastEvent first, then lastCascade, defaulting to zero.
  assert.equal(visual.eventSeq({ lastEvent: { seq: 3 }, lastCascade: { seq: 2 } }), 3);
  assert.equal(visual.eventSeq({ lastEvent: null, lastCascade: { seq: 2 } }), 2);
  assert.equal(visual.eventSeq({}), 0);
  assert.equal(visual.eventSeq(null), 0);
  console.log('VISUAL decide: animate/queue/instant/ignore across rematch, dedupe, gaps, truncation, motion, layout');
}

decideTests();
geometryTests();
stepTests();
replayEngineTapes();
truncationTests();
timingTests();
console.log('CHAIN_VISUAL_PASS');
