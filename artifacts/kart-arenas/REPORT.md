# Pocket Karts — seven arena build report

10 November 2026. Local branch only. No push or deployment. The game-fixes branch was merged first (`5a0b43e`), and the runtime bundle was rebuilt after engine changes.

**All seven arenas are built and committed in the requested order. Full launch acceptance remains open.** Geometry, ordinary route driving, starts, selected-home supply, camera-volume sweeps and art-budget checks pass. The follow-up eight-bot probes pass the requested five-seed quantitative targets on all seven arenas; the broader original launch gates remain open. Physical-phone and human sessions have not been run.

## Current lineup and measured supply

Current supply counts include the firing-probe follow-up. Numbers follow compact → medium → wide → full where present. A is real support/hull-audited usable area, not square bounds. B is the cycling home count at each variant's maximum seats. [Exact final data](final-arenas.json).

| Arena / commit | Seats | A (m²) | Authored homes S | Cycling boxes B | Max statics incl. frames / cap |
| --- | --- | --- | --- | --- | --- |
| Rookie Ribbons `72e6eb8` | 2–8 | 2,117 / 3,160.5 | 16 / 20 | 14 / 20 | 42 / 44 |
| Skyport Split `d0cf4e0` | 8–32 | 7,795 / 9,212.5 / 12,704.25 / 18,189.25 | 40 / 48 / 64 / 72 | 40 / 48 / 48 / 48 | 63 / 92 |
| Garden Crown `c8ca1db` | 4–16 | 5,253 / 8,269 | 28 / 40 | 28 / 40 | 25 / 60 |
| Frostbite Crescent `0ec3d7c` | 6–16 | 6,736.5 / 7,224.5 | 32 / 44 | 32 / 44 | 25 / 62 |
| Neon Switchyard `3dccb8f` | 6–24 | 5,404 / 7,714 / 9,698.5 | 32 / 48 / 48 | 32 / 48 / 48 | 21 / 60 |
| Harbor Fork `96538e6` | 8–32 | 9,203.75 / 9,203.75 / 12,339.25 / 17,027 | 40 / 48 / 64 / 64 | 40 / 48 / 48 / 48 | 34 / 84 |
| Foundry Wheel `6a450b6` | 8–32 | 10,588.5 / 12,294.75 / 13,659.25 / 15,433.25 | 44 / 56 / 64 / 64 | 44 / 48 / 48 / 48 | 53 / 96 |

The Battle picker offers these seven arenas, with finished world previews, floor counts and seat ranges. Star Rush and Garage retain their five compatible classic courses. Old labels remain accepted for saved fixtures; retired raised maps are absent from the picker. New rooms default to Rookie Ribbons. [Picker checks](picker-metrics.json) · [Phone Day](picker-390-day.png) · [Phone Night cards](picker-390-night-cards.png) · [Desktop Night](picker-1280-night.png).

## Shared support and passed core checks

- Versioned layouts select before countdown; authority, prediction, art and reconnect share the same variant identity. Up to 64 respawn candidates and 32 initial starts are separate bounded lists.
- Exact `B = min(S,48,max(12,ceil(A/160),ceil(1.25*P)+8))`, fixed seeded homes, at least four cycling homes per floor, route/district coverage, and 2/3/4s safe/exposed/risk returns (changed from 3/4/6s after the active firing probes). Loaded karts cannot consume a box; parked karts must leave 3m before collecting again. Reconnect retains home IDs and the parked rule.
- The ten current weapons and 100 HP are preserved. Common/uncommon/rare odds are 52/43/5, risk 40/50/10 after eight seconds, with the 1/2/3 rare awards per 12s limits. Risk tags cannot remove a start's second reachable ordinary home.
- Every selected start has two selected ordinary homes within 32m of real road distance, over twenty supply seeds per reference count. Candidate hulls and 20m departures include shortcut frames. All selected drivers physically depart together.
- Every ordinary directed route drives both ways through the real authority with normal inputs. All variants remain connected with one climb blocked. Rookie also has forty isolated three-minute route stress runs. These are not active eight-bot matches.
- Flat convex polygon slabs have exact finite physics, visible geometry, camera proxies, normals and tiled UVs. Grouped guards retain their individual exact art/query envelopes. No arbitrary terrain path or dynamic map bodies were added.
- Finished skins reuse the existing 256px surface atlases, painted backdrops, full models and shared lights. Roads/decks have metre-scale texture, route marks, edge rails, hazard trims and supports. Static art merges by material. Each map is under its draw, triangle and 12MiB texture cap in the unculled census.
- Launch arenas use the raised binary pose stream at 20Hz. Legacy raised fixtures keep their JSON contract. Offline road atlases score respawns without a live raster/search in a tick.
- The stronger feature-frame spawn audit also exposed five old fixture starts. One Skyport and two Foundry headings changed; another Foundry start moved 4m and one Alpine start moved 8m. Their map IDs and solid layouts remain loadable. All 96 old authored starts now pass the stronger frame-inclusive cast and 2.5s drive check. Buried bottom caps on the old Foundry tank fittings were removed to keep its existing 25k triangle cap after the corrected starts added a lane marker. Visible sides and tops retain their eight-sided shape.

