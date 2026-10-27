/* Fixed analog thumb stick: dependency-free DOM/Pointer Events behavior.
 * Separate from kart intent policy and CSS. The host maps the normalized
 * vector to its own intent (kart: x = steer, UP = throttle, DOWN = brake).
 *
 *   import { createMobileStick } from './mobile-stick.mjs';
 *   const stick = createMobileStick(el, { onChange, enabled, window,
 *     document, deadzone });
 *   stick.reset();          // spring back (emits zero when changed)
 *   stick.reset(false);     // silent reset for host atomic clear
 *   stick.value();          // { x, y } in [-1,1], y positive DOWN
 *   stick.dispose();        // idempotent, no stale callbacks after
 *
 * Behavior:
 * - Owns EXACTLY ONE stick pointer (pointerId + capture). Secondary
 *   stick fingers are rejected WITHOUT preventDefault so independent
 *   fingers on Drift/Gas/Fire keep working. Window pointermove/up/cancel
 *   fallbacks cover missing capture; unrelated ids are ignored everywhere.
 * - Release: reset + release ACTUAL capture exactly once on primary
 *   up/cancel/lostcapture/blur/hidden/orientation/screenchange/dispose. Identity is
 *   cleared BEFORE releasePointerCapture because lostcapture can fire
 *   synchronously. No move when no active contact. Non-left mouse rejected.
 * - No timer/rAF: position flows via CSS variables (--pk-sx/--pk-sy) and
 *   data-active; spring-back is a CSS transition only (reduced-motion
 *   removes it in the host stylesheet).
 * - A host combining controls must register its global-stop listeners
 *   BEFORE creating the stick, reset(false) all controls, then send one
 *   neutral intent. Dispose is silent; the host sends its final neutral.
 */

export const STICK_DEADZONE = 0.14;

function finiteOr(n, fallback) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

/* Pure normalized-vector helper: pixel offset from pad center -> [-1,1].
 * Radial deadzone with deliberate transfer: magnitudes below deadzone read
 * zero, magnitudes at/above rescale linearly so deadzone edge = 0 and pad
 * edge (or beyond, clamped) = 1. Direction preserved, diagonals proportional
 * (a corner push clamps to unit length, x=y=~0.707). y stays screen-oriented
 * (positive DOWN); the host negates for throttle. */
export function normalizeStickVector(dx, dy, radius, deadzone) {
  const r = Number(radius);
  if (!(r > 0)) return { x: 0, y: 0 };
  let dz = Number(deadzone);
  if (!Number.isFinite(dz) || dz < 0 || dz >= 1) dz = STICK_DEADZONE;
  const nx = Number(dx) / r;
  const ny = Number(dy) / r;
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return { x: 0, y: 0 };
  const mag = Math.hypot(nx, ny);
  if (mag === 0) return { x: 0, y: 0 };
  if (mag < dz) return { x: 0, y: 0 };
  const clamped = Math.min(mag, 1);
  const scaled = (clamped - dz) / (1 - dz);
  const factor = scaled / mag;
  let x = nx * factor;
  let y = ny * factor;
  if (x > 1) x = 1;
  else if (x < -1) x = -1;
  if (y > 1) y = 1;
  else if (y < -1) y = -1;
  if (Object.is(x, -0)) x = 0;
  if (Object.is(y, -0)) y = 0;
  return { x, y };
}

