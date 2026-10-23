/* Keyboard + pointer input with guaranteed release (Media Toolkit).
 *
 * Tracks held keys (by e.code) and active pointers for one game view, then
 * releases EVERYTHING on blur, hidden, screen/fullscreen/orientation changes,
 * pointer cancel, and dispose — a game cannot retain a stuck key or drag.
 *
 * Mount: createInput(target, { onKey?, onPointer?, preventKeys?,
 *   captureInFields?, allowRepeat? }).
 * - onKey({ type: 'down'|'up', code, key }) on edges only (no auto-repeat
 *   unless allowRepeat is true).
 * - onPointer({ type: 'down'|'move'|'up'|'cancel', id, x, y, nx, ny, event })
 *   with x/y in target CSS pixels and nx/ny normalized 0..1.
 * - preventKeys: codes (e.g. ['ArrowUp','Space']) to preventDefault so the
 *   page never scrolls under the game.
 * - captureInFields: when false (default), key events from a focused form
 *   field (input/textarea/select/contentEditable) are ignored so typing in
 *   chat never drives the game.
 *
 * opts.window / opts.document inject the event hosts (tests pass stubs;
 * browsers use the globals). No imports, no globals at module scope.
 */

function isEditable(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = typeof el.tagName === 'string' ? el.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable === true) return true;
  try {
    const attr = typeof el.getAttribute === 'function' ? el.getAttribute('contenteditable') : null;
    if (attr !== null && attr !== 'false') return true;
  } catch { /* noop */ }
  return false;
}

