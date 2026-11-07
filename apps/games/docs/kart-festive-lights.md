# Festive lights: driving-camera review

The revised lights use **0.32–0.34 m bulb cores**, **0.7 m spacing** (or closer at short runs), and **1.28–1.36 m additive glow halos**. Low detail keeps one quarter of the bulbs and slightly larger 1.44–1.53 m halos. Neon tubes are 0.32 m across, with pink/cyan/purple/lime colours and a visible travelling chase. There are three added draws per map, no bulb lights/shadows, no bloom, no new textures and no per-frame instance-buffer updates. Reduced motion makes the lights steady.

The main change is placement: cover tops, actual safety kerbs, both sides of ramps, and lane gantries **8 m ahead of the raised-map starts**. Nearby starts on the same lane share a gantry. Similar gantries mark the central and corner lanes of classic maps. Cannon/portal rims still carry dense bulbs. Frosty Pass also has Christmas lights on both ski-station roof fronts.

Counts include bulbs, not the matching halo instances. High / low use 100% / 25% of the cores and halos. Medium uses 37.5% on the two big complexes and 50% elsewhere. Tubes stay visible at every tier. A fresh 1x desktop gets high detail; the tier falls only when that renderer lowers its initial resolution or disables shadows.

| Arena | High | Medium | Low | Added triangles (high) |
| --- | ---: | ---: | ---: | ---: |
| Rookie Ring (classic) | 230 | 115 | 58 | 1280 |
| Bumper Blocks (classic) | 346 | 173 | 87 | 1840 |
| Garden Circuit (classic) | 704 | 352 | 176 | 3536 |
| Frosty Pass (classic) | 496 | 248 | 124 | 2656 |
| Neon Yard (classic) | 602 | 301 | 151 | 3032 |
| Alpine Courtyard (raised) | 641 | 321 | 161 | 3332 |
| Frost Quarry (raised) | 758 | 379 | 190 | 3860 |
| Neon Harbor (raised) | 774 | 387 | 194 | 3924 |
| Harbor Heights (raised) | 1266 | 633 | 317 | 5760 |
| Skyport (raised) | 1470 | 552 | 368 | 7212 |
| Foundry (raised) | 2010 | 754 | 503 | 9552 |

## Near every spawn

Coordinates are **(X, Y, Z)** metres, with +Z north and +X east. The listed points are actual bulbs on the nearest visible fixtures. Spawn numbering is zero-based; it is the seat pool index, not a changing HUD player name.

Visibility is a geometry test, **not a Chromium screenshot result**: the production spawn cameras and 1280×730 game viewport are used. Raised maps use an 8.5 m trailing eye, 4.4 m above the kart and 52° vertical FOV. Classic maps use their 8.8 m trailing eye, terrain-aware eye height and 60° vertical FOV. Collider raycasts reject hidden lights, and the eye shortens when a solid blocks it. Every spawn has at least ten nearby visible cores projecting >=5 pixels and halos >=20 pixels; low detail retains at least three. The real camera can orbit while driving, so please still check the GPU view.

To refresh this list, run `node test/kart-festive-lights.mjs` then `node scripts/kart-festive-report.mjs`. The test also writes `/tmp/codex-festive-spawn-review.json`.

## Rookie Ring (classic/ring)

| Spawn and position | Visible bulbs high / low | Nearby fixtures (distance from spawn) |
| --- | ---: | --- |
| 0: (0, 0, -12) | 90 / 23 | barrier 1 cap at (-4.2, 1.18, -7) — 6.5 m; barrier 5 cap at (4.2, 1.18, -7) — 6.5 m; central east-west lane at (0, 4.3, -4) — 8 m |
| 1: (8.49, 0, -8.49) | 38 / 10 | barrier 4 cap at (7, 1.18, -4.2) — 4.5 m; barrier 5 cap at (4.2, 1.18, -7) — 4.5 m; central north-south lane at (4, 4.3, 0) — 9.6 m |
| 2: (12, 0, 0) | 12 / 3 | outer lane 18/0 at (18, 4.3, -0.33) — 6 m |
| 3: (8.49, 0, 8.49) | 38 / 10 | barrier 6 cap at (7, 1.18, 4.2) — 4.5 m; barrier 7 cap at (4.2, 1.18, 7) — 4.5 m; central north-south lane at (4, 4.3, 0) — 9.6 m |
| 4: (0, 0, 12) | 90 / 23 | barrier 3 cap at (-4.2, 1.18, 7) — 6.5 m; barrier 7 cap at (4.2, 1.18, 7) — 6.5 m; central east-west lane at (0, 4.3, 4) — 8 m |
| 5: (-8.49, 0, 8.49) | 38 / 10 | barrier 2 cap at (-7, 1.18, 4.2) — 4.5 m; barrier 3 cap at (-4.2, 1.18, 7) — 4.5 m; central north-south lane at (-4, 4.3, 0) — 9.6 m |
| 6: (-12, 0, 0) | 12 / 3 | outer lane -18/0 at (-18, 4.69, -0.33) — 6 m |
| 7: (-8.49, 0, -8.49) | 38 / 10 | barrier 0 cap at (-7, 1.18, -4.2) — 4.5 m; barrier 1 cap at (-4.2, 1.18, -7) — 4.5 m; central north-south lane at (-4, 4.3, 0) — 9.6 m |

