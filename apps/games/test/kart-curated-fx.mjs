import assert from 'node:assert/strict';
import * as THREE from 'three';
import {WEAPON_IDS,WEAPON_DISPLAY,WEAPONS,TRI_FAN,CURATED_MUZZLE,weaponForward,WEAPON_ALIASES} from '../public/js/engines/kart-weapon-contract.mjs';
import {createKartCombatArt} from '../public/js/engines/kart-combat-art.mjs';
import {createArsenalFX} from '../public/js/engines/kart-arsenal-fx.mjs';
import {createKartImpactFX} from '../public/js/engines/kart-impact-fx.mjs';
import {createProjectilePlayback,projectilePose} from '../public/js/engines/kart-flight.mjs';
import {SYNTH_CUE_NAMES,ASSET_MAP} from '../public/js/engines/kart-audio.mjs';
import {kartWeaponDisplay} from '../public/js/engines/kart-weapon-hud.mjs';
import {WEAPON_THUMBNAILS} from '../public/js/engines/kart-assets.mjs';
let checks=0;const check=(ok,label)=>{assert.ok(ok,label);checks++;};
assert.deepEqual(Object.keys(WEAPON_DISPLAY).sort(),[...WEAPON_IDS].sort());
assert.deepEqual([...WEAPON_THUMBNAILS].sort(),[...WEAPON_IDS].sort());
for(const [old,id]of Object.entries(WEAPON_ALIASES))check(kartWeaponDisplay({weapon:old,ammo:1}).kind===id,old+' saved inventory has the current HUD name/icon');
for(const id of WEAPON_IDS)check(SYNTH_CUE_NAMES.includes(id)||ASSET_MAP[id],id+' has a deployment cue');
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
  const expected=new THREE.Vector3(CURATED_MUZZLE.x+(i-1)*.2,CURATED_MUZZLE.y,CURATED_MUZZLE.z).applyQuaternion(model.quaternion).add(model.position);
  check(tip.distanceTo(expected)<1e-7,'actual tri barrel muzzle agrees with authority');
  check(barrel.getWorldDirection(new THREE.Vector3()).angleTo(new THREE.Vector3().copy(weaponForward(model.quaternion,TRI_FAN[i])))<1e-7,'actual tri barrel fan agrees with authority');
 }
}
// The first shot after a turn must line up in that frame, including shots
// behind or on either side of a kart on a slope. The bore stays fixed.
{
 const model=new THREE.Group(),body=new THREE.Group(),rig=art.weapon('machinegun');
 model.rotation.set(.18,.6,-.12);model.position.set(-4,2,9);scene.add(model);
 body.position.y=-.7;model.add(body);body.add(rig);art.placeWeapon(rig);
 const c=rig.userData.combat;c.firing=true;
 for(const local of [new THREE.Vector3(0,0,-1),new THREE.Vector3(-1,.1,0).normalize(),new THREE.Vector3(1,0,0)]){
  const direction=local.clone().applyQuaternion(model.quaternion);
  art.aim(rig,direction);art.recoil(rig);art.animate(rig,1/60,0,false);
  fx.react({type:'fire',pid:'a',weapon:'machinegun',direction},new Map([['a',model]]));fx.status(model,{});
  const tip=c.inner.localToWorld(new THREE.Vector3(...c.muzzle)),origin=model.localToWorld(new THREE.Vector3().copy(CURATED_MUZZLE));
  const star=model.getObjectByName('KartWeaponMuzzleFlash');
  check(tip.distanceTo(origin)<1e-7,'turned barrel ends at the fixed shot origin');
  check(c.inner.getWorldDirection(new THREE.Vector3()).dot(direction)>1-1e-7,'first round faces its accepted direction');
  check(star.getWorldPosition(new THREE.Vector3()).distanceTo(origin.addScaledVector(direction,.06))<1e-7,'flash sits just outside the turned barrel');
  check(star.getWorldDirection(new THREE.Vector3()).dot(direction)>1-1e-7,'flash faces the accepted shot');
 }
}
const model=new THREE.Group();model.position.set(5,3,-2);model.rotation.set(.3,.7,-.2);scene.add(model);fx.warmStatus(model);
for(const reduced of [false,true])for(let i=0;i<360;i++){
 const age=i/60,k={bladesT:6-age,bladesAge:age,supernovaT:age<3?3-age:0};fx.status(model,k,{time:age});model.updateMatrixWorld(true);
 const center=model.localToWorld(new THREE.Vector3(0,.35,0));
 for(const blade of model.userData.arsenalStatus.blades.children){const p=blade.localToWorld(new THREE.Vector3(2.2,0,0));check(Math.abs(p.y-center.y)<1e-7&&Math.abs(Math.hypot(p.x-center.x,p.z-center.z)-2.2)<1e-7,'pitched kart orbit follows the authority world plane');}
}
// Protection is a thin boundary at the real reach, not a full shell.
const nova=model.userData.arsenalStatus.nova;
check(nova.name==='SupernovaBoundary'&&nova.geometry.type==='TorusGeometry','Supernova has no enclosing faces over the driver');
check(nova.geometry.parameters.radius===WEAPONS.supernova.contactRadius,'boundary radius matches authoritative contact reach');
check(nova.material.side===THREE.FrontSide&&nova.children[0].material.side===THREE.FrontSide,'closed rings need one face pass');
check(nova.geometry.index.count/3+nova.children[0].geometry.index.count/3<=800,'protection remains below the former double-sided shell/rim triangle budget');
const other=new THREE.Group();fx.warmStatus(other);check(other.userData.arsenalStatus.nova.geometry===nova.geometry&&other.userData.arsenalStatus.nova.material===nova.material,'all drivers share protection geometry and materials');
fx.status(model,{supernovaT:3},{time:1,elapsed:.02});model.updateMatrixWorld(true);
const boundaryCenter=nova.getWorldPosition(new THREE.Vector3());
for(const a of [0,.5,1.5,3]){const p=nova.localToWorld(new THREE.Vector3(Math.cos(a)*WEAPONS.supernova.contactRadius,0,Math.sin(a)*WEAPONS.supernova.contactRadius));check(Math.abs(p.y-boundaryCenter.y)<1e-7&&Math.abs(Math.hypot(p.x-boundaryCenter.x,p.z-boundaryCenter.z)-WEAPONS.supernova.contactRadius)<1e-7,'pitched kart keeps contact boundary in the world plane');}
fx.status(model,{supernovaT:.02},{elapsed:.02});check(!nova.visible,'boundary expires at the accepted remaining timer');
fx.status(model,{supernovaT:3,connected:false});check(!nova.visible,'disconnected driver has no lingering boundary');
fx.status(model,{bladesT:1,bladesAge:5,supernovaT:1},{elapsed:1.1});check(!model.userData.arsenalStatus.blades.visible&&!model.userData.arsenalStatus.nova.visible,'stale status packet cannot leave protection or blades behind');
fx.status(model,null);check(!model.userData.arsenalStatus.blades.visible&&!model.userData.arsenalStatus.nova.visible,'expired attachments hide immediately');
const quietProtection=createArsenalFX(THREE,new THREE.Scene(),{reducedMotion:true}),quietModel=new THREE.Group();
quietProtection.status(quietModel,{supernovaT:3},{time:0});
const quietNova=quietModel.userData.arsenalStatus.nova,quietPose=quietNova.children[0].quaternion.toArray();
quietProtection.status(quietModel,{supernovaT:2},{time:1});check(quietNova.visible,'reduced motion retains the protection boundary');
assert.deepEqual(quietNova.children[0].quaternion.toArray(),quietPose);checks++;
quietProtection.status(quietModel,{supernovaT:0},{time:3});check(!quietNova.visible,'reduced motion keeps immediate expiry');quietProtection.dispose();
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
// extrapolates through a gap, and hides expired or removed bodies.
const playback=createProjectilePlayback(),out={direction:{}};
const first={id:'a',physical:true,x:0,y:1,z:0,vx:0,vy:0,vz:140,angle:0,ttl:1};
playback.ingest([first],1000);const next={...first,z:14};playback.ingest([next],1100);
const positions=[];for(const now of [1100,1125,1150,1175,1200]){assert.strictEqual(playback.sample(next,{simAt:1100},now,out),out);positions.push(out.z);}
assert.deepEqual(positions,[0,3.5,7,10.5,14]);checks++;
playback.sample(next,{simAt:1100},1250,out);check(out.visible===true&&out.z===21,'physical shot lease ends 150ms after the newest authority record');
playback.sample(next,{simAt:1100},1350,out);check(out.visible===false&&out.z===35,'playback delay cannot extend the shot lease');
playback.sample(next,{simAt:1100},1351,out);check(out.visible===false&&out.z===35,'physical shot hides beyond 150ms without extending through cover');
playback.sample(next,{simAt:1100},1700,out);check(out.visible===false&&out.z===35,'600ms gap keeps the shot hidden at the lead cap');
playback.sample(next,{simAt:1100},2201,out);check(out.visible===false,'missing record expires after 1000ms');
playback.ingest([],1200);playback.reset();
fx.dispose();fx.dispose();impact.dispose();impact.dispose();art.dispose();
console.log(JSON.stringify({pass:true,checks,scope:'shared resources, real rig barrel transforms, world-plane orbits, all new FX lifetimes and accepted-sample playback; no GPU/FPS claim'}));

