# Pocket Karts shot retirement

Local fix on `claude/kart-shots-nov9`, based on `56cdcad`. No deployment.

## Reproduction and limits

`node test/kart-shot-retirement.mjs` uses real Three objects, the actual classic placement/batch code, the complete raised frame, and the shared effect factories. It covers all 13 weapon effect paths, final wall/point-blank sweep events, explicit removals, missing/late/duplicate/old packets, pooled reuse, rejected/unacknowledged predicted fire, loading pauses, and hidden/resumed presentation. Measurements have 10 ms resolution.

The first run, before production changes, failed with `classic dropped machinegun: 500ms > 150ms`.

| Case | Before | After |
| --- | ---: | ---: |
| Classic shot after the last authority record, with 350 ms interpolation reserve | 500 ms | 120 ms |
| Raised ordnance after the last authority record | 500 ms | 120 ms |
| Explicit removal snapshot | 0 ms | 0 ms, including owned trail slots |
| Missile / boomerang / frost trail, after emission stops | 430 / 300 / 330 ms | at most 120 ms |
| Blast particles / shockwaves | up to 530 ms | at most 140 ms |
| Predicted machinegun / trishot fire and casings without an echo | 580 ms | at most 140 ms |
| Driving particles after a 30 second render pause | still alive on resume | zero on first resumed update |

The original raised measurement started 100 ms after receipt and observed another 400 ms of visibility; the table includes that first 100 ms. Effect limits above round the sampled last-visible times up to their expiry budgets. A normal render frame may add its scheduling interval.

## Causes and changes

- Physical playback limited lead on the *delayed* playback clock, allowing the interpolation reserve to extend a shot's lifetime. Both views also allowed stale ordnance for much longer than 150 ms. Receipt-age leases now expire at 120 ms; the flight helper separately caps authority-record age/TTL at 150 ms.
- World-space smoke/breadcrumbs had independent 320–450 ms lifetimes and no link back to the shot returning to its pool. Fixed owner arrays now let retirement zero only that shot's GPU lifetime slots. Pool reuse resets trail clocks and positions.
- Casings, lightning, shockwaves, smoke and legacy instance batches had 200–750 ms budgets. Weapon effects now use a 140 ms maximum, and expired batches have zero draw count or hidden roots. Stale weapon status attachments also hide.
- Queued events/local prediction started a new lifetime when rendering resumed. Admission timestamps now carry their elapsed age into every emitter. Old queued events are skipped. Classic history is reseeded after a missing-snapshot interval to avoid replaying old events without authority timestamps.
- Driving particle age used clipped motion time. Age now consumes full elapsed time; movement remains clipped.
- Simulation pauses during arena preparation need a new clock baseline. Phase/preparation changes reset the presentation clock; classic flight advances from accepted simulation time and monotonic receipt age. A regression checks that live shots remain visible after a long preparation pause.

The pools, buffer identities and resource counts remain fixed. No per-frame allocation was added to production code. New queue records are created only when snapshots arrive.

## Validation

- All 107 executable `test/kart-*.mjs|js` suites passed. The four `*-browser.js|mjs` files that only serve manual fixtures are not executable assertion suites.
- The three `pocket-karts*.js` suites also passed.
- The full raised renderer suite, real wall/hill projectile alignment, effect resource/upload budgets, projectile authority lifetimes, nine-map/72-seat production transport, private status budgets, and two complete 60-second transport rounds passed.
- Two old transport fixtures needed repair: classic maps now also have input ACKs, so ACK presence cannot select the elevated input schema; the match deadline checks also needed enough time for the configured 60-second rounds.
- Optional Chrome/WebGL practice harness: `node test/kart-shot-retirement-browser.cjs`. Set `KART_PERF_PLAYWRIGHT` and `KART_PERF_BROWSER` when Playwright/Chrome are outside the package. It uses port 8250 by default (`KART_SHOT_PORT` can select another spare port), fires all 13 weapons on Rookie Ring and Skyport, drops snapshots for 1.2 seconds, tracks object references after map removal, and captures arena/resume screenshots. Headless Chrome's hidden flag is simulated for the visibility listener; CDP really freezes JS/rendering for two seconds. The Node test additionally covers 30-second hidden pauses.

Chrome results and screenshots are in `/tmp/kart-shot-browser-verified/`. Deterministic before/after measurements and final logs are in `/tmp/kart-shots-final-evidence/`.

| Chrome map | Weapons fired | Visible body observations | Frames visible after known server removal | Page errors |
| --- | ---: | ---: | ---: | ---: |
| Rookie Ring | 13/13 | 3941 | 0 ms | 0 |
| Skyport | 13/13 | 3906 | 0 ms | 0 |

## Screenshot follow-up (9 November)

The two supplied images were inspected:

- `artifacts/user-reports/skyport-tower-and-orange-slabs.webp`
- `artifacts/user-reports/driverless-kart-and-orange-slab.webp`

The rolling road, pink/white kerb, two neon fence strips, and corner portal match **classic Neon Yard**. The harbor panorama alone does not identify Skyport. Skyport and all six raised maps remain in the regression coverage. A still image cannot establish how long an object was visible.

### Objects and causes

