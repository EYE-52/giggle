/* Chain Reaction arena scene tests: the Canvas2D reactor presentation in
 * public/js/renderers/chain-scene.mjs, exercised behaviorally (no mirrored
 * source-string checks) against real engine geometry and tapes.
 * Run with: node test/chain-arena.mjs */
import assert from 'node:assert/strict';
import engine from '../games/engines/chain-reaction.js';
import game from '../games/chain-reaction/server.js';
import * as scene from '../public/js/renderers/chain-scene.mjs';

const { geometry } = engine;

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

/* Headless 2D context: every method is a recorder no-op. */
function fakeContext(calls) {
  return new Proxy({}, {
    get: (t, k) => {
      if (k === '__calls') return calls;
      if (typeof k !== 'string') return undefined;
      return (...args) => { calls.push([k, args]); };
    },
    set: () => true,
  });
}

function fakeCanvas(w = 400, h = 480) {
  const calls = [];
  const ctx = fakeContext(calls);
  return {
    calls,
    canvas: {
      clientWidth: w, clientHeight: h, width: 0, height: 0,
      getContext: (type) => (type === '2d' ? ctx : null),
    },
  };
}

const CANDY = game.CHAIN_CONFIG.palettes.Candy;
const INK = game.CHAIN_CONFIG.palettes.Ink;

function geometryTests() {
  for (const [cols, rows] of [[5, 6], [6, 8]]) {
    const grid = geometry(cols, rows);
    const L = scene.layoutBoard(cols, rows, 480, 640);
    assert.equal(L.centers.length, cols * rows);
    assert.equal(L.visualCols, cols);
    assert.equal(L.visualRows, rows);
    assert.equal(L.transposed, false);
    assert(L.cell > 0 && L.wellRadius > 0 && L.atomRadius > 0);
    const seen = new Set();
    for (let i = 0; i < cols * rows; i++) {
      assert.deepEqual(scene.neighborsOf(cols, rows, i), grid.neighbors[i],
        `scene neighbor order matches the engine at ${cols}x${rows}:${i}`);
      assert.equal(scene.capacityAt(cols, rows, i), grid.capacities[i]);
      assert.equal(L.capacities[i], grid.capacities[i]);
      assert.deepEqual(L.ports[i].map(p => p.dst), grid.neighbors[i]);
      for (const port of L.ports[i]) {
        const dst = L.centers[port.dst], src = L.centers[i];
        assert.equal(port.x, Math.sign(dst.x - src.x));
        assert.equal(port.y, Math.sign(dst.y - src.y));
      }
      const p = L.centers[i];
      assert(p.x >= 0 && p.x <= 480 && p.y >= 0 && p.y <= 640, 'well centers stay in bounds');
      const key = p.x.toFixed(2) + ',' + p.y.toFixed(2);
      assert(!seen.has(key), 'well centers are unique');
      seen.add(key);
      assert.equal(L.visualOrder[i], i, 'untransposed visual order is identity');
      assert.equal(scene.visualIndexFor(i, cols, rows, false), i);
    }
    assert.deepEqual([L.capacities[0], L.capacities[1], L.capacities[cols + 1]], [2, 3, 4],
      'corner/edge/inner capacities disclose burst thresholds');
  }
  console.log('ARENA geometry: wells unique/in-bounds, neighbors/capacities match the engine on 5x6, 6x8');
}

