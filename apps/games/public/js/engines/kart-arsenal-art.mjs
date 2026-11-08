/* Procedural art for the second eight Pocket Karts weapons: Rail Laser,
 * Thunder Strike, Boomerang, Oil Slick, Frost Bomb, Cluster Bomb, Bounce
 * Ball and Turbo Ram. No GLB is needed: every prop is a handful of merged
 * low-poly primitives in the soft-arcade candy palette, so the factory is
 * also its own failure fallback.
 *
 * kart-combat-art.mjs routes these kinds here and keeps one contract for
 * the whole arsenal (userData.combat: type, kind, inner, seed, spin, plus
 * tipZ/tailZ/tail for shots, mount/muzzle/barrels/trim for rigs and
 * own/armed for traps). Budgets match the kept arsenal: projectile <= 4
 * meshes, weapon <= 6, trap <= 4.
 *
 * Shots keep their art inside the authoritative static sweep radius
 * (laser .12, boomerang .62, bouncer .36), including spin about any axis
 * and the animated tracer scale (<= 1.12 radially). Lobbed bodies
 * (frost, cluster, bomblet) stay inside the 0.45 canister radius.
 */

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

export const ARSENAL_SHOT_KINDS = Object.freeze(['laser', 'boomerang', 'bouncer', 'frost', 'cluster', 'bomblet']);
export const ARSENAL_RIG_KINDS = Object.freeze(['laser', 'thunder', 'boomerang', 'oil', 'frost', 'cluster', 'bouncer', 'ram']);
export const ARSENAL_TRAP_KINDS = Object.freeze(['oil']);

// Camera-facing halo per shot (sprites; never part of hull or contact skin).
export const ARSENAL_SHOT_GLOW = Object.freeze({
  laser: { color: 0x8ff8ff, size: 1.7 }, boomerang: { color: 0xffc04a, size: 2.8, opacity: .35 },
  bouncer: { color: 0xff7ad9, size: 1.5 }, frost: { color: 0xa8f0ff, size: 4 },
  cluster: { color: 0xff8a3c, size: 2.3 }, bomblet: { color: 0xffd34a, size: 1.2 },
});

const C = {
  white: 0xfff6e8, ink: 0x25354b, steel: 0xc3cdd8, cyan: 0x35d5ff, cyanGlow: 0x8ff8ff,
  sun: 0xffcb44, sunGlow: 0xffe680, coral: 0xf2545b, orange: 0xff8a3c, mint: 0x2fe8b0,
  pink: 0xff6ad5, pinkDeep: 0xd9459f, purple: 0x8e6cff, ice: 0xa8ecff, iceDeep: 0x4fb8e8,
  oil: 0x1d1530, sheen: 0x7d6bff, red: 0xe0473f,
};

/* Concatenate transformed primitives into one non-indexed geometry
 * (position/normal/uv). Parts: { g, x, y, z, rx, ry, rz, s }. */
