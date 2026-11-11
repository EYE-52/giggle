import {MeshoptDecoder} from '../public/vendor/three/libs/meshopt_decoder.mjs';
await MeshoptDecoder.ready;
/* Contract + GLB validation for public/js/engines/kart-combat-art.mjs.
 *
 * - combat.glb loads in Node via GLTFLoader (ArrayBuffer, no DOM: the GLB
 *   carries no textures/images) and exposes the documented model groups
 *   with joined-by-material meshes, verified bounds/pivots/muzzle tips.
 * - every creator returns a Group of genuine meshes (no sprites/textures,
 *   no sphere "orbs") with a documented userData.combat block, on BOTH the
 *   GLB path (assets as library root, Map, or plain object) and the
 *   procedural fallback path (no assets / missing model).
 * - silhouettes via bounding boxes: pickup fits 2.4, projectile hull <= .45
 *   lateral and elongated along +Z, mine <= 1.0, weapons carry a forward
 *   muzzle; rocket rigs and shots are a distinct fourth variant. Retired
 *   kinds (rail/grenade/emp/bomb/sentry/spikes) are gone from the factory.
 * - mesh budgets: pickup <= 8, projectile <= 4, weapon <= 6, mine <= 4, and
 *   a typical full match stays under 180 extra draw calls.
 * - GLB clones share root-owned geometries/materials; tracers and mine
 *   tints are shared factory-owned overrides; fallback instances share one
 *   pooled set; thousands of adds/removes stay bounded.
 * - animate() moves inner transforms only, mutates no shared material,
 *   allocates nothing, and reducedMotion snaps to the base pose.
 * - dispose() releases every factory-owned resource exactly once, never
 *   touches root-owned GLB library resources, stays idempotent, and leaves
 *   the factory usable.
 * Run: node test/kart-combat-art.mjs (no GPU; real three object graph). */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createKartCombatArt, COMBAT_ART_BUDGETS, COMBAT_GLB_MODELS, COMBAT_GLB_URL } from '../public/js/engines/kart-combat-art.mjs';

assert.deepEqual(COMBAT_GLB_MODELS, ['Pickup', 'Pulse', 'Scatter', 'Mine', 'Shield',
  'Rocket', 'Bolt', 'RocketShot']);
assert.equal(COMBAT_GLB_URL, '/assets/karts/combat/combat.glb'); // Legacy direct-loader URL remains compatible.

const glbBytes = await readFile(new URL('../public/assets/karts/combat/combat.meshopt.glb', import.meta.url));
const glbBuffer = glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength);
const gltf = await new Promise((resolve, reject) => {
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(glbBuffer, '', resolve, reject);
});
const library = gltf.scene;
assert.ok(library && library.isObject3D, 'GLB parses to a scene');

function meshesOf(root) {
  const out = [];
  root.traverse((o) => { if (o.isMesh) out.push(o); });
  return out;
}

function boundsOf(root) {
  root.updateMatrixWorld(true);
  // Solid art only: the shot's additive glow sprite is not part of its hull.
  const glow = root.getObjectByName('ShotGlow'), parent = glow?.parent;
  glow?.removeFromParent();
  try { return new THREE.Box3().setFromObject(root); } finally { if (glow) parent.add(glow); }
}

function sizeOf(root) {
  return boundsOf(root).getSize(new THREE.Vector3());
}

function poolOf(roots) {
  const geos = new Set();
  const mats = new Set();
  for (const root of roots) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      geos.add(o.geometry);
      const mm = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mm) mats.add(m);
    });
  }
  return { geos, mats };
}

function assertGroup(root, type, kind) {
  assert.ok(root && root.isGroup, `${type} returns a Group`);
  const c = root.userData && root.userData.combat;
  assert.ok(c, `${type} carries userData.combat`);
  assert.equal(c.type, type);
  assert.equal(c.kind, kind);
  assert.ok(c.inner && c.inner.isGroup, `${type} exposes inner group`);
  assert.equal(c.inner.parent, root, 'inner hangs under the returned group');
  assert.ok(Number.isFinite(c.seed), 'deterministic seed');
}

function assertNoOrbsOrTextures(root, tag) {
  root.traverse((o) => {
    // The only sprite is the shot's additive glow, one per projectile.
    assert.ok(!o.isSprite || (o.name === 'ShotGlow' && o.parent === root && root.userData.combat?.type === 'projectile' && o.material.blending === 2), `${tag} uses meshes, no sprites`);
    if (o.isMesh) {
      assert.notEqual(o.geometry.type, 'SphereGeometry', `${tag} has no sphere orbs`);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const key of Object.keys(m)) {
          assert.ok(!(m[key] && m[key].isTexture), `${tag} needs no textures`);
        }
      }
    }
  });
}

function approx(actual, want, eps, msg) {
  assert.ok(Math.abs(actual - want) <= eps, `${msg}: saw ${actual}, want ${want} ± ${eps}`);
}

