/* Reusable arena gesture + orbit helper for toy 3D board games.
 *
 * Three-agnostic on purpose: the camera is duck-typed ({ position:{x,y,z}
 * or .set(), lookAt() }) and picking is injected via opts.pick(ndc), so
 * Node tests can drive every gesture with mocks and any renderer (Three.js
 * today) can plug its own Raycaster in. No imports, no DOM globals at
 * module scope, no pointer capture — window move/up listeners live only
 * for the duration of an active gesture and are removed on end/dispose.
 *
 * Gestures: one-finger/mouse drag orbits, wheel zooms (bounded), two-finger
 * pinch zooms, and a press that stays within TAP_SLOP_PX for TAP_MAX_MS
 * counts as a tap. Rotating or zooming never fires onTap, so camera moves
 * can never send a build/fire action. Hover pick runs inside update(dt)
 * (throttled), keeping raycasts off the event path and on the frame loop.
 */

export const TAP_SLOP_PX = 10;
export const TAP_MAX_MS = 600;
export const HOVER_THROTTLE_MS = 60;

export function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

/* True when a press/release pair counts as a tap (not a drag). */
export function isTapGesture(dxPx, dyPx, dtMs, slopPx = TAP_SLOP_PX, maxMs = TAP_MAX_MS) {
  if (!Number.isFinite(dxPx) || !Number.isFinite(dyPx) || !Number.isFinite(dtMs)) return false;
  if (dtMs < 0 || dtMs > maxMs) return false;
  return Math.hypot(dxPx, dyPx) <= slopPx;
}

/* Client coords -> normalized device coords for a canvas rect, or null. */
export function ndcFromClient(clientX, clientY, rect) {
  if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null;
  if (rect.width <= 0 || rect.height <= 0) return null;
  const left = rect.left || 0;
  const top = rect.top || 0;
  return {
    x: ((clientX - left) / rect.width) * 2 - 1,
    y: -((clientY - top) / rect.height) * 2 + 1,
  };
}

/* Orbit offset for yaw (around Y, 0 faces +z) + pitch (elevation) + dist. */
export function sphericalOffset(yaw, pitch, dist) {
  const cp = Math.cos(pitch);
  return {
    x: Math.sin(yaw) * cp * dist,
    y: Math.sin(pitch) * dist,
    z: Math.cos(yaw) * cp * dist,
  };
}

/* Place a duck-typed camera on the orbit sphere and aim it at target. */
export function applyOrbit(camera, target, yaw, pitch, dist) {
  if (!camera || !camera.position || !target) return;
  const o = sphericalOffset(yaw, pitch, dist);
  const px = target.x + o.x;
  const py = target.y + o.y;
  const pz = target.z + o.z;
  if (typeof camera.position.set === 'function') camera.position.set(px, py, pz);
  else {
    camera.position.x = px;
    camera.position.y = py;
    camera.position.z = pz;
  }
  if (typeof camera.lookAt === 'function') {
    try {
      camera.lookAt(target.x, target.y, target.z);
    } catch {
      /* mock cameras may throw; position still applied */
    }
  }
}

function defaultWindow() {
  try {
    if (typeof window !== 'undefined' && window && window.addEventListener) return window;
  } catch { /* node: no window */ }
  return null;
}

/* Create orbit + tap/pinch controls on element for camera.
 * opts: { element, camera, target:{x,y,z}, minDistance, maxDistance,
 *   minPitch, maxPitch, yaw, pitch, distance, rotSpeed, wheelSpeed,
 *   tapSlopPx, tapMaxMs, hoverThrottleMs, pick(ndc)->hit|null,
 *   onTap(hit, ndc), onHover(hit|null), hoverKey(hit)->string,
 *   reducedMotion()->bool, now()->ms, window, document }.
 * Returns { getState, setTarget, focus, reset, update, setCallbacks,
 * setEnabled, cancel, dispose }. */
