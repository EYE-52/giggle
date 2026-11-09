// Deterministic authority benchmark. Inventory/body placement is a declared
// fixture; Rapier, hull sweeps, terrain, damage, protection and KO are real.
// Body corrections hold the two drivers in contact despite weapon knockback.
// This measures one complete pickup, not repeated free inventory grants.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import RAPIER from '@dimforge/rapier3d-compat';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import {WEAPONS,WEAPON_IDS} from '../public/js/engines/kart-weapon-contract.mjs';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {classicStatics} from '../public/js/engines/kart-classic-motion.mjs';
import {createRoadTerrain} from '../public/js/engines/kart-road-terrain.mjs';
import maps from '../games/engines/kart-maps.js';
import battle from '../games/engines/kart-rules-battle.js';

// Capture the real private world at construction, without adding a production
// grant/teleport API or substituting any physics/combat implementation.
const require=createRequire(import.meta.url),physicsModule=require.resolve('../games/engines/kart-physics.js');
const realPhysics=require(physicsModule);let captured;
require.cache[physicsModule].exports={...realPhysics,createKartPhysics(...args){return captured=realPhysics.createKartPhysics(...args);}};
const elevated=require('../games/engines/kart-elevated-combat.js');
require.cache[physicsModule].exports=realPhysics;
await RAPIER.init();
const DT=CONFIG.fixedDt,STEPS=Math.round(10/DT),baseline=process.argv.includes('--measure-only');
const zero={x:0,y:0,z:0},identity={x:0,y:0,z:0,w:1};
let serial=0;
const targetFor=weapon=>weapon==='blades'?{x:3.4,z:0}:weapon==='ram'?{x:0,z:4}:
  ['mine','oil'].includes(weapon)?{x:0,z:-9}:weapon==='supernova'?{x:0,z:6}:
  weapon==='boomerang'?{x:-2.2,z:12}:{x:0,z:10};
function move(physics,id,p){physics.restoreKart(id,{position:p,rotation:identity,linearVelocity:zero,angularVelocity:zero});}

