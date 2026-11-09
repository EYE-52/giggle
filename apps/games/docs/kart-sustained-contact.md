# Pocket Karts: 100 HP and sustained contact

This replaces the old three-heart/cooldown balance. Every new life has 100 HP.
Damage and knockouts remain server authoritative on classic and raised maps.

## Damage contract

- Machine Gun: 30 bullets, 5 HP each. Every distinct landed bullet counts. Twenty hits knock out.
- Tri-Shot: three volleys, three pellets each; nine pellets total, 150/9 HP each. Six landed pellets knock out. Ammo counts pellets and spending a volley costs three.
- A full rapid-fire pickup contains 150 HP of potential damage. Fractional HP stays in the authority. Display rounds remaining HP up. Floating-point residue below 1e-8 becomes zero.
- Blades and Turbo Ram: 100 HP on real contact. Cover, height, spawn shields, active protection and owner immunity still apply. One activation cannot farm a new life.
- Missile 65, Cannon 70, Mine 90, Frost 45, Supernova 90 and Nuke 120 are centre damage. Area damage follows `centre * (1 - smoothstep(distance / radius))`, reaching zero at the edge. Missile/Cannon direct contacts receive centre damage. A swept mine samples the triggering driver's position at contact, rather than after it crossed the trap.
- A KO clears the weapon, committed payload and status timers, awards once, and respawns at 100 HP. The same pickup never damages the next life.

## Current controlled physics measurements

`node test/kart-sustained-contact.mjs` uses real Rapier and both authorities. Classic uses Rookie Ring terrain; raised uses the actual 7m Alpine Courtyard deck. Declared body corrections hold aim/contact against knockback. Raised items come from real seeded crate collection and accepted inputs. Tri-Shot is measured at 8m, where all three pellets can hit. These are controlled activation-to-KO times, not natural chase or network measurements.

| Weapon | Rookie Ring | Raised deck | Required hits |
| --- | ---: | ---: | ---: |
| Machine Gun | 1.650s | 1.633s | 20 |
| Tri-Shot | 0.367s | 0.350s | 6 |
| Blades | 0.017s | 0.017s | 1 |
| Turbo Ram | 0.017s | 0.017s | 1 |

Other single-use explosives normally wound a full-health kart. Nuke can KO near its centre. Mines remain separate traps, with distance-based blasts. The full per-weapon report is in `artifacts/kart-weapons/contact-metrics.json`.

The previous three-heart benchmark recorded Machine Gun at 2.067/2.050s, Tri-Shot at 2.333/2.350s and Blades at 4.100s on these two maps. Those are historical balance results; the new HP rules and the close Tri-Shot fixture differ.

## Regression coverage

`kart-sustained-contact.mjs`, `kart-health.mjs` and `kart-weapon-system.mjs` cover independent sibling pellets, exact KO thresholds, owner immunity, stale lives, fresh pickups, shield expiry, blade cover/height, contact KO, smooth radial damage, removed IDs, pickup prediction, denial timeout, roulette end, shared model budgets, accepted event IDs and resource reuse. `kart-physical-fire.mjs` also proves initial barrel overlap cannot create a shot beyond cover.
