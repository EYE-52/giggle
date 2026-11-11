import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import battle from '../games/engines/kart-rules-battle.js';
import combat from '../games/engines/kart-combat-config.js';
import elevated from '../games/engines/kart-elevated-combat.js';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import {WEAPONS,WEAPON_IDS,CURATED_MUZZLE} from '../public/js/engines/kart-weapon-contract.mjs';
await RAPIER.init();
let checks=0;
const check=(ok,label)=>{assert.ok(ok,label);checks++;};
assert.deepEqual(combat.config.weaponOrder,WEAPON_IDS);
assert.deepEqual(WEAPON_IDS.filter(k=>WEAPONS[k].tier==='common'),['machinegun','trishot','mine','proximity']);
assert.deepEqual(WEAPON_IDS.filter(k=>WEAPONS[k].tier==='rare'),['supernova','nuke']);
for(const [old,id]of Object.entries(combat.weaponAliases))assert.equal(combat.normalizeWeapon(old),id);
for(let i=0;i<10000;i++)check(WEAPON_IDS.includes(combat.weaponForRoll(i/10000)),'curated rolls only');
export function classic(weapon='machinegun',target={x:0,z:20}){
 const k=(pid,x,z)=>({pid,x,z,angle:0,speed:0,slip:0,...battle.blankKart(),shield:0,input:{steer:0,throttle:0,boost:false}});
 const a=k('a',0,0),b=k('b',target.x,target.z),s={scores:{a:0,b:0},phase:'drive',bound:180,half:182,blocks:[],crates:[],karts:[a,b],zaps:[],zapSeq:0,mines:[],mineSeq:0,grenades:[],grenadeSeq:0,events:[],eventSeq:0,volleySeq:0,volleyHits:new Map(),targetHits:99};
 a.weapon=weapon;a.ammo=WEAPONS[combat.normalizeWeapon(weapon)].ammo;a.volley='pickup-a';
 const connected=new Set(['a','b']),log=new Map();
 return {a,b,s,connected,log,fire(){a.pendingFire=true;this.step(0);},step(dt=1/60,geometry){s.lastTick=(s.lastTick||0)+dt*1000;battle.tick(s,connected,dt,null,null,new Map(),geometry);for(const e of s.events)log.set(e.id,e);},settle(seconds){for(let t=0;t<seconds;t+=1/60)this.step();}};
}
for(const weapon of ['machinegun','trishot','missile','cannon']){
 const f=classic(weapon);f.fire();f.settle(3);
 const hits=weapon==='trishot'?3:1;
 check(f.log.size>0,weapon+' fires');check(Math.abs(f.b.health-(100-WEAPONS[weapon].damage*hits))<1e-8,weapon+' direct hit damage on a single planar press');
 check(f.s.zaps.length===0,weapon+' shots retire');
}
{
 const f=classic('machinegun');f.fire();f.settle(2.2);
 // Planar variants are per-press; physical production commits the clip.
 f.a.physicalPose={position:{x:0,y:.7,z:0},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0}};
 f.a.weapon='machinegun';f.a.ammo=30;f.a.volley='fullclip';f.a.fireCd=0;
 const geo={sweepStatic:()=>null};f.a.pendingFire=true;f.step(0,geo);
 for(let i=0;i<170;i++)f.step(1/60,geo);
 check(f.a.weapon===null&&f.a.ammo===0,'tracking blaster completes 30 rounds');
 check(f.s.zapSeq===31,'full clip emitted');
}
{
 const f=classic('blades',{x:3.6,z:0});f.fire();f.settle(1);
 check(f.b.health===0,'blade contact KOs instantly');f.b.respawn=0;f.b.spawnSeq++;f.b.health=100;f.settle(.3);check(f.b.health===100,'a blade pickup cannot hit the same rival again after respawn');
 f.settle(5);check(f.a.bladesT===0,'blades retire at 6 seconds');
}
{
 const f=classic('supernova',{x:0,z:6});f.fire();
 for(const kind of ['machinegun','cannon','missile']){f.s.zaps.push({id:'incoming-'+kind,owner:'b',kind,x:0,z:-1,angle:0,ttl:1,volley:kind});f.step(.03);}
 check(f.a.health===100,'bubble blocks every hit');check(f.a.supernovaT>0,'bubble survives repeated blocks');
 f.settle(3.2);check(f.b.health>10&&f.b.health<100,'nova uses radial damage');check(f.a.supernovaT===0,'nova bubble expires');
 check([...f.log.values()].filter(e=>e.type==='blast'&&e.weapon==='supernova').length===1,'nova detonates once');
}
// Homing starts only after a straight launch; the turn bound is a real
// dodge window. Near off-axis rivals can escape before acquisition.
{
 const f=classic('missile',{x:10,z:40});f.fire();f.step(.1);
 check(f.s.zaps[0].targetId==='b'&&Math.abs(f.s.zaps[0].vx)<1e-8,'missile reserves launch lock but flies straight before steering');
 let previous={x:f.s.zaps[0].vx,z:f.s.zaps[0].vz},locked=false;
 for(let i=0;i<80&&f.s.zaps.length;i++){
  f.step(1/60);const p=f.s.zaps[0];if(!p)break;locked ||= p.targetId==='b';
  const cosine=(previous.x*p.vx+previous.z*p.vz)/(Math.hypot(previous.x,previous.z)*Math.hypot(p.vx,p.vz));
  check(Math.acos(Math.max(-1,Math.min(1,cosine)))<=WEAPONS.missile.turnRate/60+1e-6,'missile cannot exceed bounded turn rate');previous={x:p.vx,z:p.vz};
 }
 check(locked&&f.b.health===35,'missile locks in-cone rival and lands 65 damage');f.settle(3);check(!f.s.zaps.length,'homing missile retires');
 const dodge=classic('missile',{x:8,z:12});dodge.fire();dodge.settle(3);
 check(dodge.b.health===100,'close off-axis rival can dodge launch and lock');
 for(const target of [{x:40,z:40},{x:0,z:100}]){const f=classic('missile',target);f.fire();f.step(.3);check(f.s.zaps[0].targetId===null,'missile ignores rivals outside cone or range');}
}
{
 const lane=CURATED_MUZZLE.x;
 const f=classic('cannon',{x:lane,z:20}),k=(pid,x,z)=>({pid,x,z,angle:0,speed:0,...battle.blankKart(),shield:0,input:{boost:false},physicalPose:{position:{x,y:.7,z},rotation:{x:0,y:0,z:0,w:1},linearVelocity:{x:0,y:0,z:0}}});
 f.a.physicalPose=k('a',0,0).physicalPose;f.b.physicalPose=k('b',lane,20).physicalPose;
 const near=k('c',lane+2.1,18.6);near.physicalPose.position.y=1.5;f.s.karts.push(near);f.connected.add('c');const kicks=[];
 const geometry={sweepStatic:()=>null,kickKart:(id,v)=>kicks.push({id,v})};f.a.pendingFire=true;f.step(0,geometry);
 check(f.s.zaps[0].vy===0,'level rockets follow the barrel without rising');
 for(let i=0;i<120&&f.s.zaps.length;i++)f.step(1/60,geometry);
 check(f.b.health===50&&near.health>50&&near.health<100,'one direct rocket deals 50 damage and splash falls off');
 check(kicks.some(k=>k.id==='b'&&k.v.z>8),'cannon applies large authoritative knockback');
 check(!f.s.zaps.length,'cannonball retires on contact');
}
{
 const f=classic('supernova',{x:0,z:6});f.fire();
 f.s.grenades.push({id:'incoming-nuke',kind:'nuke',owner:'b',x:0,y:0,z:0,vx:0,vy:0,vz:0,fuse:0,bounces:0});f.step(0);
 check(f.a.health===100&&f.a.supernovaT>0,'Supernova blocks a full Nuke without breaking');f.settle(3.1);
 check(f.b.health>10&&f.b.health<100&&[...f.log.values()].filter(e=>e.type==='blast'&&e.weapon==='supernova').length===1,'Supernova then detonates once');
}

