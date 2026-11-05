import {MeshoptDecoder} from '../public/vendor/three/libs/meshopt_decoder.mjs';
await MeshoptDecoder.ready;
/* Kept-arsenal contract for the non-bolt weapons (seeker, Proximity Bomb,
 * nuke) on the shipping GLB lookup and on the failure fallback, plus proof
 * that the retired kinds are gone from the public factory. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createKartCombatArt,COMBAT_ART_BUDGETS} from '../public/js/engines/kart-combat-art.mjs';
const KEPT=['pulse','scatter','mine','rocket','seeker','proximity','shield','nuke'];
const SHOTS=['pulse','scatter','rocket','seeker','proximity','nuke'];
const RETIRED=['rail','grenade','emp','bomb','sentry','spikes'];
const load=async name=>{
 const bytes=await fs.readFile(new URL('../public/assets/karts/combat/'+name+'.glb',import.meta.url));
 return (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
};
const oldSelf=globalThis.self,oldImageBitmap=globalThis.createImageBitmap;
globalThis.self=globalThis;
globalThis.createImageBitmap=async blob=>{const b=Buffer.from(await blob.arrayBuffer());return{width:b.readUInt32BE(16),height:b.readUInt32BE(20),close(){}};};
let packs;
try{packs={combat:await load('combat.meshopt'),pulse:await load('pulse-mounted.meshopt'),arsenal:await load('arsenal-mounted.meshopt')};}
finally{
 if(oldSelf===undefined)delete globalThis.self;else globalThis.self=oldSelf;
 if(oldImageBitmap===undefined)delete globalThis.createImageBitmap;else globalThis.createImageBitmap=oldImageBitmap;
}
const get=name=>packs.pulse.getObjectByName(name)||packs.arsenal.getObjectByName(name)||packs.combat.getObjectByName(name);
for(const name of ['Bomb','BombMuzzleTip','BombShot','BombShotLamp','Seeker','SeekerShot'])assert(get(name),name+' authored node is present');
const meshes=o=>{const out=[];o.traverse(m=>{if(m.isMesh)out.push(m);});return out;};
for(const [label,assets]of [['GLB',{get}],['fallback',null]]){
 const art=createKartCombatArt(THREE,{assets});
 assert.equal(art.sentry,undefined,label+' sentry() is retired');
 assert.equal(art.spikes,undefined,label+' spikes() is retired');
 // Every kept kind is honoured verbatim, so a view can key pools by kind.
 for(const kind of KEPT){const rig=art.weapon(kind);assert.equal(rig.userData.combat.type,'weapon');assert.equal(rig.userData.combat.kind,kind,label+' weapon('+kind+') kind');}
 for(const kind of SHOTS){const shot=art.projectile(kind);assert.equal(shot.userData.combat.type,'projectile');assert.equal(shot.userData.combat.kind,kind,label+' projectile('+kind+') kind');assert(meshes(shot).length<=COMBAT_ART_BUDGETS.projectile,label+' '+kind+' shot budget');}
 // Retired kinds are no longer special: they normalize like any unknown kind.
 for(const kind of RETIRED){assert.equal(art.weapon(kind).userData.combat.kind,'pulse',label+' retired weapon '+kind+' -> pulse');assert.equal(art.projectile(kind).userData.combat.kind,'pulse',label+' retired shot '+kind+' -> pulse');}
 const prox=art.weapon('proximity'),nuke=art.weapon('nuke');
 assert.equal(prox.name,'ProximityLayer');assert.equal(nuke.name,'NukeLauncher');
 for(const rig of [prox,nuke])assert(rig.userData.combat.muzzle[2]>0&&rig.userData.combat.barrels===1,label+' '+rig.name+' launches forward');
 if(assets){
  assert(prox.getObjectByName('BombStowedDynamite'),'GLB proximity uses the dynamite launcher rig');
  assert(!prox.getObjectByName('BombMuzzleTip'),'GLB proximity clone prunes its muzzle helper');
  const tip=get('BombMuzzleTip');get('Bomb').updateWorldMatrix(true,true);const local=get('Bomb').worldToLocal(tip.getWorldPosition(new THREE.Vector3()));
  assert(local.distanceTo(new THREE.Vector3(...prox.userData.combat.muzzle))<1e-5,'GLB proximity muzzle is calibrated from BombMuzzleTip');
  assert(nuke.getObjectByName('RocketHousing'),'GLB nuke uses the rocket rig');
 }
 // Proximity charge: dynamite bundle, lamp tail, settle + armed lamp.
 const charge=art.projectile('proximity'),c=charge.userData.combat;
 assert.equal(c.armed,false);assert.equal(c.landed,false);assert(c.tail?.isMesh,label+' proximity has a status lamp');
 if(assets){assert(charge.getObjectByName('BombShotDynamite'),'GLB proximity is the dynamite BombShot');assert.equal(c.tail.name,'BombShotLamp');}
 c.rollRate=4;art.animate(charge,.1,1,false);assert(c.inner.rotation.x>0,label+' rolling charge turns with rollRate');
 assert.equal(c.tail.visible,false,label+' unarmed charge hides its lamp');
 const rolled=c.inner.rotation.x;c.landed=true;c.armed=true;art.animate(charge,.1,2,false);
 assert.equal(c.inner.rotation.x,rolled,label+' landed charge stops rolling');assert.equal(c.tail.visible,true,label+' armed charge shows its lamp');
 art.animate(charge,.1,3,true);assert.equal(c.inner.rotation.x,0,label+' reduced motion snaps the charge upright');
 const before=charge.position.clone();for(let i=0;i<120;i++)art.animate(charge,.016,i*.016,false);
 assert(charge.position.equals(before),label+' cosmetics do not mutate authoritative placement');
 const again=art.projectile('proximity');assert.deepEqual(meshes(again).map(m=>m.geometry),meshes(charge).map(m=>m.geometry),label+' charges share GPU resources');
 art.dispose();art.dispose();
}
console.log('KART_EXPANDED_ART_PASS: kept 8-weapon kinds, retired factory entries gone, proximity dynamite + nuke launcher on GLB and fallback');
