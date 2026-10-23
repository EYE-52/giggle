/* 2D canvas view lifecycle (Media Toolkit).
 *
 * Owns canvas lifecycle only: element creation, DPR-aware resizing, the
 * requestAnimationFrame loop, listener tracking, and full disposal. The game
 * owns scene content and input mapping via hooks.frame(); the server owns
 * positions, scores, and outcomes — this helper never simulates or scores.
 *
 * Mount: createCanvasView(mountEl, { frame, resize?, autostart? }).
 * - frame(ctx, dt, t, size) draws one frame; ctx is pre-scaled so units are
 *   CSS pixels; dt is clamped to [0, 0.1]; t is seconds; size is { w, h, dpr }.
 * - resize(w, h, dpr) runs after every canvas resize (CSS pixels + ratio).
 * Returns the live handle, or { fallback: true, reason } when no 2D canvas
 * can start (no mount, no frame hook, no DOM, no 2D context). Never throws
 * for DOM failures; dispose() is idempotent and never throws.
 *
 * No imports, no window/document access at module scope: safe to import in
 * any order and under Node for the lifecycle tests.
 */

function lazyWindow() {
  try {
    return globalThis.window || globalThis;
  } catch {
    return globalThis;
  }
}

function lazyDocument() {
  try {
    return globalThis.document || null;
  } catch {
    return null;
  }
}

export function reducedMotion() {
  try {
    const win = lazyWindow();
    return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

export function createCanvasView(mountEl, hooks) {
  hooks = hooks || {};
  if (!mountEl || typeof mountEl.appendChild !== 'function') {
    return { fallback: true, reason: 'no-mount' };
  }
  if (typeof hooks.frame !== 'function') {
    return { fallback: true, reason: 'no-frame' };
  }
  const doc = lazyDocument();
  if (!doc || typeof doc.createElement !== 'function') {
    return { fallback: true, reason: 'no-dom' };
  }

  const canvas = doc.createElement('canvas');
  if (typeof canvas.setAttribute === 'function') {
    canvas.setAttribute('data-view', 'canvas-2d');
  }
  let ctx = null;
  try {
    ctx = canvas.getContext ? canvas.getContext('2d') : null;
  } catch {
    ctx = null;
  }
  if (!ctx) return { fallback: true, reason: 'no-2d' };

  const win = lazyWindow();
  const tracked = [];
  const track = (t, type, fn, opts) => {
    if (!t || typeof t.addEventListener !== 'function') return;
    t.addEventListener(type, fn, opts);
    tracked.push([t, type, fn, opts]);
  };
  const untrackAll = () => {
    for (const [t, type, fn, opts] of tracked) {
      try { t.removeEventListener(type, fn, opts); } catch { /* noop */ }
    }
    tracked.length = 0;
  };

  const size = { w: 0, h: 0, dpr: 1 };
  const maxDpr = typeof hooks.maxDpr === 'number' && hooks.maxDpr > 0 ? hooks.maxDpr : 2;
  let running = false;
  let disposed = false;

  const doResize = () => {
    if (disposed) return;
    const w = Math.max(1, Math.floor(mountEl.clientWidth || 320));
    const h = Math.max(1, Math.floor(mountEl.clientHeight || 240));
    const dpr = Math.min(win.devicePixelRatio || 1, maxDpr);
    size.w = w;
    size.h = h;
    size.dpr = dpr;
    try {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      if (canvas.style) {
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
      }
      if (typeof ctx.setTransform === 'function') ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    } catch { /* noop: keep last good pixels */ }
    if (typeof hooks.resize === 'function') {
      try { hooks.resize(w, h, dpr); } catch { /* game bug: never break the loop */ }
    }
  };

  try {
    mountEl.appendChild(canvas);
  } catch {
    return { fallback: true, reason: 'mount-failed' };
  }

  let ro = null;
  const ResizeObs = globalThis.ResizeObserver;
  if (typeof ResizeObs === 'function') {
    try {
      ro = new ResizeObs(doResize);
      ro.observe(mountEl);
    } catch {
      ro = null;
    }
  }
  track(win, 'resize', doResize);
  // Orientation / DPR shifts on mobile fire here, not resize.
  track(win, 'orientationchange', doResize);
  doResize();

  const hasRaf = win && typeof win.requestAnimationFrame === 'function';
  const hasCaf = win && typeof win.cancelAnimationFrame === 'function';
  let rafId = null;
  let timerId = null;
  let last = 0;

  const step = (now) => {
    if (!running || disposed) return;
    const t = typeof now === 'number' ? now : 0;
    if (!last) last = t;
    const dt = Math.min(0.1, Math.max(0, (t - last) / 1000));
    last = t;
    try {
      hooks.frame(ctx, dt, t / 1000, { w: size.w, h: size.h, dpr: size.dpr });
    } catch (e) {
      if (typeof console !== 'undefined' && console.error) console.error('canvas frame error', e);
    }
    if (!running || disposed) return;
    if (hasRaf) {
      try {
        rafId = win.requestAnimationFrame(step);
      } catch {
        running = false;
      }
    } else {
      timerId = setTimeout(() => step(clock()), 16);
    }
  };

  const clock = () => {
    try {
      if (globalThis.performance && typeof globalThis.performance.now === 'function') {
        return globalThis.performance.now();
      }
    } catch { /* noop */ }
    return Date.now();
  };

  const start = () => {
    if (disposed || running) return;
    running = true;
    last = 0;
    if (hasRaf) {
      try {
        rafId = win.requestAnimationFrame(step);
        return;
      } catch { /* fall through to timer */ }
    }
    timerId = setTimeout(() => step(clock()), 16);
  };

  const stop = () => {
    running = false;
    if (rafId != null && hasCaf) {
      try { win.cancelAnimationFrame(rafId); } catch { /* noop */ }
    }
    if (timerId != null) {
      try { clearTimeout(timerId); } catch { /* noop */ }
    }
    rafId = null;
    timerId = null;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stop();
    if (ro) {
      try { ro.disconnect(); } catch { /* noop */ }
      ro = null;
    }
    untrackAll();
    try {
      if (typeof canvas.remove === 'function') canvas.remove();
      else if (canvas.parentNode && canvas.parentNode.removeChild) canvas.parentNode.removeChild(canvas);
    } catch { /* noop */ }
    if (typeof hooks.onDispose === 'function') {
      try { hooks.onDispose(); } catch { /* noop */ }
    }
  };

  if (hooks.autostart !== false) start();

  return {
    fallback: false,
    canvas,
    ctx,
    size: () => ({ w: size.w, h: size.h, dpr: size.dpr }),
    resize: doResize,
    start,
    stop,
    running: () => running,
    track,
    reducedMotion,
    disposed: () => disposed,
    dispose,
  };
}