/* ---- GLB structure: documented models, joined meshes, pivots, muzzles ---- */
const libModels = {};
for (const name of COMBAT_GLB_MODELS) {
  libModels[name] = library.getObjectByName(name);
  assert.ok(libModels[name], `combat.glb exposes model group ${name}`);
}
assertNoOrbsOrTextures(library, 'combat.glb library');
assert.equal(meshesOf(libModels.Pickup).length, 6, 'Pickup joins to 6 meshes');
assert.equal(meshesOf(libModels.Mine).length, 4, 'Mine joins to 4 meshes');
assert.equal(meshesOf(libModels.Bolt).length, 6, 'Bolt holds two 3-mesh variants');
for (const m of ['Pulse', 'Scatter', 'Shield', 'Rocket', 'RocketShot']) {
  assert.ok(meshesOf(libModels[m]).length <= 3, `${m} joins to <= 3 meshes`);
}
{
  const pulse = libModels.Bolt.getObjectByName('BoltPulse');
  const scatter = libModels.Bolt.getObjectByName('BoltScatter');
  assert.ok(pulse && scatter, 'Bolt exposes BoltPulse + BoltScatter variants');
  assert.equal(meshesOf(pulse).length, 3, 'BoltPulse is 3 meshes');
  assert.equal(meshesOf(scatter).length, 3, 'BoltScatter is 3 meshes');
  for (const n of ['MineDisk', 'MineCap', 'MineGlow', 'MineRack']) {
    assert.ok(libModels.Mine.getObjectByName(n), `Mine part ${n}`);
  }
  for (const n of ['PickupBody', 'PickupLid', 'PickupMetal', 'PickupGlyph', 'PickupBadge', 'PickupPad']) {
    assert.ok(libModels.Pickup.getObjectByName(n), `Pickup part ${n}`);
  }
  const mats = new Set();
  library.traverse((o) => { if (o.isMesh) mats.add(o.material.name); });
  assert.ok(mats.size <= 16, `GLB materials bounded, saw ${mats.size}`);
  for (const n of mats) assert.ok(n.startsWith('Combat'), `GLB material ${n} namespaced`);
  assert.ok(mats.has('CombatMetal') && mats.has('CombatAmber'), 'shared stocks present');
}
for (const m of ['Pulse', 'Scatter', 'Mine', 'Shield', 'Rocket']) {
  const tip = libModels[m].getObjectByName(`${m}MuzzleTip`);
  assert.ok(tip, `${m} carries ${m}MuzzleTip`);
  assert.ok(tip.position.z >= -1e-6, `${m} muzzle faces +Z`);
}
{
  // Pivots: pickup/mine sit on y=0, rigs sit on the mount plane, shots centered.
  approx(boundsOf(libModels.Pickup).min.y, 0, 0.02, 'Pickup base y=0');
  approx(boundsOf(libModels.Mine).min.y, 0, 0.02, 'Mine base y=0');
  for (const m of ['Pulse', 'Scatter', 'Shield', 'Rocket']) {
    approx(boundsOf(libModels[m]).min.y, 0, 0.02, `${m} rig sits on mount plane`);
  }
}

/* ---- shared contract, exercised on both paths ---- */
const SHOT_KINDS = ['pulse', 'scatter', 'rocket'];
const RIG_KINDS = ['pulse', 'scatter', 'mine', 'shield', 'rocket'];

function checkContract(art, tag, glbNames) {
  const pickup = art.pickup();
  assertGroup(pickup, 'pickup', null);
  assert.ok(pickup.userData.combat.pad, `${tag} pickup documents its glow pad`);
  const shots = {};
  for (const kind of SHOT_KINDS) {
    shots[kind] = art.projectile(kind);
    assertGroup(shots[kind], 'projectile', kind);
    const c = shots[kind].userData.combat;
    assert.ok(c.tipZ > 0 && c.tailZ < 0, `${tag} ${kind} documents nose/tail`);
    assert.ok(c.tail && c.tail.isMesh, `${tag} ${kind} documents its tracer`);
  }
  const ownMine = art.mine(true);
  assertGroup(ownMine, 'mine', 'mine');
  assert.equal(ownMine.userData.combat.own, true);
  assert.equal(ownMine.userData.combat.armed, true);
  const foeMine = art.mine(false);
  assert.equal(foeMine.userData.combat.own, false);
  const rigs = {};
  for (const kind of RIG_KINDS) {
    rigs[kind] = art.weapon(kind);
    assertGroup(rigs[kind], 'weapon', kind);
    const c = rigs[kind].userData.combat;
    assert.ok(Array.isArray(c.mount) && c.mount.length === 3, `${tag} ${kind} mount`);
    assert.ok(Array.isArray(c.muzzle) && c.muzzle.length === 3, `${tag} ${kind} muzzle`);
    assert.ok(c.trim && c.trim.isMesh, `${tag} ${kind} animated trim`);
  }
  assert.equal(rigs.pulse.userData.combat.barrels, 1, 'pulse single-barrel');
  assert.equal(rigs.scatter.userData.combat.barrels, 3, 'scatter triple-barrel');
  assert.equal(rigs.rocket.userData.combat.barrels, 1, 'rocket single-tube');
  assert.equal(rigs.mine.userData.combat.barrels, 0, 'mine layer has no barrel');
  assert.equal(rigs.shield.userData.combat.barrels, 0, 'shield has no barrel');
  assert.equal(art.projectile('bogus').userData.combat.kind, 'pulse', 'unknown bolt falls back');
  assert.equal(art.weapon('bogus').userData.combat.kind, 'pulse', 'unknown rig falls back');
  assert.equal(art.sentry, undefined, `${tag} sentry() retired`);
  assert.equal(art.spikes, undefined, `${tag} spikes() retired`);
  for (const kind of ['rail', 'grenade', 'emp', 'bomb', 'sentry', 'spikes']) {
    assert.equal(art.weapon(kind).userData.combat.kind, 'pulse', `${tag} retired rig ${kind} normalizes`);
    assert.equal(art.projectile(kind).userData.combat.kind, 'pulse', `${tag} retired shot ${kind} normalizes`);
  }
  // Every kept kind returns exactly the requested kind (no aliasing).
  for (const kind of ['pulse', 'scatter', 'mine', 'rocket', 'seeker', 'proximity', 'shield', 'nuke']) {
    assert.equal(art.weapon(kind).userData.combat.kind, kind, `${tag} weapon(${kind}) kind`);
  }
  for (const kind of ['pulse', 'scatter', 'rocket', 'seeker', 'proximity', 'nuke']) {
    assert.equal(art.projectile(kind).userData.combat.kind, kind, `${tag} projectile(${kind}) kind`);
  }

  assert.deepEqual(COMBAT_ART_BUDGETS, { pickup: 8, projectile: 4, weapon: 6, mine: 4 });
  assert.ok(meshesOf(pickup).length <= 8, `${tag} pickup budget`);
  for (const kind of SHOT_KINDS) {
    assert.ok(meshesOf(shots[kind]).length <= 4, `${tag} ${kind} shot budget`);
  }
  assert.ok(meshesOf(ownMine).length <= 4, `${tag} mine budget`);
  for (const kind of RIG_KINDS) {
    assert.ok(meshesOf(rigs[kind]).length <= 6, `${tag} ${kind} rig budget`);
  }
  for (const [label, root] of [['pickup', pickup], ...SHOT_KINDS.map((k) => [k, shots[k]]),
    ['mine', ownMine], ...RIG_KINDS.map((k) => [`rig-${k}`, rigs[k]])]) {
    assertNoOrbsOrTextures(root, `${tag} ${label}`);
  }
  return { pickup, shots, ownMine, foeMine, rigs };
}

