/* Arena feature dressing for the classic 3D view: launch cannons, portal
 * rings and fall-off zones, plus their bounded effects (muzzle smoke,
 * landing dust, warp swirl, splash) and the faller's sink. Presentation
 * only: positions come straight from snapshot map.features and accepted
 * arenaEvents. Geometry and materials are shared and built once; all
 * effects use one fixed instanced pool, so frames never allocate.
 *
 * createKartArenaFeatures(THREE, scene, { groundAt, reducedMotion }) -> {
 *   sync(map), ingest(events, karts), animate(dt, t, now, S, poses),
 *   dressKart(k, mesh, now) -> bool, dispose() } */
import {flightPose, portalExit} from './kart-map-features.mjs';
import {instanceRepeats} from './kart-instancing.mjs';

const PORTAL_COLORS = [[0xff8a2a, 0x39b8ff], [0xb46cff, 0x6dffb0]];
const FALL_STYLE = {
  water: { surface: 0x2f9fd0, deep: 0x16577e, rim: 0xcab89a, splash: [0xd8f4ff, 0x63c7f2] },
  ice: { surface: 0x3b7fb8, deep: 0x123a63, rim: 0xf4fbff, splash: [0xffffff, 0xa9e4ff] },
  goo: { surface: 0x67ff4a, deep: 0x1d6d24, rim: 0xffd23a, splash: [0xb7ff7a, 0x4bea3a] },
  pit: { surface: 0x1c1626, deep: 0x07060b, rim: 0xff9b3d, splash: [0x8a7a68, 0x5c5046] },
};
const CANNON_BODY = { ring: 0xe2453b, blocks: 0x3b7be2, garden: 0xe2453b, frost: 0x3d6fd6, neon: 0xff4fd0 };
const MAX_PARTICLES = 160;
const MAX_TRAIL_DOTS = 14;