No loading, vendor or game-host source was changed.

## Measured browser results

Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, ANGLE Metal, 1280×720, CPU 4×. Each map also has 390×844 Day/Night top/chase review cases with eight visible full drivers; those short review cases measured about 59.9 FPS. They do not establish phone performance. Renderer counts below are submitted aggregate counts, not separately profiled shadow/colour passes. These browser profiles predate the supply-density follow-up and were not repeated with the larger cycling-home counts.

| Real production room | FPS | Draws / triangles per frame | Binary updates/s | KiB/s | Evidence |
| --- | --- | --- | --- | --- | --- |
| Skyport, 32 drivers | 59.6 | 169 / 79,161 | 20.1 | 71.3 | [Metrics](skyport-32/kart-32-browser.json) |
| Garden, 16 | 59.7 | 147 / 68,626 | 20.1 | 36.8 | [Metrics](garden-16/kart-32-browser.json) |
| Frostbite, 16 | 59.6 | 89 / 47,712 | 20.2 | 35.9 | [Metrics](frost-16/kart-32-browser.json) |
| Neon, 24 | 59.7 | 113 / 55,826 | 20.2 | 71.8 | [Metrics](neon-24/kart-32-browser.json) |
| Harbor, 32 | 60 | 137 / 79,032 | 20.2 | 77.5 | [Metrics](harbor-32/kart-32-browser.json) |
| Foundry, 32 | 59.7 | 136 / 72,649 | 20.1 | 59.5 | [Metrics](foundry-32/kart-32-browser.json) |

Rookie's real practice page passes at 2/8 seats with zero eye/near-plane overlaps in its short ground drives. [Practice metrics](practice-metrics.json). The separate unchanged classic 32-driver SwiftShader profile passed its functional checks at **9.1 FPS**, 312 draws and 222,368 triangles/frame, with a 1,717ms worst frame. It is CPU-bound on this Mac and is not comparable to the Metal runs. [Classic metrics](classic-32/kart-32-browser.json).

Before → after: Rookie supply was 6 boxes at two / 10 at eight; it is now 14 / 20 after the active firing follow-up (the original arena build used 12 / 18). Old large raised maps made 12 boxes at 32; the new large full variants make 48. In an isolated Skyport 32-seat transport run, full JSON was about 869KiB/s versus 81.7KiB/s for the binary stream; complete Room update p95 was 15.3ms. Earlier concurrent-load p95 was 33.3ms. [Initial transport measurements](launch-transport-initial.json) and [latest suite measurements](launch-transport.json) are machine-load-sensitive.

## Active firing-probe repair — 10 November follow-up

These are **test-driver bots**, not bots shipped in Pocket Karts. Production practice still has no bots. The failures had both real authority/economy causes and test-driver causes. The authored home counts, 100 HP, all ten weapons, damage, ammo, firing cadence, odds and rare caps are unchanged.

