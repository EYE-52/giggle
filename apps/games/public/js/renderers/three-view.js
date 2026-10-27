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
  if (!root) return;
  root.traverse((obj) => {
    if (obj.geometry && typeof obj.geometry.dispose === 'function') {
      try { obj.geometry.dispose(); } catch { /* noop */ }
    }
    const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
    for (const m of mats) {
      for (const key of Object.keys(m)) {
        const v = m[key];
        if (v && v.isTexture && typeof v.dispose === 'function') {
          try { v.dispose(); } catch { /* noop */ }
        }
      }
      if (typeof m.dispose === 'function') {
        try { m.dispose(); } catch { /* noop */ }
      }
    }
  });
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
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
    try { renderer.dispose(); } catch { /* noop */ }
    canvas.remove();
    untrackAll();
    return { fallback: true, reason: 'build-shape' };
  }
  const { scene, camera } = built;

  const doResize = () => {
    const w = Math.max(1, mountEl.clientWidth || 320);
    const h = Math.max(1, mountEl.clientHeight || 240);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(w, h, false);
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
    hooks.diagnostics?.event('webgl-lost');
    try { if (e && e.preventDefault) e.preventDefault(); } catch { /* noop */ }
    lost = true;
    rejectFrame(new Error('WebGL context lost before a usable frame'));
    try { renderer.setAnimationLoop(null); } catch { /* noop */ }
    if (typeof hooks.onContextLost === 'function') {
      try { hooks.onContextLost(); } catch { /* noop */ }
    }
  });

  let last = performance.now();
  renderer.setAnimationLoop(() => {
    if (lost) return;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      built.frame(dt, now / 1000);
    } catch (e) {
      hooks.diagnostics?.event('render-error');
      rejectFrame(e);
      if (typeof console !== 'undefined') console.error('3d frame error', e);
      return;
    }
    try {
      renderer.render(scene, camera);
      hooks.diagnostics?.renderFrame(performance.now() - now, renderer.info);
      resolveFrame();
    } catch (e) {
      rejectFrame(e);
      if (typeof console !== 'undefined') console.error('3d render error', e);
      hooks.diagnostics?.event('render-error');
    }
  });

  let disposed = false;
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
    fallback: false, three: THREE, renderer, canvas, scene, camera, track, firstFrame, disposed: () => disposed, dispose,
  };
}
