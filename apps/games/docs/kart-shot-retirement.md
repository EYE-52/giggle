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