1. **Orange slabs:** the amber Tri-Shot tracer (`kart-curated-art.mjs:14,31`) was an opaque `BoxGeometry(.24,.24,3.6)` with color `0xffb020`. Pulse used the same geometry in white. This matches the solid orange rectangular faces in both images. In addition, the classic confirmed-shot cue widened that geometry by 1.6 and stretched it across the complete final sweep (`kart-view.js:1304`); raised confirmed sweeps also used their complete length (`kart-elevated-view.js:307`). These are projectile/tracer meshes, not pickup boxes, oil, mines, or a broken instance matrix. The earlier receipt-age and effect retirement fixes above bound their lifetime. This follow-up replaces the live tail with a shared thin capsule and limits the stationary final cue to 1.25 m, ending exactly at the accepted contact. It keeps the existing 140 ms classic / 90 ms raised cue deadlines.
2. **Dark navy tower:** the old `neon-city` decorative instance layer contained 14 opaque buildings, 12–36 m tall, in front of the painted harbor panorama. Windows were placed only on the origin-facing side, so corner views could see a huge blank side. It was real scenery, not a collision/debug/shadow helper or a missing material. The duplicate box skyline and its roofs/windows are removed (`kart-world.mjs:1780`); the harbor panorama and port crane remain. This changes no collider or playable deck.
3. **Driverless overturned kart:** the second image has two live hearts. Its upside-down chassis hides its attached driver below the road/underside. Real classic Rapier bodies reproduced this pose indefinitely; classic motion had no stopped-overturn recovery. `kart-classic-motion.mjs:96` now rights a supported, nearly still live kart after two seconds, in place, with a new pose epoch. It waits if the upright pose overlaps scenery or another kart. Health, ammo, weapon, score and life are preserved. Airborne flips and disabled/KO bodies keep their normal physics/respawn paths. Raised authority already has overturn recovery. A separate raised rendering bug was also reproduced: a model missing from `S.karts` retained its old visible pose forever. `kart-elevated-view.js:329` now hides it, resets its transform, clears its wreck/status/track state, and returns its weapon rig to the pool.

### Deterministic before/after measurements

The measurements use real Three geometry, the production raised renderer frame, and the shared classic Rapier simulation. The before run was made before these follow-up production edits, on `3b81053`. No browser pixels are claimed by these tests.

| Case | Before | After |
| --- | --- | --- |
| Base live Pulse / Tri-Shot tail | 3.6 m long × 0.24 m wide box | 0.63 m long × 0.08 m wide capsule |
| 18 m classic confirmed sweep | 18 m × 0.384 m solid streak | 1.25 m × 0.08 m; exact contact endpoint |
| 18 m raised confirmed sweep | 18 m × 0.24 m solid streak | 1.25 m × 0.08 m; exact contact endpoint |
| Opaque duplicate skyline buildings | 14 | 0 |
| Stopped roof/side pose, five classic maps | still overturned after 10 s (also observed at 20 s) | upright at 2.10–2.14 s; one epoch change |
| Model absent from snapshot, six raised maps | visible indefinitely | hidden on the first frame after removal |

`test/kart-user-report-regressions.mjs` is included beside the shot-retirement test in `npm test` and `test:polish`. It fails with the baseline art (`machinegun live bullet streak is short and pencil thin`). It covers live/confirmed geometry, exact contact endpoints, roster removal/reuse, all five classic recovery paths, airborne inversion, a nearby blocking kart, disabled bodies, and preserved gameplay state. The final-sweep check in `kart-elevated-view.mjs` now expects the shorter stroke. Two aim fixture contexts also needed the current `ordnanceNow` clock; their production direction checks pass unchanged.

The new production paths keep shared resources and pools. Scratch recovery transforms and absent-status options are allocated once during setup. Blocked recovery probes run at 4 Hz after the initial wait. The absent-model scan uses a persistent callback; no frame callback or temporary roster collection is created.

### Follow-up validation and remaining browser work

- All 108 executable `test/kart-*.mjs|js` suites were attempted. **103 pass; five transport suites are blocked** by the current environment's localhost restriction: `kart-acceptance-transport.js`, `kart-complex-transport.js`, `kart-elevated-production-transport.js`, `kart-event-transport.js`, and `kart-ten-arsenal-transport.js`. The four manual browser fixture servers are excluded from this assertion-suite count.
- `pocket-karts.js` and `pocket-karts-smooth.js` pass. `pocket-karts-release.js` is also blocked by localhost access.
- This follow-up session blocks `listen`/`connect` with `EPERM`, and installed Chrome aborts during startup with `EPERM`. It also makes the linked Git metadata read-only. Therefore this follow-up has **no new Chrome before/after screenshots**, no completed practice-bot run, and no follow-up commit yet. The Chrome results earlier in this document belong to the previous fix and do not validate these new changes.
- Before/after metrics, the expected baseline assertion failure, and suite logs are saved in `/tmp/kart-user-report-evidence/`. The supplied images are the visual before evidence. After images remain pending; no diagram or Node result is presented as a Chrome screenshot.

The optional Chrome harness now supports practice bots through the views' real input messages (`KART_SHOT_BOTS=1`) and saves a Tri-Shot firing image as well as arena/resume images. This test-only bot path has passed syntax checking but needs its actual Chrome run. Once the session can start localhost/Chrome, run from `apps/games`, with the local Playwright/Chrome paths if needed:

```sh
KART_SHOT_PORT=8255 KART_SHOT_BOTS=1 \
KART_PERF_MAPS='Neon Yard,Skyport,Alpine Courtyard,Frost Quarry,Neon Harbor,Harbor Heights,Foundry' \
KART_PERF_OUT=/tmp/kart-user-report-browser \
node test/kart-shot-retirement-browser.cjs
```

Also complete the blocked transport checks on a spare port and commit on the current branch with the requested co-author trailer. Nothing in this follow-up was pushed or deployed. No `public/release.json` was created.
