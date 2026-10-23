# Game Night architecture

No-login online party games ("Game Night by Giggle"). In local development,
one Node process serves static files and WebSocket rooms. Production separates
Vercel static hosting at `play.gigglemeet.com` from one authoritative Railway
WebSocket process in Singapore. Clients render snapshots; server rules judge play.

```
browser ──HTTP──▶ server/server.js (static: public/)
        ── WS ──▶ rooms (server/room.js) ──▶ game def (games/<id>/server.js)
```

## Protocol (JSON, `t` = type)

Client → server: `create {name, seatToken?}` · `join {name, code, seatToken?}` ·
`games` · `configure {game, settings?, pack?, reset?}` (host only) ·
`start {game, settings?, pack?}` (host only) · `action {a, i?, w?}` (game-specific) ·
`lobby` (host only).
Server → client: `hello {you, name, seatToken, code}` · `games {games}` ·
`room {room}` (lobby snapshot; while a game runs it also carries
`instanceId`, `participants`, `spectators`) ·
`state {game, instanceId, w, serverNow, phaseStartedAt, you, spectator, players, participants, spectators, totals, …view}` ·
`error {msg}`.

`i` identifies the game instance; `w` identifies its stable round/turn/action
window. The shell sends both and the room drops stale values. Missing tokens
remain accepted for legacy clients; game-level validation is still required.
`clock {id}` receives `clock {id, serverNow}` for bounded client clock calibration.
`api.now()` uses this calibration, refreshes on reconnect/every 15 seconds and
does not use a player's clock to judge outcomes. `phaseStartedAt` keeps progress
bars consistent for late joiners. `ctx.later` callbacks also require the same
generation and action window. Views with `ownsTimer: true` render their own clocks;
the generic bar hides on finished/reveal/results states.

Identity: every seat gets a cryptographic resume token on `hello`, stored
by the browser per room. ONLY a matching token reclaims a seat — connected
or disconnected. A display name never grants ownership: same-name joins
get a unique suffix (`Ann 2`) instead of taking over. Tokens are
room-scoped (a token from another room grants nothing), and only the seat
still attached to a closing socket is marked away, so a stale close can
never clobber a replacement socket. Room codes are 4 letters; `/r/CODE`
links deep-link into a room. Emptied rooms linger ~2 minutes so a solo
creator can refresh and resume.

Host: the server tracks `room.hostId` (first seated player; migrates to
the longest-connected player on host disconnect so the party keeps
going). Host owns configuration: only the host may `configure`/`start`/
`lobby` while connected; if no host is connected, any connected player
may act so the room never deadlocks. Games read `ctx.hostId()` instead of
inventing their own host.

Limits: rooms hold at most 24 seats. Starting requires the connected
count to be within the game's `min–max` (derived from the definition /
manifest — client strings never override limits); violations name the
range.

## Rooms

`server/room.js`: `Rooms` collection + `Room` (players, totals, one active
game, generation-guarded timers so stale fires never apply). `broadcastState`
sends each player their `def.view(state, pid)` projection (hidden info stays
hidden). A 10 Hz server heartbeat calls `onTick` for realtime games.
`def.dispose(state)` runs on game change and lobby return when exported.

Active roster: every `start` snapshots the connected seats as the game
roster and mints a fresh `instanceId`. Seats disconnected before the
start are excluded (no ghost turns); seats joining mid-game become
spectators until the next start — they receive watch-only snapshots and
their actions are dropped before `onAction`. Disconnected roster
members keep their seats and resume by token. `ctx.allPlayers()` is the
ACTIVE roster, `ctx.players()` its connected subset; snapshots identify
`participants`/`spectators`, and all clients dispose + remount when
`instanceId` changes. The client never pre-clears its view on
`lobby`/restart — teardown happens only on the accepted snapshot, so a
rejected request leaves the current screen intact.

