# Pocket Karts weapon system

## Rules and final roster

Every kart starts with **100 HP**. Only the server applies damage, scores a knockout at zero, and restores 100 HP on respawn. Spawn protection and Supernova block damage. The HUD shows an exact HP number and a bar; rivals carry compact bars, including at full HP. Damage numbers, hit markers, a brief flinch and a toy-parts knockout burst replace heart feedback.

Keep ten clear roles: Machine Gun (tracking), Tri-Shot (spread), Missile (homing), Cannon (aimed explosive), Mine (rear trap), Blades (close defence), Frost Bomb (slow/area), Turbo Ram (chase/contact), Supernova (defend/area), Nuke (rare warned area). Remove Oil (spin is hard to read), Boomerang (outbound/harmless return is unclear) and Thunder (instant cone duplicates aimed fire). Removed IDs cannot be granted or fired. Historical asset files are not playable roster entries.

A full Machine Gun pickup has 30 bullets at 5 HP each. Tri-Shot has three volleys of three pellets: nine pellets at 150/9 HP each. Each projectile counts once, independently of siblings in the same volley. Thus 20 bullets or six pellets knock out at full HP. A pickup cannot farm a rival's next life. Damage keeps fractional precision; display rounds up the remaining HP. Every area weapon uses `centreDamage * (1 - smoothstep(distance / radius))`, zero at/beyond the edge. Direct missile/cannon contact deals centre damage. Mines use a 4m blast, triggered at 2.2m, with 90 HP at the centre. The triggering driver is sampled at swept contact time. Real blade/ram contact deals 100 HP, once per life/activation. Cover, owner exclusion, spawn shields and live-state checks apply on both classic and raised maps.

## Art and presentation contract

Solid chunky toys with broad coloured housings, cream rims, dark bores and a dark saddle fixed to the bonnet/roll-bar. No thin antennae, floating novelty props or tiny labels. Forward barrels use local +Z and the shared physical muzzle; cosmetic recoil follows the barrel axis without changing authoritative flight. Forward launchers use the shared physical muzzle at chassis-local (0, 1.6, 1.9), with supports down to the kart; Cannon has a shallow 1 m/s lift. Trap racks face rearwards. Broad rear mechanisms, visible ready lamps and small idle motion identify a held item from either side. Active contact/defence mounts stay visible until their timer ends. Empty, dead and respawned karts do not retain a mount.

Models use shared procedural geometry/materials, no new textures or GLBs and no Meshy generation. Mounted models target under 3,000 triangles; projectiles under 800. Instances are reserved and warmed by the existing combat preparation path. No new loader/vendor/host or world/rendering-pipeline work belongs here.

The bottom weapon slot reserves its size and shows a large matching vector icon, name, ready/firing/charging state, ammo number and up to six ammo pips. Large clips group equal portions into pips. Touch has a separate large Fire control. Keyboard shows Space. At 390×844 the slot stays between the drive controls without changing layout. Both Day and Night use the existing soft arcade tokens.

## The original thirteen, including retirement decisions

All accepted hits: exact HP loss, white hit marker, short impact sound and victim flinch. All knockouts: parts burst, KO/name banner and low boom. TTK below is ideal against 100 HP, before travel/cover; multi-pickup estimates require collecting another box.

