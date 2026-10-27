# Castle Guide — deriving a game from the build-battle engine

The build-battle engine (`games/engines/build-battle.js`) owns every rule
for team build-then-siege games: team assignment, phased timers, shared
resources, zoned building, seeded objectives, cover/ward/boost defense,
unlocks, server-resolved siege shots, scoring, replay safety, and
spectator views. A new game is **one config object** — no rule code.
`games/castle-clash/server.js` is the reference; it holds data only.

## Derive another game in 4 files

1. `games/<id>/server.js` — config + delegation:

```js
'use strict';
const { createBuildBattle } = require('../engines/build-battle');
const id = '<id>';
const game = createBuildBattle({
  contentId: '<id>',               // ctx.content lookup (team names)
  teamNames: ['Sky', 'Stone'],     // fallback if locale lacks teamNames
  arena: {
    cols: 6, rows: 6,
    zones: {
      red: { x0: 0, y0: 0, x1: 2, y1: 5 },   // left half builds here
      blue: { x0: 3, y0: 0, x1: 5, y1: 5 },  // right half builds here
    },
  },
  pieces: {                        // fort parts: cost / hp / unlock / levels
    hut: { cost: 5, hp: 10, unlockAt: 0, maxLevel: 3 },          // +ward/boost/coverWeight optional
    bunker: { cost: 30, hp: 90, unlockAt: 40, maxLevel: 1, ward: 0.1, coverWeight: 2 },
  },
  weapons: {                       // siege arms: damage / cooldown / unlock
    sling: { damage: 4, cooldownMs: 500, unlockAt: 0 },
    mortar: { damage: 50, cooldownMs: 15000, unlockAt: 100 },
  },
  economy: {
    startResources: 50, maxResources: 80, refundRate: 0.25,
    destroyBonus: 5, resourceName: 'scrap', pointsName: 'glory',
  },
  // Optional objective/base (omit for legacy empty-skip behavior):
  objective: {
    piece: 'core', hp: 60, destroyBonus: 40, surviveRate: 0.25,
    // positions: { red: {x,y}, blue: {x,y} }, // else auto back-zone cell
  },
  defense: {                       // deterministic, server-resolved
    coverPerAdjacent: 0.1, maxCover: 0.4, maxWard: 0.25, maxBoost: 0.3,
  },
  phases: { buildMs: 30000, siegeMs: 20000 },  // defaults (settings win)
  rounds: 1,
  bounds: {                        // clamps for the manifest settings below
    buildSeconds: { min: 10, max: 60 },
    siegeSeconds: { min: 10, max: 60 },
    rounds: { min: 1, max: 3 },
  },
  winBonus: 20,
});
const manifest = {
  name: 'Sky Bastion', tagline: '…', howto: '…',
  cat: 'board', renderer: 'dom', realtime: false,
  players: { min: 4, max: 8 },
  settings: [
    { key: 'buildSeconds', label: 'Build time (seconds)', type: 'int', min: 10, max: 60, def: 30 },
    { key: 'siegeSeconds', label: 'Siege time (seconds)', type: 'int', min: 10, max: 60, def: 20 },
    { key: 'rounds', label: 'Rounds', type: 'int', min: 1, max: 3, def: 1 },
  ],
  art: 'img/games/<id>.svg',
};
module.exports = { id, minPlayers: 4, maxPlayers: 8, manifest,
  create: game.create, onAction: game.onAction,
  view: game.view, dispose: game.dispose };
```

Rules you get for free (identical for every config): 1v1–4v4 stable
teams, 45s-style build→siege timers (or your defaults), shared bounded
piles, own-zone-only atomic build/upgrade/teardown with nonce replay
protection, unlocks at point thresholds, cooldown-gated server-resolved
shots, exactly-once round transitions, disconnect-proof timers, and
spectator-safe views. Setting keys MUST be `buildSeconds` /
`siegeSeconds` / `rounds` — the engine reads those names.

