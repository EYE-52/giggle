/* Giggle Karts combat prop art: GLB-backed factory + procedural fallback.
 *
 * Primary path: loaded source-asset packs plus Blender-authored combat.glb.
 * The elevated view overlays pulse-mounted, arsenal-mounted and
 * arsenal-secondary; the classic view can continue using combat.glb alone.
 * (scripts/build-kart-combat-assets.py -> public/assets/karts/combat/combat.glb,
 * source assets-source/karts/giggle-combat.blend). Root loads the GLB once
 * into a hidden resource library (mirroring kart-assets.mjs) and hands the
 * models to this factory; every creator then clones Blender-authored meshes,
 * so instances share root-owned GPU resources and removal is a plain
 * scene-remove with no disposal call.
 *
 *   import { createKartCombatArt } from './kart-combat-art.mjs';
 *   import { GLTFLoader } from '../../vendor/three/loaders/GLTFLoader.js';
 *   const gltf = await new GLTFLoader().loadAsync('/assets/karts/combat/combat.glb');
 *   const library = new THREE.Group();
 *   library.name = 'CombatAssetLibrary'; library.visible = false; scene.add(library);
 *   library.add(gltf.scene);
 *   const combat = createKartCombatArt(THREE, { assets: gltf.scene });
 *
 * `assets` accepts three shapes (all documented, all tested):
 *   - a THREE.Object3D library root (gltf.scene or the hidden library
 *     Group): models are found with getObjectByName, like kart-assets.
 *   - a Map of model name -> THREE.Object3D (Map.prototype.get).
 *   - a plain object map of model name -> THREE.Object3D.
 *
 * combat.glb model groups (exact names, see COMBAT_GLB_MODELS):
 *   Pickup, Pulse, Scatter, Mine, Shield, Rocket, Rail,
 *   Bolt, RocketShot, RailShot
 * under a CombatLibrary root. Bolt holds two authored variants, BoltPulse
 * and BoltScatter. Mine holds the prop meshes (MineDisk/MineCap/MineGlow)
 * plus the rig rack (MineRack); mine() and weapon('mine') each clone the
 * subset they need. Every weapon model carries a *MuzzleTip empty
 * (PulseMuzzleTip, ...) whose local position calibrates userData muzzle.
 *
 * Factory mapping (GLB path):
 *   pickup()             <- Pickup (6 meshes, pad = PickupPad)
 *   mine(own)            <- Mine minus MineRack (collar tints own/foe, the
 *                           recessed status lamp is always red; no ground disc)
 *   weapon('pulse')      <- Pulse (black-steel MG + brass PulseAmmo,
 *                           trim = PulseMuzzle)
 *   weapon('scatter')    <- Scatter (brass muzzles + dark ScatterBores,
 *                           trim = ScatterMuzzles)
 *   weapon('mine')       <- Mine minus MineGlow (trim = MineCap, amber)
 *   weapon('shield')     <- Shield (trim = ShieldCore, spins)
 *   weapon('rocket')     <- Rocket (trim = RocketMuzzle)
 *   weapon('rail')       <- Rail (trim = RailMuzzle)
 *   projectile('pulse')   <- Bolt/BoltPulse (steel slug, white tracer)
 *   projectile('scatter') <- Bolt/BoltScatter (steel slug, amber tracer)
 *   projectile('rocket')  <- RocketShot (tail = RocketShotTracer, ember)
 *   projectile('rail')    <- RailShot (tail = RailShotTracer)
 *
 * Slugs keep their authored metallic materials on both paths; tracers, the
 * mine collar tints and the red lamp are the only factory-owned overrides
 * (pooled additive / basic materials shared across instances so the GLB
 * look survives with no per-instance cost). Helper empties (*MuzzleTip)
 * are pruned from clones.
 *
 * Fallback path: when assets are absent (or a single model is missing) the
 * matching creator builds the original procedural low-poly prop instead --
 * same contract, same userData.combat shape, same budgets. The fallback is
 * strictly for failed GLB loads, never the default; root browser QA covers
 * the GLB path.
 *
 * Factory: createKartCombatArt(THREE, opts?) -> art, opts = { assets? }
 *   art.pickup()            Mystery supply crate. Base y=0, fits 2.4.
 *   art.projectile(kind)    'pulse' | 'scatter' | 'rocket' | 'rail'.
 *                           Origin at bolt center, nose +Z: aim with
 *                           group.rotation.y = Math.atan2(vx, vz). Hull
 *                           <= 0.45 lateral. Unknown kinds -> 'pulse'.
 *   art.mine(own)           Toothed disk mine. Base y=0, radius <= 1.
 *                           own tints cap/glow mint, else red.
 *   art.weapon(kind)        'pulse' | 'scatter' | 'mine' | 'shield' |
 *                           'rocket' | 'rail'. Origin at mount, barrel +Z
 *                           (see userData.combat.mount). Unknown -> 'pulse'.
 *   art.animate(obj, dt, time, reducedMotion=false)
 *                           Inner-group cosmetics only (root owns the outer
 *                           transform), no material writes, no allocation.
 *                           reducedMotion snaps to the base pose. No-op on
 *                           foreign objects.
 *   art.dispose()           Disposes factory-owned resources (procedural
 *                           pool + override materials) exactly once;
 *                           idempotent. Root-owned GLB library resources
 *                           are NEVER disposed here: root frees its hidden
 *                           library itself. The factory stays usable.
 *
 * userData.combat on every returned Group:
 *   { type, kind, inner, seed, spin, ... }
 *   - type: 'pickup' | 'projectile' | 'mine' | 'weapon'.
 *   - kind: 'pulse' | 'scatter' | 'mine' | 'shield' | 'rocket' | 'rail'
 *     (pickup kind is null; mine type always has kind 'mine').
 *   - inner: animated child Group; root must NOT touch it.
 *   - seed: deterministic per-instance phase (no Math.random).
 *   - projectile: tipZ/tailZ (nose/tail extent, calibrated from the GLB
 *     branch or the fallback dims), tail (tracer mesh).
 *   - mine: own, armed (root-writable; false shrinks the cap and hides
 *     the glow), cap/glow meshes.
 *   - weapon: mount [x,y,z], muzzle [x,y,z] (calibrated from the GLB
 *     *MuzzleTip or the fallback dims), barrels (3 scatter, 1
 *     pulse/rocket/rail, 0 mine/shield), trim (animated mesh).
 *   - pickup: pad (glow disc mesh).
 *
 * Mesh budgets (each mesh = 1 draw call): pickup <= 8, projectile <= 4,
 * weapon <= 6, mine <= 4 (see COMBAT_ART_BUDGETS). Typical full match
 * (8 rigs + 16 shots + 8 mines + 6 crates) stays under 180 extra calls.
 */

// Calibrate the forward skin against the authority sphere before loading ends.
// Axial roll preserves radial distance. The tracer's full animated scale is
// included; long trailing art can remain behind the sphere without shrinking.
export function projectileContactInset(THREE,object,radius){
  const combat=object.userData.combat,tail=combat.tail,scale=tail?.scale.clone();
  if(tail)tail.scale.set(1.12,1.12,1.08);
  object.updateWorldMatrix(true,true);
  const inverse=new THREE.Matrix4().copy(object.matrixWorld).invert(),point=new THREE.Vector3();
  let inset=0;
  try{object.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const positions=mesh.geometry.attributes.position;
    for(let i=0;i<positions.count;i++){
      point.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
      const radial=point.x*point.x+point.y*point.y;
      if(radial>radius*radius)throw Error('Projectile art exceeds authoritative sweep radius');
      inset=Math.max(inset,point.z+radius-combat.tipZ-Math.sqrt(radius*radius-radial));
    }
  });}finally{if(tail)tail.scale.copy(scale);}
  return inset+.005;
}

export const COMBAT_ART_BUDGETS = { pickup: 8, projectile: 4, weapon: 6, mine: 4 };

