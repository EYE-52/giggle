# Pocket Karts weapon system

## Rules and final roster

Every kart starts with **100 HP**. Only the server applies damage, scores a knockout at zero, and restores 100 HP on respawn. Spawn protection and Supernova block damage. The HUD shows an exact HP number and a bar; rivals carry compact bars, including at full HP. Your own overhead bar stays hidden because your HP is already in the HUD. Damage numbers, hit markers, a brief flinch and a toy-parts knockout burst replace heart feedback.

Keep ten clear roles: Machine Gun (tracking), Tri-Shot (spread), Missile (homing), Cannon (aimed explosive), Mine (rear trap), Blades (close defence), Frost Bomb (slow/area), Turbo Ram (chase/contact), Supernova (defend/area), Nuke (rare warned area). Remove Oil (spin is hard to read), Boomerang (outbound/harmless return is unclear) and Thunder (instant cone duplicates aimed fire). Removed IDs cannot be granted or fired. Historical asset files are not playable roster entries.

A full Machine Gun pickup has 30 bullets at 5 HP each. Tri-Shot has three volleys of three pellets: nine pellets at 150/9 HP each. Each projectile counts once, independently of siblings in the same volley. Thus 20 bullets or six pellets knock out at full HP. A pickup cannot farm a rival's next life. Damage keeps fractional precision; display rounds up the remaining HP. Every area weapon uses `centreDamage * (1 - smoothstep(distance / radius))`, zero at/beyond the edge. Direct missile/cannon contact deals centre damage. Mines use a 4m blast, triggered at 2.2m, with 90 HP at the centre. The triggering driver is sampled at swept contact time. Real blade/ram contact deals 100 HP, once per life/activation. Cover, owner exclusion, spawn shields and live-state checks apply on both classic and raised maps.

## Art and presentation contract

Solid chunky toys with broad coloured housings, cream rims, dark bores and a dark saddle fixed to the bonnet/roll-bar. No thin antennae, floating novelty props or tiny labels. Forward barrels use local +Z and the shared physical muzzle; cosmetic recoil follows the barrel axis without changing authoritative flight. Forward launchers use the shared physical muzzle at chassis-local (0, 1.6, 1.9), with supports down to the kart; Cannon has a shallow 1 m/s lift. Trap racks face rearwards. Broad rear mechanisms, visible ready lamps and small idle motion identify a held item from either side. Active contact/defence mounts stay visible until their timer ends. Empty, dead and respawned karts do not retain a mount.

Models use shared procedural geometry/materials, no new textures or GLBs and no Meshy generation. Mounted models target under 3,000 triangles; projectiles under 800. Instances are reserved and warmed by the existing combat preparation path. No new loader/vendor/host or world/rendering-pipeline work belongs here.

The desktop weapon card reserves 256×96 pixels and shows the icon, name, state, ammo and up to six grouped ammo pips. At 390×844, touch uses a fixed 72×80 round dock beside the 68px Fire button at the lower right. It shows a large icon, ammo badge, pips and a ready ring; its full name and state remain in the accessible label. The road and the centre of the kart stay clear. The stick drives forwards and backwards, so redundant gas/reverse buttons are hidden on phones. Both Day and Night use the existing soft arcade tokens.

## The original thirteen, including retirement decisions

All accepted hits: exact HP loss, white hit marker, short impact sound and victim flinch. All knockouts: parts burst, KO/name banner and low boom. TTK below is ideal against 100 HP, before travel/cover; multi-pickup estimates require collecting another box.

