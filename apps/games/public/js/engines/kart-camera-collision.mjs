// Camera-only swept sphere queries. Built once from the same static solids as
// physics (or their exact hidden query meshes). No extra draws, physics world,
// ray-hit arrays or per-frame Three objects. The tree keeps large floors cheap.
export function createKartCameraCollision(THREE,solids){
  const triangles=[],matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),scale=new THREE.Vector3(1,1,1),translation=new THREE.Vector3();
  function add(geometry,transform){
    const p=geometry.attributes.position,index=geometry.index,count=index?.count??p.count;
    for(let i=0;i<count;i+=3){
      const points=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(transform));
      const triangle=new THREE.Triangle(...points),normal=triangle.getNormal(new THREE.Vector3());
      if(normal.lengthSq()<.5)continue;
      const box=new THREE.Box3().setFromPoints(points);triangles.push({triangle,normal,box});
    }
  }
  for(const solid of solids){
    if(solid.isMesh){solid.updateWorldMatrix(true,false);add(solid.geometry,solid.matrixWorld);continue;}
    let geometry;
    if(solid.shape==='trimesh'){
      geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(solid.vertices,3));geometry.setIndex(new THREE.BufferAttribute(solid.indices,1));
    }else if(solid.shape==='wedge'){
      const {x,y,z}=solid.half;
      geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-x,-y,-z,x,-y,-z,-x,-y,z,x,-y,z,-x,y,z,x,y,z],3));
      geometry.setIndex([0,2,4,1,5,3,0,1,3,0,3,2,2,3,5,2,5,4,0,4,5,0,5,1]);
    }else geometry=new THREE.BoxGeometry(solid.half.x*2,solid.half.y*2,solid.half.z*2);
    translation.copy(solid.position);q.set(0,0,0,1);if(solid.rotation)q.copy(solid.rotation);
    matrix.compose(translation,q,scale);add(geometry,matrix);geometry.dispose();
  }
  function tree(items){
    if(!items.length)return null;
    const box=new THREE.Box3();for(const t of items)box.union(t.box);
    if(items.length<=8)return{box,items};
    const size=box.getSize(new THREE.Vector3()),axis=size.x>size.y&&size.x>size.z?'x':size.y>size.z?'y':'z';
    items.sort((a,b)=>a.box.min[axis]+a.box.max[axis]-b.box.min[axis]-b.box.max[axis]);
    const middle=items.length>>1;return{box,left:tree(items.slice(0,middle)),right:tree(items.slice(middle))};
  }
  let root=tree(triangles),best=0,radius=0;
  const ray=new THREE.Ray(),bounds=new THREE.Box3(),point=new THREE.Vector3(),closest=new THREE.Vector3();
  const edge=new THREE.Vector3(),offset=new THREE.Vector3(),perp=new THREE.Vector3(),velocity=new THREE.Vector3();
  const models=new WeakMap(),samplePoint=new THREE.Vector3(),sampleEye=new THREE.Vector3();
  function sphere(center){
    offset.subVectors(ray.origin,center);const b=offset.dot(ray.direction),c=offset.lengthSq()-radius*radius;
    if(c<=0){best=0;return;}
    const d=b*b-c;if(d<0)return;const t=-b-Math.sqrt(d);if(t>=0&&t<best)best=t;
  }
  function segment(a,b){
    edge.subVectors(b,a);const length=edge.length();if(length<1e-9)return;edge.multiplyScalar(1/length);
    offset.subVectors(ray.origin,a);const along=offset.dot(edge),speed=ray.direction.dot(edge);
    perp.copy(offset).addScaledVector(edge,-along);velocity.copy(ray.direction).addScaledVector(edge,-speed);
    const A=velocity.lengthSq(),B=perp.dot(velocity),C=perp.lengthSq()-radius*radius,disc=B*B-A*C;
    if(A<1e-12||disc<0)return;
    const t=(-B-Math.sqrt(disc))/A,u=along+t*speed;
    if(t>=0&&t<best&&u>=0&&u<=length)best=t;
  }
  function test(item){
    const {triangle:t,normal:n}=item;
    // Only entering faces block the eye. An anchor below a bridge/deck can
    // be corrected by a snapshot; its exit face must let the eye escape.
    const v=n.dot(ray.direction);if(v>1e-10)return;
    t.closestPointToPoint(ray.origin,closest);
    if(closest.distanceToSquared(ray.origin)<radius*radius-1e-10){best=0;return;}
    const d=n.dot(offset.subVectors(ray.origin,t.a));
    if(Math.abs(v)>1e-10)for(let side=-1;side<=1;side+=2){
      const distance=(side*radius-d)/v;
      if(distance<0||distance>=best)continue;
      ray.at(distance,point).addScaledVector(n,-side*radius);
      if(t.containsPoint(point))best=distance;
    }
    if(radius>0){segment(t.a,t.b);segment(t.b,t.c);segment(t.c,t.a);sphere(t.a);sphere(t.b);sphere(t.c);}
  }
  function visit(node){
    if(!node||best===0)return;
    bounds.copy(node.box).expandByScalar(radius);
    if(!bounds.containsPoint(ray.origin)){
      if(!ray.intersectBox(bounds,point)||point.distanceToSquared(ray.origin)>best*best)return;
    }
    if(node.items){for(const item of node.items)test(item);}
    else{visit(node.left);visit(node.right);}
  }
  // Inward correction is immediate for safety. Callers ease the desired eye
  // outward, then constrain the eased/shaken result again before rendering.
  function constrain(position,focus,clearance=.22){
    ray.origin.copy(focus);ray.direction.subVectors(position,focus);const length=ray.direction.length();
    if(length<1e-6||!root)return false;
    ray.direction.multiplyScalar(1/length);best=length;radius=clearance;visit(root);
    if(best>=length)return false;
    position.copy(focus).addScaledVector(ray.direction,Math.max(0,best-.015));return true;
  }
  function visible(position,model){
    // The caller updates this model once before testing a frame's orbits.
    if(!model?.userData.kart)return true;
    let samples=models.get(model);
    if(!samples){
      const kart=model.userData.kart;samples=kart.wheels.map(w=>({node:w.node,local:new THREE.Vector3()}));
      kart.inner.traverse(node=>{
        if(!node.isMesh||!/^(ChassisFloor|RearBumper|FrontBumper)/.test(node.name))return;
        node.geometry.computeBoundingBox();samples.push({node,local:node.geometry.boundingBox.getCenter(new THREE.Vector3())});
      });
      models.set(model,samples);
    }
    for(const sample of samples){
      samplePoint.copy(sample.local).applyMatrix4(sample.node.matrixWorld);sampleEye.copy(position);
      if(constrain(sampleEye,samplePoint,.03))return false;
    }
    return true;
  }
  return{constrain,visible,dispose(){root=null;triangles.length=0;}};
}
