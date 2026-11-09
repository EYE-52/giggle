// Deterministic authority benchmark. Inventory/body placement is a declared
// fixture; Rapier, hull sweeps, terrain, damage, protection and KO are real.
// Body corrections hold the two drivers in contact despite weapon knockback.
// This measures one complete pickup, not repeated free inventory grants.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import RAPIER from '@dimforge/rapier3d-compat';
import CONFIG from '../../public/js/engines/kart-physics-config.mjs';
import {WEAPONS,WEAPON_IDS} from '../../public/js/engines/kart-weapon-contract.mjs';
import {elevatedMap} from '../../public/js/engines/kart-elevated-maps.mjs';
import {classicStatics} from '../../public/js/engines/kart-classic-motion.mjs';
import {createRoadTerrain} from '../../public/js/engines/kart-road-terrain.mjs';
import maps from '../../games/engines/kart-maps.js';
import battle from '../../games/engines/kart-rules-battle.js';

// Capture the real private world at construction, without adding a production
// grant/teleport API or substituting any physics/combat implementation.
const require=createRequire(import.meta.url),physicsModule=require.resolve('../../games/engines/kart-physics.js');
const realPhysics=require(physicsModule);let captured;
require.cache[physicsModule].exports={...realPhysics,createKartPhysics(...args){return captured=realPhysics.createKartPhysics(...args);}};
const elevated=require('../../games/engines/kart-elevated-combat.js');
require.cache[physicsModule].exports=realPhysics;
await RAPIER.init();
export const DT=CONFIG.fixedDt;
const zero={x:0,y:0,z:0},identity={x:0,y:0,z:0,w:1};
let serial=0;
const targetFor=weapon=>weapon==='blades'?{x:3.4,z:0}:weapon==='ram'?{x:0,z:3.2}:weapon==='trishot'?{x:0,z:8}:
  ['mine','oil'].includes(weapon)?{x:0,z:-9}:weapon==='supernova'?{x:0,z:6}:
  weapon==='boomerang'?{x:-2.2,z:12}:{x:0,z:10};
function move(physics,id,p){physics.restoreKart(id,{position:p,rotation:identity,linearVelocity:zero,angularVelocity:zero});}

export function classic(weapon,options={}){
 const map={id:'ring',...maps.mapDef('ring')},terrain=createRoadTerrain(map),physics=realPhysics.createKartPhysics(RAPIER,CONFIG);
 classicStatics(map).forEach(d=>physics.addStatic(d));
 const base={x:0,z:-8},target=weapon==='frost'?{x:0,z:18}:targetFor(weapon),connected=new Set(['a','b']);
 const pose=(x,z)=>({x,y:terrain.heightAt(x,z)+.64,z});
 const a={pid:'a',x:base.x,z:base.z,angle:0,speed:0,...battle.blankKart(),shield:0,input:{steer:0,throttle:.1,boost:false}};
 const b={...structuredClone(a),pid:'b',x:base.x+target.x,z:base.z+target.z,shield:options.protected?2.5:0};
 const s={phase:'drive',lastTick:0,bound:map.half-2,half:map.half,blocks:map.blocks,crates:[],karts:[a,b],scores:{a:0,b:0},
  zaps:[],zapSeq:0,mines:[],mineSeq:0,grenades:[],grenadeSeq:0,events:[],eventSeq:0,volleyHits:new Map(),targetHits:99};
 for(const k of s.karts)physics.addKart(k.pid,{position:pose(k.x,k.z)});
 const sync=()=>{for(const k of s.karts){k.physicalPose=physics.pose(k.pid);k.x=k.physicalPose.position.x;k.z=k.physicalPose.position.z;}};
 const geometry={sweepStatic:(...args)=>physics.sweepStatic(...args),supportAt:(...args)=>physics.supportAt(...args),groundAt:(x,z)=>terrain.heightAt(x,z),kickKart:(...args)=>physics.kickKart(...args)};
 a.weapon=weapon;a.ammo=WEAPONS[weapon].ammo;a.volley='bench';a.pendingFire=true;sync();
 return {a,b,s,physics,connected,origin:pose(base.x,base.z),
  tick(i){const before=new Map(s.karts.map(k=>[k.pid,structuredClone(k)]));
   // Both drivers advance together slowly; trap victim instead drives forward.
   const travel=['mine','oil'].includes(weapon)?Math.min(i*DT*5,12):i*DT*.2;
   move(physics,'a',pose(base.x,base.z+(['mine','oil'].includes(weapon)?0:travel)));
   if(!b.respawn){const p=pose(base.x+target.x,base.z+target.z+travel);p.y+=this.heightOffset||0;move(physics,'b',p);}
   for(const k of s.karts)physics.applyIntent(k.pid,{throttle:.1,steer:0});physics.step();sync();
   s.lastTick+=DT*1000;battle.tick(s,connected,DT,before,null,new Map(),geometry);
   return {events:s.events,health:b.health,dead:b.respawn>0};},
  close(){physics.dispose();}};
}

export function raised(weapon,options={}){
 const map=elevatedMap('garden'),base={x:30,y:7,z:['mine','oil'].includes(weapon)?10:0},target=targetFor(weapon);
 const point=(id,x,z)=>({id,surface:'courtyard',x,y:7,z,angle:0});
 map.spawns=[point('a',base.x,base.z),point('b',base.x+target.x,base.z+target.z)];
 map.sockets=[point('s0',base.x-.7,base.z),point('s1',base.x+.7,base.z)];
 let w,physics;
 for(let seed=0;seed<1024;seed++){
  const trial=elevated.createElevatedCombat(RAPIER,CONFIG,map,[{id:'a'},{id:'b'}],{instance:'contact-'+(++serial),seed,countdownMs:0,roundMs:30000,crates:1});
  trial.advance(DT*1000);
  if(trial.snapshot().karts[0].weapon===weapon){w=trial;physics=captured;break;}trial.dispose();
 }
 assert(w,'real raised pickup: '+weapon);
 const send=(id,use=false)=>{const s=w.snapshot(id),p=s.you;if(!s.karts.find(k=>k.id===id)?.alive)return;assert(w.input(id,{instance:s.instance,life:p.life,controlEpoch:p.controlEpoch,seq:p.receivedSeq+1,steer:0,throttle:.1,brake:0,nitro:false,use},s.serverAt).ok);};
 for(let i=0;i<(options.protected?0:160);i++)w.advance(w.snapshot().serverAt+DT*1000);
 send('a',true);send('a');
 return {w,physics,origin:{x:base.x,y:base.y+.64,z:base.z},
  tick(i){const travel=['mine','oil'].includes(weapon)?Math.min(i*DT*5,12):i*DT*.2;
   move(physics,'a',{x:base.x,y:base.y+.64,z:base.z+(['mine','oil'].includes(weapon)?0:travel)});
   if(w.snapshot().karts[1].alive)move(physics,'b',{x:base.x+target.x,y:base.y+.64+(this.heightOffset||0),z:base.z+target.z+travel});
   if(i%6===0){send('a');send('b');}w.advance(w.snapshot().serverAt+DT*1000);
   const s=w.snapshot();return {events:s.events,health:s.karts[1].health,dead:!s.karts[1].alive};},
  close(){w.dispose();}};
}
