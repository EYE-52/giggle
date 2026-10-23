# Pocket Karts — combat worlds and shared assets

Status: root-approved combat art directions and bounded candidate renderer iteration; final asset parity remains open. The opt-in elevated game is implemented locally but not deployed. Generated images are visual targets, not playable screenshots or runtime backgrounds.

## Game identity

Pocket Karts is an original casual multiplayer **kart combat arena**. Players drive freely, find weapons, aim or set traps, use cover and Nitro, score knockouts, respawn safely and return to the fight. The default match is timed combat; Garage Battle adds the existing room-scoped upgrade loop. Star Rush is an optional collection mode, not a lap race.

No laps, starting grid, finishing order or compulsory clockwise route. A timer and optional compact knockout standings are useful. Racing positions, finish banners and track-shaped presentation must not define the game. Keep the existing two-to-eight-driver and watcher contracts.

## Shared asset contract

- One authored kart/chassis library, with paint variants. Keep wheel scale, helmet silhouette, exhaust, muzzle pivots and physical dimensions stable across maps. The orange enamel/striped-helmet concept is the next visual target; the shipped GLB still requires comparison against it.
- One authored combat library: pointed metallic bullets, finned rockets, launchers, scatter gun, rail, toothed mine with status lamp, handled grenade, EMP and shield. Map-specific recoloring must never obscure a weapon's identity or imply different damage.
- One recognizable luminous blue framed question-mark pickup model, with shared size, collision/pickup extent and animation. Eligible locations and item choice are server-owned. A full inventory cannot consume or farm another box.
- Lighting changes naturally through the match. Share material roughness and scale; use biome-specific terrain and scenery without reauthoring the vehicles or weapons for each map.
- Reusable meshes, instanced vegetation/cover, bounded particles and measured texture/triangle/draw budgets. Do not put a beautiful concept PNG behind a flat racing surface and call it the new arena.

## Three larger arena directions

Preserve existing stable map IDs. Upgrade `garden`, `frost` and `neon` individually; compact `ring` and `blocks` remain selectable. Concept names below are art-direction names, not a save-data migration.

| Runtime ID / target | Combat layout | Elevation and counterplay |
| --- | --- | --- |
| `garden` / Alpine Courtyard | A broad fountain plaza, stone/timber cover islands, branching approaches and boundary pines/mountains. Random legal pickups near cover and contested approaches rather than rows of boxes. | A raised courtyard with at least two smooth kart ramps, an exposed upper route and a traversable underpass. High ground trades cover for visibility; every occupied position has an escape route. |
| `frost` / Frost Quarry | Slate quarry shelves, a recognizable timber crane, covered rock route, high-grip packed ground and explicit slippery surfaces. A central contested basin connects outer routes. | Smooth shelf ramps, an upper bridge over a lower escape route, and a short jump with generous landing plus a safe bypass. Ice must affect the real contact model, not just the floor color. The concept's blue basin needs an explicit authored solid/ice-versus-water classification; do not infer a collider from the picture. |
| `neon` / Neon Harbor | A sunset harbor with rounded warehouse cover and spaced cargo clusters. Long aiming lanes alternate with protected escape pockets; cranes and ships remain perimeter landmarks. | Wide loading decks, paired ramps, exposed upper firing spots and a usable lower route. Keep collision and camera clearance under every deck, and define safe barriers at water boundaries. |

The rendered image cannot be an exact map blueprint. Build the actual topology from the encounter goals and a shared authored collider descriptor. Aim for a useful choice every few seconds and test encounter frequency with two drivers as well as eight. A huge empty area is not sufficient. Place pickups/spawns by validated region sockets with finite-height clearance, reachability and threat checks.

## Physical elevation acceptance

The deployed classic karts have x/z/yaw and a scalar/slip model. The candidate three elevated maps now use an actual private Rapier chassis/four-wheel World per match; they are a separate opt-in profile with timed Zap Battle and Garage off.

Use a shared authoritative 3D collision world, fixed-step gravity and chassis/wheel contact, with local prediction following the same model. Physics stepping and network snapshot frequency are separate budgets. The candidate Rapier plan is in `../KART_ELEVATION_PHYSICS_20261007.md`; do not let each client independently decide impacts or scores.

The isolated development slice now uses Rapier 0.21.0, real chassis/four-wheel suspension and these three arena collider layouts. Adapter v2 passes 60 adapter checks and 341 map checks, including seven driven ramp routes, separate upper/lower bridge occupancy and the Quarry kicker's unsupported jump followed by an ice landing. The same descriptors create the diagnostic visible geometry. The separate internal combat authority also passes 159 complete 3D item/lifecycle checks. Room integration passes 257 checks plus 211 actual-server WebSocket checks; the renderer passes 349 geometry/resource and 358 native isolated-viewport checks. Root reviewed native main-app driving, deadline/results and rematch. The three runtime worlds use the same physical descriptors and original models; generated concepts remain targets. This bounded iteration is below aspiration art parity and is not deployed. Physical-phone and WAN/prediction acceptance remains open.

Before any elevated map is offered as playable, prove:

1. Smooth ascending/descending ramps, stable idle contact, airborne motion and landing, Nitro/drift/grip, full input release and keyboard/touch parity.
2. Upper and lower karts do not collide or collect each other's pickups through a bridge; weapons hit the first real 3D collider, respect cover and cannot score through floors.
3. Mines attach to the surface actually occupied by their owner. Rocket/grenade/EMP/shield behavior, muzzle direction, damage and exact-once KO remain server-owned.
4. Respawn selects a legal supported surface with clearance and protection, clears old-life held actions and resets prediction/camera rather than easing through scenery.
5. Height/orientation/velocities survive reconnect and packet delay; the camera follows real elevation and avoids walls/undersides. A degraded view must represent the same topology honestly.
6. Two/eight-driver complete matches, rematch and map switch preserve game state, release physics/GPU/audio resources and remain within measured server/render/mobile budgets.

## Image generation and review

Built-in imagegen used the original Pocket Karts target as the shared style/asset reference. The selected Alpine image was regenerated to remove pedestrian stairs. Frost and Harbor use that selected Alpine image as their exact asset reference. Every output preserves the kart, helmet, rocket and blue pickup identity; none has race HUD or lap rules.

Source images and prompt/provenance records live in `assets-source/art-direction/kart-combat-maps/`. Optimized previews and a review page live in `art-review/`. The main game gallery uses the revised combat scene. Retain separate concept approval, implementation status and playable QA; do not claim real physics from a concept image.