function checkSilhouettes(bundle, tag) {
  const { pickup, shots, ownMine, foeMine, rigs } = bundle;
  {
    const b = boundsOf(pickup);
    const s = b.getSize(new THREE.Vector3());
    const reach = Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z));
    assert.ok(reach <= 2.4, `${tag} pickup fits 2.4, saw ${reach.toFixed(2)}`);
    assert.ok(Math.abs(b.min.y) < 0.02, `${tag} pickup base at y=0`);
    assert.ok(s.y > 1 && s.y < 3, `${tag} pickup reads at chase-camera size`);
  }
  const sizes = {};
  for (const kind of SHOT_KINDS) {
    const b = boundsOf(shots[kind]);
    const s = b.getSize(new THREE.Vector3());
    sizes[kind] = s;
    const cx = (b.min.x + b.max.x) / 2;
    const cy = (b.min.y + b.max.y) / 2;
    assert.ok(Math.abs(cx) < 0.05 && Math.abs(cy) < 0.05, `${tag} ${kind} centered`);
    assert.ok(s.x / 2 <= 0.45 && s.y / 2 <= 0.45, `${tag} ${kind} hull <= .45`);
    {
      const body = meshesOf(shots[kind]).find(m => m.name.endsWith('Body'));
      const bodySize = sizeOf(body);
      const range = { pulse: [1.25, 1.6], scatter: [.9, 1.2], rocket: [1.6, 2.1] }[kind];
      assert.ok(bodySize.z >= range[0] && bodySize.z <= range[1],
        `${tag} ${kind} physical body stays compact, saw ${bodySize.z.toFixed(3)}`);
      assert.ok(bodySize.z > 2 * Math.max(bodySize.x, bodySize.y), `${tag} ${kind} has a forward solid silhouette`);
    }
    assert.ok(b.max.z > 0 && b.min.z < 0, `${tag} ${kind} nose +Z, tracer -Z`);
    const c = shots[kind].userData.combat;
    approx(c.tipZ, b.max.z, 1e-3, `${tag} ${kind} tipZ matches nose`);
    approx(c.tailZ, b.min.z, 1e-3, `${tag} ${kind} tailZ matches tracer end`);
  }
  assert.ok(sizes.pulse.z > sizes.scatter.z + 0.2, `${tag} pulse longer than scatter`);
  assert.ok(Math.max(sizes.pulse.x, sizes.pulse.y) < Math.max(sizes.scatter.x, sizes.scatter.y),
    `${tag} pulse slimmer than scatter`);
  assert.ok(sizes.rocket.z > sizes.scatter.z, `${tag} rocket longer than scatter`);
  {
    const b = boundsOf(ownMine);
    const reach = Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z));
    assert.ok(reach <= 1.0, `${tag} mine fits 1.0, saw ${reach.toFixed(2)}`);
    assert.ok(Math.abs(b.min.y) < 0.02, `${tag} mine sits on the ground`);
    const capOwn = ownMine.getObjectByName('MineCap').material.color.getHex();
    const capFoe = foeMine.getObjectByName('MineCap').material.color.getHex();
    assert.notEqual(capOwn, capFoe, `${tag} own/foe mines tint differently`);
  }
  for (const kind of RIG_KINDS) {
    const c = rigs[kind].userData.combat;
    const s = sizeOf(rigs[kind]);
    assert.ok(Math.max(s.x, s.y, s.z) >= 0.8, `${tag} ${kind} rig reads at size`);
    assert.ok(c.muzzle[2] >= -1e-4, `${tag} ${kind} muzzle faces +Z`);
    assert.deepEqual(c.mount,kind==='mine'?[-1.18,1.30,-1.17]:[0,1.35,-1.2],`${tag} ${kind} fits its rack`);
  }
}

function checkYaw(art, tag) {
  for (const kind of SHOT_KINDS) {
    for (const [vx, vz] of [[0, 1], [1, 0], [-3, 4], [2, -2]]) {
      const bolt = art.projectile(kind);
      bolt.rotation.y = Math.atan2(vx, vz);
      bolt.updateMatrixWorld(true);
      const tip = new THREE.Vector3(0, 0, bolt.userData.combat.tipZ).applyMatrix4(bolt.matrixWorld);
      const dir = tip.sub(bolt.position).normalize();
      const want = new THREE.Vector3(vx, 0, vz).normalize();
      assert.ok(dir.distanceTo(want) < 1e-6, `${tag} ${kind} nose tracks velocity`);
    }
  }
}

