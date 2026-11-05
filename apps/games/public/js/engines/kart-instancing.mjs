/* Draw repeated static scenery as one InstancedMesh per geometry/material
 * pair. Cloned props (flags, tyres, posts) share both, so N copies cost one
 * draw (plus one shadow draw) instead of N. Skipped subtrees, transparent or
 * multi-material meshes, skinned/morphed meshes and anything with a render
 * hook keep their own draws. Originals stay in the tree, hidden, so lookups
 * by name and scene disposal behave as before. */
export function instanceRepeats(THREE, root, { skip = new Set(), minCount = 3 } = {}) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const visit = (obj, hidden) => {
    if (skip.has(obj)) return;
    const off = hidden || !obj.visible;
    if (obj.isMesh && !off && !obj.isInstancedMesh && !obj.isSkinnedMesh && !Array.isArray(obj.material) &&
        obj.material && !obj.material.transparent && !obj.morphTargetInfluences && !obj.userData.dynamic &&
        obj.onBeforeRender === THREE.Mesh.prototype.onBeforeRender) {
      const key = obj.geometry.uuid + '|' + obj.material.uuid + '|' + obj.castShadow + '|' + obj.receiveShadow + '|' + obj.renderOrder;
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
    meshes.forEach((mesh, i) => {
      inst.setMatrixAt(i, local.multiplyMatrices(inverse, mesh.matrixWorld));
      mesh.visible = false;
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    root.add(inst);
    made.push({ mesh: inst, count: meshes.length });
  }
  return made;
}
