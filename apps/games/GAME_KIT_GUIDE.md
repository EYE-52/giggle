# Game Kit Guide — reusable framework, portable package

The Game Kit is the reusable core of the 43-game framework: versioned
engine factories on the server, canvas/input/audio/voice/3D helpers in
the browser, and a scaffolder. Game code stays thin — it configures
factories, never copies their rules.

The platform owns rooms, identity, transport, clocks and the game catalog.
Each game owns its visual language and interaction. Set
`manifest.layout: 'immersive'` for a game-owned viewport: the platform's
title card, margins and text-game styles stay off the view, while inviting,
sound, host controls and night totals live in a collapsible room drawer.
Omit it (or set `standard`) to use the existing frame. Layout is independent
of `renderer` (`dom`, `canvas`, `3d`): an immersive DOM game is valid too.
Own your CSS under the view root; never style the platform or another game.
The 3D scaffold opts into immersive layout; no universal game HUD is required.

Two ways to use it:

- **In this repo** — `sdk/*` entries + `scripts/new-game.js` (same files
  the kit packs).
- **Outside this repo** — the packed local archive
  (`giggle-game-kit-<version>.tgz`). Zero dependencies, no repo access
  needed. Local use only — never published to npm.

## Pack

```sh
npm run pack:kit -- --list            # show the version + file manifest
npm run pack:kit                      # writes sdk/dist/giggle-game-kit-0.1.9.tgz
node scripts/package-game-kit.js --out /tmp/kit.tgz   # explicit destination
```

The pack preserves repo-relative paths, so every relative
require/import resolves identically inside and outside the repo. It
fails on version drift: the root `package.json` version,
`sdk/package.json`, and the `KIT_VERSION` in `sdk/server.js`,
`sdk/browser.mjs`, and `sdk/scaffold.js` must all match.

## Install (outside the repo)

```sh
npm install ./giggle-game-kit-0.1.9.tgz   # registers the game-kit CLI
# or without npm (tar creates the package/ directory):
tar -xzf giggle-game-kit-0.1.9.tgz -C kit  # yields ./kit/package/<kit>
node kit/package/sdk/cli.js list
```

## Import

```js
// Server (Node, CommonJS) — helpers, validation, engine factories.
const kit = require('giggle-game-kit/server');
kit.KIT_VERSION; // '0.1.9'

const karts = kit.kart.createKartGame({ id: 'my-karts', name: 'My Karts' });
const cam = kit.camera.createCameraParty({ id: 'my-cam', mode: 'gallery' });
const words = kit.dictionary.createWordValidator();
kit.sdk.shuffle([1, 2, 3]);
kit.validate.isValidId('my-game'); // true
```

Explicit server exports: `sdk` (shuffle, pick, dealer, tally, allIn,
names, actionWindow), `validate` (LIMITS, isValidId, manifestPlayers,
manifestSeats, activeIds, validateManifest, defaultSettings,
validateSettings, validatePack, packCounts, clientSchema), `kart`
(createKartGame, RULES, constants, helpers, maps, rules),
`camera` (createCameraParty + pure helpers/bounds),
`buildBattle` (createBuildBattle, retained for existing games),
`blockSiege` (createBlockSiege, castlePositions, supported, segmentBox), `chainReaction`
(createChainReaction + geometry/resolveCascade/legalMoves),
`dictionary` (createWordValidator, normalizeWord, isSubset,
wordCount), `semantic` (createSemanticGuess,
createEmbeddingProvider, cosine, normalizeWord), `hints`
(maskWord, hiddenLetters, revealLetter). No bridge secrets, auth
tickets, room transport, or server internals are exported.

```js
// Browser (ESM) — toolkit factories + view helpers.
import {
  createCanvasView, createInput, createSoundBank,
  createVoiceClient, createThreeView, createSessionToolkit,
  createKartView, createBlockSiegeScene, renderCameraParty, esc, countdown,
} from 'giggle-game-kit/browser';
```