// No global reset on a gap, and old/duplicate snapshots cannot retire shots.
{
 const p=createProjectilePlayback(),out={direction:{}},shot={id:'gap',kind:'machinegun',physical:true,x:0,y:1,z:0,vx:0,vy:0,vz:10,ttl:2};
 p.setDelay(80);p.ingest([shot],1000);p.ingest([{...shot,z:6}],1600);
 p.sample(shot,{simAt:1600},1600,out);assert.equal(out.z,5.2,'600ms record gap retains the older interpolation endpoint');
 p.ingest([],1500);p.ingest([],1600);p.sample(shot,{simAt:1600},1680,out);assert.equal(out.z,6);assert.ok(out.visible,'old/duplicate packet cannot delete current shot');
 p.sample(shot,{simAt:1600},1750,out);assert.ok(out.visible&&Math.abs(out.z-6.7)<1e-8,'150ms receipt age is independent of the delayed playback clock');
 p.sample(shot,{simAt:1600},1830,out);assert.ok(!out.visible&&out.z===7.5,'delayed playback cannot extend receipt lifetime');
 p.sample(shot,{simAt:1600},1831,out);assert.equal(out.visible,false,'physical playback hides beyond 150ms');
 p.sample(shot,{simAt:1600},2200,out);assert.ok(!out.visible&&out.z===7.5,'600ms network gap cannot extend the shot through cover');
 p.ingest([{...shot,z:12}],2200);p.sample(shot,{simAt:2200},2200,out);assert.ok(out.visible&&out.z===11.2,'a newer record restores visibility and retains the earlier interpolation endpoint');
 p.ingest([],2300);p.sample(shot,{simAt:1600},2300,out);assert.equal(out.visible,false,'absence in a newer packet retires only this shot');
 const short={...shot,id:'ttl',ttl:.1};p.ingest([short],2400);p.sample(short,{simAt:2400},2600,out);assert.equal(out.visible,false,'own remaining TTL still expires');
 p.reset();
}

