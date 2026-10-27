import {MeshoptDecoder} from '../public/vendor/three/libs/meshopt_decoder.mjs';
await MeshoptDecoder.ready;
/* Actual GLB and failure fallback identity for the non-bolt weapons. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createKartCombatArt} from '../public/js/engines/kart-combat-art.mjs';
const bytes=await fs.readFile(new URL('../public/assets/karts/combat/combat.meshopt.glb',import.meta.url));
const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
assert(bytes.length<400*1024,'expanded original combat library remains bounded');
for(const name of ['Grenade','GrenadeShot','EMP'])assert(gltf.scene.getObjectByName(name),name+' actual authored model is present');
for(const [label,assets]of [['GLB',gltf.scene],['fallback',null]]){
 const factory=createKartCombatArt(THREE,{assets});
 const live=factory.projectile('grenade'),launcher=factory.weapon('grenade'),emp=factory.weapon('emp');
 assert.equal(live.userData.combat.kind,'grenade');assert.equal(launcher.userData.combat.kind,'grenade');assert.equal(emp.userData.combat.kind,'emp');
 assert(live.getObjectByName('GrenadeCanister'),label+' is a cylindrical physical canister');
 assert(live.getObjectByName('GrenadeFuse'),label+' has a distinct fuse marker');
 assert(emp.getObjectByName('EMPBody')&&emp.getObjectByName('EMPCore'),label+' EMP is a pronged emitter');
 for(const [object,budget]of [[live,3],[launcher,3],[emp,2]]){
  let count=0;object.traverse(o=>{if(!o.isMesh)return;count++;assert(!/Sphere|Icosahedron/.test(o.geometry.type),label+' new items do not become glowing orbs');});
  assert(count<=budget,label+' mesh budget');
  const before=object.position.clone();for(let i=0;i<120;i++)factory.animate(object,.016,i*.016,false);
  assert(object.position.equals(before),label+' cosmetics do not mutate authoritative placement');
  factory.animate(object,.016,99,true);assert.equal(object.userData.combat.inner.rotation.z,0,label+' reduced-motion canister does not spin');
 }
 const box=new THREE.Box3().setFromObject(live),size=box.getSize(new THREE.Vector3());
 assert(size.y>.7&&size.y<1.2&&size.x<.9&&size.z<.9,label+' grenade reads as one compact canister');
 assert(launcher.userData.combat.muzzle[2]>0&&emp.userData.combat.muzzle[2]>0,label+' launch/discharge points face forward');
 assert.equal(emp.userData.combat.barrels,2,label+' two directed emitter prongs');
 const again=factory.projectile('grenade');assert.equal(again.getObjectByName('GrenadeCanister').geometry,live.getObjectByName('GrenadeCanister').geometry,label+' clones share owned GPU resources');
 factory.dispose();factory.dispose();
}
console.log('KART_EXPANDED_ART_PASS: actual GLB/fallback canister, launcher and EMP identity, budgets, +Z aim, pooling and reduced motion');