- **Real pickup bug:** joined flat road slabs overlap at the same height. At Rookie home-1, the home ray selected `floor-0` but all four tyres reported `floor-2`. The exact-ID check rejected a kart sitting on the available box. Homes now cache every driveable slab containing their position at the exact authored height; a grounded tyre on any of these can collect. Distance, sight, parked denial and floor separation remain enforced. The real two-sided Rookie replay fails with the old condition and passes with the fix. [Diagnosis and ablations](battle-diagnosis.json).
- **Real edge placement:** seven compact Skyport upper homes had insufficient supported approach/turn space, including homes exactly on `z=28.5m` deck edges. They now sit farther inward, with 3m of supported run-out in eight directions and at least 8m from same-floor opening starts. IDs and profiles stay fixed; home road-distance columns were rebuilt offline and Skyport's revision is now 2. Future home authoring checks the same run-out. The complete Skyport core gates and the new home-setback regression pass. [Exact before/after positions](skyport-home-insets.json).
- **Real deck-lip jam:** an upright kart can catch its front tyres beyond a deck edge while the rear tyres remain supported. A legal-start, ordinary-input Skyport replay reproduces failed reverse driving at `z≈27.63m`. Old recovery only handled tipped karts. Production recovery now also handles sustained failed driving with too few supporting tyres, using two seconds of actual position progress rather than misleading velocity jitter. Parking, moving karts, combat slow/spin and feature flights are excluded. Existing clear-bay, cooldown and no-award rules remain. The new regression fails with the old condition and passes with the fix. [Old-rule failure](deck-lip-before.log).
- **Test-driver faults:** a failed local grid attachment left stale throttle/reverse inputs running; short waypoint pursuit cut corners and open deck edges; exploration goals survived weapon depletion; and returned boxes were sought while the kart was still blocked by the leave/re-enter rule. The driver now reacquires road nodes, always sends a checked ordinary input, forecasts corner/straight steering with the real suspension and collision code in a separate planning world copied from public poses, reselects after depletion and tracks the public parked rule. The driving mask checks support around the whole turning kart at open drops. No authority body is reset or moved by the probe.
- **Real coverage gap:** high global availability did not prevent long road approaches. With the same corrected driver and 2/3/4s returns, Skyport seed 0 still failed at **9.40s p95** with 25 cycling homes. Cycling 39 existing authored homes cut that replay to **7.05s p95**, with 87.3% mean availability. The intermediate `ceil(A/200)` term still failed two Skyport seeds at 8.30s and 9.30s p95. The final area term is `ceil(A/160)`, from `ceil(A/320)`, within the same authored-home and 48-box caps. At eight seats this cycles the full authored pools: 20 / 40 / 28 / 32 / 32 / 40 / 44. No extra home IDs or geometry were added. Seven existing compact Skyport homes were also moved inward, as described above. [Before home counts](battle-before/final-arenas.json).
- **Real refill gap:** with the efficient driver but the old 3/4/6s returns, Rookie seed 0 reached 1.55s median / 6.50s p95 unarmed but only **55.6%** median box availability. Safe/exposed/risk returns are now **2/3/4s**. The refill change preserves home IDs and all weapon rules.

Acceptance uses the original wall-clock unarmed definition, including waits through KO/respawn, plus unfinished waits at round end. It runs independently of navigation, so a lost route cannot hide a long wait. Availability must meet 60% by both time mean and median; availability and floor dry time are sampled every 50ms. Stalls count continuous periods of over three seconds without 0.5m movement, including traffic/status cases; earlier blocked manoeuvres are recorded separately. Both `recover` and `recovery` authority events are counted; the old diagnostic counted only the latter. The probe still fires real weapons every 200ms when one is available.

**PASS: 35/35 rounds**, seeds 0–4, eight real authority-input bots, 180 seconds each. Every seed independently meets **median ≤4s, p95 ≤8s, mean and median availability ≥60%, floor dry ≤3s**. Every floor is visited by at least two bots in every seed, and every bot has actual armed intervals. Values below are per-seed ranges; availability columns are the lowest seed mean / median. Results are not pooled to hide a failing seed. [Checked summary](battle-summary.json) · [All 35 gate lines](battle-acceptance.log).

