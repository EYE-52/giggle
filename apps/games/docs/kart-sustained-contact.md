# Pocket Karts sustained-contact balance

Measured on 2026-11-09 in the `kart-blades` worktree.
Before means commit `ce0086e`: blades already fixed, rapid fire still limited to
one heart per target per pickup. After means this follow-up balance change.

## Cause and balance

Both combat authorities used the permanent per-volley target set for machinegun
and trishot. One landed bullet or pellet removed one heart; every later round
from the same pickup was ignored. This is the same limit removed from blades
in the previous change. Collision radius, height and spawn shields were not
responsible for the missing damage.

Machinegun and trishot now use the volley's private per-target hit history:
first vulnerable impact deals one heart immediately, and another landed impact
can deal one heart after at least 1.0 simulation second. Ignored contacts do not
restart that clock. All three pellets in one trishot share the cooldown. Targets
and pickups have independent histories. A volley cannot damage a new life after
respawn; its history is released when the loaded clip and flying shots retire.
Owner immunity, cover, full-height sweeps, Supernova blocks and spawn protection
remain in front of the damage gate. No history is added to public snapshots.

To make a full burst capable of three hearts, its shots must span at least two
seconds. The old clips could not do that: 24 machinegun rounds span 1.917s at
12 rounds/s, and three trishot volleys span 0.560s at one volley every 0.28s.
Firing rates, projectile speeds, spread and one-heart damage stay unchanged.
Machinegun now has 30 rounds (2.417s); trishot has nine triple volleys (2.240s).
This keeps the requested one-second damage window rather than shortening it to
fit the old clips. A single accepted press still commits only one finite pickup.

Blades remain one heart per target every two seconds for six seconds, with a
measured 4.100s KO. Missile, cannon, thunder, frost, supernova, nuke, boomerang,
ram, mine and oil retain their previous damage and payload rules. The full table
below is unchanged for every weapon except machinegun and trishot.

## Reproduce and regression

From `apps/games`:

```sh
node test/kart-sustained-contact.mjs
node test/kart-sustained-contact.mjs --measure-only
```

The harness runs at 60Hz with real Rapier bodies and actual combat authorities.
Classic uses Rookie Ring terrain and colliders; raised uses Alpine Courtyard's
real seven-meter deck and colliders. Classic inventory/body placement is a
declared fixture. Raised inventory comes from deterministic seed search and a
real crate pickup. Both drivers receive throttle; controlled body corrections
hold contact/aim despite knockback. Trap victims cross the real drop trail at
5m/s. Classic Frost uses an 18m target because its lob travels farther than the
raised variant before detonating. Each measurement spends exactly one pickup.

Times start at activation, stop on first KO, and are capped at ten seconds.
These are deterministic authority timings, not natural chase or network times.
Hits are landed hit events; damage is total hearts removed from the initial
three-heart life. No extra ammo is granted during any measurement.

The extended regression fails on `ce0086e` at the full rapid-fire burst KO
assertion and passes with this change. It checks all thirteen weapons on both
maps; rapid-fire KO timing and one-second minimum hit spacing; simultaneous
pellets; staggered target cooldowns; owner immunity; protected spawns; life
changes; fresh pickups; and cleanup of completed volley history. The prior
blade cover, vertical separation, protection and lifecycle checks remain.
The regression remains in the main `test` script and `test:kart-health`.

## Before / after

