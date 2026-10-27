/* Castle Clash same-HUD 2D board: the WebGL fallback renderer.
 *
 * The HUD stays mounted; only this viewport swaps in when the 3D scene
 * cannot start (?nowebgl=1, missing GL, context loss). Same snapshots,
 * same selection, same send path — a top-down canvas board of both forts
 * with tap-to-act, hover readout, focus presets, and zoom steps.
 *
 * Interface mirrors createCastleScene (subset the HUD uses):
 *   createCastleBoard(mountEl, { onCell, onHover }) ->
 *     { fallback?, update(S, selection), focus(teamOrNull), resetCamera(),
 *       zoom(direction), hasUserMoved(), dispose() }
 * Taps are slop-gated (10px / 600ms) so scrolls never build or fire.
 * Chests are tappable: onCell receives {x,y,team,supply:id} for them.
 * No imports: canvas-only, DPR-capped, pools bounded, dispose complete. */

const CELL = 2;
const TAP_SLOP_PX = 10;
const TAP_MAX_MS = 600;
const MAX_FLASH = 12;

const TEAM = { red: '#e0654f', blue: '#0e8a7d' };
const TEAM_SOFT = { red: 'rgba(224,101,79,.16)', blue: 'rgba(14,138,125,.16)' };
const TEAM_DARK = { red: '#93300f', blue: '#07403c' };

function cellToWorld(cols, rows, x, y) {
  return { x: (x - (cols - 1) / 2) * CELL, z: (y - (rows - 1) / 2) * CELL };
}

function logKey(e, idx) {
  if (!e || typeof e !== 'object') return 'bad:' + idx;
  if (e.id !== undefined && e.id !== null) return 'id:' + e.id;
  return `k:${e.kind}|${e.by}|${e.weapon}|${e.x},${e.y}|${e.dealt}|${e.when}|${e.at}`;
}

function glyphFor(piece) {
  if (piece === 'wall') return '▦';
  if (piece === 'tower') return '♜';
  if (piece === 'cannon') return '◉';
  if (piece === 'keep') return '♛';
  if (piece === 'core') return '⬢';
  return '▣';
}

