/* Shared minimal Three.js view lifecycle (Game Kit 3D boundary).
 *
 * Simulation/render/input boundaries for every 3D game:
 * - the SERVER owns positions, scores, and outcomes (snapshots in);
 * - the GAME VIEW owns scene content, cameras, and input mapping;
 * - THIS HELPER owns GL lifecycle only: module import, renderer canvas,
 *   frame loop, resize observation, listener tracking, and full disposal.
 *
 * Games never import 'three' bare or from a CDN: the pinned local vendor
 * build (/vendor/three/three.module.js + its sibling three.core.js) is the
 * only source. WebGL failures resolve to { fallback: true } so the view
 * can run its 2D canvas fallback on the SAME server snapshots.
 */

const VENDOR_URL = '/vendor/three/three.module.js';

function wantsFallback() {
  try {
    return new URLSearchParams(window.location.search).get('nowebgl') === '1';
  } catch {
    return false;
  }
}

function disposeObject(root) {
  if (!root || typeof root.traverse !== 'function') return;
  // Authored worlds and cloned models deliberately share resources. Dispose
  // each one once, rather than dispatching hundreds of repeated dispose
  // events and scanning the same material for every mesh in the scene.
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse((obj) => {
    if (obj.geometry && typeof obj.geometry.dispose === 'function') geometries.add(obj.geometry);
    const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
    for (const m of mats) {
      if (!m || materials.has(m)) continue;
      materials.add(m);
      for (const key of Object.keys(m)) {
        const v = m[key];
        if (v && v.isTexture && typeof v.dispose === 'function') textures.add(v);
      }
    }
  });
  for (const geometry of geometries) { try { geometry.dispose(); } catch { /* noop */ } }
  for (const texture of textures) { try { texture.dispose(); } catch { /* noop */ } }
  for (const material of materials) {
    if (typeof material.dispose === 'function') { try { material.dispose(); } catch { /* noop */ } }
  }
}

/* Mount a Three.js view inside mountEl.
 * hooks.build(THREE, helper) constructs { scene, camera, frame(dt, t) } plus
 * optional resize(w, h) and dispose() for scene-owned render targets. helper offers track(t, type, fn, opts) for extra
 * listeners, reducedMotion(), and canvas().
 * Returns the live handle, or { fallback: true, reason } when WebGL cannot
 * start (unavailable, blocked, or ?nowebgl=1). Never throws. */