| Arena | Median unarmed (s) | p95 unarmed (s) | Lowest availability mean / median | Max floor dry (s) | Stalls, seeds 0 / 1 / 2 / 3 / 4 | Homes approached across seeds |
| --- | --- | --- | --- | --- | --- | --- |
| [Rookie Ribbons](rookie-ribbons-8-battle.json) | 1.20–1.35 | 3.90–4.80 | 65.8% / 65.0% | 2.05 | 1 / 2 / 0 / 1 / 3 | 20/20 |
| [Skyport Split](skyport-split-8-battle.json) | 1.90–2.00 | 4.40–6.80 | 86.8% / 87.5% | 0.00 | 11 / 13 / 13 / 4 / 13 | 40/40 |
| [Garden Crown](garden-crown-8-battle.json) | 2.20–2.45 | 3.75–4.90 | 82.4% / 82.1% | 0.00 | 2 / 1 / 3 / 0 / 2 | 28/28 |
| [Frostbite Crescent](frostbite-crescent-8-battle.json) | 2.20–2.50 | 5.40–6.50 | 84.4% / 84.4% | 0.00 | 1 / 1 / 1 / 0 / 3 | 32/32 |
| [Neon Switchyard](neon-switchyard-8-battle.json) | 1.90–2.10 | 3.55–5.10 | 84.0% / 84.4% | 0.00 | 3 / 2 / 0 / 0 / 0 | 32/32 |
| [Harbor Fork](harbor-fork-8-battle.json) | 2.05–2.35 | 4.60–5.95 | 88.5% / 90.0% | 0.00 | 1 / 0 / 1 / 4 / 3 | 35/40 |
| [Foundry Wheel](foundry-wheel-8-battle.json) | 2.20–2.40 | 4.95–5.70 | 89.1% / 88.6% | 0.00 | 2 / 3 / 11 / 7 / 3 | 44/44 |

The worst median is **2.50s**, worst p95 **6.80s**, lowest mean availability **65.8%**, lowest median availability **65.0%**, and longest floor dry spell **2.05s**. The targets were not lowered. Reproduce with `ARENA_MAP=all ARENA_SEEDS=5 ARENA_SECONDS=180 node tools/kart-arena-battle.mjs` in `apps/games`.

Seed-0 before → after: Rookie median **1.95 → 1.25s**, p95 **20.90 → 4.15s**, stalled approaches **38 → 1**; Garden median **4.75 → 2.20s**, p95 **16.40 → 3.75s**, stalled approaches **25 → 2**. The original before files are preserved under `battle-before/`.

This is a percentile gate, not a zero-stall or full launch-acceptance claim. Individual recorded waits still reach **137.75s**, and Harbor approaches **35/40** cycling homes across this batch. Those outliers remain in the samples and raw reports. The original twenty-seed-per-variant coverage gate, district coverage, human balance and device/performance work remain open. Frostbite/Harbor/Foundry retain their five-seed recordings from the intermediate density step because the final policy yields the identical full 32/40/44-home pools and unchanged controls/layouts/rules.


## Validation

Follow-up full `apps/games npm test`: **PASS, 289 commands**, after the final pickup, supply, recovery and home-inset changes. [Full log](npm-test.log) · [Validation record](validation.json). The joined-floor and deck-lip regressions fail under their old conditions and pass with the fixes. The runtime was rebuilt with `node scripts/build-kart-runtime.js`; its generated bytes stay current. `apps/games/public/release.json` is absent.

Tests ran with `NODE_PATH=/private/tmp/codex-driving-browser/node_modules` and the bounded listener preload. Only task ports 8350–8370 were used. The original arena-build review covered all **128 unique kart test files**: 123 in the expanded full suite plus five extra browser files (Garage, classic 32, both complete 120-shot weapon galleries, launch browser). Those five extra browser files and the 56 fixed-camera visual review cases were **not rerun for this follow-up**; their earlier evidence remains linked above. No physical-phone or human-session result is claimed.

## Remaining acceptance — not launch accepted

1. The five-seed, eight-bot quantitative gate now passes on all seven arenas (table above). Complete the original twenty three-minute seeds per variant, with every district/floor visited by two bots where seats allow, every cycling home approached, ≤4s median / ≤8s p95 unarmed time, ≥60% sustained availability and no floor dry for over 3s. The full variant/district/home-coverage gate remains open; the initial Rookie/Garden failures are preserved as before-fix evidence.
2. Complete all stress states and directed shortcuts: low/normal/nitro/drift/damaged/opposite-traffic climbs, jump speed/offset/failure spread, every cover/rail corner, parked slopes, occupied arrivals and every cannon/portal direction. Frostbite has a real inlet jump/drop replay; ordinary connectivity does not prove every optional shortcut.
3. Replay the production chase camera over every route/drop/underside with eye and near-plane checks, low/medium/high tiers and portrait/landscape. The current independent camera-volume sweeps plus short Rookie production drives are narrower than this gate. Fixed review-camera screenshots are not that proof.
4. Run ten full matches at min/middle/max seats per map and review opening deaths/pickup parity, followed by two human sessions per map. No human balance result is claimed.
5. Run five-minute active-combat performance per tier/map, separate physics/projection and shadow/colour counts, reconnect/keyframe spikes, and ten rematch/map-swap leak checks. Use a named physical iPhone with OS, browser and thermal state. The short Chrome profiles and disposal tests do not replace these runs.
6. Finish the full synthetic three-floor variant/prediction/gate stress matrix. Existing real map, prediction, reconnect, physics, economy and feature suites cover parts of it, not the whole Phase 1 exit gate.

