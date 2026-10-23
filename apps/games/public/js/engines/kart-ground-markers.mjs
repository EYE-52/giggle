// Ground indicators own their position buffer; their material stays shared.
// Refit only when their centre, yaw or animated scale changes.
export function createGroundMarker(THREE, geometry, material, horizontal=true, lines=false) {
  let copy;
  if(lines) {
    const p=geometry.attributes.position,vertices=[];
    for(let i=0;i<p.count;i+=2) {
      const steps=Math.max(1,Math.ceil(Math.hypot(p.getX(i+1)-p.getX(i),p.getZ(i+1)-p.getZ(i))/.25));
      for(let j=0;j<steps;j++)for(const t of [j/steps,(j+1)/steps])for(let axis=0;axis<3;axis++)vertices.push(p.getComponent(i,axis)+(p.getComponent(i+1,axis)-p.getComponent(i,axis))*t);
    }
    copy=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  }else if(geometry.type==='RingGeometry') {
    const p=geometry.parameters;
    copy=new THREE.RingGeometry(p.innerRadius,p.outerRadius,
      Math.max(p.thetaSegments,Math.ceil(p.thetaLength*p.outerRadius/.18)),
      Math.max(p.phiSegments,Math.ceil((p.outerRadius-p.innerRadius)/.18)),p.thetaStart,p.thetaLength);
  }else copy=geometry.clone();
  if(horizontal)copy.rotateX(-Math.PI/2);
  copy.computeBoundingSphere();
  const marker=lines?new THREE.LineSegments(copy,material):new THREE.Mesh(copy,material);
  marker.userData.ground={base:copy.attributes.position.array.slice()};
  return marker;
}

export function placeGroundMarker(marker,x,z,groundAt,clearance=.105) {
  const data=marker.userData.ground,scale=marker.scale.x||1,yaw=marker.rotation.y;
  if(data.x===x&&data.z===z&&data.scale===scale&&data.yaw===yaw&&data.clearance===clearance)return;
  data.x=x;data.z=z;data.scale=scale;data.yaw=yaw;data.clearance=clearance;
  const height=groundAt(x,z),cos=Math.cos(yaw),sin=Math.sin(yaw);
  marker.position.set(x,height,z);
  const positions=marker.geometry.attributes.position;
  for(let i=0;i<positions.count;i++) {
    const j=i*3,lx=data.base[j]*scale,lz=data.base[j+2]*scale;
    positions.array[j+1]=(groundAt(x+cos*lx+sin*lz,z+cos*lz-sin*lx)-height+clearance)/scale+data.base[j+1];
  }
  positions.needsUpdate=true;
  marker.geometry.computeBoundingSphere();
}

export function disposeGroundMarker(marker) {marker?.geometry?.dispose();}

// Match the supporting slope and keep the whole base above curved ground.
// Grounded traps cache their footprint and never allocate in animate().
const trapFootprints=new WeakMap();
export function placeGroundProp(THREE,mesh,x,y,z,groundAt,visualSupportAt=groundAt) {
  let data=mesh.userData.groundProp;
  if(!data) {
    let source;mesh.traverse(child=>{if(!source&&child.isMesh)source=child.geometry;});
    let feet=trapFootprints.get(source);
    if(!feet){
      mesh.updateWorldMatrix(true,true);
      const bounds=new THREE.Box3().setFromObject(mesh);
      const min=bounds.min.clone(),max=bounds.max.clone();
      mesh.worldToLocal(min);mesh.worldToLocal(max);
      feet=[];
      // Cache numeric feet once. Retain centre/edge support, then cover the
      // actual authored base faces: paint can cross their triangle interiors.
      for(const px of [min.x,(min.x+max.x)/2,max.x])for(const pz of [min.z,(min.z+max.z)/2,max.z])feet.push(px,min.y,pz);
      const nx=Math.max(1,Math.ceil((max.x-min.x)/.08)),nz=Math.max(1,Math.ceil((max.z-min.z)/.08));
      for(let ix=0;ix<=nx;ix++)for(let iz=0;iz<=nz;iz++)feet.push(min.x+(max.x-min.x)*ix/nx,min.y,min.z+(max.z-min.z)*iz/nz);
      const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),point=new THREE.Vector3();
      const weights=[[1/3,1/3,1/3],[.5,.5,0],[0,.5,.5],[.5,0,.5],[.25,.25,.5],[.25,.5,.25],[.5,.25,.25]];
      mesh.traverse(child=>{
        if(!child.isMesh)return;
        const p=child.geometry.attributes.position,index=child.geometry.index,count=index?.count??p.count;
        for(let i=0;i<p.count;i++){
          mesh.worldToLocal(point.fromBufferAttribute(p,i).applyMatrix4(child.matrixWorld));feet.push(point.x,point.y,point.z);
        }
        for(let i=0;i<count;i+=3){
          mesh.worldToLocal(a.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(child.matrixWorld));
          mesh.worldToLocal(b.fromBufferAttribute(p,index?index.getX(i+1):i+1).applyMatrix4(child.matrixWorld));
          mesh.worldToLocal(c.fromBufferAttribute(p,index?index.getX(i+2):i+2).applyMatrix4(child.matrixWorld));
          for(const w of weights){point.copy(a).multiplyScalar(w[0]).addScaledVector(b,w[1]).addScaledVector(c,w[2]);feet.push(point.x,point.y,point.z);}
        }
      });
      const seen=new Set(),unique=[];
      for(let i=0;i<feet.length;i+=3){
        const x=Math.fround(feet[i]),y=Math.fround(feet[i+1]),z=Math.fround(feet[i+2]),key=x+','+y+','+z;
        if(!seen.has(key)){seen.add(key);unique.push(x,y,z);}
      }
      feet=new Float32Array(unique);trapFootprints.set(source,feet);
    }
    data=mesh.userData.groundProp={feet,up:new THREE.Vector3(0,1,0),normal:new THREE.Vector3(),point:new THREE.Vector3()};
  }
  if(data.x===x&&data.y===y&&data.z===z)return;data.x=x;data.y=y;data.z=z;
  const d=.25;
  data.normal.set(-(groundAt(x+d,z)-groundAt(x-d,z))/(2*d),1,-(groundAt(x,z+d)-groundAt(x,z-d))/(2*d)).normalize();
  mesh.quaternion.setFromUnitVectors(data.up,data.normal);
  let lift=0;
  for(let i=0;i<data.feet.length;i+=3) {
    data.point.set(data.feet[i],data.feet[i+1],data.feet[i+2]).applyQuaternion(mesh.quaternion);
    lift=Math.max(lift,visualSupportAt(x+data.point.x,z+data.point.z)-y-data.point.y);
  }
  mesh.position.set(x,y+lift+.035,z);
}