export function createKartArenaFeatures(THREE, scene, { groundAt = () => 0, reducedMotion = () => false } = {}) {
  const root = new THREE.Group(); root.name = 'arena-features'; scene.add(root);
  const reduce = () => (typeof reducedMotion === 'function' ? reducedMotion() : !!reducedMotion);
  // ---- shared geometry ----
  const G = {
    base: new THREE.CylinderGeometry(2.1, 2.35, .32, 20),
    wheel: new THREE.CylinderGeometry(1.05, 1.05, .34, 18).rotateZ(Math.PI / 2),
    hub: new THREE.CylinderGeometry(.32, .32, .42, 10).rotateZ(Math.PI / 2),
    barrel: new THREE.CylinderGeometry(1.0, 1.28, 4.4, 20, 1, true).rotateX(Math.PI / 2),
    band: new THREE.TorusGeometry(1.12, .17, 8, 24),
    mouth: new THREE.CircleGeometry(1.0, 20),
    ramp: new THREE.BoxGeometry(2.5, .16, 2.6),
    chevron: new THREE.PlaneGeometry(.7, 1.6).rotateX(-Math.PI / 2),
    target: new THREE.RingGeometry(2.0, 2.6, 36).rotateX(-Math.PI / 2),
    targetDot: new THREE.CircleGeometry(.7, 18).rotateX(-Math.PI / 2),
    ring: new THREE.TorusGeometry(2.15, .3, 12, 40),
    membrane: new THREE.CircleGeometry(1.9, 32),
    swirl: new THREE.RingGeometry(.35, 1.75, 24, 1, 0, Math.PI * .55),
    foot: new THREE.BoxGeometry(.55, .5, .9),
    pool: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    rim: new THREE.BoxGeometry(1, .16, 1),
    ripple: new THREE.RingGeometry(.86, 1, 28).rotateX(-Math.PI / 2),
    pad: new THREE.CircleGeometry(.55, 10).rotateX(-Math.PI / 2),
    particle: new THREE.IcosahedronGeometry(.32, 0),
    dot: new THREE.SphereGeometry(.16, 6, 4),
  };
  const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra });
  const lit = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .55, metalness: .1, ...extra });
  const M = {
    wood: lit(0x7a4b2a), metal: lit(0x3a3f4a, { metalness: .4, roughness: .4 }), gold: lit(0xf2c14e, { metalness: .5, roughness: .35 }),
    mouth: basic(0x140d10), ramp: lit(0xf2c14e), chevron: basic(0xfff3b0),
    target: basic(0xfff1a8, { side: THREE.DoubleSide }),
    foot: lit(0x2b2f3a), lily: basic(0x5cbf4a), particle: basic(0xffffff, { transparent: true, opacity: .9, depthWrite: false }),
    dot: basic(0xfff3b0, { transparent: true, opacity: .55, depthWrite: false }),
  };
  const bodyMats = new Map(), portalMats = new Map(), fallMats = new Map();
  const bodyMat = (theme) => { const c = CANNON_BODY[theme] || CANNON_BODY.garden; if (!bodyMats.has(c)) bodyMats.set(c, lit(c, { roughness: .45 })); return bodyMats.get(c); };
  const portalMat = (color) => {
    if (!portalMats.has(color)) portalMats.set(color, {
      ring: basic(color), membrane: basic(color, { transparent: true, opacity: .32, side: THREE.DoubleSide, depthWrite: false }),
      swirl: basic(0xffffff, { transparent: true, opacity: .55, side: THREE.DoubleSide, depthWrite: false }),
    });
    return portalMats.get(color);
  };
  const fallMat = (kind) => {
    const style = FALL_STYLE[kind] || FALL_STYLE.water;
    if (!fallMats.has(kind)) fallMats.set(kind, {
      style,
      surface: basic(style.surface, { transparent: true, opacity: .92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      deep: basic(style.deep, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      rim: lit(style.rim), stripe: lit(0x1b1b1f),
      ripple: basic(0xffffff, { transparent: true, opacity: .5, depthWrite: false, side: THREE.DoubleSide }),
    });
    return fallMats.get(kind);
  };
  // ---- effects pool (one InstancedMesh, fixed capacity) ----
  const particles = new THREE.InstancedMesh(G.particle, M.particle, MAX_PARTICLES);
  particles.name = 'arena-feature-fx'; particles.frustumCulled = false; particles.count = 0;
  particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  particles.setColorAt(0, new THREE.Color(1, 1, 1));
  root.add(particles);
  const P = { x: new Float32Array(MAX_PARTICLES), y: new Float32Array(MAX_PARTICLES), z: new Float32Array(MAX_PARTICLES),
    vx: new Float32Array(MAX_PARTICLES), vy: new Float32Array(MAX_PARTICLES), vz: new Float32Array(MAX_PARTICLES),
    age: new Float32Array(MAX_PARTICLES), life: new Float32Array(MAX_PARTICLES), size: new Float32Array(MAX_PARTICLES), grav: new Float32Array(MAX_PARTICLES) };
  let head = 0;
  const color = new THREE.Color(), matrix = new THREE.Matrix4(), quat = new THREE.Quaternion(), scaleV = new THREE.Vector3(), posV = new THREE.Vector3();
  function spawn(x, y, z, vx, vy, vz, life, size, hex, grav = 6) {
    const i = head; head = (head + 1) % MAX_PARTICLES;
    P.x[i] = x; P.y[i] = y; P.z[i] = z; P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz; P.age[i] = 0; P.life[i] = life; P.size[i] = size; P.grav[i] = grav;
    particles.setColorAt(i, color.setHex(hex));
    particles.instanceColor.needsUpdate = true;
  }
  // Trail dots preview each cannon's arc (shared instanced mesh).
  const trail = new THREE.InstancedMesh(G.dot, M.dot, MAX_TRAIL_DOTS * 2);
  trail.name = 'arena-cannon-arcs'; trail.frustumCulled = false; trail.count = 0; root.add(trail);

  let key = '', cannons = [], portals = [], falls = [], features = null, instanced = [];
  const seen = new Set(), falling = new Map(), lastPuff = new Map();
  let clock = 0;

  function clear() {
    for (const list of [cannons, portals, falls]) for (const item of list) { root.remove(item.group); item.land && root.remove(item.land); }
    for (const made of instanced) { root.remove(made.mesh); made.mesh.dispose(); }
    cannons = []; portals = []; falls = []; instanced = []; trail.count = 0;
  }
  function buildCannon(c, theme, index) {
    const group = new THREE.Group(); group.name = 'arena-cannon-' + index;
    const y0 = groundAt(c.x, c.z);
    group.position.set(c.x, y0, c.z); group.rotation.y = c.angle;
    const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; group.add(m); return m; };
    add(G.base, M.metal, 0, .16, 0);
    for (const side of [-1, 1]) { add(G.wheel, M.wood, side * 1.75, 1.05, -.3); add(G.hub, M.gold, side * 1.95, 1.05, -.3); }
    // Barrel tilts up toward the launch direction; its open rear mouth sits
    // low over the entry ramp, its muzzle high toward the landing zone.
    const tilt = -.42;
    const barrel = new THREE.Group(); barrel.position.set(0, 1.55, .2); barrel.rotation.x = tilt; group.add(barrel);
    const body = new THREE.Mesh(G.barrel, bodyMat(theme)); body.castShadow = true; barrel.add(body);
    for (const z of [-2.1, .2, 2.1]) { const band = new THREE.Mesh(G.band, M.gold); band.position.z = z; band.scale.setScalar(z > 0 ? .92 : z < -1 ? 1.14 : 1.04); barrel.add(band); }
    const muzzle = new THREE.Mesh(G.mouth, M.mouth); muzzle.position.z = 2.15; barrel.add(muzzle);
    const mouth = new THREE.Mesh(G.mouth, M.mouth); mouth.position.z = -2.15; mouth.rotation.y = Math.PI; mouth.scale.setScalar(1.22); barrel.add(mouth);
    add(G.ramp, M.ramp, 0, .35, -2.9, .28);
    for (let i = 0; i < 3; i++) { const ch = add(G.chevron, M.chevron, 0, .03, -4.6 - i * 1.25); ch.rotation.y = 0; ch.scale.set(1, 1, .45); ch.castShadow = false; }
    root.add(group);
    // Landing target on the ground.
    const land = new THREE.Group(); land.name = 'arena-landing-' + index;
    land.position.set(c.land.x, groundAt(c.land.x, c.land.z) + .05, c.land.z);
    land.add(new THREE.Mesh(G.target, M.target)); const dot = new THREE.Mesh(G.targetDot, M.target); dot.position.y = .01; land.add(dot);
    for (let i = 0; i < 2; i++) { const ch = new THREE.Mesh(G.chevron, M.chevron); ch.position.set(0, .02, 3.3 + i * 1.1); ch.scale.set(1, 1, .4); land.add(ch); }
    land.rotation.y = c.land.angle;
    group.userData.land = land; root.add(land);
    return { group, barrel, land, c, index, y0 };
  }
  function buildPortal(p, pair, side) {
    const group = new THREE.Group(); group.name = 'arena-portal-' + pair + '-' + side;
    const mats = portalMat(PORTAL_COLORS[pair % PORTAL_COLORS.length][side]);
    group.position.set(p.x, groundAt(p.x, p.z), p.z); group.rotation.y = p.angle;
    const ring = new THREE.Mesh(G.ring, mats.ring); ring.position.y = 2.45; group.add(ring);
    const membrane = new THREE.Mesh(G.membrane, mats.membrane); membrane.position.y = 2.45; group.add(membrane);
    const swirls = [];
    for (let i = 0; i < 2; i++) { const s = new THREE.Mesh(G.swirl, mats.swirl); s.position.set(0, 2.45, (i - .5) * .05); s.rotation.z = i * Math.PI; group.add(s); swirls.push(s); }
    for (const v of [-1, 1]) { const foot = new THREE.Mesh(G.foot, M.foot); foot.position.set(v * 1.75, .25, 0); foot.castShadow = true; group.add(foot); }
    root.add(group);
    return { group, ring, membrane, swirls, p, pair, side, color: PORTAL_COLORS[pair % PORTAL_COLORS.length][side] };
  }
  function buildFall(f, index) {
    const kind = FALL_STYLE[f.kind] ? f.kind : 'water', mats = fallMat(kind);
    const group = new THREE.Group(); group.name = 'arena-fall-' + index;
    const y = groundAt(f.x, f.z);
    group.position.set(f.x, y, f.z);
    const deep = new THREE.Mesh(G.pool, mats.deep); deep.scale.set(f.hw * 2, 1, f.hd * 2); deep.position.y = .025; group.add(deep);
    const surface = new THREE.Mesh(G.pool, mats.surface); surface.scale.set(f.hw * 2 - .7, 1, f.hd * 2 - .7); surface.position.y = .04;
    if (kind !== 'pit') group.add(surface);
    // Low edging (visual only; the drive surface stays flat).
    const segs = [];
    const edge = (x, z, w, d, mat) => { const m = new THREE.Mesh(G.rim, mat); m.scale.set(w, 1, d); m.position.set(x, .08, z); m.receiveShadow = true; group.add(m); segs.push(m); };
    const striped = kind === 'pit' || kind === 'goo';
    for (const s of [-1, 1]) {
      const n = striped ? Math.max(2, Math.round(f.hw * 2 / 1.1)) : 1;
      for (let i = 0; i < n; i++) edge(-f.hw + (i + .5) * (f.hw * 2 / n), s * (f.hd + .18), f.hw * 2 / n, .36, striped && i % 2 ? mats.stripe : mats.rim);
      const m = striped ? Math.max(2, Math.round(f.hd * 2 / 1.1)) : 1;
      for (let i = 0; i < m; i++) edge(s * (f.hw + .18), -f.hd + (i + .5) * (f.hd * 2 / m), .36, f.hd * 2 / m, striped && i % 2 ? mats.stripe : mats.rim);
    }
    const ripples = [];
    if (kind !== 'pit') for (let i = 0; i < 2; i++) {
      const r = new THREE.Mesh(G.ripple, mats.ripple); r.position.set((i ? .35 : -.3) * f.hw, .06, (i ? -.25 : .3) * f.hd); group.add(r); ripples.push(r);
    }
    if (kind === 'water') for (const [u, v] of [[-.55, -.35], [.5, .4], [.15, -.5]]) { const lily = new THREE.Mesh(G.pad, M.lily); lily.position.set(u * f.hw, .065, v * f.hd); group.add(lily); }
    root.add(group);
    return { group, surface, ripples, f, kind, mats };
  }

  let lastRef;
  function sync(map) {
    // Snapshots are fresh objects; only re-key when the features object changes.
    if (map?.features === lastRef && (map?.features || !key)) return;
    lastRef = map?.features;
    const next = map?.features ? (map.id + '|' + JSON.stringify(map.features)) : '';
    if (next === key) return;
    key = next; clear(); features = map?.features || null;
    if (!features) return;
    const theme = map.theme || map.id;
    (features.cannons || []).forEach((c, i) => cannons.push(buildCannon(c, theme, i)));
    (features.portals || []).forEach((pair, i) => pair.forEach((p, side) => portals.push(buildPortal(p, i, side))));
    (features.falls || []).forEach((f, i) => falls.push(buildFall(f, i)));
    // Static parts (bases, wheels, ramps, chevrons, targets, rims, feet)
    // collapse to one instanced draw per geometry/material pair; animated
    // barrels and rings, and transparent water/membranes, keep their own.
    const skip = new Set([particles, trail, ...portals.map(p => p.ring)]);
    instanced = instanceRepeats(THREE, root, { skip, minCount: 2 });
    // Static arc preview dots (cheap readability: where the cannon sends you).
    let n = 0;
    for (const item of cannons.slice(0, 2)) {
      const c = item.c, y = groundAt(c.x, c.z) + 2.4, ly = groundAt(c.land.x, c.land.z) + .9;
      for (let i = 1; i <= MAX_TRAIL_DOTS; i++) {
        const pose = flightPose(c, { x: c.x, y, z: c.z, a: c.angle, ly }, (i / (MAX_TRAIL_DOTS + 1)) * (c.flight || 1.4));
        matrix.makeTranslation(pose.position.x, pose.position.y, pose.position.z); trail.setMatrixAt(n++, matrix);
      }
    }
    trail.count = n; trail.instanceMatrix.needsUpdate = true;
  }

  function burst(kind, x, y, z, extra = {}) {
    const quiet = reduce();
    if (kind === 'launch') {
      const a = extra.angle || 0, fx = Math.sin(a), fz = Math.cos(a);
      const n = quiet ? 4 : 16;
      for (let i = 0; i < n; i++) {
        const s = i * 2.399, spread = .35 + (i % 4) * .18;
        spawn(x + fx * 2.6, y + 2.4, z + fz * 2.6, fx * (6 + i % 5) + Math.cos(s) * spread * 3, 2.5 + (i % 3) * 1.2, fz * (6 + i % 5) + Math.sin(s) * spread * 3,
          .55 + (i % 4) * .1, .9 + (i % 3) * .3, i < 4 ? 0xffb547 : i % 2 ? 0xeeeeee : 0xbcbcbc, -1.5);
      }
    } else if (kind === 'land') {
      const n = quiet ? 4 : 14;
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; spawn(x + Math.sin(a) * .8, y + .25, z + Math.cos(a) * .8, Math.sin(a) * 5, 1.2 + (i % 3) * .5, Math.cos(a) * 5, .6, .8 + (i % 2) * .4, i % 2 ? 0xd9c29a : 0xb79f7b, 3); }
    } else if (kind === 'warp') {
      const n = quiet ? 4 : 14;
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, r = 1.6; spawn(x + Math.sin(a) * r, y + 2.45 + Math.cos(a) * r * .8, z + Math.cos(a) * r * .2, Math.cos(a) * 3.5, -Math.sin(a) * 3 + 1, -Math.sin(a) * 3.5, .45, .55, i % 2 ? extra.color || 0xffffff : 0xffffff, 0); }
    } else if (kind === 'fell') {
      const style = FALL_STYLE[extra.kind] || FALL_STYLE.water, n = quiet ? 5 : 20;
      for (let i = 0; i < n; i++) { const a = i * 2.399, r = .3 + (i % 4) * .25; spawn(x + Math.cos(a) * r, y + .2, z + Math.sin(a) * r, Math.cos(a) * (1.5 + i % 3), 5 + (i % 5) * 1.3, Math.sin(a) * (1.5 + i % 3), .8, .5 + (i % 3) * .2, style.splash[i % 2], 14); }
    } else if (kind === 'trail') {
      spawn(x, y, z, 0, .4, 0, .45, .55, 0xf3f0ea, -.5);
    }
  }

  /* Accepted arenaEvents -> effects, once per id; history before the first
   * call stays quiet. `karts` gives the faller's last known pose. */
  let primed = false;
  function ingest(events, karts) {
    for (const e of events || []) {
      if (seen.has(e.id)) continue; seen.add(e.id);
      if (!primed) continue;
      if (e.type === 'launch') {
        const item = cannons[e.cannon];
        if (item) burst('launch', item.c.x, item.y0, item.c.z, { angle: item.c.angle });
      } else if (e.type === 'land') {
        const c = features?.cannons?.[e.cannon]; if (c) burst('land', c.land.x, groundAt(c.land.x, c.land.z), c.land.z);
      } else if (e.type === 'warp') {
        for (const item of portals) if (Math.hypot(item.p.x - e.from?.x, item.p.z - e.from?.z) < .01 || Math.hypot(item.p.x - e.to?.x, item.p.z - e.to?.z) < .01) burst('warp', item.p.x, groundAt(item.p.x, item.p.z), item.p.z, { color: item.color });
      } else if (e.type === 'fell' && Number.isFinite(e.x)) {
        const g = groundAt(e.x, e.z);
        burst('fell', e.x, g, e.z, { kind: e.kind });
        falling.set(e.pid, { at: clock, x: e.x, z: e.z, g, angle: Number(e.angle) || 0, life: karts?.find?.(k => k.pid === e.pid)?.spawnSeq });
      }
    }
    while (seen.size > 64) seen.delete(seen.values().next().value);
    primed = true;
  }
  function resetHistory() { primed = false; seen.clear(); falling.clear(); }

  function animate(dt, t, S, poses) {
    clock = t;
    const quiet = reduce();
    for (const item of portals) {
      if (quiet) continue;
      for (let i = 0; i < item.swirls.length; i++) item.swirls[i].rotation.z = i * Math.PI + t * (2.2 + i * .9) * (item.side ? -1 : 1);
      item.ring.scale.setScalar(1 + Math.sin(t * 3 + item.pair) * .025);
    }
    for (const item of falls) {
      if (quiet) continue;
      for (let i = 0; i < item.ripples.length; i++) { const phase = (t * .45 + i * .5) % 1, s = .4 + phase * Math.min(item.f.hw, item.f.hd) * 1.2; item.ripples[i].scale.set(s, 1, s); item.ripples[i].material.opacity = .45 * (1 - phase); }
    }
    // Flight trails: a puff behind every airborne kart, rate limited.
    if (S?.karts && !quiet) for (const k of S.karts) {
      if (!k.flight) continue;
      const pose = poses?.get?.(k.pid), p = pose?.physicalPose?.position || k.physicalPose?.position;
      if (!p || t - (lastPuff.get(k.pid) ?? -9) < .05) continue;
      lastPuff.set(k.pid, t); burst('trail', p.x, p.y - .2, p.z);
    }
    // Step the pool.
    let live = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!(P.life[i] > 0)) continue;
      P.age[i] += dt;
      if (P.age[i] >= P.life[i]) { P.life[i] = 0; continue; }
      P.vy[i] -= P.grav[i] * dt; P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt; P.z[i] += P.vz[i] * dt;
      live++;
    }
    if (!live) { particles.count = 0; return; }
    let n = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!(P.life[i] > 0)) { matrix.makeScale(0, 0, 0); particles.setMatrixAt(i, matrix); continue; }
      const k = 1 - P.age[i] / P.life[i], s = P.size[i] * (.35 + .65 * k);
      matrix.compose(posV.set(P.x[i], P.y[i], P.z[i]), quat, scaleV.set(s, s, s)); particles.setMatrixAt(i, matrix); n = i + 1;
    }
    particles.count = n;
    particles.instanceMatrix.needsUpdate = true;
  }

  /* The faller sinks into the hazard for a moment, then hides until the
   * normal respawn. Returns true when it set the mesh. */
  function dressKart(k, mesh) {
    if (!(k.fell && k.respawn > 0)) return false;
    const fall = falling.get(k.pid);
    const age = fall ? clock - fall.at : 9;
    if (!fall || age > .9 || reduce()) { mesh.visible = false; return true; }
    mesh.visible = !k.out;
    mesh.position.set(fall.x, fall.g - .1 - age * age * 2.4, fall.z);
    mesh.rotation.set(0, 0, 0); mesh.rotation.y = fall.angle; mesh.rotateX(age * .9);
    const inner = mesh.userData.kart?.inner; if (inner) inner.position.y = 0;
    mesh.scale.setScalar(1);
    return true;
  }

  function dispose() {
    clear(); root.removeFromParent(); particles.dispose(); trail.dispose();
    for (const g of Object.values(G)) g.dispose();
    for (const m of Object.values(M)) m.dispose();
    for (const m of bodyMats.values()) m.dispose();
    for (const set of [...portalMats.values(), ...fallMats.values()]) for (const m of Object.values(set)) if (m?.isMaterial) m.dispose();
  }
  return { sync, ingest, resetHistory, animate, dressKart, dispose, root, stats: () => ({ cannons: cannons.length, portals: portals.length, falls: falls.length }) };
}