| Weapon | Role; silhouette; colour | Kart mount and matching HUD icon | Pickup / fire / telegraph | Projectile or area; hit / KO; sound | Damage and ideal TTK |
| --- | --- | --- | --- | --- | --- |
| Machine Gun | Track; single long barrel and side drum; amber | Amber receiver, large side drum and visible feed rack; drum-gun icon | Amber ready lamp, short reveal; dry flash, receiver kick | Thin white slugs with short amber streaks; ticks, rat-tat, KO boom | 30 × 5; 20 hits, 1.58s + flight |
| Tri-Shot | Close fan; three broad separated bores; coral | Coral three-bore block, three tall rear ammo pods and ready lights; triple-bore icon | Coral pickup pop; three simultaneous flashes and kick | Three gold slugs at ±8°; triple clack, hit ticks, KO boom | 9 × 150/9; 6 pellets, .28s + flight |
| Mine | Rear trap; stacked discs; red | Rear-facing red cassette with three discs; disc icon | Red reveal; rack pops each disc backwards | Low red cap, .7s arm, 12s life, clear 4m blast ring; trip click / thump / KO burst | Centre 90, radius 4m; usually three swept traps after arming |
| Oil (removed) | Rear disruption; purple tank / drop | Retired tank/drop art | No pickup or fire | Replaced by Mine's clear trap role; no active effects/sound | Not playable |
| Boomerang (removed) | Curved sweep; orange V | Retired V/cradle art | No pickup or fire | Harmless return was unclear; no active effects/sound | Not playable |
| Homing Missile | Chase front target; finned nose / tube; scarlet | Red cross-tail fins, closed tail, cream bands and a loaded cream rocket; rocket icon | Red ready lamp and front lock; kick / exhaust | Scarlet finned rocket, .18s straight launch then gentle homing; whoosh / bass impact / KO burst | Centre/direct 65, radius 3m; two hits/pickups |
| Cannon | Aimed explosive; huge round bore; blue / brass | Closed blue breech, broad side cheeks, brass bridge and forward bore; cannon icon | Brass ready lamp; strongest gun kick and warm flash | Steel-blue ball, shallow arc, 2.8m ring; bass thud / heavy impact / KO burst | Centre/direct 70; two hits/pickups |
| Blades | Close defence; three broad rotor paddles; mint | Raised mint rotor on a dark mast; three-paddle icon | Mint reveal; hub unfolds and motor starts | Three visible blades orbit for 6s, real contact only, never through cover; buzz / metal clash / KO burst | 100 on contact; instant after contact |
| Frost Bomb | Slow group; faceted ice capsule; ice blue | Faceted blue capsule, white snowflake and twin side crystals; snow capsule icon | Blue ready core; cold flash / lob | .9s fuse, 4.5m snow ring; landed damage slows 2s; glass pop / ice crack / KO burst | Centre 45; three central hits/pickups |
| Thunder (removed) | Instant front cone; yellow fork | Retired fork/bolt art | No pickup or fire | Narrow invisible targeting duplicated aimed guns; no active effects/sound | Not playable |
| Turbo Ram | Chase/contact; twin bumper wedges; lime | Lime broad forward bumper horns; double wedge icon | Lime ready bar; 3s rush with engine rise | Clear active bumper, actual hull reach; bumper sparks / clang / KO burst | 100 on contact; instant after contact |
| Supernova | Defend then area; caged core; magenta | Magenta core inside broad cage ribs; caged-star icon | Pink ready lamp; 3s visible charge and protection | Expanding protective bubble, then clear 9m ring; rising hum / deep pop / KO burst | Centre 90; 3s charge, two pickups |
| Nuke | Rare area clear; large finned capsule; hazard gold | Gold warhead, dark waist and broad hazard-striped cradle; capsule icon | Gold ready core; heavy kick and warning pulses | Lobbed capsule, 2.5s fuse classic / 3.5s raised, final 1.2s 14m warning ring; deep blast / KO burst | Centre 120; one central blast after fuse |

## Prediction and authority

A nearby locally predicted crate contact immediately hides the box, pops it and starts a short roulette without granting ammo. Only an accepted server snapshot supplies the item. Pending claims are keyed by crate and life, reconciled on pickup/ownership, and restored on rejection/timeout. No double pop. The reveal ends on accepted inventory, timeout, fire, death, respawn, round change or reduced motion. First fire has immediate local muzzle/recoil/audio; one matching server echo is consumed, never double-played. Clients never predict damage or a knockout.

Keep swept hull hits, cover-first wall ordering, sphere clearance between barrel and muzzle, owner exclusion and finite shot retirement. Missile selects the nearest visible rival in its forward cone; straight guns keep physical barrel alignment. New broad aim snapping would make the mounted barrel lie, so it is not used.

## Verification record

Implemented locally on `claude/kart-weapons-nov9`. No push or deployment. No Meshy models were generated: balance **3,076 before / 3,076 after; spend 0 credits**. Every new mounted model uses shared, merged geometry: **160–912 triangles, 3–4 meshes**, below the 3,000-triangle target. Reused compressed Nuke projectile source has 464 triangles; the other active shots remain small shared procedural models or existing compact canisters. Both renderers prepare their weapon, projectile, trap and FX pools before play. Raised mount reserves now cover the actual roster size, including 32-driver arenas.

### Integration and current checks

Merged `claude/game-fixes-nov9` (`f1721ca`) as merge commit `56f2b92`. Streamed Wasm, early shared warming, match-only assets, selected drivers, delayed optional audio, the redesigned maps and the other game fixes remain alongside the 100 HP / ten-weapon system. Packed thumbnails now contain the exact ten authored SVGs. `kart-runtime.mjs` is rebuilt from the combined sources; its byte-for-byte bundle check passes.