export function createCastleBoard(mountEl, hooks = {}) {
  const noop = () => {};
  const fallbackHandle = () => ({ fallback: true, update: noop, focus: noop, resetCamera: noop, zoom: noop, hasUserMoved: () => false, dispose: noop });
  const onCell = typeof hooks.onCell === 'function' ? hooks.onCell : null;
  const onHover = typeof hooks.onHover === 'function' ? hooks.onHover : null;
  if (!mountEl || typeof document === 'undefined') return fallbackHandle();
  let canvas = null;
  let ctx2d = null;
  try {
    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', '2D battle board. Tap a plot to build or fire.');
    ctx2d = canvas.getContext('2d');
  } catch { /* no canvas: honest fallback signal */ }
  if (!canvas || !ctx2d) return fallbackHandle();

  const st = {
    disposed: false,
    S: null,
    sel: null,
    view: 'overview', // 'red' | 'blue' | 'overview'
    zoom: 1,
    hover: null,
    flashes: [], // { x, y, team, t0, kind }
    seenLog: new Set(),
    seenOrder: [],
    lastInstance: null,
    lastRound: null,
    baselined: false,
    raf: 0,
    lastT: 0,
    bound: [],
    down: null, // { x, y, t }
    reduced: false,
    W: 0,
    H: 0,
  };
  try {
    st.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch { /* animate */ }

  try {
    mountEl.appendChild(canvas);
  } catch {
    return fallbackHandle();
  }

  function on(t, type, fn, opts) {
    if (!t || !t.addEventListener) return;
    t.addEventListener(type, fn, opts);
    st.bound.push([t, type, fn, opts]);
  }

  function markSeen(key) {
    if (st.seenLog.has(key)) return;
    st.seenLog.add(key);
    st.seenOrder.push(key);
    if (st.seenOrder.length > 240) {
      for (const k of st.seenOrder.splice(0, st.seenOrder.length - 240)) st.seenLog.delete(k);
    }
  }

  function arena() {
    const a = st.S && st.S.arena;
    if (a && Number.isInteger(a.cols) && Number.isInteger(a.rows)) return a;
    return { cols: 8, rows: 8, zones: {} };
  }

  function zoneOf(team) {
    const a = arena();
    const z = a.zones && a.zones[team];
    if (z && [z.x0, z.y0, z.x1, z.y1].every((n) => Number.isInteger(n))) return z;
    return team === 'red' ? { x0: 0, y0: 0, x1: 7, y1: 2 } : { x0: 0, y0: 5, x1: 7, y1: 7 };
  }

  /* World (x,z cell units) -> screen px for the current preset + zoom. */
  function viewCenter() {
    const a = arena();
    const zr = zoneOf('red');
    const zb = zoneOf('blue');
    const mid = (z) => {
      const p = cellToWorld(a.cols, a.rows, (z.x0 + z.x1) / 2, (z.y0 + z.y1) / 2);
      return p;
    };
    if (st.view === 'red') return mid(zr);
    if (st.view === 'blue') return mid(zb);
    return { x: 0, z: 0 };
  }

  function baseScale() {
    const a = arena();
    const spanCells = st.view === 'overview' ? Math.max(a.cols, a.rows) + 2 : 9;
    const spanWorld = spanCells * CELL;
    const fit = Math.min(st.W / spanWorld, st.H / spanWorld);
    return (Number.isFinite(fit) && fit > 0 ? fit : 24) * st.zoom;
  }

  function worldToScreen(wx, wz) {
    const c = viewCenter();
    const s = baseScale();
    return { x: st.W / 2 + (wx - c.x) * s, y: st.H / 2 + (wz - c.z) * s, s };
  }

  function screenToCell(px, py) {
    const a = arena();
    const c = viewCenter();
    const s = baseScale();
    if (!(s > 0)) return null;
    const wx = c.x + (px - st.W / 2) / s;
    const wz = c.z + (py - st.H / 2) / s;
    const x = Math.round(wx / CELL + (a.cols - 1) / 2);
    const y = Math.round(wz / CELL + (a.rows - 1) / 2);
    if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
    if (x < 0 || y < 0 || x >= a.cols || y >= a.rows) return null;
    const zr = zoneOf('red');
    const zb = zoneOf('blue');
    const inZ = (z) => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1;
    const team = inZ(zr) ? 'red' : inZ(zb) ? 'blue' : null;
    if (!team) return null;
    return { x, y, team };
  }

  function chests() {
    const list = st.sel && Array.isArray(st.sel.supplies) ? st.sel.supplies : [];
    return list.slice(0, 2).filter((c) => c && typeof c.id === 'string' &&
      (c.team === 'red' || c.team === 'blue') && Number.isInteger(c.x) && Number.isInteger(c.y));
  }

  function pickAt(px, py) {
    // Chests first (generous radius), then fort plots.
    const a = arena();
    for (const c of chests()) {
      const w = cellToWorld(a.cols, a.rows, c.x, c.y);
      const p = worldToScreen(w.x, w.z);
      if (Math.hypot(px - p.x, py - p.y) < CELL * p.s * 0.7) {
        return { x: c.x, y: c.y, team: c.team, supply: c.id };
      }
    }
    return screenToCell(px, py);
  }

  function resize() {
    if (st.disposed) return;
    let w = 0;
    let h = 0;
    try {
      w = mountEl.clientWidth || 0;
      h = mountEl.clientHeight || 0;
    } catch { /* keep last */ }
    if (!(w > 0) || !(h > 0)) {
      try {
        const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
        if (r) { w = r.width; h = r.height; }
      } catch { /* keep last */ }
    }
    if (!(w > 0)) w = 320;
    if (!(h > 0)) h = 320;
    const dpr = (() => {
      try {
        const d = window.devicePixelRatio || 1;
        return Math.min(2, Math.max(1, d));
      } catch {
        return 1;
      }
    })();
    st.W = w;
    st.H = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    try {
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    } catch { /* noop */ }
    draw(performanceNow());
  }

  function performanceNow() {
    try {
      if (typeof performance !== 'undefined' && performance.now) return performance.now();
    } catch { /* wall below */ }
    return Date.now();
  }

  function canTarget(x, y, team) {
    const sel = st.sel;
    if (!sel || typeof sel.canTarget !== 'function') return false;
    try {
      return !!sel.canTarget(x, y, team);
    } catch {
      return false;
    }
  }

  function draw(now) {
    if (st.disposed || !ctx2d) return;
    const a = arena();
    const g = ctx2d;
    // Valley floor + river band.
    const sky = g.createLinearGradient(0, 0, 0, st.H);
    sky.addColorStop(0, '#3a3260');
    sky.addColorStop(0.45, '#8a4a6e');
    sky.addColorStop(0.62, '#2f9e5f');
    sky.addColorStop(1, '#1f6b4a');
    g.fillStyle = sky;
    g.fillRect(0, 0, st.W, st.H);
    const river = worldToScreen(0, 0);
    g.fillStyle = 'rgba(46,200,216,.85)';
    g.fillRect(0, river.y - river.s * 0.55, st.W, river.s * 1.1);
    g.fillStyle = 'rgba(207,246,255,.5)';
    g.fillRect(0, river.y - river.s * 0.1, st.W, Math.max(1, river.s * 0.12));

    const showMarks = !!(st.sel && st.sel.canAct && st.S && st.S.phase === 'build');
    const grids = st.S && st.S.grids ? st.S.grids : { red: [], blue: [] };
    const occ = new Map();
    for (const t of ['red', 'blue']) {
      for (const c of (grids[t] || [])) {
        if (c && Number.isInteger(c.x) && Number.isInteger(c.y)) occ.set(`${t}:${c.x},${c.y}`, c);
      }
    }
    // Fort zones: soft team wash + faint circular ground marks while building.
    for (const t of ['red', 'blue']) {
      const z = zoneOf(t);
      const p0 = cellToWorld(a.cols, a.rows, z.x0, z.y0);
      const p1 = cellToWorld(a.cols, a.rows, z.x1, z.y1);
      const s0 = worldToScreen(p0.x - CELL / 2, p0.z - CELL / 2);
      const s1 = worldToScreen(p1.x + CELL / 2, p1.z + CELL / 2);
      g.fillStyle = TEAM_SOFT[t];
      g.fillRect(s0.x, s0.y, s1.x - s0.x, s1.y - s0.y);
      g.strokeStyle = TEAM[t];
      g.lineWidth = 2;
      g.strokeRect(s0.x, s0.y, s1.x - s0.x, s1.y - s0.y);
      for (let y = z.y0; y <= z.y1; y++) {
        for (let x = z.x0; x <= z.x1; x++) {
          if (occ.has(`${t}:${x},${y}`)) continue;
          const w = cellToWorld(a.cols, a.rows, x, y);
          const p = worldToScreen(w.x, w.z);
          const r = CELL * p.s * 0.32;
          const active = showMarks && st.sel.team === t && canTarget(x, y, t);
          const hov = st.hover && !st.hover.supply && st.hover.x === x && st.hover.y === y && st.hover.team === t;
          if (!active && !hov) continue;
          g.beginPath();
          g.arc(p.x, p.y, r, 0, Math.PI * 2);
          g.strokeStyle = hov ? '#f7d774' : 'rgba(255,240,181,.55)';
          g.lineWidth = hov ? 3 : 2;
          g.stroke();
        }
      }
    }
    // Structures: team blocks with glyphs, HP bars, level pips.
    for (const t of ['red', 'blue']) {
      for (const c of (grids[t] || [])) {
        if (!c || !Number.isInteger(c.x) || !Number.isInteger(c.y)) continue;
        const w = cellToWorld(a.cols, a.rows, c.x, c.y);
        const p = worldToScreen(w.x, w.z);
        const half = CELL * p.s * 0.42;
        const isCore = !!c.objective || c.piece === 'core';
        g.save();
        if (isCore) {
          g.translate(p.x, p.y);
          g.rotate(Math.PI / 4);
          g.fillStyle = TEAM[t];
          g.fillRect(-half, -half, half * 2, half * 2);
          g.strokeStyle = '#ffd390';
          g.lineWidth = 2;
          g.strokeRect(-half, -half, half * 2, half * 2);
          g.rotate(-Math.PI / 4);
          g.fillStyle = '#fffdf6';
        } else {
          g.fillStyle = TEAM[t];
          g.beginPath();
          if (g.roundRect) g.roundRect(p.x - half, p.y - half, half * 2, half * 2, 4);
          else g.rect(p.x - half, p.y - half, half * 2, half * 2);
          g.fill();
          g.strokeStyle = TEAM_DARK[t];
          g.lineWidth = 2;
          g.stroke();
          g.fillStyle = '#fffdf6';
        }
        g.font = `${Math.max(10, Math.round(half * 1.1))}px sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(glyphFor(isCore ? 'core' : c.piece), p.x, p.y - (isCore ? 0 : half * 0.12));
        g.restore();
        if ((c.level || 1) > 1) {
          g.fillStyle = '#ffd390';
          g.beginPath();
          g.arc(p.x + half * 0.7, p.y - half * 0.7, Math.max(2, half * 0.18), 0, Math.PI * 2);
          g.fill();
        }
        // HP bar.
        const frac = c.maxHp > 0 ? Math.max(0, Math.min(1, c.hp / c.maxHp)) : 0;
        g.fillStyle = 'rgba(0,0,0,.45)';
        g.fillRect(p.x - half, p.y + half + 2, half * 2, 4);
        g.fillStyle = frac > 0.6 ? '#53d769' : frac > 0.3 ? '#d9a414' : '#d43a52';
        g.fillRect(p.x - half, p.y + half + 2, half * 2 * frac, 4);
      }
    }
    // Glowing supply crates.
    for (const c of chests()) {
      const w = cellToWorld(a.cols, a.rows, c.x, c.y);
      const p = worldToScreen(w.x, w.z);
      const half = CELL * p.s * 0.34;
      const pulse = st.reduced ? 0.5 : (Math.sin(now / 280 + c.x + c.y) + 1) / 2;
      g.save();
      g.shadowColor = '#ffd54a';
      g.shadowBlur = 8 + pulse * 10;
      g.fillStyle = '#d9a441';
      g.fillRect(p.x - half, p.y - half, half * 2, half * 2);
      g.shadowBlur = 0;
      g.strokeStyle = '#54371f';
      g.lineWidth = 2;
      g.strokeRect(p.x - half, p.y - half, half * 2, half * 2);
      g.strokeStyle = '#fff7ea';
      g.beginPath();
      g.moveTo(p.x, p.y - half);
      g.lineTo(p.x, p.y + half);
      g.stroke();
      g.restore();
    }
    // Hit flashes (bounded, fading).
    const alive = [];
    for (const f of st.flashes) {
      const age = now - f.t0;
      if (age > 700) continue;
      alive.push(f);
      const w = cellToWorld(a.cols, a.rows, f.x, f.y);
      const p = worldToScreen(w.x, w.z);
      const r = CELL * p.s * (0.3 + (age / 700) * 0.5);
      g.beginPath();
      g.arc(p.x, p.y, r, 0, Math.PI * 2);
      g.strokeStyle = f.kind === 'corefall' ? '#ffd54a' : 'rgba(255,122,47,.9)';
      g.lineWidth = 3;
      g.globalAlpha = Math.max(0, 1 - age / 700);
      g.stroke();
      g.globalAlpha = 1;
    }
    if (alive.length !== st.flashes.length) st.flashes = alive;
    // Hover ring.
    if (st.hover && !st.hover.supply) {
      const w = cellToWorld(a.cols, a.rows, st.hover.x, st.hover.y);
      const p = worldToScreen(w.x, w.z);
      g.beginPath();
      g.arc(p.x, p.y, CELL * p.s * 0.45, 0, Math.PI * 2);
      g.strokeStyle = canTarget(st.hover.x, st.hover.y, st.hover.team) ? '#f7d774' : '#e4574d';
      g.lineWidth = 3;
      g.stroke();
    }
  }

  function frame(t) {
    if (st.disposed) return;
    draw(t || performanceNow());
    if (!st.reduced && (st.flashes.length || chests().length)) {
      st.raf = requestAnimationFrameSafe(frame);
    } else {
      st.raf = 0;
    }
  }

  function requestAnimationFrameSafe(fn) {
    try {
      if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
    } catch { /* single frame below */ }
    return 0;
  }

  function kick() {
    draw(performanceNow());
    if (!st.raf && !st.reduced && (st.flashes.length || chests().length)) {
      st.raf = requestAnimationFrameSafe(frame);
    }
  }

  function localPos(e) {
    let rect = null;
    try {
      rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    } catch { /* client coords below */ }
    const lx = e.clientX - (rect ? rect.left : 0);
    const ly = e.clientY - (rect ? rect.top : 0);
    return { x: lx, y: ly };
  }

  on(canvas, 'pointerdown', (e) => {
    if (st.disposed || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const p = localPos(e);
    st.down = { x: p.x, y: p.y, t: performanceNow() };
  });
  on(canvas, 'pointerup', (e) => {
    if (st.disposed || !st.down) { st.down = null; return; }
    const d = st.down;
    st.down = null;
    const p = localPos(e);
    const dt = performanceNow() - d.t;
    if (dt < 0 || dt > TAP_MAX_MS) return;
    if (Math.hypot(p.x - d.x, p.y - d.y) > TAP_SLOP_PX) return;
    const hit = pickAt(p.x, p.y);
    if (hit && onCell) {
      try {
        onCell(hit);
      } catch { /* host callback must not break input */ }
    }
  });
  on(canvas, 'pointercancel', () => { st.down = null; });
  on(canvas, 'pointermove', (e) => {
    if (st.disposed || st.down) return;
    if (e.pointerType !== undefined && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    if (Number.isFinite(e.buttons) && e.buttons !== 0) return;
    const p = localPos(e);
    const hit = pickAt(p.x, p.y);
    const key = hit ? `${hit.team}:${hit.x},${hit.y}:${hit.supply || ''}` : 'null';
    const prev = st.hover ? `${st.hover.team}:${st.hover.x},${st.hover.y}:${st.hover.supply || ''}` : 'null';
    st.hover = hit;
    draw(performanceNow());
    if (key !== prev && onHover) {
      try {
        onHover(hit);
      } catch { /* host callback must not break hover */ }
    }
  });
  on(canvas, 'pointerleave', () => {
    st.hover = null;
    st.down = null;
    draw(performanceNow());
    if (onHover) {
      try {
        onHover(null);
      } catch { /* noop */ }
    }
  });
  on(canvas, 'wheel', (e) => {
    if (st.disposed) return;
    try {
      if (typeof e.preventDefault === 'function') e.preventDefault();
    } catch { /* noop */ }
    const dy = Number(e.deltaY) || 0;
    if (!Number.isFinite(dy) || dy === 0) return;
    st.zoom = Math.max(0.6, Math.min(2.5, st.zoom * Math.exp(dy * 0.0012)));
    draw(performanceNow());
  }, { passive: false });
  try {
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => resize());
      ro.observe(mountEl);
      st.bound.push([{ removeEventListener: () => ro.disconnect() }, 'ro', noop]);
    } else if (typeof window !== 'undefined') {
      on(window, 'resize', () => resize());
    }
  } catch { /* fixed size below */ }

  resize();

  return {
    fallback: false,
    update(S, selection) {
      if (st.disposed) return;
      if (selection !== undefined) st.sel = selection;
      if (S !== undefined) st.S = S;
      if (!st.S) return;
      const instance = st.S.instanceId !== undefined && st.S.instanceId !== null ? st.S.instanceId : '__none';
      const round = Number.isInteger(st.S.round) ? st.S.round : 1;
      const fresh = !st.baselined || instance !== st.lastInstance || round !== st.lastRound;
      const entries = Array.isArray(st.S.log) ? st.S.log : [];
      if (fresh) {
        if (instance !== st.lastInstance) { st.seenLog.clear(); st.seenOrder.length = 0; }
        entries.forEach((e, i) => markSeen(logKey(e, i))); // baseline: never replay history
        st.flashes = [];
      } else {
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          const k = logKey(e, i);
          if (st.seenLog.has(k)) continue;
          markSeen(k);
          if ((e.kind === 'hit' || e.kind === 'destroy' || e.kind === 'corefall') &&
            Number.isInteger(e.x) && Number.isInteger(e.y)) {
            st.flashes.push({ x: e.x, y: e.y, t0: performanceNow(), kind: e.kind });
            if (st.flashes.length > MAX_FLASH) st.flashes.splice(0, st.flashes.length - MAX_FLASH);
          }
        }
      }
      st.lastInstance = instance;
      st.lastRound = round;
      st.baselined = true;
      kick();
    },
    focus(team) {
      if (st.disposed) return;
      st.view = team === 'red' || team === 'blue' ? team : 'overview';
      st.zoom = 1;
      draw(performanceNow());
    },
    resetCamera() {
      if (st.disposed) return;
      st.view = 'overview';
      st.zoom = 1;
      draw(performanceNow());
    },
    zoom(direction) {
      if (st.disposed) return;
      let step = 0;
      if (direction === 'in' || direction === '+' || direction === 'plus') step = -1;
      else if (direction === 'out' || direction === '-' || direction === 'minus') step = 1;
      else if (Number.isFinite(Number(direction))) {
        const n = Number(direction);
        if (n > 0) step = -1;
        else if (n < 0) step = 1;
        else return;
      } else return;
      st.zoom = Math.max(0.6, Math.min(2.5, step < 0 ? st.zoom * 1.25 : st.zoom / 1.25));
      draw(performanceNow());
    },
    hasUserMoved() {
      return false; // fixed board framing; HUD buttons own explicit framing
    },
    dispose() {
      if (st.disposed) return;
      st.disposed = true;
      try {
        if (st.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(st.raf);
      } catch { /* noop */ }
      st.raf = 0;
      for (const [t, type, fn, opts] of st.bound) {
        try {
          if (t && typeof t.removeEventListener === 'function') t.removeEventListener(type, fn, opts);
        } catch { /* noop */ }
      }
      st.bound = [];
      st.flashes = [];
      st.seenLog.clear();
      st.seenOrder.length = 0;
      try {
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      } catch { /* noop */ }
    },
  };
}