## Bumper Blocks (classic/blocks)

| Spawn and position | Visible bulbs high / low | Nearby fixtures (distance from spawn) |
| --- | ---: | --- |
| 0: (0, 0, -12) | 50 / 12 | ramp 0 left at (-1.58, 1.8, -17.5) — 5.7 m; ramp 0 right at (1.58, 1.8, -17.5) — 5.7 m; ramp 1 right at (-7.02, 1.38, -12.13) — 7 m |
| 1: (8.49, 0, -8.49) | 32 / 8 | cover 2 north cap at (13.5, 2.55, -13.35) — 7 m; central north-south lane at (4, 4.3, 0) — 9.6 m; outer lane 18/0 at (18, 4.75, -3.6) — 10.7 m |
| 2: (12, 0, 0) | 16 / 5 | outer lane 18/0 at (18, 4.75, -0.33) — 6 m; cover 0 south cap at (17.88, 2.55, 13.35) — 14.6 m; cover 2 north cap at (17.88, 2.55, -13.35) — 14.6 m |
| 3: (8.49, 0, 8.49) | 32 / 9 | cover 0 south cap at (13.5, 2.55, 13.35) — 7 m; central north-south lane at (4, 4.3, 0) — 9.6 m; outer lane 18/0 at (18, 4.75, 3.6) — 10.7 m |
| 4: (0, 0, 12) | 42 / 11 | central east-west lane at (0, 4.3, 4) — 8 m; central north-south lane at (0, 4.3, 0) — 12 m; outer lane 18/0 at (18, 4.75, 0.98) — 21.1 m |
| 5: (-8.49, 0, 8.49) | 46 / 13 | cover 1 south cap at (-13.5, 2.55, 13.35) — 7 m; central north-south lane at (-4, 4.3, 0) — 9.6 m; outer lane -18/0 at (-18, 4.75, 3.6) — 10.7 m |
| 6: (-12, 0, 0) | 16 / 4 | outer lane -18/0 at (-18, 4.75, -0.33) — 6 m; cover 1 south cap at (-17.88, 2.55, 13.35) — 14.6 m; cover 3 north cap at (-17.88, 2.55, -13.35) — 14.6 m |
| 7: (-8.49, 0, -8.49) | 43 / 12 | ramp 1 right at (-7.02, 1.5, -11.5) — 3.4 m; ramp 1 left at (-10.98, 1.5, -11.5) — 3.9 m; cover 3 north cap at (-13.5, 2.55, -13.35) — 7 m |

## Garden Circuit (classic/garden)

| Spawn and position | Visible bulbs high / low | Nearby fixtures (distance from spawn) |
| --- | ---: | --- |
| 0: (0, 0, -14) | 31 / 7 | central east-west lane at (0, 4.3, -4) — 10 m; central north-south lane at (0, 4, 0) — 14 m; cover 1 west cap at (15.85, 2.55, -5.1) — 18.2 m |
| 1: (0, 0, 14) | 31 / 7 | central east-west lane at (0, 4.3, 4) — 10 m; central north-south lane at (0, 4, 0) — 14 m; cover 0 south cap at (-16, 2.55, 3.85) — 18.9 m |
| 2: (-14, 0, 0) | 31 / 7 | cover 0 south cap at (-16, 2.55, 3.85) — 4.3 m; central north-south lane at (-4, 4.3, 0) — 10 m; central east-west lane at (0, 4, 0) — 14 m |
| 3: (14, 0, 0) | 31 / 7 | cover 1 west cap at (15.85, 2.55, -3) — 3.5 m; central north-south lane at (4, 4.3, 0) — 10 m; central east-west lane at (0, 4, 0) — 14 m |
| 4: (-38, 2.37, -30) | 29 / 7 | barrier 4 cap at (-40, 1.18, -16) — 14.1 m; ramp 0 left at (-18.18, 0.68, -29.88) — 19.8 m; garden lane festoon -40 at (-40, 4.4, -10) — 20.1 m |
| 5: (38, 4.15, -32) | 30 / 8 | corner lane 36/-36 at (38.83, 9.56, -33.17) — 1.4 m; barrier 6 cap at (40, 1.18, -14) — 18.1 m; cover 1 east cap at (24.15, 2.55, -17) — 20.4 m |
| 6: (-44, 0, 28) | 80 / 20 | barrier 5 cap at (-40, 1.18, 28.2) — 4 m; corner lane -36/36 at (-38.83, 4.3, 33.17) — 7.3 m; cover 4 west cap at (-36.15, 2.55, 28.33) — 7.9 m |
| 7: (38, 0, 32) | 70 / 17 | corner lane 36/36 at (38.83, 4.3, 33.17) — 1.4 m; barrier 7 cap at (40, 1.18, 27) — 5.4 m; cover 3 north cap at (33, 2.55, 29.15) — 5.8 m |
| 8: (0, 0, -44) | 91 / 23 | barrier 0 cap at (0.34, 1.18, -40) — 4 m; cover 2 south cap at (-0.17, 2.55, -31.15) — 12.9 m; cover 2 north cap at (-0.17, 2.55, -24.85) — 19.2 m |
| 9: (-4, 0, 46) | 70 / 18 | barrier 2 cap at (-3.7, 1.18, 40) — 6 m; cover 5 north cap at (2, 2.55, 37.15) — 10.7 m; cover 5 south cap at (2, 2.55, 30.85) — 16.3 m |