function checkAnimate(art, tag, bundle) {
  const cast = [bundle.pickup, ...SHOT_KINDS.map((k) => bundle.shots[k]),
    bundle.ownMine, ...RIG_KINDS.map((k) => bundle.rigs[k])];
  const kids = cast.map((o) => o.children.length);
  const before = poolOf(cast);
  const geoRefs = new Map();
  const matRefs = new Map();
  for (const o of cast) {
    o.traverse((m) => {
      if (m.isMesh) { geoRefs.set(m, m.geometry); matRefs.set(m, m.material); }
    });
  }
  const trimSizes=Object.fromEntries(Object.entries(bundle.rigs).map(([kind,rig])=>[kind,rig.userData.combat.trim.scale.toArray()]));
  const outerPos = cast[0].position.clone();
  const outerRot = cast[0].rotation.y;
  for (let i = 0; i < 500; i++) {
    for (const o of cast) art.animate(o, 0.016, i * 0.016, false);
    const mine = bundle.ownMine.userData.combat;
    assert.equal(mine.inner.rotation.y, 0, `${tag} deployed mine stays planted`);
    assert.deepEqual(mine.cap.scale.toArray(), [1, 1, 1], `${tag} armed mine collar stays rigid`);
    for (const kind of ['pulse', 'scatter', 'mine', 'rocket']) {
      assert.deepEqual(bundle.rigs[kind].userData.combat.trim.scale.toArray(),trimSizes[kind],
        `${tag} ${kind} physical muzzle/collar stays rigid`);
    }
  }
  cast.forEach((o, i) => assert.equal(o.children.length, kids[i], `${tag} animate adds no nodes`));
  for (const o of cast) {
    o.traverse((m) => {
      if (!m.isMesh) return;
      assert.equal(m.geometry, geoRefs.get(m), `${tag} animate swaps no geometry`);
      assert.equal(m.material, matRefs.get(m), `${tag} animate clones no material`);
    });
  }
  const after = poolOf(cast);
  assert.deepEqual(after.geos, before.geos, `${tag} 500 frames allocate no geometries`);
  assert.deepEqual(after.mats, before.mats, `${tag} 500 frames allocate no materials`);
  assert.ok(cast[0].userData.combat.inner.rotation.y !== 0, `${tag} pickup spins`);
  assert.ok(cast[1].userData.combat.inner.rotation.z !== 0, `${tag} bolt rolls`);
  assert.ok(cast[0].position.equals(outerPos) && cast[0].rotation.y === outerRot,
    `${tag} outer transforms untouched`);
  for (const o of cast) art.animate(o, 0.016, 99, true);
  const snap = cast.map((o) => JSON.stringify({
    p: o.userData.combat.inner.position.toArray(),
    r: [o.userData.combat.inner.rotation.x, o.userData.combat.inner.rotation.y, o.userData.combat.inner.rotation.z],
  }));
  for (const o of cast) art.animate(o, 0.016, 12345, true);
  cast.forEach((o, i) => assert.equal(JSON.stringify({
    p: o.userData.combat.inner.position.toArray(),
    r: [o.userData.combat.inner.rotation.x, o.userData.combat.inner.rotation.y, o.userData.combat.inner.rotation.z],
  }), snap[i], `${tag} reduced motion holds still`));
  assert.equal(cast[0].userData.combat.inner.position.y, 0, `${tag} pickup bob stops`);
  const mineCast = cast.find((o) => o.userData.combat.type === 'mine');
  const capMat = mineCast.getObjectByName('MineCap').material;
  mineCast.userData.combat.armed = false;
  art.animate(mineCast, 0.016, 7, false);
  assert.equal(mineCast.userData.combat.glow.visible, false, `${tag} unarmed hides glow`);
  art.animate(mineCast, 0.016, 7, true);
  assert.deepEqual(mineCast.userData.combat.cap.scale.toArray(), [.85, .85, .85],
    `${tag} reduced motion retains the unarmed collar pose`);
  assert.equal(mineCast.getObjectByName('MineCap').material, capMat, `${tag} dimming swaps no material`);
  mineCast.userData.combat.armed = true;
  art.animate(mineCast, 0.016, 8, false);
  assert.equal(mineCast.userData.combat.glow.visible, true, `${tag} re-armed glows`);
  art.animate(new THREE.Group(), 0.016, 1, false);
  art.animate({}, 0.016, 1, false);
  art.animate(null, 0.016, 1, false);
  art.animate(cast[0]);
  art.animate(cast[0], NaN, NaN, true);
}

function checkFullMatch(bundle, tag) {
  const { pickup, shots, ownMine, rigs } = bundle;
  const rigMesh = RIG_KINDS.map((k) => meshesOf(rigs[k]).length);
  const load = rigMesh[0] * 2 + rigMesh[1] * 2 + rigMesh[2] + rigMesh[3] +
    rigMesh[4] * 2 +
    meshesOf(shots.pulse).length * 4 + meshesOf(shots.scatter).length * 4 +
    meshesOf(shots.rocket).length * 8 +
    meshesOf(ownMine).length * 8 + meshesOf(pickup).length * 6;
  assert.ok(load < 180, `${tag} typical full match under 180, saw ${load}`);
}

/* ---- GLB path: all three documented assets shapes ---- */
const assetsMap = new Map(COMBAT_GLB_MODELS.map((m) => [m, library.getObjectByName(m)]));
const assetsObj = Object.fromEntries(assetsMap);
{
  const assets=new Map(),geometry=new THREE.BoxGeometry(1,1.2,1),material=new THREE.MeshStandardMaterial();
  for(const kind of ['proximity','fakecrate']){
    const source=new THREE.Group();source.name='Gear_'+kind;
    source.add(new THREE.Mesh(geometry,material));assets.set(source.name,source);
  }
  const art=createKartCombatArt(THREE,{assets});
  for(const kind of ['proximity','fakecrate']){
    const trap=art.mine(false,kind),copy=trap.getObjectByName('Gear_'+kind);
    assert(copy&&copy!==assets.get(copy.name),'ground trap clones the matching gear model');
    assert.equal(meshesOf(copy)[0].geometry,geometry,'trap pool shares source geometry');
    assert.equal(meshesOf(copy)[0].material,material,'trap pool shares source material');
    assert(Math.abs(new THREE.Box3().setFromObject(copy).min.y)<1e-5,'gear sits on its base');
    assert.equal(trap.userData.combat.kind,kind);
    assert.equal(!!trap.getObjectByName('MineWarningRing'),kind==='proximity');
  }
  art.dispose();geometry.dispose();material.dispose();
}
const artRoot = createKartCombatArt(THREE, { assets: library });
const artMap = createKartCombatArt(THREE, { assets: assetsMap });
const artObj = createKartCombatArt(THREE, { assets: assetsObj });

for (const [label, art] of [['root', artRoot], ['map', artMap], ['obj', artObj]]) {
  assert.equal(meshesOf(art.pickup()).length, 6, `assets ${label}: pickup meshes`);
  assert.equal(meshesOf(art.projectile('scatter')).length, 3, `assets ${label}: scatter shot meshes`);
  assert.equal(meshesOf(art.weapon('rocket')).length, 3, `assets ${label}: rocket rig meshes`);
  assert.ok(art.weapon('rocket').getObjectByName('RocketMuzzle'), `assets ${label}: GLB names`);
}
assert.throws(() => createKartCombatArt(null), 'factory requires THREE');

