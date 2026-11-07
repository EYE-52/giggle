// instanceRepeats: repeated static scenery collapses to one instanced draw
// per geometry/material, keeping transforms; skipped, transparent and rare
// meshes keep their own draws.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { instanceRepeats, mergeStaticMeshes } from '../public/js/engines/kart-instancing.mjs';

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
const mirrorGeo = new THREE.ConeGeometry();
for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(mirrorGeo, mat); m.scale.x = -1; root.add(m); }

root.updateMatrixWorld(true);
const before = flags.map(f => f.matrixWorld.clone());
const made = instanceRepeats(THREE, root, { skip: new Set([moving]) });
assert.equal(made.length, 1, 'only the opaque, unskipped, unmirrored repeat set is instanced');
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

// Different geometry can share a draw without losing transformed positions,
// normals, UVs, material identity, layers, render order or shadow settings.
const scenery=new THREE.Group();scenery.position.set(5,2,-3);scenery.rotation.y=.4;scenery.scale.set(1.3,.8,1.1);
const sources=[];
for(let i=0;i<3;i++){
  const holder=new THREE.Group();holder.position.set(i*4,1,-i);holder.rotation.z=i*.2;scenery.add(holder);
  const geometry=i===1?new THREE.SphereGeometry(1,8,6).toNonIndexed():new THREE.BoxGeometry(1,2,3);
  const mesh=new THREE.Mesh(geometry,mat);mesh.position.y=2;mesh.rotation.set(.2,.3*i,.1);mesh.scale.set(1+i,.7,1.2);
  mesh.castShadow=mesh.receiveShadow=true;mesh.renderOrder=2;mesh.layers.set(3);holder.add(mesh);sources.push(mesh);
}
const excluded=[];
for(const flag of ['castShadow','receiveShadow','renderOrder','layers']){
  const mesh=sources[0].clone();
  if(flag==='layers')mesh.layers.set(2);else mesh[flag]=flag==='renderOrder'?1:false;
  scenery.add(mesh);excluded.push(mesh);
}
const animated=new THREE.Group();animated.add(new THREE.Mesh(geo,mat),new THREE.Mesh(geo,mat));scenery.add(animated);
for(let i=0;i<2;i++){
  const transparent=new THREE.Mesh(geo,glass);scenery.add(transparent);excluded.push(transparent);
  const mirrored=new THREE.Mesh(geo,mat);mirrored.scale.x=-1;scenery.add(mirrored);excluded.push(mirrored);
  const dynamic=new THREE.Mesh(geo,mat);dynamic.userData.dynamic=true;scenery.add(dynamic);excluded.push(dynamic);
  const partial=new THREE.Mesh(geo.clone(),mat);partial.geometry.setDrawRange(3,6);scenery.add(partial);excluded.push(partial);
  const hooked=new THREE.Mesh(geo,mat);hooked.onBeforeRender=()=>{};scenery.add(hooked);excluded.push(hooked);
}
scenery.updateMatrixWorld(true);
const worldMatrices=sources.map(mesh=>mesh.matrixWorld.clone());
const merged=mergeStaticMeshes(THREE,scenery,{skip:new Set([animated])});
assert.equal(merged.length,1,'only compatible opaque static meshes merge');
const batch=merged[0].mesh;
assert.equal(batch.material,mat,'original material including textures stays shared');
assert(batch.castShadow&&batch.receiveShadow,'both shadow flags survive');
assert.equal(batch.renderOrder,2);assert.equal(batch.layers.mask,sources[0].layers.mask);
assert(sources.every(mesh=>!mesh.visible)&&excluded.every(mesh=>mesh.visible),'sources hide; excluded objects retain their draws');
assert(animated.children.every(mesh=>mesh.visible),'animated subtree remains independent');
scenery.updateMatrixWorld(true);
let vertex=0;
const expected=new THREE.Vector3(),actual=new THREE.Vector3();
for(let s=0;s<sources.length;s++){
  const geometry=sources[s].geometry,position=geometry.attributes.position,index=geometry.index;
  const expectedNormal=new THREE.Matrix3().getNormalMatrix(worldMatrices[s]),actualNormal=new THREE.Matrix3().getNormalMatrix(batch.matrixWorld);
  for(let i=0;i<(index?.count??position.count);i++,vertex++){
    const at=index?index.getX(i):i;
    expected.fromBufferAttribute(position,at).applyMatrix4(worldMatrices[s]);
    actual.fromBufferAttribute(batch.geometry.attributes.position,vertex).applyMatrix4(batch.matrixWorld);
    assert(expected.distanceTo(actual)<1e-5,'every drawn vertex retains its world position');
    expected.fromBufferAttribute(geometry.attributes.normal,at).applyNormalMatrix(expectedNormal);
    actual.fromBufferAttribute(batch.geometry.attributes.normal,vertex).applyNormalMatrix(actualNormal);
    assert(expected.distanceTo(actual)<1e-5,'every drawn normal retains its lighting direction');
    for(const axis of ['getX','getY'])assert.equal(batch.geometry.attributes.uv[axis](vertex),geometry.attributes.uv[axis](at),'UVs remain exact');
  }
}
assert.equal(batch.geometry.attributes.position.count,vertex,'no triangle is added or removed');
assert.equal(mergeStaticMeshes(THREE,scenery,{skip:new Set([animated])}).length,0,'merging is idempotent');
const indexedRoot=new THREE.Group(),indexedSources=[new THREE.BoxGeometry(),new THREE.SphereGeometry(1,8,6)];
for(const geometry of indexedSources)indexedRoot.add(new THREE.Mesh(geometry,mat));
const indexedBatch=mergeStaticMeshes(THREE,indexedRoot)[0].mesh.geometry;
assert.equal(indexedBatch.index.count,indexedSources.reduce((n,g)=>n+g.index.count,0),'all indexed triangles survive');
assert.equal(indexedBatch.attributes.position.count,indexedSources.reduce((n,g)=>n+g.attributes.position.count,0),'indexed batches retain vertex reuse');
console.log('KART_STATIC_MERGE_PASS: exact triangles/UVs, transformed normals/positions, material, shadows, layers, skips');
