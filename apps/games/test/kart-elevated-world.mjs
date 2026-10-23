import assert from 'node:assert/strict';
import * as THREE from 'three';
import { elevatedMap, elevatedMapIds } from '../public/js/engines/kart-elevated-maps.mjs';
import { createKartElevatedWorld, elevatedSolidGeometry } from '../public/js/engines/kart-elevated-world.mjs';

let checks=0;
function check(value,message){assert.ok(value,message);checks++;}
const epsilon=2e-5;
const v=new THREE.Vector3(),matrix=new THREE.Matrix4(),local=new THREE.Matrix4();

function eachTriangle(root,visit){
  root.updateMatrixWorld(true);
  root.traverse(o=>{
    if(!o.isMesh)return;
    const p=o.geometry.attributes.position,index=o.geometry.index,n=index?index.count:p.count;
    const instances=o.isInstancedMesh?o.count:1;
    for(let instance=0;instance<instances;instance++){
      if(o.isInstancedMesh){o.getMatrixAt(instance,local);matrix.multiplyMatrices(o.matrixWorld,local);}else matrix.copy(o.matrixWorld);
      for(let i=0;i<n;i+=3){
        const points=[];
        for(let j=0;j<3;j++){v.fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(matrix);points.push(v.clone());}
        visit(points,o);
      }
    }
  });
}
// Projected triangle/rectangle SAT detects edges crossing the legal drive
// field even when every vertex happens to be outside it.
function intersectsField(points,half){
  const axes=[[1,0],[0,1]];
  for(let i=0;i<3;i++){const a=points[i],b=points[(i+1)%3];axes.push([a.z-b.z,b.x-a.x]);}
  for(const [x,z]of axes){
    if(Math.abs(x)+Math.abs(z)<1e-8)continue;
    const projected=points.map(p=>p.x*x+p.z*z),r=half*(Math.abs(x)+Math.abs(z));
    if(Math.min(...projected)>=r-epsilon||Math.max(...projected)<=-r+epsilon)return false;
  }
  return true;
}
function resources(world){
  const set=new Set();
  world.group.traverse(o=>{
    if(o.geometry)set.add(o.geometry);
    for(const m of Array.isArray(o.material)?o.material:[o.material])if(m){set.add(m);for(const value of Object.values(m))if(value?.isTexture)set.add(value);for(const value of m.userData.meadowTextures||[])set.add(value);}
  });
  return set;
}
const evidence=[];
for(const id of elevatedMapIds){
  const input=elevatedMap(id),before=structuredClone(input),scene=new THREE.Scene();
  const world=createKartElevatedWorld(THREE,{scene,map:input});
  check(world.lighting.phase===0,id+' Daybreak starts in daylight rather than a forced sunset');
  assert.deepEqual(input,before);checks++;
  check(world.colliderMeshes.size===input.colliders.length,id+' all exact colliders');
  check(world.layout.spawns.length===8&&world.layout.sockets.length===input.sockets.length,id+' spawn/socket identity');
  if(id==='garden'){
    const floor=world.colliderMeshes.get('floor').body.material,composition=floor.userData.floorComposition;
    check(composition?.meadow&&composition.raised===false,'Garden meadow is only a floor material, no new solid');
    check(composition.routes.every(([a,b,c,d,w])=>[a,b,c,d].every(v=>Math.abs(v)<=input.half-w/2)),'All connected paved approaches are inside the authored floor');
    check(floor.userData.meadowTextures.length===2&&floor.userData.meadowTextures[0].colorSpace===THREE.SRGBColorSpace&&floor.userData.meadowTextures[1].colorSpace===THREE.NoColorSpace,'Original grass is color data and drive mask is linear data');
  }
  for(const descriptor of input.colliders){
    const record=world.colliderMeshes.get(descriptor.id),inverse=record.group.matrixWorld.clone();
    world.group.updateMatrixWorld(true);inverse.copy(record.group.matrixWorld).invert();
    assert.deepEqual(record.descriptor,descriptor);checks++;
    check(record.cameraBody?.parent===record.group&&!record.cameraBody.visible,id+' camera uses an owned nonrendered physical solid '+descriptor.id);
    check(record.cameraBody.position.length()<epsilon&&record.cameraBody.scale.equals(new THREE.Vector3(1,1,1)),id+' camera solid never inherits cosmetic skin insets '+descriptor.id);
    record.cameraBody.geometry.computeBoundingBox();
    check(record.cameraBody.geometry.boundingBox.min.distanceTo(new THREE.Vector3(-descriptor.half.x,-descriptor.half.y,-descriptor.half.z))<epsilon&&record.cameraBody.geometry.boundingBox.max.distanceTo(new THREE.Vector3(descriptor.half.x,descriptor.half.y,descriptor.half.z))<epsilon,id+' camera solid covers exact authority extents '+descriptor.id);
    if(descriptor.material==='barrier'){
      check(record.body.scale.equals(new THREE.Vector3(1,1,1))&&record.body.position.length()<epsilon,id+' visible boundary fills the actual blocking height '+descriptor.id);
      const faceRay=new THREE.Raycaster(new THREE.Vector3(0,2.8,input.half-3),new THREE.Vector3(0,0,1),0,6);
      if(descriptor.id==='north-boundary')check(faceRay.intersectObject(record.body,false).length>0,id+' visible wall blocks the same high sight line as its collider');
    }
    check(record.group.position.distanceTo(new THREE.Vector3(...Object.values(descriptor.position)))<epsilon,id+' exact collider origin '+descriptor.id);
    let vertices=0,maxViolation=-Infinity;
    eachTriangle(record.group,points=>{
      for(const p of points){p.applyMatrix4(inverse);vertices++;maxViolation=Math.max(maxViolation,Math.abs(p.x)-descriptor.half.x,Math.abs(p.y)-descriptor.half.y,Math.abs(p.z)-descriptor.half.z);}
    });
    check(vertices>0&&maxViolation<=epsilon,id+' visible solid stays in physical envelope '+descriptor.id+' violation '+maxViolation);
    const geometry=elevatedSolidGeometry(THREE,descriptor);geometry.computeBoundingBox();
    check(geometry.boundingBox.min.distanceTo(new THREE.Vector3(-descriptor.half.x,-descriptor.half.y,-descriptor.half.z))<epsilon&&geometry.boundingBox.max.distanceTo(new THREE.Vector3(descriptor.half.x,descriptor.half.y,descriptor.half.z))<epsilon,id+' exact support extremes '+descriptor.id);
    if(descriptor.shape==='wedge'){
      const p=geometry.attributes.position,n=geometry.attributes.normal;
      let top=0;
      for(let i=0;i<p.count;i++)if(n.getY(i)>.5){top++;const expected=p.getZ(i)*descriptor.half.y/descriptor.half.z;check(Math.abs(p.getY(i)-expected)<epsilon,id+' smooth linear wedge top');}
      check(top===6,id+' two top triangles, no stair treads');
    }
    if(descriptor.shape==='deck')check(Math.abs(record.body.geometry.boundingBox?.min.y??-descriptor.half.y)<.41,id+' finite deck underside');
    geometry.dispose();
  }
  const boundaryRay=new THREE.Raycaster(new THREE.Vector3(0,2.8,input.half-3),new THREE.Vector3(0,0,1),0,6);
  check(boundaryRay.intersectObjects([...world.colliderMeshes.values()].map(record=>record.cameraBody),false).some(hit=>hit.object.name==='north-boundary-camera-solid'),id+' exact camera query cannot cross the solid arena boundary');
  for(const detail of world.solids.children.filter(o=>o.userData.colliderIds)){
    check(detail.userData.colliderIds.length===detail.count,id+' merged details retain physical identity');
    const p=detail.geometry.attributes.position;
    for(let i=0;i<detail.count;i++){
      const record=world.colliderMeshes.get(detail.userData.colliderIds[i]);
      check(!!record,id+' merged detail references a real collider');
      detail.getMatrixAt(i,local);matrix.multiplyMatrices(detail.matrixWorld,local);
      const inverse=record.group.matrixWorld.clone().invert(),h=record.descriptor.half;let violation=-Infinity;
      for(let j=0;j<p.count;j++){v.fromBufferAttribute(p,j).applyMatrix4(matrix).applyMatrix4(inverse);violation=Math.max(violation,Math.abs(v.x)-h.x,Math.abs(v.y)-h.y,Math.abs(v.z)-h.z);}
      check(violation<epsilon,id+' batched visible detail remains in physical envelope '+record.descriptor.id);
    }
  }
  let triangles=0,illegal=0,first='';
  eachTriangle(world.scenery,(points,o)=>{triangles++;if(intersectsField(points,input.half+2)){illegal++;first||=o.name;}});
  check(triangles>0&&illegal===0,id+' scenery outside drive bounds '+illegal+' '+first);
  const stats=world.stats();
  check(stats.drawCalls<=80,id+' <=80 world draw calls');
  check(stats.triangles<=80000,id+' <=80k world triangles');
  check(stats.textureBytes<=12*1024*1024,id+' <=12MiB original textures with mipmaps');
  const owned=resources(world),disposals=new Map();
  for(const resource of owned){disposals.set(resource,0);resource.addEventListener('dispose',()=>disposals.set(resource,disposals.get(resource)+1));if(resource.isTexture){check(resource.image.width<=512&&resource.wrapS===THREE.RepeatWrapping&&resource.wrapT===THREE.RepeatWrapping,id+' physical repeat UV and bounded atlas');}}
  const count=world.group.children.length;
  for(let i=0;i<360;i++)world.animate(1/60,i/60,i/359);
  assert.deepEqual(world.stats(),stats);checks++;
  check(resources(world).size===owned.size&&world.group.children.length===count,id+' animation allocates no scene resources');
  world.animate(1/60,12,.65);const color=world.lighting.fogColor.clone(),sun=world.lighting.sun.position.clone();
  world.animate(.5,0,.65);check(color.equals(world.lighting.fogColor)&&sun.equals(world.lighting.sun.position),id+' explicit sunset phase independent of local elapsed time');
  world.animate(0,0,99);check(world.lighting.phase===1,id+' phase bounded');
  world.dispose();world.dispose();world.animate(1,1,.3);
  check(world.disposed&&scene.children.length===0&&world.colliderMeshes.size===0,id+' idempotent teardown');
  check([...disposals.values()].every(n=>n===1),id+' each owned GPU resource disposed once');
  evidence.push({map:id,...stats,scenicTriangles:triangles});
}
console.log('PASS '+checks+' elevated world geometry/resource checks');
console.log(JSON.stringify(evidence,null,2));
