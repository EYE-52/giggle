# Pocket Karts sustained blade contact

Measured on 2026-11-09, in the `kart-blades` worktree.

## Cause and balance

Both authorities sent every blade contact through the permanent per-pickup
`volleyHits` set. After one hit the target stayed in that set for the full
six-second activation. Three hearts minus one damage left two hearts forever,
regardless of contact duration. The orbit radius (2.2), blade plus hull radius
(0.55 + 1.7), full-height distance, owner/connection filters and spawn shield
were not the cause. Blade hits did not refresh spawn protection.

Blades now have a separate cooldown for each target: one whole heart every two
simulation seconds. Three contacts therefore KO a full-health rival in about
four seconds, within the requested 3–6 second window. The six-second lifetime,
range and knockback stay the same. Rejected contact does not restart the timer.
The same activation cannot hit a new life after respawn. A new activation
starts a fresh contact ledger; expiry, KO, recovery and phase reset clear it.

Ram is one damaging collision per pickup, with a three-second speed boost.
Thunder is a single aimed strike, Frost a single slowing blast, Supernova one
two-heart burst after protection, and Boomerang one heart across its two throws.
Those existing balance rules remain unchanged. They damage again with a new
pickup; leaving a spent visual attack near a rival is not another pickup.
Mine and oil drops each have their own damage budget. No team filter is used
in this free-for-all mode.

## Reproduce

From `apps/games`:

```sh
node test/kart-sustained-contact.mjs
node test/kart-sustained-contact.mjs --measure-only
```

The harness runs at 60Hz with real Rapier bodies, static/hull sweeps, weapon
activation, damage and KO. Classic runs the shipping battle rules on Rookie
Ring's actual terrain and colliders. Raised runs the actual elevated combat
authority on Alpine Courtyard's seven-meter deck, with its real colliders.
Raised inventory comes from deterministic seed search and actual crate pickup.
Classic inventory is a declared test fixture. Each run spends exactly one full
pickup; it never grants more ammo during the measurement.

Both drivers receive throttle. Controlled body corrections advance them slowly
while keeping contact despite knockback. Trap victims instead cross the drop
trail at 5m/s. Projectile targets stand in each weapon's path; Classic Frost
uses an 18m target because its lob detonates farther ahead than elevated Frost.
These are repeatable authority measurements, not natural player chase times or
visual/browser evidence. Timings start at activation and stop on first KO, or
at ten seconds. `No KO` means this one pickup does not remove all three hearts.

The same harness was run against the original HEAD files and the fixed files.
The normal regression failed against HEAD at the blade 3–6 second KO assertion.
It passes with the fix. It also checks independent targets, minimum hit spacing,
cover, vertical separation, spawn protection, owner immunity, life changes,
fresh pickups and ledger cleanup. The existing blade respawn test remains,
with its first observation moved before the newly allowed second hit.

## Before / after

Hits / damage count landed hit events and hearts removed. Every row starts at
three hearts. Other weapons retain their old numbers.