function transposeTests() {
  assert.equal(scene.shouldTranspose(6, 8, () => ({ matches: true })), true);
  assert.equal(scene.shouldTranspose(6, 8, () => ({ matches: false })), false);
  assert.equal(scene.shouldTranspose(5, 6, () => ({ matches: true })), false, 'Compact never transposes');
  assert.equal(scene.shouldTranspose(6, 8, () => { throw new Error('no media'); }), false);
  const L = scene.layoutBoard(6, 8, 640, 320, { transpose: true });
  assert.equal(L.transposed, true);
  assert.equal(L.visualCols, 8);
  assert.equal(L.visualRows, 6);
  assert.equal(L.centers.length, 48);
  /* Logical (x,y) -> visual col=y, row=x: logical 1 (1,0) sits below
   * logical 0 (0,0); logical 6 (0,1) sits right of logical 0. */
  const [c0, c1, c6] = [L.centers[0], L.centers[1], L.centers[6]];
  assert(Math.abs(c1.x - c0.x) < 0.01 && Math.abs(c1.y - c0.y - L.cell) < 0.01);
  assert(Math.abs(c6.y - c0.y) < 0.01 && Math.abs(c6.x - c0.x - L.cell) < 0.01);
  assert.equal(scene.visualIndexFor(0, 6, 8, true), 0);
  assert.equal(scene.visualIndexFor(1, 6, 8, true), 8);
  assert.equal(scene.visualIndexFor(6, 6, 8, true), 1);
  assert.equal(L.visualOrder[1], 8);
  assert.equal(L.visualOrder[6], 1);
  assert.deepEqual(L.ports[0].map(p => [p.dst, p.x, p.y]), [[1, 0, 1], [6, 1, 0]],
    'corner ports rotate with real visual neighbors, no phantom top/left connection');
  const plain = scene.layoutBoard(6, 8, 640, 320);
  assert.equal(plain.transposed, false);
  assert.equal(plain.visualCols, 6);
  console.log('ARENA transpose: Standard 6x8 shows 8x6 visually, logical indices unchanged');
}

function paletteTests() {
  const mapped = scene.displayPalette(CANDY, 'Candy');
  assert.equal(mapped.length, CANDY.length, 'no seats invented or dropped');
  assert.equal(mapped[0].color, '#ff718f');
  assert.equal(mapped[1].color, '#71edd1');
  assert.equal(mapped[2].color, '#ffd23d');
  for (let i = 0; i < CANDY.length; i++) {
    assert.equal(mapped[i].shape, CANDY[i].shape, 'owner glyphs preserved');
    assert.equal(mapped[i].label, CANDY[i].label);
  }
  assert.equal(mapped[3].color, CANDY[3].color, 'later Candy seats keep their hues');
  const ink = scene.displayPalette(INK, 'Ink');
  assert.deepEqual(ink, INK, 'the chosen Ink palette passes through untouched');
  const colors = new Set(mapped.slice(0, 3).map((e) => e.color.toLowerCase()));
  assert.equal(colors.size, 3, 'arena ownership hues contrast, never one pastel gray');
  assert.deepEqual(scene.displayPalette(null, 'Candy'), []);
  console.log('ARENA palette: Candy coral/teal/yellow + glyphs, Ink untouched, no fake seats');
}

function fallbackTests() {
  for (const [name, canvas] of [
    ['null canvas', null],
    ['no getContext', {}],
    ['null context', { getContext: () => null }],
    ['throwing context', { getContext: () => { throw new Error('blocked'); } }],
    ['wrong context kind', { getContext: () => undefined }],
  ]) {
    const s = scene.createChainScene(canvas, { cols: 5, rows: 6 });
    assert.equal(s.fallback, true, name + ' falls back');
    assert.doesNotThrow(() => {
      s.setBoard([{ owner: 'p0', orbs: 1 }]);
      s.setFocus(0); s.setPlayable([0]); s.setDimmed(true); s.setReducedMotion(true);
      s.onPlacement(0); s.onBurst(0); s.onFlight(0, [1], '#fff', 100); s.onArrival([1]);
      s.clearEphemeral(); s.resize(100, 100); s.dispose(); s.dispose();
    }, name + ' methods never throw');
    assert.equal(s.isDisposed(), true, name + ' dispose sticks');
  }
  /* Fallback still tracks the newest board for the semantic DOM. */
  const s = scene.createChainScene(null);
  const board = [{ owner: 'p0', orbs: 2 }, { owner: null, orbs: 0 }];
  s.setBoard(board);
  board[0].orbs = 99;
  assert.equal(s.getBoard()[0].orbs, 2, 'fallback keeps a copy, never the caller array');
  console.log('ARENA fallback: missing canvas/context resolves to safe semantic-DOM no-ops');
}