| Map | Weapon | Before hits / damage | After hits / damage | Before KO | After KO |
| --- | --- | --- | --- | --- | --- |
| Rookie Ring | machinegun | 1 / 1 | 3 / 3 | No KO in 10s | 2.067s |
| Rookie Ring | trishot | 1 / 1 | 3 / 3 | No KO in 10s | 2.333s |
| Rookie Ring | mine | 3 / 3 | 3 / 3 | 1.183s | 1.183s |
| Rookie Ring | oil | 2 / 2 | 2 / 2 | No KO in 10s | No KO in 10s |
| Rookie Ring | boomerang | 1 / 1 | 1 / 1 | No KO in 10s | No KO in 10s |
| Rookie Ring | missile | 1 / 2 | 1 / 2 | No KO in 10s | No KO in 10s |
| Rookie Ring | cannon | 1 / 2 | 1 / 2 | No KO in 10s | No KO in 10s |
| Rookie Ring | blades | 3 / 3 | 3 / 3 | 4.100s | 4.100s |
| Rookie Ring | frost | 1 / 1 | 1 / 1 | No KO in 10s | No KO in 10s |
| Rookie Ring | thunder | 1 / 1 | 1 / 1 | No KO in 10s | No KO in 10s |
| Rookie Ring | ram | 1 / 1 | 1 / 1 | No KO in 10s | No KO in 10s |
| Rookie Ring | supernova | 1 / 2 | 1 / 2 | No KO in 10s | No KO in 10s |
| Rookie Ring | nuke | 1 / 3 | 1 / 3 | 2.517s | 2.517s |
| Alpine Courtyard (7m deck) | machinegun | 1 / 1 | 3 / 3 | No KO in 10s | 2.050s |
| Alpine Courtyard (7m deck) | trishot | 1 / 1 | 3 / 3 | No KO in 10s | 2.350s |
| Alpine Courtyard (7m deck) | mine | 3 / 3 | 3 / 3 | 1.200s | 1.200s |
| Alpine Courtyard (7m deck) | oil | 2 / 2 | 2 / 2 | No KO in 10s | No KO in 10s |
| Alpine Courtyard (7m deck) | boomerang | 1 / 1 | 1 / 1 | No KO in 10s | No KO in 10s |
| Alpine Courtyard (7m deck) | missile | 1 / 2 | 1 / 2 | No KO in 10s | No KO in 10s |
| Alpine Courtyard (7m deck) | cannon | 1 / 2 | 1 / 2 | No KO in 10s | No KO in 10s |
| Alpine Courtyard (7m deck) | blades | 3 / 3 | 3 / 3 | 4.100s | 4.100s |
| Alpine Courtyard (7m deck) | frost | 1 / 1 | 1 / 1 | No KO in 10s | No KO in 10s |
| Alpine Courtyard (7m deck) | thunder | 1 / 1 | 1 / 1 | No KO in 10s | No KO in 10s |
| Alpine Courtyard (7m deck) | ram | 1 / 1 | 1 / 1 | No KO in 10s | No KO in 10s |
| Alpine Courtyard (7m deck) | supernova | 1 / 2 | 1 / 2 | No KO in 10s | No KO in 10s |
| Alpine Courtyard (7m deck) | nuke | 1 / 3 | 1 / 3 | 0.450s | 0.450s |

Landed hit times:

| Weapon | Rookie Ring | Raised deck |
| --- | --- | --- |
| Machinegun | 0.050, 1.067, 2.067s | 0.050, 1.050, 2.050s |
| Trishot | 0.083, 1.217, 2.333s | 0.083, 1.217, 2.350s |
| Blades | 0.017, 2.017, 4.100s | 0.017, 2.017, 4.100s |

The firing cadence, projectile flight and fixed-step rounding can delay the
next landed hit beyond the minimum cooldown; they never shorten it.

## Follow-up validation

Node 24.21.0, Rapier 0.21.0. All root kart programs and all 18 named kart npm
scripts were attempted against this follow-up, with fresh logs under
`/tmp/kart-rapid-tests`. Results from the previous commit are not counted.

- 102 automatic kart files pass, including all real-simulation, combat,
  protection, payload, health, private-status-budget, terrain and view checks.
- 13 kart npm groups pass. Five groups cannot complete because their local
  server must listen: release, elevation, arsenal, events and 32-driver browser.
- Four standalone transport programs cannot start their local server.
- All four listening/browser fixtures fail to bind ports 8260–8263, and the
  separate all-map acceptance workload cannot connect on 8265.
- These blocked programs report `EPERM: operation not permitted` for local
  `listen`/`connect`. A direct bind to unused port 8260 is also denied by the
  current session sandbox. No test assertion was removed to bypass this limit.
- Old clip-size and one-heart-only expectations were updated. Their five
  initially failing simulation files pass on complete reruns.
- The new regression is confirmed to fail before and pass after this change.
  `git diff --check` passes. Client effect files were not changed, and no
  generated `public/release.json` remains. The full non-kart test chain was not run.

## Commit status

This follow-up is not committed. `git add` is denied while creating
`/Users/divyansh/Projects/giggle/.git/worktrees/kart-blades/index.lock`
(`Operation not permitted`), so the requested commit cannot run in this sandbox.
The changes remain in this worktree. A reviewable patch is saved at
`/tmp/kart-rapid-change.patch`; the prepared commit message is
`/tmp/kart-rapid-commit.txt` and ends with the requested Co-Authored-By line.
Nothing was pushed or deployed. Completing the socket checks and commit requires
a session that permits local sockets and writes to this worktree's Git metadata.