export function createArenaControls(opts = {}) {
  const element = opts.element || null;
  const camera = opts.camera || null;
  const win = opts.window !== undefined ? opts.window : defaultWindow();
  const doc = opts.document !== undefined ? opts.document : (typeof document === 'undefined' ? null : document);
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const reducedMotion = typeof opts.reducedMotion === 'function' ? opts.reducedMotion : () => false;

  const minDistance = Number.isFinite(opts.minDistance) ? opts.minDistance : 8;
  const maxDistance = Number.isFinite(opts.maxDistance) ? opts.maxDistance : 60;
  const minPitch = Number.isFinite(opts.minPitch) ? opts.minPitch : 0.3;
  const maxPitch = Number.isFinite(opts.maxPitch) ? opts.maxPitch : 1.3;
  const rotSpeed = Number.isFinite(opts.rotSpeed) ? opts.rotSpeed : 0.0055;
  const wheelSpeed = Number.isFinite(opts.wheelSpeed) ? opts.wheelSpeed : 1;
  const tapSlopPx = Number.isFinite(opts.tapSlopPx) ? opts.tapSlopPx : TAP_SLOP_PX;
  const tapMaxMs = Number.isFinite(opts.tapMaxMs) ? opts.tapMaxMs : TAP_MAX_MS;
  const hoverThrottleMs = Number.isFinite(opts.hoverThrottleMs) ? opts.hoverThrottleMs : HOVER_THROTTLE_MS;

  let pick = typeof opts.pick === 'function' ? opts.pick : null;
  let onTap = typeof opts.onTap === 'function' ? opts.onTap : null;
  let onHover = typeof opts.onHover === 'function' ? opts.onHover : null;
  const hoverKey = typeof opts.hoverKey === 'function'
    ? opts.hoverKey
    : (hit) => (hit === null || hit === undefined ? 'null' : JSON.stringify(hit));

  const t0 = opts.target && typeof opts.target === 'object' ? opts.target : { x: 0, y: 0, z: 0 };
  const home = {
    target: { x: Number(t0.x) || 0, y: Number(t0.y) || 0, z: Number(t0.z) || 0 },
    yaw: Number.isFinite(opts.yaw) ? opts.yaw : 0,
    pitch: clamp(opts.pitch !== undefined ? opts.pitch : 0.9, minPitch, maxPitch),
    distance: clamp(opts.distance !== undefined ? opts.distance : 26, minDistance, maxDistance),
  };
  const cur = {
    target: { ...home.target }, yaw: home.yaw, pitch: home.pitch, distance: home.distance,
  };
  const goal = {
    target: { ...home.target }, yaw: home.yaw, pitch: home.pitch, distance: home.distance,
  };

  let enabled = true;
  let disposed = false;
  let userMoved = false;
  const pointers = new Map(); // pointerId -> {x, y}
  let downAt = 0;
  let downX = 0;
  let downY = 0;
  let dragging = false;
  let pinched = false;
  let pinchD0 = 0;
  let pinchDist0 = 0;
  let lastPinchD = 0;
  let hoverNdc = null;
  let hoverDirty = false;
  let lastHoverAt = 0;
  let lastHoverKey = '\0unseen';
  let elBound = [];
  let winBound = [];
  let prevTouchAction = null;

  function track(list, t, type, fn, o) {
    if (!t || typeof t.addEventListener !== 'function') return;
    t.addEventListener(type, fn, o);
    list.push([t, type, fn, o]);
  }

  function untrack(list) {
    for (const [t, type, fn, o] of list) {
      try {
        if (t && typeof t.removeEventListener === 'function') t.removeEventListener(type, fn, o);
      } catch { /* best effort */ }
    }
    list.length = 0;
  }

  function elementRect() {
    try {
      if (element && typeof element.getBoundingClientRect === 'function') {
        return element.getBoundingClientRect();
      }
    } catch { /* noop */ }
    return null;
  }

  function toNdc(clientX, clientY) {
    return ndcFromClient(clientX, clientY, elementRect());
  }

  function fireTap(ndc) {
    if (!onTap) return;
    let hit = null;
    if (pick) {
      try {
        hit = pick(ndc) || null;
      } catch {
        hit = null;
      }
    }
    try {
      onTap(hit, ndc);
    } catch { /* host callback must not break gestures */ }
  }

  function clearHover() {
    hoverNdc = null;
    hoverDirty = false;
  }

  function gestureTarget() {
    return win || element; // window during drag; element fallback (tests/headless)
  }

  function onPointerDown(e) {
    if (disposed || !enabled || !e) return;
    if (e.pointerType === 'mouse' && Number.isFinite(e.button) && e.button !== 0) return;
    const id = e.pointerId !== undefined ? e.pointerId : 'mouse';
    try {
      if (e.pointerType !== 'mouse' && typeof e.preventDefault === 'function') e.preventDefault();
    } catch { /* noop */ }
    if (pointers.size === 0) {
      downAt = now();
      downX = e.clientX;
      downY = e.clientY;
      dragging = false;
      pinched = false;
      clearHover();
      const gt = gestureTarget();
      track(winBound, gt, 'pointermove', onGestureMove);
      track(winBound, gt, 'pointerup', onGestureUp);
      track(winBound, gt, 'pointercancel', onGestureCancel);
    }
    pointers.set(id, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      pinchD0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      lastPinchD = pinchD0;
      pinchDist0 = goal.distance;
      pinched = true;
      dragging = false;
    }
  }

  function onGestureMove(e) {
    if (disposed || !enabled) return;
    const id = e.pointerId !== undefined ? e.pointerId : 'mouse';
    if (!pointers.has(id)) return;
    pointers.set(id, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      const pts = [...pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      lastPinchD = d;
      if (pinchD0 > 0 && d > 0) {
        goal.distance = clamp((pinchDist0 * pinchD0) / d, minDistance, maxDistance);
        userMoved = true;
      }
      return;
    }
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    if (!dragging && !isTapGesture(dx, dy, now() - downAt, tapSlopPx, Number.MAX_SAFE_INTEGER)) {
      dragging = true;
    }
    if (dragging) {
      // Incremental deltas from the press point: drag right orbits left,
      // drag up raises the camera. Stored on goal to dodge extra closure.
      const px = goal._lx || 0;
      const py = goal._ly || 0;
      goal.yaw -= (dx - px) * rotSpeed;
      goal.pitch = clamp(goal.pitch - (dy - py) * rotSpeed, minPitch, maxPitch);
      goal._lx = dx;
      goal._ly = dy;
      userMoved = true;
    }
  }

  function endGesture(e, cancelled) {
    const id = e && e.pointerId !== undefined ? e.pointerId : 'mouse';
    if (!pointers.has(id)) return;
    pointers.delete(id);
    if (pointers.size > 0) {
      // Pinch partially lifted: re-anchor the orbit so the remaining
      // finger continues smoothly instead of jumping from the old origin.
      // pinched stays true — a gesture that pinched never becomes a tap.
      const rest = [...pointers.values()][0];
      downX = rest.x;
      downY = rest.y;
      downAt = now();
      delete goal._lx;
      delete goal._ly;
      return;
    }
    untrack(winBound);
    delete goal._lx;
    delete goal._ly;
    if (cancelled || disposed || !enabled) {
      dragging = false;
      return;
    }
    const dt = now() - downAt;
    const dx = (e ? e.clientX : downX) - downX;
    const dy = (e ? e.clientY : downY) - downY;
    const wasTap = !dragging && !pinched && pointers.size === 0 &&
      isTapGesture(dx, dy, dt, tapSlopPx, tapMaxMs);
    dragging = false;
    if (wasTap && e) {
      const ndc = toNdc(e.clientX, e.clientY);
      if (ndc) fireTap(ndc);
    }
  }

  function onGestureUp(e) {
    endGesture(e, false);
  }

  function onGestureCancel(e) {
    endGesture(e, true);
  }

  function cancelGesture() {
    // Release any captured pointers first (best effort; helper normally
    // uses window listeners, not capture, so this is usually a noop).
    try {
      if (element && typeof element.releasePointerCapture === 'function') {
        for (const id of pointers.keys()) {
          try {
            if (typeof element.hasPointerCapture === 'function' &&
              !element.hasPointerCapture(id)) continue;
            element.releasePointerCapture(id);
          } catch { /* per-pointer best effort */ }
        }
      }
    } catch { /* noop */ }
    pointers.clear();
    untrack(winBound);
    dragging = false;
    pinched = false;
    downAt = 0;
    pinchD0 = 0;
    pinchDist0 = 0;
    lastPinchD = 0;
    delete goal._lx;
    delete goal._ly;
    onHoverLeave();
  }

  function onHoverMove(e) {
    if (disposed || !enabled || !e) return;
    if (pointers.size > 0) return; // a press is active: not hovering
    if (e.pointerType !== undefined && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    if (Number.isFinite(e.buttons) && e.buttons !== 0) return;
    const ndc = toNdc(e.clientX, e.clientY);
    if (!ndc) return;
    hoverNdc = ndc;
    hoverDirty = true;
  }

  function onHoverLeave() {
    if (lastHoverKey !== hoverKey(null)) {
      lastHoverKey = hoverKey(null);
      if (onHover && !disposed && enabled) {
        try {
          onHover(null);
        } catch { /* host callback must not break gestures */ }
      }
    }
    clearHover();
  }

  function onWheel(e) {
    if (disposed || !enabled || !e) return;
    try {
      if (typeof e.preventDefault === 'function') e.preventDefault();
    } catch { /* noop */ }
    const dy = Number(e.deltaY) || 0;
    if (!Number.isFinite(dy) || dy === 0) return;
    const factor = Math.exp(dy * 0.0012 * (wheelSpeed || 1));
    const next = clamp(goal.distance * factor, minDistance, maxDistance);
    if (next !== goal.distance) {
      goal.distance = next;
      userMoved = true;
    }
  }

  function snapToGoal() {
    cur.yaw = goal.yaw;
    cur.pitch = goal.pitch;
    cur.distance = goal.distance;
    cur.target.x = goal.target.x;
    cur.target.y = goal.target.y;
    cur.target.z = goal.target.z;
  }

  function pumpHover(force) {
    if (!onHover || !hoverDirty || !hoverNdc) return;
    const t = now();
    if (!force && t - lastHoverAt < hoverThrottleMs) return;
    lastHoverAt = t;
    hoverDirty = false;
    let hit = null;
    if (pick) {
      try {
        hit = pick(hoverNdc) || null;
      } catch {
        hit = null;
      }
    }
    let key = 'null';
    try {
      key = hoverKey(hit);
    } catch {
      key = String(Math.random());
    }
    if (key !== lastHoverKey) {
      lastHoverKey = key;
      try {
        onHover(hit);
      } catch { /* host callback must not break gestures */ }
    }
  }

  if (element) {
    try {
      prevTouchAction = element.style ? element.style.touchAction : null;
      if (element.style) element.style.touchAction = 'none';
    } catch { /* noop */ }
    track(elBound, element, 'pointerdown', onPointerDown);
    track(elBound, element, 'pointermove', onHoverMove);
    track(elBound, element, 'pointerleave', onHoverLeave);
    track(elBound, element, 'wheel', onWheel, { passive: false });
  }
  track(elBound, win, 'blur', cancelGesture);
  track(elBound, win, 'orientationchange', cancelGesture);
  track(elBound, doc, 'visibilitychange', () => { if (doc.hidden) cancelGesture(); });
  // Fullscreen/orientation shell signal (root dispatches document
  // 'game-screenchange' on entering/exiting): never let a pre-rotation
  // drag/pinch become a plot tap on the stale pointerup.
  track(elBound, doc, 'game-screenchange', cancelGesture);
  // Native orientation change (modern Screen Orientation API).
  try {
    const orient = (win && win.screen && win.screen.orientation) ||
      (typeof screen !== 'undefined' && screen && screen.orientation) || null;
    if (orient && typeof orient.addEventListener === 'function') {
      track(elBound, orient, 'change', cancelGesture);
    }
  } catch { /* no orientation object: orientationchange above still covers */ }
  // Room drawer + HUD drawers: opening/closing details.room-menu,
  // details.cc3d-help, or details.cc3d-camera-menu cancels. Toggle does
  // not bubble, so capture on document (supported by real DOM; mocks
  // ignore the capture flag but still dispatch).
  function onDrawerToggle(e) {
    if (disposed) return;
    const t = e && e.target;
    if (!t) return;
    try {
      if (typeof t.closest === 'function') {
        if (t.closest('details.room-menu,details.cc3d-help,details.cc3d-camera-menu,.room-menu,.cc3d-help,.cc3d-camera-menu')) {
          cancelGesture();
        }
      } else if (t.classList && typeof t.classList.contains === 'function' &&
        (t.classList.contains('room-menu') || t.classList.contains('cc3d-help') || t.classList.contains('cc3d-camera-menu'))) {
        cancelGesture();
      }
    } catch { /* noop */ }
  }
  track(elBound, doc, 'toggle', onDrawerToggle, true);
  applyOrbit(camera, cur.target, cur.yaw, cur.pitch, cur.distance);

  return {
    getState() {
      return {
        yaw: cur.yaw,
        pitch: cur.pitch,
        distance: cur.distance,
        target: { ...cur.target },
        goal: {
          yaw: goal.yaw,
          pitch: goal.pitch,
          distance: goal.distance,
          target: { ...goal.target },
        },
        userMoved,
        enabled,
        disposed,
      };
    },
    setTarget(p, instant) {
      if (disposed || !p) return;
      goal.target.x = Number(p.x) || 0;
      goal.target.y = Number(p.y) || 0;
      goal.target.z = Number(p.z) || 0;
      if (instant || reducedMotion()) {
        cur.target.x = goal.target.x;
        cur.target.y = goal.target.y;
        cur.target.z = goal.target.z;
      }
      applyOrbit(camera, cur.target, cur.yaw, cur.pitch, cur.distance);
    },
    /* Animated reframe (instant under reduced motion or instant:true). */
    focus(point, fopts = {}) {
      if (disposed) return;
      if (point) {
        goal.target.x = Number(point.x) || 0;
        goal.target.y = Number(point.y) || 0;
        goal.target.z = Number(point.z) || 0;
      }
      if (Number.isFinite(fopts.yaw)) goal.yaw = fopts.yaw;
      if (Number.isFinite(fopts.pitch)) goal.pitch = clamp(fopts.pitch, minPitch, maxPitch);
      if (Number.isFinite(fopts.distance)) goal.distance = clamp(fopts.distance, minDistance, maxDistance);
      userMoved = false;
      if (fopts.instant || reducedMotion()) snapToGoal();
      applyOrbit(camera, cur.target, cur.yaw, cur.pitch, cur.distance);
    },
    reset(fopts = {}) {
      if (disposed) return;
      goal.target.x = home.target.x;
      goal.target.y = home.target.y;
      goal.target.z = home.target.z;
      goal.yaw = Number.isFinite(fopts.yaw) ? fopts.yaw : home.yaw;
      goal.pitch = Number.isFinite(fopts.pitch) ? clamp(fopts.pitch, minPitch, maxPitch) : home.pitch;
      goal.distance = Number.isFinite(fopts.distance)
        ? clamp(fopts.distance, minDistance, maxDistance)
        : home.distance;
      userMoved = false;
      if (fopts.instant || reducedMotion()) snapToGoal();
      applyOrbit(camera, cur.target, cur.yaw, cur.pitch, cur.distance);
    },
    update(dt) {
      if (disposed || !enabled) return;
      const step = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0.016;
      const k = reducedMotion() ? 1 : 1 - Math.exp(-step * 10);
      if (k >= 1) {
        snapToGoal();
      } else {
        cur.yaw += (goal.yaw - cur.yaw) * k;
        cur.pitch += (goal.pitch - cur.pitch) * k;
        cur.distance += (goal.distance - cur.distance) * k;
        cur.target.x += (goal.target.x - cur.target.x) * k;
        cur.target.y += (goal.target.y - cur.target.y) * k;
        cur.target.z += (goal.target.z - cur.target.z) * k;
        if (Math.abs(goal.yaw - cur.yaw) < 1e-4) cur.yaw = goal.yaw;
        if (Math.abs(goal.pitch - cur.pitch) < 1e-4) cur.pitch = goal.pitch;
        if (Math.abs(goal.distance - cur.distance) < 1e-3) cur.distance = goal.distance;
      }
      applyOrbit(camera, cur.target, cur.yaw, cur.pitch, cur.distance);
      pumpHover(false);
    },
    setCallbacks(cb = {}) {
      if (typeof cb.pick === 'function') pick = cb.pick;
      if (typeof cb.onTap === 'function') onTap = cb.onTap;
      if (typeof cb.onHover === 'function') onHover = cb.onHover;
      if (cb.pick === null) pick = null;
      if (cb.onTap === null) onTap = null;
      if (cb.onHover === null) onHover = null;
    },
    setEnabled(v) {
      enabled = v !== false;
      if (!enabled) {
        cancelGesture();
      }
    },
    /* Drop an in-progress pointer/orbit/pinch sequence without moving
     * the camera: releases capture, clears pointers/pinch/tap state. */
    cancel() {
      if (disposed) return;
      cancelGesture();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pointers.clear();
      untrack(winBound);
      untrack(elBound);
      clearHover();
      try {
        if (element && element.style && prevTouchAction !== null) {
          element.style.touchAction = prevTouchAction;
        }
      } catch { /* noop */ }
    },
  };
}