// Real elevated pickups/inputs/physics, with no grant or damage hooks.
const pt=(id,x,z,angle=0)=>({id,x,y:0,z,angle,surface:'floor'});
let instances=0;
function mapFor(kind){
 const target=kind==='blades'?pt('b',3.7,0):kind==='supernova'?pt('b',0,7):['mine','proximity','fakecrate'].includes(kind)?pt('b',0,-9):kind==='boomerang'?pt('b',-2.2,12):pt('b',0,kind==='frost'?12:20);
 return {id:'curated',revision:'1',half:180,colliders:[{id:'floor',shape:'box',position:{x:0,y:-1,z:0},half:{x:180,y:1,z:180}}],spawns:[pt('a',0,0),target],sockets:[pt('s0',-.7,0),pt('s1',.7,0)]};
}
const one=w=>w.advance(w.snapshot().serverAt+1000/60);
function input(w,id,intent={}){const s=w.snapshot(id),a=s.you;assert.ok(w.input(id,{instance:s.instance,life:a.life,controlEpoch:a.controlEpoch,seq:a.receivedSeq+1,steer:0,throttle:0,brake:0,nitro:false,use:false,...intent},s.serverAt).ok);}
for(const weapon of WEAPON_IDS){
 let w;
 for(let seed=0;seed<1024;seed++){
  const t=elevated.createElevatedCombat(RAPIER,CONFIG,mapFor(weapon),[{id:'a'},{id:'b'}],{instance:'curated-'+(++instances),seed,startAt:0,countdownMs:0,roundMs:30000,crates:1});one(t);
  if(t.snapshot().karts[0].weapon===weapon){w=t;break;}t.dispose();
 }
 assert(w,'real pickup '+weapon);
 try{
  for(let i=0;i<160;i++)one(w);
  input(w,'a',{use:true});input(w,'a');
  const log=new Map();let hurt=0,peak=0;
  for(let i=0;i<850;i++){
   if(i%6===0){if(['mine','proximity','fakecrate'].includes(weapon)&&i<80&&w.snapshot().karts[1].alive)input(w,'b',{throttle:1});if(weapon==='ram'&&i<70)input(w,'a',{throttle:1});}
   one(w);const s=w.snapshot();for(const e of s.events)log.set(e.id,e);
   hurt=Math.max(hurt,100-s.karts[1].health);peak=Math.max(peak,s.projectiles.length+s.mines.length+s.grenades.length);
  }
  check([...log.values()].some(e=>(e.type==='fire'||e.type==='mine')&&e.weapon===weapon),weapon+' elevated fires');
  check(hurt>0,weapon+' elevated hits');
  const s=w.snapshot();check(!s.projectiles.length&&!s.grenades.length&&!s.mines.length,weapon+' elevated entities retire');
  check(s.karts.every(k=>!k.bladesT&&!k.supernovaT&&!k.rammingT&&!k.frostT&&!k.spinT),weapon+' elevated statuses retire');
  if(weapon==='machinegun')check([...log.values()].filter(e=>e.type==='fire'&&e.weapon===weapon).length===30,'elevated full 30-round stream');
  if(weapon==='trishot')check([...log.values()].filter(e=>e.type==='fire'&&e.weapon===weapon).length===3,'elevated three triple volleys');
 }finally{w.dispose();check(w.stats().projectiles===0,'disposal empties pools');}
}
console.log(JSON.stringify({pass:true,checks,scope:'12 curated weapons; real elevated collection and sequenced fire; classic rules and statuses'}));