The specifier resolves everywhere: bundlers, plain Node
(`await import('giggle-game-kit/browser')` after `npm install
./giggle-game-kit-<version>.tgz` — verified by
`test/game-kit.js`, including session build + dispose), and,
without a bundler, by serving the unpacked kit directory and
importing `sdk/browser.mjs` by URL — its imports are all
relative. Serve `public/vendor/three/` at `/vendor/three/` so the
shared Three.js helper's dynamic import resolves.

Module boundary: the kit root is CommonJS (`sdk/server.js`,
`sdk/scaffold.js`, `games/engines/*`), while the packed
`public/js/*.js` browser graph is ESM via a generated
`public/js/package.json` (`{"type":"module"}`). The packer
generates that one file; no browser source is forked or rewritten,
and the repo tree itself keeps no such boundary.

## Create + check (outside the repo)

```sh
game-kit list                          # templates + engines + toolkit
game-kit inspect camera                # one piece in detail
game-kit create my-game --root ./my-party --template camera
game-kit check my-game --root ./my-party
```

`create` writes only `games/<id>/server.js`,
`public/js/games/<id>.js`, `locales/en/<id>.json`, plus the framework
files the scaffold needs to load standalone. Ids are validated
(2–40 chars, lowercase letters/digits/dashes), overwrites and
path-traversal destinations are refused, and missing arguments fail
with usage. `check` runs the kit's bundled `check-game` (loads,
manifest, locale bar, view smoke, hygiene) against your directory.

In this repo the same scaffolder is `npm run new-game -- <id>
[--template starter|3d|kart|camera|frame]` and the same checker is
`npm run check-game -- <id>` — both share `sdk/scaffold.js`, so repo
and kit scaffolds are byte-identical.

## Templates

| Template | Server | Client | Renderer |
|---|---|---|---|
| starter | answer → vote → reveal, settings + packs | DOM mount/update/dispose | dom |
| 3d | orb sim, validated intents, 10 Hz tick | shared GL helper + 2D fallback | 3d |
| kart | thin `createKartGame` config | thin `createKartView` config | 3d |
| camera | thin `createCameraParty` config (spotlight; one-line switch to gallery) | shared camera renderer + its CSS | dom |

The camera template is the call-native starter: the video call is the
playfield, the engine runs the perform → vote → reveal loop with
secret ballots and server deadlines, and nothing is recorded. Declare
`communication: 'video'` (already in the template) and ship ≥20
locale prompts (24 included).

## Renderer autonomy

Every factory is optional sugar, never a restriction. A game may use
all, some, or none of the kit pieces:

- Pass hooks where factories offer them (`buildKartMesh`,
  `sceneExtra`, `hudExtra` on the kart view).
- Or skip a factory entirely and ship bespoke HTML/CSS/canvas/Three.js
  against the same snapshots — the mount/update/dispose lifecycle is
  unchanged, and game-owned markup/styles/canvas are welcome.
- What stays shared even for bespoke views: the intent shape, the
  snapshot shape, and the conventions (steering, `ownsTimer`,
  `?nowebgl=1` fallback honesty, keyboard + 44px touch +
  reduced-motion basics). Server rules stay authoritative; views never
  simulate, score, or judge.

There is deliberately no no-code editor, plugin system, or universal
UI — thin wrappers plus full escape hatches.

## Included / not included

Included: `sdk/*` entries + CLI, `scripts/check-game.js`,
`scripts/templates/*`, `games/_sdk.js` + `games/_validate.js` +
`games/engines/*` with the offline English word list,
`public/js` toolkit/renderers/engines/util plus a generated
`public/js/package.json` ESM boundary (so plain Node imports the
browser entry; the kit root stays CommonJS),
`public/css/camera-party.css`, and the pinned local Three.js vendor
build with its MIT license.

Not included: `chess.js` (pinned rules library 1.4.0 — install it
yourself if your game requires it; the kit never bundles npm
packages), and anything bridge/auth/transport (the kit exports game
factories only, never Giggle Meet credentials or plumbing).

## Verify

```sh
npm run test:scaffold    # repo scaffolder + camera template end to end
npm run test:game-kit    # pack/unpack/install/import + derived engine + CLI
```