// A large adaptive delay needs more than the newest pair after recovery.
{
 const p=createProjectilePlayback(),out={direction:{}};p.setDelay(350);
 for(let at=1000;at<=1600;at+=100)p.ingest([{id:'buffered',kind:'machinegun',physical:true,x:(at-1000)*.01,y:1,z:0,vx:10,vy:0,vz:0,ttl:2}],at);
 p.sample({id:'buffered',physical:true},{simAt:1600},1600,out);assert.equal(out.x,2.5,'shots use the same delayed server timeline through all retained samples');assert.ok(out.visible);p.reset();
}

// Stateless physical flight uses the same short lead, including gravity.
for(const kind of ['machinegun','cannon']){
 const shot={kind,physical:true,x:0,y:1,z:0,vx:0,vy:2,vz:140,ttl:2},snapshot={simAt:1000};
 const edge=projectilePose(shot,snapshot,1150),hidden=projectilePose(shot,snapshot,1151),stale=projectilePose(shot,snapshot,1600);
 assert.ok(edge.visible&&edge.z===21,'physical lead stays visible through 150ms');
 assert.ok(!hidden.visible&&!stale.visible,'unconfirmed physical flight hides after 150ms');
 assert.equal(hidden.z,21);assert.equal(stale.z,21);assert.equal(stale.y,edge.y);assert.deepEqual(stale.direction,edge.direction);
 assert.ok(projectilePose({...shot,z:84},{simAt:1600},1610).visible,'a newer stateless record is visible again');
 assert.equal(projectilePose({...shot,ttl:.05},snapshot,1100).visible,false,'physical lead cannot outlive its TTL');
}

// Large interpolation reserves cannot extend the 150ms authority lease.
{
 const p=createProjectilePlayback(),out={direction:{}},shot={id:'retained',physical:true,x:0,y:1,z:0,vz:140,ttl:2};
 p.setDelay(1000);p.ingest([shot],1000);p.sample(shot,{simAt:1000},2000,out);assert.ok(!out.visible,'1000ms playback reserve cannot preserve a stale shot');
 p.sample(shot,{simAt:1000},2001,out);assert.equal(out.visible,false,'record older than 1000ms stays hidden');p.reset();
}
