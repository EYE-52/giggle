'use strict';
const { WEAPONS, WEAPON_ALIASES, normalizeWeapon } = require('../../public/js/engines/kart-weapon-contract.mjs');
// Each rapid-fire projectile counts; real contact knocks out.
// Other pickups hit each rival once; mines are separate area blasts.
const weapons = WEAPONS;
const tierWeights = Object.freeze({common:.52, uncommon:.43, rare:.05});
const weaponOrder = Object.freeze(Object.keys(weapons));
const pickupWeights = Object.freeze(Object.fromEntries(weaponOrder.map(id => [id,
  tierWeights[weapons[id].tier] / weaponOrder.filter(w=>weapons[w].tier===weapons[id].tier).length])));
const staticSweepRadii = Object.freeze({machinegun:.22,trishot:.25,missile:.42,cannon:.48});
const muzzleKind = Object.freeze({nuke:'missile',frost:'missile'});
const config = Object.freeze({maxHealth:100,weapons,tierWeights,weaponOrder,pickupWeights,staticSweepRadii,muzzleKind});
function damageAt(id) {return weapons[normalizeWeapon(id)]?.damage || 0;}
function weaponForRoll(r) {let edge=0;for(const id of weaponOrder){edge+=pickupWeights[id];if(r<edge)return id;}return 'nuke';}
// The volley owns its history until its clip and all shots have retired.
// Only successful, vulnerable contacts reach this gate. Misses and rejected
// hits never move the last-hit time; a new life cannot inherit old damage.
// One clip remembers each target's life and each bullet, not a hit cooldown.
// Sibling pellets can all land in one tick; an old clip cannot farm a respawn.
function volleyHit(volleys,volley,id,life,weapon,at,shot=null) {
  if(!volley)return true;
  let hits=volleys.get(volley);if(!hits)volleys.set(volley,hits=new Map());
  const last=hits.get(id),rapid=weapons[weapon]?.projectiles;
  if(last&&(last.life!==life||!rapid||last.count>=rapid||shot&&last.shots.has(shot)))return false;
  const value=last||{life,count:0,shots:new Set()};value.count++;if(shot)value.shots.add(shot);hits.set(id,value);return true;
}
function bladeContact(kart,id,life,applyDamage) {
  const hits=kart.bladesHits||(kart.bladesHits=new Map());
  if(hits.has(id)||!applyDamage())return false;
  hits.set(id,{life});return true;
}
const {blastDamage}=require('../../public/js/engines/kart-weapon-contract.mjs');
module.exports={config,damageAt,blastDamage,weaponForRoll,normalizeWeapon,bladeContact,volleyHit,weaponAliases:WEAPON_ALIASES};
