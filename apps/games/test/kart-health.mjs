import assert from 'node:assert/strict';
import {classic,raised,DT} from './helpers/kart-combat-fixtures.mjs';
import {CURATED_MUZZLE,WEAPONS} from '../public/js/engines/kart-weapon-contract.mjs';
let checks=0;
for(const [label,create]of [['classic',classic],['raised',raised]])for(const kind of ['machinegun','trishot','missile','cannon','blades','ram','frost','supernova','nuke','mine','proximity','fakecrate']){
 const f=create(kind),seen=new Map();try{let dead=false;for(let i=0;i<600;i++){const s=f.tick(i);for(const e of s.events)if(e.type==='hit'&&e.other==='b')seen.set(e.id,e);if(s.dead){dead=true;break;}}
  const hits=[...seen.values()],total=hits.reduce((n,e)=>n+e.damage,0);assert(hits.length>0,label+' '+kind+' real collision');assert(total>0&&total<=100+1e-8);assert(hits.every(e=>e.maxHealth===100&&e.health>=0));
  if(['machinegun','trishot','blades','ram'].includes(kind)){assert(dead,label+' '+kind+' KO');assert(Math.abs(total-100)<1e-8);}
  if(kind==='missile'){assert.equal(hits.length,1);assert.equal(total,WEAPONS[kind].damage);assert(!dead);}
  if(kind==='cannon'){assert.deepEqual(hits.map(e=>e.health),[50,0]);assert(dead);}
  assert(hits.every(e=>Object.values(e.position).every(Number.isFinite)));checks++;
 }finally{f.close();}
}
// Input remains authority checked; a stale life cannot control the next kart.
const f=raised('machinegun');try{
 const s=f.w.snapshot('a'),p=s.you;
 assert(!f.w.input('a',{instance:s.instance,life:p.life-1,controlEpoch:p.controlEpoch,seq:p.receivedSeq+1,steer:0,throttle:1,brake:0,nitro:false,use:true},s.serverAt).ok);checks++;
}finally{f.close();}
const blocked=raised('machinegun');try{const me=blocked.w.snapshot().karts[0],p=me.pose.position;blocked.physics.addStatic({id:'origin-overlap',shape:'box',position:{x:p.x+CURATED_MUZZLE.x,y:p.y+CURATED_MUZZLE.y,z:p.z},half:{x:.4,y:.2,z:.6}});const ammo=me.ammo;blocked.tick(0);assert.equal(blocked.w.snapshot().projectiles.length,0);assert.equal(blocked.w.snapshot().karts[0].ammo,ammo);checks++;}finally{blocked.close();}
console.log('KART_HEALTH_PASS '+checks+' actual classic/raised HP and collision contracts');
