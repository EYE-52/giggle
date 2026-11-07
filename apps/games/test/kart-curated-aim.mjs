import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import battle from '../games/engines/kart-rules-battle.js';
import combat from '../games/engines/kart-combat-config.js';
import elevated from '../games/engines/kart-elevated-combat.js';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import {createKartCombatArt,projectileContactInset} from '../public/js/engines/kart-combat-art.mjs';
import {weaponForward,WEAPONS,TRI_FAN} from '../public/js/engines/kart-weapon-contract.mjs';
import {projectilePose} from '../public/js/engines/kart-flight.mjs';
await RAPIER.init();
const classicSource=fs.readFileSync(new URL('../public/js/engines/kart-view.js',import.meta.url),'utf8');
const classicPlacement=classicSource.slice(classicSource.indexOf('const liveZ = new Set();'),classicSource.indexOf('for (const [zid, mesh] of zaps)'));
const fallbackStart=classicSource.indexOf('const angle=Number.isFinite(z.vx)');
const fallbackStroke=classicSource.slice(fallbackStart,classicSource.indexOf('\n    }',fallbackStart));
const elevatedSource=fs.readFileSync(new URL('../public/js/engines/kart-elevated-view.js',import.meta.url),'utf8');
const elevatedPlacement=elevatedSource.slice(elevatedSource.indexOf('function movingItems('),elevatedSource.indexOf("helper.canvas().setAttribute('aria-hidden'"));
const degrees=(a,b)=>new THREE.Vector3().copy(a).angleTo(new THREE.Vector3().copy(b))*180/Math.PI;
let checks=0,maxError=0;
function checkDirection(a,b,label){const error=degrees(a,b);assert(error<1,label+': '+error);maxError=Math.max(maxError,error);checks++;}
const art=createKartCombatArt(THREE);
function draw(kind,shot,profile){
 const o=art.projectile(kind),c=o.userData.combat,radius=combat.config.staticSweepRadii[kind];c.contactRadius=radius;c.contactInset=projectileContactInset(THREE,o,radius);
 const direction=new THREE.Vector3(),nose=new THREE.Vector3(),before=JSON.stringify(shot);
 if(profile==='classic'){
  const context=vm.createContext({S:{zaps:[shot],simAt:1000},ordnanceFresh:()=>true,zaps:new Map([[shot.id,o]]),shotPools:new Map(),combat:art,scene:new THREE.Scene(),shotPlayback:{sample:projectilePose},projectilePose,serverNow:()=>1000,shotDirection:direction,shotForward:new THREE.Vector3(0,0,1),tmpV:new THREE.Vector3(),dt:1/60,t:0,rm:false,impactFX:{trail(){}},prepareShotContact(){throw Error('must be prepared before fire');}});
  vm.runInContext('globalThis.draw=()=>{'+classicPlacement+'};',context);context.draw();
  let from,to;
  const canvas=vm.createContext({z:shot,p:shot,px:x=>x,pz:z=>z,ctx:{beginPath(){},moveTo(x,z){from={x,z};},lineTo(x,z){to={x,z};},stroke(){}}});
  vm.runInContext(fallbackStroke,canvas);
  checkDirection({x:from.x-to.x,y:0,z:from.z-to.z},{x:shot.vx,y:0,z:shot.vz},kind+' actual canvas fallback stroke');
 }else{
  const context=vm.createContext({objects:new Map([['shot:'+shot.id,o]]),direction,nose});vm.runInContext(elevatedPlacement+';globalThis.draw=movingItems;',context);context.draw([shot],'shot:',null,[shot],1);
 }
 const v=profile==='classic'?{x:shot.vx,y:shot.vy,z:shot.vz}:shot.velocity;
 for(const reduced of [false,true]){art.animate(o,1/60,.5,reduced);o.updateWorldMatrix(true,true);checkDirection(o.getWorldDirection(new THREE.Vector3()),v,kind+' '+profile+' drawn flight axis');}
 assert.equal(JSON.stringify(shot),before,'art does not mutate authority');
 return o;
}
const kinds=['machinegun','trishot','missile','cannon'];
for(const yaw of [-Math.PI,-2.4,-.7,0,.65,1.8,Math.PI])for(const kind of kinds){
 const q={x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},velocity={x:7,y:.4,z:-3};
 const make=(pid,x,z)=>({pid,x,z,angle:yaw,...battle.blankKart(),shield:0,input:{boost:false},physicalPose:{position:{x,y:3,z},rotation:q,linearVelocity:velocity}});
 const a=make('a',0,0),b=make('b',80,-80);a.weapon=kind;a.ammo=WEAPONS[kind].ammo;a.pendingFire=true;a.volley='aim';
 const s={phase:'drive',karts:[a,b],zaps:[],zapSeq:0,mines:[],mineSeq:0,grenades:[],grenadeSeq:0,events:[],eventSeq:0,crates:[],blocks:[],bound:180,volleyHits:new Map(),targetHits:99};
 // Deliberately stale pre-driving heading: the original failure witness.
 const stale={...a,physicalPose:{...a.physicalPose,rotation:{x:0,y:Math.sin((yaw+.8)/2),z:0,w:Math.cos((yaw+.8)/2)}}};
 battle.tick(s,new Set(['a','b']),0,new Map([['a',stale]]),null,new Map(),{sweepStatic:()=>null});
 assert.equal(s.zaps.length,kind==='trishot'?3:1);
 for(let i=0;i<s.zaps.length;i++){
  const p=s.zaps[i],offset=kind==='trishot'?TRI_FAN[i]:0,expected=weaponForward(q,offset),lift=kind==='cannon'?WEAPONS.cannon.launchY:0;
  checkDirection({x:p.vx-velocity.x,y:p.vy-velocity.y-lift,z:p.vz-velocity.z},expected,kind+' classic current heading + velocity');
  const packet=battle.viewExtra(s).zaps[i];draw(kind,packet,'classic');
 }
 const point=(id,x,z,angle=0)=>({id,x,y:0,z,angle,surface:'floor'});
 const map={id:'aim',revision:'1',half:180,colliders:[{id:'floor',shape:'box',position:{x:0,y:-1,z:0},half:{x:180,y:1,z:180}}],spawns:[point('a',0,0,yaw),point('b',100,100)],sockets:[point('s0',-.7,0),point('s1',.7,0)]};
 let w;
 for(let seed=0;seed<512;seed++){const t=elevated.createElevatedCombat(RAPIER,CONFIG,map,[{id:'a'},{id:'b'}],{instance:'aim',seed,startAt:0,countdownMs:0,roundMs:10000,crates:1});t.advance(1000/60);if(t.snapshot().karts[0].weapon===kind){w=t;break;}t.dispose();}
 assert(w,'real elevated '+kind+' pickup');
 try{
  // Get moving before fire. Use legal inputs and actual Rapier yaw/velocity.
  for(let i=0;i<8;i++){const s=w.snapshot('a'),u=s.you;assert(w.input('a',{instance:s.instance,life:u.life,controlEpoch:u.controlEpoch,seq:u.receivedSeq+1,steer:.4,throttle:1,brake:0,nitro:false,use:i===7},s.serverAt).ok);w.advance(s.serverAt+1000/60);}
  const s=w.snapshot(),own=s.karts[0],v=own.pose.linearVelocity,shots=s.projectiles;
  assert.equal(shots.length,kind==='trishot'?3:1);
  for(let i=0;i<shots.length;i++){
   const p=shots[i],offset=kind==='trishot'?TRI_FAN[i]:0,expected=weaponForward(own.pose.rotation,offset);
   // First update already applies one fixed step of cannon gravity.
   const lift=kind==='cannon'?WEAPONS.cannon.launchY-WEAPONS.cannon.gravity*CONFIG.fixedDt:0;
   checkDirection({x:p.velocity.x-v.x,y:p.velocity.y-v.y-lift,z:p.velocity.z-v.z},expected,kind+' elevated current heading + velocity');
   draw(kind,p,'elevated');
  }
 }finally{w.dispose();}
}
art.dispose();
console.log(JSON.stringify({pass:true,checks,maxDirectionErrorDegrees:maxError,scope:'7 headings, all four forward weapons and all 3 fan rays; both authorities, exact production 3D placement and canvas stroke; current pose vs stale yaw; moving kart velocity'}));
