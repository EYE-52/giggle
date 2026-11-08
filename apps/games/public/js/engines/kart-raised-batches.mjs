import {mergeGeometries} from '../../vendor/three/utils/BufferGeometryUtils.js';
// Bake static detail instances by material into two coarse east/west chunks.
// Keep hidden sources for authored-part inspection and scene-owned cleanup.
export function mergeRaisedDetails(THREE,parent,ownGeometry){
  parent.updateWorldMatrix(true,true);const buckets=new Map(),matrix=new THREE.Matrix4(),inverse=parent.matrixWorld.clone().invert(),transform=new THREE.Matrix4(),center=new THREE.Vector3(),sources=[];
  parent.traverseVisible(o=>{if(o.isInstancedMesh&&!Array.isArray(o.material)&&!o.material.transparent&&!o.material.isShaderMaterial)sources.push(o);});
  for(const source of sources){
    transform.multiplyMatrices(inverse,source.matrixWorld);
    for(let i=0;i<source.count;i++){
      source.getMatrixAt(i,matrix);matrix.premultiply(transform);center.setFromMatrixPosition(matrix);
      const key=source.material.uuid+':'+Math.floor(center.x/128);let b=buckets.get(key);
      if(!b){b={material:source.material,geometries:[],tags:new Set(),count:0,essential:false};buckets.set(key,b);}
      const g=source.geometry.index?source.geometry.toNonIndexed():source.geometry.clone();g.applyMatrix4(matrix);b.geometries.push(g);b.count++;b.essential||=(source.userData.detailKinds||[]).some(t=>/storage-tanks|tank-top-ports|parked-van-wheels|parked-van-windows/.test(t));for(const tag of source.userData.detailKinds||[])b.tags.add(tag);
    }
    source.visible=false;
  }
  const result=[];
  for(const[key,b]of buckets){const g=mergeGeometries(b.geometries,false);for(const p of b.geometries)p.dispose();if(!g)throw Error('Incompatible raised detail buffers');ownGeometry(g);g.computeBoundingSphere();
    const mesh=new THREE.Mesh(g,b.material);mesh.name='raised-detail-chunk-'+key;mesh.userData.staticInstances=b.count;mesh.userData.lowEssential=b.essential;mesh.userData.detailKinds=[...b.tags];mesh.castShadow=false;mesh.receiveShadow=true;parent.add(mesh);result.push(mesh);
  }
  return result;
}
