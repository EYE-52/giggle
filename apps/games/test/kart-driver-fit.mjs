import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {KART_DRIVERS,KART_SEAT,MeshoptDecoder,seatKartDriver} from '../public/js/engines/kart-assets.mjs';
globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});await MeshoptDecoder.ready;
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
async function load(name){const b=await fs.readFile(new URL('../public/assets/karts/'+name+'.glb',import.meta.url));return(await loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;}
const template=await load('giggle-kart.meshopt'),reports=[];
for(const id of KART_DRIVERS){
  const driver=await load('drivers/'+id),source=driver.getObjectByProperty('isMesh',true),sourceBuffer=source.geometry.attributes.position.array.slice(),kart=template.clone(true);
  driver.updateMatrixWorld(true);const original=new Float32Array(source.geometry.attributes.position.count*3),normalized=original.slice(),vertex=new THREE.Vector3();
  for(let i=0;i<source.geometry.attributes.position.count;i++){vertex.fromBufferAttribute(source.geometry.attributes.position,i);vertex.toArray(original,i*3);vertex.applyMatrix4(source.matrixWorld);driver.worldToLocal(vertex);vertex.toArray(normalized,i*3);}
  seatKartDriver(kart,driver);kart.updateMatrixWorld(true);
  const seated=kart.getObjectByName('KartDriver'),mesh=seated.getObjectByProperty('isMesh',true),p=mesh.geometry.attributes.position,point=new THREE.Vector3(),box=new THREE.Box3(),tail=[],body=[];
  kart.traverse(o=>{if(o.isMesh&&!seated.getObjectById(o.id))body.push(o);});
  for(let i=0;i<p.count;i++){
    point.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);box.expandByPoint(point);
    assert(Math.abs(point.x)<.72&&point.y>=.59&&point.y<2.2,id+' driver fits cockpit width and head/ear height');
    if(point.y<1.3)assert(point.z>=-.85&&point.z<1.1,id+' lower body stays over the chassis floor, ahead of the engine/spoiler');
    if(normalized[i*3+1]>.55||normalized[i*3+2]>=-.12)for(let a=0;a<3;a++){
      assert.equal(p.getComponent(i,a),original[i*3+a],id+' face, ears and forward hands stay authored');
      assert.equal(mesh.geometry.attributes.normal.getComponent(i,a),source.geometry.attributes.normal.getComponent(i,a),id+' unchanged face/ear shading normals');
    }
    if(normalized[i*3+2]<-.3&&normalized[i*3+1]<.45)tail.push(point.clone());
  }
  assert.deepEqual(source.geometry.attributes.position.array,sourceBuffer,id+' shared source GLB remains unchanged');
  assert.equal(mesh.material,source.material,id+' original textured material retained');
  assert.equal(mesh.geometry.index.count,source.geometry.index.count,id+' fitting adds no triangles or draw calls');
  for(const eye of [new THREE.Vector3(0,3.2,-8.8),new THREE.Vector3(0,4.2,-10)]){
    const ray=new THREE.Raycaster(),direction=new THREE.Vector3();let hidden=0;
    for(const p of tail){direction.subVectors(p,eye);ray.far=direction.length()-.005;ray.set(eye,direction.normalize());if(ray.intersectObjects(body,false).length)hidden++;}
    assert(hidden===tail.length,id+' folded rear geometry is hidden by the seat/kart at desktop and portrait chase heights: '+hidden+'/'+tail.length);
  }
  const again=template.clone(true);seatKartDriver(again,driver);
  assert.equal(again.getObjectByName('KartDriver').getObjectByProperty('isMesh',true).geometry,mesh.geometry,id+' later variants reuse the fitted geometry');
  reports.push({id,bounds:[box.min.toArray(),box.max.toArray()],tuckedRearVertices:tail.length,scale:KART_SEAT.scale});
}
console.log(JSON.stringify({pass:true,drivers:reports,scope:'Shipping GLBs, cockpit bounds, unchanged faces/ears/materials/triangles and rear-geometry occlusion from both chase heights.'}));