## Frosty Pass (classic/frost)

| Spawn and position | Visible bulbs high / low | Nearby fixtures (distance from spawn) |
| --- | ---: | --- |
| 0: (0, 0, -14) | 70 / 17 | barrier 0 cap at (-5.5, 1.18, -11) — 6.3 m; barrier 4 cap at (5.5, 1.18, -11) — 6.3 m; ramp 0 left at (-2.48, 1.8, -20) — 6.5 m |
| 1: (0, 0, 14) | 70 / 17 | barrier 2 cap at (-5.5, 1.18, 11) — 6.3 m; barrier 6 cap at (5.5, 1.18, 11) — 6.3 m; ramp 1 left at (2.48, 1.8, 20) — 6.5 m |
| 2: (-14, 0, 0) | 64 / 17 | barrier 1 cap at (-12, 1.18, -4) — 4.5 m; barrier 3 cap at (-12, 1.18, 4) — 4.5 m; central north-south lane at (-4, 4.3, 0) — 10 m |
| 3: (14, 0, 0) | 64 / 17 | barrier 5 cap at (12, 1.18, -4) — 4.5 m; barrier 7 cap at (12, 1.18, 4) — 4.5 m; central north-south lane at (4, 4.3, 0) — 10 m |
| 4: (-38, 0.01, -38) | 29 / 7 | corner lane -36/-36 at (-36, 4, -36) — 2.8 m; cover 0 south cap at (-31, 2.55, -21.15) — 18.2 m |
| 5: (38, 0, -38) | 41 / 11 | corner lane 36/-36 at (36, 4, -36) — 2.8 m; cannon 0 muzzle at (32.6, 4.77, -37.25) — 5.4 m; cover 3 east cap at (15.15, 2.55, -33) — 23.4 m |
| 6: (-38, 0, 38) | 33 / 8 | corner lane -36/36 at (-36, 4, 36) — 2.8 m; cannon 1 muzzle at (-36.45, 3.49, 40.76) — 3.2 m |
| 7: (38, 0.01, 38) | 32 / 7 | corner lane 36/36 at (36, 4, 36) — 2.8 m; cover 1 north cap at (29, 2.55, 23.15) — 17.4 m; cover 1 south cap at (29, 2.55, 16.85) — 23 m |
| 8: (0, 2.46, -46) | 35 / 10 | cover 3 west cap at (8.85, 2.55, -33) — 15.7 m; cover 3 east cap at (15.15, 2.55, -33) — 20 m; ramp 0 left at (-2.48, 0.5, -26) — 20.2 m |
| 9: (0, 2.35, 46) | 39 / 9 | cover 2 east cap at (-6.85, 2.55, 33) — 14.7 m; cover 2 west cap at (-13.15, 2.55, 33) — 18.5 m; ramp 1 left at (2.48, 0.5, 26) — 20.2 m |

## Neon Yard (classic/neon)

| Spawn and position | Visible bulbs high / low | Nearby fixtures (distance from spawn) |
| --- | ---: | --- |
| 0: (0, 0, -14) | 29 / 8 | barrier 5 cap at (5, 1.18, -16) — 5.4 m; central east-west lane at (0, 4.3, -4) — 10 m; central north-south lane at (0, 4.3, 0) — 14 m |
| 1: (0, 0, 14) | 29 / 7 | barrier 4 cap at (-5, 1.18, 16) — 5.4 m; central east-west lane at (0, 4.3, 4) — 10 m; central north-south lane at (0, 4.3, 0) — 14 m |
| 2: (-14, 0, 0) | 29 / 7 | barrier 7 cap at (-14, 1.18, -8) — 8 m; central north-south lane at (-4, 4.3, 0) — 10 m; central east-west lane at (0, 4.3, 0) — 14 m |
| 3: (14, 0, 0) | 28 / 8 | central north-south lane at (4, 4.3, 0) — 10 m; central east-west lane at (0, 4.3, 0) — 14 m; barrier 5 cap at (5.67, 1.18, -16) — 18 m |
| 4: (-40, 0, -36) | 26 / 6 | corner lane -36/-36 at (-37.89, 4.3, -34.11) — 2.8 m; barrier 6 cap at (-37, 1.18, -24) — 12.4 m |
| 5: (40, 0, -40) | 83 / 22 | corner lane 36/-36 at (36, 4.3, -36) — 5.7 m; cannon 1 muzzle at (35.54, 2.61, -45.29) — 6.9 m; cover 4 south return at (37, 2.55, -28.15) — 12.2 m |
| 6: (-48, 0, 38) | 68 / 16 | cover 2 north cap at (-41, 2.55, 31.15) — 9.8 m; cover 2 west return at (-41.15, 2.55, 31) — 9.8 m; corner lane -36/36 at (-38.83, 4.3, 33.17) — 10.4 m |
| 7: (42, 0, 36) | 13 / 3 | corner lane 36/36 at (38.83, 4.3, 33.17) — 4.2 m |
| 8: (0, 0, -48) | 31 / 8 | ramp 0 right at (2, 0.5, -32.18) — 15.9 m; barrier 0 cap at (-12, 1.18, -34) — 18.4 m; ramp 0 left at (2, 0.5, -27.82) — 20.3 m |
| 9: (0, 1.46, 48) | 46 / 11 | cover 5 north cap at (4, 2.55, 37.15) — 11.6 m; cover 5 west return at (3.85, 2.55, 37) — 11.7 m; cover 5 east return at (12.15, 2.55, 37) — 16.4 m |

