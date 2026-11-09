'use strict';
const { WEAPONS, WEAPON_ALIASES, normalizeWeapon } = require('../../public/js/engines/kart-weapon-contract.mjs');
// Most pickups hurt each rival once. Blades repeat every two seconds;
// individual mine/oil traps are separate.
const weapons = WEAPONS;
const tierWeights = Object.freeze({common:.52, uncommon:.43, rare:.05});
const weaponOrder = Object.freeze(Object.keys(weapons));
const pickupWeights = Object.freeze(Object.fromEntries(weaponOrder.map(id => [id,
  tierWeights[weapons[id].tier] / weaponOrder.filter(w=>weapons[w].tier===weapons[id].tier).length])));
const staticSweepRadii = Object.freeze({machinegun:.22,trishot:.25,missile:.42,cannon:.48,boomerang:.62});
const muzzleKind = Object.freeze({nuke:'rocket',frost:'missile',thunder:'missile',boomerang:'trishot'});
const config = Object.freeze({maxHealth:3,weapons,tierWeights,weaponOrder,pickupWeights,staticSweepRadii,muzzleKind});
function damageAt(id) {return weapons[normalizeWeapon(id)]?.damage || 0;}
function weaponForRoll(r) {let edge=0;for(const id of weaponOrder){edge+=pickupWeights[id];if(r<edge)return id;}return 'nuke';}
// Use simulation age, never wall time. A landed hit (or a block) starts the
// cooldown; rejected/protected contact cannot refresh it. Remember the first
// life so the same activation cannot farm a newly respawned rival.
function bladeContact(kart,id,life,applyDamage) {
  const hits=kart.bladesHits||(kart.bladesHits=new Map()),last=hits.get(id);
  if(last&&(last.life!==life||kart.bladesAge+1e-8<last.age+weapons.blades.hitCooldown))return false;
  if(!applyDamage())return false;
  hits.set(id,{life,age:kart.bladesAge});return true;
}
module.exports={config,damageAt,weaponForRoll,normalizeWeapon,bladeContact,weaponAliases:WEAPON_ALIASES};
