'use strict';

// Shared authority and wire description. Renderers read hearts; they never
// estimate damage from projectiles, distance or local collision effects.
//
// Every kart has three hearts. Each weapon takes a fixed whole number of
// hearts, at most once per rival per pickup (a whole Pulse clip that lands
// eight rounds still takes one heart). Mines are separate traps: each one
// that goes off takes its own heart. The Nuke takes every heart inside its
// radius. A Shield pickup blocks the next hit, whatever it is. Oil Slicks
// are traps like Mines (each one that catches a rival takes its own heart).
//
// Sixteen weapons. The second eight reuse the first eight's code paths:
// laser/boomerang/bouncer fly like Pulse shots, thunder strikes at once,
// oil drops like a Mine, frost/cluster lob like the Nuke and ram is a
// self-buff like the Shield. Status effects (seconds) ride on the victim:
// frost slows top speed, oil spins the kart out, ram boosts the rammer.
const weapons = Object.freeze(Object.fromEntries(Object.entries({
  pulse: { tier: 'common', damage: 1, ammo: 12, cooldown: .12 },
  scatter: { tier: 'common', damage: 1, ammo: 5 },
  mine: { tier: 'common', damage: 1, ammo: 3, triggerRadius: 2.2, armTime: .7, lifetime: 12, bodyRadius: .41, dropInterval: .24 },
  rocket: { tier: 'uncommon', damage: 2, ammo: 3, splashRadius: 3 },
  seeker: { tier: 'uncommon', damage: 1, splashRadius: 3 },
  proximity: { tier: 'uncommon', damage: 2, splashRadius: 5.5, triggerRadius: 3, armTime: .7, lifetime: 12, bodyRadius: .60 },
  shield: { tier: 'uncommon', damage: 0, blocks: 1 },
  laser: { tier: 'common', damage: 1, ammo: 2, speed: 190, ttl: .7 },
  thunder: { tier: 'uncommon', damage: 1, range: 40, halfAngle: 35 },
  boomerang: { tier: 'common', damage: 1, ammo: 2, speed: 30, outTime: .62, curveRate: 1.4, returnTurn: 7, ttl: 3.2, catchRadius: 2.2 },
  oil: { tier: 'common', damage: 1, ammo: 2, triggerRadius: 2.4, armTime: .5, lifetime: 12, bodyRadius: .41, dropInterval: .3, spinTime: 1.2 },
  frost: { tier: 'uncommon', damage: 1, splashRadius: 4.5, fuse: .9, slowTime: 2, slowFactor: .55 },
  cluster: { tier: 'uncommon', damage: 1, fuse: .75, bomblets: 5, splashRadius: 3 },
  bouncer: { tier: 'common', damage: 1, ammo: 3, speed: 48, ttl: 3.5, bounces: 4 },
  ram: { tier: 'uncommon', damage: 1, duration: 3, reach: 4.6, speedFactor: 1.5 }, // reach: hull centres once bumpers touch
  // The Nuke rolls last so the very top of the roll range lands on it.
  nuke: { tier: 'rare', damage: 3, splashRadius: 14 },
}).map(([id, value]) => [id, Object.freeze(value)])));
// Pickup odds by tier, split evenly inside each tier: seven commons at
// ~7.4% each, eight uncommons at ~5.4% each and the Nuke alone at 5%.
const tierWeights = Object.freeze({ common: .52, uncommon: .43, rare: .05 });
const weaponOrder = Object.freeze(Object.keys(weapons));
const pickupWeights = Object.freeze(Object.fromEntries(weaponOrder.map(id => {
  const tier = weapons[id].tier;
  return [id, tierWeights[tier] / weaponOrder.filter(w => weapons[w].tier === tier).length];
})));
// Enclose shipping/fallback radial XY art through axial roll and maximum
// tracer pulse, with >=.02m clearance. These only sweep static geometry;
// target hulls and damage retain their established tuning.
const staticSweepRadii = Object.freeze({ pulse:.22, scatter:.25, rocket:.42, seeker:.33, laser:.12, boomerang:.62, bouncer:.36 });
// Weapons without an authored muzzle launch from a kept weapon's muzzle.
const muzzleKind = Object.freeze({ nuke:'rocket', laser:'pulse', boomerang:'scatter', bouncer:'scatter', frost:'rocket', cluster:'rocket', thunder:'rocket' });
const config = Object.freeze({ maxHealth: 3, weapons, tierWeights, pickupWeights, weaponOrder, staticSweepRadii, muzzleKind });

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
