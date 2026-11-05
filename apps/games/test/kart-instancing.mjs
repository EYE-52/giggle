// instanceRepeats: repeated static scenery collapses to one instanced draw
// per geometry/material, keeping transforms; skipped, transparent and rare
// meshes keep their own draws.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { instanceRepeats } from '../public/js/engines/kart-instancing.mjs';

const root = new THREE.Group();
root.position.set(5, 0, -3);
const geo = new THREE.BoxGeometry(1, 1, 1), mat = new THREE.MeshStandardMaterial();
const flags = [];
for (let i = 0; i < 4; i++) {
  const holder = new THREE.Group(); holder.position.set(i * 3, 0, 0); holder.rotation.y = i;
  const m = new THREE.Mesh(geo, mat); m.position.y = 2; m.castShadow = true; m.name = 'flag';
  holder.add(m); root.add(holder); flags.push(m);
}
const glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: .5 });
for (let i = 0; i < 3; i++) root.add(new THREE.Mesh(geo, glass));
const moving = new THREE.Group(); root.add(moving);
for (let i = 0; i < 3; i++) moving.add(new THREE.Mesh(geo, mat));
root.add(new THREE.Mesh(new THREE.SphereGeometry(), mat), new THREE.Mesh(new THREE.SphereGeometry(), mat));

root.updateMatrixWorld(true);
const before = flags.map(f => f.matrixWorld.clone());
const made = instanceRepeats(THREE, root, { skip: new Set([moving]) });
assert.equal(made.length, 1, 'only the opaque, unskipped repeat set is instanced');
const inst = made[0].mesh;
assert.equal(inst.count, 4);
assert.equal(inst.castShadow, true, 'shadow casting carries over');
assert.ok(flags.every(f => !f.visible), 'originals hidden, still in the tree for lookups and disposal');
assert.ok(moving.children.every(m => m.visible), 'skipped subtrees keep their own draws');
root.updateMatrixWorld(true);
const m = new THREE.Matrix4();
for (let i = 0; i < 4; i++) {
  inst.getMatrixAt(i, m);
  const world = new THREE.Matrix4().multiplyMatrices(inst.matrixWorld, m);
  world.elements.forEach((v, k) => assert.ok(Math.abs(v - before[i].elements[k]) < 1e-5, `instance ${i} keeps its world transform (float32 storage)`));
}
assert.equal(instanceRepeats(THREE, root, { skip: new Set([moving]) }).length, 0, 'a second pass finds nothing new to merge');
console.log('KART_INSTANCING_PASS: shared geometry/material sets, transforms, shadows, skips, transparency, idempotence');