// Battle pickups use the same authored sapphire supply crate as the arena,
// rather than silently selecting an older amber combat-library model.
const crateBytes = await readFile(new URL('../public/assets/karts/giggle-crate.meshopt.glb',import.meta.url));
const crateGltf = await new Promise((resolve,reject)=>new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(crateBytes.buffer.slice(crateBytes.byteOffset,crateBytes.byteOffset+crateBytes.byteLength),'',resolve,reject));
const authoredCrateArt = createKartCombatArt(THREE,{assets:library,pickupAsset:crateGltf.scene});
const authoredCrate = authoredCrateArt.pickup();
assert.equal(meshesOf(authoredCrate).length,meshesOf(crateGltf.scene).length,'authored crate meshes are selected');
assert.deepEqual(poolOf([authoredCrate]),poolOf([crateGltf.scene]),'crate clones borrow the arena library resources');
assert.ok(sizeOf(authoredCrate).x<=2.4&&sizeOf(authoredCrate).z<=2.4,'authored crate stays inside the pickup footprint');
authoredCrateArt.animate(authoredCrate,.016,1,false);
authoredCrateArt.animate(authoredCrate,.016,2,true);
assert.equal(authoredCrate.userData.combat.inner.position.y,0,'reduced motion restores crate pose');
let borrowedDisposed=0;
for(const mesh of meshesOf(crateGltf.scene))mesh.geometry.addEventListener('dispose',()=>borrowedDisposed++);
authoredCrateArt.dispose();
assert.equal(borrowedDisposed,0,'combat disposal does not release borrowed arena crate geometry');

const glb = checkContract(artRoot, 'glb', true);
checkSilhouettes(glb, 'glb');
checkYaw(artRoot, 'glb');
checkAnimate(artRoot, 'glb', glb);
checkFullMatch(glb, 'glb');

/* GLB-specific part structure. */
{
  for (const n of ['PickupBody', 'PickupLid', 'PickupMetal', 'PickupGlyph', 'PickupBadge', 'PickupPad']) {
    assert.ok(glb.pickup.getObjectByName(n), `glb pickup part ${n}`);
  }
  const glyph = glb.pickup.getObjectByName('PickupGlyph');
  const gs = new THREE.Box3().setFromObject(glyph).getSize(new THREE.Vector3());
  assert.ok(gs.x > 0.4 && gs.y > 0.6, 'glb question mark is a legible mesh');
  assert.ok(glb.shots.pulse.getObjectByName('BoltPulseBody'), 'pulse uses BoltPulse variant');
  assert.ok(glb.shots.pulse.getObjectByName('BoltPulseTracer'), 'pulse tracer present');
  assert.ok(glb.shots.scatter.getObjectByName('BoltScatterBody'), 'scatter uses BoltScatter variant');
  assert.ok(glb.shots.rocket.getObjectByName('RocketShotFins'), 'rocket shot finned');
  assert.ok(glb.shots.pulse.getObjectByName('BoltPulse'), 'pulse keeps its branch');
  assert.ok(!glb.shots.pulse.getObjectByName('BoltScatter'), 'pulse drops the scatter branch');
  assert.ok(glb.shots.scatter.getObjectByName('BoltScatter'), 'scatter keeps its branch');
  assert.ok(!glb.shots.scatter.getObjectByName('BoltPulse'), 'scatter drops the pulse branch');
  assert.ok(!glb.shots.rocket.getObjectByName('BoltPulse') &&
    !glb.shots.rocket.getObjectByName('BoltScatter'), 'rocket is its own model');
  assert.equal(meshesOf(glb.shots.pulse).length, 3, 'pulse variant is 3 meshes, not the whole Bolt');
  assert.ok(glb.ownMine.getObjectByName('MineGlow'), 'mine prop keeps its glow');
  assert.ok(!glb.ownMine.getObjectByName('MineRack'), 'mine prop drops the rig rack');
  assert.ok(glb.rigs.mine.userData.combat.curated, 'mine rig keeps its rack');
  assert.ok(!glb.rigs.mine.getObjectByName('MineGlow'), 'mine rig drops the ground glow');
  assert.ok(glb.rigs.pulse.getObjectByName('PulseFins'), 'pulse rig twin fins');
  assert.ok(glb.rigs.scatter.getObjectByName('ScatterMuzzles'), 'scatter triple muzzles');
  assert.ok(glb.rigs.shield.getObjectByName('ShieldCore'), 'shield emitter core');
  assert.ok(glb.rigs.rocket.getObjectByName('RocketTrim'), 'rocket launcher trim');
  for (const kind of RIG_KINDS) {
    let tips = 0;
    glb.rigs[kind].traverse((o) => { if (o.name.endsWith('MuzzleTip')) tips += 1; });
    assert.equal(tips, 0, `${kind} clone prunes helper empties`);
  }
  // Muzzles calibrated from the GLB tips (float32 tolerance).
  const wantMuzzle = {
    pulse: [0, 0.3, 1.1], scatter: [0, 0.42, 0.9], mine: [0, 0, 0],
    shield: [0, 0.48, 0], rocket: [0, 0.65, 0.98],
  };
  for (const kind of RIG_KINDS) {
    const got = glb.rigs[kind].userData.combat.muzzle;
    const want = wantMuzzle[kind];
    assert.ok(Math.abs(got[0] - want[0]) < 1e-3 && Math.abs(got[1] - want[1]) < 1e-3 &&
      Math.abs(got[2] - want[2]) < 1e-3, `glb ${kind} muzzle calibrated`);
  }
}

