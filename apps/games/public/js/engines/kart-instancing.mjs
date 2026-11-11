import {mergeGeometries} from '../../vendor/three/utils/BufferGeometryUtils.js';

/* Draw repeated static scenery as one InstancedMesh per geometry/material
 * pair. Cloned props (flags, tyres, posts) share both, so N copies cost one
 * draw (plus one shadow draw) instead of N. Skipped subtrees, transparent or
 * multi-material meshes, skinned/morphed or mirrored meshes and anything
 * with a render hook keep their own draws. Originals stay in the tree, hidden, so lookups
 * by name and scene disposal behave as before. */
export function instanceRepeats(THREE, root, { skip = new Set(), minCount = 3 } = {}) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const visit = (obj, hidden) => {
    if (skip.has(obj) || obj.userData.dynamic) return;
    const off = hidden || !obj.visible;
    if (obj.isMesh && !off && !obj.isInstancedMesh && !obj.isSkinnedMesh && !Array.isArray(obj.material) &&
        obj.material && !obj.material.transparent && !obj.morphTargetInfluences && !obj.userData.dynamic &&
        obj.onBeforeRender === THREE.Mesh.prototype.onBeforeRender &&
        obj.onAfterRender === THREE.Mesh.prototype.onAfterRender &&
        // Mirrored copies flip winding per object, which instances cannot do.
        obj.matrixWorld.determinant() > 0) {
      const key = obj.geometry.uuid + '|' + obj.material.uuid + '|' + obj.castShadow + '|' + obj.receiveShadow + '|' + obj.renderOrder + '|' + obj.layers.mask;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(obj);
    }
    for (const child of obj.children) visit(child, off);
  };
  visit(root, false);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const local = new THREE.Matrix4();
  const made = [];
  for (const meshes of groups.values()) {
    if (meshes.length < minCount) continue;
    const first = meshes[0];
    const inst = new THREE.InstancedMesh(first.geometry, first.material, meshes.length);
    inst.name = (first.name || first.parent?.name || 'scenery') + ':instanced';
    inst.castShadow = first.castShadow;
    inst.receiveShadow = first.receiveShadow;
    inst.renderOrder = first.renderOrder;
    inst.layers.mask = first.layers.mask;
    meshes.forEach((mesh, i) => {
      inst.setMatrixAt(i, local.multiplyMatrices(inverse, mesh.matrixWorld));
      // Hiding only this body must not hide a unique roof, window or sign.
      // Keep descendants under an equivalent static transform beside it.
      if(mesh.children.length){
        const parts=new THREE.Group();parts.name=mesh.name+':parts';
        parts.matrix.copy(mesh.matrix);parts.matrixAutoUpdate=false;
        mesh.parent.add(parts);
        for(const child of [...mesh.children])parts.add(child);
      }
      mesh.visible = false;
      mesh.matrixAutoUpdate = false; // The instance now owns its baked local transform.
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    root.add(inst);
    made.push({ mesh: inst, count: meshes.length });
  }
  return made;
}

// After instancing repeats, combine the remaining opaque static pieces by
// material. Bake into root space; keep the source nodes for named lookups
// and scene-lifetime disposal. Callers must skip moving/toggled subtrees.
export function mergeStaticMeshes(THREE, root, {skip = new Set()} = {}) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const visit = obj => {
    if (skip.has(obj) || !obj.visible || obj.userData.dynamic) return;
    const g = obj.geometry, m = obj.material;
    if (obj.isMesh && !obj.isInstancedMesh && !obj.isSkinnedMesh && !obj.children.length && m && !Array.isArray(m) &&
        !m.transparent && !obj.morphTargetInfluences && !Object.keys(g.morphAttributes).length &&
        Object.values(g.attributes).every(a => !a.isInterleavedBufferAttribute && !a.isInstancedBufferAttribute) &&
        g.drawRange.start === 0 && g.drawRange.count === Infinity &&
        obj.onBeforeRender === THREE.Mesh.prototype.onBeforeRender &&
        obj.onAfterRender === THREE.Mesh.prototype.onAfterRender &&
        m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile && obj.matrixWorld.determinant() > 0) {
      // Attribute layouts must agree; never strip UVs, colours or normals.
      const attrs = Object.keys(g.attributes).sort().map(k => {
        const a = g.attributes[k];
        return [k, a.itemSize, a.normalized, a.array.constructor.name, a.gpuType].join(':');
      }).join('|');
      const key = [m.uuid, obj.castShadow, obj.receiveShadow, obj.renderOrder, obj.layers.mask, attrs].join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(obj);
    }
    for (const child of obj.children) visit(child);
  };
  visit(root);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert(), transform = new THREE.Matrix4(), made = [];
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    // Keep indexed vertex reuse when the whole set supports it.
    const indexed = meshes.every(mesh => mesh.geometry.index);
    const geometries = meshes.map(mesh => {
      const geometry = !indexed && mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      return geometry.applyMatrix4(transform.multiplyMatrices(inverse, mesh.matrixWorld));
    });
    const geometry = mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();
    if (!geometry) continue;
    const first = meshes[0], mesh = new THREE.Mesh(geometry, first.material);
    mesh.name = (first.name || first.parent?.name || 'scenery') + ':merged';
    mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder; mesh.layers.mask = first.layers.mask;
    geometry.computeBoundingSphere();
    for (const source of meshes) {
      source.visible = false;
      source.matrixAutoUpdate = false;
    }
    root.add(mesh); made.push({mesh, count: meshes.length});
  }
  return made;
}
