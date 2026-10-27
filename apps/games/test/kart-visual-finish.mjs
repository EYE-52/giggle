import {MeshoptDecoder} from '../public/vendor/three/libs/meshopt_decoder.mjs';
await MeshoptDecoder.ready;
/* Fixed presentation contract on the actual original GLB and its pooled
 * failure fallback. Runtime input/authority are covered by their own suites. */
import nativeAssert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createKartCombatArt} from '../public/js/engines/kart-combat-art.mjs';
let checks=0;
const assert=(condition,message)=>{checks++;nativeAssert(condition,message);};
const bytes=await fs.readFile(new URL('../public/assets/karts/combat/combat.meshopt.glb',import.meta.url));
const library=(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
const bounds=o=>{o.updateWorldMatrix(true,true);return new THREE.Box3().setFromObject(o);};
for(const [label,assets] of [['GLB',library],['fallback',null]]) {
 const art=createKartCombatArt(THREE,{assets});
 for(const kind of ['pulse','scatter']) {
  const shot=art.projectile(kind),tail=shot.userData.combat.tail;
  const body=shot.getObjectByName(label==='GLB'?'Bolt'+kind[0].toUpperCase()+kind.slice(1)+'Body':kind==='pulse'?'PulseBody':'ScatterBody');
  assert(body.material.isMeshStandardMaterial,label+' '+kind+' is shaded solid metal');
  assert(body.material.metalness>=.5,label+' '+kind+' metal stock');
  assert(body.material.emissive.getHex()===0,label+' '+kind+' body does not glow like exhaust');
  assert(!body.material.transparent,label+' '+kind+' body is opaque');
  assert(tail.material.blending===THREE.NormalBlending,label+' '+kind+' tracer does not add a fire bloom');
  const bs=bounds(body).getSize(new THREE.Vector3()),ts=bounds(tail).getSize(new THREE.Vector3());
  const range=kind==='pulse'?[1.25,1.6]:[.9,1.2];
  assert(bs.z>=range[0]&&bs.z<=range[1],label+' '+kind+' calibrated visible bullet length');
  assert(ts.z<bs.z*.6,label+' '+kind+' short tracer leaves solid slug dominant');
  assert(Math.max(ts.x,ts.y)<Math.max(bs.x,bs.y)*.25,label+' '+kind+' tracer stays pencil thin');
  assert(Math.max(ts.x,ts.y)<(kind==='pulse'?.061:.051),label+' '+kind+' tracer respects calibrated pencil-thin diameter');
  assert(bounds(tail).max.z<=bounds(body).min.z+.001,label+' '+kind+' tracer trails the solid bullet');
  const positions=tail.geometry.attributes.position;
  let lo=Infinity,hi=-Infinity;
  for(let i=0;i<positions.count;i++){const radius=Math.hypot(positions.getX(i),positions.getY(i));if(radius<.001)continue;lo=Math.min(lo,radius);hi=Math.max(hi,radius);}
  assert(hi-lo<.001,label+' '+kind+' tracer is a straight cylinder, not a flame cone');
 }
 const mine=art.mine(true),lamp=mine.userData.combat.glow,cap=mine.userData.combat.cap;
 const ls=bounds(lamp).getSize(new THREE.Vector3());
 assert(Math.max(ls.x,ls.z)<.3,label+' mine lamp is a tiny component rather than radius ring');
 assert(lamp.material.color.getHex()===0xff2a35,label+' mine status lamp is red');
 assert(bounds(lamp).max.y<bounds(cap).max.y,label+' lamp is recessed below metal collar');
 assert(bounds(lamp).min.y>.25,label+' mine lamp lives on the mine, never on the ground');
 assert(Math.abs(bounds(mine).min.y)<.001,label+' solid mine base rests on ground');
 const rig=art.weapon('scatter');
 const muzzle=rig.getObjectByName('ScatterMuzzles');
 rig.updateMatrixWorld(true);
 const ray=new THREE.Raycaster();
 for(const [x,y]of [[0,.42],[-.17,.18],[.17,.18]]){
  ray.set(new THREE.Vector3(x,y,1.5),new THREE.Vector3(0,0,-1));
  assert(ray.intersectObject(muzzle,true).length===0,label+' scatter muzzle has a real open bore');
 }
 art.dispose();art.dispose();
}
console.log(`KART_VISUAL_FINISH_PASS: ${checks} assertions; primary/fallback metal slugs, straight tracers, actual muzzles and recessed mine lamp`);