## Alpine Courtyard (raised/garden)

| Spawn and position | Visible bulbs high / low | Nearby fixtures (distance from spawn) |
| --- | ---: | --- |
| spawn-0: (-44, 0, -40) | 22 / 6 | spawn lane 0 at (-43.67, 4, -32) — 8 m; plaza-screen south cap at (-34, 3.02, -22.15) — 20.5 m |
| spawn-1: (42, 0, 46) | 50 / 13 | north-ramp ramp left at (37.18, 1.15, 46) — 4.8 m; spawn lane 1 at (45.04, 4, 38.59) — 8 m |
| spawn-2: (-44, 0, 40) | 50 / 12 | portal 0/0 frame at (-40, 2.45, 34.58) — 6.7 m; spawn lane 2 at (-38.3, 4, 34.38) — 8 m; garden-west north cap at (-38, 2.42, 21.15) — 19.8 m |
| spawn-3: (44, 0, -42) | 44 / 11 | spawn lane 3 at (46.39, 4, -34.36) — 8 m; arcade-cover east cap at (46.15, 5.22, -29) — 13.2 m; arcade-cover west cap at (37.85, 5.22, -29) — 14.4 m |
| spawn-4: (-34, 0, -12) | 33 / 8 | cannon 0 muzzle at (-34.48, 6.6, -9.58) — 2.5 m; plaza-screen north cap at (-34, 3.02, -17.85) — 5.9 m; spawn lane 4 at (-30.96, 4, -4.59) — 8 m |
| spawn-5: (-22, 0, 46) | 40 / 10 | spawn lane 5 at (-18.84, 4, 38.64) — 8 m; garden-north west cap at (-9.15, 2.42, 40) — 14.2 m; garden-north east cap at (-0.85, 2.42, 40) — 22 m |
| spawn-6: (22, 7, 17) | 84 / 21 | portal 0/1 frame at (27.42, 9.45, 16) — 5.5 m; courtyard-screen north cap at (22, 9.82, 9.65) — 7.3 m; spawn lane 6 at (19.61, 11, 9.36) — 8 m |
| spawn-7: (26, 7, -2) | 85 / 21 | courtyard corner edge at (22.2, 7.9, -3.8) — 4.2 m; spawn lane 7 at (27.71, 11, 5.82) — 8 m; courtyard-screen south cap at (26, 9.82, 6.35) — 8.3 m |

## Frost Quarry (raised/frost)

| Spawn and position | Visible bulbs high / low | Nearby fixtures (distance from spawn) |
| --- | ---: | --- |
| spawn-0: (-48, 0, -44) | 35 / 8 | spawn lane 0 at (-40.19, 4, -42.25) — 8 m; rock-west east cap at (-40.85, 6.22, -31) — 14.8 m; shelf-south-ramp ramp left at (-33.18, 0.65, -36) — 16.8 m |
| spawn-1: (44, 0, 46) | 22 / 5 | rock-north east cap at (43.15, 5.82, 38) — 8 m; spawn lane 1 at (47.04, 4, 38.59) — 8 m |
| spawn-2: (-48, 0, 44) | 38 / 9 | spawn lane 2 at (-44.92, 4, 36.61) — 8 m; shelf-north-ramp ramp right at (-33.18, 3.89, 42.27) — 14.9 m; kerb-shelf-west edge at (-37.7, 8.8, 24) — 22.5 m |
| spawn-3: (44, 0, -44) | 13 / 3 | spawn lane 3 at (45.07, 4, -36.06) — 8 m; rock-south north cap at (31, 5.02, -23.85) — 24 m |
| spawn-4: (-12, 0, -38) | 34 / 8 | spawn lane 4 at (-9.9, 4, -30.27) — 8 m; shelf-south-ramp ramp right at (-20.82, 2.15, -30) — 11.9 m |
| spawn-5: (32, 0, -8) | 21 / 6 | spawn lane 5 at (24.32, 4, -5.74) — 8 m; east-quarry-screen south cap at (29.67, 3.42, 2.85) — 11.1 m; east-quarry-screen north cap at (25, 3.42, 9.15) — 18.5 m |
| spawn-6: (17, 8, 18) | 88 / 21 | portal 0/1 frame at (17, 8.63, 17.82) — 0.2 m; kerb-bridge-north edge at (10, 8.8, 20.7) — 7.5 m; east-ramp ramp right at (11.82, 8.65, 24) — 7.9 m |
| spawn-7: (-30, 8, 6) | 47 / 11 | shelf-screen south cap at (-32, 10.82, 9.85) — 4.3 m; kerb-shelf-west edge at (-37.7, 8.8, 6.86) — 7.7 m; spawn lane 7 at (-29.67, 12, 14) — 8 m |