// Compact solid bullets keep their short pencil-thin tracers. Only the rail
// stretches into an energy streak. Authored GLB and failure fallback agree.
export const SHOT_PROFILES = {
  pulse: { radius: 1.2, length: 1.15 },
  scatter: { radius: 1, length: 1.15 },
  rocket: { radius: 1.3, length: 1.6 },
  rail: { radius: 0.6, length: 4.0 },
  grenade: { radius: 1, length: 1 },
  seeker: { radius: 1, length: 1 },
  bomb: { radius: 1, length: 1 },
  nuke: { radius: 1.65, length: 1.6 },
  proximity: { radius: 1, length: 1 },
  sentry: { radius: .72, length: .72 },
};

export const COMBAT_GLB_URL = '/assets/karts/combat/combat.glb';

export const COMBAT_GLB_MODELS = ['Pickup', 'Pulse', 'Scatter', 'Mine', 'Shield',
  'Rocket', 'Rail', 'Bolt', 'RocketShot', 'RailShot', 'Grenade', 'EMP', 'GrenadeShot'];

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

const COLORS = {
  amber: 0xffb020,
  coral: 0xf2545b,
  mint: 0x2fe8b0,
  mintGlow: 0x83ffe0,
  mintDeep: 0x0e9b8a,
  cyan: 0x35d5ff,
  cyanDeep: 0x1a9fd4,
  cyanPale: 0x6af0ff,
  iceWhite: 0xd8fbff,
  ember: 0xff8a3c,
  emberDeep: 0xd4541e,
  cream: 0xfff6e8,
  sand: 0xffe3b3,
  pink: 0xff6ad5,
  rose: 0xff7195,
  metal: 0x2e3a4d,
  red: 0xe02020,
  steel: 0xc3cdd8,
  brass: 0xc9a227,
  bore: 0x05070a,
  lampRed: 0xff2a35,
  tracerWhite: 0xffffff,
};

function trackMat(reg, material, name) {
  material.name = name;
  reg.materials.add(material);
  return material;
}

function std(reg, THREE, name, opts) {
  return trackMat(reg, new THREE.MeshStandardMaterial(Object.assign({
    roughness: 0.7, metalness: 0, flatShading: true,
  }, opts)), name);
}

function glow(reg, THREE, name, color, opacity) {
  return trackMat(reg, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }), name);
}

function tracer(reg, THREE, name, color) {
  return trackMat(reg, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: .72, depthWrite: false,
    blending: THREE.NormalBlending, toneMapped: false,
  }), name);
}

function lamp(reg, THREE, name, color) {
  return trackMat(reg, new THREE.MeshBasicMaterial({ color }), name);
}

/* Concatenate transformed primitives into ONE shared BufferGeometry (same
 * position/normal/uv attributes, non-indexed). Parts are fresh throwaway
 * primitives, never rendered, so merging keeps mesh counts low without a
 * BufferGeometryUtils dependency. Each part: { g, x,y,z, rx,ry,rz }. */
function mergeParts(THREE, reg, parts) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  const flat = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    e.set(part.rx || 0, part.ry || 0, part.rz || 0);
    q.setFromEuler(e);
    p.set(part.x || 0, part.y || 0, part.z || 0);
    m.compose(p, q, s);
    const g = part.g;
    g.applyMatrix4(m);
    if (g.index) {
      const ni = g.toNonIndexed();
      g.dispose();
      flat.push(ni);
    } else {
      flat.push(g);
    }
  }
  let count = 0;
  for (let i = 0; i < flat.length; i++) count += flat[i].attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let v = 0;
  for (let i = 0; i < flat.length; i++) {
    const g = flat[i];
    pos.set(g.attributes.position.array, v * 3);
    nor.set(g.attributes.normal.array, v * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, v * 2);
    v += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  reg.geometries.add(out);
  return out;
}

function poolGeo(reg, geo, name) {
  geo.name = name;
  reg.geometries.add(geo);
  return geo;
}