A browser check found an early-mount race: scene imports could finish before the first snapshot supplied a map and driver list. Scene setup now waits for that snapshot without fetching a full fallback library. Disposal releases the wait without starting requests. The classic view test covers both cases. The GPU fixture now supplies complete physical poses and starts with the four selected drivers, matching the production contract. Required combat shaders, both shadow modes and buffer uploads finish before Ready. The later performance integration below extends preparation and settles upload batches with cooperative GPU fences. Disposal and timeout still stop all background work before play.

- **114 Node kart test files passed**, including the external production acceptance workload with `KART_ACCEPTANCE_UPSTREAM=8290`. That workload ran 72 legal WebSocket drivers across nine simultaneous full timed matches.
- The full `npm test` completed successfully after the startup guard, required combat warming and their regressions.
- The final real 32-driver Chrome test passed: **32/32 connected, 30.9 binary updates/s, 84.7m movement, no errors**. Its forced software-rendering run measured **10.9 FPS**, worst frame 1,450ms and 298 draw calls/frame. An earlier busy-machine run measured 3.9 FPS. Neither establishes smooth 32-player hardware rendering.
- The native Metal first-use check passed **24 seconds per map, four selected drivers and all ten weapons** on Skyport, Foundry and Neon: **zero program, buffer or texture creation during play**, and no render frames over 50ms. Before the required pass, the same fixture recorded 12/188/4 new programs/buffers/textures on the raised maps and 10/203/3 on Neon. This is a renderer fixture, not a network or physical-phone benchmark.
- The garage Chrome suite passed all **10 cases**, including both themes and 320/390/430px phones.
- The camera Chrome suite passed all **18 cases**, including both view sizes, four drivers, cannon mouths and raised walls.
- The real firing/retirement Chrome suite passed all **ten weapons on Rookie Ring and Skyport**, including packet stalls, visibility changes and frozen frames. No stale projectile retirement was reported.
- The real practice performance check passed **120 seconds each on Rookie Ring and Skyport**, firing all ten weapons with no browser errors or frame gaps. Native Chrome rendered 7,185 and 7,192 frames respectively (about 60 FPS); startup long tasks are recorded separately in its report.
- The cold-load Chrome check passed at **150ms latency, 1.6 Mbps and 4× CPU slowdown**: host ready 4.78s, both seats ready 6.26s, usable 6.50s after Play. Both seats used streamed Wasm and WebGL; no browser errors occurred. Early warming had already started before Play.
- Chrome captured **240 weapon pictures**: ten weapons × rear mounted / 3/4 mounted / firing × desktop / 390×844 phone × Day / Night × classic / raised. Both gallery runs logged zero browser errors. The galleries use the production bundler with declared snapshot inventory/poses and a declared 3/4 camera; actual authority checks are separate.
- The phone dock stays **72×80**, the desktop card **256×96** across weapons and firing states. Browser checks assert no sideways scroll and keep the phone dock outside the centre driving line. The road is clear on both renderers. Rear silhouette sheets and full phone HUD pictures were inspected; a coplanar Mine-rack face found during review was separated to remove shimmer.

### Second performance integration

Merged the updated `claude/game-fixes-nov9` at `8266c8d`, including performance commit `4ee9559`. Retained compare-before-write HUD helpers, reusable pickup/star/crate pools, scratch sets/LOD records, flat trap support and complete roof/batch bounds. The renderer keeps the required weapon/pickup pass, then allows 6,000ms for other bindings without the optional loading cancellation signal. Required clones take precedence during exact-binding deduplication. Both shadow modes and the final short upload batch settle before Ready; fence polls yield a real task so the GPU can progress. Regressions cover expired optional deadlines, duplicate required bindings, upload fences and no post-Ready preparation.

The repeated eight-driver Chrome measurement used Rookie Ring and Skyport at 1280×720 and 390×844, native Metal and 4× CPU slowdown. Each combat sample exercised all ten pickups plus firing, blasts, knockouts and respawns: **59.96–59.98 FPS**, **16.8ms maximum frame**, **zero main-thread long tasks**, and **zero new program/buffer/texture initializations** during combat. Camera sweeps submitted all expected scenery with no missing meshes or invalid bounds. Rookie Ring desktop recorded one texture initialization during natural driving; the other three natural samples recorded zero. This is a short shared-Mac measurement, not physical-phone or 32-player hardware evidence.

After this integration, all **115 Node kart test files** and the full `npm test` passed. The real acceptance workload again ran 72 legal drivers across nine timed matches. Garage, camera, first-fire GPU warming, projectile retirement and two-minute practice driving browser checks passed. All ten weapons used zero new GPU resources in the 24-second-per-map first-fire fixtures. The separate 32-driver SwiftShader check passed with no errors at **3.9 FPS**, worst frame 1,750ms; this CPU-rendering result remains separate from the native eight-driver measurement.

