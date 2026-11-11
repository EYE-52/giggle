import assert from 'node:assert/strict';
import fs from 'node:fs';
import {galleryInventory} from './inventory.mjs';
import {kartWeaponDisplay} from '../../../public/js/engines/kart-weapon-hud.mjs';
import rules from '../../../games/engines/kart-combat-config.js';
const origin='http://127.0.0.1:8801';
const inventory=await (await fetch(origin+'/inventory.json')).json();
assert.deepEqual(Object.keys(inventory),rules.config.weaponOrder);
assert.equal(Object.keys(inventory).length,12);
for(const [kind,ammo] of Object.entries(inventory)){
  const ready=kartWeaponDisplay({weapon:kind,ammo});
  assert.equal(ready.kind,kind);assert.equal(ready.state,'ready');assert.equal(ready.count,'×'+(kind==='trishot'?Math.ceil(ammo/3):ammo));
  const used=kartWeaponDisplay(galleryInventory(kind,rules.config.weapons[kind],true));
  if(ammo>1){assert.equal(used.state,'firing');assert.equal(used.count,'×'+(kind==='trishot'?2:ammo-1));}
  else if(['blades','supernova','ram'].includes(kind))assert.equal(used.state,'active');
  else assert.equal(used.state,'empty');
  const empty=kartWeaponDisplay({weapon:kind,ammo:0});
  assert.equal(empty.state,'empty');assert.equal(empty.count,'');assert.equal(empty.kind,'crate');
  const image=await fetch(origin+'/assets/karts/weapon-thumbnails/'+kind+'.png');assert.equal(image.status,200);
  const b=Buffer.from(await image.arrayBuffer());assert.equal(b.toString('hex',0,8),'89504e470d0a1a0a');assert.equal(b.readUInt32BE(16),96);assert.equal(b.readUInt32BE(20),96);
}
assert.equal(inventory.mine,rules.config.weapons.mine.ammo);assert.equal(inventory.mine,3);
assert.equal(kartWeaponDisplay({weapon:'mine',ammo:3,firing:true}).detail,'Deploying');
assert.equal(kartWeaponDisplay({weapon:'pulse',ammo:12,firing:true}).detail,'Firing');
assert.equal(kartWeaponDisplay({weapon:'mine',ammo:3,respawn:1}).state,'away');
for(const route of ['kart-weapon-hud.mjs','kart-assets.mjs']){
  const response=await fetch(origin+'/js/engines/'+route);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);
}
for(const css of ['kart-arena','kart-elevated']){
  const response=await fetch(origin+'/css/'+css+'.css');assert.equal(await response.text(),fs.readFileSync(new URL('../../../public/css/'+css+'.css',import.meta.url),'utf8'));
}
assert.equal((await fetch(origin+'/missing')).status,404);
assert.equal((await fetch(origin+'/',{method:'HEAD'})).status,200);
assert.equal((await fetch(origin+'/',{method:'POST'})).status,405);
console.log('HUD_FIXTURE_PASS: 12 actual 96px images, authority ammo, ready/firing/empty semantics, shipping CSS/module bytes and read-only routes; native geometry review remains separate.');
