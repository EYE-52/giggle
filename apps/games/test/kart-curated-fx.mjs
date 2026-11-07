import assert from 'node:assert/strict';
import * as THREE from 'three';
import {WEAPON_IDS,WEAPONS,TRI_FAN,weaponForward,WEAPON_ALIASES} from '../public/js/engines/kart-weapon-contract.mjs';
import {createKartCombatArt} from '../public/js/engines/kart-combat-art.mjs';
import {createArsenalFX} from '../public/js/engines/kart-arsenal-fx.mjs';
import {createKartImpactFX} from '../public/js/engines/kart-impact-fx.mjs';
import {createProjectilePlayback} from '../public/js/engines/kart-flight.mjs';
import {SYNTH_CUE_NAMES} from '../public/js/engines/kart-audio.mjs';
import {KART_WEAPON_INFO,kartWeaponDisplay} from '../public/js/engines/kart-weapon-hud.mjs';
import {WEAPON_THUMBNAILS} from '../public/js/engines/kart-assets.mjs';
let checks=0;const check=(ok,label)=>{assert.ok(ok,label);checks++;};
assert.deepEqual(Object.keys(KART_WEAPON_INFO).sort(),[...WEAPON_IDS].sort());
assert.deepEqual([...WEAPON_THUMBNAILS].sort(),[...WEAPON_IDS].sort());
for(const [old,id]of Object.entries(WEAPON_ALIASES))check(kartWeaponDisplay({weapon:old,ammo:1}).kind===id,old+' saved inventory has the current HUD name/icon');
for(const id of WEAPON_IDS)check(SYNTH_CUE_NAMES.includes(id),id+' distinct synth cue');
const art=createKartCombatArt(THREE),scene=new THREE.Scene(),fx=createArsenalFX(THREE,scene),impact=createKartImpactFX(THREE,scene);
for(const kind of ['machinegun','trishot','missile','cannon','blades','supernova']){
 const a=art.weapon(kind),b=art.weapon(kind),first=[],second=[];
 a.traverse(o=>{if(o.isMesh)first.push([o.geometry,o.material]);});b.traverse(o=>{if(o.isMesh)second.push([o.geometry,o.material]);});
 assert.deepEqual(first,second,'rigs share all geometry and materials');checks++;
 const original=first.map(([,m])=>[m.opacity,m.color.getHex(),m.version]);
 for(let i=0;i<120;i++){art.recoil(a);art.animate(a,1/60,i/60,false);}
 assert.deepEqual(first.map(([,m])=>[m.opacity,m.color.getHex(),m.version]),original,'animation leaves shared materials unchanged');checks++;
}
for(const yaw of [-2.5,0,.8,2.1]){
 const model=new THREE.Group(),inner=new THREE.Group(),rig=art.weapon('trishot');model.add(inner);inner.position.y=-.7;inner.add(rig);art.placeWeapon(rig);
 model.position.set(4,3,-2);model.rotation.y=yaw;model.updateMatrixWorld(true);
 for(let i=0;i<3;i++){
  const barrel=rig.getObjectByName('TriBarrel'+i),tip=barrel.localToWorld(new THREE.Vector3(0,0,.5));
  const expected=new THREE.Vector3((i-1)*.2,.5,1.9).applyQuaternion(model.quaternion).add(model.position);
  check(tip.distanceTo(expected)<1e-7,'actual tri barrel muzzle agrees with authority');
  check(barrel.getWorldDirection(new THREE.Vector3()).angleTo(new THREE.Vector3().copy(weaponForward(model.quaternion,TRI_FAN[i])))<1e-7,'actual tri barrel fan agrees with authority');
 }
}
const model=new THREE.Group();model.position.set(5,3,-2);model.rotation.set(.3,.7,-.2);scene.add(model);fx.warmStatus(model);
for(const reduced of [false,true])for(let i=0;i<360;i++){
 const age=i/60,k={bladesT:6-age,bladesAge:age,supernovaT:age<3?3-age:0};fx.status(model,k,{time:age});model.updateMatrixWorld(true);
 const center=model.localToWorld(new THREE.Vector3(0,.35,0));
 for(const blade of model.userData.arsenalStatus.blades.children){const p=blade.getWorldPosition(new THREE.Vector3());check(Math.abs(p.y-center.y)<1e-7&&Math.abs(Math.hypot(p.x-center.x,p.z-center.z)-2.2)<1e-7,'pitched kart orbit follows the authority world plane');}
}
fx.status(model,{bladesT:1,bladesAge:5,supernovaT:1},{elapsed:1.1});check(!model.userData.arsenalStatus.blades.visible&&!model.userData.arsenalStatus.nova.visible,'stale status packet cannot leave protection or blades behind');
fx.status(model,null);check(!model.userData.arsenalStatus.blades.visible&&!model.userData.arsenalStatus.nova.visible,'expired attachments hide immediately');
for(const weapon of ['machinegun','trishot','missile','cannon']){
 const event={id:'fire-'+weapon,type:'fire',weapon,position:{x:0,y:1,z:0},direction:{x:0,y:0,z:1}};impact.emit(event);fx.event(event);
 impact.update(2);fx.update(2);check(scene.getObjectByName('MachineGunCasings').count===0&&scene.getObjectByName('KartImpactFX').children.every(o=>!o.visible),weapon+' muzzle/casing particles retire');
}
for(const weapon of ['missile','cannon','supernova','nuke']){
 const event={id:'blast-'+weapon,type:'blast',weapon,position:{x:0,y:.5,z:0}};impact.emit(event);fx.event(event);
 impact.update(2);for(let i=0;i<90;i++)fx.update(1/60);
 check(!fx.active()&&scene.getObjectByName('KartImpactFX').children.every(o=>!o.visible),weapon+' flash, smoke and shockwave retire');
}
const missile=art.projectile('missile');missile.visible=true;scene.add(missile);
for(let i=0;i<100;i++){missile.position.z=i;impact.trail(missile,1/60);impact.update(1/60);}
impact.update(2);fx.update(2);check(scene.getObjectByName('MachineGunCasings').count===0&&scene.getObjectByName('KartImpactFX').children.every(o=>!o.visible),'missile smoke retires after flight stops');
// Smooth playback stays between accepted positions, reuses the output object,
// never extrapolates through cover, and hides stale or removed bodies.
const playback=createProjectilePlayback(),out={direction:{}};
const first={id:'a',physical:true,x:0,y:1,z:0,vx:0,vy:0,vz:140,angle:0,ttl:1};
playback.ingest([first],1000);const next={...first,z:14};playback.ingest([next],1100);
const positions=[];for(const now of [1100,1125,1150,1175,1200]){assert.strictEqual(playback.sample(next,{simAt:1100},now,out),out);positions.push(out.z);}
assert.deepEqual(positions,[0,3.5,7,10.5,14]);checks++;
playback.sample(next,{simAt:1100},1400,out);check(out.visible===false,'stale shot hides without extending its path');
playback.ingest([],1200);playback.reset();
fx.dispose();fx.dispose();impact.dispose();impact.dispose();art.dispose();
console.log(JSON.stringify({pass:true,checks,scope:'shared resources, real rig barrel transforms, world-plane orbits, all new FX lifetimes and accepted-sample playback; no GPU/FPS claim'}));
