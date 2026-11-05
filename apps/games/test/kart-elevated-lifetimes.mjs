// Every elevated weapon, fired at nothing, leaves no live ordnance behind:
// projectiles, charges, mines and deployed hazards all retire within 15 s.
// Same real-pickup harness as kart-elevated-arsenal.mjs (no grants).
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import COMBAT from '../games/engines/kart-elevated-combat.js';
import LEGACY from '../games/engines/kart-rules-battle.js';
await RAPIER.init();
const results=[],measurements={},seeds=new Map();let instances=0;
const check=(label,value)=>{assert.ok(value,label);results.push(label);};
const point=(id,x,z,angle=0,y=0,surface='floor')=>({id,x,y,z,angle,surface});
const fixture=(colliders=[],spawns=[point('a',0,0),point('b',0,30)],sockets=[point('s0',-.7,0),point('s1',.7,0)])=>({id:'arsenal-test',revision:'test-1',half:180,colliders:[{id:'floor',shape:'box',position:{x:0,y:-1,z:0},half:{x:180,y:1,z:180}},...colliders],spawns,sockets});
const create=(map=fixture(),options={})=>COMBAT.createElevatedCombat(RAPIER,CONFIG,map,map.spawns.map(s=>({id:s.id})),{instance:'arsenal-'+(++instances),seed:0,startAt:0,countdownMs:0,roundMs:15000,crates:1,...options});
const step=(w,n=1,each)=>{for(let i=0;i<n;i++){each?.(i);w.advance(w.snapshot().serverAt+CONFIG.fixedDt*1000);}};
const kart=(w,id='a')=>w.snapshot(id).karts.find(k=>k.id===id);
function send(w,id='a',intent={}){const v=w.snapshot(id),p=v.you;return w.input(id,{instance:v.instance,life:p.life,controlEpoch:p.controlEpoch,seq:p.receivedSeq+1,steer:0,throttle:0,brake:0,nitro:false,use:false,...intent},v.serverAt);}
function fire(w,id='a',intent={}){assert.ok(send(w,id,{...intent,use:true}).ok);assert.ok(send(w,id,{...intent,use:false}).ok);step(w);}
function armed(weapon,map=fixture(),options={},wait=160){
  const key=weapon+JSON.stringify(map)+JSON.stringify(options),saved=seeds.get(key);
  for(const seed of saved===undefined?Array.from({length:512},(_,i)=>i):[saved]){
    const w=create(map,{...options,seed});step(w);
    if(kart(w).weapon===weapon){seeds.set(key,seed);step(w,wait);return w;}w.dispose();
  }
  throw new Error('bounded real pickup search failed for '+weapon);
}
const finite=v=>typeof v==='number'?Number.isFinite(v):v&&typeof v==='object'?Object.values(v).every(finite):true;
const live=s=>{const out={};for(const [k,v] of Object.entries(s))if(Array.isArray(v)&&v.length&&!['karts','crates','events','spawns','standings','players','sockets','results','scores'].includes(k))out[k]=v.length;return out;};
const far=fixture([],[point('a',0,0),point('b',170,170)]);
const seconds=n=>Math.round(n/(CONFIG.fixedDt));
for(const weapon of Object.keys(COMBAT.arsenal.weights)){
  const w=armed(weapon,far);
  try{
    check(`${weapon}: armed through a real pickup`,kart(w).weapon===weapon);
    fire(w);
    const afterFire=live(w.snapshot('a'));
    let peak={},clearAt=null;
    for(let i=0;i<seconds(15);i++){step(w);const now=live(w.snapshot('a'));for(const [k,v] of Object.entries(now))peak[k]=Math.max(peak[k]||0,v);
      if(!Object.keys(now).length&&clearAt===null)clearAt=i*CONFIG.fixedDt;if(Object.keys(now).length)clearAt=null;}
    const end=live(w.snapshot('a'));
    check(`${weapon}: nothing still live 15 s after firing (${JSON.stringify(end)})`,Object.keys(end).length===0);
    measurements[weapon]={afterFire,peak,clearedBySeconds:clearAt===null?0:+clearAt.toFixed(2)};
  }finally{w.dispose();}
}
console.log(JSON.stringify(measurements));
console.log(`KART_ELEVATED_LIFETIMES_PASS: ${results.length} checks; every elevated weapon retires its ordnance`);