## Plan deviations

The firing follow-up changes the area term from 320 to 160m² per cycling home, returns from 3/4/6s to 2/3/4s, and sets seven compact Skyport homes inward. Weapon rules stay unchanged.

Measured areas, not the sketch estimates, drive the economy. Several variants are larger than their starting A targets. Rookie is 76×52m; its arch has 5.2m clear space underneath and six-metre outer escape lanes. Skyport compact/medium scale all heights with their footprint and omit cannons while retaining portal and ordinary ascents. Foundry compact scales the whole ring to 85% rather than using spoke gates. Harbor compact's upper climb/lookout sits farther back to keep the middle fork clear. Middle/roof quotas changed where real opening coverage required it. These choices are recorded in each map section and still need encounter/balance review. Frostbite and Neon use conservative flat plates; their final footprints differ from the illustrative curves.

The map-by-map sections below retain the original arena-build measurements and captures. Their old supply counts are historical; the current lineup table above and the firing-probe section supersede them.

## Rookie Ribbons — finished art

Merged `claude/game-fixes-nov9` (merge `5a0b43e`). Word Rules passes after the merge, and the runtime bundle was rebuilt. Final full-suite results below will supersede the earlier failed run.

Rookie now uses the existing 256px surface atlases for paving/deck joints, metre-scale UVs, merged guard posts and reflectors, sloped solid ramp guards, two bridge piers, under-slab edge beams, tool-chest details, cones and school flags. Rails and piers share their authority/camera envelopes. Automatic obstacle panels are omitted on rotated guards so they cannot create floating faces.

After this change: duel **32** statics, full **42** (cap 44); measured accessible area **2,117 / 3,160.5 m²**, used by the supply formula. Loaded art is **31 world draws**, **11,042 / 12,962 triangles**, **4,561,492 texture bytes**. Before: 18 world draws, 3,640 / 4,248 triangles; no slope guards or piers. The higher counts buy visible finished surfaces and safety details and remain within the 45 / 28,000 / 12MiB budgets.

Duel/full top/chase shots at 1280/390 in Day/Night were refreshed. [Full review](rookie-ribbons-full-review.jpg) · [Duel review](rookie-ribbons-duel-review.jpg). Files use `rookie-ribbons-{duel,full}-{1280,390}-{day,night}-{top,chase}.png`. Eight 4× CPU cases measured 59.9 FPS, p95 16.7–16.8ms. The real practice page passed again: zero eye or near-plane overlaps in both runs, 59.9 FPS, 12 / 18 boxes. Practice renderer counts were 52 / 66 draws and 21,496 / 33,377 triangles. These are short drives, not a sustained-combat or physical-phone result.

The solid rails caught the old test driver's cut turns. The driver now detects passed waypoint planes and slows tight turns; it does not reset or teleport. Both complete circuit directions, all departures/routes, 10,032 camera checks and forty three-minute stress replays pass with the guards present. New `kart-launch-art.mjs` checks texture mipmaps/UVs, finite camera envelopes, slope-guard transforms, bridge supports, disposal and map art budgets; it is in `npm test`.

The remaining acceptance work is listed below. These short runs and isolated routes do not close the combat or device gates.

## Skyport Split — first built large arena

Four fixed variants now have measured areas **7,795 / 9,212.5 / 12,704.25 / 18,189.25 m²**, **40 / 48 / 64 / 72** authored homes and **25 / 29 / 40 / 48** cycling boxes at 8 / 16 / 24 / 32 drivers. Pools contain **16 / 32 / 48 / 64** legal candidates. Max starts are 16 ground / 8 middle / 8 roof, interleaved across the roster. All 32 full-map starts physically drive 20m together; full-hull casts include the cannon and portal frames.

