// New damage, life, pickup prediction and resource contracts. No damage hooks.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from '../public/vendor/three/libs/meshopt_decoder.mjs';
import {parseHTML} from 'linkedom';
import battle from '../games/engines/kart-rules-battle.js';
import combat from '../games/engines/kart-combat-config.js';
import {WEAPON_IDS,WEAPONS,blastDamage} from '../public/js/engines/kart-weapon-contract.mjs';
import {createKartPickupPrediction} from '../public/js/engines/kart-pickup-prediction.mjs';
import {kartWeaponDisplay,paintKartWeapon} from '../public/js/engines/kart-weapon-hud.mjs';
import {createKartCombatArt} from '../public/js/engines/kart-combat-art.mjs';
import {fixture} from './helpers/kart-planar-combat-fixture.mjs';
import {createKartFeedback} from '../public/js/engines/kart-feedback.mjs';
{const f=createKartFeedback(),s={instanceId:'echo',phase:'drive',karts:[],events:[]};f.ingest(s,0);s.events=[{id:'server-first',type:'fire',pid:'a',weapon:'machinegun',position:{x:0,y:1,z:0}},{id:'server-next',type:'fire',pid:'a',weapon:'machinegun',position:{x:0,y:1,z:0}}];f.ingest(s,10);assert.deepEqual(f.current(10).map(e=>e.sourceId),['server-first','server-next']);assert(f.current(10).every(e=>e.id!==e.sourceId),'visual IDs never substitute for the accepted event IDs when consuming a local echo');}
assert.equal(combat.config.maxHealth,100);assert.equal(WEAPON_IDS.length,12);
{const f=fixture();f.s.spots=[[20,20],[-20,-20]];f.s.crates=[{id:'claim-box',x:f.a.x,z:f.a.z}];f.s.crateSeq=1;f.step(0);assert.equal(f.s.events.find(e=>e.type==='pickup').crateId,'claim-box');assert(f.a.weapon&&f.a.ammo>0);}
for(const retired of ['oil','boomerang','thunder']){
 assert(!WEAPON_IDS.includes(retired));assert.equal(combat.damageAt(retired),0);
 const f=fixture();f.arm(retired);f.step(0);assert(!f.s.events.some(e=>['fire','mine'].includes(e.type)));assert.equal(f.b.health,100);
}
for(const kind of ['machinegun','trishot']){
 const f=fixture(),n=kind==='machinegun'?20:6;f.a.weapon=kind;f.a.ammo=WEAPONS[kind].ammo;f.a.volley='clip';
 for(let i=0;i<n;i++)f.s.zaps.push({id:'p'+i,kind,owner:'a',volley:'clip',x:0,z:0,angle:0,ttl:1});
 f.step(0);assert.equal(f.b.health,0);assert.equal(f.a.hits,1);assert.equal(f.a.health,100);
 assert.equal(f.s.events.filter(e=>e.type==='ko').length,1);
 f.b.spawnSeq++;f.b.health=100;f.b.respawn=0;f.b.shield=0;
 f.s.zaps.push({id:'old-next-life',kind,owner:'a',volley:'clip',x:0,z:0,angle:0,ttl:1});f.step(0);assert.equal(f.b.health,100,'old pickup cannot farm respawn');
 f.s.zaps.push({id:'fresh-next-life',kind,owner:'a',volley:'new-clip',x:0,z:0,angle:0,ttl:1});f.step(0);assert(Math.abs(f.b.health-(100-WEAPONS[kind].damage))<1e-8);
 assert.equal(WEAPONS[kind].damage*WEAPONS[kind].projectiles,150);
}
// Smooth radial damage on the actual planar detonation path.
for(const kind of ['frost','nuke'])for(const ratio of [0,.25,.5,.9,1,1.1]){
 const f=fixture(),radius=WEAPONS[kind].splashRadius;f.b.x=ratio*radius;
 f.s.grenades=[{id:'g',owner:'a',kind,x:0,y:0,z:0,vx:0,vy:0,vz:0,fuse:0,bounces:0}];f.step(0);
 assert(Math.abs(f.b.health-Math.max(0,100-blastDamage(kind,ratio*radius)))<1e-8,kind+' real radial HP '+ratio);
 assert.equal(f.a.health,100,'blast owner immune');
}
for(const kind of ['frost','nuke','mine','missile','cannon','supernova']){
 const radius=WEAPONS[kind].splashRadius;
 assert.equal(blastDamage(kind,0),WEAPONS[kind].damage);assert.equal(blastDamage(kind,radius),0);
 assert(Math.abs(blastDamage(kind,radius*.5)-WEAPONS[kind].damage*.5)<1e-8);
 assert(blastDamage(kind,radius*.2)>blastDamage(kind,radius*.8));
}
for(const kind of ['blades','ram'])for(const gate of ['live','shield','cover','offline']){
 const f=fixture();f.b.x=kind==='blades'?3.1:0;f.b.z=kind==='blades'?-10:-7;
 if(gate==='shield')f.b.shield=1;if(gate==='cover')f.s.blocks=[{x:kind==='blades'?1.5:0,z:kind==='blades'?-10:-8.5,hw:kind==='blades'?.1:3,hd:kind==='blades'?3:.1}];if(gate==='offline')f.connected.delete('b');
 f.arm(kind);f.step(0);assert.equal(f.b.health,gate==='live'?0:100,kind+' '+gate);
}
// Denied prediction restores a crate once, accepted claims never grant inventory.
let time=0,pops=0,rejects=0;const predictor=createKartPickupPrediction({now:()=>time,onPredict(){pops++;},onReject(){rejects++;}});
const kart={health:100,maxHealth:100,alive:true,weapon:null,ammo:0},crate={id:'box',x:0,z:0};predictor.sync('round',1);
predictor.update(kart,{x:0,z:0},[crate]);assert(predictor.hidden('box'));assert.equal(kartWeaponDisplay(kart).state,'empty');assert.equal(kart.ammo,0);
for(time=0;time<800;time+=16)predictor.update(kart,{x:0,z:0},[crate]);assert.equal(pops,1);
time=900;predictor.update(kart,{x:0,z:0},[crate]);assert.equal(rejects,1);assert(!predictor.hidden('box'));
predictor.update(kart,{x:0,z:0},[crate]);assert.equal(pops,1,'no denial loop while parked');predictor.update(kart,{x:5,z:0},[crate]);predictor.update(kart,{x:0,z:0},[crate]);assert.equal(pops,2);
kart.weapon='cannon';kart.ammo=1;assert(predictor.accept('box'));assert.equal(kartWeaponDisplay(kart).kind,'cannon');
const {document}=parseHTML('<div id="slot"></div>');const slot=document.getElementById('slot');paintKartWeapon(slot,{weapon:'machinegun',ammo:30});assert.equal(slot.querySelector('strong').textContent,'Tracking Blaster');assert.equal(slot.querySelector('.kart-item-count').textContent,'×30');const copy=slot.querySelector('strong');paintKartWeapon(slot,{weapon:'machinegun',ammo:10});assert.equal(slot.querySelector('.kart-item-count').textContent,'×10');assert(slot.querySelector('strong')===copy);
await MeshoptDecoder.ready;
const file=await readFile(new URL('../public/assets/karts/combat/pickup-gear.glb',import.meta.url));
const {scene:library}=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  .parseAsync(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'');
const art=createKartCombatArt(THREE,{assets:{get:name=>library.getObjectByName(name)}}),budgets=[];
for(const kind of WEAPON_IDS){
  const first=art.weapon(kind),second=art.weapon(kind),c=first.userData.combat;
  assert(first.getObjectByName('Gear_'+kind),kind+' uses the shipped gear branch');
  const geometries=[];
  first.traverse(node=>{if(node.isMesh)geometries.push(node.geometry);});
  const triangles=geometries.reduce((sum,g)=>sum+(g.index?.count??g.attributes.position.count)/3,0);
  assert(triangles>0 && triangles<=3000,kind+' triangle budget: '+triangles);
  assert(geometries.length<=6,kind+' draw budget');
  let i=0;second.traverse(node=>{if(node.isMesh)assert.equal(node.geometry,geometries[i++]);});
  assert.equal(i,geometries.length);
  if(kind==='machinegun'){
    const bore=first.localToWorld(new THREE.Vector3(...c.muzzle));
    const direction=new THREE.Vector3(.45,.25,.7).normalize();
    c.firing=true;art.aim(first,direction);art.recoil(first);
    for(const dt of [.04,.2]){
      art.animate(first,dt,0,false);
      assert(c.inner.getWorldDirection(new THREE.Vector3()).angleTo(direction)<1e-6);
      assert(c.inner.localToWorld(new THREE.Vector3(...c.muzzle)).distanceTo(bore)<1e-8,
        'Tracking Blaster turns around the stationary bore throughout recoil');
    }
  }else{
    art.recoil(first);art.animate(first,.04,0,false);assert(c.inner.position.z<0);
    art.animate(first,.2,1,false);assert(Math.abs(c.inner.position.z)<1e-8);
  }
  budgets.push({kind,triangles,meshes:geometries.length});
}
art.dispose();console.log('KART_WEAPON_SYSTEM_PASS '+JSON.stringify(budgets));