function syncTests() {
  const { canvas, calls } = fakeCanvas();
  const s = scene.createChainScene(canvas, {
    cols: 5, rows: 6, palette: CANDY, paletteName: 'Candy', order: ['p0', 'p1'],
  });
  assert.equal(s.fallback, false);
  assert.equal(s.getLayout().centers.length, 30);
  const empty = Array.from({ length: 30 }, () => ({ owner: null, orbs: 0 }));
  s.setBoard(empty, { order: ['p0', 'p1'] });
  assert.equal(s.getBoard().length, 30);
  assert(calls.length > 0, 'sync paints the arena');
  /* Newest board always wins; later syncs replace earlier ones wholesale. */
  const first = empty.map((c) => ({ ...c }));
  first[0] = { owner: 'p0', orbs: 1 };
  const second = first.map((c) => ({ ...c }));
  second[0] = { owner: 'p0', orbs: 2 };
  second[1] = { owner: 'p1', orbs: 1 };
  s.setBoard(first);
  s.setBoard(second);
  assert.deepEqual(s.getBoard(), second, 'sync lands on the newest shown board');
  first[0].orbs = 99;
  assert.equal(s.getBoard()[0].orbs, 2, 'sync copies, never aliases');
  /* Palette mapping is behavioral: flights take the seat display color. */
  s.onFlight(0, [1], 'p0', 160);
  assert.equal(s.getTrails()[0].color, '#ff718f', 'Candy seat 0 flies coral');
  assert.equal(s.getTrails()[0].shape, 'circle');
  s.clearEphemeral();
  s.setBoard(second, { palette: INK, paletteName: 'Ink', order: ['p0', 'p1'] });
  s.onFlight(0, [1], 'p0', 160);
  assert.equal(s.getTrails()[0].color, INK[0].color, 'repalette recolors flights');
  s.dispose();
  console.log('ARENA sync: newest board wins by copy, palette remaps seat colors behaviorally');
}

function flightAlignmentTests() {
  const { canvas, calls } = fakeCanvas(480, 640);
  const s = scene.createChainScene(canvas, {
    cols: 5, rows: 6, palette: CANDY, paletteName: 'Candy', order: ['p0', 'p1'],
  });
  const grid = geometry(5, 6);
  const board = Array.from({ length: 30 }, () => ({ owner: null, orbs: 0 }));
  board[0] = { owner: 'p0', orbs: 2 };
  s.setBoard(board, { order: ['p0', 'p1'] });
  const L = s.getLayout();
  const lines = calls.filter(([method]) => method === 'moveTo').map(([, args]) => args);
  const p = L.centers[0], r = L.wellRadius + 3;
  assert(lines.some(([x, y]) => Math.abs(x - (p.x + r)) < 1e-8 && y === p.y), 'renderer paints the corner right port');
  assert(lines.some(([x, y]) => x === p.x && Math.abs(y - (p.y + r)) < 1e-8), 'renderer paints the corner down port');
  assert(!lines.some(([x, y]) => x === p.x && Math.abs(y - (p.y - r)) < 1e-8), 'renderer never paints a top port on the top-left corner');
  /* Source shock sits exactly on the source well. */
  s.onBurst(0);
  assert.equal(s.getShocks().length, 1);
  assert.equal(s.getShocks()[0].index, 0);
  assert(L.centers[0], 'source well exists');
  /* One trail per orthogonal neighbor, endpoints on the logical wells. */
  const dsts = grid.neighbors[0];
  assert.deepEqual(dsts, [1, 5]);
  const spent = board.map(c => ({...c})); spent[0] = {owner:null,orbs:0};
  s.setBoard(spent); s.onBurst(0, 'p0');
  assert.equal(s.getShocks().at(-1).color, '#ff718f', 'burst shock retains the actor color after source empties');
  s.onFlight(0, dsts, 'p0', 160);
  const trails = s.getTrails();
  assert.equal(trails.length, 2, 'a corner trails exactly its two neighbors');
  for (const t of trails) {
    assert.equal(t.src, 0);
    assert(dsts.includes(t.dst));
    const a = L.centers[t.src], b = L.centers[t.dst];
    const manhattan = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    assert(Math.abs(manhattan - L.cell) < 0.01, 'trails run well-center to adjacent well-center');
  }
  assert(s.getTrails().every((t) => t.until > t.start), 'trails carry a visible lifetime');
  /* Skip clears every ephemeral trail and shock at once. */
  s.clearEphemeral();
  assert.deepEqual(s.getTrails(), []);
  assert.deepEqual(s.getShocks(), []);
  /* Transposed Standard keeps flight endpoints on transposed wells. */
  const big = fakeCanvas(640, 320);
  const s2 = scene.createChainScene(big.canvas, {
    cols: 6, rows: 8, palette: CANDY, paletteName: 'Candy', order: ['p0', 'p1'],
  });
  const b48 = Array.from({ length: 48 }, () => ({ owner: null, orbs: 0 }));
  s2.setBoard(b48, { transpose: true, cols: 6, rows: 8 });
  const L2 = s2.getLayout();
  assert.equal(L2.visualCols, 8);
  s2.onFlight(0, [1, 6], 'p0', 160);
  for (const t of s2.getTrails()) {
    const a = L2.centers[t.src], b = L2.centers[t.dst];
    assert(Math.abs(Math.abs(a.x - b.x) + Math.abs(a.y - b.y) - L2.cell) < 0.01);
  }
  s.dispose(); s2.dispose();
  console.log('ARENA flights: source shock + per-neighbor trails aligned to logical wells, skip clears');
}

