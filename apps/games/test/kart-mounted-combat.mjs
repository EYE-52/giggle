import {MeshoptDecoder} from '../public/vendor/three/libs/meshopt_decoder.mjs';
await MeshoptDecoder.ready;
// Actual loaded GLBs through the production combat factory, including chassis
// transforms, deployed traps, moving canisters and borrowed resource ownership.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createKartCombatArt} from '../public/js/engines/kart-combat-art.mjs';
import {createKartModel,disposeKartModel} from '../public/js/engines/kart-model.mjs';
import {WEAPON_IDS,CURATED_MUZZLE} from '../public/js/engines/kart-weapon-contract.mjs';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
let checks=0;const check=(v,m)=>{assert.ok(v,m);checks++;};
globalThis.self=globalThis;
globalThis.createImageBitmap=async blob=>{
  const b=Buffer.from(await blob.arrayBuffer());check(b.subarray(1,4).toString()==='PNG','Actual embedded image resolves as PNG');
  return{width:b.readUInt32BE(16),height:b.readUInt32BE(20),close(){}};
};
async function load(file){const b=await fs.readFile(new URL('../public/assets/karts/'+file+'.glb',import.meta.url));return(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;}
const [kart,pulse,arsenal,secondary,old,gear]=await Promise.all(['giggle-kart.meshopt','combat/pulse-mounted.meshopt','combat/arsenal-mounted.meshopt','combat/arsenal-secondary.meshopt','combat/combat.meshopt','combat/pickup-gear'].map(load));
const borrowed=new Set();for(const root of [kart,pulse,arsenal,secondary,old,gear])root.traverse(o=>{if(o.geometry)borrowed.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m){borrowed.add(m);for(const value of Object.values(m))if(value?.isTexture)borrowed.add(value);}});
let borrowedDisposals=0;for(const resource of borrowed)resource.addEventListener('dispose',()=>borrowedDisposals++);
const art=createKartCombatArt(THREE,{assets:{get:name=>gear.getObjectByName(name)||pulse.getObjectByName(name)||arsenal.getObjectByName(name)||(name!=='ScatterShot'&&secondary.getObjectByName(name))||old.getObjectByName(name)}});
for (const [kind, library, name] of [['pulse', pulse, 'Pulse'], ['rocket', arsenal, 'Rocket'], ['seeker', arsenal, 'Seeker']]) {
  const source = library.getObjectByName(name);
  const first = art.weapon(kind), second = art.weapon(kind);
  const originalHousing = source.getObjectByName(name + 'Housing');
  const firstHousing = first.getObjectByName(name + 'Housing');
  const secondHousing = second.getObjectByName(name + 'Housing');
  const originalSize = new THREE.Box3().setFromObject(originalHousing).getSize(new THREE.Vector3());
  const readableSize = new THREE.Box3().setFromObject(firstHousing).getSize(new THREE.Vector3());
  check(Math.abs(readableSize.x / originalSize.x - 1.4) < 1e-5, kind + ' upper housing is readable at approved width');
  check(Math.abs(readableSize.y - originalSize.y) < 1e-5 && Math.abs(readableSize.z - originalSize.z) < 1e-5, kind + ' height and length remain authored');
  check(firstHousing.geometry === secondHousing.geometry && firstHousing.geometry !== originalHousing.geometry, kind + ' widened geometry is pooled without editing borrowed assets');
  const saddle = source.getObjectByName(name + 'Saddle');
  check(first.getObjectByName(name + 'Saddle').geometry === saddle.geometry, kind + ' mounting feet remain untouched');
}
const recoiling = art.weapon('pulse');
art.recoil(recoiling);
art.animate(recoiling, .04, 0, false);
check(recoiling.getObjectByName('PulseHousing').position.z < -.1, 'Confirmed fire gives bounded rearward recoil');
art.animate(recoiling, .04, 0, true);
check(recoiling.getObjectByName('PulseHousing').position.z === 0, 'Reduced motion retains the authored mounting pose');
art.animate(recoiling, .1, 0, false);
check(Math.abs(recoiling.getObjectByName('PulseHousing').position.z) < 1e-8, 'Recoil naturally returns to the authored muzzle');
const model=createKartModel(THREE,{assets:{kart},color:0xf59539});model.userData.kart.inner.position.y=CONFIG.chassis.modelOriginY;
for(const kind of ['pulse','scatter','rocket','seeker','machinegun','trishot','missile','cannon','frost','nuke']){
  const weapon=art.weapon(kind),c=weapon.userData.combat;
  model.userData.kart.inner.add(weapon);weapon.position.set(...c.mount);
  const local=WEAPON_IDS.includes(kind)?CURATED_MUZZLE:CONFIG.combat[kind+'Muzzle']||{x:0,y:.5,z:1.9};
  for(const heading of [0,Math.PI/2,Math.PI,-Math.PI/2]){
    model.position.set(12,.64,-8);model.rotation.set(0,heading,0);model.updateMatrixWorld(true);
    const actual=weapon.localToWorld(new THREE.Vector3(...c.muzzle));
    const expected=model.localToWorld(new THREE.Vector3(local.x,local.y,local.z));
    check(actual.distanceTo(expected)<1e-5,kind+' production factory muzzle matches authority at heading '+heading);
  }
  check(WEAPON_IDS.includes(kind)?weapon.getObjectByName('Gear_'+kind):c.inner.children[0].name===kind[0].toUpperCase()+kind.slice(1),kind+' uses the sourced branch');weapon.removeFromParent();
}
// Real decoded artwork, including Meshopt transforms, must fit the kart.
for(const kind of WEAPON_IDS){
 const rig=art.weapon(kind),c=rig.userData.combat;
 check(rig.getObjectByName('Gear_'+kind),kind+' uses its authored model');
 art.placeWeapon(rig);
 const bounds=new THREE.Box3().setFromObject(rig);
 if(kind==='blades'){
  check(bounds.max.y<.7&&bounds.max.x>=2.1&&bounds.min.x<=-2.1,'bumper reaches both sides at wheel height');
 }else if(kind==='ram'){
  check(bounds.min.z>.7&&bounds.max.y<1.1&&bounds.max.x>1.2,'ram mounts below the driver on the nose');
 }else{
  check(bounds.max.x<-.33||bounds.min.x>.35,kind+' leaves the center of the kart clear');
 }
 if(kind==='machinegun'){
  const chassis=new THREE.Group();chassis.rotation.set(.25,1.1,0);chassis.add(rig);
  c.firing=true;
  for(const target of [[0,0,-1],[-1,0,0],[.3,.2,.8]]){
   const direction=new THREE.Vector3(...target).normalize();
   art.aim(rig,direction);art.animate(rig,1/60,0,true);
   check(c.inner.getWorldDirection(new THREE.Vector3()).angleTo(direction)<1e-6,
    'tracking pod faces the authoritative shot while the kart turns and climbs');
  }
  chassis.remove(rig);
 }
 if(kind==='mine')check(c.rounds.every(round=>round?.isMesh&&round.geometry===c.rounds[0].geometry),'three trail tokens share one sourced geometry');
 if(kind==='cannon'||kind==='mine')for(const count of [3,2,1,0,3]){
  c.ammo=count;art.animate(rig,.02,1,false);
  check(c.rounds.filter(rocket=>rocket.visible).length===count,kind+' rack reflects '+count+' remaining rounds');
 }
}
for(const kind of ['scatter','rocket','seeker','proximity','nuke']){
  const shot=art.projectile(kind);check(shot.userData.combat.kind===kind,kind+' is not silently coerced to Pulse');
  const glow=shot.getObjectByName('ShotGlow');check(glow?.isSprite&&glow.material.depthWrite===false,kind+' shot carries one additive glow');shot.remove(glow);
  const box=new THREE.Box3().setFromObject(shot),size=box.getSize(new THREE.Vector3());shot.add(glow);
  check(size.toArray().every(n=>Number.isFinite(n)&&n>0)&&size.length()<3,kind+' actual shot has bounded physical art');
  if(['rocket','seeker','nuke'].includes(kind)){
    const c=shot.userData.combat,tail=c.tail;check(!!tail&&tail.material.isMeshBasicMaterial,kind+' exhaust is an unlit cosmetic mesh');
    // Keep the unchanged whole-object size limit above: decorative art still
    // shares the player's visual/clearance envelope, even without collision.
    for(const reduced of [false,true])for(let i=0;i<60;i++){
      art.animate(shot,1/60,i/60,reduced);
      shot.remove(glow);const frameBox=new THREE.Box3().setFromObject(shot);shot.add(glow);
      check(frameBox.getSize(new THREE.Vector3()).length()<3,kind+' complete animated exhaust remains inside the same art budget');
    }
    const hull=new THREE.Box3().setFromObject(c.inner.children[0]);
    check(box.max.z===hull.max.z,kind+' exhaust does not extend the solid forward nose');
    check(Math.abs(c.tipZ-hull.max.z)<1e-6&&Math.abs(c.tailZ-box.min.z)<1e-6,kind+' calibrated metadata follows its actual solid nose and compact exhaust');
    if(kind==='nuke')check(c.inner.children[0].name==='RocketShot','Nuke calibration follows its actual reused RocketShot branch');
    check(box.min.z<hull.min.z&&hull.min.z-box.min.z<.6,kind+' compact exhaust is attached directly behind the source hull');
  }
  if(kind==='scatter')check(shot.userData.combat.inner.children[0].name==='BoltScatter','Scatter keeps its compact metal slug; foam dart candidate is not used');
  if(kind==='proximity'){
    shot.userData.combat.rollRate=12/.32;art.animate(shot,.02,1,false);
    check(Math.abs(shot.userData.combat.inner.rotation.x-.75)<1e-8,'Rolling Proximity Bomb turns with actual ground speed');
    shot.userData.combat.rollRate=0;art.animate(shot,.02,1.02,false);check(Math.abs(shot.userData.combat.inner.rotation.x-.75)<1e-8,'Stopped canister does not keep spinning');
    art.animate(shot,.02,1.04,true);check(shot.userData.combat.inner.rotation.x===0,'Reduced motion suppresses canister roll');
  }
}
for(const own of [true,false])for(const angle of [0,.25]){
  const trap=art.mine(own),normal=new THREE.Vector3(0,Math.cos(angle),Math.sin(angle));
  // The factory owns base-at-zero artwork; packet trigger-center conversion is
  // exercised through actual authority/adapter/view frames in kart-elevated-view.
  trap.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),normal);trap.updateMatrixWorld(true);
  let min=Infinity,max=-Infinity;const v=new THREE.Vector3();
  trap.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++){const height=v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld).dot(normal);min=Math.min(min,height);max=Math.max(max,height);}});
  check(Math.abs(min)<1e-5&&max<.3,'Trap sits on actual support plane without floating or clipping');
  check(trap.userData.combat.inner.children[0].name==='MineTrap','Ground hardware uses independently authored trap');
  trap.userData.combat.armed=false;art.animate(trap,.02,1,false);check(!trap.userData.combat.glow.visible,'Unarmed trap status lamp stays off');
}
check(!('spikes'in art)&&!('sentry'in art),'retired Spikes and Sentry have no art factories');
art.dispose();art.dispose();check(borrowedDisposals===0,'Factory retirement never destroys borrowed GLB resources');
disposeKartModel(model);
for(const resource of borrowed)resource.dispose();
console.log(JSON.stringify({pass:true,checks,scope:'Actual GLTFLoader and production factories; no native audio/visual or phone claim.'}));
