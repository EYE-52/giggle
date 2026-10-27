# Game Guide — adding a game to Game Night

Each game starts with three base files and discovers automatically. It may add
scoped styles, original artwork or attributed data for its own interface.

## Files (replace `<id>` with your game id, e.g. `trivia`)

1. `games/<id>/server.js` — CommonJS, server-authoritative logic.
2. `public/js/games/<id>.js` — ES module, default export view (see below).
3. `locales/en/<id>.json` — content pack (prompts, words, questions…).

Scaffold them with `npm run new-game -- <id>` (safe ids only:
lowercase letters/digits/dashes; never overwrites), then check your game
with `npm run check-game -- <id>`. New manifest-bearing games are
discovered automatically — no registry/shell edits needed.

**Hard rules**

- Start with these three files. Add game-owned styles/assets/data when needed;
  For module views, scope CSS to the game's root so it cannot change another
  playfield. Frame games have a separate document and unrestricted own styles.
  Toolkit and engine factories are optional. Do not edit another game's files or
  copy transport/rooms into a game. Registry, server and shell changes belong
  to coordinated framework batches; discovery requires no such edit.
- Browser games may use any browser-compatible engine or bundler: React,
  Phaser, Babylon, Three, WebGPU, WebAssembly or compiled engine exports.
  Put the finished export under `games/<id>/browser/` and opt into
  `manifest.runtime` (see `GAME_AUTONOMY_GUIDE.md`). No default export,
  framework CSS or prescribed game markup is required for this path.
  Module views remain available; the shipped Three helper is optional.
  Server dependencies are reviewed and pinned separately by the checker;
  this does not select or restrict the browser renderer.
- Escape every player-controlled string with `esc()` before injecting HTML.
- All user-facing game strings must come from the locale JSON via
  `ctx.content('<id>')` (server) — never hardcode English in game logic,
  so culture packs can swap in later. Client chrome may use minimal
  English (buttons like "Next"); game content never.
- Content bar: ≥20 quality entries per content game (prompts, questions,
  dares…), varied, no repeats-in-spirit, family-friendlier than not.
- Timers: server-side only, via generation/window-guarded `ctx.later(ms, fn)`.
  Client `endsAt` rendering is display-only, using calibrated `api.now()`.
  A view with its own clock/HUD exports `ownsTimer: true`; otherwise the shell
  draws the timer. Clear `endsAt` and explain the reason when a round ends early.

## Server module

```js
'use strict';
const { dealer, tally, allIn, shuffle } = require('../_sdk');
const id = '<id>';

const manifest = {
  name: 'My Game',
  tagline: 'One-line hook',
  howto: 'How a round works.',
  cat: 'vote',            // vote|bluff|word|speed|draw|social|board|3d
  renderer: 'dom',        // descriptive technology label, never selects an engine
  realtime: false,
  players: { min: 3, max: 12 },
  settings: [             // room-scoped, host-set, optional
    { key: 'rounds', label: 'Rounds', type: 'int', min: 1, max: 12, def: 6 },
    // int{min,max,def} — def may be null for "auto" (plus autoLabel)
    // enum{options[],def} | bool{def}
  ],
  packs: {                // custom content, room override of locale pack
    words: { label: 'Custom words', type: 'string[]',
             minItems: 10, maxItems: 200, maxLen: 60 },
  },
};

function create(ctx) { /* return state; ctx.allPlayers() -> [{id,name}] */ }
function onAction(state, ctx, pid, a) { /* mutate state; broadcast is automatic */ }
function onTick(state, ctx) { /* optional, realtime games, 10 Hz */ }
function view(state, pid, ctx) { /* per-player projection; strip secrets + helpers */ }
function dispose(state) { /* optional server cleanup on game change */ }

module.exports = { id, minPlayers: 3, maxPlayers: 12, manifest,
  create, onAction, onTick, view, dispose };
```

Room passes the current game `ctx` to `view` and optional `viewForTransport`.
Two-argument views remain compatible. Host controls should project and check
`ctx.hostId()` so they follow Room election after a disconnect; a stored initial
host is only a fallback for isolated views without a Room context.

