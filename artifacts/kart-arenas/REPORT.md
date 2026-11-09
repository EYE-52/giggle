# Pocket Karts arenas — partial implementation

10 November 2026. Local work only. Nothing pushed or deployed.

**The seven-arena request is unfinished.** Shared support and the first Rookie Ribbons playable slice are implemented. Rookie has useful driving, camera and render evidence, but has not passed every launch gate. The other six maps have not been built. The old menu entries remain until the replacement lineup is ready; their IDs still load their original worlds.

## Map status, in the required build order

| Arena | Implementation | Evidence / next work |
| --- | --- | --- |
| Rookie Ribbons | Playable duel/full slice; 2 floors | Screenshots and measurements below. Combat supply, balance and full acceptance remain. |
| Skyport Split | Not built | All variants, three floors, helix/switchback, roof gap/catch, features, 64 candidates, 72 homes and all gates remain. |
| Garden Crown | Not built | Clover geometry, crown/fountain, both climbs, variants, starts/homes, art and all gates remain. |
| Frostbite Crescent | Not built | Crescent shoreline, ice/shelf, jump/bypass, variants, starts/homes, art and all gates remain. |
| Neon Switchyard | Not built | Hexagon, sign bridges, market cover, variants, starts/homes, art and all gates remain. |
| Harbor Fork | Not built | Trident, cargo loop/lookout, water edges, climbs, variants, starts/homes, art and all gates remain. |
| Foundry Wheel | Not built | Octagonal rings, guarded furnace, tunnels, belts, climbs, variants, starts/homes, art and all gates remain. |

## Shared support implemented

- Versioned arena/variant contract. Authority chooses a variant before the match. Snapshots carry its identity; art and prediction load that same variant. Separate pools allow up to 64 respawn candidates and 32 initial starts.
- The exact `min(S, 48, max(12, ceil(A/320), ceil(1.25*P)+8))` box rule. Stable, seeded homes with floor/district selection and at least four per floor. New arenas use 3/4/6-second simulation timers. Old map IDs retain their old economy.
- A parked kart must leave the 3m home radius before collecting again. Loaded karts cannot consume boxes. Reconnect preserves the rule and the same home/entity IDs.
- Ten-weapon ordinary/risk odds, normal odds for the opening eight seconds, and server-owned 12-second rare limits. The plan now names the ten current weapons and 100 HP.
- A bounded 48-box batch, star-marked risk homes, quiet home outlines and a final return cue. No per-box bodies, materials or shadows.
- Real Rapier support/hull route sampling, a layer-aware clearance graph, an area audit, continuous authority-input route replays and camera checks.
- New arenas have explicit room capacities. A 32-person room cannot silently start Rookie and turn 24 drivers into watchers. Legacy saved fixtures keep their old behavior.
- Toy art reuses the raised solid skin, level/drop/ramp markings, painted grove backdrop, full kart models and shared lights. New arena IDs are separate from art IDs.

Not finished in shared support: actual travel-time-based spawn scoring, all directed shortcut/landing checks, every camera stress replay, transport profiling for new 32-player arenas, and the synthetic three-floor variant/prediction/gate acceptance matrix. Current tests cover policy, two/three-floor authority setup, reconnects and the existing prediction suites; these are narrower than the full Phase 1 exit gate.

## Rookie Ribbons

| Measure | Old Rookie Ring | New duel | New full |
| --- | --- | --- | --- |
| Useful floors | 1 | 2: ground / +6m | 2: ground / +6m |
| Created boxes at supported reference seats | 6 at 2; 10 at 8 | 12 at 2 | 13 at 4; 18 at 8 |
| Legal homes | 31 ground sockets | 16: 12 ground / 4 arch | 20: 16 ground / 4 arch |
| Maximum selected starts / candidates | 8 authored, then generated | 2 / 4 | 8 / 16 |
| Statics | Different classic profile | 23 | 33, below 44 cap |
| Measured usable area | Not audited here | 2,353.5m² | 3,426.5m² |
| Unculled loaded world draws | Not measured here | 18 | 18, below 45 cap |
| Unculled loaded world triangles | Not measured here | 3,640 | 4,248, below 28,000 cap |
| Loaded world textures | Not measured here | 3,884,287 bytes | 3,884,287 bytes, below 12MiB cap |

Area uses a 0.5m raster of the final loaded Rapier supports, removes full hull margins/cover, counts the same-height union once, and includes ramps by horizontal projection. The box formula uses these measured values. This is a finite raster estimate, not an analytic mesh-area claim.

Both variants have two ordinary 1:4 ramps, an actual arch underside, a lower connection, guarded shaped ground and marked drops onto catch ground. Every selected start and candidate clears a 20m hull lane and drives that departure. Selected starts have at least 8m clearance from homes. Every start/home joins the clearance graph; blocking either climb leaves ordinary access to all homes. Old physics/feature IDs are not reassigned.

