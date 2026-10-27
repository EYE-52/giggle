# Pocket Karts: authoritative elevated arenas

Date: 2026-10-07. Status: candidate Room integration and opt-in elevated client implemented and tested; not deployed. The original source audit below describes the flat production baseline. Root owns the gameplay and art decisions. This is a combat upgrade, with the same karts, eight items and mystery crates across arenas; it introduces no racing laps, checkpoints or finishing order.

## Implemented candidate slice

The audit below describes the production baseline. After the audit, root pinned `@dimforge/rapier3d-compat` 0.21.0 and implemented the isolated development adapter with the contributor. The legacy `kart-engine.js` stays unchanged. Candidate `games/engines/kart-elevated-adapter.js` exposes the new profile through Room only for three new map labels; the deployed baseline still lacks elevation.

Implemented files: `games/engines/kart-physics.js` (private dynamic chassis/four raycast wheels), `public/js/engines/kart-physics-config.mjs` (one shared numeric tune), and `public/js/engines/kart-elevated-maps.mjs` (the same closed wedges, decks and solids for renderer/collision). An isolated local harness imports the exact adapter/config, actual kart GLB and shared map descriptors; it uses no generated concept image as a backdrop.

Root's actual Rapier map suite passes 341 checks: 8 supported driver spawns per map, 24–25 supported candidate crate sockets, seven driven ramps reaching their decks, and bridge/underpass separation at equal `x/z`. Frost's optional kicker produces 26 unsupported fixed steps followed by a supported ice landing. Observed chassis heights reach 7.79 m (Courtyard), 8.86 m (Quarry), and 6.78 m (Harbor) in these development layouts. These are physical geometry tests, not finished environments or combat matches.

Root independently drove the diagnostic kart through actual browser touch-button gestures in a 568×320 scene: grounded chassis height rose from 0.64 to 4.64 on its bridge, with 4/4 wheel contacts. The frozen adapter passes 44 actual Rapier checks in Node and the browser, including a physical roof blocking upward ramp motion. Closing the owned browser test tab proves disposal with zero kart/static/model resources and a retired animation loop. This is Mac browser QA, not a physical phone or network-lag measurement. Exact source hashes and evidence are recorded in `/tmp/giggle-kart-elevation-20261007/source-freeze.sha256` and `report-final.json`; root acceptance is in `/tmp/giggle-root-art-review-20261007/`.

Adapter API v2 adds explicit solid sweeps, static overlap checks, hull enable/disable, all-axis disconnect freeze and bounded drive tuning. Root independently reran 60 actual Rapier adapter checks and all 341 map checks. The original 44-check native diagnostic proof above is retained as version-1 evidence.

The new isolated `games/engines/kart-elevated-combat.js` passes 159 real authority checks, independently rerun by root: collect on an elevated deck, fire, confirmed knockout, two-second safe protected respawn, deadline, exact-once result and a fresh rematch. Eight items obey 3D height/cover checks; private RNG, input queues and wallets stay out of spectator projections. Across 600 fixed steps with eight drivers, measured Node median/p95 advance costs are 0.112–0.118 / 0.171–0.188 ms; an active-item workload measures 0.141 / 0.342 ms. Initialization is excluded; this is not a phone, Internet or multi-room latency measurement. Exact version-2 hashes and evidence are in `/tmp/giggle-kart-elevation-20261007/combat-v2-recovery-source-freeze.json`.

The actual renderer passes 349 geometry/resource checks and 358 native viewport checks across 24 isolated scenes. Root additionally drove the main-app elevated client with native stick gestures and verified deadline/results/rematch. Production integration passes 257 Room and 211 actual-server WS checks; 27 full-pose and 55 client lifecycle/control checks accompany it. The candidate selectors offer Alpine Courtyard, Frost Quarry and Neon Harbor only with timed Zap Battle/Garage off. The main client uses 50ms full-pose interpolation, not local 3D prediction/replay. Graphics failures are explicit manual Retry/Back to room. This bounded art iteration is below the aspirations; physical-phone, WAN responsiveness, encounter balance and final art acceptance remain open before public release. Integration hashes: `/tmp/giggle-kart-elevated-integration-20261007/FREEZE.json`; world hashes: `/tmp/giggle-elevated-world-20261007/elevated-world-source-freeze.json`.