The west two-turn helix, east switchback, middle bridges, protected roof bridge, optional roof gap/lower catch, full-map two cannons and cross-level portal are built. Every ordinary directed route passes authority-input driving in both directions on every variant. Real clearance graphs connect every start/home; closing either tier of the helix or either east climb leaves the ordinary network connected. Closures block the climb interior, preserving supported endpoint aprons. Twenty supply seeds per reference count pass fixed-home count/floor checks. [Core audit](skyport-split-gates.json).

Uniform compact geometry retains the ramp grades while bringing eight-driver area down from the first 14,861m² prototype to **7,795m²**. Its floors are 0 / 7.5 / 15m; medium uses 0 / 8 / 16m; wide 0 / 8.5 / 17m; full retains **0 / 10 / 20m**. Compact/medium omit the two cannons because those narrower street loops do not need them. The portal and both ordinary ascent systems remain. These are explicit changes from the plan. Medium/wide/full area remains above its starting sketch target; encounter/balance testing still matters.

The skin has metre-tiled steel/paving, warm roof and teal middle floors, parking bays, H/P markings, runway lamps, reflected guard caps, roof utility pods and a windowed helix core. Existing painted harbor scenery and full driver models are reused. Guard boxes combine into bounded static meshes; their individual transforms remain the exact art/camera proxies. No arbitrary terrain mesh was introduced. Maximum statics including feature frames: **63**, cap 92. Full world plus shortcut art: **40 draws / 38,726 triangles**, cap 65 / 43,000, before the one loaded backdrop draw. Loaded texture accounting is under 5MiB. Top/chase and each floor slice are captured at 1280×720 and 390×844 in both palettes.

Eight-driver render review cases measured **59.9 FPS** at 4× CPU throttle. The final 32-driver production-browser profile is in the table above. [32-driver metrics](skyport-32/kart-32-browser.json) · [production screenshot](skyport-32/kart-32-browser.png). This is a short run on this Mac using Chrome/Metal, not physical-phone or five-minute combat proof.

Launch arenas now reuse the existing binary transport at their existing 20Hz cadence; legacy raised fixture IDs keep their JSON contract. A mixed real-Room test compares binary-decoded poses, health, districts and homes to JSON clients for 20 seconds, including disconnect/resume. It measured about **27–83KiB/s binary versus 335–871KiB/s full JSON**, depending on seats, before this final geometry refresh. [Current measurements](launch-transport.json) supersede that range. No loading, vendor or game-host code changed.

Respawn scores now use small offline road-distance atlases built from real support/hull graphs. Enemy attachments are accepted only across supported, unobstructed road segments; missing attachments fall back conservatively. No live map raster/search was added to a server tick. Stacked-floor and atlas regression tests pass.

The **before-fix** three-minute Rookie eight-bot firing probe failed: it approached all 18 homes, visited both floors, made 203 pickups and recorded no fall-reset events (the old probe omitted `recover` events). Median unarmed time was 1.95s, p95 20.9s, median availability 78%, and the test driver logged 38 stalled approaches. [Before diagnostic](battle-before/rookie-ribbons-8-battle.json). These before-fix failures motivated the follow-up above; the broader per-variant coverage gate remains open.

Final isolated Room transport rerun for this build: 8 / 16 / 32 Skyport drivers used **22.4 / 42.7 / 81.7KiB/s** binary versus **353 / 524 / 869KiB/s** JSON. Full Room update p95 was **2.1 / 6.4 / 15.3ms**. An earlier concurrent browser/test run measured 33.3ms at 32, so these are machine-load-sensitive measurements, not a hardware-independent promise. [Exact final transport run](launch-transport.json).

Reviewed sheets: [Skyport full](skyport-split-full-review.jpg), [Skyport compact](skyport-split-compact-review.jpg). Each includes all three top slices and chase views in Day/Night at 1280/390. Raw files use `skyport-split-{full,compact}-{1280,390}-{day,night}-{top,chase,L0-top,L0-chase,L1-top,L1-chase,L2-top,L2-chase}.png`. Picker previews now use the finished Rookie and Skyport worlds.

## Garden Crown