Active seats: games with `manifest.seats` (chess 2, karts 8) play only the
first N roster seats in stable roster order; roster members beyond the cap
are watchers (spectators with pre-start seats). The room derives this
generically — no game-id special cases: `ctx` exposes the active roster,
`onAction` drops non-active seats, snapshots split active
`players`/`participants` from `spectators`, and the lobby snapshot carries
the `seats` cap. The shell catalog reads `N play · watchers welcome`, the
game header counts active players and names watchers separately, and embed
presence reports the same split (`state {game, players, watchers?}`).

Broadcast: `onAction` broadcasts after every action by default, EXCEPT when
a game returns exactly `false` (input-only intents — karts steering — skip
the immediate broadcast and ride the 10 Hz `onTick` broadcast instead).
`onTick` broadcasts only via explicit `ctx.broadcast()`.

Room QR: `GET /qr.svg?code=FOURLETTERS` serves a locally generated SVG
(pinned `qrcode` package, server-side) encoding the room share URL only —
strict 4-letter code alphabet, validated `PUBLIC_GAME_URL` or request Host,
no tickets/credentials/query echo, bounded cache. Standalone lobby only
(desktop inline, phone Share panel); never in the Giggle embed.

Room-scoped configuration: each room stores validated `{settings, pack}`
per game id (`configure`), retained for rematches, cleared by `reset`.
Validation (`games/_validate.js`, all-or-nothing — failures keep the
prior config) enforces finite ints/enums/bools, rejects unknown keys, and
bounds packs (item counts, lengths, bytes). Public snapshots carry
settings + pack ITEM COUNTS only; custom content never leaves the server
except through a game's own per-player `view()`.

## Games (the plugin surface)

A game = server module + client view + locale content when content is used
(see GAME_GUIDE.md). Server API: `create(ctx)`, `onAction(state, ctx, pid, a)`,
optional `onTick(state, ctx)` / `dispose(state)`, `view(state, pid)`, optional
`manifest` (display metadata, player range, `seats` cap, `communication` hint,
`art` path, settings/pack schemas). Client API: `mount?.(el, api)` +
`update?.(el, S, api)` + `dispose?.(el)`, or legacy `render(el, S, api)`
(still supported). Spectators get shell-disabled inputs except view-local
controls marked `data-watchok` (board flip); the server gate is the real one.
Shared server helpers in `games/_sdk.js` (shuffle, dealer, tally, allIn)
plus `games/_validate.js` (manifest/settings/pack validation + bounds).
Registry in `games/registry.js` derives display entries from manifests
with legacy fallback, and auto-discovers new `games/<id>/` modules — no
registry edit needed for new games.

This surface already covers turn-based, realtime (canvas/input streaming at
10 Hz + instant actions), board games with seats/watchers (chess via pinned
`chess.js`), and small 3D arenas (pocket-karts: server sim + Three.js view
on the shared lifecycle helper, 2D fallback on the same snapshots): same
messages, same snapshots, richer views. Games never touch transport, rooms,
or each other.

Pinned vendor builds (`package.json` exact): `chess.js` 1.4.0 (BSD-2-Clause,
server rules), `three` 0.186.1 (MIT — `public/vendor/three/three.module.js`
+ `three.core.js` via `npm run vendor`, served locally, license alongside),
`qrcode` 1.5.4 (MIT, server-side QR SVG). `check-game.js` allowlists shared
dependencies per DEPENDENCY (pinned `chess.js` 1.4.0, usable by any game id);
3D clients import the local vendor path or the shared helper — bare/CDN
imports are rejected.

## Locales

`locales/en/<game>.json` content packs, loaded at boot, handed to games as
`ctx.content(id)` (room pack override wins over the boot pack). All game
strings resolve server-side so a future locale (`hi`, `hinglish`…) swaps
content without touching logic. Room locale is picked at create-time
later; the plumbing (`content[gameId]`) is ready.

## Client shell