## Neon Harbor (raised/neon)

| Spawn and position | Visible bulbs high / low | Nearby fixtures (distance from spawn) |
| --- | ---: | --- |
| spawn-0: (-46, 0, -44) | 12 / 3 | spawn lane 0 at (-39.99, 4.3, -38.71) — 8 m |
| spawn-1: (44, 0, 46) | 23 / 5 | spawn lane 1 at (47.04, 4.3, 38.59) — 8 m; harbor-north-ramp ramp left at (35.18, 4.98, 34.67) — 14.4 m |
| spawn-2: (-46, 0, 42) | 38 / 9 | portal 0/0 frame at (-40, 0.63, 41.82) — 6 m; spawn lane 2 at (-38.37, 4.3, 44.43) — 8 m; cargo-west-b west cap at (-27.15, 5.22, 31) — 21.8 m |
| spawn-3: (46, 0, -44) | 70 / 18 | spawn lane 3 at (48.39, 4.3, -36.36) — 8 m; cargo-east south return at (46, 5.22, -31.15) — 12.9 m; cargo-east east cap at (48.15, 5.22, -31) — 13.2 m |
| spawn-4: (-34, 0, -16) | 63 / 15 | spawn lane 4 at (-30.92, 4.3, -8.61) — 8 m; dock-bollard south cap at (-41, 2.02, -5.15) — 12.9 m; dock-bollard east return at (-40.85, 2.02, -5) — 13 m |
| spawn-5: (-12, 0, 26) | 23 / 6 | spawn lane 5 at (-8.35, 4.3, 18.87) — 8 m; kerb-loading-west edge at (8.3, 6.8, 20.23) — 21.1 m |
| spawn-6: (16, 6, 22) | 125 / 31 | portal 0/1 frame at (16, 11.03, 22) — 0 m; loading deck neon sign at (16.5, 10.3, 22) — 0.5 m; loading-screen north cap at (20, 8.82, 16.15) — 7.1 m |
| spawn-7: (28, 6, 6) | 109 / 26 | loading-screen south cap at (24, 8.82, 11.85) — 7.1 m; loading-screen east return at (24.15, 8.82, 12) — 7.1 m; kerb-loading-east edge at (35.7, 6.8, 7.08) — 7.8 m |

## Harbor Heights (raised/harbor)

| Spawn and position | Visible bulbs high / low | Nearby fixtures (distance from spawn) |
| --- | ---: | --- |
| spawn-0: (-66, 0, -66) | 12 / 3 | spawn lane 0 at (-65.67, 4.3, -58) — 8 m |
| spawn-1: (76, 0, 66) | 38 / 9 | spawn lane 1 at (77.75, 4.3, 58.19) — 8 m; east-climb ramp left at (68.18, 3.5, 60.73) — 9.4 m |
| spawn-2: (-66, 0, 66) | 17 / 4 | spawn lane 2 at (-58.61, 4.3, 69.08) — 8 m; cargo-west-north north cap at (-46, 5.62, 60.15) — 20.8 m |
| spawn-3: (66, 0, -66) | 33 / 8 | portal 0/0 frame at (67.42, 2.45, -62) — 4.2 m; spawn lane 3 at (66.33, 4.3, -58) — 8 m |
| spawn-4: (-4, 0, -68) | 42 / 10 | spawn lane 4 at (0.32, 4.3, -61.26) — 8 m; south-apron-screen south cap at (-3.67, 3.22, -50.65) — 17.4 m; south-apron-screen north cap at (-3.67, 3.22, -45.35) — 22.7 m |
| spawn-5: (4, 0, 68) | 51 / 13 | dock-north-climb ramp right at (8.82, 2.07, 67.86) — 4.8 m; spawn lane 5 at (3.2, 4.3, 60.03) — 8 m |
| spawn-6: (-60, 7, 28) | 43 / 11 | spawn lane 6 at (-52.59, 11.3, 24.96) — 8 m; kerb-span--37-north edge at (-49, 7.8, 26.7) — 11.1 m; kerb-span--37-south edge at (-49, 7.8, 13.3) — 18.4 m |
| spawn-7: (60, 7, 28) | 43 / 10 | spawn lane 7 at (52.37, 11.3, 25.57) — 8 m; kerb-span-37-north edge at (49, 7.8, 26.7) — 11.1 m; kerb-span-37-south edge at (49, 7.8, 13.3) — 18.4 m |

