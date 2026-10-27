/* Chain Reaction reactor arena scene: Canvas2D presentation only.
 *
 * Dark energy chamber behind the semantic button grid. Draws subtle circular
 * wells, ports aligned to real neighbors, spherical owned atoms with restrained glow
 * and shape glyphs, continuous burst trails along logical neighbors, arrival
 * flashes, focus light, and idle cluster rotation. No gameplay authority:
 * the renderer syncs every patchCells from d.shown; this module never sends
 * actions, never computes outcomes, and settles to whatever board it is given.
 *
 * Fallback: a missing canvas or 2D context resolves to a no-op handle with
 * { fallback: true } so the semantic DOM stays pleasant and fully playable.
 * Reduced motion stops the frame loop and draws one static board per sync.
 */

export const ARENA_BG = '#080f1d';
export const ARENA_DEPTH = '#122744';
export const ARENA_TEAL = '#71edd1';
export const ARENA_CORAL = '#ff718f';
export const ARENA_YELLOW = '#ffd23d';

/* Default Candy seats remapped to arena hues; shapes/labels preserved.
 * Ink and any other palette pass through untouched. No seats invented. */
const CANDY_ARENA = [ARENA_CORAL, ARENA_TEAL, ARENA_YELLOW];
const CANDY_DEFAULTS = ['#ff557c', '#36dec4', '#ffd15c'];

export function displayPalette(palette, paletteName) {
  if (!Array.isArray(palette)) return [];
  return palette.map((entry, i) => {
    const color = typeof entry?.color === 'string' ? entry.color : '#ffffff';
    const shape = typeof entry?.shape === 'string' ? entry.shape : 'circle';
    const label = typeof entry?.label === 'string' ? entry.label : shape;
    if (paletteName === 'Candy' && i < CANDY_ARENA.length) {
      return { color: CANDY_ARENA[i], shape, label };
    }
    /* Also normalize when the snapshot carries Candy default hexes without
     * a palette name (defensive; server always sends the name). */
    if ((paletteName === undefined || paletteName === null) && i < CANDY_ARENA.length &&
        color.toLowerCase() === CANDY_DEFAULTS[i]) {
      return { color: CANDY_ARENA[i], shape, label };
    }
    return { color, shape, label };
  });
}

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

/* Short-landscape transpose: Standard 6x8 logical becomes 8x6 visual.
 * Logical indices and actions stay unchanged; arrow focus follows the
 * visual placement matrix transposes. queryFn is injectable for tests. */
export function shouldTranspose(cols, rows, queryFn) {
  try {
    if (cols !== 6 || rows !== 8) return false;
    const mq = typeof queryFn === 'function'
      ? queryFn('(min-width:560px) and (max-height:500px)')
      : (typeof matchMedia === 'function'
        ? matchMedia('(min-width:560px) and (max-height:500px)') : null);
    return !!mq && mq.matches === true;
  } catch {
    return false;
  }
}

/* Visual order index for CSS `order` + canvas placement. Transposed Standard:
 * logical (x,y) -> visual col=y, row=x in an 8x6 matrix. */
export function visualIndexFor(logical, cols, rows, transposed) {
  if (transposed && cols === 6 && rows === 8) {
    const x = logical % cols;
    const y = Math.floor(logical / cols);
    return x * 8 + y;
  }
  return logical;
}

export function layoutBoard(cols, rows, width, height, opts = {}) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const transposed = opts.transpose === true && cols === 6 && rows === 8;
  const visualCols = transposed ? 8 : cols;
  const visualRows = transposed ? 6 : rows;
  const pad = Math.max(0, Number(opts.pad) || 0);
  const cell = Math.max(1, Math.min((w - pad * 2) / visualCols, (h - pad * 2) / visualRows));
  const gridW = cell * visualCols;
  const gridH = cell * visualRows;
  const originX = (w - gridW) / 2;
  const originY = (h - gridH) / 2;
  const centers = [];
  const capacities = [];
  const visualOrder = [];
  for (let i = 0; i < cols * rows; i++) {
    const x = i % cols;
    const y = Math.floor(i / cols);
    const vc = transposed ? y : x;
    const vr = transposed ? x : y;
    centers.push({ x: originX + (vc + 0.5) * cell, y: originY + (vr + 0.5) * cell });
    capacities.push(capacityAt(cols, rows, i));
    visualOrder.push(transposed ? x * 8 + y : i);
  }
  return {
    cols, rows, visualCols, visualRows, transposed, cell,
    originX, originY, width: w, height: h,
    wellRadius: cell * 0.34, atomRadius: cell * 0.17,
    centers, capacities, visualOrder,
    ports: centers.map((p, i) => neighborsOf(cols, rows, i).map(dst => {
      const other = centers[dst], length = Math.hypot(other.x - p.x, other.y - p.y);
      return { dst, x: (other.x - p.x) / length, y: (other.y - p.y) / length };
    })),
  };
}