export async function createThreeView(mountEl, hooks) {
  const tracked = [];
  const track = (t, type, fn, opts) => {
    if (!t || !t.addEventListener) return;
    t.addEventListener(type, fn, opts);
    tracked.push([t, type, fn, opts]);
  };
  const untrackAll = () => {
    for (const [t, type, fn, opts] of tracked) {
      try { t.removeEventListener(type, fn, opts); } catch { /* noop */ }
    }
    tracked.length = 0;
  };
  const reducedMotion = () => {
    try {
      return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  };

  if (!mountEl) return { fallback: true, reason: 'no-mount' };
  if (!hooks || typeof hooks.build !== 'function') return { fallback: true, reason: 'no-build' };
  const signal = hooks.signal;
  if (signal?.aborted) return { fallback: true, reason: 'retired' };
  if (wantsFallback()) return { fallback: true, reason: 'forced' };

  let THREE = null;
  try {
    THREE = await import(VENDOR_URL);
  } catch (e) {
    return { fallback: true, reason: 'vendor-missing' };
  }
  if (signal?.aborted) return { fallback: true, reason: 'retired' };
  if (!THREE || !THREE.WebGLRenderer) return { fallback: true, reason: 'vendor-shape' };

  const canvas = document.createElement('canvas');
  canvas.setAttribute('data-gl', 'three');
  canvas.setAttribute('aria-hidden', 'true');
  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    return { fallback: true, reason: 'webgl-unavailable' };
  }
  if (!renderer || !renderer.getContext()) {
    try { if (renderer) renderer.dispose(); } catch { /* noop */ }
    return { fallback: true, reason: 'webgl-unavailable' };
  }
  // Adaptive resolution: a struggling device renders fewer pixels instead
  // of dropping frames, and climbs back once frames are cheap again.
  // Phones start at 1.5x: about a quarter fewer pixels than 1.75x for a
  // difference hard to see at arm's length (measured 116 -> 94 ms/frame on a
  // weak-GPU proxy, 4.5 -> 2.2 ms on a fast one). Desktops keep 1.75x.
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const MAX_RATIO = coarse ? 1.5 : 1.75, MIN_RATIO = 0.75, RATIO_STEP = 0.25;
  const deviceRatio = () => Math.min(window.devicePixelRatio || 1, MAX_RATIO);
  let ratioCap = MAX_RATIO;
  const targetRatio = () => Math.max(Math.min(MIN_RATIO, deviceRatio()), Math.min(deviceRatio(), ratioCap));
  let pixelRatio = targetRatio();
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace || renderer.outputColorSpace;
  mountEl.appendChild(canvas);

  const helper = { track, reducedMotion, canvas: () => canvas, renderer: () => renderer, disposeObject, three: THREE };
  let built = null;
  let released = false;
  const releaseRenderer = () => {
    if (released) return;
    released = true;
    try { renderer.dispose(); } catch { /* noop */ }
    canvas.remove(); untrackAll();
  };
  signal?.addEventListener('abort', releaseRenderer, { once: true });
  try {
    built = await hooks.build(THREE, helper);
  } catch (e) {
    signal?.removeEventListener('abort', releaseRenderer);
    releaseRenderer();
    return { fallback: true, reason: 'build-failed' };
  }
  signal?.removeEventListener('abort', releaseRenderer);
  if (signal?.aborted) {
    try { built?.dispose?.(); } catch { /* release remaining scene resources */ }
    disposeObject(built?.scene);
    releaseRenderer();
    return { fallback: true, reason: 'retired' };
  }
  if (!built || !built.scene || !built.camera || typeof built.frame !== 'function') {
    try { built?.dispose?.(); } catch { /* release remaining scene resources */ }
    disposeObject(built?.scene);
    releaseRenderer();
    return { fallback: true, reason: 'build-shape' };
  }
  const { scene, camera } = built;

  let disposed = false;
  let lastWidth = 0, lastHeight = 0;
  const doResize = () => {
    if (disposed) return;
    const w = Math.max(1, mountEl.clientWidth || 320);
    const h = Math.max(1, mountEl.clientHeight || 240);
    const ratio = targetRatio();
    const sizeChanged = w !== lastWidth || h !== lastHeight;
    const ratioChanged = ratio !== pixelRatio;
    if (!sizeChanged && !ratioChanged) return;
    // Three's setPixelRatio itself calls setSize. Keep it out of ordinary
    // resize/observer callbacks and avoid a second resize for a DPR-only change.
    if (ratioChanged) { renderer.setPixelRatio(ratio); pixelRatio = ratio; }
    if (sizeChanged) renderer.setSize(w, h, false);
    lastWidth = w; lastHeight = h;
    if (typeof built.resize === 'function') {
      try { built.resize(w, h); } catch { /* noop */ }
    } else if (camera && camera.isPerspectiveCamera) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  };
  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(doResize);
    ro.observe(mountEl);
  }
  track(window, 'resize', doResize);
  doResize();

  let lost = false;
  let resolveFrame, rejectFrame;
  const firstFrame = new Promise((resolve, reject) => { resolveFrame = resolve; rejectFrame = reject; });
  // Existing views may ignore firstFrame. Opting out must not produce an
  // unhandled rejection when the context fails or the view leaves early.
  firstFrame.catch(() => {});
  track(canvas, 'webglcontextlost', (e) => {
    try { hooks.diagnostics?.event?.('webgl-lost'); } catch { /* diagnostics must not change view state */ }
    try { if (e && e.preventDefault) e.preventDefault(); } catch { /* noop */ }
    lost = true;
    rejectFrame(new Error('WebGL context lost before a usable frame'));
    try { renderer.setAnimationLoop(null); } catch { /* noop */ }
    if (typeof hooks.onContextLost === 'function') {
      try { hooks.onContextLost(); } catch { /* noop */ }
    }
  });

  let hasDrawn = false;
  let last = performance.now();
  const gaps = [];
  let lastStep = performance.now(), climbs = 0;
  const adapt = (now, gapMs) => {
    // Skip hidden tabs and long pauses (tab switches, debugger), which say
    // nothing about rendering cost.
    if (document.hidden || gapMs > 250) { gaps.length = 0; return; }
    gaps.push(gapMs);
    if (gaps.length > 90) gaps.shift();
    if (gaps.length < 30 || now - lastStep < 1500) return;
    const median = gaps.slice().sort((a, b) => a - b)[gaps.length >> 1];
    const current = targetRatio();
    let next = current;
    // A badly struggling device (under ~20 fps) goes straight to the floor
    // instead of a notch every 1.5s; a merely slow one steps down gently.
    if (median > 50 && current > MIN_RATIO) next = MIN_RATIO;
    else if (median > 24 && current > MIN_RATIO) next = Math.max(MIN_RATIO, current - RATIO_STEP);
    // Still slow at the lowest resolution: drop the shadow pass for good
    // (it redraws every caster each frame). Fast devices never get here.
    else if (median > 24 && renderer.shadowMap.enabled) {
      renderer.shadowMap.enabled = false;
      // Shared materials need one version bump, not one per pooled mesh.
      const changed=new Set();scene.traverse(o=>{if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])if(!changed.has(m)){changed.add(m);m.needsUpdate=true;}});
      lastStep = now; gaps.length = 0;
      try { hooks.diagnostics?.event?.('quality-shadows', 'off'); } catch { /* measurement is optional */ }
      return;
    }
    // Climb back slowly, and stop trying after a few round trips so a
    // borderline device settles instead of oscillating.
    else if (median < 19 && current < deviceRatio() && climbs < 3 && now - lastStep > 10000) { next = Math.min(deviceRatio(), current + RATIO_STEP); climbs++; }
    if (next === current) return;
    ratioCap = next;
    lastStep = now; gaps.length = 0;
    try { hooks.diagnostics?.event?.('quality-ratio', next); } catch { /* measurement is optional */ }
    doResize();
  };
  const renderOnce = () => {
    if (lost || disposed) return;
    const now = performance.now();
    if (hasDrawn) adapt(now, now - last);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      built.frame(dt, now / 1000);
    } catch (e) {
      try { hooks.diagnostics?.event?.('render-error'); } catch { /* keep the original failure */ }
      rejectFrame(e);
      if (typeof console !== 'undefined') console.error('3d frame error', e);
      return;
    }
    try {
      renderer.render(scene, camera);
      hasDrawn = true;
      try { hooks.diagnostics?.renderFrame?.(performance.now() - now, renderer.info); } catch { /* measurement is optional */ }
      resolveFrame();
    } catch (e) {
      rejectFrame(e);
      if (typeof console !== 'undefined') console.error('3d render error', e);
      try { hooks.diagnostics?.event?.('render-error'); } catch { /* keep the original failure */ }
    }
  };
  renderer.setAnimationLoop(() => {
    // Keep a real first draw/readiness check, but do not keep submitting
    // invisible players' scenes while one person uses another seat.
    try {
      if (hasDrawn && document.defaultView?.frameElement?.closest?.('[hidden], [inert]')) return;
    } catch { /* Cross-origin embeds retain their normal render loop. */ }
    renderOnce();
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener('abort', dispose);
    rejectFrame(new Error('3D view retired before a usable frame'));
    try { renderer.setAnimationLoop(null); } catch { /* noop */ }
    if (ro) {
      try { ro.disconnect(); } catch { /* noop */ }
      ro = null;
    }
    untrackAll();
    if (typeof built.dispose === 'function') { try { built.dispose(); } catch { /* release remaining scene resources */ } }
    disposeObject(scene);
    try { renderer.dispose(); } catch { /* noop */ }
    try {
      const gl = renderer.getContext();
      const ext = gl && gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    } catch { /* noop */ }
    try { canvas.remove(); } catch { /* noop */ }
  };
  signal?.addEventListener('abort', dispose, { once: true });
  if (signal?.aborted) dispose();

  return {
    fallback: false, three: THREE, renderer, canvas, scene, camera, track, firstFrame, renderOnce, disposed: () => disposed, dispose,
  };
}