function merge(THREE, parts) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const p = new THREE.Vector3(), s = new THREE.Vector3();
  const flat = [];
  for (const part of parts) {
    e.set(part.rx || 0, part.ry || 0, part.rz || 0); q.setFromEuler(e);
    p.set(part.x || 0, part.y || 0, part.z || 0);
    const k = part.s || 1; if (Array.isArray(k)) s.set(k[0], k[1], k[2]); else s.set(k, k, k);
    m.compose(p, q, s);
    let g = part.g; g.applyMatrix4(m);
    if (g.index) { const ni = g.toNonIndexed(); g.dispose(); g = ni; }
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    flat.push(g);
  }
  let count = 0; for (const g of flat) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  let v = 0;
  for (const g of flat) {
    pos.set(g.attributes.position.array, v * 3); nor.set(g.attributes.normal.array, v * 3); uv.set(g.attributes.uv.array, v * 2);
    v += g.attributes.position.count; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

export function createArsenalArt(THREE) {
  const geos = new Set(), mats = new Set();
  let kit = null, seq = 0;
  const keep = (g, name) => { g.name = name; geos.add(g); return g; };
  const mat = (name, m) => { m.name = name; mats.add(m); return m; };
  const toon = (name, color, extra = {}) => mat(name, new THREE.MeshStandardMaterial({ color, roughness: .55, metalness: 0, flatShading: true, ...extra }));
  const glow = (name, color, opacity = .9) => mat(name, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const lamp = (name, color) => mat(name, new THREE.MeshBasicMaterial({ color, toneMapped: false }));

  function build() {
    if (kit) return kit;
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const cyl = (rt, rb, h, n = 12) => new THREE.CylinderGeometry(rt, rb, h, n);
    const ball = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
    const cone = (r, h, n = 8) => new THREE.ConeGeometry(r, h, n);
    const torus = (r, t, n = 18) => new THREE.TorusGeometry(r, t, 6, n);
    const M = {
      white: toon('ArsenalWhite', C.white), ink: toon('ArsenalInk', C.ink, { roughness: .45 }),
      steel: toon('ArsenalSteel', C.steel, { metalness: .4, roughness: .35 }), cyan: toon('ArsenalCyan', C.cyan),
      sun: toon('ArsenalSun', C.sun), coral: toon('ArsenalCoral', C.coral), orange: toon('ArsenalOrange', C.orange),
      mint: toon('ArsenalMint', C.mint), pink: toon('ArsenalPink', C.pink, { roughness: .4 }),
      purple: toon('ArsenalPurple', C.purple), ice: toon('ArsenalIce', C.ice, { emissive: C.iceDeep, emissiveIntensity: .35, roughness: .2 }),
      oil: toon('ArsenalOil', 0x292347, { roughness: .07, metalness: .45, flatShading: false }), red: toon('ArsenalRed', C.red),
      laserCore: lamp('ArsenalLaserCore', 0xffffff), laserBeam: glow('ArsenalLaserBeam', C.cyanGlow, .55),
      cyanLamp: lamp('ArsenalCyanLamp', C.cyanGlow), sunLamp: lamp('ArsenalSunLamp', C.sunGlow),
      swirl: glow('ArsenalBoomerangSwirl', C.sunGlow, .3), iceGlow: glow('ArsenalIceGlow', C.ice, .7),
      sheen: glow('ArsenalOilSheen', 0xb29bff, .5), exhaust: glow('ArsenalRamExhaust', C.orange, .85),
      bladeEdge: lamp('ArsenalBladeEdge', 0x76ffda),
    };
    const G = {};
    // Rail Laser bolt: white-hot core inside a cyan beam. Nose +Z.
    G.laserCore = keep(merge(THREE, [{ g: cyl(.035, .035, 2.6, 8), z: -.5, rx: HALF_PI }]), 'ArsenalLaserCore');
    G.laserBeam = keep(merge(THREE, [{ g: cyl(.085, .055, 3, 10), z: -.7, rx: HALF_PI }]), 'ArsenalLaserBeam');
    G.laserTip = keep(merge(THREE, [{ g: ball(.09, 1), z: .72 }]), 'ArsenalLaserTip');
    // Boomerang: a flat two-armed blade around its spin axis (Y).
    const blade = (len, wide, tall) => [
      { g: box(len, tall, wide), x: len / 2 },
      { g: box(len, tall, wide), x: Math.cos(2.55) * len / 2, z: -Math.sin(2.55) * len / 2, ry: 2.55 },
      { g: cyl(wide * .62, wide * .62, tall, 10) },
    ];
    G.boomerang = keep(merge(THREE, blade(.59, .14, .07)), 'ArsenalBoomerangBlade');
    G.boomerangEdge = keep(merge(THREE, [
      { g: box(.52, .025, .05), x: .29, y: .045, z: .025 },
      { g: box(.52, .025, .05), x: Math.cos(2.55) * .29, y: .045, z: -Math.sin(2.55) * .29, ry: 2.55 },
    ]), 'ArsenalBoomerangEdge');
    G.boomerangSwirl = keep(new THREE.RingGeometry(.3, .5, 24), 'ArsenalBoomerangSwirl');
    G.boomerangSwirl.rotateX(-HALF_PI);
    // Bounce Ball: a rubber ball with a sunny stripe.
    G.ball = keep(merge(THREE, [{ g: ball(.3, 2) }]), 'ArsenalBouncerBall');
    G.ballStripe = keep(merge(THREE, [{ g: torus(.3, .035, 24), ry: HALF_PI }]), 'ArsenalBouncerStripe');
    // Frost Bomb: an ice ball with crystal spikes.
    G.frost = keep(merge(THREE, [{ g: ball(.33, 1) }]), 'ArsenalFrostBody');
    const spikes = [];
    for (const [rx, rz] of [[0, 0], [Math.PI, 0], [HALF_PI, 0], [-HALF_PI, 0], [0, HALF_PI], [0, -HALF_PI]]) {
      const dir = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(rx, 0, rz));
      spikes.push({ g: cone(.07, .2, 6), x: dir.x * .34, y: dir.y * .34, z: dir.z * .34, rx, rz });
    }
    G.frostSpikes = keep(merge(THREE, spikes), 'ArsenalFrostSpikes');
    // Cluster Bomb: a coral shell studded with its bomblets.
    G.cluster = keep(merge(THREE, [{ g: ball(.34, 1) }]), 'ArsenalClusterBody');
    const knobs = [];
    for (let i = 0; i < 5; i++) { const a = i * TAU / 5; knobs.push({ g: ball(.1, 0), x: Math.cos(a) * .32, y: .1, z: Math.sin(a) * .32 }); }
    G.clusterKnobs = keep(merge(THREE, knobs), 'ArsenalClusterKnobs');
    G.clusterBand = keep(merge(THREE, [{ g: torus(.34, .04, 20), rx: HALF_PI }]), 'ArsenalClusterBand');
    G.bomblet = keep(merge(THREE, [{ g: ball(.17, 1) }]), 'ArsenalBomblet');
    G.bombletCap = keep(merge(THREE, [{ g: cyl(.06, .08, .08, 8), y: .18 }]), 'ArsenalBombletCap');
    // Oil Slick: a glossy wobbly puddle with a purple sheen and bubbles.
    const puddle = (radius, wobble, seed) => {
      const shape = new THREE.Shape();
      for (let i = 0; i <= 24; i++) {
        const a = i / 24 * TAU, r = radius * (1 + wobble * Math.sin(a * 3 + seed) + wobble * .6 * Math.sin(a * 5 + seed * 2));
        if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      const g = new THREE.ShapeGeometry(shape, 2); g.rotateX(-HALF_PI); return g;
    };
    G.oilPuddle = keep(merge(THREE, [{ g: puddle(1.25, .12, .4), y: .03 }]), 'ArsenalOilPuddle');
    G.oilSheen = keep(merge(THREE, [{ g: puddle(.7, .2, 2.1), x: .2, y: .045, z: -.15 }]), 'ArsenalOilSheen');
    G.oilBubbles = keep(merge(THREE, [{ g: ball(.09, 1), x: -.45, y: .06, z: .3, s: [1, .6, 1] }, { g: ball(.06, 1), x: .5, y: .05, z: .45, s: [1, .6, 1] }, { g: ball(.07, 1), x: .1, y: .05, z: -.6, s: [1, .6, 1] }]), 'ArsenalOilBubbles');

    // ---- rigs (origin at mount, barrel +Z) ----
    G.rigLaser = keep(merge(THREE, [
      { g: box(.42, .08, .5), y: .04 }, { g: box(.3, .22, .66), y: .2, z: .02 },
      { g: cyl(.06, .07, .9, 10), y: .26, z: .55, rx: HALF_PI }, { g: box(.08, .16, .2), y: .38, z: -.18 },
    ]), 'ArsenalRigLaser');
    G.rigLaserCoil = keep(merge(THREE, [.4, .6, .8].map(z => ({ g: torus(.1, .028, 14), y: .26, z })), ), 'ArsenalRigLaserCoil');
    G.rigThunder = keep(merge(THREE, [
      { g: cyl(.24, .28, .14, 10), y: .07 }, { g: cyl(.04, .05, .5, 8), y: .4 },
      ...[0, 1, 2].map(i => ({ g: box(.05, .22, .05), x: Math.cos(i * TAU / 3) * .12, y: .72, z: Math.sin(i * TAU / 3) * .12, rz: Math.cos(i * TAU / 3) * .5, rx: -Math.sin(i * TAU / 3) * .5 })),
    ]), 'ArsenalRigThunder');
    G.rigThunderOrb = keep(merge(THREE, [{ g: ball(.15, 1), y: .8 }]), 'ArsenalRigThunderOrb');
    // A chunky zig-zag bolt emblem in front of the rod: reads as "thunder".
    const bolt = new THREE.Shape();
    [[.05, .5], [-.17, .02], [-.01, .02], [-.09, -.42], [.17, .1], [.01, .1], [.11, .5]].forEach(([x, y], i) => (i ? bolt.lineTo(x, y) : bolt.moveTo(x, y)));
    G.rigThunderBolt = keep(merge(THREE, [{ g: new THREE.ExtrudeGeometry(bolt, { depth: .07, bevelEnabled: true, bevelThickness: .02, bevelSize: .02, bevelSegments: 1 }), y: .55, z: .14 }]), 'ArsenalRigThunderBolt');
    G.rigBoomerangBase = keep(merge(THREE, [{ g: box(.36, .12, .36), y: .06 }, { g: cyl(.05, .05, .24, 8), y: .22 }]), 'ArsenalRigBoomerangBase');
    G.rigOilDrum = keep(merge(THREE, [{ g: cyl(.24, .24, .46, 14), y: .27 }, { g: cyl(.06, .07, .3, 8), y: .12, z: -.3, rx: HALF_PI }]), 'ArsenalRigOilDrum');
    G.rigOilBands = keep(merge(THREE, [{ g: torus(.245, .025, 18), y: .14, rx: HALF_PI }, { g: torus(.245, .025, 18), y: .4, rx: HALF_PI }]), 'ArsenalRigOilBands');
    G.rigOilDrip = keep(merge(THREE, [{ g: ball(.06, 1), s: [1, 1.3, 1] }]), 'ArsenalRigOilDrip');
    G.rigFrost = keep(merge(THREE, [{ g: box(.36, .12, .5), y: .06 }, { g: cyl(.14, .16, .8, 12), y: .32, z: .25, rx: HALF_PI }]), 'ArsenalRigFrost');
    G.rigFrostCrystal = keep(merge(THREE, [{ g: new THREE.OctahedronGeometry(.17, 0), s: [1, 1.5, 1] }]), 'ArsenalRigFrostCrystal');
    G.rigCluster = keep(merge(THREE, [{ g: box(.4, .12, .44), y: .06 }, { g: cyl(.17, .2, .6, 12), y: .34, z: .12, rx: HALF_PI - .65 }]), 'ArsenalRigCluster');
    G.rigClusterBall = keep(merge(THREE, [{ g: ball(.13, 1) }]), 'ArsenalRigClusterBall');
    G.rigBouncer = keep(merge(THREE, [{ g: box(.48, .3, .42), y: .17 }, { g: box(.52, .05, .46), y: .34 }]), 'ArsenalRigBouncer');
    G.rigBouncerBall = keep(merge(THREE, [{ g: ball(.14, 1) }]), 'ArsenalRigBouncerBall');
    G.rigRam = keep(merge(THREE, [
      { g: cyl(.2, .16, .7, 12), y: .32, z: 0, rx: HALF_PI }, { g: box(.36, .1, .5), y: .05 },
      { g: box(.04, .22, .26), x: .2, y: .4, z: -.15 }, { g: box(.04, .22, .26), x: -.2, y: .4, z: -.15 },
    ]), 'ArsenalRigRam');
    G.rigRamIntake = keep(merge(THREE, [{ g: torus(.2, .045, 18), y: .32, z: .36 }]), 'ArsenalRigRamIntake');
    G.rigRamExhaust = keep(merge(THREE, [{ g: cone(.15, .4, 10), rx: -HALF_PI }]), 'ArsenalRigRamExhaust');
    kit = { M, G };
    return kit;
  }

  function base(type, kind, name) {
    seq += 1;
    const outer = new THREE.Group(); outer.name = name;
    const inner = new THREE.Group(); inner.name = name + 'Inner'; outer.add(inner);
    outer.userData.combat = { type, kind, inner, seed: ((seq * .61803398875) % 1) * TAU, spin: 0, arsenal: true };
    return { outer, inner, c: outer.userData.combat };
  }
  function solid(g, m, name) { const mesh = new THREE.Mesh(g, m); mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = false; return mesh; }
  function lit(g, m, name) { const mesh = new THREE.Mesh(g, m); mesh.name = name; mesh.castShadow = false; mesh.receiveShadow = false; return mesh; }

  function projectile(kind) {
    const { M, G } = build();
    const names = { laser: 'RailLaserBolt', boomerang: 'BoomerangBlade', bouncer: 'BounceBall', frost: 'FrostBomb', cluster: 'ClusterBomb', bomblet: 'ClusterBomblet' };
    const { outer, inner, c } = base('projectile', kind, names[kind] || 'RailLaserBolt');
    c.tail = null;
    if (kind === 'boomerang') {
      inner.add(lit(G.boomerang, M.sunLamp, 'BoomerangBody'), lit(G.boomerangEdge, M.bladeEdge, 'BoomerangEdge'));
      c.tail = lit(G.boomerangSwirl, M.swirl, 'BoomerangSwirlTracer'); inner.add(c.tail);
      c.tipZ = .5; c.tailZ = -.5;
    } else if (kind === 'bouncer') {
      inner.add(solid(G.ball, M.pink, 'BouncerBody'), solid(G.ballStripe, M.sun, 'BouncerStripe'));
      c.tipZ = .3; c.tailZ = -.3;
    } else if (kind === 'frost') {
      inner.add(solid(G.frost, M.ice, 'FrostBody'), solid(G.frostSpikes, M.white, 'FrostSpikes'));
      c.tipZ = .54; c.tailZ = -.54;
    } else if (kind === 'cluster') {
      inner.add(solid(G.cluster, M.coral, 'ClusterBody'), solid(G.clusterKnobs, M.sun, 'ClusterKnobs'), solid(G.clusterBand, M.ink, 'ClusterBand'));
      c.tipZ = .42; c.tailZ = -.42;
    } else if (kind === 'bomblet') {
      inner.add(solid(G.bomblet, M.red, 'BombletBody'), solid(G.bombletCap, M.sun, 'BombletCap'));
      c.tipZ = .17; c.tailZ = -.17;
    } else {
      inner.add(lit(G.laserCore, M.laserCore, 'LaserCore'), lit(G.laserTip, M.laserCore, 'LaserTipGlow'));
      c.tail = lit(G.laserBeam, M.laserBeam, 'LaserBeamTracer'); inner.add(c.tail);
      c.tipZ = .81; c.tailZ = -2.2;
    }
    return outer;
  }

  function trap(kind, own = true) {
    const { M, G } = build();
    const { outer, inner, c } = base('mine', kind, 'OilSlick');
    const puddle = solid(G.oilPuddle, M.oil, 'OilPuddle'); puddle.castShadow = false; puddle.receiveShadow = true;
    const sheen = lit(G.oilSheen, M.sheen, 'OilSheenGlow');
    inner.add(puddle, sheen, solid(G.oilBubbles, M.oil, 'OilBubbles'));
    c.own = own !== false; c.armed = true; c.cap = null; c.glow = sheen;
    return outer;
  }

  const RIG = {
    laser: { muzzle: [0, .26, 1.0], barrels: 1 }, thunder: { muzzle: [0, .8, 0], barrels: 0 },
    boomerang: { muzzle: [0, .36, .3], barrels: 1 }, oil: { muzzle: [0, .1, -.48], barrels: 0 },
    frost: { muzzle: [0, .32, .65], barrels: 1 }, cluster: { muzzle: [0, .58, .38], barrels: 1 },
    bouncer: { muzzle: [0, .3, .3], barrels: 1 }, ram: { muzzle: [0, .32, .4], barrels: 0 },
  };
  const RIG_NAMES = { laser: 'RailLaserRig', thunder: 'ThunderRod', boomerang: 'BoomerangClamp', oil: 'OilDrum', frost: 'FrostLauncher', cluster: 'ClusterMortar', bouncer: 'BounceHopper', ram: 'TurboRamJet' };
  function weapon(kind) {
    const { M, G } = build();
    const k = RIG[kind] ? kind : 'laser';
    const { outer, inner, c } = base('weapon', k, RIG_NAMES[k]);
    c.mount = [0, 1.35, -1.2]; c.muzzle = RIG[k].muzzle.slice(); c.barrels = RIG[k].barrels; c.recoilParts = [];
    let trim;
    if (k === 'thunder') {
      inner.add(solid(G.rigThunder, M.ink, 'ThunderRodBody'), solid(G.rigThunderBolt, M.sun, 'ThunderBoltEmblem'));
      trim = lit(G.rigThunderOrb, M.sunLamp, 'ThunderOrbGlow');
    } else if (k === 'boomerang') {
      inner.add(solid(G.rigBoomerangBase, M.ink, 'BoomerangClampBody'));
      trim = solid(G.boomerang, M.orange, 'BoomerangRack'); trim.position.y = .36; trim.scale.setScalar(.9);
      const edge = solid(G.boomerangEdge, M.mint, 'BoomerangRackEdge'); trim.add(edge);
    } else if (k === 'oil') {
      inner.add(solid(G.rigOilDrum, M.purple, 'OilDrumBody'), solid(G.rigOilBands, M.sun, 'OilDrumBands'));
      trim = solid(G.rigOilDrip, M.oil, 'OilDrip'); trim.position.set(0, .06, -.48);
    } else if (k === 'frost') {
      inner.add(solid(G.rigFrost, M.white, 'FrostLauncherBody'));
      trim = solid(G.rigFrostCrystal, M.ice, 'FrostCrystal'); trim.position.y = .66;
    } else if (k === 'cluster') {
      inner.add(solid(G.rigCluster, M.coral, 'ClusterMortarBody'));
      trim = solid(G.rigClusterBall, M.sun, 'ClusterMortarShell'); trim.position.set(0, .58, .38);
    } else if (k === 'bouncer') {
      inner.add(solid(G.rigBouncer, M.purple, 'BounceHopperBody'));
      const spare = solid(G.rigBouncerBall, M.pink, 'BounceHopperSpare'); spare.position.set(-.12, .45, -.06);
      inner.add(spare);
      trim = solid(G.rigBouncerBall, M.pink, 'BounceHopperBall'); trim.position.set(.12, .45, .06);
    } else if (k === 'ram') {
      inner.add(solid(G.rigRam, M.steel, 'TurboRamBody'), solid(G.rigRamIntake, M.coral, 'TurboRamIntake'));
      trim = lit(G.rigRamExhaust, M.exhaust, 'TurboRamExhaustGlow'); trim.position.set(0, .32, -.52);
    } else {
      inner.add(solid(G.rigLaser, M.white, 'RailLaserBody'));
      trim = lit(G.rigLaserCoil, M.cyanLamp, 'RailLaserCoilGlow');
    }
    inner.add(trim); c.trim = trim; c.trimBase = { x: trim.position.x, y: trim.position.y, z: trim.position.z };
    return outer;
  }

  /* Cosmetic motion only (inner groups and trims); reducedMotion snaps. */
  function animate(object, dt, time, reducedMotion) {
    const c = object?.userData?.combat;
    if (!c?.arsenal || !c.inner) return;
    const t = Number(time) || 0, step = Math.min(.1, Math.max(0, Number(dt) || 0)), seed = c.seed || 0, inner = c.inner;
    if (c.type === 'weapon') {
      c.recoil = Math.max(0, (c.recoil || 0) - step);
      const trim = c.trim, b = c.trimBase;
      if (!trim) return;
      trim.position.set(b.x, b.y, b.z); trim.rotation.set(0, 0, 0); trim.scale.setScalar(c.kind === 'boomerang' ? .9 : 1);
      if (reducedMotion) return;
      if (c.kind === 'thunder' || c.kind === 'laser') trim.scale.setScalar(1 + .1 * Math.sin(t * 9 + seed));
      else if (c.kind === 'boomerang') trim.rotation.y = Math.sin(t * 2 + seed) * .35;
      else if (c.kind === 'oil') trim.position.y = b.y - ((t * .9 + seed) % 1) * .05;
      else if (c.kind === 'frost') trim.rotation.y = t * 1.4 + seed;
      else if (c.kind === 'bouncer') trim.position.y = b.y + Math.abs(Math.sin(t * 5 + seed)) * .08;
      else if (c.kind === 'ram') trim.scale.set(1, 1, 1 + .25 * Math.sin(t * 24 + seed));
      else if (c.kind === 'cluster') trim.position.z = b.z + Math.sin(t * 3 + seed) * .02;
      return;
    }
    if (c.type === 'mine') {
      if (c.glow) c.glow.visible = c.armed !== false;
      const s = reducedMotion ? 1 : 1 + .05 * Math.sin(t * 2 + seed);
      if (c.glow) c.glow.scale.set(s, 1, s);
      return;
    }
    if (c.type !== 'projectile') return;
    if (reducedMotion) {
      inner.rotation.set(0, 0, 0); if (c.tail) c.tail.scale.set(1, 1, 1);
      if (c.halo) c.halo.scale.setScalar(c.haloSize);
      return;
    }
    c.spin += step * ({ boomerang: 18, bouncer: 11, frost: 2.5, cluster: 3, bomblet: 7, laser: 0 }[c.kind] || 0);
    if (c.kind === 'boomerang') {inner.rotation.x=.35;inner.rotation.y = c.spin;}
    else if (c.kind === 'bouncer') inner.rotation.x = c.spin;
    else if (c.kind === 'frost' || c.kind === 'cluster' || c.kind === 'bomblet') { inner.rotation.x = c.spin; inner.rotation.y = c.spin * .6; }
    if (c.tail) {
      const f = 1 + .1 * Math.sin(t * 34 + seed);
      if (c.kind === 'boomerang') c.tail.scale.set(f, 1, f); else c.tail.scale.set(f, f, 1 + .06 * Math.sin(t * 27 + seed));
    }
    if (c.halo) c.halo.scale.setScalar(c.haloSize * (1 + .14 * Math.sin(t * 22 + seed)));
  }

  function dispose() {
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    geos.clear(); mats.clear(); kit = null;
  }
  return { projectile, trap, weapon, animate, dispose };
}
