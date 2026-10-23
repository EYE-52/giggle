# Bring your browser game

The platform owns the catalog, rooms, seat identity, host permissions,
multiplayer transport, state projections, clocks and Giggle Meet call mediation.
A game owns its home page, renderer, world, menus, controls, HUD and style.
Engine helpers are optional. There is no required canvas, CSS theme or game UI.

## Two client paths, independent home pages

- **Module view:** `public/js/games/<id>.js`, default export with optional
  `mount`, `update`/`render`, `dispose`. Choose `layout: 'immersive'` to own
  the viewport, or omit it for a scrolling game surface with a slim title
  and room toolbar. `ownsTimer`,
  `ownsRematch` and `ownsInputs` let a view supply those surfaces; server
  spectator/host/action rules always apply.
- **Browser document:** export any browser-compatible engine/build into
  `games/<id>/browser/`, and declare
  `runtime: { type: 'frame', entry: 'index.html' }`. Nested entries such as
  `Build/play.html` work too. The build publishes all exported assets under
  `/game-assets/<id>/`. A separate document isolates all CSS/DOM. No default
  JavaScript export or shared renderer is needed. HTML/CSS/JS, WASM, workers,
  GLB, textures and media can ship together. Browser capabilities and the
  engine's own export requirements still apply.
- **Custom home:** put a complete document plus its assets under
  `games/<id>/home/`, and declare `homepage: true`. The build copies the
  folder byte-for-byte into `/games/<id>/`. It never wraps the document or
  adds platform CSS. Omit the flag to use the generated fallback detail page.

`renderer` is a short descriptive label, such as `dom`, `3d`, `phaser`,
`webgpu` or `wasm`. It never chooses a rendering implementation.
Frame games default to immersive presentation; a small room drawer keeps
invites, sound, theme, totals and changing games reachable. The game document
has the remaining viewport, and can choose its own scrolling/responsive UI.

The game supplies its own turn, phase, objective, tools and match standings.
The drawer's **Night totals** accumulate across games; do not substitute them
for a match score. Games without a projected match score should show their
actual verdict or round record instead. Module games may keep the calibrated
thin platform countdown, or declare `ownsTimer: true` and own both its display
and cleanup. Results never show a running shared countdown.

Games with a final cascade, explosion or projectile resolution can declare
`runtime: { type: 'module', waitForResult: true }` (or add `waitForResult`
to a frame runtime). After applying the final `done` snapshot, finish those
effects before calling `api.resultsReady(state.instanceId)` in a module,
or `room.resultsReady()` in a browser document. The shell celebrates only
the current instance, once. Repeated snapshots and old callbacks cannot
trigger another celebration. A reconnect directly into results is already
settled and does not replay the previous match's victory animation.

```js
manifest: {
  name: 'My World', players: { min: 1, max: 8 },
  renderer: 'wasm', homepage: true,
  runtime: { type: 'frame', entry: 'Build/play.html' },
}
```

## Connect the game to its room

```js
import { createGameClient } from '/js/game-client.js';
const room = createGameClient();
const stop = room.subscribe((state, context) => {
  myEngine.applySnapshot(state);
  myMenus.setHost(context.isHost);
});
myEngine.onIntent(action => room.send(action, { silent: true }));
myEngine.setClock(() => room.now());
// On teardown: stop(); myEngine.dispose(); room.dispose();
```

`subscribe` receives the latest player-specific server view plus
`{isHost, theme, sound, voice}`. Engine adapters can pass JSON through their
own native bridge; the platform never calls engine-specific functions.
There is one existing platform socket. The game does not receive seat
credentials or Giggle tickets, and never opens a second room connection.

- `send(action, {silent?})`: game-specific intent. The child preserves the
  instance and action-window stamps from its snapshot. The parent rejects
  stale windows, stale instances and spectator actions before using the room
  API. Objects, arrays and scalar JSON values share the module-view action
  contract, including actions during a game's results phase. The server
  remains authoritative for legality and concurrency; ordinary room transport
  limits apply, with no extra frame-only payload cap.
- `now()`: calibrated server time advanced with a monotonic local clock;
  use after the first snapshot for display, never to decide server deadlines.
  Before that snapshot it returns local wall-clock time.
- `name(pid)`, `toast(text)`, `announce(text)`, `focus(element)` are optional.
- `rematch()` and `lobby()` use existing host gates. Rematches are allowed
  from a done state, and dispose/remount every client on a new instance.
- `voice.getStatus()/subscribe()/request()` reuse the existing Giggle Meet
  call via the platform. No separate microphone capture occurs in the game.
  Standalone players receive the existing call hint. Games retain their own
  voice controls and can use video-core presentation metadata.
- `dispose()` removes bridge listeners and subscriptions. The game must also
  dispose its engine, input listeners, audio and workers. Parent game changes
  remove the entire document and its runtime.

The bridge validates exact source, exact same origin, version and per-mount
session id. The frame name carries non-secret correlation; the engine URL and
hash stay available for its own routing. Create the room client before
overwriting `window.name`, which supplies the initial handshake correlation.
Browser documents are trusted code installed/deployed with the platform, **not an untrusted
user-upload sandbox**. There is no iframe sandbox imposing engine restrictions.
They may use script, same-origin resources, pointer
lock and fullscreen. Do not put private files in public exports; hidden paths,
symlinks and dependency directories are rejected during build preflight.

## Room entry from any home

Use your own form/buttons/layout, submitting the existing platform entry:

```html
<form method="GET" action="/">
  <input type="hidden" name="game" value="my-world">
  <label>Your party name <input name="name" required maxlength="16"></label>
  <button>Create room</button>
  <button name="wantsetup" value="1">Customize + Create</button>
</form>
```

The customize button is useful when your manifest has a settings/pack schema.
Visiting a home page creates no room. The submitted intent is validated by
the existing shell against the live catalog, then opens the chosen game in
the room lobby. Use `/r/<code>` invites for joining an existing room.

## Scaffold and checks

```sh
npm run new-game -- my-world --template frame
npm run check-game -- my-world
npm run build
npm run test:autonomy
```

The portable private `giggle-game-kit-0.1.9.tgz` also includes this template
and `createGameClient` through `giggle-game-kit/browser`. Replace its sample
HTML with your engine export; server rules use the same existing game contract.

Shipped game surfaces: Castle Clash has its own fort home and Three.js
scene; Chain Reaction runs in its own graphite orb-lab document. Standard
games use a slim platform toolbar and define their own play surface and HUD. Automated
tests exercise independent home assets, a nested WASM export, unchanged
bytes, build refusals, handshake/reload, clocks, stale actions, spectators,
host controls, voice and disposal. Browser QA verifies the real room flow.