## Optional 3D arena controls

Import `createArenaControls` with `createThreeView` for a game-owned camera,
tap/drag separation, wheel/pinch zoom and hover picking. Provide your own
raycast callback, meshes and HUD. `createCastleScene` is an optional toy-fort
reference renderer over build-battle snapshots; it does not own rules or
force its interface on derived games. The CLI exposes these tools with
`game-kit inspect arena`.

## Browser game autonomy (Game Kit 0.1.4)

Game-owned home pages and standalone browser bundles are supported in addition
to module views. No platform stylesheet is injected into these documents.
Use `manifest.homepage: true` for `games/<id>/home/index.html`, and
`runtime: { type: 'frame', entry: 'index.html' }` for an export under
`games/<id>/browser/`. Renderer labels are descriptive, not an engine enum.
`npm run new-game -- my-world --template frame` creates the working paths.
The optional `createGameClient` bridge exposes snapshots, validated intents,
calibrated time and parent-call voice without duplicating room transport.
See `GAME_AUTONOMY_GUIDE.md` for the contract and verification.

## Kart maps and handling (0.1.4)

A kart variant can offer `maps: ['ring', 'blocks', 'garden', 'frost', 'neon']` in its `createKartGame` configuration. The snapshot carries each map's label, theme and authoritative `blocks`, `pads` and `surfaces`; pass that map into the world and prediction helpers. Rendering can use its own presentation while preserving the same gameplay geometry. Garden Circuit has a central island and outside speed strips; Frosty Pass has low-grip ice; Neon Yard has cover lanes and four strips.

Input remains validated intent: `{steer, throttle, boost, drift}`. `drift` is an optional held boolean. A useful forward turn charges it; deliberate release after a full charge grants one brief turbo. The server owns collisions, pad cooldowns, scores, deadlines and results. `slip`, `drifting`, normalized `driftCharge`, `turbo`, `padCd` and `grip` are snapshot feedback for the renderer. The supplied browser view maps Shift and the phone DRIFT button to the same intent, and mirrors ground-plane stepping for immediate self response. Kart-to-kart contact stays server-authoritative.

These are flat arcade mechanics. Games needing jumps, rigid-body stacking or rolling terrain require a separate physics system rather than reinterpreting these rectangles as 3D colliders.

## Kart battle loop and live sunset (0.1.4)

The reusable kart factory now supports timed or score-target rounds and
fixed or evolving lighting. Pocket Karts opts into timed battles and live
sunset; derived games retain their declared defaults. Combat, item choice,
spawn protection and respawn positions belong to the server. The renderer
can be replaced without changing those rules.

Map snapshots include `half` and `bound` alongside collision blocks,
speed strips and grip surfaces. Prediction, fallback, minimap, world and
shadow coverage use these values; a larger map must never be visually
expanded while movement remains clamped to the old boundary.

Battle drivers carry one item: Pulse, Scatter, Mine or Shield. A knockout
preserves score, clears motion/items and briefly freezes the driver, then
returns them at a safe map spawn with visible protection. Offensive fire
ends protection. `spawnSeq` is the authoritative life/teleport epoch:
prediction must reset on a changed sequence, even for a short teleport.
Crates relocate with fresh IDs selected from validated legal sockets;
item grants and knockouts are applied once on the server.

`skyCycle: { startedAt, durationMs, endedAt? }` is shared by every viewer; `endedAt` freezes the sky on results. Use the
platform's calibrated `api.now()` to compute its clamped 0..1 phase;
never start a private clock when a renderer mounts. The standard world
accepts `animate(dt, visualTime, skyPhase)` and the retained lighting
cleanup function exposes `update(mood)` without rebuilding environment
maps each frame. A custom renderer may interpret this phase with its own
art direction.

Focused verification: `npm run test:kart-battle-loop`, the existing
mechanics/projectile/prediction checks and real-map art checks. Weapon
probabilities and durations are initial balance values and need observed
multiplayer play, not only unit tests.

## Game Kit 0.1.5: independent scenes and smoother shared play