### Driving and camera evidence

- Clockwise and counterclockwise authority-input circuits complete on both variants. No teleports, pose restores, stuck recovery or route resets during traversal.
- Forty three-minute isolated route runs: 20 seeds per variant, alternating direction and varying target speed from 4–6m/s. A moving bot plus a parked rival; all completed the timed run without a stuck/recovery event. See [replay summary](rookie-stress.json).
- This is **not** the planned eight-driver box-seeking/firing trial. It does not establish combat supply or human balance.
- 10,032 route camera-eye volume samples pass against independent Rapier solids, across 2/4/8-seat variants. Existing camera suites also remain required.
- The real practice page runs duel at 2 drivers and full at 8, with the correct 12/18 boxes. Production chase-camera eye and four near-plane corners were checked against a separate Rapier world during a short actual ground drive. See [practice measurements](practice-metrics.json). This is not every ramp/drop replay.

### Render measurements

Chrome on this Mac, desktop emulation, 4× CPU throttle, 1280×720 and 390×844, day/night. Full has eight detailed drivers; duel has two. Five-second samples after scene warmup. These views use fixed review poses, not active combat.

All eight final review cases measured about **59.9 FPS**, with p95 frame time about **16.7–16.8ms**. See [exact renderer/frame measurements](browser-metrics.json). No physical iPhone or thermal testing was done. A narrow sample at fixed poses does not prove the game's whole performance budget.

The separate existing 32-driver classic browser regression passed with 32 connected, 31 binary frames/s, 68 KB/s reported traffic, 293 draw calls/frame, **11.1 FPS**, a 967ms worst frame and no browser errors. It used the test's default software renderer on this busy Mac. This is a regression result, not a new raised-map benchmark, and is not a launch-quality FPS result. [Numbers](kart-32-browser.json) · [Screenshot](kart-32-browser.png).

### Screenshots reviewed

| Variant / size | Day top | Day chase | Night top | Night chase |
| --- | --- | --- | --- | --- |
| Full / 1280 | [top](rookie-ribbons-full-1280-day-top.png) | [chase](rookie-ribbons-full-1280-day-chase.png) | [top](rookie-ribbons-full-1280-night-top.png) | [chase](rookie-ribbons-full-1280-night-chase.png) |
| Full / 390 | [top](rookie-ribbons-full-390-day-top.png) | [chase](rookie-ribbons-full-390-day-chase.png) | [top](rookie-ribbons-full-390-night-top.png) | [chase](rookie-ribbons-full-390-night-chase.png) |
| Duel / 1280 | [top](rookie-ribbons-duel-1280-day-top.png) | [chase](rookie-ribbons-duel-1280-day-chase.png) | [top](rookie-ribbons-duel-1280-night-top.png) | [chase](rookie-ribbons-duel-1280-night-chase.png) |
| Duel / 390 | [top](rookie-ribbons-duel-390-day-top.png) | [chase](rookie-ribbons-duel-390-day-chase.png) | [top](rookie-ribbons-duel-390-night-top.png) | [chase](rookie-ribbons-duel-390-night-chase.png) |

Production UI: [2-seat day](practice-2-day.png), [2-seat phone](practice-2-phone.png), [8-seat day](practice-8-day.png), [8-seat phone](practice-8-phone.png). The phone UI images use the Night UI theme; the world palette in those practice images remains Daybreak. The review table above contains actual Night world captures.

Local practice videos: `practice-2-drive.webm`, `practice-8-drive.webm`. They include real ground driving, not a complete upper-floor traversal. Review videos also record static top/chase view changes; they are not route-clearance proof. Videos are local artifacts, not committed binaries.

Visual review against the sketches: the shaped lobes, arch, two ramp directions, level colour, pickup symbols and danger/drop stripes are readable in day/night. Lane ticks and floor emblems follow the smaller variant too. The art is still a first playable slice; final visual acceptance and human feedback are outstanding.

### Deviations and remaining Rookie gates

- Full footprint is 76×52m, compared with the 76×48m sketch. The extra lower apron was needed after driving tests found the descent turns too tight. Duel is a separate 60×44m layout. Both keep the two lobes and two climbs.
- Areas exceed the starting 1,800/2,800m² targets. Measured area is used for supply. Encounter time and district occupancy still need testing before accepting these sizes.
- The +6m deck has a 5.2m clear underside, below the plan's initial 6m clearance target. Current camera checks pass; this remains a declared geometry exception pending all replay/device checks.
- The small variant has its own shaped floors and boundary, rather than the proposed visible gates on one shared full layout.
- Some outer escape lanes are narrower than the 8m optional-route target. Opposite traffic, nitro/drift/spun approaches, all cover corners, both drops, weapon shots across levels and every ordinary edge at stress speed still need acceptance.
- The clear graph and seeded home selection do not prove opening pickup times or <=1s parity. Full active firing/box-seeking trials, >=60% available supply, per-floor starvation checks, claim-race coverage, KO/dropout/spectator/map-swap coverage and the 10-match/human balance sessions remain.
- No new 32-driver map, raised transport budget, five-minute combat profile, ten rematches/leak profile or physical-phone acceptance is claimed.

