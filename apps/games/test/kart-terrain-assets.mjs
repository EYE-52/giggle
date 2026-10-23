// Actual terrain loader with real THREE.Texture resources and a controlled
// TextureLoader transport. No renderer/physics claim: native checks are separate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {loadKartTerrainAssets} from '../public/js/engines/kart-terrain-assets.mjs';
import {createKartElevatedWorld} from '../public/js/engines/kart-elevated-world.mjs';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {closeKartAssetBitmaps} from '../public/js/engines/kart-assets.mjs';

const checks=[];
const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
const near=(a,b)=>Math.abs(a-b)<1e-9;
const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
function transport({throwsAt=-1}={}){
  const calls=[];
  class TextureLoader {
    load(url,resolve,progress,reject){
      if(calls.length===throwsAt){calls.push({url,thrown:true});throw Error('Synchronous transport failure');}
      const texture=new THREE.Texture(),entry={url,texture,resolve,reject,disposals:0};texture.addEventListener('dispose',()=>entry.disposals++);calls.push(entry);return texture;
    }
  }
  const api={...THREE,TextureLoader};
  const success=i=>{const e=calls[i],role=e.url.match(/-(color|normal|roughness)\.webp/)?.[1],size=manifest.resolutionByRole?.[role]||manifest.resolution||1024;e.texture.image={width:size,height:size};e.texture.needsUpdate=true;e.resolve(e.texture);};
  const fail=(i,error=Error('Texture unavailable'))=>calls[i].reject(error);
  return{api,calls,success,fail};
}
function trackedSignal(controller=new AbortController()){
  const signal=controller.signal,listeners=new Set(),add=signal.addEventListener.bind(signal),remove=signal.removeEventListener.bind(signal);
  signal.addEventListener=(type,fn,opts)=>{if(type==='abort')listeners.add(fn);add(type,fn,opts);};signal.removeEventListener=(type,fn,opts)=>{if(type==='abort')listeners.delete(fn);remove(type,fn,opts);};return{controller,signal,listeners};
}
const manifestFile=new URL('../public/assets/karts/terrain/manifest.json',import.meta.url),manifest=JSON.parse(fs.readFileSync(manifestFile));
const families=Object.keys(manifest.materials),textureCount=families.reduce((n,f)=>n+Object.keys(manifest.materials[f].maps).length,0),floorFamilies=['grass','earth','limestone'];
{
  const t=transport(),sig=trackedSignal(),promise=loadKartTerrainAssets(t.api,{environment:'alpine',signal:sig.signal});
  check('alpine starts exactly the manifest PBR families and local channels',t.calls.length===textureCount&&t.calls.every(e=>families.some(f=>e.url.startsWith('/assets/karts/terrain/'+f+'-'))&&e.url.endsWith('.webp?v=terrain-20261007')));
  check('in-flight load registers one cancellable abort listener',sig.listeners.size===1);
  for(let i=textureCount-1;i>=0;i--)t.success(i);const terrain=await promise;
  check('success returns every manifest family and owned real Texture',terrain.textures.size===textureCount&&Object.keys(terrain.sets).sort().join()===families.slice().sort().join()&&[...terrain.textures].every(t=>t instanceof THREE.Texture));
  check('successful load retires its abort listener',sig.listeners.size===0);
  for(const[family,set]of Object.entries(terrain.sets)){
    check(family+' scale matches shipped physical source metadata',near(set.tileMeters,manifest.materials[family].tileMetres));
    check(family+' albedo is sRGB while normal/roughness remain linear data',set.map.colorSpace===THREE.SRGBColorSpace&&set.normalMap.colorSpace===THREE.NoColorSpace&&set.roughnessMap.colorSpace===THREE.NoColorSpace);
    for(const[channel,texture]of Object.entries(set).filter(([k])=>k!=='tileMeters')){
      check(family+' '+channel+' repeats at exact world 8m basis',near(texture.repeat.x,8/set.tileMeters)&&near(texture.repeat.y,8/set.tileMeters)&&texture.wrapS===THREE.RepeatWrapping&&texture.wrapT===THREE.RepeatWrapping);
      check(family+' '+channel+' uses mipmaps and bounded anisotropy',texture.magFilter===THREE.LinearFilter&&texture.minFilter===THREE.LinearMipmapLinearFilter&&texture.generateMipmaps&&texture.anisotropy===8);
    }
  }
  terrain.dispose();terrain.dispose();check('owner disposal clears ownership and releases each texture exactly once',terrain.textures.size===0&&t.calls.every(e=>e.disposals===1));
}
for(const environment of ['frost','harbor',undefined,'garden']){
  const t=transport(),sig=trackedSignal(),terrain=await loadKartTerrainAssets(t.api,{environment,signal:sig.signal});check(String(environment)+' avoids downloading unsupported garden materials',t.calls.length===0&&Object.keys(terrain.sets).length===0&&terrain.textures.size===0&&sig.listeners.size===0);terrain.dispose();terrain.dispose();
}
{
  const t=transport(),sig=trackedSignal(),reason=Error('Retired before mount');sig.controller.abort(reason);
  await assert.rejects(loadKartTerrainAssets(t.api,{environment:'alpine',signal:sig.signal}),error=>error===reason);check('pre-abort preserves caller reason and starts no request/listener',t.calls.length===0&&sig.listeners.size===0);
}
for(const reason of [0,false,'',null]){
  const t=transport(),sig=trackedSignal();sig.controller.abort(reason);let caught=Symbol();
  try{await loadKartTerrainAssets(t.api,{environment:'alpine',signal:sig.signal});}catch(error){caught=error;}
  check('pre-abort preserves falsy caller reason '+JSON.stringify(reason),caught===reason&&t.calls.length===0&&sig.listeners.size===0);
}
{
  const t=transport(),sig=trackedSignal(),reason=Error('Instance changed while terrain loaded');
  let rejection;const promise=loadKartTerrainAssets(t.api,{environment:'alpine',signal:sig.signal}).catch(error=>{rejection=error;});
  t.success(0);t.success(4);await flush();sig.controller.abort(reason);await flush();
  check('mid-load abort rejects promptly without waiting for outstanding downloads',rejection===reason&&sig.listeners.size===0);
  check('mid-load abort releases completed and pending texture handles once',t.calls.every(e=>e.disposals===1));
  for(let i=0;i<textureCount;i++)if(i!==0&&i!==4)t.success(i);await promise;await flush();check('late successful callbacks never resurrect retired resources or double-dispose',t.calls.every(e=>e.disposals===1));
}
{
  const t=transport(),sig=trackedSignal();const promise=loadKartTerrainAssets(t.api,{environment:'alpine',signal:sig.signal});const rejected=assert.rejects(promise,error=>error.name==='AbortError');sig.controller.abort();await rejected;check('default abort exposes standard AbortError',t.calls.every(e=>e.disposals===1)&&sig.listeners.size===0);for(let i=0;i<textureCount;i++)t.fail(i);await flush();check('late failed callbacks after abort remain handled and disposed once',t.calls.every(e=>e.disposals===1));
}
for(let failing=0;failing<textureCount;failing++){
  const t=transport(),sig=trackedSignal(),reason=Error('Missing channel '+failing);let rejection;const promise=loadKartTerrainAssets(t.api,{environment:'alpine',signal:sig.signal}).catch(e=>{rejection=e;});
  t.fail(failing,reason);await flush();check('channel '+failing+' failure preserves error, releases all partial/pending resources and listener',rejection===reason&&t.calls.every(e=>e.disposals===1)&&sig.listeners.size===0);
  for(let i=0;i<textureCount;i++)if(i!==failing)t.success(i);await promise;await flush();check('channel '+failing+' late successes remain retired exactly once',t.calls.every(e=>e.disposals===1));
}
{
  const t=transport({throwsAt:4}),sig=trackedSignal();const promise=loadKartTerrainAssets(t.api,{environment:'alpine',signal:sig.signal});await assert.rejects(promise,/Synchronous transport failure/);check('synchronous loader error disposes allocated handles and removes abort listener',t.calls.filter(e=>e.texture).every(e=>e.disposals===1)&&sig.listeners.size===0);for(let i=0;i<t.calls.length;i++)if(t.calls[i].texture)t.success(i);await flush();check('late callbacks after synchronous failure do not double-dispose',t.calls.filter(e=>e.texture).every(e=>e.disposals===1));
}
{
  const a=transport(),b=transport(),first=loadKartTerrainAssets(a.api,{environment:'alpine',baseURL:'/qa-terrain'}),second=loadKartTerrainAssets(b.api,{environment:'alpine'});for(let i=0;i<textureCount;i++){a.success(i);b.success(i);}const ta=await first,tb=await second;
  check('custom local baseURL is respected without changing source scale/channel rules',a.calls.every(e=>e.url.startsWith('/qa-terrain/')));
  check('independent loads never share mutable Texture resources',![...ta.textures].some(t=>tb.textures.has(t)));
  ta.dispose();check('disposing one world cannot destroy a second world terrain',a.calls.every(e=>e.disposals===1)&&b.calls.every(e=>e.disposals===0)&&tb.textures.size===textureCount);tb.dispose();
}
{
  const t=transport(),promise=loadKartTerrainAssets(t.api,{environment:'alpine'});for(let i=0;i<textureCount;i++)t.success(i);const terrain=await promise,scene=new THREE.Scene(),world=createKartElevatedWorld(THREE,{scene,map:elevatedMap('garden'),terrain});
  const material=world.colliderMeshes.get('floor').body.material;
  check('actual Garden world uses the supplied PBR pack without replacing support descriptors',material.userData.floorComposition.pbr&&world.colliderMeshes.size===elevatedMap('garden').colliders.length&&material.map===terrain.sets.limestone.map&&material.normalMap===terrain.sets.limestone.normalMap&&material.roughnessMap===terrain.sets.limestone.roughnessMap);
  assert.deepEqual([...world.colliderMeshes.values()].map(w=>w.descriptor),elevatedMap('garden').colliders);check('all terrain-treated solid descriptors exactly preserve shared physical map data',true);
  check('real Alpine floor contains no Harbor puddle disks or cargo paint',!world.group.getObjectByName('flush-wet-dock-patches')&&!world.group.getObjectByName('inset-cargo-bay-paint'));
  const gpu=[...terrain.textures].reduce((n,t)=>n+Math.round(t.image.width*t.image.height*4*4/3),0),stats=world.stats();
  check('world stats account for every external terrain image with decoded dimensions and mips',stats.textureCount>=textureCount&&stats.textureBytes>=gpu&&Math.abs(gpu-manifest.rgbaGpuBytesWithMipmapsIfAllLoaded)<=textureCount);
  const shader={uniforms:{},vertexShader:'#include <project_vertex>',fragmentShader:'#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>'};material.onBeforeCompile(shader);
  check('floor shader binds actual albedo/normal/roughness for only its three floor families',floorFamilies.every(family=>['map','normalMap','roughnessMap'].every(channel=>shader.uniforms['alpine_'+family+'_'+channel].value===terrain.sets[family][channel]))&&!Object.keys(shader.uniforms).some(k=>k.startsWith('alpine_wall_')));
  const walls=[...world.colliderMeshes].filter(([id,{descriptor:d}])=>id!=='floor'&&d.material!=='steel'&&d.material!=='hedge'&&d.material!=='barrier'&&!d.material?.startsWith('cargo-'));
  check('independent masonry skin uses wall PBR resources rather than ground cobble',walls.length>0&&walls.every(([,w])=>w.body.material.map===terrain.sets.wall.map&&w.body.material.normalMap===terrain.sets.wall.normalMap&&w.body.material.roughnessMap===terrain.sets.wall.roughnessMap));
  check('PBR blend mask is linear data and base tint is white',shader.uniforms.alpineMask.value.colorSpace===THREE.NoColorSpace&&material.color.equals(new THREE.Color(0xffffff)));
  const before=world.stats();for(let i=0;i<180;i++)world.animate(1/60,i/60,i/179);check('world animation does not allocate or lose terrain images',JSON.stringify(before)===JSON.stringify(world.stats())&&terrain.textures.size===textureCount&&t.calls.every(e=>e.disposals===0));
  world.dispose();world.dispose();terrain.dispose();check('world removal releases owned terrain exactly once, including shader-only resources',scene.children.length===0&&terrain.textures.size===0&&t.calls.every(e=>e.disposals===1));
}
{
  const scene=new THREE.Scene(),world=createKartElevatedWorld(THREE,{scene,map:elevatedMap('neon')});
  check('Harbor retains intentional wet-dock patches and cargo paint',world.group.getObjectByName('flush-wet-dock-patches')?.count>0&&world.group.getObjectByName('inset-cargo-bay-paint')?.count>0);
  world.dispose();check('Harbor diagnostic world also removes its owned scene',scene.children.length===0);
}
{
  // Exercise the real world's borrowing boundary with small real Three meshes.
  // Native fixture loads the actual GLBs; these are ownership/LOD checks only.
  const t=transport(),promise=loadKartTerrainAssets(t.api,{environment:'alpine'});for(let i=0;i<textureCount;i++)t.success(i);const terrain=await promise;
  const atlas=new THREE.Texture({width:512,height:512}),geometry=new THREE.PlaneGeometry(.185,.14).translate(0,.07,0),sourceMaterial=new THREE.MeshStandardMaterial({map:atlas,alphaTest:.5,side:THREE.DoubleSide}),source=new THREE.Group(),sourceDisposals={geometry:0,material:0,atlas:0};
  const originalPositions=Array.from(geometry.attributes.position.array);
  geometry.addEventListener('dispose',()=>sourceDisposals.geometry++);sourceMaterial.addEventListener('dispose',()=>sourceDisposals.material++);atlas.addEventListener('dispose',()=>sourceDisposals.atlas++);source.add(new THREE.Mesh(geometry,sourceMaterial));
  const map=elevatedMap('garden'),scene=new THREE.Scene(),world=createKartElevatedWorld(THREE,{scene,map,terrain,assets:{grass:source,grassLOD:source}}),camera=new THREE.PerspectiveCamera(52,568/320,.1,650);camera.position.set(-44,5.04,-48.5);camera.lookAt(-44,2.04,-36);world.updateDetail(camera,.25);
  const grass=[];world.group.traverse(o=>{if(o.isInstancedMesh&&o.name.startsWith('meadow-authored-grass-'))grass.push(o);});
  check('authored foliage uses borrowed geometry/atlas and owned cloned alpha-cutout materials',grass.length===2&&grass.every(o=>o.geometry===geometry&&o.material!==sourceMaterial&&o.material.map===atlas&&o.material.alphaTest===.5&&!o.castShadow));
  check('camera detail populates both bounded near and far actual instance batches',grass.every(o=>o.count>0&&o.count<=850)&&grass.reduce((n,o)=>n+o.count,0)<=850);
  const near=grass.find(o=>o.name.includes('-near-')),far=grass.find(o=>o.name.includes('-far-')),position=new THREE.Vector3(),matrix=new THREE.Matrix4();
  const distanceChecks=(o,lower,upper)=>{for(let i=0;i<o.count;i++){o.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);const distance=Math.hypot(position.x-camera.position.x,position.z-camera.position.z);if(distance<lower||distance>=upper)return false;}return true;};
  check('near/far partition obeys nineteen metre split and forty-five metre cutoff',distanceChecks(near,0,19)&&distanceChecks(far,19,45));
  const sourceHeight=JSON.parse(fs.readFileSync(new URL('../assets-source/karts/terrain-20261007/grass-clump-provenance.json',import.meta.url))).boundsMetres[1],scale=new THREE.Vector3();let bounded=true,clear=true;
  for(const o of grass)for(let i=0;i<o.count;i++){o.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);scale.setFromMatrixScale(matrix);bounded&&=scale.y*sourceHeight<.75&&Math.abs(position.y-.008)<1e-7;clear&&=Math.abs(position.x)<map.half&&Math.abs(position.z)<map.half&&map.spawns.every(p=>Math.hypot(position.x-p.x,position.z-p.z)>=3)&&map.sockets.every(p=>Math.hypot(position.x-p.x,position.z-p.z)>=1.3)&&map.colliders.every(d=>d.id==='floor'||Math.abs(position.x-d.position.x)>=d.half.x+.7||Math.abs(position.z-d.position.z)>=d.half.z+.7);}
  check('actual source grass height stays under .75m on the existing ground support',bounded);
  check('vegetation centres preserve spawn, socket and shared-solid clearance envelopes',clear);
  check('world instancing/wind never changes borrowed source topology',JSON.stringify(originalPositions)===JSON.stringify(Array.from(geometry.attributes.position.array)));
  const shader={uniforms:{},vertexShader:'#include <begin_vertex>'};near.material.onBeforeCompile(shader);world.animate(1/60,8,.5);check('authored grass shader wind shares the finite scene-owned time uniform',shader.uniforms.alpineGrassTime.value===8&&shader.vertexShader.includes('instanceMatrix'));
  const clonedDisposals=grass.map(o=>{const count={n:0};o.material.addEventListener('dispose',()=>count.n++);return count;});world.dispose();world.dispose();
  check('world releases foliage clones once and leaves scene-owner GLB geometry/atlas intact',clonedDisposals.every(c=>c.n===1)&&Object.values(sourceDisposals).every(n=>n===0)&&scene.children.length===0&&terrain.textures.size===0);
  geometry.dispose();sourceMaterial.dispose();atlas.dispose();
}
// Validate the files against the real asset ledger, not hardcoded byte counts.
{
  const t=transport(),promise=loadKartTerrainAssets(t.api,{environment:'alpine'});for(let i=0;i<textureCount;i++)t.success(i);const terrain=await promise;
  const nature=new THREE.Group(),atlas=new THREE.Texture({width:512,height:512}),geometry=new THREE.BoxGeometry(4,8,4).translate(0,4,0),sourceMaterial=new THREE.MeshStandardMaterial({map:atlas}),disposals={geometry:0,material:0,atlas:0};
  geometry.addEventListener('dispose',()=>disposals.geometry++);sourceMaterial.addEventListener('dispose',()=>disposals.material++);atlas.addEventListener('dispose',()=>disposals.atlas++);
  for(const name of ['SpruceA','SpruceB','SpruceA_Low','SpruceB_Low','LimestoneOutcrop']){const root=new THREE.Group();root.name=name;root.position.set(4,5,6);const mesh=new THREE.Mesh(geometry,sourceMaterial);mesh.position.set(.3,.1,-.2);root.add(mesh);nature.add(root);}
  const before=nature.children.map(o=>({p:o.position.toArray(),child:o.children[0].position.toArray()})),scene=new THREE.Scene(),map=elevatedMap('garden'),world=createKartElevatedWorld(THREE,{scene,map,terrain,assets:{nature}}),batches=[];world.group.traverse(o=>{if(o.isInstancedMesh&&o.name.startsWith('authored-'))batches.push(o);});
  check('authored nature replaces all procedural cone crowns and dodeca rocks',batches.length===5&&!world.group.getObjectByName('clustered-fir-crowns')&&!world.group.getObjectByName('broken-limestone-outcrops'));
  const instance=new THREE.Matrix4(),box=new THREE.Box3();geometry.computeBoundingBox();let outside=true,finite=true;
  for(const mesh of batches)for(let i=0;i<mesh.instanceMatrix.count;i++){mesh.getMatrixAt(i,instance);finite&&=instance.elements.every(Number.isFinite);box.copy(geometry.boundingBox).applyMatrix4(instance);outside&&=box.max.x<-map.half-2||box.min.x>map.half+2||box.max.z<-map.half-2||box.min.z>map.half+2;}
  check('complete authored nature bounds stay finite and outside the physical arena',finite&&outside);
  const camera=new THREE.PerspectiveCamera(52,568/320,.1,650);camera.position.set(-44,5.04,-48.5);camera.lookAt(-44,2.04,-36);world.updateDetail(camera,.25);
  const trees=batches.filter(o=>o.name.startsWith('authored-fir-'));check('nature camera detail selects visible bounded near/far source batches',trees.every(o=>o.count>0&&o.count<=32));
  check('borrowed root and child local transforms remain unchanged',JSON.stringify(before)===JSON.stringify(nature.children.map(o=>({p:o.position.toArray(),child:o.children[0].position.toArray()}))));
  const clones=batches.map(o=>{const c={n:0};o.material.addEventListener('dispose',()=>c.n++);return c;});world.dispose();world.dispose();check('nature clones release once while library geometry and atlas remain scene-owned',clones.every(c=>c.n===1)&&Object.values(disposals).every(n=>n===0)&&scene.children.length===0);geometry.dispose();sourceMaterial.dispose();atlas.dispose();
  const data=fs.readFileSync(new URL('../public/assets/karts/environment/alpine-nature.glb',import.meta.url)),gltf=JSON.parse(data.subarray(20,20+data.readUInt32LE(12)));
  check('actual nature metadata never passes a text pivot into pinned GLTFLoader numeric pivot handling',gltf.nodes.every(n=>n.extras?.pivot===undefined||(Array.isArray(n.extras.pivot)&&n.extras.pivot.length===3&&n.extras.pivot.every(Number.isFinite))));
}
{
  const buffer=fs.readFileSync(new URL('../public/assets/karts/terrain/grass-clumps.glb',import.meta.url)),gltf=JSON.parse(buffer.subarray(20,20+buffer.readUInt32LE(12)));
  for(const name of ['GrassClump','GrassClumpLOD']){
    const node=gltf.nodes.find(n=>n.name===name);
    check(name+' lookup uniquely identifies its mesh, never the encompassing GLB scene',!!node&&Number.isInteger(node.mesh)&&gltf.nodes.filter(n=>n.name===name).length===1&&!gltf.scenes.some(s=>s.name===name));
  }
  check('near/far bundle shares exactly one material, image and texture',gltf.materials.length===1&&gltf.images.length===1&&gltf.textures.length===1&&gltf.meshes.every(m=>m.primitives.every(p=>p.material===0)));
  const view=gltf.bufferViews[gltf.images[0].bufferView],imageStart=28+buffer.readUInt32LE(12)+(view.byteOffset||0);
  check('shared grass atlas remains a bounded actual512px RGBA PNG',gltf.images[0].mimeType==='image/png'&&buffer.readUInt32BE(imageStart+16)===512&&buffer.readUInt32BE(imageStart+20)===512&&buffer[imageStart+25]===6);
}
{
  let closes=0;const image={width:512,height:512,close(){closes++;}},first=new THREE.Texture(image),alias=new THREE.Texture(image),library=new THREE.Group(),material=new THREE.MeshStandardMaterial({map:first,normalMap:alias}),geometry=new THREE.BoxGeometry();library.add(new THREE.Mesh(geometry,[material,material]));library.add(new THREE.Mesh(geometry,material));
  check('borrowed bitmap stays open throughout active library use',closes===0);
  check('actual retirement helper closes one shared image exactly once across material and texture aliases',closeKartAssetBitmaps(library)===1&&closes===1);
  check('empty retired library closes nothing',closeKartAssetBitmaps(new THREE.Group())===0);geometry.dispose();material.dispose();first.dispose();alias.dispose();
}
let bytes=0;
for(const[family,material]of Object.entries(manifest.materials))for(const[channel,map]of Object.entries(material.maps)){
  const data=fs.readFileSync(new URL('../public'+map.url,import.meta.url));bytes+=data.length;check(family+' '+channel+' bytes/hash match published local manifest',data.length===map.bytes&&crypto.createHash('sha256').update(data).digest('hex')===map.sha256);
}
check('asset ledger total equals actual served terrain bytes',manifest.productionBytes===bytes);
check('active-map PBR channels stay within the approved twenty-eight MiB decoded mip budget',manifest.rgbaGpuBytesWithMipmapsIfAllLoaded<=28*1024*1024);
check('PBR source ledger explicitly records OpenGL normals and separate color/data channels',manifest.normalConvention.includes('OpenGL')&&Object.values(manifest.materials).every(m=>m.maps.color.colorSpace==='sRGB'&&m.maps.normal.colorSpace==='linear-data'&&m.maps.roughness.colorSpace==='linear-data'));
console.log(JSON.stringify({pass:true,checks:checks.length,results:checks,families,textureCount,productionBytes:bytes,scope:'Actual async terrain loader, controlled TextureLoader transport with real THREE.Texture ownership; shipped manifest bytes/hashes. Native texture decoding, shader/material appearance and real WebGL separately reviewed.'},null,2));