| Weapon | Role; silhouette; colour | Kart mount and matching HUD icon | Pickup / fire / telegraph | Projectile or area; hit / KO; sound | Damage and ideal TTK |
| --- | --- | --- | --- | --- | --- |
| Machine Gun | Track; single long barrel and side drum; amber | Amber block receiver, brass drum, cream brake; drum-gun icon | Amber ready lamp, short reveal; dry flash, receiver kick | Thin white slugs with short amber streaks; ticks, rat-tat, KO boom | 30 × 5; 20 hits, 1.58s + flight |
| Tri-Shot | Close fan; three broad separated bores; coral | Coral three-bore block and three ready lights; triple-bore icon | Coral pickup pop; three simultaneous flashes and kick | Three gold slugs at ±8°; triple clack, hit ticks, KO boom | 9 × 150/9; 6 pellets, .28s + flight |
| Mine | Rear trap; stacked discs; red | Rear-facing red cassette with three discs; disc icon | Red reveal; rack pops each disc backwards | Low red cap, .7s arm, 12s life, clear 4m blast ring; trip click / thump / KO burst | Centre 90, radius 4m; usually three swept traps after arming |
| Oil (removed) | Rear disruption; purple tank / drop | Retired tank/drop art | No pickup or fire | Replaced by Mine's clear trap role; no active effects/sound | Not playable |
| Boomerang (removed) | Curved sweep; orange V | Retired V/cradle art | No pickup or fire | Harmless return was unclear; no active effects/sound | Not playable |
| Homing Missile | Chase front target; finned nose / tube; scarlet | Red and cream wide tube with top fin; rocket icon | Red ready lamp and front lock; kick / exhaust | Scarlet finned rocket, .18s straight launch then gentle homing; whoosh / bass impact / KO burst | Centre/direct 65, radius 3m; two hits/pickups |
| Cannon | Aimed explosive; huge round bore; blue / brass | Broad blue breech, brass rim, short dark bore; cannon icon | Brass ready lamp; strongest gun kick and warm flash | Steel-blue ball, shallow arc, 2.8m ring; bass thud / heavy impact / KO burst | Centre/direct 70; two hits/pickups |
| Blades | Close defence; three broad rotor paddles; mint | Mint rotor in dark hub; three-paddle icon | Mint reveal; hub unfolds and motor starts | Three visible blades orbit for 6s, real contact only, never through cover; buzz / metal clash / KO burst | 100 on contact; instant after contact |
| Frost Bomb | Slow group; faceted ice capsule; ice blue | Blue capsule in broad cradle; snow capsule icon | Blue ready core; cold flash / lob | .9s fuse, 4.5m snow ring; landed damage slows 2s; glass pop / ice crack / KO burst | Centre 45; three central hits/pickups |
| Thunder (removed) | Instant front cone; yellow fork | Retired fork/bolt art | No pickup or fire | Narrow invisible targeting duplicated aimed guns; no active effects/sound | Not playable |
| Turbo Ram | Chase/contact; twin bumper wedges; lime | Lime broad forward bumper horns; double wedge icon | Lime ready bar; 3s rush with engine rise | Clear active bumper, actual hull reach; bumper sparks / clang / KO burst | 100 on contact; instant after contact |
| Supernova | Defend then area; caged core; magenta | Magenta core inside broad cage ribs; caged-star icon | Pink ready lamp; 3s visible charge and protection | Expanding protective bubble, then clear 9m ring; rising hum / deep pop / KO burst | Centre 90; 3s charge, two pickups |
| Nuke | Rare area clear; large finned capsule; hazard gold | Gold warhead, dark waist, broad cradle; capsule icon | Gold ready core; heavy kick and warning pulses | Lobbed capsule, 2.5s fuse classic / 3.5s raised, final 1.2s 14m warning ring; deep blast / KO burst | Centre 120; one central blast after fuse |

## Prediction and authority

A nearby locally predicted crate contact immediately hides the box, pops it and starts a short roulette without granting ammo. Only an accepted server snapshot supplies the item. Pending claims are keyed by crate and life, reconciled on pickup/ownership, and restored on rejection/timeout. No double pop. The reveal ends on accepted inventory, timeout, fire, death, respawn, round change or reduced motion. First fire has immediate local muzzle/recoil/audio; one matching server echo is consumed, never double-played. Clients never predict damage or a knockout.

Keep swept hull hits, cover-first wall ordering, sphere clearance between barrel and muzzle, owner exclusion and finite shot retirement. Missile selects the nearest visible rival in its forward cone; straight guns keep physical barrel alignment. New broad aim snapping would make the mounted barrel lie, so it is not used.

## Verification record