function cloneBoard(board) {
  return Array.isArray(board) ? board.map((c) => ({ owner: c?.owner ?? null, orbs: c?.orbs ?? 0 })) : [];
}

function noopHandle(reason) {
  const state = { fallback: true, reason, disposed: false, board: [], layout: null };
  return {
    fallback: true,
    reason,
    isDisposed: () => state.disposed,
    getLayout: () => state.layout,
    getBoard: () => state.board.map((c) => ({ ...c })),
    getTrails: () => [],
    getShocks: () => [],
    setBoard: (b) => { if (!state.disposed) state.board = cloneBoard(b); },
    setFocus: () => {},
    setPlayable: () => {},
    setDimmed: () => {},
    setReducedMotion: () => {},
    onPlacement: () => {},
    onBurst: () => {},
    onFlight: () => {},
    onArrival: () => {},
    clearEphemeral: () => {},
    resize: () => {},
    dispose: () => { state.disposed = true; },
  };
}

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return { r: 255, g: 255, b: 255 };
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawGlyph(ctx, shape, x, y, r) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  if (shape === 'diamond') {
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
    ctx.closePath(); ctx.fill();
  } else if (shape === 'square') {
    ctx.fillRect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
  } else if (shape === 'triangle') {
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * 0.8); ctx.lineTo(x - r, y + r * 0.8);
    ctx.closePath(); ctx.fill();
  } else if (shape === 'star') {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 === 0 ? r : r * 0.45;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  } else if (shape === 'cross') {
    const t = r * 0.42;
    ctx.fillRect(x - t, y - r, t * 2, r * 2);
    ctx.fillRect(x - r, y - t, r * 2, t * 2);
  } else {
    ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/* Flat orb: one fill, a darker edge, the seat glyph. No gloss or glow. */
function drawSphere(ctx, x, y, r, color, shape, glow, dimmed) {
  const { r: cr, g: cg, b: cb } = hexToRgb(color);
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.14);
  ctx.strokeStyle = `rgb(${Math.round(cr * 0.62)},${Math.round(cg * 0.62)},${Math.round(cb * 0.62)})`;
  if (dimmed) ctx.globalAlpha = 0.8;
  ctx.stroke();
  ctx.restore();
  drawGlyph(ctx, shape, x, y, r * 0.42);
}

const MAX_TRAILS = 64;
const MAX_SHOCKS = 16;

