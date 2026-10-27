# Pocket Karts — game specification

An original Smash Karts-style browser arena with responsive toy-kart driving and quick multiplayer competition. Retain its independent name and assets. The platform owns rooms, identity/reconnect, hosting, Night totals and optional Giggle Meet communication; the reusable kart engine owns simulation/modes. A game can replace the shared scene/HUD without rewriting room transport.

## Current direction — 7 October 2026

Pocket Karts is a **multiplayer combat arena**. Preserve the kart, weapon and pickup identity from the visual targets while replacing the racing-course composition with connected combat spaces, useful cover, varied approaches, safe respawns and randomized reachable weapon pickups. There are no laps, finishing order or required one-way route. Star Rush remains an optional collection mode in the same arenas.

The combat/elevation direction in `art-direction/POCKET_KARTS_COMBAT_MAPS_20261007.md` supersedes the historical flat-only restriction below. The candidate now adds an opt-in `elevated-combat-v1` profile with real authoritative Rapier suspension, ramps, underpasses, gravity and landing. The deployed 0.1.8 baseline and five classic maps remain planar; the new profile is not deployed. The implementation and remaining release gates are detailed in `KART_ELEVATION_PHYSICS_20261007.md`. Art approval cannot establish mechanics or visual parity.

## Elevated candidate contract — 7 October 2026

Select Alpine Courtyard, Frost Quarry or Neon Harbor in Maps & settings. These are 120×120 combat arenas with shared original karts, weapon models and question-mark crates. Courtyard has a raised stone deck and underpass; Quarry adds icy traction and a physical kicker jump with a safe bypass; Harbor has loading decks, cargo cover and sunset water outside its protected boundary.

The new profile supports **timed Zap Battle, Garage off**, 30–180 seconds, 2–8 drivers and watchers. Other combinations fail before replacing a running instance. Keep the five classic maps and their modes/defaults. The historical sections below document earlier releases and do not override this profile contract.

- WASD/arrows or analog stick; Space/item button fires; N/Nitro recharges; Shift/brake slows. The new profile has no drift mini-turbo, Star Rush or garage upgrades yet.
- Private 1/60-second Rapier World per match; four suspension wheels and authoritative full 3D poses. Root's 60 adapter + 341 map checks prove seven driven ramp routes, layer separation, physical flight and supported landing.
- Eight server-owned items, surface-aware mines, swept 3D cover/projectile hits, protected respawn, validated random sockets and bounded overturned-kart recovery. The authority passes 159 checks.
- Per-instance 50ms elevated / 100ms classic cadence on a 25ms room pump. New input packets require instance/phase, monotonic sequence, life and connection epoch; driver ACK/wallet stays private. 257 Room and 211 real-server WebSocket checks cover privacy, disconnect/reconnect, a complete 30-second deadline, exact-once result, rematch and initialization failure.
- Client interpolates full poses/quaternions/wheel states and moving weapon models; it does **not** yet predict/replay local 3D physics. Do not claim WAN responsiveness from localhost cadence. Chase camera queries the same solid meshes and resets at life changes. A failed 3D renderer offers explicit Retry/Back to room; it never substitutes a misleading flat simulation.
- Root owns the compact combat HUD and capability-based controls; low-resolution laptops retain keyboard access. The DOM/lifecycle suite found and fixed a double-Retry renderer leak. Results wait for the final effects before the platform celebrates.

The accepted environment pass is a bounded playable iteration, below the generated art targets. Generated PNGs remain concept references, not runtime backgrounds. Physical-phone, WAN latency/prediction, encounter balance and final art acceptance remain release work; candidate 0.1.9 stays on hold until reviewed.

## Modes and complete loop

**2–8 active drivers**, with additional friends watching (room cap 24).

| Mode | Player actions | Winning condition |
| --- | --- | --- |
| Star Rush | Drive, collect stars, boost | First to the star goal; otherwise most stars at the deadline |
| Zap Battle | Drive, collect crates, fire zaps, tag rivals | First to the hit goal; otherwise most hits at the deadline |

