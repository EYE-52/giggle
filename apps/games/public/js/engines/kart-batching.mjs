/* Batch the static chassis by material once per asset library. Wheels keep
 * their authored pivots; driver clones share the resulting geometry. */
export function batchKartBody(THREE, template, mergeGeometries) {
  const body=template.getObjectByName('KartBody');
  if(!body)return;
  template.updateMatrixWorld(true);
  const inverse=new THREE.Matrix4().copy(body.matrixWorld).invert();
  const groups=new Map();
  body.traverse(mesh=>{
    if(!mesh.isMesh || Array.isArray(mesh.material))return;
    const transform=new THREE.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld);
    const geo=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();
    geo.applyMatrix4(transform);
    if(!groups.has(mesh.material))groups.set(mesh.material,[]);
    groups.get(mesh.material).push(geo);
  });
  if(!groups.size)return;
  const merged=[];
  for(const [material,geos] of groups){
    const geometry=mergeGeometries(geos,false);
    geos.forEach(g=>g.dispose());
    if(!geometry){merged.forEach(m=>m.geometry.dispose());return;}
    const mesh=new THREE.Mesh(geometry,material);mesh.name='KartBody_'+material.name;
    merged.push(mesh);
  }
  // Keep old resources attached but invisible for scene-lifetime disposal.
  const originals=new THREE.Group();originals.name='OriginalKartBody';originals.visible=false;
  for(const child of [...body.children])originals.add(child);
  body.add(originals,...merged);
}