export function createChainScene(canvas, opts = {}) {
  let ctx = null;
  try {
    if (!canvas || typeof canvas.getContext !== 'function') return noopHandle('no-canvas');
    ctx = canvas.getContext('2d');
    if (!ctx) return noopHandle('no-context');
  } catch {
    return noopHandle('context-failed');
  }

  const state = {
    fallback: false,
    disposed: false,
    cols: Number(opts.cols) || 5,
    rows: Number(opts.rows) || 6,
    transpose: opts.transpose === true,
    palette: displayPalette(opts.palette || [], opts.paletteName),
    paletteName: opts.paletteName,
    order: Array.isArray(opts.order) ? opts.order.slice() : [],
    board: cloneBoard(opts.board || []),
    playable: new Set(),
    focus: null,
    dimmed: opts.dimmed === true,
    reducedMotion: opts.reducedMotion === true,
    trails: [],
    shocks: [],
    flashes: [],
    rotation: 0,
    lastFrame: 0,
    rafId: 0,
    ro: null,
    onResize: null,
    width: 0,
    height: 0,
    layout: null,
    colorByPid: new Map(),
  };

  /* Well colours follow the page tokens (via --cr-well / --cr-well-line /
   * --cr-focus on the board); the old reactor values are the fallback. */
  const theme = { well: 'rgba(18,39,68,0.55)', wellFocus: 'rgba(28,52,92,0.85)', line: 'rgba(148,178,220,0.14)', playable: 'rgba(113,237,209,0.38)', focus: 'rgba(113,237,209,0.9)', port: 'rgba(200,220,245,0.22)', portFocus: 'rgba(255,255,255,0.55)', count: 'rgba(240,243,250,0.95)' };
  const readTheme = () => {
    try {
      if (typeof getComputedStyle !== 'function') return;
      const cs = getComputedStyle(canvas);
      const v = (name) => String(cs.getPropertyValue(name) || '').trim();
      const well = v('--cr-well'), line = v('--cr-well-line'), play = v('--cr-well-play'), focus = v('--cr-focus'), ink = v('--ink');
      if (well) { theme.well = well; theme.wellFocus = well; }
      if (line) { theme.line = line; theme.port = line; }
      if (play) theme.playable = play;
      if (focus) { theme.focus = focus; theme.portFocus = focus; }
      if (ink) theme.count = ink;
    } catch { /* keep fallbacks */ }
  };
  readTheme();

  const measure = () => {
    const w = Math.max(1, Math.floor(canvas.clientWidth || canvas.width || 300));
    const h = Math.max(1, Math.floor(canvas.clientHeight || canvas.height || 300));
    return { w, h };
  };

  const relayout = () => {
    readTheme();
    const { w, h } = measure();
    let dpr = 1;
    try { dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1); } catch { dpr = 1; }
    try {
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
    } catch { /* fixed-size fake canvas keeps its dims */ }
    state.width = w; state.height = h;
    state.layout = layoutBoard(state.cols, state.rows, w, h, { transpose: state.transpose, pad: 0 });
  };

  const colorFor = (pid) => {
    if (pid === null || pid === undefined) return '#ffffff';
    if (state.colorByPid.has(pid)) return state.colorByPid.get(pid);
    const seat = state.order.indexOf(pid);
    const entry = seat >= 0 ? state.palette[seat] : null;
    const color = entry?.color || '#ffffff';
    state.colorByPid.set(pid, color);
    return color;
  };

  const shapeFor = (pid) => {
    const seat = state.order.indexOf(pid);
    const entry = seat >= 0 ? state.palette[seat] : null;
    return entry?.shape || 'circle';
  };

  function drawWell(c, i, now) {
    const L = state.layout;
    if (!L) return;
    const p = L.centers[i];
    const R = L.wellRadius;
    const focused = state.focus === i;
    const playable = state.playable.has(i);
    ctx.save();
    /* Very subtle circular well; no rectangles anywhere. */
    ctx.beginPath();
    ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
    ctx.fillStyle = focused ? theme.wellFocus : theme.well;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
    ctx.strokeStyle = focused ? theme.focus : playable ? theme.playable : theme.line;
    ctx.lineWidth = focused ? 3 : playable ? 2 : 1;
    ctx.stroke();
    // A port is an actual burst path, not an evenly spaced decoration.
    // Its direction follows visual centers, including a transposed board.
    const cap = L.capacities[i] || 0;
    if (cap > 0) {
      const rr = R + 5;
      ctx.strokeStyle = focused ? theme.portFocus : theme.port;
      ctx.lineWidth = 1.5;
      for (const port of L.ports[i]) {
        ctx.beginPath();
        ctx.moveTo(p.x + port.x * (rr - 2), p.y + port.y * (rr - 2));
        ctx.lineTo(p.x + port.x * (rr + 2), p.y + port.y * (rr + 2));
        ctx.stroke();
      }
      const flash = state.flashes.find((f) => f.index === i && now < f.until);
      if (flash) {
        const k = 1 - (flash.until - now) / 220;
        ctx.beginPath();
        ctx.arc(p.x, p.y, R + 2 + k * 4, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(flash.color, Math.max(0, 0.7 * (1 - k)));
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawAtoms(c, i, now) {
    const L = state.layout;
    if (!L || !c || !c.orbs) return;
    const p = L.centers[i];
    const color = colorFor(c.owner);
    const shape = shapeFor(c.owner);
    const n = Math.min(4, c.orbs);
    const spread = L.wellRadius * 0.38;
    const r = Math.max(3, Math.min(L.atomRadius, L.atomRadius * (n === 1 ? 1.25 : 1)));
    const base = state.rotation + i * 0.7;
    ctx.save();
    if (state.dimmed) ctx.globalAlpha = 0.62;
    if (n === 1) {
      drawSphere(ctx, p.x, p.y, r * 1.15, color, shape, true, state.dimmed);
    } else {
      for (let k = 0; k < n; k++) {
        const a = base + (k * Math.PI * 2) / n;
        drawSphere(ctx, p.x + Math.cos(a) * spread, p.y + Math.sin(a) * spread, r, color, shape, true, state.dimmed);
      }
    }
    ctx.restore();
    if (c.orbs > 4) {
      ctx.save();
      ctx.fillStyle = theme.count;
      ctx.font = `700 ${Math.max(16, Math.round(L.cell * 0.18))}px system-ui,sans-serif`;
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      try { ctx.fillText(String(c.orbs), p.x + L.wellRadius, p.y + L.wellRadius + 2); } catch { /* headless */ }
      ctx.restore();
    }
  }

  function drawTrails(now) {
    const L = state.layout;
    if (!L) return;
    state.trails = state.trails.filter((t) => now < t.until);
    for (const t of state.trails) {
      const a = L.centers[t.src];
      const b = L.centers[t.dst];
      if (!a || !b) continue;
      const life = Math.max(1, t.until - t.start);
      const age = Math.min(1, Math.max(0, (now - t.start) / life));
      const head = Math.min(1, (now - t.start) / Math.max(1, t.travelMs));
      const alpha = (1 - age) * (state.dimmed ? 0.5 : 0.9);
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.strokeStyle = t.color;
      ctx.lineWidth = Math.max(2, L.cell * 0.045);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + (b.x - a.x) * head, a.y + (b.y - a.y) * head);
      ctx.stroke();
      ctx.globalAlpha = Math.max(0, alpha * 0.35);
      ctx.lineWidth = Math.max(4, L.cell * 0.09);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const hx = a.x + (b.x - a.x) * head;
      const hy = a.y + (b.y - a.y) * head;
      ctx.globalAlpha = Math.max(0, alpha);
      drawSphere(ctx, hx, hy, Math.max(3, L.atomRadius * 0.8), t.color, t.shape, false, state.dimmed);
      ctx.restore();
    }
  }

  function drawShocks(now) {
    const L = state.layout;
    if (!L) return;
    state.shocks = state.shocks.filter((s) => now < s.until);
    for (const s of state.shocks) {
      const p = L.centers[s.index];
      if (!p) continue;
      const k = 1 - (s.until - now) / s.ms;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 0.65 * (1 - k));
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, L.wellRadius * (0.6 + k * 1.1), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function draw(now) {
    if (state.disposed || !ctx || !state.layout) return;
    const t = typeof now === 'number' ? now : 0;
    try {
      let dpr = 1;
      try { dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1); } catch { dpr = 1; }
      ctx.save();
      try { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); } catch { /* older fake */ }
      ctx.clearRect(0, 0, state.width, state.height);
      // The chamber wash belongs to the full viewport, so the canvas edge
      // never becomes a rectangular panel. Wells, atoms and energy are drawn
      // here over that continuous background.
      for (let i = 0; i < state.board.length; i++) drawWell(state.board[i], i, t);
      drawTrails(t);
      for (let i = 0; i < state.board.length; i++) drawAtoms(state.board[i], i, t);
      drawShocks(t);
      ctx.restore();
    } catch { /* presentation must never break the game */ }
  }

  const loop = (now) => {
    if (state.disposed || state.reducedMotion) { state.rafId = 0; return; }
    const t = typeof now === 'number' ? now : 0;
    if (state.lastFrame) {
      const dt = Math.min(0.1, Math.max(0, (t - state.lastFrame) / 1000));
      state.rotation = (state.rotation + dt * 0.6) % (Math.PI * 2);
    }
    state.lastFrame = t;
    draw(t);
    /* Idle rotation + trails animate only while something lives. Wells and
     * atoms repaint on sync; the loop idles to save battery otherwise. */
    state.flashes = state.flashes.filter((f) => t < f.until);
    const alive = state.trails.length || state.shocks.length || state.flashes.length || state.board.some((c) => c.orbs > 1);
    try {
      if (typeof requestAnimationFrame === 'function' && alive) {
        state.rafId = requestAnimationFrame(loop);
      } else {
        state.rafId = 0;
      }
    } catch { state.rafId = 0; }
  };

  const kick = () => {
    if (state.disposed) return;
    if (state.reducedMotion) {
      let t = 0;
      try { t = (typeof performance === 'object' && typeof performance.now === 'function') ? performance.now() : Date.now(); } catch { t = 0; }
      draw(t);
      return;
    }
    if (!state.rafId && typeof requestAnimationFrame === 'function') {
      try { state.rafId = requestAnimationFrame(loop); } catch { state.rafId = 0; draw(0); }
    } else if (!state.rafId) {
      draw(0);
    }
  };

  relayout();
  if (Array.isArray(opts.playable)) state.playable = new Set(opts.playable);
  if (Number.isInteger(opts.focus)) state.focus = opts.focus;
  state.order = Array.isArray(opts.order) ? opts.order.slice() : state.order;

  try {
    if (typeof ResizeObserver === 'function' && canvas && canvas.parentNode) {
      state.ro = new ResizeObserver(() => {
        if (state.disposed) return;
        relayout(); kick();
      });
      state.ro.observe(canvas.parentNode);
    }
  } catch { state.ro = null; }
  try {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      state.onResize = () => { if (!state.disposed) { relayout(); kick(); } };
      window.addEventListener('resize', state.onResize);
    }
  } catch { state.onResize = null; }

  const api = {
    fallback: false,
    isDisposed: () => state.disposed,
    getLayout: () => state.layout,
    getBoard: () => state.board.map((c) => ({ owner: c.owner, orbs: c.orbs })),
    getTrails: () => state.trails.map((t) => ({ ...t })),
    getShocks: () => state.shocks.map((s) => ({ ...s })),
    setBoard: (board, meta = {}) => {
      readTheme();
      if (state.disposed) return;
      if (meta && (Number.isInteger(meta.cols) || Number.isInteger(meta.rows) ||
          typeof meta.transpose === 'boolean')) {
        const nc = Number.isInteger(meta.cols) ? meta.cols : state.cols;
        const nr = Number.isInteger(meta.rows) ? meta.rows : state.rows;
        const nt = typeof meta.transpose === 'boolean' ? meta.transpose : state.transpose;
        if (nc !== state.cols || nr !== state.rows || nt !== state.transpose) {
          state.cols = nc; state.rows = nr; state.transpose = nt;
          state.trails.length = 0; state.shocks.length = 0; state.flashes.length = 0;
          relayout();
        }
      }
      state.board = cloneBoard(board);
      if (meta && Array.isArray(meta.palette)) {
        state.palette = displayPalette(meta.palette, meta.paletteName ?? state.paletteName);
        state.paletteName = meta.paletteName ?? state.paletteName;
        state.colorByPid.clear();
      }
      if (meta && Array.isArray(meta.order)) {
        state.order = meta.order.slice();
        state.colorByPid.clear();
      }
      if (meta && Array.isArray(meta.playable)) state.playable = new Set(meta.playable);
      if (meta && (Number.isInteger(meta.focus) || meta.focus === null)) state.focus = meta.focus;
      if (meta && typeof meta.dimmed === 'boolean') state.dimmed = meta.dimmed;
      if (meta && typeof meta.reducedMotion === 'boolean' && meta.reducedMotion !== state.reducedMotion) {
        api.setReducedMotion(meta.reducedMotion);
        return;
      }
      kick();
    },
    setFocus: (index) => {
      if (state.disposed) return;
      state.focus = Number.isInteger(index) ? index : null;
      kick();
    },
    setPlayable: (indices) => {
      if (state.disposed) return;
      state.playable = new Set(Array.isArray(indices) ? indices : []);
      kick();
    },
    setDimmed: (dimmed) => {
      if (state.disposed) return;
      state.dimmed = dimmed === true;
      kick();
    },
    setReducedMotion: (on) => {
      if (state.disposed) return;
      const next = on === true;
      if (next === state.reducedMotion) { kick(); return; }
      state.reducedMotion = next;
      if (next) {
        if (state.rafId) {
          try {
            if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(state.rafId);
          } catch { /* ignore */ }
        }
        state.rafId = 0;
        state.trails.length = 0; state.shocks.length = 0; state.flashes.length = 0;
        draw(0);
      } else {
        kick();
      }
    },
    onPlacement: (index) => {
      if (state.disposed || state.reducedMotion) return;
      if (!Number.isInteger(index) || !state.layout || !state.layout.centers[index]) return;
      let t = 0;
      try { t = (typeof performance === 'object' && typeof performance.now === 'function') ? performance.now() : Date.now(); } catch { t = 0; }
      const c = state.board[index];
      state.shocks.push({ index, color: colorFor(c?.owner), start: t, until: t + 220, ms: 220 });
      if (state.shocks.length > MAX_SHOCKS) state.shocks.splice(0, state.shocks.length - MAX_SHOCKS);
      kick();
    },
    onBurst: (src, pid) => {
      if (state.disposed || state.reducedMotion) return;
      if (!Number.isInteger(src) || !state.layout || !state.layout.centers[src]) return;
      let t = 0;
      try { t = (typeof performance === 'object' && typeof performance.now === 'function') ? performance.now() : Date.now(); } catch { t = 0; }
      const c = state.board[src];
      state.shocks.push({ index: src, color: colorFor(pid ?? c?.owner), start: t, until: t + 380, ms: 380 });
      if (state.shocks.length > MAX_SHOCKS) state.shocks.splice(0, state.shocks.length - MAX_SHOCKS);
      kick();
    },
    onFlight: (src, dsts, colorOrPid, travelMs, shapeHint) => {
      if (state.disposed || state.reducedMotion) return;
      if (!Number.isInteger(src) || !Array.isArray(dsts) || !dsts.length) return;
      if (!state.layout || !state.layout.centers[src]) return;
      let t = 0;
      try { t = (typeof performance === 'object' && typeof performance.now === 'function') ? performance.now() : Date.now(); } catch { t = 0; }
      const travel = Math.max(0, Number(travelMs) || 160);
      const color = typeof colorOrPid === 'string' && colorOrPid.startsWith('#')
        ? colorOrPid : colorFor(colorOrPid);
      const shape = typeof shapeHint === 'string' ? shapeHint : shapeFor(colorOrPid);
      for (const dst of dsts) {
        if (!Number.isInteger(dst) || !state.layout.centers[dst]) continue;
        state.trails.push({ src, dst, color, shape, start: t, travelMs: travel, until: t + travel + 180 });
      }
      if (state.trails.length > MAX_TRAILS) state.trails.splice(0, state.trails.length - MAX_TRAILS);
      kick();
    },
    onArrival: (dsts, colorOrPid) => {
      if (state.disposed || state.reducedMotion) return;
      if (!Array.isArray(dsts) || !dsts.length) return;
      let t = 0;
      try { t = (typeof performance === 'object' && typeof performance.now === 'function') ? performance.now() : Date.now(); } catch { t = 0; }
      const color = typeof colorOrPid === 'string' && colorOrPid.startsWith('#')
        ? colorOrPid : (colorOrPid ? colorFor(colorOrPid) : '#ffffff');
      for (const dst of dsts) {
        if (!Number.isInteger(dst) || !state.layout || !state.layout.centers[dst]) continue;
        state.flashes.push({ index: dst, color, until: t + 220 });
      }
      if (state.flashes.length > MAX_TRAILS) state.flashes.splice(0, state.flashes.length - MAX_TRAILS);
      kick();
    },
    clearEphemeral: () => {
      if (state.disposed) return;
      state.trails.length = 0; state.shocks.length = 0; state.flashes.length = 0;
      kick();
    },
    resize: (w, h, opts2 = {}) => {
      if (state.disposed) return;
      if (typeof opts2.transpose === 'boolean' && opts2.transpose !== state.transpose) {
        state.transpose = opts2.transpose;
      }
      if (Number.isInteger(opts2.cols)) state.cols = opts2.cols;
      if (Number.isInteger(opts2.rows)) state.rows = opts2.rows;
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        state.width = w; state.height = h;
        state.layout = layoutBoard(state.cols, state.rows, w, h, { transpose: state.transpose, pad: 0 });
      } else {
        relayout();
      }
      kick();
    },
    dispose: () => {
      if (state.disposed) return;
      state.disposed = true;
      if (state.rafId) {
        try {
          if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(state.rafId);
        } catch { /* ignore */ }
        state.rafId = 0;
      }
      if (state.ro) {
        try { state.ro.disconnect(); } catch { /* ignore */ }
        state.ro = null;
      }
      if (state.onResize && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        try { window.removeEventListener('resize', state.onResize); } catch { /* ignore */ }
      }
      state.onResize = null;
      state.trails.length = 0; state.shocks.length = 0; state.flashes.length = 0;
      try { ctx.clearRect(0, 0, state.width, state.height); } catch { /* ignore */ }
    },
  };

  kick();
  return api;
}
