/* Matching sky reflections keep metal hubs, exhausts and stars legible.
 * A tiny authored hemisphere is captured once, never each animation frame.
 *
 * Contract: createKartLighting(THREE, renderer, scene, mood, opts?) ->
 *   cleanup() with .update(mood) + .setBounds(half).
 * - mood: world.palette (sky/horizon/sun/sunDir/hemi/fog/exposure). The
 *   initial call frames shadows + captures the environment once; later
 *   .update(mood) calls (root invokes disposeLighting.update(world.palette)
 *   after world.animate) refresh the retained hemisphere/sun/fog/background/
 *   exposure WITHOUT rebuilding PMREM, geometries, or textures.
 * - opts: optional fifth arg; a half-extent number, a bounds-like object
 *   ({half|arena|bound}), or {half: <number|bounds>} (root passes
 *   {half: world.bounds}). Defaults to the 30 legacy arena. .setBounds(half)
 *   reframes the shadow camera for large arenas using the same shapes.
 * - The return stays CALLABLE for view/backcompat (disposeLighting()).
 *   Cleanup removes the retained lights, clears the environment, and
 *   disposes once; update-after-dispose is a safe no-op.
 * Shadow framing: +- (half+8) with far half*2+45 (legacy +-38 / 105 at
 * half=30), sun distance half*2. Map size stays 1024 so large arenas do
 * not force fps cliffs — just a softer shadow texel.
 */

function numOr(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function clampHalf(h) {
  if (!Number.isFinite(h)) return 30;
  return h < 20 ? 20 : h > 80 ? 80 : h;
}

function halfFromBounds(b) {
  if (b == null || typeof b !== 'object') return undefined;
  const h = numOr(b.arena) ?? numOr(b.half);
  if (h !== undefined) return h;
  const bound = numOr(b.bound);
  if (bound !== undefined) return bound + 2;
  return undefined;
}

export function resolveLightingHalf(opts) {
  if (opts == null) return 30;
  if (typeof opts === 'number') {
    const h = numOr(opts);
    return h === undefined ? 30 : clampHalf(h);
  }
  if (typeof opts === 'object') {
    if (opts.half != null) {
      if (typeof opts.half === 'number') {
        const h = numOr(opts.half);
        if (h !== undefined) return clampHalf(h);
      } else if (typeof opts.half === 'object') {
        const h = halfFromBounds(opts.half);
        if (h !== undefined) return clampHalf(h);
      }
    }
    const direct = halfFromBounds(opts);
    if (direct !== undefined) return clampHalf(direct);
  }
  return 30;
}

export function createKartLighting(THREE, renderer, scene, mood, opts) {
  const m0 = mood || {};
  let curHalf = resolveLightingHalf(opts);
  let sunDist = curHalf * 2;
  const hemi = new THREE.HemisphereLight(
    m0.hemiSky !== undefined ? m0.hemiSky : 0xffffff,
    m0.hemiGround !== undefined ? m0.hemiGround : 0x444444,
    m0.hemiIntensity !== undefined ? m0.hemiIntensity : 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(
    m0.sun !== undefined ? m0.sun : 0xffffff,
    m0.sunIntensity !== undefined ? m0.sunIntensity : 1);
  if (Array.isArray(m0.sunDir)) sun.position.set(m0.sunDir[0] || 0, m0.sunDir[1] || 0, m0.sunDir[2] || 0).normalize().multiplyScalar(sunDist);
  else sun.position.set(-24, 45, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const frameShadow = (half) => {
    Object.assign(sun.shadow.camera, {
      left: -(half + 8), right: half + 8, top: half + 8, bottom: -(half + 8),
      near: 1, far: half * 2 + 45,
    });
    if (typeof sun.shadow.camera.updateProjectionMatrix === 'function') {
      sun.shadow.camera.updateProjectionMatrix();
    }
  };
  frameShadow(curHalf);
  sun.shadow.normalBias = .06; sun.shadow.bias = -.0002;
  scene.add(sun);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = numOr(m0.exposure) ?? 1.15;
  const applyFogBg = (m) => {
    if (!m) return;
    if (scene.fog && scene.fog.isFog !== false && m.horizon !== undefined) {
      if (scene.fog.color && typeof scene.fog.color.set === 'function') {
        scene.fog.color.set(m.horizon);
      }
      if (Array.isArray(m.fog)) {
        if (Number.isFinite(Number(m.fog[0]))) scene.fog.near = Number(m.fog[0]);
        if (Number.isFinite(Number(m.fog[1]))) scene.fog.far = Number(m.fog[1]);
      }
    }
    if (scene.background && scene.background.isColor && m.horizon !== undefined) {
      scene.background.set(m.horizon);
    }
  };
  applyFogBg(m0);
  const capture = new THREE.Scene();
  const geo = new THREE.SphereGeometry(20, 24, 12), pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const sky = new THREE.Color(m0.hemiSky !== undefined ? m0.hemiSky : 0xffffff).multiplyScalar(1.2);
  const ground = new THREE.Color(m0.hemiGround !== undefined ? m0.hemiGround : 0x444444).multiplyScalar(.75), col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    col.copy(ground).lerp(sky, Math.max(0, Math.min(1, (pos.getY(i) / 20 + 1) / 2)));
    colors.set([col.r, col.g, col.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  capture.add(new THREE.Mesh(geo, mat));
  let target = null;
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    try {
      target = pmrem.fromScene(capture, .03, .1, 100, { size: 64 });
    } finally {
      pmrem.dispose();
    }
  } catch {
    target = null; // headless/Node: keep lights + fog, skip reflections
  } finally {
    geo.dispose(); mat.dispose();
  }
  if (target && target.texture) {
    scene.environment = target.texture;
    scene.environmentIntensity = .4;
  }
  let disposed = false;
  function cleanup() {
    if (disposed) return;
    disposed = true;
    try { scene.remove(hemi); } catch { /* noop */ }
    try { scene.remove(sun); } catch { /* noop */ }
    try { scene.environment = null; } catch { /* noop */ }
    if (target) {
      try { target.dispose(); } catch { /* noop */ }
      target = null;
    }
  }
  cleanup.update = (m) => {
    if (disposed || !m) return;
    if (m.hemiSky !== undefined) hemi.color.set(m.hemiSky);
    if (m.hemiGround !== undefined) hemi.groundColor.set(m.hemiGround);
    if (Number.isFinite(Number(m.hemiIntensity))) hemi.intensity = Number(m.hemiIntensity);
    if (m.sun !== undefined) sun.color.set(m.sun);
    if (Number.isFinite(Number(m.sunIntensity))) sun.intensity = Number(m.sunIntensity);
    if (Array.isArray(m.sunDir)) {
      sun.position.set(m.sunDir[0] || 0, m.sunDir[1] || 0, m.sunDir[2] || 0).normalize().multiplyScalar(sunDist);
    }
    const exp = numOr(m.exposure);
    if (exp !== undefined) renderer.toneMappingExposure = exp;
    applyFogBg(m);
  };
  cleanup.setBounds = (h) => {
    if (disposed) return curHalf;
    curHalf = resolveLightingHalf(h);
    sunDist = curHalf * 2;
    frameShadow(curHalf);
    sun.position.setLength(sunDist);
    return curHalf;
  };
  cleanup.half = () => curHalf;
  return cleanup;
}
