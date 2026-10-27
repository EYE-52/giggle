# Game framework — current contracts

The framework now runs 37 games through discoverable manifests, authoritative
server rules and independent client views. Games choose their own DOM, 2D canvas
or 3D layout, with optional input, sound and parent-call voice helpers. Shared
rooms, identity, configuration, clocks, action guards and cleanup belong to the
framework. Production is live at https://play.gigglemeet.com.

Game presentation is explicit: `manifest.layout` selects `standard` or
`immersive`, independently of DOM/canvas/3D rendering. An immersive view
gets the viewport and owns all HUD/style choices; shared room actions stay
in a platform drawer. Standard-only typography/answer styles cannot bleed
into that viewport. The call bridge also receives the immersive presentation.

## Framework contracts

- Rooms support 24 people, cryptographic seat-resume tokens and host migration.
  Each start creates an immutable roster and a new `instanceId`; late joiners
  watch until the next start. `manifest.seats` caps active players while retaining
  the rest as spectators. Names never grant ownership of another seat.
- Server modules expose `create`, `onAction`, `view` and optional `onTick` and
  `dispose`. Projections keep secret words, roles and answers private. Host-set
  settings and custom packs are validated against manifest schemas.
- The shell attaches `{i, w}` to actions: game instance and stable action window.
  Delayed actions from old rounds/turns/rematches are dropped. Server timers use
  `ctx.later` with generation and action-window guards, including callbacks
  scheduled during game creation. Legacy messages without tokens remain accepted;
  games must still validate phase, turn, seat and every action field.
- Snapshots include `serverNow` and stable `phaseStartedAt`. Clock echoes calibrate
  the client against server time, refresh on reconnect and every 15 seconds, and
  tolerate local clock skew/jumps. `api.now()` drives display; server rules judge
  deadlines. Views may declare `ownsTimer: true`; the generic timer also hides on
  reveal/results/done screens. Clear `endsAt` when an active phase finishes.
- Views expose `mount`/`update`/`dispose` or legacy `render`. A fresh instance,
  lobby return or game change disposes the old view. The framework supplies room
  context, totals, rematch controls and spectator gates; it does not constrain the
  game's playfield, HUD or primary interaction.
- `api.toolkit` provides DPR-aware canvas lifecycle, released-on-blur input,
  gesture-unlocked sound and Three.js lifecycle factories. Views select only the
  pieces they need. `api.voice` mirrors/request-prompts the existing parent call;
  a game never captures a microphone or camera itself.
- The shared kart engine and view are reusable factories: mode/map/settings are
  declarative wrappers. Server simulation runs at 10 Hz; input changes plus
  500 ms keepalives expire after 1.5 seconds without refresh. Local prediction and
  bounded remote interpolation smooth rendering. Backlogged motion snapshots may
  be discarded; critical updates are retained. Three.js is pinned and served
  locally, with a 2D fallback using the same snapshots.

## Authoring

The three base files are `games/<id>/server.js`, `public/js/games/<id>.js` and
`locales/en/<id>.json`. Scoped styles, original artwork and attributed data may
accompany them. Shared framework changes are made as coordinated framework work,
not copied into each game.

```sh
npm run new-game -- my-game                     # DOM starter
npm run new-game -- my-arena --template 3d       # 3D starter
npm run new-game -- my-karts --template kart     # shared kart factories
npm run new-game -- my-cam --template camera     # shared camera engine+renderer
npm run check-game -- my-game
npm test
```

Manifests discover games automatically and drive search, group/category filters,
sorting, How to play dialogs, settings and custom packs. `npm run build` generates
all 37 individual pages and the sitemap. See `GAME_GUIDE.md`,
`MEDIA_TOOLKIT_GUIDE.md` and the game-specific guides for concrete APIs.
The reusable core ships as a portable local archive — see
`GAME_KIT_GUIDE.md` (pack/install/import/create/check, renderer autonomy).

## Giggle integration

Standalone games require no account and work alongside any external call.
Signed-in Giggle players open Play together inside the existing squad or encounter
page. Game-dependent presentation hints choose larger faces for social games,
calm board layouts or compact filmstrips for arenas. The parent keeps the same
Agora call mounted while games open, change or close.

Giggle mints 90-second, single-use HS256 tickets after live membership, adult
identity and blocked-pair checks. Squad tickets map to a private squad room;
encounter tickets map both squads to the same private encounter room. Verified
`sub` resumes the same seat. Fresh tickets renew approximately every 60 seconds;
expired leases stop private room access. Exact origin, source and fresh nonce
checks guard the frame protocol. Tickets never enter URLs or browser storage.
The parent alone handles the explicit Enable microphone action.

## Evidence and limits

The Node 24 suite passed all 37 legal complete game playthroughs, plus framework,
race, clock, privacy, bridge, media, dictionary, board and kart regression checks.
All 37 layouts were captured and reviewed at desktop and 390px phone width.
Phone-width screenshots are browser layout checks, not physical touch tests.
Hosted HTTPS/WSS checks and a 24-client Singapore test also passed; see
`RELEASE_REPORT.md` for exact releases, timings and evidence.

The game server is one Railway process in Singapore; Vercel serves static assets.
Rooms and replay state are in memory, so a game-server restart resets games. The
current 10 Hz arena runtime is appropriate for casual play; competitive latency
and global long-duration capacity are not established by the short load test.
Real two-device Agora media and physical mobile touch acceptance remain manual.
Discord Activity and an advertising provider are future integrations.

## Browser game autonomy (Game Kit 0.1.2)

Game-owned home pages and standalone browser bundles are supported in addition
to module views. No platform stylesheet is injected into these documents.
Use `manifest.homepage: true` for `games/<id>/home/index.html`, and
`runtime: { type: 'frame', entry: 'index.html' }` for an export under
`games/<id>/browser/`. Renderer labels are descriptive, not an engine enum.
`npm run new-game -- my-world --template frame` creates the working paths.
The optional `createGameClient` bridge exposes snapshots, validated intents,
calibrated time and parent-call voice without duplicating room transport.
See `GAME_AUTONOMY_GUIDE.md` for the contract and verification.