Companion art/topology contract: [Pocket Karts combat maps](art-direction/POCKET_KARTS_COMBAT_MAPS_20261007.md). Preserve runtime IDs: `garden` is Alpine Courtyard, `frost` is Frost Quarry, and `neon` is Neon Harbor. The Courtyard's paired ramps/underpass, Quarry's shelf bridge/jump/safe bypass, and Harbor's loading decks are required playable topology, not decorative geometry. Water/ice and boundary classifications need explicit authored collision roles.

## Recommendation

Use one Rapier dynamic chassis and four raycast suspension wheels per kart, in one private physics world per game instance. Start with static ground, closed ramps and finite-thickness platforms built from shared, versioned collision descriptors. Keep the existing room, controls, scoring, items and 10 Hz snapshot transport. Integrate at a fixed 1/60 s step, then measure whether the existing 100 ms room pump is responsive enough; a 60 Hz physics scheduler with a separate 10 Hz broadcast cadence is the fallback if it is not.

This is the smallest implementation that can honestly deliver driveable elevation, physical takeoff, gravity, suspension, landing and kart collisions. Four separate wheel bodies and joints, moving platforms, destructible terrain, arbitrary imported-mesh collision and a new jump button are outside the first release. A height lookup bolted onto the existing flat movement is insufficient: it cannot represent a bridge and its underpass or physical flight.

Rapier's vehicle controller uses a dynamic chassis with raycast wheels, exposes suspension/contact state and applies wheel forces before each world step. That fits the existing visual wheel pivots without requiring four additional rigid bodies. Its kinematic character controller requires application-supplied gravity and does not provide rotational vehicle motion. These are documented capabilities, not evidence that the current game implements them. [Official JavaScript controllers guide](https://rapier.rs/docs/user_guides/javascript/character_controller/)

## Historical source audit — before this candidate

| Boundary | Current implementation | Needed for elevated combat |
| --- | --- | --- |
| Authoritative motion | `games/engines/kart-engine.js`: `stepKartOnce` advances `x/z`, yaw, signed scalar speed and lateral slip. There is no kart `y`, vertical velocity, quaternion, angular velocity or suspension state. | Full body translation/rotation/velocities, gravity, contact resolution and wheel support. |
| Tick | `server/server.js` calls room ticks every 100 ms. The engine caps elapsed time at 0.25 s and subdivides movement to at most 0.04 s; ordinary 100 ms ticks use three motion steps. | Fixed 1/60 s physics steps with an explicit accumulator and simulation clock; transport frequency is a separate concern. |
| Kart contacts | `resolveContacts` uses planar circles, stable roster order and up to eight contact passes after each motion substep. `collideBlocks` resolves planar rectangles. | Rapier chassis contacts replace these functions for the new profile. Running both would double-correct motion and destroy ramps. |
| Map authority | `kart-maps.js` provides rectangles in `x/z`, grip rectangles, pickup sockets and planar spawns. Ring/Blocks are 60-unit arenas; Garden/Frost/Neon are 120-unit arenas. | Stable surface/collider IDs, actual height, finite thickness, rotation and slope; supported pickup/spawn positions. |
| Rendered terrain | `kart-world.mjs` keeps the playable ground flat. `apronHeight` raises scenery beyond the arena, not the legal driving surface. Obstacles have visible height but planar authority treats them as full-height cover. | Playable meshes and collision shapes generated from the same dimensions, including ramp sides and platform undersides. Decorative hills remain decoration. |
| Local prediction | `kart-pose.mjs` mirrors flat motion, Nitro, drift, garage tuning and planar cover. It predicts the local driver and buffers remote planar poses; it does not predict rival contacts. | A versioned 3D predictor, authoritative corrections and bounded input replay. No flat prediction plus a cosmetic height animation. |
| Public projection | Engine `view` projects `simAt = lastTick`, `x/z/angle/speed/vx/vz/slip`, life/boost timers and mode extras. It has no kart height or wheel contacts. | Actual integrated simulation tick/time, full 3D pose and velocities, grounded/wheel state and an acknowledged input sequence. |
| Visual kart | `kart-model.mjs` explicitly animates cosmetic wheel spin and lean. `kart-view.js` places live kart roots at ground height, with a separate cosmetic KO hop. | Chassis quaternion and wheel compression/rotation derived from physical state; art origin offset is explicit. |
| Camera/fallback | Chase camera height and look-at height are absolute constants. The 2D renderer shares planar prediction and map rectangles. | Camera follows kart elevation and avoids solid geometry; fallback depicts layers rather than silently flattening the authority. |
| Weapons | Pulse/Scatter/Rocket/Rail, mines, EMP, pickups and splash checks are planar. Grenades alone have `y/vy` and a ballistic arc, but bounce on `y=0` and use full-height planar cover/planar blast damage. | Height-aware muzzle, sweeps, support, line of sight, splash and effects for all eight items. Grenades need actual surfaces, not only their existing arc. |
| Lifecycle | Game creation is synchronous. Room already calls `def.dispose(state)` on replacement, lobby return and destruction; the kart factory currently exposes no disposal hook. | Pre-initialize WASM, then synchronous world creation; add idempotent kart disposal using the existing room hook. |