`public/js/app.js`: connection + token auto-rejoin (with a visible
reconnecting state), home / lobby / game screens, host-gated controls,
featured + searchable/filterable catalog, scoreboard, readable timer,
focus-preserving re-renders, aria-live announcements.
`public/js/customize.js`: dedicated accessible customization dialog
(settings + packs with live counts, named device presets, saved lists,
JSON import/export; guests get the same panel read-only with safe
summaries).
`public/js/howto.js`: one native-`<dialog>` instruction panel for every
game (catalog `howto` sentence-split, seat/communication pills, one honest
context CTA — home ticket, host Start gated like the server, guest truth
in words). Cards keep constant geometry; the panel never stacks with the
customizer and survives roster ticks (CTA re-derives) but closes on
screen/game transitions.
Catalog browsing is shared home + room: search (name/tagline/category),
category chips, customizable toggle, sort (shelf/name/fewest/room
fits-first, stable ties), home group-size range overlap vs room Fits-our-N
from the live count — all real metadata, no invented tags/stats; only
results/count repaint on typing. Embed compact chrome: watching identity
rides in the gamehead line and the reason + Why? sits below the playfield
before scores (standalone banner unchanged).
`public/js/game-host.js`: view lifecycle driver — mount/update/dispose
with stale-import guards; dispose runs on every teardown.
`public/js/util.js`: escaping + storage + name helpers + deterministic
art fallback for imageless games. Styling in `public/css/style.css`
(sticker-party: raspberry `--accent`, sunshine `--sun`, ink `--edge`
borders, hard offset shadows, two coherent looks — Day default and
Night near-black; pre-D7 stored ids migrate to day/night — Baloo 2 +
Nunito self-hosted variable woff2 in `public/fonts/` (SIL OFL, no CDN);
reduced-motion honored. Shell motion: 3 slow ambient doodle loops +
one-shot feedback only (room-created pop/confetti, first-paint card
stagger, join ring) — nothing replays on WebSocket repaints, and
`prefers-reduced-motion` gets a fully static UI).

## Giggle embed bridge (optional, default-off)

The Giggle lobby can frame Game Night in an iframe so a squad plays
together beside its call. Standalone anonymous play is unaffected.

- Ticket: Giggle's backend mints a 90-second single-use HS256 ticket
  (`iss giggle-meet`, `aud game-night`, `sub` = user id, `squadId`,
  `displayName`, `jti`, `iat`/`exp`) with `GAME_BRIDGE_SECRET` (≥32 chars).
  Giggle mints only for verified-adult live squad members passing the same
  blocked-pair check as lobby media — embedded rooms are private adult rooms.
- Verify: `server/bridge.js` checks exact alg/issuer/audience, signature
  (timing-safe), exact 90s window, size/fields, and single-use jti. The
  replay cache (max 5000) FAILS CLOSED: unexpired jtis are never evicted;
  while full, new tickets get a distinct capacity error. Native crypto only.
- Join: WS `giggleJoin {ticket, n}` / `giggleRenew {ticket, n}` (fresh
  ticket AND fresh parent nonce `n` each time). Verified `squadId` maps to
  a private in-memory room; verified `sub` maps to a stable seat (never by
  display name; same names get distinct deduped seats). Anonymous
  code/seat-token joins to these rooms are rejected. `hello` for Giggle
  seats carries NO seat token (an expired identity cannot fall back to
  legacy resume) and echoes the validated nonce `{n}` ONLY after its
  ticket verified and the seat attached — never on any error path. The
  child echoes that echo in `authed {n}` so the parent can correlate the
  ack to its latest pending authorization.
- Lease: every join/renew grants an authorization lease bound to the
  ticket's own expiry (`claims.exp`; `GIGGLE_LEASE_MS` only shortens for
  tests, never extends). Private actions
  (`configure`/`start`/`action`/`lobby`) require an unexpired lease;
  expiry stops outgoing room data at once and disconnects the socket
  until freshly authorized. The parent renews ~every 60s on the same
  socket/seat (30s margin), so Giggle-side removal/age/account/block
  changes land within ~90s.