A game still owns its browser renderer, layout and controls. Room transport supplies a private projection per player, a calibrated clock, game-instance and action-window guards, reconnects, spectators and optional Giggle Meet context. It does not impose the catalogue card UI on the playfield.

Pocket Karts demonstrates reusable simulation, six battle weapons and room-scoped progression in `games/engines/kart-engine.js` and `kart-rules-battle.js`. Garage Battle adds capped engine/handling/reload upgrades; Zap Battle uses stock handling with the same arsenal. Server-only game sessions retain coins and upgrades across rematches and switching games in the room. A room/server restart ends that session.

The browser kit includes `kart-pose.mjs` for timestamped remote buffering and continuous local correction, `kart-flight.mjs` for bounded visual projectile flight, `kart-audio.mjs` for gesture-unlocked/mutable disposable audio, and `kart-combat-art.mjs` with the shipped authored GLB weapon library. Authoritative hit, cooldown, scoring and wallet decisions remain on the server.

Build Battle exposes optional clock-derived supply chests and per-round orders. Games can configure the economy and objectives while replacing the HUD/world. Chain Reaction publishes a bounded sequenced cascade tape for staged rendering; motion preferences, background tabs, rematches and missed tapes settle safely to the authoritative board.

The source release includes original asset authoring scripts and Blender source. No external paid services are needed for these systems.

## Phone-safe controls (0.1.6)

`createInput` tracks each pointer independently, ignores unrelated releases,
cancels a lost capture, and provides window release fallbacks. Blur, a hidden
document, orientation changes and disposal release captures and held keys.
`createArenaControls` cancels abandoned camera gestures on blur/hidden/rotation and never
turns an unrelated finger lift into a placement tap. Games still choose their
own `touch-action` and visible controls.

`createKartView` adds optional Auto gas for touch layouts. It is a local driving
preference, uses the same authoritative input protocol, yields to brake/reverse,
and resets when driving is interrupted. Simultaneous steering/throttle/drift
buttons retain their own active pointer IDs; sliding off a captured button does
not silently release a held action. See `GAME_UI_GUIDE.md` for the phone QA
contract, input focus and independent HUD guidance.

## Game-owned HUDs (0.1.9)

During play the platform keeps room utilities in a native disclosure. Standard
modules receive a slim title/room toolbar; immersive and frame games retain
their own viewport. Show the immediate objective, turn or role, match score
and tools in the game's own visual language. Cumulative Night totals belong
in the room drawer. A game without a match-score projection should show its
actual verdict/history. Keep one calibrated countdown and hide it on results.
Preserve keyed composers and pointer lifecycles when HUD state updates.

See `specs/HUD_POLISH_20261006.md` and `GAME_UI_GUIDE.md` for the display and
phone acceptance boundaries. The racing, faction, atomic-tabletop, party and
skill instruments are optional examples; no universal HUD is required.

## Mobile screen ownership (0.1.9)

`createGameScreen` is an opt-in browser helper for a player-initiated screen
button. It requests native full screen before attempting landscape orientation.
It handles denied/unsupported requests with manual-rotation guidance and releases
only the full-screen/orientation state it acquired. A pending request resolving
after disposal is unwound. Do not start it from a snapshot, mount, or timer.

The platform supplies Play landscape in the Room drawer for every game, plus a
portrait-phone icon next to Room for immersive games. Before a screen transition
it dispatches document `game-screenchange`; continuous input and camera helpers
must cancel their current gestures. Native `screen.orientation.change`, blur,
visibility loss, and disposal also release input. Keep portrait play usable;
do not rotate a canvas with CSS or assume an orientation lock is available.

`createMobileStick(element, { onChange, enabled, window, document, deadzone })`
provides a one-pointer spring-back analog pad; `normalizeStickVector` is the pure
radial deadzone/clamp helper. Values are x/right and y/down in [-1, 1]. Games choose
their own mapping and artwork. `reset(false)` allows a host to clear every held
control atomically before sending one neutral intent. Dispose every helper when
the view unmounts, and send the game's final neutral packet before dropping its
transport. The same factory is available through `api.toolkit.createMobileStick`.
