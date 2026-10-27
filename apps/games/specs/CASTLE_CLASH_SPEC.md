# Castle Clash — game specification

Status: released, 6 October 2026. Quality evidence is recorded separately from requirements.

## Product and ownership

An original 3D team siege for **2–8 players**, from 1v1 through 4v4. Additional friends can watch. The platform provides room links, identity, hosting, reconnects, cumulative Night totals and optional Giggle Meet video/voice. The game owns its scene, controls, HUD and rules. It must remain playable independently of a call.

Construction uses an 8×8 field with two 8×3 fort zones. This release supports placing, upgrading and removing defined structures. Free-form custom blocks are a future extension; this release does not implement them.

## Complete play loop

1. Open the game page or a catalog card. Read rules, then Play or Customize. Create/join a room and invite another player.
2. The host starts. Deal stable alternating teams; late arrivals watch until the next match. Preserve teams through reconnects and rounds.
3. Build: each crew shares 100 starting bricks. Place walls/towers in its own fort, strengthen them or reclaim half their cost. Show Core protection and affordable choices immediately.
4. Siege: select a weapon and tap an enemy structure. Every shot hits the selected cell. Damage and destruction earn shared authority. Clearing guards should be a useful alternative to hammering a protected Core.
5. A destroyed Core ends that round early, with an explicit explanation. Otherwise the server deadline ends the siege and surviving Cores earn authority.
6. Authority unlocks stronger tools for later rounds. Highest accumulated match authority wins; ties share the crown. Label the winner bonus separately and explain that Night totals accumulate across games.
7. Host Rematch starts a fresh instance with clean inputs/view history. Change game returns the same room to the catalog. Guests see who can act.

Default match: **3 rounds**, each **45 seconds build + 45 seconds siege**. Customization: 1–5 rounds, 15–120 seconds for each phase; settings apply to the next match and its rematches.

## Structures and economy

| Structure | Brick cost | HP | Adjacent Core cover weight | Effect | Authority required |
| --- | ---: | ---: | ---: | --- | ---: |
| Wall | 10 | 30 | 1 | Basic cover | 0 |
| Tower | 25 | 60 | 2 | +10% fort ward | 0 |
| Cannon | 40 | 50 | 1 | +15% attack boost | 120 |
| Keep | 45 | 120 | 3 | +15% fort ward | 600 |
| Core | Cannot buy/move/sell | 100 | — | Defend this objective | — |

- Core cover: 15% per adjacent weight, capped at 80%.
- Fort ward: capped at 30%. Attack boost: capped at 30%.
- Maximum structure level: 2. Upgrades increase health; the Core cannot upgrade.
- Shared bricks: maximum 200. Own teardown refunds half the invested brick cost and earns no authority.
- Damage earns authority. Destroying an **enemy structure** grants another **10 authority**, rather than bricks.
- Destroying a Core grants 60 authority. A surviving Core earns half its remaining HP as authority. Winner/tie bonus: 50 per winning crew.
- All home-page copy, hints, tool labels and rules must agree with the configuration.

| Weapon | Base damage | Reload | Authority required |
| --- | ---: | ---: | ---: |
| Catapult | 12 | 3 seconds | 0 |
| Fire arrow | 6 | 2 seconds | 0 |
| Trebuchet | 30 | 6 seconds | 300 |

Keep deliberate weapon selection through reload; never silently switch weapons. Locked tools must say Locked, and cooling tools must show reload feedback. Rejected targets spend neither resources nor cooldown.

## Balance requirements

A guarded fort must survive direct starter-weapon spam long enough for a tactical choice. Legal 1v1 and 2v2 virtual-clock probes must show that clearing guards can breach sooner or earn more authority. Starter weapons must permit progress; surviving a fortified duel is an intentional authority outcome, not a soft lock. A first-round win must not unlock the entire arsenal. Team spending must be atomic when teammates act together.

## Scene and controls

Independent natural sunset valley: faceted mountains at the edges, gradient sky, evergreens, turquoise river, cool stone forts, coral/mint teams. Bright enough to identify every valid plot. Compact dark edge HUD; the battlefield remains the primary surface.

- One timer, both Core HP bars, cover/ward, bricks and authority. Action prompt follows status without overlap.
- Bottom toolbelt shows selection, cost/reload and lock requirements. Help, rules/log, keyboard targeting and camera choices live in compact drawers.
- Build frames your own fort from its outer edge. Siege frames the enemy fort. Both teams must have equally usable views.
- Drag rotates; wheel/pinch zooms; a tap acts exactly once. A drag never builds or fires. Camera movement never spends resources.
- Tall structures cannot permanently hide a plot: orbit and keyboard targeting remain available.
- Verify 1280×720 desktop and 360×780 portrait without page overflow or obstructed controls. Minimum touch targets: 44px. Respect safe areas and reduced motion.
- Results hide the timer, stale action hints and tool rack. Rematch controls remain accessible.

## Framework, fairness and lifecycle

The shared build-battle engine owns authority. Clients send validated build/upgrade/teardown/fire intents, with instance/phase stamps and unique action nonces; never accept client team claims or scores. Check resources, zones, locks and phases atomically. Award destruction/survival/results exactly once. A stale action from another phase or rematch cannot apply.

Calibrated server time drives phase deadlines and cooldowns. Peers must agree on phase/end time. Reconnects retain identity/team/history without replaying combat effects. Rematches reset the renderer baseline. Dispose inputs, timers, frames and GPU assets. Bound projectile/debris/effect pools and DPR. If WebGL is unavailable or lost, show an honest working 2D fallback on the same snapshots and rules, including the same result reasons.

## Acceptance gates

- Engine: minimum two, shared-brick races, wrong-zone/forged-team rejection, stale actions, exact-once refunds/awards, 1v1/2v2 strategy and unlock pacing.
- View: reload expiry, sticky selection, locked-state honesty, both camera directions, rematch/reset, done-state cleanup, fallback reasons and score scope.
- Browser: game page → customization → two peers → pointer build → upgrade/teardown → siege/fire → synchronized result → rematch → change game.
- Also verify crews, watchers/reconnects, portrait, drag/zoom, keyboard access, WebGL fallback and console errors. Save real screenshots; rerun affected gates after fixes.
- Full repository checks and a clean install/build must pass before matching frontend/backend deployment. Repeat hosted smoke tests and browser entry.

Release requires no unresolved reproducible defect in these gates. Passing checks is evidence, not proof that no possible bug exists.

## Release evidence — 6 October 2026

Muse Spark 1.3 Contributor MAX worked from this specification and iterated against root QA. Root independently completed rendered multiplayer checks, added regressions for discovered defects, and passed a clean install, the full repository test suite and build. Matching frontend/backend versions are live at https://play.gigglemeet.com/. Hosted smoke covers all 37 games; deeper two-player checks cover Castle and both kart modes, including stopped clocks and clean rematches. Detailed outcomes, screenshots, scope and logs are retained in `releases/2026-10-06-game-quality/QA.md` and its `evidence/` folder. Passing checks is evidence within this scope, not an absolute zero-bug guarantee.