Objective + defense (when `objective` is set): each team is seeded one
base per round at your `positions` (validated in-zone) or an automatic
back-zone cell. It is never buildable, removable, refundable, or
upgradeable, and always attackable in siege — empty forts cannot hide.
Damage is `floor(base * (1+boost) * (1-ward) * (1-cover))`, min 1, with
no redirection: `cover` counts 8-neighborhood friends around the
objective (`coverPerAdjacent` x `coverWeight`, capped at `maxCover`);
`ward`/`boost` sum surviving-piece auras (capped at `maxWard`/`maxBoost`).
Killing the foe objective pays `destroyBonus` plus an instant round end;
each surviving objective pays `floor(hp * surviveRate)` at round end.
Teardown never mints points. Omit `objective` for the legacy variant
(empty siege skips, no survival pay) — see `test/build-battle.js` CFG_B.

Castle Clash's current numbers (kept in sync with
`games/castle-clash/server.js`): Core 100 HP, 45s build / 45s siege,
100 starting bricks. Cover is weighted by adjacent structure — wall 1,
tower 2, cannon 1, keep 3 — at 15% per weight, capped at 80%; ward sums
tower 0.10 + keep 0.15 auras, capped at 30%. A guarded Core can still be
hit directly, damage only reduced, and every shot hits the tapped cell —
so clearing guards first often beats a core rush. Fire arrows (6 dmg /
2s) trade punch for speed against catapults (12 / 3s) and trebuchets
(30 / 6s). Unlocks stretch across rounds as crews earn authority: cannon
at 120, trebuchet at 300, keep (45 bricks, durable 3-weight cover) at
600; not every game reaches them all.

2. `locales/en/<id>.json` — needs `teamNames` (≥2) plus enough entries
to clear the ≥20 content bar, e.g. build tips:
`{"teamNames":[…],"tips":[…]}`.
3. `public/img/games/<id>.svg` — small self-authored thumbnail.
4. `public/js/games/<id>.js` — your own UI (bespoke playfield allowed).
Import the shared geometry from `../engines/build-battle-view.js`
(`zoneCells`, `gridMap`, `hpBand`, `hpPct`, `cooldownLeft`,
`pieceGlyph`, `weaponGlyph`) so the layout follows YOUR arena config
instead of hardcoding castle-clash's. Server view fields to render:
`phase/round/rounds/endsAt/myTeam/teams/grids/arena/catalog/economy/
objective/objectives/auras/cooldowns/log/scores/result`
(`objective` is the config incl. `defense`; `objectives` carries live
`hp/cover/coverCount` per team; `auras` carries live `ward/boost`).
Render the rules from the snapshot (never hardcode numbers), show both
remaining core HP bars, and surface `hit/destroy/corefall/survive/unlock`
log entries (`cover/ward/boost` modifiers plus `unlockKind/unlockId/at`)
as feedback. For a DOM board or fallback, cells should be
≥44px (`min-width/min-height:44px`, columns `minmax(44px,1fr)`) inside
their own `.cc-gridwrap{overflow-x:auto}` so narrow phones scroll the
grid, never the document; arrow keys move between cells, Enter fires,
Esc resets. A 3D view supplies its own raycast/camera and accessible targeting; the DOM grid is optional. Mutations are
`{build:{piece,x,y,nonce}}`, `{upgrade:{x,y,nonce}}`,
`{teardown:{x,y,nonce}}`, `{fire:{weapon,x,y,nonce}}` (mint a fresh
nonce per tap; the server ignores replays and any `teamId` you send).

No registry edit: manifest-bearing games are auto-discovered. Then run
`npm run check-game -- <id>` and add a `test/<id>.js` beside it.

## Castle Clash's 3D view

Castle Clash ships a perspective Three.js battlefield: raised forts, walls,
towers, cannons, keeps, crystal cores, camera orbit/zoom, raycast placement,
and projectile/destruction effects. The game owns its full viewport and
parchment/teal/coral HUD. The platform's room, invitation, sound, theme,
host controls, and night scores remain in a compact room drawer.