Create/customize → invite/join → host start → 3-second countdown → drive → explain goal or timeout → ranked results → host rematch/change game. An early score-goal finish must be visibly different from a timer finish. Ties share the win; a zero-score timeout does not invent a winner.

## Customization

| Setting | Options/range | Default |
| --- | --- | --- |
| Round duration | 30–180 seconds | 90 |
| Stars to win | 8–30 | 15 |
| Hits to win | 1–20 | 5 |
| Mode | Star Rush, Zap Battle | Star Rush |
| Arena | Rookie Ring, Bumper Blocks | Rookie Ring |
| Palette | Daybreak, Sunset, Starlight | Daybreak |

Settings persist for rematches and apply to the next match. Both modes, both maps and all palettes must remain usable. Stable seats: at most eight drive, late joins watch; reconnect resumes the same seat.

## Inputs and fairness

- WASD/arrows and mobile touch provide steer/throttle/brake/action. Space triggers boost in Star Rush and zap in Battle.
- Right turns screen-right under the chase camera. Kart nose, server physics, prediction and 2D fallback must agree. Reverse steering behaves like a car.
- Input changes send promptly; held-input keepalive is bounded. Release, blur, visibility loss, pointer cancellation, disconnect and stale-input TTL clear input. Typing in room/call controls must never drive.
- Spectators cannot steer/fire. Clients send finite validated intents only, never coordinates, scores or client timestamps. Countdown/done cannot produce movement effects.
- Obstacle/world collision must handle demonstrated hitch/tunneling cases consistently on server and prediction.
- Battle starts with one zap, caps ammo at three and uses rising-edge firing. Crates replenish ammo. A hit stops the victim and grants a brief shield against repeated hits.
- Projectiles stop at their first wall/hull/expiry; no scoring through cover, self-hits or repeated shielded hits.
- Resolve exact-goal/deadline ties deterministically. Results and cumulative awards apply once.

## Smoothness and lifecycle

Keep the current 10Hz authoritative simulation unless measurement justifies changing it. Render local prediction each frame; ease remote poses with bounded extrapolation and reconcile without permanent drift. Teleports snap. During delayed/dropped snapshots, controls remain responsive while stale remotes freeze.

Use calibrated server time for countdown/deadlines. New matches reset inputs, prediction, maps and results. Dispose timers, frames, listeners and GPU assets; cap DPR and effect pools. WebGL failure/context loss offers retry or a functional 2D view on the same snapshots. No extra dependency or unnecessary physics stack is needed.

## Scene and HUD

The game owns an immersive viewport, rather than inheriting the platform card. Chase view is primary. Distinct readable karts/stars/crates/zaps, contrasting track/apron/barriers, original low-poly landmarks and readable lighting. Daybreak, Sunset and Starlight must visibly differ.

- Compact timer, goal, personal score and ammo/boost feedback.
- Collapsible standings with leader/your rank, long-name handling and a readable expanded list. Toggling it sends no gameplay action.
- Minimum 44px touch targets with sensible separation and safe-area padding; no page scroll while steering.
- Protect the playfield at 1280×720, 360×780 and landscape. Room/call controls stay available.
- Finished screens hide driving HUD/pads, stop the clock, explain what won and keep host Rematch/Change game visible. Guests see the responsible host.
- Restrain motion and respect reduced-motion preferences. Verify active play in both modes, rather than only an idle scene.

## Acceptance gates

Muse inspects and implements against this spec, then iterates on root's rendered QA findings. Root independently checks controls, visuals and complete multiplayer flows.