/* GLB sharing: clones share root-owned geos/mats, overrides shared. */
{
  const a = artRoot.projectile('pulse');
  const b = artRoot.projectile('pulse');
  const ga = new Map(meshesOf(a).map((m) => [m.name, m.geometry]));
  for (const m of meshesOf(b)) {
    assert.equal(m.geometry, ga.get(m.name), `pulse clones share ${m.name} geometry`);
  }
  assert.equal(a.userData.combat.tail.material, b.userData.combat.tail.material,
    'tracer override shared across instances');
  assert.equal(a.getObjectByName('BoltPulseBody').material,
    b.getObjectByName('BoltPulseBody').material, 'GLB body material shared');
  const m1 = artRoot.mine(true);
  const m2 = artRoot.mine(true);
  assert.equal(m1.getObjectByName('MineCap').material, m2.getObjectByName('MineCap').material,
    'own-mine cap tint shared');
  const kinds = [artRoot.pickup(), ...SHOT_KINDS.map((k) => artRoot.projectile(k)),
    artRoot.mine(true), artRoot.mine(false), ...RIG_KINDS.map((k) => artRoot.weapon(k))];
  const before = poolOf(kinds);
  const extra = [];
  for (let i = 0; i < 60; i++) {
    extra.push(artRoot.pickup(), artRoot.projectile(SHOT_KINDS[i % SHOT_KINDS.length]),
      artRoot.mine(i % 2 === 0), artRoot.weapon(RIG_KINDS[i % RIG_KINDS.length]));
  }
  const after = poolOf([...kinds, ...extra]);
  assert.deepEqual(after.geos, before.geos, 'GLB churn adds no geometries');
  assert.deepEqual(after.mats, before.mats, 'GLB churn adds no materials');
}

/* Partial assets fall back per prop, never throw. */
{
  const none = createKartCombatArt(THREE, { assets: {} });
  assert.ok(none.pickup().getObjectByName('PickupCorners'), 'empty map falls back to procedural');
  assert.equal(meshesOf(none.projectile('rocket')).length, 3, 'missing model falls back');
  const onlyPickup = createKartCombatArt(THREE, { assets: { Pickup: libModels.Pickup } });
  assert.ok(onlyPickup.pickup().getObjectByName('PickupBadge'), 'present model uses GLB');
  assert.ok(onlyPickup.projectile('pulse').getObjectByName('PulseBody'), 'missing shot falls back');
  const noOpts = createKartCombatArt(THREE);
  assert.ok(noOpts.weapon('rocket').getObjectByName('RocketLauncher'), 'no opts falls back');
}

/* ---- fallback path: full contract without assets ---- */
const fb = createKartCombatArt(THREE);
const fbb = checkContract(fb, 'fallback', false);
checkSilhouettes(fbb, 'fallback');
checkYaw(fb, 'fallback');
checkAnimate(fb, 'fallback', fbb);
checkFullMatch(fbb, 'fallback');
{
  for (const n of ['PickupBody', 'PickupLid', 'PickupCorners', 'PickupRibbons', 'PickupGlyph', 'PickupPad']) {
    assert.ok(fbb.pickup.getObjectByName(n), `fallback pickup part ${n}`);
  }
  assert.ok(fbb.rigs.rocket.getObjectByName('RocketLauncher'), 'fallback rocket rig');
  assert.ok(fbb.shots.rocket.getObjectByName('RocketFins'), 'fallback rocket fins');
  const a = [fb.pickup(), fb.projectile('pulse'), fb.projectile('rocket'), fb.mine(true),
    fb.weapon('shield'), fb.weapon('rocket')];
  const bb = [fb.pickup(), fb.projectile('pulse'), fb.projectile('rocket'), fb.mine(true),
    fb.weapon('shield'), fb.weapon('rocket')];
  assert.deepEqual(poolOf(bb).geos, poolOf(a).geos, 'fallback geometries shared');
  assert.deepEqual(poolOf(bb).mats, poolOf(a).mats, 'fallback materials shared');
  assert.equal(a[0].getObjectByName('PickupCorners').material,
    a[3].getObjectByName('MineDisk').material, 'fallback shares one metal');
}

/* ---- thousands of props stay bounded ---- */
{
  const swarm = [];
  for (let i = 0; i < 500; i++) {
    swarm.push(artRoot.pickup(), artRoot.projectile(SHOT_KINDS[i % SHOT_KINDS.length]),
      artRoot.mine(i % 2 === 0), artRoot.weapon(RIG_KINDS[i % RIG_KINDS.length]));
    swarm.push(fb.pickup(), fb.projectile(SHOT_KINDS[(i + 1) % SHOT_KINDS.length]));
  }
  assert.equal(swarm.length, 3000, '3000 props churned');
  const pooled = poolOf(swarm);
  assert.ok(pooled.geos.size < 90, `bounded geometries, saw ${pooled.geos.size}`);
  assert.ok(pooled.mats.size < 60, `bounded materials, saw ${pooled.mats.size}`);
}