- Seats: one active socket per seat. A takeover closes the replaced
  socket with code 4001 (`seat-replaced`); that client shows "Playing in
  another window" + "Rejoin here" and does NOT auto-reconnect. Normal
  drops still auto-resume.
- Framing: `postMessage` protocol v1 (`public/js/embed.js`, child side).
  Child → parent: `ready {v}`, `auth-needed {v}`, `authed {v, n}`,
  `state {v, game, players, watchers?, presentation?}` (the presentation
  hint is `social`|`board`|`immersive`|`balanced`, derived from public
  catalog metadata only; the parent validates the enum, treats
  unknown/missing as `balanced`, and its Auto/Faces/Compact layout
  controls never remount the call or iframe). Parent → child:
  `auth {v, ticket, n}`, `context {v, theme?}` (validated theme ids only).
  Freshness: the parent mints a fresh nonce per auth send and promotes
  loading to live ONLY on an ack echoing its latest pending nonce
  (consumed single-use — an old duplicate can never authorize a new
  attempt). A stale/spoofed ack or a pre-auth state snapshot never marks
  the frame heard: only a live child script (`ready`/`auth-needed`) or an
  accepted current ack proves the document, so Retry still reloads a
  never-answered (404/blank) document while auth-only Retry on a live
  frame preserves it. Every attempt has a bounded 20s ready-timeout with
  Retry. Both sides enforce the exact configured origin and the exact
  `event.source` — no `'*'`, no unrelated same-origin frames. The child
  confirms the claimed `parentOrigin` against public `/config.json`
  before any ready/auth traffic. Embed mode
  (`?embed=1&parentOrigin=…`, preserved across internal navigation)
  ignores stored standalone autojoin, hides promotional chrome, shows a
  compact squad context (host + count + names), keeps tickets in memory
  only, and plays compact: no nested topbar on game screens (theme follows
  the parent via context, sound rides a gamehead toggle), a one-line
  watcher status with a Why? disclosure, and turn/clocks above the
  playfield. Standalone home/lobby/game UI is unchanged.
- Config: `GIGGLE_ALLOWED_ORIGINS` (comma-separated exact origins) gates
  `frame-ancestors` (self + Giggle origins), cross-origin WS, and child
  trust. `GET /config.json` exposes bridge version + origins + allowHttp
  only, no secrets. HTTP origins are honored only outside production.

## Run / test

`npm install`, `npm start` (PORT/HOST env; binds 0.0.0.0),
`npm run dev` (native `--watch` restart). `npm test` runs smoke (a
5-seat room through all 35 registered games) + framework (identity, host,
config, privacy, isolation, disposal, QR/vendor, seats metadata) +
scaffold (DOM + 3D authoring tooling) + bridge (HTTP hardening, moved
sockets, Giggle tickets/lease/embed, UI-batch checks) + chess rules +
karts rules, 35 complete playthroughs, race/clock/media, dictionary, Chain Reaction,
Warm Words and Castle Clash suites. `npm run new-game -- <id> [--template starter|3d|kart]` scaffolds a
starter; `npm run check-game -- <id>` validates one game; `npm run vendor`
re-copies the pinned Three.js build (also on postinstall). Production
deployment: Vercel static pages plus one Railway Node/WebSocket process. See
`DEPLOYMENT_PLAN.md` and `RELEASE_REPORT.md` for production checks and limits.

Bridge env (all optional; unset = standalone only): `GAME_BRIDGE_SECRET`
(≥32 high-entropy chars), `GIGGLE_ALLOWED_ORIGINS`
(`https://gigglemeet.com,https://www.gigglemeet.com`),
`GIGGLE_LEASE_MS` (tests only).

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