- Automated: kart/framework/prediction/race/clock checks, input release/TTL, obstacle and projectile collision, deterministic goal/tie/timeout, exact-once awards and lifecycle cleanup.
- Real WebSockets: two and eight drivers plus watchers; malformed/stale inputs, goal/timeout, reconnect, rematch and release. Record actual delivery behavior without claiming zero network lag.
- Browser: game page → customization → countdown → keyboard/touch drive/action → observed server pickup/hit → results → rematch → change game.
- Also portrait/landscape, all palettes, both modes/maps, fallback, room/call focus, screenshots and console-error sweep. Add regressions for discovered defects and rerun affected gates.
- Full checks and clean install/build before matching frontend/backend deployment; repeat hosted smoke/browser entry.

Release requires no unresolved reproducible defect in these gates. Passing checks cannot establish absence of every possible bug.

## Release evidence — 6 October 2026

Muse Spark 1.3 Contributor MAX worked from this specification and iterated against root QA. Root independently completed rendered multiplayer checks, added regressions for discovered defects, and passed a clean install, the full repository test suite and build. Matching frontend/backend versions are live at https://play.gigglemeet.com/. Hosted smoke covers all 37 games; deeper two-player checks cover Castle and both kart modes, including stopped clocks and clean rematches. Detailed outcomes, screenshots, scope and logs are retained in `releases/2026-10-06-game-quality/QA.md` and its `evidence/` folder. Passing checks is evidence within this scope, not an absolute zero-bug guarantee.

## Artwork rebuild acceptance — 6 October 2026

The earlier functional release was rejected visually. A working prototype and
passing multiplayer checks are not visual acceptance. Inspect Smash Karts'
actual private gameplay for kart silhouette, scene depth, lighting, camera and
HUD readability; build original artwork and keep Pocket Karts' own identity.

- Original Blender kart with chunky treaded wheels, wheel/steering pivots,
  rounded body, seat, driver, racing stripe and twin exhaust. Nose stays +Z.
- Authored star and zap crate silhouettes; distinct cosmetic boost/shield.
- Local licensed environment GLBs, source credits and embedded textures.
- Cool asphalt and emerald park landscaping with layered low-poly ridges,
  trees, track-side stands/garage, sky atmosphere and playful landmarks.
  Sunset changes light/sky while the terrain stays readable.
- Every solid inside the arena matches server collision. Decorative mountains
  and planting remain outside its walls; there are no fake gameplay ramps.
- Quiet HUD protects the chase view; compact clock/goal, personal status and
  collapsed standings. Clear mobile steering/action controls and result flow.
- Load all shipped assets with the real GLTF loader. Check byte/triangle
  budgets, independent paint, wheel animation, authoritative yaw and cleanup.
- Review actual game motion and 1280×720 / 360×780 / 844×390 screenshots.
  Iterate Muse against rendered findings before release. Preserve tested
  network simulation and verify the complete hosted flow after deployment.

## Artwork release evidence — 6 October 2026

The original vehicle and licensed landscape rebuild is now live. Two actual Muse Spark 1.3 Contributor MAX sessions iterated against rendered QA. Root verified the real assets, optimized/batched the kart, completed lighting/camera/HUD refinements, passed the clean full suite/build, and checked the complete published four-client touch-hit → timed results → rematch → change-game flow. All 26 deployed art/runtime files matched reviewed hashes. Local checks additionally covered eight drivers, all palettes, both modes/maps and fallback. Detailed evidence and tested limits are retained in `releases/2026-10-06-kart-art/QA.md`. Railway was unchanged for this frontend-only release.

## Maps and handling upgrade — 6 October 2026

Add Garden Circuit, Frosty Pass and Neon Yard alongside the two existing arenas. Maps carry authoritative collider, boost-pad and grip-zone rectangles. Each has a distinct visual environment and navigable routes, clear starting seats for 2–8 and reachable pickups. Hold Shift/the touch drift control through a forward turn to charge a mini-turbo, then release; boost strips give brief automatic turbo with bounded cooldown. Ice patches reduce traction. Improve glancing impacts and deterministic kart contact without turning bumping into a scoring exploit. Keep Space mode-specific, spectators read-only, client prediction consistent with server physics, countdown/done frozen and room/rematch flow intact.