function cleanupTests() {
  const { canvas } = fakeCanvas();
  const board = Array.from({ length: 30 }, () => ({ owner: null, orbs: 0 }));
  board[0] = { owner: 'p0', orbs: 1 };
  /* Rematch geometry swap drops in-flight ephemera. */
  const s = scene.createChainScene(canvas, {
    cols: 5, rows: 6, palette: CANDY, paletteName: 'Candy', order: ['p0', 'p1'],
  });
  s.setBoard(board, { order: ['p0', 'p1'] });
  s.onFlight(0, [1], 'p0', 160);
  assert.equal(s.getTrails().length, 1);
  s.setBoard(Array.from({ length: 48 }, () => ({ owner: null, orbs: 0 })), { cols: 6, rows: 8 });
  assert.deepEqual(s.getTrails(), [], 'rematch clears flights');
  assert.equal(s.getLayout().centers.length, 48);
  /* Reduced motion resolves quietly: no trails, but state stays correct. */
  s.setReducedMotion(true);
  s.setBoard(board, { cols: 5, rows: 6 });
  s.onBurst(0);
  s.onFlight(0, [1], 'p0', 160);
  assert.deepEqual(s.getTrails(), [], 'reduced motion flies nothing');
  assert.deepEqual(s.getShocks(), [], 'reduced motion shocks nothing');
  assert.deepEqual(s.getBoard(), board, 'reduced motion still syncs state');
  s.setReducedMotion(false);
  s.onFlight(0, [1], 'p0', 160);
  assert.equal(s.getTrails().length, 1, 'motion returns after the preference lifts');
  /* Async-dispose shape: initialize to newest, dispose immediately, never revive. */
  s.setBoard(board);
  s.dispose();
  s.dispose();
  assert.equal(s.isDisposed(), true);
  s.setBoard(board);
  s.onFlight(0, [1], 'p0', 160);
  s.clearEphemeral();
  assert.deepEqual(s.getTrails(), [], 'disposed scenes never revive trails');
  /* Fresh scenes start clean even under reduced motion. */
  const quiet = scene.createChainScene(fakeCanvas().canvas, {
    cols: 5, rows: 6, reducedMotion: true,
  });
  quiet.setBoard(board);
  assert.deepEqual(quiet.getBoard(), board);
  quiet.dispose();
  console.log('ARENA cleanup: rematch drops flights, reduced motion stays correct+quiet, dispose never revives');
}