function classic(weapon,options={}){
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

function raised(weapon,options={}){
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
 const send=(id,use=false)=>{const s=w.snapshot(id),p=s.you;assert(w.input(id,{instance:s.instance,life:p.life,controlEpoch:p.controlEpoch,seq:p.receivedSeq+1,steer:0,throttle:.1,brake:0,nitro:false,use},s.serverAt).ok);};
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

const report=[];
for(const [map,create] of [['Rookie Ring',classic],['Alpine Courtyard (7m deck)',raised]])for(const weapon of WEAPON_IDS){
 const f=create(weapon),seen=new Set(),hits=[];let ko=null;
 try{
  for(let i=0;i<STEPS;i++){
   const s=f.tick(i);
   for(const e of s.events)if(!seen.has(e.id)){seen.add(e.id);if(e.type==='hit'&&e.other==='b')hits.push({at:+((i+1)*DT).toFixed(3),damage:e.damage});}
   if(s.dead){ko=+((i+1)*DT).toFixed(3);break;}
  }
  const result={map,weapon,hits:hits.length,damage:hits.reduce((n,e)=>n+e.damage,0),hitTimes:hits.map(e=>e.at),koSeconds:ko};report.push(result);
  if(!baseline){
   assert(result.hits>0,map+' '+weapon+' must land a real hit');
   if(['machinegun','trishot'].includes(weapon)){
    assert(ko>=2&&ko<=3,map+': full rapid-fire burst must KO within 2–3s; '+JSON.stringify(result));
    assert.equal(result.hits,3);assert.equal(result.damage,3);
    for(let i=1;i<hits.length;i++)assert(hits[i].at-hits[i-1].at>=WEAPONS[weapon].hitCooldown-.002,weapon+': pellets and rounds share a per-target cooldown');
   }
   if(weapon==='blades'){
    assert(ko>=3&&ko<=6,map+': sustained blades must KO within 3–6s; '+JSON.stringify(result));
    assert.equal(result.hits,3);assert.equal(result.damage,3);
    for(let i=1;i<hits.length;i++)assert(hits[i].at-hits[i-1].at>=WEAPONS.blades.hitCooldown-.002,'no duplicate contact damage inside cooldown');
   }
  }
 }finally{f.close();}
}
console.log(JSON.stringify({scope:'one full pickup; 60Hz real authority/Rapier; controlled sustained contact; 10s limit',report},null,2));
if(!baseline){
 for(const [label,create] of [['classic',classic],['raised',raised]])for(const weapon of ['machinegun','trishot']){
  const f=create(weapon,{protected:true}),seen=new Set();let damage=0;
  try{
   for(let i=0;i<STEPS;i++)for(const e of f.tick(i).events)if(!seen.has(e.id)){seen.add(e.id);if(e.type==='hit'&&e.other==='b')damage+=e.damage;}
   assert(damage<3,label+' '+weapon+": protected spawn cannot be KO'd by this burst");
   if(label==='classic')assert.equal(f.b.shield,0,'rejected contacts cannot refresh spawn shield');
  }finally{f.close();}
 }
 for(const [label,create] of [['classic',classic],['raised',raised]])for(const mode of ['height','cover','protected']){
  const f=create('blades',{protected:mode==='protected'}),seen=new Set();let damage=0;
  try{
   if(mode==='height')f.heightOffset=6;
   if(mode==='cover')f.physics.addStatic({id:'contact-wall',shape:'box',position:{x:f.origin.x+1.7,y:f.origin.y+1,z:f.origin.z},half:{x:.15,y:2,z:4}});
   for(let i=0;i<STEPS;i++)for(const e of f.tick(i).events)if(!seen.has(e.id)){seen.add(e.id);if(e.type==='hit'&&e.other==='b')damage+=e.damage;}
   if(mode==='protected')assert(damage>0&&damage<3,label+': protection expires naturally and is never refreshed by blade contact');
   else assert.equal(damage,0,label+': blades respect '+mode);
  }finally{f.close();}
 }
 // Real hull impacts with declared in-flight bullets isolate staggered rivals,
 // pellets, exact cooldown boundaries, life changes and volley cleanup.
 for(const weapon of ['machinegun','trishot']){
  const f=classic(weapon);f.a.pendingFire=false;
  const c={...structuredClone(f.b),pid:'c',x:5,z:0};f.s.karts.push(c);f.s.scores.c=0;f.connected.add('c');
  f.physics.addKart('c',{position:{x:5,y:.64,z:0}});let shot=0;
  const impact=(victim,volley=f.a.volley)=>{
   const p=f.physics.pose(victim.pid).position;
   for(let n=0;n<(weapon==='trishot'?3:1);n++)f.s.zaps.push({id:'timed-'+(++shot),owner:'a',kind:weapon,volley,physical:true,
    x:p.x,y:p.y+.35,z:p.z,vx:0,vy:0,vz:0,angle:0,ttl:.1,radius:weapon==='trishot'?.25:.22});
  };
  try{
   impact(f.b);impact(f.a);f.tick(0);assert.equal(f.b.health,2);assert.equal(f.a.health,3,'owner remains immune');
   for(let i=1;i<60;i++){impact(f.b);if(i===30)impact(c);f.tick(i);assert.equal(f.b.health,2,'sub-second contacts never refresh or bypass cooldown');}
   assert.equal(c.health,2,'another target gets its own immediate first hit');
   impact(f.b);impact(c);f.tick(60);assert.equal(f.b.health,1,'same rival takes next heart at one second');assert.equal(c.health,2,'staggered rival keeps its own deadline');
   for(let i=61;i<=90;i++){impact(c);f.tick(i);}assert.equal(c.health,1,'staggered deadline expires independently');
   f.b.spawnSeq++;f.b.health=3;f.b.shield=.5;
   for(let i=91;i<=160;i++){impact(f.b);f.tick(i);}assert.equal(f.b.health,3,'old volley never farms a new protected life');
   f.a.volley='fresh-rapid';impact(f.b);f.tick(161);assert.equal(f.b.health,2,'fresh pickup gets a fresh hit history');
   assert(!f.s.volleyHits.has('bench'),'spent volley releases timed history');
  }finally{f.close();}
 }
 // Two rivals have independent cooldowns; a respawned rival stays excluded
 // from the old activation, while a fresh pickup gets a clean contact ledger.
 const f=classic('blades');
 try{
  const c={...structuredClone(f.b),pid:'c',x:0,z:-11.4};f.s.karts.push(c);f.s.scores.c=0;f.connected.add('c');
  f.physics.addKart('c',{position:{x:0,y:.64,z:-11.4}});
  // Keep this third rival stationary and close enough for the first hit.
  f.tick(0);assert.equal(c.health,2,'each rival can take the first blade hit');assert.equal(f.b.health,2);
  assert.equal(f.a.health,3,'owner is immune to own blades');assert.equal(f.b.shield,0,'a landed blade hit does not add invulnerability');
  for(let i=1;i<110;i++)f.tick(i);assert.equal(f.b.health,2,'continuous rejected contacts do not bypass cooldown');
  f.b.spawnSeq++;f.b.health=3;for(let i=110;i<190;i++)f.tick(i);assert.equal(f.b.health,3,'old activation cannot damage a new life');
  f.a.weapon='blades';f.a.ammo=1;f.a.volley='fresh-blades';f.a.pendingFire=true;f.tick(190);
  assert.equal(f.b.health,2,'fresh pickup clears old contact ledger');
  battle.cancelPayloads(f.s);assert.equal(f.a.bladesHits,null,'phase cancellation releases cooldown ledger');
 }finally{f.close();}
 console.log('KART_SUSTAINED_CONTACT_PASS');
}
