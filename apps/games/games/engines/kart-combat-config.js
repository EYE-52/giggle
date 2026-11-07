'use strict';
const { WEAPONS, WEAPON_ALIASES, normalizeWeapon } = require('../../public/js/engines/kart-weapon-contract.mjs');
// One pickup can hurt each rival once. Individual mine/oil traps are separate.
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
module.exports={config,damageAt,weaponForRoll,normalizeWeapon,weaponAliases:WEAPON_ALIASES};