| Map | Weapon | Before hits / damage | After hits / damage | Before KO | After KO |
| --- | --- | --- | --- | --- | --- |
| Rookie Ring | machinegun | 1 / 1 | 1 / 1 | No KO in 10s | No KO in 10s |
| Rookie Ring | trishot | 1 / 1 | 1 / 1 | No KO in 10s | No KO in 10s |
| Rookie Ring | mine | 3 / 3 | 3 / 3 | 1.183s | 1.183s |
| Rookie Ring | oil | 2 / 2 | 2 / 2 | No KO in 10s | No KO in 10s |
| Rookie Ring | boomerang | 1 / 1 | 1 / 1 | No KO in 10s | No KO in 10s |
| Rookie Ring | missile | 1 / 2 | 1 / 2 | No KO in 10s | No KO in 10s |
| Rookie Ring | cannon | 1 / 2 | 1 / 2 | No KO in 10s | No KO in 10s |
| Rookie Ring | blades | 1 / 1 | 3 / 3 | No KO in 10s | 4.100s |
| Rookie Ring | frost | 1 / 1 | 1 / 1 | No KO in 10s | No KO in 10s |
| Rookie Ring | thunder | 1 / 1 | 1 / 1 | No KO in 10s | No KO in 10s |
| Rookie Ring | ram | 1 / 1 | 1 / 1 | No KO in 10s | No KO in 10s |
| Rookie Ring | supernova | 1 / 2 | 1 / 2 | No KO in 10s | No KO in 10s |
| Rookie Ring | nuke | 1 / 3 | 1 / 3 | 2.517s | 2.517s |
| Alpine Courtyard (7m deck) | machinegun | 1 / 1 | 1 / 1 | No KO in 10s | No KO in 10s |
| Alpine Courtyard (7m deck) | trishot | 1 / 1 | 1 / 1 | No KO in 10s | No KO in 10s |
| Alpine Courtyard (7m deck) | mine | 3 / 3 | 3 / 3 | 1.200s | 1.200s |
| Alpine Courtyard (7m deck) | oil | 2 / 2 | 2 / 2 | No KO in 10s | No KO in 10s |
| Alpine Courtyard (7m deck) | boomerang | 1 / 1 | 1 / 1 | No KO in 10s | No KO in 10s |
| Alpine Courtyard (7m deck) | missile | 1 / 2 | 1 / 2 | No KO in 10s | No KO in 10s |
| Alpine Courtyard (7m deck) | cannon | 1 / 2 | 1 / 2 | No KO in 10s | No KO in 10s |
| Alpine Courtyard (7m deck) | blades | 1 / 1 | 3 / 3 | No KO in 10s | 4.100s |
| Alpine Courtyard (7m deck) | frost | 1 / 1 | 1 / 1 | No KO in 10s | No KO in 10s |
| Alpine Courtyard (7m deck) | thunder | 1 / 1 | 1 / 1 | No KO in 10s | No KO in 10s |
| Alpine Courtyard (7m deck) | ram | 1 / 1 | 1 / 1 | No KO in 10s | No KO in 10s |
| Alpine Courtyard (7m deck) | supernova | 1 / 2 | 1 / 2 | No KO in 10s | No KO in 10s |
| Alpine Courtyard (7m deck) | nuke | 1 / 3 | 1 / 3 | 0.450s | 0.450s |

Blade hit times on both maps: before `0.017s`; after `0.017s`, `2.017s`,
`4.100s`. The small delay on the third hit is the orbit reaching the hull again.

## Validation

The regression is included beside `kart-combat-mechanics.mjs` in the main
`test` script and `test:kart-health`.

Final results:

- 107 automatic `test/kart-*.js` / `.mjs` programs pass, including the separate
  all-map production transport workload. The first view run exceeded the local
  runner's 180-second limit; its complete rerun passed with more time.
- All 18 named kart npm test scripts pass, including `test:kart-elevation`,
  `test:kart-arsenal`, `test:kart-road`, `test:kart-payloads`, `test:kart-health`,
  `test:kart-events`, `test:kart-camera`, `test:kart-warmup` and the release suite.
- Four browser/listening fixture programs return HTTP 200 on spare 8260+ ports.
  These are service smoke checks, not claims of manual visual acceptance.
- The actual 32-driver browser test passes on Rookie Ring and Garden Circuit.
  Garden: 32 connected, 15.7m driven, 30.3 binary frames/s, 56.3 rendered frames/s,
  no page/console errors. It used installed Chrome with Metal GPU rendering via
  `KART32_BROWSER` and temporary Playwright tooling through `NODE_PATH`.
- The new regression fails against the original HEAD and passes with the fix.
  No client effect source was changed; no generated `public/release.json` remains.

Environment: Node 24.21.0 and Rapier 0.21.0. The full non-kart `npm test` chain
was not run.

The older all-map transport workload needed test-only maintenance: acknowledge
readiness, send Classic's nested input format with sequence/life tokens, and
allow its configured 60-second round to finish (the old timeout was 40 seconds).
With those corrections, all nine maps / 72 WebSocket seats pass, with measured
maximum speeds from 19.7 to 36.7m/s. No gameplay rule was changed for this test.
The private-status budget test also configured 60 seconds but advanced only
35 seconds; its pump limit now includes the full round and countdown. It passes
for both full and compact private views across neutral, driving and nitro runs.
The 32-driver browser workload's fixed forward route could stop at authored
cover near its Garden spawn. It now backs out with actual keyboard input if
it has not travelled five meters after six seconds. Movement, connection,
packet and page-error assertions remain unchanged; no poses are injected.