Source anchors: `kart-engine.js` helpers `kartVelocity`, `collideBlocks`, `resolveContacts`, `stepKartOnce`, `onAction`, `onTick`, `view`; battle helpers `respawn`, `launchZap`, `hullImpact`, `splashBlocked`, `stepGrenade`, and `rules.tick`; `kart-world.mjs` `apronHeight`, `cleanRects`, `syncMap`; `kart-pose.mjs` `ingestSnapshot`, `framePoses`; `kart-view.js` `mount3d`, `paint2d`, `disposeAll`.

Existing `POCKET_KARTS_SPEC.md` explicitly excludes physical ramps/suspension from its flat revision. Some historical sections also describe six items or older projectile speeds. The actual eight-item authority is the migration baseline: current Pulse/Scatter/Rocket/Rail speeds are 110/95/85/160 units/s. Historical prose and green flat tests cannot demonstrate 3D physics.

## Concrete code boundaries

The following are proposed changes, not new files already implemented.

| File/area | Responsibility in the upgrade |
| --- | --- |
| New shared physics configuration/data module | Numeric axis conventions, chassis dimensions/mass/origin offset, four wheel anchors/radii, suspension/traction tuning, fixed step, collision groups and schema version. One source consumed by server and prediction, with thin CommonJS/ESM integration rather than duplicated tuning. |
| New `games/engines/kart-physics.js` adapter | Own Rapier worlds, bodies and controller handles; build static map colliders; apply validated controls; step; read serializable kart poses; reset life state; execute support/overlap/solid queries; dispose. Do not own scores, items or network sockets. |
| `kart-engine.js` | Select legacy/new profile at instance creation; retain roster/settings/input gates and round lifecycle; schedule fixed steps; coordinate motion and battle work in each step; project versioned 3D state; provide `dispose`. Keep runtime objects in a private side table, never in public JSON. |
| `kart-maps.js` | Authoritative finite-height collider/surface descriptors, supported spawn/socket data and map revision. Preserve existing IDs/settings. New arena geometry must be reviewable independently of decorative assets. |
| `kart-rules-battle.js` | Adapt geometric tests and per-step timing to 3D, while keeping item caps, fire-edge rules, shield behavior, KO/respawn timing and score/coin awards. Keep a single award path. |
| `kart-pose.mjs` plus a small client physics adapter | Versioned 3D local prediction, input acknowledgements/replay, bounded remote pose history and full-pose reconciliation. Legacy flat profile remains available during migration. |
| `kart-world.mjs` | Render shared map shapes, include all shape/height/rotation/version fields in rebuild keys, and keep outer scenery separate. `cleanRects` currently discards the fields elevation needs. |
| `kart-view.js`, `kart-model.mjs`, `kart-flight.mjs` | Full-pose roots/wheel state, supported crate/effect heights, height-aware visual shot clipping, chase/overview camera, truthful 2D fallback and disposal of prediction resources. Existing model/template/material sharing remains. |
| Server bootstrap/package/SDK packaging | Root-owned future integration: exact Rapier version, asynchronous initialization before the new profile can start, browser WASM/module delivery, packed SDK dependency/load contract. No Promise may be stored as room game state. |
| Tests/specs | Preserve flat-profile checks; add genuine elevation, geometry, weapon, network and lifecycle proofs. Update release claims only after observed runtime results. |