Small/full: **5,253 / 8,269m²**, **28 / 40 homes**, **17 / 18 / 28 boxes** at 4 / 8 / 16 drivers, **16 / 32 candidates**, **21 / 25 statics** (cap 60). Both ordinary climbs and the whole crown circuit drive in both directions. Every start/home is connected with either climb interior blocked. All selected starts drive 20m together, and 20 supply seeds per reference count pass. [Core audit](garden-crown-gates.json).

The clover uses stepped joined slabs, broad ramp aprons, the +7m crown loop, real underpasses, piers and a marked lower drop. Stone paving, warm crown panels, cream/ivy piers, hedges, flower beds, a tiled blue basin and crown fountain are finished in the shared renderer. The full apron was widened after the graph found that the original ramp approach was sealed off by its narrow side lane. Small/full areas exceed the original sketch targets; the formula uses measured areas. No portal is needed for ordinary travel.

The core art census is below **30 draws / 18,000 triangles** before the loaded backdrop, under the 55 / 38,000 map budget. Eight-driver top/chase review runs at 1280 and 390, Day/Night, measured **59.9 FPS** at 4× CPU throttle. Each floor has its own captures. [Full review](garden-crown-full-review.jpg) · [Small review](garden-crown-small-review.jpg) · [Render measurements](garden-browser-metrics.json).

The final production-browser profile is in the table above. [Metrics](garden-16/kart-32-browser.json) · [Production screenshot](garden-16/kart-32-browser.png).

The **before-fix** three-minute, eight-bot firing probe approached all 18 selected homes and visited both floors, with 186 pickups and no recorded fall-reset events (the old probe omitted `recover` events). Median availability was 83%; median unarmed time was 4.75s, p95 16.4s, with 25 stalled approaches. This **does not pass** the active-combat target. [Before diagnostic](battle-before/garden-crown-8-battle.json).

Shared addition: a bounded convex flat-slab path now supports exact polygon outlines for the coming hexagon/octagon arenas. It has matching top/bottom/sides in physics, art and camera queries, analytic support tests, proper normals/UVs and a 90m real seam-driving regression. It is not arbitrary terrain, and saved legacy maps do not use it.

## Frostbite Crescent

Small/full measured area is **6,736.5 / 7,224.5m²**, with **32 / 44 homes**, **22 / 28 cycling boxes** at 8 / 16 drivers, **16 / 32 candidates**, and **25 statics** (cap 62). Both +8m climbs and the complete shelf loop pass two-way authority driving. The ordinary shore bypass remains connected with either climb blocked. All four starting wheels stay off the ice; all selected starts drive their 20m departure together. Twenty seeds pass the actual selected-home opening coverage, fixed-home and floor-minimum checks. [Core audit](frostbite-crescent-gates.json).

The inlet is an actual eight-metre missing-floor jump, with a dry ordinary bypass. A real physics replay leaves the kicker, crosses the water and lands on the opposite shore. The marked east shelf drop lands on dry ground with no recovery. The inner low-grip bowl has six or more homes; its ordinary approaches remain on grippy shore. The quarry shelf, striped piers, slate paving, rail caps, ice cracks, snow banks and outside hoist share merged art. Each variant has **24 world draws / at most 17,178 triangles** before loaded backdrop, below 58 / 40,000.

Reviewed [full](frostbite-crescent-full-review.jpg) and [small](frostbite-crescent-small-review.jpg) sheets include each floor, top/chase, Day/Night, 1280/390. Eight-driver render cases measured about **59.9 FPS** with CPU 4×. [Render metrics](frost-browser-metrics.json). The final production-browser profile is in the table above. [Production metrics](frost-16/kart-32-browser.json). This remains core implementation evidence; long active-combat, physical-phone and human balance gates are still open.

The shared box selector now uses road distance to homes and strongly reserves two reachable ordinary homes per initial start. The stronger gate exposed a seven-home roof quota for four Skyport medium starts; medium now assigns eight homes to each upper floor. Home profiles now follow the intended roughly 70% safe / 30% exposed split, with a small explicit risk share, rather than treating every upper home as exposed.

## Neon Switchyard

The exact hexagonal ground supports three variants, two +7m sign bridges, opposite climbs, six market cover masses and marked side drops. Every variant passes both directions on the climbs and complete raised circuit, alternate-climb connectivity, actual selected-home coverage over twenty seeds, full-hull departures and camera sweeps. An initial drive caught a sign cover too close to the lane; its shallow edge placement now leaves the driving line clear. [Core audit](neon-switchyard-gates.json).