The manifest declares `renderer: '3d', layout: 'immersive'`. Renderer and
layout are separate choices: DOM and canvas games can also own an immersive
layout, while a 3D game can choose standard room chrome. Shared text-game
styles only apply to the standard layout. New games can use their own
camera, HUD, styling, and input without adopting Castle's composition.

`public/js/engines/castle-scene.js` renders the existing server snapshots.
Its `createCastleScene(mount, {onCell, onHover, onUnavailable})` handle has
`update(snapshot, selection)`, `focus(teamOrNull)`, `resetCamera()`, and
`dispose()`. It never decides damage, resources, timers, or scoring. The
reference scene models Castle's wall/tower/cannon/keep/core catalog; other
piece catalogs can supply their own meshes or a different renderer.

Reuse `createThreeView` for the pinned vendor/GL lifecycle and
`createArenaControls` for orbit, wheel/pinch zoom, hover picking, and
true taps. A drag or pinch never sends a build/fire action. The game HUD
revalidates every action against the latest snapshot and calibrated clock.
Keyboard targeting and the explained 2D fallback remain available when
WebGL is unavailable (`?nowebgl=1` can exercise the fallback).

Accepted shot logs carry server-assigned per-instance monotonic `id`,
`when`, and `victimTeam`. Baseline the first/reconnected snapshot, animate
new events once, and reset the event cursor when `instanceId` changes.
Particle/projectile pools and the local vendor keep the view bounded.

The rules remain a strategy game on discrete plots; free-roaming avatars,
3D collision physics, and direct aiming are separate future mechanics.
Core destruction intentionally ends a round early. An untouched battle
ends on its server deadline; the result screen hides the expired timer.

## Call the engine standalone (tests, probes)

```js
const { createBuildBattle } = require('./games/engines/build-battle');
const game = createBuildBattle(require('./games/castle-clash/server.js').CASTLE_CONFIG);
const ctx = {
  players: () => roster.filter(p => p.online), allPlayers: () => roster,
  content: (id) => localePacks[id] || {}, settings: () => ({}),
  hostId: () => roster[0].id, broadcast: () => {}, lobby: () => {},
  later: (ms, fn) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
  award: (pid, pts) => { totals[pid] = (totals[pid] || 0) + pts; },
  now: () => Date.now(),
};
const state = game.create(ctx);            // build phase, teams assigned
game.onAction(state, ctx, pid, { build: { piece: 'wall', x: 0, y: 0, nonce: 'n1' } });
const snapshot = game.view(state, pid);    // per-player projection
game.dispose(state);                       // cancels the pending timer
```

See `test/build-battle.js` for the full stub (manual timer firing,
all three config variants: legacy A, generic B, objective C) — that
file is the executable contract. Mandatory coverage lives there and in
`test/castle-clash.js`: no-build-no-score exploit fixed, defense helps,
corekill + survival matter, forged objective remove denied, no double
finish/reward, generic variant unaffected, earned unlocks logged once
(starters silent).

## Supply races and build orders (0.1.5)

During building, a chest appears on each team's fort every 8 seconds. Claim it before the next drop for 15 shared bricks and 4 authority. The claim button works in both 3D and the canvas-free fallback, using the same server clock and once-only claim validation. Teammates share the reward; expired or duplicated claims never pay twice.

Each round offers three orders: build on four distinct plots, place two towers, and upgrade two pieces. Completed orders pay 8/10/8 authority once. Removing and rebuilding the same plot cannot farm orders. Authority and unlocks carry forward while each new round starts a fresh fort and order sheet.

The first-match guide introduces supplies, defenses, siege targeting and unlocks. A rejected local target gives visible feedback. Siege weapon buttons show reload progress; target feedback explains whether defenders still cover the Core. The HUD keeps supplies clear of camera menus and puts feedback above the toolbelt.