/* ---- dispose(): factory-owned exactly once, GLB library untouched ---- */
{
  const art = createKartCombatArt(THREE, { assets: library });
  const props = [art.pickup(), art.projectile('pulse'), art.projectile('scatter'),
    art.mine(true), art.mine(false), art.weapon('rocket'), art.weapon('mine')];
  const { geos, mats } = poolOf(props);
  const libPool = poolOf([library]);
  const factoryOwned = [...mats].filter((m) => !libPool.mats.has(m));
  const libMats = [...mats].filter((m) => libPool.mats.has(m));
  assert.ok(factoryOwned.length > 0, 'overrides identified as factory-owned');
  assert.ok(libMats.length > 0, 'GLB materials identified as root-owned');
  const warningGeometry=props[3].getObjectByName('MineWarningRing').geometry;
  assert.equal(props[4].getObjectByName('MineWarningRing').geometry,warningGeometry,'all Mine warnings share one factory-owned ring');
  assert.ok([...geos].some(g=>!libPool.geos.has(g)&&g!==warningGeometry),'new toy rigs own their shared merged geometry');
  const counts = new Map();
  for (const r of [...geos, ...mats]) {
    const orig = r.dispose.bind(r);
    counts.set(r, 0);
    r.dispose = () => { counts.set(r, counts.get(r) + 1); orig(); };
  }
  art.dispose();
  for (const m of factoryOwned) assert.equal(counts.get(m), 1, `${m.name} override disposed once`);
  for (const g of geos) assert.equal(counts.get(g), libPool.geos.has(g)?0:1, 'factory ring retires once; root-owned geometry stays alive');
  for (const m of libMats) assert.equal(counts.get(m), 0, 'root-owned material never disposed');
  art.dispose();
  for (const m of factoryOwned) assert.equal(counts.get(m), 1, 'second dispose is a no-op');
  const fresh = art.projectile('rocket');
  assert.ok(Number.isFinite(sizeOf(fresh).z), 'GLB props work after dispose');
  assert.ok(art.pickup().getObjectByName('PickupBadge'), 'GLB path survives dispose');
  assert.notEqual(art.mine(true).getObjectByName('MineWarningRing').geometry,warningGeometry,'a recreated factory rebuilds its retired warning resource');
  art.dispose();
}
{
  const art = createKartCombatArt(THREE);
  const all = [art.pickup(), art.projectile('pulse'), art.projectile('scatter'),
    art.mine(true), art.weapon('rocket'), art.weapon('shield')];
  const { geos, mats } = poolOf(all);
  assert.ok(geos.size > 10 && mats.size > 10, 'fallback pool covers every prop kind');
  const counts = new Map();
  for (const r of [...geos, ...mats]) {
    const orig = r.dispose.bind(r);
    counts.set(r, 0);
    r.dispose = () => { counts.set(r, counts.get(r) + 1); orig(); };
  }
  art.dispose();
  for (const [r, n] of counts) assert.equal(n, 1, `${r.name || r.type} disposed once`);
  art.dispose();
  for (const [r, n] of counts) assert.equal(n, 1, 'second dispose is a no-op');
  const fresh = art.projectile('scatter');
  assert.ok(Number.isFinite(sizeOf(fresh).z), 'fallback rebuilds after dispose');
  art.dispose();
}