## Skyport (raised/skyport)

| Spawn and position | Visible bulbs high / low | Nearby fixtures (distance from spawn) |
| --- | ---: | --- |
| spawn-0: (40, 0, -104) | 31 / 8 | spawn lane 0 at (45.39, 4.3, -98.08) — 8 m; street-climb ramp right at (47.18, 0.65, -94) — 12.3 m |
| spawn-1: (40, 10, 20) | 48 / 12 | spawn lane 1 at (42.43, 14.3, 12.37) — 8 m; spawn lane 7 at (47.2, 14.3, 9.55) — 12.7 m; spawn lane 23 at (34.27, 14.3, 8.64) — 12.7 m |
| spawn-2: (-40, 20, -20) | 13 / 3 | spawn lane 2 at (-38.25, 24.3, -12.19) — 8 m; spawn lane 27 at (-31.23, 24.3, 2.12) — 23.8 m |
| spawn-3: (100, 0, 100) | 12 / 3 | spawn lane 3 at (94.11, 4.3, 94.57) — 8 m |
| spawn-4: (-40, 10, -18) | 17 / 4 | spawn lane 4 at (-38.25, 14.3, -10.19) — 8 m; spawn lane 19 at (-31.23, 14.3, 2.12) — 21.9 m |
| spawn-5: (40, 20, 20) | 24 / 6 | spawn lane 5 at (43.08, 24.3, 12.61) — 8 m; spawn lane 28 at (33.64, 24.3, 0.62) — 20.4 m |
| spawn-6: (-90, 0, 90) | 12 / 3 | spawn lane 6 at (-84.11, 4.3, 84.57) — 8 m |
| spawn-7: (54, 10, 4) | 61 / 15 | spawn lane 7 at (46.36, 14.3, 6.39) — 8 m; spawn lane 1 at (46.12, 14.3, 13.71) — 12.5 m; cover-1-1 north cap at (44, 13.42, -4.85) — 13.4 m |
| spawn-8: (-40, 0, -8) | 12 / 3 | spawn lane 8 at (-32.09, 4.3, -6.75) — 8 m |
| spawn-9: (40, 0, 16) | 12 / 3 | spawn lane 9 at (32.45, 4.3, 13.33) — 8 m |
| spawn-10: (-100, 0, 0) | 12 / 3 | spawn lane 10 at (-92, 4.3, -0.33) — 8 m |
| spawn-11: (100, 0, 0) | 12 / 3 | spawn lane 11 at (92, 4.3, -0.33) — 8 m |
| spawn-12: (0, 0, 100) | 12 / 3 | spawn lane 12 at (0.33, 4.3, 92) — 8 m |
| spawn-13: (0, 0, -104) | 30 / 8 | spawn lane 13 at (0.33, 4.3, -96) — 8 m; street-cover-1 south cap at (2, 4.22, -84.15) — 20 m |
| spawn-14: (-96, 0, 65) | 13 / 4 | spawn lane 14 at (-89.56, 4.3, 60.24) — 8 m; cannon 1 muzzle at (-85.72, 8.46, 62.87) — 10.5 m |
| spawn-15: (96, 0, -80) | 20 / 5 | spawn lane 15 at (90.06, 4.3, -74.63) — 8 m; cannon 0 muzzle at (84.64, 9.29, -70.35) — 14.9 m |
| spawn-16: (-48, 10, -8) | 49 / 12 | spawn lane 4 at (-41.41, 14.3, -9.34) — 6.7 m; cover-1-0 south cap at (-44, 13.42, 6.85) — 15.4 m; spawn lane 19 at (-31.23, 14.3, 2.12) — 19.6 m |
| spawn-17: (-32, 10, -20) | 16 / 4 | spawn lane 4 at (-34.45, 14.3, -11.2) — 9.1 m; spawn lane 19 at (-31.23, 14.3, 2.12) — 22.1 m |
| spawn-18: (-40, 10, 26) | 12 / 3 | spawn lane 18 at (-32.18, 14.3, 24.29) — 8 m |
| spawn-19: (-40, 10, 2) | 37 / 9 | cover-1-0 south cap at (-40, 13.42, 6.85) — 4.8 m; spawn lane 19 at (-32.61, 14.3, 5.08) — 8 m; cover-1-0 north cap at (-40, 13.42, 13.15) — 11.2 m |
| spawn-20: (32, 10, -8) | 63 / 16 | cover-1-1 south cap at (36, 13.42, -11.15) — 5.1 m; cover-1-1 north cap at (36, 13.42, -4.85) — 5.1 m; spawn lane 20 at (36.32, 14.3, -1.26) — 8 m |
| spawn-21: (48, 10, -20) | 51 / 14 | spawn lane 21 at (48.33, 14.3, -12) — 8 m; cover-1-1 south cap at (44, 13.42, -11.15) — 9.7 m; cover-1-1 north cap at (44, 13.42, -4.85) — 15.7 m |
| spawn-22: (40, 10, 26) | 34 / 8 | parking marquee at (40, 13.5, 28) — 2 m; spawn lane 1 at (44.89, 14.3, 13.27) — 13.6 m; spawn lane 7 at (47.2, 14.3, 9.55) — 18 m |
| spawn-23: (40, 10, 2) | 27 / 7 | spawn lane 20 at (37.39, 14.3, -2.01) — 4.8 m; spawn lane 7 at (45.34, 14.3, 2.59) — 5.4 m; spawn lane 23 at (32.61, 14.3, 5.08) — 8 m |
| spawn-24: (-48, 20, -8) | 46 / 11 | spawn lane 2 at (-41.41, 24.3, -11.34) — 7.4 m; cover-2-0 south cap at (-44, 23.42, 6.85) — 15.4 m; spawn lane 27 at (-31.23, 24.3, 2.12) — 19.6 m |
| spawn-25: (-32, 20, -20) | 16 / 4 | spawn lane 2 at (-34.45, 24.3, -13.2) — 7.2 m; spawn lane 27 at (-31.23, 24.3, 2.12) — 22.1 m |
| spawn-26: (-40, 20, 26) | 12 / 3 | spawn lane 26 at (-32.18, 24.3, 24.29) — 8 m |
| spawn-27: (-40, 20, 2) | 37 / 9 | cover-2-0 south cap at (-40, 23.42, 6.85) — 4.8 m; spawn lane 27 at (-32.61, 24.3, 5.08) — 8 m; cover-2-0 north cap at (-40, 23.42, 13.15) — 11.2 m |
| spawn-28: (32, 20, -8) | 38 / 10 | cover-2-1 south cap at (36, 23.42, -11.15) — 5.1 m; cover-2-1 north cap at (36, 23.42, -4.85) — 5.1 m; spawn lane 28 at (36.32, 24.3, -1.26) — 8 m |
| spawn-29: (48, 20, -20) | 48 / 13 | spawn lane 29 at (48.33, 24.3, -12) — 8 m; cover-2-1 south cap at (44, 23.42, -11.15) — 9.7 m; cover-2-1 north cap at (44, 23.42, -4.85) — 15.7 m |
| spawn-30: (40, 20, 26) | 12 / 3 | spawn lane 5 at (45.46, 24.3, 13.72) — 13.4 m |
| spawn-31: (40, 20, 2) | 20 / 5 | spawn lane 28 at (37.39, 24.3, -2.01) — 4.8 m; spawn lane 5 at (40.12, 24.3, 11.23) — 9.2 m |

