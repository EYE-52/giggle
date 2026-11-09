import assert from 'node:assert/strict';
import {WEAPONS,WEAPON_IDS} from '../public/js/engines/kart-weapon-contract.mjs';
import {classic,raised,DT} from './helpers/kart-combat-fixtures.mjs';
const STEPS=600,baseline=process.argv.includes('--measure-only');
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
    assert(weapon==='machinegun'?ko>=1.5&&ko<=1.8:ko>=.28&&ko<=.45,map+': full rapid-fire burst must KO within 2–3s; '+JSON.stringify(result));
    assert.equal(result.hits,weapon==='machinegun'?20:6);assert(Math.abs(result.damage-100)<1e-8);

   }
   if(weapon==='blades'){
    assert(ko>0&&ko<=.05,map+': sustained blades must KO within 3–6s; '+JSON.stringify(result));
    assert.equal(result.hits,1);assert.equal(result.damage,100);
   }
  }
 }finally{f.close();}
}
console.log(JSON.stringify({scope:'one full pickup; 60Hz real authority/Rapier; controlled sustained contact; 10s limit',report},null,2));
if(!baseline){
 for(const [label,create]of [['classic',classic],['raised',raised]])for(const mode of ['height','cover','protected']){
  const f=create('blades',{protected:mode==='protected'}),seen=new Set();let damage=0;
  try{if(mode==='height')f.heightOffset=6;
   if(mode==='cover')f.physics.addStatic({id:'contact-wall',shape:'box',position:{x:f.origin.x+1.7,y:f.origin.y+1,z:f.origin.z},half:{x:.15,y:2,z:4}});
   for(let i=0;i<STEPS;i++)for(const e of f.tick(i).events)if(!seen.has(e.id)){seen.add(e.id);if(e.type==='hit'&&e.other==='b')damage+=e.damage;}
   assert.equal(damage,mode==='protected'?100:0,label+' blade contact respects '+mode+' and never farms the next life');
  }finally{f.close();}
 }
 console.log('KART_SUSTAINED_CONTACT_PASS');
}