`ctx` offers: `players()` (the ACTIVE ROSTER's connected subset),
`allPlayers()` (the ACTIVE ROSTER: seats connected when the game
started, including currently-disconnected members who may resume —
never pre-start disconnects, never mid-game joiners), `content(gameId)`
(room pack override → locale pack → `{}`), `settings()` (ONLY host-set
values — `{}` when unconfigured, so keep your legacy defaults for
missing keys), `hostId()`, `broadcast()`, `lobby()`, `later(ms, fn)`
(auto-cancelled on phase change), `award(pid, points)` (adds to room
totals), `now()`.

Mid-game joiners are spectators: the server never routes their actions
to `onAction`, and they sit outside both `players()` and `allPlayers()`.
Seat-capped games (`manifest.seats`, e.g. chess) add roster watchers: seats
beyond the cap watch exactly like late joiners. Design `view()` so any
non-playing `pid` gets a safe watch-only projection (no secrets, no `myX`
fields set).

Conventions: `state.phase` string; `state.round/state.rounds`;
`state.endsAt` for the active timer; `state.scores` per-player game points;
`state.streaks` where streaks matter. Never leak secrets (votes, words,
roles) through `view()` — delete or mask them per `pid`. Validate every
action field (type + range + phase + turn) and ignore garbage silently.
Custom pack CONTENTS are never echoed to clients — only counts.

Reference implementations: `games/would-you-rather/server.js` (turn-based:
phases, hidden votes, majority scoring) and `games/doodle-guess/server.js`
(realtime: hidden word, streaming strokes, speed scoring, hints).
Customization reference: `games/charades/server.js` (settings + word pack).

## Client view

```js
import { esc, nameOf } from '../util.js';
export default {
  mount?.(el, api) {},      // once per mount: build DOM/canvas, listeners
  update?.(el, S, api) {},   // per snapshot: patch in place
  render?.(el, S, api) {},   // legacy: full render per snapshot (still supported)
  dispose?.(el) {},          // REQUIRED for canvas/3D: remove listeners
                             // (incl. window), cancel rAF, release GL
};
```

- `S`: `{...view(pid), game, instanceId, you, me, spectator, players, participants, spectators, totals}`.
  `players`/`participants` is the active roster; `spectators` lists
  watch-only late joiners; `spectator` is true when YOU are spectating
  (the shell disables your inputs — keep rendering a full watch view).
- `api`: `{send(a), lobby(), name(pid), focus(sel), announce(msg), now(),
  toolkit, voice}`. `now()` is the calibrated server clock (monotonic —
  use it for `endsAt`/`clockStamp`/cooldown display; all judging stays
  server-side). `toolkit` is the media factory exports (`createCanvasView,
  createInput, createSoundBank, createThreeView, createSessionToolkit`) —
  views choose pieces and dispose them; nothing mounts automatically.
  `voice` is the stable facade (`getStatus/subscribe/request`) over the
  shell's page-lifetime voice client (see `MEDIA_TOOLKIT_GUIDE.md`).
- If `update` exists the shell uses mount/update/dispose; otherwise it
  calls legacy `render` per snapshot (and `dispose` if present).
- The shell guarantees `dispose` runs on game change, lobby,
  rematch/restart (every start mints a new server `instanceId`, and ALL
  clients reset on it — not just the host), and room exit — but only if
  you export it. Track every listener you add (including `window`) and
  remove them all, and reset ALL module-level render caches
  (`lastKey`-style keys, drafts, timers) so a same-game restart in the
  same phase rebuilds instead of rendering blank.
- Keyboard: focus the primary input on mount (the shell focuses the first
  input for you on fresh mounts); Enter submits; Esc closes dialogs.
  Announce phase changes via `api.announce()`. Honor
  `prefers-reduced-motion` (no shake/particles/auto-camera when reduced).
- `render`/`update` run on every state snapshot — make them idempotent.
  Never store authoritative state client-side.
- Use existing CSS classes (`.card .btn .votebtns .voteopt .bar .fill
  .scoreboard .score .muted .row .toolbar .swatch canvas.doodle`); if you need
  a new class, reuse the sticker-party visual language (theme vars
  `--accent --sun --melon --teal`, ink `--edge` borders, hard offset
  shadows, 12–22px radii, pill buttons). Keep the existing party palette and
  provide readable Day/Night contrast. Game-owned layouts may differ completely.
  Theme-matching SVG reaction art and restrained emoji are welcome; keep text
  labels accessible and honor reduced motion.

## Board games (seats + watchers)

A board game hosts a whole party but plays with a few seats. Declare it in
the manifest — no lobby or shell special cases:

```js
manifest: {
  cat: 'board', renderer: 'dom',
  players: { min: 2, max: 24 }, // who may be in the room at start
  seats: 2,                     // who actually plays: first 2 roster seats
}
```

The framework takes the first `seats` roster seats (stable roster order) as
the ACTIVE roster: `ctx.players()`/`ctx.allPlayers()` return only them,
snapshots list them in `players`/`participants`, and everyone else lands in
`spectators` with `spectator: true` (their actions never reach `onAction`).
The catalog reads `2 play · watchers welcome`, the game header counts
active players and names watchers separately, and embedded presence reports
the same split. Design `view()` so a non-seat `pid` gets a full watch-only
projection. Reference: `games/chess/server.js` (white = active[0], black =
active[1], clocks, resignation) + `public/js/games/chess.js` (DOM board,
roving-tabindex arrows + Enter, promotion chooser, visual-only flip marked
`data-watchok` so watchers keep it while the shell disables the rest).

Rules libraries: hard game rules (chess legality) MUST come from a pinned
maintained package, never a hand-rolled engine. Shared dependencies are
approved per DEPENDENCY in `scripts/check-game.js` (pinned `chess.js`
1.4.0, enforced against the root `package.json`, usable by any game id —
see the `alt-board` fixture) — a game cannot approve itself, and anything
else is rejected. Node stdlib is allowed via `module.isBuiltin`.

## 3D games (Three.js, local vendor, 2D fallback)

Scaffold one with `npm run new-game -- <id> --renderer3d`, which generates
the sim/input skeleton plus a client on the shared helper:

```sh
npm run new-game -- orb-run --renderer3d
npm run check-game -- orb-run
```

Boundaries (enforced by review + `check-game`):

- SERVER owns the simulation: positions, pickups, scores, outcomes. It
  integrates small validated INTENTS (`{input:{steer,throttle}}`, numbers
  clamped, `NaN`/strings zeroed) on the 10 Hz `onTick`, and never trusts
  client coordinates — or client timestamps. Each intent is stamped with
  the server's receipt time and expires after 1.5 s of client silence
  (held inputs need the client's 500 ms keepalive); disconnects freeze at
  once with no pickups. Input-only intents return exactly `false` from
  `onAction` to skip the immediate broadcast — the tick broadcast carries
  them (legacy default keeps broadcasting).
- TIES share the win: every top scorer earns the win bonus equally (no
  first-seat bonus); results carry both `winner` (sole winner or null)
  and `winners[]`.
- CLIENT owns render + input: Three.js scene from snapshots, keyboard and
  touch intent mapping, snapshot interpolation. Sends intents on change +
  a slow heartbeat (≤2 Hz), nothing else.
- The shared helper owns GL lifecycle only: `public/js/renderers/three-view.js`
  (`createThreeView`) dynamic-imports the pinned local vendor build
  (`/vendor/three/three.module.js` + its sibling `three.core.js` — always
  served together via `npm run vendor`, MIT license alongside, zero network
  at play time), owns the canvas, frame loop, `ResizeObserver`, and full
  disposal (loop cancelled, listeners removed, geometries/materials/
  textures disposed, `WEBGL_lose_context`, canvas dropped).

Client rules: `mount` builds once, `update` patches per snapshot without
remounting, `dispose` releases everything (multiple restarts must not stack
canvases, loops, or listeners). Cap pixel ratio (~1.75), keep geometry
counts small, shadows off (blob shadows read fine). No game UI text inside
WebGL — HUD is DOM. Honor `prefers-reduced-motion` (snap camera, no spin/
orbit). Keyboard with focus guards (ignore typing targets + open dialogs;
clear on blur/hidden); touch via pointer capture with explicit
`pointerup`/`pointercancel`/`lostpointercapture` release.

Every 3D game ships a functional fallback: when WebGL is unavailable,
blocked, or the context is lost, run a 2D canvas (or DOM) view on the SAME
server snapshots, with an honest note plus Retry (retry re-attempts WebGL;
`?nowebgl=1` forces the fallback path for testing). No endless spinner or
blank panel. Reference: `games/pocket-karts/` + `public/js/games/pocket-karts.js`.

## Kart arena template (reusable engine, thin games)

Pocket Karts is built ON the shared kart-arena engine — not bespoke — and
new kart games reuse the same engine through a declarative config:

```sh
npm run new-game -- turbo-tots --template kart
npm run check-game -- turbo-tots
```

The scaffold is three thin files with no copied simulation or view
source: `games/<id>/server.js` (a config object handed to
`createKartGame`), `public/js/games/<id>.js` (a title handed to
`createKartView`), and an empty locale placeholder. Change the title,
default mode (`starrush`/`battle`), default map (`ring`/`blocks`), goals,
or palette by editing the config — the engine owns everything else.

Shared services (the engine owns these; games configure, never fork):
`games/engines/kart-engine.js` (10 Hz server sim, validated intents,
receipt-time TTL, disconnect freeze, countdown/drive/done, ties share
the win), `games/engines/kart-rules-*.js` (Star Rush + Zap Battle rule
modules), `games/engines/kart-maps.js` (map layouts, collision, spawn
spots — the snapshot carries `{map:{id,blocks}}` so clients never
duplicate geometry), `public/js/engines/kart-view.js` (Three.js arena,
2D fallback, HUD, keyboard + touch), `public/js/engines/kart-pose.mjs`
(prediction shared by both renderers). Server games may require ONLY
`../engines/*` in addition to the usual allowlist (`check-game`
enforces the path and that the file exists); same-game `./helper`
requires stay rejected, so thin games inline their config.

View autonomy + escape hatch: the factory is optional sugar, never a
restriction. A game may pass hooks (`buildKartMesh` for a game-owned
kart mesh with its nose at +z, `sceneExtra` for per-frame Three.js
overlays, `hudExtra` for game-owned DOM in `.pk-hud`), or skip the
factory entirely and ship bespoke HTML/CSS/canvas/Three.js against the
same snapshots — the mount/update/dispose lifecycle is unchanged, and
game-owned markup/styles/canvas are welcome. What stays shared even
for bespoke views: the intent shape, the snapshot shape, and the
steering convention (+steer = screen right under the chase camera;
forward is `(sin a, cos a)`; see `forwardOf`/`screenRightOf`).

Modes: the host picks Star Rush vs Zap Battle plus the arena map in the
room settings. Zap Battle is a bounded vertical slice: crates grant
zaps (start with 1, hold up to 3), the action button fires on a rising
edge (holding never auto-fires), hits stop victims and grant a brief
shield, obstacle blocks collide with karts and swallow zaps, and the
hits goal or timer decides tied-or-won like Star Rush. This template
proves ONE reusable arena works; it promises no plugin system, ECS,
editor, or no-code tooling.

## Camera template (reusable engine + renderer, thin games)

Pose Party and Show & Go are thin configurations of the shared
camera-party engine and renderer, and new camera games reuse both
through a scaffold:

```sh
npm run new-game -- lens-cheer --template camera
npm run check-game -- lens-cheer
```

The scaffold is three thin files with no copied rules or markup:
`games/<id>/server.js` (identity + manifest + one
`createCameraParty` call), `public/js/games/<id>.js` (stylesheet link
+ delegation to the shared renderer), and 24 locale prompts. The
video call is the playfield: the engine runs the perform → vote →
reveal loop with secret ballots and server deadlines, and nothing is
recorded. Switch `mode: 'spotlight'` to `'gallery'` for show-and-tell
rounds, or skip the shared renderer and ship bespoke markup against
the same snapshots — the lifecycle is unchanged. See
`GAME_KIT_GUIDE.md` for the portable kit (pack/install/import/create/
check outside this repo).

## Settings, packs, and catalog metadata (schema)

Manifest extras beyond the starter: `seats` (1..`players.max`, active-seat
cap), `communication` (`any`|`voice`|`video` — a catalog hint that a game
shines on a call, never a requirement; set it only when genuinely true, e.g.
Charades on video), and `art` (a safe local path `img/games/<id>.svg|png`
for a self-authored thumbnail; URLs and traversal are rejected). Keep
`cat`/`renderer`/`realtime` honest too: the embed child derives its
`social`|`board`|`immersive`|`balanced` presentation hint for the Giggle
parent from `communication`/`cat`/`renderer`/`realtime` only
(`public/js/embed.js` `presentationForGame`), never per-game ids. The
catalog shows `Customizable` for settings/packs, renderer tags (`3D`),
`Great on video` / `Voice recommended`, and seat lines — all derived from
this metadata, no per-game shell code. Write `howto` as the single
authoritative instructions: it renders sentence-split in the shared How to
play dialog (no per-game tutorial edits). Search covers name/tagline/
category; group filters derive from `players` + `seats` (everyone-plays
vs. players+watchers), so keep ranges honest — never invent tags, duration,
or popularity in the manifest.

## Assets and integration checklist

- No registry/shell edits for a new manifest-bearing game: discovery,
  catalog, customization dialog, rematch footer, and timers are generic.
- Thumbnails: prefer a small self-authored SVG under `public/img/games/`
  + `manifest.art`; the deterministic gradient fallback covers the rest.
  Never generate raster art by script, never hotlink.
- Server deps: none per game except framework-approved shared packages
  (see above). Client deps: none — relative helpers + `/vendor/*` only.
- Validate every action field (type + range + phase + turn + seat) and
  ignore garbage silently. Custom pack contents never echo to clients.

## Verify before you finish

```sh
npm run check-game -- <id>   # loads, manifest, locale bar, view smoke, hygiene
npm test                     # all 37 playthroughs + framework/race/clock/media/bridge/game rules
```

Then preview locally: `npm run dev`, open the room URL in TWO browsers
(or one normal + one private window) so you have two seats, and start
your game. There is no bot framework — two real browser sessions is the
supported preview. Check: host-only start, rematch, restart, lobby return
(no console errors, no stuck listeners), 360px + desktop widths,
keyboard-only play, and reduced-motion on. For 3D also check: `?nowebgl=1`
fallback plays the same game, 10 restarts leak no canvases/loops/
listeners, and resize works in standalone and narrow widths.

## Embedded (Giggle) rooms

Games need no embed-specific code, but know the shape: Giggle squads play
in private rooms reached only via WS `giggleJoin {ticket, n}` (verified
`sub` → seat, verified `squadId` → room; encounter tickets use a shared
encounter room key for both squads. The parent mints a fresh nonce
`n` per send and the server echoes it in `hello` only after the ticket
verifies, so the shell's `authed {n}` ack correlates to the latest
authorization). Seats resume by `sub` on reconnect with a fresh ticket;
the game host is the first present player (standard election), separate
from Giggle moderation. Every join/renew grants a lease bound to that
ticket's own expiry — `configure`/`start`/`action`/`lobby` need an
unexpired lease, and expiry disconnects until freshly authorized (the
parent renews ~every 60s on the same seat), so your game must tolerate
players dropping mid-game exactly like standalone disconnects (roster
seats persist; spectators watch). Preview embed mode without Giggle by
loading `/?embed=1&parentOrigin=<your-origin>` in an iframe from an
origin listed in `GIGGLE_ALLOWED_ORIGINS`, then answering its
`ready`/`auth-needed` postMessages with `auth {v:1, ticket, n}` (mint a
ticket with `server/bridge.js` `mintTicket`; expect `authed {v:1, n}`
echoing your nonce after the server accepts).

Views render in a compact in-call frame on phones: keep primary controls
at comfortable touch size (at least 44px) and the playfield above secondary
history. A view may read the `body.is-embed` marker for an embed-only
arrangement (chess puts its turn/clock strip above the board), but must
keep the same ids/classes so selectors and assistive tech keep working.

Then report: files written, phases/actions, and anything you left out.


## Camera-native games

Pose Party and Show & Go are thin configurations of `games/engines/camera-party.js` and `public/js/toolkit/camera-party.js`. The shared engine runs fixed performance windows, freezes candidates, accepts one private Yes/No ballot per judge/candidate, reveals a strict-majority result, and advances automatically. No self-votes or late claims; duplicate actions preserve the first accepted ballot/timestamp. Deadlines are server-owned, guarded by phase/round/token, and clear at completion. Prompt decks shuffle without repeating until exhausted. Hosts can customize rounds, performance/voting seconds, and prompt packs.

Use `createCameraParty({id, mode: 'spotlight' | 'gallery'})` and declare `communication: 'video'` in the manifest. Renderer wrappers delegate to `renderCameraParty` with `ownsTimer: true`. The camera view is a public layout request: `camera: {mode, featured: seatId | null, caption}`. The shell maps a seat to the verified Giggle user ID from the lobby roster; names never identify a camera tile. A missing/unverified featured identity sends no spotlight. Terminal views return `camera: null`.

Giggle Meet's parent owns every real video node, media permission and RTC connection. Auto selects Game stage for a camera scene, with a large performer or gallery and a smaller controls panel. Faces, Compact, Floating and Game stage remain viewer-local overrides. Charades uses the same stage contract; its public caption never contains the secret word. Standalone players can use any existing call and get an explicit call hint. Camera-off avatars remain available; opening/spotlighting a game never enables a device. Peers judge performances; these games do not record, capture, analyze motion or classify faces.

## Independent home pages and browser engines

See `GAME_AUTONOMY_GUIDE.md`. `manifest.homepage: true` publishes the authored
`games/<id>/home/` unchanged at `/games/<id>/`. `manifest.runtime: {type:
'frame', entry: 'index.html'}` publishes `games/<id>/browser/` and runs that
document without the platform CSS. `npm run new-game -- my-world --template
frame` creates both. Rooms, tickets, clocks and call mediation remain in the
platform; the game uses `createGameClient().subscribe/send`.