export function createMobileStick(element, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const onChange = typeof o.onChange === 'function' ? o.onChange : null;
  let deadzone = Number(o.deadzone);
  if (!Number.isFinite(deadzone) || deadzone < 0 || deadzone >= 1) deadzone = STICK_DEADZONE;
  let win = null;
  let doc = null;
  try {
    win = o.window || globalThis.window || globalThis;
  } catch {
    win = globalThis;
  }
  try {
    doc = o.document || globalThis.document || null;
  } catch {
    doc = null;
  }
  const isEnabled = typeof o.enabled === 'function' ? o.enabled : () => o.enabled !== false;

  let activeId = null;
  let capturedId = null;
  let value = { x: 0, y: 0 };
  let disposed = false;
  const tracked = [];
  const track = (t, type, fn, opt2) => {
    if (!t || typeof t.addEventListener !== 'function') return;
    t.addEventListener(type, fn, opt2);
    tracked.push([t, type, fn, opt2]);
  };
  const untrackAll = () => {
    for (const [t, type, fn, oo] of tracked) {
      try {
        t.removeEventListener(type, fn, oo);
      } catch { /* best effort */ }
    }
    tracked.length = 0;
  };

  function setVars(x, y) {
    try {
      if (element && element.style && typeof element.style.setProperty === 'function') {
        element.style.setProperty('--pk-sx', String(x));
        element.style.setProperty('--pk-sy', String(y));
      }
    } catch { /* unstyled still drives */ }
    try {
      if (!element) return;
      const idle = x === 0 && y === 0 && activeId === null;
      if (idle) {
        if (typeof element.removeAttribute === 'function') element.removeAttribute('data-active');
        else if (element.dataset) delete element.dataset.active;
      } else if (typeof element.setAttribute === 'function') {
        element.setAttribute('data-active', '');
      } else if (element.dataset) {
        element.dataset.active = '';
      }
    } catch { /* attribute is advisory */ }
  }

  function centerRadius() {
    try {
      if (element && typeof element.getBoundingClientRect === 'function') {
        const rect = element.getBoundingClientRect();
        const w = Number(rect.width) || 0;
        const h = Number(rect.height) || 0;
        if (w > 0 && h > 0) {
          return {
            cx: (Number(rect.left) || 0) + w / 2,
            cy: (Number(rect.top) || 0) + h / 2,
            radius: Math.min(w, h) / 2,
          };
        }
      }
    } catch { /* fall through to fallback radius */ }
    const fallback = Number(o.radius) > 0 ? Number(o.radius) : 60;
    return { cx: 0, cy: 0, radius: fallback };
  }

  function emit(v) {
    if (!onChange || disposed) return;
    try {
      onChange({ x: v.x, y: v.y });
    } catch { /* host bug: never break the stick */ }
  }

  function updateFromEvent(e) {
    const { cx, cy, radius } = centerRadius();
    const clientX = typeof e.clientX === 'number' ? e.clientX : cx;
    const clientY = typeof e.clientY === 'number' ? e.clientY : cy;
    const v = normalizeStickVector(clientX - cx, clientY - cy, radius, deadzone);
    const changed = v.x !== value.x || v.y !== value.y;
    value = v;
    setVars(v.x, v.y);
    if (changed) emit(v);
  }

  function releaseActual(id) {
    if (id === null || id === undefined || id === 'mouse') return;
    try {
      if (!element || typeof element.releasePointerCapture !== 'function') return;
      let has = true;
      try {
        if (typeof element.hasPointerCapture === 'function') has = element.hasPointerCapture(id);
      } catch {
        has = true;
      }
      if (has) element.releasePointerCapture(id);
    } catch { /* already released */ }
  }

  /* Spring back to center. Default emits zero when something changed;
   * reset(false) stays silent for host atomic clear. Idempotent: a second
   * call (or a synchronous lostcapture during release) is a no-op. */
  function reset(emitChange) {
    if (disposed) return { x: 0, y: 0 };
    const hadContact = activeId !== null || capturedId !== null;
    const hadValue = value.x !== 0 || value.y !== 0;
    const id = capturedId;
    // Clear identity BEFORE release: lostcapture can fire synchronously.
    activeId = null;
    capturedId = null;
    value = { x: 0, y: 0 };
    setVars(0, 0);
    if (id !== null && id !== undefined) releaseActual(id);
    if (emitChange !== false && (hadContact || hadValue)) emit(value);
    return { x: 0, y: 0 };
  }

  function pidOf(e) {
    return e.pointerId === null || e.pointerId === undefined ? 'mouse' : e.pointerId;
  }

  function onDown(e) {
    if (disposed || !e) return;
    if (activeId !== null) return; // secondary finger: ignore, do not interfere
    if (e.pointerType === 'mouse' && finiteOr(e.button, 0) !== 0) return;
    try {
      if (!isEnabled()) return;
    } catch {
      return;
    }
    const id = pidOf(e);
    try {
      if (typeof e.preventDefault === 'function') e.preventDefault();
    } catch { /* noop */ }
    activeId = id;
    try {
      if (element && typeof element.setPointerCapture === 'function' && id !== 'mouse') {
        element.setPointerCapture(id);
        capturedId = id;
      }
    } catch {
      capturedId = null; // window fallbacks still track the drag
    }
    updateFromEvent(e);
  }

  function onMove(e) {
    if (disposed || !e || activeId === null) return;
    if (pidOf(e) !== activeId) return; // unrelated contact (e.g. right buttons)
    // Mouseup can be lost outside browser chrome even with capture.
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      reset(true);
      return;
    }
    try {
      if (!isEnabled()) { reset(true); return; }
    } catch { reset(true); return; }
    updateFromEvent(e);
  }

  function onUpCancel(e) {
    if (disposed || !e || activeId === null) return;
    if (pidOf(e) !== activeId) return;
    reset(true);
  }

  function onLostCapture(e) {
    if (disposed || !e) return;
    if (activeId === null && capturedId === null) return;
    const id = pidOf(e);
    if (id !== activeId && id !== capturedId) return;
    reset(true);
  }

  function onGlobalStop() {
    if (disposed) return;
    if (activeId === null && capturedId === null && value.x === 0 && value.y === 0) return;
    reset(true);
  }

  function onVisibility() {
    if (disposed || !doc) return;
    let hidden = false;
    try {
      hidden = doc.hidden === true || doc.visibilityState === 'hidden';
    } catch { /* noop */ }
    if (hidden) onGlobalStop();
  }

  track(element, 'pointerdown', onDown);
  track(element, 'pointermove', onMove);
  track(element, 'pointerup', onUpCancel);
  track(element, 'pointercancel', onUpCancel);
  track(element, 'lostpointercapture', onLostCapture);
  if (win) {
    // Fallbacks: capture retargets to the pad, but when capture is
    // unavailable the window still sees moves/releases outside the pad.
    track(win, 'pointermove', onMove);
    track(win, 'pointerup', onUpCancel);
    track(win, 'pointercancel', onUpCancel);
    track(win, 'blur', onGlobalStop);
    track(win, 'orientationchange', onGlobalStop);
    track(win.screen?.orientation, 'change', onGlobalStop);
  }
  if (doc) {
    track(doc, 'visibilitychange', onVisibility);
    track(doc, 'game-screenchange', onGlobalStop);
  }

  setVars(0, 0);

  function dispose() {
    if (disposed) return;
    const id = capturedId;
    // Silent: no onChange after dispose (host sends its own final zero).
    activeId = null;
    capturedId = null;
    value = { x: 0, y: 0 };
    try {
      setVars(0, 0);
    } catch { /* noop */ }
    if (id !== null && id !== undefined) releaseActual(id);
    disposed = true;
    untrackAll();
  }

  return {
    reset,
    dispose,
    value: () => ({ x: value.x, y: value.y }),
  };
}
