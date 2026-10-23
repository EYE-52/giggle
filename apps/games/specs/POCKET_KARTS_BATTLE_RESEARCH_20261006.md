# Pocket Karts: a stronger battle loop

Research date: 6 October 2026. This is a proposed design and QA scope, not a claim that the features are already implemented. All tuning values below are starting hypotheses for playtests. Keep Pocket Karts' own characters, artwork, names and maps.

## Recommendation

Make the next battle release about **drive → find a useful pickup → choose a fight or escape route → score a knockout → respawn safely → rejoin the fight**. A larger area and nicer scenery will not solve a weak loop by themselves. Replace rows of identical obstacles with connected routes, landmarks, cover and pockets that create different combat decisions.

Start with 2–8 active drivers, a 180-second timed free-for-all, one item slot, four distinguishable items, three arena layouts, safe respawns and a shared day-to-sunset cycle. Keep Star Rush available as a separate mode. Preserve score-goal battles as an explicit optional rule rather than the default: the user's recurring experience of a game ending with time left makes a timed default clearer.

## What the references actually establish

- Tall Team identifies Smash Karts as a browser/mobile kart battle game; its own Google Play description emphasizes short timed free-for-all rounds, collecting different power-ups, easy controls and private games. This supports the **pickup-and-combat loop**, not copying its assets or claiming any exact spawn algorithm. [Developer overview](https://tall.team/games), [publisher-authored SmashKarts.io description](https://play.google.com/store/apps/details?hl=en&id=com.tallteam.citychase).
- Nintendo describes Mario Kart 8 Deluxe's battle modes as different objectives, with dedicated arenas. Its item descriptions distinguish direct attacks, homing attacks, hazards, boosts, area effects and defensive invincibility. The lesson is that an item changes the decision, rather than merely changing a projectile's color. [Official battle overview](https://www.nintendo.com/au/games/nintendo-switch/mario-kart-8-deluxe/), [official item descriptions](https://www.nintendo.com/my/switch/aabp/item/index.html).
- Nintendo's update history documents item-box farming restrictions, corrections for item acquisition during unstable online communication, incoming-attack warnings and hit-invincibility tuning. These are useful examples of the edge cases this release must test. They do not prescribe Pocket Karts' numerical balance. [Nintendo update history](https://en-americas-support.nintendo.com/app/answers/detail/a_id/26098/).

The static Smash Karts website exposes little gameplay text. No exact crate respawn timer, spawn-protection duration, hidden item probabilities or matchmaking rule was verified from it. The proposals below are ours.

## Ten concrete principles

1. **Size maps around encounters, not an arbitrary multiplier.** A driving loop should take roughly 20–30 seconds at ordinary speed, with an interesting decision every few seconds. Aim for a visible rival or useful contested pickup within 5–8 seconds after returning to play. Measure this with two drivers as well as eight. Keep larger outer routes, but concentrate two-player pickup routes so the map does not become a search task.
2. **Build connected routes with recognizable places.** Every spawn pocket needs two exits. Pair a fast exposed route with a slower covered route; give the central objective space at least three approaches. Add a landmark visible from multiple directions. Avoid repetitive obstacle rows, blind dead ends and one unavoidable corridor.
3. **Randomize within legal authored locations.** The server selects from a validated pool of pickup sockets, with bounded jitter where clearance allows it. The pool must be inside the playable surface, reachable, outside solid colliders and separated from active pickups, respawning karts and blocking scenery. Random does not mean placing boxes anywhere in a rectangle.
4. **Give every item a purpose and readable counterplay.** Use a short-range burst, a longer-range aimed shot, a visible route trap and a defensive option. Tell players which item is loaded and how many uses remain. Telegraph mines and shields; cover must actually stop shots. Avoid powerful homing or map-wide attacks in the first scope.
5. **Make knockouts quick, clear and recoverable.** Show a short comic impact and attacker credit, then return the driver quickly. Preserve the player's match score. An eliminated player should not become a spectator for the rest of a casual battle. Clear held actions on knockout/respawn; an old held Fire input must not attack on the new life.
6. **Protect returning players without enabling shielded aggression.** Pick a safe spawn by occupancy, distance from threats and line of sight. Give a visibly different spawn shield for 2.5 seconds. While that shield is active, outgoing fire is disabled; moving is allowed. Never award an attacker a hit on an invulnerable target. Ordinary pickup shields use their own clear timer and rules.
7. **Keep physics playful and predictable.** Prioritize consistent steering, drift, grip and gentle glancing contacts. Do not let bumps grant combat points or launch karts across the arena. Real ramps, height changes and destructible rigid bodies need simulation support; decoration must not imply a jump that does not exist. Improve continuous collision tests before adding a larger physics dependency.
8. **Make shared state genuinely shared.** Pickup ownership, random item choice, damage, respawn position, invulnerability and score live on the server. A pickup is consumed once; a victim life can be knocked out once. Clients send actions, then animate the accepted state. Use swept projectile collision so a fast shot cannot cross a thin wall or kart between snapshots.
9. **Make sunset part of the match, without changing fairness.** Publish a server-authored cycle start, duration and seed. Clients render the same normalized phase using the existing calibrated clock, so late join/reconnect shows the same sun position. Blend sky, fog, sun direction and ambient light gradually. Keep terrain, rival silhouettes and pickup contrast readable at every phase; gameplay visibility should not depend on the client's theme toggle.
10. **Keep the controls and HUD simpler than the scene.** Steering, drift and one contextual Use button should carry the loop; on touch, keep controls large and separated. Put the current item beside Use, the clock centrally, score compactly, and the full standings in a drawer. A small optional Giggle Meet dock protects the driving view and continues the existing call.

## Bounded first playable

### Match and scoring

- **2–8 drivers**, with the existing additional watcher seats. No required bots in the first release.
- Three-second countdown, then **180 seconds** by default; allow a sensible duration setting.
- Highest knockout count at timeout wins; ties share the win. Zero-action timeout does not invent a winner. Keep cumulative Night awards exact-once.
- One successful offensive hit knocks out a kart in the initial prototype. This keeps feedback simple; do not add a health bar unless playtests show repeated-hit duels are more fun.
- Proposed knockout downtime: **1.2 seconds**, followed by a safe respawn with **2.5 seconds** of spawn protection. Do not insert advertising into this short loop in this implementation.
- Preserve timed play to the deadline. An optional score target, if enabled, must display the goal throughout and explain that goal as the completion reason.

### Item pool and first balance pass

All names and values are working proposals. One slot means no hidden reserve item and no large inventory UI. A full slot does not consume another crate. A collected item cannot be rerolled by parking inside the pickup.

| Item | Initial share | Behavior | Counterplay and limits |
| --- | --- | --- | --- |
| **Spark Rocket** | 40% | One aimed projectile; relatively long reach and a small, visible impact burst. | No homing; cover stops it. Use swept collision and a bounded lifetime. Keep blast range small enough to require aim. |
| **Pulse Trio** | 30% | Three short-range pulse shots, fired deliberately with a small per-shot cooldown. | Lower reach than the rocket; useful while chasing, less effective across the map. No automatic firing from a held button across a respawn. |
| **Pop Mine** | 20% | Drop one bright trap behind the kart; arm after a brief delay. | Visible warning ring, roughly 12-second lifetime, owner immunity and a maximum of two owned mines. Cannot be placed in protected spawn pockets; do not create an unavoidable trap in the only exit. |
| **Bubble Shield** | 10% | Four seconds of defensive invulnerability and a clear bubble effect. | It earns no knockout by touching a rival. With one item slot it cannot combine with an offensive inventory item. Keep distinct from the shorter spawn shield. |

Start with the same published item probabilities for everyone. Reconsider modest comeback weighting only after measured playtests; invisible, aggressive ranking-based odds can make outcomes feel arbitrary. A host can disable an item for an experiment later, but do not multiply modes before the baseline is fun.

### Pickup distribution

- Author **32–64 candidate sockets** per large arena; validate them against the same collision definition used by the server and renderer.
- Starting active population: `clamp(4 + activeDrivers, 6, 12)`, with a global hard cap. These counts are tuning proposals.
- After consumption, reappear in a different eligible socket following a randomized server delay of roughly **6–9 seconds**. Avoid consecutive reuse of the consumed socket. Use a stable authoritative pickup ID/generation.
- Keep pickups spread across regions; include a tempting exposed central pickup and safer route pickups. A uniform random sample can accidentally starve one region, so enforce simple region quotas before random choice.
- Do not spawn a pickup under a kart, inside cover, on a mine, in a protected spawn pocket or in an unreachable side of a closed route. If no candidate is valid, retry later instead of forcing an invalid spawn.
- Record time-to-first-item and longest item drought in playtests. At two players, concentrate active sockets toward shared routes while keeping the full arena drivable.

### Three map directions

Reuse existing map names where possible instead of adding another catalog of small variations. Their final footprints should come from the encounter targets above and measured driving speed.

| Arena | Layout and combat decision | Environment | First-scope restriction |
| --- | --- | --- | --- |
| **Garden Circuit** | Wide outer drift loop, two cross-cuts around a central conservatory, three entrances into an exposed plaza. Covered pickup pockets alternate with long aiming lanes. | Hills, trees, river edge, greenhouse landmark and warm sunset. Curved planting islands replace box rows. | Keep gameplay surfaces flat; any bridge is a ground-level visual treatment until height-aware collision is implemented. |
| **Frosty Pass** | Two connected loops around rocky cover and a broad icy lake section. High grip along the edge gives a safe route; crossing the low-grip center is faster and riskier. | Alpine ridge silhouette, cool snow, pines and late-day pink light. | No cliffs with fake vertical jumps. Ice must affect the shared handling model and local prediction equally. |
| **Neon Yard** | Offset wide lanes, rounded cover pockets, two diagonal shortcuts and a central carousel landmark. Offers close pulse fights and medium-range rocket lanes. | Night-market color, luminous signs, curved canopy structures and restrained reflective accents. | Avoid bloom-dependent readability and tightly packed crates masquerading as a new layout. |

Randomly placed pickups vary the decisions within these authored layouts. Random obstacle generation is unnecessary for the first scope and could break routes, spawns and camera sightlines.

### Fair respawn selection

Use a finite authored spawn pool with enough candidates beyond the active driver count. Reject candidates overlapping karts, solids, mines, active blasts or reserved spawn positions. Score valid candidates by distance to threats, immediate enemy line of sight, recently used spawn penalties and two-exit route availability. Break equal scores using the server's seeded selection.

Reserve a selected position while a respawn is committed, so simultaneous knockouts do not telefrag each other. If no ideal location exists, choose the best collision-free candidate and retain the visible protection period; never run an unbounded random search. Spawn facing a drivable route rather than a wall. Do not give the returning driver a free offensive shot while invulnerable.

Treat `lifeId`, `respawnAt`, `invulnerableUntil`, pickup generation and item uses as server data. Projectiles already fired can keep their bounded lifetime and attacker attribution after that attacker is knocked out; specify this consistently. New actions from dead/protected states are rejected. A respawn is a teleport, so prediction snaps and resets rather than easing through scenery.

### Shared sunset contract

Provide something equivalent to `{ cycleStartServerMs, cycleDurationMs, cycleSeed, cycleMode }` in the match snapshot. Derive progress from `api.now()`, not `Date.now()` or time since the browser page opened. A fixed palette is still a customization option; a dynamic sunset is a distinct choice. During results, use the completed match's final phase so the scene does not restart its cycle when the result UI mounts.

Compute inexpensive colors/directions per frame and update existing lights/material uniforms. Do not regenerate environment maps, geometry or textures every animation frame. Avoid lowering ambient light so far that combat becomes unreadable. This cycle is visual and should not modify friction, damage or item odds in the first scope.

## Pitfalls and release evidence

- **Huge but empty:** evaluate two-driver encounter frequency; more scenery is not activity.
- **Cosmetic map changes:** each arena needs a route/cover/grip decision the others do not have.
- **Camping:** validate pickup relocation, regional availability and spawn safety; mines cannot lock a protected exit.
- **Invulnerability disagreement:** damage gates use server time; client opacity or a bubble animation never determines legality.
- **Double scoring:** simultaneous projectiles, duplicate pickups and stale old-life inputs must resolve once. Include unstable-connection pickup tests motivated by Nintendo's documented fixes.
- **Projectile tunneling:** use segment/shape sweeps and earliest collision time, including walls before targets; increasing art detail does not improve this.
- **Automatic fire after death:** clear held actions and prediction, and require a fresh use-button edge.
- **Broken low-count balance:** test every map with two people, not only eight bots or fixtures. Check item drought and sightlines.
- **Expensive sunset:** profile render calls, triangle/effect counts, object allocations and shadow cost at day, sunset and night. Test real touch driving at each phase, not only screenshots.
- **Scope sprawl:** defer online ranking, a weapon shop, destructible buildings, full rigid-body ragdolls, public map editing and many extra modes. First finish the actual loop.

Release evidence should include complete two- and eight-driver flows, watcher rejection, join/reconnect, simultaneous pickup/KO, safe simultaneous respawns, no attacks during protection, no score from contact, mine expiry/caps, wall occlusion, weapon caps, timeouts, stopped results clocks, rematch, changing games and all three maps. Exercise representative delayed/dropped snapshots and actual portrait/landscape input. Two clients started at different local times must show the same sunset phase; a reconnect must resume it. Record measured limits rather than promising zero lag or absolute absence of bugs.
