// Exercise the real shared factories, not a source-text allocation check.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createKartCombatArt,COMBAT_ART_BUDGETS} from '../public/js/engines/kart-combat-art.mjs';
import {createArsenalFX} from '../public/js/engines/kart-arsenal-fx.mjs';
import {createKartImpactFX,TRAIL_FX_BUDGET,BLAST_FX_BUDGETS} from '../public/js/engines/kart-impact-fx.mjs';
import {WEAPON_IDS} from '../public/js/engines/kart-weapon-contract.mjs';
let resources=0;
const tracked={...THREE};
for(const name of Object.keys(THREE).filter(n=>/Geometry$|Material$/.test(n)&&typeof THREE[n]==='function'))tracked[name]=class extends THREE[name]{constructor(...a){super(...a);resources++;}};
const scene=new THREE.Scene(),art=createKartCombatArt(tracked),impact=createKartImpactFX(tracked,scene),arsenal=createArsenalFX(tracked,scene);
const shots=['machinegun','trishot','missile','cannon','nuke','frost'];
const rigs=WEAPON_IDS.map(kind=>art.weapon(kind)),bodies=shots.map(kind=>art.projectile(kind)),traps=[art.mine(true),art.mine(false)];
for(const body of bodies){let n=0;body.traverse(o=>{if(o.isMesh)n++;});assert(n<=COMBAT_ART_BUDGETS.projectile,'readability stays inside the projectile draw budget');}
const model=new THREE.Group();arsenal.warmStatus(model);arsenal.reset();
const models=new Map([['driver',model]]);
const baseline=resources,event={type:'fire',weapon:'',position:{x:0,y:1,z:0},direction:{x:0,y:0,z:1}};
for(let lap=0;lap<30;lap++)for(const weapon of WEAPON_IDS){
 event.weapon=weapon;event.type='fire';event.pid='driver';impact.emit(event);arsenal.event(event);arsenal.react(event,models);
 arsenal.status(model,{},{time:lap});
 event.type='blast';impact.emit(event);arsenal.event(event);
 for(const rig of rigs){art.recoil(rig);art.animate(rig,.016,lap,false);}
 for(const body of bodies){body.position.z+=1;impact.trail(body,.03);art.animate(body,.016,lap,false);}
 for(const trap of traps)art.animate(trap,.016,lap,false);
 impact.update(.016);arsenal.update(.016);
}
// Even a new instance for an exhausted reserve borrows prepared resources.
for(const weapon of WEAPON_IDS)art.weapon(weapon);
for(const kind of shots)art.projectile(kind);
art.mine(true);art.mine(false);
assert.equal(resources,baseline,'every fire, impact, trail, animation and replacement instance reuses geometry and materials');
impact.update(2);arsenal.update(2);
assert(scene.getObjectByName('KartImpactFX').children.every(o=>!o.visible)&&!arsenal.active(),'stress effects retire');
// The trail stores world positions from accepted playback, including return.
const blade=bodies[shots.indexOf('frost')],root=scene.getObjectByName('KartImpactFX'),trail=scene.getObjectByName('KartWeaponTrails');
impact.reset();
const fireVersion=root.children[0].geometry.attributes.fxLife.version;
for(let i=0;i<12;i++){blade.position.set(i<6?i:12-i,1,4);impact.trail(blade,.03);impact.update(.03);}
assert.equal(root.children[0].geometry.attributes.fxLife.version,fireVersion,'trail updates never upload idle explosion buffers');
const positions=trail.geometry.attributes.fxOrigin.array;
assert.equal(positions[3],1);assert.equal(positions[9*3],3,'returning trail follows accepted returning positions');
assert(trail.visible,'bright trail appears without creating scene nodes');
impact.update(TRAIL_FX_BUDGET+.001);assert(!trail.visible,'last breadcrumb retires within its short trail budget');
impact.reset();
const bullet=bodies[shots.indexOf('machinegun')];bullet.position.set(4,1,8);bullet.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2);impact.trail(bullet,.03);
assert(trail.visible,'straight bullets have a chase-camera streak in the existing trail draw');
assert.equal(trail.geometry.attributes.fxLife.array[3],4,'bullet streak uses its prepared shader mode');
assert(Math.abs(trail.geometry.attributes.fxVelocity.array[0]-1)<1e-6,'streak faces the accepted shot axis');
assert.equal(trail.geometry.attributes.fxOrigin.array[0],3,'streak starts behind the accepted projectile');
impact.update(.081);assert(!trail.visible,'bullet streak retires within 80 ms');
for(const weapon of WEAPON_IDS){
 impact.reset();arsenal.reset();event.weapon=weapon;event.type='blast';impact.emit(event);arsenal.event(event);
 for(const layer of root.children){const a=layer.geometry.attributes.fxLife.array;for(let i=0;i<a.length;i+=4)assert(a[i+1]<=BLAST_FX_BUDGETS.total+1e-7,'particle lifetime bounded for '+weapon);}
 impact.update(BLAST_FX_BUDGETS.total+.001);arsenal.update(BLAST_FX_BUDGETS.total+.001);
 assert(root.children.every(o=>!o.visible)&&!arsenal.active(),weapon+' last particle and shockwave retire within budget');
}
event.weapon='machinegun';event.type='fire';arsenal.react(event,models);arsenal.status(model,{});
const muzzle=model.getObjectByName('KartWeaponMuzzleFlash');
assert(muzzle.visible,'a warm muzzle flash is attached to the firing kart');
assert(muzzle.parent.parent===model,'the flash follows the kart as it moves');
arsenal.update(.15);arsenal.status(model,{});assert(!muzzle.visible,'attached muzzle flash retires after .14 seconds');
const quietScene=new THREE.Scene(),quiet=createKartImpactFX(tracked,quietScene,{reducedMotion:true});
quiet.trail(blade,.05);quiet.update(0);
assert(quietScene.getObjectByName('KartImpactFX').children.every(o=>!o.visible),'reduced motion suppresses travelling breadcrumbs');
const quietArsenal=createArsenalFX(tracked,quietScene,{reducedMotion:true});
quietArsenal.event(event);
assert(!quietScene.getObjectByName('ThunderSkyFlash'),'retired lightning allocates no screen flash');
quietArsenal.update(.601);assert(!quietArsenal.active(),'reduced lightning still retires on time');quietArsenal.dispose();
quiet.dispose();quiet.trail(blade,.05);
art.dispose();impact.dispose();arsenal.dispose();
console.log('KART_WEAPON_FX_BUDGET_PASS: all 13 weapons reuse render resources; world-space trails, <=4 projectile meshes, idle uploads and all effect retirement budgets');