## Physics and map contract

1. Preserve `+Y` up and kart nose `+Z` at yaw zero. Existing positive steering means screen-right, which is `-X` at yaw zero; reversing reverses steering response. Configure the vehicle's up/forward axes and local wheel axle explicitly and test signs. Do not copy an example vehicle's axes blindly.
2. Establish the model-to-chassis transform from the actual GLB pivot data. The visual root currently sits under the kart; the physical body center will not. Existing wheel radii are front 0.385 and rear 0.465 units. Extract/review four anchors, choose a simple chassis collider and center of mass, then calibrate gravity, mass, spring force and damping in existing world units. No particular handling tune has been validated yet.
3. Apply engine/brake/steering forces through the controller; gravity and body contacts determine elevation. Pitch and roll remain physical. A bounded server-side stability/uprighting assist may make combat approachable, but cannot fake landing by rewriting the render mesh or locking every rotation.
4. Driveable wheel rays exclude all kart colliders, including offline karts temporarily made fixed, and sensors. Physical chassis collisions still collide with other live karts and finite-height solids. Surface grip comes from the actual wheel contact surface, so ice below a bridge cannot affect a kart on its deck. Preserve Nitro/drift/EMP/garage gameplay effects through one shared tuning function; changed handling needs acceptance tests rather than a claim of exact old trajectories. Raycast wheels do not provide separate wheel-side colliders: chassis shape/clearance must prevent visible wheels clipping walls, and that limitation needs an observed contact test.
5. First geometry uses fixed boxes and closed convex wedges/ramps with stable IDs. A platform has a top, sides and underside. Shared descriptors include `id`, shape/dimensions, position, quaternion, material/grip and query/collision role; supported spawns/sockets refer to surface IDs and 3D positions. Renderers use these descriptors, not a separately authored guessed height.
6. A heightfield can represent single-valued ground but cannot alone encode an overpass with two surfaces at the same `x/z` (geometric inference). Keep bridge decks separate solid shapes. Avoid arbitrary scenery meshes as collision authority. Rapier offers primitive, convex, mesh and heightfield colliders; simple explicit shapes keep this first implementation inspectable. [Official JavaScript colliders guide](https://rapier.rs/docs/user_guides/javascript/colliders/)
7. Authored spawn/socket validation checks support normal, usable headroom, hull clearance, distance from edges, accessibility and occupancy in 3D. Do not fall back to `(0,0)` or a crowded unsupported platform. If no legal respawn exists, keep the kart out of play briefly and retry a bounded safe policy. Shield does not make an overlapping or falling spawn valid.
8. Keep one kart/weapon/crate asset registry and one combat balance across maps. Pilot a Garden ramp/deck route; expand Frost and Neon only after their routes and grip pass. Ring/Blocks can remain flat arenas using the same upgraded vehicle profile. Star Rush remains on the legacy profile until its stars and boosts have supported-height semantics; this upgrade's release target is Zap Battle.

Rapier provides 3D scene queries with filtering, including ray and shape casts. Use them for static solid sweeps, support, headroom and camera clearance. Moving-target hit ordering remains application work; a cast against only target end poses is not a relative-motion sweep. [Official JavaScript scene-query guide](https://rapier.rs/docs/user_guides/javascript/scene_queries/)

## Fixed steps, input and authority

The current 10 Hz pump is not itself a 60 Hz simulation. It can run six fixed steps in a normal call, but receipt-to-shot latency and clustered work still need measurement.

Proposed ordering for each fixed step:

1. Apply bounded validated input changes/Use edges scheduled at the next eligible simulation boundary, using server receipt time and sequence only. Save each live kart's pre-step 3D pose.
2. Apply offline/TTL/dead state, grounded grip, Nitro/drift/EMP/garage tuning; update vehicle controllers; advance the world once.
3. Read resulting body and wheel state. Advance combat with the pre/post poses for this one step, resolve earliest hit/solid/expiry ordering, support-aware pickups and respawn safety. Advance timers once and consume each Use edge once.
4. Apply awards through the existing economy/KO functions. If the score target ends the round, stop subsequent steps. Publish a plain snapshot at the existing cadence; terminal results remain non-discardable.

Do not keep the old planar contact correction alongside Rapier. Do not call the existing whole-tick battle sweep unchanged after a six-step curved 3D trajectory: its chord is not that trajectory. Extract/adapt the battle step boundary and ensure clocks, fire edges, shield/cooldown/respawn and coin synchronization are not advanced twice.

Use an accumulator with fixed `dt = 1/60`, an explicit maximum catch-up budget, and integer `simTick`. Initially retain the existing maximum 0.25 s integration budget (15 fixed steps). Match deadlines remain wall-clock based; physical and combat integration use actual executed fixed steps. A long stall discards excess backlog under a defined rebase policy, rather than granting a giant teleport or burst of awards. Rebase timestamps consistently and test fuse/expiry/result behavior under the stall.

Maintain receipt-time ordering during batched integration: a packet received near the end of a 100 ms interval must not retroactively control its earlier steps. Add a bounded sequence to movement intents and a server `appliedInputSeq` acknowledgement. Reject duplicate/older sequences within each instance; never accept a client pose, velocity, hit, timestamp or score. Preserve the existing one-bit bounded Use latch, 500 ms held-intent keepalive, 1500 ms stale-input neutralization, spectator gates and phase/life gates. New-profile inputs should require current instance/window metadata rather than relying on the room's legacy missing-token allowance.

The sequence/history buffer needs an explicit cap and coalescing policy: held movement can coalesce, but a valid single Use edge cannot disappear behind a newer neutral packet or multiply into several shots. Flooding cannot allocate an unbounded timeline. At an epoch or map/profile change, clear queued old intents.

If the 100 ms scheduler produces unacceptable input/shot response or stalls other rooms, move only realtime physics scheduling to fixed 60 Hz while retaining 10 Hz broadcasts. Root owns that shared change. Do not raise all room/UI tick rates as a substitute for profiling. Eight drivers imply roughly 32 suspension rays per step, or 1,920 rays/s per room before other queries; that is an estimate, not a performance measurement.

Rapier's `World.timestep` is intended to remain stable; world stepping, vehicle creation/removal and world cleanup have explicit API boundaries. Pin and test the chosen JS/WASM version before implementing against those APIs. [Official JavaScript World API](https://rapier.rs/javascript3d/classes/World.html)

## 3D combat is an enablement blocker

Keep gameplay projectiles as bounded logical entities and use collision queries; four weapon families do not require dozens of additional physical bodies. A relative 3D segment-versus-moving combat sphere is the smallest successor to the current planar hull test. Document its radius/center separately from the chassis collider and review that fit against the visible kart. If the chosen hit hull is an oriented box instead, test rotation and sweeps explicitly rather than silently approximating it.

| Item/system | Required height-aware behavior; preserve existing balance/ownership |
| --- | --- |
| Pulse, Scatter, Rail | Muzzle from full kart pose; 3D direction and finite projectile extent; compare earliest static-solid impact, relative moving-hull impact and expiry. Shields absorb the first hit without a KO. Owner/dead/offline exclusion persists. Scatter stays its existing fan; Rail stays first hit, not invented wall penetration. |
| Rocket | Same ordered 3D flight; impact/splash radius and line of sight in 3D. Existing splash selects at most one vulnerable victim, not grenade-style multi-hit. |
| Mine | Place only on a legal support surface behind the kart; keep item if no placement is legal, including unsupported flight. Mine trigger sweeps include height and arm/expiry windows. A rival below its platform cannot trigger it. Respawn teleport cannot cross-trigger a mine. |
| Shield | Preserve immunity duration and offensive-use cancellation. Visual shell follows full kart pose. It changes hit eligibility, not collision with the platform or other chassis. |
| Grenade | Launch from kart elevation, integrate its existing arc/fuse in fixed steps and sweep a volume against actual ground/ramp/deck/side/underside. Bounce normals follow those surfaces. Blast origin includes height; existing multi-victim radius/LOS behavior is extended to 3D. Current grenade gravity of 30 is a weapon tune, not proof that chassis gravity exists. |
| EMP | Root must choose a documented 3D cone or limited vertical band, based on the actual muzzle. Preserve cover/shield protection, duration refresh and no KO/coin award. An EMP on a bridge must not hit every kart below because of shared `x/z`. |
| Crates, pads, surfaces | Crate sockets and pad/support IDs include height. Collection requires contact/proximity on the correct layer and remains one claim per crate ID. Grip and boost come from supported surfaces, not every overlapping planar rectangle. |
| Events and rendering | Include `y` and necessary support/normal data in fire/pickup/mine/blast/EMP events and projections; retain monotonic event IDs and no replay on reconnect. Put rings/shadows on the correct surface. |

Finite-height cover allows legitimate shots above it and protects against shots through a deck. Keep current deterministic tie policy: an equal-time solid blocks a hull hit, and expired/out-of-world shots do not create a late blast. Fast projectiles and moving karts require relative sweeps even with chassis CCD enabled. Rapier documents that CCD does not guarantee simultaneous continuous motion for two fast bodies; it is not an automatic proof of weapon correctness. [Official JavaScript rigid-body/CCD guide](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/)

## Projection, prediction and presentation

New snapshots need `physicsVersion`, map revision/config identity, `simTick`, actual `simAt`, and finite per-kart position `x/y/z`, quaternion, linear/angular velocities, `spawnSeq`, grounded state and bounded wheel compression/contact/rotation data. Legacy `angle/speed` may be derived for HUD/fallback compatibility, but are not a second motion authority. No Rapier handles, world instances, input queues, RNG seed or WASM objects enter JSON. Existing private garage fields retain their projection rules.

For local prediction, use the same static colliders, vehicle configuration and fixed-step controls. Restore the authoritative body/controller state required by the adapter, discard acknowledged inputs and replay a bounded remainder. A local world without all rival bodies cannot reproduce rival contacts exactly: the authority corrects them. Prove state restoration/convergence, including airborne and wheel contact transitions. Do not assume restoring a position/quaternion alone reconstructs solver/controller history.

Rapier's determinism guarantee depends on the same version, numeric initial state and construction/removal order; it also warns that platform-dependent transcendental initialization can break those conditions. A partial local world is not the same simulation as the server world. [Official JavaScript determinism guide](https://rapier.rs/docs/user_guides/javascript/determinism/)

World serialization exists, but sending full world snapshots to every client is not the first network design. Verify separately whether the selected vehicle/controller state is reconstructible for replay; do not infer that an API named snapshot necessarily restores every controller detail. [Official JavaScript serialization guide](https://rapier.rs/docs/user_guides/javascript/serialization/)

Remote history interpolates full position and shortest-path quaternion rotation on simulation timestamps, with bounded velocity lead. Duplicate/older ticks cannot extend history or rewind it. Airborne extrapolation must not fall through a deck on packet loss. Hard-reset on instance, profile/map identity, `spawnSeq`, invalid body state or incompatible support transition; never smoothly blend a kart through a platform. Preserve frozen disconnected/KO poses and terminal-state snapping.

The chase camera follows the kart's height while keeping a stable world-up horizon, not every suspension oscillation. A solid-query camera arm prevents walls/decks occluding the driver. Respawns reset camera history. Spectator overview uses playable bounds and maximum elevation. Wheel pivots show actual suspension/compression; keep decorative lean small enough not to contradict the body. Reduced motion can suppress camera smoothing and cosmetic feedback, but cannot hide physical flight or change authority.

The current 2D fallback is an explicit release gate. It must depict platform/layer occupancy, supported pickups and elevated weapons sufficiently to play the same authoritative match. It cannot run the old flat simulation while a WebGL client runs 3D. If that cannot be made readable, root must define an honest compatibility policy before enabling elevated maps; quietly showing a flat arena is unacceptable.

## Runtime lifecycle and failure handling

Rapier JS/WASM initialization is asynchronous, including the compatibility build. Initialize once at process/bootstrap level and expose readiness before any new-profile match starts; preserve synchronous `def.create`. Browser prediction loading needs the same readiness plus an instance token so a disposed/remounted client cannot attach an old async world. Exact Node, browser module, WASM delivery and packed-SDK paths are currently untested. [Official JavaScript getting-started guide](https://rapier.rs/docs/user_guides/javascript/getting_started_js/)

One private world belongs to one instance. The existing room disposal hook is sufficient: remove controller resources and free the world idempotently; dispose client prediction with `disposeAll`. Rematch creates a fresh world, fresh input acknowledgements and fresh event epochs. No global mutable physics world crosses rooms. Partial create failure frees already-created resources before propagating the error.

Preserve current disconnect behavior deliberately: an offline live kart is motionless and remains solid to connected drivers; its intent, pending Use and active Nitro clear, with gameplay timers frozen as today. Implement this in all axes, including gravity, using an explicit frozen-body mode. Reconnection returns a neutral live body at the same accepted pose and needs fresh input. A KO kart is non-solid and cannot keep firing. Reset all body velocities, forces, controller/wheel history and prediction epoch on legal respawn.

Out-of-bounds falls, overturned/stuck recovery and environmental deaths need root decisions. Recommended initial behavior is a server-triggered safe respawn with no invented attacker credit; it must not permit coin farming or bypass shield/Use gates. This is separate from body contacts, which currently cause no damage or score. Never add collision damage implicitly by choosing a physics engine.

A non-finite pose or simulation exception must fail closed and clean up or terminate the affected match through a reviewed recovery path. Room currently logs a tick exception and retries the next tick; repeating a half-mutated world is not an adequate physics recovery policy.

## Migration and release gates

### Exact first implementation slice

Create the shared numeric configuration, a small `kart-physics.js` adapter, and a dedicated finite physics test plus isolated visible harness. Root first pins/loads Rapier and proves its Node/browser initialization. The adapter's initial API is limited to create/dispose, add static box/wedge, add/reset kart, apply intent, fixed step and read serializable pose/wheel contacts. It contains no room transport, combat, scoring or economy code.

Use one flat floor, one ascending/descending wedge pair, a finite-thickness raised deck with a driveable underpass and two identical kart chassis. The finite test must prove real rise, unsupported descent under gravity, landing, suspension contact, deck/underpass separation, chassis-wall/kart contact, finite state and idempotent disposal. The visible harness must use actual controls and those same adapter descriptors; it is a physics prototype, not a released Pocket Karts match. Measure step cost and verify all axis/sign/model-origin assumptions here.

In this slice, leave production `createKartGame`, `onTick`, battle rules, default settings and existing snapshots untouched. That prevents partial 3D motion from entering planar combat. After this proof, wire an internal-only versioned engine profile and 3D client path for integration tests. Keep it unavailable in public map/settings selection until the complete combat and lifecycle gates below pass. Do not ship the harness's ramps as production art or announce an elevated arena from this first slice.

### Subsequent gates

1. **Contract gate:** root confirms units/vehicle handling target, hit-hull geometry, airborne mine policy, EMP vertical shape, fall/recovery rules and fallback support. Pin Rapier and prove Node/browser bootstrap/dispose plus SDK packing without altering unrelated games.
2. **Physics-only gate:** behind an internal profile, run the dynamic chassis on a simple flat floor, ramp, deck and underpass. Record real height/contact data, ascent, takeoff, gravity, landing, wheel compression, wall/corner/kart contacts and stable steering/reverse. Keep legacy/default gameplay selectable; no release claim yet.
3. **Authority/network gate:** implement fixed-step receipt ordering, sequences/acknowledgements, full-pose projection/prediction and lifecycle. Test two worlds/rooms independently, disposal during loading, stale/duplicate inputs and snapshots, disconnect in flight, reconnect, KO/respawn and rematch. Prove bounded recovery under dropped packets and long stalls.
4. **Combat gate:** every item and pickup passes correct-layer/finite-height tests. Complete real start → collect → use → KO → respawn → time/goal result → rematch flows with score/coins awarded once. Enable no elevated public arena while any weapon still treats cover as infinite planar walls.
5. **Map/presentation gate:** root reviews Garden's actual driveable route with matching visible ramps/deck/underside, reachable spawns/crates, chase/overview and fallback. Port supported Frost/Neon routes with the same kart/item/crate assets. Keep Ring/Blocks useful flat combat choices. Map art alone cannot pass this gate.
6. **Performance/device gate:** measure fixed-step and query cost, backlog, packet sizes, scheduler delay, input-to-shot response and correction error with eight drivers plus sixteen watchers, multiple concurrent rooms and slow clients. Test desktop, 390 portrait and 568 landscape using native/MCP browser input; record actual camera/landing/weapon footage or screenshots, not only fixture geometry. If 10 Hz pump batching fails response, separate physics scheduling from transport before release.
7. **Default gate:** switch the combat default only after all prior gates. Keep a server-owned rollback profile and schema negotiation; a mid-round profile/map switch is prohibited. Update help/specs to observed behavior. Retire legacy code only after packed SDK consumers and Star Rush have a deliberate migration path.

Existing regression baselines include `kart-framework.js`, `kart-mechanics.js`, `kart-nitro.js`, `kart-garage.js`, `kart-projectiles.js`, `kart-mines-sweep.js`, `kart-mine-motion.js`, `kart-expanded-weapons.js`, `pocket-karts-smooth.js`, `kart-network-render.mjs`, model/art/view and combat-browser checks. Their planar parity assertions belong to the legacy profile; replacing them with broad tolerances is not evidence of equivalence.

Proposed new finite suites: elevation physics/axis and state restoration; map collider/render descriptor equality and spawn reachability; 3D combat crossing/cover/expiry/teleport races; 3D prediction/network clocks and correction; multi-room lifecycle/WASM cleanup. Include positive proofs of nonzero authoritative `y`, unsupported gravity-driven flight and supported landing, plus negative proofs that separate bridge layers cannot collect/hit/trigger one another accidentally. Native playtests must cover those same facts and actual complete combat, not only a flat match after adding scenery.

## Historical blockers and limits of the original audit

- No Rapier dependency, initialized world or 3D kart profile exists in the audited source. No performance/compatibility result is claimed here.
- Every planar weapon/pickup/support check must migrate before elevated combat is enabled. Grenade `y` alone does not remove this blocker.
- Current map data, local prediction, public poses, camera, wheel animation and 2D fallback cannot encode an elevated match truthfully without coordinated changes.
- The synchronous create contract requires readiness before start, not an asynchronous state object. Existing disposal hooks help but do not automatically free new resources.
- 10 Hz transport may remain sufficient; 100 ms physics batching and receipt-time action latency are unmeasured and may require a separate scheduler.
- Real body physics changes handling. Exact legacy flat trajectories, perfect local/server replay with omitted rival contacts and identical gameplay on every fallback are not established facts.
- This audit read source, existing tests/specs and official Rapier JavaScript documentation only. It did not change runtime/package/art files, install dependencies, run a new physics prototype or use Chrome.
