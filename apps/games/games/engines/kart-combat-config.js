'use strict';

// Shared authority and wire description. Renderers read hearts; they never
// estimate damage from projectiles, distance or local collision effects.
//
// Every kart has three hearts. Each weapon takes a fixed whole number of
// hearts, at most once per rival per pickup (a whole Pulse clip that lands
// eight rounds still takes one heart). Mines are separate traps: each one
// that goes off takes its own heart. The Nuke takes every heart inside its
// radius. A Shield pickup blocks the next hit, whatever it is.
const weapons = Object.freeze(Object.fromEntries(Object.entries({
  pulse: { tier: 'common', damage: 1, ammo: 12, cooldown: .12 },
  scatter: { tier: 'common', damage: 1, ammo: 5 },
  mine: { tier: 'common', damage: 1, ammo: 3, triggerRadius: 2.2, armTime: .7, lifetime: 12, bodyRadius: .41, dropInterval: .24 },
  rocket: { tier: 'uncommon', damage: 2, ammo: 3, splashRadius: 3 },
  seeker: { tier: 'uncommon', damage: 1, splashRadius: 3 },
  proximity: { tier: 'uncommon', damage: 2, splashRadius: 5.5, triggerRadius: 3, armTime: .7, lifetime: 12, bodyRadius: .60 },
  shield: { tier: 'uncommon', damage: 0, blocks: 1 },
  nuke: { tier: 'rare', damage: 3, splashRadius: 14 },
}).map(([id, value]) => [id, Object.freeze(value)])));
// Pickup odds by tier, split evenly inside each tier.
const tierWeights = Object.freeze({ common: .60, uncommon: .33, rare: .07 });
const weaponOrder = Object.freeze(Object.keys(weapons));
const pickupWeights = Object.freeze(Object.fromEntries(weaponOrder.map(id => {
  const tier = weapons[id].tier;
  return [id, tierWeights[tier] / weaponOrder.filter(w => weapons[w].tier === tier).length];
})));
// Enclose shipping/fallback radial XY art through axial roll and maximum
// tracer pulse, with >=.02m clearance. These only sweep static geometry;
// target hulls and damage retain their established tuning.
const staticSweepRadii = Object.freeze({ pulse:.22, scatter:.25, rocket:.42, seeker:.33 });
const config = Object.freeze({ maxHealth: 3, weapons, tierWeights, pickupWeights, weaponOrder, staticSweepRadii });

// Hearts one hit takes. The Nuke always empties a full set of hearts.
function damageAt(weapon) {
  const rule = weapons[weapon];
  if (!rule) return 0;
  return weapon === 'nuke' ? config.maxHealth : rule.damage;
}

// Deterministic weighted pick from a 0..1 roll.
function weaponForRoll(r) {
  let edge = 0;
  for (const id of weaponOrder) {
    edge += pickupWeights[id];
    if (r < edge) return id;
  }
  return weaponOrder[weaponOrder.length - 1];
}

module.exports = { config, damageAt, weaponForRoll };
