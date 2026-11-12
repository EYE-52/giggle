import {createCuratedArt,CURATED_KINDS} from './kart-curated-art.mjs';
import {WEAPONS} from './kart-weapon-contract.mjs';
/* Shared combat factory. New canonical rigs/projectiles are authored in
 * kart-curated-art.mjs; kept secondary props use kart-arsenal-art.mjs.
 * The GLB/fallback factories below also retain historical names for source
 * asset verification and older packets. New pickups use canonical IDs only.
 * Creators share GPU resources. Views reserve instances and compile/upload
 * every material before Ready; animate changes transforms, never materials.
 * Each projectile points along local +Z; the outer quaternion belongs to the
 * accepted flight path. Disposal releases only factory-owned resources.
 */

// Calibrate the forward skin against the authority sphere before loading ends.
// Axial roll preserves radial distance. The tracer's full animated scale is
// included; long trailing art can remain behind the sphere without shrinking.
import {createArsenalArt,ARSENAL_SHOT_KINDS,ARSENAL_RIG_KINDS,ARSENAL_SHOT_GLOW} from './kart-arsenal-art.mjs';

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
      // The disc banks and spins through every heading. Calibrate its full
      // sphere, not only the cylindrical envelope of a straight tracer.
      const radial=point.x*point.x+point.y*point.y;
      if(radial>radius*radius)throw Error('Projectile art exceeds authoritative sweep radius');
      inset=Math.max(inset,point.z+radius-combat.tipZ-Math.sqrt(radius*radius-radial));
    }
  });}finally{if(tail)tail.scale.copy(scale);}
  return inset+.005;
}

export const COMBAT_ART_BUDGETS = { pickup: 8, projectile: 4, weapon: 6, mine: 4 };

// Compact solid bullets keep their short pencil-thin tracers. Authored GLB
// and failure fallback agree.
export const SHOT_PROFILES = {
  pulse: { radius: 1.2, length: 1.15 },
  scatter: { radius: 1, length: 1.15 },
  rocket: { radius: 1.3, length: 1.6 },
  seeker: { radius: 1, length: 1 },
  nuke: { radius: 1.65, length: 1.6 },
  proximity: { radius: 1, length: 1 },
};

export const COMBAT_GLB_URL = '/assets/karts/combat/combat.glb';

export const COMBAT_GLB_MODELS = ['Pickup', 'Pulse', 'Scatter', 'Mine', 'Shield',
  'Rocket', 'Bolt', 'RocketShot'];

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

const COLORS = {
  amber: 0xffb020,
  coral: 0xf2545b,
  mint: 0x2fe8b0,
  mintGlow: 0x83ffe0,
  mintDeep: 0x0e9b8a,
  cyan: 0x35d5ff,
  cyanPale: 0x6af0ff,
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
    color, transparent: true, opacity: .9, depthWrite: false,
    blending: THREE.NormalBlending, toneMapped: false,
  }), name);
}