/* ---- procedural fallback pool (failed-GLB-load path only) ---- */
function buildPool(THREE, reg) {
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, seg) => new THREE.CylinderGeometry(rt, rb, h, seg || 12);
  const cone = (r, h, seg) => new THREE.ConeGeometry(r, h, seg || 10);

  const M = {
    crate: std(reg, THREE, 'CombatCrate', { color: COLORS.amber, roughness: 0.65 }),
    lid: std(reg, THREE, 'CombatLid', { color: COLORS.coral, roughness: 0.6 }),
    metal: std(reg, THREE, 'CombatMetal', {
      color: COLORS.metal, metalness: 0.65, roughness: 0.4,
    }),
    ribbon: std(reg, THREE, 'CombatRibbon', {
      color: COLORS.mint, emissive: COLORS.mintDeep, emissiveIntensity: 0.5,
    }),
    glyph: lamp(reg, THREE, 'CombatGlyph', COLORS.cream),
    pad: glow(reg, THREE, 'CombatPad', COLORS.mintGlow, 0.5),
    boltPulse: std(reg, THREE, 'CombatBoltPulse', {
      color: COLORS.steel, metalness: 0.55, roughness: 0.26,
    }),
    tailPulse: tracer(reg, THREE, 'CombatTailPulse', COLORS.tracerWhite),
    boltScatter: std(reg, THREE, 'CombatBoltScatter', {
      color: COLORS.steel, metalness: 0.55, roughness: 0.262,
    }),
    tailScatter: tracer(reg, THREE, 'CombatTailScatter', COLORS.amber),
    boltRocket: std(reg, THREE, 'CombatBoltRocket', {
      color: COLORS.steel, metalness:.55, roughness:.26,
    }),
    tailRocket: glow(reg, THREE, 'CombatTailRocket', COLORS.ember, 0.85),
    boltRail: std(reg, THREE, 'CombatBoltRail', {
      color: COLORS.cyanPale, emissive: COLORS.cyanDeep, emissiveIntensity: 0.9,
    }),
    tailRail: glow(reg, THREE, 'CombatTailRail', COLORS.cyanPale, 0.85),
    muzzlePulse: lamp(reg, THREE, 'CombatMuzzlePulse', COLORS.iceWhite),
    muzzleScatter: lamp(reg, THREE, 'CombatMuzzleScatter', COLORS.sand),
    capOwn: std(reg, THREE, 'CombatCapOwn', {color:COLORS.mintDeep,metalness:.7,roughness:.4}),
    capFoe: std(reg, THREE, 'CombatCapFoe', {color:COLORS.metal,metalness:.7,roughness:.4}),
    lampRed: glow(reg, THREE, 'CombatLampRed', COLORS.lampRed, 0.9),
    brass: std(reg, THREE, 'CombatBrass', {
      color: COLORS.brass, metalness: 0.85, roughness: 0.35,
    }),
    bore: std(reg, THREE, 'CombatBore', { color: COLORS.bore, roughness: 0.95 }),
    shieldCore: lamp(reg, THREE, 'CombatShieldCore', COLORS.cyanPale),
    layerCap: lamp(reg, THREE, 'CombatLayerCap', 0xffc531),
  };

  const G = {};

  G.pickupPad = poolGeo(reg, cyl(1.15, 1.15, 0.06, 24), 'CombatPickupPad');
  G.pickupBody = poolGeo(reg, box(1.5, 1.1, 1.5), 'CombatPickupBody');
  G.pickupLid = poolGeo(reg, box(1.62, 0.22, 1.62), 'CombatPickupLid');
  const corners = [];
  for (const sx of [-1, 1]) {
    for (const sy of [0.18, 1.04]) {
      for (const sz of [-1, 1]) {
        corners.push({ g: box(0.24, 0.24, 0.24), x: 0.68 * sx, y: sy, z: 0.68 * sz });
      }
    }
  }
  G.pickupCorners = mergeParts(THREE, reg, corners);
  G.pickupCorners.name = 'CombatPickupCorners';
  G.pickupRibbons = mergeParts(THREE, reg, [
    { g: box(1.56, 0.14, 1.56), x: 0, y: 0.61, z: 0 },
    { g: box(0.3, 1.16, 1.56), x: 0, y: 0.61, z: 0 },
  ]);
  G.pickupRibbons.name = 'CombatPickupRibbons';
  const glyphParts = [];
  for (const face of [1, -1]) {
    const z = 0.78 * face;
    const spin = face < 0 ? Math.PI : 0;
    glyphParts.push({
      g: new THREE.TorusGeometry(0.26, 0.07, 8, 14, Math.PI * 1.5),
      x: 0, y: 0.8, z, rz: -Math.PI / 4, ry: spin,
    });
    glyphParts.push({ g: box(0.14, 0.24, 0.1), x: 0, y: 0.44, z });
    glyphParts.push({ g: box(0.15, 0.15, 0.1), x: 0, y: 0.22, z });
  }
  G.pickupGlyph = mergeParts(THREE, reg, glyphParts);
  G.pickupGlyph.name = 'CombatPickupGlyph';

  // Pulse slug: solid pointed steel, nose tip z=+0.75, narrow straight
  // white tracer from -0.5 to -1.75 (never a flame cone).
  G.pulseBolt = mergeParts(THREE, reg, [
    { g: cone(0.16, 0.5, 10), x: 0, y: 0, z: 0.5, rx: HALF_PI },
    { g: cyl(0.13, 0.15, 0.75, 10), x: 0, y: 0, z: -0.125, rx: HALF_PI },
  ]);
  G.pulseBolt.name = 'CombatPulseBolt';
  G.pulseFins = mergeParts(THREE, reg, [-.3125,-.425].map(z => ({
    g: cyl(.155,.155,.04,12), z, rx: HALF_PI,
  })));
  G.pulseFins.name = 'CombatPulseBands';
  G.pulseTail = poolGeo(reg, cyl(.025,.025,.65,8), 'CombatPulseTail');
  G.pulseTail.rotateX(-HALF_PI);

  G.scatterBolt = mergeParts(THREE, reg, [
    { g: cone(.22,.45,12), z:.325, rx:HALF_PI },
    { g: cyl(.1892,.2068,.5,12), z:-.15, rx:HALF_PI },
  ]);
  G.scatterBolt.name = 'CombatScatterBolt';
  G.scatterFins = mergeParts(THREE, reg, [-.275,-.35].map(z => ({
    g: cyl(.2134,.2134,.04,12), z, rx:HALF_PI,
  })));
  G.scatterFins.name = 'CombatScatterBands';
  G.scatterTail = poolGeo(reg, cyl(.025,.025,.5,8), 'CombatScatterTail');
  G.scatterTail.rotateX(-HALF_PI);

  // Rocket shot: fat finned rocket, nose tip z=+0.6, tracer tip z=-1.55.
  G.rocketBolt = mergeParts(THREE, reg, [
    { g: cone(0.2, 0.4, 10), x: 0, y: 0, z: 0.4, rx: HALF_PI },
    { g: cyl(0.2, 0.22, 0.6, 10), x: 0, y: 0, z: -0.1, rx: HALF_PI },
    { g: cyl(0.16, 0.12, 0.2, 10), x: 0, y: 0, z: -0.45, rx: HALF_PI },
  ]);
  G.rocketBolt.name = 'CombatRocketBolt';
  G.rocketFins = mergeParts(THREE, reg, [0, HALF_PI, Math.PI, HALF_PI * 3].map((a) => ({
    g: box(0.06, 0.6, 0.4), x: 0, y: 0, z: -0.3, rz: a,
  })));
  G.rocketFins.name = 'CombatRocketFins';
  G.rocketTail = poolGeo(reg, cone(0.18, 1.1, 10), 'CombatRocketTail');
  G.rocketTail.rotateX(-HALF_PI);

  // Rail shot: slim spike, longest tracer. Nose tip z=+0.9, tail z=-2.05.
  G.railBolt = mergeParts(THREE, reg, [
    { g: cone(0.08, 0.9, 8), x: 0, y: 0, z: 0.45, rx: HALF_PI },
    { g: cyl(0.08, 0.1, 0.6, 8), x: 0, y: 0, z: -0.3, rx: HALF_PI },
  ]);
  G.railBolt.name = 'CombatRailBolt';
  G.railFins = mergeParts(THREE, reg, [
    { g: box(0.05, 0.4, 0.3), x: 0, y: 0, z: -0.5 },
    { g: box(0.4, 0.05, 0.3), x: 0, y: 0, z: -0.5 },
  ]);
  G.railFins.name = 'CombatRailFins';
  G.railTail = poolGeo(reg, cone(0.1, 1.5, 8), 'CombatRailTail');
  G.railTail.rotateX(-HALF_PI);

  const teeth = [{ g: cyl(0.8, 0.86, 0.28, 18), x: 0, y: 0.14, z: 0 }];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    teeth.push({
      g: cone(0.09, 0.24, 6),
      x: Math.cos(a) * 0.72, y: 0.42, z: Math.sin(a) * 0.72,
    });
  }
  G.mineDisk = mergeParts(THREE, reg, teeth);
  G.mineDisk.name = 'CombatMineDisk';
  // Low own/foe collar + small recessed red status lamp. No ground disc:
  // the mine carries no radius ring.
  G.mineCap = poolGeo(reg, new THREE.TorusGeometry(.23, .08, 8, 18), 'CombatMineCap');
  G.mineCap.rotateX(HALF_PI);
  G.mineGlow = poolGeo(reg, cyl(0.13, 0.13, 0.08, 12), 'CombatMineGlow');

  // Pulse rig: black-steel machine gun, brass ammo drum + belt, muzzle
  // brake. Muzzle tip z=+1.10.
  G.rigPulseMount = mergeParts(THREE, reg, [
    { g: box(0.34, 0.12, 0.6), x: 0, y: 0.06, z: -0.1 },
    { g: box(0.26, 0.3, 0.5), x: 0, y: 0.3, z: -0.2 },
    { g: cyl(0.085, 0.095, 1.15, 12), x: 0, y: 0.3, z: 0.375, rx: HALF_PI },
    { g: box(0.1, 0.22, 0.16), x: 0, y: 0.16, z: -0.32 },
    { g: box(0.08, 0.06, 0.5), x: 0, y: 0.47, z: -0.15 },
  ]);
  G.rigPulseMount.name = 'CombatRigPulseMount';
  G.rigPulseAmmo = mergeParts(THREE, reg, [
    { g: cyl(0.2, 0.2, 0.14, 14), x: -0.26, y: 0.28, z: -0.25, rz: HALF_PI },
    { g: cyl(0.07, 0.07, 0.17, 10), x: -0.26, y: 0.28, z: -0.25, rz: HALF_PI },
    { g: box(0.1, 0.07, 0.12), x: -0.17, y: 0.36, z: -0.22 },
    { g: box(0.1, 0.07, 0.12), x: -0.1, y: 0.4, z: -0.2 },
    { g: box(0.1, 0.07, 0.12), x: -0.03, y: 0.43, z: -0.18 },
  ]);
  G.rigPulseAmmo.name = 'CombatRigPulseAmmo';
  G.rigPulseMuzzle = mergeParts(THREE, reg, [
    { g: cyl(0.11, 0.11, 0.18, 12), x: 0, y: 0, z: 0, rx: HALF_PI },
    { g: box(0.05, 0.1, 0.06), x: 0, y: 0.14, z: -0.02 },
  ]);
  G.rigPulseMuzzle.name = 'CombatRigPulseMuzzle';

  // Scatter rig: center muzzle tip z=+0.90.
  G.rigScatterBody = mergeParts(THREE, reg, [
    { g: box(0.5, 0.42, 0.42), x: 0, y: 0.24, z: -0.32 },
    { g: cyl(0.09, 0.1, 1.0, 10), x: 0, y: 0.42, z: 0.28, rx: HALF_PI },
    { g: cyl(0.09, 0.1, 1.0, 10), x: -0.17, y: 0.18, z: 0.28, rx: HALF_PI },
    { g: cyl(0.09, 0.1, 1.0, 10), x: 0.17, y: 0.18, z: 0.28, rx: HALF_PI },
    { g: box(0.08, 0.14, 0.2), x: 0, y: 0.52, z: -0.3 },
    { g: box(0.2, 0.12, 0.2), x: 0, y: 0.06, z: -0.32 },
  ]);
  G.rigScatterBody.name = 'CombatRigScatterBody';
  G.rigScatterMuzzles = mergeParts(THREE, reg, [
    { g: new THREE.CylinderGeometry(.12,.12,.16,12,1,true), x: 0, y: 0.12, z: 0, rx: HALF_PI },
    { g: new THREE.CylinderGeometry(.12,.12,.16,12,1,true), x: -0.17, y: -0.12, z: 0, rx: HALF_PI },
    { g: new THREE.CylinderGeometry(.12,.12,.16,12,1,true), x: 0.17, y: -0.12, z: 0, rx: HALF_PI },
  ]);
  G.rigScatterMuzzles.name = 'CombatRigScatterMuzzles';
  // Three actual bores: dark recessed discs just behind the muzzle faces.
  G.rigScatterBores = mergeParts(THREE, reg, [
    { g: cyl(0.055, 0.055, 0.06, 10), x: 0, y: 0.12, z: 0.045, rx: HALF_PI },
    { g: cyl(0.055, 0.055, 0.06, 10), x: -0.17, y: -0.12, z: 0.045, rx: HALF_PI },
    { g: cyl(0.055, 0.055, 0.06, 10), x: 0.17, y: -0.12, z: 0.045, rx: HALF_PI },
  ]);
  G.rigScatterBores.name = 'CombatRigScatterBores';

  // Mine rig: rear layer rack + capped mini disk.
  const rackTeeth = [
    { g: box(0.7, 0.22, 0.7), x: 0, y: 0.11, z: 0 },
    { g: cyl(0.4, 0.44, 0.18, 14), x: 0, y: 0.31, z: 0 },
    { g: box(0.08, 0.3, 0.7), x: -0.36, y: 0.2, z: 0 },
    { g: box(0.08, 0.3, 0.7), x: 0.36, y: 0.2, z: 0 },
  ];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    rackTeeth.push({
      g: cone(0.06, 0.14, 5),
      x: Math.cos(a) * 0.36, y: 0.45, z: Math.sin(a) * 0.36,
    });
  }
  G.rigMineRack = mergeParts(THREE, reg, rackTeeth);
  G.rigMineRack.name = 'CombatRigMineRack';
  G.rigMineCap = poolGeo(reg, cyl(0.12, 0.14, 0.12, 10), 'CombatRigMineCap');

  // Shield rig: hex emitter + crystal core.
  const prongs = [{ g: cyl(0.35, 0.42, 0.18, 6), x: 0, y: 0.09, z: 0 }];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    prongs.push({
      g: box(0.1, 0.4, 0.12),
      x: Math.cos(a) * 0.22, y: 0.35, z: Math.sin(a) * 0.22,
      ry: -a, rx: 0.35,
    });
  }
  G.rigShieldBase = mergeParts(THREE, reg, prongs);
  G.rigShieldBase.name = 'CombatRigShieldBase';
  G.rigShieldCore = poolGeo(reg, new THREE.OctahedronGeometry(0.2, 0), 'CombatRigShieldCore');

  // Rocket rig: shoulder launcher. Muzzle tip z=+0.98.
  G.rigRocketBody = mergeParts(THREE, reg, [
    { g: box(0.24, 0.5, 0.24), x: 0, y: 0.25, z: 0 },
    { g: cyl(0.16, 0.18, 1.4, 12), x: 0, y: 0.65, z: 0.2, rx: HALF_PI },
    { g: box(0.12, 0.4, 0.3), x: 0, y: 0.35, z: -0.5 },
    { g: box(0.4, 0.12, 0.5), x: 0, y: 0.15, z: -0.3 },
  ]);
  G.rigRocketBody.name = 'CombatRigRocketBody';
  G.rigRocketTrim = mergeParts(THREE, reg, [
    { g: cyl(0.19, 0.19, 0.1, 12), x: 0, y: 0.65, z: 0.5, rx: HALF_PI },
    { g: cyl(0.19, 0.19, 0.1, 12), x: 0, y: 0.65, z: -0.1, rx: HALF_PI },
    { g: box(0.08, 0.16, 0.2), x: 0, y: 0.9, z: 0.1 },
  ]);
  G.rigRocketTrim.name = 'CombatRigRocketTrim';
  G.rigRocketMuzzle = mergeParts(THREE, reg, [
    { g: cyl(0.19, 0.19, 0.12, 12), x: 0, y: 0, z: 0, rx: HALF_PI },
  ]);
  G.rigRocketMuzzle.name = 'CombatRigRocketMuzzle';

  // Rail rig: long angular cannon. Muzzle tip z=+1.20.
  G.rigRailBody = mergeParts(THREE, reg, [
    { g: box(0.22, 0.3, 1.6), x: 0, y: 0.35, z: 0.2 },
    { g: box(0.1, 0.4, 0.8), x: -0.16, y: 0.35, z: 0.4 },
    { g: box(0.1, 0.4, 0.8), x: 0.16, y: 0.35, z: 0.4 },
    { g: box(0.3, 0.4, 0.4), x: 0, y: 0.35, z: -0.6 },
    { g: box(0.2, 0.35, 0.2), x: 0, y: 0.175, z: 0 },
  ]);
  G.rigRailBody.name = 'CombatRigRailBody';
  G.rigRailCoil = mergeParts(THREE, reg, [0, 0.4, 0.8].map((dz) => ({
    g: box(0.3, 0.38, 0.08), x: 0, y: 0.35, z: dz,
  })));
  G.rigRailCoil.name = 'CombatRigRailCoil';
  G.rigRailMuzzle = mergeParts(THREE, reg, [
    { g: cyl(0.05, 0.12, 0.3, 10), x: 0, y: 0, z: 0, rx: HALF_PI },
  ]);
  G.rigRailMuzzle.name = 'CombatRigRailMuzzle';

  G.grenadeBody = poolGeo(reg,cyl(.38,.38,.76,12),'CombatGrenadeCanister');
  G.grenadeBands = mergeParts(THREE,reg,[
    {g:cyl(.4,.4,.12,12),y:-.3},{g:cyl(.4,.4,.12,12),y:.3},
    {g:box(.15,.18,.26),y:.46},
    {g:box(.12,.08,.5),y:.57,z:.15},{g:box(.12,.34,.08),y:.4,z:.35},
    ...[[-.34,0],[.34,0],[0,-.34],[0,.34]].map(([x,z])=>({g:box(.1,.45,.1),x,z})),
    // Throwing handle + pivot pin along one flank (fragmentation lever).
    {g:box(.08,.5,.12),x:.4,y:.05},
    {g:cyl(.03,.03,.18,8),x:.4,y:.42,rz:HALF_PI},
  ]);
  G.grenadeFuse = poolGeo(reg,box(.12,.09,.1),'CombatGrenadeFuse');
  G.rigGrenadeBody = mergeParts(THREE,reg,[
    {g:box(.56,.28,.65),y:.14,z:-.15},{g:cyl(.25,.28,1.05,12),y:.5,z:.3,rx:HALF_PI},
  ]);
  G.rigGrenadeMuzzle = mergeParts(THREE,reg,[{g:cyl(.31,.31,.17,12),y:.5,z:.85,rx:HALF_PI}]);
  G.rigGrenadeLatch = mergeParts(THREE,reg,[{g:box(.38,.13,.18),y:.56,z:-.25}]);
  G.rigEMPBody = mergeParts(THREE,reg,[{g:box(.72,.48,.55),y:.24,z:-.08},
    ...[-.43,.43].map(x=>({g:box(.15,.17,1.15),x,y:.4,z:.3})),
  ]);
  G.rigEMPCore = mergeParts(THREE,reg,[...[-.43,.43].map(x=>({g:cyl(.13,.13,.1,10),x,y:.4,z:.9,rx:HALF_PI})),
    {g:box(.48,.12,.1),y:.52,z:.13},
  ]);
  return { M, G };
}

