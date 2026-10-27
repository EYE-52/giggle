import {MeshoptDecoder} from '../public/vendor/three/libs/meshopt_decoder.mjs';
await MeshoptDecoder.ready;
// Actual pinned Three GLTFLoader load; authored surface and mount fit contracts.
// ImageBitmap shim reads embedded PNG bytes/dimensions, not pixels or WebGL.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
let checks=0;
const check=(condition,message)=>{assert.ok(condition,message);checks++;};
const near=(a,b,tolerance=1e-5)=>Math.abs(a-b)<tolerance;
const asset=fs.readFileSync(new URL('../public/assets/karts/combat/pulse-mounted.meshopt.glb',import.meta.url));
const source=fs.readFileSync(new URL('../assets-source/karts/weapon-candidates-20261007/kenney-blaster-2.1/Models/GLB format/blaster-h.glb',import.meta.url));
const atlas=fs.readFileSync(new URL('../assets-source/karts/weapon-candidates-20261007/kenney-blaster-2.1/Models/GLB format/Textures/colormap.png',import.meta.url));
function unpack(bytes){const size=bytes.readUInt32LE(12);return{json:JSON.parse(bytes.subarray(20,20+size)),bin:bytes.subarray(28+size)};}
const {json,bin}=unpack(asset),original=unpack(source);
check(json.asset.version==='2.0'&&asset.length<100000,'Small valid glTF2 asset');
check(json.images.length===1&&json.images[0].bufferView!==undefined&&!json.images[0].uri,'Texture is embedded; no external dependency');
const iv=json.bufferViews[json.images[0].bufferView],embedded=bin.subarray(iv.byteOffset,iv.byteOffset+iv.byteLength);
check(embedded.equals(atlas),'Original lossless atlas bytes preserved exactly');
let bitmap;
globalThis.self=globalThis;
globalThis.createImageBitmap=async blob=>{const png=Buffer.from(await blob.arrayBuffer());check(png.equals(atlas),'Actual loader resolves original embedded atlas');bitmap={width:png.readUInt32BE(16),height:png.readUInt32BE(20),close(){}};return bitmap;};
const {scene}=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(asset.buffer.slice(asset.byteOffset,asset.byteOffset+asset.byteLength),'');
scene.updateMatrixWorld(true);
const root=scene.getObjectByName('Pulse'),housing=scene.getObjectByName('PulseHousing'),saddle=scene.getObjectByName('PulseSaddle'),tip=scene.getObjectByName('PulseMuzzleTip');
check(root&&housing?.isMesh&&saddle?.isMesh&&tip&&!tip.isMesh,'Stable Pulse hierarchy and nonrendering muzzle helper');
check(root.userData.kind==='pulse'&&root.userData.mount?.length===3&&root.userData.mount.every(Number.isFinite),'Numeric per-asset mount metadata');
check(root.position.length()<1e-6&&root.scale.distanceTo(new THREE.Vector3(1,1,1))<1e-6,'Asset pivot and uniform baked root');
let meshes=0,triangles=0;
scene.traverse(o=>{check(o.matrixWorld.elements.every(Number.isFinite),o.name+' finite transforms');if(!o.isMesh)return;meshes++;const g=o.geometry;triangles+=(g.index?.count??g.attributes.position.count)/3;check(Array.isArray(o.material)===false,'One draw per mesh');for(const name of ['position','normal'])check([...g.attributes[name].array].every(Number.isFinite),o.name+' finite '+name);});
check(meshes<=3&&triangles<1500,'Bounded actual mesh draws/triangle load');
const bounds=new THREE.Box3().setFromObject(root),bodyBounds=new THREE.Box3().setFromObject(housing),baseBounds=new THREE.Box3().setFromObject(saddle);
check(near(bounds.min.y,0)&&near(bounds.max.z,1.1)&&near(bounds.max.z-bounds.min.z,1.45),'Saddle ground pivot, 1.45m total length and front lip reach');
check(near(bodyBounds.min.x,-bodyBounds.max.x)&&near(baseBounds.min.x,-baseBounds.max.x),'Centered symmetric source/saddle width');
check(housing.material.map?.image===bitmap&&bitmap.width===512&&bitmap.height===512,'Actual loader material uses authored 512 atlas');
check(housing.material.metalness===0&&housing.material.roughness===1&&housing.material.side===THREE.DoubleSide,'Original authored material parameters');
check(!saddle.material.map&&saddle.material.roughness>.55&&saddle.material.metalness<.5,'Saddle remains machined matte');
const primitive=original.json.meshes[0].primitives[0];
function readAccessor(which){const a=original.json.accessors[which],v=original.json.bufferViews[a.bufferView],components={VEC2:2,VEC3:3,SCALAR:1}[a.type];assert.equal(a.componentType,5126);return Array.from({length:a.count},(_,i)=>Array.from({length:components},(_,c)=>original.bin.readFloatLE((v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??components*4)+c*4)));}
const positions=readAccessor(primitive.attributes.POSITION),normals=readAccessor(primitive.attributes.NORMAL),uvs=readAccessor(primitive.attributes.TEXCOORD_0);
// Independently recover the opening contour from the source's inner-wall UV
// stripe: for each (X,Y), its foremost point is the mouth, not the cavity back.
const ring=new Map();positions.forEach((p,i)=>{if(near(uvs[i][0],.34375)&&p[2]<-.26){const key=p.slice(0,2).join(',');if(!ring.has(key)||ring.get(key)[2]>p[2])ring.set(key,p);}});
check(ring.size===8,'Measured original octagonal inner lip resolves');
const sourceBore=[0,1,2].map(axis=>[...ring.values()].reduce((sum,p)=>sum+p[axis],0)/ring.size);
const scale=1.45/(Math.max(...positions.map(p=>p[2]))-Math.min(...positions.map(p=>p[2])));
const offset=[0,.5-sourceBore[1]*scale,1.1+Math.min(...positions.map(p=>p[2]))*scale];
const normalized=p=>[-p[0]*scale+offset[0],p[1]*scale+offset[1],-p[2]*scale+offset[2]];
const measured=new THREE.Vector3(...normalized(sourceBore)),loadedTip=tip.getWorldPosition(new THREE.Vector3());
check(loadedTip.distanceTo(measured)<1e-5,'Helper is actual measured opening center, rather than forwardmost lip');
check(bounds.max.z-loadedTip.z>.05&&bounds.max.z-loadedTip.z<.08,'Small authored oblique lip overhang retained');
const [mountX,mountY,mountZ]=root.userData.mount;
check(near(mountX+loadedTip.x,.95)&&near(-.70+mountY+loadedTip.y,.50)&&near(mountZ+loadedTip.z,1.90),'Metadata plus rendered inner -.70 reaches authoritative pulse muzzle');
// Every exported housing vertex retains an original position/UV/split normal.
// Compare surface tuples rather than exporter-dependent vertex ordering/count.
const outputPosition=housing.geometry.attributes.position,outputNormal=housing.geometry.attributes.normal,outputUV=housing.geometry.attributes.uv;
check(housing.geometry.index.count/3===original.json.accessors[primitive.indices].count/3,'All original triangles retained without simplification');
for(let i=0;i<outputPosition.count;i++){
 const p=new THREE.Vector3().fromBufferAttribute(outputPosition,i).applyMatrix4(housing.matrixWorld),normal=new THREE.Vector3().fromBufferAttribute(outputNormal,i).transformDirection(housing.matrixWorld),uv=[outputUV.getX(i),outputUV.getY(i)];
 check(positions.some((s,k)=>p.distanceTo(new THREE.Vector3(...normalized(s)))<1e-5&&near(uv[0],uvs[k][0])&&near(uv[1],uvs[k][1])&&normal.dot(new THREE.Vector3(-normals[k][0],normals[k][1],-normals[k][2]).normalize())>.9999),'Exported source surface tuple '+i+' unchanged');
}
// Seat proof uses actual loaded kart sidepod, not repeated authored dimensions.
const kb=fs.readFileSync(new URL('../public/assets/karts/giggle-kart.meshopt.glb',import.meta.url));
const kart=(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(kb.buffer.slice(kb.byteOffset,kb.byteOffset+kb.byteLength),'')).scene;
kart.updateMatrixWorld(true);const pod=new THREE.Box3().setFromObject(kart.getObjectByName('SidePod_RMesh'));
const feet=[];const sp=saddle.geometry.attributes.position;
for(let i=0;i<sp.count;i++){const p=new THREE.Vector3().fromBufferAttribute(sp,i).applyMatrix4(saddle.matrixWorld).add(new THREE.Vector3(...root.userData.mount));if(near(p.y,pod.max.y))feet.push(p);}
check(feet.length>=4&&feet.every(p=>p.x>=pod.min.x-1e-5&&p.x<=pod.max.x+1e-5&&p.z>=pod.min.z-1e-5&&p.z<=pod.max.z+1e-5),'Rear saddle foot sits inside actual sidepod upper footprint at exact mount');
console.log(JSON.stringify({pass:true,checks,bytes:asset.length,sha256:crypto.createHash('sha256').update(asset).digest('hex'),meshes,triangles,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},bore:loadedTip.toArray(),mount:root.userData.mount,scope:'Actual Three loader and geometry/UV/normal/embedded-byte checks; no WebGL, moving-fire or visual acceptance claim.'},null,2));
const resources=new Set();for(const tree of [scene,kart])tree.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m){resources.add(m);if(m.map)resources.add(m.map);}});for(const r of resources)r.dispose();bitmap.close();
