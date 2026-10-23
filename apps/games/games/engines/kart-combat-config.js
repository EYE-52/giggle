'use strict';

// Shared authority and wire description. Renderers read health; they never
// estimate damage from projectiles, distance or local collision effects.
const weapons = Object.freeze(Object.fromEntries(Object.entries({
  pulse: { damage: 10, ammo: 12, cooldown: .12 }, scatter: { damage: 9, ammo: 5, maxShotDamage: 27 },
  rocket: { damage: 40, directDamage: 100, ammo: 3, splashRadius: 3 }, seeker: { damage: 40, directDamage: 100, splashRadius: 3 },
  rail: { damage: 25, ammo: 5 }, grenade: { damage: 65, splashRadius: 4 },
  bomb: { damage: 80, splashRadius: 5.5, triggerRadius: 3, armTime: .7, lifetime: 12, bodyRadius: .60 },
  proximity: { damage: 70, splashRadius: 5.5, triggerRadius: 3, armTime: .7, lifetime: 12, bodyRadius: .60 },
  mine: { damage: 50, ammo: 3, triggerRadius: 2.2, armTime: .7, lifetime: 12, bodyRadius: .41, dropInterval: .24 },
  sentry: { damage: 13, rounds: 10, range: 30 }, spikes: { damage: 30, radius: 3.3, cooldownMs: 500 },
  nuke: { damage: 100, directDamage: 100, edgeDamage: 20, splashRadius: 14 }, shield: { damage: 100 },
  emp: { damage: 0, range: 12 },
}).map(([id, value]) => [id, Object.freeze(value)])));
// Enclose shipping/fallback radial XY art through axial roll and maximum
// tracer pulse, with >=.02m clearance. These only sweep static geometry;
// target hulls and damage retain their established tuning.
const staticSweepRadii = Object.freeze({ pulse:.22, scatter:.25, rocket:.42, seeker:.33, rail:.18, sentry:.18 });
const config = Object.freeze({ maxHealth: 100, weapons, staticSweepRadii });

function damageAt(weapon, distance = 0) {
  const rule = weapons[weapon];
  if (!rule) return 0;
  if (weapon !== 'nuke') return rule.damage;
  const fraction = Math.max(0, Math.min(1, distance / rule.splashRadius));
  return Math.round(rule.damage - (rule.damage - rule.edgeDamage) * fraction);
}

module.exports = { config, damageAt };