Both production-bundle galleries passed again with **240 fresh Day/Night desktop/phone screenshots**. Rear mounts and the phone dock were reviewed after the merge. The cold-cache loading check passed at 150ms latency, 1.6 Mbps and 4× CPU slowdown: host ready **4.72s**, both seats ready **6.80s**, usable **7.05s** after Play, with streamed Wasm on both seats and no browser errors. These short measurements vary with shared-machine load. The complete latest validation ledger is `apps/games/artifacts/kart-weapons/merge2-final-validation.json`; full-suite output is `merge2-full-npm-test.log` in the same directory.

Current numbers and scope: `apps/games/docs/kart-weapon-performance-integration.json`. The inherited `apps/games/docs/kart-performance-results.json` remains the original performance branch's historical before/after report. Raw traces, CPU profiles and screenshots are in `apps/games/artifacts/kart-weapons/perf-integration/`.

### Controlled pickup latency A/B

Controlled Chrome simulation from the initial weapon pass, 12 samples per RTT. The old path waits one RTT for the accepted pickup; the new path calls the shared presentation predictor at local contact. Inventory and damage are never predicted.

| Simulated RTT | Server-only cue callback | Local cue callback |
| --- | ---: | ---: |
| 80ms | 81.21ms | <0.1ms |
| 100ms | 100.89ms | <0.1ms |
| 150ms | 150.91ms | <0.1ms |

These are callback timestamps, not visible-pixel or WAN latency. The new callback falls near or below the browser timer resolution. The pop and roulette paint on the next display frame; the busy 32-driver FPS above remains a separate rendering limit. Rejection restores a still-present crate after 850ms; the pending reveal has a separate 900ms hard stop. A claim is keyed by crate/life, cannot replay while parked on a denied box, and resets on a new life. Classic pickup events now preserve the collected crate ID. Exact accepted event IDs also distinguish a local fire echo from later bullets in the same burst.

### Chrome weapon checklist

All checks below are visual acceptance of the real production renderer with declared snapshot inventory. Both maps/devices/themes have rear, 3/4 and firing captures. Phone names stay accessible while the dock shows the icon and ammo. Use the physics/Room tests for authority conclusions.

| Weapon | Own and rival mount | Named slot / ammo | Fire or active effect | Day/Night + desktop/phone + classic/raised |
| --- | --- | --- | --- | --- |
| Machine Gun | Checked | Checked | Checked | Checked |
| Tri-Shot | Checked | Checked | Checked | Checked |
| Mine | Checked | Checked | Checked | Checked |
| Homing Missile | Checked | Checked | Checked | Checked |
| Cannon | Checked | Checked | Checked | Checked |
| Spinning Blades | Checked | Checked | Checked | Checked |
| Frost Bomb | Checked | Checked | Checked | Checked |
| Turbo Ram | Checked | Checked | Checked | Checked |
| Supernova | Checked | Checked | Checked | Checked |
| Nuke | Checked | Checked | Checked | Checked |

Oil, Boomerang and Thunder are absent from pickup rolls and HUD thumbnails; forced retired IDs cannot fire. Their active art, sound and effect branches were removed. Historical source GLB packs and other migration aliases remain for compatibility with existing asset contracts.

### Evidence and reproduction

Local evidence is in `apps/games/artifacts/kart-weapons/` (screenshots/videos are not shipped game assets):

- `desktop-day-machinegun-mounted.png`, `phone-night-cannon-mounted.png`
- `raised-phone-day-machinegun-mounted.png`, `raised-phone-night-supernova-firing.png`
- `*-mounted-three-quarter.png`: all ten angled mounts
- `review-v2-*.png`: eight rear/3/4 full-roster contact sheets
- `browser-results.json`, `raised-browser-results.json`, `all-kart-results.json`, `extra-browser-results.json`
- `full-npm-test-final.log`, `loading/result.json`, `retirement/` and `camera/`
- `kart-32-browser.json` and `kart-32-browser.png`; `video/` contains the classic gallery recording

From `apps/games`, with the local server on 8290:

```sh
node test/kart-weapon-system.mjs
node test/kart-health.mjs
node test/kart-sustained-contact.mjs
NODE_PATH=/private/tmp/codex-driving-browser/node_modules npm run test:kart-weapons-browser
```

The garage and 32-driver browser tests each own their server; stop the practice server first and use `GARAGE_TEST_PORT=8290` or `KART32_PORT=8290`. Chrome path is `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
