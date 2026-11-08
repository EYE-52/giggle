# Raised arena cost and ramp fixes

Run `node scripts/kart-raised-performance.mjs` in `apps/games` to compare against
the lights commit, `002517e`. JSON goes to `/tmp/codex-raised-performance.json`.
Run `node test/kart-raised-regressions.mjs` for physics and current budgets;
its evidence goes to `/tmp/codex-raised-regressions.json`. This test also runs
in `npm test` and `npm run test:kart-elevation`.

## Geometry counts

These are conservative **unculled idle scene counts**, using actual animal GLBs,
all item boxes, shortcut art, festive lights and a sun shadow pass. They are not
`renderer.info`, FPS or a GPU benchmark. Mounted weapons, damaged hearts and
temporary combat effects add cost. The old scene's offscreen shadow casters are
also counted, so these numbers are higher than a chase camera's visible count.

Two players:

| Arena | Before high: draws / triangles | After high | After low |
| --- | ---: | ---: | ---: |
| Foundry | 204 / 150,346 | 84 / 48,828 | 60 / 28,636 |
| Skyport | 200 / 140,852 | 83 / 40,110 | 57 / 23,320 |
| Harbor Heights | 280 / 144,878 | 85 / 51,496 | 69 / 37,888 |

At 32 players the high counts are 85 / 49,226, 84 / 40,506 and 86 / 51,858,
respectively. The followed kart always keeps its chosen animal and paint. High
and medium also keep one nearest rival detailed; other karts use the shared
coloured crowd batch. Low keeps only the followed kart detailed.

For a reference under the same unculling/counting rules, Rookie Ring with two
animals and six original sculpted crates counts 212 draws / 200,651 triangles.
This does **not** establish an FPS comparison: view distance, materials and
screen coverage also matter.

## Render changes

- Replaced the raised arenas' repeated 4,428-triangle question-box GLBs with one
  textured 12-triangle box batch. This also removes new crate geometry/material
  uploads when a crate returns.
- Merged complex surface details by shared material into spatial chunks.
  Shared original harbor materials and merged its remaining static pieces.
  Hidden source parts stay available for collider/art inspection and cleanup.
- Static map art receives shadows; each detailed kart casts through one small
  shadow shape. High uses a 1024 shadow map, medium 512, low no shadow pass.
  Existing painted contact shadows stay visible.
- Low hides small complex facade/roller/panel detail while keeping visible tank
  and vehicle shapes that explain solid obstacles. Complex medium bulbs drop
  from 50% to 37.5%; low retains 25%, and neon tubes stay visible.
- Restored each object's original culling flag after loading warm-up. It was
  previously left disabled. Question-box and crowd shader variants are prepared
  during loading, including an initially empty scene.

## Post-load spikes

The camera previously scanned dense kart vertices on its first close wall
encounter. It also tested every static mesh for every art sample and side-view
candidate. Vertex scans now happen during loading. A cached bounding-box pass
rejects distant solids before the same exact triangle queries. Across 2,076
test rays, including rays starting inside collider bounds, the candidate count
falls from 157,776 mesh visits to 376 with identical nearest hits.

These remove concrete deferred-work sources. **The reported spikes at frames
945 and 1225 are not attributed or confirmed fixed.** GPU Chromium with
`--use-angle=swiftshader --enable-unsafe-swiftshader` closes during launch in
this environment. No renderer frame trace, throttled p95/p99, screenshot or
SwiftShader FPS result is claimed. The live build still needs that comparison.

## Collision and pose checks

Rendering and Rapier now share one wedge vertex function. Tests compare 540
points on the actual visible skins against independent Rapier casts for all
36 ramps. Up/down replays cover 12,960 physics steps. Render-only support
alignment keeps the larger bumper art above the same planes during ramp entry
and interpolation; compact remote poses sample under the four wheels.
Authority/prediction positions are not teleported by this presentation fix.

A real Foundry loading-ramp authority/prediction replay, corrected at 20 Hz,
drives up and reverses down with a maximum position difference of 0.018984 m.
Raised hull contacts now use low friction even on boxes with driveable tops;
wheel surface grip remains separate. A bounded glancing response retains
existing motion along a wall without adding movement from rest. All six raised
maps pass oblique wall-slide and reverse-escape checks. Classic contact tuning
is unchanged.

## Validation

Full `npm test` completed with **EXIT=0**, using Node 24.21.0. Log:
`/tmp/codex-raised-fixes-test.log`. An earlier attempt hit `EADDRINUSE` on
18233; the run was retried after that port became free. The ceiling test now
checks the rotated chassis against the real underside instead of assuming a
fixed centre height. The full suite includes raised spawn lanes, navigation,
features, drift prediction, real 2/8/32-seat rooms, view lifecycle and classic
contact/prediction checks.