// Classic shots originate at the chassis centre, two metres forward. The
// mounted muzzle must agree with that authority at every heading.
for (const assets of [library, null]) {
  const art=createKartCombatArt(THREE,{assets});
  for(const kind of ['pulse','scatter','rocket','seeker','proximity','nuke']) {
    const kart=new THREE.Group(),rig=art.weapon(kind);kart.add(rig);art.placeWeapon(rig,{x:0,y:.8,z:2});
    for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]) {
      kart.position.set(11,0,-5);kart.rotation.y=yaw;kart.updateMatrixWorld(true);
      const muzzle=rig.localToWorld(new THREE.Vector3(...rig.userData.combat.muzzle));
      const expected=kart.localToWorld(new THREE.Vector3(0,.8,2));assert.ok(muzzle.distanceTo(expected)<1e-5,'Classic '+kind+' muzzle is aligned with actual shot origin');
    }
  }
  art.dispose();
}
// Exercise the exact shipping lookup. Individual legacy combat.glb tests
// missed the y=0 MineTrap and the arsenal pack's dynamite BombShot.
const oldSelf=globalThis.self,oldImageBitmap=globalThis.createImageBitmap;
globalThis.self=globalThis;
globalThis.createImageBitmap=async blob=>{
  const bytes=Buffer.from(await blob.arrayBuffer());
  return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),close(){}};
};
const shipping={combat:library};
try {
  for(const [key,name]of Object.entries({pulse:'pulse-mounted.meshopt',arsenal:'arsenal-mounted.meshopt',secondary:'arsenal-secondary.meshopt'})) {
    const bytes=await readFile(new URL('../public/assets/karts/combat/'+name+'.glb',import.meta.url));
    shipping[key]=(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
  }
  const get=name=>shipping.pulse.getObjectByName(name)||shipping.arsenal.getObjectByName(name)||
    (name!=='ScatterShot'&&shipping.secondary.getObjectByName(name))||shipping.combat.getObjectByName(name);
  assert(get('MineTrap')&&get('BombShot'),'shipping lookup selects authored trap and dynamite charge');
  const exhaustArt=createKartCombatArt(THREE,{assets:{get}});
  for(const kind of ['rocket','seeker','nuke']){
    const shot=exhaustArt.projectile(kind),again=exhaustArt.projectile(kind),c=shot.userData.combat;
    assert(c.tail?.isMesh,kind+' shipped missile has readable tapered exhaust');
    assert(c.tail.position.z<0&&c.tail.material.toneMapped===false,kind+' exhaust is behind the unchanged solid nose and reads in arena lighting');
    assert.equal(c.tail.geometry,again.userData.combat.tail.geometry,kind+' exhaust geometry is pooled');
    assert.equal(c.tail.material,again.userData.combat.tail.material,kind+' exhaust material is pooled');
    assert(meshesOf(shot).length<=COMBAT_ART_BUDGETS.projectile,kind+' remains inside projectile mesh budget');
    const before=poolOf([shot,again]);for(let i=0;i<120;i++)exhaustArt.animate(shot,1/60,i/60,false);
    assert.deepEqual(poolOf([shot,again]),before,kind+' animation allocates no resources');
  }
  assert.notEqual(exhaustArt.projectile('rocket').userData.combat.tail.material.color.getHex(),exhaustArt.projectile('seeker').userData.combat.tail.material.color.getHex(),'rocket and seeker exhaust are visually distinct');
  exhaustArt.dispose();
  const sourceMineBounds=boundsOf(get('MineTrap')),sourceChargeBounds=boundsOf(get('BombShot'));
  const sourceMineVertices=meshesOf(get('MineTrap')).map(o=>Array.from(o.geometry.attributes.position.array));
  for(const [tag,assets]of [['shipping',{get}],['fallback',null]]) {
    const art=createKartCombatArt(THREE,{assets}),charge=art.projectile('proximity'),second=art.projectile('proximity');
    const mine=art.mine(true),foe=art.mine(false);
    for(const prop of [mine,foe]) {
      const box=boundsOf(prop);approx(box.min.y,0,1e-6,tag+' deployed mine has actual ground baseline');
      assert(box.max.y>.1,tag+' mine remains visible above its support');
    }
    const box=boundsOf(charge),c=charge.userData.combat;
    if(assets) {
      assert(charge.getObjectByName('BombShotDynamite'),'shipping proximity is the dynamite BombShot');
      assert.equal(c.tail?.name,'BombShotLamp','shipping proximity tail is the authored lamp');
      approx(box.max.z,c.tipZ,1e-6,tag+' charge tip metadata follows actual geometry');
      approx(box.min.z,c.tailZ,1e-6,tag+' charge tail metadata follows actual geometry');
    }
    assert.deepEqual(boundsOf(second),box,tag+' every pooled charge matches');
    const buffers=meshesOf(charge).map(o=>o.geometry.attributes.position.array);
    for(const reduced of [false,true])for(let i=0;i<180;i++) {
      art.animate(charge,1/60,i/60,reduced);art.animate(mine,1/60,i/60,reduced);
      approx(boundsOf(mine).min.y,0,1e-6,tag+' animated mine baseline stays on support');
    }
    const after=meshesOf(charge);for(let i=0;i<after.length;i++)assert.strictEqual(after[i].geometry.attributes.position.array,buffers[i],tag+' animation retains source buffer');
    if(assets) {
      assert.deepEqual(boundsOf(get('MineTrap')),sourceMineBounds,'factory never shifts source MineTrap');
      assert.deepEqual(boundsOf(get('BombShot')),sourceChargeBounds,'factory never scales source BombShot');
      assert.deepEqual(meshesOf(get('MineTrap')).map(o=>Array.from(o.geometry.attributes.position.array)),sourceMineVertices,'source trap vertices retained');
    }
    art.dispose();
  }
} finally {
  if(oldSelf===undefined)delete globalThis.self;else globalThis.self=oldSelf;
  if(oldImageBitmap===undefined)delete globalThis.createImageBitmap;else globalThis.createImageBitmap=oldImageBitmap;
  const resources=new Set();
  for(const key of ['pulse','arsenal','secondary'])shipping[key]?.traverse(o=>{
    if(o.geometry)resources.add(o.geometry);
    for(const m of Array.isArray(o.material)?o.material:[o.material])if(m){resources.add(m);if(m.map){resources.add(m.map);m.map.image?.close?.();}}
  });
  for(const resource of resources)resource.dispose();
}
// ---- second eight weapons: procedural props, same contract and budgets ----
{
  const { projectileContactInset } = await import('../public/js/engines/kart-combat-art.mjs');
  const { config: COMBAT } = (await import('../games/engines/kart-combat-config.js')).default;
  const art = createKartCombatArt(THREE);
  const vertexRadius = (object, axes) => {
    object.updateWorldMatrix(true, true);
    const inverse = new THREE.Matrix4().copy(object.matrixWorld).invert(), v = new THREE.Vector3();
    let max = 0;
    object.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
        max = Math.max(max, Math.hypot(...axes.map((a) => v[a])));
      }
    });
    return max;
  };
  for (const kind of ['laser',  'bouncer']) {
    const shot = art.projectile(kind), c = shot.userData.combat, radius = COMBAT.staticSweepRadii[kind]??({laser:.12,bouncer:.36}[kind]);
    assert.equal(c.type, 'projectile', kind + ' is a projectile'); assert.equal(c.kind, kind, kind + ' keeps its kind');
    assert(meshesOf(shot).length <= COMBAT_ART_BUDGETS.projectile, kind + ' projectile budget');
    assert(Number.isFinite(c.tipZ) && Number.isFinite(c.tailZ) && c.tipZ > c.tailZ, kind + ' tip/tail metadata');
    // Art never exceeds the authoritative sweep radius, through every spin pose.
    let widest = 0;
    for (let i = 0; i < 90; i++) { art.animate(shot, 1 / 60, i / 60, false); widest = Math.max(widest, vertexRadius(shot, ['x', 'y'])); }
    assert(widest <= radius, `${kind} art ${widest.toFixed(3)} fits its ${radius} sweep radius`);
    assert(Number.isFinite(projectileContactInset(THREE, shot, radius)), kind + ' calibrates its contact skin');
    assert(shot.getObjectByName('ShotGlow'), kind + ' reads from across the arena');
  }
  for (const kind of ['frost', 'cluster', 'bomblet']) {
    const body = art.projectile(kind);
    assert(meshesOf(body).length <= COMBAT_ART_BUDGETS.projectile, kind + ' body budget');
    for (let i = 0; i < 60; i++) art.animate(body, 1 / 60, i / 60, false);
    assert(vertexRadius(body, ['x', 'y', 'z']) <= .56, kind + ' stays inside its canister');
  }
  assert(vertexRadius(art.projectile('bomblet'), ['x', 'y', 'z']) < vertexRadius(art.projectile('cluster'), ['x', 'y', 'z']), 'bomblets are smaller than their canister');
  for (const kind of ['laser',    'frost', 'cluster', 'bouncer', 'ram']) {
    const rig = art.weapon(kind), c = rig.userData.combat;
    assert.equal(c.kind, kind, kind + ' rig keeps its kind');
    assert(meshesOf(rig).length <= COMBAT_ART_BUDGETS.weapon, kind + ' rig budget');
    assert(c.mount.every(Number.isFinite) && c.muzzle.every(Number.isFinite) && c.trim, kind + ' rig mount, muzzle and trim');
    const before = poolOf([rig]);
    for (const reduced of [false, true]) for (let i = 0; i < 60; i++) art.animate(rig, 1 / 60, i / 60, reduced);
    assert.deepEqual(poolOf([rig]), before, kind + ' rig animation allocates nothing');
    art.recoil(rig); art.placeWeapon(rig);
  }
  // Every new prop is distinct: no two rigs share a silhouette name.
  assert.equal(new Set(['laser',    'frost', 'cluster', 'bouncer', 'ram'].map((k) => art.weapon(k).name)).size, 5, 'five retained secondary rigs');
  art.dispose(); art.dispose();
  const again = art.projectile('laser'); assert(meshesOf(again).length > 0, 'factory rebuilds after dispose');
  art.dispose();
  console.log('kart-combat-art: second eight weapons fit their sweeps, budgets and trap baseline');
}
console.log('kart-combat-art: all contract + GLB checks passed');
