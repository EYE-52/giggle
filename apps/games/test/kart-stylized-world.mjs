// Real shipping GLB through pinned Three's loader and real scene adapter.
// ImageBitmap dimensions are parsed from embedded PNG/JPEG headers here. Pixel
// decoding, materials, draw costs and appearance are verified in WebGL later.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createKartElevatedWorld} from '../public/js/engines/kart-elevated-world.mjs';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {closeKartAssetBitmaps} from '../public/js/engines/kart-assets.mjs';
let checks=0,closed=0;
const check=(v,message)=>{assert.ok(v,message);checks++;};
const bytes=fs.readFileSync(new URL('../public/assets/karts/environment/stylized-alpine.glb',import.meta.url));
const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
check(json.asset.version==='2.0'&&bytes.length<6*1024*1024,'Bounded actual shipping glTF2 library');
check(json.nodes.every(n=>!n.extras?.pivot||Array.isArray(n.extras.pivot)&&n.extras.pivot.every(Number.isFinite)),'No reserved numeric pivot metadata regression');
globalThis.self=globalThis;
globalThis.createImageBitmap=async blob=>{
  const data=Buffer.from(await blob.arrayBuffer());
  let width,height;
  if(data.subarray(1,4).toString()==='PNG'){width=data.readUInt32BE(16);height=data.readUInt32BE(20);}
  else if(data[0]===255&&data[1]===216){
    for(let at=2;at<data.length;){
      while(data[at]===255)at++;const marker=data[at++];
      if(marker===216||marker===217||marker>=208&&marker<=215)continue;
      const length=data.readUInt16BE(at);
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){height=data.readUInt16BE(at+3);width=data.readUInt16BE(at+5);break;}
      at+=length;
    }
  }
  assert.ok(width>0&&height>0,'Embedded production PNG/JPEG dimensions resolve');
  return{width,height,close(){closed++;}};
};
const loaded=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const fountainBytes=fs.readFileSync(new URL('../public/assets/karts/environment/alpine-fountain.glb',import.meta.url));
const fountainJSON=JSON.parse(fountainBytes.subarray(20,20+fountainBytes.readUInt32LE(12)));
check(fountainBytes.length<1024*1024&&fountainJSON.materials.length<=4,'Authored fountain stays below transfer/material budgets');
check(fountainJSON.meshes.reduce((n,m)=>n+m.primitives.reduce((s,p)=>s+fountainJSON.accessors[p.indices].count/3,0),0)<8000,'Authored fountain stays below visible triangle budget');
const fountain=(await new GLTFLoader().parseAsync(fountainBytes.buffer.slice(fountainBytes.byteOffset,fountainBytes.byteOffset+fountainBytes.byteLength),'')).scene;
check(!!fountain.getObjectByName('FountainA'),'Authored fountain has stable ground root');
const library=loaded.scene,names=['PineA','PineB','TreeA','GrassA','FlowersA','RockA','RockB','CottageA'],sourceResources=new Set(),sourceTextures=new Set(),released=new Map();
library.updateMatrixWorld(true);
for(const name of names){
  const root=library.getObjectByName(name);check(!!root,name+' source resolves uniquely');
  const bounds=new THREE.Box3().setFromObject(root);check([...bounds.min.toArray(),...bounds.max.toArray()].every(Number.isFinite),name+' finite model bounds');
  check(Math.abs(bounds.min.y)<.015&&root.matrix.elements.every(Number.isFinite),name+' ground origin and finite local matrix');
}
for(const source of [library,fountain])source.traverse(o=>{
  if(o.geometry)sourceResources.add(o.geometry);
  for(const m of Array.isArray(o.material)?o.material:[o.material])if(m){sourceResources.add(m);for(const t of Object.values(m))if(t?.isTexture){sourceResources.add(t);sourceTextures.add(t);}}
});
for(const resource of sourceResources){released.set(resource,0);resource.addEventListener('dispose',()=>released.set(resource,released.get(resource)+1));}
const beforeTransforms=library.children.map(n=>n.matrix.toArray()),fountainTransforms=fountain.children.map(n=>n.matrix.toArray()),map=elevatedMap('garden'),scene=new THREE.Scene(),world=createKartElevatedWorld(THREE,{scene,map,assets:{stylized:library,fountain}});
assert.deepEqual([...world.colliderMeshes.values()].map(r=>r.descriptor),map.colliders);checks++;
const fountainRecord=world.colliderMeshes.get('fountain-base'),fountainParts=fountainRecord.group.children.filter(n=>n.name.startsWith('fountain-authored-'));
check(!fountainRecord.body.visible&&fountainParts.length===2,'Authored two-draw fountain replaces fallback solid skin');
check(!fountainRecord.group.getObjectByName('fountain-carved-rim'),'No old primitive rim under authored bowl');
world.group.updateMatrixWorld(true);
const fountainBounds=new THREE.Box3();for(const part of fountainParts)fountainBounds.union(new THREE.Box3().setFromObject(part));
for(const [actual,expected]of [...fountainBounds.min.toArray().map((v,i)=>[v,[-16,0,-8][i]]),...fountainBounds.max.toArray().map((v,i)=>[v,[-8,2.4,0][i]])])check(Math.abs(actual-expected)<1e-5,'Authored fountain fills exact old footprint and safe height');
const pool=fountainParts.find(n=>n.name.endsWith('FountainA_Water')),poolBounds=new THREE.Box3().setFromObject(pool);
check(Math.abs(poolBounds.min.y-2.30)<1e-5&&Math.abs(poolBounds.max.y-2.30)<1e-5,'Shallow water inset stays within 10cm of collider support');
const poolShader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>'};pool.material.onBeforeCompile(poolShader);world.animate(1/60,3,.65);
check(poolShader.uniforms.fountainTime.value===3&&poolShader.fragmentShader.includes('float glint='),'Bounded material shimmer follows render time');
check(!pool.castShadow,'Water receives lighting without fake solid shadow');
const carvedStone=fountainParts.find(n=>n.name.endsWith('FountainA_Stone'));
check(carvedStone.castShadow&&!carvedStone.receiveShadow,'Broad shallow coping casts its ground shadow without directional self-shadow stripes');
check(JSON.stringify(fountain.children.map(n=>n.matrix.toArray()))===JSON.stringify(fountainTransforms),'Fountain placement leaves borrowed source transforms intact');
check(world.colliderMeshes.get('floor').body.material.userData.floorComposition.style==='stylized','Actual floor selects stylized surface without photographic pack');
for(const d of map.colliders.filter(d=>d.shape==='deck'||d.shape==='wedge')){
  const body=world.colliderMeshes.get(d.id).body,geometry=body.geometry,normal=geometry.attributes.normal;
  check(Array.isArray(body.material)&&body.material[1]===world.colliderMeshes.get('floor').body.material,d.id+' driving surface shares actual approach paving');
  check(geometry.groups.length===2&&geometry.groups.reduce((n,g)=>n+g.count,0)===geometry.index.count,d.id+' every triangle has exactly one bounded surface group');
  for(const group of geometry.groups)for(let i=group.start;i<group.start+group.count;i+=3){
    const up=normal.getY(geometry.index.getX(i))>.65;
    check(up===(group.materialIndex===1),d.id+' top paving and structural brick follow actual face orientation');
  }
}
for(const name of ['clustered-fir-crowns','broken-limestone-outcrops','valley-foothills','alpine-distant-ridges','snow-summit-horizon'])check(!world.group.getObjectByName(name),'Reject old substitute '+name);
check(!!world.group.getObjectByName('stylized-snow-peak-5'),'Distinct sculpted distant peak layer');
const eye=new THREE.PerspectiveCamera(52,1280/800,.1,650);eye.position.set(-44,5,-49);eye.lookAt(-44,2,-36);eye.updateMatrixWorld(true);world.updateDetail(eye,.25);world.group.updateMatrixWorld(true);
let drawInstances=0;
const box=new THREE.Box3(),matrix=new THREE.Matrix4(),instance=new THREE.Matrix4();
world.scenery.traverse(o=>{
  if(!o.isMesh)return;
  o.geometry.computeBoundingBox();
  for(let i=0;i<(o.isInstancedMesh?o.count:1);i++){
    if(o.isInstancedMesh){o.getMatrixAt(i,instance);matrix.multiplyMatrices(o.matrixWorld,instance);drawInstances++;}else matrix.copy(o.matrixWorld);
    box.copy(o.geometry.boundingBox).applyMatrix4(matrix);
    check([...box.min.toArray(),...box.max.toArray()].every(Number.isFinite),o.name+' finite world box');
    check(box.max.x<=-map.half-2||box.min.x>=map.half+2||box.max.z<=-map.half-2||box.min.z>=map.half+2,o.name+' scenery bounds outside authoritative field');
  }
});
check(drawInstances>20,'Source models actually populated in camera detail range');
check(JSON.stringify(library.children.map(n=>n.matrix.toArray()))===JSON.stringify(beforeTransforms),'Placement never modifies hidden source library transforms');
let plants=0;
world.group.traverse(o=>{if(o.name.startsWith('stylized-meadow-')&&o.isInstancedMesh){check(o.count<=500&&!o.castShadow,'Bounded soft foliage avoids shadow load');plants+=o.count;}});
check(plants>0,'Camera has actual nearby source-authored meadow plants');
const owned=new Set();world.group.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)owned.add(m);});const disposed=new Map();for(const m of owned){disposed.set(m,0);m.addEventListener('dispose',()=>disposed.set(m,disposed.get(m)+1));}
const stats=world.stats();check(stats.textureBytes<24*1024*1024,'Decoded world materials remain below24MiB including mips');check(stats.drawCalls<115,'World batches stay bounded');
for(let i=0;i<180;i++)world.animate(1/60,i/60,i/179);check(JSON.stringify(world.stats())===JSON.stringify(stats),'Sunset animates without scene resource growth');
world.dispose();world.dispose();check([...disposed.values()].every(n=>n===1),'All owned scene materials disposed once');check([...released.values()].every(n=>n===0),'Scene disposal leaves source geometry/atlas owned by library');
const bitmaps=closeKartAssetBitmaps(library);check(bitmaps>0&&closed===bitmaps,'Each unique native image has one retirement close');
for(const resource of sourceResources)resource.dispose();
console.log(JSON.stringify({pass:true,checks,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),fountain:{bytes:fountainBytes.length,sha256:crypto.createHash('sha256').update(fountainBytes).digest('hex'),draws:fountainParts.length,bounds:{min:fountainBounds.min.toArray(),max:fountainBounds.max.toArray()}},sources:names,uniqueTextures:sourceTextures.size,closedBitmaps:bitmaps,world:stats,scope:'Actual Three GLTFLoader/scene geometry/ownership, PNG/JPEG dimension shim; no pixel decoding, WebGL or physical-phone claim.'},null,2));