export function createInput(target, opts) {
  opts = opts || {};
  const onKey = typeof opts.onKey === 'function' ? opts.onKey : null;
  const onPointer = typeof opts.onPointer === 'function' ? opts.onPointer : null;
  const prevent = new Set(Array.isArray(opts.preventKeys) ? opts.preventKeys : []);
  const captureInFields = opts.captureInFields === true;
  const allowRepeat = opts.allowRepeat === true;

  let win = null;
  let doc = null;
  try {
    win = opts.window || globalThis.window || globalThis;
    doc = opts.document || globalThis.document || null;
  } catch {
    win = globalThis;
    doc = null;
  }

  const keys = new Set();
  const pointers = new Map();
  let disposed = false;
  const tracked = [];
  const track = (t, type, fn, opts2) => {
    if (!t || typeof t.addEventListener !== 'function') return;
    t.addEventListener(type, fn, opts2);
    tracked.push([t, type, fn, opts2]);
  };
  const untrackAll = () => {
    for (const [t, type, fn, o] of tracked) {
      try { t.removeEventListener(type, fn, o); } catch { /* noop */ }
    }
    tracked.length = 0;
  };

  const emitKey = (type, code, key) => {
    if (!onKey) return;
    try { onKey({ type, code, key }); } catch { /* game bug: never break input */ }
  };

  const emitPointer = (type, id, x, y, nx, ny, event) => {
    if (!onPointer) return;
    try { onPointer({ type, id, x, y, nx, ny, event }); } catch { /* noop */ }
  };

  const releaseAll = () => {
    const heldKeys = [...keys];
    const activePointers = [...pointers];
    // Release callbacks and capture loss can synchronously trigger cleanup again.
    keys.clear();
    pointers.clear();
    if (onKey) {
      for (const code of heldKeys) {
        try { onKey({ type: 'up', code, key: null, released: true }); } catch { /* noop */ }
      }
    }
    for (const [id, p] of activePointers) {
      try { if (id !== 'mouse') target?.releasePointerCapture?.(id); } catch { /* best effort */ }
      emitPointer('cancel', id, p.x, p.y, p.nx, p.ny, null);
    }
  };

  const modalOpen = () => !!doc?.querySelector?.('dialog[open]');
  const onKeyDown = (e) => {
    if (disposed || !e) return;
    if (modalOpen()) { releaseAll(); return; }
    const code = e.code || e.key;
    if (!code) return;
    if (!captureInFields && isEditable(e.target)) return;
    if (prevent.has(code) && typeof e.preventDefault === 'function') {
      try { e.preventDefault(); } catch { /* noop */ }
    }
    if (e.repeat && !allowRepeat) return;
    const first = !keys.has(code);
    keys.add(code);
    if (first || allowRepeat) emitKey('down', code, e.key == null ? null : e.key);
  };

  const onKeyUp = (e) => {
    if (disposed || !e) return;
    const code = e.code || e.key;
    if (!code) return;
    if (!keys.has(code)) return;
    keys.delete(code);
    emitKey('up', code, e.key == null ? null : e.key);
  };

  const pointFromEvent = (e) => {
    let left = 0;
    let top = 0;
    let w = 0;
    let h = 0;
    try {
      if (target && typeof target.getBoundingClientRect === 'function') {
        const r = target.getBoundingClientRect();
        left = r.left || 0;
        top = r.top || 0;
        w = r.width || 0;
        h = r.height || 0;
      }
    } catch { /* noop */ }
    const cx = typeof e.clientX === 'number' ? e.clientX : 0;
    const cy = typeof e.clientY === 'number' ? e.clientY : 0;
    const x = cx - left;
    const y = cy - top;
    return {
      x,
      y,
      nx: w > 0 ? x / w : 0,
      ny: h > 0 ? y / h : 0,
    };
  };

  const onPointerDown = (e) => {
    if (disposed || !e) return;
    if (modalOpen()) { releaseAll(); return; }
    const id = e.pointerId == null ? 'mouse' : e.pointerId;
    const p = pointFromEvent(e);
    pointers.set(id, p);
    try {
      if (target && typeof target.setPointerCapture === 'function' && id !== 'mouse') {
        target.setPointerCapture(id);
      }
    } catch { /* noop: capture is best-effort */ }
    emitPointer('down', id, p.x, p.y, p.nx, p.ny, e);
  };

  const onPointerMove = (e) => {
    if (disposed || !e) return;
    const id = e.pointerId == null ? 'mouse' : e.pointerId;
    if (!pointers.has(id)) return;
    const p = pointFromEvent(e);
    pointers.set(id, p);
    emitPointer('move', id, p.x, p.y, p.nx, p.ny, e);
  };

  const dropPointer = (type, e) => {
    if (disposed || !e) return;
    const id = e.pointerId == null ? 'mouse' : e.pointerId;
    if (!pointers.has(id)) return;
    const prev = pointers.get(id);
    pointers.delete(id);
    try {
      if (target && typeof target.releasePointerCapture === 'function' && id !== 'mouse') {
        target.releasePointerCapture(id);
      }
    } catch { /* noop */ }
    emitPointer(type, id, prev.x, prev.y, prev.nx, prev.ny, e);
  };

  const onBlur = () => { if (!disposed) releaseAll(); };
  const onVisibility = () => {
    if (disposed || !doc) return;
    let hidden = false;
    try { hidden = doc.hidden === true || doc.visibilityState === 'hidden'; } catch { /* noop */ }
    if (hidden) releaseAll();
  };

  if (win) {
    track(win, 'keydown', onKeyDown);
    track(win, 'keyup', onKeyUp);
    track(win, 'blur', onBlur);
    track(win, 'orientationchange', onBlur);
    track(win.screen?.orientation, 'change', onBlur);
    // Window fallbacks cover capture failures and fingers released outside.
    track(win, 'pointerup', (e) => dropPointer('up', e));
    track(win, 'pointercancel', (e) => dropPointer('cancel', e));
  }
  if (doc) {
    track(doc, 'visibilitychange', onVisibility);
    track(doc, 'game-screenchange', onBlur);
    track(doc, 'fullscreenchange', onBlur);
  }
  if (target && typeof target.addEventListener === 'function') {
    track(target, 'pointerdown', onPointerDown);
    track(target, 'pointermove', onPointerMove);
    track(target, 'pointerup', (e) => dropPointer('up', e));
    track(target, 'pointercancel', (e) => dropPointer('cancel', e));
    track(target, 'lostpointercapture', (e) => dropPointer('cancel', e));
  }

  return {
    keys: () => [...keys],
    isDown: (code) => keys.has(code),
    pointers: () => new Map(pointers),
    releaseAll,
    disposed: () => disposed,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      releaseAll();
      untrackAll();
    },
  };
}