## Foundry (raised/foundry)

| Spawn and position | Visible bulbs high / low | Nearby fixtures (distance from spawn) |
| --- | ---: | --- |
| spawn-0: (-50, 0, -104) | 31 / 8 | spawn lane 0 at (-44.61, 4.3, -98.08) — 8 m; west-loading-ramp ramp right at (-42.82, 0.65, -94) — 12.3 m |
| spawn-1: (-50, 10, 18) | 31 / 8 | spawn lane 1 at (-42.19, 14.3, 19.75) — 8 m; east-catwalk corner edge at (-39.8, 10.9, 18.2) — 10.2 m |
| spawn-2: (48, 20, -18) | 24 / 6 | spawn lane 2 at (47.63, 24.3, -10) — 8 m; spawn lane 21 at (47.11, 24.3, -8.28) — 9.8 m |
| spawn-3: (100, 0, -100) | 12 / 3 | spawn lane 3 at (94.11, 4.3, -94.57) — 8 m |
| spawn-4: (50, 10, -18) | 12 / 3 | spawn lane 4 at (51.07, 14.3, -10.06) — 8 m |
| spawn-5: (-50, 20, 20) | 31 / 8 | spawn lane 5 at (-49.67, 24.3, 28) — 8 m; spawn lane 19 at (-41.34, 24.3, 34.59) — 17 m; kerb-east-high-crossing--1 edge at (-38, 20.8, 32.3) — 17.2 m |
| spawn-6: (0, 0, 114) | 17 / 5 | spawn lane 6 at (0.33, 4.3, 106) — 8 m; portal 0/0 frame at (-10, 2.45, 92.58) — 23.6 m |
| spawn-7: (0, 10, -24) | 80 / 19 | portal 0/1 frame at (0, 15.03, -24) — 0 m; furnace hall marquee at (-0.35, 14, -18) — 6 m; spawn lane 7 at (8, 14.3, -23.63) — 8 m |
| spawn-8: (0, 0, -104) | 12 / 3 | spawn lane 8 at (0.33, 4.3, -96) — 8 m |
| spawn-9: (100, 0, 0) | 12 / 3 | spawn lane 9 at (92, 4.3, -0.33) — 8 m |
| spawn-10: (-14, 0, -38) | 12 / 3 | spawn lane 10 at (-13.67, 4.3, -30) — 8 m |
| spawn-11: (14, 0, -38) | 12 / 3 | spawn lane 11 at (14.33, 4.3, -30) — 8 m |
| spawn-12: (-104, 0, -100) | 12 / 3 | spawn lane 12 at (-98.01, 4.3, -94.69) — 8 m |
| spawn-13: (-100, 0, 100) | 12 / 3 | spawn lane 13 at (-94.11, 4.3, 94.57) — 8 m |
| spawn-14: (104, 0, 60) | 44 / 11 | crane yard marquee at (102, 6, 60) — 2 m; spawn lane 14 at (97.23, 4.3, 55.72) — 8 m |
| spawn-15: (-12, 0, 60) | 12 / 3 | spawn lane 15 at (-10.75, 4.3, 52.09) — 8 m |
| spawn-16: (-56, 20, -24) | 32 / 8 | spawn lane 16 at (-55.67, 24.3, -16) — 8 m; cover-2-w south cap at (-53, 23.22, -15.15) — 9.3 m; cover-2-w north cap at (-53, 23.22, -8.85) — 15.4 m |
| spawn-17: (-50, 20, 0) | 12 / 3 | spawn lane 17 at (-49.67, 24.3, 8) — 8 m |
| spawn-18: (-50, 20, 24) | 27 / 7 | spawn lane 5 at (-49.67, 24.3, 28) — 4 m; spawn lane 19 at (-41.34, 24.3, 34.59) — 13.7 m; kerb-east-high-crossing--1 edge at (-38, 20.8, 32.3) — 14.6 m |
| spawn-19: (-50, 20, 36) | 53 / 13 | spawn lane 19 at (-42.19, 24.3, 37.75) — 8 m; kerb-east-high-crossing--1 edge at (-38, 20.8, 32.3) — 12.6 m; west-gantry-ramp ramp left at (-42.82, 20.65, 48) — 14 m |
| spawn-20: (48, 20, -24) | 24 / 6 | spawn lane 2 at (46.98, 24.3, -10.06) — 14 m; spawn lane 21 at (47.11, 24.3, -8.28) — 15.7 m |
| spawn-21: (50, 20, 0) | 24 / 6 | spawn lane 21 at (50.37, 24.3, -8) — 8 m; spawn lane 2 at (50.89, 24.3, -9.72) — 9.8 m |
| spawn-22: (46, 20, 24) | 33 / 8 | spawn lane 22 at (46.33, 24.3, 32) — 8 m; spawn lane 23 at (42.34, 24.3, 31.72) — 8.5 m; kerb-east-high-crossing--1 edge at (38, 20.8, 32.3) — 11.5 m |
| spawn-23: (50, 20, 36) | 54 / 13 | spawn lane 22 at (49.6, 24.3, 32) — 4 m; spawn lane 23 at (42, 24.3, 35.63) — 8 m; kerb-east-high-crossing--1 edge at (38, 20.8, 32.3) — 12.6 m |
| spawn-24: (-26, 10, -24) | 43 / 11 | furnace hall marquee at (-24, 14, -18) — 6.3 m; spawn lane 24 at (-18, 14.3, -23.63) — 8 m |
| spawn-25: (-12, 10, -24) | 74 / 18 | spawn lane 24 at (-17.94, 14.3, -24.28) — 6 m; furnace hall marquee at (-12.17, 14, -18) — 6 m; portal 0/1 frame at (0, 15.03, -24) — 12 m |
| spawn-26: (12, 10, -24) | 42 / 10 | spawn lane 7 at (8.06, 14.3, -24.28) — 4 m; spawn lane 27 at (17.94, 14.3, -23.72) — 6 m; furnace hall marquee at (12.17, 14, -18) — 6 m |
| spawn-27: (26, 10, -24) | 57 / 14 | furnace hall marquee at (24, 14, -18) — 6.3 m; spawn lane 27 at (18, 14.3, -24.37) — 8 m; spawn lane 7 at (8.17, 14.3, -25.58) — 17.9 m |
| spawn-28: (-26, 10, 24) | 26 / 7 | spawn lane 28 at (-18, 14.3, 24.37) — 8 m; spawn lane 29 at (-4.12, 14.3, 25.68) — 21.9 m; kerb-east-high-crossing--1 edge at (-4.53, 20.8, 32.3) — 23 m |
| spawn-29: (-12, 10, 24) | 20 / 5 | spawn lane 28 at (-17.94, 14.3, 23.72) — 6 m; spawn lane 29 at (-4, 14.3, 24.37) — 8 m; kerb-east-high-crossing--1 edge at (9.41, 20.8, 32.3) — 23 m |
| spawn-30: (12, 10, 24) | 27 / 7 | spawn lane 30 at (19.94, 14.3, 25.07) — 8 m; spawn lane 31 at (32.8, 14.3, 29.55) — 21.5 m; kerb-east-high-crossing--1 edge at (33.12, 20.8, 32.3) — 22.7 m |
| spawn-31: (26, 10, 24) | 19 / 4 | spawn lane 30 at (20.28, 14.3, 23.13) — 5.8 m; spawn lane 31 at (33.81, 14.3, 25.75) — 8 m; cover-1-e north cap at (47, 13.22, 15.15) — 22.8 m |