// Saturated glow per shot kind, drawn as camera-facing additive sprites so a
// shot reads from across the arena. Sprites are not meshes: they never count
// toward mesh budgets or the authoritative contact skin.
export const SHOT_GLOW = Object.freeze({
  pulse: { color: 0x7ff6ff, size: 1.9 }, scatter: { color: 0xffb347, size: 1.6 },
  rocket: { color: 0xff6a2a, size: 4.3 }, seeker: { color: 0x9cff5a, size: 4 },
  proximity: { color: 0xff3a3a, size: 2.5 }, nuke: { color: 0xffe14a, size: 5 },
});
function glowTexture(THREE) {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.min(1, Math.hypot((x + .5) / size * 2 - 1, (y + .5) / size * 2 - 1)), i = (y * size + x) * 4;
    const core = Math.max(0, 1 - d * 2.6), halo = Math.pow(1 - d, 2.2);
    data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(255 * Math.min(1, core + halo * .7));
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true; texture.magFilter = texture.minFilter = THREE.LinearFilter;
  return texture;
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
  // Source-pack missile bodies are already two metres long after profile
  // scaling. Keep their decorative exhaust compact within the existing
  // complete-projectile envelope; fallback rockets keep their authored tail.
  G.missileExhaust=poolGeo(reg,G.rocketTail.clone(),'CombatMissileExhaust');
  G.missileExhaust.scale(.75,.75,.35);

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

  const curated=createCuratedArt(THREE,name=>libGet?.(name));
  const reg = { geometries: new Set(), materials: new Set() };
  let glowTex = null; const glowMats = new Map();
  let pool = null;
  let mineWarningGeometry=null,mineWarningMaterial=null;
  let ovr = null;
  let cal = null;
  let seq = 0;
  let readableHousing = new WeakMap();
  const arsenal = createArsenalArt(THREE);

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
      ['proximity', 'BombShot', null],
    ];
    for (let i = 0; i < shots.length; i++) {
      const branch = libBranch(shots[i][1], shots[i][2]);
      if (!branch) continue;
      box.setFromObject(branch);
      if (box.isEmpty()) continue;
      cal[shots[i][0]] = { tipZ: box.max.z, tailZ: box.min.z };
    }
    const rigs = ['Pulse', 'Scatter', 'Mine', 'Shield', 'Rocket', 'Seeker', 'Bomb'];
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

  // Borrow the mounted art without touching its shared buffers/materials.
  // Thrown bodies fit the smallest grenade sphere used by either authority;
  // planted bodies fit the horizontal collider and start at ground level.
  const deployedFits=new WeakMap();
  function deployedModel(source,radius,grounded=false){
    const model=cloneLib(source);model.position.set(0,0,0);
    let fit=deployedFits.get(source);
    if(!fit){
      const bounds=new THREE.Box3().setFromObject(model),center=bounds.getCenter(new THREE.Vector3()),half=bounds.getSize(new THREE.Vector3()).multiplyScalar(.5),point=new THREE.Vector3();
      let envelope=0;
      model.traverse(node=>{if(!node.isMesh)return;const positions=node.geometry.attributes.position;
        for(let i=0;i<positions.count;i++){
          point.fromBufferAttribute(positions,i).applyMatrix4(node.matrixWorld).sub(center);
          envelope=Math.max(envelope,grounded?Math.hypot(point.x,point.z):point.length());
        }
      });
      const scale=Math.min(1,radius/Math.max(.001,envelope));
      fit={scale,x:-center.x*scale,y:-(grounded?bounds.min.y:center.y)*scale,z:-center.z*scale,tipZ:half.z*scale};
      deployedFits.set(source,fit);
    }
    model.scale.multiplyScalar(fit.scale);model.position.set(fit.x,fit.y,fit.z);
    return {model,tipZ:fit.tipZ};
  }

  function overrideOf(clone, meshName, material) {
    const mesh = clone.getObjectByName(meshName);
    if (mesh && mesh.isMesh) mesh.material = material;
    return mesh;
  }

  function normShot(kind) {
    return kind === 'scatter' || kind === 'rocket' || kind === 'seeker' ||
      kind === 'nuke' || kind === 'proximity' ? kind : 'pulse';
  }

  function normRig(kind) {
    return kind === 'scatter' || kind === 'mine' || kind === 'shield' ||
      kind === 'rocket' || kind === 'seeker' || kind === 'proximity' ? kind : 'pulse';
  }

  /* ---------------- pickup ---------------- */
  function pickupFromLib(branch) {
    const { outer, inner, c } = base('pickup', null, 'CombatPickup');
    const clone = cloneLib(branch, null);
    // Inset, trim and question mark sit inside the body's silhouette: their
    // shadows are hidden by the body's, so skip those shadow-pass draws.
    clone.traverse(o => { if (o.isMesh && /^Crate(Inset|Trim|Question)/.test(o.name)) o.castShadow = false; });
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
    seeker: ['SeekerShot', null, 'SeekerShotTracer'],
    nuke: ['RocketShot',null,'RocketShotTracer'],
    proximity: ['BombShot',null,'BombShotLamp'],
  };
  const SHOT_TIP_FALLBACK = {
    pulse: [0.75, -1.15], scatter: [0.55, -.9],
    rocket: [0.6, -1.55], seeker: [.6,-.6], nuke:[.6,-1.55], proximity:[.4,-.4],
  };

  const SHOT_NAMES = { pulse: 'PulseBolt', scatter: 'ScatterBolt', rocket: 'RocketBolt', seeker: 'SeekerMissile', nuke: 'NuclearWarhead', proximity: 'ProximityCharge' };

  function projectileFromLib(kind, branch, tracerName) {
    ensureCal();
    const { outer, inner, c } = base('projectile', kind, SHOT_NAMES[kind]);
    const clone = cloneLib(branch, null);
    const o = ensureOverrides();
    const tails = { pulse: o.tailPulse, scatter: o.tailScatter, rocket: o.tailRocket, seeker:o.tailRocket, nuke:o.tailRocket };
    // The dynamite's authored lamp keeps its own material.
    const tail = kind==='proximity' ? clone.getObjectByName(tracerName) : overrideOf(clone, tracerName, tails[kind]);
    inner.add(clone);
    const tip = (cal && cal[kind==='nuke'?'rocket':kind]) || null;
    const fb = SHOT_TIP_FALLBACK[kind];
    c.tipZ = tip ? tip.tipZ : fb[0];
    c.tailZ = tip ? tip.tailZ : fb[1];
    c.tail = tail || null;
    // The shipped space-kit missiles contain a solid body but no tracer
    // node. Add one pooled tapered exhaust behind the authored hull so its
    // flight direction reads from the chase camera. No hitbox/nose changes.
    if(!c.tail&&['rocket','seeker','nuke'].includes(kind)){
      const {G}=ensurePool();
      if(kind==='seeker'&&!o.tailSeeker)o.tailSeeker=glow(reg,THREE,'CombatTailSeeker',COLORS.mintGlow,.9);
      const material=kind==='seeker'?o.tailSeeker:o.tailRocket;material.toneMapped=false;
      c.tail=lit(G.missileExhaust,material,kind==='seeker'?'SeekerExhaust':'RocketExhaust');
      c.tail.position.z=c.tailZ-.14;inner.add(c.tail);c.tailZ-=.3325;
    }
    if(kind==='proximity'){c.armed=false;c.landed=false;}
    return outer;
  }

  function projectileFallback(kind) {
    const { outer, inner, c } = base('projectile', kind, SHOT_NAMES[kind]);
    const { M, G } = ensurePool();
    let tail;
    if(kind==='proximity') {
      inner.add(solid(G.mineDisk,M.metal,'ProximityBody'));
      tail=lit(G.mineCap,M.lampRed,'ProximityLamp');tail.position.y=.3;
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
    if(kind==='proximity'){c.armed=false;c.landed=false;}
    return outer;
  }

  function projectile(kind) {
    if(['machinegun','trishot','missile','cannon'].includes(kind))return curated.projectile(kind);
    if (ARSENAL_SHOT_KINDS.includes(kind)) {
      const source=kind==='frost'&&libBranch('Gear_frost',null);
      let shot;
      if(source){
        const {outer,inner,c}=base('projectile',kind,'FrostBomb'),fit=deployedModel(source,.43);
        inner.add(fit.model);c.arsenal=true;c.tipZ=fit.tipZ;c.tailZ=-fit.tipZ;shot=outer;
      }else shot=arsenal.projectile(kind);
      const c = shot.userData.combat, spec = ARSENAL_SHOT_GLOW[kind];
      if (!glowTex) glowTex = glowTexture(THREE);
      let material = glowMats.get(kind);
      if (!material) {
        material = new THREE.SpriteMaterial({ map: glowTex, color: spec.color, opacity: spec.opacity??1, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
        material.name = 'CombatShotGlow:' + kind; glowMats.set(kind, material); reg.materials.add(material);
      }
      const halo = new THREE.Sprite(material);
      halo.name = 'ShotGlow'; halo.scale.setScalar(spec.size); halo.position.z = c.tipZ * .35;
      halo.renderOrder = 6; shot.add(halo); c.halo = halo; c.haloSize = spec.size;
      return shot;
    }
    const k = normShot(kind);
    const spec = SHOT_BRANCH[k];
    const branch = libBranch(spec[0], spec[1]);
    // Slugs keep their authored metallic materials on both paths; only the
    // narrow tracer behind is a factory-owned override (white/amber/ember).
    const source=k==='nuke'&&libBranch('Gear_nuke',null);
    let shot;
    if(source){
      const {outer,inner,c}=base('projectile',k,SHOT_NAMES[k]),fit=deployedModel(source,.43);
      inner.add(fit.model);c.tipZ=fit.tipZ;c.tailZ=-fit.tipZ;shot=outer;
    }else shot=branch ? projectileFromLib(k, branch, spec[2]) : projectileFallback(k);
    const c = shot.userData.combat, profile = SHOT_PROFILES[k];
    if(!source){
      c.inner.scale.set(profile.radius, profile.radius, profile.length);
      c.tipZ *= profile.length;
      c.tailZ *= profile.length;
    }
    const spec2 = SHOT_GLOW[k];
    if (spec2) {
      if (!glowTex) glowTex = glowTexture(THREE);
      let material = glowMats.get(k);
      if (!material) {
        material = new THREE.SpriteMaterial({ map: glowTex, color: spec2.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
        material.name = 'CombatShotGlow:' + k; glowMats.set(k, material); reg.materials.add(material);
      }
      const halo = new THREE.Sprite(material);
      halo.name = 'ShotGlow'; halo.scale.setScalar(spec2.size); halo.position.z = c.tipZ * .35;
      halo.renderOrder = 6; shot.add(halo); c.halo = halo; c.haloSize = spec2.size;
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

  const trapSizes=new Map();
  let trapBall=null;
  function specialTrap(kind,isOwn){
    const {outer,inner,c}=base('mine',kind,kind==='fakecrate'?'FakeCrateTrap':'ProximityTrap');
    const source=libBranch('Gear_'+kind,null);
    if(source){
      const model=kind==='proximity'?deployedModel(source,WEAPONS.proximity.bodyRadius-.02,true).model:cloneLib(source);
      if(kind==='proximity')inner.add(model);
      else{
        model.position.set(0,0,0);
        let fit=trapSizes.get(kind);
        if(!fit){
          const bounds=new THREE.Box3().setFromObject(model);
          const scale=1.48/Math.max(.01,bounds.max.x-bounds.min.x,bounds.max.z-bounds.min.z);
          fit={scale,y:-bounds.min.y*scale};trapSizes.set(kind,fit);
        }
        model.scale.multiplyScalar(fit.scale);model.position.y=fit.y;inner.add(model);
      }
    }else{
      const {M,G}=ensurePool();
      if(kind==='fakecrate'){
        const body=solid(G.pickupBody,M.crate,'DecoyBox'),lid=solid(G.pickupLid,M.lid,'DecoyLid');
        body.position.y=.55;lid.position.y=1.15;
        inner.add(body,lid,lit(G.pickupGlyph,M.glyph,'DecoyMark'));
      }else{
        trapBall ||= poolGeo(reg,new THREE.SphereGeometry(.46,12,8),'ProximityBall');
        const body=solid(trapBall,M.lampRed,'ProximityBall'),cap=solid(G.mineGlow,M.metal,'ProximityCap');
        body.position.y=.46;cap.position.y=.93;inner.add(body,cap);
      }
    }
    c.own=isOwn;c.armed=true;
    return outer;
  }

  function mine(own, kind) {
    const isOwn = own !== false;
    if(kind==='fakecrate')return specialTrap(kind,isOwn);
    const branch = libBranch('MineTrap', null)||libBranch('Mine', null);
    const round=libBranch('Gear_mine',null)?.getObjectByName('Mine0');
    let object;
    if(kind==='proximity')object=specialTrap(kind,isOwn);
    else if(round){
      const {outer,inner,c}=base('mine','mine','CombatMine');
      inner.add(deployedModel(round,WEAPONS.mine.bodyRadius-.02,true).model);
      c.own=isOwn;c.armed=true;object=outer;
    }else object=branch?mineFromLib(isOwn,branch):mineFallback(isOwn);
    const c=object.userData.combat;
    if(!mineWarningGeometry){mineWarningGeometry=poolGeo(reg,new THREE.RingGeometry(.78,.94,32),'MineWarningRing');mineWarningGeometry.rotateX(-Math.PI/2);mineWarningMaterial=trackMat(reg,new THREE.MeshBasicMaterial({color:0xffcb55,transparent:true,opacity:.7,depthWrite:false,side:THREE.DoubleSide,toneMapped:false}));}
    const warning=new THREE.Mesh(mineWarningGeometry,mineWarningMaterial);warning.name='MineWarningRing';warning.position.y=.09;warning.userData.groundDecoration=true;object.add(warning);c.warning=warning;
    return object;
  }

  /* ---------------- weapons ---------------- */
  const RIG_MODEL = {
    pulse: 'Pulse', scatter: 'Scatter', mine: 'Mine',
    shield: 'Shield', rocket: 'Rocket', seeker: 'Seeker', proximity: 'Bomb',
  };
  const RIG_TRIM = {
    pulse: 'PulseMuzzle', scatter: 'ScatterMuzzles', mine: 'MineCap',
    shield: 'ShieldCore', rocket: 'RocketMuzzle', seeker: 'SeekerMuzzle', proximity: 'BombMuzzle',
  };
  const RIG_BARRELS = { pulse: 1, scatter: 3, mine: 0, shield: 0, rocket: 1, seeker: 1, proximity: 1 };
  const RIG_MUZZLE_FALLBACK = {
    pulse: [0, 0.3, 1.1], scatter: [0, 0.42, 0.9], mine: [0, 0.4, 0],
    shield: [0, 0.48, 0], rocket: [0, 0.65, 0.98], seeker: [0, .5, 1.1], proximity: [0, .5, 1.1],
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
    const mz = (cal && cal[`muzzle:${RIG_MODEL[kind].toLowerCase()}`]) || RIG_MUZZLE_FALLBACK[kind];
    c.muzzle = [mz[0], mz[1], mz[2]];
    c.barrels = RIG_BARRELS[kind];
    c.trim = trim;
    return outer;
  }

  function weaponFallback(kind) {
    const { outer, inner, c } = base('weapon', kind, 'CombatRig');
    const { M, G } = ensurePool();
    c.mount = [0, 1.35, -1.2];
    if (kind === 'scatter') {
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
    } else if (kind === 'rocket' || kind === 'seeker' || kind === 'proximity') {
      // Failed-load launchers share the rocket tube; the GLB path gives
      // proximity its own dynamite launcher.
      inner.add(solid(G.rigRocketBody, M.metal, 'RocketLauncher'));
      inner.add(solid(G.rigRocketTrim, M.lid, 'RocketTrim'));
      const muzzle = lit(G.rigRocketMuzzle, M.muzzleScatter, 'RocketMuzzle');
      muzzle.position.set(0, 0.65, 0.92);
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
    c.muzzle = RIG_MUZZLE_FALLBACK[kind === 'proximity' ? 'rocket' : kind].slice();
    c.barrels = RIG_BARRELS[kind];
    return outer;
  }

  function weapon(kind) {
    if(CURATED_KINDS.includes(kind))return curated.weapon(kind);
    if(kind==='nuke') {
      const object=weapon('rocket');object.userData.combat.kind='nuke';object.name='NukeLauncher';
      return object;
    }
    if (ARSENAL_RIG_KINDS.includes(kind)) return arsenal.weapon(kind);
    const k = normRig(kind);
    const branch = libBranch(RIG_MODEL[k], null);
    const object = branch ? weaponFromLib(k, branch) : weaponFallback(k);
    if (k === 'proximity') object.name = 'ProximityLayer';
    return object;
  }

  /* Cosmetic motion only: inner-group transforms, no material writes, no
   * allocation. reducedMotion snaps to the base pose (no bob/spin/pulse). */
  function animate(object, dt, time, reducedMotion) {
    const c = object && object.userData && object.userData.combat;
    if (!c || !c.inner) return;
    if(c.curated){curated.animate(object,dt,time,reducedMotion);return;}
    if (c.arsenal) { arsenal.animate(object, dt, time, reducedMotion); return; }
    const t = Number(time) || 0;
    const step = Math.min(0.1, Math.max(0, Number(dt) || 0));
    const inner = c.inner;
    const seed = c.seed || 0;
    if (c.type === 'weapon') {
      c.recoil = Math.max(0, (c.recoil || 0) - step);
      const offset=reducedMotion?0:-.16*Math.sin(Math.PI*c.recoil/.16);
      for(const part of c.recoilParts||[])part.node.position.z=part.z+offset;
    }

    if(c.kind==='proximity'&&c.type==='projectile') {
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
    if (reducedMotion) {
      if (c.type === 'pickup') {
        inner.position.y = 0;
        inner.rotation.y = 0;
        if (c.pad) c.pad.scale.set(1, 1, 1);
      } else if (c.type === 'projectile') {
        inner.rotation.z = 0;
        inner.rotation.x = 0;
        if (c.tail) c.tail.scale.set(1, 1, 1);
      } else if (c.type === 'mine') {
        inner.rotation.y = 0;
        if (c.warning) c.warning.scale.setScalar(c.armed === false ? .8 : 1);
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
      const rates = { pulse: 14, scatter: 9, rocket: 7, seeker:3, nuke:0 };
      c.spin += step * (rates[c.kind]??14);
      inner.rotation.z = c.spin;
      if (c.tail) {
        const f = 1 + 0.12 * Math.sin(t * 30 + seed);
        c.tail.scale.set(f, f, 1 + 0.08 * Math.sin(t * 24 + seed * 1.7));
      }
      if (c.halo) c.halo.scale.setScalar(c.haloSize * (reducedMotion ? 1 : 1 + .14 * Math.sin(t * 22 + seed)));
    } else if (c.type === 'mine') {
      if(c.warning)c.warning.scale.setScalar(c.armed===false?.8:1+.08*Math.sin(t*5+seed));
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
          const bl = .95 + .3 * Math.sin(t * 5 + seed);
          c.glow.scale.set(bl, 1, bl);
        }
      }
    } else if (c.type === 'weapon') {
      if (c.trim) {
        if (c.kind === 'shield') {
          c.trim.rotation.y = t * 1.2 + seed;
          const s = 1 + 0.08 * Math.sin(t * 5 + seed);
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
    glowTex?.dispose(); glowTex = null; glowMats.clear();
    arsenal.dispose();curated.dispose();
    mineWarningGeometry=mineWarningMaterial=trapBall=null;trapSizes.clear();
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
  return { pickup, projectile, mine, weapon, placeWeapon, aim:curated.aim, recoil, animate, dispose };
}
