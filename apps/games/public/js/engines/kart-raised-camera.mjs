// Broad phase before Three's exact triangle queries. Static camera envelopes
// are cached once; a close wall ray should not visit 76 complete meshes.
export function createRaisedCameraQuery(THREE,meshes){
  const records=meshes.map(mesh=>{mesh.updateWorldMatrix(true,false);mesh.geometry.computeBoundingBox();return{mesh,box:mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld)};}),candidates=[],point=new THREE.Vector3();
  let queries=0,tested=0;
  return{intersect(ray,hits){queries++;candidates.length=0;const limit=ray.far*ray.far;
    for(const r of records){if(!r.box.containsPoint(ray.ray.origin)&&(!ray.ray.intersectBox(r.box,point)||point.distanceToSquared(ray.ray.origin)>limit+1e-5))continue;candidates.push(r.mesh);}
    tested+=candidates.length;return ray.intersectObjects(candidates,false,hits);
  },stats:()=>({queries,candidates:tested,fullCandidates:queries*meshes.length})};
}