function realTapeFlowTests() {
  /* Renderer-shaped flow over a real authoritative tape: baseline sync,
   * source burst + neighbor flights, then settle equals the server board. */
  const ctx = new Clock(2);
  const st = game.create(ctx);
  game.onAction(st, ctx, 'p0', { x: 0, y: 0, turnNo: st.turnNo });
  game.onAction(st, ctx, 'p1', { x: 4, y: 5, turnNo: st.turnNo });
  const before = st.board.map((c) => ({ ...c }));
  game.onAction(st, ctx, 'p0', { x: 0, y: 0, turnNo: st.turnNo });
  assert.deepEqual(st.lastCascade.tape, [0], 'fixture bursts the corner once');
  const { canvas } = fakeCanvas();
  const pal = st.palette || CANDY;
  const s = scene.createChainScene(canvas, {
    cols: st.cols, rows: st.rows, palette: pal, order: st.order,
  });
  s.setBoard(before, { order: st.order, palette: pal });
  const grid = geometry(st.cols, st.rows);
  s.onBurst(0);
  s.onFlight(0, grid.neighbors[0], 'p0', 160);
  assert.equal(s.getTrails().length, grid.neighbors[0].length);
  s.clearEphemeral();
  s.setBoard(st.board, { order: st.order });
  assert.deepEqual(s.getBoard(), st.board, 'arena settles on the authoritative board');
  assert.equal(s.getBoard().reduce((n, c) => n + c.orbs, 0),
    before.reduce((n, c) => n + c.orbs, 0) + 1, 'one real move conserves plus one');
  s.dispose();
  game.dispose(st);
  console.log('ARENA tape flow: burst+flights over a real corner tape settle on the server board');
}

function frameBudgetTests() {
  const oldRAF = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
  const frames = new Map(); let id = 0;
  globalThis.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
  globalThis.cancelAnimationFrame = n => frames.delete(n);
  const next = time => { const [n, fn] = frames.entries().next().value; frames.delete(n); fn(time); };
  try {
    const {canvas} = fakeCanvas(264,352);
    const s = scene.createChainScene(canvas,{cols:6,rows:8,order:['p0'],palette:CANDY,paletteName:'Candy'});
    const empty = Array.from({length:48},()=>({owner:null,orbs:0}));
    s.setBoard(empty); next(16);
    assert.equal(frames.size,0,'empty arena rests instead of consuming an idle frame loop');
    const cluster = empty.map(c=>({...c})); cluster[0]={owner:'p0',orbs:2};
    s.setBoard(cluster); next(32);
    assert.equal(frames.size,1,'a multi-atom cluster keeps its orbital motion between turns');
    s.setReducedMotion(true);
    assert.equal(frames.size,0,'motion preference cancels the live scene frame');
    s.setReducedMotion(false);
    assert.equal(frames.size,1,'lifting reduced motion resumes orbital animation');
    s.dispose(); const layout=s.getLayout(); s.resize(800,800);s.clearEphemeral();s.setBoard(cluster);
    assert.equal(frames.size,0,'disposal stops the frame and no later update revives it');
    assert.equal(s.getLayout(),layout,'disposed resize cannot reallocate the arena');
  } finally {
    if(oldRAF===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=oldRAF;
    if(oldCancel===undefined)delete globalThis.cancelAnimationFrame;else globalThis.cancelAnimationFrame=oldCancel;
  }
  console.log('ARENA frame budget: empty rests, clusters rotate, preference and disposal stop the loop');
}

geometryTests();
transposeTests();
paletteTests();
fallbackTests();
syncTests();
flightAlignmentTests();
cleanupTests();
realTapeFlowTests();
frameBudgetTests();
console.log('CHAIN_ARENA_PASS');