Finished art uses cyan/pink shutters, striped awnings, inset lights, large A/B signs, steel panels, road paving and reflected rail caps. [Full review](neon-switchyard-full-review.jpg) and [small review](neon-switchyard-small-review.jpg) cover both floors in Day/Night, top/chase, 1280/390. Eight-driver review cases measured **59.9 FPS** at CPU 4×. [Render metrics](neon-browser-metrics.json). The final production-browser profile is in the table above. [Production metrics](neon-24/kart-32-browser.json). Long combat/device/human gates remain open.

## Harbor Fork

Four seat variants have measured A **9,203.75 / 9,203.75 / 12,339.25 / 17,027m²**, **40 / 48 / 64 / 64 homes**, **16 / 32 / 48 / 64 candidates** and **34 statics including the cannon frame**, cap 84. Each floor is real: forked ground over water, +7m cross-docks and +14m lookout. Two climbs per tier, both directions, all variants, alternate-climb connectivity, twenty selected-home seeds, all simultaneous 20m departures and camera sweeps pass. The compact upper climb moved back to keep the north crossing clear, and the side platforms widened to preserve an ordinary bypass. [Core audit](harbor-fork-gates.json).

Container ribs/doors, steel deck textures, lane marks, supported dock edges, bright rim trims, lookout insets, mooring bollards and an orange crane finish the harbor skin. World plus cannon art is **37 draws / at most 30,428 triangles**, below 65 / 45,000 before the loaded backdrop. [Full](harbor-fork-full-review.jpg) and [compact](harbor-fork-compact-review.jpg) sheets were reviewed at 1280/390, Day/Night, top/chase and each of the three floor slices. Eight-driver review cases ran at **59.9 FPS** at CPU 4×. [Metrics](harbor-browser-metrics.json).

The final production-browser profile is in the table above. [Production metrics](harbor-32/kart-32-browser.json). Full long-combat, device and human acceptance is still open. Full area exceeds the sketch target; compact does not simply reuse the full ground footprint. The authority atlas now rounds home distances upward, so a 32.24m route cannot round down into the 32m opening allowance.

## Foundry Wheel

All four octagonal variants are built: area **10,588.5 / 12,294.75 / 13,659.25 / 15,433.25m²**, homes **44 / 56 / 64 / 64**, candidates **16 / 32 / 48 / 64**, and **53 statics including all three shortcut frames** (cap 96). Every tier has a complete ordinary ring; two service climbs connect each pair of tiers. All variants pass two-way real authority driving on every route, blocked-climb connectivity, twenty selected-home seeds, simultaneous departures, camera sweeps and art census. Tests also settle a real kart on each of the three belts, verify its exact supporting floor and push direction, and reject air/other-height effects. Initial starts avoid belt approaches. [Core audit](foundry-wheel-gates.json).

The initial narrow side rings failed traversal because the ramps filled their lanes. The final layout widens the inner bypasses, keeps the 136×128m outer octagon, moves the cannon off a service landing and tanks off the loop, and places the belts in separate ground lanes. A sealed glowing furnace, west blue tank cage, orange crane, striped tunnel piers, steel decks, inset lamps and rim guards finish the industrial skin. Compact is uniformly scaled to 85%, retaining grades; that differs from the proposed spoke gates. Its floor heights are 0 / 6.8 / 13.6m; full retains 0 / 8 / 16m. World plus shortcut art uses **51 draws / at most 34,302 triangles**, below 68 / 46,000 before the loaded backdrop.

[Full review](foundry-wheel-full-review.jpg) and [compact review](foundry-wheel-compact-review.jpg) include all floors, Day/Night, top/chase, 1280/390. Eight-driver CPU 4× cases measured **59.9 FPS**. [Render metrics](foundry-browser-metrics.json). The final production-browser profile is in the table above. [Production metrics](foundry-32/kart-32-browser.json).

The full box quota is **20 / 16 / 12**, changed from the sketch's 24 / 12 / 12 to preserve the two-home opening on the eight middle starts. Risk tagging cannot consume a start's second reachable ordinary home. Full long-combat, device and human acceptance remains open.

The final scenery extension carries the water/yard below the guarded roads to the painted backdrop, removing the pale empty strip seen in early production captures. It changes no driving collider and adds no triangles or draws. The final captures and picker previews were refreshed after this change.