/* Mesh-name suffixes that read as light, not hull: no shadow casting. */
const LIT_SUFFIXES = ['Tracer', 'Glow', 'Core', 'Muzzle', 'Muzzles',
  'Badge', 'Glyph', 'Pad', 'Cap', 'Fuse'];

function isLitName(name) {
  for (let i = 0; i < LIT_SUFFIXES.length; i++) {
    if (name.endsWith(LIT_SUFFIXES[i])) return true;
  }
  return false;
}

export function createKartCombatArt(THREE, opts) {
  if (!THREE || !THREE.Group) {
    throw new Error('createKartCombatArt: a THREE namespace is required');
  }
  const assets = opts && opts.assets ? opts.assets : null;
  // The arena's authored supply crate is borrowed from its asset library.
  // Weapons continue to use their independent combat model library.
  const pickupAsset = opts?.pickupAsset?.isObject3D ? opts.pickupAsset : null;

  /* Normalize the three documented assets shapes to one lookup. */
  let libGet = null;
  if (assets) {
    if (assets.isObject3D && typeof assets.getObjectByName === 'function') {
      libGet = (name) => assets.getObjectByName(name) || null;
    } else if (typeof assets.get === 'function') {
      libGet = (name) => assets.get(name) || null;
    } else if (typeof assets === 'object') {
      libGet = (name) => assets[name] || null;
    }
  }

  const reg = { geometries: new Set(), materials: new Set() };
  let pool = null;
  let ovr = null;
  let cal = null;
  let grenadeCalibration = null;
  let seq = 0;
  let readableHousing = new WeakMap();

  function ensurePool() {
    if (!pool) pool = buildPool(THREE, reg);
    return pool;
  }

  /* Factory-owned material overrides for GLB clones: pooled tracers and
   * mine tints. Shared across every instance; disposed with the factory. */
  function ensureOverrides() {
    if (ovr) return ovr;
    ovr = {
      tailPulse: tracer(reg, THREE, 'CombatTailPulse', COLORS.tracerWhite),
      tailScatter: tracer(reg, THREE, 'CombatTailScatter', COLORS.amber),
      tailRocket: glow(reg, THREE, 'CombatTailRocket', COLORS.ember, 0.85),
      tailRail: glow(reg, THREE, 'CombatTailRail', COLORS.cyanPale, 0.85),
      capOwn: std(reg, THREE, 'CombatCapOwn', {color:COLORS.mintDeep,metalness:.7,roughness:.4}),
      capFoe: std(reg, THREE, 'CombatCapFoe', {color:COLORS.metal,metalness:.7,roughness:.4}),
      lampRed: glow(reg, THREE, 'CombatLampRed', COLORS.lampRed, 0.9),
      layerCap: lamp(reg, THREE, 'CombatLayerCap', 0xffc531),
    };
    return ovr;
  }

  function libBranch(model, sub) {
    if (!libGet) return null;
    const root = libGet(model);
    if (!root) return null;
    if (!sub) return root;
    if (typeof root.getObjectByName !== 'function') return null;
    return root.getObjectByName(sub) || null;
  }

  /* One-time calibration of GLB branches: shot nose/tail extents from
   * bounding boxes, weapon muzzles from *MuzzleTip nodes. Runs lazily on
   * the first GLB creator call; creators only read cached numbers. */
  function ensureCal() {
    if (cal || !libGet) return cal;
    cal = {};
    const box = new THREE.Box3();
    const tipPos = new THREE.Vector3();
    const shots = [
      ['pulse', 'Bolt', 'BoltPulse'],
      ['scatter', 'Bolt', 'BoltScatter'],
      ['rocket', 'RocketShot', null],
      ['seeker', 'SeekerShot', null],
      ['bomb', 'BombShot', null],
      ['proximity', 'BombShot', null],
      ['rail', 'RailShot', null],
      ['grenade', 'GrenadeShot', null],
    ];
    for (let i = 0; i < shots.length; i++) {
      const branch = libBranch(shots[i][1], shots[i][2]);
      if (!branch) continue;
      box.setFromObject(branch);
      if (box.isEmpty()) continue;
      cal[shots[i][0]] = { tipZ: box.max.z, tailZ: box.min.z };
    }
    const rigs = ['Pulse', 'Scatter', 'Mine', 'Shield', 'Rocket', 'Rail', 'Grenade', 'EMP', 'Seeker', 'Bomb'];
    for (let i = 0; i < rigs.length; i++) {
      const root = libBranch(rigs[i], null);
      if (!root || typeof root.getObjectByName !== 'function') continue;
      const tip = root.getObjectByName(`${rigs[i]}MuzzleTip`);
      if (!tip) continue;
      root.updateWorldMatrix(true, false);
      tipPos.setFromMatrixPosition(tip.matrixWorld);
      root.worldToLocal(tipPos);
      cal[`muzzle:${rigs[i].toLowerCase()}`] = [tipPos.x, tipPos.y, tipPos.z];
    }
    return cal;
  }

  function solid(geo, material, name) {
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    return mesh;
  }

  function lit(geo, material, name) {
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  function base(type, kind, name) {
    seq += 1;
    const outer = new THREE.Group();
    outer.name = name;
    const inner = new THREE.Group();
    inner.name = `${name}Inner`;
    outer.add(inner);
    outer.userData.combat = {
      type, kind, inner,
      seed: ((seq * 0.61803398875) % 1) * TAU,
      spin: 0,
    };
    return { outer, inner, c: outer.userData.combat };
  }

  /* Clone a GLB branch (shares root-owned geometries/materials), prune
   * helper empties and unneeded variant meshes, classify shadows. */
  function cloneLib(branch, prune) {
    const clone = branch.clone(true);
    const drop = [];
    clone.traverse((o) => {
      if (o.name.endsWith('MuzzleTip')) drop.push(o);
      else if (prune && o.name === prune) drop.push(o);
    });
    for (let i = 0; i < drop.length; i++) {
      if (drop[i].parent) drop[i].parent.remove(drop[i]);
    }
    clone.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = !isLitName(o.name);
      o.receiveShadow = false;
    });
    return clone;
  }

  function overrideOf(clone, meshName, material) {
    const mesh = clone.getObjectByName(meshName);
    if (mesh && mesh.isMesh) mesh.material = material;
    return mesh;
  }

  function normShot(kind) {
    return kind === 'scatter' || kind === 'rocket' || kind === 'rail' || kind === 'grenade' || kind === 'seeker' || kind === 'bomb' || kind==='nuke' || kind==='proximity' || kind==='sentry' ? kind : 'pulse';
  }

  function normRig(kind) {
    return kind === 'scatter' || kind === 'mine' || kind === 'shield' ||
      kind === 'rocket' || kind === 'rail' || kind === 'grenade' || kind === 'emp' || kind === 'seeker' || kind === 'bomb' ? kind : 'pulse';
  }

  /* ---------------- pickup ---------------- */
  function pickupFromLib(branch) {
    const { outer, inner, c } = base('pickup', null, 'CombatPickup');
    const clone = cloneLib(branch, null);
    inner.add(clone);
    c.pad = clone.getObjectByName('PickupPad') || null;
    return outer;
  }

  function pickupFallback() {
    const { outer, inner, c } = base('pickup', null, 'CombatPickup');
    const { M, G } = ensurePool();
    const pad = lit(G.pickupPad, M.pad, 'PickupPad');
    pad.position.y = 0.03;
    const body = solid(G.pickupBody, M.crate, 'PickupBody');
    body.position.y = 0.61;
    const lid = solid(G.pickupLid, M.lid, 'PickupLid');
    lid.position.y = 1.27;
    const corners = solid(G.pickupCorners, M.metal, 'PickupCorners');
    const ribbons = solid(G.pickupRibbons, M.ribbon, 'PickupRibbons');
    const glyph = lit(G.pickupGlyph, M.glyph, 'PickupGlyph');
    inner.add(pad, body, lid, corners, ribbons, glyph);
    c.pad = pad;
    return outer;
  }

  function pickup() {
    const branch = pickupAsset || libBranch('Pickup', null);
    if (branch) return pickupFromLib(branch);
    return pickupFallback();
  }

  /* ---------------- projectiles ---------------- */
  const SHOT_BRANCH = {
    pulse: ['Bolt', 'BoltPulse', 'BoltPulseTracer'],
    scatter: ['Bolt', 'BoltScatter', 'BoltScatterTracer'],
    rocket: ['RocketShot', null, 'RocketShotTracer'],
    rail: ['RailShot', null, 'RailShotTracer'],
    grenade: ['GrenadeShot', null, 'GrenadeFuse'],
    seeker: ['SeekerShot', null, 'SeekerShotTracer'],
    bomb: ['BombShot', null, 'BombShotLamp'],
    nuke: ['RocketShot',null,'RocketShotTracer'],
    proximity: ['BombShot',null,'BombShotLamp'],
    sentry: ['Bolt','BoltPulse','BoltPulseTracer'],
  };
  const SHOT_TIP_FALLBACK = {
    pulse: [0.75, -1.15], scatter: [0.55, -.9],
    rocket: [0.6, -1.55], rail: [0.9, -2.05], grenade: [.4,-.4], seeker: [.6,-.6], bomb: [.32,-.32], nuke:[.6,-1.55], proximity:[.4,-.4], sentry:[.75,-1.15],
  };

  function projectileFromLib(kind, branch, tracerName) {
    ensureCal();
    const names = { pulse: 'PulseBolt', scatter: 'ScatterBolt', rocket: 'RocketBolt', rail: 'RailBolt', grenade: 'GrenadeCanister', seeker: 'SeekerMissile', bomb: 'HeavyBomb', nuke:'NuclearWarhead',proximity:'ProximityCharge',sentry:'SentryBullet' };
    const { outer, inner, c } = base('projectile', kind, names[kind]);
    const clone = cloneLib(branch, null);
    const o = ensureOverrides();
    const tails = { pulse: o.tailPulse, scatter: o.tailScatter, rocket: o.tailRocket, rail: o.tailRail, seeker:o.tailRocket,nuke:o.tailRocket,sentry:o.tailPulse,proximity:o.lampRed };
    const tail = kind === 'grenade' || kind === 'bomb' || kind==='proximity' ? clone.getObjectByName(tracerName) : overrideOf(clone, tracerName, tails[kind]);
    inner.add(clone);
    const tip = (cal && cal[kind]) || null;
    const fb = SHOT_TIP_FALLBACK[kind];
    c.tipZ = tip ? tip.tipZ : fb[0];
    c.tailZ = tip ? tip.tailZ : fb[1];
    c.tail = tail || null;
    if(kind==='proximity'||kind==='bomb'){c.armed=false;c.landed=false;}
    return outer;
  }

  function projectileFallback(kind) {
    const names = { pulse: 'PulseBolt', scatter: 'ScatterBolt', rocket: 'RocketBolt', rail: 'RailBolt', grenade: 'GrenadeCanister', seeker: 'SeekerMissile', bomb: 'HeavyBomb', nuke:'NuclearWarhead',proximity:'ProximityCharge',sentry:'SentryBullet' };
    const { outer, inner, c } = base('projectile', kind, names[kind]);
    const { M, G } = ensurePool();
    let tail;
    if(kind==='proximity') {
      inner.add(solid(G.mineDisk,M.metal,'ProximityBody'));
      tail=lit(G.mineCap,M.lampRed,'ProximityLamp');tail.position.y=.3;
    } else if (kind === 'grenade' || kind === 'bomb') {
      inner.add(solid(G.grenadeBody,M.crate,'GrenadeCanister'));
      inner.add(solid(G.grenadeBands,M.metal,'GrenadeBands'));
      tail=lit(G.grenadeFuse,M.capFoe,'GrenadeFuse');tail.position.set(0,.48,.14);
    } else if (kind === 'scatter') {
      inner.add(solid(G.scatterBolt, M.boltScatter, 'ScatterBody'));
      inner.add(solid(G.scatterFins, M.brass, 'ScatterFins'));
      tail = lit(G.scatterTail, M.tailScatter, 'ScatterTracer');
      tail.position.z = -.65;
    } else if (kind === 'rocket' || kind === 'seeker' || kind==='nuke') {
      inner.add(solid(G.rocketBolt, M.boltRocket, 'RocketBody'));
      inner.add(solid(G.rocketFins, M.metal, 'RocketFins'));
      tail = lit(G.rocketTail, M.tailRocket, 'RocketTracer');
      tail.position.z = -1.0;
    } else if (kind === 'rail') {
      inner.add(solid(G.railBolt, M.boltRail, 'RailBody'));
      inner.add(solid(G.railFins, M.metal, 'RailFins'));
      tail = lit(G.railTail, M.tailRail, 'RailTracer');
      tail.position.z = -1.3;
    } else {
      inner.add(solid(G.pulseBolt, M.boltPulse, 'PulseBody'));
      inner.add(solid(G.pulseFins, M.brass, 'PulseFins'));
      tail = lit(G.pulseTail, M.tailPulse, 'PulseTracer');
      tail.position.z = -.825;
    }
    inner.add(tail);
    const fb = SHOT_TIP_FALLBACK[kind];
    c.tipZ = fb[0];
    c.tailZ = fb[1];
    c.tail = tail;
    if(kind==='proximity'||kind==='bomb'){c.armed=false;c.landed=false;}
    return outer;
  }

  function projectile(kind) {
    const k = normShot(kind);
    const spec = SHOT_BRANCH[k];
    const branch = libBranch(spec[0], spec[1]);
    // Slugs keep their authored metallic materials on both paths; only the
    // narrow tracer behind is a factory-owned override (white/amber/ember).
    const shot = branch ? projectileFromLib(k, branch, spec[2]) : projectileFallback(k);
    const c = shot.userData.combat, profile = SHOT_PROFILES[k];
    c.inner.scale.set(profile.radius, profile.radius, profile.length);
    c.tipZ *= profile.length;
    c.tailZ *= profile.length;
    if(k==='grenade') {
      // Classic packets carry the sphere bottom; the view adds its .45m
      // radius. Keep the upright canister's visual bottom at that same
      // support, including the smaller shipped secondary GLB and fallback.
      if(!grenadeCalibration) {
        const box=new THREE.Box3().setFromObject(shot);
        grenadeCalibration={scale:.9/(box.max.y-box.min.y),centerY:(box.min.y+box.max.y)/2};
      }
      const {scale,centerY}=grenadeCalibration;
      c.inner.scale.multiplyScalar(scale);c.inner.position.y=-centerY*scale;
      c.tipZ*=scale;c.tailZ*=scale;
    }
    return shot;
  }

  /* ---------------- mines ---------------- */
  function mineFromLib(isOwn, branch) {
    const { outer, inner, c } = base('mine', 'mine', 'CombatMine');
    const groundTrap=branch.name==='MineTrap';
    const clone = cloneLib(branch, 'MineRack');
    // MineTrap is authored with its base at y=0, like the legacy Mine.
    const o = ensureOverrides();
    const cap = groundTrap?null:overrideOf(clone, 'MineCap', isOwn ? o.capOwn : o.capFoe);
    const glowDisc = overrideOf(clone, groundTrap?'MineTrapLamp':'MineGlow', o.lampRed);
    inner.add(clone);
    c.own = isOwn;
    c.armed = true;
    c.cap = cap || null;
    c.glow = glowDisc || null;
    return outer;
  }

  function mineFallback(isOwn) {
    const { outer, inner, c } = base('mine', 'mine', 'CombatMine');
    const { M, G } = ensurePool();
    const disk = solid(G.mineDisk, M.metal, 'MineDisk');
    const cap = lit(G.mineCap, isOwn ? M.capOwn : M.capFoe, 'MineCap');
    cap.position.y = 0.36;
    const glowDisc = lit(G.mineGlow, M.lampRed, 'MineGlow');
    glowDisc.position.y = 0.355;
    inner.add(glowDisc, disk, cap);
    c.own = isOwn;
    c.armed = true;
    c.cap = cap;
    c.glow = glowDisc;
    return outer;
  }

  function mine(own) {
    const isOwn = own !== false;
    const branch = libBranch('MineTrap', null)||libBranch('Mine', null);
    if (branch) return mineFromLib(isOwn, branch);
    return mineFallback(isOwn);
  }

  /* ---------------- weapons ---------------- */
  const RIG_MODEL = {
    pulse: 'Pulse', scatter: 'Scatter', mine: 'Mine',
    shield: 'Shield', rocket: 'Rocket', rail: 'Rail', grenade: 'Grenade', emp: 'EMP', seeker:'Seeker', bomb:'Bomb',
  };
  const RIG_TRIM = {
    pulse: 'PulseMuzzle', scatter: 'ScatterMuzzles', mine: 'MineCap',
    shield: 'ShieldCore', rocket: 'RocketMuzzle', rail: 'RailMuzzle', grenade:'GrenadeMuzzle',emp:'EMPCore',seeker:'SeekerMuzzle',bomb:'BombMuzzle',
  };
  const RIG_BARRELS = { pulse: 1, scatter: 3, mine: 0, shield: 0, rocket: 1, rail: 1, grenade:1, emp:2, seeker:1, bomb:1 };
  const RIG_MUZZLE_FALLBACK = {
    pulse: [0, 0.3, 1.1], scatter: [0, 0.42, 0.9], mine: [0, 0.4, 0],
    shield: [0, 0.48, 0], rocket: [0, 0.65, 0.98], rail: [0, 0.35, 1.2],grenade:[0,.5,.95],emp:[0,.4,.96],seeker:[0,.5,1.1],bomb:[0,.5,1.1],
  };

  function weaponFromLib(kind, branch) {
    ensureCal();
    const { outer, inner, c } = base('weapon', kind, 'CombatRig');
    const mount = branch.userData?.mount;
    c.mount = Array.isArray(mount) && mount.length === 3 && mount.every(Number.isFinite)
      ? mount.slice() : [0, 1.35, -1.2];
    const prune = kind === 'mine' ? 'MineGlow' : null;
    const clone = cloneLib(branch, prune);
    let trim = null;
    if (kind === 'mine') {
      const o = ensureOverrides();
      trim = overrideOf(clone, 'MineCap', o.layerCap);
    } else {
      trim = clone.getObjectByName(RIG_TRIM[kind]) || null;
    }
    // Only the licensed upper housing widens. Saddles and authored muzzle
    // helpers retain their exact mounting contract; instances share one
    // factory-owned widened geometry rather than allocating during firing.
    c.recoilParts=[];
    clone.traverse(node => {
      if (!node.isMesh || !node.name.endsWith('Housing')) return;
      c.recoilParts.push({node,z:node.position.z});
      const original = node.geometry;
      let geometry = readableHousing.get(original);
      if (!geometry) {
        geometry = original.clone();
        geometry.scale(1.4, 1, 1);
        readableHousing.set(original, geometry);
        reg.geometries.add(geometry);
      }
      node.geometry = geometry;
    });
    inner.add(clone);
    const mz = (cal && cal[`muzzle:${kind}`]) || RIG_MUZZLE_FALLBACK[kind];
    c.muzzle = [mz[0], mz[1], mz[2]];
    c.barrels = RIG_BARRELS[kind];
    c.trim = trim;
    return outer;
  }

  function weaponFallback(kind) {
    const { outer, inner, c } = base('weapon', kind, 'CombatRig');
    const { M, G } = ensurePool();
    c.mount = [0, 1.35, -1.2];
    if (kind === 'grenade' || kind === 'bomb') {
      inner.add(solid(G.rigGrenadeBody,M.metal,'GrenadeBody'));
      c.trim=solid(G.rigGrenadeMuzzle,M.crate,'GrenadeMuzzle');inner.add(c.trim,solid(G.rigGrenadeLatch,M.lid,'GrenadeLatch'));
    } else if (kind === 'emp') {
      inner.add(solid(G.rigEMPBody,M.metal,'EMPBody'));
      c.trim=lit(G.rigEMPCore,M.shieldCore,'EMPCore');inner.add(c.trim);
    } else if (kind === 'scatter') {
      inner.add(solid(G.rigScatterBody, M.metal, 'ScatterCannon'));
      const muzzles = solid(G.rigScatterMuzzles, M.brass, 'ScatterMuzzles');
      muzzles.position.set(0, 0.3, 0.82);
      const bores = solid(G.rigScatterBores, M.bore, 'ScatterBores');
      bores.position.set(0, 0.3, 0.82);
      inner.add(muzzles, bores);
      c.trim = muzzles;
    } else if (kind === 'mine') {
      inner.add(solid(G.rigMineRack, M.metal, 'MineLayer'));
      const cap = lit(G.rigMineCap, M.layerCap, 'MineLayerCap');
      cap.position.y = 0.45;
      inner.add(cap);
      c.trim = cap;
    } else if (kind === 'shield') {
      inner.add(solid(G.rigShieldBase, M.metal, 'ShieldEmitter'));
      const core = lit(G.rigShieldCore, M.shieldCore, 'ShieldCore');
      core.position.y = 0.48;
      inner.add(core);
      c.trim = core;
    } else if (kind === 'rocket' || kind === 'seeker') {
      inner.add(solid(G.rigRocketBody, M.metal, 'RocketLauncher'));
      inner.add(solid(G.rigRocketTrim, M.lid, 'RocketTrim'));
      const muzzle = lit(G.rigRocketMuzzle, M.muzzleScatter, 'RocketMuzzle');
      muzzle.position.set(0, 0.65, 0.92);
      inner.add(muzzle);
      c.trim = muzzle;
    } else if (kind === 'rail') {
      inner.add(solid(G.rigRailBody, M.metal, 'RailCannon'));
      inner.add(solid(G.rigRailCoil, M.boltPulse, 'RailCoil'));
      const muzzle = lit(G.rigRailMuzzle, M.muzzlePulse, 'RailMuzzle');
      muzzle.position.set(0, 0.35, 1.05);
      inner.add(muzzle);
      c.trim = muzzle;
    } else {
      inner.add(solid(G.rigPulseMount, M.metal, 'PulseBlaster'));
      inner.add(solid(G.rigPulseAmmo, M.brass, 'PulseAmmo'));
      const muzzle = solid(G.rigPulseMuzzle, M.metal, 'PulseMuzzle');
      muzzle.position.set(0, 0.3, 1.0);
      inner.add(muzzle);
      c.trim = muzzle;
    }
    c.muzzle = RIG_MUZZLE_FALLBACK[kind].slice();
    c.barrels = RIG_BARRELS[kind];
    return outer;
  }

  // Deployed hardware uses the same loaded gun assets and shared pooled
  // geometry as mounted props. Three solid outriggers make the turret read
  // as planted equipment rather than a floating weapon.
  function sentry() {
    const {outer,inner,c}=base('sentry','sentry','CombatSentry');
    const {G,M}=ensurePool();
    if(!G.sentryLegs) G.sentryLegs=mergeParts(THREE,reg,[0,1,2].map(i=>({g:new THREE.BoxGeometry(.16,.65,1.05),y:.15,ry:i*TAU/3,rx:.45})));
    inner.add(solid(G.sentryLegs,M.metal,'SentryTripod'));
    const turret=new THREE.Group();turret.name='SentryTurret';turret.position.y=.65;inner.add(turret);
    const gun=weapon('pulse'),muzzle=gun.userData.combat.muzzle;gun.position.set(0,-muzzle[1]*.65,.6-muzzle[2]*.65);gun.scale.setScalar(.65);turret.add(gun);c.gun=gun;c.turret=turret;c.muzzle=[0,.65,.6];
    return outer;
  }
  function spikes() {
    const {outer,inner}=base('spikes','spikes','CombatOrbitSpikes');
    const {M,G}=ensurePool();
    if(!G.orbitSpikes) {
      const blade=new THREE.Shape();
      blade.moveTo(-.16,-.35);blade.lineTo(.16,-.35);blade.lineTo(.29,.12);
      blade.lineTo(.12,.55);blade.lineTo(0,.92);blade.lineTo(-.12,.55);blade.lineTo(-.29,.12);blade.closePath();
      const geometry=new THREE.ExtrudeGeometry(blade,{depth:.08,bevelEnabled:true,bevelThickness:.035,bevelSize:.035,bevelSegments:1,steps:1});
      geometry.rotateX(HALF_PI);
      G.orbitSpikes=mergeParts(THREE,reg,[0,1,2].map(i=>{
        const a=i*TAU/3;
        return {g:geometry.clone(),x:Math.sin(a)*2.3,y:.45,z:Math.cos(a)*2.3,ry:a};
      }));
      geometry.dispose();
    }
    if(!M.blade)M.blade=std(reg,THREE,'CombatBladeSteel',{color:0xb8d4df,metalness:.8,roughness:.28});
    inner.add(solid(G.orbitSpikes,M.blade,'OrbitingSteelBlades'));
    return outer;
  }
  function weapon(kind) {
    if(kind==='spikes'||kind==='sentry') {
      const object=kind==='spikes'?spikes():sentry(),c=object.userData.combat;
      c.type='weapon';c.mount=kind==='spikes'?[0,1.1,-.6]:[0,1.4,-1];c.muzzle=[0,.5,1];c.barrels=kind==='sentry'?1:0;return object;
    }
    if(kind==='nuke'||kind==='proximity') {
      const object=weapon(kind==='nuke'?'rocket':'bomb');object.userData.combat.kind=kind;object.name=kind==='nuke'?'NukeLauncher':'ProximityLayer';
      return object;
    }
    const k = normRig(kind);
    const branch = libBranch(RIG_MODEL[k], null);
    if (branch) return weaponFromLib(k, branch);
    return weaponFallback(k);
  }

  /* Cosmetic motion only: inner-group transforms, no material writes, no
   * allocation. reducedMotion snaps to the base pose (no bob/spin/pulse). */
  function animate(object, dt, time, reducedMotion) {
    const c = object && object.userData && object.userData.combat;
    if (!c || !c.inner) return;
    const t = Number(time) || 0;
    const step = Math.min(0.1, Math.max(0, Number(dt) || 0));
    const inner = c.inner;
    const seed = c.seed || 0;
    if (c.type === 'weapon') {
      c.recoil = Math.max(0, (c.recoil || 0) - step);
      const offset=reducedMotion?0:-.16*Math.sin(Math.PI*c.recoil/.16);
      for(const part of c.recoilParts||[])part.node.position.z=part.z+offset;
    }

    if((c.kind==='proximity'||c.kind==='bomb')&&c.type==='projectile') {
      // A thrown charge settles with its body, then breathes gently through
      // a tiny red status lamp. The collider and the complete bundle stay
      // fixed in size; no flashing radius or warning-scale animation.
      if(!reducedMotion&&!c.landed)c.spin+=step*Math.max(0,c.rollRate||0);
      inner.rotation.x=reducedMotion?0:c.spin;
      if(c.tail){
        c.tail.visible=c.armed===true;
        const glow=reducedMotion?1:1+.04*Math.sin(t*3+seed);
        c.tail.scale.set(glow,glow,glow);
      }
      return;
    }
    if(c.kind==='spikes') {inner.rotation.y=reducedMotion?0:t*4;return;}
    if(c.type==='sentry')return;
    if (reducedMotion) {
      if (c.type === 'pickup') {
        inner.position.y = 0;
        inner.rotation.y = 0;
        if (c.pad) c.pad.scale.set(1, 1, 1);
      } else if (c.type === 'projectile') {
        inner.rotation.z = 0;
        inner.rotation.x = 0;
        if(c.kind==='grenade')inner.rotation.y=0;
        if (c.tail) c.tail.scale.set(1, 1, 1);
      } else if (c.type === 'mine') {
        inner.rotation.y = 0;
        if (c.cap) c.cap.scale.setScalar(c.armed === false ? 0.85 : 1);
        if (c.glow) {
          c.glow.visible = c.armed !== false;
          c.glow.scale.set(1, 1, 1);
        }
      } else if (c.type === 'weapon') {
        if (c.trim) {
          c.trim.scale.set(1, 1, 1);
          if (c.kind === 'shield') c.trim.rotation.y = 0;
        }
      }
      return;
    }

    if (c.type === 'pickup') {
      inner.position.y = 0.1 * Math.sin(t * 2 + seed);
      inner.rotation.y = t * 0.9 + seed;
      if (c.pad) {
        const s = 1 + 0.05 * Math.sin(t * 3.1 + seed);
        c.pad.scale.set(s, 1, s);
      }
    } else if (c.type === 'projectile') {
      const rates = { pulse: 14, scatter: 9, rocket: 7, rail: 16, grenade:5, seeker:3, bomb:2, nuke:0, sentry:14 };
      c.spin += step * (c.kind==='bomb'?Math.max(0,c.rollRate||0):(rates[c.kind]??14));
      if(c.kind==='bomb')inner.rotation.x=c.spin;
      else if(c.kind==='grenade')inner.rotation.y=c.spin; // keep its support baseline through cosmetic motion
      else inner.rotation.z = c.spin;
      if (c.tail) {
        const f = 1 + 0.12 * Math.sin(t * 30 + seed);
        c.tail.scale.set(f, f, 1 + 0.08 * Math.sin(t * 24 + seed * 1.7));
      }
    } else if (c.type === 'mine') {
      // A deployed mine is planted hardware; only its status lamp blinks.
      inner.rotation.y = 0;
      if (c.armed === false) {
        if (c.cap) c.cap.scale.set(0.85, 0.85, 0.85);
        if (c.glow) c.glow.visible = false;
      } else {
        if (c.cap) c.cap.scale.set(1, 1, 1);
        if (c.glow) {
          c.glow.visible = true;
          // A subtle, slow red status light; no hard strobe.
          const bl = 1 + .04 * Math.sin(t * 3 + seed);
          c.glow.scale.set(bl, 1, bl);
        }
      }
    } else if (c.type === 'weapon') {
      if (c.trim) {
        if (c.kind === 'shield') {
          c.trim.rotation.y = t * 1.2 + seed;
          const s = 1 + 0.08 * Math.sin(t * 5 + seed);
          c.trim.scale.set(s, s, s);
        } else if (c.kind === 'rail' || c.kind === 'emp') {
          const s = 1 + 0.1 * Math.sin(t * 6 + seed);
          c.trim.scale.set(s, s, s);
        } else {
          // Bores, brass muzzle rims and mine collars are rigid parts.
          c.trim.scale.set(1, 1, 1);
        }
      }
    }
  }

  /* Release factory-owned resources exactly once (procedural pool plus
   * GLB override materials). Root-owned GLB library geometries/materials
   * are never in the registry, so they survive. Idempotent; the factory
   * rebuilds lazily on the next creator call. */
  function dispose() {
    for (const g of reg.geometries) {
      if (g && typeof g.dispose === 'function') {
        try { g.dispose(); } catch { /* noop */ }
      }
    }
    for (const m of reg.materials) {
      if (m && typeof m.dispose === 'function') {
        try { m.dispose(); } catch { /* noop */ }
      }
    }
    reg.geometries.clear();
    reg.materials.clear();
    pool = null;
    ovr = null;
    readableHousing = new WeakMap();
  }

  // Accepted authority fire only; callers never predict inventory spends.
  function recoil(object) {
    const c = object?.userData?.combat;
    if (c?.type === 'weapon') c.recoil = .16;
  }

  function placeWeapon(object, muzzle) {
    const c = object.userData.combat;
    if (muzzle && c?.muzzle) object.position.set(muzzle.x-c.muzzle[0],muzzle.y-c.muzzle[1],muzzle.z-c.muzzle[2]);
    else object.position.fromArray(c.mount);
  }
  return { pickup, projectile, mine, weapon, sentry, spikes, placeWeapon, recoil, animate, dispose };
}