Acceptance: substantive map-layout and mechanics regressions; clean full suite/build; actual multiplayer laps/turns/drift/pad/ice/contact and scoring/results/rematch; desktop/portrait/landscape/fallback screenshots on new maps; render and network measurements with scope stated. Muse implements in parallel; root reviews and iterates.

## Battle-loop revision — 6 October 2026

The product goal is a complete casual combat game: exploring meaningful
routes, choosing a useful item opportunity, aiming or trapping, recovering
from a knockout and finishing/rematching clearly. A larger scene and more
boxes alone do not satisfy this goal. Detailed research and proposed
balance values are in `POCKET_KARTS_BATTLE_RESEARCH_20261006.md`.

The first battle revision uses 2–8 drivers, three larger 120×120 arenas,
one item slot and four distinct items. Garden offers branching cover
routes, Frost offers low-grip shortcuts, Neon offers asymmetric cargo
cover. Compact Rookie Ring and Bumper Blocks remain available. Pickups
scatter among validated reachable sockets and relocate after an exact-once
claim; slot-full players cannot replace or farm items while stationary.

Default battle: 180-second timed free-for-all, most KOs wins, ties shared.
A score target is optional. An unprotected weapon hit knocks a driver out
for two seconds, clears held fire/motion/item state, then selects a safe
legal spawn with 2.5 seconds of protection. Offensive fire ends protection.
Disconnected drivers freeze; respawn does not advance or collect items
for them. Mine arming, projectile sweeps, wall occlusion, expiry and entity
caps are part of the gameplay contract, not cosmetic renderer effects.

Each viewer receives the same sky-cycle start and duration. Daybreak
transitions through sunset into readable starlight across the round;
Sunset starts the evening portion; Starlight retains a night scene.
Fixed light is available. This is match-paced lighting, not a simulation
of the player's physical timezone or the actual 24-hour solar day.

Acceptance includes real intent-only driving and pickups, offensive and
defensive item activation, KO/respawn/protection, contested pickup claims,
map clearance and variable-bound prediction, result/rematch, mobile targets,
late-viewer sunset consistency and two-player encounter density. Physical
3D ramps/suspension are outside this flat arcade revision. New game ideas
remain research proposals until they receive their own complete loop and
playthrough evidence.

## Current 0.1.5 battle acceptance

Zap Battle is the default. Star Rush remains available. Garage Battle is a separate selectable mode, using the same combat and applying owned upgrades. Both battle modes deal Pulse, Scatter, Mine, Shield, Rocket and Rail. Projectile speeds are 75/65/65/110 world units per second for Pulse/Scatter/Rocket/Rail, with swept authoritative collisions. Rocket splash respects cover and pays one knockout per victim; Rail stops at the first hit.

A real pickup pays one room coin, knockout ten, finish five, and winner bonus fifteen. Purchases occur only on results, cost 20/35/55 per level, and cap at level 3. Engine improves acceleration/top speed by 5% per level, Handling turns by 4%, Quick Reload lowers cooldown by 6%. Purchases validate the driver's connection, category, balance, stage and unique nonce on the server. Private balance and acknowledgement stay private. Upgrades persist in this room and apply in Garage Battle; stock Zap Battle keeps the owned levels without applying them.

Distinct authored GLB weapon rigs, finned projectiles and mine/shield props replace generic projectile spheres. The audio module covers engine, drift, reverse and authoritative combat cues, respects sound settings and tab visibility, and releases all audio resources on disposal. Remote karts use a bounded timestamp buffer; local prediction matches all four upgrade levels and visual corrections decay rather than snapping every packet.

Acceptance includes actual live purchases/rematches, 24 socket clients with 8 drivers/16 watchers across three maps, every weapon's swept-collision paths, private result acknowledgements, duplicate/stale action rejection and real browser audio signal checks. Browser/device and human-balance coverage is documented separately from engine assertions.