/* 2D fallback: flat symbols for the same features. */
export function drawArenaFeatures2d(ctx, map, px, pz, scale) {
  const f = map?.features; if (!f) return;
  for (const r of f.falls || []) {
    const style = FALL_STYLE[r.kind] || FALL_STYLE.water;
    ctx.fillStyle = '#' + style.surface.toString(16).padStart(6, '0');
    ctx.fillRect(px(r.x - r.hw), pz(r.z - r.hd), r.hw * 2 * scale, r.hd * 2 * scale);
    ctx.strokeStyle = '#' + style.rim.toString(16).padStart(6, '0'); ctx.lineWidth = 2;
    ctx.strokeRect(px(r.x - r.hw), pz(r.z - r.hd), r.hw * 2 * scale, r.hd * 2 * scale);
  }
  (f.portals || []).forEach((pair, i) => pair.forEach((p, side) => {
    ctx.strokeStyle = '#' + PORTAL_COLORS[i % PORTAL_COLORS.length][side].toString(16).padStart(6, '0'); ctx.lineWidth = Math.max(2, .5 * scale);
    const e = portalExit(p), s = Math.sin(p.angle), c = Math.cos(p.angle);
    ctx.beginPath(); ctx.moveTo(px(p.x - c * 2.2), pz(p.z + s * 2.2)); ctx.lineTo(px(p.x + c * 2.2), pz(p.z - s * 2.2)); ctx.stroke();
    ctx.beginPath(); ctx.arc(px(e.x), pz(e.z), Math.max(2, .4 * scale), 0, Math.PI * 2); ctx.stroke();
  }));
  for (const c of f.cannons || []) {
    ctx.fillStyle = '#e2453b'; ctx.beginPath(); ctx.arc(px(c.x), pz(c.z), Math.max(4, 2 * scale), 0, Math.PI * 2); ctx.fill();
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#fff3b0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px(c.x), pz(c.z)); ctx.lineTo(px(c.land.x), pz(c.land.z)); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(px(c.land.x), pz(c.land.z), Math.max(3, 2.3 * scale), 0, Math.PI * 2); ctx.stroke();
  }
}