Implemented locally on `claude/kart-weapons-nov9`. No push or deployment. No Meshy models were generated: balance **3,076 before / 3,076 after; spend 0 credits**. Every new mounted model uses shared, merged geometry: **160–1,620 triangles, 3–4 meshes**, below the 3,000-triangle target. Reused compressed Nuke projectile source has 464 triangles; the other active shots remain small shared procedural models or existing compact canisters. Both renderers prepare their weapon, projectile, trap and FX pools before play. Raised mount reserves now cover the actual roster size, including 32-driver arenas.

### Checks and measurements

- **104 distinct Node kart test files passed**, including every non-browser kart command listed in package scripts and the new `kart-weapon-system.mjs` regression. The initial busy-machine `kart-classic-rapier` run hit the harness timeout; its unchanged standalone rerun passed. A final focused run also passed view/input, health, physical fire, feedback, event delivery, immutable transport and shot retirement checks after the last fixes.
- The existing garage Chrome suite passed all **10 cases**, including desktop, tablet, 320/390/430px phone layouts and Day/Night.
- The real 32-driver server/Chrome test passed: **32/32 connected, 31.7 binary updates/s, 15.6m browser movement, no page/console/server errors**. This busy-machine SwiftShader run measured **2.7 FPS**, worst frame 2,483ms and 539 draw calls/frame. This does **not** prove smooth hardware rendering or 60 FPS. The requested FPS is reported without reducing game detail to improve the benchmark.
- Classic live practice moved **15.20m** through ordinary keyboard input. Its HP stayed at 100. Gallery inventory, projectile positions and firing events are declared snapshots, not claims of natural combat or server-issued damage. Actual collection, inputs, collisions, HP, scoring and protection are independently covered with real authorities/Rapier and production Room/WebSocket tests.
- Chrome captured **160 weapon pictures**: ten weapons × mounted/firing × desktop/390×844 phone × Day/Night × classic/raised. Both gallery runs logged zero browser errors. All slot names stayed visible, their 256×96 layout stayed fixed, and no sideways scroll was measured. Raised portrait controls sit above a separate weapon footer, leaving the driver's kart clear. Touch has a labelled Fire button. Contact sheets were visually inspected; the earlier hidden-name, radar overlap and covered-kart problems were corrected.

### Pickup latency A/B

Controlled Chrome simulation, 12 samples per RTT. The old path waits one RTT for the accepted pickup; the new path calls the shared presentation predictor at local contact. Inventory and damage are never predicted.

| Simulated RTT | Server-only cue callback | Local cue callback |
| --- | ---: | ---: |
| 80ms | 81.21ms | <0.1ms |
| 100ms | 100.89ms | <0.1ms |
| 150ms | 150.91ms | <0.1ms |

These are callback timestamps, not visible-pixel or WAN latency. The new callback falls near or below the browser timer resolution. The pop and roulette paint on the next display frame; the busy 32-driver FPS above remains a separate rendering limit. Rejection restores a still-present crate after 850ms; the pending reveal has a separate 900ms hard stop. A claim is keyed by crate/life, cannot replay while parked on a denied box, and resets on a new life. Classic pickup events now preserve the collected crate ID. Exact accepted event IDs also distinguish a local fire echo from later bullets in the same burst.

### Chrome weapon checklist

All checks below are visual acceptance of the real production renderer with declared snapshot inventory. Both maps/devices/themes have mounted and firing captures. Use the physics/Room tests for authority conclusions.

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
- `review-*.png`: eight full-roster contact sheets
- `browser-results.json`, `raised-browser-results.json`, `contact-metrics.json`, `final-tests.json`
- `kart-32-browser.json` and `kart-32-browser.png`; `video/` contains the classic gallery recording

From `apps/games`, with the local server on 8290:

```sh
node test/kart-weapon-system.mjs
node test/kart-health.mjs
node test/kart-sustained-contact.mjs
NODE_PATH=/private/tmp/codex-driving-browser/node_modules node test/kart-weapon-system-browser.cjs
NODE_PATH=/private/tmp/codex-driving-browser/node_modules node test/kart-weapon-raised-browser.cjs
```

The garage and 32-driver browser tests each own their server; stop the practice server first and use `GARAGE_TEST_PORT=8290` or `KART32_PORT=8290`. Chrome path is `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
