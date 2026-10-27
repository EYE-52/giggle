'use strict';
/* Contract checks for public/js/engines/kart-model.mjs:
 * - template never mutated; pivots resolved by the Blender-authored names
 * - KartPaint is the ONLY recolored/cloned material; geometries and all
 *   other materials stay shared across kart instances
 * - animate() never touches root yaw; wheel spin +x = forward roll
 * - dispose() releases owned paint clones only, never shared resources
 * - the real GLBs still carry the node/material names the module needs
 * Run: node test/kart-model.js (no GPU; pure Three.js object graph). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let THREE;

const ROOT = path.join(__dirname, '..');

function readGlbJson(file) {
  const data = fs.readFileSync(file);
  assert.equal(data.readUInt32LE(0), 0x46546C67, `not a GLB: ${file}`);
  assert.equal(data.readUInt32LE(4), 2, `not glTF 2: ${file}`);
  let off = 12;
  while (off + 8 <= data.length) {
    const length = data.readUInt32LE(off);
    const type = data.readUInt32LE(off + 4);
    if (type === 0x4E4F534A) {
      return JSON.parse(data.subarray(off + 8, off + 8 + length).toString('utf8'));
    }
    off += 8 + length;
  }
  throw new Error(`no JSON chunk: ${file}`);
}

function fakeKartTemplate() {
  // Mirrors the Blender hierarchy/names (see vehicle-stats.json) with tiny
  // stand-in geometry; lets the module run without a GLB loader.
  const template = new THREE.Group();
  template.name = 'KartRoot';
  const paint = new THREE.MeshStandardMaterial({ color: 0xe8436b });
  paint.name = 'KartPaint';
  const trim = new THREE.MeshStandardMaterial({ color: 0x2f3542 });
  trim.name = 'DarkTrim';
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const body = new THREE.Group();
  body.name = 'KartBody';
  body.add(new THREE.Mesh(geo, paint));
  body.add(new THREE.Mesh(geo, [trim, paint]));
  template.add(body);
  for (const key of ['FL', 'FR', 'RL', 'RR']) {
    const spin = new THREE.Group();
    spin.name = `WheelSpin_${key}`;
    spin.add(new THREE.Mesh(geo, trim));
    template.add(spin);
  }
  // Front spins hang under steer pivots, as in the GLB.
  for (const side of ['L', 'R']) {
    const steer = new THREE.Group();
    steer.name = `FrontSteer_${side}`;
    template.add(steer);
    const key = side === 'L' ? 'FL' : 'FR';
    steer.add(template.getObjectByName(`WheelSpin_${key}`));
  }
  return { template, paint, trim, geo };
}

async function main() {
  THREE = await import('three');
  const model = await import('../public/js/engines/kart-model.mjs');
  const { createKartModel, animateKartModel, disposeKartModel, createStarModel, createCrateModel } = model;

  // -- create: paint-only recolor, everything else shared ----------------
  const a = fakeKartTemplate();
  const k1 = createKartModel(THREE, { assets: { kart: a.template }, color: 0xff0000, number: 1 });
  const k2 = createKartModel(THREE, { assets: { kart: a.template }, color: 0x0000ff, number: 2 });
  assert.equal(k1.name, 'GiggleKart');
  assert.equal(k1.userData.kart.number, 1);
  assert.equal(k2.userData.kart.number, 2);

  const paints1 = k1.userData.kart.paint;
  const paints2 = k2.userData.kart.paint;
  assert.ok(paints1.length > 0, 'kart resolves KartPaint meshes');
  assert.equal(paints1.length, paints2.length);
  for (const m of paints1) assert.equal(m.color.getHex(), 0xff0000);
  for (const m of paints2) assert.equal(m.color.getHex(), 0x0000ff);
  assert.notEqual(paints1[0], paints2[0], 'paint cloned per kart');
  assert.notEqual(paints1[0], a.paint, 'template paint never handed out');
  assert.equal(a.paint.color.getHex(), 0xe8436b, 'template paint color untouched');

  // Geometries and non-paint materials stay shared with the template.
  const meshes1 = [];
  k1.userData.kart.inner.traverse((o) => { if (o.isMesh && o.name !== 'BoostFlame' && o.name !== 'RespawnShield' && o.name !== 'InvincibilityTrail') meshes1.push(o); });
  assert.ok(meshes1.length > 0);
  for (const m of meshes1) assert.equal(m.geometry, a.geo, 'geometry shared');
  const trimMesh = meshes1.find((m) => Array.isArray(m.material));
  assert.equal(trimMesh.material[0], a.trim, 'non-paint material shared');
  assert.equal(trimMesh.material[1], paints1[0], 'array paint slot recolored');

  // Pivots resolved from the real node names.
  assert.equal(k1.userData.kart.wheels.length, 4, 'four wheel pivots');
  assert.equal(k1.userData.kart.steers.length, 2, 'two steer pivots');
  assert.ok(k1.userData.kart.body, 'KartBody lean node');
  assert.ok(k1.userData.flame && k1.userData.shield, 'flame/shield handles');
  assert.equal(k1.userData.flame.visible, false);
  assert.equal(k1.userData.shield.visible, false);
  assert.equal(k1.userData.flame.geometry, k2.userData.flame.geometry, 'flame geo shared');
  assert.equal(k1.userData.flame.material, k2.userData.flame.material, 'flame mat shared');
  assert.equal(k1.userData.shield.geometry, k2.userData.shield.geometry, 'shield geo shared');
  assert.equal(k1.userData.shield.material, k2.userData.shield.material, 'shield mat shared');

  // Shadows: opaque meshes cast, transparent cosmetics do not.
  for (const m of meshes1) assert.equal(m.castShadow, true, `${m.name || 'mesh'} casts`);
  assert.equal(k1.userData.flame.castShadow, false);
  assert.equal(k1.userData.shield.castShadow, false);

  const paint=k1.userData.kart.paint[0];
  const originalEmission=paint.emissive.clone(),originalIntensity=paint.emissiveIntensity;
  animateKartModel(k1,{invincible:true,shield:false,dt:1/60});
  assert.equal(k1.userData.shield.visible,false,'Activated invincibility never shows respawn bubble');
  assert.equal(paint.emissiveIntensity,.55,'Invincibility uses bounded model-owned emission');
  assert.notDeepEqual(paint.emissive.toArray(),originalEmission.toArray(),'Invincibility is visible on body material');
  animateKartModel(k1,{invincible:false,shield:true,dt:1/60});
  assert.deepEqual(paint.emissive.toArray(),originalEmission.toArray(),'Retired invincibility restores authored emission');
  assert.equal(paint.emissiveIntensity,originalIntensity,'Retired invincibility restores intensity');
  assert.equal(k1.userData.shield.visible,true,'Independent spawn protection remains visible');
  const trail=k2.userData.kart.invincibilityTrails[0];
  assert.equal(trail.geometry,k1.userData.kart.invincibilityTrails[0].geometry,'Invincibility trail geometry stays pooled across drivers');
  assert.equal(trail.material,k1.userData.kart.invincibilityTrails[0].material,'Trail material stays pooled');
  animateKartModel(k2,{invincible:true,speed:20,dt:1/60});
  assert.equal(trail.visible,true,'Moving invincible kart leaves a bounded edge trail');
  assert.ok(trail.scale.z<=1.3,'Trail cannot grow across the playfield');
  animateKartModel(k2,{invincible:true,speed:20,reducedMotion:true,dt:1/60});
  assert.equal(trail.visible,false,'Reduced motion suppresses trail motion while body emission remains');
  animateKartModel(k2,{invincible:false,speed:20,dt:1/60});
  assert.equal(trail.visible,false,'Retirement clears the trail');

  // -- animate: spin/steer/lean, root yaw never mutated ------------------
  const wheels = k1.userData.kart.wheels;
  animateKartModel(k1, { speed: 10, steer: 0, dt: 0.05 });
  for (const w of wheels) {
    assert.ok(Math.abs(w.node.rotation.x - (10 / w.radius) * 0.05) < 1e-9,
      `${w.key} rolls +x forward, got ${w.node.rotation.x}`);
  }
  for (let i = 0; i < 60; i++) {
    animateKartModel(k1, { speed: 10, steer: 1, boost: true, shield: true, dt: 1 / 60 });
  }
  const steers = k1.userData.kart.steers;
  for (const s of steers) {
    assert.ok(Math.abs(s.rotation.y - -0.45) < 0.01, `full lock -0.45, got ${s.rotation.y}`);
  }
  assert.notEqual(k1.userData.kart.body.rotation.z, 0, 'chassis leans on child');
  assert.equal(k1.rotation.x, 0);
  assert.equal(k1.rotation.y, 0, 'root yaw untouched');
  assert.equal(k1.rotation.z, 0);
  assert.equal(k1.userData.flame.visible, true, 'boost shows flame');
  assert.equal(k1.userData.shield.visible, true, 'shield shows bubble');
  animateKartModel(k1, { speed: 10, steer: 1, boost: false, shield: false, dt: 1 / 60 });
  assert.equal(k1.userData.flame.visible, false);
  assert.equal(k1.userData.shield.visible, false);

  // Reduced motion: no lean, no flicker/pulse, smoothing snapped.
  animateKartModel(k1, { speed: 10, steer: 1, boost: true, shield: true, dt: 1 / 60, reducedMotion: true });
  assert.equal(k1.userData.kart.body.rotation.x, 0);
  assert.equal(k1.userData.kart.body.rotation.z, 0);
  assert.equal(k1.userData.kart.steerSmooth, 1, 'steer snaps under reduced motion');
  const fs = k1.userData.flame.scale;
  animateKartModel(k1, { speed: 10, steer: 1, boost: true, dt: 1 / 60, reducedMotion: true });
  assert.equal(k1.userData.flame.scale.x, fs.x, 'flame static under reduced motion');

  // Missing template degrades to an empty group (root owns async fallback).
  const empty = createKartModel(THREE, { assets: {} });
  assert.equal(empty.userData.missing, 'kart');
  animateKartModel(empty, { speed: 5, dt: 0.1 });

  // -- dispose: owned paint only, shared resources preserved ------------
  const paintCount = paints1.length;
  assert.equal(paintCount, 1, 'one clone per unique paint source, shared by meshes');
  let disposed = 0;
  for (const m of paints1) {
    const orig = m.dispose.bind(m);
    m.dispose = () => { disposed++; orig(); };
  }
  disposeKartModel(k1);
  assert.equal(disposed, paintCount, 'owned paint clones disposed');
  assert.equal(k1.userData.kart.ownedMaterials.length, 0);
  assert.equal(k1.userData.kart.paint.length, 0);
  assert.equal(k2.userData.kart.paint.length, paints2.length, 'other kart untouched');
  disposeKartModel(empty);

  // -- star/crate pickups share template resources ----------------------
  const starGeo = new THREE.OctahedronGeometry(0.5);
  const starMat = new THREE.MeshStandardMaterial({ color: 0xf5a623 });
  const starTemplate = new THREE.Group();
  starTemplate.add(new THREE.Mesh(starGeo, starMat));
  const star = createStarModel(THREE, { star: starTemplate });
  assert.equal(star.name, 'GiggleStar');
  const starMesh = star.children[0].children[0];
  assert.equal(starMesh.geometry, starGeo, 'star geo shared');
  assert.equal(starMesh.material, starMat, 'star mat shared');
  assert.equal(starMesh.castShadow, true);

  const crateGeo = new THREE.BoxGeometry(1, 1, 1);
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x00d2d3 });
  const crateTemplate = new THREE.Group();
  crateTemplate.add(new THREE.Mesh(crateGeo, crateMat));
  const crate = createCrateModel(THREE, { crate: crateTemplate });
  assert.equal(crate.name, 'GiggleCrate');
  const crateMesh = crate.children[0].children[0];
  assert.equal(crateMesh.geometry, crateGeo, 'crate geo shared');
  assert.equal(crateMesh.material, crateMat, 'crate mat shared');
  assert.equal(createStarModel(THREE, {}).userData.missing, 'star');
  assert.equal(createCrateModel(THREE, {}).userData.missing, 'crate');

  // -- real GLBs carry the names/materials the module depends on ---------
  const kartJs = readGlbJson(path.join(ROOT, 'public/assets/karts/giggle-kart.meshopt.glb'));
  const kartNodes = new Set(kartJs.nodes.map((n) => n.name));
  for (const n of ['KartRoot', 'KartBody', 'FrontSteer_L', 'FrontSteer_R',
    'WheelSpin_FL', 'WheelSpin_FR', 'WheelSpin_RL', 'WheelSpin_RR',
    'WheelMesh_FL', 'WheelMesh_FR', 'WheelMesh_RL', 'WheelMesh_RR']) {
    assert.ok(kartNodes.has(n), `kart GLB keeps node ${n}`);
  }
  const kartMats = new Set(kartJs.materials.map((m) => m.name));
  assert.ok(kartMats.has('KartPaint'), 'kart GLB keeps KartPaint');
  assert.ok(kartJs.materials.length < 12, 'kart GLB material budget');

  const starJs = readGlbJson(path.join(ROOT, 'public/assets/karts/giggle-star.glb'));
  assert.ok(starJs.nodes.some((n) => n.name === 'GiggleStar'), 'star GLB keeps GiggleStar');

  const crateJs = readGlbJson(path.join(ROOT, 'public/assets/karts/giggle-crate.meshopt.glb'));
  const crateNodes = new Set(crateJs.nodes.map((n) => n.name));
  for (const n of ['CrateRoot', 'CrateBody', 'CrateQuestion', 'CrateTrim']) {
    assert.ok(crateNodes.has(n), `crate GLB keeps node ${n}`);
  }
  // Crate bottom sits at y=0: min over POSITION accessor minima (identity
  // node transforms in this asset, verified by vehicle-stats.json).
  let crateMinY = Infinity;
  for (const mesh of crateJs.meshes) {
    for (const prim of mesh.primitives) {
      const acc = crateJs.accessors[prim.attributes.POSITION];
      crateMinY = Math.min(crateMinY, acc.min[1]);
    }
  }
  assert.ok(Math.abs(crateMinY) < 0.03, `crate bottom y0, got ${crateMinY}`);

  console.log('kart-model: all contract checks passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
