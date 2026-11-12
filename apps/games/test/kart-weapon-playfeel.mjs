import assert from 'node:assert/strict';
import fs from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import battle from '../games/engines/kart-rules-battle.js';
import engine from '../games/engines/kart-engine.js';
import elevated from '../games/engines/kart-elevated-combat.js';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import {WEAPONS,WEAPON_IDS,inWeaponCone} from '../public/js/engines/kart-weapon-contract.mjs';
import {createKartImpactFX,BLAST_FX_BUDGETS,blastSize} from '../public/js/engines/kart-impact-fx.mjs';
import {createArsenalFX} from '../public/js/engines/kart-arsenal-fx.mjs';
import {createKartModel,animateKartModel} from '../public/js/engines/kart-model.mjs';
import {kartWeaponDisplay} from '../public/js/engines/kart-weapon-hud.mjs';
import {createKartFeedback} from '../public/js/engines/kart-feedback.mjs';
await RAPIER.init();let checks=0;
globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
const bytes=fs.readFileSync(new URL('../public/assets/karts/giggle-kart.glb',import.meta.url));
const assets={kart:(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene};
function check(v,label){assert.ok(v,label);checks++;}
function classic(weapon,x,z){
 const kart=(pid,x,z)=>({pid,x,z,angle:0,speed:0,slip:0,...battle.blankKart(),shield:0,input:{boost:false}});
 const a=kart('a',0,0),b=kart('b',x,z),connected=new Set(['a','b']);
 const s={phase:'drive',karts:[a,b],zaps:[],zapSeq:0,mines:[],mineSeq:0,grenades:[],grenadeSeq:0,events:[],eventSeq:0,volleyHits:new Map(),crates:[],blocks:[],bound:100,scores:{a:0,b:0},targetHits:99};
 a.weapon=weapon;a.ammo=WEAPONS[weapon].ammo;a.volley='item';
 return {a,b,s,step(dt=1/60,geo){battle.tick(s,connected,dt,null,null,new Map(),geo);},fire(){a.pendingFire=true;this.step(0);}};
}
const ahead={x:0,y:0,z:1},origin={x:0,y:0,z:0};
{
 const f=classic('missile',40,20);f.fire();check(!f.s.zaps[0].targetId,'outside launch cone has no lock');
 f.b.x=0;f.b.z=30;f.step(.1);f.step(.12);check(!f.s.zaps[0].targetId,'entering the cone after launch cannot create a lock');
}
for(const kind of ['blades','supernova'])for(const target of [{x:0,z:20},{x:0,z:-20}]){
 const f=classic(kind,target.x,target.z);f.fire();for(let i=0;i<420;i++)f.step();
 check(f.b.health===100,kind+' stays inside its local area in front and behind');
}
for(const weapon of ['machinegun','cannon']){
 const f=classic(weapon,0,10),kicks=[];for(const k of [f.a,f.b])k.physicalPose={position:{x:k.x,y:.7,z:k.z},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0}};
 f.a.pendingFire=true;const geo={sweepStatic:()=>null,kickKart:(id,v)=>kicks.push({id,v})};f.step(0,geo);for(let i=0;i<60;i++)f.step(1/60,geo);
 check(kicks.some(k=>k.id==='b'&&(weapon==='machinegun'?k.v.z>0&&k.v.z<1:k.v.z>=9)),'classic '+weapon+' weighted authority knockback');
 check(kicks.filter(k=>k.id==='b').length===(weapon==='machinegun'?12:1),'each accepted bullet causes one bounded knockback');
}
for(const angle of [-Math.PI,-1.1,0,.7,2.4]){
 const f=classic('machinegun',3,4);f.b.angle=angle;
 f.s.zaps.push({id:'contact',kind:'machinegun',owner:'a',x:3,z:4,angle:0,ttl:1,volley:'contact'});f.step(0);
 const v=engine.helpers.kartVelocity(f.b);check(v.vx*3+v.vz*4>0,'planar hit pushes away at every victim heading');
}
// Real elevated collection, input, physics, targeting and retirement.
const point=(id,x,z,angle=0)=>({id,x,y:0,z,angle,surface:'floor'});
const map=(x,z,angle=0)=>({id:'feel',revision:'1',half:100,colliders:[{id:'floor',shape:'box',position:{x:0,y:-1,z:0},half:{x:100,y:1,z:100}}],spawns:[point('a',0,0),point('b',x,z,angle)],sockets:[point('s0',-.7,0),point('s1',.7,0)]});
const step=w=>w.advance(w.snapshot().serverAt+1000/60);
function input(w,id,value){const s=w.snapshot(id),a=s.you;assert.ok(w.input(id,{instance:s.instance,life:a.life,controlEpoch:a.controlEpoch,seq:a.receivedSeq+1,steer:0,throttle:0,brake:0,nitro:false,use:false,...value},s.serverAt).ok);}
function armed(kind,m){for(let seed=0;seed<512;seed++){const w=elevated.createElevatedCombat(RAPIER,CONFIG,m,[{id:'a'},{id:'b'}],{instance:'feel'+seed,seed,startAt:0,countdownMs:0,roundMs:15000,crates:1});step(w);if(w.snapshot().karts[0].weapon===kind){for(let i=0;i<160;i++)step(w);return w;}w.dispose();}throw Error('pickup '+kind);}
for(const [x,z,locked]of [[12,35,true],[30,30,false],[0,-15,false],[0,70,false]]){
 const w=armed('missile',map(x,z));try{
  const before=w.snapshot();check((before.karts[0].lockTarget==='b')===locked,'authority lock preview matches launch cone');
  input(w,'a',{use:true});step(w);let s=w.snapshot(),shot=s.projectiles[0],previous=shot?.velocity;
  check((shot?.targetId==='b')===locked,'elevated launch-time lock only');
  for(let i=0;i<140;i++){step(w);s=w.snapshot();shot=s.projectiles[0];if(!shot)break;
   if(previous){const a=new THREE.Vector3().copy(previous),b=new THREE.Vector3().copy(shot.velocity);check(a.angleTo(b)<=WEAPONS.missile.turnRate/60+1e-6,'elevated bounded missile steering');}
   if(!locked)check(!shot.targetId,'elevated missile never finds a later target');previous=shot.velocity;
  }
 }finally{w.dispose();}
}
// Local area weapons cannot reach through solid cover in either authority.
for(const weapon of ['blades','supernova']){
 const f=classic(weapon,3.8,0);f.s.blocks=[{x:1.9,z:0,hw:.15,hd:3}];f.fire();for(let i=0;i<420;i++)f.step();check(f.b.health===100,weapon+' classic cover blocks local damage');
 const covered=map(3.8,0);covered.colliders.push({id:'wall',shape:'box',position:{x:1.9,y:2,z:0},half:{x:.15,y:2,z:3}});
 const w=armed(weapon,covered);try{input(w,'a',{use:true});for(let i=0;i<420;i++)step(w);check(w.snapshot().karts[1].health===100,weapon+' elevated cover blocks local damage');}finally{w.dispose();}
}
for(const reduced of [false,true])for(const weapon of ['mine','missile','cannon','frost','supernova','nuke']){
 const scene=new THREE.Scene(),fx=createKartImpactFX(THREE,scene,{reducedMotion:reduced}),arsenal=createArsenalFX(THREE,scene,{reducedMotion:()=>reduced});
 fx.emit({id:'blast',type:'blast',weapon,position:{x:0,y:1,z:0}});arsenal.event({type:'blast',weapon,position:{x:0,y:1,z:0}});
 for(const mesh of scene.getObjectByName('KartImpactFX').children){const life=mesh.geometry.attributes.fxLife.array;for(let i=1;i<life.length;i+=4)check(life[i]<=(mesh.name==='KartImpactFireFlash'?BLAST_FX_BUDGETS.fire:BLAST_FX_BUDGETS.total)+1e-6,weapon+' every particle lifetime respects its layer budget');}
 fx.update(BLAST_FX_BUDGETS.fire+.001);check(!scene.getObjectByName('KartImpactFireFlash').visible,weapon+' final flame retires within its authored budget');
 fx.update(.66);arsenal.update(1.011);check(scene.getObjectByName('KartImpactFX').children.every(m=>!m.visible)&&!arsenal.active(),weapon+' last explosion particle retires within one second');
 check(!fx.emit({id:'blast',type:'blast',weapon,position:{x:0,y:1,z:0}}),'same accepted blast does not replay');
 const smoke=scene.getObjectByName('KartImpactSmoke').material;check(smoke.depthTest&&!smoke.depthWrite,'smoke respects solid cover and never occludes later geometry through depth writes');fx.dispose();arsenal.dispose();
}
check(blastSize('nuke')>blastSize('cannon')&&blastSize('nuke')<=4.5,'nuke reads larger than Cannon without copying its14m gameplay radius into the fireball');
{
 const scene=new THREE.Scene(),fx=createKartImpactFX(THREE,scene),arsenal=createArsenalFX(THREE,scene),models=new Map(),camera=new THREE.PerspectiveCamera();
 for(const id of ['a','b']){const model=createKartModel(THREE,{assets});models.set(id,model);scene.add(model);arsenal.warmStatus(model);}arsenal.reset();
 const body=models.get('a').userData.arsenalStatus.body,base=body.position.z;
 for(const weapon of WEAPON_IDS){const e={id:weapon,type:weapon==='mine'?'mine':'fire',pid:'a',weapon,position:{x:0,y:1,z:0}};check(fx.emit(e),weapon+' has a visible activation flash');arsenal.react(e,models);arsenal.update(.06);animateKartModel(models.get('a'),{physicalPose:{},dt:1/60});arsenal.status(models.get('a'),{});check(body.position.z<base,weapon+' has body recoil');arsenal.update(1);arsenal.status(models.get('a'),{});check(body.position.z===base,weapon+' recoil retires without drift');}
 arsenal.react({type:'hit',other:'b',weapon:'cannon'},models);arsenal.update(.05);animateKartModel(models.get('b'),{physicalPose:{}});arsenal.status(models.get('b'),{});check(Math.abs(models.get('b').userData.arsenalStatus.body.rotation.z)>.01,'accepted victim hit rocks the body');arsenal.update(.5);arsenal.status(models.get('b'),{});check(models.get('b').userData.arsenalStatus.body.rotation.z===0,'victim reaction fully retires even without a model animation pass');
 arsenal.target({you:'a',karts:[{id:'a',weapon:'missile',lockTarget:'b'},{id:'b'}]},models,camera);check(scene.getObjectByName('MissileLockReticle').visible,'server lock displays a target reticle');
 arsenal.target({you:'a',karts:[{id:'a',weapon:'missile',lockTarget:null},{id:'b'}],projectiles:[{owner:'a',targetId:'b'}]},models,camera);check(!scene.getObjectByName('MissileLockReticle').visible,'no server lock means no reticle');
 fx.dispose();arsenal.dispose();
}
{
 for(const kind of ['cannon','fakecrate','proximity']){
   const slot=kartWeaponDisplay({weapon:kind,ammo:1});
   check(slot.kind===kind&&slot.state==='ready','confirmed '+kind+' is ready immediately');
 }
 check(kartWeaponDisplay({weapon:null,ammo:0}).kind==='crate','no item is shown before award');
}
console.log(JSON.stringify({pass:true,checks,scope:'launch targeting and misses in both authorities; every blast particle budget; real pooled recoil/lock/flash; immediate equipment reveal and replay safety; no GPU or subjective fun claim'}));