## Test results

The exact final results and baseline reproductions are recorded alongside this report. `npm test` was attempted; it stops at `test/word-rules.js`, “equal tries share first place” (70 vs 100). The same failure was reproduced from an isolated archive of the original starting commit `029537add4a80e9823585345cc7c5faa0e5c3041`, inside this worktree. See [clean-base log](word-rules-clean-base.log).

The rest of the npm chain is run command by command so the first failure does not hide the remaining kart suites. [Full attempted npm log](npm-test.log) · [continued results](full-suite-results.json) · [continued log](continued-test.log).

The four separately listed browser commands are also run: garage, 32-driver, classic weapon gallery and raised weapon gallery. The weapon-gallery tests' hard-coded 8290 URL is changed **in memory only** to the task's 8351 server. Their test behavior and source files are unchanged. Auto-selected test listeners use 8358–8370 through the test-only preload. No loading/vendor/game-host source was changed. The engine runtime was rebuilt with the required script.

Final result: **117/117 unique kart commands listed in package scripts passed**, including the four separately listed browser commands. The expanded full chain contains 278 commands: **277 effective passes and one confirmed baseline Word Rules failure**, after explicit passing reruns of the two fixed kart regressions. The original `npm test` command itself remains failed. See [final ledger](FINAL-VALIDATION.json), [backdrop rerun](kart-backdrop-final.log), [room rerun](kart-complex-rooms-final.log), [garage browser log](kart-garage-browser.log), [classic weapon gallery](classic-weapons-browser.json) and [raised weapon gallery](raised-weapons-browser.json).

The short production practice probes checked 1,745 camera eye/near-plane samples at two seats and 1,740 at eight, with zero overlaps in those drives. Both measured about 59.9 FPS. A parked returned box can still overlap the kart art; that visual case needs review before acceptance.

## Resume next

1. Finish the shared Phase 1 and Rookie acceptance gaps above; do not label this slice launch-ready.
2. Build Skyport Split next. Prove its three-floor variants and 8/16/32-player transport/performance before Garden.
3. Then Garden Crown, Frostbite Crescent, Neon Switchyard, Harbor Fork and Foundry Wheel, with a separate commit after each map's gates pass.
4. Only after all seven pass, retire old Battle menu entries, keep their IDs loadable, and retain the separate classic Star Rush/Garage compatibility menu.

## 10 November continuation — Rookie art and merge

Merged `claude/game-fixes-nov9` (merge `5a0b43e`). Word Rules passes after the merge, and the runtime bundle was rebuilt. Final full-suite results below will supersede the earlier failed run.

Rookie now uses the existing 256px surface atlases for paving/deck joints, metre-scale UVs, merged guard posts and reflectors, sloped solid ramp guards, two bridge piers, under-slab edge beams, tool-chest details, cones and school flags. Rails and piers share their authority/camera envelopes. Automatic obstacle panels are omitted on rotated guards so they cannot create floating faces.

After this change: duel **32** statics, full **42** (cap 44); measured accessible area **2,117 / 3,160.5 m²**, used by the supply formula. Loaded art is **31 world draws**, **11,042 / 12,962 triangles**, **4,561,492 texture bytes**. Before: 18 world draws, 3,640 / 4,248 triangles; no slope guards or piers. The higher counts buy visible finished surfaces and safety details and remain within the 45 / 28,000 / 12MiB budgets.

All sixteen named duel/full screenshots above were refreshed. [Review sheet](rookie-art-review.jpg). Eight 4× CPU cases measured 59.9 FPS, p95 16.7–16.8ms. The real practice page passed again: 1,785 / 1,770 eye and near-plane samples, zero overlaps, 59.9 FPS, 12 / 18 boxes. Practice renderer counts were 52 / 66 draws and 21,496 / 33,377 triangles. These are short drives, not a sustained-combat or physical-phone result.

The solid rails caught the old test driver's cut turns. The driver now detects passed waypoint planes and slows tight turns; it does not reset or teleport. Both complete circuit directions, all departures/routes, 10,032 camera checks and forty three-minute stress replays pass with the guards present. New `kart-launch-art.mjs` checks texture mipmaps/UVs, finite camera envelopes, slope-guard transforms, bridge supports, disposal and map art budgets; it is in `npm test`.

Still outstanding: the full shared and combat acceptance items listed above, including active box-seeking/fire trials and physical-device/human sessions. These results do not close those gates.
